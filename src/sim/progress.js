// Fortschritt ohne Ende (seit 24.10.2026, PLAN_ENTWICKLUNG.md, Naders Auftrag "die Welt soll sich dauerhaft
// weiterentwickeln"). Ist alles Wissen einer Insel erforscht, forscht sie weiter: zuerst an 16 benannten
// Zukunftserfindungen, danach endlos an Fortschrittsstufen mit steigenden Kosten. Jede Stufe wirkt (Arbeit, Nahrung,
// Wissen, Gesundheit, Tragfähigkeit, Wohnraum, mehr Orte). I.prog zählt die Stufen (gespeichert), die Wirkung steht in
// rt.pe je Insel (beim Laden und nach jeder Stufe neu gerechnet). Dazu die Grenzen des Wachstums, die vorher fest waren:
// weltweite Tragfähigkeit (vorher 850 Menschen), Ortsgröße (vorher 520), Zahl der Orte (vorher 34), Wohnraum.
// Deterministisch, Zufall nur über rng(st).
import * as D from './data.js';
import { L } from '../i18n.js';
import { chron, fx, rng, bio } from './util.js';

// eff: work Arbeit, food Nahrung, know Wissen, health weniger Tote, cap Tragfähigkeit, home Wohnraum in modernen Häusern
export const FUTURE = [
  { n: L('Rechenmaschinen', 'Computers'), info: L('Maschinen rechnen schneller als jeder Gelehrte', 'Machines calculate faster than any scholar'), eff: { know: 0.15 } },
  { n: L('Das Netz', 'The Network'), info: L('Alle Orte sprechen in Echtzeit miteinander', 'Every town talks to every other in real time'), eff: { know: 0.1, work: 0.05 } },
  { n: L('Moderne Medizin', 'Modern Medicine'), info: L('Antibiotika und Operationen retten Millionen Leben', 'Antibiotics and surgery save countless lives'), eff: { health: 0.12, cap: 0.08 } },
  { n: L('Robotik', 'Robotics'), info: L('Maschinen übernehmen schwere Arbeit', 'Machines take over heavy labor'), eff: { work: 0.12 } },
  { n: L('Gentechnik', 'Genetics'), info: L('Pflanzen tragen mehr und widerstehen Dürre', 'Crops yield more and resist drought'), eff: { food: 0.15, health: 0.04 } },
  { n: L('Sonnenkraft', 'Solar Power'), info: L('Strom vom Dach, für jedes Haus', 'Power from the roof, for every house'), eff: { work: 0.08, cap: 0.05 } },
  { n: L('Wolkenkratzer', 'Skyscrapers'), info: L('Städte wachsen in die Höhe', 'Cities grow upward'), eff: { home: 0.3, cap: 0.15 } },
  { n: L('Vertikale Farmen', 'Vertical Farms'), info: L('Felder in Türmen, mitten in der Stadt', 'Fields in towers, in the middle of the city'), eff: { food: 0.2, cap: 0.12 } },
  { n: L('Denkende Maschinen', 'Thinking Machines'), info: L('Maschinen, die lernen und forschen', 'Machines that learn and research'), eff: { know: 0.2, work: 0.08 } },
  { n: L('Fusionskraft', 'Fusion Power'), info: L('Die Kraft der Sonne in einem Kraftwerk', 'The power of the sun inside a power plant'), eff: { work: 0.15, cap: 0.08 } },
  { n: L('Langes Leben', 'Longevity'), info: L('Hundertjährige tanzen noch auf den Festen', 'Centenarians still dance at the festivals'), eff: { health: 0.15 } },
  { n: L('Städte im Meer', 'Ocean Cities'), info: L('Schwimmende Viertel vor den Küsten', 'Floating quarters off the coasts'), eff: { cap: 0.15, home: 0.15, sets: 4 } },
  { n: L('Raumstation', 'Space Station'), info: L('Ein Haus über den Wolken', 'A house above the clouds'), eff: { know: 0.1 } },
  { n: L('Weltraumaufzug', 'Space Elevator'), info: L('Ein Seil bis zu den Sternen', 'A rope up to the stars'), eff: { work: 0.06, know: 0.08 } },
  { n: L('Mondstadt', 'Moon City'), info: L('Die ersten Kinder werden auf dem Mond geboren', 'The first children are born on the moon'), eff: { cap: 0.1, know: 0.06 } },
  { n: L('Schiffe zu den Sternen', 'Ships to the Stars'), info: L('Die Menschen brechen zu anderen Welten auf', 'People set out for other worlds'), eff: { know: 0.12, cap: 0.06 } },
];
// danach: Fortschrittsstufen mit Namen aus Fachgebieten (gleich viele Varianten in beiden Sprachen)
const FIELDS = L(
  ['Neue Werkstoffe', 'Bessere Speicher', 'Sauberes Wasser', 'Schnellere Bahnen', 'Heilende Zellen', 'Klügere Netze', 'Leichtere Bauten', 'Ertragreichere Saat', 'Leise Antriebe', 'Tiefere Forschung', 'Grünere Städte', 'Längere Jugend'],
  ['New Materials', 'Better Storage', 'Clean Water', 'Faster Railways', 'Healing Cells', 'Smarter Networks', 'Lighter Buildings', 'Richer Seeds', 'Silent Engines', 'Deeper Research', 'Greener Cities', 'Longer Youth'],
);
const GENERIC = { work: 0.025, food: 0.025, know: 0.025, health: 0.01, cap: 0.035, home: 0.03 };
const MAXE = { work: 1.5, food: 1.5, know: 2, health: 0.5, cap: 4, home: 2, sets: 14 };

// Kosten der Stufe n (die letzte Technik Raumfahrt kostet 7000). Mit 13 Prozent je Stufe stand der Fortschritt nach drei
// Jahrhunderten fast still (Messung 24.10.2026), mit 8 Prozent kommt in einer großen Welt alle paar Jahre eine Stufe
export const progCost = n => Math.round(8000 * Math.pow(1.08, n));
export function progName(n) {
  if (n < FUTURE.length) return FUTURE[n].n;
  const k = n - FUTURE.length;
  return `${FIELDS[k % FIELDS.length]} ${Math.floor(k / FIELDS.length) + 1}`;
}

// Wirkung der Stufen einer Insel (summiert, gedeckelt)
export function progEffect(I) {
  const e = { work: 0, food: 0, know: 0, health: 0, cap: 0, home: 0, sets: 0 };
  const n = I.prog | 0;
  for (let k = 0; k < Math.min(n, FUTURE.length); k++) for (const [key, v] of Object.entries(FUTURE[k].eff)) e[key] += v;
  const extra = Math.max(0, n - FUTURE.length);
  for (const [key, v] of Object.entries(GENERIC)) e[key] += v * extra;
  e.sets += Math.floor(extra / 4);
  for (const key of Object.keys(e)) e[key] = Math.min(MAXE[key], e[key]);
  return e;
}
const ZERO = { work: 0, food: 0, know: 0, health: 0, cap: 0, home: 0, sets: 0 };
export function pe(st, isleId) { const m = st._rt.pe; return (m && m.get(isleId)) || ZERO; }

// alles neu rechnen (beim Laden, nach einer Stufe): Wirkungen, Grenze der Orte, Wohnraum je Ort
export function refreshProgress(st) {
  const rt = st._rt;
  rt.pe = new Map(st.isles.map(I => [I.id, progEffect(I)]));
  let sets = 0, maxProg = 0;
  for (const I of st.isles) { sets = Math.max(sets, rt.pe.get(I.id).sets); maxProg = Math.max(maxProg, I.prog | 0); }
  st.prog = maxProg;
  const base = st.earth ? rt.maxSetBase || rt.maxSet : D.MAX_SETTLEMENTS;
  if (!rt.maxSetBase) rt.maxSetBase = base;
  rt.maxSet = base + (st.earth ? sets * 4 : Math.min(14, (st.era >= 7 ? 2 : 0) + sets + Math.floor(maxProg / 3)));
  rt.homeMul = new Map();
  for (const s of st.settlements) if (s.alive) rt.homeMul.set(s.id, 1 + pe(st, s.isle).home);
}

// Weltweite Tragfähigkeit nach Entwicklung (vorher fest 850): wächst mit der höchsten Epoche und dem Fortschritt, weich
// begrenzt durch das Rechenbudget (bei rund 3000 Menschen kostet ein Spieltag rund 20 ms). Einmal am Tag gerechnet.
export const SOFT_MAX = 3000;
export function worldCap(st) {
  const rt = st._rt;
  if (rt.capDay === st.day) return rt.cap;
  let era = 0, cap = 0, pop = 0;
  for (const s of st.settlements) if (s.alive && s.pop) { era = Math.max(era, s.era | 0); cap += pe(st, s.isle).cap * s.pop; pop += s.pop; }
  const dev = 1 + 0.18 * Math.max(0, era - 3) + (pop ? cap / pop : 0);
  rt.cap = Math.min(SOFT_MAX, 850 * dev);
  rt.capDay = st.day;
  return rt.cap;
}
// Bremse je Ort (vorher fest 520 Einwohner): Großstädte der späten Epochen werden wirklich groß
export const townCap = (st, s) => 520 * (1 + 0.22 * Math.max(0, (s.era | 0) - 3) + pe(st, s.isle).cap);

// Jeden Tag aus researchStep, wenn eine Insel alles Wissen hat: Punkte sammeln für die nächste Stufe
export function progressStep(st, I) {
  let cost = progCost(I.prog | 0);
  // Kontakt mit einer weiter entwickelten Insel macht es billiger (wie bei den Techniken)
  for (const o of Object.keys(I.contact || {})) { const J = st._rt.iById.get(+o); if (J && (J.prog | 0) > (I.prog | 0)) { cost *= 0.55; break; } }
  if (I.research.pts < cost) return;
  I.research.pts -= cost;
  const n = I.prog | 0;
  I.prog = n + 1;
  // Erfinder: neugierigster Gelehrter der Insel (wie in researchStep)
  const r = rng(st);
  let by = null, bs = -1;
  for (const p of st.people) {
    const ps = st._rt.sById.get(p.s);
    if (!ps || ps.isle !== I.id || (p.job !== 'gelehrter' && !p.genius)) continue;
    const sc = p.tr.neugier + (p.genius ? 0.5 : 0) + r.next() * 0.4;
    if (sc > bs) { bs = sc; by = p; }
  }
  const name = progName(n), F = FUTURE[n], s = by && st._rt.sById.get(by.s);
  if (by) { by.fame += 3; bio(by, st.day, L(`erfindet ${name}`, `invents ${name}`)); }
  const where = st.earth ? L(`bei den ${I.name}`, `among the ${I.name}`) : L(`auf ${I.name}`, `on ${I.name}`);
  const txt = F
    ? (by ? L(`${by.n} aus ${s ? s.name : I.name} gelingt der Durchbruch: ${name}. ${F.info}.`, `${by.n} of ${s ? s.name : I.name} achieves a breakthrough: ${name}. ${F.info}.`)
      : L(`Ein Durchbruch ${where}: ${name}. ${F.info}.`, `A breakthrough ${where}: ${name}. ${F.info}.`))
    : L(`Fortschritt ${where}: ${name}. Das Leben wird ein wenig leichter, die Städte wachsen weiter.`, `Progress ${where}: ${name}. Life becomes a little easier, and the cities keep growing.`);
  chron(st, 'wissen', txt, s ? s.id : -1, F ? 2 : 0, { prog: I.prog, isle: I.id });
  fx(st, { type: 'progress', isle: I.id, n: I.prog });
  refreshProgress(st);
}
