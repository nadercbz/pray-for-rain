// Stadtplan mit festen Regeln (seit 20.10.2026, Naders Auftrag: Straßen genau neben den Häusern, erst die Struktur,
// dann die Häuser, nichts wirkt durcheinander, trotzdem verläuft jedes Spiel anders). Plan und Recherche: PLAN_REGELWERK.md.
//
// Prinzip: erst das Straßennetz, dann die Parzelle, dann das Haus.
// - Jeder Ort hat eine Stadtform (Haufendorf, Straßendorf, Angerdorf, Ringstadt, Rasterstadt, Blockrand, Moderne), gewählt
//   nach Epoche, Kultur, Gelände und Seed. Wechselt die Epoche, bleibt die Altstadt, die Erweiterung bekommt die neue Form.
// - Der Plan liegt als Kachelebene T.st im Boden (geplant, gebaut, Platz, Klasse) und wird mit dem Spielstand gespeichert.
// - Ein Block ist die Fläche zwischen Straßen. Er ist erschlossen, wenn jede Straße an ihm gebaut ist. Wird Bauland knapp,
//   baut der Ort zuerst alle Straßen des nächsten Blocks (Baumeister, Kachel für Kachel), erst dann gibt es dort Parzellen.
// - Eine Parzelle ist ein Feld im erschlossenen Block mit Front zu einer gebauten Straße oder zum Platz. Wohnhäuser,
//   Werkstätten, Tempel, Märkte stehen nur dort, die Tür zeigt zur Straße. Betriebe draußen bekommen eine Zufahrt.
// - checkTown prüft die Regeln R1 bis R9 (tools/ruletest.mjs, Ansicht im Baukasten).
// s.plan = { f, fs: [[Form, bis Radius]], ax, ext, core, bv, q: [Kachel], d0, nb }
import { NX, NY, idx, inb, D4 } from './world.js';
import * as D from './data.js';
import { chron, removeBuilding } from './util.js';
import { L } from '../i18n.js';

export const CLS = 3, BUILT = 4, SQUARE = 8, MANUAL = 16, TRACK = 32;

// Großbauten ragen über ihr Feld (render/buildings.js SCALE): ringsum frei, Front zum Platz oder zur Hauptstraße
export const BIG_T = new Set(['burg', 'kathedrale', 'palast', 'stadion', 'arena', 'oper', 'universitaet', 'bahnhof', 'museum', 'krankenhaus', 'werft', 'rakete']);
// Was am Platz steht (öffentlich), was an die Hauptstraße gehört (Handel und Handwerk), was an den Rand (Lärm, Platz)
const CIVIC = new Set(['schrein', 'tempel', 'markt', 'schule', 'theater', 'bibliothek', 'heiler', 'badehaus', 'kathedrale', 'palast', 'oper', 'museum', 'universitaet', 'krankenhaus', 'bank', 'monument']);
const TRADE = new Set(['werkstatt', 'taverne', 'baeckerei', 'schmiede', 'toepferei', 'gilde', 'speicher', 'raeucherei', 'labor']);
const EDGE = new Set(['kaserne', 'fabrik', 'kraftwerk', 'rakete', 'arena', 'stadion', 'bahnhof', 'wachturm']);
// Kleine Dinge, die auf den Ecken des Platzes stehen dürfen
export const PLAZA = new Set(['brunnen', 'totem', 'monument']);
// Betriebe außerhalb der Bebauung, die eine Zufahrt bekommen (R9)
export const OUTSIDE_T = new Set(['holz', 'stein', 'mine', 'fischer', 'hafen', 'werft', 'leuchtturm', 'muehle', 'stall']);

// Formen: Raster (Längsstraßen alle sx, Querstraßen alle sy, Platz sqU mal sqV) oder radial (Speichen und Ringe)
export const FORMS = {
  haufen: { radial: true, spokes: [3, 5], wob: 0.42, ring0: 4, ringStep: 4, name: L('Haufendorf', 'Clustered village') },
  ring: { radial: true, spokes: [4, 6], wob: 0.16, ring0: 4, ringStep: 4, name: L('Ringstadt', 'Ring town') },
  strasse: { sx: 4, sy: 8, sqU: 1, sqV: 1, linear: true, name: L('Straßendorf', 'Street village') },
  anger: { sx: 4, sy: 6, sqU: 1, sqV: 3, name: L('Angerdorf', 'Green village') },
  raster: { sx: 4, sy: 6, sqU: 1, sqV: 1, name: L('Rasterstadt', 'Grid town') },
  block: { sx: 5, sy: 7, sqU: 2, sqV: 2, name: L('Blockrand', 'Perimeter blocks') },
  moderne: { sx: 4, sy: 8, sqU: 2, sqV: 2, ave: 12, name: L('Moderne Stadt', 'Modern city') },
};

const hh = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const HBof = st => st._rt.hb || st.tiles.h;

// ---------- Form wählen ----------

// Wie weit reicht bebaubares Land vom Zentrum in einer Achse (für das Straßendorf an Küste, Fluss oder Hang)
function run(st, s, dx, dy) {
  const HB = HBof(st), T = st.tiles;
  let n = 0;
  for (let k = 1; k <= 14; k++) {
    const x = s.cx + dx * k, y = s.cy + dy * k;
    if (!inb(x, y)) break;
    const i = idx(x, y);
    if (HB[i] < 1 || HB[i] > 3 || T.river[i]) break;
    n++;
  }
  return n;
}

export function chooseForm(st, s) {
  const C = s.cult || {}, era = s.era || 0, r = k => hh(s.id * 7 + k, st.seed || 1);
  if (st._rt.nextForm && FORMS[st._rt.nextForm]) return { f: st._rt.nextForm, ax: r(2) < 0.5 ? 0 : 1 }; // im Baukasten gewählt
  if (era >= 7) return { f: 'moderne', ax: r(1) < 0.5 ? 0 : 1 };
  if (era >= 5) return { f: 'block', ax: r(1) < 0.5 ? 0 : 1 };
  const ex = run(st, s, 1, 0) + run(st, s, -1, 0), ey = run(st, s, 0, 1) + run(st, s, 0, -1);
  const lin = Math.max(ex, ey) / Math.max(4, Math.min(ex, ey));
  const g = v => v ?? 0.45;
  const sc = {
    haufen: (era <= 1 ? 1 : 0.3) * (0.55 + g(C.tradition) * 0.6),
    strasse: (era <= 3 ? 1 : 0.5) * Math.min(1.4, Math.max(0, lin - 1.3) * 0.8),
    anger: (era <= 3 ? 0.75 : 0.3) * (g(C.tradition) + g(C.glaube)) * 0.6,
    ring: (era >= 2 ? 1 : 0.45) * (g(C.macht) + g(C.tradition)) * 0.6,
    raster: (era >= 2 ? 1 : 0.35) * (g(C.freiheit) + g(C.handel) + g(C.wissen)) * 0.45,
  };
  let best = 'haufen', bs = -1;
  Object.keys(sc).forEach((f, k) => { const v = sc[f] + r(10 + k) * 0.45; if (v > bs) { bs = v; best = f; } });
  return { f: best, ax: best === 'strasse' ? (ex >= ey ? 1 : 0) : r(2) < 0.5 ? 0 : 1 };
}

// ---------- Plan anlegen und erweitern ----------

// Altstadt: Radius der vorhandenen Bebauung (ohne Felder). Neue Orte haben keine.
function builtRadius(st, s) {
  let m = 0;
  for (const b of st.buildings) if (b.s === s.id && b.t !== 'feld' && b.t !== 'zentrum') m = Math.max(m, Math.hypot(b.x - s.cx, b.y - s.cy));
  return m;
}

export function ensurePlan(st, s) {
  if (!st.tiles.st) st.tiles.st = new Uint8Array(NX * NY);
  if (s.plan && s.plan.v === 1) return s.plan;
  const n = st.buildings.filter(b => b.s === s.id && b.t !== 'feld' && b.t !== 'zentrum').length;
  const fc = chooseForm(st, s);
  const core = n > 3 ? Math.ceil(builtRadius(st, s) + 0.6) : 0;
  const F = FORMS[fc.f], ext0 = F.radial ? 6 : Math.ceil(Math.hypot(F.sx, F.sy)) + 1;
  s.plan = { v: 1, f: fc.f, fs: [[fc.f, 1e9]], ax: fc.ax, ext: Math.max(core + 4, ext0), core, bv: 1, q: [], d0: st.day, nb: 0, full: 0 };
  materialize(st, s);
  // so weit planen, dass es geschlossene Blöcke mit genug Bauland gibt (sonst gäbe es keine Parzellen)
  const HB = HBof(st);
  const room = () => blocksOf(st, s).list.filter(b => !b.open).reduce((a, b) => a + b.tiles.filter(i => HB[i] >= 1 && HB[i] <= 3).length, 0);
  for (let k = 0; k < 4 && room() < 8; k++) { s.plan.ext += 3; materialize(st, s); }
  // Neue Orte: die ersten Blöcke um den Platz sind sofort erschlossen (die Gründer treten die Wege fest)
  if (!core) openNearest(st, s, 2, true);
  tidyStreets(st, s); s.plan.tv = s.plan.bv; // von Anfang an ohne Sackgassen
  return s.plan;
}

// Wechsel der Epoche: die Altstadt bleibt, außerhalb gilt die neue Form (Neustadt)
export function evolveForm(st, s) {
  const P = s.plan;
  if (!P) return;
  const want = s.era >= 7 ? 'moderne' : s.era >= 5 ? 'block' : null;
  const last = P.fs[P.fs.length - 1][0];
  if (!want || last === want || (want === 'block' && last === 'moderne')) return;
  const r = Math.ceil(Math.max(P.core, builtRadius(st, s)) + 1);
  P.fs[P.fs.length - 1][1] = r;
  P.fs.push([want, 1e9]);
  P.f = want;
  chron(st, 'bau', L(`${s.name} plant eine Neustadt: jenseits der alten Gassen wird nach neuem Muster gebaut (${FORMS[want].name}).`, `${s.name} plans a new town: beyond the old lanes, building follows a new pattern (${FORMS[want].name.toLowerCase()}).`), s.id, 1);
}

const formAt = (P, d) => { for (const [f, r] of P.fs) if (d <= r) return f; return P.fs[P.fs.length - 1][0]; };

// Kandidaten des Plans im Kreis ext (Kachel -> Code: Klasse oder SQUARE)
function candidates(st, s) {
  const P = s.plan, out = new Map(), ext = P.ext;
  const put = (x, y, v) => { if (!inb(x, y)) return; const i = idx(x, y), o = out.get(i) || 0; if (v === SQUARE ? !o : (o !== SQUARE && v > o)) out.set(i, v); };
  // Platz in der Mitte (Form der Altstadt bestimmt seine Größe)
  const F0 = FORMS[P.fs[0][0]];
  const sqU = F0.radial ? 1 : F0.sqU, sqV = F0.radial ? 1 : F0.sqV;
  if (!P.core) for (let v = -sqV; v <= sqV; v++) for (let u = -sqU; u <= sqU; u++) {
    const [dx, dy] = P.ax ? [v, u] : [u, v];
    if (dx || dy) put(s.cx + dx, s.cy + dy, SQUARE);
  }
  // Radiale Teile: Speichen und Ringe, nur so weit ihre Form reicht
  const radial = P.fs.filter(([f]) => FORMS[f].radial);
  if (radial.length) {
    const rmax = Math.min(ext, Math.max(...radial.map(([, r]) => r)));
    const F = FORMS[radial[0][0]];
    const line4 = (x0, y0, x1, y1, c) => {
      let x = x0, y = y0;
      put(x, y, c);
      while (x !== x1 || y !== y1) { const dx = x1 - x, dy = y1 - y; if (Math.abs(dx) >= Math.abs(dy)) x += Math.sign(dx); else y += Math.sign(dy); put(x, y, c); }
    };
    const n = F.spokes[0] + Math.floor(hh(s.id, 3) * (F.spokes[1] - F.spokes[0] + 1));
    const a0 = hh(s.id, 7) * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const base = a0 + k * Math.PI * 2 / n + (hh(s.id, k + 1) - 0.5) * 0.5;
      let px = null, py = null;
      for (let d = 1.5; d <= rmax + 0.01; d += 0.8) {
        const a = base + Math.sin(d * 0.22 + k * 1.7 + s.id) * F.wob;
        const x = Math.round(s.cx + Math.cos(a) * d), y = Math.round(s.cy + Math.sin(a) * d);
        if (px !== null) line4(px, py, x, y, k < 2 ? 3 : 2); else put(x, y, k < 2 ? 3 : 2);
        px = x; py = y;
      }
      // Zwischenspeichen ab dem zweiten Ring, damit die Blöcke draußen nicht zu lang werden
      const mid = base + Math.PI / n + (hh(s.id, k + 11) - 0.5) * 0.3;
      px = null; py = null;
      for (let d = F.ring0 + F.ringStep - 0.5; d <= rmax + 0.01; d += 0.8) {
        const a = mid + Math.sin(d * 0.25 + k * 2.3 + s.id) * F.wob * 0.8;
        const x = Math.round(s.cx + Math.cos(a) * d), y = Math.round(s.cy + Math.sin(a) * d);
        if (px !== null) line4(px, py, x, y, 2); else put(x, y, 2);
        px = x; py = y;
      }
    }
    for (let rr = F.ring0; rr <= rmax + 0.01; rr += F.ringStep) {
      const steps = Math.ceil(rr * 2 * Math.PI * 1.4);
      let px = null, py = null;
      for (let q = 0; q <= steps; q++) {
        const a = q / steps * Math.PI * 2;
        const rad = rr + Math.sin(a * 3 + s.id * 0.7) * F.wob * 1.2;
        const x = Math.round(s.cx + Math.cos(a) * rad), y = Math.round(s.cy + Math.sin(a) * rad);
        if (px !== null) line4(px, py, x, y, rr <= 8 ? 2 : 1); else put(x, y, 1);
        px = x; py = y;
      }
    }
  }
  // Rasterteile: Längsstraßen und Querstraßen, ausgerichtet am Zentrum, damit Alt und Neu ineinander greifen
  for (let y = Math.floor(s.cy - ext); y <= Math.ceil(s.cy + ext); y++) for (let x = Math.floor(s.cx - ext); x <= Math.ceil(s.cx + ext); x++) {
    const dx = x - s.cx, dy = y - s.cy, d = Math.hypot(dx, dy);
    if (d > ext) continue;
    const f = formAt(P, d), F = FORMS[f];
    if (F.radial) continue;
    const u = P.ax ? dy : dx, v = P.ax ? dx : dy;
    if (Math.abs(u) <= F.sqU && Math.abs(v) <= F.sqV) continue; // Platz
    if (F.linear && Math.abs(u) > (ext >= 10 ? F.sx * 2 : F.sx)) continue; // Straßendorf: erst eine Reihe Hintergassen
    const lu = ((u % F.sx) + F.sx) % F.sx === 0, lv = ((v % F.sy) + F.sy) % F.sy === 0;
    if (!lu && !lv) continue;
    let c = 1;
    if ((lu && u === 0) || (lv && v === 0)) c = 3;
    else if (F.ave && ((lu && u % F.ave === 0) || (lv && v % F.ave === 0))) c = 3;
    else if (lv) c = 2;
    else if (F.linear || Math.abs(u) <= F.sx) c = 2;
    put(x, y, c);
  }
  return out;
}

// Gelände und Nachbarn: wo darf eine Straße liegen (R5)
function okTile(st, s, i, x, y) {
  const T = st.tiles, rt = st._rt, HB = HBof(st);
  if (T.h[i] < 0 || HB[i] > 3 || T.river[i]) return false;
  if (rt.findAt && rt.findAt.has(i)) return false;
  const own = rt.owner[i];
  if (own && own !== s.id) return false;
  const b = rt.bldAt[i] ? rt.bById.get(rt.bldAt[i]) : null;
  if (b && b.t !== 'feld') return false; // Felder weichen beim Bau der Straße
  // nicht näher an einem anderen Ort als an diesem (sonst wachsen zwei Pläne ineinander)
  const d = Math.hypot(x - s.cx, y - s.cy);
  for (const o of st.settlements) if (o !== s && o.alive && Math.hypot(x - o.cx, y - o.cy) < d * 0.9) return false;
  return true;
}

// Plan in den Boden schreiben: neue Kandidaten dazu, alte ungebaute, die nicht mehr passen, weg, Zusammenhang prüfen (R3)
export function materialize(st, s) {
  const P = s.plan, T = st.tiles, S = T.st, rt = st._rt, HB = HBof(st);
  const cand = candidates(st, s);
  const ext = P.ext;
  const x0 = Math.max(1, Math.floor(s.cx - ext - 1)), x1 = Math.min(NX - 2, Math.ceil(s.cx + ext + 1));
  const y0 = Math.max(1, Math.floor(s.cy - ext - 1)), y1 = Math.min(NY - 2, Math.ceil(s.cy + ext + 1));
  const want = new Map();
  for (const [i, c] of cand) {
    const x = i % NX, y = (i / NX) | 0;
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    if (P.core && Math.hypot(x - s.cx, y - s.cy) < P.core) continue; // Altstadt bleibt, wie sie ist (R10)
    if (!okTile(st, s, i, x, y)) continue;
    want.set(i, c);
  }
  // Keine 2 mal 2 Straßenquadrate (R6): an Kreuzungen schräger Linien fällt die Kachel ohne Anschluss nach außen weg
  for (const [i, c] of [...want]) {
    if (c === SQUARE || !want.has(i)) continue;
    for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      const q = [i + ox + oy * NX, i + ox + 1 + oy * NX, i + ox + (oy + 1) * NX, i + ox + 1 + (oy + 1) * NX];
      const isS = j => (want.has(j) && want.get(j) !== SQUARE) || ((S[j] & BUILT) && !(S[j] & (SQUARE | TRACK)));
      if (!q.every(isS)) continue;
      let drop = -1, dn = 9;
      for (const j of q) {
        let out = 0;
        for (const [dx, dy] of D4) { const k = j + dx + dy * NX; if (!q.includes(k) && want.has(k)) out++; }
        if (!want.has(j) || (S[j] & BUILT)) continue; // nur Geplantes darf weichen
        if (out < dn || (out === dn && want.get(j) < want.get(drop))) { dn = out; drop = j; }
      }
      if (drop >= 0 && !(S[drop] & BUILT)) want.delete(drop);
    }
  }
  // Zusammenhang: Breitensuche vom Platz (oder vom Rand der Altstadt) über Straßenkacheln, Schritt höchstens eine Stufe
  const keep = new Set(), queue = [];
  const isStreet = i => want.has(i) || (S[i] & (BUILT | MANUAL)) || (rt.roadNet && rt.roadNet[i]);
  const seed = i => { if (!keep.has(i)) { keep.add(i); queue.push(i); } };
  seed(idx(s.cx, s.cy));
  for (const [i, c] of want) if (c === SQUARE) seed(i);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = idx(x, y);
    if ((S[i] & BUILT) && S[i] && isStreet(i)) seed(i);
    if (P.core && want.has(i) && Math.hypot(x - s.cx, y - s.cy) < P.core + 1.5) seed(i);
  }
  while (queue.length) {
    const i = queue.pop(), x = i % NX, y = (i / NX) | 0;
    for (const [dx, dy] of D4) {
      const xx = x + dx, yy = y + dy;
      if (xx < x0 || xx > x1 || yy < y0 || yy > y1) continue;
      const j = idx(xx, yy);
      if (keep.has(j) || !isStreet(j)) continue;
      if (Math.abs(HB[j] - HB[i]) > 1) continue;
      keep.add(j); queue.push(j);
    }
  }
  // Schreiben: gebaut und von Hand gesetzt bleibt immer, Geplantes nur, was gewollt und angeschlossen ist
  let changed = false;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = idx(x, y), o = S[i];
    if (o & (BUILT | MANUAL)) continue;
    if (o && rt.owner[i] && rt.owner[i] !== s.id) continue; // gehört einem anderen Ort
    const c = want.get(i);
    const v = c && keep.has(i) ? (c === SQUARE ? SQUARE | BUILT : c) : 0;
    if (o & TRACK) continue;
    if (v !== o) { S[i] = v; changed = true; }
  }
  if (!P.core) S[idx(s.cx, s.cy)] = 0; // das Zentrum ist ein Gebäude
  if (changed) { P.bv++; rt.blocks && rt.blocks.delete(s.id); }
  markArea(st, s);
}

// Fläche aller Pläne (nach dem Laden einmal neu, die Laufzeitdaten werden nicht gespeichert)
export function townMask(st) {
  const rt = st._rt;
  if (!rt.townMask || rt.townMask.length !== NX * NY) { rt.townMask = new Uint8Array(NX * NY); for (const s of st.settlements) if (s.alive && s.plan) markArea(st, s); }
  return rt.townMask;
}

// Fläche des Plans (gegen Trampelpfade quer durch die Blöcke, roads in core.js)
function markArea(st, s) {
  const rt = st._rt;
  if (!rt.townMask || rt.townMask.length !== NX * NY) rt.townMask = new Uint8Array(NX * NY);
  const P = s.plan, e = P.ext;
  for (let y = Math.max(0, Math.floor(s.cy - e)); y <= Math.min(NY - 1, Math.ceil(s.cy + e)); y++)
    for (let x = Math.max(0, Math.floor(s.cx - e)); x <= Math.min(NX - 1, Math.ceil(s.cx + e)); x++)
      if (Math.hypot(x - s.cx, y - s.cy) <= e) rt.townMask[idx(x, y)] = 1;
}

// ---------- Blöcke und Parzellen ----------

const streetAt = (st, i) => {
  const v = st.tiles.st[i];
  if (v) return v;
  const rt = st._rt;
  if (rt.roadNet && rt.roadNet[i]) return rt.roadFloor && rt.roadFloor[i] >= 95 ? 3 | BUILT : 3; // Landstraße zählt als Hauptstraße
  return 0;
};

// Blöcke eines Ortes: zusammenhängende Flächen ohne Straße im Plan, geschlossen, wenn sie den Rand nicht berühren
export function blocksOf(st, s) {
  const rt = st._rt, P = s.plan;
  if (!rt.blocks) rt.blocks = new Map();
  const key = P.bv + ':' + P.ext + ':' + (rt.roadIdx ? rt.roadIdx.length : 0);
  const old = rt.blocks.get(s.id);
  if (old && old.key === key) return old;
  const HB = HBof(st), T = st.tiles, e = P.ext;
  const x0 = Math.max(1, Math.floor(s.cx - e - 1)), x1 = Math.min(NX - 2, Math.ceil(s.cx + e + 1));
  const y0 = Math.max(1, Math.floor(s.cy - e - 1)), y1 = Math.min(NY - 2, Math.ceil(s.cy + e + 1));
  const W = x1 - x0 + 1, H = y1 - y0 + 1, comp = new Int32Array(W * H).fill(-1);
  const list = [];
  const inner = (x, y) => Math.hypot(x - s.cx, y - s.cy) <= e - 0.3;
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    const li = (yy - y0) * W + (xx - x0);
    if (comp[li] >= 0) continue;
    const i0 = idx(xx, yy);
    if (streetAt(st, i0) || T.h[i0] < 0 || !inner(xx, yy)) continue;
    if (P.core && Math.hypot(xx - s.cx, yy - s.cy) < P.core) continue;
    const id = list.length, tiles = [], stack = [i0];
    comp[li] = id;
    let open = false, streets = new Set();
    while (stack.length) {
      const i = stack.pop(), x = i % NX, y = (i / NX) | 0;
      tiles.push(i);
      for (const [dx, dy] of D4) {
        const X = x + dx, Y = y + dy;
        if (X < x0 || X > x1 || Y < y0 || Y > y1) { open = true; continue; }
        const j = idx(X, Y), lj = (Y - y0) * W + (X - x0);
        const sv = streetAt(st, j);
        if (sv) { if (!(sv & SQUARE)) streets.add(j); continue; }
        if (T.h[j] < 0 || HB[j] > 3 || T.river[j]) continue; // Wasser, Fels, Fluss schließen den Block auch
        if (!inner(X, Y) || (P.core && Math.hypot(X - s.cx, Y - s.cy) < P.core)) { open = true; continue; }
        if (comp[lj] >= 0) continue;
        comp[lj] = id; stack.push(j);
      }
    }
    if (tiles.length > 70) open = true; // ein riesiger Rest ist kein Block, sondern Flur
    let cx = 0, cy = 0;
    for (const i of tiles) { cx += i % NX; cy += (i / NX) | 0; }
    const st2 = [...streets];
    const built = st2.every(j => streetAt(st, j) & BUILT);
    list.push({ id, tiles, streets: st2, open, built, cx: cx / tiles.length, cy: cy / tiles.length });
  }
  const res = { key, x0, y0, W, comp, list };
  rt.blocks.set(s.id, res);
  return res;
}

// Front einer Kachel: Richtung (0 +x, 1 +y, 2 -x, 3 -y) zur besten gebauten Straße oder zum Platz, sonst -1
export function frontOf(st, x, y) {
  let best = -1, bv = 0;
  D4.forEach(([dx, dy], k) => {
    const xx = x + dx, yy = y + dy;
    if (!inb(xx, yy)) return;
    const v = streetAt(st, idx(xx, yy));
    if (!(v & BUILT)) return;
    const w = (v & SQUARE) ? 5 : (v & CLS) + ((v & TRACK) ? -0.5 : 0);
    if (w > bv) { bv = w; best = k; }
  });
  return best;
}
// Welche Art Straße liegt vorn (für die Nutzung, R7)
export function frontClass(st, x, y) {
  let c = 0;
  for (const [dx, dy] of D4) {
    const xx = x + dx, yy = y + dy;
    if (!inb(xx, yy)) continue;
    const v = streetAt(st, idx(xx, yy));
    if (!(v & BUILT)) continue;
    c = Math.max(c, (v & SQUARE) ? 5 : (v & CLS));
  }
  return c;
}

// Zustand einer Kachel im Plan: 0 außerhalb, 1 offener Rand oder Flur, 2 geschlossen ohne Straßen, 3 erschlossen
export function blockState(st, s, x, y) {
  if (!s.plan) return 0;
  const B = blocksOf(st, s), lx = x - B.x0, ly = y - B.y0;
  if (lx < 0 || ly < 0 || lx >= B.W || ly * B.W + lx >= B.comp.length) return 0;
  const c = B.comp[ly * B.W + lx];
  if (c < 0) return 0;
  const blk = B.list[c];
  return blk.open ? 1 : blk.built ? 3 : 2;
}

// Ist die Kachel eine freie Parzelle in einem erschlossenen Block (R1, R4)?
export function isLot(st, s, x, y) {
  const B = blocksOf(st, s), lx = x - B.x0, ly = y - B.y0;
  if (lx < 0 || ly < 0 || lx >= B.W || ly * B.W + lx >= B.comp.length) return false;
  const c = B.comp[ly * B.W + lx];
  if (c < 0) return false;
  const blk = B.list[c];
  if (blk.open ? !edgeLots(s) : !blk.built) return false;
  return frontOf(st, x, y) >= 0;
}

// Eckfelder des Platzes (für Brunnen, Ahnenpfahl, Statue), die Achsen bleiben frei
export function plazaSpots(st, s) {
  const out = [], S = st.tiles.st;
  for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [2, 2], [2, -2], [-2, 2], [-2, -2]]) {
    const x = s.cx + dx, y = s.cy + dy;
    if (!inb(x, y)) continue;
    const i = idx(x, y);
    if ((S[i] & SQUARE) && !st._rt.bldAt[i] && !(st._rt.roadNet && st._rt.roadNet[i])) out.push([x, y]); // nicht auf eine Landstraße über den Platz
  }
  return out;
}

// Zone einer Parzelle nach ihrer Front und Lage (R7)
export function zoneOf(st, s, x, y) {
  let fc = frontClass(st, x, y);
  if (fc === 5 && Math.max(Math.abs(x - s.cx), Math.abs(y - s.cy)) > 4) fc = 2; // Platz eines anderen (alten) Ortes
  if (fc === 5) return 'platz';
  const d = Math.hypot(x - s.cx, y - s.cy);
  if (fc >= 2 && d > Math.max(4, (s.plan ? s.plan.ext : s.R) * 0.62)) return 'rand';
  if (fc === 3) return 'haupt';
  return 'wohn';
}

// Wie gut passt ein Gebäude auf diese Parzelle (höher ist besser)
export function zoneFit(type, zone) {
  if (type === 'haus' || type === 'hochhaus') return zone === 'wohn' ? 1.2 : zone === 'haupt' ? 0.5 : zone === 'rand' ? 0.6 : -2.5;
  if (CIVIC.has(type)) return zone === 'platz' ? 3 : zone === 'haupt' ? 1.4 : zone === 'wohn' ? 0.2 : -0.6;
  if (TRADE.has(type)) return zone === 'haupt' ? 2.2 : zone === 'platz' ? 0.8 : zone === 'rand' ? 0.8 : 0.1;
  if (EDGE.has(type)) return zone === 'rand' ? 2.5 : zone === 'haupt' ? 0.3 : zone === 'platz' ? -3 : -0.8;
  return zone === 'platz' ? 0 : 0.5;
}

// ---------- Bauabschnitte ----------

// Randparzellen: hat ein Ort keinen geschlossenen Block mehr (enge Insel, Küste, Hang), dürfen Häuser auch an gebauten
// Straßen am offenen Rand stehen. Die Straßenfront gilt weiter (R1), nur der Block dahinter ist noch nicht zu.
export const edgeLots = s => !!(s.plan && s.plan.full);

// Taugt die Kachel als Bauplatz (Gelände, Brand, Ruine, Fluss, Fundort, fremder Grund)? Für Parzellen und das Zählen
export function usable(st, s, i, high = false) {
  const rt = st._rt, T = st.tiles, h = HBof(st)[i];
  if (rt.bldAt[i] || h < 1 || (!high && h > 3) || T.burn[i] || T.ruin[i] > 30 || T.river[i]) return false;
  if ((T.st && T.st[i]) || (rt.roadNet && rt.roadNet[i])) return false; // nie auf Straßen (die Blöcke anderer Orte können veraltet sein)
  if (rt.findAt && rt.findAt.has(i)) return false;
  const own = rt.owner[i];
  return !own || own === s.id;
}

// Freie Parzellen (für Wohnhäuser) zählen
function freeLots(st, s) {
  const B = blocksOf(st, s), rt = st._rt;
  let n = 0;
  const edge = edgeLots(s);
  for (const blk of B.list) {
    if (blk.open ? !edge : !blk.built) continue;
    for (const i of blk.tiles) {
      const x = i % NX, y = (i / NX) | 0;
      if (usable(st, s, i) && frontOf(st, x, y) >= 0 && zoneFit('haus', zoneOf(st, s, x, y)) > -1) n++; // Plätze am Platz zählen nicht als Wohnland
    }
  }
  return n;
}

// Breitensuche vom gebauten Netz (gebaute Straßen, Platz, Zentrum) über geplante Straßen: Vorgänger und Abstand je Kachel
function fromBuilt(st, s) {
  const S = st.tiles.st, HB = HBof(st), e = Math.ceil(s.plan.ext + 1);
  const x0 = Math.max(1, s.cx - e), x1 = Math.min(NX - 2, s.cx + e), y0 = Math.max(1, s.cy - e), y1 = Math.min(NY - 2, s.cy + e);
  const par = new Map(), dist = new Map(), q = [];
  const c = idx(s.cx, s.cy);
  par.set(c, -1); dist.set(c, 0); q.push(c);
  const P = s.plan;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = idx(x, y);
    if ((streetAt(st, i) & BUILT) && !(S[i] & TRACK)) { par.set(i, -1); dist.set(i, 0); q.push(i); }
    // Altstadt: ihre Gassen (im Bild aus den Türwegen) reichen bis an ihren Rand, dort setzt die Neustadt an
    else if (P.core && S[i] && !(S[i] & TRACK) && Math.hypot(x - s.cx, y - s.cy) < P.core + 1.5) { par.set(i, -2); dist.set(i, 1); q.push(i); }
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % NX, y = (i / NX) | 0;
    for (const [dx, dy] of D4) {
      const xx = x + dx, yy = y + dy;
      if (xx < x0 || xx > x1 || yy < y0 || yy > y1) continue;
      const j = idx(xx, yy);
      if (par.has(j) || !S[j] || (S[j] & (BUILT | TRACK))) continue;
      if (Math.abs(HB[j] - HB[i]) > 1) continue;
      par.set(j, i); dist.set(j, dist.get(i) + 1); q.push(j);
    }
  }
  return { par, dist };
}

// Den nächsten geschlossenen, noch nicht erschlossenen Block wählen und seine Straßen in die Warteschlange legen, dazu
// den Weg vom gebauten Netz bis dorthin (R3: jede gebaute Straße hängt am Zentrum)
function openNearest(st, s, k = 1, instant = false) {
  const B = blocksOf(st, s), S = st.tiles.st, P = s.plan;
  const HB = HBof(st);
  const good = b => b.tiles.filter(i => HB[i] >= 1 && HB[i] <= 3 && !st.tiles.river[i]).length;
  const cands = B.list.filter(b => !b.open && !b.built && good(b) >= 2 && !b.streets.some(j => prunedRecently(st, P, j))); // Blöcke nur aus Strand oder Fels lohnen nicht, zurückgebaute Stücke ruhen
  if (!cands.length) return 0;
  const net = fromBuilt(st, s);
  // Nähe zum Zentrum, kurzer Weg vom gebauten Netz, wenige Straßen je Parzelle
  const score = b => {
    const todo = b.streets.filter(j => !(streetAt(st, j) & BUILT));
    let reach = 99;
    for (const j of todo) { const d = net.dist.get(j); if (d != null && d < reach) reach = d; }
    if (!todo.length) reach = 0;
    return -Math.hypot(b.cx - s.cx, b.cy - s.cy) - todo.length * 0.12 + Math.min(good(b), 12) * 0.12 - reach * 0.6 - (reach === 99 ? 50 : 0);
  };
  cands.sort((a, b) => score(b) - score(a));
  let opened = 0;
  for (const b of cands.slice(0, k)) {
    if (score(b) < -45) break; // vom Netz aus nicht erreichbar
    const todo = new Set();
    for (const j of b.streets) {
      if ((streetAt(st, j) & BUILT) || !S[j]) continue;
      for (let c = j, n = 0; c >= 0 && n < 80 && !(S[c] & BUILT); c = net.par.has(c) ? net.par.get(c) : -1, n++) if (S[c]) todo.add(c);
      // (Vorgänger -2: Ansatz an der Altstadt, wird mitgebaut)
    }
    if (instant) {
      let left = [...todo].sort((a, c) => (net.dist.get(a) ?? 99) - (net.dist.get(c) ?? 99)), moved = true;
      while (left.length && moved) { moved = false; left = left.filter(j => { if (!linked(st, s, j)) return true; buildStreet(st, s, j, true); moved = true; return false; }); }
    }
    else for (const j of todo) if (!P.q.includes(j)) P.q.push(j);
    opened++;
  }
  // Bauen vom Netz nach außen: was am gebauten Netz liegt, zuerst
  if (!instant) P.q.sort((a, c) => (net.dist.get(a) ?? 99) - (net.dist.get(c) ?? 99));
  return opened;
}

// Hängt die Kachel schon am gebauten Netz (Nachbar gebaut, höchstens eine Stufe)? Nur dann wird sie gebaut (R3).
function linked(st, s, i) {
  const x = i % NX, y = (i / NX) | 0, HB = HBof(st);
  if (Math.abs(x - s.cx) + Math.abs(y - s.cy) === 1) return true;
  if (s.plan.core && Math.hypot(x - s.cx, y - s.cy) < s.plan.core + 1.5) return true; // Ansatz am Rand der Altstadt
  for (const [dx, dy] of D4) {
    const j = idx(x + dx, y + dy);
    if ((streetAt(st, j) & BUILT) && Math.abs(HB[j] - HB[i]) <= 1) return true;
  }
  return false;
}

// Eine Straßenkachel ist fertig: Feld weicht, Plan zählt hoch (das Bild baut den Ort neu)
export function buildStreet(st, s, i, quiet = false) {
  const T = st.tiles, rt = st._rt, S = T.st;
  if (!S[i] || (S[i] & BUILT)) return;
  const b = rt.bldAt[i] ? rt.bById.get(rt.bldAt[i]) : null;
  if (b && b.t === 'feld') {
    removeBuilding(st, b, false);
    if (!quiet && !(s.plan.fieldMsg > st.day - D.DAYS_PER_YEAR)) { s.plan.fieldMsg = st.day; chron(st, 'bau', L(`In ${s.name} weicht ein Feld der neuen Straße.`, `In ${s.name} a field gives way to the new street.`), s.id, 0); }
  } else if (b) return; // ein Gebäude steht im Weg (alter Stand): die Kachel bleibt geplant
  S[i] |= BUILT;
  if (T.tree[i]) T.tree[i] = 0;
  T.road[i] = Math.max(T.road[i], 90);
  s.plan.bv++;
  rt.dirtyT = true;
}

// Baumeister arbeiten an der Warteschlange (aus construction in core.js). Die Punkte sammeln sich (auch kleine Dörfer
// ohne Baumeister kommen voran), gibt die verbrauchten Punkte zurück.
export function streetWork(st, s, pts) {
  const P = s.plan;
  if (!P || !P.q.length || pts <= 0) return 0;
  const S = st.tiles.st;
  P.wp = (P.wp || 0) + pts;
  const per = 0.5 + (s.era || 0) * 0.06;
  let n = 0;
  let skip = 0;
  while (P.q.length && P.wp >= per && n < 12) {
    const i = P.q.shift();
    if (!S[i] || (S[i] & BUILT)) continue;
    if (!linked(st, s, i)) { // noch kein Anschluss: hinten anstellen; geht eine ganze Runde nichts, fällt der Rest weg
      if (++skip > P.q.length + 1) { P.q.length = 0; break; }
      P.q.push(i); continue;
    }
    skip = 0;
    // Material: Pflaster nur aus Überschuss (sonst bleibt es Kies), damit Straßen den Häusern keinen Stein wegnehmen
    if (s.era >= 2 && s.stock.stone > 40) s.stock.stone -= 0.2;
    buildStreet(st, s, i);
    if (!(S[i] & BUILT)) { S[i] = 0; P.bv++; } // ein altes Gebäude steht im Weg: der Plan weicht ihm aus
    P.wp -= per; n++;
  }
  if (!P.q.length) {
    P.wp = 0;
    if (P.opening) {
      P.opening = 0; P.nb++;
      if (P.nb === 3 || P.nb % 12 === 0) chron(st, 'bau', L(`In ${s.name} ist ein neues Viertel erschlossen. Die Straßen liegen, jetzt wird gebaut.`, `A new quarter is ready in ${s.name}. The streets are laid, now the building begins.`), s.id, 0);
    }
  }
  return Math.min(pts, n * per);
}

// Planer: alle 2 Tage aus planner in core.js. Erschließt Blöcke, wenn Bauland knapp wird, erweitert den Plan.
export function planStep(st, s, pop) {
  const P = ensurePlan(st, s);
  evolveForm(st, s);
  // Betriebe draußen ohne Zufahrt (zu früh gebaut, das Netz war noch nicht da): einmal im Jahr nachziehen (R9)
  if (st.day % D.DAYS_PER_YEAR < 2) {
    let k = 0;
    for (const b of st.buildings) if (b.s === s.id && OUTSIDE_T.has(b.t) && b.prog >= 1 && k < 3 && !hasAccess(st, b)) { planAccess(st, s, b); k++; }
    for (let k2 = 0; k2 < 3 && repairNet(st, s); k2++); // Straßenstücke ohne Anschluss wieder anbinden
    if (st._rt.noAccess && st.day % (D.DAYS_PER_YEAR * 5) < 2) st._rt.noAccess = null; // das Netz wächst: alte Sackplätze neu prüfen
  }
  // Sackgassen ohne Zweck zurückbauen: nach neuen Straßen alle 6 Tage, sonst einmal im Jahr (Wartezeit der neuen Straßen)
  const yearly = st.day % D.DAYS_PER_YEAR < 2;
  if ((P.tv !== P.bv && st.day % 6 < 2) || yearly) { tidyStreets(st, s, yearly); P.tv = P.bv; }
  if (P.q.length) return;
  // Bedarf: genug Wohnland für die nächsten Jahre, und sofort ein neuer Block, wenn ein Gebäude keinen Platz fand
  const need = 3 + Math.ceil(pop * 0.06);
  const short = (P.short && st.day - P.short < 8) || (P.wantBig && st.day - P.wantBig < 12);
  if (freeLots(st, s) >= need && !short) return;
  P.short = 0; P.wantBig = 0;
  if (openNearest(st, s, pop > 160 ? 2 : 1)) { P.opening = 1; return; }
  // Kein geschlossener Block mehr frei: der Plan wächst um einen Abschnitt (höchstens bis zum Gebiet des Ortes plus Rand)
  const lim = Math.max(10, (s.R || 4) * 1.6 + 6);
  if (P.ext < lim) {
    P.ext = Math.min(lim, P.ext + 3);
    materialize(st, s);
    if (openNearest(st, s, 1)) { P.opening = 1; P.full = 0; return; }
  }
  // Kein Block lässt sich schließen: die Straßen am Rand werden weitergebaut, Häuser dürfen an ihnen stehen
  P.full = st.day;
  const net = fromBuilt(st, s);
  const front = [...net.dist].filter(([i, d]) => d > 0 && d <= 3).sort((a, b) => a[1] - b[1] || Math.hypot(a[0] % NX - s.cx, ((a[0] / NX) | 0) - s.cy) - Math.hypot(b[0] % NX - s.cx, ((b[0] / NX) | 0) - s.cy));
  for (const [i] of front.filter(([i]) => !prunedRecently(st, P, i)).slice(0, 6)) if (!P.q.includes(i)) P.q.push(i);
}

// ---------- Straßenpflege (seit 24.10.2026, Naders Auftrag: keine Straßen, die ins Leere laufen) ----------

const STUB_GRACE = 3 * D.DAYS_PER_YEAR;  // so lange darf eine neue Straße auf ihre ersten Häuser warten
const PRUNE_KEEP = 20 * D.DAYS_PER_YEAR; // so lange wird ein zurückgebautes Stück nicht wieder für einen Block gebaut

// Sackgassen eines Ortes: gebaute Straßen, die enden, ohne dass an ihnen ein Gebäude, der Platz, Trümmer oder eine
// Ruinenstätte liegt. Kette vom offenen Ende bis zur nächsten Kreuzung, zum Platz oder zur Landstraße.
// Gibt [{ tiles, lots }] zurück, lots = freie Parzellen an der Kette (dort kann noch gebaut werden).
export function deadEnds(st, s) {
  const P = s.plan, S = st.tiles.st, rt = st._rt, T = st.tiles, HB = HBof(st);
  if (!P || !S) return [];
  const R = Math.ceil(Math.max((s.R || 6) + 6, P.ext + 1.5));
  const x0 = Math.max(1, s.cx - R), x1 = Math.min(NX - 2, s.cx + R), y0 = Math.max(1, s.cy - R), y1 = Math.min(NY - 2, s.cy + R);
  const others = st.settlements.filter(o => o !== s && o.alive && Math.abs(o.cx - s.cx) < 60 && Math.abs(o.cy - s.cy) < 60);
  const oR = o => Math.ceil(Math.max((o.R || 6) + 6, o.plan ? o.plan.ext + 1.5 : 0));
  const mine = i => { const x = i % NX, y = (i / NX) | 0, d = Math.hypot(x - s.cx, y - s.cy); return !others.some(o => Math.hypot(x - o.cx, y - o.cy) < d && Math.abs(x - o.cx) <= oR(o) && Math.abs(y - o.cy) <= oR(o)); };
  const land = i => rt.roadFloor && rt.roadFloor[i] >= 95;
  const street = i => (S[i] & BUILT) || land(i);
  const ruinSite = new Set();
  for (const o of st.finds || []) if (o.t === 'ruine' && Math.abs(o.x - s.cx) <= R + 2 && Math.abs(o.y - s.cy) <= R + 2) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) ruinSite.add(idx(o.x + dx, o.y + dy));
  const nbrs = i => {
    const x = i % NX, y = (i / NX) | 0, out = [];
    for (const [dx, dy] of D4) { const xx = x + dx, yy = y + dy; if (!inb(xx, yy)) continue; const j = idx(xx, yy); if (street(j) && Math.abs(HB[j] - HB[i]) <= 1) out.push(j); }
    if (!out.length) for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const xx = x + dx, yy = y + dy; if (inb(xx, yy) && land(idx(xx, yy))) { out.push(idx(xx, yy)); break; } }
    return out;
  };
  const serves = i => {
    const x = i % NX, y = (i / NX) | 0;
    for (const [dx, dy] of D4) {
      const xx = x + dx, yy = y + dy;
      if (!inb(xx, yy)) continue;
      const j = idx(xx, yy), id = rt.bldAt[j], b = id && rt.bById.get(id);
      if (b && (b.t !== 'feld' || (S[i] & TRACK))) return true;
      if ((S[j] & SQUARE) && (S[j] & BUILT)) return true;
      if (T.ruin[j] || ruinSite.has(j)) return true;
    }
    return false;
  };
  // Erschließung auch der Nachbarn: ihr Plan kann hier liegen (ein jüngerer Ort ist näher, die große Stadt baut noch)
  const planners = [s, ...others.filter(o => o.plan && Math.hypot(o.cx - s.cx, o.cy - s.cy) <= R + o.plan.ext + 1)];
  const queued = new Set(planners.flatMap(o => o.plan.q));
  const lotFor = (x, y) => { const j = idx(x, y); return planners.some(o => Math.hypot(x - o.cx, y - o.cy) <= o.plan.ext + 1 && usable(st, o, j) && isLot(st, o, x, y)); };
  const out = [], done = new Set();
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = idx(x, y);
    if (!(S[i] & BUILT) || (S[i] & SQUARE) || land(i) || done.has(i) || !mine(i)) continue;
    if (nbrs(i).length > 1) continue;
    const tiles = [];
    let prev = -1, cur = i, ok = false;
    while (cur >= 0 && tiles.length < 200) {
      if ((S[cur] & SQUARE) || land(cur) || !(S[cur] & BUILT)) break;
      const all = nbrs(cur);
      if (tiles.length && all.length > 2) break; // die Kreuzung selbst gehört nicht zur Sackgasse
      done.add(cur); tiles.push(cur);
      if (serves(cur)) { ok = true; break; }
      const nb = all.filter(j => j !== prev);
      if (nb.length !== 1) break;
      prev = cur; cur = nb[0];
    }
    if (ok || !tiles.length) continue;
    if (tiles.some(c => S[c] & MANUAL)) continue; // von Hand gemalt (Baukasten): bleibt, wie es ist
    // im Bau: am Ende wartet eine Kachel der Warteschlange (der Block wird gerade erschlossen)
    if (tiles.some(c => D4.some(([dx, dy]) => queued.has(c + dx + dy * NX)))) continue;
    let lots = 0;
    for (const c of tiles) {
      const cx = c % NX, cy = (c / NX) | 0;
      for (const [dx, dy] of D4) if (inb(cx + dx, cy + dy) && lotFor(cx + dx, cy + dy)) lots++;
    }
    out.push({ tiles, lots });
  }
  return out;
}

// Einmal im Jahr (planStep): Sackgassen ohne Zweck zurückbauen. Liegen freie Parzellen daran, darf die Straße noch
// STUB_GRACE auf Häuser warten (lotSite baut dort bevorzugt, s.plan.stubT), danach weicht auch sie.
export function tidyStreets(st, s, yearly = false) {
  const P = s.plan, S = st.tiles.st, rt = st._rt;
  if (!P || !S) return 0;
  const seen = {}, keepT = [];
  let pruned = 0;
  // einmal im Jahr, nach repairNet: Stücke, die sich nicht mehr anbinden ließen (ein Nachbarort wurde verlassen, seine
  // Gassen wuchsen zu), wachsen auch zu. Was dieser Ort zeichnet (mine), sonst nichts.
  if (yearly) {
    const R = Math.ceil(Math.max((s.R || 6) + 6, P.ext + 1.5));
    const x0 = Math.max(1, s.cx - R), x1 = Math.min(NX - 2, s.cx + R), y0 = Math.max(1, s.cy - R), y1 = Math.min(NY - 2, s.cy + R);
    const conn = connectedSet(st, s, x0, x1, y0, y1);
    const others = st.settlements.filter(o => o !== s && o.alive && Math.abs(o.cx - s.cx) < 60 && Math.abs(o.cy - s.cy) < 60);
    const oR = o => Math.ceil(Math.max((o.R || 6) + 6, o.plan ? o.plan.ext + 1.5 : 0));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = idx(x, y), v = S[i];
      if (!(v & BUILT) || (v & (SQUARE | MANUAL)) || conn.has(i)) continue;
      const d = Math.hypot(x - s.cx, y - s.cy);
      if (others.some(o => Math.hypot(x - o.cx, y - o.cy) < d && Math.abs(x - o.cx) <= oR(o) && Math.abs(y - o.cy) <= oR(o))) continue;
      S[i] = (v & TRACK) ? 0 : v & ~BUILT;
      P.pr = P.pr || {}; P.pr[i] = st.day; pruned++;
    }
  }
  P.pr = P.pr || {};
  for (let pass = 0; pass < 3; pass++) {
    const list = deadEnds(st, s);
    if (!list.length) break;
    let any = false;
    for (const { tiles, lots } of list) {
      const key = tiles[0], since = (P.stub && P.stub[key]) ?? st.day;
      if (lots && st.day - since < STUB_GRACE) { seen[key] = since; if (pass === 0) keepT.push(...tiles); continue; }
      for (const c of tiles) { if (S[c] & TRACK) S[c] = 0; else S[c] &= ~BUILT; P.pr[c] = st.day; }
      pruned += tiles.length; any = true;
    }
    if (!any) break;
  }
  P.stub = seen;
  P.stubT = keepT;
  for (const k of Object.keys(P.pr)) if (st.day - P.pr[k] > PRUNE_KEEP) delete P.pr[k];
  if (pruned) { P.bv++; rt.dirtyT = true; rt.blocks && rt.blocks.delete(s.id); }
  return pruned;
}
const prunedRecently = (st, P, i) => !!(P.pr && P.pr[i] != null && st.day - P.pr[i] < PRUNE_KEEP);

// ---------- Zufahrten (R9) ----------

// Weg von einem Betrieb draußen zur nächsten gebauten Straße (höchstens rund 30 Schritte). Geplante Straßen sind billig
// und werden dabei gleich gebaut, freie Kacheln direkt neben einer Straße teuer (keine Wege nebenher), quer durch Blöcke nie.
// Gibt zurück, ob der Betrieb jetzt am Netz hängt (sonst sucht der Planer einen anderen Platz)
export function planAccess(st, s, b) {
  const S = st.tiles.st;
  if (!S) return true;
  const hit = i => (streetAt(st, i) & BUILT) && !(S[i] & SQUARE);
  for (const [dx, dy] of D4) if (inb(b.x + dx, b.y + dy) && hit(idx(b.x + dx, b.y + dy))) return true; // liegt schon an
  return accessPath(st, s, idx(b.x, b.y), hit) || accessPath(st, s, idx(b.x, b.y), hit, true);
}

// Reparatur, einmal im Jahr: hängen gebaute Straßen ohne Anschluss (eine Landstraße wurde verlegt, ein Ort eingemeindet),
// bekommt das Stück, das dem Zentrum am nächsten liegt, einen Weg zum Netz (R3)
export function repairNet(st, s) {
  const P = s.plan, S = st.tiles.st, e = P.ext + 1;
  if (!P || !S) return false;
  const x0 = Math.max(1, Math.floor(s.cx - e)), x1 = Math.min(NX - 2, Math.ceil(s.cx + e));
  const y0 = Math.max(1, Math.floor(s.cy - e)), y1 = Math.min(NY - 2, Math.ceil(s.cy + e));
  const conn = connectedSet(st, s, x0, x1, y0, y1);
  let start = -1, bd = 1e9;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = idx(x, y);
    if (!(S[i] & BUILT) || (S[i] & SQUARE) || conn.has(i)) continue;
    const d = Math.hypot(x - s.cx, y - s.cy);
    if (d < bd) { bd = d; start = i; }
  }
  if (start < 0) return false;
  return accessPath(st, s, start, j => conn.has(j)) || accessPath(st, s, start, j => conn.has(j), true);
}

// wide: auch durch freie Kacheln in Blöcken (teuer), wenn es anders nicht geht (Reparatur, dichte Orte)
function accessPath(st, s, start, hit, wide = false) {
  const T = st.tiles, rt = st._rt, S = T.st, HB = HBof(st);
  const nearStreet = j => { const x = j % NX, y = (j / NX) | 0; for (const [dx, dy] of D4) { const q = idx(x + dx, y + dy); if (S[q] && !(S[q] & TRACK)) return true; } return false; };
  const g = new Map([[start, 0]]), came = new Map([[start, -1]]), buckets = [[start]];
  // nur im Kasten, den das Bild für den Ort zeichnet (render/streets.js), sonst endet die Zufahrt sichtbar am Rand
  const RB = Math.ceil(Math.max((s.R || 6) + 6, s.plan ? s.plan.ext + 1.5 : 0)) - 1;
  let goal = -1, seen = 0;
  for (let c = 0; c < buckets.length && goal < 0 && c < 120; c++) {
    const list = buckets[c];
    if (!list) continue;
    for (let h = 0; h < list.length && goal < 0; h++) {
      const i = list[h];
      if (g.get(i) !== c) continue;
      if (++seen > 2600) { c = 999; break; }
      const x = i % NX, y = (i / NX) | 0;
      for (const [dx, dy] of D4) {
        const xx = x + dx, yy = y + dy;
        if (!inb(xx, yy) || Math.abs(xx - s.cx) > RB || Math.abs(yy - s.cy) > RB) continue;
        const j = idx(xx, yy);
        if (Math.abs(HB[j] - HB[i]) > 1) continue; // auch der letzte Schritt ans Netz höchstens eine Stufe (sonst hängt der Weg nicht an)
        if (hit(j)) { came.set(j, i); goal = j; break; }
        if (T.h[j] < 0 || HB[j] > 4 || rt.bldAt[j]) continue;
        if (S[j] & SQUARE) continue;
        let w;
        if (T.river[j]) continue; // keine Furt (sah aus wie eine Straße, die im Fluss endet)
        if (S[j]) w = 1; // geplante Straße: wird gebaut
        else {
          const inBlock = rt.townMask && rt.townMask[j] && blockState(st, s, xx, yy) >= 2;
          if (inBlock && !wide) continue; // nicht quer durch Blöcke
          w = inBlock ? 9 : nearStreet(j) ? 4 : 2;
        }
        const ng = c + w;
        if (ng >= (g.get(j) ?? 1e9) || ng > 70) continue;
        g.set(j, ng); came.set(j, i);
        (buckets[ng] || (buckets[ng] = [])).push(j);
      }
    }
  }
  if (goal < 0) return false;
  let n = 0;
  for (let c = came.get(goal); c !== start && c >= 0; c = came.get(c)) {
    if (S[c] && !(S[c] & BUILT)) buildStreet(st, s, c, true);
    else if (!S[c]) { S[c] = 1 | TRACK | BUILT; n++; }
    if (T.tree[c]) T.tree[c] = 0;
  }
  if (s.plan) { s.plan.bv++; rt.dirtyT = true; }
  return true;
}

function hasAccess(st, b) {
  for (const [dx, dy] of D4) if (inb(b.x + dx, b.y + dy) && (streetAt(st, idx(b.x + dx, b.y + dy)) & BUILT)) return true;
  return false;
}

// ---------- Regeln prüfen ----------

// R1 bis R9 für einen Ort. Gezählt werden Neubauten seit dem Plan (alte Städte bleiben, wie sie sind, R10).
export function checkTown(st, s) {
  const P = s.plan, T = st.tiles, S = T.st, rt = st._rt, HB = HBof(st);
  const res = { r1: 0, r2: 0, r3: 0, r5: 0, r6: 0, r7: 0, r8: 0, r9: 0, n: 0, old: 0, streets: 0, built: 0, list: [] };
  if (!P || !S) return res;
  const bad = (rule, x, y, why) => { res[rule]++; if (res.list.length < 60) res.list.push({ rule, x, y, why }); };
  const e = P.ext + 1;
  const x0 = Math.max(1, Math.floor(s.cx - e)), x1 = Math.min(NX - 2, Math.ceil(s.cx + e));
  const y0 = Math.max(1, Math.floor(s.cy - e)), y1 = Math.min(NY - 2, Math.ceil(s.cy + e));
  // Straßen: Zusammenhang, Steigung, Doppelstraßen, nichts darauf
  const seen = new Set(), q = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = idx(x, y), v = S[i];
    if (!v || !(v & BUILT) || (v & TRACK)) continue;
    if (rt.owner[i] && rt.owner[i] !== s.id) continue;
    res.streets++; res.built++;
    const b = rt.bldAt[i] ? rt.bById.get(rt.bldAt[i]) : null;
    if (b && !((v & SQUARE) && PLAZA.has(b.t))) bad('r2', x, y, D.BUILDINGS[b.t].name);
    if (T.h[i] < 0 || T.river[i]) bad('r5', x, y, L('Straße im Wasser', 'street in water'));
    if (!(v & SQUARE) && x < x1 && y < y1) {
      const q4 = [i, i + 1, i + NX, i + NX + 1];
      if (q4.every(j => (S[j] & BUILT) && !(S[j] & (SQUARE | TRACK)))) bad('r6', x, y, L('Doppelstraße', 'double street'));
    }
  }
  const seen2 = connectedSet(st, s, x0, x1, y0, y1);
  for (const i of seen2) seen.add(i);
  const mine = (x, y) => { const d = Math.hypot(x - s.cx, y - s.cy); return st.settlements.every(o => o === s || Math.hypot(x - o.cx, y - o.cy) >= d); };
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = idx(x, y);
    if ((S[i] & BUILT) && !(S[i] & TRACK) && !seen.has(i) && !(rt.owner[i] && rt.owner[i] !== s.id) && mine(x, y)) bad('r3', x, y, L('nicht angeschlossen', 'not connected'));
  }
  return finishCheck(st, s, res, bad);
}

// Alle gebauten Straßen, die über Straßen, Zufahrten oder Landstraßen an einem Platz, am Zentrum oder an der Altstadt hängen
export function connectedSet(st, s, x0, x1, y0, y1) {
  const P = s.plan, S = st.tiles.st, rt = st._rt, HB = HBof(st), seen = new Set(), q = [];
  const root = [];
  // Wurzeln auch etwas außerhalb: Plätze eingemeindeter Orte und Landstraßen halten ihre Straßen am Netz
  const X0 = Math.max(1, x0 - 16), X1 = Math.min(NX - 2, x1 + 16), Y0 = Math.max(1, y0 - 16), Y1 = Math.min(NY - 2, y1 + 16);
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) { const i = idx(x, y); if ((S[i] & SQUARE) || (P.core && (S[i] & BUILT) && Math.hypot(x - s.cx, y - s.cy) < P.core + 1.5) || (rt.roadFloor && rt.roadFloor[i] >= 95)) root.push(i); }
  for (const o of st.settlements) if (o !== s && Math.abs(o.cx - s.cx) < 60 && Math.abs(o.cy - s.cy) < 60) for (const [dx, dy] of D4) if (inb(o.cx + dx, o.cy + dy)) root.push(idx(o.cx + dx, o.cy + dy));
  for (const [dx, dy] of D4) root.push(idx(s.cx + dx, s.cy + dy));
  for (const i of root) if (!seen.has(i)) { seen.add(i); q.push(i); }
  while (q.length) {
    const i = q.pop(), x = i % NX, y = (i / NX) | 0;
    for (const [dx, dy] of D4) {
      const j = idx(x + dx, y + dy);
      if (seen.has(j)) continue;
      const v = streetAt(st, j);
      if (!(v & BUILT)) continue;
      if (Math.abs(HB[j] - HB[i]) > 1) continue; // Stufe: zählt nicht als Verbindung (das Bild verbindet dort auch nicht)
      seen.add(j); q.push(j);
    }
  }
  return seen;
}

function finishCheck(st, s, res, bad) {
  const P = s.plan, S = st.tiles.st, rt = st._rt;
  // Gebäude: Front, Nutzung, Großbauten, Zufahrten
  for (const b of st.buildings) {
    if (b.s !== s.id || b.t === 'zentrum') continue;
    if (b.d < P.d0 || Math.hypot(b.x - s.cx, b.y - s.cy) > P.ext + 1.5) { res.old++; continue; } // alt oder aus einem eingemeindeten Ort
    res.n++;
    const def = D.BUILDINGS[b.t], pl = def.place;
    const onSq = (S[idx(b.x, b.y)] & SQUARE) && PLAZA.has(b.t);
    if (['home', 'near', 'high', 'edge'].includes(pl) && !onSq && !OUTSIDE_T.has(b.t) && !b.free && !b.hh) {
      if (frontOf(st, b.x, b.y) < 0) bad('r1', b.x, b.y, def.name);
      else if (zoneFit(b.t, zoneOf(st, s, b.x, b.y)) < -1) bad('r7', b.x, b.y, def.name);
    }
    if (pl === 'field' || pl === 'fieldnear') { if (S[idx(b.x, b.y)] & BUILT) bad('r2', b.x, b.y, def.name); } // geplant darf ein Feld noch liegen, es weicht beim Bau
    if (BIG_T.has(b.t)) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const o = rt.bldAt[idx(b.x + dx, b.y + dy)];
        const ob = o && rt.bById.get(o);
        if (ob && ob.t !== 'feld') { bad('r8', b.x, b.y, def.name); break; }
      }
    }
    if (OUTSIDE_T.has(b.t) && b.prog >= 1 && !hasAccess(st, b)) bad('r9', b.x, b.y, def.name);
  }
  return res;
}
