// Mauern im Bild (seit 24.10.2026, Kriegssystem, sim/military.js). Jeder Ort mit s.wall bekommt seinen Ring
// (s.wall.ring: Radius je Richtung um die Ortsmitte) im Stil seiner Stufe: 1 Palisade aus angespitzten Stämmen,
// 2 Erdwall mit Palisade und Holztürmen, 3 Steinmauer mit Zinnen, Vierecktürmen und Torhaus, 4 Ringmauer mit
// Rundtürmen und Kegeldächern, 5 Sternfestung mit Bastionen und Kanonen, 6 Gräben, Sandsäcke, Stacheldraht, Bunker.
// Tore stehen, wo Straßen den Ring kreuzen, über Wasser und durch Gebäude bleibt eine Lücke. Beschädigte Mauern
// (hp < 1, Belagerung) haben Breschen mit Schutt. Im Bau wächst der neue Ring einmal herum, mit Gerüst an der Spitze.
// Nachts brennen Fackeln an Toren und Türmen. Alles je Ort in einem Zeichenaufruf mit Eckfarben.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NX, NY } from './scene.js';
import { groundY } from './terrain.js';
// Bodenhöhe für alle Bauteile; die Modell-Sammlung (wallSample) baut auf flachem Boden
let GY = groundY;
import { ringAt } from '../sim/military.js';

const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const WOOD = '#8a6544', WOOD2 = '#7a5638', WOODD = '#5e4330', EARTH = '#8c7a55', GRASS = '#8fa66a';
const STONE = ['#c4baa6', '#b5ab98', '#cfc6b4'], STONE4 = ['#cdc4b2', '#bdb3a1', '#d8cfbd'], SLATE = '#59636e', TERRA = '#b4573e';
const BRICK = ['#c2906c', '#b5815e'], CONCRETE = '#a3a19a', SAND = ['#cdb88e', '#c2ab80'], DARK = '#2a2624', WIRE = '#4a4a4a';
const SEG = 0.42; // Länge eines Mauerstücks
// Abstand der Türme in Mauerstücken je Stufe (0: keine)
const TOWER_EVERY = [0, 0, 9, 7, 6, 8, 7];

class B {
  constructor(seed) { this.g = []; this.glow = []; this.seed = seed; this.n = 0; }
  rnd() { return hash(this.seed * 97 + this.n++, 11); }
  add(geo, c, glow) {
    geo = geo.index ? geo.toNonIndexed() : geo;
    for (const k of ['uv', 'uv1']) if (geo.attributes[k]) geo.deleteAttribute(k);
    const col = new THREE.Color(c), n = geo.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.toArray(a, i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
    (glow ? this.glow : this.g).push(geo);
  }
  box(w, h, d, x, y, z, c, ry = 0) { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y + h / 2, z); this.add(g, c); }
  cyl(r1, r2, h, x, y, z, c, seg = 8) { this.add(new THREE.CylinderGeometry(r1, r2, h, seg).translate(x, y + h / 2, z), c); }
  cone(r, h, x, y, z, c, seg = 8, ry = 0) { const g = new THREE.ConeGeometry(r, h, seg); if (ry) g.rotateY(ry); this.add(g.translate(x, y + h / 2, z), c); }
  ball(r, x, y, z, c, sx = 1, sy = 1, sz = 1, glow = false) { this.add(new THREE.IcosahedronGeometry(r, 0).scale(sx, sy, sz).translate(x, y, z), c, glow); }
  // Quader entlang einer Strecke (Fuß bei y), Breite d quer dazu
  span(x0, z0, x1, z1, y, h, d, c, over = 0) {
    const len = Math.hypot(x1 - x0, z1 - z0) + over;
    if (len < 0.01) return;
    const g = new THREE.BoxGeometry(len, h, d);
    g.translate(0, h / 2, 0); g.rotateY(-Math.atan2(z1 - z0, x1 - x0)); g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    this.add(g, c);
  }
  build() { return { geo: this.g.length ? mergeGeometries(this.g) : null, glow: this.glow.length ? mergeGeometries(this.glow) : null }; }
}

// ---- Bauteile je Stufe. P: Mauerstück { x0, z0, x1, z1, y0, y1, ox, oz } (ox, oz: Richtung nach außen) ----
const lerp = (a, b, t) => a + (b - a) * t;
function logs(k, P, h, step, yOff = 0) {
  const len = Math.hypot(P.x1 - P.x0, P.z1 - P.z0), n = Math.max(1, Math.round(len / step));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, x = lerp(P.x0, P.x1, t), z = lerp(P.z0, P.z1, t), y = GY(x, z) - 0.03 + yOff, hh = h * (0.9 + k.rnd() * 0.2);
    k.cyl(0.024, 0.026, hh, x, y, z, i % 3 ? WOOD : WOOD2, 5);
    k.cone(0.024, 0.05, x, y + hh, z, WOODD, 5);
  }
}
function crenels(k, P, top, w, c) {
  const len = Math.hypot(P.x1 - P.x0, P.z1 - P.z0), n = Math.max(1, Math.round(len / 0.09)), ry = -Math.atan2(P.z1 - P.z0, P.x1 - P.x0);
  for (let i = 0; i < n; i += 2) {
    const t = (i + 0.5) / n;
    for (const s of [-1, 1]) k.box(0.045, 0.05, 0.03, lerp(P.x0, P.x1, t) + P.ox * s * w * 0.4, top, lerp(P.z0, P.z1, t) + P.oz * s * w * 0.4, c, ry);
  }
}
const WALL = {
  1(k, P) { logs(k, P, 0.27, 0.055); k.span(P.x0, P.z0, P.x1, P.z1, Math.min(P.y0, P.y1) + 0.12, 0.022, 0.06, WOODD); },
  2(k, P) {
    const yb = Math.min(P.y0, P.y1) - 0.05, h = 0.14 + Math.abs(P.y0 - P.y1);
    k.span(P.x0, P.z0, P.x1, P.z1, yb, h, 0.26, EARTH, 0.04);
    k.span(P.x0, P.z0, P.x1, P.z1, yb + h, 0.02, 0.27, GRASS, 0.04);
    logs(k, P, 0.17, 0.075, 0.12);
  },
  3(k, P, i) {
    const yb = Math.min(P.y0, P.y1) - 0.06, top = Math.max(P.y0, P.y1) + 0.3;
    k.span(P.x0, P.z0, P.x1, P.z1, yb, top - yb, 0.11, STONE[i % 3], 0.012);
    crenels(k, P, top, 0.11, STONE[(i + 1) % 3]);
  },
  4(k, P, i) {
    const yb = Math.min(P.y0, P.y1) - 0.06, top = Math.max(P.y0, P.y1) + 0.4;
    k.span(P.x0, P.z0, P.x1, P.z1, yb, top - yb, 0.13, STONE4[i % 3], 0.012);
    k.span(P.x0, P.z0, P.x1, P.z1, top - 0.04, 0.025, 0.16, STONE4[2], 0.02);
    crenels(k, P, top, 0.13, STONE4[(i + 1) % 3]);
  },
  5(k, P, i) {
    const yb = Math.min(P.y0, P.y1) - 0.06, top = Math.max(P.y0, P.y1) + 0.24;
    k.span(P.x0, P.z0, P.x1, P.z1, yb, top - yb, 0.22, BRICK[i % 2], 0.02);
    k.span(P.x0, P.z0, P.x1, P.z1, top, 0.025, 0.2, GRASS, 0.02);
    k.span(P.x0 + P.ox * 0.11, P.z0 + P.oz * 0.11, P.x1 + P.ox * 0.11, P.z1 + P.oz * 0.11, top - 0.02, 0.05, 0.03, '#d9c7a8', 0.02);
  },
  6(k, P) {
    // Graben innen, Sandsäcke in zwei Lagen, davor Stacheldraht an Pfählen
    const len = Math.hypot(P.x1 - P.x0, P.z1 - P.z0);
    k.span(P.x0 - P.ox * 0.1, P.z0 - P.oz * 0.1, P.x1 - P.ox * 0.1, P.z1 - P.oz * 0.1, Math.min(P.y0, P.y1) - 0.02, 0.035, 0.12, '#4e4234', 0.02);
    const n = Math.max(2, Math.round(len / 0.07));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, x = lerp(P.x0, P.x1, t), z = lerp(P.z0, P.z1, t), y = GY(x, z);
      k.ball(0.04, x, y + 0.02, z, SAND[i % 2], 1.1, 0.5, 0.75);
      if (i % 2) k.ball(0.038, x + (P.x1 - P.x0) / n * 0.5, y + 0.055, z + (P.z1 - P.z0) / n * 0.5, SAND[(i + 1) % 2], 1.1, 0.5, 0.75);
    }
    const m = Math.max(1, Math.round(len / 0.22));
    for (let i = 0; i <= m; i++) {
      const t = i / m, x = lerp(P.x0, P.x1, t) + P.ox * 0.22, z = lerp(P.z0, P.z1, t) + P.oz * 0.22;
      k.cyl(0.006, 0.006, 0.1, x, GY(x, z) - 0.01, z, WOODD, 4);
    }
    const yw = Math.min(P.y0, P.y1);
    for (const hh of [0.04, 0.075]) k.span(P.x0 + P.ox * 0.22, P.z0 + P.oz * 0.22, P.x1 + P.ox * 0.22, P.z1 + P.oz * 0.22, yw + hh, 0.006, 0.006, WIRE);
  },
};

// Türme, Bastionen, Bunker (x, z: Stelle auf dem Ring, ry: Ausrichtung, ox, oz: nach außen)
function tower(k, lvl, x, z, ry, ox, oz, torch) {
  const y = GY(x, z) - 0.05;
  if (lvl === 2) {
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.cyl(0.014, 0.016, 0.5, x + a * 0.07, y, z + b * 0.07, WOODD, 5);
    k.box(0.2, 0.025, 0.2, x, y + 0.42, z, WOOD, ry);
    k.box(0.2, 0.06, 0.012, x + ox * 0.095, y + 0.445, z + oz * 0.095, WOOD2, ry);
    k.cone(0.16, 0.13, x, y + 0.53, z, '#c9a95c', 4, ry + Math.PI / 4);
    if (torch) k.ball(0.022, x + ox * 0.11, y + 0.5, z + oz * 0.11, '#ffcf6a', 1, 1.4, 1, true);
  } else if (lvl === 3) {
    k.box(0.22, 0.5, 0.22, x, y, z, STONE[1], ry);
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const c = Math.cos(ry), s = Math.sin(ry), dx = a * 0.09 * c + b * 0.09 * s, dz = -a * 0.09 * s + b * 0.09 * c;
      k.box(0.045, 0.06, 0.045, x + dx, y + 0.5, z + dz, STONE[0], ry);
    }
    k.box(0.03, 0.06, 0.012, x + ox * 0.112, y + 0.32, z + oz * 0.112, DARK, ry);
    if (torch) k.ball(0.022, x + ox * 0.13, y + 0.4, z + oz * 0.13, '#ffcf6a', 1, 1.4, 1, true);
  } else if (lvl === 4) {
    k.cyl(0.12, 0.13, 0.6, x, y, z, STONE4[0], 12);
    k.cyl(0.14, 0.14, 0.04, x, y + 0.6, z, STONE4[2], 12);
    k.cone(0.15, 0.24, x, y + 0.64, z, SLATE, 12);
    k.cyl(0.003, 0.003, 0.12, x, y + 0.86, z, DARK, 3);
    k.box(0.07, 0.04, 0.004, x + 0.035, y + 0.94, z, '#c8553d', 0);
    k.box(0.025, 0.06, 0.012, x + ox * 0.125, y + 0.38, z + oz * 0.125, DARK, ry);
    if (torch) k.ball(0.022, x + ox * 0.15, y + 0.46, z + oz * 0.15, '#ffcf6a', 1, 1.4, 1, true);
  } else if (lvl === 5) {
    // Bastion: spitze Raute nach außen, Wachhäuschen an der Spitze, Kanone
    const bx = x + ox * 0.18, bz = z + oz * 0.18, yb = GY(bx, bz) - 0.06;
    k.box(0.36, 0.3, 0.36, bx, yb, bz, BRICK[0], ry + Math.PI / 4);
    k.box(0.32, 0.02, 0.32, bx, yb + 0.3, bz, GRASS, ry + Math.PI / 4);
    const tx = bx + ox * 0.24, tz = bz + oz * 0.24;
    k.cyl(0.035, 0.04, 0.1, tx, yb + 0.3, tz, '#d9c7a8', 8); k.cone(0.045, 0.05, tx, yb + 0.4, tz, SLATE, 8);
    const g = new THREE.CylinderGeometry(0.014, 0.018, 0.16, 6); g.rotateZ(Math.PI / 2); g.rotateY(-Math.atan2(oz, ox)); g.translate(bx + ox * 0.12, yb + 0.35, bz + oz * 0.12); k.add(g, '#2f2f30');
  } else if (lvl === 6) {
    // Bunker aus Beton mit Sehschlitz, Erde obendrauf
    const bx = x - ox * 0.05, bz = z - oz * 0.05, yb = GY(bx, bz) - 0.04;
    k.box(0.28, 0.13, 0.22, bx, yb, bz, CONCRETE, ry);
    k.box(0.3, 0.03, 0.24, bx, yb + 0.13, bz, '#7d8a5a', ry);
    k.box(0.14, 0.022, 0.01, bx + ox * 0.112, yb + 0.08, bz + oz * 0.112, DARK, ry);
    k.cyl(0.004, 0.004, 0.16, bx - ox * 0.06, yb + 0.15, bz - oz * 0.06, '#666', 3);
  }
}

// Tor: Öffnung über n Mauerstücke, Torbauten an beiden Seiten
function gate(k, lvl, A, Bp, ry, ox, oz) {
  const mx = (A[0] + Bp[0]) / 2, mz = (A[1] + Bp[1]) / 2, y = GY(mx, mz);
  const w = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]);
  if (lvl === 1 || lvl === 2) {
    for (const p of [A, Bp]) k.cyl(0.035, 0.04, 0.42, p[0], GY(p[0], p[1]) - 0.04, p[1], WOODD, 6);
    k.span(A[0], A[1], Bp[0], Bp[1], y + 0.34, 0.035, 0.05, WOOD2, 0.1);
    if (lvl === 2) { tower(k, 2, A[0], A[1], ry, ox, oz, true); tower(k, 2, Bp[0], Bp[1], ry, ox, oz, true); }
    else for (const p of [A, Bp]) k.ball(0.02, p[0] + ox * 0.05, GY(p[0], p[1]) + 0.36, p[1] + oz * 0.05, '#ffcf6a', 1, 1.4, 1, true);
    // offene Torflügel nach innen geklappt
    for (const [p, s] of [[A, 1], [Bp, -1]]) {
      const ex = p[0] + (Bp[0] - A[0]) / w * 0.02 * s - ox * 0.14, ez = p[1] + (Bp[1] - A[1]) / w * 0.02 * s - oz * 0.14;
      logs(k, { x0: p[0] - ox * 0.02, z0: p[1] - oz * 0.02, x1: ex, z1: ez }, 0.24, 0.05);
    }
  } else if (lvl === 3 || lvl === 4) {
    tower(k, lvl, A[0], A[1], ry, ox, oz, true); tower(k, lvl, Bp[0], Bp[1], ry, ox, oz, true);
    const c = lvl === 3 ? STONE : STONE4, top = y + (lvl === 3 ? 0.34 : 0.42);
    k.span(A[0], A[1], Bp[0], Bp[1], top, 0.13, lvl === 3 ? 0.13 : 0.16, c[0], 0.05);
    k.span(A[0], A[1], Bp[0], Bp[1], top + 0.13, 0.03, lvl === 3 ? 0.15 : 0.18, c[2], 0.06);
    if (lvl === 4) { k.span(A[0], A[1], Bp[0], Bp[1], top + 0.16, 0.12, 0.12, c[1], 0); k.cone(Math.max(0.1, w * 0.45), 0.16, mx, top + 0.28, mz, TERRA, 4, ry + Math.PI / 4); }
    // Fallgitter halb hochgezogen
    k.span(A[0], A[1], Bp[0], Bp[1], top - 0.06, 0.06, 0.012, '#3a3632', -0.04);
  } else if (lvl === 5) {
    for (const p of [A, Bp]) k.box(0.12, 0.34, 0.24, p[0], GY(p[0], p[1]) - 0.06, p[1], BRICK[1], ry);
    k.span(A[0], A[1], Bp[0], Bp[1], y + 0.24, 0.1, 0.24, BRICK[0], 0.08);
    k.span(A[0], A[1], Bp[0], Bp[1], y + 0.34, 0.06, 0.1, '#e9e1d0', -0.02);
    k.cone(0.06, 0.05, mx, y + 0.4, mz, SLATE, 4, ry + Math.PI / 4);
  } else {
    // Kontrollposten: Schlagbaum rot weiß, Wachhäuschen
    const hx = A[0] - ox * 0.12, hz = A[1] - oz * 0.12;
    k.box(0.12, 0.14, 0.12, hx, GY(hx, hz) - 0.02, hz, '#d8d4c8', ry); k.box(0.14, 0.02, 0.14, hx, GY(hx, hz) + 0.12, hz, '#5b6066', ry);
    k.cyl(0.01, 0.01, 0.09, A[0], GY(A[0], A[1]), A[1], '#555', 4);
    const n = 5;
    for (let i = 0; i < n; i++) { const t0 = i / n, t1 = (i + 1) / n; k.span(lerp(A[0], Bp[0], t0), lerp(A[1], Bp[1], t0), lerp(A[0], Bp[0], t1), lerp(A[1], Bp[1], t1), y + 0.08, 0.016, 0.016, i % 2 ? '#f2efe6' : '#c8413a'); }
  }
}

// Schutt in einer Bresche
function rubble(k, P, lvl) {
  const n = 6, c = lvl === 1 || lvl === 2 ? [WOOD, WOODD, EARTH] : lvl >= 5 ? [BRICK[0], BRICK[1], CONCRETE] : [STONE[0], STONE[1], '#9a9284'];
  for (let i = 0; i < n; i++) {
    const t = k.rnd(), x = lerp(P.x0, P.x1, t) + (k.rnd() - 0.5) * 0.18, z = lerp(P.z0, P.z1, t) + (k.rnd() - 0.5) * 0.18;
    k.ball(0.035 + k.rnd() * 0.04, x, GY(x, z) + 0.01, z, c[i % 3], 1.2, 0.55, 1);
  }
}
// Gerüst an der Baustelle
function scaffold(k, x, z, ry) {
  const y = GY(x, z) - 0.02;
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const c = Math.cos(ry), s = Math.sin(ry), dx = a * 0.1 * c + b * 0.07 * s, dz = -a * 0.1 * s + b * 0.07 * c;
    k.cyl(0.008, 0.008, 0.42, x + dx, y, z + dz, '#b08a5a', 4);
  }
  for (const h of [0.18, 0.36]) k.box(0.24, 0.012, 0.16, x, y + h, z, '#c9a06a', ry);
  k.box(0.06, 0.05, 0.06, x + 0.15, y, z + 0.1, STONE[2], ry); k.box(0.05, 0.04, 0.05, x + 0.2, y, z + 0.04, STONE[1], ry + 0.4);
}

// Ring als Punktliste in Weltkoordinaten. Steht inzwischen ein Haus auf der Linie (der Ort ist gewachsen), weicht die
// Mauer bis zu zwei Felder nach außen aus, danach wird weich geglättet.
function ringPoints(st, s, ring) {
  let C = 0;
  for (let i = 0; i < ring.length; i++) C += ring[i];
  C = (C / ring.length) * Math.PI * 2;
  const n = Math.max(24, Math.round(C / SEG)), rs = [], rt = st._rt;
  const house = (x, y) => { const tx = Math.floor(x), ty = Math.floor(y); if (tx < 0 || ty < 0 || tx >= NX || ty >= NY) return false; const b = rt.bldAt[ty * NX + tx] && rt.bById.get(rt.bldAt[ty * NX + tx]); return !!b && b.t !== 'feld'; };
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI, c = Math.cos(a), sn = Math.sin(a);
    let r = ringAt(ring, a);
    for (let k = 0; k < 8 && (house(s.cx + 0.5 + c * r, s.cy + 0.5 + sn * r) || house(s.cx + 0.5 + c * (r + 0.3), s.cy + 0.5 + sn * (r + 0.3))); k++) r += 0.25;
    rs.push(r);
  }
  const sm = rs.map((r, i) => Math.max(r, (rs[(i + n - 1) % n] + r * 2 + rs[(i + 1) % n]) / 4));
  return sm.map((r, i) => { const a = (i / n) * Math.PI * 2 - Math.PI; return [s.cx + Math.cos(a) * r - NX / 2 + 0.5, s.cy + Math.sin(a) * r - NY / 2 + 0.5, a]; });
}

// Modell-Sammlung (seit 24.10.2026, ui/collection.js): ein gerades Mauerstück der Stufe lvl auf flachem Boden mit Türmen
// und einem Tor in der Mitte, außen ist +z. Rückgabe { geo, glow } wie beim Ring
export function wallSample(lvl) {
  const k = new B(lvl * 13 + 5), prev = GY;
  GY = () => 0;
  try {
    const n = 12, x0 = -n * SEG / 2;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * SEG;
      if (i === 5) { gate(k, lvl, [x, 0], [x + SEG * 2, 0], 0, 0, 1); i++; continue; }
      WALL[lvl](k, { x0: x, z0: 0, x1: x + SEG, z1: 0, y0: 0, y1: 0, ox: 0, oz: 1 }, i);
      if (TOWER_EVERY[lvl] && (i === 0 || i === 3 || i === 8 || i === n - 1)) tower(k, lvl, x + (i === n - 1 ? SEG : 0), 0, 0, 0, 1, true);
    }
  } finally { GY = prev; }
  return k.build();
}

export class Walls {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true });
    this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false });
    this.items = new Map();
    this.streetMask = null; // Straßenraster aus render/streets.js (1 Fußweg, 2 Straße, 3 Hauptstraße)
    this.streets = null;
  }

  reset() { for (const it of this.items.values()) this.drop(it); this.items.clear(); }
  drop(it) { this.group.remove(it.g); it.g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }

  key(s) {
    const W = s.wall;
    if (!W || (!W.lvl && !W.b)) return '';
    return `${W.lvl}|${Math.round((W.hp ?? 1) * 10)}|${W.b}|${Math.floor((W.prog || 0) * 24)}|${W.ring ? W.ring.join(',') : ''}|${W.next && W.b ? W.next.join(',') : ''}|${this.streets ? this.streets.version : 0}`;
  }

  // Wie ist das Mauerstück an der Stelle: 'w' Mauer, 'g' Tor (Straße), '' Lücke (Wasser, Gebäude)
  kind(st, x, z) {
    const tx = Math.floor(x + NX / 2), ty = Math.floor(z + NY / 2);
    if (tx < 0 || ty < 0 || tx >= NX || ty >= NY) return '';
    const j = ty * NX + tx, T = st.tiles, rt = st._rt;
    if (T.h[j] < 0) return '';
    const b = rt.bldAt[j] && rt.bById.get(rt.bldAt[j]);
    const road = (this.streetMask && this.streetMask[j] >= 2) || T.road[j] > 60 || (rt.roadNet && rt.roadNet[j]);
    if (b && b.t !== 'feld') return road ? 'g' : '';
    return road ? 'g' : 'w';
  }

  // Ein Ring in einer Stufe zeichnen; frac: so weit ist er gebaut (Baustelle), hp für Breschen
  ring(k, st, s, ring, lvl, frac, hp, seed) {
    const pts = ringPoints(st, s, ring), n = pts.length, cx = s.cx - NX / 2 + 0.5, cz = s.cy - NY / 2 + 0.5;
    const kinds = pts.map((p, i) => { const q = pts[(i + 1) % n]; return this.kind(st, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); });
    const upto = Math.floor(n * frac), every = TOWER_EVERY[lvl];
    for (let i = 0; i < upto; i++) {
      const p = pts[i], q = pts[(i + 1) % n], kd = kinds[i];
      const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2, d = Math.hypot(mx - cx, mz - cz) || 1, ox = (mx - cx) / d, oz = (mz - cz) / d;
      const ry = -Math.atan2(q[1] - p[1], q[0] - p[0]);
      if (!kd) continue;
      if (kd === 'g') {
        // Tor nur am Anfang einer Folge von Torstücken, über die ganze Folge
        if (i > 0 && kinds[i - 1] === 'g') continue;
        let j = i; while (j + 1 < upto && kinds[j + 1] === 'g' && j - i < 3) j++;
        gate(k, lvl, [p[0], p[1]], [pts[(j + 1) % n][0], pts[(j + 1) % n][1]], ry, ox, oz);
        continue;
      }
      const P = { x0: p[0], z0: p[1], x1: q[0], z1: q[1], y0: GY(p[0], p[1]), y1: GY(q[0], q[1]), ox, oz };
      if (hp < 1 && hash(seed * 131 + i, 3) < (1 - hp) * 0.5) { rubble(k, P, lvl); continue; }
      WALL[lvl](k, P, i);
      // Türme in festen Abständen und an Mauerenden (neben Lücken)
      const end = !kinds[(i + n - 1) % n] || (i === upto - 1 && frac >= 1 && !kinds[(i + 1) % n]);
      if (every && (i % every === 0 || end)) tower(k, lvl, p[0], p[1], ry, ox, oz, i % (every * 2) === 0);
    }
    if (frac < 1 && upto < n) { const p = pts[upto]; scaffold(k, p[0], p[1], -Math.atan2(pts[(upto + 1) % n][1] - p[1], pts[(upto + 1) % n][0] - p[0])); }
  }

  build(st, s) {
    const W = s.wall, k = new B(s.id);
    const hp = W.hp ?? 1;
    if (W.b && W.next) {
      if (W.lvl && W.b > W.lvl && W.ring) {
        // Ausbau: der neue Ring wächst herum, der Rest steht noch in der alten Stufe
        this.ring(k, st, s, W.next, W.b, W.prog, 1, s.id);
        const n = ringPoints(st, s, W.ring).length;
        this.ringRange(k, st, s, W.ring, W.lvl, Math.ceil(n * W.prog), n, hp, s.id);
      } else {
        if (W.lvl && W.ring) this.ring(k, st, s, W.ring, W.lvl, 1, hp, s.id);
        this.ring(k, st, s, W.next, W.b, W.prog, 1, s.id + 7);
      }
    } else if (W.lvl && W.ring) this.ring(k, st, s, W.ring, W.lvl, 1, hp, s.id);
    return k.build();
  }

  ringRange(k, st, s, ring, lvl, i0, i1, hp, seed) {
    const pts = ringPoints(st, s, ring), n = pts.length, cx = s.cx - NX / 2 + 0.5, cz = s.cy - NY / 2 + 0.5, every = TOWER_EVERY[lvl];
    for (let i = i0; i < i1; i++) {
      const p = pts[i], q = pts[(i + 1) % n], kd = this.kind(st, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
      if (kd !== 'w') continue;
      const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2, d = Math.hypot(mx - cx, mz - cz) || 1, ox = (mx - cx) / d, oz = (mz - cz) / d;
      const P = { x0: p[0], z0: p[1], x1: q[0], z1: q[1], y0: GY(p[0], p[1]), y1: GY(q[0], q[1]), ox, oz };
      if (hp < 1 && hash(seed * 131 + i, 3) < (1 - hp) * 0.5) { rubble(k, P, lvl); continue; }
      WALL[lvl](k, P, i);
      if (every && i % every === 0) tower(k, lvl, p[0], p[1], -Math.atan2(q[1] - p[1], q[0] - p[0]), ox, oz, false);
    }
  }

  sync(st) {
    const seen = new Set();
    for (const s of st.settlements) {
      if (!s.alive) continue;
      const key = this.key(s);
      if (!key) continue;
      seen.add(s.id);
      let it = this.items.get(s.id);
      if (it && it.k === key) continue;
      if (it) this.drop(it);
      const { geo, glow } = this.build(st, s);
      const g = new THREE.Group();
      if (geo) { const m = new THREE.Mesh(geo, this.mat); m.castShadow = true; m.receiveShadow = true; g.add(m); }
      if (glow) { const m = new THREE.Mesh(glow, this.glowMat); m.renderOrder = 2; g.add(m); }
      this.group.add(g);
      this.items.set(s.id, it = { g, k: key });
    }
    for (const [id, it] of this.items) if (!seen.has(id)) { this.drop(it); this.items.delete(id); }
  }

  update(st, t, night, hidden) {
    if (!st) return;
    if (t - (this.lastSync || -9) > 1 || this.syncSt !== st) { this.lastSync = t; this.syncSt = st; this.sync(st); }
    this.group.visible = !hidden;
    // Fackeln nur bei Dunkelheit
    this.glowMat.opacity = Math.max(0, Math.min(1, (night - 0.35) * 2.5));
  }
}
