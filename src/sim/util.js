// Gemeinsame Helfer der Simulation: Personen, Gebäude, Chronik, Abfragen.
import { DAYS_PER_YEAR, DAYS_PER_SEASON, SEASONS, BUILDINGS, TECH } from './data.js';
import { NX, NY, idx, inb } from './world.js';
import { personName, clanName } from './names.js';
import { clamp } from './rng.js';
import { L } from '../i18n.js';

export const yearOf = d => Math.floor(d / DAYS_PER_YEAR) + 1;
export const seasonOf = d => Math.floor((d % DAYS_PER_YEAR) / DAYS_PER_SEASON);
export const dateStr = d => L(`Jahr ${yearOf(d)}, ${SEASONS[seasonOf(d)]}`, `Year ${yearOf(d)}, ${SEASONS[seasonOf(d)]}`);
export const ageOf = (st, p) => (st.day - p.b) / DAYS_PER_YEAR;
// Wissen gehört einer Insel. Ohne Siedlung: irgendeine Insel weiß es
export const knows = (st, t, s) => {
  const rt = st._rt;
  if (s == null) return rt.anyKnown.has(t);
  const k = rt.isleKnown.get(typeof s === 'number' ? s : s.isle);
  return k ? k.has(t) : false;
};
export const isleOf = (st, s) => st._rt.iById.get(typeof s === 'number' ? s : s && s.isle);
// Landmasse einer Siedlung (seit 19.10.2026). In Inselwelten ist das die Insel selbst, in der Erde gehört das Wissen
// dem Volk (s.isle) und die Landmasse steht in s.land (rt.isleOf zeigt dort je Feld auf st.lands)
export const landOf = s => (s.land ?? s.isle);
// Datensatz einer Landmasse: Insel oder in der Erde Eintrag aus st.lands (area, cx, cy, Name)
export const landRec = (st, id) => (st.earth ? st._rt.lById.get(id) : st._rt.iById.get(id));
// Nachbarn über Land: gleiche Insel, in der Erde gleiche Landmasse und nicht zu weit (sonst trennt sie die halbe Welt)
export const sameLand = (st, a, b) => (st.earth ? landOf(a) === landOf(b) && Math.hypot(a.cx - b.cx, a.cy - b.cy) < 150 : a.isle === b.isle);
export const newId = st => st.nextId++;
export const rng = st => st._rt.rng;

export function chron(st, k, t, s = -1, imp = 0, extra) {
  const e = { d: st.day, k, t, s, imp };
  if (extra) Object.assign(e, extra);
  st.chronicle.push(e);
  if (st.chronicle.length > 900) {
    // zuerst unwichtige alte Einträge entfernen
    const cut = st.chronicle.findIndex(c => c.imp === 0);
    st.chronicle.splice(cut >= 0 ? cut : 0, 1);
  }
  st._rt.newChron.push(e);
  return e;
}

export function fx(st, o) { if (!st._rt.catchup) st._rt.fx.push(o); }

export function bio(p, d, t) {
  p.bio.push([d, t]);
  if (p.bio.length > 10) p.bio.splice(1, 1); // Geburt bleibt immer
}

// Titel: [deutsch männlich, deutsch weiblich, englisch männlich, englisch weiblich]
const TITLES = [
  ['Häuptling', 'Häuptling', 'Chieftain', 'Chieftain'],
  ['König', 'Königin', 'King', 'Queen'],
  ['Hohepriester', 'Hohepriesterin', 'High Priest', 'High Priestess'],
  ['Konsul', 'Konsulin', 'Consul', 'Consul'],
  ['Präsident', 'Präsidentin', 'President', 'President'],
  ['General', 'Generalin', 'General', 'General'],
  ['Sprecher', 'Sprecherin', 'Speaker', 'Speaker'],
  ['Kanzler', 'Kanzlerin', 'Chancellor', 'Chancellor'],
  ['Seher', 'Seherin', 'Seer', 'Seer'],
  ['Erfinder', 'Erfinderin', 'Inventor', 'Inventor'],
  ['Ältester', 'Älteste', 'Elder', 'Elder'],
  ['Prophet', 'Prophetin', 'Prophet', 'Prophetess'],
  ['Entdecker', 'Entdeckerin', 'Explorer', 'Explorer'],
  ['Fürst', 'Fürstin', 'Prince', 'Princess'],
  // Bürgermeister je Staatsform (seit 24.10.2026, states.js)
  ['Vorsteher', 'Vorsteherin', 'Headman', 'Headwoman'],
  ['Vogt', 'Vögtin', 'Reeve', 'Reeve'],
  ['Statthalter', 'Statthalterin', 'Governor', 'Governor'],
  ['Bürgermeister', 'Bürgermeisterin', 'Mayor', 'Mayor'],
  ['Gouverneur', 'Gouverneurin', 'Colonial Governor', 'Colonial Governor'],
  ['Abt', 'Äbtissin', 'Abbot', 'Abbess'],
  ['Kommandant', 'Kommandantin', 'Commandant', 'Commandant'],
  ['Stadtverwalter', 'Stadtverwalterin', 'City Administrator', 'City Administrator'],
];
// Man kann den Titel deutsch oder englisch übergeben, heraus kommt immer die Form der gewählten Sprache
const TITLE_BY_NAME = new Map();
for (const row of TITLES) { TITLE_BY_NAME.set(row[0], row); TITLE_BY_NAME.set(row[2], row); }
export const titleFor = (p, t) => {
  const row = TITLE_BY_NAME.get(t);
  if (!row) return t;
  return p.sex === 'f' ? L(row[1], row[3]) : L(row[0], row[2]);
};

export function setLeaderTitle(p, t) { p.title = titleFor(p, t); }

const TRAITS = ['mut', 'fleiss', 'glaube', 'neugier', 'wut', 'charisma', 'kunst'];

export function makePerson(st, s, { sex, b, mother = null, father = null, lang, clan, traits } = {}) {
  const r = rng(st);
  sex = sex || (r.chance(0.5) ? 'f' : 'm');
  const mo = mother ? st._rt.pById.get(mother) : null;
  const fa = father ? st._rt.pById.get(father) : null;
  const tr = {};
  for (const k of TRAITS) {
    let v;
    if (traits && traits[k] != null) v = traits[k];
    else if (mo && fa) v = (mo.tr[k] + fa.tr[k]) / 2 + r.gauss() * 0.25;
    else v = 0.5 + r.gauss() * 0.45;
    tr[k] = Math.round(clamp(v, 0.02, 0.98) * 100) / 100;
  }
  // Kinder heißen in der Muttersprache der Mutter (seit 20.10.2026, Herkunft und Sprache in peoples.js)
  const l = lang ?? (mo && mo.lg != null ? mo.lg : s.lang);
  const p = {
    id: newId(st), n: personName(r, l, sex), sex, b: b ?? st.day, s: s.id,
    clan: clan || (fa ? fa.clan : mo ? mo.clan : clanName(r, l)),
    mo: mother, fa: father, pa: null, kids: 0,
    job: 'kind', w: -1, home: -1, tr,
    faith: clamp(0.25 + tr.glaube * 0.35 + (s.cult.glaube - 0.5) * 0.3, 0, 1),
    hap: 0.6, hp: 1, sick: 0, hunger: 0, fac: 'volk', title: '', fame: 0, dream: null,
    bio: [], gold: 0, jy: (b ?? st.day) + 16 * DAYS_PER_YEAR, ties: {}, ori: r.chance(0.94) ? 0 : r.chance(0.6) ? 1 : 2,
  };
  st.people.push(p);
  st._rt.pById.set(p.id, p);
  // Herkunft, Muttersprache, Glaube, Einwanderergeneration (peoples.js personHook)
  if (st._rt.onPerson) st._rt.onPerson(st, s, p, mo, fa, lang);
  return p;
}

export function killPerson(st, p, cause) {
  const rt = st._rt;
  if (!rt.pById.has(p.id)) return;
  rt.pById.delete(p.id);
  p.dead = st.day; p.cause = cause;
  rt.deadToday.push(p);
  if (rt.onDeath) rt.onDeath(st, p); // Erbe, Witwen, Trauer der Freunde
  if (p.pa) { const q = rt.pById.get(p.pa); if (q) q.pa = null; }
  const s = rt.sById.get(p.s);
  if (s && s.gov.leader === p.id) s.gov.leader = null;
  // Berühmte Tote kommen in die Ahnenhalle
  if (p.fame >= 3 || p.title || p.lt) {
    st.ancestors.push({ n: p.n, clan: p.clan, sex: p.sex, b: p.b, d: st.day, title: p.lt || p.title, s: p.s, cause, bio: p.bio.slice(-6), fame: p.fame });
    st.ancestors.sort((a, b) => b.fame - a.fame);
    if (st.ancestors.length > 80) st.ancestors.length = 80;
  }
}

export function compactPeople(st) {
  if (!st._rt.deadToday.length) return;
  st.people = st.people.filter(p => !p.dead);
  st._rt.deadToday.length = 0;
}

// Gebäude einer Siedlung in der Reihenfolge von st.buildings, also genau wie st.buildings.filter(b => b.s === s.id),
// aber ohne jedes Mal alle Gebäude der Welt durchzugehen (seit 19.10.2026, die Erde hat bis zu 160 Orte). Neu
// aufgebaut wird der Index, wenn ein Gebäude dazukommt, verschwindet oder den Besitzer wechselt (rt.bVer).
// Die Liste nicht verändern (sortieren nur auf einer Kopie).
const NONE = Object.freeze([]);
export function bldOf(st, s) {
  const rt = st._rt;
  if (rt.bIdxArr !== st.buildings || rt.bIdxVer !== rt.bVer) {
    const m = new Map();
    for (const b of st.buildings) { let a = m.get(b.s); if (!a) m.set(b.s, a = []); a.push(b); }
    rt.bIdx = m; rt.bIdxArr = st.buildings; rt.bIdxVer = rt.bVer;
  }
  return rt.bIdx.get(typeof s === 'number' ? s : s.id) || NONE;
}
export const bumpBuildings = st => { st._rt.bVer = (st._rt.bVer || 0) + 1; };

export function addBuilding(st, s, type, x, y, done = false) {
  const def = BUILDINGS[type];
  const b = { id: newId(st), t: type, s: s.id, x, y, prog: done ? 1 : 0, hp: 1, lvl: s.era ?? st.era, d: st.day };
  st.buildings.push(b);
  bumpBuildings(st);
  st._rt.bById.set(b.id, b);
  st._rt.bldAt[idx(x, y)] = b.id;
  st.tiles.ruin[idx(x, y)] = 0;
  const tr = st.tiles.tree[idx(x, y)];
  if (tr) { s.stock.wood += tr * 2; st.tiles.tree[idx(x, y)] = 0; }
  // Rodung rund um neue Bauten, beim Zentrum eine Lichtung
  const rr = type === 'zentrum' ? 3 : type === 'feld' ? 0 : 1;
  for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
    const xx = x + dx, yy = y + dy;
    if (!inb(xx, yy) || Math.hypot(dx, dy) > rr + 0.3) continue;
    const j = idx(xx, yy);
    if (st.tiles.tree[j]) { s.stock.wood += 1; st.tiles.tree[j] = type === 'zentrum' ? 0 : Math.max(0, st.tiles.tree[j] - 1); }
  }
  st._rt.dirtyT = true;
  st._rt.dirtyB = true;
  if (def.unique) s.has[type] = true;
  return b;
}

export function removeBuilding(st, b, ruin = true) {
  const rt = st._rt;
  if (!rt.bById.has(b.id)) return;
  rt.bById.delete(b.id);
  rt.bldAt[idx(b.x, b.y)] = 0;
  if (ruin) { st.tiles.ruin[idx(b.x, b.y)] = 40; if (rt.ruins) rt.ruins.add(idx(b.x, b.y)); }
  st.buildings = st.buildings.filter(q => q.id !== b.id);
  for (const p of st.people) { if (p.home === b.id) p.home = -1; if (p.w === b.id) p.w = -1; }
  const s = rt.sById.get(b.s);
  if (s && BUILDINGS[b.t].unique) s.has[b.t] = false;
  if (s && s.center === b.id) {
    // Zentrum zerstört: sofort neu errichten, eine Siedlung braucht ihr Herz
    const nb = addBuilding(st, s, 'zentrum', b.x, b.y, false);
    s.center = nb.id; nb.prog = 0.2;
  }
  rt.dirtyB = true;
}

export function homeCap(st, b) {
  const def = BUILDINGS[b.t];
  if (!def.home) return 0;
  if (b.prog < 1) return b.old != null ? def.home[b.old] : 0;
  // Fortschritt (progress.js): moderne Häuser fassen mehr (Wolkenkratzer, Städte im Meer)
  if (b.lvl >= 6 && st._rt.homeMul) { const m = st._rt.homeMul.get(b.s); if (m > 1) return Math.round(def.home[b.lvl] * m); }
  return def.home[b.lvl];
}

export function settlementRadius(pop) { return clamp(3.6 + Math.sqrt(pop) * 0.8, 4, 15); }

export function distTo(s, x, y) { return Math.hypot(s.cx - x, s.cy - y); }

export function nearestSettlement(st, x, y, maxD = 99) {
  let best = null, bd = maxD;
  for (const s of st.settlements) {
    if (!s.alive) continue;
    const d = distTo(s, x, y) - s.R * 0.5;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

export function shiftCult(s, k, v) { s.cult[k] = clamp(s.cult[k] + v, 0.03, 0.97); }

export function members(st, s) { return st._rt.bySet.get(s.id) || { all: [], adults: [], kids: [], old: [] }; }

// Seit 19.10.2026 ohne Schleife über alle Felder: nur die zuletzt besetzten Felder werden geleert (rt.ownTiles),
// das Feld der besten Abstände bleibt im Speicher (für die Erde mit 2 Millionen Feldern sonst Millisekunden je Tag)
export function setTerritory(st) {
  const rt = st._rt, own = rt.owner, n = NX * NY;
  if (!rt.ownBest || rt.ownBest.length !== n) { rt.ownBest = new Float32Array(n).fill(1e9); rt.ownTiles = null; own.fill(0); }
  const best = rt.ownBest;
  if (rt.ownTiles) for (const i of rt.ownTiles) { own[i] = 0; best[i] = 1e9; }
  else own.fill(0);
  const touched = [];
  for (const s of st.settlements) {
    if (!s.alive) continue;
    const R = s.R + 1.5;
    for (let y = Math.max(0, Math.floor(s.cy - R)); y <= Math.min(NY - 1, Math.ceil(s.cy + R)); y++)
      for (let x = Math.max(0, Math.floor(s.cx - R)); x <= Math.min(NX - 1, Math.ceil(s.cx + R)); x++) {
        const d = Math.hypot(x - s.cx, y - s.cy);
        if (d > R) continue;
        const i = idx(x, y), nd = d / R;
        if (best[i] === 1e9) touched.push(i);
        if (nd < best[i]) { best[i] = nd; own[i] = s.id; }
      }
  }
  // Gebäude gehören immer ihrer Siedlung
  for (const b of st.buildings) { const i = idx(b.x, b.y); if (!own[i] && best[i] === 1e9) { best[i] = 2; touched.push(i); } own[i] = b.s; }
  rt.ownTiles = touched;
}


export function personLabel(p) { const t = p.lt || p.title; return t ? `${t} ${p.n}` : p.n; }
