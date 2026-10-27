// Pray For Rain. Start, Zeit, Speichern, Eingaben und das Zusammenspiel aller Teile.
import * as THREE from 'three';
import * as D from './sim/data.js';
import { createWorld, stepDay, serialize, deserialize } from './sim/core.js';
import { cast } from './sim/powers.js';
import { seasonOf, ageOf } from './sim/util.js';
import { createStage, NX, NY, wx, wz } from './render/scene.js';
import { Terrain, groundY } from './render/terrain.js';
import { U } from './render/mats.js';
import { Water } from './render/water.js';
import { Buildings } from './render/buildings.js';
import { People } from './render/people.js';
import { Animals } from './render/animals.js';
import { Ghost } from './render/ghost.js';
import { diaryNote } from './sim/diary.js';
import { Interior } from './render/interior.js';
import { Timelapse } from './ui/timelapse.js';
import { FX } from './render/fx.js';
import { Ships } from './render/ships.js';
import { Vehicles } from './render/vehicles.js';
import { openHeroStory } from './ui/hero_ui.js';
import { Sites, siteInfo } from './render/sites.js';
import { UI } from './ui/ui.js';
import { Sound } from './ui/audio.js';
import { initHand } from './ui/hand.js';
import { playTrailer } from './ui/trailer.js';
import { initVoice } from './ui/voice.js';
import { storyEvent, storyTick } from './ui/story_voice.js';
import { newGameFlow, newEarthFlow } from './ui/onboarding.js';
import { loadEarth, startCheck, EARTH } from './sim/earth.js';
import { createEarthWorld } from './sim/folks.js';
import { startTour } from './ui/tour.js';
import { L } from './i18n.js';
import { WorldMap } from './ui/map.js';
import { Streets } from './render/streets.js';
import { Bridges } from './render/bridges.js';
import { Treks } from './render/treks.js';
import { Walls } from './render/walls.js';
import { Armies } from './render/armies.js';
import { hooks as leisureHooks } from './render/leisure.js';
import { Flight } from './render/flight.js';
import { Drive } from './render/drive.js';
import { initTouch, TOUCH } from './ui/touch.js';
import { Editor, editorButton, DRAFT } from './ui/editor.js';
import { newLevel } from './sim/edit.js';
import { Coop } from './net/coop.js';
import { initCoopUI } from './ui/coop_ui.js';

// Zwei Welten (seit 19.10.2026): die Inselwelt (Naders Welt, data/welt.json) und die echte Erde (data/erde.json).
// Welche gilt, entscheidet index.html vor dem Start (localStorage 'pfr.world', setzt PFR_SIZE), ein Wechsel lädt neu.
// Die Erde berührt nie den Spielstand der Inselwelt: eigener Schlüssel im Browser, eigener Platz auf dem Mac.
const EARTH_MODE = Array.isArray(globalThis.PFR_SIZE);
// Dritte Welt (seit 20.10.2026): eigene Level aus dem Baukasten, nur im Browser gespeichert (Bibliothek in editor.js)
const LEVEL_MODE = !EARTH_MODE && !!globalThis.PFR_LEVEL;
const KEY = EARTH_MODE ? 'builtitup.earth.v1' : LEVEL_MODE ? 'builtitup.level.v1' : 'builtitup.world.v1';
const API = EARTH_MODE ? 'api/erde' : 'api/welt';
const LOCK = 'builtitup.lock';
// Mit Freund spielen (seit 26.10.2026, net/coop.js): ?join=code öffnet die Welt eines Gastgebers. Der Gast speichert nie,
// nimmt keine Sperre und holt keine Zeit nach; seine eigene Welt im Browser bleibt unberührt.
const JOIN = new URLSearchParams(location.search).get('join');
const TAB = (() => { try { let t = sessionStorage.getItem('biu.tab'); if (!t) { t = Math.random().toString(36).slice(2); sessionStorage.setItem('biu.tab', t); } return t; } catch { return Math.random().toString(36).slice(2); } })();
const DAY = D.DAY_SECONDS;
const $ = s => document.querySelector(s);

const app = {
  st: null, speed: 1, power: null, dreamTheme: null, followId: null, selId: null,
  view: { territory: false }, colorsDirty: true, serverSync: false, sound: new Sound(), running: false, acc: 0,
};
window.BIU = app; // für Tests in der Konsole
app.coopGuest = !!JOIN;

// ---------- Speichern und Laden ----------
function localLoad() {
  try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}

// online auf GitHub Pages gibt es keinen Server: dort speichert jedes Gerät nur im Browser (deploy_github.py)
const LOCAL_ONLY = LEVEL_MODE || new URLSearchParams(location.search).has('local') || new URLSearchParams(location.search).has('cine') || /\.github\.io$/.test(location.hostname); // Tests: ohne Server-Speicher, Level nur im Browser
// Filmmodus für den Trailer: keine Oberfläche, die Zeit läuft nur Bild für Bild über app.cineFrame(dt)
const CINE = new URLSearchParams(location.search).has('cine');
if (CINE) document.body.classList.add('cine');
async function serverLoad() {
  if (LOCAL_ONLY) { app.serverSync = false; return null; }
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(API, { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(t);
    app.serverSync = r.ok || r.status === 204;
    if (r.status !== 200) return null;
    return await r.json();
  } catch { app.serverSync = false; return null; }
}

let lastServerSave = 0, saveWarned = false;
function save(force, release) {
  const st = app.st;
  if (!st || app.coopGuest || !ownLock()) return;
  st.savedAt = Date.now();
  st.acc = app.acc;
  const json = serialize(st);
  try { localStorage.setItem(KEY, json); } catch {
    if (!saveWarned) { saveWarned = true; ui && ui.toast(L('Der Browser-Speicher ist voll. Sichere die Insel im Menü als Datei.', 'Browser storage is full. Save the island to a file from the menu.'), 'warn'); }
  }
  if (app.serverSync && !app.blocked && (force || Date.now() - lastServerSave > 45000)) {
    lastServerSave = Date.now();
    const headers = { 'Content-Type': 'application/json', 'X-Tab': TAB };
    if (app.forceSave) { headers['X-Force'] = '1'; app.forceSave = false; }
    if (release) headers['X-Release'] = '1';
    fetch(API, { method: 'PUT', headers, body: json, keepalive: json.length < 60000 })
      .then(async r => { if (r.status === 409) { let why = 'lease'; try { why = (await r.json()).reason; } catch { /* egal */ } blockedBy(why); } })
      .catch(() => {});
  }
}

// Ein anderes Gerät oder Fenster hält die Insel
function blockedBy(why) {
  app.blocked = true;
  app.running = false;
  const box = $('#locked');
  box.querySelector('h2').textContent = why === 'stale' ? L('Die Insel ist woanders weitergelaufen', 'The island has moved on elsewhere') : L('Die Insel lebt gerade auf einem anderen Gerät', 'The island is living on another device right now');
  box.querySelector('p').textContent = why === 'stale' ? L('Ein anderes Gerät hat eine neuere Fassung gespeichert. Lade neu, um dort weiterzumachen.', 'Another device has saved a newer version. Reload to continue from there.') : L('Damit die Zeit nicht doppelt läuft, regiert immer nur ein Fenster. Du kannst die Insel hierher holen.', 'So that time does not run twice, only one window rules at a time. You can bring the island here.');
  box.className = 'show';
}

function ownLock() {
  try { const l = JSON.parse(localStorage.getItem(LOCK) || 'null'); return !l || l.id === TAB || Date.now() - l.t > 7000; } catch { return true; }
}
function heartbeat() {
  if (app.coopGuest) return;
  if (ownLock()) {
    try { localStorage.setItem(LOCK, JSON.stringify({ id: TAB, t: Date.now() })); } catch { /* egal */ }
    $('#locked').className = '';
  } else if (app.running && !app.blocked) {
    $('#locked').className = 'show';
  }
}

// ---------- Nachholen der Zeit ----------
const nextFrame = () => new Promise(r => requestAnimationFrame(r));
async function catchUp(st, seconds, onProgress) {
  terrain.trees.quiet = true; // nach dem Nachholen keine Baum Animationen für Jahre auf einmal
  const total = st.acc + Math.max(0, seconds);
  let days = Math.floor(total / DAY);
  const capped = days > D.CATCHUP_MAX_DAYS;
  if (capped) days = D.CATCHUP_MAX_DAYS;
  app.acc = capped ? 0 : total - Math.floor(total / DAY) * DAY;
  const info = { seconds, days, capped, popBefore: st.people.length, births: st.counts.births, deaths: st.counts.deaths, entries: [] };
  st._rt.catchup = true;
  st._rt.newChron.length = 0;
  let t0 = performance.now();
  for (let d = 0; d < days; d++) {
    stepDay(st);
    if (performance.now() - t0 > 30) { onProgress && onProgress(d / days, st); await nextFrame(); t0 = performance.now(); }
  }
  st._rt.catchup = false;
  st._rt.fx.length = 0;
  info.entries = st._rt.newChron.slice();
  st._rt.newChron.length = 0;
  info.births = st.counts.births - info.births;
  info.deaths = st.counts.deaths - info.deaths;
  return info;
}

// ---------- Bühne ----------
const stage = createStage($('#c'));
app.stage = stage;
const terrain = new Terrain(stage.scene);
app.terrain = terrain;
const water = new Water(stage.scene);
const buildings = new Buildings(stage.scene);
const people = new People(stage.scene);
const animals = new Animals(stage);
animals.load().then(() => { if (animals.kinds.bird) fx.noLineBirds = true; });
app.animals = animals;
app.people = people;
app.terrainRef = terrain; app.buildingsRef = buildings; app.groundY = groundY; app.wx = wx; app.wz = wz; app.N = NX; app.NX = NX; app.NY = NY; app.water = water; app.U = U;
people.cam = stage.camera;
people.facing = (st, b) => buildings.facing(st, b); // Türen: Menschen gehen dort hinein, wo die Tür ist
// Echte Straßen (seit 18.10.2026): Netz je Ort von jeder Haustür zum Platz, dazu die Landstraßen
const streets = new Streets(stage.scene);
const bridges = new Bridges(stage.scene); // Brücken der Landstraßen (render/bridges.js)
app.bridges = bridges;
streets.facing = (st, b, raw) => buildings.facing(st, b, raw);
buildings.doorSides = streets.doorSide; // Türen zeigen zur Straße
app.streets = streets;
people.streetTiles = streets.tile; terrain.streetMask = streets.tile; people.streets = streets; // Gehwegregel und Höhe auf dem Belag
terrain.streetAt = (x, z) => !!streets.at(x, z); // Gras und Blumen nicht auf Straßenbändern
animals.streets = streets; // Tierregeln (animal_rules.js): Straßenfelder sind für Tiere tabu
people.footOf = id => { const m = buildings.meshes.get(id); return m ? buildings.foot(m) : null; }; // echte Grundrisse fürs Ausweichen
people.floorAt = (id, x, z) => { const m = buildings.meshes.get(id); return m ? buildings.floorAt(m, x, z) : -Infinity; }; // Sockel am Hang: oben drauf stehen
const fx = new FX(stage);
// Fundorte und Piratennester (sim/sites.js, sim/pirates.js)
const sites = new Sites(stage.scene, fx);
// Mauern um die Orte (sim/military.js, render/walls.js), Tore an den Straßen
const walls = new Walls(stage.scene);
walls.streetMask = streets.tile; walls.streets = streets;
app.walls = walls;
people.fx = fx; // Funken über festlichen Plätzen
app.sitesView = sites;
terrain.trees.onFall = (x, y, z, s) => fx.dust(x, y, z, s);
animals.onSplash = (x, y, z) => fx.splash(x, y, z);
animals.onSpout = (x, y, z) => fx.spout(x, y, z);
// Geistmodus (G): als Geist in dritter Person über die Insel gehen
const ghost = new Ghost(stage, app);
ghost.load();
app.ghost = ghost;
app.buildings = buildings; // für Geist-Kollision (Höhe der Gebäude)
// Einsturz (seit 19.10.2026): Staubwolke, fliegende Brocken, rieselnder Staub solange das Haus fällt
const rnd = (a, b) => a + Math.random() * (b - a);
buildings.onCollapse = (x, y, z, h) => {
  for (let i = 0; i < 16; i++) fx.smoke.emit({ x: x + rnd(-0.35, 0.35), y: y + rnd(0.02, 0.2), z: z + rnd(-0.35, 0.35), vx: rnd(-0.5, 0.5), vy: rnd(0.1, 0.45), vz: rnd(-0.5, 0.5), life: rnd(1.6, 2.8), size: rnd(0.22, 0.42) * (0.8 + h * 0.4), grow: 0.6, c: [0.74, 0.69, 0.6], a: 0.55, drag: 0.93 });
  for (let i = 0; i < 22; i++) fx.smoke.emit({ x: x + rnd(-0.2, 0.2), y: y + rnd(0.1, h), z: z + rnd(-0.2, 0.2), vx: rnd(-1.3, 1.3), vy: rnd(0.4, 1.6), vz: rnd(-1.3, 1.3), life: rnd(0.8, 1.4), size: rnd(0.025, 0.06), c: [0.5, 0.45, 0.4], a: 1, g: -4.5, drag: 0.98 });
};
buildings.onCrumble = (x, y, z, h) => fx.smoke.emit({ x: x + rnd(-0.25, 0.25), y, z: z + rnd(-0.25, 0.25), vx: rnd(-0.2, 0.2), vy: rnd(0.05, 0.3), vz: rnd(-0.2, 0.2), life: rnd(1, 1.8), size: rnd(0.12, 0.25) * (0.8 + h * 0.3), grow: 0.5, c: [0.72, 0.67, 0.58], a: 0.4, drag: 0.94 });
// Funkenspur der Geschosse im Geistmodus (Farbe je Kraft)
ghost.onSpark = (x, y, z, c) => fx.glow.emit({ x: x + (Math.random() - 0.5) * 0.04, y: y + (Math.random() - 0.5) * 0.04, z: z + (Math.random() - 0.5) * 0.04, vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.3) * 0.25, vz: (Math.random() - 0.5) * 0.25, life: 0.35 + Math.random() * 0.35, size: 0.035 + Math.random() * 0.03, c: [c.r, c.g, c.b], a: 0.95, drag: 0.92 });
// Landung nach einem Sprung: ein Hauch Staub (der Geist leuchtet seit 19.10.2026 nicht mehr, keine Funken)
ghost.onLand = (x, y, z) => { for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; fx.smoke.emit({ x: x + Math.cos(a) * 0.05, y: y + 0.02, z: z + Math.sin(a) * 0.05, vx: Math.cos(a) * 0.12, vy: 0.04, vz: Math.sin(a) * 0.12, life: 0.7, size: 0.05, grow: 0.12, c: [0.72, 0.68, 0.6], a: 0.32, drag: 0.9 }); } };
ghost.onEnter = () => { camAnim = null; app.followId = null; ui.toast(L('Du gehst als Geist über die Insel. Niemand sieht dich, nur die Tiere spüren dich.', 'You walk the island as a spirit. No one can see you, only the animals sense you.'), 'god'); };
app.jobName = p => (D.JOBS[p.job] ? D.JOBS[p.job].name : '');
app.toast = (m, k) => { if (ui) ui.toast(m, k); };
// Blick ins Haus (Klick auf ein Haus, bei anderen Gebäuden über den Knopf in der Karte)
const interior = new Interior(stage, app);
app.interior = interior;
// Zeitraffer eines Ortes oder der ganzen Welt
const timelapse = new Timelapse(app, stage, buildings, people, animals);
app.timelapse = timelapse;
buildings.onDone = (x, y, z, h) => fx.dust(x, y + h * 0.3, z, 1.2);
// Blick ins Haus. Die Kamerasteuerung ist drinnen aus und wird beim Rausgehen immer wieder eingeschaltet
// (außer im Geistmodus oder Zeitraffer). Früher wurde der alte Zustand gemerkt: ein zweiter Klick, während das Haus
// noch lud, merkte sich "aus", und nach dem Rausgehen ging weder Drehen noch Zoomen.
app.enterBuilding = b => {
  if (!b || timelapse.active) return;
  if ((interior.active || interior.opening) && interior.b && interior.b.id === b.id) return;
  stage.controls.enabled = false;
  interior.open(b);
};
const closeInterior = interior.close.bind(interior);
interior.close = () => {
  closeInterior();
  setTimeout(() => {
    if (ghost.active || timelapse.active || interior.active || interior.opening) return;
    stage.controls.enabled = true;
    stage.controls.state = -1; // falls ein Ziehen beim Hineingehen hängen blieb, sonst sperrt OrbitControls das Mausrad
  }, 240);
};
// Spürt ein Tagebuchschreiber den Geist, steht es abends im Tagebuch
app.onFelt = (pid, text) => { if (app.coop && app.coop.guest) { app.coop.felt(pid, text); return; } if (app.st) diaryNote(app.st, pid, `Heute war mir, als stünde jemand neben mir. Ich habe laut gesagt: „${text}“ Niemand hat geantwortet.`, `Today it felt as if someone was standing next to me. I said out loud: "${text}" No one answered.`); };
document.querySelector('#btnGhost')?.addEventListener('click', () => ghost.toggle());
// Gezeichnete Karte (M): was die Menschen von der Welt kennen
const worldMap = new WorldMap(app);
app.worldMap = worldMap;
app.ghostActive = () => ghost.active;
document.querySelector('#btnMap')?.addEventListener('click', () => worldMap.toggle());
// Flugzeug (P): physikalisch gerechneter Flug über die Welt (render/flightphys.js, render/flight.js)
const flight = new Flight(stage, app, fx);
app.flight = flight;
app.ghostExit = () => ghost.exit();
flight.onEnter = () => { camAnim = null; app.followId = null; keysDown.clear(); };
document.querySelector('#btnFly')?.addEventListener('click', e => { e.currentTarget.blur(); flight.toggle(); });
// Fahrzeug (K): selbst fahren mit Zweiachs Fahrphysik auf Straßen und Gelände (render/drive.js), seit 25.10.2026
const drive = new Drive(stage, app, fx);
app.drive = drive;
drive.onEnter = () => { camAnim = null; app.followId = null; keysDown.clear(); };
document.querySelector('#btnDrive')?.addEventListener('click', e => { e.currentTarget.blur(); drive.toggle(); });
// Handy und Tablet: Touch Steuerung für Gottansicht, Geist, Flug und Fahren (ui/touch.js)
initTouch(app, stage, ghost, flight, drive);
document.querySelector('#btnHero')?.addEventListener('click', () => openHeroStory(app));
app.fx = fx;
fx.onThunder = big => app.sound.thunder(big);
fx.onBoom = () => app.sound.boom();
const ships = new Ships(stage.scene, fx);
app.ships = ships;
const vehicles = new Vehicles(stage.scene, fx, stage);
app.vehicles = vehicles;
vehicles.streetMask = streets.tile; // Stadtverkehr fährt auf dem Straßennetz
vehicles.streets = streets; vehicles.people = people; // Fahrnetz der zweispurigen Straßen, Fußgänger haben Vorrang (Verkehrsregeln)
// Flugplätze: Gelände darunter einebnen, Bäume dort weglassen (seit 19.10.2026, Bahn in echter Länge)
vehicles.onPads = pads => {
  if (!app.st || !terrain.setPads(pads)) return;
  if (terrain.applyRoadBed(app.st, streets.net || { chains: [] })) {
    for (const m of buildings.meshes.values()) { const b = m.userData.b; if (b) m.position.y = groundY(wx(b.x), wz(b.y)) + (b.t === 'feld' ? 0.02 : 0); }
    buildings.farDirty = true;
  }
  app.scatterNow = true;
};
// Kundschafterzüge (st.treks) als Gruppe mit Packtier oder Karren, nachts mit Lagerfeuer; wer unterwegs ist, fehlt im Dorf
const treks = new Treks(stage, people, fx);
app.treks = treks;
// Heere, Flotten, Lager und Schlachten (sim/military.js, render/armies.js); wer im Heer ist, fehlt im Dorf wie die Kundschafter
const armies = new Armies(stage, people, fx, ships);
app.armies = armies;
people.skip = { has: id => treks.away.has(id) || armies.away.has(id) };
armies.zoneFade = zoneFade;
treks.zoneFade = zoneFade; // das Schild über dem Zug blendet unter Leiste, Gebeten und Dock aus wie die Ortsnamen
treks.treeCount = (T, i, x, y) => terrain.trees.constructor.count(T, i, x, y, () => false); // Lager lieber auf Lichtungen
leisureHooks.treeCount = treks.treeCount; // Unternehmungen nicht unter Bäumen
let ui = null;

const cursor = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false }));
cursor.renderOrder = 10; cursor.visible = false;
stage.scene.add(cursor);

// Ab diesem Tempo (100-fach und mehr) bleibt es im Bild Tag, Wetter und Jahreszeiten wechseln gedämpft, gespeichert wird seltener
const FAST = 100;
let lastSeason = -1, treesDirty = true, lastRecolor = 0, lastSync = 0;
function initWorld() {
  const st = app.st;
  terrain.build(st);
  water.build(st);
  for (const [id, m] of buildings.meshes) { buildings.dispose(m); buildings.meshes.delete(id); }
  buildings.sync(st, seasonOf(st.day));
  people.paths.clear(); people.doors.clear(); people.sm.clear();
  streets.reset();
  bridges.reset();
  walls.reset();
  armies.reset();
  terrain.trees.quiet = true;
  app.colorsDirty = true; treesDirty = true; lastSeason = -1;
  const s = st.settlements.find(o => o.alive) || st.settlements[0];
  if (s) { stage.controls.target.set(wx(s.cx), 0.5, wz(s.cy)); stage.camera.position.set(wx(s.cx) + 10, 26, wz(s.cy) + 34); }
}

function snowTarget(st) {
  const season = seasonOf(st.day);
  return st.weather.kind === 'schnee' ? 0.9 : season === 3 ? 0.45 : 0;
}

let lastScatter = 0, scatterDirty = true, lastStreets = 0;
function refreshWorld(force) {
  const st = app.st, rt = st._rt, season = seasonOf(st.day);
  // Baukasten: nur ein Ausschnitt hat neue Höhen (rt.dirtyBox), Gelände und Wasser werden nur dort neu gebaut
  if (rt.dirtyBox && !rt.dirtyH) {
    const box = rt.dirtyBox, quick = !!rt.dirtyQuick; rt.dirtyBox = null; rt.dirtyQuick = false;
    terrain.patchHeights(st, box, quick); water.patch(st, box, quick ? 14 : 52); // während des Strichs nur das Nötigste
    if (streets.net) terrain.applyRoadBed(st, streets.net);
    for (const m of buildings.meshes.values()) { const b = m.userData.b; if (b && b.x >= box[0] - 6 && b.x <= box[1] + 6 && b.y >= box[2] - 6 && b.y <= box[3] + 6) m.position.y = groundY(wx(b.x), wz(b.y)) + (b.t === 'feld' ? 0.02 : 0); }
    buildings.farDirty = true; if (!quick) { scatterDirty = true; force = true; }
  }
  if (rt.dirtyH) {
    rt.dirtyH = false; rt.dirtyBox = null; terrain.build(st); water.build(st); force = true;
    if (streets.net) terrain.applyRoadBed(st, streets.net); // Straßenbett und Flugplätze nach neuem Gelände wieder einebnen
    buildings.dropAll(st);   // Zerstörtes stürzt dabei sichtbar ein (seit 19.10.2026)
  }
  const nowR = performance.now();
  // Im schnellen Zeitraffer wechseln die Jahreszeiten mehrmals pro Sekunde: Gelände höchstens alle 1,5 s neu färben
  const seasonDue = season !== lastSeason && (app.speed < FAST || nowR - lastRecolor > 1500);
  if (force || rt.dirtyT || app.colorsDirty || seasonDue) {
    lastRecolor = nowR;
    const owner = rt.owner, colors = {};
    // Gebiete nach Staat (states.js): alle Orte eines Staates in der Farbe der Hauptstadt, so sieht man die Grenzen
    for (const s of st.settlements) { const S = st._rt.stById && s.state && st._rt.stById.get(s.state); colors[s.id] = new THREE.Color(S && S.alive ? S.col : s.color); }
    terrain.colors(st, season, { territory: app.view.territory, owner, colors });
    app.colorsDirty = false;
    if (rt.dirtyT || seasonDue) scatterDirty = true;
    rt.dirtyT = false;
  }
  const now = performance.now();
  if (app.scatterNow) { app.scatterNow = false; scatterDirty = true; lastScatter = 0; }
  if ((scatterDirty || treesDirty) && (now - lastScatter > 3000 || force || seasonDue)) {
    terrain.scatter(st, season, rt.bldAt);
    scatterDirty = false; treesDirty = false; lastScatter = now;
  }
  if (force || seasonDue || season === lastSeason) lastSeason = season;
  if (force || app.speed < FAST || now - lastSync > 120) { lastSync = now; buildings.sync(st, lastSeason); }
  if (force || now - lastStreets > (app.speed >= FAST ? 2500 : 700)) { lastStreets = now; if (streets.sync(st)) {
    terrain.roadSig = -1; app.colorsDirty = true; people.paths.clear(); people.doors.clear();
    // Landstraßennetz geändert: Gelände entlang der Straßen einebnen, Brücken bauen, Häuser auf die neue Bodenhöhe
    if (streets.netChanged && streets.net) {
      streets.netChanged = false;
      if (terrain.applyRoadBed(st, streets.net)) {
        for (const m of buildings.meshes.values()) { const b = m.userData.b; if (b) m.position.y = groundY(wx(b.x), wz(b.y)) + (b.t === 'feld' ? 0.02 : 0); }
        buildings.farDirty = true; scatterDirty = true;
      }
      bridges.build(streets.net);
    }
    // Türen neu ausrichten (zur Straße, an der das Haus jetzt liegt)
    for (const m of buildings.meshes.values()) if (m.userData.b) m.rotation.y = buildings.facing(st, m.userData.b);
  } }
}

// Welche Insel gerade im Blick ist
app.focusIsle = () => {
  const st = app.st;
  if (!st) return null;
  const t = stage.controls.target;
  const x = Math.floor(t.x + NX / 2), y = Math.floor(t.z + NY / 2);
  // Erde: das Volk des nächsten Ortes (st.isles sind dort die Völker, rt.isleOf zeigt auf Landmassen)
  if (st.earth) {
    let bs = null, bd2 = 1e9;
    for (const s of st.settlements) if (s.alive) { const d = Math.hypot(s.cx - x, s.cy - y); if (d < bd2) { bd2 = d; bs = s; } }
    return bs ? st._rt.iById.get(bs.isle) : st.isles[0];
  }
  const id = x >= 0 && y >= 0 && x < NX && y < NY ? st._rt.isleOf[y * NX + x] : 0;
  if (id) return st._rt.iById.get(id);
  let best = null, bd = 1e9;
  for (const I of st.isles) { const d = Math.hypot(I.cx - x, I.cy - y); if (d < bd) { bd = d; best = I; } }
  return best;
};

// ---------- Tageswechsel ----------
let lastBigToast = 0, lastLocalSave = 0;
// light: im sehr schnellen Zeitraffer frischt der Bildtakt die Welt einmal nach allen Tagen auf, nicht nach jedem
function onDay(light = false) {
  const st = app.st;
  for (const e of st._rt.fx) {
    if (e.type === 'era') setTimeout(() => ui.eraModal(e.era), 600);
    else if (e.type === 'heroSay') storyEvent(app, e);
    else if (e.type === 'hero') { storyEvent(app, e); const q = st._rt.pById.get(e.to); if (q) { ui.toast(L(`${e.from} ist gestorben. Deine Geschichte geht weiter mit ${q.n}.`, `${e.from} has died. Your story continues with ${q.n}.`), 'big'); if (app.followId) app.follow(q.id); } }
    else if (e.type === 'heroEnd') { storyEvent(app, e); ui.toast(L(`Mit ${e.name} endet deine Familie. Drücke H, um einen neuen Menschen zu wählen.`, `Your family ends with ${e.name}. Press H to choose a new person.`), 'big'); }
    else fx.trigger(st, e, people);
    if (e.type === 'found' || e.type === 'war' || e.type === 'conquest') {
      const last = st.chronicle[st.chronicle.length - 1];
      // im schnellen Zeitraffer höchstens eine große Meldung alle drei Sekunden
      const nowT = performance.now();
      if (last && (app.speed < FAST || nowT - lastBigToast > 3000)) { lastBigToast = nowT; ui.toast(last.t.length > 120 ? last.t.slice(0, 118) + '…' : last.t, 'big'); }
    }
  }
  st._rt.fx.length = 0;
  st._rt.newChron.length = 0;
  if (!light) refreshWorld();
  if (st.day % 3 === 0 && performance.now() - lastLocalSave > 4000) { lastLocalSave = performance.now(); save(); }
}

// ---------- Kräfte ----------
const HINTS = { point: L('Wähle einen Ort für', 'Choose a place for'), mountain: L('Wähle einen Berg für', 'Choose a mountain for'), coast: L('Wähle eine Küste für', 'Choose a coast for'), settlement: L('Wähle eine Siedlung für', 'Choose a settlement for'), person: L('Wähle einen Menschen für', 'Choose a person for') };

app.choosePower = (id, settlement, pid) => {
  const st = app.st, P = D.POWER[id];
  if (!st) return;
  if (st.mana < P.cost) { ui.toast(L(`Für ${P.name} fehlt dir Kraft. Glaube lässt sie wachsen.`, `You lack the power for ${P.name}. Faith makes it grow.`)); return; }
  app.sound.start();
  if (P.target === 'global' && !ghost.active) return doCast(id, {});   // im Geistmodus wird auch sie erst gewählt, dann gewirkt
  if (P.target === 'settlement' && settlement) return doCast(id, { sid: settlement.id, x: settlement.cx, y: settlement.cy });
  if (id === 'traum') {
    ui.dreamPicker(theme => {
      if (!theme) return cancelPower();
      app.dreamTheme = theme;
      if (pid) return doCast('traum', { pid, theme });
      app.power = 'traum';
      ui.hint(L(`Wähle einen Menschen, der von <b>${D.DREAMS[theme].name}</b> träumen soll. Oder klicke auf eine Siedlung.`, `Choose a person to dream of <b>${D.DREAMS[theme].name}</b>. Or click a settlement.`));
      document.body.classList.add('targeting');
    });
    return;
  }
  app.power = id;
  ui.hint(HINTS[P.target] ? `${HINTS[P.target]} <b>${P.name}</b>.` : `<b>${P.name}</b>`);
  document.body.classList.add('targeting');
  ui.updateCards();
};

function cancelPower() {
  app.power = null; app.dreamTheme = null;
  cursor.visible = false;
  ui.hint(null);
  document.body.classList.remove('targeting');
  ui.updateCards();
}

function doCast(id, tgt) {
  const st = app.st;
  // Mehrspieler: der Gast wünscht, der Gastgeber wirkt (net/coop.js), zurück kommt die Kraft über castNet
  if (app.coop && app.coop.guest) { ghost.playCast(); app.coop.requestCast(id, tgt); cancelPower(); return true; }
  const sent = { ...tgt };
  const res = cast(st, id, tgt);
  if (!res.ok) { ui.toast(res.msg, 'warn'); return false; }
  ghost.playCast();
  app.sound.chime();
  if (app.onCast) app.onCast(id);
  for (const e of st._rt.fx) fx.trigger(st, e, people);
  st._rt.fx.length = 0;
  refreshWorld(true);
  ui.toast(res.msg, 'god');
  cancelPower();
  ui.update(st, tod(), true);
  if (app.coop) app.coop.castDone(id, sent, 'host');
  save();
  return true;
}

// Kraft aus dem Mehrspieler: beim Gastgeber der Wunsch des Gasts, beim Gast jede Kraft aus dem Takt des Gastgebers.
// Ohne Geistgeste und ohne die eigene gewählte Karte abzulegen (der andere hat gewirkt). o.mine: eigener Wunsch kam zurück.
function castNet(id, tgt, o = {}) {
  const st = app.st;
  if (!st) return { ok: false, msg: '' };
  const sent = { ...tgt };
  const res = cast(st, id, tgt);
  if (!res.ok) { if (o.mine || (app.coop && app.coop.host)) ui.toast(res.msg, 'warn'); return res; }
  if (o.mine) { app.sound.chime(); if (app.onCast) app.onCast(id); }
  for (const e of st._rt.fx) fx.trigger(st, e, people);
  st._rt.fx.length = 0;
  refreshWorld(true);
  ui.toast(o.who ? `${o.who}: ${res.msg}` : res.msg, 'god');
  ui.update(st, tod(), true);
  if (app.coop && app.coop.host) app.coop.castDone(id, sent, 'guest');
  save();
  return res;
}

// ---------- Kamera ----------
let camAnim = null;
app.focus = (x, y, dist = 45) => {
  const st = app.st;
  const to = new THREE.Vector3(wx(x), Math.max(0, groundY(wx(x), wz(y))), wz(y));
  const dir = stage.camera.position.clone().sub(stage.controls.target).normalize();
  camAnim = { t: 0, fromT: stage.controls.target.clone(), toT: to, fromP: stage.camera.position.clone(), toP: to.clone().add(dir.multiplyScalar(dist)) };
};
app.follow = id => { app.followId = id; if (id) app.selId = id; };
app.selectPerson = (id, focus) => {
  app.selId = id;
  if (!id) { app.followId = null; return; }
  const p = app.st._rt.pById.get(id);
  if (!p) { ui.toast(L('Dieser Mensch lebt nicht mehr.', 'This person is no longer alive.')); return; }
  ui.showPerson(p);
  if (focus) {
    const pos = people.pos.get(id);
    if (pos) app.focus(pos[0] + NX / 2 - 0.5, pos[2] + NY / 2 - 0.5, 22);
    else { const s = app.st._rt.sById.get(p.s); if (s) app.focus(s.cx, s.cy, 30); }
  }
};
app.refresh = () => refreshWorld(true);
app.castAt = (id, tgt) => doCast(id, tgt);
// Geistmodus (seit 19.10.2026): Karte ablegen (rechte Maustaste) und nach einem Schuss wieder bereit halten
app.cancelPower = () => cancelPower();
app.rearm = (id, theme) => { app.power = id; app.dreamTheme = theme || null; ui.updateCards(); };
// Der Geist wirkt die gewählte Kraft dort, wo er steht (Ort, nächste Siedlung oder Mensch in der Nähe)
app.castHere = (x, y, pid) => {
  const P = D.POWER[app.power];
  if (!P) return;
  if (P.target === 'person') {
    if (pid) return doCast('traum', { pid, theme: app.dreamTheme });
    ui.toast(L('Geh näher an einen Menschen heran.', 'Walk closer to a person.'));
    return;
  }
  if (P.target === 'settlement') {
    const s = nearestSettlement(x, y, 10);
    if (!s) { ui.toast(L('Hier lebt niemand. Geh zu einer Siedlung.', 'Nobody lives here. Walk to a settlement.')); return; }
    return doCast(app.power, { sid: s.id, x: s.cx, y: s.cy });
  }
  return doCast(app.power, { x, y });
};
app.setWorld = st => { app.st = st; app.acc = 0; initWorld(); ui.renderChron(true); refreshWorld(true); };
app.setSpeed = s => {
  if (app.coopGuest) { ui.toast(L('Das Tempo bestimmt dein Gastgeber.', 'Your host sets the speed.')); return; }
  app.speed = s; ui.update(app.st, tod(), true);
};
app.toggleSound = () => { app.sound.start(); app.sound.setOn(!app.sound.on); };
app.setQuality = q => { stage.setQuality(q); try { localStorage.setItem('biu.quality', q); } catch { /* egal */ } };

app.exportSave = () => {
  save(true);
  const blob = new Blob([serialize(app.st)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${EARTH_MODE ? 'pray-for-rain-erde' : 'built-it-up'}-${L('jahr', 'year')}-${Math.floor(app.st.day / D.DAYS_PER_YEAR) + 1}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
app.importSave = () => {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    try {
      const o = JSON.parse(await f.text());
      if (!!o.earth !== EARTH_MODE) { ui.toast(o.earth ? L('Diese Datei ist eine Erde. Wechsle im Startbild zur Erde und lade sie dort.', 'This file is an Earth. Switch to the Earth on the title screen and load it there.') : L('Diese Datei ist eine Inselwelt. Wechsle im Startbild zur Inselwelt und lade sie dort.', 'This file is an island world. Switch to the island world on the title screen and load it there.'), 'warn'); return; }
      const st = deserialize(o);
      app.st = st; app.acc = st.acc || 0;
      initWorld(); ui.renderChron(true); ui.renderLeft(); save(true);
      ui.toast(L('Insel geladen.', 'Island loaded.'), 'god');
    } catch { ui.toast(L('Diese Datei ist keine Insel.', 'This file is not an island.'), 'warn'); }
  };
  inp.click();
};
// Erde: eine neue Erde beginnt mit der Wahl des Startorts (neu laden, newEarthFlow im Startbild)
app.enterEarth = fresh => {
  save(true, true);
  try { localStorage.setItem('pfr.world', 'erde'); if (fresh) sessionStorage.setItem('pfr.newEarth', '1'); } catch { /* egal */ }
  location.reload();
};
app.leaveEarth = () => {
  if (app.st) save(true, true);
  try { localStorage.setItem('pfr.world', 'welt'); sessionStorage.removeItem('pfr.newEarth'); } catch { /* egal */ }
  location.reload();
};
app.earthMode = EARTH_MODE;
// Baukasten (seit 20.10.2026): eigene Level als dritte Welt, Wechsel wie bei der Erde über pfr.world und Neuladen
app.levelMode = LEVEL_MODE;
app.save = save;
app.enterLevel = () => {
  if (app.st) save(true, true);
  try { localStorage.setItem('pfr.world', 'level'); sessionStorage.setItem('pfr.edit', '1'); } catch { /* egal */ }
  location.reload();
};
app.leaveLevel = () => {
  if (app.st) save(true, true);
  try { localStorage.setItem('pfr.world', 'welt'); sessionStorage.removeItem('pfr.edit'); } catch { /* egal */ }
  location.reload();
};
// Startort gewählt (earthpick.js): die Erde entsteht mit dem Volk des Spielers und sieben anderen
app.createEarth = (x, y) => {
  app.st = createEarthWorld((Date.now() ^ (Math.random() * 1e9)) >>> 0, { x, y });
  app.acc = 0;
  try { sessionStorage.removeItem('pfr.newEarth'); localStorage.setItem('pfr.hasEarth', '1'); } catch { /* egal */ }
  initWorld(); refreshWorld(true); ui.renderChron(true); ui.renderLeft(); ui.update(app.st, tod(), true);
  save(true);
  app.running = true;
  last = performance.now(); lastWall = Date.now();
};
app.newWorld = () => {
  if (EARTH_MODE) { app.enterEarth(true); return; }
  app.st = createWorld((Date.now() ^ (Math.random() * 1e9)) >>> 0);
  app.acc = 0;
  initWorld(); ui.renderChron(true); ui.renderLeft(); save(true);
  // Neue Welt: Einführungsvideo, wer du bist, dann ein Leben wählen und das Tutorial (onboarding.js)
  app.pickHero = true;
  if (app.running) { app.pickHero = false; newGameFlow(app, !new URLSearchParams(location.search).has('notrailer')); }
};

// ---------- Eingabe ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function tileAt(ev) {
  const r = stage.renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, stage.camera);
  const hit = ray.intersectObject(terrain.mesh, true)[0];
  if (!hit) return null;
  const x = Math.floor(hit.point.x + NX / 2), y = Math.floor(hit.point.z + NY / 2);
  if (x < 0 || y < 0 || x >= NX || y >= NY) return null;
  return { x, y, p: hit.point };
}
const v3 = new THREE.Vector3();
app.tileAt = tileAt; app.buildingAt = ev => buildingAt(ev); app.refreshWorld = f => refreshWorld(f); // für den Baukasten
function personAt(ev, maxPx = 16) {
  const r = stage.renderer.domElement.getBoundingClientRect();
  let best = null, bd = maxPx;
  for (const [id, p] of people.pos) {
    v3.set(p[0], p[1] + 0.12, p[2]).project(stage.camera);
    if (v3.z > 1) continue;
    const sx = (v3.x + 1) / 2 * r.width + r.left, sy = (1 - v3.y) / 2 * r.height + r.top;
    const d = Math.hypot(sx - ev.clientX, sy - ev.clientY);
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}
function buildingAt(ev) {
  const r = stage.renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, stage.camera);
  const hit = ray.intersectObjects(buildings.pickables(), false)[0];
  return hit ? hit.object.userData.id : null;
}
function nearestSettlement(x, y, extra = 6) {
  let best = null, bd = 1e9;
  for (const s of app.st.settlements) { if (!s.alive) continue; const d = Math.hypot(s.cx - x, s.cy - y); if (d < s.R + extra && d < bd) { bd = d; best = s; } }
  return best;
}

const canvas = stage.renderer.domElement;
if (!CINE) initHand(canvas);
let down = null;
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now(), b: e.button }; });
canvas.addEventListener('pointermove', e => {
  if (ghost.active || (app.editor && app.editor.active)) { cursor.visible = false; return; }
  if (!app.power || !app.st) return;
  const P = D.POWER[app.power];
  const t = tileAt(e);
  if (!t) { cursor.visible = false; return; }
  let r = P.radius || 1.4, cx = t.x, cy = t.y;
  if (P.target === 'settlement' || P.target === 'person') {
    const s = nearestSettlement(t.x, t.y);
    if (s && P.target === 'settlement') { cx = s.cx; cy = s.cy; r = s.R; }
  }
  cursor.visible = true;
  cursor.scale.setScalar(r);
  cursor.position.set(wx(cx), Math.max(0, groundY(wx(cx), wz(cy))) + 0.08, wz(cy));
});
canvas.addEventListener('pointerup', e => {
  if (interior.active || interior.opening || app.flying || app.driving || ghost.active || (app.editor && app.editor.active)) { down = null; return; } // im Cockpit dreht ein Klick nur den Blick, im Geistmodus sperrt er die Maus
  if (!down || !app.st) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const b = down.b;
  down = null;
  if (moved > 6 || b !== 0) return;
  app.sound.start();
  const st = app.st;
  if (app.power) {
    const P = D.POWER[app.power];
    if (P.target === 'person') {
      const pid = personAt(e, 22);
      if (pid) { doCast('traum', { pid, theme: app.dreamTheme }); return; }
      const t = tileAt(e);
      const s = t && nearestSettlement(t.x, t.y);
      if (s) {
        const cands = st.people.filter(p => p.s === s.id && ageOf(st, p) >= 14);
        if (cands.length) {
          const best = cands.reduce((a, p) => (p.tr.charisma + p.tr.neugier > a.tr.charisma + a.tr.neugier ? p : a), cands[0]);
          doCast('traum', { pid: best.id, theme: app.dreamTheme });
          return;
        }
      }
      ui.toast(L('Klicke auf einen Menschen oder eine Siedlung.', 'Click a person or a settlement.'));
      return;
    }
    const t = tileAt(e);
    if (!t) return;
    if (P.target === 'settlement') {
      const s = nearestSettlement(t.x, t.y);
      if (!s) { ui.toast(L('Dort lebt niemand. Wähle eine Siedlung.', 'Nobody lives there. Choose a settlement.')); return; }
      doCast(app.power, { sid: s.id, x: s.cx, y: s.cy });
      return;
    }
    doCast(app.power, { x: t.x, y: t.y });
    return;
  }
  const pid = personAt(e, 12);
  if (pid) { app.selectPerson(pid); return; }
  const bid = buildingAt(e);
  if (bid) { const bb = st._rt.bById.get(bid); if (bb) { app.selId = null; ui.showBuilding(bb); if ((bb.t === 'haus' || bb.t === 'hochhaus') && bb.prog >= 1) app.enterBuilding(bb); } return; }
  // Fundort angeklickt: seine Geschichte erzählen
  const tl = tileAt(e);
  if (tl) { const so = sites.at(st, tl.x, tl.y); if (so) { ui.toast(siteInfo(st, so), 'god'); return; } }
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Escape') { if ($('#modal').className === 'show') $('#modal').className = ''; else if (app.power) cancelPower(); else ui.closeInspector(); }
  else if (e.key === '1') app.setSpeed(1);
  else if (e.key === '2') app.setSpeed(3);
  else if (e.key === '3') app.setSpeed(10);
  else if (e.key === '4') app.setSpeed(100);
  else if (e.key === '5') app.setSpeed(500);
  else if (e.key === '6') app.setSpeed(1000);
  else if (e.key === '7') app.setSpeed(10000);
  else if (e.key === '8') app.setSpeed(100000);
  else if (e.key === 'h' || e.key === 'H') openHeroStory(app);
  else if (e.key === 'c' || e.key === 'C') document.body.classList.toggle('chron-open');
  else if (e.key === 'i' || e.key === 'I') { document.body.classList.toggle('left-open'); ui.renderLeft(true); }
  else if ((e.key === 'f' || e.key === 'F') && app.selId) app.follow(app.followId ? null : app.selId);
});

// ---------- Kamera mit der Tastatur (seit 18.10.2026) ----------
// Pfeiltasten oder WASD schieben den Blick über die Welt, Q und E drehen, + und - zoomen. Tempo wächst mit dem Abstand.
const keysDown = new Set();
const PAN_KEYS = { ArrowUp: 'f', w: 'f', W: 'f', ArrowDown: 'b', s: 'b', S: 'b', ArrowLeft: 'l', a: 'l', A: 'l', ArrowRight: 'r', d: 'r', D: 'r', q: 'ql', Q: 'ql', e: 'qr', E: 'qr', '+': 'in', '=': 'in', '-': 'out', '_': 'out' };
const typing = e => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
window.addEventListener('keydown', e => {
  if (typing(e) || ghost.active || interior.active || app.mapOpen || app.collectionOpen || app.flying || app.driving || e.metaKey || e.ctrlKey) return;
  const k = PAN_KEYS[e.key];
  if (!k) return;
  keysDown.add(k);
  if (e.key.startsWith('Arrow')) e.preventDefault();
});
window.addEventListener('keyup', e => { const k = PAN_KEYS[e.key]; if (k) keysDown.delete(k); });
window.addEventListener('blur', () => keysDown.clear());
const panV = new THREE.Vector3();
function keyCamera(dt, tg) {
  if (app.mapOpen) keysDown.clear();
  const want = new THREE.Vector3();
  if (keysDown.size) {
    const cam = stage.camera.position;
    const fw = new THREE.Vector3(tg.x - cam.x, 0, tg.z - cam.z).normalize();
    const rt = new THREE.Vector3(-fw.z, 0, fw.x);
    const dist = cam.distanceTo(tg), speed = Math.max(6, dist * 0.95);
    if (keysDown.has('f')) want.add(fw); if (keysDown.has('b')) want.sub(fw);
    if (keysDown.has('r')) want.add(rt); if (keysDown.has('l')) want.sub(rt);
    if (want.lengthSq()) want.normalize().multiplyScalar(speed);
    const rot = (keysDown.has('qr') ? 1 : 0) - (keysDown.has('ql') ? 1 : 0);
    const zoom = (keysDown.has('out') ? 1 : 0) - (keysDown.has('in') ? 1 : 0);
    if (rot || zoom) {
      const off = cam.clone().sub(tg);
      if (rot) off.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot * dt * 1.3);
      if (zoom) off.multiplyScalar(THREE.MathUtils.clamp(1 + zoom * dt * 1.4, stage.controls.minDistance / off.length(), stage.controls.maxDistance / off.length()));
      cam.copy(tg).add(off);
    }
    if (rot || zoom || want.lengthSq()) { camAnim = null; if (app.followId) app.follow(null); }
  }
  // weich anfahren und auslaufen
  panV.lerp(want, Math.min(1, dt * 7));
  if (panV.lengthSq() > 1e-4) { const d = panV.clone().multiplyScalar(dt); tg.add(d); stage.camera.position.add(d); }
}

// Wetter am Ort des Blicks: in der Wüste fällt kein Schnee und kaum Regen, auf Gletschern schneit es statt zu regnen
function localWeather(st, w) {
  const t = stage.controls.target;
  const x = Math.floor(t.x + NX / 2), y = Math.floor(t.z + NY / 2);
  if (x < 0 || y < 0 || x >= NX || y >= NY || !st.tiles.bio) return w;
  const B = D.BIOMES[st.tiles.bio[y * NX + x]] || D.BIOMES[0];
  if (B.snow === 1) return w;
  const o = { ...w };
  if (B.snow < 0.6) { o.snow = w.snow * B.snow / 0.6; if (B.key === 'wueste' || B.key === 'salz' || B.key === 'canyon') o.rain = w.rain * 0.25; }
  if (B.snow >= 1.5 && w.rain > 0 && w.kind !== 'sturm') { o.snow = Math.max(w.snow, w.rain * 0.8); o.rain = w.rain * 0.2; }
  return o;
}

// ---------- Schleife ----------
// Ein sichtbarer Tag dauert sechs Simulationstage (drei Minuten): so bleibt den Menschen Zeit, in echtem Schritttempo
// zur Arbeit und zurück zu gehen, und die Nacht flackert nicht
const VDAYS = 6;
app.VDAYS = VDAYS;
let wSmooth = null;
function smoothWeather(w, fast, dt) {
  if (!fast) { wSmooth = null; return w; }
  if (!wSmooth) wSmooth = { ...w };
  const k = Math.min(1, dt * 0.7);
  for (const key of ['gloom', 'fog', 'storm', 'clouds', 'rain', 'snow']) wSmooth[key] += (w[key] - wSmooth[key]) * k;
  wSmooth.kind = wSmooth.rain > 0.5 ? (wSmooth.storm > 0.6 ? 'sturm' : 'regen') : wSmooth.snow > 0.5 ? 'schnee' : wSmooth.fog > 0.6 ? 'nebel' : wSmooth.clouds > 0.6 ? 'wolkig' : 'klar';
  wSmooth.sunny = wSmooth.kind === 'klar';
  return wSmooth;
}
// im Baukasten steht die Sonne fest am Vormittag (man baut nicht im Dunkeln)
const tod = () => (app.fixTod != null ? app.fixTod : app.editor && app.editor.active ? 0.42 : (0.3 + (((app.st ? app.st.day : 0) % VDAYS) + app.acc / DAY) / VDAYS) % 1);
app.tod = tod;
let last = performance.now(), lastUi = 0, clock = 0;
const labelEls = new Map(), isleEls = new Map();

// Namen über der Welt weichen der Oberfläche: in der Leiste oben, unter den Gebeten und über dem Kräfte Dock blenden sie weich aus.
// Die Bereiche und die Größe der Namen werden nur alle 300 ms gemessen (zusammen, vor allen Schreibzugriffen), nicht jedes Bild.
let uiZones = [], uiZonesAt = -1e9;
function measureLabels(now) {
  if (now - uiZonesAt < 300) return;
  uiZonesAt = now;
  uiZones = [];
  for (const sel of ['#top', '#prayers', '#dock']) {
    const e = $(sel);
    if (!e || !e.childElementCount) continue;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
    const b = e.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) continue;
    uiZones.push(sel === '#top' ? [0, 0, innerWidth, b.bottom] : [b.left, b.top, b.right, b.bottom]);
  }
  for (const el of labelEls.values()) if (el.style.display !== 'none') { el._w = el.offsetWidth; el._h = el.offsetHeight; }
  for (const el of isleEls.values()) { el._w = el.offsetWidth; el._h = el.offsetHeight; }
}
// 1 = frei, 0 = steckt unter der Oberfläche; der Rand blendet über 16 px
function zoneFade(x0, y0, x1, y1) {
  let f = 1;
  for (const [a, b, c, d] of uiZones) {
    const ox = Math.min(x1, c) - Math.max(x0, a), oy = Math.min(y1, d) - Math.max(y0, b);
    if (ox > -6 && oy > -6) f = Math.min(f, 1 - Math.min(1, (Math.min(ox, oy) + 6) / 16));
  }
  return f;
}
function setFade(el, o) {
  o = Math.round(o * 20) / 20;
  if (el._o === o) return;
  el._o = o;
  el.style.opacity = o;
  el.style.pointerEvents = o < 0.3 ? 'none' : '';
}

function updateLabels() {
  const st = app.st, box = $('#labels');
  const r = canvas.getBoundingClientRect();
  measureLabels(performance.now());
  const seen = new Set(), boxes = [];
  // Erde: große Orte zuerst, kleinere Namen, die einen größeren überdecken würden, blenden aus (von weit oben sonst ein Knäuel)
  for (const s of st.earth ? st.settlements.filter(o => o.alive).sort((a, b) => b.pop - a.pop) : st.settlements) {
    if (!s.alive) continue;
    seen.add(s.id);
    let el = labelEls.get(s.id);
    if (!el) {
      el = document.createElement('button');
      el.className = 'slabel';
      el.onclick = () => ui.openSettlement(s.id);
      box.append(el); labelEls.set(s.id, el);
    }
    const prayer = st.prayers.find(p => p.s === s.id);
    // Farbe des Staates, Hauptstadt eines Staates mit mehreren Orten mit Stern (states.js)
    const SS = st._rt.stById && s.state && st._rt.stById.get(s.state), scol = SS && SS.alive ? SS.col : s.color;
    const capStar = SS && SS.cap === s.id && st.settlements.some(o => o.alive && o !== s && o.state === s.state) ? '★ ' : '';
    const key = `${s.name}|${s.pop}|${s.war}|${prayer ? prayer.power : ''}|${s.gov.type}|${scol}|${capStar}`;
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.innerHTML = `<i style="background:${scol}"></i><b>${capStar}${s.name}</b><span>${s.pop}</span>${s.war ? `<em class="w">${L('Krieg', 'War')}</em>` : ''}${prayer ? `<img src="assets/cards/${prayer.power}.webp" alt="" title="${L('Gebet', 'Prayer')}">` : ''}`;
      el._w = 0;
    }
    v3.set(wx(s.cx), Math.max(0, groundY(wx(s.cx), wz(s.cy))) + 2.6, wz(s.cy)).project(stage.camera);
    const vis = v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1;
    el.style.display = vis ? '' : 'none';
    if (!vis) continue;
    if (!el._w) { el._w = el.offsetWidth; el._h = el.offsetHeight; }
    const x = (v3.x + 1) / 2 * r.width, y = (1 - v3.y) / 2 * r.height;
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    let f = zoneFade(x - el._w / 2, y - el._h, x + el._w / 2, y);
    if (st.earth && f > 0.3) for (const [a, b, c, d] of boxes) if (x + el._w / 2 > a - 3 && x - el._w / 2 < c + 3 && y > b - 2 && y - el._h < d + 2) { f = 0; break; }
    setFade(el, f);
    if (f > 0.3) boxes.push([x - el._w / 2, y - el._h, x + el._w / 2, y]);
  }
  for (const [id, el] of labelEls) if (!seen.has(id)) { el.remove(); labelEls.delete(id); }
  // Inselnamen, wenn man weit herauszoomt; liegt ein Ortsname darunter, weicht der Inselname sanft nach oben aus
  const far = stage.camera.position.distanceTo(stage.controls.target) > 75;
  for (const I of st.isles) {
    let el = isleEls.get(I.id);
    if (!el) { el = document.createElement('div'); el.className = 'ilabel'; box.append(el); isleEls.set(I.id, el); }
    const sets = st.settlements.filter(x => x.alive && x.isle === I.id);
    // Erde: die Völker über ihrer Hauptstadt (st.isles sind dort Völker)
    const cap = st.earth ? (st._rt.sById.get(I.capital)?.alive ? st._rt.sById.get(I.capital) : sets[0]) : null;
    if (st.earth && !cap) { setFade(el, 0); continue; }
    const key = `${I.name}|${sets.length}|${I.era}|${I.cont ? 1 : 0}`;
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.classList.toggle('cont', !!I.cont);
      const sub = sets.length ? D.ERAS[I.era].name : L('unbewohnt', 'uninhabited');
      el.innerHTML = st.earth ? `${L(`die ${I.name}`, `the ${I.name}`)}<small>${sub} · ${sets.length} ${sets.length === 1 ? L('Ort', 'town') : L('Orte', 'towns')}</small>` : `${I.name}<small>${I.cont ? L('Festland', 'Mainland') + ' · ' : ''}${sub}</small>`; el._w = el.offsetWidth; el._h = el.offsetHeight;
    }
    if (st.earth) v3.set(wx(cap.cx), 6, wz(cap.cy) - 6).project(stage.camera);
    else if (I.cont) v3.set(wx(I.cx), 7, wz(I.cy)).project(stage.camera);
    else v3.set(wx(I.cx), 4.5, wz(I.cy) - Math.sqrt(I.area) * 0.62 - 2).project(stage.camera);
    const vis = far && v3.z < 1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05;
    if (!vis) { setFade(el, 0); continue; }
    const x = (v3.x + 1) / 2 * r.width, w = el._w || 0, h = el._h || 0;
    let y = (1 - v3.y) / 2 * r.height, dy = 0;
    for (const [a, b, c, d] of boxes) if (x + w / 2 > a && x - w / 2 < c && y + h / 2 + dy > b - 4 && y - h / 2 + dy < d) dy = b - 4 - (y + h / 2);
    el._dy = (el._dy || 0) + (dy - (el._dy || 0)) * 0.2;
    y += el._dy;
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
    setFade(el, zoneFade(x - w / 2, y - h / 2, x + w / 2, y + h / 2));
    boxes.push([x - w / 2, y - h / 2, x + w / 2, y + h / 2]);
  }
  regionLabels(st, r, boxes);
}

// Namen der bekannten Gegenden (Wüsten, Wälder, Gebirge, Seen), wenn man sehr weit herauszoomt
const regionEls = new Map();
function regionLabels(st, r, boxes) {
  const dist = stage.camera.position.distanceTo(stage.controls.target);
  const show = dist > 140 && !ghost.active;
  const box = document.querySelector('#labels') || document.body;
  // Erde: echte Namen nach Rang (je weiter weg, desto nur die großen), darunter klein der Name des Volkes
  const maxRank = dist > 900 ? 0 : dist > 500 ? 1 : dist > 260 ? 2 : 3;
  for (const g of st.regions || []) {
    const ok = show && st.tiles.seen[g.cy * NX + g.cx] >= 150 && (st.earth ? (g.de || g.name) && (g.rank ?? 9) <= maxRank : g.name && (g.n > 260 || ['vulkan', 'oase', 'see', 'eis', 'fjord'].includes(g.b)));
    let el = regionEls.get(g.id);
    if (!ok) { if (el) setFade(el, 0); continue; }
    if (!el) { el = document.createElement('div'); el.className = 'rlabel'; box.append(el); regionEls.set(g.id, el); }
    const real = st.earth && g.de ? L(g.de, g.en) : '';
    const folk = g.name ? g.name.charAt(0).toUpperCase() + g.name.slice(1) : '';
    const key = real + '|' + folk;
    if (el.dataset.n !== key) { el.dataset.n = key; if (real) el.innerHTML = folk ? `${real}<small>${folk}</small>` : real; else el.textContent = folk; el._w = el.offsetWidth; el._h = el.offsetHeight; }
    v3.set(wx(g.cx), 1.5, wz(g.cy)).project(stage.camera);
    if (v3.z > 1 || Math.abs(v3.x) > 1.05 || Math.abs(v3.y) > 1.05) { setFade(el, 0); continue; }
    const x = (v3.x + 1) / 2 * r.width, y = (1 - v3.y) / 2 * r.height, w = el._w || 0, h = el._h || 0;
    if (boxes.some(([a, b, c, d]) => x + w / 2 > a && x - w / 2 < c && y + h / 2 > b && y - h / 2 < d)) { setFade(el, 0); continue; }
    boxes.push([x - w / 2, y - h / 2, x + w / 2, y + h / 2]);
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
    setFade(el, zoneFade(x - w / 2, y - h / 2, x + w / 2, y + h / 2) * 0.9);
  }
}

let lastWall = Date.now(), catching = false;
// Versteckte Tabs bekommen keine Bilder: die Lücke wird wie beim Wiederkommen nachgeholt
function bridgeGap(st, gap) {
  catching = true;
  st.acc = app.acc;
  catchUp(st, gap).then(info => {
    catching = false;
    refreshWorld(true);
    ui.update(st, tod(), true);
    if (info.days >= D.DAYS_PER_YEAR) ui.welcomeBack(info);
    save(true);
  });
}

function frame(now) {
  requestAnimationFrame(frame);
  if (CINE && app.st) return; // im Filmmodus bestimmt app.cineFrame den Takt
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  tick(dt, now);
}
app.cineFrame = (dt = 1 / 30) => { tick(dt, clock * 1000 + dt * 1000); };

function tick(dt, now) {
  clock += dt;
  const st = app.st;
  if (!st) { stage.composer.render(); return; }
  const wall = Date.now(), gap = (wall - lastWall) / 1000;
  lastWall = wall;
  if (!CINE && gap > 2 && app.running && !app.blocked && !catching && !app.coopGuest && ownLock()) bridgeGap(st, gap);
  // Gast im Mehrspieler: keine eigene Zeit, die Tage kommen im Takt des Gastgebers (net/coop.js guestStep)
  if (app.coopGuest) { if (app.running && app.coop) app.coop.guestStep(dt); }
  else if (app.running && !app.blocked && !catching && ownLock()) {
    app.acc += dt * app.speed;
    let steps = 0;
    if (app.speed > 1000) {
      // 10.000× und 100.000× (seit 24.10.2026): so viele Tage, wie ins Zeitbudget je Bild passen (10.000× 34 ms, bleibt
      // flüssiger; 100.000× 75 ms, rechnet mehr), die Welt danach einmal auffrischen. Schafft der Rechner das Tempo
      // nicht, läuft es so schnell er kann; die Kopfleiste zeigt die echten Jahre pro Sekunde.
      const t0 = performance.now(), budget = app.speed >= 100000 ? 75 : 34;
      while (app.acc >= DAY && performance.now() - t0 < budget) { app.acc -= DAY; stepDay(st); steps++; onDay(true); }
      if (steps) refreshWorld();
    } else while (app.acc >= DAY && steps < 6) { app.acc -= DAY; stepDay(st); steps++; onDay(); }
    if (app.acc >= DAY) app.acc = DAY * 0.98;
    // gemessenes Tempo in Spieltagen je Sekunde (weich), für die Anzeige im sehr schnellen Zeitraffer
    app.daysPerSec = (app.daysPerSec || 0) * 0.95 + (steps / Math.max(dt, 1e-3)) * 0.05;
  }
  // Ab 100-fach würden Tag und Nacht und das Wetter flackern: dann bleibt es Tag und das Wetter wechselt weich
  const fast = app.speed >= FAST;
  const f = app.fixTod != null ? app.fixTod : timelapse.active ? 0.42 : fast ? 0.45 : tod(); // im Zeitraffer immer Tag, im Film fest (app.fixTod)
  const wxs = localWeather(st, smoothWeather(fx.weather(st), fast, dt));
  app.f = f; // angezeigte Tageszeit (auch für die Innenansicht)
  const { dayLight } = stage.setTime(f, wxs);
  const night = 1 - dayLight;
  app.night = night;
  water.update(clock, stage, wxs);
  water.uniforms.dayLight.value = 0.35 + dayLight * 0.65;
  water.uniforms.rise.value = fx.rise;
  const fish = st.effects.find(e => e.k === 'fische');
  if (fish) water.uniforms.fish.value.set(wx(fish.x), wz(fish.y), fish.r, 1); else water.uniforms.fish.value.w = 0;
  buildings.update(clock, night);
  // Im Flug ist die Kamera nah am Flugzeug, sieht aber weit: dann zählt die Höhe über Grund
  const viewDist = flight.active ? Math.max(stage.camera.position.distanceTo(stage.controls.target), flight.agl * 1.6) : stage.camera.position.distanceTo(stage.controls.target);
  buildings.lod(st, viewDist);
  people.speed = app.running && !catching ? app.speed : 1; people.vdays = VDAYS; people.heroId = st.hero && !st.hero.end ? st.hero.id : 0;
  people.update(st, f, clock, st.weather, app.selId);
  treks.update(st, app.acc / DAY, clock, { vdays: VDAYS, night, fast, selId: app.selId, labels: !CINE && !ghost.active && !flight.active && !drive.active && !timelapse.active && !interior.active && !app.mapOpen });
  armies.update(st, app.acc / DAY, clock, { vdays: VDAYS, night, fast, selId: app.selId, rise: fx.rise, labels: !CINE && !ghost.active && !flight.active && !drive.active && !timelapse.active && !interior.active && !app.mapOpen });
  buildings.occ = people.homeStats || null; // Fensterlicht und Rauch je nach Bewohnern
  terrain.trees.camera = stage.camera;
  terrain.trees.tick(clock);
  terrain.tick(clock);
  terrain.follow(st, lastSeason < 0 ? seasonOf(st.day) : lastSeason, st._rt.bldAt, stage.controls.target, viewDist);
  ghost.update(dt, clock, people, st);
  flight.update(dt, clock);
  drive.update(dt);
  if (app.coop) app.coop.frame(dt, clock); // Mitspieler zeichnen, Takt und eigene Lage senden (net/coop.js)
  animals.ghost = ghost.active ? ghost.pos : null;
  animals.people = people;
  animals.update(st, clock, dt, night, wxs, fx.rise, buildings);
  fx.camPos = stage.camera.position;
  fx.update(st, dt, clock, wxs, night, buildings, people);
  ships.update(st, app.acc / DAY, clock, fx.rise);
  vehicles.update(st, app.acc / DAY, clock, fx.rise, night);
  sites.update(st, clock, dt, stage.camera, timelapse.active || interior.active);
  walls.update(st, clock, night, timelapse.active || interior.active);
  U.uTime.value = clock;
  U.uSnow.value += (snowTarget(st) - U.uSnow.value) * Math.min(1, dt * 0.4);
  U.uWind.value = 1 + wxs.storm * 2.2;
  U.uViewUp.value.set(0, 1, 0).transformDirection(stage.camera.matrixWorldInverse);
  stage.followShadow(flight.active ? flight.shadowAt : stage.controls.target, viewDist, flight.active ? 260 : 95);
  const pxScale = canvas.height / 2 / Math.tan(THREE.MathUtils.degToRad(stage.camera.fov / 2));
  fx.smoke.points.material.uniforms.scale.value = pxScale;
  fx.glow.points.material.uniforms.scale.value = pxScale;
  // Kamera
  timelapse.update(dt);
  if (ghost.active || timelapse.active || flight.active || drive.active) { /* Geist, Zeitraffer, Flugzeug oder Auto führen die Kamera */ } else if (camAnim) {
    camAnim.t = Math.min(1, camAnim.t + dt / 1.2);
    const k = 1 - Math.pow(1 - camAnim.t, 3);
    stage.controls.target.lerpVectors(camAnim.fromT, camAnim.toT, k);
    stage.camera.position.lerpVectors(camAnim.fromP, camAnim.toP, k);
    if (camAnim.t >= 1) camAnim = null;
  } else if (app.followId) {
    const p = people.pos.get(app.followId);
    if (p) {
      const tgt = new THREE.Vector3(p[0], p[1], p[2]);
      const delta = tgt.clone().sub(stage.controls.target).multiplyScalar(0.06);
      stage.controls.target.add(delta); stage.camera.position.add(delta);
    }
  }
  const tg = stage.controls.target;
  if (!ghost.active && !timelapse.active && !interior.active && !flight.active && !drive.active) keyCamera(dt, tg);
  if (!ghost.active && !timelapse.active && !flight.active && !drive.active) {
    tg.x = Math.max(-NX / 2 + 4, Math.min(NX / 2 - 4, tg.x)); tg.z = Math.max(-NY / 2 + 4, Math.min(NY / 2 - 4, tg.z));
    // Erde: der Drehpunkt folgt dem Boden (Gebirge bis über 50 hoch), die Kamera bleibt über dem Fels
    if (EARTH_MODE) { const gy = Math.max(0, groundY(tg.x, tg.z)); tg.y += (gy - tg.y) * Math.min(1, dt * 4); }
    else tg.y = Math.max(0, Math.min(3, tg.y));
    stage.controls.update();
    if (EARTH_MODE) { const c = stage.camera.position, gy = Math.max(0, groundY(c.x, c.z)) + 1.2; if (c.y < gy) c.y = gy; }
  }
  const [sx, sz] = fx.applyShake(dt);
  stage.camera.position.x += sx; stage.camera.position.z += sz;
  // Tilt Shift folgt dem Zoom: nah stärker, fern sanft
  const dist = stage.camera.position.distanceTo(tg);
  stage.grade.uniforms.blur.value = stage.quality === 'niedrig' ? 0 : ghost.active ? 0.12 : flight.active ? 0.1 : drive.active ? 0.14 : THREE.MathUtils.clamp(1.4 - dist / 160, 0.35, 1.2);
  stage.grade.uniforms.time.value = clock;
  // Schärfentiefe (seit 24.10.2026): scharf in der Entfernung des Blickziels, Blende folgt der alten Tilt Shift Stärke
  stage.grade.uniforms.focusZ.value = dist;
  stage.grade.uniforms.aperture.value = stage.grade.uniforms.blur.value * 0.85;
  if (app.mapOpen) worldMap.frame(dt); // die Karte deckt alles zu: kein 3D Bild nötig
  else if (app.collectionOpen) { /* Modell-Sammlung deckt alles zu */ }
  else if (interior.active) interior.render(dt, clock); else stage.composer.render();
  stage.camera.position.x -= sx; stage.camera.position.z -= sz;
  if (!interior.active) updateLabels();
  if (now - lastUi > 250) { lastUi = now; ui.update(st, f); app.sound.update(wxs, night, seasonOf(st.day), st.era); }
}

// ---------- Mit Freund spielen (net/coop.js) ----------
// Welt tauschen, ohne dass die Kamera springt: beim Gastgeber, wenn ein Gast beitritt (er lädt die Welt selbst frisch,
// damit beide im Gleichschritt rechnen), beim Gast mit jedem Schnappschuss. cam: beim ersten Beitreten dorthin schauen,
// wo der Gastgeber gerade schaut.
function swapWorld(st, cam) {
  const pos = stage.camera.position.clone(), tg = stage.controls.target.clone();
  app.st = st;
  initWorld();
  if (cam) { stage.controls.target.set(cam[0], 0.5, cam[1]); stage.camera.position.set(cam[0] + 10, 26, cam[1] + 34); }
  else { stage.camera.position.copy(pos); stage.controls.target.copy(tg); }
  refreshWorld(true);
  ui.renderChron(true); ui.renderLeft();
  ui.update(st, tod(), true);
}
const coopHooks = {
  swapWorld: st => swapWorld(st),
  loadWorld: (st, acc, speed, cam) => { app.acc = acc || 0; app.speed = speed || 1; swapWorld(st, cam); },
  stepOne: light => { stepDay(app.st); onDay(light); },
  refreshWorld: () => refreshWorld(),
  castNet,
  felt: (pid, text) => app.onFelt(pid, text),
};

// Gast: eigenes Startbild, dann wartet die Welt des Gastgebers. Was die eigene Welt verändern würde, geht hier nicht.
async function bootGuest() {
  const status = $('#intro .status'), bar = $('#intro .progress i'), enter = $('#btnEnter');
  for (const s of ['#btnNew', '#btnEarth', '#btnSwitch', '#btnBuild', '#btnModels', '#btnToday']) { const b = $(s); if (b) b.style.display = 'none'; }
  const tag = $('#intro .tag');
  if (tag) tag.textContent = L('Ein Freund hat dich in seine Welt eingeladen.', 'A friend has invited you into their world.');
  const no = () => ui.toast(L('Das geht nur in deiner eigenen Welt. Trenne dich erst vom Gastgeber.', 'That only works in your own world. Leave your host first.'), 'warn');
  for (const k of ['newWorld', 'importSave', 'enterEarth', 'leaveEarth', 'enterLevel', 'leaveLevel']) app[k] = no;
  enter.disabled = true;
  enter.textContent = L('Einen Moment', 'One moment');
  const back = document.createElement('button');
  back.className = 'ghost'; back.id = 'btnCoopBack';
  back.textContent = L('Zurück zu meiner Welt', 'Back to my world');
  back.onclick = () => app.coop.leave();
  const worlds = $('#intro .worlds');
  if (worlds) worlds.append(back);
  if (EARTH_MODE) {
    status.textContent = L('Die Erde wird geladen …', 'Loading the Earth …');
    try { await loadEarth(); } catch (err) { console.error(err); status.textContent = L('Die Erddaten fehlen.', 'The Earth data is missing.'); return; }
  }
  status.textContent = L('Verbinde mit deinem Freund …', 'Connecting to your friend …');
  bar.style.width = '35%';
  let entered = false;
  const go = () => {
    if (entered || !app.st) return;
    entered = true;
    app.sound.start();
    $('#intro').classList.add('gone');
    setTimeout(() => { const v = $('#intro video'); if (v) { v.pause(); v.removeAttribute('src'); v.load(); } }, 1400);
    app.running = true;
    last = performance.now();
  };
  app.enterGame = go;
  enter.onclick = go;
  app.coop.onChange(c => {
    if (entered) return;
    if (c.state === 'joined' && app.st) {
      bar.style.width = '100%';
      status.textContent = L(`Du bist in der Welt von ${c.friend}. Jahr ${Math.floor(app.st.day / D.DAYS_PER_YEAR) + 1}, ${app.st.people.length} Menschen.`, `You are in ${c.friend}'s world. Year ${Math.floor(app.st.day / D.DAYS_PER_YEAR) + 1}, ${app.st.people.length} people.`);
      enter.disabled = false;
      enter.textContent = L('Mitspielen', 'Join in');
      if (new URLSearchParams(location.search).has('auto')) go();
    } else if (c.state === 'linking' || c.state === 'lost') {
      status.textContent = L('Verbinde mit deinem Freund …', 'Connecting to your friend …');
    } else if (c.state === 'ended') {
      status.textContent = c.endMsg || c.error || '';
      enter.disabled = false;
      enter.textContent = L('Zurück zu meiner Welt', 'Back to my world');
      enter.onclick = () => c.leave();
    }
  });
  app.coop.startGuest(JOIN);
}

// ---------- Start ----------
async function boot() {
  if (globalThis.PFR_REDIRECT) return; // Erde heute läuft auf heute.html
  // ohne gespeicherte Wahl startet ein Handy auf "mittel" (ohne Umgebungsverdeckung, etwas feiner gerendert)
  try { const q = localStorage.getItem('biu.quality'); if (q) stage.setQuality(q); else if (TOUCH) stage.setQuality('mittel'); } catch { if (TOUCH) stage.setQuality('mittel'); }
  ui = new UI(app);
  app.ui = ui;
  if (!CINE) new Editor(app);
  initVoice(app);
  app.coop = new Coop(app, coopHooks);
  initCoopUI(app);
  if (JOIN) { bootGuest(); return; }
  heartbeat();
  setInterval(heartbeat, 2000);
  const status = $('#intro .status'), bar = $('#intro .progress i');
  status.textContent = EARTH_MODE ? L('Die Erde wird geladen …', 'Loading the Earth …') : L('Die Insel wird gesucht …', 'Searching for the island …');
  if (EARTH_MODE) {
    try { await loadEarth(); } catch (err) {
      console.error(err);
      status.textContent = L('Die Erddaten fehlen. Zurück zur Inselwelt …', 'The Earth data is missing. Back to the island world …');
      setTimeout(() => app.leaveEarth(), 2500);
      return;
    }
  }
  let newEarth = false;
  try { newEarth = EARTH_MODE && !!sessionStorage.getItem('pfr.newEarth'); } catch { /* egal */ }
  const [local, server0] = [newEarth ? null : localLoad(), await serverLoad()];
  const server = newEarth ? null : server0;
  let saved = local;
  if (server && (!local || (server.savedAt || 0) > (local.savedAt || 0))) saved = server;
  let info = null;
  if (saved) {
    try {
      app.st = deserialize(saved);
      const away = (Date.now() - (app.st.savedAt || Date.now())) / 1000;
      status.textContent = L('Die Zeit holt dich ein …', 'Time is catching up with you …');
      info = await catchUp(app.st, away, (k, st) => { bar.style.width = (k * 100).toFixed(1) + '%'; status.textContent = L(`Auf der Insel vergeht die Zeit … Jahr ${Math.floor(st.day / D.DAYS_PER_YEAR) + 1}`, `Time passes on the island … Year ${Math.floor(st.day / D.DAYS_PER_YEAR) + 1}`); });
    } catch (err) {
      app.st = null;
      app.oldWorld = (saved.v || 1) < D.WORLD_VERSION;
      if (app.oldWorld) console.info('Alter Spielstand mit einer Insel, eine neue Archipel Welt entsteht.'); else console.error(err);
      status.textContent = app.oldWorld ? L('Die Welt ist gewachsen: aus einer Insel wird ein Archipel. Eine neue Welt entsteht.', 'The world has grown: one island becomes an archipelago. A new world is born.') : L('Der alte Spielstand ließ sich nicht lesen. Eine neue Insel entsteht.', 'The old save could not be read. A new island is born.');
    }
  }
  // Erde ohne Spielstand: die Welt entsteht erst nach der Wahl des Startorts (newEarthFlow)
  const pickEarth = EARTH_MODE && !app.st;
  // Level-Welt ohne Stand: ein Entwurf aus dem Baukasten oder eine neue Insel als Vorlage
  if (!app.st && LEVEL_MODE) {
    try { const d = localStorage.getItem(DRAFT); if (d) app.st = deserialize(d); } catch { app.st = null; }
    if (!app.st) app.st = newLevel('insel', (Date.now() ^ (Math.random() * 1e9)) >>> 0);
    app.acc = 0;
  }
  if (!app.st && !EARTH_MODE) { app.st = createWorld((Date.now() ^ (Math.random() * 1e9)) >>> 0); app.acc = 0; }
  bar.style.width = '100%';
  if (app.st) {
    initWorld();
    refreshWorld(true);
    ui.renderChron(true);
    ui.update(app.st, tod(), true);
    save(true);
    if (EARTH_MODE) try { localStorage.setItem('pfr.hasEarth', '1'); } catch { /* egal */ }
  }
  const fresh = !saved || app.oldWorld;
  const yearTxt = () => L(`Jahr ${Math.floor(app.st.day / D.DAYS_PER_YEAR) + 1}. ${app.st.people.length} Menschen leben auf ${EARTH_MODE ? 'der Erde' : 'deiner Insel'}.`, `Year ${Math.floor(app.st.day / D.DAYS_PER_YEAR) + 1}. ${app.st.people.length} ${app.st.people.length === 1 ? 'person lives' : 'people live'} on ${EARTH_MODE ? 'Earth' : 'your island'}.`);
  status.textContent = pickEarth ? L('Die echte Erde wartet. Du wählst, wo dein Volk beginnt.', 'The real Earth awaits. You choose where your people begin.') : fresh ? L('Eine unberührte Insel wartet.', 'An untouched island awaits.') : yearTxt();
  const enter = $('#btnEnter');
  enter.disabled = false;
  enter.textContent = pickEarth ? L('Wähle deinen Ort', 'Choose your place') : fresh ? L('Erwecke die Insel', 'Awaken the island') : L('Weiterspielen', 'Continue');
  $('#btnNew').style.display = fresh || EARTH_MODE ? 'none' : '';
  // Welten wechseln: neue Erde, zur Erde (wenn es eine gibt), zurück zur Inselwelt
  const bEarth = $('#btnEarth'), bSwitch = $('#btnSwitch');
  if (bEarth) {
    bEarth.style.display = pickEarth ? 'none' : '';
    bEarth.textContent = EARTH_MODE ? L('Neue Erde beginnen', 'Begin a new Earth') : L('Neue Welt: Erde', 'New World: Earth');
    bEarth.onclick = () => (EARTH_MODE ? ui.modal(`<h2>${L('Eine neue Erde?', 'A new Earth?')}</h2><p>${L('Die jetzige Erde mit all ihren Völkern verschwindet. Deine Inselwelt bleibt, wie sie ist.', 'The current Earth with all its peoples will vanish. Your island world stays as it is.')}</p>`, [[L('Ja, neue Erde', 'Yes, new Earth'), () => app.enterEarth(true)], [L('Abbrechen', 'Cancel'), null]]) : app.enterEarth(true));
  }
  if (bSwitch) {
    let hasEarth = false;
    try { hasEarth = !!localStorage.getItem('pfr.hasEarth') || !!localStorage.getItem('builtitup.earth.v1'); } catch { /* egal */ }
    if (!EARTH_MODE && !hasEarth && app.serverSync) { try { const r = await fetch('api/erde', { method: 'HEAD', cache: 'no-store' }); hasEarth = r.status === 200; } catch { /* egal */ } }
    bSwitch.style.display = EARTH_MODE || hasEarth ? '' : 'none';
    bSwitch.textContent = EARTH_MODE ? L('Zur Inselwelt', 'To the island world') : L('Zur Erde', 'To the Earth');
    bSwitch.onclick = () => (EARTH_MODE ? app.leaveEarth() : app.enterEarth(false));
  }
  if (EARTH_MODE) { const tag = $('#intro .tag'); if (tag) tag.textContent = L('Du bist der Geist der Erde.', 'You are the spirit of the Earth.'); }
  const go = () => {
    app.sound.start();
    $('#intro').classList.add('gone');
    // Startbild Video anhalten, sobald es ausgeblendet ist (spart Grafikkarte)
    setTimeout(() => { const v = $('#intro video'); if (v) { v.pause(); v.removeAttribute('src'); v.load(); } }, 1400);
    app.running = true;
    last = performance.now();
    lastWall = Date.now();
    const q = new URLSearchParams(location.search);
    if (pickEarth) {
      // Tests (?erde&auto): ohne Menü eine Erde anlegen, Start in Asni oder ?start=x,y
      if (q.has('auto')) {
        const [sx, sy] = (q.get('start') || `${EARTH.meta.start.x},${EARTH.meta.start.y}`).split(',').map(Number);
        const c = startCheck(sx, sy);
        if (c.ok) { app.createEarth(c.x, c.y); return; }
      }
      app.running = false; setTimeout(() => newEarthFlow(app), 300); return;
    }
    if (info && info.days > 4) setTimeout(() => ui.welcomeBack(info), 700);
    // Neue Insel: Einführungsvideo, wer du bist, Leben wählen, Tutorial. Sonst ein angefangenes Tutorial fortsetzen.
    if (LEVEL_MODE) return; // eigene Level: kein Einführungsfilm, keine Figurenwahl, kein Tutorial
    if ((fresh || app.pickHero) && !CINE && !q.has('auto')) { app.pickHero = false; setTimeout(() => newGameFlow(app, !q.has('notrailer')), 300); }
    else if (!CINE && !q.has('auto')) setTimeout(() => startTour(app, true), 2500);
  };
  enter.onclick = go;
  app.enterGame = () => { if (!$('#intro').classList.contains('gone')) go(); };
  app.coop.resume(); // nach einem Neuladen weiter Gastgeber sein, der Gast verbindet sich von selbst neu
  $('#btnNew').onclick = () => { app.newWorld(); info = null; go(); };
  // Baukasten: im Startbild für alle Welten; in der Level-Welt öffnet er sich gleich, wenn man von dort kam oder nichts läuft
  const bBuild = $('#btnBuild');
  if (bBuild) {
    bBuild.style.display = EARTH_MODE ? 'none' : '';
    bBuild.textContent = LEVEL_MODE ? L('Baukasten öffnen', 'Open the level editor') : L('Baukasten', 'Level Editor');
    bBuild.onclick = () => (LEVEL_MODE ? (go(), app.editor.open()) : app.enterLevel());
  }
  if (LEVEL_MODE) {
    editorButton(app);
    if (bSwitch) { bSwitch.style.display = ''; bSwitch.textContent = L('Zur Inselwelt', 'To the island world'); bSwitch.onclick = () => app.leaveLevel(); }
    if (bEarth) bEarth.style.display = 'none';
    $('#btnNew').style.display = 'none';
    const tag = $('#intro .tag'); if (tag) tag.textContent = L('Deine eigene Welt aus dem Baukasten.', 'Your own world from the level editor.');
    let edit = false;
    try { edit = !!sessionStorage.getItem('pfr.edit'); sessionStorage.removeItem('pfr.edit'); } catch { /* egal */ }
    if (edit || !saved || !(app.st.level && app.st.people.length)) { go(); app.editor.open(); return; }
  }
  const tb = $('#btnIntro');
  if (tb) tb.onclick = () => { app.sound.start(); playTrailer(); };
  // Modell-Sammlung (seit 24.10.2026, ui/collection.js): alle Modelle und Texturen in Kategorien, erst beim Klick geladen
  const bModels = $('#btnModels');
  if (bModels) bModels.onclick = () => import('./ui/collection.js').then(m => m.openCollection(app));
  if (new URLSearchParams(location.search).has('auto')) go();
}

// Einführungsvideo aus dem Menü
app.showTrailer = () => playTrailer();
setInterval(() => { if (app.st) storyTick(app); }, 1000);

// Beim Verstecken oder Schließen speichern und die Insel für andere Geräte freigeben
document.addEventListener('visibilitychange', () => { if (document.hidden) save(true, true); });
window.addEventListener('pagehide', () => {
  save(true, true);
  if (app.serverSync && navigator.sendBeacon) navigator.sendBeacon('api/lease?tab=' + encodeURIComponent(TAB), '');
});
$('#takeover').onclick = () => {
  try { localStorage.setItem(LOCK, JSON.stringify({ id: TAB, t: Date.now() })); sessionStorage.setItem('biu.force', '1'); } catch { /* egal */ }
  location.reload();
};
try { if (sessionStorage.getItem('biu.force')) { app.forceSave = true; sessionStorage.removeItem('biu.force'); } } catch { /* egal */ }

requestAnimationFrame(frame);
boot();
