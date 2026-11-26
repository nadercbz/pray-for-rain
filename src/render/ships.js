// Schiffe zwischen den Inseln. Handel fährt als Pendel (Fleet): auf jeder Handelsroute zwischen zwei Häfen laufen 1 bis 4 Schiffe
// hin und her, legen am Pier längsseits an, bleiben liegen (Arbeiter tragen Kisten, ab Epoche 4 schwenkt ein Kran) und fahren dann zurück.
// Krieg (rote Segel), Siedler (gelb) und Entdecker (hellblau) kommen weiter aus st.voyages.
// Alle fahren auf Seewegen (A* über Wasser, geglättet). Der Bau richtet sich nach der Epoche der Heimatinsel:
// Einbaum (0 bis 1), Kogge oder Langschiff (2 bis 3), Karavelle (4), Galeone (5), Raddampfer (6), Frachter oder Fähre (7).
// Jedes Schiff ist ein einziges Mesh mit Vertexfarben. Segel und Flaggen bewegen sich über Morph Ziele (billig).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NX, NY, wx, wz } from './scene.js';
import { groundY } from './terrain.js';
import { findPath } from '../sim/world.js';
import { Occ } from './traffic.js';

const SAIL = { handel: '#f4efe2', krieg: '#c8553d', siedler: '#ecc45e', entdeckung: '#dfe9f0', pirat: '#2c2829' };
const FLAG = { handel: '#4f9d94', krieg: '#2f2b2c', siedler: '#e08a3c', entdeckung: '#3f6fa6', pirat: '#141213' };
const ACC = { handel: '#5fa8a0', krieg: '#b8452f', siedler: '#e0a640', entdeckung: '#6f93bd', pirat: '#3b3335' };

// Tiny Glade Palette: warme Hölzer, cremige Stoffe, weiche Farben
export const K = {
  wood: '#a37a52', woodL: '#bd9467', woodD: '#7d5a3e', woodX: '#5a412f', under: '#6d4d3a',
  deck: '#d2b284', deckD: '#c2a177', rail: '#d6b98f', rope: '#c9b48a', ropeD: '#9d8962',
  gold: '#e6bd5c', iron: '#575c66', ironL: '#8e939b', cream: '#f5f0e4', glass: '#9ccbd9', glassD: '#7aa9bd',
  skin: '#e3b690', red: '#c8553d', teal: '#5fa8a0', sun: '#ecc45e', sky: '#8fb4d6', sage: '#9cb48a', coral: '#e08e72',
};
const COAT = ['#c8553d', '#5fa8a0', '#e0a640', '#6f93bd', '#f1e6d0', '#a7bf8f'];

// ---------- kleine Helfer ----------
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const lin = (a, b, n) => { const r = []; for (let i = 0; i <= n; i++) r.push(a + (b - a) * i / n); return r; };
const hsh = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
const _col = new Map();
export const col = c => { if (c && c.isColor) return c; let k = _col.get(c); if (!k) { k = new THREE.Color(c); _col.set(c, k); } return k; };
export const shade = (c, k) => col(c).clone().multiplyScalar(k);
const mix = (a, b, t) => col(a).clone().lerp(col(b), t);
const MK = ['m0', 'm1', 'm2', 'm3'];
const _y = new THREE.Vector3(0, 1, 0);

// Material mit Instanzfarbe nur auf Teilen mit paint = 1 (Karosserie, Kittel). Der Rest behält seine Vertexfarbe.
// gloss (seit 24.10.2026): lackierte Teile bekommen diese Rauheit (Klarlack der Autos), der Rest bleibt matt
export function paintable(mat, gloss = null) {
  mat.onBeforeCompile = sh => {
    if (gloss != null) {
      sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying float vPaint;\nvoid main() {\n vPaint = paint;');
      sh.fragmentShader = 'varying float vPaint;\n' + sh.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, ${gloss.toFixed(2)}, vPaint);`);
    }
    sh.vertexShader = sh.vertexShader.replace('void main() {', 'attribute float paint;\nvoid main() {').replace('#include <color_vertex>', `
      #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
        vColor = vec3( 1.0 );
      #endif
      #ifdef USE_COLOR
        vColor *= color.rgb;
      #endif
      #ifdef USE_INSTANCING_COLOR
        vColor.xyz *= mix( vec3( 1.0 ), instanceColor.xyz, paint );
      #endif`);
  };
  mat.customProgramCacheKey = () => 'paintable' + gloss;
  return mat;
}

// Baukasten: sammelt gefärbte Teile und verschmilzt sie zu einer Geometrie.
// Morph Ziele: m0 = Segel bläht sich, m1 und m2 = Flaggen flattern (zwei Phasen), m3 = Riemen und Paddel schwingen.
export class Bld {
  constructor() { this.parts = []; this.pf = 0; } // pf = 1: Teile bekommen die Instanzfarbe (siehe paintable)

  put(g, c) {
    g = g.index ? g.toNonIndexed() : g;
    if (g.attributes.uv) g.deleteAttribute('uv');
    const n = g.attributes.position.count;
    if (!g.attributes.color) {
      const k = col(c), a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = k.r; a[i * 3 + 1] = k.g; a[i * 3 + 2] = k.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    }
    for (const m of MK) if (!g.attributes[m]) g.setAttribute(m, new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    if (!g.attributes.paint) g.setAttribute('paint', new THREE.BufferAttribute(new Float32Array(n).fill(this.pf), 1));
    this.parts.push(g);
    return g;
  }

  box(w, h, d, x, y, z, c, rx = 0, ry = 0, rz = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    return this.put(g.translate(x, y, z), c);
  }

  // Zylinder mit Achse y, rot = [rx, ry, rz]
  cyl(rt, rb, h, x, y, z, c, seg = 6, rot = null, open = false) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
    if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])));
    return this.put(g.translate(x, y, z), c);
  }

  sph(r, x, y, z, c, sx = 1, sy = 1, sz = 1, ws = 6, hs = 4) {
    return this.put(new THREE.SphereGeometry(r, ws, hs).scale(sx, sy, sz).translate(x, y, z), c);
  }

  cone(r, h, x, y, z, c, seg = 6, rot = null) {
    const g = new THREE.ConeGeometry(r, h, seg);
    if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])));
    return this.put(g.translate(x, y, z), c);
  }

  // Dünner Stab von a nach b (Taue, Spieren, Pfosten)
  rod(a, b, r, c, seg = 3, r2 = r) {
    const A = new THREE.Vector3(...a), D = new THREE.Vector3(...b).sub(A), len = D.length();
    if (len < 1e-5) return null;
    const g = new THREE.CylinderGeometry(r2, r, len, seg, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_y, D.normalize()));
    return this.put(g.translate(A.x + D.x * len / 2, A.y + D.y * len / 2, A.z + D.z * len / 2), c);
  }

  // Gebogenes Rohr entlang von Punkten (Steven, Drachenhals, Schwanenhals)
  tube(pts, r0, r1, c, rs = 5, n = 12) {
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
    const fr = curve.computeFrenetFrames(n, false), pos = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, p = curve.getPointAt(t), a = fr.normals[i], b = fr.binormals[i], r = lerp(r0, r1, t);
      for (let k = 0; k < rs; k++) {
        const w = k / rs * Math.PI * 2, cx = Math.cos(w) * r, cy = Math.sin(w) * r;
        pos.push(p.x + a.x * cx + b.x * cy, p.y + a.y * cx + b.y * cy, p.z + a.z * cx + b.z * cy);
      }
    }
    for (let i = 0; i < n; i++) for (let k = 0; k < rs; k++) {
      const a = i * rs + k, b = i * rs + (k + 1) % rs, c2 = (i + 1) * rs + k, d = (i + 1) * rs + (k + 1) % rs;
      idx.push(a, b, c2, b, d, c2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return this.put(g, c);
  }

  // Flaches Viereck in einer Achsenebene (Fenster, Luken, Schilde ohne Dicke)
  quad(w, h, x, y, z, c, face = '+z', rot = 0, tilt = 0) {
    const g = new THREE.PlaneGeometry(w, h);
    if (rot) g.rotateZ(rot);
    if (tilt) g.rotateX(tilt);
    if (face === '-z') g.rotateY(Math.PI);
    else if (face === '+x') g.rotateY(Math.PI / 2);
    else if (face === '-x') g.rotateY(-Math.PI / 2);
    else if (face === '+y') g.rotateX(-Math.PI / 2);
    return this.put(g.translate(x, y, z), c);
  }

  disc(r, x, y, z, c, face = '+z', seg = 8, tilt = 0) {
    const g = new THREE.CircleGeometry(r, seg);
    if (tilt) g.rotateX(tilt);
    if (face === '-z') g.rotateY(Math.PI);
    else if (face === '+x') g.rotateY(Math.PI / 2);
    else if (face === '-x') g.rotateY(-Math.PI / 2);
    else if (face === '+y') g.rotateX(-Math.PI / 2);
    return this.put(g.translate(x, y, z), c);
  }

  // Fläche aus einem Gitter: us, vs sind Parameterlisten, P(u, v, i, j) liefert [x, y, z],
  // cf(i, j) die Farbe einer Zelle (null lässt sie weg), mf(u, v) optional die Morph Deltas [m0, m1, m2].
  surf(us, vs, P, cf, mf = null, flip = false) {
    const nu = us.length, nv = vs.length, V = nu * nv;
    const pos = new Float32Array(V * 3), mor = [new Float32Array(V * 3), new Float32Array(V * 3), new Float32Array(V * 3), new Float32Array(V * 3)];
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const p = P(us[i], vs[j], i, j), k = (j * nu + i) * 3;
      pos[k] = p[0]; pos[k + 1] = p[1]; pos[k + 2] = p[2];
      if (mf) {
        const m = mf(us[i], vs[j], i, j);
        for (let t = 0; t < 3; t++) if (m[t]) { mor[t][k] = m[t][0]; mor[t][k + 1] = m[t][1]; mor[t][k + 2] = m[t][2]; }
      }
    }
    const idx = [];
    for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
      const a = j * nu + i, b = a + 1, c = a + nu, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    tg.setIndex(idx); tg.computeVertexNormals();
    const nrm = tg.attributes.normal.array;
    const cells = [];
    for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
      const c = cf(i, j);
      if (c) cells.push([i, j, col(c)]);
    }
    const n = cells.length * 6;
    const op = new Float32Array(n * 3), on = new Float32Array(n * 3), oc = new Float32Array(n * 3);
    const om = [new Float32Array(n * 3), new Float32Array(n * 3), new Float32Array(n * 3), new Float32Array(n * 3)];
    const sg = flip ? -1 : 1;
    cells.forEach(([i, j, c], ci) => {
      const a = j * nu + i, b = a + 1, cc = a + nu, d = cc + 1;
      const order = flip ? [a, cc, b, b, cc, d] : [a, b, cc, b, d, cc];
      for (let t = 0; t < 6; t++) {
        const s = order[t] * 3, o = (ci * 6 + t) * 3;
        op[o] = pos[s]; op[o + 1] = pos[s + 1]; op[o + 2] = pos[s + 2];
        on[o] = nrm[s] * sg; on[o + 1] = nrm[s + 1] * sg; on[o + 2] = nrm[s + 2] * sg;
        oc[o] = c.r; oc[o + 1] = c.g; oc[o + 2] = c.b;
        for (let m = 0; m < 4; m++) { om[m][o] = mor[m][s]; om[m][o + 1] = mor[m][s + 1]; om[m][o + 2] = mor[m][s + 2]; }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(op, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(on, 3));
    g.setAttribute('color', new THREE.BufferAttribute(oc, 3));
    MK.forEach((k, m) => g.setAttribute(k, new THREE.BufferAttribute(om[m], 3)));
    return this.put(g);
  }

  // Rahsegel (Rechteck oder Trapez) in der YZ Ebene, bläht sich nach vorn (+x).
  // o: x y z Mitte unten, bw unten, tw oben, h Höhe, bulge, roach (Ausschnitt am Fuß), c, c2 für Streifen
  sail(o) {
    const { x = 0, y = 0, z = 0, bw, h, c, c2 = null, bulge = h * 0.22, roach = h * 0.06, rows = 5, cols = 8, emblem = null } = o;
    const tw = o.tw ?? bw * 0.86;
    const us = lin(-1, 1, cols), vs = lin(0, 1, rows);
    const sh = (u, v) => (1 - u * u) * Math.sin(Math.PI * (0.1 + 0.78 * v)) * (1 - 0.85 * Math.pow(v, 5));
    const P = (u, v) => [x + bulge * sh(u, v), y + v * h + roach * (1 - u * u) * Math.pow(1 - v, 1.3), z + u * lerp(bw, tw, v) / 2];
    const mf = (u, v) => [[bulge * 0.6 * sh(u, v), 0, 0]];
    const cf = (i, j) => {
      let k = shade(c, j % 2 ? 0.95 : 1.0);
      if (i === 0 || i === cols - 1) return shade(c, 0.84);
      if (c2 && Math.floor(i / 2) % 2 === 1) k = shade(c2, j % 2 ? 0.95 : 1.0);
      if (emblem && i >= cols / 2 - 1 && i <= cols / 2 && j >= 1 && j < rows - 1) k = shade(emblem, j % 2 ? 0.95 : 1.0);
      return k;
    };
    return this.surf(us, vs, P, cf, mf);
  }

  // Dreieckssegel in der XY Ebene (Vorsegel, Lateinersegel, Schratsegel). a = Hals, b = Kopf, cl = Schothorn.
  // Das Vorliek (a nach b) ist fest, der Rest bläht sich in Richtung dir.
  tri(o) {
    const { a, b, cl, dir = [0, 0, 1], bulge = 0.05, c, c2 = null, rows = 6, cols = 5, weave = 0.94 } = o;
    const us = lin(0, 1, cols), vs = lin(0, 1, rows);
    const sh = (u, v) => Math.sin(Math.PI * u) * (0.45 + 0.55 * Math.sin(Math.PI * clamp(v * 0.92 + 0.04)));
    const P = (u, v) => {
      const lx = lerp(a[0], b[0], v), ly = lerp(a[1], b[1], v), lz = lerp(a[2], b[2], v), s = bulge * sh(u, v);
      return [lerp(lx, cl[0], u) + dir[0] * s, lerp(ly, cl[1], u) + dir[1] * s, lerp(lz, cl[2], u) + dir[2] * s];
    };
    const mf = (u, v) => { const s = bulge * 0.7 * sh(u, v); return [[dir[0] * s, dir[1] * s, dir[2] * s]]; };
    const cf = (i, j) => (j % 2 && c2 ? shade(c2, 1) : shade(c, j % 2 ? weave : 1));
    return this.surf(us, vs, P, cf, mf);
  }

  // Wimpel in Fahrtrichtung, flattert über m1 und m2
  flag(x, y, z, len, h, c) {
    const us = lin(0, 1, 6), vs = [0, 1];
    const wob = (u, ph) => 0.045 * u * Math.sin(u * 7 + ph);
    const P = (u, v) => [x + u * len, y + (v - 0.5) * h * (1 - u * 0.92), z];
    const mf = u => [null, [0, 0, wob(u, 0)], [0, 0, wob(u, Math.PI / 2)]];
    const stripe = this.surf(us, vs, P, i => (i === 2 || i === 3 ? shade(c, 1.12) : c), mf);
    return stripe;
  }

  // Hält Dinge im Rumpf: schiebt z nach innen, wenn Platz zur Bordwand fehlt (nur zwischen Deck und Reling)
  fitZ(x, y, z, r) {
    const H = this.hull;
    if (!H) return z;
    const u = x / H.L + 0.5;
    if (u < 0 || u > 1 || y > H.Y1(u) - 0.012) return z;
    return Math.sign(z) * Math.min(Math.abs(z), Math.max(0, H.zIn(u, y + 0.01) - r - 0.004));
  }

  // Schwingung (Morph m3): dreht Geometrie g um den Punkt P mit Drehvektor w (Achse mal Winkel für Einfluss 1)
  swing(g, P, w) {
    const p = g.attributes.position, a = g.attributes.m3;
    for (let i = 0; i < p.count; i++) {
      const rx = p.getX(i) - P[0], ry = p.getY(i) - P[1], rz = p.getZ(i) - P[2];
      a.setXYZ(i, w[1] * rz - w[2] * ry, w[2] * rx - w[0] * rz, w[0] * ry - w[1] * rx);
    }
    return g;
  }

  // Beine, Körper, Kopf, Mütze: winzige Seeleute
  crew(x, y, z, coat, hat = null, ry = 0, h = 1) {
    z = this.fitZ(x, y, z, 0.016 * h);
    this.cyl(0.011 * h, 0.015 * h, 0.032 * h, x, y + 0.016 * h, z, coat, 5, null, true);
    this.sph(0.0105 * h, x, y + 0.038 * h, z, K.skin, 1, 1, 1, 5, 3);
    if (hat) this.cone(0.0125 * h, 0.014 * h, x, y + 0.05 * h, z, hat, 5);
  }

  // Fass mit Reifen
  barrel(x, y, z, r, h, c = K.woodL) {
    z = this.fitZ(x, y, z, r);
    const us = lin(0, 1, 6), vs = [0, 0.14, 0.5, 0.86, 1], R = [0.8, 0.95, 1, 0.95, 0.8];
    const P = (u, v, i, j) => [x + Math.cos(u * Math.PI * 2) * r * R[j], y + v * h, z + Math.sin(u * Math.PI * 2) * r * R[j]];
    this.surf(us, vs, P, (i, j) => (j === 0 || j === 3 ? K.iron : c));
    this.disc(r * 0.8, x, y + h, z, shade(c, 1.08), '+y', 6);
  }

  crate(x, y, z, s, c = K.woodL, ry = 0, sy = s) {
    z = this.fitZ(x, y, z, s * 0.72);
    const g = new THREE.BoxGeometry(s, sy, s);
    if (ry) g.rotateY(ry);
    this.put(g.translate(x, y + sy / 2, z), c);
    const b = new THREE.BoxGeometry(s * 1.04, sy * 0.16, s * 1.04);
    if (ry) b.rotateY(ry);
    this.put(b.translate(x, y + sy * 0.5, z), K.woodD);
  }

  sack(x, y, z, r, c = K.cream) {
    z = this.fitZ(x, y, z, r);
    this.sph(r, x, y + r * 0.8, z, c, 1, 0.85, 0.8, 6, 4);
    this.cone(r * 0.35, r * 0.5, x, y + r * 1.65, z, shade(c, 0.9), 5);
  }

  lantern(x, y, z, s = 1) {
    this.cyl(0.012 * s, 0.014 * s, 0.03 * s, x, y + 0.015 * s, z, '#ffe3a1', 6);
    this.cone(0.018 * s, 0.016 * s, x, y + 0.038 * s, z, K.ironL, 6);
    this.cyl(0.015 * s, 0.015 * s, 0.006 * s, x, y + 0.002 * s, z, K.iron, 6);
  }

  done(morph = true) {
    const g = mergeGeometries(this.parts);
    if (morph) {
      g.morphAttributes.position = MK.map(m => g.attributes[m]);
      g.morphTargetsRelative = true;
    }
    for (const m of MK) g.deleteAttribute(m);
    g.computeBoundingSphere();
    g.userData.tris = g.attributes.position.count / 3;
    return g;
  }
}

// ---------- Rumpf ----------
// Planken Reihen: n Planken von v = vLow bis 1, Klinker Versatz lap, Farben je Reihe, Sonderfarben over[k]
function planks(n, vLow, cols, lap, over = {}, g = 0.012) {
  const rows = [{ v0: 0, v1: vLow, c: K.under, o0: 0, o1: 0, step: K.woodX }];
  for (let k = 0; k < n; k++) {
    const a = vLow + (1 - vLow) * k / n, b = vLow + (1 - vLow) * (k + 1) / n;
    rows.push({ v0: a + g, v1: k === n - 1 ? 1 : b - g, c: over[k] || cols[k % cols.length], o0: lap, o1: 0, step: K.woodX });
  }
  return rows;
}

// Rumpf als Loft: u von 0 (Heck) bis 1 (Bug), v von Kiel (0) bis Reling (1).
// L Länge, Wm halbe Breite, D Tiefgang, Hm Freibord mittschiffs, sB / sS Sprung vorn / hinten.
function makeHull(B, o) {
  const { L, Wm, D, Hm } = o;
  const bs = o.bs ?? 0.4, bp = o.bp ?? 1.5, tb = o.tb ?? 0.05, se = o.se ?? 0.2, sp = o.sp ?? 2, ts = o.ts ?? 0.5;
  const sB = o.sB ?? 0.08, sS = o.sS ?? 0.05, sBp = o.sBp ?? 2.2, sSp = o.sSp ?? 2.2;
  const q = o.q ?? 0.65, th = o.th ?? 0, thick = o.thick ?? 0.012, kb = o.kb ?? 0.75, ks = o.ks ?? 0.5;
  const X = u => (u - 0.5) * L;
  const rkB = o.rkB ?? 0, rkS = o.rkS ?? 0;
  const Wf = u => {
    let w = 1;
    if (u > bs) w = Math.min(w, 1 - (1 - tb) * Math.pow((u - bs) / (1 - bs), bp));
    if (u < se) w = Math.min(w, 1 - (1 - ts) * Math.pow((se - u) / se, sp));
    return Wm * w;
  };
  const Y0 = u => -D + D * (kb * Math.pow(Math.max(0, (u - 0.55) / 0.45), 2) + ks * Math.pow(Math.max(0, (0.3 - u) / 0.3), 2));
  const Y1 = u => Hm + sB * Math.pow(Math.max(0, (u - 0.5) / 0.5), sBp) + sS * Math.pow(Math.max(0, (0.5 - u) / 0.5), sSp);
  const f = v => Math.pow(Math.sin(v * Math.PI / 2), q) * (1 - th * v * v);
  const vOf = (u, y) => clamp((y - Y0(u)) / (Y1(u) - Y0(u)));
  const Xy = (u, y) => { const v = Math.pow(vOf(u, y), 1.4); return X(u) + rkB * v * Math.pow(Math.max(0, (u - 0.6) / 0.4), 2) - rkS * v * Math.pow(Math.max(0, (0.4 - u) / 0.4), 2); };
  const zOut = (u, y) => Wf(u) * f(vOf(u, y));
  const zIn = (u, y) => Math.max(0.0015, zOut(u, y) - thick);
  const segs = o.segs.map(s => ({ ...s, y: s.f != null ? (u => Y0(u) + s.f * (Y1(u) - Y0(u))) : (typeof s.y === 'function' ? s.y : (() => s.y)) }));
  const segAt = u => segs.find(s => u >= s.u0 - 1e-6 && u <= s.u1 + 1e-6) || segs[0];
  const deckAt = u => Math.min(segAt(u).y(u), Y1(u) - 0.012);
  const H = { L, Wm, D, Hm, thick, X, Xy, Wf, Y0, Y1, f, zOut, zIn, deckAt, segs, segAt, segY: i => segs[i].y((segs[i].u0 + segs[i].u1) / 2) };
  // Punkt auf der Außenhaut (Seite s = 1 oder -1), v als Höhenanteil
  H.skin = (u, v, s = 1) => { const y = Y0(u) + (Y1(u) - Y0(u)) * v; return [Xy(u, y), y, s * (zOut(u, y) + 0.004)]; };

  H.slope = (u, y) => (zOut(u, y + 0.02) - zOut(u, y - 0.02)) / 0.04;
  B.hull = H;
  // Reihen Einträge
  const rows = o.rows, E = [], CT = [];
  rows.forEach((r, k) => {
    E.push({ v: r.v0, o: r.o0 }); E.push({ v: r.v1, o: r.o1 });
    CT.push({ c: r.c, k }); CT.push({ c: r.step || K.woodX, k, step: true });
  });
  CT.pop();
  const nu = o.nu ?? 18;
  const us = lin(0, 1, nu).map(t => 0.5 - 0.5 * Math.cos(Math.PI * t));
  const taper = u => Math.min(1, Wf(u) / Wm * 3);
  const outer = s => B.surf(us, E, (u, e) => {
    const v = e.v, y = Y0(u) + (Y1(u) - Y0(u)) * v;
    return [Xy(u, y), y, s * (Wf(u) * f(v) + e.o * taper(u))];
  }, (i, j) => {
    const ct = CT[j];
    if (!ct) return null;
    if (E[j].v === E[j + 1].v && E[j].o === E[j + 1].o) return null;
    if (ct.step) return ct.c;
    return shade(ct.c, 1 + (hsh(Math.floor(i / 3) + ct.k * 7, ct.k) - 0.5) * 0.1);
  }, null, s < 0);
  outer(1); outer(-1);

  // Reling Oberkante
  const rim = o.rim ?? K.rail;
  for (const s of [1, -1]) B.surf(us, [0, 1], (u, v) => {
    const zo = Wf(u) * f(1), zi = Math.max(0, zo - thick * 1.1);
    return [Xy(u, Y1(u)), Y1(u), s * lerp(zi, zo, v)];
  }, () => rim, null, s > 0);

  // Innenseiten und Deck je Abschnitt
  segs.forEach((sg, si) => {
    const n = Math.max(3, Math.round(nu * (sg.u1 - sg.u0)));
    const su = lin(sg.u0, sg.u1, n);
    for (const s of [1, -1]) B.surf(su, [0, 0.5, 1], (u, w) => {
      const y = lerp(Y1(u), deckAt(u), w);
      return [Xy(u, y), y, s * zIn(u, y)];
    }, (i, j) => shade(o.inner ?? K.woodL, 1 + (hsh(i, si + j) - 0.5) * 0.08), null, s < 0);
    if (!o.noDeck) {
      const nz = o.deckStrips ?? 6;
      B.surf(su, lin(-1, 1, nz), (u, s) => [Xy(u, deckAt(u)), deckAt(u) + 0.004 * (1 - s * s), s * zIn(u, deckAt(u))],
        (i, j) => shade(j % 2 ? (o.deck2 ?? K.deckD) : (o.deck1 ?? K.deck), 1 + (hsh(Math.floor(i / 2) + j * 5, si) - 0.5) * 0.08), null, true);
    }
    if (si < segs.length - 1) {
      const nx = segs[si + 1], ya = sg.y(sg.u1), yb = nx.y(nx.u0), u = sg.u1;
      if (Math.abs(ya - yb) > 0.004) B.box(thick, Math.abs(ya - yb), 2 * zIn(u, Math.min(ya, yb)) + 0.004, X(u), (ya + yb) / 2, 0, o.wall ?? K.woodL);
    }
  });

  // Heckspiegel
  if (ts > 0.12 && !o.noCap) {
    const ce = E.map(e => e), cs = lin(-1, 1, 4);
    B.surf(cs, E, (s, e) => {
      const v = e.v, y = Y0(0) + (Y1(0) - Y0(0)) * v;
      return [Xy(0, y), y, s * Wf(0) * f(v)];
    }, (i, j) => {
      const ct = CT[j];
      if (!ct || (E[j].v === E[j + 1].v)) return null;
      return ct.step ? ct.c : shade(ct.c, 1.04);
    }, null, true);
  }
  return H;
}

// Mast mit Rah
function mast(B, x, y0, y1, r, c = K.woodD) {
  B.cyl(r * 0.62, r, y1 - y0, x, (y0 + y1) / 2, 0, c, 6);
}
function yard(B, x, y, len, r, c = K.woodD) {
  B.cyl(r * 0.7, r * 0.7, len, x, y, 0, c, 5, [Math.PI / 2, 0, 0]);
  B.cyl(r, r, len * 0.3, x, y, 0, c, 5, [Math.PI / 2, 0, 0]);
}

// ---------- Epoche 0 bis 1: Einbaum mit Ausleger ----------
function canoe(kind) {
  const B = new Bld(), S = SAIL[kind], A = ACC[kind];
  const war = kind === 'krieg', paint = war ? '#b8452f' : A;
  const H = makeHull(B, {
    L: 1.1, Wm: 0.074, D: 0.052, Hm: 0.055, sB: 0.1, sS: 0.075, bs: 0.25, bp: 1.3, tb: 0.1, se: 0.3, sp: 1.4, ts: 0.18, q: 0.55, thick: 0.015, nu: 16, rkB: 0.05,
    segs: [{ u0: 0, u1: 1, f: 0.42 }], deck1: '#7a5639', deck2: '#6d4c33', inner: '#8a6240', rim: '#d2b184', noCap: true,
    rows: [
      { v0: 0, v1: 0.34, c: '#7a573e', o0: 0, o1: 0, step: K.woodX },
      { v0: 0.34, v1: 0.8, c: '#ae8458', o0: 0.004, o1: 0, step: K.woodX },
      { v0: 0.8, v1: 1, c: paint, o0: 0.003, o1: 0, step: K.woodX },
    ],
  });
  // Querbänke
  const bx = [-0.34, -0.12, 0.1, 0.32];
  for (const x of bx) {
    const u = x / H.L + 0.5, y = H.deckAt(u) + 0.035;
    B.box(0.03, 0.012, 2 * H.zIn(u, y) + 0.014, x, y, 0, '#b88e5e');
  }
  // Steven mit geschnitztem Kopf, Heck mit Schwung
  const y1 = H.Y1(1), x1 = H.Xy(1, y1), y0 = H.Y1(0), x0 = H.Xy(0, y0);
  B.tube([[x1 - 0.005, y1 - 0.02, 0], [x1 + 0.025, y1 + 0.04, 0], [x1 + 0.06, y1 + 0.085, 0]], 0.015, 0.009, '#8a6240', 5, 6);
  B.sph(0.02, x1 + 0.068, y1 + 0.095, 0, paint, 1.2, 1, 0.9, 6, 4);
  B.cone(0.01, 0.03, x1 + 0.1, y1 + 0.09, 0, K.cream, 4, [0, 0, -Math.PI / 2]);
  B.tube([[x0 + 0.005, y0 - 0.02, 0], [x0 - 0.03, y0 + 0.03, 0], [x0 - 0.05, y0 + 0.07, 0]], 0.013, 0.008, '#8a6240', 5, 5);
  B.sph(0.014, x0 - 0.052, y0 + 0.075, 0, K.cream, 1, 1, 1, 5, 4);
  // Ausleger: Schwimmer, Querstreben mit Bindung
  const fz = 0.28;
  B.sph(1, 0.02, -0.03, fz, '#b48d62', 0.42, 0.028, 0.034, 8, 5);
  B.tube([[-0.28, -0.025, fz], [-0.41, -0.005, fz], [-0.44, 0.012, fz]], 0.012, 0.01, '#b48d62', 5, 4);
  B.tube([[0.32, -0.025, fz], [0.43, -0.007, fz], [0.45, 0.006, fz]], 0.012, 0.01, '#b48d62', 5, 4);
  for (const x of [-0.2, 0.2]) {
    B.rod([x, 0.056, 0.05], [x, 0.045, fz], 0.009, '#8a6240', 4);
    B.rod([x - 0.035, 0.045, fz], [x + 0.035, 0.045, fz], 0.006, K.ropeD);
    B.rod([x, 0.05, 0.1], [x - 0.025, -0.015, fz], 0.0045, K.ropeD);
    B.rod([x, 0.05, 0.1], [x + 0.025, -0.015, fz], 0.0045, K.ropeD);
    B.cyl(0.011, 0.011, 0.014, x, 0.0555, 0.075, K.rope, 5);
  }
  // Mast und geflochtenes Segel (Krabbenscherensegel)
  const mx = 0.04;
  B.rod([mx, 0.0, 0], [mx + 0.03, 0.16, 0], 0.011, '#7d5a3e', 5);
  const ap = [mx + 0.03, 0.15, 0], hd = [0.44, 0.64, 0], cl = [-0.26, 0.58, 0];
  B.rod(ap, hd, 0.01, '#7d5a3e', 4); B.rod(ap, cl, 0.01, '#7d5a3e', 4);
  B.sph(0.014, hd[0], hd[1], 0, '#7d5a3e'); B.sph(0.014, cl[0], cl[1], 0, '#7d5a3e');
  B.tri({ a: ap, b: hd, cl, bulge: 0.07, c: S, c2: shade(S, 0.86), rows: 9, cols: 5, dir: [0, 0, 1] });
  B.rod([hd[0], hd[1], 0], [hd[0], hd[1] + 0.03, 0], 0.004, '#7d5a3e');
  B.flag(hd[0], hd[1] + 0.025, 0, 0.14, 0.05, FLAG[kind]);
  B.rod(hd, [0.3, 0.06, 0], 0.003, K.ropeD);
  B.rod(cl, [-0.3, 0.056, 0.02], 0.003, K.ropeD);
  // Paddler
  const seats = kind === 'siedler' ? [-0.34, 0.1] : kind === 'handel' ? [-0.34, 0.32] : [-0.34, -0.12, 0.32];
  seats.forEach((x, i) => {
    const sd = i % 2 ? 1 : -1;
    B.crew(x, 0.022, 0, COAT[(i * 2 + 1) % COAT.length], i % 2 ? '#e0c27a' : null, 0, 1.8);
    const pv = [x, 0.05, sd * 0.07], pw = [0, 0, 0.5];
    B.swing(B.rod([x, 0.085, sd * 0.012], [x + 0.03, -0.045, sd * 0.125], 0.004, '#c79a68', 3), pv, pw);
    B.swing(B.box(0.03, 0.055, 0.004, x + 0.035, -0.06, sd * 0.13, '#d2a870', 0, 0, sd * 0.35), pv, pw);
  });
  // Ladung nach Art der Fahrt
  if (kind === 'handel') {
    for (const [x, z] of [[-0.1, 0.02], [0.05, -0.025], [0.2, 0.02]]) {
      B.sph(0.028, x, 0.055, z, '#c9835a', 1, 0.9, 1, 7, 5);
      B.cyl(0.013, 0.017, 0.016, x, 0.087, z, '#b06c45', 6);
    }
    B.cyl(0.032, 0.036, 0.034, 0.2, 0.025, -0.02, '#d0ac72', 7);
    B.cyl(0.032, 0.032, 0.006, 0.2, 0.044, -0.02, '#b88e5e', 7);
  } else if (kind === 'siedler') {
    B.sack(-0.1, 0.0, 0.02, 0.034, K.cream);
    B.sack(0.2, 0.0, -0.015, 0.03, '#e6cf9a');
    B.cyl(0.015, 0.019, 0.026, 0.26, 0.02, 0.01, '#b06c45', 6);
    B.rod([0.26, 0.04, 0.01], [0.26, 0.13, 0.01], 0.003, '#7d5a3e', 3);
    B.sph(0.028, 0.26, 0.145, 0.01, '#8fbf7a', 1, 0.9, 1, 6, 4);
  } else if (kind === 'krieg') {
    for (const dz of [-0.03, 0, 0.03]) B.rod([0.17 + dz, 0.0, dz * 0.6], [0.3 + dz * 0.6, 0.2, dz], 0.0035, '#8a6240', 3);
    B.cone(0.008, 0.02, 0.3 + 0.018 * 0.6 * 0, 0.205, 0.03, K.ironL, 4);
    B.disc(0.036, 0.37, 0.09, 0.02, '#b8452f', '+z', 8); B.disc(0.036, 0.37, 0.09, -0.02, '#b8452f', '-z', 8);
    B.disc(0.015, 0.37, 0.09, 0.022, K.cream, '+z', 6); B.disc(0.015, 0.37, 0.09, -0.022, K.cream, '-z', 6);
  } else {
    B.rod([0.42, 0.06, 0], [0.45, 0.22, 0], 0.004, '#7d5a3e');
    B.flag(0.45, 0.22, 0, 0.1, 0.04, FLAG[kind]);
    B.cyl(0.022, 0.022, 0.024, -0.1, 0.02, 0.012, K.rope, 7);
    B.crew(0.5, 0.02, 0, COAT[3], '#2f3f58', 0, 1.6);
  }
  const g = B.done();
  g.userData.len = H.L + 0.15; g.userData.beam = fz * 2 + 0.1; g.userData.smoke = [];
  return g;
}


// ---------- Fischerboot vor Fischerhütte und Hafen (seit 19.10.2026, Paket 5) ----------
// Klinkerrumpf mit Planken, Ruderbänke, Riemen, Mast mit Sprietsegel (Nähte als Bahnen), Netzhaufen mit Korken,
// Bojen, Laterne am Bug, Fischkorb, Steuerruder und ein bis zwei Fischer. v wählt Farben (Bordgang, Segel, Netz).
const FB_STRAKE = ['#5fa8a0', '#c8553d', '#6f93bd', '#e0a640', '#f1e6d0'];
const FB_SAIL = ['#f1e6d0', '#c8704a', '#e2c48a', '#f4efe2'];
export function fishingBoat(v = 0) {
  const B = new Bld(), st = FB_STRAKE[v % FB_STRAKE.length], sc = FB_SAIL[(v * 3 + 1) % FB_SAIL.length];
  const H = makeHull(B, {
    L: 0.95, Wm: 0.13, D: 0.06, Hm: 0.085, sB: 0.07, sS: 0.05, bs: 0.32, bp: 1.4, tb: 0.06, se: 0.22, sp: 1.6, ts: 0.42, q: 0.6, thick: 0.012, nu: 18, rkB: 0.04,
    segs: [{ u0: 0, u1: 1, f: 0.3 }], deck1: '#a88259', deck2: '#987452', inner: '#b88e5e', rim: '#d6b98f',
    rows: planks(4, 0.3, [K.wood, K.woodL, K.wood, K.woodL], 0.005, { 3: st }),
  });
  const deckY = u => H.deckAt(u);
  // Ruderbänke
  for (const x of [-0.2, 0.0, 0.2]) { const u = x / H.L + 0.5, y = deckY(u) + 0.04; B.box(0.03, 0.01, 2 * H.zIn(u, y) + 0.01, x, y, 0, '#c49a6a'); }
  // Steven, Steuerruder mit Pinne
  const y1 = H.Y1(1), x1 = H.Xy(1, y1), y0 = H.Y1(0), x0 = H.Xy(0, y0);
  B.tube([[x1 - 0.005, y1 - 0.03, 0], [x1 + 0.012, y1 + 0.01, 0], [x1 + 0.02, y1 + 0.035, 0]], 0.009, 0.007, K.woodD, 5, 4);
  B.box(0.012, 0.11, 0.05, x0 - 0.02, y0 - 0.05, 0, K.woodD, 0, 0, 0.12);
  B.rod([x0 - 0.015, y0 + 0.01, 0], [x0 + 0.1, y0 + 0.02, 0], 0.004, K.woodD, 3);
  // Mast, Spriet und Segel (Nähte: die Bahnen wechseln leicht die Farbe)
  const mx = 0.14, top = 0.52;
  mast(B, mx, deckY(mx / H.L + 0.5), top, 0.011);
  B.sph(0.009, mx, top + 0.005, 0, K.woodD);
  const a = [mx + 0.005, 0.13, 0], b = [mx + 0.01, top - 0.02, 0], cl = [-0.25, 0.15, 0];
  B.rod([mx, 0.125, 0], [-0.27, 0.145, 0], 0.005, K.woodD, 3);
  B.tri({ a, b, cl, bulge: 0.045, c: sc, c2: shade(sc, 0.9), rows: 8, cols: 5, dir: [0, 0, 1], weave: 0.9 });
  B.rod(cl, [x0 + 0.02, H.Y1(0.05) + 0.01, 0.03], 0.0025, K.ropeD);
  B.rod(b, [x1 + 0.015, y1 + 0.03, 0], 0.0022, K.ropeD);
  B.flag(mx, top + 0.01, 0, 0.08, 0.03, st);
  // Riemen ruhen quer über dem Bordrand
  for (const sd of [1, -1]) B.rod([0.05, H.Y1(0.55) + 0.006, sd * 0.02], [-0.32, H.Y1(0.2) + 0.012, sd * 0.2], 0.0042, '#c79a68', 3);
  for (const sd of [1, -1]) B.box(0.06, 0.004, 0.022, -0.34, H.Y1(0.2) + 0.012, sd * 0.215, '#d2a870');
  // Netzhaufen achtern mit gelben Korken, ein Stück hängt über die Bordwand
  const nx = -0.28, nu = nx / H.L + 0.5, ny = deckY(nu);
  for (let i = 0; i < 6; i++) B.sph(0.035, nx + Math.cos(i * 1.7) * 0.03, ny + 0.015 + (i % 2) * 0.012, Math.sin(i * 2.3) * 0.035, i % 2 ? '#5d6b5a' : '#6f7a64', 1.1, 0.45, 1, 6, 4);
  for (let i = 0; i < 7; i++) B.sph(0.008, nx + Math.cos(i * 0.9) * 0.05, ny + 0.035, Math.sin(i * 0.9) * 0.045, '#e8b844', 1, 1, 1, 4, 3);
  B.tube([[nx + 0.04, H.Y1(nu) + 0.004, H.zOut(nu, H.Y1(nu)) - 0.004], [nx + 0.06, H.Y1(nu) - 0.03, H.zOut(nu, H.Y1(nu)) + 0.012], [nx + 0.1, H.Y1(nu) - 0.06, H.zOut(nu, H.Y1(nu)) + 0.006]], 0.012, 0.006, '#5d6b5a', 4, 5);
  // Bojen rot und weiß am Heck, Fischkorb, Laterne am Bug
  for (const [dx, dz] of [[-0.06, 0.12], [-0.02, -0.13]]) { B.sph(0.016, x0 + dx, H.Y1(0.08) + 0.012, dz, '#d8503a', 1, 1, 1, 6, 4); B.cyl(0.0165, 0.0165, 0.006, x0 + dx, H.Y1(0.08) + 0.012, dz, K.cream, 6); }
  const fu = 0.1 / H.L + 0.5;
  B.cyl(0.03, 0.024, 0.035, 0.1, deckY(fu) + 0.0175, 0.04, '#c9a46a', 7, null, true);
  for (let i = 0; i < 4; i++) B.sph(0.01, 0.1 + Math.cos(i * 1.6) * 0.012, deckY(fu) + 0.036, 0.04 + Math.sin(i * 1.6) * 0.012, '#c8d4dc', 1.6, 0.6, 0.8, 5, 3);
  B.rod([x1 - 0.03, H.Y1(0.95), 0], [x1 - 0.03, H.Y1(0.95) + 0.09, 0], 0.003, K.woodD, 3);
  B.lantern(x1 - 0.03, H.Y1(0.95) + 0.09, 0, 0.9);
  // Fischer: einer an der Pinne, manchmal einer am Netz
  B.crew(x0 + 0.1, deckY(0.12), 0, COAT[(v + 1) % COAT.length], '#e0c27a', 0, 1.6);
  if (v % 2 === 0) B.crew(nx + 0.08, deckY(nu + 0.05), -0.04, COAT[(v + 3) % COAT.length], '#2f3f58', 0, 1.5);
  const g = B.done();
  g.userData.len = H.L + 0.1;
  return g;
}

// Hütte mit Satteldach, Fenstern und Tür (Kajüte, Aufbauten)
function cabin(B, x, y, w, d, h, wall, roof, o = {}) {
  B.box(w, h, d, x, y + h / 2, 0, wall);
  const a = 0.6, rw = d / 2 / Math.cos(a) + 0.016;
  for (const s of [1, -1]) B.box(w + 0.03, 0.012, rw, x, y + h + Math.tan(a) * d / 4 - 0.004, s * d / 4, roof, s * a, 0, 0);
  B.box(w + 0.03, 0.008, 0.012, x, y + h + Math.tan(a) * d / 2 + 0.002, 0, K.woodD);
  if (o.windows !== false) {
    const n = o.n ?? 2, ww = o.ww ?? 0.03;
    for (let i = 0; i < n; i++) {
      const px = x + (i - (n - 1) / 2) * (w * 0.6 / Math.max(1, n - 1 || 1));
      for (const s of ['+z', '-z']) {
        B.quad(ww + 0.008, ww * 0.9 + 0.008, px, y + h * 0.58, (s === '+z' ? 1 : -1) * (d / 2 + 0.0015), K.cream, s);
        B.quad(ww, ww * 0.9, px, y + h * 0.58, (s === '+z' ? 1 : -1) * (d / 2 + 0.003), K.glassD, s);
      }
    }
    for (const s of ['+x', '-x']) {
      const sx = s === '+x' ? 1 : -1;
      B.quad(ww + 0.008, ww * 0.9 + 0.008, x + sx * (w / 2 + 0.0015), y + h * 0.58, 0, K.cream, s);
      B.quad(ww, ww * 0.9, x + sx * (w / 2 + 0.003), y + h * 0.58, 0, K.glassD, s);
    }
  }
}

// Wanten von der Mastspitze zur Reling plus Webeleinen
function shrouds(B, H, mx, my, deckY, spread = 0.07, rungs = 3, c = K.ropeD) {
  for (const s of [1, -1]) for (const dx of [-spread, spread]) {
    const u = (mx + dx) / H.L + 0.5, rail = [mx + dx, H.Y1(u) - 0.01, s * (H.zOut(u, H.Y1(u)) - 0.004)];
    B.rod([mx, my, s * 0.008], rail, 0.0028, c);
  }
  for (const s of [1, -1]) for (let i = 1; i <= rungs; i++) {
    const t = i / (rungs + 1), u0 = (mx - spread) / H.L + 0.5, u1 = (mx + spread) / H.L + 0.5;
    const y0 = H.Y1(u0) - 0.01, y1 = H.Y1(u1) - 0.01, z0 = s * (H.zOut(u0, H.Y1(u0)) - 0.004), z1 = s * (H.zOut(u1, H.Y1(u1)) - 0.004);
    const yy = lerp(y0, my, t), yy1 = lerp(y1, my, t);
    B.rod([mx - spread * (1 - t), yy, lerp(z0, s * 0.008, t)], [mx + spread * (1 - t), yy1, lerp(z1, s * 0.008, t)], 0.0022, K.rope);
  }
}

// ---------- Epoche 2 bis 3: Kogge (Handel, Siedler, Entdecker) ----------
function cog(kind) {
  const B = new Bld(), S = SAIL[kind], A = ACC[kind], F = FLAG[kind];
  const roof = { handel: '#b4553f', siedler: '#d9b46c', entdeckung: '#7d9bb4' }[kind] || '#b4553f';
  const L = 1.5, dk = 0.085, cd = 0.165, fd = 0.14;
  const H = makeHull(B, {
    L, Wm: 0.18, D: 0.125, Hm: 0.175, sB: 0.1, sS: 0.1, bs: 0.34, bp: 1.4, tb: 0.06, se: 0.16, sp: 1.8, ts: 0.6, q: 0.6, th: 0.08, thick: 0.014, nu: 20, rkB: 0.08, rkS: 0.03, deckStrips: 5,
    segs: [{ u0: 0, u1: 0.19, y: cd }, { u0: 0.19, u1: 0.9, y: dk }, { u0: 0.9, u1: 1, y: fd }],
    rows: planks(4, 0.3, [K.wood, K.woodL, K.wood, K.woodL], 0.005, { 3: A }),
  });
  const top = 1.02, Xy = H.Xy;
  // Steven und Bugspriet
  const y1b = H.Y1(1), bx = y => Xy(1, y);
  B.tube([[bx(H.Y0(1)), H.Y0(1), 0], [bx(0.1), 0.1, 0], [bx(y1b), y1b + 0.02, 0]], 0.013, 0.01, K.woodD, 5, 6);
  B.rod([bx(0.2) - 0.06, fd + 0.04, 0], [bx(0.3) + 0.14, fd + 0.22, 0], 0.011, K.woodD, 4, 0.007);
  B.sph(0.013, bx(0.3) + 0.145, fd + 0.225, 0, K.woodD);
  B.tube([[Xy(0, H.Y1(0)) + 0.01, 0.06, 0], [Xy(0, H.Y1(0)) - 0.03, 0.22, 0], [Xy(0, H.Y1(0)) - 0.02, H.Y1(0) + 0.07, 0]], 0.012, 0.009, K.woodD, 5, 5);
  // Kajüte auf dem Heckkastell
  cabin(B, H.X(0) + 0.2, cd, 0.2, 0.22, 0.085, K.woodL, roof, { n: 2 });
  B.lantern(Xy(0, H.Y1(0)) - 0.02, H.Y1(0) + 0.07, 0, 0.9);
  // Mast, Rah, Segel
  mast(B, 0.02, dk, top + 0.04, 0.02);
  B.sph(0.016, 0.02, top + 0.045, 0, K.woodD);
  yard(B, 0.03, 0.97, 0.76, 0.012);
  B.sail({ x: 0.045, y: 0.43, bw: 0.7, tw: 0.62, h: 0.54, c: S, bulge: 0.085, rows: 6, cols: 8 });
  for (const z of [-0.3, 0.3]) B.rod([0.03, top, z * 0.02], [0.03, 0.97, z], 0.0025, K.rope);
  // Wanten, Stage, Pardunen
  shrouds(B, H, 0.02, 0.9, dk);
  B.rod([0.02, top + 0.03, 0], [bx(0.2) + 0.1, fd + 0.15, 0], 0.003, K.ropeD);
  B.rod([0.02, top + 0.03, 0], [Xy(0, H.Y1(0)) - 0.02, H.Y1(0) + 0.07, 0], 0.003, K.ropeD);
  for (const s of [1, -1]) {
    B.rod([0.04, 0.97, s * 0.37], [-0.5, 0.2, s * 0.18], 0.0022, K.rope);
    B.rod([0.05, 0.45, s * 0.33], [0.2, 0.1, s * 0.16], 0.0022, K.rope);
  }
  // Flagge
  B.rod([0.02, top + 0.04, 0], [0.02, top + 0.11, 0], 0.003, K.woodD);
  B.flag(0.02, top + 0.095, 0, 0.2, 0.075, F);
  // Reling Pfosten mit Handlauf in der Mitte des Schiffs, Seitenruder, Luke
  for (const s of [1, -1]) {
    let prev = null;
    for (let i = 0; i <= 7; i++) {
      const u = 0.24 + i * 0.085, y = H.Y1(u), x = Xy(u, y), z = s * (H.zOut(u, y) - 0.004);
      B.rod([x, y, z], [x, y + 0.04, z], 0.0045, K.woodD);
      if (prev) B.rod(prev, [x, y + 0.04, z], 0.0035, K.woodL);
      prev = [x, y + 0.04, z];
    }
  }
  B.rod([H.X(0) + 0.02, 0.27, 0.19], [H.X(0) - 0.08, -0.1, 0.23], 0.011, K.woodD, 4);
  B.box(0.02, 0.16, 0.06, H.X(0) - 0.07, -0.04, 0.228, K.woodL, 0, 0, 0.18);
  B.box(0.085, 0.02, 0.085, 0.1, dk + 0.01, 0, K.woodD); B.box(0.085, 0.004, 0.012, 0.1, dk + 0.022, 0, K.woodX);
  // Besatzung und Ladung
  B.crew(H.X(0) + 0.1, cd, 0.1, COAT[1], null, 0, 1.4);
  B.crew(H.X(0) + 0.1, cd, -0.1, COAT[3], '#e0c27a', 0, 1.4);
  B.crew(H.X(0.88), fd, 0, COAT[0], '#7b5a3a', 0, 1.4);
  const zi = (x, y, sz) => H.zIn(x / L + 0.5, y) - sz / 2 - 0.006;
  const zc = (x, z, sz) => Math.sign(z) * Math.min(Math.abs(z), zi(x, dk, sz));
  if (kind === 'handel') {
    for (const [x, z] of [[-0.2, 0.08], [-0.2, -0.07], [-0.33, 0.0], [-0.34, 0.1], [-0.34, -0.1]]) B.barrel(x, dk, z, 0.038, 0.07);
    for (const [x, z, y, r] of [[0.27, 0.075, 0, 0.3], [0.27, -0.07, 0, -0.2], [0.27, 0.07, 0.075, 0.1], [0.42, 0, 0, 0.5]]) B.crate(x, dk + y, zc(x, z, 0.1), 0.1, K.woodL, r, 0.075);
    for (const [x, z] of [[0.15, 0.1], [0.13, -0.09]]) B.sack(x, dk, z, 0.034, '#e8dcc0');
  } else if (kind === 'siedler') {
    for (const [x, z] of [[-0.22, 0.07], [-0.22, -0.07], [-0.34, 0.0], [0.25, 0.08], [0.31, -0.07]]) B.sack(x, dk, zc(x, z, 0.08), 0.04, '#e9dcb9');
    B.crate(0.28, dk, zc(0.28, 0.05, 0.09), 0.09, K.woodL, 0.2, 0.07);
    for (const z of [-0.07, 0.09]) {
      B.cyl(0.02, 0.026, 0.03, 0.46, dk + 0.015, zc(0.46, z, 0.06), '#b0693f', 6);
      B.rod([0.46, dk + 0.03, zc(0.46, z, 0.06)], [0.46, dk + 0.1, zc(0.46, z, 0.06)], 0.004, K.woodD, 3);
      B.sph(0.038, 0.46, dk + 0.12, zc(0.46, z, 0.06), '#8fbf7a', 1, 0.9, 1, 6, 4);
    }
    B.crew(0.14, dk, 0.1, COAT[2], '#d7b26a', 0, 1.3);
    B.crew(0.15, dk, -0.1, COAT[5], null, 0, 1.0);
  } else {
    B.crew(H.X(0.86), fd, 0.0, COAT[3], '#2f3f58', 0, 1.4);
    B.rod([H.X(0.86) + 0.01, fd + 0.055, 0.01], [H.X(0.86) + 0.12, fd + 0.085, 0.03], 0.005, '#b08a4c', 4);
    B.cyl(0.04, 0.04, 0.04, 0.02, 0.9, 0, K.woodD, 8, null, true);
    B.cyl(0.04, 0.04, 0.008, 0.02, 0.885, 0, K.woodL, 8);
    B.crew(0.02, 0.905, 0, COAT[4], '#2f3f58', 0, 0.9);
    B.crate(0.3, dk, 0.05, 0.09, '#b68d62', 0.1, 0.08);
    B.crate(-0.3, dk, -0.06, 0.08, K.woodL, 0.3, 0.07);
    B.sph(0.04, 0.2, dk + 0.015, -0.08, K.rope, 1, 0.4, 1, 7, 4);
  }
  const g = B.done();
  g.userData.len = H.L + 0.15; g.userData.beam = H.Wm * 2; g.userData.smoke = [];
  return g;
}

// ---------- Epoche 2 bis 3: Langschiff (Krieg) ----------
function longship(kind = 'krieg') {
  if (!SAIL[kind]) kind = 'krieg';
  const B = new Bld(), S = SAIL[kind], F = FLAG[kind]; // auch Piraten fahren Langschiffe, mit schwarzem Segel
  const H = makeHull(B, {
    L: 1.75, Wm: 0.125, D: 0.075, Hm: 0.095, sB: 0.07, sS: 0.07, bs: 0.3, bp: 1.2, tb: 0.04, se: 0.3, sp: 1.3, ts: 0.05, q: 0.6, th: 0.0, thick: 0.012, nu: 22,
    segs: [{ u0: 0, u1: 1, y: u => 0.035 + 0.02 * Math.pow(Math.abs(u - 0.5) * 2, 3) }], noCap: true, inner: K.woodL, rim: '#d9b78a',
    rows: planks(4, 0.28, ['#8d6641', '#a8805a', '#8d6641', '#a8805a'], 0.006, { 3: '#7a4a33' }),
  });
  const dk = 0.04;
  // Drachenhals und Kopf
  B.tube([[0.86, 0.0, 0], [0.9, 0.12, 0], [0.88, 0.26, 0], [0.93, 0.37, 0], [0.99, 0.42, 0]], 0.014, 0.01, '#7d5a3a', 6, 12);
  B.sph(0.03, 1.02, 0.43, 0, '#8a6038', 1.4, 0.95, 0.85, 7, 5);
  B.cone(0.018, 0.045, 1.06, 0.42, 0, '#8a6038', 5, [0, 0, -Math.PI / 2]);
  B.sph(0.007, 1.015, 0.445, 0.022, K.cream, 1, 1, 1, 4, 3); B.sph(0.007, 1.015, 0.445, -0.022, K.cream, 1, 1, 1, 4, 3);
  B.cone(0.009, 0.03, 0.99, 0.47, 0.016, '#7d5a3a', 4); B.cone(0.009, 0.03, 0.99, 0.47, -0.016, '#7d5a3a', 4);
  B.tube([[-0.86, 0.0, 0], [-0.9, 0.1, 0], [-0.87, 0.22, 0], [-0.8, 0.28, 0], [-0.77, 0.24, 0]], 0.012, 0.007, '#7d5a3a', 5, 10);
  // Schilde
  const sh = ['#c8553d', K.cream, '#5fa8a0', '#ecc45e'];
  for (let i = 0; i < 8; i++) {
    const u = 0.22 + i * 0.075, y = H.Y1(u) - 0.034;
    for (const s of [1, -1]) {
      const z = s * (H.zOut(u, y) + 0.012), face = s > 0 ? '+z' : '-z', tl = Math.atan(H.slope(u, y));
      B.disc(0.032, H.Xy(u, y), y, z, sh[(i + (s > 0 ? 0 : 1)) % 4], face, 8, tl);
      B.disc(0.012, H.Xy(u, y), y, z + s * 0.003, K.ironL, face, 6, tl);
    }
  }
  // Ruder, Riemen, Rudertruhen
  B.rod([-0.74, 0.2, 0.13], [-0.8, -0.06, 0.15], 0.01, K.woodD, 4);
  B.box(0.014, 0.12, 0.05, -0.8, -0.04, 0.15, K.woodL, 0, 0, 0.15);
  for (let i = 0; i < 7; i++) {
    const u = 0.24 + i * 0.085, x = H.X(u);
    for (const s of [1, -1]) {
      const pv = [x - 0.025, 0.1, s * 0.12], pw = [0, s * 0.3, 0];
      B.swing(B.rod([x, 0.15, s * 0.03], [x - 0.07, -0.025, s * 0.3], 0.0045, '#a07a52', 3), pv, pw);
      B.swing(B.box(0.075, 0.003, 0.03, x - 0.075, -0.03, s * 0.31, '#b48a5c', 0, 0, 0), pv, pw);
    }
    B.box(0.04, 0.012, 2 * H.zIn(u, dk + 0.02) + 0.004, x, dk + 0.02, 0, '#a07a52');
  }
  // Mast, Rah, gestreiftes Segel
  mast(B, 0.02, dk, 0.97, 0.018);
  B.sph(0.014, 0.02, 0.975, 0, K.woodD);
  yard(B, 0.03, 0.88, 0.7, 0.011);
  B.sail({ x: 0.045, y: 0.41, bw: 0.68, tw: 0.62, h: 0.47, c: S, c2: K.cream, bulge: 0.08, rows: 6, cols: 8 });
  B.rod([0.02, 0.97, 0], [0.9, 0.38, 0], 0.003, K.ropeD);
  B.rod([0.02, 0.97, 0], [-0.8, 0.26, 0], 0.003, K.ropeD);
  shrouds(B, H, 0.02, 0.8, dk, 0.06, 2);
  for (const s of [1, -1]) {
    B.rod([0.04, 0.88, s * 0.35], [-0.42, 0.1, s * 0.12], 0.002, K.rope);
    B.rod([0.05, 0.42, s * 0.3], [0.3, 0.08, s * 0.12], 0.002, K.rope);
  }
  B.rod([0.02, 0.97, 0], [0.02, 1.05, 0], 0.003, K.woodD);
  B.flag(0.02, 1.04, 0, 0.2, 0.07, F);
  // Krieger
  [[-0.35, 0.05, 0], [-0.2, -0.05, 0], [0.3, 0.06, 0], [0.45, -0.04, 0]].forEach(([x, z], i) => B.crew(x, dk, z, COAT[i % 2 ? 0 : 3], i % 2 ? '#8e939b' : '#8e939b', 0, 1.4));
  B.cone(0.014, 0.012, 0.3, dk + 0.075, 0.06, K.ironL, 5);
  const g = B.done();
  g.userData.len = H.L + 0.2; g.userData.smoke = [];
  return g;
}


// Geländer: Pfosten und Handlauf entlang der Reling
function railing(B, H, u0, u1, n, hgt = 0.04, c = K.cream, r = 0.0032) {
  for (const s of [1, -1]) {
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const u = lerp(u0, u1, i / n), y = H.Y1(u), z = s * (H.zOut(u, y) - 0.004), x = H.Xy(u, y);
      B.rod([x, y, z], [x, y + hgt, z], r, c);
      const top = [x, y + hgt, z];
      if (prev) B.rod(prev, top, r * 0.8, c);
      prev = top;
    }
  }
}

// Aufbau: Kasten mit Dach, Fensterreihen und Tür (Dampfer, Fähre, Brücke)
function house(B, o) {
  const { x, y, w, d, h, wall = K.cream, roof = '#d6d0c4', glass = K.glassD } = o;
  const nw = o.nw ?? 4, ne = o.ne ?? 2, rows = o.rows ?? 1, ww = o.ww ?? 0.04, wh = o.wh ?? 0.034;
  B.box(w, h, d, x, y + h / 2, 0, wall);
  B.box(w + 0.014, 0.012, d + 0.014, x, y + h + 0.004, 0, roof);
  if (o.trim) B.box(w + 0.006, 0.01, d + 0.006, x, y + 0.005, 0, o.trim);
  for (let r = 0; r < rows; r++) {
    const wy = y + h * ((r + 0.6) / rows) - (rows > 1 ? h * 0.06 : 0) + (o.wdy ?? 0);
    for (let i = 0; i < nw; i++) {
      const px = x + (i - (nw - 1) / 2) * (w * 0.82 / Math.max(1, nw - 1));
      for (const s of ['+z', '-z']) B.quad(ww, wh, px, wy, (s === '+z' ? 1 : -1) * (d / 2 + 0.002), glass, s);
    }
    for (let i = 0; i < ne; i++) {
      const pz = (i - (ne - 1) / 2) * (d * 0.7 / Math.max(1, ne - 1 || 1));
      for (const s of ['+x', '-x']) B.quad(ww, wh, x + (s === '+x' ? 1 : -1) * (w / 2 + 0.002), wy, ne === 1 ? 0 : pz, glass, s);
    }
  }
}

// Anker mit Schaft, Stock und zwei Flunken
function anchor(B, x, y, z, s = 1) {
  B.rod([x, y, z], [x, y - 0.075 * s, z], 0.0035 * s, K.iron);
  B.rod([x - 0.022 * s, y - 0.004 * s, z], [x + 0.022 * s, y - 0.004 * s, z], 0.003 * s, K.iron);
  B.rod([x, y - 0.075 * s, z], [x - 0.03 * s, y - 0.052 * s, z], 0.0035 * s, K.iron);
  B.rod([x, y - 0.075 * s, z], [x + 0.03 * s, y - 0.052 * s, z], 0.0035 * s, K.iron);
}

function funnel(B, x, y, r, h, c, band = null, top = '#3a3a3e') {
  B.cyl(r * 0.82, r, h, x, y + h / 2, 0, c, 8);
  B.cyl(r * 0.86, r * 0.83, h * 0.16, x, y + h * 0.92, 0, top, 8);
  if (band) B.cyl(r * 0.93, r * 0.94, h * 0.14, x, y + h * 0.62, 0, band, 8);
  B.disc(r * 0.8, x, y + h + 0.001, 0, '#2a2a2e', '+y', 8);
}

// ---------- Epoche 4 bis 5: Karavelle und Galeone ----------
function galleon(kind, v) {
  const big = v === 'g', war = kind === 'krieg';
  const B = new Bld(), S = SAIL[kind], A = ACC[kind], F = FLAG[kind];
  const cream = '#ecdcb2';
  const over = war ? { 1: cream, 2: cream } : { 4: A };
  const L = big ? 1.95 : 1.7, dk = 0.075, pd = big ? 0.29 : 0.22, fd = big ? 0.16 : 0.14;
  const H = makeHull(B, {
    L, Wm: big ? 0.205 : 0.185, D: 0.15, Hm: 0.15, sB: big ? 0.15 : 0.12, sS: big ? 0.26 : 0.17, bs: 0.36, bp: 1.45, tb: 0.05, se: 0.17, sp: 1.7, ts: 0.62, q: 0.6, th: 0.2, thick: 0.014, nu: 22, rkB: big ? 0.14 : 0.08, rkS: 0.06, deckStrips: 4,
    segs: [{ u0: 0, u1: 0.2, y: pd }, { u0: 0.2, u1: 0.86, y: dk }, { u0: 0.86, u1: 1, y: fd }],
    rows: planks(5, 0.28, [K.wood, K.woodL, K.wood, K.woodL, K.wood], 0.005, over),
  });
  const X = H.X, Xy = H.Xy, y1b = H.Y1(1);
  // Steven mit Löwenkopf
  const bx = y => Xy(1, y);
  B.tube([[bx(H.Y0(1)), H.Y0(1), 0], [bx(0.1), 0.1, 0], [bx(y1b), y1b, 0]], 0.014, 0.011, K.woodD, 5, 8);
  for (const s of [1, -1]) anchor(B, H.Xy(0.9, 0.24), 0.24, s * (H.zOut(0.9, 0.24) + 0.012), 1.1);
  const fy = 0.2, fx = bx(fy);
  B.sph(0.036, fx + 0.035, fy, 0, K.gold, 1.15, 1, 0.95, 7, 5);
  B.box(0.045, 0.03, 0.04, fx + 0.08, fy - 0.014, 0, '#f0cb73');
  B.box(0.008, 0.012, 0.016, fx + 0.104, fy - 0.004, 0, '#3a2a22');
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; B.sph(0.018, fx + 0.005, fy + Math.cos(a) * 0.05, Math.sin(a) * 0.05, '#cf9f45', 1, 1, 1, 4, 3); }
  for (const z of [-0.016, 0.016]) { B.sph(0.006, fx + 0.062, fy + 0.016, z * 1.5, '#3a2a22', 1, 1, 1, 4, 3); B.cone(0.009, 0.016, fx + 0.03, fy + 0.04, z * 1.6, '#cf9f45', 4); }
  // Bugspriet
  const bsp = [[bx(0.15) - 0.1, fd + 0.05, 0], [bx(0.3) + 0.3, fd + 0.24, 0]];
  B.rod(bsp[0], bsp[1], 0.012, K.woodD, 5, 0.007);
  // Heck: Spiegel mit Fenstern, Goldleisten, Kajüte, Laternen, Ruder
  const sx = y => Xy(0, y) - 0.003;
  for (const z of [-0.07, 0, 0.07]) {
    B.quad(0.052, 0.062, sx(0.2), 0.2, z, K.gold, '-x');
    B.quad(0.04, 0.05, sx(0.2) - 0.0015, 0.2, z, K.glassD, '-x');
  }
  const gy = H.Y1(0) - 0.012;
  B.box(0.008, 0.012, 2 * H.zOut(0, gy) + 0.004, sx(gy), gy, 0, K.gold);
  B.box(0.008, 0.012, 2 * H.zOut(0, 0.1) + 0.004, sx(0.1), 0.1, 0, K.gold);
  const cx = X(0) + (big ? 0.21 : 0.18);
  cabin(B, cx, pd, big ? 0.2 : 0.18, big ? 0.22 : 0.2, big ? 0.095 : 0.08, '#e6d2a6', '#b4553f', { n: 2 });
  B.lantern(X(0) + 0.05, H.Y1(0) - 0.01, 0.0, 1.2);
  for (const z of [-0.085, 0.085]) { const ly = H.Y1(0), lx = Xy(0, ly) + 0.03; B.rod([lx, ly, z], [lx, ly + 0.07, z], 0.004, K.gold); B.lantern(lx, ly + 0.07, z, 0.7); }
  B.rod([X(0) + 0.03, 0.2, 0.0], [X(0) - 0.07, H.Y0(0) - 0.06, 0], 0.012, K.woodD, 4);
  // Masten
  const mm = -0.02, fm = 0.55, zm = X(0) + 0.34;
  const mH = big ? 1.4 : 1.2, fH = big ? 1.14 : 1.0, zH = pd + (big ? 0.74 : 0.62);
  mast(B, mm, dk, mH, 0.022); mast(B, fm, dk, fH, 0.018); mast(B, zm, pd, zH, 0.014);
  B.sph(0.014, mm, mH + 0.005, 0, K.woodD); B.sph(0.012, fm, fH + 0.005, 0, K.woodD);
  // Rahsegel in Lagen
  const lay = (mx, ys) => ys.forEach(([y0, h, bw, tw], i) => {
    yard(B, mx + 0.012, y0 + h + 0.012, bw * 1.08, 0.01);
    B.sail({ x: mx + 0.02, y: y0, bw, tw, h, c: S, emblem: war && i === 0 ? '#f3e8c8' : null, bulge: h * 0.2, rows: 4, cols: 8, roach: h * 0.07 });
  });
  const m1 = big ? [[0.28, 0.34, 0.66, 0.56], [0.65, 0.27, 0.52, 0.4], [0.95, 0.19, 0.36, 0.27]] : [[0.27, 0.34, 0.62, 0.52], [0.64, 0.26, 0.46, 0.36]];
  lay(mm, m1);
  const f1 = big ? [[0.26, 0.3, 0.52, 0.44], [0.58, 0.24, 0.4, 0.3]] : [[0.26, 0.3, 0.5, 0.42], [0.58, 0.22, 0.36, 0.28]];
  lay(fm, f1);
  // Besan Lateinersegel
  const th2 = [zm - 0.34, zH - 0.02, 0], tc = [zm - 0.4, pd + 0.12, 0];
  B.rod([zm + 0.04, pd + 0.1, 0], th2, 0.009, K.woodD, 4, 0.006);
  B.tri({ a: [zm + 0.03, pd + 0.12, 0], b: th2, cl: tc, bulge: 0.06, c: S, c2: shade(S, 0.93), rows: 6, cols: 5, dir: [0, 0, 1] });
  // Fock zwischen Bugspriet und Fockmast
  B.tri({ a: bsp[1], b: [fm + 0.02, fH - 0.14, 0], cl: [fm + 0.3, dk + 0.2, 0], bulge: 0.045, c: S, c2: shade(S, 0.93), rows: 6, cols: 5, dir: [0, 0, -1] });
  B.rod(bsp[1], [fm + 0.01, fH + 0.01, 0], 0.003, K.ropeD);
  // Ausguck im Mast
  const ny = big ? 0.66 : 0.6;
  B.cyl(0.058, 0.045, 0.045, mm, ny, 0, K.woodD, 8, null, true);
  B.cyl(0.045, 0.045, 0.008, mm, ny - 0.02, 0, K.woodL, 8);
  B.crew(mm + 0.015, ny - 0.016, 0.02, COAT[3], '#e0c27a', 0, 1.1);
  // Wanten und Stage
  shrouds(B, H, mm, ny - 0.02, dk, 0.08, 4);
  shrouds(B, H, fm, fH - 0.35, dk, 0.07, 3);
  B.rod([mm, mH, 0], [fm, fH, 0], 0.0026, K.ropeD);
  B.rod([mm, mH, 0], [zm, zH, 0], 0.0026, K.ropeD);
  B.rod([fm, fH, 0], bsp[1], 0.0026, K.ropeD);
  B.rod([zm, zH, 0], [X(0) + 0.02, H.Y1(0), 0], 0.0026, K.ropeD);
  for (const s of [1, -1]) {
    B.rod([mm + 0.03, m1[0][0] + m1[0][1] + 0.01, s * 0.33], [mm - 0.38, 0.22, s * 0.17], 0.002, K.rope);
    B.rod([fm + 0.03, f1[0][0] + f1[0][1] + 0.01, s * 0.26], [fm - 0.15, 0.1, s * 0.16], 0.002, K.rope);
    B.rod([bsp[1][0], bsp[1][1], 0], [bx(0.1) - 0.02, 0.08, s * 0.05], 0.002, K.rope);
  }
  // Flaggen
  for (const [mx, my, k2] of [[mm, mH, 1], [fm, fH, 0.8], [zm, zH, 0.7]]) {
    B.rod([mx, my, 0], [mx, my + 0.09 * k2, 0], 0.003, K.woodD);
    B.flag(mx, my + 0.085 * k2, 0, 0.2 * k2, 0.075 * k2, F);
  }
  // Kanonenpforten (Krieg)
  if (war) {
    for (let i = 0; i < 6; i++) {
      const u = 0.27 + i * 0.095;
      for (const sd of [1, -1]) {
        const y = H.Y0(u) + (H.Y1(u) - H.Y0(u)) * 0.52, z = sd * (H.zOut(u, y) + 0.008), x = Xy(u, y), tl = H.slope(u, y);
        B.quad(0.042, 0.034, x, y, z, '#3b2a22', sd > 0 ? '+z' : '-z', 0, Math.atan(tl));
        B.cyl(0.011, 0.012, 0.03, x, y, z + sd * 0.012, K.iron, 6, [Math.PI / 2, 0, 0]);
      }
    }
  }
  // Besatzung und Ladung
  B.crew(cx + 0.19, pd, 0.06, COAT[0], '#7b5a3a', 0, 1.4);
  B.crew(X(0) + 0.55, dk, -0.09, COAT[1], null, 0, 1.4);
  B.crew(fm + 0.18, dk, 0.08, COAT[3], '#e0c27a', 0, 1.4);
  B.crew(H.X(0.89), fd, 0, COAT[4], '#8a3d34', 0, 1.4);
  const zi = (x, y, sz) => H.zIn(x / L + 0.5, y) - sz / 2 - 0.006;
  const zc = (x, z, sz) => Math.sign(z) * Math.min(Math.abs(z), zi(x, dk, sz));
  if (kind === 'handel') {
    for (const [x, z] of [[mm - 0.22, 0.09], [mm - 0.22, -0.09], [mm - 0.35, 0.0], [mm + 0.2, 0.08]]) B.barrel(x, dk, z, 0.04, 0.07);
    for (const [x, z, y, r] of [[mm + 0.26, 0.07, 0, 0.3], [fm - 0.22, -0.06, 0, -0.2], [fm - 0.22, 0.06, 0.075, 0.1]]) B.crate(x, dk + y, zc(x, z, 0.1), 0.1, K.woodL, r, 0.075);
  } else if (kind === 'siedler') {
    for (const [x, z] of [[mm - 0.24, 0.08], [mm - 0.24, -0.08], [mm - 0.36, 0.0], [mm + 0.22, 0.08]]) B.sack(x, dk, z, 0.04, '#e9dcb9');
    B.crate(fm - 0.22, dk, 0.05, 0.09, K.woodL, 0.2, 0.07);
    for (const z of [-0.07, 0.07]) { B.cyl(0.02, 0.026, 0.03, mm + 0.3, dk + 0.015, z, '#b0693f', 6); B.rod([mm + 0.3, dk + 0.03, z], [mm + 0.3, dk + 0.1, z], 0.004, K.woodD); B.sph(0.038, mm + 0.3, dk + 0.12, z, '#8fbf7a', 1, 0.9, 1, 6, 4); }
    B.crew(mm - 0.1, dk, 0.1, COAT[2], '#d7b26a', 0, 1.3);
  } else if (kind === 'entdeckung') {
    B.crate(mm - 0.25, dk, -0.06, 0.08, K.woodL, 0.3, 0.07);
    B.sph(0.04, mm + 0.22, dk + 0.012, 0.08, K.rope, 1, 0.4, 1, 7, 4);
    B.rod([fm + 0.15, dk + 0.04, 0.0], [fm + 0.33, dk + 0.07, 0.0], 0.006, '#b08a4c', 4);
  }
  const g = B.done();
  g.userData.len = H.L + 0.25; g.userData.beam = H.Wm * 2; g.userData.smoke = [];
  return g;
}

const roofC = kind => ({ handel: '#c8553d', siedler: '#d9a441', entdeckung: '#5b86b0' }[kind] || '#c8553d');

// ---------- Epoche 6: Dampfer mit Schaufelrädern, kleinen Hilfssegeln und Rauch ----------
function steam(kind) {
  const war = kind === 'krieg', B = new Bld(), S = SAIL[kind], A = ACC[kind], F = FLAG[kind];
  const hc = { handel: '#6a84a3', siedler: '#a58468', entdeckung: '#69a0b8', krieg: '#9ba3ab' }[kind];
  const dk = 0.11, L = 2.05;
  const H = makeHull(B, {
    L, Wm: 0.19, D: 0.12, Hm: 0.15, sB: 0.1, sS: 0.02, bs: 0.38, bp: 1.4, tb: 0.05, se: 0.14, sp: 1.8, ts: 0.5, q: 0.55, th: -0.03, thick: 0.012, rkB: 0.1, nu: 22, deckStrips: 5,
    segs: [{ u0: 0, u1: 1, y: dk }], inner: '#e8e0cf', rim: '#f2ecde', deck1: '#d2b48a', deck2: '#c3a37a',
    rows: [
      { v0: 0, v1: 0.3, c: '#9a5242', o0: 0, o1: 0, step: K.woodX },
      { v0: 0.3, v1: 0.78, c: hc, o0: 0, o1: 0 },
      { v0: 0.78, v1: 0.9, c: A, o0: 0, o1: 0 },
      { v0: 0.9, v1: 1, c: '#f1ebdc', o0: 0, o1: 0 },
    ],
  });
  railing(B, H, 0.08, 0.92, 12, 0.04, '#f5f0e4');
  // Aufbauten
  const fc = war ? '#4a4d55' : '#c8553d';
  const wx0 = -0.02, wy0 = 0.06;
  if (war) {
    // Panzerschiff: flache Kasematte mit Pforten, Turm, zwei Schornsteine
    B.box(0.56, 0.07, 0.27, -0.2, dk + 0.035, 0, '#6a6f78');
    B.box(0.5, 0.012, 0.25, -0.2, dk + 0.075, 0, '#7a7f88');
    for (let i = 0; i < 4; i++) for (const s of ['+z', '-z']) B.quad(0.045, 0.03, -0.35 + i * 0.1, dk + 0.04, (s === '+z' ? 1 : -1) * 0.1355, '#2f3238', s);
    house(B, { x: -0.18, y: dk + 0.08, w: 0.22, d: 0.2, h: 0.08, wall: '#8e939b', roof: '#6a6f78', nw: 3, ne: 1, ww: 0.03, glass: '#4d6070' });
    B.cyl(0.09, 0.1, 0.06, 0.5, dk + 0.03, 0, '#6a6f78', 10);
    B.box(0.14, 0.05, 0.13, 0.5, dk + 0.085, 0, '#8a8f98');
    for (const z of [-0.03, 0.03]) B.cyl(0.011, 0.012, 0.16, 0.62, dk + 0.095, z, '#3e4148', 6, [0, 0, Math.PI / 2]);
    funnel(B, -0.32, dk + 0.15, 0.05, 0.22, '#4a4d55', A);
    funnel(B, -0.08, dk + 0.15, 0.05, 0.22, '#4a4d55', A);
  } else {
    house(B, { x: -0.2, y: dk, w: 0.62, d: 0.27, h: 0.1, wall: '#f3eee2', roof: '#cfc8b8', nw: 6, ne: 2, trim: A });
    house(B, { x: -0.12, y: dk + 0.11, w: 0.3, d: 0.22, h: 0.085, wall: '#f6f1e6', roof: roofC(kind), nw: 3, ne: 2 });
    house(B, { x: 0.0, y: dk + 0.2, w: 0.14, d: 0.18, h: 0.065, wall: '#f6f1e6', roof: '#7a5a44', nw: 2, ne: 3, ww: 0.036 });
    funnel(B, -0.32, dk + 0.1, 0.055, 0.34, fc, S);
    B.box(0.05, 0.05, 0.06, 0.6, dk + 0.025, 0.0, K.woodL);
    B.sph(0.045, -0.2, dk + 0.113 + 0.014, 0.0, '#e8a05a', 1.6, 0.4, 0.55, 7, 4);
  }
  // Radkästen (Halbschalen) mit Zierscheibe
  if (!war) for (const s of [1, -1]) {
    const zc = s * 0.245, R = 0.205;
    const sh = new THREE.CylinderGeometry(R, R, 0.115, 16, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2);
    B.put(sh.translate(wx0, wy0, zc), '#f1ebdc');
    B.put(new THREE.CylinderGeometry(R * 1.01, R * 1.01, 0.018, 16, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(wx0, wy0, s * 0.3), A);
    for (const dz of [-0.0575, 0.0575]) {
      const cdisc = new THREE.CircleGeometry(R, 16, 0, Math.PI);
      if (s * dz < 0 || true) B.put(cdisc.translate(wx0, wy0, zc + dz), dz * s > 0 ? '#f6f1e6' : '#c9bfa8');
    }
    B.disc(0.05, wx0, wy0 + 0.0, zc + s * 0.06, K.gold, s > 0 ? '+z' : '-z', 10);
    for (let i = 0; i < 5; i++) { const a = Math.PI * (0.12 + i * 0.19); B.quad(0.012, 0.075, wx0 + Math.cos(a) * 0.12, wy0 + Math.sin(a) * 0.12, zc + s * 0.0625, '#d9ccb0', s > 0 ? '+z' : '-z', a - Math.PI / 2); }
  }
  // Schornstein Stagen, Lüfterhauben, Anker
  const fns = war ? [-0.32, -0.08] : [-0.32];
  for (const x of fns) for (const [dx, dz] of [[0.14, 0.09], [-0.14, 0.09], [0.14, -0.09], [-0.14, -0.09]]) B.rod([x, dk + (war ? 0.3 : 0.4), 0], [x + dx, war ? dk + 0.08 : dk + 0.1, dz], 0.0022, K.ropeD);
  for (const z of [-0.1, 0.1]) {
    B.cyl(0.013, 0.015, 0.045, 0.4, dk + 0.022, z, '#c8553d', 6);
    B.cone(0.026, 0.04, 0.41, dk + 0.062, z, '#c8553d', 6, [0, 0, -1.1]);
  }
  for (const s of [1, -1]) anchor(B, H.Xy(0.9, 0.17), 0.17, s * (H.zOut(0.9, 0.17) + 0.01));
  // Hilfsmasten mit Segeln in der Farbe der Fahrt
  const fx = 0.75, ax = -0.78, mh = 0.62;
  mast(B, fx, dk, mh, 0.014); mast(B, ax, dk, mh - 0.04, 0.013);
  const bt = [H.Xy(1, 0.25) + 0.0, 0.22, 0];
  B.tri({ a: bt, b: [fx + 0.015, mh - 0.02, 0], cl: [fx + 0.28, dk + 0.09, 0], bulge: 0.05, c: S, rows: 6, cols: 5, dir: [0, 0, -1] });
  B.rod([fx, mh, 0], bt, 0.003, K.ropeD);
  const gx = ax + 0.012;
  B.rod([gx, mh - 0.03, 0], [gx - 0.2, mh - 0.16, 0], 0.006, K.woodD);
  B.tri({ a: [gx, dk + 0.08, 0], b: [gx, mh - 0.035, 0], cl: [gx - 0.34, dk + 0.1, 0], bulge: 0.06, c: S, rows: 6, cols: 5, dir: [0, 0, 1] });
  B.rod([ax, mh - 0.04, 0], [fx, mh, 0], 0.0026, K.ropeD);
  B.rod([fx, mh, 0], [fx, mh + 0.08, 0], 0.003, K.woodD); B.flag(fx, mh + 0.075, 0, 0.18, 0.07, F);
  B.rod([ax, mh - 0.04, 0], [ax, mh + 0.03, 0], 0.003, K.woodD); B.flag(ax, mh + 0.03, 0, 0.15, 0.06, shade(F, 1.05));
  // Besatzung und Ladung
  if (!war) {
    B.crew(0.26, dk, 0.06, COAT[2], '#f3eee0', 0, 1.4);
    B.crew(0.42, dk, -0.07, COAT[1], null, 0, 1.4);
    if (kind === 'handel') { B.crate(0.5, dk, 0.07, 0.08, K.woodL, 0.2, 0.06); B.barrel(0.5, dk, -0.07, 0.035, 0.06); B.crate(0.5, dk + 0.06, 0.07, 0.07, K.woodL, 0.5, 0.05); }
    if (kind === 'siedler') { B.sack(0.5, dk, 0.06, 0.035, '#e9dcb9'); B.crate(0.5, dk, -0.06, 0.08, K.woodL, 0.1, 0.06); B.sack(0.44, dk, -0.1, 0.03, '#e9dcb9'); }
    if (kind === 'entdeckung') { B.rod([0.5, dk + 0.04, 0], [0.64, dk + 0.07, 0.0], 0.006, '#b08a4c', 4); B.crate(0.45, dk, -0.07, 0.07, K.woodL, 0.1, 0.06); }
  } else {
    B.crew(0.26, dk, 0.08, COAT[0], '#8e939b', 0, 1.4);
  }
  const g = B.done();
  // Schaufelrad: eigenes Mesh, dreht sich
  if (!war) {
    const W = new Bld();
    for (const z of [-0.245, 0.245]) {
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2, r = 0.15;
        W.box(0.075, 0.1, 0.014, Math.cos(a) * r, Math.sin(a) * r, z, '#a37a52', 0, 0, a);
        W.box(0.1, 0.012, 0.012, Math.cos(a + 0.4) * 0.06, Math.sin(a + 0.4) * 0.06, z, K.ironL, 0, 0, a + 0.4);
      }
      W.cyl(0.03, 0.03, 0.09, 0, 0, z, K.iron, 8, [Math.PI / 2, 0, 0]);
    }
    W.cyl(0.012, 0.012, 0.5, 0, 0, 0, K.iron, 5, [Math.PI / 2, 0, 0]);
    g.userData.wheel = W.done(false);
    g.userData.wheelPos = [wx0, wy0, 0];
  }
  g.userData.len = H.L + 0.2; g.userData.beam = 0.6;
  g.userData.smoke = war ? [[-0.32, dk + 0.38, 0], [-0.08, dk + 0.38, 0]] : [[-0.32, dk + 0.46, 0]];
  return g;
}


// ---------- Epoche 7: Containerschiff, Fähre, Forschungsschiff, Marineschiff ----------
function modern(kind) {
  const B = new Bld(), A = ACC[kind], S = SAIL[kind], F = FLAG[kind];
  const war = kind === 'krieg';
  const cfg = {
    handel: { L: 2.6, Wm: 0.25, Hm: 0.18, dk: 0.16, hull: '#5a7390', under: '#a3453a', top: '#5a7390', stripe: '#e9e4d8', sB: 0.07, rkB: 0.1 },
    siedler: { L: 2.3, Wm: 0.23, Hm: 0.17, dk: 0.14, hull: '#f1eee6', under: '#9a4d3f', top: '#f1eee6', stripe: A, sB: 0.08, rkB: 0.1 },
    entdeckung: { L: 2.2, Wm: 0.22, Hm: 0.16, dk: 0.13, hull: '#9dbdd0', under: '#46647c', top: '#f1eee6', stripe: A, sB: 0.08, rkB: 0.09 },
    krieg: { L: 2.6, Wm: 0.18, Hm: 0.14, dk: 0.11, hull: '#a0a8b0', under: '#5a4a44', top: '#a0a8b0', stripe: A, sB: 0.08, rkB: 0.13 },
  }[kind];
  const { L, dk } = cfg;
  const H = makeHull(B, {
    L, Wm: cfg.Wm, D: 0.13, Hm: cfg.Hm, sB: cfg.sB, sS: 0.01, bs: war ? 0.25 : 0.32, bp: war ? 1.15 : 1.25, tb: war ? 0.03 : 0.07, se: 0.12, sp: 1.5, ts: war ? 0.6 : 0.55, q: 0.5, th: war ? -0.1 : -0.12, thick: 0.012, rkB: cfg.rkB, nu: 22, deckStrips: 5,
    segs: [{ u0: 0, u1: 1, y: dk }], inner: '#d9d4c8', rim: '#e9e4d8', deck1: war ? '#8f949b' : '#b5b0a5', deck2: war ? '#858a92' : '#a8a398',
    rows: [
      { v0: 0, v1: 0.34, c: cfg.under, o0: 0, o1: 0, step: K.woodX },
      { v0: 0.34, v1: 0.8, c: cfg.hull, o0: 0, o1: 0 },
      { v0: 0.8, v1: 0.9, c: cfg.stripe, o0: 0, o1: 0 },
      { v0: 0.9, v1: 1, c: cfg.top, o0: 0, o1: 0 },
    ],
  });
  railing(B, H, 0.06, 0.94, 14, 0.035, '#f1ede4', 0.003);
  for (const s of [1, -1]) anchor(B, H.Xy(0.9, 0.2), 0.2, s * (H.zOut(0.9, 0.2) + 0.01), 1.3);
  const smoke = [];
  const mastR = (x, y, h) => {
    B.rod([x, y, 0], [x, y + h, 0], 0.008, '#d8d3c6', 5, 0.005);
    B.box(0.01, 0.012, 0.13, x, y + h * 0.78, 0, '#cfcabd');
    B.box(0.012, 0.012, 0.2, x - 0.02, y + h, 0, '#9aa1a9');
    B.sph(0.014, x, y + h + 0.012, 0, '#f1ede4', 1, 1, 1, 5, 4);
  };
  if (kind === 'handel') {
    // Brücke am Heck, Container davor
    const bxx = -L / 2 + 0.2;
    house(B, { x: bxx, y: dk, w: 0.34, d: 0.46, h: 0.1, wall: '#f3eee2', roof: '#d6d0c4', nw: 5, ne: 3, trim: A });
    house(B, { x: bxx, y: dk + 0.11, w: 0.3, d: 0.44, h: 0.09, wall: '#f6f1e6', roof: '#d6d0c4', nw: 5, ne: 3 });
    house(B, { x: bxx + 0.02, y: dk + 0.21, w: 0.2, d: 0.48, h: 0.07, wall: '#f6f1e6', roof: '#cfc8b8', nw: 3, ne: 4, ww: 0.05 });
    funnel(B, bxx - 0.13, dk + 0.2, 0.065, 0.2, '#f3eee2', A, '#3a3a3e');
    smoke.push([bxx - 0.13, dk + 0.41, 0]);
    mastR(bxx + 0.04, dk + 0.28, 0.2);
    const pal = ['#e08e72', '#5fa8a0', '#ecc45e', '#9cb48a', '#f1e6d0', '#6f93bd', '#c8553d', '#d9a7b0', '#8d6641'];
    for (let i = 0; i < 7; i++) {
      const x = -0.55 + i * 0.205, u = x / L + 0.5, mz = H.zIn(u, dk) - 0.012;
      const cols = Math.min(4, Math.floor((mz * 2 + 0.01) / 0.1));
      for (let c = 0; c < cols; c++) {
        const z = (c - (cols - 1) / 2) * 0.1, hgt = 1 + Math.floor(hsh(i * 3.1, c * 7.7) * 3);
        for (let l = 0; l < hgt; l++) {
          const ck = pal[Math.floor(hsh(i + c * 11.3, l * 5.9) * pal.length)];
          B.box(0.19, 0.068, 0.092, x, dk + 0.034 + l * 0.071, z, ck);
        }
      }
    }
    B.rod([L / 2 - 0.35, dk, 0], [L / 2 - 0.35, dk + 0.18, 0], 0.006, '#d8d3c6', 4); B.rod([L / 2 - 0.35, dk + 0.18, 0], [L / 2 - 0.1, dk + 0.03, 0], 0.002, K.ropeD);
    B.flag(L / 2 - 0.35, dk + 0.17, 0, 0.16, 0.06, F);
  } else if (kind === 'siedler') {
    house(B, { x: -0.1, y: dk, w: 1.2, d: 0.34, h: 0.1, wall: '#f4f1ea', roof: '#dedad0', nw: 10, ne: 2, trim: A });
    house(B, { x: -0.12, y: dk + 0.11, w: 1.0, d: 0.31, h: 0.095, wall: '#f6f3ec', roof: '#dedad0', nw: 9, ne: 2 });
    house(B, { x: 0.25, y: dk + 0.21, w: 0.4, d: 0.28, h: 0.08, wall: '#f6f3ec', roof: '#c8553d', nw: 4, ne: 3, ww: 0.045 });
    funnel(B, -0.3, dk + 0.205, 0.07, 0.2, '#f6f3ec', A, '#3a3a3e');
    funnel(B, -0.08, dk + 0.205, 0.07, 0.2, '#f6f3ec', A, '#3a3a3e');
    smoke.push([-0.3, dk + 0.41, 0], [-0.08, dk + 0.41, 0]);
    mastR(0.3, dk + 0.29, 0.2);
    for (const z of [-0.16, 0.16]) for (const x of [-0.5, -0.2, 0.1]) B.sph(0.05, x, dk + 0.205, z, '#e8a05a', 1.2, 0.38, 0.45, 6, 4);
    B.crew(0.72, dk, 0.05, COAT[2], '#f3eee0', 0, 1.4); B.crew(0.85, dk, -0.06, COAT[1], null, 0, 1.4);
    B.box(0.14, 0.05, 0.18, 0.95, dk + 0.025, 0, '#d9d4c8');
  } else if (kind === 'entdeckung') {
    house(B, { x: 0.45, y: dk, w: 0.42, d: 0.36, h: 0.12, wall: '#f4f1ea', roof: '#dedad0', nw: 4, ne: 3, trim: A });
    house(B, { x: 0.47, y: dk + 0.13, w: 0.3, d: 0.38, h: 0.075, wall: '#f6f3ec', roof: '#cfc8b8', nw: 3, ne: 4, ww: 0.05 });
    funnel(B, 0.2, dk + 0.12, 0.055, 0.19, '#f6f3ec', A, '#3a3a3e');
    smoke.push([0.2, dk + 0.31, 0]);
    mastR(0.48, dk + 0.205, 0.26);
    B.sph(0.04, 0.37, dk + 0.29, 0, '#f6f3ec', 1, 1, 1, 7, 5);
    B.box(0.3, 0.07, 0.19, -0.2, dk + 0.035, 0.0, '#f4f1ea'); B.box(0.3, 0.012, 0.21, -0.2, dk + 0.076, 0, '#cfc8b8');
    // A Rahmen am Heck
    for (const z of [-0.12, 0.12]) B.rod([-1.0, dk, z], [-1.0, dk + 0.26, z * 0.3], 0.008, '#e5b350', 4);
    B.rod([-1.0, dk + 0.26, -0.03], [-1.0, dk + 0.26, 0.03], 0.01, '#e5b350', 4);
    B.rod([-1.0, dk + 0.26, 0], [-1.16, dk + 0.2, 0], 0.003, K.ropeD);
    B.crate(-0.62, dk, 0.08, 0.1, '#e5b350', 0, 0.09); B.crate(-0.78, dk, -0.08, 0.1, '#6f93bd', 0, 0.09);
    B.sph(0.06, -0.52, dk + 0.03, -0.08, '#e8a05a', 1.3, 0.55, 0.7, 7, 4);
    B.crew(-0.38, dk + 0.077, 0.03, COAT[3], '#f3eee0', 0, 1.3);
  } else {
    // Marineschiff
    house(B, { x: 0.1, y: dk, w: 0.7, d: 0.24, h: 0.12, wall: '#b0b7be', roof: '#8c929a', nw: 6, ne: 1, ww: 0.035, glass: '#4d6070' });
    house(B, { x: 0.28, y: dk + 0.13, w: 0.24, d: 0.22, h: 0.075, wall: '#bcc2c8', roof: '#8c929a', nw: 3, ne: 1, ww: 0.04, glass: '#4d6070' });
    B.box(0.14, 0.12, 0.13, -0.2, dk + 0.18, 0, '#9ca3ab'); B.box(0.15, 0.015, 0.14, -0.2, dk + 0.245, 0, '#4d5058');
    smoke.push([-0.2, dk + 0.27, 0]);
    // Turm vorn mit Rohr
    B.cyl(0.08, 0.09, 0.04, 0.88, dk + 0.02, 0, '#868c94', 10);
    B.box(0.14, 0.05, 0.12, 0.88, dk + 0.065, 0, '#aab1b8'); B.cyl(0.011, 0.012, 0.2, 1.0, dk + 0.075, 0, '#4d5058', 6, [0, 0, Math.PI / 2]);
    B.box(0.1, 0.045, 0.14, 0.56, dk + 0.022, 0, '#9ca3ab');
    B.cyl(0.03, 0.036, 0.035, 0.36, dk + 0.205 + 0.0, 0.0, '#9ca3ab', 8); B.sph(0.032, 0.36, dk + 0.235, 0, '#f1ede4', 1, 1, 1, 7, 4);
    for (const z of [-0.07, 0.07]) { B.box(0.12, 0.035, 0.05, -0.45, dk + 0.02, z, '#868c94'); B.box(0.12, 0.012, 0.04, -0.45, dk + 0.055, z, '#6f757d', 0, 0, 0.35); }
    B.sph(0.05, 0.0, dk + 0.15, 0.15, '#6f757d', 1.4, 0.45, 0.7, 7, 4);
    // Mast mit Radar
    B.rod([0.28, dk + 0.205, 0], [0.28, dk + 0.46, 0], 0.01, '#b0b7be', 5, 0.005);
    B.box(0.012, 0.03, 0.18, 0.28, dk + 0.43, 0, '#868c94'); B.box(0.14, 0.01, 0.012, 0.28, dk + 0.36, 0, '#868c94');
    B.sph(0.018, 0.28, dk + 0.47, 0, '#f1ede4', 1, 1, 1, 5, 4);
    // Hubschrauberdeck
    B.box(0.42, 0.015, 0.32, -0.95, dk + 0.008, 0, '#868c94');
    B.disc(0.12, -0.95, dk + 0.017, 0, K.cream, '+y', 14); B.disc(0.105, -0.95, dk + 0.0175, 0, '#868c94', '+y', 14);
    B.box(0.015, 0.002, 0.07, -0.95, dk + 0.019, -0.03, K.cream); B.box(0.015, 0.002, 0.07, -0.95, dk + 0.019, 0.03, K.cream); B.box(0.07, 0.002, 0.012, -0.95, dk + 0.019, 0, K.cream);
    for (const z of [-0.06, 0.06]) B.box(0.1, 0.04, 0.05, -0.5, dk + 0.02, z, '#9ca3ab');
    B.rod([0.28, dk + 0.46, 0], [0.28, dk + 0.54, 0], 0.003, '#b0b7be'); B.flag(0.28, dk + 0.52, 0, 0.14, 0.06, '#c8553d');
    B.crew(0.65, dk, 0.07, COAT[3], '#e9e4d8', 0, 1.3);
  }
  const g = B.done();
  g.userData.len = L + 0.1; g.userData.beam = cfg.Wm * 2; g.userData.smoke = smoke;
  return g;
}


// ---------- Handelspendel: Liegeplätze, Wege, Ladearbeit ----------
const D4 = [[0, 1], [1, 0], [0, -1], [-1, 0]];                  // gleiche Reihenfolge wie Buildings.facing, der Hafen schaut zum Wasser
const SPEED = { c: 13, k: 16, v: 19, g: 22, s: 28, m: 36 };     // Felder pro Spieltag je Bauart
const DECK = { c: 0.04, k: 0.085, v: 0.075, g: 0.075, s: 0.11, m: 0.2 }; // Deckhöhe über der Wasserlinie
const RUN = 0.12;                                               // Anteil der Fahrzeit für Anfahren und Bremsen
const MAX_FLEET = 30;
const N5 = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const seg = (u, a, b) => clamp((u - a) / (b - a));
const wrapPi = a => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
const yawOf = v => Math.atan2(-v.z, v.x);
// Weg über die Zeit mit sanftem Anfahren und Bremsen (Trapez), 0..1 auf 0..1
const trap = x => {
  const a = RUN, k = 1 / (2 * a * (1 - a));
  if (x < a) return k * x * x;
  if (x > 1 - a) return 1 - k * (1 - x) * (1 - x);
  return (a / 2 + (x - a)) / (1 - a);
};

// Sichtlinie über Wasser mit einem Feld Abstand zum Land
function seaLine(h, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, n = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 2));
  for (let i = 0; i <= n; i++) {
    const tx = Math.round(x0 + dx * i / n), ty = Math.round(y0 + dy * i / n);
    for (const [ex, ey] of N5) {
      const xx = tx + ex, yy = ty + ey;
      if (xx < 0 || yy < 0 || xx >= NX || yy >= NY || h[yy * NX + xx] >= 0) return false;
    }
  }
  return true;
}

// A* Treppen glätten: nur Eckpunkte behalten, lange Strecken wieder unterteilen
function leanPath(h, raw) {
  const keep = [raw[0]];
  let i = 0;
  while (i < raw.length - 1) {
    let j = Math.min(raw.length - 1, i + 28);
    while (j > i + 1 && !seaLine(h, raw[i][0], raw[i][1], raw[j][0], raw[j][1])) j--;
    keep.push(raw[j]); i = j;
  }
  const pts = [keep[0]];
  for (let k = 1; k < keep.length; k++) {
    const a = keep[k - 1], b = keep[k], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 8));
    for (let q = 1; q <= n; q++) pts.push([a[0] + (b[0] - a[0]) * q / n, a[1] + (b[1] - a[1]) * q / n]);
  }
  return pts;
}

// Instanzen setzen: Lage, Drehung um y, Neigung um z, Maßstab
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _M = new THREE.Matrix4(), _c = new THREE.Color();
function put(m, i, x, y, z, yaw = 0, sx = 1, sy = sx, sz = sx, pitch = 0) {
  _e.set(0, yaw, pitch, 'YZX'); _q.setFromEuler(_e);
  _M.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  m.setMatrixAt(i, _M);
}

const CRATE_COL = ['#c99a64', '#b98255', '#d8b27a', '#8fb7ae', '#e0b25a', '#d98f78', '#a9bf8f'];
const COAT_COL = ['#e9e1cc', '#d9a58f', '#9cc0b0', '#e3c47a', '#a9b9d4', '#cf8c78'];

// Hafenarbeiter, Kisten, Säcke, Laufstege und kleine Kräne an den Liegeplätzen (alles Instanzen)
class Gear {
  constructor(scene) {
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    this.pmat = paintable(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    const inst = (geo, cap, mat, tint) => {
      const m = new THREE.InstancedMesh(geo, mat, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (tint) { m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); m.instanceColor.setUsage(THREE.DynamicDrawUsage); }
      m.count = 0; m.frustumCulled = false; m.castShadow = true;
      scene.add(m);
      return m;
    };
    let b = new Bld();
    for (const z of [0.013, -0.013]) b.cyl(0.0105, 0.0115, 0.055, 0, 0.0275, z, '#6b5a48', 5);
    b.pf = 1; b.cyl(0.021, 0.025, 0.06, 0, 0.085, 0, '#ffffff', 6); b.pf = 0;
    b.sph(0.022, 0, 0.138, 0, K.skin, 1, 1, 1, 6, 4);
    b.cone(0.027, 0.02, 0, 0.16, 0, '#d2b072', 6);
    for (const z of [0.027, -0.027]) b.box(0.05, 0.011, 0.011, 0.03, 0.098, z, K.skin);
    this.man = inst(b.done(false), 64, this.pmat, true);
    b = new Bld();
    b.pf = 1; b.box(0.05, 0.05, 0.05, 0, 0.025, 0, '#ffffff'); b.pf = 0;
    b.box(0.053, 0.008, 0.053, 0, 0.025, 0, K.woodD); b.box(0.008, 0.053, 0.053, 0, 0.025, 0, K.woodD);
    this.crate = inst(b.done(false), 128, this.pmat, true);
    b = new Bld();
    b.sph(0.026, 0, 0.022, 0, K.cream, 1, 0.9, 0.8, 6, 4); b.cone(0.011, 0.016, 0, 0.05, 0, shade(K.cream, 0.88), 5);
    this.sack = inst(b.done(false), 64, this.mat);
    b = new Bld(); b.box(1, 0.008, 0.07, 0, 0, 0, K.woodL);
    this.plank = inst(b.done(false), 32, this.mat);
    b = new Bld(); b.box(0.07, 0.02, 0.07, 0, 0.01, 0, K.ironL); b.cyl(0.011, 0.015, 0.27, 0, 0.14, 0, K.woodD, 6); b.sph(0.016, 0, 0.275, 0, K.iron, 1, 1, 1, 5, 3);
    this.post = inst(b.done(false), 16, this.mat);
    b = new Bld(); b.box(1, 0.014, 0.014, 0.5, 0, 0, K.woodD); b.box(0.04, 0.03, 0.03, -0.03, 0, 0, K.iron);
    this.boom = inst(b.done(false), 16, this.mat);
    b = new Bld(); b.cyl(0.0022, 0.0022, 1, 0, -0.5, 0, K.rope, 3);
    this.rope = inst(b.done(false), 16, this.mat);
    this.all = [this.man, this.crate, this.sack, this.plank, this.post, this.boom, this.rope];
    this.n = this.all.map(() => 0);
  }

  begin() { this.n.fill(0); }

  end() {
    this.all.forEach((m, i) => {
      m.count = this.n[i];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }

  add(k, x, y, z, yaw, sc, pitch, ci, sy = sc, sz = sc) {
    const m = this.all[k], i = this.n[k];
    if (i >= m.instanceMatrix.count) return;
    this.n[k]++;
    put(m, i, x, y, z, yaw, sc, sy, sz, pitch);
    if (ci != null && m.instanceColor) { _c.set(k === 0 ? COAT_COL[ci % COAT_COL.length] : CRATE_COL[ci % CRATE_COL.length]); m.instanceColor.setXYZ(i, _c.r, _c.g, _c.b); }
  }

  // Ein Schiff liegt am Pier: Arbeiter tragen Kisten und Säcke, ab Epoche 4 schwenkt ein Kran
  dock(o) {
    const { H, side, lat, k, len, beam, deckY, quayY, era, t, w, seed } = o;
    if (w < 0.02) return;
    const P = (la, ou) => [H.X + H.lx * la + H.ox * ou, H.Z + H.lz * la + H.oz * ou];
    const tip = k === 4, crane = era >= 4 && !tip;
    const zG = tip ? 1.08 : clamp(0.58 + len * 0.4, 0.75, 1.0);
    const G = P(tip ? 0 : side * 0.1, zG);
    const D = tip ? P(0, 1.55) : P(lat - side * beam * 0.28, zG);
    const R = P(0, 0.42);
    // Laufsteg vom Pier aufs Deck
    const gdx = D[0] - G[0], gdz = D[1] - G[1], gl = Math.hypot(gdx, gdz);
    this.add(3, (G[0] + D[0]) / 2, (quayY + deckY) / 2 + 0.004, (G[1] + D[1]) / 2, Math.atan2(-gdz, gdx), gl + 0.05, Math.atan2(deckY - quayY, gl), null, 1, 1);
    // Stapel am Pier
    const pl = tip ? 0.09 : -side * 0.08;
    let pile = P(pl, 0.74), ps = w;
    if (crane) pile = P(side * 0.07, 1.04 - o.Lb);
    this.add(1, pile[0], quayY, pile[1], seed, ps, 0, Math.floor(seed * 7));
    if (!crane) { const q = P(pl + 0.035, 0.66); this.add(2, q[0], quayY, q[1], 0, w, 0, null); }
    // Arbeiter: Pier hin, Laufsteg, Deck, mit Sack zurück
    const nw = crane ? 1 : 2, P_ = 7.5;
    for (let j = 0; j < nw; j++) {
      const u = ((t / P_ + j / nw + seed) % 1 + 1) % 1;
      let x, z, y, dx, dz;
      if (u < 0.30) { const a = u / 0.30; x = lerp(R[0], G[0], a); z = lerp(R[1], G[1], a); y = quayY; dx = G[0] - R[0]; dz = G[1] - R[1]; }
      else if (u < 0.42) { const a = seg(u, 0.30, 0.42); x = lerp(G[0], D[0], a); z = lerp(G[1], D[1], a); y = lerp(quayY, deckY, a); dx = gdx; dz = gdz; }
      else if (u < 0.66) { x = D[0]; z = D[1]; y = deckY; dx = gdx; dz = gdz; }
      else if (u < 0.78) { const a = seg(u, 0.66, 0.78); x = lerp(D[0], G[0], a); z = lerp(D[1], G[1], a); y = lerp(deckY, quayY, a); dx = -gdx; dz = -gdz; }
      else { const a = seg(u, 0.78, 1); x = lerp(G[0], R[0], a); z = lerp(G[1], R[1], a); y = quayY; dx = R[0] - G[0]; dz = R[1] - G[1]; }
      const walking = u < 0.42 || u > 0.66, ws = w * Math.min(seg(u, 0, 0.06), 1 - seg(u, 0.94, 1));
      const yaw = Math.atan2(-dz, dx), by = walking ? Math.abs(Math.sin(t * 9 + j * 2)) * 0.007 : 0;
      if (ws < 0.02) continue;
      this.add(0, x, y + by, z, yaw, ws, 0, Math.floor(seed * 5) + j);
      const fx = Math.cos(yaw) * 0.042 * ws, fz = -Math.sin(yaw) * 0.042 * ws, hy = y + by + 0.07 * ws;
      if (u < 0.42) this.add(1, x + fx, hy, z + fz, yaw, 0.8 * ws, 0, Math.floor(seed * 7) + j + 1);
      else if (u < 0.54) { const a = seg(u, 0.42, 0.54); this.add(1, x + fx, hy - a * 0.1, z + fz, yaw, 0.8 * ws * (1 - a), 0, Math.floor(seed * 7) + j + 1); }
      else if (u < 0.66) { const a = seg(u, 0.54, 0.66); this.add(2, x + fx, hy - 0.03, z + fz, yaw, 0.8 * ws * a, 0, null); }
      else this.add(2, x + fx, hy - 0.03, z + fz, yaw, 0.8 * ws * (1 - seg(u, 0.95, 1)), 0, null);
    }
    if (!crane) return;
    // Kran am Pierende: hebt eine Kiste vom Stapel, schwenkt übers Deck und senkt sie ab
    const bx = P(side * 0.07, 1.04), topY = quayY + 0.27, Lb = o.Lb;
    this.add(4, bx[0], quayY, bx[1], 0, w, 0, null);
    const th0 = Math.atan2(side * H.lz, side * H.lx), th1 = Math.atan2(-H.oz, -H.ox), dth = wrapPi(th1 - th0);
    const u = ((t / 9 + seed) % 1 + 1) % 1;
    let sw = 1, ry;
    if (u < 0.18) ry = lerp(quayY + 0.1, topY - 0.02, smooth(seg(u, 0, 0.18)));
    else if (u < 0.48) { sw = 1 - smooth(seg(u, 0.18, 0.48)); ry = topY - 0.02; }
    else if (u < 0.66) { sw = 0; ry = lerp(topY - 0.02, deckY + 0.07, smooth(seg(u, 0.48, 0.66))); }
    else if (u < 0.74) { sw = 0; ry = lerp(deckY + 0.07, topY - 0.02, smooth(seg(u, 0.66, 0.74))); }
    else if (u < 0.9) { sw = smooth(seg(u, 0.74, 0.9)); ry = topY - 0.02; }
    else { sw = 1; ry = lerp(topY - 0.02, quayY + 0.1, smooth(seg(u, 0.9, 1))); }
    const th = th0 + dth * sw, tx = bx[0] + Math.cos(th) * Lb, tz = bx[1] + Math.sin(th) * Lb;
    this.add(5, bx[0], topY, bx[1], -th, w * Lb, 0, null, w, w);
    this.add(6, tx, topY - 0.01, tz, 0, w, 0, null, Math.max(0.01, topY - 0.01 - ry) / w, w);
    const cs = u < 0.62 ? 1 : u < 0.66 ? 1 - seg(u, 0.62, 0.66) : u < 0.96 ? 0 : seg(u, 0.96, 1);
    if (cs > 0.02) this.add(1, tx, ry - 0.05 * cs, tz, -th, w * cs, 0, Math.floor(seed * 7) + 3);
  }
}

export class Ships {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide });
    this.geo = {};
    this.paths = new Map();
    this.live = new Map();
    this.budget = 0;
    this.fl = new THREE.Vector3();
    // Handelspendel
    this.gear = new Gear(scene);
    this.fleet = [];
    this.lanes = new Map();
    this.hb = new Map(); this.hs = new Map();
    this.use = new Map();
    this.st = null; this.hSt = null; this.hDay = -99; this.syncT = -99; this.uid = 0;
    this.bad = new Map(); // Paare ohne Seeweg, werden nach 40 Spieltagen neu versucht
    this.first = true;    // erste Besetzung der Welt: Schiffe verteilen sich, später laufen neue Schiffe im Hafen los
    this.pose = { x: 0, z: 0, yaw: 0, mv: 0, dock: -1, end: '' };
    this.pose2 = { x: 0, z: 0, yaw: 0, mv: 0, dock: -1, end: '' };
    this.stat = { fleet: 0, docked: 0, moving: 0, waiting: 0, held: 0, hidden: 0 };
    this.O = new Occ(); this.lastT = null; this.lastClock = 0; this.vid = 0;
  }

  // ---------- Seeregeln (seit 25.10.2026, Naders Kritik: Containerschiffe fuhren ineinander) ----------
  //  1. Rechtsverkehr: Hin und Rückweg eines Pendlers laufen nebeneinander (buildLegs).
  //  2. Abstand: ist ein Schiff in gleicher Richtung voraus, nimmt man Fahrt heraus und hält Abstand.
  //  3. Kreuzende Kurse: wer das andere Schiff an Steuerbord (rechts) hat, weicht aus und wartet (Seemannsregel).
  //  4. Stehen sich zwei gegenseitig im Weg, wartet, wer das andere weiter vorn hat (gleich: die größere Nummer).
  //     So wartet auch, wer zu einem besetzten Liegeplatz will, draußen, bis das liegende Schiff abgelegt hat.
  //  7. Liegeplatz: ein Schiff läuft erst in den Hafen ein (letzte Strecke vor dem Pier), wenn sein Liegeplatz frei ist,
  //     sonst wartet es draußen auf seiner Spur. Der Platz bleibt belegt, bis es beim Ablegen wieder so weit draußen ist.
  //  5. Sicherheit: würde ein Schritt ein Schiff in ein anderes schieben, bleibt es stehen. Hängt es länger als
  //     25 Sekunden, wird es ausgeblendet (die Flotte setzt später im Hafen ein neues ein).
  //  6. Letzte Sicherung: berührt ein Schiff in diesem Bild trotzdem eines, wird es nicht gezeigt, bis die Stelle frei ist.
  //     Bleibt ein Handelsschiff so länger als 4 Sekunden versteckt, wird es abgezogen (die Flotte setzt später ein neues ein).
  // Jedes Schiff hat dafür seine eigene Uhr (S.tl, bei Fahrten L.lag als Rückstand), die nur läuft, wenn es fahren darf.
  shipBlocked(id, x, z, c, s, hl, hw, cur) {
    const me = this._me || (this._me = {});
    me.x = x; me.z = z; me.c = c; me.s = s; me.hl = hl; me.hw = hw; me.cur = cur;
    return this.O.near(x, z, o => {
      if (o.id === id) return;
      const h = Occ.ahead(me, o.x, o.z, o.c, o.s, o.hl, o.hw, 0.25, 0.9, 0.9);
      if (!h) return;
      if (h.dot > 0.5) { if (h.fwd > 0.05 || (h.fwd > -0.05 && id > o.id)) return true; return; } // Regel 2
      if (h.dot > -0.5 && h.lat > 0 && h.fwd > 0) return true;                                      // Regel 3: Steuerbord
      const g = Occ.ahead(o, x, z, c, s, hl, hw, 0.25, 0.9, 0.9);                                    // Regel 4
      if (!g || h.fwd > g.fwd + 0.03 || (Math.abs(h.fwd - g.fwd) <= 0.03 && id > o.id)) return true;
    }, 3);
  }

  // Bauart nach Epoche: c Einbaum, k Kogge oder Langschiff, v Karavelle, g Galeone, s Dampfer, m Moderne
  static variant(era) {
    return era <= 1 ? 'c' : era <= 3 ? 'k' : era === 4 ? 'v' : era === 5 ? 'g' : era === 6 ? 's' : 'm';
  }

  geom(kind, era) {
    if (!SAIL[kind]) kind = 'handel';
    const v = Ships.variant(era), k = kind + v;
    if (!this.geo[k]) {
      const mk = { c: canoe, k: kind === 'krieg' || kind === 'pirat' ? longship : cog, v: galleon, g: galleon, s: steam, m: modern }[v];
      this.geo[k] = mk(kind, v);
    }
    return this.geo[k];
  }

  // Schiff bauen und in die Szene setzen (auch für Testaufnahmen)
  spawn(kind, era) {
    const g = this.geom(kind, era), m = new THREE.Mesh(g, this.mat);
    m.castShadow = true;
    m.scale.setScalar(kind === 'krieg' ? 1.15 : kind === 'pirat' ? 1.05 : 1.0);
    let wheel = null;
    if (g.userData.wheel) {
      wheel = new THREE.Mesh(g.userData.wheel, this.mat);
      wheel.position.set(...g.userData.wheelPos);
      wheel.castShadow = true;
      m.add(wheel);
    }
    this.scene.add(m);
    return { m, info: g.userData, kind, era, wheel, ph: Math.random() * 6.28 };
  }

  // Segel blähen, Flaggen flattern
  anim(L, t) {
    const mi = L.m.morphTargetInfluences;
    if (!mi) return;
    const p = L.ph;
    mi[0] = 0.35 + 0.3 * Math.sin(t * 1.5 + p) + 0.1 * Math.sin(t * 3.1 + p * 2);
    mi[1] = Math.cos(t * 6.5 + p); mi[2] = -Math.sin(t * 6.5 + p);
    mi[3] = Math.sin(t * 2.3 + p * 0.5);
    if (L.wheel) L.wheel.rotation.z = -t * 2.4;
  }

  // Häfen der Siedlungen: Pier, Richtung zum Wasser, Wasserfeld vor dem Pier (alle 3 Spieltage neu)
  harbors(st) {
    if (this.hSt === st && st.day - this.hDay < 3 && st.day >= this.hDay) return;
    this.hSt = st; this.hDay = st.day;
    const h = st.tiles.h, hb = new Map(), hs = new Map();
    for (const b of st.buildings) {
      if (b.t !== 'hafen' || (b.prog < 1 && b.old == null)) continue;   // beim Modernisieren bleibt der Pier stehen
      let o = D4.find(([dx, dy]) => { const x = b.x + dx, y = b.y + dy; return x >= 0 && y >= 0 && x < NX && y < NY && h[y * NX + x] < 0; });
      if (!o) o = D4[0];
      let k = 0;
      while (k < 6) { const x = b.x + o[0] * (k + 1), y = b.y + o[1] * (k + 1); if (x < 1 || y < 1 || x >= NX - 1 || y >= NY - 1 || h[y * NX + x] >= 0) break; k++; }
      k = Math.max(1, k);
      const X = wx(b.x), Z = wz(b.y);
      // Achse nach draußen (ox, oz) und quer dazu (lx, lz), wie das Hafenmodell gedreht ist
      const H = { id: b.id, s: b.s, X, Z, ox: o[0], oz: o[1], lx: o[1], lz: -o[0], quay: groundY(X, Z) + 0.047, app: [b.x + o[0] * k, b.y + o[1] * k], appK: k };
      hb.set(b.id, H);
      if (!hs.has(b.s)) hs.set(b.s, []);
      hs.get(b.s).push(H);
    }
    this.hb = hb; this.hs = hs;
  }

  // Liegeplatz einer Siedlung: Wasserfeld vor dem Pier des Hafens, sonst Wasser nahe der Fischerhütte oder dem Zentrum
  dock(st, s) {
    this.harbors(st);
    const hs = this.hs.get(s.id);
    if (hs && hs.length) return hs[0].app;
    const fb = st.buildings.find(b => b.s === s.id && b.t === 'fischer' && b.prog >= 1);
    return this.water(st, fb ? fb.x : s.cx, fb ? fb.y : s.cy);
  }

  water(st, x, y) {
    const T = st.tiles;
    for (let r = 0; r < 30; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const xx = x + dx, yy = y + dy;
      if (xx < 1 || yy < 1 || xx >= NX - 1 || yy >= NY - 1) continue;
      if (T.h[yy * NX + xx] < 0) return [xx, yy];
    }
    return null;
  }

  route(st, a, b) {
    const key = a.join(',') + '>' + b.join(',');
    let p = this.paths.get(key);
    if (p !== undefined) return p;
    if (this.budget <= 0) return undefined;
    this.budget--;
    const raw = findPath(st.tiles.h, a[0], a[1], b[0], b[1], 40000, true);
    if (!raw) { this.paths.set(key, null); return null; }
    // glätten: jeden dritten Punkt, Ecken weich
    const pts = raw.filter((_, i) => i % 3 === 0 || i === raw.length - 1).map(([x, y]) => new THREE.Vector3(wx(x), 0, wz(y)));
    const curve = pts.length > 1 ? new THREE.CatmullRomCurve3(pts) : null;
    p = curve ? { curve, len: curve.getLength() } : null;
    if (this.paths.size > 400) this.paths.clear();
    this.paths.set(key, p);
    return p;
  }

  // Seeweg zwischen zwei Anlaufpunkten als Liste von Feldkoordinaten (zwischengespeichert, auch rückwärts)
  lane(st, a, b) {
    const key = a[0] + ',' + a[1] + '>' + b[0] + ',' + b[1], rk = b[0] + ',' + b[1] + '>' + a[0] + ',' + a[1];
    let p = this.lanes.get(key);
    if (p !== undefined) return p;
    p = this.lanes.get(rk);
    if (p !== undefined) return p ? p.slice().reverse() : null;
    if (this.budget <= 0) return undefined;
    this.budget--;
    const raw = findPath(st.tiles.h, a[0], a[1], b[0], b[1], 40000, true);
    p = raw && raw.length > 1 ? leanPath(st.tiles.h, raw) : null;
    if (this.lanes.size > 300) this.lanes.clear();
    this.lanes.set(key, p);
    return p;
  }

  // Liegeplätze am Pier: 0 und 1 längsseits links und rechts, 2 und 3 daneben, 4 am Pierkopf, 5 vor Anker
  berthPose(k, len, beam) {
    let side = k % 2 === 0 ? 1 : -1, lat, out;
    if (k === 4) { lat = 0; out = 1.25 + len / 2; side = 1; }
    else if (k >= 5) { lat = 0; out = 3.2; side = 1; }
    else { lat = side * (0.2 + beam / 2 + (k >> 1) * (beam + 0.14)); out = 0.68 + len / 2; }
    return { k, side, lat, out };
  }

  at(H, lat, out) { return new THREE.Vector3(H.X + H.lx * lat + H.ox * out, 0, H.Z + H.lz * lat + H.oz * out); }

  berthOK(H, p, len, beam) {
    for (const du of [-len / 2 + 0.1, 0, len / 2 - 0.1]) for (const dl of [-beam / 2, 0, beam / 2]) {
      const v = this.at(H, p.lat + dl, p.out + du);
      if (groundY(v.x, v.z) > -0.03) return false;
    }
    return true;
  }

  pickBerth(H, len, beam) {
    let use = this.use.get(H.id);
    if (!use) this.use.set(H.id, use = [0, 0, 0, 0, 0, 0]);
    let best = 5, bu = 1e9;
    for (const k of [0, 1, 4, 2, 3]) {
      if (use[k] >= bu) continue;
      if (!this.berthOK(H, this.berthPose(k, len, beam), len, beam)) continue;
      best = k; bu = use[k];
    }
    use[best]++;
    return best;
  }

  freeBerths(S) {
    for (const [hid, k] of [[S.hA, S.kA], [S.hB, S.kB]]) { const u = this.use.get(hid); if (u && u[k] > 0) u[k]--; }
  }

  // Wege und Zeiten eines Pendlers: hin, kurz drehen, zurück. null = nie möglich, false = später
  buildLegs(st, S, T) {
    const HA = this.hb.get(S.hA), HB = this.hb.get(S.hB);
    if (!HA || !HB) return null;
    const lane = this.lane(st, HA.app, HB.app);
    if (lane === undefined) return false;
    if (lane === null) return null;
    const { len, beam } = S;
    const pA = this.berthPose(S.kA, len, beam), pB = this.berthPose(S.kB, len, beam);
    const qd = len * 0.55 + 0.3, ed = len * 0.5 + 1.3;
    const mid = lane.map(([x, y]) => new THREE.Vector3(wx(x), 0, wz(y)));
    // äußere Punkte der Strecke: die Anlaufpunkte nur nehmen, wenn sie weit genug draußen liegen
    const m0 = HA.appK > pA.out + ed + 0.8 ? 0 : 1, m1 = mid.length - 1 - (HB.appK > pB.out + ed + 0.8 ? 0 : 1);
    const core = mid.slice(Math.min(m0, m1), Math.max(m0, m1) + 1);
    // Rechtsverkehr: Hin und Rückweg laufen nebeneinander, damit sich Schiffe nicht durchfahren (an den Häfen wieder auf der Achse)
    const nc = core.length, cum = [0];
    for (let i = 1; i < nc; i++) cum.push(cum[i - 1] + core[i].distanceTo(core[i - 1]));
    const tot = cum[nc - 1] || 1;
    const lane2 = sgn => core.map((p, i) => {
      const a = core[Math.max(0, i - 1)], b = core[Math.min(nc - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      const w = smooth(Math.min(cum[i], tot - cum[i]) / 3); // seit 25.10.2026 schon 3 Felder nach dem Hafen getrennt (vorher 8)
      for (const o of [0.5, 0.3, 0]) {
        const x = p.x - sgn * dz / l * o * w, z = p.z + sgn * dx / l * o * w;
        if (o === 0 || groundY(x, z) < -0.06) return new THREE.Vector3(x, 0, z);
      }
    });
    const fwd = [this.at(HA, pA.lat, pA.out + qd), this.at(HA, pA.lat, pA.out + ed), ...lane2(-1), this.at(HB, pB.lat, pB.out + ed), this.at(HB, pB.lat, pB.out)];
    const rev = [this.at(HB, pB.lat, pB.out + qd), this.at(HB, pB.lat, pB.out + ed), ...lane2(1).reverse(), this.at(HA, pA.lat, pA.out + ed), this.at(HA, pA.lat, pA.out)];
    const mk = pts => { const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal'); c.arcLengthDivisions = Math.max(200, pts.length * 24); return { c, len: c.getLength(), y0: yawOf(c.getTangentAt(0.001)), y1: yawOf(c.getTangentAt(0.999)) }; };
    const F = mk(fwd), R = mk(rev);
    if (!(F.len > 0.5 && R.len > 0.5 && isFinite(F.len) && isFinite(R.len))) return null;
    const sp = SPEED[S.v] || 20;
    const end = (L, pt) => ({ x: pt.x, z: pt.z, yaw: L.y1 });
    // Drehung am Liegeplatz: der Bug schwenkt zur offenen Seite, weg vom Pier
    const turn = (H, p, yawIn) => {
      const f0x = Math.cos(yawIn), f0z = -Math.sin(yawIn), f1x = Math.cos(yawIn + 0.3), f1z = -Math.sin(yawIn + 0.3);
      return ((f1x - f0x) * H.lx + (f1z - f0z) * H.lz) * p.side > 0 ? 1 : -1;
    };
    S.g = {
      fwd: F, rev: R, Tf: F.len / (sp * (1 - RUN)), Tr: R.len / (sp * (1 - RUN)),
      bA: end(R, rev[rev.length - 1]), bB: end(F, fwd[fwd.length - 1]),
      qA: fwd[0], qB: rev[0], tA: turn(HA, pA, R.y1), tB: turn(HB, pB, F.y1), pA, pB, HA, HB,
    };
    S.C = 2 * S.D + 2 * S.Tn + S.g.Tf + S.g.Tr;
    // am Anfang verteilt, später ein neues Schiff beginnt im Hafen A
    S.off = S.spread ? S.ph * S.C : (S.C - (T % S.C)) % S.C + 0.02;
    return true;
  }

  // Ort und Richtung des Schiffs zur Zykluszeit c (Spieltage): in A liegen, drehen, hin, in B liegen, drehen, zurück
  poseAt(S, c, P) {
    const g = S.g, D = S.D, Tn = S.Tn;
    const turnAt = (b, q, tdir, y1, yOut, u) => {
      const a = smooth(u), r = wrapPi(yOut - (y1 + tdir * Math.PI));
      P.x = lerp(b.x, q.x, a); P.z = lerp(b.z, q.z, a);
      P.yaw = y1 + tdir * Math.PI * smooth(seg(u, 0.12, 0.95)) + r * smooth(u);
      P.mv = Math.sin(u * Math.PI) * 0.3; P.dock = -1;
    };
    let u = c;
    if (u < D) { P.x = g.bA.x; P.z = g.bA.z; P.yaw = g.bA.yaw; P.mv = 0; P.dock = u / D; P.end = 'A'; return; }
    u -= D;
    if (u < Tn) { turnAt(g.bA, g.qA, g.tA, g.bA.yaw, g.fwd.y0, u / Tn); return; }
    u -= Tn;
    if (u < g.Tf) { this.along(g.fwd, u / g.Tf, P); return; }
    u -= g.Tf;
    if (u < D) { P.x = g.bB.x; P.z = g.bB.z; P.yaw = g.bB.yaw; P.mv = 0; P.dock = u / D; P.end = 'B'; return; }
    u -= D;
    if (u < Tn) { turnAt(g.bB, g.qB, g.tB, g.bB.yaw, g.rev.y0, u / Tn); return; }
    u -= Tn;
    this.along(g.rev, clamp(u / g.Tr), P);
  }

  // Regel 7: welche Liegeplätze braucht das Schiff zur Zykluszeit c? hold: liegt, dreht oder ist nah am Pier; want: steht
  // gerade an der Grenze zur Einfahrt. Rückgabe [Schlüssel oder -1 für A, für B, Einfahrt angefragt (Schlüssel) oder -1]
  berthNeed(S, c, out) {
    const g = S.g, D = S.D, Tn = S.Tn, kA = S.hA * 8 + S.kA, kB = S.hB * 8 + S.kB, R = S.len * 1.5 + 4.3;
    out[0] = -1; out[1] = -1; out[2] = -1;
    let u = c;
    if (u < D + Tn) { out[0] = kA; return out; }
    u -= D + Tn;
    if (u < g.Tf) { const sd = trap(clamp(u / g.Tf)) * g.fwd.len; if (sd < R) out[0] = kA; if (g.fwd.len - sd < R) out[2] = kB; return out; }
    u -= g.Tf;
    if (u < D + Tn) { out[1] = kB; return out; }
    u -= D + Tn;
    const sd = trap(clamp(u / g.Tr)) * g.rev.len;
    if (sd < R) out[1] = kB;
    if (g.rev.len - sd < R) out[2] = kA;
    return out;
  }

  along(L, x, P) {
    const s = trap(clamp(x)), pt = L.c.getPointAt(s), tan = L.c.getTangentAt(clamp(s, 0.001, 0.999));
    P.x = pt.x; P.z = pt.z; P.yaw = yawOf(tan);
    P.mv = Math.min(1, Math.min(x, 1 - x) / RUN); P.dock = -1;
  }

  // Zeit bis zum nächsten Ablegen (Ende eines Aufenthalts)
  nextDepart(S, T) {
    const c = (((T + S.off) % S.C) + S.C) % S.C;
    let best = 1e9;
    for (const e of [S.D, 2 * S.D + S.Tn + S.g.Tf]) best = Math.min(best, ((e - c) % S.C + S.C) % S.C);
    return T + best;
  }

  // Gewünschte Pendler: jedes Paar von Häfen mit Seeweg (st.trade) und alle Seerouten mit Handel (st.routes)
  sync(st, T) {
    this.harbors(st);
    const rt = st._rt, want = new Map();
    const add = (a, b, val) => {
      if (a === b) return;
      const sa = rt.sById.get(a), sb = rt.sById.get(b);
      if (!sa || !sb || !sa.alive || !sb.alive) return;
      if (!(this.hs.get(a) || []).length || !(this.hs.get(b) || []).length) return;
      const k = a < b ? a + '|' + b : b + '|' + a, o = want.get(k);
      if (o) o.val = Math.max(o.val, val); else want.set(k, { k, a: Math.min(a, b), b: Math.max(a, b), val });
    };
    for (const r of st.trade || []) add(r.a, r.b, 0);
    for (const r of st.routes || []) if (r.sea) add(r.a, r.b, r.val || 0);
    let room = MAX_FLEET;
    for (const w of [...want.values()].sort((x, y) => y.val - x.val)) { if (this.bad.has(w.k) && T - this.bad.get(w.k) < 40) { w.n = 0; continue; } w.n = room > 0 ? clamp(1 + Math.floor(w.val / 120), 1, 4) : 0; w.n = Math.min(w.n, room); room -= w.n; }
    const live = this.fleet.filter(S => !S.fading);
    for (const S of live) {
      const w = want.get(S.pair);
      const keep = w && S.idx < w.n && this.hb.has(S.hA) && this.hb.has(S.hB);
      const tl = S.tl ?? T;
      if (keep) { if (S.retire && !S.fading && tl < S.endT) { S.retire = false; S.endT = Infinity; } }
      else if (!S.retire) { S.retire = true; S.endT = S.g ? this.nextDepart(S, tl) : tl; }
    }
    for (const w of want.values()) for (let i = 0; i < w.n; i++) {
      if (live.some(S => S.pair === w.k && S.idx === i && !S.retire)) continue;
      this.newShip(st, w, i);
    }
    this.syncT = T;
    this.first = false;
  }

  newShip(st, w, i) {
    const rt = st._rt, A = rt.sById.get(w.a), B = rt.sById.get(w.b);
    const hsA = this.hs.get(w.a), hsB = this.hs.get(w.b);
    const home = i % 2 === 0 ? A : B, I = rt.iById.get(home.isle), era = I ? I.era | 0 : 0;
    const g = this.geom('handel', era), len = g.userData.len || 1.2, beam = g.userData.beam || 0.3;
    const HA = hsA[i % hsA.length], HB = hsB[(i + 1) % hsB.length];
    const S = {
      id: ++this.uid, pair: w.k, a: w.a, b: w.b, idx: i, hA: HA.id, hB: HB.id, era, v: Ships.variant(era), len, beam,
      D: 0.6 + 0.4 * hsh(w.a * 0.37 + 1.3, w.b * 0.11 + i), Tn: 0.2, ph: ((i + hsh(w.a * 0.53, w.b * 0.29)) / Math.max(1, w.n)) % 1,
      retire: false, endT: Infinity, fading: false, fadeT: 0, g: null, L: null, ready: false, spread: this.first,
    };
    S.kA = this.pickBerth(HA, len, beam); S.kB = this.pickBerth(HB, len, beam);
    this.fleet.push(S);
    return S;
  }

  removeShip(S) {
    this.freeBerths(S);
    if (S.L) {
      this.scene.remove(S.L.m);
      if (S.L.own) S.L.m.material.dispose();
      this.live.delete('f' + S.id);
    }
    S.gone = true;
  }

  reset(st) {
    for (const S of this.fleet) this.removeShip(S);
    for (const [, L] of this.live) this.scene.remove(L.m);
    this.fleet = []; this.live.clear(); this.lanes.clear(); this.paths.clear(); this.use.clear(); this.bad.clear();
    this.berths = new Map(); this.aliveNow = new Set(); this.aliveShips = new Set();
    this.hb = new Map(); this.hs = new Map(); this.hSt = null; this.hDay = -99; this.syncT = -99; this.first = true;
    this.st = st;
  }

  // Ein Pendler pro Bild: Ort, Lage, Wellen, Rauch, Ladearbeit
  tick(st, S, T, t, rise) {
    if (!S.g) {
      if (S.retire) { this.removeShip(S); return; }
      const r = this.buildLegs(st, S, T);
      if (r === null) { this.bad.set(S.pair, T); this.removeShip(S); return; }
      if (r === false) { this.stat.waiting++; return; }
    }
    if (!S.L) {
      const L = this.spawn('handel', S.era);
      L.fleet = true; L.sid = S.id;
      this.live.set('f' + S.id, L);
      S.L = L;
    }
    const L = S.L, P = this.pose;
    if (S.tl == null || Math.abs(S.tl - T) > 6) S.tl = T; // eigene Uhr (Seeregeln), nach langem Vorspulen wieder im Takt
    const cyc = tl => (((tl + S.off) % S.C) + S.C) % S.C;
    this.poseAt(S, cyc(S.tl), P);
    const sc0 = L.m.scale.x, hl = (L.info.len || 1.2) * sc0 / 2, hw = (L.info.beam || 0.3) * sc0 / 2;
    const fc = Math.cos(P.yaw), fs = Math.sin(P.yaw);
    let go = 1;
    // Regel 7: Liegeplätze halten, Einfahrt nur in einen freien Platz
    const B = this.berths, need = this.berthNeed(S, cyc(S.tl), this._need || (this._need = [0, 0, 0]));
    for (const k of S.bh || []) if (k !== need[0] && k !== need[1] && k !== need[2] && B.get(k) === S.id) B.delete(k);
    S.bh = [];
    for (const k of need) {
      if (k < 0) continue;
      const own = B.get(k);
      if (own == null || own === S.id || !this.aliveShips.has(own)) { B.set(k, S.id); S.bh.push(k); }
      else if (k === need[2] && !(S.bh0 || []).includes(k) && this.rules) go = 0; // draußen warten, bis frei
    }
    S.bh0 = S.bh;
    this.aliveNow.add(S.id);
    if (this.rules && P.dock < 0 && go) {
      if (this.shipBlocked(S.id, P.x, P.z, fc, fs, hl, hw, P.mv)) go = 0;
      if (go && this.dT > 0) {
        const P2 = this.pose2;
        this.poseAt(S, cyc(S.tl + this.dT), P2);
        if (this.O.hits(S.id, P2.x, P2.z, Math.cos(P2.yaw), Math.sin(P2.yaw), hl, hw, P.x, P.z, 3)) go = 0;
      }
    }
    S.rate = go ? Math.min(1, (S.rate ?? 1) + this.dt * 0.6) : Math.max(0, (S.rate ?? 1) - this.dt * 2.5);
    if (!go) { S.held = (S.held || 0) + this.dt; this.stat.held++; } else S.held = 0;
    S.tl += this.dT * (P.dock >= 0 ? 1 : S.rate);
    if (S.held > 25 && !S.fading) { S.retire = true; S.endT = -Infinity; S.fading = true; S.fadeT = t; L.m.material = this.mat.clone(); L.m.material.transparent = true; L.m.material.depthWrite = false; L.own = true; }
    // Verabschieden: nach dem nächsten Ablegen noch ein Stück hinausfahren, dann ausblenden
    if (S.retire && !S.fading && S.tl > S.endT + S.Tn + 0.35) {
      S.fading = true; S.fadeT = t;
      L.m.material = this.mat.clone(); L.m.material.transparent = true; L.m.material.depthWrite = false; L.own = true;
    }
    let alpha = 1;
    if (S.fading) { alpha = 1 - (t - S.fadeT) / 3; if (alpha <= 0) { this.removeShip(S); return; } L.m.material.opacity = alpha; }
    const docked = P.dock >= 0, amp = docked ? 0.35 : 1;
    L.m.position.set(P.x, 0.03 + rise + Math.sin(t * 1.6 + S.id) * 0.03 * amp, P.z);
    L.m.rotation.set(Math.sin(t * 1.2 + S.id) * 0.04 * amp, P.yaw, Math.sin(t * 1.4 + S.id * 2) * 0.03 * amp);
    if (this.O.touch(P.x, P.z, fc, fs, hl, hw, 3)) { // Regel 6
      L.m.visible = false; this.stat.hidden++;
      S.hid = (S.hid || 0) + this.dt;
      if (S.hid > 4) this.removeShip(S);
      return;
    }
    S.hid = 0;
    this.O.put(S.id, P.x, P.z, fc, fs, hl, hw, P.mv * (S.rate ?? 1));
    L.m.visible = true;
    this.anim(L, t);
    this.stat.fleet++;
    if (docked) this.stat.docked++; else this.stat.moving++;
    const rnd = Math.random, sc = L.m.scale.x, len = (L.info.len || 1.2) * sc;
    const fwx = Math.cos(P.yaw), fwz = -Math.sin(P.yaw), px = -fwz, pz = fwx;
    if (docked) {
      // Ladearbeit am Pier
      const du = P.dock, w = smooth(du / 0.14) * (1 - smooth((du - 0.86) / 0.14));
      const p = P.end === 'A' ? S.g.pA : S.g.pB, H = P.end === 'A' ? S.g.HA : S.g.HB;
      if (p.k <= 4 && !S.retire) {
        const crane = S.era >= 4 && p.k !== 4;
        this.gear.dock({ H, side: p.side, lat: p.lat, k: p.k, len, beam: S.beam, deckY: 0.03 + rise + (DECK[S.v] || 0.1), quayY: H.quay, era: S.era, t, w, seed: S.id * 0.37, Lb: crane ? clamp(Math.abs(p.lat) - 0.07 + 0.03, 0.28, 0.55) : 0 });
      }
    } else if (P.mv > 0.12) {
      if (rnd() < 0.25 * P.mv) this.fx.smoke.emit({ x: P.x - fwx * len * 0.48 + (rnd() - 0.5) * 0.15, y: 0.04 + rise, z: P.z - fwz * len * 0.48 + (rnd() - 0.5) * 0.15, vy: 0.005, life: 1.3, size: 0.09, grow: 1.3, c: [0.97, 0.98, 0.97], a: 0.2 * alpha });
      if (rnd() < 0.3 * P.mv) {
        const sd = rnd() < 0.5 ? 1 : -1, bw = (L.info.beam || 0.2) * sc * 0.5;
        this.fx.smoke.emit({ x: P.x + fwx * len * 0.44 + px * sd * bw * 0.6, y: 0.035 + rise, z: P.z + fwz * len * 0.44 + pz * sd * bw * 0.6, vx: px * sd * 0.12 - fwx * 0.05, vz: pz * sd * 0.12 - fwz * 0.05, vy: 0.01, life: 0.9, size: 0.065, grow: 1.4, c: [0.98, 0.99, 0.98], a: 0.3 * alpha });
      }
    }
    // Rauch aus den Schornsteinen (Dampfer dicker, Moderne dünn und hell), im Hafen schwächer
    const sm = L.info.smoke;
    if (sm && sm.length && rnd() < (L.era >= 7 ? 0.07 : 0.17) * (docked ? 0.5 : 1) * alpha) {
      const q = sm[Math.floor(rnd() * sm.length)];
      L.m.updateMatrix();
      this.fl.set(q[0], q[1], q[2]).applyMatrix4(L.m.matrix);
      if (L.era >= 7) this.fx.smoke.emit({ x: this.fl.x, y: this.fl.y, z: this.fl.z, vy: 0.25, vx: 0.15, life: 3, size: 0.16, grow: 2.5, c: [0.8, 0.8, 0.82], a: 0.18 });
      else this.fx.smoke.emit({ x: this.fl.x, y: this.fl.y, z: this.fl.z, vy: 0.4, vx: 0.2, life: 3.6, size: 0.17, grow: 2.8, c: [0.5, 0.5, 0.52], a: 0.4 });
    }
  }

  update(st, frac, t, rise) {
    this.budget = 2;
    if (st !== this.st) this.reset(st);
    const T = st.day + frac;
    this.dt = Math.max(0, Math.min(0.1, t - this.lastClock)); this.lastClock = t;
    this.dT = this.lastT == null ? 0 : Math.max(0, Math.min(10, T - this.lastT)); this.lastT = T;
    // Regeln nur bei normalem Tempo (beim schnellen Vorspulen springen die Schiffe ohnehin weit)
    this.rules = this.dt > 0 && this.dT / this.dt < 0.2;
    this.O.begin(); this.stat.held = 0; this.stat.hidden = 0;
    this.berths = this.berths || new Map();
    this.aliveShips = this.aliveNow || new Set(); this.aliveNow = new Set(); // Liegeplätze verfallen, wenn ihr Schiff fehlt
    this.fleetUpdate(st, T, t, rise);
    this.voyageUpdate(st, frac, t, rise);
  }

  fleetUpdate(st, T, t, rise) {
    this.harbors(st);
    if (T - this.syncT >= 1.5 || T < this.syncT) this.sync(st, T);
    this.stat.fleet = 0; this.stat.docked = 0; this.stat.moving = 0; this.stat.waiting = 0;
    this.gear.begin();
    for (const S of this.fleet.slice()) if (!S.gone) this.tick(st, S, T, t, rise);
    this.gear.end();
    // Die kleinen Fischerboote der Häfen räumen den Platz, solange dort Handelsschiffe anlegen
    const fb = this.fx.boats;
    if (fb) for (const [id, m] of fb) { const u = this.hb.has(id) && this.use.get(id); m.visible = !(u && u.some(n => n > 0)); }
    if (this.fleet.some(S => S.gone)) this.fleet = this.fleet.filter(S => !S.gone);
  }

  // Fahrten aus st.voyages: Krieg, Siedler, Entdecker. Handel fährt seit dem Umbau als Pendel (fleetUpdate).
  voyageUpdate(st, frac, t, rise) {
    const rt = st._rt, seen = new Set();
    for (const v of st.voyages || []) {
      if (v.k === 'handel') continue;
      const key = `${v.k}|${v.a ?? (v.from ? v.from.join(',') : '')}|${v.b ?? (v.to ? v.to.join(',') : '')}|${v.d}`;
      seen.add(key);
      const A = v.a != null ? rt.sById.get(v.a) : null, B = v.b != null ? rt.sById.get(v.b) : null;
      // Piraten fahren von ihrem Nest los (from als Kachel), alle anderen von einem Hafen
      if (!A && !v.from) continue;
      const from = A ? this.dock(st, A) : this.water(st, v.from[0], v.from[1]);
      const to = B ? this.dock(st, B) : v.to ? this.water(st, v.to[0], v.to[1]) : null;
      if (!from || !to) continue;
      const path = this.route(st, from, to);
      if (!path) continue;
      let L = this.live.get(key);
      if (!L) {
        const I = A ? rt.iById.get(A.isle) : null;
        // Piratenschiffe: Bauart der jüngsten Seefahrer (sie stehlen, was schwimmt)
        const era = A ? (I ? I.era | 0 : 0) : Math.max(2, Math.min(5, st.era | 0));
        L = this.spawn(v.k, era);
        this.live.set(key, L);
      }
      if (!L.vid) { L.vid = 100000 + (++this.vid); L.lag = 0; }
      const kAt = lag => Math.max(0, Math.min(1, (st.day + frac - v.d - lag) / v.dur));
      const k = kAt(L.lag);
      const pos = path.curve.getPointAt(k), tan = path.curve.getTangentAt(Math.min(0.999, Math.max(0.001, k)));
      const yaw = Math.atan2(-tan.z, tan.x), fc = Math.cos(yaw), fs = Math.sin(yaw);
      const hl = (L.info.len || 1.2) * L.m.scale.x / 2, hw = (L.info.beam || 0.3) * L.m.scale.x / 2;
      // Seeregeln: wer warten muss, fällt gegenüber dem Fahrplan zurück
      if (this.rules && k > 0.02 && k < 0.99 && !L.hidden) {
        let go = !this.shipBlocked(L.vid, pos.x, pos.z, fc, fs, hl, hw, 0.8);
        if (go && this.dT > 0) {
          const k2 = kAt(L.lag - 0), p2 = path.curve.getPointAt(Math.min(1, k2 + this.dT / v.dur)), t2 = path.curve.getTangentAt(Math.min(0.999, Math.max(0.001, k2 + this.dT / v.dur)));
          const y2 = Math.atan2(-t2.z, t2.x);
          if (this.O.hits(L.vid, p2.x, p2.z, Math.cos(y2), Math.sin(y2), hl, hw, pos.x, pos.z, 3)) go = false;
        }
        if (!go) { L.lag += this.dT; this.stat.held++; }
      }
      L.m.position.set(pos.x, 0.03 + rise + Math.sin(t * 1.6 + v.d) * 0.03, pos.z);
      L.m.rotation.set(Math.sin(t * 1.2 + v.d) * 0.04, yaw, Math.sin(t * 1.4) * 0.03);
      L.m.visible = k > 0.02 && k < 0.99;
      if (!L.m.visible) continue;
      L.hidden = this.O.touch(pos.x, pos.z, fc, fs, hl, hw, 3);
      if (L.hidden) { L.m.visible = false; this.stat.hidden++; continue; } // Regel 6
      this.O.put(L.vid, pos.x, pos.z, fc, fs, hl, hw, 0.8);
      this.anim(L, t);
      const sc = L.m.scale.x, len = (L.info.len || 1.2) * sc, rnd = Math.random;
      const fwx = tan.x, fwz = tan.z, px = -fwz, pz = fwx;
      if (k > 0.03 && k < 0.97) {
        // Schaumspur hinter dem Heck
        if (rnd() < 0.25) {
          this.fx.smoke.emit({ x: pos.x - fwx * len * 0.48 + (rnd() - 0.5) * 0.15, y: 0.04 + rise, z: pos.z - fwz * len * 0.48 + (rnd() - 0.5) * 0.15, vy: 0.005, life: 1.3, size: 0.09, grow: 1.3, c: [0.97, 0.98, 0.97], a: 0.2 });
        }
        // Bugwelle: weißer Schaum an beiden Seiten des Stevens
        if (rnd() < 0.3) {
          const sd = rnd() < 0.5 ? 1 : -1, bw = (L.info.beam || 0.2) * sc * 0.5;
          this.fx.smoke.emit({ x: pos.x + fwx * len * 0.44 + px * sd * bw * 0.6, y: 0.035 + rise, z: pos.z + fwz * len * 0.44 + pz * sd * bw * 0.6, vx: px * sd * 0.12 - fwx * 0.05, vz: pz * sd * 0.12 - fwz * 0.05, vy: 0.01, life: 0.9, size: 0.065, grow: 1.4, c: [0.98, 0.99, 0.98], a: 0.3 });
        }
      }
      // Rauch aus den Schornsteinen (Dampfer dicker, Moderne dünn und hell)
      const sm = L.info.smoke;
      if (sm && sm.length && rnd() < (L.era >= 7 ? 0.07 : 0.17)) {
        const q = sm[Math.floor(rnd() * sm.length)];
        L.m.updateMatrix();
        this.fl.set(q[0], q[1], q[2]).applyMatrix4(L.m.matrix);
        if (L.era >= 7) this.fx.smoke.emit({ x: this.fl.x, y: this.fl.y, z: this.fl.z, vy: 0.25, vx: 0.15, life: 3, size: 0.16, grow: 2.5, c: [0.8, 0.8, 0.82], a: 0.18 });
        else this.fx.smoke.emit({ x: this.fl.x, y: this.fl.y, z: this.fl.z, vy: 0.4, vx: 0.2, life: 3.6, size: 0.17, grow: 2.8, c: [0.5, 0.5, 0.52], a: 0.4 });
      }
    }
    for (const [key, L] of this.live) if (!L.fleet && !seen.has(key)) { this.scene.remove(L.m); this.live.delete(key); }
  }
}
