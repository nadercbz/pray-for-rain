// Das Meer zwischen den Inseln: Entdeckung, Erstkontakt, Handelsrouten, Auswanderung.
// Schiffe für die Darstellung stehen in st.voyages ({k, a, b, d, dur}).
import { clamp } from './rng.js';
import { knows, chron, fx, bio, members, rng, isleOf, ageOf, shiftCult, bldOf } from './util.js';
import { outbreak, leaderOf, label } from './society.js';
import { L } from '../i18n.js';
import { isleGap, firstSight } from './explore.js';
import { earthContactStep } from './folks.js';

const aliveOn = (st, id) => st.settlements.filter(s => s.alive && s.isle === id);
const dist = (a, b) => Math.hypot(a.cx - b.cx, a.cy - b.cy);

// Wie weit die Schiffe einer Insel kommen
export function reach(st, I) {
  if (knows(st, 'navigation', I.id)) return 999;
  if (knows(st, 'schiffbau', I.id)) return 130;
  if (knows(st, 'segeln', I.id)) return 75;
  return 0;
}

function port(st, I) {
  const sets = aliveOn(st, I.id);
  return sets.find(s => bldOf(st, s).some(b => b.t === 'hafen')) || sets.sort((a, b) => b.pop - a.pop)[0];
}

export function seaStep(st) {
  const doy = st.day % 24;
  if (doy === 20) { if (st.earth) earthContactStep(st); else discovery(st); }
  if (st.day % 6 === 2) trade(st);
  if (st.voyages.length) st.voyages = st.voyages.filter(v => st.day <= v.d + v.dur + 1);
}

function discovery(st) {
  const r = rng(st);
  for (const I of st.isles) {
    const sets = aliveOn(st, I.id);
    if (!sets.length) continue;
    const R = reach(st, I);
    if (!R) continue;
    const curious = sets.reduce((a, s) => a + s.cult.handel + s.cult.wissen, 0) / sets.length;
    if (!r.chance(0.18 + curious * 0.25)) continue;
    const from = port(st, I);
    // Abstand von Küste zu Küste, nicht von Mitte zu Mitte (das Festland ist riesig, seine Küste aber nah)
    const cands = st.isles.filter(J => J !== I && !I.seen[J.id]).map(J => [J, isleGap(st, I, J)]).filter(([, g]) => g.d <= R).sort((a, b) => a[1].d - b[1].d);
    if (!cands.length) continue;
    const [J, g] = cands[0];
    st.voyages.push({ k: 'entdeckung', a: from.id, to: [g.b[0], g.b[1]], d: st.day, dur: 4 });
    const natives = aliveOn(st, J.id);
    if (natives.length) { I.seen[J.id] = st.day; contact(st, I, J, from, natives.sort((a, b) => dist(a, from) - dist(b, from))[0]); }
    else if (J.nw) firstSight(st, I, J, from, r);
    else {
      I.seen[J.id] = st.day;
      chron(st, 'fremde', r.pick(L([
        `Seefahrer aus ${from.name} entdecken eine unbewohnte Insel. Wälder, Quellen, kein Mensch. Sie nennen sie ${J.name}.`,
        `Ein Boot aus ${from.name} kehrt mit Nachricht zurück: Hinter dem Horizont liegt eine leere Insel, ${J.name}.`,
      ], [
        `Seafarers from ${from.name} discover an uninhabited island. Forests, springs, not a soul. They call it ${J.name}.`,
        `A boat from ${from.name} returns with news: beyond the horizon lies an empty island, ${J.name}.`,
      ])), from.id, 1);
    }
  }
}

// Zwei Völker begegnen sich zum ersten Mal
export function contact(st, I, J, a, b) {
  if (I.contact[J.id]) return;
  const r = rng(st);
  I.contact[J.id] = J.contact[I.id] = st.day;
  I.seen[J.id] = J.seen[I.id] = st.day;
  for (const x of aliveOn(st, I.id)) for (const y of aliveOn(st, J.id)) {
    let cd = 0; for (const k of Object.keys(x.cult)) cd += Math.abs(x.cult[k] - y.cult[k]);
    x.rel[y.id] = y.rel[x.id] = clamp(r.range(-5, 25) - cd * 25, -60, 60);
  }
  const hostile = b.cult.macht > 0.55 || b.laws.includes('abschottung');
  const lead = leaderOf(st, b);
  chron(st, 'fremde', hostile
    ? L(`Seefahrer aus ${a.name} landen auf ${J.name}. Die Menschen von ${b.name} sprechen eine fremde Sprache und empfangen sie mit Speeren. ${label(lead)} lässt die Küste bewachen.`,
      `Seafarers from ${a.name} land on ${J.name}. The people of ${b.name} speak a strange tongue and receive them with spears. ${label(lead)} has the coast guarded.`)
    : L(`Seefahrer aus ${a.name} landen auf ${J.name}. Dort leben Menschen mit einer fremden Sprache. ${b.name} empfängt sie mit Brot und Muscheln, und beide Seiten staunen.`,
      `Seafarers from ${a.name} land on ${J.name}. People with a strange tongue live there. ${b.name} welcomes them with bread and shells, and both sides marvel.`), b.id, 2, { x: b.cx, y: b.cy });
  if (hostile) { a.rel[b.id] = b.rel[a.id] = Math.min(a.rel[b.id], -25); }
  for (const s of [a, b]) { shiftCult(s, 'wissen', 0.03); shiftCult(s, 'handel', 0.03); }
  fx(st, { type: 'contact', a: a.id, b: b.id });
}

// Handel zwischen Häfen verschiedener Inseln
function trade(st) {
  const r = rng(st);
  const sets = st.settlements.filter(s => s.alive);
  const harbor = new Set(st.buildings.filter(b => b.t === 'hafen' && b.prog >= 1).map(b => b.s));
  const routes = [];
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
    const x = sets[i], y = sets[j];
    if (x.isle === y.isle) continue;
    const Ix = isleOf(st, x), Iy = isleOf(st, y);
    if (!Ix || !Iy || !Ix.contact[Iy.id]) continue;
    if (!harbor.has(x.id) || !harbor.has(y.id)) continue;
    if (x.war === y.id || (x.rel[y.id] ?? 0) < -20) continue;
    if (st.earth && dist(x, y) > Math.max(reach(st, Ix), reach(st, Iy))) continue; // Erde: nur so weit die Schiffe kommen
    routes.push({ a: x.id, b: y.id });
    for (const [s, o, Io] of [[x, y, Iy], [y, x, Ix]]) {
      // Geld und Waren fließen in money.js (tradeStep) nach Preisen, hier reisen Ideen, Menschen und Seuchen
      // Ideen reisen mit: was die anderen schon wissen, geht schneller
      const Is = isleOf(st, s);
      if (Is.research.cur && knows(st, Is.research.cur, Io.id)) Is.research.pts += 3 + s.cult.wissen * 4;
    }
    x.rel[y.id] = y.rel[x.id] = clamp((x.rel[y.id] ?? 0) + 1.5, -100, 100);
    if (r.chance(0.5)) st.voyages.push({ k: 'handel', a: x.id, b: y.id, d: st.day, dur: 5 });
    // Menschen reisen und bleiben manchmal
    if (r.chance(0.04)) { const [f, t] = r.chance(0.5) ? [x, y] : [y, x]; migrate(st, f, t); }
    // Krankheiten reisen auch: seit 20.10.2026 über die Handelswege im Seuchenmodell (epidemic.js partners)
    if (!st._rt.seedFever) for (const [s, o] of [[x, y], [y, x]]) {
      const M = members(st, s);
      const sick = M.all.filter(p => p.sick).length / Math.max(1, M.all.length);
      if (sick > 0.1 && r.chance(0.2)) {
        const n = outbreak(st, o, 0.06);
        if (n > 1) chron(st, 'natur', L(`Ein Handelsschiff aus ${s.name} bringt das Fieber nach ${o.name}.`, `A trading ship from ${s.name} brings the fever to ${o.name}.`), o.id, 1);
      }
    }
  }
  st.trade = routes;
}

function migrate(st, from, to) {
  if (from === to) return;
  const r = rng(st);
  const cands = members(st, from).adults.filter(p => !p.lt && !p.pa && ageOf(st, p) < 35);
  if (!cands.length) return;
  const p = r.pick(cands);
  p.s = to.id; p.home = -1; p.w = -1; p.fac = null; p.foreign = true;
  if (st._rt.onMove) st._rt.onMove(st, p, from, to); // Einwanderergeneration und Wanderungszähler (migration.js)
  bio(p, st.day, L(`segelt nach ${to.name} und bleibt`, `sails to ${to.name} and stays`));
  chron(st, 'fremde', r.pick(L([
    `${p.n} aus ${from.name} fährt mit einem Handelsschiff nach ${to.name} und kommt nicht zurück. Man munkelt von Liebe.`,
    `In ${to.name} lebt jetzt ${p.n}, ein Mensch aus ${from.name}. Die Kinder lernen von ${p.sex === 'f' ? 'ihr' : 'ihm'} fremde Lieder.`,
  ], [
    `${p.n} of ${from.name} takes a trading ship to ${to.name} and never comes back. People whisper of love.`,
    `${p.n}, a person from ${from.name}, now lives in ${to.name}. The children learn strange songs from ${p.sex === 'f' ? 'her' : 'him'}.`,
  ])), to.id, 0);
}
