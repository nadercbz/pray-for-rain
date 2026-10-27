// Bäume als Formen (seit 27.10.2026 eigenes Modul, vorher in terrain.js): Ballenkronen, Stämme und einfache Formen für
// die Ferne. Inselwelt (terrain.js) und nahtlose Erde (earth3d/earthview.js) nutzen dieselben Bäume.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export function paint(g, top, bottom, cy0, cy1) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3), p = g.attributes.position;
  const ct = new THREE.Color(top), cb = new THREE.Color(bottom), t = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const k = THREE.MathUtils.clamp((p.getY(i) - cy0) / Math.max(0.001, cy1 - cy0), 0, 1);
    t.copy(cb).lerp(ct, k);
    a[i * 3] = t.r; a[i * 3 + 1] = t.g; a[i * 3 + 2] = t.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

// Kugelige Normalen für die Krone: weiches, flauschiges Licht
export function softNormals(g, center, k = 0.8) {
  const p = g.attributes.position, nr = g.attributes.normal, v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i)).sub(center).normalize();
    n.set(nr.getX(i), nr.getY(i), nr.getZ(i)).lerp(v, k).normalize();
    nr.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

export const clean = g => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; };

// Krone (seit 24.10.2026 runder, PLAN_GRAFIK.md, nach dem Mittelmeerdorf der Vorbilder): ein Kern und 9 bis 11 Ballen
// auf einer Schale verteilt, glatte Kugeln statt facettierter Ikosaeder, jeder Ballen im Ton etwas anders (Klumpen
// sichtbar), Normalen weich zur Mitte. Rund 1400 Dreiecke, fern bleibt die einfache Form (lowCrown)
// lite (Erde, viele Bäume auf einmal): gleiche Form mit weniger Segmenten, rund 40 Prozent weniger Dreiecke
export function crown(seed, kind, lite = false) {
  const r = i => hash(seed * 31 + i, seed);
  const parts = [], tone = [];
  const center = new THREE.Vector3(0, 0.95, 0);
  if (kind === 'pine') {
    for (let i = 0; i < 4; i++) {
      const rad = 0.36 - i * 0.07, y = 0.45 + i * 0.27;
      parts.push(new THREE.ConeGeometry(rad, 0.48, lite ? 8 : 12, lite ? 1 : 2).translate(0, y + 0.24, 0)); tone.push(1 - i * 0.02);
    }
  } else {
    const bush = kind === 'bush', s = bush ? 0.6 : 1, cy = bush ? 0.24 : 0.98;
    parts.push(new THREE.SphereGeometry(0.34 * s, lite ? 10 : 14, lite ? 7 : 10).scale(1, 0.92, 1).translate(0, cy, 0)); tone.push(1);
    const n = 9 + Math.floor(r(0) * 3);
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + r(i + 1) * 0.7, e = (r(i + 2) - 0.32) * 1.25, d = (0.25 + r(i + 3) * 0.08) * s;
      const rad = (0.16 + r(i + 4) * 0.08) * s;
      parts.push(new THREE.SphereGeometry(rad, lite ? 7 : 10, lite ? 5 : 7).translate(Math.cos(a) * Math.cos(e) * d, cy + Math.sin(e) * d * 0.9, Math.sin(a) * Math.cos(e) * d));
      tone.push(0.9 + r(i + 5) * 0.2);
    }
    center.set(0, cy, 0);
  }
  const cl = parts.map(clean);
  const g = mergeGeometries(cl);
  softNormals(g, center, kind === 'pine' ? 0.55 : 0.72);
  paint(g, '#ffffff', '#9a9a9a', center.y - 0.4, center.y + 0.35);
  // Ballen im Ton leicht verschieden
  const col = g.attributes.color;
  let o = 0;
  cl.forEach((p, i) => { const n = p.attributes.position.count; for (let j = o; j < o + n; j++) col.setXYZ(j, col.getX(j) * tone[i], col.getY(j) * tone[i], col.getZ(j) * tone[i]); o += n; });
  return g;
}

export function trunk(kind) {
  const parts = [];
  const h = kind === 'pine' ? 0.6 : 0.85;
  parts.push(new THREE.CylinderGeometry(0.04, 0.075, h, 8).translate(0, h / 2, 0));
  if (kind !== 'pine') {
    parts.push(new THREE.CylinderGeometry(0.02, 0.035, 0.38, 5).rotateZ(0.7).translate(0.12, 0.62, 0));
    parts.push(new THREE.CylinderGeometry(0.02, 0.03, 0.3, 5).rotateZ(-0.8).rotateY(1.2).translate(-0.06, 0.66, 0.08));
  }
  return paint(mergeGeometries(parts.map(clean)), '#7a5a40', '#5e4430', 0, 1);
}

// Einfache Formen für die Ferne (gleiche Umrisse, ein Zehntel der Dreiecke)
export function lowCrown(kind) {
  let g;
  if (kind === 'pine') g = mergeGeometries([new THREE.ConeGeometry(0.36, 0.75, 6).translate(0, 0.83, 0), new THREE.ConeGeometry(0.25, 0.6, 6).translate(0, 1.25, 0)].map(clean));
  else if (kind === 'bush') g = clean(new THREE.IcosahedronGeometry(0.3, 0).scale(1, 0.75, 1).translate(0, 0.24, 0));
  else if (kind === 'acacia') g = clean(new THREE.IcosahedronGeometry(0.4, 0).scale(1.5, 0.3, 1.3).translate(0, 1.08, 0));
  else if (kind === 'jungle') g = clean(new THREE.IcosahedronGeometry(0.62, 0).scale(1, 0.7, 1).translate(0, 1.55, 0));
  else if (kind === 'palm') g = mergeGeometries([0, 1, 2].map(i => new THREE.ConeGeometry(0.09, 0.6, 3).rotateZ(Math.PI / 2 + 0.5).translate(0.28, 0.88, 0).rotateY(i * Math.PI * 2 / 3)).map(clean));
  else if (kind === 'cactus') g = clean(new THREE.CylinderGeometry(0.075, 0.085, 0.86, 5).translate(0, 0.43, 0));
  else g = clean(new THREE.IcosahedronGeometry(0.46, 0).translate(0, 1.0, 0));
  g.computeVertexNormals();
  softNormals(g, new THREE.Vector3(0, kind === 'bush' ? 0.22 : 1, 0), 0.7);
  return paint(g, '#ffffff', '#9a9a9a', kind === 'bush' ? 0 : 0.6, kind === 'bush' ? 0.4 : 1.35);
}
export const lowTrunk = h => paint(clean(new THREE.CylinderGeometry(0.04, 0.07, h, 4).translate(0, h / 2, 0)), '#7a5a40', '#5e4430', 0, 1);
