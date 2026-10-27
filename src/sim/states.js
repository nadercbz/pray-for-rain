// Staaten, Bürgermeister, Parteien, Parlament, Regierung und das Miteinander der Völker (seit 24.10.2026,
// PLAN_ENTWICKLUNG.md Abschnitte 3 und 4, Naders Auftrag "überall Bürgermeister, Regierungen, Politiker, alle sollen
// miteinander interagieren"). Jeder Ort gehört zu genau einem Staat (s.state, st.states). Die Hauptstadt regiert: ihre
// Staatsform und ihre Gesetze gelten im ganzen Staat, ihr Oberhaupt ist das Staatsoberhaupt. Die anderen Orte haben
// Bürgermeister (Vorsteher, Vogt, Statthalter, Bürgermeister, Gouverneur je Staatsform und Epoche). Gewählte Staatsformen
// haben Parteien aus den Fraktionen, ein Parlament mit Sitzen, Koalitionen und einen Regierungschef. Jeder größere Staat
// hat ein Kabinett aus echten Menschen (Außen, Finanzen, Inneres, Wirtschaft, Bildung, Gesundheit, die Verteidigung führt
// der Verteidigungsminister der Hauptstadt aus military.js), das nach Können wirkt. Dazu Konjunktur, Unabhängigkeit,
// Vereinigung, Krieg als Sache des ganzen Staates, und zwischen den Staaten Staatsbesuche, Hungerhilfe, die Spiele der
// Völker und ab der Industrie der Rat der Völker.
// society.js und diplomacy.js rufen über die Haken in st._rt.pol (keine zyklischen Importe). Deterministisch, nur rng(st).
import * as D from './data.js';
import { clamp } from './rng.js';
import { chron, fx, rng, bio, members, ageOf, titleFor, sameLand, isleOf, setTerritory } from './util.js';
import { leaderOf, label, chooseLeader, install, endWar, LEADER_TITLE } from './society.js';
import { declareWar } from './diplomacy.js';
import { L } from '../i18n.js';

const YEAR = D.DAYS_PER_YEAR;
const FACS = ['volk', 'haendler', 'gelehrte', 'glaeubige', 'krieger'];
const hash01 = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const cap1 = t => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');
const count = (st, k) => { st.counts[k] = (st.counts[k] || 0) + 1; }; // Zähler für Prüfstände (tools/statestest.mjs)

// ---------- Namen ----------

// Staatsname nach Staatsform der Hauptstadt (ein einzelner Ort heißt wie der Ort)
const STATE_FORM = {
  rat: L('Bund von', 'League of'), haeuptling: L('Stammesreich', 'Tribal Realm of'), koenigtum: L('Königreich', 'Kingdom of'),
  theokratie: L('Gottesstaat', 'Theocracy of'), republik: L('Republik', 'Republic of'), demokratie: L('Republik', 'Republic of'),
  diktatur: L('Militärstaat', 'Military State of'), volksrat: L('Volksbund', 'People\'s League of'), technokratie: L('Technokratie', 'Technocracy of'),
};
export function stateName(st, S) {
  const c = st._rt.sById.get(S.cap);
  if (!c) return S.name || '?';
  const n = memberCount(st, S);
  if (n <= 1) return c.name;
  let form = STATE_FORM[c.gov.type] || L('Staat', 'State of');
  if (c.gov.type === 'demokratie' && n >= 4) form = L('Bundesrepublik', 'Federal Republic of');
  if (c.gov.type === 'koenigtum' && n >= 6 && c.era >= 4) form = L('Kaiserreich', 'Empire of');
  return `${form} ${c.name}`;
}
// Bürgermeister je Staatsform und Epoche (Schlüssel aus TITLES in util.js)
function mayorTitle(st, s) {
  const S = stateOf(st, s);
  if (!S || S.cap === s.id || memberCount(st, S) <= 1) return null;
  const c = st._rt.sById.get(S.cap);
  if (s.occ && st.day - s.occ < 30 * YEAR) return 'Statthalter';
  if (c && !sameLand(st, s, c) && s.era >= 4) return 'Gouverneur';
  const g = c ? c.gov.type : s.gov.type;
  if (g === 'koenigtum') return s.era < 4 ? 'Vogt' : 'Statthalter';
  if (g === 'theokratie') return 'Abt';
  if (g === 'diktatur') return 'Kommandant';
  if (g === 'technokratie') return 'Stadtverwalter';
  if (g === 'republik' || g === 'demokratie' || g === 'volksrat') return s.era >= 3 ? 'Bürgermeister' : 'Vorsteher';
  return 'Vorsteher';
}
const PARTY_NAMES = {
  volk: L(['Volkspartei', 'Bund des Volkes', 'Partei der Gemeinschaft', 'Arbeiterbund'], ['People\'s Party', 'League of the People', 'Party of Community', 'Workers\' League']),
  haendler: L(['Partei des Handels', 'Liberale Union', 'Bund der Kaufleute', 'Freie Partei'], ['Party of Trade', 'Liberal Union', 'League of Merchants', 'Free Party']),
  gelehrte: L(['Partei des Fortschritts', 'Union der Vernunft', 'Bund der Wissenden', 'Zukunftspartei'], ['Party of Progress', 'Union of Reason', 'League of the Learned', 'Future Party']),
  glaeubige: L(['Partei des Glaubens', 'Bund der Frommen', 'Heilige Liste', 'Partei der Werte'], ['Party of Faith', 'League of the Devout', 'Holy List', 'Party of Values']),
  krieger: L(['Partei der Ordnung', 'Wächterbund', 'Bund der Stärke', 'Nationale Front'], ['Party of Order', 'Guardians\' League', 'League of Strength', 'National Front']),
};
// Nähe der Parteien für Koalitionen
const CLOSE = { volk: ['gelehrte', 'glaeubige'], haendler: ['gelehrte', 'glaeubige'], gelehrte: ['haendler', 'volk'], glaeubige: ['krieger', 'volk'], krieger: ['glaeubige', 'haendler'] };
export const MINISTRIES = [
  ['aussen', L('Außen', 'Foreign Affairs')], ['finanz', L('Finanzen', 'Finance')], ['innen', L('Inneres', 'Interior')],
  ['wirt', L('Wirtschaft', 'Economy')], ['bildung', L('Bildung und Forschung', 'Education and Research')], ['gesund', L('Gesundheit', 'Health')],
];
export const ECON_NAME = { boom: L('Aufschwung', 'Boom'), normal: L('ruhig', 'steady'), krise: L('Krise', 'Recession') };

// ---------- Zugriff ----------

export const stateOf = (st, s) => (s && s.state ? st._rt.stById.get(s.state) : null);
function memberList(st, S) {
  const rt = st._rt;
  if (rt.memDay !== st.day || !rt.mem) {
    rt.mem = new Map(); rt.memDay = st.day;
    for (const s of st.settlements) if (s.alive && s.state) { let a = rt.mem.get(s.state); if (!a) rt.mem.set(s.state, a = []); a.push(s); }
  }
  return rt.mem.get(S.id) || [];
}
export const membersOfState = (st, S) => memberList(st, S);
const memberCount = (st, S) => memberList(st, S).length;
const dirty = st => { st._rt.memDay = -1; };
const statePop = (st, S) => memberList(st, S).reduce((a, s) => a + s.pop, 0);
export const isMember = (st, s) => { const S = stateOf(st, s); return !!S && S.cap !== s.id && memberCount(st, S) > 1; };
const capOf = (st, S) => st._rt.sById.get(S.cap);
const cultDist = (a, b) => { let d = 0, n = 0; for (const k of Object.keys(D.CULTURE)) { d += Math.abs((a.cult[k] || 0) - (b.cult[k] || 0)); n++; } return n ? d / n : 0; };

// ---------- Anlegen ----------

// Farbe eines neuen Staates: die des Ortes, wenn kein anderer lebender Staat sie trägt, sonst die seltenste der Palette
const PALETTE = ['#e07a5f', '#5fa8d3', '#e9c46a', '#8ab17d', '#b388eb', '#f4a261', '#d4708f', '#6fb7a8', '#c9a227', '#8a9bd4', '#c46b4a', '#7fb3c9', '#9c6fb3', '#5f9e6e', '#d98b5f', '#4f7fb0', '#c2b25a', '#b05a6b'];
function freeColor(st, own) {
  const used = new Map();
  for (const S of st.states || []) if (S.alive) used.set(S.col, (used.get(S.col) || 0) + 1);
  if (!used.get(own)) return own;
  return PALETTE.slice().sort((a, b) => (used.get(a) || 0) - (used.get(b) || 0))[0];
}
function newState(st, s, from = 0) {
  const S = { id: st.nextId++, name: s.name, cap: s.id, col: freeColor(st, s.color), founded: st.day, from, parties: [], parl: null, cab: {}, econ: { k: 'normal', until: st.day + 5 * YEAR }, alive: true };
  st.states.push(S);
  st._rt.stById.set(S.id, S);
  s.state = S.id;
  dirty(st);
  return S;
}
function joinState(st, s, S, how) {
  const old = stateOf(st, s);
  s.state = S.id;
  dirty(st);
  if (old && old !== S && old.cap === s.id) moveCapital(st, old);
  const c = capOf(st, S);
  if (c) { s.gov.type = c.gov.type; s.laws = c.laws.slice(); s.rel[c.id] = c.rel[s.id] = Math.max(s.rel[c.id] ?? 0, how === 'annex' ? -10 : 40); }
  if (how === 'annex') { s.occ = st.day; count(st, 'annex'); } else count(st, 'joins');
  // der bisherige Herrscher wird Bürgermeister (oder ein neuer wird bestimmt)
  const ld = leaderOf(st, s);
  if (ld) { const t = mayorTitle(st, s); if (t) ld.lt = titleFor(ld, t); }
  S.name = stateName(st, S);
}
// Hauptstadt fällt aus (verlassen, erobert, abgespalten): der größte verbliebene Ort übernimmt, sonst endet der Staat
function moveCapital(st, S) {
  const rest = memberList(st, S).filter(o => o.id !== S.cap && o.alive && o.state === S.id);
  if (!rest.length) { S.alive = false; S.ended = st.day; return; }
  const n = rest.sort((a, b) => b.pop - a.pop)[0];
  S.cap = n.id;
  const ld = leaderOf(st, n);
  if (ld) ld.lt = ''; // neu bestimmen: das Oberhaupt trägt den Titel der Staatsform
  n.gov.leader = null;
  chooseLeader(st, n, true);
  S.name = stateName(st, S);
  if (n.pop >= 20) chron(st, 'politik', L(`${n.name} wird die neue Hauptstadt von ${S.name}.`, `${n.name} becomes the new capital of ${S.name}.`), n.id, 1);
}

// Alte Spielstände: jeder lebende Ort bekommt seinen eigenen Staat. Haken für society.js und diplomacy.js
export function initStates(st) {
  const rt = st._rt;
  if (!st.states) st.states = [];
  rt.stById = new Map(st.states.map(S => [S.id, S]));
  for (const s of st.settlements) if (s.alive && (!s.state || !rt.stById.get(s.state) || !rt.stById.get(s.state).alive)) newState(st, s);
  rt.pol = {
    title: mayorTitle, member: isMember, election: stateElection, onFound, independent, join: joinUnion, annex, secede,
    sameState: (a, b) => !!a.state && a.state === b.state,
  };
}

// ---------- Haken aus society.js ----------

// neuer Ort: mit Mutterstadt gehört er zu deren Staat (Kolonie, Neugründung), sonst ein eigener Staat; eine Abspaltung
// (schismStep, opts.split) wird gleich ein eigener Staat und behält ihre neue Staatsform
function onFound(st, s, opts = {}) {
  const p = opts.parent;
  const S = p && stateOf(st, p);
  if (opts.split) { newState(st, s, S ? S.id : 0); if (S) S.name = stateName(st, S); return; }
  if (S && S.alive) { s.state = S.id; dirty(st); const c = capOf(st, S); if (c) { s.gov.type = c.gov.type; s.laws = c.laws.slice(); } S.name = stateName(st, S); }
  else newState(st, s);
}
// Abspaltung (schismStep): ein eigener Staat
function independent(st, ns, from) {
  const old = stateOf(st, from);
  newState(st, ns, old ? old.id : 0);
  if (old) old.name = stateName(st, old);
}
// friedlicher Anschluss eines kleinen Ortes (unionStep)
function joinUnion(st, small, big) { const S = stateOf(st, big); if (S) joinState(st, small, S, 'union'); }
// Eroberung: der Ort wird Teil des Staates, ein Statthalter regiert, der Ort bleibt bestehen
function annex(st, win, lose) {
  const S = stateOf(st, win);
  if (!S) return;
  for (const k of ['war', 'aggressor', 'warGoal', 'warName', 'warScore']) lose[k] = k === 'aggressor' ? false : null;
  lose.helpers = [];
  joinState(st, lose, S, 'annex');
  const ld = leaderOf(st, lose);
  if (ld) ld.lt = '';
  lose.gov.leader = null;
  chooseLeader(st, lose, true);
}
// Unabhängigkeit eines Ortes (Aufstand oder Bewegung)
function secede(st, s, how) {
  const S = stateOf(st, s);
  if (!S || S.cap === s.id) return false;
  const c = capOf(st, S);
  const N = newState(st, s, S.id);
  s.occ = 0;
  count(st, 'indep');
  const ld = leaderOf(st, s);
  if (ld) ld.lt = '';
  // weg von der Herrschaft der Hauptstadt: wer frei sein will, wählt eine freiere Ordnung, sofern bekannt
  if (['koenigtum', 'diktatur', 'theokratie'].includes(s.gov.type)) s.gov.type = s.era >= 3 ? 'republik' : 'rat';
  s.gov.leader = null; s.gov.since = st.day; s.gov.next = 0;
  chooseLeader(st, s, true);
  if (c) {
    s.rel[c.id] = c.rel[s.id] = Math.min(s.rel[c.id] ?? 0, -35);
    c.grudge = c.grudge || {}; c.grudge[s.id] = (c.grudge[s.id] || 0) + 45;
  }
  S.name = stateName(st, S); N.name = stateName(st, N);
  s.unrest = clamp(s.unrest - 0.35, 0, 1);
  chron(st, 'politik', how === 'aufstand'
    ? L(`Aufstand in ${s.name}! Die Menschen jagen die Beamten von ${S.name} davon und erklären sich für unabhängig.`, `Uprising in ${s.name}! The people drive out the officials of ${S.name} and declare independence.`)
    : L(`${s.name} erklärt die Unabhängigkeit von ${S.name}. ${label(leaderOf(st, s))} führt den neuen Staat.`, `${s.name} declares independence from ${S.name}. ${label(leaderOf(st, s))} leads the new state.`), s.id, 2);
  fx(st, { type: 'independence', s: s.id });
  setTerritory(st); // Gebietsfarben nach Staat neu
  // manchmal will die alte Hauptstadt den Ort zurück: Unabhängigkeitskrieg (seit 24.10.2026)
  const r = rng(st);
  if (c && c.alive && !c.war && !s.war && c.pop >= 12 && s.pop >= 8 && r.chance(how === 'aufstand' ? 0.5 : 0.3)) declareWar(st, c, s, 'abfall');
  return true;
}

// ---------- Parteien und Wahlen ----------

function ensureParties(st, S) {
  const r = rng(st), sets = memberList(st, S), tot = sets.reduce((a, s) => a + s.pop, 0) || 1;
  const share = {};
  for (const f of FACS) share[f] = sets.reduce((a, s) => a + (s.fac ? s.fac[f] || 0 : 0.2) * s.pop, 0) / tot;
  // neue Parteien, wo eine Fraktion Gewicht hat; Parteien ohne Anhang lösen sich auf
  for (const f of FACS) {
    let P = S.parties.find(q => q.fac === f);
    if (!P && share[f] >= 0.07) {
      const names = PARTY_NAMES[f], k = Math.floor(hash01(S.id, FACS.indexOf(f) + (S.gen || 0)) * names.length);
      P = { id: st.nextId++, fac: f, name: names[k], col: D.FACTIONS[f].color, lead: 0, since: st.day };
      S.parties.push(P);
      if (statePop(st, S) >= 60 && S.parties.length > 1) chron(st, 'politik', L(`In ${S.name} gründet sich eine neue Partei: ${P.name}.`, `A new party is founded in ${S.name}: ${P.name}.`), S.cap, 0);
    }
    // wer noch Sitze im Parlament hat, bleibt bis zur nächsten Wahl
    if (P && share[f] < 0.03 && !(S.parl && P.id in S.parl.seats)) { S.parties = S.parties.filter(q => q !== P); continue; }
    if (!P) continue;
    P.share = share[f];
    // Parteichef: der überzeugendste Kopf der Fraktion im Staat (in der Hauptstadt lieber)
    const cur = P.lead && st._rt.pById.get(P.lead);
    if (!cur || !inState(st, cur, S) || ageOf(st, cur) > 78) {
      let best = null, bs = -1;
      for (const s of sets) for (const p of members(st, s).adults.concat(members(st, s).old)) {
        if (p.fac !== f || ageOf(st, p) < 28 || ageOf(st, p) > 75) continue;
        const sc = p.tr.charisma + p.fame * 0.04 + (s.id === S.cap ? 0.8 : 0) + r.next() * 0.2;
        if (sc > bs) { bs = sc; best = p; }
      }
      P.lead = best ? best.id : 0;
      if (best) bio(best, st.day, L(`führt die ${P.name}`, `leads the ${P.name}`));
    }
  }
}
const inState = (st, p, S) => { const s = st._rt.sById.get(p.s); return !!s && s.state === S.id; };

// Staatswahl statt Ortswahl (aus society.election): Parteien, Sitze, Koalition, Regierungschef. true = erledigt
function stateElection(st, s, quiet) {
  const S = stateOf(st, s);
  if (!S || S.cap !== s.id) return false;
  const G = D.GOVS[s.gov.type];
  if (!G.elect || statePop(st, S) < 40) return false;
  ensureParties(st, S);
  const parts = S.parties.filter(P => P.lead && st._rt.pById.get(P.lead));
  if (parts.length < 2) return false;
  const r = rng(st), rt = st._rt, head = leaderOf(st, s);
  const pop = statePop(st, S);
  const total = clamp(Math.round(12 + pop / 25), 12, 150);
  // Stimmen: Anhang der Fraktion in allen Orten, Ausstrahlung des Spitzenkandidaten, Amtsbonus, Geld, Zufall
  const votes = parts.map(P => {
    const ld = rt.pById.get(P.lead);
    let v = (P.share || 0.05) * (0.8 + ld.tr.charisma * 0.45) * r.range(0.85, 1.15);
    if (head && head.fac === P.fac) v *= 1.04;
    if (S.econ.k === 'krise' && head && head.fac === P.fac) v *= 0.82; // in der Krise wird die Regierung abgestraft
    v *= 1 + Math.min(0.2, Math.log10(1 + Math.max(0, ld.gold || 0) / ((s.avgWage || 1) * 50)) * 0.12);
    return [P, Math.max(0.001, v)];
  });
  const sum = votes.reduce((a, x) => a + x[1], 0);
  // Sitze nach dem Verfahren der größten Reste
  const raw = votes.map(([P, v]) => [P, v / sum * total]);
  const seats = new Map(raw.map(([P, x]) => [P.id, Math.floor(x)]));
  let left = total - [...seats.values()].reduce((a, x) => a + x, 0);
  for (const [P] of raw.slice().sort((a, b) => (b[1] % 1) - (a[1] % 1))) { if (left-- <= 0) break; seats.set(P.id, seats.get(P.id) + 1); }
  // Koalition: stärkste Partei, dann die nächstliegenden, bis die Mehrheit steht
  const order = parts.slice().sort((a, b) => seats.get(b.id) - seats.get(a.id));
  const coal = [order[0]];
  let have = seats.get(order[0].id);
  while (have <= total / 2) {
    const rest = order.filter(P => !coal.includes(P));
    if (!rest.length) break;
    const pick = rest.sort((a, b) => (seats.get(b.id) + (CLOSE[coal[0].fac].includes(b.fac) ? total * 0.12 : 0)) - (seats.get(a.id) + (CLOSE[coal[0].fac].includes(a.fac) ? total * 0.12 : 0)))[0];
    coal.push(pick); have += seats.get(pick.id);
  }
  // Regierungschef: der Parteichef, wenn er in der Hauptstadt wohnt, sonst der stärkste Kopf der Partei dort
  let winner = rt.pById.get(order[0].lead);
  if (winner.s !== s.id) {
    let best = null, bs = -1;
    for (const p of members(st, s).adults.concat(members(st, s).old)) { if (p.fac !== order[0].fac || ageOf(st, p) < 28) continue; const sc = p.tr.charisma + p.fame * 0.04; if (sc > bs) { bs = sc; best = p; } }
    if (best) winner = best;
  }
  // wer anderswo Bürgermeister war, gibt das Amt ab
  const elsewhere = st.settlements.find(o => o.alive && o !== s && o.gov.leader === winner.id);
  if (elsewhere) elsewhere.gov.leader = null;
  S.parl = { seats: Object.fromEntries(seats), total, coal: coal.map(P => P.id), last: st.day, next: st.day + (G.elect || 5) * YEAR };
  s.gov.next = S.parl.next;
  const prev = s.gov.leader;
  install(st, s, winner, true);
  winner.party = order[0].id;
  if (!quiet) {
    const list = order.slice(0, 4).map(P => `${P.name} ${seats.get(P.id)}`).join(', ');
    const coalTxt = coal.length > 1 ? L(` Koalition aus ${coal.map(P => P.name).join(' und ')}.`, ` Coalition of ${coal.map(P => P.name).join(' and ')}.`) : L(` ${order[0].name} regiert allein.`, ` ${order[0].name} governs alone.`);
    chron(st, 'politik', L(`Wahl in ${S.name} (${total} Sitze): ${list}.${coalTxt} ${winner.n} wird ${winner.lt}${prev === winner.id ? ', zum zweiten Mal' : ''}.`, `Election in ${S.name} (${total} seats): ${list}.${coalTxt} ${winner.n} becomes ${winner.lt}${prev === winner.id ? ' again' : ''}.`), s.id, 1);
  }
  cabinet(st, S, true);
  count(st, 'stateElect');
  return true;
}

// ---------- Kabinett ----------

function cabinet(st, S, fresh) {
  const r = rng(st), sets = memberList(st, S), c = capOf(st, S);
  if (!c || statePop(st, S) < 30 || c.era < 2) { S.cab = {}; return; }
  const head = leaderOf(st, c), coalFac = S.parl ? S.parl.coal.map(id => (S.parties.find(P => P.id === id) || {}).fac) : null;
  const taken = new Set([head ? head.id : 0, c.mil && c.mil.min]);
  for (const s of sets) if (s.gov.leader) taken.add(s.gov.leader); // Bürgermeister bleiben in ihrem Ort
  const score = {
    aussen: p => p.tr.charisma * 1.2 + (p.job === 'haendler' ? 0.3 : 0) + p.fame * 0.04,
    finanz: p => p.tr.fleiss + (p.job === 'haendler' ? 0.6 : 0) + ((p.cls || 0) >= 2 ? 0.3 : 0),
    innen: p => p.tr.mut * 0.8 + p.tr.charisma * 0.5 + (p.job === 'krieger' ? 0.3 : 0),
    wirt: p => p.tr.fleiss + (p.job === 'haendler' || p.job === 'handwerker' ? 0.5 : 0),
    bildung: p => p.tr.neugier + (p.job === 'gelehrter' ? 0.8 : 0) + (p.edu || 0) * 0.3,
    gesund: p => p.tr.neugier * 0.5 + (p.job === 'heiler' ? 0.9 : 0) + p.tr.fleiss * 0.3,
  };
  for (const [k] of MINISTRIES) {
    const cur = S.cab[k] && st._rt.pById.get(S.cab[k].id);
    if (!fresh && cur && inState(st, cur, S) && ageOf(st, cur) < 76 && !taken.has(cur.id)) { taken.add(cur.id); continue; }
    let best = null, bs = -1;
    for (const s of sets) for (const p of members(st, s).adults) {
      if (taken.has(p.id) || ageOf(st, p) < 25 || ageOf(st, p) > 72) continue;
      const sc = score[k](p) + (coalFac && coalFac.includes(p.fac) ? 0.5 : 0) + (s.id === S.cap ? 0.2 : 0) + r.next() * 0.25;
      if (sc > bs) { bs = sc; best = p; }
    }
    if (!best) { delete S.cab[k]; continue; }
    taken.add(best.id);
    const old = cur ? cur.id : 0;
    S.cab[k] = { id: best.id, c: Math.round(clamp(bs / 2.2, 0.15, 1) * 100) / 100, since: st.day };
    if (old !== best.id) bio(best, st.day, L(`wird Minister für ${MINISTRIES.find(m => m[0] === k)[1]} in ${S.name}`, `becomes minister of ${MINISTRIES.find(m => m[0] === k)[1].toLowerCase()} in ${S.name}`));
  }
}

// ---------- Jahreslauf ----------

export function statesStep(st) {
  const rt = st._rt, r = rng(st);
  // Orte ohne Staat (die ersten Orte einer neuen Welt entstehen vor initStates) bekommen ihren eigenen
  for (const s of st.settlements) if (s.alive && (!s.state || !(rt.stById.get(s.state) || {}).alive)) newState(st, s);
  // Hauptstädte prüfen (verlassene Orte), tote Staaten aufräumen
  for (const S of st.states) {
    if (!S.alive) continue;
    const c = capOf(st, S);
    if (!c || !c.alive || c.state !== S.id) moveCapital(st, S);
  }
  aidStep(st, r);
  if (st.day % YEAR !== 6) return; // statesStep läuft an jedem sechsten Tag (core.js), der Jahrestag muss darauf fallen
  dirty(st);
  const live = st.states.filter(S => S.alive && memberCount(st, S));
  for (const S of st.states) if (S.alive && !memberCount(st, S)) { S.alive = false; S.ended = st.day; }
  rt.sb = new Map();
  for (const S of live) {
    const c = capOf(st, S), sets = memberList(st, S);
    // Mitglieder folgen der Hauptstadt: Staatsform und Gesetze, Bürgermeister mit dem passenden Titel
    for (const s of sets) {
      if (s === c) continue;
      if (s.gov.type !== c.gov.type) { s.gov.type = c.gov.type; s.gov.next = Math.max(s.gov.next || 0, st.day + YEAR); }
      s.laws = c.laws.slice();
      const ld = leaderOf(st, s), t = mayorTitle(st, s);
      if (ld && t && ld.id !== c.gov.leader) ld.lt = titleFor(ld, t);
      s.rel[c.id] = c.rel[s.id] = Math.min(60, (s.rel[c.id] ?? 30) + 1);
    }
    S.name = stateName(st, S);
    const h = leaderOf(st, c); // Titel des Oberhaupts passt zur Staatsform (nach Umsturz oder Vereinigung)
    if (h) h.lt = titleFor(h, LEADER_TITLE[c.gov.type]);
    if (D.GOVS[c.gov.type].elect) ensureParties(st, S); else { S.parties = []; S.parl = null; }
    cabinet(st, S, false);
    econStep(st, S, r);
    // Wirkung der Minister und der Konjunktur auf alle Orte des Staates (core.js liest rt.sb)
    const cc = k => (S.cab[k] ? S.cab[k].c : 0);
    const work = cc('wirt') * 0.06 + cc('finanz') * 0.02 + (S.econ.k === 'boom' ? 0.08 : S.econ.k === 'krise' ? -0.1 : 0);
    const bon = { work, know: cc('bildung') * 0.08, health: cc('gesund') * 0.08 };
    for (const s of sets) {
      rt.sb.set(s.id, bon);
      s.unrest = clamp(s.unrest - cc('innen') * 0.04 + (S.econ.k === 'krise' ? 0.04 : 0), 0, 1);
    }
    // Skandale
    for (const [k, nm] of MINISTRIES) {
      const m = S.cab[k] && rt.pById.get(S.cab[k].id);
      if (!m || !r.chance(0.025)) continue;
      const why = r.pick(L(['Bestechung', 'eine Affäre', 'verschwundene Gelder', 'ein Streit mit dem Oberhaupt', 'eine missglückte Rede'], ['bribery', 'an affair', 'missing funds', 'a quarrel with the head of state', 'a disastrous speech']));
      delete S.cab[k];
      bio(m, st.day, L(`tritt als Minister zurück (${why})`, `resigns as minister (${why})`));
      for (const s of sets) s.unrest = clamp(s.unrest + 0.02, 0, 1);
      if (statePop(st, S) >= 80) chron(st, 'politik', L(`Skandal in ${S.name}: ${m.n}, Minister für ${nm}, tritt zurück. Der Grund: ${why}.`, `Scandal in ${S.name}: ${m.n}, minister of ${nm.toLowerCase()}, resigns. The reason: ${why}.`), S.cap, 0);
    }
  }
  secessionStep(st, live, r);
  unificationStep(st, r);
  worldStep(st, r);
}

// Konjunktur: Aufschwung, ruhige Jahre, Krise; Krieg und Hunger machen Krisen wahrscheinlicher, Fortschritt Aufschwünge
function econStep(st, S, r) {
  if (st.day < S.econ.until) return;
  const c = capOf(st, S), sets = memberList(st, S);
  const war = sets.some(s => s.war), hunger = sets.reduce((a, s) => a + s.hunger * s.pop, 0) / Math.max(1, statePop(st, S));
  const wb = 0.3 + (c.era >= 6 ? 0.08 : 0), wk = 0.18 + (war ? 0.25 : 0) + hunger * 0.6;
  const x = r.next() * (wb + wk + 0.5);
  const k = x < wb ? 'boom' : x < wb + wk ? 'krise' : 'normal';
  const was = S.econ.k;
  S.econ = { k, until: st.day + r.int(3, 9) * YEAR, since: st.day };
  if (k !== was && k !== 'normal' && statePop(st, S) >= 60) chron(st, k === 'boom' ? 'fest' : 'politik', k === 'boom'
    ? L(`In ${S.name} beginnt ein Aufschwung: volle Märkte, neue Werkstätten, Arbeit für alle.`, `A boom begins in ${S.name}: full markets, new workshops, work for everyone.`)
    : L(`${S.name} rutscht in eine Krise. Werkstätten schließen, die Menschen sorgen sich um morgen.`, `${S.name} slides into a recession. Workshops close and people worry about tomorrow.`), S.cap, 0);
}

// Unabhängigkeit: unzufriedene, besetzte, ferne oder fremde Orte lösen sich
function secessionStep(st, live, r) {
  for (const S of live) {
    const c = capOf(st, S);
    if (!c) continue;
    for (const s of memberList(st, S).slice()) {
      if (s === c || s.pop < 15 || s.war) continue;
      const occ = s.occ && st.day - s.occ < 30 * YEAR ? 0.35 * (1 - (st.day - s.occ) / (30 * YEAR)) : 0;
      // Kolonien in Übersee: der Wunsch nach Selbstständigkeit wächst mit den Jahrzehnten (wie in der echten Geschichte)
      const far = sameLand(st, s, c) ? 0 : 0.18 + Math.min(0.3, (st.day - (s.founded || 0)) / (300 * YEAR));
      // große Reiche sind schwer zu halten: ab fünf Orten wächst der Druck (Messung 24.10.2026: sonst ein Staat für die ganze Welt)
      const big = clamp((memberCount(st, S) - 4) / 16, 0, 0.25);
      const p = s.unrest * 0.9 + occ + far + big + cultDist(s, c) * 0.8 + (c.war ? 0.05 : 0) + (s.pop > c.pop * 0.6 ? 0.1 : 0) - (s.rel[c.id] ?? 40) / 250;
      if (p > 0.6 && r.chance((p - 0.6) * 0.5)) { secede(st, s, 'bewegung'); return; }
    }
  }
}

// Vereinigung zweier befreundeter Staaten mit ähnlicher Kultur (der kleinere tritt dem größeren bei)
function unificationStep(st, r) {
  const live = st.states.filter(S => S.alive && memberCount(st, S));
  for (const A of live) for (const B of live) {
    if (A === B || statePop(st, A) < statePop(st, B)) continue;
    const ca = capOf(st, A), cb = capOf(st, B);
    if (!ca || !cb || ca.era < 4 || cb.era < 4 || ca.war || cb.war) continue;
    if ((ca.rel[cb.id] ?? 0) < 80 || cultDist(ca, cb) > 0.18) continue;
    // die anderen Völker dulden keine Übermacht: höchstens die Hälfte aller Menschen in einem Staat
    if (statePop(st, A) + statePop(st, B) > st.people.length * 0.5) continue;
    const Ia = isleOf(st, ca), Ib = isleOf(st, cb);
    if (!sameLand(st, ca, cb) && !(Ia && Ib && Ia.contact[Ib.id])) continue;
    if (memberList(st, B).some(s => s.war) || !r.chance(0.015)) continue;
    const oldB = B.name;
    for (const s of memberList(st, B).slice()) joinState(st, s, A, 'union');
    B.alive = false; B.ended = st.day; B.endedBy = A.id;
    count(st, 'unify');
    A.name = stateName(st, A);
    chron(st, 'politik', L(`Vereinigung! ${oldB} und ${ca.name} werden ein Staat: ${A.name}. Auf den Plätzen wehen neue Fahnen.`, `Unification! ${oldB} and ${ca.name} become one state: ${A.name}. New flags fly over the squares.`), ca.id, 2);
    fx(st, { type: 'union', a: ca.id, b: cb.id });
    setTerritory(st);
    return;
  }
}

// ---------- Zwischen den Staaten ----------

// Rivalen (seit 25.10.2026, gegen das Erstarren im Zeitraffer): hatten zwei Staaten mit Kontakt 50 Jahre keinen Krieg,
// bricht zwischen ihnen mit gut einem Prozent im Jahr ein Grenzkrieg aus (in der Krise doppelt so oft). Angreifer ist der
// machthungrigere Staat, gekämpft wird zwischen den nächsten Orten mit mindestens 12 Menschen.
function rivalStep(st, r, live) {
  const lastWar = S => Math.max(S.founded || 0, ...memberList(st, S).map(s => s.lastWar || 0));
  const busy = S => memberList(st, S).some(s => s.war);
  for (let a = 0; a < live.length; a++) for (let b = a + 1; b < live.length; b++) {
    let A = live[a], B = live[b];
    if (!contactStates(st, A, B) || busy(A) || busy(B)) continue;
    if (st.day - Math.max(lastWar(A), lastWar(B)) < 50 * YEAR) continue;
    const crisis = (A.econ && A.econ.k === 'krise') || (B.econ && B.econ.k === 'krise');
    if (!r.chance(crisis ? 0.025 : 0.012)) continue;
    if ((capOf(st, B).cult.macht || 0) > (capOf(st, A).cult.macht || 0)) [A, B] = [B, A];
    const ca = capOf(st, A), big = s => s.pop >= 12;
    const def = memberList(st, B).filter(big).sort((p, q) => Math.hypot(p.cx - ca.cx, p.cy - ca.cy) - Math.hypot(q.cx - ca.cx, q.cy - ca.cy))[0];
    const agg = def && memberList(st, A).filter(big).sort((p, q) => Math.hypot(p.cx - def.cx, p.cy - def.cy) - Math.hypot(q.cx - def.cx, q.cy - def.cy))[0];
    if (!agg || !def) continue;
    agg.rel[def.id] = def.rel[agg.id] = Math.min(agg.rel[def.id] ?? 0, -20);
    declareWar(st, agg, def, 'grenze');
    return; // höchstens ein neuer Krieg im Jahr
  }
}

function contactStates(st, A, B) {
  const ca = capOf(st, A), cb = capOf(st, B);
  if (!ca || !cb) return false;
  const Ia = isleOf(st, ca), Ib = isleOf(st, cb);
  return sameLand(st, ca, cb) || !!(Ia && Ib && (Ia === Ib || Ia.contact[Ib.id]));
}
// Hilfe bei Hunger (alle 6 Tage, Hunger dauert oft nur Tage): ein befreundeter Ort mit vollen Speichern schickt Nahrung, je Ort höchstens einmal im Jahr
function aidStep(st, r) {
  for (const s of st.settlements) {
    if (!s.alive || s.hunger < 0.15 || s.pop < 10 || st.day - (s.aidAt ?? -YEAR) < YEAR) continue;
    const S = stateOf(st, s);
    let best = null, bs = 0;
    for (const o of st.settlements) {
      if (!o.alive || o === s || o.war === s.id || (o.rel[s.id] ?? 0) < 25) continue;
      const surplus = o.stock.food - o.pop * 20;
      if (surplus > bs) { bs = surplus; best = o; }
    }
    if (!best || !r.chance(0.6)) continue;
    count(st, 'aid');
    s.aidAt = st.day;
    const amt = Math.min(best.stock.food * 0.15, s.pop * 15);
    best.stock.food -= amt; s.stock.food += amt;
    s.rel[best.id] = best.rel[s.id] = clamp((s.rel[best.id] ?? 0) + 6, -100, 100);
    const own = S && stateOf(st, best) === S;
    if (s.pop >= 20) chron(st, 'politik', own
      ? L(`${best.name} schickt Wagen voller Korn nach ${s.name}. Im Staat lässt man niemanden hungern.`, `${best.name} sends wagons full of grain to ${s.name}. Within the state, no one is left to starve.`)
      : L(`Hilfe aus ${best.name}: Getreide und Fisch erreichen das hungernde ${s.name}.`, `Aid from ${best.name}: grain and fish reach starving ${s.name}.`), s.id, 0);
  }
}
function worldStep(st, r) {
  const live = st.states.filter(S => S.alive && memberCount(st, S) && statePop(st, S) >= 10);
  const rel = (A, B, d) => { const ca = capOf(st, A), cb = capOf(st, B); ca.rel[cb.id] = cb.rel[ca.id] = clamp((ca.rel[cb.id] ?? 0) + d, -100, 100); };
  rivalStep(st, r, live);
  // Staatsbesuche
  for (const A of live) for (const B of live) {
    if (A.id >= B.id || !contactStates(st, A, B)) continue;
    const ca = capOf(st, A), cb = capOf(st, B);
    if ((ca.rel[cb.id] ?? 0) < 15 || ca.war === cb.id || !r.chance(0.04)) continue;
    rel(A, B, 8);
    const h = leaderOf(st, ca);
    if (h) chron(st, 'politik', L(`Staatsbesuch: ${label(h)} von ${A.name} reist nach ${cb.name}. Man tauscht Geschenke und Versprechen.`, `State visit: ${label(h)} of ${A.name} travels to ${cb.name}. Gifts and promises are exchanged.`), ca.id, 0);
  }
  // Spiele der Völker alle vier Jahre ab der Stadtstaatenzeit
  const y = Math.floor(st.day / YEAR);
  const olders = live.filter(S => (capOf(st, S).era | 0) >= 3);
  if (y % 4 === 2 && olders.length >= 2) {
    const host = olders.map(S => capOf(st, S)).filter(c => c.id !== (st.games && st.games.host)).sort((a, b) => b.pop - a.pop)[0];
    if (host) {
      const H = stateOf(st, host);
      const guests = olders.filter(S => S === H || contactStates(st, S, H));
      if (guests.length >= 2) {
        const win = guests.slice().sort((a, b) => statePop(st, b) * (0.6 + r.next()) - statePop(st, a) * (0.6 + r.next()))[0];
        for (const A of guests) for (const B of guests) if (A.id < B.id && capOf(st, A).war !== capOf(st, B).id) rel(A, B, 4);
        host.unrest = clamp(host.unrest - 0.05, 0, 1);
        st.games = { host: host.id, y, win: win.id, n: guests.length, count: ((st.games && st.games.count) || 0) + 1 };
        count(st, 'games');
        chron(st, 'fest', L(`Die ${st.games.count}. Spiele der Völker in ${host.name}: ${guests.length} Staaten schicken ihre Besten. ${win.name} gewinnt die meisten Kränze.`, `The ${st.games.count}th Games of the Nations in ${host.name}: ${guests.length} states send their best. ${win.name} wins the most laurels.`), host.id, 1);
        fx(st, { type: 'games', s: host.id });
      }
    }
  }
  // Rat der Völker ab der Industrie: Sitzung jedes Jahr, Beschlüsse für Frieden, Hilfe und Handel
  const modern = live.filter(S => (capOf(st, S).era | 0) >= 6);
  if (!st.council && modern.length >= 2) {
    const seat = modern.map(S => capOf(st, S)).sort((a, b) => b.pop - a.pop)[0];
    st.council = { founded: st.day, seat: seat.id, sessions: 0, name: L('Rat der Völker', 'Council of Nations') };
    chron(st, 'politik', L(`In ${seat.name} gründen die Völker den Rat der Völker. Streit soll künftig mit Worten beigelegt werden, nicht mit Waffen.`, `In ${seat.name}, the nations found the Council of Nations. From now on, disputes are to be settled with words, not weapons.`), seat.id, 2);
  }
  if (st.council) {
    const C = st.council, seat = st._rt.sById.get(C.seat);
    if (!seat || !seat.alive) { const m = modern.map(S => capOf(st, S)).sort((a, b) => b.pop - a.pop)[0]; if (m) C.seat = m.id; }
    const mem = live.filter(S => (capOf(st, S).era | 0) >= 5 && (!seat || contactStates(st, S, stateOf(st, seat) || S)));
    C.members = mem.map(S => S.id);
    C.sessions++;
    const wars = st.settlements.filter(s => s.alive && s.war && s.aggressor && mem.some(S => S.id === s.state));
    let txt;
    if (wars.length) {
      const a = wars[0], b = st._rt.sById.get(a.war);
      if (b && r.chance(0.35)) { endWar(st, a, b, null); txt = L(`Der Rat der Völker vermittelt zwischen ${a.name} und ${b.name}. Die Waffen schweigen.`, `The Council of Nations mediates between ${a.name} and ${b.name}. The guns fall silent.`); }
      else txt = L(`Der Rat der Völker ruft ${a.name} und ${b ? b.name : ''} zum Frieden auf. Noch hört niemand.`, `The Council of Nations calls on ${a.name} and ${b ? b.name : ''} to make peace. No one listens yet.`);
    } else {
      for (const A of mem) for (const B of mem) if (A.id < B.id) rel(A, B, 2);
      txt = r.pick(L([
        'Der Rat der Völker beschließt freien Handel zwischen allen Mitgliedern.',
        'Der Rat der Völker gründet einen gemeinsamen Fonds gegen Hunger und Seuchen.',
        'Der Rat der Völker schützt die Meere und die alten Wälder.',
        'Der Rat der Völker teilt das Wissen seiner Gelehrten mit allen Mitgliedern.',
      ], [
        'The Council of Nations agrees on free trade among all members.',
        'The Council of Nations founds a common fund against hunger and plague.',
        'The Council of Nations protects the seas and the ancient forests.',
        'The Council of Nations shares the knowledge of its scholars with all members.',
      ]));
    }
    if (mem.length >= 2 && (C.sessions % 2 === 1 || wars.length)) chron(st, 'politik', `${txt} ${L(`(Sitzung in ${(st._rt.sById.get(C.seat) || {}).name || '?'}, ${mem.length} Staaten)`, `(Session in ${(st._rt.sById.get(C.seat) || {}).name || '?'}, ${mem.length} states)`)}`, C.seat, 1);
  }
}

// Krieg ist Sache des ganzen Staates: die anderen Orte ziehen mit (aus diplomacy.declareWar)
export function stateHelpers(st, agg, def) {
  for (const [x, foe] of [[agg, def], [def, agg]]) {
    const S = stateOf(st, x);
    if (!S || memberCount(st, S) < 2) continue;
    let n = 0;
    for (const m of memberList(st, S)) {
      if (m === x || m.war || m.pop < 8 || (x.helpers || []).includes(m.id)) continue;
      (x.helpers || (x.helpers = [])).push(m.id);
      m.rel[foe.id] = foe.rel[m.id] = Math.min(m.rel[foe.id] ?? 0, -25);
      n++;
    }
    if (n && statePop(st, S) >= 40) chron(st, 'krieg', L(`Der ganze Staat zieht mit: ${n} ${n === 1 ? 'Ort' : 'Orte'} von ${S.name} ${n === 1 ? 'schickt' : 'schicken'} Truppen für ${x.name}.`, `The whole state goes to war: ${n} ${n === 1 ? 'town' : 'towns'} of ${S.name} ${n === 1 ? 'sends' : 'send'} troops for ${x.name}.`), x.id, 1);
  }
}
export { cap1 as capName };
