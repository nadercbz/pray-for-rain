// Herkunft, Sprache, Anpassung und Viertel (seit 20.10.2026, Teil 2 aus PLAN_REGELWERK.md).
// Jeder Mensch hat eine Herkunft p.og (das Volk, von dem er abstammt, Liste st.origins), eine Muttersprache p.lg
// (Zahl wie s.lang), eine Einwanderergeneration p.mg (0 einheimisch, 1 eingewandert, 2 Kind von Eingewanderten) und
// eine Anpassung p.as (0 bis 1, nur bei Zugezogenen). Herkunft hängt an der Abstammung, nicht am Wohnort: Kinder
// erben sie, Siedler nehmen sie mit. Sprache wechselt über Generationen (Kinder lernen die Sprache der Mehrheit,
// nach Abrams und Strogatz wechselt ein Ort erst, wenn die alte Sprache kaum noch gesprochen wird).
// Viertel entstehen über die Wohnwahl (Schelling): wer ein Haus sucht, mag Nachbarn seiner Herkunft, Reiche wohnen
// lieber nah am Platz. Wie stark, hängt an der Toleranz des Ortes.
// Namen und Farben kommen aus Hashes, nicht aus dem Zufall der Simulation.
import { originClass } from './mobility.js';
import * as D from './data.js';
import { LANGS } from './names.js';
import { clamp } from './rng.js';
import { rng, members, ageOf, chron, bio, bldOf, homeCap } from './util.js';
import { NX } from './world.js';
import { L } from '../i18n.js';

const YEAR = D.DAYS_PER_YEAR;
export const OG_COLS = ['#e07a5f', '#5fa8d3', '#e9c46a', '#8ab17d', '#b388eb', '#f4a261', '#d4708f', '#6fb7a8', '#c9a227', '#8a9bd4', '#c46b4a', '#7fb3c9', '#a3b18a', '#e5989b'];
export const hash = (a, b = 0, c = 0) => { let h = (a * 374761393 + b * 668265263 + c * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const cap = w => w.charAt(0).toUpperCase() + w.slice(1);

// Volksname aus den Silben der Sprache (zum Beispiel Taziri, Lumiko, Bjokar)
function ethnonym(st, lang, salt) {
  const G = LANGS[lang % LANGS.length];
  const taken = new Set((st.origins || []).map(o => o.n));
  for (let k = 0; k < 12; k++) {
    const h1 = hash(st.seed || 1, lang * 31 + salt, k), h2 = hash(lang + 7, salt, k * 13 + 5), h3 = hash(salt + 3, k, lang);
    const end = G.m[Math.floor(h3 * G.m.length)];
    const n = cap((G.syl[Math.floor(h1 * G.syl.length)] + G.syl[Math.floor(h2 * G.syl.length)] + end).replace(/([aeiou])\1+/g, '$1'));
    if (!taken.has(n) && n.length >= 5 && !/[aeiou]{3}/.test(n)) return n;
  }
  return cap(G.syl[0] + G.syl[1]) + (taken.size + 1);
}

// ---------- Herkunft ----------

export function addOrigin(st, { name, lang = 0, col, home = 0, key } = {}) {
  st.origins = st.origins || [];
  const id = st.origins.reduce((m, o) => Math.max(m, o.id), 0) + 1;
  const o = { id, n: name || ethnonym(st, lang, id), lang, col: col || OG_COLS[(id - 1) % OG_COLS.length], home, d: st.day || 0 };
  if (key) o.key = key;
  st.origins.push(o);
  const rt = st._rt;
  if (rt && rt.ogById) { rt.ogById.set(o.id, o); if (key) rt.ogByKey.set(key, o); }
  if (rt && rt.onOrigin) rt.onOrigin(st, o); // faith.js: jedes Volk bekommt seinen Ahnenglauben
  return o;
}

// Schlüssel des Volkes, zu dem ein Ort gehört: in der Erde das Volk (s.isle), sonst die Sprache
export const originKey = (st, s) => (st.earth ? 'f' + s.isle : 'l' + s.lang);

export function originFor(st, key, lang, home) {
  const rt = st._rt;
  let o = rt.ogByKey.get(key);
  if (!o) o = addOrigin(st, { lang, home, key });
  return o;
}

// Hauptherkunft eines Ortes (die Mehrheit, beim Gründen die der Gründer)
export function mainOrigin(st, s) {
  if (s.og && st._rt.ogById.has(s.og)) return s.og;
  const o = originFor(st, originKey(st, s), s.lang, s.isle);
  s.og = o.id;
  return o.id;
}

// ---------- Zusammensetzung je Ort (alle 6 Tage frisch, von faith, migration, epidemic und UI genutzt) ----------

export function mix(st, s) {
  const rt = st._rt;
  if (!rt.mix || rt.mixDay !== st.day) { rt.mix = new Map(); rt.mixDay = st.day; }
  let m = rt.mix.get(s.id);
  if (m) return m;
  m = { n: 0, og: new Map(), rl: new Map(), lg: new Map(), mg: 0, cls: [0, 0, 0, 0, 0] };
  for (const p of members(st, s).all) {
    m.n++;
    m.og.set(p.og, (m.og.get(p.og) || 0) + 1);
    m.rl.set(p.rl || 0, (m.rl.get(p.rl || 0) || 0) + 1);
    m.lg.set(p.lg, (m.lg.get(p.lg) || 0) + 1);
    if (p.mg) m.mg++;
    m.cls[p.cls ?? 1]++;
  }
  rt.mix.set(s.id, m);
  return m;
}
export const top = map => { let k = null, v = -1; for (const [a, b] of map) if (b > v) { v = b; k = a; } return [k, v]; };

// ---------- Toleranz eines Ortes (0 bis 1): Kultur, Gesetze, Staatsform, Lehre des Staatsglaubens ----------

export function tolerance(st, s) {
  const c = s.cult;
  let t = 0.3 + c.freiheit * 0.45 + c.handel * 0.15 - c.tradition * 0.2 - c.macht * 0.1 + (s.era || 0) * 0.025;
  const has = l => s.laws.includes(l);
  if (has('toleranz')) t += 0.25;
  if (has('staatskirche')) t -= 0.25;
  if (has('abschottung')) t -= 0.15;
  if (has('gastrecht')) t += 0.1;
  const g = s.gov.type;
  if (g === 'theokratie') t -= 0.15; else if (g === 'diktatur') t -= 0.1; else if (g === 'demokratie' || g === 'republik') t += 0.05;
  const f = s.srel && st._rt.fById && st._rt.fById.get(s.srel);
  if (f && f.ten) t += (f.ten.tol - 0.5) * 0.3;
  return clamp(t, 0, 1);
}

// ---------- Neue Menschen (Haken aus makePerson in util.js) ----------

// Kinder: Herkunft vom Elternteil mit dem höheren Stand (gleich: vom Vater), Muttersprache von der Mutter,
// Glaube vom Elternteil mit dem höheren Stand (faith.js setzt rl), Kinder von Eingewanderten sind Generation 2.
// Ohne Eltern (Gestrandete, Wanderer, neue Welt): Herkunft nach Sprache oder Volk des Ortes.
export function personHook(st, s, p, mo, fa, lang) {
  if (mo || fa) {
    const up = mo && fa ? ((mo.cls ?? 1) > (fa.cls ?? 1) ? mo : fa) : (fa || mo);
    p.og = up.og ?? (mo || fa).og;
    if (mo && fa && mo.og !== fa.og) p.mx = 1;
    p.lg = (mo && mo.lg != null ? mo.lg : fa.lg) ?? s.lang;
    p.oc = originClass(mo, fa); // Herkunftsschicht (mobility.js)
    const mg = Math.max(mo ? mo.mg || 0 : 0, fa ? fa.mg || 0 : 0);
    if (mg === 1) { p.mg = 2; p.as = Math.round(((mo ? mo.as || 0 : 0) + (fa ? fa.as || 0 : 0)) / (mo && fa ? 2 : 1) * 50 + 30) / 100; }
  } else {
    const l = lang ?? s.lang;
    const key = !st.earth && l !== s.lang ? 'l' + l : originKey(st, s);
    const o = (st._rt.forceOg && st._rt.ogById.get(st._rt.forceOg)) || originFor(st, key, l, s.isle);
    p.og = o.id;
    p.lg = l;
    if (o.id !== mainOrigin(st, s)) { p.mg = 1; p.as = 0; }
  }
  if (st._rt.onPersonFaith) st._rt.onPersonFaith(st, s, p, mo, fa);
}

// Umzug in einen anderen Ort (migration.js, sea.js): wer zu Fremden zieht, ist dort eingewandert
export function arrive(st, p, to) {
  const main = mainOrigin(st, to);
  if (p.og !== main && !p.mg) { p.mg = 1; p.as = 0; p.foreign = true; }
  else if (p.og === main && p.mg === 1 && p.lg === to.lang) { p.mg = 0; delete p.as; }
}

// ---------- Jahreslauf: Sprache, Anpassung, Mehrheit, Ortssprache ----------

export function peoplesYear(st) {
  const r = rng(st), rt = st._rt;
  const tolOf = new Map();
  for (const s of st.settlements) {
    if (!s.alive || !s.pop) continue;
    const m = mix(st, s), n = Math.max(1, m.n);
    const [mainOg, mainN] = top(m.og);
    if (mainOg != null && mainN / n > 0.5) s.og = mainOg; else mainOrigin(st, s);
    const [lg, lgN] = top(m.lg);
    const tol = tolerance(st, s);
    tolOf.set(s.id, tol);
    const share = l => (m.lg.get(l) || 0) / n;
    // Ortssprache: nur wenn die alte kaum noch gesprochen wird und eine andere die Mehrheit hat (zwei Jahre in Folge)
    if (lg != null && lg !== s.lang && share(s.lang) < 0.3 && lgN / n > 0.5) {
      s.lgTurn = (s.lgTurn || 0) + 1;
      if (s.lgTurn >= 2) {
        const o = st.origins.find(x => x.lang === lg);
        s.lang = lg; s.lgTurn = 0;
        chron(st, 'fremde', L(`In ${s.name} spricht man jetzt ${o ? 'die Sprache der ' + o.n : 'eine neue Sprache'}. Die alten Worte hört man nur noch bei den Alten.`, `In ${s.name} people now speak ${o ? 'the language of the ' + o.n : 'a new language'}. The old words are heard only among the elders.`), s.id, 1);
      }
    } else s.lgTurn = 0;
    const local = s.lang;
    for (const p of members(st, s).all) {
      const a = ageOf(st, p);
      // Kinder lernen die Sprache des Ortes in Schule und Gasse, je mehr sie sprechen, desto schneller
      if (p.lg !== local) {
        if (a < 14) { if (r.chance(0.08 + share(local) * 0.25)) p.lg = local; }
        else if (a < 30 && p.mg === 2 && r.chance(0.04 + share(local) * 0.08)) p.lg = local;
      }
      // Anpassung der Zugezogenen: Freunde im Ort, Bürgerrecht, Toleranz; eigene Viertel bremsen
      if (p.mg) {
        let fr = 0;
        for (const k in p.ties) { if (p.ties[k] > 30) { const q = rt.pById.get(+k); if (q && q.og !== p.og) fr++; } }
        const gain = 0.03 + Math.min(0.06, fr * 0.02) + tol * 0.04 + (s.laws.includes('einbuergerung') ? 0.04 : 0) - (p.ghetto ? 0.03 : 0);
        p.as = clamp((p.as || 0) + gain, 0, 1);
        if (p.mg === 2 && p.as > 0.92 && p.lg === local) { p.mg = 0; delete p.as; delete p.ghetto; }
      }
    }
  }
  rt.tolOf = tolOf;
}

// ---------- Viertel ----------

// Anteil der Herkunft og unter den Nachbarn eines Hauses (Häuser im Umkreis 2, ohne das Haus selbst)
function hoodShare(st, h, og, occ) {
  const rt = st._rt;
  let same = 0, all = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    if (!dx && !dy) continue;
    const id = rt.bldAt[(h.y + dy) * NX + h.x + dx];
    if (!id) continue;
    const o = occ.get(id);
    if (!o) continue;
    all += o.n; same += o.og.get(og) || 0;
  }
  return all ? same / all : -1;
}

// Bewohner je Haus eines Ortes (einmal je Ort und Tag)
function occupancy(st, s) {
  const rt = st._rt;
  if (!rt.occ || rt.occDay !== st.day) { rt.occ = new Map(); rt.occDay = st.day; }
  let m = rt.occ.get(s.id);
  if (m) return m;
  m = new Map();
  for (const p of members(st, s).all) {
    if (p.home <= 0) continue;
    let o = m.get(p.home);
    if (!o) m.set(p.home, o = { n: 0, og: new Map() });
    o.n++; o.og.set(p.og, (o.og.get(p.og) || 0) + 1);
  }
  rt.occ.set(s.id, m);
  return m;
}

// Wohnwahl für Wohnungslose (Haken aus housing in core.js). houses: Häuser des Ortes, free(h): freie Plätze.
// Nutzen = freie Plätze + Passung der Nachbarn (Schwelle t = 0,5 mal 1 minus Toleranz) + Nähe zur Arbeit,
// Reiche lieber nah am Platz, Arme am Rand. Gibt null zurück, wenn der Ort nur eine Herkunft hat (alter Weg).
export function pickHome(st, s, p, houses, free) {
  const m = mix(st, s);
  if (m.og.size < 2 && (p.cls ?? 1) < 3) return null;
  const rt = st._rt;
  const occ = occupancy(st, s);
  const tol = rt.tolOf ? rt.tolOf.get(s.id) ?? 0.5 : 0.5;
  const t = Math.max(0.05, 0.5 * (1 - tol));
  const work = p.w > 0 ? rt.bById.get(p.w) : null;
  let best = null, bs = -1e9;
  for (const h of houses) {
    const f = free(h);
    if (f <= 0) continue;
    const sh = hoodShare(st, h, p.og, occ);
    let sc = f * 0.12 + (sh < 0 ? 0.5 : Math.min(1, sh / t)) * 1.2;
    if (work) sc -= Math.hypot(work.x - h.x, work.y - h.y) * 0.06;
    const dc = Math.hypot(h.x - s.cx, h.y - s.cy) / Math.max(3, s.R);
    if ((p.cls ?? 1) >= 3) sc -= dc * 0.8; else if ((p.cls ?? 1) === 0) sc += dc * 0.25;
    sc += hash(h.id, p.id) * 0.15;
    if (sc > bs) { bs = sc; best = h; }
  }
  if (best) {
    const o = occ.get(best.id) || { n: 0, og: new Map() };
    o.n++; o.og.set(p.og, (o.og.get(p.og) || 0) + 1); occ.set(best.id, o);
  }
  return best;
}

// Alle 12 Tage: höchstens zwei Haushalte je Ort ziehen um, wenn sie unter den Nachbarn kaum Ihresgleichen haben
// und es anderswo im Ort passt (Schelling). p.ghetto markiert, wer in einem Viertel seiner Herkunft lebt.
export function quarterStep(st) {
  const r = rng(st), rt = st._rt;
  for (const s of st.settlements) {
    if (!s.alive || s.pop < 20) continue;
    const m = mix(st, s);
    if (m.og.size < 2) continue;
    const [, mainN] = top(m.og);
    if (mainN / m.n > 0.97) continue;
    const occ = occupancy(st, s);
    const tol = rt.tolOf ? rt.tolOf.get(s.id) ?? 0.5 : 0.5;
    const t = Math.max(0.05, 0.5 * (1 - tol));
    const houses = bldOf(st, s).filter(b => b.prog >= 1 && D.BUILDINGS[b.t].home);
    const M = members(st, s).adults.filter(p => p.home > 0 && (p.og !== s.og || p.mg));
    let moves = 0;
    for (const p of r.shuffle(M.slice()).slice(0, 6)) {
      if (moves >= 2) break;
      const home = rt.bById.get(p.home);
      if (!home) continue;
      const sh = hoodShare(st, home, p.og, occ);
      p.ghetto = sh > 0.6 ? 1 : undefined;
      if (sh < 0 || sh >= t) continue;
      const fam = members(st, s).all.filter(q => q.home === p.home && (q === p || q.id === p.pa || q.mo === p.id || q.fa === p.id));
      let best = null, bs = sh;
      for (const h of houses) {
        if (h.id === p.home) continue;
        const o = occ.get(h.id);
        if (homeCap(st, h) - (o ? o.n : 0) < fam.length) continue;
        const s2 = hoodShare(st, h, p.og, occ);
        if (s2 > bs + 0.15) { bs = s2; best = h; }
      }
      if (!best) continue;
      const from = occ.get(p.home);
      for (const q of fam) {
        q.home = best.id;
        if (from) { from.n--; from.og.set(q.og, (from.og.get(q.og) || 1) - 1); }
        let o = occ.get(best.id); if (!o) occ.set(best.id, o = { n: 0, og: new Map() });
        o.n++; o.og.set(q.og, (o.og.get(q.og) || 0) + 1);
      }
      if (fam.length) bio(p, st.day, L('zieht in ein Viertel zu Menschen der eigenen Herkunft', 'moves to a quarter among people of the same origin'));
      moves++;
    }
  }
}

// Wie getrennt leben zwei Gruppen? Dissimilaritätsindex über Nachbarschaften (Zellen 4x4), 0 gemischt, 1 getrennt
export function segregation(st, s) {
  const rt = st._rt, occ = occupancy(st, s), m = mix(st, s);
  const [main] = top(m.og);
  const cells = new Map();
  for (const [hid, o] of occ) {
    const h = rt.bById.get(hid);
    if (!h) continue;
    const k = ((h.x >> 2) << 16) | (h.y >> 2);
    let c = cells.get(k); if (!c) cells.set(k, c = [0, 0]);
    const a = o.og.get(main) || 0;
    c[0] += a; c[1] += o.n - a;
  }
  let A = 0, B = 0;
  for (const c of cells.values()) { A += c[0]; B += c[1]; }
  if (!A || !B) return 0;
  let d = 0;
  for (const c of cells.values()) d += Math.abs(c[0] / A - c[1] / B);
  return d / 2;
}
