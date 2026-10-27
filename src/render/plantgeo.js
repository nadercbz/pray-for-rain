// Pflanzen und Stadtmöbel als Formen (seit 27.10.2026 eigenes Modul): Grasbüschel, Lupine und Margerite der Inselwelt
// (vorher in terrain.js, dort weiter genutzt), dazu Laterne und Bank im selben Stil für die nahtlose Erde. Maße wie im
// Spiel (1 Einheit rund 10 m, ein Mensch 0,18 hoch).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint, clean } from './treegeo.js';

// Büschel aus 8 schmalen, leicht gebogenen Halmen: dunkler Fuß im Bodenton, helle Spitze
export function tuftGeo() {
  const blades = [];
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + (i % 3) * 0.4, r = 0.02 + (i % 3) * 0.028, h = 0.075 + (i % 4) * 0.026 + (i % 2) * 0.012;
    const g = new THREE.BufferGeometry();
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r, w = 0.024;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    const lean = 1.9 + (i % 3) * 0.35;
    g.setAttribute('position', new THREE.Float32BufferAttribute([bx - px, 0, bz - pz, bx + px, 0, bz + pz, bx * lean, h, bz * lean], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute([0.74, 0.8, 0.7, 0.74, 0.8, 0.7, 1.2, 1.18, 1.0], 3));
    blades.push(g);
  }
  return mergeGeometries(blades);
}

// Lupine: Stiel mit einer Traube kleiner Blütenkugeln statt eines spitzen Kegels
export function lupineGeo() {
  return paint(mergeGeometries([
    new THREE.CylinderGeometry(0.006, 0.008, 0.12, 3).translate(0, 0.06, 0),
    ...[0, 1, 2, 3, 4].map(i => new THREE.IcosahedronGeometry(0.026 - i * 0.004, 0).translate((i % 2 ? 0.006 : -0.006), 0.13 + i * 0.033, 0)),
  ].map(clean)), '#ffffff', '#5f8a45', 0.1, 0.13);
}
export function daisyGeo() {
  return paint(mergeGeometries([
    new THREE.CylinderGeometry(0.005, 0.006, 0.1, 3).translate(0, 0.05, 0),
    new THREE.IcosahedronGeometry(0.03, 0).scale(1, 0.5, 1).translate(0, 0.11, 0),
  ].map(clean)), '#ffffff', '#5f8a45', 0.08, 0.1);
}

const tint = (g, c) => {
  g = clean(g);
  const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.toArray(a, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
};

// Laterne: Sockel, schlanker dunkelgrüner Mast mit Ringen, Kopf mit vier Streben und Dach; das Glas ist eine eigene Form
// (laternGlassGeo), damit es nachts leuchten kann. Höhe rund 4,5 m
export function lanternGeo() {
  const C = '#2f3a34', parts = [
    tint(new THREE.CylinderGeometry(0.03, 0.036, 0.05, 10).translate(0, 0.025, 0), C),
    tint(new THREE.CylinderGeometry(0.011, 0.016, 0.4, 8).translate(0, 0.25, 0), C),
    tint(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 10).translate(0, 0.08, 0), C),
    tint(new THREE.CylinderGeometry(0.017, 0.017, 0.01, 10).translate(0, 0.42, 0), C),
    tint(new THREE.CylinderGeometry(0.03, 0.022, 0.012, 4).rotateY(Math.PI / 4).translate(0, 0.45, 0), C),
    tint(new THREE.ConeGeometry(0.046, 0.034, 4).rotateY(Math.PI / 4).translate(0, 0.523, 0), C),
    tint(new THREE.SphereGeometry(0.008, 6, 4).translate(0, 0.545, 0), C),
  ];
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; parts.push(tint(new THREE.BoxGeometry(0.004, 0.06, 0.004).translate(Math.cos(a) * 0.027, 0.485, Math.sin(a) * 0.027), C)); }
  return mergeGeometries(parts);
}
export function lanternGlassGeo() {
  return tint(new THREE.CylinderGeometry(0.03, 0.022, 0.058, 4, 1).rotateY(Math.PI / 4).translate(0, 0.485, 0), '#fff2c8');
}

// Parkbank wie die Bank der Inselwelt (props.js): Sitz und Lehne aus Holz, Füße aus dunklem Guss. Sitz vorn in +z
export function benchGeo() {
  const H = 0.045, W = '#b08860', I = '#3a3d40', box = (w, h, d, x, y, z, c) => tint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);
  const parts = [box(0.2, 0.008, 0.05, 0, H, 0, W), box(0.2, 0.03, 0.006, 0, H + 0.03, -0.024, W)];
  for (const x of [-0.085, 0.085]) { parts.push(box(0.01, H, 0.044, x, H / 2, 0, I)); parts.push(box(0.01, 0.045, 0.008, x, H + 0.022, -0.026, I)); }
  return mergeGeometries(parts);
}
