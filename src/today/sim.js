// Erde heute (seit 26.10.2026, PLAN_ERDE_HEUTE.md): die Simulation der echten Welt ab dem 26. Oktober 2026.
// 8 Milliarden Menschen lassen sich nicht einzeln rechnen. Darum rechnen die Länder mit echten Zahlen (Geburten, Tode,
// Wanderung, Wirtschaft mit Konjunktur, Inflation, Arbeitslosigkeit, Zustimmung, Wahlen nach echten Terminen,
// Stabilität, Proteste, Putsche, Beziehungen aus Bündnissen, Kriege und Waffenstillstände), dazu Naturkatastrophen an
// echten Gefahrenzonen, Klima, Erfindungen der Zukunft, Glaube und Gebete. Einzelne Menschen: dein Mensch mit Familie
// (people.js) und jeder angeklickte Mensch bekommt ein festes Leben aus dem Seed. Reines JS ohne DOM, deterministisch
// (nur Rng), läuft auch in Node. Ein Spieltag = 1/24 Jahr wie im übrigen Spiel.
import { Rng } from '../sim/rng.js';
import { L, LANG } from '../i18n.js';
import { TODAY, cityName, countryName } from './data.js';
import { makePerson, heroStep, personName } from './people.js';
import { initGroups, ensureGroups, groupsStep } from './groups.js';

export const DPY = 24;
const DT = 1 / DPY;
export const START = Date.UTC(2026, 9, 26);
export const VERSION = 1;
export const MANA_MAX = 160;

export const dateOf = day => new Date(START + day * 365.2425 / DPY * 86400000);
export const yearOf = day => dateOf(day).getUTCFullYear();
export function dateText(day, withDay = true) {
  const d = dateOf(day);
  return d.toLocaleDateString(LANG === 'de' ? 'de-DE' : 'en-GB', withDay ? { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' } : { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
const dayOfDate = s => {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return null;
  const t = Date.UTC(+m[1], m[2] ? +m[2] - 1 : 5, m[3] ? +m[3] : 15);
  return Math.round((t - START) / 86400000 * DPY / 365.2425);
};

// Staatsformen: Klartext, ob es freie Wahlen gibt (demo 0..1), Amtszeit in Jahren
export const GOV = {
  parl_rep: { de: 'Parlamentarische Republik', en: 'Parliamentary republic', demo: 1, term: 4 },
  pres_rep: { de: 'Präsidialrepublik', en: 'Presidential republic', demo: 1, term: 4 },
  semi_pres: { de: 'Semipräsidentielle Republik', en: 'Semi-presidential republic', demo: 1, term: 5 },
  const_mon: { de: 'Parlamentarische Monarchie', en: 'Constitutional monarchy', demo: 1, term: 4 },
  semi_mon: { de: 'Monarchie mit starker Krone', en: 'Monarchy with a strong crown', demo: 0.3, term: 4 },
  abs_mon: { de: 'Absolute Monarchie', en: 'Absolute monarchy', demo: 0, term: 0 },
  one_party: { de: 'Einparteienstaat', en: 'One-party state', demo: 0, term: 5 },
  theocracy: { de: 'Theokratie', en: 'Theocracy', demo: 0.2, term: 4 },
  military: { de: 'Militärregierung', en: 'Military government', demo: 0, term: 0 },
  auth_rep: { de: 'Autoritäre Präsidialherrschaft', en: 'Authoritarian presidency', demo: 0.15, term: 6 },
  transition: { de: 'Übergangsregierung', en: 'Transitional government', demo: 0.2, term: 2 },
};
export const govName = g => { const G = GOV[g] || GOV.transition; return L(G.de, G.en); };

// Gefahrenzonen: Länder mit Erdbeben, Wirbelstürmen (Monate), Fluten, Dürren (grobe Gewichte)
const QUAKE = { JPN: 9, IDN: 9, CHN: 6, TUR: 7, IRN: 6, PHL: 7, CHL: 7, PER: 5, MEX: 6, ECU: 4, COL: 3, GTM: 3, NPL: 5, PAK: 4, AFG: 4, IND: 3, ITA: 3, GRC: 3, NZL: 4, USA: 3, TWN: 5, PNG: 4, MMR: 3, HTI: 3, VUT: 2, SLB: 2, TJK: 2, KGZ: 2, DZA: 2, MAR: 2, ALB: 1, ROU: 1, ISL: 1, SYR: 2, CRI: 2, NIC: 2, SLV: 2, BOL: 1, ARG: 1, KAZ: 1 };
const STORM = { USA: [8, [7, 8, 9, 10]], MEX: [5, [6, 7, 8, 9, 10]], CUB: [4, [8, 9, 10]], HTI: [3, [8, 9, 10]], DOM: [3, [8, 9, 10]], BHS: [2, [8, 9, 10]], JAM: [2, [8, 9, 10]], PHL: [9, [6, 7, 8, 9, 10, 11]], JPN: [6, [7, 8, 9, 10]], CHN: [6, [6, 7, 8, 9, 10]], VNM: [5, [8, 9, 10, 11]], TWN: [4, [7, 8, 9]], KOR: [3, [7, 8, 9]], BGD: [6, [4, 5, 10, 11]], IND: [6, [5, 6, 10, 11]], MMR: [3, [4, 5, 10]], MDG: [3, [0, 1, 2, 3]], MOZ: [3, [0, 1, 2, 3]], AUS: [3, [0, 1, 2, 3]], FJI: [2, [0, 1, 2, 3]], OMN: [1, [5, 6, 10]], HND: [2, [9, 10]], NIC: [2, [9, 10]] };
const FLOOD = { CHN: 8, IND: 8, BGD: 7, PAK: 6, IDN: 5, NGA: 4, BRA: 3, DEU: 1, ITA: 2, ESP: 2, VNM: 4, THA: 3, PHL: 3, USA: 3, COD: 2, SDN: 2, ETH: 2, KEN: 2, SOM: 2, NPL: 2, AFG: 1, IRN: 1, FRA: 1, GBR: 1, POL: 1, ROU: 1, MOZ: 2, ZAF: 1, AUS: 2, ARG: 1, COL: 2, PER: 2, VEN: 1, MEX: 2 };
const DRY = { SOM: 6, ETH: 6, KEN: 4, SDN: 4, SSD: 3, NER: 4, MLI: 4, TCD: 4, BFA: 3, MRT: 3, AFG: 3, PAK: 2, IND: 2, AUS: 3, ZAF: 2, MDG: 3, ZWE: 2, ZMB: 2, MOZ: 2, AGO: 2, NAM: 2, BWA: 1, MAR: 3, DZA: 2, TUN: 2, ESP: 2, PRT: 1, ITA: 1, GRC: 1, TUR: 2, SYR: 3, IRQ: 3, IRN: 3, USA: 2, MEX: 3, BRA: 2, ARG: 2, CHL: 2, BOL: 1, PER: 1 };

// Zukunft: Erfindungen und Meilensteine. Jahr = frühestens, p = Grundwahrscheinlichkeit je Jahr danach
const FUTURE = [
  { id: 'akku', y: 2027, p: 0.35, de: 'Feststoffakkus gehen in Serie. Elektroautos fahren 1200 km mit einer Ladung.', en: 'Solid-state batteries enter mass production. Electric cars drive 1,200 km on one charge.' },
  { id: 'krebs', y: 2028, p: 0.2, de: 'Ein persönlicher mRNA Impfstoff gegen Hautkrebs wird zugelassen.', en: 'A personalised mRNA vaccine against skin cancer is approved.' },
  { id: 'mond', y: 2028, p: 0.3, de: 'Wieder landen Menschen auf dem Mond, zum ersten Mal seit 1972.', en: 'Humans land on the Moon again, for the first time since 1972.' },
  { id: 'ki', y: 2029, p: 0.18, de: 'Eine KI entdeckt selbstständig ein neues Antibiotikum, das gegen resistente Keime wirkt.', en: 'An AI independently discovers a new antibiotic that works against resistant germs.' },
  { id: 'quanten', y: 2030, p: 0.15, de: 'Ein Quantencomputer rechnet zum ersten Mal eine nützliche Aufgabe schneller als jeder klassische Rechner.', en: 'A quantum computer solves a useful problem faster than any classical machine for the first time.' },
  { id: 'malaria', y: 2030, p: 0.12, de: 'Ein neuer Impfstoff halbiert die Malaria Toten in Afrika.', en: 'A new vaccine halves malaria deaths in Africa.' },
  { id: 'mondbasis', y: 2032, p: 0.14, needs: 'mond', de: 'Am Südpol des Mondes entsteht die erste dauerhaft bewohnte Station.', en: 'The first permanently crewed station opens at the Moon\'s south pole.' },
  { id: 'co2', y: 2033, p: 0.1, de: 'Riesige Anlagen holen erstmals mehr als eine Milliarde Tonnen CO₂ im Jahr aus der Luft.', en: 'Huge plants pull more than a billion tonnes of CO₂ out of the air per year for the first time.' },
  { id: 'mars', y: 2034, p: 0.09, needs: 'mondbasis', de: 'Menschen landen auf dem Mars.', en: 'Humans land on Mars.' },
  { id: 'fusion', y: 2036, p: 0.08, de: 'Das erste Fusionskraftwerk speist dauerhaft Strom ins Netz.', en: 'The first fusion power plant feeds electricity into the grid around the clock.' },
  { id: 'alter', y: 2038, p: 0.06, de: 'Eine Therapie verlangsamt das Altern messbar. Die Lebenserwartung steigt sprunghaft.', en: 'A therapy measurably slows ageing. Life expectancy jumps.' },
  { id: 'marsstadt', y: 2045, p: 0.05, needs: 'mars', de: 'Auf dem Mars leben tausend Menschen in einer Kuppelstadt.', en: 'A thousand people live in a domed city on Mars.' },
  { id: 'aufzug', y: 2060, p: 0.03, de: 'Ein Weltraumaufzug verbindet den Äquator mit dem Orbit.', en: 'A space elevator connects the equator with orbit.' },
  { id: 'stern', y: 2070, p: 0.02, needs: 'marsstadt', de: 'Eine erste Sonde startet zum nächsten Stern, Alpha Centauri.', en: 'A first probe launches towards the nearest star, Alpha Centauri.' },
];
// Große Ereignisse nach Kalender (echte Termine)
const CALENDAR = [
  { at: '2026-11-03', de: 'In den Vereinigten Staaten wird gewählt: Zwischenwahlen für den Kongress.', en: 'The United States votes: midterm elections for Congress.', iso: 'USA' },
  { at: '2027-06-15', de: 'Die Welt schaut auf Saudi-Arabien: Asienspiele und Großbauten der Vision 2030 wachsen.', en: 'The world looks at Saudi Arabia: Vision 2030 megaprojects keep rising.', iso: 'SAU' },
  { at: '2028-07-14', de: 'In Los Angeles beginnen die Olympischen Sommerspiele.', en: 'The Summer Olympics open in Los Angeles.', iso: 'USA' },
  { at: '2028-11-07', de: 'Präsidentschaftswahl in den Vereinigten Staaten.', en: 'Presidential election in the United States.', iso: 'USA' },
  { at: '2030-06-08', de: 'Die Fußball-Weltmeisterschaft beginnt in Marokko, Spanien und Portugal, das Eröffnungsspiel in Südamerika.', en: 'The FIFA World Cup kicks off in Morocco, Spain and Portugal, with opening games in South America.', iso: 'MAR' },
  { at: '2032-07-23', de: 'In Brisbane beginnen die Olympischen Sommerspiele.', en: 'The Summer Olympics open in Brisbane.', iso: 'AUS' },
];

// ---------- Weltbau ----------
export function createToday(seed, home) {
  const T = TODAY, r = new Rng(Math.imul(seed >>> 0, 2654435761) >>> 0);
  const ts = {
    v: VERSION, kind: 'today', seed: seed >>> 0, rng: r.s, day: 0, acc: 0, savedAt: 0,
    c: [], rel: {}, wars: [], news: [], prayers: [], nextPrayer: 1, cdmg: {}, mana: 100,
    w: { temp: 1.48, co2: 427, sea: 0, tech: 0, done: [], cyc: 0, rec: 0, births: 0, deaths: 0, faith: 0.6, cal: 0, peace: 0 },
    counts: { powers: 0, answered: 0, quakes: 0, storms: 0, elections: 0 },
    home: home || null, hero: null, lastPow: {},
  };
  for (const C of T.list) {
    const G = GOV[C.gov] || GOV.transition;
    const ne = dayOfDate(C.nextElection);
    const pop = C.pop || 0;
    const rel = C.rel || {};
    ts.c.push({
      id: C.id, pop, b: C.birth ?? 15, d: C.death ?? 8, mig: Math.max(-0.02, Math.min(0.02, (C.growth ?? 0.01) - ((C.birth ?? 15) - (C.death ?? 8)) / 1000)),
      gdp: C.gdp || pop * 3000, g: 0.02, gT: trend(C.gdppc || 3000), infl: 0.03 + Math.max(0, 0.04 - (C.free ?? 50) / 2500), unemp: 0.06,
      appr: 0.42 + r.next() * 0.16, stab: 0.5 + G.demo * 0.3 + (C.free ?? 50) / 400, faith: Math.max(0.05, 1 - (rel.none ?? 0.15) - 0.15),
      gov: C.gov, lead: '', since: -r.int(0, DPY * 4), nextE: G.demo > 0.1 ? (ne != null && ne > 0 ? ne : r.int(4, Math.round((G.term || 4) * DPY))) : -1,
      bloc: 0, war: 0, dmg: 0, dry: 0, sick: 0, flood: 0,
    });
  }
  ts.c.forEach((c, i) => { c.lead = personName(new Rng(seed ^ (i * 7919 + 1)), T.list[i]).full; });
  // Beziehungen: Freundschaften und Spannungen aus den Daten
  for (const [a, b, v] of T.rels) { const i = idxOf(a), j = idxOf(b); if (i >= 0 && j >= 0) ts.rel[key(i, j)] = v - base(i, j, true); }
  // laufende Konflikte (Stand Oktober 2026 aus den Daten)
  for (const k of T.conflicts) {
    const a = idxOf(k.a), b = k.b ? idxOf(k.b) : -1;
    if (a < 0) continue;
    ts.wars.push({ a, b, since: dayOfDate(k.since) ?? -DPY * 2, cas: 0, name: { de: k.de, en: k.en }, real: 1 });
    ts.c[a].war++; if (b >= 0) ts.c[b].war++;
  }
  // in ein Land im Krieg wandert niemand ein (die Zahlen davor zeigen oft Rückkehrer oder Fehler, etwa Ukraine +2 %)
  for (const c of ts.c) if (c.war) c.mig = Math.min(c.mig, 0);
  ts.w.births = 0; ts.w.deaths = 0;
  initGroups(ts);
  news(ts, 'welt', L(`Der 26. Oktober 2026. Auf der Erde leben ${fmtPop(worldPop(ts))} Menschen in ${T.list.filter(c => c.pop > 0).length} Ländern. Niemand weiß, dass jemand zusieht.`, `26 October 2026. ${fmtPop(worldPop(ts))} people live on Earth in ${T.list.filter(c => c.pop > 0).length} countries. Nobody knows that someone is watching.`), -1, 2);
  if (home && home.city != null) ts.hero = makePerson(ts, home.city, home.pick || 0, true);
  ts._rt = rt(ts);
  return ts;
}

// Wachstumstrend nach Wohlstand (Aufholen der ärmeren Länder): USA rund 1,7 %, China 3,5 %, Indien 5,5 %, Deutschland 1,3 %
const trend = gdppc => 0.017 + 0.045 * Math.exp(-gdppc / 14000);
export const idxOf = iso => { const C = TODAY.byIso.get(iso); return C ? TODAY.list.indexOf(C) : -1; };
const key = (i, j) => i < j ? i + '-' + j : j + '-' + i;
// Grundbeziehung aus gemeinsamen Bündnissen
function base(i, j, raw) {
  const A = TODAY.list[i].allies || [], B = TODAY.list[j].allies || [];
  let s = 0;
  for (const x of A) if (x !== 'G20' && x !== 'OPEC' && B.includes(x)) s += x === 'NATO' || x === 'EU' ? 22 : 12;
  return Math.min(80, s) + (raw ? 0 : 0);
}
export function relation(ts, i, j) { return Math.max(-100, Math.min(100, base(i, j) + (ts.rel[key(i, j)] || 0))); }

function rt(ts) {
  return { r: new Rng(ts.rng), news: [], fx: [], warOf: null };
}
export function hydrateToday(ts) { ensureGroups(ts); ts._rt = rt(ts); return ts; }
export function serializeToday(ts) { ts.rng = ts._rt.r.s; const { _rt, ...rest } = ts; return JSON.stringify(rest); }
export function deserializeToday(json) { const o = typeof json === 'string' ? JSON.parse(json) : json; return hydrateToday(o); }

export const worldPop = ts => { let s = 0; for (const c of ts.c) s += c.pop; return s; };
export function fmtPop(n) {
  if (n >= 1e9) return (n / 1e9).toLocaleString(LANG === 'de' ? 'de-DE' : 'en-GB', { maximumFractionDigits: 3 }) + L(' Milliarden', ' billion');
  if (n >= 1e6) return (n / 1e6).toLocaleString(LANG === 'de' ? 'de-DE' : 'en-GB', { maximumFractionDigits: 1 }) + L(' Millionen', ' million');
  return Math.round(n).toLocaleString(LANG === 'de' ? 'de-DE' : 'en-GB');
}
export const cName = i => countryName(TODAY.list[i], LANG);

export function news(ts, k, t, ci = -1, imp = 1, at = null) {
  const e = { d: ts.day, k, t, c: ci, imp };
  if (at) { e.x = at[0]; e.y = at[1]; }
  ts.news.push(e);
  if (ts.news.length > 600) ts.news.splice(0, ts.news.length - 600);
  if (ts._rt) ts._rt.news.push(e);
  return e;
}

// ---------- Tageslauf ----------
export function stepToday(ts) {
  ts.day++;
  const R = ts._rt.r, T = TODAY, w = ts.w, year = yearOf(ts.day), month = dateOf(ts.day).getUTCMonth();
  // Weltkonjunktur: ein langsamer Zyklus plus Zufall, selten eine Rezession
  w.cyc += -w.cyc * 0.05 + R.gauss() * 0.005;
  if (w.rec > 0) w.rec--;
  else if (R.chance(DT / 8)) { w.rec = R.int(DPY >> 1, Math.round(DPY * 1.2)); news(ts, 'wirtschaft', L('Die Weltwirtschaft rutscht in eine Rezession. Börsen fallen, Firmen stellen weniger ein.', 'The world economy slides into recession. Stock markets fall, companies hire fewer people.'), -1, 2); }
  const global = 0.008 * Math.sin(ts.day / (DPY * 8.5) * Math.PI * 2) + w.cyc - (w.rec > 0 ? 0.028 : 0) - Math.max(0, w.temp - 1.6) * 0.01;
  let births = 0, deaths = 0;
  for (let i = 0; i < ts.c.length; i++) {
    const c = ts.c[i], C = T.list[i];
    if (c.pop <= 0) continue;
    // Bevölkerung: Geburten, Tode, Wanderung (Raten wandeln sich langsam: weniger Kinder, längeres Leben)
    const bN = c.pop * c.b / 1000 * DT, dN = c.pop * (c.d / 1000 + c.sick * 0.004 + c.war * 0.0004 * (c.pop < 5e7 ? 2 : 1)) * DT;
    c.pop = Math.max(0, c.pop + bN - dN + c.pop * c.mig * DT);
    births += bN; deaths += dN;
    // demografischer Wandel (an UN WPP 2024 angelehnt): kinderreiche Länder bekommen schneller weniger Kinder,
    // alternde Länder (wenig Geburten) haben mehr Sterbefälle je 1000, auch wenn jeder Einzelne länger lebt
    c.b = Math.max(6.5, c.b - c.b * (0.008 + Math.max(0, c.b - 12) * 0.0011) * DT);
    const dT = 7 + Math.max(0, 17 - c.b) * 0.6;
    c.d += (dT - c.d) * 0.035 * DT;
    if (ts.day % DPY === 0) c.gT = trend(c.gdp / Math.max(1, c.pop));
    // neue Unruhen: arme, instabile Länder rutschen selten in einen Bürgerkrieg
    if (c.stab < 0.33 && C.gdppc < 6000 && !c.war && R.chance(0.0006 * (1 - c.stab))) { ts.wars.push({ a: i, b: -1, since: ts.day, cas: 0, name: { de: `Bürgerkrieg in ${C.de}`, en: `Civil war in ${C.en}` } }); c.war++; news(ts, 'krieg', L(`In ${cName(i)} bricht ein Bürgerkrieg aus. Bewaffnete Gruppen kämpfen um die Macht.`, `Civil war breaks out in ${cName(i)}. Armed groups fight for power.`), i, 2, capitalAt(i)); }
    // Wirtschaft: Trend nach Wohlstand, Weltlage, Krieg, Schäden, Stabilität, Zufall
    const gTarget = c.gT + global - c.war * 0.04 - c.dmg * 0.08 - c.dry * 0.03 - c.sick * 0.1 - (c.stab < 0.3 ? 0.02 : 0);
    c.g += (gTarget - c.g) * 0.12 + R.gauss() * 0.004;
    c.gdp *= 1 + c.g * DT;
    c.infl += (0.025 + (c.stab < 0.4 ? 0.05 : 0) + c.war * 0.06 + Math.max(0, c.g - c.gT) * 0.6 - c.infl) * 0.05 + R.gauss() * 0.002;
    c.infl = Math.max(-0.02, Math.min(3, c.infl));
    c.unemp += (0.055 - (c.g - c.gT) * 1.4 + c.war * 0.03 - c.unemp) * 0.05 + R.gauss() * 0.0015;
    c.unemp = Math.max(0.015, Math.min(0.45, c.unemp));
    // Zustimmung zur Regierung: Wirtschaft, Teuerung, Krieg, Unglück, Schonzeit nach der Wahl
    const fresh = ts.day - c.since < DPY ? 0.06 : 0;
    const aT = 0.47 + (c.g - c.gT) * 3 - Math.max(0, c.infl - 0.03) * 2 - (c.unemp - 0.06) * 1.5 - c.dmg * 0.2 - c.sick * 0.5 + fresh + (c.war ? (ts.day % (DPY * 2) < DPY ? 0.03 : -0.05) : 0);
    c.appr += (aT - c.appr) * 0.04 + R.gauss() * 0.012;
    c.appr = Math.max(0.05, Math.min(0.95, c.appr));
    const G = GOV[c.gov] || GOV.transition;
    c.stab += ((0.35 + G.demo * 0.35 + c.appr * 0.3 - c.war * 0.15 - c.dmg * 0.2) - c.stab) * 0.03 + R.gauss() * 0.006;
    c.stab = Math.max(0.02, Math.min(1, c.stab));
    c.dmg *= 0.96; c.dry *= 0.97; c.flood *= 0.9;
    if (c.sick > 0) { c.sick *= 0.93; if (c.sick < 0.002) c.sick = 0; }
    // Wahlen, Proteste, Putsche
    if (c.nextE >= 0 && ts.day >= c.nextE) election(ts, i);
    else if (G.demo < 0.5 && c.stab < 0.25 && R.chance(0.012)) upheaval(ts, i);
    else if (c.appr < 0.28 && R.chance(0.02) && C.pop > 4e6) news(ts, 'politik', L(`In ${cName(i)} gehen Hunderttausende auf die Straße. Sie fordern einen Wechsel an der Spitze.`, `Hundreds of thousands take to the streets in ${cName(i)}. They demand a change at the top.`), i, 1, capitalAt(i));
  }
  w.births += births; w.deaths += deaths;
  diplomacy(ts);
  // Bevölkerungsgruppen vierteljährlich: Altern, Glaube, Zuwanderung, Flucht, Armut (groups.js)
  if (ts.day % 6 === 0) groupsStep(ts, 0.25, (k, t, ci, imp) => news(ts, k, t, ci, imp, ci >= 0 ? capitalAt(ci) : null));
  disasters(ts, month);
  future(ts, year);
  calendar(ts);
  // Klima: Erwärmung, Meeresspiegel, CO₂ (langsamer, wenn die CO₂ Anlagen laufen)
  const green = (w.done.includes('co2') ? 0.45 : 0) + (w.done.includes('fusion') ? 0.35 : 0);
  w.temp += (0.026 - green * 0.022) * DT; w.co2 += (2.4 - green * 3.2) * DT; w.sea += 0.45 * DT;
  // Glaube der Welt (für die Kraft des Geistes) und Kraft
  let f = 0, p = 0; for (const c of ts.c) { f += c.faith * c.pop; p += c.pop; } w.faith = f / Math.max(1, p);
  ts.mana = Math.min(MANA_MAX, ts.mana + 1.6 + w.faith * 2.4);
  prayersStep(ts);
  if (ts.hero && ts.hero.alive !== false) heroStep(ts);
  // Schäden der Städte heilen langsam
  for (const k in ts.cdmg) { ts.cdmg[k] *= 0.97; if (ts.cdmg[k] < 0.01) delete ts.cdmg[k]; }
}

function election(ts, i) {
  const R = ts._rt.r, c = ts.c[i], C = TODAY.list[i], G = GOV[c.gov] || GOV.transition;
  ts.counts.elections++;
  // USA: Zwischenwahl für den Kongress alle zwei Jahre zwischen den Präsidentenwahlen (2026, 2030, ...)
  if (C.iso3 === 'USA' && c.gov === 'pres_rep' && (yearOf(ts.day) - 2026) % 4 === 0) {
    const keep = c.appr + R.gauss() * 0.06 > 0.5;
    c.nextE = ts.day + 2 * DPY;
    news(ts, 'politik', keep ? L('Zwischenwahl in den Vereinigten Staaten: Die Partei des Präsidenten behält die Mehrheit im Kongress.', 'US midterms: the president\'s party keeps its majority in Congress.') : L('Zwischenwahl in den Vereinigten Staaten: Die Partei des Präsidenten verliert die Mehrheit im Kongress. Regieren wird schwerer.', 'US midterms: the president\'s party loses its majority in Congress. Governing gets harder.'), i, 2, capitalAt(i));
    if (!keep) c.appr -= 0.03;
    return;
  }
  const free = G.demo >= 0.8;
  const keep = free ? c.appr + R.gauss() * 0.06 > 0.47 : R.chance(0.92);
  const title = L(C.headDe || 'Regierungschef', C.head || 'Head of government');
  const old = c.lead;
  if (!keep) {
    c.bloc = 1 - c.bloc;
    c.lead = personName(R, C).full;
    c.since = ts.day; c.appr = 0.56;
  } else if (R.chance(0.25)) { c.lead = personName(R, C).full; c.since = ts.day; }
  c.nextE = ts.day + Math.round((C.iso3 === 'USA' ? 2 : G.term || 4) * DPY);
  const big = C.pop > 3e7 || (ts.hero && ts.hero.ctry === i);
  if (!big && !R.chance(0.25)) return;
  const t = free
    ? (keep ? L(`Wahl in ${cName(i)}: Die Regierung bleibt im Amt. ${title} wird ${c.lead}.`, `Election in ${cName(i)}: the government stays in office. ${c.lead} becomes ${title.toLowerCase()}.`)
      : L(`Wahl in ${cName(i)}: Die Opposition gewinnt. ${c.lead} löst ${old} als ${title} ab.`, `Election in ${cName(i)}: the opposition wins. ${c.lead} replaces ${old} as ${title.toLowerCase()}.`))
    : L(`In ${cName(i)} wird gewählt, doch das Ergebnis stand vorher fest. ${c.lead} bleibt an der Macht.`, `${cName(i)} holds an election, but the result was decided in advance. ${c.lead} stays in power.`);
  news(ts, 'politik', t, i, big ? 2 : 1, capitalAt(i));
}

function upheaval(ts, i) {
  const R = ts._rt.r, c = ts.c[i], C = TODAY.list[i];
  const coup = c.gov === 'military' || R.chance(0.5);
  c.lead = personName(R, C).full; c.since = ts.day; c.appr = 0.5; c.stab = 0.45;
  if (coup) {
    c.gov = 'military'; c.nextE = -1;
    news(ts, 'politik', L(`Putsch in ${cName(i)}: Das Militär übernimmt die Macht. ${c.lead} führt jetzt eine Junta.`, `Coup in ${cName(i)}: the military seizes power. ${c.lead} now leads a junta.`), i, 2, capitalAt(i));
  } else {
    c.gov = 'transition'; c.nextE = ts.day + R.int(DPY, DPY * 2);
    if (R.chance(0.3) && !ts.wars.some(W => W.a === i && W.b < 0)) { ts.wars.push({ a: i, b: -1, since: ts.day, cas: 0, name: { de: `Bürgerkrieg in ${TODAY.list[i].de}`, en: `Civil war in ${TODAY.list[i].en}` } }); c.war++; }
    news(ts, 'politik', L(`Revolution in ${cName(i)}: Die alte Führung flieht. Eine Übergangsregierung verspricht freie Wahlen.`, `Revolution in ${cName(i)}: the old leadership flees. A transitional government promises free elections.`), i, 2, capitalAt(i));
  }
}

// Beziehungen, Zwischenfälle, Kriege und Frieden
function diplomacy(ts) {
  const R = ts._rt.r, n = ts.c.length;
  // Beziehungen streben langsam zur Grundbeziehung zurück (Abweichungen verblassen)
  if (ts.day % 6 === 0) for (const k in ts.rel) { ts.rel[k] *= 0.995; if (Math.abs(ts.rel[k]) < 0.5) delete ts.rel[k]; }
  // Zwischenfälle zwischen Nachbarn und Rivalen
  for (let k = 0; k < 2; k++) {
    const i = R.int(0, n - 1), C = TODAY.list[i];
    if (!C.pop || C.pop < 1e6) continue;
    const j = neighborOf(i, R);
    if (j < 0) continue;
    const v = relation(ts, i, j), dv = R.gauss() * 6 - (v < -40 ? 1.5 : 0);
    ts.rel[key(i, j)] = (ts.rel[key(i, j)] || 0) + dv;
    if (v + dv < -76 && !ts.wars.some(W => (W.a === i && W.b === j) || (W.a === j && W.b === i)) && R.chance(0.04)) startWar(ts, i, j);
  }
  // laufende Kriege: Opfer, Erschöpfung, Waffenstillstand
  for (const W of [...ts.wars]) {
    const a = ts.c[W.a], b = W.b >= 0 ? ts.c[W.b] : null;
    const scale = Math.min(a.pop, b ? b.pop : a.pop * 0.3);
    W.cas += scale * 0.00002 * (0.5 + R.next());
    const age = Math.min(4, (ts.day - Math.max(0, W.since)) / DPY);
    const p = (b ? 0.0055 : 0.0018) * (1 + age / 3) + (b ? Math.max(0, relation(ts, W.a, W.b) + 60) * 0.00005 : 0) + (ts.w.peace > 0 ? 0.02 : 0);
    if (R.chance(p)) endWar(ts, W);
  }
  if (ts.w.peace > 0) ts.w.peace--;
}
function neighborOf(i, R) {
  const C = TODAY.list[i], near = [];
  for (let j = 0; j < TODAY.list.length; j++) {
    if (j === i) continue;
    const D = TODAY.list[j];
    if (!D.pop) continue;
    const d = Math.hypot(((D.tx - C.tx + 3072) % 2048) - 1024, D.ty - C.ty);
    if (d < 90) near.push(j);
  }
  for (const [a, b] of TODAY.rels) { if (a === C.iso3) near.push(idxOf(b)); else if (b === C.iso3) near.push(idxOf(a)); }
  return near.length ? R.pick(near) : -1;
}
function startWar(ts, i, j) {
  const W = { a: i, b: j, since: ts.day, cas: 0, name: { de: `Krieg zwischen ${TODAY.list[i].de} und ${TODAY.list[j].de}`, en: `War between ${TODAY.list[i].en} and ${TODAY.list[j].en}` } };
  ts.wars.push(W); ts.c[i].war++; ts.c[j].war++;
  news(ts, 'krieg', L(`Krieg: ${cName(i)} greift ${cName(j)} an. Die Welt hält den Atem an.`, `War: ${cName(i)} attacks ${cName(j)}. The world holds its breath.`), i, 3, capitalAt(j));
}
function endWar(ts, W) {
  ts.wars.splice(ts.wars.indexOf(W), 1);
  ts.c[W.a].war = Math.max(0, ts.c[W.a].war - 1);
  if (W.b >= 0) { ts.c[W.b].war = Math.max(0, ts.c[W.b].war - 1); ts.rel[key(W.a, W.b)] = (ts.rel[key(W.a, W.b)] || 0) + 25; }
  const nm = L(W.name.de, W.name.en);
  news(ts, 'frieden', W.b >= 0
    ? L(`Waffenstillstand: ${nm} endet nach ${yearsText(ts.day - W.since)}. Unterhändler unterschreiben in einer neutralen Hauptstadt.`, `Ceasefire: the ${nm.charAt(0).toLowerCase() + nm.slice(1)} ends after ${yearsText(ts.day - W.since)}. Negotiators sign in a neutral capital.`)
    : L(`In ${cName(W.a)} schweigen die Waffen. Die Bürgerkriegsparteien einigen sich auf eine Teilung der Macht.`, `The guns fall silent in ${cName(W.a)}. The civil war factions agree to share power.`), W.a, 3, capitalAt(W.a));
}
const yearsText = d => { const y = d / DPY; return y < 1 ? L('wenigen Monaten', 'a few months') : y < 1.5 ? L('einem Jahr', 'one year') : L(`${Math.round(y)} Jahren`, `${Math.round(y)} years`); };

// Hauptstadtfeld eines Landes (für die Kamera und Ortsangaben)
export function capitalAt(i) {
  const C = TODAY.list[i], ci = TODAY.capitalOf.get(C.id);
  if (ci != null) return [TODAY.cities.tx[ci], TODAY.cities.ty[ci]];
  return [C.tx, C.ty];
}

// Orte eines Landes nach Einwohnern (für Katastrophen und Gebete)
function bigCities(ci, n = 40) {
  const C = TODAY.cities, out = [];
  for (let i = 0; i < C.n && out.length < n; i++) if (C.ctry[i] === ci) out.push(i);
  return out;
}
const cityCache = new Map();
function citiesOf(ctryId) { let a = cityCache.get(ctryId); if (!a) { a = bigCities(ctryId); cityCache.set(ctryId, a); } return a; }
export function cityPop(ts, i) {
  const C = TODAY.cities, k = C.ctry[i], c0 = TODAY.byId.get(k);
  const ci = c0 ? TODAY.list.indexOf(c0) : -1;
  const f = ci >= 0 && c0.pop ? ts.c[ci].pop / c0.pop : 1;
  return Math.round(C.pop[i] * f * (1 - (ts.cdmg[i] || 0) * 0.05));
}
export function metroPop(ts, i) {
  const C = TODAY.cities; if (!C.metro[i]) return 0;
  const c0 = TODAY.byId.get(C.ctry[i]), ci = c0 ? TODAY.list.indexOf(c0) : -1;
  return Math.round(C.metro[i] * (ci >= 0 && c0.pop ? ts.c[ci].pop / c0.pop : 1));
}

// Naturereignisse an echten Gefahrenzonen
function disasters(ts, month) {
  const R = ts._rt.r;
  const hazard = (table, isStorm) => {
    const items = [];
    for (const [iso, v] of Object.entries(table)) {
      const i = idxOf(iso); if (i < 0) continue;
      const wgt = isStorm ? (v[1].includes(month) ? v[0] : 0) : v;
      if (wgt) items.push([i, wgt]);
    }
    return items.length ? R.weighted(items, x => x[1])[0] : -1;
  };
  const wf = 1 + Math.max(0, ts.w.temp - 1.5) * 0.6; // wärmere Welt: mehr Stürme, Fluten, Dürren
  if (R.chance(0.11)) { const i = hazard(QUAKE); if (i >= 0) quake(ts, i, Math.min(9.1, 6.2 - Math.log10(Math.max(1e-4, R.next())) * 0.85)); }
  if (R.chance(0.16 * wf)) { const i = hazard(STORM, true); if (i >= 0) storm(ts, i); }
  if (R.chance(0.1 * wf)) { const i = hazard(FLOOD); if (i >= 0) flood(ts, i); }
  if (R.chance(0.03 * wf)) { const i = hazard(DRY); if (i >= 0 && ts.c[i].dry < 0.3) { ts.c[i].dry = 0.7 + R.next() * 0.3; news(ts, 'natur', L(`Dürre in ${cName(i)}: Seit Monaten kein Regen. Brunnen versiegen, das Vieh stirbt.`, `Drought in ${cName(i)}: no rain for months. Wells run dry, cattle die.`), i, 2, capitalAt(i)); pray(ts, i, 'regen'); } }
  if (R.chance(0.004)) { const i = R.int(0, ts.c.length - 1); if (TODAY.list[i].pop > 2e7) epidemic(ts, i, 0.02 + R.next() * 0.04, false); }
}
export function quake(ts, i, mag, at) {
  const R = ts._rt.r, list = citiesOf(TODAY.list[i].id);
  const ci = at != null ? at : list.length ? R.weighted(list.slice(0, 20), k => Math.sqrt(TODAY.cities.pop[k])) : -1;
  if (ci == null || ci < 0) return;
  ts.counts.quakes++;
  const dev = Math.min(1, (TODAY.list[i].gdppc || 3000) / 40000);
  const dead = Math.round(Math.pow(10, (mag - 6) * 1.1) * Math.sqrt(cityPop(ts, ci)) * 0.02 * (1.6 - dev * 1.3) * (0.4 + R.next()));
  ts.c[i].dmg = Math.min(1, ts.c[i].dmg + mag / 30);
  ts.c[i].pop = Math.max(0, ts.c[i].pop - dead);
  ts.cdmg[ci] = Math.min(1, (ts.cdmg[ci] || 0) + (mag - 5.5) / 3);
  ts.c[i].faith = Math.min(1, ts.c[i].faith + 0.01);
  const nm = cityName(ci, LANG);
  const at2 = [TODAY.cities.tx[ci], TODAY.cities.ty[ci]];
  if (mag >= 6.8 || dead > 20) news(ts, 'natur', dead > 0
    ? L(`Erdbeben der Stärke ${mag.toFixed(1)} bei ${nm} (${cName(i)}). ${dead.toLocaleString('de-DE')} Menschen sterben, Tausende verlieren ihr Zuhause.`, `A magnitude ${mag.toFixed(1)} earthquake strikes near ${nm} (${cName(i)}). ${dead.toLocaleString('en-GB')} people die, thousands lose their homes.`)
    : L(`Erdbeben der Stärke ${mag.toFixed(1)} bei ${nm} (${cName(i)}). Die Häuser halten, die Menschen kommen mit dem Schrecken davon.`, `A magnitude ${mag.toFixed(1)} earthquake near ${nm} (${cName(i)}). The buildings hold, people escape with a fright.`), i, mag >= 7.4 ? 3 : 2, at2);
  ts._rt.fx.push({ type: 'quake', x: at2[0], y: at2[1], mag });
  if (dead > 500) { pray(ts, i, 'heilung', ci); aid(ts, i); }
  return dead;
}
function storm(ts, i) {
  const R = ts._rt.r, list = citiesOf(TODAY.list[i].id).filter(k => isCoastal(k));
  const ci = list.length ? R.pick(list.slice(0, 15)) : null;
  if (ci == null) return;
  ts.counts.storms++;
  const cat = Math.min(5, 1 + Math.floor(-Math.log(Math.max(1e-4, R.next())) * 1.15)), nm = cityName(ci, LANG);
  const dev = Math.min(1, (TODAY.list[i].gdppc || 3000) / 40000);
  const dead = Math.round(cat * cat * (0.5 + R.next()) * (1.8 - dev * 1.6) * 6);
  ts.c[i].dmg = Math.min(1, ts.c[i].dmg + cat * 0.04);
  ts.cdmg[ci] = Math.min(1, (ts.cdmg[ci] || 0) + cat * 0.12);
  const word = ['PHL', 'JPN', 'CHN', 'VNM', 'TWN', 'KOR'].includes(TODAY.list[i].iso3) ? L('Taifun', 'Typhoon') : ['IND', 'BGD', 'MMR', 'MDG', 'MOZ', 'AUS', 'FJI', 'OMN'].includes(TODAY.list[i].iso3) ? L('Zyklon', 'Cyclone') : L('Hurrikan', 'Hurricane');
  if (cat >= 3) news(ts, 'natur', L(`${word} der Kategorie ${cat} trifft ${nm} (${cName(i)}). ${dead > 0 ? dead + ' Tote, ' : ''}Dächer fliegen, Straßen stehen unter Wasser.`, `A category ${cat} ${word.toLowerCase()} hits ${nm} (${cName(i)}). ${dead > 0 ? dead + ' dead, ' : ''}roofs fly, streets are flooded.`), i, cat >= 4 ? 3 : 2, [TODAY.cities.tx[ci], TODAY.cities.ty[ci]]);
  ts._rt.fx.push({ type: 'storm', x: TODAY.cities.tx[ci], y: TODAY.cities.ty[ci], cat });
}
function flood(ts, i) {
  const R = ts._rt.r, list = citiesOf(TODAY.list[i].id), ci = list.length ? R.pick(list.slice(0, 25)) : null;
  if (ci == null) return;
  ts.c[i].flood = 1; ts.c[i].dmg = Math.min(1, ts.c[i].dmg + 0.08);
  ts.cdmg[ci] = Math.min(1, (ts.cdmg[ci] || 0) + 0.25);
  if (R.chance(0.5)) news(ts, 'natur', L(`Hochwasser in ${cityName(ci, LANG)} (${cName(i)}): Flüsse treten über die Ufer, ganze Viertel werden evakuiert.`, `Floods in ${cityName(ci, LANG)} (${cName(i)}): rivers burst their banks, whole districts are evacuated.`), i, 2, [TODAY.cities.tx[ci], TODAY.cities.ty[ci]]);
  pray(ts, i, 'sonne', ci);
}
export function epidemic(ts, i, share, byGod) {
  const c = ts.c[i];
  c.sick = Math.max(c.sick, share);
  news(ts, 'seuche', L(`In ${cName(i)} breitet sich ein neues Virus aus. Krankenhäuser füllen sich, Schulen schließen.`, `A new virus spreads in ${cName(i)}. Hospitals fill up, schools close.`), i, 2, capitalAt(i));
  // Ansteckung über die großen Flughäfen: Nachbarn und Handelspartner
  const R = ts._rt.r;
  for (let k = 0; k < 6; k++) { const j = neighborOf(i, R); if (j >= 0) ts.c[j].sick = Math.max(ts.c[j].sick, share * 0.4); }
  pray(ts, i, 'heilung');
  if (byGod) ts.c[i].faith = Math.min(1, ts.c[i].faith + 0.03);
}
function aid(ts, i) {
  const R = ts._rt.r, helpers = [];
  for (let j = 0; j < ts.c.length; j++) if (j !== i && relation(ts, i, j) > 30 && TODAY.list[j].gdppc > 20000) helpers.push(j);
  if (!helpers.length) return;
  const j = R.pick(helpers);
  ts.rel[key(i, j)] = (ts.rel[key(i, j)] || 0) + 8;
  news(ts, 'frieden', L(`${cName(j)} schickt Rettungsteams und Hilfsgüter nach ${cName(i)}.`, `${cName(j)} sends rescue teams and aid to ${cName(i)}.`), i, 1);
}
const isCoastal = k => { const C = TODAY.cities, x = C.tx[k], y = C.ty[k], ctry = TODAY.ctry, W = 2048; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = y + dy; if (yy < 0 || yy >= 1024) continue; if (!ctry[yy * W + ((x + dx + W) % W)]) return true; } return false; };

function future(ts, year) {
  const R = ts._rt.r, w = ts.w;
  const peace = 1 - Math.min(0.6, ts.wars.length * 0.05);
  for (const F of FUTURE) {
    if (w.done.includes(F.id) || year < F.y || (F.needs && !w.done.includes(F.needs))) continue;
    if (R.chance(F.p * DT * peace * (1 + (w.boost || 0)))) {
      w.done.push(F.id); w.tech++;
      news(ts, 'wissen', L(F.de, F.en), -1, 3);
      if (F.id === 'alter') for (const c of ts.c) c.d *= 0.85;
      if (F.id === 'malaria') for (let i = 0; i < ts.c.length; i++) if (TODAY.list[i].cont === 'Africa') ts.c[i].d *= 0.9;
      break;
    }
  }
  if (w.boost) w.boost = Math.max(0, w.boost - DT);
}
function calendar(ts) {
  for (let k = ts.w.cal; k < CALENDAR.length; k++) {
    const E = CALENDAR[k], d = dayOfDate(E.at);
    if (d > ts.day) break;
    ts.w.cal = k + 1;
    if (d >= 0) news(ts, 'welt', L(E.de, E.en), idxOf(E.iso), 2, idxOf(E.iso) >= 0 ? capitalAt(idxOf(E.iso)) : null);
  }
}

// ---------- Gebete ----------
const PRAYER = {
  regen: [L('Bitte schick uns Regen. Die Felder sind Staub.', 'Please send us rain. The fields are dust.'), 'regen'],
  sonne: [L('Lass die Sonne wiederkommen, das Wasser steht in unseren Häusern.', 'Let the sun come back, the water stands in our houses.'), 'sonne'],
  heilung: [L('Heile unsere Kranken.', 'Heal our sick.'), 'heilung'],
  frieden: [L('Lass den Krieg enden.', 'Let the war end.'), 'regenbogen'],
  segen: [L('Gib uns eine gute Ernte, die Preise fressen uns auf.', 'Give us a good harvest, prices are eating us alive.'), 'segen'],
};
export function pray(ts, i, kind, city) {
  if (ts.prayers.some(p => p.c === i && p.kind === kind)) return;
  const P = PRAYER[kind]; if (!P) return;
  const list = citiesOf(TODAY.list[i].id);
  const ci = city != null ? city : list[0];
  ts.prayers.push({ id: ts.nextPrayer++, c: i, city: ci ?? -1, kind, power: P[1], text: P[0], d: ts.day, until: ts.day + DPY * 2 });
  if (ts.prayers.length > 8) ts.prayers.shift();
}
function prayersStep(ts) {
  const R = ts._rt.r;
  ts.prayers = ts.prayers.filter(p => p.until > ts.day);
  for (const W of ts.wars) if (R.chance(0.01)) pray(ts, W.b >= 0 && R.chance(0.5) ? W.b : W.a, 'frieden');
  if (R.chance(0.01)) { const poor = ts.c.map((c, i) => [i, c.infl]).filter(x => x[1] > 0.15); if (poor.length) pray(ts, R.pick(poor)[0], 'segen'); }
}
// Ein Gebet gilt als erhört, wenn die passende Kraft in seinem Land wirkt
export function answerPrayers(ts, power, ci) {
  const hit = ts.prayers.filter(p => p.power === power && (ci == null || p.c === ci));
  for (const p of hit) {
    ts.prayers.splice(ts.prayers.indexOf(p), 1);
    ts.counts.answered++;
    ts.c[p.c].faith = Math.min(1, ts.c[p.c].faith + 0.04);
    news(ts, 'gott', L(`In ${cName(p.c)} danken Menschen in Kirchen, Moscheen und Tempeln. Sie sagen, ihr Gebet sei erhört worden.`, `In ${cName(p.c)} people give thanks in churches, mosques and temples. They say their prayer was answered.`), p.c, 2);
  }
  return hit.length;
}
