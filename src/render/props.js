// Requisiten der Unternehmungen (seit 21.10.2026, zu leisure.js): Bänke auf dem Platz, Biertisch mit Bänken vor der
// Taverne, Strandtücher, Picknickdecken, Sonnenschirme, Ball, Lagerfeuer (Steinkreis, Holz, flackernde Flammen). Je Art ein InstancedMesh, jedes Bild neu befüllt
// (begin, add, end), Farben je Instanz. Stil wie die Häuser: weiche Holztöne, pastellige Stoffe.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Sitzhöhe der Bank: so hoch, wie die Sitz-Animationen der Menschen das Gesäß tragen (SEAT_Y mal Körpergröße)
export const BENCH_H = 0.07;
const CLOTH = ['#e8a0a0', '#9cc8e0', '#f2d48a', '#a8d8b0', '#f0b890', '#c8a8e0', '#f4f0e6', '#e07a5f'].map(c => new THREE.Color(c));

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

export class Props {
  constructor(scene) {
    this.scene = scene;
    const wood = new THREE.MeshStandardMaterial({ color: '#b08860', roughness: 0.85 });
    const cloth = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 });
    // Bank für zwei: Sitz, Lehne, vier Beine (Breite 0.22, Sitz vorn in +z)
    const bench = mergeGeometries([box(0.22, 0.012, 0.055, 0, BENCH_H - 0.006, 0), box(0.22, 0.05, 0.01, 0, BENCH_H + 0.03, -0.028),
      box(0.012, BENCH_H, 0.012, -0.095, BENCH_H / 2, 0.02), box(0.012, BENCH_H, 0.012, 0.095, BENCH_H / 2, 0.02),
      box(0.012, BENCH_H + 0.055, 0.012, -0.095, (BENCH_H + 0.055) / 2, -0.026), box(0.012, BENCH_H + 0.055, 0.012, 0.095, (BENCH_H + 0.055) / 2, -0.026)]);
    // Biertisch: Platte und zwei Böcke
    const table = mergeGeometries([box(0.32, 0.012, 0.11, 0, 0.105, 0), box(0.012, 0.1, 0.08, -0.12, 0.05, 0), box(0.012, 0.1, 0.08, 0.12, 0.05, 0)]);
    // flache Stoffe (Größe je Instanz über die Skalierung)
    const flat = new THREE.BoxGeometry(1, 0.006, 1).translate(0, 0.003, 0);
    // Sonnenschirm: Stange und flacher Kegel
    const pole = new THREE.CylinderGeometry(0.006, 0.006, 0.3, 6).translate(0, 0.15, 0);
    const shade = new THREE.ConeGeometry(0.17, 0.06, 10).translate(0, 0.3, 0);
    const ball = new THREE.IcosahedronGeometry(0.022, 1);
    // Lagerfeuer: Steinkreis mit Asche und Holz als Zelt (wie bei den Kundschaftern, nur größer), Flammen extra
    const stones = [new THREE.CylinderGeometry(0.11, 0.12, 0.006, 12).translate(0, 0.003, 0).toNonIndexed()];
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; stones.push(new THREE.IcosahedronGeometry(0.03, 0).scale(1.2, 0.8, 1).translate(Math.cos(a) * 0.13, 0.014, Math.sin(a) * 0.13)); }
    const logs = [];
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2 + 0.4, g = new THREE.CylinderGeometry(0.011, 0.013, 0.13, 5);
      g.rotateZ(0.95); g.rotateY(-a); g.translate(Math.cos(a) * 0.045, 0.045, Math.sin(a) * 0.045); logs.push(g);
    }
    const flame = new THREE.ConeGeometry(0.06, 0.2, 7, 1, true).translate(0, 0.1, 0);
    this.k = {
      bank: this.mesh(bench, wood, 400),
      tisch: this.mesh(table, wood, 120),
      stoff: this.mesh(flat, cloth, 600, true),
      stange: this.mesh(pole, new THREE.MeshStandardMaterial({ color: '#e8e2d6', roughness: 0.6 }), 120),
      schirm: this.mesh(shade, cloth, 120, true),
      ball: this.mesh(ball, new THREE.MeshStandardMaterial({ color: '#f4f0e6', roughness: 0.5 }), 60, true),
      steine: this.mesh(mergeGeometries(stones), new THREE.MeshStandardMaterial({ color: '#8f8a84', roughness: 0.9, flatShading: true }), 40),
      holz: this.mesh(mergeGeometries(logs), new THREE.MeshStandardMaterial({ color: '#6e4b32', roughness: 0.9 }), 40),
      flamme: this.mesh(flame, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }), 80, true),
    };
    this.k.flamme.m.castShadow = false; this.k.flamme.m.renderOrder = 2;
    this.o = new THREE.Object3D();
    this.c = new THREE.Color();
  }

  mesh(g, mat, max, colored = false) {
    const m = new THREE.InstancedMesh(g, mat, max);
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.count = 0;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (colored) m.setColorAt(0, new THREE.Color(1, 1, 1));
    this.scene.add(m);
    return { m, n: 0, max };
  }

  begin() { for (const K of Object.values(this.k)) K.n = 0; }

  put(K, x, y, z, rot, sx = 1, sy = 1, sz = 1, col = null) {
    if (K.n >= K.max) return;
    const o = this.o;
    o.position.set(x, y, z); o.rotation.set(0, rot, 0); o.scale.set(sx, sy, sz); o.updateMatrix();
    K.m.setMatrixAt(K.n, o.matrix);
    if (col) K.m.setColorAt(K.n, col);
    K.n++;
  }

  // t: bank (w Sitze, je zwei eine Bank), tisch, tuch (w, d), decke (w, d, kariert dunkler Rand), schirm, ball
  add(t, x, y, z, rot = 0, w = 1, d = 1, c = 0) {
    const K = this.k;
    if (t === 'bank') {
      const n = Math.max(1, Math.ceil(w / 2));
      for (let k = 0; k < n; k++) { const o = (k - (n - 1) / 2) * 0.23; this.put(K.bank, x + Math.cos(rot) * o, y, z - Math.sin(rot) * o, rot); }
    } else if (t === 'tisch') this.put(K.tisch, x, y, z, rot);
    else if (t === 'tuch') this.put(K.stoff, x, y, z, rot, w, 1, d, CLOTH[Math.floor(c * CLOTH.length) % CLOTH.length]);
    else if (t === 'decke') {
      const col = this.c.copy(CLOTH[Math.floor(c * CLOTH.length) % CLOTH.length]);
      this.put(K.stoff, x, y, z, rot, w, 1, d, col);
      this.put(K.stoff, x, y + 0.002, z, rot, w * 0.82, 1, d * 0.82, this.c.copy(col).lerp(new THREE.Color('#ffffff'), 0.45));
    } else if (t === 'schirm') {
      this.put(K.stange, x, y, z, 0);
      this.put(K.schirm, x, y, z, 0, 1, 1, 1, CLOTH[Math.floor(c * CLOTH.length) % CLOTH.length]);
    } else if (t === 'ball') this.put(K.ball, x, y, z, 0, 1, 1, 1, this.c.set(c > 0.5 ? '#e8e2d6' : '#e07a5f'));
    else if (t === 'feuer') {
      // w: Flackern (um 1), d: Stärke 0 bis 1 (Glut am Ende des Abends)
      this.put(K.steine, x, y, z, rot);
      this.put(K.holz, x, y, z, rot);
      if (d > 0.02) {
        this.put(K.flamme, x, y + 0.01, z, c * 6.28, d * (0.9 + 0.1 * w), d * w, d * (0.9 + 0.1 * w), this.c.setRGB(2.6, 0.95, 0.28));
        this.put(K.flamme, x, y + 0.015, z, c * 6.28 + 1, d * 0.6, d * w * 0.72, d * 0.6, this.c.setRGB(3.0, 2.1, 0.9));
      }
    }
  }

  end() {
    for (const K of Object.values(this.k)) {
      K.m.count = K.n; K.m.instanceMatrix.needsUpdate = true;
      if (K.m.instanceColor) K.m.instanceColor.needsUpdate = true;
    }
  }
}
