// Religionen (seit 20.10.2026, Teil 2 aus PLAN_REGELWERK.md). Liste st.faiths, je Mensch p.rl (0 keine).
// Am Anfang hat jedes Volk seinen Ahnenglauben (kind 'volk'). In Krisen steht ein Prophet auf, fast immer nach einem
// Zeichen des Geistes (Mythen aus powers.js), und stiftet eine Kirche (kind 'kirche'), deren Name und Lehre aus diesem
// Zeichen kommen. Weit weg vom heiligen Ort weicht die Lehre ab, daraus werden Sekten (kind 'sekte', from = Mutter).
// Ausbreitung über Beziehungen (Einflussformel): Ehe 3, Eltern und Kinder 2, Freunde 1, die Nachbarschaft über den
// Anteil im Ort, dazu Staatsglaube, Mission und Verfolgung. Wer fest glaubt (p.faith), wechselt schwer.
// Lehre (ten, je 0 bis 1): strict streng, mission missionarisch, tol duldsam, war kriegerisch, ascetic asketisch.
import * as D from './data.js';
import { clamp } from './rng.js';
import { rng, members, ageOf, chron, bio, titleFor, sameLand, isleOf } from './util.js';
import { mix, top, tolerance, hash, mainOrigin } from './peoples.js';
import { L } from '../i18n.js';

const YEAR = D.DAYS_PER_YEAR;
const F_COLS = ['#e9b44c', '#d4708f', '#7d8fd6', '#6fb7a8', '#c46b4a', '#b388eb', '#8ab17d', '#5fa8d3', '#f4a261', '#c9a227', '#e07a5f', '#9fbf6f'];
export const TENETS = {
  strict: L('streng', 'strict'), mission: L('missionarisch', 'missionary'), tol: L('duldsam', 'tolerant'), war: L('kriegerisch', 'militant'), ascetic: L('asketisch', 'ascetic'),
};
export const KIND_NAME = { volk: L('Ahnenglaube', 'Ancestral faith'), kirche: L('Kirche', 'Church'), sekte: L('Sekte', 'Sect') };

// Namen nach dem Zeichen, aus dem der Glaube kam
const SIGN_NAME = {
  regen: ['Kirche des Regens', 'Church of the Rain'], sonne: ['Kinder der Sonne', 'Children of the Sun'], sturm: ['Die Sturmgeweihten', 'The Storm-Sworn'],
  blitz: ['Orden des Blitzes', 'Order of the Lightning'], schnee: ['Die Stillen im Schnee', 'The Silent of the Snow'], nebel: ['Die Nebelwandler', 'The Mist Walkers'],
  regenbogen: ['Bund des Regenbogens', 'Covenant of the Rainbow'], segen: ['Die Erdgesegneten', 'The Earth-Blessed'], fische: ['Die Netzträger', 'The Net Bearers'],
  beben: ['Die Bebenden', 'The Tremblers'], vulkan: ['Kirche des Feuerbergs', 'Church of the Fire Mountain'], flut: ['Die Kinder der Flut', 'The Children of the Flood'],
  meteor: ['Orden des fallenden Sterns', 'Order of the Falling Star'], traum: ['Die Träumenden', 'The Dreamers'], funke: ['Die Erleuchteten', 'The Illumined'],
  komet: ['Die Kometenseher', 'The Comet Seers'], fremde: ['Die Wartenden am Ufer', 'The Watchers of the Shore'], heilung: ['Bund der Quelle', 'Covenant of the Spring'],
  seuche: ['Die Gezeichneten', 'The Marked'],
};
const HARM = new Set(['sturm', 'beben', 'vulkan', 'flut', 'meteor', 'seuche', 'blitz']);
const SECT_NAME = [['Die Reinen von', 'The Pure of'], ['Die Erneuerer von', 'The Renewers of'], ['Die Wahrhaftigen von', 'The Truthful of'], ['Die Wachenden von', 'The Wakeful of']];

const fOf = (st, id) => st._rt.fById.get(id);
export const faithName = f => f ? f.n : L('ohne Glauben', 'no faith');
const uniq = (st, n) => { const taken = new Set(st.faiths.map(f => f.n)); if (!taken.has(n)) return n; for (let k = 2; k < 30; k++) if (!taken.has(n + ' ' + k)) return n + ' ' + k; return n + ' ' + st.faiths.length; };

// ---------- Glauben anlegen ----------

// s: der Ort der Gründung (darf null sein), ten: Lehre, kind: 'kirche' (Standard), 'sekte', 'volk'
export function addFaith(st, s, { name, ten, kind = 'kirche', from = 0, og, founder, sign, share = 0 } = {}) {
  st.faiths = st.faiths || [];
  const id = st.faiths.reduce((m, f) => Math.max(m, f.id), 0) + 1;
  const T = ten || { strict: 0.5, mission: 0.5, tol: 0.5, war: 0.3, ascetic: 0.3 };
  const f = {
    id, n: uniq(st, name || L(`Glaube ${id}`, `Faith ${id}`)), kind, from, d: st.day || 0, s: s ? s.id : 0, og: og ?? (s ? s.og || 0 : 0),
    holy: s ? [s.cx, s.cy] : null, land: s ? (s.land ?? s.isle) : 0, col: F_COLS[(id - 1) % F_COLS.length],
    ten: Object.fromEntries(Object.entries({ strict: 0.5, mission: 0.5, tol: 0.5, war: 0.3, ascetic: 0.3, ...T }).map(([k, v]) => [k, Math.round(clamp(v, 0, 1) * 100) / 100])),
  };
  if (founder) f.founder = founder;
  if (sign) f.sign = sign;
  st.faiths.push(f);
  st._rt.fById.set(f.id, f);
  // Ein Teil des Ortes tritt sofort über (Labor, Baukasten)
  if (s && share > 0) {
    const r = rng(st);
    for (const p of members(st, s).all) if (r.chance(share)) convert(st, p, f, true);
  }
  return f;
}

// Jedes Volk hat seinen Ahnenglauben (Haken aus addOrigin)
export function folkFaith(st, o) {
  if (o.fv && fOf(st, o.fv)) return fOf(st, o.fv);
  const f = addFaith(st, null, { name: L(`Ahnenglaube der ${o.n}`, `Ancestral faith of the ${o.n}`), kind: 'volk', og: o.id, ten: { strict: 0.4, mission: 0.1, tol: 0.55, war: 0.3, ascetic: 0.2 } });
  o.fv = f.id;
  return f;
}

export function convert(st, p, f, quiet) {
  if (p.rl === f.id) return;
  p.rl = f.id;
  p.faith = clamp((p.faith ?? 0.4) * 0.85 + 0.12, 0, 1);
  st.counts.conv = (st.counts.conv || 0) + 1;
  if (!quiet && ageOf(st, p) >= 14) bio(p, st.day, L(`tritt über zu ${f.n}`, `converts to ${f.n}`));
}

// Glaube eines neuen Menschen (Haken aus peoples.personHook): Kind vom Elternteil mit dem höheren Stand, sonst der
// Ahnenglaube seines Volkes, in einem Ort seines Volkes der dort häufigste Glaube
export function personFaith(st, s, p, mo, fa) {
  if (mo || fa) {
    const up = mo && fa ? ((mo.cls ?? 1) > (fa.cls ?? 1) ? mo : fa) : (fa || mo);
    p.rl = up.rl || (mo || fa).rl || 0;
    return;
  }
  const o = st._rt.ogById.get(p.og);
  if (o && o.id === mainOrigin(st, s)) {
    const [k] = top(mix(st, s).rl);
    if (k) { p.rl = k; return; }
  }
  p.rl = o ? folkFaith(st, o).id : 0;
}

// Staatsglaube: Theokratie oder Staatskirche nehmen den Glauben des Herrschers (amtlich), sonst zählt die Mehrheit
export function stateFaith(st, s) {
  const lead = s.gov.leader ? st._rt.pById.get(s.gov.leader) : null;
  const official = s.gov.type === 'theokratie' || s.laws.includes('staatskirche');
  if (official && lead && lead.rl) { s.srel = lead.rl; s.sroff = 1; }
  else { const [k] = top(mix(st, s).rl); s.srel = k || 0; s.sroff = 0; }
  return s.srel;
}

// ---------- alle 6 Tage: Ausbreitung, Ehen, Verfolgung ----------

export function faithStep(st) {
  const r = rng(st), rt = st._rt;
  const K = 0.0005 * 6;
  for (const s of st.settlements) {
    if (!s.alive || s.pop < 2) continue;
    const m = mix(st, s), n = Math.max(1, m.n);
    const state = stateFaith(st, s);
    const tol = tolerance(st, s);
    const crisis = (s.hunger || 0) > 0.25 || (s.sickShare || 0) > 0.06 || !!s.war || s.unrest > 0.6;
    // verfolgt: Minderheiten unter einem amtlichen Glauben bei wenig Toleranz
    const persec = new Set();
    if (tol < 0.3 && state) for (const [k, c] of m.rl) if (k && k !== state && c / n > 0.02 && c / n < 0.45) persec.add(k);
    s.persec = persec.size ? [...persec] : undefined;
    // Ortsanteile: die drei häufigsten Glauben wirken als Nachbarschaft
    const amb = [...m.rl].filter(([k]) => k).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, c]) => [k, c / n]);
    const W = new Map();
    for (const p of members(st, s).all) {
      if (ageOf(st, p) < 10) continue;
      W.clear();
      const add = (k, w) => { if (k) W.set(k, (W.get(k) || 0) + w); };
      for (const [k, sh] of amb) add(k, sh * 1.2);
      const pa = p.pa && rt.pById.get(p.pa);
      if (pa && pa.s === p.s) add(pa.rl, 3);
      for (const id of [p.mo, p.fa]) { const q = id && rt.pById.get(id); if (q && q.s === p.s) add(q.rl, 2); }
      for (const k in p.ties) {
        const v = p.ties[k];
        if (v > 30 || v < -40) { const q = rt.pById.get(+k); if (q) add(q.rl, v > 30 ? 1 : -0.5); }
      }
      let bf = 0, bw = 0, tot = 0;
      for (const [k, w] of W) { if (w > 0) tot += w; if (k !== p.rl && w > bw) { bw = w; bf = k; } }
      if (!bf || tot <= 0) continue;
      const f = fOf(st, bf);
      if (!f) continue;
      let mul = 1;
      if (bf === state && s.sroff) mul *= tol < 0.3 ? 2.2 : 1.5;
      if (f.ten.mission > 0.6) mul *= 1.3;
      if (persec.has(bf)) mul *= 0.3;
      if (f.kind !== 'volk' && crisis) mul *= 1.3;
      if (f.kind !== 'volk' && s.era >= 2) mul *= 1.15;
      if (f.kind === 'volk' && f.og !== p.og) mul *= 0.3; // den Ahnenglauben eines anderen Volkes nimmt man selten an
      const own = fOf(st, p.rl);
      if (own && own.ten.strict > 0.6) mul *= 0.7;
      const ch = K * (bw / tot) * (1 - (p.faith ?? 0.4) * 0.75) * mul;
      if (r.chance(ch)) convert(st, p, f);
    }
    // Ehen über Glaubensgrenzen: wo wenig geduldet wird, tritt der Partner mit dem niedrigeren Stand über
    for (const p of members(st, s).adults) {
      const q = p.pa && rt.pById.get(p.pa);
      if (!q || q.s !== p.s || q.rl === p.rl || p.id > q.id) continue;
      if (r.chance(tol < 0.45 ? 0.08 : 0.012)) {
        const [lo, hi] = (p.cls ?? 1) > (q.cls ?? 1) ? [q, p] : [p, q];
        const f = fOf(st, hi.rl);
        if (f) convert(st, lo, f);
      }
    }
    // Verfolgung: Druck, Glaube im Verborgenen, selten offene Gewalt (einmal je drei Jahre und Ort)
    if (persec.size) {
      for (const p of members(st, s).all) if (persec.has(p.rl)) { p.hap = clamp(p.hap - 0.02, 0, 1); p.faith = clamp(p.faith + 0.008, 0, 1); }
      if (st.day - (s.persAt || -999) > 3 * YEAR && r.chance(0.12)) {
        s.persAt = st.day;
        const k = r.pick([...persec]), f = fOf(st, k);
        const victims = members(st, s).adults.filter(p => p.rl === k);
        if (f && victims.length) {
          s.unrest = clamp(s.unrest + 0.06, 0, 1);
          const dead = r.chance(0.25) ? Math.min(victims.length, r.int(1, 3)) : 0;
          for (let i = 0; i < dead; i++) { const v = victims[i]; v.dzDie = 'Verfolgung'; }
          if (rt.flee) rt.flee(st, s, p => p.rl === k, 'glaube');
          chron(st, 'glaube', dead
            ? L(`In ${s.name} werden Anhänger von ${f.n} verfolgt. ${dead} von ihnen sterben, viele fliehen.`, `In ${s.name} followers of ${f.n} are persecuted. ${dead} of them die, many flee.`)
            : L(`In ${s.name} werden die Häuser der Anhänger von ${f.n} gezeichnet. Wer kann, geht fort.`, `In ${s.name} the houses of the followers of ${f.n} are marked. Whoever can, leaves.`), s.id, 1);
        }
      }
    }
  }
}

// ---------- alle 12 Tage: Propheten ----------

export function prophetStep(st) {
  const r = rng(st), rt = st._rt;
  const living = new Set();
  for (const p of st.people) if (p.rl) living.add(p.rl);
  const organized = st.faiths.filter(f => f.kind !== 'volk' && living.has(f.id)).length;
  const alive = st.settlements.filter(s => s.alive);
  const capF = st.earth ? 30 : 4 + Math.floor(alive.length / 4);
  if (organized >= capF) return;
  for (const s of alive) {
    if (s.era < 1 || s.pop < 25) continue;
    if (st.day - (s.prophAt || -9999) < 25 * YEAR) continue;
    const foe = s.war && rt.sById.get(s.war);
    const crisis = (s.hunger || 0) > 0.25 || (s.sickShare || 0) > 0.06 || (foe && (foe.warScore || 0) > (s.warScore || 0)) || s.unrest > 0.6;
    const sign = st.myths.filter(m => m.s === s.id && st.day - m.d < 4 * YEAR).pop() || (s.blessed > st.day - 2 * YEAR ? { kind: 'regen', good: true } : null);
    const p0 = 0.02 * (crisis ? 1 : 0.25) * (sign ? 1 : 0.35) * ((st.char && st.char.piety) || 1) * (0.6 + s.cult.glaube);
    if (!r.chance(p0)) continue;
    const pool = members(st, s).adults.filter(p => !p.lt && (p.tr.charisma + p.tr.glaube + (p.faith ?? 0)) >= 1.9);
    if (!pool.length) continue;
    const pr = pool.reduce((a, p) => (p.tr.charisma + p.tr.glaube + p.faith > a.tr.charisma + a.tr.glaube + a.faith ? p : a), pool[0]);
    const kind = sign ? sign.kind : null;
    const base = kind && SIGN_NAME[kind] ? L(SIGN_NAME[kind][0], SIGN_NAME[kind][1]) : L(`Weg des ${pr.n}`, `Way of ${pr.n}`);
    const harm = kind ? HARM.has(kind) && !sign.good : false;
    const h = k => hash(st.seed || 1, s.id * 7 + k, st.day);
    const ten = {
      strict: s.cult.tradition * 0.6 + (harm ? 0.3 : 0) + h(1) * 0.25, mission: s.cult.handel * 0.4 + pr.tr.charisma * 0.35 + h(2) * 0.35,
      tol: s.cult.freiheit * 0.6 + (harm ? 0 : 0.2) + h(3) * 0.25, war: s.cult.macht * 0.6 + (harm ? 0.2 : 0) + h(4) * 0.2, ascetic: h(5) * 0.6 + ((s.hunger || 0) > 0.25 || (s.sickShare || 0) > 0.06 ? 0.3 : 0),
    };
    const f = addFaith(st, s, { name: base, ten, kind: 'kirche', founder: pr.n, sign: kind || undefined, og: pr.og });
    s.prophAt = st.day;
    if (!pr.title) pr.title = titleFor(pr, 'Prophet');
    pr.fame += 4;
    convert(st, pr, f);
    bio(pr, st.day, L(`hat eine Offenbarung und stiftet ${f.n}`, `has a revelation and founds ${f.n}`));
    // Familie, Freunde und Suchende folgen
    let n = 1;
    for (const q of members(st, s).all) {
      if (q === pr) continue;
      const tie = (pr.ties && pr.ties[q.id]) || 0;
      const close = q.id === pr.pa || q.mo === pr.id || q.fa === pr.id;
      if ((close && r.chance(0.8)) || (tie > 30 && r.chance(0.6)) || (q.faith > 0.6 && r.chance(0.08))) { convert(st, q, f); n++; }
    }
    const sg = kind ? L(' Sie sagen, der Himmel habe zu ihm gesprochen.', ' They say the sky spoke to them.') : '';
    chron(st, 'glaube', L(`In ${s.name} steht ${pr.n} auf und predigt einen neuen Glauben: ${f.n}. ${n} folgen ${pr.sex === 'f' ? 'ihr' : 'ihm'} vom ersten Tag an.${sg}`, `In ${s.name}, ${pr.n} rises and preaches a new faith: ${f.n}. ${n} follow from the first day.${sg}`), s.id, 2);
    return;
  }
}

// ---------- alle 24 Tage: Abweichung und Sekten, Mission, Gegensätze zwischen Orten ----------

export function faithYear(st) {
  const r = rng(st), rt = st._rt;
  const alive = st.settlements.filter(s => s.alive && s.pop > 0);
  const followers = new Map();
  for (const p of st.people) if (p.rl) followers.set(p.rl, (followers.get(p.rl) || 0) + 1);
  for (const f of st.faiths) if (!f.end && !followers.get(f.id) && st.day - f.d > YEAR) { f.end = st.day; if (f.kind !== 'volk') chron(st, 'glaube', L(`Der letzte Anhänger von ${f.n} ist fort. Nur noch Lieder erinnern an ihn.`, `The last follower of ${f.n} is gone. Only songs remember it.`), -1, 0); }
  for (const s of alive) {
    const m = mix(st, s), n = Math.max(1, m.n);
    s.fdev = s.fdev || {};
    for (const [k, c] of m.rl) {
      const f = fOf(st, k);
      if (!f || f.kind === 'volk' || !f.holy || c < 15) continue;
      const d = Math.hypot(s.cx - f.holy[0], s.cy - f.holy[1]);
      const contact = d < 8 ? 1 : f.land === (s.land ?? s.isle) ? clamp(1 - d / 60, 0.1, 1) : 0.15;
      const priests = members(st, s).adults.filter(p => p.job === 'priester' && p.rl === k).length;
      s.fdev[k] = clamp((s.fdev[k] || 0) + 0.05 * (1 - contact) + (s.unrest > 0.5 ? 0.03 : 0) - priests * 0.01, 0, 2);
      if (s.fdev[k] > 1 && c / n > 0.3 && r.chance(0.35)) {
        const nm = r.pick(SECT_NAME);
        const ns = addFaith(st, s, {
          name: L(`${nm[0]} ${s.name}`, `${nm[1]} ${s.name}`), kind: 'sekte', from: f.id, og: f.og,
          ten: { ...f.ten, strict: clamp(f.ten.strict + r.range(-0.3, 0.35), 0, 1), tol: clamp(f.ten.tol + r.range(-0.3, 0.2), 0, 1), mission: clamp(f.ten.mission + r.range(-0.2, 0.3), 0, 1) },
        });
        let moved = 0;
        for (const p of members(st, s).all) if (p.rl === k && r.chance(0.6)) { convert(st, p, ns, true); moved++; }
        s.fdev[k] = 0;
        st.counts.sects = (st.counts.sects || 0) + 1;
        chron(st, 'glaube', L(`In ${s.name} sagen sich ${moved} Gläubige von ${f.n} los. Sie nennen sich ${ns.n} und glauben, die Lehre sei verdorben.`, `In ${s.name}, ${moved} believers break away from ${f.n}. They call themselves ${ns.n} and believe the teaching has been corrupted.`), s.id, 1);
      }
    }
  }
  // Mission: wo ein missionarischer Glaube stark ist, ziehen Prediger in die Nachbarorte
  for (const s of alive) {
    const m = mix(st, s), n = Math.max(1, m.n);
    for (const [k, c] of m.rl) {
      const f = fOf(st, k);
      if (!f || f.kind === 'volk' || f.ten.mission < 0.5 || c / n < 0.3) continue;
      const tg = alive.filter(o => o !== s && (sameLand(st, s, o) ? Math.hypot(o.cx - s.cx, o.cy - s.cy) < 45 : (st.routes || []).some(x => (x.a === s.id && x.b === o.id) || (x.b === s.id && x.a === o.id))) && (mix(st, o).rl.get(k) || 0) / Math.max(1, o.pop) < 0.2);
      if (!tg.length || !r.chance(0.35 * f.ten.mission)) continue;
      const o = r.pick(tg);
      if (o.laws.includes('staatskirche') && o.srel !== k && r.chance(0.6)) continue;
      const cands = members(st, o).adults.filter(p => p.rl !== k && (p.faith ?? 0.4) < 0.55);
      const won = Math.min(cands.length, r.int(1, 3));
      for (let i = 0; i < won; i++) convert(st, r.pick(cands), f);
      if (won && r.chance(0.25)) chron(st, 'glaube', L(`Prediger von ${f.n} kommen aus ${s.name} nach ${o.name}. ${won} Menschen hören zu und bleiben.`, `Preachers of ${f.n} come from ${s.name} to ${o.name}. ${won} ${won === 1 ? 'person listens' : 'people listen'} and stay.`), o.id, 0);
    }
  }
  // Strenge Staatsglauben mögen einander nicht
  for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
    const a = alive[i], b = alive[j];
    if (!a.srel || !b.srel || a.srel === b.srel || !a.sroff || !b.sroff) continue;
    const fa = fOf(st, a.srel), fb = fOf(st, b.srel);
    if (!fa || !fb || fa.ten.strict + fb.ten.strict < 1.2) continue;
    a.rel[b.id] = b.rel[a.id] = clamp((a.rel[b.id] ?? 0) - 1.5 * (fa.ten.war + fb.ten.war + 0.5), -100, 100);
  }
}

// Abspaltung einer Fraktion (Haken aus schismStep in society.js): ziehen die Gläubigen fort, gründen sie oft eine Sekte
export function onSplit(st, s, ns, fac, group) {
  if (fac !== 'glaeubige') return;
  const r = rng(st);
  const [k] = top(new Map([...group].reduce((m, p) => m.set(p.rl, (m.get(p.rl) || 0) + 1), new Map())));
  const f = k && fOf(st, k);
  if (!f || !r.chance(0.6)) return;
  const nm = r.pick(SECT_NAME);
  const sect = addFaith(st, ns, { name: L(`${nm[0]} ${ns.name}`, `${nm[1]} ${ns.name}`), kind: 'sekte', from: f.id, og: f.og, ten: { ...f.ten, strict: clamp(f.ten.strict + 0.25, 0, 1), tol: clamp(f.ten.tol - 0.2, 0, 1) } });
  for (const p of group) convert(st, p, sect, true);
  st.counts.sects = (st.counts.sects || 0) + 1;
  chron(st, 'glaube', L(`Die Fortgezogenen von ${ns.name} nennen ihren Glauben ${sect.n}. Mit ${s.name} beten sie nicht mehr.`, `Those who left for ${ns.name} call their faith ${sect.n}. They no longer pray with ${s.name}.`), ns.id, 1);
}

void isleOf;
