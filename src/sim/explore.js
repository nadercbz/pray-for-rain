// Was die Menschen von der Welt kennen (seit 18.10.2026). st.tiles.seen: 0 unbekannt, 255 sicher bekannt, dazwischen
// der weiche Rand. Bekannt wird das Land um die Orte, die See entlang der Fahrten, das Innere über Kundschafterzüge
// (st.treks) und die Küsten über Küstenfahrten. Gegenden (st.regions) bekommen ihren Namen von den Ersten, die sie sehen.
// Die gezeichnete Karte (ui/map.js) zeigt nur, was hier bekannt ist. Siedler ziehen nur in bekanntes Land.
import { NX, NY, idx, inb, findPath } from './world.js';
import { chron, rng, knows, isleOf, members, landOf, bio as bioLine } from './util.js';
import { earthLandSight } from './folks.js';
import { regionName } from './continent.js';
import { placeName } from './names.js';
import { discover } from './sites.js';
import { BIOMES, BIO } from './data.js';
import { L } from '../i18n.js';

// Ein Fleck wird bekannt. who: wer ihn sieht (für Namen und Chronik), sonst still
export function reveal(st, cx, cy, r, who = null) {
  const T = st.tiles, S = T.seen, rt = st._rt, R = r + 2.5;
  let n = 0;
  const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(NY - 1, Math.ceil(cy + R));
  const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(NX - 1, Math.ceil(cx + R));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d > R) continue;
    const i = idx(x, y);
    const v = d <= r ? 255 : Math.round(200 * (1 - (d - r) / 2.5));
    if (v <= S[i]) continue;
    if (v === 255 && T.reg[i]) rt.regSeen[T.reg[i]]++;
    S[i] = v; n++;
  }
  if (n) { rt.seenAt = st.day; rt.seenGen = (rt.seenGen || 0) + 1; if (who) nameRegions(st, who, cx, cy); }
  return n;
}

// Gegenden, von denen jetzt genug bekannt ist, bekommen einen Namen in der Sprache der Entdecker.
// In die Chronik kommen nur große oder besondere Gegenden, höchstens eine alle 3 Tage (sonst still, die Karte zeigt sie)
function nameRegions(st, who, cx, cy) {
  const rt = st._rt;
  for (const g of st.regions || []) {
    if (g.name || rt.regSeen[g.id] < Math.max(6, Math.min(60, g.n * 0.12))) continue;
    if (Math.hypot(g.cx - cx, g.cy - cy) > 120) continue;
    const r = rng(st);
    g.name = regionName(r, g.b, placeName(r, who.lang ?? 0));
    g.by = who.id; g.d = st.day;
    const special = g.b === 'vulkan' || g.b === 'oase' || g.b === 'eis' || g.b === 'fjord' || g.b === 'wueste' || g.b === 'tropen';
    if (!(g.n > 500 || (special && g.n > 60)) || st.day - (rt.lastRegChron || -99) < 3) continue;
    rt.lastRegChron = st.day;
    const what = g.b === 'berge' ? L('ein Gebirge', 'a mountain range') : g.b === 'see' ? L('ein See', 'a lake') : BIOMES[BIO[g.b]] ? BIOMES[BIO[g.b]].name : '';
    chron(st, 'erkundung', r.pick(L([
      `Kundschafter aus ${who.name} erreichen neues Land${what ? ' (' + what + ')' : ''}. Ihr Name dafür: ${g.name}.`,
      `Neue Kunde in ${who.name}: Hinter dem bekannten Land liegt noch mehr${what ? ', ' + what : ''}. Die Entdecker sagen dazu ${g.name}.`,
    ], [
      `Scouts from ${who.name} reach new land${what ? ' (' + what.toLowerCase() + ')' : ''}. They call it ${g.name}.`,
      `News in ${who.name}: beyond the known land lies more${what ? ', ' + what.toLowerCase() : ''}. The explorers call it ${g.name}.`,
    ])), who.id, g.n > 900 || special ? 1 : 0, { x: g.cx, y: g.cy });
  }
}

// Küstenpunkte je Insel (jede dritte Küstenkachel), für Abstände zwischen Inseln und Landeplätze
export function coastPoints(st, isleId) {
  const rt = st._rt;
  // alle Inseln (in der Erde alle Landmassen) in einem Durchgang, jede mit eigenem Zähler (gleiche Punkte wie einzeln)
  if (!rt.coastPts) {
    const m = new Map(), k = new Map();
    for (let i = 0; i < NX * NY; i++) {
      const id = rt.isleOf[i];
      if (!id || !rt.coast[i] || !hasOcean(rt, i)) continue;
      const c = k.get(id) || 0; k.set(id, c + 1);
      if (c % 3) continue;
      let a = m.get(id); if (!a) m.set(id, a = []);
      a.push([i % NX, (i / NX) | 0]);
    }
    rt.coastPts = m;
  }
  let pts = rt.coastPts.get(isleId);
  if (!pts) { pts = []; rt.coastPts.set(isleId, pts); }
  return pts;
}
const hasOcean = (rt, i) => {
  const x = i % NX, y = (i / NX) | 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (inb(xx, yy) && rt.ocean[idx(xx, yy)]) return true; }
  return false;
};

// Kürzester Abstand zwischen den Küsten zweier Inseln und die beiden Punkte dazu
export function isleGap(st, I, J) {
  const rt = st._rt;
  rt.gaps = rt.gaps || new Map();
  const key = I.id < J.id ? I.id + '-' + J.id : J.id + '-' + I.id;
  let g = rt.gaps.get(key);
  if (!g) {
    const A = coastPoints(st, I.id), B = coastPoints(st, J.id);
    g = { d: 1e9, a: [I.cx, I.cy], b: [J.cx, J.cy] };
    const stepA = Math.max(1, Math.floor(A.length / 160)), stepB = Math.max(1, Math.floor(B.length / 400));
    for (let i = 0; i < A.length; i += stepA) for (let j = 0; j < B.length; j += stepB) {
      const d = Math.hypot(A[i][0] - B[j][0], A[i][1] - B[j][1]);
      if (d < g.d) g = { d, a: A[i], b: B[j] };
    }
    if (I.id > J.id) g = { d: g.d, a: g.b, b: g.a };
    rt.gaps.set(key, g);
    return g;
  }
  return I.id < J.id ? g : { d: g.d, a: g.b, b: g.a };
}

// Nächster bekannter Küstenpunkt einer Insel von einem Ort aus (Landeplatz für Siedler)
export function knownCoast(st, isleId, x, y) {
  const S = st.tiles.seen;
  let best = null, bd = 1e9;
  for (const p of coastPoints(st, isleId)) {
    if (S[idx(p[0], p[1])] < 200) continue;
    const d = Math.hypot(p[0] - x, p[1] - y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// Ganze Insel als bekannt markieren (mit etwas Meer drumherum)
function revealIsle(st, id) {
  const rt = st._rt, S = st.tiles.seen;
  for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    const i = idx(x, y);
    if (rt.isleOf[i] !== id) continue;
    if (S[i] < 255) { S[i] = 255; if (st.tiles.reg[i]) rt.regSeen[st.tiles.reg[i]]++; }
    if (rt.coast[i] && (x + y) % 3 === 0) reveal(st, x, y, 5);
  }
}

export function initExplore(st) {
  const rt = st._rt, T = st.tiles;
  rt.regSeen = new Int32Array((st.regions ? st.regions.length : 0) + 2);
  for (let i = 0; i < NX * NY; i++) if (T.seen[i] === 255 && T.reg[i]) rt.regSeen[T.reg[i]]++;
  st.treks = st.treks || [];
  if (st.exploreV) return;
  st.exploreV = 1;
  const alive = st.settlements.filter(s => s.alive);
  // Alte Welten (vor der neuen Welt gespielt): alle Inseln, die man schon kennt, sind bekannt, auch die Wege übers Meer
  if (st.day > 0) {
    const known = new Set();
    for (const s of alive) {
      known.add(s.isle);
      const I = isleOf(st, s);
      if (I) for (const k of [...Object.keys(I.seen || {}), ...Object.keys(I.contact || {})]) known.add(+k);
    }
    for (const id of known) revealIsle(st, id);
    for (const a of alive) for (const b of alive) if (a.id < b.id && known.has(a.isle) && known.has(b.isle) && a.isle !== b.isle) line(st, a.cx, a.cy, b.cx, b.cy, 5, null);
  }
  for (const s of alive) reveal(st, s.cx, s.cy, (s.R || 4) + 8 + (s.era || 0) * 2);
}

// Entlang einer Seefahrt bekannt machen: nur wo die Linie über Wasser geht (Schiffe sehen Küsten, nicht das Landesinnere)
function line(st, x0, y0, x1, y1, r, who) {
  const L0 = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(L0 / 3)), h = st.tiles.h;
  for (let k = 0; k <= n; k++) {
    const x = x0 + (x1 - x0) * k / n, y = y0 + (y1 - y0) * k / n;
    const i = idx(Math.max(0, Math.min(NX - 1, Math.round(x))), Math.max(0, Math.min(NY - 1, Math.round(y))));
    if (h[i] >= 0 && k > 0 && k < n) continue;
    reveal(st, x, y, r, k === n ? who : null);
  }
}

export function exploreStep(st) {
  const rt = st._rt, day = st.day;
  if (!rt.regSeen) initExplore(st);
  // Seefahrten zeigen das Meer, das Ziel und die Küste dort
  for (const v of st.voyages) {
    if (v.ex || v.k === 'pirat') continue;
    v.ex = 1;
    const A = rt.sById.get(v.a);
    const B = v.b != null ? rt.sById.get(v.b) : null;
    const to = B ? [B.cx, B.cy] : v.to;
    if (!A || !to) continue;
    // Dieselbe Fahrt (gleiche Orte, gleiche Art) hat schon alles gezeigt: nicht noch einmal rechnen (Handelsflotten
    // fahren dieselben Routen immer wieder, auf der Erde über Ozeane). Nach dem Laden zählt der erste Lauf neu.
    const key = A.cx + ',' + A.cy + ',' + to[0] + ',' + to[1] + ',' + v.k;
    rt.lineDone = rt.lineDone || new Set();
    if (rt.lineDone.has(key)) continue;
    rt.lineDone.add(key);
    line(st, A.cx, A.cy, to[0], to[1], v.k === 'handel' ? 3 : 4, null);
    reveal(st, to[0], to[1], v.k === 'entdeckung' ? 7 : 5, A);
  }
  // Die Orte kennen ihre Umgebung, mit der Zeit immer weiter
  if (day % 6 === 4) for (const s of st.settlements) if (s.alive) reveal(st, s.cx, s.cy, (s.R || 4) + 6 + (s.era || 0) * 1.5);
  if (day % 12 === 7) trekStep(st);
  if (day % 24 === 9) coastStep(st);
  if (st.treks.length > 60 || (st.treks.length && day - st.treks[0].d > 6 * 24)) st.treks = st.treks.filter(t => day - t.d <= 6 * 24).slice(-60);
}

// Kundschafter ziehen von einem Ort ins Unbekannte auf derselben Landmasse
function trekStep(st) {
  const r = rng(st), rt = st._rt, T = st.tiles;
  let sent = 0;
  for (const s of st.settlements) {
    if (!s.alive || s.pop < 10 || sent >= (st.earth ? 3 + st.isles.length : 3)) continue;
    const curious = 0.25 + (s.cult.wissen + s.cult.handel + (s.cult.freiheit || 0.4)) * 0.18;
    if (!r.chance(curious)) continue;
    const range = Math.min(95, 24 + (s.era || 0) * 10);
    let best = null, bs = -1e9;
    for (let k = 0; k < 70; k++) {
      const a = r.next() * Math.PI * 2, d = r.range(8, range);
      const x = Math.round(s.cx + Math.cos(a) * d), y = Math.round(s.cy + Math.sin(a) * d);
      if (!inb(x, y)) continue;
      const i = idx(x, y);
      if (T.h[i] < 0 || (rt.hb || T.h)[i] > 4 || T.seen[i] >= 200 || rt.isleOf[i] !== landOf(s)) continue;
      // lieber nah am Bekannten, nicht zu weit
      let edge = 0;
      for (const [dx, dy] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) if (inb(x + dx, y + dy) && T.seen[idx(x + dx, y + dy)] >= 200) edge++;
      const sc = edge * 4 - d * 0.08 + r.next() * 3;
      if (sc > bs) { bs = sc; best = [x, y]; }
    }
    if (!best) continue;
    const HB = rt.hb || T.h;
    const path = findPath(T.h, s.cx, s.cy, best[0], best[1], 9000, false, j => (HB[j] >= 5 ? Infinity : HB[j] >= 4 ? 3 : 0));
    if (!path || path.length < 4) continue;
    sent++;
    const view = 5 + Math.min(3, (s.era || 0) * 0.5);
    for (let k = 0; k < path.length; k += 2) reveal(st, path[k][0], path[k][1], view, k >= path.length - 2 ? s : null);
    reveal(st, best[0], best[1], view + 3, s);
    // Fundorte am Weg
    for (const o of st.finds || []) {
      if (o.found || o.t === 'nest' || o.t === 'schlacht' || o.t === 'versunken') continue;
      for (let k = 0; k < path.length; k += 3) if (Math.hypot(path[k][0] - o.x, path[k][1] - o.y) < 5) { if (r.chance(0.7)) discover(st, o, s, r); break; }
    }
    const pts = path.filter((_, k) => k % 3 === 0 || k === path.length - 1);
    st.treks.push({ a: s.id, d: st.day, p: pts });
    const lead = members(st, s).adults.find(p => p.job === 'jaeger' || p.job === 'sammler' || p.job === 'haendler');
    if (lead) bioLine(lead, st.day, L('zieht als Kundschafter ins Unbekannte', 'sets out as a scout into the unknown'));
    if (!s.trekked) {
      s.trekked = st.day;
      const I = isleOf(st, s);
      if (I && I.nw) chron(st, 'erkundung', r.pick(L([
        `${lead ? lead.n : 'Kundschafter'} aus ${s.name} bricht mit ein paar Mutigen ins Landesinnere auf. Niemand weiß, wie weit dieses Land reicht.`,
        `Aus ${s.name} ziehen die ersten Kundschafter los, mit Wasserschläuchen und Kreide für die Karte.`,
      ], [
        `${lead ? lead.n : 'Scouts'} of ${s.name} sets out inland with a few brave souls. No one knows how far this land reaches.`,
        `The first scouts leave ${s.name}, with waterskins and chalk for the map.`,
      ])), s.id, 1);
    }
  }
}

// Küstenfahrten: wer segeln kann, fährt an unbekannten Küsten entlang und zeichnet sie auf
function coastStep(st) {
  const r = rng(st), rt = st._rt, T = st.tiles;
  const harbor = new Set(st.buildings.filter(b => (b.t === 'hafen' || b.t === 'fischer') && b.prog >= 1).map(b => b.s));
  const byIsle = new Map();
  for (const s of st.settlements) if (s.alive && harbor.has(s.id) && knows(st, 'segeln', s)) { const a = byIsle.get(s.isle); if (!a || s.pop > a.pop) byIsle.set(s.isle, s); }
  for (const [isleId, s] of byIsle) {
    if (!r.chance(0.45 + s.cult.handel * 0.3)) continue;
    const I = rt.iById.get(isleId);
    const R = knows(st, 'navigation', s) ? 150 : knows(st, 'schiffbau', s) ? 110 : 70;
    let best = null, bd = 1e9;
    for (let k = 0; k < 220; k++) {
      // in der Erde rund um den Hafen suchen (die Welt ist zu groß für Zufallsfelder)
      const x = st.earth ? Math.round(s.cx + r.range(-R, R)) : r.int(2, NX - 3), y = st.earth ? Math.round(s.cy + r.range(-R, R)) : r.int(2, NY - 3);
      if (x < 2 || y < 2 || x > NX - 3 || y > NY - 3) continue;
      const i = idx(x, y);
      if (T.h[i] < 0 || !rt.coast[i] || T.seen[i] >= 200 || !hasOcean(rt, i)) continue;
      const d = Math.hypot(x - s.cx, y - s.cy);
      if (d > R) continue;
      const near = T.seen[idx(Math.max(0, x - 8), y)] + T.seen[idx(Math.min(NX - 1, x + 8), y)] + T.seen[idx(x, Math.max(0, y - 8))] + T.seen[idx(x, Math.min(NY - 1, y + 8))];
      if (!near) continue; // Küstenfahrten tasten sich am Bekannten entlang
      const sc = d - near * 0.05 + r.next() * 20;
      if (sc < bd) { bd = sc; best = [x, y]; }
    }
    if (!best) continue;
    st.voyages.push({ k: 'entdeckung', a: s.id, to: best, d: st.day, dur: 4 });
    if (st.earth) { const land = rt.isleOf[idx(best[0], best[1])]; if (land && land !== landOf(s)) earthLandSight(st, I, land, s); continue; }
    const J = rt.iById.get(rt.isleOf[idx(best[0], best[1])]);
    if (J && I && J !== I && !I.seen[J.id]) firstSight(st, I, J, s, r);
  }
}

// Erster Blick auf eine neue Insel oder das Festland
export function firstSight(st, I, J, from, r = rng(st)) {
  I.seen[J.id] = st.day;
  if (J.cont) {
    chron(st, 'erkundung', r.pick(L([
      `Seefahrer aus ${from.name} kehren zurück und schwören: Im Osten liegt Land ohne Ende, so weit das Auge reicht. Kein Mensch lebt dort. Sie nennen es ${J.name}, die neue Welt.`,
      `Ein Schiff aus ${from.name} folgt tagelang einer Küste, die nicht aufhört. Das ist keine Insel. ${J.name} heißt es seitdem, das Festland.`,
    ], [
      `Seafarers from ${from.name} return and swear: in the east lies endless land, as far as the eye can see. No one lives there. They call it ${J.name}, the new world.`,
      `A ship from ${from.name} follows a coast for days and it never ends. This is no island. Since then it is called ${J.name}, the mainland.`,
    ])), from.id, 2);
    return;
  }
  if (J.nw) chron(st, 'erkundung', r.pick(L([
    `Seefahrer aus ${from.name} finden weit draußen ${J.name}, eine Insel mit Palmen und warmem Wasser.`,
    `Hinter dem Horizont taucht ${J.name} auf. Die Seefahrer aus ${from.name} bringen Früchte mit, die niemand kennt.`,
  ], [
    `Seafarers from ${from.name} find ${J.name} far out at sea, an island of palms and warm water.`,
    `Beyond the horizon ${J.name} appears. The seafarers from ${from.name} bring back fruits nobody knows.`,
  ])), from.id, 1);
}
