// Handy und Tablet (seit 20.10.2026, Naders Wunsch: "mobil perfekt"). Nur auf Geräten mit Finger statt Maus.
// Gottansicht: ein Finger schiebt die Karte, zwei Finger drehen und zoomen. Geistmodus: Stick links zum Gehen (weit
// ausgelenkt rennt der Geist), rechts mit dem Finger umsehen, Knöpfe für Springen (halten gleitet), Wirken und
// "Mensch ansehen"; mit gewählter Karte wirkt ein kurzer Tipp ins Bild genau dort. Flug: Steuerknüppel links
// (nach vorn drückt die Nase runter wie W), Gasregler rechts, Turbo, Kamera, Aussteigen.
import * as THREE from 'three';
import { L } from '../i18n.js';

export const TOUCH = (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches) || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);

const cap = (e, id) => { try { e.setPointerCapture(id); } catch { /* manche Browser kennen den Finger noch nicht */ } };
const el = (tag, cls, html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

// Ein Stick: liefert x und y von minus 1 bis 1 (y nach oben positiv), solange ein Finger darauf liegt
function stick(host, cls, onMove, onEnd) {
  const base = el('div', 'tstick ' + cls, '<i></i>');
  const knob = base.firstChild;
  host.append(base);
  let id = null, cx = 0, cy = 0;
  const R = () => base.clientWidth * 0.42;
  const move = e => {
    const r = R(), dx = e.clientX - cx, dy = e.clientY - cy, d = Math.hypot(dx, dy), k = d > r ? r / d : 1;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    onMove(Math.max(-1, Math.min(1, dx / r)), Math.max(-1, Math.min(1, -dy / r)), Math.min(1, d / r));
  };
  base.addEventListener('pointerdown', e => {
    if (id !== null) return;
    id = e.pointerId; cap(base, id);
    const b = base.getBoundingClientRect(); cx = b.left + b.width / 2; cy = b.top + b.height / 2;
    base.classList.add('on'); move(e); e.preventDefault(); e.stopPropagation();
  });
  base.addEventListener('pointermove', e => { if (e.pointerId === id) { move(e); e.preventDefault(); } });
  const up = e => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; base.classList.remove('on'); onEnd(); };
  base.addEventListener('pointerup', up); base.addEventListener('pointercancel', up);
  return base;
}

// Ein Knopf, der gedrückt gehalten werden kann
function hold(host, cls, label, onDown, onUp) {
  const b = el('button', 'tbtn ' + cls, label);
  b.addEventListener('pointerdown', e => { cap(b, e.pointerId); b.classList.add('on'); onDown && onDown(); e.preventDefault(); e.stopPropagation(); });
  const up = e => { b.classList.remove('on'); onUp && onUp(); e.preventDefault(); };
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  b.addEventListener('contextmenu', e => e.preventDefault());
  host.append(b);
  return b;
}

const ICON = {
  jump: '<svg viewBox="0 0 24 24"><path d="M12 19V6 M6.5 11.5L12 6l5.5 5.5"/></svg>',
  cast: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><path d="M12 2.5v4 M12 17.5v4 M2.5 12h4 M17.5 12h4"/><circle cx="12" cy="12" r="1.6"/></svg>',
  look: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c.7-4 3.3-6.3 6.5-6.3s5.8 2.3 6.5 6.3"/></svg>',
  boost: '<svg viewBox="0 0 24 24"><path d="M13 3L6 13.5h5L10 21l7-10.5h-5z"/></svg>',
  cam: '<svg viewBox="0 0 24 24"><path d="M4 8h3l1.5-2.2h7L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.6"/></svg>',
  assist: '<svg viewBox="0 0 24 24"><path d="M3 13h18 M8 13l-2 5 M16 13l2 5 M12 4v9"/><circle cx="12" cy="4" r="1.4"/></svg>',
  out: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12 M18 6L6 18"/></svg>',
};

// Taste so drücken, als käme sie von der Tastatur (Kamera, Flughilfe und "Ansehen" laufen so über denselben Weg)
const key = k => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); window.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true })); };

export function initTouch(app, stage, ghost, flight) {
  if (!TOUCH) return;
  document.body.classList.add('touch');
  ghost.touchMode = true; ghost.lockFailed = true;   // keine Maussperre, kein "Klicke ins Bild"
  stage.prMid = 1.35;                                 // Handy Bildschirme sind sehr dicht: mittel rendert etwas feiner
  // Hinweis oben ("Wähle das Ziel"): antippen bricht ab, eine Esc Taste gibt es nicht
  const hint = document.getElementById('hint');
  if (hint) hint.addEventListener('click', () => { if (app.cancelPower) app.cancelPower(); });
  // Gottansicht: ein Finger schiebt, zwei Finger drehen und zoomen (wie eine Karte)
  stage.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  stage.controls.panSpeed = 1.15;
  // Doppeltippen soll nicht die Seite vergrößern
  let lastT = 0;
  document.addEventListener('touchend', e => { const n = Date.now(); if (n - lastT < 320 && e.cancelable && e.target && e.target.closest && !e.target.closest('input, textarea, select')) e.preventDefault(); lastT = n; }, { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault());

  // ---------- Geistmodus ----------
  const G = el('div', 'tpad', '');
  G.id = 'tcGhost';
  document.body.append(G);
  stick(G, 'move', (x, y, m) => { ghost.touchMove = { x, y, run: m > 0.92 }; }, () => { ghost.touchMove = null; });
  const right = el('div', 'tbtns');
  G.append(right);
  hold(right, 'cast', ICON.cast + `<span>${L('Wirken', 'Cast')}</span>`, () => ghost.shoot());
  hold(right, 'jump', ICON.jump + `<span>${L('Sprung', 'Jump')}</span>`, () => { ghost.jumpReq = ghost.uni.uTime.value; ghost.keys.add(' '); }, () => ghost.keys.delete(' '));
  const lookBtn = hold(right, 'look', ICON.look + `<span>${L('Ansehen', 'Look')}</span>`, () => { if (ghost.nearId) key('e'); else if (app.toast) app.toast(L('Geh nah an einen Menschen heran.', 'Walk up close to a person.')); });
  ghost.onNear = id => lookBtn.classList.toggle('ready', !!id);

  // ---------- Flug ----------
  const F = el('div', 'tpad', '');
  F.id = 'tcFly';
  document.body.append(F);
  stick(F, 'yoke', (x, y) => { flight.touch = { x, y }; }, () => { flight.touch = null; });
  const thr = el('div', 'tthr', `<b></b><span>${L('Gas', 'Thr')}</span>`);
  F.append(thr);
  const setThr = e => {
    const r = thr.getBoundingClientRect(), v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    if (flight.air) flight.air.ctl.throttle = v;
  };
  let tid = null;
  thr.addEventListener('pointerdown', e => { tid = e.pointerId; cap(thr, tid); setThr(e); e.preventDefault(); e.stopPropagation(); });
  thr.addEventListener('pointermove', e => { if (e.pointerId === tid) setThr(e); });
  thr.addEventListener('pointerup', () => { tid = null; });
  const fb = el('div', 'tbtns fly');
  F.append(fb);
  hold(fb, 'boost', ICON.boost + '<span>Turbo</span>', () => flight.keys.add('boost'), () => flight.keys.delete('boost'));
  hold(fb, 'cam', ICON.cam + `<span>${L('Kamera', 'Camera')}</span>`, () => key('v'));
  const asBtn = hold(fb, 'assist', ICON.assist + `<span>${L('Hilfe', 'Assist')}</span>`, () => key('t'));
  hold(fb, 'out', ICON.out + `<span>${L('Aussteigen', 'Leave')}</span>`, () => flight.exit());
  // Gasstand anzeigen
  const tick = () => {
    if (flight.active && flight.air) { thr.firstChild.style.height = Math.round(flight.air.ctl.throttle * 100) + '%'; asBtn.classList.toggle('ready', !!flight.assist); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
