// Die Erzählstimme begleitet dein Leben: Liebe, Hochzeit, Kinder, Streit, Krieg, Seuche, Alter, Tod.
// hero.js meldet Ereignisse als rt.fx { type: 'heroSay', cat, text }, main.js reicht sie hierher.
// Gesprochen wird ein allgemeiner Satz (ev_<art>), der Untertitel zeigt darunter, was genau passiert ist (mit Namen).
// Nicht zu oft: höchstens alle 25 Sekunden, dieselbe Art höchstens alle 4 Minuten, nicht im schnellen Zeitraffer,
// nicht wenn gerade etwas anderes erzählt wird. Wichtiges (Tod, Übergabe, Kind, Hochzeit) wartet kurz in der Schlange.
import { say, speaking, voiceOn } from './voice.js';
import { keepFace } from './faces.js';

const IMPORTANT = new Set(['pass', 'end', 'child', 'wed', 'widow', 'war', 'old']);
const last = {};
let lastAny = 0, pending = null;

function ready(app) {
  return app.running && app.speed < 100 && !document.hidden && !document.querySelector('#modal.show, #heroPick.show, #heroStory.show, #spiritIntro.show, #heroIntro.show, #trailer');
}

function play(app, ev) {
  const now = performance.now();
  last[ev.cat] = now; lastAny = now;
  say('ev_' + ev.cat, { sub: ev.text });
  if (app.ui && app.ui.storyPulse) app.ui.storyPulse();
}

export function storyEvent(app, e) {
  if (!voiceOn() || !app.st || !app.st.hero) return;
  let ev = null;
  if (e.type === 'heroSay') ev = { cat: e.cat, text: e.text };
  else if (e.type === 'hero') {
    const q = app.st._rt.pById.get(e.to);
    if (q) keepFace(app.st, q);
    ev = { cat: 'pass', text: q ? `${e.from} › ${q.n}` : e.from };
  } else if (e.type === 'heroEnd') ev = { cat: 'end', text: e.name };
  if (!ev) return;
  const now = performance.now();
  const cool = IMPORTANT.has(ev.cat) ? 60000 : 240000;
  if (last[ev.cat] && now - last[ev.cat] < cool) return;
  if (!ready(app) || speaking() || now - lastAny < 25000) {
    if (IMPORTANT.has(ev.cat) || !pending) pending = { ev, t: now };
    return;
  }
  play(app, ev);
}

// jede Sekunde aus main.js: Wartendes nachholen, wenn es ruhig ist
export function storyTick(app) {
  if (!pending) return;
  const now = performance.now();
  if (now - pending.t > 90000) { pending = null; return; }
  if (!ready(app) || speaking() || now - lastAny < 12000) return;
  const ev = pending.ev; pending = null;
  play(app, ev);
}
