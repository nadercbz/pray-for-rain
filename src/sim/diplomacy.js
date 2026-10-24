// Diplomatie: Zwischen den Orten passiert ständig etwas. Grenzstreit, gestohlenes Vieh, verspottete Gesandte,
// Spione, entführte Bräute, Glaubensstreit und Handelsbetrug lassen Groll wachsen (a.grudge). Wird er zu groß,
// bricht ein Krieg aus, mit Ziel und Namen (Raubzug, Grenzkrieg, Glaubenskrieg, Rachekrieg, Eroberungskrieg,
// Seekrieg), und Verbündete schicken Krieger. Kriege enden in Verträgen: Waffenstillstand, Tribut, Grenzvertrag,
// Heiratsbund, Handelsvertrag, Nichtangriffspakt. Pakte haben Jahrestage mit Friedensfesten, werden erneuert, laufen
// aus oder werden gebrochen (Verrat). In Friedenszeiten gibt es Gesandte, Geschenke, Märkte und gemeinsame Feste.
// Ergänzt society.js (relationsStep, battle, endWar). Zufall nur über rng(st).
import * as D from './data.js';
import { clamp } from './rng.js';
import { chron, rng, knows, fx, isleOf, members, sameLand, bldOf } from './util.js';
import { leaderOf, label } from './society.js';
import { appetite, onWar } from './military.js';
import { stateHelpers } from './states.js';
import { L } from '../i18n.js';

const YEAR = D.DAYS_PER_YEAR;

// Kriegsziele: wie lange gekämpft wird und ob am Ende erobert werden darf
export const GOALS = {
  raid: { name: L('Raubzug', 'Raid'), battles: 2, conquer: false, loss: 0.5 },
  border: { name: L('Grenzkrieg', 'Border War'), battles: 4, conquer: false, loss: 0.7 },
  holy: { name: L('Glaubenskrieg', 'Holy War'), battles: 5, conquer: false, loss: 0.9 },
  revenge: { name: L('Rachekrieg', 'War of Revenge'), battles: 3, conquer: false, loss: 0.8 },
  conquest: { name: L('Eroberungskrieg', 'War of Conquest'), battles: 8, conquer: true, loss: 1 },
  sea: { name: L('Seekrieg', 'Naval War'), battles: 5, conquer: true, loss: 1 },
};

// Anlässe für Streit: Text und Name des Krieges, der daraus werden kann
const REASONS = {
  weide: { war: L('der Weidekrieg', 'the Pasture War'), t: (a, b) => L([`Hirten aus ${a.name} treiben ihr Vieh auf die Weiden von ${b.name}. Es gibt Verletzte.`, `In ${b.name} fehlen zwölf Schafe. Die Spuren führen nach ${a.name}.`], [`Herders from ${a.name} drive their cattle onto the pastures of ${b.name}. People are hurt.`, `Twelve sheep are missing in ${b.name}. The tracks lead to ${a.name}.`]) },
  fisch: { war: L('der Fischkrieg', 'the Fish War'), t: (a, b) => L([`Fischer aus ${a.name} und ${b.name} streiten um dieselbe Bucht. Ein Boot wird versenkt.`, `${a.name} spannt Netze quer über die Flussmündung. ${b.name} fängt nichts mehr.`], [`Fishers from ${a.name} and ${b.name} fight over the same bay. A boat is sunk.`, `${a.name} stretches nets across the river mouth. ${b.name} catches nothing anymore.`]) },
  ehre: { war: L('der Krieg um die Ehre', 'the War of Honor'), t: (a, b) => L([`Ein Gesandter aus ${b.name} wird in ${a.name} verspottet und mit leeren Händen heimgeschickt.`, `Beim Fest in ${a.name} beleidigt ein Sänger den Herrscher von ${b.name}. Man lacht laut.`], [`An envoy from ${b.name} is mocked in ${a.name} and sent home empty-handed.`, `At a feast in ${a.name}, a singer insults the ruler of ${b.name}. People laugh loudly.`]) },
  glaube: { war: L('der Glaubenskrieg', 'the Holy War'), t: (a, b) => L([`Priester aus ${a.name} nennen die Götter von ${b.name} falsch. In ${b.name} brennt ein Schrein.`, `In ${b.name} wird ein Prediger aus ${a.name} gesteinigt.`], [`Priests from ${a.name} call the gods of ${b.name} false. A shrine burns in ${b.name}.`, `A preacher from ${a.name} is stoned in ${b.name}.`]) },
  handel: { war: L('der Handelskrieg', 'the Trade War'), t: (a, b) => L([`Händler aus ${a.name} verkaufen in ${b.name} Sand als Salz. Der Betrug fliegt auf.`, `${a.name} verlangt plötzlich doppelten Zoll von den Wagen aus ${b.name}.`], [`Traders from ${a.name} sell sand as salt in ${b.name}. The fraud is discovered.`, `${a.name} suddenly demands double toll from the wagons of ${b.name}.`]) },
  braut: { war: L('der Krieg um die geraubte Braut', 'the War of the Stolen Bride'), t: (a, b) => L([`Eine Braut aus ${b.name} verschwindet in der Nacht vor der Hochzeit. Man sah sie zuletzt mit Männern aus ${a.name}.`], [`A bride from ${b.name} vanishes the night before her wedding. She was last seen with men from ${a.name}.`]) },
  spion: { war: L('der Schattenkrieg', 'the Shadow War'), t: (a, b) => L([`In ${b.name} wird ein Spion aus ${a.name} gefasst. Er hatte die Lagerhäuser gezählt.`, `Jemand aus ${a.name} hat in ${b.name} einen Brunnen vergiftet, sagen die Leute.`], [`A spy from ${a.name} is caught in ${b.name}. He had been counting the storehouses.`, `Someone from ${a.name} poisoned a well in ${b.name}, people say.`]) },
  raub: { war: L('der Rachekrieg', 'the War of Revenge'), t: (a, b) => L([`Krieger aus ${a.name} überfallen eine Karawane aus ${b.name}. Drei Menschen sterben.`], [`Warriors from ${a.name} ambush a caravan from ${b.name}. Three people die.`]) },
  krone: { war: L('der Krieg der zwei Kronen', 'the War of Two Crowns'), t: (a, b, st) => L([`${label(leaderOf(st, a))} erhebt Anspruch auf den Thron von ${b.name}. Die Blutlinien sind verflochten.`], [`${label(leaderOf(st, a))} lays claim to the throne of ${b.name}. The bloodlines are entwined.`]) },
};

// Gute Begegnungen in Friedenszeiten
const GOOD = (a, b, same) => same
  ? L([`${a.name} schickt ${b.name} Saatgut nach einer schlechten Ernte.`, `Gemeinsamer Markt von ${a.name} und ${b.name} am Kreuzweg. Man tauscht Töpfe, Lieder und Neuigkeiten.`, `Junge Leute aus ${a.name} und ${b.name} feiern zusammen das Sonnwendfeuer.`, `Gesandte aus ${b.name} bringen ${a.name} ein geschnitztes Boot als Geschenk.`, `Baumeister aus ${a.name} helfen ${b.name} beim Bau einer Brücke.`],
      [`${a.name} sends seed grain to ${b.name} after a poor harvest.`, `A joint market of ${a.name} and ${b.name} at the crossroads. Pots, songs and news change hands.`, `Young people from ${a.name} and ${b.name} celebrate the solstice fire together.`, `Envoys from ${b.name} bring ${a.name} a carved boat as a gift.`, `Builders from ${a.name} help ${b.name} build a bridge.`])
  : L([`Ein Schiff aus ${a.name} bringt ${b.name} Gewürze, Lieder und eine Karte der Sterne.`, `${a.name} und ${b.name} tauschen Gesandte. Man lernt ein paar Worte der anderen Sprache.`, `Gelehrte aus ${b.name} besuchen ${a.name} und bleiben einen Winter.`],
      [`A ship from ${a.name} brings ${b.name} spices, songs and a map of the stars.`, `${a.name} and ${b.name} exchange envoys. A few words of the other tongue are learned.`, `Scholars from ${b.name} visit ${a.name} and stay for a winter.`]);

// Welcher Anlass passt zu diesen beiden Orten?
function reasonFor(st, r, a, b, same, border, cd) {
  const opts = [];
  if (same && border > 0.2) opts.push('weide', 'weide', 'fisch');
  if (cd > 0.12 || Math.abs(a.cult.glaube - b.cult.glaube) > 0.25) opts.push('glaube', 'glaube');
  if ((st.trade || []).some(t => (t.a === a.id && t.b === b.id) || (t.a === b.id && t.b === a.id)) || a.era >= 2) opts.push('handel');
  if (a.era >= 2) opts.push('spion');
  if (a.cult.macht > 0.5) opts.push('raub', 'ehre');
  if (['koenigtum', 'diktatur'].includes(a.gov.type) && ['koenigtum', 'diktatur'].includes(b.gov.type)) opts.push('krone');
  opts.push('ehre', same ? 'weide' : 'fisch');
  if (r.chance(0.2)) opts.push('braut');
  // nicht zweimal hintereinander derselbe Anlass zwischen denselben Orten
  const last = b.lastReason && b.lastReason[a.id];
  const pool = opts.filter(o => o !== last);
  return r.pick(pool.length ? pool : opts);
}

// Krieg erklären: Ziel, Name, Verbündete
export function declareWar(st, agg, def, reason) {
  const r = rng(st);
  const same = sameLand(st, agg, def);
  const ratio = agg.pop / Math.max(1, def.pop);
  const grudge = (agg.grudge && agg.grudge[def.id]) || 0;
  let goal;
  if (!same) goal = ratio > 1.4 && agg.cult.macht > 0.4 && r.chance(0.5) ? 'sea' : 'raid';
  else if (reason === 'glaube') goal = 'holy';
  else if (reason === 'raub' || reason === 'braut' || grudge > 60) goal = 'revenge';
  else if (ratio > 1.7 && (agg.cult.macht > 0.45 || reason === 'krone') && r.chance(0.55)) goal = 'conquest';
  else goal = r.chance(0.5) ? 'border' : 'raid';
  agg.war = def.id; def.war = agg.id; agg.warSince = def.warSince = st.day; agg.warScore = def.warScore = 0;
  agg.aggressor = true; def.aggressor = false; agg.raider = def.raider = agg.id;
  agg.warGoal = def.warGoal = goal; agg.warBattles = def.warBattles = 0;
  agg.warName = def.warName = goal === 'raid' ? (same ? L(`der Überfall auf ${def.name}`, `the raid on ${def.name}`) : L(`die Kaperfahrt gegen ${def.name}`, `the sea raid on ${def.name}`)) : REASONS[reason] ? REASONS[reason].war : GOALS[goal].name;
  agg.helpers = []; def.helpers = [];
  const al = leaderOf(st, agg);
  const G = GOALS[goal].name;
  const GA = L(`ein ${G}`, A_EN[goal]);
  if (goal === 'raid') chron(st, 'krieg', same
    ? r.pick(L([`${agg.name} überfällt ${def.name}. In der Nacht stürmen Krieger über die Felder.`, `Krieger aus ${agg.name} fallen über ${def.name} her. Sie wollen Vieh, Vorräte und Rache.`], [`${agg.name} raids ${def.name}. At night, warriors storm across the fields.`, `Warriors from ${agg.name} fall upon ${def.name}. They want cattle, stores and revenge.`]))
    : r.pick(L([`Schiffe aus ${agg.name} tauchen vor ${def.name} auf: eine Kaperfahrt.`, `${agg.name} schickt Langboote gegen ${def.name}. Am Strand läuten die Glocken.`], [`Ships from ${agg.name} appear off ${def.name}: a sea raid.`, `${agg.name} sends longboats against ${def.name}. On the beach the bells are ringing.`])), agg.id, 1);
  else chron(st, 'krieg', r.pick(L([
    `${label(al)} von ${agg.name} erklärt ${def.name} den Krieg, ${GA}. Man wird ihn ${agg.warName} nennen.`,
    `Zwischen ${agg.name} und ${def.name} bricht ${agg.warName} aus, ${GA}. Der alte Groll ist nicht mehr zu kitten.`,
  ], [
    `${label(al)} of ${agg.name} declares war on ${def.name}, ${GA}. It will be called ${agg.warName}.`,
    `${cap(agg.warName)} breaks out between ${agg.name} and ${def.name}, ${GA}. The old grudge can no longer be mended.`,
  ])), agg.id, 2);
  fx(st, { type: 'war', a: agg.id, b: def.id });
  // Verbündete: wer mit dem Angegriffenen im Bund oder Verteidigungsbündnis ist, schickt ein Hilfsheer; ein
  // Militärbündnis zieht auch mit dem Angreifer (seit 24.10.2026, military.js)
  const pk = (x, c) => { const q = x.pact && x.pact[c.id]; return q && q.until > st.day ? q.kind : ''; };
  for (const c of st.settlements) {
    if (!c.alive || c === agg || c === def || c.war) continue;
    const dk = pk(def, c), ak = pk(agg, c);
    if ((dk === 'verteidigung' || dk === 'militaer') && ak !== 'militaer' && r.chance(0.9)) { def.helpers.push(c.id); c.rel[agg.id] = agg.rel[c.id] = Math.min(c.rel[agg.id] ?? 0, -25); chron(st, 'krieg', L(`Das Verteidigungsbündnis hält: ${c.name} zieht für ${def.name} gegen ${agg.name} in den Krieg.`, `The defensive alliance holds: ${c.name} goes to war for ${def.name} against ${agg.name}.`), c.id, 1); continue; }
    if (ak === 'militaer' && r.chance(0.75)) { agg.helpers.push(c.id); c.rel[def.id] = def.rel[c.id] = Math.min(c.rel[def.id] ?? 0, -25); chron(st, 'krieg', L(`Das Militärbündnis ruft: ${c.name} marschiert mit ${agg.name} gegen ${def.name}.`, `The military alliance calls: ${c.name} marches with ${agg.name} against ${def.name}.`), c.id, 1); continue; }
    if (def.ally[c.id] && (c.rel[agg.id] ?? 0) < 40 && r.chance(0.75)) { def.helpers.push(c.id); c.rel[agg.id] = agg.rel[c.id] = Math.min(c.rel[agg.id] ?? 0, -20); chron(st, 'krieg', L(`${c.name} hält den Schwur und schickt ${def.name} Krieger gegen ${agg.name}.`, `${c.name} keeps its oath and sends warriors to aid ${def.name} against ${agg.name}.`), c.id, 1); }
    else if (agg.ally[c.id] && (c.rel[def.id] ?? 0) < 0 && r.chance(0.5)) { agg.helpers.push(c.id); chron(st, 'krieg', L(`${c.name} steht ${agg.name} zur Seite.`, `${c.name} stands with ${agg.name}.`), c.id, 1); }
  }
  stateHelpers(st, agg, def); // der ganze Staat zieht mit (states.js)
  // Heere ausheben und losschicken (military.js)
  onWar(st, agg, def);
}
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const A_EN = { raid: 'a raid', border: 'a border war', holy: 'a holy war', revenge: 'a war of revenge', conquest: 'a war of conquest', sea: 'a naval war' };

// Frieden: je nach Kriegsziel und Ausgang ein Vertrag
export function makePeace(st, a, b, win) {
  const r = rng(st);
  const lose = win ? (win === a ? b : a) : null;
  const goal = a.warGoal || 'border';
  const place = (lose || (a.pop < b.pop ? a : b)).name;
  const name = a.warName || L('der Krieg', 'the war');
  a.pact = a.pact || {}; b.pact = b.pact || {};
  a.grudge = a.grudge || {}; b.grudge = b.grudge || {};
  const pact = (kind, years) => { a.pact[b.id] = b.pact[a.id] = { kind, start: st.day, until: st.day + years * YEAR }; };
  let text;
  if (goal === 'raid' && win) {
    if (win.id === a.raider) {
      text = L(`${cap(name)} ist vorbei: ${win.name} zieht mit der Beute ab. ${lose.name} leckt seine Wunden und vergisst nicht.`, `${cap(name)} is over: ${win.name} withdraws with its loot. ${lose.name} licks its wounds and does not forget.`);
      lose.grudge[win.id] = (lose.grudge[win.id] || 0) + 25;
    } else {
      text = L(`${cap(name)} scheitert: ${win.name} schlägt die Angreifer zurück, ${lose.name} kehrt mit leeren Händen heim.`, `${cap(name)} fails: ${win.name} drives the attackers back, and ${lose.name} returns home empty-handed.`);
      win.grudge[lose.id] = (win.grudge[lose.id] || 0) + 15;
    }
  } else if (!win || r.chance(0.25)) {
    // unentschieden oder kluge Herrscher: ein Heiratsbund oder ein Handelsvertrag beendet den Krieg
    if (r.chance(0.5)) {
      pact('heirat', 20);
      const la = leaderOf(st, a), lb = leaderOf(st, b);
      text = L(`Im Frieden von ${place} endet ${name}. Die Häuser ${la ? la.clan : a.name} und ${lb ? lb.clan : b.name} verbinden sich durch eine Hochzeit. Zwanzig Jahre soll Frieden sein.`, `The Peace of ${place} ends ${name}. The houses of ${la ? la.clan : a.name} and ${lb ? lb.clan : b.name} are joined by a wedding. There shall be peace for twenty years.`);
      a.rel[b.id] = b.rel[a.id] = Math.max(a.rel[b.id] ?? 0, 20);
    } else {
      pact('handel', 15);
      text = L(`Der Vertrag von ${place} beendet ${name}. Statt Speeren tauschen ${a.name} und ${b.name} nun Waren, ohne Zoll.`, `The Treaty of ${place} ends ${name}. Instead of spears, ${a.name} and ${b.name} now trade goods, free of toll.`);
      a.rel[b.id] = b.rel[a.id] = Math.max(a.rel[b.id] ?? 0, 10);
    }
    a.grudge[b.id] = b.grudge[a.id] = 0;
  } else if (goal === 'holy') {
    for (const k of ['glaube', 'tradition']) lose.cult[k] = clamp(lose.cult[k] * 0.8 + win.cult[k] * 0.2, 0.03, 0.97);
    pact('waffenstillstand', 6);
    text = L(`${cap(name)} endet. ${lose.name} muss Priester aus ${win.name} aufnehmen, ihre Lieder klingen bald in jedem Haus.`, `${cap(name)} ends. ${lose.name} must take in priests from ${win.name}; their songs will soon be heard in every house.`);
  } else {
    pact(goal === 'border' ? 'grenze' : 'waffenstillstand', goal === 'border' ? 12 : 5);
    text = goal === 'border'
      ? L(`Im Grenzvertrag von ${place} endet ${name}. ${lose.name} tritt Weiden ab und zahlt ${win.name} fünf Jahre Tribut. Steine markieren die neue Grenze.`, `The Border Treaty of ${place} ends ${name}. ${lose.name} cedes pastures and pays ${win.name} tribute for five years. Stones mark the new border.`)
      : L(`Waffenstillstand von ${place}: ${name} ist vorbei. ${lose.name} zahlt ${win.name} Tribut. Auf beiden Seiten werden die Toten gezählt.`, `Truce of ${place}: ${name} is over. ${lose.name} pays ${win.name} tribute. On both sides the dead are counted.`);
    lose.grudge[win.id] = (lose.grudge[win.id] || 0) + 15;
  }
  for (const s of [a, b]) { s.warGoal = null; s.warName = null; s.helpers = []; s.lastWar = st.day; }
  chron(st, 'krieg', text, a.id, 2);
  fx(st, { type: 'peace', a: a.id, b: b.id });
}

// Alle 6 Tage: Groll, Zwischenfälle, gute Begegnungen, Pakte, Kriegserklärungen
export function diplomacyStep(st) {
  const r = rng(st), sets = st.settlements.filter(s => s.alive);
  const aggr = (st.char && st.char.aggr) || 1;
  for (const s of sets) { s.grudge = s.grudge || {}; s.pact = s.pact || {}; }
  const CK = Object.keys(D.CULTURE);
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
    let a = sets[i], b = sets[j];
    if (a.era < 1 || b.era < 1) continue; // (seit 19.10.2026 vorgezogen: billig zuerst, gleiches Ergebnis)
    const Ia = isleOf(st, a), Ib = isleOf(st, b), cont = Ia && Ib && Ia.contact[Ib.id];
    if (st.earth && a.isle !== b.isle && !cont) continue;
    const same = sameLand(st, a, b);
    if (!st.earth && !same && !cont) continue;
    const dist = Math.hypot(a.cx - b.cx, a.cy - b.cy);
    const border = same ? Math.max(0, 1 - (dist - a.R - b.R) / 18) : 0;
    let cd = 0; for (const k of CK) cd += Math.abs(a.cult[k] - b.cult[k]);
    cd /= 7;
    // Groll vergeht langsam
    for (const [x, y] of [[a, b], [b, a]]) if (x.grudge[y.id]) { x.grudge[y.id] *= 0.988; if (x.grudge[y.id] < 1) delete x.grudge[y.id]; }
    const P = a.pact[b.id], pactOn = P && P.until > st.day;
    // Runder Jahrestag eines Paktes: Friedensfest
    if (pactOn && (st.day - P.start) % YEAR < 6 && st.day - P.start >= YEAR) {
      a.rel[b.id] = b.rel[a.id] = clamp((a.rel[b.id] ?? 0) + 3, -100, 100);
      const yrs = Math.round((st.day - P.start) / YEAR);
      if ([1, 5, 10, 20, 25, 30, 40, 50, 75, 100].includes(yrs)) chron(st, 'fest', yrs === 1
        ? L(`Ein Jahr Frieden zwischen ${a.name} und ${b.name}. An der alten Grenze brennt ein gemeinsames Feuer.`, `One year of peace between ${a.name} and ${b.name}. A shared fire burns at the old border.`)
        : L(`${yrs} Jahre Frieden zwischen ${a.name} und ${b.name}. Man feiert mit Liedern, die beide Seiten kennen.`, `${yrs} years of peace between ${a.name} and ${b.name}. They celebrate with songs both sides know.`), a.id, 0);
    }
    // Pakt läuft aus: erneuern oder vergehen lassen
    if (P && P.until <= st.day) {
      if ((a.rel[b.id] ?? 0) > 15) { P.until = st.day + 10 * YEAR; chron(st, 'politik', L(`${a.name} und ${b.name} erneuern ihren Pakt für zehn Jahre.`, `${a.name} and ${b.name} renew their pact for ten years.`), a.id, 1); }
      else { delete a.pact[b.id]; delete b.pact[a.id]; chron(st, 'politik', L(`Der Pakt zwischen ${a.name} und ${b.name} läuft aus. Niemand will ihn erneuern.`, `The pact between ${a.name} and ${b.name} runs out. No one wants to renew it.`), a.id, 1); }
    }
    if (a.war === b.id) continue;
    // Zwischenfälle (öfter an nahen Grenzen und bei fremder Kultur, seltener mit Pakt)
    const pBad = (same ? 0.03 + border * 0.035 : 0.016) * aggr * (1 + cd * 3) * (pactOn ? 0.4 : 1);
    if (r.chance(pBad)) {
      if (r.chance(0.5)) [a, b] = [b, a];
      const why = reasonFor(st, r, a, b, same, border, cd);
      const R = REASONS[why];
      const hurt = r.range(8, 22);
      a.rel[b.id] = b.rel[a.id] = clamp((a.rel[b.id] ?? 0) - hurt, -100, 100);
      b.grudge[a.id] = (b.grudge[a.id] || 0) + hurt * 1.2;
      b.lastReason = b.lastReason || {}; b.lastReason[a.id] = why;
      chron(st, 'politik', r.pick(R.t(a, b, st)), b.id, hurt > 17 ? 1 : 0);
    } else if (!a.war && !b.war && r.chance((same ? 0.02 : 0.01) * (pactOn ? 1.6 : 1))) {
      // gute Begegnungen
      a.rel[b.id] = b.rel[a.id] = clamp((a.rel[b.id] ?? 0) + r.range(5, 12), -100, 100);
      for (const [x, y] of [[a, b], [b, a]]) if (x.grudge[y.id]) x.grudge[y.id] *= 0.7;
      chron(st, r.chance(0.5) ? 'fest' : 'politik', r.pick(GOOD(a, b, same)), a.id, 0);
    }
    // Krieg? Spannung aus Beziehung und Groll. Orte desselben Staates führen keinen Krieg gegeneinander (states.js)
    if (a.state && a.state === b.state) continue;
    if (a.war || b.war || (a.truce[b.id] || 0) > st.day || a.pop < 12 || b.pop < 12) continue;
    if (st.day - Math.max(a.lastWar || -1e9, b.lastWar || -1e9) < 3 * YEAR) continue;
    for (const [x, y] of [[a, b], [b, a]]) {
      const tension = -(x.rel[y.id] ?? 0) + (x.grudge[y.id] || 0) * 0.9 + x.cult.macht * 30;
      if (tension < 30) continue;
      const canSail = same || (knows(st, 'segeln', x) && bldOf(st, x).some(q => q.t === 'hafen' || q.t === 'fischer' || q.t === 'werft'));
      if (!canSail) continue;
      let p = Math.min(0.15, (tension - 30) / 320) * aggr * (same ? 1 : 0.6);
      if (pactOn) p *= 0.12; // Verrat ist selten
      p *= appetite(st, x, y); // der Verteidigungsminister wägt Stärke und Bündnisse ab (military.js)
      if (!r.chance(p)) continue;
      const why = (x.lastReason && x.lastReason[y.id]) || reasonFor(st, r, x, y, same, border, cd);
      if (pactOn) {
        chron(st, 'krieg', L(`Verrat! ${x.name} bricht den Pakt mit ${y.name}. Die Schwüre von einst gelten nichts mehr.`, `Betrayal! ${x.name} breaks its pact with ${y.name}. The oaths of old mean nothing now.`), x.id, 2);
        delete x.pact[y.id]; delete y.pact[x.id];
        for (const c of sets) if (c !== x && c !== y) c.rel[x.id] = (c.rel[x.id] ?? 0) - 10; // alle sehen den Verrat
      }
      declareWar(st, x, y, why);
      break;
    }
  }
}
