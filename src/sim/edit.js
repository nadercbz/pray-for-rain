// Baukasten (seit 20.10.2026, Naders Wunsch: eigene Karten bauen, Häuser selbst setzen, eigene Level gestalten).
// Reine Simulationsseite ohne DOM: Gelände formen, Natur malen, Gebäude und Straßen setzen, Siedlungen gründen,
// Inseln nach dem Formen neu erkennen, Level aus Vorlagen anlegen, Level prüfen. Die Oberfläche steht in src/ui/editor.js.
// Ein Level ist ein gewöhnlicher Spielstand mit st.level = { id, name, desc, kind, created } (serialize/deserialize).
import { NX, NY, idx, inb, D4, components, MIN_ISLE, setWorldSize, generateWorld } from './world.js';
import * as D from './data.js';
import { MAP } from './data.js';
import { hydrate, refreshCoast, newSettlement, findSite, indexMembers } from './core.js';
import { addBuilding, removeBuilding, makePerson, setTerritory, bio, rng, members } from './util.js';
import { chooseLeader } from './society.js';
import { initMoney } from './money.js';
import { initSocial } from './social.js';
import { initDiaries } from './diary.js';
import { BUILT, MANUAL, SQUARE } from './cityplan.js';
import { placeName, LANGS } from './names.js';
import { Rng, clamp } from './rng.js';
import * as LAB from './lab.js';
import { L } from '../i18n.js';

// ---------- Level anlegen ----------

// Vorlagen: eine Insel in der Mitte, ein leeres Meer oder ein zufälliger Archipel mit Festland (ohne Menschen)
export const KINDS = {
  insel: { name: L('Eine Insel', 'One island'), info: L('Eine runde Insel mitten im Meer, Hügel, Wald und Strand', 'A round island in the middle of the sea, hills, forest and beach') },
  leer: { name: L('Leeres Meer', 'Empty sea'), info: L('Nur Wasser. Du formst jedes Stück Land selbst', 'Only water. You shape every piece of land yourself') },
  archipel: { name: L('Zufallswelt', 'Random world'), info: L('Archipel und Festland wie im Spiel, aber ohne Menschen', 'Archipelago and mainland like in the game, but without people') },
};

function noise(seed) {
  const r = new Rng(seed);
  const P = Array.from({ length: 512 }, () => r.next());
  const at = (x, y) => P[((x * 73856093) ^ (y * 19349663)) & 511];
  const sm = t => t * t * (3 - 2 * t);
  const n = (x, y) => { const X = Math.floor(x), Y = Math.floor(y), fx = sm(x - X), fy = sm(y - Y); return (at(X, Y) * (1 - fx) + at(X + 1, Y) * fx) * (1 - fy) + (at(X, Y + 1) * (1 - fx) + at(X + 1, Y + 1) * fx) * fy; };
  return (x, y) => n(x, y) * 0.55 + n(x * 2.1, y * 2.1) * 0.3 + n(x * 4.3, y * 4.3) * 0.15;
}

function emptyTiles() {
  const n = NX * NY, T = {};
  T.h = new Int8Array(n).fill(-2);
  for (const k of ['tree', 'fert', 'ore', 'road', 'burn', 'ruin', 'bio', 'river', 'seen', 'reg', 'st']) T[k] = new Uint8Array(n);
  return T;
}

export function newLevel(kind = 'insel', seed = 1, name = '') {
  setWorldSize(MAP, MAP);
  let T, isles = [], extra = { volcanoes: [], lakes: [], rivers: [] }, regions = [];
  if (kind === 'archipel') {
    const W = generateWorld(seed);
    T = { h: W.h, tree: W.tree, fert: W.fert, ore: W.ore, road: W.road, burn: W.burn, ruin: W.ruin, bio: W.bio, river: W.river, seen: W.seen, reg: W.reg, st: new Uint8Array(NX * NY) };
    isles = W.isles; extra = W.extra; regions = W.regions;
  } else {
    T = emptyTiles();
    if (kind === 'insel') {
      const nz = noise(seed), cx = NX / 2, cy = NY / 2, R = 26;
      for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
        const d = Math.hypot(x - cx, y - cy) / R;
        if (d > 1.6) continue;
        const e = 1.15 - d * 1.1 + (nz(x * 0.09, y * 0.09) - 0.5) * 0.7;
        const i = idx(x, y);
        T.h[i] = e < -0.15 ? -2 : e < 0 ? -1 : e < 0.12 ? 0 : e < 0.55 ? 1 : e < 0.8 ? 2 : e < 0.98 ? 3 : 4;
        if (T.h[i] >= 1 && T.h[i] <= 3) {
          const m = nz(x * 0.07 + 40, y * 0.07 + 40);
          if (m > 0.55) T.tree[i] = m > 0.66 ? 3 : m > 0.6 ? 2 : 1;
          T.fert[i] = clamp(Math.round((T.h[i] === 1 ? 58 : 42) + m * 30), 0, 100);
        } else if (T.h[i] === 0) T.fert[i] = 12;
        if (T.h[i] >= 3 && nz(x * 0.15 + 9, y * 0.15 + 3) > 0.58) T.ore[i] = 120;
      }
    }
  }
  const st = {
    v: D.WORLD_VERSION, seed, rng: Math.imul(seed, 2654435761) >>> 0, day: 0, acc: 0, savedAt: 0, nextId: 1,
    tiles: T, isles, voyages: [], trade: [], regions, volc: extra.volcanoes, lakes: extra.lakes, rivers: extra.rivers, grown: 1,
    people: [], buildings: [], settlements: [], era: 0,
    weather: { kind: 'klar', until: 0, god: null, moist: 0.55, temp: 14 },
    effects: [], mana: 100, prayers: [], chronicle: [], myths: [], ancestors: [], stats: [], sites: [], godLog: [],
    flags: {}, lastGod: 0, counts: { births: 0, deaths: 0, powers: 0, answered: 0 },
    finds: kind === 'archipel' ? undefined : [], nwFinds: kind === 'archipel' ? undefined : 1,
    level: { id: 'lv' + Date.now().toString(36), name: name || L('Mein Level', 'My level'), desc: '', kind, created: Date.now() },
  };
  if (kind !== 'archipel') syncIslesRaw(st);
  hydrate(st);
  if (kind !== 'archipel') syncIsles(st);
  for (let i = 0; i < NX * NY; i++) T.seen[i] = 255; // im Baukasten ist alles bekannt (die Karte M zeigt alles)
  st.exploreV = 1;
  return st;
}

// ---------- Inseln nach dem Formen neu erkennen ----------

function isleRecord(st, c, used) {
  const r = rng(st);
  let n = '';
  for (let k = 0; k < 20 && (!n || used.has(n)); k++) n = placeName(r, r.int(0, 3));
  used.add(n);
  const id = Math.max(0, ...st.isles.map(I => I.id)) + 1;
  return { id, name: n, cx: c.cx, cy: c.cy, rx: c.rx, ry: c.ry, area: c.area, techs: [], research: { cur: 'feuer', pts: 0 }, era: 0, contact: {}, seen: {} };
}

// vor hydrate: ohne Laufzeitdaten
function syncIslesRaw(st) {
  const used = new Set(st.isles.map(I => I.name));
  for (const c of components(st.tiles.h).list) if (c.area >= MIN_ISLE) st.isles.push(isleRecord(st._rt ? st : { ...st, _rt: { rng: new Rng(st.seed) } }, c, used));
}

// Landmassen neu bestimmen: vorhandene Inseln behalten ihre id (über ihr Land), neue Landmassen werden neue Inseln
export function syncIsles(st) {
  const rt = st._rt, h = st.tiles.h, { comp, list } = components(h);
  const used = new Set(st.isles.map(I => I.name)), taken = new Set();
  for (const I of st.isles) {
    let c = -1;
    for (const [x, y] of [[I.rx, I.ry], [I.cx, I.cy]]) if (inb(x, y) && comp[idx(x, y)] >= 0) { c = comp[idx(x, y)]; break; }
    // Land der Insel bewegt? die Siedlungen der Insel zeigen, wo sie jetzt liegt
    if (c < 0 || taken.has(c)) { const s = st.settlements.find(o => o.alive && o.isle === I.id && comp[idx(o.cx, o.cy)] >= 0 && !taken.has(comp[idx(o.cx, o.cy)])); if (s) c = comp[idx(s.cx, s.cy)]; }
    if (c < 0 || taken.has(c)) { I.area = 0; continue; }
    taken.add(c);
    const L0 = list[c];
    Object.assign(I, { cx: L0.cx, cy: L0.cy, rx: L0.rx, ry: L0.ry, area: L0.area });
  }
  for (const c of list) {
    if (c.area < MIN_ISLE || taken.has(c.id)) continue;
    const I = isleRecord(st, c, used);
    st.isles.push(I);
    rt.iById.set(I.id, I);
    rt.isleKnown.set(I.id, new Set());
  }
  refreshCoast(st);
  for (const s of st.settlements) if (s.alive && !st.earth) { const k = rt.isleOf[idx(s.cx, s.cy)]; if (k) s.isle = k; }
}

// ---------- Pinsel ----------

// Werkzeuge, die die Höhe ändern, brauchen danach afterTerrain (Küste, Inseln, Bild neu)
export const HEIGHT_OPS = new Set(['raise', 'lower', 'smooth', 'flatten', 'land', 'sea']);

// Kacheln im Kreis um (cx, cy) mit Radius r; op wirkt einmal je Aufruf (die Oberfläche ruft je Schritt des Strichs)
// once: Set der Kacheln, die in diesem Strich schon gehoben oder gesenkt wurden (ein Strich hebt jede Kachel nur einmal)
export function brush(st, op, cx, cy, r, val, once = null) {
  const T = st.tiles, rt = st._rt, out = [];
  const R = Math.max(0.5, r);
  for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
    if (!inb(x, y) || x < 1 || y < 1 || x > NX - 2 || y > NY - 2) continue;
    const d = Math.hypot(x - cx, y - cy);
    if (d > R) continue;
    if (once && (op === 'raise' || op === 'lower') && once.has(idx(x, y))) continue;
    out.push([idx(x, y), d / R]);
  }
  const H = T.h, old = op === 'smooth' ? Int8Array.from(H) : null;
  let changed = 0;
  for (const [i, f] of out) {
    const h0 = H[i];
    switch (op) {
      case 'raise': if (h0 < 9 && (f < 0.75 || (i + st.day) % 2)) { H[i] = h0 < -1 ? -1 : h0 + 1; changed++; } break;
      case 'lower': if (h0 > -3 && (f < 0.75 || (i + st.day) % 2)) { H[i] = h0 > 1 ? h0 - 1 : h0 === 1 ? 0 : h0 === 0 ? -1 : h0 - 1; changed++; } break;
      case 'flatten': if (h0 !== val) { H[i] = val; changed++; } break;
      case 'land': if (h0 < 1) { H[i] = 1; changed++; } break;
      case 'sea': if (h0 >= 0) { H[i] = -2; changed++; } break;
      case 'smooth': {
        const x = i % NX, y = (i / NX) | 0;
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inb(x + dx, y + dy)) { s += old[idx(x + dx, y + dy)]; n++; }
        const v = Math.round(s / n);
        if (v !== h0) { H[i] = v; changed++; }
        break;
      }
      case 'forest': if (H[i] >= 1 && H[i] <= 4 && !rt.bldAt[i] && T.tree[i] < 3) { T.tree[i]++; changed++; } break;
      case 'clear': if (T.tree[i]) { T.tree[i] = 0; changed++; } break;
      case 'biome': if (H[i] >= 0 && T.bio[i] !== val) { T.bio[i] = val; T.fert[i] = Math.round((D.BIOMES[val] || D.BIOMES[0]).fert * (H[i] === 1 ? 1 : 0.75)); changed++; } break;
      case 'fert': if (H[i] >= 0) { T.fert[i] = Math.min(100, T.fert[i] + 12); changed++; } break;
      case 'ore': if (H[i] >= 0) { T.ore[i] = Math.min(250, T.ore[i] + 50); changed++; } break;
      default: break;
    }
  }
  if (!changed) return 0;
  if (once && (op === 'raise' || op === 'lower')) for (const [i] of out) once.add(i);
  // Wasser trägt keine Bäume, Felder, Erz, Wege; neues Land bekommt Gras und etwas Fruchtbarkeit
  if (HEIGHT_OPS.has(op)) for (const [i] of out) {
    if (H[i] < 0) { T.tree[i] = 0; T.fert[i] = 0; T.river[i] = 0; T.st[i] = 0; T.road[i] = 0; }
    else if (H[i] > 4 || H[i] === 0) T.tree[i] = 0; // über der Baumgrenze und am Strand keine Bäume
    else if (!T.fert[i] && H[i] >= 1) T.fert[i] = H[i] === 1 ? 55 : 40;
  }
  rt.dirtyT = true;
  return changed;
}

// Kasten der geänderten Kacheln für das Bild (main.js baut dann nur dort Gelände und Wasser neu)
export function growBox(st, box) {
  const rt = st._rt, b = rt.dirtyBox;
  rt.dirtyBox = b ? [Math.min(b[0], box[0]), Math.max(b[1], box[1]), Math.min(b[2], box[2]), Math.max(b[3], box[3])] : box.slice();
}

// Nach einem Strich, der Höhen geändert hat: Gebäude im Wasser weg, Küste und Inseln neu, Bild baut das Gelände neu
// (mit box nur dort, sonst ganz)
export function afterTerrain(st, box) {
  const rt = st._rt, H = st.tiles.h;
  for (const b of st.buildings.slice()) if (H[idx(b.x, b.y)] < 0 && b.t !== 'zentrum') removeBuilding(st, b, false);
  syncIsles(st);
  setTerritory(st);
  rt.blocks && rt.blocks.clear();
  if (box) growBox(st, box); else rt.dirtyH = true;
  rt.dirtyT = true; rt.dirtyB = true;
}

// Fluss als Strich: Kacheln in Reihenfolge (die Oberfläche sammelt sie), auf Land, ohne Gebäude
export function addRiver(st, path) {
  const T = st.tiles, rt = st._rt, P = [];
  for (const i of path) {
    if (P.length && P[P.length - 1] === i) continue;
    if (T.h[i] < 0) { P.push(i); break; } // mündet ins Wasser
    if (rt.bldAt[i]) continue;
    P.push(i);
  }
  if (P.length < 3) return false;
  for (const i of P) if (T.h[i] >= 0) { T.river[i] = 1; T.tree[i] = 0; T.st[i] = 0; }
  st.rivers = st.rivers || [];
  st.rivers.push(P);
  let x0 = NX, x1 = 0, y0 = NY, y1 = 0;
  for (const i of P) { const x = i % NX, y = (i / NX) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  growBox(st, [x0 - 1, x1 + 1, y0 - 1, y1 + 1]);
  rt.dirtyT = true;
  return true;
}
export function removeRiverAt(st, x, y, r = 1) {
  const T = st.tiles, rt = st._rt, hit = new Set();
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (inb(x + dx, y + dy)) hit.add(idx(x + dx, y + dy));
  const before = (st.rivers || []).length;
  st.rivers = (st.rivers || []).filter(P => !P.some(i => hit.has(i)));
  if (st.rivers.length === before) return false;
  T.river.fill(0);
  for (const P of st.rivers) for (const i of P) if (T.h[i] >= 0) T.river[i] = 1;
  rt.dirtyH = true; rt.dirtyT = true;
  return true;
}

// ---------- Siedlungen, Gebäude, Straßen ----------

export function settlementNear(st, x, y, extra = 8) {
  let best = null, bd = 1e9;
  for (const s of st.settlements) { if (!s.alive) continue; const d = Math.hypot(s.cx - x, s.cy - y); if (d < (s.R || 4) + extra && d < bd) { bd = d; best = s; } }
  return best;
}

// Wissen bis zur gewünschten Epoche (alle Techniken früherer Epochen und die Schlüssel bis dorthin)
function teachUpTo(st, I, era) {
  const rt = st._rt;
  for (const t of D.TECHS) {
    if (t.era >= era && !(t.key && t.key <= era)) continue;
    if (I.techs.includes(t.id)) continue;
    I.techs.push(t.id); rt.isleKnown.get(I.id).add(t.id); rt.anyKnown.add(t.id);
  }
  I.era = Math.max(I.era, era);
  st.era = Math.max(st.era, I.era);
  for (const s of st.settlements) if (s.isle === I.id) s.era = I.era;
}

// Siedlung gründen: { name, lang, n (Menschen), era, form, og, rl }. Gibt { s } oder { err } zurück.
export function foundTown(st, x, y, o = {}) {
  const rt = st._rt, T = st.tiles, HB = rt.hb || T.h;
  if (!inb(x, y) || HB[idx(x, y)] < 1 || HB[idx(x, y)] > 3) return { err: L('Hier kann niemand siedeln: Wasser, Strand oder Fels.', 'Nobody can settle here: water, beach or rock.') };
  if (rt.bldAt[idx(x, y)]) return { err: L('Hier steht schon etwas.', 'Something already stands here.') };
  const near = st.settlements.find(s => s.alive && Math.hypot(s.cx - x, s.cy - y) < 9);
  if (near) return { err: L(`Zu nah an ${near.name}. Mindestens 9 Felder Abstand.`, `Too close to ${near.name}. Keep at least 9 tiles apart.`) };
  const isle = rt.isleOf[idx(x, y)];
  if (!isle) return { err: L('Dieses Land ist zu klein für eine Siedlung (mindestens 70 Felder).', 'This land is too small for a settlement (at least 70 tiles).') };
  const r = rng(st);
  const lang = o.lang ?? r.int(0, Math.min(3, LANGS.length - 1));
  const C = {};
  for (const k of Object.keys(D.CULTURE)) C[k] = clamp((o.cult && o.cult[k] != null ? o.cult[k] : 0.42) + r.gauss() * 0.12, 0.08, 0.9);
  if (o.form) rt.nextForm = o.form;
  const s = newSettlement(st, x, y, lang, C, o.name || undefined);
  rt.nextForm = null;
  const I = rt.iById.get(s.isle);
  if (I && o.era) teachUpTo(st, I, o.era);
  if (I && !I.research.cur) I.research.cur = 'feuer';
  s.era = I ? I.era : 0;
  addPeople(st, s, Math.max(2, o.n || 12), o);
  for (let k = 0; k < Math.ceil((o.n || 12) / 4); k++) {
    const site = findSite(st, s, 'haus');
    if (site) { const b = addBuilding(st, s, 'haus', site[0], site[1], true); b.lvl = s.era; }
  }
  indexMembers(st);
  chooseLeader(st, s, true);
  setTerritory(st);
  // Was die Menschen kennen: das Land um den Ort
  for (let yy = y - 14; yy <= y + 14; yy++) for (let xx = x - 14; xx <= x + 14; xx++) if (inb(xx, yy)) T.seen[idx(xx, yy)] = 255;
  rt.dirtyB = true; rt.dirtyT = true;
  return { s };
}

// Menschen in eine Siedlung setzen: Paare und Kinder (über lab.settleGroup, wenn die Gesellschaftsschicht da ist)
export function addPeople(st, s, n, o = {}) {
  const first = !st.people.length;
  let made;
  if (typeof LAB.settleGroup === 'function') made = LAB.settleGroup(st, s, n, { og: o.og, rl: o.rl, cls: o.cls, mg: o.mg, lang: o.lang ?? s.lang });
  if (!made || !made.length) {
    const r = rng(st);
    made = [];
    const pairs = Math.floor(n / 2.4);
    for (let i = 0; i < pairs; i++) {
      const f = makePerson(st, s, { sex: 'f', b: st.day - r.int(17, 31) * D.DAYS_PER_YEAR });
      const m = makePerson(st, s, { sex: 'm', b: st.day - r.int(18, 33) * D.DAYS_PER_YEAR });
      f.pa = m.id; m.pa = f.id; made.push(f, m);
    }
    while (made.length < n) {
      const mo = made.find(p => p.sex === 'f');
      const k = makePerson(st, s, { b: st.day - r.int(3, 12) * D.DAYS_PER_YEAR, mother: mo ? mo.id : null, father: mo ? mo.pa : null });
      if (mo) { mo.kids++; const fa = st._rt.pById.get(mo.pa); if (fa) fa.kids++; }
      made.push(k);
    }
    for (const p of made) { if (!p.bio.length) bio(p, st.day, L('wurde vom Geist hierher gesetzt', 'was placed here by the spirit')); p.fame = 1; }
  }
  indexMembers(st);
  if (first) { initMoney(st); initSocial(st); initDiaries(st); }
  return made;
}

// Gebäude setzen (fertig gebaut). Ohne Siedlung in der Nähe geht es nicht, Zentrum nur über foundTown.
export function placeBuilding(st, type, x, y, lvl) {
  const rt = st._rt, T = st.tiles, i = idx(x, y);
  if (!inb(x, y) || T.h[i] < 0) return { err: L('Nicht im Wasser.', 'Not in the water.') };
  if (rt.bldAt[i]) return { err: L('Hier steht schon etwas.', 'Something already stands here.') };
  if (type === 'zentrum') return { err: L('Ein Zentrum entsteht mit einer neuen Siedlung.', 'A center comes with a new settlement.') };
  const s = settlementNear(st, x, y);
  if (!s) return { err: L('Gründe zuerst eine Siedlung in der Nähe.', 'Found a settlement nearby first.') };
  if (T.st[i] && !(T.st[i] & SQUARE)) T.st[i] = 0; // auf eine Straße gesetzt: die Straße weicht
  const b = addBuilding(st, s, type, x, y, true);
  b.lvl = lvl ?? s.era;
  b.ed = 1; // von Hand gesetzt
  if (s.plan) { s.plan.bv++; rt.blocks && rt.blocks.delete(s.id); }
  return { b, s };
}

export function removeAt(st, x, y) {
  const rt = st._rt, id = rt.bldAt[idx(x, y)];
  if (!id) return false;
  const b = rt.bById.get(id);
  if (!b) return false;
  if (b.t === 'zentrum') return removeTown(st, rt.sById.get(b.s));
  removeBuilding(st, b, false);
  const s = rt.sById.get(b.s);
  if (s && s.plan) s.plan.bv++;
  return true;
}

// Siedlung ganz entfernen: Gebäude, Menschen, Straßen des Plans (von Hand gesetzte bleiben)
export function removeTown(st, s) {
  if (!s) return false;
  const rt = st._rt, S = st.tiles.st;
  for (const b of st.buildings.filter(o => o.s === s.id)) { rt.bById.delete(b.id); rt.bldAt[idx(b.x, b.y)] = 0; }
  st.buildings = st.buildings.filter(o => o.s !== s.id);
  for (const p of members(st, s).all) rt.pById.delete(p.id);
  st.people = st.people.filter(p => p.s !== s.id);
  if (s.plan) {
    const e = Math.ceil(s.plan.ext + 1);
    for (let y = s.cy - e; y <= s.cy + e; y++) for (let x = s.cx - e; x <= s.cx + e; x++) if (inb(x, y) && !(S[idx(x, y)] & MANUAL) && Math.hypot(x - s.cx, y - s.cy) <= e) S[idx(x, y)] = 0;
  }
  s.alive = false; s.pop = 0;
  st.settlements = st.settlements.filter(o => o !== s);
  rt.sById.delete(s.id);
  indexMembers(st);
  setTerritory(st);
  rt.dirtyB = true; rt.dirtyT = true;
  return true;
}

// Straße von Hand: Klasse 1 Gasse, 2 Straße, 3 Hauptstraße, 'platz', 0 entfernt. Gilt sofort als gebaut.
export function paintStreet(st, x, y, cls) {
  const rt = st._rt, T = st.tiles, i = idx(x, y);
  if (!inb(x, y) || T.h[i] < 0 || T.river[i]) return false;
  const b = rt.bldAt[i] && rt.bById.get(rt.bldAt[i]);
  if (cls && b && b.t !== 'feld') return false;
  if (cls && b) removeBuilding(st, b, false);
  const v = !cls ? 0 : cls === 'platz' ? (SQUARE | BUILT | MANUAL) : (cls | BUILT | MANUAL);
  if (T.st[i] === v) return false;
  T.st[i] = v;
  if (cls) T.tree[i] = 0;
  const s = settlementNear(st, x, y, 14);
  if (s && s.plan) { s.plan.bv++; rt.blocks && rt.blocks.delete(s.id); }
  rt.dirtyT = true;
  return true;
}

// Drehen: von Hand gesetzte Ausrichtung (buildings.facing liest b.rot zuerst)
export function rotateAt(st, x, y) {
  const rt = st._rt, id = rt.bldAt[idx(x, y)], b = id && rt.bById.get(id);
  if (!b) return null;
  b.rot = ((b.rot ?? 0) + Math.PI / 2) % (Math.PI * 2);
  return b;
}

// ---------- Prüfen vor dem Spielen ----------

export function checkLevel(st) {
  const out = [];
  const alive = st.settlements.filter(s => s.alive);
  if (!alive.length) out.push(L('Es gibt noch keine Siedlung. Ohne Menschen passiert nichts.', 'There is no settlement yet. Without people nothing happens.'));
  for (const s of alive) if (!members(st, s).all.length) out.push(L(`${s.name} hat keine Menschen.`, `${s.name} has no people.`));
  const land = st.tiles.h.reduce((a, v) => a + (v >= 1 ? 1 : 0), 0);
  if (land < 200) out.push(L('Sehr wenig Land. Die Menschen werden kaum wachsen.', 'Very little land. The people will hardly grow.'));
  for (const s of alive) {
    let food = 0;
    for (let y = s.cy - 8; y <= s.cy + 8; y++) for (let x = s.cx - 8; x <= s.cx + 8; x++) if (inb(x, y) && st.tiles.fert[idx(x, y)] >= 32 && st.tiles.h[idx(x, y)] >= 1 && st.tiles.h[idx(x, y)] <= 2) food++;
    if (food < 12) out.push(L(`Um ${s.name} gibt es kaum fruchtbaren Boden.`, `There is hardly any fertile soil around ${s.name}.`));
  }
  return out;
}

// Für die Liste der Level: kurze Angaben
export function levelInfo(st) {
  return { id: st.level.id, name: st.level.name, kind: st.level.kind, towns: st.settlements.filter(s => s.alive).length, people: st.people.length, year: Math.floor(st.day / D.DAYS_PER_YEAR) + 1, updated: Date.now() };
}
