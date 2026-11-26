// Geld und Arbeit: ein echtes kleines Wirtschaftssystem über der Güterwirtschaft aus core.js.
// Jeder Mensch hat ein Vermögen (p.gold, Einlagen p.dep, Schulden p.debt), bekommt Lohn für seine Arbeit,
// zahlt für Essen, Waren und Miete, zahlt Steuern. Der Stadtmarkt (s.mkt) kauft, was erzeugt wird, und verkauft,
// was gebraucht wird; die Preise folgen Vorrat, Nachfrage und dem Preisniveau der Insel (Geldmenge).
// Reiche besitzen Betriebe und Häuser (b.own) und bekommen Gewinne und Mieten. Der Staat (s.stock.gold) zahlt
// Staatsdiener, Sozialhilfe und Bauten, leiht sich bei Reichen oder prägt Münzen (Inflation).
// Dazu: Kredite und Banken, Währungen je Insel, Handel über Preisunterschiede, Streiks, Brotaufstände,
// Korruption, Spenden, Diebstahl, Klassen, Erbe. Alles deterministisch über rng(st).
import * as D from './data.js';
import { clamp } from './rng.js';
import { ageOf, knows, chron, bio, members, rng, isleOf, fx, landOf, sameLand, bldOf } from './util.js';
import { LANGS } from './names.js';
import { netRoad } from './roads.js';
import { foundSettlement, findNewHome, isleCap, leaderOf } from './society.js';
import { L } from '../i18n.js';

export const GOODS = ['food', 'wood', 'stone', 'ore', 'tools', 'goods'];
export const BASE = { food: 1, wood: 1.5, stone: 2, ore: 3.2, tools: 8, goods: 6 };
// Anteil, den ein Betrieb dem Besitzer lässt (der Rest ist Lohn). Häuser bringen Miete.
export const SIGMA = { feld: 0.3, muehle: 0.45, fischer: 0.22, holz: 0.25, stein: 0.3, mine: 0.45, werkstatt: 0.35, markt: 0.35, hafen: 0.4, fabrik: 0.5, kraftwerk: 0.4 };
// Staatsdiener: Gehalt aus der Stadtkasse, Faktor zum Durchschnittslohn
export const PUBLIC = { priester: 1.0, gelehrter: 1.35, heiler: 1.25, kuenstler: 0.8, krieger: 1.1, baumeister: 1.0 };
// Einkommensteuer je Staatsform
export const TAX = { rat: 0.1, haeuptling: 0.12, koenigtum: 0.18, theokratie: 0.15, republik: 0.12, demokratie: 0.22, diktatur: 0.25, volksrat: 0.28, technokratie: 0.2 };
const WELFARE = new Set(['volksrat', 'demokratie', 'technokratie']);
export const CLASSES = [L('arm', 'poor'), L('einfach', 'common'), L('wohlhabend', 'well off'), L('reich', 'rich'), L('Adel', 'nobility')];
const DAY = D.DAYS_PER_YEAR;

const sel = (arr, fn) => { let b = null, bv = -Infinity; for (const x of arr) { const v = fn(x); if (v > bv) { bv = v; b = x; } } return b; };
export const taxRate = s => clamp((TAX[s.gov.type] ?? 0.1) + (s.laws.includes('freihandel') ? -0.02 : 0) + (s.war ? 0.04 : 0), 0.02, 0.45);
export const wealthOf = (st, p) => (p.gold || 0) + (p.dep || 0) - (p.debt || 0) + (st._rt.ownVal ? (st._rt.ownVal.get(p.id) || 0) : 0);
const fin0 = () => ({ wage: 0, profit: 0, rent: 0, tax: 0, salary: 0, welfare: 0, cons: 0, lux: 0, build: 0, exp: 0, imp: 0, tariff: 0, mint: 0, interest: 0, prod: 0, ybase: 0, theft: 0, unpaid: 0 });

// ---------- Aufbau ----------

// Neue Welt oder alter Spielstand: Geld verteilen, Preise setzen, Betriebe zuordnen
export function initMoney(st) {
  if (st.money) return;
  const r = rng(st), rt = st._rt;
  st.money = 1;
  for (const I of st.isles) { I.pl = 1; I.plPrev = 1; I.infl = 0; }
  for (const s of st.settlements) {
    s.price = { ...BASE }; s.mkt = 40; s.fin = fin0(); s.finY = null; s.avgWage = 1; s.gini = 0;
    if (!s.alive) continue;
    // Alter Spielstand: die Hälfte der Stadtkasse ist eigentlich privates Geld
    const M = members(st, s), adults = M.adults.concat(M.old);
    const old = Math.max(0, s.stock.gold || 0);
    const priv = old * 0.5;
    s.stock.gold = Math.max(60, old - priv); s.mkt = 60;
    const w = adults.map(p => 0.4 + r.next() + (p.job === 'haendler' ? 2 : 0) + (p.lt ? 3 : 0) + p.tr.fleiss * 0.5 + p.tr.charisma * 0.5);
    const wsum = w.reduce((a, b) => a + b, 0) || 1;
    adults.forEach((p, i) => { p.gold = 14 + r.next() * 12 + priv * w[i] / wsum; });
    // Betriebe: in frühen Zeiten gehört alles allen, später den alten Familien
    if (s.era >= 2) {
      const rich = adults.slice().sort((a, b) => b.gold - a.gold).slice(0, Math.max(1, Math.ceil(adults.length * 0.12)));
      for (const b of bldOf(st, s)) if ((SIGMA[b.t] != null || (b.t === 'haus' && s.era >= 3)) && r.chance(0.55)) b.own = r.pick(rich).id;
    }
  }
  for (const p of st.people) { if (p.gold == null || p.gold === 0) p.gold = ageOf(st, p) >= 14 ? 12 + r.next() * 8 : 0; p.jy = p.jy ?? (p.b + 16 * DAY); p.jobSeen = p.job; }
  void rt;
}

// ---------- Täglich ----------

// Preise: Vorrat gegen Nachfrage, mal Preisniveau der Insel, mal Liquidität des Marktes
function demandOf(s, g, M) {
  const pop = s.pop || 1, era = s.era;
  switch (g) {
    case 'food': return s.prod.need || pop;
    case 'wood': return 0.6 + pop * 0.035;
    case 'stone': return 0.15 + pop * (era >= 1 ? 0.02 : 0.004);
    case 'ore': return era >= 2 ? 0.1 + pop * 0.012 : 0.04;
    case 'tools': return 0.05 + M.adults.length * 0.008;
    default: return era >= 1 ? 0.05 + pop * 0.014 * (1 + era * 0.2) : 0.02;
  }
}

function updatePrices(st, s, M, I) {
  const P = s.price, turn = (s.turn || 20);
  const liq = s.mkt < 0 ? clamp(1 + s.mkt / (turn * 25 + 60), 0.55, 1) : 1;
  for (const g of GOODS) {
    const d = demandOf(s, g, M);
    const cover = ((s.stock[g] || 0) + 1) / (d * 14);
    (s.cover || (s.cover = {}))[g] = cover;
    const scar = clamp(Math.pow(cover, -0.55), 0.25, 6);
    const target = BASE[g] * scar * (I ? I.pl : 1) * liq;
    P[g] += (target - P[g]) * 0.12;
  }
}

// Wert einer Arbeit in Geld (Rohstoffe als Einsatz abgezogen)
export const valueOf = (P, d) => d[0] * P.food + d[1] * P.wood + d[2] * P.stone + d[3] * P.ore + d[4] * P.tools + d[5] * P.goods;
const BASEV = d => d[0] * BASE.food + d[1] * BASE.wood + d[2] * BASE.stone + d[3] * BASE.ore + d[4] * BASE.tools + d[5] * BASE.goods;

// Einkommen: Steuer an die Stadtkasse, Schuldendienst an den Gläubiger, Rest in die Tasche
export function earn(st, s, p, amt, kind) {
  if (!(amt > 0)) return;
  const F = s.fin;
  F[kind] = (F[kind] || 0) + amt;
  let t = amt * taxRate(s);
  if (s.laws.includes('tempelzehnt')) t += amt * 0.06;
  s.stock.gold += t; F.tax += t;
  s.taxDay = (s.taxDay || 0) + t;
  let net = amt - t;
  if (p.debt > 0.01) {
    const share = p.debt > (s.avgWage || 1) * 50 ? 0.4 : 0.2;
    const pay = Math.min(p.debt, net * share);
    repay(st, s, p, pay);
    net -= pay;
  }
  p.gold = (p.gold || 0) + net;
  p.inc = (p.inc || 0) * 0.97 + amt * 0.03;
}

// Ausgaben: erst eigenes Geld, dann Partner, dann Kinder (für Alte), dann Sozialhilfe oder Kredit
function spend(st, s, p, amt, why) {
  if (!(amt > 0)) return true;
  if ((p.gold || 0) >= amt) { p.gold -= amt; return true; }
  let rest = amt - Math.max(0, p.gold || 0);
  p.gold = Math.min(p.gold || 0, 0);
  const rt = st._rt;
  const pa = p.pa && rt.pById.get(p.pa);
  if (pa && pa.gold > rest) { pa.gold -= rest; return true; }
  if (ageOf(st, p) >= 60 || why === 'kid') {
    for (const k of (rt.kidsOf.get(p.id) || [])) if (k.gold > rest * 3) { k.gold -= rest; return true; }
  }
  if ((WELFARE.has(s.gov.type) || s.laws.includes('gemeinschaft') || (s.era >= 6 && ageOf(st, p) >= 64)) && s.stock.gold > rest) {
    s.stock.gold -= rest; s.fin.welfare += rest; p.poor = Math.min(30, (p.poor || 0) + 0.3); return true;
  }
  const step = why === 'food' ? 0.5 : 0.25;
  if (borrow(st, s, p, rest)) { p.poor = Math.min(30, (p.poor || 0) + step * 0.5); return true; }
  // niemand hilft: man isst trotzdem mit, bleibt aber die Rechnung schuldig, und die Not wächst
  p.poor = Math.min(30, (p.poor || 0) + step);
  return false;
}

// Kredit: Freunde leihen ohne Zinsen, sonst die Bank der Stadt oder die Reichen
function borrow(st, s, p, amt) {
  const rt = st._rt;
  if (ageOf(st, p) < 16) return false;
  if (p.cred) {
    const c = p.cred < 0 ? null : rt.pById.get(p.cred);
    if (p.cred < 0 && s.bank && s.bank.res > amt) { s.bank.res -= amt; p.debt += amt; return true; }
    if (c && c.gold > amt * 2) { c.gold -= amt; p.debt += amt; return true; }
  }
  if (p.debt > (s.avgWage || 1) * 60) return false; // keiner leiht mehr
  if (s.bank && s.bank.res > amt * 2) { s.bank.res -= amt; p.debt = (p.debt || 0) + amt; p.cred = -s.id; p.dSince = p.dSince || st.day; return true; }
  const lenders = rt.richest.get(s.id) || [];
  for (const c of lenders) {
    if (c === p || c.gold < amt * 3) continue;
    c.gold -= amt; p.debt = (p.debt || 0) + amt; p.cred = c.id; p.dSince = p.dSince || st.day;
    if (p.ties && (p.ties[c.id] || 0) > 40) p.nofee = 1; else p.nofee = 0;
    return true;
  }
  return false;
}

function repay(st, s, p, amt) {
  if (!(amt > 0)) return;
  amt = Math.min(amt, p.debt);
  p.debt -= amt;
  if (p.cred < 0) { const b = st._rt.sById.get(-p.cred); if (b && b.bank) b.bank.res += amt; }
  else { const c = st._rt.pById.get(p.cred); if (c) c.gold += amt; else s.stock.gold += amt; }
  if (p.debt < 0.01) { p.debt = 0; p.cred = 0; p.dSince = 0; p.bond = 0; }
}

// rt.val: Arbeitsergebnis je Person aus economy() (Güter netto), s.prodMul: Produktivität der Siedlung.
// Reihenfolge eines Tages: Preise, dann zahlen die Käufer (Essen, Waren, Miete) in den Markt, dann bekommt jeder
// Erzeuger seinen Anteil an dem, was wirklich da ist. Volle Lager zahlen wenig (kappa), ein leerer Markt zahlt anteilig.
export function moneyDay(st, s, season) {
  const rt = st._rt, M = members(st, s), I = isleOf(st, s);
  if (!s.fin) { s.fin = fin0(); s.price = s.price || { ...BASE }; s.mkt = s.mkt ?? 40; }
  if (!M.all.length) return;
  const P = s.price, F = s.fin;
  s.taxEMA = (s.taxEMA ?? (s.taxDay || 0)) * 0.95 + (s.taxDay || 0) * 0.05; s.taxDay = 0;
  updatePrices(st, s, M, I);
  // 1 Essen: jeder zahlt seinen Teil, Kinder zahlen die Eltern
  const eat = 1 - (s.hunger || 0);
  let cons = 0;
  for (const p of M.all) {
    const a = ageOf(st, p);
    const cost = (a < 14 ? 0.6 : a >= 64 ? 0.8 : 1) * eat * P.food;
    let ok;
    if (a < 14) {
      const par = (p.mo && rt.pById.get(p.mo)) || (p.fa && rt.pById.get(p.fa)) || (p.ad && rt.pById.get(p.ad));
      ok = par && par.s === s.id ? spend(st, s, par, cost, 'kid') : welfare(s, cost);
    } else ok = spend(st, s, p, cost, 'food');
    if (ok) cons += cost;
    if (p.poor) p.poor = Math.max(0, p.poor - 0.15);
  }
  // 2 Waren und Luxus: wer mehr hat, als er braucht, kauft (je reicher, desto mehr)
  if (s.era >= 1 && s.stock.goods > 0.5) {
    const reserve = P.food * 30;
    for (const p of M.adults.concat(M.old)) {
      const free = (p.gold || 0) - reserve;
      if (free <= 0) { p.lux = Math.max(0, (p.lux || 0) - 0.01); continue; }
      const units = Math.min(free * 0.015 / P.goods, s.stock.goods * 0.2);
      if (units <= 0.001) continue;
      const cost = units * P.goods;
      p.gold -= cost; s.stock.goods -= units; cons += cost; F.lux += cost;
      p.lux = Math.min(1, (p.lux || 0) * 0.98 + units * 0.6);
    }
  }
  // 3 Miete an die Hausbesitzer
  if (s.era >= 2 && st.day % 3 === 0) {
    const rent = P.food * 0.18 * (1 + s.era * 0.08);
    for (const p of M.adults) {
      if (p.home <= 0) continue;
      const h = rt.bById.get(p.home);
      if (!h || !h.own || h.own === p.id || h.own === p.pa) continue;
      const o = rt.pById.get(h.own);
      if (o && spend(st, s, p, rent, 'rent')) earn(st, s, o, rent, 'rent');
    }
  }
  s.mkt += cons; F.cons += cons;
  // 4 Arbeit: Ansprüche der Erzeuger, bewertet mit Marktpreis mal Absatzlage (kappa)
  const margin = s.laws.includes('freihandel') ? 0.05 : 0.08;
  const mul = s.prodMul || 1;
  const kap = {};
  for (const g of GOODS) kap[g] = clamp(1.25 - (s.cover?.[g] ?? 1) * 0.45, 0.12, 1);
  const PK = { food: P.food * kap.food, wood: P.wood * kap.wood, stone: P.stone * kap.stone, ore: P.ore * kap.ore, tools: P.tools * kap.tools, goods: P.goods * kap.goods };
  const merchants = [], servants = [], claims = [];
  let claimSum = 0, baseVal = 0;
  for (const p of M.adults) {
    if (p.jobSeen !== p.job) { p.jobSeen = p.job; p.jy = st.day; }
    if (PUBLIC[p.job]) { servants.push(p); continue; }
    if (p.job === 'haendler') { merchants.push(p); continue; }
    const d = rt.val.get(p.id);
    if (!d) continue;
    baseVal += BASEV(d) * mul;
    const v = valueOf(PK, d) * mul * (1 - margin);
    if (v > 0) { claims.push([p, v]); claimSum += v; }
  }
  // Der Markt zahlt, was er hat (plus einen kleinen Kredit), nicht mehr
  const turn0 = s.turn || 20;
  const cash = s.mkt + turn0 * 4 + 20;
  // Hat der Markt mehr Geld als nötig, bekommen die Erzeuger einen Aufschlag (bis 60 Prozent)
  const excess = Math.max(0, s.mkt - turn0 * 8 - 30);
  const rho = claimSum > 0 ? clamp((cash + excess * 0.15) / claimSum, 0.1, 1.6) : 1;
  let paid = 0, wageSum = 0;
  for (const [p, v0] of claims) {
    let v = v0 * rho;
    paid += v;
    const b = p.w > 0 ? rt.bById.get(p.w) : null;
    const sg = b && SIGMA[b.t] != null ? clamp(SIGMA[b.t] - (s.sigAdj?.[b.t] || 0), 0.08, 0.7) : 0;
    if (b && b.own && b.own !== p.id && sg) {
      const o = rt.pById.get(b.own);
      if (o) earn(st, s, o, v * sg, 'profit'); else { s.stock.gold += v * sg; F.profit += v * sg; }
      v *= 1 - sg;
    } else if (b && b.own === 0 && sg) { s.stock.gold += v * sg * 0.5; F.profit += v * sg * 0.5; v *= 1 - sg * 0.5; } // Gemeindebetrieb
    earn(st, s, p, v, 'wage');
    wageSum += v;
  }
  s.mkt -= paid;
  F.prod += paid; F.ybase += baseVal;
  if (claims.length) s.avgWage = s.avgWage * 0.95 + (wageSum / claims.length) * 0.05;
  s.rho = rho;
  // 5 Händler leben von der Spanne
  const turnover = paid + cons;
  s.turn = turn0 * 0.95 + turnover * 0.05;
  if (merchants.length && s.mkt > 0) {
    const pool = Math.min(s.mkt * 0.5, turnover * margin * 0.8 + Math.max(0, s.mkt - s.turn * 30) * 0.02);
    s.mkt -= pool;
    const mk = bldOf(st, s).find(b => b.t === 'markt' && b.own);
    const share = pool / merchants.length;
    for (const p of merchants) {
      let v = share * (0.7 + p.tr.charisma * 0.6);
      const b = p.w > 0 ? rt.bById.get(p.w) : mk;
      const o = b && b.own && b.own !== p.id ? rt.pById.get(b.own) : null;
      if (o) { const sg = SIGMA[b.t] || 0.35; earn(st, s, o, v * sg, 'profit'); v *= 1 - sg; }
      earn(st, s, p, v, 'wage');
    }
  }
  // ein kleiner Teil eines sehr vollen Marktes geht als Marktgebühr an die Stadt
  if (s.mkt > s.turn * 40 + 80) { const x = (s.mkt - s.turn * 40 - 80) * 0.01; s.mkt -= x; s.stock.gold += x; F.tax += x; }
  // 6 Staatsdiener: Gehalt aus der Kasse, so weit die Steuern reichen. Im Krieg mehr Sold.
  let need = 0;
  for (const p of servants) need += s.avgWage * PUBLIC[p.job] * (s.war && p.job === 'krieger' ? 1.5 : 1);
  s.salNeed = (s.salNeed ?? need) * 0.95 + need * 0.05;
  const income = s.taxEMA || 0;
  const reserve = (s.turn || 20) * 4 + 30;
  const surplus = Math.max(0, s.stock.gold - reserve) * 0.02;
  // Mit Reserven zahlt die Stadt mindestens 30 Prozent, ohne Reserven nur, was hereinkommt
  const floor = s.stock.gold > reserve * 0.2 ? 0.3 : 0.05;
  const budget = need > 0 ? clamp((income * 1.05 + surplus) / Math.max(0.01, s.salNeed), floor, 1.3) : 1;
  s.budget = budget;
  // Was dann noch übrig ist, gibt die Stadt aus: Feste, Straßen, Aufträge an Handwerker (Geld fließt zurück in den Markt)
  const spare = Math.max(0, s.stock.gold - reserve * 2) * 0.015 - Math.max(0, need * budget - income);
  if (spare > 0) { s.stock.gold -= spare; s.mkt += spare; F.build += spare; }
  for (const p of servants) {
    let sal = s.avgWage * PUBLIC[p.job] * (s.war && p.job === 'krieger' ? 1.5 : 1) * budget;
    if (p.job === 'priester' && s.laws.includes('tempelzehnt')) sal *= 1.3;
    s.stock.gold -= sal; F.salary += sal; earn(st, s, p, sal, 'wage');
    p.unpaid = budget < 0.6 ? (p.unpaid || 0) + 1 : Math.max(0, (p.unpaid || 0) - 1);
    if (budget < 1) F.unpaid += sal * (1 / budget - 1);
  }
  // 7 Diebstahl: Not und Zorn gegen volle Truhen
  if (st.day % 4 === 0) theft(st, s, M);
  void season;
}

function welfare(s, cost) { if (s.stock.gold < cost) return false; s.stock.gold -= cost; s.fin.welfare += cost; return true; }

function theft(st, s, M) {
  const r = rng(st), rich = st._rt.richest.get(s.id) || [];
  if (!rich.length) return;
  const guards = (s.counts?.warriors || 0) / Math.max(1, M.adults.length);
  for (const p of M.adults) {
    if (!(p.poor > 6) || p.tr.wut + (1 - p.faith) < 1.1 || !r.chance(0.02)) continue;
    const v = r.pick(rich.slice(0, 5));
    if (!v || v === p) continue;
    if (r.chance(0.25 + guards * 3)) { p.hap = clamp(p.hap - 0.15, 0, 1); p.jail = st.day; bio(p, st.day, L(`wird beim Stehlen erwischt`, `is caught stealing`)); continue; }
    const amt = Math.min(v.gold * 0.05, s.avgWage * 20);
    v.gold -= amt; p.gold += amt; s.fin.theft += amt;
    if (amt > s.avgWage * 15 && r.chance(0.3)) chron(st, 'leben', L(`Einbruch in ${s.name}: Jemand leert die Truhe von ${v.n}.`, `Burglary in ${s.name}: someone empties the chest of ${v.n}.`), s.id, 0);
  }
}

// ---------- Alle 6 Tage: Staat, Streiks, Brot ----------

export function moneyWeek(st) {
  const r = rng(st);
  for (const s of st.settlements) {
    if (!s.alive || !s.fin) continue;
    const I = isleOf(st, s);
    // Defizit: erst Gemeindebesitz an Reiche verkaufen, dann leihen oder Münzen prägen
    if (s.stock.gold < 0 && s.era >= 2) privatize(st, s, r);
    if (s.stock.gold < 0) {
      const need = -s.stock.gold + s.turn * 5;
      const L0 = leaderOf(st, s);
      const lenders = (st._rt.richest.get(s.id) || []).filter(p => p.gold > need * 0.5);
      const autocrat = ['koenigtum', 'diktatur', 'haeuptling', 'theokratie'].includes(s.gov.type);
      if (I && I.cur && (autocrat || !lenders.length) && (!L0 || L0.tr.fleiss < 0.6 || !lenders.length)) {
        s.stock.gold += need; s.fin.mint += need; I.minted = (I.minted || 0) + need;
        if (!s.mintNews || st.day - s.mintNews > DAY * 4) {
          s.mintNews = st.day;
          chron(st, 'politik', r.pick(L([
            `Die Kasse von ${s.name} ist leer. ${L0 ? L0.n : 'Die Herrscher'} lässt neue Münzen schlagen, dünner als die alten.`,
            `In ${s.name} werden Münzen mit weniger Silber geprägt. Die Händler beißen misstrauisch hinein.`,
          ], [
            `The treasury of ${s.name} is empty. ${L0 ? L0.n : 'The rulers'} has new coins struck, thinner than the old ones.`,
            `In ${s.name} coins are minted with less silver. The merchants bite them suspiciously.`,
          ])), s.id, 1);
        }
      } else if (lenders.length) {
        // Staatsanleihe: die Reichen geben, die Stadt zahlt Zinsen
        let got = 0;
        for (const p of lenders) {
          if (got >= need) break;
          const x = Math.min(p.gold * 0.4, need - got);
          p.gold -= x; got += x;
          s.bonds = s.bonds || [];
          const bnd = s.bonds.find(b => b.id === p.id);
          if (bnd) bnd.amt += x; else s.bonds.push({ id: p.id, amt: x });
        }
        s.stock.gold += got;
      }
    }
    // Streik: Zünfte (ab Königreichen) und Gewerkschaften (ab Industrie) wehren sich gegen Hungerlöhne
    if (s.era >= 4 && !(s.strike && s.strike.until > st.day) && r.chance(0.25)) strike(st, s);
    // Brotaufstand: Wucherpreise und viele Arme
    const M = members(st, s);
    const poorShare = M.adults.filter(p => (p.poor || 0) > 4).length / Math.max(1, M.adults.length);
    if (s.price.food > BASE.food * (I ? I.pl : 1) * 2.6 && poorShare > 0.3 && (s.riotAt || 0) < st.day - DAY * 3 && r.chance(0.3)) breadRiot(st, s);
  }
}

function privatize(st, s, r) {
  const rt = st._rt;
  const pub = bldOf(st, s).filter(b => b.own === 0 && b.prog >= 1 && (SIGMA[b.t] != null || b.t === 'haus'));
  if (!pub.length) return;
  const b = r.pick(pub), v = buildingValue(s, b);
  const buyer = (rt.richest.get(s.id) || []).find(p => p.gold > v * 1.3);
  if (!buyer) return;
  buyer.gold -= v; s.stock.gold += v; b.own = buyer.id;
  bio(buyer, st.day, L(`kauft der Stadt ${D.BUILDINGS[b.t].name} ab`, `buys a ${D.BUILDINGS[b.t].name.toLowerCase()} from the town`));
  if (r.chance(0.35)) chron(st, 'politik', L(`${s.name} braucht Geld und verkauft ${D.BUILDINGS[b.t].name} an ${buyer.n}. Was allen gehörte, gehört jetzt einem.`,
    `${s.name} needs money and sells a ${D.BUILDINGS[b.t].name.toLowerCase()} to ${buyer.n}. What belonged to all now belongs to one.`), s.id, 0);
}

function strike(st, s) {
  const r = rng(st), rt = st._rt, M = members(st, s);
  const byType = new Map();
  for (const p of M.adults) {
    const b = p.w > 0 ? rt.bById.get(p.w) : null;
    if (!b || !b.own || SIGMA[b.t] == null) continue;
    const g = byType.get(b.t) || { n: 0, wut: 0 };
    g.n++; g.wut += p.tr.wut + (p.poor ? 0.3 : 0) + (p.fac === 'volk' ? 0.2 : 0);
    byType.set(b.t, g);
  }
  for (const [t, g] of byType) {
    const sig = SIGMA[t] - (s.sigAdj?.[t] || 0);
    const angry = g.wut / g.n;
    if (g.n < 4 || sig < 0.18 || !r.chance(clamp((angry - 0.55) * 0.8 + (s.gini - 0.45) * 0.6, 0, 0.6))) continue;
    s.strike = { t, until: st.day + 6 + r.int(0, 6) };
    s.sigAdj = s.sigAdj || {};
    s.sigAdj[t] = (s.sigAdj[t] || 0) + 0.05;
    const who = s.era >= 6 ? L('Die Arbeiter', 'The workers') : L('Die Gesellen', 'The journeymen');
    chron(st, 'politik', L(`Streik in ${s.name}: ${who} der ${D.BUILDINGS[t].name} legen die Arbeit nieder. Sie wollen ein größeres Stück vom Brot.`,
      `Strike in ${s.name}: ${who.toLowerCase()} of the ${D.BUILDINGS[t].name.toLowerCase()} lay down their tools. They want a bigger slice of the bread.`), s.id, 1);
    s.unrest = clamp(s.unrest + 0.05, 0, 1);
    return;
  }
}

function breadRiot(st, s) {
  const rt = st._rt, rich = (rt.richest.get(s.id) || []).filter(p => p.job === 'haendler' || p.gold > s.avgWage * 100);
  s.riotAt = st.day;
  s.unrest = clamp(s.unrest + 0.12, 0, 1);
  const v = rich[0];
  if (v) {
    const take = v.gold * 0.35;
    v.gold -= take;
    const M = members(st, s), poor = M.adults.filter(p => (p.poor || 0) > 2);
    for (const p of poor) p.gold += take / Math.max(1, poor.length);
    bio(v, st.day, L(`wird beim Brotaufstand ausgeplündert`, `is plundered in the bread riot`));
  }
  chron(st, 'politik', L(`Brotaufstand in ${s.name}! Das Brot kostet so viel wie nie. Die Hungrigen stürmen ${v ? `die Speicher von ${v.n}` : 'die Speicher der Reichen'}.`,
    `Bread riot in ${s.name}! Bread has never been so expensive. The hungry storm ${v ? `the storehouses of ${v.n}` : 'the storehouses of the rich'}.`), s.id, 1);
  fx(st, { type: 'revolt', s: s.id });
}

// ---------- Jährlich ----------

export function moneyYear(st) {
  const r = rng(st), rt = st._rt;
  // Preisniveau je Insel: Geldmenge gegen Wirtschaftskraft (Inflation, Deflation)
  for (const I of st.isles) {
    const sets = st.settlements.filter(s => s.alive && s.isle === I.id);
    if (!sets.length) continue;
    let money = 0, base = 0, pop = 0;
    for (const s of sets) {
      money += Math.max(0, s.stock.gold) + Math.max(0, s.mkt) + (s.bank ? Math.max(0, s.bank.res) : 0);
      base += s.fin.ybase || 0; pop += s.pop;
    }
    for (const p of st.people) { const s = rt.sById.get(p.s); if (s && s.isle === I.id) money += Math.max(0, p.gold || 0) + (p.dep || 0); }
    if (knows(st, 'geldwesen', I.id)) money *= 1.25; // Banken lassen Geld schneller umlaufen
    const ratio = money / Math.max(1, base);
    I.plPrev = I.pl || 1;
    if (!I.k0) { I.k0 = (ratio || 1) / I.plPrev; continue; }
    const target = clamp(ratio / I.k0, 0.2, 60);
    I.pl = clamp(I.plPrev + (target - I.plPrev) * 0.3, I.plPrev * 0.75, I.plPrev * 1.35);
    I.infl = I.pl / I.plPrev - 1;
    I.money = money;
    // Gegen Deflation: wächst die Wirtschaft schneller als das Geld, kommen neue Münzen (Silberfunde, Muscheln) in die Kassen
    if (I.pl < 0.8) {
      const add = money * 0.05;
      const tot = sets.reduce((a, s) => a + s.pop, 0) || 1;
      for (const s of sets) { const x = add * s.pop / tot; s.stock.gold += x; s.fin.mint += x; }
    }
    if (!I.cur && knows(st, 'handel', I.id)) {
      const G = LANGS[(sets[0].lang || 0) % LANGS.length];
      let n = '', tries = 0;
      do { n = (r.pick(G.syl) + r.pick(G.syl) + r.pick(['ar', 'en', 'ik', 'o', 'un', 'is', 'al', 'et'])).replace(/([aeiou])\1+/g, '$1').slice(0, 7); n = n.charAt(0).toUpperCase() + n.slice(1); }
      while (tries++ < 6 && st.isles.some(J => J.cur && J.cur.n === n));
      I.cur = { n, d: st.day };
      chron(st, 'wissen', L(`Auf ${I.name} wird zum ersten Mal Geld geprägt: der ${I.cur.n}. Muscheln und Tauschhandel haben ausgedient.`,
        `On ${I.name}, money is minted for the first time: the ${I.cur.n}. Shells and barter have had their day.`), sets[0].id, 1);
    }
    if (I.infl > 0.18 && sets.length) chron(st, 'politik', L(`Teuerung auf ${I.name}: Die Preise steigen in einem Jahr um ${Math.round(I.infl * 100)} Prozent. Wer Ersparnisse hat, sieht sie schmelzen.`,
      `Inflation on ${I.name}: prices rise ${Math.round(I.infl * 100)} percent in one year. Those with savings watch them melt.`), sets[0].id, 1);
    if (I.infl < -0.12 && sets.length) chron(st, 'politik', L(`Auf ${I.name} wird das Geld knapp, die Preise fallen um ${Math.round(-I.infl * 100)} Prozent. Schuldner stöhnen.`,
      `Money grows scarce on ${I.name}; prices fall ${Math.round(-I.infl * 100)} percent. Debtors groan.`), sets[0].id, 0);
  }
  for (const s of st.settlements) {
    if (!s.alive || !s.fin) continue;
    const M = members(st, s), all = M.adults.concat(M.old);
    // Zinsen
    const rate = s.laws.includes('zinsverbot') ? 0 : s.bank ? 0.05 : 0.08;
    for (const p of all) {
      if (p.debt > 0) {
        if (!p.nofee) { const i = p.debt * rate; p.debt += i; s.fin.interest += i; }
        if (s.laws.includes('schuldenerlass') && p.dSince && st.day - p.dSince > DAY * 7) { p.debt = 0; p.cred = 0; p.dSince = 0; bio(p, st.day, L('wird von alten Schulden befreit', 'is freed from old debts')); }
        // Verjährung: nach 15 Jahren schreibt auch der härteste Gläubiger eine Schuld ab
        if (p.dSince && st.day - p.dSince > DAY * 15) { p.debt = 0; p.cred = 0; p.dSince = 0; }
        p.bond = p.debt > (s.avgWage || 1) * 50 ? 1 : 0;
      }
      if (p.dep > 0 && s.bank) { const i = p.dep * 0.03; if (s.bank.res > i) { s.bank.res -= i; p.dep += i; } }
    }
    // Staatsschulden: Zinsen oder Bankrott
    if (s.bonds && s.bonds.length) {
      const debt = s.bonds.reduce((a, b) => a + b.amt, 0);
      if (debt > (s.fin.tax + 10) * 8 && r.chance(0.5)) {
        for (const b of s.bonds) { const p = rt.pById.get(b.id); if (p) { p.hap = clamp(p.hap - 0.3, 0, 1); bio(p, st.day, L(`verliert sein Geld beim Staatsbankrott`, `loses money in the state bankruptcy`)); } }
        s.bonds = [];
        s.unrest = clamp(s.unrest + 0.15, 0, 1);
        chron(st, 'politik', L(`Staatsbankrott in ${s.name}! Die Stadt zahlt ihre Schulden nicht zurück. Die Reichen toben, das Vertrauen ist dahin.`,
          `State bankruptcy in ${s.name}! The city will not repay its debts. The rich rage, trust is gone.`), s.id, 2);
      } else for (const b of s.bonds) {
        const p = rt.pById.get(b.id);
        const i = b.amt * 0.06;
        if (p) { s.stock.gold -= i; p.gold += i; s.fin.interest += i; }
        // tilgen, wenn die Kasse voll ist
        if (s.stock.gold > s.turn * 30 && p) { const x = Math.min(b.amt, s.stock.gold * 0.2); s.stock.gold -= x; p.gold += x; b.amt -= x; }
      }
      s.bonds = s.bonds.filter(b => b.amt > 0.5 && rt.pById.has(b.id));
    }
    // Bank: gründen, Einlagen sammeln, Bankensturm
    bankYear(st, s, M);
    // Bildung: Schulen machen Kinder klüger, das bringt später mehr Lohn
    const schools = bldOf(st, s).some(b => b.t === 'schule' && b.prog >= 1);
    if (schools) for (const k of M.kids) if (ageOf(st, k) >= 6 && (s.laws.includes('schulpflicht') || r.chance(0.35 + s.cult.wissen * 0.4))) k.edu = Math.min(1, (k.edu || 0) + 0.12);
    // Spenden: fromme Reiche geben, und man erinnert sich an sie
    for (const p of (rt.richest.get(s.id) || []).slice(0, 4)) {
      if (p.gold < s.avgWage * 80 || (p.tr.glaube + p.tr.charisma) < 1.2 || !r.chance(0.35)) continue;
      const g = p.gold * 0.08;
      p.gold -= g;
      const poor = M.adults.filter(q => (q.poor || 0) > 1 || (q.gold || 0) < s.price.food * 10);
      if (poor.length) for (const q of poor) q.gold += g * 0.7 / poor.length;
      s.stock.gold += g * 0.3;
      p.fame += 1; p.faith = clamp(p.faith + 0.05, 0, 1);
      bio(p, st.day, L(`spendet ${Math.round(g)} für die Armen`, `donates ${Math.round(g)} to the poor`));
      if (g > s.avgWage * 30) chron(st, 'leben', L(`${p.n} aus ${s.name} öffnet die Truhen und speist die Armen. Man nennt ${p.sex === 'f' ? 'sie' : 'ihn'} jetzt die Gütige Hand.`,
        `${p.n} of ${s.name} opens the chests and feeds the poor. People now call ${p.sex === 'f' ? 'her' : 'him'} the Kind Hand.`), s.id, 0);
    }
    // Korruption: Herrscher greifen in die Kasse
    const ld = leaderOf(st, s);
    if (ld && s.stock.gold > 20 && (ld.tr.wut + (1 - ld.tr.glaube) + (1 - ld.tr.fleiss)) > 1.7 && r.chance(0.25)) {
      const x = s.stock.gold * r.range(0.05, 0.18);
      s.stock.gold -= x; ld.gold += x;
      s.embez = (s.embez || 0) + x;
      if (r.chance(0.35 + (knows(st, 'zeitung', s) ? 0.3 : 0) + (s.laws.includes('freiedenker') ? 0.15 : 0))) {
        s.unrest = clamp(s.unrest + 0.12, 0, 1); s.omen = (s.omen || 0) + 0.05; ld.fame -= 2;
        bio(ld, st.day, L('wird der Veruntreuung überführt', 'is convicted of embezzlement'));
        chron(st, 'politik', L(`Skandal in ${s.name}: ${ld.lt} ${ld.n} hat ${Math.round(x)} aus der Stadtkasse in die eigene Truhe geschafft.`,
          `Scandal in ${s.name}: ${ld.lt} ${ld.n} has moved ${Math.round(x)} from the treasury into a private chest.`), s.id, 1);
      }
    }
    // Tribut an den Sieger eines Krieges
    if (s.tribute && s.tribute.until > st.day) {
      const to = rt.sById.get(s.tribute.to);
      if (to && to.alive) { const x = Math.max(0, s.stock.gold) * s.tribute.rate; s.stock.gold -= x; to.stock.gold += x; s.fin.exp += 0; to.fin.tariff += x; }
    }
    // Arbeitslose: wer keinen festen Platz hat (ab Stadtstaaten)
    s.unemp = s.era >= 3 ? M.adults.filter(p => p.job === 'sammler').length / Math.max(1, M.adults.length) : 0;
    // Abschluss des Jahres: Haushalt sichern, Klassen bestimmen
    s.finY = s.fin; s.fin = fin0();
    classes(st, s, all);
  }
  patronStep(st);
}

function bankYear(st, s, M) {
  const r = rng(st), rt = st._rt;
  if (!s.bank && knows(st, 'geldwesen', s) && bldOf(st, s).some(b => b.t === 'markt' && b.prog >= 1) && s.pop > 50) {
    const owner = (rt.richest.get(s.id) || []).find(p => p.job === 'haendler' || p.gold > s.avgWage * 120);
    if (owner) {
      const cap = owner.gold * 0.4;
      owner.gold -= cap;
      s.bank = { own: owner.id, res: cap, d: st.day };
      bio(owner, st.day, L(`gründet die Bank von ${s.name}`, `founds the bank of ${s.name}`));
      chron(st, 'wissen', L(`${owner.n} gründet in ${s.name} eine Bank. Wer Geld hat, legt es dort an, wer keins hat, leiht es dort.`,
        `${owner.n} founds a bank in ${s.name}. Those with money deposit it there, those without borrow it there.`), s.id, 1);
    }
  }
  const B = s.bank;
  if (!B) return;
  if (!rt.pById.has(B.own)) { const heir = (rt.richest.get(s.id) || [])[0]; if (heir) B.own = heir.id; }
  // Einlagen: Reiche legen Überschüsse an
  let deps = 0;
  for (const p of M.adults.concat(M.old)) {
    const free = (p.gold || 0) - s.avgWage * 60;
    if (free > 0 && r.chance(0.6)) { const x = free * 0.4; p.gold -= x; p.dep = (p.dep || 0) + x; B.res += x; }
    deps += p.dep || 0;
  }
  B.dep = deps;
  // Gewinn für den Bankier
  const o = rt.pById.get(B.own);
  if (o && B.res > deps * 0.35) { const x = (B.res - deps * 0.35) * 0.25; B.res -= x; o.gold += x; }
  // Bankensturm: Unruhe, Krieg oder leere Kasse treiben die Sparer an den Schalter
  const fear = s.unrest * 0.6 + (s.war ? 0.25 : 0) + (B.res < deps * 0.2 ? 0.3 : 0) + (isleOf(st, s)?.infl > 0.2 ? 0.2 : 0);
  if (deps > 50 && r.chance(clamp(fear - 0.3, 0, 0.5) * 0.4)) {
    const need = deps * 0.6;
    if (B.res >= need) {
      for (const p of M.adults.concat(M.old)) if (p.dep) { const x = p.dep * 0.6; p.dep -= x; p.gold += x; }
      B.res -= need;
      chron(st, 'politik', L(`Gerüchte in ${s.name}: Die Sparer stürmen die Bank. Sie hält stand, gerade so.`, `Rumors in ${s.name}: savers storm the bank. It holds, just barely.`), s.id, 0);
    } else {
      const quota = B.res / deps;
      for (const p of M.adults.concat(M.old)) if (p.dep) { p.gold += p.dep * quota; p.dep = 0; p.hap = clamp(p.hap - 0.2, 0, 1); }
      if (o) { o.fame -= 2; o.hap = clamp(o.hap - 0.4, 0, 1); bio(o, st.day, L('verliert die Bank im Ansturm', 'loses the bank in the run')); }
      for (const p of st.people) if (p.cred === -s.id) p.cred = 0; // Forderungen verfallen mit der Bank
      s.bank = null;
      s.unrest = clamp(s.unrest + 0.15, 0, 1);
      chron(st, 'politik', L(`Bankensturm in ${s.name}! Die Bank von ${o ? o.n : 'der Stadt'} bricht zusammen. Viele Familien verlieren ihr Erspartes.`,
        `Bank run in ${s.name}! The bank of ${o ? o.n : 'the city'} collapses. Many families lose their savings.`), s.id, 2);
    }
  }
}

// Klassen und Ungleichheit (Gini) aus dem Vermögen
function classes(st, s, all) {
  const rt = st._rt;
  if (!all.length) return;
  const w = all.map(p => [p, wealthOf(st, p)]).sort((a, b) => a[1] - b[1]);
  const n = w.length;
  let cum = 0, tot = 0;
  for (let i = 0; i < n; i++) { const v = Math.max(0, w[i][1]); tot += v; cum += v * (i + 1); }
  s.gini = tot > 0 ? clamp((2 * cum) / (n * tot) - (n + 1) / n, 0, 1) : 0;
  s.wealth = tot;
  s.top10 = tot > 0 ? w.slice(Math.floor(n * 0.9)).reduce((a, x) => a + Math.max(0, x[1]), 0) / tot : 0;
  const noble = ['koenigtum', 'haeuptling'].includes(s.gov.type) && s.gov.dyn;
  const sub = s.price.food * 25;
  for (let i = 0; i < n; i++) {
    const [p, v] = w[i];
    const q = i / n;
    let c = q < 0.2 || p.bond || (v < sub * 0.3 && q < 0.5) ? 0 : q < 0.7 ? 1 : q < 0.93 ? 2 : 3;
    // Ständeordnung (mobility.js, s.rig): in strengen Orten zählt die Herkunft mit, der Stand haftet an der Familie
    const k = Math.max(0, (s.rig ?? 0.45) - 0.3) * 1.1;
    if (k > 0 && p.oc != null && p.oc <= 3 && !p.bond) c = Math.round(c * (1 - k) + p.oc * k);
    if (noble && p.clan === s.gov.dyn && c >= 1) c = 4;
    p.cls = c;
  }
  void rt;
}

// ---------- Tägliche Hilfslisten ----------

// Die Reichsten je Siedlung (für Kredite, Investitionen, Diebe) und der Wert ihrer Betriebe
export function moneyIndex(st, force) {
  const rt = st._rt;
  if (!force && rt.richest && rt.richest.size && st.day % 3 !== 0) return;
  rt.richest = new Map();
  rt.kidsOf = new Map();
  for (const p of st.people) {
    if (p.mo) { const a = rt.kidsOf.get(p.mo) || []; a.push(p); rt.kidsOf.set(p.mo, a); }
    if (p.fa) { const a = rt.kidsOf.get(p.fa) || []; a.push(p); rt.kidsOf.set(p.fa, a); }
  }
  for (const s of st.settlements) {
    if (!s.alive) continue;
    const M = members(st, s);
    rt.richest.set(s.id, M.adults.concat(M.old).filter(p => (p.gold || 0) > 0).sort((a, b) => b.gold - a.gold).slice(0, 12));
  }
  if (st.day % 6 === 0 || !rt.ownVal) {
    rt.ownVal = new Map();
    for (const b of st.buildings) {
      if (!b.own || b.prog < 1) continue;
      const s = rt.sById.get(b.s);
      const v = buildingValue(s, b);
      rt.ownVal.set(b.own, (rt.ownVal.get(b.own) || 0) + v);
    }
  }
}

export function buildingValue(s, b) {
  const def = D.BUILDINGS[b.t], P = (s && s.price) || BASE;
  let v = 0;
  for (const [k, n] of Object.entries(def.cost || {})) v += n * (P[k] || 1) * (1 + (b.lvl || 0) * 0.15);
  return v * 3 + (b.t === 'haus' ? 12 : 20);
}

// ---------- Bauen und Besitz ----------

// Wer bezahlt einen Neubau? Betriebe und (ab der Bronzezeit) Häuser kaufen Reiche, sonst baut die Stadt.
export function financeBuild(st, s, b, cost) {
  if (!s.price) return;
  const r = rng(st), P = s.price;
  let v = 0;
  for (const [k, n] of Object.entries(cost)) v += n * (P[k] || 1);
  // Privatbesitz kommt mit Märkten und Geld (Bronzezeit), vorher gehören Felder und Werkstätten allen
  const privat = (SIGMA[b.t] != null && s.era >= 2) || (b.t === 'haus' && s.era >= 3);
  const communal = s.gov.type === 'volksrat' || (s.gov.type === 'rat' && s.cult.tradition > 0.6) || s.laws.includes('gemeinschaft');
  if (privat && !communal) {
    const inv = (st._rt.richest.get(s.id) || []).filter(p => p.gold > v * 1.6 && ageOf(st, p) < 70);
    if (inv.length) {
      const p = r.chance(0.6) ? inv[0] : r.pick(inv);
      p.gold -= v; s.mkt += v; b.own = p.id;
      if (b.t !== 'haus' || r.chance(0.2)) bio(p, st.day, L(`lässt ${D.BUILDINGS[b.t].name} bauen`, `has a ${D.BUILDINGS[b.t].name.toLowerCase()} built`));
      return;
    }
  }
  b.own = 0;
  s.stock.gold -= v; s.mkt += v; s.fin.build += v;
}

// ---------- Tod, Erbe ----------

export function estate(st, p) {
  const rt = st._rt, s = rt.sById.get(p.s);
  let wealth = (p.gold || 0) + (p.dep || 0);
  if (p.dep && s && s.bank) { s.bank.res -= p.dep; }
  // Schulden zuerst
  if (p.debt > 0) {
    const pay = Math.min(wealth, p.debt);
    if (s) repay(st, s, p, pay); wealth -= pay;
  }
  // Wer ihm etwas schuldet, schuldet es jetzt den Erben (vereinfacht: Forderungen gehen an das älteste Kind)
  const kids = (rt.kidsOf.get(p.id) || []).filter(k => rt.pById.has(k.id)).sort((a, b) => a.b - b.b);
  const pa = p.pa && rt.pById.get(p.pa);
  if (s && s.laws.includes('erbsteuer') && wealth > 0) { const t = wealth * 0.3; wealth -= t; s.stock.gold += t; s.fin.tax += t; }
  if (wealth > 0) {
    if (pa) { const x = kids.length ? wealth * 0.5 : wealth; pa.gold = (pa.gold || 0) + x; wealth -= x; }
    if (kids.length) for (const k of kids) k.gold = (k.gold || 0) + wealth / kids.length;
    else if (!pa && s) s.stock.gold += wealth;
  }
  const heir = kids[0] || pa || null;
  for (const b of st.buildings) if (b.own === p.id) b.own = heir ? heir.id : 0;
  for (const q of st.people) if (q.cred === p.id) q.cred = heir ? heir.id : 0;
  if (s && s.bank && s.bank.own === p.id) s.bank.own = heir ? heir.id : 0;
  if (s && s.bonds) for (const b of s.bonds) if (b.id === p.id) b.id = heir ? heir.id : 0;
  const total = (p.gold || 0) + (p.dep || 0);
  if (heir && s && total > s.avgWage * 150) {
    bio(heir, st.day, L(`erbt das Vermögen von ${p.n}`, `inherits the fortune of ${p.n}`));
    chron(st, 'leben', L(`Das Erbe von ${p.n} (${Math.round(total)} ${curName(st, s)}) geht an ${heir.n}.`, `The fortune of ${p.n} (${Math.round(total)} ${curName(st, s)}) passes to ${heir.n}.`), s.id, 0);
  }
  p.gold = 0; p.dep = 0;
}

// Eine neue Insel wird von Siedlern besiedelt: Preisniveau und Währung reisen mit
export function inheritIsle(I, J) {
  if (!I || !J || J === I) return;
  J.pl = I.pl || 1; J.plPrev = J.pl; J.k0 = 0;
  if (I.cur && !J.cur) J.cur = { n: I.cur.n, d: I.cur.d, from: I.id };
}

export const curName = (st, s) => { const I = isleOf(st, s); return I && I.cur ? I.cur.n : L('Muscheln', 'shells'); };

// ---------- Krieg ----------

// Eroberung: Sieger plündern die Truhen der Besiegten
export function plunder(st, win, lose) {
  const M = members(st, lose);
  let loot = 0;
  for (const p of M.all) { const x = (p.gold || 0) * 0.35; p.gold -= x; loot += x; }
  win.stock.gold += loot * 0.5;
  const sold = members(st, win).adults.filter(p => p.job === 'krieger');
  for (const p of sold) p.gold += loot * 0.5 / sold.length;
  if (!sold.length) win.stock.gold += loot * 0.5;
  return loot;
}

// Frieden mit Sieger: Tribut für einige Jahre
export function tribute(st, winner, loser) {
  loser.tribute = { to: winner.id, until: st.day + DAY * 5, rate: 0.12 };
}

// ---------- Reiche gründen Siedlungen ----------

function patronStep(st) {
  const r = rng(st), rt = st._rt;
  const alive = st.settlements.filter(s => s.alive);
  if (alive.length >= st._rt.maxSet) return;
  const count = id => alive.filter(o => o.isle === id).length;
  for (const s of alive) {
    if (s.era < 2) continue;
    const I = isleOf(st, s);
    const T = s.avgWage * 260 * (I ? I.pl : 1);
    const cand = (rt.richest.get(s.id) || []).find(p => p.gold > T && !p.lt && ageOf(st, p) >= 25 && ageOf(st, p) < 58 && p.tr.mut + p.tr.charisma > 0.95);
    if (!cand || !r.chance(0.3)) continue;
    let spot = null, target = I, sea = false;
    if (count(s.isle) < isleCap(I) + 1) spot = findNewHome(st, landOf(s), 16, 0.3, null, s);
    // übers Meer: leere Inseln oder Handelsposten auf bewohnten Inseln, die noch Platz haben (in der Erde nur zu Lande)
    if (!spot && !st.earth && knows(st, 'segeln', s) && bldOf(st, s).some(b => b.t === 'hafen')) {
      const isles = st.isles.filter(J => J.id !== s.isle && (I.seen[J.id] || I.contact[J.id]) && count(J.id) < isleCap(J))
        .sort((a, b) => count(a.id) - count(b.id));
      for (const J of isles) { spot = findNewHome(st, J.id, count(J.id) ? 16 : 0, 0.2); if (spot) { target = J; sea = true; break; } }
    }
    if (!spot) continue;
    // Gefolge: Familie, Angestellte, Schuldner, ein paar Glücksritter
    const M = members(st, s);
    const group = new Set([cand]);
    const pa = cand.pa && rt.pById.get(cand.pa);
    if (pa && pa.s === s.id && !pa.lt) group.add(pa);
    for (const k of (rt.kidsOf.get(cand.id) || [])) if (k.s === s.id && !k.lt) group.add(k);
    const mine = new Set(st.buildings.filter(b => b.own === cand.id).map(b => b.id));
    for (const p of M.adults) if (group.size < 10 && !p.lt && (mine.has(p.w) || p.cred === cand.id)) group.add(p);
    for (const p of r.shuffle(M.adults.slice())) { if (group.size >= 14) break; if (!p.lt && !p.pa && (p.poor || 0) > 0) group.add(p); }
    if (group.size < 8) continue;
    if (sea) {
      if (!count(target.id)) inheritIsle(I, target);
      for (const t of I.techs) if (!target.techs.includes(t)) { target.techs.push(t); rt.isleKnown.get(target.id).add(t); }
      target.era = Math.max(target.era, I.era);
      target.contact[I.id] = I.contact[target.id] = st.day;
      target.seen[I.id] = I.seen[target.id] = st.day;
      if (!target.research.cur) target.research.cur = I.research.cur;
    }
    const invest = cand.gold * 0.5;
    cand.gold -= invest;
    const gov = s.era >= 3 && s.cult.handel > 0.45 ? 'republik' : 'koenigtum';
    const ns = foundSettlement(st, spot[0], spot[1], [...group], { parent: s, leader: cand, gov, cultShift: { handel: 0.15, freiheit: 0.05 } });
    ns.price = { ...s.price }; ns.mkt = 30; ns.fin = fin0(); ns.avgWage = s.avgWage;
    ns.stock.gold += invest * 0.6; ns.stock.wood += 20; ns.stock.tools += 6; ns.stock.food += 40;
    ns.patron = cand.id;
    s.rel[ns.id] = ns.rel[s.id] = 55;
    if (gov === 'koenigtum') ns.gov.dyn = cand.clan;
    cand.fame += 5;
    bio(cand, st.day, L(`gründet mit eigenem Geld ${ns.name}`, `founds ${ns.name} with private money`));
    if (sea) st.voyages.push({ k: 'siedler', a: s.id, b: ns.id, d: st.day, dur: 5 });
    st.counts.patrons = (st.counts.patrons || 0) + 1;
    chron(st, 'gruendung', sea
      ? L(`${cand.n}, die reichste Hand von ${s.name}, kauft Schiffe und Vorräte und segelt mit ${group.size} Menschen nach ${target.name}. Dort entsteht ${ns.name}, ihre eigene Stadt.`,
        `${cand.n}, the richest hand in ${s.name}, buys ships and supplies and sails with ${group.size} people to ${target.name}. There ${ns.name} rises, a city of their own.`)
      : st.earth ? L(`${cand.n} aus ${s.name} kauft Land ${Math.round(Math.hypot(ns.cx - s.cx, ns.cy - s.cy) * 19.6 / 10) * 10} km entfernt und zieht mit ${group.size} Leuten dorthin. Mit ${Math.round(invest)} ${curName(st, s)} entsteht ${ns.name}.`,
        `${cand.n} of ${s.name} buys land ${Math.round(Math.hypot(ns.cx - s.cx, ns.cy - s.cy) * 19.6 / 10) * 10} km away and moves there with ${group.size} people. With ${Math.round(invest)} ${curName(st, s)}, ${ns.name} is born.`)
      : L(`${cand.n} aus ${s.name} kauft Land am anderen Ende der Insel und zieht mit ${group.size} Leuten dorthin. Mit ${Math.round(invest)} ${curName(st, s)} entsteht ${ns.name}.`,
        `${cand.n} of ${s.name} buys land at the far end of the island and moves there with ${group.size} people. With ${Math.round(invest)} ${curName(st, s)}, ${ns.name} is born.`),
      ns.id, 2, { x: ns.cx, y: ns.cy });
    fx(st, { type: 'found', s: ns.id });
    return;
  }
}

// ---------- Handel über Preisunterschiede ----------

// Paare von Siedlungen, die handeln können (gleiche Insel über Land, sonst Häfen mit Kontakt)
export function tradeStep(st) {
  const r = rng(st), rt = st._rt;
  const sets = st.settlements.filter(s => s.alive && s.price && s.era >= 1);
  const harbor = new Set(st.buildings.filter(b => b.t === 'hafen' && b.prog >= 1).map(b => b.s));
  const market = new Set(st.buildings.filter(b => b.t === 'markt' && b.prog >= 1).map(b => b.s));
  st.flows = [];
  const routes = [];
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
    const x = sets[i], y = sets[j];
    const same = sameLand(st, x, y) && (x.isle === y.isle || !!(isleOf(st, x)?.contact[y.isle]));
    if (x.war === y.id || (x.rel[y.id] ?? 0) < -20 || x.laws.includes('abschottung') || y.laws.includes('abschottung')) continue;
    const dist = Math.hypot(x.cx - y.cx, x.cy - y.cy);
    const road = same && netRoad(st, x.id, y.id);   // seit 19.10.2026 zählt jeder fertige Weg über das Netz
    if (same) { if (dist > (road ? 130 : 70)) continue; }
    else {
      const Ix = isleOf(st, x), Iy = isleOf(st, y);
      if (!Ix || !Iy || (Ix !== Iy && !Ix.contact[Iy.id]) || !harbor.has(x.id) || !harbor.has(y.id)) continue;
      if (st.earth && dist > (knows(st, 'navigation', x) || knows(st, 'navigation', y) ? 999 : knows(st, 'schiffbau', x) || knows(st, 'schiffbau', y) ? 130 : 75)) continue;
    }
    const Mx = members(st, x), My = members(st, y);
    const mx = Mx.adults.filter(p => p.job === 'haendler'), my = My.adults.filter(p => p.job === 'haendler');
    let cap = 2 + (mx.length + my.length) * 2.5 + (market.has(x.id) ? 3 : 0) + (market.has(y.id) ? 3 : 0);
    if (!same) cap *= knows(st, 'schiffbau', x) ? 2 : 1.3;
    // Straßen machen den Landweg billig, Schiffbau und Navigation den Seeweg
    const costMul = same ? (road ? 0.04 + dist * 0.0012 : 0.08 + dist * 0.003) : (knows(st, 'navigation', x) ? 0.18 : knows(st, 'schiffbau', x) ? 0.25 : 0.35);
    if (road) cap *= 1.5;
    let volume = 0;
    for (const g of GOODS) {
      let [a, b] = x.price[g] < y.price[g] ? [x, y] : [y, x];
      const c = BASE[g] * costMul * ((isleOf(st, a)?.pl || 1) + (isleOf(st, b)?.pl || 1)) / 2;
      const diff = b.price[g] - a.price[g];
      if (diff <= c * 1.15) continue;
      const da = demandOf(a, g, a === x ? Mx : My), db = demandOf(b, g, b === x ? Mx : My);
      const surplus = (a.stock[g] || 0) - da * 16, deficit = db * 24 - (b.stock[g] || 0);
      let v = Math.min(surplus, deficit, cap * 4 / BASE[g]);
      if (!(v > 0.2)) continue;
      a.stock[g] -= v; b.stock[g] = (b.stock[g] || 0) + v * 0.97;
      const pay = v * b.price[g], recv = v * a.price[g];
      b.mkt -= pay; a.mkt += recv;
      let profit = pay - recv;
      const tariff = b.laws.includes('schutzzoll') ? pay * 0.18 : b.laws.includes('freihandel') ? 0 : pay * 0.04;
      profit -= tariff; b.stock.gold += tariff; b.fin.tariff += tariff;
      a.fin.exp += recv; b.fin.imp += pay;
      // Gewinn an die Händler beider Seiten, ohne Händler an die Märkte
      const traders = (a === x ? mx : my).concat(b === x ? mx : my);
      if (traders.length) for (const p of traders) earn(st, rt.sById.get(p.s), p, profit / traders.length, 'profit');
      else { a.mkt += profit * 0.5; b.mkt += profit * 0.5; }
      if (!same && g === 'goods') b.exotic = Math.min(1, (b.exotic || 0) + v * 0.02);
      volume += pay;
      st.flows.push({ a: a.id, b: b.id, g, v: Math.round(v * 10) / 10, val: Math.round(pay) });
    }
    if (volume > 0) {
      routes.push({ a: x.id, b: y.id, sea: !same, road, val: Math.round(volume) });
      // wer handelt, mag sich mehr
      x.rel[y.id] = y.rel[x.id] = clamp((x.rel[y.id] ?? 0) + Math.min(2.5, volume / 60), -100, 100);
    }
  }
  st.routes = routes;
  if (st.flows.length > 60) st.flows.sort((a, b) => b.val - a.val).length = 60;
  void r;
}
