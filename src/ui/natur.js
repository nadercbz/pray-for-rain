// Naturereignisse mit Vorzeichen (26.11.2026). Die Welt hatte bisher nur Wetter und Feuer von selbst. Jetzt kündigt
// sich alle paar Jahre etwas an: erst ein Vorzeichen (Karte, Bildrand, Ton), eine halbe Minute später das Ereignis.
// Wer die Menschen warnt (kostet Kraft), mildert es: das Beben trifft neben dem Ort, die Seuche bleibt aus, nach Sturm
// und hartem Winter liegt ein Segen auf dem Ort. Läuft nur, wenn man zusehen kann (unter 100 fach), nie im Mehrspieler.
// Merkt sich der Browser je Welt (pfr.natur), nicht der Spielstand.
import { L } from '../i18n.js';
import * as D from '../sim/data.js';

const YEAR = D.DAYS_PER_YEAR, KEY = 'pfr.natur', WAIT = 30000;
const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const put = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
export const naturOn = () => get('pfr.naturOn', '1') === '1';

// id: Kraft, die das Ereignis ausführt. era: ab welcher Epoche. w: Gewicht. season: nur in diesen Jahreszeiten.
const EVENTS = [
  { id: 'sturm', era: 0, w: 4, name: L('Sturm', 'Storm'), omen: s => L(`Die Vögel über ${s.name} fliegen tief und verstummen. Das Meer ist seltsam glatt.`, `The birds over ${s.name} fly low and fall silent. The sea lies strangely flat.`) },
  { id: 'schnee', era: 0, w: 3, season: [2, 3], name: L('Harter Winter', 'Hard winter'), omen: s => L(`Die Tiere um ${s.name} tragen früh ihr dickes Fell. Die Zugvögel sind schon fort.`, `The animals around ${s.name} grow their thick coats early. The birds of passage have already gone.`) },
  { id: 'blitz', era: 0, w: 3, season: [1, 2], name: L('Trockengewitter', 'Dry thunderstorm'), omen: s => L(`Schwüle liegt über ${s.name}. Am Horizont wetterleuchtet es ohne einen Tropfen Regen.`, `Sultry air hangs over ${s.name}. Heat lightning flickers on the horizon without a drop of rain.`) },
  { id: 'beben', era: 1, w: 2, name: L('Erdbeben', 'Earthquake'), omen: s => L(`Die Hunde in ${s.name} heulen die ganze Nacht. Das Wasser im Brunnen ist trüb.`, `The dogs of ${s.name} howl all night. The water in the well has turned cloudy.`) },
  { id: 'seuche', era: 2, w: 2, name: L('Seuche', 'Plague'), omen: s => L(`In ${s.name} liegen tote Ratten in den Gassen. Ein Kind hat Fieber.`, `Dead rats lie in the lanes of ${s.name}. A child runs a fever.`) },
  { id: 'meteor', era: 0, w: 0.6, name: L('Sternenfall', 'Falling star'), omen: s => L(`Ein neuer Stern steht über ${s.name}. Jede Nacht ist er größer.`, `A new star stands over ${s.name}. Each night it is larger.`) },
];

export function initNatur(app, hooks) {
  const N = { seed: null, next: 0, pending: null };
  const coop = () => !!(app.coop && (app.coop.joined || app.coop.host || app.coop.guest));
  const store = () => put(KEY, JSON.stringify({ seed: N.seed, next: N.next }));
  const card = document.createElement('div');
  card.id = 'omen';
  document.body.append(card);
  let T = 0;
  const hide = () => { card.classList.remove('show'); document.body.classList.remove('omen'); clearTimeout(T); };
  const sync = () => {
    const st = app.st; if (!st || N.seed === st.seed) return;
    N.seed = st.seed; N.pending = null; hide();
    let d = null; try { d = JSON.parse(get(KEY, 'null')); } catch { /* egal */ }
    N.next = d && d.seed === st.seed ? d.next : st.day + (3 + Math.random() * 3) * YEAR;
  };

  function strike() {
    const st = app.st, a = N.pending; N.pending = null; hide();
    if (!st || !a) return;
    const s = st._rt.sById.get(a.sid);
    if (!s || !s.alive) return;
    const P = D.POWER[a.id];
    if (a.id === 'seuche' && a.warned) { app.ui && app.ui.toast(L(`${s.name} war gewarnt. Die Kranken wurden rechtzeitig gepflegt, die Seuche bleibt aus.`, `${s.name} was warned. The sick were cared for in time and the plague never came.`), 'god'); return; }
    const off = a.warned ? 9 : a.id === 'meteor' ? 7 : 2;
    const ang = Math.random() * Math.PI * 2;
    const tgt = P.target === 'settlement' ? { sid: s.id, x: s.cx, y: s.cy } : P.target === 'point' ? { x: Math.round(s.cx + Math.cos(ang) * off), y: Math.round(s.cy + Math.sin(ang) * off) } : {};
    if (!hooks.castFree(a.id, tgt, true)) return;
    st.counts.powers = Math.max(0, st.counts.powers - 1);   // die Natur zählt nicht als eigene Kraft
    app.sound && app.sound.power && app.sound.power(a.id);
    if (a.warned) {
      if (P.target === 'global') hooks.castFree('segen', { x: s.cx, y: s.cy }, true) && (st.counts.powers = Math.max(0, st.counts.powers - 1));
      app.ui && app.ui.toast(L(`${a.name} über ${s.name}. Die Menschen waren gewarnt und haben sich vorbereitet.`, `${a.name} over ${s.name}. The people had been warned and were prepared.`), 'god');
    } else app.ui && app.ui.toast(L(`${a.name} über ${s.name}. Niemand war vorbereitet.`, `${a.name} over ${s.name}. Nobody was prepared.`), 'warn');
  }
  function warn() {
    const st = app.st, a = N.pending; if (!st || !a || a.warned) return;
    if (st.mana < a.cost) { app.ui && app.ui.toast(L('Dafür fehlt dir Kraft.', 'You lack the power for that.'), 'warn'); app.sound && app.sound.deny && app.sound.deny(); return; }
    st.mana -= a.cost; a.warned = true;
    app.sound && app.sound.combo && app.sound.combo();
    app.geist && app.geist.bump(4, L('du hast die Menschen gewarnt', 'you warned the people'));
    card.querySelector('.sb').innerHTML = `<em>${L('Ein Traum hat die Menschen gewarnt. Sie bereiten sich vor.', 'A dream has warned the people. They are getting ready.')}</em>`;
    app.ui && app.ui.update && app.ui.update(st, 0.5, true);
  }
  function omen(st) {
    N.next = st.day + (4 + Math.random() * 4) * YEAR; store();
    const towns = st.settlements.filter(s => s.alive && s.pop > 4);
    if (!towns.length) return;
    const s = towns[Math.floor(Math.random() * towns.length)];
    const era = Math.max(0, ...st.isles.map(i => i.era | 0));
    const season = Math.floor((st.day % YEAR) / D.DAYS_PER_SEASON);
    const pool = EVENTS.filter(e => e.era <= era && (!e.season || e.season.includes(season)));
    let r = Math.random() * pool.reduce((x, e) => x + e.w, 0), E = pool[0];
    for (const e of pool) { r -= e.w; if (r <= 0) { E = e; break; } }
    const cost = 10;
    N.pending = { id: E.id, name: E.name, sid: s.id, cost, until: performance.now() + WAIT, warned: false };
    card.innerHTML = `<small>${L('Ein Vorzeichen', 'An omen')}</small><b>${E.omen(s)}</b><p>${L(`Die Alten fürchten: ${E.name}.`, `The elders fear: ${E.name}.`)}</p>
      <div class="sb"><button class="warn">${L(`Im Traum warnen (${cost} Kraft)`, `Warn in a dream (${cost} power)`)}</button><button class="ghost look">${L('Hinsehen', 'Look')}</button></div><i class="bar"></i>`;
    card.classList.add('show'); document.body.classList.add('omen');
    card.querySelector('.warn').onclick = warn;
    card.querySelector('.look').onclick = () => app.focus && app.focus(s.cx, s.cy);
    app.sound && app.sound.openSnd && app.sound.openSnd();
    clearTimeout(T); T = setTimeout(strike, WAIT);
  }

  setInterval(() => {
    const st = app.st;
    if (!st || !app.running) return;
    sync();
    if (N.pending) { const b = card.querySelector('.bar'); if (b) b.style.width = Math.max(0, (N.pending.until - performance.now()) / WAIT * 100) + '%'; return; }
    if (!naturOn() || coop() || app.paused || st.level || st.day < N.next) return;
    if ((app.speed || 1) >= 100 || st.day < 3 * YEAR || (app.geist && app.geist.pending) || document.querySelector('#tourTip.show, #modal.show, #heroPick.show, #trailer, #storyAsk, #epoche.show') || document.body.classList.contains('foto')) { if (st.day > N.next + 2 * YEAR) { N.next = st.day + YEAR; store(); } return; }
    omen(st);
  }, 1000);
  N.test = () => { sync(); if (app.st) omen(app.st); };
  N.strike = strike;
  app.natur = N;
  return N;
}
