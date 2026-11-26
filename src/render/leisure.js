// Unternehmungen der Menschen (seit 21.10.2026, Naders Wunsch: viele verschiedene Aktionen und Tagesabläufe aus dem
// echten Leben, Strand, Dates, Unternehmungen). Nur im Bild, die Simulation bleibt unberührt.
// Je Ort und sichtbarem Tag (6 Spieltage) entsteht ein Programm: wer wann wo was tut und in welcher Aufstellung.
// Alles aus Spielstand, Tag und Hash, ohne Zufall, darum sehen draußen (people.js) und drinnen (interior.js über
// schedule.plan) dasselbe. Zwei von sieben Tagen sind Ruhetage: Erwachsene arbeiten nicht (außer Heiler, Priester,
// Händler am Markttag, Krieger im Krieg), dann gibt es Gottesdienst, Markt, Picknick, Strand und mehr.
// Zeitfenster (Tageszeit des Menschen, 0 Mitternacht, 0,5 Mittag): Morgen am Ruhetag, Tag am Ruhetag, Spielzeit der
// Kinder, Nachmittag der Alten, Abend, später Abend.
import { DAYS_PER_YEAR } from '../sim/data.js';
import { NX, NY } from '../sim/world.js';
import { L } from '../i18n.js';

export const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
export const VDAYS = 6;
export const restDay = vday => vday % 7 >= 5; // Wochenende: zwei von sieben sichtbaren Tagen
const WORK_ON_REST = new Set(['heiler', 'priester', 'haendler']);
// eve beginnt erst, wenn die Arbeit (bis 0,7) vorbei und der Heimweg geschafft ist, und endet vor dem Schlafengehen
export const W = { am: [0.3, 0.42], day: [0.45, 0.67], kid: [0.31, 0.685], kidS: [0.555, 0.69], old: [0.475, 0.69], eve: [0.765, 0.945], late: [0.9, 0.965] };

// Arten: Text (de, en), drinnen, ob Regen erlaubt
export const KINDS = {
  hochzeit: { t: (n) => L(`feiert die Hochzeit von ${n}`, `celebrates the wedding of ${n}`), rain: false },
  trauer: { t: (n) => L(`trauert um ${n}`, `mourns ${n}`), rain: true },
  date: { t: (n, w) => L(`hat ein Date mit ${n}${w}`, `is on a date with ${n}${w}`), rain: false },
  picknick: { t: () => L('macht Picknick mit der Familie', 'having a picnic with the family'), rain: false },
  strand: { t: (n, w, kid) => (kid ? L('spielt am Strand', 'playing on the beach') : L('liegt am Strand', 'lazing on the beach')), rain: false },
  feuer: { t: (n, w, kid, role) => (role === 'erz' ? L('erzählt am Lagerfeuer', 'telling stories by the fire') : L('sitzt am Lagerfeuer', 'sitting by the fire')), rain: false },
  tanz: { t: () => L('tanzt auf dem Fest', 'dancing at the festival'), rain: false },
  taverne: { t: () => L('trinkt mit Freunden vor der Taverne', 'drinking with friends outside the tavern'), rain: false },
  markt: { t: () => L('kauft auf dem Markt ein', 'shopping at the market'), rain: true },
  gottesdienst: { t: () => L('beim Gottesdienst', 'at the service'), rain: true, indoor: true },
  angeln: { t: () => L('angelt', 'fishing'), rain: false },
  garten: { t: () => L('arbeitet im Garten', 'working in the garden'), rain: false },
  holz: { t: () => L('hackt Holz', 'chopping wood'), rain: true },
  waesche: { t: () => L('wäscht Wäsche am Wasser', 'washing clothes by the water'), rain: false },
  lesen: { t: () => L('liest unter einem Baum', 'reading under a tree'), rain: false },
  spaziergang: { t: (n) => (n ? L(`geht mit ${n} spazieren`, `out for a walk with ${n}`) : L('geht spazieren', 'out for a walk')), rain: false },
  joggen: { t: () => L('joggt', 'jogging'), rain: false },
  sonne: { t: () => L('schaut den Sonnenuntergang', 'watching the sunset'), rain: false },
  besuch: { t: (n) => L(`besucht ${n}`, `visiting ${n}`), rain: true },
  streit: { t: (n) => L(`streitet mit ${n}`, `arguing with ${n}`), rain: true },
  bank: { t: () => L('sitzt mit Freunden auf der Bank', 'sitting on a bench with friends'), rain: false },
  nap: { t: () => L('hält Mittagsschlaf unter einem Baum', 'napping under a tree'), rain: false },
  fangen: { t: () => L('spielt Fangen', 'playing tag'), rain: false },
  ball: { t: () => L('spielt Ball', 'playing ball'), rain: false },
  verstecken: { t: (n, w, kid, role) => (role === 'such' ? L('sucht die anderen beim Verstecken', 'seeking in hide and seek') : L('versteckt sich', 'hiding')), rain: false },
  fussball: { t: () => L('spielt Fußball', 'playing football'), rain: false },
  musik: { t: () => L('spielt Musik auf dem Platz', 'playing music on the square'), rain: false },
};

const ageOf = (st, p) => (st.day - p.b) / DAYS_PER_YEAR;
const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Wie viele Bäume das Bild auf einer Kachel zeichnet (main.js setzt das aus terrain.js, sonst nur der Wald im Raster):
// auch einzelne Wiesenbäume, damit niemand unter einer Krone picknickt
export const hooks = { treeCount: null };
const FAR_EV = 6; // weiter weg (Felder vom Zuhause) wird nichts unternommen: der Weg wäre länger als die Zeit dafür

// ---------- Orte rund um einen Ort ----------
// Strand (Sand am Wasser), Ufer (Land am Wasser oder Fluss), Wiese (frei, ohne Wald, Weg, Feld, Haus), Baumrand (Schatten),
// Aussicht, Platz, Gebäude nach Art. Kacheln als { x, y, nx, ny } mit Richtung zum Wasser oder zum Baum.
function findPlaces(st, s) {
  const T = st.tiles, rt = st._rt, H = T.h, NXr = NX, NYr = NY;
  const R = Math.max(3, s.R || 4), r0 = Math.ceil(R + 9), cx = s.cx, cy = s.cy;
  const isle = rt.isleOf ? rt.isleOf[cy * NXr + cx] : 0;
  const P = { beach: [], shore: [], meadow: [], tree: [], plaza: [], view: null, bld: {}, R, cx, cy };
  const treeAt = (i, x, y) => (hooks.treeCount ? hooks.treeCount(T, i, x, y) : T.tree[i]);
  let bestH = -1;
  for (let y = Math.max(1, cy - r0); y <= Math.min(NYr - 2, cy + r0); y++) for (let x = Math.max(1, cx - r0); x <= Math.min(NXr - 2, cx + r0); x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d > r0) continue;
    const i = y * NXr + x, h = H[i];
    if (h < 0) continue;
    if (rt.isleOf && isle && rt.isleOf[i] && rt.isleOf[i] !== isle) continue;
    const bid = rt.bldAt[i], b = bid ? rt.bById.get(bid) : null;
    if (b && b.s === s.id && b.prog >= 1) (P.bld[b.t] || (P.bld[b.t] = [])).push(b);
    const sv = T.st ? T.st[i] : 0;
    if ((sv & 8) && !b) P.plaza.push({ x, y });
    if (b || (sv & 3) || (rt.roadNet && rt.roadNet[i]) || T.road[i] > 70 || (T.burn && T.burn[i]) || (rt.findAt && rt.findAt.has && rt.findAt.has(i))) continue;
    let wx = 0, wy = 0, wet = 0, tx = 0, ty = 0, tr = 0;
    for (const [a, c] of D8) {
      const j = (y + c) * NXr + x + a;
      if (H[j] < 0 || (T.river && T.river[j])) { wx += a; wy += c; wet++; }
      if (T.tree[j] >= 2) { tx += a; ty += c; tr++; }
    }
    const river = T.river && T.river[i];
    if (river) continue;
    const nl = Math.hypot(wx, wy) || 1;
    if (h === 0 && wet && d > R * 0.4) P.beach.push({ x, y, nx: wx / nl, ny: wy / nl });
    const free = h >= 1 && !treeAt(i, x, y);
    if (h >= 1 && wet && d > R * 0.5 && free) P.shore.push({ x, y, nx: wx / nl, ny: wy / nl });
    if (h >= 1 && h <= 3 && free && !wet && d > R * 0.6 && d < R + 7) P.meadow.push({ x, y });
    if (free && tr && !wet && d > R * 0.5) { const tl = Math.hypot(tx, ty) || 1; P.tree.push({ x, y, nx: tx / tl, ny: ty / tl }); }
    if (h >= 2 && free && d > R * 0.7 && d < R + 6 && h > bestH) { bestH = h; P.view = { x, y, nx: (x - cx) / (d || 1), ny: (y - cy) / (d || 1) }; }
  }
  // Feste Bänke auf dem Platz (bis zu drei, am Rand, Blick zur Mitte) und ein Biergarten an der Taverne: stehen immer da
  P.benches = [];
  if ((s.era | 0) >= 2) {
    const pl = P.plaza.slice().sort((a, b) => Math.hypot(b.x - cx, b.y - cy) - Math.hypot(a.x - cx, a.y - cy) || a.x - b.x || a.y - b.y);
    for (const q of pl) {
      if (P.benches.length >= 3) break;
      if (P.benches.some(b => Math.hypot(b.x - q.x, b.y - q.y) < 2.2)) continue;
      const fx = cx - q.x, fy = cy - q.y, l = Math.hypot(fx, fy) || 1;
      P.benches.push({ x: q.x - fx / l * 0.22, y: q.y - fy / l * 0.22, nx: fx / l, ny: fy / l });
    }
  }
  const tav = (P.bld.taverne || [])[0];
  if (tav) for (const [a, c] of D8) {
    const x = tav.x + a, y = tav.y + c, i = y * NXr + x;
    if (H[i] >= 1 && !rt.bldAt[i] && !treeAt(i, x, y) && !(T.st && (T.st[i] & 11)) && T.road[i] <= 70 && !(T.river && T.river[i])) { P.garden = { x, y }; break; }
  }
  return P;
}

// ---------- Aufstellungen ----------
// Blickrichtung als Winkel wie im Bild: h = atan2(dx, dz) (dz entspricht der Kachel-y-Richtung)
const faceTo = (fx, fz) => Math.atan2(fx, fz);
function ring(n, r, pose, extra = {}) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + 0.3, dx = Math.cos(a) * r, dz = Math.sin(a) * r;
    out.push({ dx, dz, face: faceTo(-dx, -dz), pose: typeof pose === 'function' ? pose(k) : pose, ...extra });
  }
  return out;
}
// nebeneinander mit Blick nach (fx, fz), Abstand gap
function row(n, fx, fz, gap, pose, extra = {}) {
  const tx = -fz, tz = fx, out = [];
  for (let k = 0; k < n; k++) {
    const o = (k - (n - 1) / 2) * gap;
    out.push({ dx: tx * o, dz: tz * o, face: faceTo(fx, fz), pose: typeof pose === 'function' ? pose(k) : pose, ...extra });
  }
  return out;
}

// ---------- Programm eines sichtbaren Tages ----------
const cache = new WeakMap();
export function program(st) {
  const vday = Math.floor(st.day / VDAYS);
  let C = cache.get(st);
  if (C && C.vday === vday && C.ns === st.settlements.length) return C;
  C = build(st, vday);
  cache.set(st, C);
  return C;
}

function build(st, vday) {
  const rt = st._rt, rest = restDay(vday), season = Math.floor((st.day % DAYS_PER_YEAR) / 6);
  const warm = season === 1 || season === 0, cold = season === 3;
  const C = { vday, ns: st.settlements.length, rest, byP: new Map(), list: [], places: new Map() };
  const busy = new Map(); // Mensch → belegte Zeitfenster
  const free = (p, w) => { const b = busy.get(p.id); if (!b) return true; for (const [a, c] of b) if (a < w[1] && w[0] < c) return false; return true; };
  const take = (p, w) => { const b = busy.get(p.id); if (b) b.push(w); else busy.set(p.id, [w]); };
  let evId = 1;
  const add = (s, k, w, x, y, members, slots, more = {}) => {
    const ev = { id: vday * 100000 + evId++, k, s: s.id, w, x, y, m: members.map(p => p.id), sl: new Map(), ...more };
    members.forEach((p, i) => { ev.sl.set(p.id, slots[i % slots.length]); take(p, w); const l = C.byP.get(p.id); if (l) l.push(ev); else C.byP.set(p.id, [ev]); });
    C.list.push(ev);
    return ev;
  };
  for (const s of st.settlements) {
    if (!s.alive || !s.pop) continue;
    const P = findPlaces(st, s);
    C.places.set(s.id, P);
    const h = k => hash(s.id * 7919 + vday * 131, k);
    let hk = 0;
    const rnd = () => h(++hk);
    // mit Anker (Kachel x, y, meist das Zuhause): nur unter den nächsten Plätzen wählen, sonst ist man bei weiten Wegen
    // kaum da, bevor die Zeit um ist (ein Feld braucht zu Fuß rund 5 Sekunden)
    const nearest = (list, anc, n = 8) => (anc && list.length > n ? list.slice().sort((a, b) => Math.hypot(a.x - anc.x, a.y - anc.y) - Math.hypot(b.x - anc.x, b.y - anc.y)).slice(0, n) : list);
    const pick = (list, k, anc) => { const l = nearest(list, anc), q = l.length ? l[Math.floor(h(k) * l.length)] : null; return q && anc && Math.hypot(q.x - anc.x, q.y - anc.y) > FAR_EV * 1.5 ? null : q; };
    // Plätze nicht doppelt vergeben (je Fenster)
    const usedSpot = new Set();
    const spot = (list, w, k, anc) => {
      list = nearest(list, anc);
      for (let t = 0; t < 8 && list.length; t++) {
        const q = list[Math.floor(h(k * 13 + t) * list.length)], key = q.x + ',' + q.y + ':' + w[0];
        if (usedSpot.has(key) || (anc && Math.hypot(q.x - anc.x, q.y - anc.y) > FAR_EV)) continue; // zu weit: lieber nichts
        usedSpot.add(key);
        return q;
      }
      return null;
    };
    const people = st.people.filter(p => p.s === s.id && !p.away && !p.dead && rt.pById.has(p.id));
    const adults = [], kids = [], olds = [], tots = [];
    for (const p of people) {
      if (p.job === 'kind') { (ageOf(st, p) < 5 ? tots : kids).push(p); } else if (p.job === 'alt') olds.push(p); else adults.push(p);
    }
    const byId = id => rt.pById.get(id);
    const here = q => q && q.s === s.id && !q.away && !q.sick;
    const adultWin = (p, w) => (w === W.eve || w === W.late || rest && !WORK_ON_REST.has(p.job) && !(p.job === 'krieger' && s.war));
    const center = { x: s.cx, y: s.cy };
    // Anker für die Ortswahl: wo der Mensch vorher ist, an Arbeitstagen also die Arbeit, sonst das Zuhause
    const homeOf = p => {
      const wb = p && p.w > 0 && p.job !== 'kind' && p.job !== 'alt' && (!rest || WORK_ON_REST.has(p.job)) ? rt.bById.get(p.w) : null;
      const b = wb || (p && p.home > 0 ? rt.bById.get(p.home) : null);
      return b ? { x: b.x, y: b.y } : center;
    };
    const temple = (P.bld.kathedrale || P.bld.tempel || P.bld.schrein || [])[0];
    const totem = (P.bld.totem || [])[0];
    const tav = (P.bld.taverne || [])[0];
    const markt = (P.bld.markt || [])[0];
    const era = s.era | 0;

    // 1 Hochzeit: wer in diesem oder dem letzten sichtbaren Tag geheiratet hat, feiert abends mit Familie und Freunden
    for (const p of adults) {
      const q = byId(p.pa);
      if (!q || p.id > q.id || !here(p) || !here(q) || p.sec || !(p.wed >= vday * VDAYS - VDAYS)) continue;
      if (!free(p, W.eve) || !free(q, W.eve)) continue;
      const guests = [];
      const seen = new Set([p.id, q.id]);
      const addG = g => { if (g && here(g) && !seen.has(g.id) && free(g, W.eve)) { seen.add(g.id); guests.push(g); } };
      for (const x of [p, q]) { addG(byId(x.mo)); addG(byId(x.fa)); for (const k in x.ties || {}) if (x.ties[k] > 40) addG(byId(+k)); }
      for (const g of people) if (guests.length < 14 && (g.mo === p.mo && p.mo || g.mo === q.mo && q.mo)) addG(g);
      const pl = temple && era >= 3 ? { x: temple.x, y: temple.y + 1.6 } : center;
      const ev = add(s, 'hochzeit', W.eve, pl.x, pl.y, [p, q], [{ dx: -0.08, dz: 0, face: faceTo(1, 0), pose: 'chat', role: 'paar' }, { dx: 0.08, dz: 0, face: faceTo(-1, 0), pose: 'chat', role: 'paar' }], { names: [p.n, q.n], fest: true });
      const n = guests.length;
      if (n) {
        const sl = ring(n, Math.max(0.42, n * 0.125 / (Math.PI * 2) * 1.25), k => (k % 3 === 0 ? 'chat' : 'cheer'), { role: 'gast' });
        guests.forEach((g, i) => { ev.m.push(g.id); ev.sl.set(g.id, sl[i]); take(g, W.eve); const l = C.byP.get(g.id); if (l) l.push(ev); else C.byP.set(g.id, [ev]); });
      }
    }

    // 2 Trauerfeier: wer gestorben ist, um den trauern Familie und enge Freunde (abends, am Ahnenpfahl, Tempel oder Rand)
    for (const d of st.people) {
      if (!d.dead || d.s !== s.id || d.dead < vday * VDAYS - 3) continue;
      const mourn = [];
      const seen = new Set();
      const addM = g => { if (g && here(g) && !seen.has(g.id) && free(g, W.eve) && mourn.length < 12) { seen.add(g.id); mourn.push(g); } };
      addM(byId(d.pa)); addM(byId(d.mo)); addM(byId(d.fa));
      for (const g of people) if (g.mo === d.id || g.fa === d.id) addM(g);
      for (const k in d.ties || {}) if (d.ties[k] > 50) addM(byId(+k));
      if (mourn.length < 2) continue;
      const pl = totem ? { x: totem.x, y: totem.y } : temple ? { x: temple.x, y: temple.y } : pick(P.meadow, 77, center) || center;
      // im Halbkreis vor dem Ort der Trauer, Blick zu ihm
      const sl = mourn.map((_, k) => { const a = Math.PI * (0.15 + 0.7 * (mourn.length > 1 ? k / (mourn.length - 1) : 0.5)), r = 0.55 + (k % 2) * 0.13; const dx = Math.cos(a) * r, dz = Math.sin(a) * r; return { dx, dz, face: faceTo(-dx, -dz), pose: 'idle' }; });
      add(s, 'trauer', W.eve, pl.x, pl.y, mourn, sl, { names: [d.n] });
    }

    // 3 Gottesdienst am Ruhetag morgens: Gläubige gehen in Tempel, Kathedrale oder Schrein
    if (rest && temple) {
      const list = [...adults, ...olds, ...kids].filter(p => free(p, W.am) && (p.faith ?? 0.5) > 0.45 && rnd() < 0.6);
      if (list.length) add(s, 'gottesdienst', W.am, temple.x, temple.y, list, [{ dx: 0, dz: 0, face: 0, pose: 'idle' }], { bid: temple.id });
    }
    // Markttag: wer nicht in den Gottesdienst geht, kauft am Ruhetag morgens ein
    if (rest && (markt || P.plaza.length) && era >= 1) {
      const list = adults.filter(p => free(p, W.am) && rnd() < 0.3).slice(0, 14);
      if (list.length) {
        const c = markt ? { x: markt.x, y: markt.y } : center;
        const sl = list.map((_, k) => { const a = k * 2.39996 + 0.5, r = 0.75 + (k % 3) * 0.16; const dx = Math.cos(a) * r, dz = Math.sin(a) * r; return { dx, dz, face: faceTo(-dx, -dz), pose: k % 4 === 1 ? 'pickup' : 'chat', item: k % 2 ? 'korb' : 'beutel' }; });
        add(s, 'markt', W.am, c.x, c.y, list, sl);
      }
    }

    // 4 Dates: Verlobte, Verliebte, Ehepaare (je jünger, desto öfter)
    for (const p of [...adults, ...olds]) {
      const qid = p.fi || (p.lov && byId(p.lov)?.lov === p.id ? p.lov : 0) || p.pa;
      const q = byId(qid);
      if (!q || p.id > q.id || !here(p) || !here(q) || q.job === 'kind') continue;
      const young = Math.min(ageOf(st, p), ageOf(st, q)) < 36, fresh = p.fi === q.id || p.lov === q.id;
      const ch = fresh ? 0.5 : young ? 0.16 : 0.06;
      if (h(p.id * 3 + 1) > ch) continue;
      // Art des Dates nach Ort, Jahreszeit und Tag
      const opts = [];
      if (P.beach.length && warm) opts.push('strand');
      if ((P.shore.length || P.view) && !cold) opts.push('sonne');
      if (P.meadow.length && !cold) opts.push('sterne');
      if (P.meadow.length && P.shore.length + P.meadow.length > 2) opts.push('spazier');
      if (P.benches.length) opts.push('bank');
      if (rest && P.meadow.length && !cold) opts.push('picknick');
      const kind = pick(opts, p.id * 7 + 3);
      if (!kind) continue;
      const w = kind === 'sterne' ? W.late : kind === 'picknick' ? W.day : W.eve;
      if (!free(p, w) || !free(q, w)) continue;
      if (w !== W.late && w !== W.eve && (!adultWin(p, w) || !adultWin(q, w))) continue;
      // Treffpunkt zwischen beiden (wo sie vorher sind); wohnen oder arbeiten sie zu weit auseinander, gibt es heute kein Date
      const pa = homeOf(p), qa = homeOf(q), ma = { x: (pa.x + qa.x) / 2, y: (pa.y + qa.y) / 2 };
      if (Math.hypot(pa.x - qa.x, pa.y - qa.y) > FAR_EV * 2) continue;
      const nearMa = o => (o && Math.hypot(o.x - ma.x, o.y - ma.y) <= FAR_EV ? o : null);
      let pl = null, sl = null, where = '';
      if (kind === 'strand' || kind === 'sonne') {
        pl = kind === 'strand' ? spot(P.beach, w, p.id, ma) : spot(P.shore, w, p.id, ma) || nearMa(P.view);
        if (!pl) continue;
        sl = row(2, pl.nx, pl.ny, 0.15, 'floor');
        where = kind === 'strand' ? L(' am Strand', ' on the beach') : L(' im Abendrot', ' at sunset');
      } else if (kind === 'sterne') {
        pl = spot(P.meadow, w, p.id, ma); if (!pl) continue;
        const a = h(p.id * 5) * Math.PI * 2;
        sl = row(2, Math.cos(a), Math.sin(a), 0.13, 'sleep', { lie: true });
        where = L(' unter den Sternen', ' under the stars');
      } else if (kind === 'bank') {
        pl = spot(P.benches, w, p.id, ma); if (!pl) continue;
        sl = row(2, pl.nx, pl.ny, 0.11, 'talksit', { seat: true });
        where = L(' auf einer Bank', ' on a bench');
      } else if (kind === 'picknick') {
        pl = spot(P.meadow, w, p.id, ma); if (!pl) continue;
        sl = [{ dx: -0.1, dz: 0, face: faceTo(1, 0), pose: 'floor' }, { dx: 0.1, dz: 0, face: faceTo(-1, 0), pose: 'floor' }];
        where = L(' beim Picknick', ' at a picnic');
      } else {
        // Spaziergang zu zweit: Rundweg über Wiese und Ufer, Seite an Seite
        const way = [];
        for (let k = 0; k < 4; k++) { const q0 = nearMa(pick(k % 2 ? (P.shore.length ? P.shore : P.meadow) : P.meadow, p.id * 11 + k, ma)); if (q0) way.push([q0.x, q0.y]); }
        if (way.length < 2) continue;
        pl = { x: way[0][0], y: way[0][1] };
        sl = [{ dx: 0, dz: 0, face: 0, pose: 'walk', lane: 0.065 }, { dx: 0, dz: 0, face: 0, pose: 'walk', lane: -0.065 }];
        add(s, 'date', w, pl.x, pl.y, [p, q], sl, { names: [p.n, q.n], where: L(' beim Spaziergang', ' on a walk'), dyn: 'loop', way, slow: 0.78, hearts: true });
        continue;
      }
      const props = kind === 'picknick' ? [{ t: 'decke', dx: 0, dz: 0, w: 0.34, d: 0.26, c: h(p.id) }] : kind === 'strand' ? [{ t: 'tuch', dx: 0, dz: 0, w: 0.34, d: 0.2, rot: faceTo(pl.nx, pl.ny), c: h(p.id) }] : null;
      add(s, 'date', w, pl.x, pl.y, [p, q], sl, { names: [p.n, q.n], where, hearts: true, props });
    }

    // 5 Familien am Ruhetag: Picknick auf der Wiese oder Strand im Sommer
    if (rest) {
      const homes = new Map();
      for (const p of people) if (p.home > 0) { const l = homes.get(p.home); if (l) l.push(p); else homes.set(p.home, [p]); }
      for (const [hid, fam] of homes) {
        const ad = fam.filter(p => p.job !== 'kind' && p.job !== 'alt' && !WORK_ON_REST.has(p.job));
        const ks = fam.filter(p => p.job === 'kind');
        if (!ad.length || !ks.length || h(hid * 3) > 0.32) continue;
        const all = fam.filter(p => free(p, W.day) && !p.sick);
        if (all.length < 2) continue;
        const beach = warm && P.beach.length && h(hid * 5) < 0.55;
        const hb = rt.bById.get(hid), anc = hb ? { x: hb.x, y: hb.y } : center;
        const pl = beach ? spot(P.beach, W.day, hid, anc) : spot(P.meadow, W.day, hid, anc);
        if (!pl) continue;
        const grown = all.filter(p => p.job !== 'kind'), small = all.filter(p => p.job === 'kind');
        const members = [...grown, ...small];
        let sl;
        if (beach) {
          const base = row(grown.length, pl.nx, pl.ny, 0.17, k => (k % 2 ? 'floor' : 'sleep'));
          sl = base.map(o => (o.pose === 'sleep' ? { ...o, lie: true } : o));
          for (let k = 0; k < small.length; k++) sl.push({ dx: pl.nx * 0.35, dz: pl.ny * 0.35, face: faceTo(pl.nx, pl.ny), pose: 'run', dyn: 'shore' });
          add(s, 'strand', W.day, pl.x, pl.y, members, sl, { props: base.map((o, k) => ({ t: 'tuch', dx: o.dx, dz: o.dz, w: 0.1, d: 0.24, rot: faceTo(pl.nx, pl.ny), c: h(hid + k) })).concat(era >= 5 ? [{ t: 'schirm', dx: -pl.nx * 0.12, dz: -pl.ny * 0.12, c: h(hid, 9) }] : []), nx: pl.nx, ny: pl.ny });
        } else {
          sl = ring(grown.length, 0.17, 'floor');
          for (let k = 0; k < small.length; k++) sl.push({ dx: 0, dz: 0, face: 0, pose: 'run', dyn: 'tag', r: 0.75 });
          add(s, 'picknick', W.day, pl.x, pl.y, members, sl, { props: [{ t: 'decke', dx: 0, dz: 0, w: 0.4, d: 0.32, c: h(hid) }] });
        }
      }
    }

    // 6 Abends: Lagerfeuer (frühe Zeit) oder Tanz am Festtag, Taverne mit Freunden
    const festDay = st.chronicle.some(c => (c.k === 'fest' || c.k === 'mythos') && c.s === s.id && c.d >= vday * VDAYS - 1);
    if (festDay) {
      const list = [...adults, ...olds, ...kids].filter(p => free(p, W.eve) && rnd() < 0.7).slice(0, 26);
      if (list.length >= 4) {
        const mus = list.filter(p => (p.tr?.kunst ?? 0) > 0.6).slice(0, 2);
        const dancers = list.filter(p => !mus.includes(p));
        const sl = ring(dancers.length, Math.max(0.5, dancers.length * 0.13 / (Math.PI * 2) * 1.2), k => (k % 4 === 3 ? 'chat' : 'cheer'));
        const ev = add(s, 'tanz', W.eve, center.x, center.y, dancers, sl, { fest: true, dyn: 'dance' });
        if (mus.length) add(s, 'musik', W.eve, center.x, center.y, mus, mus.map((_, k) => ({ dx: 0.12 * (k ? 1 : -1), dz: -0.15, face: faceTo(0, 1), pose: 'cheer' })));
        void ev;
      }
    } else if (era <= 2) {
      const list = [...adults, ...olds, ...kids].filter(p => free(p, W.eve) && h(p.id * 17 + 5) < (p.job === 'kind' ? 0.55 : 0.45)).slice(0, 24);
      if (list.length >= 3) {
        const teller = list.reduce((a, p) => (ageOf(st, p) > ageOf(st, a) ? p : a), list[0]);
        const sit = list.filter(p => p !== teller);
        const r = Math.max(0.42, (sit.length + 1) * 0.12 / (Math.PI * 2) * 1.15);
        const sl = ring(sit.length + 1, r, 'floor');
        const tsl = { ...sl[0], pose: 'chat', role: 'erz' };
        // solange die Dorfmitte eine offene Feuerstelle ist, sitzen sie dort; ist sie ein Haus geworden (ab Stufe 2), brennt
        // das Feuer auf einem freien Fleck des Platzes oder auf der Wiese
        const z = (P.bld.zentrum || [])[0], open = z && Math.max(z.lvl | 0, era - 2) <= 1;
        const fp = open ? center : spot(P.plaza.length ? P.plaza : P.meadow, W.eve, 950, center) || pick(P.meadow, 951, center);
        if (fp) add(s, 'feuer', W.eve, fp.x, fp.y, [teller, ...sit], [tsl, ...sl.slice(1)], open ? {} : { props: [{ t: 'feuer' }], fire: true });
      }
    }
    if (tav && P.garden && era >= 2) {
      const pool = adults.filter(p => free(p, W.eve));
      for (let g = 0; g < 2 && pool.length >= 2; g++) {
        const a = pool[Math.floor(h(31 + g) * pool.length)];
        if (rnd() > 0.6) continue;
        const fr = Object.entries(a.ties || {}).filter(([, v]) => v > 30).map(([k]) => byId(+k)).filter(q => q && pool.includes(q)).slice(0, 3);
        if (!fr.length) continue;
        const grp = [a, ...fr];
        grp.forEach(p => pool.splice(pool.indexOf(p), 1));
        // am Biertisch sitzen sie sich gegenüber und trinken, die zweite Gruppe steht mit dem Krug daneben
        const sl = grp.map((_, k) => {
          if (g === 0) { const side = k % 2 ? 1 : -1, o = (Math.floor(k / 2) - 0.5) * 0.12; return { dx: o, dz: side * 0.115, face: faceTo(0, -side), pose: 'drink', seat: true }; }
          const ang = k / grp.length * Math.PI * 2; return { dx: 0.42 + Math.cos(ang) * 0.13, dz: Math.sin(ang) * 0.13, face: faceTo(-Math.cos(ang), -Math.sin(ang)), pose: 'chat' };
        });
        add(s, 'taverne', W.eve, P.garden.x, P.garden.y, grp, sl);
      }
    }

    // 7 Kinder: Fangen, Ball, Verstecken, am Strand
    const kidPool = kids.filter(k => free(k, W.kid) || free(k, W.kidS)).sort((a, b) => hash(a.id, vday) - hash(b.id, vday));
    for (let g = 0; g < 4 && kidPool.length >= 3; g++) {
      const n = Math.min(kidPool.length, 3 + Math.floor(h(61 + g) * 4));
      const grp = kidPool.splice(0, n);
      if (rnd() > 0.75) continue;
      const w = grp.every(k => free(k, W.kid)) ? W.kid : W.kidS;
      const games = ['fangen', 'ball', 'verstecken'];
      if (warm && P.beach.length) games.push('strand');
      if (era >= 3) games.push('fussball');
      const game = games[Math.floor(h(71 + g) * games.length)];
      const anc = homeOf(grp[0]), pl = game === 'strand' ? spot(P.beach, w, 900 + g, anc) : spot(P.meadow, w, 800 + g, anc) || (P.plaza.length ? pick(P.plaza, 810 + g, anc) : center);
      if (!pl) continue;
      if (game === 'fangen') add(s, 'fangen', w, pl.x, pl.y, grp, grp.map((_, k) => ({ dx: 0, dz: 0, face: 0, pose: 'run', dyn: 'tag', r: 1.0, it: k === 0 })));
      else if (game === 'ball' || game === 'fussball') add(s, game, w, pl.x, pl.y, grp, ring(grp.length, game === 'fussball' ? 0.7 : 0.45, 'idle', { dyn: 'ball' }), { dyn: 'ball', ball: true });
      else if (game === 'strand') add(s, 'strand', w, pl.x, pl.y, grp, grp.map(() => ({ dx: 0, dz: 0, face: 0, pose: 'run', dyn: 'shore' })), { nx: pl.nx, ny: pl.ny });
      else {
        // Verstecken: einer zählt am Baum, die anderen verstecken sich hinter Häusern in der Nähe, dann wird gesucht
        const homes = (P.bld.haus || []).slice(0, 12);
        const sl = grp.map((_, k) => {
          if (k === 0) return { dx: 0, dz: 0, face: 0, pose: 'idle', dyn: 'seek', role: 'such' };
          const b = homes[Math.floor(h(91 + g * 7 + k) * homes.length)];
          return b ? { dx: b.x - pl.x + (h(k, 3) < 0.5 ? 0.5 : -0.5), dz: b.y - pl.y + (h(k, 4) < 0.5 ? 0.5 : -0.5), face: h(k) * 6.28, pose: 'idle', role: 'hide' } : { dx: (h(k, 5) - 0.5) * 2, dz: (h(k, 6) - 0.5) * 2, face: 0, pose: 'idle', role: 'hide' };
        });
        add(s, 'verstecken', w, pl.x, pl.y, grp, sl, { dyn: 'seek' });
      }
    }

    // 8 Alte: Bank auf dem Platz, Spaziergang, Angeln, Mittagsschlaf, Garten
    const oldPool = olds.filter(p => free(p, W.old) && !p.sick);
    for (let g = 0; oldPool.length && g < 6; g++) {
      const a = oldPool.shift();
      const r = h(a.id * 13 + 7);
      if (r < 0.32 && P.benches.length) {
        const fr = oldPool.filter(q => (a.ties?.[q.id] ?? 0) > 10).slice(0, 1);
        fr.forEach(q => oldPool.splice(oldPool.indexOf(q), 1));
        const b = spot(P.benches, W.old, a.id, homeOf(a));
        if (!b) continue;
        const grp = [a, ...fr];
        add(s, 'bank', W.old, b.x, b.y, grp, row(grp.length, b.nx, b.ny, 0.11, 'talksit', { seat: true }));
      } else if (r < 0.5 && P.shore.length && !cold) {
        const pl = spot(P.shore, W.old, a.id, homeOf(a)); if (!pl) continue;
        add(s, 'angeln', W.old, pl.x, pl.y, [a], [{ dx: pl.nx * 0.25, dz: pl.ny * 0.25, face: faceTo(pl.nx, pl.ny), pose: h(a.id) < 0.5 ? 'floor' : 'idle', item: 'angel' }]);
      } else if (r < 0.66 && P.meadow.length) {
        const way = [];
        for (let k = 0; k < 3; k++) { const q0 = pick(P.meadow, a.id * 5 + k, homeOf(a)); if (q0) way.push([q0.x, q0.y]); }
        if (way.length >= 2) add(s, 'spaziergang', W.old, way[0][0], way[0][1], [a], [{ dx: 0, dz: 0, face: 0, pose: 'walk' }], { dyn: 'loop', way, slow: 0.7 });
      } else if (r < 0.76 && P.tree.length && season === 1) {
        const pl = spot(P.tree, W.old, a.id, homeOf(a)); if (!pl) continue;
        add(s, 'nap', W.old, pl.x, pl.y, [a], [{ dx: pl.nx * 0.2, dz: pl.ny * 0.2, face: faceTo(-pl.nx, -pl.ny), pose: 'sleep', lie: true }]);
      } else if (r < 0.88 && a.home > 0) yardEvent(st, s, a, 'garten', W.old, add);
    }

    // 9 Erwachsene: Freunde am Strand, Angeln, Garten, Holz, Wäsche, Lesen, Joggen, Sonnenuntergang, Besuch, Streit, Spaziergang
    const wins = rest ? [W.day, W.eve] : [W.eve];
    for (const w of wins) {
      const pool = adults.filter(p => free(p, w) && adultWin(p, w) && !p.sick);
      // Freunde zusammen an den Strand (Sommer)
      if (warm && P.beach.length) for (let g = 0; g < 3 && pool.length >= 2; g++) {
        const a = pool[Math.floor(h(201 + g + (w === W.eve ? 50 : 0)) * pool.length)];
        if (rnd() > (w === W.day ? 0.6 : 0.35)) continue;
        const fr = Object.entries(a.ties || {}).filter(([, v]) => v > 25).map(([k]) => byId(+k)).filter(q => q && pool.includes(q)).slice(0, 3);
        if (!fr.length) continue;
        const grp = [a, ...fr], pl = spot(P.beach, w, a.id + 7, homeOf(a));
        if (!pl) continue;
        grp.forEach(p => pool.splice(pool.indexOf(p), 1));
        const sl = row(grp.length, pl.nx, pl.ny, 0.17, k => (k % 3 === 1 ? 'floor' : 'sleep')).map(o => (o.pose === 'sleep' ? { ...o, lie: true } : o));
        add(s, 'strand', w, pl.x, pl.y, grp, sl, { props: sl.map((o, k) => ({ t: 'tuch', dx: o.dx, dz: o.dz, w: 0.1, d: 0.24, rot: faceTo(pl.nx, pl.ny), c: h(a.id + k) })).concat(era >= 5 ? [{ t: 'schirm', dx: -pl.nx * 0.12, dz: -pl.ny * 0.12, c: h(a.id, 9) }] : []), nx: pl.nx, ny: pl.ny });
      }
      for (const p of pool) {
        if (!free(p, w)) continue;
        // jede Tätigkeit hat ihr eigenes Fenster in r, so addiert sich nichts auf (r über 0,45: nichts Besonderes)
        const r = h(p.id * 29 + (w === W.eve ? 3 : 9)), tr = p.tr || {}, inR = (a, b) => r >= a && r < b;
        const fisher = p.job === 'fischer' || (tr.neugier ?? 0.5) < 0.4 && p.sex === 'm';
        if (inR(0, fisher ? 0.12 : 0.04) && P.shore.length && !cold) {
          const pl = spot(P.shore, w, p.id, homeOf(p)); if (!pl) continue;
          // Freunde angeln gern zu zweit
          const fr = pool.find(q => q !== p && free(q, w) && (p.ties?.[q.id] ?? 0) > 40);
          const grp = fr && h(p.id, 3) < 0.5 ? [p, fr] : [p];
          add(s, 'angeln', w, pl.x, pl.y, grp, row(grp.length, pl.nx, pl.ny, 0.3, k => (k ? 'floor' : 'idle'), { item: 'angel' }).map(o => ({ ...o, dx: o.dx + pl.nx * 0.25, dz: o.dz + pl.ny * 0.25 })));
        } else if (inR(0.12, 0.16) && (tr.fleiss ?? 0.5) > 0.5 && p.home > 0) yardEvent(st, s, p, 'garten', w, add);
        else if (inR(0.16, 0.18) && era <= 5 && p.home > 0) yardEvent(st, s, p, 'holz', w, add);
        else if (inR(0.18, 0.2) && (P.shore.length || (P.bld.brunnen || []).length) && w !== W.late) {
          const b = (P.bld.brunnen || [])[0], pl = P.shore.length ? spot(P.shore, w, p.id + 3, homeOf(p)) : null;
          if (pl) add(s, 'waesche', w, pl.x, pl.y, [p], [{ dx: pl.nx * 0.3, dz: pl.ny * 0.3, face: faceTo(pl.nx, pl.ny), pose: 'pickup', item: 'eimer' }]);
          else if (b) add(s, 'waesche', w, b.x, b.y, [p], [{ dx: 0.32, dz: 0.1, face: faceTo(-1, 0), pose: 'pickup', item: 'eimer' }]);
        } else if (inR(0.2, 0.24) && ((tr.neugier ?? 0.5) > 0.6 || p.job === 'gelehrter') && P.tree.length && !cold) {
          const pl = spot(P.tree, w, p.id, homeOf(p)); if (!pl) continue;
          add(s, 'lesen', w, pl.x, pl.y, [p], [{ dx: pl.nx * 0.22, dz: pl.ny * 0.22, face: faceTo(-pl.nx, -pl.ny), pose: 'floor', item: 'buch' }]);
        } else if (inR(0.24, 0.28) && era >= 6 && (tr.mut ?? 0.5) > 0.45 && P.meadow.length) {
          const way = [];
          for (let k = 0; k < 5; k++) { const q0 = pick(k % 2 && P.shore.length ? P.shore : P.meadow, p.id * 3 + k, homeOf(p)); if (q0) way.push([q0.x, q0.y]); }
          if (way.length >= 3) add(s, 'joggen', w, way[0][0], way[0][1], [p], [{ dx: 0, dz: 0, face: 0, pose: 'run' }], { dyn: 'loop', way, slow: 2.0, run: true });
        } else if (inR(0.28, 0.32) && (tr.kunst ?? 0.5) > 0.55 && w === W.eve && (P.shore.length || P.view)) {
          const an = homeOf(p), pl = spot(P.shore, w, p.id + 11, an) || (P.view && Math.hypot(P.view.x - an.x, P.view.y - an.y) <= FAR_EV ? P.view : null);
          if (pl) add(s, 'sonne', w, pl.x, pl.y, [p], [{ dx: pl.nx * 0.2, dz: pl.ny * 0.2, face: faceTo(pl.nx, pl.ny), pose: 'floor' }]);
        } else if (inR(0.32, 0.37)) {
          // Besuch bei Freunden: man steht vor ihrer Tür und redet
          const fid = Object.entries(p.ties || {}).filter(([, v]) => v > 35).map(([k]) => +k).find(k => { const q = byId(k); return q && q.s === s.id && q.home > 0 && q.home !== p.home && free(q, w) && pool.includes(q); });
          const q = fid && byId(fid), b = q && rt.bById.get(q.home);
          const an = homeOf(p);
          if (b && Math.hypot(b.x - an.x, b.y - an.y) <= FAR_EV * 1.5) add(s, 'besuch', w, b.x, b.y, [p, q], [{ dx: 0, dz: 0, face: 0, pose: 'chat', door: true, role: 'gast' }, { dx: 0, dz: 0, face: 0, pose: 'chat', door: true, role: 'wirt' }], { names: [q.n, p.n], visit: b.id });
        } else if (inR(0.37, 0.4) && w === W.eve) {
          // Streit mit einem Feind auf dem Platz
          const eid = Object.entries(p.ties || {}).filter(([, v]) => v < -45).map(([k]) => +k).find(k => { const q = byId(k); return q && pool.includes(q) && free(q, w); });
          const q = eid && byId(eid);
          if (q) { const pl = pick(P.plaza, p.id) || center; add(s, 'streit', w, pl.x, pl.y, [p, q], [{ dx: -0.1, dz: 0, face: faceTo(1, 0), pose: 'cheer' }, { dx: 0.1, dz: 0, face: faceTo(-1, 0), pose: 'chat' }], { names: [q.n, p.n] }); }
        } else if (inR(0.4, 0.43) && P.meadow.length && w === W.eve) {
          const way = [];
          for (let k = 0; k < 3; k++) { const q0 = pick(P.meadow, p.id * 9 + k, homeOf(p)); if (q0) way.push([q0.x, q0.y]); }
          if (way.length >= 2) add(s, 'spaziergang', w, way[0][0], way[0][1], [p], [{ dx: 0, dz: 0, face: 0, pose: 'walk' }], { dyn: 'loop', way, slow: 0.8 });
        }
      }
    }
  }
  return C;
}

// Arbeit am eigenen Haus: im Hof (freies Nachbarfeld), Garten bückt sich, Holzhacken mit der Axt
function yardEvent(st, s, p, k, w, add) {
  const rt = st._rt, b = rt.bById.get(p.home), T = st.tiles;
  if (!b) return;
  for (const [a, c] of D8) {
    const x = b.x + a, y = b.y + c, i = y * NX + x;
    if (T.h[i] < 1 || rt.bldAt[i] || (T.st && T.st[i]) || T.road[i] > 70 || (T.river && T.river[i])) continue;
    add(s, k, w, x, y, [p], [{ dx: (hash(p.id, 3) - 0.5) * 0.3, dz: (hash(p.id, 4) - 0.5) * 0.3, face: Math.atan2(-a, -c), pose: k === 'holz' ? 'hammer' : 'pickup', item: k === 'holz' ? 'axt' : null }], { home: true });
    return;
  }
}

// Läuft für diesen Menschen gerade eine Unternehmung? (ph: seine Tageszeit) Regen sagt draußen ab.
// skip: eine Unternehmung, die dieser Mensch heute auslässt (zu weit weg, people.js)
export function activeEvent(st, p, ph, skip = 0) {
  const C = program(st), list = C.byP.get(p.id);
  if (!list) return null;
  const wet = st.weather && (st.weather.kind === 'regen' || st.weather.kind === 'sturm' || st.weather.kind === 'schnee');
  for (const ev of list) {
    if (ph < ev.w[0] || ph >= ev.w[1] || ev.id === skip) continue;
    if (wet && !KINDS[ev.k].rain) return null;
    return ev;
  }
  return null;
}

// Die nächste Unternehmung dieses Menschen, die in höchstens span (Tagesanteil) beginnt (zum rechtzeitigen Aufbruch)
export function nextEvent(st, p, ph, span, skip = 0) {
  const list = program(st).byP.get(p.id);
  if (!list) return null;
  const wet = st.weather && (st.weather.kind === 'regen' || st.weather.kind === 'sturm' || st.weather.kind === 'schnee');
  let best = null;
  for (const ev of list) {
    if (ev.id === skip || ev.bid || ev.w[0] <= ph || ev.w[0] - ph > span || (wet && !KINDS[ev.k].rain)) continue;
    if (!best || ev.w[0] < best.w[0]) best = ev;
  }
  return best;
}

// Text für Listen und Karten: was tut dieser Mensch gerade bei dieser Unternehmung
export function eventText(ev, pid) {
  const K = KINDS[ev.k], sl = ev.sl.get(pid) || {}, i = ev.m.indexOf(pid);
  let n = '';
  if (ev.names) {
    if (ev.k === 'hochzeit') n = sl.role === 'paar' ? '' : ev.names.join(L(' und ', ' and '));
    else if (ev.k === 'trauer') n = ev.names[0];
    else n = ev.names[i === 0 ? 1 : 0] || ev.names[0];
  }
  if (ev.k === 'hochzeit' && sl.role === 'paar') return L(`heiratet ${ev.names[i === 0 ? 1 : 0]}`, `getting married to ${ev.names[i === 0 ? 1 : 0]}`);
  return K.t(n, ev.where || '', sl.dyn === 'shore' || sl.pose === 'run', sl.role);
}
