// Fliegen über der nahtlosen Erde (seit 27.10.2026, Naders Wunsch: "das Flugzeug, dieses Flugmodell, die Steuerung und
// alles von den Inselwelten, dazu einen Düsenjet, der viel, viel schneller ist, und so hoch, wie ich möchte").
// Erbt den Flug der Inselwelt (render/flight.js: Physik, Steuerung, Flughilfe, Kameras, Anzeige, Bruch) und tauscht nur
// die Welt: Boden aus earthview.groundWorld, keine Grenzen, stattdessen wandert der Ursprung der Erde mit dem Flugzeug
// (Lage, Geschwindigkeit und Drehung werden in den neuen Rahmen gedreht, so folgt der Flug der Krümmung der Kugel, schnell
// und hoch genug ist das eine Umlaufbahn). Zwei Flugzeuge: das Sportflugzeug der Inseln und ein Düsenjet mit Nachbrenner
// (Shift) und Rakete (X), J wechselt in der Luft. Die Physik rechnet in Metern (S = 10 je Einheit).
import * as THREE from 'three';
import { Flight, S } from '../render/flight.js';
import { Aircraft, lightPlane, jetPlane } from '../render/flightphys.js';
import { buildJet } from '../render/jetmodel.js';
import { lonLatOf } from './geo.js';
import { L } from '../i18n.js';

export class EarthFlight extends Flight {
  constructor(stage, app, earth) {
    super(stage, app, null, { groundY: (x, z) => earth.groundWorld(x, z), maxLook: 60000 });
    this.earth = earth;
    this.obstacle = () => 0;
    this.relCam = true; // Verfolgerkamera relativ zum Flugzeug (render/flight.js camera)
    const P = { root: this.root, prop: this.prop, blur: this.blur, ail: this.ail, elev: this.elev, rud: this.rud, flame: this.flame, flameMat: this.flameMat, lights: this.lights, hideInCockpit: this.hideInCockpit };
    this.kinds = {
      plane: { model: P, spec: lightPlane, eye: [0.27, 0.73, 0.24], dist: 1.7, stall: 13, speed: 45, agl: 120 },
      jet: { model: null, spec: jetPlane, eye: [0, 0.92, 3.45], dist: 2.6, stall: 22, speed: 230, agl: 600 },
    };
    this.type = 'plane';
    this.extraKeys();
    // Tastenhilfe: keine Karte auf der Erde, dafür Jet und Rakete
    const keys = this.hudEl.querySelector('.fh-keys');
    if (keys && keys.lastElementChild) keys.lastElementChild.innerHTML = `<kbd>P</kbd>${L('aussteigen', 'exit')} · <kbd>J</kbd>${L('Jet', 'jet')} · <kbd>X</kbd>${L('Rakete', 'rocket')}`;
  }

  // Flugzeug wählen: Modell, Physik, Kamera; in der Luft geht es mit gleicher Lage weiter
  setType(type) {
    const K = this.kinds[type];
    if (!K) return;
    if (type === 'jet' && !K.model) K.model = buildJet(this.stage.renderer);
    const old = this.active ? { pos: this.air.pos, heading: this.air.heading, pitch: this.air.pitchAngle, speed: this.air.speed } : null;
    this.type = type;
    this.group.clear();
    this.group.add(K.model.root);
    Object.assign(this, { prop: K.model.prop, blur: K.model.blur, ail: K.model.ail, elev: K.model.elev, rud: K.model.rud, flame: K.model.flame, flameMat: K.model.flameMat, lights: K.model.lights, hideInCockpit: K.model.hideInCockpit });
    this.eye = K.eye; this.stallAoA = K.stall; this.look.dist = K.dist;
    const thr = this.air ? this.air.ctl.throttle : 0.6;
    this.air = new Aircraft(K.spec());
    this.air.ctl.throttle = type === 'jet' ? Math.max(0.65, thr) : Math.min(0.8, thr);
    if (old) {
      this.air.place(old.pos, old.heading, Math.max(K.speed * 0.9, Math.min(old.speed, type === 'jet' ? 1e5 : 70)), old.pitch);
      this.flash(type === 'jet' ? L('Düsenjet: Shift Nachbrenner, X Rakete (auch im All)', 'Jet: Shift afterburner, X rocket (works in space too)') : L('Sportflugzeug', 'Light aircraft'));
    }
  }

  // eigene Tasten: X Rakete (halten), J Flugzeug wechseln
  extraKeys() {
    window.addEventListener('keydown', e => {
      if (!this.active || (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === 'x') { this.keys.add('rocket'); e.preventDefault(); e.stopImmediatePropagation(); }
      else if (k === 'j') { this.setType(this.type === 'jet' ? 'plane' : 'jet'); e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    window.addEventListener('keyup', e => { if (e.key.toLowerCase() === 'x') this.keys.delete('rocket'); }, true);
  }

  toggle() { if (this.active) this.exit(); else this.enter(this.type); }

  enter(type = this.type) {
    if (this.active) { if (type !== this.type) this.setType(type); return; }
    const app = this.app, cam = this.stage.camera, tg = this.stage.controls.target;
    if (app.stopFly) app.stopFly();
    this.saved = { near: cam.near, fov: cam.fov, far: cam.far };
    this.setType(type);
    const dir = new THREE.Vector3(tg.x - cam.position.x, 0, tg.z - cam.position.z);
    const heading = dir.lengthSq() > 1e-6 ? Math.atan2(dir.x, dir.z) : 0;
    // Höhe: über dem Blickziel, aus großer Höhe nicht höher als 9 km (Reiseflug), nah am Boden je Flugzeug
    const camAlt = Math.max(0, this.earth.alt || 0) * S;
    const K = this.kinds[this.type];
    this.spawn(tg.x, tg.z, heading, Math.max(K.agl, Math.min(camAlt * 0.6, 9000)));
    this.active = true; app.flying = true;
    this.stage.controls.enabled = false;
    this.group.visible = true;
    this.inp = { pitch: 0, roll: 0, yaw: 0 };
    this.keys.clear();
    this.camInit = false;
    document.body.classList.add('flight-mode');
    this.hudEl.classList.add('show');
    if (app.sound && app.sound.start) app.sound.start();
    this.flash(L('Du fliegst. W drückt die Nase runter, S zieht hoch, A und D kippen, R und F geben Gas, Shift ist Turbo, J wechselt das Flugzeug, P oder Esc steigt aus.', 'You are flying. W pushes the nose down, S pulls up, A and D bank, R and F throttle, Shift is turbo, J switches aircraft, P or Esc to leave.'), 6);
  }

  // in der Luft beginnen: Höhe über Grund in Metern (agl), Blickrichtung, Reisegeschwindigkeit des Flugzeugs
  spawn(X, Z, heading, agl) {
    const K = this.kinds[this.type];
    let hi = 0;
    for (let dz = -3; dz <= 3; dz += 1.5) for (let dx = -3; dx <= 3; dx += 1.5) hi = Math.max(hi, this.gY(X + dx, Z + dz), this.sea());
    this.air.place([X * S, hi * S + (agl || K.agl), Z * S], heading, K.speed);
    this.air.ctl.brake = 0; this.air.ctl.boost = 0; this.air.ctl.rocket = 0;
    if (this.type === 'plane') this.air.ctl.throttle = 0.55;
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
    const p = this.air.pos, X = p[0] / S, Z = p[2] / S, gy = Math.max(0, this.gY(X, Z));
    const agl = Math.max(2, p[1] / S - gy), h = this.air.heading;
    c.target.set(X, gy, Z);
    const d = Math.min(Math.max(30, agl * 1.4), 2e6);
    cam.position.set(X - Math.sin(h) * d * 0.7, gy + d * 0.7, Z - Math.cos(h) * d * 0.7);
    cam.up.set(0, 1, 0);
    if (this.saved) { cam.fov = this.saved.fov; cam.updateProjectionMatrix(); }
    const st = this.stage; st.sky.renderOrder = 0; st.sky.material.depthTest = true;
    c.enabled = true; c.update();
    if (app.sound && app.sound.engine) app.sound.engine(false);
    if (app.afterFlight) app.afterFlight();
  }

  // statt Grenzen: der Ursprung der Erde wandert mit, sobald das Flugzeug rund 800 m vom Ursprung weg ist
  bounds() {
    const a = this.air;
    if (Math.hypot(a.pos[0], a.pos[2]) > 800) this.rebase();
  }
  rebase() {
    const e = this.earth, a = this.air, cam = this.stage.camera;
    const pE = e.ecefOf(new THREE.Vector3(a.pos[0] / S, a.pos[1] / S, a.pos[2] / S));
    const camE = e.ecefOf(cam.position), cpE = e.ecefOf(this.camPos);
    const Mi0 = e.Mi.clone();
    const [lon, lat] = lonLatOf(pE[0], pE[1], pE[2]);
    e.setOrigin(lon, lat);
    const o = e.F.o, toW = E => new THREE.Vector3(E[0] - o[0], E[1] - o[1], E[2] - o[2]).applyMatrix4(e.M);
    const Rm = new THREE.Matrix4().multiplyMatrices(e.M, Mi0), qR = new THREE.Quaternion().setFromRotationMatrix(Rm);
    const p = toW(pE);
    a.pos = [p.x * S, p.y * S, p.z * S];
    const v = new THREE.Vector3(a.vel[0], a.vel[1], a.vel[2]).applyMatrix4(Rm);
    a.vel = [v.x, v.y, v.z];
    const q = new THREE.Quaternion(a.q[0], a.q[1], a.q[2], a.q[3]).premultiply(qR).normalize();
    a.q = [q.x, q.y, q.z, q.w];
    cam.position.copy(toW(camE)); this.camPos.copy(toW(cpE));
    if (this.camOff) this.camOff.applyMatrix4(Rm);
    this.safe = { x: p.x, z: p.z, h: a.heading };
  }

  // Nebel, Sicht und Himmel macht die Hauptschleife der Erde; hier nur der Schattenpunkt am Boden unter dem Flugzeug
  altitudeView() {
    const a = this.air, X = a.pos[0] / S, Z = a.pos[2] / S;
    this.shadowAt.set(X, Math.max(this.gY(X, Z), this.sea()), Z);
    if (this.agl < 6) this.shadowAt.set(X, a.pos[1] / S, Z);
  }

  update(dt, t) {
    if (!this.active) return;
    const c = this.air.ctl;
    c.rocket = this.type === 'jet' && this.keys.has('rocket') ? 1 : 0;
    this.holdAlt = !c.rocket && this.air.pos[1] < 30000; // mit Rakete und ganz oben hält die Flughilfe nur die Nase, nicht die Höhe
    this.vacuum = (this.air.rho ?? 1.2) < 0.01; // über rund 31 km: keine Flughilfe der Luft, die Lagedüsen dämpfen jede Drehung
    super.update(dt, t);
  }

  // Modell an die Physik; beim Jet zeigt die Flamme Nachbrenner und Rakete, kein Propeller
  sync(dt) {
    super.sync(dt);
    if (this.type !== 'jet') return;
    this.prop.visible = false; this.blur.visible = false;
    const c = this.air.ctl, want = Math.max(c.rocket ? 1 : 0, c.boost ? 0.85 : 0, (c.throttle - 0.6) * 0.5);
    this.flameK = (this.flameK || 0) + (want * (0.8 + Math.random() * 0.2) - (this.flameK || 0)) * Math.min(1, dt * 10);
    this.flameMat.opacity = this.flameK; this.flame.visible = this.flameK > 0.02;
    this.flame.scale.set(0.9 + this.flameK * 0.3, 0.9 + this.flameK * 0.3, 0.6 + this.flameK * (c.rocket ? 1.6 : 0.9));
  }

  // Anzeige: dazu Mach, große Höhen in km, Nachbrenner und Rakete
  drawHud() {
    super.drawHud();
    if (this.hudT % 3) return;
    const a = this.air, H = this.hv;
    const km = a.pos[1] > 20000;
    if (km) H.alt.textContent = (a.pos[1] / 1000).toFixed(1);
    if (this.altKm !== km) { this.altKm = km; H.alt.nextElementSibling.textContent = L('Höhe', 'Alt') + (km ? ' km' : ' m'); }
    H.agl.textContent = this.agl * S > 20000 ? (this.agl * S / 1000).toFixed(1) + ' km' : Math.max(0, Math.round(this.agl * S));
    if (this.type === 'jet') {
      const c = a.ctl, mach = a.speed / 340;
      this.modeEl.textContent += ` · Mach ${mach.toFixed(2)}` + (c.boost ? ' · ' + L('NACHBRENNER', 'AFTERBURNER') : '') + (c.rocket ? ' · ' + L('RAKETE', 'ROCKET') : '') + (a.pos[1] > 80000 ? ' · ' + L('WELTRAUM', 'SPACE') : '');
    } else this.modeEl.textContent += ' · ' + L('J: Düsenjet', 'J: jet');
  }
}
