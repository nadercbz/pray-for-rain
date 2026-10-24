// Tagesablauf der Menschen, gemeinsam für draußen (people.js) und drinnen (interior.js). Beide Ansichten fragen hier,
// wo jemand gerade ist und was er tut. So sind im Haus genau die Menschen, die draußen gerade fehlen, und sie tun,
// was zur Tageszeit passt: schlafen, frühstücken, kochen, essen, reden, spielen, dösen, krank im Bett liegen.
// Alles hängt nur an Tageszeit f, Uhr t (Sekunden), Spieltag und Person, nie an Zufall, also überall gleich.
// Seit 21.10.2026 mit Unternehmungen (leisure.js: Strand, Date, Picknick, Angeln, Lagerfeuer, Taverne, Markt, Gottesdienst,
// Hochzeit, Trauerfeier, Kinderspiele und mehr) und Ruhetagen (zwei von sieben Tagen, Erwachsene arbeiten nicht).
import { DAYS_PER_YEAR } from '../sim/data.js';
import { activeEvent, restDay, eventText } from './leisure.js';

export const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const VDAYS = 6; // ein sichtbarer Tag sind sechs Spieltage (main.js)

// Arbeitsplätze, an denen drinnen gearbeitet wird, und was man dort tut
export const INDOOR = { werkstatt: 'hammer', fabrik: 'hammer', kraftwerk: 'hammer', schule: 'teach', sternwarte: 'read', heiler: 'heal', schrein: 'pray', theater: 'cheer' };
const CRAFTY = new Set(['handwerker', 'holzfaeller', 'baumeister', 'steinmetz', 'arbeiter']);

// Einmal je Spieltag: wer geht in welche Schule, welche Kranken liegen beim Heiler, wer kocht in welchem Haus
const cache = new WeakMap();
export function prep(st) {
  let C = cache.get(st);
  if (C && C.day === st.day && C.n === st.people.length) return C;
  C = { day: st.day, n: st.people.length, school: new Map(), heal: new Map(), cook: new Map(), fest: new Set() };
  // Festtage: wo gestern oder heute gefeiert wird (Erntefest, Friedensfest, Mythos), geht abends jeder auf den Platz
  for (let i = st.chronicle.length - 1; i >= 0 && st.chronicle[i].d >= st.day - 1; i--) { const c = st.chronicle[i]; if ((c.k === 'fest' || c.k === 'mythos') && c.s >= 0) C.fest.add(c.s); }
  const by = new Map();
  for (const b of st.buildings) {
    if (b.prog < 1 || (b.t !== 'schule' && b.t !== 'heiler')) continue;
    let e = by.get(b.s);
    if (!e) by.set(b.s, e = { schule: [], heiler: [] });
    e[b.t].push({ b, n: 0 });
  }
  const free = list => list.find(x => x.n < (x.b.t === 'schule' ? 12 : 3));
  for (const p of st.people) {
    if (p.away) continue;
    const age = (st.day - p.b) / DAYS_PER_YEAR;
    // Gekocht wird von einer Erwachsenen im Haus, sonst vom ersten Erwachsenen
    if (p.home > 0 && age >= 14) { const c = C.cook.get(p.home); if (!c || (p.sex === 'f' && !c.f)) C.cook.set(p.home, { id: p.id, f: p.sex === 'f' }); }
    const e = by.get(p.s);
    if (!e) continue;
    if (p.sick && e.heiler.length) { const h = free(e.heiler); if (h) { h.n++; C.heal.set(p.id, h.b.id); } }
    else if (p.job === 'kind' && age >= 6 && age < 14 && e.schule.length) { const h = free(e.schule); if (h) { h.n++; C.school.set(p.id, h.b.id); } }
  }
  cache.set(st, C);
  return C;
}

// Ergebnis (wird wiederverwendet, sofort auslesen):
//   at: 'home' | 'in' (in einem anderen Gebäude bid) | 'out'
//   act: was jemand drinnen tut (sleep, sick, cook, sit, drink, talksit, doze, floor, hammer, chat, pray, read, teach, heal, cheer)
//   out: 'walk' (von a nach b, Anteil u), 'work' (am Arbeitsplatz), 'yard' (kurz vor der Tür), 'play', 'plaza',
//        'ev' (Unternehmung ev aus leisure.js, draußen)
//   a, b: Wegpunkte 'H' Haus, 'W' Arbeit, 'C' Dorfplatz, 'S' Schule oder Heiler (bid)
const R = { at: 'out', act: '', out: '', a: '', b: '', u: 0, bid: 0, ev: null, pid: 0 };
const home = act => { R.at = 'home'; R.act = act; R.bid = 0; return R; };
const inside = (bid, act) => { R.at = 'in'; R.bid = bid; R.act = act; return R; };
const walk = (a, b, u) => { R.at = 'out'; R.out = 'walk'; R.a = a; R.b = b; R.u = Math.max(0, Math.min(1, u)); return R; };
const out = k => { R.at = 'out'; R.out = k; return R; };

export const festive = (st, sid) => prep(st).fest.has(sid);

// skip: Id einer Unternehmung, die dieser Mensch heute auslässt
export const phaseOf = (p, f) => { const ph = f - hash(p.id, 1) * 0.05; return ph < 0 ? ph + 1 : ph; };
export function plan(st, p, f, t, stormy, skip = 0) {
  const rt = st._rt, C = prep(st);
  const vday = Math.floor(st.day / VDAYS), rest = restDay(vday);
  R.ev = null; R.pid = p.id;
  let ph = f - hash(p.id, 1) * 0.05;
  if (ph < 0) ph += 1;
  const age = (st.day - p.b) / DAYS_PER_YEAR;
  const kid = p.job === 'kind', tot = kid && age < 5, old = p.job === 'alt';
  const hasHome = p.home > 0 && rt.bById.has(p.home);
  const cook = hasHome && C.cook.get(p.home)?.id === p.id;
  const v = hash(p.id, vday * 5 + 2);
  // Was man drinnen am Abend tut
  const evening = () => (tot || kid ? (v < 0.75 ? 'floor' : 'sit') : old ? (v < 0.6 ? 'doze' : 'talksit')
    : p.job === 'priester' ? 'pray' : p.job === 'gelehrter' && v < 0.6 ? 'read' : CRAFTY.has(p.job) && v < 0.3 ? 'hammer'
      : v < 0.45 ? 'talksit' : v < 0.65 ? 'drink' : v < 0.8 ? 'sit' : 'chat');
  const meal = () => (tot || kid ? 'sit' : v < 0.5 ? 'drink' : v < 0.8 ? 'talksit' : 'sit');
  const res = (() => {
    // Krank: im Bett, tagsüber beim Heiler, wenn es einen gibt
    if (p.sick) {
      const hb = C.heal.get(p.id);
      if (hb && hasHome) {
        if (ph >= 0.235 && ph < 0.27) return walk('H', 'S', (ph - 0.235) / 0.035);
        if (ph >= 0.27 && ph < 0.86) return inside(hb, 'sick');
        if (ph >= 0.86 && ph < 0.9) return walk('S', 'H', (ph - 0.86) / 0.04);
      }
      return home(ph < 0.2 || ph >= 0.95 ? 'sleep' : 'sick');
    }
    // Unternehmung: in diesem Zeitfenster draußen bei Strand, Date, Spiel ... oder drinnen beim Gottesdienst
    const E = activeEvent(st, p, ph, skip);
    if (E) {
      if (E.bid) return inside(E.bid, 'pray');
      R.ev = E;
      return out('ev');
    }
    // Abend: auf den Platz oder nach Hause (wechselt von Tag zu Tag), Kleinkinder gehen mit der Mutter
    const goPlaza = C.fest.has(p.s) || hash(tot && p.mo ? p.mo : p.id, vday * 7 + 3) < (kid ? 0.6 : old ? 0.5 : 0.45);
    const bed = tot ? 0.955 : kid ? 0.96 : old ? 0.955 : 0.975;
    const eve = from => {
      if (ph >= bed) return home('sleep');
      if (goPlaza) {
        if (from !== 'C' && ph < 0.78) return walk(from, 'C', (ph - 0.7) / 0.08);
        if (ph < 0.89) return out('plaza');
        if (ph < 0.95) return walk('C', 'H', (ph - 0.89) / 0.06);
        return home(evening());
      }
      if (from === 'H') return home(ph < 0.86 ? (cook && ph < 0.8 ? 'cook' : meal()) : evening());
      if (ph < 0.765) return walk(from, 'H', (ph - 0.7) / 0.065);
      if (ph < 0.86) return home(cook && ph < 0.8 ? 'cook' : meal());
      return home(evening());
    };
    if (!hasHome) {
      // Ohne Haus: tagsüber wie alle, nachts unsichtbar am Feuer
      if (ph < 0.23 || ph >= 0.95) return home('sleep');
    }
    if (tot) {
      if (ph < 0.2) return home('sleep');
      if (ph < 0.235) return home('sit');
      if (ph < 0.7) return home('floor');
      return eve('H');
    }
    if (old) {
      if (ph < 0.2) return home('sleep');
      if (ph < 0.24) return home(cook ? 'cook' : 'sit');
      if (ph < 0.42) return home(v < 0.5 ? 'doze' : 'talksit');
      if (ph < 0.47) return walk('H', 'C', (ph - 0.42) / 0.05);
      if (ph < 0.7) return out('play');
      return eve('C');
    }
    if (kid) {
      if (ph < 0.2) return home('sleep');
      if (ph < 0.235) return home('sit');
      const sb = rest ? null : C.school.get(p.id); // am Ruhetag keine Schule
      if (sb) {
        if (ph < 0.3) return walk('H', 'S', (ph - 0.235) / 0.065);
        if (ph < 0.5) return inside(sb, 'sit');
        if (ph < 0.54) return walk('S', 'C', (ph - 0.5) / 0.04);
        if (ph < 0.7) return out('play');
        return eve('C');
      }
      if (ph < 0.3) return walk('H', 'C', (ph - 0.235) / 0.065);
      if (ph < 0.7) return out('play');
      return eve('C');
    }
    // Ruhetag: länger schlafen, ausgiebig frühstücken, frei bis zum Abend (Heiler, Priester, Händler und Krieger im Krieg arbeiten)
    const s = rt.sById.get(p.s);
    if (rest && !(p.job === 'heiler' || p.job === 'priester' || p.job === 'haendler' || (p.job === 'krieger' && s && s.war))) {
      if (ph < 0.215 || ph >= 0.975) return home('sleep');
      if (ph < 0.3) return home(cook ? 'cook' : meal());
      if (ph < 0.45) return home(v < 0.5 ? 'talksit' : 'drink');
      if (ph < 0.7) return hash(p.id, vday * 3 + 1) < 0.55 ? out('plaza') : home(evening());
      return eve(hash(p.id, vday * 3 + 1) < 0.55 ? 'C' : 'H');
    }
    // Erwachsene mit Beruf
    if (ph < 0.195 || ph >= 0.975) return home('sleep');
    if (ph < 0.235) return home(cook ? 'cook' : meal());
    if (ph < 0.3) return walk('H', 'W', (ph - 0.235) / 0.065);
    if (ph < 0.7) {
      const wb = p.w > 0 ? rt.bById.get(p.w) : null;
      const job = wb && wb.prog >= 1 ? INDOOR[wb.t] : null;
      if (job) {
        // drinnen arbeiten, ab und zu kurz vor die Tür
        const slot = Math.floor(t / 16 + hash(p.id, 41));
        if (hash(p.id, slot * 13 + 5) < 0.2) return out('yard');
        return inside(wb.id, job);
      }
      return out('work');
    }
    return eve('W');
  })();
  // Sturm: die meisten bleiben drinnen
  if (stormy && res.at === 'out' && hash(p.id, 11) < 0.75 && hasHome) return home(kid ? 'floor' : old ? 'doze' : v < 0.5 ? 'talksit' : 'sit');
  return res;
}

// Für die Anzeige: was tut jemand gerade (kurz, für Listen)
export function doing(R, L, place) {
  if (R.at === 'out') {
    if (R.out === 'ev' && R.ev) return eventText(R.ev, R.pid);
    if (R.out === 'walk') return R.b === 'H' ? L('auf dem Heimweg', 'walking home') : R.b === 'W' ? L('auf dem Weg zur Arbeit', 'on the way to work') : R.b === 'S' ? L('unterwegs', 'on the way') : L('auf dem Weg zum Platz', 'on the way to the square');
    return R.out === 'plaza' ? L('auf dem Dorfplatz', 'on the square') : R.out === 'play' ? L('draußen auf dem Platz', 'out on the square') : L('bei der Arbeit', 'at work');
  }
  if (R.at === 'in') return R.act === 'sick' ? L('liegt beim Heiler', 'with the healer') : R.act === 'sit' ? L('in der Schule', 'at school') : L(`bei der Arbeit (${place || ''})`, `at work (${place || ''})`);
  return ({
    sleep: L('schläft', 'asleep'), sick: L('liegt krank im Bett', 'sick in bed'), cook: L('kocht', 'cooking'), sit: L('sitzt am Tisch', 'at the table'),
    drink: L('isst und trinkt', 'eating and drinking'), talksit: L('erzählt', 'talking'), doze: L('döst', 'dozing'), floor: L('spielt', 'playing'),
    hammer: L('bastelt', 'tinkering'), chat: L('unterhält sich', 'chatting'), pray: L('betet', 'praying'), read: L('liest', 'reading'),
  })[R.act] || L('zu Hause', 'at home');
}
