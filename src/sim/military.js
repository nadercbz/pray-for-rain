// Militär (seit 24.10.2026, Naders Auftrag "umfassendes Kriegssystem"): Verteidigungsminister, Ränge, Truppen je
// Epoche, Mauern um die Orte, Heere, die über Straßen und Wege marschieren, Feldschlachten, Belagerungen,
// Seeschlachten mit Admiral, Hilfsheere der Verbündeten, Verteidigungs-, Militär- und Nichtangriffsbündnisse.
// Ersetzt die alte Schlachtformel (society.js battle): Kriege werden in diplomacy.js erklärt, hier ausgefochten und
// in society.js beendet (warCheck, endWar, conquer). Deterministisch, Zufall nur über rng(st).
// Heere stehen in st.armies, Schlachten im Kriegsbuch st.milLog, je Ort s.mil (Ämter, Lage) und s.wall (Mauer).
import * as D from './data.js';
import { clamp } from './rng.js';
import { NX, NY, idx, inb, findPath } from './world.js';
import { chron, rng, knows, fx, members, sameLand, bldOf, bio, killPerson, ageOf, isleOf } from './util.js';
import { leaderOf, label, warCheck, endWar, CAUSE_WAR } from './society.js';
import { addSite } from './sites.js';
import { L } from '../i18n.js';

const YEAR = D.DAYS_PER_YEAR;
const hash01 = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// ---------- Truppen ----------

// Kampfkraft je Soldat nach Epoche (Ausrüstung, Ausbildung): ein Heer der Moderne ist einem der Bronzezeit weit überlegen
export const ERA_POW = [1, 1.15, 1.6, 2.0, 2.6, 3.6, 5.2, 7.5];
// Waffengattungen je Epoche in der Reihenfolge Nahkampf, Fernkampf, beritten oder Fahrzeug, Belagerung, mit Anteilen
export const ARMS = [
  { u: ['keule', 'speerwurf', null, null], sh: [0.7, 0.3, 0, 0] },
  { u: ['keule', 'speerwurf', null, null], sh: [0.62, 0.38, 0, 0] },
  { u: ['speer', 'bogen', 'streitwagen', null], sh: [0.5, 0.3, 0.2, 0] },
  { u: ['hoplit', 'schleuder', 'reiter', 'rammbock'], sh: [0.5, 0.2, 0.18, 0.12] },
  { u: ['schwert', 'armbrust', 'ritter', 'trebuchet'], sh: [0.42, 0.26, 0.2, 0.12] },
  { u: ['pike', 'muskete', 'kavallerie', 'kanone'], sh: [0.28, 0.42, 0.15, 0.15] },
  { u: ['gewehr', 'mg', 'panzerwagen', 'artillerie'], sh: [0.5, 0.2, 0.12, 0.18] },
  { u: ['soldat', 'rakete', 'panzer', 'heli'], sh: [0.45, 0.15, 0.25, 0.15] },
];
// Rolle: 0 Nahkampf, 1 Fernkampf, 2 beritten oder Fahrzeug, 3 Belagerung. Kraft im Feld und gegen Mauern
export const ROLE = [{ field: 1, wall: 0.15 }, { field: 0.9, wall: 0.1 }, { field: 1.6, wall: 0.12 }, { field: 0.7, wall: 2.6 }];
// crew: so viele Soldaten teilen sich ein Fahrzeug oder Geschütz (das Bild zeichnet je Gruppe eins)
export const UNITS = {
  keule: { n: L('Keulenkrieger', 'Club warriors'), r: 0 },
  speerwurf: { n: L('Speerwerfer', 'Javelin throwers'), r: 1 },
  speer: { n: L('Speerträger', 'Spearmen'), r: 0 },
  bogen: { n: L('Bogenschützen', 'Archers'), r: 1 },
  streitwagen: { n: L('Streitwagen', 'Chariots'), r: 2, crew: 2 },
  hoplit: { n: L('Hopliten', 'Hoplites'), r: 0 },
  schleuder: { n: L('Schleuderer', 'Slingers'), r: 1 },
  reiter: { n: L('Reiter', 'Horsemen'), r: 2, crew: 1 },
  rammbock: { n: L('Rammböcke', 'Battering rams'), r: 3, crew: 4 },
  schwert: { n: L('Schwertkämpfer', 'Swordsmen'), r: 0 },
  armbrust: { n: L('Armbrustschützen', 'Crossbowmen'), r: 1 },
  ritter: { n: L('Ritter', 'Knights'), r: 2, crew: 1 },
  trebuchet: { n: L('Tribok', 'Trebuchets'), r: 3, crew: 3 },
  pike: { n: L('Pikeniere', 'Pikemen'), r: 0 },
  muskete: { n: L('Musketiere', 'Musketeers'), r: 1 },
  kavallerie: { n: L('Kavallerie', 'Cavalry'), r: 2, crew: 1 },
  kanone: { n: L('Kanonen', 'Cannons'), r: 3, crew: 3 },
  gewehr: { n: L('Infanterie', 'Infantry'), r: 0 },
  mg: { n: L('Maschinengewehre', 'Machine guns'), r: 1, crew: 2 },
  panzerwagen: { n: L('Panzerwagen', 'Armored cars'), r: 2, crew: 2 },
  artillerie: { n: L('Artillerie', 'Artillery'), r: 3, crew: 3 },
  soldat: { n: L('Soldaten', 'Soldiers'), r: 0 },
  rakete: { n: L('Raketenwerfer', 'Rocket launchers'), r: 1, crew: 2 },
  panzer: { n: L('Panzer', 'Tanks'), r: 2, crew: 3 },
  heli: { n: L('Kampfhubschrauber', 'Attack helicopters'), r: 3, crew: 2 },
};
// Waffengattung eines Soldaten: fest aus Epoche und Person (Simulation und Bild rechnen gleich)
export function unitOf(era, pid) {
  const A = ARMS[clamp(era | 0, 0, 7)], h = hash01(pid, 77);
  let acc = 0;
  for (let k = 0; k < 4; k++) { acc += A.sh[k]; if (h < acc && A.u[k]) return A.u[k]; }
  return A.u[0];
}

export const RANKS = [null, L('Soldat', 'Soldier'), L('Offizier', 'Officer'), L('General', 'General'), L('Admiral', 'Admiral')];
export const RANKS_F = [null, L('Soldatin', 'Soldier'), L('Offizierin', 'Officer'), L('Generalin', 'General'), L('Admiralin', 'Admiral')];
export const MINISTER = { m: L('Verteidigungsminister', 'Minister of Defense'), f: L('Verteidigungsministerin', 'Minister of Defense') };
export const DOCTRINE = { off: L('Angriff ist die beste Verteidigung', 'Attack is the best defense'), aus: L('Stärke zeigen, Frieden halten', 'Show strength, keep the peace'), def: L('Mauern und Bündnisse', 'Walls and alliances') };
export const rankName = p => (p && p.rank ? (p.sex === 'f' ? RANKS_F : RANKS)[p.rank] : '');

// ---------- Mauern ----------

// Stufen: Palisade (Dorfzeit) bis Bunker. def = Vorteil der Verteidiger bei voller Mauer, hard = wie schwer sie zu brechen ist
export const WALLS = [
  null,
  { n: L('Palisade', 'Palisade'), def: 0.35, hard: 1, wood: 26, stone: 0, work: 40 },
  { n: L('Erdwall mit Holztürmen', 'Earthwork with wooden towers'), def: 0.5, hard: 1.5, wood: 36, stone: 14, work: 55 },
  { n: L('Steinmauer mit Toren', 'Stone wall with gates'), def: 0.8, hard: 2.6, wood: 18, stone: 70, work: 80 },
  { n: L('Ringmauer mit Rundtürmen', 'Curtain wall with round towers'), def: 1.1, hard: 3.6, wood: 24, stone: 120, work: 110 },
  { n: L('Sternfestung mit Bastionen', 'Star fort with bastions'), def: 1.3, hard: 4.5, wood: 24, stone: 170, work: 140 },
  { n: L('Bunker und Gräben', 'Bunkers and trenches'), def: 1.0, hard: 3.2, wood: 16, stone: 110, work: 100 },
];
export const WALL_ERA = [0, 1, 2, 3, 4, 5, 6, 6]; // höchste Stufe je Epoche
// Gebäude außerhalb der Mauer (Felder, Betriebe am Rand, Hafen)
const OUTSIDE = new Set(['feld', 'holz', 'stein', 'mine', 'hafen', 'fischer', 'muehle', 'stall', 'werft', 'leuchtturm', 'wachturm', 'kraftwerk', 'rakete', 'fabrik', 'flughafen', 'bahnhof', 'stadion']);
export const RING_N = 16;

// Ring um den Ort: je Richtung so weit, dass die Häuser drinnen liegen, weich gerundet
const ringCap = s => (s.R || 8) + 5;
function ringFor(st, s) {
  const R = new Array(RING_N).fill(0), cap = ringCap(s);
  for (const b of bldOf(st, s)) {
    if (OUTSIDE.has(b.t)) continue;
    const dx = b.x - s.cx, dy = b.y - s.cy, d = Math.hypot(dx, dy);
    if (d > cap) continue; // Einzelhöfe weit draußen bleiben vor der Mauer, sonst liegt die ganze Stadt drinnen
    const k = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * RING_N) % RING_N;
    if (d > R[k]) R[k] = d;
  }
  let ring = R.map(v => Math.max(2.6, v + 2)); // zwei Felder Luft, damit der Ort noch etwas wachsen kann
  for (let pass = 0; pass < 2; pass++) ring = ring.map((v, k) => Math.max(v, (ring[(k + RING_N - 1) % RING_N] + v * 2 + ring[(k + 1) % RING_N]) / 4));
  return ring.map(v => Math.round(Math.min(v, cap + 1) * 10) / 10);
}
// Radius des Rings in Richtung des Winkels a (weich zwischen den Stützstellen)
export function ringAt(ring, a) {
  const u = (((a + Math.PI) / (Math.PI * 2)) * RING_N) % RING_N, k = Math.floor(u), f = u - k;
  return ring[k] * (1 - f) + ring[(k + 1) % RING_N] * f;
}
// Anteil der Häuser, die außerhalb der Mauer stehen (der Ort ist herausgewachsen)
function outside(st, s, ring) {
  let n = 0, out = 0;
  for (const b of bldOf(st, s)) {
    if (OUTSIDE.has(b.t)) continue;
    const dx = b.x - s.cx, dy = b.y - s.cy;
    if (Math.hypot(dx, dy) > ringCap(s)) continue;
    n++;
    if (Math.hypot(dx, dy) > ringAt(ring, Math.atan2(dy, dx)) - 0.4) out++;
  }
  return n ? out / n : 0;
}
// Verteidigungsvorteil der Mauer jetzt (Stufe mal Zustand)
export const wallDef = s => (s.wall && s.wall.lvl ? WALLS[s.wall.lvl].def * s.wall.hp : 0);

// ---------- Stärke ----------

const soldierPow = (p, era) => ROLE[UNITS[unitOf(era, p.id)].r].field * ERA_POW[era] * (1 + Math.min(6, p.vet || 0) * 0.07) * (0.75 + 0.5 * (p.hp ?? 1));
// Stärke eines Ortes, wie sein Minister sie einschätzt: Krieger, Miliz, Befestigung
export function powerOf(st, s) {
  const M = members(st, s), era = s.era | 0;
  let p = 0;
  for (const q of M.adults) if (q.job === 'krieger') p += ROLE[0].field;
  p += M.adults.length * 0.12;
  return p * ERA_POW[era] * fortOf(st, s);
}
function fortOf(st, s) {
  return (1 + wallDef(s)) * (s.has.burg ? 1.3 : 1) * (bldOf(st, s).some(b => b.t === 'kaserne') ? 1.1 : 1) * (1 + Math.min(0.4, (s.bon && s.bon.def) || 0));
}
// mit Bündnispartnern, die im Ernstfall kämen
function allied(st, s, kinds) {
  const out = [];
  for (const [id, P] of Object.entries(s.pact || {})) if (P.until > st.day && kinds.includes(P.kind)) { const o = st._rt.sById.get(+id); if (o && o.alive && !o.war) out.push(o); }
  for (const id of Object.keys(s.ally || {})) { const o = st._rt.sById.get(+id); if (o && o.alive && !o.war && !out.includes(o)) out.push(o); }
  return out;
}
// Kriegslust aus Sicht des Ministers: eigene Stärke mit Verbündeten gegen die des Gegners mit seinen (diplomacy.js)
export function appetite(st, x, y) {
  if (!x.mil || !x.mil.min) return 1;
  const px = powerOf(st, x) + allied(st, x, ['militaer']).reduce((a, o) => a + powerOf(st, o) * 0.6, 0);
  const py = powerOf(st, y) + allied(st, y, ['verteidigung', 'militaer']).reduce((a, o) => a + powerOf(st, o) * 0.7, 0);
  const ratio = px / Math.max(1, py);
  const doc = x.mil.doc === 'off' ? 1.4 : x.mil.doc === 'def' ? 0.6 : 1;
  return clamp(Math.pow(ratio, 1.3) * doc, 0.15, 2.5);
}

// ---------- Ämter ----------

const titled = (p, T) => (p.sex === 'f' ? T.f : T.m);
export const ministerTitle = p => titled(p, MINISTER);

function appoint(st, s, M) {
  const r = rng(st), all = members(st, s).adults, ld = leaderOf(st, s);
  let best = null, bs = -1e9;
  for (const p of all) {
    if (p === ld || p.sick || ageOf(st, p) > 66 || ageOf(st, p) < 24) continue;
    const sc = (p.job === 'krieger' ? 1.4 : 0) + Math.min(6, p.vet || 0) * 0.3 + p.tr.mut * 0.8 + p.tr.charisma * 0.6 + (p.fac === 'krieger' ? 0.4 : 0) + Math.min(10, p.fame) * 0.05 + r.next() * 0.25;
    if (sc > bs) { bs = sc; best = p; }
  }
  const old = M.min && st._rt.pById.get(M.min);
  if (old && old.off === 'min') old.off = '';
  M.min = best ? best.id : 0; M.minSince = st.day;
  if (!best) return;
  best.off = 'min';
  M.doc = best.tr.wut > 0.64 ? 'off' : best.tr.mut < 0.42 || best.tr.charisma > 0.7 ? 'def' : 'aus';
  bio(best, st.day, L(`wird ${ministerTitle(best)} von ${s.name}`, `becomes ${ministerTitle(best)} of ${s.name}`));
  if (s.pop >= 20) chron(st, 'politik', L(`${label(ld)} ernennt ${best.n} zum ${best.sex === 'f' ? 'Verteidigungsministerin' : 'Verteidigungsminister'} von ${s.name}. Leitspruch: ${DOCTRINE[M.doc]}.`, `${label(ld)} appoints ${best.n} ${ministerTitle(best)} of ${s.name}. Motto: ${DOCTRINE[M.doc]}.`), s.id, 0);
}

// Ränge: Krieger sind Soldaten, die erfahrensten Offiziere, der beste führt als General das Heer, mit Flotte ein Admiral
function ranks(st, s, M) {
  const all = members(st, s).adults;
  const k = [];
  for (const p of all) { if (p.job === 'krieger') k.push(p); else if (p.rank) p.rank = 0; }
  k.sort((a, b) => (b.vet || 0) - (a.vet || 0) || b.tr.mut - a.tr.mut);
  const offN = Math.max(1, Math.floor(k.length / 5));
  k.forEach((p, i) => { p.rank = i < offN && (p.vet || 0) >= 1 ? 2 : 1; });
  const genOld = M.gen && st._rt.pById.get(M.gen);
  const gen = genOld && genOld.s === s.id && genOld.job === 'krieger' ? genOld : k[0];
  M.gen = gen ? gen.id : 0;
  if (gen) gen.rank = 3;
  const navy = knows(st, 'segeln', s) && bldOf(st, s).some(b => b.t === 'hafen' || b.t === 'werft');
  const admOld = M.adm && st._rt.pById.get(M.adm);
  const adm = !navy ? null : admOld && admOld.s === s.id && admOld.job === 'krieger' && admOld !== gen ? admOld : k.find(p => p !== gen);
  M.adm = adm ? adm.id : 0;
  if (adm) adm.rank = 4;
}

// ---------- Lage und Planung (alle 6 Tage je Ort) ----------

function weekly(st, s, pw) {
  const r = rng(st);
  const M = s.mil || (s.mil = { min: 0, minSince: 0, doc: 'aus', gen: 0, adm: 0, threat: 0, won: 0, lost: 0 });
  const W = s.wall || (s.wall = { lvl: 0, hp: 1, ring: null, b: 0, prog: 0, next: null });
  if (s.era < 1 || s.pop < 12) return;
  const m = M.min && st._rt.pById.get(M.min);
  if (!m || m.s !== s.id || m.sick || ageOf(st, m) > 70) appoint(st, s, M);
  ranks(st, s, M);
  // Bedrohung: feindselige, starke Nachbarn in der Nähe
  const pow = pw.get(s.id) || 1;
  let threat = 0, from = 0;
  for (const o of st.settlements) {
    if (!o.alive || o === s || o.era < 1) continue;
    const same = sameLand(st, s, o);
    const Is = isleOf(st, s), Io = isleOf(st, o);
    if (!same && !(Is && Io && Is.contact[Io.id])) continue;
    const dist = Math.hypot(s.cx - o.cx, s.cy - o.cy);
    if (dist > 90) continue;
    const host = o.war === s.id ? 1.5 : clamp(-(s.rel[o.id] ?? 0) / 100 + ((s.grudge && s.grudge[o.id]) || 0) / 120 + ((o.grudge && o.grudge[s.id]) || 0) / 100, 0, 1.4);
    if (host <= 0.05) continue;
    const t = host * clamp((pw.get(o.id) || 0) / Math.max(1, pow), 0, 3) * (same ? clamp(1 - dist / 80, 0.25, 1) : 0.5);
    if (t > threat) { threat = t; from = o.id; }
  }
  M.threat = Math.round(threat * 100) / 100; M.from = from;
  // Mauer: ausbessern, zuerst eine Palisade, später nach Epoche ausbauen, wächst der Ort hinaus, ein neuer Ring
  if (W.lvl && W.hp < 1 && !s.war) W.hp = Math.min(1, W.hp + 0.06);
  // ab der Industrie schützt eine alte Mauer nicht mehr: in Friedenszeiten wird sie abgetragen (wie die Stadtmauern, aus
  // denen Ringstraßen wurden), Bunker und Gräben gibt es nur bei echter Bedrohung
  if (W.lvl && W.lvl < 6 && !W.b && s.era >= 6 && !s.war && threat < 0.3 && r.chance(0.04)) {
    if (s.pop >= 15) chron(st, 'bau', L(`${s.name} trägt die alte ${WALLS[W.lvl].n} ab. Wo sie stand, ist jetzt Platz für Straßen und Gärten.`, `${s.name} pulls down its old ${WALLS[W.lvl].n.toLowerCase()}. Where it stood there is now room for streets and gardens.`), s.id, 0);
    W.lvl = 0; W.hp = 1; W.ring = null;
    fx(st, { type: 'wall', s: s.id });
  }
  if (!W.b) {
    const maxL = WALL_ERA[s.era | 0];
    let want = 0;
    // erste Mauer in der Bauart der Epoche (eine Stadt der Renaissance zieht keine Palisade mehr), ab Industrie nur bedroht
    if (!W.lvl && s.pop >= 15) want = s.era >= 6 ? (threat > 0.5 ? 6 : 0) : Math.max(1, maxL);
    else if (W.lvl && W.lvl < maxL && (s.era < 6 || threat > 0.5) && (threat > 0.25 || r.chance(0.05 + (M.doc === 'def' ? 0.06 : 0)))) want = maxL;
    else if (W.lvl && W.ring && outside(st, s, W.ring) > 0.12 && (s.era < 6 || threat > 0.5) && r.chance(0.35)) want = W.lvl;
    if (want) { W.b = want; W.prog = 0; W.next = ringFor(st, s); }
  }
  if (M.min) pacts(st, s, M, pow, r, pw);
}

// Bündnisse: wer bedroht ist, sucht Schutz; zwei angriffslustige Freunde mit gemeinsamem Feind verbünden sich zum Krieg;
// zwei gleich starke Rivalen schließen lieber einen Nichtangriffspakt
function pacts(st, s, M, pow, r, pw) {
  const P = s.pact || (s.pact = {});
  const on = (o, kinds) => { const q = P[o.id]; return q && q.until > st.day && (!kinds || kinds.includes(q.kind)); };
  const sign = (o, kind, yrs, text) => {
    const q = { kind, start: st.day, until: st.day + yrs * YEAR };
    P[o.id] = q; (o.pact || (o.pact = {}))[s.id] = { ...q };
    s.rel[o.id] = o.rel[s.id] = clamp((s.rel[o.id] ?? 0) + 8, -100, 100);
    chron(st, 'politik', text, s.id, 1);
    fx(st, { type: 'pact', a: s.id, b: o.id, kind });
  };
  if (s.war) return;
  const cands = st.settlements.filter(o => o.alive && o !== s && !o.war && o.mil && o.mil.min && (sameLand(st, s, o) || (isleOf(st, s) && isleOf(st, o) && isleOf(st, s).contact[o.isle])));
  if (M.threat > 0.55 && !Object.values(P).some(q => q.until > st.day && (q.kind === 'verteidigung' || q.kind === 'militaer'))) {
    let best = null, bs = -1e9;
    for (const o of cands) {
      if (o.id === M.from || on(o, ['waffenstillstand']) || (s.rel[o.id] ?? 0) < 20) continue;
      const enemyToo = M.from && ((o.rel[M.from] ?? 0) < 0 || (o.mil.from === M.from));
      const sc = (s.rel[o.id] ?? 0) + (enemyToo ? 30 : 0) + (pw.get(o.id) || 0) * 0.3 - Math.hypot(s.cx - o.cx, s.cy - o.cy) * 0.3;
      if (sc > bs) { bs = sc; best = o; }
    }
    if (best && r.chance(0.35)) {
      const m = st._rt.pById.get(M.min), bm = best.mil.min && st._rt.pById.get(best.mil.min);
      sign(best, 'verteidigung', 20, L(`${m ? m.n : 'Die Gesandten'} aus ${s.name} und ${bm ? bm.n : 'die Gesandten'} aus ${best.name} unterzeichnen ein Verteidigungsbündnis: Wer einen angreift, greift beide an.`, `${m ? m.n : 'The envoys'} of ${s.name} and ${bm ? bm.n : 'the envoys'} of ${best.name} sign a defensive alliance: whoever attacks one attacks both.`));
      return;
    }
  }
  if (M.doc === 'off' && M.from) {
    const enemy = st._rt.sById.get(M.from);
    for (const o of cands) {
      if (!enemy || o === enemy || on(o) || o.mil.doc !== 'off' || (s.rel[o.id] ?? 0) < 55 || (o.rel[enemy.id] ?? 0) > -10) continue;
      if (!r.chance(0.25)) continue;
      sign(o, 'militaer', 15, L(`${s.name} und ${o.name} schließen ein Militärbündnis gegen ${enemy.name}. Ihre Heere werden gemeinsam marschieren.`, `${s.name} and ${o.name} form a military alliance against ${enemy.name}. Their armies will march together.`));
      return;
    }
  }
  if (M.from && M.threat > 0.3 && M.threat < 1.2) {
    const o = st._rt.sById.get(M.from);
    if (o && o.alive && !o.war && !on(o) && (s.rel[o.id] ?? 0) > -35) {
      const ratio = (pw.get(o.id) || 0) / Math.max(1, pow);
      if (ratio > 0.7 && ratio < 1.45 && r.chance(0.12)) sign(o, 'nichtangriff', 10, L(`${s.name} und ${o.name} trauen einander nicht, aber keiner will den ersten Schlag riskieren: ein Nichtangriffspakt für zehn Jahre.`, `${s.name} and ${o.name} do not trust each other, but neither wants to risk the first blow: a non-aggression pact for ten years.`));
    }
  }
}

// Mauerbau jeden Tag: Baumeister und Krieger arbeiten, Holz und Stein aus dem Lager
function wallWork(st, s) {
  const W = s.wall;
  if (!W || !W.b) return;
  const def = WALLS[W.b];
  const M = members(st, s).adults;
  let crew = 0.5;
  for (const p of M) if (p.job === 'baumeister') crew += 0.8; else if (p.job === 'krieger' && !s.war) crew += 0.35;
  let rate = crew / def.work;
  const dw = def.wood * rate, ds = def.stone * rate;
  if (dw > 0 && s.stock.wood < dw) rate *= Math.max(0, s.stock.wood) / dw;
  if (ds > 0 && s.stock.stone < ds) rate *= Math.max(0, s.stock.stone) / ds;
  if (rate <= 0) return;
  s.stock.wood -= def.wood * rate; s.stock.stone -= def.stone * rate;
  W.prog += rate;
  if (W.prog < 1) return;
  const first = !W.lvl, up = W.b > W.lvl;
  W.lvl = W.b; W.hp = 1; W.ring = W.next || ringFor(st, s); W.b = 0; W.prog = 0; W.next = null;
  if (s.pop >= 15) chron(st, 'bau', first
    ? L(`${s.name} zieht eine ${def.n} um den Ort. Die Tore schließen sich jetzt bei Nacht.`, `${s.name} raises a ${def.n.toLowerCase()} around the town. The gates now close at night.`)
    : up ? L(`${s.name} baut seine Befestigung aus: eine ${def.n}.`, `${s.name} upgrades its fortifications: a ${def.n.toLowerCase()}.`)
      : L(`${s.name} ist über seine Mauer hinausgewachsen und zieht einen neuen Ring weiter draußen.`, `${s.name} has outgrown its wall and raises a new ring further out.`), s.id, first || up ? 1 : 0);
  fx(st, { type: 'wall', s: s.id });
}

// ---------- Heere ----------

const SPEED = [5, 5, 6, 6, 6.5, 7, 10, 16]; // Felder am Tag zu Fuß, mit Bahn, Lastwagen
const SEA_SPEED = [10, 11, 13, 14, 15, 17, 22, 30];
export const armyName = (st, A) => { const s = st._rt.sById.get(A.s); return A.kind === 'flotte' ? L(`Flotte von ${s ? s.name : '?'}`, `Fleet of ${s ? s.name : '?'}`) : L(`Heer von ${s ? s.name : '?'}`, `Army of ${s ? s.name : '?'}`); };

// Weg über Land: Straßen bevorzugt, um Häuser herum
function landPath(st, ax, ay, bx, by) {
  const T = st.tiles, rt = st._rt;
  const extra = j => (rt.bldAt[j] ? 2.5 : 0) - (T.road[j] > 60 || (rt.roadNet && rt.roadNet[j]) ? 0.45 : 0) + (T.river && T.river[j] ? 1.2 : 0);
  const p = findPath(T.h, ax, ay, bx, by, st.earth ? 30000 : 14000, false, extra);
  return p || straight(ax, ay, bx, by);
}
function straight(ax, ay, bx, by) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay))), out = [];
  for (let k = 0; k <= n; k++) out.push([Math.round(ax + (bx - ax) * k / n), Math.round(ay + (by - ay) * k / n)]);
  return out;
}
// Hafenplatz: Wasser an der Küste nahe Hafen, Werft, Fischerhütte oder Ortsmitte, mit dem Landfeld daneben
function portOf(st, s, tx, ty) {
  const h = st.tiles.h;
  const B = bldOf(st, s).filter(b => b.t === 'hafen' || b.t === 'werft' || b.t === 'fischer');
  const starts = B.length ? B.map(b => [b.x, b.y]) : [[s.cx, s.cy]];
  let best = null, bd = 1e9;
  for (const [x0, y0] of starts) for (let r = 1; r <= 16 && !best; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const x = x0 + dx, y = y0 + dy;
    if (!inb(x, y) || h[idx(x, y)] >= 0) continue;
    for (const [ex, ey] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const lx = x + ex, ly = y + ey;
      if (!inb(lx, ly) || h[idx(lx, ly)] < 0) continue;
      const d = r * 4 + (tx != null ? Math.hypot(x - tx, y - ty) * 0.05 : 0);
      if (d < bd) { bd = d; best = { w: [x, y], l: [lx, ly] }; }
    }
  }
  return best;
}
const flat = pts => { const o = []; for (const [x, y] of pts) o.push(x, y); return o; };

// Heer ausheben: die Krieger des Ortes (ein Teil bleibt zu Hause), notfalls Miliz; der General führt, zur See der Admiral
function raise(st, s, foe, side, dest, help = false) {
  const r = rng(st), rt = st._rt, M = members(st, s).adults, mil = s.mil || {};
  const busy = new Set(); for (const A of st.armies) for (const id of A.ids) busy.add(id);
  let k = M.filter(p => p.job === 'krieger' && !p.sick && !busy.has(p.id));
  const keep = help ? Math.ceil(k.length * 0.5) : Math.min(k.length - 1, Math.floor(k.length * 0.2));
  k = k.slice(0, Math.max(1, k.length - keep));
  // Aushebung: dazu junge Leute als Miliz, je nach Kriegsziel (für Raubzüge wenige, für Eroberungen viele), Wehrpflicht mehr
  const goal = (rt.sById.get(side) || {}).warGoal;
  const share = (help ? 0.05 : ({ conquest: 0.2, sea: 0.16, holy: 0.16, revenge: 0.14, border: 0.12, raid: 0.08 }[goal] ?? 0.1)) + (s.laws.includes('wehrpflicht') ? 0.06 : 0);
  const ld = s.gov.leader;
  const levy = M.filter(p => p.job !== 'krieger' && !busy.has(p.id) && !p.sick && p.id !== ld && p.off !== 'min' && (p.sex === 'm' || p.tr.mut > 0.6) && ageOf(st, p) < 45);
  // Mindestgröße: kein Feldzug mit zwei Mann (Raubzug 3, Hilfsheer 2, sonst 5), soweit der Ort Leute hat
  const minN = help ? 2 : goal === 'raid' ? 3 : 5;
  k = k.concat(levy.slice(0, Math.max(minN - k.length, Math.floor(M.length * share))));
  const ids = k.map(p => p.id);
  if (!ids.length) return null;
  const T = rt.sById.get(dest);
  const sea = !sameLand(st, s, T);
  let path, sea0 = -1, sea1 = -1;
  if (!sea) path = landPath(st, s.cx, s.cy, T.cx, T.cy);
  else {
    const a = portOf(st, s, T.cx, T.cy), b = portOf(st, T, s.cx, s.cy);
    if (!a || !b) return null;
    const p1 = landPath(st, s.cx, s.cy, a.l[0], a.l[1]);
    const p2 = findPath(st.tiles.h, a.w[0], a.w[1], b.w[0], b.w[1], st.earth ? 60000 : 30000, true) || straight(a.w[0], a.w[1], b.w[0], b.w[1]);
    const p3 = landPath(st, b.l[0], b.l[1], T.cx, T.cy);
    sea0 = p1.length; sea1 = p1.length + p2.length - 1;
    path = p1.concat(p2, p3);
  }
  // Ziel nicht bis in die Ortsmitte: Heere halten vor dem Ort (Lager, Schlachtfeld)
  const A = {
    id: st.nextId++, s: s.id, side, foe, dest, kind: sea ? 'flotte' : 'heer', st: 'muster', d0: st.day,
    ids, n0: ids.length, gen: 0, adm: 0, era: s.era | 0, path: flat(path), sea0, sea1, pi: 0,
    v: SPEED[s.era | 0], vs: SEA_SPEED[s.era | 0], x: s.cx, y: s.cy, mor: 1, sup: 1, fight: 0, help, seaWon: false,
  };
  const g = (mil.gen && ids.includes(mil.gen)) ? mil.gen : ids.slice().sort((a, b) => ((rt.pById.get(b).vet || 0) - (rt.pById.get(a).vet || 0)))[0];
  A.gen = g || 0;
  if (sea) A.adm = mil.adm && rt.pById.has(mil.adm) && !busy.has(mil.adm) ? mil.adm : 0;
  if (A.adm && !A.ids.includes(A.adm)) A.ids.push(A.adm);
  for (const id of A.ids) { const p = rt.pById.get(id); if (p) p.army = A.id; }
  st.armies.push(A);
  return A;
}

// Kriegsbeginn (aus diplomacy.js declareWar): Angreifer hebt ein Heer aus, Verbündete schicken Hilfsheere
export function onWar(st, agg, def) {
  if (!st.armies) st.armies = [];
  const A = raise(st, agg, def.id, agg.id, def.id);
  if (A) {
    const g = st._rt.pById.get(A.gen);
    chron(st, 'krieg', A.kind === 'flotte'
      ? L(`In ${agg.name} werden Schiffe beladen. ${A.ids.length} Krieger stechen in See gegen ${def.name}${g ? `, angeführt von ${g.n}` : ''}.`, `Ships are loaded in ${agg.name}. ${A.ids.length} warriors set sail against ${def.name}${g ? `, led by ${g.n}` : ''}.`)
      : L(`In ${agg.name} sammelt sich ein Heer von ${A.ids.length} Kriegern${g ? ` unter ${rankName(g) || 'General'} ${g.n}` : ''} und marschiert gegen ${def.name}.`, `An army of ${A.ids.length} warriors gathers in ${agg.name}${g ? ` under ${rankName(g) || 'General'} ${g.n}` : ''} and marches against ${def.name}.`), agg.id, 1);
  }
  for (const id of def.helpers || []) { const c = st._rt.sById.get(id); if (c && c.alive) raise(st, c, agg.id, def.id, def.id, true); }
  for (const id of agg.helpers || []) { const c = st._rt.sById.get(id); if (c && c.alive) raise(st, c, def.id, agg.id, def.id, true); }
}

// Stelle auf dem Weg (Index u, auch zwischen den Punkten)
export function pathAt(A, u) {
  const P = A.path, n = P.length / 2;
  if (!n) return [A.x, A.y];
  const k = clamp(Math.floor(u), 0, n - 1), f = clamp(u - k, 0, 1), k2 = Math.min(n - 1, k + 1);
  return [P[k * 2] + (P[k2 * 2] - P[k * 2]) * f, P[k * 2 + 1] + (P[k2 * 2 + 1] - P[k * 2 + 1]) * f];
}
export const pathLen = A => A.path.length / 2;
export const onSea = (A, u = A.pi) => A.sea0 >= 0 && u >= A.sea0 && u < A.sea1;

// Rückweg nach Hause: den Weg bis hier umdrehen
function goHome(st, A, why) {
  if (A.st === 'home' || A.st === 'gone') return;
  const n = pathLen(A), k = clamp(Math.round(A.pi), 0, n - 1);
  const rev = [];
  for (let i = k; i >= 0; i--) rev.push(A.path[i * 2], A.path[i * 2 + 1]);
  A.path = rev;
  if (A.sea0 >= 0) { const s0 = A.sea0, s1 = A.sea1; A.sea0 = k >= s1 ? k - s1 : k >= s0 ? 0 : -1; A.sea1 = k >= s1 ? k - s0 : k >= s0 ? k - s0 : -1; if (A.sea0 < 0) A.sea1 = -1; }
  A.pi = 0; A.st = 'home'; A.why = why; A.fight = 0; A.d0 = st.day;
  A.dest = A.s;
}
function dissolve(st, A) {
  for (const id of A.ids) { const p = st._rt.pById.get(id); if (p && p.army === A.id) p.army = 0; }
  A.st = 'gone';
}

// ---------- Schlacht ----------

const KIND_N = { feld: L('Schlacht', 'Battle'), sturm: L('Sturm', 'Storming'), see: L('Seeschlacht', 'Naval Battle'), ausfall: L('Ausfall', 'Sortie') };
// Name einer Schlacht nach dem Ort, um den es geht, oder dem nächsten Ort am Schlachtfeld
function nearestTown(st, x, y) {
  let best = null, bd = 1e9;
  for (const s of st.settlements) { if (!s.alive) continue; const d = Math.hypot(s.cx - x, s.cy - y); if (d < bd) { bd = d; best = s; } }
  return best;
}
function battleName(st, k, x, y, town) {
  if (k === 'see') return L(`die Seeschlacht vor ${town.name}`, `the Naval Battle off ${town.name}`);
  if (k === 'sturm') return L(`der Sturm auf ${town.name}`, `the Storming of ${town.name}`);
  if (k === 'ausfall') return L(`der Ausfall von ${town.name}`, `the Sortie of ${town.name}`);
  const n = nearestTown(st, x, y) || town;
  return n === town ? L(`die Schlacht vor ${town.name}`, `the Battle before ${town.name}`) : L(`die Schlacht bei ${n.name}`, `the Battle of ${n.name}`);
}

// Ein Kampftag: Kraft beider Seiten, Verluste, Moral. Gefallene bekommen eine Stelle im Tag (f), damit das Bild sie
// nacheinander fallen lassen kann. Gibt die geflohene Seite zurück (0 keine, 1 Angreifer, 2 Verteidiger)
function fightDay(st, F) {
  const r = rng(st), rt = st._rt;
  const A = F.a.map(id => st.armies.find(q => q.id === id)).filter(q => q && q.st !== 'gone');
  const B = F.b.map(id => st.armies.find(q => q.id === id)).filter(q => q && q.st !== 'gone');
  const S = rt.sById.get(F.town);
  const pa = [], pb = [];
  for (const q of A) for (const id of q.ids) { const p = rt.pById.get(id); if (p) pa.push([p, q]); }
  for (const q of B) for (const id of q.ids) { const p = rt.pById.get(id); if (p) pb.push([p, q]); }
  // Besatzung: wer im angegriffenen Ort zu Hause ist, verteidigt ihn (Krieger, dazu Miliz)
  if (S && (F.k === 'sturm' || F.k === 'ausfall') && S.alive) {
    const busy = new Set(); for (const q of st.armies) if (q.st !== 'gone') for (const id of q.ids) busy.add(id);
    const M = members(st, S).adults;
    let g = M.filter(p => p.job === 'krieger' && !busy.has(p.id));
    g = g.concat(M.filter(p => p.job !== 'krieger' && !busy.has(p.id) && (p.sex === 'm' || p.tr.mut > 0.6) && ageOf(st, p) < 55).slice(0, F.k === 'sturm' ? Math.max(2, Math.floor(M.length * 0.18)) : Math.floor(M.length * 0.08)));
    F.gar = g.map(p => p.id);
    for (const p of g) pb.push([p, null]);
  }
  if (!pa.length || !pb.length) return pa.length ? 2 : 1;
  const eraA = A.length ? A[0].era : 0, eraB = B.length ? B[0].era : S ? S.era | 0 : 0;
  const morA = A.length ? A.reduce((s, q) => s + q.mor, 0) / A.length : 1;
  const morB = B.length ? B.reduce((s, q) => s + q.mor, 0) / B.length : (S ? 0.75 + 0.4 * (S.hap || 0.5) : 1);
  let powA = 0, powB = 0;
  for (const [p] of pa) powA += soldierPow(p, eraA);
  for (const [p, q] of pb) powB += soldierPow(p, q ? q.era : eraB) * (q ? 1 : p.job === 'krieger' ? 1 : 0.55);
  powA *= morA * r.range(0.8, 1.2);
  powB *= morB * r.range(0.8, 1.2);
  if (F.k === 'sturm' && S) powB *= 1 + wallDef(S) + (S.has.burg ? 0.3 : 0);
  else if (F.k === 'ausfall' && S) powB *= 1.05;
  else if (F.k === 'feld' && S && Math.hypot(F.x - S.cx, F.y - S.cy) < S.R + 4) powB *= 1.1; // Heimvorteil
  if (F.k === 'see') { powA *= 1 + ((rt.sById.get(A[0] && A[0].s) || {}).bon?.navy || 0) * 0.3; powB *= 1 + ((S && S.bon && S.bon.navy) || 0) * 0.4; }
  const fa = clamp(0.11 * Math.pow(powB / Math.max(0.1, powA), 0.85) * r.range(0.75, 1.25), 0.03, 0.6);
  const fb = clamp(0.11 * Math.pow(powA / Math.max(0.1, powB), 0.85) * r.range(0.75, 1.25), 0.03, 0.6);
  const kill = (list, frac, side) => {
    let n = Math.round(list.length * frac);
    if (n === 0 && r.chance(list.length * frac * 2)) n = 1;
    for (let i = 0; i < n && list.length; i++) {
      const [p, q] = list.splice(r.int(0, list.length - 1), 1)[0];
      F.fallen.push({ id: p.id, n: p.n, sex: p.sex, clan: p.clan, job: p.job, u: unitOf(q ? q.era : eraB, p.id), side, f: Math.round(r.range(0.12, 0.95) * 100) / 100, d: st.day, gar: !q });
      if (q) { q.ids = q.ids.filter(x => x !== p.id); if (q.gen === p.id) { q.gen = 0; q.mor -= 0.15; } }
      F.dead[side - 1]++;
      killPerson(st, p, CAUSE_WAR);
    }
    return n;
  };
  const da = kill(pa, fa, 1), db = kill(pb, fb, 2);
  F.rounds++;
  for (const q of A) { q.mor = clamp(q.mor - fa * 1.5 - (powB > powA * 1.25 ? 0.08 : 0) + (powA > powB * 1.25 ? 0.04 : 0), 0, 1); }
  for (const q of B) { q.mor = clamp(q.mor - fb * 1.5 - (powA > powB * 1.25 ? 0.08 : 0) + (powB > powA * 1.25 ? 0.04 : 0), 0, 1); }
  const leftA = pa.length, leftB = pb.length;
  const brokeA = !leftA || morA - fa * 1.5 < 0.32 || leftA < F.n0[0] * 0.3;
  const brokeB = !leftB || (B.length ? morB - fb * 1.5 < 0.32 : (F.k === 'sturm' ? leftB < Math.max(1, F.n0[1] * 0.35) : false)) || (B.length && leftB < F.n0[1] * 0.3);
  void da; void db;
  if (brokeA && brokeB) return powA >= powB ? 2 : 1;
  return brokeA ? 1 : brokeB ? 2 : (F.rounds >= 3 ? (powA >= powB ? 2 : 1) : 0);
}

// Schlacht beginnen: a, b sind Heere (b fehlt beim Sturm auf einen Ort ohne Heer davor)
function startFight(st, k, a, b, town, x, y) {
  const F = { id: st.nextId++, k, a: [a.id], b: b ? [b.id] : [], town: town ? town.id : 0, x, y, d0: st.day, rounds: 0, fallen: [], dead: [0, 0], gar: [], n0: [0, 0], name: '' };
  // Hilfsheere in der Nähe kämpfen mit
  for (const q of st.armies) {
    if (q === a || q === b || q.st === 'gone' || q.st === 'home' || q.fight) continue;
    if (Math.hypot(q.x - x, q.y - y) > 5) continue;
    if (q.side === a.side) F.a.push(q.id); else if (b ? q.side === b.side : town && q.side === town.id) F.b.push(q.id);
  }
  for (const id of F.a.concat(F.b)) { const q = st.armies.find(z => z.id === id); if (q) { q.fight = F.id; q.st = 'battle'; } }
  F.n0 = [F.a.reduce((s, id) => s + (st.armies.find(z => z.id === id)?.ids.length || 0), 0), F.b.reduce((s, id) => s + (st.armies.find(z => z.id === id)?.ids.length || 0), 0)];
  if (town && (k === 'sturm' || k === 'ausfall')) F.n0[1] += members(st, town).adults.filter(p => p.job === 'krieger' && !p.army).length + Math.floor(members(st, town).adults.length * (k === 'sturm' ? 0.18 : 0.08));
  const near = town || st._rt.sById.get(a.foe) || st._rt.sById.get(a.s);
  F.name = battleName(st, k, x, y, near);
  F.near = (nearestTown(st, x, y) || near).name;
  (st.fights || (st.fights = [])).push(F);
  return F;
}

// Ende einer Schlacht: Kriegsbuch, Chronik, Helden, Schlachtfeld, Kriegsstand (society.js warCheck)
function endFight(st, F, loserSide) {
  const r = rng(st), rt = st._rt;
  const A = F.a.map(id => st.armies.find(q => q.id === id)).filter(Boolean), B = F.b.map(id => st.armies.find(q => q.id === id)).filter(Boolean);
  const aSide = A[0] ? A[0].side : 0, bSide = B[0] ? B[0].side : F.town;
  const winSide = loserSide === 1 ? bSide : aSide, loseSide = loserSide === 1 ? aSide : bSide;
  const W = rt.sById.get(winSide), Lo = rt.sById.get(loseSide);
  F.end = st.day; F.win = winSide;
  // Überlebende gewinnen Erfahrung, der General des Siegers wird gefeiert
  for (const q of A.concat(B)) for (const id of q.ids) { const p = rt.pById.get(id); if (p) p.vet = (p.vet || 0) + 1; }
  for (const id of F.gar) { const p = rt.pById.get(id); if (p) p.vet = (p.vet || 0) + 1; }
  const winners = loserSide === 1 ? B : A;
  const gid = winners[0] && winners[0].gen;
  const g = gid && rt.pById.get(gid);
  if (g) { g.fame += 2; bio(g, st.day, L(`siegt in ${F.name}`, `wins ${F.name}`)); }
  const dead = F.dead[0] + F.dead[1];
  if (dead >= 3 && F.k !== 'see' && st.tiles.h[idx(Math.round(F.x), Math.round(F.y))] >= 1 && !(st.finds || []).some(o => o.t === 'schlacht' && Math.abs(o.x - F.x) + Math.abs(o.y - F.y) < 5)) addSite(st, 'schlacht', Math.round(F.x), Math.round(F.y), { found: st.day, name: L(`das Schlachtfeld von ${F.near}`, `the battlefield of ${F.near}`), dead });
  if (W && Lo) {
    if (W.mil) W.mil.won = (W.mil.won || 0) + 1;
    if (Lo.mil) Lo.mil.lost = (Lo.mil.lost || 0) + 1;
  }
  // Kriegsbuch
  (st.milLog || (st.milLog = [])).push({ d: F.d0, e: st.day, k: F.k, name: F.name, a: aSide, b: bSide, win: winSide, dead: F.dead.slice(), n0: F.n0.slice(), x: Math.round(F.x), y: Math.round(F.y), gen: g ? g.n : '' });
  if (st.milLog.length > 120) st.milLog.splice(0, st.milLog.length - 120);
  if (W && Lo) {
    const txt = F.k === 'see'
      ? L(`${cap(F.name)}: die Schiffe von ${W.name} siegen, ${dead} Seeleute versinken in den Wellen.`, `${cap(F.name)}: the ships of ${W.name} prevail, and ${dead} sailors sink beneath the waves.`)
      : F.k === 'sturm'
        ? (loserSide === 2 ? L(`${cap(F.name)}: die Mauern fallen, ${W.name} dringt in die Stadt ein. ${dead} Tote.`, `${cap(F.name)}: the walls fall and ${W.name} breaks into the town. ${dead} dead.`)
          : L(`${cap(F.name)} scheitert. Die Verteidiger von ${W.name} halten die Mauern, ${dead} Tote.`, `${cap(F.name)} fails. The defenders of ${W.name} hold the walls. ${dead} dead.`))
        : L(`${cap(F.name)}: ${W.name} schlägt ${Lo.name}${g ? `, ${g.n} führt die Sieger` : ''}. ${dead} ${dead === 1 ? 'Toter' : 'Tote'}.`, `${cap(F.name)}: ${W.name} defeats ${Lo.name}${g ? `, with ${g.n} leading the victors` : ''}. ${dead} dead.`);
    chron(st, 'krieg', txt, W.id, 1);
    fx(st, { type: 'battle', a: aSide, b: bSide, x: F.x, y: F.y, k: F.k });
  }
  // Heere: die Verlierer fliehen, die Sieger ziehen weiter (oder heim, wenn der Krieg vorbei ist)
  for (const q of loserSide === 1 ? A : B) { q.fight = 0; if (q.ids.length) goHome(st, q, 'flucht'); else dissolve(st, q); }
  for (const q of loserSide === 1 ? B : A) {
    q.fight = 0; q.mor = Math.min(1, q.mor + 0.15);
    if (F.k === 'sturm' && loserSide === 2) goHome(st, q, 'beute'); // mit der Beute heim, ein neues Heer kommt, wenn der Krieg weitergeht
    else if (q.def || q.dest === q.s) goHome(st, q, 'sieg');
    else q.st = 'march';
  }
  // Kriegsstand: Angreifer und Verteidiger des eigentlichen Krieges
  const agg = [rt.sById.get(aSide), rt.sById.get(bSide)].find(s => s && s.aggressor && s.war);
  const def = agg && rt.sById.get(agg.war);
  if (agg && def && agg.alive && def.alive) {
    const win = winSide === agg.id || (agg.helpers || []).includes(winSide) ? agg : def;
    // erfolgreicher Sturm: Plünderung, zählt doppelt
    if (F.k === 'sturm' && loserSide === 2) for (const k of ['food', 'gold']) { const t = def.stock[k] * 0.2; def.stock[k] -= t; agg.stock[k] += t; }
    warCheck(st, agg, def, win, F.k === 'see', F.k === 'sturm' && loserSide === 2 ? 2 : 1);
  }
}
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);

// Belagerung, ein Tag: Belagerungsgerät schlägt Breschen, der Ort hungert, dem Heer gehen die Vorräte aus
function siegeDay(st, A, T) {
  const r = rng(st), rt = st._rt, W = T.wall;
  let wallPow = 0;
  for (const id of A.ids) { const p = rt.pById.get(id); if (p) wallPow += ROLE[UNITS[unitOf(A.era, p.id)].r].wall; }
  wallPow *= ERA_POW[A.era];
  const hard = W && W.lvl ? WALLS[W.lvl].hard * ERA_POW[T.era | 0] : 1;
  if (W && W.lvl) W.hp = clamp(W.hp - (0.012 + wallPow / (hard * 55)) * r.range(0.7, 1.3), 0, 1);
  T.stock.food *= 0.9; // Felder draußen liegen brach, Zufuhr abgeschnitten
  A.sup = clamp(A.sup - 0.03, 0, 1);
  A.siegeDays = (A.siegeDays || 0) + 1;
  if (A.siegeDays === 1) chron(st, 'krieg', L(`Das ${armyName(st, A)} schlägt sein Lager vor ${T.name} auf. Die Belagerung beginnt.`, `The ${armyName(st, A).toLowerCase()} pitches camp before ${T.name}. The siege begins.`), T.id, 1);
  const pa = A.ids.reduce((s, id) => s + (rt.pById.get(id) ? soldierPow(rt.pById.get(id), A.era) : 0), 0) * A.mor;
  const pd = powerOf(st, T) / Math.max(1, 1 + wallDef(T)) ;
  // Ausfall der Verteidiger, wenn sie stark genug sind
  if (pd > pa * 1.1 && members(st, T).adults.filter(p => p.job === 'krieger' && !p.army).length >= 2 && r.chance(0.35)) return 'ausfall';
  if (!W || !W.lvl || W.hp < 0.3 || (A.siegeDays >= 4 && pa > pd * (1 + wallDef(T)) * 2.2)) return 'sturm';
  if (A.sup < 0.25) return pa > pd * (1 + wallDef(T)) * 1.2 ? 'sturm' : 'abzug';
  return '';
}

// ---------- Tageslauf ----------

export function militaryStep(st) {
  const rt = st._rt, r = rng(st);
  if (!st.armies) st.armies = [];
  if (!st.fights) st.fights = [];
  const alive = st.settlements.filter(s => s.alive);
  if (st.day % 6 === 2) { const pw = new Map(alive.map(s => [s.id, powerOf(st, s)])); for (const s of alive) weekly(st, s, pw); }
  for (const s of alive) wallWork(st, s);
  // Kriege ohne Heer: der Angreifer hebt (nach einer Pause) ein neues aus
  if (st.day % 3 === 0) for (const s of alive) {
    if (!s.war || !s.aggressor) continue;
    const T = rt.sById.get(s.war);
    if (!T || !T.alive) continue;
    if (st.armies.some(A => A.st !== 'gone' && A.s === s.id && A.side === s.id)) continue;
    if (st.day - (s.lastRaise || -99) < 9) continue;
    s.lastRaise = st.day;
    const A = raise(st, s, T.id, s.id, T.id);
    if (A) chron(st, 'krieg', L(`${s.name} schickt ein neues Heer gegen ${T.name}: ${A.ids.length} Krieger.`, `${s.name} sends a new army against ${T.name}: ${A.ids.length} warriors.`), s.id, 0);
  }
  // Verteidiger mit starkem Heer ziehen dem Feind entgegen (Feldschlacht statt Belagerung), einmal je Krieg
  for (const A of st.armies) {
    if (A.st !== 'march' || A.help || A.def) continue;
    const T = rt.sById.get(A.foe), S = rt.sById.get(A.side);
    if (!T || !T.alive || !S || !S.aggressor || T.intercept === S.warSince || !T.mil || (T.mil.doc === 'def' && wallDef(T) > 0.5)) continue;
    if (!sameLand(st, T, S)) continue; // gegen eine Landung von See zieht man nicht mit einer eigenen Flotte los (Treffen im Wasser)
    const pa = A.ids.reduce((s, id) => s + (rt.pById.get(id) ? soldierPow(rt.pById.get(id), A.era) : 0), 0);
    const Mt = members(st, T).adults, k = Mt.filter(p => p.job === 'krieger' && !p.army);
    const pd = (k.reduce((s, p) => s + soldierPow(p, T.era | 0), 0) + Mt.length * 0.08 * ERA_POW[T.era | 0]) * (1.1 + (T.mil.doc === 'off' ? 0.3 : 0));
    const d = Math.hypot(A.x - T.cx, A.y - T.cy);
    // ohne Mauer lieber draußen kämpfen als die Häuser preisgeben (auch als Schwächere, notfalls mit den Bauern als
    // Miliz), hinter Mauern nur, wer genug Krieger hat und stark ist
    const walled = wallDef(T) > 0.3;
    if ((k.length < 2 && (walled || Mt.length < 16)) || d > 34 || d < T.R + 1.5 || pd < pa * (walled ? 0.9 : 0.5)) continue;
    T.intercept = S.warSince;
    const D = raise(st, T, S.id, T.id, S.id);
    if (D) chron(st, 'krieg', walled
      ? L(`${T.name} wartet nicht hinter den Mauern: ${D.ids.length} Krieger ziehen dem ${armyName(st, A)} entgegen.`, `${T.name} does not wait behind its walls: ${D.ids.length} warriors march out to meet the ${armyName(st, A).toLowerCase()}.`)
      : L(`${T.name} hat keine Mauer, hinter der es warten könnte: ${D.ids.length} Krieger ziehen dem ${armyName(st, A)} entgegen.`, `${T.name} has no wall to wait behind: ${D.ids.length} warriors march out to meet the ${armyName(st, A).toLowerCase()}.`), T.id, 1);
  }
  // Krieg, in dem nichts mehr geschieht (kein Heer, keine Schlacht): nach 60 Tagen Frieden ohne Sieger
  if (st.day % 6 === 4) for (const s of alive) {
    if (!s.war || !s.aggressor) continue;
    const T = rt.sById.get(s.war);
    const busy = st.armies.some(A => A.st !== 'gone' && (A.side === s.id || A.side === s.war)) || st.fights.some(F => !F.end && (F.town === s.id || F.town === s.war));
    if (!busy && st.day - s.warSince > 60) endWar(st, s, T, s.warScore === (T ? T.warScore : 0) ? null : s.warScore > (T ? T.warScore : 0) ? s : T);
  }
  const fog = st.weather && st.weather.kind === 'nebel';
  // laufende Schlachten
  for (const F of st.fights) {
    if (F.end) continue;
    const lost = fightDay(st, F);
    if (lost) endFight(st, F, lost);
  }
  // Heere bewegen sich
  for (const A of st.armies) {
    if (A.st === 'gone') continue;
    A.ids = A.ids.filter(id => rt.pById.has(id));
    if (!A.ids.length) { dissolve(st, A); continue; }
    const S = rt.sById.get(A.s), side = rt.sById.get(A.side), T = rt.sById.get(A.foe);
    if (!S || !S.alive) { dissolve(st, A); continue; }
    if (A.st === 'battle') continue;
    // Krieg vorbei (Frieden, Eroberung): heim
    const warOn = side && side.alive && T && T.alive && side.war === T.id;
    if (A.st !== 'home' && !warOn) { goHome(st, A, 'frieden'); }
    if (A.st === 'muster') { if (st.day - A.d0 >= 1) { A.st = 'march'; A.d0 = st.day; } continue; }
    if (A.st === 'siege') {
      if (fog) continue;
      const res = siegeDay(st, A, T);
      if (res === 'sturm') startFight(st, 'sturm', A, null, T, A.x, A.y);
      else if (res === 'ausfall') startFight(st, 'ausfall', A, null, T, A.x, A.y);
      else if (res === 'abzug') { chron(st, 'krieg', L(`Hunger im Lager: das ${armyName(st, A)} bricht die Belagerung von ${T.name} ab.`, `Hunger in the camp: the ${armyName(st, A).toLowerCase()} lifts the siege of ${T.name}.`), A.s, 1); goHome(st, A, 'hunger'); }
      continue;
    }
    if (A.st === 'guard') continue;
    // marschieren oder segeln
    const n = pathLen(A);
    const sea = onSea(A);
    const v = sea ? A.vs : A.v;
    // Halt vor dem Ziel: Lager außerhalb der Mauer
    // über das Meer: erst an Land gehen, dann halten (vorher lag das Lager bei kurzem Landweg im Wasser)
    const stopAt = A.st === 'home' ? n - 1 : Math.max(A.sea1 >= 0 ? Math.min(n - 1, A.sea1 + 1) : 0, n - 1 - stopDist(st, A, T));
    const pi0 = A.pi;
    A.px = A.x; A.py = A.y;
    A.pi = Math.min(stopAt, A.pi + v);
    A.dpi = A.pi - pi0; // für das Bild: so weit ist das Heer heute gezogen
    const [x, y] = pathAt(A, A.pi);
    A.x = x; A.y = y;
    // Seeschlacht vor der Landung, wenn der Gegner eine Flotte hat
    if (A.st !== 'home' && A.sea1 >= 0 && !A.seaWon && A.pi >= A.sea1 - 2 && A.pi < A.sea1 + 1 && T && navyOf(st, T) > 0 && !fog) {
      A.seaWon = true;
      const DF = raiseNavy(st, T, A);
      if (DF) { startFight(st, 'see', A, DF, T, x, y); continue; }
    }
    if (A.st === 'home') { if (A.pi >= n - 1) dissolve(st, A); continue; }
    if (A.pi >= stopAt) {
      // Hilfsheere des Verteidigers bleiben vor dessen Ort als Wache
      if (A.side === A.dest) { A.st = 'guard'; continue; }
      if (fog) continue;
      // Landung im Hafen hinter der Mauer: kein Lager davor, gleich der Sturm
      const inside = T.wall && T.wall.ring && Math.hypot(x - T.cx, y - T.cy) < ringAt(T.wall.ring, Math.atan2(y - T.cy, x - T.cx)) - 0.5;
      if (T.wall && T.wall.lvl && T.wall.hp >= 0.3 && !inside) { A.st = 'siege'; A.siegeDays = 0; }
      else startFight(st, 'sturm', A, null, T, x, y);
    }
  }
  // Feindliche Heere begegnen sich: nächster Abstand entlang beider Tageswege (sie springen sonst aneinander vorbei)
  if (!fog) for (let i = 0; i < st.armies.length; i++) {
    const A = st.armies[i];
    if (A.st === 'gone' || A.st === 'battle' || A.st === 'muster' || onSea(A)) continue;
    for (let j = i + 1; j < st.armies.length; j++) {
      const B = st.armies[j];
      if (B.st === 'gone' || B.st === 'battle' || B.st === 'muster' || onSea(B) || !isFoe(st, A, B)) continue;
      if (A.st === 'home' && B.st === 'home') continue;
      const m = meet(A, B);
      if (!m) continue;
      A.x = B.x = m[0]; A.y = B.y = m[1];
      const aggFirst = !!(rt.sById.get(A.side) || {}).aggressor;
      const att = aggFirst ? A : B, dfn = aggFirst ? B : A;
      startFight(st, 'feld', att, dfn, rt.sById.get(dfn.side), m[0], m[1]);
      break;
    }
  }
  if (st.armies.length > 40 || st.day % 12 === 0) st.armies = st.armies.filter(A => A.st !== 'gone');
  st.fights = st.fights.filter(F => !F.end || st.day - F.end < 2);
  void r;
}
// Heere halten vor dem Ort: an der Mauer oder am Ortsrand
function stopDist(st, A, T) {
  if (!T) return 0;
  const W = T.wall;
  return Math.round((W && W.lvl && W.ring ? Math.max(...W.ring) : T.R * 0.7) + 1.5);
}
// Wo kommen sich zwei Heere heute am nächsten (beide ziehen gleichmäßig von px,py nach x,y)? Unter 2,5 Feldern: Treffpunkt
function meet(A, B) {
  const ax = A.px ?? A.x, ay = A.py ?? A.y, bx = B.px ?? B.x, by = B.py ?? B.y;
  const rx = bx - ax, ry = by - ay, vx = (B.x - bx) - (A.x - ax), vy = (B.y - by) - (A.y - ay);
  const vv = vx * vx + vy * vy;
  const t = vv > 1e-9 ? clamp(-(rx * vx + ry * vy) / vv, 0, 1) : 1;
  const dx = rx + vx * t, dy = ry + vy * t;
  if (Math.hypot(dx, dy) > 2.5) return null;
  return [ax + (A.x - ax) * t + dx / 2, ay + (A.y - ay) * t + dy / 2];
}
function isFoe(st, A, B) {
  const sa = st._rt.sById.get(A.side), sb = st._rt.sById.get(B.side);
  return sa && sb && (sa.war === sb.id || sb.war === sa.id) && A.side !== B.side;
}
export function navyOf(st, s) {
  if (!knows(st, 'segeln', s)) return 0;
  return ((s.bon && s.bon.navy) || 0) + (bldOf(st, s).some(b => b.t === 'werft' || b.t === 'hafen') ? 1 : 0);
}
// Flotte der Verteidiger: Krieger des Ortes stechen in See, um die Landung zu verhindern
function raiseNavy(st, T, A) {
  const busy = new Set(); for (const q of st.armies) if (q.st !== 'gone') for (const id of q.ids) busy.add(id);
  const k = members(st, T).adults.filter(p => p.job === 'krieger' && !busy.has(p.id) && !p.sick);
  const n = Math.min(k.length, Math.max(2, Math.ceil(k.length * 0.6)));
  if (n < 2) return null;
  const ids = k.slice(0, n).map(p => p.id);
  const mil = T.mil || {};
  const D = {
    id: st.nextId++, s: T.id, side: T.id, foe: A.side, dest: T.id, kind: 'flotte', st: 'march', d0: st.day,
    ids, n0: ids.length, gen: 0, adm: mil.adm && ids.includes(mil.adm) ? mil.adm : ids[0], era: T.era | 0,
    path: [Math.round(A.x), Math.round(A.y), Math.round(A.x), Math.round(A.y)], sea0: 0, sea1: 1, pi: 0.5,
    v: 20, vs: 20, x: A.x + 1.2, y: A.y + 0.8, mor: 1, sup: 1, fight: 0, help: false, seaWon: true, def: true,
  };
  for (const id of ids) { const p = st._rt.pById.get(id); if (p) p.army = D.id; }
  st.armies.push(D);
  return D;
}

// Alte Spielstände: Felder anlegen (laufende Kriege bekommen beim nächsten Schritt ihr Heer)
export function initMilitary(st) {
  if (!st.armies) st.armies = [];
  if (!st.fights) st.fights = [];
  if (!st.milLog) st.milLog = [];
}
