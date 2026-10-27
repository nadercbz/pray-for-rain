// Seuchen (seit 20.10.2026, Teil 2 aus PLAN_REGELWERK.md). SEIR je Ort mit echten Menschen, Tagesschritt.
// p.dz = Krankheit (Id aus st.diseases), p.dt < 0: angesteckt, noch nicht ansteckend (zählt hoch bis 0),
// p.dt > 0: krank und ansteckend (zählt herunter), danach Tod mit der Letalität oder Genesung mit Immunität
// (p.im = { Id: bis Tag, -1 lebenslang }). p.sick bleibt die Krankheitsdauer, damit Gebete, Heiler, Tagesplan und
// Innenansicht weiter stimmen. Wer krank ist und dessen p.sick plötzlich 0 ist, wurde geheilt (Kraft Heilung).
// Ansteckung: λ = β · (0,65 · (I − I_Haus)/N + 0,35 · I_Haus/(N_Haus − 1)), β = R0 / infektiöse Tage. So bleibt R0 die
// Zahl der Angesteckten je Krankem, ein Mitbewohner trägt aber ein Vielfaches des Risikos. Dazu Übertragungsweg
// (Luft, Wasser, Ratten, Mücken), Jahreszeit, Enge, Brunnen, Heiler, Quarantäne, Impfung. Zwischen Orten über
// Straßen, Nachbarschaft, Handel über das Meer und Krieg. Beim Sprung in einen neuen Ort kann die Seuche mutieren
// (p 0,02, neuer Stamm, alte Immunität schützt nur zur Hälfte). Erstkontakt eines Volkes: doppelte Letalität.
// Tage sind gestaucht: ein Jahr hat nur 24 Spieltage, darum zählen Krankheitstage ein Drittel (TS).
import * as D from './data.js';
import { clamp } from './rng.js';
import { rng, members, ageOf, chron, sameLand, isleOf, knows, bldOf } from './util.js';
import { netRoad } from './roads.js';
import { idx } from './world.js';
import { mix, top, tolerance } from './peoples.js';
import { L } from '../i18n.js';

const YEAR = D.DAYS_PER_YEAR;
export const TS = 1 / 3;
const gd = x => Math.max(1, Math.round(x * TS));

// Vorlagen in echten Tagen (Recherche 20.10.2026: WHO, Lehrbuchwerte, historische Rekonstruktionen, große Streuung)
// way: luft, wasser (Brunnen, Flüsse), ratten (Speicher, Häfen, Sommer), muecken (Sumpf, Regenwald, Sommer)
// imm: Immunität in Jahren, -1 lebenslang, 0 nur ein halbes Jahr Schonzeit (sonst steckt man sich sofort wieder an und
// eine Seuche ohne Immunität rafft alle dahin). kids: trifft vor allem Kinder
export const PRESETS = {
  beulenpest: { n: L('Beulenpest', 'Bubonic Plague'), r0: 1.7, inc: 5, inf: 6, cfr: 0.45, way: 'ratten', imm: 2, col: '#5b4a3f' },
  lungenpest: { n: L('Lungenpest', 'Pneumonic Plague'), r0: 2.2, inc: 3, inf: 3, cfr: 0.85, way: 'luft', imm: 1, col: '#3d3a4f' },
  pocken: { n: L('Pocken', 'Smallpox'), r0: 4.5, inc: 12, inf: 14, cfr: 0.3, way: 'luft', imm: -1, col: '#b5654a' },
  cholera: { n: L('Cholera', 'Cholera'), r0: 2.2, inc: 2, inf: 5, cfr: 0.35, way: 'wasser', imm: 3, col: '#4f8a8b' },
  grippe: { n: L('Grippe', 'Influenza'), r0: 1.8, inc: 2, inf: 4, cfr: 0.02, way: 'luft', imm: 1, col: '#8a9bd4' },
  masern: { n: L('Masern', 'Measles'), r0: 12, inc: 11, inf: 8, cfr: 0.05, way: 'luft', imm: -1, kids: 1, col: '#d4708f' },
  fieber: { n: L('Fieber', 'Fever'), r0: 0.5, inc: 3, inf: 21, cfr: 0.02, way: 'muecken', imm: 1, col: '#e9c46a' },
};

const dOf = (st, id) => st._rt.dzById.get(id);
export function dzName(d) {
  if (!d) return '';
  if (d.n) return d.n;
  const P = PRESETS[d.k];
  return (P ? P.n : L('Seuche', 'Plague')) + (d.gen ? ' ' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[(d.gen - 1) % 26] : '');
}
export const dzCol = d => (d && (d.col || (PRESETS[d.k] && PRESETS[d.k].col))) || '#c46b4a';

// Neue Krankheit (Vorlage oder eigene Werte in echten Tagen: { n, r0, inc, inf, cfr, way, imm })
export function newDisease(st, s, def, extra = {}) {
  st.diseases = st.diseases || [];
  const P = typeof def === 'string' ? PRESETS[def] : def;
  const k = typeof def === 'string' ? def : def.k || 'eigen';
  const id = st.diseases.reduce((m, d) => Math.max(m, d.id), 0) + 1;
  const d = {
    id, k, r0: Math.round((P.r0 ?? 2) * 100) / 100, inc: gd(P.inc ?? 4), inf: gd(P.inf ?? 6), cfr: Math.round(clamp(P.cfr ?? 0.2, 0, 1) * 1000) / 1000,
    way: P.way || 'luft', imm: P.imm ?? 0, d: st.day, s: s ? s.id : 0, from: 0, gen: 0, cases: 0, dead: 0, peak: 0,
  };
  if (typeof def !== 'string' && P.n) d.n = P.n;
  if (P.kids) d.kids = 1;
  Object.assign(d, extra);
  st.diseases.push(d);
  st._rt.dzById.set(d.id, d);
  // alte, beendete Einträge ausdünnen (das Fieber bleibt)
  if (st.diseases.length > 60) {
    const old = st.diseases.find(x => x.end && x.k !== 'fieber');
    if (old) { st.diseases.splice(st.diseases.indexOf(old), 1); st._rt.dzById.delete(old.id); }
  }
  return d;
}

// Schutz eines Menschen gegen d: 1 immun, 0,5 gegen einen anderen Stamm derselben Art, 0 nichts
function protection(st, p, d) {
  if (!p.im) return 0;
  let best = 0;
  for (const k in p.im) {
    const v = p.im[k];
    if (v !== -1 && v < st.day) continue;
    if (+k === d.id) return 1;
    const o = dOf(st, +k);
    if (o && o.k === d.k) best = 0.5;
  }
  return best;
}

function expose(st, p, d, sick = false) {
  p.dz = d.id;
  // erste Fälle von außen: einen Tag länger, weil der Tageslauf zuerst herunterzählt (sonst wäre die Grippe nie ansteckend)
  if (sick) { p.dt = d.inf + 1; p.sick = d.inf + 2; d.cases++; } else p.dt = -d.inc;
  st._rt.dzLive = (st._rt.dzLive || 0) + 1;
}

// Erste Fälle in einem Ort: count Menschen sofort krank
export function seedCases(st, s, d, count) {
  const r = rng(st);
  const pool = r.shuffle(members(st, s).all.filter(p => !p.dz && protection(st, p, d) < 1));
  let n = 0;
  for (const p of pool) { if (n >= count) break; expose(st, p, d, true); n++; }
  firstContact(st, s, d);
  return n;
}

// Seuche starten (Labor, natürliches Auftreten): share der Menschen oder count Fälle
export function startEpidemic(st, s, def, { share = 0.02, count, quiet } = {}) {
  const d = newDisease(st, s, def);
  const n = seedCases(st, s, d, count ?? Math.max(1, Math.round(s.pop * share)));
  if (!quiet) chron(st, 'seuche', L(`In ${s.name} bricht ${dzName(d)} aus. ${n} Menschen liegen krank, und die Seuche sucht weitere.`, `${dzName(d)} breaks out in ${s.name}. ${n} ${n === 1 ? 'person lies' : 'people lie'} sick, and the sickness is looking for more.`), s.id, 1);
  return d;
}

// Haken aus outbreak in society.js: das alte Fieber geht im Modell auf (ein dauerhafter Eintrag je Welt)
export function seedFever(st, s, share) {
  const r = rng(st);
  let d = st.diseases.find(x => x.k === 'fieber' && x.endemic);
  if (!d) d = newDisease(st, null, 'fieber', { endemic: 1 });
  let n = 0;
  for (const p of members(st, s).all) if (!p.dz && r.chance(share) && protection(st, p, d) < 1) { expose(st, p, d, true); p.hp = Math.max(0, p.hp - 0.1); n++; }
  return n;
}

// Erstkontakt: das Volk (Insel, in der Erde das Volk) kennt diese Art noch nicht, und sie kommt von einem anderen Volk
// (foreign). Dann ist die erste Welle drei Jahre lang doppelt tödlich (I.dzv).
function firstContact(st, s, d, foreign) {
  const I = isleOf(st, s);
  if (!I || d.k === 'fieber') return false;
  I.dzk = I.dzk || {};
  if (I.dzk[d.k] == null) {
    I.dzk[d.k] = st.day;
    if (foreign) { I.dzv = I.dzv || {}; I.dzv[d.k] = st.day; }
  }
  return !!(I.dzv && I.dzv[d.k] != null && st.day - I.dzv[d.k] < 3 * YEAR);
}

// ---------- Wirkfaktoren ----------

function wayMul(st, s, d, season) {
  const bio = D.BIOMES[st.tiles.bio[idx(s.cx, s.cy)]] || D.BIOMES[0];
  let m = 1;
  const crowd = clamp((s.pop || 1) / Math.max(1, s.homeCap || s.pop || 1), 0.95, 1.4);
  if (d.way === 'luft') { m *= crowd; if (d.k === 'grippe') m *= season === 3 ? 1.4 : season === 1 ? 0.6 : 1; }
  else if (d.way === 'wasser') { m *= (s.counts && s.counts.wells ? 0.65 : 1) * (s.pop > 150 ? 1.2 : 1) * (s.era >= 7 ? 0.3 : 1); }
  else if (d.way === 'ratten') { m *= (season === 1 ? 1.3 : season === 3 ? 0.7 : 1) * (s.era >= 6 ? 0.5 : 1) * (bldOf(st, s).some(b => b.t === 'speicher' || b.t === 'hafen') ? 1.15 : 1); }
  else if (d.way === 'muecken') { m *= bio.sick * (season === 1 ? 1.4 : season === 3 ? 0.4 : 1); }
  if (s.quar > st.day || s.laws.includes('quarantaene')) m *= 0.6;
  if (knows(st, 'medizin', s)) m *= 0.9;
  return m;
}

function careMul(st, s) {
  const pop = Math.max(1, s.pop);
  const healers = (s.counts && s.counts.healers) || 0;
  const hosp = bldOf(st, s).some(b => b.t === 'krankenhaus' && b.prog >= 1) ? 0.2 : 0;
  return 1 - Math.min(0.5, healers / pop * 6 + hosp + (knows(st, 'medizin', s) ? 0.1 : 0) + (s.era >= 7 ? 0.2 : 0));
}

// ---------- Tageslauf ----------

export function epidemicStep(st, season) {
  const rt = st._rt;
  if (!rt.dzLive) {
    if (rt.dzWas) { for (const s of st.settlements) s.sickShare = 0; rt.dzWas = 0; }
    return;
  }
  rt.dzWas = 1;
  const r = rng(st);
  // 1. Verlauf: angesteckt, krank, Tod oder Genesung. Zählt Kranke je Ort, Krankheit und Haus
  const S = new Map();
  let live = 0;
  const totI = new Map(), liveBy = new Map();
  for (const p of st.people) {
    if (!p.dz) continue;
    const d = dOf(st, p.dz);
    if (!d) { delete p.dz; delete p.dt; continue; }
    if (p.dt < 0) {
      p.dt++;
      if (p.dt < 0) { live++; liveBy.set(d.id, (liveBy.get(d.id) || 0) + 1); continue; }
      p.dt = d.inf; p.sick = d.inf + 1; d.cases++;
    } else {
      if (!p.sick) { recover(st, p, d); continue; } // von der Kraft Heilung geheilt
      p.dt--;
      if (p.dt <= 0) { resolve(st, p, d, r); continue; }
      p.sick = p.dt + 1;
    }
    live++;
    liveBy.set(d.id, (liveBy.get(d.id) || 0) + 1);
    let e = S.get(p.s);
    if (!e) S.set(p.s, e = new Map());
    let c = e.get(d.id);
    if (!c) e.set(d.id, c = { I: 0, home: new Map() });
    c.I++;
    if (p.home > 0) c.home.set(p.home, (c.home.get(p.home) || 0) + 1);
    totI.set(d.id, (totI.get(d.id) || 0) + 1);
  }
  rt.dzLive = live;
  for (const s of st.settlements) s.sickShare = 0;
  // 2. Ansteckung im Ort
  for (const [sid, e] of S) {
    const s = rt.sById.get(sid);
    if (!s || !s.alive) continue;
    const M = members(st, s).all, N = Math.max(1, M.length);
    let homeN = null;
    let Itot = 0;
    for (const [did, c] of e) {
      const d = dOf(st, did);
      Itot += c.I;
      const beta = d.r0 / d.inf * wayMul(st, s, d, season);
      if (!homeN) { homeN = new Map(); for (const p of M) if (p.home > 0) homeN.set(p.home, (homeN.get(p.home) || 0) + 1); }
      const vacc = (d.k === 'pocken' || d.k === 'masern') && knows(st, 'impfung', s) ? 0.2 : 1;
      for (const p of M) {
        if (p.dz) continue;
        const Ih = p.home > 0 ? c.home.get(p.home) || 0 : 0;
        const lam = beta * (0.65 * (c.I - Ih) / N + (Ih ? 0.35 * Ih / Math.max(1, (homeN.get(p.home) || 1) - 1) : 0));
        if (lam <= 0) continue;
        let q = (1 - Math.exp(-lam)) * vacc;
        if (d.kids && ageOf(st, p) >= 14) q *= 0.35;
        if (q < 1e-5) continue;
        const pr = protection(st, p, d);
        if (pr >= 1) continue;
        if (r.chance(q * (1 - pr))) expose(st, p, d);
      }
    }
    s.sickShare = Itot / N;
    // Quarantäne als Antwort: ab der Bronzezeit oder mit Heilkunde, nicht beim Fieber
    const serious = [...e.keys()].some(id => dOf(st, id).k !== 'fieber');
    if (serious && s.sickShare > 0.04 && !(s.quar > st.day) && (s.era >= 2 || knows(st, 'medizin', s)) && r.chance(0.25)) {
      s.quar = st.day + YEAR;
      chron(st, 'seuche', L(`${s.name} schließt die Tore. Niemand darf hinein oder hinaus, bis die Seuche vorüber ist.`, `${s.name} closes its gates. No one may enter or leave until the sickness has passed.`), s.id, 0);
    } else if (serious && s.quar > st.day) s.quar = Math.max(s.quar, st.day + 6);
  }
  // 3. Sprung in andere Orte
  for (const [sid, e] of S) {
    const s = rt.sById.get(sid);
    if (!s || !s.alive) continue;
    const N = Math.max(1, s.pop);
    for (const [did, c] of e) {
      const d = dOf(st, did);
      if (d.k === 'fieber' && d.endemic) continue; // das Fieber kommt aus dem Land selbst (eventsStep)
      const pi = c.I / N;
      for (const [o, tau] of partners(st, s)) {
        if (o.sickCase && o.sickCase[d.k] === st.day) continue;
        let rate = pi * tau * 2 * (s.quar > st.day ? 0.15 : 1) * (o.quar > st.day ? 0.3 : 1);
        if (rate <= 0 || !r.chance(1 - Math.exp(-rate))) continue;
        jump(st, s, o, d, r);
      }
    }
  }
  // 4. Ende einer Seuche
  for (const d of st.diseases) {
    if (d.end || d.endemic) continue;
    const I = totI.get(d.id) || 0;
    if (I > d.peak) d.peak = I;
    if (!liveBy.get(d.id)) {
      d.end = st.day;
      if (d.dead >= 5) chron(st, 'seuche', L(`${dzName(d)} ist vorüber. Sie hat ${d.dead} Menschen genommen. Die Lebenden zählen die leeren Betten.`, `${dzName(d)} has passed. It took ${d.dead} lives. The living count the empty beds.`), d.s || -1, 1);
    }
  }
}

// Wer mit wem in Kontakt ist (je Ort und Tag zwischengespeichert)
function partners(st, s) {
  const rt = st._rt;
  if (!rt.dzNb || rt.dzNbDay !== st.day) { rt.dzNb = new Map(); rt.dzNbDay = st.day; }
  let out = rt.dzNb.get(s.id);
  if (out) return out;
  out = [];
  for (const o of st.settlements) {
    if (!o.alive || o === s || !o.pop) continue;
    const d = Math.hypot(o.cx - s.cx, o.cy - s.cy);
    let tau = 0;
    if (sameLand(st, s, o) && d < 60) tau = netRoad(st, s.id, o.id) ? 0.4 / (1 + d / 25) : 0.15 / (1 + d / 15);
    if (s.war === o.id) tau = Math.max(tau, 0.3);
    out.push([o, tau]);
  }
  for (const x of st.routes || []) {
    if (!x.sea || (x.a !== s.id && x.b !== s.id)) continue;
    const o = rt.sById.get(x.a === s.id ? x.b : x.a);
    if (!o || !o.alive) continue;
    const e = out.find(y => y[0] === o);
    const tau = 0.25 + Math.min(0.3, (x.val || 0) / 400);
    if (e) e[1] = Math.max(e[1], tau); else out.push([o, tau]);
  }
  rt.dzNb.set(s.id, out.filter(e => e[1] > 0.005));
  return rt.dzNb.get(s.id);
}

function jump(st, s, o, d0, r) {
  let d = d0;
  const had = st.people.some(p => p.s === o.id && p.dz && dOf(st, p.dz)?.k === d0.k);
  if (had) return;
  o.sickCase = o.sickCase || {};
  o.sickCase[d0.k] = st.day;
  // Mutation beim Sprung in einen neuen Ort
  if (r.chance(0.02)) {
    d = newDisease(st, o, { r0: d0.r0 * r.range(0.85, 1.2), inc: d0.inc / TS, inf: d0.inf / TS, cfr: d0.cfr * r.range(0.7, 1.3), way: d0.way, imm: d0.imm, k: d0.k }, { from: d0.id, gen: (d0.gen || 0) + 1, k: d0.k, ...(d0.kids ? { kids: 1 } : {}), ...(d0.n ? { n: d0.n + ' ' + L('neu', 'new') } : {}) });
    d.inc = d0.inc; d.inf = d0.inf;
    chron(st, 'seuche', L(`In ${o.name} verändert sich ${dzName(d0)}. Wer sie schon hatte, ist nicht mehr sicher.`, `In ${o.name}, ${dzName(d0)} changes. Those who already had it are no longer safe.`), o.id, 1);
  }
  const pool = members(st, o).adults.filter(p => !p.dz && protection(st, p, d) < 1);
  if (!pool.length) return;
  expose(st, r.pick(pool), d);
  const virgin = firstContact(st, o, d, isleOf(st, o) !== isleOf(st, s));
  const sea = !sameLand(st, s, o);
  if (d.k !== 'fieber') chron(st, 'seuche', sea
    ? L(`Ein Schiff aus ${s.name} bringt ${dzName(d)} nach ${o.name}.${virgin ? ' Hier kennt niemand diese Seuche.' : ''}`, `A ship from ${s.name} brings ${dzName(d)} to ${o.name}.${virgin ? ' No one here knows this sickness.' : ''}`)
    : L(`Reisende aus ${s.name} tragen ${dzName(d)} nach ${o.name}.${virgin ? ' Hier kennt niemand diese Seuche.' : ''}`, `Travelers from ${s.name} carry ${dzName(d)} to ${o.name}.${virgin ? ' No one here knows this sickness.' : ''}`), o.id, virgin ? 1 : 0);
}

function recover(st, p, d) {
  p.im = p.im || {};
  p.im[d.id] = d.imm === -1 ? -1 : st.day + Math.round(Math.max(0.5, d.imm) * YEAR);
  delete p.dz; delete p.dt;
  p.sick = 0;
}

function resolve(st, p, d, r) {
  const s = st._rt.sById.get(p.s);
  const a = ageOf(st, p);
  let q = d.cfr * (a < 5 ? 1.5 : a > 60 ? 1.6 : a < 14 ? 0.8 : 0.85) * (1.4 - (p.hp ?? 1) * 0.4);
  if (s) {
    q *= careMul(st, s) * ((s.hunger || 0) > 0.3 ? 1.3 : 1);
    const I = isleOf(st, s);
    if (I && I.dzv && I.dzv[d.k] != null && st.day - I.dzv[d.k] < 3 * YEAR) q *= 2;
  }
  if (r.chance(Math.min(0.97, q))) {
    p.dzDie = 'Seuche';
    d.dead++;
    if (s) s.dzDead = (s.dzDead || 0) + 1;
    delete p.dz; delete p.dt;
    return;
  }
  recover(st, p, d);
}

// ---------- alle 6 Tage: Sündenböcke ----------

export function blameStep(st) {
  const r = rng(st), rt = st._rt;
  for (const s of st.settlements) {
    if (!s.alive || (s.sickShare || 0) < 0.03 || (s.dzDead || 0) < Math.max(3, s.pop * 0.03)) continue;
    if (st.day - (s.blameAt || -9999) < 5 * YEAR || tolerance(st, s) > 0.45) continue;
    if (!r.chance(0.15)) continue;
    const m = mix(st, s), n = Math.max(1, m.n);
    const [mainOg] = top(m.og), [mainRl] = top(m.rl);
    let pred = null, who = null;
    const ogMin = [...m.og].filter(([k, c]) => k !== mainOg && c / n > 0.03 && c / n < 0.35).sort((a, b) => b[1] - a[1])[0];
    const rlMin = [...m.rl].filter(([k, c]) => k && k !== mainRl && c / n > 0.03 && c / n < 0.35).sort((a, b) => b[1] - a[1])[0];
    if (ogMin) { const o = rt.ogById.get(ogMin[0]); pred = p => p.og === ogMin[0]; who = o ? L(`die ${o.n}`, `the ${o.n}`) : L('die Fremden', 'the strangers'); }
    else if (rlMin) { const f = rt.fById.get(rlMin[0]); pred = p => p.rl === rlMin[0]; who = f ? L(`die Anhänger von ${f.n}`, `the followers of ${f.n}`) : L('die Andersgläubigen', 'those of other faiths'); }
    if (!pred) continue;
    s.blameAt = st.day;
    s.unrest = clamp(s.unrest + 0.08, 0, 1);
    const vict = members(st, s).all.filter(pred);
    for (const p of vict) p.hap = clamp(p.hap - 0.1, 0, 1);
    const dead = r.chance(0.3) ? Math.min(vict.length, r.int(1, 3)) : 0;
    for (let i = 0; i < dead; i++) vict[i].dzDie = 'Verfolgung';
    if (rt.flee) rt.flee(st, s, pred, 'glaube');
    st.counts.blame = (st.counts.blame || 0) + 1;
    chron(st, 'seuche', L(`In ${s.name} sucht man Schuldige für die Seuche und findet ${who}. ${dead ? `${dead} von ihnen werden erschlagen, ` : ''}viele fliehen in der Nacht.`, `In ${s.name} people look for someone to blame for the sickness and find ${who}. ${dead ? `${dead} of them are killed, ` : ''}many flee in the night.`), s.id, 1);
  }
}

// ---------- jährlich: neue Seuchen aus der Welt, alte Immunität verfällt ----------

export function epidemicYear(st) {
  const r = rng(st);
  const alive = st.settlements.filter(s => s.alive && s.pop > 0);
  if (!alive.length) return;
  for (const p of st.people) if (p.im) { for (const k in p.im) if (p.im[k] !== -1 && p.im[k] < st.day) delete p.im[k]; if (!Object.keys(p.im).length) delete p.im; }
  for (const s of alive) s.dzDead = Math.floor((s.dzDead || 0) * 0.3);
  const running = st.diseases.filter(d => !d.end && !d.endemic).length;
  if (running >= 2) return;
  const pop = st.people.length, era = Math.max(...alive.map(s => s.era || 0));
  const big = alive.slice().sort((a, b) => b.pop - a.pop);
  const harbor = alive.filter(s => bldOf(st, s).some(b => b.t === 'hafen' && b.prog >= 1));
  const pickBy = arr => { let tot = 0; for (const s of arr) tot += s.pop; let x = r.next() * tot; for (const s of arr) { x -= s.pop; if (x <= 0) return s; } return arr[0]; };
  const tries = [
    ['grippe', era >= 3 && pop > 250 ? 0.025 : 0, alive],
    ['pocken', era >= 1 && big[0].pop > 120 ? 0.0025 : 0, big.slice(0, 4)],
    ['beulenpest', era >= 2 && harbor.length ? 0.0012 : 0, harbor],
    ['cholera', era >= 5 && big[0].pop > 180 ? 0.005 : 0, big.slice(0, 3)],
    ['masern', era >= 2 && pop > 300 ? 0.0025 : 0, alive],
  ];
  for (const [k, p, arr] of tries) {
    if (!p || !arr.length || !r.chance(p * ((st.char && st.char.wild) || 1))) continue;
    const s = pickBy(arr);
    startEpidemic(st, s, k, { count: Math.max(3, Math.round(s.pop * 0.02)) });
    return;
  }
}

// Wie viele Menschen sind gerade in welchem Zustand (für Labor und Inselbuch)
export function seirCounts(st) {
  let E = 0, I = 0, R = 0;
  for (const p of st.people) {
    if (p.dz) { if (p.dt < 0) E++; else I++; }
    else if (p.im) { for (const k in p.im) if (p.im[k] === -1 || p.im[k] >= st.day) { R++; break; } }
  }
  return { S: st.people.length - E - I - R, E, I, R };
}

