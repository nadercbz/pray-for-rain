// Erde heute: einzelne Menschen. Namen nach Land (names.json), Berufe nach Wohlstand, ein festes Leben für jeden
// angeklickten Menschen aus dem Seed, und dein Mensch mit Familie, der sein Leben weiterlebt (heroStep).
import { Rng } from '../sim/rng.js';
import { L, LANG } from '../i18n.js';
import { TODAY, cityName } from './data.js';
import { pickGroup } from './groups.js';

const DPY = 24, DT = 1 / DPY;
const FAMILY_FIRST = new Set(['zh', 'ja', 'ko', 'vi', 'hu']);
const FALLBACK = { f: ['Anna', 'Maria', 'Sara', 'Lea', 'Mia', 'Nora', 'Lina', 'Amira', 'Yara', 'Emma'], m: ['Omar', 'Lukas', 'Jonas', 'Adam', 'Samir', 'David', 'Elias', 'Noah', 'Yusuf', 'Leo'], l: ['Weber', 'Klein', 'Hoffmann', 'Schmidt', 'Ait', 'Novak', 'Rossi', 'Garcia', 'Kaya', 'Silva'] };

function group(C) {
  const N = (TODAY.names && TODAY.names.groups) || TODAY.names || {}, k = C && C.names;
  const g = (k && N[k]) || N[(C && C.lang) || ''] || N.en_us || N.en || null;
  if (!g) return { ...FALLBACK, key: '' };
  const f = g.f || g.female || g.women || g.first_f || g.firstF || FALLBACK.f;
  const m = g.m || g.male || g.men || g.first_m || g.firstM || FALLBACK.m;
  const l = g.l || g.last || g.surnames || g.family || g.surname || FALLBACK.l;
  return { f, m, l, key: k || '' };
}
export function personName(R, C, sex) {
  const G = group(C), s = sex || (R.chance(0.5) ? 'f' : 'm');
  const first = R.pick(s === 'f' ? G.f : G.m), last = R.pick(G.l);
  return { first, last, sex: s, full: FAMILY_FIRST.has(G.key.split('_')[0]) ? `${last} ${first}` : `${first} ${last}` };
}

// Berufe: [de weiblich, de männlich, en, Gewicht arm, Gewicht reich]
const JOBS = [
  ['Pflegekraft', 'Pfleger', 'nurse', 2, 4], ['Lehrerin', 'Lehrer', 'teacher', 3, 4], ['Softwareentwicklerin', 'Softwareentwickler', 'software developer', 0.3, 4],
  ['Verkäuferin', 'Verkäufer', 'shop assistant', 4, 4], ['Busfahrerin', 'Busfahrer', 'bus driver', 2, 2], ['Bäckerin', 'Bäcker', 'baker', 2, 1.5],
  ['Ärztin', 'Arzt', 'doctor', 0.5, 2], ['Ingenieurin', 'Ingenieur', 'engineer', 0.8, 3], ['Studentin', 'Student', 'student', 2, 4],
  ['Bäuerin', 'Bauer', 'farmer', 14, 1], ['Bauarbeiterin', 'Bauarbeiter', 'construction worker', 5, 3], ['Köchin', 'Koch', 'cook', 3, 3],
  ['Polizistin', 'Polizist', 'police officer', 1, 1.5], ['Künstlerin', 'Künstler', 'artist', 0.5, 1], ['Musikerin', 'Musiker', 'musician', 0.6, 0.8],
  ['Lieferfahrerin', 'Lieferfahrer', 'delivery driver', 2, 3], ['Friseurin', 'Friseur', 'hairdresser', 2, 2], ['Buchhalterin', 'Buchhalter', 'accountant', 0.6, 3],
  ['Journalistin', 'Journalist', 'journalist', 0.3, 1], ['Architektin', 'Architekt', 'architect', 0.2, 1], ['Fabrikarbeiterin', 'Fabrikarbeiter', 'factory worker', 6, 3],
  ['Mechanikerin', 'Mechaniker', 'mechanic', 2, 2], ['Kassiererin', 'Kassierer', 'cashier', 2, 3], ['Sozialarbeiterin', 'Sozialarbeiter', 'social worker', 0.4, 1.5],
  ['Händlerin auf dem Markt', 'Händler auf dem Markt', 'market trader', 10, 0.5], ['Taxifahrerin', 'Taxifahrer', 'taxi driver', 3, 1.5], ['Fotografin', 'Fotograf', 'photographer', 0.3, 0.8],
  ['Unternehmerin', 'Unternehmer', 'entrepreneur', 1, 2], ['Fischerin', 'Fischer', 'fisher', 4, 0.4], ['Näherin', 'Näher', 'garment worker', 6, 0.5],
  ['Wissenschaftlerin', 'Wissenschaftler', 'scientist', 0.2, 1], ['Anwältin', 'Anwalt', 'lawyer', 0.3, 1.2], ['Pilotin', 'Pilot', 'pilot', 0.1, 0.4],
  ['Gärtnerin', 'Gärtner', 'gardener', 1, 1], ['Kellnerin', 'Kellner', 'waiter', 3, 3], ['Erzieherin', 'Erzieher', 'nursery teacher', 1, 2],
];
// big: Großstadt (Bauern und Fischer selten, Märkte nur in ärmeren Ländern)
export function pickJob(R, C, sex, age = 35, big = true) {
  const rich = Math.max(0, Math.min(1, (Math.log10(Math.max(500, (C && C.gdppc) || 3000)) - 3.2) / 1.5));
  const rural = new Set(['farmer', 'fisher']);
  const J = R.weighted(JOBS, j => (j[2] === 'student' && age > 29 ? 0 : 1) * (big && rural.has(j[2]) ? 0.08 : 1) * (big && j[2] === 'market trader' ? 1 - rich : 1) * (j[3] * (1 - rich) + j[4] * rich));
  return { de: sex === 'f' ? J[0] : J[1], en: J[2] };
}
export const jobText = j => (j ? L(j.de, j.en) : '');

// Alter nach Land: junge Länder (viele Geburten) haben viele Junge
function pickAge(R, C) {
  const young = Math.min(1, Math.max(0, ((C && C.birth) || 12) - 8) / 30);
  for (let k = 0; k < 8; k++) { const a = Math.floor(R.next() ** (1 + young * 1.2) * 90); if (R.next() < 1.05 - a / 110) return a; }
  return 35;
}

// Ein Mensch in einer Stadt: fest aus Stadt und Nummer (gleicher Klick, gleicher Mensch)
export function citizen(ts, city, n) {
  const C = TODAY.cities, ctry = TODAY.byId.get(C.ctry[city]);
  const R = new Rng(((ts.seed ^ Math.imul(city + 1, 2654435761)) + n * 40503) >>> 0);
  // Gruppe: Volksgruppe oder Herkunftsland (bei Zugewanderten), danach Name und Glaube (groups.js)
  const ci = ctry ? TODAY.list.indexOf(ctry) : -1, grp = ci >= 0 ? pickGroup(ts, ci, R) : null;
  const NG = grp ? { names: grp.names, lang: ctry.lang } : ctry;
  const nm = personName(R, NG);
  let age = pickAge(R, ctry);
  if (age < 6) age = 6 + R.int(0, 4);
  const job = age < 18 ? { de: age < 6 ? 'Kind' : 'Schulkind', en: age < 6 ? 'child' : 'school child' } : age >= 67 ? { de: nm.sex === 'f' ? 'Rentnerin' : 'Rentner', en: 'retired' } : pickJob(R, ctry, nm.sex, age, C.pop[city] > 80000);
  const kids = age > 24 ? R.int(0, Math.round(((ctry && ctry.birth) || 12) / 9)) : 0;
  const partner = age > 22 && R.chance(0.6) ? personName(R, R.chance(0.8) ? NG : ctry, nm.sex === 'f' ? (R.chance(0.94) ? 'm' : 'f') : (R.chance(0.94) ? 'f' : 'm')) : null;
  const born = 2026 - age;
  const S = grp && grp.origin != null ? TODAY.list[grp.origin] : null, sc = S ? TODAY.capitalOf.get(S.id) : null;
  const from = S ? `${sc != null ? cityName(sc, LANG) + ', ' : ''}${L(S.de, S.en)}` : R.chance(0.72) ? cityName(city, LANG) : L('einem Dorf auf dem Land', 'a village in the countryside');
  return { id: `${city}:${n}`, name: nm.full, first: nm.first, sex: nm.sex, born, job, kids, partner: partner && partner.first, from, city, ctry: ci, mood: R.next(), faith: R.next(), eth: grp ? grp.eth : null, origin: grp ? grp.origin : null, rel: grp ? grp.rel : null };
}

// Dein Mensch: aus vier Menschen der Heimatstadt gewählt (pick), mit Familie und Lebenslauf
export function makePerson(ts, city, pick, hero) {
  const p = citizen(ts, city, 1000 + pick);
  const C = TODAY.cities, ctry = TODAY.byId.get(C.ctry[city]);
  const age = 19 + Math.floor(new Rng((ts.seed >>> 0) + pick * 131 + city).next() ** 1.3 * 38);
  p.born = 2026 - age;
  p.job = pickJob(new Rng((ts.seed >>> 0) + pick * 77 + city), ctry, p.sex, age, C.pop[city] > 80000);
  return { ...p, nKids: p.kids, hero: !!hero, age, alive: true, gen: 1, kin: [], log: [{ d: 0, t: L(`${p.name}, ${age}, ${jobText(p.job)} in ${cityName(city, LANG)}. Ein ganz normales Leben in einer Welt, die sich schnell dreht.`, `${p.name}, ${age}, ${jobText(p.job)} in ${cityName(city, LANG)}. A perfectly ordinary life in a world that spins fast.`) }], partner: p.partner ? { name: p.partner, since: -DPY * 3 } : null, kids: [], ctry: p.ctry };
}

// Ein Spieltag im Leben deines Menschen (rund zwei Wochen)
export function heroStep(ts) {
  const h = ts.hero, R = ts._rt.r, C = TODAY.list[h.ctry] || {}, c = ts.c[h.ctry] || {};
  h.age += DT;
  const log = (de, en, big) => { h.log.push({ d: ts.day, t: L(de, en) }); if (h.log.length > 400) h.log.splice(0, h.log.length - 400); if (big) ts._rt.fx.push({ type: 'heroSay', text: L(de, en) }); };
  const city = cityName(h.city, LANG);
  // Liebe, Hochzeit, Kinder
  if (!h.partner && h.age > 18 && h.age < 60 && R.chance(0.022)) {
    const pn = personName(R, C, h.sex === 'f' ? (R.chance(0.93) ? 'm' : 'f') : (R.chance(0.93) ? 'f' : 'm'));
    h.partner = { name: pn.first, since: ts.day };
    log(`${h.first} lernt ${pn.first} kennen. Erst beim Warten auf die Bahn, dann jeden Abend.`, `${h.first} meets ${pn.first}. First while waiting for the train, then every evening.`, true);
  } else if (h.partner && !h.partner.wed && ts.day - h.partner.since > DPY && R.chance(0.02)) {
    h.partner.wed = ts.day;
    log(`${h.first} und ${h.partner.name} heiraten in ${city}. Die ganze Familie tanzt bis spät.`, `${h.first} and ${h.partner.name} get married in ${city}. The whole family dances until late.`, true);
  } else if (h.partner && h.age < 44 && h.kids.length < 4 && R.chance(0.008 * ((C.birth || 10) / 10))) {
    const kn = personName(R, C);
    h.kids.push({ name: kn.first, sex: kn.sex, born: yearNow(ts) });
    log(`${h.first} wird ${h.kids.length === 1 ? (h.sex === 'f' ? 'Mutter' : 'Vater') : 'wieder ' + (h.sex === 'f' ? 'Mutter' : 'Vater')}: ${kn.first} kommt zur Welt.`, `${h.first} becomes a ${h.kids.length === 1 ? '' : 'parent again'}${h.kids.length === 1 ? 'parent' : ''}: ${kn.first} is born.`, true);
  } else if (h.partner && h.partner.wed && R.chance(0.0012)) {
    log(`${h.first} und ${h.partner.name} trennen sich nach langen Streits.`, `${h.first} and ${h.partner.name} separate after long arguments.`, true);
    h.partner = null;
  }
  // Arbeit
  if (h.age < 66 && R.chance(0.006 + c.unemp * 0.02)) {
    const nj = pickJob(R, C, h.sex, h.age);
    log(`${h.first} wechselt die Arbeit und ist jetzt ${jobText(nj)}.`, `${h.first} changes jobs and is now a ${jobText(nj)}.`);
    h.job = nj;
  }
  if (h.age >= 66 && !h.retired) { h.retired = true; log(`${h.first} geht in Rente. Zum Abschied gibt es Kuchen und eine Rede, die zu lang ist.`, `${h.first} retires. There is cake and a farewell speech that runs too long.`, true); }
  // die Welt wirkt hinein
  if (c.war && R.chance(0.02)) log(`${h.first} liest jeden Morgen die Nachrichten vom Krieg und kann danach kaum essen.`, `${h.first} reads the war news every morning and can barely eat afterwards.`);
  if (c.infl > 0.08 && R.chance(0.02)) log(`Die Miete steigt wieder. ${h.first} rechnet abends am Küchentisch.`, `The rent goes up again. ${h.first} does sums at the kitchen table in the evening.`);
  if ((ts.cdmg[h.city] || 0) > 0.3 && R.chance(0.1)) log(`In ${city} wird aufgeräumt. ${h.first} hilft den Nachbarn, die Fenster zu vernageln.`, `${city} is cleaning up. ${h.first} helps the neighbours board up their windows.`);
  // Tod nach Alter und Lebenserwartung des Landes
  const life = (C.life || 72) + (ts.w.done.includes('alter') ? 8 : 0);
  const q = 0.0003 * Math.exp((h.age - life + 12) / 9.5) * DT * 24;
  if (R.chance(q)) heroDies(ts);
}
const yearNow = ts => 2026 + Math.floor(ts.day / DPY);
function heroDies(ts) {
  const h = ts.hero, R = ts._rt.r;
  h.log.push({ d: ts.day, t: L(`${h.first} stirbt mit ${Math.floor(h.age)} Jahren in ${cityName(h.city, LANG)}.`, `${h.first} dies aged ${Math.floor(h.age)} in ${cityName(h.city, LANG)}.`) });
  const heir = h.kids.find(k => yearNow(ts) - k.born >= 16);
  ts._rt.fx.push({ type: heir ? 'hero' : 'heroEnd', from: h.first, to: heir ? heir.name : '' });
  if (!heir) { h.alive = false; h.end = ts.day; return; }
  const C = TODAY.list[h.ctry] || {};
  const nh = { ...h, name: `${heir.name} ${h.name.split(' ').slice(-1)[0]}`, first: heir.name, sex: heir.sex, born: heir.born, age: yearNow(ts) - heir.born, job: pickJob(R, C, heir.sex, yearNow(ts) - heir.born), partner: null, kids: [], gen: h.gen + 1, retired: false };
  nh.kin = [...(h.kin || []), { name: h.name, born: h.born, died: yearNow(ts) }];
  nh.log = [...h.log, { d: ts.day, t: L(`Die Geschichte geht weiter mit ${heir.name}.`, `The story continues with ${heir.name}.`) }];
  ts.hero = nh;
}
