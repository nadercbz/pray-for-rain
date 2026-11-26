// Kern, zweite Runde (26.11.2026): vier Dinge, die dem Wirken Gewicht geben.
//   1. Gunst (Glaube mit Risiko): erhörte Gebete und gute Taten heben sie, verhallte Gebete und Zerstörung senken sie.
//      Hohe Gunst lässt die Kraft schneller wachsen, tiefe Gunst bremst sie und ruft den Schatten.
//   2. Der Schatten (Rivale): ein zweiter Geist, der von Zeit zu Zeit nach einem Ort greift. Abwehren kostet Kraft.
//   3. Kräfte wachsen mit: oft gewirkte Kräfte steigen bis Stufe 3 und kosten weniger.
//   4. Träume aus Bildkarten: ein Traum wird aus ein oder zwei Bildern gelegt (das zweite wirkt halb).
// Gunst, Schatten und Stufen merkt sich der Browser je Welt (pfr.geist), nicht der Spielstand. Im Mehrspieler ruht alles,
// was die Welt verändert (Gunst auf die Kraft, Schatten, Rabatt), damit beide Seiten dasselbe rechnen.
import { L } from '../i18n.js';
import * as D from '../sim/data.js';

const YEAR = D.DAYS_PER_YEAR, KEY = 'pfr.geist';
const HARM = { sturm: 4, blitz: 3, beben: 9, vulkan: 12, flut: 10, meteor: 12, seuche: 12, schnee: 1 };
const GOOD = { segen: 3, heilung: 4, regenbogen: 2, fische: 2, funke: 2 };
const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const put = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
export const rivalOn = () => get('pfr.rival', '1') === '1';
export const setRival = v => put('pfr.rival', v ? '1' : '0');

// Stufe einer Kraft aus der Zahl der Anwendungen
export const levelOf = n => (n >= 12 ? 3 : n >= 4 ? 2 : 1);
const REBATE = [0, 0, 0.15, 0.3];

// Bilder für die Traumkarten (einfache Zeichen, damit keine neuen Bilddateien nötig sind)
const PIC = {
  frieden: '<path d="M8 30c8-2 14-8 16-18 6 4 10 10 9 18-6 5-17 6-25 0z M24 12c-2 6-1 12 3 18"/>',
  krieg: '<path d="M10 34l20-22 M30 12l3-5-5 3 M12 12l20 22 M12 12l-3-5 5 3 M17 30l-5 5 M27 30l5 5"/>',
  wissen: '<path d="M6 12c6-2 11-1 15 2v20c-4-3-9-4-15-2z M36 12c-6-2-11-1-15 2v20c4-3 9-4 15-2z"/>',
  glaube: '<path d="M21 6v8 M21 34V22 M9 34h24 M13 34V22l8-8 8 8v12"/><circle cx="21" cy="24" r="2.5"/>',
  freiheit: '<path d="M4 24c6-8 11-9 17-3 6-6 11-5 17 3-6-3-11-2-17 5-6-7-11-8-17-5z"/>',
  meer: '<path d="M4 16c4-4 8-4 12 0s8 4 12 0 8-4 10 0 M4 24c4-4 8-4 12 0s8 4 12 0 8-4 10 0 M4 32c4-4 8-4 12 0s8 4 12 0 8-4 10 0"/>',
  kunst: '<circle cx="21" cy="20" r="5"/><path d="M21 8c3 3 3 5 0 7-3-2-3-4 0-7z M21 32c3-3 3-5 0-7-3 2-3 4 0 7z M9 20c3-3 5-3 7 0-2 3-4 3-7 0z M33 20c-3-3-5-3-7 0 2 3 4 3 7 0z"/>',
  sterne: '<path d="M21 6l2.6 7.4H31l-6 4.6 2.3 7.4-6.3-4.6-6.3 4.6L17 18l-6-4.6h7.4z"/><circle cx="8" cy="30" r="1.2"/><circle cx="34" cy="31" r="1.2"/><circle cx="33" cy="9" r="1"/>',
};

export function initGeist(app, hooks) {
  const G = { seed: null, gunst: 55, uses: {}, seenAns: 0, seenUn: 0, nextRival: 0, blocked: 0, lastDay: 0, gift: 0, pending: null };
  const coop = () => !!(app.coop && (app.coop.joined || app.coop.host || app.coop.guest));
  const store = () => put(KEY, JSON.stringify({ seed: G.seed, gunst: G.gunst, uses: G.uses, seenAns: G.seenAns, seenUn: G.seenUn, nextRival: G.nextRival, blocked: G.blocked, gift: G.gift }));
  const unTotal = st => st.settlements.reduce((a, s) => a + (s.unansweredAll | 0), 0);
  const sync = () => {
    const st = app.st; if (!st || G.seed === st.seed) return;
    G.seed = st.seed;
    let d = null; try { d = JSON.parse(get(KEY, 'null')); } catch { /* egal */ }
    if (d && d.seed === st.seed) Object.assign(G, d);
    else Object.assign(G, { gunst: 55, uses: {}, seenAns: st.counts.answered | 0, seenUn: -1, nextRival: st.day + (6 + Math.random() * 4) * YEAR, blocked: 0, gift: 0 });
    G.lastDay = st.day; G.pending = null; G.unMap = null;
    hideCard();
  };
  const bump = (n, why) => {
    const v = Math.max(0, Math.min(100, G.gunst + n));
    if (Math.round(v) !== Math.round(G.gunst) && why && Math.abs(n) >= 3) app.ui && app.ui.toast((n > 0 ? '▲ ' : '▼ ') + L('Gunst', 'Favour') + ': ' + why, n > 0 ? 'god' : 'warn');
    G.gunst = v; store(); paint();
  };

  // ---------- Anzeige ----------
  const chip = document.createElement('div');
  chip.className = 'chip gunst'; chip.id = 'gunstChip';
  chip.innerHTML = `<b id="gunstN">55</b><span>${L('Gunst', 'Favour')}</span><i id="gunstBar"></i>`;
  const chips = document.querySelector('#top .chips');
  if (chips) chips.append(chip);
  const word = v => (v >= 80 ? L('Inbrunst', 'Fervour') : v >= 60 ? L('Vertrauen', 'Trust') : v >= 40 ? L('Erwartung', 'Expectation') : v >= 20 ? L('Zweifel', 'Doubt') : L('Abkehr', 'Estrangement'));
  const factor = v => (v - 50) / 100;   // -0,5 bis +0,5 auf den Zuwachs der Kraft
  function paint() {
    const v = Math.round(G.gunst);
    chip.querySelector('#gunstN').textContent = v;
    chip.querySelector('#gunstBar').style.width = v + '%';
    chip.dataset.k = v >= 60 ? 'hi' : v < 40 ? 'lo' : 'mid';
    const f = Math.round(factor(v) * 100);
    chip.title = L(`Gunst der Menschen: ${word(v)}. Deine Kraft wächst ${f >= 0 ? 'um ' + f + ' % schneller' : 'um ' + -f + ' % langsamer'}. Erhörte Gebete heben sie, verhallte Gebete und Zerstörung senken sie.`,
      `Favour of the people: ${word(v)}. Your power grows ${f >= 0 ? f + ' % faster' : -f + ' % slower'}. Answered prayers raise it, ignored prayers and destruction lower it.`);
  }
  chip.onclick = () => app.ui && app.ui.modal(`<small class="kicker">${L('Gunst der Menschen', 'Favour of the people')}</small><h2>${word(G.gunst)} · ${Math.round(G.gunst)}</h2><p>${chip.title}</p>
    <p class="muted">${L('Über 80 schenken dir die Menschen von Zeit zu Zeit zusätzliche Kraft. Unter 40 wird der Schatten dreister.', 'Above 80 the people grant you extra power from time to time. Below 40 the Shadow grows bolder.')}</p>
    <p class="muted">${L('Stufen deiner Kräfte: ', 'Levels of your powers: ')}${Object.keys(G.uses).filter(id => levelOf(G.uses[id]) > 1).map(id => `${D.POWER[id].name} ${levelOf(G.uses[id])}`).join(', ') || L('noch alle auf Stufe 1', 'all still at level 1')}</p>`);

  // ---------- 3. Kräfte wachsen mit ----------
  G.level = id => levelOf(G.uses[id] | 0);
  G.cost = id => { const P = D.POWER[id]; if (!P) return 0; sync(); return coop() ? P.cost : Math.round(P.cost * (1 - REBATE[G.level(id)])); };
  G.rebate = id => { const P = D.POWER[id]; return P ? P.cost - G.cost(id) : 0; };
  function badges() {
    document.querySelectorAll('#dock .card').forEach(c => {
      const lv = G.level(c.dataset.id);
      if (c.dataset.lv !== String(lv)) { c.dataset.lv = lv; let b = c.querySelector('.lv'); if (!b) { b = document.createElement('i'); b.className = 'lv'; c.append(b); } b.textContent = lv > 1 ? '★'.repeat(lv - 1) : ''; }
    });
  }

  // nach jeder eigenen Kraft (nicht für Kombinationen und nicht für den Schatten)
  G.onCast = id => {
    const st = app.st; if (!st) return;
    sync();
    const before = G.level(id);
    G.uses[id] = (G.uses[id] | 0) + 1;
    const lv = G.level(id);
    if (lv > before) { app.ui && app.ui.toast('★ ' + L(`${D.POWER[id].name} erreicht Stufe ${lv} und kostet jetzt ${Math.round(REBATE[lv] * 100)} % weniger.`, `${D.POWER[id].name} reaches level ${lv} and now costs ${Math.round(REBATE[lv] * 100)} % less.`), 'god'); app.sound && app.sound.goal && app.sound.goal(); }
    if (HARM[id]) bump(-HARM[id], L('die Menschen fürchten dich', 'the people fear you'));
    else if (GOOD[id]) bump(GOOD[id]);
    else store();
    badges();
  };

  // ---------- 2. Der Schatten ----------
  const card = document.createElement('div');
  card.id = 'schatten';
  document.body.append(card);
  let cardT = 0;
  function hideCard() { card.classList.remove('show'); clearTimeout(cardT); }
  const RIVAL = [['nebel', 0], ['schnee', 0], ['sturm', 1], ['blitz', 1], ['seuche', 3], ['beben', 3]];
  function strike() {
    const st = app.st, a = G.pending; G.pending = null; hideCard();
    if (!st || !a) return;
    const s = st._rt.sById.get(a.sid);
    const P = D.POWER[a.id];
    const tgt = P.target === 'settlement' ? { sid: a.sid, x: s && s.cx, y: s && s.cy } : P.target === 'point' ? { x: s ? s.cx + 2 : 0, y: s ? s.cy + 1 : 0 } : {};
    if ((P.target !== 'global' && (!s || !s.alive)) || !hooks.castFree(a.id, tgt, true)) return;
    st.counts.powers = Math.max(0, st.counts.powers - 1);   // zählt nicht als eigene Kraft
    app.ui && app.ui.toast(L(`Der Schatten schickt ${P.name} über ${a.name}.`, `The Shadow sends ${P.name} upon ${a.name}.`), 'warn');
    app.sound && app.sound.power && app.sound.power(a.id);
    bump(-3, L('du hast es geschehen lassen', 'you let it happen'));
  }
  function ward() {
    const st = app.st, a = G.pending; if (!st || !a) return;
    if (st.mana < a.cost) { app.ui && app.ui.toast(L('Dafür fehlt dir Kraft.', 'You lack the power for that.'), 'warn'); app.sound && app.sound.deny && app.sound.deny(); return; }
    st.mana -= a.cost; G.pending = null; hideCard(); G.blocked++;
    app.sound && app.sound.combo && app.sound.combo();
    bump(5, L(`${a.name} sah, wie du den Schatten vertrieben hast`, `${a.name} saw you drive the Shadow away`));
    if (G.blocked % 3 === 0) { G.nextRival = st.day + 10 * YEAR; store(); app.ui && app.ui.toast(L('Dreimal abgewehrt. Der Schatten zieht sich für lange Zeit zurück.', 'Warded off three times. The Shadow withdraws for a long while.'), 'god'); }
    app.ui && app.ui.update && app.ui.update(st, 0.5, true);
  }
  function rival(st) {
    const towns = st.settlements.filter(s => s.alive && s.pop > 4);
    const era = Math.max(0, ...st.isles.map(i => i.era | 0));
    G.nextRival = st.day + (3 + Math.random() * 3) * YEAR * (G.gunst < 40 ? 0.6 : 1); store();
    if (!towns.length) return;
    const s = towns[Math.floor(Math.random() * towns.length)];
    const pool = RIVAL.filter(r => r[1] <= era);
    const id = pool[Math.floor(Math.random() * pool.length)][0];
    const P = D.POWER[id], cost = Math.max(8, Math.round(P.cost * 0.5));
    G.pending = { id, sid: s.id, name: s.name, cost, until: performance.now() + 25000 };
    card.innerHTML = `<img src="assets/cards/${id}.webp" alt=""><div><small>${L('Der Schatten', 'The Shadow')}</small><b>${L(`Ein fremder Geist greift nach ${s.name}. Er will ${P.name} schicken.`, `A rival spirit reaches for ${s.name}. It wants to send ${P.name}.`)}</b>
      <div class="sb"><button class="ward">${L(`Abwehren (${cost} Kraft)`, `Ward off (${cost} power)`)}</button><button class="ghost let">${L('Geschehen lassen', 'Let it happen')}</button></div><i class="bar"></i></div>`;
    card.classList.add('show');
    card.querySelector('.ward').onclick = ward;
    card.querySelector('.let').onclick = strike;
    card.querySelector('img').onclick = () => app.focus && app.focus(s.cx, s.cy);
    app.sound && app.sound.deny && app.sound.deny();
    if (app.focus && !app.followId) app.focus(s.cx, s.cy);
    clearTimeout(cardT); cardT = setTimeout(strike, 25000);
  }

  // ---------- Takt ----------
  setInterval(() => {
    const st = app.st;
    if (!st || !app.running) return;
    sync(); badges();
    // Gebete: erhört oder verhallt
    const ans = st.counts.answered | 0;
    if (ans > G.seenAns) { bump((ans - G.seenAns) * 6, L('ein Gebet wurde erhört', 'a prayer was answered')); }
    G.seenAns = ans;
    const map = {}; let lost = 0;
    for (const s of st.settlements) { map[s.id] = s.unanswered | 0; if (G.unMap && map[s.id] > (G.unMap[s.id] | 0)) lost += map[s.id] - (G.unMap[s.id] | 0); }
    G.unMap = map;
    const days = Math.max(0, st.day - G.lastDay); G.lastDay = st.day;
    if (lost && days < 400) bump(-Math.min(12, lost * 4), L('ein Gebet verhallte', 'a prayer went unheard'));
    if (coop() || app.paused) { paint(); return; }
    // Gunst wirkt auf den Zuwachs der Kraft (höchstens 30 Tage auf einmal, sonst rechnet der Zeitraffer davon)
    const dd = Math.min(days, 30), max = D.ERAS[st.era].mana;
    if (dd > 0) st.mana = Math.max(0, Math.min(max, st.mana + (st.manaRate || 0) * factor(G.gunst) * dd));
    // langsam zur Mitte zurück
    if (days > 0) G.gunst += (50 - G.gunst) * Math.min(0.2, days / (12 * YEAR));
    // Geschenk bei Inbrunst
    if (G.gunst >= 80 && st.day > G.gift + 4 * YEAR && st.mana < max * 0.7 && (app.speed || 1) < 100) {
      G.gift = st.day; st.mana = Math.min(max, st.mana + 25); store();
      app.ui && app.ui.toast('✦ ' + L('Die Menschen feiern dich. Ihre Inbrunst schenkt dir 25 Kraft.', 'The people celebrate you. Their fervour grants you 25 power.'), 'god');
    }
    paint();
    // der Schatten: nur wenn man zusehen und antworten kann
    if (!rivalOn() || G.pending || st.level) return;
    if (st.day < G.nextRival) return;
    if ((app.speed || 1) >= 100 || document.querySelector('#tourTip.show, #modal.show, #heroPick.show, #trailer, #storyAsk, #epoche.show') || document.body.classList.contains('foto') || st.day < 5 * YEAR) { if (st.day > G.nextRival + 2 * YEAR) { G.nextRival = st.day + YEAR; store(); } return; }
    rival(st);
  }, 2000);
  setInterval(() => { const a = G.pending; if (!a) return; const b = card.querySelector('.bar'); if (b) b.style.width = Math.max(0, (a.until - performance.now()) / 250) + '%'; }, 200);

  G.testRival = () => { sync(); if (app.st) rival(app.st); };
  G.bump = bump;
  app.geist = G;
  sync(); paint();
  return G;
}

// ---------- 4. Träume aus Bildkarten ----------
// cb(thema, zweitesThema) oder cb(null) bei Abbruch
export function dreamCards(cb) {
  const m = document.querySelector('#modal');
  const sel = [];
  const draw = () => {
    m.innerHTML = `<div class="mbox dream"><h2>${L('Lege den Traum', 'Lay out the dream')}</h2><p>${L('Wähle ein Bild. Ein zweites Bild färbt den Traum mit halber Kraft.', 'Choose a picture. A second picture tints the dream at half strength.')}</p>
      <div class="dcards">${Object.entries(D.DREAMS).map(([k, d]) => `<button data-k="${k}" class="${sel[0] === k ? 'a' : sel[1] === k ? 'b' : ''}"><svg viewBox="0 0 42 42">${PIC[k] || ''}</svg><span>${d.name}</span>${sel[0] === k ? '<i>1</i>' : sel[1] === k ? '<i>2</i>' : ''}</button>`).join('')}</div>
      <p class="dsum">${sel.length ? L('Traum von ', 'A dream of ') + sel.map(k => D.DREAMS[k].name).join(L(' und ', ' and ')) : '&nbsp;'}</p>
      <div class="mbtns"><button class="go" ${sel.length ? '' : 'disabled'}>${L('Traum senden', 'Send the dream')}</button><button class="ghost cancel">${L('Abbrechen', 'Cancel')}</button></div></div>`;
    m.className = 'show';
    m.querySelectorAll('.dcards button').forEach(b => { b.onclick = () => { const k = b.dataset.k, i = sel.indexOf(k); if (i >= 0) sel.splice(i, 1); else { if (sel.length >= 2) sel.pop(); sel.push(k); } draw(); }; });
    m.querySelector('.go').onclick = () => { m.className = ''; cb(sel[0], sel[1] || null); };
    m.querySelector('.cancel').onclick = () => { m.className = ''; cb(null); };
  };
  draw();
}
