// Modell-Sammlung (seit 24.10.2026, Naders Wunsch: "eine Übersicht aller Gebäude, Charaktere, Gegenstände und Texturen,
// weil ich die Grafik Schritt für Schritt verbessern möchte"). Menüpunkt im Startbild (#btnModels). Kategorien:
// Gebäude je Art, Epoche und Variante, Häuser, Militär und Mauern, Charaktere (Dorfbewohner, Berufe, Herrscher, Hüte,
// Soldaten je Epoche, Geist), Tiere, Gegenstände (in der Hand und Requisiten), Fahrzeuge, Schiffe, Natur, Fundorte und
// alle Texturen (assets/collection.json aus tools/build_collection.py). Jedes Modell bekommt ein Vorschaubild, ein Klick
// öffnet die 3D Ansicht (drehen, zoomen, Epoche, Variante, Form, Animation, alle Epochen nebeneinander) mit Quelle und
// Dreiecken. Eigene Szene und zwei eigene Renderer (Vorschau, Ansicht); solange sie offen ist, rechnet das Spiel kein
// Bild (app.collectionOpen in main.js). Nur Ansicht, am Spielstand ändert sich nichts.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as D from '../sim/data.js';
import { WALLS } from '../sim/military.js';
import { L } from '../i18n.js';
import { loadVillagers, drawPerson, HEIGHT } from '../render/people.js';
import { Kind, SPECIES } from '../render/animals.js';
import { TYPES as VEH } from '../render/vehicles.js';
import { ARMY_MODELS, ANIMAL_DIM, KIT } from '../render/armies.js';
import { wallSample } from '../render/walls.js';
import { SITE_KINDS, siteModel } from '../render/sites.js';
import { fishingBoat, paintable } from '../render/ships.js';
import { Props } from '../render/props.js';
import { buildPlane } from '../render/planemodel.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ERA = i => D.ERAS[i].name;

// ---------- Namen ----------
const ANIMAL = {
  wolf: L('Wolf', 'Wolf'), fox: L('Fuchs', 'Fox'), dog: L('Hund', 'Dog'), cat: L('Katze', 'Cat'), chick: L('Küken', 'Chick'), bird: L('Vogel', 'Bird'),
  fish: L('Fisch', 'Fish'), whale: L('Wal', 'Whale'), deer: L('Reh', 'Deer'), stag: L('Hirsch', 'Stag'), reindeer: L('Rentier', 'Reindeer'),
  antelope: L('Antilope', 'Antelope'), horse: L('Pferd', 'Horse'), zebra: L('Zebra', 'Zebra'), giraffe: L('Giraffe', 'Giraffe'), camel: L('Kamel', 'Camel'),
  cow: L('Kuh', 'Cow'), hare: L('Feldhase', 'Hare'), snowhare: L('Schneehase', 'Snow hare'), lizard: L('Echse', 'Lizard'), scorpion: L('Skorpion', 'Scorpion'),
  frog: L('Frosch', 'Frog'), snake: L('Schlange', 'Snake'), butterfly: L('Schmetterling', 'Butterfly'), dragonfly: L('Libelle', 'Dragonfly'),
  heron: L('Reiher', 'Heron'), seal: L('Robbe', 'Seal'),
};
const ITEM = {
  korb: L('Korb', 'Basket'), eimer: L('Eimer', 'Bucket'), beutel: L('Beutel', 'Pouch'), netz: L('Netz', 'Net'), axt: L('Axt', 'Axe'),
  hammer: L('Hammer', 'Hammer'), speer: L('Speer', 'Spear'), stab: L('Stab', 'Staff'), laterne: L('Laterne', 'Lantern'), buch: L('Buch', 'Book'),
  angel: L('Angel', 'Fishing rod'), keule: L('Keule', 'Club'), schwert: L('Schwert', 'Sword'), bogen: L('Bogen', 'Bow'), muskete: L('Muskete', 'Musket'),
  gewehr: L('Gewehr', 'Rifle'),
};
const HAT = { stroh: L('Strohhut', 'Straw hat'), muetze: L('Mütze', 'Cap'), kapuze: L('Kapuze', 'Hood'), helm: L('Helm', 'Helmet'), kamm: L('Bronzehelm mit Kamm', 'Crested bronze helmet'), dreispitz: L('Dreispitz', 'Tricorne'), kepi: L('Käppi', 'Kepi'), krone: L('Krone', 'Crown') };
const HAT_COL = { stroh: '#ffffff', muetze: '#b8402e', kapuze: '#efe9dc', helm: '#a9afb5', kamm: '#c9953f', dreispitz: '#2a2a2e', kepi: '#3e4a5c', krone: '#ffffff' };
const VEHN = { oxcart: L('Ochsenkarren', 'Ox cart'), handcart: L('Handkarren', 'Handcart'), horsecart: L('Pferdewagen', 'Horse cart'), carriage: L('Kutsche', 'Carriage'), steamwagon: L('Dampfwagen', 'Steam wagon'), vintage: L('Oldtimer', 'Vintage car'), sedan: L('Limousine', 'Sedan'), hatch: L('Kleinwagen', 'Hatchback'), bus: L('Bus', 'Bus'), truck: L('Lastwagen', 'Truck') };
const ARMYN = { horse: L('Reitpferd', 'Riding horse'), knight: L('Ritterpferd', 'Knight’s horse'), ox: L('Zugochse', 'Draft ox'), chariot: L('Streitwagen', 'Chariot'), ram: L('Rammbock', 'Battering ram'), treb: L('Tribok', 'Trebuchet'), cannon: L('Kanone', 'Cannon'), field: L('Feldgeschütz', 'Field gun'), acar: L('Panzerwagen', 'Armored car'), rocket: L('Raketenwerfer', 'Rocket launcher'), tank: L('Panzer', 'Tank'), heli: L('Kampfhubschrauber', 'Attack helicopter'), tentR: L('Fellzelt', 'Hide tent'), tentL: L('Firstzelt', 'Ridge tent'), pit: L('Lagerfeuer', 'Campfire'), pole: L('Fahnenmast', 'Flagpole') };
const SHIPK = { handel: L('Handelsschiff', 'Merchant ship'), krieg: L('Kriegsschiff', 'Warship'), siedler: L('Siedlerschiff', 'Settler ship'), entdecker: L('Entdeckerschiff', 'Explorer ship'), pirat: L('Piratenschiff', 'Pirate ship') };
const SHIPV = [[0, L('Einbaum', 'Dugout')], [2, L('Kogge, Langschiff', 'Cog, longship')], [4, L('Karavelle', 'Caravel')], [5, L('Galeone', 'Galleon')], [6, L('Dampfer', 'Steamer')], [7, L('Moderne', 'Modern')]];
const SITEN = { ruine: L('Ruine der Alten', 'Ruin of the Ancients'), steinkreis: L('Steinkreis', 'Stone circle'), wrack: L('Wrack', 'Wreck'), hoehle: L('Höhle', 'Cave'), quelle: L('Heiße Quelle', 'Hot spring'), riesenbaum: L('Uralter Baum', 'Ancient tree'), knochen: L('Drachenknochen', 'Dragon bones'), versunken: L('Versunkene Stadt', 'Sunken city'), schatz: L('Vergrabener Schatz', 'Buried treasure'), nest: L('Piratennest', 'Pirate nest'), pyramide: L('Pyramide', 'Pyramid'), tempel: L('Dschungeltempel', 'Jungle temple'), mammut: L('Mammut im Eis', 'Mammoth in the ice'), geysir: L('Geysir', 'Geyser'), schlacht: L('Schlachtfeld', 'Battlefield') };
const TREEN = { round1: L('Wolkenbaum', 'Cloud tree'), round2: L('Wolkenbaum, rund', 'Cloud tree, round'), pine: L('Kiefer', 'Pine'), bush: L('Busch', 'Bush'), palm: L('Palme', 'Palm'), acacia: L('Akazie', 'Acacia'), cactus: L('Kaktus', 'Cactus'), jungle: L('Urwaldriese', 'Jungle giant'), dead: L('Toter Baum', 'Dead tree') };
const PROPN = { bank: L('Bank', 'Bench'), tisch: L('Biertisch', 'Beer table'), stoff: L('Strandtuch', 'Beach towel'), schirm: L('Sonnenschirm', 'Parasol'), ball: L('Ball', 'Ball'), feuer: L('Lagerfeuer am Platz', 'Square campfire') };
const TEXG = { karten: L('Karten der Kräfte', 'Power cards'), epochen: L('Epochenbilder', 'Era paintings'), gesichter: L('Gesichter der Figurenwahl', 'Character portraits'), figuren: L('Figurentexturen', 'Character textures'), marke: L('Logo und Symbole', 'Logo and icons'), hand: L('Mauszeiger', 'Cursor'), startbild: L('Startbild', 'Title screen'), film: L('Film', 'Film'), sonstiges: L('Sonstiges', 'Other') };
const CLIPN = { walk: L('Gehen', 'Walk'), idle: L('Stehen', 'Idle'), run: L('Rennen', 'Run'), hammer: L('Hämmern', 'Hammer'), pickup: L('Bücken', 'Pick up'), chat: L('Plaudern', 'Chat'), cheer: L('Jubeln', 'Cheer'), sit: L('Sitzen', 'Sit'), drink: L('Trinken', 'Drink'), talksit: L('Erzählen', 'Tell'), sleep: L('Schlafen', 'Sleep'), doze: L('Dösen', 'Doze'), floor: L('Schneidersitz', 'Cross-legged') };

// ---------- Katalog ----------
const CATS = [
  ['bld', L('Gebäude', 'Buildings')], ['haus', L('Häuser', 'Houses')], ['mil', L('Militär und Mauern', 'Military and Walls')],
  ['fig', L('Charaktere', 'Characters')], ['tier', L('Tiere', 'Animals')], ['ding', L('Gegenstände', 'Items')],
  ['fahr', L('Fahrzeuge', 'Vehicles')], ['schiff', L('Schiffe', 'Ships')], ['natur', L('Natur', 'Nature')],
  ['fund', L('Fundorte', 'Discoveries')], ['tex', L('Texturen', 'Textures')],
];
const minEra = t => { const b = D.BUILDINGS[t]; return b && b.tech && D.TECH[b.tech] ? D.TECH[b.tech].era : 0; };
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

function catalog(app, tex) {
  const out = [];
  const add = (cat, k, name, sub, o = {}) => out.push({ cat, key: cat + ':' + k, name, sub, ...o });
  // Gebäude (ohne Häuser, Felder, Dorfmitte: eigene Karten)
  for (const t of Object.keys(D.BUILDINGS)) {
    if (t === 'haus' || t === 'kaserne') continue;
    const e0 = t === 'zentrum' ? 0 : minEra(t), eras = t === 'feld' ? [0] : range(e0, 7);
    if (t === 'feld') { add('bld', t, D.BUILDINGS[t].name, L('4 Jahreszeiten, 3 Varianten', '4 seasons, 3 variants'), { kind: 'bld', t, eras, vars: 3, seasons: true, era: 0 }); continue; }
    add('bld', t, D.BUILDINGS[t].name, `${eras.length > 1 ? `${ERA(e0)} ${L('bis', 'to')} ${ERA(7)}` : ERA(e0)} · 3 ${L('Varianten', 'variants')}`, { kind: 'bld', t, eras, vars: 3, era: Math.min(7, Math.max(e0, 3)) });
  }
  // Häuser je Epoche: 5 Formen, 3 Varianten, 3 Detailstufen
  for (let L2 = 0; L2 <= 7; L2++) add('haus', 'h' + L2, `${D.BUILDINGS.haus.name} · ${ERA(L2)}`, L('5 Formen, 3 Varianten, 3 Detailstufen', '5 forms, 3 variants, 3 detail levels'), { kind: 'bld', t: 'haus', eras: range(0, 7), era: L2, vars: 3, forms: 5, dets: 3 });
  // Militär
  add('mil', 'kaserne', D.BUILDINGS.kaserne.name, L('Militärbasis je Epoche, 7 Stufen', 'Military base per era, 7 stages'), { kind: 'bld', t: 'kaserne', eras: range(1, 7), era: 4, vars: 1 });
  for (let l = 1; l <= 6; l++) add('mil', 'wall' + l, WALLS[l].n, L('Mauerstück mit Türmen und Tor', 'Wall section with towers and gate'), { kind: 'wall', lvl: l });
  for (const k of ['chariot', 'ram', 'treb', 'cannon', 'field', 'acar', 'rocket', 'tank', 'heli', 'horse', 'knight', 'ox', 'tentR', 'tentL', 'pit', 'pole']) add('mil', k, ARMYN[k], 'armies.js', { kind: 'army', m: k });
  for (let e = 0; e <= 7; e++) add('mil', 'sold' + e, `${L('Soldat', 'Soldier')} · ${ERA(e)}`, L('Uniform, Helm und Waffe der Epoche', 'Uniform, helmet and weapon of the era'), { kind: 'fig', fig: 'soldier', era: e, eras: range(0, 7), clips: true });
  // Charaktere
  add('fig', 'm', L('Dorfbewohner', 'Villager'), L('13 Animationen', '13 animations'), { kind: 'fig', fig: 'job', job: 'bauer', sex: 'm', clips: true, sexes: true });
  add('fig', 'f', L('Dorfbewohnerin', 'Villager (woman)'), L('13 Animationen', '13 animations'), { kind: 'fig', fig: 'job', job: 'bauer', sex: 'f', clips: true, sexes: true });
  add('fig', 'lt', L('Herrscher', 'Ruler'), L('mit Krone, Kittel in Gold', 'with crown, golden tunic'), { kind: 'fig', fig: 'ruler', sex: 'm', clips: true, sexes: true });
  add('fig', 'kid', L('Kind', 'Child'), '', { kind: 'fig', fig: 'kid', sex: 'f', clips: true, sexes: true });
  add('fig', 'old', L('Alte', 'Elder'), '', { kind: 'fig', fig: 'old', sex: 'm', clips: true, sexes: true });
  for (const j of Object.keys(D.JOBS)) if (j !== 'kind' && j !== 'alt') add('fig', 'job_' + j, D.JOBS[j].name || j, L('Beruf: Farbe, Hut, Werkzeug', 'Job: color, hat, tool'), { kind: 'fig', fig: 'job', job: j, sex: 'm', clips: true, sexes: true });
  for (const h of Object.keys(HAT)) add('fig', 'hat_' + h, HAT[h], L('Hut', 'Hat'), { kind: 'fig', fig: 'hat', hat: h, sex: 'm', sexes: true });
  if (app.ghost && app.ghost.mesh) add('fig', 'ghost', L('Der Geist', 'The Spirit'), L('Spielfigur im Geistmodus', 'Player character in spirit mode'), { kind: 'ghost' });
  // Tiere
  for (const id of Object.keys(SPECIES)) add('tier', id, ANIMAL[id] || id, `${L('Länge', 'length')} ${SPECIES[id].len}`, { kind: 'animal', id, clips: true });
  // Gegenstände
  for (const it of Object.keys(ITEM)) add('ding', it, ITEM[it], L('in der Hand', 'in hand'), { kind: 'fig', fig: 'item', item: it, sex: 'm' });
  for (const pk of Object.keys(PROPN)) add('ding', 'prop_' + pk, PROPN[pk], L('Requisite', 'Prop'), { kind: 'prop', p: pk });
  // Fahrzeuge
  for (const k of Object.keys(VEH)) add('fahr', k, VEHN[k] || k, 'vehicles.js', { kind: 'veh', v: k });
  add('fahr', 'plane', L('Flugzeug D-EPFR', 'Airplane D-EPFR'), L('Flugsimulation', 'Flight simulator'), { kind: 'plane' });
  // Schiffe
  // Piraten fahren nur die Bauarten von der Bronzezeit bis zur Renaissance (ships.js voyageUpdate)
  for (const k of Object.keys(SHIPK)) for (const [e, n] of SHIPV) if (k !== 'pirat' || (e >= 2 && e <= 5)) add('schiff', k + e, SHIPK[k], n, { kind: 'ship', k, era: e });
  for (let v = 0; v < 4; v++) add('schiff', 'fb' + v, L('Fischerboot', 'Fishing boat'), `${L('Farbe', 'color')} ${v + 1}`, { kind: 'fboat', v });
  // Natur
  const T = app.terrain && app.terrain.trees;
  if (T && T.kinds) for (const k of Object.keys(T.kinds)) add('natur', k, TREEN[k] || k, 'terrain.js Trees', { kind: 'tree', k });
  // Fundorte
  for (const k of SITE_KINDS) add('fund', k, SITEN[k] || k, 'sites.js', { kind: 'site', k });
  // Texturen
  for (const it of tex) add('tex', it.f, it.f.split('/').pop(), `${TEXG[it.g] || it.g} · ${it.w ? `${it.w} × ${it.h} · ` : ''}${it.kb} KB`, { kind: 'tex', it });
  return out;
}

// ---------- Oberfläche ----------
let cssDone = false;
function css() {
  if (cssDone) return; cssDone = true;
  const el = document.createElement('style');
  el.textContent = `
#coll{position:fixed;inset:0;z-index:300;display:flex;flex-direction:column;color:#f1ebdd;background:radial-gradient(ellipse at 30% 0%,rgba(31,64,70,.97),rgba(12,22,26,.98) 70%);font-family:inherit;cursor:auto}
#coll *{cursor:auto}
#coll button,#coll input{font:inherit;color:inherit}
#coll header{position:relative;display:flex;align-items:flex-end;gap:18px;padding:22px 28px 10px;flex-wrap:wrap}
#coll h1{margin:0;font-size:30px;font-weight:600;letter-spacing:.02em}
#coll header p{margin:0 0 4px;opacity:.7;font-size:14px}
#coll .find{margin-left:auto;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:8px 16px;min-width:220px;outline:none}
#coll .x{background:none;border:0;font-size:30px;line-height:1;opacity:.75;cursor:pointer;padding:0 0 4px 8px}
#coll .x:hover{opacity:1}
#coll nav{display:flex;gap:8px;padding:6px 28px 14px;flex-wrap:wrap}
#coll nav button{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:7px 14px;cursor:pointer;font-size:14px}
#coll nav button.on{background:#f1ebdd;color:#1d3237;border-color:#f1ebdd}
#coll nav small{opacity:.6;margin-left:5px}
#coll .main{flex:1;display:flex;min-height:0;gap:18px;padding:0 28px 22px}
#coll .grid{flex:1;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));grid-auto-rows:max-content;gap:12px;align-content:start;padding-right:6px}
#coll .card{position:relative;z-index:auto;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;width:100%;height:auto;min-height:0;box-sizing:border-box;white-space:normal;line-height:normal;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:8px;margin:0;text-align:left;cursor:pointer;transition:transform .15s,background .15s;box-shadow:none}
#coll .card:hover{transform:translateY(-2px);background:rgba(255,255,255,.1)}
#coll .card.on{border-color:#e9b44c;background:rgba(233,180,76,.12)}
#coll .card .im{flex:none;width:100%;aspect-ratio:1;border-radius:10px;background:radial-gradient(circle at 50% 40%,rgba(255,255,255,.14),rgba(255,255,255,.02));display:flex;align-items:center;justify-content:center;overflow:hidden}
#coll .card img{width:100%;height:100%;object-fit:contain}
#coll .card.tex img{object-fit:cover}
#coll .card b{display:block;font-size:13.5px;font-weight:600;margin-top:7px;line-height:1.25;white-space:normal}
#coll .card small{display:block;font-size:11.5px;opacity:.62;line-height:1.3;margin-top:2px;white-space:normal}
#coll .gh{grid-column:1/-1;margin:10px 2px 0;font-size:15px;font-weight:600;opacity:.85}
#coll .gh:first-child{margin-top:0}
#coll .wait{width:22px;height:22px;border-radius:50%;border:2px solid rgba(255,255,255,.2);border-top-color:#e9b44c;animation:collspin 1s linear infinite}
@keyframes collspin{to{transform:rotate(360deg)}}
#coll .view{width:min(46vw,640px);display:none;flex-direction:column;min-height:0}
#coll.sel .view{display:flex}
#coll .stage{position:relative;flex:1;min-height:260px;border-radius:18px;overflow:hidden;background:radial-gradient(ellipse at 50% 30%,#3d6c72,#16292d 75%)}
#coll .stage canvas{width:100%;height:100%;display:block;cursor:grab}
#coll .stage img.big{position:absolute;inset:0;margin:auto;max-width:96%;max-height:96%;object-fit:contain}
#coll .stage .eras{position:absolute;left:0;right:0;bottom:8px;display:flex;justify-content:space-around;font-size:11px;opacity:.75;pointer-events:none}
#coll .vh{display:flex;align-items:baseline;gap:10px;margin:12px 2px 6px}
#coll .vh h2{margin:0;font-size:20px;font-weight:600}
#coll .vh .back{display:none;background:none;border:0;font-size:15px;opacity:.8;cursor:pointer;padding:0}
#coll .ctl{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin:4px 0}
#coll .ctl label{font-size:12px;opacity:.6;min-width:72px}
#coll .ctl button{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:4px 9px;font-size:12.5px;cursor:pointer}
#coll .ctl button.on{background:#e9b44c;color:#1d3237;border-color:#e9b44c}
#coll .info{font-size:12px;opacity:.65;margin-top:6px;line-height:1.45}
#coll .info a{color:#e9b44c}
@media (max-width:760px){
  #coll header{padding:16px 52px 6px 16px}#coll h1{font-size:23px}#coll .x{position:absolute;top:12px;right:12px}#coll .find{min-width:0;width:100%;order:3}
  #coll nav{padding:4px 16px 10px;flex-wrap:nowrap;overflow-x:auto}#coll nav button{flex:none}
  #coll .main{padding:0 16px 16px}#coll .grid{grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px}
  #coll .view{position:fixed;inset:0;width:auto;background:#12232a;padding:14px 16px calc(16px + env(safe-area-inset-bottom));z-index:2}
  #coll .vh .back{display:inline}#coll .stage{min-height:52vh;flex:none;height:52vh}
}`;
  document.head.append(el);
}

// ---------- 3D ----------
// Eine Bühne mit eigener Szene und eigenem Renderer: eine für die Vorschaubilder, eine für die 3D Ansicht (so flackert die
// Ansicht nicht, während im Hintergrund noch Vorschaubilder entstehen)
class Studio {
  constructor(app, r) {
    this.app = app; this.r = r;
    this.scene = new THREE.Scene();
    this.uTime = { value: 0 };
    this.root = new THREE.Group(); this.scene.add(this.root);
    const hemi = new THREE.HemisphereLight('#f4f7ff', '#b39b78', 1.5); this.scene.add(hemi);
    const sun = this.sun = new THREE.DirectionalLight('#fff1dc', 2.4);
    sun.position.set(3, 5, 2.5); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight('#bcd6ff', 0.55); fill.position.set(-3, 2, -2); this.scene.add(fill);
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#a7c27f', roughness: 1 }));
    this.ground.receiveShadow = true; this.scene.add(this.ground);
    this.cam = new THREE.PerspectiveCamera(32, 1, 0.01, 200);
    this.kinds = new Map();
    this.figs = null; this.props = null; this.dyn = null;
    this.mats = {
      veh: paintable(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })),
      flat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, flatShading: true }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
      ship: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide }),
    };
  }
  async ready() {
    if (!this.figs) {
      try { this.figs = await loadVillagers(this.scene, this.uTime, 64); } catch { this.figs = []; }
      this.props = new Props(this.scene);
    }
  }
  async kind(id) {
    let k = this.kinds.get(id);
    if (!k) { k = new Kind(this.scene, id, this.uTime); this.kinds.set(id, k); await k.load(); }
    return k;
  }
  // alles leeren: Gruppe, Figuren, Tiere, Requisiten
  clear() {
    for (const o of [...this.root.children]) this.root.remove(o);
    this.dyn = null;
    if (this.figs) for (const F of this.figs) { F.begin(true); F.end(); }
    for (const k of this.kinds.values()) { k.begin(); k.end(); }
    if (this.props) for (const P of Object.values(this.props.k)) { P.m.count = 0; P.m.visible = false; }
  }
  tris(o) {
    let n = 0;
    o.traverse(m => { if (m.isMesh && m.geometry && m.visible) { const g = m.geometry; n += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
    return Math.round(n);
  }
  // Ein Modell aufbauen. st: Zustand der Ansicht (era, v, w, d, clip, sex, season, all). Rückgabe { r, cy, tris, src }
  async build(it, s) {
    await this.ready();
    this.clear();
    const app = this.app, root = this.root;
    const mesh = (g, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.castShadow = true; o.receiveShadow = true; o.position.set(x, y, z); root.add(o); return o; };
    if (it.kind === 'bld') {
      const B = app.buildings, eras = s.all && it.eras.length > 1 ? it.eras : [s.era];
      let tris = 0;
      eras.forEach((L2, i) => {
        const smp = B.sample(it.t, L2, s.v, { w: s.w, d: s.d, season: s.season, col: '#d9b968' });
        const x = (i - (eras.length - 1) / 2) * 1.35;
        const o = mesh(smp.g.geo, B.mats, x); o.scale.setScalar(smp.scale);
        if (smp.g.rotor) { const r = new THREE.Mesh(smp.g.rotor.geo, B.mats); r.position.set(...smp.g.rotor.pos); r.castShadow = true; o.add(r); this.dyn = t => { r.rotation.z = -t * 1.2; }; }
        tris += this.tris(o);
      });
      return { box: true, tris, src: `buildings.js · ${it.t === 'haus' ? `house(L, v, w), Form ${s.w + 1}` : it.t === 'zentrum' ? 'zentrum()' : it.t === 'feld' ? 'feld()' : `BUILDERS.${it.t}`}`, eras: eras.length > 1 ? eras : null };
    }
    if (it.kind === 'wall') { const { geo, glow } = wallSample(it.lvl); if (geo) mesh(geo, this.mats.flat); if (glow) mesh(glow, this.mats.glow); return { box: true, tris: this.tris(root), src: `walls.js · Stufe ${it.lvl}` }; }
    if (it.kind === 'army') {
      const g = ARMY_MODELS[it.m](), o = new THREE.InstancedMesh(g, this.mats.veh, 1);
      o.setMatrixAt(0, new THREE.Matrix4()); o.setColorAt(0, new THREE.Color(it.m === 'tentL' ? '#ece4d0' : '#c8413a')); o.castShadow = true; o.receiveShadow = true; root.add(o);
      // Tiere: im Spiel schwingen die Beine als eigene Teile, hier stehen sie still darunter
      const dim = ANIMAL_DIM[it.m];
      if (dim) {
        const lg = ARMY_MODELS.legs(), S = ANIMAL_DIM.scale;
        for (const [lx, lz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const leg = new THREE.InstancedMesh(lg, this.mats.veh, 1);
          leg.setMatrixAt(0, new THREE.Matrix4().makeTranslation(dim.L * 0.32 * lx * S, 0.075 * S, dim.H * 0.24 * lz * S).multiply(new THREE.Matrix4().makeScale(S, S, S)));
          leg.setColorAt(0, new THREE.Color(dim.dark)); leg.castShadow = true; root.add(leg);
        }
      }
      if (it.m === 'heli') { const r = new THREE.Mesh(ARMY_MODELS.rotor(), this.mats.veh); r.position.y = 0.11; o.add(r); this.dyn = t => { r.rotation.y = t * 14; }; o.position.y = 0.12; }
      return { box: true, tris: this.tris(root), src: `armies.js · ${it.m}()` };
    }
    if (it.kind === 'veh') {
      const g = VEH[it.v].mk(), o = new THREE.InstancedMesh(g, this.mats.veh, 1);
      o.setMatrixAt(0, new THREE.Matrix4()); o.setColorAt(0, new THREE.Color(['#d9604c', '#3f86b5', '#e9b44c', '#6fa55c'][s.v % 4])); o.castShadow = true; root.add(o);
      return { box: true, tris: this.tris(root), src: `vehicles.js · TYPES.${it.v}` };
    }
    if (it.kind === 'plane') { const P = buildPlane(this.r); P.root.scale.setScalar(0.1); root.add(P.root); if (P.blur) P.blur.visible = false; this.dyn = t => { if (P.prop) P.prop.rotation.z = t * 6; }; return { box: true, tris: this.tris(root), src: 'planemodel.js · buildPlane()' }; }
    if (it.kind === 'ship') {
      const g = app.ships.geom(it.k, it.era), o = mesh(g, app.ships.mat); o.scale.setScalar(it.k === 'krieg' ? 1.15 : 1);
      if (g.userData.wheel) { const w = new THREE.Mesh(g.userData.wheel, app.ships.mat); w.position.set(...g.userData.wheelPos); o.add(w); }
      const L2 = { m: o, ph: 0, wheel: o.children[0] || null };
      this.dyn = t => app.ships.anim(L2, t);
      return { box: true, tris: this.tris(root), src: `ships.js · ${it.k}, Epoche ${it.era}` };
    }
    if (it.kind === 'fboat') { mesh(fishingBoat(it.v), this.mats.ship); return { box: true, tris: this.tris(root), src: `ships.js · fishingBoat(${it.v})` }; }
    if (it.kind === 'tree') {
      const T = app.terrain.trees, grp = new THREE.Group();
      const col = { round1: '#9fc46a', round2: '#e8a0b8', pine: '#4f7f5a', bush: '#8ab45e', palm: '#7fae4a', acacia: '#a2b45a', cactus: '#6f9a54', jungle: '#4f8a3e', dead: '#8a7a64' }[it.k] || '#8ab45e';
      for (const [g, m] of T.kinds[it.k]) { const o = new THREE.InstancedMesh(g, m, 1); o.setMatrixAt(0, new THREE.Matrix4()); o.setColorAt(0, new THREE.Color(m === T.leafMat ? col : '#ffffff')); o.castShadow = true; grp.add(o); }
      root.add(grp);
      return { box: true, tris: this.tris(root), src: `terrain.js · Trees.kinds.${it.k}` };
    }
    if (it.kind === 'site') { const { geo, glow } = siteModel(it.k, true); if (geo) mesh(geo, this.mats.flat); if (glow) mesh(glow, this.mats.glow); return { box: true, tris: this.tris(root), src: `sites.js · MAKE.${it.k}` }; }
    if (it.kind === 'prop') {
      const P = this.props.k, o = new THREE.Object3D(), used = [], put = (k, x, y, z, s2 = 1, c) => { const m = P[k].m; used.push(m); o.position.set(x, y, z); o.rotation.set(0, 0, 0); o.scale.setScalar(s2); o.updateMatrix(); m.setMatrixAt(m.count, o.matrix); if (c && m.instanceColor) m.setColorAt(m.count, new THREE.Color(c)); m.count++; m.visible = true; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; };
      if (it.p === 'bank') put('bank', 0, 0, 0);
      else if (it.p === 'tisch') put('tisch', 0, 0, 0);
      else if (it.p === 'stoff') { o.scale.set(0.22, 1, 0.12); const m = P.stoff.m; o.position.set(0, 0, 0); o.updateMatrix(); m.setMatrixAt(0, o.matrix); m.setColorAt(0, new THREE.Color('#e8a0a0')); m.count = 1; m.visible = true; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
      else if (it.p === 'schirm') { put('stange', 0, 0, 0); put('schirm', 0, 0, 0, 1, '#9cc8e0'); }
      else if (it.p === 'ball') put('ball', 0, 0.022, 0, 1, '#f4f0e6');
      else { put('steine', 0, 0, 0); put('holz', 0, 0, 0); put('flamme', 0, 0, 0); }
      // Maße aus der Geometrie (Strandtuch ist ein Würfel, über die Instanz flach gezogen; Ball klein)
      if (it.p === 'stoff') return { r: 0.14, cy: 0.01, tris: 12, src: 'props.js · stoff' };
      if (it.p === 'ball') return { r: 0.05, cy: 0.022, tris: 80, src: 'props.js · ball' };
      // die Requisiten liegen nicht in root (Props legt sie direkt in die Szene): Maße aus ihren Geometrien
      const bb = new THREE.Box3();
      for (const m of used) { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); bb.union(m.geometry.boundingBox); }
      const bs = bb.getSize(new THREE.Vector3()), bc = bb.getCenter(new THREE.Vector3());
      return { r: Math.max(0.05, bs.length() * 0.55), cy: bc.y, tris: Math.round(used.reduce((a, m) => a + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0)), src: `props.js · ${it.p}` };
    }
    if (it.kind === 'ghost') { const G = app.ghost; const o = mesh(G.mesh.geometry, G.mesh.material); o.scale.copy(G.mesh.scale); return { r: 0.2, cy: 0.14, tris: this.tris(root), src: 'ghost.js · assets/people/ghost.*' }; }
    if (it.kind === 'animal') {
      const k = await this.kind(it.id), clips = Object.keys(k.clips), clip = clips.includes(s.clip) ? s.clip : clips.includes('idle') ? 'idle' : clips[0];
      const len = SPECIES[it.id].len, flying = it.id === 'bird' || it.id === 'butterfly' || it.id === 'dragonfly';
      const draw = () => { const o = new THREE.Object3D(); k.begin(); k.add(o, 0, flying ? len * 0.6 : 0, 0, Math.PI / 2, clip, 0, 1, new THREE.Color(it.id === 'bird' ? '#6b5848' : '#ffffff'), 1); k.end(); };
      draw(); this.dyn = draw;
      // Maße aus der Ruhelage des Modells (die Instanz skaliert mit der Länge der Art)
      const g = k.mesh.geometry; if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox.clone(); bb.min.multiplyScalar(len); bb.max.multiplyScalar(len);
      const bs = bb.getSize(new THREE.Vector3()), bc = bb.getCenter(new THREE.Vector3());
      return { r: Math.max(0.06, bs.length() * 0.5), cy: bc.y + (flying ? len * 0.6 : 0), tris: Math.round((k.mesh.geometry.index ? k.mesh.geometry.index.count : 0) / 3), src: `animals.js · assets/animals/${it.id}.bin`, clips, clip };
    }
    if (it.kind === 'fig') return this.figure(it, s);
    return { r: 0.3, cy: 0.15, tris: 0, src: '' };
  }
  // Figuren: Dorfbewohner mit Beruf, Herrscher, Kind, Alte, Hut, Soldat je Epoche, Gegenstand in der Hand
  figure(it, s) {
    const figs = this.figs || [];
    const sex = s.sex || it.sex || 'm', F = (it.vid && figs.find(f => f.vid === it.vid)) || figs.find(f => f.sex === sex) || figs[0];
    if (!F) return { r: 0.2, cy: 0.14, tris: 0, src: L('Figuren nicht geladen', 'figures not loaded') };
    const clips = Object.keys(F.clips), clip = clips.includes(s.clip) ? s.clip : it.fig === 'item' ? 'idle' : 'idle';
    const era = s.era ?? it.era ?? 0;
    const p = { id: 4242 + (sex === 'f' ? 1 : 0), sex, clan: 'Avar', job: it.job || 'bauer', lt: it.fig === 'ruler' ? 'König' : '', sick: false };
    let look, item, kid = it.fig === 'kid', old = it.fig === 'old';
    if (it.fig === 'soldier') {
      const K2 = KIT[era], nat = new THREE.Color('#c8413a');
      p.job = 'krieger';
      look = { shirt: new THREE.Color(K2.base).lerp(nat, K2.mix), pants: new THREE.Color(K2.pants), hat: K2.hat, hatCol: K2.hc ? new THREE.Color(K2.hc) : nat.clone().multiplyScalar(0.55) };
      item = ['keule', 'speer', 'speer', 'speer', 'schwert', 'muskete', 'gewehr', 'gewehr'][era];
    } else if (it.fig === 'hat') look = { hat: it.hat, hatCol: new THREE.Color(HAT_COL[it.hat]) };
    else if (it.fig === 'item') { item = it.item; look = { hat: null }; }
    const body = HEIGHT * (kid ? 0.66 : old ? 0.94 : 1) * (sex === 'f' ? 0.95 : 1);
    const draw = () => {
      for (const G of figs) G.begin(true);
      const o = new THREE.Object3D(); o.position.set(0, 0, 0); o.rotation.set(0, 0.5, 0); o.scale.setScalar(body); o.updateMatrix();
      drawPerson(F, p, o.matrix, clip, 1, kid, old, false, item, look);
      for (const G of figs) G.end();
    };
    draw(); this.dyn = draw;
    // Gegenstände: näher an die Hand (lange Dinge wie Speer und Gewehr brauchen mehr Platz)
    const longItem = it.fig === 'item' && ['speer', 'stab', 'angel', 'muskete', 'gewehr', 'bogen', 'axt'].includes(it.item);
    return { r: it.fig === 'item' ? (longItem ? 0.16 : 0.1) : 0.17, cy: it.fig === 'item' ? body * (longItem ? 0.5 : 0.42) : body * 0.55, tris: Math.round(((F.mesh.geometry.index ? F.mesh.geometry.index.count : F.mesh.geometry.attributes.position.count) / 3)), src: `people.js · assets/people/villager_${F.vid || sex}.bin${look && look.hat ? ` · Hut ${look.hat}` : ''}${item ? ` · ${item}` : ''}`, clips, clip };
  }
  // Kamera auf das Modell richten
  frame(info, cam, aspect = 1, fill = 1.05, back = false) {
    let c = new THREE.Vector3(0, info.cy ?? 0.2, 0), r = info.r ?? 0.3;
    if (info.box) {
      const b = new THREE.Box3().setFromObject(this.root);
      if (!b.isEmpty()) { b.getCenter(c); r = Math.max(0.05, b.getSize(new THREE.Vector3()).length() * 0.5); }
    }
    let dist = r / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * (aspect < 1 ? fill * 1.1 / aspect : fill);
    let dir = new THREE.Vector3(back ? -0.75 : 0.75, 0.55, back ? -1 : 1).normalize(); // back: Rückansicht (Prüfstand tools/sheet.js)
    // lange Reihe (alle Epochen nebeneinander): frontal, nach Breite und Höhe eingepasst
    if (info.box) {
      const sz = new THREE.Box3().setFromObject(this.root).getSize(new THREE.Vector3());
      if (sz.x > sz.z * 2.5 && sz.x > sz.y * 2) {
        const vf = THREE.MathUtils.degToRad(cam.fov / 2), hf = Math.atan(Math.tan(vf) * aspect);
        dir = new THREE.Vector3(0.12, 0.42, 1).normalize();
        // im quadratischen Vorschaubild nur die Mitte (Tor, Türme), sonst ist die Reihe ein dünner Strich
        const wdt = fill < 1 ? Math.min(sz.x, Math.max(sz.y, sz.z) * 3.2) : sz.x;
        dist = Math.max(wdt / 2 / Math.tan(hf), sz.y / 2 / Math.tan(vf)) * 1.08 + sz.z / 2;
      }
    }
    cam.position.copy(c).addScaledVector(dir, dist);
    cam.near = dist / 60; cam.far = dist * 20; cam.aspect = aspect; cam.updateProjectionMatrix();
    cam.lookAt(c);
    this.ground.scale.setScalar(Math.max(1.2, r * 3.2)); this.ground.position.y = Math.min(0, c.y - r) > -0.001 ? 0 : 0;
    const sh = this.sun.shadow.camera, e = r * 1.6;
    sh.left = -e; sh.right = e; sh.top = e; sh.bottom = -e; sh.near = 0.01; sh.far = r * 12; sh.updateProjectionMatrix();
    this.sun.position.copy(c).add(new THREE.Vector3(r * 2.2, r * 3.5, r * 1.6)); this.sun.target.position.copy(c);
    return { c, r, dist };
  }
}

function makeRenderer(canvas, thumb) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: !!thumb });
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05; r.outputColorSpace = THREE.SRGBColorSpace;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.setPixelRatio(thumb ? 1 : Math.min(2, window.devicePixelRatio || 1));
  if (thumb) r.setSize(256, 256, false);
  r.setClearColor(0x000000, 0);
  return r;
}

// ---------- Fenster ----------
let open = null;
export async function openCollection(app) {
  if (open) return;
  css();
  app.collectionOpen = true;
  let tex = [];
  try { tex = (await (await fetch('assets/collection.json', { cache: 'no-cache' })).json()).items || []; } catch { /* ohne Texturliste */ }
  const items = catalog(app, tex);
  const el = document.createElement('div');
  el.id = 'coll';
  el.innerHTML = `<header><div><h1>${L('Modell-Sammlung', 'Model Collection')}</h1><p>${L('Alles, was es im Spiel gibt, nach Kategorien. Klick öffnet die 3D Ansicht.', 'Everything in the game, by category. Click to open the 3D view.')}</p></div>
    <input class="find" type="search" placeholder="${L('Suchen', 'Search')}"><button class="x" title="${L('Schließen', 'Close')}">×</button></header>
    <nav></nav><div class="main"><div class="grid"></div><div class="view"><div class="vh"><button class="back">${L('← Zurück', '← Back')}</button><h2></h2></div>
    <div class="stage"><canvas></canvas><img class="big" style="display:none" alt=""><div class="eras"></div></div><div class="ctls"></div><div class="info"></div></div></div>`;
  document.body.append(el);
  const $ = q => el.querySelector(q);
  const studio = new Studio(app, makeRenderer(undefined, true)); // Vorschaubilder
  const state = { cat: 'bld', q: '', sel: null };
  const thumbs = new Map();
  let queue = [], busy = false, alive = true;
  open = { el, studio };

  // Kategorien mit Zahl
  const nav = $('nav');
  for (const [k, n] of CATS) {
    const cnt = items.filter(i => i.cat === k).length;
    if (!cnt) continue;
    const b = document.createElement('button');
    b.dataset.cat = k; b.innerHTML = `${n}<small>${cnt}</small>`;
    b.onclick = () => { state.cat = k; state.q = ''; $('.find').value = ''; render(); };
    nav.append(b);
  }
  // Raster
  const grid = $('.grid');
  function render() {
    nav.querySelectorAll('button').forEach(b => b.classList.toggle('on', !state.q && b.dataset.cat === state.cat));
    const q = state.q.toLowerCase();
    const list = items.filter(i => (q ? (i.name + ' ' + i.sub + ' ' + i.key).toLowerCase().includes(q) : i.cat === state.cat));
    // Texturen nach Gruppen mit Überschrift (Karten, Epochenbilder, Gesichter ...)
    let lastG = null;
    const head = i => { if (i.kind !== 'tex' || q || i.it.g === lastG) return ''; lastG = i.it.g; return `<h3 class="gh">${esc(TEXG[i.it.g] || i.it.g)}</h3>`; };
    grid.innerHTML = list.map(i => `${head(i)}<button class="card${i.kind === 'tex' ? ' tex' : ''}${state.sel === i ? ' on' : ''}" data-k="${esc(i.key)}"><div class="im">${i.kind === 'tex' ? (i.it.video ? `<video src="${esc(i.it.f)}" muted loop playsinline preload="metadata"></video>` : `<img loading="lazy" src="${esc(i.it.f)}" alt="">`) : thumbs.has(i.key) ? `<img src="${thumbs.get(i.key)}" alt="">` : '<div class="wait"></div>'}</div><b>${esc(i.name)}</b><small>${esc(i.sub)}</small></button>`).join('') || `<p style="opacity:.6">${L('Nichts gefunden.', 'Nothing found.')}</p>`;
    grid.querySelectorAll('.card').forEach(c => { c.onclick = () => select(items.find(i => i.key === c.dataset.k)); });
    queue = list.filter(i => i.kind !== 'tex' && !thumbs.has(i.key));
    pump();
  }
  $('.find').oninput = e => { state.q = e.target.value.trim(); render(); };
  // Vorschaubilder nach und nach (je eines, dann kurz Luft für die Oberfläche)
  async function pump() {
    if (busy || !alive) return;
    busy = true;
    while (queue.length && alive) {
      const it = queue.shift();
      if (thumbs.has(it.key)) continue;
      try {
        const s = initState(it);
        const info = await studio.build(it, s);
        studio.ground.visible = false;
        studio.frame(info, studio.cam, 1, 0.82);
        studio.r.render(studio.scene, studio.cam);
        thumbs.set(it.key, studio.r.domElement.toDataURL('image/webp', 0.86));
        studio.ground.visible = true;
        const card = grid.querySelector(`.card[data-k="${CSS_ESC(it.key)}"] .im`);
        if (card) card.innerHTML = `<img src="${thumbs.get(it.key)}" alt="">`;
      } catch (e) {
        console.warn('Modell-Sammlung', it.key, e); thumbs.set(it.key, '');
        const card = grid.querySelector(`.card[data-k="${CSS_ESC(it.key)}"] .im`);
        if (card) card.innerHTML = `<small style="opacity:.6">${L('nicht verfügbar', 'not available')}</small>`;
      }
      await new Promise(r => setTimeout(r, 0));
    }
    busy = false;
  }
  const CSS_ESC = s => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"'));
  function initState(it) {
    return { era: it.era ?? (it.eras ? it.eras[it.eras.length - 1] : 0), v: 0, w: 0, d: 0, clip: it.kind === 'animal' ? 'walk' : it.clips ? 'idle' : null, sex: it.sex, season: 1, all: false };
  }

  // Ansicht
  let view = null, vstate = null;
  const canvas = $('.stage canvas'), big = $('.stage img.big');
  function ensureView() {
    if (view) return view;
    const r = makeRenderer(canvas, false);
    const cam = new THREE.PerspectiveCamera(32, 1, 0.01, 200);
    const vs = new Studio(app, r);
    const ctl = new OrbitControls(cam, canvas);
    ctl.enableDamping = true; ctl.autoRotate = true; ctl.autoRotateSpeed = 1.1; ctl.maxPolarAngle = Math.PI * 0.495;
    ctl.addEventListener('start', () => { ctl.autoRotate = false; });
    view = { r, cam, ctl, vs, t0: performance.now() };
    const loop = () => {
      if (!alive) return;
      requestAnimationFrame(loop);
      if (!el.classList.contains('sel') || canvas.style.display === 'none') return;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (w && h && (canvas.width !== Math.round(w * r.getPixelRatio()) || canvas.height !== Math.round(h * r.getPixelRatio()))) { r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
      const t = (performance.now() - view.t0) / 1000;
      vs.uTime.value = t;
      if (vs.dyn) vs.dyn(t);
      ctl.update();
      r.render(vs.scene, cam);
    };
    loop();
    return view;
  }
  async function select(it) {
    if (!it) return;
    state.sel = it;
    el.classList.add('sel');
    grid.querySelectorAll('.card').forEach(c => c.classList.toggle('on', c.dataset.k === it.key));
    vstate = initState(it);
    $('.vh h2').textContent = it.name;
    await showSel(true);
  }
  async function showSel(reframe) {
    const it = state.sel;
    if (!it) return;
    const ctls = $('.ctls'), info = $('.info'), eras = $('.eras');
    eras.innerHTML = '';
    if (it.kind === 'tex') {
      canvas.style.display = 'none'; big.style.display = '';
      big.src = it.it.hd || it.it.f;
      ctls.innerHTML = '';
      info.innerHTML = `${esc(it.it.f)}${it.it.w ? ` · ${it.it.w} × ${it.it.h} Pixel` : ''} · ${it.it.kb} KB · ${esc(TEXG[it.it.g] || it.it.g)}${it.it.hd ? ` · ${L('große Fassung', 'large version')} ${esc(it.it.hd)}` : ''} · <a href="${esc(it.it.hd || it.it.f)}" target="_blank" rel="noopener">${L('Datei öffnen', 'Open file')}</a>`;
      return;
    }
    canvas.style.display = ''; big.style.display = 'none';
    const V = ensureView(), VS = V.vs;
    const s = vstate;
    const res = await VS.build(it, s);
    if (reframe !== false) { const f = VS.frame(res, V.cam, (canvas.clientWidth || 1) / (canvas.clientHeight || 1)); V.ctl.target.copy(f.c); V.ctl.minDistance = f.r * 0.5; V.ctl.maxDistance = f.dist * 4; V.ctl.autoRotate = true; V.ctl.update(); }
    // Bedienung je Art
    const row = (label, opts, cur, set) => `<div class="ctl"><label>${label}</label>${opts.map(([v, n]) => `<button data-set="${set}" data-v="${v}" class="${String(v) === String(cur) ? 'on' : ''}">${esc(n)}</button>`).join('')}</div>`;
    let h = '';
    if (it.eras && it.eras.length > 1) h += row(L('Epoche', 'Era'), it.eras.map(e => [e, ERA(e)]), s.all ? -1 : s.era, 'era') + `<div class="ctl"><label></label><button data-set="all" data-v="${s.all ? 0 : 1}" class="${s.all ? 'on' : ''}">${L('Alle Epochen nebeneinander', 'All eras side by side')}</button></div>`;
    if (it.vars > 1) h += row(L('Variante', 'Variant'), range(0, it.vars - 1).map(v => [v, String(v + 1)]), s.v, 'v');
    if (it.forms) h += row(L('Form', 'Form'), range(0, it.forms - 1).map(v => [v, String(v + 1)]), s.w, 'w');
    if (it.dets) h += row(L('Details', 'Details'), range(0, it.dets - 1).map(v => [v, String(v + 1)]), s.d, 'd');
    if (it.seasons) h += row(L('Jahreszeit', 'Season'), [[0, L('Frühling', 'Spring')], [1, L('Sommer', 'Summer')], [2, L('Herbst', 'Autumn')], [3, L('Winter', 'Winter')]], s.season, 'season');
    if (it.kind === 'veh') h += row(L('Lack', 'Paint'), range(0, 3).map(v => [v, String(v + 1)]), s.v, 'v');
    if (it.sexes) h += row(L('Figur', 'Figure'), [['m', L('Mann', 'Man')], ['f', L('Frau', 'Woman')]], s.sex || it.sex, 'sex');
    if (res.clips && res.clips.length > 1) h += row(L('Animation', 'Animation'), res.clips.map(c => [c, CLIPN[c] || c]), res.clip, 'clip');
    ctls.innerHTML = h;
    ctls.querySelectorAll('[data-set]').forEach(b => {
      b.onclick = async () => {
        const k = b.dataset.set, v = b.dataset.v;
        if (k === 'all') s.all = v === '1';
        else if (k === 'era') { s.era = +v; s.all = false; }
        else if (k === 'sex' || k === 'clip') s[k] = v;
        else s[k] = +v;
        await showSel(k === 'all' || k === 'era' || (k === 'w' && it.t === 'haus'));
      };
    });
    if (res.eras) eras.innerHTML = res.eras.map(e => `<span>${esc(ERA(e))}</span>`).join('');
    info.innerHTML = `${esc(res.src)}${res.tris ? ` · ${res.tris.toLocaleString()} ${L('Dreiecke', 'triangles')}` : ''} · ${L('ziehen dreht, Rad zoomt', 'drag to rotate, wheel to zoom')}`;
  }
  $('.vh .back').onclick = () => { el.classList.remove('sel'); state.sel = null; grid.querySelectorAll('.card.on').forEach(c => c.classList.remove('on')); };
  const close = () => {
    alive = false; open = null; app.collectionOpen = false;
    studio.clear();
    try { studio.r.dispose(); studio.r.forceContextLoss(); } catch { /* egal */ }
    if (view) { try { view.vs.clear(); view.ctl.dispose(); view.r.dispose(); view.r.forceContextLoss(); } catch { /* egal */ } }
    el.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); if (el.classList.contains('sel') && innerWidth <= 760) $('.vh .back').click(); else close(); } };
  document.addEventListener('keydown', onKey, true);
  $('.x').onclick = close;
  render();
}

// für Prüfstände (tools/sheet.js): Übersichtsbilder je Epoche mit derselben Bühne
export { Studio, makeRenderer, catalog };
