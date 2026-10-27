// Gesellschaft zusammengeführt und Labor (seit 20.10.2026, Teil 2 aus PLAN_REGELWERK.md).
// initSociety rüstet jeden Stand nach (idempotent, aus hydrate), societyStep läuft jeden Tag vor peopleStep (core.js).
// Labor: Zeitreihe st.lab alle 6 Tage (Menschen je Herkunft, Glaube, Schicht, S E I R, Tote nach Ursache, Wanderung),
// höchstens 320 Messpunkte, ältere werden zusammengelegt (halbe Auflösung), so bleibt die ganze Geschichte sichtbar.
// Experimente: settleGroup, startEpidemic, startMigration, addFaith (faith.js), setLaw. Jedes Experiment steht im
// Protokoll st.lab.ev.
import { mobilityYear, originClass } from './mobility.js';
import * as D from './data.js';
import { rng, chron, bio, makePerson } from './util.js';
import { addOrigin, originFor, originKey, mainOrigin, personHook, pickHome, peoplesYear, quarterStep } from './peoples.js';
import { addFaith, folkFaith, personFaith, faithStep, prophetStep, faithYear, onSplit } from './faith.js';
import { migrationStep, flee, onMove, startMigration as migrate } from './migration.js';
import { PRESETS, epidemicStep, epidemicYear, blameStep, seedFever, seirCounts, startEpidemic as epidemic, dzName } from './epidemic.js';
import { L } from '../i18n.js';

export { PRESETS, addOrigin, addFaith, dzName };
const YEAR = D.DAYS_PER_YEAR;
const MAXS = 320;

// ---------- Nachrüsten ----------

export function initSociety(st) {
  const rt = st._rt;
  if (globalThis.PFR_NOSOC) return; // nur für Vergleichsmessungen (tools/societytest.mjs)
  st.origins = st.origins || [];
  st.faiths = st.faiths || [];
  st.diseases = st.diseases || [];
  st.lab = st.lab || { t: [], og: {}, rl: {}, cls: [[], [], [], [], []], seir: [[], [], [], []], dead: {}, mig: [[], []], ev: [] };
  st.mig = st.mig || { log: [] };
  // Herkunftsschicht für alle, die vor dem 20.10.2026 geboren wurden: beste Schätzung aus den Eltern, wenn sie noch leben
  if (!st.mobV) {
    st.mobV = 1;
    const by = new Map(st.people.map(p => [p.id, p]));
    for (const p of st.people) if (p.oc == null && (by.has(p.mo) || by.has(p.fa))) p.oc = originClass(by.get(p.mo), by.get(p.fa));
  }
  rt.ogById = new Map(st.origins.map(o => [o.id, o]));
  rt.ogByKey = new Map(st.origins.filter(o => o.key).map(o => [o.key, o]));
  rt.fById = new Map(st.faiths.map(f => [f.id, f]));
  rt.dzById = new Map(st.diseases.map(d => [d.id, d]));
  rt.onOrigin = (st2, o) => folkFaith(st2, o);
  rt.onPerson = personHook;
  rt.onPersonFaith = personFaith;
  rt.pickHome = pickHome;
  rt.onSplit = onSplit;
  rt.onMove = onMove;
  rt.flee = (st2, s, pred, why) => flee(st2, s, pred, why);
  rt.seedFever = seedFever;
  // Tote nach Ursache für das Labor (an den vorhandenen Haken in killPerson angehängt)
  if (!rt.labDeadHook) {
    const prev = rt.onDeath;
    rt.onDeath = (st2, p) => { if (prev) prev(st2, p); const c = rt.labDead || (rt.labDead = {}); c[p.cause] = (c[p.cause] || 0) + 1; };
    rt.labDeadHook = 1;
  }
  // Alte Stände: Herkunft nach Ort (Sprache, in der Erde das Volk), Glaube des Volkes, Zugereiste bleiben Zugereiste
  for (const s of st.settlements) if (s.alive && !s.og) mainOrigin(st, s);
  for (const o of st.origins) folkFaith(st, o);
  let dz = 0;
  for (const p of st.people) {
    if (p.dz) dz++;
    if (p.og != null) continue;
    const s = rt.sById.get(p.s);
    if (!s) continue;
    const o = originFor(st, originKey(st, s), s.lang, s.isle);
    p.og = o.id;
    p.lg = p.lg ?? s.lang;
    if (p.foreign && !p.mg) { p.mg = 1; p.as = 0.5; }
    if (!p.rl) p.rl = folkFaith(st, o).id;
  }
  rt.dzLive = dz;
}

// ---------- Tageslauf (aus stepDay vor peopleStep) ----------

// reindex: indexMembers aus core.js, nach Umzügen
export function societyStep(st, season, reindex) {
  if (globalThis.PFR_NOSOC) return;
  const off = globalThis.PFR_SOC_OFF || '';
  if (!off.includes('dz')) epidemicStep(st, season);
  const d = st.day;
  if (d % 6 === 0 && !off.includes('faith')) faithStep(st);
  if (d % 6 === 2 && !off.includes('mig') && migrationStep(st) && reindex) reindex(st);
  if (d % 6 === 4) blameStep(st);
  if (d % 12 === 7) { if (!off.includes('quarter')) quarterStep(st); prophetStep(st); }
  if (d % YEAR === 11) { peoplesYear(st); faithYear(st); mobilityYear(st); if (!off.includes('dz')) epidemicYear(st); }
  if (d % 6 === 3) sample(st);
}

// ---------- Messung ----------

function push(arr, v) { arr.push(v); }
function series(map, key, n) { let a = map[key]; if (!a) { a = map[key] = new Array(n).fill(0); } return a; }

export function sample(st) {
  const L0 = st.lab, rt = st._rt, n = L0.t.length;
  const og = new Map(), rl = new Map(), cls = [0, 0, 0, 0, 0];
  for (const p of st.people) {
    og.set(p.og, (og.get(p.og) || 0) + 1);
    rl.set(p.rl || 0, (rl.get(p.rl || 0) || 0) + 1);
    cls[p.cls ?? 1]++;
  }
  push(L0.t, st.day);
  for (const [k, v] of og) series(L0.og, k, n);
  for (const [k, v] of rl) series(L0.rl, k, n);
  for (const k in L0.og) L0.og[k].push(og.get(+k) || 0);
  for (const k in L0.rl) L0.rl[k].push(rl.get(+k) || 0);
  cls.forEach((v, i) => L0.cls[i].push(v));
  const S = seirCounts(st);
  [S.S, S.E, S.I, S.R].forEach((v, i) => L0.seir[i].push(v));
  const dead = rt.labDead || {};
  for (const k of Object.keys(dead)) series(L0.dead, k, n);
  for (const k in L0.dead) L0.dead[k].push(dead[k] || 0);
  rt.labDead = {};
  const m = rt.labMig || { n: 0, ref: 0 };
  L0.mig[0].push(m.n); L0.mig[1].push(m.ref);
  // Mobilität (mobility.js): Anteil Aufsteiger und Absteiger unter Erwachsenen mit bekannter Herkunft, in Promille
  if (!L0.mob) L0.mob = [new Array(n).fill(0), new Array(n).fill(0)];
  const mb = st.mob || { up: 0, down: 0, n: 0 };
  L0.mob[0].push(mb.n ? Math.round(mb.up / mb.n * 1000) : 0); L0.mob[1].push(mb.n ? Math.round(mb.down / mb.n * 1000) : 0);
  rt.labMig = { n: 0, ref: 0 };
  if (L0.t.length > MAXS) compact(L0);
}

// Ältere Hälfte auf halbe Auflösung (Bestände: jeder zweite Wert, Ereignisse wie Tote: Summe zweier Werte)
function compact(L0) {
  const cut = Math.floor(MAXS / 2);
  const keep = (a, sum) => { const head = []; for (let i = 0; i + 1 < cut; i += 2) head.push(sum ? a[i] + a[i + 1] : a[i + 1]); return head.concat(a.slice(cut)); };
  L0.t = keep(L0.t, false);
  for (const k in L0.og) L0.og[k] = keep(L0.og[k], false);
  for (const k in L0.rl) L0.rl[k] = keep(L0.rl[k], false);
  L0.cls = L0.cls.map(a => keep(a, false));
  if (L0.mob) L0.mob = L0.mob.map(a => keep(a, false));
  L0.seir = L0.seir.map(a => keep(a, false));
  for (const k in L0.dead) L0.dead[k] = keep(L0.dead[k], true);
  L0.mig = L0.mig.map(a => keep(a, true));
  // ausgestorbene Reihen ohne Werte fallen weg
  for (const M of [L0.og, L0.rl, L0.dead]) for (const k in M) if (!M[k].some(v => v)) delete M[k];
}

function logEv(st, s, t) {
  st.lab.ev.push({ d: st.day, s: s ? s.id : -1, t });
  if (st.lab.ev.length > 80) st.lab.ev.splice(0, st.lab.ev.length - 80);
}

// ---------- Experimente ----------

// n Menschen (Paare, ein paar Kinder) mit Herkunft, Glaube, Schicht und Einwanderergeneration in einen Ort setzen
export function settleGroup(st, s, n, { og, rl, cls, mg, lang } = {}) {
  const r = rng(st);
  const o = og != null ? st._rt.ogById.get(og) : null;
  const l = lang ?? (o ? o.lang : s.lang);
  const out = [];
  const mk = (sex, age, mo, fa) => {
    st._rt.forceOg = mo || fa ? 0 : og;
    const p = makePerson(st, s, { sex, b: st.day - age * YEAR - r.int(0, YEAR - 1), mother: mo ? mo.id : null, father: fa ? fa.id : null, lang: mo || fa ? undefined : l });
    st._rt.forceOg = 0;
    if (!mo && !fa) {
      if (og != null) p.og = og;
      p.lg = l;
      if (rl != null) p.rl = rl;
      p.mg = mg ?? (p.og !== mainOrigin(st, s) ? 1 : 0);
      if (p.mg) p.as = p.as ?? 0; else delete p.as;
    }
    if (cls != null) p.cls = cls;
    out.push(p);
    return p;
  };
  while (out.length < n) {
    const f = mk('f', r.int(18, 34));
    if (out.length >= n) break;
    const m = mk('m', r.int(19, 38));
    f.pa = m.id; m.pa = f.id;
    if (out.length < n && r.chance(0.6)) { const k = mk(null, r.int(1, 12), f, m); f.kids++; m.kids++; void k; }
  }
  for (const p of out) { p.foreign = p.mg ? true : p.foreign; if (!p.bio.length) bio(p, st.day, L(`kommt mit einer Gruppe nach ${s.name}`, `arrives in ${s.name} with a group`)); }
  logEv(st, s, L(`${out.length} Menschen angesiedelt`, `${out.length} people settled`));
  return out;
}

export function startEpidemic(st, s, def, opts = {}) {
  const d = epidemic(st, s, def, opts);
  logEv(st, s, L(`Seuche gestartet: ${dzName(d)}`, `Epidemic started: ${dzName(d)}`));
  return d;
}

export function startMigration(st, from, to, n, opts = {}) {
  const k = migrate(st, from, to, n, opts);
  if (k) chron(st, 'wanderung', opts.refugee
    ? L(`${k} Menschen fliehen aus ${from.name} nach ${to.name}.`, `${k} people flee from ${from.name} to ${to.name}.`)
    : L(`${k} Menschen ziehen aus ${from.name} nach ${to.name}.`, `${k} people move from ${from.name} to ${to.name}.`), to.id, 1);
  logEv(st, from, L(`${k} ${opts.refugee ? 'Flüchtlinge' : 'Umziehende'} nach ${to.name}`, `${k} ${opts.refugee ? 'refugees' : 'movers'} to ${to.name}`));
  return k;
}

export function foundFaith(st, s, opts = {}) {
  const f = addFaith(st, s, { share: 0.15, ...opts });
  chron(st, 'glaube', L(`In ${s.name} entsteht ein neuer Glaube: ${f.n}.`, `A new faith arises in ${s.name}: ${f.n}.`), s.id, 1);
  logEv(st, s, L(`Glaube gestiftet: ${f.n}`, `Faith founded: ${f.n}`));
  return f;
}

// Gesetz setzen oder aufheben (Labor). 'quarantaene' ist kein Gesetz der Fraktionen, sondern ein Zustand (s.quar)
export function setLaw(st, s, law, on) {
  if (law === 'quarantaene') { s.quar = on ? st.day + 50 * YEAR : 0; logEv(st, s, on ? L('Quarantäne verhängt', 'Quarantine imposed') : L('Quarantäne aufgehoben', 'Quarantine lifted')); return; }
  const OPP = { gastrecht: 'abschottung', abschottung: 'gastrecht', toleranz: 'staatskirche', staatskirche: 'toleranz' };
  s.laws = s.laws.filter(l => l !== law && (!on || l !== OPP[law]));
  if (on) s.laws.push(law);
  const name = D.LAWS[law] ? D.LAWS[law].name : law;
  logEv(st, s, on ? L(`Gesetz: ${name}`, `Law: ${name}`) : L(`aufgehoben: ${name}`, `repealed: ${name}`));
}

export { flee };
