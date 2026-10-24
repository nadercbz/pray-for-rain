// Tutorial (Fassung 2, 20.10.2026, Naders Wunsch: einfach, von Anfang an, Schritt für Schritt die Mechaniken kennenlernen,
// wenig Text, nicht überhäufen, damit man versteht, worum es geht). Lernen durch Tun: jede Station sagt einen Satz
// (Stimme tt_*), zeigt eine kurze Zeile und wartet, bis der Spieler es selbst getan hat. Nichts wird abgedunkelt,
// die Welt bleibt bedienbar, ein Lichtrahmen zeigt, wo es weitergeht.
// Reihenfolge: Ziel, umsehen, einen Menschen antippen, Kraft, Regen schicken, Zeichen, ein Gebet erhören (das Tutorial legt
// eins hin), erhört, Traum senden, Zeit schneller, Inselbuch, fertig. Danach beim Spielen drei kurze Tipps
// (dein Mensch, Geistmodus, Karte). Fortschritt in localStorage 'pfr.tour' je Welt (Seed), aus mit 'pfr.tourOff'.
import { L } from '../i18n.js';
import { say, stopVoice, speaking } from './voice.js';
import * as D from '../sim/data.js';

const KEY = 'pfr.tour', OFF = 'pfr.tourOff';
const ICON = {
  fire: '<svg viewBox="0 0 64 64"><path d="M32 8c6 10 14 16 14 28a14 14 0 0 1-28 0c0-7 4-11 7-15 1 5 3 7 6 8-2-8 0-15 1-21z"/><path d="M14 56h36"/></svg>',
  mouse: '<svg viewBox="0 0 64 64"><rect x="20" y="10" width="24" height="40" rx="12"/><path d="M32 10v12 M8 30h6 M50 30h6 M11 24l-4 6 4 6 M53 24l4 6-4 6"/></svg>',
  hand: '<svg viewBox="0 0 64 64"><path d="M26 34V14a4 4 0 0 1 8 0v16 M34 28v-4a4 4 0 0 1 8 0v8 M42 30a4 4 0 0 1 8 0v8c0 10-6 18-16 18s-14-6-18-14l-4-8a4 4 0 0 1 7-4l5 6"/></svg>',
  person: '<svg viewBox="0 0 64 64"><circle cx="32" cy="20" r="9"/><path d="M14 54c2-11 9-17 18-17s16 6 18 17 M32 37v17"/></svg>',
  ring: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="22" class="tr"/><circle cx="32" cy="32" r="22" class="fl"/></svg>',
  rain: '<svg viewBox="0 0 64 64"><path d="M18 34a10 10 0 0 1 2-20 14 14 0 0 1 26 2 9 9 0 0 1 0 18z M22 42l-3 8 M32 42l-3 8 M42 42l-3 8"/></svg>',
  spark: '<svg viewBox="0 0 64 64"><path d="M32 8v12 M32 44v12 M8 32h12 M44 32h12 M15 15l8 8 M41 41l8 8 M49 15l-8 8 M23 41l-8 8"/></svg>',
  pray: '<svg viewBox="0 0 64 64"><path d="M32 54V22c0-6-6-10-6-10l-8 22 6 20 M32 54V22c0-6 6-10 6-10l8 22-6 20"/></svg>',
  faith: '<svg viewBox="0 0 64 64"><path d="M32 8c6 10 14 16 14 28a14 14 0 0 1-28 0c0-7 4-11 7-15 1 5 3 7 6 8-2-8 0-15 1-21z"/></svg>',
  moon: '<svg viewBox="0 0 64 64"><path d="M40 10a22 22 0 1 0 14 34A18 18 0 0 1 40 10z M48 14l2 4 4 2-4 2-2 4-2-4-4-2 4-2z"/></svg>',
  speed: '<svg viewBox="0 0 64 64"><path d="M10 16l18 16-18 16z M32 16l18 16-18 16z"/></svg>',
  book: '<svg viewBox="0 0 64 64"><path d="M10 14c8-3 15-3 22 2v36c-7-5-14-5-22-2z M54 14c-8-3-15-3-22 2v36c7-5 14-5 22-2z"/></svg>',
  star: '<svg viewBox="0 0 64 64"><path d="M32 8l7 15 16 2-12 11 3 16-14-8-14 8 3-16L9 25l16-2z"/></svg>',
  ghost: '<svg viewBox="0 0 64 64"><path d="M16 54V30a16 16 0 0 1 32 0v24l-5-4-5 4-6-4-6 4-5-4z M26 30h.01 M38 30h.01"/></svg>',
  map: '<svg viewBox="0 0 64 64"><path d="M8 16l16-6 16 6 16-6v38l-16 6-16-6-16 6z M24 10v38 M40 16v38"/></svg>',
};
const touch = () => document.body.classList.contains('touch');

// ---------- Helfer für die Stationen ----------
// Genug Kraft für die Karte, die gleich geübt wird (ein kleines Geschenk im Tutorial)
function topUp(app, id) { const P = D.POWER[id]; if (P && app.st.mana < P.cost + 2) app.st.mana = P.cost + 2; }
// Stapel unten aufschlagen (wetter, erde, geist)
function openDeck(app, cat) {
  const ui = app.ui;
  if (!ui || ui.cat === cat) return;
  ui.cat = cat;
  const keys = Object.keys(D.POWER_CATS);
  document.querySelectorAll('#dock .dtab').forEach((b, i) => b.classList.toggle('on', keys[i] === cat));
  ui.renderCards();
}
// Personenkarte schließen, damit am Handy die Karten unten wieder zu sehen sind
function closeCard(app) { if (app.ui && app.ui.inspect) app.ui.closeInspector(); }
// Der Ort deines Menschen, sonst der größte
function homeTown(st) {
  const hp = st.hero && !st.hero.end ? st._rt.pById.get(st.hero.id) : null;
  const s = hp && st._rt.sById.get(hp.s);
  return s && s.alive ? s : st.settlements.filter(o => o.alive && o.pop).sort((a, b) => b.pop - a.pop)[0];
}
// Ein Gebet um Sonne hinlegen, das man gleich erhören kann (falls nicht schon eins offen ist)
function layPrayer(app) {
  const st = app.st;
  if (S.prayId && st.prayers.some(p => p.id === S.prayId)) return;
  const s = homeTown(st);
  if (!s) return;
  const pool = st.people.filter(p => p.s === s.id && st.day - p.b > 18 * D.DAYS_PER_YEAR);
  const who = pool.sort((a, b) => (b.faith || 0) - (a.faith || 0))[0];
  if (!who) return;
  st.prayers = st.prayers.filter(p => p.s !== s.id);
  S.prayId = st.nextId++;
  st.prayers.push({ id: S.prayId, s: s.id, power: 'sonne', who: who.id, whoN: who.n, t: L('Schick uns Wärme, die Alten frieren.', 'Send us warmth, the old ones are cold.'), d: st.day, until: st.day + 24 });
  topUp(app, 'sonne');
}
const camState = app => { const c = app.stage.camera.position, t = app.stage.controls.target; return [c.x, c.y, c.z, t.x, t.y, t.z]; };

// ---------- Die erste Runde: jede Station wartet, bis du es getan hast ----------
const QUEST = [
  { id: 'tt_goal', art: ICON.fire, center: true, info: true, btn: L('Los geht’s', 'Let’s go'),
    t: L('Vom ersten Feuer zu den Sternen', 'From the first fire to the stars'), x: L('Du bist der Geist dieser Welt. Begleite diese Menschen.', 'You are the spirit of this world. Guide these people.') },
  { id: 'tt_look', art: ICON.mouse, t: L('Sieh dich um', 'Look around'),
    x: L('Ziehen dreht, das Rad zoomt.', 'Drag to turn, scroll to zoom.'), xt: L('Ein Finger schiebt, zwei drehen und zoomen.', 'One finger moves, two turn and zoom.'),
    prep: app => { S.cam0 = camState(app); },
    wait: app => { const a = S.cam0, b = camState(app); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 4 || Math.hypot(a[3] - b[3], a[5] - b[5]) > 2.5; } },
  { id: 'tt_person', art: ICON.hand, t: L('Triff deine Menschen', 'Meet your people'),
    x: L('Klicke einen Menschen an, zum Beispiel deinen mit dem Stern.', 'Click a person, for example yours with the star.'),
    xt: L('Tippe einen Menschen an, zum Beispiel deinen mit dem Stern.', 'Tap a person, for example yours with the star.'),
    // die Kamera fährt nah an deinen Menschen (sonst an den Ort), damit man die Menschen auch trifft
    prep: app => {
      closeCard(app);
      const st = app.st, hp = st.hero && !st.hero.end && app.people && app.people.pos.get(st.hero.id), s = homeTown(st);
      if (!app.focus) return;
      if (hp) app.focus(hp[0] + app.NX / 2 - 0.5, hp[2] + app.NY / 2 - 0.5, 7);
      else if (s) app.focus(s.cx, s.cy, 9);
    },
    wait: app => !!(app.ui && app.ui.inspect && app.ui.inspect.kind === 'p'), hold: 3.2 },
  { id: 'tt_power', sel: ['#top .mana'], art: ICON.ring, info: true, t: L('Deine Kraft', 'Your power'),
    x: L('Sie wächst, wenn sie an dich glauben. Jede Karte kostet Kraft.', 'It grows when they believe. Every card costs some.'), prep: app => closeCard(app) },
  { id: 'tt_rain', sel: ['#dock .card[data-id="regen"]'], art: ICON.rain, t: L('Schick Regen', 'Send rain'),
    x: L('Klicke die Karte Regen.', 'Click the rain card.'), xt: L('Tippe die Karte Regen.', 'Tap the rain card.'),
    prep: app => { closeCard(app); openDeck(app, 'wetter'); topUp(app, 'regen'); }, cast: 'regen' },
  { id: 'tt_sign', art: ICON.spark, info: true, t: L('Ein Zeichen', 'A sign'), x: L('Sie werden davon erzählen.', 'They will tell stories about it.') },
  { id: 'tt_prayer', sel: ['#prayers'], art: ICON.pray, t: L('Ein Gebet', 'A prayer'),
    x: L('Klicke das Gebet an, um es zu erhören.', 'Click the prayer to answer it.'), xt: L('Tippe das Gebet an, um es zu erhören.', 'Tap the prayer to answer it.'),
    prep: app => { S.ans0 = app.st.counts.answered || 0; layPrayer(app); },
    wait: app => { if ((app.st.counts.answered || 0) > S.ans0) return true; layPrayer(app); topUp(app, 'sonne'); return false; } },
  { id: 'tt_answered', sel: ['#top .mana'], art: ICON.faith, info: true, t: L('Erhört', 'Answered'), x: L('Ihr Glaube wächst, und deine Kraft mit ihm.', 'Their faith grows, and your power with it.') },
  { id: 'tt_dream', art: ICON.moon, t: L('Ein Traum', 'A dream'), cast: 'traum',
    // der Rahmen wandert mit: erst der Stapel Geist, dann die Karte Traum, im Themenfenster und beim Zielen keiner
    sel: app => (document.querySelector('#modal.show') || app.power === 'traum' ? null : app.ui && app.ui.cat === 'geist' ? ['#dock .card[data-id="traum"]'] : ['#dock .dtab:nth-child(3)']),
    x: L('Stapel Geist, Karte Traum, ein Thema, dann ein Mensch.', 'Spirit deck, Dream card, a theme, then a person.'),
    x2: L('Jetzt einen Menschen anklicken.', 'Now click a person.'), xt2: L('Jetzt einen Menschen antippen.', 'Now tap a person.'),
    prep: app => { closeCard(app); topUp(app, 'traum'); } },
  { id: 'tt_time', sel: ['#speed'], art: ICON.speed, t: L('Die Zeit', 'Time'),
    x: L('Stell sie schneller und sieh ihr Dorf wachsen.', 'Speed it up and watch their village grow.'), wait: app => app.speed >= 3, hold: 2.5 },
  { id: 'tt_book', sel: ['#btnIsland'], art: ICON.book, t: L('Das Inselbuch', 'The island book'),
    x: L('Hier steht alles über dein Volk.', 'Everything about your people is in here.'), wait: () => document.body.classList.contains('left-open'), hold: 3 },
  { id: 'tt_end', art: ICON.star, center: true, info: true, end: true, btn: L('Spielen', 'Play'),
    t: L('Mehr brauchst du nicht', 'That’s all you need'), x: L('Den Rest bringt dir die Insel bei.', 'The island will teach you the rest.') },
];
// Kurze Tipps beim Spielen (Sekunden Spielzeit nach der ersten Runde)
const TIPS = [
  { id: 'tt_story', sel: ['#btnHero'], art: ICON.person, t: L('Dein Mensch', 'Your person'), info: true, after: 40, when: app => app.st.hero && !app.st.hero.end,
    x: L('Taste H: dieses Leben und sein Tagebuch.', 'Press H: that life and its diary.'), xt: L('Hier: dieses Leben und sein Tagebuch.', 'Here: that life and its diary.') },
  { id: 'tt_ghost', sel: ['#btnGhost'], art: ICON.ghost, t: L('Geistmodus', 'Spirit mode'), info: true, after: 110,
    x: L('Taste G: unsichtbar unter ihnen gehen.', 'Press G: walk among them unseen.'), xt: L('Hier gehst du unsichtbar unter ihnen.', 'Walk among them unseen.') },
  { id: 'tt_map', sel: ['#btnMap'], art: ICON.map, t: L('Die Karte', 'The map'), info: true, after: 190,
    x: L('Taste M: alles, was sie entdeckt haben.', 'Press M: everything they have discovered.'), xt: L('Alles, was sie entdeckt haben.', 'Everything they have discovered.') },
];

let S = null; // { app, done:Set, first, play, idx, mode, step, okAt, ... }
export const tourState = () => S; // zum Prüfen in der Konsole

function load(app) {
  let d = {};
  try { d = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* egal */ }
  if (d.seed !== app.st.seed || d.v !== 2) d = { seed: app.st.seed, v: 2, done: [], first: false, play: 0 };
  return d;
}
function store() {
  if (!S) return;
  try { localStorage.setItem(KEY, JSON.stringify({ seed: S.app.st.seed, v: 2, done: [...S.done], first: S.first, play: Math.round(S.play) })); } catch { /* egal */ }
}
export const tourOff = () => { try { return localStorage.getItem(OFF) === '1'; } catch { return false; } };
export function setTourOff(v) { try { localStorage.setItem(OFF, v ? '1' : '0'); } catch { /* egal */ } if (v) endTour(); }

export function resetTour(app) {
  endTour();
  try { localStorage.removeItem(KEY); } catch { /* egal */ }
  void app;
}

function els() {
  let dim = document.getElementById('tourDim'), tip = document.getElementById('tourTip');
  if (!dim) { dim = document.createElement('div'); dim.id = 'tourDim'; dim.innerHTML = '<div class="spot"></div>'; document.body.append(dim); }
  if (!tip) { tip = document.createElement('div'); tip.id = 'tourTip'; document.body.append(tip); }
  return { dim, tip };
}

const selOf = step => (typeof step.sel === 'function' ? step.sel(S.app) : step.sel);
function rectOf(sel) {
  if (!sel) return null;
  let r = null;
  for (const s of sel) {
    const e = document.querySelector(s);
    if (!e) continue;
    const b = e.getBoundingClientRect();
    if (!b.width && !b.height) continue;
    r = r ? { l: Math.min(r.l, b.left), t: Math.min(r.t, b.top), r: Math.max(r.r, b.right), b: Math.max(r.b, b.bottom) } : { l: b.left, t: b.top, r: b.right, b: b.bottom };
  }
  return r;
}

function place(step) {
  const { dim, tip } = els();
  const r = rectOf(selOf(step));
  const spot = dim.querySelector('.spot');
  const dark = !!step.center && S.mode === 'first';
  dim.classList.toggle('dark', dark);
  if (r) {
    const pad = 8;
    Object.assign(spot.style, { left: r.l - pad + 'px', top: r.t - pad + 'px', width: r.r - r.l + pad * 2 + 'px', height: r.b - r.t + pad * 2 + 'px', opacity: 1 });
  } else {
    Object.assign(spot.style, { left: '50%', top: '46%', width: '0px', height: '0px', opacity: dark ? 1 : 0 });
  }
  // Blase neben das Ziel: darunter, wenn das Ziel oben ist, sonst darüber; ohne Ziel mittig (Ziel und Ende) oder oben
  const W = innerWidth, H = innerHeight, tw = tip.offsetWidth || 360, th = tip.offsetHeight || 140;
  let x, y, arrow = '';
  if (!r) { x = (W - tw) / 2; y = step.center ? H * 0.4 - th / 2 : Math.min(H * 0.17, 140); }
  else if ((r.t + r.b) / 2 < H / 2) { x = (r.l + r.r) / 2 - tw / 2; y = r.b + 22; arrow = 'up'; }
  else { x = (r.l + r.r) / 2 - tw / 2; y = r.t - th - 22; arrow = 'down'; }
  const cx = Math.max(14, Math.min(W - tw - 14, x));
  tip.style.left = cx + 'px'; tip.style.top = Math.max(12, Math.min(H - th - 12, y)) + 'px';
  tip.dataset.arrow = arrow;
  if (r) tip.style.setProperty('--ax', Math.max(18, Math.min(tw - 18, (r.l + r.r) / 2 - cx)) + 'px');
}

function line(step) {
  const t = touch();
  if (step.x2 && step.cast && S.app.power === step.cast) return (t && step.xt2) || step.x2;
  return (t && step.xt) || step.x;
}

function show(step) {
  const { dim, tip } = els();
  const first = S.mode === 'first';
  S.step = step; S.okAt = 0; S.shownAt = performance.now(); S.voiceDone = false; S.autoHide = 0;
  if (step.prep) step.prep(S.app);
  const n = QUEST.indexOf(step);
  const action = !step.info;
  tip.className = 'show ' + (first ? 'first' : 'later') + (action ? ' act' : '');
  tip.innerHTML = `<div class="tart">${step.art || ''}</div><div class="ttx">
    ${first && n > 0 && !step.end ? `<small>${n} / ${QUEST.length - 2}</small>` : !first ? `<small>${L('Tipp', 'Tip')}</small>` : ''}<b>${step.t}</b><p>${line(step)}</p>
    <div class="tb">${action ? `<span class="tdo">${L('Du bist dran', 'Your turn')}</span>` : `<button class="tn">${step.btn || (first ? L('Weiter', 'Next') : L('Verstanden', 'Got it'))}</button>`}
    ${first && !step.end ? `<button class="ts">${action ? L('Überspringen', 'Skip') : L('Tutorial beenden', 'End tutorial')}</button>` : ''}</div></div><i class="tok"></i>`;
  dim.classList.add('show');
  place(step);
  requestAnimationFrame(() => place(step));
  const tn = tip.querySelector('.tn');
  if (tn) tn.onclick = () => advance(true);
  const ts = tip.querySelector('.ts');
  if (ts) ts.onclick = () => (action ? advance(true) : skipAll());
  say(step.id, { caption: false, force: true, onEnd: () => { if (S && S.step === step) S.voiceDone = performance.now(); } });
}

// Geschafft: Haken, kurzer Moment, dann weiter
function success(step) {
  if (!S || S.step !== step || S.okAt) return;
  S.okAt = performance.now();
  const tip = document.getElementById('tourTip');
  if (tip) { tip.classList.add('ok'); const d = tip.querySelector('.tdo'); if (d) d.textContent = L('Geschafft', 'Done'); }
}

function hide() {
  const dim = document.getElementById('tourDim'), tip = document.getElementById('tourTip');
  if (dim) dim.classList.remove('show', 'dark');
  if (tip) tip.className = '';
  if (S) S.step = null;
}

function advance(byUser) {
  if (!S || !S.step) return;
  const step = S.step;
  S.done.add(step.id);
  if (byUser) stopVoice();
  hide();
  store();
  if (S.mode === 'first') {
    S.idx++;
    S.nextAt = performance.now() + (step.cast ? 1700 : 500); // nach einer Karte erst kurz zusehen lassen
    if (S.idx >= QUEST.length) { S.mode = 'later'; S.first = true; store(); }
  }
  if (step.end) { S.mode = 'later'; S.first = true; store(); }
}

function skipAll() {
  if (!S) return;
  for (const s of QUEST) S.done.add(s.id);
  S.first = true; S.mode = 'later';
  store();
  stopVoice();
  hide();
}

export function endTour() {
  hide();
  if (S && S.timer) clearInterval(S.timer);
  if (S && S.app.onCast === S.onCast) S.app.onCast = null;
  S = null;
}

// Wird nach Wahl des Lebens aufgerufen. Läuft auch nach einem Neuladen weiter, solange die Welt dieselbe ist.
export function startTour(app, resumeOnly) {
  if (tourOff() || !app.st || S) return;
  if (resumeOnly) { let d0 = null; try { d0 = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* egal */ } if (!d0 || d0.seed !== app.st.seed || d0.v !== 2) return; }
  const d = load(app);
  S = { app, done: new Set(d.done), first: d.first, play: d.play || 0, idx: 0, mode: d.first ? 'later' : 'first', step: null, last: performance.now() };
  if (TIPS.every(s => S.done.has(s.id)) && S.first) { S = null; return; }
  S.onCast = id => { if (S && S.step && S.step.cast === id) success(S.step); };
  app.onCast = S.onCast;
  if (S.mode === 'first') {
    S.idx = QUEST.findIndex(s => !S.done.has(s.id));
    if (S.idx < 0) { S.mode = 'later'; S.first = true; }
    else S.nextAt = performance.now() + 900;
  }
  S.timer = setInterval(tick, 250);
}

function blocked() {
  return document.querySelector('#heroPick.show, #heroStory.show, #spiritIntro.show, #heroIntro.show, #trailer, #diary.show') || document.body.classList.contains('ghost-mode') || document.body.classList.contains('interior');
}

function tick() {
  if (!S) return;
  const app = S.app, now = performance.now();
  const dt = (now - S.last) / 1000; S.last = now;
  const step = S.step;
  if (step) {
    if (blocked()) { stopVoice(); hide(); S.nextAt = now + 1200; return; }
    place(step);
    const p = document.querySelector('#tourTip p');
    if (p) { const tx = line(step); if (p.textContent !== tx) p.textContent = tx; }
    if (S.okAt) { if (now - S.okAt > (step.hold || 1.1) * 1000) advance(false); return; }
    if (step.wait && now - S.shownAt > 900 && step.wait(app)) { success(step); return; }
    // Hinweise ohne Aufgabe gehen nach der Stimme von selbst weiter, Tipps beim Spielen nach ein paar Sekunden
    if (step.info && S.voiceDone && now - S.voiceDone > (S.mode === 'first' ? (step.center ? 4200 : 1600) : 5000)) advance(false);
    else if (!step.info && S.mode === 'later' && S.voiceDone && now - S.voiceDone > 6000) advance(false);
    return;
  }
  if (S.mode === 'first') {
    // nächste Station; nach einer Unterbrechung (Geistmodus, Haus, Tagebuch, Menü) dort weitermachen, wo es war
    if (now > (S.nextAt || 0) && !blocked() && !document.querySelector('#modal.show') && S.idx < QUEST.length) show(QUEST[S.idx]);
    return;
  }
  if (!app.running || document.hidden) return;
  if (app.speed < 100 && !blocked()) S.play += dt;
  if (blocked() || speaking() || app.speed >= 100) return;
  if (Math.round(S.play * 4) % 40 === 0) store();
  for (const st of TIPS) {
    if (S.done.has(st.id)) continue;
    if (st.after && S.play < st.after) continue;
    if (st.when && !st.when(app)) continue;
    if (st.sel && !rectOf(selOf(st))) continue;
    show(st);
    return;
  }
  if (TIPS.every(s => S.done.has(s.id))) endTour();
}
