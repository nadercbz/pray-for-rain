// Fundorte: Die Inseln sind älter als ihre Siedler. Über die Karte verteilt liegen Ruinen einer versunkenen Stadt,
// Steinkreise, Wracks am Strand, Höhlen im Berg, heiße Quellen, uralte Riesenbäume, Knochen eines Drachen und vor
// der Küste eine versunkene Stadt (erst mit Navigation erreichbar). Dazu kommen im Spiel Piratennester, vergrabene
// Schätze und alte Schlachtfelder. Wer in die Nähe kommt (Ortsgebiet, Entdecker, später Seefahrer), findet sie:
// Wissen, Gold, Waren, Erz, Glaube, Mythen, Gesundheit, manchmal Angst. st.finds = [{ id, t, x, y, isle, name,
// found (Tag), by (Siedlung), done (geplündert), d (entstanden) }]. Zufall über rng(st).
import * as D from './data.js';
import { NX, NY, idx } from './world.js';
import { clamp } from './rng.js';
import { chron, rng, fx, members, isleOf, knows, bio, landOf, sameLand } from './util.js';
import { L } from '../i18n.js';

export const SITES = {
  ruine: { name: L('Ruinen der Alten', 'Ruins of the Ancients'), icon: '🏛', h: [1, 3] },
  steinkreis: { name: L('Steinkreis', 'Stone Circle'), icon: '🗿', h: [1, 2] },
  wrack: { name: L('Wrack', 'Shipwreck'), icon: '⚓', h: [0, 0] },
  hoehle: { name: L('Höhle', 'Cave'), icon: '🕳', h: [3, 5] },
  quelle: { name: L('Heiße Quelle', 'Hot Spring'), icon: '♨', h: [1, 3] },
  riesenbaum: { name: L('Uralter Baum', 'Ancient Tree'), icon: '🌳', h: [1, 2] },
  knochen: { name: L('Drachenknochen', 'Dragon Bones'), icon: '🦴', h: [1, 3] },
  versunken: { name: L('Versunkene Stadt', 'Sunken City'), icon: '🌊', h: [-1, -1] },
  schatz: { name: L('Vergrabener Schatz', 'Buried Treasure'), icon: '💰', h: [0, 1] },
  nest: { name: L('Piratennest', 'Pirate Cove'), icon: '🏴', h: [0, 1] },
  schlacht: { name: L('Altes Schlachtfeld', 'Old Battlefield'), icon: '⚔', h: [1, 3] },
  // neue Welt (18.10.2026)
  pyramide: { name: L('Pyramide', 'Pyramid'), icon: '🔺', h: [1, 2] },
  tempel: { name: L('Dschungeltempel', 'Jungle Temple'), icon: '🛕', h: [1, 3] },
  mammut: { name: L('Mammut im Eis', 'Mammoth in the Ice'), icon: '🦣', h: [1, 4] },
  geysir: { name: L('Geysir', 'Geyser'), icon: '💨', h: [1, 4] },
};

// Namen, die die Menschen den Orten geben, sobald sie sie finden
const NAMES = {
  ruine: L(['die Säulen von Atla', 'die Mauern der Alten', 'die Stadt unter dem Moos', 'das Tor ohne Haus'], ['the Pillars of Atla', 'the Walls of the Ancients', 'the City under the Moss', 'the Gate without a House']),
  steinkreis: L(['der Tanz der Steine', 'die Sieben Wächter', 'der Kreis des Mondes'], ['the Dance of Stones', 'the Seven Watchers', 'the Ring of the Moon']),
  wrack: L(['das Wrack der Morgenstern', 'der zerbrochene Kiel', 'das Schiff ohne Namen'], ['the Wreck of the Morning Star', 'the Broken Keel', 'the Nameless Ship']),
  hoehle: L(['die Flüsterhöhle', 'der Schlund', 'die Kristallgrotte'], ['the Whispering Cave', 'the Maw', 'the Crystal Grotto']),
  quelle: L(['die Warme Quelle', 'das Dampfende Auge', 'die Quelle der Heilung'], ['the Warm Spring', 'the Steaming Eye', 'the Spring of Healing']),
  riesenbaum: L(['der Älteste', 'die Mutter des Waldes', 'der Baum der Tausend Jahre'], ['the Eldest', 'the Mother of the Forest', 'the Tree of a Thousand Years']),
  knochen: L(['das Drachengrab', 'die Rippen des Riesen', 'der Steinerne Wurm'], ['the Dragon Grave', 'the Giant\'s Ribs', 'the Stone Worm']),
  versunken: L(['die Stadt unter den Wellen', 'Atla, die Versunkene'], ['the City beneath the Waves', 'Atla, the Sunken']),
  pyramide: L(['das Grab des Sonnenkönigs', 'die Treppe zum Himmel', 'der Berg aus Menschenhand'], ['the Tomb of the Sun King', 'the Stair to Heaven', 'the Mountain made by Hands']),
  tempel: L(['der Tempel der Schlange', 'die Stadt im Grün', 'das Haus der tausend Masken'], ['the Temple of the Serpent', 'the City in the Green', 'the House of a Thousand Masks']),
  mammut: L(['der schlafende Riese', 'das Tier im Eis', 'der Wollene'], ['the Sleeping Giant', 'the Beast in the Ice', 'the Woolly One']),
  geysir: L(['der Atem der Erde', 'die singende Fontäne', 'das kochende Auge'], ['the Breath of the Earth', 'the Singing Fountain', 'the Boiling Eye']),
};

// Fundorte der neuen Welt: je Lebensraum passend, über das Festland und die Südinseln verteilt
export function initNewWorldFinds(st) {
  if (st.nwFinds || !st.isles.some(I => I.nw)) return;
  st.nwFinds = 1;
  st.finds = st.finds || [];
  const r = rng(st), T = st.tiles, rt = st._rt;
  const nw = new Set(st.isles.filter(I => I.nw).map(I => I.id));
  const B = k => D.BIO[k];
  const plan = [
    ['pyramide', [B('wueste')]], ['pyramide', [B('wueste'), B('canyon')]], ['tempel', [B('tropen')]], ['tempel', [B('tropen'), B('sumpf')]],
    ['mammut', [B('tundra'), B('eis')]], ['mammut', [B('tundra'), B('fjord')]], ['geysir', [B('vulkan'), B('fjord'), B('taiga')]],
    ['ruine', null], ['ruine', [B('savanne'), B('steppe')]], ['steinkreis', [B('steppe'), B('mild'), B('wald')]], ['steinkreis', [B('tundra'), B('taiga')]],
    ['hoehle', null], ['hoehle', null], ['riesenbaum', [B('wald'), B('tropen')]], ['riesenbaum', [B('taiga'), B('wald')]],
    ['wrack', null], ['wrack', null], ['knochen', [B('canyon'), B('wueste'), B('steppe')]], ['quelle', [B('taiga'), B('fjord'), B('vulkan')]],
  ];
  for (const [t, bios] of plan) {
    const [lo, hi] = SITES[t].h;
    const p = freeTile(st, r, (T2, i, x, y) => {
      if (!nw.has(rt.isleOf[i]) || T2.h[i] < lo || T2.h[i] > hi || T2.river[i]) return false;
      if (bios && !bios.includes(T2.bio[i])) return false;
      if (t === 'wrack') { let w = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (T2.h[idx(x + dx, y + dy)] < 0) w++; return w > 0; }
      if (t === 'riesenbaum') return T2.tree[i] > 0;
      return true;
    }, 2500);
    if (!p) continue;
    st.finds.push({ id: sid(st), t, x: p[0], y: p[1], isle: rt.isleOf[idx(p[0], p[1])], found: 0, by: 0, done: false, d: st.day, name: '' });
  }
  markFinds(st);
  void T;
}

const sid = st => (st.findId = (st.findId || 0) + 1);

function freeTile(st, r, test, tries = 600) {
  const T = st.tiles, rt = st._rt;
  for (let k = 0; k < tries; k++) {
    const x = r.int(4, NX - 5), y = r.int(4, NY - 5), i = idx(x, y);
    if (rt.bldAt && rt.bldAt[i]) continue;
    if ((st.finds || []).some(o => Math.abs(o.x - x) + Math.abs(o.y - y) < 6)) continue;
    if (test(T, i, x, y)) return [x, y];
  }
  return null;
}

// Fundorte freihalten: dort wird nicht gebaut (core.js findSite) und keine Bäume verdecken sie
export function markFinds(st) {
  const rt = st._rt, T = st.tiles;
  rt.findAt = new Set();
  for (const o of st.finds || []) {
    if (o.t === 'versunken') continue;
    // nicht bebauen: die Kachel und ihre Nachbarn; Bäume weg in etwas größerem Kreis, damit Kronen nichts verdecken
    const rb = o.t === 'schlacht' ? 0 : 1, rt2 = o.t === 'riesenbaum' ? 1 : 2;
    for (let dy = -rt2; dy <= rt2; dy++) for (let dx = -rt2; dx <= rt2; dx++) {
      const x = o.x + dx, y = o.y + dy;
      if (x < 0 || y < 0 || x >= NX || y >= NY || dx * dx + dy * dy > rt2 * rt2 + 1) continue;
      const i = idx(x, y);
      if (Math.abs(dx) <= rb && Math.abs(dy) <= rb) rt.findAt.add(i);
      if (T.tree[i] && (dx || dy || o.t !== 'riesenbaum')) { T.tree[i] = 0; rt.dirtyT = true; }
    }
  }
}

// Neue Welt oder alter Spielstand: Fundorte verteilen (ein paar je Insel), weit weg von den ersten Siedlern
export function initSites(st) {
  if (st.finds) { markFinds(st); return; }
  st.finds = [];
  const r = rng(st), T = st.tiles, rt = st._rt;
  const nearTown = (x, y, d) => st.settlements.some(s => s.alive && Math.hypot(s.cx - x, s.cy - y) < d);
  const isleAt = i => (rt.isleOf ? rt.isleOf[i] : 0);
  const plan = ['ruine', 'ruine', 'steinkreis', 'steinkreis', 'wrack', 'wrack', 'wrack', 'hoehle', 'hoehle', 'quelle', 'riesenbaum', 'knochen', 'versunken'];
  for (const t of plan) {
    const [lo, hi] = SITES[t].h;
    const p = freeTile(st, r, (T, i, x, y) => {
      if (T.h[i] < lo || T.h[i] > hi) return false;
      if (t === 'versunken') { // im Flachwasser nahe einer Insel, nicht am Hafen
        let land = 0; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (T.h[idx(Math.min(NX - 1, Math.max(0, x + dx)), Math.min(NY - 1, Math.max(0, y + dy)))] >= 0) land++;
        return land > 4 && land < 20 && !nearTown(x, y, 14);
      }
      if (t === 'riesenbaum') return T.tree[i] > 0 && !nearTown(x, y, 10);
      if (t === 'wrack') { let w = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (T.h[idx(x + dx, y + dy)] < 0) w++; return w > 0 && !nearTown(x, y, 8); }
      return !nearTown(x, y, 9);
    });
    if (!p) continue;
    st.finds.push({ id: sid(st), t, x: p[0], y: p[1], isle: isleAt(idx(p[0], p[1])), found: 0, by: 0, done: false, d: st.day, name: '' });
  }
  markFinds(st);
}

// Ein Fundort entsteht im Spiel (Piratennest, Schatz, Schlachtfeld)
export function addSite(st, t, x, y, extra = {}) {
  st.finds = st.finds || [];
  const rt = st._rt;
  const o = { id: sid(st), t, x, y, isle: rt.isleOf ? rt.isleOf[idx(x, y)] : 0, found: extra.found ?? 0, by: 0, done: false, d: st.day, name: extra.name || '', ...extra };
  st.finds.push(o);
  markFinds(st);
  // zu viele: zuerst die ältesten Ruinen verlassener Orte (decay.js), dann geplünderte Fundorte
  if (st.finds.length > 70) { let k = st.finds.findIndex(q => q.t === 'ruine' && q.town); if (k < 0) k = st.finds.findIndex(q => q.done && q.t !== 'nest'); if (k >= 0) st.finds.splice(k, 1); }
  return o;
}

// Alle 6 Tage: wer kommt in die Nähe eines unentdeckten Fundorts?
export function sitesStep(st) {
  if (!st.finds || !st.finds.length) return;
  const r = rng(st), rt = st._rt;
  const alive = st.settlements.filter(s => s.alive && s.pop > 0);
  for (const o of st.finds) {
    if (o.found || o.t === 'nest' || o.t === 'schlacht') continue;
    let best = null, bd = Infinity;
    for (const s of alive) {
      const d = Math.hypot(s.cx - o.x, s.cy - o.y);
      const I = isleOf(st, s);
      // eigene Insel: Sammler, Jäger, Hirten streifen weit; fremde Inseln erst mit Segeln und Kontakt
      const reach = (o.isle && I && o.isle === (st.earth ? landOf(s) : I.id) ? s.R + 10 + s.era * 2 : (knows(st, 'segeln', s) ? 26 + s.era * 4 : 0));
      if (o.t === 'versunken' && !knows(st, 'navigation', s)) continue;
      if (d < reach && d < bd) { bd = d; best = s; }
    }
    if (!best || !r.chance(o.t === 'versunken' ? 0.04 : 0.09)) continue;
    discover(st, o, best, r);
  }
}

function finder(st, s, r) {
  const M = members(st, s);
  const pool = M.adults.filter(p => ['sammler', 'jaeger', 'fischer', 'gelehrter', 'haendler', 'krieger'].includes(p.job));
  return (pool.length ? pool : M.adults)[r.int(0, Math.max(0, (pool.length || M.adults.length) - 1))] || null;
}

export function discover(st, o, s, r = rng(st)) {
  const rt = st._rt, I = isleOf(st, s);
  o.found = st.day; o.by = s.id;
  if (!o.name && NAMES[o.t]) o.name = r.pick(NAMES[o.t]);
  const p = finder(st, s, r);
  const who = p ? p.n : L('Kundschafter', 'Scouts');
  if (p) { p.fame = (p.fame || 0) + 2; bio(p, st.day, L(`entdeckt ${o.name || SITES[o.t].name}`, `discovers ${o.name || SITES[o.t].name}`)); }
  const N0 = o.name || SITES[o.t].name;
  let text;
  switch (o.t) {
    case 'ruine': {
      if (I) I.research.pts += 120 + s.era * 160;
      s.artifacts = (s.artifacts || 0) + 1;
      for (const k of ['wissen', 'kunst']) s.cult[k] = clamp(s.cult[k] + 0.03, 0.03, 0.97);
      text = L(`${who} aus ${s.name} findet im Gestrüpp behauene Steine: ${N0}. Die Inschriften erzählen von einem Volk, das vor der großen Flut hier lebte. Die Gelehrten sind außer sich.`,
        `${who} of ${s.name} finds carved stones in the undergrowth: ${N0}. The inscriptions tell of a people who lived here before the great flood. The scholars are beside themselves.`);
      break;
    }
    case 'steinkreis':
      for (const q of members(st, s).all) q.faith = clamp(q.faith + 0.06, 0, 1);
      s.blessed = Math.max(s.blessed || 0, st.day + D.DAYS_PER_YEAR);
      text = L(`${who} stößt auf ${N0}, uralte Steine im Kreis. Bei Vollmond, sagen die Alten, singen sie. ${s.name} pilgert hinaus.`, `${who} comes upon ${N0}, ancient stones in a ring. At full moon, the elders say, they sing. ${s.name} makes pilgrimages out there.`);
      break;
    case 'wrack': {
      const g = 20 + r.int(0, 40) + s.era * 8;
      s.stock.goods += 8 + r.int(0, 12); s.stock.tools += 4; s.stock.gold += g; o.done = true;
      text = L(`Am Strand liegt ${N0}. ${who} birgt Kisten mit Werkzeug, Stoffen und ${Math.round(g)} Münzen fremder Prägung. Von der Mannschaft keine Spur.`, `${N0} lies on the beach. ${who} salvages crates of tools, cloth and ${Math.round(g)} coins of foreign make. Of the crew, no trace.`);
      break;
    }
    case 'hoehle': {
      s.stock.ore += 20 + r.int(0, 20);
      const beast = r.chance(0.35);
      if (beast) for (const q of members(st, s).all) q.hap = clamp(q.hap - 0.04, 0, 1);
      text = beast
        ? L(`${who} kehrt bleich aus ${N0} zurück. Tief drinnen atmet etwas. Seitdem geht niemand mehr allein in die Berge.`, `${who} returns pale from ${N0}. Deep inside, something is breathing. Since then no one goes into the mountains alone.`)
        : L(`${who} findet ${N0}. Erzadern glitzern an den Wänden, ${s.name} hat neues Metall.`, `${who} finds ${N0}. Veins of ore glitter on the walls; ${s.name} has new metal.`);
      break;
    }
    case 'quelle':
      s.siteBon = s.siteBon || {}; s.siteBon.health = (s.siteBon.health || 0) + 0.12; s.siteBon.hap = (s.siteBon.hap || 0) + 0.01;
      text = L(`${who} entdeckt ${N0}. Wer darin badet, hustet weniger, sagt man. Bald führt ein Pfad von ${s.name} dorthin.`, `${who} discovers ${N0}. Whoever bathes there coughs less, people say. Soon a path leads there from ${s.name}.`);
      break;
    case 'riesenbaum':
      s.cult.glaube = clamp(s.cult.glaube + 0.03, 0.03, 0.97); s.cult.kunst = clamp(s.cult.kunst + 0.03, 0.03, 0.97);
      s.siteBon = s.siteBon || {}; s.siteBon.faith = (s.siteBon.faith || 0) + 0.03;
      text = L(`Tief im Wald steht ${N0}. Zehn Menschen fassen ihn nicht. ${s.name} verbietet, ihn zu fällen, und hängt Bänder in seine Zweige.`, `Deep in the forest stands ${N0}. Ten people cannot reach around it. ${s.name} forbids felling it and hangs ribbons in its branches.`);
      break;
    case 'knochen': {
      const sci = knows(st, 'chemie', s) || knows(st, 'astronomie', s);
      if (sci && I) I.research.pts += 200 + s.era * 100;
      text = sci
        ? L(`${who} gräbt ${N0} aus. Die Gelehrten von ${s.name} vermessen die Knochen: ein Tier, älter als jede Sage.`, `${who} unearths ${N0}. The scholars of ${s.name} measure the bones: a creature older than any legend.`)
        : L(`${who} findet ${N0}: Knochen, so groß wie Boote. In ${s.name} erzählt man nun vom Drachen, der die Insel einst trug.`, `${who} finds ${N0}: bones as big as boats. ${s.name} now tells of the dragon that once carried the island.`);
      break;
    }
    case 'versunken':
      if (I) I.research.pts += 600 + s.era * 300;
      s.artifacts = (s.artifacts || 0) + 2;
      text = L(`Taucher aus ${s.name} finden ${N0} unter den Wellen: Straßen, Türme, ein Tor aus Gold. Die alten Lieder von Atlantis waren keine Lieder.`, `Divers from ${s.name} find ${N0} beneath the waves: streets, towers, a gate of gold. The old songs of Atlantis were not songs after all.`);
      break;
    case 'schatz': {
      const g = Math.round(o.gold || 150 + r.int(0, 200));
      s.stock.gold += g; o.done = true;
      if (p) { p.gold = (p.gold || 0) + g * 0.2; p.fame += 3; }
      text = L(`${who} aus ${s.name} gräbt unter einem schiefen Felsen eine Truhe aus: ${g} Münzen, der Schatz ${o.of ? 'von ' + o.of : 'der Piraten'}. Die ganze Stadt feiert.`, `${who} of ${s.name} digs up a chest beneath a crooked rock: ${g} coins, the treasure ${o.of ? 'of ' + o.of : 'of the pirates'}. The whole town celebrates.`);
      break;
    }
    case 'pyramide': {
      if (I) I.research.pts += 300 + s.era * 200;
      s.artifacts = (s.artifacts || 0) + 2;
      const g = 60 + r.int(0, 80) + s.era * 10; s.stock.gold += g;
      text = L(`${who} sieht am Horizont einen Berg, der zu gerade ist: ${N0}. Innen Gänge voller Bilder, Gold und ein leerer Thron. Wer hat sie gebaut, und wohin sind sie gegangen?`, `${who} sees a mountain on the horizon that is too straight: ${N0}. Inside, corridors full of paintings, gold and an empty throne. Who built it, and where did they go?`);
      break;
    }
    case 'tempel':
      if (I) I.research.pts += 250 + s.era * 150;
      for (const q of members(st, s).all) q.faith = clamp(q.faith + 0.05, 0, 1);
      s.cult.kunst = clamp(s.cult.kunst + 0.04, 0.03, 0.97);
      text = L(`Unter Lianen und Wurzeln findet ${who} ${N0}, Stufen aus grünem Stein, Gesichter mit geschlossenen Augen. Die Priester von ${s.name} sagen, der Wald hält dort seinen Atem an.`, `Beneath vines and roots ${who} finds ${N0}, steps of green stone, faces with closed eyes. The priests of ${s.name} say the forest holds its breath there.`);
      break;
    case 'mammut': {
      const sci = knows(st, 'chemie', s) || knows(st, 'astronomie', s);
      if (sci && I) I.research.pts += 220 + s.era * 100;
      s.stock.food += 40;
      text = L(`Im Eis liegt ${N0}: ein haariges Tier, größer als jedes Haus, als schliefe es nur. ${sci ? 'Die Gelehrten von ' + s.name + ' zeichnen es Haar für Haar.' : 'In ' + s.name + ' erzählt man, es wird eines Tages aufwachen.'}`, `${N0} lies in the ice: a hairy beast bigger than any house, as if it were only sleeping. ${sci ? 'The scholars of ' + s.name + ' draw it hair by hair.' : 'In ' + s.name + ' they say it will wake one day.'}`);
      break;
    }
    case 'geysir':
      s.siteBon = s.siteBon || {}; s.siteBon.health = (s.siteBon.health || 0) + 0.08; s.siteBon.faith = (s.siteBon.faith || 0) + 0.02;
      text = L(`${who} steht vor ${N0}: alle paar Atemzüge schießt kochendes Wasser in den Himmel. Die Menschen von ${s.name} halten es für die Stimme der Erde.`, `${who} stands before ${N0}: every few breaths boiling water shoots into the sky. The people of ${s.name} take it for the voice of the earth.`);
      break;
    default: return;
  }
  chron(st, 'fund', text, s.id, o.t === 'versunken' || o.t === 'ruine' || o.t === 'schatz' || o.t === 'pyramide' || o.t === 'tempel' ? 2 : 1, { x: o.x, y: o.y });
  fx(st, { type: 'site', t: o.t, x: o.x, y: o.y, s: s.id });
  void rt;
}

// Nach einer Schlacht bleibt ein Schlachtfeld zurück (zwischen den beiden Orten)
export function battlefield(st, a, b, dead) {
  if (dead < 3 || !sameLand(st, a, b)) return;
  const x = Math.round((a.cx + b.cx) / 2), y = Math.round((a.cy + b.cy) / 2);
  if (st.tiles.h[idx(x, y)] < 1) return;
  if ((st.finds || []).some(o => o.t === 'schlacht' && Math.abs(o.x - x) + Math.abs(o.y - y) < 5)) return;
  addSite(st, 'schlacht', x, y, { found: st.day, name: L(`das Feld von ${b.name}`, `the Field of ${b.name}`), dead });
}
