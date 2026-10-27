// Wetter, Partikel und Götter-Effekte: Regen, Schnee, Wolken, Blitze, Regenbogen, Komet,
// Meteor, Beben, Vulkan, Segen, Rauch, Feuer, Boote, Vögel und die Rakete.
import * as THREE from 'three';
import { Clouds } from './clouds.js';
import { fishingBoat } from './ships.js';
import { NX, NY, wx, wz } from './scene.js';
import { groundY } from './terrain.js';

const rand = (a, b) => a + Math.random() * (b - a);

// ---------- Partikel ----------
class Particles {
  constructor(scene, max = 5000, additive = false) {
    this.max = max;
    this.p = [];
    const g = new THREE.BufferGeometry();
    this.aPos = new Float32Array(max * 3); this.aCol = new Float32Array(max * 4); this.aSize = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.aPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.aCol, 4));
    g.setAttribute('size', new THREE.BufferAttribute(this.aSize, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { scale: { value: 400 } },
      // weiche Wölkchen: Gauß-Abfall, nahe der Kamera ausgeblendet (sonst schweben weiße Scheiben vor dem Bild)
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); vC.a *= smoothstep(1.5, 5.0, -mv.z);
          gl_PointSize = min(size * scale / -mv.z, 220.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r2 = dot(d, d) * 4.0; if (r2 > 1.0) discard;
        float a = exp(-r2 * 3.2) * (1.0 - r2); gl_FragColor = vec4(vC.rgb, vC.a * a); }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }
  emit(o) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({ x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, life: 0, max: o.life || 2, size: o.size || 0.3, grow: o.grow || 0, c: o.c || [1, 1, 1], a: o.a ?? 1, g: o.g || 0, drag: o.drag ?? 0.98, fade: o.fade ?? 1 });
  }
  update(dt) {
    const keep = [];
    for (const q of this.p) {
      q.life += dt;
      if (q.life >= q.max) continue;
      q.vy += q.g * dt;
      q.vx *= q.drag; q.vy *= q.drag; q.vz *= q.drag;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      keep.push(q);
    }
    this.p = keep;
    for (let i = 0; i < keep.length; i++) {
      const q = keep[i], k = q.life / q.max;
      this.aPos[i * 3] = q.x; this.aPos[i * 3 + 1] = q.y; this.aPos[i * 3 + 2] = q.z;
      this.aCol[i * 4] = q.c[0]; this.aCol[i * 4 + 1] = q.c[1]; this.aCol[i * 4 + 2] = q.c[2];
      this.aCol[i * 4 + 3] = q.a * (q.fade ? Math.min(1, k * 6) * (1 - k) : 1);
      this.aSize[i] = q.size * (1 + q.grow * k);
    }
    const g = this.points.geometry;
    g.setDrawRange(0, keep.length);
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.size.needsUpdate = true;
  }
}

export class FX {
  constructor(stage) {
    this.stage = stage;
    const scene = stage.scene;
    this.scene = scene;
    this.smoke = new Particles(scene, 3000, false);
    this.glow = new Particles(scene, 3000, true);
    // Regen
    const rg = new THREE.BufferGeometry();
    this.rainN = 3500;
    this.rainPos = new Float32Array(this.rainN * 6);
    for (let i = 0; i < this.rainN; i++) { const x = rand(-45, 45), y = rand(0, 30), z = rand(-45, 45); this.rainPos.set([x, y, z, x, y - 0.6, z], i * 6); }
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xbcd3e0, transparent: true, opacity: 0, depthWrite: false }));
    this.rain.frustumCulled = false;
    scene.add(this.rain);
    // Schnee
    const sg = new THREE.BufferGeometry();
    this.snowN = 3000;
    this.snowPos = new Float32Array(this.snowN * 3);
    for (let i = 0; i < this.snowN; i++) this.snowPos.set([rand(-50, 50), rand(0, 30), rand(-50, 50)], i * 3);
    sg.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3));
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.18, transparent: true, opacity: 0, depthWrite: false }));
    this.snow.frustumCulled = false;
    scene.add(this.snow);
    // Wolken (seit 19.10.2026 eigenes Modul render/clouds.js: weiche Haufenwolken rund um den Blick)
    this.cloudSys = new Clouds(scene);
    // Regenbogen
    const rb = new THREE.TorusGeometry(42, 2.4, 8, 80, Math.PI);
    this.rainbow = new THREE.Mesh(rb, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { op: { value: 0 } },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float op; varying vec3 vP;
        vec3 hsv(float h){ vec3 k = vec3(1.0, 2.0/3.0, 1.0/3.0); vec3 p = abs(fract(vec3(h) + k) * 6.0 - 3.0); return clamp(p - 1.0, 0.0, 1.0); }
        void main(){ float r = length(vP.xy); float t = clamp((r - 39.6) / 4.8, 0.0, 1.0); vec3 c = hsv(0.8 - t * 0.8);
          gl_FragColor = vec4(c, op * 0.5 * smoothstep(0.0, 0.25, t) * smoothstep(1.0, 0.75, t)); }`,
    }));
    this.rainbow.position.set(0, -4, -26);
    scene.add(this.rainbow);
    // Komet
    this.comet = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false }));
    const tail = new THREE.Mesh(new THREE.ConeGeometry(9, 160, 16, 1, true).translate(0, -80, 0), new THREE.MeshBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.35, fog: false, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.comet.add(head, tail);
    this.comet.position.set(-300, 420, -600);
    this.comet.rotation.z = -1.0;
    this.comet.visible = false;
    scene.add(this.comet);
    // Blitze
    this.bolts = [];
    this.flash = 0;
    this.shake = 0;
    this.nextLightning = 0;
    this.rise = 0; this.riseT = -1;
    this.events = [];
    // Vögel
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute([-0.25, 0.06, 0, 0, 0, 0, 0, 0, 0, 0.25, 0.06, 0], 3));
    this.birds = [];
    const bm = new THREE.LineBasicMaterial({ color: 0x2f3640 });
    for (let i = 0; i < 14; i++) {
      const l = new THREE.LineSegments(bg, bm);
      l.userData = { r: rand(8, 26), h: rand(5, 9), sp: rand(0.15, 0.3) * (Math.random() < 0.5 ? 1 : -1), ph: rand(0, 6.28), cx: rand(-15, 15), cz: rand(-15, 15) };
      scene.add(l); this.birds.push(l);
    }
    // Boote
    this.boatGeo = (() => {
      const hull = new THREE.BoxGeometry(0.5, 0.1, 0.2);
      const mast = new THREE.CylinderGeometry(0.01, 0.01, 0.45, 4).translate(0, 0.25, 0);
      const sail = new THREE.ConeGeometry(0.14, 0.36, 3).translate(0.04, 0.26, 0);
      return [hull, mast, sail];
    })();
    this.boats = new Map();
    this.boatMats = [new THREE.MeshStandardMaterial({ color: 0x8d6440, flatShading: true }), new THREE.MeshStandardMaterial({ color: 0x5b4636 }), new THREE.MeshStandardMaterial({ color: 0xf4efe2, flatShading: true })];
    this.lava = new THREE.Group(); scene.add(this.lava);
    this.lavaKey = '';
    this.rocket = null;
  }

  // Spritzer, wenn ein Fisch aus dem Wasser springt oder eintaucht
  splash(x, y, z) {
    for (let i = 0; i < 8; i++) this.smoke.emit({ x, y: y + 0.02, z, vx: rand(-0.35, 0.35), vy: rand(0.5, 1.0), vz: rand(-0.35, 0.35), life: rand(0.4, 0.7), size: 0.05, c: [0.95, 0.98, 1], a: 0.9, g: -3.2, drag: 0.97 });
  }

  // Blas eines Wals: feiner Sprühnebel nach oben
  spout(x, y, z) {
    for (let i = 0; i < 26; i++) this.smoke.emit({ x: x + rand(-0.05, 0.05), y, z: z + rand(-0.05, 0.05), vx: rand(-0.12, 0.12), vy: rand(1.4, 2.2), vz: rand(-0.12, 0.12), life: rand(1.0, 1.8), size: rand(0.08, 0.16), grow: 0.8, c: [0.96, 0.98, 1], a: 0.55, g: -1.1, drag: 0.96 });
  }

  // Staub und ein paar Blätter, wenn ein gefällter Baum aufschlägt
  dust(x, y, z, s = 1) {
    for (let i = 0; i < 12; i++) this.smoke.emit({ x: x + rand(-0.4, 0.4) * s, y: y + 0.08, z: z + rand(-0.4, 0.4) * s, vx: rand(-0.5, 0.5), vy: rand(0.15, 0.5), vz: rand(-0.5, 0.5), life: rand(1.2, 2.2), size: rand(0.25, 0.5) * s, grow: 0.5, c: [0.78, 0.71, 0.58], a: 0.5, drag: 0.93 });
    for (let i = 0; i < 7; i++) this.smoke.emit({ x: x + rand(-0.5, 0.5) * s, y: y + 0.4 * s, z: z + rand(-0.5, 0.5) * s, vx: rand(-0.6, 0.6), vy: rand(0.4, 1.1), vz: rand(-0.6, 0.6), life: rand(1.4, 2.4), size: 0.09, c: [0.45, 0.62, 0.3], a: 0.95, g: -1.4, drag: 0.95 });
  }

  weather(st) {
    const w = st.weather;
    const k = w.kind;
    return {
      kind: k,
      gloom: { klar: 0, wolkig: 0.25, regen: 0.55, sturm: 0.85, schnee: 0.45, nebel: 0.35 }[k] || 0,
      fog: k === 'nebel' ? 1 : k === 'schnee' ? 0.25 : k === 'regen' ? 0.15 : 0,
      storm: k === 'sturm' ? 1 : k === 'regen' ? 0.25 : 0,
      sunny: k === 'klar',
      clouds: { klar: 0.2, wolkig: 0.75, regen: 1, sturm: 1, schnee: 0.85, nebel: 0.35 }[k] || 0.3,
      rain: k === 'regen' ? 0.7 : k === 'sturm' ? 1 : 0,
      snow: k === 'schnee' ? 1 : 0,
    };
  }

  // Ereignisse aus der Simulation abspielen
  trigger(st, e, people) {
    const P = e.x != null ? [wx(e.x), groundY(wx(e.x), wz(e.y)), wz(e.y)] : null;
    const sAt = id => { const s = st._rt.sById.get(id); return s ? [wx(s.cx), groundY(wx(s.cx), wz(s.cy)), wz(s.cy)] : null; };
    if (e.type === 'power') {
      switch (e.id) {
        case 'blitz': if (P) this.bolt(P, true); break;
        case 'meteor': if (P) this.events.push({ k: 'meteor', t: 0, to: P }); break;
        case 'beben': this.shake = 2.6; if (P) for (let i = 0; i < 120; i++) this.smoke.emit({ x: P[0] + rand(-5, 5), y: P[1] + 0.1, z: P[2] + rand(-5, 5), vy: rand(0.3, 1), vx: rand(-0.3, 0.3), life: rand(2, 4), size: rand(0.6, 1.4), grow: 1.5, c: [0.7, 0.62, 0.5], a: 0.5 }); break;
        case 'vulkan': this.shake = 2; if (P) for (let i = 0; i < 200; i++) this.glow.emit({ x: P[0], y: P[1] + 0.5, z: P[2], vx: rand(-2, 2), vy: rand(3, 8), vz: rand(-2, 2), g: -6, life: rand(1, 2.4), size: rand(0.2, 0.5), c: [1, rand(0.3, 0.6), 0.1] }); break;
        case 'segen': if (P) { for (let i = 0; i < 260; i++) { const a = rand(0, 6.28), r = rand(0, (e.r || 6)); this.glow.emit({ x: P[0] + Math.cos(a) * r, y: P[1] + rand(0, 0.5), z: P[2] + Math.sin(a) * r, vy: rand(0.4, 1.4), life: rand(2, 4.5), size: rand(0.12, 0.3), c: [1, 0.85, 0.4], drag: 0.99 }); } this.events.push({ k: 'shaft', t: 0, at: P, c: 0xffe08a }); } break;
        case 'heilung': case 'funke': case 'fremde': case 'seuche': {
          const at = P || (e.sid ? sAt(e.sid) : null);
          if (!at) break;
          if (e.id === 'fremde') { this.events.push({ k: 'boat', t: 0, to: at }); break; }
          const c = e.id === 'heilung' ? [0.5, 1, 0.9] : e.id === 'funke' ? [1, 0.9, 0.5] : [0.7, 0.85, 0.5];
          const em = e.id === 'seuche' ? this.smoke : this.glow;
          for (let i = 0; i < 160; i++) em.emit({ x: at[0] + rand(-3, 3), y: at[1] + rand(0, 1), z: at[2] + rand(-3, 3), vy: rand(0.2, 1), life: rand(2, 4), size: rand(e.id === 'seuche' ? 0.6 : 0.12, e.id === 'seuche' ? 1.4 : 0.3), grow: e.id === 'seuche' ? 1 : 0, c, a: e.id === 'seuche' ? 0.35 : 1 });
          if (e.id === 'funke') this.events.push({ k: 'spark', t: 0, to: at });
          break;
        }
        case 'traum': {
          const pp = people.pos.get(e.pid);
          if (pp) for (let i = 0; i < 90; i++) this.glow.emit({ x: pp[0] + rand(-0.4, 0.4), y: pp[1] + rand(0.2, 1.5), z: pp[2] + rand(-0.4, 0.4), vy: rand(0.1, 0.5), vx: rand(-0.2, 0.2), life: rand(2, 5), size: rand(0.08, 0.2), c: [0.75, 0.7, 1] });
          break;
        }
        case 'flut': this.riseT = 0; break;
        case 'sturm': this.nextLightning = 0; break;
        default: break;
      }
    } else if (e.type === 'launch') {
      const at = [wx(e.x), groundY(wx(e.x), wz(e.y)), wz(e.y)];
      this.events.push({ k: 'launch', t: 0, at });
    } else if (e.type === 'revolt' || e.type === 'battle' || e.type === 'war') {
      const at = sAt(e.s || e.a);
      if (at) for (let i = 0; i < 60; i++) this.smoke.emit({ x: at[0] + rand(-2, 2), y: at[1] + 0.3, z: at[2] + rand(-2, 2), vy: rand(0.4, 1), life: rand(3, 6), size: rand(0.5, 1), grow: 2, c: [0.35, 0.33, 0.32], a: 0.5 });
    } else if (e.type === 'found') {
      const at = sAt(e.s);
      if (at) for (let i = 0; i < 120; i++) this.glow.emit({ x: at[0] + rand(-2, 2), y: at[1] + 0.2, z: at[2] + rand(-2, 2), vy: rand(0.5, 1.5), life: rand(2, 4), size: 0.2, c: [1, 0.9, 0.6] });
    }
  }

  bolt(P, big) {
    const pts = [];
    let x = P[0] + rand(-4, 4), z = P[2] + rand(-4, 4), y = 26;
    pts.push(x, y, z);
    while (y > P[1] + 0.3) { y -= rand(1.2, 3); x += (P[0] - x) * 0.25 + rand(-0.8, 0.8); z += (P[2] - z) * 0.25 + rand(-0.8, 0.8); pts.push(x, Math.max(y, P[1]), z); }
    pts.push(P[0], P[1], P[2]);
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xf4f0ff, transparent: true, opacity: 1, fog: false }));
    this.scene.add(l);
    this.bolts.push({ l, t: 0 });
    this.flash = big ? 0.55 : 0.3;
    if (big) { this.shake = Math.max(this.shake, 0.4); for (let i = 0; i < 50; i++) this.glow.emit({ x: P[0], y: P[1] + 0.2, z: P[2], vx: rand(-2, 2), vy: rand(1, 3), vz: rand(-2, 2), g: -5, life: rand(0.4, 1), size: 0.15, c: [1, 0.9, 0.6] }); }
    this.onThunder && this.onThunder(big);
  }

  update(st, dt, t, wxs, night, buildings, people) {
    const cam = this.stage.camera;
    const target = this.stage.controls.target;
    // Regen
    const rainA = wxs.rain;
    this.rain.material.opacity += (rainA * 0.5 - this.rain.material.opacity) * 0.05;
    if (this.rain.material.opacity > 0.01) {
      const slant = wxs.storm > 0.5 ? 0.35 : 0.05;
      const a = this.rainPos;
      for (let i = 0; i < this.rainN; i++) {
        let y = a[i * 6 + 1] - dt * 22;
        let x = a[i * 6] + slant * dt * 22;
        if (y < 0) { y = 30; x = target.x + rand(-45, 45); a[i * 6 + 2] = target.z + rand(-45, 45); }
        a[i * 6] = x; a[i * 6 + 1] = y;
        a[i * 6 + 3] = x - slant * 0.6; a[i * 6 + 4] = y - 0.6; a[i * 6 + 5] = a[i * 6 + 2];
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    // Schnee
    this.snow.material.opacity += (wxs.snow * 0.9 - this.snow.material.opacity) * 0.04;
    if (this.snow.material.opacity > 0.01) {
      const a = this.snowPos;
      for (let i = 0; i < this.snowN; i++) {
        a[i * 3 + 1] -= dt * 1.6;
        a[i * 3] += Math.sin(t + i) * dt * 0.4;
        if (a[i * 3 + 1] < 0) { a[i * 3 + 1] = 30; a[i * 3] = target.x + rand(-50, 50); a[i * 3 + 2] = target.z + rand(-50, 50); }
      }
      this.snow.geometry.attributes.position.needsUpdate = true;
    }
    // Wolken
    { const su = this.stage.sky.material.uniforms; this.cloudSys.update(dt, cam, target, wxs, night, this.stage.sunDir, this.stage.sun.color, su.hor.value, su.zen.value); }
    // Gewitter
    if (wxs.storm > 0.5 && t > this.nextLightning) {
      this.nextLightning = t + rand(2.5, 7);
      this.bolt([target.x + rand(-30, 30), 0, target.z + rand(-30, 30)], false);
    }
    for (const b of this.bolts) { b.t += dt; b.l.material.opacity = Math.max(0, 1 - b.t * 3); }
    this.bolts = this.bolts.filter(b => { if (b.t > 0.4) { this.scene.remove(b.l); b.l.geometry.dispose(); return false; } return true; });
    this.flash *= 0.86;
    this.stage.grade.uniforms.flash.value = this.flash;
    // Regenbogen
    const rbOn = st.flags.rainbow && st.day <= st.flags.rainbow ? 1 : 0;
    const u = this.rainbow.material.uniforms.op;
    u.value += (rbOn * (1 - night) - u.value) * 0.01;
    this.rainbow.visible = u.value > 0.01;
    this.rainbow.lookAt(cam.position.x, this.rainbow.position.y, cam.position.z);
    // Komet
    const kom = st.effects.some(e => e.k === 'komet');
    this.comet.visible = kom;
    if (kom) this.comet.position.x = -300 + Math.sin(t * 0.01) * 40;
    // Flut
    if (this.riseT >= 0) {
      this.riseT += dt;
      const k = this.riseT;
      this.rise = k < 3 ? k / 3 * 0.75 : k < 6 ? 0.75 : Math.max(0, 0.75 - (k - 6) / 4 * 0.75);
      if (k > 10) { this.riseT = -1; this.rise = 0; }
    }
    // Ereignisse mit Ablauf
    for (const e of this.events) {
      e.t += dt;
      if (e.k === 'meteor') {
        const k = Math.min(1, e.t / 1.6);
        const from = [e.to[0] - 40, 60, e.to[2] - 30];
        const p = [from[0] + (e.to[0] - from[0]) * k, from[1] + (e.to[1] - from[1]) * k, from[2] + (e.to[2] - from[2]) * k];
        for (let i = 0; i < 6; i++) this.glow.emit({ x: p[0] + rand(-0.3, 0.3), y: p[1], z: p[2] + rand(-0.3, 0.3), life: rand(0.4, 0.9), size: rand(0.6, 1.4), c: [1, rand(0.5, 0.8), 0.3] });
        this.smoke.emit({ x: p[0], y: p[1], z: p[2], life: 3, size: 1.2, grow: 2, c: [0.4, 0.38, 0.4], a: 0.4 });
        if (k >= 1 && !e.boom) {
          e.boom = true; this.flash = 0.9; this.shake = 2.2;
          for (let i = 0; i < 300; i++) this.glow.emit({ x: e.to[0], y: e.to[1] + 0.3, z: e.to[2], vx: rand(-6, 6), vy: rand(2, 9), vz: rand(-6, 6), g: -9, life: rand(0.8, 2), size: rand(0.2, 0.6), c: [1, rand(0.4, 0.8), 0.2] });
          for (let i = 0; i < 120; i++) this.smoke.emit({ x: e.to[0] + rand(-2, 2), y: e.to[1] + 0.3, z: e.to[2] + rand(-2, 2), vy: rand(0.5, 2), vx: rand(-1, 1), life: rand(3, 6), size: rand(1, 2), grow: 2, c: [0.35, 0.3, 0.28], a: 0.6 });
          this.onBoom && this.onBoom();
        }
        e.done = e.t > 2;
      } else if (e.k === 'shaft') {
        if (!e.m) { e.m = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.5, 40, 24, 1, true), new THREE.MeshBasicMaterial({ color: e.c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); e.m.position.set(e.at[0], e.at[1] + 20, e.at[2]); this.scene.add(e.m); }
        e.m.material.opacity = Math.sin(Math.min(1, e.t / 4) * Math.PI) * 0.22;
        if (e.t > 4) { this.scene.remove(e.m); e.done = true; }
      } else if (e.k === 'spark') {
        const k = Math.min(1, e.t / 1.2);
        const y = e.to[1] + 30 * (1 - k);
        for (let i = 0; i < 4; i++) this.glow.emit({ x: e.to[0] + rand(-0.1, 0.1), y, z: e.to[2] + rand(-0.1, 0.1), life: 0.6, size: 0.35, c: [1, 0.92, 0.6] });
        if (k >= 1 && !e.hit) { e.hit = true; this.flash = 0.25; for (let i = 0; i < 80; i++) this.glow.emit({ x: e.to[0], y: e.to[1] + 0.5, z: e.to[2], vx: rand(-2, 2), vy: rand(0, 3), vz: rand(-2, 2), g: -2, life: rand(1, 2), size: 0.18, c: [1, 0.9, 0.6] }); }
        e.done = e.t > 1.5;
      } else if (e.k === 'boat') {
        if (!e.m) { e.m = this.makeBoat(1.6); this.scene.add(e.m); const a = Math.atan2(e.to[2], e.to[0]); e.from = [e.to[0] + Math.cos(a) * 30, 0.05, e.to[2] + Math.sin(a) * 30]; }
        const k = Math.min(1, e.t / 7);
        e.m.position.set(e.from[0] + (e.to[0] - e.from[0]) * k, 0.06 + Math.sin(t * 2) * 0.03, e.from[2] + (e.to[2] - e.from[2]) * k);
        e.m.lookAt(e.to[0], 0.06, e.to[2]); e.m.rotateY(Math.PI / 2);
        if (e.t > 14) { this.scene.remove(e.m); e.done = true; }
      } else if (e.k === 'launch') {
        if (!e.m) {
          const g = new THREE.Group();
          g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 2.5, 12), new THREE.MeshStandardMaterial({ color: 0xf4f2ee })));
          const nose = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 12), new THREE.MeshStandardMaterial({ color: 0xc8553d })); nose.position.y = 1.5; g.add(nose);
          g.position.set(e.at[0], e.at[1] + 1.3, e.at[2]); this.scene.add(g); e.m = g; this.shake = 3;
        }
        const k = Math.max(0, e.t - 2);
        e.m.position.y = e.at[1] + 1.3 + k * k * 1.2;
        const p = e.m.position;
        for (let i = 0; i < 8; i++) this.glow.emit({ x: p.x + rand(-0.15, 0.15), y: p.y - 1.4, z: p.z + rand(-0.15, 0.15), vy: rand(-6, -3), life: rand(0.3, 0.7), size: rand(0.4, 0.9), c: [1, rand(0.6, 0.9), 0.3] });
        for (let i = 0; i < 3; i++) this.smoke.emit({ x: p.x + rand(-0.3, 0.3), y: p.y - 1.6, z: p.z + rand(-0.3, 0.3), vx: rand(-0.6, 0.6), vy: rand(-0.4, 0.4), vz: rand(-0.6, 0.6), life: rand(4, 8), size: rand(1, 2), grow: 2.5, c: [0.92, 0.92, 0.92], a: 0.6 });
        if (e.t > 22) { this.scene.remove(e.m); e.done = true; }
      }
    }
    this.events = this.events.filter(e => !e.done);
    // Vulkan, Lava und Rauch
    const vul = st.effects.filter(e => e.k === 'vulkan');
    const lk = vul.map(e => e.x + ',' + e.y).join('|');
    if (lk !== this.lavaKey) {
      this.lavaKey = lk;
      this.lava.clear();
      for (const e of vul) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.6, 0.2, 10), new THREE.MeshBasicMaterial({ color: 0xff6a2a }));
        m.position.set(wx(e.x), groundY(wx(e.x), wz(e.y)) + 0.05, wz(e.y));
        this.lava.add(m);
      }
    }
    for (const e of vul) {
      const x = wx(e.x), z = wz(e.y), y = groundY(x, z);
      for (let i = 0; i < 3; i++) this.smoke.emit({ x: x + rand(-0.5, 0.5), y: y + 0.6, z: z + rand(-0.5, 0.5), vx: rand(-0.3, 0.3) + 0.4, vy: rand(2, 3.5), vz: rand(-0.3, 0.3), life: rand(5, 9), size: rand(1, 2), grow: 3, c: [0.25, 0.23, 0.24], a: 0.55, drag: 0.995 });
      if (Math.random() < 0.4) this.glow.emit({ x, y: y + 0.6, z, vx: rand(-1.5, 1.5), vy: rand(3, 6), vz: rand(-1.5, 1.5), g: -6, life: rand(0.8, 1.6), size: rand(0.2, 0.4), c: [1, 0.5, 0.15] });
    }
    // Die Feuerberge der neuen Welt rauchen immer ein wenig (nur in Sichtweite)
    if (st.volc && this.camPos) for (const [vx, vy] of st.volc) {
      const x = wx(vx), z = wz(vy);
      if (Math.hypot(x - this.camPos.x, z - this.camPos.z) > 220 || Math.random() > dt * 2.2) continue;
      const y = groundY(x, z);
      this.smoke.emit({ x: x + rand(-0.4, 0.4), y: y + 0.3, z: z + rand(-0.4, 0.4), vx: rand(-0.2, 0.2) + 0.3, vy: rand(1.2, 2.2), vz: rand(-0.2, 0.2), life: rand(6, 10), size: rand(1.2, 2.2), grow: 3.5, c: [0.42, 0.4, 0.4], a: 0.4, drag: 0.996 });
      if (Math.random() < 0.15) this.glow.emit({ x, y: y + 0.3, z, vx: rand(-0.8, 0.8), vy: rand(2, 4), vz: rand(-0.8, 0.8), g: -6, life: rand(0.6, 1.2), size: rand(0.15, 0.3), c: [1, 0.5, 0.15] });
    }
    // Feuer auf brennenden Kacheln
    const T = st.tiles;
    if (!this.burnList || (st.day !== this.burnDay)) {
      this.burnDay = st.day; this.burnList = [];
      for (let i = 0; i < NX * NY; i++) if (T.burn[i]) this.burnList.push(i);
    }
    for (const i of this.burnList) {
      if (Math.random() > 0.5) continue;
      const x = wx(i % NX), z = wz((i / NX) | 0), y = groundY(x, z);
      this.glow.emit({ x: x + rand(-0.3, 0.3), y: y + 0.1, z: z + rand(-0.3, 0.3), vy: rand(0.8, 1.6), life: rand(0.4, 0.9), size: rand(0.25, 0.5), c: [1, rand(0.4, 0.7), 0.15] });
      if (Math.random() < 0.3) this.smoke.emit({ x, y: y + 0.6, z, vy: rand(0.6, 1.2), vx: 0.2, life: rand(3, 5), size: 0.7, grow: 2, c: [0.3, 0.28, 0.27], a: 0.45 });
    }
    // Schornsteinrauch
    const smokeRate = (night > 0.3 ? 0.9 : 0.4) * (st.weather.kind === 'schnee' || Math.floor((st.day % 24) / 6) === 3 ? 1.6 : 1);
    const occ = buildings.occ;
    for (const m of buildings.smokers) {
      // Wo gekocht wird, raucht der Schornstein stark; schläft das Haus, glimmt nur noch die Glut
      const b = m.userData.b, v = occ && b && (b.t === 'haus' || b.t === 'hochhaus') ? occ.get(b.id) : null;
      const k = !occ || !b || (b.t !== 'haus' && b.t !== 'hochhaus') ? 1 : v && v.cook ? 4 : v && v.awake ? 1 : 0.2;
      if (Math.random() > dt * smokeRate * k) continue;
      for (const s of m.userData.g.smoke) {
        const v = new THREE.Vector3(...s).applyMatrix4(m.matrixWorld);
        this.smoke.emit({ x: v.x, y: v.y, z: v.z, vx: 0.15 + wxs.storm * 0.8, vy: rand(0.3, 0.5), life: rand(2.8, 4.4), size: 0.2, grow: 2.6, c: [0.93 - night * 0.55, 0.91 - night * 0.52, 0.88 - night * 0.42], a: 0.34 - night * 0.12, drag: 0.995 });
      }
    }
    // Glühwürmchen in Sommernächten
    if (night > 0.6 && Math.floor((st.day % 24) / 6) === 1 && Math.random() < 0.5) {
      const x = target.x + rand(-20, 20), z = target.z + rand(-20, 20);
      const ix = Math.floor(x + NX / 2), iz = Math.floor(z + NY / 2);
      if (ix >= 0 && iz >= 0 && ix < NX && iz < NY && T.tree[iz * NX + ix]) this.glow.emit({ x, y: groundY(x, z) + rand(0.2, 0.8), z, vx: rand(-0.2, 0.2), vy: rand(-0.05, 0.1), vz: rand(-0.2, 0.2), life: rand(2, 4), size: 0.08, c: [0.9, 1, 0.5], drag: 1 });
    }
    // Vögel
    for (const b of this.birds) {
      const d = b.userData;
      const a = t * d.sp + d.ph;
      b.position.set(d.cx + Math.cos(a) * d.r, d.h + Math.sin(t * 0.5 + d.ph) * 0.6, d.cz + Math.sin(a) * d.r);
      b.rotation.y = -a + (d.sp > 0 ? 0 : Math.PI);
      b.scale.y = 1 + Math.sin(t * 8 + d.ph) * 0.8;
      b.visible = !this.noLineBirds && night < 0.6 && wxs.storm < 0.5;
    }
    this.boatsUpdate(st, t, night);
    this.smoke.update(dt);
    this.glow.update(dt);
  }

  // Fischerboot (seit 19.10.2026 aus dem Schiffsbaukasten, ships.js fishingBoat): vier Farbvarianten
  makeBoat(s = 1, v = 0) {
    const g = new THREE.Group();
    this.fbGeo = this.fbGeo || [];
    const geo = this.fbGeo[v % 4] || (this.fbGeo[v % 4] = fishingBoat(v % 4));
    this.fbMat = this.fbMat || new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide }); // wie die Schiffe: Segel sind dünne Flächen
    const m = new THREE.Mesh(geo, this.fbMat); m.castShadow = true; m.scale.setScalar(0.58); g.add(m);
    g.scale.setScalar(s);
    return g;
  }

  boatsUpdate(st, t, night) {
    const seen = new Set();
    for (const b of st.buildings) {
      if ((b.t !== 'fischer' && b.t !== 'hafen') || b.prog < 1) continue;
      seen.add(b.id);
      let m = this.boats.get(b.id);
      if (!m) {
        m = this.makeBoat(b.t === 'hafen' && b.lvl >= 4 ? 1.5 : 1, b.id % 4);
        let wxp = null;
        for (let r = 1; r < 4 && !wxp; r++) for (const [dx, dy] of [[0, r], [r, 0], [0, -r], [-r, 0], [r, r], [-r, -r], [r, -r], [-r, r]]) {
          const x = b.x + dx, y = b.y + dy;
          if (x >= 0 && y >= 0 && x < NX && y < NY && st.tiles.h[y * NX + x] < 0) { wxp = [wx(x), wz(y)]; break; }
        }
        m.userData.c = wxp || [wx(b.x), wz(b.y)];
        m.userData.ph = Math.random() * 6.28;
        this.scene.add(m); this.boats.set(b.id, m);
      }
      const [cx, cz] = m.userData.c;
      const a = t * 0.12 + m.userData.ph;
      const out = night < 0.5 && st.weather.kind !== 'sturm';
      const r = out ? 2.2 : 0.4;
      m.position.set(cx + Math.cos(a) * r, 0.05 + Math.sin(t * 1.8 + m.userData.ph) * 0.03 + this.rise, cz + Math.sin(a) * r);
      // Bug (+x) in Fahrtrichtung, leicht schaukeln
      m.rotation.y = -a - Math.PI / 2;
      m.rotation.x = Math.sin(t * 1.4 + m.userData.ph) * 0.06;
      m.rotation.z = Math.sin(t * 1.1 + m.userData.ph * 2) * 0.03;
    }
    for (const [id, m] of this.boats) if (!seen.has(id)) { this.scene.remove(m); this.boats.delete(id); }
  }

  applyShake(dt) {
    if (this.shake <= 0) return [0, 0];
    this.shake = Math.max(0, this.shake - dt);
    const a = Math.min(1, this.shake) * 0.35;
    return [rand(-a, a), rand(-a, a)];
  }
}
