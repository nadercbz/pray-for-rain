// Archipel-Erzeugung und Kachel-Helfer. Höhenstufen:
// -2 Tiefsee, -1 Flachwasser, 0 Strand, 1 Tiefland, 2 Hochland, 3 Hügel/Fels, 4 Berg, 5 und 6 Gipfel
import { Rng, fbm, clamp } from './rng.js';
import { MAP, ARCH } from './data.js';
import { placeName } from './names.js';
import { L } from '../i18n.js';
import { growWorld, findRegions } from './continent.js';

// Weltgröße je Welt (seit 19.10.2026): NX Spalten, NY Zeilen. Die Inselwelten sind 320 x 320 (MAP), die echte Erde
// 2048 x 1024. ES Module geben let Exporte live weiter, setWorldSize stellt sie beim Laden oder Erzeugen einer Welt um.
// Im Browser setzt index.html vor dem Start globalThis.PFR_SIZE, damit auch die Darstellung von Anfang an die Größe kennt.
const PRE = typeof globalThis !== 'undefined' && Array.isArray(globalThis.PFR_SIZE) ? globalThis.PFR_SIZE : null;
export let NX = PRE ? PRE[0] : MAP, NY = PRE ? PRE[1] : MAP;
export function setWorldSize(w, h) { NX = w; NY = h; }
const A = ARCH; // der Archipel liegt in A x A oben links, rechts und unten liegt seit 18.10.2026 die neue Welt
export const idx = (x, y) => y * NX + x;
export const inb = (x, y) => x >= 0 && y >= 0 && x < NX && y < NY;
export const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
export const MIN_ISLE = 70; // kleinere Landflecken sind nur Felsen im Meer

// Höhe einer Insel in ihren eigenen Koordinaten (nx, ny in etwa -1..1)
export function islandShape(nx, ny, s) {
  const wx = nx + (fbm(nx * 1.6 + 5, ny * 1.6, s + 11, 4) - 0.5) * 0.55;
  const wy = ny + (fbm(nx * 1.6, ny * 1.6 + 9, s + 13, 4) - 0.5) * 0.55;
  const d = Math.sqrt(wx * wx + wy * wy);
  const base = fbm(nx * 2.4 + 3, ny * 2.4 + 7, s, 5);
  const ridge = 1 - Math.abs(fbm(nx * 2.8 + 1, ny * 2.8 + 2, s + 50, 4) * 2 - 1);
  return (base - 0.5) * 0.95 + 0.46 - d * d * 0.95 - d * 0.32 + ridge * ridge * 0.34 * clamp(1.1 - d, 0, 1);
}

// Inselmittelpunkte: eine große Hauptinsel, dazu ein Kranz kleinerer Inseln
function layout(r) {
  const c = A / 2;
  const main = { x: c + r.range(-6, 6), y: c + r.range(-6, 6), R: r.range(30, 34) };
  const list = [main];
  const n = r.int(4, 5);
  const a0 = r.range(0, Math.PI * 2);
  for (let k = 0; k < n; k++) {
    const R = r.range(11, 19);
    const a = a0 + k * Math.PI * 2 / n + r.range(-0.35, 0.35);
    const dist = main.R + R + r.range(9, 16);
    const x = clamp(main.x + Math.cos(a) * dist, R + 5, A - R - 5);
    const y = clamp(main.y + Math.sin(a) * dist, R + 5, A - R - 5);
    if (list.some(o => Math.hypot(o.x - x, o.y - y) < o.R + R + 7)) continue;
    list.push({ x, y, R });
  }
  return list;
}

// Landhöhen nach Perzentil, damit jede Welt eine gute Mischung hat
const LAND_BANDS = [[0.08, 0], [0.5, 1], [0.73, 2], [0.865, 3], [0.94, 4], [0.978, 5], [1.01, 6]];
function levels(E) {
  const land = [];
  for (let i = 0; i < E.length; i++) if (E[i] >= 0) land.push(E[i]);
  land.sort((a, b) => a - b);
  const cut = LAND_BANDS.map(([q]) => land[Math.min(land.length - 1, Math.floor(q * land.length))]);
  const h = new Int8Array(E.length);
  for (let i = 0; i < E.length; i++) {
    const e = E[i];
    if (e < -0.16) { h[i] = -2; continue; }
    if (e < 0) { h[i] = -1; continue; }
    let l = 6;
    for (let b = 0; b < LAND_BANDS.length; b++) if (e <= cut[b]) { l = LAND_BANDS[b][1]; break; }
    h[i] = l;
  }
  return h;
}

// Neue Welt: erst der Archipel (wie seit dem 16.10.2026, im Feld A x A), dann rundherum die neue Welt (continent.js)
export function generateWorld(seed) {
  setWorldSize(MAP, MAP);
  const N = MAP;
  let best = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const s = (seed + attempt * 7919) >>> 0;
    const r = new Rng(s ^ 0x5bd1e995);
    const lay = layout(r);
    const E = new Float32Array(A * A).fill(-1);
    for (let y = 0; y < A; y++) for (let x = 0; x < A; x++) {
      let e = -1;
      for (let k = 0; k < lay.length; k++) {
        const I = lay[k];
        const nx = (x - I.x) / I.R, ny = (y - I.y) / I.R;
        if (nx * nx + ny * ny > 2.6) continue;
        e = Math.max(e, islandShape(nx, ny, s + k * 101) - (k ? 0.03 : 0));
      }
      E[y * A + x] = e;
    }
    const hA = levels(E);
    const h = new Int8Array(N * N).fill(-2);
    let edgeLand = 0, mountain = 0;
    for (let y = 0; y < A; y++) for (let x = 0; x < A; x++) {
      const l = hA[y * A + x];
      h[idx(x, y)] = l;
      if (l >= 4) mountain++;
      if (l >= 0 && (x < 3 || y < 3 || x > A - 4 || y > A - 4)) edgeLand++;
    }
    const comps = components(h).list.filter(c => c.area >= MIN_ISLE);
    const score = (edgeLand === 0 ? 2 : 0) + (comps.length >= 4 ? 2 : comps.length >= 3 ? 1 : 0) + (mountain > 80 ? 1 : 0);
    if (!best || score > best.score) best = { s, h, score };
    if (score >= 5) break;
  }
  const { s, h } = best;
  const tree = new Uint8Array(N * N), fert = new Uint8Array(N * N), ore = new Uint8Array(N * N);
  for (let y = 0; y < A; y++) for (let x = 0; x < A; x++) {
    const i = idx(x, y), l = h[i];
    const m = fbm(x * 0.07 + 40, y * 0.07 + 40, s + 200, 4);
    if (l === 1 || l === 2) {
      if (m > 0.52) tree[i] = m > 0.62 ? 3 : m > 0.57 ? 2 : 1;
      fert[i] = clamp(Math.round((l === 1 ? 52 : 40) + m * 40), 0, 100);
    } else if (l === 3) {
      if (m > 0.6) tree[i] = 1;
      fert[i] = 15;
    } else if (l === 0) fert[i] = 12;
    if (l >= 3) {
      const o = fbm(x * 0.15 + 9, y * 0.15 + 3, s + 300, 3);
      if (o > 0.56) ore[i] = clamp(Math.round((o - 0.5) * 900), 30, 220);
    }
  }
  for (let y = 0; y < A; y++) for (let x = 0; x < A; x++) {
    const i = idx(x, y);
    if (h[i] === 1 && nearWater(h, x, y, 3)) fert[i] = Math.min(100, fert[i] + 12);
  }
  // Inseln mit Namen
  const r = new Rng(s ^ 0x1234567);
  const used = new Set();
  const uniqueName = () => { for (let k = 0; k < 30; k++) { const n = placeName(r, r.int(0, 3)); if (!used.has(n)) { used.add(n); return n; } } return L('Insel ', 'Island ') + used.size; };
  const isles = components(h).list.filter(c => c.area >= MIN_ISLE).sort((a, b) => b.area - a.area).map((c, k) => ({
    id: k + 1, name: uniqueName(), cx: c.cx, cy: c.cy, rx: c.rx, ry: c.ry, area: c.area,
    techs: [], research: { cur: null, pts: 0 }, era: 0, contact: {}, seen: {},
  }));
  const W = { seed: s, h, tree, fert, ore, road: new Uint8Array(N * N), burn: new Uint8Array(N * N), ruin: new Uint8Array(N * N), isles };
  W.bio = new Uint8Array(N * N); W.river = new Uint8Array(N * N); W.seen = new Uint8Array(N * N); W.reg = new Uint8Array(N * N);
  W.extra = growWorld(W, isles, s, used);
  W.regions = findRegions(W);
  return W;
}

// Alter Spielstand mit kleinerem Raster (bis 18.10.2026: 160 x 160): Kacheln oben links einsetzen, rundherum die neue Welt.
// Koordinaten bleiben gleich, nur gespeicherte Kachelnummern (Straßen) werden umgerechnet.
export function embedTiles(tiles, n0) {
  const N = NX;
  const out = {};
  for (const [k, v] of Object.entries(tiles)) {
    const a = new v.constructor(N * N);
    if (k === 'h') a.fill(-2);
    for (let y = 0; y < Math.min(n0, N); y++) for (let x = 0; x < Math.min(n0, N); x++) a[idx(x, y)] = v[y * n0 + x];
    out[k] = a;
  }
  return out;
}

// Zusammenhängende Landmassen. Liefert Komponenten-Nummer je Kachel und Kennzahlen
export function components(h) {
  const comp = new Int32Array(NX * NY).fill(-1);
  const list = [];
  const stack = [];
  for (let i = 0; i < NX * NY; i++) {
    if (h[i] < 0 || comp[i] >= 0) continue;
    const id = list.length;
    let area = 0, sx = 0, sy = 0, rep = i;
    stack.push(i); comp[i] = id;
    while (stack.length) {
      const c = stack.pop(); area++;
      const x = c % NX, y = (c / NX) | 0;
      sx += x; sy += y;
      if (h[c] > h[rep]) rep = c;
      for (const [dx, dy] of D4) {
        const xx = x + dx, yy = y + dy;
        if (!inb(xx, yy)) continue;
        const j = idx(xx, yy);
        if (h[j] >= 0 && comp[j] < 0) { comp[j] = id; stack.push(j); }
      }
    }
    // Mittelpunkt auf eine Landkachel der Komponente legen
    let mx = Math.round(sx / area), my = Math.round(sy / area);
    if (!inb(mx, my) || comp[idx(mx, my)] !== id) { mx = rep % NX; my = (rep / NX) | 0; }
    list.push({ id, area, cx: mx, cy: my, rx: rep % NX, ry: (rep / NX) | 0 });
  }
  return { comp, list };
}

// Kachel → Insel-ID (0 = Meer oder kleiner Felsen)
export function isleMap(h, isles) {
  const { comp } = components(h);
  const byComp = new Map();
  for (const I of isles) {
    const c = comp[idx(I.rx, I.ry)] >= 0 ? comp[idx(I.rx, I.ry)] : comp[idx(I.cx, I.cy)];
    if (c >= 0) byComp.set(c, I.id);
  }
  const out = new Int16Array(NX * NY);
  for (let i = 0; i < NX * NY; i++) out[i] = comp[i] >= 0 ? (byComp.get(comp[i]) || 0) : 0;
  return out;
}

// Landmassen der Erde je Feld (rt.isleOf in Erdwelten): Komponenten neu bestimmen und über ihr höchstes Feld den
// Einträgen aus st.lands zuordnen (so bleiben die ids auch nach Beben oder Vulkanen gleich)
export function landMap(h, lands) {
  const { comp } = components(h);
  const byComp = new Map();
  for (const Ld of lands) { const c = comp[idx(Ld.rx, Ld.ry)]; if (c >= 0 && !byComp.has(c)) byComp.set(c, Ld.id); }
  const out = new Int16Array(NX * NY);
  for (let i = 0; i < NX * NY; i++) out[i] = comp[i] >= 0 ? (byComp.get(comp[i]) || 0) : 0;
  return out;
}

// Alle Felder einer Uint8 Ebene, die nicht 0 sind, aufsteigend (Brand, Ruinen, Wege). Liest vier Felder auf einmal,
// damit es auch über die 2 Millionen Felder der Erde schnell geht; die Reihenfolge bleibt dieselbe wie Feld für Feld.
export function eachSet(a, fn) {
  if (a.byteOffset % 4 === 0 && a.length % 4 === 0) {
    const w = new Uint32Array(a.buffer, a.byteOffset, a.length >> 2);
    for (let k = 0; k < w.length; k++) if (w[k]) { const b = k << 2; for (let j = b; j < b + 4; j++) if (a[j]) fn(j); }
  } else for (let i = 0; i < a.length; i++) if (a[i]) fn(i);
}

export function nearWater(h, x, y, r) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const xx = x + dx, yy = y + dy;
    if (inb(xx, yy) && h[idx(xx, yy)] < 0) return true;
  }
  return false;
}

export function isCoast(h, x, y) {
  if (!inb(x, y) || h[idx(x, y)] < 0) return false;
  for (const [dx, dy] of D4) {
    const xx = x + dx, yy = y + dy;
    if (inb(xx, yy) && h[idx(xx, yy)] < 0) return true;
  }
  return false;
}

// Typed Arrays für den Speicherstand. Seit 18.10.2026 gepackt (PackBits, Kennzeichen "~" vorn), weil die große Welt
// zu drei Vierteln aus Meer besteht. Alte Stände ohne "~" werden wie bisher gelesen.
const b64 = s => (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64'));
const unb64 = s => (typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary'));
export function encode(arr) {
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  const out = new Uint8Array(u8.length + Math.ceil(u8.length / 128) + 8);
  let o = 0, i = 0;
  while (i < u8.length) {
    let run = 1;
    while (i + run < u8.length && run < 129 && u8[i + run] === u8[i]) run++;
    if (run >= 3) { out[o++] = 126 + run; out[o++] = u8[i]; i += run; continue; }
    let lit = 0;
    while (i + lit < u8.length && lit < 128) {
      if (i + lit + 2 < u8.length && u8[i + lit] === u8[i + lit + 1] && u8[i + lit] === u8[i + lit + 2]) break;
      lit++;
    }
    out[o++] = lit - 1;
    for (let k = 0; k < lit; k++) out[o++] = u8[i + k];
    i += lit;
  }
  let s = '';
  for (let k = 0; k < o; k += 0x8000) s += String.fromCharCode.apply(null, out.subarray(k, Math.min(o, k + 0x8000)));
  return '~' + u8.length + ':' + b64(s);
}

export function decode(str, Type = Uint8Array) {
  if (str[0] === '~') {
    const c = str.indexOf(':'), len = +str.slice(1, c), bin = unb64(str.slice(c + 1));
    const u8 = new Uint8Array(len);
    let o = 0, i = 0;
    while (i < bin.length && o < len) {
      const n = bin.charCodeAt(i++);
      if (n >= 128) { const v = bin.charCodeAt(i++); u8.fill(v, o, o + n - 126); o += n - 126; }
      else { for (let k = 0; k <= n; k++) u8[o++] = bin.charCodeAt(i++); }
    }
    return new Type(u8.buffer);
  }
  const bin = unb64(str);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Type(u8.buffer);
}

// A* mit Binärheap. Auf Land (Laufwege) oder auf Wasser (Seewege, sea = true)
// extra(j): optionale Zusatzkosten je Feld (Infinity sperrt), z. B. Häuser meiden und Straßen bevorzugen
// Seit 19.10.2026 mit Feldern statt Maps (einmal angelegt, nach der Suche werden nur berührte Kacheln zurückgesetzt);
// Ergebnis wie vorher, aber auf der Erde mit 2 Millionen Feldern deutlich schneller
let FP = null;
export function findPath(h, x0, y0, x1, y1, maxIter = 6000, sea = false, extra = null) {
  if (x0 === x1 && y0 === y1) return [[x0, y0]];
  const start = idx(x0, y0), goal = idx(x1, y1), n = NX * NY;
  if (!FP || FP.n !== n) FP = { n, g: new Float64Array(n).fill(Infinity), came: new Int32Array(n).fill(-1) };
  const G = FP.g, C = FP.came, touched = [start];
  G[start] = 0;
  const done = r => { for (const j of touched) { G[j] = Infinity; C[j] = -1; } return r; };
  const g = { get: j => G[j] }, came = { get: j => (C[j] < 0 ? undefined : C[j]) };
  const heap = [[0, start]];
  const push = (f, n) => {
    heap.push([f, n]);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  const ok = j => (sea ? h[j] < 0 : h[j] >= 0) || j === goal;
  let iter = 0;
  while (heap.length && iter++ < maxIter) {
    const [, cur] = pop();
    if (cur === goal) {
      const path = [];
      let c = cur;
      while (c !== undefined) { path.push([c % NX, (c / NX) | 0]); c = came.get(c); }
      return done(path.reverse());
    }
    const cx = cur % NX, cy = (cur / NX) | 0, gc = g.get(cur);
    for (const [dx, dy] of D8) {
      const xx = cx + dx, yy = cy + dy;
      if (!inb(xx, yy)) continue;
      const j = idx(xx, yy);
      if (!ok(j)) continue;
      if (dx && dy && (!ok(idx(cx + dx, cy)) || !ok(idx(cx, cy + dy)))) continue;
      let cost = dx && dy ? 1.414 : 1;
      if (!sea) cost += Math.abs(h[j] - h[cur]) * 0.8;
      else if (h[j] === -1) cost += 0.4; // tiefes Wasser ist schöner für Schiffe
      if (extra && j !== goal) { const e = extra(j); if (e === Infinity) continue; cost = Math.max(0.3, cost + e); }
      const ng = gc + cost;
      if (ng < G[j]) {
        if (G[j] === Infinity) touched.push(j);
        G[j] = ng; C[j] = cur;
        push(ng + Math.hypot(x1 - xx, y1 - yy), j);
      }
    }
  }
  return done(null);
}

// Erde (seit 19.10.2026): Baustufe je Feld. Im Spiel ist ab Stufe 4 Gebirge, auf der echten Erde liegen aber flache
// Hochebenen höher (Mexiko, Äthiopien, Iran, Ostafrika, Atlas). Flaches Land bis Stufe 7 (3400 m) zählt beim Bauen,
// Siedeln und Wandern darum wie Hügelland: höchstens eine Stufe Unterschied ringsum = 2, zwei Stufen = 3, sonst Gebirge.
export function buildLevels(h, W, H) {
  const hb = Int8Array.from(h);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, l = h[i];
    if (l < 4 || l > 7) continue;
    let r = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const lj = h[yy * W + xx]; if (lj >= 0) r = Math.max(r, Math.abs(lj - l));
    }
    if (r <= 1) hb[i] = 2; else if (r === 2) hb[i] = 3;
  }
  return hb;
}
