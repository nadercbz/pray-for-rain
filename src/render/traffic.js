// Belegung für die Verkehrsregeln (seit 25.10.2026): gemeinsamer Baustein von Fahrzeugen (render/vehicles.js) und Schiffen
// (render/ships.js). Jedes bewegte Ding trägt sich je Bild als gedrehter Kasten ein (Mitte x, z, vorwärts (c, -s), halbe
// Länge hl und Breite hw, Tempo cur). Gelesen wird immer das Raster des letzten Bildes (prev), geschrieben das aktuelle.
// Daraus: was liegt im Weg vor einem (ahead), würde ein Schritt etwas berühren (hits), berührt man in diesem Bild etwas,
// das schon gesetzt ist (touch).
const CELL = 0.8;
const key = (x, z) => (Math.floor(x / CELL) + 4096) * 8192 + Math.floor(z / CELL) + 4096;

// Projektion eines Kastens auf eine Achse, leicht geschrumpft (sh), damit Streifkontakte nicht zählen
function proj(o, nx, nz, sh) {
  const m = o.x * nx + o.z * nz, r = Math.abs(o.hl * (o.c * nx - o.s * nz)) + Math.abs(o.hw * (o.s * nx + o.c * nz));
  return [m - r * sh, m + r * sh];
}
// Überlappen sich zwei gedrehte Kästen? (Trennachsen)
export function overlap(a, b, sh = 0.95) {
  for (const [nx, nz] of [[a.c, -a.s], [a.s, a.c], [b.c, -b.s], [b.s, b.c]]) {
    const p = proj(a, nx, nz, sh), q = proj(b, nx, nz, sh);
    if (p[1] < q[0] || q[1] < p[0]) return false;
  }
  return true;
}

export class Occ {
  constructor(cell = CELL) {
    this.list = []; this.n = 0; this.grid = new Map();   // aktuelles Bild
    this.prev = []; this.pn = 0; this.pgrid = new Map(); // letztes Bild (danach wird entschieden)
    this.cell = cell;
    this._t = { x: 0, z: 0, c: 1, s: 0, hl: 0, hw: 0 };
  }
  // neues Bild: das bisherige wird zum letzten
  begin() {
    [this.prev, this.list] = [this.list, this.prev];
    [this.pgrid, this.grid] = [this.grid, this.pgrid];
    this.pn = this.n; this.n = 0; this.grid.clear();
  }
  put(id, x, z, c, s, hl, hw, cur = 0) {
    const o = this.list[this.n] || (this.list[this.n] = {});
    o.id = id; o.x = x; o.z = z; o.c = c; o.s = s; o.hl = hl; o.hw = hw; o.cur = cur;
    const k = key(x, z), l = this.grid.get(k);
    if (l) l.push(this.n); else this.grid.set(k, [this.n]);
    this.n++;
    return o;
  }
  // alle Einträge des letzten Bildes um (x, z) im Umkreis von r Zellen
  near(x, z, fn, r = 1) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
      const l = this.pgrid.get((cx + a + 4096) * 8192 + cz + b + 4096);
      if (l) for (const j of l) if (fn(this.prev[j]) === true) return true;
    }
    return false;
  }
  // Liegt der Kasten (x, z, c, s, hl, hw) im Weg vor o? Weg: o.hl + gap + Tempo mal look (höchstens maxA)
  static ahead(o, x, z, c, s, hl, hw, gap = 0.05, look = 0.6, maxA = 0.5) {
    const rx = x - o.x, rz = z - o.z, fwd = rx * o.c - rz * o.s, lat = rx * o.s + rz * o.c;
    const dot = c * o.c + s * o.s, crs = Math.abs(c * o.s - s * o.c);
    const L = Math.abs(hl * dot) + hw * crs, W = hl * crs + Math.abs(hw * dot);
    const reach = o.hl + gap + Math.min(maxA, o.cur * look);
    return fwd > -L * 0.3 && fwd < reach + L && Math.abs(lat) < (o.hw + W) * 0.92 ? { fwd, lat, dot } : null;
  }
  // Würde der Kasten an der neuen Stelle etwas aus dem letzten Bild berühren und dabei näher kommen? (px, pz) Mitte vorher.
  // Wer schon steckt und sich entfernt oder nur dreht, darf weiter.
  hits(id, x, z, c, s, hl, hw, px, pz, r = 1) {
    const T = this._t;
    T.x = x; T.z = z; T.c = c; T.s = s; T.hl = hl; T.hw = hw;
    return this.near(x, z, o => {
      if (o.id === id || Math.abs(o.x - x) > hl + o.hl + 0.2 || Math.abs(o.z - z) > hl + o.hl + 0.2) return;
      if (overlap(T, o) && Math.hypot(x - o.x, z - o.z) < Math.hypot(px - o.x, pz - o.z) - 1e-4) return true;
    }, r);
  }
  // Berührt der Kasten etwas, das in diesem Bild schon gesetzt ist?
  touch(x, z, c, s, hl, hw, r = 1) {
    const T = this._t, cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    T.x = x; T.z = z; T.c = c; T.s = s; T.hl = hl; T.hw = hw;
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
      const l = this.grid.get((cx + a + 4096) * 8192 + cz + b + 4096);
      if (l) for (const j of l) if (overlap(T, this.list[j], 0.9)) return true;
    }
    return false;
  }
}
