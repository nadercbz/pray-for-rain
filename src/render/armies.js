// Heere, Flotten und Schlachten im Bild (seit 24.10.2026, Kriegssystem, sim/military.js). Die Simulation führt die
// Heere in st.armies (Weg über Straßen, Zustand Sammeln, Marsch, Belagerung, Schlacht, Wache, Heimweg) und die
// Schlachten in st.fights (Seiten, Runden, Gefallene mit der Stelle im Tag, an der sie fallen). Hier wird daraus Bild:
// - Kolonnen aus echten Menschen in Uniform (Kittel in der Farbe ihres Ortes, Helm und Waffe je Epoche), vorn der
//   General (ab der Bronzezeit zu Pferd), dahinter die Fahne, Fußvolk, Schützen, Reiterei, Fahrzeuge (Streitwagen,
//   Rammbock, Tribok, Kanonen, Panzerwagen, Feldgeschütz, Raketenwerfer, Panzer, Kampfhubschrauber). Ausgehobene Bauern
//   gehen in ihren Kleidern mit, nur mit einem Band in der Ortsfarbe.
// - Zur See Kriegsschiffe aus ships.js, die das Heer übersetzen und an der Küste vor Anker liegen.
// - Belagerung: Lager mit Zelten und Feuer, Belagerungsgerät schießt auf die Mauer, Verteidiger schießen zurück.
// - Schlachten: Linien stellen sich auf, Fernkampf (Pfeile, Steine, Musketenrauch, Granaten), dann Nahkampf; wer in
//   der Simulation an diesem Tag fällt, fällt im Bild genau dann (fallen.f) und bleibt liegen, bis die Schlacht aus
//   dem Kriegsbuch verschwindet. Die Verlierer fliehen, die Sieger jubeln. Seeschlachten mit Breitseiten, Schiffe der
//   Verlierer sinken.
// Nur Bild: nichts hier ändert den Spielstand. Wer im Heer ist, fehlt im Dorf (people.skip) und steht in people.pos.
import * as THREE from 'three';
import { NX, NY, wx, wz } from './scene.js';
import { groundY } from './terrain.js';
import { drawPerson, figureScale, figFor } from './people.js';
import { Bld, K, paintable } from './ships.js';
import { beast } from './vehicles.js';
import { UNITS, unitOf, armyName, rankName, ringAt } from '../sim/military.js';
import { DAY_SECONDS } from '../sim/data.js';
import { L } from '../i18n.js';

const HEIGHT = 0.27, STRIDE = 0.45, RUN_STRIDE = 1.95, SEAT_Y = 0.255; // wie in people.js
const ANIMAL = 1.45;          // Maßstab der Tiere neben den großen Figuren (wie treks.js)
const LAT = 0.15, ROW = 0.2;  // Abstand in der Kolonne quer und längs
const MAXV = 48, MAXSHIP = 30, MAXARROW = 260, MAXBALL = 90, MAXTENT = 120, MAXFIRE = 16, MAXFLAG = 40;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
const todOf = (T, VD) => { const u = T / VD + 0.3; return u - Math.floor(u); };
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _m = new THREE.Matrix4(), _l = new THREE.Matrix4(), _c = new THREE.Color(), _v = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0);
// Formen schauen nach +x: yaw aus der Richtung (dx, dz) ist atan2(-dz, dx)
const compose = (m, x, y, z, yaw, pitch, s, roll = 0) => { _e.set(roll, yaw, pitch, 'YZX'); _q.setFromEuler(_e); return m.compose(_p.set(x, y, z), _q, _s.set(s, s, s)); };

// ---------- Uniformen je Epoche ----------
// hat: Hut der Soldaten, hc: Hutfarbe (null: dunkle Ortsfarbe), pants: Hose, base: Grundstoff, mix: Anteil Ortsfarbe im Kittel
export const KIT = [
  { hat: 'muetze', hc: '#7a5a3a', pants: '#6b5a44', base: '#9a7a58', mix: 0.5 },
  { hat: 'muetze', hc: '#7a5a3a', pants: '#6b5a44', base: '#9a7a58', mix: 0.6 },
  { hat: 'helm', hc: '#c08a3e', pants: '#5a4a3a', base: '#a08860', mix: 0.75 },
  { hat: 'kamm', hc: '#c9953f', pants: '#5a4a3a', base: '#a08860', mix: 0.8 },
  { hat: 'helm', hc: '#b4bac2', pants: '#4a4440', base: '#8a8478', mix: 0.85 },
  { hat: 'dreispitz', hc: '#2a2a2e', pants: '#ece6d6', base: '#d8d0c0', mix: 0.92 },
  { hat: 'kepi', hc: null, pants: '#3e4a5c', base: '#4a5060', mix: 0.85 },
  { hat: 'helm', hc: '#5d6b45', pants: '#55603f', base: '#5d6b45', mix: 0.4 },
];
// Waffe in der Hand je Waffengattung (Reiter, Streitwagen: der Kämpfer)
export const ARM = { keule: 'keule', speerwurf: 'speer', speer: 'speer', bogen: 'bogen', hoplit: 'speer', schleuder: null, schwert: 'schwert', armbrust: 'bogen', pike: 'speer', muskete: 'muskete', gewehr: 'gewehr', mg: 'gewehr', soldat: 'gewehr', reiter: 'speer', ritter: 'speer', kavallerie: 'schwert', streitwagen: 'bogen' };
const MILITIA = ['keule', 'keule', 'speer', 'speer', 'axt', 'speer', 'gewehr', 'gewehr'];
const GEN = { gen: true };
// Fernkampf: was fliegt (arrow, stone, ball) und ob es raucht
const SHOT = { speerwurf: 'arrow', bogen: 'arrow', armbrust: 'arrow', schleuder: 'stone', streitwagen: 'arrow', muskete: 'musket', gewehr: 'rifle', mg: 'rifle', soldat: 'rifle', rakete: 'rocket', trebuchet: 'stone', kanone: 'ball', artillerie: 'shell', panzer: 'shell', panzerwagen: 'rifle', heli: 'rocket' };
// Fahrzeuge: v Bauform, ride Besatzung sitzt oder steht darauf, inside Besatzung unsichtbar drin, pull vorgespannt
const VEH = {
  reiter: { v: 'horse', ride: true }, ritter: { v: 'knight', ride: true }, kavallerie: { v: 'horse', ride: true },
  streitwagen: { v: 'chariot', ride: true, len: 0.62 }, rammbock: { v: 'ram', len: 0.5 }, trebuchet: { v: 'treb', len: 0.62, pull: 'ox' },
  kanone: { v: 'cannon', len: 0.5, pull: 'horse' }, panzerwagen: { v: 'acar', inside: true, len: 0.5 }, artillerie: { v: 'field', len: 0.5, pull: 'horse' },
  rakete: { v: 'rocket', inside: true, len: 0.55 }, panzer: { v: 'tank', inside: true, len: 0.55 }, heli: { v: 'heli', inside: true, fly: true, len: 0.3 },
};

// ---------- Formen ----------
function wheel(B, x, y, z, r, c = '#7a5a3a', hub = '#4a3626', spokes = 6) {
  B.cyl(r, r, 0.012, x, y, z, c, 12, [Math.PI / 2, 0, 0]);
  B.cyl(r * 0.78, r * 0.78, 0.014, x, y, z, '#2e2a26', 10, [Math.PI / 2, 0, 0]);
  for (let i = 0; i < spokes; i++) { const a = i / spokes * Math.PI; B.box(r * 1.5, 0.006, 0.006, x, y, z, c, 0, 0, a); }
  B.cyl(r * 0.22, r * 0.22, 0.02, x, y, z, hub, 6, [Math.PI / 2, 0, 0]);
}
function tyre(B, x, y, z, r) {
  B.cyl(r, r, 0.03, x, y, z, '#26262a', 10, [Math.PI / 2, 0, 0]);
  B.cyl(r * 0.5, r * 0.5, 0.032, x, y, z, '#6a6e72', 8, [Math.PI / 2, 0, 0]);
}
const fin = (B, s = 1) => { const g = B.done(false); if (s !== 1) g.scale(s, s, s); return g; };
const HORSE = { L: 0.16, H: 0.08, body: '#8a5a3c', dark: '#3e2c22', belly: '#a8774f', horse: true, legs: false };
// Reitpferd mit Sattel und Satteldecke in Ortsfarbe, Ritterpferd mit Schabracke; Beine sind eigene Instanzen
function horse(barding) {
  const B = new Bld(), o = HORSE, top = 0.07 + o.H;
  beast(B, 0, 0, o);
  // Sattel rund auf dem Rücken, darunter die Decke in Ortsfarbe, die über die Flanken fällt
  B.sph(1, 0.004, top - 0.006, 0, '#5a3a26', 0.026, 0.01, 0.03, 8, 4);
  for (const z of [0.036, -0.036]) B.rod([0.004, top - 0.01, z], [0.004, top - 0.045, z * 1.08], 0.0018, '#2e2622');
  B.pf = 1;
  if (barding) {
    B.sph(1, 0, top - o.H * 0.42, 0, '#ffffff', o.L * 0.56, o.H * 0.58, o.H * 0.5, 9, 6);
    B.box(0.03, 0.035, 0.03, o.L * 0.5 + 0.045, top + 0.02, 0, '#ffffff', 0, 0, -0.6); // Kopfschutz
  } else B.sph(1, 0.004, top - o.H * 0.2, 0, '#ffffff', 0.04, o.H * 0.24, o.H * 0.45, 8, 5);
  B.pf = 0;
  return fin(B, ANIMAL);
}
// Ochse zum Ziehen (Tribok)
function ox() { const B = new Bld(); beast(B, 0, 0, { L: 0.15, H: 0.085, body: '#a68b6c', dark: '#6a4c36', belly: '#cdb792', legs: false }); return fin(B, ANIMAL); }
function legGeo() {
  const B = new Bld();
  B.pf = 1; B.cyl(0.011, 0.008, 0.075, 0, -0.0375, 0, '#ffffff', 5); B.pf = 0;
  B.cyl(0.0095, 0.0095, 0.012, 0, -0.069, 0, '#3d3029', 5);
  return B.done(false);
}
function chariot() {
  const B = new Bld();
  B.box(0.12, 0.012, 0.13, 0, 0.075, 0, K.wood);
  B.pf = 1;
  B.box(0.012, 0.075, 0.13, 0.058, 0.115, 0, '#ffffff');
  for (const z of [0.064, -0.064]) B.box(0.11, 0.05, 0.008, 0.004, 0.105, z, '#ffffff');
  B.pf = 0;
  for (const z of [0.082, -0.082]) wheel(B, -0.01, 0.065, z, 0.065, '#8a6a48');
  B.rod([0.06, 0.08, 0], [0.24, 0.115, 0], 0.006, K.woodD);
  const g = fin(B);
  const H = new Bld();
  beast(H, 0.3 / ANIMAL, 0, { ...HORSE, legs: true });
  const h = H.done(false); h.scale(ANIMAL, ANIMAL, ANIMAL);
  return mergeTwo(g, h);
}
function mergeTwo(a, b) {
  const B = new Bld();
  B.parts.push(a, b);
  return B.done(false);
}
function ram() {
  const B = new Bld(), w = 0.1, l = 0.24, h = 0.17;
  for (const [x, z] of [[l, w], [l, -w], [-l, w], [-l, -w]]) B.rod([x, 0.04, z], [x * 0.92, h, z * 0.7], 0.009, K.woodD, 5);
  B.box(l * 2.1, 0.012, w * 2, 0, 0.05, 0, K.wood);
  for (const s of [1, -1]) B.box(l * 2.15, 0.012, w * 1.25, 0, h - 0.035, s * w * 0.5, '#8a6a48', s * 0.75, 0, 0);
  B.box(l * 2.15, 0.02, 0.03, 0, h + 0.005, 0, '#6a5038');
  B.cyl(0.03, 0.03, l * 2.3, 0.02, 0.11, 0, '#7a5a3a', 8, [0, 0, Math.PI / 2]);
  B.cyl(0.034, 0.03, 0.05, l * 1.15 + 0.03, 0.11, 0, '#4a4a4e', 8, [0, 0, Math.PI / 2]);
  for (const x of [l * 0.8, -l * 0.8]) for (const z of [w + 0.012, -w - 0.012]) wheel(B, x, 0.045, z, 0.045, '#7a5a3a', '#4a3626', 4);
  return fin(B);
}
function treb() {
  const B = new Bld();
  B.box(0.42, 0.025, 0.16, 0, 0.05, 0, K.wood);
  for (const z of [0.07, -0.07]) { B.rod([-0.12, 0.06, z], [0.0, 0.34, z * 0.6], 0.01, K.woodD, 5); B.rod([0.12, 0.06, z], [0.0, 0.34, z * 0.6], 0.01, K.woodD, 5); }
  B.cyl(0.012, 0.012, 0.12, 0, 0.34, 0, '#4a4a4e', 6, [Math.PI / 2, 0, 0]);
  B.rod([0.1, 0.27, 0], [-0.32, 0.5, 0], 0.012, '#8a6a48', 6, 0.007);
  B.box(0.08, 0.07, 0.08, 0.12, 0.22, 0, '#6a6a66');
  B.rod([-0.32, 0.5, 0], [-0.3, 0.38, 0], 0.003, '#d8c8a0', 3);
  for (const x of [0.15, -0.15]) for (const z of [0.09, -0.09]) wheel(B, x, 0.045, z, 0.045, '#7a5a3a', '#4a3626', 4);
  return fin(B);
}
function cannon() {
  const B = new Bld();
  B.cyl(0.03, 0.022, 0.3, 0.06, 0.1, 0, '#4a3e30', 10, [0, 0, Math.PI / 2 + 0.1]);
  B.cyl(0.034, 0.034, 0.03, -0.08, 0.087, 0, '#4a3e30', 10, [0, 0, Math.PI / 2]);
  B.box(0.26, 0.04, 0.06, -0.06, 0.06, 0, '#6a4a30', 0, 0, 0.12);
  for (const z of [0.05, -0.05]) wheel(B, 0.0, 0.065, z, 0.065, '#6a4a30', '#3a2a20', 8);
  return fin(B);
}
function field() {
  const B = new Bld();
  B.cyl(0.018, 0.016, 0.34, 0.1, 0.11, 0, '#4a5040', 8, [0, 0, Math.PI / 2 + 0.06]);
  B.pf = 1; B.box(0.012, 0.11, 0.15, 0.02, 0.12, 0, '#ffffff'); B.pf = 0;
  B.box(0.28, 0.025, 0.035, -0.12, 0.06, 0, '#4a5040', 0, 0, 0.18);
  for (const z of [0.06, -0.06]) wheel(B, 0.0, 0.065, z, 0.065, '#3a3a36', '#2a2a26', 10);
  return fin(B);
}
function acar() {
  const B = new Bld(), C = '#6a6e58';
  B.box(0.36, 0.1, 0.16, 0, 0.1, 0, C);
  B.box(0.12, 0.05, 0.15, 0.15, 0.08, 0, C, 0, 0, -0.35);
  B.cyl(0.05, 0.055, 0.05, -0.03, 0.175, 0, C, 10);
  B.cyl(0.006, 0.006, 0.12, 0.05, 0.18, 0, '#2a2a2e', 5, [0, 0, Math.PI / 2]);
  B.pf = 1; B.box(0.362, 0.018, 0.162, 0, 0.13, 0, '#ffffff'); B.pf = 0;
  B.box(0.03, 0.02, 0.12, 0.12, 0.12, 0, '#2a2e34');
  for (const x of [0.11, -0.11]) for (const z of [0.085, -0.085]) tyre(B, x, 0.045, z, 0.045);
  return fin(B);
}
function rocket() {
  const B = new Bld(), C = '#5d6b45';
  B.box(0.12, 0.1, 0.15, 0.16, 0.11, 0, C);
  B.box(0.08, 0.04, 0.145, 0.19, 0.17, 0, '#3a4a5a');
  B.box(0.32, 0.03, 0.15, -0.06, 0.07, 0, '#3a3e36');
  B.box(0.22, 0.09, 0.13, -0.08, 0.15, 0, C, 0, 0, 0.35);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) B.cyl(0.014, 0.014, 0.012, 0.02, 0.19 + j * 0.03 - i * 0.0, -0.04 + i * 0.04, '#26262a', 6, [0, 0, Math.PI / 2 + 0.35]);
  B.pf = 1; B.box(0.122, 0.02, 0.152, 0.16, 0.13, 0, '#ffffff'); B.pf = 0;
  for (const x of [0.16, -0.02, -0.14]) for (const z of [0.08, -0.08]) tyre(B, x, 0.04, z, 0.04);
  return fin(B);
}
function tank() {
  const B = new Bld(), C = '#5d6b45';
  B.box(0.4, 0.07, 0.18, 0, 0.1, 0, C);
  B.box(0.1, 0.05, 0.17, 0.2, 0.09, 0, C, 0, 0, -0.5);
  for (const z of [0.1, -0.1]) {
    B.box(0.44, 0.07, 0.05, 0, 0.05, z, '#34362e');
    for (let i = 0; i < 5; i++) B.cyl(0.025, 0.025, 0.055, -0.16 + i * 0.08, 0.04, z, '#4a4c42', 8, [Math.PI / 2, 0, 0]);
  }
  B.cyl(0.075, 0.085, 0.06, -0.03, 0.165, 0, C, 10);
  B.box(0.12, 0.045, 0.13, -0.05, 0.17, 0, C);
  B.cyl(0.011, 0.012, 0.3, 0.17, 0.18, 0, '#4a5040', 8, [0, 0, Math.PI / 2]);
  B.pf = 1; B.box(0.06, 0.03, 0.135, -0.07, 0.18, 0, '#ffffff'); B.pf = 0;
  B.cyl(0.004, 0.004, 0.12, -0.1, 0.25, 0.04, '#2a2a2e', 3);
  return fin(B);
}
function heli() {
  const B = new Bld(), C = '#4f5a40';
  B.sph(1, 0.02, 0, 0, C, 0.14, 0.06, 0.055, 10, 6);
  B.sph(1, 0.09, 0.01, 0, '#24323e', 0.06, 0.04, 0.045, 8, 5);
  B.rod([-0.08, 0.01, 0], [-0.34, 0.03, 0], 0.016, C, 6, 0.008);
  B.box(0.05, 0.07, 0.006, -0.34, 0.06, 0, C);
  B.box(0.06, 0.006, 0.12, -0.32, 0.03, 0, C);
  for (const z of [0.05, -0.05]) B.rod([0.08, -0.08, z], [-0.08, -0.08, z], 0.005, '#2a2a2e', 4);
  for (const z of [0.05, -0.05]) for (const x of [0.04, -0.04]) B.rod([x, -0.08, z], [x, -0.04, z * 0.8], 0.004, '#2a2a2e', 3);
  B.box(0.05, 0.006, 0.2, 0.0, -0.01, 0, C);
  for (const z of [0.09, -0.09]) B.cyl(0.012, 0.012, 0.08, 0.0, -0.025, z, '#2e2e30', 6, [0, 0, Math.PI / 2]);
  B.cyl(0.01, 0.012, 0.04, 0.0, 0.07, 0, '#2a2a2e', 6);
  B.pf = 1; B.box(0.06, 0.03, 0.112, -0.03, 0.02, 0, '#ffffff'); B.pf = 0;
  return fin(B, 1.25);
}
function rotorGeo() {
  const B = new Bld();
  B.box(0.62, 0.004, 0.026, 0, 0, 0, '#2a2a2e');
  B.box(0.026, 0.004, 0.62, 0, 0, 0, '#2a2a2e');
  return fin(B, 1.25);
}
// Zelte: rund aus Fellen (bis Stadtstaaten), Firstzelt aus Leinen (Farbe als Instanzfarbe)
function tentRound() {
  const B = new Bld();
  B.cone(0.12, 0.22, 0, 0.11, 0, '#b89a72', 9);
  B.cone(0.122, 0.06, 0, 0.03, 0, '#a08060', 9);
  for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + 0.3; B.rod([Math.cos(a) * 0.012, 0.18, Math.sin(a) * 0.012], [Math.cos(a) * 0.03, 0.27, Math.sin(a) * 0.03], 0.004, K.woodD, 3); }
  B.box(0.05, 0.08, 0.004, 0.105, 0.04, 0, '#4a3626', 0, 0, -0.35);
  return fin(B);
}
function tentRidge() {
  const B = new Bld();
  B.pf = 1;
  const g = new THREE.CylinderGeometry(0.1, 0.1, 0.28, 3, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 6).translate(0, 0.05, 0);
  B.put(g, '#ffffff');
  B.pf = 0;
  B.box(0.004, 0.17, 0.004, 0.142, 0.07, 0, K.woodD);
  B.box(0.004, 0.17, 0.004, -0.142, 0.07, 0, K.woodD);
  B.box(0.004, 0.08, 0.05, 0.141, 0.04, 0, '#3a3430');
  return fin(B);
}
function firePit() {
  const B = new Bld();
  B.cyl(0.05, 0.055, 0.004, 0, 0.002, 0, '#3a3430', 10);
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; B.sph(0.016, Math.cos(a) * 0.062, 0.008, Math.sin(a) * 0.062, i % 2 ? '#8f8a84' : '#a39e96', 1.2, 0.8, 1, 5, 3); }
  for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + 0.4; B.rod([Math.cos(a) * 0.045, 0.004, Math.sin(a) * 0.045], [Math.cos(a) * 0.006, 0.05, Math.sin(a) * 0.006], 0.0075, i % 2 ? K.woodD : K.wood, 5); }
  return fin(B, 1.3);
}
function flagPole() {
  const B = new Bld();
  B.cyl(0.005, 0.006, 0.62, 0, 0.31, 0, '#5a4030', 5);
  B.sph(0.012, 0, 0.625, 0, '#e9b44c', 1, 1, 1, 6, 4);
  return fin(B);
}
// Fahnentuch: Fläche mit Unterteilung, flattert im Shader, Farbe als Instanzfarbe
function clothGeo() {
  const g = new THREE.PlaneGeometry(0.17, 0.11, 8, 2);
  g.translate(0.085, 0, 0);
  return g;
}
function arrowGeo() {
  const B = new Bld();
  B.cyl(0.0035, 0.0035, 0.13, 0, 0, 0, '#7a5a3a', 4);
  B.cone(0.007, 0.02, 0, 0.075, 0, '#4a4a4e', 4);
  B.box(0.014, 0.025, 0.002, 0, -0.055, 0, '#e8e2d6');
  return fin(B);
}

// Bauformen für die Modell-Sammlung (ui/collection.js): Name → Geometrie (Teile mit paint nehmen die Instanzfarbe)
export const ARMY_MODELS = {
  horse: () => horse(false), knight: () => horse(true), ox, chariot, ram, treb, cannon, field, acar, rocket, tank, heli, rotor: rotorGeo,
  tentR: tentRound, tentL: tentRidge, pit: firePit, pole: flagPole, arrow: arrowGeo, legs: legGeo,
};
export const ANIMAL_DIM = { horse: HORSE, knight: HORSE, ox: { L: 0.15, H: 0.085, dark: '#6a4c36' }, scale: ANIMAL };

export class Armies {
  constructor(stage, people, fx, ships) {
    this.stage = stage; this.people = people; this.fx = fx; this.ships = ships;
    const scene = stage.scene;
    this.away = new Set();    // wer im Heer oder in einer Schlacht ist (fehlt im Dorf)
    this.cache = new Map();   // Heer → Weg im Bild, Reihenfolge, Schiffe
    this.ms = new Map();      // Mensch → Lage im Bild (weich nachgeführt)
    this.dead = new Map();    // Gefallene: Id → Lage, in der sie liegen
    this.camps = new Map();   // Belagerung → Zelte, Feuer, Geschütze
    this.shots = [];          // fliegende Geschosse
    this.sink = new Map();    // sinkende Schiffe nach Seeschlachten
    this.fc = new Map();      // Schlacht → Achse und Seite des Angreifers (nur Bild, nicht im Spielstand)
    this.frame = 0; this.lastT = null; this.lastClock = null;
    this.o = new THREE.Object3D();
    this.labels = [];
    this.stat = { armies: 0, shown: 0, soldiers: 0, fights: 0, shots: 0 };
    this.uTime = { value: 0 };
    const mat = paintable(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
    this.mat = mat;
    const inst = (g, cap, m = mat, shadow = true, color = true) => {
      const M = new THREE.InstancedMesh(g, m, cap);
      M.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (color) { M.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); M.instanceColor.setUsage(THREE.DynamicDrawUsage); }
      M.count = 0; M.frustumCulled = false; M.castShadow = shadow; M.visible = false;
      scene.add(M);
      return M;
    };
    this.inst = inst;
    this.veh = {
      horse: inst(horse(false), MAXV * 2), knight: inst(horse(true), MAXV), ox: inst(ox(), MAXV), chariot: inst(chariot(), MAXV),
      ram: inst(ram(), MAXV), treb: inst(treb(), MAXV), cannon: inst(cannon(), MAXV), field: inst(field(), MAXV), acar: inst(acar(), MAXV),
      rocket: inst(rocket(), MAXV), tank: inst(tank(), MAXV), heli: inst(heli(), MAXV),
      tentR: inst(tentRound(), MAXTENT), tentL: inst(tentRidge(), MAXTENT), pit: inst(firePit(), MAXFIRE, mat, false), pole: inst(flagPole(), MAXFLAG),
    };
    this.rotor = inst(rotorGeo(), MAXV, mat, false);
    this.legs = inst(legGeo(), MAXV * 12);
    // Flammen der Lagerfeuer (wie treks.js)
    const flame = new THREE.ConeGeometry(0.03, 0.1, 7, 1, true).translate(0, 0.05, 0);
    this.flame = inst(flame, MAXFIRE * 2, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }), false);
    this.flame.renderOrder = 2;
    // Fahnentuch flattert: Welle entlang des Tuchs, stärker zum freien Ende
    const cmat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide });
    const uTime = this.uTime;
    cmat.onBeforeCompile = sh => {
      sh.uniforms.uTime = uTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
        float ph = instanceMatrix[3].x * 3.1 + instanceMatrix[3].z * 2.3;
        float k = position.x / 0.17;
        transformed.z += sin(position.x * 34.0 - uTime * 8.0 + ph) * 0.016 * k + sin(uTime * 3.0 + ph) * 0.01 * k;
        transformed.y -= k * k * 0.012;`);
    };
    cmat.customProgramCacheKey = () => 'army-flag';
    this.cloth = inst(clothGeo(), MAXFLAG, cmat, true);
    // Geschosse
    this.arrow = inst(arrowGeo(), MAXARROW, mat, false, false);
    const bmat = new THREE.MeshStandardMaterial({ vertexColors: false, color: 0xffffff, roughness: 0.7 });
    this.ball = inst(new THREE.IcosahedronGeometry(0.022, 1), MAXBALL, bmat, false);
  }

  // ---------- Weg eines Heeres im Bild ----------
  // A.path sind Kacheln (flach x, y, x, y ...); geglättet in Weltmaßen. Ein Index u der Simulation wird über die Länge
  // auf den geglätteten Weg übertragen. Das Stück im eigenen Ortskern fällt weg (Sammeln am Ortsrand, nicht im Tempel),
  // beim Heimweg endet der Weg dort und die Soldaten gehen zurück ins Dorf.
  route(st, A) {
    const P = A.path, n = P.length / 2;
    const rx = new Float32Array(n), rz = new Float32Array(n), rc = new Float32Array(n);
    for (let i = 0; i < n; i++) { rx[i] = wx(P[i * 2]); rz[i] = wz(P[i * 2 + 1]); if (i) rc[i] = rc[i - 1] + Math.hypot(rx[i] - rx[i - 1], rz[i] - rz[i - 1]); }
    const home = st._rt.sById.get(A.s), R0 = home ? (home.R || 4) * 0.55 + 0.6 : 0;
    const inside = i => home && Math.hypot(P[i * 2] - home.cx, P[i * 2 + 1] - home.cy) < R0;
    let k0 = 0, k1 = n - 1;
    if (A.kind === 'heer' || A.sea0 < 0 || A.sea0 > 2) {
      if (A.st !== 'home') while (k0 < n - 2 && inside(k0)) k0++;
      else while (k1 > k0 + 1 && inside(k1)) k1--;
    }
    let pts = [];
    for (let i = k0; i <= k1; i++) pts.push([rx[i], rz[i]]);
    for (let k = 0; k < 2 && pts.length > 2; k++) {
      const o = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
      o.push(pts[pts.length - 1]);
      pts = o;
    }
    const m = pts.length, x = new Float32Array(m), z = new Float32Array(m), cum = new Float32Array(m);
    for (let i = 0; i < m; i++) { x[i] = pts[i][0]; z[i] = pts[i][1]; if (i) cum[i] = cum[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]); }
    const rawLen = (rc[k1] - rc[k0]) || 1e-3, len = cum[m - 1] || 1e-3;
    return { x, z, cum, n: m, len, rc, rn: n, k: len / rawLen, d0: rc[k0] };
  }
  // Strecke im Bild zu einem Index u der Simulation
  dist(R, u) {
    if (R.rn < 2) return 0;
    const i = clamp(Math.floor(u), 0, R.rn - 1), f = clamp(u - i, 0, 1), j = Math.min(R.rn - 1, i + 1);
    return (R.rc[i] + (R.rc[j] - R.rc[i]) * f - R.d0) * R.k;
  }
  // Stelle und Richtung nach Strecke d (vor dem Anfang und hinter dem Ende geht es gerade weiter)
  at(R, d, o) {
    if (R.n < 2) { o.x = R.x[0] || 0; o.z = R.z[0] || 0; o.dx = 1; o.dz = 0; return o; }
    if (d <= 0) { const dx = R.x[1] - R.x[0], dz = R.z[1] - R.z[0], l = Math.hypot(dx, dz) || 1; o.dx = dx / l; o.dz = dz / l; o.x = R.x[0] + o.dx * d; o.z = R.z[0] + o.dz * d; return o; }
    if (d >= R.len) { const a = R.n - 2, dx = R.x[a + 1] - R.x[a], dz = R.z[a + 1] - R.z[a], l = Math.hypot(dx, dz) || 1; o.dx = dx / l; o.dz = dz / l; o.x = R.x[a + 1]; o.z = R.z[a + 1]; return o; }
    let lo = 0, hi = R.n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (R.cum[mid] <= d) lo = mid; else hi = mid; }
    const sl = Math.max(1e-6, R.cum[hi] - R.cum[lo]), k = (d - R.cum[lo]) / sl;
    const dx = R.x[hi] - R.x[lo], dz = R.z[hi] - R.z[lo], l = Math.hypot(dx, dz) || 1;
    o.x = R.x[lo] + dx * k; o.z = R.z[lo] + dz * k; o.dx = dx / l; o.dz = dz / l;
    return o;
  }

  // Reihenfolge im Heer: General, Fahnenträger, Fußvolk, Schützen, Reiterei, Fahrzeuge; Fahrzeuge fassen ihre Besatzung
  order(st, A, E) {
    const rt = st._rt, era = A.era | 0, groups = [[], [], [], []];
    let gen = null, flag = null;
    for (const id of A.ids) {
      const p = rt.pById.get(id);
      if (!p) continue;
      if (id === A.gen || id === A.adm) { if (!gen || id === A.gen) gen = p; continue; }
      const u = unitOf(era, id);
      groups[UNITS[u].r].push([p, u]);
    }
    for (const g of groups) if (!flag) { const i = g.findIndex(([p, u]) => p.job === 'krieger' && !VEH[u]); if (i >= 0) flag = g.splice(i, 1)[0][0]; }
    const slots = [], W = era <= 1 ? 2 : 3;
    let back = 0;
    // General: von der Bronzezeit bis zum Ende der Renaissance zu Pferd, in Industrie und Moderne zu Fuß
    const mounted = era >= 2 && era <= 5;
    if (gen) { slots.push({ p: gen, u: unitOf(era, gen.id), lat: 0, back: 0, gen: true, horse: mounted }); back = mounted ? 0.34 : 0.22; }
    if (flag) { slots.push({ p: flag, u: unitOf(era, flag.id), lat: 0.04, back, flag: true }); back += 0.22; }
    for (let r = 0; r < 4; r++) {
      const list = groups[r];
      let col = 0;
      for (let i = 0; i < list.length;) {
        const [p, u] = list[i], V = VEH[u];
        if (!V) {
          if (col === 0 && i) back += ROW;
          slots.push({ p, u, lat: (col - (W - 1) / 2) * LAT, back });
          col = (col + 1) % W; i++;
          continue;
        }
        if (col) { col = 0; back += ROW; }
        if (V.ride && V.v !== 'chariot') {
          // Reiter zu zweit nebeneinander
          const pair = [list[i]]; if (list[i + 1] && list[i + 1][1] === u) pair.push(list[i + 1]);
          back += 0.12;
          pair.forEach(([q, uu], k) => slots.push({ p: q, u: uu, lat: pair.length === 2 ? (k ? -0.11 : 0.11) : 0, back, ride: V.v }));
          back += 0.28; i += pair.length;
          continue;
        }
        // Fahrzeug mit Besatzung (crew aus UNITS)
        const crew = UNITS[u].crew || 1, team = [];
        while (team.length < crew && i < list.length && list[i][1] === u) team.push(list[i++]);
        const len = V.len || 0.5;
        back += len * 0.5 + 0.08;
        const vs = { veh: V.v, u, back, lat: 0, team: team.map(t => t[0]), pull: V.pull, fly: V.fly };
        slots.push(vs);
        team.forEach(([q], k) => {
          if (V.inside || V.fly) slots.push({ p: q, u, lat: 0, back, inside: vs });
          else if (V.v === 'chariot') slots.push({ p: q, u, lat: k ? -0.035 : 0.035, back: back + 0.02, stand: vs });
          else slots.push({ p: q, u, lat: k % 2 ? -0.17 : 0.17, back: back - 0.08 + Math.floor(k / 2) * 0.16, crew: vs });
        });
        back += len * 0.5 + 0.12;
      }
      if (col) back += ROW;
    }
    E.slots = slots; E.colLen = back; E.sig = A.ids.length + ':' + A.ids[0] + ':' + A.gen;
  }

  // Uniform eines Soldaten: Kittel in der Ortsfarbe, Hut je Epoche, Bauern in eigenen Kleidern mit Band in Ortsfarbe
  look(st, p, A, slot) {
    const s = st._rt.sById.get(A.s), era = A.era | 0, K2 = KIT[era];
    const nat = _c.set(s ? s.color : '#b8402e');
    const key = (s ? s.id : 0) * 100 + era * 10 + (p.job === 'krieger' ? 1 : 0) + (slot && slot.gen ? 2 : 0);
    let L2 = this.lookCache?.get(key);
    if (L2) return L2;
    if (!this.lookCache) this.lookCache = new Map();
    if (slot && slot.gen) {
      L2 = { shirt: nat.clone().lerp(new THREE.Color('#ffffff'), 0.15), pants: new THREE.Color(K2.pants), hat: era >= 2 && era !== 5 && era !== 6 ? 'helm' : K2.hat, hatCol: new THREE.Color('#e9b44c') };
    } else if (p.job === 'krieger' || era >= 5) { // ab der Renaissance stehende Heere: auch Ausgehobene in Uniform
      L2 = { shirt: new THREE.Color(K2.base).lerp(nat, K2.mix), pants: new THREE.Color(K2.pants), hat: K2.hat, hatCol: K2.hc ? new THREE.Color(K2.hc) : nat.clone().multiplyScalar(0.55) };
    } else {
      L2 = { shirt: new THREE.Color('#a89a84').lerp(nat, 0.35), hatCol: null };
    }
    this.lookCache.set(key, L2);
    return L2;
  }
  weapon(p, u, era) {
    if (p.job !== 'krieger' && era < 5) return MILITIA[era] || 'speer';
    return ARM[u] === undefined ? null : ARM[u];
  }

  // ---------- jedes Bild ----------
  update(st, frac, t, o = {}) {
    const P = this.people, figs = P.figs, VD = o.vdays || 6;
    const T = st.day + frac, f = todOf(T, VD);
    const dt = this.lastClock == null ? 0 : clamp(t - this.lastClock, 0, 0.2);
    const dT = this.lastT == null ? 0 : T - this.lastT;
    this.lastClock = t; this.lastT = T;
    const gs = dt > 0 && dT > 0 ? clamp(dT * DAY_SECONDS / dt, 0, 12) : 0;
    this.gs = gs; this.dt = dt; this.t = t;
    this.frame++;
    this.uTime.value = t;
    const rt = st._rt, cam = this.stage.camera.position;
    this.st = st;
    const show = !P.hidden && !o.fast && figs.length > 0;
    const far2 = !show || cam.y > 90 ? 0 : Math.min(110, 16 + cam.y * 1.7) ** 2;
    this.away.clear();
    const S = this.stat; S.armies = 0; S.shown = 0; S.soldiers = 0; S.fights = 0;
    this.n = {}; for (const k in this.veh) this.n[k] = 0;
    this.nRotor = 0; this.nLeg = 0; this.nFlame = 0; this.nCloth = 0; this.drew = false; this.nLab = 0;
    this.figs = figs;
    this.o2 = o; this.T = T; this.f = f; this.frac = frac; this.far2 = far2; this.cam = cam; this.night = o.night || 0;
    this.canvasRect = null;
    const byId = new Map();
    for (const A of st.armies || []) if (A.st !== 'gone') byId.set(A.id, A);
    // Schlachten: wer kämpft, wo, in welcher Lage (auch Heere, die die Simulation heute schon weitergeschickt hat)
    const inFight = new Map();
    for (const F of st.fights || []) {
      const endDay = F.end != null ? F.end : null;
      if (endDay != null && endDay < st.day) continue;
      const fleeT = endDay === st.day ? this.fleeAt(F, st.day) : 2;
      if (frac >= fleeT + 0.16) continue;
      for (const id of F.a.concat(F.b)) inFight.set(id, { F, fleeT });
    }
    this.byId = byId;
    // Heere
    for (const A of byId.values()) {
      S.armies++;
      for (const id of A.ids) this.away.add(id);
      let E = this.cache.get(A.id);
      const psig = A.path.length + ':' + A.path[0] + ':' + A.path[1] + ':' + A.path[A.path.length - 1];
      if (!E || E.psig !== psig) {
        const old = E;
        E = { id: A.id, psig, R: this.route(st, A), from: A.pi, to: A.pi, t0: T, t1: T, ships: old ? old.ships : [], seen: 0 };
        this.cache.set(A.id, E);
      }
      E.seen = this.frame;
      if (!E.slots || E.sig !== A.ids.length + ':' + A.ids[0] + ':' + A.gen) this.order(st, A, E);
      // Lage im Weg: von gestern bis heute über den Tag (die Simulation springt einmal am Tag)
      const fi = inFight.get(A.id);
      if (fi && frac < fi.fleeT + 0.16) { E.from = E.to = A.pi; E.t0 = E.t1 = T; E.fight = fi; continue; }
      if (E.fight) { E.fight = null; E.from = E.cur ?? A.pi; E.to = A.pi; E.t0 = T; E.t1 = Math.max(T + 0.05, st.day + 1); }
      if (A.pi !== E.to) { E.from = E.cur ?? E.to; E.to = A.pi; E.t0 = T; E.t1 = Math.max(T + 0.05, st.day + 1); }
      const k = E.t1 > E.t0 ? clamp((T - E.t0) / (E.t1 - E.t0)) : 1;
      E.cur = E.from + (E.to - E.from) * k;
      E.moving = k < 1 && Math.abs(E.to - E.from) > 0.01;
      E.vel = E.moving ? Math.abs(E.to - E.from) * E.R.k / Math.max(1e-3, (E.t1 - E.t0) * DAY_SECONDS) * gs : 0;
      this.drawArmy(st, A, E);
    }
    // Schlachten
    for (const F of st.fights || []) {
      if (F.end != null && st.day - F.end >= 2) continue;
      S.fights++;
      this.drawFight(st, F, byId);
    }
    this.updateSinking(st, t);
    this.updateShots(st, t, dt);
    this.finish(figs);
    // Vergessen, was es nicht mehr gibt
    if (this.frame % 240 === 0) {
      for (const [k, E] of this.cache) if (E.seen < this.frame - 2) { for (const L of E.ships) this.stage.scene.remove(L.m); this.cache.delete(k); }
      for (const [id, M] of this.ms) if (M.f < this.frame - 120) this.ms.delete(id);
      const fids = new Set((st.fights || []).map(F => F.id));
      for (const [id, D] of this.dead) if (!fids.has(D.F)) this.dead.delete(id);
      for (const id of this.fc.keys()) if (!fids.has(id)) this.fc.delete(id);
      for (const [k, C] of this.camps) if (C.seen < this.frame - 2) this.camps.delete(k);
    }
  }

  // Wann die Verlierer am letzten Tag einer Schlacht fliehen: nach dem letzten Gefallenen
  fleeAt(F, day) {
    let m = 0.45;
    for (const q of F.fallen) if (q.d === day && q.f + 0.06 > m) m = q.f + 0.06;
    return Math.min(0.92, m);
  }

  // ---------- Heer auf dem Marsch, beim Sammeln, als Wache, in der Belagerung ----------
  drawArmy(st, A, E) {
    const rt = st._rt, P = this.people, R = E.R, o = {};
    this.vArmy = E.vel || 0;
    const dH = Math.max(0, this.dist(R, E.cur)); // vor dem Ortsrand: dort sammelt sich das Heer
    this.at(R, dH, o);
    const near = this.near(o.x, o.z);
    const sea = A.sea0 >= 0 && E.cur >= A.sea0 - 0.5 && E.cur < A.sea1 + 0.5;
    this.drawShips(st, A, E, dH, sea);
    if (A.st === 'siege' && !E.moving) { this.drawCamp(st, A, E, near); return; }
    if (!near) {
      for (const sl of E.slots) if (sl.p) { this.ms.delete(sl.p.id); P.pos.set(sl.p.id, [o.x, groundY(o.x, o.z), o.z]); }
      return;
    }
    this.stat.shown++;
    const era = A.era | 0, gs = this.gs;
    const flee = A.st === 'home' && A.why === 'flucht' && this.T - A.d0 < 1.2;
    const loot = A.st === 'home' && A.why === 'beute';
    const still = !E.moving || A.st === 'muster' || A.st === 'guard' || gs <= 0;
    const mode0 = still ? 'idle' : flee ? 'run' : 'walk';
    // Wache vor dem verteidigten Ort: Front zur Straße hinaus
    let fx2 = o.dx, fz2 = o.dz;
    if (A.st === 'guard') { const T2 = rt.sById.get(A.dest); if (T2) { const dx = o.x - wx(T2.cx), dz = o.z - wz(T2.cy), l = Math.hypot(dx, dz) || 1; fx2 = dx / l; fz2 = dz / l; } }
    const q = {};
    let lx = o.x, lz = o.z;
    for (const sl of E.slots) {
      if (sl.veh) { this.drawVehicle(st, A, E, sl, dH, still, sea); continue; }
      const p = sl.p;
      if (!p || !rt.pById.has(p.id)) continue;
      // auf dem Schiff unsichtbar
      if (sea && !sl.inside) {
        const L2 = E.ships[0];
        if (L2) P.pos.set(p.id, [L2.m.position.x, L2.m.position.y + 0.1, L2.m.position.z]);
        continue;
      }
      if (A.st === 'guard') {
        this.at(R, dH, q); q.dx = fx2; q.dz = fz2;
        const gx = q.x - fz2 * sl.lat * 1.3 - fx2 * sl.back * 0.6, gz = q.z + fx2 * sl.lat * 1.3 - fz2 * sl.back * 0.6;
        this.person(st, A, sl, p, gx, gz, fx2, fz2, hash(p.id, Math.floor(this.t / 9)) < 0.2 ? 'chat' : 'idle', 0);
        continue;
      }
      const dd = dH - sl.back - (flee ? hash(p.id, 3) * 0.3 : 0);
      if (A.st === 'home' && dd >= R.len - 0.05) { this.away.delete(p.id); this.ms.delete(p.id); continue; } // zurück im Dorf
      // noch nicht losgezogen: als Block am Ortsrand (breiter, weniger tief), nicht als Reihe zurück in den Ort
      const blk = dd < 0 ? Math.min(1, -dd) : 0;
      this.at(R, dd < 0 ? dd * 0.45 : dd, q);
      let lat = sl.lat * (flee ? 1.6 : 1 + blk * 0.9) + (flee ? (hash(p.id, 5) - 0.5) * 0.2 : 0);
      if (sl.inside) { const V = sl.inside; if (V.pos) P.pos.set(p.id, V.pos); continue; }
      if (sl.stand) {
        const V = sl.stand; if (!V.pos) continue;
        const gx = V.pos[0] - V.fz * lat * 0.8 - V.fx * 0.02, gz = V.pos[2] + V.fx * lat * 0.8 - V.fz * 0.02;
        this.person(st, A, sl, p, gx, gz, V.fx, V.fz, 'idle', 0, V.pos[1] + 0.065, true);
        continue;
      }
      const gx = q.x - q.dz * lat, gz = q.z + q.dx * lat;
      if (sl.ride || sl.horse) { this.rider(st, A, sl, p, gx, gz, q.dx, q.dz, still); continue; }
      const mode = sl.gen && still && A.st === 'muster' ? 'chat' : mode0;
      this.person(st, A, sl, p, gx, gz, q.dx, q.dz, mode, flee ? 'run' : 0, undefined, false, loot && hash(p.id, 9) < 0.5 ? 'beutel' : undefined);
      if (sl.flag) this.flag(st, A, gx, gz, q.dx, q.dz);
      if (sl.gen) { lx = gx; lz = gz; }
    }
    // Schild über dem Heer
    if (this.o2.labels && this.nLab < 4) {
      const d2 = (lx - this.cam.x) ** 2 + (groundY(lx, lz) - this.cam.y) ** 2 + (lz - this.cam.z) ** 2;
      if (d2 < 44 * 44 && this.cam.y < 70) {
        const T2 = rt.sById.get(A.foe), g = rt.pById.get(A.gen) || rt.pById.get(A.adm);
        const sub = A.st === 'home' ? (A.why === 'flucht' ? L('auf der Flucht', 'in flight') : A.why === 'beute' ? L('mit der Beute auf dem Heimweg', 'heading home with the spoils') : L('auf dem Heimweg', 'heading home'))
          : A.st === 'muster' ? L('sammelt sich', 'mustering') : A.st === 'guard' ? L(`hält Wache vor ${T2 ? T2.name : ''}`, `standing guard before ${T2 ? T2.name : ''}`)
            : sea ? L(`auf See gegen ${T2 ? T2.name : ''}`, `at sea against ${T2 ? T2.name : ''}`) : L(`marschiert gegen ${T2 ? T2.name : ''}`, `marching against ${T2 ? T2.name : ''}`);
        this.label(this.nLab++, `${armyName(st, A)} · ${A.ids.length}`, sub + (g ? ` · ${rankName(g) || L('General', 'General')} ${g.n}` : ''), lx, groundY(lx, lz) + 0.75, lz, d2);
      }
    }
  }

  near(x, z) {
    const c = this.cam, y = groundY(x, z);
    return (x - c.x) ** 2 + (y - c.y) ** 2 + (z - c.z) ** 2 < this.far2;
  }

  // Ein Mensch: Ziel (gx, gz), Blick (hx, hz), weich nachgeführt; y für Menschen auf Fahrzeugen und Mauern
  person(st, A, sl, p, gx, gz, hx, hz, mode, run, y, fixed, item, side) {
    const P = this.people, gs = this.gs, dt = this.dt;
    const sc = figureScale(p, false, false), body = HEIGHT * sc;
    let M = this.ms.get(p.id);
    if (!M || M.f < this.frame - 3 || Math.hypot(gx - M.x, gz - M.z) > 4) { M = { x: gx, z: gz, h: Math.atan2(hx, hz), f: 0 }; this.ms.set(p.id, M); }
    M.f = this.frame;
    const ddx = gx - M.x, ddz = gz - M.z, dd = Math.hypot(ddx, ddz);
    let v = 0;
    if (fixed) { M.x = gx; M.z = gz; }
    else if (dd > 0.015 && gs > 0) {
      const vmax = (run ? 0.75 : 0.32) * Math.max(1, gs) + (this.vArmy || 0);
      const step = Math.min(dd, vmax * dt);
      M.x += ddx / dd * step; M.z += ddz / dd * step;
      v = step / Math.max(dt, 1e-4);
      if (mode !== 'sleep' && dd > 0.04) { mode = v > 0.45 * Math.max(1, gs) ? 'run' : 'walk'; hx = ddx; hz = ddz; }
    } else if (dd <= 0.015) { M.x = gx; M.z = gz; }
    M.h += wrapPi(Math.atan2(hx, hz) - M.h) * Math.min(1, dt * 8);
    const x = M.x, z = M.z, yy = y ?? groundY(x, z) + (mode === 'sleep' ? 0.006 : 0);
    P.pos.set(p.id, [x, yy, z]);
    this.stat.soldiers++;
    const o2 = this.o2;
    if (o2.selId === p.id) { P.ring.visible = true; P.ring.position.set(x, yy + 0.02, z); P.ring.scale.setScalar(1 + Math.sin(this.t * 4) * 0.12); }
    if (P.heroId === p.id) { P.heroMark.visible = true; P.heroMark.position.set(x, yy + HEIGHT * 1.35 + Math.sin(this.t * 2.5) * 0.015, z); P.heroMark.rotation.y = this.t * 1.5; }
    const F = figFor(this.figs, p);
    if (F.n >= F.max) return [x, yy, z];
    this.o.position.set(x, yy, z);
    this.o.rotation.set(0, M.h, 0);
    this.o.scale.setScalar(body);
    this.o.updateMatrix();
    const vv = v || (mode === 'walk' ? (this.vArmy || 0.21 * gs) : 0);
    const rate = mode === 'walk' ? clamp(vv / (STRIDE * body), 0.5, 4) : mode === 'run' ? clamp((vv || 0.6) / (RUN_STRIDE * body), 0.6, 3) : mode === 'fight' ? 0.85 + hash(p.id, 2) * 0.3 : 1;
    const u = unitOf(A ? A.era | 0 : 0, p.id);
    const it = item !== undefined ? item : mode === 'sleep' ? null : this.weapon(p, u, A ? A.era | 0 : 0);
    drawPerson(F, p, this.o.matrix, mode, rate, false, false, false, it, A && mode !== 'sleep' ? this.look(st, p, A, sl) : undefined);
    this.drew = true;
    return [x, yy, z];
  }

  // Reiter: Pferd (Beine schwingen) und Mensch im Sattel
  rider(st, A, sl, p, gx, gz, dx, dz, still, mode) {
    const P = this.people, kind = sl.ride === 'knight' ? 'knight' : 'horse';
    let M = this.ms.get(p.id);
    if (!M || M.f < this.frame - 3 || Math.hypot(gx - M.x, gz - M.z) > 4) { M = { x: gx, z: gz, h: Math.atan2(dx, dz), f: 0, ph: 0, amp: 0 }; this.ms.set(p.id, M); }
    M.f = this.frame;
    const ddx = gx - M.x, ddz = gz - M.z, dd = Math.hypot(ddx, ddz);
    let moved = 0;
    if (dd > 0.015 && this.gs > 0) { const step = Math.min(dd, (0.5 * Math.max(1, this.gs) + (this.vArmy || 0)) * this.dt); M.x += ddx / dd * step; M.z += ddz / dd * step; moved = step; dx = ddx; dz = ddz; }
    else { M.x = gx; M.z = gz; }
    if (!still && moved < 1e-5) moved = (this.vArmy || 0) * this.dt;
    M.h += wrapPi(Math.atan2(dx, dz) - M.h) * Math.min(1, this.dt * 6);
    M.ph = (M.ph || 0) + moved / (0.105 * ANIMAL) * Math.PI;
    M.amp = (M.amp || 0) + ((moved > 1e-4 ? 0.5 : 0) - (M.amp || 0)) * Math.min(1, this.dt * 6);
    const yaw = M.h - Math.PI / 2, c = Math.cos(yaw), sn = Math.sin(yaw), fo = 0.12;
    const yf = groundY(M.x + c * fo, M.z - sn * fo), yb = groundY(M.x - c * fo, M.z + sn * fo);
    const pitch = Math.atan2(yf - yb, 2 * fo), bob = Math.abs(Math.sin(M.ph)) * 0.008 * M.amp / 0.5;
    const ay = (yf + yb) * 0.5 + bob;
    const s = st._rt.sById.get(A.s);
    if (this.n[kind] < this.veh[kind].instanceMatrix.count) {
      compose(_m, M.x, ay, M.z, yaw, pitch, 1);
      this.veh[kind].setMatrixAt(this.n[kind], _m);
      _c.set(s ? s.color : '#b8402e'); this.veh[kind].setColorAt(this.n[kind]++, _c);
      this.legs4(M.x, ay, M.z, yaw, pitch, HORSE, M.ph, M.amp);
    }
    // Reiter im Sattel (Sitzpose, Rumpf ausgeglichen wie in people.js)
    const sc = figureScale(p, false, false), body = HEIGHT * sc, F = figFor(this.figs, p);
    const tr = F.trunk && F.trunk.sit, ry = M.h, cc = Math.cos(ry), ss = Math.sin(ry);
    let px = M.x, pz = M.z;
    if (tr) { px -= (tr[0] * cc + tr[1] * ss) * body; pz -= (-tr[0] * ss + tr[1] * cc) * body; }
    const sy = ay + (0.07 + HORSE.H) * ANIMAL + 0.012 - SEAT_Y * body;
    P.pos.set(p.id, [M.x, sy, M.z]);
    this.stat.soldiers++;
    if (this.o2.selId === p.id) { P.ring.visible = true; P.ring.position.set(M.x, ay + 0.02, M.z); P.ring.scale.setScalar(1.3 + Math.sin(this.t * 4) * 0.12); }
    if (P.heroId === p.id) { P.heroMark.visible = true; P.heroMark.position.set(M.x, sy + HEIGHT * 1.35 + 0.1, M.z); P.heroMark.rotation.y = this.t * 1.5; }
    if (F.n >= F.max) return [M.x, sy, M.z];
    this.o.position.set(px, sy, pz); this.o.rotation.set(0, ry, 0); this.o.scale.setScalar(body); this.o.updateMatrix();
    const u = unitOf(A.era | 0, p.id);
    drawPerson(F, p, this.o.matrix, mode || 'sit', 1, false, false, false, sl.gen ? 'schwert' : this.weapon(p, u, A.era | 0), this.look(st, p, A, sl));
    this.drew = true;
    return [M.x, sy, M.z];
  }
  legs4(x, y, z, yaw, pitch, o, ph, amp) {
    if (this.nLeg > this.legs.instanceMatrix.count - 4) return;
    const sw = Math.sin(ph) * amp;
    _c.set(o.dark);
    compose(_m, x, y, z, yaw, pitch, ANIMAL);
    for (const [lx2, lz2, sg] of [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]) {
      _l.makeRotationZ(sw * sg); _l.setPosition(o.L * 0.32 * lx2, 0.075, o.H * 0.24 * lz2);
      this.legs.setMatrixAt(this.nLeg, _l.premultiply(_m));
      this.legs.setColorAt(this.nLeg++, _c);
    }
  }

  // Fahrzeug in der Kolonne (oder fest beim Lager). Merkt sich Lage für die Besatzung (V.pos, V.fx, V.fz)
  drawVehicle(st, A, E, V, dH, still, sea) {
    if (sea || (A.st === 'home' && dH - V.back >= E.R.len - 0.05)) { V.pos = null; return; }
    const q = {}, d = dH - V.back;
    // noch nicht losgezogen: zwei Reihen nebeneinander, weniger tief (wie das Fußvolk)
    this.at(E.R, d < 0 ? d * 0.45 : d, q);
    if (d < 0 && !V.fly) { const k = E.slots.filter(z => z.veh).indexOf(V), lat = (k % 2 ? -1 : 1) * 0.3 * Math.min(1, -d); q.x -= q.dz * lat; q.z += q.dx * lat; }
    // Hubschrauber fliegen in einer Keilformation über der Kolonne
    if (V.fly) { const k = E.slots.filter(z => z.fly).indexOf(V), lat = k === 0 ? 0 : (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 0.55; q.x -= q.dz * lat - q.dx * Math.ceil(k / 2) * 0.35; q.z += q.dx * lat + q.dz * Math.ceil(k / 2) * 0.35; }
    let M = this.ms.get('v' + A.id + ':' + V.back);
    if (!M || M.f < this.frame - 3 || Math.hypot(q.x - M.x, q.z - M.z) > 4) { M = { x: q.x, z: q.z, yaw: Math.atan2(-q.dz, q.dx), f: 0, ph: 0, amp: 0 }; this.ms.set('v' + A.id + ':' + V.back, M); }
    M.f = this.frame;
    const ddx = q.x - M.x, ddz = q.z - M.z, dd = Math.hypot(ddx, ddz);
    let moved = 0;
    if (dd > 0.015 && this.gs > 0) { const step = Math.min(dd, (0.4 * Math.max(1, this.gs) + (this.vArmy || 0)) * this.dt); M.x += ddx / dd * step; M.z += ddz / dd * step; moved = step; }
    else { M.x = q.x; M.z = q.z; }
    if (!still && moved < 1e-5) moved = (this.vArmy || 0) * this.dt;
    M.yaw += wrapPi(Math.atan2(-q.dz, q.dx) - M.yaw) * Math.min(1, this.dt * 4);
    V.fx = Math.cos(M.yaw); V.fz = -Math.sin(M.yaw);
    this.placeVehicle(st, A, V, M, moved);
  }
  placeVehicle(st, A, V, M, moved, aimPitch = 0) {
    const kind = V.veh, mesh = this.veh[kind];
    const c = Math.cos(M.yaw), sn = Math.sin(M.yaw), fo = 0.14;
    let y, pitch;
    if (V.fly) {
      y = groundY(M.x, M.z) + 1.1 + Math.sin(this.t * 1.3 + A.id) * 0.04; pitch = -0.08 * Math.min(1, moved * 40); V.pos = [M.x, y, M.z];
    } else {
      const yf = groundY(M.x + c * fo, M.z - sn * fo), yb = groundY(M.x - c * fo, M.z + sn * fo);
      pitch = Math.atan2(yf - yb, 2 * fo); y = (yf + yb) * 0.5; V.pos = [M.x, y, M.z];
    }
    const s = st._rt.sById.get(A.s);
    if (this.near(M.x, M.z) && this.n[kind] < mesh.instanceMatrix.count) {
      compose(_m, M.x, y, M.z, M.yaw, pitch + aimPitch, 1);
      mesh.setMatrixAt(this.n[kind], _m);
      _c.set(s ? s.color : '#b8402e'); mesh.setColorAt(this.n[kind]++, _c);
      if (V.fly && this.nRotor < this.rotor.instanceMatrix.count) {
        compose(_m, M.x, y + 0.11, M.z, M.yaw + this.t * 22, 0, 1); this.rotor.setMatrixAt(this.nRotor++, _m);
      }
      // Zugtier vor Kanone, Feldgeschütz, Tribok
      if (V.pull && moved > 0) {
        const pk = V.pull === 'ox' ? 'ox' : 'horse', px = M.x + c * 0.36, pz = M.z - sn * 0.36;
        M.ph = (M.ph || 0) + moved / (0.105 * ANIMAL) * Math.PI; M.amp = 0.45;
        if (this.n[pk] < this.veh[pk].instanceMatrix.count) {
          compose(_m, px, groundY(px, pz) + Math.abs(Math.sin(M.ph)) * 0.005, pz, M.yaw, pitch, 1);
          this.veh[pk].setMatrixAt(this.n[pk], _m); this.veh[pk].setColorAt(this.n[pk]++, _c);
          this.legs4(px, groundY(px, pz), pz, M.yaw, pitch, pk === 'ox' ? { L: 0.15, H: 0.085, dark: '#6a4c36' } : HORSE, M.ph, M.amp);
        }
      }
      // Rauch aus dem Auspuff (Panzer, Wagen)
      if ((kind === 'tank' || kind === 'acar' || kind === 'rocket') && moved > 0 && Math.random() < this.dt * 3) this.fx.smoke.emit({ x: M.x - c * 0.2, y: y + 0.12, z: M.z + sn * 0.2, vy: 0.12, life: 1.6, size: 0.06, grow: 1.6, c: [0.4, 0.4, 0.42], a: 0.3 });
    }
  }

  // Fahne: Stange neben dem Träger, Tuch in der Ortsfarbe
  flag(st, A, x, z, dx, dz, h = 0) {
    if (this.n.pole >= MAXFLAG || this.nCloth >= MAXFLAG) return;
    const s = st._rt.sById.get(A.s);
    const px = x - dz * 0.055 + dx * 0.02, pz = z + dx * 0.055 + dz * 0.02, y = groundY(px, pz) + h;
    compose(_m, px, y, pz, 0, 0, 1); this.veh.pole.setMatrixAt(this.n.pole, _m); this.veh.pole.setColorAt(this.n.pole++, _c.set(1, 1, 1));
    // Tuch weht vom Wind abgewandt, leicht gegen die Laufrichtung
    const yaw = Math.atan2(dz, -dx) + Math.sin(this.t * 0.7 + A.id) * 0.25;
    compose(_m, px, y + 0.55, pz, yaw, 0, 1);
    this.cloth.setMatrixAt(this.nCloth, _m);
    _c.set(s ? s.color : '#b8402e'); this.cloth.setColorAt(this.nCloth++, _c);
  }

  // ---------- Schiffe ----------
  fleet(A, E) {
    const want = A.kind === 'flotte' ? Math.max(1, Math.min(5, Math.ceil(Math.max(A.ids.length, 1) / 6))) : 0;
    while (E.ships.length < want) { const L2 = this.ships.spawn('krieg', A.era | 0); L2.m.visible = false; E.ships.push(L2); }
    while (E.ships.length > want) this.stage.scene.remove(E.ships.pop().m);
    return want;
  }
  drawShips(st, A, E, dH, sea) {
    const R = E.R, want = this.fleet(A, E);
    if (!want) return;
    if (A.sea0 < 0) { for (const L2 of E.ships) L2.m.visible = false; return; }
    const d0 = this.dist(R, A.sea0), d1 = this.dist(R, A.sea1);
    // vor dem Ablegen im Hafen, danach an der Landestelle vor Anker
    const q = {};
    const rise = this.o2.rise || 0;
    E.ships.forEach((L2, k) => {
      const d = clamp(dH - k * 1.4, d0 + 0.3, d1 - 0.3 - k * 0.2);
      this.at(R, d, q);
      const lat = (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 0.55;
      let x = q.x - q.dz * lat, z = q.z + q.dx * lat;
      let M = this.ms.get('s' + A.id + ':' + k);
      if (!M || M.f < this.frame - 3 || Math.hypot(x - M.x, z - M.z) > 6) { M = { x, z, yaw: Math.atan2(-q.dz, q.dx), f: 0 }; this.ms.set('s' + A.id + ':' + k, M); }
      M.f = this.frame;
      const ddx = x - M.x, ddz = z - M.z, dd = Math.hypot(ddx, ddz);
      if (dd > 0.01 && this.gs > 0) { const step = Math.min(dd, (0.6 * Math.max(1, this.gs) + (this.vArmy || 0) * 1.5) * this.dt); M.x += ddx / dd * step; M.z += ddz / dd * step; }
      M.yaw += wrapPi(Math.atan2(-q.dz, q.dx) - M.yaw) * Math.min(1, this.dt * 2);
      this.shipAt(L2, M.x, M.z, M.yaw, rise, A.id + k);
      L2.m.visible = this.near(M.x, M.z) || sea;
      if (L2.m.visible) this.ships.anim(L2, this.t);
    });
  }
  shipAt(L2, x, z, yaw, rise, ph) {
    L2.m.position.set(x, 0.03 + rise + Math.sin(this.t * 1.6 + ph) * 0.03, z);
    L2.m.rotation.set(Math.sin(this.t * 1.2 + ph) * 0.04, yaw, Math.sin(this.t * 1.4 + ph) * 0.03);
  }

  // ---------- Belagerung: Lager, Feuer, Geschütze, Verteidiger auf der Mauer ----------
  camp(st, A) {
    const key = A.id + ':' + Math.round(A.x * 4) + ':' + Math.round(A.y * 4);
    let C = this.camps.get(key);
    if (C) { C.seen = this.frame; return C; }
    const rt = st._rt, T = rt.sById.get(A.foe);
    const cx = wx(A.x), cz = wz(A.y), tx = T ? wx(T.cx) : cx + 1, tz = T ? wz(T.cy) : cz;
    let fx = tx - cx, fz = tz - cz; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const sx = -fz, sz = fx;
    const ok = (x, z) => {
      const ix = Math.floor(x + NX / 2), iy = Math.floor(z + NY / 2);
      if (ix < 0 || iy < 0 || ix >= NX || iy >= NY) return false;
      const j = iy * NX + ix;
      return st.tiles.h[j] >= 0 && !rt.bldAt[j];
    };
    // Zelte zuerst hinter dem Lager (weg von der Stadt), sonst seitlich; nie zur Stadt hin, nicht im Wasser, nicht auf Häusern
    const tents = [], nT = Math.min(14, Math.max(2, Math.ceil(A.n0 / 3)));
    const cand = [];
    for (let r = 1; r <= 6; r++) for (let c = -4; c <= 4; c++) {
      const back = 0.45 + r * 0.42 - Math.abs(c) * 0.12 * (r < 2 ? 1 : 0);
      cand.push([back, c, r * 10 + Math.abs(c)]);
    }
    for (let c = -6; c <= 6; c++) if (Math.abs(c) >= 2) cand.push([0.1, c, 70 + Math.abs(c)]);
    cand.sort((a, b) => a[2] - b[2]);
    for (const [back, c, k] of cand) {
      if (tents.length >= nT) break;
      const x = cx - fx * back + sx * c * 0.44 + (hash(A.id, k * 9 + 1) - 0.5) * 0.1, z = cz - fz * back + sz * c * 0.44 + (hash(A.id, k * 7 + 2) - 0.5) * 0.1;
      if (!ok(x, z) || tents.some(([x2, z2]) => Math.hypot(x2 - x, z2 - z) < 0.36)) continue;
      tents.push([x, z, Math.atan2(-fz, fx) + (hash(A.id, c) < 0.5 ? 0 : Math.PI) + (hash(A.id, k + 3) - 0.5) * 0.3]);
    }
    let fire = [cx - fx * 0.35, cz - fz * 0.35];
    if (!ok(fire[0], fire[1])) fire = [cx, cz];
    // Zielpunkt an der Mauer (oder am Ortsrand)
    let wxp = tx - fx * 1.5, wzp = tz - fz * 1.5, wallR = T ? (T.R || 4) * 0.7 : 2;
    if (T && T.wall && T.wall.lvl && T.wall.ring) { const a = Math.atan2(A.y - T.cy, A.x - T.cx); wallR = ringAt(T.wall.ring, a); wxp = wx(T.cx + 0.5 + Math.cos(a) * wallR) - 0.5; wzp = wz(T.cy + 0.5 + Math.sin(a) * wallR) - 0.5; }
    C = { key, cx, cz, fx, fz, sx, sz, tents, fire, wx: wxp, wz: wzp, wallR, seen: this.frame, next: 0 };
    this.camps.set(key, C);
    return C;
  }
  drawCamp(st, A, E, near) {
    this.vArmy = 0;
    const rt = st._rt, P = this.people, C = this.camp(st, A), era = A.era | 0, f = this.f;
    const day = f >= 0.27 && f < 0.75, s = rt.sById.get(A.s), T = rt.sById.get(A.foe);
    // Zelte und Feuer
    if (near) {
      this.stat.shown++;
      const kind = era <= 3 ? 'tentR' : 'tentL';
      _c.set(era >= 7 ? '#6f7a52' : era >= 6 ? '#c9c2a8' : '#ece4d0');
      for (const [x, z, yaw] of C.tents) if (this.n[kind] < MAXTENT) { compose(_m, x, groundY(x, z), z, yaw, 0, 1); this.veh[kind].setMatrixAt(this.n[kind], _m); this.veh[kind].setColorAt(this.n[kind]++, _c); }
      this.campFire(C.fire[0], C.fire[1], !day ? 1 : 0.35);
      this.flag(st, A, C.fire[0] + C.sx * 0.25, C.fire[1] + C.sz * 0.25, C.fx, C.fz);
    }
    // Wer wo ist: Geschützbesatzungen an ihrem Gerät, Wachen vorn, die anderen am Feuer oder bei den Zelten
    let sentry = 0, fireK = 0, i = 0;
    const engines = E.slots.filter(sl => sl.veh);
    engines.forEach((V, k) => {
      const lat = (k - (engines.length - 1) / 2) * 0.55, x = C.cx + C.fx * 0.25 + C.sx * lat, z = C.cz + C.fz * 0.25 + C.sz * lat;
      const M = { x, z, yaw: Math.atan2(-C.fz, C.fx) };
      V.fx = C.fx; V.fz = C.fz;
      if (V.fly) { M.x -= C.fx * 0.6; M.z -= C.fz * 0.6; }
      this.placeVehicle(st, A, V, M, 0);
      if (day && near && SHOT[V.u] && Math.random() < this.dt * 0.35 * (V.fly ? 0.5 : 1)) this.fire(V.u, V.pos[0] + C.fx * 0.25, V.pos[1] + 0.2, V.pos[2] + C.fz * 0.25, C.wx + (Math.random() - 0.5) * 0.4, groundY(C.wx, C.wz) + 0.2, C.wz + (Math.random() - 0.5) * 0.4, era);
    });
    for (const sl of E.slots) {
      if (sl.veh) continue;
      const p = sl.p; if (!p || !rt.pById.has(p.id)) continue;
      if (!near) { this.ms.delete(p.id); P.pos.set(p.id, [C.cx, groundY(C.cx, C.cz), C.cz]); continue; }
      if (sl.inside) { if (sl.inside.pos) P.pos.set(p.id, sl.inside.pos); continue; }
      if (sl.crew || sl.stand) {
        const V = sl.crew || sl.stand; if (!V.pos) continue;
        const k = E.slots.filter(z2 => (z2.crew || z2.stand) === V).indexOf(sl);
        const [x, z] = this.dry(st, V.pos[0] - C.fx * 0.15 + C.sx * (k % 2 ? -0.12 : 0.12), V.pos[2] - C.fz * 0.15 + C.sz * (k % 2 ? -0.12 : 0.12), C.fx, C.fz);
        this.person(st, A, sl, p, x, z, C.fx, C.fz, day && hash(p.id, Math.floor(this.t / 3)) < 0.5 ? 'pickup' : 'idle', 0);
        continue;
      }
      i++;
      if (sl.ride || sl.horse) {
        // Pferde stehen bei den Zelten
        const [x, z] = this.dry(st, C.cx - C.fx * 0.3 - C.sx * (0.6 + (i % 4) * 0.25), C.cz - C.fz * 0.3 - C.sz * (0.6 + (i % 4) * 0.25), C.fx, C.fz);
        this.rider(st, A, sl, p, x, z, C.sx, C.sz, true);
        continue;
      }
      if (day ? sentry < 6 && hash(p.id, 41) < 0.45 : sentry < 2 && hash(p.id, 43) < 0.2) {
        const lat = (sentry - 2.5) * 0.24; sentry++;
        const [x, z] = this.dry(st, C.cx + C.fx * 0.05 + C.sx * lat, C.cz + C.fz * 0.05 + C.sz * lat, C.fx, C.fz);
        this.person(st, A, sl, p, x, z, C.fx, C.fz, 'idle', 0);
        if (sl.flag) this.flag(st, A, x, z, C.fx, C.fz);
        if (day && SHOT[unitOf(era, p.id)] && Math.random() < this.dt * 0.12) this.fire(unitOf(era, p.id), x, groundY(x, z) + 0.2, z, C.wx, groundY(C.wx, C.wz) + 0.3, C.wz, era);
        continue;
      }
      if (!day && fireK >= 9) { P.pos.set(p.id, [C.cx, groundY(C.cx, C.cz), C.cz]); continue; } // schläft im Zelt
      const a = (fireK++ + 0.5) / 9 * Math.PI * 2 + hash(A.id, 1), rr = day ? 0.3 + hash(p.id, 6) * 0.25 : 0.2;
      const x = C.fire[0] + Math.cos(a) * rr, z = C.fire[1] + Math.sin(a) * rr;
      const mode = day ? (hash(p.id, Math.floor(this.t / 8)) < 0.5 ? 'chat' : 'idle') : 'floor';
      let [gx, gz] = this.dry(st, x, z, C.fx, C.fz);
      if (mode === 'floor') {
        const F = figFor(this.figs, p), tr = F.trunk && F.trunk.floor;
        if (tr) { const ry = Math.atan2(-Math.cos(a), -Math.sin(a)), cc = Math.cos(ry), ss = Math.sin(ry), body = HEIGHT * figureScale(p, false, false); gx -= (tr[0] * cc + tr[1] * ss) * body; gz -= (-tr[0] * ss + tr[1] * cc) * body; }
      }
      this.person(st, A, sl, p, gx, gz, -Math.cos(a), -Math.sin(a), mode, 0, undefined, false, mode === 'floor' ? null : undefined);
    }
    // Verteidiger auf der Mauer schießen zurück (nur nah, nur bei Tag, Stufen mit Wehrgang)
    if (near && T && T.wall && T.wall.lvl >= 2 && T.wall.lvl <= 5) this.wallGuards(st, A, C, T, day);
    // Schild über dem Lager
    if (near && this.o2.labels && this.nLab < 4) {
      const d2 = (C.cx - this.cam.x) ** 2 + (groundY(C.cx, C.cz) - this.cam.y) ** 2 + (C.cz - this.cam.z) ** 2;
      if (d2 < 44 * 44 && this.cam.y < 70) {
        const W = T && T.wall && T.wall.lvl ? T.wall : null;
        this.label(this.nLab++, `${L('Belagerung von', 'Siege of')} ${T ? T.name : ''}`, `${armyName(st, A)} · ${A.ids.length} · ${L('Tag', 'day')} ${(A.siegeDays || 0) + 1}` + (W ? ` · ${L('Mauer', 'wall')} ${Math.round(W.hp * 100)}%` : ''), C.cx, groundY(C.cx, C.cz) + 0.8, C.cz, d2);
      }
    }
  }
  wallGuards(st, A, C, T, day) {
    const rt = st._rt, lvl = T.wall.lvl, top = lvl === 2 ? 0.2 : lvl === 3 ? 0.3 : lvl === 4 ? 0.4 : 0.26;
    let n = 0;
    for (const p of st.people) {
      if (n >= 4) break;
      if (p.s !== T.id || p.job !== 'krieger' || p.army || p.away || this.away.has(p.id)) continue;
      const lat = (n - 1.5) * 0.3, x = C.wx + C.sx * lat - C.fx * 0.04, z = C.wz + C.sz * lat - C.fz * 0.04;
      this.away.add(p.id); n++;
      const A2 = { era: T.era | 0, s: T.id };
      this.person(st, A2, null, p, x, z, -C.fx, -C.fz, 'idle', 0, groundY(x, z) + top, true);
      if (day && Math.random() < this.dt * 0.25) { const u = unitOf(T.era | 0, p.id); this.fire(SHOT[u] ? u : 'bogen', x, groundY(x, z) + top + 0.2, z, C.cx + (Math.random() - 0.5) * 0.8, groundY(C.cx, C.cz) + 0.1, C.cz + (Math.random() - 0.5) * 0.8, T.era | 0); }
    }
    void rt;
  }
  campFire(x, z, k) {
    if (this.n.pit >= MAXFIRE) return;
    const y = groundY(x, z), t = this.t;
    compose(_m, x, y, z, 0.7, 0, 1); this.veh.pit.setMatrixAt(this.n.pit, _m); this.veh.pit.setColorAt(this.n.pit++, _c.set(1, 1, 1));
    if (this.nFlame < MAXFIRE * 2 - 1) {
      const fl = 1 + 0.22 * Math.sin(t * 13.1 + x * 40) + 0.12 * Math.sin(t * 23.7 + z * 9), w = 1 + 0.1 * Math.sin(t * 17.3 + x);
      _e.set(0, t * 0.7, 0); _q.setFromEuler(_e);
      _m.compose(_p.set(x, y + 0.006, z), _q, _s.set(k * w * 1.3, k * fl * 1.3, k * w * 1.3)); this.flame.setMatrixAt(this.nFlame, _m); this.flame.setColorAt(this.nFlame++, _c.setRGB(2.6, 1.05, 0.28));
      _m.compose(_p.set(x, y + 0.01, z), _q, _s.set(k * 0.78, k * fl * 0.94, k * 0.78)); this.flame.setMatrixAt(this.nFlame, _m); this.flame.setColorAt(this.nFlame++, _c.setRGB(3.0, 2.1, 0.9));
    }
    if (Math.random() < this.dt * 4 * k) this.fx.glow.emit({ x: x + (Math.random() - 0.5) * 0.04, y: y + 0.08, z: z + (Math.random() - 0.5) * 0.04, vx: (Math.random() - 0.5) * 0.06, vy: 0.22 + Math.random() * 0.2, vz: (Math.random() - 0.5) * 0.06, life: 0.9 + Math.random() * 0.8, size: 0.022, c: [1, 0.62, 0.25], a: 0.95, drag: 0.97 });
    if (Math.random() < this.dt * 1.4) this.fx.smoke.emit({ x, y: y + 0.16, z, vy: 0.1, vx: 0.02, life: 3, size: 0.07, grow: 2.2, c: [0.55, 0.55, 0.58], a: 0.18 });
  }

  // ---------- Schlachten ----------
  drawFight(st, F, byId) {
    const rt = st._rt, P = this.people, day = st.day, frac = this.frac;
    const ended = F.end != null, endToday = ended && F.end === day;
    const fleeT = endToday ? this.fleeAt(F, day) : 2;
    const over = ended && (F.end < day || frac >= fleeT);
    let cx = wx(F.x), cz = wz(F.y);
    // Schlacht an Land: liegt die Mitte im Wasser (Treffen am Ufer), rückt sie aufs nächste Land
    if (F.k !== 'see' && st.tiles.h[Math.round(F.y) * NX + Math.round(F.x)] < 0) {
      let best = null, bd = 1e9;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const tx = Math.round(F.x) + dx, ty = Math.round(F.y) + dy;
        if (tx < 0 || ty < 0 || tx >= NX || ty >= NY || st.tiles.h[ty * NX + tx] < 0) continue;
        const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = [tx, ty]; }
      }
      if (best) { cx = wx(best[0]); cz = wz(best[1]); }
    }
    const near = this.near(cx, cz);
    const T = rt.sById.get(F.town);
    // Achse: von der Seite a zur Seite b (beim Sturm von außen zur Mauer, auf See und im Feld vom Angreifer)
    let ax = 1, az = 0;
    const A0 = byId.get(F.a[0]);
    if ((F.k === 'sturm' || F.k === 'ausfall') && T) { ax = wx(T.cx) - cx; az = wz(T.cy) - cz; }
    else if (A0) { const E = this.cache.get(A0.id); if (E) { const q = {}; this.at(E.R, this.dist(E.R, A0.pi), q); ax = q.dx; az = q.dz; } }
    const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
    let FC = this.fc.get(F.id);
    if (!FC) {
      FC = { ax, az, aSide: A0 ? A0.side : null, dx: 0, dz: 0 };
      if (F.k === 'feld') Object.assign(FC, this.field(st, cx, cz, ax, az)); // beide Linien auf freies Land
      this.fc.set(F.id, FC);
    }
    ax = FC.ax; az = FC.az; cx += FC.dx; cz += FC.dz; // nicht drehen, solange sie kämpft
    if (FC.aSide == null && A0) FC.aSide = A0.side;
    if (FC.aSide == null) { const e = (st.milLog || []).find(q => q.d === F.d0 && q.name === F.name); if (e) FC.aSide = e.a; }
    const sx = -az, sz = ax;
    // Mitte der Schlacht: beim Sturm an der Mauer
    let mx = cx, mz = cz;
    if ((F.k === 'sturm' || F.k === 'ausfall') && T) {
      let r = (T.R || 4) * 0.7;
      if (T.wall && T.wall.lvl && T.wall.ring) r = ringAt(T.wall.ring, Math.atan2(F.y - T.cy, F.x - T.cx));
      const a = Math.atan2(F.y - T.cy, F.x - T.cx);
      const bx = wx(T.cx + 0.5 + Math.cos(a) * r) - 0.5, bz = wz(T.cy + 0.5 + Math.sin(a) * r) - 0.5;
      if (F.k === 'sturm') { mx = bx - ax * 0.25; mz = bz - az * 0.25; } else { mx = (bx + cx) / 2; mz = (bz + cz) / 2; }
    }
    // Seiten zusammenstellen: lebende Kämpfer der Heere, Besatzung des Ortes, und wer heute noch fallen wird
    const sides = [[], []];
    for (const [k, list] of [[0, F.a], [1, F.b]]) for (const id of list) {
      const A = byId.get(id); if (!A) continue;
      for (const pid of A.ids) { const p = rt.pById.get(pid); if (p) sides[k].push({ p, A }); }
    }
    if (T) for (const pid of F.gar || []) { const p = rt.pById.get(pid); if (p && !p.army) sides[1].push({ p, A: { era: T.era | 0, s: T.id, id: -T.id }, gar: true }); }
    // am ersten Tag eines Sturms bestimmt die Simulation die Besatzung noch nicht: so viele wie erwartet (n0), Krieger zuerst
    if (T && (F.k === 'sturm' || F.k === 'ausfall') && !(F.gar || []).length && day === F.d0) {
      const want = Math.max(0, F.n0[1] - sides[1].length), list = [];
      for (const p of st.people) if (p.s === T.id && !p.army && p.job === 'krieger') list.push(p);
      for (const p of st.people) if (list.length < want && p.s === T.id && !p.army && p.job !== 'krieger' && p.job !== 'kind' && p.job !== 'alt' && p.sex === 'm') list.push(p);
      for (const p of list.slice(0, want)) sides[1].push({ p, A: { era: T.era | 0, s: T.id, id: -T.id }, gar: true });
    }
    const later = new Map();
    for (const q of F.fallen) {
      if (q.d === day && q.f > frac) later.set(q.id, q);
    }
    for (const q of later.values()) {
      const A = byId.get(q.side === 1 ? F.a[0] : F.b[0]) || (T ? { era: T.era | 0, s: q.side === 1 ? 0 : T.id, id: -1 } : null);
      if (A) sides[q.side - 1].push({ p: { id: q.id, n: q.n, sex: q.sex, clan: q.clan, job: q.job, lt: '' }, A, falls: q.f });
    }
    // Wer am Kampf beteiligt ist, fehlt im Dorf (Besatzung)
    const cheer = endToday && frac >= fleeT && frac < fleeT + 0.16;
    const done = ended && !cheer && !(endToday && frac < fleeT);
    if (!done) for (const side of sides) for (const e of side) this.away.add(e.p.id);
    if (F.k === 'see') {
      if (!done) for (const side of sides) for (const e of side) this.people.pos.set(e.p.id, [cx, 0.25, cz]);
      this.seaFight(st, F, byId, sides, cx, cz, ax, az, over, near);
      return;
    }
    if (!near) {
      if (!done) for (const side of sides) for (const e of side) { this.ms.delete(e.p.id); P.pos.set(e.p.id, [mx, groundY(mx, mz), mz]); }
      return;
    }
    this.stat.shown++;
    this.vArmy = 0;
    // Ablauf am Tag: am ersten Tag Aufstellung, danach Fernkampf, dann Nahkampf; am Ende Flucht und Jubel
    const first = day === F.d0;
    const ph = first ? (frac < 0.55 ? 'form' : 'volley') : frac < 0.14 ? 'volley' : 'melee';
    const winSide = ended ? (F.win === FC.aSide ? 0 : 1) : -1;
    for (let k = 0; k < 2 && !done; k++) {
      const side = sides[k], dir = k ? -1 : 1, n = side.length;
      if (cheer && k !== winSide) continue; // die Verlierer sind schon auf dem Heimweg (drawArmy)
      const W = Math.max(3, Math.min(9, Math.ceil(n / 2)));
      let iMelee = 0, iRange = 0, iMount = 0;
      for (const e of side) {
        const p = e.p, u = unitOf(e.A.era | 0, p.id), role = UNITS[u] ? UNITS[u].r : 0, V = VEH[u];
        if (V && V.inside) {
          // Fahrzeuge mit Besatzung drin: eins je Mannschaft, im Feld hinter den Linien
          if (hash(p.id, 51) > 1 / (UNITS[u].crew || 1) && !e.lead) { P.pos.set(p.id, [mx, groundY(mx, mz), mz]); continue; }
          const lat = ((iRange++ % W) - (W - 1) / 2) * 0.32, back = 1.0;
          const M = { x: mx - ax * dir * back + sx * lat, z: mz - az * dir * back + sz * lat, yaw: Math.atan2(-az * dir, ax * dir) };
          if (!V.fly) [M.x, M.z] = this.dry(st, M.x, M.z, ax * dir, az * dir);
          const VV = { veh: V.v, u, fly: V.fly };
          this.placeVehicle(st, e.A, VV, M, 0);
          P.pos.set(p.id, VV.pos);
          if (!cheer && ph !== 'form' && Math.random() < this.dt * 0.6) this.fire(u, M.x + ax * dir * 0.25, VV.pos[1] + 0.18, M.z + az * dir * 0.25, mx + ax * dir * (0.4 + Math.random() * 0.6) + sx * (Math.random() - 0.5) * 1.6, groundY(mx, mz) + 0.1, mz + az * dir * (0.4 + Math.random() * 0.6) + sz * (Math.random() - 0.5) * 1.6, e.A.era | 0);
          continue;
        }
        let back, lat, mode, run = 0;
        const ranged = role === 1 || (role === 3 && !V) || (SHOT[u] && role !== 0);
        if (V && V.ride) {
          const i = iMount++, flank = i % 2 ? 1 : -1;
          lat = flank * ((W / 2) * 0.16 + 0.3 + Math.floor(i / 2) * 0.24);
          back = ph === 'melee' ? 0.12 : 0.75;
          if (cheer) { back = 0.5; }
          const [rx, rz] = this.dry(st, mx - ax * dir * back + sx * lat, mz - az * dir * back + sz * lat, ax * dir, az * dir);
          this.rider(st, e.A, { ride: V.v === 'knight' ? 'knight' : 'horse' }, p, rx, rz, ax * dir, az * dir, ph !== 'melee' || cheer);
          continue;
        }
        if (ranged || (role === 3 && V)) {
          const i = iRange++;
          lat = ((i % W) - (W - 1) / 2) * 0.16 + (Math.floor(i / W) % 2) * 0.08; back = 0.85 + Math.floor(i / W) * 0.18;
          mode = 'idle';
          if (V && !V.ride) {
            // Geschütz (Tribok, Kanone, Feldgeschütz) mit Bedienung: nur der erste der Mannschaft stellt das Gerät
            if (hash(p.id, 52) < 1 / (UNITS[u].crew || 1)) { const M = { x: mx - ax * dir * (back + 0.3) + sx * lat, z: mz - az * dir * (back + 0.3) + sz * lat, yaw: Math.atan2(-az * dir, ax * dir) }; [M.x, M.z] = this.dry(st, M.x, M.z, ax * dir, az * dir); this.placeVehicle(st, e.A, { veh: V.v, u }, M, 0); }
            mode = 'pickup';
          }
          if (!cheer && ph !== 'form' && SHOT[u] && Math.random() < this.dt * (V ? 0.25 : 0.55)) {
            const x0 = mx - ax * dir * back + sx * lat, z0 = mz - az * dir * back + sz * lat;
            this.fire(u, x0 + ax * dir * 0.06, groundY(x0, z0) + (V ? 0.2 : 0.22), z0 + az * dir * 0.06, mx + ax * dir * (0.15 + Math.random() * 0.8) + sx * (Math.random() - 0.5) * W * 0.16, groundY(mx, mz) + 0.05, mz + az * dir * (0.15 + Math.random() * 0.8) + sz * (Math.random() - 0.5) * W * 0.16, e.A.era | 0);
          }
        } else {
          const i = iMelee++, rank = Math.floor(i / W);
          lat = ((i % W) - (W - 1) / 2) * 0.15 + (rank % 2) * 0.07;
          if (ph === 'form') { back = 0.55 + rank * 0.18; mode = 'idle'; }
          else if (ph === 'volley') { back = 0.5 + rank * 0.18; mode = 'idle'; }
          else { back = 0.09 + rank * 0.15 + (hash(p.id, Math.floor(this.t / 2)) - 0.5) * 0.05; mode = rank < 2 ? 'fight' : 'idle'; run = 1; }
          if (F.k === 'sturm' && k === 1 && ph !== 'melee') back = 0.2 + rank * 0.15; // Verteidiger hinter der Mauer
        }
        if (cheer) mode = 'cheer';
        let gx = mx - ax * dir * back + sx * lat, gz = mz - az * dir * back + sz * lat;
        [gx, gz] = this.dry(st, gx, gz, ax * dir, az * dir);
        // fallen: ab ihrer Stelle im Tag liegen sie (die Simulation hat sie schon getötet)
        if (e.falls != null && frac >= e.falls) continue;
        const r2 = this.person(st, e.A, e.A.gen === p.id ? GEN : null, p, gx, gz, ax * dir, az * dir, mode, run);
        if (e.falls != null) this.dead.set(p.id, { F: F.id, x: r2[0], z: r2[2], h: Math.atan2(ax * dir, az * dir) + (hash(p.id, 7) - 0.5) * 2, sex: p.sex, clan: p.clan, job: p.job, side: k });
        if (iMelee === 1 && !ranged && k === 0 && !cheer && ph === 'melee' && Math.random() < this.dt * 2) this.clash(mx + sx * (Math.random() - 0.5) * W * 0.15, mz + sz * (Math.random() - 0.5) * W * 0.15);
      }
    }
    this.fallenBodies(st, F, near, mx, mz, ax, az, sx, sz, false);
    // Schild über der Schlacht
    if (this.o2.labels && this.nLab < 4) {
      const d2 = (mx - this.cam.x) ** 2 + (groundY(mx, mz) - this.cam.y) ** 2 + (mz - this.cam.z) ** 2;
      if (d2 < 48 * 48 && this.cam.y < 75) {
        const name = F.name ? F.name.charAt(0).toUpperCase() + F.name.slice(1) : L('Schlacht', 'Battle');
        const W2 = ended ? rt.sById.get(F.win) : null;
        this.label(this.nLab++, name, ended && done && W2 ? L(`${W2.name} siegt · ${F.dead[0] + F.dead[1]} Tote`, `${W2.name} prevails · ${F.dead[0] + F.dead[1]} dead`) : `${sides[0].length} ${L('gegen', 'against')} ${sides[1].length} · ${F.dead[0] + F.dead[1]} ${L('Tote', 'dead')}`, mx, groundY(mx, mz) + 0.85, mz, d2);
      }
    }
  }
  // Freier Platz: kein Wasser (auch nicht das geglättete Ufer unter der Wasserlinie), kein Haus (Felder und Plätze gehen)
  free(st, x, z) {
    const tx = Math.floor(x + NX / 2), ty = Math.floor(z + NY / 2);
    if (tx < 0 || ty < 0 || tx >= NX || ty >= NY) return false;
    const j = ty * NX + tx, rt = st._rt;
    if (st.tiles.h[j] < 0 || groundY(x, z) < 0.03) return false;
    const b = rt.bldAt[j] && rt.bById.get(rt.bldAt[j]);
    return !b || b.t === 'feld' || b.t === 'park' || (b.t === 'zentrum' && (b.lvl | 0) <= 1);
  }
  // Platz für einen Kämpfer: liegt (x, z) nicht frei, rückt er nach vorn (dx, dz), zur Seite oder zurück, jeder für sich,
  // so bleiben die Abstände in der Linie erhalten (früher zog alles zur Mitte und stand auf einem Fleck)
  dry(st, x, z, dx, dz) {
    if (this.free(st, x, z)) return [x, z];
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    for (let k = 1; k <= 14; k++) {
      const d = k * 0.11;
      for (const [ux, uz] of [[dx, dz], [-dz, dx], [dz, -dx], [-dx, -dz]]) { const x2 = x + ux * d, z2 = z + uz * d; if (this.free(st, x2, z2)) return [x2, z2]; }
    }
    return [x, z];
  }
  // Schlachtfeld: Ausrichtung und Mitte so wählen, dass beide Linien auf freiem Land stehen (Treffen am Ufer, zwischen
  // Häusern). Geprüft werden 16 Richtungen, die ursprüngliche zuerst, und Mitten bis 0,9 Felder daneben.
  field(st, cx, cz, ax, az) {
    const a0 = Math.atan2(az, ax);
    let best = { ax, az, dx: 0, dz: 0 }, bs = -1;
    const shifts = [[0, 0]];
    for (let k = 0; k < 8; k++) { const b = k / 8 * Math.PI * 2; shifts.push([Math.cos(b) * 0.6, Math.sin(b) * 0.6], [Math.cos(b) * 0.95, Math.sin(b) * 0.95]); }
    for (const [dx, dz] of shifts) for (let k = 0; k < 16; k++) {
      const a = a0 + Math.ceil(k / 2) * (k % 2 ? 1 : -1) * Math.PI / 8, ux = Math.cos(a), uz = Math.sin(a), vx = -uz, vz = ux;
      let sc = 0;
      for (const b of [0.15, 0.55, 0.95]) for (const l of [-0.5, 0, 0.5]) for (const sd of [1, -1]) if (this.free(st, cx + dx - ux * sd * b + vx * l, cz + dz - uz * sd * b + vz * l)) sc++;
      sc -= Math.hypot(dx, dz) * 0.8 + Math.ceil(k / 2) * 0.05; // lieber nah an der echten Stelle und Richtung
      if (sc > bs) { bs = sc; best = { ax: ux, az: uz, dx, dz }; }
    }
    return best;
  }
  // Funken und Staub, wo die Linien aufeinandertreffen
  clash(x, z) {
    const y = groundY(x, z) + 0.15;
    for (let i = 0; i < 3; i++) this.fx.glow.emit({ x, y, z, vx: (Math.random() - 0.5) * 0.8, vy: 0.3 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.8, life: 0.25 + Math.random() * 0.2, size: 0.015, c: [1, 0.9, 0.6], a: 1, g: -2, drag: 0.92 });
    this.fx.smoke.emit({ x, y: y - 0.1, z, vx: (Math.random() - 0.5) * 0.2, vy: 0.08, life: 1.8, size: 0.12, grow: 1.6, c: [0.72, 0.66, 0.55], a: 0.22 });
  }
  // Gefallene liegen, wo sie gefallen sind (gemerkte Lage, sonst verteilt zwischen den Linien)
  fallenBodies(st, F, near, mx, mz, ax, az, sx, sz, sea) {
    if (!near || sea) return;
    const day = st.day, frac = this.frac;
    for (const q of F.fallen) {
      if (q.d > day || (q.d === day && q.f > frac)) continue;
      let D = this.dead.get(q.id);
      if (!D) {
        const dir = q.side === 1 ? 1 : -1, back = 0.08 + hash(q.id, 1) * 0.5, lat = (hash(q.id, 2) - 0.5) * 1.3;
        D = { F: F.id, x: mx - ax * dir * back + sx * lat, z: mz - az * dir * back + sz * lat, h: hash(q.id, 3) * 6.28, sex: q.sex, clan: q.clan, job: q.job };
        this.dead.set(q.id, D);
      }
      const p = { id: q.id, sex: q.sex, clan: q.clan, job: q.job, lt: '' };
      const Fg = figFor(this.figs, p);
      if (Fg.n >= Fg.max) continue;
      const body = HEIGHT * figureScale(p, false, false);
      this.o.position.set(D.x, groundY(D.x, D.z) + 0.006, D.z); this.o.rotation.set(0, D.h, 0); this.o.scale.setScalar(body); this.o.updateMatrix();
      drawPerson(Fg, p, this.o.matrix, 'sleep', 1, false, false, false, null);
      this.drew = true;
    }
  }

  // Seeschlacht: zwei Reihen Schiffe, Breitseiten (ab Renaissance Kanonenrauch, vorher Pfeile), die Verlierer sinken
  seaFight(st, F, byId, sides, cx, cz, ax, az, over, near) {
    const rise = this.o2.rise || 0, era = Math.max(...F.a.concat(F.b).map(id => (byId.get(id) || { era: 0 }).era | 0), 0);
    const sx = -az, sz = ax;
    for (let k = 0; k < 2; k++) {
      const ids = k ? F.b : F.a, dir = k ? -1 : 1;
      let i = 0;
      for (const id of ids) {
        const A = byId.get(id); if (!A) continue;
        const E = this.cache.get(A.id); if (!E) continue;
        if (over && A.st === 'home') continue; // flieht, drawArmy fährt sie heim
        this.fleet(A, E);
        for (const L2 of E.ships) {
          const lat = (i - 1) * 0.9 * (k ? -1 : 1), x = cx - ax * dir * 0.9 + sx * lat, z = cz - az * dir * 0.9 + sz * lat; i++;
          let M = this.ms.get('s' + A.id + ':' + E.ships.indexOf(L2));
          if (!M) { M = { x, z, yaw: 0, f: 0 }; this.ms.set('s' + A.id + ':' + E.ships.indexOf(L2), M); }
          M.f = this.frame;
          const ddx = x - M.x, ddz = z - M.z, dd = Math.hypot(ddx, ddz);
          if (dd > 0.01 && this.gs > 0) { const step = Math.min(dd, 0.5 * Math.max(1, this.gs) * this.dt); M.x += ddx / dd * step; M.z += ddz / dd * step; }
          const yaw = Math.atan2(-sz, sx); // Breitseite zum Gegner
          M.yaw += wrapPi(yaw - M.yaw) * Math.min(1, this.dt * 1.5);
          this.shipAt(L2, M.x, M.z, M.yaw, rise, A.id + i);
          L2.m.visible = near;
          if (near) this.ships.anim(L2, this.t);
          if (near && !over && Math.random() < this.dt * 0.9) {
            const tx = cx + ax * dir * 0.9 + sx * (Math.random() - 0.5) * 2, tz = cz + az * dir * 0.9 + sz * (Math.random() - 0.5) * 2;
            this.fire(era >= 5 ? 'kanone' : 'bogen', M.x + ax * dir * 0.18, 0.25 + rise, M.z + az * dir * 0.18, tx, 0.1 + rise, tz, era, true);
          }
        }
      }
    }
    // die Verlierer verlieren Schiffe: so viele wie Tote durch sechs, sinken am Schlachtort
    if (over && !this.sink.has(F.id)) {
      const FC = this.fc.get(F.id) || {}, lose = F.win === FC.aSide ? 1 : 0, dead = F.dead[lose];
      const n = Math.min(3, Math.ceil(dead / 6));
      const list = [];
      for (let j = 0; j < n; j++) {
        const dir = lose ? -1 : 1, lat = (j - 1) * 0.9;
        const L2 = this.ships.spawn('krieg', era);
        list.push({ L: L2, x: cx - ax * dir * 0.9 + sx * lat, z: cz - az * dir * 0.9 + sz * lat, yaw: Math.atan2(-sz, sx), t0: this.t + j * 1.5 });
      }
      this.sink.set(F.id, list);
    }
    void sides;
  }
  updateSinking(st, t) {
    const rise = this.o2.rise || 0;
    for (const [id, list] of this.sink) {
      let alive = false;
      for (const S2 of list) {
        const k = clamp((t - S2.t0) / 14);
        if (k >= 1) { if (S2.L.m.parent) this.stage.scene.remove(S2.L.m); continue; }
        alive = true;
        S2.L.m.position.set(S2.x, 0.03 + rise - k * k * 0.9, S2.z);
        S2.L.m.rotation.set(k * 0.9, S2.yaw, k * 0.5);
        S2.L.m.visible = this.near(S2.x, S2.z);
        if (S2.L.m.visible && Math.random() < 0.3) this.fx.smoke.emit({ x: S2.x + (Math.random() - 0.5) * 0.3, y: 0.2 + rise, z: S2.z + (Math.random() - 0.5) * 0.3, vy: 0.25, life: 3, size: 0.14, grow: 2.4, c: [0.3, 0.3, 0.32], a: 0.35 });
        if (S2.L.m.visible && Math.random() < 0.15) this.fx.splash(S2.x, rise, S2.z);
      }
      if (!alive) this.sink.delete(id);
    }
  }

  // ---------- Geschosse ----------
  // kind aus SHOT über die Waffengattung; Pfeile und Steine fliegen im Bogen, Kugeln und Granaten flacher mit Rauch
  fire(u, x0, y0, z0, x1, y1, z1, era, sea) {
    const k = SHOT[u] || u;
    if (this.shots.length > 180) return;
    const d = Math.hypot(x1 - x0, z1 - z0);
    const t = this.t;
    if (k === 'musket' || k === 'rifle') {
      // Musketen und Gewehre: Mündungsrauch und Leuchtspur statt Kugel
      this.fx.smoke.emit({ x: x0, y: y0, z: z0, vx: (x1 - x0) / (d || 1) * 0.15, vy: 0.04, vz: (z1 - z0) / (d || 1) * 0.15, life: k === 'musket' ? 2.4 : 0.8, size: k === 'musket' ? 0.09 : 0.04, grow: 2, c: [0.92, 0.92, 0.9], a: k === 'musket' ? 0.55 : 0.25 });
      this.fx.glow.emit({ x: x0, y: y0, z: z0, life: 0.08, size: 0.03, c: [1, 0.8, 0.4], a: 1 });
      if (k === 'rifle') this.fx.glow.emit({ x: x0, y: y0, z: z0, vx: (x1 - x0) * 4, vy: (y1 - y0) * 4, vz: (z1 - z0) * 4, life: 0.24, size: 0.012, c: [1, 0.9, 0.5], a: 0.9, drag: 1 });
      return;
    }
    const dur = k === 'arrow' ? 0.9 + d * 0.12 : k === 'stone' ? 1.6 + d * 0.1 : k === 'rocket' ? 0.7 + d * 0.05 : 0.6 + d * 0.06;
    const h = k === 'arrow' ? 0.25 + d * 0.12 : k === 'stone' ? 0.5 + d * 0.15 : k === 'rocket' ? 0.15 : 0.1 + d * 0.05;
    this.shots.push({ k, x0, y0, z0, x1, y1, z1, t0: t, dur, h, sea, era });
    if (k === 'ball' || k === 'shell') {
      this.fx.smoke.emit({ x: x0, y: y0, z: z0, vy: 0.1, life: 2.6, size: 0.14, grow: 2.4, c: [0.88, 0.88, 0.86], a: 0.6 });
      this.fx.glow.emit({ x: x0, y: y0, z: z0, life: 0.1, size: 0.08, c: [1, 0.75, 0.35], a: 1 });
    }
  }
  updateShots(st, t, dt) {
    let nA = 0, nB = 0;
    const keep = [];
    for (const S2 of this.shots) {
      const u = (t - S2.t0) / S2.dur;
      if (u >= 1) { this.impact(S2); continue; }
      keep.push(S2);
      if (u < 0) continue;
      const x = S2.x0 + (S2.x1 - S2.x0) * u, z = S2.z0 + (S2.z1 - S2.z0) * u, y = S2.y0 + (S2.y1 - S2.y0) * u + 4 * S2.h * u * (1 - u);
      if (S2.k === 'arrow' && nA < MAXARROW) {
        const vx = S2.x1 - S2.x0, vz = S2.z1 - S2.z0, vy = S2.y1 - S2.y0 + 4 * S2.h * (1 - 2 * u);
        _v.set(vx, vy, vz).normalize(); _q.setFromUnitVectors(_y, _v);
        _m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1)); this.arrow.setMatrixAt(nA++, _m);
      } else if (nB < MAXBALL) {
        const r = S2.k === 'stone' ? 1.7 : S2.k === 'rocket' ? 0.8 : 1;
        _m.compose(_p.set(x, y, z), _q.identity(), _s.set(r, r, r)); this.ball.setMatrixAt(nB, _m);
        this.ball.setColorAt(nB++, _c.set(S2.k === 'stone' ? '#8f8a84' : S2.k === 'rocket' ? '#ffcf6a' : '#2a2a2c'));
        if (S2.k === 'rocket' && Math.random() < 0.8) this.fx.smoke.emit({ x, y, z, vy: 0.05, life: 0.9, size: 0.05, grow: 1.5, c: [0.8, 0.8, 0.8], a: 0.35 });
      }
    }
    this.shots = keep;
    this.stat.shots = keep.length;
    const fin = (m, n) => { m.count = n; m.visible = n > 0; if (n) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; } };
    fin(this.arrow, nA); fin(this.ball, nB);
    void dt;
  }
  impact(S2) {
    const { x1: x, y1: y, z1: z } = S2;
    if (!this.near(x, z)) return;
    if (S2.sea && y < 0.3) { this.fx.splash(x, y - 0.1, z); return; }
    if (S2.k === 'arrow') return;
    const big = S2.k === 'shell' || S2.k === 'rocket' ? 1.4 : S2.k === 'ball' ? 1 : 0.8;
    for (let i = 0; i < 6 * big; i++) this.fx.smoke.emit({ x: x + (Math.random() - 0.5) * 0.15, y: y + 0.03, z: z + (Math.random() - 0.5) * 0.15, vx: (Math.random() - 0.5) * 0.5, vy: 0.2 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.5, life: 1.2 + Math.random(), size: 0.08 * big, grow: 1.4, c: S2.k === 'stone' ? [0.75, 0.7, 0.6] : [0.4, 0.38, 0.36], a: 0.45, drag: 0.93 });
    if (S2.k === 'shell' || S2.k === 'rocket' || S2.k === 'ball') for (let i = 0; i < 6; i++) this.fx.glow.emit({ x, y: y + 0.05, z, vx: (Math.random() - 0.5) * 1.2, vy: 0.4 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 1.2, life: 0.35, size: 0.03, c: [1, 0.6, 0.25], a: 1, g: -3, drag: 0.94 });
  }

  // ---------- Abschluss ----------
  finish(figs) {
    const fin = (m, n) => { m.count = n; m.visible = n > 0; if (n) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; } };
    for (const k in this.veh) fin(this.veh[k], this.n[k]);
    fin(this.rotor, this.nRotor); fin(this.legs, this.nLeg); fin(this.flame, this.nFlame); fin(this.cloth, this.nCloth);
    if (this.drew) for (const F of figs) {
      for (const a of [F.aAnim, F.aSkin, F.aHair, F.aShirt, F.aPants]) a.clearUpdateRanges();
      F.end();
    }
    for (let i = this.nLab; i < this.labels.length; i++) if (this.labels[i]._o !== 0) { this.labels[i]._o = 0; this.labels[i].style.opacity = 0; }
  }

  label(i, title, sub, x, y, z, d2) {
    if (i === 0) this.placed = [];
    if (!this.canvasRect) this.canvasRect = this.stage.renderer.domElement.getBoundingClientRect();
    const rect = this.canvasRect;
    let el = this.labels[i];
    if (!el) {
      el = document.createElement('div');
      el.className = 'rlabel';
      el.style.fontSize = '12.5px'; el.style.textAlign = 'center'; el.style.lineHeight = '1.25';
      el.innerHTML = '<b style="font-weight:600"></b><br><small style="font-size:11px;opacity:0.8"></small>';
      (document.querySelector('#labels') || document.body).append(el);
      this.labels[i] = el;
    }
    if (el._t !== title) { el._t = title; el.firstChild.textContent = title; el._w = 0; }
    if (el._s !== sub) { el._s = sub; el.lastChild.textContent = sub; el._w = 0; }
    if (!el._w) { el._w = el.offsetWidth; el._h = el.offsetHeight; }
    _p.set(x, y, z).project(this.stage.camera);
    const vis = _p.z < 1 && Math.abs(_p.x) < 1.05 && Math.abs(_p.y) < 1.05;
    if (!vis) { if (el._o !== 0) { el._o = 0; el.style.opacity = 0; } return; }
    const sx = (_p.x + 1) / 2 * rect.width;
    let sy = (1 - _p.y) / 2 * rect.height;
    for (let g = 0; g < 4 && this.placed.some(([x2, y2]) => Math.abs(x2 - sx) < 190 && Math.abs(y2 - sy) < 34); g++) sy -= 34;
    this.placed.push([sx, sy]);
    const zf = this.zoneFade ? this.zoneFade(sx - el._w / 2, sy - el._h, sx + el._w / 2, sy) : 1;
    const op = Math.round(clamp((44 - Math.sqrt(d2)) / 8) * zf * 20) / 20 * 0.95;
    if (el._o !== op) { el._o = op; el.style.opacity = op; }
    el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
  }

  reset() {
    for (const E of this.cache.values()) for (const L2 of E.ships) this.stage.scene.remove(L2.m);
    for (const list of this.sink.values()) for (const S2 of list) this.stage.scene.remove(S2.L.m);
    this.cache.clear(); this.ms.clear(); this.dead.clear(); this.camps.clear(); this.sink.clear(); this.fc.clear(); this.shots = [];
    this.lookCache = null;
  }
}
