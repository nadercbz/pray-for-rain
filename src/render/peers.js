// Der Mitspieler im Bild (seit 26.10.2026, Mehrspieler src/net/coop.js). Er schickt zehnmal pro Sekunde, wo er ist:
// - Gottansicht: ein goldener Ring am Boden, wohin er gerade schaut
// - Geist: dieselbe Figur wie der eigene Geist (Ghost.prototype.loadFigure auf einer schlanken Puppe), mit goldenem Ring
// - Auto: im Verkehr wie das eigene Auto (vehicles.demo zum Zeichnen, vehicles.extra, damit der Verkehr für ihn hält)
// - Flugzeug: ein zweites Modell aus planemodel.js
// Dazu ein Namensschild, das am Bildrand bleibt, wenn er außer Sicht ist; ein Klick darauf bringt die Kamera zu ihm.
// Zwischen den Meldungen wird weich nachgeführt, Auto und Flugzeug rechnen mit ihrem Tempo weiter (sonst ruckeln sie
// bei zehn Meldungen pro Sekunde).
import * as THREE from 'three';
import { Ghost } from './ghost.js';
import { buildPlane, updateLights } from './planemodel.js';
import { groundY } from './terrain.js';
import { L } from '../i18n.js';

const S = 10; // Meter je Feld (wie flight.js und drive.js)
const CSS = `
.coopTag { position: fixed; left: 0; top: 0; z-index: 8; pointer-events: none; display: flex; flex-direction: column; align-items: center; gap: 1px; transform: translate(-50%, -100%); transition: opacity 0.3s; font-family: var(--sans); }
.coopTag b { pointer-events: auto; cursor: pointer; padding: 4px 11px 4px 9px; border-radius: 999px; background: rgba(233, 180, 76, 0.94); color: #251a06; font-size: 12px; font-weight: 800; letter-spacing: 0.02em; white-space: nowrap; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3); display: flex; align-items: center; gap: 6px; }
.coopTag b::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #3f8f5a; box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.6); }
.coopTag small { font-size: 10.5px; color: var(--paper); text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8); white-space: nowrap; }
.coopTag i { width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 7px solid rgba(233, 180, 76, 0.94); }
.coopTag.edge i { display: none; }
.coopTag.away b::before { background: #c98a2a; }
.coopTag.lost b::before { background: #d9604c; }
`;
const MODE = () => ({ god: L('schaut von oben', 'watching from above'), ghost: L('als Geist unterwegs', 'walking as a spirit'), drive: L('fährt', 'driving'), fly: L('fliegt', 'flying') });

export class Peers {
  constructor(app) {
    this.app = app;
    this.st = null;        // letzte Meldung
    this.at = 0;           // wann sie kam
    this.vis = null;       // weich nachgeführter Zustand
    this.mode = null;
    const s = document.createElement('style'); s.textContent = CSS; document.head.append(s);
    this.tag = document.createElement('div');
    this.tag.className = 'coopTag';
    this.tag.style.opacity = 0; this.tag.style.visibility = 'hidden';
    this.tag.innerHTML = '<b></b><small></small><i></i>';
    this.tag.querySelector('b').onclick = () => { if (app.coopToFriend) app.coopToFriend(); };
    document.body.append(this.tag);
    this.v3 = new THREE.Vector3();
    this.car = { demo: { type: 'sedan', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, hex: '#e9b44c' }, extra: { id: -8, x: 0, z: 0, c: 1, s: 0, hl: 0.2, hw: 0.1, cur: 0 } };
  }

  get scene() { return this.app.stage.scene; }

  set(m) {
    if (!m || !m.m) return;
    this.st = m; this.at = performance.now();
    if (m.m !== this.mode) this.switchMode(m.m);
  }

  clear() {
    this.st = null; this.switchMode(null);
    this.hide();
  }

  hide() { this.tag.style.opacity = 0; this.tag.style.visibility = 'hidden'; }

  switchMode(m) {
    this.mode = m; this.vis = null;
    if (this.ghost) this.ghost.group.visible = false;
    if (this.ring) this.ring.visible = false;
    if (this.plane) this.plane.group.visible = false;
    this.carOff();
  }

  // ---------- Teile, erst beim ersten Bedarf gebaut ----------
  ringMesh() {
    if (this.ring) return this.ring;
    const g = new THREE.RingGeometry(0.16, 0.22, 48).rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
    this.ring.renderOrder = 6;
    if (this.app.stage.noAO) this.app.stage.noAO.add(this.ring);
    this.scene.add(this.ring);
    return this.ring;
  }

  ghostPuppet() {
    if (this.ghost || this.ghostLoading) return this.ghost;
    const own = this.app.ghost;
    if (!own || !own.figure) return null;
    this.ghostLoading = true;
    const P = Object.create(Ghost.prototype);
    Object.assign(P, {
      app: this.app,
      stage: { scene: this.scene, noAO: this.app.stage.noAO, aoOnly: null }, // ohne Abbild für die Umgebungsverdeckung
      uni: { uVat: { value: null }, uNrm: { value: null }, uVatSize: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uA: { value: new THREE.Vector4() }, uB: { value: new THREE.Vector4() }, uMix: { value: 0 }, uGlow: { value: 1 } },
      group: new THREE.Group(), cur: 'idle', prev: 'idle', mixT: 1,
    });
    P.group.visible = false;
    this.scene.add(P.group);
    P.loadFigure(own.figure).then(() => { this.ghost = P; this.ghostLoading = false; }).catch(e => { console.warn('coop ghost', e); this.ghostLoading = false; });
    return null;
  }

  planeModel() {
    if (this.plane) return this.plane;
    const P = buildPlane(this.app.stage.renderer);
    const group = new THREE.Group();
    group.add(P.root);
    group.scale.setScalar(1 / S);
    group.visible = false;
    this.scene.add(group);
    this.plane = { ...P, group, propA: 0, lightT: 0 };
    return this.plane;
  }

  carOn() {
    const V = this.app.vehicles;
    if (!V) return;
    if (!V.demo.includes(this.car.demo)) V.demo.push(this.car.demo);
    if (!V.extra.includes(this.car.extra)) V.extra.push(this.car.extra);
  }
  carOff() {
    const V = this.app.vehicles;
    if (!V) return;
    V.demo = V.demo.filter(d => d !== this.car.demo);
    V.extra = V.extra.filter(e => e !== this.car.extra);
  }

  // ---------- jedes Bild ----------
  update(dt, t) {
    const m = this.st;
    if (!m || !this.app.st) { this.hide(); return; }
    const age = Math.min(1, (performance.now() - this.at) / 1000);
    const k = Math.min(1, dt * 12);
    let tx, ty, tz;
    if (m.m === 'god') {
      const R = this.ringMesh();
      if (!this.vis) this.vis = { x: m.x, z: m.z };
      this.vis.x += (m.x - this.vis.x) * k; this.vis.z += (m.z - this.vis.z) * k;
      const gy = Math.max(groundY(this.vis.x, this.vis.z), (this.app.fx ? this.app.fx.rise : 0) + 0.02);
      R.visible = true;
      R.position.set(this.vis.x, gy + 0.06, this.vis.z);
      const cam = this.app.stage.camera.position, dist = cam.distanceTo(R.position);
      R.scale.setScalar(THREE.MathUtils.clamp(dist / 9, 1, 40) * (1 + Math.sin(t * 3) * 0.06));
      tx = this.vis.x; ty = gy + 0.3; tz = this.vis.z;
    } else if (m.m === 'ghost') {
      const G = this.ghostPuppet();
      if (!this.vis) this.vis = { x: m.x, y: m.y, z: m.z, yaw: m.yaw };
      const V = this.vis;
      V.x += (m.x - V.x) * k; V.y += (m.y - V.y) * k; V.z += (m.z - V.z) * k;
      let dy = m.yaw - V.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); V.yaw += dy * k;
      if (G) {
        G.group.visible = true;
        G.uni.uTime.value = t;
        const an = m.an === 'jump' ? (m.sp > 0.5 ? 'run' : m.sp > 0.03 ? 'walk' : 'idle') : (m.an || 'idle');
        if (an !== G.cur && G.clips && G.clips[an]) G.setAnim(an, false, 0.2);
        G.mixT = Math.min(1, G.mixT + dt / (G.blend || 0.25));
        G.uni.uMix.value = G.mixT;
        G.group.position.set(V.x, V.y, V.z);
        if (G.mesh) G.mesh.rotation.y = V.yaw;
      }
      const R = this.ringMesh();
      R.visible = true; R.scale.setScalar(0.9 + Math.sin(t * 2.4) * 0.05);
      R.position.set(V.x, groundY(V.x, V.z) + 0.03, V.z);
      tx = V.x; ty = V.y + 0.3; tz = V.z;
    } else if (m.m === 'drive') {
      this.carOn();
      // mit dem gemeldeten Tempo weiterrechnen, dann weich auf die Meldung ziehen
      const c = Math.cos(m.yaw), s = Math.sin(m.yaw), ahead = (m.v || 0) * age;
      const px = m.x + c * ahead, pz = m.z - s * ahead;
      if (!this.vis) this.vis = { x: px, y: m.y, z: pz, yaw: m.yaw };
      const V = this.vis;
      V.x += (px - V.x) * k; V.z += (pz - V.z) * k; V.y += (m.y - V.y) * k;
      let dy = m.yaw - V.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); V.yaw += dy * k;
      Object.assign(this.car.demo, { type: m.type, hex: m.hex, x: V.x, y: V.y, z: V.z, yaw: V.yaw, pitch: m.pitch || 0, roll: m.roll || 0 });
      Object.assign(this.car.extra, { x: V.x + (m.cx || 0), z: V.z + (m.cz || 0), c: Math.cos(V.yaw), s: Math.sin(V.yaw), hl: m.hl, hw: m.hw, cur: Math.abs(m.v || 0) });
      tx = V.x; ty = V.y + 0.35; tz = V.z;
    } else if (m.m === 'fly') {
      const P = this.planeModel();
      const ahead = Math.min(age, 0.5);
      const p = [m.p[0] + m.vel[0] * ahead, m.p[1] + m.vel[1] * ahead, m.p[2] + m.vel[2] * ahead];
      if (!this.vis) this.vis = { p: p.slice(), q: new THREE.Quaternion(m.q[0], m.q[1], m.q[2], m.q[3]) };
      const V = this.vis;
      for (let i = 0; i < 3; i++) V.p[i] += (p[i] - V.p[i]) * k;
      V.q.slerp(new THREE.Quaternion(m.q[0], m.q[1], m.q[2], m.q[3]), k);
      P.group.visible = true;
      P.group.position.set(V.p[0] / S, V.p[1] / S, V.p[2] / S);
      P.group.quaternion.copy(V.q);
      const f = m.f || [0, 0, 0, 0];
      P.ail.L.rotation.x = f[0]; P.ail.R.rotation.x = f[1]; P.elev.rotation.x = f[2]; P.rud.rotation.y = f[3];
      const rpm = m.r || 0.3;
      P.propA += dt * (8 + rpm * 120);
      P.prop.rotation.z = P.propA; P.prop.visible = rpm < 0.45;
      P.blur.visible = rpm >= 0.3; P.blur.material.opacity = THREE.MathUtils.clamp((rpm - 0.3) * 2.2, 0, 0.85); P.blur.rotation.z = -P.propA * 0.013;
      P.flame.visible = !!m.b; P.flameMat.opacity = m.b ? 0.85 : 0;
      updateLights(P.lights, (P.lightT += dt), this.app.night || 0);
      tx = V.p[0] / S; ty = V.p[1] / S + 0.6; tz = V.p[2] / S;
    }
    this.label(m, tx, ty, tz);
  }

  // Namensschild über dem Mitspieler, am Bildrand festgehalten, wenn er außer Sicht ist
  label(m, x, y, z) {
    const el = this.tag, app = this.app, coop = app.coop;
    if (x == null || app.mapOpen || (app.interior && app.interior.active)) { this.hide(); return; }
    const lost = !!(coop && coop.state === 'lost'), away = !lost && !!(coop && coop.away);
    const key = `${m.n}|${m.m}|${away ? 1 : 0}|${lost ? 1 : 0}`;
    if (el.dataset.k !== key) {
      el.dataset.k = key;
      el.querySelector('b').textContent = m.n || L('Freund', 'Friend');
      el.querySelector('small').textContent = lost ? L('Verbindung weg …', 'Connection lost …') : away ? L('ist kurz weg', 'is away for a moment') : MODE()[m.m] || '';
      el.classList.toggle('away', away);
      el.classList.toggle('lost', lost);
    }
    const cam = app.stage.camera, v = this.v3.set(x, y, z).project(cam);
    const W = innerWidth, H = innerHeight, pad = 46;
    let sx = (v.x + 1) / 2 * W, sy = (1 - v.y) / 2 * H;
    const behind = v.z > 1;
    if (behind) { sx = W - sx; sy = H - pad; }
    const edge = behind || sx < pad || sx > W - pad || sy < pad + 60 || sy > H - pad;
    sx = Math.max(pad, Math.min(W - pad, sx)); sy = Math.max(pad + 60, Math.min(H - pad, sy));
    el.classList.toggle('edge', edge);
    el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, ${edge ? '-50%' : '-100%'})`;
    el.style.visibility = 'visible';
    el.style.opacity = edge ? 0.8 : 1;
  }

  // Wo ist der Freund? Für "Zum Freund" (in Feldern wie app.focus)
  where() {
    const m = this.st;
    if (!m) return null;
    if (m.m === 'fly') return { x: m.p[0] / S, z: m.p[2] / S };
    return { x: m.x, z: m.z };
  }
}
