// Herz der Simulation: ein Spieltag nach dem anderen.
// Reines JavaScript ohne DOM, läuft im Browser und in Node (Tests, Nachholen).
// Seit Version 2: ein Archipel. Jede Insel hat ihr eigenes Wissen und ihre eigene Epoche.
import { Rng, clamp } from './rng.js';
import * as D from './data.js';
import { generateWorld, NX, NY, setWorldSize, idx, inb, D4, D8, isCoast, isleMap, landMap, eachSet, encode, decode, embedTiles, buildLevels } from './world.js';
import { encodeEarthTiles, decodeEarthTiles, earthSaveExtras, EARTH_MAX_SETTLEMENTS, folkSplitStep, folkReviveStep, pruneDead } from './folks.js';
import { growWorld, findRegions } from './continent.js';
import { initExplore, exploreStep } from './explore.js';
import { ensurePlan, planStep, streetWork, blocksOf, blockState, edgeLots, usable, townMask, frontOf, zoneOf, zoneFit, plazaSpots, planAccess, PLAZA, OUTSIDE_T, SQUARE } from './cityplan.js';
import { LANGS, placeName } from './names.js';
import {
  seasonOf, ageOf, knows, chron, fx, bio, makePerson, killPerson, compactPeople, addBuilding,
  homeCap, settlementRadius, distTo, shiftCult, members, setTerritory, rng, newId, removeBuilding, isleOf, landOf, bldOf,
} from './util.js';
import { politicsStep, relationsStep, foundingStep, schismStep, unionStep, prayersStep, eventsStep, yearStep, chooseLeader, foundSettlement } from './society.js';
import { initSites, sitesStep, initNewWorldFinds } from './sites.js';
import { piratesStep } from './pirates.js';
import { expeditionsStep } from './powers.js';
import { seaStep } from './sea.js';
import { L } from '../i18n.js';
import { wildlifeStep } from './wildlife.js';
import { worldCharacter, characterLine } from './character.js';
import { BASE, initMoney, moneyIndex, moneyDay, moneyWeek, moneyYear, tradeStep, financeBuild, estate } from './money.js';
import { socialStep, socialYear, socialDeath, initSocial } from './social.js';
import { roadNetStep, roadFloor } from './roads.js';
import { diaryStep, initDiaries } from './diary.js';
import { heroStep } from './hero.js';
import { diplomacyStep } from './diplomacy.js';
import { militaryStep, initMilitary } from './military.js';
import { progressStep, refreshProgress, pe, worldCap, townCap } from './progress.js';
import { initStates, statesStep } from './states.js';
import { initSociety, societyStep } from './lab.js';
import { jobGate } from './mobility.js';

export const SET_COLORS = ['#e07a5f', '#5fa8d3', '#e9c46a', '#8ab17d', '#b388eb', '#f4a261', '#d4708f', '#6fb7a8', '#c9a227', '#8a9bd4', '#c46b4a', '#7fb3c9'];

// ---------- Aufbau ----------

export function hydrate(st) {
  const rt = {
    rng: new Rng(st.rng),
    pById: new Map(), bById: new Map(), sById: new Map(), iById: new Map(),
    bldAt: new Int32Array(NX * NY), owner: new Int32Array(NX * NY),
    isleKnown: new Map(), anyKnown: new Set(), isleOf: new Int16Array(NX * NY), coast: new Uint8Array(NX * NY), lById: new Map(),
    bySet: new Map(), fx: [], newChron: [], deadToday: [], dirtyB: true, dirtyT: true, catchup: false,
  };
  st._rt = rt;
  for (const k of ['bio', 'river', 'seen', 'reg', 'st']) if (!st.tiles[k]) st.tiles[k] = new Uint8Array(NX * NY);
  if (!st.regions) st.regions = [];
  for (const Ld of st.lands || []) rt.lById.set(Ld.id, Ld); // Landmassen der Erde (folks.js)
  rt.maxSet = st.earth ? EARTH_MAX_SETTLEMENTS : D.MAX_SETTLEMENTS;
  if (!st.char) st.char = worldCharacter(st.seed || 1);
  for (const I of st.isles) {
    rt.iById.set(I.id, I);
    rt.isleKnown.set(I.id, new Set(I.techs));
    for (const t of I.techs) rt.anyKnown.add(t);
  }
  for (const p of st.people) rt.pById.set(p.id, p);
  for (const b of st.buildings) { rt.bById.set(b.id, b); rt.bldAt[idx(b.x, b.y)] = b.id; }
  for (const s of st.settlements) rt.sById.set(s.id, s);
  refreshCoast(st);
  indexMembers(st);
  setTerritory(st);
  rt.richest = new Map(); rt.kidsOf = new Map();
  rt.deadName = new Map();
  rt.onDeath = (st2, p) => { estate(st2, p); socialDeath(st2, p); rt.deadName.set(p.id, p.n); if (rt.deadName.size > 3000) rt.deadName.clear(); };
  if (st.people.length) { initMoney(st); initSocial(st); }
  moneyIndex(st, true);
  roadFloor(st);
  if (st.people.length) initDiaries(st);
  initSites(st); // Fundorte (alte Spielstände bekommen sie beim Laden)
  initNewWorldFinds(st); // und die der neuen Welt
  initExplore(st); // was die Menschen von der Welt kennen (alte Spielstände: alles, was sie schon befahren haben)
  initSociety(st); // Herkunft, Glaube, Seuchen, Labor (lab.js), alte Spielstände werden nachgerüstet
  initMilitary(st); // Heere und Kriegsbuch (military.js)
  refreshProgress(st); // Fortschritt nach dem letzten Wissen, Grenzen des Wachstums (progress.js)
  initStates(st); // Staaten, Bürgermeister, Parteien, Regierung (states.js); alte Stände: je Ort ein Staat
  return st;
}

export function refreshCoast(st) {
  const rt = st._rt, h = st.tiles.h;
  for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) rt.coast[idx(x, y)] = isCoast(h, x, y) ? 1 : 0;
  rt.isleOf = st.earth ? landMap(h, st.lands || []) : isleMap(h, st.isles);
  rt.hb = st.earth ? buildLevels(h, NX, NY) : null; // Erde: Baustufe, flache Hochebenen wie Hügelland (world.js)
  rt.coastPts = null; rt.gaps = null; rt.lineDone = null;
  // Offenes Meer (vom Rand aus erreichbar): Seen und Fjordenden zählen nicht für Häfen und Seewege
  const ocean = rt.ocean = new Uint8Array(NX * NY), q = [];
  for (let k = 0; k < NX; k++) for (const i of [idx(k, 0), idx(k, NY - 1)]) if (h[i] < 0 && !ocean[i]) { ocean[i] = 1; q.push(i); }
  for (let k = 0; k < NY; k++) for (const i of [idx(0, k), idx(NX - 1, k)]) if (h[i] < 0 && !ocean[i]) { ocean[i] = 1; q.push(i); }
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % NX, y = (i / NX) | 0;
    for (const [dx, dy] of D4) { const xx = x + dx, yy = y + dy; if (!inb(xx, yy)) continue; const j = idx(xx, yy); if (h[j] < 0 && !ocean[j]) { ocean[j] = 1; q.push(j); } }
  }
}

// folk: in der Erde das Volk der neuen Siedlung (st.isles sind dort die Völker, die Landmasse kommt nach s.land)
export function newSettlement(st, cx, cy, lang, cult, name, folk) {
  const r = rng(st);
  const s = {
    id: newId(st), name: name || freshName(st, r, lang), lang, cx, cy, founded: st.day, alive: true,
    isle: st.earth ? (folk || 1) : st._rt.isleOf[idx(cx, cy)] || 1,
    color: SET_COLORS[st.settlements.length % SET_COLORS.length],
    stock: { food: 70, wood: 14, stone: 0, ore: 0, tools: 0, goods: 0, gold: 0 },
    cult, gov: { type: 'rat', leader: null, since: st.day, next: 0, dyn: null },
    laws: [], unrest: 0.08, hap: 0.65, faith: 0.4, hunger: 0, rel: {}, war: null, ally: {}, truce: {},
    has: {}, center: null, R: 4, prod: {}, cache: { forest: 0, at: -99 }, blessed: 0, warScore: 0,
    pop: 0, peak: 0, bias: {}, char: Object.fromEntries(Object.keys(D.CULTURE).map(k => [k, Math.round(r.gauss() * 0.3 * 100) / 100])),
    price: { ...BASE }, mkt: 40, avgWage: 1, gini: 0,
    fin: { wage: 0, profit: 0, rent: 0, tax: 0, salary: 0, welfare: 0, cons: 0, lux: 0, build: 0, exp: 0, imp: 0, tariff: 0, mint: 0, interest: 0, prod: 0, ybase: 0, theft: 0, unpaid: 0 },
  };
  if (st.earth) s.land = st._rt.isleOf[idx(cx, cy)] || 0;
  s.era = (isleOf(st, s) || { era: 0 }).era;
  st.settlements.push(s);
  st._rt.sById.set(s.id, s);
  for (const o of st.settlements) if (o !== s && o.alive) { s.rel[o.id] = o.isle === s.isle ? 30 : 0; o.rel[s.id] = s.rel[o.id]; }
  const c = addBuilding(st, s, 'zentrum', cx, cy, true);
  s.center = c.id;
  ensurePlan(st, s); // Regelwerk: der Stadtplan liegt, bevor das erste Haus steht
  return s;
}

// Ortsnamen sollen sich nicht mit Inseln oder anderen Orten doppeln
function freshName(st, r, lang) {
  const taken = new Set([...st.settlements.map(s => s.name), ...st.isles.map(I => I.name)]);
  for (let k = 0; k < 30; k++) { const n = placeName(r, lang); if (!taken.has(n)) return n; }
  return placeName(r, lang) + ' ' + (st.settlements.length + 1);
}

function randomCulture(r, base) {
  const c = {};
  for (const k of Object.keys(D.CULTURE)) c[k] = clamp((base ? base[k] : 0.42) + r.gauss() * (base ? 0.16 : 0.22), 0.08, 0.9);
  return c;
}

export function landingSpot(st, isleId) {
  const T = st.tiles, rt = st._rt, r = rng(st);
  const I = rt.iById.get(isleId);
  let best = null, bs = -1e9;
  const span = I ? Math.sqrt(I.area) * 0.9 + 6 : NX / 2;
  for (let i = 0; i < 700; i++) {
    const x = Math.round((I ? I.cx : NX / 2) + r.range(-span, span)), y = Math.round((I ? I.cy : NY / 2) + r.range(-span, span));
    if (!inb(x, y)) continue;
    const k = idx(x, y);
    if (T.h[k] !== 1 || rt.isleOf[k] !== isleId) continue;
    let fert = 0, trees = 0, water = 0, high = 0;
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      const xx = x + dx, yy = y + dy; if (!inb(xx, yy)) continue;
      const j = idx(xx, yy);
      if (T.h[j] < 0) water++; else { fert += T.fert[j]; trees += T.tree[j]; if (T.h[j] >= 3) high++; }
    }
    const s = fert / 60 + Math.min(trees, 40) * 0.25 + (water > 6 && water < 40 ? 8 : -6) - high * 0.3 - T.tree[k] * 2 + r.next() * 3;
    if (s > bs) { bs = s; best = [x, y]; }
  }
  return best;
}

// Eine Gruppe Menschen landet auf einer Insel
function landPeople(st, isleId, n, lang, text) {
  const r = rng(st);
  const spot = landingSpot(st, isleId);
  if (!spot) return null;
  const s = newSettlement(st, spot[0], spot[1], lang, randomCulture(r));
  const pairs = Math.floor(n / 2.4);
  for (let i = 0; i < pairs; i++) {
    const f = makePerson(st, s, { sex: 'f', b: -r.int(17, 31) * D.DAYS_PER_YEAR - r.int(0, 23) });
    const m = makePerson(st, s, { sex: 'm', b: -r.int(18, 33) * D.DAYS_PER_YEAR - r.int(0, 23), clan: r.chance(0.5) ? f.clan : undefined });
    f.pa = m.id; m.pa = f.id;
    if (i < n - pairs * 2) {
      const k = makePerson(st, s, { b: -r.int(3, 9) * D.DAYS_PER_YEAR, mother: f.id, father: m.id });
      f.kids++; m.kids++; bio(k, 0, L('kam als Kind auf die Insel', 'came to the island as a child'));
    }
  }
  for (const p of st.people) if (p.s === s.id) { if (!p.bio.length) bio(p, 0, text); p.fame = 1; }
  for (let k = 0; k < 3; k++) {
    const site = findSite(st, s, 'haus');
    if (site) addBuilding(st, s, 'haus', site[0], site[1], true);
  }
  return s;
}

export function createWorld(seed) {
  const W = generateWorld(seed);
  const st = {
    v: D.WORLD_VERSION, seed: W.seed, rng: Math.imul(W.seed, 2654435761) >>> 0, day: 0, acc: 0, savedAt: 0,
    nextId: 1, tiles: { h: W.h, tree: W.tree, fert: W.fert, ore: W.ore, road: W.road, burn: W.burn, ruin: W.ruin, bio: W.bio, river: W.river, seen: W.seen, reg: W.reg },
    isles: W.isles, voyages: [], trade: [], regions: W.regions, volc: W.extra.volcanoes, lakes: W.extra.lakes, rivers: W.extra.rivers, grown: 1,
    people: [], buildings: [], settlements: [], era: 0,
    weather: { kind: 'klar', until: 0, god: null, moist: 0.55, temp: 14 },
    effects: [], mana: 100, prayers: [], chronicle: [], myths: [], ancestors: [], stats: [], sites: [], godLog: [],
    flags: {}, lastGod: 0, counts: { births: 0, deaths: 0, powers: 0, answered: 0 },
  };
  hydrate(st);
  const r = rng(st);
  // Hauptinsel: zwölf Schiffbrüchige
  const langs = r.shuffle([0, 1, 2, 3]);
  const main = st.isles[0];
  const s = landPeople(st, main.id, 12, langs[0], L('strandet mit den Ersten auf der Insel', 'is stranded on the island with the first arrivals'));
  // Auf ein bis zwei anderen Inseln leben schon andere Menschen, die nichts voneinander wissen
  const others = st.isles.slice(1).filter(I => I.area >= 260 && !I.nw).slice(0, r.chance(0.5) ? 2 : 1);
  const natives = [];
  others.forEach((I, k) => {
    const o = landPeople(st, I.id, r.int(9, 11), langs[1 + k], L('wurde auf dieser Insel geboren', 'was born on this island'));
    if (o) natives.push([o, I]);
  });
  indexMembers(st);
  for (const o of st.settlements) chooseLeader(st, o, true);
  chron(st, 'gott', L(`Ein Boot zerschellt an den Felsen. Zwölf Menschen kriechen an Land und entzünden ein Licht der Hoffnung. Sie nennen ihren Ort ${s.name}.`, `A boat shatters on the rocks. Twelve people crawl ashore and kindle a light of hope. They name their home ${s.name}.`), s.id, 2);
  for (const [o, I] of natives) chron(st, 'gott', L(`Weit draußen, auf der Insel ${I.name}, leben andere Menschen in ${o.name}. Sie sprechen eine andere Sprache und ahnen nichts von den Fremden.`, `Far away, on the island of ${I.name}, other people live in ${o.name}. They speak a different language and know nothing of the strangers.`), o.id, 1);
  chron(st, 'gott', characterLine(st.char), -1, 1);
  chron(st, 'gott', L('Niemand weiß, dass jemand zusieht.', 'Nobody knows that someone is watching.'), -1, 1);
  for (const I of st.isles) I.research.cur = 'feuer';
  setTerritory(st);
  manaStep(st);
  st.mana = 100;
  initMoney(st); initSocial(st); moneyIndex(st, true); initDiaries(st); initSites(st);
  st.exploreV = 0; initExplore(st); // jetzt, wo die ersten Menschen da sind: ihre Umgebung ist bekannt
  return st;
}

// ---------- Speichern ----------

// Die Erde (st.earth) speichert nur, was von den Erddaten abweicht, und ohne die Listen aus den Erddaten (folks.js)
export function serialize(st) {
  st.rng = st._rt.rng.s;
  const { _rt, tiles, ...rest } = st;
  if (st.earth) return JSON.stringify({ ...earthSaveExtras({ ...rest }), tiles: encodeEarthTiles(st) });
  const t = {};
  for (const [k, v] of Object.entries(tiles)) t[k] = encode(v);
  return JSON.stringify({ ...rest, tiles: t });
}

// Erdstände brauchen vorher die Erddaten (earth.js loadEarth)
export function deserialize(json) {
  const o = typeof json === 'string' ? JSON.parse(json) : json;
  if ((o.v || 1) < D.WORLD_VERSION) throw new Error('alte Welt');
  if (o.earth) { o.tiles = decodeEarthTiles(o); return hydrate(o); }
  setWorldSize(D.MAP, D.MAP);
  const t = {};
  for (const [k, v] of Object.entries(o.tiles)) t[k] = decode(v, k === 'h' ? Int8Array : Uint8Array);
  const n0 = Math.round(Math.sqrt(t.h.length));
  o.tiles = n0 === NX ? t : growOldWorld(o, t, n0);
  return hydrate(o);
}

// Spielstand aus der Zeit vor der neuen Welt (bis 18.10.2026): Archipel bleibt, wie er ist, rundherum wächst die neue Welt
function growOldWorld(o, t, n0) {
  const T = embedTiles(t, n0);
  for (const k of ['bio', 'river', 'seen', 'reg']) if (!T[k]) T[k] = new Uint8Array(NX * NY);
  const taken = new Set([...o.isles.map(I => I.name), ...o.settlements.map(s => s.name)]);
  const extra = growWorld(T, o.isles, o.seed, taken);
  o.regions = findRegions(T);
  o.volc = extra.volcanoes; o.lakes = extra.lakes; o.rivers = extra.rivers;
  for (const k of o.links || []) if (k.path) k.path = k.path.map(i => ((i / n0) | 0) * NX + (i % n0));
  o.grown = o.day || 1;
  o.chronicle = o.chronicle || [];
  o.chronicle.push({ d: o.day, k: 'gott', s: -1, imp: 2, t: L('Weit im Osten und Süden liegt eine neue Welt: ein Festland ohne Ende, Wüsten, Wälder, Eis und Feuerberge. Noch weiß kein Mensch davon.', 'Far to the east and south lies a new world: an endless mainland of deserts, forests, ice and fire mountains. No one knows of it yet.') });
  return T;
}

// ---------- Tageslauf ----------

export function indexMembers(st) {
  const rt = st._rt;
  rt.bySet = new Map();
  for (const s of st.settlements) if (s.alive) rt.bySet.set(s.id, { all: [], adults: [], kids: [], old: [] });
  for (const p of st.people) {
    const m = rt.bySet.get(p.s);
    if (!m) continue;
    const a = ageOf(st, p);
    m.all.push(p);
    if (a < 14) m.kids.push(p); else if (a >= 64) m.old.push(p); else m.adults.push(p);
  }
  for (const s of st.settlements) if (s.alive) {
    const m = rt.bySet.get(s.id);
    s.pop = m.all.length; s.peak = Math.max(s.peak, s.pop);
    s.R = settlementRadius(s.pop);
    const I = rt.iById.get(s.isle);
    s.era = I ? I.era : 0;
  }
}

export function stepDay(st) {
  st.day++;
  const rt = st._rt;
  rt.newChronDay = rt.newChron.length;
  const season = seasonOf(st.day);
  indexMembers(st);
  weatherStep(st, season);
  effectsStep(st);
  if (st.day % 2 === 0) natureStep(st, season);
  for (const s of st.settlements) if (s.alive) economy(st, s, season);
  moneyIndex(st);
  for (const s of st.settlements) if (s.alive) moneyDay(st, s, season);
  societyStep(st, season, indexMembers); // Seuchen, Glaube, Wanderung, Viertel, Labor (vor peopleStep: Tote durch p.dzDie)
  peopleStep(st, season);
  compactPeople(st);
  indexMembers(st);
  if (st.day % 3 === 0) for (const s of st.settlements) if (s.alive) { housing(st, s); jobs(st, s); }
  for (const s of st.settlements) if (s.alive) construction(st, s);
  if (st.day % 2 === 0) for (const s of st.settlements) if (s.alive) planner(st, s);
  researchStep(st);
  if (st.day % 6 === 0) { politicsStep(st); statesStep(st); } // Staaten jährlich, Hauptstädte alle 6 Tage (states.js)
  if (st.day % 6 === 3) { relationsStep(st); diplomacyStep(st); }
  militaryStep(st); // Minister, Mauern, Heere, Schlachten, Belagerungen (seit 24.10.2026)
  if (st.day % 6 === 1) sitesStep(st);
  if (st.day % 6 === 5) piratesStep(st, foundSettlement);
  if (st.day % 4 === 1) prayersStep(st);
  if (st.day % 12 === 5) foundingStep(st);
  if (st.day % 12 === 9) schismStep(st);
  if (st.day % D.DAYS_PER_YEAR === 13) unionStep(st);
  seaStep(st);
  exploreStep(st);
  if (st.day % 6 === 2) tradeStep(st);
  if (st.day % 6 === 4) moneyWeek(st);
  if (st.day % 2 === 1) wildlifeStep(st, season);
  eventsStep(st, season);
  if (st.flags.exp && st.flags.exp.length) expeditionsStep(st);
  if (st.day % 3 === 0) roads(st);
  if (st.day % 6 === 5) roadNetStep(st);
  manaStep(st);
  if (st.day % D.DAYS_PER_YEAR === 0) { yearStep(st); moneyYear(st); socialYear(st); if (st.earth) { folkSplitStep(st); folkReviveStep(st); pruneDead(st); } }
  compactPeople(st);
  diaryStep(st);
  heroStep(st);
  if (rt.dirtyB || st.day % 6 === 0) { setTerritory(st); rt.dirtyB = false; rt.dirtyT = true; }
}

// ---------- Wetter ----------

const WX = [
  { klar: 0.42, wolkig: 0.26, regen: 0.26, nebel: 0.06 },
  { klar: 0.66, wolkig: 0.16, regen: 0.13, sturm: 0.05 },
  { klar: 0.3, wolkig: 0.3, regen: 0.3, sturm: 0.05, nebel: 0.05 },
  { klar: 0.3, wolkig: 0.28, schnee: 0.32, nebel: 0.1 },
];

function weatherStep(st, season) {
  const w = st.weather, r = rng(st);
  if (w.god && st.day < w.until) {
    // Göttliches Wetter hält an
  } else {
    w.god = null;
    if (!r.chance(0.45) || (w.kind === 'sturm') || (season !== 3 && w.kind === 'schnee')) {
      const table = WX[season];
      w.kind = r.weighted(Object.keys(table), k => table[k]);
    }
  }
  const dm = { klar: w.god === 'sonne' ? -0.11 : season === 1 ? -0.05 : -0.03, wolkig: -0.01, regen: 0.12, sturm: 0.15, schnee: 0.04, nebel: 0.01 }[w.kind] || 0;
  w.moist = clamp(w.moist + dm, 0, 1);
  const base = [13, 24, 12, 0][season];
  w.temp = base + (w.kind === 'klar' ? 3 : w.kind === 'schnee' ? -4 : w.kind === 'sturm' ? -3 : 0) + (w.god === 'sonne' ? 7 : 0) + r.gauss() * 2;
  if (w.moist < 0.12 && season < 3 && !st.flags.droughtSaid) {
    st.flags.droughtSaid = st.day;
    chron(st, 'natur', L('Seit Wochen kein Regen. Die Erde reißt auf, die Brunnen werden flach.', 'No rain for weeks. The earth cracks open, the wells run shallow.'), -1, 1);
  }
  if (w.moist > 0.45) st.flags.droughtSaid = 0;
}

function effectsStep(st) {
  const before = st.effects.length;
  for (const e of st.effects) {
    if (e.k === 'vulkan' && st.day < e.until) {
      // Lava frisst weiter, langsam
      lavaDamage(st, e, 0.25);
    }
    if (e.k === 'vulkan' && st.day >= e.until && !e.done) {
      e.done = true;
      const T = st.tiles;
      for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
        const x = e.x + dx, y = e.y + dy; if (!inb(x, y)) continue;
        const i = idx(x, y);
        const hb = (st._rt.hb || T.h)[i];
        if (hb >= 1 && hb <= 2 && Math.hypot(dx, dy) <= 8) T.fert[i] = Math.min(100, T.fert[i] + 25);
      }
      st.sites.push({ k: 'asche', x: e.x, y: e.y, d: st.day });
      chron(st, 'natur', L('Der Berg schläft wieder. Auf der Asche wächst das Grün schneller als je zuvor.', 'The mountain sleeps again. On the ash, green grows faster than ever before.'), -1, 1);
    }
  }
  st.effects = st.effects.filter(e => st.day < e.until || (e.k === 'vulkan' && !e.done));
  if (before !== st.effects.length) st._rt.dirtyT = true;
}

export function lavaDamage(st, e, strength) {
  const rt = st._rt, T = st.tiles, r = rng(st);
  rt.fire = 1; // natureStep sucht wieder nach Feuer
  for (let dy = -e.r; dy <= e.r; dy++) for (let dx = -e.r; dx <= e.r; dx++) {
    const x = e.x + dx, y = e.y + dy; if (!inb(x, y)) continue;
    const d = Math.hypot(dx, dy); if (d > e.r) continue;
    const i = idx(x, y);
    if (T.tree[i] && r.chance(strength * (1 - d / e.r))) T.burn[i] = Math.max(T.burn[i], 3);
    const bid = rt.bldAt[i];
    if (bid) { const b = rt.bById.get(bid); if (b) b.hp -= strength * (1.2 - d / e.r); }
  }
}

// ---------- Natur ----------

// Baumwuchs: gleich dicht wie auf dem alten 160er Raster; in Wüste, Eis, Salz und Schluchten wächst nichts nach
const treeTries = () => Math.round(260 * NX * NY / (160 * 160));
const TREE_MAX = D.BIOMES.map(b => ({ wueste: 0, eis: 0, salz: 0, canyon: 0, tundra: 1, steppe: 1, savanne: 1, vulkan: 1 })[b.key] ?? 3);

function natureStep(st, season) {
  const T = st.tiles, rt = st._rt, r = rng(st), w = st.weather;
  // Bäume wachsen nach
  const blessed = st.effects.filter(e => e.k === 'segen');
  // In der Erde wächst der Wald dort nach, wo Menschen ihn nutzen (um die Orte), sonst gleichmäßig über die Welt
  const near = st.earth ? st.settlements.filter(s => s.alive) : null;
  const tries = near ? near.length * 60 : treeTries();
  for (let k = 0; k < tries; k++) {
    let i;
    if (near) {
      const s = near[k % near.length], a = r.next() * Math.PI * 2, d = s.R + r.next() * 30;
      const x0 = Math.round(s.cx + Math.cos(a) * d), y0 = Math.round(s.cy + Math.sin(a) * d);
      if (!inb(x0, y0)) continue;
      i = idx(x0, y0);
    } else i = r.int(0, NX * NY - 1);
    const h = (rt.hb || T.h)[i];
    if (h < 1 || h > 3 || rt.bldAt[i] || T.burn[i] || T.tree[i] >= TREE_MAX[T.bio[i]] || T.river[i]) continue;
    const x = i % NX, y = (i / NX) | 0;
    let nb = 0;
    for (const [dx, dy] of D4) if (inb(x + dx, y + dy) && T.tree[idx(x + dx, y + dy)]) nb++;
    let p = nb ? 0.1 + nb * 0.04 : 0.006;
    if (T.road[i] > 30) p *= 0.1;
    if (h === 3) p *= 0.4;
    if (season === 3) p *= 0.3;
    if (rt.owner[i]) { const so = rt.sById.get(rt.owner[i]); if (so && so.alive && Math.hypot(so.cx - x, so.cy - y) < so.R * 0.9) continue; p *= 0.3; } // Siedler halten ihr Land frei
    for (const e of blessed) if (Math.hypot(e.x - x, e.y - y) < e.r) p *= 4;
    if (r.chance(p)) T.tree[i]++;
  }
  // Die Menschen roden ihr Land
  for (const s of st.settlements) {
    if (!s.alive) continue;
    for (let k = 0; k < 3; k++) {
      const a = r.next() * Math.PI * 2, d = r.next() * s.R * 0.85;
      const x = Math.round(s.cx + Math.cos(a) * d), y = Math.round(s.cy + Math.sin(a) * d);
      if (!inb(x, y)) continue;
      const i = idx(x, y);
      if (T.tree[i]) { T.tree[i]--; s.stock.wood += 1; rt.dirtyT = true; }
    }
  }
  // Feuer
  const rain = w.kind === 'regen' || w.kind === 'sturm' || w.kind === 'schnee';
  const spread = rain ? 0.04 : w.moist < 0.2 ? 0.3 : 0.16;
  const burning = [];
  // Feuer entsteht nur über fireAt (util.js) oder breitet sich aus: ohne beides bleibt die Suche aus
  if (rt.fire !== 0) eachSet(T.burn, i => burning.push(i));
  let spreadAny = false;
  for (const i of burning) {
    T.burn[i] = Math.max(0, T.burn[i] - (rain ? 2 : 1));
    const x = i % NX, y = (i / NX) | 0;
    const bid = rt.bldAt[i];
    if (bid) { const b = rt.bById.get(bid); if (b) b.hp -= 0.3; }
    if (T.tree[i] && r.chance(0.4)) T.tree[i]--;
    if (!T.burn[i]) { T.fert[i] = Math.min(100, T.fert[i] + 6); continue; }
    for (const [dx, dy] of D8) {
      const xx = x + dx, yy = y + dy; if (!inb(xx, yy)) continue;
      const j = idx(xx, yy);
      if (T.burn[j]) continue;
      const fuel = T.tree[j] ? 1 : rt.bldAt[j] ? (st.era <= 3 ? 0.7 : 0.25) : 0;
      if (fuel && r.chance(spread * fuel)) { T.burn[j] = r.int(2, 4); spreadAny = true; }
    }
  }
  if (burning.length) rt.dirtyT = true;
  rt.fire = spreadAny || burning.some(i => T.burn[i]) ? 1 : 0;
  // Ruinen verwittern (Liste der Ruinenfelder statt Suche über alle Felder, Reihenfolge egal)
  if (!rt.ruins) { rt.ruins = new Set(); eachSet(T.ruin, i => rt.ruins.add(i)); }
  for (const i of rt.ruins) { if (T.ruin[i]) T.ruin[i]--; if (!T.ruin[i]) rt.ruins.delete(i); }
  // Verlassene Orte verfallen, zerstörte Gebäude werden geräumt
  for (const b of st.buildings) { const s = rt.sById.get(b.s); if (!s || !s.alive) b.hp -= 0.02; }
  for (const b of st.buildings.slice()) if (b.hp <= 0) { if (b.t === 'zentrum' && !(rt.sById.get(b.s) || {}).alive) removeBuilding(st, b, true); else destroyBuilding(st, b); }
}

export function destroyBuilding(st, b, why) {
  const rt = st._rt;
  const s = rt.sById.get(b.s);
  const def = D.BUILDINGS[b.t];
  if (b.t === 'zentrum') { b.hp = 0.3; b.prog = Math.min(b.prog, 0.3); return; }
  if (def.unique && b.prog >= 1 && s) chron(st, 'natur', L(`${def.name} von ${s.name} liegt in Trümmern${why ? ' ' + why : ''}.`, `The ${def.name.toLowerCase()} of ${s.name} lies in ruins${why ? ' ' + why : ''}.`), s.id, 1);
  rt.dirtyB = true;
  removeBuilding(st, b, true);
}

// ---------- Wirtschaft ----------

function buildingFactor(st, b, s) {
  const T = st.tiles, i = idx(b.x, b.y);
  switch (b.t) {
    case 'feld': {
      let f = T.fert[i] / 70;
      for (const e of st.effects) if (e.k === 'segen' && Math.hypot(e.x - b.x, e.y - b.y) <= e.r) f *= 1.6;
      if (s.has.muehle || s.millCount) f *= 1 + Math.min(0.3, (s.millCount || 0) * 0.12);
      return f;
    }
    case 'holz': {
      let t = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (inb(b.x + dx, b.y + dy)) t += T.tree[idx(b.x + dx, b.y + dy)];
      return clamp(t / 14, 0.15, 1.3);
    }
    case 'fischer': case 'leuchtturm': {
      let f = 1;
      for (const e of st.effects) if (e.k === 'fische' && Math.hypot(e.x - b.x, e.y - b.y) <= e.r) f *= 2.6;
      return f;
    }
    case 'mine': {
      let o = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inb(b.x + dx, b.y + dy)) o += T.ore[idx(b.x + dx, b.y + dy)];
      return o > 0 ? 1 : 0.1;
    }
    default: return 1;
  }
}

// Wirkung aller fertigen Gebäude einer Siedlung zusammenzählen (data.js bon)
function bonuses(st, s) {
  const o = {};
  for (const b of st.buildings) {
    if (b.s !== s.id || b.prog < 1) continue;
    const B = D.BUILDINGS[b.t].bon;
    if (B) for (const k in B) o[k] = (o[k] || 0) + B[k];
  }
  // Fundorte in der Nähe (heiße Quelle, uralter Baum, sites.js)
  if (s.siteBon) for (const k in s.siteBon) o[k] = (o[k] || 0) + s.siteBon[k];
  return o;
}

function economy(st, s, season) {
  const M = members(st, s), w = st.weather, rt = st._rt, T = st.tiles;
  const pop = M.all.length;
  if (!pop) return;
  let farmW = [0.9, 1.5, 2.5, 0.12][season];
  let fishW = 1, gatherW = season === 3 ? 0.55 : 1;
  if (w.kind === 'regen') { farmW *= w.moist < 0.85 ? 1.15 : 0.85; fishW *= 0.8; }
  if (w.kind === 'sturm') { farmW *= 0.7; fishW *= 0.15; gatherW *= 0.6; }
  if (w.kind === 'schnee') { farmW *= 0.12; fishW *= 0.7; gatherW *= 0.5; }
  if (w.kind === 'nebel') fishW *= 0.7;
  if (w.god === 'sonne') farmW *= season === 3 ? 2 : 1.2;
  if (w.moist < 0.2) farmW *= 0.45 + w.moist * 2;
  if (knows(st, 'kalender', s)) farmW *= 1.1;
  if (knows(st, 'viehzucht', s)) farmW *= 1.12;
  // Lebensraum: Wüste und Tundra geben wenig, Regenwald und Oasen viel (seit 18.10.2026)
  const B = D.BIOMES[T.bio[idx(s.cx, s.cy)]] || D.BIOMES[0];
  farmW *= B.food; gatherW *= B.food;
  const P = pe(st, s.isle); // Fortschritt (progress.js): Nahrung, Arbeit, Wissen
  farmW *= 1 + P.food; fishW *= 1 + P.food * 0.5;
  const adultsN = M.adults.length || 1;
  let tf = 1 + Math.min(0.6, s.stock.tools / adultsN * 0.5);
  if (knows(st, 'eisen', s)) tf *= 1.15;
  if (knows(st, 'dampf', s)) tf *= 1.15;
  if (s.has.kraftwerk) tf *= 1.25;
  const SB = rt.sb && rt.sb.get(s.id); // Kabinett und Konjunktur des Staates (states.js)
  tf *= (1 + P.work) * (1 + (SB ? SB.work : 0));
  const lawMul = s.laws.includes('ruhetag') ? 0.95 : 1;
  const mul = tf * lawMul * (0.75 + 0.5 * s.hap);
  // Waldbestand für Sammler und Jäger (alle 6 Tage neu gezählt)
  if (st.day - s.cache.at >= 6) {
    let f = 0;
    const R = s.R + 4;
    for (let y = Math.max(0, Math.floor(s.cy - R)); y <= Math.min(NY - 1, s.cy + R); y++)
      for (let x = Math.max(0, Math.floor(s.cx - R)); x <= Math.min(NX - 1, s.cx + R); x++) f += T.tree[idx(x, y)] + (st.earth && T.river[idx(x, y)] ? 3 : 0); // Erde: Flusstäler voller Fisch und Wild (Nil, Indus)
    s.cache.forest = f; s.cache.at = st.day;
    s.millCount = bldOf(st, s).filter(b => b.t === 'muehle' && b.prog >= 1).length;
    for (const b of bldOf(st, s)) if (b.prog >= 1) b.f = buildingFactor(st, b, s);
    s.bon = bonuses(st, s);
  }
  const counts = {};
  for (const p of M.adults) counts[p.job] = (counts[p.job] || 0) + 1;
  const gatherDens = clamp(1.35 - (counts.sammler || 0) / (10 + s.cache.forest / 14), 0.35, 1.15);
  const huntDens = clamp(1.3 - (counts.jaeger || 0) / (4 + s.cache.forest / 30), 0.3, 1.1);
  let food = 0, wood = 0, stone = 0, ore = 0, tools = 0, goods = 0, gold = 0, know = 0;
  const eraBase = s.era <= 1 ? 0.14 : s.era <= 3 ? 0.05 : 0.02;
  const schoolMul = 1 + (knows(st, 'universitaet', s) ? 0.3 : 0) + (knows(st, 'buchdruck', s) ? 0.4 : 0) + (knows(st, 'strom', s) ? 0.2 : 0) + (knows(st, 'elektronik', s) ? 0.3 : 0);
  // Geld: was jeder einzelne erzeugt (netto), bewertet später money.js zu Marktpreisen
  if (!rt.val || rt.valDay !== st.day) { rt.val = new Map(); rt.valDay = st.day; }
  const strike = s.strike && s.strike.until > st.day ? s.strike.t : null;
  for (const p of M.adults) {
    know += eraBase + p.tr.neugier * (s.era <= 1 ? 0.08 : 0.05);
    if (p.sick) continue;
    const b = p.w > 0 ? rt.bById.get(p.w) : null;
    if (strike && b && b.t === strike) continue; // Streik: die Werkbank steht still
    const bf = b ? (b.f ?? 1) * (b.prog >= 1 ? 1 : 0) : 1;
    // Fleiß, Berufserfahrung und Schulbildung
    const xp = Math.min(0.18, Math.max(0, st.day - (p.jy ?? st.day)) / D.DAYS_PER_YEAR * 0.012);
    const f = (0.7 + p.tr.fleiss * 0.6) * (1 + xp + (p.edu || 0) * 0.12);
    const v0 = [food, wood, stone, ore, tools, goods];
    switch (p.job) {
      case 'sammler': food += 1.25 * gatherW * gatherDens * f; wood += 0.22; stone += knows(st, 'werkzeug', s) ? 0.04 : 0.015; break;
      case 'jaeger': food += 1.55 * gatherW * huntDens * f; break;
      case 'bauer': food += (b && b.t === 'muehle' ? 1.0 : 1.4) * farmW * bf * f; break;
      case 'fischer': food += 2.0 * fishW * bf * f; break;
      case 'holzfaeller': wood += 1.6 * bf * f; break;
      case 'steinmetz': stone += 1.25 * f; break;
      case 'bergmann': ore += 0.8 * bf * f; break;
      case 'handwerker':
        if (s.stock.wood > 3) { wood -= 0.5; tools += 0.45 * f; goods += (s.era >= 2 ? 0.3 : 0.1) * f; }
        if (s.stock.ore > 1 && knows(st, 'bronze', s)) { ore -= 0.12; tools += 0.2; }
        break;
      case 'arbeiter': if (s.stock.ore > 0.5 || s.stock.wood > 2) { goods += 2.4 * f; ore -= 0.25; wood -= 0.4; } break;
      case 'haendler': goods += 0.1; break;
      case 'gelehrter': know += 0.8 * schoolMul * (0.8 + p.tr.neugier * 0.5); break;
      case 'priester': know += 0.12; break;
      case 'kuenstler': know += 0.1; break;
      default: break;
    }
    rt.val.set(p.id, [food - v0[0], wood - v0[1], stone - v0[2], ore - v0[3], tools - v0[4], goods - v0[5]]);
  }
  for (const p of M.old) know += 0.1 + p.tr.neugier * 0.05;
  // Wissen wandert in den gemeinsamen Topf der Insel
  let km = 0.6 + s.cult.wissen * 0.8;
  if (s.laws.includes('schulpflicht')) km *= 1.2;
  if (s.laws.includes('freiedenker')) km *= 1.15;
  if (s.laws.includes('sternenverbot')) km *= 0.75;
  if (s.has.sternwarte) km *= 1.15;
  const BON = s.bon || {};
  if (BON.know) km *= 1 + BON.know;
  if (knows(st, 'zeitung', s)) km *= 1.1;
  km *= (1 + P.know) * (1 + (SB ? SB.know : 0));
  const isle = isleOf(st, s);
  if (isle) isle.research.pts += know * km;
  // Wirkung der neuen Gebäude: mehr Nahrung, Werkzeug und Waren
  if (BON.food) food *= 1 + BON.food;
  if (BON.tools) { tools += BON.tools * (s.stock.ore > 1 || s.stock.wood > 4 ? 1 : 0.4); }
  if (BON.goods && s.era >= 1) goods += BON.goods;
  s.prod = { food: food * mul, know: know * km };
  s.prodMul = mul;
  // Edelmetall aus den Minen: neues Geld für den Besitzer (oder die Stadt)
  if (ore > 0 && s.era >= 2 && s.fin) {
    const coins = ore * mul * 0.06 * (knows(st, 'geldwesen', s) ? 1.3 : 1);
    const mine = bldOf(st, s).find(b => b.t === 'mine' && b.own);
    const o = mine && rt.pById.get(mine.own);
    if (o) o.gold = (o.gold || 0) + coins; else s.stock.gold += coins;
    s.fin.mint += coins;
  }
  s.stock.food += food * mul;
  s.stock.wood = Math.max(0, s.stock.wood + wood * mul);
  s.stock.stone += stone * mul;
  s.stock.ore = Math.max(0, s.stock.ore + ore * mul);
  s.stock.tools += tools;
  s.stock.goods = Math.max(0, s.stock.goods + goods * mul);
  s.stock.gold += gold;
  // Bäume fallen für Holz, Erz wird weniger
  if (wood > 0 && st.day % 4 === 0) chopTrees(st, s, Math.round(wood * mul / 3));
  if (ore > 0 && st.day % 6 === 0) for (const b of bldOf(st, s)) if (b.t === 'mine') drainOre(st, b);
  // Essen
  const fireMul = knows(st, 'feuer', s) ? 0.92 : 1;
  const need = (M.adults.length + M.kids.length * 0.6 + M.old.length * 0.8) * fireMul;
  s.prod.need = need;
  if (s.laws.includes('opfergaben')) s.stock.food -= need * 0.03;
  if (s.stock.food >= need) { s.stock.food -= need; s.hunger = Math.max(0, s.hunger - 0.2); }
  else { s.hunger = clamp(1 - s.stock.food / need, 0, 1); s.stock.food = 0; }
  const spoil = (knows(st, 'toepferei', s) ? 0.003 : 0.008) * (season === 1 ? 1.5 : season === 3 ? 0.5 : 1) * (1 - Math.min(0.5, (s.bon && s.bon.spoil) || 0));
  const speicher = bldOf(st, s).filter(b => b.t === 'speicher' && b.prog >= 1).length;
  const cap = 90 + 160 * speicher + 10 * pop;
  s.cap = cap;
  s.stock.food = Math.min(cap, s.stock.food * (1 - spoil));
  const mcap = 200 + 120 * speicher + 2 * pop;
  s.stock.wood = Math.min(mcap, s.stock.wood);
  s.stock.stone = Math.min(mcap, s.stock.stone);
  s.stock.ore = Math.min(mcap, s.stock.ore);
  s.stock.tools *= 0.997;
  if (s.era >= 2) s.stock.goods = Math.max(0, s.stock.goods - pop * 0.006);
}

function chopTrees(st, s, n) {
  const T = st.tiles, r = rng(st);
  const camps = bldOf(st, s).filter(b => b.t === 'holz');
  for (let k = 0; k < n; k++) {
    const c = camps.length ? r.pick(camps) : { x: s.cx, y: s.cy };
    for (let t = 0; t < 8; t++) {
      const x = c.x + r.int(-4, 4), y = c.y + r.int(-4, 4);
      if (inb(x, y) && T.tree[idx(x, y)]) { T.tree[idx(x, y)]--; st._rt.dirtyT = true; break; }
    }
  }
}

function drainOre(st, b) {
  const T = st.tiles;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = b.x + dx, y = b.y + dy;
    if (inb(x, y) && T.ore[idx(x, y)]) { T.ore[idx(x, y)] = Math.max(0, T.ore[idx(x, y)] - 2); return; }
  }
}

// ---------- Menschen ----------

const ERA_FERT = [1, 1, 1, 0.95, 0.88, 0.75, 0.62, 0.56];



function mortality(st, a, s) { return mortalityK(a, mortMul(st, s)); }
// Wissen einer Siedlung als Faktoren für Kinder und Erwachsene (einmal je Siedlung statt je Mensch, gleiche Rechnung)
function mortMul(st, s) {
  const out = [1, 1];
  for (let k = 0; k < 2; k++) {
    const kid = k === 0;
    let mul = 1;
    if (!knows(st, 'feuer', s)) mul *= 1.25;
    if (knows(st, 'medizin', s)) mul *= kid ? 0.6 : 0.8;
    if (knows(st, 'impfung', s)) mul *= kid ? 0.4 : 0.8;
    if (knows(st, 'strom', s)) mul *= 0.9;
    if (knows(st, 'elektronik', s)) mul *= 0.85;
    out[k] = mul;
  }
  return out;
}
function mortalityK(a, mk) {
  let m;
  if (a < 1) m = 0.07; else if (a < 5) m = 0.022; else if (a < 15) m = 0.005; else m = 0.002 + 0.00035 * Math.exp(0.088 * a);
  return m * mk[a < 15 ? 0 : 1];
}

function peopleStep(st, season) {
  const r = rng(st), rt = st._rt, w = st.weather;
  const winter = season === 3 || w.kind === 'schnee';
  const silence = st.day - st.lastGod > 96;
  const SKEPTIC = [0, 0, 0.02, 0.05, 0.07, 0.11, 0.17, 0.23];
  // Tragfähigkeit der Welt: in Inselwelten alle Menschen zusammen (ab 850 weniger Kinder), in der Erde je Volk
  // (das Volk des Spielers bis 560, jedes andere bis 180, sonst wird die Erde zu voll und das Nachholen zu langsam)
  let folkPop = null;
  if (st.earth) { folkPop = new Map(); for (const s of st.settlements) if (s.alive) folkPop.set(s.isle, (folkPop.get(s.isle) || 0) + members(st, s).all.length); }
  for (const s of st.settlements) {
    if (!s.alive) continue;
    const M = members(st, s);
    if (!M.all.length) continue;
    const eraSkeptic = SKEPTIC[s.era];
    let priests = 0, healers = 0, artists = 0, warriors = 0, temples = 0, wells = 0, theaters = 0, factories = 0;
    for (const p of M.adults) { if (p.job === 'priester') priests++; else if (p.job === 'heiler') healers++; else if (p.job === 'kuenstler') artists++; else if (p.job === 'krieger') warriors++; }
    for (const b of bldOf(st, s)) if (b.prog >= 1) {
      if (b.t === 'schrein' || b.t === 'monument') temples++;
      else if (b.t === 'brunnen') wells++;
      else if (b.t === 'theater') theaters++;
      else if (b.t === 'fabrik') factories++;
    }
    s.counts = { priests, healers, artists, warriors, temples, wells, theaters, factories };
    const pop = M.all.length;
    const freeHome = (s.homeCap || 0) - (s.housed || 0);
    const faithT = clamp(0.3 + ((st.char && st.char.piety) || 1) * 0.15 - 0.15 + s.cult.glaube * 0.5 + priests / pop * 1.4 + Math.min(0.1, temples * 0.03) + Math.min(0.12, (s.bon && s.bon.faith) || 0) + (st.day < s.blessed ? 0.08 : 0) - eraSkeptic - (silence ? 0.08 : 0), 0, 1);
    let mood = 0.4 + (s.hunger > 0.05 ? -0.4 * s.hunger : 0.06) - s.era * 0.012 - s.cult.handel * 0.05;
    const BON = s.bon || {};
    mood += Math.min(0.12, BON.hap || 0);
    if (pop > 120) mood -= Math.min(0.12, (pop - 120) / 900);
    if ((s.homeCap || 0) < pop) mood -= Math.min(0.1, (pop - (s.homeCap || 0)) / pop * 0.3);
    if (w.kind === 'regen') mood -= 0.02; if (w.kind === 'sturm') mood -= 0.08; if (w.kind === 'klar') mood += 0.03;
    mood += Math.min(0.1, theaters * 0.04 + artists / pop * 0.6);
    if (s.laws.includes('ruhetag')) mood += 0.06;
    if (s.laws.includes('wehrpflicht')) mood -= 0.05;
    if (s.laws.includes('ausgangssperre')) mood -= 0.06;
    if (s.laws.includes('gemeinschaft')) mood += 0.03;
    if (s.war) mood -= 0.1;
    if (st.day < s.blessed) mood += 0.05;
    mood += clamp(s.stock.gold / pop * 0.01, -0.04, 0.06);
    if (s.era >= 2) mood += s.stock.goods > pop * 0.05 ? 0.03 : -0.02;
    mood -= factories * 0.015;
    mood -= s.unrest * 0.08;
    const leader = s.gov.leader ? rt.pById.get(s.gov.leader) : null;
    if (leader) mood += (leader.tr.charisma - 0.5) * 0.08;
    const healMul = 1 + healers * 0.06 + wells * 0.04 + (s.spring ? 0.15 : 0);
    // Tragfähigkeit: große Städte und eine volle Insel bekommen weniger Kinder
    const total = folkPop ? folkPop.get(s.isle) : st.people.length;
    // seit 24.10.2026 nach Entwicklung statt fest 850 Menschen und 520 je Ort (progress.js worldCap, townCap)
    const capW = folkPop ? (isleOf(st, s)?.player ? 560 : 180) * (1 + pe(st, s.isle).cap) : worldCap(st);
    const crowd = clamp(1.35 - pop / townCap(st, s), 0.3, 1) * (total > capW ? Math.pow(capW / total, 2) : 1);
    const healthP = (1 - pe(st, s.isle).health) * (1 - ((rt.sb && rt.sb.get(s.id)) || { health: 0 }).health);
    const mk = mortMul(st, s), fire = knows(st, 'feuer', s), medi = knows(st, 'medizin', s);
    let hapSum = 0, faithSum = 0;
    for (const p of M.all) {
      // Tod durch Seuche oder Verfolgung (epidemic.js, faith.js setzen p.dzDie mit der Ursache)
      if (p.dzDie) { const c = p.dzDie; p.dzDie = 0; die(st, s, p, c); continue; }
      const a = ageOf(st, p);
      // Gesundheit
      const housed = p.home > 0;
      let dh = 0.008 * healMul;
      if (s.hunger > 0.05) dh -= 0.035 * s.hunger * (s.laws.includes('gemeinschaft') ? 0.7 : 1);
      if (winter && !housed) dh -= 0.03;
      if (winter && !fire) dh -= 0.008;
      if (p.sick) { dh -= 0.02; p.sick--; }
      p.hp = clamp(p.hp + dh, 0, 1);
      // Tod
      let q = mortalityK(a, mk) / D.DAYS_PER_YEAR * (1 + (1 - p.hp) * 5) * (1 - Math.min(0.35, (s.bon && s.bon.health || 0) * 0.6)) * healthP;
      if (p.sick) q += 0.003 / healMul / (medi ? 2 : 1);
      if (p.poor > 14) q *= 1.25; // Armut kostet Lebensjahre
      if (s.hunger > 0.5) q += 0.004 * s.hunger * (a < 5 || a > 60 ? 2 : 1);
      if (r.chance(q)) { die(st, s, p, p.sick ? 'Fieber' : s.hunger > 0.5 ? 'Hunger' : a > 55 ? 'Alter' : p.hp < 0.4 ? 'Schwäche' : 'Unglück'); continue; }
      // Glaube und Glück
      p.faith = clamp(p.faith + (faithT + (p.tr.glaube - 0.5) * 0.3 - p.faith) * 0.012, 0, 1);
      let pm = mood + (housed ? 0.04 : -0.18) + (p.pa ? 0.05 : 0) + (p.kids ? 0.03 : 0) - (p.sick ? 0.22 : 0) + (0.5 - p.tr.wut) * 0.14;
      // Geld und Menschen: Armut, Schulden, Luxus, Freunde, Feinde, Ehe
      pm += (p.cls === 0 ? -0.02 : p.cls >= 3 ? 0.03 : p.cls === 2 ? 0.015 : 0) - (p.poor > 6 ? 0.05 : 0) - (p.bond ? 0.05 : p.debt > 0 ? 0.01 : 0) + (p.lux || 0) * 0.05 - (p.unpaid > 6 ? 0.04 : 0)
        + Math.min(0.06, (p.nf || 0) * 0.02) - Math.min(0.06, (p.ne || 0) * 0.025) + (p.pa ? clamp((p.ms ?? 0.6) - 0.5, -0.25, 0.2) * 0.15 : 0) - (p.wid && st.day - p.wid < D.DAYS_PER_YEAR ? 0.1 : 0);
      if (p.poor > 14) p.hp = clamp(p.hp - 0.002, 0, 1);
      if (winter && a < 14 && w.kind === 'schnee') pm += 0.08;
      p.hap = clamp(p.hap + (pm - p.hap) * 0.1, 0, 1);
      hapSum += p.hap; faithSum += p.faith;
      // Geburt
      if (p.sex === 'f' && a >= 16 && a <= 44 && p.pa && !p.sick) {
        const fa = rt.pById.get(p.pa);
        if (fa && fa.s === p.s && fa.sex === 'm') {
          const kidsF = p.kids < 3 ? 1 : p.kids < 5 ? 0.55 : 0.2;
          const q2 = 0.0145 * ((st.char && st.char.fert) || 1) * Math.pow(p.hap, 0.7) * (s.hunger > 0.2 ? 0.3 : 1) * (freeHome > 0 ? 1 : 0.4) * kidsF * ERA_FERT[s.era] * crowd;
          if (r.chance(q2)) birth(st, s, p, fa);
        }
      }
    }
    s.hap = hapSum / Math.max(1, M.all.length);
    s.faith = faithSum / Math.max(1, M.all.length);
  }
  if (st.day % 3 === 1) socialStep(st);
}

function die(st, s, p, cause) {
  const a = Math.floor(ageOf(st, p));
  st.counts.deaths++;
  killPerson(st, p, cause);
  const tt = p.lt || p.title;
  if (tt || p.fame >= 4) {
    // cause ist ein interner Code (Ahnenhalle und UI übersetzen ihn beim Anzeigen), deshalb nie übersetzen
    const what = cause === 'Alter' ? L(`stirbt mit ${a} Jahren`, `dies at the age of ${a}`) : cause === 'Fieber' ? L('erliegt dem Fieber', 'succumbs to fever') : cause === 'Hunger' ? L('verhungert im Elend', 'starves in misery') : L(`stirbt mit ${a} Jahren`, `dies at the age of ${a}`);
    chron(st, 'tod', L(`${tt ? tt + ' ' : ''}${p.n} aus ${s.name} ${what}.${p.dream ? ' Die Vision lebt in den Liedern weiter.' : ''}`, `${tt ? tt + ' ' : ''}${p.n} of ${s.name} ${what}.${p.dream ? ' The vision lives on in the songs.' : ''}`), s.id, p.lt ? 1 : 0);
  }
}

function birth(st, s, mo, fa) {
  const r = rng(st);
  // Heimliche Liebe hinterlässt Spuren: manchmal ist der wahre Vater ein anderer (nur der Gott weiß es)
  const lover = mo.aff && st._rt.pById.get(mo.aff);
  const official = fa;
  if (lover && lover.sex === 'm' && lover.s === mo.s && r.chance(0.3)) fa = lover;
  const k = makePerson(st, s, { b: st.day, mother: mo.id, father: fa.id });
  if (fa !== official) { k.ofa = official.id; official.kids++; }
  mo.kids++; fa.kids++;
  st.counts.births++;
  bio(k, st.day, L(`wird geboren, Kind von ${mo.n} und ${fa.n}`, `is born, child of ${mo.n} and ${fa.n}`));
  bio(mo, st.day, L(`bekommt ${k.n}`, `gives birth to ${k.n}`));
  if (st.counts.births === 1) chron(st, 'geburt', L(`In ${s.name} wird das erste Kind der Insel geboren: ${k.n}. Die Menschen tanzen um das Feuer.`, `In ${s.name} the first child of the island is born: ${k.n}. The people dance around the fire.`), s.id, 1);
  else if (mo.lt || fa.lt) chron(st, 'geburt', L(`${mo.lt ? mo.lt + ' ' + mo.n : fa.lt + ' ' + fa.n} hat ein Kind: ${k.n} erblickt das Licht in ${s.name}.`, `${mo.lt ? mo.lt + ' ' + mo.n : fa.lt + ' ' + fa.n} has a child: ${k.n} sees the light of day in ${s.name}.`), s.id, 0);
  if (k.tr.neugier > 0.93 && r.chance(0.5)) { k.fame += 1; k.genius = 1; }
  if (r.chance(0.012)) { // Zwillinge
    const z = makePerson(st, s, { b: st.day, mother: mo.id, father: fa.id, sex: k.sex });
    mo.kids++; fa.kids++; st.counts.births++;
    bio(z, st.day, L(`wird geboren, Zwilling von ${k.n}`, `is born, twin of ${k.n}`));
  }
}

// ---------- Wohnen und Arbeit ----------

function housing(st, s) {
  const rt = st._rt, M = members(st, s);
  const houses = bldOf(st, s).filter(b => D.BUILDINGS[b.t].home);
  const occ = new Map();
  let cap = 0;
  for (const h of houses) { occ.set(h.id, 0); cap += homeCap(st, h); }
  for (const p of M.all) {
    if (p.home > 0 && occ.has(p.home) && occ.get(p.home) < homeCap(st, rt.bById.get(p.home))) occ.set(p.home, occ.get(p.home) + 1);
    else p.home = -1;
  }
  const free = h => homeCap(st, h) - occ.get(h.id);
  const homeless = M.all.filter(p => p.home < 0);
  for (const p of homeless) {
    let cand = null;
    const pa = p.pa && rt.pById.get(p.pa), mo = p.mo && rt.pById.get(p.mo);
    for (const rel of [pa, mo]) {
      if (rel && rel.s === s.id && rel.home > 0) { const h = rt.bById.get(rel.home); if (h && free(h) > 0) { cand = h; break; } }
    }
    // Viertel (peoples.js pickHome): Nachbarn gleicher Herkunft, Nähe zur Arbeit, Reiche nah am Platz
    if (!cand && rt.pickHome) cand = rt.pickHome(st, s, p, houses, free);
    if (!cand) { let bf = 0; for (const h of houses) { const f = free(h); if (f > bf) { bf = f; cand = h; } } }
    if (cand) { p.home = cand.id; occ.set(cand.id, occ.get(cand.id) + 1); }
  }
  s.homeCap = cap;
  s.housed = M.all.filter(p => p.home > 0).length;
}

const SUIT = {
  priester: p => p.tr.glaube * 2 + p.faith,
  gelehrter: p => p.tr.neugier * 2,
  krieger: p => p.tr.mut + p.tr.wut + (p.sex === 'm' ? 0.2 : 0),
  haendler: p => p.tr.charisma * 1.5 + p.tr.neugier * 0.5,
  kuenstler: p => p.tr.kunst * 2,
  heiler: p => p.tr.neugier + p.tr.fleiss,
  baumeister: p => p.tr.fleiss * 1.5,
  handwerker: p => p.tr.fleiss + p.tr.kunst * 0.5,
};

function jobs(st, s) {
  const rt = st._rt, M = members(st, s);
  for (const p of M.kids) { p.job = 'kind'; p.w = -1; }
  for (const p of M.old) { p.job = 'alt'; p.w = -1; }
  const adults = M.adults;
  if (!adults.length) return;
  const need = s.prod.need || adults.length;
  const sites = bldOf(st, s).filter(b => b.prog < 1);
  const bl = bldOf(st, s).filter(b => b.prog >= 1 && D.BUILDINGS[b.t].workers > 0);
  const slots = []; // {job, b, n}
  const stockDays = s.stock.food / Math.max(1, need);
  const foodTarget = need * (stockDays < 8 ? 1.6 : stockDays > 40 ? 1.05 : 1.3);
  const season = seasonOf(st.day);
  let foodEst = 0;
  const foodB = bl.filter(b => b.t === 'fischer' || b.t === 'feld' || b.t === 'muehle' || b.t === 'leuchtturm')
    .sort((a, b) => (b.f ?? 1) * (b.t === 'fischer' ? 1.4 : 1) - (a.f ?? 1) * (a.t === 'fischer' ? 1.4 : 1));
  const perWorker = b => (b.t === 'fischer' || b.t === 'leuchtturm' ? 1.9 : 1.6) * (b.f ?? 1);
  for (const b of foodB) {
    if (foodEst >= foodTarget) break;
    const cap = D.BUILDINGS[b.t].workers;
    const n = Math.min(cap, Math.ceil((foodTarget - foodEst) / perWorker(b)));
    slots.push({ job: D.BUILDINGS[b.t].job, b: b.id, n });
    foodEst += n * perWorker(b);
  }
  // Erde: reicht das nicht (vor dem Feldbau, in trockenen Steppen), sammeln zuerst genug Menschen Nahrung, bevor Werkstatt
  // und Schrein Leute bekommen. Im reichen Archipel fiel das nie auf, am Indus verhungerte so ein ganzes Volk.
  if (st.earth && foodEst < foodTarget) {
    const n = Math.min(Math.ceil((foodTarget - foodEst) / 1.2), Math.ceil(adults.length * 0.75));
    if (n > 0) { slots.push({ job: 'sammler', b: -1, n }); foodEst += n * 1.2; }
  }
  // Baumeister
  const nb = (sites.length || (s.plan && s.plan.q.length && (s.era >= 1 || adults.length > 12) && stockDays > 12)) ? clamp(Math.ceil(adults.length * 0.14), 1, 3 + Math.floor(adults.length * 0.07)) : (s.era >= 1 && adults.length > 12 ? 1 : 0);
  if (nb) slots.push({ job: 'baumeister', b: -1, n: nb });
  // weitere Arbeitsplätze nach Kultur gewichtet
  const C = s.cult;
  const want = {
    holz: s.stock.wood < 60 || sites.length ? 1 : 0.4,
    stein: s.stock.stone < 60 ? 1 : 0.3,
    mine: s.stock.ore < 50 ? 1 : 0.3,
    werkstatt: 0.8,
    schrein: 0.3 + C.glaube,
    schule: 0.3 + C.wissen,
    sternwarte: 0.3 + C.wissen,
    markt: 0.3 + C.handel, hafen: 0.3 + C.handel,
    kaserne: s.war ? 1.5 : 0.15 + C.macht * 0.8, burg: s.war ? 1.5 : 0.2 + C.macht * 0.6,
    heiler: 0.9, theater: 0.3 + C.kunst,
    fabrik: 1, kraftwerk: 1,
  };
  const other = bl.filter(b => !foodB.includes(b)).sort((a, b) => (want[b.t] ?? 0.5) - (want[a.t] ?? 0.5));
  let remaining = adults.length - slots.reduce((a, x) => a + x.n, 0);
  for (const b of other) {
    if (remaining <= 0) break;
    const cap = D.BUILDINGS[b.t].workers;
    const n = Math.min(remaining, Math.max(1, Math.round(cap * clamp(want[b.t] ?? 0.5, 0.2, 1))));
    if (b.t === 'kaserne' && s.laws.includes('wehrpflicht')) slots.push({ job: 'krieger', b: b.id, n: Math.min(remaining, cap * 2) });
    else slots.push({ job: D.BUILDINGS[b.t].job, b: b.id, n });
    remaining -= n;
  }
  // restliche Nahrungsplätze, falls Menschen übrig sind
  for (const b of foodB) {
    if (remaining <= 0) break;
    const sl = slots.find(x => x.b === b.id);
    const cap = D.BUILDINGS[b.t].workers;
    const have = sl ? sl.n : 0;
    if (have < cap) { const n = Math.min(remaining, cap - have); if (sl) sl.n += n; else slots.push({ job: D.BUILDINGS[b.t].job, b: b.id, n }); remaining -= n; }
  }
  // Zuteilung: wer schon passt, bleibt
  const free = new Set(adults);
  const key = (job, b) => job + ':' + b;
  const open = new Map();
  for (const sl of slots) open.set(key(sl.job, sl.b), (open.get(key(sl.job, sl.b)) || 0) + sl.n);
  for (const p of adults) {
    const k = key(p.job, p.w);
    if ((open.get(k) || 0) > 0) { open.set(k, open.get(k) - 1); free.delete(p); }
  }
  for (const sl of slots) {
    let n = open.get(key(sl.job, sl.b)) || 0;
    if (n <= 0) continue;
    const fn = SUIT[sl.job];
    const cands = [...free];
    // Eignung zählt, aber man nimmt lieber Arbeit in der Nähe der eigenen Wohnung (kurze Wege)
    const wb = sl.b > 0 ? rt.bById.get(sl.b) : null;
    const far = p => { const h = wb && p.home > 0 ? rt.bById.get(p.home) : null; return h ? Math.hypot(h.x - wb.x, h.y - wb.y) : 0; };
    // Herkunft und Bildung entscheiden in strengen Orten über angesehene Berufe (mobility.js)
    const score = new Map(cands.map(p => [p, (fn ? fn(p) : 0) - far(p) * (fn ? 0.08 : 0.2) - jobGate(st, s, p, sl.job)]));
    cands.sort((a, b) => score.get(b) - score.get(a));
    for (const p of cands) {
      if (n <= 0) break;
      p.job = sl.job; p.w = sl.b; free.delete(p); n--;
    }
    open.set(key(sl.job, sl.b), n);
  }
  // Übrige: Sammler oder Jäger
  const hunt = knows(st, 'jagd', s);
  let i = 0;
  for (const p of free) {
    p.job = hunt && i % 3 === 2 && season !== 3 ? 'jaeger' : 'sammler';
    p.w = -1; i++;
  }
}

// ---------- Bauen ----------

function construction(st, s) {
  const M = members(st, s);
  const sites = bldOf(st, s).filter(b => (b.prog < 1 || b.hp < 1)).sort((a, b) => a.d - b.d);
  const roadsToDo = s.plan && s.plan.q.length;
  if (!sites.length && !roadsToDo) return;
  let builders = 0;
  for (const p of M.adults) if (p.job === 'baumeister' && !p.sick) builders += 0.7 + p.tr.fleiss * 0.6;
  let pts = builders * (1 + s.era * 0.12) * (0.8 + s.hap * 0.4);
  if (pts <= 0) pts = M.adults.length * 0.08;
  // Regelwerk (cityplan.js): erst die Straßen des neuen Blocks, dann die Häuser darin
  if (roadsToDo) pts -= streetWork(st, s, pts * (sites.length ? 0.5 : 1));
  for (const b of sites) {
    if (pts <= 0) break;
    const def = D.BUILDINGS[b.t];
    if (b.prog < 1) {
      const work = def.work * (1 + b.lvl * 0.3);
      const use = Math.min(pts, (1 - b.prog) * work);
      b.prog = Math.min(1, b.prog + use / work);
      pts -= use;
      if (b.prog >= 1) completed(st, s, b);
    } else {
      const use = Math.min(pts, (1 - b.hp) * 6);
      b.hp = Math.min(1, b.hp + use / 6);
      pts -= use;
    }
  }
}

function completed(st, s, b) {
  const def = D.BUILDINGS[b.t];
  st._rt.dirtyB = true;
  if (b.old != null) { b.old = null; return; }
  b.f = buildingFactor(st, b, s);
  const first = !st.flags['built_' + b.t];
  st.flags['built_' + b.t] = st.day;
  if (b.t === 'monument') chron(st, 'gott', L(`Die Menschen von ${s.name} vollenden eine Statue zu deinen Ehren. Sie blickt in den Himmel, dorthin, wo sie dich vermuten.`, `The people of ${s.name} complete a statue in your honor. It gazes at the sky, where they suspect you to be.`), s.id, 2, { x: b.x, y: b.y });
  else if (b.t === 'rakete') {
    st.flags.launched = st.day;
    chron(st, 'gott', L(`Der Sternenturm von ${s.name} erhebt sich auf einer Säule aus Feuer. Zum ersten Mal verlassen Menschen die Insel nach oben. Vielleicht suchen sie dich.`, `The Star Tower of ${s.name} rises on a pillar of fire. For the first time, people leave the island upward. Perhaps they are looking for you.`), s.id, 2, { x: b.x, y: b.y });
    fx(st, { type: 'launch', x: b.x, y: b.y });
  } else if (def.unique) chron(st, 'bau', L(`${s.name} errichtet ${b.t === 'burg' ? 'eine Burg' : b.t === 'sternwarte' ? 'eine Sternwarte' : b.t === 'leuchtturm' ? 'einen Leuchtturm' : b.t === 'kraftwerk' ? 'ein Kraftwerk' : article(b.t)}.`, `${s.name} erects ${b.t === 'burg' ? 'a castle' : b.t === 'sternwarte' ? 'an observatory' : b.t === 'leuchtturm' ? 'a lighthouse' : b.t === 'kraftwerk' ? 'a power plant' : article(b.t)}.`), s.id, 1, { x: b.x, y: b.y });
  else if (first && b.t !== 'haus') chron(st, 'bau', L(`Zum ersten Mal auf der Insel: ${s.name} baut ${article(b.t)}.`, `A first on the island: ${s.name} builds ${article(b.t)}.`), s.id, 0, { x: b.x, y: b.y });
}

const ART = {
  feld: L('ein Feld', 'a field'), fischer: L('eine Fischerhütte', 'a fishing hut'), holz: L('ein Holzfällerlager', "a woodcutter's camp"),
  stein: L('einen Steinbruch', 'a quarry'), mine: L('eine Mine', 'a mine'), speicher: L('einen Speicher', 'a storehouse'),
  werkstatt: L('eine Werkstatt', 'a workshop'), schrein: L('einen Schrein', 'a shrine'), brunnen: L('einen Brunnen', 'a well'),
  markt: L('einen Markt', 'a market'), schule: L('eine Schule', 'a school'), kaserne: L('eine Kaserne', 'a barracks'),
  hafen: L('einen Hafen', 'a harbor'), heiler: L('ein Heilerhaus', "a healer's house"), theater: L('ein Theater', 'a theater'),
  muehle: L('eine Windmühle', 'a windmill'), fabrik: L('eine Fabrik', 'a factory'),
  totem: L('einen Ahnenpfahl', 'an ancestor pole'), raeucherei: L('eine Räucherhütte', 'a smokehouse'), toepferei: L('eine Töpferei', 'a pottery'),
  stall: L('einen Viehhof', 'a livestock farm'), schmiede: L('eine Schmiede', 'a smithy'), baeckerei: L('eine Bäckerei', 'a bakery'),
  taverne: L('eine Taverne', 'a tavern'), wachturm: L('einen Wachturm', 'a watchtower'), tempel: L('einen Tempel', 'a temple'),
  bibliothek: L('eine Bibliothek', 'a library'), badehaus: L('ein Badehaus', 'a bathhouse'), arena: L('eine Arena', 'an arena'),
  palast: L('einen Palast', 'a palace'), kathedrale: L('eine Kathedrale', 'a cathedral'), gilde: L('ein Gildenhaus', 'a guild hall'),
  werft: L('eine Werft', 'a shipyard'), universitaet: L('eine Universität', 'a university'), bank: L('eine Bank', 'a bank'),
  oper: L('ein Opernhaus', 'an opera house'), museum: L('ein Museum', 'a museum'), park: L('einen Stadtpark', 'a city park'),
  bahnhof: L('einen Bahnhof', 'a railway station'), krankenhaus: L('ein Krankenhaus', 'a hospital'), hochhaus: L('einen Wohnturm', 'an apartment tower'),
  stadion: L('ein Stadion', 'a stadium'), labor: L('ein Forschungslabor', 'a research lab'),
};
const article = t => ART[t] || L(D.BUILDINGS[t].name, 'a ' + D.BUILDINGS[t].name.toLowerCase());

function canAfford(s, cost, mul = 1) {
  for (const [k, v] of Object.entries(cost)) if ((s.stock[k] || 0) < v * mul) return false;
  return true;
}
function pay(s, cost, mul = 1) { for (const [k, v] of Object.entries(cost)) s.stock[k] -= v * mul; }

function planner(st, s) {
  const M = members(st, s), pop = M.all.length;
  if (!pop) return;
  planStep(st, s, pop); // Regelwerk: Blöcke erschließen, wenn Bauland knapp wird (cityplan.js)
  const mine = bldOf(st, s).slice();
  const cnt = {};
  for (const b of mine) cnt[b.t] = (cnt[b.t] || 0) + 1;
  const count = t => cnt[t] || 0;
  const sites = mine.filter(b => b.prog < 1).length;
  const builders = M.adults.filter(p => p.job === 'baumeister').length;
  const maxSites = 1 + Math.floor(builders / 3);
  if (sites < maxSites) {
    const C = s.cult, k = t => !D.BUILDINGS[t].tech || knows(st, D.BUILDINGS[t].tech, s);
    const homeFree = (s.homeCap || 0) - pop;
    const need = s.prod.need || pop;
    const foodRatio = (s.prod.food || 0) / need;
    const fields = count('feld'), fishers = count('fischer');
    const cand = [];
    const add = (t, score) => { if (score > 0 && k(t)) cand.push([t, score]); };
    const foodCap = fields * 2 + fishers * 3;
    const foodRoom = foodCap < M.adults.length * 0.75;
    add('haus', homeFree < 2 + pop * 0.08 ? 10 + Math.max(0, -homeFree) : 0);
    add('feld', foodRoom && (foodRatio < 1.45 || (s.stock.food < need * 20 && foodRatio < 1.8)) ? 9 - fields * 0.05 : 0);
    if (s.coastal !== false) add('fischer', foodRoom && fishers < 1 + pop / 18 && foodRatio < 1.6 ? 8 : 0);
    add('holz', count('holz') < 1 + Math.floor(pop / 30) ? 7 : 0);
    add('stein', s.era >= 1 && count('stein') < 1 + Math.floor(pop / 45) ? 5 : 0);
    add('werkstatt', count('werkstatt') < 1 + Math.floor(pop / 35) ? 4.5 : 0);
    add('speicher', count('speicher') < 1 + Math.floor(pop / 35) && s.stock.food > s.cap * 0.7 ? 6 : count('speicher') === 0 ? 4 : 0);
    add('schrein', count('schrein') < 1 + Math.floor(pop / 70) ? 2.5 + C.glaube * 6 : 0);
    add('brunnen', count('brunnen') < Math.floor(pop / 40) + 1 ? 3 : 0);
    add('markt', count('markt') < 1 + Math.floor(pop / 90) ? 2.5 + C.handel * 5 : 0);
    add('schule', count('schule') < 1 + Math.floor(pop / 70) ? 3 + C.wissen * 5 : 0);
    add('mine', count('mine') < 1 + Math.floor(pop / 70) ? 3.5 : 0);
    // Kaserne: im Krieg und wenn der Verteidigungsminister Gefahr sieht (military.js s.mil.threat)
    add('kaserne', count('kaserne') < 1 + Math.floor(pop / 100) + (s.mil && s.mil.threat > 0.8 ? 1 : 0) ? (s.war || (s.mil && s.mil.threat > 0.6) ? 8 : 1 + C.macht * 4 + (s.mil ? s.mil.threat * 5 : 0)) : 0);
    add('hafen', count('hafen') < 1 + Math.floor(pop / 140) ? 3 + C.handel * 4 : 0);
    add('heiler', count('heiler') < 1 + Math.floor(pop / 90) ? 4 : 0);
    add('theater', count('theater') < 1 + Math.floor(pop / 160) ? 1.5 + C.kunst * 6 : 0);
    add('monument', !s.has.monument && s.faith > 0.55 && pop > 40 ? 2 + C.glaube * 8 : 0);
    add('muehle', fields >= 4 && count('muehle') < Math.floor(fields / 5) ? 4 : 0);
    add('burg', !s.has.burg && ['koenigtum', 'diktatur'].includes(s.gov.type) ? 5 : 0);
    add('sternwarte', !s.has.sternwarte && !s.laws.includes('sternenverbot') ? 2 + C.wissen * 5 : 0);
    add('leuchtturm', !s.has.leuchtturm ? 3.5 : 0);
    add('fabrik', count('fabrik') < 1 + Math.floor(pop / 110) ? 5 : 0);
    add('kraftwerk', !s.has.kraftwerk ? 6 : 0);
    // Neue Gebäude mit Bauplan (data.js plan): Vielfalt je Epoche, Kultur und Größe
    for (const [t, def] of Object.entries(D.BUILDINGS)) {
      const P = def.plan;
      if (!P || pop < (P.min || 0) || (P.era && s.era < P.era)) continue;
      if (def.unique && s.has[t]) continue;
      if (P.gov && !P.gov.includes(s.gov.type)) continue;
      const want = def.unique ? 1 : 1 + Math.floor((pop - (P.min || 0)) / (P.per || 1e9));
      if (count(t) >= want) continue;
      add(t, P.base + (P.w ? C[P.w] * 5 : 0) + (P.war && s.war ? P.war : 0));
    }
    // Wohntürme in der Moderne statt immer neuer Häuser
    if (s.era >= 7 && pop > 150) add('hochhaus', homeFree < 2 + pop * 0.08 ? 11 + Math.max(0, -homeFree) * 0.5 : 0);
    const biggest = st.settlements.filter(o => o.alive).sort((a, b) => b.pop - a.pop)[0];
    add('rakete', !st.flags.rocket && biggest === s ? 12 : 0);
    cand.sort((a, b) => b[1] - a[1]);
    for (const [t, sc] of cand.slice(0, 5)) {
      const def = D.BUILDINGS[t];
      const mul = 1 + s.era * 0.15;
      if (!canAfford(s, def.cost, mul)) continue;
      const site = findSite(st, s, t);
      if (!site) { if (t === 'fischer' && !count('fischer')) s.coastal = false; if (BIG_T.has(t) && s.plan) s.plan.wantBig = st.day; else if (s.plan && ['home', 'near', 'high', 'edge'].includes(def.place)) s.plan.short = st.day; continue; }
      pay(s, def.cost, mul);
      const nb = addBuilding(st, s, t, site[0], site[1], false);
      if (site.hh) nb.hh = 1; // Hinterhaus im Hof (Zugang durch das Vorderhaus)
      // Zufahrt zum Netz (R9). Gibt es keine (Steilküste, Fels), weicht der Betrieb: Material zurück, Platz gemerkt
      if (OUTSIDE_T.has(t) && !planAccess(st, s, nb)) {
        removeBuilding(st, nb, false);
        for (const [kk, v] of Object.entries(def.cost)) s.stock[kk] += v * mul;
        (st._rt.noAccess || (st._rt.noAccess = new Set())).add(idx(site[0], site[1]));
        continue;
      }
      financeBuild(st, s, nb, Object.fromEntries(Object.entries(def.cost).map(([k, v]) => [k, v * mul])));
      if (t === 'rakete') st.flags.rocket = st.day;
      if (sc > 0) break;
    }
  }
  // Modernisieren: ein Gebäude pro Runde holt die aktuelle Epoche auf
  if (sites < maxSites + 1 && s.era > 0) {
    const old = mine.filter(b => b.prog >= 1 && b.lvl < s.era && b.t !== 'feld' && b.t !== 'rakete');
    if (old.length) {
      old.sort((a, b) => (a.t === 'zentrum' ? -1 : 0) - (b.t === 'zentrum' ? -1 : 0) || a.lvl - b.lvl);
      const b = old[0];
      const cost = { wood: 3 + s.era * 2, stone: s.era >= 2 ? 2 + s.era * 2 : 0 };
      if (canAfford(s, cost)) { pay(s, cost); b.old = b.lvl; b.lvl = s.era; b.prog = 0.35; st._rt.dirtyB = true; }
    }
  }
}

// Großbauten, die über ihr Feld hinausragen (render/buildings.js SCALE, streets.js BIG): ringsum ein Feld Abstand
const BIG_T = new Set(['burg', 'kathedrale', 'palast', 'stadion', 'arena', 'oper', 'universitaet', 'bahnhof', 'museum', 'krankenhaus', 'werft', 'rakete']);

// Was ein Bauplatz ohne Blick auf die Nachbarn sicher nicht ist (gleiche Grenzen wie in findSite)
function pre(place, h, d, R, T, rt, i) {
  switch (place) {
    case 'home': return h < 1 || h > 3 || d > R;
    case 'near': return h < 1 || h > 3 || d > R * 0.85;
    case 'field': return h < 1 || h > 2 || T.fert[i] < 32 || d < 2 || d > R + 2.5;
    case 'fieldnear': return h < 1 || h > 2 || d > R + 2;
    case 'coast': return !rt.coast[i] || h > 1 || d > R + 3;
    case 'forest': return h < 1 || h > 3 || d > R + 3;
    case 'rock': return d > R + 6;
    case 'mountain': return h < 3 || d > R + 8;
    case 'high': return h < 1 || d > R;
    case 'edge': return h < 1 || h > 2 || d < R * 0.45 || d > R + 2;
    default: return true;
  }
}

// Bauplatz suchen. Seit 20.10.2026 nach dem Regelwerk (cityplan.js, PLAN_REGELWERK.md): Wohnhäuser, Werkstätten,
// Tempel, Märkte, Kasernen stehen nur auf Parzellen (erschlossener Block, Front zu einer gebauten Straße oder zum Platz),
// passend zur Nutzung (Platz, Hauptstraße, Wohnen, Rand). Felder, Ställe, Holz, Stein, Minen, Häfen liegen draußen,
// nie auf Straßen, und bekommen eine Zufahrt. Brunnen, Ahnenpfahl und Statue dürfen auf die Ecken des Platzes.
export function findSite(st, s, type, relaxed = false) {
  const rt = st._rt, T = st.tiles, r = rng(st), HB = rt.hb || T.h;
  const place = D.BUILDINGS[type].place;
  ensurePlan(st, s);
  const S = T.st;
  if (PLAZA.has(type)) {
    const sp = plazaSpots(st, s);
    if (sp.length && (type !== 'brunnen' || !bldOf(st, s).some(b => b.t === 'brunnen' && (S[idx(b.x, b.y)] & SQUARE)))) return sp[(r.next() * sp.length) | 0];
  }
  if ((place === 'home' || place === 'near' || place === 'high' || place === 'edge') && !OUTSIDE_T.has(type)) return lotSite(st, s, type, place, r, HB);
  const R = s.R;
  const ext = place === 'mountain' ? 8 : place === 'rock' ? 6 : 3;
  const reach = Math.max(R, s.plan ? s.plan.ext : R);
  const fieldLike = place === 'field' || place === 'fieldnear';
  let best = null, bs = -1e8;
  for (let y = Math.max(1, Math.floor(s.cy - reach - ext)); y <= Math.min(NY - 2, Math.ceil(s.cy + reach + ext)); y++)
    for (let x = Math.max(1, Math.floor(s.cx - reach - ext)); x <= Math.min(NX - 2, Math.ceil(s.cx + reach + ext)); x++) {
      const i = idx(x, y), h = HB[i];
      if (h < 0 || rt.bldAt[i] || T.burn[i] || rt.isleOf[i] !== landOf(s) || T.ruin[i] > 30 || (rt.findAt && rt.findAt.has(i))) continue;
      if (rt.roadNet && rt.roadNet[i]) continue; // nichts auf Landstraßen, auch nicht auf geplanten
      if (S[i]) continue; // nichts auf Straßen, Plätzen und Zufahrten des Plans (R2)
      if (rt.noAccess && rt.noAccess.has(i)) continue; // dorthin führt kein Weg
      const own = rt.owner[i];
      if (own && own !== s.id) continue;
      const d = Math.hypot(x - s.cx, y - s.cy);
      if (d < 1.2) continue;
      // Felder und Betriebe nicht in erschlossene Blöcke: die gehören den Häusern (R7)
      const bst = s.plan ? blockState(st, s, x, y) : 0;
      if (bst === 3 && place !== 'coast') continue;
      if (pre(place, h, d, fieldLike ? R + (s.plan ? Math.max(0, s.plan.ext - R) : 0) : R, T, rt, i)) continue;
      if (T.river[i]) continue;
      let adj = 0, adjF = 0, water = 0, trees = 0, high = 0, ore = 0, bigAdj = 0;
      for (const [dx, dy] of D8) {
        const j = idx(x + dx, y + dy);
        if (rt.bldAt[j]) { adj++; const b = rt.bById.get(rt.bldAt[j]); if (b && b.t === 'feld') adjF++; if (b && BIG_T.has(b.t)) bigAdj++; }
        if (T.h[j] < 0) water++;
        if (HB[j] >= 3) high++;
      }
      if (bigAdj) continue;
      if (BIG_T.has(type) && adj - adjF > 0) continue;
      if (place === 'forest' || place === 'mountain') for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inb(x + dx, y + dy)) { const j = idx(x + dx, y + dy); trees += T.tree[j]; ore += T.ore[j]; }
      const tr = T.tree[i];
      const RF = R + (s.plan ? Math.max(0, s.plan.ext - R) * 0.6 : 0);
      let sc;
      switch (place) {
        case 'field':
          if (h < 1 || h > 2 || T.fert[i] < 32 || d < 2 || d > RF + 2.5) continue;
          // Felder draußen vor der Bebauung, in Gewannen nebeneinander (R7)
          sc = T.fert[i] / 16 - d * 0.45 + adjF * 0.9 - tr * 1.2 - (adj - adjF) * 0.4 - Math.max(0, R * 0.5 - d) * 0.9 - (bst === 2 ? 1.2 : 0) - (rt.townMask && rt.townMask[i] && bst !== 1 ? 0.8 : 0); break;
        case 'fieldnear':
          if (h < 1 || h > 2 || adjF < 2 || d > RF + 2) continue;
          sc = adjF - d * 0.3 - (bst === 2 ? 1 : 0); break;
        case 'coast':
          if (!rt.coast[i] || h > 1 || d > reach + 3) continue;
          // im Ort nur mit Front zur Straße (Kai), draußen bekommt der Hafen eine Zufahrt
          if (bst >= 2 && frontOf(st, x, y) < 0) continue;
          sc = -d * 0.8 + water * 0.25; break;
        case 'forest':
          if (h < 1 || h > 3 || trees < 4 || d > reach + 3) continue;
          sc = Math.min(trees, 20) * 0.4 - d * 0.5 - (bst === 2 ? 1.5 : 0); break;
        case 'rock':
          if (!(h >= 3 || (h === 2 && high)) || d > reach + 6) continue;
          sc = -d * 0.6 + high * 0.2; break;
        case 'mountain':
          if (h < 3 || ore <= 0 || d > reach + 8) continue;
          sc = Math.min(ore, 300) / 50 - d * 0.5; break;
        case 'high':
          if (h < 1 || d > reach + 4) continue;
          sc = h * 1.6 - d * 0.5 - tr * 0.3; break;
        case 'edge':
          if (h < 1 || h > 2 || d < R * 0.45 || d > reach + 2) continue;
          sc = -Math.abs(d - R * 0.85) - tr * 0.3; break;
        case 'home': case 'near':
          if (h < 1 || h > 3 || d > reach) continue;
          sc = -d - tr * 0.4 - water * 0.2; break;
        default: continue;
      }
      // eine gebaute Straße in der Nähe spart die lange Zufahrt
      if (frontOf(st, x, y) >= 0) sc += 0.8;
      sc += r.next() * 0.6;
      if (sc > bs) { bs = sc; best = [x, y]; }
    }
  return best;
}

// Parzelle im erschlossenen Block: freie Kachel mit Front zur Straße, Nutzung passend, Großbauten mit Abstand (R1, R4, R7, R8)
function lotSite(st, s, type, place, r, HB) {
  const rt = st._rt, T = st.tiles, B = blocksOf(st, s);
  const big = BIG_T.has(type), R = s.plan.ext;
  let best = null, bs = -1e8, bestH = false;
  const edge = edgeLots(s);
  for (const blk of B.list) {
    if (blk.open ? !edge : !blk.built) continue;
    for (const i of blk.tiles) {
      if (!usable(st, s, i, place === 'high')) continue;
      const x = i % NX, y = (i / NX) | 0, h = HB[i];
      // Hof ohne Straße bleibt Garten. Ist der Ort voll (kein Block mehr zu erschließen), darf ein Wohnhaus als Hinterhaus
      // in den Hof, wenn das Vorderhaus daneben an der Straße steht (Nachverdichtung wie in alten Städten)
      let hinter = false;
      if (frontOf(st, x, y) < 0) {
        if (!(edge && (type === 'haus' || type === 'hochhaus'))) continue;
        for (const [dx, dy] of D4) { const id = rt.bldAt[idx(x + dx, y + dy)], o = id && rt.bById.get(id); if (o && o.t !== 'feld' && !o.hh && frontOf(st, x + dx, y + dy) >= 0) { hinter = true; break; } }
        if (!hinter) continue;
      }
      let adj = 0, adjF = 0, bigAdj = 0, same = 0;
      for (const [dx, dy] of D8) {
        const j = idx(x + dx, y + dy), id = rt.bldAt[j];
        if (!id) continue;
        const b = rt.bById.get(id);
        adj++;
        if (b && b.t === 'feld') adjF++;
        if (b && BIG_T.has(b.t)) bigAdj++;
        if (b && b.t === type) same++;
      }
      if (bigAdj) continue;
      if (big && adj - adjF > 0) continue;
      const zone = zoneOf(st, s, x, y), fit = zoneFit(type, zone);
      if (fit < -1) continue; // Nutzung passt nicht (R7), etwa ein Wohnhaus am Platz
      if (big && zone !== 'platz' && zone !== 'haupt' && zone !== 'rand') continue;
      const d = Math.hypot(x - s.cx, y - s.cy);
      let sc = fit * 1.5 - T.tree[i] * 0.3;
      if (type === 'haus' || type === 'hochhaus') sc += -d * 0.45 + (adj - adjF) * 0.35 - (h === 3 ? 1.2 : 0);
      else if (place === 'high') sc += h * 1.6 - d * 0.3;
      else if (place === 'edge') sc += -Math.abs(d - R * 0.8) * 0.4;
      else sc += -d * 0.55 - same * 0.8; // gleiche Betriebe nicht nebeneinander
      if (hinter) sc -= 1.5; // erst die Straßenparzellen, dann die Höfe
      sc += r.next() * 0.6;
      if (sc > bs) { bs = sc; best = [x, y]; bestH = hinter; }
    }
  }
  if (best && bestH) best.hh = 1;
  return best;
}

// ---------- Wege ----------

function roads(st) {
  const T = st.tiles, rt = st._rt;
  townMask(st);
  const floor = rt.roadFloor;
  if (st.day % 12 === 0) eachSet(T.road, i => { T.road[i] = Math.max(floor ? floor[i] : 0, T.road[i] - 3); });
  let k = 0;
  for (const p of st.people) {
    if (p.home <= 0 || ++k % 2) continue;
    const h = rt.bById.get(p.home);
    const tgt = p.w > 0 ? rt.bById.get(p.w) : rt.sById.get(p.s) && rt.bById.get(rt.sById.get(p.s).center);
    if (!h || !tgt) continue;
    let x = h.x, y = h.y;
    const steps = Math.max(Math.abs(tgt.x - x), Math.abs(tgt.y - y));
    for (let s = 1; s < steps; s++) {
      const xx = Math.round(h.x + (tgt.x - h.x) * s / steps), yy = Math.round(h.y + (tgt.y - h.y) * s / steps);
      const i = idx(xx, yy);
      if (T.h[i] < 0 || rt.bldAt[i]) continue;
      if (rt.townMask && rt.townMask[i] && !T.st[i]) continue; // im Ort laufen alle auf den Straßen, nicht quer durch die Blöcke
      T.road[i] = Math.min(255, T.road[i] + 4);
      if (T.road[i] > 60 && T.tree[i]) T.tree[i] = 0;
    }
  }
  rt.dirtyT = true;
}

// ---------- Wissen ----------

const AFFINITY = {
  rituale: 'glaube', kalender: 'glaube', schrift: 'wissen', mathematik: 'wissen', philosophie: 'wissen', astronomie: 'wissen',
  universitaet: 'wissen', chemie: 'wissen', bronze: 'macht', eisen: 'macht', lehnswesen: 'macht', handel: 'handel',
  geldwesen: 'handel', segeln: 'handel', schiffbau: 'handel', navigation: 'handel', kuenste: 'kunst', architektur: 'kunst',
  recht: 'freiheit', zeitung: 'freiheit', ackerbau: 'tradition', viehzucht: 'tradition', medizin: 'wissen',
};

export function pickResearch(st, I) {
  const r = rng(st);
  const avail = D.TECHS.filter(t => !knows(st, t.id, I.id) && t.req.every(q => knows(st, q, I.id)));
  if (!avail.length) { I.research.cur = null; return; }
  const minEra = Math.min(...avail.map(t => t.era));
  const sets = st.settlements.filter(s => s.alive && s.isle === I.id);
  const tot = sets.reduce((a, s) => a + s.pop, 0) || 1;
  const avg = k => sets.reduce((a, s) => a + s.cult[k] * s.pop, 0) / tot;
  const ban = sets.some(s => s.laws.includes('sternenverbot'));
  const t = r.weighted(avail, t => (1 / Math.sqrt(techCost(st, I, t))) * (1 + (AFFINITY[t.id] ? avg(AFFINITY[t.id]) * 2 : 0.6)) * (t.era === minEra ? 4 : 1) * (t.key ? 2.5 : 1) * (ban && t.id === 'astronomie' ? 0.1 : 1));
  I.research.cur = t.id;
}

// Wissen, das Nachbarinseln schon haben, lernt man leichter
export function techCost(st, I, t) {
  for (const o of Object.keys(I.contact || {})) {
    if (knows(st, t.id, +o)) return t.cost * 0.55;
  }
  return t.cost;
}

export function learn(st, id, by, I) {
  if (!I) I = by ? isleOf(st, st._rt.sById.get(by.s)) : st.isles[0];
  if (!I || knows(st, id, I.id)) return;
  const t = D.TECH[id];
  I.techs.push(id);
  st._rt.isleKnown.get(I.id).add(id);
  st._rt.anyKnown.add(id);
  const s = by && st._rt.sById.get(by.s);
  if (by) { by.fame += 2; bio(by, st.day, L(`entdeckt ${t.name}`, `discovers ${t.name.toLowerCase()}`)); }
  const where = st.isles.filter(o => st.settlements.some(x => x.alive && x.isle === o.id)).length > 1 ? (st.earth ? L(` (bei den ${I.name})`, ` (among the ${I.name})`) : L(` (Insel ${I.name})`, ` (on ${I.name})`)) : '';
  chron(st, 'wissen', by ? L(`${by.n} aus ${s ? s.name : I.name} entdeckt: ${t.name}. ${t.info}.`, `${by.n} of ${s ? s.name : I.name} discovers: ${t.name}. ${t.info}.`) : L(`Die Menschen von ${I.name} lernen: ${t.name}. ${t.info}.`, `The people of ${I.name} learn: ${t.name}. ${t.info}.`), s ? s.id : -1, 1, { tech: id, isle: I.id });
  if (t.key && t.key > I.era) {
    I.era = t.key;
    const e = D.ERAS[I.era];
    for (const x of st.settlements) if (x.isle === I.id) x.era = I.era;
    if (I.era > st.era) {
      st.era = I.era;
      chron(st, 'epoche', L(`Eine neue Zeit beginnt${where}: ${e.name}. ${e.sub}.`, `A new age begins${where}: ${e.name}. ${e.sub}.`), -1, 2, { era: I.era, isle: I.id });
      fx(st, { type: 'era', era: I.era });
    } else chron(st, 'epoche', st.earth ? L(`Bei den ${I.name} beginnt eine neue Zeit: ${e.name}.`, `A new age begins among the ${I.name}: ${e.name}.`) : L(`Auf ${I.name} beginnt eine neue Zeit: ${e.name}.`, `A new age begins on ${I.name}: ${e.name}.`), -1, 1, { era: I.era, isle: I.id });
  }
  if (I.research.cur === id) I.research.cur = null;
}

function researchStep(st) {
  for (const I of st.isles) {
    if (!st.settlements.some(s => s.alive && s.isle === I.id)) continue;
    if (!I.research.cur || knows(st, I.research.cur, I.id)) pickResearch(st, I);
    const cur = I.research.cur && D.TECH[I.research.cur];
    // alles Wissen erforscht: weiter mit Zukunftserfindungen und Fortschrittsstufen (progress.js), vorher verfielen die Punkte
    if (!cur) { if (I.techs.length >= D.TECHS.length) progressStep(st, I); else I.research.pts = 0; continue; }
    const cost = techCost(st, I, cur);
    if (I.research.pts >= cost) {
      I.research.pts -= cost;
      // Entdecker: neugierigster Gelehrter oder Ältester dieser Insel
      let by = null, bs = -1;
      for (const p of st.people) {
        const ps = st._rt.sById.get(p.s);
        if (!ps || ps.isle !== I.id) continue;
        if (p.job !== 'gelehrter' && p.job !== 'alt' && p.job !== 'priester' && !p.genius) continue;
        const sc = p.tr.neugier + (p.genius ? 0.5 : 0) + (p.job === 'gelehrter' ? 0.3 : 0) + rng(st).next() * 0.4;
        if (sc > bs) { bs = sc; by = p; }
      }
      learn(st, cur.id, by, I);
      pickResearch(st, I);
    }
  }
}

// ---------- Göttliche Kraft ----------

export function manaMax(st) { return D.ERAS[st.era].mana; }

export function manaStep(st) {
  let f = 0, priests = 0;
  for (const p of st.people) if (ageOf(st, p) >= 14) { f += p.faith; if (p.job === 'priester') priests++; }
  st.manaRate = 1.3 + f * 0.01 + priests * 0.02;
  st.mana = Math.min(manaMax(st), st.mana + st.manaRate);
  st.faithAvg = st.people.length ? f / st.people.length : 0;
}
