// Wahrzeichen der Welt für die Stadtansicht "Erde heute" (seit 26.10.2026, PLAN_ERDE_HEUTE.md). Eigene Modelle im
// Stil des Spiels (Tiny Glade, Miniatur Diorama): weiche Formen, Pastell, viele kleine Glieder, echte Maße in Metern.
// Reines ES Modul ohne DOM. buildLandmark(key) liefert { geo, glow, h, r, w, d, front }:
//   geo   nicht indizierte BufferGeometry mit position, normal, color (Vertexfarben linear, keine Texturen, kein uv)
//   glow  gleiche Art Geometrie für Teile, die nachts leuchten (Fenster, Lichter, Lichtbänder, Laternen) oder null.
//         Die Vertexfarbe ist die Lichtfarbe. Unter jedem Glühteil liegt im geo eine feste Fläche mit der Tagesfarbe,
//         das Glühteil also nur nachts zeigen (oder mit uNight abblenden).
//   h Gesamthöhe, w und d Ausdehnung in x und z, r Radius des Grundrisses (größter Abstand von der Mitte), alles in Metern
//   front Richtung der Schauseite, meist '-z'; bei Kirchen und Domen mit Fassade an der Stirnseite '-x'
// Einheit Meter, Boden bei y = 0, Mitte des Grundrisses im Ursprung, längste waagerechte Achse auf x.
// Brücken: Fahrbahn auf x, Mitte im Ursprung, Wasser bei y = 0, Pfeiler bis y = 0.
import * as THREE from 'three';
import { roundBox } from '../render/shapes.js';

const PI = Math.PI, TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// ---------- Farben (Pastell wie src/render/buildings.js) ----------
const C = {
  stone: '#e4d7bf', stone2: '#dccdb1', stone3: '#cfc0a4', sand: '#e8d6ae', lime: '#ece3cf', marble: '#f3efe6', white: '#f5f3ee',
  cream: '#efe6d2', concrete: '#dcd9d2', grey: '#b9bdc2', dgrey: '#80878f', steel: '#c9d1d8', silver: '#d8dde2',
  copper: '#88bba3', copperD: '#6f9e88', gold: '#e8c15c', goldD: '#c9a246', brick: '#c4664f', brick2: '#b3583f', terra: '#cc6d4e',
  slate: '#6f7d92', slate2: '#808ea3', slateD: '#5c6878', lead: '#8f9aa8', glass: '#a6c3d1', glassD: '#5d7180', win: '#5a6a79',
  red: '#cd4a37', verm: '#d8583e', wood: '#8a6a4c', dwood: '#5e4634', black: '#3c3b3e', green: '#6f9a6a', rose: '#d98b9f',
  tile: '#5f6874', tileL: '#6d7783', plaster: '#f1eee6',
  lit: '#ffd59a', litW: '#fff2da', litB: '#dff1ff', litR: '#ff4636', litG: '#ffcf70', litBlue: '#4d7ff0',
};
const CC = new Map();
function colOf(c) {
  if (c && c.isColor) return c;
  let v = CC.get(c);
  if (!v) { v = new THREE.Color(c); CC.set(c, v); }
  return v;
}
// Farbe heller (f > 1) oder dunkler (f < 1)
const shade = (hex, f) => '#' + new THREE.Color(hex).multiplyScalar(f).getHexString();
const mix = (a, b, t) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();

// Lage: Matrix aus Verschiebung, Drehung (Grad nicht, Bogenmaß) und Maßstab
function T(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();
const v3 = (p) => (p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2]));

// ---------- Baukasten ----------
// Sammelt Dreiecke direkt in Feldern (fest und glühend). at(m, fn) legt eine Lage um alles, was fn baut; Spiegeln dreht
// die Dreiecke selbst um, damit die Normalen nach außen zeigen.
class K {
  constructor() {
    this.S = { p: [], n: [], c: [] }; this.G = { p: [], n: [], c: [] };
    this.M = new THREE.Matrix4(); this.NM = new THREE.Matrix3(); this.flip = false;
  }
  _set(M) { this.M = M; this.NM.getNormalMatrix(M); this.flip = M.determinant() < 0; }
  at(m, fn) { const prev = this.M; this._set(prev.clone().multiply(m)); fn(); this._set(prev); }
  // fn zweimal: normal und an der Ebene x = 0 gespiegelt (für symmetrische Bauten)
  mirX(fn) { fn(1); this.at(new THREE.Matrix4().makeScale(-1, 1, 1), () => fn(-1)); }
  mirZ(fn) { fn(1); this.at(new THREE.Matrix4().makeScale(1, 1, -1), () => fn(-1)); }
  mirXZ(fn) { this.mirX(sx => this.mirZ(sz => fn(sx, sz))); }
  // n mal um die Hochachse verteilt
  around(n, fn, a0 = 0) { for (let i = 0; i < n; i++) this.at(T(0, 0, 0, a0 + i * TAU / n), () => fn(i)); }

  // ein Dreieck in lokalen Koordinaten, Farbe c (oder Funktion), flache Normale
  tri(a, b, c, col, o = {}) {
    const B = o.glow ? this.G : this.S;
    _a.set(a[0], a[1], a[2]).applyMatrix4(this.M); _b.set(b[0], b[1], b[2]).applyMatrix4(this.M); _c.set(c[0], c[1], c[2]).applyMatrix4(this.M);
    if (this.flip) { const t = _b.clone(); _b.copy(_c); _c.copy(t); }
    _e1.subVectors(_b, _a); _e2.subVectors(_c, _a); _n.crossVectors(_e1, _e2);
    const L = _n.length(); if (L < 1e-12) return;
    _n.multiplyScalar(1 / L);
    const cc = colOf(typeof col === 'function' ? col((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3, _n.x, _n.y, _n.z) : col);
    for (const v of [_a, _b, _c]) { B.p.push(v.x, v.y, v.z); B.n.push(_n.x, _n.y, _n.z); B.c.push(cc.r, cc.g, cc.b); }
  }
  // Viereck a b c d gegen den Uhrzeigersinn von außen gesehen
  quad(a, b, c, d, col, o) { this.tri(a, b, c, col, o); this.tri(a, c, d, col, o); }

  // ebenes Vieleck (konvex, als Fächer), Außenseite zeigt zur Richtung hint
  face(pts, col, hint, o = {}) {
    const P = pts.map(v3), n = new THREE.Vector3();
    for (let i = 1; i < P.length - 1; i++) n.add(new THREE.Vector3().subVectors(P[i], P[0]).cross(new THREE.Vector3().subVectors(P[i + 1], P[0])));
    const rev = n.dot(v3(hint)) < 0;
    for (let i = 1; i < P.length - 1; i++) {
      const a = pts[0], b = pts[i], c = pts[i + 1];
      rev ? this.tri(a, c, b, col, o) : this.tri(a, b, c, col, o);
    }
  }
  // Platte mit Dicke: Oberseite pts (konvex), um th nach unten, Kanten rundum, Unterseite in Farbe under
  slab(pts, th, col, o = {}) {
    const top = pts.map(p => [...p]), bot = pts.map(p => [p[0], p[1] - th, p[2]]);
    this.face(top, col, [0, 1, 0], o); this.face(bot, o.under || col, [0, -1, 0], o);
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[2], 0) / pts.length;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length, mx = (pts[i][0] + pts[j][0]) / 2 - cx, mz = (pts[i][2] + pts[j][2]) / 2 - cz;
      this.face([top[i], top[j], bot[j], bot[i]], o.edge || col, [mx, 0, mz], o);
    }
  }
  // fertige THREE Geometrie übernehmen (Normalen bleiben weich, außer o.flat)
  geo(g, col, o = {}) {
    if (g.index) { const n = g.toNonIndexed(); g.dispose(); g = n; }
    if (!g.attributes.normal || o.flat) g.computeVertexNormals();
    const P = g.attributes.position.array, N = g.attributes.normal.array;
    const B = o.glow ? this.G : this.S, cf = typeof col === 'function' ? col : null, c0 = cf ? null : colOf(col);
    const ord = this.flip ? [0, 2, 1] : [0, 1, 2];
    for (let t = 0; t < P.length; t += 9) {
      let cc = c0;
      if (cf) {
        _e1.set(P[t + 3] - P[t], P[t + 4] - P[t + 1], P[t + 5] - P[t + 2]); _e2.set(P[t + 6] - P[t], P[t + 7] - P[t + 1], P[t + 8] - P[t + 2]);
        _n.crossVectors(_e1, _e2).normalize();
        cc = colOf(cf((P[t] + P[t + 3] + P[t + 6]) / 3, (P[t + 1] + P[t + 4] + P[t + 7]) / 3, (P[t + 2] + P[t + 5] + P[t + 8]) / 3, _n.x, _n.y, _n.z));
      }
      for (const kk of ord) {
        const i = t + kk * 3;
        _a.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(this.M);
        _n.set(N[i], N[i + 1], N[i + 2]).applyMatrix3(this.NM).normalize();
        B.p.push(_a.x, _a.y, _a.z); B.n.push(_n.x, _n.y, _n.z); B.c.push(cc.r, cc.g, cc.b);
      }
    }
    g.dispose();
  }

  // ----- Grundformen, y ist immer die Unterkante -----
  box(w, h, d, x, y, z, col, o = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (o.rz) g.rotateZ(o.rz); if (o.rx) g.rotateX(o.rx); if (o.ry) g.rotateY(o.ry);
    g.translate(x, y + h / 2, z); this.geo(g, col, o);
  }
  // Kasten mit runden Kanten (Ton Look)
  rbox(w, h, d, r, x, y, z, col, o = {}) {
    const g = roundBox(w, h, d, r, o.seg || 1);
    if (o.ry) g.rotateY(o.ry);
    g.translate(x, y + h / 2, z); this.geo(g, col, o);
  }
  cyl(rt, rb, h, x, y, z, col, o = {}) {
    const g = new THREE.CylinderGeometry(rt, rb, h, o.seg || 16, 1, !!o.open, o.t0 || 0, o.tl || TAU);
    if (o.ry) g.rotateY(o.ry);
    g.translate(x, y + h / 2, z); this.geo(g, col, o);
  }
  cone(r, h, x, y, z, col, o = {}) { this.cyl(0, r, h, x, y, z, col, o); }
  // Kugel mit Mitte (x, y, z); o.t0/o.tl schneiden sie zur Kuppel, o.sy staucht in der Höhe
  ball(r, x, y, z, col, o = {}) {
    const g = new THREE.SphereGeometry(r, o.ws || 16, o.hs || 10, 0, TAU, o.t0 || 0, o.tl || PI);
    if (o.sy) g.scale(1, o.sy, 1); if (o.sx) g.scale(o.sx, 1, o.sz || o.sx);
    g.translate(x, y, z); this.geo(g, col, o);
  }
  ico(r, x, y, z, col, det = 1, o = {}) { const g = new THREE.IcosahedronGeometry(r, det); if (o.sy) g.scale(1, o.sy, 1); g.translate(x, y, z); this.geo(g, col, { flat: true, ...o }); }
  // Drehkörper aus Profil [[r, y], ...] von unten nach oben
  lathe(pts, x, y, z, col, o = {}) {
    const g = new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(Math.max(r, 0), h)), o.seg || 24, o.p0 || 0, o.pl || TAU);
    if (o.ry) g.rotateY(o.ry);
    g.translate(x, y, z); this.geo(g, col, o);
  }
  // Fläche aus Ringen gleicher Punktzahl. Ringe gegen den Uhrzeigersinn (von +x nach +z) und von innen nach außen,
  // unten nach oben oder als Dach nach innen oben: dann zeigt die Außenseite nach außen. o.cfi(i, j, n) färbt je Feld.
  loft(rings, col, o = {}) {
    const R = rings.length, N = rings[0].length, closed = !o.open, segs = closed ? N : N - 1;
    const P = rings.map(r => r.map(v3));
    const smooth = !!o.smooth, vn = smooth ? P.map(r => r.map(() => new THREE.Vector3())) : null;
    const faces = [];
    for (let i = 0; i < R - 1; i++) for (let j = 0; j < segs; j++) {
      const j2 = (j + 1) % N;
      const ia = [i, j], ib = [i, j2], ic = [i + 1, j2], id = [i + 1, j];
      const tris = o.inv ? [[ia, ib, ic], [ia, ic, id]] : [[ia, id, ic], [ia, ic, ib]];
      for (const t of tris) {
        const A = P[t[0][0]][t[0][1]], B2 = P[t[1][0]][t[1][1]], Cc = P[t[2][0]][t[2][1]];
        const fn = new THREE.Vector3().subVectors(B2, A).cross(new THREE.Vector3().subVectors(Cc, A));
        if (fn.lengthSq() < 1e-14) continue;
        if (smooth) for (const q of t) vn[q[0]][q[1]].add(fn);
        faces.push({ t, fn: fn.normalize(), i, j });
      }
    }
    const B = o.glow ? this.G : this.S;
    for (const f of faces) {
      const cc = colOf(o.cfi ? o.cfi(f.i, f.j, f.fn) : typeof col === 'function' ? col(P[f.t[0][0]][f.t[0][1]].x, P[f.t[0][0]][f.t[0][1]].y, P[f.t[0][0]][f.t[0][1]].z, f.fn.x, f.fn.y, f.fn.z) : col);
      const ord = this.flip ? [0, 2, 1] : [0, 1, 2];
      for (const kk of ord) {
        const q = f.t[kk], p = P[q[0]][q[1]];
        _a.copy(p).applyMatrix4(this.M);
        _n.copy(smooth ? vn[q[0]][q[1]] : f.fn).applyMatrix3(this.NM).normalize();
        B.p.push(_a.x, _a.y, _a.z); B.n.push(_n.x, _n.y, _n.z); B.c.push(cc.r, cc.g, cc.b);
      }
    }
    // Deckel
    const cap = (ring, up) => {
      const c = ring.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / ring.length);
      for (let j = 0; j < (closed ? N : N - 1); j++) {
        const a = ring[j], b = ring[(j + 1) % N];
        if (up) this.tri([c.x, c.y, c.z], [b.x, b.y, b.z], [a.x, a.y, a.z], o.capCol || col, o);
        else this.tri([c.x, c.y, c.z], [a.x, a.y, a.z], [b.x, b.y, b.z], o.capCol || col, o);
      }
    };
    if (o.capTop) cap(P[R - 1], true);
    if (o.capBot) cap(P[0], false);
  }
  // Balken mit Rechteckquerschnitt von a nach b; w Zahl oder [breit, hoch], o.up legt die zweite Achse fest
  beam(a, b, w, col, o = {}) {
    const A = v3(a), Bv = v3(b), dir = new THREE.Vector3().subVectors(Bv, A); const L = dir.length(); if (L < 1e-6) return;
    dir.multiplyScalar(1 / L);
    const ref = o.up ? v3(o.up) : Math.abs(dir.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(dir, ref).normalize(), v = new THREE.Vector3().crossVectors(u, dir);
    const [w1, w2] = Array.isArray(w) ? w : [w, w];
    const ring = (E) => [[1, -1], [1, 1], [-1, 1], [-1, -1]].map(([s, t]) => E.clone().addScaledVector(u, s * w1 / 2).addScaledVector(v, t * w2 / 2));
    this.loft([ring(A), ring(Bv)], col, { ...o, smooth: false, capTop: !!o.caps, capBot: !!o.caps });
  }
  // runde Röhre von a nach b
  tube(a, b, r, col, o = {}) {
    const A = v3(a), Bv = v3(b), dir = new THREE.Vector3().subVectors(Bv, A); const L = dir.length(); if (L < 1e-6) return;
    const g = new THREE.CylinderGeometry(o.r2 ?? r, r, L, o.seg || 6, 1, !o.caps);
    g.translate(0, L / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
    g.translate(A.x, A.y, A.z); this.geo(g, col, o);
  }
  // Röhre entlang einer Punktfolge
  path(pts, r, col, o = {}) { for (let i = 0; i < pts.length - 1; i++) (o.square ? this.beam(pts[i], pts[i + 1], r * 2, col, o) : this.tube(pts[i], pts[i + 1], r, col, o)); }
  // Umriss in der xy Ebene (mit Löchern) um depth in z ausgezogen, mittig in z; o.ry dreht, o.x/y/z verschiebt
  ext(outer, holes, depth, col, o = {}) {
    const sh = new THREE.Shape(outer.map(p => new THREE.Vector2(p[0], p[1])));
    for (const h of holes || []) sh.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1]))));
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: !!o.bev, bevelThickness: o.bev || 0, bevelSize: o.bev || 0, bevelSegments: 1, curveSegments: o.cs || 6, steps: 1 });
    g.deleteAttribute('uv');
    g.translate(0, 0, -depth / 2);
    if (o.rx) g.rotateX(o.rx); if (o.ry) g.rotateY(o.ry);
    g.translate(o.x || 0, o.y || 0, o.z || 0); this.geo(g, col, { ...o, flat: true });
  }
  // flache Platte (einseitig) mit Umriss pts2 [[u, v]] in der Ebene durch c mit waagerechter Außennormale n
  plate(c, n, pts2, col, o = {}) {
    const nx = n[0], nz = n[1], tx = nz, tz = -nx;
    const P = pts2.map(([u, v]) => [c[0] + tx * u + nx * (o.off || 0), c[1] + v, c[2] + tz * u + nz * (o.off || 0)]);
    const tris = THREE.ShapeUtils.triangulateShape(pts2.map(([u, v]) => new THREE.Vector2(u, v)), []);
    for (const [a, b, d] of tris) {
      const cr = (pts2[b][0] - pts2[a][0]) * (pts2[d][1] - pts2[a][1]) - (pts2[b][1] - pts2[a][1]) * (pts2[d][0] - pts2[a][0]);
      cr > 0 ? this.tri(P[a], P[b], P[d], col, o) : this.tri(P[a], P[d], P[b], col, o);
    }
  }
  // Rechteck in einer senkrechten Ebene: Mitte c, Außennormale n = [nx, nz], halbe Breite a, halbe Höhe b
  panel(c, n, a, b, col, o = {}) { this.plate(c, n, [[-a, -b], [a, -b], [a, b], [-a, b]], col, o); }

  done(o = {}) {
    if (o.center) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const B of [this.S, this.G]) for (let i = 0; i < B.p.length; i += 3) { x0 = Math.min(x0, B.p[i]); x1 = Math.max(x1, B.p[i]); z0 = Math.min(z0, B.p[i + 2]); z1 = Math.max(z1, B.p[i + 2]); }
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      for (const B of [this.S, this.G]) for (let i = 0; i < B.p.length; i += 3) { B.p[i] -= cx; B.p[i + 2] -= cz; }
    }
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = 0, r = 0;
    for (const B of [this.S, this.G]) for (let i = 0; i < B.p.length; i += 3) {
      const x = B.p[i], y = B.p[i + 1], z = B.p[i + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; if (y > y1) y1 = y;
      const q = x * x + z * z; if (q > r) r = q;
    }
    const mk = B => {
      if (!B.p.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
      g.computeBoundingBox(); g.computeBoundingSphere();
      return g;
    };
    return { geo: mk(this.S), glow: mk(this.G), h: y1, w: x1 - x0, d: z1 - z0, r: Math.sqrt(r), front: o.front || '-z' };
  }
}

// ---------- Hilfen für Umrisse ----------
// Bogenpunkte um (cx, cy) mit Radius r von Winkel a0 bis a1 (n Schritte, beide Enden)
function arc(cx, cy, r, a0, a1, n = 8, ry = r) { const o = []; for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * ry]); } return o; }
// Öffnung mit Rundbogen (Breite w, Unterkante y0, Kämpfer ys) gegen den Uhrzeigersinn
function archHole(cx, w, y0, ys, n = 8, kind = 'round') {
  const h = w / 2;
  if (kind === 'pointed') {
    const pts = [[cx - h, y0], [cx + h, y0], [cx + h, ys]];
    const r = w * 0.85; // Spitzbogen aus zwei Kreisen
    const a0 = 0, a1 = Math.acos((r - h) / r);
    for (let i = 1; i <= n; i++) { const a = lerp(a0, a1, i / n); pts.push([cx + h - r + Math.cos(a) * r, ys + Math.sin(a) * r]); }
    for (let i = n - 1; i >= 1; i--) { const a = lerp(a0, a1, i / n); pts.push([cx - h + r - Math.cos(a) * r, ys + Math.sin(a) * r]); }
    pts.push([cx - h, ys]);
    return pts;
  }
  if (kind === 'flat') return [[cx - h, y0], [cx + h, y0], [cx + h, ys], [cx - h, ys]];
  return [[cx - h, y0], [cx + h, y0], ...arc(cx, ys, h, 0, PI, n).slice(0, -1), [cx - h, ys]];
}
// Rechteckring (für loft) mit ns Punkten je Seite, gegen den Uhrzeigersinn
function rectRing(hx, hz, y, ns = 1, f = null) {
  const out = [];
  for (let s = 0; s < 4; s++) for (let i = 0; i < ns; i++) {
    const t = -1 + 2 * i / ns;
    let x, z;
    if (s === 0) { x = hx; z = t * hz; } else if (s === 1) { x = -t * hx; z = hz; } else if (s === 2) { x = -hx; z = -t * hz; } else { x = t * hx; z = -hz; }
    out.push(f ? f(x, y, z, Math.abs(t), s) : [x, y, z]);
  }
  return out;
}
// Kreisring (n Punkte) gegen den Uhrzeigersinn, Phase a0
function circRing(r, y, n, a0 = 0, rz = r) { const o = []; for (let i = 0; i < n; i++) { const a = a0 + i * TAU / n; o.push([Math.cos(a) * r, y, Math.sin(a) * rz]); } return o; }
// Vieleck als 2D Umriss
function ngon(r, n, a0 = 0) { const o = []; for (let i = 0; i < n; i++) { const a = a0 + i * TAU / n; o.push([Math.cos(a) * r, Math.sin(a) * r]); } return o; }

// Extrudierte Geometrie (ohne sie hinzuzufügen) für viele Kopien mit k.at(...) und k.geo(g.clone(), ...)
function extGeo(outer, holes, depth, cs = 6) {
  const sh = new THREE.Shape(outer.map(p => new THREE.Vector2(p[0], p[1])));
  for (const h of holes || []) sh.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1]))));
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: cs, steps: 1 });
  g.deleteAttribute('uv'); g.translate(0, 0, -depth / 2);
  const n = g.index ? g.toNonIndexed() : g; if (n !== g) g.dispose(); n.computeVertexNormals();
  return n;
}
// ---------- wiederkehrende Bauteile ----------
// Säule: Schaft mit leichter Verjüngung, Wulst, Deckplatte. kind 'doric' | 'ionic' | 'corinth'
function column(k, x, y, z, h, r, col, o = {}) {
  const seg = o.seg || 12, base = o.base ?? (o.kind !== 'doric');
  let y0 = y;
  if (base) { k.cyl(r * 1.3, r * 1.38, r * 0.5, x, y0, z, col, { seg }); y0 += r * 0.5; }
  const hc = o.kind === 'corinth' ? r * 1.6 : r * 0.7;
  k.cyl(r * 0.84, r, h - (y0 - y) - hc - r * 0.35, x, y0, z, col, { seg, open: true });
  const yc = y + h - hc - r * 0.35;
  if (o.kind === 'corinth') { k.cyl(r * 1.35, r * 0.86, hc, x, yc, z, o.cap || col, { seg }); }
  else k.cyl(r * 1.3, r * 0.86, hc, x, yc, z, o.cap || col, { seg });
  k.box(r * 2.7, r * 0.35, r * 2.7, x, y + h - r * 0.35, z, o.cap || col);
}
// Fenster in einer senkrechten Wand: fester dunkler Grund (Tag) plus Scheibe im Glühteil, optional Rahmen und Bogen
function win(k, c, n, w, h, o = {}) {
  const kind = o.kind || 'rect', a = w / 2;
  const shape = kind === 'arch' ? archHole(0, w, -h / 2, h / 2 - a, 5) : kind === 'pointed' ? archHole(0, w, -h / 2, h / 2 - a * 1.5, 4, 'pointed') : [[-a, -h / 2], [a, -h / 2], [a, h / 2], [-a, h / 2]];
  k.plate(c, n, shape, o.col || C.win, { off: o.off ?? 0.08 });
  if (o.lit !== false) k.plate(c, n, shape.map(([u, v]) => [u * 0.92, v * 0.95]), o.lc || C.lit, { off: (o.off ?? 0.08) + 0.12, glow: true });
  if (o.frame) {
    const fc = o.frame, t = o.ft || Math.max(0.15, w * 0.1), [nx, nz] = n, tx = nz, tz = -nx, q = a + t * 1.2;
    const P = (u, v, off) => [c[0] + tx * u + nx * off, c[1] + v, c[2] + tz * u + nz * off];
    k.beam(P(-q, -h / 2 - t / 2, t * 0.6), P(q, -h / 2 - t / 2, t * 0.6), [t * 1.3, t], fc, { up: [0, 1, 0], caps: true });
    if (kind === 'rect') k.beam(P(-q, h / 2 + t / 2, t * 0.5), P(q, h / 2 + t / 2, t * 0.5), [t, t], fc, { up: [0, 1, 0], caps: true });
  }
}
// Fensterreihen auf einer Fassade: Mitte der Fassade c (am Boden), Außennormale n, Länge L, Reihen in ys, je Reihe nx Fenster
function facade(k, c, n, L, ys, cnt, w, h, o = {}) {
  const tx = n[1], tz = -n[0];
  for (const y of ys) for (let i = 0; i < cnt; i++) {
    const u = (i - (cnt - 1) / 2) * (L / cnt);
    if (o.skip && o.skip(u, y, i)) continue;
    win(k, [c[0] + tx * u, c[1] + y, c[2] + tz * u], n, w, h, o);
  }
}
// Fenster auf allen vier Seiten eines Kastens (Mitte x, z, halbe Maße hx, hz)
function boxWindows(k, x, z, hx, hz, ys, sp, w, h, o = {}) {
  const nX = Math.max(1, Math.floor(2 * hx / sp)), nZ = Math.max(1, Math.floor(2 * hz / sp));
  facade(k, [x, 0, z - hz], [0, -1], 2 * hx, ys, nX, w, h, o);
  facade(k, [x, 0, z + hz], [0, 1], 2 * hx, ys, nX, w, h, o);
  facade(k, [x + hx, 0, z], [1, 0], 2 * hz, ys, nZ, w, h, o);
  facade(k, [x - hx, 0, z], [-1, 0], 2 * hz, ys, nZ, w, h, o);
}
// Gesims rund um einen Kasten
function cornice(k, x, z, w, d, y, h, p, col) { k.box(w + 2 * p, h, d + 2 * p, x, y, z, col); }
// Gesims nur entlang der Außenkanten (für Bauten mit Innenhöfen), Tiefe t
function corniceRing(k, x, z, w, d, y, h, p, col, t = 3) {
  k.box(w + 2 * p, h, t + p, x, y, z - d / 2 + (t - p) / 2, col); k.box(w + 2 * p, h, t + p, x, y, z + d / 2 - (t - p) / 2, col);
  k.box(t + p, h, d - 2 * t + 2 * p, x - w / 2 + (t - p) / 2, y, z, col); k.box(t + p, h, d - 2 * t + 2 * p, x + w / 2 - (t - p) / 2, y, z, col);
}
// Lisenen (flache Pfeiler) auf allen Seiten eines Kastens
function pilasters(k, x, z, hx, hz, y0, h, sp, t, col, o = {}) {
  const nX = Math.max(1, Math.round(2 * hx / sp)), nZ = Math.max(1, Math.round(2 * hz / sp));
  for (let i = 0; i <= nX; i++) { const u = x - hx + i * 2 * hx / nX; if (o.skipX && o.skipX(u)) continue; k.box(t, h, t * 0.6, u, y0, z - hz - t * 0.3, col); if (!o.front) k.box(t, h, t * 0.6, u, y0, z + hz + t * 0.3, col); }
  if (!o.noSides) for (let i = 0; i <= nZ; i++) { const u = z - hz + i * 2 * hz / nZ; k.box(t * 0.6, h, t, x - hx - t * 0.3, y0, u, col); k.box(t * 0.6, h, t, x + hx + t * 0.3, y0, u, col); }
}
// Brüstung mit Pfosten und Handlauf entlang eines Rechtecks
function balustrade(k, x, z, hx, hz, y, h, sp, col) {
  const t = Math.max(0.18, h * 0.16);
  k.box(2 * hx + t, t, t * 1.6, x, y + h - t, z - hz, col); k.box(2 * hx + t, t, t * 1.6, x, y + h - t, z + hz, col);
  k.box(t * 1.6, t, 2 * hz + t, x - hx, y + h - t, z, col); k.box(t * 1.6, t, 2 * hz + t, x + hx, y + h - t, z, col);
  const nX = Math.max(2, Math.round(2 * hx / sp)), nZ = Math.max(2, Math.round(2 * hz / sp));
  for (let i = 0; i <= nX; i++) { const u = x - hx + i * 2 * hx / nX; k.box(t, h - t, t, u, y, z - hz, col); k.box(t, h - t, t, u, y, z + hz, col); }
  for (let i = 1; i < nZ; i++) { const u = z - hz + i * 2 * hz / nZ; k.box(t, h - t, t, x - hx, y, u, col); k.box(t, h - t, t, x + hx, y, u, col); }
}
// Ring aus Säulen
function colRing(k, n, R, y, h, r, col, o = {}) { for (let i = 0; i < n; i++) { const a = (i + (o.ph || 0)) * TAU / n; column(k, Math.cos(a) * R, y, Math.sin(a) * R, h, r, col, o); } }
// gotische Fiale: Schaft und spitzer Helm
function pinnacle(k, x, y, z, h, w, col, o = {}) {
  k.box(w, h * 0.45, w, x, y, z, col);
  k.cyl(0, w * 0.75, h * 0.55, x, y + h * 0.45, z, o.top || col, { seg: 4, ry: PI / 4 });
  if (o.ball) k.ball(w * 0.22, x, y + h, z, o.ball, { ws: 6, hs: 4 });
}
// Zwiebel oder Kuppel als Drehkörper: Basisradius r, Höhe h, Form 'dome' | 'onion' | 'helm' | 'ogive'
function domeProfile(r, h, kind = 'dome', n = 10) {
  const o = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let rr, yy;
    if (kind === 'onion') { yy = t * h; rr = t < 0.42 ? r * (1 + 0.35 * Math.sin(t / 0.42 * PI / 2)) : r * 1.35 * Math.pow(Math.cos((t - 0.42) / 0.58 * PI / 2), 1.6); }
    else if (kind === 'helm') { yy = t * h; rr = r * (t < 0.5 ? 1 + 0.12 * Math.sin(t * PI) : Math.pow(1 - (t - 0.5) * 2, 0.8) * (1 + 0.12 * Math.sin(t * PI))); }
    else if (kind === 'ogive') { const a = t * PI / 2; yy = Math.sin(a) * h; rr = r * Math.pow(Math.cos(a), 0.8); }
    else { const a = t * PI / 2; yy = Math.sin(a) * h; rr = Math.cos(a) * r; }
    o.push([rr, yy]);
  }
  o[o.length - 1][0] = 0;
  return o;
}
// Japanisches oder chinesisches Walmdach mit hohlem Profil und hochgezogenen Ecken. w, d Traufmaß, y Traufhöhe,
// rise Höhe, ridge halbe Firstlänge, gable 0..1 (ab dort Giebel, irimoya), lift Eckhub, th Dicke, wall Wandmaß
function jroof(k, o) {
  const { w, d, y, rise, c, under = C.wood, fascia = shade(c, 0.85), gableC = C.plaster, ns = 8, nt = 7, th = 0.6, lift = 1.2, ridge = 0, gable = 0, tEnd = 1, pow = 1.6 } = o;
  const wall = o.wall || [w * 0.72, d * 0.72];
  const hw = w / 2, hd = d / 2, rx = ridge;
  const ring = (hx, hz, yy, lt, out) => rectRing(hx, hz, yy, ns, (x, y2, z, ct) => { const f = Math.pow(ct, 3); return [x * (1 + out * f), y2 + lt * f, z * (1 + out * f)]; });
  const rings = [ring(wall[0] / 2, wall[1] / 2, y - th * 0.9, 0, 0), ring(hw, hd, y - th, lift, 0.03), ring(hw, hd, y, lift, 0.03)];
  const hxG = gable > 0 ? lerp(hw, rx, gable) : rx;
  for (let i = 1; i <= nt; i++) {
    const t = i / nt * tEnd;
    const hx = gable > 0 ? (t < gable ? lerp(hw, hxG, t / gable) : hxG) : lerp(hw, rx, t);
    const hz = lerp(hd, 0, t);
    rings.push(ring(Math.max(hx, 0.01), Math.max(hz, 0.01), y + rise * Math.pow(t, pow), lift * Math.pow(1 - t, 2), 0.03 * (1 - t)));
  }
  k.loft(rings, c, {
    flat: true, cfi: (i, j, fn) => {
      if (i === 0) return under;
      if (i === 1) return fascia;
      if (Math.abs(fn.y) < 0.3) return gableC;
      return (j % 2) ? c : shade(c, 0.9);
    }
  });
  const yTop = y + rise * Math.pow(tEnd, pow);
  return yTop;
}
// Walmdach über einem Rechteck (w in x, d in z), First entlang der längeren Seite; o.ridge setzt die halbe Firstlänge
function hipRoof(k, x, z, w, d, y, h, col, o = {}) {
  const ov = o.ov ?? 0.6, hx = w / 2 + ov, hz = d / 2 + ov;
  const rx = o.ridge ?? Math.max(0.01, hx - hz), rz = w >= d ? 0.01 : Math.max(0.01, hz - hx);
  const top = w >= d ? [rx, 0.01] : [0.01, o.ridge ?? rz];
  k.loft([rectRing(hx, hz, y), rectRing(top[0], top[1], y + h)].map(r => r.map(([a, b, c]) => [x + a, b, z + c])), col, { flat: true, capBot: true });
}
// Satteldach: Länge L entlang x (oder z bei alongZ), Tiefe D, Höhe h
function gableRoof(k, x, z, L, D, y, h, col, o = {}) {
  const ov = o.ov ?? 0.5;
  k.ext([[-D / 2 - ov, 0], [D / 2 + ov, 0], [0, h]], null, L + 2 * ov * 0.6, col, { ry: o.alongZ ? 0 : PI / 2, x, y, z });
}
// Firstbalken mit Endstücken
function ridgeCap(k, x0, x1, y, t, col, o = {}) {
  k.box(x1 - x0 + t, t, t * 1.1, (x0 + x1) / 2, y - t * 0.3, 0, col);
  if (o.ends) for (const x of [x0, x1]) k.box(t * 1.4, t * 2.2, t * 1.4, x, y - t * 0.3, 0, o.ends);
}
// Gitterturm aus Ringen gleicher Punktzahl: Knoten auf den Ringen, Ringstäbe, Kreuzstreben, Pfosten
function lattice(k, rings, col, o = {}) {
  const R = rings.map(r => r.map(v3)), N = R[0].length, t = o.t || 0.6;
  for (let i = 0; i < R.length; i++) {
    for (let j = 0; j < N; j++) {
      const a = R[i][j], b = R[i][(j + 1) % N];
      if (o.rings !== false) k.beam(a, b, o.tr || t, o.rc ? o.rc(i) : col, o);
      if (i < R.length - 1) {
        const c = R[i + 1][(j + 1) % N], d = R[i + 1][j];
        const cc = o.rc ? o.rc(i) : col;
        if (o.posts !== false) k.beam(a, d, o.tp || t * 1.3, cc, o);
        if (o.diag !== false) { k.beam(a, c, t * 0.8, cc, o); if (o.x !== false) k.beam(b, d, t * 0.8, cc, o); }
      }
    }
  }
}
// Fachwerkfeld zwischen unten a b und oben d c: Kreuz, bei breiten Feldern doppelt mit Mittelpfosten
function trussFace(k, a, b, c, d, col, t, split = false) {
  if (split) {
    const m1 = a.map((v, q) => (v + b[q]) / 2), m2 = d.map((v, q) => (v + c[q]) / 2);
    k.beam(a, m2, t, col); k.beam(m1, d, t, col); k.beam(m1, c, t, col); k.beam(b, m2, t, col); k.beam(m1, m2, t * 0.8, col);
  } else { k.beam(a, c, t, col); k.beam(b, d, t, col); }
}
// Gerade Folge von Punkten entlang einer Kurve f(t) -> [x, y, z]
const curve = (f, n) => { const o = []; for (let i = 0; i <= n; i++) o.push(f(i / n)); return o; };
// Vertex Farbspiel für Steine: hell und dunkel nach Lage
const stoneVar = (base, amt = 0.06, s = 1) => (x, y, z) => shade(base, 1 + amt * (hash(Math.floor(x / s * 1.7 + 100), Math.floor(y / s * 2.3) * 31 + Math.floor(z / s * 1.7)) - 0.5) * 2);

// =====================================================================================================
// Berlin
// =====================================================================================================

// Fernsehturm, 368 m: Betonschaft, Kugel aus Stahlfacetten mit zwei Fensterbändern, rot weiße Antenne, Pavillon mit Faltdach
function fernsehturm() {
  const k = new K();
  // Pavillon: sechs Flügel mit gefalteten Dächern, verglast
  k.around(6, () => {
    const wall = [[44, 0, -6], [44, 0, 6], [15, 0, 8.7], [15, 0, -8.7]];
    k.loft([wall, wall.map(p => [p[0], 7.4, p[2]])], C.glassD, { flat: true });
    // Fensterband mit Licht, Pfosten
    for (const s of [-1, 1]) {
      const a = [44, 0, -6 * s], b = [15, 0, -8.7 * s], nx = (a[2] - b[2]) * -s, nz = (b[0] - a[0]) * -s, L = Math.hypot(nx, nz);
      for (let i = 0; i < 7; i++) {
        const t = (i + 0.5) / 7, p = [lerp(a[0], b[0], t), 3.6, lerp(a[2], b[2], t)];
        k.panel(p, [nx / L * -s * s, nz / L], 1.7, 2.6, C.lit, { off: 0.15, glow: true });
        k.beam([lerp(a[0], b[0], i / 7), 0, lerp(a[2], b[2], i / 7)], [lerp(a[0], b[0], i / 7), 7.4, lerp(a[2], b[2], i / 7)], 0.35, C.white);
      }
    }
    k.panel([44, 3.6, 0], [1, 0], 5, 2.6, C.lit, { off: 0.15, glow: true });
    // Faltdach: zwei geneigte Platten, First steigt nach außen
    const R0 = [13, 9.4, 0], R1 = [47, 14.2, 0];
    for (const s of [-1, 1]) k.slab([[13, 7.6, 10 * s], [47, 7.6, 7.6 * s], R1, R0], 0.45, C.white, { under: C.concrete, edge: C.concrete });
    k.face([[47, 7.6, -7.6], [47, 7.6, 7.6], R1], C.concrete, [1, 0, 0]);
  }, 0);
  // Schaft (hohl nach oben), leicht geschwungen
  const prof = [];
  for (let i = 0; i <= 14; i++) { const y = i / 14 * 252; prof.push([4.7 + 11.3 * Math.pow(1 - y / 252, 1.6), y]); }
  k.lathe(prof, 0, 0, 0, C.concrete, { seg: 32 });
  k.cyl(16.6, 17.2, 1.2, 0, 0, 0, C.stone3, { seg: 32 });
  // Kugel, 32 m, aus Stahlfacetten
  const yc = 212, R = 16;
  k.ball(R, 0, yc, 0, '#c4cbd3', { ws: 28, hs: 18, flat: true });
  k.cyl(5.6, 4.9, 4, 0, yc - R - 2.6, 0, C.concrete, { seg: 24 });
  // zwei Fensterbänder (Aussichtsetage und Telecafé) mit Pfosten und Licht
  for (const [b0, b1] of [[-10.8, -7.6], [-5.9, -2.6]]) {
    const r0 = Math.sqrt(R * R - b0 * b0), r1 = Math.sqrt(R * R - b1 * b1);
    k.cyl(r1 * 1.012, r0 * 1.012, b1 - b0, 0, yc + b0, 0, '#46525e', { seg: 48, open: true });
    k.cyl(r1 * 1.022, r0 * 1.022, (b1 - b0) * 0.86, 0, yc + b0 + (b1 - b0) * 0.07, 0, C.lit, { seg: 48, open: true, glow: true });
    for (let i = 0; i < 40; i++) {
      const a = i * TAU / 40;
      k.beam([Math.cos(a) * r0 * 1.03, yc + b0, Math.sin(a) * r0 * 1.03], [Math.cos(a) * r1 * 1.03, yc + b1, Math.sin(a) * r1 * 1.03], 0.28, '#d5dbe1');
    }
    k.cyl(r0 * 1.04, r0 * 1.04, 0.35, 0, yc + b0 - 0.35, 0, '#d5dbe1', { seg: 48 });
  }
  // Schaft oben, Plattform, Antenne in rot weißen Ringen
  k.cyl(3.5, 3.7, 26, 0, yc + R - 4, 0, C.concrete, { seg: 20 });
  k.cyl(4.6, 4.6, 1.4, 0, 248.6, 0, C.grey, { seg: 20 });
  for (let i = 0; i < 12; i++) {
    const y0 = 250 + i * 9.6, r0 = lerp(1.9, 1.05, i / 12), r1 = lerp(1.9, 1.05, (i + 1) / 12);
    k.cyl(r1, r0, 9.6, 0, y0, 0, i % 2 ? '#f2efe9' : '#d4523e', { seg: 12 });
    if (i === 4 || i === 8) k.cyl(r0 + 1.4, r0 + 1.4, 0.5, 0, y0, 0, C.grey, { seg: 12 });
  }
  k.cone(1.0, 3, 0, 365, 0, C.white, { seg: 8 });
  for (const y of [367.6, 296, 334]) for (let i = 0; i < (y > 360 ? 1 : 4); i++) {
    const a = i * PI / 2, rr = y > 360 ? 0 : 2.3;
    k.ball(0.75, Math.cos(a) * rr, y, Math.sin(a) * rr, '#8a2a22', { ws: 6, hs: 4 });
    k.ball(0.9, Math.cos(a) * rr, y, Math.sin(a) * rr, C.litR, { ws: 6, hs: 4, glow: true });
  }
  for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4; k.ball(0.8, Math.cos(a) * 3.7, yc + R + 1, Math.sin(a) * 3.7, C.litR, { ws: 6, hs: 4, glow: true }); }
  return k.done();
}

// ein Pferd der Quadriga, schaut nach -z
function horse(k, x, z, ry, col, prance) {
  k.at(T(x, 0, z, ry), () => {
    k.rbox(0.95, 1.05, 2.3, 0.4, 0, 1.25, 0, col);
    k.beam([0, 1.95, -0.85], [0, 2.85, -1.35], [0.42, 0.62], col);
    k.at(T(0, 2.85, -1.42, 0, 0.75), () => k.rbox(0.36, 0.42, 0.95, 0.15, 0, -0.2, -0.32, col));
    k.beam([0, 3.0, -1.2], [0, 2.1, -0.6], [0.12, 0.3], shade(col, 0.85));
    for (const sx of [-0.27, 0.27]) {
      if (prance && sx < 0) { k.beam([sx, 1.5, -0.9], [sx, 1.25, -1.45], 0.24, col); k.beam([sx, 1.25, -1.45], [sx, 0.75, -1.35], 0.2, col); }
      else k.beam([sx, 1.5, -0.85], [sx, 0, -0.95], 0.24, col);
      k.beam([sx, 1.5, 0.85], [sx, 0, 1.0], 0.26, col);
    }
    k.beam([0, 2.05, 1.12], [0, 1.0, 1.5], [0.22, 0.32], shade(col, 0.88));
  });
}

// Brandenburger Tor: sechs dorische Säulenpaare, fünf Durchfahrten, Gebälk mit Triglyphen, Attika, Quadriga
function brandenburger_tor() {
  const k = new K(), S = '#eadfc6', S2 = '#dfd2b5', CU = '#7fae98';
  // Sockelstufen
  k.box(35.5, 0.45, 13.6, 0, 0, 0, S2); k.box(34.6, 0.4, 12.6, 0, 0.45, 0, S);
  const xs = [-14.8, -9.25, -3.7, 3.7, 9.25, 14.8], y0 = 0.85, hc = 13.3;
  for (const x of xs) {
    // Querwand zwischen den Säulen (trennt die Durchfahrten)
    k.box(1.55, hc, 7.6, x, y0, 0, S2);
    for (const z of [-4.65, 4.65]) column(k, x, y0, z, hc, 0.88, S, { kind: 'doric', seg: 16 });
  }
  // Durchfahrt Decken (Kassetten) sichtbar von unten
  k.box(33, 0.6, 9.4, 0, y0 + hc - 0.6, 0, S2);
  // Gebälk: Architrav, Fries mit Triglyphen, Gesims
  const yA = y0 + hc;
  k.rbox(32.6, 1.35, 11.4, 0.12, 0, yA, 0, S);
  k.rbox(32.6, 1.45, 11.0, 0.12, 0, yA + 1.35, 0, S2);
  for (let i = 0; i <= 17; i++) {
    const x = -15.5 + i * 31 / 17;
    for (const z of [-5.55, 5.55]) k.box(0.62, 1.3, 0.2, x, yA + 1.42, z, S);
  }
  for (const x of [-16.3, 16.3]) k.box(0.2, 1.3, 9, x, yA + 1.42, 0, S);
  k.rbox(33.8, 0.55, 12.4, 0.15, 0, yA + 2.8, 0, S);
  // Attika mit Reliefband und Stufen
  const yT = yA + 3.35;
  k.rbox(32, 2.5, 10.2, 0.2, 0, yT, 0, S2);
  for (const z of [-5.12, 5.12]) k.box(20, 1.6, 0.12, 0, yT + 0.6, z, '#d6c7a6');
  k.box(32.6, 0.35, 10.8, 0, yT + 2.5, 0, S);
  k.rbox(19, 0.75, 8.8, 0.15, 0, yT + 2.85, 0, S2);
  k.rbox(10.5, 0.6, 6.6, 0.15, 0, yT + 3.6, 0, S);
  for (const x of [-15.2, 15.2]) k.rbox(2.2, 0.7, 9.4, 0.15, x, yT + 2.85, 0, S2);
  // Quadriga: vier Pferde, Wagen, Victoria mit Siegeszeichen
  const yq = yT + 4.2;
  k.at(T(0, yq, -0.4, 0, 0, 0, 1.05), () => {
    horse(k, -2.5, -0.6, 0.12, CU, false); horse(k, -0.83, -0.9, 0.03, CU, true); horse(k, 0.83, -0.9, -0.03, CU, true); horse(k, 2.5, -0.6, -0.12, CU, false);
    k.rbox(2.2, 1.0, 1.4, 0.25, 0, 0.6, 1.5, CU);
    for (const x of [-1.2, 1.2]) k.cyl(0.7, 0.7, 0.18, x, 0.0, 1.6, shade(CU, 0.85), { seg: 12, ry: 0 , rz: 0 });
    k.at(T(0, 0.9, 1.4), () => {
      k.lathe([[0.62, 0], [0.55, 1.4], [0.4, 2.2], [0.34, 2.55], [0.15, 2.75], [0, 2.75]], 0, 0, 0, CU, { seg: 10 });
      k.ball(0.27, 0, 3.0, 0, CU, { ws: 8, hs: 6 });
      for (const s of [-1, 1]) k.at(T(0.2 * s, 2.45, 0.25, 0, -0.35, -0.5 * s), () => k.ext([[0, 0], [0.7, 0.25], [1.2, 1.2], [0.9, 2.2], [0.4, 1.4]], null, 0.12, CU, { x: 0, y: 0 }));
      k.beam([0.32, 2.45, -0.1], [0.55, 3.4, -0.3], 0.22, CU);
      k.tube([0.58, 0.6, -0.32], [0.58, 3.9, -0.32], 0.07, CU);
      k.cyl(0.42, 0.42, 0.12, 0.58, 3.8, -0.32, CU, { seg: 10, open: true });
      k.box(0.6, 0.18, 0.08, 0.58, 3.65, -0.32, CU); k.box(0.18, 0.6, 0.08, 0.58, 3.45, -0.32, CU);
      k.box(0.32, 0.4, 0.28, 0.58, 3.95, -0.32, CU);
    });
  });
  // Torhäuser an den Seiten (niedriger, mit Säulen) und Verbindungsmauern
  k.mirX(() => {
    k.box(3.8, 8.8, 7.0, 18.6, 0, 0, S2);
    k.rbox(10.6, 9.2, 9.4, 0.2, 26.1, 0, 0, S2);
    for (const z of [-4.7, 4.7]) for (const x of [21.8, 30.4]) column(k, x, 0, z, 8.4, 0.5, S, { kind: 'doric', seg: 10 });
    k.rbox(11.6, 1.1, 10.4, 0.15, 26.1, 8.4, 0, S);
    k.rbox(10.8, 0.8, 9.6, 0.15, 26.1, 9.5, 0, S2);
    k.box(6, 0.6, 0.1, 26.1, 10.4, -4.85, '#d6c7a6');
    for (const z of [-4.75, 4.75]) win(k, [26.1, 4.2, z], [0, Math.sign(z)], 1.6, 3, { col: C.win, lc: C.lit });
  });
  return k.done();
}

// Reichstag: Sandsteinblock mit vier Ecktürmen, Westportal mit sechs Säulen und Giebel, gläserne Kuppel mit Rippen
function reichstag() {
  const k = new K(), S = '#ddd0b3', S2 = '#cfc1a2', W = 137, D = 97, hx = W / 2, hz = D / 2;
  k.rbox(W - 2, 7, D - 2, 0.3, 0, 0, 0, S2);
  k.rbox(W - 3, 26, D - 3, 0.5, 0, 0, 0, S);
  cornice(k, 0, 0, W - 3, D - 3, 7, 0.7, 0.4, S2);
  cornice(k, 0, 0, W - 3, D - 3, 23.6, 1.0, 0.6, S2);
  balustrade(k, 0, 0, hx - 1.4, hz - 1.4, 24.6, 1.6, 2.4, S);
  k.box(W - 6, 0.3, D - 6, 0, 25.8, 0, '#c9c6bf');
  // Innenhöfe als dunkle Flächen auf dem Dach
  for (const x of [-38, 38]) k.box(30, 0.2, 40, x, 26.1, 0, '#8f8a80');
  // Fenster: Sockel, hohes Hauptgeschoss mit Rundbogen, Mezzanin
  const fo = { col: C.win, lc: C.lit };
  const skipT = (u) => Math.abs(u) > hx - 14;
  facade(k, [0, 0, -hz + 1.5], [0, -1], W - 32, [3.8], 16, 1.6, 2.4, { ...fo, skip: (u) => Math.abs(u) < 19 });
  facade(k, [0, 0, -hz + 1.5], [0, -1], W - 32, [13.5], 16, 2.2, 6.4, { ...fo, kind: 'arch', skip: (u) => Math.abs(u) < 19 });
  facade(k, [0, 0, -hz + 1.5], [0, -1], W - 32, [20.8], 16, 1.8, 1.8, { ...fo, skip: (u) => Math.abs(u) < 19 });
  facade(k, [0, 0, hz - 1.5], [0, 1], W - 32, [3.8, 20.8], 16, 1.6, 2.2, fo);
  facade(k, [0, 0, hz - 1.5], [0, 1], W - 32, [13.5], 16, 2.2, 6.4, { ...fo, kind: 'arch' });
  for (const s of [-1, 1]) {
    facade(k, [s * (hx - 1.5), 0, 0], [s, 0], D - 32, [3.8, 20.8], 11, 1.6, 2.2, fo);
    facade(k, [s * (hx - 1.5), 0, 0], [s, 0], D - 32, [13.5], 11, 2.2, 6.4, { ...fo, kind: 'arch' });
  }
  pilasters(k, 0, 0, hx - 1.5, hz - 1.5, 7.7, 15.9, 6.6, 1.0, S2, { skipX: u => Math.abs(u) < 20 || Math.abs(u) > hx - 12 });
  // Ecktürme
  k.mirXZ(() => {
    const tx = hx - 10, tz = hz - 10;
    k.rbox(23, 35, 23, 0.4, tx, 0, tz, S);
    cornice(k, tx, tz, 23, 23, 7, 0.8, 0.4, S2);
    cornice(k, tx, tz, 23, 23, 33.4, 1.2, 0.7, S2);
    k.rbox(19, 2.8, 19, 0.3, tx, 35, tz, S2);
    for (const [dx, dz] of [[-8.6, -8.6], [8.6, -8.6], [-8.6, 8.6], [8.6, 8.6]]) k.cyl(0.6, 1.2, 4.4, tx + dx, 35.6, tz + dz, S, { seg: 6 });
    k.tube([tx, 37.8, tz], [tx, 47, tz], 0.12, C.white);
    for (const [i, c] of [[0, '#2f2f33'], [1, '#d4433a'], [2, '#e8c34e']]) k.box(0.08, 0.9, 4.2, tx, 46 - i * 0.9, tz + 2.2, c);
    for (const [n, cx, cz] of [[[0, 1], tx, tz + 11.5], [[1, 0], tx + 11.5, tz]]) {
      facade(k, [cx, 0, cz], n, 14, [13.5], 2, 2.6, 7.4, { ...fo, kind: 'arch' });
      facade(k, [cx, 0, cz], n, 14, [3.8, 21.2, 28.5], 2, 1.6, 2.2, fo);
    }
  });
  // Westportal (Vorderseite -z): Treppe, sechs korinthische Säulen, Inschriftband, Giebel, Portalbau dahinter
  const zf = -hz - 1;
  k.rbox(40, 26, 10, 0.4, 0, 0, zf + 4, S);
  k.rbox(44, 7.4, 13, 0.3, 0, 0, zf - 3, S2);
  for (let i = 0; i < 9; i++) k.box(30, 0.8, 1.2, 0, i * 0.8, zf - 9.2 - (8 - i) * 1.1 + 4.4, S2);
  for (let i = 0; i < 6; i++) column(k, -15 + i * 6, 7.4, zf - 5.6, 16.2, 1.1, S, { kind: 'corinth', seg: 14 });
  for (const x of [-19.4, 19.4]) k.rbox(3.2, 16.2, 3.2, 0.2, x, 7.4, zf - 5.6, S);
  k.rbox(42, 2.6, 6.4, 0.2, 0, 23.6, zf - 4.6, S);
  k.box(22, 1.0, 0.25, 0, 24.4, zf - 7.9, '#6b5a3c');
  const gH = 7.5;
  k.ext([[-21.5, 0], [21.5, 0], [0, gH]], null, 6.4, S, { x: 0, y: 26.2, z: zf - 4.6 });
  k.ext([[-19, 0.4], [19, 0.4], [0, gH - 1]], null, 0.3, S2, { x: 0, y: 26.2, z: zf - 7.9 });
  k.rbox(36, 4.6, 14, 0.3, 0, 26.2, zf + 7, S2);
  // Glaskuppel: 40 m Durchmesser, 23,5 m hoch, Rippen und Ringe, Plattform oben
  const yb = 24.4, Rd = 20, Hd = 22.4;
  k.cyl(Rd + 1.2, Rd + 1.6, 1.4, 0, yb - 0.4, 0, '#d3d1cb', { seg: 48 });
  const prof = []; for (let i = 0; i <= 12; i++) { const a = i / 12 * PI / 2 * 0.94; prof.push([Math.cos(a) * Rd, Math.sin(a) * Hd]); }
  k.lathe(prof, 0, yb + 1, 0, '#b1cbd7', { seg: 48 });
  k.lathe(prof.map(([r, y]) => [r * 1.006, y * 1.003]), 0, yb + 1, 0, C.litW, { seg: 48, glow: true });
  for (let i = 0; i < 24; i++) {
    const a = i * TAU / 24, pts = [];
    for (let j = 0; j <= 12; j++) { const b = j / 12 * PI / 2 * 0.94; pts.push([Math.cos(a) * Math.cos(b) * Rd * 1.02, yb + 1 + Math.sin(b) * Hd * 1.01, Math.sin(a) * Math.cos(b) * Rd * 1.02]); }
    k.path(pts, 0.28, '#8e9aa4', { square: true });
  }
  for (let j = 1; j <= 11; j++) {
    const b = j / 12 * PI / 2 * 0.94, rr = Math.cos(b) * Rd * 1.025, y = yb + 1 + Math.sin(b) * Hd * 1.012;
    k.cyl(rr, rr, 0.32, 0, y - 0.16, 0, '#9aa5ae', { seg: 48, open: true });
  }
  const rt = Math.cos(PI / 2 * 0.94) * Rd;
  k.cyl(rt + 0.6, rt + 0.6, 0.6, 0, yb + 1 + Hd * 0.995, 0, '#8e9aa4', { seg: 24 });
  return k.done();
}

// Berliner Dom: Hauptkuppel mit goldenen Rippen und Laterne, vier Ecktürme mit Hauben, Portal mit Säulenpaaren
function berliner_dom() {
  const k = new K(), S = '#d9d0c0', S2 = '#c9bfad', CU = C.copper, AU = '#dcb75e';
  k.box(98, 3, 66, 0, 0, 2, S2);
  k.rbox(92, 30, 60, 0.4, 0, 0, 2, S);
  cornice(k, 0, 2, 92, 60, 15.5, 0.8, 0.4, S2);
  cornice(k, 0, 2, 92, 60, 28.6, 1.2, 0.6, S2);
  balustrade(k, 0, 2, 46.4, 30.4, 29.8, 1.8, 2.6, S);
  const fo = { col: C.win, lc: C.lit, kind: 'arch' };
  facade(k, [0, 0, -28], [0, -1], 50, [8.5, 22], 6, 2.6, 6.2, { ...fo, skip: u => Math.abs(u) < 18 });
  facade(k, [0, 0, 32], [0, 1], 60, [8.5, 22], 8, 2.6, 6.2, fo);
  for (const s of [-1, 1]) facade(k, [s * 46, 0, 2], [s, 0], 36, [8.5, 22], 4, 2.6, 6.2, fo);
  pilasters(k, 0, 2, 46, 30, 3, 25.6, 6.5, 1.1, S2, { skipX: u => Math.abs(u) < 18 });
  // Apsis nach Osten (+z) mit Halbkuppel
  k.cyl(16, 16, 27, 0, 0, 32, S, { seg: 24, t0: -PI / 2, tl: PI });
  k.ball(16.4, 0, 27, 32, CU, { ws: 24, hs: 8, t0: 0, tl: PI / 2, sx: 1, sz: 1 });
  for (let i = 0; i < 5; i++) { const a = (i + 0.5) / 5 * PI; win(k, [Math.cos(a - PI / 2) * 16.05 * -1 * 0 + Math.sin(a) * 0 + Math.cos(a) * 16.05, 14, 32 + Math.sin(a) * 16.05], [Math.cos(a), Math.sin(a)], 2.6, 7.5, fo); }
  // Portal (Westfront, -z): großer Bogen, vier Säulenpaare, Attika mit Figuren
  const zp = -32.5;
  k.rbox(36, 36, 9, 0.3, 0, 0, zp + 3, S);
  k.plate([0, 0, zp - 1.5], [0, -1], archHole(0, 13, 3, 17.5, 10), '#6a6258', { off: 0.05 });
  k.plate([0, 0, zp - 1.5], [0, -1], archHole(0, 9, 3, 15.5, 10), C.lit, { off: 0.2, glow: true });
  k.ext([...arc(0, 17.5, 8, 0, PI, 12), ...arc(0, 17.5, 6.5, PI, 0, 12)], null, 1.0, S2, { z: zp - 1.6 });
  for (const x of [-8.6, -11.2, 8.6, 11.2]) column(k, x, 3, zp - 2.4, 23.5, 0.85, S, { kind: 'corinth', seg: 12 });
  k.rbox(38, 2.6, 4.2, 0.2, 0, 26.5, zp - 1.6, S2);
  k.rbox(30, 6.2, 6, 0.3, 0, 29.1, zp + 1, S);
  k.ext([[-12, 0], [12, 0], [0, 4.5]], null, 4, S2, { x: 0, y: 35.3, z: zp + 1 });
  for (let i = 0; i < 7; i++) { const x = -12 + i * 4; k.cyl(0.35, 0.45, 2.6, x, 35.3 - (Math.abs(x) > 11 ? 0 : 0), zp - 2, C.lit === 0 ? S : '#e2dccd', { seg: 6 }); k.ball(0.38, x, 38.2, zp - 2, '#e2dccd', { ws: 6, hs: 4 }); }
  // Ecktürme mit Hauben und Laternen
  for (const [tx, tz] of [[-40, -22], [40, -22], [-40, 26], [40, 26]]) {
    k.rbox(13, 46, 13, 0.3, tx, 0, tz, S);
    cornice(k, tx, tz, 13, 13, 28.6, 1.2, 0.6, S2);
    cornice(k, tx, tz, 13, 13, 44.5, 1.5, 0.6, S2);
    for (const [n, cx, cz] of [[[0, -1], tx, tz - 6.5], [[0, 1], tx, tz + 6.5], [[1, 0], tx + 6.5, tz], [[-1, 0], tx - 6.5, tz]]) {
      win(k, [cx, 38, cz], n, 2.4, 7, fo); win(k, [cx, 22, cz], n, 2.0, 5, fo);
    }
    for (const [dx, dz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) k.cyl(0.55, 0.6, 14, tx + dx, 31, tz + dz, S2, { seg: 8 });
    k.cyl(4.6, 5.2, 4.5, tx, 46, tz, S, { seg: 16 });
    k.lathe(domeProfile(5.0, 8, 'helm', 10), tx, 50.5, tz, CU, { seg: 16 });
    k.cyl(1.2, 1.4, 3.2, tx, 57.5, tz, AU, { seg: 8 });
    k.cone(1.3, 1.6, tx, 60.7, tz, CU, { seg: 8 });
    k.ball(0.5, tx, 62.6, tz, AU, { ws: 8, hs: 6 });
  }
  // Hauptkuppel: Tambour mit Säulenpaaren und Fenstern, Kuppel mit goldenen Rippen, Laterne
  const yd = 30;
  k.rbox(40, 6, 40, 0.4, 0, yd, 2, S2);
  k.cyl(17, 17.4, 19, 0, yd + 6, 2, S, { seg: 32 });
  for (let i = 0; i < 16; i++) {
    const a = (i + 0.5) * TAU / 16;
    for (const da of [-0.075, 0.075]) column(k, Math.cos(a + da) * 18, yd + 6, 2 + Math.sin(a + da) * 18, 15.5, 0.5, S, { kind: 'corinth', seg: 8 });
    const b = i * TAU / 16;
    win(k, [Math.cos(b) * 17.05, yd + 14, 2 + Math.sin(b) * 17.05], [Math.cos(b), Math.sin(b)], 2.4, 7, fo);
  }
  k.cyl(18.9, 18.9, 1.6, 0, yd + 21.5, 2, S2, { seg: 32 });
  k.cyl(17.4, 17.6, 2.6, 0, yd + 23.1, 2, S, { seg: 32 });
  const prof = []; for (let i = 0; i <= 12; i++) { const a = i / 12 * PI / 2; prof.push([3.6 + 13.8 * Math.cos(a), yd + 25.7 + 29 * Math.sin(a)]); }
  k.lathe(prof, 0, 0, 2, CU, { seg: 32 });
  for (let i = 0; i < 16; i++) {
    const a = i * TAU / 16, pts = prof.map(([r, y]) => [Math.cos(a) * (r + 0.25), y, 2 + Math.sin(a) * (r + 0.25)]);
    k.path(pts, 0.32, AU, { square: true });
    const r = 3.6 + 13.8 * Math.cos(0.45), y = yd + 25.7 + 29 * Math.sin(0.45), b = a + PI / 16;
    k.ball(0.9, Math.cos(b) * r, y, 2 + Math.sin(b) * r, '#e6dfcf', { ws: 6, hs: 4 });
  }
  const yl = yd + 54.7;
  k.cyl(3.4, 3.8, 6, 0, yl, 2, S, { seg: 12 });
  for (let i = 0; i < 8; i++) { const a = i * TAU / 8; k.cyl(0.3, 0.3, 5, Math.cos(a) * 3.9, yl + 0.5, 2 + Math.sin(a) * 3.9, S2, { seg: 6 }); }
  k.lathe(domeProfile(3.9, 3.2, 'dome', 6), 0, yl + 6, 2, CU, { seg: 12 });
  k.cyl(0.6, 0.8, 1.6, 0, yl + 9, 2, AU, { seg: 8 });
  k.ball(0.75, 0, yl + 11.2, 2, AU, { ws: 8, hs: 6 });
  k.box(0.25, 2.2, 0.25, 0, yl + 11.6, 2, AU); k.box(1.2, 0.25, 0.25, 0, yl + 12.9, 2, AU);
  return k.done();
}

// Siegessäule: Granitsockel, Säulenhalle, Schaft mit drei vergoldeten Kanonentrommeln, Aussichtsplattform, goldene Victoria
function siegessaeule() {
  const k = new K(), GR = '#c99486', SA = '#e3d6b8', AU = C.gold;
  k.box(26, 0.6, 26, 0, 0, 0, '#cfc6b6'); k.box(23.5, 0.6, 23.5, 0, 0.6, 0, '#cfc6b6');
  k.rbox(19.5, 6.8, 19.5, 0.3, 0, 1.2, 0, GR);
  cornice(k, 0, 0, 19.5, 19.5, 7.6, 0.6, 0.35, shade(GR, 0.9));
  for (const [n, cx, cz] of [[[0, -1], 0, -9.8], [[0, 1], 0, 9.8], [[1, 0], 9.8, 0], [[-1, 0], -9.8, 0]]) k.panel([cx, 4.4, cz], n, 6.5, 2.2, '#9c8a62', { off: 0.06 });
  // Säulenhalle mit Mosaik
  const yh = 8.2;
  k.cyl(6.3, 6.3, 8.6, 0, yh, 0, '#d8b768', { seg: 24 });
  colRing(k, 16, 7.6, yh, 8.2, 0.42, '#d7c6c0', { kind: 'doric', seg: 8 });
  k.cyl(8.5, 8.5, 1.3, 0, yh + 8.2, 0, SA, { seg: 32 });
  k.cyl(7.0, 8.0, 1.0, 0, yh + 9.5, 0, SA, { seg: 32 });
  // Schaft: drei Trommeln mit Kanonenrohren, Girlandenbänder
  let y = yh + 10.5;
  const r0 = 2.7, r1 = 2.35, H = 32;
  k.cyl(r1, r0, H, 0, y, 0, SA, { seg: 24 });
  for (let d = 0; d < 3; d++) {
    const ya = y + d * H / 3 + 0.8, hb = H / 3 - 2.2, rr = lerp(r0, r1, (d + 0.5) / 3);
    for (let i = 0; i < 12; i++) { const a = i * TAU / 12; k.cyl(0.17, 0.24, hb, Math.cos(a) * rr * 1.03, ya, Math.sin(a) * rr * 1.03, AU, { seg: 5 }); }
    k.cyl(rr + 0.32, rr + 0.32, 0.9, 0, y + (d + 1) * H / 3 - 0.9, 0, AU, { seg: 24 });
  }
  y += H;
  // Kapitell und Plattform mit Gitter
  k.cyl(3.6, 2.5, 1.6, 0, y, 0, SA, { seg: 24 });
  k.cyl(4.5, 4.5, 0.5, 0, y + 1.6, 0, SA, { seg: 24 });
  for (let i = 0; i < 24; i++) { const a = i * TAU / 24; k.box(0.12, 1.1, 0.12, Math.cos(a) * 4.3, y + 2.1, Math.sin(a) * 4.3, '#5c5a55'); }
  k.cyl(4.35, 4.35, 0.12, 0, y + 3.1, 0, '#5c5a55', { seg: 24, open: true });
  k.cyl(1.7, 2.0, 6.6, 0, y + 2.1, 0, '#d0c4a6', { seg: 16 });
  // Victoria, 8,3 m, vergoldet, Flügel, Lorbeerkranz in der Rechten, Feldzeichen links
  const yv = y + 8.7;
  k.at(T(0, yv, 0, 0, 0, 0, 1.0), () => {
    k.lathe([[1.15, 0], [1.0, 1.8], [0.8, 3.4], [0.62, 4.6], [0.7, 5.2], [0.5, 5.8], [0.2, 6.1], [0, 6.1]], 0, 0, 0, AU, { seg: 12 });
    k.ball(0.45, 0, 6.5, -0.05, AU, { ws: 10, hs: 8 });
    k.ball(0.5, 0, 6.75, 0.05, AU, { ws: 8, hs: 6, sy: 0.6 });
    for (const s of [-1, 1]) k.at(T(0.35 * s, 5.6, 0.4, 0.25 * s, -0.25, -0.35 * s), () => k.ext([[0, 0], [1.0, 0.4], [1.9, 1.7], [1.6, 3.4], [0.9, 2.6], [0.4, 1.4]], null, 0.2, AU));
    k.beam([0.55, 5.6, -0.1], [1.1, 7.0, -0.55], 0.32, AU);
    k.cyl(0.55, 0.55, 0.16, 1.15, 7.05, -0.6, AU, { seg: 10, open: true });
    k.beam([-0.55, 5.5, -0.1], [-0.9, 4.6, -0.6], 0.3, AU);
    k.tube([-0.95, 2.4, -0.7], [-0.95, 7.2, -0.7], 0.08, AU);
    k.box(0.7, 0.2, 0.08, -0.95, 7.0, -0.7, AU); k.box(0.2, 0.7, 0.08, -0.95, 6.75, -0.7, AU);
  });
  return k.done();
}

// Rotes Rathaus: Klinkerbau mit Innenhöfen, Arkaden, Fries (Steinerne Chronik), Turm 74 m mit Glockengeschoss
function rotes_rathaus() {
  const k = new K(), B = '#c9725a', B2 = '#b8654f', R = '#757b86', TC = '#e0a587';
  const wings = [[0, -35, 99, 18], [0, 35, 99, 18], [-40.5, 0, 18, 52], [40.5, 0, 18, 52], [0, 0, 16, 52]];
  for (const [x, z, w, d] of wings) {
    k.rbox(w, 22.5, d, 0.3, x, 0, z, B);
    // Satteldach entlang der langen Seite
    const along = w >= d, L = along ? w : d, D2 = (along ? d : w) / 2 + 0.6;
    k.ext([[-D2, 0], [D2, 0], [0.8, 7.5], [-0.8, 7.5]], null, L, R, { ry: along ? PI / 2 : 0, x, y: 22.5, z });
  }
  // Gesimse, Fries
  corniceRing(k, 0, 0, 99, 88, 7.2, 1.2, 0.3, TC);
  corniceRing(k, 0, 0, 99, 88, 21.5, 1.0, 0.6, B2);
  const fo = { col: C.win, lc: C.lit, kind: 'arch' };
  for (const [c, n, L] of [[[0, 0, -44], [0, -1], 99], [[0, 0, 44], [0, 1], 99], [[-49.5, 0, 0], [-1, 0], 88], [[49.5, 0, 0], [1, 0], 88]]) {
    const cnt = Math.round(L / 4.6);
    facade(k, c, n, L - 4, [3.6], cnt, 2.4, 4.6, { ...fo, col: '#6d5a4e', skip: (u) => n[1] === -1 && Math.abs(u) < 11 });
    facade(k, c, n, L - 4, [11.5, 17.6], cnt, 1.9, 4.4, { ...fo, skip: (u) => n[1] === -1 && Math.abs(u) < 11 });
  }
  pilasters(k, 0, 0, 49.5, 44, 8.4, 13.1, 9, 0.9, B2);
  // Eckrisalite mit Walmdächern
  k.mirXZ(() => { k.rbox(14, 24.5, 14, 0.3, 44, 0, 38.5, B); k.cyl(0, 10.5, 7, 44, 24.5, 38.5, R, { seg: 4, ry: PI / 4 }); });
  // Turm 74 m an der Vorderseite
  const tz = -38;
  k.rbox(18, 50, 18, 0.3, 0, 0, tz, B);
  cornice(k, 0, tz, 18, 18, 22, 1.0, 0.4, B2);
  for (const [dx, dz] of [[-8.7, -8.7], [8.7, -8.7], [-8.7, 8.7], [8.7, 8.7]]) k.box(2.4, 50, 2.4, dx, 0, tz + dz, B2);
  for (const [n, cx, cz] of [[[0, -1], 0, tz - 9], [[0, 1], 0, tz + 9], [[1, 0], 9, tz], [[-1, 0], -9, tz]]) {
    win(k, [cx, 4.5, cz], n, 4.5, 7, { ...fo, col: '#5d4d43' });
    facade(k, [cx, 0, cz], n, 12, [13, 27, 34], 2, 1.8, 4, fo);
    k.plate([cx, 42.5, cz], n, ngon(2.6, 20), '#f2ece0', { off: 0.12 });
    k.plate([cx, 42.5, cz], n, ngon(2.3, 20), C.litW, { off: 0.25, glow: true });
    k.beam([cx + n[0] * 0.3, 42.5, cz + n[1] * 0.3], [cx + n[0] * 0.3 + n[1] * 1.6, 43.6, cz + n[1] * 0.3 - n[0] * 1.6], 0.22, '#3c3b3e');
  }
  cornice(k, 0, tz, 18, 18, 47.5, 1.5, 0.6, B2);
  // Glockengeschoss mit drei Bögen je Seite
  const yb = 49;
  k.rbox(16, 13, 16, 0.2, 0, yb, tz, B2);
  for (const [n, cx, cz] of [[[0, -1], 0, tz - 8], [[0, 1], 0, tz + 8], [[1, 0], 8, tz], [[-1, 0], -8, tz]]) for (const u of [-4.6, 0, 4.6]) win(k, [cx + n[1] * -u * -1 * (n[1] ? 1 : 0) + (n[0] ? 0 : 0) + (n[1] ? u : 0), yb + 6.2, cz + (n[0] ? u : 0)], n, 2.8, 8.5, { ...fo, col: '#3d3430', lc: '#ffcf8a' });
  cornice(k, 0, tz, 16, 16, yb + 13, 1.2, 0.7, TC);
  balustrade(k, 0, tz, 8.4, 8.4, yb + 14.2, 1.4, 1.8, B);
  for (const [dx, dz] of [[-7.6, -7.6], [7.6, -7.6], [-7.6, 7.6], [7.6, 7.6]]) { k.cyl(1.1, 1.1, 3.2, dx, yb + 14.2, tz + dz, B, { seg: 8 }); k.cone(1.3, 2.4, dx, yb + 17.4, tz + dz, R, { seg: 8 }); }
  k.cyl(0, 6.5, 4.4, 0, yb + 14.2, tz, R, { seg: 4, ry: PI / 4 });
  k.tube([0, yb + 18, tz], [0, 74, tz], 0.18, C.white);
  k.box(0.08, 2.2, 3.6, 0, 71.4, tz - 1.9, C.white); k.box(0.1, 0.75, 3.6, 0, 72.85, tz - 1.9, '#d24a3a'); k.box(0.1, 0.75, 3.6, 0, 71.4, tz - 1.9, '#d24a3a');
  return k.done();
}

// Gedächtniskirche: Turmruine (hohler Zahn) mit gebrochener Krone, achteckiger Neubau und sechseckiger Glockenturm
// aus blauen Glaswaben, Kapelle. Ruine in der Mitte, Achteck im Westen (-x), Glockenturm im Osten (+x)
function wabenBau(k, n, R, h, x, z, o = {}) {
  const G = '#d4d6d8', BL = '#3d5f9e', cs = Math.cos(PI / n);
  k.cyl(R * 0.97, R * 0.97, h, x, 0, z, BL, { seg: n, flat: true, ry: PI / n });
  const side = 2 * R * Math.sin(PI / n), rows = Math.max(3, Math.round(h / 2.6)), cols = Math.max(2, Math.round(side / 2.6));
  for (let s = 0; s < n; s++) {
    const a0 = s * TAU / n, a1 = (s + 1) * TAU / n;
    const P0 = [x + Math.cos(a0) * R, z + Math.sin(a0) * R], P1 = [x + Math.cos(a1) * R, z + Math.sin(a1) * R];
    const am = (a0 + a1) / 2, nn = [Math.cos(am), Math.sin(am)];
    for (let c = 0; c <= cols; c++) { const t = c / cols, px = lerp(P0[0], P1[0], t), pz = lerp(P0[1], P1[1], t); k.box(0.42, h, 0.42, px, 0, pz, G, { ry: -am }); }
    for (let r = 0; r <= rows; r++) k.beam([P0[0], r * h / rows, P0[1]], [P1[0], r * h / rows, P1[1]], [0.42, 0.42], G, { up: [0, 1, 0] });
    k.panel([x + nn[0] * R * cs, h / 2, z + nn[1] * R * cs], nn, side / 2 * 0.98, h / 2 * 0.97, C.litBlue, { off: 0.05, glow: true });
  }
  k.cyl(R + 0.5, R + 0.5, 0.7, x, h, z, G, { seg: n, ry: PI / n });
  if (o.cross) { k.box(0.4, 5.5, 0.4, x, h + 0.7, z, C.gold); k.box(2.6, 0.4, 0.4, x, h + 4.4, z, C.gold); }
}
function gedaechtniskirche() {
  const k = new K(), S = '#a0968a', S2 = '#8a8075', S3 = '#b5ab9d';
  // Ruine: Vorhalle mit Seitenkapellen, Turmschaft mit Ecktürmchen, Bögen, gebrochene Krone
  k.rbox(24, 12, 20, 0.3, 0, 0, 0, S);
  for (const s of [-1, 1]) { k.cyl(5, 5, 9, 0, 0, s * 9, S, { seg: 12, t0: s > 0 ? 0 : PI, tl: PI }); k.ball(5, 0, 9, s * 9, '#7d8a8c', { ws: 12, hs: 4, t0: 0, tl: PI / 2 }); }
  k.plate([-12, 0, 0], [-1, 0], archHole(0, 6, 0, 6, 8), '#4f4943', { off: 0.06 });
  k.rbox(15, 56, 15, 0.3, 0, 0, 0, S);
  for (const [dx, dz] of [[-7.2, -7.2], [7.2, -7.2], [-7.2, 7.2], [7.2, 7.2]]) {
    k.cyl(2.0, 2.3, 47, dx, 0, dz, S2, { seg: 8 });
    k.cyl(0, 2.3, 6, dx, 47, dz, '#6f7a7c', { seg: 8 });
  }
  for (const y of [12, 26, 44]) cornice(k, 0, 0, 15, 15, y, 0.7, 0.4, S3);
  for (const [n, cx, cz] of [[[0, -1], 0, -7.5], [[0, 1], 0, 7.5], [[1, 0], 7.5, 0], [[-1, 0], -7.5, 0]]) {
    for (const u of [-2.4, 2.4]) win(k, [cx + (n[1] ? u : 0), 37, cz + (n[0] ? u : 0)], n, 3.2, 11, { kind: 'arch', col: '#3f3a35', lit: false });
    win(k, [cx, 20, cz], n, 2.6, 6, { kind: 'arch', col: '#3f3a35', lit: false });
    k.plate([cx, 50.5, cz], n, ngon(2.4, 16), '#e2dccd', { off: 0.1 });
  }
  // gebrochene Krone: Mauerstücke unterschiedlich hoch
  const tops = [[-6, -7, 15, 4], [-1, -7, 9, 2.5], [4, -7, 12.5, 3.5], [7, -3, 6, 2.5], [7, 3, 11, 3], [3, 7, 4.5, 4], [-3, 7, 10, 3], [-7, 2, 13.5, 2.5], [-7, -3, 7.5, 3]];
  for (const [x, z, h, w] of tops) k.box(Math.abs(x) > 6.5 ? 1.4 : w, h, Math.abs(z) > 6.5 ? 1.4 : w, x, 56, z, (x + z) % 2 ? S : S2);
  k.box(13, 0.8, 13, 0, 55.6, 0, S2);
  for (const [a, b] of [[[-4, 64, -2], [1, 70.6, 0]], [[3, 63, 2], [1, 70.6, 0]], [[-2, 62, 4], [1, 70.6, 0]]]) k.beam(a, b, 0.5, '#5a554e');
  // Achteck im Westen, Glockenturm im Osten, Kapelle mit Foyer ganz im Westen
  wabenBau(k, 8, 18.2, 20.5, -40, 0);
  wabenBau(k, 6, 6.6, 53.5, 30, 0, { cross: true });
  k.box(18, 8.5, 14, -68, 0, 0, '#3d5f9e');
  for (let i = 0; i <= 6; i++) { k.box(0.4, 8.5, 14.4, -77 + i * 3, 0, 0, '#d4d6d8'); }
  k.box(18.6, 0.6, 14.6, -68, 8.5, 0, '#d4d6d8');
  k.panel([-68, 4.2, -7.05], [0, -1], 8.8, 4, C.litBlue, { off: 0.1, glow: true });
  k.box(4, 6, 8, -57, 0, 0, '#c8cacb');
  return k.done({ center: true });
}

// =====================================================================================================
// Tokio
// =====================================================================================================

// Tokyo Skytree, 634 m: Stahlgitter in Skytree Weiß, unten Dreieck (Seite 68 m), oben Kreis, Tembo Deck auf 350 m,
// Tembo Galleria auf 450 m, Antennenturm. Nachts weiße Lichtbänder und rote Positionslichter
function tokyo_skytree() {
  const k = new K(), W = '#eef3f5', W2 = '#c9d6de', GL = '#4f6170', N = 18;
  const sec = (y) => {
    const m = Math.pow(clamp(y / 290, 0, 1), 0.85);
    const Rt = 39.3 - 13.3 * Math.pow(clamp(y / 300, 0, 1), 0.55);
    const Rc = y <= 300 ? 25 - 8 * Math.pow(y / 300, 0.6) : 17 - 2.2 * (y - 300) / 40;
    return circRing(1, y, N, -PI / 2).map((p, j) => {
      const th = j * TAU / N, rel = ((th % (TAU / 3)) + TAU / 3) % (TAU / 3) - PI / 3;
      const rT = Rt * 0.5 / Math.cos(rel);
      const r = lerp(rT, Rc, m);
      return [p[0] * r, y, p[2] * r];
    });
  };
  const ys = [0, 15, 31, 48, 66, 86, 107, 129, 152, 176, 201, 227, 254, 282, 310, 338];
  const rings = ys.map(sec);
  // Kern (helles Inneres) und Gitter aus Kreuzstreben und Ringen
  k.loft(rings.map(r => r.map(([x, y, z]) => [x * 0.84, y, z * 0.84])), W2, { smooth: true });
  lattice(k, rings, W, { t: 0.9, tr: 1.0, posts: false });
  // drei Beine an den Ecken des Dreiecks
  for (const j of [0, 6, 12]) for (let i = 0; i < 9; i++) k.beam(rings[i][j], rings[i + 1][j], 2.6, W);
  // Sockel (Dreieck) und Lichtringe am Gitter
  k.ext(ngon(46, 3, -PI / 2).map(([x, z]) => [x, -z]), null, 5, '#d9dde0', { rx: -PI / 2, y: 2.5 });
  for (const i of [5, 9, 12]) { const r = rings[i], rr = Math.hypot(r[1][0], r[1][2]) * 1.04; k.cyl(rr, rr, 0.5, 0, ys[i] - 0.25, 0, C.litB, { seg: 36, open: true, glow: true }); }
  // Tembo Deck 340 bis 352 m
  const deck = [[14.5, 335], [20, 338.5], [23.4, 341.2], [23.4, 352], [21.6, 354.6], [15, 357], [13.2, 357.5]];
  k.lathe(deck, 0, 0, 0, W, { seg: 36 });
  for (const [y0, y1] of [[341.9, 346.0], [347.0, 351.4]]) {
    k.cyl(23.55, 23.55, y1 - y0, 0, y0, 0, GL, { seg: 40, open: true });
    k.cyl(23.7, 23.7, (y1 - y0) * 0.86, 0, y0 + (y1 - y0) * 0.07, 0, C.litB, { seg: 40, open: true, glow: true });
    for (let i = 0; i < 40; i++) { const a = i * TAU / 40; k.box(0.35, y1 - y0, 0.35, Math.cos(a) * 23.8, y0, Math.sin(a) * 23.8, W); }
  }
  // oberes Gitter bis zur Galleria
  const up = [357, 376, 396, 417, 438].map((y, i) => circRing(lerp(13.2, 11.6, i / 4), y, 12, 0));
  k.loft(up.map(r => r.map(([x, y, z]) => [x * 0.82, y, z * 0.82])), W2, { smooth: true });
  lattice(k, up, W, { t: 0.7, posts: false });
  // Tembo Galleria 445 bis 450 m: schräges Glasband
  k.lathe([[11.4, 438], [14.8, 441.5], [15.6, 444], [15.6, 451], [13.6, 453.5], [10.6, 455]], 0, 0, 0, W, { seg: 32 });
  k.cyl(15.75, 15.75, 6, 0, 444.5, 0, GL, { seg: 32, open: true });
  k.cyl(15.9, 15.9, 5, 0, 445, 0, C.litB, { seg: 32, open: true, glow: true });
  for (let i = 0; i < 16; i++) { const a = i * TAU / 16; k.beam([Math.cos(a) * 16, 444.5, Math.sin(a) * 16], [Math.cos(a + 0.4) * 16, 450.5, Math.sin(a + 0.4) * 16], 0.35, W); }
  // Antennenturm (Gain Tower) bis 634 m
  k.cyl(8.6, 10.4, 42, 0, 455, 0, W, { seg: 16 });
  for (let i = 0; i < 12; i++) { const a = i * TAU / 12; k.beam([Math.cos(a) * 10.5, 455, Math.sin(a) * 10.5], [Math.cos(a) * 8.7, 497, Math.sin(a) * 8.7], 0.7, W2); }
  for (let i = 0; i < 6; i++) k.cyl(9.0 - i * 0.25, 9.0 - i * 0.25, 0.6, 0, 460 + i * 6.5, 0, W2, { seg: 16, open: true });
  k.cyl(6.0, 8.6, 6, 0, 497, 0, W, { seg: 16 });
  const steps = [[503, 4.6], [540, 4.0], [575, 3.2], [605, 2.4], [625, 1.4]];
  for (let i = 0; i < steps.length; i++) {
    const [y0, r0] = steps[i], y1 = i < steps.length - 1 ? steps[i + 1][0] : 632;
    k.cyl(r0 * 0.94, r0, y1 - y0, 0, y0, 0, i % 2 ? W : '#e3eaee', { seg: 12 });
    k.cyl(r0 + 0.6, r0 + 0.6, 0.8, 0, y0, 0, W2, { seg: 12 });
  }
  k.cone(0.9, 2.2, 0, 632, 0, W, { seg: 8 });
  for (const y of [634, 600, 560, 497]) for (let i = 0; i < 4; i++) { const a = i * PI / 2, r = y > 633 ? 0 : (y > 590 ? 3 : y > 550 ? 4.5 : 9); k.ball(0.8, Math.cos(a) * r, y, Math.sin(a) * r, C.litR, { ws: 6, hs: 4, glow: true }); if (y > 633) break; }
  return k.done();
}

// Tokyo Tower, 333 m: rot weißes Gitter (International Orange), vier Beine mit Bögen, Hauptdeck 150 m, Topdeck 250 m,
// Antenne, Foot Town darunter
function tokyo_tower() {
  const k = new K(), OR = '#e8714c', WH = '#f3efe8', GL = '#4c5a66';
  const Wd = (y) => 2 + 38 * Math.exp(-y / 96);
  const white = (y) => [[84, 98], [120, 134], [176, 189], [203, 216], [229, 242], [258, 268], [278, 288], [298, 308], [318, 333]].some(([a, b]) => y >= a && y < b);
  const col = (y) => (white(y) ? WH : OR);
  // Foot Town
  k.rbox(66, 15.5, 62, 0.5, 0, 0, 0, '#e8e6e1');
  for (const y of [3.2, 7.2, 11.2]) {
    for (const s of [-1, 1]) { k.box(62, 2.0, 0.2, 0, y - 1, s * 31.05, GL); k.box(60, 1.7, 0.2, 0, y - 0.85, s * 31.2, C.lit, { glow: true }); }
    for (const s of [-1, 1]) { k.box(0.2, 2.0, 58, s * 33.05, y - 1, 0, GL); k.box(0.2, 1.7, 56, s * 33.2, y - 0.85, 0, C.lit, { glow: true }); }
  }
  // vier Beine bis 46 m: je ein Gitterpfeiler aus vier Gurten
  const yl = [0, 12, 24, 35, 46];
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const ring = (y) => { const W = Wd(y), L = lerp(11, 5.5, y / 46); return [[W, y, W], [W - L, y, W], [W - L, y, W - L], [W, y, W - L]].map(([x, yy, z]) => [x * sx, yy, z * sz]); };
    const R = yl.map(ring);
    lattice(k, R, OR, { t: 0.7, tp: 1.2 });
  }
  // Bögen zwischen den Beinen auf jeder Seite
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => {
    const pts = curve(t => { const x = lerp(-1, 1, t), W0 = Wd(8) - 9; return [x * W0 * (1 - 0.12 * (1 - x * x)), 8 + 32 * Math.sqrt(1 - x * x), -Wd(8 + 32 * Math.sqrt(1 - x * x)) + 0.4]; }, 16);
    k.path(pts, 0.7, OR, { square: true });
    k.path(pts.map(([x, y, z]) => [x * 0.94, y + 2.6, z + 0.2]), 0.5, OR, { square: true });
    for (let i = 1; i < 16; i += 2) k.beam(pts[i], [pts[i][0] * 0.94, pts[i][1] + 2.6, pts[i][2] + 0.2], 0.35, OR);
  });
  // Rumpf: vier Eckgurte, Fachwerk je Feld
  const yb = [46, 56, 67, 78, 89, 100, 111, 122, 133, 145, 160, 170, 181, 192, 203, 214, 225, 236, 248];
  const sq = (y) => { const W = Wd(y); return [[W, y, -W], [W, y, W], [-W, y, W], [-W, y, -W]]; };
  for (let i = 0; i < yb.length - 1; i++) {
    const A = sq(yb[i]), B = sq(yb[i + 1]), c = col((yb[i] + yb[i + 1]) / 2);
    const wide = Wd(yb[i]) > 9;
    for (let j = 0; j < 4; j++) {
      const a = A[j], b = A[(j + 1) % 4], d = B[j], e = B[(j + 1) % 4];
      k.beam(a, d, 1.3, c); k.beam(a, b, 0.6, c);
      if (wide) {
        const am = a.map((v, q) => (v + b[q]) / 2), dm = d.map((v, q) => (v + e[q]) / 2);
        k.beam(a, dm, 0.5, c); k.beam(am, d, 0.5, c); k.beam(am, e, 0.5, c); k.beam(b, dm, 0.5, c); k.beam(am, dm, 0.5, c);
      } else { k.beam(a, e, 0.5, c); k.beam(b, d, 0.5, c); }
    }
  }
  // Hauptdeck 145 bis 160 m (zwei Geschosse), Topdeck 248 bis 254 m
  const deck = (y0, h, hw, ch, glow) => {
    const R = (y, s) => rectRing(hw * s, hw * s, y, 2, (x, yy, z, t) => [x * (t > 0.99 ? 1 - ch / hw : 1), yy, z * (t > 0.99 ? 1 - ch / hw : 1)]);
    k.loft([R(y0, 0.85), R(y0 + 0.8, 1), R(y0 + h, 1), R(y0 + h + 0.8, 0.9)], WH, { flat: true, capTop: true, capBot: true });
    for (const [a, b] of glow) {
      k.loft([R(y0 + a, 1.012), R(y0 + b, 1.012)], GL, { flat: true });
      k.loft([R(y0 + a + 0.3, 1.025), R(y0 + b - 0.3, 1.025)], C.lit, { flat: true, glow: true });
    }
  };
  deck(145, 6.4, 16, 4, [[1.6, 5.4]]);
  deck(152.2, 6.2, 14.5, 3.6, [[1.4, 5.2]]);
  k.rbox(20, 1.4, 20, 0.4, 0, 159.2, 0, WH);
  deck(248, 5.2, 8.2, 2.4, [[1.2, 4.4]]);
  // Antenne: schmales Gitter, dann Mast mit Ringen
  const ya = [254, 266, 278, 290, 302];
  const asq = (y) => { const W = lerp(3.4, 1.6, (y - 254) / 48); return [[W, y, -W], [W, y, W], [-W, y, W], [-W, y, -W]]; };
  for (let i = 0; i < ya.length - 1; i++) {
    const A = asq(ya[i]), B = asq(ya[i + 1]), c = col(ya[i] + 2);
    for (let j = 0; j < 4; j++) { k.beam(A[j], B[j], 0.6, c); k.beam(A[j], A[(j + 1) % 4], 0.35, c); k.beam(A[j], B[(j + 1) % 4], 0.3, c); }
  }
  for (let i = 0; i < 6; i++) k.cyl(0.9, 1.0, 5.2, 0, 302 + i * 5.2, 0, i % 2 ? WH : OR, { seg: 8 });
  k.cyl(0.4, 0.6, 2, 0, 333.2 - 2, 0, WH, { seg: 6 });
  for (const [y, r] of [[333.4, 0], [300, 2], [253, 9]]) for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4; k.ball(0.7, Math.cos(a) * r, y, Math.sin(a) * r, C.litR, { ws: 6, hs: 4, glow: true }); if (!r) break; }
  // Lichter am Gitter (nachts orange leuchtend, Landmark Light)
  for (const y of [60, 100, 140]) { const W = Wd(y) + 0.9; for (let j = 0; j < 4; j++) k.at(T(0, 0, 0, j * PI / 2), () => k.box(2 * W, 0.4, 0.4, 0, y, -W, '#ffb070', { glow: true })); }
  return k.done();
}

// Kaminarimon: rot lackiertes Tor des Sensō-ji, Walm Giebel Dach, riesige rote Laterne, Fūjin und Raijin hinter Gittern
function kaminarimon() {
  const k = new K(), RD = '#c9402f', RD2 = '#a93527', TL = '#5d6672';
  k.box(14, 0.5, 10.4, 0, 0, 0, '#bdb7ab'); k.box(12.8, 0.25, 9.2, 0, 0.5, 0, '#cfc9bd');
  const xs = [-5.3, -2.1, 2.1, 5.3], yc = 0.75, hp = 6.2;
  for (const x of xs) for (const z of [-3.1, 0, 3.1]) if (z === 0 ? Math.abs(x) > 3 : true) {
    k.cyl(0.32, 0.34, hp, x, yc, z, RD, { seg: 10 });
    k.cyl(0.42, 0.42, 0.35, x, yc, z, '#2e2b2b', { seg: 10 });
  }
  // Balken, Kopfbänder, Konsolen
  for (const z of [-3.1, 3.1]) {
    k.box(12.2, 0.55, 0.45, 0, yc + hp - 1.6, z, RD2);
    k.box(12.8, 0.7, 0.55, 0, yc + hp, z, RD);
    for (const x of xs) k.box(1.2, 0.5, 1.0, x, yc + hp + 0.7, z, '#3f6b5c');
  }
  for (const x of xs) k.box(0.5, 0.7, 7.2, x, yc + hp, 0, RD);
  k.box(12.6, 0.4, 7.6, 0, yc + hp + 1.2, 0, RD2);
  // Seitenfelder mit Gitter, dahinter die Götter
  for (const s of [-1, 1]) {
    k.box(2.8, hp - 0.4, 0.3, 3.7 * s, yc + 0.2, 0, RD2);
    for (const z of [-2.9, 2.9]) { for (let i = 0; i < 9; i++) k.box(0.1, hp - 1.8, 0.12, 2.3 * s + s * i * 0.36, yc + 0.6, z, '#7a2c22'); k.box(3.2, 0.2, 0.2, 3.7 * s, yc + 1.4, z, '#7a2c22'); }
    const gc = s < 0 ? '#5d8a6a' : '#c65a46';
    k.at(T(3.7 * s, yc + 0.6, -1.4), () => {
      k.box(1.6, 0.8, 1.2, 0, 0, 0, '#5a4a3a');
      k.lathe([[0.62, 0], [0.55, 1.2], [0.7, 2.0], [0.4, 2.5], [0, 2.6]], 0, 0.8, 0, gc, { seg: 8 });
      k.ball(0.35, 0, 3.6, 0, gc, { ws: 8, hs: 6 });
      if (s > 0) for (let i = 0; i < 8; i++) { const a = i * TAU / 8; k.ball(0.18, Math.cos(a) * 1.0, 3.2 + Math.sin(a) * 1.0, 0.2, '#d8b45a', { ws: 5, hs: 4 }); }
      else k.at(T(0, 3.4, 0.3, 0, 0, 0.3), () => k.cyl(0.1, 0.1, 2.2, 0, -1.1, 0, '#c9c0a8', { seg: 6, rz: PI / 2 }));
    });
  }
  // Dach: Walm mit Giebel oben, graue Ziegel, roter Unterbau
  const yr = yc + hp + 1.6;
  const top = jroof(k, { w: 15.4, d: 10.6, y: yr, rise: 3.0, ridge: 4.6, gable: 0.5, lift: 0.75, c: TL, under: RD2, fascia: '#4f5763', gableC: RD, wall: [12.6, 7.6], th: 0.55, ns: 10, nt: 6, pow: 1.5 });
  ridgeCap(k, -4.9, 4.9, top + 0.15, 0.55, '#4a525d', { ends: '#4a525d' });
  // Schild über der Laterne
  k.box(2.4, 1.3, 0.16, 0, yr - 1.45, -4.0, '#2b2828'); k.box(2.6, 0.12, 0.2, 0, yr - 0.17, -4.0, C.gold); k.box(2.6, 0.12, 0.2, 0, yr - 1.47, -4.0, C.gold);
  // große Laterne 3,9 m hoch, 3,3 m breit, schwarze Ringe, Schriftzeichen angedeutet
  const yL = 2.15;
  k.cyl(0.08, 0.08, yr - yL - 3.9, 0, yL + 3.9, 0, '#2b2828', { seg: 4 });
  k.cyl(1.25, 1.25, 0.3, 0, yL + 3.75, 0, '#2b2828', { seg: 16 });
  k.lathe([[1.15, 0], [1.5, 0.35], [1.65, 1.2], [1.65, 2.7], [1.5, 3.55], [1.15, 3.9]], 0, yL, 0, '#d13d2f', { seg: 20 });
  k.lathe([[1.15, 0], [1.5, 0.35], [1.65, 1.2], [1.65, 2.7], [1.5, 3.55], [1.15, 3.9]].map(([r, y]) => [r * 1.015, y]), 0, yL, 0, '#ff8a5c', { seg: 20, glow: true });
  for (let i = 1; i < 9; i++) k.cyl(1.66 * Math.sin(lerp(0.75, 2.4, i / 9)) * 1.02 + 0.0, 1.66 * Math.sin(lerp(0.75, 2.4, i / 9)) * 1.02, 0.05, 0, yL + i * 0.43, 0, '#b8352a', { seg: 20, open: true });
  k.cyl(1.25, 1.2, 0.35, 0, yL - 0.3, 0, '#2b2828', { seg: 16 });
  k.cyl(0.9, 1.25, 0.25, 0, yL - 0.55, 0, C.gold, { seg: 16 });
  for (const z of [-1, 1]) for (const [x, y, w, h] of [[-0.45, 2.6, 0.18, 1.3], [0.0, 2.9, 0.9, 0.16], [0.25, 2.3, 0.16, 1.0], [-0.1, 1.9, 0.8, 0.14], [0.5, 1.5, 0.16, 0.9], [-0.5, 1.2, 0.7, 0.14]])
    k.box(w, h, 0.06, x, yL + y - h / 2, z * 1.67, '#1f1c1c');
  return k.done();
}

// Fünfstöckige Pagode des Sensō-ji, 53 m: rote Stockwerke, fünf geschwungene Dächer, Balkone, goldener Sōrin
function sensoji_pagoda() {
  const k = new K(), RD = '#d4563d', RD2 = '#b7472f', TL = '#5f6874', GR = '#4f8a72', AU = '#cfa64e';
  k.box(15, 1.0, 15, 0, 0, 0, '#c9c3b6'); k.box(12.5, 0.8, 12.5, 0, 1.0, 0, '#ebe6da');
  const bw = [9.6, 8.6, 7.8, 7.0, 6.2], bh = [6.0, 3.8, 3.8, 3.8, 3.8], ew = [17.6, 15.8, 14.4, 13.0, 11.8];
  let y = 1.8;
  for (let i = 0; i < 5; i++) {
    const b = bw[i], h = bh[i];
    k.rbox(b, h, b, 0.15, 0, y, 0, RD);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(0.45, h, 0.45, dx * b / 2, y, dz * b / 2, RD2);
    for (const [n, cx, cz] of [[[0, -1], 0, -b / 2], [[0, 1], 0, b / 2], [[1, 0], b / 2, 0], [[-1, 0], -b / 2, 0]]) {
      k.panel([cx, y + h * 0.45, cz], n, b * 0.14, h * 0.36, i ? '#8a6a3a' : '#7b2d22', { off: 0.06 });
      for (const u of [-b * 0.32, b * 0.32]) k.panel([cx + (n[1] ? u : 0), y + h * 0.5, cz + (n[0] ? u : 0)], n, b * 0.09, h * 0.22, GR, { off: 0.06 });
    }
    // Balkon mit Geländer (ab dem zweiten Stock)
    if (i > 0) { k.box(b + 1.6, 0.25, b + 1.6, 0, y - 0.25, 0, RD2); balustrade(k, 0, 0, b / 2 + 0.7, b / 2 + 0.7, y, 0.9, 1.2, RD); }
    // Konsolen unter dem Dach
    y += h;
    k.box(b + 0.8, 0.5, b + 0.8, 0, y, 0, '#3f6b5c');
    k.box(b + 1.8, 0.5, b + 1.8, 0, y + 0.5, 0, RD2);
    const ye = y + 1.0, E = ew[i];
    const next = i < 4 ? bw[i + 1] : 3.0;
    const tEnd = clamp(1 - (next / 2 + 0.3) / (E / 2), 0.2, 1);
    const rise = (i < 4 ? 1.6 : 3.4) / Math.pow(tEnd, 1.6);
    const top = jroof(k, { w: E, d: E, y: ye, rise, ridge: 0, lift: 1.0, c: TL, under: RD2, fascia: '#4f5862', wall: [b + 1.8, b + 1.8], th: 0.55, ns: 12, nt: 5, tEnd, pow: 1.6 });
    // Windglocken an den Ecken, Licht unter der Traufe
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { k.box(0.06, 0.9, 0.06, dx * E / 2 * 1.02, ye - 0.3, dz * E / 2 * 1.02, '#3a3a3a'); k.ball(0.22, dx * E / 2 * 1.02, ye - 0.5, dz * E / 2 * 1.02, AU, { ws: 6, hs: 4 }); }
    for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => k.box(E * 0.82, 0.18, 0.18, 0, ye - 0.85, -E / 2 * 0.92, C.lit, { glow: true }));
    y = top;
  }
  // Sōrin: Sockel, Schale, neun Ringe, Wasserflamme, Juwel
  k.box(2.4, 1.0, 2.4, 0, y - 0.3, 0, '#4b4f55');
  k.ball(1.25, 0, y + 0.7, 0, AU, { ws: 12, hs: 6, t0: PI / 2, tl: PI / 2 });
  k.ball(1.25, 0, y + 0.7, 0, AU, { ws: 12, hs: 4, t0: 0, tl: PI / 2, sy: 0.4 });
  k.cyl(0.28, 0.32, 14.6, 0, y + 0.7, 0, AU, { seg: 8 });
  for (let i = 0; i < 9; i++) k.cyl(1.05 - i * 0.04, 1.05 - i * 0.04, 0.22, 0, y + 2.4 + i * 1.05, 0, AU, { seg: 14 });
  const yf = y + 12.2;
  for (let f = 0; f < 2; f++) k.at(T(0, yf, 0, f * PI / 2), () => k.ext([[-0.9, 0], [0.9, 0], [1.1, 0.9], [0.6, 1.8], [0.3, 1.4], [0, 2.4], [-0.3, 1.4], [-0.6, 1.8], [-1.1, 0.9]], null, 0.12, AU));
  k.ball(0.42, 0, yf + 2.8, 0, AU, { ws: 10, hs: 8 });
  k.ball(0.32, 0, yf + 3.5, 0, AU, { ws: 10, hs: 8, sy: 1.4 });
  return k.done();
}

// Fushimi Yagura: zweistöckiger weißer Wachturm auf geschwungener Steinmauer am Wassergraben, lange Tamon Flügel
function kokyo_fushimi() {
  const k = new K(), WH = '#f2efe8', TL = '#5f6874', ST = '#a9a397';
  // Steinmauer: Vorderseite (-z) hohl geschwungen, in Lagen und Blöcken
  const HW = 13, X0 = -46, X1 = 46, NX = 23, NY = 10;
  const zf = (y) => -22 + 8 * Math.pow(y / HW, 1.8);
  const rings = [];
  for (let i = 0; i <= NY; i++) { const y = i / NY * HW, r = []; for (let j = 0; j <= NX; j++) r.push([lerp(X1, X0, j / NX), y, zf(y)]); rings.push(r); }
  k.loft(rings, ST, { open: true, flat: true, inv: true, cfi: (i, j) => shade(ST, 0.93 + 0.14 * hash(i * 7 + ((j + (i % 2) * 0.5) | 0), 3)) });
  k.box(X1 - X0, 0.6, 26, 0, HW - 0.6, -1, '#a8a296');
  k.box(X1 - X0, HW, 12, 0, 0, 6, ST);
  for (const s of [-1, 1]) k.face([[s * X1, 0, -22], [s * X1, 0, 12], [s * X1, HW, 12], [s * X1, HW, zf(HW)]], ST, [s, 0, 0]);
  k.box(X1 - X0 + 0.4, 0.4, 25, 0, HW, -0.8, '#c9c3b6');
  // Tamon: lange einstöckige Flügel links und rechts
  const yb = HW + 0.4;
  for (const [x0, x1] of [[-44, -18], [1, 44]]) {
    const cx = (x0 + x1) / 2, L = x1 - x0;
    k.box(L, 4.2, 6.2, cx, yb, -8, WH);
    k.box(L, 1.0, 6.3, cx, yb, -8, '#4f5560');
    for (let i = 0; i < Math.floor(L / 4); i++) k.panel([x0 + 2 + i * 4, yb + 2.5, -11.12], [0, -1], 0.55, 0.45, '#3d3a37', { off: 0.03 });
    k.at(T(cx, 0, -8), () => {
      const top = jroof(k, { w: L + 2, d: 8.6, y: yb + 4.2, rise: 2.6, ridge: L / 2 - 1, gable: 0.6, lift: 0.4, c: TL, under: '#e8e3d6', fascia: WH, gableC: WH, wall: [L, 6.2], th: 0.45, ns: 8, nt: 5, pow: 1.4 });
      ridgeCap(k, -L / 2 + 1.5, L / 2 - 1.5, top + 0.1, 0.45, '#4f5762', { ends: '#4f5762' });
    });
  }
  // Yagura: zwei Geschosse, Walm Giebel Dächer, Ziergiebel (Chidori Hafu) vorn
  const X = -8.5, Z = -6;
  k.at(T(X, yb, Z, 0, 0, 0, 1.22), () => {
    k.box(14, 6.2, 11, 0, 0, 0, WH);
    k.box(14.1, 1.6, 11.1, 0, 0, 0, '#4f5560');
    for (const [n, c, L, cnt] of [[[0, -1], [0, 0, -5.5], 14, 4], [[1, 0], [7, 0, 0], 11, 3], [[-1, 0], [-7, 0, 0], 11, 3]]) facade(k, c, n, L, [3.8], cnt, 1.1, 1.0, { col: '#3d3a37', lit: false });
    const t1 = jroof(k, { w: 17, d: 14, y: 6.2, rise: 2.2, ridge: 3.2, gable: 0.0, lift: 0.7, c: TL, under: '#e8e3d6', fascia: WH, wall: [14, 11], th: 0.5, ns: 10, nt: 5, tEnd: 0.55, pow: 1.4 });
    k.box(10, 4.6, 7.8, 0, t1 - 0.5, 0, WH);
    facade(k, [0, t1 - 0.5, -3.9], [0, -1], 10, [2.4], 3, 1.0, 0.9, { col: '#3d3a37', lit: false });
    const t2 = jroof(k, { w: 13, d: 10.6, y: t1 + 4.1, rise: 3.3, ridge: 3.6, gable: 0.55, lift: 0.7, c: TL, under: '#e8e3d6', fascia: WH, gableC: WH, wall: [10, 7.8], th: 0.5, ns: 10, nt: 6, pow: 1.4 });
    ridgeCap(k, -3.4, 3.4, t2 + 0.1, 0.5, '#4f5762', { ends: '#4f5762' });
    // Ziergiebel auf dem unteren Dach vorn
    k.at(T(0, t1 - 1.4, -5.6), () => { k.face([[-2.6, 0, 0], [2.6, 0, 0], [0, 2.2, 0]], WH, [0, 0, -1]); k.beam([-3.0, -0.15, -0.1], [0, 2.4, -0.1], [0.4, 0.5], TL); k.beam([3.0, -0.15, -0.1], [0, 2.4, -0.1], [0.4, 0.5], TL); });
  });
  return k.done();
}

// Nijūbashi: steinerne Doppelbogenbrücke (Meganebashi) mit Granitbrüstung und Bronze Laternen
function nijubashi() {
  const k = new K(), G = '#d9d5cc', G2 = '#c6c1b6', BR = '#3f4a45';
  const L = 34, HD = 6.4;
  const hole = (cx) => { const o = [[cx - 5.6, -0.6], [cx + 5.6, -0.6]]; for (let i = 0; i <= 14; i++) { const a = i / 14 * PI; o.push([cx + Math.cos(a) * 5.6, 0.2 + Math.sin(a) * 4.6]); } o.splice(2, 1); return o; };
  k.ext([[-L / 2, -1.2], [L / 2, -1.2], [L / 2, HD], [-L / 2, HD]], [hole(-7.4), hole(7.4)], 10, G, { cs: 1 });
  for (const cx of [-7.4, 7.4]) for (const z of [-5.05, 5.05]) k.ext([...arc(cx, 0.2, 6.3, 0, PI, 14, 5.3), ...arc(cx, 0.2, 5.6, PI, 0, 14, 4.6)], null, 0.2, G2, { z });
  k.box(L + 0.6, 0.35, 10.6, 0, HD, 0, G2);
  // Brüstung mit Pfosten
  for (const z of [-4.95, 4.95]) {
    k.box(L, 0.9, 0.45, 0, HD + 0.35, z, G);
    k.box(L + 0.2, 0.22, 0.6, 0, HD + 1.25, z, G2);
    for (let i = 0; i <= 8; i++) k.box(0.7, 1.4, 0.7, -L / 2 + i * L / 8, HD + 0.35, z, G2);
  }
  // Laternen: Bronzepfosten mit großer Kugel und vier kleinen
  for (const x of [-15.6, 0, 15.6]) for (const z of [-4.95, 4.95]) {
    const y0 = HD + 1.75;
    k.cyl(0.25, 0.4, 3.4, x, y0, z, BR, { seg: 8 });
    k.box(1.6, 0.12, 0.12, x, y0 + 2.6, z, BR); k.box(0.12, 0.12, 1.6, x, y0 + 2.6, z, BR);
    k.ball(0.62, x, y0 + 3.9, z, '#f0ebdc', { ws: 8, hs: 6 }); k.ball(0.66, x, y0 + 3.9, z, C.litW, { ws: 8, hs: 6, glow: true });
    for (const [dx, dz] of [[0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]]) { k.ball(0.32, x + dx, y0 + 2.95, z + dz, '#f0ebdc', { ws: 6, hs: 4 }); k.ball(0.35, x + dx, y0 + 2.95, z + dz, C.litW, { ws: 6, hs: 4, glow: true }); }
  }
  // Uferköpfe
  for (const s of [-1, 1]) { k.box(4, HD + 0.35, 13, s * (L / 2 + 2), -1.2, 0, G2); k.box(4.4, 0.3, 13.4, s * (L / 2 + 2), HD - 0.85 + 1.2, 0, G); }
  return k.done();
}

// Großes Torii des Meiji Jingū: unbemaltes Zypressenholz, 12 m hoch, Kasagi 17 m mit geschwungenen Enden
function meiji_torii() {
  const k = new K(), WD = '#a29482', WD2 = '#8d7f6c';
  for (const s of [-1, 1]) {
    k.cyl(0.6, 0.62, 10.6, s * 4.55, 0, 0, WD, { seg: 16 });
    k.cyl(0.74, 0.76, 0.9, s * 4.55, 0, 0, '#3b3836', { seg: 16 });
    k.cyl(0.95, 1.0, 0.25, s * 4.55, 0, 0, '#b9b3a6', { seg: 16 });
    k.box(0.35, 0.5, 1.5, s * 5.25, 8.25, 0, WD2);
  }
  k.box(13.2, 0.8, 0.55, 0, 8.0, 0, WD);
  k.box(0.65, 1.6, 0.5, 0, 8.8, 0, WD2);
  k.box(16.0, 0.6, 0.85, 0, 10.4, 0, WD);
  const pts = [];
  for (let i = 0; i <= 16; i++) { const x = lerp(-8.55, 8.55, i / 16), q = Math.pow(Math.abs(x) / 8.55, 2.4); pts.push([x, 11.0 + 0.45 * q]); }
  for (let i = 16; i >= 0; i--) { const x = lerp(-8.55, 8.55, i / 16), q = Math.pow(Math.abs(x) / 8.55, 2.4); pts.push([x * (i === 0 || i === 16 ? 1.02 : 1), 11.95 + 0.62 * q]); }
  k.ext(pts, null, 1.2, WD);
  k.ext(pts.slice(17).map(([x, y]) => [x, y + 0.13]).concat(pts.slice(17).reverse().map(([x, y]) => [x, y - 0.02])), null, 1.3, '#5f5c55');
  return k.done();
}

// Tokyo Station, Marunouchi Seite: 335 m Ziegelfassade mit weißen Bändern, zwei achteckige Kuppeln, Mittelbau
function tokyo_station() {
  const k = new K(), BR = '#c4664f', WS = '#efe9dc', RF = '#5c6470', D = 22;
  const fo = { col: C.win, lc: C.lit, frame: WS, ft: 0.25 };
  // Hauptkörper in Abschnitten (Lücken für die Pavillons)
  k.rbox(326, 18.5, D, 0.3, 0, 0, 0, BR);
  for (const y of [0, 6.3, 12.4]) cornice(k, 0, 0, 326, D, y, y ? 0.7 : 1.2, 0.25, WS);
  cornice(k, 0, 0, 326, D, 18.2, 0.9, 0.5, WS);
  k.ext([[-D / 2 - 0.6, 0], [D / 2 + 0.6, 0], [3, 6], [-3, 6]], null, 326, RF, { ry: PI / 2, y: 19.1 });
  // Fenster: vorn dicht, hinten einfach
  const skip = (u) => [-150, -75, 0, 75, 150].some(x => Math.abs(u - x) < 18);
  facade(k, [0, 0, -D / 2], [0, -1], 320, [3.4, 9.4, 15.4], 104, 1.3, 2.6, { ...fo, skip });
  facade(k, [0, 0, D / 2], [0, 1], 320, [3.4, 9.4, 15.4], 70, 1.3, 2.4, { col: C.win, lc: C.lit });
  for (let i = 0; i < 34; i++) { const x = -158 + i * 9.6; if (!skip(x)) k.box(1.2, 0.9, 1.8, x, 21.5, -6.5, RF); }
  // Pavillons: zwei Kuppelhallen, Mittelbau, Zwischenbauten, Endbauten
  const pav = (x, w, h, roof) => {
    k.rbox(w, h, D + 4, 0.3, x, 0, 0, BR);
    for (const y of [6.3, 12.4]) cornice(k, x, 0, w, D + 4, y, 0.7, 0.25, WS);
    cornice(k, x, 0, w, D + 4, h - 0.4, 1.0, 0.5, WS);
    for (const dx of [-w / 2, w / 2]) k.box(1.4, h, 1.4, x + dx, 0, -D / 2 - 2, WS);
    facade(k, [x, 0, -D / 2 - 2], [0, -1], w - 3, [3.4, 9.4, 15.4], Math.max(2, Math.round(w / 3.4)), 1.3, 2.6, fo);
    if (roof === 'hip') hipRoof(k, x, 0, w, D + 4, h + 0.6, 7, RF, { ov: 0.5 });
  };
  pav(-75, 14, 21, 'hip'); pav(75, 14, 21, 'hip');
  pav(-165, 8, 19.5, 'hip'); pav(165, 8, 19.5, 'hip');
  // Mittelbau
  pav(0, 34, 23, null);
  k.ext([[-14, 0], [14, 0], [4, 8], [-4, 8]], null, 30, RF, { y: 23.6 });
  k.cyl(2.4, 2.8, 3, 0, 31.4, 0, WS, { seg: 8 }); k.lathe(domeProfile(2.8, 3, 'helm', 6), 0, 34.4, 0, '#7da38f', { seg: 8 });
  for (const x of [-9, 9]) { k.box(5, 8, 5, x, 23, -12.5, BR); k.cyl(0, 3.9, 4.5, x, 31, -12.5, RF, { seg: 4, ry: PI / 4 }); }
  // Kuppelhallen Süd (-x) und Nord (+x): achteckiger Tambour, dunkle Kuppel mit Rippen und Gauben, Ecktürmchen
  for (const s of [-1, 1]) {
    const x = s * 150;
    pav(x, 34, 23, null);
    k.cyl(13.2, 13.6, 7, x, 23.6, 0, BR, { seg: 8, ry: PI / 8, flat: true });
    k.cyl(14.4, 14.4, 0.9, x, 30, 0, WS, { seg: 8, ry: PI / 8, flat: true });
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8; win(k, [x + Math.cos(a) * 12.6, 26.8, Math.sin(a) * 12.6], [Math.cos(a), Math.sin(a)], 1.8, 3.4, { ...fo, kind: 'arch' }); }
    const prof = [[14, 0], [13.6, 2.4], [12.2, 5], [9.4, 7.6], [5.6, 9.6], [2.2, 10.8], [1.2, 11.2]];
    k.lathe(prof, x, 30.9, 0, RF, { seg: 8, flat: true, ry: PI / 8 });
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8 + PI / 8 - PI / 8; k.path(prof.map(([r, y]) => [x + Math.cos(a) * (r + 0.15), 30.9 + y, Math.sin(a) * (r + 0.15)]), 0.25, '#8a929c', { square: true }); }
    for (let i = 0; i < 8; i++) { const a = (i + 0.5) * TAU / 8; k.box(1.4, 1.6, 1.4, x + Math.cos(a) * 11.6, 34.6, Math.sin(a) * 11.6, WS, { ry: -a }); }
    k.cyl(1.0, 1.2, 2.2, x, 42.1, 0, WS, { seg: 8 }); k.cone(0.9, 2.6, x, 44.3, 0, '#7da38f', { seg: 8 });
    for (const [dx, dz] of [[-16, -12.5], [16, -12.5], [-16, 12.5], [16, 12.5]]) { k.box(3.2, 25, 3.2, x + dx, 0, dz, BR); k.lathe(domeProfile(2.0, 3.6, 'helm', 6), x + dx, 25, dz, '#7da38f', { seg: 8 }); }
  }
  return k.done();
}

// Rainbow Bridge: Hängebrücke 798 m, weiße Türme 126 m, doppelstöckiges Fachwerk, Fahrbahn auf rund 50 m,
// nachts weiße Lichter an den Tragseilen
function rainbow_bridge() {
  const k = new K(), W = '#eef0f1', W2 = '#d6dade', CB = '#e2e5e8';
  const XT = 285, XA = 399, yL = 50, yU = 59, HZ = 15;
  // Fachwerkträger (zwei Ebenen), Fahrbahnplatten
  k.box(2 * XA, 0.8, 2 * HZ, 0, yL - 0.4, 0, W2); k.box(2 * XA, 0.9, 2 * HZ + 2, 0, yU, 0, W);
  for (const z of [-HZ, HZ]) {
    k.beam([-XA, yL, z], [XA, yL, z], [1.2, 1.4], W); k.beam([-XA, yU, z], [XA, yU, z], [1.2, 1.4], W);
    for (let x = -XA; x < XA - 1; x += 15) { k.beam([x, yL, z], [x, yU, z], 0.7, W); k.beam([x, yL, z], [x + 15, yU, z], 0.6, W); }
  }
  for (let x = -XA + 60; x < XA; x += 60) for (const z of [-HZ - 1, HZ + 1]) { k.box(0.4, 1.4, 0.4, x, yU + 0.9, z, '#9aa2aa'); k.box(0.6, 0.3, 0.6, x, yU + 2.2, z, C.litW, { glow: true }); }
  // Türme: zwei Beine mit Querriegeln, Pfeiler im Wasser
  for (const s of [-1, 1]) {
    const x = s * XT;
    k.rbox(18, 8, 46, 0.6, x, 0, 0, '#cfd2d4');
    for (const zs of [-1, 1]) {
      const z = zs * (HZ + 3.5);
      k.loft([rectRing(4.4, 3.8, 8), rectRing(3.0, 2.6, 126)].map(r => r.map(([a, b, c]) => [x + a, b, z + c])), W, { flat: true, capTop: true });
      k.box(7.2, 2.6, 6.2, x, 123.4, z, W2);
    }
    for (const [y, h] of [[42, 6], [66, 4], [96, 4], [118, 6]]) k.box(5.6, h, 2 * (HZ + 3.5), x, y, 0, W);
    for (const zs of [-1, 1]) k.ball(0.9, x, 127, zs * (HZ + 3.5), C.litR, { ws: 6, hs: 4, glow: true });
  }
  // Verankerungen
  for (const s of [-1, 1]) { k.rbox(36, 64, 48, 0.8, s * (XA + 10), 0, 0, '#d4d6d6'); k.box(34, 2, 46, s * (XA + 10), 64, 0, W2); }
  // Tragseile mit Licht, Hänger
  for (const zs of [-1, 1]) {
    const z = zs * (HZ + 3.5);
    const main = curve(t => { const x = lerp(-XT, XT, t); return [x, 63 + 60 * Math.pow(x / XT, 2), z]; }, 40);
    k.path(main, 0.7, CB);
    k.path(main.map(([x, y, zz]) => [x, y + 0.6, zz]), 0.3, C.litW, { glow: true });
    for (const s of [-1, 1]) {
      const side = curve(t => { const x = s * lerp(XT, XA + 4, t); return [x, 123 - (123 - 66) * t + 18 * Math.sin(PI * t) * -1 + 8 * t * (1 - t) * 0, z]; }, 12);
      k.path(side, 0.7, CB);
      k.path(side.map(([x, y, zz]) => [x, y + 0.6, zz]), 0.3, C.litW, { glow: true });
      for (let i = 1; i < 12; i++) k.beam([side[i][0], side[i][1], z], [side[i][0], yU + 0.5, z * 0.93], 0.22, '#c9ced2');
    }
    for (let i = 1; i < 40; i++) k.beam([main[i][0], main[i][1], z], [main[i][0], yU + 0.5, z * 0.93], 0.22, '#c9ced2');
  }
  return k.done();
}

// =====================================================================================================
// Paris
// =====================================================================================================

// Eiffelturm, 330 m: vier geschwungene Gitterbeine, Zierbögen, drei Etagen, Spitze mit Antennen. Nachts golden
function eiffelturm() {
  const k = new K(), BR = '#957b62', BR2 = '#7f6853', AU = '#ffcf75';
  const Wo = (y) => 4.33 + 58.2 * Math.exp(-y / 89);
  const Wi = (y) => Math.max(0, 37 * Math.pow(Math.max(0, 1 - y / 180), 1.25));
  const ys = [0, 11, 22, 33, 45, 57, 68, 80, 92, 104, 116, 132, 148, 164, 180];
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const ring = (y) => { const o = Wo(y), i = Wi(y); return [[o, y, o], [i, y, o], [i, y, i], [o, y, i]].map(([x, yy, z]) => [x * sx, yy, z * sz]); };
    const R = ys.map(ring);
    for (let r = 0; r < R.length; r++) {
      const A = R[r];
      for (let j = 0; j < 4; j++) {
        k.beam(A[j], A[(j + 1) % 4], 0.7, BR2);
        if (r < R.length - 1) {
          const B = R[r + 1], wide = Math.hypot(A[j][0] - A[(j + 1) % 4][0], A[j][2] - A[(j + 1) % 4][2]) > 13;
          k.beam(A[j], B[j], 1.7, BR);
          trussFace(k, A[j], A[(j + 1) % 4], B[(j + 1) % 4], B[j], BR, 0.55, wide);
        }
      }
    }
    // Lichtgurt außen (nachts golden)
    for (let r = 0; r < R.length - 1; r++) k.beam([R[r][0][0] * 1.012, ys[r], R[r][0][2] * 1.012], [R[r + 1][0][0] * 1.012, ys[r + 1], R[r + 1][0][2] * 1.012], 0.6, AU, { glow: true });
  }
  // oberer Schaft
  const yt = [180, 192, 204, 216, 228, 240, 252, 264, 276];
  for (let r = 0; r < yt.length - 1; r++) {
    const sq = (y) => { const W = Wo(y); return [[W, y, -W], [W, y, W], [-W, y, W], [-W, y, -W]]; };
    const A = sq(yt[r]), B = sq(yt[r + 1]);
    for (let j = 0; j < 4; j++) { k.beam(A[j], B[j], 1.3, BR); k.beam(A[j], A[(j + 1) % 4], 0.6, BR2); trussFace(k, A[j], A[(j + 1) % 4], B[(j + 1) % 4], B[j], BR, 0.45, r < 2); k.beam([A[j][0] * 1.03, yt[r], A[j][2] * 1.03], [B[j][0] * 1.03, yt[r + 1], B[j][2] * 1.03], 0.45, AU, { glow: true }); }
  }
  // Zierbögen unter der ersten Etage
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => {
    const A = Wi(18) + 2;
    const pts = curve(t => { const x = lerp(-A, A, t), y = 18 + 34 * Math.sqrt(Math.max(0, 1 - (x / A) ** 2)); return [x, y, -Wo(y) - 0.3]; }, 18);
    k.path(pts, 0.8, BR, { square: true });
    k.path(pts.map(([x, y]) => [x * 0.96, y + 2.2, -Wo(y + 2.2) - 0.3]), 0.5, BR, { square: true });
    for (let i = 2; i < 18; i += 2) { const [x, y] = pts[i]; k.beam([x, y, -Wo(y) - 0.3], [x, 55, -Wo(55) - 0.3], 0.35, BR2); }
  });
  // erste Etage 57 m: Ringplattform mit Galerie und Glaspavillons
  const P1 = (y, o, i) => { for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => k.box(2 * o, 1.2, o - i, 0, y, -(o + i) / 2, BR2)); };
  P1(56.5, 36.2, 15);
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => {
    k.box(72.4, 3.6, 1.0, 0, 57.7, -36.0, BR);
    for (let i = 0; i < 18; i++) k.plate([-34 + i * 4, 59.5, -36.55], [0, -1], archHole(0, 3.0, -1.4, 0.2, 4), BR2, { off: 0.02 });
    k.box(72, 0.5, 1.4, 0, 61.3, -36.0, BR2);
    k.box(30, 6, 5, f % 2 ? 0 : 8, 57.7, -30, '#9fb4bf');
    k.box(29, 4.6, 0.2, f % 2 ? 0 : 8, 58.4, -32.6, C.lit, { glow: true });
    k.box(73, 0.5, 0.5, 0, 61.9, -36.6, AU, { glow: true });
  });
  // zweite Etage 116 m
  P1(115.5, 21, 9);
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => { k.box(42, 2.4, 0.8, 0, 116.7, -20.6, BR); k.box(14, 5, 4, 0, 116.7, -12, '#9fb4bf'); k.box(42.5, 0.5, 0.5, 0, 119.2, -21.1, AU, { glow: true }); });
  k.box(10, 14, 10, 0, 116.7, 0, BR2);
  // dritte Etage 276 m: verglaste Kabine, Aufbau, Leuchtfeuer, Antennen
  k.box(18.5, 1.2, 18.5, 0, 275.5, 0, BR2);
  k.box(16.5, 5.2, 16.5, 0, 276.7, 0, '#9fb4bf');
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => k.box(15.5, 3.6, 0.2, 0, 277.4, -8.35, C.lit, { glow: true }));
  k.box(18, 0.8, 18, 0, 281.9, 0, BR2);
  k.box(9, 6, 9, 0, 282.7, 0, BR);
  k.cyl(3.4, 4.2, 6, 0, 288.7, 0, BR, { seg: 8 });
  k.cyl(2.2, 2.2, 4, 0, 294.7, 0, '#d8e4ea', { seg: 8 }); k.cyl(2.4, 2.4, 3, 0, 295.2, 0, AU, { seg: 8, glow: true });
  k.cone(2.6, 3, 0, 298.7, 0, BR2, { seg: 8 });
  k.cyl(0.8, 1.2, 14, 0, 301.7, 0, '#d9d6cf', { seg: 8 }); k.cyl(0.35, 0.6, 14, 0, 315.7, 0, '#e3dfd6', { seg: 6 });
  for (const y of [306, 312]) k.cyl(2.5, 2.5, 1.2, 0, y, 0, '#e3dfd6', { seg: 8 });
  k.ball(0.6, 0, 330, 0, C.litR, { ws: 6, hs: 4, glow: true });
  return k.done();
}

// Arc de Triomphe: 50 m hoch, 45 m breit, 22 m tief, großer Bogen 29 m, Querbögen, Reliefs, Attika mit Schilden
function arc_de_triomphe() {
  const k = new K(), S = '#ebe2cd', S2 = '#dcd1b9', S3 = '#cfc3a8';
  const W = 45, D = 22, H1 = 37;
  // Pfeiler mit Querbögen (durchbrochen in x)
  for (const s of [-1, 1]) k.ext([[-D / 2, -0.4], [D / 2, -0.4], [D / 2, H1], [-D / 2, H1]], [archHole(0, 8.44, 0, 14.46, 10)], 15.19, S, { ry: PI / 2, x: s * (W / 2 - 15.19 / 2) });
  // Bogenstück über dem großen Bogen
  k.ext([[7.31, 21.88], [7.31, H1], [-7.31, H1], [-7.31, 21.88], ...arc(0, 21.88, 7.31, PI, 0, 14).slice(1, -1)], null, D, S);
  // Archivolten um den großen Bogen vorn und hinten
  for (const z of [-D / 2 - 0.25, D / 2 + 0.25]) {
    k.ext([...arc(0, 21.88, 8.4, 0, PI, 16), ...arc(0, 21.88, 7.31, PI, 0, 16)], null, 0.5, S2, { z });
    for (const s of [-1, 1]) k.box(1.1, 21.88, 0.5, s * 7.85, 0, z, S2);
  }
  for (const s of [-1, 1]) for (const x of [-1, 1]) k.ext([...arc(0, 14.46, 4.9, 0, PI, 10), ...arc(0, 14.46, 4.22, PI, 0, 10)], null, 0.4, S2, { ry: PI / 2, x: s * (W / 2 + 0.2) * 1, z: 0 });
  // Reliefgruppen an den Pfeilern, Friese, Gesimse
  for (const z of [-D / 2, D / 2]) for (const s of [-1, 1]) {
    k.rbox(8.5, 11, 1.4, 0.6, s * 15.2, 4.2, z + Math.sign(z) * 0.5, S3);
    k.box(9, 1.0, 1.2, s * 15.2, 3.4, z + Math.sign(z) * 0.4, S2);
    k.rbox(10, 4.5, 0.6, 0.2, s * 15.2, 25, z + Math.sign(z) * 0.2, S3);
  }
  for (const sx of [-1, 1]) { for (const sz of [-1, 1]) k.box(15.19 + 0.5, 1.2, 7.6, sx * (W / 2 - 15.19 / 2), 0, sz * 7.7, S2); k.box(15.19 + 0.6, 0.8, D + 0.6, sx * (W / 2 - 15.19 / 2), 19.8, 0, S2); }
  k.box(W + 0.6, 2.6, D + 0.6, 0, 31.5, 0, S2);
  cornice(k, 0, 0, W, D, H1 - 0.2, 1.4, 0.9, S);
  // Attika mit Schildband, oberes Gesims
  k.rbox(W, 11.8, D, 0.3, 0, H1 + 1.2, 0, S);
  for (const [n, cx, cz, L, cnt] of [[[0, -1], 0, -D / 2, W, 14], [[0, 1], 0, D / 2, W, 14], [[1, 0], W / 2, 0, D, 7], [[-1, 0], -W / 2, 0, D, 7]])
    for (let i = 0; i < cnt; i++) { const u = (i - (cnt - 1) / 2) * L / cnt; k.plate([cx + (n[1] ? u : 0), H1 + 6.2, cz + (n[0] ? u : 0)], n, ngon(1.0, 10), S3, { off: 0.12 }); }
  cornice(k, 0, 0, W, D, H1 + 8.6, 0.6, 0.4, S2);
  cornice(k, 0, 0, W, D, H1 + 12.4, 0.6, 0.4, S2);
  k.box(W - 1, 0.4, D - 1, 0, 50, 0, S2);
  return k.done();
}

// Notre-Dame: Westfassade mit zwei flachen Türmen und Rosette (vorn bei -x), Schiff mit Bleidach, Strebebögen,
// Querhaus mit Rosetten, Chor mit Kapellenkranz, Vierungsturm 96 m
function notre_dame() {
  const k = new K(), S = '#e7ddc6', S2 = '#d6cab0', S3 = '#c7baa0', PB = '#87929e', PB2 = '#76818e';
  // Schiff und Chor (hohes Mittelschiff), Seitenschiffe, Querhaus
  k.box(98, 33, 14.6, -1, 0, 0, S);
  gableRoof(k, -1, 0, 98, 14.6, 33, 10.5, PB, { ov: 0.6 });
  for (const s of [-1, 1]) {
    k.box(98, 20, 13, -1, 0, s * 13.8, S2);
    k.slab([[-50, 23.5, s * 7.3], [48, 23.5, s * 7.3], [48, 19.5, s * 20.9], [-50, 19.5, s * 20.9]], 0.6, PB2);
  }
  k.box(14, 33, 48, 8, 0, 0, S);
  gableRoof(k, 8, 0, 48, 14, 33, 10.5, PB, { ov: 0.6, alongZ: true });
  for (const s of [-1, 1]) {
    k.plate([8, 22, s * 24], [0, s], ngon(6.2, 24), S3, { off: 0.08 });
    k.plate([8, 22, s * 24], [0, s], ngon(5.4, 24), C.lit, { off: 0.22, glow: true });
    for (let i = 0; i < 12; i++) { const a = i * TAU / 12; k.beam([8 + Math.cos(a) * 0.6, 22 + Math.sin(a) * 0.6, s * 24.3], [8 + Math.cos(a) * 5.6, 22 + Math.sin(a) * 5.6, s * 24.3], 0.3, S2); }
    for (let i = 0; i < 4; i++) win(k, [3 + i * 3.3, 9, s * 24], [0, s], 1.6, 9, { kind: 'pointed', col: '#5a6470' });
  }
  // Chorhaupt: Apsis, Umgang mit Kapellen
  k.cyl(7.3, 7.3, 33, 48, 0, 0, S, { seg: 16, t0: 0, tl: PI });
  k.lathe([[7.9, 0], [0.2, 10.5]], 48, 33, 0, PB, { seg: 16, p0: 0, pl: PI });
  k.cyl(20.6, 20.6, 20, 48, 0, 0, S2, { seg: 20, t0: 0, tl: PI });
  k.lathe([[20.6, 0], [7.3, 3.5]], 48, 20, 0, PB2, { seg: 20, p0: 0, pl: PI });
  // Fenster im Obergaden und in den Seitenschiffen
  for (const s of [-1, 1]) for (let i = 0; i < 13; i++) {
    const x = -46 + i * 7.2; if (Math.abs(x - 8) < 9) continue;
    win(k, [x, 27.5, s * 7.3], [0, s], 2.4, 8, { kind: 'pointed', col: '#5a6470', lc: '#ffcf8a' });
    win(k, [x, 11, s * 20.3], [0, s], 2.2, 8, { kind: 'pointed', col: '#5a6470', lc: '#ffcf8a' });
  }
  // Strebebögen und Strebepfeiler mit Fialen
  const buttress = (x, z, s) => {
    k.box(2.2, 25, 2.6, x, 0, z, S2);
    pinnacle(k, x, 25, z, 7, 1.6, S2, { top: S3 });
    const pts = curve(t => [x, lerp(23, 30.5, t) + 3.2 * Math.sin(PI * t) * 0.5, lerp(z, s * 7.6, t)], 6);
    k.path(pts, 0.6, S2, { square: true });
    k.beam([x, 25.5, z], [x, 32, s * 7.6], [0.9, 1.0], S2);
  };
  for (const s of [-1, 1]) for (let i = 0; i < 13; i++) { const x = -46 + i * 7.2 + 3.6; if (Math.abs(x - 8) < 9) continue; buttress(x, s * 21.6, s); }
  for (let i = 0; i <= 6; i++) { const a = i / 6 * PI, z = Math.cos(a) * 22, x = 48 + Math.sin(a) * 22; k.at(T(x, 0, z, -a + PI / 2), () => { k.box(2.6, 24, 2.2, 0, 0, 0, S2); pinnacle(k, 0, 24, 0, 6, 1.5, S2, { top: S3 }); k.beam([0, 24, 0], [0, 31.5, -14.2], [0.9, 1.0], S2, { up: [0, 1, 0] }); }); }
  // Westfassade bei -x: Portale, Königsgalerie, Rosette, Galerie, zwei Türme
  const xf = -50, F = -64;
  k.box(14, 44, 41, xf - 7, 0, 0, S);
  for (const z of [-20.5, -5, 5, 20.5]) k.box(2.4, 44, 2.6, F - 0.8, 0, z + (z < 0 ? 1.3 : -1.3) * (Math.abs(z) > 10 ? 1 : 0), S2);
  for (const [z, w, h] of [[-12.8, 6.5, 13], [0, 7.5, 15], [12.8, 6.5, 13]]) {
    k.plate([F, 0, z], [-1, 0], archHole(0, w, 0, h - w * 0.6, 6, 'pointed'), '#5d5650', { off: 0.06 });
    k.plate([F, 0, z], [-1, 0], archHole(0, w + 2.2, 0, h - w * 0.6, 6, 'pointed'), S3, { off: 0.03 });
  }
  k.box(1.2, 4, 41, F - 0.6, 18.5, 0, S2);
  for (let i = 0; i < 28; i++) k.panel([F, 20.4, -19.5 + i * 39 / 27], [-1, 0], 0.5, 1.3, '#8f8676', { off: 0.12 });
  k.plate([F, 32, 0], [-1, 0], ngon(5.4, 28), S3, { off: 0.06 });
  k.plate([F, 32, 0], [-1, 0], ngon(4.8, 28), '#5c6a7c', { off: 0.12 });
  k.plate([F, 32, 0], [-1, 0], ngon(4.6, 28), '#ffcf8a', { off: 0.25, glow: true });
  for (let i = 0; i < 16; i++) { const a = i * TAU / 16; k.beam([F - 0.3, 32 + Math.sin(a) * 0.8, Math.cos(a) * 0.8], [F - 0.3, 32 + Math.sin(a) * 4.7, Math.cos(a) * 4.7], 0.25, S2); }
  for (const z of [-12.8, 12.8]) for (const dz of [-1.8, 1.8]) win(k, [F, 31, z + dz], [-1, 0], 2.2, 10, { kind: 'pointed', col: '#5d5650', lit: false });
  k.box(1.6, 0.8, 41.6, F - 0.8, 43.4, 0, S2);
  // Große Galerie zwischen den Türmen, Giebel dahinter
  for (let i = 0; i < 14; i++) k.cyl(0.25, 0.25, 7, F + 1.5, 44.2, -4.4 + i * 8.8 / 13, S, { seg: 6 });
  k.box(3, 0.8, 10, F + 1.5, 51.2, 0, S2);
  for (const s of [-1, 1]) {
    const zc = s * 12.7;
    k.box(14, 25, 15.6, xf - 7, 44, zc, S);
    for (const dz of [-3.2, 3.2]) win(k, [F, 58, zc + dz], [-1, 0], 2.4, 15, { kind: 'pointed', col: '#4f4943', lit: false });
    for (const dz of [-3.2, 3.2]) win(k, [xf, 58, zc + dz], [1, 0], 2.4, 15, { kind: 'pointed', col: '#4f4943', lit: false });
    for (const dx of [-3.2, 3.2]) win(k, [xf - 7 + dx, 58, zc + s * 7.8], [0, s], 2.4, 15, { kind: 'pointed', col: '#4f4943', lit: false });
    k.box(14.8, 1.0, 16.4, xf - 7, 68.2, zc, S2);
    balustrade(k, xf - 7, zc, 7.2, 7.8, 69.2, 1.2, 1.6, S2);
    for (const [dx, dz] of [[-6.6, -7.2], [6.6, -7.2], [-6.6, 7.2], [6.6, 7.2]]) k.box(1.6, 1.6, 1.6, xf - 7 + dx, 68.8, zc + dz, S2);
    for (const [dx, dz] of [[-7.4, -8.2], [7.4, -8.2], [-7.4, 8.2], [7.4, 8.2]]) k.box(1.8, 44, 1.8, xf - 7 + dx, 24, zc + dz, S2);
  }
  // Vierungsturm (Flèche) 96 m
  const xs = 8, yS = 43;
  k.cyl(3.6, 3.8, 10, xs, yS - 1, 0, PB2, { seg: 8, ry: PI / 8 });
  for (let i = 0; i < 8; i++) { const a = i * TAU / 8 + PI / 8; pinnacle(k, xs + Math.cos(a) * 4.4, yS + 5, Math.sin(a) * 4.4, 6, 0.8, PB2, { top: PB }); }
  k.cyl(3.0, 3.2, 3, xs, yS + 9, 0, PB, { seg: 8, ry: PI / 8 });
  k.cyl(0.3, 3.0, 40, xs, yS + 12, 0, PB2, { seg: 8, ry: PI / 8, flat: true });
  for (let i = 1; i < 7; i++) { const r = lerp(3.0, 0.3, i / 7); k.cyl(r + 0.25, r + 0.25, 0.4, xs, yS + 12 + i * 40 / 7, 0, PB, { seg: 8, ry: PI / 8 }); }
  k.box(0.18, 1.6, 0.18, xs, yS + 52, 0, C.gold); k.box(0.9, 0.18, 0.18, xs, yS + 53, 0, C.gold);
  return k.done({ front: '-x', center: true });
}

// Sacré-Cœur: weißer Travertin, eiförmige Hauptkuppel auf hohem Tambour, kleine Kuppeln, Vorhalle mit drei Bögen
// und Reiterstandbildern, Campanile hinten. Schauseite bei -x
function sacre_coeur() {
  const k = new K(), W = '#f4f2ec', W2 = '#e6e2d9', W3 = '#d9d4c9', BZ = '#6f8f80';
  k.box(98, 3, 46, 0, 0, 0, '#d8d3c8');
  for (let i = 0; i < 4; i++) k.box(3, 0.75, 34, -50.5 + i * 0.9 - 1.5, i * 0.75, 0, '#dcd7cc');
  const y0 = 3;
  k.rbox(60, 24, 34, 0.4, 0, y0, 0, W);
  k.cyl(17, 17, 22, 30, y0, 0, W, { seg: 20, t0: 0, tl: PI });
  k.ball(17, 30, y0 + 22, 0, W2, { ws: 20, hs: 6, t0: 0, tl: PI / 2 });
  for (const s of [-1, 1]) facade(k, [0, y0, s * 17], [0, s], 56, [8, 17], 8, 2.2, 5, { kind: 'arch', col: '#69737c', lc: C.lit });
  cornice(k, 0, 0, 60, 34, y0 + 23, 1, 0.5, W2);
  // Vorhalle mit drei Bögen, Giebel, zwei Reiter
  const xp = -36;
  k.rbox(13, 20, 30, 0.3, xp, y0, 0, W);
  for (const z of [-8.5, 0, 8.5]) { k.plate([xp - 6.5, y0, z], [-1, 0], archHole(0, 6, 0, 10, 8), '#5f6870', { off: 0.06 }); k.plate([xp - 6.5, y0, z], [-1, 0], archHole(0, 5, 0.5, 10, 8), C.lit, { off: 0.2, glow: true }); }
  for (const z of [-12.6, -4.2, 4.2, 12.6]) k.box(1.6, 16, 1.6, xp - 7, y0, z, W2);
  k.box(14, 1.4, 31, xp, y0 + 20, 0, W2);
  k.ext([[-9, 0], [9, 0], [0, 5]], null, 4, W, { ry: PI / 2, x: xp - 3, y: y0 + 21.4 });
  for (const s of [-1, 1]) k.at(T(xp - 4, y0 + 21.4, s * 12.5, PI / 2, 0, 0, 1.25), () => { k.box(3, 1.2, 4.2, 0, 0, 0, W3); k.at(T(0, 1.2, 0), () => { horse(k, 0, 0, 0, BZ, s > 0); k.lathe([[0.4, 0], [0.32, 1.2], [0, 1.6]], 0, 2.4, 0.2, BZ, { seg: 8 }); k.ball(0.25, 0, 4.15, 0.2, BZ, { ws: 6, hs: 4 }); }); });
  // kleine Kuppeltürme an der Vorhalle
  for (const s of [-1, 1]) { k.rbox(7, 30, 7, 0.3, xp + 5, y0, s * 13, W); k.cyl(3.0, 3.2, 4, xp + 5, y0 + 30, s * 13, W2, { seg: 12 }); k.lathe(domeProfile(3.1, 5.5, 'ogive', 8), xp + 5, y0 + 34, s * 13, W, { seg: 12 }); k.cyl(0.5, 0.7, 2.2, xp + 5, y0 + 39.5, s * 13, W2, { seg: 6 }); }
  // Hauptkuppel: Sockel, Tambour mit Säulen und Fenstern, eiförmige Kuppel, Laterne, Kreuz
  const xd = -6;
  k.rbox(26, 8, 26, 0.4, xd, y0 + 24, 0, W);
  k.cyl(11, 11.4, 18, xd, y0 + 32, 0, W, { seg: 24 });
  colRing(k, 16, 12.2, y0 + 32, 14, 0.42, W2, { kind: 'corinth', seg: 6 });
  for (let i = 0; i < 16; i++) { const a = (i + 0.5) * TAU / 16; win(k, [xd + Math.cos(a) * 11.05, y0 + 40, Math.sin(a) * 11.05], [Math.cos(a), Math.sin(a)], 1.6, 6, { kind: 'arch', col: '#69737c', lc: C.lit }); }
  k.cyl(12.8, 12.8, 1.2, xd, y0 + 46, 0, W2, { seg: 24 });
  k.cyl(11.2, 11.4, 3, xd, y0 + 47.2, 0, W, { seg: 24 });
  k.lathe(domeProfile(11.3, 22, 'ogive', 12), xd, y0 + 50, 0, W, { seg: 28 });
  k.cyl(2.4, 2.8, 4.6, xd, y0 + 71, 0, W2, { seg: 10 });
  for (let i = 0; i < 8; i++) { const a = i * TAU / 8; k.cyl(0.22, 0.22, 4, xd + Math.cos(a) * 2.9, y0 + 71.3, Math.sin(a) * 2.9, W, { seg: 5 }); }
  k.lathe(domeProfile(2.9, 2.6, 'ogive', 6), xd, y0 + 75.6, 0, W, { seg: 10 });
  k.box(0.3, 2.6, 0.3, xd, y0 + 78, 0, W3); k.box(1.4, 0.3, 0.3, xd, y0 + 79.6, 0, W3);
  // vier kleinere Kuppeln um die Hauptkuppel
  for (const [dx, dz] of [[-15, -12], [-15, 12], [11, -12], [11, 12]]) { k.cyl(3.6, 3.8, 9, xd + dx, y0 + 24, dz, W, { seg: 12 }); k.lathe(domeProfile(3.8, 6, 'ogive', 8), xd + dx, y0 + 33, dz, W, { seg: 12 }); k.cyl(0.5, 0.7, 2, xd + dx, y0 + 39, dz, W2, { seg: 6 }); }
  // Campanile hinten
  const xc = 50;
  k.rbox(10, 52, 10, 0.3, xc, y0, 0, W);
  for (const [n, cx, cz] of [[[1, 0], xc + 5, 0], [[-1, 0], xc - 5, 0], [[0, 1], xc, 5], [[0, -1], xc, -5]]) { win(k, [cx, y0 + 45, cz], n, 2.6, 8, { kind: 'arch', col: '#59626b', lc: C.lit }); win(k, [cx, y0 + 30, cz], n, 1.4, 4, { kind: 'arch', col: '#59626b', lc: C.lit }); }
  k.box(11.4, 1.2, 11.4, xc, y0 + 52, 0, W2);
  k.cyl(4.6, 4.8, 9, xc, y0 + 53.2, 0, W, { seg: 12 });
  colRing(k, 12, 5.4, y0 + 53.2, 8.5, 0.3, W2, { kind: 'doric', seg: 5 });
  k.lathe(domeProfile(5.0, 9, 'ogive', 8), xc, y0 + 62.2, 0, W, { seg: 12 });
  k.cyl(0.6, 0.8, 3, xc, y0 + 71, 0, W2, { seg: 6 }); k.box(0.3, 2.4, 0.3, xc, y0 + 74, 0, W3); k.box(1.2, 0.3, 0.3, xc, y0 + 75.5, 0, W3);
  return k.done({ front: '-x', center: true });
}

// Glaspyramide des Louvre: 35,4 m Grundseite, 21,6 m hoch, Rautengitter aus Stahl. Nachts leuchtend
function louvre_pyramide() {
  const k = new K(), GL = '#a9c4d0', ST = '#8c959d', B = 17.71, H = 21.64, N = 16;
  k.box(2 * B + 3, 0.5, 2 * B + 3, 0, 0, 0, '#d9d2c3');
  const A = [0, H + 0.5, 0];
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => {
    const B0 = [B, 0.5, -B], B1 = [-B, 0.5, -B];
    k.face([B0, B1, A], GL, [0, 0.6, -1]);
    const n = new THREE.Vector3(0, B / Math.hypot(B, H), -H / Math.hypot(B, H)).multiplyScalar(0.12);
    k.face([B0, B1, A].map(p => [p[0] + n.x * 0.5, p[1] + n.y * 0.5, p[2] + n.z * 0.5]), '#fff0d2', [0, 0.6, -1], { glow: true });
    const P = (t, u, base, other) => base.map((v, q) => v + t * (other[q] - base[q]) + u * (A[q] - base[q]) + [n.x, n.y, n.z][q]);
    for (let i = 1; i < N; i++) {
      const t = i / N;
      k.beam(P(t, 0, B0, B1), P(t, 1 - t, B0, B1), 0.18, ST);
      k.beam(P(t, 0, B1, B0), P(t, 1 - t, B1, B0), 0.18, ST);
    }
    k.beam([B, 0.6, -B], A, 0.45, ST); k.beam([B, 0.6, -B], [-B, 0.6, -B], 0.45, ST);
  });
  return k.done();
}

// =====================================================================================================
// London
// =====================================================================================================

// Elizabeth Tower (Big Ben), 96 m: Kalkstein mit Maßwerk, vier Zifferblätter (nachts leuchtend), Glockengeschoss,
// steiler Eisenhelm mit Gauben und Gold, Ayrton Licht
function elizabeth_tower() {
  const k = new K(), S = '#dcc9a0', S2 = '#cdb98d', AU = '#d8b25a', RF = '#4f5866';
  k.box(14, 1.2, 14, 0, 0, 0, S2);
  k.rbox(12, 50, 12, 0.2, 0, 1.2, 0, S);
  for (const [dx, dz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) k.box(1.6, 50, 1.6, dx, 1.2, dz, S2);
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => {
    for (const x of [-3.2, -1.1, 1.1, 3.2]) k.box(0.35, 46, 0.3, x, 3, -6.1, S2);
    for (let r = 0; r < 7; r++) { win(k, [0, 8 + r * 6, -6.1], [0, -1], 1.6, 3.4, { kind: 'pointed', col: '#6e6a62', lit: false }); k.box(9, 0.35, 0.4, 0, 5.6 + r * 6, -6.15, S2); }
  });
  // Uhrgeschoss mit vier Zifferblättern
  const yc = 51.2;
  k.rbox(13.6, 11, 13.6, 0.2, 0, yc, 0, S);
  cornice(k, 0, 0, 13.6, 13.6, yc, 0.6, 0.3, S2);
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => {
    const z = -6.85, cy = yc + 5.3;
    k.panel([0, cy, z], [0, -1], 4.3, 4.3, AU, { off: 0.05 });
    k.plate([0, cy, z], [0, -1], ngon(3.55, 28), '#2f3338', { off: 0.1 });
    k.plate([0, cy, z], [0, -1], ngon(3.3, 28), '#f3eee2', { off: 0.15 });
    k.plate([0, cy, z], [0, -1], ngon(3.25, 28), '#fff3d8', { off: 0.3, glow: true });
    for (let i = 0; i < 12; i++) { const a = i * TAU / 12; k.box(0.22, 0.6, 0.06, Math.cos(a) * 2.75, cy + Math.sin(a) * 2.75 - 0.3, z - 0.42, '#2f3338', { rz: 0 }); }
    k.beam([0, cy, z - 0.45], [1.2, cy + 1.7, z - 0.45], [0.18, 0.06], '#1f2226'); k.beam([0, cy, z - 0.45], [-2.2, cy + 0.4, z - 0.45], [0.14, 0.06], '#1f2226');
    for (const x of [-6.2, 6.2]) pinnacle(k, x, yc + 11, -6.2, 3.5, 0.8, S2, { top: AU });
  });
  cornice(k, 0, 0, 13.6, 13.6, yc + 10.4, 0.8, 0.5, S2);
  // Glockengeschoss mit drei Spitzbögen je Seite, Ayrton Licht
  const yb = yc + 11.2;
  k.rbox(12.4, 9.5, 12.4, 0.2, 0, yb, 0, S);
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => { for (const x of [-3.4, 0, 3.4]) win(k, [x, yb + 4.8, -6.2], [0, -1], 2.2, 7, { kind: 'pointed', col: '#3b3a37', lc: '#ffd28a' }); });
  for (const [dx, dz] of [[-6.3, -6.3], [6.3, -6.3], [-6.3, 6.3], [6.3, 6.3]]) pinnacle(k, dx, yb, dz, 14, 1.2, S2, { top: AU, ball: AU });
  // Helm mit zwei Gaubenreihen, Laterne, Spitze
  const yh = yb + 9.5;
  k.box(13, 0.8, 13, 0, yh, 0, S2);
  k.cyl(0, 6.6 * Math.SQRT2, 21, 0, yh + 0.8, 0, RF, { seg: 4, ry: PI / 4, flat: true });
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => {
    for (const [y, w, zz] of [[yh + 3.5, 2.2, -5.0], [yh + 9.5, 1.6, -3.3]]) { k.box(w, 2.4, 1.6, 0, y, zz, RF); k.ext([[-w / 2 - 0.2, 0], [w / 2 + 0.2, 0], [0, 1.4]], null, 1.7, AU, { y: y + 2.4, z: zz }); k.panel([0, y + 1.2, zz - 0.8], [0, -1], w * 0.3, 0.8, '#ffd28a', { off: 0.05, glow: true }); }
    k.beam([6.6, yh + 0.8, -6.6], [0, yh + 21.8, 0], 0.3, AU);
  });
  k.cyl(1.2, 1.4, 2.4, 0, yh + 14, 0, '#ffe2a0', { seg: 8, glow: true });
  k.cyl(0.25, 0.5, 3.6, 0, yh + 21.4, 0, AU, { seg: 6 });
  k.ball(0.45, 0, yh + 25.2, 0, AU, { ws: 8, hs: 6 });
  k.box(0.15, 1.4, 0.15, 0, yh + 25.4, 0, AU); k.box(0.7, 0.15, 0.15, 0, yh + 26.3, 0, AU);
  return k.done();
}

// Tower Bridge: zwei neugotische Türme auf Pfeilern, obere Fußgängerstege in Blau und Weiß, Klappen, Hängeketten
// zu den Ufertürmen. Fahrbahn auf rund 9 m (echte Lage über dem Wasser)
function tower_bridge() {
  const k = new K(), S = '#d8cfbc', S2 = '#c5bba6', BL = '#7fa7c9', WH = '#f0f2f2', RF = '#4f5866', AU = '#d8b25a', yD = 9;
  // Klappen und Seitenfahrbahn
  k.box(61, 1.6, 15, 0, yD - 1.6, 0, BL);
  for (const z of [-7.3, 7.3]) { k.box(61, 1.2, 0.4, 0, yD, z, WH); for (let i = 0; i <= 12; i++) k.box(0.25, 1.2, 0.3, -30 + i * 5, yD, z, WH); }
  for (const s of [-1, 1]) {
    k.box(70, 1.6, 15, s * 86.5, yD - 1.6, 0, BL);
    k.box(70, 1.2, 0.4, s * 86.5, yD, -7.3, WH); k.box(70, 1.2, 0.4, s * 86.5, yD, 7.3, WH);
  }
  // Haupttürme
  for (const s of [-1, 1]) {
    const x = s * 41;
    k.rbox(26, yD - 1.6, 34, 1.0, x, 0, 0, S2);
    k.loft([[[x + 13, 0, -17], [x + 13, 0, 17], [x - 13, 0, 17], [x - 13, 0, -17]], [[x + 13, yD - 1.6, -17], [x + 13, yD - 1.6, 17], [x - 13, yD - 1.6, 17], [x - 13, yD - 1.6, -17]]], S2, { flat: true });
    for (const zs of [-1, 1]) k.cyl(0, 13, yD - 1.6, x, 0, zs * 17, S2, { seg: 3, ry: zs > 0 ? PI / 2 : -PI / 2, flat: true });
    // Turmkörper mit Durchfahrt
    k.ext([[-10.5, 0], [10.5, 0], [10.5, 42], [-10.5, 42]], [archHole(0, 9.5, 0.6, 9.5, 8, 'pointed')], 24, S, { ry: PI / 2, x, y: yD - 0.6 });
    for (const y of [yD + 14, yD + 26, yD + 41]) k.box(22, 0.8, 25, x, y, 0, S2);
    for (const [n, cx, cz, L] of [[[0, -1], x, -12, 17], [[0, 1], x, 12, 17], [[1, 0], x + 10.5, 0, 20], [[-1, 0], x - 10.5, 0, 20]]) {
      if (n[0]) { facade(k, [cx, yD, cz], n, L, [19, 31, 36], 3, 1.4, 3.6, { kind: 'pointed', col: '#4d5560', lc: C.lit }); }
      else facade(k, [cx, yD, cz], n, L, [6, 19, 31, 36], 3, 1.4, 3.6, { kind: 'pointed', col: '#4d5560', lc: C.lit });
    }
    // Ecktürmchen mit spitzen Hauben
    for (const [dx, dz] of [[-10.5, -12], [10.5, -12], [-10.5, 12], [10.5, 12]]) {
      k.cyl(2.6, 2.8, 47, x + dx, yD - 0.6, dz, S, { seg: 8 });
      k.cyl(3.1, 3.1, 0.8, x + dx, yD + 46.2, dz, S2, { seg: 8 });
      k.cyl(0, 3.0, 7, x + dx, yD + 47, dz, RF, { seg: 8, flat: true });
      k.cyl(0.08, 0.25, 2, x + dx, yD + 54, dz, AU, { seg: 4 });
    }
    // Hauptdach mit Gauben
    k.box(22.4, 1, 25.4, x, yD + 41.4, 0, S2);
    k.cyl(0, 17.5, 13, x, yD + 42.4, 0, RF, { seg: 4, ry: PI / 4, sx: 1, flat: true });
    for (const [n, dx, dz] of [[[0, -1], 0, -8], [[0, 1], 0, 8], [[1, 0], 7, 0], [[-1, 0], -7, 0]]) { k.box(n[0] ? 1.6 : 2.4, 2.6, n[0] ? 2.4 : 1.6, x + dx, yD + 44, dz, S); k.panel([x + dx + n[0] * 0.85, yD + 45.3, dz + n[1] * 0.85], n, 0.6, 0.8, C.lit, { off: 0.03, glow: true }); }
    k.cyl(0.1, 0.35, 4, x, yD + 55, 0, AU, { seg: 4 });
  }
  // obere Stege auf 42 m, Fachwerk in Blau und Weiß
  for (const z of [-9, 9]) {
    k.box(61, 1.0, 3.6, 0, 42, z, BL); k.box(61, 1.0, 3.6, 0, 47.5, z, BL);
    for (let i = 0; i <= 10; i++) { const x = -30.5 + i * 6.1; k.box(0.6, 4.5, 3.4, x, 43, z, WH); if (i < 10) { k.beam([x, 43, z - 1.75], [x + 6.1, 47.5, z - 1.75], 0.4, BL); k.beam([x, 47.5, z - 1.75], [x + 6.1, 43, z - 1.75], 0.4, BL); k.beam([x, 43, z + 1.75], [x + 6.1, 47.5, z + 1.75], 0.4, BL); k.beam([x, 47.5, z + 1.75], [x + 6.1, 43, z + 1.75], 0.4, BL); } }
    k.box(60, 0.3, 0.3, 0, 48.6, z - 1.9, C.litW, { glow: true });
  }
  // Hängeketten zu den Ufertürmen, Hänger
  for (const s of [-1, 1]) {
    for (const z of [-7.8, 7.8]) {
      const ch = curve(t => { const x = s * lerp(51.5, 121.5, t), y = lerp(36, 19, t) - 22 * Math.sin(PI * t) * (t < 0.5 ? 1 : 1) * 0.9 + 0; return [x, Math.max(y, yD + 1.5), z]; }, 14);
      k.path(ch, 0.9, BL, { square: true });
      k.path(ch.map(([x, y, zz]) => [x, y + 1.6, zz]), 0.5, WH, { square: true });
      for (let i = 1; i < 14; i++) { k.beam(ch[i], [ch[i][0], ch[i][1] + 1.6, z], 0.3, WH); k.beam(ch[i], [ch[i][0], yD, z], 0.18, WH); }
    }
    // Uferturm
    const xa = s * 125;
    k.rbox(8, 22, 18, 0.4, xa, 0, 0, S);
    for (const dz of [-8.4, 8.4]) { k.cyl(1.6, 1.7, 23, xa, 0, dz, S, { seg: 8 }); k.cyl(0, 1.9, 4, xa, 23, dz, RF, { seg: 8 }); }
    k.cyl(0, 6.5, 5, xa, 22, 0, RF, { seg: 4, ry: PI / 4 });
  }
  return k.done();
}

// London Eye: Rad mit 120 m Durchmesser, 135 m hoch, 32 Kapseln quer zum Rad, Speichen aus Seilen, A Bock an Land (+z)
function london_eye() {
  const k = new K(), W = '#eef1f3', W2 = '#cfd6dc', GL = '#9fbccb', yc = 70, R = 60;
  // Felge: zwei Ringe mit Fachwerk
  const n = 64;
  const ring = (r, z) => curve(t => [Math.cos(t * TAU) * r, yc + Math.sin(t * TAU) * r, z], n);
  const A = ring(R, -3), B = ring(R, 3), Cc = ring(R - 4, 0);
  k.path(A, 0.55, W); k.path(B, 0.55, W); k.path(Cc, 0.45, W);
  for (let i = 0; i < n; i++) { k.beam(A[i], Cc[i], 0.25, W); k.beam(B[i], Cc[i], 0.25, W); if (i % 2 === 0) { k.beam(A[i], B[i + 1], 0.2, W); } }
  // Speichen (Seile) und Nabe
  for (let i = 0; i < 64; i++) { const a = i * TAU / 64, z = i % 2 ? -6 : 6; k.beam([0, yc, z], [Math.cos(a) * (R - 4), yc + Math.sin(a) * (R - 4), 0], 0.12, W2); }
  k.tube([0, yc, -7], [0, yc, 14], 2.2, W, { seg: 12, caps: true });
  k.tube([0, yc, -8], [0, yc, 8], 3.2, W2, { seg: 12, caps: true, r2: 3.2 });
  // Kapseln außen am Rad, Längsachse parallel zur Achse
  for (let i = 0; i < 32; i++) {
    const a = i * TAU / 32, x = Math.cos(a) * (R + 3.2), y = yc + Math.sin(a) * (R + 3.2);
    k.ball(1.0, x, y, 0, GL, { ws: 10, hs: 6, sx: 2.1, sy: 2.1, sz: 4.4 });
    k.cyl(2.4, 2.4, 0.5, x, y - 0.25, 0, W, { seg: 10, open: true });
    k.cyl(1.1, 1.1, 0.2, x, y - 0.1 + 0, 0, W, { seg: 6 });
    k.beam([Math.cos(a) * (R + 0.4), yc + Math.sin(a) * (R + 0.4), 0], [x * 0.995, y, 0], 0.4, W);
    k.at(T(x, y, 0, 0, PI / 2), () => k.cyl(2.25, 2.25, 6.6, 0, -3.3, 0, C.litB, { seg: 8, open: true, glow: true }));
  }
  for (let i = 0; i < 64; i++) { const a = i * TAU / 64; k.box(0.6, 0.6, 0.6, Math.cos(a) * (R + 0.5), yc + Math.sin(a) * (R + 0.5), -3.2, '#e8f2ff', { glow: true }); }
  // A Bock an Land, Rückhalteseile
  for (const s of [-1, 1]) k.tube([0, yc, 12], [s * 30, 0, 44], 1.7, W, { seg: 10, r2: 1.2 });
  k.beam([-15, 37.5, 28], [15, 37.5, 28], 1.2, W);
  for (const s of [-1, 1]) k.beam([0, yc, 14], [s * 8, 0, 70], 0.25, W2);
  for (const s of [-1, 1]) k.rbox(6, 2, 6, 0.4, s * 30, 0, 44, '#cfcac0');
  // Einstiegsplattform am Fluss
  k.box(34, 1.2, 14, 0, 7.5, 0, '#cfcac0');
  for (const x of [-14, -5, 5, 14]) k.cyl(0.7, 0.7, 7.5, x, 0, -4, '#bdb6aa', { seg: 6 });
  return k.done({ center: true });
}

// St Paul's Cathedral: Kuppel 111 m auf Säulentambour, steinerne Galerie, Laterne mit goldener Kugel und Kreuz,
// Westfront mit zwei Türmen und zweistöckigem Portikus (vorn bei -x), lateinisches Kreuz
function st_pauls() {
  const k = new K(), S = '#e6e0d2', S2 = '#d6cfbf', S3 = '#c8c0ae', PB = '#8d97a1', AU = C.gold;
  // Kreuz aus Langhaus und Querhaus, zwei Ordnungen
  k.rbox(150, 30, 37, 0.4, 0, 0, 0, S);
  k.rbox(37, 30, 76, 0.4, 14, 0, 0, S);
  k.cyl(13, 13, 28, 75, 0, 0, S, { seg: 16, t0: 0, tl: PI });
  k.ball(13, 75, 28, 0, PB, { ws: 16, hs: 6, t0: 0, tl: PI / 2 });
  for (const [x, z, w, d] of [[0, 0, 150, 37], [14, 0, 37, 76]]) {
    cornice(k, x, z, w, d, 14.6, 1.0, 0.4, S2);
    cornice(k, x, z, w, d, 28.4, 1.2, 0.6, S2);
    balustrade(k, x, z, w / 2 - 0.3, d / 2 - 0.3, 29.6, 1.6, 2.4, S);
    pilasters(k, x, z, w / 2, d / 2, 0.5, 28, 7, 1.0, S2);
  }
  k.ext([[-15, 0], [15, 0], [3, 5], [-3, 5]], null, 140, PB, { ry: PI / 2, y: 29.8 });
  k.ext([[-15, 0], [15, 0], [3, 5], [-3, 5]], null, 70, PB, { x: 14, y: 29.8 });
  for (const s of [-1, 1]) {
    facade(k, [0, 0, s * 18.5], [0, s], 140, [8, 21], 18, 2.2, 5.2, { kind: 'arch', col: '#646d76', lc: C.lit, skip: u => Math.abs(u - 14) < 20 });
    for (const zz of [38]) { k.ext([[-17, 0], [17, 0], [0, 7]], null, 2, S, { x: 14, y: 29.6, z: s * zz }); facade(k, [14, 0, s * zz], [0, s], 30, [8, 21], 4, 2.4, 5.2, { kind: 'arch', col: '#646d76', lc: C.lit }); }
  }
  // Westfront: zweistöckiger Portikus mit Giebel, zwei Türme
  const xf = -75;
  for (let i = 0; i < 6; i++) for (const dz of [-0.9, 0.9]) column(k, xf - 4, 0.6, -13.5 + i * 5.4 + dz, 14, 0.75, S, { kind: 'corinth', seg: 10 });
  k.box(7, 1.8, 30, xf - 3, 14.6, 0, S2);
  for (let i = 0; i < 4; i++) for (const dz of [-0.85, 0.85]) column(k, xf - 4, 16.4, -8.1 + i * 5.4 + dz, 11.5, 0.65, S, { kind: 'corinth', seg: 10 });
  k.box(7, 1.6, 20, xf - 3, 27.9, 0, S2);
  k.ext([[-11, 0], [11, 0], [0, 6.5]], null, 7, S, { ry: PI / 2, x: xf - 3, y: 29.5 });
  k.ext([[-9.5, 0.4], [9.5, 0.4], [0, 5.4]], null, 0.3, S3, { ry: PI / 2, x: xf - 6.6, y: 29.5 });
  for (const s of [-1, 1]) {
    const z = s * 15.5;
    k.rbox(11, 31, 11, 0.3, xf + 1, 0, z, S);
    k.rbox(9, 9, 9, 0.3, xf + 1, 31, z, S2);
    k.cyl(4.2, 4.4, 11, xf + 1, 40, z, S, { seg: 16 });
    colRing(k, 8, 5.2, 40, 10, 0.4, S2, { kind: 'corinth', seg: 6 });
    k.cyl(5.6, 5.6, 1, xf + 1, 50, z, S2, { seg: 16 });
    k.lathe([[4.4, 0], [4.0, 2], [2.4, 4], [2.9, 6], [1.4, 9], [0.4, 12], [0, 12.4]], xf + 1, 51, z, S, { seg: 12 });
    k.ball(0.9, xf + 1, 63.8, z, AU, { ws: 8, hs: 6, sy: 1.4 });
    for (const [n, cx, cz] of [[[-1, 0], xf - 4.5, z], [[0, s], xf + 1, z + s * 5.5]]) win(k, [cx, 21, cz], n, 2.2, 6, { kind: 'arch', col: '#646d76', lc: C.lit });
  }
  // Kuppel über der Vierung
  const xd = 14, yd = 30;
  k.cyl(23, 24, 6, xd, yd, 0, S2, { seg: 32 });
  k.cyl(19, 19, 4, xd, yd + 23, 0, S, { seg: 32 });
  k.cyl(19, 19, 17, xd, yd + 6, 0, S, { seg: 32 });
  colRing(k, 32, 21.6, yd + 6, 15.5, 0.62, S, { kind: 'corinth', seg: 6 });
  k.cyl(22.6, 22.6, 1.5, xd, yd + 21.5, 0, S2, { seg: 32 });
  balustrade(k, xd, 0, 0.1, 0.1, 0, 0, 1, S);
  for (let i = 0; i < 40; i++) { const a = i * TAU / 40; k.box(0.3, 1.4, 0.3, xd + Math.cos(a) * 22.2, yd + 23, Math.sin(a) * 22.2, S2); }
  k.cyl(22.3, 22.3, 0.3, xd, yd + 24.3, 0, S2, { seg: 32, open: true });
  k.cyl(17, 17.4, 9, xd, yd + 23, 0, S, { seg: 32 });
  for (let i = 0; i < 16; i++) { const a = (i + 0.5) * TAU / 16; win(k, [xd + Math.cos(a) * 17.05, yd + 27.5, Math.sin(a) * 17.05], [Math.cos(a), Math.sin(a)], 1.4, 3, { col: '#646d76', lc: C.lit }); }
  k.cyl(17.8, 17.8, 1, xd, yd + 32, 0, S2, { seg: 32 });
  const prof = []; for (let i = 0; i <= 12; i++) { const a = i / 12 * PI / 2; prof.push([3.6 + 13.6 * Math.cos(a), yd + 33 + 26 * Math.sin(a)]); }
  k.lathe(prof, xd, 0, 0, PB, { seg: 32 });
  for (let i = 0; i < 16; i++) { const a = i * TAU / 16; k.path(prof.map(([r, y]) => [xd + Math.cos(a) * (r + 0.15), y, Math.sin(a) * (r + 0.15)]), 0.25, S3, { square: true }); }
  const yl = yd + 59;
  for (let i = 0; i < 24; i++) { const a = i * TAU / 24; k.box(0.18, 1.2, 0.18, xd + Math.cos(a) * 4.6, yl, Math.sin(a) * 4.6, AU); }
  k.cyl(4.6, 4.6, 0.2, xd, yl + 1.1, 0, AU, { seg: 24, open: true });
  k.cyl(3.0, 3.4, 8, xd, yl, 0, S, { seg: 12 });
  for (let i = 0; i < 8; i++) { const a = i * TAU / 8; k.cyl(0.3, 0.3, 7, xd + Math.cos(a) * 3.6, yl, Math.sin(a) * 3.6, S2, { seg: 5 }); }
  k.lathe([[3.4, 0], [2.6, 1.5], [1.2, 3.5], [0.7, 6], [0, 6.2]], xd, yl + 8, 0, S, { seg: 10 });
  k.ball(1.2, xd, yl + 15.4, 0, AU, { ws: 10, hs: 8 });
  k.box(0.35, 4, 0.35, xd, yl + 16.4, 0, AU); k.box(2.0, 0.35, 0.35, xd, yl + 19, 0, AU);
  return k.done({ front: '-x', center: true });
}

// =====================================================================================================
// New York und Washington
// =====================================================================================================

// Hochhausblock: Kasten mit senkrechten Fensterstreifen auf allen Seiten, nachts zufällig erleuchtet
function skyBlock(k, x, z, w, d, y0, y1, stone, winC, sp, o = {}) {
  k.box(w, y1 - y0, d, x, y0, z, stone);
  const seg = o.seg || 12;
  for (const [n, cx, cz, L] of [[[0, -1], x, z - d / 2, w], [[0, 1], x, z + d / 2, w], [[1, 0], x + w / 2, z, d], [[-1, 0], x - w / 2, z, d]]) {
    const cnt = Math.max(1, Math.floor(L / sp)), tx = n[1], tz = -n[0];
    for (let i = 0; i < cnt; i++) {
      const u = (i - (cnt - 1) / 2) * (L / cnt), px = cx + tx * u, pz = cz + tz * u;
      k.panel([px, (y0 + y1) / 2, pz], n, sp * 0.24, (y1 - y0) / 2 - 1.2, winC, { off: 0.08 });
      if (o.lit !== false) for (let y = y0 + 1.5; y < y1 - seg * 0.5; y += seg) {
        if (hash(Math.round(px * 3 + pz * 7), Math.round(y)) < (o.dens ?? 0.55)) k.panel([px, y + seg * 0.42, pz], n, sp * 0.2, seg * 0.38, C.lit, { off: 0.2, glow: true });
      }
    }
  }
}

// Freiheitsstatue: Sternfort, Sockel aus Granit, Statue in Kupfergrün mit Fackel (Flamme golden), Krone mit sieben Strahlen
function freiheitsstatue() {
  const k = new K(), CU = '#8ec4ae', CU2 = '#7bb39c', GR = '#d1c4ae', GR2 = '#bfb19a', FS = '#c7bea9';
  // Sternfort mit elf Spitzen
  const star = []; for (let i = 0; i < 22; i++) { const a = i * TAU / 22 - PI / 2, r = i % 2 ? 31 : 45; star.push([Math.cos(a) * r, -Math.sin(a) * r]); }
  k.ext(star, null, 8, FS, { rx: -PI / 2, y: 4 });
  k.ext(star.map(([x, y]) => [x * 0.93, y * 0.93]), null, 0.4, '#b9c3a3', { rx: -PI / 2, y: 8.2 });
  // Fundament (Pyramidenstumpf) und Sockel
  k.loft([rectRing(16, 16, 8), rectRing(13.5, 13.5, 20)], '#d9d2c4', { flat: true, capTop: true });
  k.rbox(22, 4, 22, 0.3, 0, 20, 0, GR2);
  k.rbox(18, 17, 18, 0.3, 0, 24, 0, GR);
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => {
    k.box(9, 9, 0.8, 0, 28, -9.2, GR2);
    k.panel([0, 32.5, -9.65], [0, -1], 3.4, 3.8, '#5f6466', { off: 0.02 });
    for (const x of [-2.6, 2.6]) k.cyl(0.6, 0.6, 7.5, x, 28.7, -9.9, GR, { seg: 8 });
    k.box(10, 0.8, 1.6, 0, 37.2, -9.4, GR2);
    for (const x of [-5.5, -2, 2, 5.5]) k.plate([x, 39.4, -9.05], [0, -1], ngon(0.7, 8), GR2, { off: 0.05 });
  });
  cornice(k, 0, 0, 18, 18, 41, 1.6, 0.8, GR2);
  k.rbox(15.5, 4.4, 15.5, 0.3, 0, 42.6, 0, GR);
  balustrade(k, 0, 0, 8.2, 8.2, 45.5, 1.2, 1.4, GR2);
  k.box(9, 1.5, 9, 0, 45.5, 0, GR2);
  // Statue
  const y0 = 47, rings = [];
  const prof = [[47, 6.0, 5.2], [51, 5.6, 4.6], [56, 5.2, 4.0], [61, 4.8, 3.7], [65.5, 4.9, 3.6], [69.5, 5.1, 3.6], [72.4, 4.6, 3.1], [73.8, 3.2, 2.4], [74.8, 1.5, 1.6], [75.6, 1.3, 1.4]];
  for (const [y, rx, rz] of prof) rings.push(circRing(1, y, 28).map(([x, , z], j) => { const th = j * TAU / 28, f = 1 + (y < 70 ? 0.045 * Math.sin(9 * th + y * 0.35) : 0); return [x * rx * f, y, z * rz * f]; }));
  k.loft(rings, CU, { smooth: true, capBot: true });
  k.ball(1, 0, 77.8, -0.2, CU, { ws: 14, hs: 10, sx: 2.0, sy: 2.6, sz: 2.25 });
  k.ball(1, 0, 78.6, 0.6, CU2, { ws: 10, hs: 6, sx: 2.0, sy: 1.6, sz: 2.0 });
  // Krone: Band mit Fenstern, sieben Strahlen
  k.cyl(2.35, 2.25, 1.0, 0, 78.7, -0.1, CU2, { seg: 16 });
  for (let i = 0; i < 9; i++) { const a = -PI / 2 + (i - 4) * 0.22; k.box(0.35, 0.4, 0.1, Math.cos(a) * 2.38, 79.0, -0.1 + Math.sin(a) * 2.38, C.lit, { glow: true, ry: -a + PI / 2 }); }
  for (let i = 0; i < 7; i++) {
    const az = (i - 3) * 0.42, el = 0.35 + 0.1 * Math.abs(i - 3) * 0;
    const dir = [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
    const b = [dir[0] * 2.2, 79.5 + dir[1] * 1.2, -0.1 + dir[2] * 2.2];
    k.tube(b, [b[0] + dir[0] * 3.4, b[1] + dir[1] * 3.4, b[2] + dir[2] * 3.4], 0.32, CU2, { seg: 4, r2: 0.02 });
  }
  // rechter Arm mit Fackel
  k.tube([3.2, 72.8, 0.2], [4.9, 85.8, -0.9], 1.25, CU, { seg: 8, r2: 0.8 });
  k.ball(1.25, 3.2, 72.8, 0.2, CU, { ws: 8, hs: 6 });
  k.cyl(0.55, 0.55, 2.8, 4.95, 85.4, -0.95, CU2, { seg: 8 });
  k.cyl(1.7, 0.7, 1.8, 4.95, 88.0, -0.95, CU2, { seg: 12 });
  for (let i = 0; i < 12; i++) { const a = i * TAU / 12; k.box(0.1, 0.8, 0.1, 4.95 + Math.cos(a) * 2.1, 89.6, -0.95 + Math.sin(a) * 2.1, CU2); }
  k.cyl(2.15, 2.15, 0.25, 4.95, 89.55, -0.95, CU2, { seg: 12 });
  const fl = [[1.3, 0], [1.5, 0.8], [1.2, 1.8], [0.6, 2.8], [0, 3.4]];
  k.lathe(fl, 4.95, 89.8, -0.95, C.gold, { seg: 10 });
  k.lathe(fl.map(([r, y]) => [r * 1.06, y * 1.02]), 4.95, 89.8, -0.95, '#ffd37a', { seg: 10, glow: true });
  // linker Arm mit Tafel
  k.tube([-3.3, 72.4, 0], [-4.7, 66.5, -1.0], 1.0, CU, { seg: 8, r2: 0.85 });
  k.tube([-4.7, 66.5, -1.0], [-3.6, 64.8, -2.9], 0.8, CU, { seg: 8 });
  k.at(T(-4.4, 64.0, -1.6, 0.25, 0.15, 0.22), () => { k.box(4.1, 7.2, 0.7, 0, 0, 0, CU2); k.box(3.5, 0.3, 0.1, 0, 4.5, -0.38, CU); });
  return k.done();
}

// Empire State Building: Kalkstein mit Fensterstreifen, Rücksprünge, Aussichtsdeck auf 320 m, Art Deco Mast, Antenne
function empire_state() {
  const k = new K(), ST = '#e3dccd', WN = '#8a949d', AL = '#cfd3d7';
  skyBlock(k, 0, 0, 129, 57, 0, 25, ST, WN, 4.6, { seg: 6 });
  cornice(k, 0, 0, 129, 57, 24.4, 0.8, 0.4, '#d3cbbb');
  skyBlock(k, 0, 0, 100, 50, 25, 90, ST, WN, 4.2);
  skyBlock(k, 0, 0, 86, 46, 90, 110, ST, WN, 4.2);
  skyBlock(k, 0, 0, 74, 44, 110, 125, ST, WN, 4.2);
  skyBlock(k, 0, 0, 58, 42, 125, 270, ST, WN, 3.6, { seg: 14 });
  for (const [dx, dz] of [[-29, -21], [29, -21], [-29, 21], [29, 21]]) k.box(2.2, 145, 2.2, dx, 125, dz, '#d9d1c1');
  skyBlock(k, 0, 0, 48, 36, 270, 305, ST, WN, 3.6);
  skyBlock(k, 0, 0, 36, 28, 305, 318, ST, WN, 3.6);
  k.box(38, 2, 30, 0, 318, 0, '#d3cbbb');
  balustrade(k, 0, 0, 19, 15, 320, 1.4, 1.6, AL);
  // Mast mit Art Deco Flügeln
  k.loft([rectRing(8, 8, 320), rectRing(5.2, 5.2, 373)], ST, { flat: true });
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => {
    k.loft([[[2, 320, -8.2], [-2, 320, -8.2], [-2, 320, -11], [2, 320, -11]], [[1.4, 362, -5.4], [-1.4, 362, -5.4], [-1.4, 362, -7.2], [1.4, 362, -7.2]]], AL, { flat: true, capTop: true });
    k.box(1.2, 48, 0.4, 0, 322, -11.3 + 0.2, '#fff4dc', { glow: true });
    for (let i = 0; i < 5; i++) k.panel([0, 330 + i * 8, -7.6], [0, -1], 1.2, 2.6, WN, { off: 0.1 });
  });
  k.cyl(4.4, 5.6, 8, 0, 373, 0, AL, { seg: 8, flat: true });
  k.cyl(2.2, 4.4, 5, 0, 381, 0, AL, { seg: 8, flat: true });
  k.cyl(1.2, 1.6, 22, 0, 386, 0, '#e8e8e6', { seg: 8 });
  k.cyl(0.4, 1.0, 35, 0, 408, 0, '#e8e8e6', { seg: 6 });
  k.ball(0.6, 0, 443.2, 0, C.litR, { ws: 6, hs: 4, glow: true });
  return k.done();
}

// One World Trade Center, 541 m: Sockel mit Glaslamellen, acht dreieckige Glasflächen (Quadrat dreht sich um 45 Grad),
// Spitze mit Ringen und Leuchtfeuer
function one_wtc() {
  const k = new K(), GL = '#a2bccb', GL2 = '#8ba7b8', FIN = '#d9dee2';
  k.box(61, 57, 61, 0, 0, 0, '#c9d0d6');
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => { for (let i = 0; i < 24; i++) k.box(0.5, 52, 1.2, -29 + i * 58 / 23, 3, -30.9, FIN); k.box(20, 4.5, 0.4, 0, 0, -31.2, '#3f4a52'); });
  const y0 = 57, y1 = 417, B = 30.5, Tt = 32.3, NB = 40;
  const Bc = [[B, y0, -B], [B, y0, B], [-B, y0, B], [-B, y0, -B]];
  const Tv = [[Tt, y1, 0], [0, y1, Tt], [-Tt, y1, 0], [0, y1, -Tt]];
  const band = (P, Q, R, S2, i, hint) => { const c = i % 2 ? GL : GL2; k.face([P, Q, R, S2].filter((v, j, a) => j < 2 || v), c, hint); };
  const strip = (A, B2, Cc, hint) => {
    // Dreieck A B2 (Unterkante oder Oberkante) mit Spitze Cc, in waagerechte Bänder geteilt
    for (let i = 0; i < NB; i++) {
      const t0 = i / NB, t1 = (i + 1) / NB;
      const P = (t, which) => { const base = which ? B2 : A; return base.map((v, q) => lerp(v, Cc[q], t)); };
      const yA = lerp(A[1], Cc[1], t0), yB = lerp(A[1], Cc[1], t1);
      const p0 = P(t0, 0), p1 = P(t0, 1), p2 = P(t1, 1), p3 = P(t1, 0);
      k.face([p0, p1, p2, p3], i % 2 ? GL : GL2, hint);
      if (i % 2 && hash(i, Math.round(hint[0] * 10 + hint[2] * 7)) < 0.7) { const n = new THREE.Vector3(...hint).normalize().multiplyScalar(0.25); k.face([p0, p1, p2, p3].map(p => [p[0] + n.x, p[1] + n.y * 0, p[2] + n.z]), C.lit, hint, { glow: true }); }
    }
  };
  for (let i = 0; i < 4; i++) {
    const a = Bc[i], b = Bc[(i + 1) % 4], tv = Tv[i], tn = Tv[(i + 1) % 4];
    const mid = [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2];
    strip(a, b, tv, [mid[0], 0.02, mid[2]]);
    strip(tv, tn, b, [b[0], 0.02, b[2]]);
  }
  // Brüstung, Sockel der Spitze, Mast mit Ringen, Leuchtfeuer
  k.loft([Tv.map(([x, , z]) => [x, y1, z]), Tv.map(([x, , z]) => [x * 0.98, y1 + 4, z * 0.98])], FIN, { flat: true, capTop: true });
  k.cyl(9, 10, 6, 0, y1 + 4, 0, '#c9d0d6', { seg: 16 });
  k.cyl(2.2, 3.4, 118, 0, y1 + 10, 0, '#e3e6e8', { seg: 10 });
  for (const y of [452, 480, 505]) k.cyl(4.6, 4.6, 1.6, 0, y, 0, '#cfd5da', { seg: 12 });
  k.ball(1.0, 0, 541, 0, C.litW, { ws: 8, hs: 6, glow: true });
  return k.done();
}

// Chrysler Building, 319 m: weißer Ziegel mit Fensterbändern, Adler an den Ecken, Krone aus sieben Bögen in Edelstahl
// mit dreieckigen Fenstern (nachts weiß), Nadel
function chrysler() {
  const k = new K(), WB = '#ebe7df', WN = '#7c8590', SS = '#d4dbe1', SS2 = '#b9c3cb';
  skyBlock(k, 0, 0, 62, 50, 0, 60, WB, WN, 3.4, { seg: 8 });
  skyBlock(k, 0, 0, 50, 44, 60, 76, WB, WN, 3.4);
  skyBlock(k, 0, 0, 40, 40, 76, 240, WB, WN, 3.2, { seg: 14 });
  for (const [dx, dz] of [[-20, -20], [20, -20], [-20, 20], [20, 20]]) { k.box(3, 164, 3, dx, 76, dz, '#ddd8ce'); k.box(4, 3, 4, dx, 236, dz, SS); }
  for (const y of [120, 150, 180]) cornice(k, 0, 0, 40, 40, y, 0.8, 0.3, '#3c3f45');
  // Adler an den Ecken (61. Stock) und Kühlerfiguren
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.at(T(dx * 21, 233, dz * 21, Math.atan2(dx, dz)), () => { k.rbox(1.6, 1.4, 4.6, 0.4, 0, 0, 1.4, SS); k.cone(0.5, 1.4, 0, 0.3, 4.0, SS2, { seg: 4, rx: PI / 2 }); });
  // Krone: sieben Bogenreihen
  for (let t = 0; t < 7; t++) {
    const sh = 19 - 1.9 * t, yb = 240 + 5.2 * t, hs = 2.5;
    k.box(2 * sh - 1.2, hs + sh * 0.6, 2 * sh - 1.2, 0, yb, 0, SS2);
    for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => {
      const outline = [[-sh, 0], [sh, 0], [sh, hs], ...arc(0, hs, sh, 0, PI, 18).slice(1, -1), [-sh, hs]];
      k.ext(outline, null, 0.8, SS, { y: yb, z: -sh + 0.4 });
      for (let i = 0; i < 7; i++) {
        const a0 = (i + 0.15) / 7 * PI, a1 = (i + 0.85) / 7 * PI, am = (i + 0.5) / 7 * PI, r0 = sh * 0.5, r1 = sh * 0.88;
        const tri = [[Math.cos(a0) * r1, hs + Math.sin(a0) * r1], [Math.cos(a1) * r1, hs + Math.sin(a1) * r1], [Math.cos(am) * r0, hs + Math.sin(am) * r0]];
        k.plate([0, yb, -sh], [0, -1], tri, '#4c5560', { off: 0.05 });
        k.plate([0, yb, -sh], [0, -1], tri.map(([u, v]) => [u * 0.95, v]), '#f4f8ff', { off: 0.2, glow: true });
      }
    });
  }
  // Nadel
  k.cyl(0, 3.6, 37, 0, 282, 0, SS, { seg: 4, ry: PI / 4, flat: true });
  return k.done();
}

// Kapitol in Washington: weißer Mittelbau mit Kuppel auf Säulentambour und Freiheitsstatue, Senats- und Repräsentanten-
// haus als Flügel, Portiken mit Giebeln. Ostfront (Haupteingang) bei -z
function capitol() {
  const k = new K(), W = '#f3f1ea', W2 = '#e3e0d6', W3 = '#d5d1c5', BZ = '#5f6e66';
  const block = (x, z, w, d, h) => { k.rbox(w, h, d, 0.3, x, 0, z, W); cornice(k, x, z, w, d, 6, 0.8, 0.3, W2); cornice(k, x, z, w, d, h - 1.2, 1.2, 0.5, W2); balustrade(k, x, z, w / 2, d / 2, h, 1.6, 2.2, W); facade(k, [x, 0, z - d / 2], [0, -1], w - 4, [3.5, 11, 18], Math.round(w / 4.5), 1.4, 3.2, { col: '#6a737c', lc: C.lit }); facade(k, [x, 0, z + d / 2], [0, 1], w - 4, [3.5, 11, 18], Math.round(w / 4.5), 1.4, 3.2, { col: '#6a737c', lc: C.lit }); };
  block(0, 0, 100, 60, 24); block(0, 36, 70, 14, 24);
  for (const s of [-1, 1]) { block(s * 60, 0, 22, 40, 22); block(s * 88, 0, 50, 64, 23); }
  // Portiken mit Treppe und Giebel
  const portico = (x, z, n, sp, h, gH) => {
    const L = (n - 1) * sp;
    for (let i = 0; i < 9; i++) k.box(L + 8, 0.7, 1.2, x, i * 0.7, z - 12.5 + i * 1.1, W2);
    k.box(L + 6, 6.3, 8, x, 0, z - 4, W2);
    for (let i = 0; i < n; i++) column(k, x - L / 2 + i * sp, 6.3, z - 6.8, h, 0.85, W, { kind: 'corinth', seg: 10 });
    k.box(L + 5, 2.4, 9, x, 6.3 + h, z - 3.6, W2);
    k.ext([[-(L + 5) / 2, 0], [(L + 5) / 2, 0], [0, gH]], null, 9, W, { x, y: 8.7 + h, z: z - 3.6 });
  };
  portico(0, -30, 8, 4.2, 15, 6);
  for (const s of [-1, 1]) portico(s * 88, -32, 8, 4.0, 14, 5.5);
  // Kuppel: Sockel, Säulentambour, Attika mit Fenstern, Rippenkuppel, Laterne, Statue
  const yd = 24;
  k.cyl(21, 22, 6, 0, yd, 0, W2, { seg: 36 });
  k.cyl(16.5, 16.5, 15, 0, yd + 6, 0, W, { seg: 36 });
  colRing(k, 36, 18.6, yd + 6, 14.5, 0.55, W, { kind: 'corinth', seg: 6 });
  for (let i = 0; i < 18; i++) { const a = (i + 0.5) * TAU / 18; win(k, [Math.cos(a) * 16.55, yd + 13, Math.sin(a) * 16.55], [Math.cos(a), Math.sin(a)], 1.6, 6, { col: '#6a737c', lc: C.lit }); }
  k.cyl(19.6, 19.6, 1.4, 0, yd + 20.5, 0, W2, { seg: 36 });
  k.cyl(16, 16.6, 7, 0, yd + 21.9, 0, W, { seg: 36 });
  for (let i = 0; i < 24; i++) { const a = i * TAU / 24; win(k, [Math.cos(a) * 16.1, yd + 25.4, Math.sin(a) * 16.1], [Math.cos(a), Math.sin(a)], 1.2, 2.6, { col: '#6a737c', lc: C.lit }); }
  const prof = []; for (let i = 0; i <= 12; i++) { const a = i / 12 * PI / 2; prof.push([4 + 11.6 * Math.cos(a), yd + 28.9 + 21 * Math.sin(a)]); }
  k.lathe(prof, 0, 0, 0, W, { seg: 36 });
  for (let i = 0; i < 36; i++) { const a = i * TAU / 36; k.path(prof.map(([r, y]) => [Math.cos(a) * (r + 0.12), y, Math.sin(a) * (r + 0.12)]), 0.2, W3, { square: true }); }
  for (let j = 0; j < 2; j++) for (let i = 0; i < 18; i++) { const a = (i + 0.5) * TAU / 18, r = 4 + 11.6 * Math.cos(0.4 + j * 0.45), y = yd + 28.9 + 21 * Math.sin(0.4 + j * 0.45); k.box(0.9, 1.2, 0.5, Math.cos(a) * r, y, Math.sin(a) * r, '#6a737c', { ry: -a + PI / 2 }); }
  const yl = yd + 49.9;
  k.cyl(3.8, 4.2, 6, 0, yl, 0, W, { seg: 12 });
  colRing(k, 12, 4.6, yl, 6, 0.28, W, { kind: 'corinth', seg: 5 });
  k.cyl(4.0, 4.0, 1.4, 0, yl + 6, 0, '#ffe7b8', { seg: 12, glow: true });
  k.lathe(domeProfile(4.6, 2.6, 'dome', 6), 0, yl + 6, 0, W, { seg: 12 });
  k.ball(0.9, 0, yl + 9.2, 0, BZ, { ws: 8, hs: 6 });
  k.lathe([[0.8, 0], [0.7, 2.6], [0.45, 3.6], [0.25, 4.3], [0, 4.5]], 0, yl + 9.8, 0, BZ, { seg: 8 });
  k.ball(0.35, 0, yl + 14.5, 0, BZ, { ws: 6, hs: 4 });
  return k.done();
}

// Washington Monument: Obelisk 169 m aus Marmor, Farbwechsel auf einem Drittel der Höhe, rote Lichter oben
function washington_monument() {
  const k = new K(), M1 = '#f1eee7', M2 = '#e3ded3';
  k.box(24, 0.8, 24, 0, 0, 0, '#d9d4c9');
  const half = (y) => lerp(8.4, 5.25, y / 152.4);
  k.loft([rectRing(half(0), half(0), 0.8), rectRing(half(46), half(46), 46)], M1, { flat: true });
  k.loft([rectRing(half(46), half(46), 46), rectRing(5.25, 5.25, 152.4)], M2, { flat: true });
  k.cyl(0, 5.25 * Math.SQRT2, 16.9, 0, 152.4, 0, M2, { seg: 4, ry: PI / 4, flat: true });
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => {
    for (const x of [-1.2, 1.2]) k.panel([x, 149.5, -5.36], [0, -1], 0.45, 0.6, '#3e4247', { off: 0.03 });
    k.ball(0.5, 0, 156, -5.0, C.litR, { ws: 6, hs: 4, glow: true });
  });
  return k.done();
}

// =====================================================================================================
// Rom, Pisa, Barcelona, Köln, Brüssel
// =====================================================================================================

// Kolosseum: Ellipse 189 x 156 m, 48 m hoch, drei Bogenreihen und Attika auf der Nordseite (-z), auf der Südseite
// nur der innere Ring, Ränge, Arena mit freigelegten Kellern
function kolosseum() {
  const k = new K(), TR = '#e2d3b5', TR2 = '#d3c3a3', TR3 = '#c2b190', BR = '#b98a6a';
  const A = 94.5, B = 78, NB = 80;
  const pos = (a, b, th) => [Math.cos(th) * a, Math.sin(th) * b];
  const nrm = (a, b, th) => { const nx = Math.cos(th) / a, nz = Math.sin(th) / b, L = Math.hypot(nx, nz); return [nx / L, nz / L]; };
  const bw = 2 * PI * Math.sqrt((A * A + B * B) / 2) / NB;
  const lv = [[0, 10.5, 7.4, 4.4], [10.5, 11.5, 6.6, 4.2], [22, 11.5, 6.6, 4.2]];
  const panels = lv.map(([y0, h, oh, ow]) => extGeo([[-bw / 2 - 0.05, 0], [bw / 2 + 0.05, 0], [bw / 2 + 0.05, h], [-bw / 2 - 0.05, h]], [archHole(0, ow, 0.0001 + (y0 ? 1.2 : 0), (y0 ? 1.2 : 0) + oh - ow / 2, 6)], 2.4, 6));
  // Erhaltung je Joch: 4 = ganz mit Attika, 0 = außen weg
  const keep = (th) => { const d = (th * 180 / PI + 360) % 360; if (d >= 197 && d <= 343) return 4; if (d >= 190 && d < 197) return Math.round((d - 190) / 7 * 3); if (d > 343 && d <= 350) return Math.round((350 - d) / 7 * 3); return 0; };
  for (let i = 0; i < NB; i++) {
    const th = (i + 0.5) * TAU / NB, [x, z] = pos(A, B, th), [nx, nz] = nrm(A, B, th), ry = Math.atan2(nx, nz) + PI;
    const kp = keep(th);
    k.at(T(x, 0, z, ry), () => {
      for (let l = 0; l < Math.min(3, kp); l++) {
        k.geo(panels[l].clone(), TR, {});
        k.box(1.0, lv[l][1] - 1.2, 0.5, bw / 2, lv[l][0], -1.4, TR2);
        k.box(bw + 0.1, 1.0, 2.9, 0, lv[l][0] + lv[l][1] - 1.0, -0.2, TR2);
      }
      if (kp >= 4) {
        k.box(bw + 0.1, 15, 2.4, 0, 33.5, 0, TR);
        k.box(0.9, 13, 0.5, bw / 2, 34, -1.4, TR2);
        if (i % 2) k.panel([0, 39, -1.21], [0, -1], 0.9, 1.3, '#6f6553', { off: 0 });
        k.box(bw + 0.1, 1.0, 3.0, 0, 47.5, -0.2, TR2);
      }
    });
  }
  // Ziegelstützen an den Bruchkanten (19. Jahrhundert)
  for (const d of [190, 350]) { const th = d * PI / 180, [x, z] = pos(A, B, th), [nx, nz] = nrm(A, B, th); k.at(T(x, 0, z, Math.atan2(nx, nz) + PI), () => k.ext([[0, 0], [7, 0], [1.5, 33]], null, 3, BR, { ry: PI / 2, x: (d < 200 ? 1 : -1) * 2 })); }
  // innerer Ring mit zwei Bogenreihen (sichtbar, wo der äußere fehlt), sonst geschlossene Wand
  const A2 = A - 9, B2 = B - 9;
  const p2 = lv.slice(0, 2).map(([y0, h, oh, ow]) => extGeo([[-bw * 0.46, 0], [bw * 0.46, 0], [bw * 0.46, h], [-bw * 0.46, h]], [archHole(0, ow * 0.9, 0.0001 + (y0 ? 1.2 : 0), (y0 ? 1.2 : 0) + oh - ow / 2, 5)], 2.0, 5));
  for (let i = 0; i < NB; i++) {
    const th = (i + 0.5) * TAU / NB, [x, z] = pos(A2, B2, th), [nx, nz] = nrm(A2, B2, th), kp = keep(th);
    k.at(T(x, 0, z, Math.atan2(nx, nz) + PI), () => {
      if (kp >= 3) k.box(bw * 0.95, 33, 2.0, 0, 0, 0, TR3);
      else { k.geo(p2[0].clone(), TR2, {}); k.geo(p2[1].clone(), TR2, {}); k.box(bw * 0.92, 1.0, 2.4, 0, 10.5, 0, TR3); if (hash(i, 5) < 0.6) k.box(bw * 0.92, 2 + 6 * hash(i, 9), 2.0, 0, 22, 0, TR3); }
    });
  }
  // Ränge: Stufen zwischen innerem Ring und Arena, ruinös gefärbt
  const rings = [], ns = 64, steps = 7;
  for (let s2 = 0; s2 <= steps; s2++) {
    const t = s2 / steps, a = lerp(A2 - 1, 44, t), b = lerp(B2 - 1, 27, t), yTop = lerp(24, 5, t), yNext = lerp(24, 5, Math.min(1, (s2 + 1) / steps));
    rings.push(circRing(1, yTop, ns).map(([cx, , cz]) => [cx * a, yTop, cz * b]));
    if (s2 < steps) rings.push(circRing(1, yNext, ns).map(([cx, , cz]) => [cx * a, yNext, cz * b]));
  }
  k.loft(rings, TR3, { flat: true, cfi: (i, j) => (hash(i * 13 + j, 4) < 0.35 ? BR : hash(i, j) < 0.5 ? TR3 : TR2) });
  // Arena: Mauer, Keller (Hypogäum), teils wieder belegter Boden
  k.loft([circRing(1, 0, 48).map(([x, , z]) => [x * 44, 0, z * 27]), circRing(1, 5, 48).map(([x, , z]) => [x * 44, 5, z * 27])], TR2, { flat: true, inv: true });
  k.loft([circRing(1, 0, 48).map(([x, , z]) => [x * 44, 0.3, z * 27]), circRing(1, 0, 48).map(([x, , z]) => [x * 0.5, 0.3, z * 0.5])], '#b8a586', { flat: true });
  for (let j = 0; j < 9; j++) { const z = -18 + j * 4.5, L = 2 * 40 * Math.sqrt(Math.max(0.1, 1 - (z / 26) ** 2)); k.box(L * 0.8, 4.2, 0.9, -4, 0, z, BR); }
  for (let j = 0; j < 7; j++) k.box(0.9, 4.2, 30, -30 + j * 8, 0, 0, BR);
  k.box(30, 0.6, 50, 26, 4.4, 0, '#b89b72');
  return k.done();
}

// Petersdom: Fassade 115 m breit mit Kolossalsäulen und 13 Statuen (vorn bei -x), Langhaus, Zentralbau mit Apsiden,
// Kuppel 136,6 m mit Doppelsäulen am Tambour, Rippen, Laterne, zwei Nebenkuppeln
function petersdom() {
  const k = new K(), T1 = '#eadfc8', T2 = '#dccfb5', T3 = '#cfc1a4', LD = '#8d99a6';
  // Langhaus und Zentralbau
  k.rbox(68, 46, 64, 0.4, -71, 0, 0, T1);
  k.rbox(130, 46, 100, 0.4, 30, 0, 0, T1);
  k.rbox(100, 46, 130, 0.4, 30, 0, 0, T1);
  for (const [x, z, a] of [[95, 0, 0], [30, 65, PI / 2], [30, -65, -PI / 2]]) k.at(T(x, 0, z, -a), () => { k.cyl(25, 25, 46, 0, 0, 0, T1, { seg: 20, t0: 0, tl: PI }); k.cyl(25.6, 25.6, 3, 0, 43, 0, T2, { seg: 20, t0: 0, tl: PI }); for (let i = 0; i < 6; i++) { const b = (i + 0.5) / 6 * PI; k.box(2.2, 40, 1.2, Math.sin(b) * 25.3, 3, Math.cos(b) * 25.3, T2, { ry: b }); win(k, [Math.sin(b) * 25.05, 24, Math.cos(b) * 25.05], [Math.sin(b), Math.cos(b)], 3, 9, { kind: 'arch', col: '#6a6f72', lc: C.lit }); } });
  for (const [x, z, w, d] of [[-71, 0, 68, 64], [30, 0, 130, 100], [30, 0, 100, 130]]) { cornice(k, x, z, w, d, 41, 1.6, 0.8, T2); }
  k.ext([[-33, 0], [33, 0], [0, 8]], null, 66, LD, { ry: PI / 2, x: -71, y: 46 });
  // Fassade bei -x
  const xf = -110;
  k.rbox(10, 45.5, 114.7, 0.3, xf + 5, 0, 0, T1);
  for (let i = 0; i < 12; i++) { const z = -50 + i * 100 / 11; if (Math.abs(z) < 30) column(k, xf - 1.2, 4, z, 27, 1.5, T1, { kind: 'corinth', seg: 12 }); else k.box(2.4, 27, 2.0, xf - 0.6, 4, z, T2); }
  k.box(3.6, 4, 116, xf - 1, 0, 0, T3);
  k.box(4, 7, 116, xf, 31, 0, T2);
  k.box(2, 0.8, 22, xf - 2, 37.4, 0, T3);
  k.ext([[-13, 0], [13, 0], [0, 5.5]], null, 4, T1, { ry: PI / 2, x: xf, y: 38 });
  k.box(3, 7.5, 116, xf + 0.5, 38, 0, T1);
  facade(k, [xf - 1, 0, 0], [-1, 0], 100, [41.5], 14, 1.6, 2.8, { col: '#6a6f72', lc: C.lit });
  facade(k, [xf - 1, 0, 0], [-1, 0], 100, [10, 22], 7, 2.6, 6, { kind: 'arch', col: '#5d6265', lc: C.lit });
  for (let i = 0; i < 13; i++) { const z = -24 + i * 4; k.lathe([[0.7, 0], [0.55, 2.2], [0.3, 3.2], [0, 3.4]], xf + 0.5, 45.5, z, T3, { seg: 6 }); k.ball(0.32, xf + 0.5, 49.2, z, T3, { ws: 6, hs: 4 }); }
  for (const s of [-1, 1]) { k.rbox(8, 50, 9, 0.3, xf + 5, 0, s * 53, T1); k.plate([xf + 1, 44, s * 53], [-1, 0], ngon(2.2, 16), '#f2ece0', { off: 0.05 }); k.lathe(domeProfile(3.6, 6, 'dome', 6), xf + 5, 50, s * 53, LD, { seg: 12 }); k.cyl(0.4, 0.6, 2.6, xf + 5, 56, s * 53, T2, { seg: 6 }); }
  // Nebenkuppeln
  for (const s of [-1, 1]) { const z = s * 38, x = -18; k.cyl(5.4, 5.6, 9, x, 46, z, T1, { seg: 12 }); colRing(k, 8, 6, 46, 8.5, 0.35, T2, { kind: 'corinth', seg: 5 }); k.lathe(domeProfile(5.8, 8, 'ogive', 8), x, 55, z, LD, { seg: 12 }); k.cyl(1.0, 1.2, 4, x, 62.5, z, T2, { seg: 8 }); k.cone(1.1, 2.6, x, 66.5, z, LD, { seg: 8 }); }
  // Hauptkuppel
  const xd = 30, yd = 46;
  k.rbox(56, 7, 56, 0.4, xd, yd, 0, T2);
  k.cyl(23.4, 23.8, 18, xd, yd + 7, 0, T1, { seg: 32 });
  for (let i = 0; i < 16; i++) {
    const a = i * TAU / 16;
    for (const da of [-0.06, 0.06]) column(k, xd + Math.cos(a + da) * 25, yd + 7, Math.sin(a + da) * 25, 17, 0.75, T1, { kind: 'corinth', seg: 8 });
    k.box(3.6, 17, 2.4, xd + Math.cos(a) * 24, yd + 7, Math.sin(a) * 24, T2, { ry: -a });
    const b = a + PI / 16;
    win(k, [xd + Math.cos(b) * 23.45, yd + 15, Math.sin(b) * 23.45], [Math.cos(b), Math.sin(b)], 3.0, 8, { col: '#5d6265', lc: C.lit, frame: T3 });
  }
  k.cyl(26.4, 26.4, 2.6, xd, yd + 24, 0, T2, { seg: 32 });
  k.cyl(22.6, 23.2, 6, xd, yd + 26.6, 0, T1, { seg: 32 });
  const prof = []; for (let i = 0; i <= 14; i++) { const t = i / 14, a = t * PI / 2; prof.push([4.6 + 17.6 * Math.pow(Math.cos(a), 0.85), yd + 32.6 + 34 * Math.sin(a)]); }
  k.lathe(prof, xd, 0, 0, LD, { seg: 32 });
  for (let i = 0; i < 16; i++) { const a = i * TAU / 16; k.path(prof.map(([r, y]) => [xd + Math.cos(a) * (r + 0.3), y, Math.sin(a) * (r + 0.3)]), 0.55, T2, { square: true }); }
  for (const [tt, w] of [[0.22, 1.4], [0.45, 1.1], [0.66, 0.8]]) for (let i = 0; i < 16; i++) { const a = (i + 0.5) * TAU / 16, j = Math.round(tt * 14), [r, y] = prof[j]; k.box(w, w * 1.2, w, xd + Math.cos(a) * r, y, Math.sin(a) * r, T2, { ry: -a }); }
  const yl = yd + 66.6;
  k.cyl(5.2, 5.6, 10, xd, yl, 0, T1, { seg: 16 });
  for (let i = 0; i < 16; i++) { const a = i * TAU / 16; k.cyl(0.35, 0.35, 9, xd + Math.cos(a) * 6.1, yl, Math.sin(a) * 6.1, T2, { seg: 5 }); }
  k.cyl(6.4, 6.4, 1, xd, yl + 10, 0, T2, { seg: 16 });
  k.lathe([[5.6, 0], [4.6, 2], [2.4, 4], [1.0, 6.5], [0.6, 8], [0, 8.2]], xd, yl + 11, 0, LD, { seg: 16 });
  k.ball(1.1, xd, yl + 20.6, 0, C.gold, { ws: 10, hs: 8 });
  k.box(0.4, 3.6, 0.4, xd, yl + 21.6, 0, C.gold); k.box(2.0, 0.4, 0.4, xd, yl + 24.4, 0, C.gold);
  return k.done({ front: '-x', center: true });
}

// Schiefer Turm von Pisa: weißer Marmor, Erdgeschoss mit Blendbögen, sechs Galerien mit Säulen, Glockenstube,
// um knapp 4 Grad nach +x geneigt
function schiefer_turm() {
  const k = new K(), M = '#efe9dc', M2 = '#ddd5c4', M3 = '#c9c0ae';
  k.cyl(9.4, 9.6, 1.6, 0, -1, 0, '#cfc8ba', { seg: 32 });
  k.at(T(0, 0, 0, 0, 0, -3.97 * PI / 180), () => {
    // Erdgeschoss mit 15 Blendbögen
    k.cyl(7.6, 7.74, 11, 0, 0, 0, M, { seg: 30 });
    for (let i = 0; i < 15; i++) { const a = i * TAU / 15; k.cyl(0.32, 0.32, 8.6, Math.cos(a) * 7.8, 0, Math.sin(a) * 7.8, M2, { seg: 6 }); k.plate([Math.cos(a + PI / 15) * 7.78, 0, Math.sin(a + PI / 15) * 7.78], [Math.cos(a + PI / 15), Math.sin(a + PI / 15)], archHole(0, 2.2, 1.0, 7.4, 4), M3, { off: 0.02 }); }
    k.cyl(8.1, 8.1, 0.8, 0, 11, 0, M2, { seg: 30 });
    // sechs Galerien
    for (let g = 0; g < 6; g++) {
      const y0 = 11.8 + g * 5.9, h = 5.9;
      k.cyl(6.3, 6.3, h, 0, y0, 0, M3, { seg: 24 });
      for (let i = 0; i < 30; i++) { const a = i * TAU / 30; k.cyl(0.24, 0.27, h - 1.6, Math.cos(a) * 7.55, y0 + 0.5, Math.sin(a) * 7.55, M, { seg: 5, open: true }); }
      const ring = (r, f) => circRing(1, 0, 120).map(([x, , z], j) => { const t = (j % 4) / 4; return [x * r, y0 + h - 1.1 - 0.75 * Math.sin(PI * t) * f, z * r]; });
      const top = circRing(7.85, y0 + h, 120);
      k.loft([ring(7.85, 1), top], M, { flat: true });
      k.loft([ring(6.3, 1), ring(7.85, 1)].map(r => r.slice()), M2, { flat: true, inv: true });
      k.cyl(8.0, 8.0, 0.5, 0, y0, 0, M2, { seg: 30 });
    }
    // Glockenstube
    const yb = 11.8 + 6 * 5.9;
    k.cyl(5.0, 5.0, 7.2, 0, yb, 0, M, { seg: 24 });
    for (let i = 0; i < 12; i++) { const a = i * TAU / 12; win(k, [Math.cos(a) * 5.05, yb + 3.5, Math.sin(a) * 5.05], [Math.cos(a), Math.sin(a)], 1.4, 3.6, { kind: 'arch', col: '#59544c', lit: false }); }
    k.cyl(5.4, 5.4, 0.6, 0, yb + 7.2, 0, M2, { seg: 24 });
    for (let i = 0; i < 24; i++) { const a = i * TAU / 24; k.box(0.5, 0.9, 0.5, Math.cos(a) * 5.15, yb + 7.8, Math.sin(a) * 5.15, M2); }
  });
  return k.done();
}

// Sagrada Família (Stand 2026): Jesusturm 172,5 m mit Kreuz, vier Evangelisten, Marienturm mit Stern, je vier Glockentürme
// an Geburts- (+z) und Passionsfassade (-z), Glorienfassade im Bau (vorn bei -x)
function sagrada_familia() {
  const k = new K(), ST = '#d3bc95', ST2 = '#c4ab83', NW = '#e6dfcf', NW2 = '#d8cfbc', DK = '#6e5d4a';
  const mosaic = ['#d9655a', '#e8c15c', '#f4f1ea', '#7fb38f', '#e8c15c'];
  // Schiff, Querhaus, Apsis
  k.rbox(80, 45, 45, 0.4, 5, 0, 0, ST);
  k.ext([[-23, 0], [23, 0], [3, 17], [-3, 17]], null, 80, ST2, { ry: PI / 2, x: 5, y: 45 });
  k.rbox(30, 45, 60, 0.4, 20, 0, 0, ST);
  k.ext([[-16, 0], [16, 0], [2, 15], [-2, 15]], null, 60, ST2, { x: 20, y: 45 });
  k.cyl(22.5, 22.5, 40, 45, 0, 0, ST, { seg: 20, t0: 0, tl: PI });
  for (let i = 0; i <= 6; i++) { const a = i / 6 * PI, x = 45 + Math.sin(a) * 24, z = Math.cos(a) * 24; k.lathe([[2.2, 0], [1.8, 20], [0.9, 40], [0, 48]], x, 0, z, ST, { seg: 8 }); k.ball(0.9, x, 48, z, '#e8c15c', { ws: 6, hs: 4 }); }
  for (const s of [-1, 1]) for (let i = 0; i < 9; i++) win(k, [-30 + i * 8, 24, s * 22.6], [0, s], 3.2, 22, { kind: 'pointed', col: '#5b5e66', lc: '#ffc57a' });
  // Glockenturm im Stil Gaudís: parabolisch, Schallöffnungen, bunte Bischofsmützen
  const bell = (x, z, H, r0) => {
    const y0 = 30, prof = []; for (let i = 0; i <= 12; i++) { const t = i / 12; prof.push([r0 * Math.pow(1 - t * 0.82, 0.7), y0 + t * (H - y0 - 12)]); }
    k.lathe(prof, x, 0, z, (px, py, pz) => { const th = Math.atan2(pz - z, px - x); return py > y0 + 12 && py < H - 26 && Math.sin(th * 7 + py * 0.2) > 0.2 && (py % 2.6) < 1.3 ? DK : ST; }, { seg: 16 });
    k.cyl(r0, r0, y0, x, 0, z, ST, { seg: 16 });
    const yt = H - 12;
    k.lathe([[1.6, 0], [2.0, 3], [1.4, 6], [1.8, 8], [0.6, 10.5], [0, 11]], x, yt, z, (px, py) => mosaic[Math.floor((py - yt) / 2.2) % mosaic.length], { seg: 8, flat: true });
    k.ball(0.9, x, yt + 11.6, z, '#f4f1ea', { ws: 8, hs: 6 });
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) k.ball(0.45, x + dx * 0.9, yt + 11.6, z + dz * 0.9, '#e8c15c', { ws: 6, hs: 4 });
  };
  // Geburtsfassade (+z): Portale, Zypresse, vier Türme
  k.rbox(32, 45, 8, 0.6, 20, 0, 33, ST2);
  for (const [x, w, h] of [[10, 6, 22], [20, 8, 28], [30, 6, 22]]) k.plate([x, 0, 37], [0, 1], archHole(0, w, 0, h - w * 0.7, 6, 'pointed'), DK, { off: 0.05 });
  for (let i = 0; i < 40; i++) k.ico(0.6 + hash(i, 1) * 1.1, 6 + hash(i, 2) * 28, 4 + hash(i, 3) * 40, 37.1, ST, 0);
  k.lathe([[3.2, 0], [2.6, 5], [1.4, 10], [0, 14]], 20, 45, 34, '#6f9a6a', { seg: 10 });
  for (const [x, H] of [[7, 98], [14, 107], [26, 107], [33, 98]]) bell(x, 34, H, 3.6);
  // Passionsfassade (-z): schräge Knochensäulen, Vordach, vier Türme
  k.rbox(32, 45, 6, 0.6, 20, 0, -32, ST2);
  k.box(34, 2, 9, 20, 22, -37, NW2);
  for (let i = 0; i < 6; i++) { const x = 6 + i * 5.6; k.tube([x, 0, -40.5], [x + (i - 2.5) * 0.9, 22, -38], 0.9, NW2, { seg: 8, r2: 0.6 }); }
  for (let i = 0; i < 18; i++) k.box(1.0, 8 + (i % 3) * 2, 1.0, 5 + i * 1.75, 24, -36.5, NW2);
  for (const [x, H] of [[7, 107], [14, 112], [26, 112], [33, 107]]) bell(x, -34, H, 3.6);
  // Glorienfassade (-x), unvollendet
  k.rbox(10, 40, 46, 0.5, -40, 0, 0, NW2);
  for (const z of [-14, 0, 14]) k.plate([-45, 0, z], [-1, 0], archHole(0, 7, 0, 20, 6, 'pointed'), DK, { off: 0.05 });
  // Mittlere Türme: Jesus, vier Evangelisten, Maria
  const ribT = (x, z, H, r0, top) => {
    const prof = []; for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push([r0 * Math.pow(1 - t * 0.78, 0.8), 45 + t * (H - 45)]); }
    k.lathe(prof, x, 0, z, (px, py, pz) => (Math.sin(Math.atan2(pz - z, px - x) * 12) > 0.6 ? NW2 : NW), { seg: 24, flat: true });
    top(H);
  };
  const xc = 20;
  ribT(xc, 0, 155, 9.5, (H) => {
    k.cyl(0.3, 3.6, 4, xc, H, 0, NW, { seg: 12 });
    const yc = H + 3.4;
    k.box(2.2, 14, 2.2, xc, yc, 0, '#f4f6f8'); k.box(13.5, 2.2, 2.2, xc, yc + 8, 0, '#f4f6f8'); k.box(2.2, 2.2, 13.5, xc, yc + 8, 0, '#f4f6f8');
    k.box(2.6, 14.4, 2.6, xc, yc - 0.2, 0, '#fff6dd', { glow: true });
  });
  for (const [dx, dz, c] of [[-13, -13, '#e8c15c'], [13, -13, '#d9655a'], [-13, 13, '#7fb38f'], [13, 13, '#f4f1ea']]) ribT(xc + dx, dz, 130, 5.6, (H) => { k.ico(2.6, xc + dx, H + 3, dz, c, 1); k.ico(1.2, xc + dx, H + 6.2, dz, '#f4f1ea', 0); });
  ribT(38, 0, 128, 6.2, (H) => {
    k.cyl(0.4, 0.8, 3, 38, H, 0, NW, { seg: 8 });
    for (let i = 0; i < 12; i++) { const a = i * TAU / 12; k.tube([38, H + 7, 0], [38 + Math.cos(a) * 3.6, H + 7 + Math.sin(a) * 3.6, 0], 0.5, '#e9eef2', { seg: 4, r2: 0.05 }); k.tube([38, H + 7, 0], [38 + Math.cos(a) * 3.8, H + 7 + Math.sin(a) * 3.8, 0], 0.6, '#fff2c8', { seg: 4, r2: 0.05, glow: true }); }
  });
  return k.done({ front: '-x', center: true });
}

// Kölner Dom: zwei Türme 157 m mit durchbrochenen Helmen und Kreuzblumen (Westfassade vorn bei -x), Schiff mit
// Strebewerk und Fialen, Querhaus, Chor mit Kapellenkranz, Dachreiter
function koelner_dom() {
  const k = new K(), S = '#9b968d', S2 = '#8a857c', S3 = '#7a756d', RF = '#5f6b78';
  // Mittelschiff, Seitenschiffe, Querhaus, Chor
  k.box(108, 43, 15, 0, 0, 0, S);
  gableRoof(k, 0, 0, 108, 15, 43, 18, RF, { ov: 0.6 });
  for (const s of [-1, 1]) { k.box(108, 20, 15, 0, 0, s * 15, S2); k.slab([[-54, 24, s * 7.5], [54, 24, s * 7.5], [54, 19.6, s * 22.8], [-54, 19.6, s * 22.8]], 0.6, RF); }
  k.box(22, 43, 86, 18, 0, 0, S);
  gableRoof(k, 18, 0, 86, 22, 43, 18, RF, { ov: 0.6, alongZ: true });
  for (const s of [-1, 1]) {
    k.ext([[-11, 0], [11, 0], [0, 16]], null, 1.2, S2, { x: 18, y: 43, z: s * 43.3 });
    for (const [x, w, h] of [[11, 4, 12], [18, 5.5, 15], [25, 4, 12]]) k.plate([x, 0, s * 43], [0, s], archHole(0, w, 0, h - w * 0.6, 5, 'pointed'), '#4d4a46', { off: 0.06 });
    win(k, [18, 30, s * 43], [0, s], 9, 18, { kind: 'pointed', col: '#555a62', lc: '#ffc57a' });
    for (const x of [7.5, 28.5]) { k.box(2.4, 50, 2.4, x, 0, s * 43, S2); pinnacle(k, x, 50, s * 43, 10, 1.6, S2, { top: S3 }); }
  }
  k.cyl(7.5, 7.5, 43, 54, 0, 0, S, { seg: 14, t0: 0, tl: PI });
  k.lathe([[8.1, 0], [0.2, 15]], 54, 43, 0, RF, { seg: 14, p0: 0, pl: PI });
  k.cyl(22.5, 22.5, 20, 54, 0, 0, S2, { seg: 18, t0: 0, tl: PI });
  for (let i = 0; i < 7; i++) { const a = (i + 0.5) / 7 * PI; k.cyl(5.2, 5.2, 18, 54 + Math.sin(a) * 23, 0, Math.cos(a) * 23, S2, { seg: 8 }); k.cone(5.8, 7, 54 + Math.sin(a) * 23, 18, Math.cos(a) * 23, RF, { seg: 8 }); }
  k.lathe([[22.5, 0], [7.5, 4]], 54, 20, 0, RF, { seg: 18, p0: 0, pl: PI });
  // Fenster und Strebewerk mit Fialen
  for (const s of [-1, 1]) for (let i = 0; i < 13; i++) {
    const x = -50 + i * 8.2; if (Math.abs(x - 18) < 13) continue;
    win(k, [x, 32, s * 7.5], [0, s], 3.4, 15, { kind: 'pointed', col: '#555a62', lc: '#ffc57a' });
    win(k, [x, 10.5, s * 22.5], [0, s], 3.2, 12, { kind: 'pointed', col: '#555a62', lc: '#ffc57a' });
    const xb = x + 4.1, zb = s * 24;
    k.box(2.4, 30, 2.8, xb, 0, zb, S2);
    pinnacle(k, xb, 30, zb, 14, 1.8, S2, { top: S3 });
    pinnacle(k, xb, 20, s * 15.5, 10, 1.2, S2, { top: S3 });
    for (const [y0, y1] of [[27, 34], [33, 41]]) k.beam([xb, y0, zb], [xb, y1, s * 7.8], [0.8, 1.0], S2);
  }
  for (let i = 0; i <= 8; i++) { const a = i / 8 * PI, x = 54 + Math.sin(a) * 25, z = Math.cos(a) * 25; pinnacle(k, x, 24, z, 14, 1.8, S2, { top: S3 }); k.beam([x, 30, z], [54 + Math.sin(a) * 8, 40, Math.cos(a) * 8], [0.8, 1.0], S2); k.box(2.2, 24, 2.2, x, 0, z, S2); }
  // Dachreiter über der Vierung
  k.cyl(2.2, 2.6, 8, 18, 58, 0, RF, { seg: 8 }); k.cyl(0.2, 2.2, 40, 18, 66, 0, RF, { seg: 8, flat: true }); k.ball(0.8, 18, 107, 0, C.gold, { ws: 8, hs: 6 });
  // Westfassade mit zwei Türmen
  const xf = -54, F = -76;
  k.box(22, 50, 21, xf - 11, 0, 0, S);
  k.ext([[-10.5, 0], [10.5, 0], [0, 16]], null, 1.2, S2, { ry: PI / 2, x: F + 1, y: 44 });
  for (const s of [-1, 1]) {
    const zc = s * 20.25;
    // Turmkörper in Stufen mit Strebepfeilern und Fialen
    k.box(22, 98, 19.5, xf - 11, 0, zc, S);
    for (const [dx, dz] of [[-11, -9.75], [11, -9.75], [-11, 9.75], [11, 9.75]]) {
      k.box(3.2, 70, 3.2, xf - 11 + dx, 0, zc + dz, S2); k.box(2.6, 20, 2.6, xf - 11 + dx * 0.95, 70, zc + dz * 0.95, S2);
      pinnacle(k, xf - 11 + dx * 0.9, 90, zc + dz * 0.9, 16, 2.2, S2, { top: S3 });
      for (const y of [30, 55, 75]) pinnacle(k, xf - 11 + dx * 1.07, y, zc + dz * 1.07, 8, 1.2, S2, { top: S3 });
    }
    for (const y of [22, 47, 72]) k.box(23, 1.2, 20.5, xf - 11, y, zc, S2);
    for (const [n, cx, cz] of [[[-1, 0], F, zc], [[0, s], xf - 11, zc + s * 9.75]]) {
      win(k, [cx, 34, cz], n, 5, 20, { kind: 'pointed', col: '#4d4a46', lit: false });
      for (const u of [-2.6, 2.6]) win(k, [cx + (n[1] ? u : 0), 61, cz + (n[0] ? u : 0)], n, 2.4, 18, { kind: 'pointed', col: '#4d4a46', lit: false });
      win(k, [cx, 85, cz], n, 4.2, 14, { kind: 'pointed', col: '#4d4a46', lit: false });
      k.ext([[-4, 0], [4, 0], [0, 7]], null, 0.8, S2, { ry: n[0] ? PI / 2 : 0, x: cx + n[0] * 0.4, y: 44 + 0, z: cz + n[1] * 0.4 });
    }
    // Achteck mit Fialenkranz, durchbrochener Helm, Kreuzblume
    const yo = 98;
    k.cyl(8.6, 9.2, 14, xf - 11, yo, zc, S, { seg: 8, ry: PI / 8, flat: true });
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8 + PI / 8; pinnacle(k, xf - 11 + Math.cos(a) * 9.8, yo, zc + Math.sin(a) * 9.8, 18, 1.6, S2, { top: S3 }); win(k, [xf - 11 + Math.cos(a + PI / 8) * 8.4, yo + 7, zc + Math.sin(a + PI / 8) * 8.4], [Math.cos(a + PI / 8), Math.sin(a + PI / 8)], 2.6, 9, { kind: 'pointed', col: '#4d4a46', lit: false }); }
    const yh = yo + 14, Hh = 40;
    for (let i = 0; i < 8; i++) {
      const a = i * TAU / 8 + PI / 8;
      k.beam([xf - 11 + Math.cos(a) * 8.6, yh, zc + Math.sin(a) * 8.6], [xf - 11, yh + Hh, zc], 1.1, S2);
      for (let j = 1; j < 9; j++) { const t = j / 10, r = 8.6 * (1 - t); k.box(0.9, 0.7, 1.4, xf - 11 + Math.cos(a) * (r + 0.6), yh + t * Hh, zc + Math.sin(a) * (r + 0.6), S3, { ry: -a }); }
    }
    k.cyl(0.6, 8.0, Hh, xf - 11, yh, zc, (px, py, pz) => (Math.floor((py - yh) / 3.2) % 2 ? S3 : '#57534d'), { seg: 8, ry: PI / 8, flat: true });
    const yk = yh + Hh;
    k.cyl(0.5, 0.7, 2.5, xf - 11, yk - 0.5, zc, S2, { seg: 8 });
    for (let i = 0; i < 4; i++) k.at(T(xf - 11, yk + 2.2, zc, i * PI / 2), () => k.ext([[0, -0.8], [2.4, 0.2], [1.2, 1.4], [0, 0.9]], null, 0.6, S2));
    k.cone(0.9, 2.6, xf - 11, yk + 2.4, zc, S2, { seg: 8 });
  }
  for (const [z, w, h] of [[-10.5, 4.5, 14], [0, 6, 18], [10.5, 4.5, 14]]) k.plate([F, 0, z], [-1, 0], archHole(0, w, 0, h - w * 0.6, 5, 'pointed'), '#4d4a46', { off: 0.06 });
  win(k, [F, 31, 0], [-1, 0], 9, 20, { kind: 'pointed', col: '#555a62', lc: '#ffc57a' });
  return k.done({ front: '-x', center: true });
}

// Atomium, 102 m: neun Edelstahlkugeln (18 m) als Würfel auf der Spitze, Röhren, drei Stützen, nachts funkelnde Lichter
const ATOM_YAW = PI / 4;
function atomium() {
  const k = new K(), SS = '#d6dce2', SS2 = '#b9c2ca', a = 47, y0 = 11.6;
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 1, 1).normalize(), new THREE.Vector3(0, 1, 0));
  const q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ATOM_YAW);
  const yc = y0 + a * Math.sqrt(3) / 2;
  const P = []; for (let i = 0; i < 8; i++) P.push(new THREE.Vector3(i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1).multiplyScalar(a / 2).applyQuaternion(q).applyQuaternion(q2).add(new THREE.Vector3(0, yc, 0)));
  const Cn = new THREE.Vector3(0, yc, 0);
  const all = [...P, Cn];
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) if ([1, 2, 4].includes(i ^ j)) k.tube(P[i], P[j], 1.6, SS2, { seg: 10 });
  for (const p of P) k.tube(p, Cn, 1.6, SS2, { seg: 10 });
  for (const [i, p] of all.entries()) {
    k.ico(9, p.x, p.y, p.z, SS, 2);
    for (let j = 0; j < 22; j++) { const d = new THREE.Vector3(hash(i, j) - 0.5, hash(j, i + 3) - 0.5, hash(i + 7, j * 3) - 0.5).normalize().multiplyScalar(9.05); k.box(0.45, 0.45, 0.45, p.x + d.x, p.y + d.y, p.z + d.z, '#fff6e0', { glow: true }); }
  }
  const top = all.reduce((m, p) => (p.y > m.y ? p : m), all[0]);
  k.cyl(9.15, 9.15, 2.2, top.x, top.y - 0.8, top.z, '#56626d', { seg: 24, open: true });
  k.cyl(9.25, 9.25, 1.6, top.x, top.y - 0.5, top.z, C.lit, { seg: 24, open: true, glow: true });
  // Stützen zu den drei unteren äußeren Kugeln, Eingang unter der unteren Kugel
  const low = all.filter(p => p !== Cn).sort((u, v) => u.y - v.y);
  for (const p of low.slice(1, 4)) { const d = new THREE.Vector3(p.x, 0, p.z).normalize(); for (const s of [-1, 1]) { const side = new THREE.Vector3(-d.z, 0, d.x).multiplyScalar(s * 5); k.tube([p.x * 1.15 + side.x, 0, p.z * 1.15 + side.z], [p.x, p.y - 6, p.z], 0.9, SS2, { seg: 8 }); } }
  k.tube([low[0].x, 0, low[0].z], [low[0].x, low[0].y - 8, low[0].z], 2.4, SS2, { seg: 12 });
  k.rbox(16, 4, 10, 0.5, low[0].x, 0, low[0].z, '#c9cdd1');
  return k.done({ center: true });
}

// =====================================================================================================
// Moskau, Istanbul, Athen, Gizeh
// =====================================================================================================

// Basilius Kathedrale: Mittelturm mit Zeltdach, acht Türme mit bunten Zwiebeln (Spiralen, Zickzack, Rauten),
// Galerie mit Arkaden, Glockenturm. Ziegelrot mit weißem Schmuck
function basilius() {
  const k = new K(), BR = '#c8604a', BR2 = '#b45540', WH = '#efe8dc', GD = '#e0b85a';
  const R2 = '#d8604c', GN = '#6fae7c', BL = '#5f86c4', YE = '#e8c15c', WT = '#f3efe6';
  const spiral = (cx, cz, c1, c2, n = 6, tw = 0.5) => (x, y, z) => (Math.floor((Math.atan2(z - cz, x - cx) / TAU * n + y * tw) * 2) % 2 ? c1 : c2);
  const zig = (cx, cz, c1, c2) => (x, y, z) => (Math.floor(y * 1.1 + 0.6 * Math.abs(Math.sin(Math.atan2(z - cz, x - cx) * 6))) % 2 ? c1 : c2);
  const dia = (cx, cz, c1, c2) => (x, y, z) => ((Math.floor(Math.atan2(z - cz, x - cx) / TAU * 16 + y * 0.8) + Math.floor(Math.atan2(z - cz, x - cx) / TAU * 16 - y * 0.8)) % 2 ? c1 : c2);
  // Galerie (Unterbau) mit Arkaden
  k.rbox(46, 6, 46, 0.4, 0, 0, 0, BR2);
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => { for (let i = 0; i < 9; i++) k.plate([-18 + i * 4.5, 0, -23.05], [0, -1], archHole(0, 2.6, 0.5, 3.6, 5), '#6d4a40', { off: 0.03 }); k.box(46.4, 0.6, 0.6, 0, 5.6, -22.9, WH); });
  // Turm: Achteck, Tambour mit Kokoshniki, Zwiebel
  const tower = (x, z, r, h, rd, dh, cf, gold) => {
    k.cyl(r, r * 1.04, h - 6, x, 6, z, BR, { seg: 8, ry: PI / 8, flat: true });
    for (const y of [10, 14.5]) k.cyl(r * 1.06, r * 1.06, 0.5, x, y, z, WH, { seg: 8, ry: PI / 8, flat: true });
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8 + PI / 4; win(k, [x + Math.cos(a) * r * 0.93, 12, z + Math.sin(a) * r * 0.93], [Math.cos(a), Math.sin(a)], r * 0.35, 2.4, { kind: 'arch', col: '#4c3a33', lc: '#ffcf8a' }); }
    const yk = h;
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8 + PI / 4; k.plate([x + Math.cos(a) * r * 0.9, yk - 0.4, z + Math.sin(a) * r * 0.9], [Math.cos(a), Math.sin(a)], [[-r * 0.38, 0], [r * 0.38, 0], ...arc(0, 0, r * 0.38, 0, PI, 6).slice(1, -1), [-r * 0.38, 0.01]].map(([u, v]) => [u, v]), WH, { off: 0.1 }); }
    k.cyl(rd, rd * 1.05, 3.2, x, yk, z, BR2, { seg: 12 });
    k.cyl(rd * 1.08, rd * 1.08, 0.4, x, yk + 3.2, z, WH, { seg: 12 });
    k.lathe(domeProfile(rd * 1.02, dh, 'onion', 12), x, yk + 3.6, z, gold ? GD : cf, { seg: 20, flat: !!gold });
    k.cyl(0.18, 0.3, 1.8, x, yk + 3.6 + dh, z, GD, { seg: 6 });
    k.box(0.12, 1.6, 0.12, x, yk + 5.2 + dh, z, GD); k.box(0.9, 0.12, 0.12, x, yk + 6.2 + dh, z, GD);
  };
  // vier große Türme in den Hauptrichtungen, vier kleine in den Diagonalen
  tower(0, -16, 4.6, 22, 3.4, 7.5, spiral(0, -16, R2, GN));
  tower(16, 0, 4.6, 22, 3.4, 7.5, spiral(16, 0, BL, WT, 6, -0.5));
  tower(0, 16, 4.6, 22, 3.4, 7.5, zig(0, 16, YE, GN));
  tower(-16, 0, 4.6, 22, 3.4, 7.5, dia(-16, 0, R2, WT));
  tower(11, -11, 3.0, 18, 2.4, 5.6, spiral(11, -11, GN, YE, 5, 0.6));
  tower(11, 11, 3.0, 18, 2.4, 5.6, dia(11, 11, BL, YE));
  tower(-11, 11, 3.0, 18, 2.4, 5.6, spiral(-11, 11, R2, YE, 5, -0.6));
  tower(-11, -11, 3.0, 18, 2.4, 5.6, zig(-11, -11, GN, WT));
  // Mittelturm mit Zeltdach
  k.cyl(7.2, 7.6, 22, 0, 6, 0, BR, { seg: 8, ry: PI / 8, flat: true });
  for (let t = 0; t < 3; t++) for (let i = 0; i < 8; i++) { const a = i * TAU / 8 + PI / 4, r = 7.0 - t * 0.9; k.plate([Math.cos(a) * r, 28 + t * 1.8, Math.sin(a) * r], [Math.cos(a), Math.sin(a)], [[-2, 0], [2, 0], [0, 2.6]], WH, { off: 0.1 }); }
  k.cyl(0.8, 6.8, 16, 0, 28, 0, (x, y, z) => (Math.floor(y / 1.6) % 2 ? WH : '#e9dfcf'), { seg: 8, ry: PI / 8, flat: true });
  for (let i = 0; i < 8; i++) { const a = i * TAU / 8 + PI / 8; k.beam([Math.cos(a) * 6.9, 28, Math.sin(a) * 6.9], [Math.cos(a) * 0.9, 44, Math.sin(a) * 0.9], 0.35, '#3f6f5a'); }
  k.cyl(1.4, 1.4, 1.2, 0, 43.6, 0, BR2, { seg: 8 });
  k.lathe(domeProfile(1.5, 2.8, 'onion', 10), 0, 44.8, 0, GD, { seg: 12, flat: true });
  k.box(0.12, 1.4, 0.12, 0, 47.6, 0, GD); k.box(0.7, 0.12, 0.12, 0, 48.3, 0, GD);
  // Glockenturm
  k.rbox(7, 18, 7, 0.3, 26, 0, 16, BR);
  k.box(6, 4, 6, 26, 18, 16, WH);
  for (let f = 0; f < 4; f++) k.at(T(26, 0, 16, f * PI / 2), () => k.plate([0, 18.3, -3.05], [0, -1], archHole(0, 3.6, 0, 2.4, 5), '#4c3a33', { off: 0.03 }));
  k.cyl(0.6, 4.4, 9, 26, 22, 16, '#3f7a62', { seg: 8, flat: true });
  k.lathe(domeProfile(1.2, 2.4, 'onion', 8), 26, 31, 16, GD, { seg: 10, flat: true });
  return k.done({ center: true });
}

// Spasskaja Turm des Kreml, 71 m: Ziegelrot, Tor, Uhrengeschoss, Achteck, grünes Zeltdach, roter Stern (nachts leuchtend),
// Kremlmauer mit Schwalbenschwanz Zinnen
function spasskaja() {
  const k = new K(), BR = '#c4553f', BR2 = '#ad4935', WH = '#efe8dc', GN = '#5f9a84', GD = '#e0b85a';
  // Kremlmauer links und rechts
  for (const s of [-1, 1]) {
    k.box(14, 13, 6, s * 13.6, 0, 0, BR2);
    for (let i = 0; i < 4; i++) k.ext([[-1.1, 0], [1.1, 0], [1.1, 2.9], [0, 1.9], [-1.1, 2.9]], null, 1.0, BR, { x: s * (8.3 + i * 3.3), y: 13, z: -2.5 });
  }
  // Turm
  k.rbox(14, 27, 14, 0.3, 0, 0, 0, BR);
  for (const z of [-7.05, 7.05]) { k.plate([0, 0, z], [0, Math.sign(z)], archHole(0, 5, 0, 7, 8), '#3f2d28', { off: 0.03 }); k.plate([0, 0, z], [0, Math.sign(z)], archHole(0, 6.4, 0, 7, 8), WH, { off: 0.01 }); }
  for (const y of [10, 17, 24]) cornice(k, 0, 0, 14, 14, y, 0.5, 0.25, WH);
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => { for (const x of [-4.2, 4.2]) win(k, [x, 20.5, -7.05], [0, -1], 1.2, 2.6, { kind: 'arch', col: '#4a3a33', lit: false, frame: WH }); });
  cornice(k, 0, 0, 14, 14, 26.4, 0.8, 0.5, WH);
  for (const [dx, dz] of [[-6.6, -6.6], [6.6, -6.6], [-6.6, 6.6], [6.6, 6.6]]) { k.box(1.6, 4, 1.6, dx, 27.2, dz, WH); k.cone(1.0, 3.6, dx, 31.2, dz, GN, { seg: 8 }); k.ball(0.25, dx, 35, dz, GD, { ws: 6, hs: 4 }); }
  // Uhrengeschoss mit vier Zifferblättern
  k.rbox(11.4, 11.6, 11.4, 0.3, 0, 27.2, 0, BR);
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => {
    const cy = 33.2;
    k.plate([0, cy, -5.72], [0, -1], ngon(3.25, 24), GD, { off: 0.05 });
    k.plate([0, cy, -5.72], [0, -1], ngon(3.0, 24), '#23262b', { off: 0.1 });
    k.plate([0, cy, -5.72], [0, -1], ngon(2.9, 24), '#ffe7b0', { off: 0.22, glow: true });
    for (let i = 0; i < 12; i++) { const a = i * TAU / 12; k.box(0.22, 0.5, 0.06, Math.cos(a) * 2.5, cy + Math.sin(a) * 2.5 - 0.25, -5.88, GD); }
    k.beam([0, cy, -5.9], [0.9, cy + 1.6, -5.9], [0.18, 0.06], GD); k.beam([0, cy, -5.9], [-2.1, cy + 0.5, -5.9], [0.14, 0.06], GD);
    for (const x of [-5.2, 5.2]) { k.box(0.9, 3, 0.9, x, 38.8, -5.2, WH); k.cone(0.7, 2.8, x, 41.8, -5.2, GN, { seg: 8 }); }
  });
  cornice(k, 0, 0, 11.4, 11.4, 38.4, 0.6, 0.4, WH);
  // Achteck mit Bögen, Zeltdach mit Gauben, Spitze, Stern
  k.cyl(5.4, 5.6, 9.6, 0, 38.8, 0, BR, { seg: 8, ry: PI / 8, flat: true });
  for (let i = 0; i < 8; i++) { const a = i * TAU / 8; win(k, [Math.cos(a) * 5.15, 43.6, Math.sin(a) * 5.15], [Math.cos(a), Math.sin(a)], 1.8, 5.4, { kind: 'arch', col: '#3f2d28', lc: '#ffcf8a' }); k.box(0.5, 9.6, 0.5, Math.cos(a + PI / 8) * 5.5, 38.8, Math.sin(a + PI / 8) * 5.5, WH); }
  k.cyl(5.9, 5.9, 0.8, 0, 48.4, 0, WH, { seg: 8, ry: PI / 8, flat: true });
  k.cyl(0.5, 5.3, 15, 0, 49.2, 0, GN, { seg: 8, ry: PI / 8, flat: true });
  for (let i = 0; i < 8; i++) { const a = i * TAU / 8 + PI / 8, r = 3.6; k.box(0.8, 1.4, 0.8, Math.cos(a) * r, 54, Math.sin(a) * r, WH, { ry: -a }); }
  k.cyl(0.2, 0.4, 2.6, 0, 64, 0, GD, { seg: 6 });
  k.ball(0.45, 0, 66.6, 0, GD, { ws: 8, hs: 6 });
  const star = []; for (let i = 0; i < 10; i++) { const a = PI / 2 + i * TAU / 10, r = i % 2 ? 0.75 : 1.9; star.push([Math.cos(a) * r, Math.sin(a) * r]); }
  for (let f = 0; f < 2; f++) k.at(T(0, 69.1, 0, f * PI / 2), () => { k.ext(star, null, 0.5, '#9c2a22'); k.ext(star.map(([x, y]) => [x * 1.06, y * 1.06]), null, 0.35, '#ff3b2e', { glow: true }); });
  return k.done();
}

// Hagia Sophia: flache Hauptkuppel mit Fensterkranz auf Pendentifs, Halbkuppeln, Strebepfeiler, Narthex (vorn bei -x),
// vier Minarette mit Galerien und Bleispitzen
function hagia_sophia() {
  const k = new K(), W = '#dfae8f', W2 = '#cf9f80', LD = '#8f9aa5', MN = '#ece5d6';
  k.rbox(70, 24, 70, 0.4, 0, 0, 0, W);
  for (const [x, z] of [[-14, -38], [14, -38], [-14, 38], [14, 38]]) k.rbox(10, 36, 9, 0.3, x, 0, z, W2);
  for (const s of [-1, 1]) { k.ext([[-15.5, 0], [15.5, 0], ...arc(0, 0, 15.5, 0, PI, 12).slice(1, -1)], null, 2.4, W, { y: 24, z: s * 17.2 }); facade(k, [0, 24, s * 18.45], [0, s], 24, [6], 7, 1.4, 3.4, { kind: 'arch', col: '#5d646a', lc: C.lit }); }
  k.rbox(34, 14, 34, 0.3, 0, 24, 0, W);
  // Halbkuppeln nach Westen und Osten, kleine Exedren
  for (const s of [-1, 1]) {
    k.at(T(s * 15.5, 26, 0, s > 0 ? PI / 2 : -PI / 2), () => k.ball(15.5, 0, 0, 0, LD, { ws: 16, hs: 8, t0: 0, tl: PI / 2, sx: 1 }));
    for (const z of [-9, 9]) k.at(T(s * 27, 24, z, s > 0 ? PI / 2 : -PI / 2), () => k.ball(7.5, 0, 0, 0, LD, { ws: 10, hs: 5, t0: 0, tl: PI / 2 }));
  }
  // Hauptkuppel: Fensterkranz mit 40 Fenstern, flache Schale
  const yd = 38;
  k.cyl(16, 16.4, 5, 0, yd, 0, W, { seg: 40 });
  for (let i = 0; i < 40; i++) { const a = i * TAU / 40; k.box(1.2, 5, 1.6, Math.cos(a) * 16.4, yd, Math.sin(a) * 16.4, W2, { ry: -a }); win(k, [Math.cos(a + PI / 40) * 16.05, yd + 2.6, Math.sin(a + PI / 40) * 16.05], [Math.cos(a + PI / 40), Math.sin(a + PI / 40)], 1.0, 2.6, { kind: 'arch', col: '#4f565c', lc: C.lit }); }
  const prof = []; for (let i = 0; i <= 10; i++) { const a = i / 10 * PI / 2; prof.push([Math.cos(a) * 16.6, Math.sin(a) * 12.6]); }
  k.lathe(prof, 0, yd + 5, 0, LD, { seg: 40 });
  k.cyl(0.25, 0.4, 1.6, 0, yd + 17.4, 0, C.gold, { seg: 6 });
  // Narthex im Westen, Apsis im Osten
  k.rbox(12, 15, 62, 0.3, -41, 0, 0, W2);
  k.ext([[-6.4, 0], [6.4, 0], [0, 2.4]], null, 63, LD, { x: -41, y: 15 });
  facade(k, [-47, 0, 0], [-1, 0], 56, [4.5, 10.5], 9, 1.6, 3.6, { kind: 'arch', col: '#5d646a', lc: C.lit });
  k.cyl(9, 9, 20, 35, 0, 0, W, { seg: 12, t0: 0, tl: PI });
  k.ball(9, 35, 20, 0, LD, { ws: 12, hs: 4, t0: 0, tl: PI / 2 });
  // Minarette
  for (const [x, z] of [[-46, -34], [-46, 34], [40, -36], [40, 36]]) {
    k.box(6, 10, 6, x, 0, z, MN);
    k.cyl(2.0, 2.4, 44, x, 10, z, MN, { seg: 12 });
    for (const y of [28, 40, 50]) { k.cyl(3.2, 2.2, 1.2, x, y, z, MN, { seg: 12 }); for (let i = 0; i < 12; i++) { const a = i * TAU / 12; k.box(0.12, 1.0, 0.12, x + Math.cos(a) * 3.0, y + 1.2, z + Math.sin(a) * 3.0, '#bdb5a6'); } }
    k.cyl(0, 2.3, 7, x, 54, z, LD, { seg: 12 });
    k.cyl(0.08, 0.15, 2.4, x, 61, z, C.gold, { seg: 4 });
  }
  return k.done({ front: '-x', center: true });
}

// Parthenon als Ruine: dorische Säulen (8 x 17), Gebälk mit Lücken an den Langseiten, Giebel an beiden Enden, kein Dach,
// Reste der Cella, Fels als kleiner Sockel. Ostfront (Eingang) bei -x
function parthenon() {
  const k = new K(), M = '#ece0c9', M2 = '#e1d1b4', M3 = '#d4c2a2', RK = '#c9b9a0';
  k.ext([[-42, -22], [42, -21], [44, 20], [-40, 22]], null, 2, RK, { rx: -PI / 2, y: 1 });
  const y0 = 2;
  for (let i = 0; i < 3; i++) k.box(69.5 + (2 - i) * 1.4, 0.52, 30.9 + (2 - i) * 1.4, 0, y0 + i * 0.52, 0, i % 2 ? M2 : M3);
  const ys = y0 + 1.56, H = 10.4, R = 0.95;
  const shaft = [[R, 0], [R * 1.01, H * 0.35], [R * 0.9, H * 0.85], [R * 0.82, H - 1.15]];
  const col = (x, z, h = H) => {
    if (h < H) { k.lathe(shaft.map(([r, y]) => [r, y * h / H]), x, ys, z, M, { seg: 12 }); return; }
    k.lathe(shaft, x, ys, z, (px, py, pz) => (hash(Math.round(px * 3), Math.round(pz * 3)) < 0.3 ? M2 : M), { seg: 12 });
    k.cyl(1.25, 0.82, 0.65, x, ys + H - 1.15, z, M, { seg: 12 });
    k.box(2.5, 0.5, 2.5, x, ys + H - 0.5, z, M2);
  };
  const XS = [], ZS = [];
  for (let i = 0; i < 17; i++) XS.push(-32.4 + i * 64.8 / 16);
  for (let j = 0; j < 8; j++) ZS.push(-13.3 + j * 26.6 / 7);
  for (const x of XS) for (const z of [-13.3, 13.3]) { if (z > 0 && Math.abs(x) < 6) { col(x, z, 2 + hash(Math.round(x), 2) * 3); continue; } col(x, z); }
  for (const z of ZS.slice(1, -1)) for (const x of [-32.4, 32.4]) col(x, z);
  // Gebälk: an den Stirnseiten ganz, an den Langseiten mit Lücke
  const yE = ys + H;
  const ent = (x0, x1, z, full) => {
    const w = x1 - x0, cx = (x0 + x1) / 2;
    k.box(w, 1.35, 2.2, cx, yE, z, M2);
    if (!full) return;
    k.box(w, 1.35, 2.0, cx, yE + 1.35, z, M);
    for (let x = x0 + 0.4; x < x1 - 0.2; x += 2.03) k.box(0.62, 1.25, 0.15, x, yE + 1.4, z + Math.sign(z) * 1.05, M3);
    k.box(w + 0.4, 0.6, 2.6, cx, yE + 2.7, z, M2);
  };
  for (const z of [-13.3, 13.3]) { ent(-33.6, z > 0 ? -7.5 : -6, z, true); ent(z > 0 ? 7.5 : 6, 33.6, z, true); if (z < 0) ent(-6, 6, z, false); }
  for (const x of [-32.4, 32.4]) { k.box(2.2, 1.35, 28.8, x, yE, 0, M2); k.box(2.0, 1.35, 28.8, x, yE + 1.35, 0, M); k.box(2.6, 0.6, 31.4, x, yE + 2.7, 0, M2); }
  // Giebel (Rahmen mit Resten der Figuren)
  for (const s of [-1, 1]) {
    const x = s * 32.6;
    k.ext([[-15.6, 0], [15.6, 0], [0, 3.8]], [[[-13.6, 0.5], [13.6, 0.5], [0, 2.95]]], 2.2, M, { ry: PI / 2, x, y: yE + 3.3 });
    k.ext([[-13.6, 0.5], [13.6, 0.5], [0, 2.95]], null, 0.4, M3, { ry: PI / 2, x: x - s * 0.8, y: yE + 3.3 });
    if (s < 0) for (let i = 0; i < 7; i++) { const z = -9 + i * 3; k.rbox(1.0, 1.2 + (2.2 - Math.abs(z) / 6) * (hash(i, 3) * 0.6 + 0.4), 1.0, 0.3, x + 0.6, yE + 3.8, z, M2); }
  }
  // Cella: Westwand hoch, sonst Mauerstümpfe, Säulen der Westhalle
  k.box(1.6, 9, 19, 14, ys, 0, M2);
  for (const z of [-9.5, 9.5]) { k.box(44, 1.4, 1.3, -4, ys, z, M2); k.box(10, 6, 1.3, 20, ys, z, M2); }
  for (let j = 0; j < 6; j++) col(26.5, -8.5 + j * 3.4, j % 2 ? H : H * 0.7);
  return k.done({ front: '-x' });
}

// Pyramiden von Gizeh in echter Lage (x Osten, -z Norden, Mitte = Cheops): Cheops und Mykerinos gestuft, Chephren mit
// glatter Spitze aus Verkleidungssteinen, Königinnenpyramiden. Nicht drehen, die Lage ist nach Norden ausgerichtet
function pyramiden_gizeh() {
  const k = new K(), SA = '#d9c08f', SA2 = '#cfb380', CAP = '#ebdcb8';
  const stepped = (x, z, half, Horig, Hnow, stepH, capFrom = null) => {
    const rings = [], s = (y) => half * (1 - y / Horig);
    let y = 0;
    const yEnd = capFrom ?? Hnow;
    while (y < yEnd - 0.01) { const y1 = Math.min(yEnd, y + stepH); rings.push(rectRing(s(y), s(y), y), rectRing(s(y), s(y), y1)); y = y1; }
    rings.push(rectRing(s(yEnd), s(yEnd), yEnd));
    k.loft(rings.map(r => r.map(([a, b, c]) => [x + a, b, z + c])), SA, { flat: true, cfi: (i) => (Math.floor(i / 2) % 2 ? SA : SA2), capTop: capFrom == null, capCol: SA2 });
    if (capFrom != null) k.loft([rectRing(s(capFrom), s(capFrom), capFrom), rectRing(s(Hnow), s(Hnow), Hnow)].map(r => r.map(([a, b, c]) => [x + a, b, z + c])), CAP, { flat: true, capTop: true });
  };
  stepped(0, 0, 115.15, 146.6, 138.5, 4.2);
  stepped(-322, 340, 107.6, 143.5, 136.4, 4.2, 108);
  stepped(-589, 742, 51.6, 65.5, 61, 3.2);
  for (const [x, z, h, H] of [[150, -60, 22.5, 30], [150, 0, 22.5, 28], [150, 60, 22, 26], [-545, 838, 22, 22], [-589, 838, 15.5, 15], [-633, 838, 15.5, 14]]) stepped(x, z, h, H * 1.25, H, 3.0);
  return k.done();
}

// =====================================================================================================
// Asien und Naher Osten
// =====================================================================================================

// Y Grundriss mit drei Flügeln (Längen L[3] bis zur Spitzenmitte, halbe Breite h), gegen den Uhrzeigersinn
function yShape(L, h, a0 = PI / 2, nt = 6) {
  const pts = [], d = h / Math.sin(PI / 3);
  for (let w = 0; w < 3; w++) {
    const a = a0 + w * TAU / 3, ux = Math.cos(a), uz = Math.sin(a), px = -uz, pz = ux;
    const ap = a - PI / 3;
    pts.push([Math.cos(ap) * d, Math.sin(ap) * d]);
    const Lw = Math.max(L[w], d * 0.6);
    for (let i = 0; i <= nt; i++) { const b = -PI / 2 + i / nt * PI; pts.push([ux * Lw + (ux * Math.cos(b) + px * Math.sin(b)) * h, uz * Lw + (uz * Math.cos(b) + pz * Math.sin(b)) * h]); }
  }
  return pts;
}

// Burj Khalifa, 828 m: Y Grundriss mit 27 spiralförmigen Rücksprüngen, silbernes Glas, Spitze
function burj_khalifa() {
  const k = new K(), GL = '#b9c8d3', GL2 = '#a6b8c5', FN = '#e2e8ec';
  const NT = 27, top = 585;
  const f = (x) => Math.pow(Math.max(0, 1 - x / 26), 0.9);
  k.ext(yShape([58, 58, 58], 16, PI / 2).map(([x, z]) => [x, -z]), null, 8, '#d9dcdc', { rx: -PI / 2, y: 4 });
  for (let t = 0; t < NT; t++) {
    const y0 = t * top / NT, y1 = (t + 1) * top / NT;
    const L = [0, 1, 2].map(i => { const kq = t - ((t - i + 3) % 3); return 9 + 41 * f(Math.max(0, kq)); });
    const h = lerp(13.5, 8.5, t / NT);
    const sh = yShape(L, h, PI / 2);
    k.ext(sh.map(([x, z]) => [x, -z]), null, y1 - y0, t % 2 ? GL : GL2, { rx: -PI / 2, y: (y0 + y1) / 2 });
    k.ext(sh.map(([x, z]) => [x * 1.012, -z * 1.012]), null, 0.8, FN, { rx: -PI / 2, y: y1 - 0.4 });
    if (t % 2 === 0) k.ext(sh.map(([x, z]) => [x * 1.006, -z * 1.006]), null, (y1 - y0) * 0.4, '#fff0d4', { rx: -PI / 2, y: (y0 + y1) / 2, glow: true });
  }
  // Spitze
  const sp = [[585, 9], [620, 7.2], [660, 5.6], [700, 4.2], [740, 3.0], [775, 2.0], [800, 1.2], [828, 0.3]];
  for (let i = 0; i < sp.length - 1; i++) { const [ya, ra] = sp[i], [yb, rb] = sp[i + 1]; k.cyl(rb * 1.05, ra, yb - ya, 0, ya, 0, i % 2 ? FN : GL, { seg: 12 }); k.cyl(ra + 0.5, ra + 0.5, 1.0, 0, ya, 0, FN, { seg: 12 }); }
  for (const y of [828, 760, 700]) k.ball(0.7, 0, y, 0, C.litW, { ws: 6, hs: 4, glow: true });
  return k.done({ center: true });
}

// Taj Mahal: Marmorsockel mit vier Minaretten, Mausoleum mit gefasten Ecken, Iwane mit Spitzbögen, Zwiebelkuppel mit
// goldener Spitze, vier Chhatris. Hauptansicht von Süden bei -z
function taj_mahal() {
  const k = new K(), W = '#f6f3ec', W2 = '#e7e2d7', W3 = '#d8d2c4', INL = '#7a7468', AU = '#d9b25a';
  k.rbox(95, 6.7, 95, 0.3, 0, 0, 0, W2);
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => { for (let i = 0; i < 17; i++) k.plate([-40 + i * 5, 0, -47.55], [0, -1], archHole(0, 2.4, 1.2, 4.2, 4, 'pointed'), W3, { off: 0.03 }); });
  const y0 = 6.7;
  // Minarette
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const x = sx * 43, z = sz * 43;
    k.cyl(3.4, 3.6, 2, x, y0, z, W2, { seg: 12 });
    k.cyl(2.3, 3.1, 33, x, y0 + 2, z, W, { seg: 12 });
    for (const y of [12, 22, 32]) { k.cyl(3.8, 2.8, 1.2, x, y0 + y, z, W2, { seg: 12 }); for (let i = 0; i < 12; i++) { const a = i * TAU / 12; k.box(0.12, 0.9, 0.12, x + Math.cos(a) * 3.6, y0 + y + 1.2, z + Math.sin(a) * 3.6, W3); } }
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8; k.cyl(0.18, 0.18, 3.2, x + Math.cos(a) * 2.2, y0 + 35, z + Math.sin(a) * 2.2, W, { seg: 5 }); }
    k.cyl(2.8, 2.8, 0.5, x, y0 + 38.2, z, W2, { seg: 12 });
    k.lathe(domeProfile(2.4, 3.6, 'onion', 8), x, y0 + 38.7, z, W, { seg: 12 });
    k.cyl(0.08, 0.15, 1.4, x, y0 + 42.3, z, AU, { seg: 4 });
  }
  // Mausoleum: Achteck mit langen Seiten (57 m, Fase 13 m)
  const S = 28.5, Cf = 9.2;
  const oct = [[S, -S + Cf], [S, S - Cf], [S - Cf, S], [-S + Cf, S], [-S, S - Cf], [-S, -S + Cf], [-S + Cf, -S], [S - Cf, -S]];
  k.loft([oct.map(([x, z]) => [x, y0, z]), oct.map(([x, z]) => [x, y0 + 30, z])], W, { flat: true, capTop: true });
  k.loft([oct.map(([x, z]) => [x * 1.01, y0 + 30, z * 1.01]), oct.map(([x, z]) => [x * 1.01, y0 + 31.5, z * 1.01])], W2, { flat: true, capTop: true });
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => {
    // Pishtaq mit Iwan
    k.box(26, 34, 1.4, 0, y0, -S - 0.4, W);
    k.plate([0, y0, -S - 1.12], [0, -1], archHole(0, 17, 0, 19, 8, 'pointed'), W3, { off: 0 });
    k.plate([0, y0, -S - 1.12], [0, -1], archHole(0, 15.4, 0, 18.4, 8, 'pointed'), '#c9c2b2', { off: 0.05 });
    k.plate([0, y0, -S - 1.12], [0, -1], archHole(0, 5, 0, 7, 6, 'pointed'), '#5f5a52', { off: 0.1 });
    k.plate([0, y0, -S - 1.12], [0, -1], archHole(0, 4.4, 0.2, 7, 6, 'pointed'), C.lit, { off: 0.2, glow: true });
    for (const [x, y, w, h] of [[-13, 0, 0.35, 34], [12.65, 0, 0.35, 34], [0, 33.5, 26, 0.35], [0, 24.6, 17.6, 0.3]]) k.box(w, h, 0.12, x, y0 + y, -S - 1.12, INL);
    // seitliche Nischen in zwei Geschossen
    for (const x of [-20.5, 20.5]) for (const [y, h] of [[2, 11], [16, 11]]) { k.plate([x, y0 + y, -S - 0.02], [0, -1], archHole(0, 5.2, 0, h - 3.5, 6, 'pointed'), W3, { off: 0 }); k.plate([x, y0 + y, -S - 0.02], [0, -1], archHole(0, 4, 0.5, h - 3.5, 6, 'pointed'), '#c9c2b2', { off: 0.04 }); }
    // Fasenseite
    const a = PI / 4, cx = (S - Cf / 2) * 1.0, n = [Math.SQRT1_2, -Math.SQRT1_2];
    for (const [y, h] of [[2, 11], [16, 11]]) { k.plate([cx, y0 + y, -cx], n, archHole(0, 5.2, 0, h - 3.5, 6, 'pointed'), W3, { off: 0.02 }); k.plate([cx, y0 + y, -cx], n, archHole(0, 4, 0.5, h - 3.5, 6, 'pointed'), '#c9c2b2', { off: 0.06 }); }
    // Eckfialen
    k.cyl(0.9, 1.0, 36, S, y0, -S + Cf, W2, { seg: 8 }); k.lathe(domeProfile(1.0, 1.8, 'onion', 6), S, y0 + 36, -S + Cf, W, { seg: 8 });
    k.cyl(0.9, 1.0, 36, S - Cf, y0, -S, W2, { seg: 8 }); k.lathe(domeProfile(1.0, 1.8, 'onion', 6), S - Cf, y0 + 36, -S, W, { seg: 8 });
    // Chhatri
    k.at(T(15, 0, -15), () => {
      k.cyl(4.2, 4.2, 1, 0, y0 + 31.5, 0, W2, { seg: 8 });
      for (let i = 0; i < 8; i++) { const b = i * TAU / 8; k.cyl(0.3, 0.3, 5, Math.cos(b) * 3.4, y0 + 32.5, Math.sin(b) * 3.4, W, { seg: 5 }); }
      k.cyl(4.1, 4.1, 1, 0, y0 + 37.5, 0, W2, { seg: 8 });
      k.lathe(domeProfile(3.4, 5, 'onion', 8), 0, y0 + 38.5, 0, W, { seg: 12 });
      k.cyl(0.08, 0.2, 1.8, 0, y0 + 43.5, 0, AU, { seg: 4 });
    });
  });
  // Tambour und große Kuppel, Spitze
  k.cyl(13.6, 13.6, 7, 0, y0 + 31.5, 0, W, { seg: 32 });
  k.cyl(14.2, 14.2, 0.6, 0, y0 + 38.5, 0, W2, { seg: 32 });
  const dome = [[13.6, 0], [15.6, 2], [17.4, 6], [17.6, 8.5], [16.6, 12], [13.6, 15.5], [9.2, 18.8], [4.6, 21], [2.0, 22.2], [0.9, 22.6], [0, 22.7]];
  k.lathe(dome, 0, y0 + 39.1, 0, W, { seg: 36 });
  k.lathe([[1.6, 0], [0.9, 0.8], [1.2, 1.8], [0.5, 2.6], [0.8, 3.5], [0.35, 4.5], [0.5, 5.4], [0.15, 6.4], [0, 7.2]], 0, y0 + 61.4, 0, AU, { seg: 10 });
  return k.done();
}

// Gateway of India, Mumbai: gelber Basalt, großer Spitzbogen mit vier Ecktürmen, Seitenhallen mit Bögen und Jali Gittern.
// Seeseite bei -z
function gateway_of_india() {
  const k = new K(), B = '#d8c393', B2 = '#c9b281', B3 = '#b9a170';
  k.box(52, 1.2, 24, 0, 0, 0, '#cfc6b3');
  const y0 = 1.2;
  k.ext([[-12, 0], [12, 0], [12, 21], [-12, 21]], [archHole(0, 11, 0.01, 12, 10, 'pointed')], 18, B, { y: y0 });
  k.ext([[-9, 0], [9, 0], [9, 21], [-9, 21]], [archHole(0, 9, 0.01, 11, 8, 'pointed')], 24, B, { ry: PI / 2, y: y0 });
  for (const z of [-9.1, 9.1]) { k.ext([...archHole(0, 13.4, 0, 12, 10, 'pointed')], [archHole(0, 11, 0.01, 12, 10, 'pointed')], 0.4, B2, { y: y0, z }); k.box(24.4, 1.0, 0.8, 0, y0 + 20, z, B2); }
  for (let i = 0; i < 9; i++) k.box(1.6, 1.8, 1.6, -9.6 + i * 2.4, y0 + 21, -8.4, B2);
  for (let i = 0; i < 9; i++) k.box(1.6, 1.8, 1.6, -9.6 + i * 2.4, y0 + 21, 8.4, B2);
  k.box(22, 1.2, 16, 0, y0 + 21, 0, B3);
  k.lathe(domeProfile(6.5, 4.5, 'dome', 8), 0, y0 + 22.2, 0, B2, { seg: 20 });
  // Ecktürme
  for (const [x, z] of [[-12, -9], [12, -9], [-12, 9], [12, 9]]) {
    k.cyl(1.9, 2.1, 24.5, x, y0, z, B, { seg: 8, ry: PI / 8, flat: true });
    for (const y of [10, 17]) k.cyl(2.6, 2.0, 1.0, x, y0 + y, z, B2, { seg: 8, ry: PI / 8 });
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8; k.cyl(0.18, 0.18, 2.4, x + Math.cos(a) * 1.7, y0 + 22.8, z + Math.sin(a) * 1.7, B, { seg: 4 }); }
    k.lathe(domeProfile(2.0, 2.6, 'onion', 8), x, y0 + 25.2, z, B, { seg: 10 });
    k.cyl(0.06, 0.12, 1.2, x, y0 + 27.8, z, B3, { seg: 4 });
  }
  // Seitenhallen mit Bögen und Gittern
  for (const s of [-1, 1]) {
    const x = s * 18;
    k.ext([[-6, 0], [6, 0], [6, 13], [-6, 13]], [archHole(-2.8, 3.6, 0.01, 6.5, 6, 'pointed'), archHole(2.8, 3.6, 0.01, 6.5, 6, 'pointed')], 12, B, { x, y: y0 });
    for (const z of [-6.05, 6.05]) for (const dx of [-2.8, 2.8]) for (let i = 0; i < 5; i++) k.box(0.12, 4.8, 0.08, x + dx - 1.2 + i * 0.6, y0 + 3.8, z, B3);
    k.box(12.6, 1.0, 12.6, x, y0 + 13, 0, B2);
    for (let i = 0; i < 6; i++) { k.box(1.2, 1.4, 1.2, x - 5.4 + i * 2.16, y0 + 14, -5.9, B2); k.box(1.2, 1.4, 1.2, x - 5.4 + i * 2.16, y0 + 14, 5.9, B2); }
    k.cyl(1.2, 1.3, 3, x + s * 5.5, y0 + 14, -5.5, B, { seg: 8 }); k.lathe(domeProfile(1.3, 1.8, 'onion', 6), x + s * 5.5, y0 + 17, -5.5, B, { seg: 8 });
    k.cyl(1.2, 1.3, 3, x + s * 5.5, y0 + 14, 5.5, B, { seg: 8 }); k.lathe(domeProfile(1.3, 1.8, 'onion', 6), x + s * 5.5, y0 + 17, 5.5, B, { seg: 8 });
  }
  return k.done();
}

// Tor des Himmlischen Friedens (Tiananmen): rote Torburg mit fünf Bögen, weiße Marmorbrüstung, Torhalle mit roten Säulen,
// doppeltes Walm Giebel Dach mit gelben Ziegeln, rote Laternen
function tiananmen() {
  const k = new K(), RD = '#c4574a', RD2 = '#ad4a3e', YL = '#e7b54c', WM = '#ece8df', GB = '#3f6d6a';
  k.box(119, 1.6, 42, 0, 0, 0, WM);
  k.rbox(117, 11.6, 40, 0.5, 0, 1.6, 0, RD);
  for (const [x, w, h] of [[0, 8, 9], [-13, 6, 7.5], [13, 6, 7.5], [-25, 5, 6.5], [25, 5, 6.5]]) for (const z of [-20.05, 20.05]) k.plate([x, 1.6, z], [0, Math.sign(z)], archHole(0, w, 0, h - w / 2, 8), '#3d2b26', { off: 0.03 });
  k.box(118, 0.6, 41, 0, 13.2, 0, RD2);
  balustrade(k, 0, 0, 58.6, 20.1, 13.8, 1.3, 1.9, WM);
  // Torhalle: Säulen, Wände, Balken
  const y0 = 13.8, W = 62, D = 27;
  k.box(W - 4, 9, D - 4, 0, y0, 0, RD2);
  for (let i = 0; i <= 10; i++) for (const z of [-D / 2, D / 2]) k.cyl(0.55, 0.6, 8.6, -W / 2 + i * W / 10, y0, z, RD, { seg: 10 });
  for (let i = 1; i < 5; i++) for (const x of [-W / 2, W / 2]) k.cyl(0.55, 0.6, 8.6, x, y0, -D / 2 + i * D / 5, RD, { seg: 10 });
  for (const z of [-D / 2 + 2.05, D / 2 - 2.05]) for (let i = 0; i < 10; i++) { const x = -W / 2 + (i + 0.5) * W / 10; for (let j = 0; j < 6; j++) k.box(0.1, 5.4, 0.12, x - 1.6 + j * 0.64, y0 + 1.6, z + Math.sign(z) * 0.06, '#7a2f26'); k.panel([x, y0 + 4.3, z], [0, Math.sign(z)], 2.1, 2.7, '#ffcf8a', { off: -0.05, glow: true }); }
  k.box(W + 1.2, 1.2, D + 1.2, 0, y0 + 8.6, 0, GB);
  k.box(W + 0.4, 0.4, D + 0.4, 0, y0 + 9.8, 0, '#2f5a76');
  // Laternen
  for (let i = 0; i < 8; i++) { const x = -W / 2 + (i + 1) * W / 9; k.cyl(0.04, 0.04, 1.5, x, y0 + 6.9, -D / 2 - 0.2, '#3a2a22', { seg: 4 }); k.ball(1.0, x, y0 + 6.0, -D / 2 - 0.2, '#d8392c', { ws: 10, hs: 6, sy: 0.85 }); k.ball(1.05, x, y0 + 6.0, -D / 2 - 0.2, '#ff7a4a', { ws: 10, hs: 6, sy: 0.85, glow: true }); }
  // doppeltes Dach
  jroof(k, { w: W + 9, d: D + 9, y: y0 + 10.2, rise: 2.6, ridge: 0, lift: 0.9, c: YL, under: GB, fascia: '#b98a2e', wall: [W, D], th: 0.6, ns: 12, nt: 4, tEnd: 0.32, pow: 1.3 });
  k.box(W - 3, 3.2, D - 3, 0, y0 + 10.6, 0, RD2);
  k.box(W - 2.4, 0.8, D - 2.4, 0, y0 + 13.4, 0, GB);
  const top = jroof(k, { w: W + 6, d: D + 6, y: y0 + 14.2, rise: 6.6, ridge: W / 2 - 6, gable: 0.55, lift: 1.1, c: YL, under: GB, fascia: '#b98a2e', gableC: RD, wall: [W - 2.4, D - 2.4], th: 0.6, ns: 12, nt: 6, pow: 1.5 });
  ridgeCap(k, -(W / 2 - 7), W / 2 - 7, top + 0.2, 0.8, '#d9a53c', { ends: '#c8963a' });
  for (const s of [-1, 1]) { k.box(1.2, 2.6, 1.0, s * (W / 2 - 7), top + 0.2, 0, '#c8963a'); k.box(0.6, 1.2, 1.6, s * (W / 2 - 7.6), top + 2, 0, '#c8963a'); }
  return k.done();
}

// Oriental Pearl Tower, Shanghai, 468 m: drei Säulen, Stützen, große rosa Kugeln mit Fensterbändern, fünf kleine Kugeln,
// Raumkapsel, Antenne
function oriental_pearl() {
  const k = new K(), PK = '#d97a9c', PK2 = '#c96a8c', SV = '#cfd5dc', SV2 = '#b9c1c9';
  for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + PI / 2; k.cyl(4.3, 4.6, 295, Math.cos(a) * 7, 0, Math.sin(a) * 7, SV, { seg: 14 }); }
  for (let i = 0; i < 3; i++) { const a = i * TAU / 3 - PI / 2; k.tube([Math.cos(a) * 42, 0, Math.sin(a) * 42], [Math.cos(a) * 10, 66, Math.sin(a) * 10], 3.0, SV2, { seg: 10 }); k.rbox(10, 3, 10, 0.5, Math.cos(a) * 42, 0, Math.sin(a) * 42, '#d6d2ca'); }
  k.rbox(46, 8, 46, 0.6, 0, 0, 0, '#d6d2ca');
  const pearl = (y, r) => {
    k.ball(r, 0, y, 0, (x, yy, z) => (Math.abs(yy - y) < r * 0.08 ? SV : yy > y ? PK : PK2), { ws: 32, hs: 20 });
    for (const dy of [-r * 0.32, r * 0.18]) { const rr = Math.sqrt(r * r - dy * dy); k.cyl(rr * 1.01, rr * 1.01, r * 0.08, 0, y + dy, 0, '#4a4f5a', { seg: 32, open: true }); k.cyl(rr * 1.02, rr * 1.02, r * 0.06, 0, y + dy + r * 0.01, 0, '#ffd2e4', { seg: 32, open: true, glow: true }); }
    k.cyl(r * 1.005, r * 1.005, r * 0.1, 0, y - r * 0.05, 0, SV, { seg: 32, open: true });
  };
  pearl(93, 25);
  for (const y of [140, 162, 184, 206, 228]) { k.ball(6.4, 0, y, 0, PK, { ws: 14, hs: 10 }); k.cyl(6.5, 6.5, 0.8, 0, y - 0.4, 0, '#ffd2e4', { seg: 14, open: true, glow: true }); }
  pearl(272, 22.5);
  k.cyl(3.2, 3.6, 50, 0, 292, 0, SV, { seg: 12 });
  k.ball(7.5, 0, 350, 0, PK, { ws: 18, hs: 12 });
  k.cyl(7.6, 7.6, 1.2, 0, 349.4, 0, '#ffd2e4', { seg: 18, open: true, glow: true });
  const ant = [[357, 3.0], [390, 2.4], [420, 1.8], [445, 1.1], [468, 0.3]];
  for (let i = 0; i < ant.length - 1; i++) { k.cyl(ant[i + 1][1], ant[i][1], ant[i + 1][0] - ant[i][0], 0, ant[i][0], 0, SV, { seg: 10 }); k.cyl(ant[i][1] + 1.2, ant[i][1] + 1.2, 1.2, 0, ant[i][0], 0, SV2, { seg: 10 }); }
  k.ball(0.6, 0, 468, 0, C.litR, { ws: 6, hs: 4, glow: true });
  return k.done();
}

// Taipei 101, 508 m: Fuß als Pyramidenstumpf, acht Segmente zu je acht Geschossen (nach außen geneigt wie Bambus),
// gekerbte Ecken, Ruyi Scheiben, Spitze
function taipei_101() {
  const k = new K(), GL = '#86aea4', GL2 = '#7aa298', FR = '#d5e2de', AU = '#c9a85a';
  const ring = (h, y, c = 0.16) => { const q = h * c, o = []; for (const [x, z] of [[h, -h + q], [h, -h * 0.5], [h, h * 0.5], [h, h - q], [h - q, h], [h * 0.5, h], [-h * 0.5, h], [-h + q, h], [-h, h - q], [-h, h * 0.5], [-h, -h * 0.5], [-h, -h + q], [-h + q, -h], [-h * 0.5, -h], [h * 0.5, -h], [h - q, -h]]) o.push([x, y, z]); return o; };
  k.rbox(80, 6, 70, 0.5, 0, 0, 0, '#d4d0c8');
  k.loft([ring(26.5, 0), ring(23.5, 102)], GL, { flat: true });
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => { k.plate([0, 98, -23.7], [0, -1], ngon(4.6, 16), AU, { off: 0.15 }); k.plate([0, 98, -23.7], [0, -1], [[-1.4, -1.4], [1.4, -1.4], [1.4, 1.4], [-1.4, 1.4]], GL2, { off: 0.3 }); });
  const H = 36;
  for (let s2 = 0; s2 < 8; s2++) {
    const y0 = 102 + s2 * H;
    k.loft([ring(21.5, y0), ring(25.2, y0 + H)], s2 % 2 ? GL : GL2, { flat: true });
    k.loft([ring(25.4, y0 + H - 1.2), ring(25.4, y0 + H)], FR, { flat: true });
    k.loft([ring(25.6, y0 + H - 4), ring(25.6, y0 + H - 2)], '#e8fff4', { flat: true, glow: true });
    k.loft([ring(25.2, y0 + H), ring(21.5, y0 + H)], FR, { flat: true });
  }
  const yt = 102 + 8 * H;
  k.loft([ring(19, yt), ring(17, yt + 30)], GL, { flat: true, capTop: true });
  k.loft([ring(12, yt + 30), ring(10, yt + 46)], GL2, { flat: true, capTop: true });
  k.loft([ring(7, yt + 46), ring(6, yt + 58)], GL, { flat: true, capTop: true });
  k.cyl(1.2, 2.4, 60, 0, 448, 0, '#e3e8e6', { seg: 8 });
  for (const y of [460, 475, 490]) k.cyl(2.6, 2.6, 0.8, 0, y, 0, FR, { seg: 8 });
  k.ball(0.6, 0, 508, 0, C.litR, { ws: 6, hs: 4, glow: true });
  return k.done();
}

// N Seoul Tower, 236 m: weißer Schaft, Aussichtskanzel mit Fensterbändern, Antennenmast
function n_seoul_tower() {
  const k = new K(), W = '#eceae4', W2 = '#d8d6d0', GL = '#4f5b66';
  k.cyl(16, 17, 8, 0, 0, 0, '#e2ded6', { seg: 20 });
  k.lathe([[7.2, 8], [6.4, 40], [5.4, 90], [4.8, 132]], 0, 0, 0, W, { seg: 20 });
  for (let i = 0; i < 3; i++) { const a = i * TAU / 3; k.beam([Math.cos(a) * 7.4, 8, Math.sin(a) * 7.4], [Math.cos(a) * 5.2, 130, Math.sin(a) * 5.2], [1.4, 0.8], W2, { up: [0, 1, 0] }); }
  const pod = [[4.8, 129], [9, 132], [13.6, 135.5], [15.6, 139], [15.6, 152], [14.4, 154.5], [10.5, 156.5], [6, 157.5]];
  k.lathe(pod, 0, 0, 0, W, { seg: 32 });
  for (const [y0, y1] of [[140, 144], [146, 150.5]]) { k.cyl(15.75, 15.75, y1 - y0, 0, y0, 0, GL, { seg: 32, open: true }); k.cyl(15.9, 15.9, (y1 - y0) * 0.8, 0, y0 + (y1 - y0) * 0.1, 0, '#e6f0ff', { seg: 32, open: true, glow: true }); }
  k.cyl(3.2, 4.2, 30, 0, 157.5, 0, W2, { seg: 12 });
  const ant = [[187.5, 2.6], [205, 2.0], [220, 1.4], [236, 0.4]];
  for (let i = 0; i < ant.length - 1; i++) for (let j = 0; j < 4; j++) { const y0 = ant[i][0] + j * (ant[i + 1][0] - ant[i][0]) / 4, h = (ant[i + 1][0] - ant[i][0]) / 4; k.cyl(lerp(ant[i][1], ant[i + 1][1], (j + 1) / 4), lerp(ant[i][1], ant[i + 1][1], j / 4), h, 0, y0, 0, (i * 4 + j) % 2 ? '#f0eee8' : '#d4583f', { seg: 8 }); }
  for (const y of [170, 182]) k.cyl(4.6, 4.6, 0.8, 0, y, 0, W2, { seg: 12 });
  for (const y of [236, 200, 160]) for (let i = 0; i < (y > 230 ? 1 : 4); i++) { const a = i * PI / 2, r = y > 230 ? 0 : 4; k.ball(0.6, Math.cos(a) * r, y, Math.sin(a) * r, C.litR, { ws: 6, hs: 4, glow: true }); }
  return k.done();
}

// Wat Arun, Bangkok: zentraler Prang (79 m) im Khmer Stil mit gekerbten Ecken und Porzellanmosaik, vier kleine Prangs,
// Terrassen mit steilen Treppen, Dreizack an der Spitze
function wat_arun() {
  const k = new K(), CR = '#ece4d6', CR2 = '#ddd2bf', AC = ['#d9a3a0', '#9fbcd8', '#e8c98f', '#a9c9a0'];
  const redent = (h, y) => { const e = 0.13 * h, o = []; const q = [[h, -h + 2 * e], [h, h - 2 * e], [h - e, h - 2 * e], [h - e, h - e], [h - 2 * e, h - e]]; for (let f = 0; f < 4; f++) { const c = Math.cos(f * PI / 2), s2 = Math.sin(f * PI / 2); for (const [x, z] of q) o.push([x * c - z * s2, y, x * s2 + z * c]); } return o; };
  const prang = (cx, cz, y0, S) => {
    const prof = [[0, 13.5], [2.5, 14], [3.0, 13.2], [6, 13], [6.6, 14.2], [7.2, 12.6], [12, 12.3], [14, 11.6], [20, 10.4], [26, 9.0], [32, 7.3], [38, 5.5], [44, 3.8], [49, 2.4], [53, 1.5], [57, 0.9], [60, 0.45]];
    const rings = [];
    for (let i = 0; i < prof.length; i++) {
      const [y, h] = prof[i];
      rings.push(redent(h * S, y0 + y * S).map(([x, yy, z]) => [cx + x, yy, cz + z]));
      if (i > 2 && i < prof.length - 2) { const y2 = (y + prof[i + 1][0]) / 2, h2 = (h + prof[i + 1][1]) / 2 * 1.07; rings.push(redent(h2 * S, y0 + y2 * S).map(([x, yy, z]) => [cx + x, yy, cz + z])); }
    }
    k.loft(rings, CR, { flat: true, capTop: true, cfi: (i, j) => (i % 2 ? CR2 : hash(i * 7 + j, 3) < 0.25 ? AC[(i + j) % 4] : CR) });
    const yt = y0 + 60 * S;
    k.cyl(0.12 * S, 0.3 * S, 4 * S, cx, yt, cz, C.gold, { seg: 6 });
    for (const dx of [-0.9, 0, 0.9]) k.cone(0.18 * S, 1.6 * S, cx + dx * S, yt + 4 * S, cz, C.gold, { seg: 4 });
    k.box(2.0 * S, 0.2 * S, 0.2 * S, cx, yt + 4 * S, cz, C.gold);
  };
  // Terrassen mit Treppen
  const ter = [[30, 0, 2.5], [24, 2.5, 4.5], [18.5, 7, 4.5], [14.5, 11.5, 3.5]];
  for (const [h, y, th] of ter) { k.box(2 * h, th, 2 * h, 0, y, 0, CR2); balustrade(k, 0, 0, h - 0.4, h - 0.4, y + th, 1.0, 1.6, CR); for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => k.box(2 * h - 1, 0.3, 0.3, 0, y + th - 0.6, -h - 0.16, '#ffd28a', { glow: true })); }
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => { k.loft([[[2.2, 0, -31], [-2.2, 0, -31], [-2.2, 0, -14], [2.2, 0, -14]], [[2.2, 15, -15], [-2.2, 15, -15], [-2.2, 15, -14], [2.2, 15, -14]]], CR2, { flat: true, capTop: true }); for (const x of [-2.4, 2.4]) k.beam([x, 1, -31], [x, 15.8, -15], 0.5, CR); });
  prang(0, 0, 15, 1.06);
  for (const [x, z] of [[-21, -21], [21, -21], [-21, 21], [21, 21]]) prang(x, z, 7, 0.45);
  for (const [x, z] of [[0, -26], [26, 0], [0, 26], [-26, 0]]) { k.box(5, 5, 5, x, 2.5, z, CR); k.cyl(0, 3.4, 6, x, 7.5, z, '#c9a06a', { seg: 4, ry: PI / 4 }); }
  return k.done();
}

// Petronas Towers, 452 m: zwei Türme mit achtzackigem Stern im Grundriss, Stahlbänder, Rücksprünge, Spitzen,
// Skybridge auf 170 m mit Stützbock. Nachts silbern leuchtend
function petronas() {
  const k = new K(), SS = '#d7dce1', GL = '#8fa2b2', SS2 = '#bcc5cd';
  const star = (R, y) => { const o = [], pat = [1, 0.8, 0.88, 0.8]; for (let i = 0; i < 32; i++) { const a = i * TAU / 32, r = R * pat[i % 4]; o.push([Math.cos(a) * r, y, Math.sin(a) * r]); } return o; };
  for (const sx of [-1, 1]) {
    const X = sx * 52, at = (r) => r.map(([x, y, z]) => [X + x, y, z]);
    k.rbox(58, 8, 58, 0.5, X, 0, 0, '#d4d0c8');
    const tiers = [[0, 210, 24], [210, 252, 21], [252, 292, 18], [292, 330, 15], [330, 372, 11.5]];
    for (const [y0, y1, R] of tiers) {
      k.loft([at(star(R, y0)), at(star(R, y1))], GL, { flat: true });
      k.loft([at(star(R * 1.008, y0 + 0.5)), at(star(R * 1.008, y1 - 0.5))], '#f2f6ff', { flat: true, glow: true });
      for (let y = y0 + 2; y < y1 - 1; y += 4.3) k.loft([at(star(R * 1.03, y)), at(star(R * 1.03, y + 1.2))], SS, { flat: true });
      k.loft([at(star(R * 1.03, y1)), at(star(R * 0.6, y1 + 0.8))], SS2, { flat: true, capTop: true });
    }
    // Spitze: gestufte Kugeln, Nadel mit Ringen
    let y = 372.8;
    for (const [r, h] of [[8.5, 6], [6.5, 6], [5, 5], [3.6, 5], [2.6, 4]]) { k.cyl(r * 0.85, r, h, X, y, 0, SS, { seg: 16 }); k.ball(r * 0.9, X, y + h, 0, SS2, { ws: 12, hs: 4, t0: 0, tl: PI / 2, sy: 0.3 }); y += h; }
    k.cyl(0.2, 1.6, 451.9 - y, X, y, 0, SS, { seg: 8 });
    for (let i = 0; i < 6; i++) k.cyl(1.4 - i * 0.18, 1.4 - i * 0.18, 0.5, X, y + 4 + i * 6, 0, SS2, { seg: 8 });
    k.ball(0.5, X, 452, 0, C.litR, { ws: 6, hs: 4, glow: true });
  }
  // Skybridge mit Stützbock
  k.box(56, 6, 5, 0, 170, 0, SS);
  k.box(55, 2.6, 5.2, 0, 171.4, 0, '#f2f6ff', { glow: true });
  for (const s2 of [-1, 1]) { k.tube([s2 * 28, 135, 0], [s2 * 2, 169, 0], 0.9, SS2, { seg: 8 }); }
  return k.done();
}

// Marina Bay Sands, Singapur: drei Hoteltürme (je zwei Beine, eines geschwungen), Sky Park als Schiff obendrauf mit
// Bäumen und Pool, Auskragung nach Norden (+x)
function marina_bay_sands() {
  const k = new K(), W = '#e3e6e8', GL = '#9db2c0', GN = '#7fa86f', PL = '#6fb6d6';
  for (const X of [-100, 0, 100]) {
    // Westbein senkrecht, Ostbein geschwungen
    const legW = (y) => [[19, y, -35], [19, y, -13], [-19, y, -13], [-19, y, -35]].map(([x, yy, z]) => [X + x, yy, z]);
    const legE = (y) => { const t = y / 194, z0 = lerp(12, -9, Math.pow(t, 1.3)), z1 = lerp(35, 13, Math.pow(t, 1.3)); return [[19, y, z0], [19, y, z1], [-19, y, z1], [-19, y, z0]].map(([x, yy, z]) => [X + x, yy, z]); };
    k.loft([legW(0), legW(194)], GL, { flat: true });
    const ys = [0, 40, 80, 120, 160, 194];
    k.loft(ys.map(legE), GL, { flat: true });
    for (let y = 3; y < 192; y += 3.2) {
      k.panel([X, y, -35.05], [0, -1], 18.6, 0.35, W, { off: 0.05 });
      const t = y / 194, z1 = lerp(35, 13, Math.pow(t, 1.3));
      k.panel([X, y, z1 + 0.05], [0, 1], 18.6, 0.35, W, { off: 0.05 });
    }
    for (let y = 4.8; y < 190; y += 6.4) if (hash(X + 300, Math.round(y)) < 0.7) { k.panel([X, y, -35.05], [0, -1], 18, 1.1, C.lit, { off: 0.2, glow: true }); }
    k.box(38, 30, 22, X, 164, -2, GL);
    for (const x of [-19.1, 19.1]) k.box(0.4, 194, 22, X + x, 0, -24, W);
  }
  // Sky Park: Rumpf, Deck, Bäume, Pool
  const plan = []; for (let i = 0; i <= 20; i++) { const t = i / 20, x = lerp(-154, 186, t), w = 19 * Math.pow(Math.sin(PI * Math.min(1, t * 1.15)), 0.35) + 1; plan.push([x, w]); }
  const outline = [...plan.map(([x, w]) => [x, -w]), ...plan.slice().reverse().map(([x, w]) => [x, w])];
  k.ext(outline.map(([x, z]) => [x, -z]), null, 4, W, { rx: -PI / 2, y: 198 });
  k.loft([outline.map(([x, z]) => [x, 196, z]).reverse(), outline.map(([x, z]) => [x, 192.5, z * 0.7]).reverse()], '#d4d9dc', { flat: true, capTop: false });
  k.box(150, 0.6, 7, -10, 200, -12, PL);
  for (let i = 0; i < 26; i++) { const x = -140 + i * 12, z = 4 + 6 * hash(i, 2); if (Math.abs(z) < 16) k.ico(2.2, x, 202, z, GN, 0); }
  for (let i = 0; i < 30; i++) k.box(1.2, 0.4, 1.2, -150 + i * 11.5, 200.1, 16, C.litW, { glow: true });
  return k.done({ center: true });
}

// Sydney Opera House: Sockel aus Granit, zwei Gruppen von Schalen (Konzertsaal und Theater) mit Öffnung nach Norden (+x),
// Glaswände, kleines Restaurant mit zwei Schalen. Schalen in Weiß mit Fliesenmuster
function opernhaus_sydney() {
  const k = new K(), P = '#d8c3a8', T1 = '#f6f4ec', T2 = '#ece8dc', GLS = '#6d6458';
  k.rbox(184, 9, 110, 0.6, 0, 0, 0, P);
  for (let i = 0; i < 8; i++) k.box(1.6, 9 - i * 1.1, 70, -92 - i * 1.6, 0, 0, '#cbb59a');
  const yb = 9;
  const shell = (xm, zc, dir, H, Wd, L, mouth) => {
    const NT = 12, NS = 16, outer = [], inner = [];
    for (let i = 0; i <= NT; i++) {
      const t = i / NT, h = H * Math.sin(t * PI / 2), w = Wd * Math.pow(Math.sin(t * PI / 2), 0.7), x = xm - dir * L * (1 - t);
      const ro = [], ri = [];
      for (let j = 0; j <= NS; j++) { const s2 = -1 + 2 * j / NS, y = h * Math.pow(1 - Math.abs(s2), 0.6); ro.push([x, yb + y, zc + w * s2]); ri.push([x - dir * 0.6, yb + y * 0.95, zc + w * s2 * 0.96]); }
      outer.push(ro); inner.push(ri);
    }
    const sgn = dir > 0;
    k.loft(outer, T1, { open: true, inv: sgn, smooth: true, cfi: (i, j) => (j % 2 ? T1 : T2) });
    k.loft(inner, '#efeadc', { open: true, inv: !sgn, smooth: true });
    k.loft([outer[NT], inner[NT]], T2, { open: true });
    if (mouth) {
      const m = inner[NT];
      for (let j = 0; j < NS; j++) { k.face([[m[j][0] - dir * 1.2, yb, zc], m[j], m[j + 1]].map(p => [p[0] - dir * 0.8, p[1], p[2]]), GLS, [dir, 0, 0]); k.face([[m[j][0] - dir * 1.2, yb, zc], m[j], m[j + 1]].map(p => [p[0] - dir * 0.6, p[1] * 0.98 + yb * 0.02, (p[2] - zc) * 0.97 + zc]), '#ffd9a0', [dir, 0, 0], { glow: true }); }
    }
  };
  // Konzertsaal (Westen, -z) und Theater (Osten, +z)
  for (const [zc, f] of [[-24, 1], [26, 0.86]]) {
    shell(48, zc, 1, 58 * f, 25 * f, 36 * f, true);
    shell(20, zc, 1, 50 * f, 22 * f, 32 * f, false);
    shell(-6, zc, 1, 40 * f, 18 * f, 26 * f, false);
    shell(-40, zc, -1, 24 * f, 15 * f, 20 * f, false);
  }
  // Bennelong Restaurant
  shell(-58, -40, 1, 18, 9, 14, true);
  shell(-72, -40, -1, 13, 7, 10, false);
  return k.done();
}

// Sydney Harbour Bridge: stählerner Bogen 503 m (Scheitel 134 m), vier Granitpylone, Fahrbahn auf rund 50 m
function harbour_bridge() {
  const k = new K(), ST = '#98a3ad', ST2 = '#86919b', GR = '#cbbca3', S = 251.5, yD = 50;
  const yt = (x) => 134 - 65 * (x / S) ** 2, yb = (x) => 116 - 104 * (x / S) ** 2;
  const N = 28, xs = []; for (let i = 0; i <= N; i++) xs.push(-S + i * 2 * S / N);
  for (const z of [-15, 15]) {
    for (let i = 0; i < N; i++) {
      const a = xs[i], b = xs[i + 1];
      k.beam([a, yt(a), z], [b, yt(b), z], [2.4, 3.2], ST); k.beam([a, yb(a), z], [b, yb(b), z], [2.6, 3.6], ST);
      k.beam([a, yt(a) + 1.8, z], [b, yt(b) + 1.8, z], 0.5, '#fff2d0', { glow: true });
      const outer = Math.abs(a) > Math.abs(b) ? a : b, inner = outer === a ? b : a;
      k.beam([outer, yt(outer), z], [inner, yb(inner), z], 1.2, ST2);
    }
    for (const x of xs) k.beam([x, yt(x), z], [x, yb(x), z], 1.4, ST2);
  }
  for (let i = 0; i <= N; i++) { const x = xs[i]; k.beam([x, yt(x), -15], [x, yt(x), 15], 1.0, ST2); k.beam([x, yb(x), -15], [x, yb(x), 15], 1.0, ST2); if (i < N) { const x2 = xs[i + 1]; k.beam([x, yt(x), -15], [x2, yt(x2), 15], 0.6, ST2); k.beam([x, yb(x), 15], [x2, yb(x2), -15], 0.6, ST2); } }
  // Fahrbahn, Hänger und Pfosten
  k.box(2 * S + 170, 2.2, 49, 0, yD - 2.2, 0, ST2);
  k.box(2 * S + 170, 0.4, 47, 0, yD, 0, '#7d858c');
  for (const z of [-24.5, 24.5]) { k.box(2 * S + 170, 1.2, 0.5, 0, yD, z, ST); for (let x = -S - 80; x <= S + 80; x += 30) k.box(0.5, 0.5, 0.5, x, yD + 3, z, C.litW, { glow: true }); }
  for (const x of xs) for (const z of [-15, 15]) { const y = yb(x); if (y > yD + 1) k.beam([x, y, z], [x, yD, z], 0.6, ST2); else if (y < yD - 2.2) k.beam([x, y, z], [x, yD - 2.2, z], 1.4, ST2); }
  // Pylone und Vorlandbrücken
  for (const s of [-1, 1]) {
    for (const z of [-30, 30]) {
      k.rbox(24, 82, 16, 0.4, s * (S + 18), 0, z, GR);
      k.rbox(26, 3, 18, 0.4, s * (S + 18), 82, z, shade(GR, 0.94));
      k.rbox(16, 5, 10, 0.4, s * (S + 18), 85, z, GR);
      k.plate([s * (S + 18) - s * 12, 40, z], [-s, 0], archHole(0, 6, 0, 8, 6), '#6e665a', { off: 0.05 });
    }
    k.box(24, 10, 44, s * (S + 18), 0, 0, GR);
    for (let x = S + 45; x <= S + 85; x += 40) { k.rbox(10, yD - 2.2, 34, 0.4, s * x, 0, 0, GR); }
  }
  k.ball(1.0, 0, 135.5, 0, C.litR, { ws: 6, hs: 4, glow: true });
  return k.done();
}

// Cristo Redentor: 30 m Statue mit ausgebreiteten Armen (28 m) auf 8 m Sockel, Speckstein, kleiner Fels
function cristo_redentor() {
  const k = new K(), SP = '#e7e4d9', SP2 = '#d9d5c8', RK = '#9aa38f';
  k.ext([[-9, -7], [8, -8], [10, 4], [2, 9], [-8, 7]], null, 2, RK, { rx: -PI / 2, y: 1 });
  k.rbox(10, 2, 10, 0.3, 0, 2, 0, SP2);
  k.rbox(8.4, 6, 8.4, 0.3, 0, 4, 0, SP);
  cornice(k, 0, 0, 8.4, 8.4, 9.4, 0.6, 0.3, SP2);
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => { k.plate([0, 4, -4.25], [0, -1], archHole(0, 1.6, 0, 1.8, 4), '#6f6a60', { off: 0.03 }); k.box(0.5, 0.5, 0.5, 3.6, 10.2, -4.4, C.litW, { glow: true }); });
  const y0 = 10;
  const prof = [[y0, 3.0, 2.5], [y0 + 4, 2.6, 2.1], [y0 + 12, 2.35, 1.8], [y0 + 18, 2.6, 1.75], [y0 + 21.5, 2.85, 1.8], [y0 + 23, 2.4, 1.6], [y0 + 23.8, 1.0, 1.0], [y0 + 24.4, 0.9, 0.9]];
  k.loft(prof.map(([y, rx, rz]) => circRing(1, y, 24).map(([x, , z], j) => { const f = 1 + (y < y0 + 20 ? 0.05 * Math.sin(j * TAU / 24 * 7) : 0); return [x * rx * f, y, z * rz * f]; })), SP, { smooth: true, capBot: true });
  k.ball(1, 0, y0 + 26.0, -0.15, SP, { ws: 12, hs: 8, sx: 1.4, sy: 1.85, sz: 1.5 });
  k.ball(1, 0, y0 + 26.6, 0.15, SP2, { ws: 10, hs: 6, sx: 1.45, sy: 1.6, sz: 1.5 });
  for (const s of [-1, 1]) {
    k.tube([s * 1.6, y0 + 22.6, 0], [s * 14, y0 + 22.9, -0.2], 1.15, SP, { seg: 8, r2: 0.65 });
    k.ext([[s * 1.8, y0 + 13.5], [s * 10.5, y0 + 21.8], [s * 1.8, y0 + 23.2]].map(([x, y]) => [x, y]), null, 1.4, SP2, { z: 0.1 });
    k.rbox(1.0, 1.6, 0.6, 0.2, s * 14.4, y0 + 22.1, -0.3, SP);
  }
  return k.done();
}

// CN Tower, 553 m: Y förmiger Betonschaft, Hauptkanzel mit Glasbändern, SkyPod, Antenne. Nachts Lichtstreifen am Schaft
function cn_tower() {
  const k = new K(), CO = '#d9d6cf', CO2 = '#c9c5bd', GL = '#4b5763';
  const rings = []; for (let i = 0; i <= 11; i++) { const y = i * 30.5, L = 8 + 27 * Math.pow(1 - y / 345, 1.4); rings.push(yShape([L, L, L], lerp(5.5, 4.4, y / 335), PI / 2, 4).map(([x, z]) => [x, y, z])); }
  k.loft(rings, CO, { flat: true });
  for (let w = 0; w < 3; w++) { const a = PI / 2 + w * TAU / 3; k.path(rings.map((r, i) => { const y = i * 30.5, L = 8 + 27 * Math.pow(1 - y / 345, 1.4) + 4.6; return [Math.cos(a) * L, y, Math.sin(a) * L]; }), 0.35, '#f2f6ff', { glow: true, square: true }); }
  k.ext(yShape([40, 40, 40], 7, PI / 2, 4).map(([x, z]) => [x, -z]), null, 6, '#d2cec6', { rx: -PI / 2, y: 3 });
  const pod = [[7, 322], [12, 328], [18, 334], [21, 338.5], [21.6, 343], [19, 345.5], [19.6, 351], [21.2, 355], [18.5, 359.5], [12.5, 363.5], [7.5, 366]];
  k.lathe(pod, 0, 0, 0, CO2, { seg: 32 });
  for (const [y0, y1, r] of [[339.5, 342.5, 21.65], [351.5, 354.5, 21.25]]) { k.cyl(r, r, y1 - y0, 0, y0, 0, GL, { seg: 32, open: true }); k.cyl(r + 0.15, r + 0.15, (y1 - y0) * 0.8, 0, y0 + (y1 - y0) * 0.1, 0, C.lit, { seg: 32, open: true, glow: true }); }
  k.cyl(5.2, 5.8, 80, 0, 366, 0, CO, { seg: 6, flat: true });
  k.lathe([[5.4, 442], [8.6, 445], [8.9, 449.5], [7.2, 452.5], [5.0, 454.5]], 0, 0, 0, CO2, { seg: 20 });
  k.cyl(9.0, 9.0, 2.6, 0, 446, 0, GL, { seg: 20, open: true }); k.cyl(9.1, 9.1, 2.0, 0, 446.3, 0, C.lit, { seg: 20, open: true, glow: true });
  const ant = [[454.5, 3.6], [480, 3.0], [505, 2.3], [530, 1.5], [553, 0.5]];
  for (let i = 0; i < ant.length - 1; i++) { k.cyl(ant[i + 1][1], ant[i][1], ant[i + 1][0] - ant[i][0], 0, ant[i][0], 0, i % 2 ? '#e8e6e2' : '#cfd3d6', { seg: 10 }); k.cyl(ant[i][1] + 0.8, ant[i][1] + 0.8, 1, 0, ant[i][0], 0, CO2, { seg: 10 }); }
  for (const y of [553, 520, 490]) k.ball(0.7, 0, y, 0, C.litR, { ws: 6, hs: 4, glow: true });
  return k.done();
}

// Golden Gate Bridge: Hauptspannweite 1280 m, Türme 227 m in International Orange mit Art Deco Riegeln, Fahrbahn auf 67 m,
// Versteifungsfachwerk, Tragseile, Verankerungen
function golden_gate() {
  const k = new K(), OR = '#d0583f', OR2 = '#b84b35', CB = '#c45038', XT = 640, XA = 983, yD = 67, Z = 13.7;
  // Fahrbahn und Fachwerk
  k.box(2 * XA, 0.8, 2 * Z, 0, yD, 0, '#8a8580');
  for (const z of [-Z, Z]) {
    k.beam([-XA, yD, z], [XA, yD, z], [0.9, 1.4], OR); k.beam([-XA, yD - 7.6, z], [XA, yD - 7.6, z], [0.9, 1.2], OR);
    for (let x = -XA; x < XA - 1; x += 15.2) { k.beam([x, yD - 7.6, z], [x, yD, z], 0.6, OR2); k.beam([x, yD - 7.6, z], [x + 15.2, yD, z], 0.5, OR2); }
    for (let x = -XA + 25; x < XA; x += 50) { k.box(0.3, 4, 0.3, x, yD + 0.8, z * 0.95, '#8a8f94'); k.box(0.7, 0.4, 0.7, x, yD + 4.6, z * 0.95, '#ffd28a', { glow: true }); }
  }
  for (let x = -XA; x < XA; x += 30.4) k.beam([x, yD - 7.6, -Z], [x + 15.2, yD - 7.6, Z], 0.4, OR2);
  // Türme
  for (const s of [-1, 1]) {
    const x = s * XT;
    k.rbox(40, 12, 60, 1.0, x, 0, 0, '#cbc5ba');
    for (const zs of [-1, 1]) {
      const z = zs * 16.5;
      const st = [[0, 8.5, 5.5], [67, 7.6, 4.9], [105, 6.9, 4.4], [145, 6.2, 4.0], [185, 5.5, 3.6], [227, 5.0, 3.3]];
      for (let i = 0; i < st.length - 1; i++) {
        const [y0, a0, b0] = st[i], [y1, a1, b1] = st[i + 1];
        k.loft([rectRing(a0, b0, y0 + 12 * (i === 0)), rectRing(a1 * 1.0, b1, y1)].map(r => r.map(([u, v, w]) => [x + u, v, z + w])), OR, { flat: true, capTop: i === st.length - 2 });
        for (const u of [-a1 * 0.45, a1 * 0.45]) for (const sxz of [-1, 1]) k.box(1.0, y1 - y0 - 1, 0.3, x + u, y0 + 0.5 + 12 * (i === 0), z + sxz * (b1 + 0.15), OR2);
      }
      k.ball(0.9, x, 228, z, C.litR, { ws: 6, hs: 4, glow: true });
    }
    // Riegel oberhalb der Fahrbahn mit senkrechten Rippen, Kreuzverband darunter
    for (const [y, h] of [[96, 9], [136, 9], [176, 9], [214, 13]]) { k.box(9, h, 26, x, y, 0, OR); for (let i = 0; i < 7; i++) for (const sxz of [-1, 1]) k.box(0.4, h - 1.6, 1.2, x + sxz * 4.6, y + 0.8, -10.5 + i * 3.5, OR2); }
    for (const [ya, yb] of [[15, 38], [38, 61]]) { k.beam([x, ya, -13], [x, yb, 13], 1.6, OR); k.beam([x, ya, 13], [x, yb, -13], 1.6, OR); }
    k.box(10, 4, 30, x, 61, 0, OR);
  }
  // Tragseile und Hänger
  for (const zs of [-1, 1]) {
    const z = zs * 16.5;
    const main = curve(t => { const x = lerp(-XT, XT, t); return [x, 70 + 154 * (x / XT) ** 2, z]; }, 64);
    k.path(main, 1.0, CB, { seg: 6 });
    for (let i = 1; i < 64; i++) if (i % 1 === 0) k.beam([main[i][0], main[i][1], z], [main[i][0], yD + 0.6, zs * Z], 0.25, OR2);
    for (const s of [-1, 1]) {
      const side = curve(t => { const x = s * lerp(XT, XA, t); return [x, lerp(224, 75, t) - 30 * Math.sin(PI * t), z]; }, 20);
      k.path(side, 1.0, CB, { seg: 6 });
      for (let i = 1; i < 20; i++) if (side[i][1] > yD + 2) k.beam(side[i], [side[i][0], yD + 0.6, zs * Z], 0.25, OR2);
    }
  }
  for (const s of [-1, 1]) { k.rbox(46, 76, 56, 1.0, s * (XA + 18), 0, 0, '#d2ccc1'); }
  return k.done();
}

// Space Needle, Seattle, 184 m: drei Beinpaare mit schmaler Taille, Kern mit Aufzügen, Ring auf 30 m, Kanzel mit Halo,
// Dach und Spitze
function space_needle() {
  const k = new K(), W = '#f1efea', W2 = '#d9d6cf', GL = '#4f5b66', AU = '#e6b45e';
  k.cyl(22, 23, 1.5, 0, 0, 0, '#d8d3c8', { seg: 24 });
  k.cyl(3.2, 3.4, 156, 0, 0, 0, W2, { seg: 12 });
  const leg = [[0, 19.5], [25, 14], [55, 9], [85, 5.6], [108, 4.4], [126, 5.6], [140, 8.5], [150, 12]];
  for (let p = 0; p < 3; p++) {
    const a = PI / 2 + p * TAU / 3;
    for (const off of [-3.0, 3.0]) {
      const pts = leg.map(([y, r]) => [Math.cos(a) * r - Math.sin(a) * off * (r / 19.5 * 0.6 + 0.4), y, Math.sin(a) * r + Math.cos(a) * off * (r / 19.5 * 0.6 + 0.4)]);
      k.path(pts, 0.85, W, { seg: 8 });
    }
    for (let i = 1; i < leg.length; i++) { const [y, r] = leg[i], sc = r / 19.5 * 0.6 + 0.4; k.beam([Math.cos(a) * r - Math.sin(a) * 3 * sc, y, Math.sin(a) * r + Math.cos(a) * 3 * sc], [Math.cos(a) * r + Math.sin(a) * 3 * sc, y, Math.sin(a) * r - Math.cos(a) * 3 * sc], 0.5, W); k.beam([Math.cos(a) * r, y, Math.sin(a) * r], [Math.cos(a) * 3.3, y, Math.sin(a) * 3.3], 0.45, W2); }
    k.box(1.6, 3, 1.4, Math.cos(a) * 3.9, 60 + p * 30, Math.sin(a) * 3.9, AU, { ry: -a });
  }
  k.cyl(14, 14.5, 2.4, 0, 28, 0, W, { seg: 24 });
  k.cyl(14.6, 14.6, 1.2, 0, 28.6, 0, C.lit, { seg: 24, open: true, glow: true });
  // Kanzel mit Halo
  k.lathe([[7, 147], [15, 149.5], [19.5, 151.8], [21, 154], [21, 158.6], [19.5, 159.8], [16.5, 161], [12.5, 162.8]], 0, 0, 0, W, { seg: 36 });
  for (const [y0, y1] of [[152.4, 154.2], [155.2, 158.2]]) { k.cyl(21.15, 21.15, y1 - y0, 0, y0, 0, GL, { seg: 36, open: true }); k.cyl(21.3, 21.3, (y1 - y0) * 0.8, 0, y0 + (y1 - y0) * 0.1, 0, C.lit, { seg: 36, open: true, glow: true }); }
  k.cyl(24, 24, 0.8, 0, 159.2, 0, W, { seg: 36 });
  for (let i = 0; i < 24; i++) { const a = i * TAU / 24; k.beam([Math.cos(a) * 20.8, 159.4, Math.sin(a) * 20.8], [Math.cos(a) * 24, 159.6, Math.sin(a) * 24], 0.4, W); }
  k.cone(12.6, 6.5, 0, 162.8, 0, W, { seg: 24 });
  k.cyl(0.4, 1.2, 15, 0, 169, 0, '#e8e6e2', { seg: 8 });
  k.ball(0.7, 0, 184, 0, C.litW, { ws: 6, hs: 4, glow: true });
  return k.done();
}

// Koutoubia Minarett, Marrakesch, 77 m: rötlicher Sandstein, Blendbögen und Sebka Netz je Seite, Band aus türkisen
// Fliesen, Stufenzinnen, Laterne mit Rippenkuppel, Jamur mit drei goldenen Kugeln
function koutoubia() {
  const k = new K(), SA = '#d49c76', SA2 = '#c38c66', SA3 = '#b07c58', TQ = '#5fb1a4', WH = '#f1ebe0', AU = '#e2b955';
  k.box(15, 1.0, 15, 0, 0, 0, '#c9b59c');
  k.rbox(12.8, 62.5, 12.8, 0.15, 0, 1.0, 0, SA);
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => {
    const z = -6.42, v = f % 2;
    // Rahmenleisten
    k.box(11.2, 0.4, 0.2, 0, 14, z, SA2); k.box(11.2, 0.4, 0.2, 0, 50.5, z, SA2);
    // Fenster mit Vielpassbögen übereinander
    for (const [y, w, h] of [[8, 1.0, 2.6], [20, 1.4, 3.4], [29, 1.6, 4.0], [39, 1.6, 4.0]]) {
      const x = v ? -2.6 : 0;
      k.plate([x, y, z], [0, -1], archHole(0, w + 1.4, 0, h - 0.4, 6), SA2, { off: 0.04 });
      k.plate([x, y, z], [0, -1], archHole(0, w, 0.2, h - 0.6, 6), '#4a3428', { off: 0.08 });
      if (v) { k.plate([2.6, y, z], [0, -1], archHole(0, w + 1.4, 0, h - 0.4, 6), SA2, { off: 0.04 }); k.plate([2.6, y, z], [0, -1], archHole(0, w, 0.2, h - 0.6, 6), '#4a3428', { off: 0.08 }); }
    }
    // Sebka Netz in einer Blendnische
    k.panel([0, 47, z], [0, -1], 4.6, 3.2, SA3, { off: 0.03 });
    for (let i = -3; i <= 3; i++) { k.beam([i * 1.4 - 2.2, 43.9, z - 0.1], [i * 1.4 + 2.2, 50.1, z - 0.1], 0.18, SA2); k.beam([i * 1.4 + 2.2, 43.9, z - 0.1], [i * 1.4 - 2.2, 50.1, z - 0.1], 0.18, SA2); }
    // türkises Fliesenband mit weißem Flechtwerk
    k.box(12.9, 2.4, 0.18, 0, 56.2, z - 0.02, TQ);
    for (let i = 0; i < 9; i++) k.box(0.6, 0.6, 0.06, -5.2 + i * 1.3, 57.1, z - 0.13, WH, { ry: PI / 4 });
    // Stufenzinnen
    for (let i = 0; i < 6; i++) { const x = -5.4 + i * 2.16; k.box(1.5, 0.8, 1.0, x, 63.5, z + 0.5, SA); k.box(1.0, 0.7, 0.8, x, 64.3, z + 0.5, SA); k.box(0.5, 0.6, 0.6, x, 65.0, z + 0.5, SA); }
  });
  k.box(13.2, 0.8, 13.2, 0, 62.7, 0, SA2);
  // Laterne
  k.rbox(6.2, 8.5, 6.2, 0.12, 0, 63.5, 0, SA);
  for (let f = 0; f < 4; f++) k.at(T(0, 0, 0, f * PI / 2), () => {
    k.plate([0, 64.8, -3.12], [0, -1], archHole(0, 1.8, 0, 3.0, 6), SA2, { off: 0.04 });
    k.plate([0, 64.8, -3.12], [0, -1], archHole(0, 1.2, 0.2, 2.8, 6), '#4a3428', { off: 0.08 });
    k.plate([0, 64.8, -3.12], [0, -1], archHole(0, 1.0, 0.3, 2.8, 6), C.lit, { off: 0.18, glow: true });
    k.box(6.3, 1.0, 0.16, 0, 69.4, -3.12, TQ);
    for (let i = 0; i < 3; i++) { const x = -2.0 + i * 2.0; k.box(1.0, 0.5, 0.7, x, 72, -2.75, SA); k.box(0.5, 0.45, 0.5, x, 72.5, -2.75, SA); }
  });
  k.box(6.4, 0.5, 6.4, 0, 71.9, 0, SA2);
  // Rippenkuppel und Jamur
  k.lathe(domeProfile(2.6, 1.8, 'dome', 6), 0, 72.2, 0, (x, y, z) => (Math.floor((Math.atan2(z, x) + PI) / TAU * 16) % 2 ? '#6aa596' : '#5c9688'), { seg: 16, flat: true });
  k.cyl(0.07, 0.09, 3.0, 0, 74, 0, AU, { seg: 5 });
  for (const [y, r] of [[74.7, 0.62], [75.75, 0.5], [76.55, 0.36]]) k.ball(r, 0, y, 0, AU, { ws: 10, hs: 8 });
  k.cone(0.12, 0.4, 0, 76.9, 0, AU, { seg: 5 });
  return k.done();
}

const BUILDERS = { fernsehturm, brandenburger_tor, reichstag, berliner_dom, siegessaeule, rotes_rathaus, gedaechtniskirche,
  tokyo_skytree, tokyo_tower, kaminarimon, sensoji_pagoda, kokyo_fushimi, nijubashi, meiji_torii, tokyo_station, rainbow_bridge,
  eiffelturm, arc_de_triomphe, notre_dame, sacre_coeur, louvre_pyramide, elizabeth_tower, tower_bridge, london_eye, st_pauls,
  freiheitsstatue, empire_state, one_wtc, chrysler, capitol, washington_monument, kolosseum, petersdom, schiefer_turm, sagrada_familia, koelner_dom, atomium,
  basilius, spasskaja, hagia_sophia, parthenon, pyramiden_gizeh, burj_khalifa, taj_mahal, gateway_of_india, tiananmen, oriental_pearl, taipei_101,
  n_seoul_tower, wat_arun, petronas, marina_bay_sands, opernhaus_sydney, harbour_bridge, cristo_redentor, cn_tower, golden_gate, space_needle, koutoubia };
export const LANDMARK_KEYS = Object.keys(BUILDERS);
export function buildLandmark(key) {
  const f = BUILDERS[key];
  if (!f) return null;
  return f();
}
