// Flugmodus (seit 18.10.2026, Taste P oder Knopf mit dem Flugzeug oben): ein leichtes Sportflugzeug mit echter Flugphysik
// (flightphys.js, Flächenmodell nach Khan und Nahon 2015) über der ganzen Welt. Maßstab: ein Feld sind 10 Meter (S),
// die Physik rechnet in Metern, das Modell ist in Metern gebaut und wird mit 1/S in die Welt gesetzt.
// Steuerung: W Nase hoch, S Nase runter, A rollt links, D rollt rechts, Q und E Seitenruder (auch Pfeil links und rechts),
// R oder Pfeil hoch mehr Gas, F oder Pfeil runter weniger Gas, B Bremse, V Kamera (Verfolger, Cockpit, frei),
// T Flughilfe (Standard an), P oder Esc aussteigen. Maus ziehen schaut sich um, Rad zoomt die Verfolgerkamera.
// Bruch an Boden, Wasser, Häusern und Bäumen: Staub, Rauch, nach drei Sekunden geht es in der Luft weiter.
import * as THREE from 'three';
import { NX, NY } from './scene.js';
import { Aircraft, qrot } from './flightphys.js';
import { buildPlane, updateLights } from './planemodel.js';
import { L } from '../i18n.js';

export const S = 10; // Meter je Feld
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const toward = (cur, want, step) => (cur < want ? Math.min(want, cur + step) : Math.max(want, cur - step));
const ZEN_HIGH = new THREE.Color('#2a5cab'); // Himmel in dünner Luft

// Seit 27.10.2026 auch auf der nahtlosen Erde (earth3d/earthflight.js): der Boden kommt über opts.groundY (Feldmaße,
// Standard app.groundY der Inselwelt), Grenzen der Welt in bounds(), die Erde überschreibt beides.
export class Flight {
  constructor(stage, app, fx, opts = {}) {
    this.stage = stage; this.app = app; this.fx = fx;
    const gY = opts.groundY || ((x, z) => (app.groundY ? app.groundY(x, z) : 0));
    this.gY = gY;
    this.maxLook = opts.maxLook || 9;
    this.active = false;
    this.air = new Aircraft();
    const P = buildPlane(stage.renderer); // detailreiches Modell in render/planemodel.js
    Object.assign(this, P);
    this.group = new THREE.Group();
    this.group.add(P.root);
    this.group.scale.setScalar(1 / S);
    this.group.visible = false;
    stage.scene.add(this.group);
    this.keys = new Set();
    this.inp = { pitch: 0, roll: 0, yaw: 0 };
    this.assist = true;
    this.view = 0; // 0 Verfolger, 1 Cockpit, 2 frei
    this.camPos = new THREE.Vector3(); this.look = { yaw: 0, pitch: 0, drag: false, dist: 1.7 };
    this.safe = null; this.safeT = 0; this.crashT = 0; this.agl = 0; this.shadowAt = new THREE.Vector3();
    this.propA = 0;
    this.env = {
      ground: (x, z) => Math.max(gY(x / S, z / S), this.sea()) * S,
      water: (x, z) => gY(x / S, z / S) < this.sea() + 0.01,
      normal: (x, z) => {
        const e = 2, h0 = gY((x - e) / S, z / S), h1 = gY((x + e) / S, z / S), h2 = gY(x / S, (z - e) / S), h3 = gY(x / S, (z + e) / S);
        const nx = -(h1 - h0) * S / (2 * e), nz = -(h3 - h2) * S / (2 * e), l = Math.hypot(nx, 1, nz);
        return [nx / l, 1 / l, nz / l];
      },
      obstacle: (x, z) => this.obstacle(x, z),
    };
    this.hud();
    this.input();
  }

  sea() { return (this.fx ? this.fx.rise : 0) + 0.02; }

  // Höhe von Häusern und Bäumen an einer Stelle (Meter), 0 wenn frei
  obstacle(x, z) {
    const st = this.app.st; if (!st) return 0;
    const X = x / S, Z = z / S, tx = Math.floor(X + NX / 2), ty = Math.floor(Z + NY / 2);
    if (tx < 0 || ty < 0 || tx >= NX || ty >= NY) return 0;
    const i = ty * NX + tx, rt = st._rt, g = this.gY(X, Z);
    const bid = rt.bldAt[i];
    if (bid) {
      const b = rt.bById.get(bid);
      if (b && b.t !== 'feld' && b.t !== 'park' && b.t !== 'zentrum') {
        const m = this.app.buildingsRef && this.app.buildingsRef.meshes.get(bid);
        const h = m && m.userData.g ? (m.userData.g.h || 0.5) * (m.userData.baseScale || 1) : 0.6;
        return (g + h) * S;
      }
    }
    if (st.tiles.tree[i]) return (g + 1.15) * S;
    return 0;
  }

  // ---------- Steuerung ----------
  input() {
    const K = {
      w: 'down', s: 'up', a: 'left', d: 'right', q: 'yl', e: 'yr', arrowleft: 'yl', arrowright: 'yr',
      r: 'thr+', arrowup: 'thr+', f: 'thr-', arrowdown: 'thr-', b: 'brake', shift: 'boost',
    };
    window.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === 'p') { e.preventDefault(); e.stopImmediatePropagation(); this.toggle(); return; }
      if (!this.active) return;
      if (k === 'escape') { if (!this.app.mapOpen) { e.stopImmediatePropagation(); this.exit(); } return; }
      if (k === 'v') { this.view = (this.view + 1) % 3; this.look.yaw = 0; this.look.pitch = 0; this.flash([L('Kamera: Verfolger', 'Camera: chase'), L('Kamera: Cockpit', 'Camera: cockpit'), L('Kamera: frei (Maus ziehen)', 'Camera: free (drag mouse)')][this.view]); e.stopImmediatePropagation(); return; }
      if (k === 't') { this.assist = !this.assist; this.flash(this.assist ? L('Flughilfe an', 'Flight assist on') : L('Flughilfe aus: du fliegst ganz allein', 'Flight assist off: you are on your own')); e.stopImmediatePropagation(); return; }
      if (k === 'g') { e.stopImmediatePropagation(); return; } // kein Geist im Cockpit
      if (K[k]) { this.keys.add(K[k]); e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    window.addEventListener('keyup', e => { const k = K[e.key.toLowerCase()]; if (k) this.keys.delete(k); }, true);
    window.addEventListener('blur', () => this.keys.clear());
    const cv = this.stage.renderer.domElement;
    cv.addEventListener('pointerdown', e => { if (this.active) { this.look.drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; } });
    window.addEventListener('pointermove', e => {
      if (!this.active || !this.look.drag || e.pointerId !== this.look.drag.id) return;   // je Finger (Handy: Knüppel links)
      const dx = e.clientX - this.look.drag.x, dy = e.clientY - this.look.drag.y;
      this.look.drag = { x: e.clientX, y: e.clientY };
      this.look.yaw -= dx * 0.006; this.look.pitch = clamp(this.look.pitch + dy * 0.004, -1.2, 1.2);
    });
    window.addEventListener('pointerup', e => { if (this.look.drag && e.pointerId === this.look.drag.id) this.look.drag = false; });
    cv.addEventListener('wheel', e => { if (!this.active) return; e.preventDefault(); e.stopImmediatePropagation(); this.look.dist = clamp(this.look.dist * (1 + Math.sign(e.deltaY) * 0.1), 0.9, this.maxLook); }, { passive: false, capture: true });
  }

  toggle() { if (this.active) this.exit(); else this.enter(); }

  enter() {
    const app = this.app;
    if (!app.st || this.active || app.mapOpen) return;
    if ((app.interior && (app.interior.active || app.interior.opening)) || (app.timelapse && app.timelapse.active)) return;
    if (app.ghostActive && app.ghostActive() && app.ghostExit) app.ghostExit();
    const cam = this.stage.camera, tg = this.stage.controls.target;
    this.saved = { near: cam.near, fov: cam.fov, far: cam.far };
    // Die Himmelskugel (Radius 900) würde aus großer Höhe alles verdecken, was weiter weg ist: im Flug zuerst und ohne Tiefentest zeichnen
    const sky = this.stage.sky; sky.renderOrder = -1; sky.material.depthTest = false;
    const dir = new THREE.Vector3(tg.x - cam.position.x, 0, tg.z - cam.position.z);
    const heading = dir.lengthSq() > 1e-6 ? Math.atan2(dir.x, dir.z) : 0;
    this.spawn(tg.x, tg.z, heading);
    this.active = true; app.flying = true;
    this.stage.controls.enabled = false;
    cam.near = 0.03; cam.updateProjectionMatrix();
    this.group.visible = true;
    this.inp = { pitch: 0, roll: 0, yaw: 0 };
    this.keys.clear();
    this.camPos.set(0, 0, 0); this.camInit = false;
    document.body.classList.add('flight-mode');
    this.hudEl.classList.add('show');
    if (app.sound) app.sound.start();
    if (this.onEnter) this.onEnter();
    this.flash(L('Du fliegst. W drückt die Nase runter, S zieht hoch, A und D kippen nach links und rechts, R und F geben Gas, Shift ist Turbo. P oder Esc steigt aus.', 'You are flying. W pushes the nose down, S pulls up, A and D bank left and right, R and F throttle, Shift is turbo. P or Esc to leave.'), 6);
  }

  // in der Luft beginnen: 80 m über Grund, Blickrichtung, 40 m/s, 55 Prozent Gas (Reiseflug um 145 km/h)
  spawn(X, Z, heading) {
    let hi = 0;
    for (let dz = -3; dz <= 3; dz += 1.5) for (let dx = -3; dx <= 3; dx += 1.5) hi = Math.max(hi, this.gY(X + dx, Z + dz), this.sea());
    this.air.place([X * S, (hi + 8) * S, Z * S], heading, 40);
    this.air.ctl.throttle = 0.55; this.air.ctl.brake = 0; this.air.ctl.boost = 0;
    this.air.accum = 0;
    this.safe = { x: X, z: Z, h: heading }; this.crashT = 0;
  }

  exit() {
    if (!this.active) return;
    const app = this.app, cam = this.stage.camera, c = this.stage.controls;
    this.active = false; app.flying = false;
    this.group.visible = false;
    document.body.classList.remove('flight-mode');
    this.hudEl.classList.remove('show');
    const p = this.air.pos, X = p[0] / S, Z = p[2] / S;
    const cx = clamp(X, -NX / 2 + 4, NX / 2 - 4), cz = clamp(Z, -NY / 2 + 4, NY / 2 - 4);
    c.target.set(cx, Math.max(0, Math.min(3, this.gY(cx, cz))), cz);
    const h = this.air.heading;
    cam.position.set(cx - Math.sin(h) * 22, c.target.y + 20, cz - Math.cos(h) * 22);
    cam.up.set(0, 1, 0);
    if (this.saved) { cam.near = this.saved.near; cam.fov = this.saved.fov; cam.far = this.saved.far; cam.updateProjectionMatrix(); }
    const st = this.stage; st.sky.position.set(0, 0, 0); st.stars.position.set(0, 0, 0); st.sky.renderOrder = 0; st.sky.material.depthTest = true;
    if (app.water) { app.water.mesh.scale.set(1, 1, 1); if (app.water.floor) app.water.floor.scale.set(1, 1, 1); }
    c.enabled = true; c.update();
    if (app.sound) app.sound.engine(false);
  }

  // ---------- jedes Bild ----------
  update(dt, t) {
    if (!this.active) return;
    const app = this.app, air = this.air;
    if (app.mapOpen) { if (app.sound) app.sound.engine(false); return; } // bei offener Karte steht die Zeit im Cockpit still
    if (air.crash) {
      this.crashT += dt;
      if (this.crashT > 3) { const s = this.safe || { x: 0, z: 0, h: 0 }; this.spawn(s.x, s.z, s.h); this.group.visible = true; }
      this.camera(dt);
      if (app.sound) app.sound.engine(false);
      return;
    }
    // Eingaben weich hochfahren und zurückfedern
    const want = { pitch: (this.keys.has('up') ? 1 : 0) - (this.keys.has('down') ? 1 : 0), roll: (this.keys.has('right') ? 1 : 0) - (this.keys.has('left') ? 1 : 0), yaw: (this.keys.has('yr') ? 1 : 0) - (this.keys.has('yl') ? 1 : 0) };
    // Handy: Steuerknüppel analog, nach vorn drücken senkt die Nase (wie W), zur Seite kippt er (wie A und D)
    const T = this.touch;
    if (T) { const dz = v => (Math.abs(v) < 0.1 ? 0 : (v - Math.sign(v) * 0.1) / 0.9); want.pitch = clamp(want.pitch - dz(T.y), -1, 1); want.roll = clamp(want.roll + dz(T.x), -1, 1); }
    for (const k of ['pitch', 'roll', 'yaw']) this.inp[k] = toward(this.inp[k], want[k], (want[k] ? 3.5 : 4.5) * dt);
    const c = air.ctl;
    if (this.keys.has('thr+')) c.throttle = Math.min(1, c.throttle + 0.45 * dt);
    if (this.keys.has('thr-')) c.throttle = Math.max(0, c.throttle - 0.45 * dt);
    c.brake = this.keys.has('brake') ? 1 : 0;
    c.boost = this.keys.has('boost') && c.throttle > 0.05 ? 1 : 0;
    // Flughilfe: nahe der Normallage Querlage vorgeben, Flügel aufrichten, Höhe halten; sonst (Looping, Rückenflug,
    // Rolle) arbeitet sie nicht dagegen. Immer: Schiebewinkel weg und Schutz vor dem Überziehen.
    // Die Physik rechnet mit +x als "rechts", im rechtshändigen three.js ist +x aber die linke Flügelseite (Nase nach +z).
    // Darum gehen Rollen und Gieren mit umgekehrtem Vorzeichen hinein: D kippt nach rechts, E dreht die Nase nach rechts.
    let pitch = this.inp.pitch, roll = -this.inp.roll, yaw = -this.inp.yaw;
    const w = air.w, aoa = air.aoa, bank = air.bank, upright = air.up[1] > 0.2;
    const normal = upright && Math.abs(bank) < 75 * D2R && Math.abs(air.pitchAngle) < 50 * D2R;
    this.rollHold = Math.abs(this.inp.roll) > 0.9 ? (this.rollHold || 0) + dt : 0;
    if (this.assist && !air.onGround && !this.vacuum) { // im luftleeren Raum (Erde, Jet) halten die Lagedüsen selbst die Lage
      const noPitch = Math.abs(this.inp.pitch) < 0.05;
      // A und D geben eine Querlage bis 60 Grad vor, loslassen richtet auf. Länger als 1,2 s halten rollt frei weiter (Rolle)
      if (normal && this.rollHold < 1.2) {
        const lim = Math.abs(this.inp.roll) < 0.05 ? 0.6 : 1;
        roll = clamp(1.8 * (-this.inp.roll * 60 * D2R - bank) + 0.45 * w[2], -lim, lim);
      }
      if (Math.abs(this.inp.yaw) < 0.05) yaw += clamp(2.6 * air.slipAngle, -0.5, 0.5);
      if (noPitch && normal) {
        pitch += clamp(0.6 * (1 / Math.max(0.4, Math.cos(bank)) - 1), 0, 0.45); // in der Kurve mitziehen
        pitch += clamp(0.35 * w[0], -0.3, 0.3); // Nicken dämpfen
        if (this.holdAlt !== false) pitch += clamp(-air.vel[1] * 0.035, -0.25, 0.25); // Höhe halten (nicht beim Raketenschub der Erde)
        // Abfangen kurz vor dem Boden: unter 8 m und schneller als 2 m/s sinkend
        if (this.agl * S < 8 && air.vel[1] < -2) pitch += clamp((-air.vel[1] - 2) * 0.14, 0, 0.5);
      }
      if (aoa > 11.5 * D2R && pitch > 0) pitch *= Math.max(0.15, 1 - (aoa - 11.5 * D2R) / (3 * D2R));
      if (aoa > 14 * D2R) pitch -= 0.25;
    }
    c.pitch = clamp(pitch, -1, 1); c.roll = clamp(roll, -1, 1); c.yaw = clamp(yaw, -1, 1);
    air.update(dt, this.env);
    if (air.crash) { this.onCrash(); return; }
    this.bounds();
    const X = air.pos[0] / S, Z = air.pos[2] / S;
    // sichere Stelle merken (für den Neustart nach einem Bruch)
    this.agl = air.pos[1] / S - Math.max(this.gY(X, Z), this.sea());
    this.safeT += dt;
    if (this.safeT > 1 && this.agl > 4 && !air.onGround) { this.safeT = 0; this.safe = { x: X, z: Z, h: air.heading }; }
    this.sync(dt);
    this.camera(dt);
    this.altitudeView();
    this.effects(dt);
    this.drawHud();
    const rpm = clamp(0.22 + c.throttle * 0.62 + Math.min(1, air.speed / 60) * 0.16, 0, 1);
    const stall = !air.onGround && air.speed > 5 && aoa > (this.stallAoA || 13) * D2R;
    if (app.sound) app.sound.engine(true, rpm, c.throttle, air.speed, stall);
    this.rpm = rpm;
    void t;
  }

  // weit außerhalb der Welt: zurück an den Rand, Richtung Mitte (die Erde wandert stattdessen mit, earthflight.js)
  bounds() {
    const air = this.air, X = air.pos[0] / S, Z = air.pos[2] / S;
    const lim = 400 + Math.max(0, air.pos[1] / S) * 1.5; // hoch oben darf man weiter hinaus, man sieht die Welt ja noch
    if (Math.abs(X) > lim || Math.abs(Z) > lim || air.pos[1] > 40000) { // keine Höhengrenze, die Luft wird von selbst zu dünn
      this.spawn(clamp(X, -300, 300), clamp(Z, -300, 300), Math.atan2(-X, -Z));
      this.flash(L('Der Wind trägt dich zurück zur Welt.', 'The wind carries you back to the world.'));
    }
  }

  // Modell an die Physik: Lage, Ruder, Propeller
  sync(dt) {
    const a = this.air;
    this.group.position.set(a.pos[0] / S, a.pos[1] / S, a.pos[2] / S);
    this.group.quaternion.set(a.q[0], a.q[1], a.q[2], a.q[3]);
    const sf = a.spec.surfaces;
    const flap = n => (sf.find(s => s.name === n) || { flap: 0 }).flap;
    this.ail.L.rotation.x = -flap('wingL');
    this.ail.R.rotation.x = -flap('wingR');
    this.elev.rotation.x = -flap('htail');
    this.rud.rotation.y = flap('vtail');
    const rpm = this.rpm || 0.3;
    this.propA += dt * (8 + rpm * 120);
    this.prop.rotation.z = this.propA;
    // schnell drehend sieht man keine Blätter mehr, nur die helle Scheibe (sonst steht das Blatt im Bild still)
    this.prop.visible = rpm < 0.45;
    this.blur.visible = rpm >= 0.3;
    this.blur.material.opacity = clamp((rpm - 0.3) * 2.2, 0, 0.85);
    this.blur.rotation.z = -this.propA * 0.013; // stroboskopisch langsam drehende Schlieren
    const boost = this.air.ctl.boost ? 1 : 0;
    this.flameK = (this.flameK || 0) + (boost * (0.75 + Math.random() * 0.25) - (this.flameK || 0)) * Math.min(1, dt * 12);
    this.flameMat.opacity = this.flameK; this.flame.visible = this.flameK > 0.02; this.flame.scale.setScalar(0.8 + this.flameK * 0.5);
    updateLights(this.lights, (this.lightT = (this.lightT || 0) + dt), this.app.night || 0);
  }

  camera(dt) {
    const a = this.air, cam = this.stage.camera, tg = this.stage.controls.target;
    const P = new THREE.Vector3(a.pos[0] / S, a.pos[1] / S, a.pos[2] / S);
    const f = new THREE.Vector3(...a.forward), up = new THREE.Vector3(...a.up);
    tg.copy(P);
    const inside = this.view === 1 && !a.crash;
    for (const m of this.hideInCockpit) m.visible = !inside;
    if (inside) {
      // Cockpit: auf dem linken Sitz (+x) in Augenhöhe des Piloten, die Figur ist ausgeblendet. Durch Frontscheibe und
      // Seitenfenster sieht man hinaus, vorne Instrumentenbrett, Haube und Propeller, oben der Flügel
      const eye = new THREE.Vector3(...qrot(a.q, this.eye || [0.27, 0.73, 0.24])).divideScalar(S).add(P);
      cam.position.copy(eye); cam.up.copy(up);
      const look = f.clone().addScaledVector(up, 0.06).applyAxisAngle(up, this.look.yaw); // Blick leicht über die Haube
      cam.lookAt(eye.clone().add(look));
      if (cam.fov !== 70) { cam.fov = 70; cam.updateProjectionMatrix(); }
      this.look.yaw *= this.look.drag ? 1 : Math.exp(-dt * 1.5);
      return;
    }
    if (cam.fov !== 52) { cam.fov = 52; cam.updateProjectionMatrix(); } // weiter als die Gottkamera: Tempo spürbar
    cam.up.set(0, 1, 0);
    // Verfolger: hinter und über dem Flugzeug, Richtung aus Nase und Flugbahn, weich nachgeführt
    const v = new THREE.Vector3(...a.vel);
    const dir = f.clone();
    if (v.lengthSq() > 25) dir.lerp(v.normalize(), 0.45);
    dir.y *= 0.6; dir.normalize();
    let yaw = this.look.yaw, pitch = this.look.pitch;
    if (this.view === 2) { yaw = this.look.yaw + Math.PI * 0.75; pitch = 0.25 + this.look.pitch; }
    const back = dir.clone().multiplyScalar(-1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const side = new THREE.Vector3().crossVectors(back, new THREE.Vector3(0, 1, 0)).normalize();
    back.applyAxisAngle(side, -pitch);
    const want = P.clone().addScaledVector(back, this.look.dist).add(new THREE.Vector3(0, 0.55 + this.look.dist * 0.1, 0));
    // nicht unter den Boden
    const gy = Math.max(this.gY(want.x, want.z), this.sea()) + 0.25;
    if (want.y < gy) want.y = gy;
    if (this.relCam) {
      // Erde: nachgeführt wird der Abstand zum Flugzeug, nicht die Lage (sonst hängt die Kamera bei Mach 10 kilometerweit
      // zurück), dazu ein kleiner, begrenzter Nachlauf fürs Tempogefühl
      const off = want.clone().sub(P).add(new THREE.Vector3(...a.vel).multiplyScalar(-0.08 / S).clampLength(0, this.look.dist * 0.35));
      if (!this.camInit || !this.camOff) { this.camOff = off.clone(); this.camInit = true; }
      this.camOff.lerp(off, 1 - Math.exp(-dt * (a.crash ? 1.5 : 6)));
      this.camPos.copy(P).add(this.camOff);
      const g2 = Math.max(this.gY(this.camPos.x, this.camPos.z), this.sea()) + 0.25;
      if (this.camPos.y < g2) this.camPos.y = g2;
    } else {
      if (!this.camInit) { this.camPos.copy(want); this.camInit = true; }
      this.camPos.lerp(want, 1 - Math.exp(-dt * (a.crash ? 1.5 : 6)));
    }
    cam.position.copy(this.camPos);
    cam.lookAt(P.clone().addScaledVector(f, 0.6));
    if (!this.look.drag && this.view === 0) { this.look.yaw *= Math.exp(-dt * 1.2); this.look.pitch *= Math.exp(-dt * 1.2); }
  }

  // Große Höhe: Nebel, Sichtweite, Himmel, Meer und Schatten wachsen mit der Höhe der Kamera mit (setTime setzt den
  // Nebel jedes Bild neu, hier kommt der Anteil der Höhe dazu). Nahe Ebene nach Ansicht, damit die Küste von oben nicht flimmert.
  altitudeView() {
    const st = this.stage, cam = st.camera, fog = st.scene.fog, h = Math.max(0, cam.position.y);
    // Mindestens so weit sehen wie in der weitesten Gottansicht (dort Nebel bis rund 1270), dazu die Höhe: der Boden liegt von oben
    // schräg gesehen das 1,5 bis 4 fache der Höhe entfernt, dort soll die Luft klar sein, Dunst erst zum Horizont. Wetternebel bleibt dichter.
    const wk = clamp(fog.far / 476, 0.25, 1);
    fog.near += (290 + h * 1.5) * wk; fog.far += (830 + h * 6) * wk;
    const w = this.app.water;
    if (w) {
      w.uniforms.fogNear.value = fog.near; w.uniforms.fogFar.value = fog.far;
      const k = Math.max(1, (fog.far * 1.15 + Math.hypot(cam.position.x, cam.position.z)) / 800); // das Meer ist 1600 breit
      w.mesh.scale.set(k, 1, k); if (w.floor) w.floor.scale.set(k, 1, k);
    }
    const far = Math.max(2400, fog.far + 400), near = this.view === 1 ? 0.012 : clamp(this.look.dist * 0.3, 0.05, 1);
    if (Math.abs(cam.far - far) > 40 || cam.near !== near) { cam.far = far; cam.near = near; cam.updateProjectionMatrix(); }
    st.sky.position.copy(cam.position); st.stars.position.copy(cam.position); st.moon.position.add(cam.position);
    const k2 = clamp(h / 900, 0, 0.75);
    if (k2 > 0) st.sky.material.uniforms.zen.value.lerp(ZEN_HIGH, k2);
    // Schatten auf den Boden vor dem Flugzeug legen, nicht auf das Flugzeug in der Luft
    const a = this.air, f = a.forward, X = a.pos[0] / S, Z = a.pos[2] / S, fl = Math.hypot(f[0], f[2]) || 1, ahead = Math.min(120, Math.max(0, this.agl) * 0.8);
    const sx = X + f[0] / fl * ahead, sz = Z + f[2] / fl * ahead;
    this.shadowAt.set(sx, Math.max(this.gY(sx, sz), this.sea()), sz);
    if (this.agl < 6) this.shadowAt.set(X, a.pos[1] / S, Z);
  }

  // Wirbel an den Flügelspitzen bei hoher Last, Staub unter dem Propeller in Bodennähe
  effects(dt) {
    const a = this.air, fx = this.fx;
    if (!fx) return;
    if (a.load > 2.3 || (a.aoa > 10 * D2R && a.speed > 32)) {
      for (const s of [-1, 1]) {
        if (Math.random() > dt * 40) continue;
        const p = qrot(a.q, [s * 4.6, 1.0, 0.0]);
        fx.smoke.emit({ x: (a.pos[0] + p[0]) / S, y: (a.pos[1] + p[1]) / S, z: (a.pos[2] + p[2]) / S, life: 0.9, size: 0.035, grow: 1.5, c: [1, 1, 1], a: 0.5, drag: 0.9 });
      }
    }
    if (this.agl < 0.9 && a.ctl.throttle > 0.4 && Math.random() < dt * 20 * a.ctl.throttle) {
      const X = a.pos[0] / S, Z = a.pos[2] / S;
      fx.smoke.emit({ x: X + (Math.random() - 0.5) * 0.3, y: this.gY(X, Z) + 0.03, z: Z + (Math.random() - 0.5) * 0.3, vx: (Math.random() - 0.5) * 0.6, vy: 0.15, vz: (Math.random() - 0.5) * 0.6, life: 1.2, size: 0.12, grow: 1.4, c: [0.8, 0.74, 0.62], a: 0.3, drag: 0.94 });
    }
  }

  onCrash() {
    const a = this.air, cr = a.crash, fx = this.fx;
    const X = cr.at[0] / S, Y = cr.at[1] / S, Z = cr.at[2] / S;
    this.crashT = 0;
    if (fx) {
      if (cr.why === 'wasser') { for (let k = 0; k < 4; k++) fx.splash(X + (Math.random() - 0.5) * 0.4, Math.max(Y, this.sea()), Z + (Math.random() - 0.5) * 0.4); }
      else {
        fx.dust(X, Y, Z, 1.6);
        for (let i = 0; i < 40; i++) fx.smoke.emit({ x: X + (Math.random() - 0.5) * 0.4, y: Y + 0.1, z: Z + (Math.random() - 0.5) * 0.4, vx: (Math.random() - 0.5) * 0.3, vy: 0.5 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 0.3, life: 3 + Math.random() * 3, size: 0.3 + Math.random() * 0.4, grow: 2.5, c: [0.3, 0.29, 0.28], a: 0.5, drag: 0.98 });
        for (let i = 0; i < 24; i++) fx.glow.emit({ x: X, y: Y + 0.1, z: Z, vx: (Math.random() - 0.5) * 2, vy: 1 + Math.random() * 2, vz: (Math.random() - 0.5) * 2, g: -5, life: 0.6 + Math.random() * 0.6, size: 0.12, c: [1, 0.55, 0.15] });
      }
      fx.shake = Math.max(fx.shake || 0, 0.8);
    }
    this.group.visible = false;
    const why = { wasser: L('ins Wasser gestürzt', 'crashed into the water'), hart: L('zu hart aufgesetzt', 'landed far too hard'), hindernis: L('gegen ein Haus oder einen Baum geflogen', 'flew into a house or a tree'), heck: L('mit dem Heck aufgeschlagen', 'struck the tail'), boden: L('am Boden zerschellt', 'smashed into the ground') }[cr.why] || L('abgestürzt', 'crashed');
    this.flash(L(`Bruch: ${why}. In drei Sekunden geht es weiter.`, `Crash: ${why}. Back in the air in three seconds.`), 3);
  }

  // ---------- Anzeige ----------
  hud() {
    if (!document.getElementById('flightCss')) {
      const css = document.createElement('style');
      css.id = 'flightCss';
      css.textContent = `
#flightHud { position: fixed; inset: 0; pointer-events: none; z-index: 30; display: none; font-family: var(--sans, Manrope, sans-serif); color: #fdf7ea; }
#flightHud.show { display: block; }
body.flight-mode #dock, body.flight-mode #prayers, body.flight-mode #cards, body.flight-mode .cards { opacity: 0; pointer-events: none; }
#flightHud .fh-panel { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); display: flex; align-items: center; gap: 15px; padding: 8px 18px;
  background: rgba(14, 26, 32, 0.42); border: 1px solid rgba(255, 220, 150, 0.35); border-radius: 18px; backdrop-filter: blur(10px) saturate(1.2); -webkit-backdrop-filter: blur(10px) saturate(1.2); box-shadow: 0 8px 30px rgba(0,0,0,0.25); }
#flightHud .fh-v { text-align: center; min-width: 52px; }
#flightHud .fh-v b { display: block; font-size: 21px; font-weight: 700; letter-spacing: 0.02em; text-shadow: 0 1px 8px rgba(0,0,0,0.35); }
#flightHud .fh-v small { font-size: 9.5px; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.75; }
#flightHud .fh-thr { width: 10px; height: 44px; border-radius: 6px; background: rgba(255,255,255,0.15); position: relative; overflow: hidden; }
#flightHud .fh-thr i { position: absolute; left: 0; right: 0; bottom: 0; background: linear-gradient(#ffd98a, #e9b44c); }
#flightHud canvas { width: 92px; height: 92px; }
#flightHud .fh-warn { position: absolute; left: 50%; top: 22%; transform: translateX(-50%); font-family: var(--serif, Fraunces, serif); font-size: 34px; letter-spacing: 0.18em; color: #ff8a6a; text-shadow: 0 2px 14px rgba(0,0,0,0.5); opacity: 0; transition: opacity .15s; }
#flightHud .fh-warn.on { opacity: 1; animation: fhBlink 0.5s steps(2) infinite; }
@keyframes fhBlink { 50% { opacity: 0.25; } }
#flightHud .fh-msg { position: absolute; left: 50%; top: 14%; transform: translateX(-50%); max-width: 70vw; text-align: center; font-family: var(--serif, Fraunces, serif); font-style: italic; font-size: 20px; text-shadow: 0 2px 12px rgba(0,0,0,0.6); opacity: 0; transition: opacity .5s; }
#flightHud .fh-msg.on { opacity: 1; }
#flightHud .fh-keys { position: absolute; left: 22px; bottom: 22px; font-size: 12px; line-height: 1.7; opacity: 0.85; text-shadow: 0 1px 6px rgba(0,0,0,0.6); }
#flightHud .fh-keys kbd { display: inline-block; min-width: 16px; padding: 0 5px; margin-right: 3px; border-radius: 4px; background: rgba(255,255,255,0.18); border: 1px solid rgba(255,255,255,0.25); font: 11px var(--sans, sans-serif); text-align: center; }
#flightHud .fh-mode { position: absolute; right: 24px; bottom: 26px; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; opacity: 0.85; text-align: right; text-shadow: 0 1px 6px rgba(0,0,0,0.6); }
@media (max-width: 900px) { #flightHud .fh-keys { display: none; } #flightHud .fh-panel { gap: 12px; padding: 10px 14px; } #flightHud .fh-v b { font-size: 20px; } }
`;
      document.head.appendChild(css);
    }
    const el = this.hudEl = document.createElement('div');
    el.id = 'flightHud';
    el.innerHTML = `
      <div class="fh-msg"></div>
      <div class="fh-warn">${L('ÜBERZIEHEN', 'STALL')}</div>
      <div class="fh-panel">
        <canvas width="240" height="240"></canvas>
        <div class="fh-v"><b data-k="spd">0</b><small>km/h</small></div>
        <div class="fh-v"><b data-k="alt">0</b><small>${L('Höhe m', 'Alt m')}</small></div>
        <div class="fh-v"><b data-k="agl">0</b><small>${L('über Grund', 'above ground')}</small></div>
        <div class="fh-v"><b data-k="vs">0</b><small>${L('Steigen m/s', 'Climb m/s')}</small></div>
        <div class="fh-thr"><i></i></div>
        <div class="fh-v"><b data-k="thr">0</b><small>${L('Gas %', 'Throttle %')}</small></div>
        <div class="fh-v"><b data-k="aoa">0</b><small>${L('Anstellw.', 'AoA')} °</small></div>
        <div class="fh-v"><b data-k="g">1.0</b><small>${L('Last g', 'Load g')}</small></div>
        <div class="fh-v"><b data-k="hdg">0</b><small>${L('Kurs', 'Heading')}</small></div>
        <div class="fh-v"><b data-k="rho">1.23</b><small>${L('Luft kg/m³', 'Air kg/m³')}</small></div>
      </div>
      <div class="fh-keys">
        <div><kbd>W</kbd><kbd>S</kbd>${L('Nase runter, hoch', 'nose down, up')}</div>
        <div><kbd>A</kbd><kbd>D</kbd>${L('rollen links, rechts', 'roll left, right')}</div>
        <div><kbd>Q</kbd><kbd>E</kbd>${L('Seitenruder', 'rudder')}</div>
        <div><kbd>R</kbd><kbd>F</kbd>${L('Gas mehr, weniger', 'throttle up, down')} · <kbd>⇧</kbd>${L('Turbo', 'turbo')}</div>
        <div><kbd>B</kbd>${L('Bremse', 'brake')} · <kbd>V</kbd>${L('Kamera', 'camera')} · <kbd>T</kbd>${L('Flughilfe', 'assist')}</div>
        <div><kbd>P</kbd>${L('aussteigen', 'exit')} · <kbd>M</kbd>${L('Karte', 'map')}</div>
      </div>
      <div class="fh-mode"></div>`;
    document.body.appendChild(el);
    this.hv = {};
    el.querySelectorAll('[data-k]').forEach(b => { this.hv[b.dataset.k] = b; });
    this.ai = el.querySelector('canvas').getContext('2d');
    this.msgEl = el.querySelector('.fh-msg'); this.warnEl = el.querySelector('.fh-warn'); this.thrEl = el.querySelector('.fh-thr i'); this.modeEl = el.querySelector('.fh-mode');
  }

  flash(text, sec = 2.4) {
    if (!this.msgEl) return;
    this.msgEl.textContent = text;
    this.msgEl.classList.add('on');
    clearTimeout(this.msgT);
    this.msgT = setTimeout(() => this.msgEl.classList.remove('on'), sec * 1000);
  }

  drawHud() {
    const a = this.air, H = this.hv;
    this.hudT = (this.hudT || 0) + 1;
    if (this.hudT % 3 === 0) {
      H.spd.textContent = Math.round(a.speed * 3.6);
      H.alt.textContent = Math.round(a.pos[1]);
      H.rho.textContent = (a.rho || 1.225).toFixed(2);
      H.agl.textContent = Math.max(0, Math.round(this.agl * S));
      H.vs.textContent = (a.vel[1] >= 0 ? '+' : '') + a.vel[1].toFixed(1);
      H.thr.textContent = Math.round(a.ctl.throttle * 100);
      H.aoa.textContent = (a.aoa * R2D).toFixed(0);
      H.g.textContent = a.load.toFixed(1);
      const f = a.forward; // Kompass: Norden ist -z (oben auf der Karte), Osten +x
      H.hdg.textContent = String(Math.round(((Math.atan2(f[0], -f[2]) * R2D) % 360 + 360) % 360) % 360).padStart(3, '0');
      this.thrEl.style.height = Math.round(a.ctl.throttle * 100) + '%';
      this.modeEl.textContent = [L('Verfolger', 'Chase'), L('Cockpit', 'Cockpit'), L('Frei', 'Free')][this.view] + ' · ' + (this.assist ? L('Flughilfe an', 'Assist on') : L('Flughilfe aus', 'Assist off')) + (a.ctl.boost ? ' · TURBO' : '') + (a.onGround ? ' · ' + L('am Boden', 'on ground') : '');
    }
    const stall = !a.onGround && a.speed > 5 && a.aoa > (this.stallAoA || 13) * D2R && (a.rho || 1.225) > 0.03; // ohne Luft kein Überziehen
    this.warnEl.classList.toggle('on', stall);
    // künstlicher Horizont: Himmel und Erde nach Längs- und Querneigung, feste Flugzeugmarke
    const c = this.ai, W = 240, R = 112;
    c.clearRect(0, 0, W, W);
    c.save();
    c.beginPath(); c.arc(W / 2, W / 2, R, 0, Math.PI * 2); c.clip();
    c.translate(W / 2, W / 2);
    c.rotate(a.bank); // Physik-Querlage positiv = linke Seite unten, der Horizont dreht sich mit dem Uhrzeigersinn
    const off = a.pitchAngle * R2D * 3.2;
    c.fillStyle = '#6fb6d8'; c.fillRect(-W, -W * 2 + off, W * 2, W * 2);
    c.fillStyle = '#9a7a52'; c.fillRect(-W, off, W * 2, W * 2);
    c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(-W, off); c.lineTo(W, off); c.stroke();
    c.lineWidth = 1.5; c.font = '15px sans-serif'; c.fillStyle = '#fff'; c.textAlign = 'left';
    for (const d of [-20, -10, 10, 20]) { const y = off - d * 3.2, w = d % 20 ? 22 : 38; c.beginPath(); c.moveTo(-w, y); c.lineTo(w, y); c.stroke(); c.fillText(String(Math.abs(d)), w + 4, y + 5); }
    c.restore();
    c.strokeStyle = '#ffd98a'; c.lineWidth = 4;
    c.beginPath(); c.moveTo(W / 2 - 50, W / 2); c.lineTo(W / 2 - 14, W / 2); c.lineTo(W / 2, W / 2 + 12); c.lineTo(W / 2 + 14, W / 2); c.lineTo(W / 2 + 50, W / 2); c.stroke();
    c.strokeStyle = 'rgba(255,240,210,0.8)'; c.lineWidth = 3;
    c.beginPath(); c.arc(W / 2, W / 2, R, 0, Math.PI * 2); c.stroke();
    // Querneigungszeiger oben
    c.save(); c.translate(W / 2, W / 2); c.rotate(a.bank);
    c.fillStyle = '#ffd98a'; c.beginPath(); c.moveTo(0, -R + 4); c.lineTo(-8, -R + 18); c.lineTo(8, -R + 18); c.closePath(); c.fill();
    c.restore();
  }
}
