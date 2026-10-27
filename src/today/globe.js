// Erde heute: der Globus mit allen Ländern und Städten. Grenzen als feine Linien auf dem Gelände, Länder in ihrer
// Farbe (über die Gebietsfärbung des Geländes), jede Stadt als Häusergruppe nach ihrer Größe (Megastädte als Skyline),
// nachts Lichter in Fenstern und ein Lichtpunkt je Stadt, der auch aus großer Höhe zu sehen ist (Erde bei Nacht).
import * as THREE from 'three';
import { NX, NY, wx, wz } from '../render/scene.js';
import { groundY } from '../render/terrain.js';
import { TODAY } from './data.js';

const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const POOL = 42000;

export class Globe {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.uNight = { value: 0 };
    // Häuser der Städte: ein Würfel je Haus (unten bei 0), Farbe je Haus, Fenster nachts aus dem Shader
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    mat.onBeforeCompile = sh => {
      sh.uniforms.uNight = this.uNight;
      sh.vertexShader = 'varying vec3 vLP; varying float vH;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vLP = position; vH = instanceMatrix[1][1];`);
      sh.fragmentShader = 'uniform float uNight; varying vec3 vLP; varying float vH;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { float fl = floor(vLP.y * vH * 14.0), side = step(vLP.y, 0.995);
          float h = fract(sin(dot(vec3(fl, floor(vLP.x * 5.0 + vLP.z * 7.0), vH * 13.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float win = side * step(0.35, fract(vLP.y * vH * 14.0)) * step(h, 0.38);
          totalEmissiveRadiance += vec3(1.0, 0.8, 0.5) * win * uNight * 0.55; }`);
    };
    this.houses = new THREE.InstancedMesh(box, mat, POOL);
    this.houses.count = 0;
    this.houses.castShadow = true; this.houses.receiveShadow = true;
    this.houses.frustumCulled = false;
    this.group.add(this.houses);
    this.at = null; this.dist = -1;
  }

  // Grenzen: Kanten zwischen Feldern verschiedener Länder (beide Land), als Linien knapp über dem Boden
  buildBorders() {
    const C = TODAY.ctry, pts = [];
    const Y = (x, z) => Math.max(0, groundY(x, z)) + 0.18;
    for (let y = 0; y < NY - 1; y++) for (let x = 0; x < NX; x++) {
      const i = y * NX + x, a = C[i];
      if (!a) continue;
      const r = C[y * NX + ((x + 1) % NX)], d = C[i + NX];
      if (r && r !== a && x < NX - 1) { const X = x + 1 - NX / 2, Z0 = y - NY / 2, Z1 = Z0 + 1; pts.push(X, Y(X, Z0), Z0, X, Y(X, Z1), Z1); }
      if (d && d !== a) { const Zb = y + 1 - NY / 2, X0 = x - NX / 2, X1 = X0 + 1; pts.push(X0, Y(X0, Zb), Zb, X1, Y(X1, Zb), Zb); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    if (this.borders) { this.group.remove(this.borders); this.borders.geometry.dispose(); }
    this.borders = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xfff4dc, transparent: true, opacity: 0.55, depthWrite: false }));
    this.borders.renderOrder = 2;
    this.group.add(this.borders);
  }

  // Lichtpunkte aller Städte ab 30.000 Einwohnern (nachts sichtbar, auch von weit oben)
  buildLights() {
    const C = TODAY.cities, pts = [], col = [];
    for (let i = 0; i < C.n; i++) {
      const p = Math.max(C.pop[i], C.metro[i] || 0);
      if (p < 30000) break;
      const X = wx(C.tx[i]), Z = wz(C.ty[i]);
      pts.push(X, Math.max(0, groundY(X, Z)) + 0.6, Z);
      const k = Math.min(1, Math.log10(p / 30000) / 3);
      col.push(1, 0.78 + k * 0.15, 0.45 + k * 0.3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.lights = new THREE.Points(g, new THREE.PointsMaterial({ size: 3.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.lights.frustumCulled = false;
    this.group.add(this.lights);
  }

  // Länderfarben für die Gebietsfärbung des Geländes
  colors() {
    const out = {};
    for (const c of TODAY.list) out[c.id] = new THREE.Color(c.color || '#cccccc');
    return out;
  }

  // Häusergruppen um den Blick: je näher, desto kleinere Orte; große Städte immer
  update(target, dist, night, damage) {
    this.uNight.value = night;
    if (this.lights) this.lights.material.opacity = Math.min(0.95, night * 1.2) * (dist > 60 ? 1 : dist / 60);
    const moved = !this.at || Math.hypot(target.x - this.at.x, target.z - this.at.z) > Math.max(6, dist * 0.08) || Math.abs(dist - this.dist) > this.dist * 0.25;
    if (!moved && !this.dirty) return;
    this.dirty = false;
    this.at = target.clone(); this.dist = dist;
    const C = TODAY.cities, R = Math.min(700, Math.max(24, dist * 1.4));
    const minPop = dist > 700 ? 2e6 : dist > 350 ? 4e5 : dist > 160 ? 8e4 : dist > 70 ? 2e4 : 2500;
    const tx = target.x + NX / 2, ty = target.z + NY / 2;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    let n = 0;
    const PAL = ['#efe4cf', '#e7d5b9', '#f2ede2', '#e9b9a3', '#d9c7a8', '#c9d3d6', '#f0dcc0', '#dcd3c6'];
    for (let i = 0; i < C.n && n < POOL - 10; i++) {
      const pop = Math.max(C.pop[i], C.metro[i] || 0);
      if (pop < minPop) break;
      const dx = ((C.tx[i] - tx + NX * 1.5) % NX) - NX / 2, dy = C.ty[i] - ty;
      if (dx * dx + dy * dy > R * R) continue;
      const dmg = damage ? damage(i) : 0;
      const rad = 0.3 + Math.sqrt(pop) / 2400, houses = Math.min(520, Math.round(6 + Math.log2(pop / 2000) * (pop > 1e6 ? 38 : 12)));
      const tall = Math.min(2.6, 0.25 + Math.log10(pop / 1000) * (pop > 3e6 ? 0.5 : 0.2));
      const cx = C.tx[i] + 0.5, cy = C.ty[i] + 0.5;
      for (let k = 0; k < houses && n < POOL; k++) {
        const a = hash(i, k * 3) * Math.PI * 2, rr = Math.pow(hash(i, k * 3 + 1), 0.75) * rad;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        const t = TODAY.ctry[(Math.floor(y) * NX + ((Math.floor(x) % NX) + NX) % NX)] || 0;
        if (!t) continue;
        if (dmg && hash(i, k * 7) < dmg * 0.6) continue;
        const X = x - NX / 2, Z = y - NY / 2, G = groundY(X, Z);
        if (G < 0.02) continue;
        const core = 1 - rr / rad, hh = (0.12 + tall * Math.pow(core, 2.2) * (0.4 + hash(i, k * 3 + 2) * 0.9)) * (pop > 5e5 ? 1 : 0.7);
        const w = 0.12 + hash(i, k * 5) * 0.12 + (hh > 0.8 ? 0.06 : 0);
        p.set(X, G - 0.02, Z); s.set(w, hh, w * (0.7 + hash(i, k * 9) * 0.6));
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, hash(i, 11) * Math.PI);
        m.compose(p, q, s);
        this.houses.setMatrixAt(n, m);
        col.set(hh > 1.1 ? '#a9bccb' : PAL[(i + k) % PAL.length]);
        this.houses.setColorAt(n, col);
        n++;
      }
    }
    this.houses.count = n;
    this.houses.instanceMatrix.needsUpdate = true;
    if (this.houses.instanceColor) this.houses.instanceColor.needsUpdate = true;
  }

  // nächste Stadt zu einem Punkt (Feld), gewichtet nach Größe
  cityAt(x, y, r = 3) {
    const C = TODAY.cities;
    let best = -1, bs = -1e9;
    for (let gy = (y - r) >> 3; gy <= (y + r) >> 3; gy++) for (let gx = (x - r) >> 3; gx <= (x + r) >> 3; gx++) {
      const a = C.grid.get(gy * 256 + ((gx + 256) % 256)); if (!a) continue;
      for (const i of a) { const d = Math.hypot(C.tx[i] + 0.5 - x, C.ty[i] + 0.5 - y); if (d > r + Math.sqrt(C.pop[i]) / 2600) continue; const s = Math.log10(Math.max(C.pop[i], 1000)) - d * 0.8; if (s > bs) { bs = s; best = i; } }
    }
    return best;
  }
}
