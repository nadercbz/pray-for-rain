// Blick ins Haus: ein Klick auf ein Haus wechselt in eine Puppenhaus-Ansicht. Ein Zimmer im Tiny Glade Stil,
// eingerichtet nach Epoche, Reichtum und Bewohnern: Feuerstelle oder Kamin, Betten für alle, Tisch, Truhen,
// Werkzeug je Beruf, bei Reichen Teppiche und Bilder, später Bücher, Uhr, Radio, Sofa, Fernseher.
// Die Menschen im Zimmer sind genau die Bewohner, die laut Tagesablauf (schedule.js) gerade daheim sind, mit denselben
// Figuren, Farben und Kopfbedeckungen wie draußen. Sie kommen zur Tür herein, gehen zu ihrem Platz und tun, was zur
// Stunde passt: schlafen unter der Decke, frühstücken, kochen, essen und trinken, erzählen, dösen im Sessel, spielen
// im Schneidersitz, beten, lesen, basteln. Wer zur Arbeit geht, läuft zur Tür hinaus. Werkstätten, Schulen (mit den
// Kindern, die gerade Unterricht haben), Heilerhäuser (mit den Kranken), Schreine und Theater haben eigene Räume.
// Die Wände zur Kamera hin werden ausgeblendet, man kann um das Zimmer herum schauen (Maus ziehen, Rad zoomt).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as D from '../sim/data.js';
import { L } from '../i18n.js';
import { loadVillagers, drawPerson, figureScale, figFor } from './people.js';
import { plan, prep, doing } from './schedule.js';

const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const C = h => new THREE.Color(h);
const PLASTER = ['#efd9c4', '#f0dcb8', '#ecd2a6', '#d8dfc4', '#d4e0e6', '#f3d6c9', '#efe5d1', '#ead0c6'];
const WALLPAPER = ['#cfe0d6', '#f0d9c8', '#d9d4ea', '#f2e3b8', '#cde0ea'];
const BLANKET = ['#c7604a', '#5f8fb0', '#d9a53a', '#7c9c62', '#b07ab8', '#e08a72', '#6f8f8a'];
const WOOD = '#9b7450', WOODL = '#b9895c', WOODD = '#6e4f36', STONE = '#cfc3b0', IRON = '#5a5a60';
const MAXP = 16; // so viele Menschen zeigt ein Raum
const BODY = 1.72; // Körpergröße im Zimmer
const SEAT_Y = 0.255; // Gesäßhöhe der Sitz-Animationen (Anteil der Körpergröße)
const SITTING = new Set(['sit', 'drink', 'talksit', 'doze']);
const H_CURTAIN = 2.4;
// Was man an einem Arbeitsplatz drinnen tut (für die Namensliste)
const WORKING = { teach: L('unterrichtet', 'teaching'), heal: L('pflegt Kranke', 'tending the sick'), sick: L('liegt im Krankenbett', 'in a sickbed'), sit: L('lernt', 'learning'),
  hammer: L('arbeitet', 'working'), pray: L('betet', 'praying'), read: L('forscht', 'studying'), cheer: L('probt', 'rehearsing') };

// Kleiner Baukasten: alles wird in Farbgeometrien gesammelt und am Ende zu wenigen Meshes verschmolzen
class Room {
  constructor(seed) { this.parts = []; this.glow = []; this.seed = seed; this.n = 0; }
  rnd() { return hash(this.seed * 131 + this.n++, this.seed); }
  add(g, c, glow) {
    g = g.index ? g.toNonIndexed() : g;
    if (g.attributes.uv) g.deleteAttribute('uv');
    const col = C(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    (glow ? this.glow : this.parts).push(g);
    return g;
  }
  box(w, h, d, x, y, z, c, ry = 0, glow = false) { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y + h / 2, z); return this.add(g, c, glow); }
  cyl(rt, rb, h, x, y, z, c, seg = 10, glow = false) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y + h / 2, z), c, glow); }
  ball(r, x, y, z, c, sx = 1, sy = 1, sz = 1, glow = false) { return this.add(new THREE.SphereGeometry(r, 10, 7).scale(sx, sy, sz).translate(x, y, z), c, glow); }
  cone(r, h, x, y, z, c, seg = 8, glow = false) { return this.add(new THREE.ConeGeometry(r, h, seg).translate(x, y + h / 2, z), c, glow); }
  // Teile einer kleinen Gruppe drehen und verschieben
  put(k, x, z, ry) { for (const p of k.parts) { p.rotateY(ry); p.translate(x, 0, z); this.parts.push(p); } for (const p of k.glow) { p.rotateY(ry); p.translate(x, 0, z); this.glow.push(p); } }
  // Möbel ----------------------------------------------------------------
  table(x, z, w, d, era, rich) {
    const top = era >= 6 ? '#c9a27a' : rich ? WOODL : WOOD;
    this.box(w, 0.06, d, x, 0.72, z, top);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.box(0.07, 0.72, 0.07, x + sx * (w / 2 - 0.08), 0, z + sz * (d / 2 - 0.08), WOODD);
    if (rich && era >= 2) this.box(w * 0.9, 0.01, d * 0.5, x, 0.785, z, '#efe6d6');
  }
  bench(x, z, w, ry = 0) { this.box(w, 0.05, 0.32, x, 0.42, z, WOOD, ry); for (const s of [-1, 1]) this.box(0.06, 0.42, 0.26, x + Math.cos(ry) * s * (w / 2 - 0.1), 0, z - Math.sin(ry) * s * (w / 2 - 0.1), WOODD, ry); }
  chair(x, z, ry, c = WOOD) {
    const k = new Room(1);
    k.box(0.42, 0.05, 0.42, 0, 0.42, 0, c); k.box(0.42, 0.5, 0.05, 0, 0.47, -0.2, c);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.05, 0.42, 0.05, sx * 0.17, 0, sz * 0.17, WOODD);
    this.put(k, x, z, ry);
  }
  // Sessel (ab Renaissance gepolstert, sonst Lehnstuhl aus Holz), Blick nach +z
  armchair(x, z, ry, era, rich) {
    const k = new Room(2);
    const cloth = rich ? '#b0475a' : era >= 6 ? '#7f9fb0' : '#a8794f';
    if (era >= 4) {
      k.box(0.7, 0.4, 0.66, 0, 0.04, 0, cloth); k.box(0.7, 0.55, 0.14, 0, 0.4, -0.26, cloth);
      for (const s of [-1, 1]) k.box(0.12, 0.22, 0.62, s * 0.3, 0.4, 0, cloth);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.05, 0.05, 0.05, sx * 0.28, 0, sz * 0.26, WOODD);
    } else {
      k.box(0.56, 0.06, 0.5, 0, 0.4, 0, WOODL); k.box(0.56, 0.62, 0.06, 0, 0.44, -0.23, WOOD);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.06, 0.4, 0.06, sx * 0.24, 0, sz * 0.2, WOODD);
      k.box(0.5, 0.04, 0.46, 0, 0.46, 0.01, '#d9c49a');
    }
    this.put(k, x, z, ry);
  }
  // Wiege auf Kufen für die Kleinsten
  cradle(x, z, ry, color) {
    const k = new Room(7);
    k.box(0.5, 0.3, 0.85, 0, 0.12, 0, WOODL); k.box(0.44, 0.06, 0.78, 0, 0.38, 0, '#f4ecdf'); k.box(0.46, 0.05, 0.5, 0, 0.42, 0.12, color);
    for (const s of [-1, 1]) k.add(new THREE.TorusGeometry(0.42, 0.03, 5, 14, Math.PI).rotateY(Math.PI / 2).rotateX(Math.PI).translate(s * 0.2, 0.44, 0), WOODD);
    k.box(0.5, 0.42, 0.05, 0, 0.12, -0.42, WOOD);
    this.put(k, x, z, ry);
    return 0.42;
  }
  // Kräuterbündel, Pfannen, Besen, Eimer: das Leben in der Küche
  kitchen(x, z, ry, era) {
    const k = new Room(8);
    if (era <= 5) {
      k.box(1.1, 0.04, 0.04, 0, 1.95, 0.02, WOODD);
      for (let i = 0; i < 4; i++) { k.cyl(0.005, 0.005, 0.12, -0.4 + i * 0.27, 1.83, 0.04, '#7a6a50', 4); k.cone(0.07, 0.24, -0.4 + i * 0.27, 1.6, 0.04, ['#7fae5c', '#a8b86a', '#c9a36a', '#8a9f5c'][i], 6); }
      for (let i = 0; i < 2; i++) { k.cyl(0.13 - i * 0.03, 0.13 - i * 0.03, 0.03, 0.75 + i * 0.3, 1.45, 0.08, IRON, 12); k.box(0.03, 0.18, 0.02, 0.75 + i * 0.3, 1.45 + 0.13, 0.08, IRON); }
    }
    k.cyl(0.16, 0.13, 0.28, -0.75, 0, 0.25, era >= 6 ? '#9fb3c0' : WOOD, 12); k.cyl(0.14, 0.14, 0.01, -0.75, 0.25, 0.25, '#6fa3c9', 12);
    k.add(new THREE.CylinderGeometry(0.015, 0.015, 1.1, 5).rotateZ(-0.18).translate(1.05, 0.55, 0.12), WOODL);
    k.add(new THREE.ConeGeometry(0.12, 0.3, 7).translate(0.95, 0.12, 0.12), '#d9c08a');
    this.put(k, x, z, ry);
  }
  stool(x, z, c = WOODL) { this.cyl(0.2, 0.22, 0.42, x, 0, z, c, 10); }
  bed(x, z, ry, era, rich, color, double) {
    const k = new Room(this.seed + x * 10);
    const w = double ? 1.5 : 0.95;
    if (era <= 1) {
      k.box(w, 0.16, 1.9, 0, 0, 0, '#d8bd7c'); // Strohlager
      k.box(w * 0.92, 0.06, 1.3, 0, 0.16, 0.25, color);
      k.box(w * 0.7, 0.08, 0.3, 0, 0.16, -0.75, '#efe3c9');
    } else {
      const frame = rich ? WOODL : WOOD;
      k.box(w + 0.08, 0.32, 2.0, 0, 0, 0, frame);
      k.box(w + 0.08, 0.75, 0.08, 0, 0, -1.0, WOODD);
      if (era >= 3) k.box(w + 0.08, 0.5, 0.08, 0, 0, 1.0, WOODD);
      k.box(w, 0.16, 1.9, 0, 0.32, 0, '#f4ecdf');
      k.box(w + 0.02, 0.1, 1.35, 0, 0.44, 0.28, color);
      for (let i = 0; i < (double ? 2 : 1); i++) k.box(0.42, 0.11, 0.28, double ? (i ? 0.33 : -0.33) : 0, 0.48, -0.75, '#fbf6ec');
      if (rich && era >= 4 && era <= 5) { for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(0.03, 0.03, 1.7, sx * (w / 2 + 0.03), 0, sz * 0.98, WOODD, 6); k.box(w + 0.15, 0.04, 2.05, 0, 1.7, 0, '#b0475a'); }
    }
    this.put(k, x, z, ry);
    return era <= 1 ? 0.22 : 0.48; // Liegehöhe
  }
  mat(x, z, ry, color) { const k = new Room(3); k.box(0.85, 0.07, 1.9, 0, 0, 0, '#d8bd7c'); k.box(0.7, 0.05, 0.28, 0, 0.07, -0.72, '#efe3c9'); k.box(0.8, 0.04, 1.2, 0, 0.07, 0.3, color); this.put(k, x, z, ry); return 0.1; }
  chest(x, z, ry, c = WOOD) { this.box(0.8, 0.45, 0.45, x, 0, z, c, ry); this.box(0.82, 0.08, 0.47, x, 0.45, z, WOODD, ry); this.box(0.12, 0.1, 0.02, x + Math.sin(ry) * 0.235, 0.36, z + Math.cos(ry) * 0.235, '#c9a03c', ry); }
  shelf(x, y, z, w, ry, items) {
    this.box(w, 0.04, 0.28, x, y, z, WOODD, ry);
    for (let i = 0; i < items; i++) {
      const t = (i + 0.5) / items - 0.5, px = x + Math.cos(ry) * t * w * 0.9, pz = z - Math.sin(ry) * t * w * 0.9;
      const r = this.rnd();
      if (r < 0.45) this.cyl(0.06, 0.07, 0.16 + r * 0.1, px, y + 0.04, pz, ['#c98f5a', '#7f9fb0', '#d9c6a0', '#a9603f'][i % 4]);
      else if (r < 0.75) this.box(0.05, 0.22, 0.16, px, y + 0.04, pz, ['#8a3b3b', '#3b5a8a', '#4f7a4a', '#b08a3a'][i % 4], ry);
      else this.ball(0.07, px, y + 0.11, pz, '#e3d2b0');
    }
  }
  // Werkbank mit Werkzeug, Blick der arbeitenden Person nach +z
  workbench(x, z, ry) {
    const k = new Room(4);
    k.box(1.3, 0.08, 0.6, 0, 0.82, 0.45, WOODL);
    for (const sx of [-1, 1]) for (const sz of [0.2, 0.7]) k.box(0.07, 0.82, 0.07, sx * 0.58, 0, sz, WOODD);
    k.box(0.36, 0.1, 0.22, -0.3, 0.9, 0.45, '#c9a36a'); k.box(0.05, 0.04, 0.3, 0.2, 0.9, 0.4, IRON); k.box(0.12, 0.08, 0.06, 0.2, 0.92, 0.27, WOODD);
    for (let i = 0; i < 4; i++) k.box(0.04, 0.32, 0.03, -0.45 + i * 0.3, 1.3, 0.76, i % 2 ? IRON : WOODD);
    this.put(k, x, z, ry);
  }
  // Schreibpult an der Wand mit Buch und Kerze, Stuhl davor, Blick nach +z
  desk(x, z, ry, era) {
    const k = new Room(5);
    k.box(1.0, 0.05, 0.55, 0, 0.74, 0.5, WOODL);
    for (const sx of [-1, 1]) k.box(0.06, 0.74, 0.5, sx * 0.45, 0, 0.5, WOODD);
    k.box(0.36, 0.04, 0.26, 0, 0.79, 0.42, '#efe6d6'); k.box(0.02, 0.05, 0.26, 0, 0.8, 0.42, '#8a3b3b');
    for (let i = 0; i < 4; i++) k.box(0.06, 0.24, 0.18, 0.3 + i * 0.05, 0.79, 0.62, ['#8a3b3b', '#3b5a8a', '#4f7a4a', '#b08a3a'][i]);
    if (era < 6) { k.cyl(0.025, 0.025, 0.14, -0.35, 0.79, 0.6, '#f4ecd8', 6); k.ball(0.025, -0.35, 0.96, 0.6, '#ffd27a', 1, 1.6, 1, true); }
    else { k.cyl(0.02, 0.02, 0.4, -0.35, 0.79, 0.62, IRON, 6); k.cone(0.12, 0.12, -0.35, 1.13, 0.62, '#f2e3b8', 10, true); }
    k.box(0.42, 0.05, 0.42, 0, 0.42, 0, WOODD); k.box(0.42, 0.5, 0.05, 0, 0.47, -0.2, WOODD);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.05, 0.42, 0.05, sx * 0.17, 0, sz * 0.17, WOODD);
    this.put(k, x, z, ry);
  }
  // Hausaltar: Brett mit Kerzen und Figur, Blick der Betenden nach +z
  altar(x, z, ry) {
    const k = new Room(6);
    k.box(0.7, 0.05, 0.3, 0, 1.0, 0.72, WOODD); k.box(0.7, 0.04, 0.26, 0, 0.6, 0.72, WOODD);
    k.ball(0.12, 0, 1.17, 0.74, '#e9b44c', 1, 1.3, 1, true);
    for (const s of [-1, 1]) { k.cyl(0.025, 0.025, 0.14, s * 0.25, 1.05, 0.7, '#f4ecd8', 6); k.ball(0.025, s * 0.25, 1.22, 0.7, '#ffd27a', 1, 1.6, 1, true); }
    k.box(0.6, 0.02, 0.5, 0, 0, 0.1, '#b0475a');
    this.put(k, x, z, ry);
  }
  barrel(x, z, s = 1) { this.cyl(0.24 * s, 0.22 * s, 0.6 * s, x, 0, z, WOOD, 12); for (const y of [0.1, 0.48]) this.cyl(0.245 * s, 0.245 * s, 0.03, x, y * s, z, IRON, 12); }
  sack(x, z) { this.ball(0.22, x, 0.2, z, '#d9c49a', 1, 1.1, 0.9); this.ball(0.08, x, 0.45, z, '#c9b48a'); }
  rug(x, z, w, d, c1, c2) { this.box(w, 0.015, d, x, 0, z, c1); this.box(w * 0.8, 0.017, d * 0.75, x, 0, z, c2); this.box(w * 0.5, 0.019, d * 0.4, x, 0, z, c1); }
  painting(x, y, z, ry, c) { this.box(0.7, 0.55, 0.04, x, y, z, '#c9a03c', ry); this.box(0.6, 0.45, 0.045, x, y + 0.05, z, c, ry); }
  candle(x, y, z) { this.cyl(0.025, 0.025, 0.14, x, y, z, '#f4ecd8', 6); this.ball(0.025, x, y + 0.17, z, '#ffd27a', 1, 1.6, 1, true); }
  plant(x, z, h = 0.7) { this.cyl(0.14, 0.11, 0.28, x, 0, z, '#c4704f', 10); for (let i = 0; i < 6; i++) this.ball(0.13, x + Math.cos(i) * 0.08, 0.32 + h * 0.4 + (i % 3) * 0.1, z + Math.sin(i) * 0.08, ['#7fae5c', '#6a9a4e', '#8fbf6c'][i % 3]); }
  window(x, z, ry, night, era) {
    // Fensterrahmen in der Wand, Scheibe leuchtet bei Tag hell, nachts dunkelblau
    const w = era >= 6 ? 1.1 : 0.8, h = era >= 6 ? 1.2 : 0.9, y = 1.0;
    this.box(w + 0.12, h + 0.12, 0.08, x, y - 0.06, z, '#f5efe2', ry);
    this.box(w, h, 0.09, x, y, z, night ? '#2b3b58' : '#cfe6f2', ry, !night);
    this.box(0.05, h, 0.1, x, y, z, '#f5efe2', ry);
    this.box(w, 0.05, 0.1, x, y + h / 2 - 0.02, z, '#f5efe2', ry);
    // Blumenkasten innen auf der Fensterbank
    const nx = -Math.sin(ry) * 0.12, nz = -Math.cos(ry) * 0.12;
    this.box(w + 0.1, 0.05, 0.22, x + nx, y - 0.1, z + nz, '#e9dcc4', ry);
    for (let i = 0; i < 3; i++) this.ball(0.06, x + nx + Math.cos(ry) * (i - 1) * 0.22, y - 0.0, z + nz - Math.sin(ry) * (i - 1) * 0.22, ['#e0679a', '#f2c14e', '#b98be0'][i]);
  }
  fire(x, z) {
    for (let i = 0; i < 9; i++) this.ball(0.1, x + Math.cos(i * 0.7) * 0.42, 0.06, z + Math.sin(i * 0.7) * 0.42, '#9a948a', 1, 0.7, 1);
    for (let i = 0; i < 4; i++) this.box(0.6, 0.06, 0.07, x, 0.04 + i * 0.02, z, '#5a3e2a', i * 0.8);
    this.cone(0.18, 0.42, x, 0.08, z, '#ffb347', 6, true); this.cone(0.1, 0.3, x + 0.06, 0.08, z, '#ffd27a', 6, true);
    // Dreibein mit Kessel
    for (let i = 0; i < 3; i++) { const a = i * 2.09; this.add(new THREE.CylinderGeometry(0.02, 0.02, 1.3, 5).rotateZ(0.32).rotateY(a).translate(x + Math.cos(a) * 0.2, 0.6, z - Math.sin(a) * 0.2), WOODD); }
    this.ball(0.17, x, 0.62, z, '#3e3a38', 1, 0.8, 1); this.cyl(0.15, 0.15, 0.02, x, 0.7, z, '#c9b48a');
  }
  build() {
    const geo = this.parts.length ? mergeGeometries(this.parts, false) : null;
    const glow = this.glow.length ? mergeGeometries(this.glow, false) : null;
    return { geo, glow };
  }
}

// Platz im Raum: wo man steht oder sitzt (x, z), Blickrichtung ry, Höhe h (Sitzfläche oder Liegefläche)
const spot = (x, z, ry, h = 0) => ({ x, z, ry, h });
const face = (x, z, tx, tz, h = 0) => spot(x, z, Math.atan2(tx - x, tz - z), h);

export class Interior {
  constructor(stage, app) {
    this.stage = stage; this.app = app;
    this.active = false;
    this.scene = new THREE.Scene();
    this.room = null;
    this.roomGroup = new THREE.Group();
    this.scene.add(this.roomGroup);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.yaw = 0.75; this.pitch = 0.62; this.dist = 11;
    this.uTime = { value: 0 };
    this.figs = null;
    this.o = new THREE.Object3D();
    this.state = new Map();
    this.ui = document.createElement('div');
    this.ui.id = 'interiorUI';
    document.body.append(this.ui);
    this.fade = document.createElement('div');
    this.fade.id = 'interiorFade';
    document.body.append(this.fade);
    const css = document.createElement('style');
    css.textContent = `#interiorUI .ipeople { gap: 6px 8px; }
      #interiorUI .plink { display: inline-flex; flex-direction: column; align-items: flex-start; padding: 5px 11px; border-radius: 12px; background: rgba(13,24,31,0.55); border: 1px solid rgba(246,239,226,0.14); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); text-align: left; line-height: 1.2; }
      #interiorUI .plink b { font-size: 12.5px; font-weight: 600; }
      #interiorUI .plink small { font-size: 10.5px; color: rgba(246,239,226,0.7); }
      #interiorUI .plink.here { border-color: rgba(233,180,76,0.75); background: rgba(40,32,18,0.6); }
      #interiorUI .plink.here small { color: #f2d48a; }`;
    document.head.append(css);
    const cv = stage.renderer.domElement;
    let drag = null;
    let down = null;
    cv.addEventListener('pointerdown', e => { if (this.active) { drag = { x: e.clientX, y: e.clientY }; down = { x: e.clientX, y: e.clientY }; } }, true);
    // Klick auf einen Menschen im Zimmer öffnet seine Karte
    cv.addEventListener('pointerup', e => {
      if (!this.active || !down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 6) return;
      const r = cv.getBoundingClientRect(), v = new THREE.Vector3();
      let best = null, bd = 40;
      for (const d of this.drawn || []) {
        v.set(d.x, d.y, d.z).project(this.camera);
        const sx = (v.x + 1) / 2 * r.width + r.left, sy = (1 - v.y) / 2 * r.height + r.top;
        const dd = Math.hypot(sx - e.clientX, sy - e.clientY);
        if (dd < bd) { bd = dd; best = d.p; }
      }
      if (best) this.app.selectPerson(best.id, false);
    }, true);
    window.addEventListener('pointermove', e => { if (!this.active || !drag) return; this.yaw -= (e.clientX - drag.x) * 0.006; this.pitch = Math.max(0.18, Math.min(1.25, this.pitch + (e.clientY - drag.y) * 0.004)); drag = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('pointerup', () => { drag = null; });
    cv.addEventListener('wheel', e => { if (!this.active) return; e.preventDefault(); e.stopImmediatePropagation(); this.dist = Math.max(4, Math.min(22, this.dist * (1 + Math.sign(e.deltaY) * 0.1))); }, { passive: false, capture: true });
    window.addEventListener('keydown', e => { if (this.active && (e.key === 'Escape' || e.key === 'Backspace')) { e.preventDefault(); e.stopImmediatePropagation(); this.close(); } }, true);
  }

  // Dieselben Dorfbewohner wie draußen (gleiche gebackene Animationen, gleiches Umfärben, gleiche Hüte)
  async loadLib() {
    if (this.figs) return this.figs;
    try {
      const figs = await loadVillagers(this.scene, this.uTime, MAXP + 4);
      this.figs = figs;
    } catch { this.figs = []; }
    return this.figs;
  }

  async open(b) {
    const st = this.app.st;
    if (!st || !b || this.opening) return;
    this.opening = true; // solange das Haus lädt, zählt kein weiterer Klick (main.js)
    this.b = b;
    try {
      await this.loadLib();
      this.fade.classList.add('on');
      await new Promise(r => setTimeout(r, 220));
      this.state.clear();
      this.build(st, b);
      this.active = true;
      document.body.classList.add('interior');
      this.yaw = 0.75 + (hash(b.id) - 0.5) * 0.6; this.pitch = 0.66; this.dist = Math.max(this.room.W, this.room.D) * 1.6;
    } finally {
      this.fade.classList.remove('on');
      this.opening = false;
      // Hat das Bauen des Zimmers versagt, die Steuerung draußen nicht gesperrt lassen
      if (!this.active && this.close) { this.active = true; this.close(); }
    }
  }

  close() {
    if (!this.active) return;
    this.fade.classList.add('on');
    setTimeout(() => {
      this.active = false;
      document.body.classList.remove('interior');
      this.ui.innerHTML = '';
      this.fade.classList.remove('on');
    }, 200);
  }

  // Wer gehört in diesen Raum? Haus: alle Bewohner. Arbeitsplatz: Arbeiter, Schulkinder, Kranke beim Heiler.
  castOf(st, b) {
    if (b.t === 'haus' || b.t === 'hochhaus' || b.t === 'zentrum') return st.people.filter(p => p.home === b.id && !p.away);
    const C = prep(st);
    return st.people.filter(p => !p.away && (p.w === b.id || C.school.get(p.id) === b.id || C.heal.get(p.id) === b.id));
  }

  // Das Zimmer bauen ------------------------------------------------------
  build(st, b) {
    const rt = st._rt, s = rt.sById.get(b.s);
    const era = Math.max(0, b.lvl ?? (s ? s.era : 0));
    this.night0 = this.app.night || 0;
    const night = this.night0 > 0.5;
    for (const o of [...this.roomGroup.children]) { this.roomGroup.remove(o); o.geometry?.dispose?.(); }
    const all = this.castOf(st, b);
    this.all = all;
    this.cast = all.slice(0, MAXP);
    this.key = all.map(p => p.id).join(',');
    const residents = this.cast;
    const rich = residents.reduce((m, p) => Math.max(m, p.cls ?? 1), b.own ? (rt.pById.get(b.own)?.cls ?? 1) : 1);
    const isHouse = b.t === 'haus' || b.t === 'hochhaus' || b.t === 'zentrum';
    this.isHouse = isHouse;
    const n = residents.length;
    const W = isHouse ? 6.2 + Math.min(4, n * 0.4) : b.t === 'schule' ? 8.6 : 7.4, Dp = isHouse ? 5.4 + Math.min(2.6, n * 0.25) : 6.4, H = 2.7;
    this.room = { W, D: Dp, H, era };
    const k = new Room(b.id);
    const plaster = era >= 6 ? WALLPAPER[Math.floor(hash(b.id, 3) * WALLPAPER.length)] : PLASTER[Math.floor(hash(b.id, 5) * PLASTER.length)];
    // Boden: Lehm, Dielen, später Parkett oder Fliesen
    const floor = era <= 1 ? '#b08f68' : era >= 6 ? '#c9a27a' : '#a87c56';
    k.box(W, 0.1, Dp, 0, -0.1, 0, floor);
    if (era >= 2) for (let i = 0; i < Math.floor(Dp / 0.25); i++) k.box(W - 0.02, 0.003, 0.012, 0, 0.0, -Dp / 2 + i * 0.25 + 0.12, '#8d6646');
    if (era <= 1) for (let i = 0; i < 50; i++) k.box(0.18, 0.005, 0.02, (k.rnd() - 0.5) * W * 0.9, 0.001, (k.rnd() - 0.5) * Dp * 0.9, '#d8bd7c', k.rnd() * 3);
    // Wände: vier einzelne Meshes, damit die zur Kamera hin verschwinden können
    const walls = [];
    const beam = era >= 2 && era <= 5;
    const mkWall = (w, x, z, ry, nx, nz) => {
      const wk = new Room(b.id + walls.length);
      wk.box(w, H, 0.16, 0, 0, 0, plaster);
      if (beam) { wk.box(w, 0.14, 0.18, 0, H - 0.14, 0, WOODD); wk.box(w, 0.1, 0.18, 0, 0.0, 0, WOODD); for (let i = 1; i < 4; i++) wk.box(0.12, H, 0.18, -w / 2 + i * w / 4, 0, 0, WOODD); }
      else wk.box(w, 0.12, 0.18, 0, 0, 0, era >= 6 ? '#f5efe2' : STONE);
      const g = mergeGeometries(wk.parts, false);
      g.rotateY(ry); g.translate(x, 0, z);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
      m.receiveShadow = true; m.castShadow = true;
      m.userData.n = [nx, nz];
      walls.push(m);
      this.roomGroup.add(m);
      return m;
    };
    mkWall(W, 0, -Dp / 2, 0, 0, -1); mkWall(W, 0, Dp / 2, 0, 0, 1); mkWall(Dp, -W / 2, 0, Math.PI / 2, -1, 0); mkWall(Dp, W / 2, 0, Math.PI / 2, 1, 0);
    this.walls = walls;
    // Tür in der vorderen Wand, dort kommen alle herein und gehen hinaus
    const doorX = isHouse ? W * 0.1 : W * 0.3;
    this.door = { x: doorX, z: Dp / 2 - 0.35 };
    // Fenster und Tür in Wände legen (als eigene Teile, gehen mit der Wand)
    const decorate = (wi, fn) => { const wk = new Room(b.id * 3 + wi); fn(wk); if (!wk.parts.length && !wk.glow.length) return; const { geo, glow } = wk.build(); if (geo) { const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })); m.castShadow = true; walls[wi].add(m); } if (glow) { const gm = new THREE.Mesh(glow, new THREE.MeshBasicMaterial({ vertexColors: true })); walls[wi].add(gm); } };
    decorate(0, wk => { wk.window(-W * 0.25, -Dp / 2 + 0.06, 0, night, era); if (W > 6.5) wk.window(W * 0.22, -Dp / 2 + 0.06, 0, night, era); });
    decorate(2, wk => { wk.window(-W / 2 + 0.06, Dp * 0.1, Math.PI / 2, night, era); });
    decorate(1, wk => { wk.box(0.95, 2.0, 0.1, doorX, 0, Dp / 2 - 0.06, WOODD); wk.box(0.08, 0.08, 0.06, doorX + 0.3, 1.0, Dp / 2 - 0.13, '#c9a03c'); wk.window(-W * 0.3, Dp / 2 - 0.06, Math.PI, night, era); });
    decorate(3, wk => { wk.window(W / 2 - 0.06, -Dp * 0.32, Math.PI / 2, night, era); });
    // Einrichtung nach Gebäudeart, dazu die Plätze für jede Tätigkeit
    const lights = [];
    this.slots = { bed: new Map(), seat: new Map(), floor: [], doze: [], cook: null, craft: null, read: null, pray: null, stand: [], work: [], desk: [], sick: [], teach: null, heal: [] };
    this.duvets = [];
    if (isHouse) this.furnishHouse(k, b, era, rich, residents, lights);
    else this.furnishWork(k, b, era, rich, lights, residents);
    const { geo, glow } = k.build();
    if (geo) { const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })); m.castShadow = true; m.receiveShadow = true; this.roomGroup.add(m); }
    if (glow) this.roomGroup.add(new THREE.Mesh(glow, new THREE.MeshBasicMaterial({ vertexColors: true })));
    // Licht: Tag durchs Fenster, nachts Feuer, Kerzen oder Lampe (wird jedes Bild an die Tageszeit angepasst)
    this.hemi = new THREE.HemisphereLight(C('#fff4e2'), C('#6b5a4a'), 1);
    this.roomGroup.add(this.hemi);
    this.sun = new THREE.DirectionalLight(C('#ffe7c2'), 2);
    this.sun.position.set(-W, 6, -Dp * 1.2); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024); Object.assign(this.sun.shadow.camera, { left: -W, right: W, top: Dp, bottom: -Dp });
    this.sun.shadow.bias = -0.0005;
    this.roomGroup.add(this.sun);
    this.flicker = [];
    this.lamps = [];
    for (const L0 of lights) {
      const pl = new THREE.PointLight(C(L0.c || '#ffb36b'), 1, L0.r || 7, 1.6);
      pl.position.set(L0.x, L0.y, L0.z);
      this.roomGroup.add(pl);
      this.lamps.push([pl, L0.i || 4, !!L0.fl]);
    }
    // Sonnenflecken auf dem Boden unter den Fenstern (nur bei Tag)
    const pg = [];
    const patch = (x, z, ry, w, d) => { const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2); g.rotateY(ry); g.translate(x, 0.014, z); pg.push(g); };
    patch(-W / 2 + 0.85, Dp * 0.1 + 0.25, 0.35, 1.0, 1.25);
    patch(W / 2 - 0.85, -Dp * 0.32 + 0.3, -0.35, 1.0, 1.2);
    this.patches = new THREE.Mesh(mergeGeometries(pg), new THREE.MeshBasicMaterial({ color: C('#ffe9b8'), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.roomGroup.add(this.patches);
    this.lightUp(this.night0);
    this.lastUI = 0;
    this.renderUI(st, b);
  }

  // Licht nach Tageszeit: tags Sonne durchs Fenster, nachts Feuer und Lampen
  lightUp(night) {
    this.hemi.intensity = 0.45 + (1 - night) * 0.7;
    this.sun.color.set(night > 0.5 ? '#8fa4d6' : '#ffe7c2');
    this.sun.intensity = night > 0.5 ? 0.3 : 2.2 * (1 - night * 0.8);
    for (const L0 of this.lamps) L0[3] = L0[1] * (0.4 + night * 0.9);
    this.scene.background = C(night > 0.5 ? '#141c2a' : '#2a2f36');
    if (this.patches) { this.patches.visible = night < 0.45; this.patches.material.opacity = 0.24 * (1 - night * 2); }
  }

  furnishHouse(k, b, era, rich, residents, lights) {
    const { W, D: Dp } = this.room;
    const S = this.slots;
    const blanket = i => BLANKET[Math.floor(hash(b.id, i) * BLANKET.length)];
    // Betten an der Rückwand, Paare teilen eines; wer keinen Platz mehr hat, schläft oben im Etagenbett
    const done = new Set(), groups = [];
    for (const p of residents) {
      if (done.has(p.id)) continue;
      done.add(p.id);
      const pa = p.pa && residents.find(q => q.id === p.pa);
      if (pa && !done.has(pa.id)) { done.add(pa.id); groups.push([p, pa]); } else groups.push([p]);
    }
    let x = -W / 2 + 0.75, gi = 0;
    const zBed = -Dp / 2 + 1.15;
    const singles = [], rest = [];
    const bedFor = (p, b0, i, dbl) => S.bed.set(p.id, { x: b0.x + (dbl ? (i ? 0.33 : -0.33) : 0), z: zBed + 0.06, ry: 0, h: b0.top, side: { x: b0.x + (dbl ? (i ? 1.15 : -1.15) : 0.8), z: zBed + 0.3 }, duvet: b0.duvet });
    const ageOf = p => (this.app.st.day - p.b) / D.DAYS_PER_YEAR;
    for (const g of groups) {
      // Die Kleinsten schlafen in der Wiege
      if (g.length === 1 && ageOf(g[0]) < 2 && x + 0.6 <= W / 2 - 1.9) {
        const cx = x + 0.3, cz = -Dp / 2 + 0.75, c = blanket(gi++);
        const top = k.cradle(cx, cz, 0, c);
        S.bed.set(g[0].id, { x: cx, z: cz - 0.02, ry: 0, h: top, side: { x: cx + 0.5, z: cz + 0.3 }, duvet: this.duvets.length });
        this.duvets.push({ x: cx, z: cz - 0.12, ry: 0, w: 0.36, h: top - 0.04, c, len: 0.45 });
        x += 0.85;
        continue;
      }
      const dbl = g.length === 2, w = dbl ? 1.5 : 0.95;
      if (x + w <= W / 2 - 1.9) {
        const bx = x + w / 2;
        const top = k.bed(bx, zBed, 0, era, rich >= 2, blanket(gi), dbl);
        const b0 = { x: bx, top, duvet: this.duvets.length };
        this.duvets.push({ x: bx, z: zBed, ry: 0, w: dbl ? 1.42 : 0.8, h: top, c: blanket(gi) });
        g.forEach((p, i) => bedFor(p, b0, i, dbl));
        if (!dbl) singles.push(bx);
        x += w + 0.3;
      } else rest.push(...g);
      gi++;
    }
    // Kein Platz mehr: Etagenbetten über den Einzelbetten (Kinder klettern hinauf), sonst Matten vorn rechts
    for (const p of rest) {
      const bx = singles.shift();
      if (bx != null) {
        const top = 1.45, c = blanket(gi++);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.07, 1.62, 0.07, bx + sx * 0.5, 0, zBed + sz * 0.98, WOODD);
        k.box(1.02, 0.12, 2.0, bx, 1.2, zBed, era >= 2 ? WOOD : '#c9a36a'); k.box(0.95, 0.13, 1.9, bx, 1.32, zBed, '#f4ecdf');
        k.box(0.42, 0.1, 0.28, bx, 1.45, zBed - 0.75, '#fbf6ec'); k.box(0.97, 0.06, 1.3, bx, 1.45, zBed + 0.28, c);
        for (let r0 = 0; r0 < 4; r0++) k.box(0.36, 0.04, 0.05, bx + 0.32, 0.3 + r0 * 0.3, zBed + 1.02, WOODL);
        S.bed.set(p.id, { x: bx, z: zBed + 0.06, ry: 0, h: top, side: { x: bx + 0.3, z: zBed + 1.3 }, duvet: this.duvets.length });
        this.duvets.push({ x: bx, z: zBed, ry: 0, w: 0.8, h: top, c });
      } else {
        const mx = W / 2 - 0.7 - (rest.indexOf(p) % 3) * 0.95, mz = Dp / 2 - 1.15;
        const c = blanket(gi++);
        k.mat(mx, mz, Math.PI, c);
        S.bed.set(p.id, { x: mx, z: mz - 0.06, ry: Math.PI, h: 0.08, side: { x: mx, z: mz - 1.2 }, duvet: this.duvets.length });
        this.duvets.push({ x: mx, z: mz, ry: Math.PI, w: 0.72, h: 0.08, c });
      }
    }
    // Feuer: Mitte (früh), Kamin an der Rückwand rechts (später), Herd und Lampe (modern)
    const hx = W / 2 - 1.1, hz = -Dp / 2 + 0.3;
    let fire = null;
    if (era <= 1) {
      fire = { x: W * 0.12, z: Dp * 0.08 };
      k.fire(fire.x, fire.z);
      lights.push({ x: fire.x, y: 0.6, z: fire.z, c: '#ff9a4a', i: 6, r: 9, fl: true });
      S.cook = face(fire.x - 0.75, fire.z - 0.15, fire.x, fire.z);
    } else if (era <= 5) {
      k.box(1.3, 1.25, 0.5, hx, 0, hz + 0.02, STONE); k.box(0.8, 0.62, 0.3, hx, 0.08, hz + 0.14, '#3a2e26');
      k.box(1.42, 0.1, 0.62, hx, 1.25, hz + 0.05, '#bdb09c'); k.box(0.8, 1.35, 0.42, hx, 1.35, hz - 0.02, STONE);
      k.cone(0.16, 0.34, hx - 0.05, 0.12, hz + 0.2, '#ffb347', 6, true); k.cone(0.09, 0.24, hx + 0.12, 0.12, hz + 0.22, '#ffd27a', 6, true);
      k.ball(0.16, hx, 0.38, hz + 0.18, '#3e3a38', 1, 0.8, 1); // Topf über dem Feuer
      for (let i = 0; i < 3; i++) k.box(0.32, 0.06, 0.06, hx - 0.5 + i * 0.05, 0.02 + i * 0.06, hz + 0.45, '#6b4a2e'); // Holzscheite
      lights.push({ x: hx, y: 0.55, z: hz + 0.5, c: '#ff9a4a', i: 6, r: 8, fl: true });
      if (rich >= 2) k.candle(hx - 0.5, 1.31, hz + 0.1), k.candle(hx + 0.5, 1.31, hz + 0.1);
      S.cook = face(hx + 0.1, hz + 1.0, hx, hz);
    } else {
      k.box(1.1, 0.85, 0.6, hx, 0, hz + 0.05, '#e9e4dc'); k.box(1.12, 0.04, 0.62, hx, 0.85, hz + 0.05, '#bfc4c8');
      k.cyl(0.13, 0.13, 0.04, hx - 0.25, 0.89, hz + 0.05, '#4a4a50', 14); k.cyl(0.11, 0.11, 0.14, hx + 0.25, 0.89, hz + 0.05, '#c8553d', 12);
      k.box(1.1, 0.5, 0.35, hx, 1.55, hz - 0.08, '#efe9dc'); // Hängeschrank
      k.cyl(0.03, 0.03, 1.5, -W / 2 + 0.6, 0, Dp / 2 - 0.6, '#7a7a80', 8); k.cone(0.3, 0.3, -W / 2 + 0.6, 1.5, Dp / 2 - 0.6, '#f2e3b8', 12, true);
      lights.push({ x: -W / 2 + 0.6, y: 1.6, z: Dp / 2 - 0.6, c: '#ffe2b0', i: 5, r: 10 });
      lights.push({ x: 0, y: 2.3, z: 0, c: '#fff1d6', i: 3, r: 9 });
      S.cook = face(hx + 0.1, hz + 0.95, hx, hz);
    }
    if (era >= 2) k.kitchen(W / 2 - 0.1, -Dp / 2 + 1.5, -Math.PI / 2, era);
    // Tisch mit Bänken oder Stühlen; in der Frühzeit sitzt man im Kreis um das Feuer
    const n = Math.max(2, residents.length);
    const tx = -W * 0.16, tz = Dp * 0.18, perSide = Math.ceil(n / 2), tw = Math.max(1.2, Math.min(W * 0.48, perSide * 0.62));
    if (era >= 1) {
      k.table(tx, tz, tw, 0.9, era, rich >= 2);
      if (era <= 3) { k.bench(tx, tz - 0.72, tw * 0.95); k.bench(tx, tz + 0.72, tw * 0.95); }
      residents.forEach((p, i) => {
        const side = i % 2, j = Math.floor(i / 2), sx = tx - tw / 2 + (j + 0.5) * tw / perSide;
        const sz = tz + (side ? 0.72 : -0.72);
        if (era >= 4) k.chair(sx, sz, side ? Math.PI : 0, rich >= 2 ? WOODL : WOOD);
        S.seat.set(p.id, spot(sx, sz, side ? Math.PI : 0, 0.47));
      });
      // gedeckter Tisch
      k.ball(0.12, tx - 0.2, 0.86, tz, '#c98f4a', 1.4, 0.7, 1);
      residents.forEach((p, i) => { const se = S.seat.get(p.id); k.cyl(0.09, 0.06, 0.05, se.x, 0.78, tz + (i % 2 ? 0.25 : -0.25), '#e8dcc4', 10); });
      k.candle(tx + 0.05, 0.78, tz);
      lights.push({ x: tx, y: 1.0, z: tz, c: '#ffcf8a', i: 2.2, r: 4.5, fl: true });
    } else {
      const fx = fire ? fire.x : 0, fz = fire ? fire.z : 0;
      residents.forEach((p, i) => { const a = (i / n) * Math.PI * 2 + 0.4; S.seat.set(p.id, face(fx + Math.cos(a) * 1.1, fz + Math.sin(a) * 1.1, fx, fz, 0.02)); S.seat.get(p.id).floor = true; });
    }
    // Sessel am Feuer für die Alten
    if (era >= 2) { const a = face(hx - 0.35, hz + 2.05, hx, hz, 0.46); k.armchair(a.x, a.z, a.ry, era, rich >= 2); S.doze.push(a); const b2 = face(hx + 0.8, hz + 1.6, hx, hz, 0.44); k.stool(b2.x, b2.z); S.doze.push(b2); }
    else if (fire) { const a = face(fire.x + 0.95, fire.z + 0.6, fire.x, fire.z, 0.4); k.box(0.5, 0.4, 0.4, a.x, 0, a.z, '#7a5a3a', a.ry); S.doze.push(a); }
    // Spielecke: Teppich oder Fell, Spielzeug, Plätze im Kreis
    const px = W * 0.1, pz = -Dp * 0.06;
    if (era >= 1) k.rug(px, pz, 1.5, 1.2, rich >= 2 ? '#b0475a' : '#c9a36a', rich >= 2 ? '#e9b44c' : '#e3cfa3');
    else k.box(1.3, 0.02, 1.0, px, 0, pz, '#9c7b56');
    if (residents.some(p => p.job === 'kind')) { k.ball(0.1, px + 0.1, 0.1, pz + 0.05, '#e07a5f'); k.box(0.16, 0.16, 0.16, px - 0.15, 0, pz - 0.08, '#f2c14e', 0.4); k.box(0.12, 0.12, 0.12, px - 0.05, 0, pz + 0.12, '#81b29a', 0.9); }
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3; S.floor.push(face(px + Math.cos(a) * 0.55, pz + Math.sin(a) * 0.48, px, pz)); }
    // Werkbank (vorn rechts), Schreibpult (linke Wand), Hausaltar (hinten rechts)
    const jobs = new Set(residents.map(p => p.job));
    if (['handwerker', 'holzfaeller', 'baumeister', 'steinmetz', 'arbeiter'].some(j => jobs.has(j))) { k.workbench(W / 2 - 1.4, Dp / 2 - 1.5, 0); S.craft = spot(W / 2 - 1.4, Dp / 2 - 1.5, 0); }
    if (jobs.has('gelehrter') || era >= 5) { const d = spot(-W / 2 + 1.0, -0.15, -Math.PI / 2, 0.47); k.desk(d.x, d.z, d.ry, era); S.read = d; }
    if (jobs.has('priester') || hash(b.id, 77) < 0.4) { const a = spot(W / 2 - 1.05, Dp * 0.12, Math.PI / 2); k.altar(a.x, a.z, a.ry); S.pray = a; lights.push({ x: W / 2 - 0.35, y: 1.25, z: a.z, c: '#ffcf7a', i: 1.2, r: 3, fl: true }); }
    // Stehplätze zum Plaudern
    S.stand.push(face(this.door.x - 0.55, Dp / 2 - 1.15, this.door.x + 0.3, Dp / 2 - 1.05), face(this.door.x + 0.35, Dp / 2 - 1.0, this.door.x - 0.55, Dp / 2 - 1.15));
    // Vorräte, Truhe, Regale
    k.chest(-W / 2 + 0.4, Dp / 2 - 0.75, Math.PI / 2, rich >= 3 ? '#8a5a3a' : WOOD);
    k.barrel(W / 2 - 0.4, Dp / 2 - 0.45); k.sack(W / 2 - 0.4, Dp / 2 - 0.95); if (rich >= 1) k.sack(W / 2 - 0.9, Dp / 2 - 0.4);
    if (era >= 1) k.shelf(-W / 2 + 0.14, 1.6, -Dp * 0.1, 1.4, Math.PI / 2, 4);
    if (jobs.has('fischer')) for (let i = 0; i < 3; i++) k.box(0.02, 0.6, 0.5, -W / 2 + 0.12, 1.2, Dp * 0.25 + i * 0.05, '#c9b48a', 0.3);
    if (jobs.has('bauer') || jobs.has('sammler')) { k.cyl(0.2, 0.15, 0.3, W / 2 - 0.35, 0, -Dp / 2 + 1.3, '#c9a36a', 10); for (let i = 0; i < 4; i++) k.ball(0.07, W / 2 - 0.35 + (i - 1.5) * 0.06, 0.32, -Dp / 2 + 1.3, '#d9534f'); }
    // Reichtum: Teppich, Bilder, Pflanzen, Leuchter
    if (rich >= 2 && era >= 2) k.rug(tx, tz, tw + 1.2, 2.4, '#b0475a', '#e9b44c');
    if (rich >= 2 && era >= 3) k.painting(-W * 0.05, 1.75, -Dp / 2 + 0.12, 0, ['#7fa7c0', '#c98f5a', '#8fae7c'][b.id % 3]);
    if (rich >= 3 && era >= 3) { k.painting(-W * 0.32, 1.75, Dp / 2 - 0.12, Math.PI, '#b07ab8'); k.plant(-W / 2 + 0.4, -Dp / 2 + 0.4, 0.9); }
    if (rich >= 3 && era >= 4 && era <= 5) { k.cyl(0.02, 0.02, 0.6, tx, 2.1, tz, IRON, 6); k.cyl(0.4, 0.4, 0.04, tx, 2.08, tz, IRON, 16); for (let i = 0; i < 6; i++) k.candle(tx + Math.cos(i) * 0.38, 2.12, tz + Math.sin(i) * 0.38); lights.push({ x: tx, y: 2.1, z: tz, c: '#ffd9a0', i: 3, r: 6, fl: true }); }
    // Moderne: Sofa, Uhr, Radio, Fernseher
    if (era >= 6) { k.box(1.8, 0.45, 0.8, -W * 0.15, 0, -Dp / 2 + 2.6, '#7f9fb0'); k.box(0.3, 0.3, 0.06, W * 0.05, 1.9, -Dp / 2 + 0.12, '#f5efe2'); k.box(0.45, 0.3, 0.25, W / 2 - 0.4, 0.9, Dp / 2 - 0.45, '#8a5a3a'); }
    if (era >= 7) { k.box(1.0, 0.6, 0.08, W / 2 - 0.12, 1.0, Dp * 0.25, '#1e2228', Math.PI / 2); k.box(0.96, 0.56, 0.09, W / 2 - 0.13, 1.02, Dp * 0.25, '#6aa0c8', Math.PI / 2, true); }
    // Bettdecken als eigene Teile: sichtbar, wenn jemand darunter liegt
    for (const d of this.duvets) {
      const len = d.len ?? 0.9, off = d.len != null ? 0.12 : 0.32;
      const g = new THREE.CapsuleGeometry(0.22, len, 4, 10).rotateX(Math.PI / 2).scale(d.w / 0.44, 0.62, 1);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: C(d.c), roughness: 0.95 }));
      m.position.set(d.x + Math.sin(d.ry) * off, d.h + 0.13 * (d.len != null ? 0.6 : 1), d.z + Math.cos(d.ry) * off);
      m.rotation.y = d.ry; m.castShadow = true; m.receiveShadow = true; m.visible = false;
      this.roomGroup.add(m);
      d.m = m;
    }
  }

  furnishWork(k, b, era, rich, lights, cast) {
    const { W, D: Dp } = this.room;
    const S = this.slots;
    const t = b.t;
    if (t === 'werkstatt' || t === 'fabrik' || t === 'kraftwerk' || t === 'mine' || t === 'stein' || t === 'holz') {
      for (let i = 0; i < 3; i++) { const x = -W * 0.3 + i * W * 0.3; k.workbench(x, -Dp * 0.18, 0); S.work.push(spot(x, -Dp * 0.18, 0)); }
      if (era >= 2) { k.box(0.5, 0.35, 0.3, W * 0.3, 0, Dp * 0.22, IRON); k.box(0.7, 0.12, 0.3, W * 0.3, 0.35, Dp * 0.22, '#4a4a50'); S.work.push(face(W * 0.3 - 0.7, Dp * 0.22, W * 0.3, Dp * 0.22)); }
      for (let i = 0; i < 5; i++) k.box(1.4, 0.18, 0.18, -W / 2 + 0.9, i * 0.18, Dp / 2 - 0.5, WOODL);
      if (t === 'fabrik' || t === 'kraftwerk') { for (let i = 0; i < 3; i++) k.cyl(0.35, 0.35, 1.4, -W * 0.3 + i * 1.3, 0, Dp * 0.25, '#7a7f86', 14); }
      lights.push({ x: 0, y: 2.2, z: 0, c: era >= 6 ? '#fff1d6' : '#ffbf7a', i: 4, r: 10, fl: era < 6 });
    } else if (t === 'schule' || t === 'sternwarte') {
      k.box(2.2, 1.0, 0.06, 0, 1.0, -Dp / 2 + 0.12, '#2f4a3c'); k.box(2.3, 1.1, 0.04, 0, 0.95, -Dp / 2 + 0.1, WOODD);
      for (let i = 0; i < 6; i++) k.box(0.18, 0.004, 0.01, -0.7 + i * 0.28, 1.4 + (i % 2) * 0.12, -Dp / 2 + 0.16, '#efe9dc');
      for (let r0 = 0; r0 < 3; r0++) for (let c = 0; c < 4; c++) {
        const x = -2.4 + c * 1.6, z = -0.7 + r0 * 1.25;
        k.table(x, z, 1.1, 0.5, era, false); k.bench(x, z + 0.45, 1.0);
        S.desk.push(spot(x - 0.25, z + 0.45, Math.PI, 0.47)); S.desk.push(spot(x + 0.25, z + 0.45, Math.PI, 0.47));
      }
      S.teach = spot(0.9, -Dp / 2 + 0.85, Math.PI);
      S.work.push(S.teach, spot(-0.9, -Dp / 2 + 0.85, Math.PI), spot(W / 2 - 0.9, 0, -Math.PI / 2));
      k.shelf(W / 2 - 0.14, 1.5, 0, 2, Math.PI / 2, 8);
      lights.push({ x: 0, y: 2.3, z: 0, c: '#ffe2b0', i: 4, r: 11 });
    } else if (t === 'schrein' || t === 'monument') {
      k.box(1.6, 0.9, 0.7, 0, 0, -Dp / 2 + 0.8, STONE); k.box(1.7, 0.08, 0.8, 0, 0.9, -Dp / 2 + 0.8, '#efe6d6');
      k.ball(0.35, 0, 1.4, -Dp / 2 + 0.7, '#e9b44c', 1, 1.2, 1, true);
      for (let i = 0; i < 7; i++) k.candle(-0.7 + i * 0.23, 0.98, -Dp / 2 + 0.55);
      for (let i = 0; i < 3; i++) k.rug(-1.2 + i * 1.2, Dp * 0.0, 0.7, 1.0, '#b0475a', '#e9b44c');
      for (let i = 0; i < 6; i++) S.work.push(spot(-1.2 + (i % 3) * 1.2, (i < 3 ? 0 : 1.1), Math.PI));
      lights.push({ x: 0, y: 1.3, z: -Dp / 2 + 1.0, c: '#ffcf7a', i: 7, r: 8, fl: true });
    } else if (t === 'heiler') {
      for (let i = 0; i < 3; i++) {
        const x = -W / 2 + 1.2 + i * 1.6, z = -Dp * 0.12;
        const top = k.bed(x, z, 0, era, false, '#eef3ee', false);
        S.sick.push({ x, z: z + 0.06, ry: 0, h: top, side: { x: x + 0.8, z: z + 0.3 }, duvet: this.duvets.length });
        this.duvets.push({ x, z, ry: 0, w: 0.8, h: top, c: '#dfe9e2' });
        S.heal.push(face(x + 0.7, z + 0.9, x, z));
      }
      k.shelf(W / 2 - 0.14, 1.4, -0.4, 2.2, Math.PI / 2, 9); k.shelf(W / 2 - 0.14, 1.8, -0.4, 2.2, Math.PI / 2, 9);
      k.table(W / 2 - 1.2, Dp * 0.28, 1.2, 0.7, era, false);
      for (let i = 0; i < 5; i++) k.cyl(0.05, 0.05, 0.16, W / 2 - 1.6 + i * 0.2, 0.78, Dp * 0.28, ['#7fae5c', '#c98f5a', '#7f9fb0', '#e9b44c', '#b07ab8'][i], 8);
      lights.push({ x: 0, y: 2.2, z: 0, c: '#ffe7c2', i: 4, r: 10 });
    } else if (t === 'theater') {
      k.box(W * 0.7, 0.4, 2.2, 0, 0, -Dp / 2 + 1.2, WOODL);
      for (const s of [-1, 1]) k.box(0.8, H_CURTAIN, 0.12, s * W * 0.32, 0, -Dp / 2 + 0.4, '#a83a3a');
      for (let r0 = 0; r0 < 2; r0++) k.bench(0, 1.0 + r0 * 1.0, W * 0.6);
      for (let i = 0; i < 4; i++) S.work.push(spot(-1.5 + i * 1.0, -Dp / 2 + 1.2, 0, 0.4));
      lights.push({ x: 0, y: 2.3, z: -Dp / 2 + 1.5, c: '#ffd9a0', i: 6, r: 8 });
    } else {
      // Lager, Markt, Hafen, Kaserne: Vorräte, gearbeitet wird draußen
      for (let i = 0; i < 6; i++) k.barrel(-W / 2 + 0.6 + (i % 3) * 0.6, -Dp / 2 + 0.6 + Math.floor(i / 3) * 0.6);
      for (let i = 0; i < 6; i++) k.sack(W / 2 - 0.6 - (i % 3) * 0.5, Dp / 2 - 0.6 - Math.floor(i / 3) * 0.5);
      k.chest(0, -Dp / 2 + 0.5, 0);
      S.work.push(spot(0, 0, 0), spot(1, 0.5, 2));
      lights.push({ x: 0, y: 2.2, z: 0, c: '#ffd9a0', i: 3.5, r: 9 });
    }
    for (const d of this.duvets) {
      const g = new THREE.CapsuleGeometry(0.22, 0.9, 4, 10).rotateX(Math.PI / 2).scale(d.w / 0.44, 0.62, 1);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: C(d.c), roughness: 0.95 }));
      m.position.set(d.x, d.h + 0.13, d.z + 0.32); m.castShadow = true; m.visible = false;
      this.roomGroup.add(m); d.m = m;
    }
    void rich; void cast;
  }

  // Wohin gehört jemand für eine Tätigkeit? { x, z, ry, h, clip, lie, side }
  target(p, i, act) {
    const S = this.slots, R = this.room;
    const T = this.tgt || (this.tgt = {});
    const set = (sp, clip, lie = false) => { if (!sp) return null; T.x = sp.x; T.z = sp.z; T.ry = sp.ry; T.h = sp.h || 0; T.clip = clip; T.lie = lie; T.side = sp.side || null; T.duvet = sp.duvet; T.floor = !!sp.floor; return T; };
    const pick = (list, j) => (list.length ? list[j % list.length] : null);
    if (!this.isHouse) {
      if (act === 'sick') { const j = this.cast.filter(q => q.sick).indexOf(p); return set(S.sick[j] || S.sick[0], 'sleep', true); }
      if (act === 'sit') { const j = this.cast.filter(q => q.job === 'kind').indexOf(p); return set(S.desk[j] || pick(S.desk, j), 'sit'); }
      const j = this.cast.filter(q => q.w === this.b.id).indexOf(p);
      if (act === 'teach') return set(j === 0 && S.teach ? S.teach : pick(S.work, j), 'chat');
      if (act === 'heal') return set(pick(S.heal, j) || pick(S.work, j), 'pickup');
      if (act === 'pray') return set(pick(S.work, j), 'floor');
      if (act === 'read') return set(pick(S.desk, j) || pick(S.work, j), 'sit');
      if (act === 'cheer') return set(pick(S.work, j), j % 2 ? 'cheer' : 'chat');
      return set(pick(S.work, j), 'hammer');
    }
    if (act === 'sleep' || act === 'sick') return set(S.bed.get(p.id), 'sleep', true);
    if (act === 'cook' && S.cook) return set(S.cook, 'pickup');
    if (act === 'doze') { const olds = this.cast.filter(q => q.job === 'alt'); const j = olds.indexOf(p); if (j >= 0 && j < S.doze.length) return set(S.doze[j], 'doze'); }
    if (act === 'floor') return set(pick(S.floor, i), 'floor');
    if (act === 'hammer' && S.craft) return set(S.craft, 'hammer');
    if (act === 'read' && S.read) return set(S.read, 'sit');
    if (act === 'pray' && S.pray) return set(S.pray, 'floor');
    if (act === 'chat') { const j = this.cast.indexOf(p); if (S.stand.length) return set(S.stand[j % S.stand.length], 'chat'); }
    const se = S.seat.get(p.id);
    if (se && se.floor) return set(se, 'floor');
    void R;
    return set(se, act === 'drink' || act === 'talksit' || act === 'doze' ? act : 'sit');
  }

  // Jedes Bild: wer ist laut Tagesablauf hier, wer kommt, wer geht, und was tun sie
  updatePeople(st, dt, t) {
    const F = this.figs;
    if (!F || !F.length) return;
    const f = this.app.f ?? (this.app.tod ? this.app.tod() : 0.5);
    const stormy = !!(this.app.people && this.app.people.stormy);
    const speed = 1.5 * Math.min(10, Math.max(1, this.app.speed || 1));
    const o = this.o, door = this.door;
    for (const Fg of F) Fg.begin(true);
    for (const d of this.duvets) d.used = false;
    const drawn = this.drawn || (this.drawn = []);
    drawn.length = 0;
    this.cast.forEach((p, i) => {
      const P = plan(st, p, f, t, stormy);
      // Drinnen ist nur, wer draußen wirklich angekommen ist (people.inside), und tut, was der Tagesplan sagt
      const ib = this.app.people && this.app.people.inside ? this.app.people.inside.get(p.id) : null;
      const here = ib === this.b.id && (this.isHouse ? P.at === 'home' : P.at === 'in' && P.bid === this.b.id);
      let s = this.state.get(p.id);
      if (!s) { s = { vis: false, x: door.x, z: door.z, ry: Math.PI, act: '', moving: false, posed: false }; this.state.set(p.id, s); }
      s.status = { at: P.at, act: P.act, out: P.out, a: P.a, b: P.b, bid: P.bid };
      const kid = p.job === 'kind', old = p.job === 'alt';
      const age = (st.day - p.b) / D.DAYS_PER_YEAR;
      const sc = BODY * (kid ? (age < 2 ? 0.32 + age * 0.06 : 0.46 + Math.min(14, age) / 14 * 0.46) : figureScale(p, kid, old));
      const T = here ? this.target(p, i, P.act) : null;
      // Ziel: der Ursprung der Figur, so dass der Rumpf der Pose auf dem Platz sitzt
      let gx = door.x, gz = door.z, clip = 'idle', lie = false, gy = 0, gry = Math.PI, approach = null;
      if (T) {
        clip = T.clip; lie = T.lie;
        const Fg = figFor(F, p);
        const tr = Fg.trunk && Fg.trunk[clip] && !lie ? Fg.trunk[clip] : [0, 0];
        const c = Math.cos(T.ry), sn = Math.sin(T.ry);
        gx = T.x - (tr[0] * c + tr[1] * sn) * sc; gz = T.z - (-tr[0] * sn + tr[1] * c) * sc; gry = T.ry;
        gy = lie ? T.h : SITTING.has(clip) ? Math.max(0, T.h - SEAT_Y * sc) : 0;
        if (lie && T.side) approach = T.side;
        if (lie && T.duvet != null && this.duvets[T.duvet]) this.duvets[T.duvet].used = s.posed && s.lie;
      }
      if (!T && !s.vis) return; // draußen und nicht hier
      if (T && !s.vis) { s.vis = true; s.x = door.x; s.z = door.z; s.ry = Math.PI; s.posed = false; s.lie = false; }
      // Laufen: erst zum Bettrand, dann hinlegen; sonst direkt zum Platz
      const wx = approach && !s.posed ? approach.x : gx, wz = approach && !s.posed ? approach.z : gz;
      const dx = wx - s.x, dz = wz - s.z, d = Math.hypot(dx, dz);
      const changed = s.goal !== (T ? T.clip + ':' + gx.toFixed(2) + ':' + gz.toFixed(2) : 'door');
      if (changed) { s.goal = T ? T.clip + ':' + gx.toFixed(2) + ':' + gz.toFixed(2) : 'door'; if (s.posed && d > 0.05) s.posed = false; }
      let mode = clip, y = 0, ry = s.ry, x = s.x, z = s.z, isLie = false;
      if (!s.posed && d > 0.04) {
        const step = Math.min(d, speed * dt);
        s.x += dx / d * step; s.z += dz / d * step;
        let want = Math.atan2(dx, dz), dd = want - s.ry; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
        s.ry += dd * Math.min(1, dt * 10);
        x = s.x; z = s.z; ry = s.ry; mode = 'walk';
      } else if (!T) {
        s.vis = false; return; // zur Tür hinaus
      } else {
        s.posed = true; s.lie = lie;
        s.x = gx; s.z = gz;
        let dd = gry - s.ry; dd = Math.atan2(Math.sin(dd), Math.cos(dd)); s.ry += dd * Math.min(1, dt * 8);
        x = gx; z = gz; ry = lie ? gry : s.ry; y = gy; isLie = lie;
      }
      const Fg = figFor(F, p);
      if (Fg.n >= Fg.max) return;
      o.position.set(x, y, z);
      o.rotation.set(0, ry, 0);
      o.scale.setScalar(sc);
      o.updateMatrix();
      drawPerson(Fg, p, o.matrix, isLie ? 'sleep' : mode, mode === 'walk' ? 1.1 : 1, kid, old, true);
      drawn.push({ p, x, y: y + (isLie ? 0.15 : SITTING.has(mode) ? 0.75 : 0.95) * (isLie ? 1 : sc / BODY), z });
    });
    for (const Fg of F) Fg.end();
    for (const d of this.duvets) if (d.m) d.m.visible = d.used;
  }

  renderUI(st, b) {
    const rt = st._rt, s = rt.sById.get(b.s);
    const own = b.own ? rt.pById.get(b.own) : null;
    const name = b.t === 'haus' ? L('Haus', 'House') : b.t === 'hochhaus' ? L('Wohnung im Wohnturm', 'Flat in the tower') : (D.BUILDINGS[b.t]?.name || b.t);
    const esc = x => String(x ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const more = this.all.length - this.cast.length;
    this.ui.innerHTML = `<div class="itop"><button class="iback">${L('← Zurück nach draußen', '← Back outside')}</button>
      <div class="ititle"><b>${esc(b.t === 'haus' && own ? L(`Haus von ${own.n}`, `House of ${own.n}`) : name)}</b><small class="iwhen">${esc(s ? s.name : '')}</small></div></div>
      <div class="ipeople">${this.cast.map(p => `<button class="plink" data-pid="${p.id}"><b>${esc(p.n)}</b><small></small></button>`).join('') || (this.isHouse ? L('Niemand wohnt hier.', 'Nobody lives here.') : L('Niemand arbeitet hier.', 'Nobody works here.'))}${more > 0 ? `<span class="imore">${L(`+${more} in anderen Wohnungen`, `+${more} in other flats`)}</span>` : ''}</div>
      <div class="ihint">${L('Ziehen zum Umsehen · Rad zum Zoomen · Esc zurück', 'Drag to look around · Wheel to zoom · Esc to go back')}</div>`;
    this.ui.querySelector('.iback').onclick = () => this.close();
    this.ui.querySelectorAll('.plink').forEach(x => { x.onclick = () => this.app.selectPerson(+x.dataset.pid, false); });
  }

  // Namen mit dem, was jeder gerade tut (genau wie in der Welt)
  refreshUI(st) {
    const rt = st._rt;
    const placeName = bid => { const bb = rt.bById.get(bid); return bb ? (D.BUILDINGS[bb.t]?.name || '') : ''; };
    const f = this.app.f ?? (this.app.tod ? this.app.tod() : 0.5);
    const hour = Math.floor(f * 24), min = Math.floor((f * 24 - hour) * 60 / 15) * 15;
    const s = rt.sById.get(this.b.s);
    const w = this.ui.querySelector('.iwhen');
    if (w) w.textContent = `${s ? s.name : ''} · ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    for (const el of this.ui.querySelectorAll('.plink')) {
      const p = rt.pById.get(+el.dataset.pid), S = p && this.state.get(p.id);
      if (!S || !S.status) continue;
      const P = S.status;
      const here = this.isHouse ? P.at === 'home' : P.at === 'in' && P.bid === this.b.id;
      const txt = here && !this.isHouse ? WORKING[P.act] || doing({ at: 'home', act: P.act }, L) : doing(P, L, P.at === 'in' ? placeName(P.bid) : '');
      el.querySelector('small').textContent = txt;
      el.classList.toggle('here', here);
    }
  }

  // Jedes Bild: Kamera um das Zimmer, Wände zur Kamera hin ausblenden, Licht flackert, Menschen leben
  render(dt, t) {
    if (!this.active) return;
    const st = this.app.st;
    this.uTime.value = t;
    // Neue Bewohner oder Todesfälle: Raum neu einrichten
    if (t - (this.lastCheck || 0) > 1) {
      this.lastCheck = t;
      const key = this.castOf(st, this.b).map(p => p.id).join(',');
      if (key !== this.key || !st._rt.bById.has(this.b.id)) { if (!st._rt.bById.has(this.b.id)) { this.close(); return; } this.build(st, this.b); }
    }
    const night = this.app.night || 0;
    this.lightUp(night);
    for (const [pl, , fl, base] of this.lamps) pl.intensity = fl ? base * (0.85 + Math.sin(t * 9.1 + base) * 0.06 + Math.sin(t * 17.3) * 0.05) : base;
    this.updatePeople(st, Math.min(0.1, dt), t);
    if (t - this.lastUI > 0.4) { this.lastUI = t; this.refreshUI(st); }
    const r = this.stage.renderer, cam = this.camera;
    const w = r.domElement.clientWidth, h = r.domElement.clientHeight;
    cam.aspect = w / Math.max(1, h); cam.updateProjectionMatrix();
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    cam.position.set(Math.sin(this.yaw) * cp * this.dist, sp * this.dist + 0.8, Math.cos(this.yaw) * cp * this.dist);
    cam.lookAt(0, 0.9, 0);
    for (const m of this.walls || []) { const [nx, nz] = m.userData.n; m.visible = nx * cam.position.x + nz * cam.position.z < 1.2; }
    const tm = r.toneMappingExposure;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.render(this.scene, cam);
    r.toneMappingExposure = tm;
  }
}
