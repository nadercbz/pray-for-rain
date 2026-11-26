// Gemeinsame weiche Formen (seit 24.10.2026, PLAN_GRAFIK.md): Kästen mit runden Kanten und gerundete Profile für den
// Ton und Spielzeug Look der Vorbilder. Genutzt von buildings.js (Häuser, Läden) und vehicles.js (Karosserien).
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Kasten mit runden Kanten, Mitte im Ursprung. Nach RoundedBoxGeometry aus three.js: Würfel mit 2 seg + 1 Teilen je
// Kante, jeder Punkt an die Ecke der inneren Box gezogen und mit Radius r nach außen geschoben, die Normalen laufen weich
// um die Kante (Glanzkante im Licht)
export function roundBox(w, h, d, r = 0.02, seg = 1) {
  r = Math.min(r, w * 0.45, h * 0.45, d * 0.45);
  const n = seg * 2 + 1, half = 0.5 / n;
  const g = new THREE.BoxGeometry(1, 1, 1, n, n, n), p = g.attributes.position.array, nr = g.attributes.normal.array;
  const bx = w / 2 - r, by = h / 2 - r, bz = d / 2 - r, v = new THREE.Vector3();
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    v.set(x - Math.sign(x) * half, y - Math.sign(y) * half, z - Math.sign(z) * half).normalize();
    p[i] = bx * Math.sign(x) + v.x * r; p[i + 1] = by * Math.sign(y) + v.y * r; p[i + 2] = bz * Math.sign(z) + v.z * r;
    nr[i] = v.x; nr[i + 1] = v.y; nr[i + 2] = v.z;
  }
  g.deleteAttribute('uv');
  return g;
}

// Seitenprofil (Punkte x, y in der Ebene) über die Breite d entlang z ausgezogen, mit runder Fase r und weichen
// Normalen. Mitte in z bei 0. Für Karosserien, Kabinen, Kotflügel.
export function profile(pts, d, r = 0.012, segs = 3) {
  const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.001, d - 2 * r), bevelEnabled: r > 0, bevelThickness: r, bevelSize: r, bevelOffset: -r * 0.6, bevelSegments: segs, curveSegments: 6 });
  g.translate(0, 0, -(d - 2 * r) / 2);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  const m = mergeVertices(g, 1e-5);
  m.computeVertexNormals();
  return m;
}
