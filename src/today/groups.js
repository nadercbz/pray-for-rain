// Bevölkerungsgruppen der Erde heute (seit 27.10.2026, Naders Wunsch "eine Simulation der echten Welt, auch mit den
// Bevölkerungsgruppen"). Je Land aus assets/today/groups.json (CIA Factbook, Weltbank, UN DESA): Altersaufbau,
// Herkunft und Volksgruppen, Sprachen, Religionen im Detail, Zugewanderte mit Herkunftsländern, Stadt und Land, Armut,
// Ungleichheit, Lesen und Schreiben, Lebenserwartung. Rechnet vierteljährlich weiter: Altern aus Geburten und Toden,
// Verstädterung, Verweltlichung in reichen Ländern, unterschiedliches Wachstum der Glaubensgruppen, Zuwanderung nach
// den echten Herkunftsländern, Flucht aus Kriegen in Nachbarländer und reiche Länder, Armut folgt der Wirtschaft.
// Einzelne Menschen gehören zu einer Gruppe (Name, Glaube, Herkunft, Sprache).
import { TODAY } from './data.js';
import { L } from '../i18n.js';

export const REL_KEYS = ['cath', 'prot', 'orth', 'chr_other', 'sunni', 'shia', 'isl_other', 'hin', 'bud', 'jud', 'sikh', 'folk', 'none', 'other'];
export const REL_NAME = {
  cath: L('Katholiken', 'Catholics'), prot: L('Protestanten', 'Protestants'), orth: L('Orthodoxe', 'Orthodox'), chr_other: L('andere Christen', 'other Christians'),
  sunni: L('Sunniten', 'Sunni Muslims'), shia: L('Schiiten', 'Shia Muslims'), isl_other: L('andere Muslime', 'other Muslims'), hin: L('Hindus', 'Hindus'),
  bud: L('Buddhisten', 'Buddhists'), jud: L('Juden', 'Jews'), sikh: L('Sikhs', 'Sikhs'), folk: L('Volksreligionen', 'Folk religions'), none: L('ohne Religion', 'unaffiliated'), other: L('andere', 'other'),
};
// Glaube eines einzelnen Menschen (Adjektiv)
const REL_ONE = {
  cath: L('katholisch', 'Catholic'), prot: L('evangelisch', 'Protestant'), orth: L('orthodox', 'Orthodox'), chr_other: L('christlich', 'Christian'),
  sunni: L('sunnitisch', 'Sunni Muslim'), shia: L('schiitisch', 'Shia Muslim'), isl_other: L('muslimisch', 'Muslim'), hin: L('hinduistisch', 'Hindu'),
  bud: L('buddhistisch', 'Buddhist'), jud: L('jüdisch', 'Jewish'), sikh: L('Sikh', 'Sikh'), folk: L('Volksglaube', 'folk religion'), none: L('ohne Religion', 'not religious'), other: L('anderer Glaube', 'other faith'),
};
// Wachstum der Gruppen je Jahr (Kinderzahl und Alter, an Pew 2015 bis 2060 angelehnt), dazu Verweltlichung
const REL_GROW = { cath: -0.0005, prot: -0.001, orth: -0.002, chr_other: 0.001, sunni: 0.004, shia: 0.004, isl_other: 0.004, hin: 0.001, bud: -0.003, jud: 0, sikh: 0.001, folk: -0.004, none: 0, other: 0 };
const SECULAR = { cath: 1, prot: 1.2, orth: 0.8, chr_other: 0.6, sunni: 0.25, shia: 0.25, isl_other: 0.25, hin: 0.3, bud: 0.8, jud: 0.6, sikh: 0.3, folk: 1, other: 0.6 };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const r5 = x => Math.round(x * 1e5) / 1e5;

// Startzustand je Land (ts.c[i].pg), aus den Daten
function makePg(C) {
  const G = C.grp;
  if (!G) return null;
  const a = (G.age || [0.25, 0.65, 0.1]).slice(), lifeAvg = ((G.lifeF || C.life || 72) + (G.lifeM || C.life || 68)) / 2;
  const rel = {}; for (const k of REL_KEYS) rel[k] = (G.rel && G.rel[k]) || 0;
  const o = {}; for (const [iso, v] of G.origins || []) o[iso] = v;
  // ohne Armutszahl (vor allem reiche Kleinstaaten): grob aus dem Wohlstand
  const pv = G.poverty ?? clamp(0.75 * Math.exp(-(C.gdppc || 5000) / 2600), 0.002, 0.8);
  const P = {
    a, mo: (G.median || 30) - medianOf(a, lifeAvg), u: G.urban ?? C.urban ?? 0.5, r: rel,
    e: (G.ethnic || []).map(e => e[2]), ex: [], m: G.migrants || 0, o,
    pv, gi: G.gini ?? 38, li: G.literacy ?? 0.85, lf: G.lifeF || C.life || 74, lm: G.lifeM || (C.life || 70) - 5,
  };
  normRel(P.r);
  return P;
}
export function initGroups(ts) { TODAY.list.forEach((C, i) => { ts.c[i].pg = makePg(C); }); }
// Startwerte ohne Spielstand (Auswahl des Menschen vor dem Start), gleiche Zahlen wie initGroups
const staticPg = new Map();
const pgOf = (ts, i) => (ts && ts.c && ts.c[i] && ts.c[i].pg) || (staticPg.has(i) ? staticPg.get(i) : staticPg.set(i, makePg(TODAY.list[i])).get(i));
export function ensureGroups(ts) { if (ts.c.length && !('pg' in ts.c[0])) initGroups(ts); }

// Median aus drei Altersgruppen (gleichmäßig verteilt in 0 bis 15, 15 bis 65, 65 bis Lebensende)
function medianOf([y, w, o], life) {
  if (y >= 0.5) return 15 * 0.5 / y;
  if (y + w >= 0.5) return 15 + 50 * (0.5 - y) / w;
  return 65 + Math.max(5, life - 65) * (0.5 - y - w) / Math.max(0.01, o);
}
export function median(c) { const P = c.pg; return P ? medianOf(P.a, (P.lf + P.lm) / 2) + P.mo : null; }
function normRel(r) { let s = 0; for (const k of REL_KEYS) s += r[k]; if (s > 0) for (const k of REL_KEYS) r[k] = r5(r[k] / s); }

// Hauptgruppe eines Landes (für Namen der Zugewanderten): Schlüssel der Namensliste
const mainNames = C => (C && C.grp && C.grp.ethnic && C.grp.ethnic[0] && C.grp.ethnic[0][3]) || (C && C.names) || 'en_us';
// größtes Land mit dieser Namensliste als Hauptgruppe (Glaube einer Gruppe, die aus einem anderen Land stammt)
let keyMap = null;
function keyCountry(k) {
  if (!keyMap) { keyMap = new Map(); TODAY.list.forEach((C, i) => { const m = mainNames(C), cur = keyMap.get(m); if (C.grp && (cur == null || (TODAY.list[cur].pop || 0) < (C.pop || 0))) keyMap.set(m, i); }); }
  return keyMap.has(k) ? keyMap.get(k) : null;
}

// Menschen aus Land src kommen in Land dst an (Anteil share an der Bevölkerung von dst): Zugewanderte, Herkunft,
// Volksgruppe (passende Gruppe nach Namensliste, sonst eine neue Gruppe "aus …") und Glaube
function arrive(ts, dst, src, share) {
  const P = ts.c[dst].pg, D = TODAY.list[dst], S = TODAY.list[src];
  if (!P || !S || share <= 0) return;
  const m0 = P.m;
  P.m = (m0 + share) / (1 + share);
  for (const k in P.o) P.o[k] = P.o[k] * m0 / (m0 + share);
  P.o[S.iso3] = (P.o[S.iso3] || 0) + share / (m0 + share);
  const top = Object.entries(P.o).sort((a, b) => b[1] - a[1]).slice(0, 8);
  P.o = {}; for (const [k, v] of top) P.o[k] = r5(v);
  // Volksgruppe
  const key = mainNames(S), eth = D.grp.ethnic || [];
  const gi = key === mainNames(D) ? 0 : eth.findIndex((e, j) => j > 0 && e[3] === key && !/^andere|^other/i.test(e[1]));
  if (gi >= 0) P.e[gi] += share;
  else { let x = P.ex.find(q => q[0] === S.iso3); if (!x) P.ex.push(x = [S.iso3, 0]); x[1] += share; }
  const tot = 1 + share;
  P.e = P.e.map(v => r5(v / tot)); for (const x of P.ex) x[1] = r5(x[1] / tot);
  P.ex = P.ex.filter(x => x[1] > 0.0004).sort((a, b) => b[1] - a[1]).slice(0, 6);
  // Glaube der Ankommenden wie im Herkunftsland
  const sr = ts.c[src].pg ? ts.c[src].pg.r : null;
  if (sr) { for (const k of REL_KEYS) P.r[k] += sr[k] * share; normRel(P.r); }
}

// Nachbarn und Ziele für Flüchtende: die nächsten Länder nach Mittelpunkt, dazu reiche Länder mit Gemeinden aus dem Land
const nearCache = new Map();
function nearest(i) {
  let a = nearCache.get(i); if (a) return a;
  const C = TODAY.list[i], d = [];
  TODAY.list.forEach((o, j) => {
    if (j === i || !o.cx || !o.pop || o.pop < 3e5) return;
    let dx = Math.abs(o.cx - C.cx); dx = Math.min(dx, 2048 - dx);
    d.push([j, Math.hypot(dx * Math.cos(((C.cy + o.cy) / 2 / 1024 - 0.5) * Math.PI), o.cy - C.cy)]);
  });
  a = d.sort((x, y) => x[1] - y[1]).slice(0, 5).map(x => x[0]);
  nearCache.set(i, a);
  return a;
}
function destinations(ts, src) {
  const out = [], S = TODAY.list[src];
  // vier Fünftel in die Nachbarländer, der Rest dorthin, wo schon Menschen aus dem Land leben
  for (const j of nearest(src)) if (!ts.c[j].war) out.push([j, 1]);
  const near = out.length, rich = [];
  ts.c.forEach((c, j) => {
    if (j === src || c.war || !c.pg || (c.gdp / Math.max(1, c.pop)) < 28000 || c.pop < 4e6) return;
    const dia = (c.pg.o[S.iso3] || 0) * c.pg.m * c.pop;
    if (dia > 2e4) rich.push([j, dia]);
  });
  const rs = rich.reduce((a, b) => a + b[1], 0);
  if (near) for (const x of out) x[1] = (rs ? 0.8 : 1) / near;
  if (rs) for (const [j, v] of rich) out.push([j, (near ? 0.2 : 1) * v / rs]);
  return out;
}

// Vierteljährlicher Schritt (dt in Jahren). emit(Art, Text, Land, Wichtigkeit) schreibt Nachrichten.
export function groupsStep(ts, dt, emit) {
  for (let i = 0; i < ts.c.length; i++) {
    const c = ts.c[i], P = c.pg;
    if (!P || c.pop <= 0) continue;
    // Altern: Geburten kommen zu den Jungen, Junge werden 15, Erwachsene 65. Wie viele das je Jahr sind, hängt von der
    // Form der Pyramide ab (stabile Bevölkerung mit Wachstum n, aus dem Anteil der Jungen geschätzt): in jungen Ländern
    // ist der Jahrgang der 64 Jährigen klein. Tode treffen in alten Ländern vor allem die Alten, in jungen auch Kinder.
    const b = c.b / 1000, d = (c.d + c.sick * 4 + c.war * 0.4) / 1000;
    const [y, w, o] = P.a, n = clamp((y - 0.155) * 0.16, -0.01, 0.045);
    const fy = Math.abs(n) < 1e-4 ? 1 : n * 15 * Math.exp(-14 * n) / (1 - Math.exp(-15 * n));
    const fw = Math.abs(n) < 1e-4 ? 1 : n * 49 * Math.exp(-64 * n) / (Math.exp(-15 * n) - Math.exp(-64 * n));
    // Überleben bis 64 (gegen den Schnitt der Erwachsenen) und Sterblichkeit der Alten aus der Lebenserwartung
    const life = (P.lf + P.lm) / 2, surv = clamp(0.55 + (life - 50) * 0.012, 0.6, 1);
    const dY = d * clamp(0.45 - o * 2.2, 0.02, 0.45), dO = Math.min(d * 0.9 - dY * 0.5, o / (10 + Math.max(0, life - 60) * 0.45)), dW = Math.max(0, d - dO - dY);
    const Y = y + (b - y / 15 * fy - dY) * dt, W = w + (y / 15 * fy - w / 50 * fw * surv - dW) * dt, O = o + (w / 50 * fw * surv - dO) * dt, S = Math.max(0.01, Y + W + O);
    P.a = [r5(clamp(Y / S, 0.02, 0.7)), r5(clamp(W / S, 0.2, 0.85)), r5(clamp(O / S, 0.005, 0.6))];
    // Stadt und Land: Verstädterung, schneller bei Wachstum
    P.u = r5(P.u + (0.93 - P.u) * (0.004 + Math.max(0, c.g) * 0.1) * dt);
    // Glaube: Wachstum der Gruppen, Verweltlichung je nach Wohlstand
    const gdppc = c.gdp / Math.max(1, c.pop), rich = clamp((Math.log10(Math.max(500, gdppc)) - 3.6) / 1.0, 0, 1);
    let moved = 0;
    for (const k of REL_KEYS) {
      if (k === 'none') continue;
      const sec = 0.0035 * rich * (SECULAR[k] || 0.5) * P.r[k] * dt;
      P.r[k] = Math.max(0, P.r[k] * (1 + (REL_GROW[k] || 0) * dt) - sec); moved += sec;
    }
    P.r.none += moved;
    normRel(P.r);
    // Wanderung: einmalige Ströme der letzten Jahre (Rückkehr, Flucht) klingen ab, übrig bleibt reiche Länder ziehen an,
    // arme verlieren ein wenig (Zeitkonstante rund 20 Jahre)
    c.mig += ((rich * 0.0045 - (1 - rich) * 0.0012) - c.mig) * 0.05 * dt;
    // Zuwanderung nach den echten Herkunftsländern: Mittel aus Spiel (c.mig) und Factbook, nie in ein Land im Krieg
    const G = TODAY.list[i].grp, nm = Math.min(0.006, c.mig, G && G.netMig != null ? G.netMig / 1000 : c.mig);
    if (c.mig > 0 && nm > 0 && !c.war) {
      const inflow = nm * dt, tot = Object.values(P.o).reduce((a, v) => a + v, 0) || 1;
      for (const [iso, v] of Object.entries(P.o)) { const j = TODAY.byIso.get(iso); if (j) arrive(ts, i, TODAY.list.indexOf(j), inflow * v / tot); }
    }
    // Armut folgt der Wirtschaft (Wachstum senkt sie, Krieg und Schäden erhöhen sie), Lesen und Schreiben, Lebenserwartung
    // Armut folgt dem Wachstum je Mensch (Elastizität rund 1, in sehr armen Ländern weniger)
    const gpc = c.g - (c.b - c.d) / 1000 - c.mig, el = 0.6 + 0.6 * (1 - P.pv);
    P.pv = r5(clamp(P.pv * Math.exp(-el * gpc * dt) + (c.war ? 0.01 : 0) * dt + c.dmg * 0.004 * dt, 0.0005, 0.95));
    P.gi = r5(clamp(P.gi + (c.war ? 0.4 : 0) * dt + (38 - P.gi) * 0.004 * dt, 20, 65));
    P.li = r5(P.li + (0.995 - P.li) * 0.025 * dt);
    const gain = (0.08 + 0.15 * (1 - rich)) * dt - c.war * 0.4 * dt - c.sick * 6 * dt;
    P.lf = r5(clamp(P.lf + gain, 40, 96)); P.lm = r5(clamp(P.lm + gain, 38, 92));
    // Glaube (Kraft des Geistes) folgt langsam der Zugehörigkeit, Wunder heben ihn darüber
    c.faith += ((1 - P.r.none - 0.12) - c.faith) * 0.03 * dt * 4;
  }
  // Flucht aus Kriegen: Angegriffene und Bürgerkriegsländer verlieren Menschen an Nachbarn und reiche Länder
  for (const Wr of ts.wars) {
    // im ersten Jahr am meisten (Ukraine 2022 rund 15 %, Syrien 2013 rund 5 %), danach ein Rest; nie mehr als ein Viertel
    const age = (ts.day - Wr.since) / 24, k = 0.1 + 0.9 * Math.exp(-Math.max(0, age) / 1.5);
    for (const [src, rate] of Wr.b >= 0 ? [[Wr.b, 0.05], [Wr.a, 0.002]] : [[Wr.a, 0.015]]) {
      const c = ts.c[src]; if (!c || c.pop <= 1e5 || (Wr.fled || 0) > c.pop * 0.25) continue;
      const n = c.pop * rate * k * (1.2 - c.stab * 0.6) * dt;
      c.pop -= n;
      const to = destinations(ts, src);
      for (const [j, f] of to) { const k = n * f; ts.c[j].pop += k; arrive(ts, j, src, k / Math.max(1, ts.c[j].pop)); }
      Wr.fled = (Wr.fled || 0) + n;
      Wr.flTo = Wr.flTo || {};
      for (const [j, f] of to) Wr.flTo[j] = (Wr.flTo[j] || 0) + n * f;
    }
    // einmal im Jahr eine Nachricht über die Geflüchteten
    if (Wr.fled > 2e5 && (!Wr.flNews || Wr.fled > Wr.flNews * 1.8)) {
      Wr.flNews = Wr.fled;
      const src = Wr.b >= 0 ? Wr.b : Wr.a;
      const top = Object.entries(Wr.flTo || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([j]) => L(TODAY.list[j].de, TODAY.list[j].en));
      emit('krieg', L(`Seit Beginn des Krieges sind ${fmt(Wr.fled)} Menschen aus ${TODAY.list[src].de} geflohen, die meisten nach ${top.join(', ')}.`, `Since the war began, ${fmt(Wr.fled)} people have fled ${TODAY.list[src].en}, most of them to ${top.join(', ')}.`), src, 2);
    }
  }
}
const fmt = n => n >= 1e6 ? (n / 1e6).toLocaleString(L('de-DE', 'en-GB'), { maximumFractionDigits: 1 }) + L(' Millionen', ' million') : Math.round(n / 1e3).toLocaleString(L('de-DE', 'en-GB')) + L(' Tausend', ' thousand');

// ---------- Für die Oberfläche ----------
// Volksgruppen eines Landes mit Anteilen (Daten plus neue Gruppen aus Zuwanderung), größte zuerst
export function ethnicList(ts, i) {
  const C = TODAY.list[i], P = ts.c[i].pg; if (!P || !C.grp) return [];
  const out = (C.grp.ethnic || []).map((e, j) => ({ name: L(e[0], e[1]), share: P.e[j] ?? e[2], other: /^andere|^other/i.test(e[1]) }));
  for (const [iso, v] of P.ex) { const S = TODAY.byIso.get(iso); if (S) out.push({ name: L(`Zugewanderte aus ${S.de}`, `Immigrants from ${S.en}`), share: v, iso }); }
  return out.sort((a, b) => (a.other - b.other) || b.share - a.share);
}
export function religionList(ts, i) {
  const P = ts.c[i].pg; if (!P) return [];
  return REL_KEYS.map(k => ({ k, name: REL_NAME[k], share: P.r[k] })).filter(x => x.share >= 0.005).sort((a, b) => b.share - a.share);
}
// Welt im Ganzen (nach Menschen gewichtet)
export function worldGroups(ts) {
  let P = 0, y = 0, o = 0, u = 0, m = 0, pv = 0, med = 0, lf = 0, lm = 0, li = 0;
  const rel = {}; for (const k of REL_KEYS) rel[k] = 0;
  for (const c of ts.c) {
    if (!c.pg || c.pop <= 0) continue;
    const p = c.pop, g = c.pg; P += p;
    y += g.a[0] * p; o += g.a[2] * p; u += g.u * p; m += g.m * p; pv += g.pv * p; med += median(c) * p; lf += g.lf * p; lm += g.lm * p; li += g.li * p;
    for (const k of REL_KEYS) rel[k] += g.r[k] * p;
  }
  const k = 1 / Math.max(1, P);
  for (const q of REL_KEYS) rel[q] *= k;
  return { pop: P, young: y * k, old: o * k, urban: u * k, migrants: m * P * k, migShare: m * k, poor: pv, poorShare: pv * k, median: med * k, lifeF: lf * k, lifeM: lm * k, literacy: li * k, rel };
}

// ---------- Einzelne Menschen ----------
// Gruppe für einen Menschen in Land i: Volksgruppe (Namensliste), zugewandert ja oder nein (Herkunftsland), Glaube
export function pickGroup(ts, i, R) {
  const C = TODAY.list[i], P = C && pgOf(ts, i);
  if (!C || !C.grp || !P) return null;
  const res = { names: C.names, eth: null, origin: null, rel: null };
  // zugewandert? dann Herkunftsland nach Anteilen, Name und Glaube von dort
  if (R.next() < P.m) {
    const ent = Object.entries(P.o); const iso = ent.length ? R.weighted(ent, e => e[1])[0] : null, S = iso && TODAY.byIso.get(iso);
    if (S) {
      const si = TODAY.list.indexOf(S), sp = pgOf(ts, si);
      res.origin = si; res.names = mainNames(S); res.eth = L(`aus ${S.de}`, `from ${S.en}`);
      res.rel = sp ? R.weighted(REL_KEYS, k => sp.r[k]) : null;
      return res;
    }
  }
  const eth = C.grp.ethnic || [], list = eth.map((e, j) => [e, P.e[j] ?? e[2]]);
  let ref = null;
  if (list.length) {
    const [e] = R.weighted(list, x => x[1]); res.names = e[3] || C.names; res.eth = /^andere|^other/i.test(e[1]) ? null : L(e[0], e[1]);
    if (e[3] && e[3] !== mainNames(C)) ref = keyCountry(e[3]);
  }
  for (const [iso] of P.ex) if (res.eth && res.eth.includes(L(TODAY.byIso.get(iso)?.de || '#', TODAY.byIso.get(iso)?.en || '#'))) ref = TODAY.list.indexOf(TODAY.byIso.get(iso));
  // Glaube: Gruppen aus anderen Ländern wie dort, Alteingesessene ohne den Glauben, den die Zugewanderten mitbrachten
  const rp = ref != null && ref >= 0 ? pgOf(ts, ref) : null;
  if (rp) res.rel = R.weighted(REL_KEYS, k => rp.r[k]);
  else {
    const imp = {}; for (const k of REL_KEYS) imp[k] = 0;
    for (const [iso, v] of Object.entries(P.o)) { const S = TODAY.byIso.get(iso), sp = S && pgOf(ts, TODAY.list.indexOf(S)); if (sp) for (const k of REL_KEYS) imp[k] += v * P.m * sp.r[k]; }
    res.rel = R.weighted(REL_KEYS, k => Math.max(0, P.r[k] - imp[k] * 1.3) + 1e-6);
  }
  return res;
}
export const relOne = k => REL_ONE[k] || '';
