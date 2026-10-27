// Beziehungen zwischen Menschen: Freundschaft, Feindschaft, Blutfehden zwischen Familien, Verlieben, Verlobung,
// Hochzeit (Mitgift oder Brautpreis, Festkosten, politische Ehen), Ehezufriedenheit, Affären (der Gott sieht sie),
// Scheidung mit Vermögensteilung, Witwen, Wiederheirat, Waisen und Adoption, gleichgeschlechtliche Paare je nach Kultur.
// Jede Person hat p.ties = { id: Wert -100..100 } (höchstens 12), p.pa = Ehepartner, p.fi = Verlobt mit,
// p.ex = frühere Partner, p.aff = heimliche Affäre, p.ms = Zufriedenheit in der Ehe, p.wid = verwitwet seit.
import * as D from './data.js';
import { clamp } from './rng.js';
import { ageOf, chron, bio, members, rng, killPerson, sameLand } from './util.js';
import { leaderOf } from './society.js';
import { L } from '../i18n.js';

const MAXT = 12;
const YEAR = D.DAYS_PER_YEAR;

export const related = (a, b) => a.mo && (a.mo === b.mo || a.mo === b.id) || a.fa && (a.fa === b.fa || a.fa === b.id) || b.mo === a.id || b.fa === a.id;
export const tieOf = (p, q) => (p.ties && p.ties[q.id]) || 0;

export function initSocial(st) {
  if (st.social) return;
  st.social = 1;
  const r = rng(st);
  for (const p of st.people) {
    p.ties = p.ties || {};
    if (p.ori == null) p.ori = r.chance(0.94) ? 0 : r.chance(0.6) ? 1 : 2;
    const q = p.pa && st._rt.pById.get(p.pa);
    if (q) { p.ties[q.id] = 70; p.ms = 0.65; p.wed = p.wed ?? Math.max(0, st.day - YEAR * 3); }
  }
  // Alter Spielstand: ein paar Freundschaften unter Nachbarn und Kollegen anlegen
  for (const s of st.settlements) {
    if (!s.alive) continue;
    const M = members(st, s), pool = M.adults.concat(M.old);
    for (const p of pool) for (let k = 0; k < 3; k++) {
      const q = r.pick(pool);
      if (q && q !== p) setTie(p, q, clamp(compat(st, p, q) * 80 + r.gauss() * 25, -60, 80));
    }
  }
}

// Kürzen auf MAXT passiert gesammelt im Zählen (socialStep), nicht bei jedem Setzen
function setTie(p, q, v) {
  p.ties = p.ties || {}; q.ties = q.ties || {};
  p.ties[q.id] = Math.round(v); q.ties[p.id] = Math.round(v);
}

function prune(p) {
  const ks = Object.keys(p.ties);
  let worst = null, wv = Infinity;
  for (const k of ks) { if (+k === p.pa || +k === p.fi || +k === p.aff) continue; const v = Math.abs(p.ties[k]); if (v < wv) { wv = v; worst = k; } }
  if (worst != null) delete p.ties[worst];
}

// Wie gut zwei Menschen zusammenpassen (etwa -0.5 bis 0.6)
export function compat(st, p, q) {
  let d = 0;
  for (const k of ['glaube', 'neugier', 'kunst', 'wut', 'fleiss']) d += Math.abs(p.tr[k] - q.tr[k]);
  let c = 0.36 - d / 5 * 1.1;
  c += (p.fac === q.fac ? 0.12 : 0) + (p.clan === q.clan ? 0.06 : 0) + (p.job === q.job ? 0.06 : 0);
  c += ((p.tr.charisma + q.tr.charisma) / 2 - 0.5) * 0.3 - ((p.tr.wut + q.tr.wut) / 2 - 0.5) * 0.4;
  c -= Math.abs((p.faith ?? 0.5) - (q.faith ?? 0.5)) * 0.25;
  // in strengen Ständeordnungen bleibt man eher unter seinesgleichen (mobility.js, s.rig)
  const sp = st._rt.sById.get(p.s), rig = sp && sp.rig != null ? sp.rig : 0.45;
  c -= Math.abs((p.cls ?? 1) - (q.cls ?? 1)) * 0.06 * (0.4 + rig * 1.4);
  c -= Math.min(0.3, Math.abs(ageOf(st, p) - ageOf(st, q)) / 60);
  return c;
}

// Wer kann wen lieben? (ori: 0 andere Geschlecht, 1 gleiches, 2 beide)
const attracted = (p, q) => (p.ori === 2 || (p.ori === 1) === (p.sex === q.sex)) && (q.ori === 2 || (q.ori === 1) === (q.sex === p.sex));
const single = (st, p) => !p.pa && !p.fi && ageOf(st, p) >= 16 && !(p.wid && st.day - p.wid < YEAR) && !(p.div && st.day - p.div < YEAR / 2);
// Darf ein gleichgeschlechtliches Paar offen heiraten?
const openly = s => (s.era >= 5 ? s.cult.freiheit > 0.35 : s.cult.freiheit > 0.6 && s.cult.tradition < 0.45) && s.gov.type !== 'theokratie';
const notable = p => p.lt || p.title || p.fame >= 3 || (p.cls ?? 1) >= 3;
const nm = p => (p.lt ? p.lt + ' ' : '') + p.n;

// ---------- alle 3 Tage ----------

export function socialStep(st) {
  const r = rng(st), rt = st._rt;
  for (const s of st.settlements) {
    if (!s.alive) continue;
    const M = members(st, s);
    const pool = M.adults.concat(M.old, M.kids.filter(k => ageOf(st, k) >= 12));
    if (pool.length < 2) continue;
    const byWork = new Map();
    for (const p of M.adults) if (p.w > 0) { const a = byWork.get(p.w) || []; a.push(p); byWork.set(p.w, a); }
    const partners = (st.routes || []).filter(x => x.a === s.id || x.b === s.id).map(x => rt.sById.get(x.a === s.id ? x.b : x.a)).filter(Boolean);
    for (const p of pool) {
      if (p.dead || !r.chance(0.55)) continue;
      let q = null;
      const roll = r.next();
      if (roll < 0.3 && p.w > 0) q = r.pick(byWork.get(p.w) || []);
      else if (roll < 0.62) { const ks = Object.keys(p.ties || {}); if (ks.length) q = rt.pById.get(+r.pick(ks)); }
      else if (roll < 0.68 && p.job === 'haendler' && partners.length) { const o = r.pick(partners); const Mo = members(st, o); q = r.pick(Mo.adults); }
      if (!q) { const a = r.pick(pool), b = r.pick(pool); q = Math.abs(ageOf(st, a) - ageOf(st, p)) < Math.abs(ageOf(st, b) - ageOf(st, p)) ? a : b; }
      if (!q || q === p || q.dead) continue;
      interact(st, s, p, q, r);
    }
    // Hochzeiten, die fällig sind
    for (const p of pool) {
      if (!p.fi || st.day < (p.wedAt || 0)) continue;
      const q = rt.pById.get(p.fi);
      if (!q || q.fi !== p.id || q.pa || p.pa) { p.fi = null; continue; }
      if (p.id < q.id) wedding(st, s, p, q, r);
    }
    // Familien stiften Ehen, wenn die Liebe auf sich warten lässt
    arranged(st, s, M, r);
    // Freunde und Feinde zählen (für Glück und Anzeige), Listen kürzen. Tote verschwinden schon in socialDeath.
    if (st.day % 6 === 1) for (const p of pool) {
      let nf = 0, ne = 0, n = 0;
      for (const k in p.ties) { n++; const v = p.ties[k]; if (v > 35) nf++; else if (v < -35) ne++; }
      p.nf = nf; p.ne = ne;
      while (n-- > MAXT) prune(p);
    }
    if (st.day % 12 === 1) marriagesCheck(st, s, M, r);
  }
}

function interact(st, s, p, q, r) {
  const c = compat(st, p, q);
  let d = c * (c < -0.05 ? 24 : 18) + r.gauss() * 10;
  const feud = s.feuds && s.feuds.find(f => (f.a === p.clan && f.b === q.clan) || (f.b === p.clan && f.a === q.clan));
  if (feud) d -= 10;
  let quarrel = false;
  if (p.tr.wut + q.tr.wut > 1.1 && r.chance(0.15 + (feud ? 0.2 : 0))) { d -= 24; quarrel = true; }
  const cur = tieOf(p, q);
  const nv = clamp(cur + d * (1 - Math.abs(cur) / 140), -100, 100);
  setTie(p, q, nv);
  if (ageOf(st, p) < 14 || ageOf(st, q) < 14) return;
  // Wendepunkte
  if (cur <= 70 && nv > 70 && !(p.pa === q.id)) { bio(p, st.day, L(`wird ${q.sex === 'f' ? 'beste Freundin' : 'bester Freund'}: ${q.n}`, `becomes best friends with ${q.n}`)); }
  if (cur >= -60 && nv < -60) { bio(p, st.day, L(`verfeindet sich mit ${q.n}`, `becomes enemies with ${q.n}`)); bio(q, st.day, L(`verfeindet sich mit ${p.n}`, `becomes enemies with ${p.n}`)); }
  // Gewalt: alte Feindschaft und heißes Blut
  if (quarrel && nv < -70 && p.tr.wut > 0.65 && r.chance(0.08)) {
    if (r.chance(0.12)) {
      killPerson(st, q, 'Streit');
      bio(p, st.day, L(`erschlägt ${q.n} im Streit`, `kills ${q.n} in a quarrel`));
      p.fame -= 1; p.hap = clamp(p.hap - 0.3, 0, 1);
      startFeud(st, s, p.clan, q.clan, r);
      chron(st, 'tod', L(`Blut in ${s.name}: ${p.n} erschlägt ${q.n} im Streit. Die Familie ${q.clan} schwört Rache.`, `Blood in ${s.name}: ${p.n} kills ${q.n} in a quarrel. The ${q.clan} family swears revenge.`), s.id, 1);
    } else {
      q.hp = clamp(q.hp - 0.25, 0, 1);
      bio(q, st.day, L(`wird von ${p.n} verprügelt`, `is beaten by ${p.n}`));
      if (p.clan !== q.clan && r.chance(0.25)) startFeud(st, s, p.clan, q.clan, r);
    }
    return;
  }
  // Liebe
  const pa = ageOf(st, p), qa = ageOf(st, q);
  if (nv > 30 && single(st, p) && single(st, q) && attracted(p, q) && !related(p, q) && Math.abs(pa - qa) < 16 && pa < 70) {
    const attraction = c + (q.tr.charisma - 0.5) * 0.4 + r.next() * 0.45;
    if (attraction > 0.3 && p.lov !== q.id) { p.lov = q.id; bio(p, st.day, L(`verliebt sich in ${q.n}`, `falls in love with ${q.n}`)); }
    if (p.lov === q.id && q.lov === p.id && nv > 50) {
      p.fi = q.id; q.fi = p.id;
      p.wedAt = q.wedAt = st.day + r.int(6, 18);
      bio(p, st.day, L(`verlobt sich mit ${q.n}`, `gets engaged to ${q.n}`)); bio(q, st.day, L(`verlobt sich mit ${p.n}`, `gets engaged to ${p.n}`));
    }
    return;
  }
  // Affäre: unglücklich verheiratet trifft auf viel Nähe
  if (p.pa && p.pa !== q.id && !p.aff && nv > 45 && attracted(p, q) && (p.ms ?? 0.6) < 0.5 && ageOf(st, q) >= 16 && !related(p, q) && r.chance(0.12)) {
    p.aff = q.id; if (!q.aff) q.aff = p.id;
    p.affD = st.day;
  }
}

function startFeud(st, s, a, b, r) {
  if (a === b) return;
  s.feuds = s.feuds || [];
  if (s.feuds.some(f => (f.a === a && f.b === b) || (f.a === b && f.b === a))) return;
  s.feuds.push({ a, b, d: st.day });
  s.unrest = clamp(s.unrest + 0.04, 0, 1);
  if (r.chance(0.6)) chron(st, 'politik', L(`Fehde in ${s.name}: Die Familien ${a} und ${b} reden nicht mehr miteinander, nur noch mit Fäusten.`, `Feud in ${s.name}: the ${a} and ${b} families no longer speak to each other, only with fists.`), s.id, 0);
}

// ---------- Hochzeit ----------

function wedding(st, s, p, q, r, political) {
  const rt = st._rt;
  delete p.fi; delete q.fi; delete p.lov; delete q.lov;
  const same = p.sex === q.sex;
  const secret = same && !openly(s);
  p.pa = q.id; q.pa = p.id;
  p.wed = q.wed = st.day;
  p.ms = q.ms = 0.78;
  p.sec = q.sec = secret ? 1 : 0;
  setTie(p, q, Math.max(75, tieOf(p, q)));
  // Wohnort: der Partner aus dem kleineren Ort zieht um
  if (p.s !== q.s) {
    const sp = rt.sById.get(p.s), sq = rt.sById.get(q.s);
    const [stay, move] = (sp?.pop || 0) >= (sq?.pop || 0) ? [p, q] : [q, p];
    const from = rt.sById.get(move.s);
    move.s = stay.s; move.home = -1; move.w = -1; move.fac = null;
    if (from && sp && sq) { from.rel[stay.s] = rt.sById.get(stay.s).rel[from.id] = clamp((from.rel[stay.s] ?? 0) + 8, -100, 100); }
    bio(move, st.day, L(`zieht zu ${stay.n} nach ${rt.sById.get(stay.s)?.name || ''}`, `moves to ${rt.sById.get(stay.s)?.name || ''} to be with ${stay.n}`));
  }
  const home = rt.sById.get(p.s) || s;
  // Mitgift (Tradition) oder Brautpreis (Macht) zwischen den Familien
  let gift = '';
  if (!same) {
    const bride = p.sex === 'f' ? p : q, groom = bride === p ? q : p;
    const bp = (bride.mo && rt.pById.get(bride.mo)) || (bride.fa && rt.pById.get(bride.fa));
    const gp = (groom.mo && rt.pById.get(groom.mo)) || (groom.fa && rt.pById.get(groom.fa));
    if (home.cult.tradition > 0.55 && bp && bp.gold > 5) { const x = bp.gold * 0.12; bp.gold -= x; groom.gold = (groom.gold || 0) + x; gift = 'mitgift'; }
    else if (home.cult.macht > 0.55 && gp && gp.gold > 5 && bp) { const x = gp.gold * 0.1; gp.gold -= x; bp.gold += x; gift = 'brautpreis'; }
  }
  // Das Fest kostet, je reicher, desto prächtiger. Das Geld geht an den Markt.
  const cls = Math.max(p.cls ?? 1, q.cls ?? 1);
  const want = (home.avgWage || 1) * (4 + cls * 10) * (secret ? 0.2 : 1);
  let paid = 0;
  for (const x of [p, q]) { const y = Math.min(want / 2, Math.max(0, (x.gold || 0) * 0.25)); x.gold -= y; paid += y; }
  home.mkt = (home.mkt || 0) + paid;
  if (home.fin) home.fin.lux += paid;
  for (const x of [p, q]) for (const k in x.ties) { const f = rt.pById.get(+k); if (f && x.ties[k] > 40) f.hap = clamp(f.hap + 0.03, 0, 1); }
  // Eine Hochzeit kann eine Fehde beenden
  let peace = false;
  if (home.feuds && p.clan !== q.clan) {
    const n = home.feuds.length;
    home.feuds = home.feuds.filter(f => !((f.a === p.clan && f.b === q.clan) || (f.a === q.clan && f.b === p.clan)));
    peace = home.feuds.length < n;
  }
  st.counts.weddings = (st.counts.weddings || 0) + 1;
  home.yr = home.yr || {}; home.yr.wed = (home.yr.wed || 0) + 1;
  bio(p, st.day, secret ? L(`lebt von nun an heimlich mit ${q.n}`, `secretly lives with ${q.n} from now on`) : L(`heiratet ${q.n}`, `marries ${q.n}`));
  bio(q, st.day, secret ? L(`lebt von nun an heimlich mit ${p.n}`, `secretly lives with ${p.n} from now on`) : L(`heiratet ${p.n}`, `marries ${p.n}`));
  if (secret) return;
  const giftTxt = gift === 'mitgift' ? L(' Die Mitgift ist üppig.', ' The dowry is lavish.') : gift === 'brautpreis' ? L(' Der Brautpreis wird in Silber gezahlt.', ' The bride price is paid in silver.') : '';
  if (political) return;
  if (peace) chron(st, 'fest', L(`${p.n} und ${q.n} heiraten in ${home.name}. Die Hochzeit beendet die Fehde zwischen den Familien ${p.clan} und ${q.clan}.`, `${p.n} and ${q.n} marry in ${home.name}. The wedding ends the feud between the ${p.clan} and ${q.clan} families.`), home.id, 1);
  else if (notable(p) || notable(q)) chron(st, 'fest', r.pick(L([
    `Prächtige Hochzeit in ${home.name}: ${nm(p)} und ${nm(q)} laden die halbe Stadt ein.${giftTxt}`,
    `${nm(p)} heiratet ${nm(q)}. In ${home.name} wird drei Tage gefeiert.${giftTxt}`,
  ], [
    `A splendid wedding in ${home.name}: ${nm(p)} and ${nm(q)} invite half the town.${giftTxt}`,
    `${nm(p)} marries ${nm(q)}. ${home.name} celebrates for three days.${giftTxt}`,
  ])), home.id, 0);
  else if (same) chron(st, 'fest', L(`${p.n} und ${q.n} heiraten in ${home.name}. Nicht alle verstehen es, aber die Freunde tanzen.`, `${p.n} and ${q.n} marry in ${home.name}. Not everyone understands, but their friends dance.`), home.id, 0);
}

function arranged(st, s, M, r) {
  // Unerwiderte Liebe hält die Familien nicht lange auf
  const open = openly(s);
  const cand = M.adults.filter(p => single(st, p) && ageOf(st, p) >= 18 && ageOf(st, p) <= 42 && !(open && p.ori === 1));
  if (!cand.length) return;
  // fehlt am Ort ein passender Mensch, schauen die Familien in den Nachbarorten derselben Insel
  let far = null;
  const nearby = () => far || (far = st.settlements.filter(o => o.alive && o !== s && sameLand(st, o, s) && !o.war && (o.rel[s.id] ?? 0) > -10)
    .flatMap(o => members(st, o).adults.filter(p => single(st, p) && ageOf(st, p) >= 18 && ageOf(st, p) <= 42)));
  const pull = 0.11 * (0.6 + s.cult.tradition) * ((st.char && st.char.fert) || 1);
  for (const p of cand) {
    if (p.fi || !r.chance(pull * (ageOf(st, p) > 25 ? 1.8 : 1) * (p.ori === 1 ? 0.3 : 1))) continue;
    let best = null, bs = -9;
    const look = list => {
      for (const q of list) {
        if (q === p || q.fi || q.pa || q.sex === p.sex || related(p, q) || Math.abs(ageOf(st, p) - ageOf(st, q)) > 12) continue;
        const sc = compat(st, p, q) - Math.abs((p.cls ?? 1) - (q.cls ?? 1)) * 0.15 * (0.4 + ((st._rt.sById.get(p.s) || {}).rig ?? 0.45) * 1.4) + tieOf(p, q) / 200 + r.next() * 0.4;
        if (sc > bs) { bs = sc; best = q; }
      }
    };
    look(cand);
    if (!best && r.chance(0.5)) look(nearby());
    if (!best) continue;
    delete p.lov; delete best.lov;
    p.fi = best.id; best.fi = p.id;
    p.wedAt = best.wedAt = st.day + r.int(4, 12);
    setTie(p, best, Math.max(tieOf(p, best), 20));
    bio(p, st.day, L(`wird von den Familien ${best.n} versprochen`, `is promised to ${best.n} by the families`));
    bio(best, st.day, L(`wird von den Familien ${p.n} versprochen`, `is promised to ${p.n} by the families`));
  }
}

// ---------- Ehe: Zufriedenheit, Affären, Scheidung (alle 12 Tage) ----------

function divorceCulture(s) {
  if (s.gov.type === 'theokratie') return 0.05;
  return clamp(0.4 + s.cult.freiheit * 1.2 - s.cult.tradition * 0.6 - s.cult.glaube * 0.3, 0.05, 1.6) * (s.era >= 5 ? 1.6 : s.era >= 2 ? 1 : 0.6);
}

function marriagesCheck(st, s, M, r) {
  const rt = st._rt;
  for (const p of M.adults.concat(M.old)) {
    const q = p.pa && rt.pById.get(p.pa);
    if (!q || p.id > q.id) continue;
    const t = tieOf(p, q);
    const kids = (rt.kidsOf.get(p.id) || []).some(k => k.mo === q.id || k.fa === q.id);
    const stress = ((p.poor > 4 || q.poor > 4) ? 0.12 : 0) + (s.hunger || 0) * 0.3 + (p.bond || q.bond ? 0.08 : 0);
    // Mit den Jahren wird es schwerer: Alltag, Geld, Streit. Jede Ehe hat ihr eigenes Grundglück (aus den Ids).
    const years = (st.day - (p.wed || st.day)) / YEAR;
    const fate = (((p.id * 7919 + q.id * 104729) % 1000) / 1000 - 0.5) * 0.5;
    const target = 0.3 + t / 420 + ((p.hap + q.hap) / 2 - 0.5) * 0.5 + (kids ? 0.05 : 0) - stress - ((p.tr.wut + q.tr.wut) / 2 - 0.5) * 0.6
      + compat(st, p, q) * 0.35 + fate - Math.min(0.15, years * 0.01) - (p.aff || q.aff ? 0.1 : 0);
    let ms = clamp((p.ms ?? 0.6) + (target - (p.ms ?? 0.6)) * 0.25 + r.gauss() * 0.07, 0, 1);
    // Krisen: ein Streit ums Geld, eine Kränkung, ein verlorenes Kind
    if (r.chance(0.035)) { ms = clamp(ms - r.range(0.15, 0.35), 0, 1); if (r.chance(0.3)) bio(p, st.day, L(`steckt in einer Ehekrise mit ${q.n}`, `is in a marriage crisis with ${q.n}`)); }
    p.ms = q.ms = ms;
    setTie(p, q, clamp(t + (ms - 0.55) * 10, -100, 100));
    // Affäre fliegt auf
    let found = false;
    for (const [x, y] of [[p, q], [q, p]]) {
      if (!x.aff || !r.chance(0.18)) continue;
      const lover = rt.pById.get(x.aff);
      found = true;
      x.affKnown = 1;
      p.ms = q.ms = clamp(ms - 0.35, 0, 1);
      setTie(x, y, tieOf(x, y) - 50);
      if (lover) { setTie(y, lover, Math.min(tieOf(y, lover), -70)); if (lover.aff === x.id) delete lover.aff; }
      bio(y, st.day, L(`erfährt, dass ${x.n} heimlich ${lover ? lover.n : 'jemand anderen'} liebt`, `learns that ${x.n} secretly loves ${lover ? lover.n : 'someone else'}`));
      if (notable(x) || notable(y)) chron(st, 'leben', L(`Skandal in ${s.name}: ${nm(x)} hat eine heimliche Liebschaft mit ${lover ? lover.n : 'jemandem aus der Stadt'}.`, `Scandal in ${s.name}: ${nm(x)} has a secret affair with ${lover ? lover.n : 'someone from the town'}.`), s.id, 0);
      delete x.aff;
    }
    // Scheidung
    if (p.ms < 0.33 && r.chance(0.05 * divorceCulture(s) * (found ? 2.2 : 1))) divorce(st, s, p, q, r);
  }
}

function divorce(st, s, p, q, r) {
  p.pa = q.pa = null;
  p.ex = [...(p.ex || []), q.id].slice(-3); q.ex = [...(q.ex || []), p.id].slice(-3);
  p.div = q.div = st.day;
  delete p.ms; delete q.ms;
  // Vermögen teilen: in traditionellen Orten bekommt die Frau weniger
  const total = Math.max(0, p.gold || 0) + Math.max(0, q.gold || 0);
  const f = p.sex === 'f' ? p : q.sex === 'f' ? q : null;
  const share = f && s.cult.tradition > 0.6 ? 0.3 : 0.5;
  if (f) { const o = f === p ? q : p; f.gold = total * share; o.gold = total * (1 - share); }
  else { p.gold = q.gold = total / 2; }
  setTie(p, q, Math.min(tieOf(p, q), -20));
  p.hap = clamp(p.hap - 0.15, 0, 1); q.hap = clamp(q.hap - 0.15, 0, 1);
  st.counts.divorces = (st.counts.divorces || 0) + 1;
  s.yr = s.yr || {}; s.yr.div = (s.yr.div || 0) + 1;
  bio(p, st.day, L(`lässt sich von ${q.n} scheiden`, `divorces ${q.n}`)); bio(q, st.day, L(`lässt sich von ${p.n} scheiden`, `divorces ${p.n}`));
  if (notable(p) || notable(q) || r.chance(0.15)) chron(st, 'leben', L(`Scheidung in ${s.name}: ${nm(p)} und ${nm(q)} gehen getrennte Wege. Die Stadt redet von nichts anderem.`, `Divorce in ${s.name}: ${nm(p)} and ${nm(q)} go their separate ways. The town talks of nothing else.`), s.id, 0);
}

// ---------- Tod ----------

export function socialDeath(st, p) {
  const rt = st._rt;
  const q = p.pa && rt.pById.get(p.pa);
  if (q) {
    q.wid = st.day;
    q.exw = p.id;
    delete q.ms;
    q.hap = clamp(q.hap - 0.25, 0, 1);
    bio(q, st.day, q.sex === 'f' ? L(`wird Witwe, ${p.n} ist tot`, `is widowed, ${p.n} is dead`) : L(`wird Witwer, ${p.n} ist tot`, `is widowed, ${p.n} is dead`));
  }
  for (const k in p.ties || {}) {
    const f = rt.pById.get(+k);
    if (!f) continue;
    if (p.ties[k] > 60 && f !== q) { f.hap = clamp(f.hap - 0.08, 0, 1); if (p.ties[k] > 80) bio(f, st.day, L(`trauert um ${p.n}`, `mourns ${p.n}`)); }
    if (f.ties) delete f.ties[p.id];
    if (f.fi === p.id) f.fi = null;
    if (f.aff === p.id) delete f.aff;
    if (f.lov === p.id) delete f.lov;
  }
}

// ---------- Jährlich ----------

export function socialYear(st) {
  const r = rng(st), rt = st._rt;
  for (const s of st.settlements) {
    if (!s.alive) continue;
    const M = members(st, s), pool = M.adults.concat(M.old, M.kids);
    // Bindungen verblassen, wenn man sich nicht sieht; Freunde färben auf den Glauben ab
    for (const p of pool) {
      for (const k in p.ties) {
        const f = rt.pById.get(+k);
        if (!f) { delete p.ties[k]; continue; }
        if (+k === p.pa) continue;
        p.ties[k] = Math.round(p.ties[k] * (f.s === p.s ? 0.88 : 0.7));
        if (Math.abs(p.ties[k]) < 5) delete p.ties[k];
        else if (p.ties[k] > 50) p.faith = clamp(p.faith + (f.faith - p.faith) * 0.05, 0, 1);
      }
    }
    // Fehden enden nach zehn Jahren
    if (s.feuds) s.feuds = s.feuds.filter(f => st.day - f.d < YEAR * 10);
    // Heimliche Paare dürfen heiraten, wenn die Zeiten sich ändern
    if (openly(s)) for (const p of M.adults) {
      const q = p.sec && p.pa && rt.pById.get(p.pa);
      if (q && p.id < q.id && r.chance(0.5)) {
        p.sec = q.sec = 0;
        bio(p, st.day, L(`heiratet ${q.n}, endlich offen`, `marries ${q.n}, openly at last`)); bio(q, st.day, L(`heiratet ${p.n}, endlich offen`, `marries ${p.n}, openly at last`));
        if (r.chance(0.3)) chron(st, 'fest', L(`${p.n} und ${q.n} lebten jahrelang im Verborgenen. Jetzt heiraten sie vor ganz ${s.name}.`, `${p.n} and ${q.n} lived in hiding for years. Now they marry before all of ${s.name}.`), s.id, 0);
      }
    }
    // Waisen finden ein Zuhause
    for (const k of M.kids) {
      if (k.ad || (k.mo && rt.pById.has(k.mo)) || (k.fa && rt.pById.has(k.fa))) continue;
      const fam = M.adults.filter(p => p.pa && ageOf(st, p) > 22 && ageOf(st, p) < 55 && (p.gold || 0) > (s.price?.food || 1) * 20);
      if (!fam.length) continue;
      const pick = fam.find(p => p.clan === k.clan) || fam.find(p => !(rt.kidsOf.get(p.id) || []).length) || r.pick(fam);
      k.ad = pick.id;
      bio(k, st.day, L(`wird von ${pick.n} aufgenommen`, `is taken in by ${pick.n}`));
      bio(pick, st.day, L(`nimmt das Waisenkind ${k.n} auf`, `takes in the orphan ${k.n}`));
    }
    s.yrLast = s.yr || {}; s.yr = {};
  }
  politicalMarriages(st, r);
}

// Herrscherhäuser verheiraten ihre Kinder über Siedlungsgrenzen hinweg
function politicalMarriages(st, r) {
  const rt = st._rt, sets = st.settlements.filter(s => s.alive);
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
    const a = sets[i], b = sets[j];
    a.pmar = a.pmar || {};
    if (a.war === b.id || (a.rel[b.id] ?? 0) < 5 || st.day - (a.pmar[b.id] || -1e9) < YEAR * 15 || !r.chance(0.07)) continue;
    const la = leaderOf(st, a), lb = leaderOf(st, b);
    if (!la || !lb) continue;
    const heirs = (s, l) => members(st, s).adults.filter(p => p !== l && (p.mo === l.id || p.fa === l.id || p.clan === l.clan) && single(st, p) && ageOf(st, p) <= 35);
    const ha = heirs(a, la), hb = heirs(b, lb);
    let pair = null;
    for (const x of ha) { const y = hb.find(y => y.sex !== x.sex && !related(x, y)); if (y) { pair = [x, y]; break; } }
    if (!pair) continue;
    const [x, y] = pair;
    x.fi = y.id; y.fi = x.id;
    wedding(st, a, x, y, r, true);
    a.pmar[b.id] = st.day;
    a.rel[b.id] = b.rel[a.id] = clamp((a.rel[b.id] ?? 0) + 25, -100, 100);
    const ally = a.rel[b.id] > 60 && !a.ally[b.id];
    if (ally) a.ally[b.id] = b.ally[a.id] = st.day;
    chron(st, 'politik', L(`Politische Hochzeit: ${x.n} aus dem Haus von ${nm(la)} heiratet ${y.n} aus dem Haus von ${nm(lb)}. ${a.name} und ${b.name} rücken zusammen.${ally ? ' Ein Bündnis wird besiegelt.' : ''}`,
      `Political marriage: ${x.n} of the house of ${nm(la)} weds ${y.n} of the house of ${nm(lb)}. ${a.name} and ${b.name} draw closer.${ally ? ' An alliance is sealed.' : ''}`), a.id, 1);
  }
}
