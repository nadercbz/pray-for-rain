// Piraten: Sobald Menschen segeln, gibt es auch Gesetzlose auf dem Meer. Arme, Verbannte, Deserteure nach einem
// Krieg und Abenteurer sammeln sich um einen Kapitän und verstecken sich in einem Nest an einer abgelegenen Küste.
// Sie kapern Handelsschiffe, überfallen Küstenorte, nehmen Gefangene, manchmal heuern sie in Kriegen als Freibeuter
// mit Kaperbrief an. Wachtürme, Werften und Krieger halten sie fern, Flotten jagen sie. Gehen sie unter, vergraben
// sie oft ihre Beute (ein Schatz zum Finden, sites.js). Wer reich und alt wird, gründet am Nest eine Piratenrepublik.
// st.pirates = [{ id, name, cap, capN, from, crew: [ids], ships, gold, fame, nest (site id), x, y, op, d, end }]
// Schiffe im Bild: st.voyages mit k 'pirat' (from und to als Kacheln). Zufall über rng(st).
import * as D from './data.js';
import { NX, NY, idx } from './world.js';
import { clamp } from './rng.js';
import { chron, rng, fx, members, isleOf, knows, bio, killPerson, bldOf } from './util.js';
import { addSite } from './sites.js';
import { L } from '../i18n.js';

const YEAR = D.DAYS_PER_YEAR;
const CREW_NAMES = L(['die Schwarzen Möwen', 'die Brüder vom Riff', 'die Rotsegel', 'die Kinder der Flut', 'die Salzkrähen', 'die Witwen des Meeres', 'die Nebelwölfe', 'die Söhne des Sturms', 'die Knochenfahrer', 'die Freien vom Kap'],
  ['the Black Gulls', 'the Brothers of the Reef', 'the Red Sails', 'the Children of the Tide', 'the Salt Crows', 'the Widows of the Sea', 'the Fog Wolves', 'the Sons of the Storm', 'the Bone Riders', 'the Free Folk of the Cape']);
const EPITHET = L(['Einauge', 'die Narbe', 'der Lachende', 'Salzbart', 'die Schwarze', 'Eisenhand', 'der Stille', 'Sturmzahn'], ['One-Eye', 'the Scar', 'the Laughing', 'Saltbeard', 'the Black', 'Ironhand', 'the Silent', 'Stormtooth']);
const CAUSE = L('Piraten', 'Pirates');

const live = st => (st.pirates || []).filter(c => !c.end);
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const crewOf = (st, c) => c.crew.map(id => st._rt.pById.get(id)).filter(Boolean);

// Abgelegene Küste für ein Nest: Strand neben Wasser, weit weg von jedem Ort, gern auf einer leeren Insel
// In der Erde in Reichweite der Heimat (bis 110 Felder), sonst irgendwo auf der Welt
function hideout(st, r, home) {
  const T = st.tiles;
  let best = null, bs = -1;
  for (let k = 0; k < 500; k++) {
    const x = st.earth && home ? Math.round(home.cx + r.range(-110, 110)) : r.int(3, NX - 4), y = st.earth && home ? Math.round(home.cy + r.range(-110, 110)) : r.int(3, NY - 4);
    if (x < 3 || y < 3 || x > NX - 4 || y > NY - 4) continue;
    const i = idx(x, y);
    if (T.h[i] !== 0 && T.h[i] !== 1) continue;
    let wet = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (T.h[idx(x + dx, y + dy)] < 0) wet++;
    if (!wet) continue;
    let dmin = Infinity; for (const s of st.settlements) if (s.alive) dmin = Math.min(dmin, Math.hypot(s.cx - x, s.cy - y));
    if (dmin < 18) continue;
    const score = Math.min(dmin, 60) + r.range(0, 10);
    if (score > bs) { bs = score; best = [x, y]; }
  }
  return best;
}

// Wasser vor einer Kachel (für Schiffswege)
function sea(st, x, y) {
  const T = st.tiles;
  for (let rr = 0; rr < 8; rr++) for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx < 1 || yy < 1 || xx >= NX - 1 || yy >= NY - 1) continue;
    if (T.h[idx(xx, yy)] < 0) return [xx, yy];
  }
  return [x, y];
}

// Schutz eines Ortes vor Piraten: Türme, Werften, Krieger, Burg
function guard(st, s) {
  const B = s.bon || {};
  const w = members(st, s).adults.filter(p => p.job === 'krieger').length;
  return (B.pirate || 0) + (B.navy || 0) * 0.3 + w * 0.04 + (s.has.burg ? 0.3 : 0);
}

// Eine Bande entsteht: wer arm, wütend oder heimatlos ist, folgt einem Kapitän
function spawn(st, r) {
  const cands = st.settlements.filter(s => s.alive && s.pop >= 30 && knows(st, 'segeln', s) && bldOf(st, s).some(b => (b.t === 'hafen' || b.t === 'fischer')));
  if (!cands.length) return;
  const s = r.pick(cands);
  const M = members(st, s);
  const pool = M.adults.filter(p => !p.lt && !p.pa && ((p.poor || 0) > 4 || p.tr.wut > 0.62 || p.bond || p.tr.mut > 0.72));
  if (pool.length < 4) return;
  pool.sort((a, b) => (b.tr.mut + b.tr.wut) - (a.tr.mut + a.tr.wut));
  const cap = pool[0];
  const n = Math.min(pool.length, 4 + r.int(0, 8));
  const crew = pool.slice(0, n);
  const spot = hideout(st, r, s);
  if (!spot) return;
  const used = new Set(live(st).map(c => c.name));
  const name = r.pick(CREW_NAMES.filter(x => !used.has(x)).length ? CREW_NAMES.filter(x => !used.has(x)) : CREW_NAMES);
  const capN = `${cap.n} ${r.pick(EPITHET)}`;
  st.pirateId = (st.pirateId || 0) + 1;
  const nest = addSite(st, 'nest', spot[0], spot[1], { found: st.day, name: L(`das Nest der ${name.replace(/^die /, '')}`, `the cove of ${name}`), crew: st.pirateId });
  const c = { id: st.pirateId, name, cap: cap.id, capN, from: s.id, crew: crew.map(p => p.id), ships: 1 + (crew.length > 8 ? 1 : 0), gold: 0, fame: 0, nest: nest.id, x: spot[0], y: spot[1], op: null, d: st.day, end: 0, letter: 0 };
  st.pirates = st.pirates || [];
  st.pirates.push(c);
  for (const p of crew) { p.s = -1; p.away = true; p.pirate = c.id; p.home = -1; p.w = -1; bio(p, st.day, L(`geht zu den Piraten (${name})`, `joins the pirates (${name})`)); }
  chron(st, 'piraten', L(`In einer mondlosen Nacht stehlen ${crew.length} Menschen aus ${s.name} ein Boot. Ihr Anführer nennt sich ${capN}. Man nennt sie bald ${name}.`, `On a moonless night, ${crew.length} people from ${s.name} steal a boat. Their leader calls themself ${capN}. Soon they are known as ${name}.`), s.id, 2, { x: spot[0], y: spot[1] });
  fx(st, { type: 'pirates', x: spot[0], y: spot[1] });
}

// Ein Unternehmen planen: Schiffe sehen (Patrouille), Handelsschiff kapern, Küstenort überfallen
function plan(st, c, r) {
  const rt = st._rt;
  const coast = st.settlements.filter(s => s.alive && s.id !== c.letterFor && bldOf(st, s).some(b => (b.t === 'hafen' || b.t === 'fischer')));
  const d = s => Math.hypot(s.cx - c.x, s.cy - c.y);
  let targets = coast.filter(s => d(s) < 70);
  // Freibeuter mit Kaperbrief greifen nur die Feinde ihres Auftraggebers an
  if (c.letter > st.day) { const P = rt.sById.get(c.letterFor); targets = targets.filter(s => P && P.war === s.id); }
  const routes = (st.routes || []).filter(x => x.sea);
  const roll = r.next();
  const from = sea(st, c.x, c.y);
  // meist kreuzen sie nur und lauern (man sieht die schwarzen Segel), selten schlagen sie zu
  if (roll < 0.62) {
    const a = r.range(0, Math.PI * 2), rr = r.range(8, 22);
    c.op = { k: 'patrol', d: st.day, dur: 3 + r.int(0, 3) };
    st.voyages.push({ k: 'pirat', a: null, from, to: sea(st, Math.round(c.x + Math.cos(a) * rr), Math.round(c.y + Math.sin(a) * rr)), d: st.day, dur: c.op.dur });
    return;
  }
  if (targets.length && roll < 0.75 + c.fame * 0.005) {
    const s = targets.sort((a, b) => (guard(st, a) - guard(st, b)) + (d(a) - d(b)) * 0.01)[r.int(0, Math.min(2, targets.length - 1))];
    c.op = { k: 'town', s: s.id, d: st.day, dur: 4 };
    st.voyages.push({ k: 'pirat', a: null, from, b: s.id, d: st.day, dur: 3 });
  } else if (routes.length && roll < 0.95) {
    const R = r.pick(routes), A = rt.sById.get(R.a), B = rt.sById.get(R.b);
    if (!A || !B) return;
    const mx = Math.round((A.cx + B.cx) / 2), my = Math.round((A.cy + B.cy) / 2);
    c.op = { k: 'ship', a: A.id, b: B.id, d: st.day, dur: 3 };
    st.voyages.push({ k: 'pirat', a: null, from, to: sea(st, mx, my), d: st.day, dur: 3 });
  } else {
    const a = r.range(0, Math.PI * 2), rr = r.range(8, 18);
    c.op = { k: 'patrol', d: st.day, dur: 3 };
    st.voyages.push({ k: 'pirat', a: null, from, to: sea(st, Math.round(c.x + Math.cos(a) * rr), Math.round(c.y + Math.sin(a) * rr)), d: st.day, dur: 3 });
  }
}

function lose(st, c, n, r, why) {
  const crew = crewOf(st, c);
  for (let i = 0; i < n && crew.length; i++) {
    const p = crew.splice(r.int(0, crew.length - 1), 1)[0];
    c.crew = c.crew.filter(id => id !== p.id);
    if (p.id === c.cap) c.capDead = st.day;
    killPerson(st, p, why || CAUSE);
  }
}

// Ein Unternehmen ist vorbei: was ist passiert?
function resolve(st, c, r) {
  const rt = st._rt, op = c.op;
  c.op = null;
  const crewN = crewOf(st, c).length;
  if (op.k === 'town') {
    const s = rt.sById.get(op.s);
    if (!s || !s.alive) return;
    const strength = crewN * 0.05 + c.ships * 0.15 + c.fame * 0.01;
    const def = guard(st, s) + 0.15;
    if (r.chance(clamp(strength / (strength + def), 0.15, 0.85))) {
      const loot = Math.min(s.stock.gold * 0.25, 40 + crewN * 8) + 0;
      s.stock.gold -= loot; s.stock.goods = Math.max(0, s.stock.goods - 6); s.stock.food = Math.max(0, s.stock.food - 15);
      c.gold += loot; c.fame += 2;
      const victims = members(st, s).adults.filter(p => p.job === 'fischer' || p.job === 'haendler' || p.job === 'krieger');
      let dead = 0;
      for (let i = 0; i < Math.min(2, victims.length); i++) if (r.chance(0.4)) { killPerson(st, victims.splice(r.int(0, victims.length - 1), 1)[0], CAUSE); dead++; }
      // manchmal nehmen sie junge Leute mit, die bleiben
      const young = members(st, s).adults.filter(p => !p.pa && st.day - p.b < 25 * YEAR && !p.lt);
      if (young.length && r.chance(0.35)) { const p = r.pick(young); p.s = -1; p.away = true; p.pirate = c.id; c.crew.push(p.id); bio(p, st.day, L(`wird von Piraten verschleppt (${c.name})`, `is carried off by pirates (${c.name})`)); }
      const hb = bldOf(st, s).find(b => (b.t === 'hafen' || b.t === 'fischer'));
      if (hb && r.chance(0.4)) hb.hp = Math.max(0.3, hb.hp - 0.35);
      s.pirated = (s.pirated || 0) + 1;
      chron(st, 'piraten', r.pick(L([`${cap(c.name)} überfallen ${s.name} im Morgengrauen. Sie nehmen ${Math.round(loot)} Münzen, Vorräte${dead ? ` und ${dead} Leben` : ''} mit und sind verschwunden, bevor die Glocke schweigt.`, `Schwarze Segel vor ${s.name}! ${c.capN} plündert den Hafen und lacht über die Wachen.`],
        [`${cap(c.name)} raid ${s.name} at dawn. They take ${Math.round(loot)} coins, supplies${dead ? ` and ${dead} ${dead === 1 ? 'life' : 'lives'}` : ''} and are gone before the bell falls silent.`, `Black sails off ${s.name}! ${c.capN} plunders the harbor and laughs at the guards.`])), s.id, 1);
      fx(st, { type: 'raid', s: s.id });
    } else {
      const n = 1 + r.int(0, 2);
      lose(st, c, n, r);
      c.fame -= 1;
      chron(st, 'piraten', L(`${cap(c.name)} wollen ${s.name} überfallen, doch Wachen und Fischer schlagen sie zurück. ${n === 1 ? 'Ein Pirat bleibt' : n + ' Piraten bleiben'} im Sand.`, `${cap(c.name)} try to raid ${s.name}, but guards and fishers drive them off. ${n === 1 ? 'One pirate stays' : n + ' pirates stay'} in the sand.`), s.id, 1);
      s.hunt = (s.hunt || 0) + 1;
    }
  } else if (op.k === 'ship') {
    const A = rt.sById.get(op.a), B = rt.sById.get(op.b);
    if (!A || !B) return;
    if (r.chance(0.55)) {
      const loot = 20 + r.int(0, 30) + A.era * 6;
      A.stock.gold = Math.max(0, A.stock.gold - loot * 0.5); B.stock.goods = Math.max(0, B.stock.goods - 4);
      c.gold += loot; c.fame += 1;
      if (r.chance(0.25)) c.ships = Math.min(4, c.ships + 1);
      chron(st, 'piraten', r.pick(L([`${cap(c.name)} kapern ein Handelsschiff zwischen ${A.name} und ${B.name}. Die Mannschaft treibt zwei Tage im Beiboot.`, `${c.capN} entert eine Kogge aus ${A.name}. Die Ladung, Wein und Tuch, ist nun Piratengut.`],
        [`${cap(c.name)} seize a trade ship between ${A.name} and ${B.name}. The crew drifts for two days in the dinghy.`, `${c.capN} boards a ship from ${A.name}. The cargo, wine and cloth, is pirate goods now.`])), A.id, 0);
      A.hunt = (A.hunt || 0) + 0.5;
    }
  }
}

// Flotten jagen Piraten: wer genug gelitten hat und Schiffe bauen kann, fährt zum Nest
function hunt(st, r) {
  const rt = st._rt;
  for (const s of st.settlements) {
    if (!s.alive || (s.hunt || 0) < 2 || s.war) continue;
    if (!knows(st, 'schiffbau', s) && !(s.bon && s.bon.navy)) continue;
    const c = live(st).filter(q => !(q.letter > st.day && q.letterFor === s.id)).sort((a, b) => Math.hypot(a.x - s.cx, a.y - s.cy) - Math.hypot(b.x - s.cx, b.y - s.cy))[0];
    if (!c || Math.hypot(c.x - s.cx, c.y - s.cy) > 90) continue;
    s.hunt = 0;
    const w = members(st, s).adults.filter(p => p.job === 'krieger');
    const mine = w.length * 0.06 + ((s.bon && s.bon.navy) || 0) * 0.5 + 0.2;
    const theirs = crewOf(st, c).length * 0.05 + c.ships * 0.15;
    st.voyages.push({ k: 'krieg', a: s.id, to: sea(st, c.x, c.y), d: st.day, dur: 4 });
    if (r.chance(clamp(mine / (mine + theirs), 0.15, 0.85))) {
      end(st, c, r, L(`Die Flotte von ${s.name} stellt ${c.name} vor ihrem Nest. Die Schiffe brennen, ${c.capN} wird am Mast gehängt.`, `The fleet of ${s.name} corners ${c.name} at their cove. The ships burn, and ${c.capN} is hanged from the mast.`), s);
      for (const p of w.slice(0, 2)) { p.fame += 3; bio(p, st.day, L(`kämpft gegen die Piraten (${c.name})`, `fights the pirates (${c.name})`)); }
    } else {
      const dead = Math.min(w.length, 1 + r.int(0, 2));
      for (let i = 0; i < dead; i++) killPerson(st, w.splice(r.int(0, w.length - 1), 1)[0], CAUSE);
      c.fame += 2;
      chron(st, 'piraten', L(`Die Flotte von ${s.name} jagt ${c.name}, doch die Piraten kennen jedes Riff. ${dead} Krieger kehren nicht heim.`, `The fleet of ${s.name} hunts ${c.name}, but the pirates know every reef. ${dead} ${dead === 1 ? 'warrior does' : 'warriors do'} not come home.`), s.id, 1);
    }
  }
  void rt;
}

// Das Ende einer Bande: gefangen, versenkt oder in alle Winde zerstreut. Oft bleibt ein Schatz zurück.
function end(st, c, r, text, by) {
  c.end = st.day;
  for (const p of crewOf(st, c)) {
    if (r.chance(0.5)) killPerson(st, p, CAUSE);
    else if (by) { p.away = false; p.pirate = 0; p.s = by.id; bio(p, st.day, L(`wird gefangen und muss in ${by.name} Steine schleppen`, `is captured and must haul stones in ${by.name}`)); }
    else killPerson(st, p, CAUSE);
  }
  c.crew = [];
  const nest = (st.finds || []).find(o => o.id === c.nest);
  if (nest) nest.done = true;
  if (c.gold > 40 && r.chance(0.6)) {
    const a = r.range(0, Math.PI * 2), rr = r.range(2, 9);
    const x = clamp(Math.round(c.x + Math.cos(a) * rr), 2, NX - 3), y = clamp(Math.round(c.y + Math.sin(a) * rr), 2, NY - 3);
    if (st.tiles.h[idx(x, y)] >= 0) addSite(st, 'schatz', x, y, { gold: Math.round(c.gold * 0.8), of: c.capN });
  }
  chron(st, 'piraten', text, by ? by.id : -1, 2, { x: c.x, y: c.y });
}

// Freibeuter: im Krieg gibt ein Herrscher einer Bande einen Kaperbrief gegen den Feind
function letters(st, r) {
  for (const c of live(st)) {
    if (c.letter > st.day) continue;
    const pat = st.settlements.filter(s => s.alive && s.war && s.stock.gold > 80 && Math.hypot(s.cx - c.x, s.cy - c.y) < 70);
    if (!pat.length || !r.chance(0.25)) continue;
    const s = r.pick(pat), foe = st._rt.sById.get(s.war);
    if (!foe) continue;
    const pay = Math.min(60, s.stock.gold * 0.2);
    s.stock.gold -= pay; c.gold += pay; c.letter = st.day + 2 * YEAR; c.letterFor = s.id;
    chron(st, 'piraten', L(`${s.name} gibt ${c.name} einen Kaperbrief: Jedes Schiff aus ${foe.name} ist nun Freiwild.`, `${s.name} grants ${c.name} a letter of marque: every ship from ${foe.name} is now fair game.`), s.id, 1);
  }
}

// Alt und reich: die Bande gründet am Nest eine Piratenrepublik
function retire(st, c, r, found) {
  const crew = crewOf(st, c);
  if (crew.length < 6 || c.gold < 250 || st.day - c.d < 15 * YEAR || !found) return false;
  if (st.settlements.filter(s => s.alive).length >= st._rt.maxSet) return false;
  if (!r.chance(0.3)) return false;
  for (const p of crew) { p.away = false; p.pirate = 0; }
  const home = st._rt.sById.get(c.from);
  const s = found(st, c.x, c.y, crew, { gov: 'volksrat', cultShift: { freiheit: 0.3, handel: 0.15, tradition: -0.2 }, folk: st.earth && home ? home.isle : undefined, lang: st.earth && home ? home.lang : undefined });
  if (!s) return false;
  s.stock.gold += c.gold; c.gold = 0;
  c.end = st.day;
  chron(st, 'piraten', L(`${cap(c.name)} legen die Säbel ab. Am alten Nest gründen sie ${s.name}, eine Republik freier Seeleute. Fragen nach der Vergangenheit sind dort unhöflich.`, `${cap(c.name)} lay down their sabres. At the old cove they found ${s.name}, a republic of free sailors. Asking about the past is considered rude there.`), s.id, 2);
  return true;
}

// Alle 6 Tage
export function piratesStep(st, found) {
  const r = rng(st);
  st.pirates = st.pirates || [];
  const crews = live(st);
  // neue Banden: selten, öfter nach Kriegen, bei Armut, bei rauen Welten
  const seafaring = st.settlements.some(s => s.alive && knows(st, 'segeln', s));
  if (seafaring && crews.length < 3) {
    const poor = st.people.filter(p => (p.poor || 0) > 6).length / Math.max(1, st.people.length);
    const afterWar = st.settlements.some(s => s.lastWar && st.day - s.lastWar < 2 * YEAR);
    const p = (0.012 + poor * 0.08 + (afterWar ? 0.02 : 0)) * ((st.char && st.char.aggr) || 1);
    if (r.chance(p)) spawn(st, r);
  }
  for (const c of crews) {
    if (!crewOf(st, c).length) { end(st, c, r, L(`Von ${c.name} hört man nichts mehr. Das Meer hat sie geholt oder das Vergessen.`, `Nothing more is heard of ${c.name}. The sea took them, or oblivion.`)); continue; }
    if (c.op && st.day >= c.op.d + c.op.dur) resolve(st, c, r);
    if (!c.op && r.chance(0.5)) plan(st, c, r);
    // Nachwuchs: Ruhm lockt Abenteurer
    if (c.fame > 4 && r.chance(0.04)) {
      const s = st.settlements.filter(x => x.alive && x.pop > 20)[0];
      const p = s && members(st, s).adults.find(q => !q.pa && !q.lt && q.tr.mut > 0.6 && (q.poor || 0) > 2);
      if (p) { p.s = -1; p.away = true; p.pirate = c.id; c.crew.push(p.id); bio(p, st.day, L(`läuft zu den Piraten über (${c.name})`, `runs off to join the pirates (${c.name})`)); }
    }
    if (c.capDead && !c.end) {
      const crew = crewOf(st, c);
      if (crew.length) { const nc = crew.sort((a, b) => (b.tr.mut + b.fame) - (a.tr.mut + a.fame))[0]; c.cap = nc.id; c.capN = `${nc.n} ${r.pick(EPITHET)}`; c.capDead = 0; chron(st, 'piraten', L(`${cap(c.name)} wählen einen neuen Kapitän: ${c.capN}.`, `${cap(c.name)} choose a new captain: ${c.capN}.`), -1, 0); }
    }
    retire(st, c, r, found);
  }
  if (st.day % 24 === 3) { hunt(st, r); letters(st, r); }
  if (st.pirates.length > 20) st.pirates = st.pirates.filter(c => !c.end || st.day - c.end < 20 * YEAR);
  void isleOf;
}
