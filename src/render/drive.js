// Fahrmodus (seit 25.10.2026, Naders Wunsch: "eine perfekte Auto-Fahr-Engine mit Steuerung wie bei GTA", Knopf mit dem
// Auto neben dem Flugzeug oder Taste K). Ein Fahrzeug nach der Epoche des nächsten Ortes (N wechselt), gerechnet mit einem
// Zweiachsmodell (Schräglauf vorn und hinten, Reifenhaftung begrenzt, Handbremse lässt das Heck ausbrechen), auf dem echten
// Gelände und den Straßen (Brücken, Belag, Steigung). Maßstab wie im Flug: ein Feld sind 10 Meter (S).
// Steuerung: W oder Pfeil hoch Gas, S oder Pfeil runter Bremse und rückwärts, A D oder Pfeile lenken, Leertaste Handbremse,
// Shift Nitro, V Kamera (Verfolger, Motorhaube, weit), N anderes Fahrzeug, R zurück auf die Straße, K oder Esc aussteigen.
// Maus ziehen schaut sich um, Rad zoomt.
// Nichts fährt durch etwas hindurch: Häuser (echter Grundriss mit Sockel), Baumstämme, Wasser, die Fahrzeuge des Verkehrs
// (sie halten auch für dich, render/vehicles.js extra) und Menschen (vor ihnen bremst das Auto bis zum Stillstand).
import * as THREE from 'three';
import { NX, NY } from './scene.js';
import { groundY } from './terrain.js';
import { roadY } from './bridges.js';
import { TYPES } from './vehicles.js';
import { overlap } from './traffic.js';
import { L } from '../i18n.js';

const S = 10; // Meter je Feld
const G0 = 9.81;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const toward = (cur, want, step) => (cur < want ? Math.min(want, cur + step) : Math.max(want, cur - step));
const wrapPi = a => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };

// Fahrzeuge zum Selberfahren: Masse kg, Kraft N, Leistung W, Luftwiderstand, Lenkwinkel, Haftung, Nitro, Gänge, Name
const CARS = {
  sedan: { m: 1250, F: 8200, P: 125000, drag: 0.42, steer: 0.62, mu: 1.05, nitro: 1.6, gears: 6, de: 'Limousine', en: 'Sedan' },
  hatch: { m: 1050, F: 7600, P: 98000, drag: 0.4, steer: 0.66, mu: 1.08, nitro: 1.6, gears: 5, de: 'Kleinwagen', en: 'Hatchback' },
  truck: { m: 5200, F: 21000, P: 240000, drag: 1.7, steer: 0.5, mu: 0.95, nitro: 1.3, gears: 8, de: 'Lastwagen', en: 'Truck' },
  bus: { m: 8000, F: 26000, P: 260000, drag: 2.4, steer: 0.46, mu: 0.95, nitro: 1.25, gears: 6, de: 'Bus', en: 'Bus' },
  vintage: { m: 950, F: 4200, P: 38000, drag: 0.5, steer: 0.6, mu: 0.9, nitro: 1.5, gears: 3, de: 'Oldtimer', en: 'Vintage car' },
  steamwagon: { m: 2400, F: 7000, P: 30000, drag: 0.9, steer: 0.5, mu: 0.85, nitro: 1.4, gears: 2, de: 'Dampfwagen', en: 'Steam wagon' },
  carriage: { m: 900, F: 3600, P: 9000, drag: 0.7, steer: 0.62, mu: 0.95, nitro: 1.5, gears: 1, de: 'Kutsche', en: 'Carriage' },
  horsecart: { m: 800, F: 3200, P: 7500, drag: 0.7, steer: 0.62, mu: 0.95, nitro: 1.5, gears: 1, de: 'Pferdewagen', en: 'Horse cart' },
  oxcart: { m: 900, F: 3000, P: 4000, drag: 0.8, steer: 0.55, mu: 0.95, nitro: 1.5, gears: 1, de: 'Ochsenkarren', en: 'Ox cart' },
  handcart: { m: 200, F: 900, P: 1500, drag: 0.5, steer: 0.7, mu: 0.95, nitro: 1.5, gears: 1, de: 'Handkarren', en: 'Handcart' },
};
const ORDER = ['sedan', 'hatch', 'truck', 'bus', 'vintage', 'steamwagon', 'carriage', 'horsecart', 'oxcart', 'handcart'];
const forEra = e => (e >= 7 ? 'sedan' : e === 6 ? 'vintage' : e >= 3 ? 'carriage' : 'oxcart');
const PAINT = ['#d9534a', '#3f7fbf', '#f0c94a', '#58a868', '#f4efe6', '#2f3438', '#e88a3c', '#8f6fc9'];

export class Drive {
  constructor(stage, app, fx) {
    this.stage = stage; this.app = app; this.fx = fx;
    this.active = false;
    this.keys = new Set();
    this.view = 0; // 0 Verfolger, 1 Motorhaube, 2 weit
    this.look = { yaw: 0, pitch: 0, drag: false, dist: 1 };
    this.camPos = new THREE.Vector3(); this.camLook = new THREE.Vector3(); this.camInit = false;
    this.type = 'sedan'; this.hex = PAINT[0];
    this.car = { id: -7, x: 0, z: 0, c: 1, s: 0, hl: 0.2, hw: 0.1, cur: 0 }; // im Verkehr eingetragen (vehicles.extra)
    this.demo = { type: 'sedan', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, hex: this.hex };
    this.st = { x: 0, z: 0, yaw: 0, vf: 0, vy: 0, r: 0, steer: 0, thr: 0, brk: 0, hb: 0, nitro: 0, gear: 1, rpm: 0, pitch: 0, roll: 0, lean: 0, dive: 0, y: 0, surf: 1 };
    this.trunks = [];
    this.hud();
    this.input();
  }

  sea() { return (this.fx ? this.fx.rise : 0) + 0.02; }

  // ---------- Steuerung ----------
  input() {
    const K = { w: 'gas', arrowup: 'gas', s: 'brake', arrowdown: 'brake', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right', ' ': 'hb', shift: 'nitro' };
    window.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === 'k') { e.preventDefault(); e.stopImmediatePropagation(); this.toggle(); return; }
      if (!this.active) return;
      if (k === 'escape') { if (!this.app.mapOpen) { e.stopImmediatePropagation(); this.exit(); } return; }
      if (k === 'v') { this.view = (this.view + 1) % 3; this.look.yaw = 0; this.look.pitch = 0; this.flash([L('Kamera: Verfolger', 'Camera: chase'), L('Kamera: Motorhaube', 'Camera: hood'), L('Kamera: weit', 'Camera: far')][this.view]); e.stopImmediatePropagation(); return; }
      if (k === 'n') { this.cycle(); e.stopImmediatePropagation(); return; }
      if (k === 'r') { this.reset(); e.stopImmediatePropagation(); return; }
      if (k === 'p' || k === 'g' || k === 'c' || k === 'i' || k === 'f' || k === 'h') { e.stopImmediatePropagation(); return; } // im Auto kein Flug, Geist oder Fenster
      if (K[k]) { this.keys.add(K[k]); e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    window.addEventListener('keyup', e => { const k = K[e.key.toLowerCase()]; if (k) this.keys.delete(k); }, true);
    window.addEventListener('blur', () => this.keys.clear());
    const cv = this.stage.renderer.domElement;
    cv.addEventListener('pointerdown', e => { if (this.active) this.look.drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
    window.addEventListener('pointermove', e => {
      if (!this.active || !this.look.drag || e.pointerId !== this.look.drag.id) return;
      const dx = e.clientX - this.look.drag.x, dy = e.clientY - this.look.drag.y;
      this.look.drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      this.look.yaw -= dx * 0.006; this.look.pitch = clamp(this.look.pitch + dy * 0.004, -0.6, 0.9);
    });
    window.addEventListener('pointerup', e => { if (this.look.drag && e.pointerId === this.look.drag.id) this.look.drag = false; });
    cv.addEventListener('wheel', e => { if (!this.active) return; e.preventDefault(); e.stopImmediatePropagation(); this.look.dist = clamp(this.look.dist * (1 + Math.sign(e.deltaY) * 0.1), 0.6, 3.5); }, { passive: false, capture: true });
  }

  toggle() { if (this.active) this.exit(); else this.enter(); }

  enter() {
    const app = this.app;
    if (!app.st || this.active || app.mapOpen) return;
    if ((app.interior && (app.interior.active || app.interior.opening)) || (app.timelapse && app.timelapse.active)) return;
    if (app.flight && app.flight.active) app.flight.exit();
    if (app.ghostActive && app.ghostActive() && app.ghostExit) app.ghostExit();
    const cam = this.stage.camera, tg = this.stage.controls.target;
    this.saved = { near: cam.near, fov: cam.fov, pos: cam.position.clone(), tg: tg.clone() };
    const dir = new THREE.Vector3(tg.x - cam.position.x, 0, tg.z - cam.position.z);
    const heading = dir.lengthSq() > 1e-6 ? Math.atan2(-dir.z, dir.x) : 0;
    // Fahrzeug nach der Epoche des nächsten Ortes
    const st = app.st;
    let best = null, bd = Infinity;
    for (const s of st.settlements) { if (!s.alive) continue; const d = Math.hypot(app.wx(s.cx) - tg.x, app.wz(s.cy) - tg.z); if (d < bd) { bd = d; best = s; } }
    this.type = forEra(best ? best.era | 0 : 0);
    this.hex = PAINT[Math.floor(Math.random() * PAINT.length)];
    if (!this.place(tg.x, tg.z, heading)) { app.toast && app.toast(L('Hier ist nur Wasser. Schau auf festes Land und versuch es noch einmal.', 'There is only water here. Look at solid ground and try again.')); return; }
    this.active = true; app.driving = true;
    this.stage.controls.enabled = false;
    cam.near = 0.02; cam.updateProjectionMatrix();
    this.keys.clear(); this.camInit = false; this.look.yaw = 0; this.look.pitch = 0;
    document.body.classList.add('drive-mode');
    this.hudEl.classList.add('show');
    if (app.vehicles) { app.vehicles.demo.push(this.demo); app.vehicles.extra.push(this.car); }
    if (app.sound) app.sound.start();
    if (this.onEnter) this.onEnter();
    if (document.body.classList.contains('touch')) this.flash(L(`Du fährst: ${CARS[this.type].de}. Der Stick lenkt, rechts Gas und Bremse (auch rückwärts), mit der Handbremse driftest du.`, `You are driving: ${CARS[this.type].en}. The stick steers, gas and brake on the right (brake also reverses), the handbrake lets you drift.`), 5);
    else this.flash(L(`Du fährst: ${CARS[this.type].de}. W gibt Gas, S bremst und fährt rückwärts, A und D lenken, Leertaste ist die Handbremse, Shift Nitro. N wechselt das Fahrzeug, K steigt aus.`, `You are driving: ${CARS[this.type].en}. W throttle, S brake and reverse, A and D steer, Space handbrake, Shift nitro. N switches vehicle, K to leave.`), 6);
  }

  // auf die nächste Fahrspur (bis 8 Felder weit), sonst an die Stelle, falls dort Land ist
  place(X, Z, heading) {
    const SR = this.app.streets;
    let px = X, pz = Z, yaw = heading, found = false;
    if (SR && SR.at) {
      outer: for (let r = 0; r <= 8; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const q = SR.at(Math.floor(X) + dx + 0.5, Math.floor(Z) + dz + 0.5);
        if (!q || !(q.fl & 4)) continue;
        // Mitte der rechten Spur, Richtung längs der Straße (wie der Blick, so gut es geht)
        const cx = Math.floor(X) + dx + 0.5 - q.nx * q.lat, cz = Math.floor(Z) + dz + 0.5 - q.nz * q.lat;
        let tx = q.tx, tz = q.tz;
        if (tx * Math.cos(heading) - tz * Math.sin(heading) < 0) { tx = -tx; tz = -tz; }
        px = cx + -tz * q.cw * 0.5; pz = cz + tx * q.cw * 0.5; yaw = Math.atan2(-tz, tx); found = true;
        break outer;
      }
    }
    if (!found && roadY(px, pz) < this.sea() - 0.005) return false;
    const s = this.st;
    Object.assign(s, { x: px, z: pz, yaw, vf: 0, vy: 0, r: 0, steer: 0, thr: 0, brk: 0, hb: 0, nitro: 0, gear: 1, rpm: 0, lean: 0, dive: 0 });
    s.y = roadY(px, pz);
    this.safe = { x: px, z: pz, yaw };
    return true;
  }

  reset() {
    const s = this.st;
    if (!this.place(s.x, s.z, s.yaw) && this.safe) Object.assign(s, { x: this.safe.x, z: this.safe.z, yaw: this.safe.yaw, vf: 0, vy: 0, r: 0 });
    this.flash(L('Zurück auf die Straße.', 'Back on the road.'));
  }

  cycle() {
    const i = ORDER.indexOf(this.type);
    this.type = ORDER[(i + 1) % ORDER.length];
    this.flash(L(`Fahrzeug: ${CARS[this.type].de}`, `Vehicle: ${CARS[this.type].en}`));
  }

  exit() {
    if (!this.active) return;
    const app = this.app, cam = this.stage.camera, c = this.stage.controls, s = this.st;
    this.active = false; app.driving = false;
    document.body.classList.remove('drive-mode');
    this.hudEl.classList.remove('show');
    if (app.vehicles) { const V = app.vehicles; V.demo = V.demo.filter(d => d !== this.demo); V.extra = V.extra.filter(e => e !== this.car); }
    const cx = clamp(s.x, -NX / 2 + 4, NX / 2 - 4), cz = clamp(s.z, -NY / 2 + 4, NY / 2 - 4);
    c.target.set(cx, Math.max(0, Math.min(3, groundY(cx, cz))), cz);
    cam.position.set(cx - Math.cos(s.yaw) * 9, c.target.y + 7, cz + Math.sin(s.yaw) * 9);
    cam.up.set(0, 1, 0);
    if (this.saved) { cam.near = this.saved.near; cam.fov = this.saved.fov; cam.updateProjectionMatrix(); }
    c.enabled = true; c.update();
    if (app.sound) app.sound.engine(false);
  }

  // ---------- Welt rundherum ----------
  // Haftung des Untergrunds: Straße 1, Gelände 0,72, Schnee weniger
  surface(x, z) {
    const SR = this.app.streets, on = SR && SR.at && SR.at(x, z);
    const snow = this.app.U ? this.app.U.uSnow.value : 0;
    return (on && Math.abs(on.lat) <= on.hw ? 1 : 0.72) * (1 - snow * 0.45);
  }

  // Hindernisse um (x, z): Grundrisse der Häuser (mit Sockel), Baumstämme. Kästen für den Test gegen das Auto
  obstacles(x, z) {
    const app = this.app, st = app.st, rt = st._rt, B = app.buildingsRef, out = this._obs || (this._obs = []);
    out.length = 0;
    const tx = Math.floor(x + NX / 2), ty = Math.floor(z + NY / 2);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = tx + dx, Y = ty + dy;
      if (X < 0 || Y < 0 || X >= NX || Y >= NY) continue;
      const i = Y * NX + X, bid = rt.bldAt[i];
      if (bid && B) {
        const b = rt.bById.get(bid), m = B.meshes.get(bid);
        if (b && m && b.t !== 'feld' && b.t !== 'park') {
          const f = B.foot(m), e = 0.04; // Sockel ragt etwas über die Wände
          out.push({ x: (f[0] + f[1]) / 2, z: (f[2] + f[3]) / 2, c: 1, s: 0, hl: (f[1] - f[0]) / 2 + e, hw: (f[3] - f[2]) / 2 + e, kind: 'haus' });
        }
      }
      const T = app.terrainRef && app.terrainRef.trees;
      if (T && T.trunks) {
        T.trunks(X, Y, this.trunks);
        for (let k = 0; k < this.trunks.length; k += 3) out.push({ x: this.trunks[k], z: this.trunks[k + 1], c: 1, s: 0, hl: this.trunks[k + 2], hw: this.trunks[k + 2], kind: 'baum' });
      }
    }
    // Verkehr aus dem letzten Bild
    const V = app.vehicles;
    if (V && V.O) V.O.near(x, z, o => { if (o.id !== this.car.id) out.push({ x: o.x, z: o.z, c: o.c, s: o.s, hl: o.hl, hw: o.hw, kind: 'auto' }); });
    return out;
  }

  // Kleinste Verschiebung, die zwei Kästen trennt (Trennachsen): [nx, nz, Tiefe] von b weg zu a hin, oder null
  static mtv(a, b) {
    let best = Infinity, bn = null;
    for (const [nx, nz] of [[a.c, -a.s], [a.s, a.c], [b.c, -b.s], [b.s, b.c]]) {
      const pa = a.x * nx + a.z * nz, ra = Math.abs(a.hl * (a.c * nx - a.s * nz)) + Math.abs(a.hw * (a.s * nx + a.c * nz));
      const pb = b.x * nx + b.z * nz, rb = Math.abs(b.hl * (b.c * nx - b.s * nz)) + Math.abs(b.hw * (b.s * nx + b.c * nz));
      const o = Math.min(pa + ra, pb + rb) - Math.max(pa - ra, pb - rb);
      if (o <= 0) return null;
      if (o < best) { best = o; bn = pa < pb ? [-nx, -nz] : [nx, nz]; }
    }
    return [bn[0], bn[1], best];
  }

  // ---------- jedes Bild ----------
  update(dt) {
    if (!this.active) return;
    const app = this.app;
    if (app.mapOpen) { if (app.sound) app.sound.engine(false); return; }
    dt = Math.min(dt, 0.05);
    const s = this.st, C = CARS[this.type], Ty = TYPES[this.type];
    // Eingaben weich (Lenkung schneller zurück als hin, bei Tempo feiner)
    const T = this.touch || {};
    const left = this.keys.has('left') || T.x < -0.15, right = this.keys.has('right') || T.x > 0.15;
    const wantSteer = T.x != null && Math.abs(T.x) > 0.15 ? -T.x : (left ? 1 : 0) - (right ? 1 : 0);
    s.steer = toward(s.steer, wantSteer, (wantSteer ? 2.6 : 4.2) * dt);
    const gas = this.keys.has('gas') || T.gas, brk = this.keys.has('brake') || T.brake;
    s.hb = this.keys.has('hb') || T.hb ? 1 : 0;
    s.nitro = (this.keys.has('nitro') || T.nitro) && gas ? 1 : 0;
    // Gas und Bremse: S bremst bis zum Stand, danach fährt es rückwärts (W bremst eine Rückwärtsfahrt)
    let thr = 0, brake = 0;
    if (gas) { if (s.vf < -0.5) brake = 1; else thr = 1; }
    if (brk) { if (s.vf > 0.5) brake = 1; else thr = -0.55; }
    s.thr = toward(s.thr, thr, 3 * dt);
    // Physik in Teilschritten (Meter, Sekunden)
    const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
    const a = Ty.hl * S * 0.55, b = Ty.hl * S * 0.55, Lw = a + b, m = C.m, I = m * (Lw * Lw) / 6;
    const mu = C.mu * this.surface(s.x, s.z);
    const Ca = m * G0 * 5.2; // Seitenführung je Achse (N je rad)
    for (let k = 0; k < n; k++) {
      const vf = s.vf, vy = s.vy, r = s.r, sp = Math.hypot(vf, vy);
      const dmax = C.steer * (1 / (1 + Math.abs(vf) / 11)); // bei Tempo weniger Lenkwinkel (wie in GTA)
      const delta = s.steer * dmax;
      // Steigung: Hangabtrieb längs (aus dem Gelände vor und hinter dem Auto)
      const fx = Math.cos(s.yaw), fz = -Math.sin(s.yaw);
      const slope = (roadY(s.x + fx * 0.2, s.z + fz * 0.2) - roadY(s.x - fx * 0.2, s.z - fz * 0.2)) / 0.4;
      // Antrieb: Kraft begrenzt durch Leistung, Nitro mehr Leistung; Bremse; Handbremse an der Hinterachse
      const P = C.P * (s.nitro ? C.nitro : 1);
      const drive = s.thr >= 0 ? s.thr * Math.min(C.F, P / Math.max(1, Math.abs(vf))) : s.thr * C.F * (vf < -8 ? 0 : 1);
      const brakeF = brake * m * 9 * Math.sign(vf) + s.hb * m * 4 * Math.sign(vf);
      const resist = C.drag * vf * Math.abs(vf) + m * 0.03 * vf + m * G0 * 0.012 * Math.sign(vf) + m * G0 * slope;
      let Fx = drive - brakeF - resist;
      if (Math.abs(vf) < 0.3 && !thr && (brake || s.hb || !gas)) Fx -= m * vf / h * 0.5; // steht ruhig
      // Schräglauf und Seitenkräfte (Haftgrenze, Handbremse: Heck verliert Halt)
      const vfa = Math.max(Math.abs(vf), 1.5);
      const af = Math.atan2(vy + a * r, vfa) - delta * Math.sign(vf || 1), ar = Math.atan2(vy - b * r, vfa);
      const Nf = m * G0 * b / Lw, Nr = m * G0 * a / Lw;
      // hinten etwas mehr Halt als vorn (leichtes Untersteuern, gutmütig wie in GTA), mit Handbremse bricht das Heck aus
      const mr = mu * Nr * (s.hb ? 0.5 : 1.12);
      const Fyf = clamp(-Ca * af, -mu * Nf, mu * Nf), Fyr = clamp(-Ca * 1.3 * ar, -mr, mr);
      let ax = Fx / m - Fyf * Math.sin(delta) / m + r * vy, ay = (Fyf * Math.cos(delta) + Fyr) / m - r * vf;
      let ar2 = (a * Fyf * Math.cos(delta) - b * Fyr) / I;
      s.vf += ax * h; s.vy += ay * h; s.r += ar2 * h;
      // Fahrhilfe (ohne Handbremse): Drehrate nicht über das, was die Reifen halten, Seitenrutschen dämpfen
      if (!s.hb) {
        const rl = mu * G0 / Math.max(3, Math.abs(s.vf)) * 1.1;
        if (Math.abs(s.r) > rl) s.r += (Math.sign(s.r) * rl - s.r) * Math.min(1, h * 8);
        s.vy *= Math.max(0, 1 - h * 2.2);
      } else s.r *= Math.max(0, 1 - h * 0.6);
      if (sp < 1.2) { // langsam: wie ein Rad ohne Rutschen (sonst zittert es)
        const kin = s.vf * Math.tan(delta) / Lw;
        s.r += (kin - s.r) * Math.min(1, h * 12); s.vy *= Math.max(0, 1 - h * 10);
      }
      s.yaw += s.r * h;
      const sx = Math.sin(s.yaw), cz = Math.cos(s.yaw);
      const wxv = s.vf * Math.cos(s.yaw) + s.vy * -sx, wzv = s.vf * -Math.sin(s.yaw) + s.vy * -cz; // links ist (-sin, -cos)
      s.x += wxv * h / S; s.z += wzv * h / S;
      s.ax = ax; s.ay = ay;
    }
    this.collide();
    // Grenzen der Welt
    s.x = clamp(s.x, -NX / 2 + 2, NX / 2 - 2); s.z = clamp(s.z, -NY / 2 + 2, NY / 2 - 2);
    // Lage auf dem Boden: Höhe auf Gelände, Straße und Brücke; Neigung aus vier Punkten, dazu Federung (Wanken, Nicken)
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw), hl = Ty.hl * 0.8, hw = Ty.hw * 0.9;
    const lift = (x, z) => roadY(x, z) + (app.streets ? app.streets.lift(x, z) : 0);
    const yf = lift(s.x + c * hl, s.z - sn * hl), yb = lift(s.x - c * hl, s.z + sn * hl);
    const yl = lift(s.x - sn * hw, s.z - c * hw), yr = lift(s.x + sn * hw, s.z + c * hw);
    const wantY = Math.max((yf + yb + yl + yr) / 4, this.sea());
    s.y += (wantY - s.y) * Math.min(1, dt * 18);
    s.lean += (clamp((s.ay || 0) * 0.012, -0.09, 0.09) - s.lean) * Math.min(1, dt * 6); // Kurve: Aufbau neigt sich nach außen
    s.dive += (clamp((s.ax || 0) * 0.006, -0.06, 0.06) - s.dive) * Math.min(1, dt * 6);  // Bremsen: Nase taucht ein
    s.pitch = Math.atan2(yf - yb, 2 * hl) + s.dive; s.roll = Math.atan2(yr - yl, 2 * hw) * -1 + s.lean;
    // ins Bild (über die Fahrzeuginstanzen, mit Scheinwerfern bei Nacht) und in den Verkehr eintragen
    const D = this.demo;
    D.type = this.type; D.hex = this.hex; D.x = s.x; D.y = s.y + 0.002; D.z = s.z; D.yaw = s.yaw; D.pitch = s.pitch; D.roll = s.roll;
    const K = this.car; K.x = s.x + c * Ty.cx; K.z = s.z - sn * Ty.cx; K.c = c; K.s = sn; K.hl = Ty.hl; K.hw = Ty.hw; K.cur = Math.abs(s.vf) / S;
    // sichere Stelle merken
    this.safeT = (this.safeT || 0) + dt;
    if (this.safeT > 1 && Math.abs(s.vf) > 2) { this.safeT = 0; this.safe = { x: s.x, z: s.z, yaw: s.yaw }; }
    this.effects(dt);
    this.camera(dt);
    this.drawHud();
    // Motor: Drehzahl im Gang (Sägezahn wie ein Getriebe), Last aus dem Gas
    const v = Math.abs(s.vf), top = 55, g = Math.min(C.gears, 1 + Math.floor(v / (top / C.gears)));
    s.gear = s.vf < -0.5 ? -1 : g;
    const inG = (v - (g - 1) * top / C.gears) / (top / C.gears);
    s.rpm = clamp(0.18 + (C.gears > 1 ? inG * 0.7 : v / 12) + Math.abs(s.thr) * 0.12, 0.15, 1);
    if (app.sound) app.sound.engine(true, s.rpm * 0.7, Math.abs(s.thr), v, false);
  }

  // Zusammenstöße: aus allem hinausschieben, die Geschwindigkeit in die Wand hinein wird zurückgeworfen (gedämpft)
  collide() {
    const s = this.st, Ty = TYPES[this.type], app = this.app;
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const me = { x: s.x + c * Ty.cx, z: s.z - sn * Ty.cx, c, s: sn, hl: Ty.hl, hw: Ty.hw };
    let hit = null;
    for (let it = 0; it < 3; it++) {
      let moved = false;
      for (const o of this.obstacles(me.x, me.z)) {
        const v = Drive.mtv(me, o);
        if (!v) continue;
        const [nx, nz, d] = v;
        me.x += nx * d; me.z += nz * d; s.x += nx * d; s.z += nz * d; moved = true;
        // Geschwindigkeit in Welt (m/s), Anteil gegen die Wand umkehren und dämpfen
        let wx = s.vf * c - s.vy * sn, wz = -s.vf * sn - s.vy * c;
        const vn = wx * nx + wz * nz;
        if (vn < 0) {
          wx -= 1.25 * vn * nx; wz -= 1.25 * vn * nz; wx *= 0.85; wz *= 0.85;
          s.vf = wx * c - wz * sn; s.vy = -wx * sn - wz * c; s.r *= 0.5;
          if (-vn > (hit ? hit.v : 0)) hit = { v: -vn, kind: o.kind, x: me.x - nx * Ty.hw, z: me.z - nz * Ty.hw };
        }
      }
      if (!moved) break;
    }
    // Wasser: nicht hinein, zurück an den Rand
    const fx = s.x + c * Ty.hl, fz = s.z - sn * Ty.hl;
    if (roadY(fx, fz) < this.sea() - 0.005 || roadY(s.x, s.z) < this.sea() - 0.005) {
      if (this.last) { s.x = this.last.x; s.z = this.last.z; }
      if (Math.abs(s.vf) > 3 && !this.splashT) { this.fx && this.fx.splash && this.fx.splash(fx, this.sea(), fz); this.splashT = 0.6; }
      s.vf *= -0.2; s.vy *= 0.2; s.r *= 0.3;
    } else this.last = { x: s.x, z: s.z };
    // Menschen: vor ihnen bremst das Auto bis zum Stand (sie gehen weiter, das Auto wartet)
    const P = app.people;
    if (P && P.inBox && Math.abs(s.vf) > 0.2) {
      const dirS = Math.sign(s.vf), f0 = dirS > 0 ? Ty.hl * 0.2 : -Ty.hl - 0.12, f1 = dirS > 0 ? Ty.hl + 0.12 : -Ty.hl * 0.2;
      if (P.inBox(me.x, me.z, c, sn, f0, f1, Ty.hw + 0.02)) { s.vf *= 0.5; if (Math.abs(s.vf) < 0.6) s.vf = 0; if (!this.honkT) { this.flash(L('Vorsicht, Fußgänger!', 'Careful, pedestrian!'), 1.4); this.honkT = 3; } }
    }
    if (hit && hit.v > 3.5) {
      const fx2 = this.fx;
      if (fx2) {
        fx2.shake = Math.max(fx2.shake || 0, Math.min(0.6, hit.v * 0.03));
        for (let i = 0; i < 10; i++) fx2.smoke.emit({ x: hit.x, y: s.y + 0.06, z: hit.z, vx: (Math.random() - 0.5) * 0.5, vy: 0.2 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.5, life: 1 + Math.random(), size: 0.08, grow: 1.6, c: [0.75, 0.72, 0.68], a: 0.4, drag: 0.95 });
        if (hit.v > 8) for (let i = 0; i < 8; i++) fx2.glow.emit({ x: hit.x, y: s.y + 0.08, z: hit.z, vx: (Math.random() - 0.5) * 1.6, vy: 0.6 + Math.random(), vz: (Math.random() - 0.5) * 1.6, g: -5, life: 0.4 + Math.random() * 0.3, size: 0.05, c: [1, 0.8, 0.4] });
      }
      if (app.sound && app.sound.boom && hit.v > 9) app.sound.boom();
    }
  }

  // Reifenqualm beim Driften und Bremsen, Staub im Gelände
  effects(dt) {
    const s = this.st, fx = this.fx, Ty = TYPES[this.type];
    this.splashT = Math.max(0, (this.splashT || 0) - dt); this.honkT = Math.max(0, (this.honkT || 0) - dt);
    if (!fx) return;
    const slide = Math.abs(s.vy) > 2.2 || (s.hb && Math.abs(s.vf) > 4), off = this.surface(s.x, s.z) < 0.9;
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw), v = Math.hypot(s.vf, s.vy);
    if ((slide || (off && v > 5)) && Math.random() < dt * (slide ? 40 : 18)) {
      for (const side of [-1, 1]) {
        const x = s.x - c * Ty.hl * 0.7 + sn * Ty.hw * side, z = s.z + sn * Ty.hl * 0.7 + c * Ty.hw * side;
        fx.smoke.emit({ x, y: s.y + 0.02, z, vx: (Math.random() - 0.5) * 0.3, vy: 0.08, vz: (Math.random() - 0.5) * 0.3, life: 1.2, size: 0.07, grow: 2, c: off ? [0.8, 0.72, 0.58] : [0.92, 0.92, 0.92], a: off ? 0.3 : 0.4, drag: 0.94 });
      }
    }
    if (s.nitro && Math.random() < dt * 30) fx.glow.emit({ x: s.x - c * Ty.hl, y: s.y + 0.04, z: s.z + sn * Ty.hl, vx: -c * 0.8, vy: 0.05, vz: sn * 0.8, life: 0.25, size: 0.05, c: [0.5, 0.75, 1] });
  }

  camera(dt) {
    const s = this.st, cam = this.stage.camera, tg = this.stage.controls.target, Ty = TYPES[this.type];
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw), v = Math.hypot(s.vf, s.vy);
    tg.set(s.x, s.y + 0.1, s.z);
    if (this.view === 1) {
      // Motorhaube: knapp über dem Dach nach vorn, das Auto selbst ist da (Blick über die Haube)
      const eye = new THREE.Vector3(s.x + c * Ty.hl * 0.1, s.y + 0.2 + Ty.hl * 0.1, s.z - sn * Ty.hl * 0.1);
      cam.position.copy(eye);
      const ly = s.yaw + this.look.yaw;
      cam.lookAt(eye.x + Math.cos(ly), eye.y - 0.06 - this.look.pitch * 0.5, eye.z - Math.sin(ly));
      if (cam.fov !== 72) { cam.fov = 72; cam.updateProjectionMatrix(); }
      if (!this.look.drag) { this.look.yaw *= Math.exp(-dt * 2); this.look.pitch *= Math.exp(-dt * 2); }
      return;
    }
    // Verfolger: hinter dem Auto, Richtung aus Fahrtrichtung und Bewegung, weich nachgeführt, mit Tempo etwas weiter weg
    let dir = s.yaw;
    if (v > 3 && s.vf > 0) { const mv = Math.atan2(-(s.vf * -sn + s.vy * -c), s.vf * c + s.vy * -sn); dir = s.yaw + wrapPi(mv - s.yaw) * 0.35; }
    if (s.vf < -1) dir = s.yaw; // rückwärts: Kamera bleibt hinten
    this.camYaw = this.camYaw == null ? dir : this.camYaw + wrapPi(dir - this.camYaw) * Math.min(1, dt * 3.2);
    const far = this.view === 2 ? 2.2 : 1;
    const d = (0.95 + Math.min(0.5, v / 60)) * this.look.dist * far, up = (0.36 + this.look.pitch * 0.5) * far;
    const yy = this.camYaw + this.look.yaw;
    const want = new THREE.Vector3(s.x - Math.cos(yy) * d, s.y + up, s.z + Math.sin(yy) * d);
    const gy = roadY(want.x, want.z) + 0.15;
    if (want.y < gy) want.y = gy;
    if (!this.camInit) { this.camPos.copy(want); this.camLook.set(s.x, s.y, s.z); this.camInit = true; }
    this.camPos.lerp(want, 1 - Math.exp(-dt * 7));
    this.camLook.lerp(new THREE.Vector3(s.x + c * 0.5, s.y + 0.12, s.z - sn * 0.5), 1 - Math.exp(-dt * 10));
    cam.position.copy(this.camPos); cam.up.set(0, 1, 0);
    cam.lookAt(this.camLook);
    const fov = 58 + Math.min(14, v * 0.25) + (s.nitro ? 6 : 0);
    if (Math.abs(cam.fov - fov) > 0.3) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 4); cam.updateProjectionMatrix(); }
    if (!this.look.drag) { this.look.yaw *= Math.exp(-dt * 1.4); this.look.pitch *= Math.exp(-dt * 1.4); }
  }

  // ---------- Anzeige ----------
  hud() {
    if (!document.getElementById('driveCss')) {
      const css = document.createElement('style');
      css.id = 'driveCss';
      css.textContent = `
#driveHud { position: fixed; inset: 0; pointer-events: none; z-index: 30; display: none; font-family: var(--sans, Manrope, sans-serif); color: #fdf7ea; }
#driveHud.show { display: block; }
body.drive-mode #dock, body.drive-mode #prayers, body.drive-mode #cards, body.drive-mode .cards { opacity: 0; pointer-events: none; }
#driveHud .dh-panel { position: absolute; right: 26px; bottom: 24px; display: flex; align-items: center; gap: 16px; padding: 10px 20px;
  background: rgba(14, 26, 32, 0.42); border: 1px solid rgba(255, 220, 150, 0.35); border-radius: 22px; backdrop-filter: blur(10px) saturate(1.2); -webkit-backdrop-filter: blur(10px) saturate(1.2); box-shadow: 0 8px 30px rgba(0,0,0,0.25); }
#driveHud .dh-spd b { display: block; font-size: 44px; font-weight: 800; line-height: 1; letter-spacing: -0.01em; text-shadow: 0 2px 12px rgba(0,0,0,0.4); font-variant-numeric: tabular-nums; }
#driveHud .dh-spd small, #driveHud .dh-v small { font-size: 9.5px; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.75; }
#driveHud .dh-v { text-align: center; min-width: 44px; }
#driveHud .dh-v b { display: block; font-size: 22px; font-weight: 700; }
#driveHud .dh-rpm { width: 10px; height: 52px; border-radius: 6px; background: rgba(255,255,255,0.15); position: relative; overflow: hidden; }
#driveHud .dh-rpm i { position: absolute; left: 0; right: 0; bottom: 0; background: linear-gradient(#ff8a6a, #ffd98a 45%, #9fd18b); }
#driveHud .dh-lamp { width: 12px; height: 12px; border-radius: 50%; background: rgba(255,255,255,0.15); }
#driveHud .dh-lamp.on { background: #ff8a6a; box-shadow: 0 0 10px #ff8a6a; }
#driveHud .dh-lamp.nos.on { background: #8ab8ff; box-shadow: 0 0 10px #8ab8ff; }
#driveHud .dh-msg { position: absolute; left: 50%; top: 14%; transform: translateX(-50%); max-width: 70vw; text-align: center; font-family: var(--serif, Fraunces, serif); font-style: italic; font-size: 20px; text-shadow: 0 2px 12px rgba(0,0,0,0.6); opacity: 0; transition: opacity .5s; }
#driveHud .dh-msg.on { opacity: 1; }
#driveHud .dh-keys { position: absolute; left: 22px; bottom: 22px; font-size: 12px; line-height: 1.7; opacity: 0.85; text-shadow: 0 1px 6px rgba(0,0,0,0.6); }
#driveHud .dh-keys kbd { display: inline-block; min-width: 16px; padding: 0 5px; margin-right: 3px; border-radius: 4px; background: rgba(255,255,255,0.18); border: 1px solid rgba(255,255,255,0.25); font: 11px var(--sans, sans-serif); text-align: center; }
#driveHud .dh-mode { position: absolute; right: 30px; bottom: 112px; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; opacity: 0.85; text-align: right; text-shadow: 0 1px 6px rgba(0,0,0,0.6); }
@media (max-width: 900px) { #driveHud .dh-keys { display: none; } #driveHud .dh-panel { right: 50%; transform: translateX(50%); top: calc(96px + env(safe-area-inset-top)); bottom: auto; padding: 5px 12px; gap: 10px; } #driveHud .dh-spd b { font-size: 26px; } #driveHud .dh-v b { font-size: 16px; } #driveHud .dh-mode { display: none; } #driveHud .dh-msg { top: calc(170px + env(safe-area-inset-top)); font-size: 16px; max-width: 86vw; } }
`;
      document.head.appendChild(css);
    }
    const el = this.hudEl = document.createElement('div');
    el.id = 'driveHud';
    el.innerHTML = `
      <div class="dh-msg"></div>
      <div class="dh-mode"></div>
      <div class="dh-panel">
        <div class="dh-spd"><b data-k="spd">0</b><small>km/h</small></div>
        <div class="dh-rpm"><i></i></div>
        <div class="dh-v"><b data-k="gear">1</b><small>${L('Gang', 'Gear')}</small></div>
        <div class="dh-v"><b data-k="surf">-</b><small>${L('Grund', 'Ground')}</small></div>
        <div class="dh-v"><div class="dh-lamp" data-k="hb"></div><small>${L('Handbr.', 'Handbr.')}</small></div>
        <div class="dh-v"><div class="dh-lamp nos" data-k="nos"></div><small>Nitro</small></div>
      </div>
      <div class="dh-keys">
        <div><kbd>W</kbd><kbd>S</kbd>${L('Gas, Bremse und rückwärts', 'throttle, brake and reverse')}</div>
        <div><kbd>A</kbd><kbd>D</kbd>${L('lenken', 'steer')} · <kbd>␣</kbd>${L('Handbremse', 'handbrake')} · <kbd>⇧</kbd>Nitro</div>
        <div><kbd>V</kbd>${L('Kamera', 'camera')} · <kbd>N</kbd>${L('Fahrzeug', 'vehicle')} · <kbd>R</kbd>${L('zurück auf die Straße', 'back on the road')}</div>
        <div><kbd>K</kbd>${L('aussteigen', 'exit')} · <kbd>M</kbd>${L('Karte', 'map')}</div>
      </div>`;
    document.body.appendChild(el);
    this.hv = {};
    el.querySelectorAll('[data-k]').forEach(b => { this.hv[b.dataset.k] = b; });
    this.msgEl = el.querySelector('.dh-msg'); this.rpmEl = el.querySelector('.dh-rpm i'); this.modeEl = el.querySelector('.dh-mode');
  }

  flash(text, sec = 2.4) {
    if (!this.msgEl) return;
    this.msgEl.textContent = text;
    this.msgEl.classList.add('on');
    clearTimeout(this.msgT);
    this.msgT = setTimeout(() => this.msgEl.classList.remove('on'), sec * 1000);
  }

  drawHud() {
    const s = this.st, H = this.hv;
    this.hudT = (this.hudT || 0) + 1;
    if (this.hudT % 3) return;
    H.spd.textContent = Math.round(Math.abs(s.vf) * 3.6);
    H.gear.textContent = s.gear < 0 ? 'R' : Math.abs(s.vf) < 0.3 && !s.thr ? 'N' : String(s.gear);
    H.surf.textContent = this.surface(s.x, s.z) >= 0.9 * (1 - (this.app.U ? this.app.U.uSnow.value : 0) * 0.45) ? L('Straße', 'Road') : L('Gelände', 'Off-road');
    H.hb.classList.toggle('on', !!s.hb); H.nos.classList.toggle('on', !!s.nitro);
    this.rpmEl.style.height = Math.round(s.rpm * 100) + '%';
    this.modeEl.textContent = (L(CARS[this.type].de, CARS[this.type].en)) + ' · ' + [L('Verfolger', 'Chase'), L('Motorhaube', 'Hood'), L('Weit', 'Far')][this.view];
  }
}
