// Leben in der Stadtansicht (seit 26.10.2026): Menschen auf den Gehwegen und Wegen, Autos auf den Fahrbahnen der
// echten Straßen (rechts oder links nach Land), mehr am Tag, weniger in der Nacht, dichter in großen Städten. Wer
// angeklickt wird, bekommt ein festes Leben (today/people.js citizen). Dazu sichtbare Kräfte: Regen, Schnee, Beben, Blitz.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roundBox, profile } from '../render/shapes.js';
import { LEFT_DRIVE } from '../today/data.js';
import { loadVillagers, drawPerson, figFor, figureScale, HEIGHT } from '../render/figure.js';

const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const CLOTHES = ['#3d5a80', '#e07a5f', '#81b29a', '#f2cc8f', '#293241', '#ee6c4d', '#98c1d9', '#6d597a', '#b56576', '#355070', '#eaac8b', '#f4f1de', '#264653', '#e9c46a', '#2a9d8f', '#d62828'];
const CARS = ['#e8e4dc', '#2b2d33', '#b9bec4', '#7d8590', '#c0392b', '#2e5e8c', '#f1c40f', '#ffffff', '#3b6e4f', '#8e6c4e', '#d35400', '#5d6d7e'];
const SPEED = { motorway: 2.6, trunk: 2.2, primary: 1.5, secondary: 1.3, tertiary: 1.1, minor: 0.8, service: 0.5 };

// Formen im Spielzeug Look der Inselwelt (seit 27.10.2026): aPaint 1 bekommt die Farbe der Instanz (Kleidung, Lack),
// alles andere behält seine eigene Farbe (Haut, Haare, Glas, Reifen, Lichter)
function addPart(parts, g, c, paint = 0) {
  g = g.index ? g.toNonIndexed() : g;
  const n = g.attributes.position.count, a = new Float32Array(n * 3), pa = new Float32Array(n).fill(paint), col = new THREE.Color(c);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.setAttribute('aPaint', new THREE.BufferAttribute(pa, 1));
  for (const k of ['uv', 'uv1']) if (g.attributes[k]) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  parts.push(g);
}
function personGeo() {
  const parts = [];
  addPart(parts, roundBox(0.024, 0.085, 0.028, 0.01).translate(-0.016, 0.042, 0), '#3a3d48');
  addPart(parts, roundBox(0.024, 0.085, 0.028, 0.01).translate(0.016, 0.042, 0), '#3a3d48');
  addPart(parts, roundBox(0.064, 0.08, 0.042, 0.018).translate(0, 0.12, 0), '#ffffff', 1);
  for (const x of [-0.04, 0.04]) addPart(parts, new THREE.CapsuleGeometry(0.009, 0.05, 3, 6).rotateZ(x * 2.2).translate(x, 0.118, 0), '#ffffff', 1);
  addPart(parts, new THREE.SphereGeometry(0.026, 14, 10).translate(0, 0.18, 0), '#e6c2a2');
  addPart(parts, new THREE.SphereGeometry(0.0275, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 0.183, -0.002), '#4a3426');
  return mergeGeometries(parts);
}
function carGeo() {
  const parts = [];
  // Karosserie als gerundetes Profil wie die Limousine der Inselwelt, etwas größer (die Straßen der Erde sind 1 zu 1)
  const body = [[-0.2, 0.03], [0.2, 0.03], [0.207, 0.045], [0.208, 0.075], [0.185, 0.092], [0.07, 0.102], [-0.12, 0.104], [-0.19, 0.098], [-0.207, 0.075], [-0.205, 0.045]];
  addPart(parts, profile(body, 0.17, 0.016), '#ffffff', 1);
  const cab = [[0.072, 0.1], [0.006, 0.153], [-0.088, 0.153], [-0.15, 0.1]];
  addPart(parts, profile(cab, 0.146, 0.01), '#2c3a44');
  addPart(parts, roundBox(0.112, 0.012, 0.15, 0.005).translate(-0.041, 0.157, 0), '#ffffff', 1);
  for (const z of [0.088, -0.088]) for (const x of [0.125, -0.125]) {
    addPart(parts, new THREE.CylinderGeometry(0.036, 0.036, 0.024, 14).rotateX(Math.PI / 2).translate(x, 0.036, z), '#1d1f24');
    addPart(parts, new THREE.CylinderGeometry(0.019, 0.019, 0.026, 10).rotateX(Math.PI / 2).translate(x, 0.036, z), '#d9dde0');
  }
  for (const z of [0.06, -0.06]) {
    addPart(parts, new THREE.CylinderGeometry(0.011, 0.011, 0.01, 10).rotateZ(Math.PI / 2).translate(0.208, 0.075, z), '#fff6d4');
    addPart(parts, new THREE.BoxGeometry(0.006, 0.01, 0.03).translate(-0.206, 0.078, z), '#d6453a');
  }
  addPart(parts, roundBox(0.014, 0.016, 0.182, 0.006).translate(0.211, 0.04, 0), '#cfd4d8');
  addPart(parts, roundBox(0.014, 0.016, 0.182, 0.006).translate(-0.209, 0.04, 0), '#cfd4d8');
  const g = mergeGeometries(parts);
  g.scale(1.05, 1.05, 1.05);
  return g;
}
// Material, das die Instanzfarbe nur auf bemalte Teile legt
function paintMat(opts) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, ...opts });
  m.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute float aPaint;\n' + sh.vertexShader.replace('#include <color_vertex>', `
      #if defined( USE_COLOR_ALPHA )
        vColor = vec4( 1.0 );
      #elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
        vColor = vec3( 1.0 );
      #endif
      #ifdef USE_COLOR
        vColor *= color;
      #endif
      #ifdef USE_INSTANCING_COLOR
        vColor.xyz *= mix(vec3(1.0), instanceColor.xyz, aPaint);
      #endif`);
  };
  m.customProgramCacheKey = () => 'life-paint-1';
  return m;
}

// Mensch für die Figuren: Geschlecht, Kind oder alt fest aus der Nummer; Kleidung modern (Hemd aus CLOTHES, Hose,
// selten eine Mütze), ohne die Werkzeuge der Inselwelt
const PANTS = ['#2e3440', '#3e4a5c', '#54473f', '#5a6a7a', '#6b5a44', '#1f2329', '#7a6a58', '#4a5a46'].map(c => new THREE.Color(c));
function figPerson(a) {
  const r = hash(a.id, 41);
  return { id: a.id * 7 + 13, sex: hash(a.id, 43) < 0.5 ? 'f' : 'm', job: 'arbeiter', kid: !a.hero && r < 0.07, old: !a.hero && r > 0.9 };
}
function figLook(a) {
  const cap = hash(a.id, 47) < 0.08;
  return { shirt: new THREE.Color(a.col), pants: PANTS[(hash(a.id, 45) * PANTS.length) | 0], hat: cap ? 'muetze' : null, hatCol: cap ? new THREE.Color(CLOTHES[(a.id * 5) % CLOTHES.length]) : null };
}

export class Life {
  constructor(stage, city) {
    this.stage = stage; this.city = city;
    this.group = new THREE.Group();
    stage.scene.add(this.group);
    this.group.visible = false;
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    this.maxP = coarse ? 260 : 700; this.maxC = coarse ? 120 : 320;
    this.people = new THREE.InstancedMesh(personGeo(), paintMat({ roughness: 0.8 }), this.maxP);
    this.cars = new THREE.InstancedMesh(carGeo(), paintMat({ roughness: 0.32, metalness: 0.15 }), this.maxC);
    for (const m of [this.people, this.cars]) { m.count = 0; m.castShadow = true; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(m); }
    this.P = []; this.C = [];
    // Ton Figuren der Inselwelt (render/figure.js) nah an der Kamera, sobald geladen; weiter weg die leichte Form
    this.figs = null; this.figLoading = false; this.uFig = { value: 0 }; this.figMax = coarse ? 140 : 360; this.coarse = coarse;
    this.o = new THREE.Object3D();
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(1, 1, 1); this.v = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0);
    this.fx = null; this.shake = 0;
  }

  // hero: dein Mensch lebt in dieser Stadt (Name für das Schild); er geht in der Nähe des Blicks über die Gehwege
  enter(cityIdx, ctry, hero) {
    this.cityIdx = cityIdx; this.left = !!(ctry && LEFT_DRIVE.has(ctry.iso3));
    this.P.length = 0; this.C.length = 0; this.serial = 1;
    this.heroName = hero || null; this.heroA = null;
    this.group.visible = true;
    if (!this.figs && !this.figLoading) {
      this.figLoading = true;
      loadVillagers(this.stage.scene, this.uFig, this.figMax).then(f => { this.figs = f; }).catch(() => {});
    }
  }
  heroPos() { const a = this.heroA; if (!a || a.slot == null) return null; const w = this.pose(a, a.side); return { x: w[0], y: w[1], z: w[2], name: this.heroName }; }
  exit() { this.group.visible = false; this.P.length = 0; this.C.length = 0; this.people.count = 0; this.cars.count = 0; if (this.figs) for (const F of this.figs) { F.begin(false); F.end(); } this.stopFx(); }

  // Wege nahe beim Blick: Paare [Weg, Kachelmatrix oder null]. Die Quelle (Stadtansicht oder Erdkugel) liefert sie,
  // Wege liegen als Dreiergruppen x, y, z in Kachelkoordinaten, die Matrix bringt sie in die Welt.
  lines(kind, target, r) { return this.city.lifeLines ? this.city.lifeLines(kind, target, r) : []; }

  spawn(list, kind, target, r) {
    if (!list.length) return null;
    const w = this.tmp || (this.tmp = new THREE.Vector3());
    for (let k = 0; k < 6; k++) {
      const [L, M] = list[(Math.random() * list.length) | 0], p = L.p, n = p.length / 3;
      if (n < 2) continue;
      const seg = (Math.random() * (n - 1)) | 0, t = Math.random();
      w.set(p[seg * 3] + (p[seg * 3 + 3] - p[seg * 3]) * t, p[seg * 3 + 1], p[seg * 3 + 2] + (p[seg * 3 + 5] - p[seg * 3 + 2]) * t);
      if (M) w.applyMatrix4(M);
      if (Math.hypot(w.x - target.x, w.z - target.z) > r) continue;
      const dir = L.ow ? 1 : Math.random() < 0.5 ? 1 : -1;
      const id = this.serial++;
      if (kind === 'walk') { const still = Math.random() < 0.12 ? (Math.random() < 0.55 ? 'chat' : 'idle') : null; return { L, M, seg, t, dir, id, side: (Math.random() < 0.5 ? -1 : 1) * L.w * (0.75 + Math.random() * 0.2), v: still ? 0 : 0.11 + Math.random() * 0.05, still, col: CLOTHES[id % CLOTHES.length], ph: Math.random() * 6 }; }
      return { L, M, seg, t, dir, id, lane: Math.max(0.04, L.w * (L.lvl >= 3 ? 0.45 : 0.42)), v: (SPEED[L.c] || 0.8) * (0.85 + Math.random() * 0.3), col: CARS[id % CARS.length] };
    }
    return null;
  }

  // Schritt entlang des Zuges; am Ende umkehren (Fußgänger) oder neu anfangen (Autos)
  move(a, dist) {
    const p = a.L.p, n = p.length / 3;
    let left = dist;
    for (let k = 0; k < 8 && left > 0; k++) {
      const i0 = a.seg, i1 = a.seg + 1;
      const sl = Math.hypot(p[i1 * 3] - p[i0 * 3], p[i1 * 3 + 2] - p[i0 * 3 + 2]) || 1e-3;
      const step = left / sl;
      if (a.dir > 0) { if (a.t + step <= 1) { a.t += step; left = 0; } else { left -= (1 - a.t) * sl; if (a.seg + 1 < n - 1) { a.seg++; a.t = 0; } else { if (a.L.ow) return false; a.dir = -1; a.t = 1; } } }
      else { if (a.t - step >= 0) { a.t -= step; left = 0; } else { left -= a.t * sl; if (a.seg > 0) { a.seg--; a.t = 1; } else { a.dir = 1; a.t = 0; } } }
    }
    return true;
  }
  // Lage in der Welt: [x, y, z, Winkel], seitlich versetzt (rechts der Fahrtrichtung, Linksverkehr: links)
  pose(a, off) {
    const p = a.L.p, i0 = a.seg * 3, i1 = i0 + 3;
    const dx = p[i1] - p[i0], dz = p[i1 + 2] - p[i0 + 2], l = Math.hypot(dx, dz) || 1;
    const fx = dx / l * a.dir, fz = dz / l * a.dir;
    const x = p[i0] + dx * a.t, y = p[i0 + 1] + (p[i1 + 1] - p[i0 + 1]) * a.t, z = p[i0 + 2] + dz * a.t;
    const rx = -fz, rz = fx;
    const w = this.pv || (this.pv = new THREE.Vector3()), f = this.pf || (this.pf = new THREE.Vector3());
    w.set(x + rx * off, y, z + rz * off); f.set(w.x + fx, w.y, w.z + fz);
    if (a.M) { w.applyMatrix4(a.M); f.applyMatrix4(a.M); }
    this.hd = Math.atan2(f.x - w.x, f.z - w.z);
    return [w.x, w.y, w.z, Math.atan2(-(f.z - w.z), f.x - w.x)];
  }

  update(dt, clock, night, speed) {
    if (!this.group.visible) return;
    // Menschen sammeln sich um den Blick: nah dicht, aus der Höhe verteilt
    const tg = this.stage.controls.target, camD = this.stage.camera.position.distanceTo(tg), R = Math.max(9, Math.min(55, camD * 1.5));
    if (camD > 260) { this.people.count = 0; this.cars.count = 0; this.P.length = 0; this.C.length = 0; this.heroA = null; if (this.figs) for (const F of this.figs) { F.begin(false); F.end(); } return; }
    this.uFig.value = clock;
    const dayK = 1 - night * 0.7;
    const wantP = Math.round(this.maxP * dayK), wantC = Math.round(this.maxC * (1 - night * 0.55));
    const walk = this.P.length < wantP ? this.lines('walk', tg, R) : null, drive = this.C.length < wantC ? this.lines('drive', tg, R * 1.4) : null;
    for (let k = 0; k < 24 && walk && this.P.length < wantP; k++) { const a = this.spawn(walk, 'walk', tg, R); if (a) this.P.push(a); }
    if (this.heroName && !this.heroA) { const near = this.lines('walk', tg, 12); const a = near.length ? this.spawn(near, 'walk', tg, 14) : null; if (a) { a.hero = true; a.col = '#e9b44c'; a.v = 0.1; a.still = null; this.heroA = a; this.P.push(a); } }
    for (let k = 0; k < 12 && drive && this.C.length < wantC; k++) { const a = this.spawn(drive, 'drive', tg, R * 1.4); if (a) this.C.push(a); }
    const m = this.m, q = this.q, s = this.s, v = this.v, col = new THREE.Color();
    // Ton Figuren der Inselwelt für alle nah an der Kamera (gehen mit echter Schrittlänge, manche stehen und reden),
    // die übrigen als leichte Form
    const figs = this.figs && this.figs.length ? this.figs : null, cam = this.stage.camera.position, o = this.o, FD2 = 34 * 34;
    if (figs) for (const F of figs) F.begin(camD < 110);
    let n = 0, nf = 0;
    for (let i = this.P.length - 1; i >= 0; i--) {
      const a = this.P[i];
      if (a.M && a.M.dead) { if (a.hero) this.heroA = null; this.P.splice(i, 1); continue; }
      this.move(a, a.v * dt);
      const [x, y, z, ang] = this.pose(a, a.side);
      if (!a.hero && Math.hypot(x - tg.x, z - tg.z) > R * 1.15) { this.P.splice(i, 1); continue; }
      a.wx = x; a.wy = y; a.wz = z;
      if (a.h0 === undefined) a.h0 = this.hd;
      else if (!a.still) { let dd = this.hd - a.h0; dd = Math.atan2(Math.sin(dd), Math.cos(dd)); a.h0 += dd * Math.min(1, dt * 8); }
      if (figs && nf < this.figMax && (x - cam.x) ** 2 + (y - cam.y) ** 2 + (z - cam.z) ** 2 < FD2) {
        const p = a.fp || (a.fp = figPerson(a));
        const F = figFor(figs, p);
        if (F.n < F.max) {
          const body = HEIGHT * figureScale(p, p.kid, p.old), mode = a.still || 'walk';
          o.position.set(x, y + 0.012, z); o.rotation.set(0, a.h0, 0); o.scale.setScalar(body); o.updateMatrix();
          const rate = mode === 'walk' ? Math.max(0.5, Math.min(4, a.v / (0.45 * body))) : 1;
          drawPerson(F, p, o.matrix, mode, rate, p.kid, p.old, false, null, a.look || (a.look = figLook(a)));
          a.slot = -1; nf++;
          continue;
        }
      }
      const bob = a.still ? 0 : Math.abs(Math.sin(clock * 7 + a.ph)) * 0.008;
      v.set(x, y + 0.03 + bob, z); q.setFromAxisAngle(this.up, ang + Math.PI / 2); m.compose(v, q, s);
      this.people.setMatrixAt(n, m); this.people.setColorAt(n, col.set(a.col)); a.slot = n; n++;
    }
    this.people.count = n;
    if (figs) for (const F of figs) F.end();
    n = 0;
    const side = this.left ? -1 : 1;
    for (let i = this.C.length - 1; i >= 0; i--) {
      const a = this.C[i];
      if ((a.M && a.M.dead) || !this.move(a, a.v * dt)) { this.C.splice(i, 1); continue; }
      const [x, y, z, ang] = this.pose(a, a.lane * side * (a.L.ow ? 0 : 1));
      if (Math.hypot(x - tg.x, z - tg.z) > R * 1.5) { this.C.splice(i, 1); continue; }
      v.set(x, y + 0.03, z); q.setFromAxisAngle(this.up, ang); m.compose(v, q, s);
      this.cars.setMatrixAt(n, m); this.cars.setColorAt(n, col.set(a.col)); n++;
    }
    this.cars.count = n;
    for (const M of [this.people, this.cars]) { M.instanceMatrix.needsUpdate = true; if (M.instanceColor) M.instanceColor.needsUpdate = true; }
    this.fxStep(dt, clock);
  }

  // Wer wurde angeklickt? Liefert { city, n } für das feste Leben
  // Wer liegt dem Strahl am nächsten (Figuren und leichte Formen gleich, die Figuren bewegt erst der Shader)
  pick(ray) {
    let best = null, bt = 1e9;
    const v = new THREE.Vector3(), c = new THREE.Vector3(), O = ray.ray.origin, Dd = ray.ray.direction;
    for (const a of this.P) {
      if (a.wx === undefined) continue;
      v.set(a.wx, a.wy + 0.09, a.wz);
      const t = c.copy(v).sub(O).dot(Dd); if (t < 0) continue;
      c.copy(O).addScaledVector(Dd, t);
      if (c.distanceTo(v) < 0.06 + t * 0.004 && t < bt) { bt = t; best = a; }
    }
    return best ? { city: this.cityIdx, n: best.id, hero: !!best.hero } : null;
  }

  // ---------- sichtbare Kräfte ----------
  effect(id) {
    if (id === 'beben') { this.shake = 2.2; return; }
    if (id === 'blitz' || id === 'meteor') { this.flash = 0.6; return; }
    if (id === 'regen' || id === 'sturm' || id === 'schnee' || id === 'flut') this.startFx(id === 'schnee' ? 'snow' : 'rain', id === 'sturm' ? 1.6 : 1);
  }
  startFx(kind, k) {
    this.stopFx();
    const n = 2600, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 60; pos[i * 3 + 1] = Math.random() * 30; pos[i * 3 + 2] = (Math.random() - 0.5) * 60; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: kind === 'snow' ? 0xffffff : 0xb8cfe0, size: kind === 'snow' ? 0.12 : 0.05, transparent: true, opacity: kind === 'snow' ? 0.9 : 0.55, depthWrite: false });
    this.fx = { pts: new THREE.Points(g, mat), kind, k, life: 14 };
    this.fx.pts.frustumCulled = false;
    this.group.add(this.fx.pts);
  }
  stopFx() { if (this.fx) { this.group.remove(this.fx.pts); this.fx.pts.geometry.dispose(); this.fx.pts.material.dispose(); this.fx = null; } }
  fxStep(dt) {
    const st = this.stage, tg = st.controls.target;
    if (this.shake > 0) { this.shake -= dt; const k = Math.min(1, this.shake) * 0.25; st.camera.position.x += (Math.random() - 0.5) * k; st.camera.position.z += (Math.random() - 0.5) * k; }
    if (this.flash > 0) { this.flash -= dt; st.grade.uniforms.flash && (st.grade.uniforms.flash.value = Math.max(0, this.flash)); }
    const F = this.fx; if (!F) return;
    F.life -= dt;
    const p = F.pts.geometry.attributes.position.array, fall = (F.kind === 'snow' ? 1.6 : 14) * F.k;
    for (let i = 0; i < p.length; i += 3) { p[i + 1] -= fall * dt; p[i] += (F.kind === 'snow' ? Math.sin(p[i + 1] + i) * 0.3 : F.k > 1 ? 4 : 0.6) * dt; if (p[i + 1] < 0) p[i + 1] += 30; }
    F.pts.position.set(tg.x, 0, tg.z);
    F.pts.geometry.attributes.position.needsUpdate = true;
    F.pts.material.opacity = Math.min(1, F.life / 3) * (F.kind === 'snow' ? 0.9 : 0.55);
    if (F.life <= 0) this.stopFx();
  }
}
