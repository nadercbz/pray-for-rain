// Die neue Welt (seit 18.10.2026): ein großer Kontinent östlich und südlich des Archipels, dazu Inseln im Südwesten.
// Der Archipel liegt unverändert oben links (ARCH x ARCH). Klima von eisig im Nordosten bis glühend im Süden,
// Feuchte aus Rauschen, Küstennähe und Regenschatten hinter dem großen Gebirge. Daraus die Lebensräume (BIOMES in data.js),
// Fjorde an der kalten Küste, Seen, Oasen, Flüsse von den Bergen ins Meer, Vulkane.
// Alles nur aus dem Seed: ein alter Spielstand bekommt beim Laden dieselbe neue Welt wie eine neue Welt mit diesem Seed.
import { Rng, fbm, clamp } from './rng.js';
import { MAP, ARCH, BIO } from './data.js';
import { placeName } from './names.js';
import { L } from '../i18n.js';

const N = MAP;
const id = (x, y) => y * N + x;
const inb = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Kältepol im Nordosten, Hitzepol im Süden. Der Archipel liegt genau dazwischen (mild).
const COLD = [N - 8, 6], HOT = [N * 0.56, N - 4];
export function climate(x, y, s) {
  const dc = Math.hypot(x - COLD[0], y - COLD[1]), dh = Math.hypot(x - HOT[0], y - HOT[1]);
  return clamp(0.5 + (dc - dh) / 640 + (fbm(x * 0.021 + 3, y * 0.021 + 7, s + 900, 3) - 0.5) * 0.16, 0, 1);
}

// Abstand eines Punktes zum Rechteck des Archipels (0 innen)
const boxDist = (x, y) => Math.hypot(Math.max(0, x - (ARCH - 1)), Math.max(0, y - (ARCH - 1)));

// Gebirge: ein langes Rückgrat von Nordost nach Südwest, dazu zwei kürzere Ketten. Die Punkte schwanken je Seed.
function ranges(r) {
  const j = (v, a) => v + r.range(-a, a);
  const main = [[j(N - 24, 4), 16], [j(N - 52, 10), 50], [j(N - 74, 12), 92], [j(N - 58, 12), 132], [j(N - 70, 12), 172], [j(N - 96, 12), 214], [j(N - 110, 10), 250], [j(N - 146, 12), 284]];
  const west = [[j(ARCH + 52, 8), 40], [j(ARCH + 64, 8), 70], [j(ARCH + 58, 8), 104]];
  const south = [[j(N - 40, 8), 262], [j(N - 26, 6), 292]];
  return [main, west, south];
}
function segDist(px, py, pts) {
  let best = 1e9, side = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
    const vx = bx - ax, vy = by - ay, t = clamp(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy), 0, 1);
    const qx = ax + vx * t, qy = ay + vy * t, d = Math.hypot(px - qx, py - qy);
    if (d < best) { best = d; side = Math.sign(vx * (py - ay) - vy * (px - ax)); }
  }
  return [best, side];
}

// Inselform wie im Archipel (world.js), hier für die Südwestinseln
function islandShape(nx, ny, s) {
  const wx = nx + (fbm(nx * 1.6 + 5, ny * 1.6, s + 11, 4) - 0.5) * 0.55;
  const wy = ny + (fbm(nx * 1.6, ny * 1.6 + 9, s + 13, 4) - 0.5) * 0.55;
  const d = Math.sqrt(wx * wx + wy * wy);
  const base = fbm(nx * 2.4 + 3, ny * 2.4 + 7, s, 5);
  const ridge = 1 - Math.abs(fbm(nx * 2.8 + 1, ny * 2.8 + 2, s + 50, 4) * 2 - 1);
  return (base - 0.5) * 0.95 + 0.46 - d * d * 0.95 - d * 0.32 + ridge * ridge * 0.34 * clamp(1.1 - d, 0, 1);
}

// Höhenstufen der neuen Welt: wie der Archipel, aber mit hohen Gipfeln (7 bis 9) im großen Gebirge
const BANDS = [[0.06, 0], [0.48, 1], [0.69, 2], [0.82, 3], [0.9, 4], [0.945, 5], [0.972, 6], [0.987, 7], [0.996, 8], [1.01, 9]];
function toLevels(E, mask, h) {
  const land = [];
  for (let i = 0; i < E.length; i++) if (mask[i] && E[i] >= 0) land.push(E[i]);
  land.sort((a, b) => a - b);
  const cut = BANDS.map(([q]) => land[Math.min(land.length - 1, Math.floor(q * land.length))]);
  for (let i = 0; i < E.length; i++) {
    if (!mask[i]) continue;
    const e = E[i];
    if (e < -0.17) { h[i] = -2; continue; }
    if (e < 0) { h[i] = -1; continue; }
    let l = 6;
    for (let b = 0; b < BANDS.length; b++) if (e <= cut[b]) { l = BANDS[b][1]; break; }
    h[i] = l;
  }
}

// Abstand zum offenen Meer (Breitensuche), Seen zählen nicht als Meer
function oceanDist(h) {
  const ocean = new Uint8Array(N * N), q = [];
  for (let x = 0; x < N; x++) for (const y of [0, N - 1]) { const i = id(x, y); if (h[i] < 0 && !ocean[i]) { ocean[i] = 1; q.push(i); } }
  for (let y = 0; y < N; y++) for (const x of [0, N - 1]) { const i = id(x, y); if (h[i] < 0 && !ocean[i]) { ocean[i] = 1; q.push(i); } }
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % N, y = (i / N) | 0;
    for (const [dx, dy] of D4) { const xx = x + dx, yy = y + dy; if (!inb(xx, yy)) continue; const j = id(xx, yy); if (h[j] < 0 && !ocean[j]) { ocean[j] = 1; q.push(j); } }
  }
  const dist = new Int16Array(N * N).fill(-1), q2 = [];
  for (let i = 0; i < N * N; i++) if (ocean[i]) { dist[i] = 0; q2.push(i); }
  for (let k = 0; k < q2.length; k++) {
    const i = q2[k], x = i % N, y = (i / N) | 0;
    for (const [dx, dy] of D4) { const xx = x + dx, yy = y + dy; if (!inb(xx, yy)) continue; const j = id(xx, yy); if (dist[j] < 0) { dist[j] = dist[i] + 1; q2.push(j); } }
  }
  return { ocean, dist };
}

// Wohin der Archipel noch nicht reicht: darf die neue Welt dort Land machen?
const free = (x, y) => x >= ARCH || y >= ARCH;

export function growWorld(T, isles, seed, taken = new Set()) {
  const s = (seed ^ 0x9e3779b9) >>> 0;
  const r = new Rng(s);
  const { h } = T;
  const mask = new Uint8Array(N * N);
  const E = new Float32Array(N * N).fill(-1);
  const rg = ranges(r), sp = rg[0];
  const ridgeAt = (x, y) => {
    let best = 0;
    rg.forEach((pts, k) => {
      const [d] = segDist(x, y, pts);
      const w = (k ? 9 : 15) * (0.7 + fbm(x * 0.03 + k * 5, y * 0.03, s + 7 + k, 3) * 0.7);
      let v = Math.pow(Math.max(0, 1 - d / w), 1.4);
      // Pässe: das Gebirge reißt stellenweise auf
      v *= smooth(0.34, 0.5, fbm(x * 0.025 + 3 + k, y * 0.025 + 1, s + 8 + k, 3));
      best = Math.max(best, v * (k ? 0.75 : 1));
    });
    return best;
  };
  // ---------- Kontinent ----------
  const blobs = [
    [N - 62 + r.range(-6, 6), 66 + r.range(-6, 6), 60 + r.range(-4, 4), 62 + r.range(-4, 6)],
    [N - 70 + r.range(-6, 6), 160 + r.range(-6, 6), 62 + r.range(-4, 4), 56 + r.range(-4, 4)],
    [N - 80 + r.range(-6, 6), 248 + r.range(-6, 4), 66 + r.range(-4, 4), 50 + r.range(-4, 4)],
    [N - 150 + r.range(-8, 8), 282 + r.range(-4, 4), 64 + r.range(-4, 6), 28 + r.range(-3, 3)],
    [N - 20, 22, 34, 30],
  ];
  // Halbinseln am Rand und Buchten in die Küste, dazu ein tiefer Golf von Westen
  const bays = [];
  for (let k = 0; k < 7; k++) {
    const B = blobs[r.int(0, 3)], a = r.range(0, Math.PI * 2);
    const px = B[0] + Math.cos(a) * B[2] * 0.95, py = B[1] + Math.sin(a) * B[3] * 0.95;
    if (k < 4) blobs.push([px, py, r.range(12, 24), r.range(10, 20)]);
    else bays.push([px, py, r.range(10, 18), r.range(8, 14)]);
  }
  bays.push([N - 128 + r.range(-6, 6), 196 + r.range(-10, 10), r.range(30, 40), r.range(9, 13)]);
  const volcanoes = [];
  volcanoes.push([N - 34 + r.range(-6, 4), 218 + r.range(-12, 12), 8]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!free(x, y)) continue;
    const i = id(x, y);
    mask[i] = 1;
    const wx = x + (fbm(x * 0.011 + 4, y * 0.011, s + 1, 4) - 0.5) * 84 + (fbm(x * 0.04, y * 0.04 + 2, s + 9, 3) - 0.5) * 18;
    const wy = y + (fbm(x * 0.011, y * 0.011 + 8, s + 2, 4) - 0.5) * 84 + (fbm(x * 0.04 + 6, y * 0.04, s + 10, 3) - 0.5) * 18;
    let v = -1;
    for (const [cx, cy, rx, ry] of blobs) v = Math.max(v, 1 - Math.hypot((wx - cx) / rx, (wy - cy) / ry));
    for (const [cx, cy, rx, ry] of bays) v = Math.min(v, Math.hypot((wx - cx) / rx, (wy - cy) / ry) - 1);
    v += (fbm(x * 0.05 + 1, y * 0.05 + 3, s + 3, 5) - 0.5) * 0.62;
    v -= Math.max(0, 1 - boxDist(x, y) / 17) * 1.25;
    const edge = Math.min(x, y, N - 1 - x, N - 1 - y);
    v -= Math.max(0, 1 - edge / 9) * 1.2;
    let e = v;
    if (v > 0) {
      const ridge = ridgeAt(x, y) * (0.85 + fbm(x * 0.08, y * 0.08, s + 4, 3) * 0.7);
      // Gipfel und Täler im Gebirge: gratartiges Rauschen, sonst wird das Gebirge zur flachen Hochebene
      const pk = 1 - Math.abs(fbm(x * 0.085 + 3, y * 0.085 + 5, s + 11, 3) * 2 - 1);
      const rid = 1 - Math.abs(fbm(x * 0.03 + 7, y * 0.03 + 1, s + 5, 4) * 2 - 1);
      const hills = (fbm(x * 0.04 + 9, y * 0.04 + 2, s + 6, 5) - 0.5) * 0.5 + rid * rid * 0.22;
      e = Math.min(v, 0.35) * 0.9 + Math.max(0, hills) + ridge * (0.3 + pk * pk * 1.35) + 0.02;
      for (const [vx, vy, vr] of volcanoes) { const d = Math.hypot(x - vx, y - vy); if (d < vr * 1.6) e = Math.max(e, (1 - d / (vr * 1.6)) * 1.9); }
    }
    E[i] = e;
  }
  // ---------- Südwestinseln (tropisch, eine mit Vulkan) ----------
  const isl = [];
  for (let k = 0; k < 18 && isl.length < 4; k++) {
    const R = r.range(10, 17), x = r.range(22, ARCH - 20), y = r.range(ARCH + 30, N - 22);
    if (isl.some(o => Math.hypot(o[0] - x, o[1] - y) < o[2] + R + 9)) continue;
    let bad = false;
    for (let yy = Math.floor(y - R * 1.7); yy <= y + R * 1.7 && !bad; yy += 3) for (let xx = Math.floor(x - R * 1.7); xx <= x + R * 1.7; xx += 3) if (inb(xx, yy) && E[id(xx, yy)] > -0.15) { bad = true; break; }
    if (!bad) isl.push([x, y, R]);
  }
  if (isl.length) { const big = isl.reduce((a, b) => (b[2] > a[2] ? b : a)); volcanoes.push([big[0], big[1], 6]); }
  const isleMask = new Uint8Array(N * N);
  isl.forEach(([cx, cy, R], k) => {
    for (let y = Math.max(0, Math.floor(cy - R * 1.7)); y < Math.min(N, cy + R * 1.7); y++) for (let x = Math.max(0, Math.floor(cx - R * 1.7)); x < Math.min(N, cx + R * 1.7); x++) {
      if (!free(x, y)) continue;
      const nx = (x - cx) / R, ny = (y - cy) / R;
      if (nx * nx + ny * ny > 2.6) continue;
      let e = islandShape(nx, ny, s + 700 + k * 131) * 0.9;
      for (const [vx, vy, vr] of volcanoes) { const d = Math.hypot(x - vx, y - vy); if (d < vr * 1.6) e = Math.max(e, (1 - d / (vr * 1.6)) * 1.5); }
      E[id(x, y)] = Math.max(E[id(x, y)], e);
      if (e > -0.2) isleMask[id(x, y)] = 1;
    }
  });
  toLevels(E, mask, h);
  // Vulkankegel: steiler Berg mit Krater oben
  for (const [vx, vy, vr] of volcanoes) {
    const cx = Math.round(vx), cy = Math.round(vy), R = Math.max(6, vr);
    for (let dy = -R - 2; dy <= R + 2; dy++) for (let dx = -R - 2; dx <= R + 2; dx++) {
      const x = cx + dx, y = cy + dy; if (!inb(x, y) || !free(x, y)) continue;
      const d = Math.hypot(dx, dy) / R * 8, i = id(x, y);
      if (h[i] < 0 && d > 5.5) continue;
      const want = d < 0.9 ? 6 : d < 2.2 ? 8 : d < 3.4 ? 7 : d < 4.6 ? 5 : d < 5.8 ? 4 : d < 7 ? 3 : d < 8.5 ? 2 : -9;
      if (want > h[i]) h[i] = want;
    }
  }
  // ---------- Fjorde an der kalten Küste ----------
  let od = oceanDist(h);
  const fjord = new Uint8Array(N * N);
  const fjordStarts = [];
  for (let k = 0; k < 900 && fjordStarts.length < 7; k++) {
    const x = r.int(ARCH, N - 30), y = r.int(8, 150), i = id(x, y);
    if (h[i] < 0 || od.dist[i] !== 1 || climate(x, y, s) > 0.3) continue;
    if (fjordStarts.some(([a, b]) => Math.hypot(a - x, b - y) < 15)) continue;
    fjordStarts.push([x, y]);
  }
  for (const [x0, y0] of fjordStarts) {
    // Richtung ins Landesinnere: wo der Abstand zum Meer am stärksten wächst
    let gx = 0, gy = 0;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = x0 + dx, y = y0 + dy; if (inb(x, y)) { const d = od.dist[id(x, y)]; gx += dx * d; gy += dy * d; } }
    let a = Math.atan2(gy, gx), fx = x0, fy = y0;
    const len = r.int(14, 26), cells = [];
    for (let n = 0; n < len; n++) {
      a += r.range(-0.35, 0.35);
      fx += Math.cos(a); fy += Math.sin(a);
      const x = Math.round(fx), y = Math.round(fy);
      if (!inb(x, y) || !free(x, y)) break;
      // nicht auf der anderen Seite durchbrechen
      let ahead = false;
      for (let k = 2; k <= 4 && !ahead; k++) { const ax = Math.round(fx + Math.cos(a) * k), ay = Math.round(fy + Math.sin(a) * k); if (inb(ax, ay) && h[id(ax, ay)] < 0 && od.dist[id(ax, ay)] === 0 && !cells.includes(id(ax, ay))) ahead = true; }
      if (ahead && n > 3) break;
      cells.push(id(x, y));
      if (n < len * 0.35 && r.chance(0.6)) { const sx = Math.round(fx - Math.sin(a)), sy = Math.round(fy + Math.cos(a)); if (inb(sx, sy) && free(sx, sy)) cells.push(id(sx, sy)); }
    }
    cells.forEach((i, n) => { h[i] = n < cells.length * 0.6 ? -2 : -1; fjord[i] = 1; });
    // steile Wände links und rechts
    for (const i of cells) {
      const x = i % N, y = (i / N) | 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy; if (!inb(xx, yy) || !free(xx, yy)) continue;
        const j = id(xx, yy);
        if (h[j] < 0) continue;
        const d = Math.hypot(dx, dy);
        h[j] = Math.max(h[j], d < 1.6 ? 3 : 2 + (r.chance(0.5) ? 1 : 0));
        if (d < 1.6 && r.chance(0.25)) h[j] = 4;
      }
    }
  }
  od = oceanDist(h);
  // ---------- Feuchte ----------
  const M = new Float32Array(N * N), C = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!free(x, y)) continue;
    const i = id(x, y);
    const [dS, side] = segDist(x, y, sp);
    const shadow = side > 0 && y > 120 ? smooth(4, 26, dS) * smooth(120, 200, y) * 0.32 : 0;
    const dc = Math.max(0, od.dist[i]);
    const coast = Math.exp(-dc / 13) * 0.24 + (dc < 6 ? 0.08 : 0);
    const t0 = climate(x, y, s);
    // heißes Landesinnere trocknet aus (Wüsten), das kühle Innere hinter dem Gebirge wird Steppe
    const inland = smooth(8, 30, dc);
    const dry = inland * (smooth(0.62, 0.86, t0) * 0.2 + (side > 0 ? smooth(0.38, 0.5, t0) * (1 - smooth(0.6, 0.7, t0)) * 0.16 : 0));
    M[i] = clamp(fbm(x * 0.019 + 11, y * 0.019 + 5, s + 910, 4) * 1.1 - 0.08 + coast - shadow - dry + (isleMask[i] ? 0.24 : 0), 0, 1);
    C[i] = clamp(t0 - (h[i] >= 3 ? (h[i] - 2) * 0.055 : 0), 0, 1);
  }
  // ---------- Seen und Oasen ----------
  const lakes = [];
  for (let k = 0; k < 1600 && lakes.length < 16; k++) {
    const x = r.int(ARCH - 10, N - 12), y = r.int(10, N - 12), i = id(x, y);
    if (!free(x, y) || h[i] < 1 || h[i] > 2) continue;
    const c = C[i], m = M[i];
    const oasis = c > 0.76 && m < 0.34;
    if (!oasis && (c < 0.14 || c > 0.68 || m < 0.42)) continue;
    const R = oasis ? r.range(1.6, 2.3) : r.range(2.6, 6.2);
    if (od.dist[i] < R + 8) continue;
    if (lakes.some(o => Math.hypot(o[0] - x, o[1] - y) < o[2] + R + 10)) continue;
    if (lakes.filter(o => o[3]).length >= 5 && oasis) continue;
    lakes.push([x, y, R, oasis]);
  }
  const oasisAt = new Uint8Array(N * N);
  for (const [cx, cy, R, oasis] of lakes) {
    const lvl = h[id(cx, cy)];
    for (let y = Math.floor(cy - R - 3); y <= cy + R + 3; y++) for (let x = Math.floor(cx - R - 3); x <= cx + R + 3; x++) {
      if (!inb(x, y) || !free(x, y)) continue;
      const i = id(x, y);
      if (h[i] < 0) continue;
      const d = Math.hypot(x - cx, y - cy) + (fbm(x * 0.3, y * 0.3, s + 40, 2) - 0.5) * 2.2;
      if (d < R) h[i] = d < R - 2.6 ? -2 : -1;
      else if (d < R + 2.2) h[i] = Math.max(1, Math.min(h[i], lvl));
      if (oasis && d < R + 3.2) oasisAt[i] = 1;
    }
  }
  // ---------- Lebensräume ----------
  const bio = T.bio;
  const near = (arr, x, y, rr) => { for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) { const xx = x + dx, yy = y + dy; if (inb(xx, yy) && arr[id(xx, yy)]) return true; } return false; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!free(x, y)) continue;
    const i = id(x, y), l = h[i];
    if (l < 0) { bio[i] = 0; continue; }
    const t = C[i], m = M[i];
    let b = BIO.mild;
    let vol = false;
    for (const [vx, vy, vr] of volcanoes) if (Math.hypot(x - vx, y - vy) < vr * 1.35 + (fbm(x * 0.2, y * 0.2, s + 50, 2) - 0.5) * 4) vol = true;
    if (vol) b = BIO.vulkan;
    else if (oasisAt[i]) b = BIO.oase;
    else if ((l >= 5 && t < 0.42) || (t < 0.1 && l >= 3)) b = BIO.eis;
    else if (t < 0.32 && near(fjord, x, y, 7)) b = BIO.fjord;
    else if (t < 0.17) b = BIO.tundra;
    else if (t < 0.32) b = m > 0.36 ? BIO.taiga : BIO.tundra;
    else if (t < 0.6) b = m < 0.3 ? BIO.steppe : (m > 0.72 && l <= 1) ? BIO.sumpf : m > 0.5 ? BIO.wald : BIO.mild;
    else if (t < 0.74) b = m < 0.3 ? (t > 0.67 ? BIO.savanne : BIO.steppe) : m > 0.66 ? ((l <= 1 && m > 0.84) ? BIO.sumpf : BIO.wald) : BIO.savanne;
    else b = m < 0.36 ? (l >= 3 ? BIO.canyon : (m < 0.22 && l <= 1 && fbm(x * 0.06, y * 0.06, s + 60, 3) > 0.56 ? BIO.salz : BIO.wueste)) : m < 0.56 ? BIO.savanne : (l <= 1 && m > 0.86 && od.dist[i] < 4 ? BIO.sumpf : BIO.tropen);
    bio[i] = b;
  }
  // Rote Schluchten: Tafelberge mit steilen Wänden (Stufen statt sanfter Hügel)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = id(x, y);
    if (bio[i] !== BIO.canyon || h[i] < 0) continue;
    const m = fbm(x * 0.11 + 7, y * 0.11 + 2, s + 12, 2);
    h[i] = m > 0.57 ? 4 : m > 0.47 ? 3 : 2;
  }
  // ---------- Flüsse: von den Bergen bergab ins Meer oder in einen See ----------
  const riv = T.river, rivers = [];
  const fh = i => h[i] * 10 + (E[i] > -1 ? E[i] : 0) * 3;
  const sources = [];
  for (let k = 0; k < 3000 && sources.length < 18; k++) {
    const x = r.int(ARCH, N - 8), y = r.int(8, N - 8), i = id(x, y);
    if (!free(x, y) || h[i] < 3 || h[i] > 5 || M[i] < 0.34 || bio[i] === BIO.eis) continue;
    if (sources.some(([a, b]) => Math.hypot(a - x, b - y) < 16)) continue;
    sources.push([x, y]);
  }
  for (const [sx, sy] of sources) {
    const seen = new Set(), path = [];
    let x = sx, y = sy, ok = false;
    for (let n = 0; n < 260; n++) {
      const i = id(x, y);
      path.push(i); seen.add(i);
      if (h[i] < 0) { ok = true; break; }
      if (riv[i] && n > 0) { ok = true; break; }
      let best = -1, bv = 1e9;
      for (const [dx, dy] of D8) {
        const xx = x + dx, yy = y + dy; if (!inb(xx, yy)) continue;
        const j = id(xx, yy); if (seen.has(j)) continue;
        const v = fh(j) + (dx && dy ? 0.6 : 0) + fbm(xx * 0.4, yy * 0.4, s + 70, 2) * 2.5;
        if (v < bv) { bv = v; best = j; }
      }
      if (best < 0) break;
      x = best % N; y = (best / N) | 0;
    }
    if (!ok || path.length < 14) continue;
    rivers.push(path.filter(i => h[i] >= 0 || i === path[path.length - 1]));
    path.forEach((i, n) => {
      if (h[i] < 0) return;
      riv[i] = Math.min(255, Math.max(riv[i], 30 + n * 2) + (riv[i] ? 40 : 0));
      if (h[i] > 4) h[i] = 4; // Flüsse schneiden Täler
    });
  }
  // ---------- Wald, Fruchtbarkeit, Erz ----------
  const DENSE = { mild: [0.52, 0.57, 0.62], wald: [0.4, 0.48, 0.56], taiga: [0.38, 0.46, 0.55], fjord: [0.42, 0.5, 0.58], tropen: [0.3, 0.4, 0.5], sumpf: [0.5, 0.6, 2], oase: [0.35, 0.55, 2], savanne: [0.64, 2, 2], steppe: [0.72, 2, 2], tundra: [0.76, 2, 2], vulkan: [0.68, 2, 2] };
  const keyOf = Object.keys(BIO);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!free(x, y)) continue;
    const i = id(x, y), l = h[i];
    T.tree[i] = 0; T.fert[i] = 0; T.ore[i] = 0;
    if (l < 0) continue;
    const key = keyOf[bio[i]], B = BIO_FERT[key] ?? 40;
    const f = fbm(x * 0.07 + 40, y * 0.07 + 40, s + 200, 4);
    const dn = DENSE[key];
    if (dn && l >= 1 && l <= 3 && !riv[i]) {
      const g = l === 3 ? f - 0.08 : f;
      T.tree[i] = g > dn[2] ? 3 : g > dn[1] ? 2 : g > dn[0] ? 1 : 0;
    }
    let fe = B + (f - 0.5) * 30 + (l === 1 ? 6 : l === 0 ? -20 : l >= 3 ? -25 : 0);
    if (near(riv, x, y, 2)) fe += 16;
    T.fert[i] = clamp(Math.round(fe), 0, 100);
    if (l >= 3 || key === 'canyon' || key === 'vulkan') {
      const o = fbm(x * 0.15 + 9, y * 0.15 + 3, s + 300, 3) + (key === 'canyon' || key === 'vulkan' ? 0.06 : 0);
      if (o > 0.56) T.ore[i] = clamp(Math.round((o - 0.5) * 900), 30, 220);
    }
  }
  // ---------- Neue Inseln und das Festland anmelden ----------
  const comp = new Int32Array(N * N).fill(-1);
  const list = [];
  for (let i = 0; i < N * N; i++) {
    if (h[i] < 0 || comp[i] >= 0) continue;
    const cid = list.length, st2 = [i];
    comp[i] = cid;
    let area = 0, sx = 0, sy = 0, rep = i, inArch = false;
    while (st2.length) {
      const c = st2.pop(); area++;
      const x = c % N, y = (c / N) | 0;
      sx += x; sy += y;
      if (!free(x, y)) inArch = true;
      if (h[c] > h[rep]) rep = c;
      for (const [dx, dy] of D4) { const xx = x + dx, yy = y + dy; if (!inb(xx, yy)) continue; const j = id(xx, yy); if (h[j] >= 0 && comp[j] < 0) { comp[j] = cid; st2.push(j); } }
    }
    let mx = Math.round(sx / area), my = Math.round(sy / area);
    if (comp[id(mx, my)] !== cid) { mx = rep % N; my = (rep / N) | 0; }
    list.push({ area, cx: mx, cy: my, rx: rep % N, ry: (rep / N) | 0, inArch });
  }
  const fresh = list.filter(c => !c.inArch && c.area >= 70).sort((a, b) => b.area - a.area);
  const nr = new Rng(s ^ 0x51ed27);
  const name = () => { for (let k = 0; k < 40; k++) { const n = placeName(nr, nr.int(0, 3)); if (!taken.has(n)) { taken.add(n); return n; } } return L('Land ', 'Land ') + taken.size; };
  let nextId = isles.reduce((a, I) => Math.max(a, I.id), 0) + 1;
  fresh.forEach((c, k) => {
    isles.push({
      id: nextId++, name: name(), cx: c.cx, cy: c.cy, rx: c.rx, ry: c.ry, area: c.area, nw: 1, cont: k === 0 && c.area > 2000 ? 1 : 0,
      techs: [], research: { cur: null, pts: 0 }, era: 0, contact: {}, seen: {},
    });
  });
  return { rivers, volcanoes: volcanoes.map(([x, y]) => [Math.round(x), Math.round(y)]), lakes: lakes.map(([x, y, R, o]) => [x, y, Math.round(R * 10) / 10, o ? 1 : 0]) };
}

const BIO_FERT = { mild: 58, wald: 56, taiga: 30, tundra: 12, eis: 0, steppe: 44, sumpf: 38, savanne: 34, wueste: 5, tropen: 66, vulkan: 62, salz: 0, canyon: 8, oase: 72, fjord: 26 };

// Landschaften mit Namen (für die Karte und die Entdeckungen): zusammenhängende Flächen gleichen Lebensraums,
// dazu Gebirge und Seen. st.regions = [{ id, b, cx, cy, n, name, by, d }], Kachel → Gegend in st.tiles.reg
export function findRegions(T) {
  const { h, bio } = T;
  const reg = T.reg;
  reg.fill(0);
  const out = [];
  const group = i => (h[i] >= 4 && bio[i] !== BIO.eis ? 100 : bio[i]);
  const seenR = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) {
    if (seenR[i] || h[i] < 0) continue;
    const x0 = i % N, y0 = (i / N) | 0;
    if (!free(x0, y0)) { seenR[i] = 1; continue; }
    const g = group(i), cells = [i];
    seenR[i] = 1;
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k], x = c % N, y = (c / N) | 0;
      for (const [dx, dy] of D4) { const xx = x + dx, yy = y + dy; if (!inb(xx, yy) || !free(xx, yy)) continue; const j = id(xx, yy); if (!seenR[j] && h[j] >= 0 && group(j) === g) { seenR[j] = 1; cells.push(j); } }
    }
    const min = g === 100 ? 40 : g === BIO.oase ? 8 : g === BIO.vulkan ? 20 : 110;
    if (cells.length < min || out.length >= 250) continue;
    let sx = 0, sy = 0;
    for (const c of cells) { sx += c % N; sy += (c / N) | 0; }
    let cx = Math.round(sx / cells.length), cy = Math.round(sy / cells.length);
    if (!cells.includes(id(cx, cy))) { const c = cells[cells.length >> 1]; cx = c % N; cy = (c / N) | 0; }
    const rid = out.length + 1;
    for (const c of cells) reg[c] = rid;
    out.push({ id: rid, b: g === 100 ? 'berge' : Object.keys(BIO)[g], cx, cy, n: cells.length, name: '', by: 0, d: 0 });
  }
  // Seen
  const lakeSeen = new Uint8Array(N * N);
  const oceanMask = oceanDist(h).ocean;
  for (let i = 0; i < N * N; i++) {
    if (h[i] >= 0 || oceanMask[i] || lakeSeen[i]) continue;
    const cells = [i]; lakeSeen[i] = 1;
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k], x = c % N, y = (c / N) | 0;
      for (const [dx, dy] of D4) { const xx = x + dx, yy = y + dy; if (!inb(xx, yy)) continue; const j = id(xx, yy); if (!lakeSeen[j] && h[j] < 0 && !oceanMask[j]) { lakeSeen[j] = 1; cells.push(j); } }
    }
    if (cells.length < 5 || out.length >= 254) continue;
    let sx = 0, sy = 0; for (const c of cells) { sx += c % N; sy += (c / N) | 0; }
    const rid = out.length + 1;
    for (const c of cells) reg[c] = rid;
    out.push({ id: rid, b: 'see', cx: Math.round(sx / cells.length), cy: Math.round(sy / cells.length), n: cells.length, name: '', by: 0, d: 0 });
  }
  return out;
}

// Namen, wie die Entdecker eine Gegend nennen (in ihrer Sprache), Muster je Lebensraum
export function regionName(r, b, base) {
  const P = {
    mild: L([`die Auen von ${base}`, `${base}feld`, `das grüne ${base}`], [`the Meadows of ${base}`, `${base} Fields`, `Green ${base}`]),
    wald: L([`der ${base}wald`, `die Wälder von ${base}`, `der Hain von ${base}`], [`the ${base} Woods`, `the Forests of ${base}`, `the Grove of ${base}`]),
    taiga: L([`die Tannen von ${base}`, `der Nordwald ${base}`, `${base}tann`], [`the Pines of ${base}`, `the ${base} Northwood`, `${base} Taiga`]),
    tundra: L([`die Ödnis von ${base}`, `die kalte Weite ${base}`, `${base}moor`], [`the Barrens of ${base}`, `the Cold Reach of ${base}`, `the ${base} Tundra`]),
    eis: L([`das Eis von ${base}`, `der ${base}gletscher`, `die weiße Mauer`], [`the Ice of ${base}`, `the ${base} Glacier`, `the White Wall`]),
    steppe: L([`die Steppe von ${base}`, `das Grasmeer ${base}`, `die Weite von ${base}`], [`the ${base} Steppe`, `the Grass Sea of ${base}`, `the Plains of ${base}`]),
    sumpf: L([`die Sümpfe von ${base}`, `das ${base}moor`, `das Nebelmoor`], [`the Marshes of ${base}`, `the ${base} Fen`, `the Misty Mire`]),
    savanne: L([`die Savanne von ${base}`, `das Goldgras ${base}`, `die Ebene ${base}`], [`the ${base} Savanna`, `the Goldgrass of ${base}`, `the ${base} Flats`]),
    wueste: L([`die Wüste ${base}`, `die Glutsande von ${base}`, `das Sandmeer ${base}`], [`the ${base} Desert`, `the Burning Sands of ${base}`, `the Sand Sea of ${base}`]),
    tropen: L([`der Dschungel von ${base}`, `der Regenwald ${base}`, `das grüne Dickicht ${base}`], [`the Jungle of ${base}`, `the ${base} Rainforest`, `the Green Tangle of ${base}`]),
    vulkan: L([`der Feuerberg ${base}`, `die Aschefelder von ${base}`, `der rauchende ${base}`], [`Mount ${base}`, `the Ash Fields of ${base}`, `${base} the Smoking`]),
    salz: L([`die Salzpfanne ${base}`, `das weiße Feld von ${base}`, `der Salzsee ${base}`], [`the ${base} Salt Flat`, `the White Field of ${base}`, `the ${base} Salt Pan`]),
    canyon: L([`die roten Schluchten von ${base}`, `die Felsen von ${base}`, `der ${base}canyon`], [`the Red Canyons of ${base}`, `the ${base} Badlands`, `the ${base} Canyon`]),
    oase: L([`die Oase ${base}`, `der Brunnen von ${base}`, `die Palmenquelle ${base}`], [`the Oasis of ${base}`, `the Well of ${base}`, `the Palm Spring of ${base}`]),
    fjord: L([`die Fjorde von ${base}`, `der ${base}fjord`, `das Fjordland ${base}`], [`the Fjords of ${base}`, `the ${base} Fjord`, `the Fjord Land of ${base}`]),
    berge: L([`das ${base}gebirge`, `die Berge von ${base}`, `die ${base}spitzen`], [`the ${base} Mountains`, `the Peaks of ${base}`, `the ${base} Range`]),
    see: L([`der ${base}see`, `der See von ${base}`, `das stille Wasser ${base}`], [`Lake ${base}`, `the Lake of ${base}`, `the Still Water of ${base}`]),
  }[b] || [base];
  return r.pick(P);
}
