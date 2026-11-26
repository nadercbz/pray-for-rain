// Die echte Erde als Spielwelt (seit 19.10.2026, Plan in PLAN_ERDE.md, Daten aus tools/earth/build_earth.py).
// 2048 mal 1024 Felder, rund 20 km je Feld, Nahtstelle der Karte in der Beringstraße (Länge minus 169 Grad), Nordpol oben.
// Hier: Laden der Erddaten (Browser per fetch und DecompressionStream, Node per fs und zlib), der Weltbau (Gelände,
// Lebensräume, Flüsse, Seen, Gegenden mit echten Namen, Vulkane, Stätten, Landmassen) und die Wahl der Startplätze
// für die acht Völker. Reines JavaScript ohne DOM und ohne Math.random: gleiche Daten plus gleicher Seed = gleiche Erde.
import { fbm, clamp } from './rng.js';
import { BIOMES, BIO } from './data.js';
import { L } from '../i18n.js';
import { buildLevels } from './world.js';

export let EARTH = null;          // { meta, h, bio, elev, reg, lake, river, cont, W, H }
let loading = null;

const isNode = typeof window === 'undefined' && typeof process !== 'undefined' && !!(process.versions && process.versions.node);
const SIZE = 2048;
const TYPES = { int8: Int8Array, uint8: Uint8Array, int16: Int16Array, uint16: Uint16Array };

// Erddaten einmal laden (beide Dateien zusammen rund 3,8 MB, entpackt rund 14 MB)
export function loadEarth() {
  if (EARTH) return Promise.resolve(EARTH);
  if (!loading) loading = (isNode ? loadNode() : loadBrowser()).then(e => (EARTH = inland(e))).catch(err => { loading = null; throw err; });
  return loading;
}

// Stufe 0 (unter 60 m) ist im Spiel Strand: keine Bäume, Sandfarbe. Auf der Erde liegt aber viel Tiefland so tief
// (Amazonas, Mesopotamien, Bengalen, Niederlande). Alles, was mehr als 2 Felder vom Meer entfernt ist, wird Stufe 1.
function inland(E) {
  const { W, H, h, lake } = E, n = W * H, d = new Uint8Array(n).fill(255);
  let cur = [];
  for (let i = 0; i < n; i++) if (h[i] < 0 && !lake[i]) { d[i] = 0; cur.push(i); }
  for (let step = 1; step <= 2; step++) {
    const nxt = [];
    for (const i of cur) {
      const x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        const j = yy * W + ((x + dx + W) % W);
        if (d[j] > step) { d[j] = step; nxt.push(j); }
      }
    }
    cur = nxt;
  }
  for (let i = 0; i < n; i++) if (h[i] === 0 && d[i] > 2) h[i] = 1;
  E.hb = buildLevels(h, W, H); // Baustufe (flache Hochebenen wie Hügelland), gleich wie rt.hb im Spiel
  return E;
}

async function loadNode() {
  const fs = await import('node:fs'), zlib = await import('node:zlib'), { fileURLToPath } = await import('node:url');
  const dir = fileURLToPath(new URL('../../assets/earth/', import.meta.url));
  const meta = JSON.parse(fs.readFileSync(dir + `earth_${SIZE}.json`, 'utf8'));
  const blob = fs.readFileSync(dir + `earth_${SIZE}.bin`);
  const out = { meta, W: meta.W, H: meta.H };
  for (const [k, [o, n, t]] of Object.entries(meta.layers)) {
    const raw = zlib.inflateSync(blob.subarray(o, o + n));
    out[k] = new TYPES[t](raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  }
  return out;
}

async function loadBrowser() {
  const base = new URL('../../assets/earth/', import.meta.url);
  const [meta, blob] = await Promise.all([
    fetch(new URL(`earth_${SIZE}.json`, base)).then(r => { if (!r.ok) throw new Error('earth json ' + r.status); return r.json(); }),
    fetch(new URL(`earth_${SIZE}.bin`, base)).then(r => { if (!r.ok) throw new Error('earth bin ' + r.status); return r.arrayBuffer(); }),
  ]);
  const out = { meta, W: meta.W, H: meta.H };
  await Promise.all(Object.entries(meta.layers).map(async ([k, [o, n, t]]) => {
    const stream = new Blob([new Uint8Array(blob, o, n)]).stream().pipeThrough(new DecompressionStream('deflate'));
    out[k] = new TYPES[t](await new Response(stream).arrayBuffer());
  }));
  return out;
}

// ---------- Koordinaten ----------
export const kmPerTile = () => (EARTH ? EARTH.meta.kmPerTile : 19.57);
export function lonLat(x, y) {
  const E = EARTH, W = E ? E.W : SIZE, H = E ? E.H : SIZE / 2, lon0 = E ? E.meta.lon0 : -169;
  let lon = lon0 + (x + 0.5) / W * 360;
  if (lon > 180) lon -= 360;
  return [lon, 90 - (y + 0.5) / H * 180];
}
export function tileOf(lon, lat) {
  const E = EARTH, W = E ? E.W : SIZE, H = E ? E.H : SIZE / 2, lon0 = E ? E.meta.lon0 : -169;
  return [Math.floor((((lon - lon0) % 360) + 360) % 360 / 360 * W), Math.floor((90 - lat) / 180 * H)];
}
// Entfernung zweier Felder in km (die Karte ist flächentreu in der Länge nur am Äquator, darum über die Breite gerechnet)
export function kmBetween(x0, y0, x1, y1) {
  const [lo0, la0] = lonLat(x0, y0), [lo1, la1] = lonLat(x1, y1), R = 6371, rad = Math.PI / 180;
  const a = Math.sin((la1 - la0) * rad / 2) ** 2 + Math.cos(la0 * rad) * Math.cos(la1 * rad) * Math.sin((lo1 - lo0) * rad / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
export function lonLatText(x, y) {
  const [lo, la] = lonLat(x, y);
  return `${Math.abs(la).toFixed(1)}° ${la >= 0 ? L('N', 'N') : L('S', 'S')}, ${Math.abs(lo).toFixed(1)}° ${lo >= 0 ? L('O', 'E') : L('W', 'W')}`;
}

// Klima in Worten aus Breite und Höhe (für die Wahl des Startorts)
export function climateText(x, y) {
  const E = EARTH, i = y * E.W + x, la = Math.abs(lonLat(x, y)[1]), m = E.elev[i];
  const t = 27 - Math.max(0, la - 12) * 0.62 - Math.max(0, m) * 0.0062;
  const word = t > 22 ? L('heiß', 'hot') : t > 14 ? L('warm', 'warm') : t > 6 ? L('gemäßigt', 'temperate') : t > -4 ? L('kühl', 'cool') : L('eisig', 'icy');
  return `${word}, ${L('Jahresmittel um', 'mean around')} ${Math.round(t)} °C, ${m > 0 ? Math.round(m) + ' m' : L('Meereshöhe', 'sea level')}`;
}

// ---------- Weltbau ----------
// Lebensraum Kennwerte für Wald und Fruchtbarkeit (wie in continent.js, damit die Erde wie die alte neue Welt wächst)
const DENSE = { mild: [0.52, 0.57, 0.62], wald: [0.4, 0.48, 0.56], taiga: [0.38, 0.46, 0.55], fjord: [0.42, 0.5, 0.58], tropen: [0.3, 0.4, 0.5], sumpf: [0.5, 0.6, 2], oase: [0.35, 0.55, 2], savanne: [0.64, 2, 2], steppe: [0.72, 2, 2], tundra: [0.76, 2, 2], vulkan: [0.68, 2, 2] };
const BIO_FERT = { mild: 58, wald: 56, taiga: 30, tundra: 12, eis: 0, steppe: 44, sumpf: 38, savanne: 34, wueste: 5, tropen: 66, vulkan: 62, salz: 0, canyon: 8, oase: 72, fjord: 26 };
const KEYS = BIOMES.map(b => b.key);
// Gegendarten aus Natural Earth zu den Gegendarten des Spiels (st.regions[].b)
const CLA = { 'Range/mtn': 'berge', Foothills: 'berge', Desert: 'wueste', Wetlands: 'sumpf', Delta: 'sumpf', Tundra: 'tundra' };

// Berühmte Inseln bekommen ihren echten Namen (Natural Earth Gegenden enthalten keine Inseln)
const ISLANDS = [
  ['Grönland', 'Greenland', -41, 74], ['Madagaskar', 'Madagascar', 46.8, -19], ['Großbritannien', 'Great Britain', -2, 53.5], ['Irland', 'Ireland', -8, 53.3],
  ['Island', 'Iceland', -18.6, 64.9], ['Honshu', 'Honshu', 138.5, 36.5], ['Hokkaido', 'Hokkaido', 142.8, 43.4], ['Kyushu', 'Kyushu', 131, 32.6],
  ['Borneo', 'Borneo', 114, 1], ['Sumatra', 'Sumatra', 101.5, 0], ['Java', 'Java', 110, -7.4], ['Sulawesi', 'Sulawesi', 120.5, -2],
  ['Neuguinea', 'New Guinea', 142, -5.5], ['Nordinsel', 'North Island', 175.8, -38.5], ['Südinsel', 'South Island', 170.5, -43.8],
  ['Tasmanien', 'Tasmania', 146.6, -42], ['Sri Lanka', 'Sri Lanka', 80.7, 7.8], ['Kuba', 'Cuba', -79, 21.7], ['Hispaniola', 'Hispaniola', -71, 19],
  ['Sizilien', 'Sicily', 14.2, 37.5], ['Sardinien', 'Sardinia', 9, 40], ['Korsika', 'Corsica', 9.1, 42.1], ['Kreta', 'Crete', 24.9, 35.2],
  ['Zypern', 'Cyprus', 33.2, 35], ['Taiwan', 'Taiwan', 121, 23.7], ['Hainan', 'Hainan', 109.8, 19.2], ['Sachalin', 'Sakhalin', 142.8, 50.5],
  ['Luzon', 'Luzon', 121, 16], ['Mindanao', 'Mindanao', 125, 7.6], ['Neufundland', 'Newfoundland', -56, 48.8], ['Vancouver Island', 'Vancouver Island', -125.7, 49.6],
  ['Baffininsel', 'Baffin Island', -71, 68], ['Victoria-Insel', 'Victoria Island', -110, 71], ['Ellesmere-Insel', 'Ellesmere Island', -80, 79.5],
  ['Spitzbergen', 'Svalbard', 16, 78.7], ['Nowaja Semlja', 'Novaya Zemlya', 56, 74], ['Feuerland', 'Tierra del Fuego', -68.5, -54], ['Jamaika', 'Jamaica', -77.3, 18.1],
  ['Puerto Rico', 'Puerto Rico', -66.5, 18.2], ['Timor', 'Timor', 125.5, -9], ['Neukaledonien', 'New Caledonia', 165.5, -21.4], ['Fidschi', 'Fiji', 178, -17.8],
  ['Hawaii', 'Hawaii', -155.5, 19.6], ['Banks-Insel', 'Banks Island', -121.5, 72.8], ['Devon-Insel', 'Devon Island', -87, 75.2], ['Southampton-Insel', 'Southampton Island', -84.5, 64.5],
];

// Baut die Erde als Weltobjekt im Format von generateWorld (world.js), plus Landmassen und Erdlisten.
// Völker und Startort setzt core.js (createEarthWorld), sobald der Spieler gewählt hat.
export function generateEarth(seed) {
  const E = EARTH;
  if (!E) throw new Error('Erde nicht geladen (loadEarth)');
  const W = E.W, H = E.H, n = W * H, s = seed >>> 0;
  const h = Int8Array.from(E.h), bio = Uint8Array.from(E.bio);
  const tree = new Uint8Array(n), fert = new Uint8Array(n), ore = new Uint8Array(n);
  const river = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (E.river[i]) river[i] = 30 + E.river[i] * 30; // Rang 1 (Amazonas, Nil) = 240, Rang 7 = 60
  // Wald, Fruchtbarkeit, Erz aus Lebensraum, Höhe und Flussnähe
  const nearRiver = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (river[i]) {
    const x = i % W, y = (i / W) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = y + dy; if (yy >= 0 && yy < H) nearRiver[yy * W + ((x + dx + W) % W)] = 1; }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, l = h[i];
    if (l < 0) continue;
    const key = KEYS[bio[i]], B = BIO_FERT[key] ?? 40;
    const f = fbm(x * 0.07 + 40, y * 0.07 + 40, s + 200, 4);
    const dn = DENSE[key];
    // Wald bis in mittlere Höhen (Alpen, Anden, Äthiopien tragen Wald bis rund 2500 m, darüber kahl)
    if (dn && l >= 1 && l <= 5 && !river[i]) {
      const g = f - Math.max(0, l - 2) * 0.07;
      tree[i] = g > dn[2] ? 3 : g > dn[1] ? 2 : g > dn[0] ? 1 : 0;
    }
    let fe = B + (f - 0.5) * 30 + (l === 1 ? 6 : l === 0 ? -20 : l >= 5 ? -35 : l >= 3 ? -18 : 0);
    if (nearRiver[i]) fe += 16;
    fert[i] = clamp(Math.round(fe), 0, 100);
    if (l >= 3 || key === 'canyon' || key === 'vulkan') {
      const o = fbm(x * 0.15 + 9, y * 0.15 + 3, s + 300, 3) + (key === 'canyon' || key === 'vulkan' ? 0.06 : 0);
      if (o > 0.56) ore[i] = clamp(Math.round((o - 0.5) * 900), 30, 220);
    }
  }
  const { reg, regions } = buildRegions(E, h, bio);
  const lands = buildLands(E, h);
  const rivers = [], riverRank = [];
  for (const r of E.meta.rivers) { if (r.path.length >= 2) { rivers.push(r.path.slice()); riverRank.push(r.rank); } }
  const volc = E.meta.volcanoes.map(v => [v.x, v.y]);
  return {
    seed: s, W, H, h, tree, fert, ore, bio, river, reg,
    road: new Uint8Array(n), burn: new Uint8Array(n), ruin: new Uint8Array(n), seen: new Uint8Array(n),
    regions, lands: lands.list, landOf: lands.map, rivers, riverRank, volc, lakes: [],
  };
}

// Gegenden mit echten Namen: Natural Earth Gegenden (Land) und Seen (Wasser), fortlaufend nummeriert (st.regions[id - 1]).
// name bleibt leer, bis ein Volk die Gegend entdeckt und ihr einen Namen in seiner Sprache gibt.
function buildRegions(E, h, bio) {
  const W = E.W, H = E.H, n = W * H, meta = E.meta;
  const map = new Map(), regions = [];
  const sum = new Map();
  for (let i = 0; i < n; i++) {
    const r = E.reg[i];
    if (!r || h[i] < 0) continue;
    let a = sum.get(r);
    if (!a) sum.set(r, a = { n: 0, sx: 0, sy: 0, b: new Uint32Array(BIOMES.length), cells: 0 });
    a.n++; a.sx += i % W; a.sy += (i / W) | 0; a.b[bio[i]]++;
  }
  for (const g of meta.regions) {
    const a = sum.get(g.id);
    if (!a || a.n < 3) continue;
    let best = 0; for (let k = 1; k < a.b.length; k++) if (a.b[k] > a.b[best]) best = k;
    let b = CLA[g.cla] || KEYS[best];
    if (g.cla === 'Desert' && KEYS[best] === 'salz') b = 'salz';
    if (g.cla === 'Delta' && KEYS[best] === 'oase') b = 'oase';
    const id = regions.length + 1;
    map.set(g.id, id);
    regions.push({ id, b, cx: Math.round(a.sx / a.n), cy: Math.round(a.sy / a.n), n: a.n, name: '', by: 0, d: 0, de: g.de, en: g.en, cla: g.cla, rank: g.rank });
  }
  // Seen (Wasserfelder), Rang wie in Natural Earth (0 = Kaspisches Meer, Viktoriasee, Baikal)
  const lsum = new Map();
  for (let i = 0; i < n; i++) {
    const r = E.lake[i];
    if (!r) continue;
    let a = lsum.get(r);
    if (!a) lsum.set(r, a = { n: 0, sx: 0, sy: 0 });
    a.n++; a.sx += i % W; a.sy += (i / W) | 0;
  }
  const lmap = new Map();
  for (const g of meta.lakes) {
    const a = lsum.get(g.id);
    if (!a || a.n < 2) continue;
    const id = regions.length + 1;
    lmap.set(g.id, id);
    regions.push({ id, b: 'see', cx: Math.round(a.sx / a.n), cy: Math.round(a.sy / a.n), n: a.n, name: '', by: 0, d: 0, de: g.de, en: g.en, cla: 'Lake', rank: g.rank });
  }
  const reg = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    if (h[i] >= 0) { const r = E.reg[i]; if (r) reg[i] = map.get(r) || 0; }
    else if (E.lake[i]) reg[i] = lmap.get(E.lake[i]) || 0;
  }
  return { reg, regions };
}

// Zusammenhängende Landmassen (Vierer-Nachbarschaft). Kleine Felsen unter 30 Feldern zählen nicht.
// Namen: Festländer nach ihren Kontinenten (Afrika, Europa und Asien hängen zusammen), Inseln mit echtem Namen,
// sonst "Insel vor ...". rt.isleOf zeigt in der Erde auf diese Landmassen, das Wissen gehört den Völkern.
export function buildLands(E, h) {
  const W = E.W, H = E.H, n = W * H, conts = E.meta.continents;
  const comp = new Int32Array(n).fill(-1), stack = new Int32Array(n);
  const raw = [];
  for (let i0 = 0; i0 < n; i0++) {
    if (h[i0] < 0 || comp[i0] >= 0) continue;
    const id = raw.length;
    let sp = 0, area = 0, sx = 0, sy = 0, rep = i0;
    const cc = new Uint32Array(conts.length + 1);
    stack[sp++] = i0; comp[i0] = id;
    while (sp) {
      const c = stack[--sp]; area++;
      const x = c % W, y = (c / W) | 0;
      sx += x; sy += y; cc[E.cont[c]]++;
      if (h[c] > h[rep]) rep = c;
      // links und rechts über die Nahtstelle hinweg (Tschukotka und Alaska trennt ohnehin Meer)
      const nb = [y * W + (x + 1) % W, y * W + (x + W - 1) % W, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1];
      for (const j of nb) if (j >= 0 && h[j] >= 0 && comp[j] < 0) { comp[j] = id; stack[sp++] = j; }
    }
    raw.push({ area, cx: Math.round(sx / area), cy: Math.round(sy / area), rx: rep % W, ry: (rep / W) | 0, cc });
  }
  const map = new Int16Array(n), list = [];
  const keep = raw.map(() => 0);
  raw.forEach((c, k) => { if (c.area >= 30) keep[k] = 1; });
  // Reihenfolge nach Größe, ids ab 1
  const order = raw.map((c, k) => k).filter(k => keep[k]).sort((a, b) => raw[b].area - raw[a].area);
  const idOf = new Int32Array(raw.length);
  order.forEach((k, j) => { idOf[k] = j + 1; });
  const named = new Map();
  for (const [de, en, lo, la] of ISLANDS) {
    const [x, y] = tileOf(lo, la);
    let found = -1;
    for (let r = 0; r <= 4 && found < 0; r++) for (let dy = -r; dy <= r && found < 0; dy++) for (let dx = -r; dx <= r; dx++) {
      const yy = y + dy; if (yy < 0 || yy >= H) continue;
      const j = yy * W + ((x + dx + W) % W);
      if (comp[j] >= 0 && keep[comp[j]] && raw[comp[j]].area < 30000) { found = comp[j]; break; }
    }
    if (found >= 0 && !named.has(found)) named.set(found, { de, en });
  }
  for (const k of order) {
    const c = raw[k], id = idOf[k];
    const share = [];
    for (let q = 1; q < c.cc.length; q++) if (c.cc[q] > c.area * 0.06) share.push(q);
    share.sort((a, b) => c.cc[b] - c.cc[a]);
    let main = 0; for (let q = 1; q < c.cc.length; q++) if (c.cc[q] > c.cc[main]) main = q;
    const cont = conts.find(o => o.id === main);
    let de, en;
    if (named.has(k)) ({ de, en } = named.get(k));
    else if (c.area > 20000 && share.length > 1) {
      const names = share.map(q => conts.find(o => o.id === q));
      de = names.map(o => o.de).join(', ').replace(/, ([^,]*)$/, ' und $1');
      en = names.map(o => o.en).join(', ').replace(/, ([^,]*)$/, ' and $1');
    } else if (c.area > 20000 && cont) ({ de, en } = cont);
    else { de = cont ? `Insel vor ${cont.de}` : 'Insel'; en = cont ? `Island off ${cont.en}` : 'Island'; }
    list.push({ id, area: c.area, cx: c.cx, cy: c.cy, rx: c.rx, ry: c.ry, cont: main, de, en, big: c.area > 2500 ? 1 : 0 });
  }
  for (let i = 0; i < n; i++) if (comp[i] >= 0 && keep[comp[i]]) map[i] = idOf[comp[i]];
  return { list, map };
}

// ---------- Startplätze ----------
// Eignung eines Feldes als Ort der ersten Siedlung (für die Karte bei der Wahl und für die Völker).
// Liefert den nächsten guten Bauplatz in bis zu 9 Feldern (Asni selbst liegt auf rund 2000 m, die Siedlung rückt an
// den Fuß des Atlas) oder einen Grund, warum hier niemand beginnen kann.
export function startCheck(x, y) {
  const E = EARTH, W = E.W, H = E.H;
  if (y < 0 || y >= H) return { ok: false, why: L('Außerhalb der Welt', 'Outside the world') };
  x = ((x % W) + W) % W;
  const i = y * W + x, l = E.h[i], key = KEYS[E.bio[i]];
  if (l < 0) return { ok: false, why: E.lake[i] ? L('Ein See. Wähle Land am Ufer.', 'A lake. Pick land on its shore.') : L('Meer. Wähle Land.', 'Sea. Pick land.') };
  if (key === 'eis') return { ok: false, why: L('Ewiges Eis. Hier kann niemand leben.', 'Eternal ice. No one can live here.') };
  if (Math.abs(lonLat(x, y)[1]) > 66) return { ok: false, why: L('Zu nah am Pol. Der Winter dauert fast das ganze Jahr.', 'Too close to the pole. Winter lasts almost all year.') };
  let best = null, bs = -1e9;
  for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) {
    const d = Math.hypot(dx, dy); if (d > 9) continue;
    const yy = y + dy; if (yy < 2 || yy >= H - 2) continue;
    const xx = (x + dx + W) % W, j = yy * W + xx, lj = E.hb[j];
    if (lj < 1 || lj > 3) continue;
    const B = BIOMES[E.bio[j]];
    if (!B.live) continue;
    let flat = 0, water = 0, land = 0;
    for (let ky = -2; ky <= 2; ky++) for (let kx = -2; kx <= 2; kx++) {
      const yk = yy + ky, k = yk * W + ((xx + kx + W) % W);
      if (E.h[k] < 0) water++; else { land++; if (Math.abs(E.hb[k] - lj) <= 1) flat++; }
    }
    if (land < 12) continue;
    const food = gatherAt(xx, yy);
    const sc = B.live * B.fert / 20 + flat * 0.25 - (lj - 1) * 0.6 + (E.river[j] ? 1.2 : 0) + (water > 0 && water < 10 ? 0.8 : 0) - d * 0.55 + Math.min(food, 40) * 0.05;
    if (sc > bs) { bs = sc; best = [xx, yy]; }
  }
  if (!best) {
    if (l >= 6) return { ok: false, why: L('Hochgebirge. In der Nähe gibt es keinen Platz für ein Dorf.', 'High mountains. There is no room for a village nearby.') };
    if (key === 'wueste' || key === 'salz') return { ok: false, why: L('Tiefe Wüste. Ohne Wasser in der Nähe stirbt jedes Dorf.', 'Deep desert. Without water nearby every village dies.') };
    return { ok: false, why: L('Hier findet sich kein Platz für ein Dorf.', 'There is no room for a village here.') };
  }
  const j = best[1] * W + best[0];
  const rid = regionAt(best[0], best[1]);
  const food = gatherAt(best[0], best[1]);
  return {
    ok: true, x: best[0], y: best[1], moved: best[0] !== x || best[1] !== y,
    bio: KEYS[E.bio[j]], bioName: BIOMES[E.bio[j]].name, region: rid, cont: E.cont[j],
    climate: climateText(best[0], best[1]), elev: E.elev[j], hard: BIOMES[E.bio[j]].live < 0.5 || food < 22, food,
  };
}

// Was Sammler und Jäger in der Nähe finden (Wald, Flüsse) im Umkreis von 7 Feldern, grob ohne Seed:
// Waldlebensräume in Tief- und Hügelland zählen 1, Flussfelder 3 (Fisch, Schilf, Wild am Wasser)
const WOODY = new Set(['mild', 'wald', 'taiga', 'fjord', 'tropen', 'sumpf', 'oase']);
export function gatherAt(x, y) {
  const E = EARTH, W = E.W;
  let f = 0;
  for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
    const yy = y + dy; if (yy < 0 || yy >= E.H) continue;
    const j = yy * W + ((x + dx + W) % W);
    if (E.h[j] < 1) continue;
    if (E.river[j]) f += 3;
    if (E.h[j] <= 5 && WOODY.has(KEYS[E.bio[j]])) f += 1;
  }
  return f;
}

// Name der echten Gegend an einem Feld (Land) oder null
export function regionAt(x, y) {
  const E = EARTH, r = E.reg[y * E.W + x];
  if (!r) return null;
  const g = E.meta.regions.find(o => o.id === r);
  return g ? L(g.de, g.en) : null;
}
export const contName = id => { const c = EARTH && EARTH.meta.continents.find(o => o.id === id); return c ? L(c.de, c.en) : ''; };

// Gute Startplätze je Kontinent: zuerst die aus build_earth.py (die Wiegen der Zivilisation), dazu ein dichteres Netz
// aus derselben Bewertung (für Orte, die der Spieler wählt, und als Rückfall)
let SPOTS = null;
export function earthSpots() {
  if (SPOTS) return SPOTS;
  const E = EARTH, W = E.W, H = E.H, out = E.meta.startSpots.map(sp => ({ ...sp, prime: 1, food: gatherAt(sp.x, sp.y) }));
  const cand = [];
  for (let y = 40; y < H - 40; y += 6) for (let x = 0; x < W; x += 6) {
    const i = y * W + x, l = E.hb[i];
    if (l < 1 || l > 3 || Math.abs(lonLat(x, y)[1]) > 60) continue;
    const B = BIOMES[E.bio[i]];
    if (!B.live) continue;
    let riv = 0, sea = 0, ok = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const j = (y + dy) * W + ((x + dx + W) % W);
      if (E.river[j]) riv = 1;
      if (E.h[j] < 0) sea = 1; else if (E.hb[j] <= 3) ok++;
    }
    if (ok < 30) continue;
    cand.push({ cont: E.cont[i], x, y, score: B.live * B.fert / 60 + riv * 0.35 + sea * 0.15 - (l - 1) * 0.1, bio: KEYS[E.bio[i]], food: gatherAt(x, y) });
  }
  cand.sort((a, b) => b.score - a.score);
  for (const c of cand) {
    if (out.some(o => o.cont === c.cont && Math.hypot(o.x - c.x, o.y - c.y) < 70)) continue;
    if (out.filter(o => o.cont === c.cont).length >= 22) continue;
    out.push(c);
  }
  return (SPOTS = out);
}

// Die sieben anderen Völker (Naders Wunsch 19.10.2026): je eines auf Europa, Asien, Afrika, Nordamerika, Südamerika,
// Australien und ein zweites in Asien (größter Kontinent). Auf dem Kontinent des Spielers mindestens 300 Felder Abstand,
// sonst mindestens 200 zum Spieler und 150 untereinander. Findet ein Kontinent keinen Platz, kommt das Volk auf einen
// anderen großen Kontinent. Liefert [{ x, y, cont }], ohne Zufall (gleicher Startort = gleiche Nachbarn).
const ORDER = [6, 5, 3, 7, 1, 2, 5]; // Europa, Asien, Afrika, Nordamerika, Südamerika, Australien, Asien
const BIG = [5, 3, 7, 1, 6];
export function folkSpots(px, py) {
  const E = EARTH, pc = E.cont[py * E.W + px];
  const spots = earthSpots();
  const placed = [];
  // ein Volk braucht Wald oder einen Fluss zum Überleben, bevor es Felder kennt (Wüstenoasen ohne Umland verhungern)
  const okAt = (sp, rp, rf) => (sp.food ?? 99) >= 30 && Math.hypot(sp.x - px, sp.y - py) >= (sp.cont === pc ? Math.max(rp, 300) : rp) && placed.every(o => Math.hypot(o.x - sp.x, o.y - sp.y) >= rf);
  const pick = (cont, rp, rf) => {
    const list = spots.filter(sp => sp.cont === cont && okAt(sp, rp, rf)).sort((a, b) => (b.prime || 0) - (a.prime || 0) || b.score - a.score);
    return list[0] || null;
  };
  let missing = 0;
  for (const c of ORDER) {
    const sp = pick(c, 200, 150) || pick(c, 170, 120);
    if (sp) placed.push({ x: sp.x, y: sp.y, cont: c }); else missing++;
  }
  for (let k = 0; k < missing; k++) {
    let sp = null;
    for (const c of BIG) { sp = pick(c, 200, 150) || pick(c, 160, 110); if (sp) { placed.push({ x: sp.x, y: sp.y, cont: c }); break; } }
    if (!sp) break;
  }
  return placed;
}

// Sprache eines Volkes nach seiner Heimat (Index in LANGS, names.js)
export function langFor(x, y) {
  const E = EARTH, c = E.cont[y * E.W + x], [lo, la] = lonLat(x, y);
  if (c === 3) return lo > 24 && la > 12 ? 5 : la > 20 ? 0 : 10;   // Nil und Ostafrika, Maghreb (Atlas), Afrika südlich der Sahara
  if (c === 6) return la < 46 ? 3 : 2;                              // Mittelmeer, Norden
  if (c === 5) return lo < 62 ? 6 : lo < 95 && la > 37 ? 9 : lo < 92 ? 6 : 4; // Zweistromland und Indus, Steppe, Ostasien
  if (c === 7) return 8;
  if (c === 1) return 7;
  if (c === 2) return 1;
  return 0;
}
