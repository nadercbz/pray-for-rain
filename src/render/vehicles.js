// Fahrzeuge: Karren, Wagen und Autos auf den Straßen zwischen den Orten, Verkehr in den Städten,
// dazu Flugzeuge und Luftschiffe. Alles Instanzen mit Vertexfarben im Tiny Glade Stil, Karosserien werden je Instanz gefärbt.
import * as THREE from 'three';
import { NX, NY, wx, wz } from './scene.js';
import { groundY } from './terrain.js';
import { roadY } from './bridges.js';
import { knows } from '../sim/util.js';
import { Bld, K, shade, paintable } from './ships.js';
import { roundBox, profile } from './shapes.js';
import { WIDTH } from './roadnet.js';
import { Occ } from './traffic.js';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const seg = (u, a, b) => clamp((u - a) / (b - a));
const wrapPi = a => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
const hsh = (a, b = 0) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
const pk = (arr, r) => arr[Math.floor(r * arr.length) % arr.length];

const CARS = ['#e8a39a', '#9cc7d9', '#f0d58c', '#a9cfa0', '#c9b3e0', '#f4efe6', '#e7b98f', '#8fb7c9', '#d98f78', '#b8d4a8'];
const OLD = ['#6f8f76', '#8b5a44', '#c6a85f', '#52667f', '#9b3e3a', '#d8cdb4'];
const COATS = ['#c8553d', '#5fa8a0', '#e0a640', '#6f93bd', '#e9e1cc', '#a7bf8f'];

// ---------- Teile ----------
// Rad mit Achse entlang z
function wheel(B, x, y, z, r, c = '#3f3a36', hub = '#cfc8ba', w = 0.025) {
  B.cyl(r, r, w, x, y, z, c, 8, [Math.PI / 2, 0, 0]);
  B.cyl(r * 0.45, r * 0.45, w * 1.15, x, y, z, hub, 6, [Math.PI / 2, 0, 0]);
}

function person(B, x, y, z, coat, hat = '#c9a46a', s = 1) {
  B.cyl(0.011 * s, 0.013 * s, 0.03 * s, x, y + 0.015 * s, z, '#6b5a48', 5);
  B.cyl(0.016 * s, 0.019 * s, 0.045 * s, x, y + 0.052 * s, z, coat, 6);
  B.sph(0.016 * s, x, y + 0.092 * s, z, K.skin, 1, 1, 1, 6, 4);
  if (hat) B.cone(0.021 * s, 0.014 * s, x, y + 0.112 * s, z, hat, 6);
}

// Ochse oder Pferd, Blick nach +x (legs: false für Tiere mit eigenen, bewegten Beinen, siehe treks.js)
export function beast(B, x, z, o) {
  const { L = 0.15, H = 0.085, body = '#8c6a4a', dark = '#6a4c36', belly = '#b69471', horse = false, legs = true } = o;
  const top = 0.07 + H;
  B.sph(1, x, top - H * 0.45, z, body, L * 0.5, H * 0.5, H * 0.42, 8, 6);
  B.sph(1, x, top - H * 0.72, z, belly, L * 0.42, H * 0.26, H * 0.4, 6, 4);
  if (legs) for (const dx of [L * 0.32, -L * 0.32]) for (const dz of [H * 0.24, -H * 0.24]) {
    B.cyl(0.011, 0.008, 0.075, x + dx, 0.0375, z + dz, dark, 5);
    B.cyl(0.0095, 0.0095, 0.012, x + dx, 0.006, z + dz, '#3d3029', 5);
  }
  const nx = x + L * 0.5, ny = top - H * 0.15;
  if (horse) {
    B.rod([nx - 0.02, ny - 0.015, z], [nx + 0.035, ny + 0.065, z], 0.019, body, 6, 0.013);
    B.sph(1, nx + 0.06, ny + 0.075, z, body, 0.04, 0.022, 0.02, 6, 4);
    B.box(0.02, 0.03, 0.008, nx + 0.02, ny + 0.062, z, dark, 0, 0, -0.5);       // Mähne
    B.rod([x - L * 0.5, top - H * 0.3, z], [x - L * 0.5 - 0.025, top - H * 0.95, z], 0.008, dark, 4, 0.004); // Schweif
  } else {
    B.sph(1, nx + 0.035, ny - 0.005, z, body, 0.042, 0.03, 0.027, 6, 4);
    B.sph(1, x + L * 0.25, top + 0.002, z, dark, 0.032, 0.022, 0.03, 5, 3);      // Widerrist
    for (const dz of [0.026, -0.026]) B.cone(0.007, 0.026, nx + 0.03, ny + 0.034, z + dz, '#efe6d0', 4, [dz > 0 ? 0.5 : -0.5, 0, 0]);
    B.rod([x - L * 0.5, top - H * 0.3, z], [x - L * 0.5 - 0.02, top - H * 0.95, z], 0.006, dark, 4, 0.004);
  }
}

// Rad mit Reifen, Felge und Nabe, Achse entlang z, dazu ein dunkler Radkasten auf der Karosserie (seit 24.10.2026)
function carWheel(B, x, y, z, r, w = 0.024, rim = '#d9dde0') {
  const sz = Math.sign(z);
  B.cyl(r * 1.18, r * 1.18, 0.004, x, y + 0.003, z - sz * 0.012, '#1c1a19', 14, [Math.PI / 2, 0, 0]);
  B.cyl(r, r, w, x, y, z, '#2a2726', 14, [Math.PI / 2, 0, 0]);
  B.cyl(r * 0.92, r * 0.92, w * 1.04, x, y, z, '#33302e', 14, [Math.PI / 2, 0, 0]);
  B.cyl(r * 0.6, r * 0.6, w * 1.1, x, y, z, rim, 12, [Math.PI / 2, 0, 0]);
  B.cyl(r * 0.24, r * 0.24, w * 1.18, x, y, z, '#9aa1a8', 8, [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; B.box(0.004, r * 0.42, 0.004, x + Math.cos(a) * r * 0.36, y + Math.sin(a) * r * 0.36, z + sz * w * 0.57, '#aeb4ba', 0, 0, a + Math.PI / 2); }
}

const fin = (B, s) => { const g = B.done(false); if (s !== 1) g.scale(s, s, s); return g; };

// ---------- Fahrzeugbauarten (Vorwärts +x, Länge in Weltmaßen) ----------
function oxcart() {
  const B = new Bld();
  B.box(0.2, 0.024, 0.12, -0.05, 0.1, 0, K.woodL);
  for (const z of [0.06, -0.06]) B.box(0.2, 0.04, 0.008, -0.05, 0.125, z, K.wood);
  B.box(0.008, 0.04, 0.12, -0.15, 0.125, 0, K.wood);
  for (const z of [0.075, -0.075]) wheel(B, -0.05, 0.06, z, 0.06, '#8a6a48', '#5a412f');
  B.sph(1, -0.09, 0.14, 0.02, K.cream, 0.045, 0.035, 0.04, 6, 4);
  B.cyl(0.028, 0.028, 0.05, -0.125, 0.14, -0.03, K.woodL, 7);
  B.rod([0.04, 0.095, 0], [0.2, 0.12, 0], 0.007, K.woodD);
  B.box(0.012, 0.012, 0.09, 0.19, 0.145, 0, K.woodD);
  beast(B, 0.25, 0, { L: 0.15, H: 0.085, body: '#a68b6c', dark: '#6a4c36', belly: '#cdb792' });
  person(B, 0.01, 0.112, 0, COATS[1]);
  return fin(B, 0.92);
}

// puller: false ohne die kleine Figur vorn (Kundschafter ziehen ihn selbst, treks.js)
export function handcart(puller = true) {
  const B = new Bld();
  B.box(0.2, 0.022, 0.12, 0, 0.082, 0, K.woodL);
  for (const z of [0.06, -0.06]) B.box(0.2, 0.03, 0.008, 0, 0.104, z, K.wood);
  for (const z of [0.07, -0.07]) wheel(B, 0, 0.052, z, 0.052, '#8a6a48', '#5a412f');
  for (const z of [0.05, -0.05]) B.rod([0.08, 0.09, z], [0.25, 0.1, z * 0.6], 0.006, K.woodD);
  B.sph(1, -0.04, 0.12, 0.02, K.cream, 0.04, 0.032, 0.035, 6, 4);
  B.cyl(0.026, 0.026, 0.045, 0.03, 0.115, -0.03, K.woodL, 7);
  B.sph(1, -0.07, 0.115, -0.03, shade(K.cream, 0.92), 0.025, 0.02, 0.025, 5, 3);
  if (puller) person(B, 0.28, 0, 0, COATS[3]);
  return fin(B, 0.95);
}

function horsecart() {
  const B = new Bld();
  B.box(0.24, 0.022, 0.12, -0.06, 0.1, 0, K.woodL);
  for (const z of [0.06, -0.06]) B.box(0.24, 0.035, 0.008, -0.06, 0.122, z, K.wood);
  for (const z of [0.075, -0.075]) { wheel(B, -0.1, 0.06, z, 0.06, '#8a6a48', '#5a412f'); wheel(B, 0.02, 0.045, z, 0.045, '#8a6a48', '#5a412f'); }
  B.pf = 1; B.cyl(0.058, 0.058, 0.2, -0.09, 0.14, 0, '#ffffff', 8, [0, 0, Math.PI / 2]); B.pf = 0;
  B.box(0.008, 0.12, 0.12, -0.19, 0.16, 0, K.woodD);
  B.rod([0.04, 0.095, 0], [0.18, 0.12, 0], 0.007, K.woodD);
  beast(B, 0.25, 0, { L: 0.16, H: 0.08, body: '#9a6a46', dark: '#4a3326', belly: '#b98a60', horse: true });
  person(B, 0.035, 0.116, 0, COATS[0]);
  return fin(B, 0.9);
}

function carriage() {
  const B = new Bld();
  B.pf = 1; B.box(0.2, 0.1, 0.12, -0.06, 0.155, 0, '#ffffff'); B.pf = 0;
  B.box(0.215, 0.012, 0.135, -0.06, 0.21, 0, '#4a3f3a');
  B.box(0.22, 0.02, 0.1, -0.06, 0.098, 0, K.woodD);
  for (const z of [0.062, -0.062]) { B.quad(0.07, 0.05, -0.1, 0.17, z, '#9fc4d6', z > 0 ? '+z' : '-z'); B.quad(0.07, 0.05, -0.02, 0.17, z, '#9fc4d6', z > 0 ? '+z' : '-z'); }
  for (const z of [0.07, -0.07]) { wheel(B, -0.12, 0.062, z, 0.062, '#6a4c36', '#c9b98f'); wheel(B, 0.02, 0.045, z, 0.045, '#6a4c36', '#c9b98f'); }
  B.box(0.05, 0.02, 0.1, 0.06, 0.125, 0, K.woodD);
  B.rod([0.04, 0.095, 0], [0.17, 0.12, 0], 0.007, K.woodD);
  B.lantern(0.04, 0.17, 0.065, 0.8);
  beast(B, 0.25, 0, { L: 0.16, H: 0.08, body: '#4d3a30', dark: '#2f241e', belly: '#6a5244', horse: true });
  person(B, 0.065, 0.135, 0, '#3f4a63', '#2f2b2c');
  return fin(B, 0.88);
}

function steamwagon() {
  const B = new Bld();
  B.box(0.34, 0.02, 0.12, 0, 0.075, 0, '#4a4440');
  B.cyl(0.05, 0.05, 0.17, 0.11, 0.135, 0, '#3f5a4c', 10, [0, 0, Math.PI / 2]);
  B.cyl(0.052, 0.052, 0.01, 0.17, 0.135, 0, '#c8a24f', 10, [0, 0, Math.PI / 2]);
  B.cyl(0.013, 0.017, 0.1, 0.17, 0.22, 0, '#2f2b2c', 6); B.cyl(0.02, 0.016, 0.014, 0.17, 0.275, 0, '#c8a24f', 6);
  B.sph(1, 0.2, 0.135, 0, '#c8a24f', 0.012, 0.012, 0.012, 5, 3);
  B.pf = 1; B.box(0.1, 0.1, 0.12, -0.04, 0.135, 0, '#ffffff'); B.box(0.12, 0.012, 0.135, -0.04, 0.19, 0, '#ffffff'); B.pf = 0;
  B.box(0.008, 0.05, 0.08, 0.011, 0.14, 0, '#9fc4d6');
  B.box(0.14, 0.014, 0.115, -0.14, 0.095, 0, K.woodL);
  B.box(0.045, 0.04, 0.05, -0.15, 0.12, 0.02, K.woodD);
  for (const z of [0.075, -0.075]) { wheel(B, 0.11, 0.04, z, 0.04, '#3f3a36', '#c8a24f'); wheel(B, -0.07, 0.055, z, 0.055, '#6a4c36', '#c8a24f'); }
  person(B, -0.04, 0.085, 0, COATS[2], '#3f4a63');
  return fin(B, 0.95);
}

// Oldtimer der Industriezeit (seit 24.10.2026 rund): lange Motorhaube, Kabine mit gewölbtem Dach, geschwungene
// Kotflügel über den Rädern, Trittbrett, hoher Chromkühler, Scheinwerfer auf Stielen, Ersatzrad hinten, Weißwandreifen
function vintage() {
  const B = new Bld();
  B.box(0.36, 0.022, 0.1, 0, 0.06, 0, '#2a2726');
  B.pf = 1;
  B.put(profile([[0.03, 0.075], [0.19, 0.075], [0.195, 0.1], [0.185, 0.128], [0.03, 0.138]], 0.11, 0.014), '#ffffff');
  B.put(profile([[-0.15, 0.072], [0.035, 0.072], [0.035, 0.19], [0.0, 0.205], [-0.13, 0.205], [-0.155, 0.17]], 0.13, 0.014), '#ffffff');
  B.pf = 0;
  for (const z of [0.066, -0.066]) { B.box(0.034, 0.042, 0.004, -0.012, 0.165, z, '#2c3a44'); B.box(0.07, 0.042, 0.004, -0.08, 0.165, z, '#2c3a44'); }
  B.box(0.004, 0.05, 0.1, 0.037, 0.168, 0, '#2c3a44', 0, 0, 0.12);
  // Kotflügel und Trittbrett
  for (const z of [0.075, -0.075]) {
    for (const x of [0.12, -0.12]) {
      const g = new THREE.CylinderGeometry(0.056, 0.056, 0.036, 12, 1, true, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2);
      g.translate(x, 0.05, z); B.put(g, '#2a2726');
    }
    B.box(0.16, 0.008, 0.032, 0.0, 0.058, z, '#2a2726');
  }
  // Kühler mit Chrom, Scheinwerfer, Stoßstange, Ersatzrad
  B.box(0.012, 0.06, 0.07, 0.198, 0.105, 0, '#c9ced3'); B.box(0.006, 0.048, 0.056, 0.204, 0.105, 0, '#55504c');
  B.sph(1, 0.205, 0.142, 0, '#d9b45a', 0.008, 0.01, 0.008, 6, 4);
  for (const z of [0.05, -0.05]) { B.rod([0.19, 0.09, z * 0.6], [0.205, 0.115, z], 0.003, '#c9ced3', 4); B.cyl(0.016, 0.016, 0.014, 0.21, 0.118, z, '#c9ced3', 12, [0, 0, Math.PI / 2]); B.cyl(0.013, 0.013, 0.016, 0.211, 0.118, z, '#fff6d4', 12, [0, 0, Math.PI / 2]); }
  B.put(roundBox(0.012, 0.012, 0.13, 0.005).translate(0.215, 0.07, 0), '#c9ced3');
  B.cyl(0.04, 0.04, 0.02, -0.17, 0.12, 0, '#2a2726', 14, [0, 0, Math.PI / 2]); B.cyl(0.024, 0.024, 0.022, -0.17, 0.12, 0, '#f1ead8', 12, [0, 0, Math.PI / 2]);
  for (const z of [0.075, -0.075]) { carWheel(B, 0.12, 0.045, z, 0.045, 0.022, '#f1ead8'); carWheel(B, -0.12, 0.045, z, 0.045, 0.022, '#f1ead8'); }
  person(B, -0.04, 0.075, 0.0, '#5a4a40', '#d8cdb4', 0.9);
  return fin(B, 0.95);
}

// moderne Autos (seit 24.10.2026, PLAN_GRAFIK.md, nach Naders Vorbildern: rundes Muscle Car, Mini): Karosserie als
// ausgezogenes Seitenprofil mit runden Kanten und Klarlack, Glaskabine mit Säulen in Wagenfarbe, runde Scheinwerfer,
// Chromstoßstangen, Kühlergrill, Felgen mit Speichen, Radkästen, Spiegel, Griffe, Kennzeichen. Limousine und Kombi.
function modernCar(kind) {
  const B = new Bld();
  const wagon = kind === 'hatch';
  const body = wagon
    ? [[-0.19, 0.03], [0.19, 0.03], [0.205, 0.045], [0.207, 0.075], [0.19, 0.092], [0.08, 0.104], [-0.15, 0.106], [-0.19, 0.1], [-0.2, 0.07], [-0.198, 0.042]]
    : [[-0.2, 0.03], [0.2, 0.03], [0.207, 0.045], [0.208, 0.075], [0.185, 0.092], [0.07, 0.102], [-0.12, 0.104], [-0.19, 0.098], [-0.207, 0.075], [-0.205, 0.045]];
  B.pf = 1; B.put(profile(body, 0.17, 0.016), '#ffffff'); B.pf = 0;
  // Kabine aus Glas, Dach und Säulen in Wagenfarbe
  const cab = wagon ? [[0.075, 0.1], [0.012, 0.155], [-0.165, 0.157], [-0.185, 0.1]] : [[0.072, 0.1], [0.006, 0.153], [-0.088, 0.153], [-0.15, 0.1]];
  B.put(profile(cab, 0.146, 0.01), '#2c3a44');
  const rx0 = cab[1][0], rx1 = cab[2][0], ry = Math.max(cab[1][1], cab[2][1]);
  B.pf = 1; B.put(roundBox(rx0 - rx1 + 0.018, 0.012, 0.15, 0.005).translate((rx0 + rx1) / 2, ry + 0.004, 0), '#ffffff');
  for (const z of [0.073, -0.073]) {
    B.rod([cab[0][0], 0.1, z], [cab[1][0], ry, z], 0.0055, '#ffffff', 5);
    B.rod([cab[3][0], 0.1, z], [cab[2][0], ry, z], 0.0065, '#ffffff', 5);
    B.box(0.012, ry - 0.1, 0.008, wagon ? -0.06 : -0.04, (ry + 0.1) / 2, z, '#ffffff');
    if (wagon) B.box(0.01, ry - 0.1, 0.008, -0.13, (ry + 0.1) / 2, z, '#ffffff');
    // Spiegel
    B.box(0.016, 0.012, 0.014, cab[0][0] - 0.012, 0.112, z + Math.sign(z) * 0.014, '#ffffff');
  }
  B.pf = 0;
  // Front: Grill mit Chromrahmen, runde Scheinwerfer, Stoßstange, Kennzeichen
  B.box(0.008, 0.026, 0.09, 0.209, 0.062, 0, '#2a2726');
  B.box(0.006, 0.03, 0.098, 0.207, 0.062, 0, '#c9ced3');
  for (let i = 0; i < 3; i++) B.box(0.009, 0.003, 0.084, 0.21, 0.053 + i * 0.009, 0, '#55504c');
  for (const z of [0.06, -0.06]) {
    B.cyl(0.013, 0.013, 0.008, 0.207, 0.075, z, '#c9ced3', 12, [0, 0, Math.PI / 2]);
    B.cyl(0.0105, 0.0105, 0.01, 0.208, 0.075, z, '#fff6d4', 12, [0, 0, Math.PI / 2]);
    B.box(0.006, 0.01, 0.03, -0.206, 0.078, z, '#d6453a');
    B.box(0.006, 0.006, 0.012, -0.207, 0.066, z * 1.15, '#f2a33a');
  }
  B.put(roundBox(0.014, 0.016, 0.182, 0.006).translate(0.211, 0.04, 0), '#cfd4d8');
  B.put(roundBox(0.014, 0.016, 0.182, 0.006).translate(-0.209, 0.04, 0), '#cfd4d8');
  for (const x of [0.219, -0.217]) B.box(0.004, 0.014, 0.046, x, 0.04, 0, '#f4f1e8');
  // Seiten: Türfugen, Griffe, Zierleiste
  for (const z of [0.087, -0.087]) {
    for (const x of wagon ? [0.04, -0.06] : [0.03, -0.065]) B.box(0.002, 0.05, 0.002, x, 0.075, z, '#3a3633');
    for (const x of wagon ? [0.012, -0.088] : [0.0, -0.095]) B.box(0.016, 0.004, 0.004, x, 0.093, z + Math.sign(z) * 0.001, '#cfd4d8');
    B.box(0.3, 0.003, 0.002, 0, 0.058, z + Math.sign(z) * 0.0005, '#cfd4d8');
  }
  for (const z of [0.088, -0.088]) { carWheel(B, 0.125, 0.036, z, 0.036); carWheel(B, -0.125, 0.036, z, 0.036); }
  return fin(B, 1);
}

function bus() {
  const B = new Bld();
  // Wagenkasten mit runden Kanten in Linienfarbe, Fensterband aus Glas, helles Dach mit Klimabox
  B.pf = 1; B.put(roundBox(0.8, 0.12, 0.18, 0.03).translate(0, 0.115, 0), '#ffffff'); B.pf = 0;
  B.put(roundBox(0.66, 0.05, 0.184, 0.012).translate(-0.04, 0.142, 0), '#2c3a44');
  B.put(roundBox(0.02, 0.07, 0.165, 0.008).translate(0.398, 0.132, 0), '#2c3a44');
  B.put(roundBox(0.79, 0.016, 0.176, 0.008).translate(0, 0.18, 0), '#efe9dc');
  B.put(roundBox(0.18, 0.022, 0.12, 0.01).translate(-0.12, 0.196, 0), '#d8d2c6');
  B.box(0.8, 0.018, 0.17, 0, 0.055, 0, '#3a3633');
  for (const z of [0.09, -0.09]) { carWheel(B, 0.26, 0.042, z, 0.042, 0.026); carWheel(B, -0.25, 0.042, z, 0.042, 0.026); }
  for (const z of [0.062, -0.062]) { B.cyl(0.011, 0.011, 0.008, 0.402, 0.085, z, '#fff6d4', 10, [0, 0, Math.PI / 2]); B.box(0.008, 0.02, 0.026, -0.402, 0.09, z, '#d6453a'); }
  // Fensterpfosten, Tür rechts, Linienschild, Spiegel, Stoßstangen, Zierstreifen
  for (let i = 0; i < 8; i++) for (const z of [0.093, -0.093]) B.box(0.01, 0.05, 0.004, -0.36 + i * 0.09, 0.142, z, '#e8e2d6');
  B.box(0.08, 0.11, 0.006, 0.28, 0.07, 0.092, '#4a5660'); B.box(0.002, 0.1, 0.007, 0.28, 0.072, 0.0935, '#cfd4d8');
  B.box(0.006, 0.022, 0.1, 0.404, 0.17, 0, '#2a2726'); B.box(0.006, 0.012, 0.08, 0.406, 0.17, 0, '#ffb24a');
  for (const z of [0.1, -0.1]) B.rod([0.39, 0.16, z * 0.9], [0.415, 0.14, z * 1.05], 0.003, '#2a2726', 4), B.box(0.008, 0.03, 0.012, 0.415, 0.13, z * 1.05, '#2a2726');
  for (const x of [0.405, -0.405]) B.put(roundBox(0.014, 0.024, 0.182, 0.007).translate(x, 0.058, 0), '#4a4a4e');
  for (const z of [0.0905, -0.0905]) B.box(0.66, 0.008, 0.002, -0.04, 0.095, z, '#ffffff');
  return fin(B, 0.95);
}

function truck() {
  const B = new Bld();
  B.box(0.6, 0.025, 0.15, 0, 0.07, 0, '#3a3633');
  // Fahrerhaus mit runden Kanten in Wagenfarbe, Frontscheibe, Seitenfenster, Dachspoiler
  B.pf = 1; B.put(roundBox(0.15, 0.12, 0.17, 0.025).translate(0.2, 0.14, 0), '#ffffff'); B.put(roundBox(0.1, 0.03, 0.16, 0.012).translate(0.19, 0.212, 0), '#ffffff'); B.pf = 0;
  B.put(roundBox(0.012, 0.055, 0.15, 0.005).translate(0.274, 0.165, 0), '#2c3a44');
  for (const z of [0.0855, -0.0855]) B.box(0.06, 0.045, 0.003, 0.225, 0.165, z, '#2c3a44');
  // Kofferaufbau hell mit Rippen und Rahmen
  B.put(roundBox(0.36, 0.15, 0.18, 0.012).translate(-0.08, 0.157, 0), '#f1ece0');
  B.pf = 1; B.put(roundBox(0.364, 0.024, 0.184, 0.008).translate(-0.08, 0.094, 0), '#ffffff'); B.pf = 0;
  for (let i = 0; i < 6; i++) for (const z of [0.091, -0.091]) B.box(0.006, 0.14, 0.004, -0.25 + i * 0.068, 0.157, z, '#d8d2c6');
  for (const z of [0.08, -0.08]) { carWheel(B, 0.2, 0.04, z, 0.04, 0.026); carWheel(B, -0.1, 0.04, z, 0.04, 0.026); carWheel(B, -0.2, 0.04, z, 0.04, 0.026); }
  for (const z of [0.058, -0.058]) { B.cyl(0.011, 0.011, 0.008, 0.276, 0.095, z, '#fff6d4', 10, [0, 0, Math.PI / 2]); B.box(0.006, 0.014, 0.02, -0.262, 0.1, z, '#d6453a'); }
  // Kühlergrill, Spiegel, Tank, Stoßstange, Trittstufe
  B.box(0.006, 0.04, 0.09, 0.276, 0.105, 0, '#2a2726');
  for (let i = 0; i < 3; i++) B.box(0.007, 0.003, 0.084, 0.277, 0.093 + i * 0.012, 0, '#55504c');
  for (const z of [0.095, -0.095]) { B.rod([0.25, 0.19, z * 0.9], [0.27, 0.17, z * 1.08], 0.003, '#2a2726', 4); B.box(0.008, 0.032, 0.012, 0.27, 0.16, z * 1.08, '#2a2726'); }
  B.cyl(0.022, 0.022, 0.06, 0.1, 0.06, 0.08, '#c9ced3', 10, [Math.PI / 2, 0, 0]);
  B.put(roundBox(0.014, 0.024, 0.176, 0.007).translate(0.282, 0.06, 0), '#4a4a4e');
  for (const z of [0.086, -0.086]) B.box(0.04, 0.006, 0.018, 0.22, 0.068, z, '#55504c');
  return fin(B, 0.95);
}

// Typen: Bauart, Anzahl Instanzen, Frontlichter (nur Epoche 6 und 7); exportiert für die Modell-Sammlung
export const TYPES = {
  oxcart: { mk: oxcart, cap: 160, spd: 11, ox: 0.14 },
  handcart: { mk: handcart, cap: 160, spd: 9, ox: 0.13 },
  horsecart: { mk: horsecart, cap: 160, spd: 15, ox: 0.15 },
  carriage: { mk: carriage, cap: 120, spd: 19, ox: 0.15 },
  steamwagon: { mk: steamwagon, cap: 100, spd: 22, ox: 0.16, lamp: [[0.19, 0.12, 0.03], [0.19, 0.12, -0.03]], smoke: [0.17, 0.3] },
  vintage: { mk: vintage, cap: 120, spd: 28, ox: 0.18, lamp: [[0.19, 0.115, 0.05], [0.19, 0.115, -0.05]] },
  sedan: { mk: () => modernCar('sedan'), cap: 200, spd: 38, ox: 0.2, lamp: [[0.2, 0.075, 0.065], [0.2, 0.075, -0.065]] },
  hatch: { mk: () => modernCar('hatch'), cap: 160, spd: 38, ox: 0.2, lamp: [[0.2, 0.075, 0.065], [0.2, 0.075, -0.065]] },
  bus: { mk: bus, cap: 80, spd: 30, ox: 0.38, lamp: [[0.4, 0.085, 0.065], [0.4, 0.085, -0.065]] },
  truck: { mk: truck, cap: 100, spd: 28, ox: 0.29, lamp: [[0.28, 0.09, 0.06], [0.28, 0.09, -0.06]] },
};

// Typ nach Epoche: 1 bis 2 Handkarren und Ochsenkarren, 3 bis 5 Pferdewagen und Kutschen, 6 Dampfwagen und alte Autos, 7 moderne Autos
function typeFor(era, r) {
  if (era <= 2) return r < 0.5 ? 'oxcart' : 'handcart';
  if (era === 3) return r < 0.75 ? 'horsecart' : 'handcart';
  if (era <= 5) return r < 0.55 ? 'horsecart' : 'carriage';
  if (era === 6) return r < 0.5 ? 'steamwagon' : 'vintage';
  return r < 0.4 ? 'sedan' : r < 0.65 ? 'hatch' : r < 0.82 ? 'truck' : 'bus';
}
const paintFor = (type, r) => (type === 'steamwagon' || type === 'vintage' || type === 'carriage' ? pk(OLD, r) : type === 'horsecart' ? pk(['#f0e9d6', '#e6d9b8', '#d9e3d4'], r) : pk(CARS, r));

// ---------- Instanzen ----------
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _M = new THREE.Matrix4();
function put(m, i, x, y, z, yaw, pitch = 0, roll = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(roll, yaw, pitch, 'YZX'); _q.setFromEuler(_e);
  _M.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  m.setMatrixAt(i, _M);
}
const _cc = new Map();
const colOf = h => { let c = _cc.get(h); if (!c) { c = new THREE.Color(h); _cc.set(h, c); } return c; };

// ---------- Linien ----------
function chaikin(pts, it) {
  for (let k = 0; k < it; k++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}
function polyline(pts) {
  const n = pts.length, x = new Float32Array(n), z = new Float32Array(n), cum = new Float32Array(n);
  for (let i = 0; i < n; i++) { x[i] = pts[i][0]; z[i] = pts[i][1]; if (i) cum[i] = cum[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]); }
  return { x, z, cum, n, len: cum[n - 1] };
}
const SM = { x: 0, z: 0 };
function sample(L, d, o = SM) {
  d = clamp(d, 0, L.len);
  let lo = 0, hi = L.n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (L.cum[mid] <= d) lo = mid; else hi = mid; }
  const t = (d - L.cum[lo]) / Math.max(1e-6, L.cum[hi] - L.cum[lo]);
  o.x = lerp(L.x[lo], L.x[hi], t); o.z = lerp(L.z[lo], L.z[hi], t);
  return o;
}
// Fahrtrichtung bei Strecke d (Blick nach vorn und hinten, damit Kurven weich laufen)
const _a = { x: 0, z: 0 }, _b = { x: 0, z: 0 };
function headingAt(L, d, sign = 1) {
  sample(L, d - 0.14, _a); sample(L, d + 0.14, _b);
  const dx = (_b.x - _a.x) * sign, dz = (_b.z - _a.z) * sign;
  return Math.atan2(-dz, dx);
}
// Weg über die Zeit mit sanftem Anfahren und Bremsen
const trapD = (x, a = 0.1) => {
  x = clamp(x);
  const k = 1 / (2 * a * (1 - a));
  if (x < a) return k * x * x;
  if (x > 1 - a) return 1 - k * (1 - x) * (1 - x);
  return (a / 2 + (x - a)) / (1 - a);
};

// Ein Straßenfeld gilt als verbaut, wenn ein Gebäude darauf steht (Felder zählen nicht)
function blockedAt(rt, i) {
  const id = rt.bldAt[i];
  if (!id) return false;
  const b = rt.bById.get(id);
  return !b || b.t !== 'feld';
}

// ---------- Flugzeuge und Luftschiffe ----------
const lin = (a, b, n) => { const r = []; for (let i = 0; i <= n; i++) r.push(a + (b - a) * i / n); return r; };
const RED = new THREE.Color(2.6, 0.35, 0.3), GREEN = new THREE.Color(0.3, 2.4, 0.6), WHITE = new THREE.Color(2.4, 2.4, 2.2);

function lamp(color, r = 0.016) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 5, 4), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  m.visible = false;
  return m;
}

// Tragfläche als Fläche mit Pfeilung, Zuspitzung und V-Stellung (s ist 1 für links, minus 1 für rechts)
function wing(B, s, o) {
  const { x = 0, y = 0, span = 0.7, cr = 0.22, ct = 0.1, sweep = 0.5, dih = 0.06, th = 0.014, c = '#f6f3ec', c2 = '#c3c8cf', inset = 0.04 } = o;
  const us = [0, 0.5, 1], vs = lin(0, 1, 4);
  const P = up => (u, v) => {
    const ch = lerp(cr, ct, u), le = x - u * span * sweep, env = Math.sin(Math.PI * v) * th * (1 - 0.5 * u);
    return [le - v * ch, y + dih * u * span + (up ? env : -env * 0.4), s * (inset + u * span)];
  };
  B.surf(us, vs, P(true), () => c, null, s < 0);
  B.surf(us, vs, P(false), () => c2, null, s > 0);
}

// Düsenflugzeug: Länge 1,05, Spannweite 1,6
function jetGeo(acc) {
  const B = new Bld(), W = '#f6f3ec', G = '#c3c8cf', D = '#8c95a0';
  const rad = v => 0.058 * (v < 0.16 ? lerp(0.22, 1, smooth(v / 0.16)) : v > 0.86 ? Math.sqrt(Math.max(0, 1 - Math.pow((v - 0.86) / 0.14, 2))) * 0.93 + 0.07 : 1);
  B.surf(lin(0, 1, 10), lin(0, 1, 18), (u, v) => {
    const a = u * Math.PI * 2, r = rad(v);
    return [lerp(-0.52, 0.53, v), Math.sin(a) * r + 0.035 * Math.pow(Math.max(0, 1 - v / 0.24), 2), Math.cos(a) * r];
  }, (i, j) => {
    if (j >= 16) return D;
    if (j < 2) return G;
    if ((i === 9 || i === 0 || i === 4 || i === 5) && j >= 3 && j <= 14) return acc;
    return i >= 6 && i <= 8 ? G : W;
  });
  for (let k = 0; k < 10; k++) for (const z of [0.0585, -0.0585]) B.box(0.02, 0.014, 0.004, lerp(-0.24, 0.3, k / 9), 0.016, z, '#8db3c6');
  B.box(0.02, 0.02, 0.05, 0.43, 0.022, 0, '#8db3c6');
  for (const s of [1, -1]) {
    wing(B, s, { x: 0.1, y: -0.03, span: 0.74, cr: 0.26, ct: 0.1, sweep: 0.62, dih: 0.07 });
    B.box(0.1, 0.04, 0.012, -0.4, 0.045, s * 0.78, acc);
    wing(B, s, { x: -0.4, y: 0.03, span: 0.3, cr: 0.15, ct: 0.07, sweep: 0.5, dih: 0.02, th: 0.01, inset: 0.02 });
    B.cyl(0.034, 0.028, 0.18, 0.1, -0.075, s * 0.25, G, 8, [0, 0, Math.PI / 2]);
    B.cyl(0.024, 0.034, 0.02, 0.2, -0.075, s * 0.25, D, 8, [0, 0, Math.PI / 2]);
    B.cone(0.022, 0.05, 0.0, -0.075, s * 0.25, D, 8, [0, 0, Math.PI / 2]);
    B.box(0.06, 0.05, 0.012, 0.08, -0.045, s * 0.25, G);
  }
  B.box(0.16, 0.16, 0.012, -0.45, 0.13, 0, acc, 0, 0, 0.45);
  B.box(0.05, 0.05, 0.014, -0.49, 0.2, 0, W, 0, 0, 0.45);
  return B.done(false);
}

// Propellermaschine: Länge 0,8, Spannweite 1,3
function propGeo(acc) {
  const B = new Bld(), C = '#f1e8d2', D = '#6d5a48';
  const rad = v => 0.05 * (v < 0.2 ? lerp(0.2, 1, smooth(v / 0.2)) : v > 0.9 ? Math.sqrt(Math.max(0, 1 - Math.pow((v - 0.9) / 0.1, 2))) * 0.9 + 0.1 : 1);
  B.surf(lin(0, 1, 10), lin(0, 1, 14), (u, v) => {
    const a = u * Math.PI * 2, r = rad(v);
    return [lerp(-0.4, 0.38, v), Math.sin(a) * r + 0.02 * Math.pow(Math.max(0, 1 - v / 0.3), 2), Math.cos(a) * r];
  }, (i, j) => (j >= 13 ? D : (i === 9 || i === 0 || i === 4 || i === 5) && j >= 3 ? acc : C));
  for (const sg of [1, -1]) {
    wing(B, sg, { x: 0.12, y: 0.07, span: 0.62, cr: 0.24, ct: 0.17, sweep: 0.08, dih: 0.0, th: 0.016, c: acc, c2: C, inset: 0.0 });
    B.rod([0.04, 0.045, sg * 0.04], [0.0, 0.07, sg * 0.34], 0.006, D, 4); B.rod([-0.02, 0.045, sg * 0.04], [-0.04, 0.07, sg * 0.34], 0.006, D, 4);
    wing(B, sg, { x: -0.31, y: 0.03, span: 0.2, cr: 0.12, ct: 0.08, sweep: 0.1, dih: 0.0, th: 0.01, c: acc, c2: C, inset: 0.0 });
  }
  B.box(0.12, 0.12, 0.012, -0.36, 0.08, 0, acc, 0, 0, 0.3);
  B.cone(0.034, 0.07, 0.4, 0.0, 0, D, 8, [0, 0, -Math.PI / 2]);
  const gear = new Bld();
  for (const s of [1, -1]) { gear.rod([0.1, -0.03, s * 0.03], [0.1, -0.09, s * 0.1], 0.006, D, 4); wheel(gear, 0.1, -0.1, s * 0.105, 0.032, '#2f2b2c', '#cfc8ba', 0.02); }
  wheel(gear, -0.35, -0.0, 0, 0.014, '#2f2b2c', '#cfc8ba', 0.012);
  return { body: B.done(false), gear: gear.done(false) };
}

// Luftschiff: Länge 2,5
function blimpGeo(acc) {
  const B = new Bld(), H = '#ebe6d8';
  B.sph(1, 0, 0, 0, H, 1.25, 0.34, 0.34, 16, 10);
  for (let k = -3; k <= 3; k++) {
    const x = k * 0.3, r = 0.34 * Math.sqrt(Math.max(0, 1 - (x / 1.25) ** 2));
    B.cyl(r + 0.004, r + 0.004, 0.025, x, 0, 0, k % 2 ? acc : '#d9d2c0', 14, [0, 0, Math.PI / 2]);
  }
  B.cone(0.045, 0.1, 1.28, 0, 0, '#8c95a0', 6, [0, 0, -Math.PI / 2]);
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    B.box(0.34, 0.2, 0.012, -1.0, Math.sin(a) * 0.26, Math.cos(a) * 0.26, a % Math.PI ? acc : H, a % Math.PI ? 0 : 0, 0, 0);
  }
  B.box(0.34, 0.012, 0.2, -1.0, 0, 0, H); B.box(0.34, 0.2, 0.012, -1.0, 0, 0, H);
  B.box(0.46, 0.11, 0.16, 0.1, -0.44, 0, '#a37a52'); B.box(0.46, 0.04, 0.165, 0.1, -0.42, 0, '#8db3c6'); B.box(0.1, 0.1, 0.12, 0.35, -0.44, 0, '#8db3c6');
  for (const x of [-0.05, 0.25]) for (const z of [0.05, -0.05]) B.rod([x, -0.38, z], [x, -0.3, z * 1.8], 0.006, '#575c66', 4);
  for (const s of [1, -1]) { B.box(0.1, 0.07, 0.07, -0.3, -0.33, s * 0.3, '#8c95a0'); B.rod([-0.3, -0.31, s * 0.3], [-0.2, -0.2, s * 0.22], 0.006, '#575c66', 4); B.cone(0.03, 0.05, -0.36, -0.33, s * 0.3, '#575c66', 6, [0, 0, Math.PI / 2]); }
  return B.done(false);
}

// Zeit über Weg mit Beschleunigung a an beiden Enden (a je nach Rollstrecke)
const trapA = (x, a) => trapD(x, a);
const yawOf = v => Math.atan2(-v.z, v.x);

class Air {
  constructor(scene, fx) {
    this.scene = scene; this.fx = fx;
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide });
    this.units = []; this.strips = new Map();
    this.st = null; this.pairT = -99; this.first = true;
    this.field = null; this.fieldKey = ''; this.lights = null;
    this.stat = { planes: 0, zeps: 0, flying: 0 };
  }

  reset(st) {
    for (const u of this.units) this.scene.remove(u.g);
    this.units = []; this.strips.clear(); this.pairT = -99; this.st = st; this.first = true;
    if (this.field) { this.scene.remove(this.field); this.field.geometry.dispose(); this.field = null; }
    if (this.lights) { this.scene.remove(this.lights); this.lights = null; }
    this.fieldKey = '';
  }

  // Flugplatz eines Ortes: gerader, freier Streifen am Ortsrand (seit 19.10.2026 16 bis 22 Felder, siehe findStrip)
  strip(st, s, T) {
    const c = this.strips.get(s.id);
    if (c && (c.s || T - c.T < 30)) return c.s;
    // liegt schon ein Flugplatz in der Nähe, benutzen beide Orte ihn gemeinsam
    for (const o of this.strips.values()) {
      if (!o.s || o.s.isle !== s.isle) continue;
      if (Math.hypot(wx(s.cx) - (o.s.x0 + o.s.x1) / 2, wz(s.cy) - (o.s.z0 + o.s.z1) / 2) < 26) { this.strips.set(s.id, { s: o.s, T }); return o.s; }
    }
    const Tl = st.tiles, rt = st._rt, h = Tl.h, found = this.findStrip(st, s, Tl, rt, h);
    if (found) found.isle = s.isle;
    this.strips.set(s.id, { s: found, T });
    return found;
  }

  // Flugplatz suchen (seit 19.10.2026 in echter Länge, Naders Wunsch: die Bahn war viel zu kurz): ein gerader Streifen
  // von 22, sonst 18, 15 oder 12 Feldern nahe am Ort, frei von Häusern, Straßen und Flüssen (Wald weicht), höchstens eine Höhenstufe
  // Unterschied (das Gelände wird darunter eingeebnet, siehe pads und terrain.applyRoadBed). Daneben Platz für Rollweg
  // und Vorfeld. Gibt es so etwas nicht, bekommt der Ort keinen Flugplatz (vorher eine Bahn von höchstens 6 Feldern).
  findStrip(st, s, Tl, rt, h) {
    const net = rt.roadNet;
    // Wald darf weichen (Bäume werden auf dem Platz nicht gezeichnet), Häuser, Straßen und Flüsse nicht
    const ok = (x, y, side) => {
      if (x < 2 || y < 2 || x >= NX - 2 || y >= NY - 2) return false;
      const i = y * NX + x;
      if (rt.bldAt[i] || rt.isleOf[i] !== s.isle) return false;
      if (side) return h[i] >= 0;
      if (h[i] < 1 || h[i] > 3 || Tl.burn[i] || Tl.river[i]) return false;
      return !(net && net[i]);
    };
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]], R0 = Math.ceil(s.R || 8);
    for (const need of [22, 18, 15, 12]) {
      let best = null;
      for (let r = 2; r <= R0 + 26; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = s.cx + dx, y = s.cy + dy;
          if (!ok(x, y, false)) continue;
          const lvl = h[y * NX + x];
          for (const [ax, ay] of dirs) {
            let good = true, lo = lvl, hi = lvl, mix = 0;
            for (let k = 0; k < need && good; k++) {
              const px = x + ax * k, py = y + ay * k;
              if (!ok(px, py, false) || !ok(px - ay, py + ax, true) || !ok(px + ay, py - ax, true)) { good = false; break; }
              // Vorfeld und Rollweg auf einer Seite (zwei Felder breit) in der mittleren Hälfte
              if (k > need * 0.3 && k < need * 0.7 && (!ok(px - 2 * ay, py + 2 * ax, true))) { good = false; break; }
              const l = h[py * NX + px]; lo = Math.min(lo, l); hi = Math.max(hi, l); if (l !== lvl) mix++;
              if (hi - lo > 1) good = false;
            }
            if (!good) continue;
            let wood = 0; for (let k = 0; k < need; k++) wood += Tl.tree[(y + ay * k) * NX + x + ax * k];
            const score = r * 0.7 + mix * 0.35 + wood * 0.15 + (ax && ay ? 1.2 : 0) + hsh(x, y) * 0.6;
            if (!best || score < best.score) best = { score, x, y, ax, ay };
          }
        }
        if (best && r > best.score + 3) break;
      }
      if (best) {
        const { x, y, ax, ay } = best, k = Math.hypot(ax, ay), n = need - 1, x0 = wx(x), z0 = wz(y), x1 = wx(x + ax * n), z1 = wz(y + ay * n);
        // Bahnhöhe: Mittel der Bodenhöhe entlang des Streifens (darauf wird eingeebnet)
        let sum = 0; for (let q = 0; q <= n; q++) sum += groundY(wx(x + ax * q), wz(y + ay * q));
        const tiles = [];
        for (let q = -1; q <= n + 1; q++) for (let l = -1; l <= 2; l++) tiles.push((y + ay * q + ax * l) * NX + (x + ax * q - ay * l));
        return { x0, z0, x1, z1, dx: ax / k, dz: ay / k, len: n * k, y: Math.max(0.2, sum / (n + 1)), sid: s.id, side: -1, tiles };
      }
    }
    return null;
  }

  // Gewünschte Flüge: Orte mit Luftfahrt (Flugzeuge) oder Elektrizität (Luftschiffe), die durch Handel oder Kontakt verbunden sind
  sync(st, T) {
    const rt = st._rt, sets = st.settlements.filter(s => s.alive && (s.pop | 0) >= 12).sort((a, b) => a.id - b.id);
    const rv = new Map();
    for (const r of st.routes || []) rv.set(r.a < r.b ? r.a + '|' + r.b : r.b + '|' + r.a, r.val || 0);
    const cand = [];
    for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i], b = sets[j], key = a.id + '|' + b.id;
      const plane = knows(st, 'luftfahrt', a) || knows(st, 'luftfahrt', b);
      const zep = !plane && (knows(st, 'strom', a) || knows(st, 'strom', b));
      if (!plane && !zep) continue;
      const dist = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      if (dist < 18) continue;
      const Ia = rt.iById.get(a.isle), Ib = rt.iById.get(b.isle), v = rv.get(key);
      const big = zep ? 60 : 40;
      const linked = v != null || (a.isle !== b.isle ? !!(Ia && Ib && Ia.contact && Ia.contact[Ib.id] && a.pop >= big && b.pop >= big) : a.pop >= big + 10 && b.pop >= big + 10);
      if (!linked) continue;
      cand.push({ key: key + (plane ? 'p' : 'z'), a, b, kind: plane ? 'plane' : 'zep', score: (v || 0) * 0.5 + (a.pop + b.pop) / 20 + Math.min(dist, 60) * 0.1 });
    }
    cand.sort((x, y) => y.score - x.score);
    const want = new Map(), load = new Map();
    let np = 0, nz = 0;
    for (const c of cand) {
      if (c.kind === 'plane' ? np >= 8 : nz >= 3) continue;
      if ((load.get(c.a.id) || 0) >= 2 || (load.get(c.b.id) || 0) >= 2) continue;
      if (c.kind === 'plane') { const sa = this.strip(st, c.a, T), sb = this.strip(st, c.b, T); if (!sa || !sb || sa === sb) continue; }
      want.set(c.key, c);
      load.set(c.a.id, (load.get(c.a.id) || 0) + 1); load.set(c.b.id, (load.get(c.b.id) || 0) + 1);
      if (c.kind === 'plane') np++; else nz++;
    }
    for (const u of this.units) { u.retire = !want.has(u.key); want.delete(u.key); }
    for (const c of want.values()) { const u = this.make(st, c, T); if (u) this.units.push(u); }
    this.pairT = T;
    this.first = false;
    this.dress();
  }

  // Flugplätze der Flugzeuge: Piste, Hangar, Windsack und Randfeuer, in einem Stück gebaut
  dress() {
    const strips = [...new Set(this.units.filter(u => u.kind === 'plane').flatMap(u => [u.a, u.b]).map(id => { const c = this.strips.get(id); return c && c.s; }).filter(Boolean))];
    const key = strips.map(sp => sp.x0.toFixed(1) + ',' + sp.z0.toFixed(1)).sort().join('|');
    if (key === this.fieldKey) return;
    this.fieldKey = key;
    if (this.field) { this.scene.remove(this.field); this.field.geometry.dispose(); this.field = null; }
    if (this.lights) { this.scene.remove(this.lights); this.lights.geometry.dispose(); this.lights = null; }
    if (!strips.length) { if (this.onPads) this.onPads([]); return; }
    const B = new Bld(), dots = [];
    const flat = (w, d, x, y, z, yaw, c) => B.put(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).rotateY(yaw).translate(x, y, z), c);
    const solid = (g, x, y, z, yaw, c) => B.put(g.rotateY(yaw).translate(x, y, z), c);
    for (const sp of strips) {
      const yaw = Math.atan2(-sp.dz, sp.dx), y = sp.y + 0.035, mx = (sp.x0 + sp.x1) / 2, mz = (sp.z0 + sp.z1) / 2, L = sp.len + 1.0;
      const ax = (a, l) => [mx + sp.dx * a + sp.dz * l, mz + sp.dz * a - sp.dx * l];
      const sd = sp.side || -1;
      // Bahn mit Schulter, Mittellinie, Schwellen und Zielmarken
      flat(L, 0.66, mx, y, mz, yaw, '#7d8085');
      flat(L + 0.3, 0.78, mx, y - 0.008, mz, yaw, '#b9b29f');
      for (let k = -Math.floor(L / 2 - 1.2); k <= L / 2 - 1.2; k += 0.8) { const [x, z] = ax(k, 0); flat(0.34, 0.03, x, y + 0.004, z, yaw, '#f1ece0'); }
      for (const e of [-1, 1]) {
        for (let q = -3; q <= 3; q++) { if (!q) continue; const [x, z] = ax(e * (L / 2 - 0.22), q * 0.085); flat(0.24, 0.045, x, y + 0.004, z, yaw, '#f1ece0'); }
        for (const l of [-0.16, 0.16]) { const [x, z] = ax(e * (L / 2 - 1.6), l); flat(0.5, 0.07, x, y + 0.004, z, yaw, '#f1ece0'); }
      }
      // Rollweg parallel, zwei Verbindungen, Vorfeld in der Mitte (auf der freien Seite)
      const [tx, tz] = ax(0, sd * 0.85);
      flat(L * 0.82, 0.26, tx, y - 0.002, tz, yaw, '#8a8d92');
      for (let k = -L * 0.38; k <= L * 0.38; k += 0.62) { const [x, z] = ax(k, sd * 0.85); flat(0.18, 0.012, x, y + 0.002, z, yaw, '#e9c46a'); }
      for (const e of [-1, 1]) { const [x, z] = ax(e * L * 0.4, sd * 0.43); flat(0.26, 0.5, x, y - 0.003, z, yaw, '#8a8d92'); }
      const [px, pz] = ax(0, sd * 1.45);
      flat(L * 0.3, 0.9, px, y - 0.004, pz, yaw, '#9a9c9f');
      for (let k = -L * 0.12; k <= L * 0.12; k += 0.55) { const [x, z] = ax(k, sd * 1.45); flat(0.012, 0.6, x, y, z, yaw, '#f1ece0'); }
      // Hangars, Tower mit Glaskanzel, Terminal, Windsack
      for (const e of [-1, 1]) {
        const [hx, hz] = ax(e * L * 0.2, sd * 2.25), hy = sp.y;
        solid(new THREE.BoxGeometry(1.1, 0.34, 0.7).translate(0, 0.17, 0), hx, hy, hz, yaw, '#e6dfcd');
        solid(new THREE.CylinderGeometry(0.36, 0.36, 1.1, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.55, 1).translate(0, 0.34, 0), hx, hy, hz, yaw, '#8fa0b0');
        solid(new THREE.BoxGeometry(0.02, 0.26, 0.48).translate(0.56, 0.14, 0), hx, hy, hz, yaw, '#6d7480');
      }
      const [gx, gz] = ax(0, sd * 2.3);
      solid(new THREE.BoxGeometry(1.0, 0.22, 0.5).translate(0, 0.11, 0), gx, sp.y, gz, yaw, '#efe9dc');
      solid(new THREE.BoxGeometry(0.98, 0.07, 0.02).translate(0, 0.14, sd * -0.26), gx, sp.y, gz, yaw, '#7fa6bd');
      const [cx, cz] = ax(-L * 0.36, sd * 2.0);
      solid(new THREE.CylinderGeometry(0.07, 0.09, 0.75, 10).translate(0, 0.375, 0), cx, sp.y, cz, 0, '#e6dfcd');
      solid(new THREE.CylinderGeometry(0.15, 0.12, 0.12, 10).translate(0, 0.81, 0), cx, sp.y, cz, 0, '#7fa6bd');
      solid(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 10).translate(0, 0.885, 0), cx, sp.y, cz, 0, '#d9d2c0');
      const [wx_, wz_] = ax(L / 2 - 0.6, sd * -0.9);
      solid(new THREE.CylinderGeometry(0.012, 0.014, 0.42, 5).translate(0, 0.21, 0), wx_, sp.y, wz_, 0, '#d9d2c0');
      solid(new THREE.ConeGeometry(0.06, 0.2, 8, 1, true).rotateZ(-Math.PI / 2).translate(0.1, 0.4, 0), wx_, sp.y, wz_, 0.7, '#e08e72');
      // Randfeuer der Bahn und Anflugfeuer vor den Schwellen
      for (let k = -L / 2 + 0.3; k <= L / 2 - 0.25; k += 0.62) for (const l of [-0.37, 0.37]) { const [x, z] = ax(k, l); dots.push([x, y + 0.03, z]); }
      for (const e of [-1, 1]) for (let q = 1; q <= 4; q++) { const [x, z] = ax(e * (L / 2 + q * 0.35), 0); dots.push([x, groundY(x, z) + 0.05, z]); }
    }
    // Gelände unter Bahn, Rollweg und Vorfeld einebnen (terrain.applyRoadBed), Bäume dort nicht zeichnen
    if (this.onPads) this.onPads(strips.map(sp => ({ x0: sp.x0, z0: sp.z0, x1: sp.x1, z1: sp.z1, dx: sp.dx, dz: sp.dz, y: sp.y, side: sp.side || -1, tiles: sp.tiles || [] })));
    this.field = new THREE.Mesh(B.done(false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    this.field.receiveShadow = true; this.field.castShadow = true;
    this.scene.add(this.field);
    if (dots.length) {
      this.lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.02, 5, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.1, 1.1), toneMapped: false }), dots.length);
      dots.forEach((d, i) => { _M.makeTranslation(d[0], d[1], d[2]); this.lights.setMatrixAt(i, _M); });
      this.lights.frustumCulled = false; this.lights.visible = false;
      this.scene.add(this.lights);
    }
  }

  // Flugbahn von Ort X nach Ort Y: Start am Streifen, Steigflug, Reise, Sinkflug, Landung. Höhe als Funktion der Strecke.
  flight(X, Y, kind, H) {
    let pts, run = 0, runB = 0;
    const bx = Y.x - X.x, bz = Y.z - X.z, bl = Math.hypot(bx, bz), ux = bx / bl, uz = bz / bl;
    if (kind === 'plane') {
      const sT = X.s.dx * ux + X.s.dz * uz >= 0 ? 1 : -1, sL = Y.s.dx * ux + Y.s.dz * uz >= 0 ? 1 : -1;
      const S = sT > 0 ? [X.s.x0, X.s.z0] : [X.s.x1, X.s.z1], dT = [X.s.dx * sT, X.s.dz * sT];
      const T0 = sL > 0 ? [Y.s.x0, Y.s.z0] : [Y.s.x1, Y.s.z1], dL = [Y.s.dx * sL, Y.s.dz * sL];
      run = X.s.len; runB = Y.s.len;
      const A = [S[0] + dT[0] * (run + 5), S[1] + dT[1] * (run + 5)], Bp = [T0[0] - dL[0] * 10, T0[1] - dL[1] * 10];
      pts = [S, [S[0] + dT[0] * run, S[1] + dT[1] * run], A, [lerp(A[0], Bp[0], 0.33), lerp(A[1], Bp[1], 0.33)], [lerp(A[0], Bp[0], 0.66), lerp(A[1], Bp[1], 0.66)], Bp, T0, [T0[0] + dL[0] * runB, T0[1] + dL[1] * runB]];
    } else {
      pts = [[X.x, X.z], [lerp(X.x, Y.x, 0.5) + uz * 2, lerp(X.z, Y.z, 0.5) - ux * 2], [Y.x, Y.z]];
    }
    const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal');
    c.arcLengthDivisions = 300;
    const len = c.getLength();
    return { c, len, run, runB, y0: yawOf(c.getTangentAt(0.001)), y1: yawOf(c.getTangentAt(0.999)), gA: X.y, gB: Y.y, H, kind };
  }

  make(st, c, T) {
    const rt = st._rt, plane = c.kind === 'plane';
    const home = plane ? (knows(st, 'luftfahrt', c.a) ? c.a : c.b) : (knows(st, 'strom', c.a) ? c.a : c.b);
    const I = rt.iById.get(home.isle), era = I ? I.era | 0 : 6;
    const ends = [c.a, c.b].map(s => plane ? { s: this.strip(st, s, T), id: s.id } : { s, id: s.id });
    if (plane && (!ends[0].s || !ends[1].s)) return null;
    const mk = (e, s) => plane ? { x: e.s.x0, z: e.s.z0, y: e.s.y, s: e.s } : { x: wx(s.cx), z: wz(s.cy), y: 0 };
    const X = mk(ends[0], c.a), Y = mk(ends[1], c.b);
    const H = plane ? 10 + hsh(c.a.id, c.b.id) * 6 : 7;
    const F = this.flight(X, Y, c.kind, H), Rv = this.flight(Y, X, c.kind, H);
    const sp = plane ? (era >= 7 ? 72 : 48) : 20;
    const acc = c.a.color || '#e07a5f';
    const u = { key: c.key, kind: c.kind, era, a: c.a.id, b: c.b.id, F, R: Rv, sp, accent: plane ? acc : c.b.color || '#6f93bd', retire: false, jet: plane && era >= 7, nx: hsh(c.a.id, 3.3) };
    for (const L of [F, Rv]) {
      const run = L.run || 3;
      L.a = plane ? clamp(2.2 * run / (L.len + 2.2 * run), 0.06, 0.3) : 0.12;
      L.T = L.len / (sp * (1 - L.a));
    }
    u.D = plane ? 0.7 + 0.3 * hsh(c.a.id, 7) : 0.9; u.Tn = plane ? 0.14 : 0.3;
    u.C = 2 * u.D + 2 * u.Tn + F.T + Rv.T;
    // am Anfang verteilt, später beginnt ein neues Flugzeug geparkt am Platz A
    u.off = this.first ? hsh(c.a.id * 1.3, c.b.id) * u.C : (u.C - (T % u.C)) % u.C + 0.02;
    // Drehsinn auf dem Boden
    u.ts = hsh(c.b.id, c.a.id) < 0.5 ? 1 : -1;
    // Bauteile
    const g = new THREE.Group();
    if (plane && u.jet) {
      const m = new THREE.Mesh(jetGeo(u.accent), this.mat); m.castShadow = true; g.add(m);
      u.eng = [[0.0, -0.075, 0.25], [0.0, -0.075, -0.25]];
      u.lights = [[-0.41, 0.03, 0.8, RED], [-0.41, 0.03, -0.8, GREEN], [-0.5, 0.2, 0.0, WHITE]];
    } else if (plane) {
      const P = propGeo(u.accent), m = new THREE.Mesh(P.body, this.mat); m.castShadow = true; g.add(m);
      u.gear = new THREE.Mesh(P.gear, this.mat); g.add(u.gear);
      u.prop = new THREE.Group(); u.prop.position.set(0.42, 0, 0);
      const bl = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.2, 0.02).translate(0, 0, 0), new THREE.MeshStandardMaterial({ color: '#4a3f3a' }));
      u.prop.add(bl, new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.02, 0.2), new THREE.MeshStandardMaterial({ color: '#4a3f3a' })));
      u.prop.add(new THREE.Mesh(new THREE.CircleGeometry(0.11, 14).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide })));
      g.add(u.prop);
      u.eng = [[0.4, 0.0, 0.0]];
      u.lights = [[0.02, 0.07, 0.64, RED], [0.02, 0.07, -0.64, GREEN], [-0.4, 0.12, 0.0, WHITE]];
    } else {
      const m = new THREE.Mesh(blimpGeo(u.accent), this.mat); m.castShadow = true; g.add(m);
      u.eng = [];
      u.lights = [[1.28, 0.0, 0.0, WHITE], [-1.1, 0.26, 0.0, RED], [0.1, -0.5, 0.0, GREEN]];
    }
    u.lamps = u.lights.map(([x, y, z, c]) => { const l = lamp(c, plane ? 0.017 : 0.03); l.position.set(x, y, z); l.material.color.copy(c); g.add(l); return l; });
    g.visible = false;
    this.scene.add(g);
    u.g = g; u.ph = Math.random() * 6.28; u.pd = -1; u.yA = X.y; u.yB = Y.y;
    return u;
  }

  // Lage zur Zykluszeit
  pose(u, c, P) {
    const { F, R } = u, D = u.D, Tn = u.Tn;
    P.turn = false; P.fly = false; P.park = -1; P.mv = 0;
    const stop = (Lq, end) => { const t = end ? 0.9999 : 0.0001, p = Lq.c.getPointAt(t); P.x = p.x; P.z = p.z; P.yaw = end ? Lq.y1 : Lq.y0; };
    if (c < D) { stop(R, true); P.s = R.len; P.L = R; P.park = c / D; P.at = 'A'; P.fly = false; return; }
    c -= D;
    if (c < Tn) { const p = R.c.getPointAt(0.9999); P.x = p.x; P.z = p.z; P.yaw = R.y1 + u.ts * Math.PI * smooth(c / Tn) + wrapPi(F.y0 - (R.y1 + u.ts * Math.PI)) * smooth(c / Tn); P.s = 0; P.L = F; P.park = -1; P.turn = true; P.fly = false; P.at = 'A'; return; }
    c -= Tn;
    if (c < F.T) { this.fly(F, c / F.T, P); return; }
    c -= F.T;
    if (c < D) { stop(F, true); P.s = F.len; P.L = F; P.park = c / D; P.at = 'B'; P.fly = false; return; }
    c -= D;
    if (c < Tn) { const p = F.c.getPointAt(0.9999); P.x = p.x; P.z = p.z; P.yaw = F.y1 + u.ts * Math.PI * smooth(c / Tn) + wrapPi(R.y0 - (F.y1 + u.ts * Math.PI)) * smooth(c / Tn); P.s = 0; P.L = R; P.park = -1; P.turn = true; P.fly = false; P.at = 'B'; return; }
    c -= Tn;
    this.fly(R, clamp(c / R.T), P);
  }

  fly(L, x, P) {
    const s = trapA(clamp(x), L.a) * L.len, pt = L.c.getPointAt(clamp(s / L.len)), tan = L.c.getTangentAt(clamp(s / L.len, 0.001, 0.999));
    P.x = pt.x; P.z = pt.z; P.yaw = yawOf(tan); P.s = s; P.L = L; P.park = -1; P.turn = false; P.fly = true;
    P.mv = Math.min(1, Math.min(x, 1 - x) / 0.08);
  }

  // Höhe über dem Boden zur Strecke s: Rollen, Steigen, Reisen, Sinken, Rollen
  altOf(L, s) {
    if (L.kind === 'zep') { const k = Math.min(s, L.len - s) / 12; return 5.4 + (L.H - 5.4) * smooth(k); }
    const up = smooth(seg(s, L.run * 0.85, L.run * 0.85 + 22)), dn = 1 - smooth(seg(s, L.len - L.runB - 26, L.len - L.runB * 0.9));
    return L.H * Math.min(up, dn);
  }

  update(st, T, t, rise, night, dts) {
    if (st !== this.st) this.reset(st);
    if (T - this.pairT >= 6 || T < this.pairT) this.sync(st, T);
    this.stat.planes = 0; this.stat.zeps = 0; this.stat.flying = 0;
    if (this.lights) this.lights.visible = night > 0.25;
    const P = { x: 0, z: 0, yaw: 0, s: 0, L: null, park: -1, fly: false, at: '', mv: 0, turn: false };
    for (const u of this.units.slice()) {
      const C = u.C, c = (((T + u.off) % C) + C) % C;
      this.pose(u, c, P);
      if (u.retire && P.park > 0.3) { this.scene.remove(u.g); this.units.splice(this.units.indexOf(u), 1); continue; }
      const L = P.L, plane = u.kind === 'plane';
      const alt = P.fly ? this.altOf(L, P.s) : (P.turn || P.park >= 0 ? (plane ? 0 : 5.4) : 0);
      const gnd = groundY(P.x, P.z);
      const base = plane ? (P.fly ? lerp(L.gA, L.gB, smooth(seg(P.s / L.len, 0.3, 0.7))) : P.at === 'A' ? u.yA : u.yB) : 0;
      let y;
      if (plane) y = Math.max(base + (u.jet ? 0.085 : 0.1) + alt, alt > 0.5 ? gnd + 2.5 : base + 0.09);
      else y = Math.max(alt + 1.0 * 0, gnd + 2.5);
      // Neigung und Querlage
      let pitch = 0, roll = 0;
      if (P.fly) {
        const a1 = this.altOf(L, Math.min(L.len, P.s + 0.6)), a0 = this.altOf(L, Math.max(0, P.s - 0.6));
        pitch = Math.atan2(a1 - a0, 1.2) * (plane ? 0.55 : 0.3);
        const p2 = L.c.getTangentAt(clamp((P.s + 1.5) / L.len, 0.001, 0.999)), p1 = L.c.getTangentAt(clamp((P.s - 1.5) / L.len, 0.001, 0.999));
        roll = clamp(wrapPi(yawOf(p2) - yawOf(p1)) * (plane ? 3.2 : 1.2), -0.5, 0.5);
      }
      if (!plane) { y += Math.sin(t * 0.7 + u.ph) * 0.12; roll += Math.sin(t * 0.5 + u.ph) * 0.02; }
      u.g.visible = true;
      u.g.position.set(P.x, y, P.z);
      _e.set(roll, P.yaw, pitch, 'YZX'); u.g.quaternion.setFromEuler(_e);
      if (plane) this.stat.planes++; else this.stat.zeps++;
      if (P.fly) this.stat.flying++;
      if (u.prop) { u.prop.rotation.x = t * (P.fly || P.turn ? 55 : 0) + u.ph; }
      if (u.gear) u.gear.visible = alt < 1.2;
      // Kondensstreifen auf Reiseflughöhe, alle halbe Feldlänge ein Wölkchen je Triebwerk
      if (plane && P.fly && alt > L.H * 0.55) {
        if (u.pd < 0) u.pd = P.s;
        const step = 0.55; let n = 0;
        while (P.s - u.pd >= step && n++ < 3) {
          u.pd += step;
          const k = clamp(u.pd / L.len), q = L.c.getPointAt(k);
          const cy = Math.cos(P.yaw), sy = Math.sin(P.yaw);
          for (const e of u.eng) this.fx.smoke.emit({ x: q.x + e[0] * cy + e[2] * sy, y: y + e[1], z: q.z - e[0] * sy + e[2] * cy, vy: 0.02, life: 4.2, size: u.jet ? 0.1 : 0.07, grow: 2.2, c: [1, 1, 1], a: 0.36 });
        }
        if (P.s < u.pd) u.pd = P.s;
      } else u.pd = -1;
      // Positionslichter blinken nachts
      const on = night > 0.25;
      u.lamps.forEach((l, i) => { l.visible = on && (i < 2 || Math.sin(t * 5 + u.ph) > 0.82); });
    }
  }
}

export class Vehicles {
  constructor(scene, fx, stage) {
    this.scene = scene; this.fx = fx; this.stage = stage;
    this.mat = paintable(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 }), 0.3); // Lack glänzt (seit 24.10.2026)
    this.mesh = {}; this.cnt = {};
    for (const [name, T] of Object.entries(TYPES)) {
      const m = new THREE.InstancedMesh(T.mk(), this.mat, T.cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(T.cap * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.frustumCulled = false; m.castShadow = true; m.userData.type = name;
      // Maße für die Verkehrsregeln: halbe Länge und Breite, Mitte vor dem Ursprung (Zugtiere ragen nach vorn)
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox;
      T.hl = (bb.max.x - bb.min.x) / 2; T.hw = (bb.max.z - bb.min.z) / 2; T.cx = (bb.max.x + bb.min.x) / 2;
      scene.add(m);
      this.mesh[name] = m; this.cnt[name] = 0;
    }
    // Frontlichter: leuchtende Kugeln und ein weicher Lichtfleck auf der Straße
    this.bulb = new THREE.InstancedMesh(new THREE.SphereGeometry(0.014, 5, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.2, 1.4), toneMapped: false }), 900);
    this.bulb.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.bulb.count = 0; this.bulb.frustumCulled = false;
    this.poolMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uA: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uA; varying vec2 vUv; void main(){ float r = length((vUv - 0.5) * 2.0); float a = smoothstep(1.0, 0.0, r); a *= a * uA; gl_FragColor = vec4(1.0, 0.84, 0.52, a); }',
    });
    this.pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.poolMat, 450);
    this.pool.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.pool.count = 0; this.pool.frustumCulled = false; this.pool.renderOrder = 2;
    scene.add(this.bulb, this.pool);
    this.nb = 0; this.np = 0; this.vid = 0; this.extra = []; this.people = null; this.streets = null; this.O = new Occ();
    this.st = null; this.roads = new Map(); this.towns = new Map();
    this.syncT = -99; this.townT = -99; this.lastT = 0; this.lastTT = 0; this.sec = 0; this.budget = 0;
    this.demo = []; this.stat = { roads: 0, road: 0, town: 0, shown: 0, air: 0 };
    this.cam = stage && stage.camera ? stage.camera.position : new THREE.Vector3(0, 100, 0);
    this.tgt = stage && stage.controls ? stage.controls.target : new THREE.Vector3(0, 0, 0);
    this.air = new Air(scene, fx);
    this.air.onPads = pads => { if (this.onPads) this.onPads(pads); }; // Flugplätze ans Gelände melden (main.js)
  }

  reset(st) {
    this.st = st; this.roads.clear(); this.towns.clear(); this.syncT = -99; this.townT = -99;
    this.air.reset(st);
  }

  // Ein Fahrzeug in die Instanzen schreiben. Rückgabe: wie viele Instanzen dafür noch frei waren
  add(type, x, y, z, yaw, pitch, roll, hex, night) {
    const m = this.mesh[type], i = this.cnt[type], T = TYPES[type];
    if (i >= T.cap) return;
    this.cnt[type]++;
    put(m, i, x, y, z, yaw, pitch, roll);
    const c = colOf(hex); m.instanceColor.setXYZ(i, c.r, c.g, c.b);
    if (night > 0.22 && T.lamp && this.nb < 898) {
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (const [lx, ly, lz] of T.lamp) {
        put(this.bulb, this.nb++, x + lx * cy + lz * sy, y + ly, z - lx * sy + lz * cy, 0, 0, 0);
      }
      if (this.np < 448) { const f = T.lamp[0][0] + 0.38; put(this.pool, this.np++, x + f * cy, y + 0.012, z - f * sy, yaw, 0, 0, 0.85, 1, 0.42); }
    }
  }

  begin(night) {
    for (const k in this.cnt) this.cnt[k] = 0;
    this.nb = 0; this.np = 0;
    this.poolMat.uniforms.uA.value = clamp((night - 0.2) * 1.2, 0, 0.55);
  }

  end() {
    for (const k in this.mesh) {
      const m = this.mesh[k];
      m.count = this.cnt[k];
      m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
    }
    this.bulb.count = this.nb; this.pool.count = this.np;
    this.bulb.instanceMatrix.needsUpdate = true; this.pool.instanceMatrix.needsUpdate = true;
  }

  // ---------- Verkehrsregeln (seit 24.10.2026) ----------
  // Feste Regeln statt Durcheinander (Naders Kritik: ein LKW fuhr durch ein Auto, nichts darf durch etwas anderes fahren):
  //  1. Rechtsverkehr: jedes Fahrzeug fährt mittig auf der rechten Spur (die Straße hat zwei, render/streets.js).
  //  2. Abstand: ist vor einem ein Fahrzeug in gleicher Richtung, bremst man und hält Abstand.
  //  3. Kreuzung: auf einer Kreuzung ist immer nur ein Fahrzeug. Wer zuerst ankommt, fährt zuerst, die anderen warten vor
  //     dem abgesenkten Bordstein (Reservierung je Kreuzung, updateTowns).
  //  4. Steht etwas im eigenen Weg, das nicht in gleicher Richtung fährt, hält man. Stehen zwei sich gegenseitig im Weg,
  //     fährt das, welches das andere eher neben sich hat; wer es direkt vor sich hat, wartet (gleich: die kleinere Nummer
  //     fährt). Zwei an derselben Stelle in gleicher Richtung: die größere Nummer wartet, bis die andere vorne ist.
  //  5. Fußgänger haben Vorrang: steht oder geht jemand vor dem Fahrzeug auf der Fahrbahn, hält es.
  //  6. Wer länger als 8 Sekunden steht (sehr seltene Verklemmung), darf weiter, damit nichts für immer hängt.
  //  7. Sicherheit vor allem anderen: würde ein Schritt das Fahrzeug in ein anderes schieben, bleibt es stehen (hits).
  //     Hängt ein Stadtfahrzeug so länger als 12 Sekunden, biegt es in eine Einfahrt ab (verschwindet und kommt später
  //     an einer freien Kreuzung wieder), statt durch etwas hindurchzufahren.
  //  8. Letzte Sicherung: berührt ein Fahrzeug in diesem Bild trotzdem eines, das schon steht (etwa zwei Landstraßen mit
  //     demselben Endpunkt), wird es nicht gezeigt, bis die Stelle frei ist (stat.hidden zählt das, gemessen selten).
  // Grundlage ist ein Raster aller Fahrzeuge aus dem letzten Bild (Mitte, Richtung, halbe Länge und Breite, Tempo), dazu
  // das eigene Auto des Spielers (extra, render/drive.js).
  // Belegung (render/traffic.js): das eigene Auto des Spielers (extra) steht mit drin
  occBegin() { this.O.begin(); this.stat.hidden = 0; for (const e of this.extra) this.O.put(e.id || -1, e.x, e.z, e.c, e.s, e.hl, e.hw, e.cur || 0); }
  occPut(id, x, z, c, s, hl, hw, cur = 0) { this.O.put(id, x, z, c, s, hl, hw, cur); }
  hits(id, x, z, c, s, hl, hw, px, pz) { return this.O.hits(id, x, z, c, s, hl, hw, px, pz); }
  touchNow(x, z, c, s, hl, hw) { return this.O.touch(x, z, c, s, hl, hw); }

  // Muss das Fahrzeug (Mitte x, z, vorwärts (c, -s), halbe Länge hl, halbe Breite hw, Tempo cur) halten? 0 nein, 1 Fahrzeug, 2 Mensch
  blocked(id, x, z, c, s, hl, hw, cur) {
    const me = this._me || (this._me = {});
    me.x = x; me.z = z; me.c = c; me.s = s; me.hl = hl; me.hw = hw; me.cur = cur;
    const hit = this.O.near(x, z, o => {
      if (o.id === id) return;
      const h = Occ.ahead(me, o.x, o.z, o.c, o.s, o.hl, o.hw);
      if (!h) return;
      if (h.dot > 0.5) { if (h.fwd > 0.04 || (h.fwd > -0.04 && id > (o.id || 0))) return true; return; } // Regel 2
      // Regel 4: es steht im Weg. Stehe ich auch in seinem, wartet, wer das andere weiter vorn hat
      const g = Occ.ahead(o, x, z, c, s, hl, hw);
      if (!g || h.fwd > g.fwd + 0.02 || (Math.abs(h.fwd - g.fwd) <= 0.02 && id > (o.id || 0))) return true;
    });
    if (hit) return 1;
    // Regel 5: Fußgänger auf der Fahrbahn vor dem Fahrzeug
    if (this.people && this.people.inBox && this.people.inBox(x, z, c, s, hl * 0.6, hl + 0.17 + Math.min(0.5, cur * 0.6), hw * 0.62 + 0.03)) return 2;
    return 0;
  }

  // ---------- Straßen zwischen den Orten ----------
  syncRoads(st, T) {
    const rt = st._rt, val = new Map();
    for (const r of st.routes || []) if (r.road) val.set(r.a < r.b ? r.a + '|' + r.b : r.b + '|' + r.a, r.val || 0);
    const seen = new Set();
    for (const k of st.links || []) {
      if (!k.path || !k.path.length) continue;
      const A = rt.sById.get(k.a), B = rt.sById.get(k.b);
      if (!A || !B || !A.alive || !B.alive || A.war === B.id) continue;
      const full = !!(k.done || k.dd != null), usable = full ? k.path.length : k.built | 0;
      if (usable < 8) continue;
      const key = k.a + '|' + k.b, era = Math.min(A.era | 0, B.era | 0);
      const v = val.get(k.a < k.b ? key : k.b + '|' + k.a) || 0;
      const n = full ? clamp(1 + Math.floor(v / 30) + (era >= 3 ? 1 : 0) + (era >= 6 ? 1 : 0), 1, 6) : 1;
      const sig = (full ? 'f' : Math.floor(usable / 4)) + '|' + n + '|' + era;
      seen.add(key);
      const R = this.roads.get(key);
      if (R && R.sig === sig) continue;
      this.roads.set(key, this.buildRoad(st, k, usable, full, n, era, sig, R, T));
    }
    for (const key of [...this.roads.keys()]) if (!seen.has(key)) this.roads.delete(key);
    // zwei Verbindungen auf genau derselben Strecke (gleiche Enden, gleiche Länge): nur die erste hat Fahrzeuge,
    // sonst fahren ihre Fahrzeuge deckungsgleich
    const geo = new Set();
    for (const R of this.roads.values()) {
      if (!R.L) continue;
      const L = R.L, e = [L.x[0], L.z[0], L.x[L.n - 1], L.z[L.n - 1]].map(v => Math.round(v * 2));
      const k1 = e.join(',') + '|' + Math.round(L.len), k2 = [e[2], e[3], e[0], e[1]].join(',') + '|' + Math.round(L.len);
      R.dup = geo.has(k1) || geo.has(k2);
      geo.add(k1);
    }
    this.syncT = T;
  }

  buildRoad(st, k, usable, full, n, era, sig, old, T) {
    const rt = st._rt, path = k.path;
    let i0 = 0, i1 = usable - 1;
    // an den Orten vor den Häusern anfangen und aufhören
    for (let q = 0; q < usable / 2; q++) if (blockedAt(rt, path[q])) i0 = q + 1;
    if (full) for (let q = usable - 1; q >= usable / 2; q--) if (blockedAt(rt, path[q])) i1 = q - 1;
    if (i1 - i0 < 3) return { sig, none: true, veh: [] };
    const raw = [];
    for (let q = i0; q <= i1; q++) raw.push([wx(path[q] % NX), wz((path[q] / NX) | 0)]);
    const L = polyline(chaikin(raw, 2));
    const veh = [];
    // alle auf einer Straße gleich schnell (der langsamste Typ gibt den Takt) und gleichmäßig verteilt: so holt keiner den
    // anderen ein, Regel 2 greift nur noch, wo sich Straßen teilen
    const types = [];
    for (let j = 0; j < n; j++) types.push(typeFor(era, hsh(k.a + j * 7.3, k.b * 2.9)));
    const spd = Math.min(...types.map(t => TYPES[t].spd));
    for (let j = 0; j < n; j++) {
      const type = types[j], ov = old && old.veh && old.veh[j];
      veh.push({ id: ++this.vid, type, hex: paintFor(type, hsh(k.b + j * 3.7, k.a * 1.3)), off: j / n, wait: 0.14, turn: hsh(k.b, j) < 0.5 ? 1 : -1, spd, tl: ov ? ov.tl : T, rate: 1, held: 0 });
    }
    return { sig, L, veh, key: k.a + '|' + k.b, lvl: k.lvl | 0, a: k.a, b: k.b, lane: WIDTH[Math.max(1, Math.min(3, k.lvl | 0))] / 4 };
  }

  // Zustand eines Pendlers auf der Straße zur eigenen Zeit T (Spieltage). Ergebnis in o: d, yaw, moving, side (Spur: 1 rechts
  // in Fahrtrichtung, beim Wenden am Ende läuft sie im Halbkreis auf die andere Seite)
  roadPose(R, v, T, o) {
    const L = R.L, Tt = L.len / v.spd, per = 2 * (Tt + v.wait), u = (((T / per + v.off) % 1) + 1) % 1 * per;
    let d, sign, turn = 0, moving = false;
    if (u < Tt) { d = trapD(u / Tt) * L.len; sign = 1; moving = true; }
    else if (u < Tt + v.wait) { d = L.len; sign = 1; turn = smooth(seg((u - Tt) / v.wait, 0.1, 0.95)); }
    else if (u < 2 * Tt + v.wait) { d = (1 - trapD((u - Tt - v.wait) / Tt)) * L.len; sign = -1; moving = true; }
    else { d = 0; sign = -1; turn = smooth(seg((u - 2 * Tt - v.wait) / v.wait, 0.1, 0.95)); }
    o.d = d; o.moving = moving;
    o.yaw = headingAt(L, d, sign) + v.turn * Math.PI * turn;
  }

  // Lage am Boden: Höhe und Neigung nach vorn und hinten, auf dem Belag (die Bänder liegen 0,025 über dem Gelände)
  ground(x, z, yaw, o) {
    const c = Math.cos(yaw), s = Math.sin(yaw), f = 0.17;
    const yf = roadY(x + c * f, z - s * f), yb = roadY(x - c * f, z + s * f); // über Brücken auf der Fahrbahn
    o.y = (yf + yb) * 0.5 + 0.027; o.pitch = Math.atan2(yf - yb, 2 * f);
  }

  updateRoads(st, T, t, night, far2, dt, rules) {
    if (T - this.syncT >= 2 || T < this.syncT) this.syncRoads(st, T);
    const P = { d: 0, moving: false, yaw: 0 }, P2 = { d: 0, moving: false, yaw: 0 }, SM2 = { x: 0, z: 0 }, G = { y: 0, pitch: 0 }, cam = this.cam, tg = this.tgt;
    const dT = this.lastRoadT == null ? 0 : clamp(T - this.lastRoadT, 0, 50);
    this.lastRoadT = T;
    for (const R of this.roads.values()) {
      if (R.none || R.dup) continue;
      this.stat.roads++;
      for (const v of R.veh) {
        if (v.tl == null || Math.abs(v.tl - T) > 4) v.tl = T; // nach langem Vorspulen wieder im Takt
        this.roadPose(R, v, v.tl, P);
        sample(R.L, P.d, SM);
        const near = !(far2 >= 0 && (SM.x - tg.x) ** 2 + (SM.z - tg.z) ** 2 > far2);
        const Ty = TYPES[v.type], c = Math.cos(P.yaw), s = Math.sin(P.yaw);
        const x = SM.x + s * R.lane, z = SM.z + c * R.lane; // Regel 1: rechte Spur (rechts ist (sin, cos))
        let go = 1;
        const cur = P.moving ? v.rate * 0.6 : 0;
        if (near && rules) {
          const b = this.blocked(v.id, x + c * Ty.cx, z - s * Ty.cx, c, s, Ty.hl, Ty.hw, cur);
          if (b && v.held < 8) { go = 0; v.held += dt; } else if (!b) v.held = 0;
        }
        v.rate = go ? Math.min(1, v.rate + dt * 1.5) : Math.max(0, v.rate - dt * 5);
        if (near && rules && v.rate > 0 && dT > 0) { // Regel 7
          this.roadPose(R, v, v.tl + dT * v.rate, P2);
          sample(R.L, P2.d, SM2);
          const c2 = Math.cos(P2.yaw), s2 = Math.sin(P2.yaw), x2 = SM2.x + s2 * R.lane + c2 * Ty.cx, z2 = SM2.z + c2 * R.lane - s2 * Ty.cx;
          if (this.hits(v.id, x2, z2, c2, s2, Ty.hl, Ty.hw, x + c * Ty.cx, z - s * Ty.cx)) { v.rate = 0; v.held += dt; }
        }
        v.tl += dT * v.rate;
        if (!near) continue;
        if (this.touchNow(x + c * Ty.cx, z - s * Ty.cx, c, s, Ty.hl, Ty.hw)) { this.stat.hidden++; continue; } // Regel 8
        this.occPut(v.id, x + c * Ty.cx, z - s * Ty.cx, c, s, Ty.hl, Ty.hw, cur);
        this.ground(x, z, P.yaw, G);
        const bob = P.moving && v.type !== 'sedan' && v.type !== 'hatch' ? Math.sin(P.d * 21 + v.off * 9) * 0.0035 : 0;
        this.add(v.type, x, G.y + bob, z, P.yaw, G.pitch, 0, v.hex, night);
        this.stat.road++;
        this.puffs(v, x, G.y, z, P.yaw, P.moving && v.rate > 0.3, R.lvl, (x - cam.x) ** 2 + (z - cam.z) ** 2 + (G.y - cam.y) ** 2);
      }
    }
  }

  // Staub hinter Karren, Dampf aus dem Schornstein des Dampfwagens (nur nahe an der Kamera)
  puffs(v, x, y, z, yaw, moving, lvl, d2) {
    if (!moving || d2 > 1600) return;
    const r = Math.random, c = Math.cos(yaw), s = Math.sin(yaw);
    if (v.type === 'steamwagon' && r() < 0.35) this.fx.smoke.emit({ x: x + c * 0.16, y: y + 0.3, z: z - s * 0.16, vy: 0.3, vx: -c * 0.1, vz: s * 0.1, life: 2.4, size: 0.1, grow: 2.2, c: [0.55, 0.55, 0.57], a: 0.4 });
    else if ((lvl <= 1 || v.type === 'oxcart' || v.type === 'horsecart' || v.type === 'handcart') && r() < 0.08) this.fx.smoke.emit({ x: x - c * 0.2, y: y + 0.02, z: z + s * 0.2, vy: 0.03, life: 0.9, size: 0.05, grow: 1.6, c: [0.82, 0.74, 0.58], a: 0.22 });
  }

  // ---------- Verkehr in den Städten (seit 24.10.2026 auf dem Fahrnetz der zweispurigen Straßen) ----------
  // Das Fahrnetz kommt aus render/streets.js (Ketten aus Straßen und Hauptstraßen zwischen Kreuzungen). Jedes Fahrzeug
  // nimmt an jeder Kreuzung eine zufällige Abzweigung (nicht zurück, außer in der Sackgasse) und fährt auf der rechten Spur.
  syncTowns(st, T) {
    const seen = new Set();
    for (const s of st.settlements) {
      if (!s.alive || (s.era | 0) < 3 || (s.pop | 0) < 30) continue;
      const ST = this.streets && this.streets.towns.get(s.id);
      if (!ST || !ST.drive || !ST.drive.length) continue;
      seen.add(s.id);
      let tw = this.towns.get(s.id);
      if (!tw) { tw = { id: s.id, veh: [], at: -99, ref: null, G: null }; this.towns.set(s.id, tw); }
      if (tw.ref !== ST.drive) { tw.ref = ST.drive; tw.G = driveGraph(ST.drive); tw.res = new Map(); for (const v of tw.veh) this.park(tw, v); }
      if (T - tw.at < 6 && tw.veh.length) continue;
      tw.at = T;
      const want = Math.min(14, Math.floor(s.pop / 25), Math.floor(tw.G.total / 2.2));
      while (tw.veh.length > want) this.park(tw, tw.veh.pop());
      while (tw.veh.length < want) {
        const type = typeFor(s.era | 0, Math.random());
        tw.veh.push({ id: ++this.vid, type, hex: paintFor(type, Math.random()), mode: 'wait', until: this.sec + Math.random() * 4, L: null, d: 0, x: 0, z: 0, yaw: 0, cur: 0, held: 0, node: null, prev: -1, spd: TYPES[type].spd / 30 * 0.55 });
      }
    }
    for (const id of [...this.towns.keys()]) if (!seen.has(id)) this.towns.delete(id);
    this.townT = T;
  }

  // Nächste Fahrt: ab dem Knoten, an dem man steht, 3 bis 8 Abschnitte, als Linie auf der rechten Spur
  plan(tw, v) {
    this.budget--;
    const G = tw.G;
    if (v.node == null) { // neu: an einem Knoten einsetzen, der frei ist
      const k = G.nodes[Math.floor(Math.random() * G.nodes.length)], [X, Z] = nodePos(k);
      if (this.blocked(v.id, X, Z, 1, 0, 0.3, 0.3, 0) === 1 || this.blocked(v.id, X, Z, -1, 0, 0.3, 0.3, 0) === 1) { v.until = this.sec + 1 + Math.random() * 2; return; }
      v.node = k; v.x = X; v.z = Z; v.prev = -1;
    }
    let node = v.node, prev = v.prev, len = 0;
    const route = [];
    for (let i = 0; i < 8 && (len < 4 || i < 3); i++) {
      const opts = G.adj.get(node) || [];
      let cand = opts.filter(e => e !== prev);
      if (!cand.length) cand = opts; // Sackgasse: wenden
      if (!cand.length) break;
      const e = cand[Math.floor(Math.random() * cand.length)], E = G.edges[e], fwd = E.a === node;
      route.push([e, fwd]); len += E.len; prev = e; node = fwd ? E.b : E.a;
    }
    if (!route.length) { v.until = this.sec + 3; return; }
    const pts = v.L ? [[v.x, v.z]] : [];
    for (const [e, fwd] of route) {
      const E = G.edges[e], P = fwd ? E.pts : E.pts.slice().reverse(), lane = E.cw * 0.5;
      for (let k = 0; k < P.length; k++) {
        const a = P[Math.max(0, k - 1)], b = P[Math.min(P.length - 1, k + 1)];
        let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        const X = P[k][0] - tz * lane, Z = P[k][1] + tx * lane; // Regel 1: rechts ist (-tz, tx)
        const q = pts[pts.length - 1];
        if (q && Math.hypot(q[0] - X, q[1] - Z) < 0.04) continue;
        pts.push([X, Z]);
      }
    }
    if (pts.length < 2) { v.until = this.sec + 2; return; }
    v.L = polyline(chaikin(pts, 2)); v.d = 0; v.mode = 'drive'; v.node = node; v.prev = prev;
    v.x = v.L.x[0]; v.z = v.L.z[0];
    // Kreuzungen auf dem Weg (Regel 3): Stelle auf der Linie, die der Mitte am nächsten kommt
    v.cross = [];
    let k0 = 0;
    for (const [e, fwd] of route) {
      const E = G.edges[e], nk = fwd ? E.b : E.a;
      if ((G.adj.get(nk) || []).length < 3) continue;
      const [X, Z] = nodePos(nk);
      let bd = Infinity, bk = k0;
      for (let k = k0; k < v.L.n; k++) { const d = (v.L.x[k] - X) ** 2 + (v.L.z[k] - Z) ** 2; if (d < bd) { bd = d; bk = k; } }
      v.cross.push({ k: nk, s: v.L.cum[bk], x: X, z: Z });
      k0 = bk;
    }
    if (!v.cur) v.yaw = headingAt(v.L, 0.15);
  }

  // Stadtfahrzeug vom Netz nehmen (biegt in eine Einfahrt ab), Kreuzungen freigeben, später an einem freien Knoten neu
  park(tw, v) {
    const R = tw.res;
    if (R) for (const k of v.held3 || []) if (R.get(k) === v.id) R.delete(k);
    v.held3 = []; v.mode = 'wait'; v.L = null; v.node = null; v.cur = 0; v.held = 0; v.until = this.sec + 2 + Math.random() * 3;
  }

  updateTowns(st, T, t, night, far2, dts, dt, rules) {
    if (T - this.townT >= 1 || T < this.townT) this.syncTowns(st, T);
    // wer im letzten Bild gefahren ist (Reservierungen anderer verfallen, sobald sie nicht mehr fahren)
    this.alive = this.aliveNow || new Set(); this.aliveNow = new Set();
    const G = { y: 0, pitch: 0 }, tg = this.tgt;
    for (const tw of this.towns.values()) {
      if (!tw.G) continue;
      for (const v of tw.veh) {
        if (v.mode === 'wait') { if (this.sec >= v.until && this.budget > 0) this.plan(tw, v); if (v.mode === 'wait') continue; }
        const dx = v.x - tg.x, dz = v.z - tg.z;
        const Ty = TYPES[v.type];
        if ((far2 >= 0 && dx * dx + dz * dz > far2) || v.held > 12) { this.park(tw, v); continue; } // außer Sicht oder fest: später neu einsetzen
        // geprüft wird in der Richtung, in die der Weg gleich führt (beim Abbiegen und Wenden nicht die Blickrichtung)
        const ya = headingAt(v.L, Math.min(v.L.len, v.d + 0.12)), c = Math.cos(ya), s = Math.sin(ya);
        const cy0 = Math.cos(v.yaw), sy0 = Math.sin(v.yaw), mx = v.x + cy0 * Ty.cx, mz = v.z - sy0 * Ty.cx;
        let b = 0;
        if (rules) {
          b = this.blocked(v.id, mx, mz, c, s, Ty.hl, Ty.hw, v.cur);
          // Regel 3: die nächste Kreuzung reservieren, bevor die Front hineinfährt; besetzt heißt warten
          const R = tw.res || (tw.res = new Map());
          for (const k of v.held3 || []) { const [X, Z] = nodePos(k); if (Math.hypot(v.x - X, v.z - Z) > 0.62 + Ty.hl && !(v.cross || []).some(q => q.k === k && q.s > v.d)) { if (R.get(k) === v.id) R.delete(k); v.held3.splice(v.held3.indexOf(k), 1); } }
          const nx = (v.cross || []).find(q => q.s > v.d - 0.05);
          if (!b && nx && nx.s - v.d < Ty.hl + Ty.cx + 0.6 && !(v.held3 || []).includes(nx.k)) {
            const own = R.get(nx.k);
            if (own == null || own === v.id || !this.alive.has(own)) { R.set(nx.k, v.id); (v.held3 || (v.held3 = [])).push(nx.k); }
            else b = 3;
          }
          if (b && v.held < 8) v.held += dt; else if (!b) v.held = 0; else b = 0;
        }
        v.cur = b ? Math.max(0, v.cur - v.spd * dts * 5) : Math.min(v.spd, v.cur + v.spd * dts * 1.2);
        if (rules && v.cur > 0) { // Regel 7
          const d2 = Math.min(v.L.len, v.d + v.cur * dts);
          sample(v.L, d2, SM);
          const y2 = headingAt(v.L, d2), c2 = Math.cos(y2), s2 = Math.sin(y2);
          if (this.hits(v.id, SM.x + c2 * Ty.cx, SM.z - s2 * Ty.cx, c2, s2, Ty.hl, Ty.hw, mx, mz)) { v.cur = 0; v.held += dt; }
        }
        v.d += v.cur * dts;
        if (v.d >= v.L.len) { v.d = v.L.len; if (this.budget > 0) this.plan(tw, v); else { v.mode = 'wait'; v.until = this.sec + 0.5; } }
        if (v.L) {
          sample(v.L, Math.min(v.d, v.L.len), SM); v.x = SM.x; v.z = SM.z;
          const target = headingAt(v.L, Math.min(v.d, v.L.len));
          v.yaw += wrapPi(target - v.yaw) * clamp(dts * 9, 0, 1);
        }
        const c2 = Math.cos(v.yaw), s2 = Math.sin(v.yaw);
        if (this.touchNow(v.x + c2 * Ty.cx, v.z - s2 * Ty.cx, c2, s2, Ty.hl, Ty.hw)) { this.stat.hidden++; this.park(tw, v); continue; } // Regel 8
        this.occPut(v.id, v.x + c2 * Ty.cx, v.z - s2 * Ty.cx, c2, s2, Ty.hl, Ty.hw, v.cur);
        this.aliveNow.add(v.id);
        this.ground(v.x, v.z, v.yaw, G);
        this.add(v.type, v.x, G.y, v.z, v.yaw, G.pitch, 0, v.hex, night);
        this.stat.town++;
      }
    }
  }

  update(st, frac, t, rise, night = 0) {
    if (st !== this.st) this.reset(st);
    const T = st.day + frac, dt = clamp(t - this.lastT, 0, 0.1), dT = T - this.lastTT;
    this.lastT = t; this.lastTT = T;
    const spd = dt > 0 ? clamp(dT * 30 / dt, 0, 3) : 1, dts = dt * spd;
    this.sec += dts;
    this.budget = 3;
    // Regeln nur bei normalem Tempo (beim Vorspulen springen alle ohnehin weit, dort wären sie nur Bremsen ohne Sinn)
    const rules = dt > 0 && dT / dt < 0.2;
    // Straßen und Stadtfahrzeuge nur nahe am Blickpunkt: hoch oben 90 Felder, tief unten 150, ganz weit weg gar nicht (sie wären kleiner als 5 Pixel)
    const cy = this.cam.y, far = cy > 105 ? -1 : cy > 45 ? 90 : 150, far2 = far < 0 ? -1 : far * far;
    this.stat.roads = 0; this.stat.road = 0; this.stat.town = 0; this.stat.air = 0;
    this.begin(night);
    this.occBegin();
    if (far2 >= 0) {
      this.updateRoads(st, T, t, night, far2, dt, rules);
      this.updateTowns(st, T, t, night, far2, dts, dt, rules);
    }
    for (const d of this.demo) this.add(d.type, d.x, d.y != null ? d.y : groundY(d.x, d.z) + 0.01, d.z, d.yaw || 0, d.pitch || 0, d.roll || 0, d.hex || '#e8a39a', night); // auch das eigene Auto (render/drive.js)
    this.air.update(st, T, t, rise, night, dts);
    this.stat.air = this.air.stat.planes + this.air.stat.zeps;
    this.end();
    this.stat.shown = this.stat.road + this.stat.town;
  }
}

// Fahrnetz eines Ortes aus den befahrbaren Ketten: Kanten mit Länge, Knoten (Felder der Kreuzungen und Enden) mit Kanten
function driveGraph(drive) {
  const edges = [], adj = new Map();
  let total = 0;
  for (const D of drive) {
    let len = 0;
    for (let k = 1; k < D.pts.length; k++) len += Math.hypot(D.pts[k][0] - D.pts[k - 1][0], D.pts[k][1] - D.pts[k - 1][1]);
    if (len < 0.3 || D.a === D.b) continue;
    const e = edges.length;
    edges.push({ pts: D.pts, a: D.a, b: D.b, cw: D.cw, len });
    total += len;
    for (const n of [D.a, D.b]) (adj.get(n) || adj.set(n, []).get(n)).push(e);
  }
  return { edges, adj, nodes: [...adj.keys()], total };
}
const nodePos = i => [wx(i % NX), wz((i / NX) | 0)];
