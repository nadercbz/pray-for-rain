// Kern des Spiels (seit 26.11.2026, Naders Auftrag "alles umsetzen"): drei Dinge, die aus der Simulation ein Spiel machen,
// in dem die eigenen Eingriffe zählen.
//   1. Echo: Jahre nach einer Kraft erzählt eine Karte, was daraus geworden ist (Mythos, Wachstum, neue Epoche, Untergang).
//   2. Kombinationen: zwei passende Kräfte kurz nacheinander lösen eine dritte Wirkung aus, die nichts kostet.
//   3. Freischalten: am Anfang gibt es wenige Kräfte, die übrigen kommen mit dem Wirken und den Epochen dazu.
// Nichts davon steht im Spielstand der Simulation: das Echo merkt sich der Browser je Welt (pfr.echo), die freien Kräfte
// ergeben sich aus dem Stand selbst (Zahl der gewirkten Kräfte, erhörte Gebete, Epoche). So bleibt die Welt deterministisch.
import { L } from '../i18n.js';
import * as D from '../sim/data.js';

const YEAR = D.DAYS_PER_YEAR;
const eraOf = st => Math.max(0, ...st.isles.map(i => i.era | 0));

// ---------- 3. Freischalten ----------
// Stufe: [Bedingung, Kräfte]. Die erste Stufe ist immer frei.
const STUFEN = [
  [() => true, ['regen', 'sonne', 'traum', 'segen'], ''],
  [st => (st.counts.powers | 0) >= 1, ['nebel', 'fische'], L('Wirke deine erste Kraft', 'Use your first power')],
  [st => (st.counts.answered | 0) >= 1, ['regenbogen', 'heilung'], L('Erhöre ein Gebet', 'Answer a prayer')],
  [st => eraOf(st) >= 1 || (st.counts.powers | 0) >= 5, ['blitz', 'schnee', 'funke'], L('Dorfzeit oder 5 gewirkte Kräfte', 'Village Age or 5 powers used')],
  [st => eraOf(st) >= 2 || (st.counts.powers | 0) >= 10, ['sturm', 'komet', 'fremde'], L('Bronzezeit oder 10 gewirkte Kräfte', 'Bronze Age or 10 powers used')],
  [st => eraOf(st) >= 3 || (st.counts.powers | 0) >= 16, ['beben', 'flut', 'seuche'], L('Stadtstaaten oder 16 gewirkte Kräfte', 'City States or 16 powers used')],
  [st => eraOf(st) >= 4 || (st.counts.powers | 0) >= 24, ['vulkan', 'meteor'], L('Königreiche oder 24 gewirkte Kräfte', 'Kingdoms or 24 powers used')],
];
const NEED = {};
for (const [, ids, why] of STUFEN) for (const id of ids) NEED[id] = why;
export const allFree = () => { try { return localStorage.getItem('pfr.unlockAll') === '1'; } catch { return false; } };
export function setAllFree(v) { try { localStorage.setItem('pfr.unlockAll', v ? '1' : '0'); } catch { /* egal */ } }
// alte, weit entwickelte Welten und eigene Level haben alles
const veteran = st => !!st.level || st.day > 30 * YEAR || (st.counts.powers | 0) >= 30;
export function unlocked(st) {
  const out = new Set();
  const all = !st || allFree() || veteran(st);
  for (const [ok, ids] of STUFEN) if (all || ok(st)) for (const id of ids) out.add(id);
  for (const id of Object.keys(D.POWER)) if (all || !(id in NEED)) out.add(id); // Kräfte ohne Stufe sind immer frei
  return out;
}
export const needFor = id => NEED[id] || '';

// ---------- 2. Kombinationen ----------
// [erste, zweite] in beliebiger Reihenfolge, innerhalb von 3 Spieltagen und 40 Sekunden
const KOMBI = [
  { a: 'regen', b: 'sonne', id: 'regenbogen', t: L('Regen und Sonne: ein Regenbogen steht über der Welt.', 'Rain and sun: a rainbow rises over the world.') },
  { a: 'schnee', b: 'sonne', id: 'segen', where: 'ort', t: L('Schnee und Sonne: Schmelzwasser tränkt die Felder, die Erde ist gesegnet.', 'Snow and sun: meltwater soaks the fields, the earth is blessed.') },
  { a: 'sturm', b: 'blitz', id: 'blitz', where: 'punkt', n: 2, t: L('Sturm und Blitz: ein Gewitter entlädt sich, es schlägt mehrfach ein.', 'Storm and lightning: a thunderstorm breaks, striking again and again.') },
  { a: 'nebel', b: 'traum', id: 'funke', where: 'traum', t: L('Nebel und Traum: der ganze Ort teilt eine Vision.', 'Fog and dream: the whole settlement shares one vision.') },
  { a: 'regen', b: 'segen', id: 'fische', where: 'punkt', t: L('Regen und Segen: die Bäche schwellen an, die Fische kehren zurück.', 'Rain and blessing: the streams swell and the fish return.') },
  { a: 'komet', b: 'traum', id: 'funke', where: 'traum', t: L('Komet und Traum: das Zeichen am Himmel wird zur Erkenntnis.', 'Comet and dream: the sign in the sky becomes insight.') },
];
export const KOMBI_TEXT = () => KOMBI.map(k => `${D.POWER[k.a].name} + ${D.POWER[k.b].name}`);

// ---------- 1. Echo ----------
const KEY = 'pfr.echo';
export function initKern(app, hooks) {
  const K = { last: [], echo: [], seed: null, shownAt: 0, known: null };
  const load = () => { K.echo = []; try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d && d.seed === app.st.seed) K.echo = d.list || []; } catch { /* egal */ } };
  const store = () => { try { localStorage.setItem(KEY, JSON.stringify({ seed: app.st.seed, list: K.echo.slice(-40) })); } catch { /* egal */ } };
  const near = (st, x, y) => { let best = null, bd = 1e9; for (const s of st.settlements) { if (!s.alive) continue; const d = Math.hypot(s.cx - x, s.cy - y); if (d < bd) { bd = d; best = s; } } return best; };
  const sync = () => { if (app.st && K.seed !== app.st.seed) { K.seed = app.st.seed; load(); K.last = []; K.known = null; } };

  // nach jeder eigenen Kraft: merken fürs Echo und Kombination prüfen. tgt: { x, y, sid, pid }, view: Ort unter dem Blick
  K.onCast = (id, tgt = {}, viewTile) => {
    const st = app.st; if (!st) return;
    sync();
    const rt = st._rt;
    let s = tgt.sid ? rt.sById.get(tgt.sid) : null;
    if (!s && tgt.pid) { const p = rt.pById.get(tgt.pid); if (p) s = rt.sById.get(p.s); }
    if (!s && tgt.x != null) s = near(st, tgt.x, tgt.y);
    if (!s && viewTile) s = near(st, viewTile[0], viewTile[1]);
    if (s && !K.inCombo) {
      K.echo.push({ id, d: st.day, s: s.id, name: s.name, pop: s.pop | 0, era: s.era | 0, myths: st.myths.filter(m => m.s === s.id).length, done: 0 });
      store();
    }
    if (K.inCombo) return;
    // Kombination
    const now = performance.now();
    K.last = K.last.filter(c => now - c.t < 40000 && st.day - c.d <= 3);
    const mate = K.last.find(c => KOMBI.some(k => (k.a === c.id && k.b === id) || (k.b === c.id && k.a === id)));
    K.last.push({ id, t: now, d: st.day, tgt, s: s ? s.id : 0 });
    if (!mate) return;
    const k = KOMBI.find(q => (q.a === mate.id && q.b === id) || (q.b === mate.id && q.a === id));
    K.last = [];
    // Ziel der dritten Wirkung
    const P = D.POWER[k.id];
    let list = [{}];
    const home = s || (mate.s ? rt.sById.get(mate.s) : null) || (viewTile ? near(st, viewTile[0], viewTile[1]) : null);
    if (P.target === 'settlement') { if (!home) return; list = [{ sid: home.id, x: home.cx, y: home.cy }]; }
    else if (P.target === 'point') {
      const p0 = tgt.x != null ? tgt : mate.tgt.x != null ? mate.tgt : home ? { x: home.cx, y: home.cy } : null;
      if (!p0) return;
      list = [];
      for (let i = 0; i < (k.n || 1); i++) list.push({ x: Math.round(p0.x + (i ? (Math.random() - 0.5) * 7 : 0)), y: Math.round(p0.y + (i ? (Math.random() - 0.5) * 7 : 0)) });
    }
    setTimeout(() => {
      K.inCombo = true;
      let any = false;
      try { for (const t of list) any = hooks.castFree(k.id, t) || any; } finally { K.inCombo = false; }
      if (any) { app.ui && app.ui.toast('✦ ' + L('Kombination', 'Combination') + ': ' + k.t, 'god'); app.sound && app.sound.combo && app.sound.combo(); }
    }, 900);
  };

  // Echo zeigen
  const card = document.createElement('button');
  card.id = 'echoCard'; card.setAttribute('aria-live', 'polite');
  document.body.append(card);
  let hideT = 0;
  const show = (e, lines) => {
    const P = D.POWER[e.id], yrs = Math.round((app.st.day - e.d) / YEAR);
    card.innerHTML = `<img src="assets/cards/${e.id}.webp" alt=""><span class="ek">${L('Echo deiner Kraft', 'Echo of your power')}</span><b>${L(`${P.name} in ${e.name}, vor ${yrs} ${yrs === 1 ? 'Jahr' : 'Jahren'}`, `${P.name} in ${e.name}, ${yrs} ${yrs === 1 ? 'year' : 'years'} ago`)}</b><span class="et">${lines.join(' ')}</span>`;
    card.classList.add('show');
    card.onclick = () => { const s = app.st._rt.sById.get(e.s); if (s && app.focus) app.focus(s.cx, s.cy); card.classList.remove('show'); };
    clearTimeout(hideT); hideT = setTimeout(() => card.classList.remove('show'), 14000);
    app.sound && app.sound.openSnd && app.sound.openSnd();
    K.log = (K.log || []).concat([{ e, lines }]).slice(-20);
  };
  const tell = (st, e) => {
    const s = st._rt.sById.get(e.s), out = [];
    const myths = st.myths.filter(m => m.s === e.s && m.d >= e.d && m.d - e.d < 2 * YEAR);
    if (myths.length) out.push(L(`Daraus wurde der Mythos „${myths[0].name}“.`, `It became the myth “${myths[0].name}”.`));
    if (!s || !s.alive) { out.push(L(`${e.name} gibt es nicht mehr. Der Ort wurde verlassen.`, `${e.name} is no more. The place was abandoned.`)); return out; }
    const d = (s.pop | 0) - e.pop;
    if (d >= Math.max(6, e.pop * 0.3)) out.push(L(`Der Ort ist seither von ${e.pop} auf ${s.pop} Menschen gewachsen.`, `The place has since grown from ${e.pop} to ${s.pop} people.`));
    else if (d <= -Math.max(6, e.pop * 0.3)) out.push(L(`Der Ort ist seither von ${e.pop} auf ${s.pop} Menschen geschrumpft.`, `The place has since shrunk from ${e.pop} to ${s.pop} people.`));
    if ((s.era | 0) > e.era) out.push(L(`Die Menschen dort leben heute in der Epoche ${D.ERAS[s.era | 0].name}.`, `Its people now live in the ${D.ERAS[s.era | 0].name}.`));
    const ev = st.chronicle.filter(c => c.s === e.s && c.d > e.d && c.imp >= 1 && c.k !== 'mythos').slice(-1)[0];
    if (ev && out.length < 2) out.push(L('Zuletzt: ', 'Most recently: ') + ev.t);
    return out;
  };
  setInterval(() => {
    const st = app.st;
    if (!st || !app.running || app.paused) return;
    sync();
    // neu freigeschaltete Kräfte melden
    const u = unlocked(st);
    if (K.known && u.size > K.known.size) {
      const neu = [...u].filter(id => !K.known.has(id));
      if (neu.length && neu.length < 8) { app.ui && app.ui.toast('✦ ' + L(`Neue ${neu.length === 1 ? 'Kraft' : 'Kräfte'}: `, `New ${neu.length === 1 ? 'power' : 'powers'}: `) + neu.map(id => D.POWER[id].name).join(', '), 'god'); app.sound && app.sound.goal && app.sound.goal(); }
      app.ui && app.ui.updateCards && app.ui.updateCards();
    }
    K.known = u;
    if (document.querySelector('#tourTip.show, #modal.show, #heroPick.show, #trailer, #storyAsk') || performance.now() - K.shownAt < 45000) return;
    for (const e of K.echo) {
      if (e.done) continue;
      const age = st.day - e.d;
      if (age < 1.5 * YEAR) continue;
      const lines = tell(st, e);
      const big = lines.some(l => /Mythos|myth|verlassen|abandoned/.test(l));
      if (!big && age < 6 * YEAR) continue;           // ohne Mythos erst nach sechs Jahren
      e.done = 1; store();
      if (!lines.length || age > 40 * YEAR) continue;   // nichts Erzählenswertes oder viel zu lange her (Zeitraffer)
      K.shownAt = performance.now();
      show(e, lines);
      break;
    }
  }, 4000);
  const eb = document.createElement('div');
  eb.id = 'epoche';
  document.body.append(eb);
  function epoch(st, era) {
    const E = D.ERAS[era]; if (!E) return;
    const town = st.settlements.filter(o => o.alive).sort((a, b) => b.pop - a.pop)[0];
    eb.innerHTML = `<div class="ep-art" style="background-image:url(assets/eras/era${era}.webp)"></div><div class="ep-txt"><small>${L('Eine neue Epoche beginnt', 'A new age begins')}</small><h2>${E.name}</h2><p>${L(`Jahr ${Math.floor(st.day / YEAR) + 1}`, `Year ${Math.floor(st.day / YEAR) + 1}`)}${town ? ' · ' + town.name : ''}</p></div>`;
    eb.classList.add('show');
    app.sound && app.sound.goal && app.sound.goal();
    if (town && app.focus) setTimeout(() => app.focus(town.cx, town.cy, 26), 900);
    const end = () => eb.classList.remove('show');
    eb.onclick = end; setTimeout(end, 5000);
  }
  K.epoch = epoch;
  app.kern = K;
  return K;
}
