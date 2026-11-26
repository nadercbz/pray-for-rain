// Worker der nahtlosen Erde (seit 27.10.2026, PLAN_ERDE_HEUTE.md). Je Kachel (Web Mercator Stufe z, x, y):
// Geländehöhen aus den AWS Terrain Tiles (Terrarium, kostenlos), Bodennetz auf der Kugel in der Tangentialebene der
// Kachelmitte, Bodentextur auf OffscreenCanvas (Lebensraum aus den Erddaten des Spiels, Hangschatten, Schnee, Wasser nach
// Tiefe, Landbedeckung, Landnutzung, Flüsse, Straßen, Bahnen, Grenzen, Gebäudegrundrisse) und auf Wunsch die Stadtdetails
// (Gebäude, Straßenbänder, Bäume, Wege) aus city/build.js mit Geländehöhe. Vektorkacheln von OpenFreeMap.
import { decodeTile } from '../city/mvt.js';
import { buildTile, frameAt } from '../city/build.js';
import { ecef, frame, toLocal, lonOfX, latOfY, tileCenter, tileSize, R, UNIT } from './geo.js';

let BIO = null, BW = 2048, BH = 1024, BLON0 = -169, TMPL = '', DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
// Speicher (seit 27.10.2026 nach Abstürzen beim Zoomen): Vektorkacheln roh (gepackt) bis rund 40 MB je Worker, entpackt nur
// die letzten 4 (entpackt ist eine Stadtkachel leicht 20 MB und mehr), Höhenkacheln 36 Stück (je 256 KB)
const rcache = new Map(), vcache = new Map(), dcache = new Map(), RMAX = 40e6;
let rbytes = 0;
const lru = (m, k, v, max) => { m.delete(k); m.set(k, v); if (m.size > max) m.delete(m.keys().next().value); return v; };

async function fetchBuf(url) {
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(url);
      if (r.status === 204 || r.status === 404) return null;
      if (!r.ok) throw new Error('http ' + r.status);
      return await r.arrayBuffer();
    } catch (e) { if (k === 2) throw e; await new Promise(res => setTimeout(res, 500 * (k + 1))); }
  }
  return null;
}
// Vektorkachel roh, mit Byte Grenze
function rawTile(z, x, y) {
  const key = z + '/' + x + '/' + y;
  let e = rcache.get(key);
  if (e) { rcache.delete(key); rcache.set(key, e); return e.p; }
  e = { n: 0, p: null };
  e.p = fetchBuf(TMPL.replace('{z}', z).replace('{x}', x).replace('{y}', y)).then(b => {
    e.n = b ? b.byteLength : 0; rbytes += e.n;
    while (rbytes > RMAX && rcache.size > 1) { const k = rcache.keys().next().value; rbytes -= rcache.get(k).n; rcache.delete(k); }
    return b;
  }).catch(() => null);
  rcache.set(key, e);
  return e.p;
}
// Vektorkachel (Stufe bis 14), entpackt
function vector(z, x, y) {
  const key = z + '/' + x + '/' + y;
  if (vcache.has(key)) return lru(vcache, key, vcache.get(key), 4);
  const p = rawTile(z, x, y).then(b => (b && b.byteLength ? decodeTile(b) : {})).catch(() => ({}));
  return lru(vcache, key, p, 4);
}
// Höhenkachel als Meter (256 mal 256)
function demTile(z, x, y) {
  const key = z + '/' + x + '/' + y;
  if (dcache.has(key)) return lru(dcache, key, dcache.get(key), 36);
  const p = (async () => {
    const b = await fetchBuf(DEM.replace('{z}', z).replace('{x}', x).replace('{y}', y));
    if (!b) return null;
    const bmp = await createImageBitmap(new Blob([b], { type: 'image/png' }));
    const c = new OffscreenCanvas(256, 256), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, 256, 256).data, h = new Float32Array(256 * 256);
    for (let i = 0; i < h.length; i++) h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
    return h;
  })().catch(() => null);
  return lru(dcache, key, p, 36);
}
// Höhenfunktion (u, v in 0..1 der Kachel z, x, y) aus der Höhenkachel der Stufe min(z, 12)
async function heightFn(z, x, y) {
  const zd = Math.min(z, 12), k = 2 ** (z - zd), dx = x >> (z - zd), dy = y >> (z - zd);
  const H = await demTile(zd, dx, dy);
  if (!H) return () => 0;
  const ox = (x - dx * k) / k, oy = (y - dy * k) / k, s = 1 / k;
  return (u, v) => {
    const fx = Math.min(255, Math.max(0, (ox + u * s) * 256 - 0.5)), fy = Math.min(255, Math.max(0, (oy + v * s) * 256 - 0.5));
    const x0 = fx | 0, y0 = fy | 0, x1 = Math.min(255, x0 + 1), y1 = Math.min(255, y0 + 1), ax = fx - x0, ay = fy - y0;
    const a = H[y0 * 256 + x0], b = H[y0 * 256 + x1], c = H[y1 * 256 + x0], d = H[y1 * 256 + x1];
    return a + (b - a) * ax + (c - a) * ay + (a - b - c + d) * ax * ay;
  };
}

// ---------- Farben ----------
const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
// Lebensräume des Spiels (data.js BIOMES): mild, wald, taiga, tundra, eis, steppe, sumpf, savanne, wueste, tropen, vulkan, salz, canyon, oase, fjord
const BIOC = ['#a7c27a', '#86a964', '#71935f', '#b6b597', '#f1f5f7', '#c9c38c', '#93ad82', '#cfc07f', '#ead6a3', '#6c9f58', '#9a8e7f', '#ece6d6', '#d29d70', '#8fbe69', '#88a487'].map(hex);
const SHALLOW = hex('#86cbd9'), DEEP = hex('#3f7fae'), LAKE = hex('#79bcd2'), SNOW = hex('#f4f7f9');
const LANDC = {
  wood: ['#5f8c4c', 0.55], forest: ['#5f8c4c', 0.55], grass: ['#a3c27a', 0.4], meadow: ['#a3c27a', 0.4], farmland: ['#cfd28f', 0.42], sand: ['#ead9a8', 0.75], beach: ['#efe0b5', 0.8],
  ice: ['#f3f7f9', 0.92], glacier: ['#f3f7f9', 0.92], wetland: ['#8fae88', 0.45], rock: ['#bdb4a5', 0.6], bare_rock: ['#bdb4a5', 0.6], scree: ['#c8bfb0', 0.5],
  residential: ['#d6cbbb', 0.62], suburb: ['#d6cbbb', 0.35], commercial: ['#d3c3b6', 0.66], retail: ['#d6c2b4', 0.66], industrial: ['#c7c1b6', 0.66], railway: ['#c2b8a7', 0.6],
  cemetery: ['#a2b786', 0.6], hospital: ['#dcd0c2', 0.6], school: ['#dcd2c0', 0.6], university: ['#d9cdb9', 0.6], college: ['#d9cdb9', 0.6], kindergarten: ['#dcd2c0', 0.6],
  stadium: ['#c9c2b2', 0.6], pitch: ['#8fbf6e', 0.7], playground: ['#d9c49a', 0.6], park: ['#98be72', 0.6], garden: ['#a3c27a', 0.5], zoo: ['#a3c27a', 0.5],
  military: ['#b8bba3', 0.4], quarry: ['#c8bca4', 0.6], theme_park: ['#c9c4a0', 0.5], golf: ['#9cc878', 0.6], allotments: ['#b4c889', 0.5], recreation_ground: ['#a3c27a', 0.5],
};
// Flächenkarte für die Feinzeichnung (seit 27.10.2026): Rot Wiese und Grün, Grün Pflaster, Gelb Sand, Blau Wasser,
// schwaches Blau (rund 0,27) Wohngebiet
const SURFC = {
  wood: '#f00', forest: '#f00', grass: '#f00', meadow: '#f00', wetland: '#d00', park: '#f00', cemetery: '#e00', garden: '#f00', zoo: '#d00', golf: '#f00',
  allotments: '#e00', recreation_ground: '#f00', pitch: '#f00', village_green: '#f00', farmland: '#900', residential: '#004', suburb: '#003',
  sand: '#ff0', beach: '#ff0', playground: '#cc0', commercial: '#080', retail: '#0a0', square: '#0f0', pedestrian: '#0f0', plaza: '#0f0',
};
const ROADC = { motorway: '#f2c98a', trunk: '#f5d8a3', primary: '#f8e7c0', secondary: '#fcf3df', tertiary: '#fdf6e8', minor: '#ffffff', service: '#fbfaf6', track: '#e7dcc5', path: '#efe6d6', raceway: '#f0e0c0', busway: '#ffffff', pier: '#e6dccb' };
const ROADW = { motorway: 24, trunk: 19, primary: 16, secondary: 13.5, tertiary: 11, minor: 8, service: 5, track: 3.4, path: 2.6, raceway: 10, busway: 8, pier: 5 };
const ROADZ = { motorway: 5, trunk: 6, primary: 8, secondary: 9, tertiary: 10, minor: 12, service: 13, track: 12, path: 13, raceway: 11, busway: 12, pier: 13 };

const canvases = new Map();
function cvs(S, k) { const key = S + k; let c = canvases.get(key); if (!c) { c = new OffscreenCanvas(S, S); canvases.set(key, c); } return c; }

// Pfade einer Vektorkachel auf die Leinwand (Kachelkoordinaten 0..extent zu Pixeln)
function pathOf(g, f, sc) {
  g.beginPath();
  for (const r of f.rings) {
    if (r.length < 4) continue;
    g.moveTo(r[0] * sc, r[1] * sc);
    for (let i = 2; i < r.length; i += 2) g.lineTo(r[i] * sc, r[i + 1] * sc);
    if (f.type === 3) g.closePath();
  }
}

async function ground(msg) {
  const { z, x, y, S } = msg;
  const [hf, L] = await Promise.all([heightFn(z, x, y), z <= 14 ? vector(z, x, y) : Promise.resolve({})]);
  const [clon, clat] = tileCenter(z, x, y), F = frame(clon, clat), n2 = 2 ** z;
  const sizeU = tileSize(z, y), mPerPx = sizeU * UNIT / S;
  // --- Bodennetz ---
  const n = z <= 3 ? 48 : z <= 6 ? 32 : z <= 10 ? 20 : 32, N1 = n + 1;
  const skirt = Math.max(3, sizeU * 0.03);
  const nv = N1 * N1 + 4 * N1;
  const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), ll = new Float32Array(nv * 2), hg = new Float32Array(N1 * N1);
  const p = [0, 0, 0], q = [0, 0, 0];
  let hmin = 1e9, hmax = -1e9, k = 0;
  const put = (u, v, hU) => {
    const lon = lonOfX((x + u) / n2), lat = latOfY((y + v) / n2);
    toLocal(F, ecef(lon, lat, hU, p), q);
    pos[k * 3] = q[0]; pos[k * 3 + 1] = q[1]; pos[k * 3 + 2] = q[2];
    uv[k * 2] = u; uv[k * 2 + 1] = v; ll[k * 2] = lon; ll[k * 2 + 1] = lat; k++;
  };
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const u = i / n, v = j / n, hm = Math.max(0, hf(u, v)), hU = hm / UNIT;
    hg[j * N1 + i] = hU; hmin = Math.min(hmin, hU); hmax = Math.max(hmax, hU);
    put(u, v, hU);
  }
  // Schürzen an den Rändern gegen Spalten zwischen Kacheln verschiedener Stufen
  const edge = [];
  for (let i = 0; i <= n; i++) edge.push([i, 0]); for (let j = 0; j <= n; j++) edge.push([n, j]);
  for (let i = n; i >= 0; i--) edge.push([i, n]); for (let j = n; j >= 0; j--) edge.push([0, j]);
  const skirtIdx = [];
  for (const [i, j] of edge) { skirtIdx.push([j * N1 + i, k]); put(i / n, j / n, hg[j * N1 + i] - skirt); }
  const idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * N1 + i, b = a + 1, c = a + N1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  for (let e = 0; e + 1 < skirtIdx.length; e++) {
    const [a, as] = skirtIdx[e], [b, bs] = skirtIdx[e + 1];
    if (a === b) continue;
    idx.push(a, as, b, b, as, bs);
  }
  // Normalen nur aus dem Netz, die Schürzen erben sie vom Rand (sonst leuchten die Kachelkanten bei tiefer Sonne)
  const nrm = new Float32Array(nv * 3), ng = n * n * 6;
  for (let t = 0; t < ng; t += 3) {
    const ia = idx[t] * 3, ib = idx[t + 1] * 3, ic = idx[t + 2] * 3;
    const ux = pos[ib] - pos[ia], uy = pos[ib + 1] - pos[ia + 1], uz = pos[ib + 2] - pos[ia + 2];
    const vx = pos[ic] - pos[ia], vy = pos[ic + 1] - pos[ia + 1], vz = pos[ic + 2] - pos[ia + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [ia, ib, ic]) { nrm[o] += nx; nrm[o + 1] += ny; nrm[o + 2] += nz; }
  }
  for (let o = 0; o < N1 * N1 * 3; o += 3) { const l = Math.hypot(nrm[o], nrm[o + 1], nrm[o + 2]) || 1; const sg = nrm[o + 1] < 0 ? -1 : 1; nrm[o] *= sg / l; nrm[o + 1] *= sg / l; nrm[o + 2] *= sg / l; }
  for (const [a, as] of skirtIdx) { nrm[as * 3] = nrm[a * 3]; nrm[as * 3 + 1] = nrm[a * 3 + 1]; nrm[as * 3 + 2] = nrm[a * 3 + 2]; }
  // --- Textur ---
  const A = cvs(S, 'a'), Bm = cvs(S, 'b'), Cw = cvs(S, 'c');
  const ga = A.getContext('2d'), gb = Bm.getContext('2d'), gc = Cw.getContext('2d');
  const land = ga.createImageData(S, S), water = gc.createImageData(S, S), ld = land.data, wd = water.data;
  const sunx = -0.55, suny = -0.62, du = 1 / S;
  const relief = Math.min(4, Math.max(0.25, 900 / mPerPx));
  for (let py = 0; py < S; py++) {
    const v = (py + 0.5) / S, lat = latOfY((y + v) / n2), gy = Math.min(BH - 1, Math.max(0, Math.floor((90 - lat) / 180 * BH)));
    const snowLine = 4800 - Math.max(0, Math.abs(lat) - 25) * 95;
    for (let px = 0; px < S; px++) {
      const u = (px + 0.5) / S, lon = lonOfX((x + u) / n2);
      const gx = Math.floor(((((lon - BLON0) % 360) + 360) % 360) / 360 * BW);
      const bio = BIO ? BIO[gy * BW + gx] : 0;
      // am Rand einseitig, aber auf die volle Spanne hochgerechnet (sonst eine helle Linie an jeder Kachelkante)
      const u0 = Math.max(0, u - du), u1 = Math.min(1, u + du), v0 = Math.max(0, v - du), v1 = Math.min(1, v + du);
      const h = hf(u, v), hx = (hf(u1, v) - hf(u0, v)) * 2 * du / (u1 - u0), hy = (hf(u, v1) - hf(u, v0)) * 2 * du / (v1 - v0);
      // Hangschatten: Licht von Nordwesten, stärker in feinen Kacheln
      const sh = Math.max(0.55, Math.min(1.3, 1 + (hx * sunx + hy * suny) / (2 * mPerPx) * relief * 0.5));
      let c = BIOC[bio] || BIOC[0];
      const o = (py * S + px) * 4;
      let r = c[0], g = c[1], b = c[2];
      if (h > snowLine) { const kk = Math.min(1, (h - snowLine) / 500); r += (SNOW[0] - r) * kk; g += (SNOW[1] - g) * kk; b += (SNOW[2] - b) * kk; }
      else if (h > 2200) { const kk = Math.min(0.5, (h - 2200) / 3000); r += (176 - r) * kk; g += (168 - g) * kk; b += (156 - b) * kk; }
      ld[o] = Math.min(255, r * sh); ld[o + 1] = Math.min(255, g * sh); ld[o + 2] = Math.min(255, b * sh); ld[o + 3] = 255;
      // Wasser nach Tiefe: flache Schelfe türkis, Tiefsee dunkel
      const dk = h < 0 ? Math.min(1, Math.pow(-h / 4500, 0.55)) : 0;
      const wc = h >= 0 ? LAKE : SHALLOW;
      wd[o] = wc[0] + (DEEP[0] - wc[0]) * dk; wd[o + 1] = wc[1] + (DEEP[1] - wc[1]) * dk; wd[o + 2] = wc[2] + (DEEP[2] - wc[2]) * dk; wd[o + 3] = 255;
    }
  }
  ga.putImageData(land, 0, 0);
  const sc = L.water ? S / L.water.extent : L.landcover ? S / L.landcover.extent : S / 4096;
  // Landbedeckung und Landnutzung
  ga.globalCompositeOperation = 'source-over';
  for (const layer of ['landcover', 'landuse', 'park']) {
    for (const f of (L[layer]?.features || [])) {
      if (f.type !== 3) continue;
      let cls = f.props.subclass === 'park' ? 'park' : f.props.class;
      if (layer === 'park') cls = 'park';
      const C = LANDC[cls]; if (!C) continue;
      if ((cls === 'residential' || cls === 'suburb') && z < 9) continue;
      ga.globalAlpha = layer === 'park' ? Math.min(C[1], 0.22) : C[1];
      ga.fillStyle = C[0];
      pathOf(ga, f, sc); ga.fill('evenodd');
    }
  }
  ga.globalAlpha = 1;
  // Wasser: Maske aus Flächen und Flüssen, darin die Tiefenfarbe
  gb.clearRect(0, 0, S, S); gb.fillStyle = '#fff'; gb.strokeStyle = '#fff'; gb.lineCap = 'round'; gb.lineJoin = 'round';
  let anyWater = false;
  for (const f of (L.water?.features || [])) { if (f.type !== 3 || f.props.brunnel === 'tunnel') continue; pathOf(gb, f, sc); gb.fill('evenodd'); anyWater = true; }
  for (const f of (L.waterway?.features || [])) {
    if (f.type !== 2 || f.props.brunnel === 'tunnel') continue;
    const wm = f.props.class === 'river' ? 40 : f.props.class === 'canal' ? 18 : 6;
    const w = Math.max(f.props.class === 'river' ? 0.9 : 0.5, wm / mPerPx);
    if (w < 0.45) continue;
    gb.lineWidth = w; pathOf(gb, f, sc); gb.stroke(); anyWater = true;
  }
  // Ohne Vektordaten (sehr grobe oder fehlende Kachel): Wasser aus den Höhen unter null
  if (!anyWater && !L.water) {
    const md = gb.createImageData(S, S).data, img = gb.createImageData(S, S);
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) { const hh = hf((px + 0.5) / S, (py + 0.5) / S); if (hh < 0) img.data[(py * S + px) * 4 + 3] = 255; }
    void md; gb.putImageData(img, 0, 0);
  }
  gc.putImageData(water, 0, 0);
  gc.globalCompositeOperation = 'destination-in'; gc.drawImage(Bm, 0, 0); gc.globalCompositeOperation = 'source-over';
  ga.drawImage(Cw, 0, 0);
  // Gebäudegrundrisse (bevor die 3D Gebäude kommen, sieht man so die Stadt von oben)
  if (z >= 13) {
    ga.fillStyle = '#d3c8bb'; ga.strokeStyle = 'rgba(120,105,92,0.35)'; ga.lineWidth = 0.6;
    for (const f of (L.building?.features || [])) { pathOf(ga, f, sc); ga.fill('evenodd'); if (z >= 14) ga.stroke(); }
  }
  // Straßen und Bahnen
  ga.lineCap = 'round'; ga.lineJoin = 'round';
  const feats = (L.transportation?.features || []).filter(f => f.type === 2 && f.props.brunnel !== 'tunnel');
  const rank = f => Object.keys(ROADW).indexOf(f.props.class);
  feats.sort((a, b) => rank(b) - rank(a));
  for (const pass of [0, 1]) for (const f of feats) {
    const cls = f.props.class;
    if (cls === 'rail' || cls === 'transit') {
      if (pass === 0 || z < 9) continue;
      ga.strokeStyle = 'rgba(120,110,104,0.75)'; ga.lineWidth = Math.max(0.7, 4 / mPerPx); ga.setLineDash(z >= 12 ? [4, 3] : []);
      pathOf(ga, f, sc); ga.stroke(); ga.setLineDash([]);
      continue;
    }
    if (!ROADC[cls] || z < (ROADZ[cls] || 14)) continue;
    const w = Math.max(cls === 'motorway' || cls === 'trunk' ? 0.9 : 0.6, ROADW[cls] / mPerPx);
    if (pass === 0) { if (w < 1.6) continue; ga.strokeStyle = 'rgba(150,135,118,0.55)'; ga.lineWidth = w + 1.4; }
    else { ga.strokeStyle = ROADC[cls]; ga.lineWidth = w; }
    pathOf(ga, f, sc); ga.stroke();
  }
  // Grenzen: Staaten deutlich, Bundesländer und Provinzen zart
  for (const f of (L.boundary?.features || [])) {
    const lvl = f.props.admin_level;
    if (f.props.maritime || (lvl !== 2 && !(lvl === 4 && z >= 5))) continue;
    ga.strokeStyle = lvl === 2 ? 'rgba(255,248,232,0.9)' : 'rgba(255,248,232,0.4)';
    ga.lineWidth = lvl === 2 ? Math.max(1.2, Math.min(3, 240 / mPerPx)) : 0.8;
    ga.setLineDash(lvl === 2 ? [] : [3, 3]);
    pathOf(ga, f, sc); ga.stroke(); ga.setLineDash([]);
  }
  const bmp = A.transferToImageBitmap();
  // A hat seine Fläche abgegeben: neue Leinwand für den nächsten Auftrag
  canvases.delete(S + 'a');
  // Flächenkarte für die Feinzeichnung nah am Boden (earthview earthGroundMat), ab Stufe 13
  let surf = null;
  if (z >= 13) {
    const Dc = cvs(S, 's'), gd = Dc.getContext('2d');
    gd.globalCompositeOperation = 'source-over'; gd.fillStyle = '#000'; gd.fillRect(0, 0, S, S);
    for (const layer of ['landcover', 'landuse', 'park']) for (const f of (L[layer]?.features || [])) {
      if (f.type !== 3) continue;
      const cls = layer === 'park' || f.props.subclass === 'park' ? 'park' : f.props.class, col = SURFC[cls] || SURFC[f.props.subclass];
      if (!col) continue;
      gd.fillStyle = col; pathOf(gd, f, sc); gd.fill('evenodd');
    }
    gd.fillStyle = '#0f0';
    for (const f of (L.transportation?.features || [])) if (f.type === 3 && f.props.brunnel !== 'tunnel') { pathOf(gd, f, sc); gd.fill('evenodd'); }
    gd.fillStyle = '#00f'; gd.strokeStyle = '#00f'; gd.lineCap = 'round'; gd.lineJoin = 'round';
    for (const f of (L.water?.features || [])) { if (f.type !== 3 || f.props.brunnel === 'tunnel') continue; pathOf(gd, f, sc); gd.fill('evenodd'); }
    for (const f of (L.waterway?.features || [])) {
      if (f.type !== 2 || f.props.brunnel === 'tunnel') continue;
      const wm = f.props.class === 'river' ? 40 : f.props.class === 'canal' ? 18 : 6;
      gd.lineWidth = Math.max(0.6, wm / mPerPx); pathOf(gd, f, sc); gd.stroke();
    }
    gd.fillStyle = '#000';
    for (const f of (L.building?.features || [])) { pathOf(gd, f, sc); gd.fill('evenodd'); }
    surf = Dc.transferToImageBitmap();
    canvases.delete(S + 's');
  }
  return { pos, uv, ll, nrm, idx: new Uint32Array(idx), hg, n, bmp, surf, center: [clon, clat], hmin, hmax, sizeU };
}

// Stadtdetails einer Kachel der Stufe 14 (voll) oder 13 (nur große Gebäude, Fernsicht), mit Geländehöhe
async function detail(msg) {
  const { z, x, y, far, style, lang } = msg;
  const [hf, L] = await Promise.all([heightFn(z, x, y), vector(z, x, y)]);
  const [clon, clat] = tileCenter(z, x, y), F = frameAt(clon, clat), n2 = 2 ** z;
  const elev = (lx, lz) => {
    const X = F.X0 + lx * UNIT / F.C, Y = F.Y0 + lz * UNIT / F.C;
    const u = X * n2 - x, v = Y * n2 - y;
    return Math.max(0, hf(Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v)))) / UNIT - (lx * lx + lz * lz) / (2 * R);
  };
  return buildTile(L, x, y, F, style, lang, z, !!far, { elev, terrain: true });
}

const bufs = (o, acc = []) => {
  if (!o || typeof o !== 'object') return acc;
  if (ArrayBuffer.isView(o)) { acc.push(o.buffer); return acc; }
  if (typeof ImageBitmap !== 'undefined' && o instanceof ImageBitmap) { acc.push(o); return acc; }
  for (const v of Array.isArray(o) ? o : Object.values(o)) bufs(v, acc);
  return acc;
};

self.onmessage = async e => {
  const m = e.data;
  if (m.type === 'init') { BIO = m.bio || null; BW = m.W || BW; BH = m.H || BH; BLON0 = m.lon0 ?? BLON0; TMPL = m.tmpl; if (m.dem) DEM = m.dem; return; }
  try {
    const out = m.type === 'ground' ? await ground(m) : await detail(m);
    self.postMessage({ id: m.id, ok: true, out }, [...new Set(bufs(out))]);
  } catch (x) {
    self.postMessage({ id: m.id, ok: false, error: String(x && x.message || x) });
  }
};
