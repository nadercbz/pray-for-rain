// Wildtiere: Füchse und Wolfsrudel in den Wäldern jeder Insel.
// Sie streifen umher, vermehren sich im Frühling, verschwinden, wenn der Wald schwindet, und fliehen vor Feuer.
// Jäger erlegen sie. Wölfe greifen selten Menschen an, meist in harten Wintern, und die Menschen deuten das auf ihre Weise.
// Deterministisch über den Welt Zufall; läuft alle 2 Tage.
import * as D from './data.js';
import { NX, idx, inb } from './world.js';
import { chron, fx, bio, killPerson, members, rng, landOf } from './util.js';
import { L } from '../i18n.js';

const KIND = {
  fuchs: { forest: 28, life: 7, range: 3 },
  wolf: { forest: 70, life: 10, range: 4, minArea: 200 },
};
// Todesursache als Code (die Ahnenhalle übersetzt)
export const CAUSE_WOLF = 'Wölfe';

const newId = st => { st.animalSeq = (st.animalSeq || 0) + 1; return st.animalSeq; };

// In der Erde zählen nur die Wälder rund um die Orte (Tiere, die niemand trifft, braucht die Simulation nicht)
function forestTiles(st) {
  const T = st.tiles, rt = st._rt, per = new Map();
  const add = i => {
    if (!T.tree[i] || T.h[i] < 1) return;
    const I = rt.isleOf[i];
    if (!I) return;
    let a = per.get(I);
    if (!a) per.set(I, a = []);
    a.push(i);
  };
  if (!st.earth) { for (let i = 0; i < T.tree.length; i++) add(i); return per; }
  const n = st.settlements.filter(s => s.alive).length;
  if (rt.forest && st.day - rt.forest.d < 24 && rt.forest.n === n) return rt.forest.per;
  const stamp = new Uint8Array(T.tree.length);
  for (const s of st.settlements) {
    if (!s.alive) continue;
    const R = s.R + 40;
    for (let y = Math.floor(s.cy - R); y <= s.cy + R; y++) for (let x = Math.floor(s.cx - R); x <= s.cx + R; x++) {
      if (!inb(x, y)) continue;
      const i = idx(x, y);
      if (!stamp[i]) { stamp[i] = 1; add(i); }
    }
  }
  rt.forest = { d: st.day, n, per };
  return per;
}
// Wo Tiere leben: Inseln, in der Erde die Landmassen
const places = st => (st.earth ? st.lands || [] : st.isles);

function spawn(st, r, k, isle, tiles, near) {
  let i;
  if (near) {
    for (let t = 0; t < 12 && i === undefined; t++) {
      const x = near.x + r.int(-3, 3), y = near.y + r.int(-3, 3);
      if (inb(x, y) && st.tiles.tree[idx(x, y)] && st._rt.isleOf[idx(x, y)] === isle) i = idx(x, y);
    }
  }
  if (i === undefined) i = tiles[r.int(0, tiles.length - 1)];
  const x = i % NX, y = (i / NX) | 0;
  const a = { id: newId(st), k, x, y, px: x, py: y, isle, b: st.day, hunger: 0 };
  if (k === 'wolf') a.pack = near && near.pack ? near.pack : a.id;
  st.animals.push(a);
  return a;
}

// Erste Besiedlung der Wälder (neue Welt oder alter Spielstand ohne Tiere)
export function initWildlife(st) {
  if (st.animals) return;
  st.animals = [];
  const r = rng(st), per = forestTiles(st);
  for (const I of places(st)) {
    const tiles = per.get(I.id) || [];
    if (tiles.length < 20) continue;
    const foxes = Math.floor(tiles.length / KIND.fuchs.forest * 0.7);
    for (let n = 0; n < foxes; n++) spawn(st, r, 'fuchs', I.id, tiles);
    if (I.area >= KIND.wolf.minArea) {
      const wolves = Math.floor(tiles.length / KIND.wolf.forest * 0.7);
      let lead = null;
      for (let n = 0; n < wolves; n++) { const w = spawn(st, r, 'wolf', I.id, tiles, n % 3 ? lead : null); if (n % 3 === 0) lead = w; }
    }
  }
}

// Nächster Ort am Tier. Seit 19.10.2026 über ein grobes Raster der Orte (rt.wGrid, je Wildtier-Runde neu), gleiche
// Antwort wie die Schleife über alle Orte (bei Gleichstand gewinnt der frühere Ort)
const GC = 32;
function nearGrid(st) {
  const g = new Map();
  st.settlements.forEach((s, k) => { if (!s.alive) return; const key = Math.floor(s.cx / GC) + ',' + Math.floor(s.cy / GC); let a = g.get(key); if (!a) g.set(key, a = []); a.push(k); });
  st._rt.wGrid = { day: st.day, n: st.settlements.length, g };
  return st._rt.wGrid;
}
function nearSettlement(st, x, y, pad) {
  const W = st._rt.wGrid && st._rt.wGrid.day === st.day && st._rt.wGrid.n === st.settlements.length ? st._rt.wGrid : nearGrid(st);
  const reach = Math.ceil((pad + 16) / GC), gx = Math.floor(x / GC), gy = Math.floor(y / GC);
  const ks = [];
  for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) { const a = W.g.get((gx + dx) + ',' + (gy + dy)); if (a) ks.push(...a); }
  ks.sort((a, b) => a - b);
  let best = null, bd = 1e9;
  for (const k of ks) {
    const s = st.settlements[k];
    if (!s.alive) continue;
    const d = Math.hypot(s.cx - x, s.cy - y) - s.R;
    if (d < pad && d < bd) { bd = d; best = s; }
  }
  return best ? { s: best, d: bd } : null;
}

export function wildlifeStep(st, season) {
  if (!st.animals) initWildlife(st);
  const r = rng(st), T = st.tiles, rt = st._rt;
  const per = forestTiles(st);
  const char = st.char || {};
  const count = {};
  for (const a of st.animals) { const key = a.k + a.isle; count[key] = (count[key] || 0) + 1; }
  const dead = new Set();
  const packLead = new Map();
  for (const a of st.animals) if (a.k === 'wolf' && a.pack === a.id) packLead.set(a.pack, a);

  for (const a of st.animals) {
    const K = KIND[a.k];
    const i0 = idx(a.x, a.y);
    // Feuer, Alter, Hunger
    if (T.burn[i0] > 1 && r.chance(0.5)) { dead.add(a); continue; }
    if (st.day - a.b > K.life * 24 && r.chance(0.08)) { dead.add(a); continue; }
    const forest = (per.get(a.isle) || []).length;
    const cap = Math.max(0, Math.floor(forest / K.forest));
    if (count[a.k + a.isle] > cap * 1.25 + 1 && r.chance(0.12)) { dead.add(a); count[a.k + a.isle]--; continue; }
    a.hunger = Math.min(1, Math.max(0, a.hunger + (season === 3 ? 0.16 : -0.035) + (forest < 80 ? 0.04 : 0)));
    // Bewegung: Wald bevorzugt, Orte meiden (hungrige Wölfe im Winter kommen näher)
    a.px = a.x; a.py = a.y;
    const bold = a.k === 'wolf' && a.hunger > 0.55;
    let gx = a.x, gy = a.y;
    const lead = a.pack && packLead.get(a.pack);
    if (lead && lead !== a) { gx = lead.x; gy = lead.y; }
    let best = null, bs = -1e9;
    for (let t = 0; t < 8; t++) {
      const x = a.x + r.int(-K.range, K.range), y = a.y + r.int(-K.range, K.range);
      if (!inb(x, y)) continue;
      const i = idx(x, y);
      if (T.h[i] < 0 || rt.isleOf[i] !== a.isle || rt.bldAt[i] || T.burn[i] > 1) continue;
      let sc = T.tree[i] * 1.2 + r.next() - Math.hypot(x - gx, y - gy) * (lead && lead !== a ? 0.5 : 0);
      const ns = nearSettlement(st, x, y, 6);
      if (ns) sc += bold ? 1.5 - ns.d * 0.2 : -4 + ns.d * 0.4;
      if (T.road[i] > 20) sc -= 1.5;
      if (sc > bs) { bs = sc; best = [x, y]; }
    }
    if (best) { a.x = best[0]; a.y = best[1]; }
  }

  // Jagd: Jäger einer Siedlung erlegen Tiere in der Nähe
  for (const s of st.settlements) {
    if (!s.alive) continue;
    const M = members(st, s);
    const hunters = M.adults.filter(p => p.job === 'jaeger' || (p.job === 'krieger' && s.wolfHunt > st.day));
    if (!hunters.length) continue;
    for (const a of st.animals) {
      if (dead.has(a) || a.isle !== landOf(s)) continue;
      const d = Math.hypot(a.x - s.cx, a.y - s.cy) - s.R;
      if (d > 16) continue;
      const p = Math.min(0.5, 0.05 * hunters.length) * (a.k === 'wolf' ? (s.wolfHunt > st.day ? 0.8 : 0.25) : 1);
      if (!r.chance(p)) continue;
      dead.add(a);
      s.stock.food += a.k === 'wolf' ? 4 : 6;
      const h = r.pick(hunters);
      h.fame = (h.fame || 0) + (a.k === 'wolf' ? 1 : 0.2);
      if (a.k === 'wolf') {
        bio(h, st.day, L('erlegt einen Wolf', 'kills a wolf'));
        if (r.chance(0.5)) chron(st, 'natur', r.pick(L(
          [`${h.n} aus ${s.name} bringt das Fell eines Wolfs nach Hause. Die Kinder tasten ehrfürchtig nach den Zähnen.`, `Die Jäger von ${s.name} haben einen Wolf gestellt. Heute Nacht schläft der Ort ruhiger.`],
          [`${h.n} of ${s.name} brings home the pelt of a wolf. The children touch its teeth in awe.`, `The hunters of ${s.name} have cornered a wolf. Tonight the village sleeps more easily.`])), s.id, 0, { x: a.x, y: a.y });
      }
      break;
    }
  }

  // Nach einem Angriff: die Siedlung zieht los und stellt die Wölfe
  for (const s of st.settlements) {
    if (!s.alive || !(s.wolfHunt > st.day)) continue;
    let best = null, bd = 26;
    for (const a of st.animals) if (!dead.has(a) && a.k === 'wolf' && a.isle === landOf(s)) { const d = Math.hypot(a.x - s.cx, a.y - s.cy); if (d < bd) { bd = d; best = a; } }
    if (!best || !r.chance(0.4)) continue;
    dead.add(best);
    st.counts.wolvesKilled = (st.counts.wolvesKilled || 0) + 1;
    const M = members(st, s), h = M.adults.length ? r.pick(M.adults) : null;
    if (h) { h.fame = (h.fame || 0) + 1; bio(h, st.day, L('erlegt einen Wolf', 'kills a wolf')); }
    chron(st, 'natur', r.pick(L(
      [`${h ? h.n : 'Die Jäger'} aus ${s.name} bringt das Fell eines Wolfs nach Hause. Die Kinder tasten ehrfürchtig nach den Zähnen.`, `Die Jäger von ${s.name} haben einen Wolf gestellt. Heute Nacht schläft der Ort ruhiger.`],
      [`${h ? h.n : 'The hunters'} of ${s.name} brings home the pelt of a wolf. The children touch its teeth in awe.`, `The hunters of ${s.name} have cornered a wolf. Tonight the village sleeps more easily.`])), s.id, 0, { x: best.x, y: best.y });
    if (!st.animals.some(a => !dead.has(a) && a.k === 'wolf' && a.isle === landOf(s) && Math.hypot(a.x - s.cx, a.y - s.cy) < 26)) s.wolfHunt = 0;
  }

  // Seltene Angriffe: hungrige Wölfe am Rand einer Siedlung
  // Nach einem Angriff bleibt es auf der ganzen Welt eine Weile ruhig (wolfCalm), damit es selten bleibt
  for (const a of st.animals) {
    if ((st.wolfCalm || 0) > st.day) break;
    if (dead.has(a) || a.k !== 'wolf' || a.hunger < 0.5) continue;
    const ns = nearSettlement(st, a.x, a.y, 3);
    if (!ns || ns.s.wolfHunt > st.day || !r.chance(0.0026 * (char.wild || 1) * (season === 3 ? 1.6 : 0.5))) continue;
    const s = ns.s, M = members(st, s);
    const out = M.all.filter(p => ['sammler', 'holzfaeller', 'jaeger', 'kind', 'bauer', 'fischer'].includes(p.job));
    if (!out.length) continue;
    const v = r.pick(out);
    a.hunger = 0;
    s.wolfHunt = st.day + 24;
    st.wolfCalm = st.day + D.DAYS_PER_YEAR * 4;
    st.counts.wolfAttacks = (st.counts.wolfAttacks || 0) + 1;
    s.omen = (s.omen || 0) + 0.04;
    fx(st, { type: 'angriff', x: a.x, y: a.y });
    const sign = s.cult.glaube > 0.6 && r.chance(0.5);
    if (r.chance(v.job === 'kind' ? 0.35 : 0.25)) {
      killPerson(st, v, CAUSE_WOLF);
      chron(st, 'tod', L(
        `Wölfe kommen in der Dämmerung bis an die Felder von ${s.name}. ${v.n} kehrt nicht heim.${sign ? ' Die Priester sagen, der Gott habe sie geschickt.' : ''}`,
        `Wolves come to the fields of ${s.name} at dusk. ${v.n} does not come home.${sign ? ' The priests say the god sent them.' : ''}`), s.id, 2, { x: a.x, y: a.y });
    } else {
      v.hp = Math.max(0.05, v.hp - 0.35);
      bio(v, st.day, L('überlebt einen Wolfsangriff', 'survives a wolf attack'));
      chron(st, 'natur', L(
        `Ein Wolf springt ${v.n} aus ${s.name} an. Mit zerrissenem Mantel und einer Narbe kommt ${v.sex === 'f' ? 'sie' : 'er'} davon. Die Jäger ziehen los.`,
        `A wolf leaps at ${v.n} of ${s.name}. With a torn cloak and a scar, ${v.sex === 'f' ? 'she' : 'he'} escapes. The hunters set out.`), s.id, 1, { x: a.x, y: a.y });
    }
  }

  if (dead.size) st.animals = st.animals.filter(a => !dead.has(a));

  // Frühling: Junge, wenn der Wald genug trägt
  if (season === 0 && st.day % 24 < 2) {
    for (const I of places(st)) {
      const tiles = per.get(I.id) || [];
      for (const k of Object.keys(KIND)) {
        const K = KIND[k];
        if (k === 'wolf' && I.area < K.minArea) continue;
        const have = st.animals.filter(a => a.k === k && a.isle === I.id);
        const cap = Math.floor(tiles.length / K.forest);
        let add = Math.min(cap - have.length, k === 'wolf' ? 2 : 3);
        // ohne Elterntiere kommen nur selten neue von anderswo
        if (!have.length && !r.chance(0.15)) add = 0;
        for (let n = 0; n < add; n++) spawn(st, r, k, I.id, tiles, have.length ? r.pick(have) : null);
      }
    }
  }
}
