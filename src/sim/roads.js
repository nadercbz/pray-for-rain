// Straßennetz zwischen den Orten einer Insel. Seit 19.10.2026 ein echtes Netz (Naders Wunsch: Straßen wie man sie
// bauen würde, keine Parallelstraßen): Eine neue Verbindung wird nur geplant, wenn ein Ort noch nicht angeschlossen ist
// oder der Weg über das vorhandene Netz einen großen Umweg macht. Die Wegsuche (roadPath) nutzt vorhandene Straßen
// fast umsonst, meidet Wege direkt neben einer Straße, Steigungen (lieber am Hang entlang), Häuser und vor allem Felder,
// quert Flüsse nur gerade (dort steht später eine Brücke, render/bridges.js) und mag gerade Strecken.
// Die Baumeister beider Orte bauen Kachel für Kachel (man sieht die Straße wachsen), schon gebaute Stücke des Netzes
// zählen sofort, die Stadtkasse zahlt den Lohn. Ab Steinbau wird gepflastert, ab Dampfkraft asphaltiert.
// Fertige Straßen machen den Handel billiger (netRoad: irgendein fertiger Weg im Netz zählt) und die Nachbarn vertrauter.
// st.links = [{ a, b, path: [Kachel], built, lvl, want, d, done }], st.roadNetV = 2 (Netzlogik)
import { NX, NY, idx } from './world.js';
import { chron, rng, members, knows, removeBuilding, sameLand } from './util.js';
import { streetPlan } from './streets.js';
import { L } from '../i18n.js';

// Mindestwert in T.road je Ausbau: Feldweg, Pflaster, Asphalt (terrain.js färbt danach)
export const FLOOR = [0, 95, 175, 240];
export const ROAD_NAME = [L('Weg', 'path'), L('Feldweg', 'dirt road'), L('gepflasterte Straße', 'paved road'), L('asphaltierte Straße', 'asphalt road')];
const levelFor = (st, s) => (knows(st, 'dampf', s) ? 3 : knows(st, 'steinbau', s) ? 2 : 1);
export const linkDone = k => k && k.path && k.built >= k.path.length;
export const linkBetween = (st, a, b) => (st.links || []).find(k => (k.a === a && k.b === b) || (k.a === b && k.b === a));
const DETOUR = 1.6;   // so viel länger als die Luftlinie darf der Weg über das Netz sein, bevor neu gebaut wird

// Mindestwerte der Straßenkacheln, damit Trampelpfad-Verfall (roads in core.js) sie nicht löscht.
// Dazu rt.roadNet: 1 für jede geplante oder gebaute Netzkachel (findSite baut dort keine Felder)
// Seit 19.10.2026 bleiben beide Felder im Speicher, geleert werden nur die Kacheln der letzten Runde (Erde: 2 Mio Felder)
export function roadFloor(st) {
  const rt = st._rt, n = NX * NY;
  let f = rt.roadFloor, net = rt.roadNet;
  if (!f || f.length !== n || !rt.roadIdx) { f = new Uint8Array(n); net = new Uint8Array(n); }
  else for (const i of rt.roadIdx) { f[i] = 0; net[i] = 0; }
  const used = [];
  for (const k of st.links || []) {
    if (!k.path) continue;
    const top = FLOOR[k.lvl] || 0, below = FLOOR[Math.max(0, k.lvl - 1)] || 0;
    k.path.forEach((i, m) => { if (!net[i]) used.push(i); net[i] = 1; const v = m < k.built ? top : below; if (v > f[i]) f[i] = v; });
  }
  rt.roadIdx = used;
  rt.roadFloor = f;
  rt.roadNet = net;
  rt.netComp = null;
  return f;
}

// Sind zwei Orte über fertige Straßen verbunden (auch über andere Orte)?
export function netRoad(st, a, b) {
  const rt = st._rt;
  if (!rt.netComp) {
    const par = new Map(), find = x => { while (par.has(x) && par.get(x) !== x) x = par.get(x); return x; };
    for (const k of st.links || []) if (linkDone(k)) { const ra = find(k.a), rb = find(k.b); if (!par.has(ra)) par.set(ra, ra); if (ra !== rb) par.set(rb, ra); }
    rt.netComp = { find };
  }
  return a === b || rt.netComp.find(a) === rt.netComp.find(b);
}

// Weg über das Netz zwischen zwei Orten (Länge in Kacheln über geplante und gebaute Verbindungen), Infinity ohne Netz
function netDist(st, a, b) {
  const adj = new Map();
  for (const k of st.links || []) {
    if (!k.path) continue;
    const w = k.path.length;
    (adj.get(k.a) || adj.set(k.a, []).get(k.a)).push([k.b, w]);
    (adj.get(k.b) || adj.set(k.b, []).get(k.b)).push([k.a, w]);
  }
  const dist = new Map([[a, 0]]), open = [[0, a]];
  while (open.length) {
    open.sort((p, q) => p[0] - q[0]);
    const [d, u] = open.shift();
    if (u === b) return d;
    if (d > (dist.get(u) ?? Infinity)) continue;
    for (const [v, w] of adj.get(u) || []) if (d + w < (dist.get(v) ?? Infinity)) { dist.set(v, d + w); open.push([d + w, v]); }
  }
  return Infinity;
}

// Wegsuche für Straßen (A* mit Gewicht), von Kachel (x0, y0) zu (x1, y1). net: Uint8Array der Netzkacheln.
// Kosten je Schritt: Länge, vorhandene Straße mal 0,2, neben einer Straße plus 0,8, Steigung stark (zwei Stufen auf
// einmal verboten, kurz nach einer Steigung die nächste extra teuer: die Straße windet sich), Richtungswechsel,
// Häuser plus 8, Felder plus 25, Flüsse nur gerade quer, Wasser verboten, Hochgebirge teuer.
const D8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
// strict (seit 24.10.2026): Gebäude außer Feldern, Zentrum und Park sind gesperrt, sonst stand später ein Haus auf der Straße
export function roadPath(st, x0, y0, x1, y1, net, plan, maxIter = 90000, strict = false) {
  const T = st.tiles, H = T.h, R = T.river, rt = st._rt;
  const start = idx(x0, y0), goal = idx(x1, y1);
  if (start === goal) return [start];
  // Arbeitsfelder einmal anlegen und nach jeder Suche nur die berührten Kacheln zurücksetzen (gleiches Ergebnis,
  // aber ohne fünf Felder in Weltgröße je Suche: in der Erde wären das 22 MB)
  const n = NX * NY;
  if (!rt.rpBuf || rt.rpBuf.n !== n) rt.rpBuf = { n, g: new Float32Array(n).fill(Infinity), came: new Int32Array(n).fill(-1), dirOf: new Int8Array(n).fill(-1), sinceClimb: new Uint8Array(n), closed: new Uint8Array(n) };
  const { g, came, dirOf, sinceClimb, closed } = rt.rpBuf;
  const touched = [];
  const reset = () => { for (const j of touched) { g[j] = Infinity; came[j] = -1; dirOf[j] = -1; sinceClimb[j] = 0; closed[j] = 0; } };
  const N = NX;
  const heap = [];
  const push = (f, n) => { heap.push([f, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const bAt = j => { const id = rt.bldAt[j]; return id ? rt.bById.get(id) : null; };
  const solid = j => { const b = bAt(j); return b && b.t !== 'zentrum' && b.t !== 'park'; };
  const nearNet = j => { const x = j % N, y = (j / N) | 0; return (x > 0 && net[j - 1]) || (x < N - 1 && net[j + 1]) || (y > 0 && net[j - N]) || (y < NY - 1 && net[j + N]); };
  const endZone = j => { const x = j % N, y = (j / N) | 0; return Math.max(Math.abs(x - x0), Math.abs(y - y0)) <= 2 || Math.max(Math.abs(x - x1), Math.abs(y - y1)) <= 2; };
  g[start] = 0; sinceClimb[start] = 9; touched.push(start);
  push(Math.hypot(x1 - x0, y1 - y0) * 0.45, start);
  let iter = 0;
  while (heap.length && iter++ < maxIter) {
    const [, cur] = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) {
      const out = [];
      for (let c = cur; c !== -1; c = came[c]) out.push(c);
      reset();
      return out.reverse();
    }
    const cx = cur % N, cy = (cur / N) | 0, gc = g[cur], d0 = dirOf[cur];
    for (let d = 0; d < 8; d++) {
      const [dx, dy] = D8[d], xx = cx + dx, yy = cy + dy;
      if (xx < 1 || yy < 1 || xx >= NX - 1 || yy >= NY - 1) continue;
      const j = yy * N + xx;
      if (closed[j]) continue;
      if (H[j] < 0 && j !== goal) continue;
      const diag = dx && dy;
      if (diag) {
        const a = cy * N + xx, b = yy * N + cx;
        if (H[a] < 0 || H[b] < 0 || solid(a) || solid(b) || R[a] || R[b] || R[j] || R[cur]) continue;
      }
      const dh = Math.abs(H[j] - H[cur]);
      if (dh >= 2 && j !== goal) continue;
      let cost = diag ? 1.414 : 1;
      let climb = sinceClimb[cur] < 250 ? sinceClimb[cur] + 1 : 250;
      if (net[j]) cost *= 0.2;
      else {
        if (dh) { cost += dh * 6 + (sinceClimb[cur] < 3 ? 8 : 0); climb = 0; }
        if (nearNet(j) && !endZone(j)) cost += 0.8;
        const b = j !== goal && bAt(j);
        if (b && strict && b.t !== 'feld' && b.t !== 'zentrum' && b.t !== 'park') continue;
        if (b) cost += b.t === 'feld' ? 25 : b.t === 'zentrum' || b.t === 'park' ? 0.5 : 8;
        if (R[j]) cost += R[cur] ? 6 : 3;
        if (H[j] >= 6) cost += 1.5;
        if (plan && plan[j]) cost *= 0.6;
      }
      if (d0 >= 0) { const t = Math.min((d - d0 + 8) % 8, (d0 - d + 8) % 8); cost += t === 1 ? 0.15 : t === 2 ? 0.4 : t >= 3 ? 1.2 : 0; }
      const ng = gc + cost;
      if (ng < g[j]) {
        if (g[j] === Infinity) touched.push(j);
        g[j] = ng; came[j] = cur; dirOf[j] = d; sinceClimb[j] = climb;
        push(ng + Math.hypot(x1 - xx, y1 - yy) * 0.45, j);
      }
    }
  }
  reset();
  return null;
}

// Planstraßen aller Orte als Maske (Landstraßen kommen gern über die Planstraßen in den Ort)
function planMask(st) {
  const rt = st._rt;
  if (rt.planMask && rt.planMask.d === st.day) return rt.planMask.m;
  const m = new Uint8Array(NX * NY);
  for (const s of st.settlements) if (s.alive) for (const i of streetPlan(st, s)) m[i] = 1;
  rt.planMask = { d: st.day, m };
  return m;
}

function pathFor(st, A, B, net, plan) {
  const rt = st._rt, c1 = rt.bById.get(A.center), c2 = rt.bById.get(B.center);
  if (!c1 || !c2) return null;
  // erst ohne Häuser im Weg; nur wenn es so gar nicht geht (alte, dichte Städte), wie früher mit Aufpreis
  return roadPath(st, c1.x, c1.y, c2.x, c2.y, net, plan, 90000, true) || roadPath(st, c1.x, c1.y, c2.x, c2.y, net, plan);
}

// Umstellung alter Spielstände auf das Netz (einmal): alle Verbindungen nach Luftlinie aufsteigend neu suchen, dabei
// das schon Gesuchte mitnutzen. Was über das Netz ohnehin gut verbunden ist, bekommt keinen eigenen Weg mehr
// (path: null, merged: true). Gebautes bleibt gebaut (anteilig auf den neuen Weg), alte Spuren daneben verwittern.
function migrate(st) {
  const rt = st._rt, T = st.tiles;
  st.roadNetV = 2;
  const links = (st.links || []).filter(k => k.path);
  if (!links.length) return;
  const old = new Uint8Array(NX * NY);
  for (const k of links) for (const i of k.path) old[i] = 1;
  const air = k => { const A = rt.sById.get(k.a), B = rt.sById.get(k.b); return A && B ? Math.hypot(A.cx - B.cx, A.cy - B.cy) : 1e9; };
  links.sort((p, q) => air(p) - air(q));
  const net = new Uint8Array(NX * NY), plan = planMask(st), keep = [];
  for (const k of links) {
    const A = rt.sById.get(k.a), B = rt.sById.get(k.b);
    if (!A || !B) continue;
    const nd = netDist({ links: keep }, k.a, k.b);
    if (nd <= air(k) * DETOUR + 4) { k.merged = true; k.path = null; continue; }
    const done = k.built >= k.path.length, part = k.path.length ? k.built / k.path.length : 0;
    const p = pathFor(st, A, B, net, plan);
    if (p && p.length >= 2) {
      k.path = p;
      k.built = done ? p.length : Math.round(part * p.length);
      // der schon gebaute Teil liegt sofort als Straße im Boden (sonst erst nach dem nächsten Verfallslauf)
      const top = FLOOR[k.lvl] || 0;
      for (let n = 0; n < k.built; n++) { const i = p[n]; if (T.road[i] < top) T.road[i] = top; if (T.tree[i]) T.tree[i] = 0; }
    }
    for (const i of k.path) net[i] = 1;
    keep.push(k);
  }
  // alte Strecken, die nicht mehr zum Netz gehören, außerhalb der Orte verwittern lassen
  for (let i = 0; i < NX * NY; i++) {
    if (!old[i] || net[i]) continue;
    const x = i % NX, y = (i / NX) | 0;
    if (st.settlements.some(s => s.alive && Math.hypot(s.cx - x, s.cy - y) < (s.R || 4) + 1)) continue;
    if (T.road[i] > 30) T.road[i] = 30;
  }
  roadFloor(st);
  rt.dirtyT = true;
}

export function roadNetStep(st) {
  const r = rng(st), rt = st._rt, T = st.tiles;
  st.links = st.links || [];
  if (st.roadNetV !== 2) migrate(st);
  if (!rt.roadNet) roadFloor(st);
  const alive = st.settlements.filter(s => s.alive && s.era >= 1);
  // 1 Planen: höchstens eine neue Verbindung je Runde, zum nächsten Nachbarn, der über das Netz nicht gut erreichbar ist
  let planned = false;
  for (const s of alive) {
    if (planned) break;
    const near = alive.filter(o => o !== s && o.isle === s.isle && sameLand(st, o, s)).map(o => [o, Math.hypot(o.cx - s.cx, o.cy - s.cy)]).filter(x => x[1] < 95).sort((a, b) => a[1] - b[1]).slice(0, 3);
    for (const [o, d] of near) {
      const old = linkBetween(st, s.id, o.id);
      if (old && !(old.retry && st.day > old.retry)) continue;
      if (old) st.links = st.links.filter(k => k !== old); // aufgegebener Bau: neu planen
      if (s.war === o.id || (s.rel[o.id] ?? 0) < -10) continue;
      if (netDist(st, s.id, o.id) <= d * DETOUR + 4) continue;
      const path = pathFor(st, s, o, rt.roadNet, planMask(st));
      if (!path || path.length < 3) { st.links.push({ a: s.id, b: o.id, path: null, d: st.day }); continue; }
      st.links.push({ a: s.id, b: o.id, path, built: 0, lvl: 0, want: levelFor(st, s), d: st.day });
      roadFloor(st);
      if (r.chance(0.6)) chron(st, 'bau', L(`${s.name} und ${o.name} beschließen, eine Straße zu bauen. Die Baumeister schlagen die ersten Pflöcke ein.`, `${s.name} and ${o.name} decide to build a road. The builders drive in the first stakes.`), s.id, 0);
      planned = true;
      break;
    }
  }
  // 2 Bauen und Ausbauen
  let dirty = false;
  for (const k of st.links) {
    if (!k.path) continue;
    const A = rt.sById.get(k.a), B = rt.sById.get(k.b);
    if (!A || !B || !A.alive || !B.alive || A.war === B.id) continue;
    const want = Math.min(levelFor(st, A), levelFor(st, B));
    if (k.built >= k.path.length) {
      if (k.lvl >= want) continue;
      // nächste Ausbaustufe: dieselbe Strecke noch einmal, diesmal mit Pflaster oder Asphalt
      k.built = 0; k.lvl = want; k.done = false;
    }
    if (!k.lvl) k.lvl = want;
    // Erstbau, der seit 8 Jahren nicht vorankommt (kein Material, Streit): aufgegeben, in 20 Jahren neu geplant.
    // Sonst endet ein halber Weg jahrzehntelang im Gelände (seit 24.10.2026)
    if (k.pd == null) k.pd = st.day; // alte Stände: die Uhr beginnt jetzt
    if (!k.done && !k.dd && k.built < k.path.length && st.day - k.pd > 8 * 24) {
      k.path = null; k.built = 0; k.retry = st.day + 20 * 24; dirty = true;
      continue;
    }
    // Stücke, die das Netz schon in dieser Stufe hat, zählen sofort (gemeinsame Abschnitte werden nicht doppelt gebaut)
    const top = FLOOR[k.lvl];
    while (k.built < k.path.length && T.road[k.path[k.built]] >= top) { k.built++; k.pd = st.day; dirty = true; }
    if (k.built >= k.path.length) { finish(st, k, A, B); continue; }
    let builders = 0;
    for (const s of [A, B]) for (const p of members(st, s).adults) if (p.job === 'baumeister') builders++;
    const rate = Math.round(1 + builders * 0.6 + Math.min(A.era, B.era) * 0.4);
    // Material und Lohn: Holz, ab Pflaster Stein, Geld aus den Kassen an den Markt (Löhne der Bauleute)
    const need = { wood: 0.25 * rate, stone: k.lvl >= 2 ? 0.5 * rate : 0 };
    const payer = [A, B].find(s => s.stock.wood >= need.wood && s.stock.stone >= need.stone);
    if (!payer) continue;
    payer.stock.wood -= need.wood; payer.stock.stone -= need.stone;
    const wage = (payer.avgWage || 1) * 0.6 * rate;
    if (payer.fin) { payer.stock.gold -= wage; payer.mkt = (payer.mkt || 0) + wage; payer.fin.build += wage; }
    const to = Math.min(k.path.length, k.built + rate);
    for (let n = k.built; n < to; n++) {
      const i = k.path[n];
      if (T.road[i] < top) T.road[i] = top;
      if (T.tree[i]) T.tree[i] = 0;
      // steht hier ein Feld (die Wegsuche meidet sie, ganz selten geht es nicht anders), weicht es der Straße
      const b = rt.bById.get(rt.bldAt[i]);
      if (b && b.t === 'feld') {
        removeBuilding(st, b, false);
        const S = rt.sById.get(b.s);
        if (S && !k.fieldNote) { k.fieldNote = 1; chron(st, 'bau', L(`In ${S.name} wird ein Feld umgepflügt: Die neue Straße führt mitten hindurch.`, `In ${S.name} a field is ploughed under: the new road runs straight through it.`), S.id, 0); }
      } else if (b && b.t !== 'zentrum') {
        // nur über den Notweg durch alte, dichte Städte möglich (pathFor): das Haus weicht, statt auf der Straße zu stehen
        removeBuilding(st, b, false);
        const S = rt.sById.get(b.s);
        if (S && !k.houseNote) { k.houseNote = 1; chron(st, 'bau', L(`In ${S.name} wird für die neue Straße ein Haus abgerissen.`, `In ${S.name} a house is torn down for the new road.`), S.id, 0); }
      }
    }
    k.built = to;
    k.pd = st.day;
    dirty = true;
    if (k.built >= k.path.length) finish(st, k, A, B);
  }
  if (dirty) { roadFloor(st); rt.dirtyT = true; }
}

function finish(st, k, A, B) {
  if (k.done) return;
  k.done = true; k.dd = st.day;
  A.rel[B.id] = B.rel[A.id] = Math.min(100, (A.rel[B.id] ?? 0) + 6);
  chron(st, 'bau', k.lvl === 1
    ? L(`Die Straße zwischen ${A.name} und ${B.name} ist fertig. Karren rollen, Nachrichten reisen schneller.`, `The road between ${A.name} and ${B.name} is finished. Carts roll, news travels faster.`)
    : k.lvl === 2
      ? L(`Die Straße zwischen ${A.name} und ${B.name} ist jetzt gepflastert. Die Räder klappern über den Stein.`, `The road between ${A.name} and ${B.name} is now paved. Wheels clatter over the stone.`)
      : L(`Zwischen ${A.name} und ${B.name} liegt jetzt eine glatte Asphaltstraße. Motoren brummen durch die Nacht.`, `A smooth asphalt road now runs between ${A.name} and ${B.name}. Engines hum through the night.`),
    A.id, k.lvl === 1 ? 1 : 0);
}
