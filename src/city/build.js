// Stadtansicht 1 zu 1 (seit 26.10.2026, PLAN_ERDE_HEUTE.md): aus einer Vektorkachel (OpenMapTiles Schema, Stufe 14)
// werden fertige Geometriepuffer: Gebäude mit echter Höhe und Dachform, Straßen als Bänder mit Gehweg, Bahnen, Wasser,
// Grünflächen, Bäume, Namen und die Wege für Menschen und Autos. Läuft im Worker (worker.js), im Hauptfaden und in Node.
// Einheiten: 1 Einheit = 10 m wie im Spiel (Menschen 0,18 hoch). Ursprung = Mitte der Stadt, x nach Osten, z nach Süden.
import { Vector2, ShapeUtils } from '../../vendor/three/build/three.core.js';
import { ringArea } from './mvt.js';

export const Z = 14, EXT = 4096, UNIT = 10;
const TWO = 2 ** Z;

// Bezugsrahmen einer Stadt: Mercator Mitte und Meter je Mercator Einheit an dieser Breite
export function frameAt(lon, lat) {
  const X0 = (lon + 180) / 360, s = Math.sin(lat * Math.PI / 180);
  const Y0 = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return { lon, lat, X0, Y0, C: 40075016.686 * Math.cos(lat * Math.PI / 180) };
}
// Kachel (Stufe 14) an einem Punkt der Stadt (in Einheiten)
export function tileAt(F, x, z) {
  const X = F.X0 + x * UNIT / F.C, Y = F.Y0 + z * UNIT / F.C;
  return [Math.floor(X * TWO), Math.floor(Y * TWO)];
}
// Ecke einer Kachel in Einheiten (z: Stufe, 14 nah, 13 für die Fernsicht)
export function tileOrigin(F, tx, ty, z = Z) { const n = 2 ** z; return [(tx / n - F.X0) * F.C / UNIT, (ty / n - F.Y0) * F.C / UNIT]; }
export function tileSize(F, z = Z) { return F.C / 2 ** z / UNIT; }
// Punkt in Einheiten zu Länge und Breite (für Namen, Fundorte, Wahrzeichen)
export function lonLatOf(F, x, z) {
  const X = F.X0 + x * UNIT / F.C, Y = F.Y0 + z * UNIT / F.C;
  return [X * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * Y))) * 180 / Math.PI];
}
export function localOf(F, lon, lat) {
  const X = (lon + 180) / 360, s = Math.sin(lat * Math.PI / 180), Y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return [(X - F.X0) * F.C / UNIT, (Y - F.Y0) * F.C / UNIT];
}

const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const hex = h => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); };
const mixc = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

// Farben je Stadtstil: eu (Putz in Pastell, Ziegel und Schiefer), jp (Weiß, Grau, Beige, dunkle Ziegel), us, warm (Mittelmeer,
// Nahost, Nordafrika: Sand und Ocker), trop (Südamerika, Afrika, Südasien: kräftige Farben)
const STYLE = {
  eu: { wall: ['#efe2c8', '#e9d2b0', '#f3e9d6', '#eaa48d', '#e8c27f', '#c3cfa8', '#bdd0dd', '#f3cbb9', '#e6b8a8', '#ddd4c4', '#d9c3a5', '#f1ede4'], roof: ['#b9634a', '#a85a46', '#7a8796', '#6f7d92', '#c46a52', '#8e6a62'], ground: '#b9bfa6', court: '#a9b88f' },
  jp: { wall: ['#efede8', '#e4e1da', '#d8d6d0', '#ece3d3', '#cfd2d4', '#f4f1ea', '#e0d6c4', '#c9c6be', '#e8ddd0', '#d6dde0'], roof: ['#5d6670', '#4f5864', '#6b5e58', '#7b8590', '#8a5a48'], ground: '#bdbcb4', court: '#b2b59f' },
  us: { wall: ['#e9e1d3', '#d9cfc0', '#c9c3bb', '#e7d3b8', '#cbb59a', '#b8c2c9', '#efe8dc', '#d4b7a0'], roof: ['#6d6a68', '#7d6f64', '#5f646b', '#8a6f5c'], ground: '#b7bba5', court: '#a7b48c' },
  warm: { wall: ['#ead8b8', '#e3c79c', '#f0e4cc', '#dcb98c', '#efe9dc', '#e6cfae', '#d8a982', '#f2dfc2'], roof: ['#c98a5e', '#b97a52', '#d8c4a4', '#c9b08c'], ground: '#cdbf9f', court: '#b9b58c' },
  trop: { wall: ['#f0e2c8', '#f2c7a8', '#b8dccc', '#f4d58c', '#e8b4b8', '#c8d8f0', '#efefe6', '#e6c28c', '#a8d0c0'], roof: ['#b9634a', '#8a8f96', '#c47a52', '#6f7d92'], ground: '#b4b89a', court: '#9fb27e' },
};
const GLASS = ['#a8c4d8', '#9bb8cf', '#c3d3dc', '#b7cad6', '#8fb0c8', '#d0dbe0', '#a5bfb8', '#c9c0b0', '#b0bcc6'];

// Bodenflächen: Farbe und Reihenfolge (höher liegt oben)
const LAND = {
  grass: ['#a8c47e', 3], park: ['#9fc07a', 3], wood: ['#7fa266', 4], forest: ['#7fa266', 4], farmland: ['#c9cf8f', 2], meadow: ['#b1c983', 3],
  wetland: ['#9fb89a', 3], sand: ['#eadcb4', 2], beach: ['#efe0b8', 2], rock: ['#bdb6a8', 2], ice: ['#eef4f6', 2],
  cemetery: ['#9fb486', 3], pitch: ['#8fbf6e', 5], playground: ['#d9c49a', 5], stadium: ['#b8b4a8', 4], garden: ['#a8c47e', 3],
  school: ['#d8d0c0', 1], university: ['#d4ccb8', 1], college: ['#d4ccb8', 1], hospital: ['#dcd4cc', 1], kindergarten: ['#d8d0c0', 1],
  commercial: ['#cfc9c0', 1], retail: ['#d2c9be', 1], industrial: ['#bcb8b0', 1], railway: ['#b8ae9c', 1], military: ['#b4b8a0', 1],
  zoo: ['#a9c27f', 3], theme_park: ['#c9c4a0', 2], golf: ['#9cc878', 3], quarry: ['#c8bca4', 2], allotments: ['#b6c98a', 3], recreation_ground: ['#a8c47e', 3],
};
// Straßen: Breite in Metern und Stufe für den Shader (1 Weg, 2 Nebenstraße, 3 Hauptstraße, 4 Autobahn)
const ROAD = {
  motorway: [24, 4], trunk: [19, 4], primary: [16, 3], secondary: [13.5, 3], tertiary: [11, 3], minor: [8, 2], service: [5, 2],
  track: [3.4, 1], path: [2.6, 1], raceway: [10, 2], busway: [8, 2], bus_guideway: [6, 2], pier: [5, 1],
};
const WALKSIDE = { primary: 3.6, secondary: 3.2, tertiary: 3, minor: 2.4, trunk: 2.2 };
// Bodendecker je Fläche (seit 27.10.2026): Graskarte (1 Rasen, 2 Wiese und Park mit Blumen, 3 Waldboden) und Büsche in
// m² je Stück. Gras und Blumen wachsen erst im Umkreis der Kamera aus der Karte (earthview updateNearCover)
const COVER = {
  park: [2, 140], grass: [1, 0], meadow: [2, 0], garden: [2, 90], recreation_ground: [1, 0], cemetery: [1, 70], village_green: [1, 0],
  allotments: [2, 80], wood: [3, 60], forest: [3, 60], wetland: [2, 0], zoo: [2, 100], golf: [1, 0],
};

// ---------- Hilfen ----------
function clipRing(r) {
  // Sutherland-Hodgman an der Kachel [0, EXT], Ring als flaches Feld x, y
  let pts = r;
  const edges = [[0, 0, 1], [0, EXT, -1], [1, 0, 1], [1, EXT, -1]];
  for (const [ax, lim, dir] of edges) {
    const out = [], n = pts.length;
    if (!n) break;
    for (let i = 0; i < n; i += 2) {
      const j = (i + 2) % n;
      const ax0 = pts[i + ax], ax1 = pts[j + ax];
      const in0 = (ax0 - lim) * dir >= 0, in1 = (ax1 - lim) * dir >= 0;
      if (in0) out.push(pts[i], pts[i + 1]);
      if (in0 !== in1) {
        const t = (lim - ax0) / (ax1 - ax0);
        out.push(pts[i] + (pts[j] - pts[i]) * t, pts[i + 1] + (pts[j + 1] - pts[i + 1]) * t);
      }
    }
    pts = out;
  }
  return pts;
}
const inside = r => { for (let i = 0; i < r.length; i++) if (r[i] < 0 || r[i] > EXT) return false; return true; };

function clipLine(l) {
  // Liang-Barsky je Strecke, liefert Teilzüge innerhalb der Kachel
  const parts = []; let cur = null;
  for (let i = 0; i + 3 < l.length; i += 2) {
    let x0 = l[i], y0 = l[i + 1], x1 = l[i + 2], y1 = l[i + 3];
    let t0 = 0, t1 = 1; const dx = x1 - x0, dy = y1 - y0;
    let ok = true;
    for (const [p, q] of [[-dx, x0], [dx, EXT - x0], [-dy, y0], [dy, EXT - y0]]) {
      if (p === 0) { if (q < 0) { ok = false; break; } continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; } else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; }
    }
    if (!ok) { cur = null; continue; }
    const ax = x0 + dx * t0, ay = y0 + dy * t0, bx = x0 + dx * t1, by = y0 + dy * t1;
    if (!cur || t0 > 0) { cur = [ax, ay]; parts.push(cur); }
    cur.push(bx, by);
    if (t1 < 1) cur = null;
  }
  return parts.filter(p => p.length >= 4);
}

// Wachsende Puffer
class Buf {
  constructor(n = 4096) { this.a = new Float32Array(n); this.n = 0; }
  push(...v) { if (this.n + v.length > this.a.length) this.grow(v.length); for (const x of v) this.a[this.n++] = x; }
  p3(x, y, z) { if (this.n + 3 > this.a.length) this.grow(3); const a = this.a; a[this.n++] = x; a[this.n++] = y; a[this.n++] = z; }
  p4(x, y, z, w) { if (this.n + 4 > this.a.length) this.grow(4); const a = this.a; a[this.n++] = x; a[this.n++] = y; a[this.n++] = z; a[this.n++] = w; }
  grow(k) { const b = new Float32Array(Math.max(this.a.length * 2, this.n + k)); b.set(this.a.subarray(0, this.n)); this.a = b; }
  out() { return this.a.slice(0, this.n); }
}

// Getippte wachsende Puffer
class TBuf {
  constructor(T, n = 1 << 15) { this.T = T; this.a = new T(n); this.n = 0; }
  grow(k) { const b = new this.T(Math.max(this.a.length * 2, this.n + k)); b.set(this.a.subarray(0, this.n)); this.a = b; }
  p3(x, y, z) { if (this.n + 3 > this.a.length) this.grow(3); const a = this.a; a[this.n++] = x; a[this.n++] = y; a[this.n++] = z; }
  p4(x, y, z, w) { if (this.n + 4 > this.a.length) this.grow(4); const a = this.a; a[this.n++] = x; a[this.n++] = y; a[this.n++] = z; a[this.n++] = w; }
  p2(x, y) { if (this.n + 2 > this.a.length) this.grow(2); const a = this.a; a[this.n++] = x; a[this.n++] = y; }
  out() { return this.a.slice(0, this.n); }
}

// Indiziertes Gebäudemesh, kompakt (seit 26.10.2026: vorher rund 150 Byte je Dreieck, in Tokio fast 900 MB auf der
// Grafikkarte): Position Float32, Normale Int8, Farbe Uint8, Merkmal Uint16 (Samen, Höhe und Sockel in Dezimetern, Art),
// Wand Uint16 (seit 27.10.2026: Stelle entlang der Wand und Wandlänge in Dezimetern, damit die Fenster genau auf die Wand
// passen und die Ecken Eckquader bekommen; Dächer: entlang der Traufe)
class Mesh {
  constructor() { this.p = new TBuf(Float32Array); this.n = new TBuf(Int8Array); this.c = new TBuf(Uint8Array); this.b = new TBuf(Uint16Array); this.w = new TBuf(Uint16Array); this.ix = new TBuf(Uint32Array); this.v = 0; }
  vert(x, y, z, nx, ny, nz, col, B, wu = 0, wl = 0) {
    this.p.p3(x, y, z); this.n.p4(Math.round(nx * 127), Math.round(ny * 127), Math.round(nz * 127), 0);
    this.c.p4(Math.round(col[0] * 255), Math.round(col[1] * 255), Math.round(col[2] * 255), 255);
    this.b.p4(Math.round(B[0] * 65535), Math.round(B[1] * 100), Math.round(B[2] * 100), B[3]);
    this.w.p2(Math.min(65535, Math.round(wu * 100)), Math.min(65535, Math.round(wl * 100)));
    return this.v++;
  }
  // Viereck a b c d (rundherum), Vorderseite zeigt nach want; wl: Länge der Kante a b (Wand oder Traufe) in Einheiten
  quad(a, b, c, d, col, B, want, wl = 0) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    let flip = false;
    if (want && nx * want[0] + ny * want[1] + nz * want[2] < 0) { nx = -nx; ny = -ny; nz = -nz; flip = true; }
    // Stelle entlang der Kante: a und d am Anfang, b und c am Ende (bei Dächern liegt c d auf dem First, gleiche Zählung)
    const i0 = this.vert(a[0], a[1], a[2], nx, ny, nz, col, B, 0, wl), i1 = this.vert(b[0], b[1], b[2], nx, ny, nz, col, B, wl, wl);
    const i2 = this.vert(c[0], c[1], c[2], nx, ny, nz, col, B, wl, wl), i3 = this.vert(d[0], d[1], d[2], nx, ny, nz, col, B, 0, wl);
    if (flip) { this.ix.p3(i0, i2, i1); this.ix.p3(i0, i3, i2); } else { this.ix.p3(i0, i1, i2); this.ix.p3(i0, i2, i3); }
  }
  // flache Fläche (Dach) aus einer Triangulierung mit gemeinsamen Punkten, Normale nach oben
  poly(tr, y, col, B) {
    const base = this.v;
    for (const p of tr.pts) this.vert(p.x, y, p.y, 0, 1, 0, col, B);
    for (const [a, b, c] of tr.faces) {
      const A = tr.pts[a], Bp = tr.pts[b], C = tr.pts[c];
      const ny = (Bp.y - A.y) * (C.x - A.x) - (Bp.x - A.x) * (C.y - A.y);
      if (ny >= 0) this.ix.p3(base + a, base + b, base + c); else this.ix.p3(base + a, base + c, base + b);
    }
  }
  count() { return this.ix.n / 3; }
  out() { return { pos: this.p.out(), nrm: this.n.out(), col: this.c.out(), attr: this.b.out(), wall: this.w.out(), index: this.ix.out(), verts: this.v }; }
}

// Ring nach innen versetzen (für Walm- und Mansarddächer), nur für einfache, fast konvexe Ringe
function inset(xs, zs, d) {
  const n = xs.length, ox = new Array(n), oz = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n, q = (i + 1) % n;
    let ax = xs[i] - xs[p], az = zs[i] - zs[p], bx = xs[q] - xs[i], bz = zs[q] - zs[i];
    const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1; ax /= la; az /= la; bx /= lb; bz /= lb;
    // Innen liegt bei Außenringen (im Uhrzeigersinn, z nach unten) rechts der Laufrichtung: Normale (-dz, dx)
    const nax = -az, naz = ax, nbx = -bz, nbz = bx;
    let mx = nax + nbx, mz = naz + nbz; const ml = Math.hypot(mx, mz);
    if (ml < 0.3) return null;
    mx /= ml; mz /= ml;
    const k = d / Math.max(0.35, mx * nax + mz * naz);
    ox[i] = xs[i] + mx * k; oz[i] = zs[i] + mz * k;
  }
  // der neue Ring muss dieselbe Drehrichtung haben und darf nicht kippen
  let a0 = 0, a2 = 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; a0 += xs[i] * zs[j] - xs[j] * zs[i]; a2 += ox[i] * oz[j] - ox[j] * oz[i]; }
  if (a2 * a0 <= 0 || Math.abs(a2) < Math.abs(a0) * 0.12) return null;
  // keine Kante darf sich umdrehen (sonst überschlägt sich das Dach an einer einspringenden Ecke)
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; if ((xs[j] - xs[i]) * (ox[j] - ox[i]) + (zs[j] - zs[i]) * (oz[j] - oz[i]) <= 0) return null; }
  return [ox, oz];
}

function triangulate(outer, holes) {
  const c = outer.map(([x, z]) => new Vector2(x, z));
  const hs = holes.map(h => h.map(([x, z]) => new Vector2(x, z)));
  try { return { pts: c.concat(...hs), faces: ShapeUtils.triangulateShape(c, hs) }; } catch { return null; }
}

const nm = (p, lang) => p[`name:${lang}`] || p.name_int || p['name:latin'] || p.name || '';

// ---------- Kachel bauen ----------
// layers: decodeTile Ergebnis. F: frameAt. style: Stilschlüssel. Ergebnis nur aus Feldern und flachen Listen (übertragbar).
// far: Fernsicht (Stufe 13) nur mit großen Gebäuden, Wasser, Wald und Hauptstraßen, ohne Bäume, Wege und Namen
// opt.elev(x, z): Geländehöhe in Einheiten an einem Punkt der Kachel (nahtlose Erde, seit 27.10.2026), opt.terrain:
// Boden und Wasser malt die Kacheltextur, darum keine flachen Bodenflächen (Bäume entstehen trotzdem aus ihnen)
export function buildTile(layers, tx, ty, F, style = 'eu', lang = 'de', z = Z, far = false, opt = {}) {
  const S = STYLE[style] || STYLE.eu;
  const E = opt.elev || (() => 0), onTerrain = !!opt.terrain;
  const T = tileSize(F, z), [ox, oz] = tileOrigin(F, tx, ty, z), sc = T / EXT;
  const X = px => ox + px * sc, Zc = py => oz + py * sc;
  const mPerU = UNIT;
  const out = { tx, ty, size: T, ox, oz };
  const seedT = tx * 7919 + ty * 104729;

  // --- Gebäude --- (große zuerst: weit entfernte Kacheln zeichnen nur den vorderen Teil, setDrawRange)
  const BB = new Mesh(), BS = new Mesh(), listB = [], listS = [];
  const wallC = S.wall.map(hex), roofC = S.roof.map(hex), glassC = GLASS.map(hex);
  for (const f of (layers.building?.features || [])) {
    if (f.props.hide_3d) continue;
    const hM = Math.max(3, +f.props.render_height || 0), minM = Math.max(0, +f.props.render_min_height || 0);
    if (hM - minM < 0.8 || (far && hM < 16)) continue;
    const given = typeof f.props.colour === 'string' && /^#[0-9a-f]{6}$/i.test(f.props.colour) ? hex(f.props.colour) : null;
    // Ringe in Außenring plus Löcher gruppieren (Reihenfolge der Kachel: Außenring, dann seine Löcher)
    const polys = [];
    for (const r0 of f.rings) {
      const a = ringArea(r0);
      if (Math.abs(a) < 4) continue;
      const r = inside(r0) ? r0 : clipRing(r0);
      if (r.length < 6) continue;
      if (a > 0) polys.push({ outer: r, holes: [] }); else if (polys.length) polys[polys.length - 1].holes.push(r);
    }
    for (const P of polys) {
      const xs = [], zs = [];
      for (let i = 0; i < P.outer.length; i += 2) { const x = X(P.outer[i]), z = Zc(P.outer[i + 1]); if (xs.length && Math.abs(x - xs[xs.length - 1]) < 1e-4 && Math.abs(z - zs[zs.length - 1]) < 1e-4) continue; xs.push(x); zs.push(z); }
      if (xs.length > 2 && Math.abs(xs[0] - xs[xs.length - 1]) < 1e-4 && Math.abs(zs[0] - zs[zs.length - 1]) < 1e-4) { xs.pop(); zs.pop(); }
      if (xs.length < 3) continue;
      let cx = 0, cz = 0; for (let i = 0; i < xs.length; i++) { cx += xs[i]; cz += zs[i]; } cx /= xs.length; cz /= xs.length;
      let area = 0; for (let i = 0; i < xs.length; i++) { const j = (i + 1) % xs.length; area += xs[i] * zs[j] - xs[j] * zs[i]; } area = Math.abs(area / 2) * mPerU * mPerU;
      const seed = hash(Math.round(cx * 13.7), Math.round(cz * 9.1) + seedT);
      let base = Infinity; for (let i = 0; i < xs.length; i++) base = Math.min(base, E(xs[i], zs[i]));
      if (!Number.isFinite(base)) base = 0;
      // Wände reichen am Hang etwas in den Boden (yw), das Fensterraster zählt ab dem Sockel (y0)
      const h = base + hM / mPerU, y0 = base + minM / mPerU, yw = minM > 0 ? y0 : y0 - (opt.elev ? 0.25 : 0);
      const tall = hM >= 55 || (hM >= 34 && area > 900 && style !== 'eu');
      // Art für den Fassaden-Shader: 0 Wohnhaus, 1 Glas und Büro, 2 Halle und Industrie (große flache Bauten), 3 Sockelteil
      const kind = tall ? 1 : area > 3500 && hM < 16 ? 2 : minM > 0 ? 3 : 0;
      let col = tall ? glassC[(seed * glassC.length) | 0] : wallC[(seed * wallC.length) | 0];
      if (given) col = mixc(col, given, 0.55);
      if (kind === 2) col = mixc(col, hex('#d4d0c8'), 0.5);
      const attr = [seed, h, y0, kind];
      const big = hM >= 15 || area >= 600;
      // Flachdach mit Brüstung? Dann reichen die Wände 0,6 m über das Dach (das Hauptgesims malt sie hell), innen eine Fläche
      const willPitch = !far && !P.holes.length && xs.length <= 14 && kind === 0 && hM <= (style === 'eu' ? 30 : 14) && area >= 40 && area <= (style === 'eu' ? 2600 : 420) && minM === 0 && seed < ({ eu: 0.82, jp: 0.55, us: 0.45, warm: 0.05, trop: 0.3 }[style] ?? 0.45);
      const ph = !far && hM > 5 && area > 120 && !willPitch ? 0.06 : 0, hw = h + ph;
      const B = big ? BB : BS, list = big ? listB : listS;
      const t0 = B.count(), v0 = B.v;
      // Wände
      const n = xs.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, dx = xs[j] - xs[i], dz = zs[j] - zs[i], L = Math.hypot(dx, dz);
        if (L < 1e-5) continue;
        const want = [dz / L, 0, -dx / L];
        B.quad([xs[i], yw, zs[i]], [xs[j], yw, zs[j]], [xs[j], hw, zs[j]], [xs[i], hw, zs[i]], col, attr, want, L);
      }
      for (const hr of P.holes) {
        const hx = [], hz = [];
        for (let i = 0; i < hr.length; i += 2) { hx.push(X(hr[i])); hz.push(Zc(hr[i + 1])); }
        for (let i = 0; i < hx.length; i++) {
          const j = (i + 1) % hx.length, dx = hx[j] - hx[i], dz = hz[j] - hz[i], L = Math.hypot(dx, dz);
          if (L < 1e-5) continue;
          // Löcher laufen andersherum, ihre Außenseite zeigt in den Hof: dieselbe Formel
          const want = [dz / L, 0, -dx / L];
          B.quad([hx[i], yw, hz[i]], [hx[j], yw, hz[j]], [hx[j], hw, hz[j]], [hx[i], hw, hz[i]], col, attr, want, L);
        }
      }
      // Dach: Walm oder Mansarde für einfache, nicht zu große Häuser, sonst flach mit dunklerer Dachhaut
      const rc = roofC[((seed * 977) % 1 * roofC.length) | 0];
      let pitched = false;
      const want = [0, 1, 0];
      if (willPitch) {
        // Breite grob aus Fläche und Umfang
        let per = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n; per += Math.hypot(xs[j] - xs[i], zs[j] - zs[i]); }
        const wid = (2 * area / mPerU / mPerU) / per;
        const d = Math.min(wid * 0.45, 0.5), rise = Math.min(d * (style === 'eu' ? 1.1 : 0.8), 0.45);
        const I = d > 0.05 ? inset(xs, zs, d) : null;
        if (I) {
          pitched = true;
          const [ix, iz] = I, top = h + rise;
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            B.quad([xs[i], h, zs[i]], [xs[j], h, zs[j]], [ix[j], top, iz[j]], [ix[i], top, iz[i]], rc, attr, want, Math.hypot(xs[j] - xs[i], zs[j] - zs[i]));
          }
          const tr = triangulate(ix.map((x, k) => [x, iz[k]]), []);
          if (tr) B.poly(tr, top, rc, attr);
          // Schornsteine aus Ziegel nahe am First (wie die Häuser der Inselwelt)
          if (!far && (style === 'eu' || style === 'us') && seed > 0.2) {
            const nc = seed > 0.7 ? 2 : 1, ang = mainAxis(xs, zs);
            for (let c = 0; c < nc; c++) {
              const k = (hash(seed * 1e6, 11 + c) * ix.length) | 0, px = ix[k] * 0.6 + cx * 0.4, pz = iz[k] * 0.6 + cz * 0.4;
              rboxAt(B, px, top - rise * 0.55, pz, 0.055, rise * 0.55 + 0.09, 0.075, ang, hex(c ? '#9a5a46' : '#a8644c'), attr);
            }
          }
        }
      }
      if (!pitched) {
        const flat = tall ? mixc(col, hex('#8f9aa3'), 0.5) : mixc(col, hex(style === 'jp' ? '#a7aaa8' : '#b4ada2'), 0.6);
        const tr = triangulate(xs.map((x, k) => [x, zs[k]]), P.holes.map(hr => { const o = []; for (let i = 0; i < hr.length; i += 2) o.push([X(hr[i]), Zc(hr[i + 1])]); return o; }));
        if (tr) B.poly(tr, h, flat, attr);
        // Brüstung (seit 27.10.2026): die Wände reichen schon über das Dach, hier nur die Innenseite, etwas dunkler
        if (ph) {
          const inner = mixc(col, hex('#8f8a84'), 0.35);
          const rim = (rx, rz) => { for (let i = 0; i < rx.length; i++) {
            const j = (i + 1) % rx.length, dx = rx[j] - rx[i], dz = rz[j] - rz[i], L = Math.hypot(dx, dz);
            if (L < 1e-5) continue;
            B.quad([rx[j], h, rz[j]], [rx[i], h, rz[i]], [rx[i], hw, rz[i]], [rx[j], hw, rz[j]], inner, attr, [-dz / L, 0, dx / L], L);
          } };
          rim(xs, zs);
          for (const hr of P.holes) { const hx = [], hz = []; for (let i = 0; i < hr.length; i += 2) { hx.push(X(hr[i])); hz.push(Zc(hr[i + 1])); } rim(hx, hz); }
        }
        // Dachlandschaft wie in der Inselwelt (seit 27.10.2026): Treppenhaus, Lüftungskästen, Solarreihen oder Dachgarten,
        // ausgerichtet an der längsten Wand, im inneren Bereich des Daches
        if (!far && area > 120 && hM > 6) {
          const ang = mainAxis(xs, zs), ca = Math.cos(ang), sa = Math.sin(ang), rin = Math.sqrt(area) / mPerU * 0.22;
          const at = (a, b) => [cx + (a * ca - b * sa) * rin, cz + (a * sa + b * ca) * rin];
          const r2 = k => hash(seed * 1e6, k) - 0.5;
          if (area > 300 && seed > 0.35) { const s2 = Math.min(0.32, rin * 0.5), [bx, bz] = at(r2(3), r2(5)); rboxAt(B, bx, h, bz, s2, 0.14 + seed * 0.1, s2 * 0.75, ang, mixc(flat, hex('#d8d4cc'), 0.4), attr); }
          const nAC = area > 1500 ? 3 : area > 450 ? 2 : 1;
          for (let k = 0; k < nAC; k++) { const [bx, bz] = at(r2(20 + k) * 1.6, r2(30 + k) * 1.6); rboxAt(B, bx, h, bz, 0.06, 0.05, 0.045, ang, hex('#c9ccce'), attr); }
          if (n <= 6 && area > 200) {
            if (seed < 0.12) { const [bx, bz] = at(0, 0); rboxAt(B, bx, h, bz, rin * 1.2, 0.025, rin * 0.9, ang, hex('#86b55a'), attr); }
            else if (seed < 0.24) for (let k = -1; k <= 1; k++) { const [bx, bz] = at(k * 0.45, 0.1); rboxAt(B, bx, h + 0.01, bz, rin * 0.3, 0.02, rin * 1.1, ang, hex('#2e4466'), attr); }
          }
        }
      }
      list.push(cx, cz, h - base, area, t0, B.count() - t0, v0, B.v - v0);
    }
  }
  const ob = BB.out(), os = BS.out(), nb = BB.count();
  const cat = (a, b) => { const o = new a.constructor(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
  const sIdx = os.index.map(i => i + ob.verts);
  out.bld = { pos: cat(ob.pos, os.pos), nrm: cat(ob.nrm, os.nrm), col: cat(ob.col, os.col), attr: cat(ob.attr, os.attr), wall: cat(ob.wall, os.wall), index: cat(ob.index, sIdx) };
  for (let i = 0; i < listS.length; i += 8) { listS[i + 4] += nb; listS[i + 6] += ob.verts; }
  out.bldList = new Float32Array(listB.concat(listS));
  out.bigTris = nb;

  // --- Bodenflächen und Wasser ---
  const G = new Buf(1 << 15), GC = new Buf(1 << 15), W = new Buf(1 << 14);
  const trees = new Buf(1 << 14);
  const coverSrc = [];
  const polyLayer = (feats, fn) => {
    for (const f of feats || []) {
      if (f.type !== 3) continue;
      const polys = [];
      for (const r0 of f.rings) {
        const a = ringArea(r0); if (Math.abs(a) < 8) continue;
        const r = inside(r0) ? r0 : clipRing(r0); if (r.length < 6) continue;
        if (a > 0) polys.push({ outer: r, holes: [] }); else if (polys.length) polys[polys.length - 1].holes.push(r);
      }
      for (const P of polys) {
        const o = []; for (let i = 0; i < P.outer.length; i += 2) o.push([X(P.outer[i]), Zc(P.outer[i + 1])]);
        const hs = P.holes.map(hr => { const q = []; for (let i = 0; i < hr.length; i += 2) q.push([X(hr[i]), Zc(hr[i + 1])]); return q; });
        const tr = triangulate(o, hs);
        if (tr) fn(f, tr, o, Math.abs(ringArea(P.outer)) * sc * sc);
      }
    }
  };
  const ground = (f, tr, o, area, cls) => {
    const L = LAND[cls]; if (!L) return;
    const c = hex(L[0]), y = 0.004 + L[1] * 0.0035;
    if (!onTerrain) for (const [a, b, d] of tr.faces) {
      // nach oben zeigend (Dreiecke aus der Triangulierung liegen in x, z)
      const A = tr.pts[a], Bp = tr.pts[b], D = tr.pts[d];
      const up = (Bp.x - A.x) * (D.y - A.y) - (Bp.y - A.y) * (D.x - A.x) < 0;
      if (up) G.push(A.x, y, A.y, Bp.x, y, Bp.y, D.x, y, D.y); else G.push(A.x, y, A.y, D.x, y, D.y, Bp.x, y, Bp.y);
      GC.push(...c, ...c, ...c);
    }
    // Bäume: Wald dicht, Parks und Wiesen locker (eine Krone je so viele m²)
    const per = far ? 0 : cls === 'wood' || cls === 'forest' ? 70 : cls === 'park' || cls === 'grass' || cls === 'cemetery' || cls === 'garden' || cls === 'recreation_ground' || cls === 'zoo' ? 420 : cls === 'wetland' ? 300 : 0;
    if (per) scatterTrees(trees, tr, area * mPerU * mPerU / per, seedT + o.length * 31, cls === 'wood' || cls === 'forest' ? 0 : 1);
    if (!far && COVER[cls]) coverSrc.push({ tr, m2: area * mPerU * mPerU, c: COVER[cls], seed: seedT + o.length * 17 });
  };
  polyLayer(layers.landcover?.features, (f, tr, o, a) => ground(f, tr, o, a, f.props.subclass === 'park' ? 'park' : f.props.class));
  if (!far) polyLayer(layers.landuse?.features, (f, tr, o, a) => ground(f, tr, o, a, f.props.class));
  polyLayer(layers.park?.features, () => {});
  if (!onTerrain) polyLayer(layers.water?.features, (f, tr) => {
    if (f.props.brunnel === 'tunnel') return;
    for (const [a, b, d] of tr.faces) {
      const A = tr.pts[a], Bp = tr.pts[b], D = tr.pts[d];
      const up = (Bp.x - A.x) * (D.y - A.y) - (Bp.y - A.y) * (D.x - A.x) < 0;
      if (up) W.push(A.x, 0, A.y, Bp.x, 0, Bp.y, D.x, 0, D.y); else W.push(A.x, 0, A.y, D.x, 0, D.y, Bp.x, 0, Bp.y);
    }
  });
  out.ground = { pos: G.out(), col: GC.out() };
  out.water = W.out();

  // --- Straßen, Wege, Bahnen ---
  const R = new Buf(1 << 15), RA = new Buf(1 << 15), SW = new Buf(1 << 14), SWA = new Buf(1 << 14), RL = new Buf(1 << 13), RLA = new Buf(1 << 13);
  const walk = [], drive = [];
  // Belegung (seit 27.10.2026): Raster rund 2 m, Straßen und Wege markieren es, damit Gras und Blumen nicht durch den Belag
  // wachsen und Bänke frei stehen. Laternen an Straßen mit Gehweg, Bänke und Laternen an Fußwegen
  const GN = 768, cellU = T / GN, occ = far ? null : new Uint8Array(GN * GN);
  const stamp = (x0, z0, x1, z1, r) => {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L / (cellU * 0.7))), rc = Math.ceil(r / cellU);
    for (let k = 0; k <= n; k++) {
      const cx = ((x0 + (x1 - x0) * k / n - ox) / cellU) | 0, cz = ((z0 + (z1 - z0) * k / n - oz) / cellU) | 0;
      for (let dz = -rc; dz <= rc; dz++) for (let dx = -rc; dx <= rc; dx++) {
        const gx = cx + dx, gz = cz + dz;
        if (gx >= 0 && gz >= 0 && gx < GN && gz < GN && dx * dx + dz * dz <= rc * rc + 1) occ[gz * GN + gx] = 1;
      }
    }
  };
  const isOcc = (x, z) => { const gx = ((x - ox) / cellU) | 0, gz = ((z - oz) / cellU) | 0; return gx < 0 || gz < 0 || gx >= GN || gz >= GN || occ[gz * GN + gx] === 1; };
  const props = new Buf(1 << 12);
  const along = (q, step, fn) => {
    let acc = step * 0.5;
    for (let i = 0; i + 3 < q.length; i += 2) {
      const dx = q[i + 2] - q[i], dz = q[i + 3] - q[i + 1], l = Math.hypot(dx, dz); if (l < 1e-5) continue;
      while (acc < l) { const t = acc / l; fn(q[i] + dx * t, q[i + 1] + dz * t, dx / l, dz / l); acc += step; }
      acc -= l;
    }
  };
  const ribbon = (P, A, pts, half, y, lvl, extra) => {
    // pts: [x, z, ...] in Einheiten; Gehrung an den Knicken
    const n = pts.length / 2; if (n < 2) return 0;
    let along = 0;
    const L = [], Rr = [], V = [];
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2], z = pts[i * 2 + 1];
      const p = Math.max(0, i - 1), q = Math.min(n - 1, i + 1);
      let dx = pts[q * 2] - pts[p * 2], dz = pts[q * 2 + 1] - pts[p * 2 + 1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      let k = 1;
      if (i > 0 && i < n - 1) {
        let ax = x - pts[p * 2], az = z - pts[p * 2 + 1]; const la = Math.hypot(ax, az) || 1; ax /= la; az /= la;
        k = 1 / Math.max(0.45, ax * dx + az * dz);
      }
      if (i > 0) along += Math.hypot(x - pts[(i - 1) * 2], z - pts[(i - 1) * 2 + 1]);
      L.push(x - dz * half * k, z + dx * half * k); Rr.push(x + dz * half * k, z - dx * half * k); V.push(along);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = [L[i * 2], L[i * 2 + 1]], b = [Rr[i * 2], Rr[i * 2 + 1]], c = [L[i * 2 + 2], L[i * 2 + 3]], d = [Rr[i * 2 + 2], Rr[i * 2 + 3]];
      // zwei Dreiecke, nach oben zeigend
      const ya = y + E(a[0], a[1]), yb = y + E(b[0], b[1]), yc = y + E(c[0], c[1]), yd = y + E(d[0], d[1]);
      P.push(a[0], ya, a[1], c[0], yc, c[1], b[0], yb, b[1], b[0], yb, b[1], c[0], yc, c[1], d[0], yd, d[1]);
      const v0 = V[i] * mPerU, v1 = V[i + 1] * mPerU;
      A.push(-1, v0, lvl, extra, -1, v1, lvl, extra, 1, v0, lvl, extra, 1, v0, lvl, extra, -1, v1, lvl, extra, 1, v1, lvl, extra);
    }
    return along;
  };
  const feats = layers.transportation?.features || [];
  // Reihenfolge: kleine Wege zuerst, große Straßen zuletzt (liegen oben)
  const order = f => (ROAD[f.props.class]?.[1] || 0) * 10 + (f.props.brunnel === 'bridge' ? 5 : 0);
  for (const f of [...feats].sort((a, b) => order(a) - order(b))) {
    const p = f.props, cls = p.class;
    if (p.brunnel === 'tunnel' || f.type !== 2) continue;
    const lines = [];
    for (const r of f.rings) for (const part of clipLine(r)) { const q = []; for (let i = 0; i < part.length; i += 2) q.push(X(part[i]), Zc(part[i + 1])); lines.push(q); }
    if (far && (cls === 'rail' || cls === 'transit' || cls === 'path')) continue;
    if (cls === 'rail' || cls === 'transit') {
      if (p.subclass && !['rail', 'light_rail', 'tram', 'narrow_gauge', 'subway', 'monorail'].includes(p.subclass)) continue;
      if (p.subclass === 'subway' && p.brunnel !== 'bridge') continue;
      const tram = p.subclass === 'tram';
      for (const q of lines) ribbon(RL, RLA, q, (tram ? 1.6 : 2.4) / mPerU, tram ? 0.02 : 0.012, tram ? 6 : 5, 0);
      continue;
    }
    const R0 = ROAD[cls]; if (!R0 || (far && R0[1] < 3)) continue;
    let w = R0[0];
    if (cls === 'path') w = p.subclass === 'pedestrian' ? 6 : p.subclass === 'steps' ? 2.5 : p.subclass === 'cycleway' ? 2.4 : 2.2;
    if (p.ramp) w *= 0.7;
    const lvl = R0[1], y = 0.022 + lvl * 0.004 + (p.brunnel === 'bridge' ? 0.008 : 0);
    for (const q of lines) {
      const len = ribbon(R, RA, q, w / 2 / mPerU, y, lvl + (cls === 'path' && p.subclass === 'pedestrian' ? 0.5 : 0), p.oneway ? 1 : 0);
      const side = WALKSIDE[cls];
      if (occ) for (let i = 0; i + 3 < q.length; i += 2) stamp(q[i], q[i + 1], q[i + 2], q[i + 3], (w / 2 + (side ? side + 0.4 : 0.15)) / mPerU);
      if (occ && p.brunnel !== 'bridge') {
        // Laternen am Bordstein, abwechselnd links und rechts, rund alle 28 m
        if (side && lvl >= 2) { let k = 0; along(q, 2.8, (x, z, ux, uz) => { const sg = k++ % 2 ? 1 : -1, off = (w / 2 + side * 0.22) / mPerU; props.push(x - uz * off * sg, 0, z + ux * off * sg, 0, 0); }); }
        // Fußwege: Bänke mit Blick auf den Weg und vereinzelte Laternen
        if (cls === 'path' && p.subclass !== 'steps' && p.subclass !== 'cycleway') {
          let k = 0;
          along(q, 4.2, (x, z, ux, uz) => {
            const sg = hash(Math.round(x * 31), Math.round(z * 17)) < 0.5 ? 1 : -1, off = (w / 2 + 1.4) / mPerU;
            const bx = x - uz * off * sg, bz = z + ux * off * sg;
            if (k++ % 3 === 2) props.push(x + uz * off * sg, 0, z - ux * off * sg, 0, 0);
            else props.push(bx, 0, bz, 1, Math.atan2(uz * sg, -ux * sg));
          });
        }
      }
      if (side && !far) ribbon(SW, SWA, q, (w / 2 + side) / mPerU, 0.016 + lvl * 0.002, 7, Math.round((w / 2 + side) * 10) * 1000 + Math.round(w / 2 * 10));
      if (!far && lvl >= 1 && len > 0.4) {
        const q3 = new Float32Array(q.length / 2 * 3);
        for (let i = 0, k = 0; i < q.length; i += 2, k += 3) { q3[k] = q[i]; q3[k + 1] = E(q[i], q[i + 1]); q3[k + 2] = q[i + 1]; }
        if (cls === 'path' || side) walk.push({ c: cls, w: (w / 2 + (side ? side * 0.5 : 0)) / mPerU, p: q3 });
        if (lvl >= 2 && cls !== 'path') drive.push({ c: cls, lvl, w: w / 2 / mPerU, ow: p.oneway ? 1 : 0, p: q3 });
      }
      // Straßenbäume in europäischen Städten an Nebenstraßen und Alleen
      if (!far && (style === 'eu' || style === 'us') && (cls === 'minor' || cls === 'tertiary' || cls === 'secondary') && len > 1) streetTrees(trees, q, (w / 2 + (side || 2) * 0.75) / mPerU, seedT + q.length);
    }
  }
  // Graskarte und Büsche: Wiesen ins Raster malen (Dreiecke der Flächen), Straßen und Wege frei lassen; Büsche gestreut
  // ([x, y, z, Art 3, Größe, Drehung]), höchstens 900 je Kachel, gleichmäßig auf alle Flächen verteilt
  const cover = new Buf(1 << 13);
  if (occ) {
    const gm = new Uint8Array(GN * GN);
    for (const src of coverSrc) {
      const val = src.c[0], P = src.tr.pts;
      for (const [ia, ib, ic] of src.tr.faces) {
        const A = P[ia], Bp = P[ib], C = P[ic];
        const x0 = Math.max(0, Math.floor((Math.min(A.x, Bp.x, C.x) - ox) / cellU)), x1 = Math.min(GN - 1, Math.ceil((Math.max(A.x, Bp.x, C.x) - ox) / cellU));
        const z0 = Math.max(0, Math.floor((Math.min(A.y, Bp.y, C.y) - oz) / cellU)), z1 = Math.min(GN - 1, Math.ceil((Math.max(A.y, Bp.y, C.y) - oz) / cellU));
        const den = (Bp.y - C.y) * (A.x - C.x) + (C.x - Bp.x) * (A.y - C.y);
        if (Math.abs(den) < 1e-12) continue;
        for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
          const px = ox + (gx + 0.5) * cellU, pz = oz + (gz + 0.5) * cellU;
          const l1 = ((Bp.y - C.y) * (px - C.x) + (C.x - Bp.x) * (pz - C.y)) / den, l2 = ((C.y - A.y) * (px - C.x) + (A.x - C.x) * (pz - C.y)) / den;
          if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) { const i = gz * GN + gx; if (val !== 3 || !gm[i]) gm[i] = val; }
        }
      }
    }
    for (let i = 0; i < gm.length; i++) if (occ[i]) gm[i] = 0;
    out.gmask = gm;
    out.gmeta = new Float32Array([ox, oz, cellU, GN]);
    // Höhenraster 33 mal 33 für die Halme (Einheiten, Kachelrahmen)
    const ge = new Float32Array(33 * 33);
    for (let j = 0; j <= 32; j++) for (let i = 0; i <= 32; i++) ge[j * 33 + i] = E(ox + i / 32 * T, oz + j / 32 * T);
    out.gelev = ge;
    let tot = 0; for (const src of coverSrc) if (src.c[1]) tot += src.m2 / src.c[1];
    const f = Math.min(1, 900 / Math.max(1, tot));
    for (const src of coverSrc) {
      if (!src.c[1]) continue;
      const pts = scatterPts(src.tr, Math.round(src.m2 / src.c[1] * f), src.seed + 303);
      for (let k = 0; k < pts.length; k += 2) {
        const x = pts[k], z = pts[k + 1];
        if (isOcc(x, z)) continue;
        const h = hash(Math.round(x * 97), Math.round(z * 89) + 3);
        cover.push(x, E(x, z), z, 3, 0.7 + h * 0.6, h * 6.283);
      }
    }
  }
  out.cover = cover.out();
  { const pr = props.out(); for (let i = 0; i < pr.length; i += 5) { if (pr[i + 3] === 1 && isOcc(pr[i], pr[i + 2])) { pr[i + 3] = -1; continue; } pr[i + 1] = E(pr[i], pr[i + 2]); } out.props = pr; }
  out.road = { pos: R.out(), attr: RA.out() };
  out.walkway = { pos: SW.out(), attr: SWA.out() };
  out.rail = { pos: RL.out(), attr: RLA.out() };
  out.walk = walk; out.drive = drive;
  { const t4 = trees.out(), t5 = new Float32Array(t4.length / 4 * 5);
    for (let i = 0, k = 0; i < t4.length; i += 4, k += 5) { t5[k] = t4[i]; t5[k + 1] = E(t4[i], t4[i + 1]); t5[k + 2] = t4[i + 1]; t5[k + 3] = t4[i + 2]; t5[k + 4] = t4[i + 3]; }
    out.trees = t5; }

  // --- Namen ---
  const labels = [];
  if (far) { out.labels = labels; return out; }
  for (const f of layers.place?.features || []) {
    const p = f.props, r = f.rings[0]; if (!r) continue;
    const x = r[0], y = r[1]; if (x < 0 || y < 0 || x > EXT || y > EXT) continue;
    const name = nm(p, lang); if (!name) continue;
    const rank = { city: 1, town: 2, borough: 2, suburb: 3, quarter: 4, village: 4, neighbourhood: 5, hamlet: 6, island: 4 }[p.class] || 6;
    labels.push({ k: 'place', x: X(x), y: E(X(x), Zc(y)), z: Zc(y), name, rank });
  }
  for (const f of layers.poi?.features || []) {
    const p = f.props, r = f.rings[0]; if (!r) continue;
    const x = r[0], y = r[1]; if (x < 0 || y < 0 || x > EXT || y > EXT) continue;
    const name = nm(p, lang); if (!name) continue;
    const want = p.class === 'attraction' || p.class === 'museum' || p.class === 'stadium' || p.class === 'castle' || p.class === 'monument' || p.class === 'place_of_worship' || (p.class === 'railway' && p.subclass === 'station') || p.class === 'town_hall' || p.class === 'theatre' || p.class === 'zoo' || p.class === 'park';
    if (!want) continue;
    labels.push({ k: 'poi', c: p.class, s: p.subclass || '', x: X(x), y: E(X(x), Zc(y)), z: Zc(y), name, rank: p.rank || 30 });
  }
  for (const f of layers.water_name?.features || []) {
    const p = f.props, r = f.rings[0]; if (!r) continue;
    const name = nm(p, lang); if (!name) continue;
    const x = r[0], y = r[1]; if (x < 0 || y < 0 || x > EXT || y > EXT) continue;
    labels.push({ k: 'water', x: X(x), y: E(X(x), Zc(y)), z: Zc(y), name, rank: 4 });
  }
  out.labels = labels;
  return out;
}

// Hauptrichtung eines Grundrisses: Winkel der längsten Wand
function mainAxis(xs, zs) {
  let best = 0, ang = 0;
  for (let i = 0; i < xs.length; i++) { const j = (i + 1) % xs.length, dx = xs[j] - xs[i], dz = zs[j] - zs[i], l = dx * dx + dz * dz; if (l > best) { best = l; ang = Math.atan2(dz, dx); } }
  return ang;
}
// Kasten mit Drehung um die Hochachse (Dachaufbauten parallel zu den Wänden)
function rboxAt(B, x, y, z, w, h, d, ang, col, attr) {
  const ca = Math.cos(ang), sa = Math.sin(ang), y1 = y + h;
  const P = (a, b, yy) => [x + a * ca - b * sa, yy, z + a * sa + b * ca];
  const hw = w / 2, hd = d / 2;
  const c = [P(-hw, -hd, 0), P(hw, -hd, 0), P(hw, hd, 0), P(-hw, hd, 0)];
  const a2 = [attr[0], attr[1] + h, attr[2], 3];
  for (let i = 0; i < 4; i++) {
    const p0 = c[i], p1 = c[(i + 1) % 4];
    const nx = p1[2] - p0[2], nz = -(p1[0] - p0[0]), l = Math.hypot(nx, nz) || 1;
    // nach außen: weg von der Mitte
    const ox = (p0[0] + p1[0]) / 2 - x, oz = (p0[2] + p1[2]) / 2 - z, sg = nx * ox + nz * oz >= 0 ? 1 : -1;
    B.quad([p0[0], y, p0[2]], [p1[0], y, p1[2]], [p1[0], y1, p1[2]], [p0[0], y1, p0[2]], col, a2, [sg * nx / l, 0, sg * nz / l]);
  }
  B.quad([c[0][0], y1, c[0][2]], [c[1][0], y1, c[1][2]], [c[2][0], y1, c[2][2]], [c[3][0], y1, c[3][2]], col, a2, [0, 1, 0]);
}

function boxAt(B, x, y, z, w, h, d, col, attr) {
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, y1 = y + h;
  const P = (a, b, c) => [a, b, c];
  const quads = [
    [P(x0, y, z0), P(x1, y, z0), P(x1, y1, z0), P(x0, y1, z0), [0, 0, -1]],
    [P(x1, y, z1), P(x0, y, z1), P(x0, y1, z1), P(x1, y1, z1), [0, 0, 1]],
    [P(x0, y, z1), P(x0, y, z0), P(x0, y1, z0), P(x0, y1, z1), [-1, 0, 0]],
    [P(x1, y, z0), P(x1, y, z1), P(x1, y1, z1), P(x1, y1, z0), [1, 0, 0]],
    [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1), [0, 1, 0]],
  ];
  const a2 = [attr[0], attr[1] + h, attr[2], 3];
  for (const [a, b, c, d, n] of quads) B.quad(a, b, c, d, col, a2, n);
}

// Bäume gleichmäßig in einer Fläche verteilen (Dreiecke nach Fläche gewichtet), [x, z, Größe, Art]
function scatterTrees(T, tr, n, seed, kind) {
  n = Math.min(Math.round(n), 2500);
  if (n < 1) return;
  const faces = tr.faces, pts = tr.pts, acc = [];
  let sum = 0;
  for (const [a, b, c] of faces) { const A = pts[a], Bp = pts[b], C = pts[c]; sum += Math.abs((Bp.x - A.x) * (C.y - A.y) - (Bp.y - A.y) * (C.x - A.x)) / 2; acc.push(sum); }
  if (sum <= 0) return;
  for (let k = 0; k < n; k++) {
    const r = hash(seed + k * 17, 11) * sum;
    let lo = 0, hi = acc.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (acc[m] < r) lo = m + 1; else hi = m; }
    const [a, b, c] = faces[lo], A = pts[a], Bp = pts[b], C = pts[c];
    let u = hash(seed + k * 31, 3), v = hash(seed + k * 37, 5); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    T.p4(A.x + (Bp.x - A.x) * u + (C.x - A.x) * v, A.y + (Bp.y - A.y) * u + (C.y - A.y) * v, 0.75 + hash(seed + k, 9) * 0.6, kind);
  }
}
// Punkte gleichmäßig in einer Triangulierung (wie scatterTrees), flach [x, z, ...]
function scatterPts(tr, n, seed) {
  const out = [], faces = tr.faces, pts = tr.pts, acc = [];
  let sum = 0;
  for (const [a, b, c] of faces) { const A = pts[a], Bp = pts[b], C = pts[c]; sum += Math.abs((Bp.x - A.x) * (C.y - A.y) - (Bp.y - A.y) * (C.x - A.x)) / 2; acc.push(sum); }
  if (sum <= 0) return out;
  for (let k = 0; k < n; k++) {
    const r = hash(seed + k * 13, 7) * sum;
    let lo = 0, hi = acc.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (acc[m] < r) lo = m + 1; else hi = m; }
    const [a, b, c] = faces[lo], A = pts[a], Bp = pts[b], C = pts[c];
    let u = hash(seed + k * 29, 3), v = hash(seed + k * 41, 5); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    out.push(A.x + (Bp.x - A.x) * u + (C.x - A.x) * v, A.y + (Bp.y - A.y) * u + (C.y - A.y) * v);
  }
  return out;
}
function streetTrees(T, q, off, seed) {
  let acc = 0;
  for (let i = 0; i + 3 < q.length; i += 2) {
    const dx = q[i + 2] - q[i], dz = q[i + 3] - q[i + 1], l = Math.hypot(dx, dz); if (l < 1e-4) continue;
    const ux = dx / l, uz = dz / l;
    for (let s = (1.3 - acc % 1.3); s < l; s += 1.3) {
      const x = q[i] + ux * s, z = q[i + 1] + uz * s, h = hash(seed + Math.round(x * 31), Math.round(z * 17));
      if (h < 0.18) continue;
      T.p4(x - uz * off, z + ux * off, 0.6 + h * 0.35, 2);
      if (h > 0.4) T.p4(x + uz * off, z - ux * off, 0.6 + h * 0.35, 2);
    }
    acc += l;
  }
}
