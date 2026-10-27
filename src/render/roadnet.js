// Das Landstraßennetz fürs Bild (seit 19.10.2026). Aus allen gebauten Abschnitten der Verbindungen (st.links) entsteht
// ein Graph über Kacheln: jede Kante ist ein Paar aufeinanderfolgender Pfadkacheln. Ketten zwischen Kreuzungen werden
// je einmal gezeichnet (vorher je Verbindung ein eigenes Band, gemeinsame Stücke doppelt). Innerhalb der Orte übernehmen
// die Ortsstraßen (render/streets.js), dort wird die Landstraße abgeschnitten.
// Jede Kette bekommt ein Längsprofil: Bodenhöhe ohne Straßenbett (baseY), weich gemittelt, Steigung begrenzt. Über
// Flüssen liegt eine Brücke (Spannweite bis über die Ufer, Fahrbahn auf Uferhöhe mit leichtem Bogen). Das Gelände
// wird entlang des Profils eingeebnet (terrain.applyRoadBed), die Bänder liegen genau darauf (streets.buildLinks),
// die Brücken baut render/bridges.js. getNet merkt sich das Ergebnis, solange sich das Netz nicht ändert.
import { NX, NY } from './scene.js';
import { baseY } from './terrain.js';

const wx = i => (i % NX) - NX / 2 + 0.5, wz = i => ((i / NX) | 0) - NY / 2 + 0.5;
const GRADE = 0.16;      // höchste Steigung (Höhe je Feld)
const SMOOTH = 2.0;      // Mittelung des Profils über ±2 Felder
export const WIDTH = [0.3, 0.44, 0.52, 0.62];   // Fahrbahnbreite je Stufe (Feldweg, Pflaster, Asphalt), seit 24.10.2026 zwei Spuren auch auf dem Feldweg

function chaikin(p, passes = 2) {
  for (let k = 0; k < passes; k++) {
    if (p.length < 3) return p;
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, a[2]], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, b[2]]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

let cache = null;
export function netSig(st) {
  let s = '';
  for (const k of st.links || []) if (k.path) s += k.a + '-' + k.b + ':' + (k.built | 0) + '.' + (k.lvl | 0) + '.' + k.path.length + ';';
  for (const o of st.settlements) if (o.alive) s += o.id + 'r' + Math.round((o.R || 4) * 2) + ',';
  return s;
}

export function getNet(st) {
  const sig = netSig(st);
  if (cache && cache.sig === sig && cache.st === st) return cache;
  cache = buildNet(st);
  cache.sig = sig; cache.st = st;
  return cache;
}

function buildNet(st) {
  const T = st.tiles, rt = st._rt;
  const towns = st.settlements.filter(s => s.alive);
  const inCore = i => { const x = i % NX, y = (i / NX) | 0; for (const s of towns) if (Math.hypot(x - s.cx, y - s.cy) < (s.R || 4) * 0.7) return true; return false; };
  // Kanten mit Stufe und Epoche (für die Brückenart)
  const edges = new Map(), adj = new Map();
  const era = new Map();
  const add = (i, j, lvl, e) => {
    if (i === j) return;
    if (inCore(i) && inCore(j)) return;
    const key = i < j ? i * NX * NY + j : j * NX * NY + i;
    const o = edges.get(key);
    if (o) { o.lvl = Math.max(o.lvl, lvl); o.era = Math.max(o.era, e); return; }
    edges.set(key, { i, j, lvl, era: e, used: false });
    (adj.get(i) || adj.set(i, []).get(i)).push(key);
    (adj.get(j) || adj.set(j, []).get(j)).push(key);
  };
  for (const k of st.links || []) {
    if (!k.path || !k.lvl) continue;
    const A = rt.sById.get(k.a), B = rt.sById.get(k.b);
    if (!A || !B) continue;
    const e = Math.min(A.era | 0, B.era | 0);
    const n = Math.min(k.path.length, k.built | 0);
    // gebauter Teil in der aktuellen Stufe, beim Ausbau der Rest noch in der alten
    for (let q = 0; q < k.path.length - 1; q++) {
      const lvl = q + 1 < n ? k.lvl : k.lvl >= 2 ? k.lvl - 1 : 0;
      if (lvl) add(k.path[q], k.path[q + 1], lvl, e);
    }
    for (const i of k.path) era.set(i, Math.max(era.get(i) || 0, e));
  }
  // Ketten: von jedem Knoten mit Grad ungleich 2 entlang, bis wieder einer kommt; übrig gebliebene Ringe danach
  const chains = [];
  const walk = (start, key0) => {
    const tiles = [start], lv = [];
    let cur = start, key = key0;
    for (;;) {
      const e = edges.get(key);
      e.used = true; lv.push(e.lvl);
      const nxt = e.i === cur ? e.j : e.i;
      tiles.push(nxt);
      const list = adj.get(nxt);
      if (list.length !== 2) break;
      const k2 = list[0] === key ? list[1] : list[0];
      if (edges.get(k2).used) break;
      // Stufenwechsel beendet die Kette (eigenes Band je Stufe)
      if (edges.get(k2).lvl !== e.lvl) break;
      cur = nxt; key = k2;
    }
    chains.push({ tiles, lvl: lv[0] });
  };
  for (const [i, list] of adj) if (list.length !== 2) for (const key of list) if (!edges.get(key).used) walk(i, key);
  for (const [i, list] of adj) for (const key of list) if (!edges.get(key).used) walk(i, key);
  // Punkte, Profil, Brücken
  const spans = [];
  for (const c of chains) {
    const raw = c.tiles.map(i => [wx(i), wz(i), T.river[i] ? 1 : 0]);
    const pts = chaikin(raw, 2);
    const n = pts.length, s = new Float32Array(n), base = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      if (k) s[k] = s[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      base[k] = baseY(pts[k][0], pts[k][1]);
    }
    // Brücken: zusammenhängende Flusspunkte, bis über die Ufer verlängert
    const fixed = new Int8Array(n), prof = new Float32Array(n);
    const hw = WIDTH[c.lvl] / 2;
    let k = 0;
    c.bridges = [];
    while (k < n) {
      if (!pts[k][2]) { k++; continue; }
      let a = k, b = k;
      while (b + 1 < n && pts[b + 1][2]) b++;
      // bis die Ufer sicher erreicht sind (rund ein halbes Feld weiter)
      const sa = s[a], sb = s[b];
      while (a > 0 && sa - s[a] < 0.55) a--;
      while (b < n - 1 && s[b] - sb < 0.55) b++;
      const deck = Math.max(base[a], base[b], 0.1) + 0.1;
      for (let q = a; q <= b; q++) {
        const u = (s[q] - s[a]) / Math.max(1e-3, s[b] - s[a]);
        prof[q] = deck + Math.sin(u * Math.PI) * Math.min(0.06, (s[b] - s[a]) * 0.02);
        fixed[q] = 1;
      }
      c.bridges.push([a, b]);
      k = b + 1;
    }
    // Profil: weich mitteln (ohne Brücken), dann Steigung begrenzen (vorwärts und rückwärts, Brücken bleiben fest)
    for (let q = 0; q < n; q++) {
      if (fixed[q]) continue;
      let sum = 0, w = 0;
      for (let r = q; r >= 0 && s[q] - s[r] <= SMOOTH; r--) { const ww = 1 - (s[q] - s[r]) / (SMOOTH + 0.01); sum += base[r] * ww; w += ww; }
      for (let r = q + 1; r < n && s[r] - s[q] <= SMOOTH; r++) { const ww = 1 - (s[r] - s[q]) / (SMOOTH + 0.01); sum += base[r] * ww; w += ww; }
      prof[q] = sum / w;
    }
    for (let q = 1; q < n; q++) if (!fixed[q]) { const g = GRADE * (s[q] - s[q - 1]); prof[q] = Math.min(prof[q - 1] + g, Math.max(prof[q - 1] - g, prof[q])); }
    for (let q = n - 2; q >= 0; q--) if (!fixed[q]) { const g = GRADE * (s[q + 1] - s[q]); prof[q] = Math.min(prof[q + 1] + g, Math.max(prof[q + 1] - g, prof[q])); }
    // nie unter den Meeresspiegel (Küstenstraßen)
    for (let q = 0; q < n; q++) prof[q] = Math.max(prof[q], 0.08);
    c.pts = pts; c.s = s; c.prof = prof; c.hw = hw; c.fixed = fixed;
    c.era = Math.max(...c.tiles.map(i => era.get(i) || 0));
    for (const [a, b] of c.bridges) spans.push({ c, a, b, lvl: c.lvl, era: c.era });
  }
  return { chains, spans };
}
