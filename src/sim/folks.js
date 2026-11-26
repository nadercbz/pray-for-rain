// Die Völker der Erde (seit 19.10.2026, PLAN_ERDE.md E3 und E4). In einer Erdwelt gehört das Wissen dem Volk, nicht
// der Landmasse: Afrika, Europa und Asien hängen zusammen, trotzdem sollen Asni, das Schwarze Meer und der Jangtse
// unabhängig wachsen. Darum ist st.isles in der Erde die Liste der Völker (Wissen, Epoche, Forschung, Kontakte, Währung)
// und s.isle das Volk einer Siedlung; die Landmasse steht in s.land (st.lands, rt.isleOf zeigt je Feld auf sie).
// Hier: Weltbau mit dem Startort des Spielers und sieben unabhängigen Völkern, Erstkontakt über Land und See, Ziele für
// Siedler über das Meer, neue Völker durch Entfernung und Zeit, Speichern nur der Abweichungen von den Erddaten.
import * as D from './data.js';
import { Rng, clamp } from './rng.js';
import { NX, NY, idx, inb, encode, decode, setWorldSize } from './world.js';
import { EARTH, generateEarth, folkSpots, langFor, kmBetween } from './earth.js';
import { hydrate, newSettlement, findSite, indexMembers, manaStep } from './core.js';
import { makePerson, bio, chron, rng, addBuilding, setTerritory, members, knows, fx, shiftCult } from './util.js';
import { chooseLeader, leaderOf, label } from './society.js';
import { clanName, placeName } from './names.js';
import { worldCharacter, characterLine } from './character.js';
import { initMoney, moneyIndex } from './money.js';
import { initSocial } from './social.js';
import { initDiaries } from './diary.js';
import { initSites } from './sites.js';
import { initExplore, knownCoast } from './explore.js';
import { L } from '../i18n.js';

export const EARTH_MAX_SETTLEMENTS = 160;
export const landOf = s => (s.land ?? s.isle);
const dist = (a, b) => Math.hypot(a.cx - b.cx, a.cy - b.cy);

// Name eines Volkes in seiner Sprache, ohne Doppelungen
function folkName(r, lang, taken) {
  for (let k = 0; k < 40; k++) { const n = clanName(r, lang); if (!taken.has(n)) { taken.add(n); return n; } }
  return clanName(r, lang) + ' ' + taken.size;
}
export const folkLabel = I => L(`das Volk der ${I.name}`, `the ${I.name} people`);

function freshCulture(r) {
  const c = {};
  for (const k of Object.keys(D.CULTURE)) c[k] = clamp(0.42 + r.gauss() * 0.22, 0.08, 0.9);
  return c;
}

// Ein Volk beginnt an einem Ort: Siedlung, Paare, Kinder, drei Häuser
function landFolk(st, I, x, y, n, text) {
  const r = rng(st);
  const s = newSettlement(st, x, y, I.lang, freshCulture(r), null, I.id);
  const pairs = Math.floor(n / 2.4);
  for (let i = 0; i < pairs; i++) {
    const f = makePerson(st, s, { sex: 'f', b: -r.int(17, 31) * D.DAYS_PER_YEAR - r.int(0, 23) });
    const m = makePerson(st, s, { sex: 'm', b: -r.int(18, 33) * D.DAYS_PER_YEAR - r.int(0, 23), clan: r.chance(0.5) ? f.clan : undefined });
    f.pa = m.id; m.pa = f.id;
    if (i < n - pairs * 2) {
      const k = makePerson(st, s, { b: -r.int(3, 9) * D.DAYS_PER_YEAR, mother: f.id, father: m.id });
      f.kids++; m.kids++; bio(k, 0, L('kam als Kind mit den Ersten', 'came as a child with the first ones'));
    }
  }
  for (const p of st.people) if (p.s === s.id) { if (!p.bio.length) bio(p, 0, text); p.fame = 1; }
  for (let k = 0; k < 3; k++) { const site = findSite(st, s, 'haus'); if (site) addBuilding(st, s, 'haus', site[0], site[1], true); }
  return s;
}

// Neue Erdwelt. start = { x, y } (schon geprüft mit startCheck, ein guter Bauplatz). Die anderen sieben Völker
// hängen vom Startort ab (folkSpots), alles andere vom Seed.
export function createEarthWorld(seed, start) {
  if (!EARTH) throw new Error('Erde nicht geladen');
  setWorldSize(EARTH.W, EARTH.H);
  const W = generateEarth(seed);
  const st = {
    v: D.WORLD_VERSION, seed: W.seed, rng: Math.imul(W.seed, 2654435761) >>> 0, day: 0, acc: 0, savedAt: 0,
    nextId: 1, earth: { v: 1, w: W.W, h: W.H, start: [start.x, start.y] },
    tiles: { h: W.h, tree: W.tree, fert: W.fert, ore: W.ore, road: W.road, burn: W.burn, ruin: W.ruin, bio: W.bio, river: W.river, seen: W.seen, reg: W.reg },
    isles: [], lands: W.lands, voyages: [], trade: [], regions: W.regions, volc: W.volc, lakes: [], rivers: W.rivers, riverRank: W.riverRank, grown: 1,
    people: [], buildings: [], settlements: [], era: 0,
    weather: { kind: 'klar', until: 0, god: null, moist: 0.55, temp: 14 },
    effects: [], mana: 100, prayers: [], chronicle: [], myths: [], ancestors: [], stats: [], sites: [], godLog: [],
    flags: {}, lastGod: 0, counts: { births: 0, deaths: 0, powers: 0, answered: 0 },
  };
  st.char = worldCharacter(st.seed);
  hydrate(st);
  const r = rng(st), rt = st._rt;
  const homes = [{ x: start.x, y: start.y, player: true }, ...folkSpots(start.x, start.y)];
  const taken = new Set(), usedLang = new Set();
  homes.forEach((h0, k) => {
    let lang = langFor(h0.x, h0.y);
    if (k && usedLang.has(lang)) lang = [5, 6, 7, 8, 9, 10, 4, 3, 2, 1].find(l => !usedLang.has(l)) ?? lang;
    usedLang.add(lang);
    const I = {
      id: k + 1, name: folkName(r, lang, taken), folk: 1, lang, cx: h0.x, cy: h0.y, rx: h0.x, ry: h0.y, area: 1e6,
      home: [h0.x, h0.y], player: h0.player ? 1 : 0, lands: {},
      techs: [], research: { cur: 'feuer', pts: 0 }, era: 0, contact: {}, seen: {},
    };
    st.isles.push(I); rt.iById.set(I.id, I); rt.isleKnown.set(I.id, new Set());
    const s = landFolk(st, I, h0.x, h0.y, h0.player ? 12 : r.int(10, 12), h0.player
      ? L('gehört zu den Ersten, die hier ein Feuer entzünden', 'is one of the first to light a fire here')
      : L('wurde hier geboren, weit weg von allen anderen', 'was born here, far from everyone else'));
    I.lands[landOf(s)] = 0;
    I.capital = s.id;
  });
  indexMembers(st);
  for (const o of st.settlements) chooseLeader(st, o, true);
  const me = st.settlements[0], P = st.isles[0];
  const reg = name => { const g = st.regions[st.tiles.reg[idx(me.cx, me.cy)] - 1]; return g ? L(g.de, g.en) : name; };
  chron(st, 'gott', L(`Zwölf Menschen ziehen durch ${reg('ein weites Land')} und finden einen Platz am Wasser. Sie entzünden ein Feuer und nennen ihren Ort ${me.name}. Sie sind ${folkLabel(P)}.`,
    `Twelve people wander through ${reg('a wide land')} and find a place by the water. They light a fire and name their home ${me.name}. They are ${folkLabel(P)}.`), me.id, 2);
  chron(st, 'gott', L('Irgendwo hinter Meeren, Wüsten und Gebirgen leben andere Menschen. Sie sprechen andere Sprachen und wissen nichts voneinander.', 'Somewhere beyond seas, deserts and mountains other people live. They speak other tongues and know nothing of each other.'), -1, 1);
  chron(st, 'gott', characterLine(st.char), -1, 1);
  chron(st, 'gott', L('Niemand weiß, dass jemand zusieht.', 'Nobody knows that someone is watching.'), -1, 1);
  setTerritory(st);
  manaStep(st);
  st.mana = 100;
  initMoney(st); initSocial(st); moneyIndex(st, true); initDiaries(st); initSites(st);
  st.exploreV = 0; initExplore(st);
  return st;
}

// ---------- Speichern ----------
// Die Grundebenen der Erde entstehen beim Laden neu aus den Erddaten und dem Seed. Gespeichert wird je Ebene nur,
// was sich davon unterscheidet (XOR, danach PackBits in encode: fast alles ist 0). So bleibt der Stand klein.
const BASE_KEYS = ['h', 'tree', 'fert', 'ore', 'bio', 'river', 'reg'];
let baseCache = null;
function earthBase(seed) {
  if (baseCache && baseCache.seed === seed) return baseCache.W;
  const W = generateEarth(seed);
  baseCache = { seed, W };
  return W;
}
export function encodeEarthTiles(st) {
  const B = earthBase(st.seed), out = {};
  for (const [k, v] of Object.entries(st.tiles)) {
    if (!BASE_KEYS.includes(k)) { out[k] = encode(v); continue; }
    const b = B[k], d = new v.constructor(v.length);
    for (let i = 0; i < v.length; i++) d[i] = v[i] ^ b[i];
    out[k] = 'x' + encode(d);
  }
  return out;
}
export function decodeEarthTiles(o) {
  setWorldSize(o.earth.w, o.earth.h);
  const B = earthBase(o.seed), t = {};
  for (const [k, v] of Object.entries(o.tiles)) {
    const Type = k === 'h' ? Int8Array : k === 'reg' ? Uint16Array : Uint8Array;
    if (v[0] === 'x') {
      const d = decode(v.slice(1), Type), b = B[k];
      for (let i = 0; i < d.length; i++) d[i] ^= b[i];
      t[k] = d;
    } else t[k] = decode(v, Type);
  }
  // Erdlisten kommen aus den Daten, Namen der Völker für Gegenden bleiben erhalten
  const names = new Map((o.regionNames || []).map(([id, n, by, d]) => [id, [n, by, d]]));
  o.regions = B.regions.map(g => { const n = names.get(g.id); return n ? { ...g, name: n[0], by: n[1], d: n[2] } : { ...g }; });
  o.rivers = B.rivers; o.riverRank = B.riverRank; o.volc = B.volc; o.lakes = [];
  o.lands = B.lands;
  delete o.regionNames;
  return t;
}
// Was vom Stand nicht gespeichert werden muss (kommt aus den Erddaten)
export function earthSaveExtras(rest) {
  rest.regionNames = (rest.regions || []).filter(g => g.name).map(g => [g.id, g.name, g.by, g.d]);
  delete rest.regions; delete rest.rivers; delete rest.riverRank; delete rest.volc; delete rest.lakes; delete rest.lands;
  return rest;
}

// ---------- Kontakt zwischen Völkern ----------
// Völker treffen sich, wenn ihre Kundschafter weit genug kommen (gleiches Land) oder ihre Schiffe (Segeln, Schiffbau,
// Navigation). Geprüft wird alle 24 Tage über die nächsten Orte der beiden Völker.
const trekRange = s => Math.min(95, 24 + (s.era || 0) * 10);
const seaRange = (st, I) => (knows(st, 'navigation', I.id) ? 999 : knows(st, 'schiffbau', I.id) ? 130 : knows(st, 'segeln', I.id) ? 75 : 0);
export function earthContactStep(st) {
  const r = rng(st), rt = st._rt;
  const by = new Map();
  for (const s of st.settlements) if (s.alive) { let a = by.get(s.isle); if (!a) by.set(s.isle, a = []); a.push(s); }
  const folks = st.isles.filter(I => by.has(I.id));
  for (let i = 0; i < folks.length; i++) for (let j = i + 1; j < folks.length; j++) {
    const I = folks[i], J = folks[j];
    if (I.contact[J.id]) continue;
    let best = null, bd = 1e9;
    for (const a of by.get(I.id)) for (const b of by.get(J.id)) { const d = dist(a, b); if (d < bd) { bd = d; best = [a, b]; } }
    if (!best) continue;
    const [a, b] = best;
    const sameLand = landOf(a) === landOf(b);
    const land = sameLand && bd <= Math.max(trekRange(a), trekRange(b)) + a.R + b.R;
    const harbor = s => st.buildings.some(x => x.s === s.id && (x.t === 'hafen' || x.t === 'fischer') && x.prog >= 1);
    const sea = !land && ((seaRange(st, I) >= bd && harbor(a)) || (seaRange(st, J) >= bd && harbor(b)));
    if (!land && !sea) continue;
    if (!r.chance(land ? 0.5 : 0.35)) continue;
    const [x, y, X, Y] = harbor(a) || !harbor(b) ? [a, b, I, J] : [b, a, J, I];
    meet(st, X, Y, x, y, land);
    void rt;
  }
}

function meet(st, I, J, a, b, land) {
  const r = rng(st);
  I.contact[J.id] = J.contact[I.id] = st.day;
  I.seen[J.id] = J.seen[I.id] = st.day;
  for (const x of st.settlements) if (x.alive && x.isle === I.id) for (const y of st.settlements) if (y.alive && y.isle === J.id) {
    let cd = 0; for (const k of Object.keys(x.cult)) cd += Math.abs(x.cult[k] - y.cult[k]);
    x.rel[y.id] = y.rel[x.id] = clamp(r.range(-5, 25) - cd * 25, -60, 60);
  }
  const hostile = b.cult.macht > 0.55 || b.laws.includes('abschottung');
  const lead = leaderOf(st, b);
  const km = Math.round(kmBetween(a.cx, a.cy, b.cx, b.cy) / 10) * 10;
  if (!land) st.voyages.push({ k: 'entdeckung', a: a.id, to: [b.cx, b.cy], d: st.day, dur: 5 });
  chron(st, 'fremde', land
    ? (hostile
      ? L(`Kundschafter aus ${a.name} ziehen ${km} km weit und stoßen auf Fremde: ${folkLabel(J)}, ${b.name} ist ihr Ort. Man versteht kein Wort. ${label(lead)} lässt die Grenze bewachen.`,
        `Scouts from ${a.name} travel ${km} km and come upon strangers: ${folkLabel(J)}, whose home is ${b.name}. Not a word is understood. ${label(lead)} has the border guarded.`)
      : L(`Kundschafter aus ${a.name} ziehen ${km} km weit und treffen auf ${folkLabel(J)}. In ${b.name} teilt man Brot mit ihnen, und beide Seiten staunen über die fremde Sprache.`,
        `Scouts from ${a.name} travel ${km} km and meet ${folkLabel(J)}. In ${b.name} bread is shared with them, and both sides marvel at the strange tongue.`))
    : (hostile
      ? L(`Seefahrer aus ${a.name} landen nach ${km} km an einer fremden Küste. ${folkLabel(J)[0].toUpperCase() + folkLabel(J).slice(1)} empfängt sie in ${b.name} mit Speeren.`,
        `Seafarers from ${a.name} land on a foreign coast after ${km} km. ${folkLabel(J)[0].toUpperCase() + folkLabel(J).slice(1)} receive them at ${b.name} with spears.`)
      : L(`Seefahrer aus ${a.name} landen nach ${km} km an einer fremden Küste. Dort lebt ${folkLabel(J)}. ${b.name} empfängt sie mit Brot und Geschenken.`,
        `Seafarers from ${a.name} land on a foreign coast after ${km} km. ${folkLabel(J)[0].toUpperCase() + folkLabel(J).slice(1)} live there. ${b.name} welcomes them with bread and gifts.`)),
  b.id, 2, { x: b.cx, y: b.cy });
  if (hostile) a.rel[b.id] = b.rel[a.id] = Math.min(a.rel[b.id] ?? 0, -25);
  for (const s of [a, b]) { shiftCult(s, 'wissen', 0.03); shiftCult(s, 'handel', 0.03); }
  fx(st, { type: 'contact', a: a.id, b: b.id });
}

// ---------- Siedler über das Meer ----------
// Ein Ort ohne Platz in der Nähe sucht ein anderes Land, dessen Küste sein Volk kennt und das seine Schiffe erreichen.
export function earthSeaTarget(st, s) {
  const I = st._rt.iById.get(s.isle);
  const R = seaRange(st, I);
  if (!R) return null;
  let best = null, bd = 1e9;
  for (const Ld of st.lands) {
    if (Ld.id === landOf(s) || Ld.area < 60) continue;
    if (Math.hypot(Ld.cx - s.cx, Ld.cy - s.cy) - Math.sqrt(Ld.area) > R + 40) continue;
    const c = knownCoast(st, Ld.id, s.cx, s.cy);
    if (!c) continue;
    const d = Math.hypot(c[0] - s.cx, c[1] - s.cy);
    if (d <= R && d < bd) { bd = d; best = { land: Ld, coast: c, d }; }
  }
  return best;
}

// Erster Blick eines Volkes auf ein anderes Land (Küstenfahrten in explore.js)
export function earthLandSight(st, I, landId, from) {
  if (!I || !I.lands || I.lands[landId] != null) return;
  const Ld = st._rt.lById.get(landId);
  if (!Ld || Ld.area < 60) return;
  I.lands[landId] = st.day;
  const r = rng(st), name = placeName(r, I.lang);
  Ld.names = Ld.names || {};
  Ld.names[I.id] = name;
  chron(st, 'erkundung', r.pick(L([
    `Seefahrer aus ${from.name} folgen einer fremden Küste. Kein Mensch ist zu sehen. Sie nennen das Land ${name}. (Heute: ${Ld.de})`,
    `Ein Boot aus ${from.name} kehrt zurück: Hinter dem Meer liegt Land. Man nennt es ${name}. (Heute: ${Ld.de})`,
  ], [
    `Seafarers from ${from.name} follow a strange coast. No one is to be seen. They call the land ${name}. (Today: ${Ld.en})`,
    `A boat from ${from.name} returns: beyond the sea lies land. They call it ${name}. (Today: ${Ld.en})`,
  ])), from.id, Ld.area > 2000 ? 2 : 1);
}

// ---------- Aufräumen ----------
// Beziehungen zu längst verlassenen Orten braucht niemand mehr (die Erde hat Hunderte Orte über die Jahrhunderte,
// sonst wächst der Spielstand um Megabytes). Bündnisse bleiben, die zählen in der Kultur mit. Jährlich.
export function pruneDead(st) {
  const dead = new Set(st.settlements.filter(s => !s.alive && st.day - (s.ended ?? s.founded) > 24).map(s => s.id));
  if (!dead.size) return;
  for (const s of st.settlements) {
    if (!s.alive && dead.has(s.id)) { s.rel = {}; s.grudge = {}; s.lastReason = {}; continue; }
    for (const m of [s.rel, s.grudge, s.lastReason, s.pact]) if (m) for (const k in m) if (dead.has(+k)) delete m[k];
  }
}

// ---------- Ausgestorbene Völker ----------
// Stirbt ein Volk in den ersten 400 Jahren ganz aus, ziehen nach 8 bis 20 Jahren neue Menschen derselben Sprache aus
// dem Hinterland in seine alte Heimat (sonst bleibt ein Kontinent leer). Ihr Wissen ist das alte, halb vergessen.
export function folkReviveStep(st) {
  if (!st.earth || st.day > 400 * D.DAYS_PER_YEAR) return;
  const r = rng(st), rt = st._rt;
  for (const I of st.isles) {
    if (I.player || I.from || st.settlements.some(s => s.alive && s.isle === I.id)) { I.goneAt = 0; continue; }
    if (!I.goneAt) { I.goneAt = st.day; continue; }
    if (st.day - I.goneAt < (8 + (I.id * 5) % 13) * D.DAYS_PER_YEAR || st.settlements.filter(s => s.alive).length >= rt.maxSet) continue;
    const [hx, hy] = I.home || [I.cx, I.cy];
    if (st.settlements.some(s => s.alive && Math.hypot(s.cx - hx, s.cy - hy) < 40)) continue;
    I.techs = I.techs.slice(0, Math.ceil(I.techs.length / 2));
    rt.isleKnown.set(I.id, new Set(I.techs));
    I.era = 0; for (const t of I.techs) { const T = D.TECH[t]; if (T && T.key && T.era > I.era) I.era = T.era; }
    I.research = { cur: null, pts: 0 };
    const s = landFolk(st, I, hx, hy, r.int(9, 12), L('kam mit den Neuen aus dem Hinterland', 'came with the newcomers from the backcountry'));
    I.capital = s.id; I.goneAt = 0;
    indexMembers(st);
    chooseLeader(st, s, true);
    setTerritory(st);
    chron(st, 'gott', L(`Das Land der ${I.name} war still geworden. Nun ziehen Menschen aus dem Hinterland herab, sprechen dieselbe alte Sprache und gründen ${s.name}.`,
      `The land of the ${I.name} had fallen silent. Now people come down from the backcountry, speaking the same old tongue, and found ${s.name}.`), s.id, 2, { x: s.cx, y: s.cy });
    return;
  }
}

// ---------- Neue Völker ----------
// Ein Ort, der weit weg von der Hauptstadt seines Volkes liegt, lange besteht und sich entfremdet hat, wird ein eigenes
// Volk: eigene Sprache, eigenes Wissen (zunächst eine Abschrift), später eigene Staaten. Jährlich geprüft.
export function folkSplitStep(st) {
  if (!st.earth) return;
  const r = rng(st), rt = st._rt;
  if (st.isles.length >= 24) return;
  for (const s of st.settlements) {
    if (!s.alive || s.pop < 40 || st.day - s.founded < 120 * D.DAYS_PER_YEAR) continue;
    const I = rt.iById.get(s.isle);
    const cap = I && rt.sById.get(I.capital);
    if (!I || !cap || !cap.alive || cap === s) continue;
    const d = dist(s, cap);
    if (d < 180 && landOf(s) === landOf(cap)) continue;
    const rel = s.rel[cap.id] ?? 0;
    if (rel > 10 || !r.chance(0.12 + Math.min(0.2, (d - 180) / 1500))) continue;
    // das neue Volk: alle Orte dieses Volkes näher an s als an der alten Hauptstadt
    const used = new Set(st.isles.map(o => o.lang));
    const lang = [5, 6, 7, 8, 9, 10, 4, 3, 2, 1, 0].find(l => !used.has(l)) ?? ((I.lang + 3) % 11);
    const taken = new Set(st.isles.map(o => o.name));
    const J = {
      id: Math.max(...st.isles.map(o => o.id)) + 1, name: folkName(r, lang, taken), folk: 1, lang, cx: s.cx, cy: s.cy, rx: s.cx, ry: s.cy, area: 1e6,
      home: [s.cx, s.cy], player: 0, lands: { ...I.lands }, from: I.id, bit: I.bit ?? I.id - 1,
      techs: I.techs.slice(), prog: I.prog | 0, research: { cur: I.research.cur, pts: 0 }, era: I.era, contact: { ...I.contact, [I.id]: st.day }, seen: { ...I.seen, [I.id]: st.day },
      cur: I.cur ? { ...I.cur, n: placeName(r, lang) } : undefined, pl: I.pl, infl: 0, capital: s.id,
    };
    I.contact[J.id] = I.seen[J.id] = st.day;
    for (const o of st.isles) if (o.contact[I.id] && o !== I) { o.contact[J.id] = o.contact[I.id]; J.contact[o.id] = o.contact[I.id]; }
    st.isles.push(J); rt.iById.set(J.id, J); rt.isleKnown.set(J.id, new Set(J.techs));
    let moved = 0;
    for (const o of st.settlements) if (o.alive && o.isle === I.id && dist(o, s) < dist(o, cap)) { o.isle = J.id; o.lang = lang; moved++; }
    s.rel[cap.id] = cap.rel[s.id] = Math.min(rel, -20);
    chron(st, 'politik', L(`Weit weg von ${cap.name} haben die Menschen um ${s.name} eine eigene Sprache, eigene Lieder und eigene Götter. Sie nennen sich ${J.name}. ${moved > 1 ? moved + ' Orte' : 'Ein Ort'} sagen sich los: ein neues Volk ist entstanden.`,
      `Far from ${cap.name}, the people around ${s.name} have their own tongue, their own songs and their own gods. They call themselves the ${J.name}. ${moved > 1 ? moved + ' towns break' : 'One town breaks'} away: a new people is born.`), s.id, 2, { x: s.cx, y: s.cy });
    st.counts.folks = (st.counts.folks || 0) + 1;
    return;
  }
}
