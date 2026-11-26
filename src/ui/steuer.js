// Bedienung (26.11.2026): frei belegbare Tasten, Gamepad, Kräfterad fürs Hochformat.
//   Tasten: eine Übersetzung vor allen anderen Hörern. Wer "Karte" auf N legt, drückt N, und das Spiel bekommt M.
//           So muss kein einziger der vielen Tastenhörer im Spiel geändert werden. Gespeichert in pfr.keys.
//   Gamepad: linker Stick schiebt, rechter dreht und zoomt, A klickt in die Bildmitte, B bricht ab, LB und RB wählen
//           eine Kraft, X wirkt sie, Y pausiert, Steuerkreuz hoch und runter ändert das Tempo, Start öffnet das Menü.
//   Kräfterad: im Hochformat am Handy ein runder Knopf, der alle freien Kräfte im Kreis zeigt.
import { L } from '../i18n.js';
import * as D from '../sim/data.js';
import { unlocked } from './kern.js';

const KEY = 'pfr.keys';
const ACTIONS = [
  ['pause', ' ', L('Pause', 'Pause')], ['karte', 'm', L('Karte', 'Map')], ['chronik', 'c', L('Chronik', 'Chronicle')], ['buch', 'i', L('Inselbuch', 'Island book')],
  ['held', 'h', L('Meine Geschichte', 'My story')], ['folgen', 'f', L('Mensch folgen', 'Follow person')], ['geist', 'g', L('Geistmodus', 'Spirit mode')],
  ['flug', 'p', L('Flugzeug', 'Plane')], ['fahren', 'k', L('Fahrzeug', 'Vehicle')], ['foto', 'o', L('Fotomodus', 'Photo mode')], ['suche', '/', L('Suche', 'Search')],
];
const show = k => (k === ' ' ? L('Leertaste', 'Space') : k.length === 1 ? k.toUpperCase() : k);
const fire = (type, key) => window.dispatchEvent(new KeyboardEvent(type, { key, code: key === ' ' ? 'Space' : '', bubbles: true, cancelable: true }));
const typing = e => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);

export function initSteuer(app) {
  const S = { map: {}, grab: null };
  try { S.map = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { S.map = {}; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S.map)); } catch { /* egal */ } };
  const keyOf = id => S.map[id] || ACTIONS.find(a => a[0] === id)[1];

  // ---------- Tasten ----------
  const translate = e => {
    if (!e.isTrusted || e.metaKey || e.ctrlKey || e.altKey) return;
    if (S.grab) { e.preventDefault(); e.stopImmediatePropagation(); if (e.type === 'keydown') S.grab(e.key); return; }
    if (typing(e)) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    let hit = null, shadowed = false;
    for (const [id, def] of ACTIONS) { const cur = S.map[id]; if (cur && cur === k) hit = def; if (cur && cur !== def && def === k) shadowed = true; }
    if (hit == null && !shadowed) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (hit != null) fire(e.type, hit);
  };
  window.addEventListener('keydown', translate, true);
  window.addEventListener('keyup', translate, true);

  S.openKeys = () => {
    const m = document.querySelector('#modal');
    const draw = () => {
      m.innerHTML = `<div class="mbox keys"><h2>${L('Tasten belegen', 'Key bindings')}</h2><p>${L('Klicke eine Zeile an und drücke die neue Taste. Kamera: Pfeile oder WASD, Q und E drehen, Plus und Minus zoomen. Tempo: 1 bis 8.', 'Click a row and press the new key. Camera: arrows or WASD, Q and E rotate, plus and minus zoom. Speed: 1 to 8.')}</p>
        <div class="klist">${ACTIONS.map(([id, def, name]) => `<button data-id="${id}" class="${S.map[id] && S.map[id] !== def ? 'own' : ''}"><span>${name}</span><kbd>${show(keyOf(id))}</kbd></button>`).join('')}</div>
        <div class="mbtns"><button class="done">${L('Fertig', 'Done')}</button><button class="ghost reset">${L('Alles zurücksetzen', 'Reset all')}</button></div></div>`;
      m.className = 'show';
      m.querySelector('.done').onclick = () => { S.grab = null; m.className = ''; };
      m.querySelector('.reset').onclick = () => { S.map = {}; save(); draw(); };
      m.querySelectorAll('.klist button').forEach(b => { b.onclick = () => {
        b.querySelector('kbd').textContent = L('Taste drücken', 'Press a key'); b.classList.add('wait');
        S.grab = key => {
          S.grab = null;
          const k = key.length === 1 ? key.toLowerCase() : key;
          const reserved = 'wasdqe12345678+-='.includes(k) || k.startsWith('Arrow') || ['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Enter'].includes(k);
          if (k !== 'Escape' && !reserved) {
            for (const [id] of ACTIONS) if (id !== b.dataset.id && keyOf(id) === k) { S.map[id] = keyOf(b.dataset.id); }   // Tausch statt Doppelbelegung
            S.map[b.dataset.id] = k;
            for (const [id, def] of ACTIONS) if (S.map[id] === def) delete S.map[id];
            save();
          } else if (reserved) app.ui && app.ui.toast(L('Diese Taste gehört der Kamera oder dem Tempo.', 'That key belongs to the camera or the speed.'), 'warn');
          draw();
        };
      }; });
    };
    draw();
  };

  // ---------- Gamepad ----------
  const cross = document.createElement('div'); cross.id = 'padCross'; document.body.append(cross);
  const held = new Set(), was = [];
  let sel = -1, active = false, raf = 0;
  const hold = (key, on) => { if (on && !held.has(key)) { held.add(key); fire('keydown', key); } else if (!on && held.has(key)) { held.delete(key); fire('keyup', key); } };
  const cards = () => [...document.querySelectorAll('#dock .card')].filter(c => !c.classList.contains('locked') && c.offsetParent);
  const mark = () => { document.querySelectorAll('#dock .card.padsel').forEach(c => c.classList.remove('padsel')); const c = cards()[sel]; if (c) { c.classList.add('padsel'); c.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); } };
  const clickAt = (x, y) => {
    const el = document.elementFromPoint(x, y); if (!el) return;
    const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 })); el.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 })); el.dispatchEvent(new MouseEvent('click', { ...o, buttons: 0 }));
  };
  const SPEEDS = ['1', '2', '3', '4', '5'];
  function press(i) {
    const modalBtn = document.querySelector('#modal.show .mbtns button, #modal.show button.go, #schatten.show .ward, #omen.show .warn');
    if (i === 0) { if (modalBtn) modalBtn.click(); else clickAt(innerWidth / 2, innerHeight / 2); }
    else if (i === 1) fire('keydown', 'Escape');
    else if (i === 2) { const c = cards()[sel]; if (c) c.click(); }
    else if (i === 3) fire('keydown', ' ');
    else if (i === 4 || i === 5) { const n = cards().length; if (n) { sel = ((sel < 0 ? 0 : sel + (i === 5 ? 1 : -1)) + n) % n; mark(); } }
    else if (i === 9) { const b = document.querySelector('#btnMenu'); if (b) b.click(); }
    else if (i === 12 || i === 13) { const cur = Math.max(0, [1, 3, 10, 100, 500].indexOf(app.speed || 1)); fire('keydown', SPEEDS[Math.max(0, Math.min(4, cur + (i === 12 ? 1 : -1)))]); }
    else if (i === 8) fire('keydown', 'm');
  }
  function poll() {
    raf = requestAnimationFrame(poll);
    const gp = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find(g => g && g.connected);
    if (!gp) { if (active) { active = false; document.body.classList.remove('pad'); for (const k of [...held]) hold(k, false); } return; }
    const ax = gp.axes, dz = 0.3;
    const any = ax.some(v => Math.abs(v) > dz) || gp.buttons.some(b => b.pressed);
    if (any && !active) { active = true; document.body.classList.add('pad'); app.ui && app.ui.toast(L('Gamepad erkannt. A klickt in die Bildmitte, LB und RB wählen eine Kraft, X wirkt sie.', 'Gamepad detected. A clicks the centre of the screen, LB and RB pick a power, X uses it.')); }
    if (!active) return;
    hold('a', ax[0] < -dz); hold('d', ax[0] > dz); hold('w', ax[1] < -dz); hold('s', ax[1] > dz);
    hold('q', (ax[2] || 0) < -dz); hold('e', (ax[2] || 0) > dz);
    hold('+', (ax[3] || 0) < -dz || (gp.buttons[7] && gp.buttons[7].pressed)); hold('-', (ax[3] || 0) > dz || (gp.buttons[6] && gp.buttons[6].pressed));
    gp.buttons.forEach((b, i) => { if (b.pressed && !was[i] && i !== 6 && i !== 7) press(i); was[i] = b.pressed; });
  }
  window.addEventListener('gamepadconnected', () => { if (!raf) poll(); });
  if (navigator.getGamepads && [...navigator.getGamepads()].some(Boolean)) poll();
  S.padPress = press;   // für Tests

  // ---------- Kräfterad ----------
  const wb = document.createElement('button'); wb.id = 'radBtn'; wb.setAttribute('aria-label', L('Kräfte', 'Powers')); wb.innerHTML = '✦';
  const wheel = document.createElement('div'); wheel.id = 'rad';
  document.body.append(wb, wheel);
  const closeW = () => wheel.classList.remove('show');
  S.openWheel = () => {
    const st = app.st; if (!st) return;
    const free = [...unlocked(st)].filter(id => D.POWER[id]);
    const ids = D.POWERS.map(p => p.id).filter(id => free.includes(id));
    const inner = ids.slice(0, 7), outer = ids.slice(7);
    const ring = (list, r, off) => list.map((id, i) => {
      const a = off + i / list.length * Math.PI * 2 - Math.PI / 2, P = D.POWER[id], cost = app.geist ? app.geist.cost(id) : P.cost;
      return `<button data-id="${id}" class="${st.mana < cost ? 'poor' : ''}" style="--x:${(Math.cos(a) * r).toFixed(1)}px;--y:${(Math.sin(a) * r).toFixed(1)}px"><img src="assets/cards/${id}.webp" alt=""><span>${P.name}</span><i>${cost}</i></button>`;
    }).join('');
    wheel.innerHTML = `<div class="rad-in">${ring(inner, 82, 0)}${ring(outer, 150, 0.2)}<button class="rad-x" aria-label="${L('Schließen', 'Close')}">×</button></div>`;
    wheel.classList.add('show');
    wheel.querySelector('.rad-x').onclick = closeW;
    wheel.querySelectorAll('button[data-id]').forEach(b => { b.onclick = () => { closeW(); app.choosePower(b.dataset.id); }; });
  };
  wb.onclick = S.openWheel;
  wheel.addEventListener('pointerdown', e => { if (e.target === wheel) closeW(); });

  app.steuer = S;
  return S;
}
