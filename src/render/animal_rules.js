// Regeln für Tiere (seit 21.10.2026, Naders Wunsch: Tiere laufen nicht mehr wild überall herum, Kühe nicht auf Straßen,
// realistische Regeln für jede Art). Nur im Bild, die Simulation bleibt unberührt.
// Jede Kachel bekommt Merkmale (Meer, Fluss, Gebäude, Feld, Straße, Platz, Steilhang, im Ort) und einen Abstand zum
// nächsten Ortsrand. Jede Art hat eine Regel, wo sie stehen darf:
// - Wildtiere nie auf Straßen, Zufahrten, Plätzen, in Gebäuden oder im Wasser, und nur mit Abstand zu Orten (scheu).
//   Huftiere der Ebene (Pferde, Zebras, Antilopen, Giraffen, Kamele) meiden Steilhänge, Rehe treten am Waldrand auf
//   Felder, Feldhasen leben auf Feldern, Frösche und Reiher am Wasser.
// - Kühe nur auf ihrer Weide am Viehhof (eingezäunt, `pasture`: offene Wiese ohne Wald und Strand, zusammenhängend, ab 3 Feldern),
//   keine Flucht vor Menschen, nachts liegen sie.
// - Hunde, Katzen, Hühner gehören zu einem Haus: Tür (nur wenn davor freier Boden ist) und Hof, nie die Fahrbahn.
//   Hühner nachts im Stall.
// Merkmale werden nur für Kacheln gerechnet, nach denen gefragt wird, und gelten bis zum nächsten `refresh` (alle 3 s).
import { NX, NY } from './scene.js';

export const T_SEA = 1, T_RIVER = 2, T_BLD = 4, T_FIELD = 8, T_STREET = 16, T_PLAZA = 32, T_STEEP = 64, T_TOWN = 128;
const BLOCK = T_SEA | T_RIVER | T_BLD | T_STREET | T_PLAZA;

// shy: Felder Abstand zum Ortsrand, steep: darf an Steilhängen stehen, field: darf auf Felder, wet: lebt am Wasser
export const RULES = {
  deer: { shy: 6, steep: true, field: true },
  stag: { shy: 7, steep: true },
  reindeer: { shy: 5, steep: true },
  antelope: { shy: 6 },
  horse: { shy: 7 },
  zebra: { shy: 7 },
  giraffe: { shy: 8 },
  camel: { shy: 4 },
  hare: { shy: 2, field: true },
  snowhare: { shy: 3, steep: true },
  lizard: { shy: 2, steep: true },
  scorpion: { shy: 3, steep: true },
  snake: { shy: 4, steep: true },
  frog: { shy: 2, wet: true },
  heron: { shy: 4, wet: true },
  dragonfly: { shy: 1, wet: true, field: true },
  butterfly: { shy: 0, field: true, steep: true },
  seal: { shy: 6, steep: true },
  wolf: { shy: 0, steep: true },
  fox: { shy: 0, steep: true, field: true },
};

export class AnimalRules {
  constructor() {
    this.gen = 1;
    this.st = null;
    this.street = null; // Straßenfelder aus render/streets.js (Ortsstraßen, Gassen, Landstraßen)
    this.towns = [];
  }

  refresh(st) {
    this.st = st;
    this.gen = (this.gen % 65000) + 1;
    if (!this.cls || this.cls.length !== NX * NY) { this.cls = new Uint8Array(NX * NY); this.mark = new Uint16Array(NX * NY); this.td = new Uint8Array(NX * NY); }
    this.towns = st.settlements.filter(s => s.alive).map(s => [s.cx, s.cy, s.R || 4]);
  }

  info(i) {
    if (this.mark[i] !== this.gen) { this.compute(i); this.mark[i] = this.gen; }
    return this.cls[i];
  }
  // Abstand zum nächsten Ortsrand in Feldern (0 = im Ort)
  townDist(i) { this.info(i); return this.td[i]; }

  compute(i) {
    const st = this.st, T = st.tiles, rt = st._rt, x = i % NX, y = (i / NX) | 0;
    let c = 0;
    if (T.h[i] < 0) c |= T_SEA;
    if (T.river && T.river[i]) c |= T_RIVER;
    const b = rt.bldAt && rt.bldAt[i];
    if (b) { const B = rt.bById && rt.bById.get(b); c |= B && B.t === 'feld' ? T_FIELD : T_BLD; }
    const sv = T.st ? T.st[i] : 0;
    if ((this.street && this.street[i]) || (rt.roadNet && rt.roadNet[i]) || ((sv & 3) && (sv & 4))) c |= T_STREET;
    if (sv & 8) c |= T_PLAZA;
    if ((T.burn && T.burn[i]) || (rt.findAt && rt.findAt.has(i))) c |= T_BLD; // Brandstellen und Fundorte (Ruinen, Steinkreise) wie Gebäude
    // steil: Hochgebirge oder ein Sprung von zwei Höhenstufen zu einem Nachbarn
    const H = rt.hb || T.h;
    if (H[i] >= 6) c |= T_STEEP;
    else for (const d of [1, -1, NX, -NX]) { const j = i + d; if (j >= 0 && j < H.length && H[j] >= 0 && Math.abs(H[j] - H[i]) >= 2) { c |= T_STEEP; break; } }
    let dm = 250;
    for (const [cx, cy, R] of this.towns) { const d = Math.hypot(cx - x, cy - y) - R; if (d < dm) dm = d; }
    this.td[i] = Math.max(0, Math.min(250, Math.round(dm)));
    if (dm <= 0) c |= T_TOWN;
    this.cls[i] = c;
  }

  // Darf ein Wildtier dieser Art hier stehen?
  can(sp, i) {
    if (i < 0 || i >= NX * NY) return false;
    const r = RULES[sp] || RULES.deer, c = this.info(i);
    if (c & T_RIVER) return !!r.wet;
    if (c & (T_SEA | T_BLD | T_STREET | T_PLAZA)) return false;
    if ((c & T_FIELD) && !r.field) return false;
    if ((c & T_STEEP) && !r.steep) return false;
    return this.td[i] >= r.shy;
  }

  // Weide eines Viehhofs: zusammenhängende freie Wiese rund um den Stall (kein Weg, kein Feld, kein Haus, kein Wasser,
  // kein Steilhang), höchstens 4,3 Felder weit, lieber auf der Seite weg vom Ort. Kacheln als Index.
  pasture(st, b) {
    const TR = st.tiles.tree, H = st._rt.hb || st.tiles.h;
    // offene Wiese: kein Wald, kein Strand
    const ok = i => i >= 0 && i < NX * NY && !(this.info(i) & (BLOCK | T_FIELD | T_STEEP)) && !(TR && TR[i] >= 2) && H[i] >= 1;
    const seen = new Set([b.y * NX + b.x]), q = [], out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = b.x + dx, y = b.y + dy;
      if (x < 0 || y < 0 || x >= NX || y >= NY) continue;
      const i = y * NX + x;
      if (ok(i) && !seen.has(i)) { seen.add(i); q.push(i); }
    }
    while (q.length && out.length < 18) {
      const i = q.shift();
      out.push(i);
      const x = i % NX, y = (i / NX) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy, j = yy * NX + xx;
        if (xx < 0 || yy < 0 || xx >= NX || yy >= NY || seen.has(j)) continue;
        seen.add(j);
        if (Math.hypot(xx - b.x, yy - b.y) <= 4.3 && ok(j)) q.push(j);
      }
    }
    // außerhalb des Ortes, wenn das reicht; sonst die Wiese, die es gibt
    const outside = out.filter(i => this.td[i] > 0);
    const pick = outside.length >= 4 ? outside : out;
    // nur das größte zusammenhängende Stück (über Kanten, nicht über den Stall), mindestens 3 Felder
    const set = new Set(pick), done = new Set();
    let best = [];
    for (const i0 of pick) {
      if (done.has(i0)) continue;
      const comp = [i0], q = [i0];
      done.add(i0);
      while (q.length) {
        const i = q.pop();
        for (const d of [1, -1, NX, -NX]) { const j = i + d; if (set.has(j) && !done.has(j)) { done.add(j); comp.push(j); q.push(j); } }
      }
      if (comp.length > best.length) best = comp;
    }
    return best.length >= 3 ? best : [];
  }

  // Hof eines Hauses: freie Nachbarfelder (kein Weg, kein Platz, kein Haus, kein Feld, kein Wasser)
  yard(st, b) {
    const out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = b.x + dx, y = b.y + dy;
      if (x < 0 || y < 0 || x >= NX || y >= NY) continue;
      const i = y * NX + x;
      if (!(this.info(i) & (BLOCK | T_FIELD | T_STEEP))) out.push(i);
    }
    return out;
  }

  isStreet(i) { return i >= 0 && i < NX * NY && !!(this.info(i) & T_STREET); }
}

// Liegt der Weg von (ax, az) nach (bx, bz) durch einen Kreis (Hauswand)? Dann über die Seite gehen.
export function around(ax, az, bx, bz, cx, cz, r) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  if (L2 < 1e-6) return null;
  const u = Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / L2));
  const px = ax + dx * u - cx, pz = az + dz * u - cz;
  if (px * px + pz * pz > r * r || u <= 0 || u >= 1) return null;
  const L = Math.sqrt(L2), nx = -dz / L, nz = dx / L;
  const side = (ax - cx) * nx + (az - cz) * nz >= 0 ? 1 : -1;
  return [cx + nx * side * (r + 0.18), cz + nz * side * (r + 0.18)];
}
