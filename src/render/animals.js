// Tiere: Wölfe und Füchse aus der Simulation (st.animals), dazu nur im Bild: Vogelschwärme über den Wäldern,
// Möwen an der Küste, springende Fische, Wale im tiefen Meer, Hunde, Katzen und Küken in den Dörfern,
// seit 19.10.2026 die Wildtiere je Lebensraum (wild.js), seit 21.10.2026 mit Regeln je Art (animal_rules.js):
// Hunde, Katzen und Hühner gehören zu einem Haus (Tür, Hof, Hunde auch die Straße direkt davor), Kühe auf eingezäunter
// Weide, Wildtiere nie auf Straßen oder in Orten.
// Alle Arten sind gebackene Animationen (tools/bake_animals.mjs, Quaternius CC0), je Art ein InstancedMesh,
// jedes Tier mit eigener Animation, Phase, Blickrichtung und Färbung.
import * as THREE from 'three';
import { NX, NY, wx, wz } from './scene.js';
import { groundY } from './terrain.js';
import { Wild, PARROT, SHRINK } from './wild.js';
import { around, T_BLD, T_SEA, T_RIVER, T_FIELD } from './animal_rules.js';
import { BIOMES } from '../sim/data.js';

const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const idx = (x, y) => y * NX + x;

// Länge in Weltmaßen (1 = eine Kachel), wie viele höchstens, Schatten
export const SPECIES = {
  wolf: { len: 0.46, max: 160, shadow: true },
  fox: { len: 0.34, max: 160, shadow: true },
  dog: { len: 0.3, max: 200, shadow: true },
  cat: { len: 0.2, max: 160, shadow: true },
  chick: { len: 0.085, max: 300, shadow: true },
  bird: { len: 0.3, max: 500, shadow: true },
  fish: { len: 0.14, max: 60, shadow: false },
  whale: { len: 2.6, max: 8, shadow: false },
  // Wildtiere (wild.js), werden erst geladen, wenn sie in der Nähe gebraucht werden
  deer: { len: 0.5, max: 60, shadow: true, lazy: true },
  stag: { len: 0.6, max: 30, shadow: true, lazy: true },
  reindeer: { len: 0.56, max: 60, shadow: true, lazy: true },
  antelope: { len: 0.42, max: 80, shadow: true, lazy: true },
  horse: { len: 0.62, max: 70, shadow: true, lazy: true },
  zebra: { len: 0.6, max: 70, shadow: true, lazy: true },
  giraffe: { len: 0.6, max: 30, shadow: true, lazy: true },
  camel: { len: 0.66, max: 30, shadow: true, lazy: true },
  cow: { len: 0.55, max: 60, shadow: true, lazy: true },
  hare: { len: 0.26, max: 40, shadow: true, lazy: true },
  snowhare: { len: 0.26, max: 40, shadow: true, lazy: true },
  lizard: { len: 0.25, max: 40, shadow: true, lazy: true },
  scorpion: { len: 0.17, max: 30, shadow: true, lazy: true },
  frog: { len: 0.13, max: 50, shadow: true, lazy: true },
  snake: { len: 0.42, max: 20, shadow: true, lazy: true },
  butterfly: { len: 0.075, max: 80, shadow: false, lazy: true },
  dragonfly: { len: 0.13, max: 40, shadow: false, lazy: true },
  heron: { len: 0.36, max: 20, shadow: true, lazy: true },
  seal: { len: 0.4, max: 30, shadow: true, lazy: true },
};
// Größe zu den Menschen (seit 25.10.2026): Faktoren in wild.js (SHRINK)
for (const [k, S] of Object.entries(SPECIES)) S.len *= SHRINK[k] ?? 1;
SPECIES.butterfly.max = 220; // kleine Schmetterlinge, dafür viel mehr (Naders Wunsch: mehr Leben)
const BKEY = BIOMES.map(b => b.key);
const BIRD_TINT = ['#6b5848', '#4b4a52', '#8a6a4a', '#5d6b78', '#a8743f'].map(c => new THREE.Color(c));
const GULL = new THREE.Color('#ffffff');
const WHITE = new THREE.Color('#ffffff');

const VS_HEAD = `
uniform sampler2D uVat; uniform vec2 uVatSize; uniform float uTime;
attribute vec4 aAnim; attribute float vid;
vec3 vatAt(float col) {
  float fr = fract(uTime * aAnim.w + aAnim.z) * aAnim.y;
  float f0 = floor(fr), f1 = mod(f0 + 1.0, aAnim.y), k = fr - f0;
  float x = (col + 0.5) / uVatSize.x;
  vec3 a = texture2D(uVat, vec2(x, (aAnim.x + f0 + 0.5) / uVatSize.y)).xyz;
  vec3 b = texture2D(uVat, vec2(x, (aAnim.x + f1 + 0.5) / uVatSize.y)).xyz;
  return mix(a, b, k);
}
uniform sampler2D uNrm;
vec3 nrmAt(float col) {
  float fr = fract(uTime * aAnim.w + aAnim.z) * aAnim.y;
  float f0 = floor(fr), f1 = mod(f0 + 1.0, aAnim.y), k = fr - f0;
  float x = (col + 0.5) / uVatSize.x;
  vec3 a = texture2D(uNrm, vec2(x, (aAnim.x + f0 + 0.5) / uVatSize.y)).xyz;
  vec3 b = texture2D(uNrm, vec2(x, (aAnim.x + f1 + 0.5) / uVatSize.y)).xyz;
  return normalize(mix(a, b, k) * 2.0 - 1.0 + 1e-5);
}
`;

// Weiche Normalen je Bild (seit 24.10.2026, PLAN_GRAFIK.md Runde 4): beim Laden aus den gebackenen Positionen gerechnet,
// Punkte an derselben Stelle der Ruhepose teilen sich eine Normale (die Low Poly Modelle haben je Fläche eigene Punkte).
// So wirken die Tiere rund wie Ton und Plüsch statt facettiert, ohne neue Dateien. RGBA8 wie bei den Menschen.
function smoothNormals(tex, index, U, R) {
  const half = THREE.DataUtils.fromHalfFloat, grp = new Int32Array(U), key = new Map();
  let G = 0;
  for (let u = 0; u < U; u++) {
    const k = half(tex[u * 4]).toFixed(3) + '|' + half(tex[u * 4 + 1]).toFixed(3) + '|' + half(tex[u * 4 + 2]).toFixed(3);
    let gi = key.get(k); if (gi === undefined) { gi = G++; key.set(k, gi); } grp[u] = gi;
  }
  const out = new Uint8Array(U * R * 4), acc = new Float32Array(G * 3), p = new Float32Array(U * 3);
  for (let r = 0; r < R; r++) {
    for (let u = 0; u < U; u++) { const o = (r * U + u) * 4; p[u * 3] = half(tex[o]); p[u * 3 + 1] = half(tex[o + 1]); p[u * 3 + 2] = half(tex[o + 2]); }
    acc.fill(0);
    for (let t = 0; t < index.length; t += 3) {
      const i0 = index[t] * 3, i1 = index[t + 1] * 3, i2 = index[t + 2] * 3;
      const ux = p[i1] - p[i0], uy = p[i1 + 1] - p[i0 + 1], uz = p[i1 + 2] - p[i0 + 2], vx = p[i2] - p[i0], vy = p[i2 + 1] - p[i0 + 1], vz = p[i2 + 2] - p[i0 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const i of [index[t], index[t + 1], index[t + 2]]) { const g = grp[i] * 3; acc[g] += nx; acc[g + 1] += ny; acc[g + 2] += nz; }
    }
    for (let u = 0; u < U; u++) {
      const g = grp[u] * 3; let x = acc[g], y = acc[g + 1], z = acc[g + 2]; const l = Math.hypot(x, y, z) || 1;
      x /= l; y /= l; z /= l;
      const o = (r * U + u) * 4; out[o] = (x * 0.5 + 0.5) * 255; out[o + 1] = (y * 0.5 + 0.5) * 255; out[o + 2] = (z * 0.5 + 0.5) * 255; out[o + 3] = 255;
    }
  }
  return out;
}

// Eine Tierart: Geometrie, gebackene Bewegung, ein InstancedMesh (exportiert für die Modell-Sammlung)
export class Kind {
  constructor(scene, id, uTime) {
    this.scene = scene; this.id = id; this.S = SPECIES[id];
    this.uni = { uVat: { value: null }, uNrm: { value: null }, uVatSize: { value: new THREE.Vector2(1, 1) }, uTime };
    this.n = 0; this.mesh = null;
  }

  async load() {
    const [meta, bin] = await Promise.all([
      fetch(`assets/animals/${this.id}.json`).then(r => { if (!r.ok) throw new Error(this.id); return r.json(); }),
      fetch(`assets/animals/${this.id}.bin`).then(r => { if (!r.ok) throw new Error(this.id); return r.arrayBuffer(); }),
    ]);
    const { U, rows, layout } = meta;
    this.clips = meta.clips; this.meta = meta;
    const index = new Uint16Array(bin, layout.index[0], layout.index[1]);
    const col = new Uint8Array(bin, layout.color[0], layout.color[1]);
    const tex = new Uint16Array(bin, layout.tex[0], layout.tex[1]);
    const vat = new THREE.DataTexture(tex, U, rows, THREE.RGBAFormat, THREE.HalfFloatType);
    vat.magFilter = vat.minFilter = THREE.NearestFilter;
    vat.needsUpdate = true;
    this.uni.uVat.value = vat;
    this.uni.uVatSize.value.set(U, rows);
    const nt = new THREE.DataTexture(smoothNormals(tex, index, U, rows), U, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
    nt.magFilter = nt.minFilter = THREE.NearestFilter; nt.needsUpdate = true;
    this.uni.uNrm.value = nt;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(U * 3), vid = new Float32Array(U), nor = new Float32Array(U * 3), c = new Float32Array(U * 3);
    const half = THREE.DataUtils.fromHalfFloat;
    for (let u = 0; u < U; u++) {
      pos[u * 3] = half(tex[u * 4]); pos[u * 3 + 1] = half(tex[u * 4 + 1]); pos[u * 3 + 2] = half(tex[u * 4 + 2]);
      vid[u] = u; nor[u * 3 + 1] = 1;
      // sRGB Farben aus dem Werkzeug in lineare Werte
      const cc = new THREE.Color().setRGB(col[u * 3] / 255, col[u * 3 + 1] / 255, col[u * 3 + 2] / 255, THREE.SRGBColorSpace);
      c[u * 3] = cc.r; c[u * 3 + 1] = cc.g; c[u * 3 + 2] = cc.b;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('vid', new THREE.BufferAttribute(vid, 1));
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    const max = this.S.max;
    const inst = (n, s) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * s), s); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a; };
    this.aAnim = inst('aAnim', 4);
    this.aTint = inst('aTint', 3);
    const uni = this.uni;
    // glatt schattiert mit weichen Normalen (smoothNormals), dazu ein Plüschschimmer am Rand (Fell, Ton), seit 24.10.2026
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = VS_HEAD + 'attribute vec3 aTint;\n' + sh.vertexShader
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = nrmAt(vid);')
        .replace('#include <begin_vertex>', 'vec3 transformed = vatAt(vid);')
        .replace('#include <color_vertex>', '#include <color_vertex>\n vColor *= aTint;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0) * 0.22;`);
    };
    mat.customProgramCacheKey = () => 'animal-vat-smooth';
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = sh => { Object.assign(sh.uniforms, uni); sh.vertexShader = VS_HEAD + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = vatAt(vid);'); };
    depth.customProgramCacheKey = () => 'animal-vat-depth';
    const mesh = new THREE.InstancedMesh(g, mat, max);
    mesh.customDepthMaterial = depth;
    mesh.castShadow = this.S.shadow; mesh.receiveShadow = false;
    mesh.frustumCulled = false; mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh = mesh;
    this.scene.add(mesh);
  }

  begin() { this.n = 0; }

  // Ein Tier: Ort, Blickrichtung (yaw, 0 = +z), Neigung, Animation, Phase, Tempo, Färbung, Größe
  add(o, X, Y, Z, yaw, clip, phase, rate, tint = WHITE, sc = 1, pitch = 0, roll = 0) {
    if (!this.mesh || this.n >= this.S.max) return;
    const C = this.clips[clip] || Object.values(this.clips)[0];
    const s = this.S.len * sc;
    o.position.set(X, Y, Z); o.rotation.set(pitch, yaw, roll, 'YXZ'); o.scale.set(s, s, s); o.updateMatrix();
    this.mesh.setMatrixAt(this.n, o.matrix);
    this.aAnim.array.set([C.row, C.frames, phase, rate / C.dur], this.n * 4);
    this.aTint.array.set([tint.r, tint.g, tint.b], this.n * 3);
    this.n++;
  }

  end() {
    if (!this.mesh) return;
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const a of [this.aAnim, this.aTint]) { a.needsUpdate = true; a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, this.n) * a.itemSize); }
  }
}

export class Animals {
  constructor(stage, uTime) {
    this.stage = stage;
    this.uTime = uTime || { value: 0 };
    this.kinds = {};
    this.state = new Map();     // Laufzustand je Tier (Schlüssel aus Sim ID oder Dorf und Nummer)
    this.flocks = []; this.jumps = []; this.whales = [];
    this.o = new THREE.Object3D();
    this.ready = false;
    this.forest = []; this.coast = []; this.deep = []; this.tilesAt = -1;
    this.lastT = 0;
    this.loading = new Set();
    this.wild = new Wild(this);
    this.rise = 0;
  }

  async load() {
    await Promise.all(Object.keys(SPECIES).filter(id => !SPECIES[id].lazy).map(id => this.loadKind(id)));
    this.ready = true;
  }
  async loadKind(id) {
    this.loading.add(id);
    const K = new Kind(this.stage.scene, id, this.uTime);
    try { await K.load(); this.kinds[id] = K; } catch (e) { console.info('Tier fehlt', id, e.message); }
  }
  // Art bei Bedarf nachladen: gibt sie zurück, sobald sie da ist
  need(id) {
    const K = this.kinds[id];
    if (K) return K;
    if (!this.loading.has(id) && SPECIES[id]) this.loadKind(id);
    return null;
  }

  // Waldkacheln, Küste, Tiefsee neu sammeln (selten, das Gelände ändert sich langsam)
  scanTiles(st) {
    const T = st.tiles;
    this.forest = []; this.coast = []; this.deep = [];
    for (let y = 2; y < NY - 2; y++) for (let x = 2; x < NX - 2; x++) {
      const i = idx(x, y), h = T.h[i];
      if (h >= 1 && T.tree[i] >= 2 && (x + y * 3) % 2 === 0) this.forest.push(i);
      else if (h === -1 && ((T.h[i - 1] >= 0) || (T.h[i + 1] >= 0) || (T.h[i - NX] >= 0) || (T.h[i + NX] >= 0))) this.coast.push(i);
      else if (h === -2 && x % 3 === 0 && y % 3 === 0) {
        let deep = true;
        for (let d = -3; d <= 3 && deep; d += 3) for (let e = -3; e <= 3; e += 3) if (T.h[idx(Math.min(NX - 1, Math.max(0, x + d)), Math.min(NY - 1, Math.max(0, y + e)))] !== -2) { deep = false; break; }
        if (deep) this.deep.push(i);
      }
    }
  }

  // Ein Tier läuft zu seinem Ziel; steht es, guckt es sich um. Gibt Ort, Blick und ob es läuft.
  walker(key, tx, tz, speed, dt, push = 1.8) {
    let S = this.state.get(key);
    if (!S) { S = { x: tx, z: tz, yaw: hash(key.length, tx * 7) * 6.28, moving: false, seen: 0 }; this.state.set(key, S); }
    S.seen = this.lastT;
    // Der Geist ist unsichtbar für Menschen, aber Tiere spüren ihn und weichen ein paar Schritte aus
    const G = this.ghost;
    if (G) {
      const gx = S.x - G.x, gz = S.z - G.z, gd = Math.hypot(gx, gz);
      if (push && gd < 1.3 && gd > 1e-3) { S.off = [gx / gd * push, gz / gd * push]; S.offUntil = this.lastT + 4; }
    }
    if (S.off && this.lastT < S.offUntil) { tx += S.off[0]; tz += S.off[1]; speed *= push > 1 ? 2.2 : 1.4; }
    const dx = tx - S.x, dz = tz - S.z, d = Math.hypot(dx, dz);
    if (d > 4) { S.x = tx; S.z = tz; S.moving = false; return S; }   // zu weit, einfach dort sein (Zeitraffer)
    if (d > 0.02) {
      const step = Math.min(d, speed * dt);
      S.x += dx / d * step; S.z += dz / d * step;
      const want = Math.atan2(dx, dz);
      let dy = want - S.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      S.yaw += dy * Math.min(1, dt * 6);
      S.moving = true;
    } else S.moving = false;
    return S;
  }

  // Vögel nicht direkt vor der Kamera (seit 24.10.2026, Runde 3): näher als gut die Hälfte des Abstands Kamera zu
  // Blickziel werden sie weich kleiner und verschwinden, sonst flogen sie groß und unscharf (Schärfentiefe) durchs Bild
  camFade(X, Y, Z) {
    const c = this.stage.camera.position, D = this.camD || 20;
    const d = Math.hypot(X - c.x, Y - c.y, Z - c.z), lo = Math.max(1.2, D * 0.55), hi = Math.max(2, D * 0.8);
    const k = Math.max(0, Math.min(1, (d - lo) / (hi - lo)));
    return k * k * (3 - 2 * k);
  }

  update(st, t, dt, night, wxs, rise, buildings) {
    if (!this.ready || !st) return;
    this.lastT = t;
    this.uTime.value = t;
    this.rise = rise;
    const cam = this.stage.camera, tgt = this.stage.controls.target, o = this.o;
    this.camD = cam.position.distanceTo(tgt); // für camFade (Vögel weichen der Kamera aus)
    for (const K of Object.values(this.kinds)) K.begin();
    const far = this.hidden || cam.position.y > 80 ? 0 : Math.min(85, 16 + cam.position.y * 1.6);
    const far2 = far * far;
    const near = (X, Z) => (X - cam.position.x) ** 2 + (Z - cam.position.z) ** 2 < far2;
    if (this.tilesAt < 0 || t - this.tilesAt > 20 || st._rt.animalsDirty) { this.scanTiles(st); this.tilesAt = t; st._rt.animalsDirty = false; }
    const day = night < 0.6;
    const R = this.wild.rules(st, t);

    // 1 Wölfe und Füchse aus der Simulation
    const W = this.kinds.wolf, F = this.kinds.fox;
    if (far) for (const a of st.animals || []) {
      const K = a.k === 'wolf' ? W : F;
      if (!K) continue;
      const jx = (hash(a.id, 3) - 0.5) * 0.7, jz = (hash(a.id, 9) - 0.5) * 0.7;
      // kleine Streifzüge um den Platz, damit sie nicht wie Statuen stehen
      const roam = Math.floor(t / (7 + hash(a.id) * 6) + hash(a.id, 5) * 10);
      const rx = (hash(a.id, roam) - 0.5) * 0.5, rz = (hash(roam, a.id) - 0.5) * 0.5;
      let tx = wx(a.x) + jx + rx, tz = wz(a.y) + jz + rz;
      if (!R.can(a.k === 'wolf' ? 'wolf' : 'fox', this.wild.idx(tx, tz))) { tx = wx(a.x); tz = wz(a.y); } // nicht auf Straßen oder in Häuser streifen
      if (!near(tx, tz)) continue;
      const S = this.walker('a' + a.id, tx, tz, a.k === 'wolf' ? 0.42 : 0.55, dt);
      const Y = groundY(S.x, S.z);
      if (a.k === 'wolf') W.add(o, S.x, Y, S.z, S.yaw, S.moving ? 'walk' : 'idle', hash(a.id), S.moving ? 1.4 : 1);
      else F.add(o, S.x, Y, S.z, S.yaw, 'run', hash(a.id), S.moving ? 1 : 0.0001, WHITE, 1, 0, 0);
    }

    // 2 Hunde, Katzen und Hühner gehören zu einem Haus (nur im Bild, seit 21.10.2026 mit Regeln). Hund: an der Tür oder im
    // Hof, nie auf der Fahrbahn, nachts liegt er vor der Tür. Katze: sitzt lange auf der Schwelle oder
    // streift durch den Hof, nachts mehr. Hühner: nur im Hof (nie auf Straße oder Platz), nachts im Stall. Wege führen um
    // das Haus herum, nie durch die Wand.
    if (far) for (const s of st.settlements) {
      if (!s.alive || s.era < 1 || !near(wx(s.cx), wz(s.cy)) && (wx(s.cx) - cam.position.x) ** 2 + (wz(s.cy) - cam.position.z) ** 2 > (far + s.R) ** 2) continue;
      const homes = this.homes(st, s, R);
      if (!homes.length) continue;
      const yards = homes.filter(h => h.yard.length);
      const pets = [['dog', Math.min(5, Math.floor(s.pop / 16) + 1), 0.45 * SHRINK.dog ** 0.8], ['cat', Math.min(4, Math.floor(s.pop / 22)), 0.35 * SHRINK.cat ** 0.8], ['chick', yards.length ? Math.min(14, s.has?.feld ? 6 + Math.floor(s.pop / 20) : 3) : 0, 0.16 * SHRINK.chick ** 0.8]];
      for (const [kind, n, speed] of pets) {
        const K = this.kinds[kind];
        if (!K || (kind === 'chick' && night > 0.55)) continue; // Hühner schlafen im Stall
        for (let k = 0; k < n; k++) {
          const key = `${s.id}${kind}${k}`;
          const pool = kind === 'chick' ? yards : homes;
          // Hühner zu dritt oder viert je Hof, nicht jedes Huhn woanders
          const h = pool[Math.floor(hash(s.id * 31 + (kind === 'chick' ? Math.floor(k / 4) : k), kind.length) * pool.length)];
          const per = kind === 'cat' ? 16 : kind === 'chick' ? 5 : 9;
          const slot = Math.floor(t / per + hash(k, s.id) * 7), r = hash(slot, k * 13 + s.id);
          let spot = h.door, rest = false;
          if (kind === 'dog') {
            if (night > 0.6) rest = true;
            else if (r < 0.38) spot = h.door;
            else if (h.yard.length) spot = h.yard[Math.floor(hash(slot, k) * h.yard.length)];
          } else if (kind === 'cat') {
            if ((night > 0.6 ? r < 0.7 : r < 0.42) && h.yard.length) spot = h.yard[Math.floor(hash(slot, k) * h.yard.length)];
          } else spot = h.yard[Math.floor(hash(slot, k + 3) * h.yard.length)];
          const j = spot === h.door ? 0.08 : 0.3;
          let tx = spot[0] + (hash(k, slot) - 0.5) * 2 * j, tz = spot[1] + (hash(slot, k + 9) - 0.5) * 2 * j;
          if (!near(tx, tz)) continue;
          // um das eigene Haus herum statt hindurch
          const S0 = this.state.get(key);
          if (S0) { const w = around(S0.x, S0.z, tx, tz, h.X, h.Z, 0.46); if (w) { tx = w[0]; tz = w[1]; } }
          const S = this.walker(key, tx, tz, speed, dt, 0.5);
          const Y = groundY(S.x, S.z);
          if (kind === 'chick') K.add(o, S.x, Y, S.z, S.yaw, 'peck', hash(k, s.id), S.moving ? 1.6 : 0.8, WHITE, 1.15);
          else K.add(o, S.x, Y, S.z, S.yaw, S.moving ? 'walk' : 'idle', hash(k, s.id * 3), S.moving ? (kind === 'dog' ? 1.3 : 1) : rest ? 0.35 : 1, kind === 'dog' ? this.dogTint(s.id * 7 + k) : WHITE);
        }
      }
    }

    // 3 Vogelschwärme über den Wäldern, Möwen an der Küste
    const B = this.kinds.bird;
    if (B && far && wxs.storm < 0.6) {
      const want = Math.min(9, 2 + Math.floor(this.forest.length / 260));
      this.flocks = this.flocks.filter(f => t - f.born < f.life && (f.cx - tgt.x) ** 2 + (f.cz - tgt.z) ** 2 < 70 * 70);
      let guard = 0;
      while (this.flocks.length < want && guard++ < 6) {
        const gull = Math.random() < 0.3;
        const pool = gull ? this.coast : this.forest;
        if (!pool.length) break;
        // nahe am Blick, sonst sieht sie keiner
        let pick = -1;
        for (let k = 0; k < 12; k++) { const i = pool[Math.floor(Math.random() * pool.length)]; const X = wx(i % NX), Z = wz((i / NX) | 0); if ((X - tgt.x) ** 2 + (Z - tgt.z) ** 2 < 30 * 30) { pick = i; break; } }
        if (pick < 0) break;
        const X = wx(pick % NX), Z = wz((pick / NX) | 0);
        const n = gull ? 2 + Math.floor(Math.random() * 3) : 5 + Math.floor(Math.random() * 7);
        // im Regenwald sind es Papageien: bunt, kleinere Trupps
        const parrot = !gull && BKEY[st.tiles.bio[pick]] === 'tropen';
        this.flocks.push({ parrot, cx: X, cz: Z, gy: Math.max(0.2, groundY(X, Z)), r: 1.6 + Math.random() * 3, h: 1.8 + Math.random() * 2.2, w: (0.25 + Math.random() * 0.3) * (Math.random() < 0.5 ? 1 : -1), ph: Math.random() * 6.28, n, gull, born: t, life: 40 + Math.random() * 60, drift: [(Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25], tint: BIRD_TINT[Math.floor(Math.random() * BIRD_TINT.length)], seed: Math.floor(Math.random() * 1e6) });
      }
      for (const f of this.flocks) {
        const age = t - f.born;
        // Auftauchen und Wegfliegen: anfangs aus der Höhe, am Ende davon
        const fade = Math.min(1, age / 3, (f.life - age) / 3);
        // kommt der Geist näher, steigt der Schwarm auf und zieht davon
        if (this.ghost && !f.scared && Math.hypot(f.cx + f.drift[0] * age - this.ghost.x, f.cz + f.drift[1] * age - this.ghost.z) < 3) {
          f.scared = true; f.life = Math.min(f.life, age + 4); f.drift = [f.drift[0] * 4 + 0.6, f.drift[1] * 4 + 0.6]; f.w *= 1.8;
        }
        const cx = f.cx + f.drift[0] * age, cz = f.cz + f.drift[1] * age;
        if ((cx - cam.position.x) ** 2 + (cz - cam.position.z) ** 2 > Math.max(far2, 60 * 60)) continue;
        for (let k = 0; k < f.n; k++) {
          if (!day && k % 3) continue;
          const hk = hash(f.seed, k);
          const a = t * f.w * (0.9 + hk * 0.2) + f.ph + k * 0.55;
          const r = f.r * (0.75 + hash(k, f.seed) * 0.5) + Math.sin(t * 0.7 + k) * 0.25;
          const X = cx + Math.cos(a) * r, Z = cz + Math.sin(a) * r;
          const Y = f.gy + f.h + Math.sin(t * 0.9 + k * 1.7) * 0.35 + (1 - fade) * 4 + hk * 0.6;
          // Blick entlang der Kreisbahn, Schräglage in die Kurve, mal gleiten, mal schlagen
          const yaw = Math.atan2(-Math.sin(a) * Math.sign(f.w), Math.cos(a) * Math.sign(f.w));
          const glide = Math.sin(t * 0.6 + k * 2.3) > 0.35;
          const cf = this.camFade(X, Y, Z);
          if (cf < 0.02) continue;
          B.add(o, X, Y, Z, yaw, 'fly', hk, glide ? 0.0001 : 1.3 + hk * 0.6, f.gull ? GULL : f.parrot ? PARROT[Math.floor(hk * PARROT.length)] : f.tint, (f.gull ? 1.5 : f.parrot ? 0.85 : 1) * cf, 0, -0.35 * Math.sign(f.w));
        }
      }
    } else this.flocks.length = 0;

    // 4 Springende Fische an der Küste
    const Fi = this.kinds.fish;
    if (Fi && far && day) {
      if (this.coast.length && Math.random() < dt * 1.2 && this.jumps.length < 6) {
        for (let k = 0; k < 6; k++) {
          const i = this.coast[Math.floor(Math.random() * this.coast.length)];
          const X = wx(i % NX) + (Math.random() - 0.5), Z = wz((i / NX) | 0) + (Math.random() - 0.5);
          if ((X - tgt.x) ** 2 + (Z - tgt.z) ** 2 > 30 * 30) continue;
          this.jumps.push({ X, Z, yaw: Math.random() * 6.28, t0: t, dur: 0.75 + Math.random() * 0.3, h: 0.22 + Math.random() * 0.18, splashed: 0 });
          break;
        }
      }
      this.jumps = this.jumps.filter(j => t - j.t0 < j.dur + 0.1);
      for (const j of this.jumps) {
        const u = Math.min(1, (t - j.t0) / j.dur);
        const X = j.X + Math.sin(j.yaw) * u * 0.45, Z = j.Z + Math.cos(j.yaw) * u * 0.45;
        const Y = rise - 0.05 + 4 * j.h * u * (1 - u);
        if (this.onSplash && (u > 0 && !j.splashed || u >= 1 && j.splashed === 1)) { this.onSplash(X, rise, Z); j.splashed++; }
        Fi.add(o, X, Y, Z, j.yaw, 'swim', j.t0, 1.6, WHITE, 1, (u - 0.5) * 2.2, 0);
      }
    }

    // 5 Wale im tiefen Meer: ziehen langsame Kreise, tauchen auf, blasen, tauchen ab
    const Wh = this.kinds.whale;
    if (Wh && this.deep.length) {
      if (!this.whales.length) {
        const n = Math.min(3, 1 + Math.floor(this.deep.length / 120));
        for (let k = 0; k < n; k++) {
          const i = this.deep[Math.floor(hash(st.seed || 1, k) * this.deep.length)];
          this.whales.push({ cx: wx(i % NX), cz: wz((i / NX) | 0), r: 5 + hash(k, 3) * 6, w: 0.02 + hash(k, 7) * 0.015, ph: hash(k, 11) * 6.28, per: 24 + hash(k, 13) * 16, blown: -1 });
        }
      }
      for (const w of this.whales) {
        const a = t * w.w + w.ph;
        const X = w.cx + Math.cos(a) * w.r, Z = w.cz + Math.sin(a) * w.r;
        if ((X - cam.position.x) ** 2 + (Z - cam.position.z) ** 2 > 140 * 140) continue;
        // Atemzyklus: lange unten, dann 6 Sekunden oben
        const c = ((t + w.ph * 10) % w.per) / w.per;
        const up = c > 0.78 ? Math.sin((c - 0.78) / 0.22 * Math.PI) : 0;
        const Y = rise - 0.75 + up * 0.72;
        const yaw = Math.atan2(-Math.sin(a), Math.cos(a));
        const pitch = c > 0.78 ? -Math.cos((c - 0.78) / 0.22 * Math.PI) * 0.12 : 0;
        const cyc = Math.floor((t + w.ph * 10) / w.per);
        if (up > 0.9 && w.blown !== cyc && this.onSpout) { w.blown = cyc; this.onSpout(X + Math.sin(yaw) * 0.7, Y + 0.35, Z + Math.cos(yaw) * 0.7); }
        Wh.add(o, X, Y, Z, yaw, 'swim', w.ph, 0.6, WHITE, 1, pitch, 0);
      }
    }

    // 6 Wildtiere je Lebensraum
    this.wild.update(st, t, dt, night, wxs, cam, tgt, this.show ? 0 : far);

    // Testbild: jede Art einmal nebeneinander, abwechselnd laufend und stehend
    if (this.show) {
      const [sx, sz] = this.show;
      let k = 0;
      for (const id of Object.keys(SPECIES)) this.need(id);
      for (const [id, K] of Object.entries(this.kinds)) {
        if (id === 'whale' || (this.showOnly && !(Array.isArray(this.showOnly) ? this.showOnly.includes(id) : this.showOnly === id))) continue;
        const one = this.showOnly && !Array.isArray(this.showOnly), X = one ? sx : sx + (k % 7 - 3) * (this.showGap || 0.9), Z = one ? sz : sz + Math.floor(k / 7) * (this.showGap || 0.9);
        const Y = id === 'bird' || id === 'fish' || id === 'butterfly' || id === 'dragonfly' ? groundY(X, Z) + 0.12 : groundY(X, Z);
        const clip = this.showClip && K.clips[this.showClip] ? this.showClip : Object.keys(K.clips)[0];
        K.add(o, X, Y, Z, this.showYaw ?? 0.6, clip, 0.1, 1);
        k++;
      }
    }
    for (const K of Object.values(this.kinds)) K.end();
    // Alte Laufzustände aufräumen
    if (this.state.size > 1500) for (const [k, S] of this.state) if (t - S.seen > 30) this.state.delete(k);
  }

  // Häuser einer Siedlung mit Tür und Hof (gecacht je Siedlung, alle paar Sekunden neu)
  homes(st, s, R) {
    this.homeCache = this.homeCache || new Map();
    const c = this.homeCache.get(s.id);
    if (c && this.lastT - c.t < 6 && c.st === st) return c.list;
    const list = [], P = this.people;
    for (const b of st.buildings) {
      if (b.s !== s.id || b.t !== 'haus' || !(b.prog >= 1)) continue;
      const X = wx(b.x), Z = wz(b.y);
      const d = P && P.door ? P.door(st, b) : { X, Z: Z + 0.44, sx: 0, sz: 1, tx: b.x, ty: b.y + 1 };
      const ft = d.ty * NX + d.tx, own = b.y * NX + b.x;
      // vor der Tür muss freier Boden sein (Straße, Hof, Wiese), sonst ist sie für Tiere kein Platz (dichte Altstadt)
      const fc = R ? R.info(ft) : 0;
      const door = ft !== own && !(fc & (T_BLD | T_SEA | T_RIVER | T_FIELD)) ? [X + d.sx * 0.58, Z + d.sz * 0.58] : null;
      const yard = R ? R.yard(st, b).filter(i => i !== ft).map(i => [wx(i % NX), wz((i / NX) | 0)]) : [];
      if (!door && !yard.length) continue; // eingebaut, kein Platz für Tiere
      list.push({ X, Z, door: door || yard[0], yard });
    }
    this.homeCache.set(s.id, { t: this.lastT, st, list });
    return list;
  }

  dogTint(k) {
    const T = ['#ffffff', '#ffffff', '#7a6a5a', '#c9b79a', '#4a4038', '#e8e2d6'];
    return (this._dogT || (this._dogT = T.map(c => new THREE.Color(c))))[Math.floor(hash(k, 77) * T.length)];
  }

  // Zum Testen: alle Arten nebeneinander
  showcase(X, Z) { this.show = [X, Z]; }
}
