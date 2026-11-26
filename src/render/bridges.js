// Brücken der Landstraßen (seit 19.10.2026, Naders Wunsch: echte Brücken, Autos fahren darüber).
// Wo eine Straße einen Fluss quert (render/roadnet.js: Spannweite bis über die Ufer, Fahrbahn auf Uferhöhe), steht je
// nach Ausbau und Epoche ein eigenes Modell: Feldweg ein Holzsteg mit Pfählen und Geländer, Pflaster eine
// Steinbogenbrücke mit Brüstung, Asphalt eine eiserne Fachwerkbrücke (Industrie) oder eine Betonbrücke mit Pfeilern
// (Moderne). Alles in einem Zeichenaufruf mit Eckfarben. Die Fahrbahn selbst ist das Straßenband darüber.
// roadY(x, z): Höhe, auf der man steht oder fährt, Gelände oder Brücke (Fahrzeuge, Menschen, Geist).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NX, NY } from './scene.js';
import { groundY } from './terrain.js';
import { patch } from './mats.js';

// Raster der Brücken: Kachel → Liste der Brückenabschnitte [ax, az, bx, bz, ya, yb, hw]
let GRID = new Map();
export function bridgeY(x, z) {
  if (!GRID.size) return -Infinity;
  const i = Math.floor(z + NY / 2) * NX + Math.floor(x + NX / 2);
  const L = GRID.get(i);
  if (!L) return -Infinity;
  let best = -Infinity;
  for (const [ax, az, bx, bz, ya, yb, hw] of L) {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-6;
    let t = ((x - ax) * dx + (z - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    if (Math.hypot(x - ax - dx * t, z - az - dz * t) > hw + 0.05) continue;
    best = Math.max(best, ya + (yb - ya) * t + 0.025);
  }
  return best;
}
export const roadY = (x, z) => Math.max(groundY(x, z), bridgeY(x, z));

const C = h => new THREE.Color(h);
const STYLE = {
  holz: { deck: C('#8a6a4a'), beam: C('#6e5038'), post: C('#5c4330'), rail: C('#9a7a56') },
  stein: { deck: C('#c9bfae'), beam: C('#b5aa98'), post: C('#a89d8a'), rail: C('#d6ccba') },
  eisen: { deck: C('#7a7f84'), beam: C('#3f5f5a'), post: C('#355049'), rail: C('#4c6e67') },
  beton: { deck: C('#c7c7c2'), beam: C('#b4b4ae'), post: C('#a9a9a3'), rail: C('#8e9399') },
};

// Geometrie mit Eckfarbe
function colored(g, col) {
  g = g.index ? g.toNonIndexed() : g;
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.deleteAttribute('uv');
  return g;
}
// Balken von a nach b (Mittelpunkte), Querschnitt w × h
function beam(parts, a, b, w, h, col) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  if (len < 1e-4) return;
  const g = new THREE.BoxGeometry(w, h, len);
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), d, Math.abs(d.y / len) > 0.98 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0));
  m.setPosition(a.clone().add(b).multiplyScalar(0.5));
  g.applyMatrix4(m);
  parts.push(colored(g, col));
}
function post(parts, x, y0, y1, z, r, col, round = false) {
  if (y1 - y0 < 0.01) return;
  const g = round ? new THREE.CylinderGeometry(r, r * 1.08, y1 - y0, 10) : new THREE.BoxGeometry(r * 2, y1 - y0, r * 2);
  g.translate(x, (y0 + y1) / 2, z);
  parts.push(colored(g, col));
}
// Band entlang der Spannweite zwischen zwei Querlagen (oben/unten), für Fahrbahnplatte, Brüstung, Bogen
function strip(parts, P, off, yTop, yBot, col) {
  const pos = [], idx = [];
  for (let k = 0; k < P.length; k++) {
    const p = P[k];
    for (const [o, side] of [[off[0], 0], [off[1], 1]]) {
      const x = p.x + p.nx * o, z = p.z + p.nz * o;
      pos.push(x, yTop(k, side), z, x, yBot(k, side), z);
    }
  }
  // je Punkt 4 Ecken: links oben, links unten, rechts oben, rechts unten
  for (let k = 0; k < P.length - 1; k++) {
    const a = k * 4, b = a + 4;
    idx.push(a, b, a + 2, a + 2, b, b + 2);           // oben
    idx.push(a + 1, a + 3, b + 1, a + 3, b + 3, b + 1); // unten
    idx.push(a, a + 1, b, a + 1, b + 1, b);           // Seite links
    idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3); // Seite rechts
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  parts.push(colored(ng, col));
}

export class Bridges {
  constructor(scene) {
    this.scene = scene;
    this.mat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }), { snow: 0.8 });
    this.mesh = null;
    this.net = null;
    this.count = 0;
  }

  reset() { if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; } GRID = new Map(); this.net = null; }

  build(net) {
    if (net === this.net) return;
    this.reset();
    this.net = net;
    const parts = [];
    const grid = new Map();
    for (const sp of net.spans) {
      const c = sp.c, P = [];
      for (let q = sp.a; q <= sp.b; q++) {
        const [x, z] = c.pts[q], [px, pz] = c.pts[Math.max(sp.a, q - 1)], [qx, qz] = c.pts[Math.min(sp.b, q + 1)];
        let dx = qx - px, dz = qz - pz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        P.push({ x, z, y: c.prof[q], nx: -dz, nz: dx, s: c.s[q] - c.s[sp.a] });
      }
      if (P.length < 2) continue;
      const len = P[P.length - 1].s, hw = c.hw;
      // Höhenraster für roadY
      for (let k = 0; k < P.length - 1; k++) {
        const a = P[k], b = P[k + 1], seg = [a.x, a.z, b.x, b.z, a.y, b.y, hw + 0.06];
        for (let gz = Math.floor(Math.min(a.z, b.z) - hw + NY / 2); gz <= Math.floor(Math.max(a.z, b.z) + hw + NY / 2); gz++)
          for (let gx = Math.floor(Math.min(a.x, b.x) - hw + NX / 2); gx <= Math.floor(Math.max(a.x, b.x) + hw + NX / 2); gx++) {
            const i = gz * NX + gx;
            (grid.get(i) || grid.set(i, []).get(i)).push(seg);
          }
      }
      const kind = sp.lvl <= 1 ? 'holz' : sp.lvl === 2 ? 'stein' : sp.era >= 7 ? 'beton' : 'eisen';
      const S = STYLE[kind];
      const W = hw + 0.07;                       // halbe Brückenbreite
      const th = kind === 'stein' ? 0.07 : 0.045;  // Plattendicke
      const bed = k => Math.min(P[k].y - th - 0.02, groundY(P[k].x, P[k].z) - 0.08);
      // Fahrbahnplatte
      strip(parts, P, [-W, W], k => P[k].y + 0.015, k => P[k].y - th, S.deck);
      if (kind === 'holz') {
        // Längsträger unter den Planken, Pfahljoche im Fluss, Geländer aus Pfosten und Holm
        strip(parts, P, [-W * 0.75, -W * 0.55], k => P[k].y - th, k => P[k].y - th - 0.05, S.beam);
        strip(parts, P, [W * 0.55, W * 0.75], k => P[k].y - th, k => P[k].y - th - 0.05, S.beam);
        const nJ = Math.max(1, Math.round(len / 0.55));
        for (let j = 1; j < nJ; j++) {
          const k = Math.round((j / nJ) * (P.length - 1)), p = P[k];
          for (const o of [-W * 0.65, W * 0.65]) post(parts, p.x + p.nx * o, bed(k), p.y - th, p.z + p.nz * o, 0.022, S.post, true);
          beam(parts, new THREE.Vector3(p.x - p.nx * W * 0.7, p.y - th - 0.06, p.z - p.nz * W * 0.7), new THREE.Vector3(p.x + p.nx * W * 0.7, p.y - th - 0.06, p.z + p.nz * W * 0.7), 0.03, 0.03, S.beam);
        }
        for (const side of [-1, 1]) {
          for (let k = 0; k < P.length; k += Math.max(1, Math.round(P.length / Math.max(2, len / 0.24)))) {
            const p = P[k];
            post(parts, p.x + p.nx * W * side * 0.95, p.y, p.y + 0.11, p.z + p.nz * W * side * 0.95, 0.012, S.post);
          }
          strip(parts, P, side < 0 ? [-W * 0.99, -W * 0.92] : [W * 0.92, W * 0.99], k => P[k].y + 0.115, k => P[k].y + 0.09, S.rail);
        }
      } else if (kind === 'stein') {
        // gemauerter Bogen: unten folgt die Bogenlinie vom Ufer zur Mitte, Brüstung mit Abdeckung
        const n = P.length - 1;
        strip(parts, P, [-W, W], k => P[k].y - th, k => { const u = k / n, g = groundY(P[k].x, P[k].z) - 0.1; const top = P[k].y - th - 0.03; return g + (top - g) * Math.pow(Math.sin(u * Math.PI), 0.45); }, S.beam);
        for (const side of [-1, 1]) {
          strip(parts, P, side < 0 ? [-W, -W + 0.045] : [W - 0.045, W], k => P[k].y + 0.085, k => P[k].y, S.post);
          strip(parts, P, side < 0 ? [-W - 0.008, -W + 0.053] : [W - 0.053, W + 0.008], k => P[k].y + 0.1, k => P[k].y + 0.085, S.rail);
        }
        // Widerlager an beiden Enden
        for (const k of [0, n]) { const p = P[k]; post(parts, p.x, groundY(p.x, p.z) - 0.1, p.y - th, p.z, W * 0.9, S.beam); }
      } else if (kind === 'eisen') {
        // Fachwerk: Obergurt, Pfosten und Streben auf beiden Seiten, Querverband oben, Widerlager aus Stein
        const H = 0.2, n = P.length - 1, m = Math.max(2, Math.round(len / 0.3));
        for (const side of [-1, 1]) {
          const at = (k, y) => new THREE.Vector3(P[k].x + P[k].nx * W * side, P[k].y + y, P[k].z + P[k].nz * W * side);
          strip(parts, P, side < 0 ? [-W - 0.012, -W + 0.012] : [W - 0.012, W + 0.012], k => P[k].y + 0.03, k => P[k].y - 0.01, S.beam);
          strip(parts, P, side < 0 ? [-W - 0.012, -W + 0.012] : [W - 0.012, W + 0.012], k => P[k].y + H + 0.012, k => P[k].y + H - 0.012, S.beam);
          for (let j = 0; j <= m; j++) {
            const k = Math.round((j / m) * n);
            beam(parts, at(k, 0.0), at(k, H), 0.018, 0.018, S.post);
            if (j < m) { const k2 = Math.round(((j + 1) / m) * n); beam(parts, j % 2 ? at(k, 0) : at(k, H), j % 2 ? at(k2, H) : at(k2, 0), 0.014, 0.014, S.post); }
          }
        }
        for (let j = 1; j < m; j++) { const k = Math.round((j / m) * n), p = P[k]; beam(parts, new THREE.Vector3(p.x - p.nx * W, p.y + H, p.z - p.nz * W), new THREE.Vector3(p.x + p.nx * W, p.y + H, p.z + p.nz * W), 0.014, 0.014, S.rail); }
        for (const k of [0, n]) { const p = P[k]; post(parts, p.x, groundY(p.x, p.z) - 0.1, p.y - th, p.z, W * 0.95, STYLE.stein.beam); }
      } else {
        // Beton: Plattenbalken, runde Pfeiler im Fluss, schlankes Geländer
        const n = P.length - 1;
        strip(parts, P, [-W * 0.7, W * 0.7], k => P[k].y - th, k => P[k].y - th - 0.05, S.beam);
        const nP = Math.max(1, Math.round(len / 1.1));
        for (let j = 1; j < nP + 1; j++) {
          const k = Math.round((j / (nP + 1)) * n), p = P[k];
          post(parts, p.x, bed(k), p.y - th - 0.05, p.z, 0.05, S.post, true);
        }
        for (const side of [-1, 1]) {
          for (let k = 0; k <= n; k += Math.max(1, Math.round(n / Math.max(2, len / 0.2)))) { const p = P[k]; post(parts, p.x + p.nx * W * side * 0.96, p.y, p.y + 0.09, p.z + p.nz * W * side * 0.96, 0.007, S.rail); }
          strip(parts, P, side < 0 ? [-W * 0.99, -W * 0.93] : [W * 0.93, W * 0.99], k => P[k].y + 0.1, k => P[k].y + 0.085, S.rail);
        }
        for (const k of [0, n]) { const p = P[k]; post(parts, p.x, groundY(p.x, p.z) - 0.1, p.y - th, p.z, W * 0.9, S.beam); }
      }
    }
    GRID = grid;
    this.count = net.spans.length;
    if (!parts.length) return;
    const g = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.scene.add(this.mesh);
  }
}
