// Wanderung (seit 20.10.2026, Teil 2 aus PLAN_REGELWERK.md). Alle 6 Tage: Gravitationsmodell. Jeder Ort hat eine
// Anziehung A (Essen, Lohn, Wohnraum, Sicherheit, Größe, minus Hunger, Krieg, Seuche); Haushalte ziehen von i nach j mit
// F = k · P_i · max(0, A_j − A_i − Schwelle) · √P_j / (1 + d/10)^1,5 · Passung. d ist der Weg in Feldern (Straße kürzer,
// über das Meer nur mit Kontakt und Häfen). Passung: zu den Eigenen gern, zu Fremden halb so gern, mehr, wenn dort schon
// Landsleute leben (Kettenwanderung), Gastrecht lockt, Abschottung sperrt Fremde aus. Flucht bei Krieg, Hunger, Seuche
// und Verfolgung überschreibt das Modell: Familien gehen zum nächsten sicheren Ort.
// Zähler: st.counts.migr, st.counts.refugees, Liste st.mig.log (die letzten Züge, für Inselbuch und Labor).
import * as D from './data.js';
import { clamp } from './rng.js';
import { rng, members, ageOf, chron, bio, sameLand, isleOf, bldOf, knows } from './util.js';
import { netRoad } from './roads.js';
import { mix, top, arrive, mainOrigin } from './peoples.js';
import { L } from '../i18n.js';

const YEAR = D.DAYS_PER_YEAR;

function logMove(st, a, b, n, k) {
  st.mig = st.mig || { log: [] };
  const last = st.mig.log[st.mig.log.length - 1];
  if (last && last.a === a.id && last.b === b.id && last.k === k && st.day - last.d < YEAR) { last.n += n; last.d = st.day; }
  else st.mig.log.push({ d: st.day, a: a.id, b: b.id, n, k });
  if (st.mig.log.length > 60) st.mig.log.splice(0, st.mig.log.length - 60);
  st.counts.migr = (st.counts.migr || 0) + n;
  if (k === 'flucht') st.counts.refugees = (st.counts.refugees || 0) + n;
  const L0 = st._rt.labMig || (st._rt.labMig = { n: 0, ref: 0 });
  L0.n += n; if (k === 'flucht') L0.ref += n;
}

// Einen Menschen umziehen lassen (auch für sea.js und das Labor)
export function movePerson(st, p, to, why) {
  const from = st._rt.sById.get(p.s);
  p.s = to.id; p.home = -1; p.w = -1; p.fac = null;
  arrive(st, p, to);
  if (why === 'flucht') p.ref = st.day;
  if (ageOf(st, p) >= 14) bio(p, st.day, why === 'flucht'
    ? L(`flieht aus ${from ? from.name : 'der Heimat'} nach ${to.name}`, `flees from ${from ? from.name : 'home'} to ${to.name}`)
    : L(`zieht von ${from ? from.name : 'weit her'} nach ${to.name}`, `moves from ${from ? from.name : 'afar'} to ${to.name}`));
}

// Haushalt eines Erwachsenen: er selbst, Partner im selben Ort, Kinder unter 14
function household(st, s, p) {
  const rt = st._rt, out = [p];
  const q = p.pa && rt.pById.get(p.pa);
  if (q && q.s === s.id && q.id !== s.gov.leader) out.push(q);
  for (const k of members(st, s).kids) if (k.s === s.id && (k.mo === p.id || k.fa === p.id)) out.push(k);
  return out;
}

// ---------- Anziehung ----------

function attract(st, s, wMean) {
  const need = Math.max(1, (s.prod && s.prod.need) || s.pop || 1);
  const food = clamp(((s.prod && s.prod.food) || 0) / need, 0, 2);
  const wage = clamp((s.avgWage || 1) / Math.max(0.1, wMean), 0, 2.5);
  const room = clamp(((s.homeCap || 0) - (s.pop || 0)) / Math.max(10, s.pop || 1), -0.5, 0.5);
  const safe = (s.war ? -0.45 : 0) - s.unrest * 0.35;
  const size = s.era >= 4 ? Math.log(Math.max(20, s.pop) / 40) * 0.08 : 0;
  return 0.22 * food + 0.2 * wage + 0.15 * room + 0.15 * safe + size - (s.hunger || 0) * 0.8 - (s.sickShare || 0) * 2.5 - (s.persec ? 0.05 : 0);
}

const harborOf = (st, s) => bldOf(st, s).some(b => (b.t === 'hafen' || b.t === 'fischer') && b.prog >= 1);

// Weg zwischen zwei Orten in Feldern, Infinity wenn unerreichbar
function travel(st, a, b) {
  const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
  if (sameLand(st, a, b)) return netRoad(st, a.id, b.id) ? d * 0.6 : d;
  if (d > (st.earth ? 400 : 260)) return Infinity;
  const Ia = isleOf(st, a);
  const contact = Ia && (Ia.contact[b.isle] || a.isle === b.isle);
  if (!contact || !knows(st, 'segeln', a) || !harborOf(st, a) || !harborOf(st, b)) return Infinity;
  return d * 0.8 + 15;
}

// Wer darf hinein? Abschottung weist Fremde ab, Gastrecht lockt
function welcome(st, to, og) {
  if (og === mainOrigin(st, to)) return 1;
  if (to.laws.includes('abschottung')) return 0.05;
  const share = (mix(st, to).og.get(og) || 0) / Math.max(1, to.pop);
  return Math.min(1.3, 0.5 + share * 3) * (to.laws.includes('gastrecht') ? 1.5 : 1) * (to.laws.includes('einbuergerung') ? 1.2 : 1);
}

// ---------- alle 6 Tage ----------

export function migrationStep(st) {
  const r = rng(st), rt = st._rt;
  const alive = st.settlements.filter(s => s.alive && s.pop > 0);
  if (alive.length < 2) return 0;
  let wSum = 0;
  for (const s of alive) wSum += s.avgWage || 1;
  const wMean = wSum / alive.length;
  const A = new Map(alive.map(s => [s.id, attract(st, s, wMean)]));
  let moved = 0;
  // Flucht zuerst: Krieg (verloren), Hunger, Seuche
  for (const s of alive) {
    if (s.pop < 8) continue;
    let why = null, share = 0;
    const foe = s.war && rt.sById.get(s.war);
    if (foe && (foe.warScore || 0) - (s.warScore || 0) >= 2 && r.chance(0.25)) { why = 'krieg'; share = 0.05; }
    else if ((s.hunger || 0) > 0.45 && r.chance(0.3)) { why = 'hunger'; share = 0.04; }
    else if ((s.sickShare || 0) > 0.12 && r.chance(0.3)) { why = 'seuche'; share = 0.04; }
    if (why) moved += flee(st, s, null, why, share, A);
  }
  // Wirtschaftliche Wanderung
  const K = 0.004;
  for (const s of alive) {
    if (s.pop < 6) continue;
    const Ai = A.get(s.id), main = mainOrigin(st, s);
    const budget = Math.max(1, Math.floor(s.pop * 0.04));
    let sent = 0;
    for (const o of alive) {
      if (o === s || sent >= budget) continue;
      const dA = A.get(o.id) - Ai - 0.08;
      if (dA <= 0) continue;
      const d = travel(st, s, o);
      if (!isFinite(d)) continue;
      const F = K * s.pop * dA * Math.sqrt(o.pop) / Math.pow(1 + d / 10, 1.5) * welcome(st, o, main) * ((st.char && st.char.wander) || 1);
      let n = Math.floor(F) + (r.chance(F - Math.floor(F)) ? 1 : 0);
      n = Math.min(n, budget - sent);
      if (n <= 0) continue;
      // Wer geht: junge Erwachsene, Arme, Minderheiten, Verfolgte zuerst; nie Herrscher, Titelträger, Verlobte
      const cands = members(st, s).adults.filter(p => p.id !== s.gov.leader && !p.lt && !p.title && !p.fi && ageOf(st, p) < 46 && (!p.pa || (st._rt.pById.get(p.pa) || {}).s === s.id));
      if (!cands.length) continue;
      const score = p => (p.cls === 0 ? 1 : 0) + (p.og !== main ? 0.6 : 0) + (s.persec && s.persec.includes(p.rl) ? 1.2 : 0) + (p.poor > 6 ? 0.5 : 0) + welcome(st, o, p.og) * 0.8 + r.next() * 1.2;
      cands.sort((a, b) => score(b) - score(a));
      let hh = 0;
      for (const p of cands) {
        if (hh >= n) break;
        if (p.s !== s.id || welcome(st, o, p.og) < 0.1) continue;
        const fam = household(st, s, p);
        for (const q of fam) movePerson(st, q, o, 'zuzug');
        logMove(st, s, o, fam.length, 'zuzug');
        moved += fam.length; hh++;
      }
      sent += hh;
      if (hh >= 2 && r.chance(0.2)) chron(st, 'wanderung', L(`${hh} Familien aus ${s.name} ziehen nach ${o.name}. Dort gibt es Arbeit und Brot.`, `${hh} families from ${s.name} move to ${o.name}. There is work and bread there.`), o.id, 0);
    }
  }
  return moved;
}

// Flucht aus s: pred wählt, wer flieht (null: alle), share: Anteil der Erwachsenen. Ziel: der nächste erreichbare Ort
// ohne Krieg mit s, der nicht schlechter dasteht und die Fremden einlässt. Gibt die Zahl der Geflohenen zurück.
export function flee(st, s, pred, why, share = 0.05, A = null) {
  const r = rng(st);
  const alive = st.settlements.filter(o => o.alive && o !== s && o.pop > 0 && o.war !== s.id && s.war !== o.id);
  const As = A ? A.get(s.id) : 0;
  const opts = [];
  for (const o of alive) {
    const d = travel(st, s, o);
    if (!isFinite(d) || (o.sickShare || 0) > 0.1 || o.war) continue;
    if (A && A.get(o.id) < As - 0.1) continue;
    opts.push([o, d]);
  }
  if (!opts.length) return 0;
  opts.sort((a, b) => a[1] - b[1]);
  const pool = members(st, s).adults.filter(p => p.id !== s.gov.leader && !p.lt && (!pred || pred(p)));
  const want = Math.max(1, Math.round(pool.length * (pred ? 0.25 : share)));
  let n = 0, hh = 0, turned = null;
  const dest = new Map();
  for (const p of r.shuffle(pool.slice())) {
    if (hh >= want || p.s !== s.id) continue;
    const o = opts.find(([x]) => welcome(st, x, p.og) >= 0.1);
    if (!o) { turned = turned || opts[0][0]; continue; }
    const fam = household(st, s, p);
    for (const q of fam) movePerson(st, q, o[0], 'flucht');
    logMove(st, s, o[0], fam.length, 'flucht');
    dest.set(o[0], (dest.get(o[0]) || 0) + fam.length);
    n += fam.length; hh++;
  }
  const WHY = {
    krieg: L('vor dem Krieg', 'from the war'), hunger: L('vor dem Hunger', 'from the hunger'), seuche: L('vor der Seuche', 'from the sickness'),
    glaube: L('vor der Verfolgung', 'from persecution'), labor: L('aus ihrer Heimat', 'from their home'),
  };
  if (n >= 3) {
    const [o] = top(dest);
    chron(st, 'wanderung', L(`${n} Menschen fliehen ${WHY[why] || WHY.labor} aus ${s.name}. Die meisten finden Zuflucht in ${o.name}.`, `${n} people flee ${WHY[why] || WHY.labor} out of ${s.name}. Most find refuge in ${o.name}.`), o.id, 1);
  }
  if (turned && r.chance(0.5)) chron(st, 'wanderung', L(`${turned.name} schließt die Tore vor den Flüchtlingen aus ${s.name}.`, `${turned.name} shuts its gates to the refugees from ${s.name}.`), turned.id, 0);
  return n;
}

// Haken aus sea.js (eine Liebe über das Meer)
export function onMove(st, p, from, to) {
  arrive(st, p, to);
  logMove(st, from, to, 1, 'zuzug');
}

// Labor: n Menschen (Haushalte) von from nach to, als Flucht oder Zuzug. Gibt die Zahl der Umgezogenen zurück.
export function startMigration(st, from, to, n, { refugee = false } = {}) {
  const r = rng(st);
  const pool = r.shuffle(members(st, from).adults.filter(p => p.id !== from.gov.leader && !p.lt));
  let moved = 0;
  for (const p of pool) {
    if (moved >= n) break;
    if (p.s !== from.id) continue;
    const fam = household(st, from, p);
    for (const q of fam) movePerson(st, q, to, refugee ? 'flucht' : 'zuzug');
    moved += fam.length;
  }
  if (moved) logMove(st, from, to, moved, refugee ? 'flucht' : 'zuzug');
  return moved;
}
