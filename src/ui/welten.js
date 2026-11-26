// Welten, Spielstände, Szenarien, Teilen (seit 26.11.2026, Naders Auftrag "alles umsetzen").
//   Sicherungen: alle 8 Minuten und vor jeder neuen Welt wandert der Stand in den Browser Speicher (IndexedDB), die letzten
//     6 bleiben. Zurückholen im Menü unter "Sicherungen". Schützt vor Fehlgriffen und vollem localStorage.
//   Szenarien: fertige Startlagen mit einer Aufgabe (Seuche, Frieden, Aufbruch). Das Ziel steht bei "Nächstes Ziel".
//   Welt der Woche: alle Spieler bekommen in derselben Woche dieselbe Startwelt (Seed aus Jahr und Woche).
//   Startwelt teilen: ein Link mit dem Seed der eigenen Welt, der Empfänger beginnt auf derselben Insel von vorn.
import { L } from '../i18n.js';
import * as D from '../sim/data.js';
import { createWorld, stepDay } from '../sim/core.js';
import { startEpidemic } from '../sim/lab.js';

const YEAR = 24;
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------- kleine IndexedDB Hülle ----------
function idb() {
  return new Promise((res, rej) => {
    if (!('indexedDB' in window)) return rej(new Error('kein IndexedDB'));
    const r = indexedDB.open('pfr', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('backup', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
const tx = async (mode, fn) => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('backup', mode), s = t.objectStore('backup'); const out = fn(s); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }); };

export const weekSeed = () => { const d = new Date(), y = d.getUTCFullYear(), s = Date.UTC(y, 0, 1), w = Math.floor((d - s) / 6048e5) + 1; return [y * 100 + w, w, y]; };

// Szenarien: setup baut die Lage, goal prüft Sieg oder Niederlage. st.scen = { id, d0, ... } steht im Spielstand.
export const SZENARIEN = [
  { id: 'aufbruch', seed: 4242, t: L('Der schnelle Aufbruch', 'The quick start'), d: L('Eine frische Insel. Führe dein Volk vor dem Jahr 30 in die Bronzezeit.', 'A fresh island. Lead your people into the Bronze Age before year 30.'),
    setup: () => ({}),
    goal: (st, sc) => { const era = Math.max(0, ...st.isles.map(i => i.era | 0)), y = Math.floor(st.day / YEAR) + 1; return { text: L('Bronzezeit vor dem Jahr 30', 'Bronze Age before year 30'), n: [Math.min(y, 30), 30], won: era >= 2 && y <= 30, lost: y > 30 && era < 2 }; } },
  { id: 'seuche', seed: 7, years: 70, t: L('Die Seuche', 'The plague'), d: L('Im größten Ort brechen die Pocken aus. Bringe ihn durch zwölf Jahre, ohne dass er die Hälfte seiner Menschen verliert.', 'Smallpox breaks out in the largest settlement. See it through twelve years without losing half of its people.'),
    setup: st => { const s = st.settlements.filter(o => o.alive).sort((a, b) => b.pop - a.pop)[0]; startEpidemic(st, s, 'pocken', { share: 0.08 }); return { s: s.id, pop: s.pop, name: s.name }; },
    goal: (st, sc) => { const s = st._rt.sById.get(sc.s), yrs = (st.day - sc.d0) / YEAR; const dead = !s || !s.alive || s.pop < sc.pop * 0.5; return { text: L(`${sc.name} übersteht die Seuche`, `${sc.name} survives the plague`), n: [Math.min(12, Math.floor(yrs)), 12], won: !dead && yrs >= 12, lost: dead }; } },
  { id: 'frieden', seed: 99, years: 160, t: L('Zwanzig Jahre Frieden', 'Twenty years of peace'), d: L('Eine Welt voller alter Feindschaften. Halte zwanzig Jahre lang jeden neuen Krieg fern.', 'A world full of old grudges. Keep every new war away for twenty years.'),
    setup: st => ({ wars: st.counts.wars | 0 }),
    goal: (st, sc) => { const yrs = (st.day - sc.d0) / YEAR, war = (st.counts.wars | 0) > sc.wars; return { text: L('20 Jahre ohne neuen Krieg', '20 years without a new war'), n: [Math.min(20, Math.floor(yrs)), 20], won: !war && yrs >= 20, lost: war }; } },
];
export const scenarioOf = st => (st && st.scen ? SZENARIEN.find(s => s.id === st.scen.id) : null);

export function initWelten(app, hooks) {
  const W = {};
  const KEYNAME = hooks.key;

  // ---------- Sicherungen ----------
  let lastBackup = 0;
  W.backup = async (json, why = '') => {
    try {
      const st = app.st; if (!st || !json) return;
      const id = KEYNAME + ':' + Date.now();
      await tx('readwrite', s => { s.put({ id, key: KEYNAME, t: Date.now(), why, jahr: Math.floor(st.day / YEAR) + 1, pop: st.people.length, orte: st.settlements.filter(o => o.alive).length, seed: st.seed, json }); });
      const all = (await W.list());
      for (const old of all.slice(6)) await tx('readwrite', s => { s.delete(old.id); });
      lastBackup = Date.now();
    } catch (e) { /* ohne IndexedDB gibt es keine Sicherungen, das Spiel läuft trotzdem */ }
  };
  W.list = async () => { try { const all = await tx('readonly', s => s.getAll()); return (all || []).filter(b => b.key === KEYNAME).sort((a, b) => b.t - a.t).map(b => ({ ...b })); } catch { return []; } };
  // vom Speichern aufgerufen: höchstens alle 8 Minuten
  app.backupTick = json => { if (Date.now() - lastBackup > 8 * 60000) { lastBackup = Date.now(); W.backup(json, 'auto'); } };
  W.restore = async id => { const b = (await W.list()).find(x => x.id === id); if (!b) return false; hooks.loadJson(b.json); return true; };
  W.openBackups = async () => {
    const list = await W.list();
    const when = t => new Date(t).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    app.ui.modal(`<h2>${L('Sicherungen', 'Backups')}</h2><p class="muted">${L('Das Spiel legt alle paar Minuten und vor jeder neuen Welt eine Sicherung im Browser an. Die letzten 6 bleiben.', 'The game keeps a backup in the browser every few minutes and before each new world. The latest 6 are kept.')}</p>
      <div class="bk-list">${list.map(b => `<button class="bk" data-id="${esc(b.id)}"><b>${L('Jahr', 'Year')} ${b.jahr} · ${b.pop} ${L('Menschen', 'people')} · ${b.orte} ${L('Orte', 'settlements')}</b><span>${when(b.t)}${b.why === 'vorher' ? ' · ' + L('vor neuer Welt', 'before new world') : ''}</span></button>`).join('') || `<p>${L('Noch keine Sicherung vorhanden.', 'No backup yet.')}</p>`}</div>`,
      [[L('Schließen', 'Close'), null], [L('Jetzt sichern', 'Back up now'), () => { W.backup(hooks.json(), 'hand').then(() => app.ui.toast(L('Gesichert.', 'Backed up.'))); }]]);
    document.querySelectorAll('.bk').forEach(b => { b.onclick = () => { const id = b.dataset.id; app.ui.modal(`<h2>${L('Diesen Stand zurückholen?', 'Restore this state?')}</h2><p>${L('Die jetzige Welt wird vorher gesichert und dann ersetzt.', 'The current world is backed up first and then replaced.')}</p>`, [[L('Zurückholen', 'Restore'), async () => { await W.backup(hooks.json(), 'vorher'); await W.restore(id); }], [L('Abbrechen', 'Cancel'), null]]); }; });
  };

  // ---------- neue Welt aus Seed, Szenario ----------
  W.startSeed = async (seed, scen) => {
    await W.backup(hooks.json(), 'vorher');
    const st = createWorld(seed >>> 0);
    if (scen) {
      const yrs = scen.years | 0;
      if (yrs) { app.ui.toast(L('Die Welt entsteht …', 'The world is forming …')); await new Promise(r => setTimeout(r, 60)); let t0 = performance.now(); for (let d = 0; d < yrs * YEAR; d++) { stepDay(st); if (performance.now() - t0 > 40) { await new Promise(r => setTimeout(r, 0)); t0 = performance.now(); } } st._rt.fx.length = 0; st._rt.newChron.length = 0; }
      st.scen = { id: scen.id, d0: st.day, ...scen.setup(st) };
    }
    hooks.setWorld(st, !scen);
    if (scen) app.ui.modal(`<h2>${esc(scen.t)}</h2><p>${esc(scen.d)}</p>`, [[L('Los', 'Begin'), null]]);
  };
  W.openScenarios = () => {
    const [ws, wk] = weekSeed();
    app.ui.modal(`<h2>${L('Szenarien', 'Scenarios')}</h2><p class="muted">${L('Eine fertige Startlage mit einer Aufgabe. Deine jetzige Welt wird vorher gesichert.', 'A ready-made start with a task. Your current world is backed up first.')}</p>
      <div class="bk-list">${SZENARIEN.map(s => `<button class="bk" data-s="${s.id}"><b>${esc(s.t)}</b><span>${esc(s.d)}</span></button>`).join('')}
      <button class="bk" data-s="woche"><b>${L(`Welt der Woche ${wk}`, `World of week ${wk}`)}</b><span>${L('Diese Woche beginnen alle Spieler auf derselben Insel. Vergleicht, wie weit euer Volk kommt.', 'This week every player starts on the same island. Compare how far your people get.')}</span></button></div>`,
      [[L('Schließen', 'Close'), null], [L('Ergebnis vergleichen', 'Compare results'), () => W.compare()]]);
    document.querySelectorAll('.bk[data-s]').forEach(b => { b.onclick = () => { document.querySelector('#modal').className = ''; const id = b.dataset.s; if (id === 'woche') W.startSeed(ws, null); else { const s = SZENARIEN.find(x => x.id === id); W.startSeed(s.seed, s); } }; });
  };
  W.shareLink = () => {
    const st = app.st; if (!st) return;
    const url = location.origin + location.pathname + '?seed=' + st.seed;
    const done = () => app.ui.toast(L('Link kopiert. Wer ihn öffnet, beginnt auf derselben Insel von vorn.', 'Link copied. Whoever opens it starts on the same island from the beginning.'));
    if (navigator.share) navigator.share({ title: 'Pray For Rain', text: L('Beginne auf meiner Insel:', 'Start on my island:'), url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt(L('Link:', 'Link:'), url));
    else prompt(L('Link:', 'Link:'), url);
  };
  // Vergleich ohne Server (26.11.2026): jede Welt ergibt einen kurzen Code mit Insel, Jahr, Menschen, Epoche, Orten und
  // gewirkten Kräften. Zwei Spieler tauschen ihre Codes (Nachricht, Chat) und sehen beide Welten nebeneinander.
  const sum = a => a.reduce((x, v, i) => (x * 31 + v * (i + 7)) % 1291, 17);
  W.resultCode = () => {
    const st = app.st; if (!st) return '';
    const v = [st.seed >>> 0, Math.floor(st.day / D.DAYS_PER_YEAR) + 1, st.people.length, Math.max(0, ...st.isles.map(i => i.era | 0)), st.settlements.filter(s => s.alive).length, st.counts.powers | 0];
    return 'PFR-' + v.concat(sum(v)).map(n => n.toString(36).toUpperCase()).join('-');
  };
  W.readCode = code => {
    const p = String(code || '').trim().toUpperCase().replace(/^PFR-/, '').split('-').map(x => parseInt(x, 36));
    if (p.length !== 7 || p.some(n => !Number.isFinite(n)) || sum(p.slice(0, 6)) !== p[6]) return null;
    return { seed: p[0], year: p[1], pop: p[2], era: p[3], towns: p[4], powers: p[5] };
  };
  W.compare = () => {
    const mine = W.readCode(W.resultCode()), code = W.resultCode();
    const row = (n, a, b, more = true) => `<tr><td>${n}</td><td class="${b != null && (more ? a > b : a < b) ? 'win' : ''}">${a}</td><td class="${b != null && (more ? b > a : b < a) ? 'win' : ''}">${b == null ? '' : b}</td></tr>`;
    const table = o => `<table class="cmp"><tr><th></th><th>${L('Du', 'You')}</th><th>${o ? L('Die andere Welt', 'The other world') : ''}</th></tr>
      ${row(L('Jahr', 'Year'), mine.year, o && o.year, false)}${row(L('Menschen', 'People'), mine.pop, o && o.pop)}${row(L('Epoche', 'Age'), D.ERAS[mine.era].name, o && (D.ERAS[o.era] || {}).name || (o ? o.era : null))}${row(L('Orte', 'Settlements'), mine.towns, o && o.towns)}${row(L('Gewirkte Kräfte', 'Powers used'), mine.powers, o && o.powers, false)}</table>
      ${o ? `<p class="muted">${o.seed === mine.seed ? L('Beide Welten begannen auf derselben Insel.', 'Both worlds began on the same island.') : L('Achtung: das ist eine andere Insel. Der Vergleich hinkt.', 'Note: that is a different island. The comparison is not quite fair.')}</p>` : ''}`;
    const draw = o => {
      app.ui.modal(`<h2>${L('Ergebnis vergleichen', 'Compare results')}</h2><p class="muted">${L('Schicke deinen Code an jemanden, der auf derselben Insel spielt, und füge seinen Code hier ein.', 'Send your code to someone playing on the same island and paste their code here.')}</p>
        <p><b class="cmp-code">${code}</b> <button class="ghost" id="cmpCopy">${L('Kopieren', 'Copy')}</button></p>
        <p><input id="cmpIn" placeholder="PFR-…" autocomplete="off" spellcheck="false"> <button id="cmpGo">${L('Vergleichen', 'Compare')}</button></p>${table(o)}`, [[L('Schließen', 'Close'), null]]);
      document.querySelector('#cmpCopy').onclick = () => { if (navigator.clipboard) navigator.clipboard.writeText(code).then(() => app.ui.toast(L('Code kopiert.', 'Code copied.')), () => {}); };
      document.querySelector('#cmpGo').onclick = () => { const r = W.readCode(document.querySelector('#cmpIn').value); if (!r) return app.ui.toast(L('Dieser Code ist nicht gültig.', 'That code is not valid.'), 'warn'); draw(r); };
    };
    draw(null);
  };
  app.welten = W;
  return W;
}
