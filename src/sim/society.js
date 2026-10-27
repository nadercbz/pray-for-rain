// Gesellschaft: Fraktionen, Herrschaft, Gesetze, Wahlen, Aufstände, Diplomatie, Krieg,
// neue Siedlungen, Gebete und kleine Ereignisse.
import { refreshProgress } from './progress.js';
import * as D from './data.js';
import { clamp } from './rng.js';
import { idx, inb } from './world.js';
import { LANGS, placeName } from './names.js';
import {
  ageOf, knows, chron, fx, bio, makePerson, killPerson, members, shiftCult, rng, titleFor,
  seasonOf, setTerritory, distTo, addBuilding, removeBuilding, isleOf, landOf, landRec, sameLand, bumpBuildings, bldOf,
} from './util.js';
import { earthSeaTarget } from './folks.js';
import { SQUARE, BUILT } from './cityplan.js';
import { abandonTown, clearRuinsNear } from './decay.js';
import { newSettlement, findSite, indexMembers } from './core.js';
import { newcomers } from './powers.js';
import { L } from '../i18n.js';
import { isleGap, knownCoast } from './explore.js';
import { reach } from './sea.js';
import { plunder, tribute, wealthOf, inheritIsle } from './money.js';
import { makePeace, GOALS } from './diplomacy.js';

export const LEADER_TITLE = {
  rat: 'Ältester', haeuptling: 'Häuptling', koenigtum: 'König', theokratie: 'Hohepriester', republik: 'Konsul',
  demokratie: 'Präsident', diktatur: 'General', volksrat: 'Sprecher', technokratie: 'Kanzler',
};

export const leaderOf = (st, s) => (s.gov.leader ? st._rt.pById.get(s.gov.leader) : null);
export const label = p => (p ? `${p.lt || p.title ? (p.lt || p.title) + ' ' : ''}${p.n}` : L('niemand', 'nobody'));
// Todesursachen erscheinen in der Ahnenhalle
const CAUSE_REVOLT = L('Aufstand', 'Uprising');
export const CAUSE_WAR = L('Krieg', 'War');

// ---------- Fraktionen ----------

const JOB_FAC = { priester: ['glaeubige', 1.2], krieger: ['krieger', 1.2], haendler: ['haendler', 1.2], gelehrter: ['gelehrte', 1.2], heiler: ['gelehrte', 0.6], kuenstler: ['gelehrte', 0.4], bauer: ['volk', 0.5], fischer: ['volk', 0.5], arbeiter: ['volk', 0.8], sammler: ['volk', 0.4], handwerker: ['haendler', 0.3], baumeister: ['volk', 0.3] };
const INFL = { priester: 2, krieger: 1.6, haendler: 1.8, gelehrter: 1.4, heiler: 1.2, kuenstler: 1.2, alt: 1.3 };

function factionOf(p) {
  const sc = { glaeubige: p.tr.glaube * 1.1 + p.faith * 0.6, krieger: p.tr.mut * 0.5 + p.tr.wut * 0.8, haendler: p.tr.charisma * 0.6 + p.tr.neugier * 0.3, gelehrte: p.tr.neugier * 0.95, volk: 0.6 };
  const jb = JOB_FAC[p.job];
  if (jb) sc[jb[0]] += jb[1];
  if (p.dream === 'glaube') sc.glaeubige += 1;
  if (p.dream === 'krieg') sc.krieger += 1;
  if (p.dream === 'freiheit') sc.volk += 0.8;
  if (p.dream === 'wissen' || p.dream === 'sterne') sc.gelehrte += 1;
  // Arme stehen zum Volk, Reiche zu den Händlern, der Adel zu den Wächtern
  if (p.cls === 0 || p.poor > 4) sc.volk += 0.45;
  if (p.cls === 3) sc.haendler += 0.5;
  if (p.cls === 4) sc.krieger += 0.4;
  let best = 'volk', bv = -1;
  for (const [k, v] of Object.entries(sc)) if (v > bv) { bv = v; best = k; }
  return best;
}

function factionShares(st, s) {
  const M = members(st, s);
  const sum = { glaeubige: 0, krieger: 0, haendler: 0, gelehrte: 0, volk: 0 };
  let tot = 0;
  for (const p of M.adults.concat(M.old)) {
    if (!p.fac || st.day % 24 === 0) p.fac = factionOf(p);
    // Geld ist Macht: Reiche wiegen in der Politik schwerer
    const rich = Math.min(2, Math.log10(1 + Math.max(0, (p.gold || 0) + (p.dep || 0)) / ((s.avgWage || 1) * 20)));
    const w = (INFL[p.job] || 1) * (p.id === s.gov.leader ? 3 : 1) * (1 + rich * 0.6);
    sum[p.fac] += w; tot += w;
  }
  for (const k in sum) sum[k] = tot ? sum[k] / tot : 0.2;
  return sum;
}

// ---------- Herrschaft ----------

function govAllowed(st, s, g) {
  const G = D.GOVS[g];
  if (s.era < G.era) return false;
  if (g === 'rat') return s.era <= 2 && s.pop < 120;
  if (g === 'haeuptling') return s.era <= 3;
  if (g === 'koenigtum') return knows(st, 'bronze', s);
  if (g === 'republik' || g === 'volksrat') return knows(st, 'recht', s);
  if (g === 'demokratie') return knows(st, 'buchdruck', s);
  if (g === 'technokratie') return knows(st, 'strom', s);
  if (g === 'theokratie') return knows(st, 'rituale', s);
  return true;
}

function govScore(st, s, g) {
  if (!govAllowed(st, s, g) || g === 'diktatur') return -1;
  const G = D.GOVS[g];
  let a = 0, w = 0;
  for (const [k, v] of Object.entries(G.fit)) { a += s.cult[k] * v; w += v; }
  let sc = (a / w) * 0.8 + (s.fac?.[G.faction] || 0) * 0.35;
  const ERA_FIT = { rat: [0, 1], haeuptling: [0, 2], koenigtum: [2, 4], theokratie: [1, 4], republik: [3, 5], volksrat: [3, 6], demokratie: [5, 7], technokratie: [6, 7] };
  const [lo, hi] = ERA_FIT[g] || [0, 7];
  sc += s.era >= lo && s.era <= hi ? 0.12 : -0.12;
  if (g === 'volksrat' && s.gov.type !== 'volksrat') return -1; // nur durch Aufstand
  if (g === 'theokratie' && s.cult.glaube < 0.6) sc -= 0.3;
  if (g === 'rat') sc -= s.pop / 250;
  if (g === 'demokratie' || g === 'republik') sc += s.era * 0.02;
  return sc;
}

export function chooseLeader(st, s, initial = false) {
  const r = rng(st), rt = st._rt, M = members(st, s);
  const pool = M.adults.concat(M.old).filter(p => ageOf(st, p) >= 16);
  if (!pool.length) return null;
  const g = s.gov.type;
  const money = p => Math.min(0.8, Math.log10(1 + Math.max(0, wealthOf(st, p)) / ((s.avgWage || 1) * 30)) * 0.4);
  const by = fn => pool.reduce((best, p) => { const v = fn(p) + money(p) + r.next() * 0.25; return !best || v > best[1] ? [p, v] : best; }, null)[0];
  let pick;
  if (g === 'rat') pick = by(p => ageOf(st, p) / 55 + p.tr.charisma * 0.5 + p.fame * 0.05);
  else if (g === 'haeuptling') pick = by(p => (ageOf(st, p) < 62 ? 1 : 0) + p.tr.mut + p.tr.charisma + p.fame * 0.06);
  else if (g === 'koenigtum') {
    const last = s.gov.last ? s.gov.last : null;
    const heirs = last ? pool.filter(p => (p.mo === last || p.fa === last)).sort((a, b) => a.b - b.b) : [];
    if (heirs.length) pick = heirs[0];
    else { pick = by(p => p.tr.mut + p.tr.charisma + p.tr.wut * 0.3 + p.fame * 0.05); if (!initial) { s.gov.dyn = pick.clan; chron(st, 'politik', L(`Eine neue Dynastie besteigt den Thron von ${s.name}: das Haus ${pick.clan}.`, `A new dynasty takes the throne of ${s.name}: House ${pick.clan}.`), s.id, 1); } }
    if (!s.gov.dyn) s.gov.dyn = pick.clan;
  }
  else if (g === 'theokratie') pick = by(p => p.tr.glaube + p.faith + (p.job === 'priester' ? 0.6 : 0) + (p.dream === 'glaube' ? 0.8 : 0));
  else if (g === 'republik' || g === 'demokratie') return election(st, s, initial);
  else if (g === 'diktatur') pick = by(p => p.tr.mut + p.tr.wut + (p.job === 'krieger' ? 0.6 : 0));
  else if (g === 'volksrat') pick = by(p => p.tr.charisma + (p.fac === 'volk' ? 0.5 : 0));
  else pick = by(p => p.tr.neugier + (p.job === 'gelehrter' ? 0.6 : 0));
  install(st, s, pick, initial);
  return pick;
}

export function install(st, s, p, quiet) {
  const old = leaderOf(st, s);
  if (old && old !== p) old.lt = '';
  s.gov.leader = p.id;
  s.gov.last = p.id;
  // in einem Staat mit mehreren Orten regieren die anderen Orte Bürgermeister (states.js)
  const mt = st._rt.pol && st._rt.pol.title(st, s);
  p.lt = titleFor(p, mt || LEADER_TITLE[s.gov.type]);
  p.fame += 3;
  bio(p, st.day, L(`wird ${p.lt} von ${s.name}`, `becomes ${p.lt} of ${s.name}`));
  if (!quiet) chron(st, 'politik', L(`${p.n} wird ${p.lt} von ${s.name}.`, `${p.n} becomes ${p.lt} of ${s.name}.`), s.id, 1);
}

function election(st, s, quiet) {
  // Hauptstadt eines Staates: Wahl im ganzen Staat mit Parteien und Parlament (states.js)
  if (st._rt.pol && st._rt.pol.election(st, s, quiet)) return leaderOf(st, s);
  const r = rng(st), M = members(st, s);
  const pool = M.adults.concat(M.old).filter(p => ageOf(st, p) >= 21);
  if (!pool.length) return null;
  const cands = pool.map(p => [p, p.tr.charisma * 1.2 + p.fame * 0.08 + r.next() * 0.4]).sort((a, b) => b[1] - a[1]);
  const pickd = [];
  for (const [p] of cands) { if (!pickd.some(q => q.fac === p.fac)) pickd.push(p); if (pickd.length >= 3) break; }
  if (!pickd.length) pickd.push(cands[0][0]);
  const facFit = f => { const v = D.FACTIONS[f]?.values || []; return v.length ? v.reduce((a, k) => a + s.cult[k], 0) / v.length : 0.5; };
  // Wahlkampf kostet: Reiche kaufen Stimmen (je weniger fromm, desto eher)
  let bought = null;
  const votes = pickd.map(p => {
    let v = (s.fac?.[p.fac] || 0.2) * 0.5 + p.tr.charisma * 0.5 + facFit(p.fac) * 0.5 + r.next() * 0.3;
    const g = Math.max(0, p.gold || 0);
    v += Math.min(0.35, Math.log10(1 + g / ((s.avgWage || 1) * 40)) * 0.25);
    if (g > (s.avgWage || 1) * 100 && p.tr.glaube < 0.55 && r.chance(0.4)) {
      const x = g * 0.12; p.gold -= x; v += 0.25;
      const voters = M.adults.filter(q => (q.cls ?? 1) <= 1);
      for (const q of voters) q.gold = (q.gold || 0) + x / Math.max(1, voters.length);
      bought = p;
    }
    return [p, v];
  }).sort((a, b) => b[1] - a[1]);
  const win = votes[0][0];
  if (bought && bought === win && !quiet && r.chance(0.6)) chron(st, 'politik', L(`In ${s.name} klimpern vor der Wahl die Münzen: ${win.n} verteilt Geschenke an die Armen.`, `Coins jingle in ${s.name} before the vote: ${win.n} hands out gifts to the poor.`), s.id, 0);
  const G = D.GOVS[s.gov.type];
  s.gov.next = st.day + (G.elect || 5) * D.DAYS_PER_YEAR;
  const prev = s.gov.leader;
  install(st, s, win, true);
  if (!quiet) {
    const fac = D.FACTIONS[win.fac]?.name || L('dem Volk', 'the people');
    if (votes[1]) chron(st, 'politik', L(`Wahl in ${s.name}: ${win.n} (${fac}) gewinnt gegen ${votes[1][0].n}.${prev === win.id ? ' Eine zweite Amtszeit.' : ''}`, `Election in ${s.name}: ${win.n} (${fac}) defeats ${votes[1][0].n}.${prev === win.id ? ' A second term.' : ''}`), s.id, 1);
    else chron(st, 'politik', L(`${win.n} wird ohne Gegenstimme ${win.lt} von ${s.name}.`, `${win.n} becomes ${win.lt} of ${s.name} without a single vote against.`), s.id, 1);
  }
  return win;
}

function changeGov(st, s, g, how) {
  const old = s.gov.type;
  if (old === g) return;
  const oldL = leaderOf(st, s);
  s.gov = { type: g, leader: null, since: st.day, next: 0, dyn: null, last: null };
  if (oldL) oldL.lt = '';
  const G = D.GOVS[g];
  const texts = {
    wandel: [
      L(`In ${s.name} wandelt sich die Ordnung: Aus ${D.GOVS[old].name} wird ${G.name}.`, `The order of ${s.name} changes: ${D.GOVS[old].name} becomes ${G.name}.`),
      L(`Die Menschen von ${s.name} geben sich eine neue Ordnung: ${G.name}.`, `The people of ${s.name} give themselves a new order: ${G.name}.`),
    ],
    aufstand: [
      L(oldL ? `Aufstand in ${s.name}! ${D.FACTIONS[G.faction].name} ${G.faction === 'volk' ? 'stürzt' : 'stürzen'} ${label(oldL)}. ${G.name} beginnt.` : `Aufstand in ${s.name}! ${D.FACTIONS[G.faction].name} ${G.faction === 'volk' ? 'greift' : 'greifen'} nach der Macht. ${G.name} beginnt.`,
        oldL ? `Uprising in ${s.name}! ${D.FACTIONS[G.faction].name} overthrow ${label(oldL)}. ${G.name} begins.` : `Uprising in ${s.name}! ${D.FACTIONS[G.faction].name} seize power. ${G.name} begins.`),
      L(`Feuer in den Gassen von ${s.name}. Als der Rauch sich legt, herrscht ${G.name}.`, `Fire in the streets of ${s.name}. When the smoke clears, ${G.name} rules.`),
    ],
    putsch: [L(`Die Wächter von ${s.name} greifen nach der Macht. ${label(oldL)} wird abgesetzt. Militärherrschaft.`, `The guards of ${s.name} seize power. ${label(oldL)} is deposed. Military rule.`)],
  }[how];
  chron(st, 'politik', rng(st).pick(texts), s.id, 2);
  // Gesetze der Verlierer fallen
  s.laws = s.laws.filter(l => D.LAWS[l].faction === G.faction || rng(st).chance(0.4));
  const p = chooseLeader(st, s, false);
  if (p && how === 'aufstand') fx(st, { type: 'revolt', s: s.id });
}

// Soldaten ohne Sold sind gefährlich
function unpaidSoldiers(st, s) { return members(st, s).adults.some(p => p.job === 'krieger' && p.unpaid > 6); }

// Revolution des Volkes: die Reichen werden enteignet
function expropriate(st, s) {
  const M = members(st, s), all = M.adults.concat(M.old);
  const rich = all.filter(p => (p.cls ?? 1) >= 3);
  if (!rich.length) return;
  let pot = 0;
  for (const p of rich) { const x = Math.max(0, p.gold || 0) * 0.6 + (p.dep || 0) * 0.6; p.gold -= Math.max(0, p.gold || 0) * 0.6; p.dep = (p.dep || 0) * 0.4; pot += x; bio(p, st.day, L('wird enteignet', 'is expropriated')); }
  const ids = new Set(rich.map(p => p.id));
  for (const b of bldOf(st, s)) if (ids.has(b.own)) b.own = 0;
  s.stock.gold += pot * 0.5;
  const poor = all.filter(p => (p.cls ?? 1) <= 1);
  for (const p of poor) p.gold = (p.gold || 0) + pot * 0.5 / Math.max(1, poor.length);
  chron(st, 'politik', L(`Die Revolution in ${s.name} nimmt den Reichen ihre Felder, Mühlen und Truhen. Was allen gehört, verwaltet jetzt die Stadt.`, `The revolution in ${s.name} takes the fields, mills and chests from the rich. What belongs to all is now run by the town.`), s.id, 1);
}

function revolt(st, s) {
  if (st._rt.pol && st._rt.pol.member(st, s) && st._rt.pol.secede(st, s, 'aufstand')) return; // Mitgliedsort: Unabhängigkeit statt Umsturz
  const r = rng(st), M = members(st, s);
  const ruling = D.GOVS[s.gov.type].faction;
  const fac = Object.entries(s.fac).filter(([k]) => k !== ruling).sort((a, b) => b[1] - a[1])[0][0];
  const PREF = { glaeubige: ['theokratie'], krieger: ['diktatur', 'koenigtum', 'haeuptling'], haendler: ['republik', 'koenigtum', 'haeuptling'], gelehrte: ['technokratie', 'demokratie', 'republik', 'rat'], volk: ['demokratie', 'volksrat', 'rat', 'haeuptling'] };
  const g = PREF[fac].find(x => x === 'diktatur' ? s.era >= 2 : govAllowed(st, s, x)) || 'haeuptling';
  // Gewalt
  const victims = Math.round(M.adults.length * r.range(0.01, 0.05));
  const oldL = leaderOf(st, s);
  if (oldL && r.chance(0.35)) { killPerson(st, oldL, CAUSE_REVOLT); chron(st, 'tod', L(`${label(oldL)} fällt im Aufstand von ${s.name}.`, `${label(oldL)} falls in the uprising of ${s.name}.`), s.id, 1); }
  for (let i = 0; i < victims; i++) { const p = r.pick(M.adults); if (p && !p.dead) killPerson(st, p, CAUSE_REVOLT); }
  const bs = bldOf(st, s).filter(b => b.t !== 'feld');
  if (bs.length) { const b = r.pick(bs); st.tiles.burn[idx(b.x, b.y)] = 3; st._rt.fire = 1; }
  changeGov(st, s, g, g === 'diktatur' ? 'putsch' : 'aufstand');
  if (fac === 'volk' && (s.gini || 0) > 0.4) expropriate(st, s);
  s.unrest = 0.3;
}

function lawStep(st, s, leader) {
  const r = rng(st);
  const maxL = 2 + Math.floor(s.era / 3);
  const fac = leader ? (leader.fac || 'volk') : 'volk';
  const avail = Object.entries(D.LAWS).filter(([id, law]) => law.faction === fac && !s.laws.includes(id) && (law.era || 0) <= s.era);
  const OPP = { gastrecht: 'abschottung', abschottung: 'gastrecht', toleranz: 'staatskirche', staatskirche: 'toleranz', sternenverbot: 'freiedenker', freiedenker: 'sternenverbot', freihandel: 'schutzzoll', schutzzoll: 'freihandel' };
  if (s.laws.length < maxL && avail.length && r.chance(0.55)) {
    const [id, law] = r.pick(avail);
    if (OPP[id]) s.laws = s.laws.filter(l => l !== OPP[id]);
    s.laws.push(id);
    chron(st, 'politik', L(`${label(leader)} erlässt in ${s.name}: ${law.name}. ${law.info}.`, `In ${s.name}, ${label(leader)} decrees a new law: ${law.name}. ${law.info}.`), s.id, 0);
  } else if (s.laws.length && r.chance(0.25)) {
    const foreign = s.laws.filter(l => D.LAWS[l].faction !== fac);
    if (foreign.length) {
      const id = r.pick(foreign);
      s.laws = s.laws.filter(l => l !== id);
      chron(st, 'politik', L(`${s.name} hebt das Gesetz auf: ${D.LAWS[id].name}.`, `${s.name} repeals the law: ${D.LAWS[id].name}.`), s.id, 0);
    }
  }
}

export function politicsStep(st) {
  const r = rng(st);
  for (const s of st.settlements) {
    if (!s.alive) continue;
    if (!s.pop) {
      s.alive = false; s.ended = st.day;
      st.counts.abandoned = (st.counts.abandoned || 0) + 1;
      abandonTown(st, s); // Ruinenstätte, Gassen wachsen zu, Landstraßen dorthin (decay.js)
      st.prayers = st.prayers.filter(p => p.s !== s.id);
      for (const o of st.settlements) if (o.war === s.id) { o.war = null; o.aggressor = false; }
      chron(st, 'tod', L(`${s.name} ist verlassen. Wind fährt durch leere Türen, bald holt sich der Wald die Mauern zurück.`, `${s.name} lies abandoned. Wind moves through empty doorways, and soon the forest will take the walls back.`), s.id, 2);
      continue;
    }
    s.fac = factionShares(st, s);
    let ld = leaderOf(st, s);
    if (!ld) {
      const g = s.gov.type;
      ld = chooseLeader(st, s);
      if (ld && D.GOVS[g].hereditary && s.gov.dyn && ld.clan === s.gov.dyn) chron(st, 'politik', L(`${ld.n} aus dem Haus ${s.gov.dyn} erbt die Krone von ${s.name}.`, `${ld.n} of House ${s.gov.dyn} inherits the crown of ${s.name}.`), s.id, 1);
      if (!ld) continue;
    }
    const G = D.GOVS[s.gov.type];
    let a = 0, w = 0;
    for (const [k, v] of Object.entries(G.fit)) { a += s.cult[k] * v; w += v; }
    const fit = a / w;
    const legit = 0.25 + fit * 0.45 + (s.fac[G.faction] || 0) * 0.35 + (ld.tr.charisma - 0.5) * 0.2;
    s.legit = legit;
    const autocratic = ['koenigtum', 'diktatur', 'theokratie', 'haeuptling'].includes(s.gov.type);
    const target = clamp((0.55 - s.hap) * 1.6 + (0.6 - legit) * 1.0 + s.hunger * 0.6 + (s.war ? 0.12 : 0) + (s.omen || 0)
      + (autocratic ? (s.cult.freiheit - 0.35) * 0.6 : (s.cult.macht - 0.5) * 0.3) + Math.min(4, s.unanswered || 0) * 0.025
      + Math.max(0, (s.gini || 0) - 0.55) * 0.4 + Math.max(0, (s.unemp || 0) - 0.15) * 0.15 + (s.feuds ? s.feuds.length * 0.015 : 0)
      + (s.strike && s.strike.until > st.day ? 0.05 : 0), 0, 1);
    s.unanswered = Math.max(0, Math.min(4, s.unanswered || 0) - 0.12);
    s.omen = Math.max(0, (s.omen || 0) - 0.02);
    s.unrest = clamp(s.unrest + (target - s.unrest) * 0.2, 0, 1);
    if (G.elect && st.day >= s.gov.next) election(st, s, false);
    else if (s.unrest > 0.72 && st.day - s.gov.since > 3 * D.DAYS_PER_YEAR && r.chance(0.1)) revolt(st, s);
    else if (!(st._rt.pol && st._rt.pol.member(st, s))) { // Mitgliedsorte folgen der Hauptstadt (states.js)
      // Kräfte im Wandel: friedlicher Übergang, wenn eine Ordnung viel besser passt
      const cur = govScore(st, s, s.gov.type);
      let best = s.gov.type, bv = cur;
      for (const g of Object.keys(D.GOVS)) { const v = govScore(st, s, g); if (v > bv) { bv = v; best = g; } }
      const calm = s.unrest < 0.5;
      if (best !== s.gov.type && bv > cur + (calm ? 0.2 : 0.1) && r.chance(calm ? 0.04 : 0.1)) changeGov(st, s, best, 'wandel');
      else if (s.unrest > 0.6 && s.fac.krieger > 0.3 && G.faction !== 'krieger' && s.counts?.warriors > 2 && r.chance(unpaidSoldiers(st, s) ? 0.15 : 0.05)) changeGov(st, s, 'diktatur', 'putsch');
    }
    if (st.day % 24 === 0 && !(st._rt.pol && st._rt.pol.member(st, s))) lawStep(st, s, leaderOf(st, s));
    cultureDrift(st, s);
  }
}

// Kultur bewegt sich langsam zu dem, was die Siedlung lebt. Göttliche Eingriffe
// hinterlassen eine Neigung (bias), die nur langsam verblasst.
const AUTOCRATIC = ['koenigtum', 'diktatur', 'theokratie', 'haeuptling'];
function cultureDrift(st, s) {
  const M = members(st, s), n = Math.max(1, M.adults.length);
  const share = j => M.adults.filter(p => p.job === j).length / n;
  const own = t => bldOf(st, s).filter(b => b.t === t && b.prog >= 1).length;
  const L = leaderOf(st, s);
  const age = (st.day - s.founded) / D.DAYS_PER_YEAR;
  const auto = AUTOCRATIC.includes(s.gov.type);
  const ch = s.char || (s.char = {});
  const T = {
    glaube: 0.18 + s.faith * 0.65 + share('priester') * 1.5,
    tradition: 0.35 + Math.min(0.25, age / 150) - (knows(st, 'buchdruck', s) ? 0.1 : 0) + (auto ? 0.08 : 0),
    freiheit: 0.28 + (knows(st, 'schrift', s) ? 0.05 : 0) + (knows(st, 'buchdruck', s) ? 0.1 : 0) + (knows(st, 'zeitung', s) ? 0.08 : 0) + s.cult.handel * 0.15 + (auto ? -0.08 : 0.08),
    macht: 0.28 + share('krieger') * 2.5 + (s.war ? 0.3 : 0) - Object.keys(s.ally).length * 0.05,
    wissen: 0.22 + share('gelehrter') * 4 + Math.min(0.15, own('schule') * 0.05) + (s.has.sternwarte ? 0.08 : 0),
    kunst: 0.22 + share('kuenstler') * 5 + Math.min(0.15, own('theater') * 0.06) + (s.has.monument ? 0.05 : 0),
    handel: 0.22 + share('haendler') * 3 + Math.min(0.2, (own('markt') + own('hafen') * 1.5) * 0.04),
  };
  if (L) { T.glaube += (L.tr.glaube - 0.5) * 0.15; T.macht += (L.tr.wut - 0.5) * 0.2; T.wissen += (L.tr.neugier - 0.5) * 0.12; T.kunst += (L.tr.kunst - 0.5) * 0.1; }
  const bias = s.bias || (s.bias = {});
  for (const k of Object.keys(D.CULTURE)) {
    const b = bias[k] || 0;
    const target = clamp(T[k] + (ch[k] || 0) + b, 0.05, 0.95);
    s.cult[k] = clamp(s.cult[k] + (target - s.cult[k]) * 0.035, 0.03, 0.97);
    if (b) bias[k] = Math.abs(b) < 0.005 ? 0 : b * 0.985;
  }
}

// ---------- Diplomatie und Krieg ----------

export function relationsStep(st) {
  const r = rng(st), sets = st.settlements.filter(s => s.alive);
  // Märkte, Häfen und Handelsrouten einmal vorab (vorher je Paar über alle Gebäude, bei 160 Orten der Erde zu teuer)
  const trader = new Set(st.buildings.filter(x => x.t === 'markt' || x.t === 'hafen').map(x => x.s));
  const routeKey = new Set((st.trade || []).map(t => t.a + '-' + t.b));
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
    const a = sets[i], b = sets[j];
    const same = sameLand(st, a, b);
    const Ia = isleOf(st, a), Ib = isleOf(st, b);
    if ((st.earth ? a.isle !== b.isle : !same) && !(Ia && Ib && Ia.contact[Ib.id])) continue; // sie wissen nichts voneinander
    const dist = Math.hypot(a.cx - b.cx, a.cy - b.cy);
    const overlap = same ? Math.max(0, (a.R + b.R + 4 - dist) / (a.R + b.R + 4)) : 0;
    let cd = 0; for (const k of Object.keys(D.CULTURE)) cd += Math.abs(a.cult[k] - b.cult[k]);
    cd /= 7;
    const tradeA = trader.has(a.id);
    const tradeB = trader.has(b.id);
    const route = !same && (routeKey.has(a.id + '-' + b.id) || routeKey.has(b.id + '-' + a.id));
    const la = leaderOf(st, a), lb = leaderOf(st, b);
    const wut = ((la ? la.tr.wut : 0.5) + (lb ? lb.tr.wut : 0.5) - 1);
    const border = same ? Math.max(0, 1 - (dist - a.R - b.R) / 18) : 0;
    const aggr = (st.char && st.char.aggr) || 1;
    const target = 8 - (aggr - 1) * 28 - cd * 160 - overlap * 70 - border * 30 + (same ? (tradeA && tradeB ? 20 : 0) : (route ? 26 : -6)) + (a.ally[b.id] ? 20 : 0) - (a.war === b.id ? 40 : 0) - wut * 30 - (a.cult.macht + b.cult.macht - 0.6) * 50 + (a.lang === b.lang ? 8 : 0);
    let rel = a.rel[b.id] ?? 20;
    rel = clamp(rel + (target - rel) * 0.06 + r.gauss() * 6, -100, 100);
    if (r.chance(same ? 0.018 : 0.01)) {
      const bad = r.chance(0.6 + border * 0.2);
      const INC_BAD = same
        ? L([`Grenzstreit zwischen ${a.name} und ${b.name}: Wer darf am Fluss fischen?`, `Hirten aus ${a.name} treiben ihr Vieh auf die Weiden von ${b.name}. Es fließt Blut.`, `Ein Gesandter aus ${b.name} wird in ${a.name} verspottet. Man vergisst so etwas nicht.`],
            [`Border dispute between ${a.name} and ${b.name}: who may fish the river?`, `Herders from ${a.name} drive their cattle onto the pastures of ${b.name}. Blood is spilled.`, `An envoy from ${b.name} is mocked in ${a.name}. Such things are not forgotten.`])
        : L([`Seeleute aus ${a.name} plündern ein Fischerboot aus ${b.name}.`, `Händler aus ${b.name} fühlen sich in ${a.name} betrogen. Der Ton wird rauer.`],
            [`Sailors from ${a.name} plunder a fishing boat from ${b.name}.`, `Traders from ${b.name} feel cheated in ${a.name}. The tone grows harsher.`]);
      const INC_GOOD = same
        ? L([`Eine Hochzeit verbindet die Familien von ${a.name} und ${b.name}.`, `${a.name} schickt ${b.name} Korn in einem harten Winter. Man wird es nicht vergessen.`, `Gemeinsames Fest von ${a.name} und ${b.name} am Strand.`],
            [`A wedding joins the families of ${a.name} and ${b.name}.`, `${a.name} sends grain to ${b.name} in a hard winter. It will not be forgotten.`, `${a.name} and ${b.name} hold a joint feast on the beach.`])
        : L([`Ein Schiff aus ${a.name} bringt Geschenke nach ${b.name}: Gewürze, Lieder, eine Karte der Sterne.`, `${a.name} und ${b.name} tauschen Gesandte aus. Man lernt ein paar Worte der anderen Sprache.`],
            [`A ship from ${a.name} brings gifts to ${b.name}: spices, songs, a map of the stars.`, `${a.name} and ${b.name} exchange envoys. A few words of the other tongue are learned.`]);
      rel = clamp(rel + (bad ? -r.range(15, 35) : r.range(12, 25)), -100, 100);
      chron(st, 'politik', r.pick(bad ? INC_BAD : INC_GOOD), a.id, 0);
    }
    a.rel[b.id] = b.rel[a.id] = rel;
    // Kriegserklärungen kommen aus diplomacy.js (Groll, Anlass, Ziel, Verbündete)
    if (!a.ally[b.id] && rel > 70 && !a.war && r.chance(0.08)) {
      a.ally[b.id] = b.ally[a.id] = st.day;
      chron(st, 'politik', same ? L(`${a.name} und ${b.name} schließen einen Bund. Sie teilen Brot, Wissen und Schwüre.`, `${a.name} and ${b.name} form an alliance. They share bread, knowledge and oaths.`) : L(`Über das Meer hinweg schließen ${a.name} und ${b.name} einen Bund. Zwei Inseln, ein Schwur.`, `Across the sea, ${a.name} and ${b.name} form an alliance. Two islands, one oath.`), a.id, 1);
    } else if (a.ally[b.id] && rel < 20) {
      delete a.ally[b.id]; delete b.ally[a.id];
      chron(st, 'politik', L(`Der Bund zwischen ${a.name} und ${b.name} zerbricht.`, `The alliance between ${a.name} and ${b.name} breaks apart.`), a.id, 1);
    }
  }
  // Schlachten schlagen seit 24.10.2026 die Heere (military.js); hier nur Kriege beenden, deren Gegner verschwunden ist
  for (const a of sets) if (a.war && a.aggressor) { const b = st._rt.sById.get(a.war); if (!b || !b.alive) endWar(st, a, b); }
}

// Nach jeder Schlacht (seit 24.10.2026 aus military.js, vorher eine Zählformel hier): Kriegsstand, Müdigkeit, Eroberung,
// Frieden. a ist der Angreifer, b der Verteidiger, win der Sieger der Schlacht, pts zählt ein erfolgreicher Sturm doppelt
export function warCheck(st, a, b, win, sea, pts = 1) {
  const r = rng(st);
  a.warBattles = (a.warBattles || 0) + 1; b.warBattles = a.warBattles;
  win.warScore = (win.warScore || 0) + pts;
  const lose = win === a ? b : a;
  const dur = st.day - a.warSince;
  // Kriegsmüdigkeit: kleine Orte können sich das Sterben nicht leisten
  const tired = Math.min(a.pop, b.pop) < 14 || (a.peak && a.pop < a.peak * 0.55) || (b.peak && b.pop < b.peak * 0.55);
  if (tired && r.chance(0.6)) { endWar(st, a, b, win); return; }
  // Kriegsziel: Raubzüge sind kurz, Grenz- und Rachekriege enden mit einem Vertrag, nur Eroberungs- und Seekriege erobern
  const G = GOALS[a.warGoal] || GOALS.conquest;
  const lead = Math.max(a.warScore, b.warScore) - Math.min(a.warScore, b.warScore);
  if (G.conquer && win.warScore >= (sea ? 4 : 3) && lose.pop < win.pop * (sea ? 0.6 : 0.85) && r.chance(sea ? 0.3 : 0.45)) conquer(st, win, lose);
  else if (a.warBattles >= G.battles || (lead >= 2 && r.chance(0.5)) || dur > 60 || (a.warScore >= 2 && b.warScore >= 2 && r.chance(0.3))) endWar(st, a, b, a.warScore === b.warScore ? null : a.warScore > b.warScore ? a : b);
}

export function endWar(st, a, b, win) {
  if (a) { a.war = null; a.aggressor = false; }
  if (b) { b.war = null; b.aggressor = false; }
  if (!a || !b) { for (const s of [a, b]) if (s) { s.warGoal = null; s.warName = null; s.helpers = []; } return; }
  a.truce[b.id] = b.truce[a.id] = st.day + 72;
  if (win && a.warGoal !== 'raid') tribute(st, win, win === a ? b : a);
  if (win && a.warGoal === 'raid' && win.id === a.raider) plunder(st, win, win === a ? b : a);
  a.rel[b.id] = b.rel[a.id] = Math.max(a.rel[b.id] ?? 0, -15);
  // Vertrag je nach Kriegsziel (diplomacy.js)
  makePeace(st, a, b, win);
}

// Eine Siedlung geht in einer anderen auf (Eroberung oder friedliche Vereinigung)
function absorb(st, win, lose) {
  const old = leaderOf(st, lose);
  if (old) old.lt = '';
  // Liegt der Weiler außerhalb dessen, was die Stadt als ihr Gebiet zeichnet (render/streets.js), ziehen die Menschen
  // in die Stadt und der Weiler wird aufgegeben (Ruinen, decay.js); sonst stünden Häuser ohne Straßen weit draußen
  const far = Math.hypot(lose.cx - win.cx, lose.cy - win.cy) + (lose.R || 4) > Math.max((win.R || 6) + 6, win.plan ? win.plan.ext + 1.5 : 0);
  for (const p of st.people) if (p.s === lose.id) { p.s = win.id; p.fac = null; if (far) { p.home = -1; p.w = -1; } }
  if (far) {
    bumpBuildings(st);
    for (const k of Object.keys(lose.stock)) win.stock[k] += lose.stock[k];
    lose.alive = false; lose.ended = st.day; lose.endedBy = win.id; lose.pop = 0;
    st.counts.absorbed = (st.counts.absorbed || 0) + 1;
    st.prayers = st.prayers.filter(p => p.s !== lose.id);
    abandonTown(st, lose);
    return;
  }
  for (const b of st.buildings.slice()) if (b.s === lose.id) {
    // das alte Zentrum wird ein Platz (dort enden die Landstraßen; früher stand danach ein Wohnhaus auf der Straße)
    if (b.t === 'zentrum') { lose.center = null; removeBuilding(st, b, false); if (st.tiles.st) st.tiles.st[idx(b.x, b.y)] = SQUARE | BUILT; continue; }
    b.s = win.id;
  }
  bumpBuildings(st);
  for (const k of Object.keys(lose.stock)) win.stock[k] += lose.stock[k];
  for (const k of Object.keys(D.CULTURE)) win.cult[k] = clamp(win.cult[k] * 0.85 + lose.cult[k] * 0.15, 0.03, 0.97);
  Object.assign(win.has, Object.fromEntries(Object.entries(lose.has).filter(([, v]) => v)));
  lose.alive = false; lose.ended = st.day; lose.endedBy = win.id;
  st.counts.absorbed = (st.counts.absorbed || 0) + 1;
  st.prayers = st.prayers.filter(p => p.s !== lose.id);
}

function conquer(st, win, lose) {
  plunder(st, win, lose);
  win.war = null; win.aggressor = false;
  // seit 24.10.2026: der Ort bleibt bestehen und wird Teil des Staates der Sieger, ein Statthalter regiert (states.js);
  // nur winzige Weiler gehen ganz in der Siegerstadt auf
  if (st._rt.pol && lose.pop >= 6) {
    st._rt.pol.annex(st, win, lose);
    chron(st, 'krieg', L(`${win.name} erobert ${lose.name}. Über dem Platz weht jetzt die Fahne der Sieger, ein Statthalter zieht ins Haus des alten Oberhaupts.`, `${win.name} conquers ${lose.name}. The victors' flag now flies over the square, and a governor moves into the old ruler's house.`), win.id, 2);
  } else {
    absorb(st, win, lose);
    chron(st, 'krieg', L(`${win.name} erobert ${lose.name}. Die Flamme von ${lose.name} erlischt, ihre Menschen sprechen bald die Sprache der Sieger.`, `${win.name} conquers ${lose.name}. The flame of ${lose.name} goes out, and its people will soon speak the tongue of the victors.`), win.id, 2);
  }
  fx(st, { type: 'conquest', a: win.id, b: lose.id });
  indexMembers(st);
  setTerritory(st);
}

// ---------- Neue Siedlungen ----------

export function foundSettlement(st, x, y, people, opts = {}) {
  const r = rng(st);
  const parent = opts.parent;
  // In der Erde bleiben Siedler bei ihrem Volk und seiner Sprache (folks.js)
  // ohne Herkunft (Piraten, Fremde): das Volk des nächsten Ortes
  let from = parent || (people.length ? st._rt.sById.get(people[0].s) : null);
  if (st.earth && !from) { let bd = 1e9; for (const o of st.settlements) if (o.alive) { const d = Math.hypot(o.cx - x, o.cy - y); if (d < bd) { bd = d; from = o; } } }
  const lang = opts.lang ?? (st.earth && from ? from.lang : parent && r.chance(0.5) ? parent.lang : r.int(0, 3));
  const cult = {};
  for (const k of Object.keys(D.CULTURE)) cult[k] = clamp((parent ? parent.cult[k] : 0.45) + r.gauss() * 0.18, 0.06, 0.92);
  if (opts.cultShift) for (const [k, v] of Object.entries(opts.cultShift)) cult[k] = clamp(cult[k] + v, 0.06, 0.92);
  clearRuinsNear(st, x, y); // auf alten Ruinen: die Steine werden weggeräumt
  const s = newSettlement(st, x, y, lang, cult, null, st.earth ? opts.folk ?? (from ? from.isle : 1) : undefined);
  st.counts.founded = (st.counts.founded || 0) + 1;
  if (parent) { s.rel[parent.id] = parent.rel[s.id] = 45; parent.stock.food -= 30; s.stock.food = 40; }
  for (const p of people) { p.s = s.id; p.home = -1; p.w = -1; p.job = 'sammler'; p.fac = null; }
  for (let k = 0; k < 2; k++) { const site = findSite(st, s, 'haus'); if (site) addBuilding(st, s, 'haus', site[0], site[1], true); }
  s.gov.type = opts.gov || (r.chance(0.5) ? 'rat' : 'haeuptling');
  indexMembers(st);
  setTerritory(st);
  if (st._rt.pol) st._rt.pol.onFound(st, s, opts); // Kolonie im Staat der Mutterstadt oder eigener Staat (states.js)
  if (opts.leader) install(st, s, opts.leader, true); else chooseLeader(st, s, true);
  return s;
}

// far: wie stark ein Ort weit weg von allen Siedlungen bevorzugt wird (Abspaltungen ziehen ans andere Ende).
// focus [x, y, r]: nur in diesem Umkreis suchen (Festland: nahe der Mutterstadt oder am bekannten Landeplatz).
// Seit 18.10.2026 nur in bekanntem Land (st.tiles.seen), und der Lebensraum zählt mit (Wüste, Eis, Salz meidet man).
// from: der Ort, von dem die Siedler kommen. In der Erde suchen sie in seiner Gegend (ein Kontinent ist zu groß, um
// "am anderen Ende" zu siedeln), Abspaltungen (far) etwas weiter weg.
export function findNewHome(st, isleId, minDist = 22, far = 0, focus = null, from = null) {
  const r = rng(st), T = st.tiles, rt = st._rt;
  const I = landRec(st, isleId); // in der Erde eine Landmasse (isleId ist dann landOf(s))
  if (!I) return null;
  if (!focus && st.earth && from) focus = [from.cx, from.cy, (far ? 48 : 34) + (from.era || 0) * 4];
  if (!focus && I.area > 2500) {
    // großes Land ohne Vorgabe: rund um einen Ort dort, sonst am bekannten Küstenstück
    const here = st.settlements.filter(s => s.alive && landOf(s) === isleId);
    if (here.length) { const s = r.pick(here); focus = [s.cx, s.cy, 30 + (s.era || 0) * 4]; }
    else { const c = knownCoast(st, isleId, I.cx, I.cy); if (!c) return null; focus = [c[0], c[1], 22]; }
  }
  const span = focus ? focus[2] : Math.sqrt(I.area) * 0.9 + 6;
  const ox = focus ? focus[0] : I.cx, oy = focus ? focus[1] : I.cy;
  let best = null, bs = -1e9;
  const ruins = (st.finds || []).filter(o => o.t === 'ruine' && o.town && st.day - o.d < 40 * D.DAYS_PER_YEAR);
  for (let k = 0; k < 500; k++) {
    const x = Math.round(ox + r.range(-span, span)), y = Math.round(oy + r.range(-span, span));
    if (!inb(x, y)) continue;
    const i = idx(x, y);
    const hb = (rt.hb || T.h)[i];
    if (hb < 1 || hb > 2 || rt.isleOf[i] !== isleId || rt.owner[i] || rt.bldAt[i] || T.tree[i] > 1 || T.river[i]) continue;
    if (T.seen[i] < 200) continue;
    const B = D.BIOMES[T.bio[i]];
    if (!B.live) continue;
    let near = 99;
    for (const s of st.settlements) if (s.alive) near = Math.min(near, Math.hypot(s.cx - x, s.cy - y) - s.R);
    if (near < minDist - 8) continue;
    let fert = 0, trees = 0, water = 0;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      if (!inb(x + dx, y + dy)) continue;
      const j = idx(x + dx, y + dy);
      if (T.h[j] < 0 || T.river[j]) water++; else { fert += T.fert[j]; trees += T.tree[j]; }
    }
    const sc = fert / 50 + Math.min(trees, 30) * 0.2 + (water > 3 && water < 30 ? 5 : 0) + r.next() * 3 + Math.min(near, 70) * far + B.live * 6;
    // wo erst vor kurzem ein Ort aufgegeben wurde, siedelt man ungern gleich wieder (Ruinen, decay.js)
    if (ruins.length && ruins.some(o => Math.hypot(o.x - x, o.y - y) < 9)) continue;
    if (sc > bs) { bs = sc; best = [x, y]; }
  }
  return best;
}

// Wie viele Siedlungen eine Insel tragen kann
// mit dem Fortschritt (progress.js) passen mehr Orte auf eine Insel (Städte im Meer, dichtere Städte)
export const isleCap = I => (I.area > 2500 ? clamp(Math.floor(I.area / 1100) + 1, 1, 24) + Math.min(12, Math.floor((I.prog | 0) / 3)) : clamp(Math.floor(I.area / 650) + 1, 1, 4) + Math.min(2, Math.floor((I.prog | 0) / 8)));
// Wie viele Orte in der Nähe liegen (auf dem Festland zählt die Gegend, nicht das ganze Land)
const crowdNear = (st, s) => st.settlements.filter(o => o.alive && (st.earth ? landOf(o) === landOf(s) : o.isle === s.isle) && Math.hypot(o.cx - s.cx, o.cy - s.cy) < 45).length;

function pickGroup(st, s) {
  const r = rng(st), M = members(st, s), L = leaderOf(st, s);
  const cands = M.adults.filter(p => p !== L && ageOf(st, p) < 40);
  if (cands.length < 8) return null;
  const founder = cands.reduce((a, p) => (p.tr.mut + p.tr.neugier > a.tr.mut + a.tr.neugier ? p : a), cands[0]);
  const group = new Set([founder]);
  const pa = founder.pa && st._rt.pById.get(founder.pa);
  if (pa) group.add(pa);
  for (const k of M.kids) if (k.mo === founder.id || k.fa === founder.id) group.add(k);
  const size = r.int(8, 14);
  for (const p of r.shuffle(cands.slice())) {
    if (group.size >= size) break;
    if (group.has(p)) continue;
    group.add(p);
    const q = p.pa && st._rt.pById.get(p.pa);
    if (q && q.s === s.id) group.add(q);
  }
  return { founder, group };
}

// Siedler über das Meer bringen ihr Wissen mit auf die neue Insel
function carryKnowledge(st, I, target) {
  if (!st.settlements.some(o => o.alive && o.isle === target.id)) inheritIsle(I, target);
  for (const t of I.techs) if (!target.techs.includes(t)) { target.techs.push(t); st._rt.isleKnown.get(target.id).add(t); }
  target.era = Math.max(target.era, I.era);
  target.contact[I.id] = I.contact[target.id] = st.day;
  target.seen[I.id] = I.seen[target.id] = st.day;
  if (!target.research.cur) target.research.cur = I.research.cur;
}

export function foundingStep(st) {
  const r = rng(st);
  const alive = st.settlements.filter(s => s.alive);
  if (alive.length >= st._rt.maxSet) return;
  const count = id => alive.filter(o => o.isle === id).length;
  for (const s of alive) {
    if (s.era < 1) continue;
    const wander = (st.char && st.char.wander) || 1;
    const I = isleOf(st, s);
    const big = I && I.area > 2500;
    // in der Erde breiten sich die Völker mit kleineren Orten weiter aus (Fläche statt dichter Städte)
    const need = (st.earth ? 32 + 16 * crowdNear(st, s) : 42 + 22 * (big ? crowdNear(st, s) : count(s.isle))) / Math.sqrt(wander);
    if (s.pop < need || !r.chance((0.18 + (s.homeCap < s.pop ? 0.1 : 0) + s.cult.freiheit * 0.1) * wander)) continue;
    let target = null, spot = null, sea = false;
    if (count(s.isle) < isleCap(I)) { spot = findNewHome(st, landOf(s), 22, big ? 0.04 : 0.12, big ? [s.cx, s.cy, 26 + (s.era || 0) * 4] : null); target = I; }
    // Erde: über das Meer zu einem anderen Land, dessen Küste das Volk kennt (folks.js), das Wissen bleibt beim Volk
    if (!spot && st.earth && knows(st, 'segeln', s) && bldOf(st, s).some(b => (b.t === 'hafen' || b.t === 'fischer'))) {
      const tg = earthSeaTarget(st, s);
      if (tg) { spot = findNewHome(st, tg.land.id, 22, 0, [tg.coast[0], tg.coast[1], 18]); if (spot) { target = { name: L(tg.land.de, tg.land.en) }; sea = true; } }
    }
    // Kein Platz mehr: über das Meer zu einer bekannten Insel mit Platz (leere zuerst, das Festland hat lange Platz)
    if (!spot && !st.earth && knows(st, 'segeln', s) && bldOf(st, s).some(b => (b.t === 'hafen' || b.t === 'fischer'))) {
      const open = st.isles.filter(J => J.id !== s.isle && (I.seen[J.id] || I.contact[J.id]) && count(J.id) < isleCap(J))
        .sort((a, b) => (count(a.id) ? 1 : 0) - (count(b.id) ? 1 : 0) || isleGap(st, I, a).d - isleGap(st, I, b).d);
      for (const J of open) {
        if (isleGap(st, I, J).d > reach(st, I)) continue;
        const land = J.area > 2500 ? knownCoast(st, J.id, s.cx, s.cy) : null;
        spot = findNewHome(st, J.id, count(J.id) ? 22 : 0, 0, land ? [land[0], land[1], 18] : null);
        if (spot) { target = J; sea = true; break; }
      }
    }
    if (!spot) continue;
    const g = pickGroup(st, s);
    if (!g) return;
    const { founder, group } = g;
    if (sea && !st.earth) carryKnowledge(st, I, target);
    const ns = foundSettlement(st, spot[0], spot[1], [...group], { parent: s, leader: founder });
    founder.fame += 3;
    bio(founder, st.day, L(`gründet ${ns.name}`, `founds ${ns.name}`));
    if (sea) {
      st.voyages.push({ k: 'siedler', a: s.id, b: ns.id, d: st.day, dur: 5 });
      if (st.earth) chron(st, 'gruendung', L(`${founder.n} segelt mit ${group.size} Menschen aus ${s.name} über das Meer. An der fernen Küste (${target.name}) gründen sie ${ns.name}.`, `${founder.n} sails across the sea from ${s.name} with ${group.size} people. On the distant coast (${target.name}) they found ${ns.name}.`), ns.id, 2, { x: ns.cx, y: ns.cy });
      else chron(st, 'gruendung', r.pick(L([
        `${founder.n} segelt mit ${group.size} Menschen aus ${s.name} über das Meer. Auf der Insel ${target.name} gründen sie ${ns.name}.`,
        `Drei Boote verlassen den Hafen von ${s.name}. Unter ${founder.n} wird die leere Insel ${target.name} zur neuen Heimat: ${ns.name}.`,
      ], [
        `${founder.n} sails across the sea from ${s.name} with ${group.size} people. On the island of ${target.name} they found ${ns.name}.`,
        `Three boats leave the harbor of ${s.name}. Under ${founder.n}, the empty island of ${target.name} becomes a new home: ${ns.name}.`,
      ])), ns.id, 2, { x: ns.cx, y: ns.cy });
    } else chron(st, 'gruendung', r.pick(L([
      `${founder.n} führt ${group.size} Menschen aus ${s.name} fort, über die Hügel, an einen neuen Ort. Sie nennen ihn ${ns.name}.`,
      `Es wird eng in ${s.name}. Unter ${founder.n} brechen ${group.size} Mutige auf und gründen ${ns.name}.`,
    ], [
      `${founder.n} leads ${group.size} people away from ${s.name}, over the hills to a new place. They name it ${ns.name}.`,
      `Things are getting crowded in ${s.name}. Under ${founder.n}, ${group.size} brave souls set out and found ${ns.name}.`,
    ])), ns.id, 2, { x: ns.cx, y: ns.cy });
    fx(st, { type: 'found', s: ns.id });
    return;
  }
}

// ---------- Abspaltungen und Vereinigungen ----------

// Was eine abgespaltene Gruppe mitnimmt: Neigung der Kultur und eine passende Ordnung
const SPLIT = {
  glaeubige: { shift: { glaube: 0.24, wissen: -0.08 }, gov: ['theokratie', 'rat'] },
  krieger: { shift: { macht: 0.24, freiheit: -0.08 }, gov: ['diktatur', 'haeuptling'] },
  haendler: { shift: { handel: 0.24, tradition: -0.06 }, gov: ['republik', 'rat'] },
  gelehrte: { shift: { wissen: 0.24, glaube: -0.1 }, gov: ['technokratie', 'republik', 'rat'] },
  volk: { shift: { freiheit: 0.24, macht: -0.1 }, gov: ['volksrat', 'demokratie', 'rat'] },
};

function splitText(fac, s, ld, n, ns, ruler, sea, isle, earth) {
  const far = sea ? L(`über das Meer nach ${isle}`, `across the sea to ${isle}`) : earth ? L('weit fort, über Berge und Flüsse', 'far away, over mountains and rivers') : L('ans andere Ende der Insel', 'to the far side of the island');
  return {
    glaeubige: L(`Streit um den rechten Glauben zerreißt ${s.name}. ${ld.n} führt ${n} Gläubige ${far}. Dort bauen sie ${ns.name}, eine Stadt der Gebete.`,
      `A quarrel over the true faith tears ${s.name} apart. ${ld.n} leads ${n} believers ${far}. There they build ${ns.name}, a town of prayer.`),
    krieger: L(`${ld.n} und ${n} Getreue sagen sich von ${ruler} los. Sie ziehen ${far} und errichten ${ns.name}, eine Festung mit eigenem Gesetz.`,
      `${ld.n} and ${n} loyal followers break away from ${ruler}. They move ${far} and raise ${ns.name}, a stronghold with its own law.`),
    haendler: L(`Die Händler von ${s.name} haben genug von Abgaben. ${ld.n} zieht mit ${n} Menschen ${far} und gründet ${ns.name}, wo nur der Markt regiert.`,
      `The traders of ${s.name} have had enough of taxes. ${ld.n} takes ${n} people ${far} and founds ${ns.name}, where only the market rules.`),
    gelehrte: L(`Die Denker von ${s.name} wollen frei fragen dürfen. Unter ${ld.n} gehen ${n} Menschen ${far} und gründen ${ns.name}.`,
      `The thinkers of ${s.name} want to be free to ask questions. Under ${ld.n}, ${n} people go ${far} and found ${ns.name}.`),
    volk: L(`Das einfache Volk von ${s.name} erträgt ${ruler} nicht länger. ${n} Menschen folgen ${ld.n} ${far} und gründen ${ns.name}, ohne Herren.`,
      `The common folk of ${s.name} can no longer bear ${ruler}. ${n} people follow ${ld.n} ${far} and found ${ns.name}, with no masters.`),
  }[fac];
}

// Eine starke Gruppe, die sich nicht vertreten fühlt, zieht fort und gründet eine eigene Siedlung,
// am liebsten weit weg auf derselben Insel, sonst über das Meer. Die Trennung bleibt lange bitter.
export function schismStep(st) {
  const r = rng(st), C = st.char || {};
  const alive = st.settlements.filter(s => s.alive);
  if (alive.length >= st._rt.maxSet) return;
  const count = id => alive.filter(o => o.isle === id).length;
  for (const s of alive) {
    if (s.era < 1 || s.pop < 50 || !s.fac || st.day - s.founded < 6 * D.DAYS_PER_YEAR || (s.splitAt || 0) > st.day) continue;
    const ruling = D.GOVS[s.gov.type].faction;
    const top = Object.entries(s.fac).filter(([k]) => k !== ruling).sort((a, b) => b[1] - a[1])[0];
    if (!top || top[1] < 0.24) continue;
    const [fac, share] = top;
    const tension = s.unrest * 0.9 + share * 0.8 + (1 - (s.legit ?? 0.6)) * 0.5 + (s.hunger || 0) * 0.3 + (s.war ? 0.1 : 0) - 0.85;
    if (tension <= 0 || !r.chance(Math.min(0.3, tension * 0.4 * (C.schism || 1)))) continue;
    const I = isleOf(st, s);
    let spot = null, target = I, sea = false;
    if (count(s.isle) < isleCap(I) + 1) spot = findNewHome(st, landOf(s), 26, 0.35, null, s);
    if (!spot && st.earth && knows(st, 'segeln', s) && bldOf(st, s).some(b => (b.t === 'hafen' || b.t === 'fischer'))) {
      const tg = earthSeaTarget(st, s);
      if (tg) { spot = findNewHome(st, tg.land.id, 22, 0, [tg.coast[0], tg.coast[1], 18]); if (spot) { target = { name: L(tg.land.de, tg.land.en) }; sea = true; } }
    }
    if (!spot && !st.earth && knows(st, 'segeln', s) && bldOf(st, s).some(b => (b.t === 'hafen' || b.t === 'fischer'))) {
      const empty = st.isles.filter(J => J.id !== s.isle && (I.seen[J.id] || I.contact[J.id]) && !count(J.id));
      for (const J of r.shuffle(empty)) { spot = findNewHome(st, J.id, 0); if (spot) { target = J; sea = true; break; } }
    }
    if (!spot) { s.splitAt = st.day + 2 * D.DAYS_PER_YEAR; continue; }
    // Wer geht: Erwachsene der Gruppe, mit Partnern und Kindern, höchstens 45 Prozent
    const M = members(st, s), ruler = leaderOf(st, s);
    const core = M.adults.filter(p => p.fac === fac && p !== ruler && ageOf(st, p) < 56);
    if (core.length < 6) continue;
    const ld = core.reduce((a, p) => (p.tr.charisma + p.tr.mut * 0.5 > a.tr.charisma + a.tr.mut * 0.5 ? p : a), core[0]);
    const cap = Math.floor(s.pop * 0.35);
    const group = new Set([ld]);
    for (const p of [ld, ...r.shuffle(core.slice())]) {
      if (group.size >= cap) break;
      group.add(p);
      const q = p.pa && st._rt.pById.get(p.pa);
      if (q && q.s === s.id && q !== ruler) group.add(q);
      for (const k of M.kids) if ((k.mo === p.id || k.fa === p.id) && group.size < cap) group.add(k);
    }
    if (group.size < 8) continue;
    if (sea && !st.earth) carryKnowledge(st, I, target);
    const Sp = SPLIT[fac];
    const gov = Sp.gov.find(g => g === 'diktatur' ? s.era >= 2 : govAllowed(st, s, g)) || 'rat';
    const ns = foundSettlement(st, spot[0], spot[1], [...group], { parent: s, leader: ld, cultShift: Sp.shift, gov, split: true }); // split: eigener Staat (states.js)
    const bitter = fac === 'krieger' || fac === 'glaeubige' ? r.range(25, 50) : r.range(5, 30);
    s.rel[ns.id] = ns.rel[s.id] = -bitter;
    ns.stock.wood += 10;
    ns.creed = fac; ns.splitFrom = s.id;
    if (st._rt.onSplit) st._rt.onSplit(st, s, ns, fac, group); // Gläubige gründen oft eine Sekte (faith.js)
    s.unrest = clamp(s.unrest - 0.3, 0, 1);
    s.splitAt = st.day + 8 * D.DAYS_PER_YEAR;
    ns.splitAt = st.day + 12 * D.DAYS_PER_YEAR;
    ld.fame += 4;
    bio(ld, st.day, L(`führt die Abspaltung von ${s.name} an und gründet ${ns.name}`, `leads the split from ${s.name} and founds ${ns.name}`));
    if (sea) st.voyages.push({ k: 'siedler', a: s.id, b: ns.id, d: st.day, dur: 5 });
    st.counts.schisms = (st.counts.schisms || 0) + 1;
    chron(st, 'gruendung', splitText(fac, s, ld, group.size, ns, ruler ? label(ruler) : s.name, sea, target.name, st.earth), ns.id, 2, { x: ns.cx, y: ns.cy });
    fx(st, { type: 'found', s: ns.id });
    return;
  }
}

// Kleine, befreundete Siedlungen schließen sich friedlich einer größeren Nachbarin an
export function unionStep(st) {
  const r = rng(st);
  const alive = st.settlements.filter(s => s.alive);
  for (const small of alive) {
    if (small.pop >= 20 || small.war || st.day - small.founded < 6 * D.DAYS_PER_YEAR) continue;
    let best = null, bd = 1e9;
    for (const o of alive) {
      if (o === small || !sameLand(st, o, small) || o.war || o.pop < small.pop * 2.5) continue;
      const d = Math.hypot(o.cx - small.cx, o.cy - small.cy), rel = small.rel[o.id] ?? 0;
      if ((rel > 40 || (small.hunger > 0.25 && rel > 0)) && d < 60 && d < bd) { bd = d; best = o; }
    }
    if (!best || !r.chance(0.35)) continue;
    // seit 24.10.2026 bleibt der Ort bestehen und wird Teil des Staates (states.js), nur Weiler verschmelzen
    if (st._rt.pol && small.pop >= 6) {
      st._rt.pol.join(st, small, best);
      chron(st, 'politik', L(`${small.name} schließt sich in Freundschaft ${best.name} an und wird Teil seines Staates. Der alte Rat wird zum Stadtrat.`, `${small.name} joins ${best.name} in friendship and becomes part of its state. The old council becomes a town council.`), best.id, 1);
      setTerritory(st);
      return;
    }
    absorb(st, best, small);
    chron(st, 'politik', r.pick(L([
      `${small.name} ist zu klein geworden, um allein zu bestehen. In Freundschaft schließt es sich ${best.name} an.`,
      `Die Ältesten von ${small.name} und ${best.name} reichen sich die Hände. Aus zwei Orten wird einer.`,
    ], [
      `${small.name} has grown too small to stand alone. In friendship it joins ${best.name}.`,
      `The elders of ${small.name} and ${best.name} join hands. Two places become one.`,
    ])), best.id, 1);
    indexMembers(st);
    setTerritory(st);
    return;
  }
}

// ---------- Gebete ----------

const PRAYER_TXT = {
  regen: L(['Schenk uns Regen, unsere Felder sind Staub.', 'Lass den Himmel weinen, damit wir nicht weinen müssen.', 'Wasser, nur ein wenig Wasser.'],
    ['Grant us rain, our fields are dust.', 'Let the sky weep, so that we do not have to.', 'Water, just a little water.']),
  segen: L(['Segne unsere Felder, die Kinder sind hungrig.', 'Mach die Erde wieder freundlich.', 'Gib uns eine Ernte, die uns durch den Winter trägt.'],
    ['Bless our fields, the children are hungry.', 'Make the earth kind to us again.', 'Give us a harvest that will carry us through the winter.']),
  sonne: L(['Schick uns Wärme, die Alten frieren.', 'Wir sehnen uns nach der Sonne.', 'Vertreib die Kälte aus unseren Hütten.'],
    ['Send us warmth, the old ones are freezing.', 'We long for the sun.', 'Drive the cold out of our huts.']),
  heilung: L(['Nimm das Fieber von uns.', 'Heile unsere Kranken, wir bitten dich.', 'Die Hustenden sterben, hilf uns.'],
    ['Take the fever from us.', 'Heal our sick, we beg you.', 'Those who cough are dying, help us.']),
  nebel: L(['Verbirg uns vor unseren Feinden.', 'Hüll uns in Nebel, damit sie uns nicht finden.'],
    ['Hide us from our enemies.', 'Wrap us in fog so they cannot find us.']),
  regenbogen: L(['Gib uns ein Zeichen des Friedens.', 'Beende diesen Krieg, wir sind müde.', 'Zeig uns, dass du uns siehst.'],
    ['Give us a sign of peace.', 'End this war, we are tired.', 'Show us that you see us.']),
  fische: L(['Füll unsere Netze.', 'Das Meer ist leer geworden, schick uns Fische.'],
    ['Fill our nets.', 'The sea has gone empty, send us fish.']),
  funke: L(['Schenk uns eine Idee, wir stehen still.', 'Öffne unseren Geist.', 'Zeig uns, was wir noch nicht wissen.'],
    ['Grant us an idea, we are standing still.', 'Open our minds.', 'Show us what we do not yet know.']),
  komet: L(['Zeig uns ein Zeichen am Himmel.', 'Sprich zu uns durch die Sterne.'],
    ['Show us a sign in the sky.', 'Speak to us through the stars.']),
};

export function prayersStep(st) {
  const r = rng(st), season = seasonOf(st.day);
  for (const s of st.settlements) {
    if (!s.alive || !s.pop) continue;
    const ex = st.prayers.find(p => p.s === s.id);
    if (ex) {
      if (st.day > ex.until) {
        st.prayers = st.prayers.filter(p => p !== ex);
        for (const p of members(st, s).all) p.faith = clamp(p.faith - 0.04, 0, 1);
        shiftCult(s, 'glaube', -0.015); shiftCult(s, 'wissen', 0.008);
        s.unanswered = (s.unanswered || 0) + 1;
        if (r.chance(0.6)) chron(st, 'gebet', r.pick(L([
          `Die Gebete von ${s.name} verhallen im Wind.`,
          `${ex.whoN} wartet vergeblich auf ein Zeichen. Manche in ${s.name} beginnen zu zweifeln.`,
          `Keine Antwort vom Himmel. In ${s.name} fragt man leise, ob überhaupt jemand zuhört.`,
        ], [
          `The prayers of ${s.name} fade away on the wind.`,
          `${ex.whoN} waits in vain for a sign. Some in ${s.name} begin to doubt.`,
          `No answer from the sky. In ${s.name} people quietly ask whether anyone is listening at all.`,
        ])), s.id, 0);
      }
      continue;
    }
    if (!r.chance(0.5)) continue;
    const M = members(st, s);
    const need = s.prod.need || s.pop;
    const w = [];
    if (st.weather.moist < 0.22 && season < 3) w.push(['regen', 4]);
    if (s.hunger > 0.08 || s.stock.food < need * 5) w.push([st.weather.moist < 0.35 ? 'regen' : 'segen', 3]);
    if (season === 3 && (s.homeCap || 0) < s.pop) w.push(['sonne', 2.5]);
    const sick = M.all.filter(p => p.sick).length / Math.max(1, M.all.length);
    if (sick > 0.07) w.push(['heilung', 4]);
    if (s.war) w.push([r.chance(0.5) ? 'nebel' : 'regenbogen', 3]);
    const fish = M.adults.filter(p => p.job === 'fischer').length;
    if (fish > 1 && (s.prod.food || 0) < need * 1.1) w.push(['fische', 2]);
    let fire = false;
    for (const b of bldOf(st, s)) if (st.tiles.burn[idx(b.x, b.y)]) { fire = true; break; }
    if (fire) w.push(['regen', 5]);
    if (s.cult.wissen > 0.55 && (isleOf(st, s) || {}).research?.cur) w.push(['funke', 1.2]);
    if (!w.length && s.faith > 0.5 && r.chance(0.35)) w.push([r.pick(['regenbogen', 'komet', 'segen']), 1]);
    if (!w.length) continue;
    w.sort((a, b) => b[1] - a[1]);
    const power = w[0][0];
    const pool = M.adults.concat(M.old);
    if (!pool.length) continue;
    const who = pool.reduce((a, p) => (p.faith + (p.job === 'priester' ? 0.5 : 0) > a.faith + (a.job === 'priester' ? 0.5 : 0) ? p : a), pool[0]);
    const t = r.pick(PRAYER_TXT[power]);
    st.prayers.push({ id: st.nextId++, s: s.id, power, who: who.id, whoN: who.n, t, d: st.day, until: st.day + 12 });
    chron(st, 'gebet', L(`${who.lt || who.title ? (who.lt || who.title) + ' ' : ''}${who.n} betet in ${s.name}: „${t}“`, `${who.lt || who.title ? (who.lt || who.title) + ' ' : ''}${who.n} prays in ${s.name}: “${t}”`), s.id, 0, { power });
  }
}

// ---------- Kleine Ereignisse ----------

export function outbreak(st, s, share, len = [6, 12]) {
  // seit 20.10.2026 geht das Fieber im Seuchenmodell auf (epidemic.js): angesteckt wird über SEIR, mit Immunität
  if (st._rt.seedFever) return st._rt.seedFever(st, s, share);
  const r = rng(st), M = members(st, s);
  let n = 0;
  for (const p of M.all) if (r.chance(share)) { p.sick = r.int(len[0], len[1]); p.hp = Math.max(0, p.hp - 0.1); n++; }
  return n;
}

export function eventsStep(st, season) {
  const r = rng(st), doy = st.day % D.DAYS_PER_YEAR;
  if (!st.people.length && doy === 3 && r.chance(0.35)) newcomers(st);
  for (const s of st.settlements) {
    if (!s.alive || !s.pop) continue;
    const pop = s.pop;
    // Krankheit
    const sick = (D.BIOMES[st.tiles.bio[idx(s.cx, s.cy)]] || D.BIOMES[0]).sick; // Sümpfe und Regenwald: mehr Fieber
    const ill = 0.0011 * sick * (1 + pop / 140) * (knows(st, 'impfung', s) ? 0.25 : 1) * (s.counts?.wells ? 0.75 : 1) * (s.hunger > 0.2 ? 2 : 1);
    if (r.chance(ill)) {
      const n = outbreak(st, s, r.range(0.06, 0.18));
      if (n >= 2) chron(st, 'natur', r.pick(L([`Ein Fieber geht um in ${s.name}. ${n} Menschen liegen krank.`, `Husten und Hitze in ${s.name}: ${n} Kranke.`], [`A fever is going around ${s.name}. ${n} people lie sick.`, `Coughing and fever in ${s.name}: ${n} sick.`])), s.id, 1);
    }
    // Brand
    if (s.era <= 4 && r.chance(0.0005 * pop / 40)) {
      const bs = bldOf(st, s).filter(b => b.t !== 'feld' && b.t !== 'zentrum');
      if (bs.length) { const b = r.pick(bs); st.tiles.burn[idx(b.x, b.y)] = 3; st._rt.fire = 1; chron(st, 'natur', L(`Feuer in ${s.name}! ${D.BUILDINGS[b.t].name} brennt.`, `Fire in ${s.name}! The ${D.BUILDINGS[b.t].name.toLowerCase()} is burning.`), s.id, 0, { x: b.x, y: b.y }); }
    }
    // Erntefest
    if (doy === 15 && s.stock.food > (s.prod.need || pop) * 15) {
      for (const p of members(st, s).all) p.hap = clamp(p.hap + 0.06, 0, 1);
      if (r.chance(0.1)) chron(st, 'fest', r.pick(L([`Erntefest in ${s.name}. Es wird getanzt, bis das Feuer nur noch glüht.`, `Die Speicher von ${s.name} sind voll. Man feiert drei Nächte lang.`], [`Harvest festival in ${s.name}. They dance until the fire only glows.`, `The granaries of ${s.name} are full. They celebrate for three nights.`])), s.id, 0);
    }
    // Gestrandete in der Frühzeit
    if (s.era <= 1 && doy === 10 && pop < 40 && r.chance(0.22)) {
      const n = r.int(2, 4);
      // in der Erde keine Fremden aus dem Nichts: versprengte Wanderer desselben Volkes finden den Ort
      const lang = st.earth ? s.lang : r.chance(0.5) ? s.lang : r.int(0, 3);
      const arr = [];
      for (let i = 0; i < n; i++) { const p = makePerson(st, s, { b: st.day - r.int(16, 30) * D.DAYS_PER_YEAR, lang }); bio(p, st.day, st.earth ? L(`findet als Wanderer den Weg nach ${s.name}`, `finds the way to ${s.name} as a wanderer`) : L(`strandet an der Küste von ${s.name}`, `washes ashore on the coast of ${s.name}`)); arr.push(p); }
      if (arr.length >= 2 && arr[0].sex !== arr[1].sex) { arr[0].pa = arr[1].id; arr[1].pa = arr[0].id; }
      chron(st, 'fremde', st.earth ? L(`${n} Wanderer aus dem Hinterland finden den Weg nach ${s.name}. Sie sprechen dieselbe Sprache und bleiben.`, `${n} wanderers from the backcountry find their way to ${s.name}. They speak the same tongue and stay.`) : L(`${n} Schiffbrüchige werden an den Strand von ${s.name} gespült. Man gibt ihnen Wasser und einen Platz am Feuer.`, `${n} shipwrecked people wash up on the beach of ${s.name}. They are given water and a place by the fire.`), s.id, 0);
    }
    // Händler von fernen Inseln
    if (s.era >= 2 && r.chance(0.0025) && bldOf(st, s).some(b => b.t === 'hafen') && (!st.earth || Object.keys(isleOf(st, s).contact).length)) {
      s.stock.gold += 20; s.stock.goods += 10; isleOf(st, s).research.pts += 15;
      chron(st, 'fremde', L(`Ein fremdes Schiff legt in ${s.name} an. Seide, Gewürze und Geschichten von anderen Inseln.`, `A foreign ship docks at ${s.name}. Silk, spices and stories from other islands.`), s.id, 0);
    }
    // Familienfehde
    if (pop > 25 && r.chance(0.0007)) {
      s.unrest = clamp(s.unrest + 0.08, 0, 1);
      const M = members(st, s), a = r.pick(M.adults), b = r.pick(M.adults);
      if (a && b && a.clan !== b.clan) chron(st, 'politik', L(`In ${s.name} streiten die Familien ${a.clan} und ${b.clan}. Niemand weiß mehr, wer angefangen hat.`, `In ${s.name} the families ${a.clan} and ${b.clan} are feuding. Nobody remembers who started it.`), s.id, 0);
    }
    // Wale
    if (r.chance(0.0004)) chron(st, 'natur', L(`Vor ${s.name} ziehen Wale vorbei. Die Kinder rennen an den Strand.`, `Whales pass by ${s.name}. The children run down to the beach.`), s.id, 0);
  }
  // Feste zu Ehren alter Mythen
  for (const m of st.myths) {
    if (!m.good || m.doy !== doy || st.day - m.d < D.DAYS_PER_YEAR) continue;
    const s = st._rt.sById.get(m.s);
    if (!s || !s.alive) continue;
    for (const p of members(st, s).all) { p.hap = clamp(p.hap + 0.04, 0, 1); p.faith = clamp(p.faith + 0.02, 0, 1); }
    m.fests = (m.fests || 0) + 1;
    if (m.fests === 1 || m.fests % 5 === 0) chron(st, 'fest', L(`${s.name} feiert das Fest „${m.name}“, ${m.fests === 1 ? 'zum ersten Mal' : `zum ${m.fests}. Mal`}.`, `${s.name} celebrates the festival “${m.name}”, ${m.fests === 1 ? 'for the first time' : `for the ${m.fests}th time`}.`), s.id, 0);
  }
}

export function yearStep(st) {
  refreshProgress(st); // neue Orte bekommen ihren Wohnraum nach Fortschritt (progress.js)
  const y = Math.floor(st.day / D.DAYS_PER_YEAR);
  st.stats.push({
    y, pop: st.people.length, sets: st.settlements.filter(s => s.alive).length, era: st.era,
    faith: Math.round((st.faithAvg || 0) * 100) / 100,
    food: Math.round(st.settlements.reduce((a, s) => a + (s.alive ? s.stock.food : 0), 0)),
  });
  if (st.stats.length > 3000) st.stats.splice(0, st.stats.length - 3000);
}
