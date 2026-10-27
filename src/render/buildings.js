// Gebäude im Stil von Tiny Glade: Putz in Pastell, Ecksteine, Schindeldächer in Reihen,
// Gauben, Rundtürme mit Spitzdach, Bogentüren, Fenster mit Blumenkästen, Laternen.
// Jede Epoche hat ihre eigene Bauweise. Fenster und Laternen leuchten nachts, Schnee legt sich aufs Dach.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NX, NY } from './scene.js';
import { streetPlan } from '../sim/streets.js';
import { groundY, HTEX, NVX, NVY, RES } from './terrain.js';
import { patch } from './mats.js';
import { roundBox } from './shapes.js';

const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const C = h => new THREE.Color(h);

const PLASTER = ['#eaa48d', '#f0dcb8', '#e8c27f', '#c3cfa8', '#bdd0dd', '#f3cbb9', '#efe5d1', '#e6b8a8'];
const SLATE = [['#808ea3', '#6f7d92', '#8e9aad'], ['#7a8796', '#68758a', '#8995a6']];
const TERRA = [['#cc6d4e', '#b95f45', '#d77d5a'], ['#c46a52', '#ad5a44', '#d0805f']];
const THATCH = [['#dcb86c', '#cba45c', '#e5c680'], ['#d2ad62', '#c09a54', '#dfbe76']];
const MOSSR = ['#7f9a78', '#6d8a68', '#93ab86'], PLUM = ['#9a6a6e', '#875b60', '#a87a7b'];
// Dachmischung wie in einem gewachsenen Dorf: meist Terrakotta, dazu Schiefer, Moos und Pflaume
const ROOF_MIX = [TERRA[0], SLATE[0], TERRA[1], MOSSR, TERRA[0], PLUM, SLATE[1]];
const MOSSY = ['#7f8f63', '#8b9a6c'];
const STONE = ['#dccdb1', '#cfc0a4', '#e4d7bf'];
const WOOD = '#7b5a3e', WOOD2 = '#9b7450', DARK = '#4e3a2c';
const FLOWERS = ['#e0679a', '#f2c14e', '#ee7f5a', '#b98be0', '#ffffff'];
// Detail je Haus (seit 19.10.2026, Paket 5): Fensterläden, Türfarben, Rinnen aus Zink oder Kupfer
const SHUTTER = ['#5f8f8a', '#7a9cc0', '#9fbf86', '#c96e5a', '#e2d2a8', '#4e6a5a', '#8a6a9a', '#3e5a6a'];
const DOORS = ['#6e4a32', '#3e5a6a', '#7a2e2a', '#5b4a6e', '#2f4b66', '#4e6a3e', '#8a5a3a'];
// Kasten mit runden Kanten wie aus Ton (seit 24.10.2026, PLAN_GRAFIK.md, vorher eine einfache Fase), Boden auf 0
function chamferBox(w, h, d, e = 0.024) { return roundBox(w, h, d, e).translate(0, h / 2, 0); }
// Farbe leicht heller oder dunkler (für Ziegel, Schindeln, Steine mit Farbspiel)
const jit = (hex, f) => '#' + C(hex).multiplyScalar(f).getHexString();

// ---------- Baukasten ----------
class Kit {
  constructor(seed = 1) { this.solid = []; this.win = []; this.glow = []; this.smoke = []; this.rotor = null; this.beam = null; this.seed = seed; this.n = 0; this.L = 0; this.houseDetail = false; this.blocks = []; }
  rnd() { return hash(this.seed * 97 + this.n++, this.seed); }
  // Kleinteile (seit 19.10.2026): in der Zwischenstufe (lo, ab rund 40 Abstand) fehlen sie, sonst merkt sich das Haus,
  // dass es eine einfachere Form gibt (hasFine)
  fine() { if (this.lo) return false; this.hasFine = true; return true; }
  // Detailwahl je Haus, fest aus dem Samen: Läden (oder keine), Türfarbe, Rinnenfarbe, zwei Schornsteintöpfe
  det() {
    if (this._det) return this._det;
    const r = hash(this.seed * 31 + 7, this.seed), r2 = hash(this.seed * 17 + 3, this.seed + 5), r3 = hash(this.seed, 77);
    this._det = { shut: this.houseDetail && this.L >= 2 && this.L <= 6 && r < 0.55 ? SHUTTER[Math.floor(r2 * SHUTTER.length)] : null, door: DOORS[Math.floor(r3 * DOORS.length)], gut: r2 < 0.25 ? '#b8774a' : '#8d949a', pots: r3 < 0.5 ? 2 : 1 };
    return this._det;
  }
  add(g, color, bucket) {
    bucket = bucket || 'solid';
    g = g.index ? g.toNonIndexed() : g;
    if (g.attributes.uv) g.deleteAttribute('uv');
    const c = C(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    this[bucket].push(g);
    return g;
  }
  box(w, h, d, x, y, z, c, b, ry = 0) {
    const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y + h / 2, z);
    // große ungedrehte Kästen sind Baukörper: ihre kahlen Seiten bekommen Fenster (dress)
    if (!b && !ry && w >= 0.24 && d >= 0.2 && h >= 0.2 && y >= -0.05) this.blocks.push({ w, h, d, y0: y, ox: x, oz: z });
    return this.add(g, c, b);
  }
  cyl(rt, rb, h, seg, x, y, z, c, b) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y + h / 2, z), c, b); }
  cone(r, h, seg, x, y, z, c, b, ry = 0) { const g = new THREE.ConeGeometry(r, h, seg); if (ry) g.rotateY(ry); return this.add(g.translate(x, y + h / 2, z), c, b); }
  ball(r, x, y, z, c, b, det = 1) { return this.add(new THREE.IcosahedronGeometry(r, det).translate(x, y, z), c, b); }
  dome(r, x, y, z, c, b) { return this.add(new THREE.SphereGeometry(r, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, y, z), c, b); }

  // Steinsockel, reicht in den Boden, damit nichts am Hang schwebt
  plinth(w, d, c = STONE[1], x = 0, z = 0) { this.box(w + 0.06, 0.34, d + 0.06, x, -0.28, z, c); }

  // Wand mit Ecksteinen
  walls(w, h, d, y0, color, quoin = STONE[0], ox = 0, oz = 0) {
    this.add(chamferBox(w, h, d).translate(ox, y0, oz), color);
    this.blocks.push({ w, h, d, y0, ox, oz });
    // Sockelstreifen am Fuß der Wand
    if (y0 <= 0.07) this.box(w + 0.018, 0.045, d + 0.018, ox, y0 - 0.004, oz, STONE[1]);
    // Gesims unter der Traufe und Geschossbänder (seit 24.10.2026): gliedern die Fassade wie bei echten Stadthäusern
    if (this.L >= 3 && h > 0.25 && this.fine()) {
      const lite = jit(color, 1.08);
      this.add(roundBox(w + 0.03, 0.03, d + 0.03, 0.01).translate(ox, y0 + h - 0.012, oz), lite);
      for (let yy = y0 + 0.27; yy < y0 + h - 0.15; yy += 0.27) this.add(roundBox(w + 0.016, 0.016, d + 0.016, 0.006).translate(ox, yy, oz), lite);
    }
    if (!quoin) return;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      let y = y0, k = 0;
      while (y < y0 + h - 0.02) {
        const hh = Math.min(0.075, y0 + h - y);
        const long = k % 2 === 0;
        this.box(long ? 0.09 : 0.05, hh - 0.008, long ? 0.05 : 0.09, ox + sx * (w / 2 - (long ? 0.03 : 0.012)), y, oz + sz * (d / 2 - (long ? 0.012 : 0.03)), STONE[k % 3]);
        y += hh; k++;
      }
    }
  }

  // Fachwerk-Balken
  beams(w, h, d, y0, ox = 0, oz = 0) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.box(0.035, h, 0.035, ox + sx * (w / 2 - 0.005), y0, oz + sz * (d / 2 - 0.005), WOOD);
    this.box(w + 0.01, 0.03, d + 0.01, ox, y0 + h - 0.03, oz, WOOD);
    this.box(w + 0.01, 0.03, d + 0.01, ox, y0 + h * 0.5, oz, WOOD);
  }

  // Satteldach aus Schindelreihen, First entlang x
  roof(w, d, h, y0, cols, { rows = 5, over = 0.07, gable = null, ry = 0, moss = 0.15, x: ox = 0, z: oz = 0 } = {}) {
    const parts = [];
    const halfD = d / 2 + over;
    const slope = Math.hypot(halfD, h), ang = Math.atan2(h, halfD);
    const thatch0 = THATCH.includes(cols);
    // Nah (seit 24.10.2026, PLAN_GRAFIK.md): Mönch und Nonne Ziegel aus Terrakotta, Schindeln versetzt verlegt, Stroh in
    // dicken runden Lagen, Moos als Polster statt ganzer grüner Reihen. Fern bleiben es glatte Reihen.
    const tiles = rows >= 3 && w > 0.18 && this.fine();
    const mossR = [];
    for (let side = 1, k = 0; k < 2; k++, side = -1) for (let i = 0; i < rows; i++) mossR.push(this.rnd() < moss);
    if (tiles) this.tiles(w + over * 2, h, y0, halfD, slope, ang, rows, cols, thatch0, moss, mossR, parts);
    else for (const side of [1, -1]) for (let i = 0; i < rows; i++) {
      const mid = (i + 0.5) / rows;
      const g = new THREE.BoxGeometry(w + over * 2, 0.04, slope / rows * 1.22);
      g.rotateX(side * ang);
      g.translate(0, y0 + h * mid + 0.012, side * halfD * (1 - mid));
      // ohne grüne Moosstreifen (seit 24.10.2026), nur die Farben des Dachs
      parts.push([g, cols[(i + (side > 0 ? 0 : 1)) % cols.length]]);
    }
    parts.push([new THREE.BoxGeometry(w + over * 2 + 0.02, 0.05, 0.08).translate(0, y0 + h + 0.02, 0), cols[1]]);
    const thatch = THATCH.includes(cols);
    if (!thatch && rows >= 2) {
      // Firstziegel: kleine Rundziegel auf dem First
      const L = w + over * 2, n = Math.max(3, Math.round(L / 0.075));
      for (let i = 0; i < n; i++) parts.push([new THREE.CylinderGeometry(0.03, 0.03, L / n * 0.9, 6, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(-L / 2 + (i + 0.5) * L / n, y0 + h + 0.042, 0), cols[(i % 2) + 1] || cols[1]]);
    }
    if (!thatch && rows >= 4 && w > 0.2) {
      // Dachrinnen an beiden Traufen, Fallrohre an zwei Ecken bis zum Boden
      const gc = this.det().gut, L = w + over * 2;
      for (const side of [1, -1]) {
        parts.push([new THREE.BoxGeometry(L, 0.022, 0.028).translate(0, y0 - 0.006, side * (halfD + 0.006)), gc]);
        const px = side * (w / 2 - 0.035), pz = side * (d / 2 + 0.014);
        parts.push([new THREE.CylinderGeometry(0.01, 0.01, Math.max(0.05, y0 - 0.06), 5).translate(px, 0.06 + Math.max(0.05, y0 - 0.06) / 2, pz), gc]);
        parts.push([new THREE.BoxGeometry(0.018, 0.018, halfD - d / 2).translate(px, y0 - 0.006, side * (d / 2 + (halfD - d / 2) / 2)), gc]);
      }
    }
    if (gable) {
      const tri = new THREE.BufferGeometry(), v = [];
      for (const sx of [-1, 1]) {
        const x = sx * w / 2;
        v.push(x, y0, -d / 2, x, y0, d / 2, x, y0 + h, 0, x, y0, d / 2, x, y0, -d / 2, x, y0 + h, 0);
      }
      tri.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      tri.computeVertexNormals();
      parts.push([tri, gable]);
    }
    for (const [g, c] of parts) { if (ry) g.rotateY(ry); if (ox || oz) g.translate(ox, 0, oz); this.add(g, c); }
  }

  // Ziegel einer Dachseite nach der anderen. Jedes Teil wird in der Ebene der Dachfläche gebaut (x entlang der Traufe,
  // y nach oben, z hangabwärts) und wie die alten Reihen gekippt und abgelegt. Zufall nur aus dem Samen (hash), damit die
  // ferne Fassung (ohne Ziegel) dieselben Fenster, Blumen und Farben behält.
  tiles(W, h, y0, halfD, slope, ang, rows, cols, thatch, moss, mossR, parts) {
    const terra = TERRA.includes(cols) || cols === ROOF_MIX[0] || cols === ROOF_MIX[2];
    const seed = this.seed;
    const put = (g, side, m, lift, col) => {
      if (side < 0) g.rotateY(Math.PI);
      g.translate(0, lift, 0); g.rotateX(side * ang);
      g.translate(0, y0 + h * m, side * halfD * (1 - m));
      parts.push([g, col]);
    };
    for (const side of [1, -1]) {
      const sb = side > 0 ? 0 : rows;
      // Unterlage: dunkle Fläche unter den Ziegeln (Nonnen, Lattung), damit keine Lücken durchscheinen
      put(new THREE.BoxGeometry(W, 0.022, slope * 1.02), side, 0.5, 0.0, jit(cols[1], thatch ? 0.8 : 0.72));
      if (thatch) {
        // Stroh: dicke Lagen mit runder Unterkante, jede Lage etwas anders im Ton
        for (let i = 0; i < rows; i++) {
          const m = (i + 0.5) / rows, L = slope / rows * 1.25, f = 0.93 + hash(seed * 7 + i, side + 9) * 0.14;
          const col = mossR[sb + i] ? MOSSY[i % 2] : jit(cols[i % cols.length], f);
          put(new THREE.BoxGeometry(W, 0.05, L), side, m, 0.03, col);
          put(new THREE.CylinderGeometry(0.03, 0.03, W, 7).rotateZ(Math.PI / 2).translate(0, 0.022, L / 2 - 0.02), side, m, 0.03, jit(col, 0.94));
        }
        continue;
      }
      if (terra) {
        // Mönch und Nonne: Halbschalen in Spalten den Hang hinab, jede Schale oben schmaler, so sieht man jede Lage
        const nx = Math.max(4, Math.round(W / 0.052)), pw = W / nx, r = pw * 0.44;
        const nc = Math.max(3, Math.round(slope / 0.075)), L = slope / nc;
        for (let j = 0; j < nx; j++) for (let i = 0; i < nc; i++) {
          const m = (i + 0.5) / nc, x = -W / 2 + (j + 0.5) * pw, hv = hash(seed * 131 + j * 17 + i * 3, side + 5);
          const col = jit(cols[(j + i * 2) % cols.length], 0.9 + hv * 0.2);
          const g = new THREE.CylinderGeometry(r * 0.84, r, L * 1.12, 6, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).translate(x, 0, 0);
          put(g, side, m, 0.012, col);
          if (moss > 0 && mossR[sb + Math.min(rows - 1, Math.floor(m * rows))] && hv < 0.35) put(new THREE.IcosahedronGeometry(r * 1.05, 0).scale(1, 0.5, 1.4).translate(x, 0, 0), side, m, 0.024, MOSSY[(i + j) % 2]);
        }
      } else {
        // Schindeln oder Schiefer: Reihen, jede halb versetzt, jede Platte leicht schief und im Ton etwas anders
        const nr = Math.max(rows, Math.round(slope / 0.06)), L = slope / nr * 1.35;
        const nx = Math.max(4, Math.round(W / 0.062)), pw = W / nx;
        for (let i = 0; i < nr; i++) {
          const m = (i + 0.5) / nr, off = (i % 2) * 0.5;
          for (let j = -1; j < nx; j++) {
            const x0 = -W / 2 + (j + off) * pw, x1 = Math.min(W / 2, x0 + pw), a = Math.max(-W / 2, x0);
            if (x1 - a < 0.012) continue;
            const hv = hash(seed * 97 + j * 13 + i * 7, side + 11);
            const col = mossR[sb + Math.min(rows - 1, Math.floor(m * rows))] && hv < 0.3 ? MOSSY[(i + j) % 2] : jit(cols[(i + j) % cols.length], 0.9 + hv * 0.2);
            const g = new THREE.BoxGeometry(x1 - a - 0.006, 0.014, L).rotateX(-0.07).rotateY((hv - 0.5) * 0.06).translate((a + x1) / 2, 0, 0);
            put(g, side, m, 0.018, col);
          }
        }
      }
    }
    // Ortgangbretter an den Giebelseiten
    for (const sx of [-1, 1]) for (const side of [1, -1]) {
      const g = new THREE.BoxGeometry(0.02, 0.05, slope * 1.03).translate(sx * (W / 2 + 0.006), 0, 0);
      put(g, side, 0.5, 0.012, thatch ? jit(cols[1], 0.85) : WOOD);
    }
  }

  // Spitzdach für Türme aus Schindelringen
  coneRoof(r, h, y0, cols, x = 0, z = 0, rings = 5) {
    for (let i = 0; i < rings; i++) {
      const t0 = i / rings, t1 = (i + 1) / rings;
      this.cyl(Math.max(0.01, r * (1 - t1) * 0.9), r * (1 - t0) + 0.02, h / rings * 1.15, 12, x, y0 + h * t0, z, cols[i % cols.length]);
    }
    this.cone(0.03, 0.14, 6, x, y0 + h, z, DARK);
    this.ball(0.025, x, y0 + h + 0.15, z, '#d9b45a');
  }

  // Fenster mit Rahmen, Sprossen, Licht und Blumenkasten. face: 0 vorn (+z), 1 rechts (+x), 2 hinten, 3 links.
  // Seit 24.10.2026 (PLAN_GRAFIK.md): das Glas sitzt tief in der Laibung, Rahmenleisten, Sturz und Bank stehen vor der
  // Wand (Schatten und Kontaktschatten geben Tiefe), helle Vorhänge innen, Läden mit Lamellen
  window(face, x, y, depth, s = 0.09, flowers = true) {
    const ry = [0, Math.PI / 2, Math.PI, -Math.PI / 2][face];
    const H = s * 1.35, fine = this.fine(), FR = '#f4ece0';
    const grp = [[new THREE.BoxGeometry(s, H, 0.02), '#ffd486', 'win', fine ? 0.002 : 0.018]];
    if (fine) {
      for (const sx of [-1, 1]) grp.push([new THREE.BoxGeometry(0.02, H + 0.036, 0.04).translate(sx * (s / 2 + 0.008), 0, 0), FR, 'solid', 0.016]);
      grp.push([new THREE.BoxGeometry(s + 0.036, 0.02, 0.04).translate(0, H / 2 + 0.008, 0), FR, 'solid', 0.016]);
      grp.push([new THREE.BoxGeometry(0.011, H, 0.014), FR, 'solid', 0.014]);
      grp.push([new THREE.BoxGeometry(s, 0.011, 0.014).translate(0, H * 0.12, 0), FR, 'solid', 0.014]);
      // Vorhänge innen, halb zugezogen
      for (const sx of [-1, 1]) grp.push([new THREE.BoxGeometry(s * 0.22, H * 0.9, 0.004).translate(sx * (s / 2 - s * 0.13), -H * 0.02, 0), '#f3ead9', 'solid', 0.0125]);
    } else {
      grp.push([new THREE.BoxGeometry(s + 0.035, H + 0.035, 0.03), FR, 'solid', 0.012]);
      grp.push([new THREE.BoxGeometry(0.012, H, 0.025), DARK, 'solid', 0.022], [new THREE.BoxGeometry(s, 0.012, 0.025), DARK, 'solid', 0.022]);
    }
    // Sturz oben und Fensterbank unten
    grp.push([new THREE.BoxGeometry(s + 0.06, 0.026, fine ? 0.046 : 0.034).translate(0, H / 2 + 0.03, 0), STONE[0], 'solid', 0.012]);
    if (!flowers) grp.push([new THREE.BoxGeometry(s + 0.064, 0.02, 0.058).translate(0, -H / 2 - 0.026, 0.008), STONE[2], 'solid', 0.014]);
    if (flowers) {
      grp.push([new THREE.BoxGeometry(s + 0.05, 0.034, 0.05).translate(0, -s * 0.72, 0.02), WOOD2, 'solid', 0.012]);
      for (let k = 0; k < 3; k++) {
        const col = FLOWERS[Math.floor(this.rnd() * FLOWERS.length)];
        if (!fine) { grp.push([new THREE.IcosahedronGeometry(0.022, 0).translate((k - 1) * s * 0.4, -s * 0.66, 0.03), col, 'solid', 0.012]); continue; }
        // nah: Blattpolster mit Blüten darüber, ein Trieb hängt über den Kasten
        const bx = (k - 1) * s * 0.4;
        grp.push([new THREE.IcosahedronGeometry(0.02, 1).scale(1.2, 0.8, 1).translate(bx, -s * 0.68, 0.032), k % 2 ? '#5f9a4c' : '#6fa857', 'solid', 0.012]);
        grp.push([new THREE.IcosahedronGeometry(0.0105, 0).translate(bx - 0.008, -s * 0.64, 0.044), col, 'solid', 0.012]);
        grp.push([new THREE.IcosahedronGeometry(0.0095, 0).translate(bx + 0.009, -s * 0.645, 0.036), col, 'solid', 0.012]);
        if (k !== 1) grp.push([new THREE.IcosahedronGeometry(0.011, 0).scale(0.8, 1.6, 0.8).translate(bx, -s * 0.78, 0.05), '#5a9248', 'solid', 0.012]);
      }
    }
    // Klappläden links und rechts, je Haus in einer Farbe (oder keine)
    const sc = this.det().shut;
    if (sc) for (const sx of [-1, 1]) {
      const cx = sx * (s * 0.75 + 0.022);
      grp.push([new THREE.BoxGeometry(s * 0.5, H, 0.014).translate(cx, 0, 0), sc, 'solid', 0.016]);
      if (fine) for (let i = 0; i < 5; i++) grp.push([new THREE.BoxGeometry(s * 0.42, 0.006, 0.006).translate(cx, -H * 0.38 + i * H * 0.19, 0), jit(sc, 0.82), 'solid', 0.024]);
      grp.push([new THREE.BoxGeometry(s * 0.5, 0.008, 0.016).translate(cx, s * 0.3, 0), DARK, 'solid', 0.018]);
      grp.push([new THREE.BoxGeometry(s * 0.5, 0.008, 0.016).translate(cx, -s * 0.3, 0), DARK, 'solid', 0.018]);
    }
    for (const [g, c, b, off] of grp) { g.translate(x, y, depth + off); g.rotateY(ry); this.add(g, c, b); }
  }

  // Tür, optional mit Bogen
  door(face, x, depth, arched = true, c = WOOD) {
    const ry = [0, Math.PI / 2, Math.PI, -Math.PI / 2][face];
    if (this.houseDetail && c === WOOD) c = this.det().door;
    // seit 24.10.2026: Türblatt tiefer in der Laibung, Gewände kräftiger (Schatten in der Öffnung)
    const fine = this.fine(), dl = fine ? 0.002 : 0.012;
    const gs = [[new THREE.BoxGeometry(0.12, 0.17, 0.03).translate(x, 0.085, depth + dl), c]];
    if (arched) gs.push([new THREE.CylinderGeometry(0.06, 0.06, 0.03, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(x, 0.17, depth + dl), c]);
    if (arched && fine) gs.push([new THREE.TorusGeometry(0.069, 0.011, 4, 12, Math.PI).translate(x, 0.17, depth + 0.02), STONE[0]]);
    gs.push([new THREE.BoxGeometry(0.15, 0.025, 0.06).translate(x, 0.0, depth + 0.02), STONE[1]]);
    // Rahmen, Bretterfugen, Knauf, zweite Stufe
    for (const sx of [-1, 1]) gs.push([new THREE.BoxGeometry(0.02, arched ? 0.17 : 0.185, fine ? 0.044 : 0.036).translate(x + sx * 0.07, arched ? 0.085 : 0.0925, depth + 0.016), STONE[0]]);
    if (!arched) gs.push([new THREE.BoxGeometry(0.16, 0.024, fine ? 0.048 : 0.036).translate(x, 0.186, depth + 0.016), STONE[0]]);
    // Topfpflanze neben der Tür (Wohnhäuser, nah)
    if (fine && this.houseDetail && hash(this.seed, 41) < 0.65) {
      const px = x + (hash(this.seed, 43) < 0.5 ? -0.115 : 0.115), pc = ['#c9774f', '#d8cfc0', '#6f8a9a', '#b8694a'][Math.floor(hash(this.seed, 47) * 4)];
      gs.push([new THREE.CylinderGeometry(0.026, 0.02, 0.045, 8).translate(px, 0.0225, depth + 0.045), pc]);
      gs.push([new THREE.IcosahedronGeometry(0.034, 1).scale(1, 1.15, 1).translate(px, 0.075, depth + 0.045), hash(this.seed, 49) < 0.5 ? '#5f9a4c' : '#78a85a']);
      if (hash(this.seed, 51) < 0.5) gs.push([new THREE.IcosahedronGeometry(0.011, 0).translate(px + 0.012, 0.1, depth + 0.07), FLOWERS[Math.floor(hash(this.seed, 53) * FLOWERS.length)]]);
    }
    for (const sx of [-1, 1]) gs.push([new THREE.BoxGeometry(0.005, 0.15, 0.033).translate(x + sx * 0.03, 0.08, depth + 0.013), DARK]);
    gs.push([new THREE.IcosahedronGeometry(0.009, 0).translate(x + 0.04, 0.085, depth + 0.031), GOLD]);
    gs.push([new THREE.BoxGeometry(0.19, 0.02, 0.1).translate(x, -0.016, depth + 0.035), STONE[2]]);
    // Hausnummer neben der Tür (Stadt)
    if (this.houseDetail && this.L >= 3) gs.push([new THREE.BoxGeometry(0.034, 0.024, 0.008).translate(x + 0.1, 0.16, depth + 0.004), '#2f4b80'], [new THREE.BoxGeometry(0.014, 0.012, 0.01).translate(x + 0.1, 0.16, depth + 0.006), '#f4f1e8']);
    for (const [g, col] of gs) { g.rotateY(ry); this.add(g, col); }
  }

  chimney(x, y0, z, h = 0.3) {
    this.box(0.09, h, 0.09, x, y0, z, STONE[1]);
    this.box(0.11, 0.03, 0.11, x, y0 + h, z, STONE[2]);
    // Schornsteinköpfe: ein oder zwei Tontöpfe
    const pots = this.det().pots;
    for (let i = 0; i < pots; i++) this.cyl(0.018, 0.022, 0.05, 6, x + (pots > 1 ? (i - 0.5) * 0.045 : 0), y0 + h + 0.03, z, '#b8694a');
    this.smoke.push([x, y0 + h + 0.08, z]);
  }

  lantern(x, z, h = 0.38) {
    this.cyl(0.012, 0.016, h, 5, x, 0, z, DARK);
    this.box(0.07, 0.012, 0.012, x + 0.03, h - 0.02, z, DARK);
    this.box(0.04, 0.05, 0.04, x + 0.06, h - 0.08, z, '#ffd27a', 'glow');
    this.cone(0.035, 0.03, 4, x + 0.06, h - 0.03, z, DARK, null, Math.PI / 4);
    // Glasrahmen, Boden und Spitze
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.box(0.006, 0.05, 0.006, x + 0.06 + a * 0.021, h - 0.08, z + b * 0.021, DARK);
    this.box(0.05, 0.008, 0.05, x + 0.06, h - 0.088, z, DARK);
    this.ball(0.008, x + 0.06, h + 0.004, z, DARK, null, 0);
    this.box(0.04, 0.03, 0.04, 0 + x, 0, z, DARK);
  }

  tower(x, z, r, h, wall, roofCols, y0 = 0) {
    this.cyl(r, r * 1.04, h, 14, x, y0, z, wall);
    this.cyl(r * 1.06, r * 1.06, 0.04, 14, x, y0 + h - 0.04, z, STONE[0]);
    this.coneRoof(r * 1.25, r * 2.6, y0 + h, roofCols, x, z);
    this.box(0.06, 0.09, 0.02, x, y0 + h * 0.62, z + r + 0.005, '#ffd486', 'win');
  }

  crenel(w, d, y, c = STONE[1]) {
    for (let x = -w / 2; x <= w / 2 + 0.001; x += 0.12) { this.box(0.06, 0.06, 0.06, x, y, d / 2, c); this.box(0.06, 0.06, 0.06, x, y, -d / 2, c); }
    for (let z = -d / 2 + 0.12; z < d / 2; z += 0.12) { this.box(0.06, 0.06, 0.06, w / 2, y, z, c); this.box(0.06, 0.06, 0.06, -w / 2, y, z, c); }
  }

  // Kahle Seiten mit Fenstern füllen (seit 24.10.2026, Runde 3, PLAN_GRAFIK.md: viele Bauten hatten Details nur vorn, die
  // Kamera kreist aber). Für jeden Baukörper (walls und große Kästen) und jede Seite wird geprüft, ob schon etwas an der
  // Wand sitzt (Fenster, Tür, Schild, Markise, Fallrohr); Bänder über die ganze Breite, Ecksteine, Dach und Sockel zählen
  // nicht. Ist die Seite leer und nicht von einem anderen Körper verdeckt, kommen Fenster im Stil der Epoche hinein.
  dress() {
    if (this.noDress || globalThis.PFR_NODRESS || !this.blocks.length) return; // PFR_NODRESS nur für A/B Messungen
    const parts = [...this.solid, ...this.win, ...this.glow];
    for (const g of parts) if (!g.boundingBox) g.computeBoundingBox();
    const B = this.blocks.slice();
    for (const b of B) {
      const { w, h, d, y0, ox, oz } = b;
      if (w < 0.2 || d < 0.16 || h < 0.16) continue;
      for (const face of [0, 1, 2, 3]) {
        const nx = [0, 1, 0, -1][face], nz = [1, 0, -1, 0][face], span = nx ? d : w;
        if (span < 0.16) continue;
        const px = ox + nx * w / 2, pz = oz + nz * d / 2;
        const cx = px + nx * 0.03, cy = y0 + h / 2, cz = pz + nz * 0.03;
        if (B.some(o => o !== b && Math.abs(cx - o.ox) < o.w / 2 && Math.abs(cz - o.oz) < o.d / 2 && cy > o.y0 && cy < o.y0 + o.h)) continue;
        let busy = false;
        for (const g of parts) {
          const bb = g.boundingBox;
          const lo = nx ? (nx > 0 ? bb.min.x - px : px - bb.max.x) : (nz > 0 ? bb.min.z - pz : pz - bb.max.z);
          const hi = nx ? (nx > 0 ? bb.max.x - px : px - bb.min.x) : (nz > 0 ? bb.max.z - pz : pz - bb.min.z);
          if (hi < -0.004 || lo > 0.12 || hi > 0.22) continue;
          const a0 = nx ? bb.min.z : bb.min.x, a1 = nx ? bb.max.z : bb.max.x;
          if (a1 - a0 > span * 0.85 || Math.abs((a0 + a1) / 2 - (nx ? oz : ox)) > span / 2 - 0.05) continue;
          const yc = (bb.min.y + bb.max.y) / 2;
          if (yc < y0 + 0.05 || yc > y0 + h - 0.01) continue;
          busy = true; break;
        }
        if (!busy) this.windowsOn(face, b, span, px, pz);
      }
    }
  }
  windowsOn(face, b, span, px, pz) {
    const L = this.L | 0, nx = [0, 1, 0, -1][face], { h, y0 } = b;
    const n = Math.max(1, Math.floor((span - 0.1) / 0.17)), floors = Math.max(1, Math.floor((h - 0.08) / 0.26));
    const step = n > 1 ? Math.min(0.17, (span - 0.14) / (n - 1)) : 0;
    for (let f = 0; f < floors; f++) {
      const y = y0 + 0.15 + f * 0.26;
      if (y + 0.09 > y0 + h) break;
      for (let i = 0; i < n; i++) {
        const a = (i - (n - 1) / 2) * step, X = nx ? px : b.ox + a, Z = nx ? b.oz + a : pz;
        if (L >= 7) mwin(this, face, X, y, Z, 0.08, 0.12, { frame: '#f4f1ea', mull: 1 });
        else if (L === 6) pane(this, face, X, y, Z, 0.065, 0.11, { arch: true, frame: '#e8dcc6' });
        else { const [x, dd] = toFace(face, X, Z); this.window(face, x, y, dd, L <= 2 ? 0.07 : 0.08, false); }
      }
    }
  }

  build() {
    this.dress();
    // leichte Unregelmäßigkeit wie von Hand gebaut
    for (const g of this.solid) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        p.setXYZ(i, x + Math.sin(y * 7.3 + z * 3.1 + this.seed) * 0.006, y + Math.sin(x * 5.3 + z * 5.9) * 0.004, z + Math.sin(y * 6.1 + x * 4.7 + this.seed) * 0.006);
      }
    }
    const parts = ['solid', 'win', 'glow'].map(k => (this[k].length ? mergeGeometries(this[k]) : null));
    const empty = () => new THREE.BufferGeometry()
      .setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3))
      .setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3))
      .setAttribute('color', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
    const g = mergeGeometries(parts.map(p => p || empty()), true);
    g.computeBoundingBox();
    this.height = g.boundingBox.max.y;
    return g;
  }
}

// Gestreifte Markise über einem Schaufenster (Front +z)
const AWN = [['#e07a5f', '#f4f1de'], ['#5fa8a0', '#f4f1de'], ['#e9c46a', '#f4f1de'], ['#7f9ccf', '#f4f1de'], ['#c98aa8', '#f4f1de']];
function awning(k, x, y, z, w, pal) {
  const n = Math.max(3, Math.round(w / 0.06));
  for (let i = 0; i < n; i++) k.add(new THREE.BoxGeometry(w / n, 0.012, 0.12).rotateX(0.42).translate(x - w / 2 + (i + 0.5) * w / n, y, z + 0.05), pal[i % 2]);
}
// Pyramidenstumpf (für Mansarddächer, Dachaufbauten)
function frustum(k, w, d, h, top, y0, c, x = 0, z = 0) {
  k.add(new THREE.CylinderGeometry(Math.SQRT1_2 * top, Math.SQRT1_2, h, 4, 1).rotateY(Math.PI / 4).scale(w, 1, d).translate(x, y0 + h / 2, z), c);
}
// Glasband mit Sprossen auf der Front (+z), seit 19.10.2026 mit Rahmen oben und Fensterbank aus Blech
function glassBand(k, w, y, h, z, n, frame = '#f2efe8', sill = true) {
  const s = Math.sign(z);
  k.box(w, h, 0.02, 0, y, z, '#8fbcd0', 'win');
  for (let i = 0; i <= n; i++) k.box(0.014, h, 0.026, -w / 2 + i * w / n, y, z + s * 0.004, frame);
  if (!k.fine()) return;
  k.box(w + 0.014, 0.014, 0.026, 0, y + h - 0.014, z + s * 0.004, frame);
  if (sill) k.box(w + 0.04, 0.012, 0.04, 0, y - 0.012, z + s * 0.014, SILL);
}

// ---------- Details für Industriezeit und Moderne (seit 19.10.2026) ----------
// Fensterrahmen mit Blechbank, Attika mit Abdeckung, Geländer mit Stäben oder Glas, Balkone, Eingänge mit Vordach,
// Klingel und Briefkasten, Dachtechnik, Fallrohre, Fugen, Mülltonnen, Fahrräder, Pflanzkübel. Front ist +z.
const ANTH = '#454b52', ALU = '#a9b0b6', SILL = '#d6d1c8', CAPC = '#e9e5de', ZINC2 = '#8d949a';
const MDOOR = ['#3e4348', '#c9a27a', '#2f4b66', '#7a2e2a', '#5f8f8a', '#e0a63a', '#f2efe8'];
const BINS = ['#4a5058', '#3f6fb0', '#e9c46a', '#7a5a3e'];
const BIKES = ['#c8553d', '#2f6f73', '#e9c46a', '#3e4348', '#7f9ccf'];
const dk = (h, f) => '#' + C(h).multiplyScalar(f).getHexString();
// Auswahl je Haus aus der Detailvariante d (k.d) und dem Samen: Dachtechnik, Geländer, Fahrrad, Türfarbe
function mdet(k) {
  if (k._md) return k._md;
  const d = k.d | 0, r = hash(k.seed * 13 + 5, k.seed + 1), r2 = hash(k.seed * 7 + 11, k.seed + 3);
  return (k._md = { d, roof: ['solar', 'green', 'tech'][d], bars: r < 0.5, bike: r2 < 0.55, door: MDOOR[Math.floor(r2 * 997) % MDOOR.length] });
}
// Modernes Fenster: Rahmen, Glas, Sprossen, Fensterbank. X, Z Fassadenstelle (Welt), y Fenstermitte
function mwin(k, face, X, y, Z, w, h, { lit = true, frame = ANTH, sill = SILL, mull = 0, glass } = {}) {
  const [x, d] = toFace(face, X, Z);
  if (!k.fine()) {
    fgeo(k, face, new THREE.BoxGeometry(w + 0.022, h + 0.022, 0.016), x, y, d + 0.004, frame);
    fgeo(k, face, new THREE.BoxGeometry(w, h, 0.016), x, y, d + 0.01, glass || GLASS, lit ? 'win' : 'solid');
    return;
  }
  // seit 24.10.2026: schmaler Rahmen steht vor, Glas sitzt dahinter (Tiefe im Licht)
  fgeo(k, face, new THREE.BoxGeometry(w, h, 0.016), x, y, d + 0.002, glass || GLASS, lit ? 'win' : 'solid');
  for (const sx of [-1, 1]) fgeo(k, face, new THREE.BoxGeometry(0.012, h + 0.022, 0.026), x + sx * (w / 2 + 0.005), y, d + 0.01, frame);
  fgeo(k, face, new THREE.BoxGeometry(w + 0.022, 0.012, 0.026), x, y + h / 2 + 0.005, d + 0.01, frame);
  fgeo(k, face, new THREE.BoxGeometry(w + 0.022, 0.012, 0.026), x, y - h / 2 - 0.005, d + 0.01, frame);
  for (let i = 1; i <= mull; i++) fgeo(k, face, new THREE.BoxGeometry(0.01, h, 0.028), x - w / 2 + i * w / (mull + 1), y, d + 0.016, frame);
  if (sill) fgeo(k, face, new THREE.BoxGeometry(w + 0.036, 0.012, 0.036), x, y - h / 2 - 0.016, d + 0.014, sill);
}
// Attika: niedrige Brüstung rund ums Flachdach mit heller Abdeckung, y ist die Oberkante des Dachs
function attika(k, w, d, y, c, { x = 0, z = 0, h = 0.045, t = 0.026, cap = CAPC } = {}) {
  for (const s of [-1, 1]) {
    k.box(w, h, t, x, y, z + s * (d / 2 - t / 2), c);
    k.box(t, h, d - 2 * t, x + s * (w / 2 - t / 2), y, z, c);
    if (!k.fine()) continue;
    k.box(w + 0.012, 0.012, t + 0.012, x, y + h, z + s * (d / 2 - t / 2), cap);
    k.box(t + 0.012, 0.012, d - 2 * t, x + s * (w / 2 - t / 2), y + h, z, cap);
  }
}
// Geländer von (x0, z0) nach (x1, z1) auf Höhe y: Stäbe mit Hand- und Fußlauf oder Glas zwischen zwei Pfosten
function railing(k, x0, z0, x1, z1, y, bars, H = 0.085, rail = ANTH) {
  const len = Math.hypot(x1 - x0, z1 - z0), ang = -Math.atan2(z1 - z0, x1 - x0), mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  k.box(len + 0.012, 0.01, 0.014, mx, y + H, mz, rail, null, ang);
  if (!k.fine()) { if (bars) k.box(len, 0.008, 0.01, mx, y + 0.012, mz, rail, null, ang); else k.box(len - 0.01, H - 0.014, 0.008, mx, y + 0.006, mz, '#cfe0e6', null, ang); return; }
  if (bars) {
    const n = Math.max(2, Math.round(len / 0.065));
    for (let i = 0; i <= n; i++) k.box(0.008, H, 0.008, x0 + (x1 - x0) * i / n, y, z0 + (z1 - z0) * i / n, rail);
    k.box(len, 0.008, 0.01, mx, y + 0.012, mz, rail, null, ang);
  } else {
    k.box(len - 0.01, H - 0.014, 0.008, mx, y + 0.006, mz, '#cfe0e6', null, ang);
    for (const t of [0, 1]) k.box(0.012, H, 0.012, x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t, rail);
  }
}
// Balkon vor der Front: Platte und Geländer an drei Seiten. z ist die Wand, y der Boden, dp die Tiefe
function balcony(k, x, y, z, w, dp, bars, c = CAPC) {
  k.box(w, 0.022, dp, x, y, z + dp / 2, c);
  const yy = y + 0.022, zf = z + dp - 0.008, xa = x - w / 2 + 0.006, xb = x + w / 2 - 0.006;
  railing(k, xa, zf, xb, zf, yy, bars);
  railing(k, xa, z + 0.01, xa, zf, yy, bars);
  railing(k, xb, z + 0.01, xb, zf, yy, bars);
}
// Blumenkasten unter einem Fenster
function flowerBox(k, x, y, z, w) {
  k.box(w, 0.03, 0.04, x, y, z + 0.02, WOOD2);
  if (!k.fine()) { k.rnd(); k.rnd(); k.rnd(); return; }
  for (let i = 0; i < 3; i++) k.ball(0.018, x + (i - 1) * w * 0.32, y + 0.04, z + 0.022, FLOWERS[Math.floor(k.rnd() * FLOWERS.length)], null, 0);
}
// Moderner Eingang: Tür mit Rahmen, Glasstreifen und Griffstange, Stufe, Vordach mit Licht, Hausnummer, Klingel,
// Briefkästen. z ist die Wandebene, side die Seite der Schilder. top: schmales Haus, Nummer über der Tür
function mentry(k, x, z, { w = 0.1, h = 0.19, col = ANTH, canopy = true, mail = 1, side = 1, top = false, cw = 0 } = {}) {
  const y0 = 0.06, ct = y0 + h + (top ? 0.05 : 0.03);
  k.box(w + 0.024, h + 0.012, 0.012, x, y0, z + 0.002, ANTH);
  k.box(w, h, 0.02, x, y0, z + 0.006, col);
  k.box(0.02, h * 0.7, 0.022, x - side * w * 0.24, y0 + h * 0.15, z + 0.007, '#ffd486', 'win');
  k.box(w + 0.08, 0.02, 0.07, x, y0 - 0.02, z + 0.035, '#cfcac2');
  if (canopy) k.box(cw || w + 0.1, 0.014, 0.1, x, ct, z + 0.05, CAPC);
  if (!k.fine()) return;
  k.box(0.006, 0.07, 0.012, x + side * w * 0.3, y0 + h * 0.36, z + 0.019, ALU);
  if (canopy) k.box(0.03, 0.005, 0.03, x, ct - 0.005, z + 0.05, '#fff1c8', 'glow');
  const sx = top ? x : x + side * (w / 2 + 0.035), ny = top ? y0 + h + 0.016 : y0 + h * 0.85;
  k.box(0.03, 0.02, 0.006, sx, ny, z + 0.003, '#2f4b80'); k.box(0.014, 0.008, 0.008, sx, ny + 0.006, z + 0.005, '#f4f1e8');
  if (top) return;
  k.box(0.016, 0.03, 0.006, sx, y0 + h * 0.5, z + 0.003, ALU); k.box(0.008, 0.008, 0.008, sx, y0 + h * 0.5 + 0.016, z + 0.005, '#f4f1e8');
  for (let i = 0; i < mail; i++) k.box(0.04, 0.03, 0.022, sx, y0 + 0.012 + i * 0.034, z + 0.011, '#5d6670');
}
// Wandleuchte mit warmem Licht
function wallLamp(k, x, y, z) { if (!k.fine()) return; k.box(0.018, 0.03, 0.02, x, y, z + 0.01, ANTH); k.box(0.012, 0.012, 0.012, x, y - 0.006, z + 0.016, '#fff1c8', 'glow'); }
// Fallrohr an der Wand mit Rinnenkasten oben und Schuh unten
function downpipe(k, x, z, h, c = ZINC2) { if (!k.fine()) return; k.cyl(0.009, 0.009, h - 0.07, 5, x, 0.07, z, c); k.box(0.022, 0.014, 0.03, x, 0.06, z + 0.008, c); k.box(0.03, 0.02, 0.03, x, h - 0.01, z, c); }
// Fugen in Fassadenpaneelen auf einer Seite: senkrechte Linien (nx Felder) und waagrechte auf den Höhen ys. dp: Abstand der Wand
function joints(k, face, w, y0, h, dp, nx, ys, c) {
  if (!k.fine()) return;
  for (let i = 1; i < nx; i++) fgeo(k, face, new THREE.BoxGeometry(0.006, h, 0.006), -w / 2 + i * w / nx, y0 + h / 2, dp + 0.001, c);
  for (const y of ys) fgeo(k, face, new THREE.BoxGeometry(w - 0.01, 0.006, 0.006), 0, y, dp + 0.001, c);
}
// Dachtechnik
function solar(k, x, y, z, nx, nz = 1, ry = 0, tilt = 0.3) {
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const px = (i - (nx - 1) / 2) * 0.112, pz = (j - (nz - 1) / 2) * 0.1;
    const P = (g, c) => { g.translate(px, y, pz); if (ry) g.rotateY(ry); g.translate(x, 0, z); k.add(g, c); };
    P(new THREE.BoxGeometry(0.1, 0.008, 0.075).rotateX(tilt).translate(0, 0.036, 0), '#2f4b66');
    if (!k.fine()) continue;
    P(new THREE.BoxGeometry(0.1, 0.012, 0.006).rotateX(tilt).translate(0, 0.036, 0), '#8fa6bd');
    P(new THREE.BoxGeometry(0.09, 0.03, 0.01).translate(0, 0.012, -0.03), ALU);
  }
}
function vent(k, x, y, z) { if (!k.fine()) return; k.cyl(0.011, 0.011, 0.045, 6, x, y, z, ALU); k.cyl(0.022, 0.016, 0.012, 6, x, y + 0.045, z, ALU); }
function acUnit(k, x, y, z, ry = 0) {
  k.box(0.09, 0.055, 0.06, x, y, z, '#e6e8ea', null, ry);
  if (!k.fine()) return;
  const g = new THREE.CylinderGeometry(0.019, 0.019, 0.008, 8).rotateX(Math.PI / 2).translate(0.016, 0.028, 0.031);
  g.rotateY(ry); g.translate(x, y, z); k.add(g, '#5d6670');
}
function antenna(k, x, y, z, h = 0.24) {
  if (!k.fine()) return;
  k.cyl(0.004, 0.005, h, 4, x, y, z, ALU);
  for (let i = 0; i < 3; i++) k.box(0.1 - i * 0.022, 0.006, 0.006, x, y + h * (0.55 + i * 0.16), z, ALU);
}
function satDish(k, x, y, z, ry = 0) {
  if (!k.fine()) return;
  k.cyl(0.004, 0.004, 0.05, 4, x, y, z, ALU);
  const g = new THREE.CylinderGeometry(0.032, 0.008, 0.014, 9).rotateX(1.15).translate(0, 0.055, 0.008);
  g.rotateY(ry); g.translate(x, y, z); k.add(g, '#eceef0');
}
function skylight(k, x, y, z, w = 0.1, d = 0.08) { k.box(w, 0.03, d, x, y, z, ANTH); k.add(new THREE.BoxGeometry(w - 0.016, 0.014, d - 0.016).rotateX(0.18).translate(x, y + 0.036, z), GLASS, 'win'); }
// Dach nach Wahl des Hauses: Solarfeld, Gründach oder Technik (Lüfter, Klimagerät, Antenne, Schüssel)
function roofKit(k, x, y, z, w, d, kind) {
  if (kind === 'solar') { solar(k, x, y, z, Math.max(1, Math.floor((w - 0.04) / 0.112)), Math.max(1, Math.floor((d - 0.04) / 0.1))); return; }
  if (kind === 'green') { k.box(w, 0.016, d, x, y, z, '#86b06a'); if (k.fine()) for (let i = 0; i < 3; i++) k.ball(0.022, x + (i - 1) * w * 0.3, y + 0.02, z + (i % 2 ? 0.25 : -0.25) * d, ['#6f9e52', '#e0679a', '#9fcf74'][i], null, 0); return; }
  acUnit(k, x - w * 0.22, y, z - d * 0.2); vent(k, x + w * 0.25, y, z + d * 0.22); vent(k, x + w * 0.3, y, z - d * 0.25);
  if (w > 0.3) antenna(k, x + w * 0.05, y, z + d * 0.25); else satDish(k, x + w * 0.1, y, z + d * 0.2);
}
// Straßenleben vor modernen Häusern: Mülltonnen (Rest, Papier, Gelb, Bio), Fahrrad, Bügel, Pflanzkübel
function bins(k, x, z, n, ry = 0) {
  if (!k.fine()) return;
  for (let i = 0; i < n; i++) {
    const c = BINS[i % BINS.length], P = (g, col) => k.add(g.rotateY(ry).translate(x, 0, z), col);
    P(new THREE.BoxGeometry(0.046, 0.068, 0.05).translate(i * 0.056, 0.034, 0), c);
    P(new THREE.BoxGeometry(0.05, 0.01, 0.058).translate(i * 0.056, 0.073, -0.003), i % BINS.length ? c : '#3a3f45');
  }
}
function bike(k, x, z, ry = 0, c = BIKES[0]) {
  if (!k.fine()) return;
  const P = (g, col) => k.add(g.rotateY(ry).translate(x, 0, z), col);
  for (const s of [-1, 1]) P(new THREE.TorusGeometry(0.026, 0.004, 3, 9).translate(s * 0.042, 0.03, 0), '#2a2d31');
  P(new THREE.BoxGeometry(0.046, 0.006, 0.006).translate(0.008, 0.064, 0), c);
  P(new THREE.BoxGeometry(0.05, 0.006, 0.006).rotateZ(0.9).translate(0.014, 0.047, 0), c);
  P(new THREE.BoxGeometry(0.006, 0.042, 0.006).translate(-0.012, 0.03, 0), c);
  P(new THREE.BoxGeometry(0.036, 0.005, 0.005).translate(-0.026, 0.03, 0), c);
  P(new THREE.BoxGeometry(0.006, 0.054, 0.006).translate(0.036, 0.03, 0), ANTH);
  P(new THREE.BoxGeometry(0.006, 0.006, 0.04).translate(0.036, 0.083, 0), ANTH);
  P(new THREE.BoxGeometry(0.02, 0.006, 0.012).translate(-0.012, 0.074, 0), '#2a2d31');
}
function bikeRack(k, x, z, n, ry = 0) { if (k.fine()) for (let i = 0; i < n; i++) k.add(new THREE.TorusGeometry(0.026, 0.004, 3, 6, Math.PI).translate(0, 0.045, i * 0.07).rotateY(ry).translate(x, 0, z), ALU); }
function planter(k, x, z, s = 1, y0 = 0, c = '#c9c4ba', leaf = '#6aa64f') { k.box(0.07 * s, 0.045 * s, 0.07 * s, x, y0, z, c); k.ball(0.036 * s, x, y0 + 0.062 * s, z, leaf, null, 0); }

// ---------- Helfer für die neuen Gebäude (seit 17.10.2026) ----------
const FACE = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
const MARBLE = '#f4eee2', GOLD = '#e9b44c', COPPER = ['#7fb8a4', '#6fa894', '#8fc6b2'], GLASS = '#8fbcd0', DGLASS = '#4f6272';
const CRIMSON = '#b8413a', HEDGE = '#5f8f4e', LAWN = '#8dbb68', GRAVEL = '#e6dcc4';
// Halbe Scheibe als Bogen über Tür oder Fenster, Front +z
const semi = (r, d, seg = 8) => new THREE.CylinderGeometry(r, r, d, seg, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2);
// Weltlage einer Fassadenstelle (X, Z) in die lokale Lage von face umrechnen
const toFace = (face, X, Z) => [[X, Z], [-Z, X], [-X, -Z], [Z, -X]][face];
// Geometrie auf eine Seite drehen und ablegen
function fgeo(k, face, g, x, y, z, c, b) { g.translate(x, y, z); if (face) g.rotateY(FACE[face]); return k.add(g, c, b); }
// Schlichtes Fenster (Rahmen und Glas) an der Fassadenstelle X, Z (Welt), y ist die Fenstermitte
function pane(k, face, X, y, Z, w = 0.07, h = 0.1, { lit = true, frame = '#f4ece0', glass, arch = false } = {}) {
  const [x, d] = toFace(face, X, Z);
  if (k.fine()) {
    // seit 24.10.2026: Glas in der Wand, Rahmenleisten und Bank davor (Tiefe), Sprosse
    fgeo(k, face, new THREE.BoxGeometry(w, h, 0.02), x, y, d + 0.002, glass || (lit ? '#ffd486' : DGLASS), lit ? 'win' : 'solid');
    for (const sx of [-1, 1]) fgeo(k, face, new THREE.BoxGeometry(0.016, h + 0.024, 0.032), x + sx * (w / 2 + 0.006), y, d + 0.012, frame);
    if (!arch) fgeo(k, face, new THREE.BoxGeometry(w + 0.028, 0.016, 0.032), x, y + h / 2 + 0.006, d + 0.012, frame);
    fgeo(k, face, new THREE.BoxGeometry(w + 0.034, 0.016, 0.044), x, y - h / 2 - 0.008, d + 0.016, frame);
    fgeo(k, face, new THREE.BoxGeometry(0.009, h, 0.012), x, y, d + 0.01, frame);
  } else {
    fgeo(k, face, new THREE.BoxGeometry(w + 0.024, h + 0.024, 0.02), x, y, d + 0.006, frame);
    fgeo(k, face, new THREE.BoxGeometry(w, h, 0.02), x, y, d + 0.013, glass || (lit ? '#ffd486' : DGLASS), lit ? 'win' : 'solid');
  }
  if (arch) {
    fgeo(k, face, semi(w / 2 + 0.012, 0.02, 7), x, y + h / 2, d + 0.006, frame);
    fgeo(k, face, semi(w / 2, 0.02, 7), x, y + h / 2, d + 0.013, glass || (lit ? '#ffd486' : DGLASS), lit ? 'win' : 'solid');
  }
}
// Bogenöffnung (dunkel) auf einer Seite, y0 Unterkante
function archway(k, face, X, Z, w, h, c = '#3b302a', y0 = 0, b) {
  const [x, d] = toFace(face, X, Z);
  fgeo(k, face, new THREE.BoxGeometry(w, h - w / 2, 0.03), x, y0 + (h - w / 2) / 2, d + 0.008, c, b);
  fgeo(k, face, semi(w / 2, 0.03, 8), x, y0 + h - w / 2, d + 0.008, c, b);
}
// Dreiecksprisma (Giebel, Tempeldach), First entlang x
function prism(k, w, d, h, y0, c, x = 0, z = 0, ry = 0, b) {
  const g = new THREE.CylinderGeometry(1, 1, w, 3).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).scale(1, h / 1.5, d / Math.sqrt(3));
  g.translate(0, y0 + h / 3, 0); if (ry) g.rotateY(ry); g.translate(x, 0, z);
  return k.add(g, c, b);
}
// Kasten, dessen Oberseite in z schmaler wird (Mansard und Scheunendach)
function wedge(k, w, d, h, top, y0, c, x = 0, z = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setZ(i, p.getZ(i) * top);
  g.translate(0, y0 + h / 2, 0); if (ry) g.rotateY(ry); g.translate(x, 0, z);
  return k.add(g, c);
}
// Säule mit Fuß und Kapitell
function column(k, x, y0, z, h, r = 0.028, c = MARBLE) {
  k.box(r * 2.6, 0.025, r * 2.6, x, y0, z, c);
  k.cyl(r * 0.9, r, h - 0.05, 8, x, y0 + 0.025, z, c);
  k.box(r * 2.8, 0.025, r * 2.8, x, y0 + h - 0.025, z, c);
}
// Stufen: n Platten, jede kleiner und höher
function steps(k, w, d, n, y0, c, x = 0, z = 0, sh = 0.03) { for (let i = 0; i < n; i++) k.box(w - i * 0.05, sh, d - i * 0.05, x, y0 + i * sh, z, i % 2 ? STONE[2] : c); }
// Fahne an einer Stange
function flag(k, x, z, h, col, y0 = 0, w = 0.16) {
  k.cyl(0.009, 0.011, h, 4, x, y0, z, DARK);
  k.box(w, w * 0.62, 0.008, x + w / 2 + 0.008, y0 + h - w * 0.7, z, col);
  k.ball(0.016, x, y0 + h + 0.01, z, GOLD, null, 0);
}
// Laubbaum mit runder Krone (Parks, Gärten)
function tree(k, x, z, s = 1, col = '#7fae5a', y0 = 0) {
  k.cyl(0.016 * s, 0.024 * s, 0.17 * s, 5, x, y0, z, '#7b5a3e');
  k.ball(0.11 * s, x, y0 + 0.22 * s, z, col);
  k.ball(0.075 * s, x + 0.05 * s, y0 + 0.3 * s, z - 0.02 * s, col, null, 0);
}
function bench(k, x, z, ry = 0, c = WOOD2, y0 = 0) {
  const parts = [[0.16, 0.012, 0.05, 0, 0.06, 0], [0.16, 0.05, 0.01, 0, 0.075, -0.022], [0.012, 0.06, 0.04, -0.06, 0, 0], [0.012, 0.06, 0.04, 0.06, 0, 0]];
  for (const [w, h, d, px, py, pz] of parts) k.add(new THREE.BoxGeometry(w, h, d).translate(px, py + h / 2, pz).rotateY(ry).translate(x, y0, z), py === 0 ? DARK : c);
}
function barrel(k, x, z, c = '#9b7450', y0 = 0) { k.cyl(0.045, 0.045, 0.1, 8, x, y0, z, c); k.cyl(0.048, 0.048, 0.012, 8, x, y0 + 0.07, z, DARK); }
// Wirtshausschild an einem Ausleger über der Tür (Front +z)
function hangSign(k, x, y, z, col, emblem) {
  k.box(0.16, 0.014, 0.014, x + 0.06, y, z, DARK);
  k.box(0.006, 0.03, 0.006, x + 0.03, y - 0.03, z, DARK); k.box(0.006, 0.03, 0.006, x + 0.11, y - 0.03, z, DARK);
  k.box(0.11, 0.08, 0.014, x + 0.07, y - 0.12, z, col);
  if (emblem) k.add(emblem.translate(x + 0.07, y - 0.08, z + 0.012), GOLD);
}
// Tiere für den Viehhof
function sheep(k, x, z, ry = 0, c = '#f3efe6') {
  k.add(new THREE.IcosahedronGeometry(0.05, 0).scale(1.35, 0.85, 1).rotateY(ry).translate(x, 0.075, z), c);
  const fx = Math.cos(ry), fz = -Math.sin(ry);
  k.add(new THREE.BoxGeometry(0.035, 0.04, 0.032).rotateY(ry).translate(x + fx * 0.065, 0.1, z + fz * 0.065), '#3e3a39');
  for (const [a, b] of [[0.03, 0.022], [0.03, -0.022], [-0.03, 0.022], [-0.03, -0.022]]) k.add(new THREE.BoxGeometry(0.012, 0.04, 0.012).translate(a, 0.02, b).rotateY(ry).translate(x, 0, z), '#3e3a39');
}
function cow(k, x, z, ry = 0, c = '#f4f1ea', spot = '#4a3f3a') {
  const P = (w, h, d, px, py, pz, col) => k.add(new THREE.BoxGeometry(w, h, d).translate(px, py + h / 2, pz).rotateY(ry).translate(x, 0, z), col);
  P(0.13, 0.065, 0.06, 0, 0.05, 0, c);
  P(0.045, 0.05, 0.045, 0.085, 0.08, 0, c); P(0.02, 0.022, 0.035, 0.112, 0.08, 0, '#e8b4a8');
  P(0.04, 0.03, 0.062, -0.02, 0.08, 0, spot); P(0.03, 0.04, 0.062, 0.035, 0.06, 0, spot);
  for (const [a, b] of [[0.045, 0.02], [0.045, -0.02], [-0.045, 0.02], [-0.045, -0.02]]) P(0.016, 0.05, 0.016, a, 0, b, '#5b4a3c');
}
// Zaun aus Pfosten und zwei Latten zwischen zwei Punkten
function fence(k, x0, z0, x1, z1, c = '#f1ead9', step = 0.12, h = 0.1) {
  const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / step)), ang = Math.atan2(z1 - z0, x1 - x0);
  for (let i = 0; i <= n; i++) { k.box(0.014, h, 0.014, x0 + (x1 - x0) * i / n, 0, z0 + (z1 - z0) * i / n, c); k.cone(0.011, 0.018, 4, x0 + (x1 - x0) * i / n, h, z0 + (z1 - z0) * i / n, c, null, Math.PI / 4); }
  for (const y of [h * 0.35, h * 0.75]) k.box(len, 0.012, 0.01, (x0 + x1) / 2, y, (z0 + z1) / 2, c, null, -ang);
}
// Gefäß aus der Töpferei
function pot(k, x, z, s = 1, c = '#c9774f', y0 = 0) { k.cyl(0.022 * s, 0.03 * s, 0.05 * s, 7, x, y0, z, c); k.cyl(0.03 * s, 0.022 * s, 0.03 * s, 7, x, y0 + 0.05 * s, z, c); k.cyl(0.016 * s, 0.018 * s, 0.018 * s, 7, x, y0 + 0.08 * s, z, c); }
// Schlichter Gebäudeflügel ohne Ecksteine, mit Satteldach (First entlang x, rot: entlang z)
function wing(k, x, z, w, d, h, wall, roofCols, { rot = false, rh = 0.22, rows = 4, gable, y0 = 0.06, moss = 0.1, over = 0.05 } = {}) {
  k.box(w + 0.05, 0.34, d + 0.05, x, -0.28, z, STONE[1]);
  k.box(w, h, d, x, y0, z, wall);
  if (roofCols) k.roof(rot ? d : w, rot ? w : d, rh, y0 + h, roofCols, { rows, gable: gable || wall, ry: rot ? Math.PI / 2 : 0, x, z, moss, over });
}
// Fensterreihen an der Front (+z) und hinten eines Flügels
function winRows(k, x, z, w, d, ys, n, { sides = false, back = true, ww = 0.065, hh = 0.1, lit = true, arch = false, frame } = {}) {
  for (const y of ys) for (let i = 0; i < n; i++) {
    const X = x - w / 2 + (i + 0.5) * w / n;
    pane(k, 0, X, y, z + d / 2, ww, hh, { lit, arch, frame });
    if (back) pane(k, 2, X, y, z - d / 2, ww, hh, { lit, arch, frame });
  }
  if (sides) for (const y of ys) { pane(k, 1, x + w / 2, y, z, ww, hh, { lit, arch, frame }); pane(k, 3, x - w / 2, y, z, ww, hh, { lit, arch, frame }); }
}
// Fackel oder Feuerschale mit Glut
function torch(k, x, z, h = 0.3) { k.cyl(0.01, 0.014, h, 4, x, 0, z, DARK); k.cyl(0.03, 0.018, 0.03, 6, x, h, z, DARK); k.cone(0.022, 0.06, 5, x, h + 0.03, z, '#ffb24a', 'glow'); }

// ---------- Häuser je Epoche ----------
function house(k, L, v, w) {
  if (houseVariant(k, L, v, w)) return;
  const plaster = PLASTER[(v * 3 + w) % PLASTER.length];
  if (L === 0) {
    k.cone(0.3, 0.5, 8, 0, 0, 0, '#d8bf94');
    for (let i = 0; i < 3; i++) k.cyl(0.006, 0.006, 0.16, 3, Math.cos(i * 2.1) * 0.03, 0.42, Math.sin(i * 2.1) * 0.03, DARK);
    k.box(0.09, 0.14, 0.02, 0, 0, 0.23, '#6e543e');
    for (let i = 0; i < 5; i++) k.ball(0.04, 0.36 + Math.cos(i * 1.2) * 0.07, 0.02, 0.2 + Math.sin(i * 1.2) * 0.07, '#8f8a82', null, 0);
    return;
  }
  if (L === 1) {
    k.cyl(0.27, 0.29, 0.26, 12, 0, 0, 0, '#c9a27a');
    k.coneRoof(0.4, 0.38, 0.24, THATCH[v % 2], 0, 0, 4);
    k.door(0, 0, 0.27, true, '#6e543e');
    k.box(0.07, 0.07, 0.02, 0.17, 0.12, 0.215, '#ffd486', 'win');
    if (v === 1) { k.cyl(0.08, 0.1, 0.12, 8, 0.32, 0, -0.2, '#b98f62'); k.cone(0.12, 0.12, 8, 0.32, 0.12, -0.2, THATCH[0][1]); }
    return;
  }
  if (L === 2) {
    k.plinth(0.56, 0.44);
    k.walls(0.56, 0.3, 0.44, 0.06, '#efe2c6', null);
    k.beams(0.56, 0.3, 0.44, 0.06);
    k.roof(0.56, 0.44, 0.3, 0.36, THATCH[v % 2], { rows: 4, over: 0.08, gable: '#e8d8b8', moss: 0.1 });
    k.door(0, -0.14, 0.22, false, WOOD);
    k.window(0, 0.12, 0.2, 0.22, 0.085);
    k.window(2, 0, 0.2, 0.22, 0.085, false);
    k.chimney(0.2, 0.4, -0.08, 0.32);
    if (w % 2) k.lantern(-0.26, 0.3);
    return;
  }
  if (L === 3) {
    k.plinth(0.58, 0.48);
    const wall3 = (v + w) % 2 === 1 ? plaster : STONE[(v + 1) % 3]; // seit 24.10.2026 jedes zweite Haus in Pastell (vorher jedes vierte)
    k.walls(0.58, 0.34, 0.48, 0.06, wall3, '#c9b998');
    k.roof(0.58, 0.48, 0.28, 0.4, ROOF_MIX[(v * 5 + w) % ROOF_MIX.length], { rows: 5, gable: wall3, moss: 0.18 });
    k.door(0, -0.15, 0.24);
    k.window(0, 0.1, 0.22, 0.24);
    k.window(1, 0, 0.22, 0.29, 0.08);
    k.window(2, -0.05, 0.22, 0.24);
    k.chimney(-0.2, 0.44, 0.1, 0.3);
    k.lantern(0.33, 0.3);
    return;
  }
  if (L === 4) {
    k.plinth(0.58, 0.48);
    k.walls(0.58, 0.62, 0.48, 0.06, plaster);
    const roofC = ROOF_MIX[(v * 3 + w * 2) % ROOF_MIX.length];
    k.roof(0.58, 0.48, 0.36, 0.68, roofC, { rows: 6, gable: plaster, moss: 0.2 });
    k.door(0, -0.14, 0.24);
    k.window(0, 0.12, 0.2, 0.24); k.window(0, -0.12, 0.48, 0.24); k.window(0, 0.12, 0.48, 0.24);
    k.window(2, 0, 0.22, 0.24); k.window(2, 0, 0.48, 0.24, 0.09, false);
    k.window(1, 0, 0.35, 0.29, 0.08);
    k.box(0.14, 0.12, 0.12, 0.05, 0.8, 0.12, plaster);
    k.roof(0.14, 0.14, 0.08, 0.92, roofC, { rows: 2, over: 0.03, ry: Math.PI / 2 });
    k.box(0.07, 0.08, 0.02, 0.05, 0.82, 0.185, '#ffd486', 'win');
    k.chimney(-0.2, 0.75, -0.1, 0.35);
    if (v === 2) k.tower(0.34, 0.22, 0.13, 0.78, plaster, roofC);
    k.lantern(-0.34, 0.3);
    return;
  }
  if (L === 5) {
    k.plinth(0.5, 0.5);
    k.walls(0.5, 0.86, 0.5, 0.06, plaster);
    const roofC = SLATE[(v + w) % 2];
    k.roof(0.5, 0.5, 0.4, 0.92, roofC, { rows: 6, gable: plaster, ry: Math.PI / 2, moss: 0.12 });
    k.door(0, 0, 0.25);
    for (const yy of [0.42, 0.68]) { k.window(0, -0.13, yy, 0.25); k.window(0, 0.13, yy, 0.25); k.window(2, 0, yy, 0.25); }
    k.window(0, 0.13, 0.2, 0.25);
    k.box(0.32, 0.025, 0.1, 0, 0.55, 0.3, WOOD2);
    for (let i = 0; i < 5; i++) k.box(0.012, 0.08, 0.012, -0.14 + i * 0.07, 0.575, 0.345, WOOD);
    k.box(0.32, 0.015, 0.015, 0, 0.66, 0.345, WOOD);
    k.chimney(0.15, 1.0, -0.12, 0.3);
    if (w % 2) k.tower(-0.3, 0.2, 0.12, 0.95, plaster, roofC);
    return;
  }
  if (L === 6) { house6(k, v, w); return; }
  house7(k, v, w);
}

// Vorgarten mit Lattenzaun und Blumenbeet an der Seite (Dorf bis Renaissance)
function garden(k, L, v) {
  const x = -0.4;
  for (let z = -0.22; z <= 0.31; z += 0.066) k.box(0.014, 0.085, 0.014, x - 0.055, 0, z, '#f1ead9');
  for (const y of [0.03, 0.065]) k.box(0.01, 0.01, 0.56, x - 0.055, y, 0.045, '#f1ead9');
  k.box(0.09, 0.025, 0.46, x + 0.01, 0, 0.04, '#7d5c3e');
  for (let i = 0; i < 4; i++) {
    k.ball(0.032, x + 0.01, 0.045, -0.15 + i * 0.12, '#6f9e52', null, 0);
    k.ball(0.018, x + 0.012, 0.075, -0.15 + i * 0.12, FLOWERS[(i + v * 2) % FLOWERS.length], null, 0);
  }
}

// Industriezeit: drei Haustypen statt eines Backsteinblocks
const BRICK = ['#b0654a', '#a35c44', '#bb7255', '#9c5a48', '#c07a5c', '#a8695a'];
function house6(k, v, w) {
  const brick = BRICK[(v * 2 + w) % BRICK.length], trim = '#ece2cf';
  if (w === 4) {
    // Viktorianische Villa: bunte Holzfassade, Eckturm mit Spitzdach, Veranda auf Pfosten
    const paint = ['#c9d8e8', '#f2d4c8', '#d8e6c8'][v], tr = '#f7f3ea', rc = SLATE[v % 2];
    k.plinth(0.56, 0.48, '#9a958c');
    k.walls(0.56, 0.56, 0.48, 0.06, paint, null);
    for (let i = 0; i < 5; i++) k.box(0.565, 0.008, 0.485, 0, 0.12 + i * 0.1, 0, tr);
    k.roof(0.56, 0.48, 0.3, 0.62, rc, { rows: 5, gable: paint, moss: 0.05 });
    k.cyl(0.11, 0.11, 0.8, 10, -0.26, 0, 0.2, paint);
    k.cyl(0.115, 0.115, 0.02, 10, -0.26, 0.4, 0.2, tr);
    k.coneRoof(0.15, 0.34, 0.8, rc, -0.26, 0.2, 3);
    pane(k, 0, -0.26, 0.6, 0.31, 0.05, 0.09, { frame: tr }); pane(k, 0, -0.26, 0.28, 0.31, 0.05, 0.09, { frame: tr });
    k.box(0.4, 0.04, 0.16, 0.08, 0.0, 0.32, WOOD2);
    for (const x of [-0.1, 0.08, 0.26]) k.box(0.02, 0.24, 0.02, x, 0.04, 0.39, tr);
    k.add(new THREE.BoxGeometry(0.44, 0.025, 0.2).rotateX(0.25).translate(0.08, 0.3, 0.33), rc[0]);
    k.box(0.38, 0.012, 0.012, 0.08, 0.14, 0.395, tr);
    k.door(0, 0.02, 0.24, false, '#7a2e2a');
    k.window(0, 0.18, 0.2, 0.24, 0.08, false);
    k.window(0, 0.04, 0.46, 0.24, 0.08, true); k.window(0, 0.18, 0.46, 0.24, 0.08, false);
    k.window(2, -0.1, 0.3, 0.24, 0.08, false); k.window(2, 0.12, 0.3, 0.24, 0.08, false);
    k.window(1, 0, 0.36, 0.28, 0.08, false);
    k.chimney(0.18, 0.72, -0.1, 0.3);
    // Verandageländer mit Stäben, Zierbügel unter dem Dach, Stufe, Wetterfahne, niedriger Lattenzaun (seit 19.10.2026)
    railing(k, -0.11, 0.395, -0.03, 0.395, 0.04, true, 0.07, tr); railing(k, 0.07, 0.395, 0.27, 0.395, 0.04, true, 0.07, tr);
    if (k.fine()) for (const x of [-0.1, 0.08, 0.26]) for (const s of [-1, 1]) if (x + s * 0.03 > -0.12 && x + s * 0.03 < 0.28) k.add(new THREE.BoxGeometry(0.045, 0.01, 0.012).rotateZ(s * 0.7).translate(x + s * 0.016, 0.262, 0.39), tr);
    k.box(0.1, 0.02, 0.05, 0.02, 0, 0.43, STONE[1]);
    if (k.fine()) {
      k.cyl(0.004, 0.004, 0.1, 4, -0.26, 1.29, 0.2, DARK); k.box(0.09, 0.006, 0.006, -0.26, 1.35, 0.2, DARK); k.cone(0.012, 0.024, 4, -0.21, 1.344, 0.2, DARK, null, 0); k.box(0.02, 0.026, 0.004, -0.3, 1.34, 0.2, DARK);
      for (const [x0, x1] of [[-0.42, -0.07], [0.12, 0.42]]) fence(k, x0, 0.41, x1, 0.41, tr, 0.07, 0.075);
    }
    return;
  }
  if (v === 0) {
    // Reihenhaus aus Backstein mit Laden und Markise
    k.plinth(0.62, 0.5, '#9a958c');
    k.walls(0.62, 0.76, 0.5, 0.06, brick, trim);
    k.box(0.64, 0.03, 0.52, 0, 0.39, 0, trim);
    k.roof(0.62, 0.5, 0.26, 0.82, SLATE[w % 2], { rows: 5, gable: brick, moss: 0.04 });
    for (const xx of [-0.18, 0, 0.18]) { k.window(0, xx, 0.56, 0.25, 0.08, w % 2 === 0); k.window(2, xx, 0.56, 0.25, 0.08, false); }
    for (const xx of [-0.12, 0.12]) k.window(2, xx, 0.2, 0.25, 0.08, false);
    k.window(1, 0, 0.56, 0.31, 0.08, false); k.window(3, 0, 0.56, 0.31, 0.08, false);
    k.box(0.34, 0.19, 0.02, 0.09, 0.1, 0.252, '#9fc4d0', 'win');
    k.box(0.38, 0.03, 0.03, 0.09, 0.29, 0.258, trim);
    awning(k, 0.09, 0.33, 0.262, 0.4, AWN[(v + w) % AWN.length]);
    k.door(0, -0.2, 0.25, false, '#3e5a6a');
    k.chimney(w % 2 ? 0.2 : -0.2, 0.9, 0, 0.3);
    // Ladenschild, Sprossen im Schaufenster, Warenkisten und Aufsteller vor dem Laden, Gaslaterne (seit 19.10.2026)
    const sign = ['#2f4b66', '#7a2e2a', '#2f6f73', '#3e4348'][(w + k.d) % 4];
    k.box(0.34, 0.055, 0.016, 0.09, 0.415, 0.266, sign); k.box(0.24, 0.014, 0.018, 0.09, 0.436, 0.267, '#f2dca0');
    k.box(0.36, 0.03, 0.03, 0.09, 0.07, 0.26, trim);
    if (!k.fine()) return;
    for (const x of [0.005, 0.175]) k.box(0.012, 0.19, 0.012, x, 0.1, 0.262, '#3e5a6a');
    k.box(0.34, 0.012, 0.012, 0.09, 0.235, 0.262, '#3e5a6a');
    const goods = [['#e07a5f', '#f2c14e', '#9fbf6f'], ['#9fbf6f', '#e9c46a', '#c8553d'], ['#e98a3a', '#86bd5a', '#f2c14e']][k.d % 3];
    for (let i = 0; i < 2; i++) { const x = 0.02 + i * 0.13; k.box(0.08, 0.04, 0.05, x, 0, 0.32, WOOD2); for (let j = 0; j < 3; j++) k.ball(0.017, x - 0.024 + j * 0.024, 0.05, 0.32, goods[(i + j) % 3], null, 0); }
    for (const s of [-1, 1]) k.add(new THREE.BoxGeometry(0.06, 0.085, 0.006).rotateX(s * 0.22).translate(-0.06, 0.042, 0.33 + s * 0.01), s > 0 ? '#3e4348' : '#4a4f55');
    k.lantern(-0.37, 0.28, 0.36);
    return;
  }
  if (v === 1) {
    // Verputztes Stadthaus mit Mansarddach und Gauben
    const pl = PLASTER[(w * 3 + 1) % PLASTER.length];
    k.plinth(0.58, 0.5, '#9a958c');
    k.walls(0.58, 0.62, 0.5, 0.06, pl, trim);
    k.box(0.62, 0.035, 0.54, 0, 0.68, 0, trim);
    frustum(k, 0.62, 0.54, 0.24, 0.72, 0.715, SLATE[w % 2][0]);
    frustum(k, 0.45, 0.39, 0.08, 0.5, 0.955, SLATE[w % 2][1]);
    for (const xx of [-0.14, 0.14]) {
      k.box(0.1, 0.11, 0.08, xx, 0.78, 0.23, pl);
      k.roof(0.1, 0.08, 0.06, 0.89, SLATE[w % 2], { rows: 1, over: 0.02, ry: Math.PI / 2 });
      k.box(0.06, 0.07, 0.02, xx, 0.8, 0.275, '#ffd486', 'win');
    }
    for (const yy of [0.22, 0.46]) for (const xx of [-0.17, 0.17]) { k.window(0, xx, yy, 0.25, 0.08, yy > 0.3); k.window(2, xx, yy, 0.25, 0.08, false); }
    for (const yy of [0.22, 0.46]) { k.window(1, 0, yy, 0.29, 0.08, false); k.window(3, 0, yy, 0.29, 0.08, false); }
    k.door(0, 0, 0.25, true, '#5b4a6e');
    k.box(0.2, 0.02, 0.08, 0, 0.3, 0.29, trim);
    k.chimney(-0.22, 0.96, -0.1, 0.22);
    // Französische Tür mit Eisenbalkon über dem Eingang, Rinne an der Mansardtraufe, Fallrohre, Kellerfenster (seit 19.10.2026)
    pane(k, 0, 0, 0.465, 0.25, 0.07, 0.15, { frame: trim });
    k.box(0.16, 0.014, 0.065, 0, 0.36, 0.282, '#3e4348');
    railing(k, -0.075, 0.31, 0.075, 0.31, 0.374, true, 0.07, '#2f3438');
    for (const s of [-1, 1]) railing(k, s * 0.075, 0.256, s * 0.075, 0.31, 0.374, true, 0.07, '#2f3438');
    for (const s of [-1, 1]) { k.box(0.64, 0.02, 0.026, 0, 0.7, s * 0.283, ZINC2); downpipe(k, s * 0.255, 0.266, 0.71); }
    if (k.fine()) for (const x of [-0.17, 0.17]) pane(k, 0, x, 0.02, 0.28, 0.06, 0.03, { lit: false, frame: '#8a857c' });
    return;
  }
  // Backsteinhaus mit Stufengiebel zur Straße
  k.plinth(0.52, 0.6, '#9a958c');
  k.walls(0.52, 0.66, 0.6, 0.06, brick, null);
  k.roof(0.52, 0.6, 0.34, 0.72, SLATE[(w + 1) % 2], { rows: 5, gable: brick, ry: Math.PI / 2, moss: 0.04 });
  for (let i = 0; i < 4; i++) {
    const ww = 0.52 - i * 0.12;
    k.box(ww, 0.09, 0.05, 0, 0.72 + i * 0.085, 0.29, brick);
    k.box(ww + 0.02, 0.02, 0.06, 0, 0.72 + i * 0.085 + 0.085, 0.29, trim);
  }
  for (const yy of [0.22, 0.46]) for (const xx of [-0.13, 0.13]) { k.window(0, xx, yy, 0.3, 0.08, false); k.window(2, xx, yy, 0.3, 0.08, false); }
  for (const yy of [0.22, 0.46]) for (const zz of [-0.14, 0.14]) { k.window(1, zz, yy, 0.26, 0.08, false); k.window(3, zz, yy, 0.26, 0.08, false); }
  k.box(0.07, 0.09, 0.02, 0, 0.82, 0.32, '#ffd486', 'win');
  k.door(0, 0, 0.3, true, '#3e5a6a');
  k.chimney(0.16, 0.9, -0.2, 0.26);
  // Maueranker im Giebel, Lastenbalken mit Seil und Haken, Kellerfenster, Wandlaterne (seit 19.10.2026)
  if (!k.fine()) return;
  for (const [x, y] of [[-0.18, 0.78], [0.18, 0.78], [-0.1, 0.9], [0.1, 0.9]]) { k.box(0.008, 0.05, 0.008, x, y - 0.025, 0.317, DARK); k.box(0.032, 0.008, 0.008, x, y, 0.317, DARK); }
  k.box(0.024, 0.024, 0.09, 0, 0.99, 0.34, WOOD); k.cyl(0.003, 0.003, 0.12, 3, 0, 0.87, 0.378, '#d8c8a0'); k.box(0.012, 0.016, 0.006, 0, 0.86, 0.378, DARK);
  for (const x of [-0.13, 0.13]) pane(k, 0, x, 0.02, 0.33, 0.06, 0.03, { lit: false, frame: '#8a857c' });
  wallLamp(k, 0.11, 0.335, 0.3);
}

// Moderne: niedrige helle Häuser mit Holz, Glas, Balkonen und begrünten Dächern statt gestreifter Türme.
// Seit 19.10.2026 mit Fensterrahmen und Blechbänken, Attika, Dachtechnik je Haus (Solar, Gründach, Lüfter und Antenne),
// Balkonen mit Stäben oder Glas, Eingängen mit Vordach, Klingel und Briefkasten, Fallrohren, Fugen, Mülltonnen und Fahrrädern
const ACCENT = ['#e9a48d', '#9fc4b8', '#e8c27f', '#b9c9e0', '#d9a5b3', '#c3cfa8'];
function house7(k, v, w) {
  const tone = ['#f4f1ea', '#ece6dc', '#f3ede6'][w % 3], acc = ACCENT[(v * 2 + w) % ACCENT.length], md = mdet(k);
  if (w === 4) {
    // Moderne Villa: versetzte Kuben, Glas, Holzlamellen, Deck und Becken
    k.plinth(0.62, 0.46, '#d6d0c6', 0, -0.1);
    k.box(0.62, 0.24, 0.42, 0, 0.06, -0.12, '#f4f1ea');
    // Erdgeschoss: Schiebetür aus Glas mit Rahmen, links die Haustür
    k.box(0.42, 0.18, 0.02, 0.08, 0.08, 0.092, GLASS, 'win');
    if (k.fine()) { for (let i = 0; i <= 3; i++) k.box(0.012, 0.18, 0.026, -0.13 + i * 0.14, 0.08, 0.095, ANTH); k.box(0.43, 0.012, 0.026, 0.08, 0.254, 0.095, ANTH); k.box(0.43, 0.01, 0.03, 0.08, 0.074, 0.097, ANTH); }
    mentry(k, -0.235, 0.09, { w: 0.08, h: 0.18, col: md.door, mail: 0, side: 1, cw: 0.15 });
    k.box(0.63, 0.016, 0.03, 0, 0.3, 0.08, CAPC);
    // Obergeschoss: Kubus mit Glasfront hinter Holzlamellen
    k.box(0.4, 0.24, 0.38, -0.1, 0.3, -0.16, ['#f4f1ea', '#e9e2d6', '#4a5058'][v]);
    k.box(0.36, 0.16, 0.02, -0.1, 0.34, 0.032, GLASS, 'win');
    if (k.fine()) { k.box(0.37, 0.012, 0.024, -0.1, 0.5, 0.034, ANTH); k.box(0.38, 0.012, 0.04, -0.1, 0.326, 0.04, SILL); }
    for (let i = 0; i < 6; i++) k.box(0.012, 0.24, 0.025, -0.27 + i * 0.068, 0.3, 0.036, '#c9a27a');
    k.box(0.44, 0.03, 0.42, -0.1, 0.54, -0.16, '#e4dfd6');
    attika(k, 0.44, 0.42, 0.57, '#e4dfd6', { x: -0.1, z: -0.16, h: 0.03 });
    roofKit(k, -0.1, 0.57, -0.16, 0.36, 0.34, md.roof);
    // Terrasse auf dem Erdgeschoss mit Glasgeländer, Kübel und Leuchte
    k.box(0.2, 0.02, 0.4, 0.21, 0.3, -0.12, '#c9a27a');
    railing(k, 0.115, 0.075, 0.305, 0.075, 0.32, false, 0.07);
    railing(k, 0.305, -0.31, 0.305, 0.075, 0.32, false, 0.07);
    planter(k, 0.25, -0.02, 0.8, 0.32);
    wallLamp(k, 0.088, 0.46, 0.03);
    // Deck mit Fugen, Becken mit Leiter, Liege, Hecke, Baum
    k.box(0.62, 0.025, 0.14, 0, 0.0, 0.17, '#c9a27a');
    if (k.fine()) for (let i = 1; i < 6; i++) k.box(0.004, 0.026, 0.14, -0.31 + i * 0.104, 0.0, 0.17, '#a8845e');
    k.box(0.36, 0.03, 0.15, 0.1, 0.0, 0.34, '#e4dfd6'); k.box(0.32, 0.01, 0.11, 0.1, 0.028, 0.34, '#5fc4d4');
    if (k.fine()) for (const dx of [-0.02, 0.02]) { k.box(0.005, 0.05, 0.005, 0.24 + dx, 0.03, 0.288, ALU); k.box(0.005, 0.005, 0.016, 0.24 + dx, 0.078, 0.282, ALU); }
    k.add(new THREE.BoxGeometry(0.06, 0.012, 0.14).rotateX(-0.25).translate(-0.18, 0.06, 0.32), '#f4f4f2');
    k.box(0.03, 0.075, 0.38, 0.37, 0, -0.12, HEDGE);
    downpipe(k, 0.3, 0.1, 0.3);
    tree(k, -0.34, 0.3, 0.7, '#86bd5a');
    return;
  }
  if (w === 3) {
    // drei schmale bunte Reihenhäuser mit Dachgärten
    const Cs = [['#e9a48d', '#f2d49b', '#9fc4b8'], ['#b9c9e0', '#e8c27f', '#d9a5b3'], ['#c3cfa8', '#f3cbb9', '#bdd0dd']][v];
    const tops = [];
    for (let i = 0; i < 3; i++) {
      const x = -0.2 + i * 0.2, h = 0.6 + ((i + v) % 2) * 0.14, top = 0.06 + h;
      tops.push(top);
      k.plinth(0.2, 0.5, '#d6d0c6', x, 0);
      k.box(0.2, h, 0.5, x, 0.06, 0, Cs[i]);
      if (k.fine()) k.box(0.202, 0.008, 0.502, x, 0.3, 0, dk(Cs[i], 0.9));
      mentry(k, x - 0.045, 0.25, { w: 0.068, h: 0.19, col: MDOOR[(i * 3 + md.d * 2 + v) % MDOOR.length], mail: 0, top: true, cw: 0.11 });
      mwin(k, 0, x + 0.053, 0.175, 0.25, 0.052, 0.14);
      mwin(k, 0, x, 0.42, 0.25, 0.14, 0.17, { mull: 1 });
      if ((i + md.d) % 2) railing(k, x - 0.075, 0.27, x + 0.075, 0.27, 0.34, true, 0.06); else flowerBox(k, x, 0.316, 0.25, 0.15);
      if (h > 0.65) mwin(k, 0, x, 0.63, 0.25, 0.14, 0.09);
      mwin(k, 2, x, 0.38, -0.25, 0.13, 0.15);
      k.box(0.21, 0.03, 0.51, x, top, 0, '#f4f1ea');
      attika(k, 0.21, 0.51, top + 0.03, '#f4f1ea', { x, h: 0.03, t: 0.02 });
      const r = (i + md.d) % 3;
      if (r === 0) { k.box(0.16, 0.016, 0.3, x, top + 0.03, -0.05, '#86b06a'); k.ball(0.045, x + 0.03, top + 0.1, -0.1, ['#6aa64f', '#86bd5a', '#7fae5a'][i], null, 0); }
      else if (r === 1) solar(k, x, top + 0.03, -0.06, 1, 2);
      else { vent(k, x - 0.04, top + 0.03, -0.12); acUnit(k, x + 0.01, top + 0.03, 0.08); }
    }
    for (const sx of [-1, 1]) mwin(k, sx > 0 ? 1 : 3, sx * 0.3, 0.38, 0, 0.3, 0.16, { mull: 2 });
    for (const i of [1, 2]) downpipe(k, -0.3 + i * 0.2, 0.258, Math.min(tops[i - 1], tops[i]));
    bins(k, 0.13, 0.36, 3);
    if (md.bike) bike(k, -0.22, 0.37, 0.15, BIKES[(md.d + v) % BIKES.length]); else planter(k, -0.2, 0.33, 0.85);
    return;
  }
  if (v === 0) {
    // Wohnhaus, drei oder vier Geschosse, Balkone, Dachgarten, Treppenhaus auf dem Dach
    const fh = 0.26, fl = 3 + (w % 2), H = fl * fh, top = 0.06 + H;
    k.plinth(0.6, 0.56, '#d6d0c6');
    k.walls(0.6, H, 0.56, 0.06, tone, null);
    for (let f = 0; f < fl; f++) {
      const y = 0.06 + f * fh;
      if (f > 0) glassBand(k, 0.5, y + 0.06, 0.15, 0.282, 4);
      glassBand(k, 0.5, y + 0.06, 0.15, -0.282, 4);
      for (const s of [-1, 1]) mwin(k, s > 0 ? 1 : 3, s * 0.3, y + 0.135, 0, 0.3, 0.14, { mull: 2, frame: '#f2efe8' });
      if (f > 0) { if (k.fine()) k.box(0.612, 0.012, 0.572, 0, y - 0.006, 0, CAPC); balcony(k, 0, y, 0.282, 0.58, 0.12, md.bars, '#e4dfd6'); }
      if (f > 0 && f % 2 === 1 && k.fine()) planter(k, 0.2, 0.36, 0.7, y + 0.022);
    }
    // Erdgeschoss: Haustür mit Briefkästen, zwei Fenster, farbiges Band
    mentry(k, 0, 0.28, { w: 0.11, h: 0.2, col: md.door, mail: 2 });
    for (const s of [-1, 1]) mwin(k, 0, s * 0.19, 0.2, 0.28, 0.12, 0.14);
    k.box(0.12, H - fh, 0.02, -0.24, 0.06 + fh, 0.29, acc);
    // Dach: Attika, Pflanzkasten, Treppenhaus, Technik nach Wahl
    k.box(0.64, 0.04, 0.6, 0, top, 0, '#e4dfd6');
    attika(k, 0.64, 0.6, top + 0.04, '#e4dfd6', { h: 0.04 });
    k.box(0.22, 0.05, 0.16, 0.12, top + 0.04, 0.08, '#9b7450');
    k.ball(0.06, 0.08, top + 0.12, 0.08, '#6aa64f'); k.ball(0.05, 0.17, top + 0.11, 0.07, '#86bd5a');
    k.box(0.15, 0.12, 0.13, 0.17, top + 0.04, -0.18, tone); k.box(0.16, 0.014, 0.14, 0.17, top + 0.16, -0.18, CAPC);
    if (k.fine()) k.box(0.055, 0.09, 0.008, 0.17, top + 0.04, -0.113, ANTH);
    roofKit(k, -0.11, top + 0.04, -0.1, 0.36, 0.26, md.roof);
    for (const s of [-1, 1]) downpipe(k, s * 0.305, -0.25, top);
    // vor dem Haus: Fahrradbügel, Tonnen
    bikeRack(k, -0.22, 0.34, 2);
    if (md.bike) bike(k, -0.22, 0.352, 0, BIKES[(md.d * 2 + w) % BIKES.length]);
    bins(k, 0.14, 0.37, 3);
    return;
  }
  if (v === 1) {
    // Einfamilienhaus mit Pultdach, Holzverschalung und großem Fenster
    k.plinth(0.58, 0.5, '#d6d0c6');
    k.walls(0.58, 0.5, 0.5, 0.06, tone, null);
    k.box(0.3, 0.5, 0.02, 0.14, 0.06, 0.255, '#c9a27a');
    for (let i = 0; i < 6; i++) k.box(0.008, 0.5, 0.026, 0.0 + i * 0.056, 0.06, 0.258, '#a8845e');
    // Pultdach fällt nach vorn: Rinne mit Fallrohr, Solarfeld oder Schornsteinrohr auf der Fläche
    const roofG = (g, c) => k.add(g.rotateX(0.22).translate(0, 0.62, 0), c);
    roofG(new THREE.BoxGeometry(0.66, 0.04, 0.6), '#6d7680');
    if (k.fine()) roofG(new THREE.BoxGeometry(0.67, 0.012, 0.026).translate(0, 0.022, -0.29), '#5d6670');
    k.box(0.66, 0.022, 0.03, 0, 0.52, 0.31, ZINC2);
    downpipe(k, 0.305, 0.3, 0.53);
    if (md.roof === 'solar') for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      roofG(new THREE.BoxGeometry(0.11, 0.008, 0.14).translate(-0.18 + i * 0.12, 0.026, -0.08 + j * 0.16), '#2f4b66');
      if (k.fine()) roofG(new THREE.BoxGeometry(0.11, 0.012, 0.006).translate(-0.18 + i * 0.12, 0.026, -0.08 + j * 0.16), '#8fa6bd');
    }
    else roofG(new THREE.BoxGeometry(0.1, 0.012, 0.1).translate(-0.12, 0.026, -0.05), GLASS);
    if (k.fine()) { k.cyl(0.014, 0.014, 0.17, 6, -0.2, 0.62, -0.18, ALU); k.cone(0.026, 0.03, 6, -0.2, 0.79, -0.18, ALU); }
    k.box(0.58, 0.12, 0.02, 0, 0.56, -0.255, tone);
    for (const xx of [-0.15, 0.15]) mwin(k, 2, xx, 0.29, -0.25, 0.16, 0.18, { mull: 1, sill: '#a8845e' });
    for (const s of [-1, 1]) mwin(k, s > 0 ? 1 : 3, s * 0.29, 0.28, 0, 0.2, 0.16, { mull: 1 });
    glassBand(k, 0.22, 0.12, 0.36, 0.256, 2);
    mentry(k, -0.19, 0.25, { w: 0.1, h: 0.2, col: md.door, mail: 0, side: -1 });
    // Garten: Deck mit Fugen, Briefkasten am Pfosten, Pflanzen, Leuchte, Tonnen an der Seite
    k.box(0.5, 0.025, 0.2, 0, 0.0, 0.36, '#c9a27a');
    if (k.fine()) {
      for (let i = 1; i < 5; i++) k.box(0.004, 0.026, 0.2, -0.25 + i * 0.1, 0.0, 0.36, '#a8845e');
      k.box(0.012, 0.06, 0.012, -0.36, 0, 0.34, ANTH); k.box(0.04, 0.03, 0.05, -0.36, 0.06, 0.34, md.door === '#f2efe8' ? ANTH : md.door);
    }
    k.ball(0.06, -0.3, 0.06, 0.32, '#6aa64f'); k.ball(0.05, 0.3, 0.05, 0.34, '#86bd5a');
    k.lantern(0.32, 0.3, 0.3);
    bins(k, 0.36, -0.12, 3, -Math.PI / 2);
    if (md.bike) bike(k, 0.37, 0.12, Math.PI / 2, BIKES[(md.d + 2) % BIKES.length]);
    return;
  }
  // Stadthaus mit farbigen Paneelen und Dachterrasse mit Pergola
  const fl = 2 + (w % 3 === 0 ? 1 : 0), fh = 0.28, H = fl * fh, top = 0.06 + H, jc = dk(acc, 0.86);
  k.plinth(0.56, 0.56, '#d6d0c6');
  k.walls(0.56, H, 0.56, 0.06, acc, null);
  // Fugen zwischen den Paneelen, Geschossfugen rundum
  const ys = []; for (let f = 1; f < fl; f++) ys.push(0.06 + f * fh);
  for (const face of [0, 2]) joints(k, face, 0.56, face ? 0.06 : 0.06 + fh, face ? H : H - fh, 0.28, 2, [], jc);
  for (const face of [1, 3]) for (const s of [-1, 1]) fgeo(k, face, new THREE.BoxGeometry(0.006, H, 0.006), s * 0.15, 0.06 + H / 2, 0.281, jc);
  for (const y of ys) k.box(0.566, 0.006, 0.566, 0, y - 0.003, 0, jc);
  for (let f = 0; f < fl; f++) {
    const y = 0.06 + f * fh;
    for (const xx of f ? [-0.14, 0.14] : [-0.19, 0.19]) {
      mwin(k, 0, xx, y + 0.14, 0.28, f ? 0.17 : 0.12, 0.17, { frame: tone, mull: 1 });
      if (f) { if (md.bars) railing(k, xx - 0.09, 0.3, xx + 0.09, 0.3, y + 0.04, true, 0.07); else flowerBox(k, xx, y + 0.038, 0.28, 0.17); }
    }
    for (const s of [-1, 1]) mwin(k, s > 0 ? 1 : 3, s * 0.28, y + 0.14, 0, 0.17, 0.15, { frame: tone });
    for (const xx of [-0.14, 0.14]) mwin(k, 2, xx, y + 0.14, -0.28, 0.17, 0.15, { frame: tone });
  }
  mentry(k, 0, 0.28, { w: 0.11, h: 0.2, col: md.door, mail: 1 });
  downpipe(k, -0.27, 0.29, top);
  // Dachterrasse: Geländer, Pergola, Tisch mit Stühlen, Kübel, Klimagerät
  k.box(0.6, 0.035, 0.6, 0, top, 0, tone);
  const ty = top + 0.035;
  railing(k, -0.29, 0.29, 0.29, 0.29, ty, md.bars, 0.07); railing(k, -0.29, -0.29, -0.29, 0.29, ty, md.bars, 0.07); railing(k, 0.29, -0.29, 0.29, 0.29, ty, md.bars, 0.07);
  for (const xx of [-0.22, 0.22]) for (const zz of [-0.22, 0.22]) k.box(0.02, 0.16, 0.02, xx, top + 0.03, zz, '#a8845e');
  for (let i = 0; i < 6; i++) k.box(0.46, 0.012, 0.025, 0, top + 0.19, -0.2 + i * 0.08, '#a8845e');
  if (k.fine()) {
    k.cyl(0.035, 0.035, 0.008, 8, -0.05, ty + 0.05, 0.02, '#f4f1ea'); k.cyl(0.006, 0.006, 0.05, 4, -0.05, ty, 0.02, ANTH);
    for (const s of [-1, 1]) k.box(0.03, 0.035, 0.03, -0.05 + s * 0.06, ty, 0.02, '#5fa8a0');
  }
  planter(k, 0.12, 0.24, 0.9, ty); planter(k, -0.14, 0.24, 0.9, ty);
  k.ball(0.05, 0.16, ty + 0.1, -0.12, '#6aa64f');
  acUnit(k, 0, ty, -0.24);
  bins(k, 0.13, 0.37, 2);
  if (md.bike) bike(k, -0.2, 0.37, 0, BIKES[(md.d + w) % BIKES.length]);
}

// Mehr Hausformen je Epoche (seit 17.10.2026), gewählt über Spielart v und Hausnummer w:
// Kuppelhütte, Langhaus, Bauernhaus, Winkelhaus, Hofhaus im Süden, Stadthaus mit Außentreppe, Fachwerk mit Überhang,
// zwei schmale Giebelhäuser, Villa, Giebelhaus mit Treppengiebel, viktorianische Villa, moderne Villa mit Becken, bunte Reihenhäuser
function houseVariant(k, L, v, w) {
  const plaster = PLASTER[(v * 3 + w) % PLASTER.length];
  if (L === 0 && v === 2) {
    // Kuppelhütte aus Ästen, mit Fellen gedeckt
    k.add(domeG(0.27, 10, 4, 0.85), '#a8865f');
    for (let i = 0; i < 6; i++) { const a = i * 1.05 + 0.4; k.add(new THREE.IcosahedronGeometry(0.075, 0).scale(1, 0.45, 1).translate(Math.cos(a) * 0.19, 0.14 + (i % 2) * 0.03, Math.sin(a) * 0.19), i % 2 ? '#8a6a4c' : '#c9a27a'); }
    for (let i = 0; i < 4; i++) k.cyl(0.006, 0.006, 0.12, 3, Math.cos(i * 1.6) * 0.03, 0.2, Math.sin(i * 1.6) * 0.03, DARK);
    k.box(0.1, 0.12, 0.05, 0, 0, 0.24, '#4a3a2c');
    for (let i = 0; i < 5; i++) k.ball(0.035, 0.32 + Math.cos(i * 1.25) * 0.06, 0.015, 0.22 + Math.sin(i * 1.25) * 0.06, '#8f8a82', null, 0);
    k.cone(0.03, 0.06, 5, 0.32, 0, 0.22, '#ff9b3d', 'glow');
    return true;
  }
  if (L === 1 && v === 2) {
    // Langhaus mit Flechtwänden und tief gezogenem Strohdach, daneben ein Kornspeicher
    k.box(0.62, 0.17, 0.34, 0, 0, 0, '#c9a27a');
    for (let i = 0; i < 6; i++) k.box(0.025, 0.17, 0.36, -0.28 + i * 0.112, 0, 0, '#9b7450');
    frustum(k, 0.78, 0.5, 0.3, 0.28, 0.14, THATCH[w % 2][0]);
    k.box(0.24, 0.05, 0.1, 0, 0.42, 0, THATCH[w % 2][2]);
    k.box(0.1, 0.13, 0.02, -0.08, 0, 0.176, '#6e543e');
    k.box(0.06, 0.05, 0.02, 0.16, 0.07, 0.176, '#ffd486', 'win');
    k.smoke.push([0.1, 0.5, 0]);
    k.cyl(0.07, 0.08, 0.1, 8, 0.38, 0, 0.3, '#b98f62'); k.cone(0.1, 0.1, 8, 0.38, 0.1, 0.3, THATCH[0][1]);
    return true;
  }
  if (L === 2 && v === 2 && w >= 2) {
    // Bauernhaus: Steinsockel, Fachwerk oben, steiles Strohdach mit Ladeluke
    k.plinth(0.6, 0.46);
    k.walls(0.6, 0.22, 0.46, 0.06, STONE[(w + 1) % 3], null);
    k.box(0.6, 0.22, 0.46, 0, 0.28, 0, '#efe2c6'); k.beams(0.6, 0.22, 0.46, 0.28);
    for (const x of [-0.15, 0.15]) k.add(new THREE.BoxGeometry(0.02, 0.24, 0.015).rotateZ(x < 0 ? 0.6 : -0.6).translate(x, 0.39, 0.232), WOOD);
    k.roof(0.6, 0.46, 0.4, 0.5, THATCH[w % 2], { rows: 5, gable: '#e8d8b8', moss: 0.12 });
    k.box(0.02, 0.1, 0.1, 0.305, 0.56, 0, WOOD);
    k.door(0, -0.12, 0.23, true);
    k.window(0, 0.14, 0.18, 0.23, 0.08); k.window(0, -0.02, 0.4, 0.23, 0.07); k.window(0, 0.2, 0.4, 0.23, 0.07, false);
    k.window(2, 0, 0.3, 0.23, 0.08, false);
    k.chimney(-0.18, 0.6, -0.08, 0.3);
    k.lantern(0.36, 0.3, 0.3);
    return true;
  }
  if (L === 2 && w === 1) {
    // Winkelhaus: zwei Flügel um einen kleinen Hof mit Fass und Holz
    k.plinth(0.5, 0.36, STONE[1], -0.06, -0.08);
    k.walls(0.5, 0.28, 0.36, 0.06, '#efe2c6', null, -0.06, -0.08); k.beams(0.5, 0.28, 0.36, 0.06, -0.06, -0.08);
    k.roof(0.5, 0.36, 0.28, 0.34, THATCH[v % 2], { rows: 4, gable: '#e8d8b8', x: -0.06, z: -0.08 });
    k.plinth(0.24, 0.3, STONE[1], 0.25, 0.18);
    k.walls(0.24, 0.24, 0.3, 0.06, '#e9dcc0', null, 0.25, 0.18); k.beams(0.24, 0.24, 0.3, 0.06, 0.25, 0.18);
    k.roof(0.3, 0.24, 0.2, 0.3, THATCH[(v + 1) % 2], { rows: 3, gable: '#e8d8b8', ry: Math.PI / 2, x: 0.25, z: 0.18 });
    k.door(0, -0.14, 0.1, false); k.window(0, 0.02, 0.2, 0.1, 0.08);
    k.window(3, 0.18, 0.18, -0.13, 0.07);
    k.chimney(-0.2, 0.42, -0.14, 0.28);
    barrel(k, 0.02, 0.3);
    for (let i = 0; i < 3; i++) k.add(new THREE.CylinderGeometry(0.025, 0.025, 0.2, 6).rotateZ(Math.PI / 2).translate(-0.22, 0.025 + (i === 2 ? 0.045 : 0), 0.3 + (i % 2) * 0.05 - (i === 2 ? -0.025 : 0)), '#9a6b44');
    return true;
  }
  if (L === 3 && v === 2) {
    // Hofhaus im Süden: Pultdach hinten, Dachterrasse mit Weinlaube, Außentreppe, blaue Tür, Kübelpflanzen
    const wall = ['#efe5d1', '#f3e3c8', '#e8d8c0', '#f0dcb8', '#efe2c6'][w];
    k.plinth(0.6, 0.48);
    k.box(0.6, 0.4, 0.48, 0, 0.06, 0, wall);
    k.box(0.62, 0.03, 0.5, 0, 0.46, 0, '#e8dfcf');
    k.add(new THREE.BoxGeometry(0.66, 0.035, 0.3).rotateX(-0.32).translate(0, 0.53, -0.13), TERRA[w % 2][0]);
    k.box(0.6, 0.06, 0.02, 0, 0.47, 0.03, wall);
    for (const x of [-0.24, 0.24]) k.box(0.02, 0.18, 0.02, x, 0.49, 0.2, WOOD);
    for (let i = 0; i < 4; i++) k.box(0.02, 0.02, 0.22, -0.18 + i * 0.12, 0.66, 0.1, WOOD);
    for (let i = 0; i < 4; i++) k.ball(0.045, -0.2 + i * 0.13, 0.68, 0.1 + (i % 2) * 0.06, ['#6f9e52', '#86b06a', '#7fae5a'][i % 3], null, 0);
    for (let i = 0; i < 6; i++) k.box(0.1, 0.067 * (i + 1), 0.07, 0.35, 0, 0.2 - i * 0.07, wall);
    k.door(0, -0.12, 0.24, true, '#3e6a8a');
    k.window(0, 0.13, 0.24, 0.24, 0.08);
    k.window(2, 0, 0.26, 0.24, 0.08, false);
    pot(k, 0.06, 0.32, 1.3, '#c9774f'); k.ball(0.04, 0.06, 0.13, 0.32, '#6aa64f', null, 0);
    pot(k, -0.26, 0.32, 1.1, '#b8693f'); k.ball(0.035, -0.26, 0.11, 0.32, '#e0679a', null, 0);
    return true;
  }
  if (L === 3 && w === 4) {
    // Stadthaus mit Außentreppe zur oberen Tür
    const wall = STONE[(v + 2) % 3];
    k.plinth(0.5, 0.46, STONE[1], -0.04, 0);
    k.walls(0.5, 0.52, 0.46, 0.06, wall, '#c9b998', -0.04, 0);
    k.roof(0.5, 0.46, 0.24, 0.58, ROOF_MIX[(v * 4 + 1) % ROOF_MIX.length], { rows: 5, gable: wall, x: -0.04, moss: 0.18 });
    for (let i = 0; i < 4; i++) k.box(0.075, 0.075 * (i + 1), 0.1, 0.3 - i * 0.075, 0, 0.29, wall);
    k.box(0.12, 0.3, 0.1, 0.0, 0, 0.29, wall);
    k.box(0.1, 0.16, 0.02, 0.0, 0.3, 0.232, WOOD); k.add(semi(0.05, 0.02, 7).translate(0.0, 0.46, 0.232), WOOD);
    k.box(0.08, 0.12, 0.02, -0.19, 0.06, 0.232, '#5a4a3c');
    k.window(0, -0.18, 0.42, 0.23, 0.08); k.window(2, -0.04, 0.36, 0.23, 0.08, false);
    k.window(3, 0, 0.36, 0.29, 0.08, false);
    k.chimney(-0.2, 0.6, -0.1, 0.3);
    return true;
  }
  if (L === 4 && w === 1) {
    // Fachwerkhaus mit vorkragendem Obergeschoss
    const roofC = ROOF_MIX[(v * 2 + 5) % ROOF_MIX.length];
    k.plinth(0.54, 0.44); k.walls(0.54, 0.28, 0.44, 0.06, STONE[(v + 1) % 3], '#c9b998');
    k.box(0.58, 0.28, 0.5, 0, 0.34, 0.02, plaster);
    for (const x of [-0.28, -0.14, 0, 0.14, 0.28]) k.box(0.022, 0.28, 0.02, x, 0.34, 0.272, WOOD);
    for (const y of [0.34, 0.6]) k.box(0.6, 0.022, 0.02, 0, y, 0.272, WOOD);
    for (const x of [-0.21, 0.21]) k.add(new THREE.BoxGeometry(0.016, 0.18, 0.014).rotateZ(x < 0 ? 0.55 : -0.55).translate(x, 0.47, 0.275), WOOD);
    for (const x of [-0.25, 0.25]) k.box(0.03, 0.04, 0.05, x, 0.3, 0.24, WOOD);
    k.roof(0.58, 0.5, 0.36, 0.62, roofC, { rows: 5, gable: plaster, z: 0.02, moss: 0.2 });
    k.window(0, -0.07, 0.48, 0.28, 0.075); k.window(0, 0.07, 0.48, 0.28, 0.075, false);
    k.door(0, -0.14, 0.22); k.window(0, 0.12, 0.2, 0.22, 0.08);
    k.window(2, 0, 0.46, 0.26, 0.08, false);
    k.chimney(0.18, 0.8, -0.1, 0.3);
    k.lantern(-0.34, 0.28);
    return true;
  }
  if (L === 4 && w === 3) {
    // zwei schmale Giebelhäuser nebeneinander, Giebel zur Gasse
    for (const i of [0, 1]) {
      const x = i ? 0.16 : -0.16, pl = PLASTER[(v * 2 + w + i * 3) % PLASTER.length], rc = ROOF_MIX[(v + i * 3 + 2) % ROOF_MIX.length], h = 0.56 + i * 0.08;
      k.plinth(0.3, 0.5, STONE[1], x, 0);
      k.walls(0.3, h, 0.5, 0.06, pl, i ? null : STONE[1], x, 0);
      k.roof(0.5, 0.3, 0.28, 0.06 + h, rc, { rows: 5, gable: pl, ry: Math.PI / 2, x, moss: 0.15 });
      k.door(0, x - 0.06, 0.25, true, ['#5b4a6e', '#3e6a8a'][i]);
      pane(k, 0, x + 0.07, 0.2, 0.25, 0.06, 0.09);
      k.window(0, x, 0.44, 0.25, 0.075, i === 0);
      pane(k, 0, x, 0.06 + h + 0.09, 0.25, 0.05, 0.07);
      k.window(2, -x, 0.38, 0.25, 0.08, false);
    }
    k.chimney(0.2, 0.8, -0.12, 0.26);
    return true;
  }
  if (L === 5 && v === 2 && w !== 3) {
    // Villa: symmetrisch, Walmdach, Säulenportal mit Giebel, zwei Schornsteine
    const pl = PLASTER[(w * 2 + 3) % PLASTER.length];
    k.plinth(0.62, 0.5); k.walls(0.62, 0.56, 0.5, 0.06, pl, STONE[0]);
    k.box(0.66, 0.03, 0.54, 0, 0.62, 0, '#f4ece0');
    frustum(k, 0.66, 0.54, 0.24, 0.35, 0.65, SLATE[w % 2][0]);
    k.box(0.24, 0.02, 0.2, 0, 0.89, 0, SLATE[w % 2][2]);
    for (const sx of [-1, 1]) k.chimney(sx * 0.2, 0.76, 0, 0.26);
    for (const sx of [-1, 1]) column(k, sx * 0.08, 0.06, 0.3, 0.3, 0.018);
    k.box(0.24, 0.03, 0.1, 0, 0.36, 0.29, '#f4ece0');
    prism(k, 0.1, 0.26, 0.08, 0.39, '#f4ece0', 0, 0.29, Math.PI / 2);
    k.door(0, 0, 0.25, true, '#5b4a6e');
    for (const x of [-0.2, 0.2]) for (const y of [0.22, 0.46]) k.window(0, x, y, 0.25, 0.08, y < 0.3);
    for (const x of [-0.15, 0.15]) k.window(2, x, 0.34, 0.25, 0.08, false);
    pane(k, 1, 0.31, 0.34, 0, 0.06, 0.1); pane(k, 3, -0.31, 0.34, 0, 0.06, 0.1);
    k.box(0.26, 0.03, 0.06, 0, 0, 0.36, STONE[0]);
    return true;
  }
  if (L === 5 && w === 3) {
    // Giebelhaus mit Treppengiebel zur Straße, goldene Spitze
    const pl = PLASTER[(v * 3 + 2) % PLASTER.length], tr = '#f4ece0';
    k.plinth(0.46, 0.56); k.walls(0.46, 0.66, 0.56, 0.06, pl, STONE[0]);
    k.roof(0.56, 0.46, 0.34, 0.72, SLATE[v % 2], { rows: 5, gable: pl, ry: Math.PI / 2 });
    for (const [ww, y, hh] of [[0.46, 0.72, 0.14], [0.3, 0.86, 0.14], [0.16, 1.0, 0.1]]) { k.box(ww, hh, 0.04, 0, y, 0.28, pl); k.box(ww + 0.02, 0.02, 0.05, 0, y, 0.285, tr); }
    for (const sx of [-1, 1]) { k.ball(0.022, sx * 0.23, 0.88, 0.29, tr, null, 0); k.ball(0.02, sx * 0.15, 1.02, 0.29, tr, null, 0); }
    k.box(0.1, 0.03, 0.05, 0, 1.1, 0.28, tr); k.ball(0.02, 0, 1.15, 0.28, GOLD, null, 0);
    for (const x of [-0.12, 0.12]) { k.window(0, x, 0.46, 0.28, 0.08, true); k.window(2, x, 0.4, 0.28, 0.08, false); }
    pane(k, 0, 0.12, 0.22, 0.28, 0.08, 0.1);
    pane(k, 0, 0, 0.8, 0.3, 0.06, 0.09); pane(k, 0, 0, 0.94, 0.3, 0.04, 0.06);
    k.door(0, -0.1, 0.28, true, '#2f4b66');
    k.chimney(0.12, 0.9, -0.16, 0.28);
    return true;
  }
  return false;
}

function zentrum(k, L, v, gov, col) {
  const banner = (x, z, hgt = 0.7) => { k.cyl(0.012, 0.012, hgt, 4, x, 0, z, DARK); k.box(0.18, 0.12, 0.01, x + 0.09, hgt - 0.14, z, col); };
  if (L <= 1) {
    for (let a = 0; a < 8; a++) k.ball(0.07, Math.cos(a * 0.8) * 0.22, 0.03, Math.sin(a * 0.8) * 0.22, '#9a948b', null, 0);
    k.cone(0.1, 0.24, 6, 0, 0, 0, '#ff9b3d', 'glow');
    k.cone(0.06, 0.16, 6, 0.03, 0.05, 0.02, '#ffd36a', 'glow');
    k.box(0.42, 0.06, 0.08, 0, 0, 0.4, WOOD2, null, 0.2);
    k.box(0.42, 0.06, 0.08, 0, 0, -0.4, WOOD2, null, -0.2);
    k.cyl(0.05, 0.06, 0.72, 6, 0.4, 0, 0.1, WOOD2);
    for (let i = 0; i < 3; i++) k.box(0.13, 0.06, 0.03, 0.4, 0.3 + i * 0.13, 0.13, [col, '#e9c46a', '#5fa8a0'][i]);
    k.ball(0.06, 0.4, 0.76, 0.1, '#e9b44c');
    k.smoke.push([0, 0.35, 0]);
    return;
  }
  if (L === 2) {
    k.plinth(0.9, 0.5);
    k.walls(0.9, 0.34, 0.5, 0.06, '#efe2c6', null);
    k.beams(0.9, 0.34, 0.5, 0.06);
    k.roof(0.9, 0.5, 0.34, 0.4, THATCH[v % 2], { rows: 5, gable: '#e8d8b8' });
    k.door(0, 0, 0.25);
    k.window(0, -0.28, 0.22, 0.25); k.window(0, 0.28, 0.22, 0.25);
    banner(0.52, 0.32);
    k.smoke.push([0.25, 0.85, 0]);
    k.lantern(-0.5, 0.3);
    return;
  }
  if (gov === 'theokratie') {
    k.plinth(0.8, 0.8);
    k.walls(0.62, 0.55, 0.62, 0.06, '#f4ecdc');
    k.dome(0.34, 0, 0.61, 0, '#e9b44c');
    k.cyl(0.02, 0.02, 0.3, 4, 0, 0.92, 0, '#e9b44c');
    k.ball(0.05, 0, 1.24, 0, '#ffe08a', 'glow');
    k.window(0, 0, 0.3, 0.31, 0.11, false); k.window(2, 0, 0.3, 0.31, 0.11, false);
    k.door(1, 0, 0.31);
    return;
  }
  if (L === 3) {
    k.box(1.0, 0.08, 0.8, 0, 0, 0, STONE[1]);
    for (const x of [-0.36, -0.12, 0.12, 0.36]) k.cyl(0.045, 0.05, 0.42, 10, x, 0.08, 0.28, '#f4eee2');
    k.walls(0.86, 0.42, 0.42, 0.08, STONE[2], null);
    k.box(0.98, 0.06, 0.74, 0, 0.5, 0, '#e8dfcf');
    k.roof(0.98, 0.74, 0.18, 0.56, TERRA[v % 2], { rows: 5, gable: '#efe6d6', over: 0.02 });
    banner(0.52, 0.42, 0.95);
    return;
  }
  if (L <= 5) {
    // Bergfried mit zwei Rundtürmen wie im Märchen
    const wall = L === 4 ? '#e9a48d' : PLASTER[(v + 4) % PLASTER.length];
    const roofC = SLATE[gov === 'koenigtum' || gov === 'diktatur' ? 0 : 1];
    k.plinth(0.8, 0.5);
    k.walls(0.8, 0.62, 0.5, 0.06, wall);
    k.roof(0.8, 0.5, 0.36, 0.68, roofC, { rows: 6, gable: wall, moss: 0.15 });
    k.tower(-0.42, 0.18, 0.16, 0.95, wall, roofC);
    k.tower(0.42, 0.18, 0.14, 0.82, wall, roofC);
    k.door(0, 0, 0.25);
    k.window(0, -0.2, 0.45, 0.25); k.window(0, 0.2, 0.45, 0.25); k.window(0, 0.2, 0.2, 0.25);
    k.window(2, 0, 0.35, 0.25);
    banner(0.0, -0.28, 1.35);
    k.lantern(0.3, 0.38); k.lantern(-0.3, 0.38);
    return;
  }
  if (L === 6) {
    k.plinth(0.9, 0.56, '#9a958c');
    k.walls(0.9, 0.6, 0.56, 0.06, '#b0654a', '#e8dcc6');
    k.roof(0.9, 0.56, 0.24, 0.66, SLATE[0], { rows: 5, gable: '#b0654a' });
    k.walls(0.28, 1.5, 0.28, 0.06, '#c9a27a', '#e8dcc6');
    k.coneRoof(0.24, 0.45, 1.56, SLATE[1], 0, 0, 4);
    k.add(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 16).rotateX(Math.PI / 2).translate(0, 1.25, 0.145), '#fff6dc', 'glow');
    for (const xx of [-0.3, 0.3]) k.window(0, xx, 0.35, 0.28, 0.09, false);
    return;
  }
  k.plinth(0.75, 0.75, '#d6d0c6');
  k.walls(0.7, 2.4, 0.7, 0.06, '#eef1f2', null);
  for (let y = 0.25; y < 2.4; y += 0.22) k.box(0.71, 0.1, 0.71, 0, y, 0, '#8fbcd0', 'win');
  k.box(0.6, 0.06, 0.6, 0, 2.46, 0, '#86b06a');
  k.cyl(0.02, 0.04, 0.7, 6, 0, 2.5, 0, '#cfd6da');
  k.ball(0.05, 0, 3.24, 0, '#ff6b5a', 'glow');
  // Seit 19.10.2026: helle Lisenen über die Glasbänder, Attika, Technik auf dem Dach, gläserner Eingang mit Vordach, drei Fahnen
  attika(k, 0.7, 0.7, 2.46, '#eef1f2', { h: 0.05 });
  acUnit(k, -0.2, 2.52, -0.2); acUnit(k, 0.2, 2.52, -0.18, Math.PI); vent(k, 0.2, 2.52, 0.2);
  k.box(0.2, 0.15, 0.02, 0, 0.06, 0.352, GLASS, 'win');
  if (k.fine()) {
    for (let f = 0; f < 4; f++) for (let i = 0; i < 5; i++) fgeo(k, f, new THREE.BoxGeometry(0.014, 2.16, 0.016), -0.24 + i * 0.12, 1.33, 0.357, '#dfe4e6');
    for (const x of [-0.1, 0, 0.1]) k.box(0.014, 0.15, 0.026, x, 0.06, 0.356, ANTH);
  }
  k.box(0.32, 0.016, 0.14, 0, 0.22, 0.42, CAPC); k.box(0.04, 0.006, 0.04, 0, 0.215, 0.42, '#fff1c8', 'glow');
  k.box(0.3, 0.02, 0.08, 0, 0.04, 0.4, '#cfcac2');
  for (const x of [-0.24, 0, 0.24]) flag(k, x, 0.44, 0.46, x ? col : '#f4f1ea', 0, 0.12);
}

// Felder: Ackerfurchen mit Pflanzen statt glatter Balken. v 0 Getreide, 1 Gemüse, 2 Flachs (blau blühend)
function feld(k, v, season, mask) {
  k.box(0.98, 0.03, 0.98, 0, -0.012, 0, '#9a7a56');
  const rows = 5;
  for (let i = 0; i < rows; i++) {
    const z = -0.38 + i * 0.19;
    k.box(0.9, 0.022, 0.12, 0, 0.012, z, season === 0 ? (i % 2 ? '#9db866' : '#93ad5e') : i % 2 ? '#a8865f' : '#a07e58');
    if (season === 3) continue;
    if (v === 0 && season === 1) {
      // reifes Getreide als dichte goldene Reihe mit Ähren obenauf
      k.box(0.86, 0.12, 0.11, 0, 0.03, z, i % 2 ? '#e2c25a' : '#d9b850');
      for (let j = 0; j < 9; j++) k.add(new THREE.IcosahedronGeometry(0.024, 0).scale(0.8, 1.5, 0.8).translate(-0.4 + j * 0.1 + (k.rnd() - 0.5) * 0.04, 0.16, z + (k.rnd() - 0.5) * 0.05), ['#f0d880', '#e8cc6a'][j % 2]);
      continue;
    }
    const n = 7;
    for (let j = 0; j < n; j++) {
      const x = -0.39 + j * 0.13 + (k.rnd() - 0.5) * 0.03, zz = z + (k.rnd() - 0.5) * 0.03;
      if (season === 0) {
        k.add(new THREE.IcosahedronGeometry(0.04 + k.rnd() * 0.012, 0).scale(1, 0.75, 1).translate(x, 0.05, zz), ['#9cd06d', '#8cc25c', '#a8d878'][j % 3]);
      } else if (v === 0) {
        if (season === 2) { k.box(0.11, 0.035, 0.07, x, 0.02, zz, '#d8bd72'); continue; }
        k.add(new THREE.ConeGeometry(0.05, 0.17, 5).translate(x, 0.105, zz), ['#e2c25a', '#d6b24e', '#e9cd6e'][j % 3]);
        k.add(new THREE.IcosahedronGeometry(0.022, 0).scale(0.8, 1.4, 0.8).translate(x, 0.19, zz), '#f0d880');
      } else if (v === 1) {
        if (season === 2 && j % 2) { k.add(new THREE.IcosahedronGeometry(0.045, 1).scale(1, 0.75, 1).translate(x, 0.05, zz), '#e98a3a'); continue; }
        k.add(new THREE.IcosahedronGeometry(0.048, 1).scale(1, 0.7, 1).translate(x, 0.05, zz), ['#86bd5a', '#9fcf74', '#7ab05a'][j % 3]);
        k.add(new THREE.IcosahedronGeometry(0.026, 0).translate(x, 0.08, zz), '#c4e39a');
      } else {
        k.add(new THREE.ConeGeometry(0.045, 0.12, 5).translate(x, 0.08, zz), season === 2 ? '#c8b070' : '#7fae64');
        if (season === 1) k.add(new THREE.IcosahedronGeometry(0.03, 0).scale(1, 0.6, 1).translate(x, 0.15, zz), ['#8fb3e8', '#a9c2f0', '#7fa2de'][j % 3]);
      }
    }
  }
  // Zaun an den Seiten ohne Nachbarfeld
  const posts = (x0, z0, x1, z1) => {
    for (let t = 0; t <= 1.001; t += 0.25) k.cyl(0.012, 0.014, 0.16, 4, x0 + (x1 - x0) * t, 0, z0 + (z1 - z0) * t, WOOD2);
    const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(z1 - z0, x1 - x0);
    for (const y of [0.07, 0.13]) k.box(len, 0.015, 0.015, (x0 + x1) / 2, y, (z0 + z1) / 2, WOOD2, null, -ang);
  };
  if (mask & 1) posts(0.49, -0.49, 0.49, 0.49);
  if (mask & 2) posts(-0.49, -0.49, -0.49, 0.49);
  if (mask & 4) posts(-0.49, 0.49, 0.49, 0.49);
  if (mask & 8) posts(-0.49, -0.49, 0.49, -0.49);
  if (v === 0 && season === 2) for (const [x, z] of [[-0.22, -0.1], [0.24, 0.2]]) k.add(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 10).rotateZ(Math.PI / 2).translate(x, 0.07, z), '#e2c36e');
  if (v === 0 && season !== 3) { k.cyl(0.012, 0.012, 0.3, 4, 0.3, 0, 0.3, DARK); k.box(0.16, 0.025, 0.025, 0.3, 0.22, 0.3, DARK); k.ball(0.04, 0.3, 0.32, 0.3, '#d8b46a'); }
}

function hut(k, L, v, roofCols) {
  if (L >= 6) { k.plinth(0.5, 0.4, '#9a958c'); k.walls(0.5, 0.36, 0.4, 0.06, '#b0654a', '#e8dcc6'); k.roof(0.5, 0.4, 0.18, 0.42, SLATE[0], { rows: 3, gable: '#b0654a' }); k.window(0, 0, 0.2, 0.2, 0.08, false); return; }
  if (L >= 3) { k.plinth(0.46, 0.38); k.walls(0.46, 0.3, 0.38, 0.06, STONE[v % 3], '#c9b998'); k.roof(0.46, 0.38, 0.2, 0.36, roofCols || TERRA[v % 2], { rows: 4, gable: STONE[0] }); k.window(0, 0, 0.2, 0.19, 0.08); return; }
  k.plinth(0.44, 0.36); k.walls(0.44, 0.26, 0.36, 0.06, '#e6d6b6', null); k.beams(0.44, 0.26, 0.36, 0.06); k.roof(0.44, 0.36, 0.22, 0.32, THATCH[v % 2], { rows: 3, gable: '#e0cfaa' });
}

const BUILDERS = {
  fischer(k, L, v) {
    hut(k, L, v, SLATE[1]);
    k.cyl(0.012, 0.012, 0.36, 4, 0.36, 0, 0.3, WOOD2); k.cyl(0.012, 0.012, 0.36, 4, 0.36, 0, -0.1, WOOD2);
    k.box(0.015, 0.22, 0.38, 0.36, 0.12, 0.1, '#6c7d72');
    for (let i = 0; i < 2; i++) k.cyl(0.05, 0.05, 0.1, 8, -0.3 + i * 0.1, 0, 0.32, WOOD2);
  },
  // Holzfäller (Runde 2, 24.10.2026): Lager mit Unterstand, Sägewerk mit Wasserrad, Dampfsägewerk, Holzhof der Moderne
  holz(k, L, v) {
    if (L >= 7) {
      // Holzhof: Halle aus Wellblech mit Rolltor, Brettschichtholz in Folie, Stammlager mit Ladekran, Stapler, Solardach
      const cl = ['#7f9a8a', '#a9b2b7', '#8a6a52'][v];
      body(k, 0.5, 0.34, 0.4, -0.12, 0, -0.18, cl, 0.016);
      ribs(k, 0, 0.5, 0.0, 0.34, 0.02, jit(cl, 0.86), 0.03, -0.12);
      k.box(0.2, 0.22, 0.012, -0.18, 0.0, 0.026, '#c9ccd0'); if (k.fine()) for (let i = 1; i < 8; i++) k.box(0.2, 0.004, 0.014, -0.18, i * 0.027, 0.027, '#a9b0b6');
      k.box(0.54, 0.02, 0.44, -0.12, 0.34, -0.18, '#5d6670');
      solar(k, -0.12, 0.35, -0.18, 4, 3);
      k.box(0.18, 0.05, 0.012, 0.02, 0.26, 0.026, '#2f5d4a'); if (k.fine()) for (let i = 0; i < 4; i++) k.box(0.022, 0.026, 0.006, -0.03 + i * 0.032, 0.272, 0.034, '#f4ead2');
      for (const [x, z, h] of [[0.28, -0.28, 3], [0.28, -0.08, 2]]) for (let i = 0; i < h; i++) rbx(k, 0.22, 0.05, 0.12, x, i * 0.052, z, i % 2 ? '#e9e4da' : '#dcd6ca', 0.008);
      logPile(k, 0.2, 0.28, 0.38, 0.035, 4, Math.PI / 2, '#8a5f3c');
      // Ladekran auf Säule
      k.cyl(0.02, 0.025, 0.42, 8, -0.36, 0, 0.28, '#e9b13a');
      strut(k, [-0.36, 0.42, 0.28], [-0.12, 0.36, 0.3], 0.01, '#e9b13a');
      if (k.fine()) { k.box(0.04, 0.02, 0.05, -0.12, 0.32, 0.3, '#3e3a39'); for (const s of [-1, 1]) strut(k, [-0.12, 0.32, 0.3 + s * 0.02], [-0.12, 0.27, 0.3 + s * 0.035], 0.004, '#3e3a39'); }
      forklift(k, 0.02, 0.16, -0.4);
      planks(k, -0.2, 0.2, 0.22, 0.08, 4, '#e2c08a');
      return;
    }
    if (L === 6) {
      // Dampfsägewerk: Backsteinhalle mit Sheddach, Schlot, Portalkran über dem Stammlager, Bretter, Schienen mit Wagen
      const br = BRICK[(v + 1) % BRICK.length];
      k.plinth(0.56, 0.38, '#9a958c', -0.14, -0.22);
      k.walls(0.56, 0.3, 0.38, 0.06, br, '#e8dcc6', -0.14, -0.22);
      sawtooth(k, -0.14, 0.56, 0.38, 0.36, 3, SLATE[0][0], GLASS, -0.22);
      for (const x of [-0.32, -0.14, 0.04]) pane(k, 0, x, 0.22, -0.03, 0.08, 0.12, { arch: true, frame: '#e8dcc6' });
      k.box(0.14, 0.18, 0.012, 0.1, 0.06, -0.025, '#3e3a39');
      stack(k, 0.2, -0.32, 0.95, 0.055, '#9a5a44');
      // Portalkran
      for (const x of [-0.38, 0.38]) for (const z of [0.12, 0.38]) k.box(0.024, 0.44, 0.024, x, 0, z, '#e0a63a');
      for (const z of [0.12, 0.38]) k.box(0.8, 0.03, 0.03, 0, 0.44, z, '#e0a63a');
      k.box(0.06, 0.04, 0.3, 0.05, 0.47, 0.25, '#c8553d');
      if (k.fine()) { k.cyl(0.003, 0.003, 0.18, 3, 0.05, 0.28, 0.25, '#3e3a39'); k.box(0.05, 0.016, 0.03, 0.05, 0.27, 0.25, '#3e3a39'); }
      logPile(k, -0.15, 0.24, 0.34, 0.036, 4, Math.PI / 2);
      planks(k, 0.25, 0.25, 0.24, 0.12, 5);
      rails(k, -0.45, 0.44, 0.45, 0.44, 0.004, 0.045);
      return;
    }
    if (L >= 3) {
      // Sägewerk: offener Schuppen mit Kreissäge und Werkbank, Wasserrad am Gerinne (ab Königreichen), Stämme, Bretter, Sägemehl
      for (const [x, z] of [[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.16], [0.3, 0.16]]) k.box(0.04, 0.34, 0.04, x, 0, z, WOOD);
      for (const z of [-0.2, 0.16]) k.box(0.64, 0.03, 0.04, 0, 0.32, z, WOOD);
      k.roof(0.66, 0.44, 0.18, 0.34, L >= 4 ? TERRA[v % 2] : THATCH[v % 2], { rows: 3, over: 0.05, z: -0.02 });
      k.box(0.36, 0.05, 0.1, 0, 0.1, -0.02, WOOD2);
      for (const x of [-0.15, 0.15]) for (const z of [-0.06, 0.02]) k.box(0.02, 0.1, 0.02, x, 0, z, WOOD);
      k.add(new THREE.CylinderGeometry(0.075, 0.075, 0.01, 18).rotateX(Math.PI / 2).translate(0.05, 0.17, -0.02), '#c9ccd0');
      if (k.fine()) for (let i = 0; i < 12; i++) k.add(new THREE.ConeGeometry(0.008, 0.012, 3).rotateZ(-Math.PI / 2).translate(0.08, 0, 0).rotateZ(i * Math.PI / 6).translate(0.05, 0.17, -0.02), '#aeb4ba');
      logX(k, -0.05, 0.17, -0.02, 0.28, 0.03, '#9a6b44');
      logPile(k, 0.0, 0.3, 0.36, 0.042, 3, Math.PI / 2);
      planks(k, -0.36, -0.36, 0.26, 0.11, 4);
      heap(k, 0.26, -0.02, 0.07, 0.05, '#e6c896');
      if (L >= 4) {
        // Wasserrad an der Seite mit Gerinne
        k.box(0.04, 0.03, 0.5, 0.42, 0.3, -0.1, WOOD);
        k.add(new THREE.CylinderGeometry(0.14, 0.14, 0.05, 14, 1, true).rotateZ(Math.PI / 2).translate(0.38, 0.15, -0.1), WOOD2);
        if (k.fine()) for (let i = 0; i < 8; i++) k.add(new THREE.BoxGeometry(0.06, 0.05, 0.012).translate(0, 0.13, 0).rotateX(i * Math.PI / 4).translate(0.38, 0.15, -0.1), WOOD);
        k.add(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 6).rotateZ(Math.PI / 2).translate(0.36, 0.15, -0.1), DARK);
      } else {
        // Sägebock mit Stamm und Bügelsäge
        for (const s of [-1, 1]) for (const t of [-1, 1]) strut(k, [0.3 + s * 0.04, 0, 0.32 + t * 0.03], [0.3 + s * 0.012, 0.1, 0.32], 0.006, WOOD);
        logX(k, 0.3, 0.11, 0.32, 0.24, 0.026, '#9a6b44', Math.PI / 2);
      }
      return;
    }
    // Holzfällerlager: Unterstand mit Strohdach über dem Brennholz, Hackklotz mit Axt, Späne, Stammstapel, Sägebock
    for (const x of [0.06, 0.38]) { k.box(0.03, 0.3, 0.03, x, 0, -0.32, WOOD); k.box(0.03, 0.2, 0.03, x, 0, -0.08, WOOD); }
    k.add(new THREE.BoxGeometry(0.42, 0.035, 0.34).rotateX(0.3).translate(0.22, 0.27, -0.2), THATCH[v % 2][0]);
    if (k.fine()) k.add(new THREE.CylinderGeometry(0.022, 0.022, 0.42, 6).rotateZ(Math.PI / 2).translate(0.22, 0.24, -0.04), THATCH[v % 2][1]);
    for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) logX(k, 0.08 + i * 0.055, 0.03 + r * 0.05, -0.24, 0.16, 0.024, jit('#9a6b44', 0.9 + ((i + r) % 3) * 0.08), Math.PI / 2);
    logPile(k, -0.2, -0.14, 0.5, 0.05, 3, 0);
    // Hackklotz mit Axt
    k.cyl(0.07, 0.08, 0.1, 10, 0.2, 0, 0.24, '#8a5f3c');
    if (k.fine()) { k.cyl(0.066, 0.066, 0.006, 10, 0.2, 0.1, 0.24, '#d9b07a'); strut(k, [0.2, 0.1, 0.24], [0.27, 0.2, 0.3], 0.006, WOOD2); k.box(0.03, 0.04, 0.006, 0.205, 0.11, 0.245, '#8d949a', null, 0.7); for (let i = 0; i < 7; i++) k.box(0.025, 0.004, 0.012, 0.1 + hash(i, 3) * 0.24, 0.002, 0.14 + hash(i, 5) * 0.2, '#e2c08a', null, i); }
    // Sägebock
    for (const s of [-1, 1]) for (const t of [-1, 1]) strut(k, [-0.25 + s * 0.04, 0, 0.26 + t * 0.03], [-0.25 + s * 0.012, 0.1, 0.26], 0.006, WOOD);
    logX(k, -0.25, 0.11, 0.26, 0.22, 0.026, '#9a6b44', Math.PI / 2);
  },
  // Steinbruch (Runde 2): abgestufte Felswand mit geschnittenen Blöcken, Holzkran, Brecherwerk, Bagger der Moderne
  stein(k, L, v) {
    // Felswand hinten: Stufen aus Felslagen, nach oben zurückgesetzt, Farbspiel je Block
    const rc = ['#cdbfa4', '#c4b59a', '#d6c9b0', '#bfb19a'];
    for (let t = 0; t < 3; t++) for (let i = 0; i < 5; i++) {
      const w = 0.19, x = -0.38 + i * 0.19, h = 0.13 + hash(i, t) * 0.03;
      rbx(k, w, h, 0.3 - t * 0.09, x, t * 0.13, -0.3 - t * 0.045, rc[(i + t) % 4], 0.012);
    }
    if (k.fine()) for (let i = 0; i < 8; i++) k.box(0.004, 0.11, 0.004, -0.4 + i * 0.11, 0.01, -0.144, '#a89c86');
    // Blöcke, Bruchstücke
    for (let i = 0; i < 4; i++) rbx(k, 0.1, 0.08, 0.1, -0.3 + i * 0.13, 0, -0.02 + (i % 2) * 0.05, rc[i % 4], 0.008);
    if (L >= 1) rbx(k, 0.1, 0.08, 0.1, -0.23, 0.08, 0.0, rc[2], 0.008);
    if (k.fine()) for (let i = 0; i < 7; i++) rock(k, -0.4 + hash(i, 1) * 0.8, 0.012, 0.05 + hash(i, 2) * 0.3, 0.02 + hash(i, 3) * 0.015, '#bdb3a2', 0.6);
    if (L >= 7) {
      // Moderne: Bagger an der Wand, Kipper, Brecheranlage mit Trichter, Förderband, Schotterkegel, Bürocontainer
      excavator(k, -0.08, 0.06, -0.6);
      dumpTruck(k, 0.16, 0.14, Math.PI * 0.9);
      lattice(k, 0.32, -0.02, 0.12, 0.24, '#7a8590', 3, 0.9);
      k.add(new THREE.CylinderGeometry(0.09, 0.035, 0.09, 4, 1).rotateY(Math.PI / 4).translate(0.32, 0.285, -0.02), '#8a9096');
      k.add(new THREE.BoxGeometry(0.05, 0.016, 0.32).rotateX(0.42).translate(0.33, 0.15, 0.17), '#3e4348');
      heap(k, 0.33, 0.34, 0.12, 0.12, '#b9b3a8'); heap(k, 0.1, 0.38, 0.08, 0.07, '#a39d92');
      rbx(k, 0.2, 0.08, 0.09, -0.3, 0, 0.32, '#e9e4da', 0.008); k.box(0.1, 0.04, 0.004, -0.3, 0.025, 0.366, GLASS, 'win');
      return;
    }
    if (L === 6) {
      // Brecherhaus aus Wellblech auf Backsteinsockel, Förderband zum Schotterkegel, Gleis mit Kipploren
      k.box(0.24, 0.12, 0.2, 0.28, 0, -0.02, BRICK[v % BRICK.length]);
      rbx(k, 0.26, 0.24, 0.22, 0.28, 0.12, -0.02, '#a9b2b7', 0.01); ribs(k, 0, 0.26, 0.12, 0.24, 0.09, '#8f989e', 0.03, 0.28);
      k.box(0.28, 0.02, 0.24, 0.28, 0.36, -0.02, '#6d7680');
      k.box(0.1, 0.06, 0.01, 0.28, 0.24, 0.093, GLASS, 'win');
      k.add(new THREE.BoxGeometry(0.05, 0.014, 0.3).rotateX(0.45).translate(0.3, 0.2, 0.22), '#4a4f55');
      heap(k, 0.3, 0.37, 0.12, 0.13, '#b9b3a8');
      rails(k, -0.42, 0.24, 0.12, 0.24); minecart(k, -0.24, 0.24, 0, '#d6c9b0'); minecart(k, -0.08, 0.24, 0, '#d6c9b0');
      return;
    }
    if (L >= 3) {
      // Bauhütte und Tretradkran: zwei Räder, Ausleger, Seil mit Block
      const roofC = L >= 4 ? TERRA[v % 2] : THATCH[v % 2];
      k.plinth(0.28, 0.2, STONE[1], -0.27, 0.28);
      k.walls(0.28, 0.18, 0.2, 0.06, STONE[2], null, -0.27, 0.28);
      k.roof(0.28, 0.2, 0.12, 0.24, roofC, { rows: 3, gable: STONE[2], x: -0.27, z: 0.28 });
      k.door(0, -0.3, 0.38, false);
      for (const z of [0.06, 0.18]) k.add(new THREE.TorusGeometry(0.1, 0.01, 4, 16).translate(0.26, 0.11, z), WOOD);
      if (k.fine()) for (const z of [0.06, 0.18]) for (let i = 0; i < 6; i++) k.add(new THREE.BoxGeometry(0.006, 0.2, 0.006).rotateZ(i * Math.PI / 6).translate(0.26, 0.11, z), WOOD);
      k.add(new THREE.CylinderGeometry(0.015, 0.015, 0.14, 6).rotateX(Math.PI / 2).translate(0.26, 0.11, 0.12), DARK);
      strut(k, [0.26, 0, 0.12], [0.18, 0.72, 0.12], 0.016, WOOD);
      strut(k, [0.18, 0.72, 0.12], [-0.1, 0.62, 0.0], 0.012, WOOD);
      strut(k, [0.34, 0, 0.12], [0.18, 0.72, 0.12], 0.01, WOOD);
      if (k.fine()) { k.cyl(0.003, 0.003, 0.3, 3, -0.1, 0.32, 0.0, DARK); strut(k, [0.26, 0.11, 0.12], [0.18, 0.72, 0.12], 0.002, DARK); }
      rbx(k, 0.08, 0.06, 0.08, -0.1, 0.26, 0.0, rc[1], 0.008);
      if (k.fine()) { k.box(0.16, 0.012, 0.06, 0.05, 0, 0.36, WOOD2); k.box(0.012, 0.02, 0.06, -0.02, 0.012, 0.36, WOOD); }
      return;
    }
    // Frühzeit: Holzschlitten mit Block, Seil, Steinhammer und Keile
    k.box(0.18, 0.02, 0.1, 0.24, 0, 0.28, WOOD2); for (const s of [-1, 1]) k.box(0.2, 0.025, 0.012, 0.24, 0, 0.28 + s * 0.045, WOOD);
    rbx(k, 0.1, 0.08, 0.08, 0.24, 0.02, 0.28, rc[0], 0.008);
    if (k.fine()) { strut(k, [0.34, 0.03, 0.28], [0.45, 0.01, 0.33], 0.003, '#c9a46a'); strut(k, [0.36, 0, 0.12], [0.38, 0.12, 0.14], 0.006, WOOD); k.box(0.04, 0.03, 0.03, 0.382, 0.12, 0.142, '#8f8a82'); }
  },
  // Mine (Runde 2): Stollen im Felshügel, Bergwerk mit Haspel und Lore, Zeche mit Fördergerüst, Bergwerk der Moderne
  mine(k, L, v) {
    // Felshügel mit Lagen und Brocken
    const hill = (r, sy, c) => {
      k.add(new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, sy, 1).translate(-0.06, 0, -0.12), c);
      for (let i = 0; i < 6; i++) { const a = i * 1.05 + 0.4; rock(k, -0.06 + Math.cos(a) * r * 0.82, 0.03, -0.12 + Math.sin(a) * r * 0.82, 0.055 + (i % 3) * 0.014, STONE[i % 3]); }
      if (k.fine()) for (let i = 0; i < 5; i++) k.ball(0.04, -0.2 + i * 0.09, r * sy * 0.8 + (i % 2) * 0.02, -0.18 + (i % 3) * 0.05, ['#7f9a62', '#8fa86e', '#6f8a58'][i % 3], null, 1);
    };
    // Stollenmundloch mit Türstock, Gleis und Lore
    const adit = (z, h = 0.2, earth = '#8f877e') => {
      k.box(0.16, h, 0.18, 0, 0, z - 0.06, '#1d1916');
      for (const sx of [-1, 1]) rbx(k, 0.09, h + 0.04, 0.18, sx * 0.13, 0, z - 0.06, earth, 0.03);
      rbx(k, 0.34, 0.06, 0.16, 0, h, z - 0.07, earth, 0.03);
      for (const sx of [-1, 1]) rbx(k, 0.035, h, 0.04, sx * 0.095, 0, z + 0.03, WOOD, 0.006);
      rbx(k, 0.25, 0.04, 0.05, 0, h, z + 0.03, WOOD, 0.006);
      rails(k, 0, z, 0, 0.46);
      if (L >= 3) minecart(k, 0, 0.36, Math.PI / 2, L >= 6 ? '#3a3633' : '#b57a4a');
    };
    if (L >= 7) {
      // Moderne: Schachtturm aus Beton mit Maschinenhaus oben, Förderbrücke zum Silo, Büro, Kipper
      body(k, 0.2, 0.86, 0.2, -0.18, 0, -0.18, '#d8d4cc', 0.014);
      rbx(k, 0.26, 0.14, 0.24, -0.18, 0.86, -0.18, '#c8553d', 0.012);
      for (const y of [0.3, 0.55]) pane(k, 0, -0.18, y, -0.08, 0.05, 0.08, { frame: '#5d6670', glass: GLASS });
      k.box(0.2, 0.05, 0.004, -0.18, 0.9, -0.058, GLASS, 'win');
      k.box(0.3, 0.05, 0.05, 0.06, 0.64, -0.18, '#a9b0b6');
      k.cyl(0.11, 0.11, 0.6, 16, 0.26, 0, -0.18, '#c9ccd0'); k.cone(0.115, 0.08, 16, 0.26, 0.6, -0.18, '#9aa1a8');
      if (k.fine()) for (let i = 1; i < 6; i++) k.cyl(0.113, 0.113, 0.008, 16, 0.26, i * 0.1, -0.18, '#aeb4ba');
      body(k, 0.26, 0.14, 0.14, -0.2, 0, 0.24, '#f2efe8', 0.01);
      k.box(0.22, 0.07, 0.012, -0.2, 0.04, 0.312, GLASS, 'win'); if (k.fine()) for (let i = 0; i <= 4; i++) k.box(0.008, 0.07, 0.016, -0.31 + i * 0.055, 0.04, 0.314, ANTH);
      dumpTruck(k, 0.22, 0.2, Math.PI * 0.6);
      heap(k, 0.36, 0.36, 0.08, 0.07, '#5a5550');
      return;
    }
    if (L === 6) {
      // Zeche: rotes Fördergerüst mit zwei Seilrädern, Maschinenhaus aus Backstein mit Bogenfenstern, Schlot, Halde, Kohlenwagen
      hill(0.26, 0.45, '#8f877e');
      lattice(k, 0.06, 0.08, 0.2, 0.82, '#b8413a', 6, 0.55);
      k.box(0.16, 0.03, 0.16, 0.06, 0.82, 0.08, '#8a2f2a');
      for (const z of [0.04, 0.12]) spokeWheel(k, 0.06, 0.92, z, 0.075, '#3e3a39');
      strut(k, [-0.3, 0.3, 0.3], [0.06, 0.95, 0.08], 0.003, '#2f2b2c');
      k.plinth(0.3, 0.22, '#9a958c', -0.28, 0.3);
      k.walls(0.3, 0.26, 0.22, 0.06, BRICK[v % BRICK.length], '#e8dcc6', -0.28, 0.3);
      k.roof(0.3, 0.22, 0.12, 0.32, SLATE[0], { rows: 3, gable: BRICK[v % BRICK.length], x: -0.28, z: 0.3 });
      for (const x of [-0.35, -0.21]) pane(k, 0, x, 0.2, 0.41, 0.05, 0.09, { arch: true, frame: '#e8dcc6' });
      stack(k, 0.34, -0.3, 0.9, 0.05);
      heap(k, 0.34, 0.12, 0.13, 0.14, '#3e3a39');
      rails(k, 0.06, 0.12, 0.06, 0.46); minecart(k, 0.06, 0.36, Math.PI / 2, '#2f2b2c');
      return;
    }
    if (L >= 3) {
      // Bergwerk: Hügel, Stollen mit Türstock, Gleis und Lore mit Erz, Haspel unter Dach, Erzhaufen, Laterne
      hill(0.38, 0.72, '#9b938a');
      adit(0.28);
      for (const z of [0.2, 0.36]) k.box(0.02, 0.26, 0.02, 0.34, 0, z, WOOD);
      k.add(new THREE.BoxGeometry(0.2, 0.02, 0.24).rotateZ(0.25).translate(0.34, 0.27, 0.28), L >= 4 ? TERRA[v % 2][0] : THATCH[v % 2][0]);
      k.add(new THREE.CylinderGeometry(0.04, 0.04, 0.14, 10).rotateX(Math.PI / 2).translate(0.34, 0.16, 0.28), WOOD2);
      if (k.fine()) for (const s of [-1, 1]) k.box(0.05, 0.008, 0.008, 0.34 + 0.025 * s, 0.16 + 0.02 * s, 0.36, DARK);
      heap(k, -0.3, 0.3, 0.09, 0.07, '#b57a4a');
      if (L >= 4) k.lantern(-0.14, 0.38, 0.28);
      return;
    }
    // Frühzeit: Höhleneingang im Hügel mit Holzrahmen, Korb mit Erz, Hacke
    hill(0.4, 0.62, '#8a8178');
    adit(0.3, 0.18);
    k.cyl(0.04, 0.03, 0.05, 8, 0.3, 0, 0.32, '#a07a52'); if (k.fine()) for (let i = 0; i < 3; i++) k.ball(0.016, 0.29 + i * 0.012, 0.055, 0.32, '#b57a4a', null, 0);
  },
  // Speicher (Runde 2): Rundspeicher, Scheune mit Ladebalken, Silos mit Verladung, Logistikhalle der Moderne
  speicher(k, L, v) {
    const sacks = (x, z, n) => { for (let i = 0; i < n; i++) k.add(new THREE.SphereGeometry(0.03, 8, 6).scale(1.1, 0.8, 0.85).translate(x + (i % 3) * 0.055, 0.024 + Math.floor(i / 3) * 0.045, z + (Math.floor(i / 3) % 2) * 0.02), i % 2 ? '#e2d3ae' : '#d6c59c'); };
    if (L >= 7) {
      // Logistikhalle: hell mit blauem Band, drei Rampen mit Rolltoren, Lastwagen an der Rampe, Silos aus Stahl, Paletten
      body(k, 0.66, 0.36, 0.4, -0.04, 0, -0.16, '#e9e7e2', 0.016);
      ribs(k, 0, 0.66, 0.0, 0.36, 0.04, '#d6d3cc', 0.035, -0.04);
      k.box(0.668, 0.04, 0.408, -0.04, 0.28, -0.16, ['#2f6f9a', '#c8553d', '#2f8a6a'][v]);
      k.box(0.68, 0.02, 0.42, -0.04, 0.36, -0.16, '#8f969c'); solar(k, -0.04, 0.37, -0.16, 5, 3);
      for (let i = 0; i < 3; i++) {
        const x = -0.28 + i * 0.2;
        k.box(0.13, 0.17, 0.01, x, 0.06, 0.044, '#c9ccd0'); if (k.fine()) for (let j = 1; j < 6; j++) k.box(0.13, 0.004, 0.012, x, 0.06 + j * 0.028, 0.045, '#a9b0b6');
        k.box(0.15, 0.06, 0.06, x, 0, 0.07, '#9a958c');
        if (k.fine()) k.box(0.15, 0.02, 0.03, x, 0.24, 0.06, '#5d6670');
      }
      k.box(0.7, 0.06, 0.06, -0.04, 0, 0.07, '#9a958c');
      for (const z of [-0.3, -0.14]) { k.cyl(0.07, 0.07, 0.56, 14, 0.38, 0, z, '#c9ccd0'); k.cone(0.075, 0.06, 14, 0.38, 0.56, z, '#aeb4ba'); if (k.fine()) for (let i = 1; i < 6; i++) k.cyl(0.072, 0.072, 0.006, 14, 0.38, i * 0.09, z, '#aeb4ba'); }
      for (let i = 0; i < 4; i++) pallet(k, 0.3 + (i % 2) * 0.08, 0.2 + Math.floor(i / 2) * 0.08, ['#d9d4ca', '#c9a27a', '#e2d3ae', '#d9d4ca'][i], 0.04 + (i % 2) * 0.02);
      forklift(k, 0.16, 0.26, 0.3);
      return;
    }
    if (L === 6) {
      // Getreidesilos mit Ringen und Leiter, Förderbrücke, Verladehaus aus Backstein mit Rampe, Säcke, Karren
      for (const [x, z] of [[-0.24, -0.16], [0.02, -0.16]]) {
        k.cyl(0.12, 0.12, 0.78, 16, x, 0, z, '#dcd8cf'); k.cone(0.126, 0.1, 16, x, 0.78, z, '#8e969c');
        if (k.fine()) { for (let i = 1; i < 8; i++) k.cyl(0.123, 0.123, 0.008, 16, x, i * 0.1, z, '#c4bfb5'); k.box(0.006, 0.76, 0.006, x - 0.025, 0, z + 0.122, '#5d5650'); k.box(0.006, 0.76, 0.006, x + 0.025, 0, z + 0.122, '#5d5650'); for (let i = 1; i < 18; i++) k.box(0.05, 0.004, 0.004, x, i * 0.042, z + 0.122, '#5d5650'); }
      }
      k.box(0.36, 0.05, 0.05, -0.11, 0.84, -0.16, '#8e969c');
      k.add(new THREE.BoxGeometry(0.05, 0.05, 0.42).rotateX(-0.75).translate(0.2, 0.55, 0.0), '#8e969c');
      k.plinth(0.32, 0.24, '#9a958c', 0.22, 0.24);
      k.walls(0.32, 0.28, 0.24, 0.06, BRICK[(v + 2) % BRICK.length], '#e8dcc6', 0.22, 0.24);
      k.roof(0.32, 0.24, 0.12, 0.34, SLATE[v % 2], { rows: 3, gable: BRICK[(v + 2) % BRICK.length], x: 0.22, z: 0.24 });
      k.box(0.14, 0.18, 0.012, 0.22, 0.06, 0.365, WOOD);
      k.box(0.34, 0.05, 0.08, 0.22, 0, 0.4, '#9a958c');
      sacks(-0.3, 0.26, 6);
      return;
    }
    if (L <= 3) {
      // Rundspeicher auf Steinring, Leiter, Körbe und Säcke
      const wall = L === 3 ? STONE[0] : '#c9a27a';
      k.cyl(0.29, 0.3, 0.06, 14, 0, 0, 0, STONE[1]);
      k.cyl(0.24, 0.27, 0.46, 14, 0, 0.04, 0, wall);
      if (k.fine()) for (const y of [0.16, 0.32]) k.cyl(0.262 - y * 0.05, 0.266 - y * 0.05, 0.016, 14, 0, y, 0, jit(wall, 0.86));
      k.coneRoof(0.34, 0.34, 0.5, THATCH[v % 2], 0, 0, 4);
      k.door(0, 0, 0.26, true);
      if (k.fine()) { for (const s of [-1, 1]) strut(k, [0.2 + s * 0.02, 0, 0.26], [0.16 + s * 0.02, 0.44, 0.18], 0.005, WOOD); for (let i = 1; i < 7; i++) k.box(0.05, 0.006, 0.006, 0.2 - i * 0.006, i * 0.063, 0.26 - i * 0.012, WOOD); }
      sacks(-0.36, 0.2, 4);
      k.cyl(0.04, 0.03, 0.05, 8, 0.32, 0, 0.2, '#b08a5a');
      return;
    }
    // Scheune mit Ladebalken und Seilrolle am Giebel, Luke, Säcke und Fässer
    k.plinth(0.72, 0.52); k.walls(0.72, 0.42, 0.52, 0.06, '#b8604a', STONE[0]); k.roof(0.72, 0.52, 0.3, 0.48, SLATE[v % 2], { rows: 5, gable: '#b8604a' });
    k.box(0.22, 0.28, 0.02, 0, 0.06, 0.265, WOOD);
    if (k.fine()) { for (const s of [-1, 1]) k.box(0.11, 0.28, 0.006, s * 0.056, 0.06, 0.276, jit(WOOD, 1.08)); k.box(0.01, 0.28, 0.01, 0, 0.06, 0.28, DARK); }
    k.box(0.12, 0.1, 0.02, 0, 0.5, 0.265, '#3b302a');
    rbx(k, 0.03, 0.03, 0.18, 0, 0.62, 0.32, WOOD, 0.006);
    if (k.fine()) { k.add(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 10).rotateZ(Math.PI / 2).translate(0, 0.6, 0.39), DARK); k.cyl(0.002, 0.002, 0.22, 3, 0.02, 0.38, 0.39, DARK); }
    sacks(-0.36, 0.34, 6);
    barrel(k, 0.3, 0.36); barrel(k, 0.4, 0.33);
  },
  werkstatt(k, L, v) {
    hut(k, L, v);
    k.chimney(0.14, L >= 3 ? 0.36 : 0.32, -0.08, 0.32);
    k.box(0.12, 0.08, 0.06, -0.25, 0, 0.3, '#3e3a39');
    k.box(0.06, 0.06, 0.06, -0.12, 0, 0.32, '#ff8a3a', 'glow');
  },
  schrein(k, L, v) {
    if (L <= 1) {
      for (let a = 0; a < 7; a++) k.box(0.07, 0.3 + (a % 2) * 0.1, 0.05, Math.cos(a * 0.9) * 0.32, 0, Math.sin(a * 0.9) * 0.32, '#aca59b', null, -a * 0.9);
      k.box(0.12, 0.44, 0.08, 0, 0, 0, '#958f86');
      k.ball(0.05, 0, 0.5, 0, '#ffd36a', 'glow');
      return;
    }
    if (L === 2) { k.box(0.42, 0.06, 0.42, 0, 0, 0, STONE[1]); k.walls(0.26, 0.3, 0.26, 0.06, STONE[0], null); k.coneRoof(0.24, 0.3, 0.36, ['#e9b44c', '#d9a43c'], 0, 0, 3); k.ball(0.04, 0, 0.2, 0.14, '#ffd36a', 'glow'); return; }
    if (L <= 4) {
      k.plinth(0.48, 0.7);
      k.walls(0.48, 0.48, 0.7, 0.06, STONE[2]);
      k.roof(0.48, 0.7, 0.32, 0.54, SLATE[1], { rows: 5, gable: STONE[2], ry: Math.PI / 2 });
      k.walls(0.22, 0.85, 0.22, 0.06, STONE[0], '#c9b998');
      k.coneRoof(0.18, 0.42, 0.91, SLATE[0], 0, 0, 4);
      k.add(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 14).rotateX(Math.PI / 2).translate(0, 0.42, 0.36), '#ffcf7a', 'win');
      k.door(0, 0, 0.35, true);
      return;
    }
    if (L === 5) {
      k.plinth(0.5, 0.84);
      k.walls(0.5, 0.62, 0.84, 0.06, '#eee6d6');
      k.roof(0.5, 0.84, 0.34, 0.68, SLATE[v % 2], { rows: 6, gable: '#eee6d6', ry: Math.PI / 2 });
      k.tower(0, 0.48, 0.13, 1.05, '#eee6d6', SLATE[0]);
      k.add(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 16).rotateX(Math.PI / 2).translate(0, 0.5, 0.43), '#ffcf7a', 'win');
      return;
    }
    k.plinth(0.82, 0.82, '#e0dad0');
    k.walls(0.8, 0.46, 0.8, 0.06, '#f4f2ee', null);
    k.dome(0.36, 0, 0.52, 0, '#e9b44c');
    k.cyl(0.015, 0.015, 0.3, 4, 0, 0.87, 0, '#e9b44c');
    k.window(0, -0.2, 0.25, 0.4, 0.09, false); k.window(0, 0.2, 0.25, 0.4, 0.09, false);
  },
  brunnen(k, L, v) {
    if (L >= 5) {
      // Springbrunnen: zwei Becken, Säule, Wasser
      k.cyl(0.36, 0.38, 0.1, 18, 0, 0, 0, STONE[0]);
      k.cyl(0.32, 0.32, 0.02, 18, 0, 0.08, 0, '#7cc4cf');
      k.cyl(0.05, 0.07, 0.34, 10, 0, 0.08, 0, STONE[2]);
      k.cyl(0.14, 0.1, 0.05, 14, 0, 0.36, 0, STONE[0]); k.cyl(0.12, 0.12, 0.012, 14, 0, 0.405, 0, '#7cc4cf');
      k.cone(0.035, 0.14, 8, 0, 0.41, 0, '#bfe6ee');
      if (L >= 6) for (let i = 0; i < 4; i++) k.box(0.08, 0.1, 0.08, Math.cos(i * Math.PI / 2) * 0.5, 0, Math.sin(i * Math.PI / 2) * 0.5, '#86b06a');
      return;
    }
    k.cyl(0.2, 0.22, 0.15, 14, 0, 0, 0, L >= 3 ? STONE[0] : '#a39c92');
    k.cyl(0.15, 0.15, 0.02, 14, 0, 0.13, 0, '#5aa0ad');
    k.cyl(0.012, 0.012, 0.36, 4, 0.18, 0, 0, WOOD); k.cyl(0.012, 0.012, 0.36, 4, -0.18, 0, 0, WOOD);
    k.roof(0.44, 0.24, 0.12, 0.36, L >= 3 ? TERRA[v % 2] : THATCH[0], { rows: 2, over: 0.03, ry: Math.PI / 2 });
    // Winde mit Kurbel, Seil und Eimer, Steinkranz oben
    k.add(new THREE.CylinderGeometry(0.014, 0.014, 0.38, 6).rotateZ(Math.PI / 2).translate(0, 0.29, 0), WOOD2);
    k.box(0.012, 0.06, 0.012, 0.205, 0.26, 0, WOOD); k.box(0.012, 0.012, 0.05, 0.205, 0.235, 0.02, WOOD);
    k.cyl(0.004, 0.004, 0.13, 3, 0, 0.16, 0, '#d8c8a0');
    k.cyl(0.03, 0.024, 0.045, 7, 0.0, 0.13, 0.0, WOOD2); k.cyl(0.032, 0.032, 0.008, 7, 0.0, 0.165, 0.0, DARK);
    k.cyl(0.032, 0.026, 0.05, 7, 0.14, 0.15, 0.1, WOOD2);
    for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; k.box(0.095, 0.03, 0.045, Math.cos(a) * 0.2, 0.15, Math.sin(a) * 0.2, STONE[i % 3], null, -a - Math.PI / 2); }
  },
  markt(k, L, v) {
    if (L >= 7) {
      // Moderne Markthalle: Holzstützen, Flachdach mit Oberlichtern und Gründach, Glasrückwand, Stände, Tische draußen
      k.box(0.96, 0.03, 0.72, 0, 0, 0, '#e4dfd6');
      for (const x of [-0.42, -0.14, 0.14, 0.42]) for (const z of [-0.3, 0.3]) k.box(0.04, 0.42, 0.04, x, 0.03, z, '#c9a27a');
      k.box(1.0, 0.05, 0.76, 0, 0.45, 0, '#f4f1ea');
      for (const x of [-0.28, 0, 0.28]) { prism(k, 0.6, 0.14, 0.08, 0.5, '#cfe6ec', x, 0, Math.PI / 2); k.box(0.1, 0.02, 0.6, x + 0.14, 0.5, 0, '#86b06a'); }
      k.box(0.9, 0.4, 0.02, 0, 0.03, -0.31, GLASS, 'win');
      const goods = [['#e07a5f', '#f2c14e'], ['#9fbf6f', '#e9c46a'], ['#c98a4a', '#d9a05a']];
      for (let i = 0; i < 3; i++) {
        const x = -0.28 + i * 0.28;
        k.box(0.2, 0.09, 0.12, x, 0.03, -0.08, ['#c9a27a', '#f4f1ea', '#5d6670'][i]);
        for (let j = 0; j < 3; j++) k.ball(0.026, x - 0.06 + j * 0.06, 0.14, -0.08, goods[i][j % 2], null, 0);
        k.box(0.2, 0.04, 0.012, x, 0.3, -0.02, ['#e07a5f', '#5fa8a0', '#e9c46a'][(i + v) % 3]);
      }
      umbrellaTable(k, -0.3, 0.42, '#e9c46a'); umbrellaTable(k, 0.3, 0.42, '#5fa8a0');
      // Seit 19.10.2026: Schild an der Traufe, Hängeleuchten, Kisten mit Obst und Gemüse, Aufsteller, Fahrräder, Kübel, Fallrohre
      k.box(0.36, 0.05, 0.012, 0, 0.45, 0.386, ['#2f6f73', '#7a2e2a', '#2f4b66'][v]); k.box(0.26, 0.014, 0.014, 0, 0.468, 0.388, '#f2dca0');
      if (!k.fine()) return;
      for (let i = 0; i < 3; i++) { const x = -0.28 + i * 0.28; k.cyl(0.002, 0.002, 0.07, 3, x, 0.38, -0.04, ANTH); k.cone(0.03, 0.025, 7, x, 0.355, -0.04, ['#e07a5f', '#5fa8a0', '#e9c46a'][(i + v) % 3]); k.box(0.016, 0.008, 0.016, x, 0.35, -0.04, '#fff1c8', 'glow'); }
      const crop = [['#e07a5f', '#f2c14e', '#86bd5a'], ['#9fbf6f', '#e98a3a', '#c8553d'], ['#e9c46a', '#86bd5a', '#b98be0']];
      for (let i = 0; i < 3; i++) { const x = -0.28 + i * 0.28; for (const dx of [-0.05, 0.05]) { k.box(0.08, 0.035, 0.05, x + dx, 0.03, 0.05, WOOD2); for (let j = 0; j < 3; j++) k.ball(0.016, x + dx - 0.022 + j * 0.022, 0.075, 0.05, crop[i][(j + (dx > 0 ? 1 : 0)) % 3], null, 0); } }
      for (const s2 of [-1, 1]) k.add(new THREE.BoxGeometry(0.06, 0.085, 0.006).rotateX(s2 * 0.22).translate(0.0, 0.072, 0.31 + s2 * 0.01), s2 > 0 ? '#3e4348' : '#4a4f55');
      bikeRack(k, -0.42, 0.12, 2); bike(k, -0.42, 0.132, 0, BIKES[v]);
      planter(k, 0.46, 0.3, 0.85); planter(k, -0.46, 0.38, 0.85);
      for (const sx of [-1, 1]) downpipe(k, sx * 0.48, -0.36, 0.47);
      return;
    }
    if (L >= 4 && v === 2) {
      // Marktplatz mit Marktkreuz, vier Ständen und Wimpelketten
      k.box(0.96, 0.02, 0.96, 0, 0, 0, STONE[1]);
      steps(k, 0.2, 0.2, 2, 0.02, STONE[0]);
      k.cyl(0.03, 0.035, 0.5, 8, 0, 0.08, 0, STONE[2]);
      if (L === 4) { k.box(0.012, 0.12, 0.012, 0, 0.58, 0, STONE[2]); k.box(0.07, 0.012, 0.012, 0, 0.64, 0, STONE[2]); }
      else k.ball(0.035, 0, 0.62, 0, GOLD);
      const pals = [['#e07a5f', '#f4f1de'], ['#e9c46a', '#f4f1de'], ['#5fa8a0', '#f4f1de'], ['#b98be0', '#f4f1de']];
      [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]].forEach(([x, z], i) => {
        for (const dx of [-0.11, 0.11]) for (const dz of [-0.09, 0.09]) k.cyl(0.01, 0.01, 0.26, 4, x + dx, 0.02, z + dz, WOOD);
        for (let s2 = 0; s2 < 4; s2++) k.box(0.07, 0.025, 0.26, x - 0.105 + s2 * 0.07, 0.28, z, pals[i][s2 % 2]);
        k.box(0.22, 0.08, 0.14, x, 0.02, z, WOOD2);
        if (i === 1) for (let j = 0; j < 3; j++) pot(k, x - 0.06 + j * 0.06, z, 0.8, ['#c9774f', '#8fa8a0', '#e2b07a'][j], 0.1);
        else if (i === 2) for (let j = 0; j < 3; j++) k.add(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 6).rotateX(Math.PI / 2).translate(x - 0.06 + j * 0.06, 0.125, z), ['#c8553d', '#2f6f73', '#e9c46a'][j]);
        else { k.ball(0.035, x - 0.04, 0.12, z, ['#e07a5f', '#9fbf6f'][i % 2]); k.ball(0.035, x + 0.04, 0.12, z, ['#f2c14e', '#e07a5f'][i % 2]); }
      });
      for (const [x0, z0, x1, z1] of [[-0.28, -0.18, 0.28, -0.18], [-0.28, 0.18, 0.28, 0.18]]) for (let i = 0; i <= 7; i++) { const t = i / 7; k.add(new THREE.ConeGeometry(0.018, 0.035, 3).rotateX(Math.PI).translate(x0 + (x1 - x0) * t, 0.31 - Math.sin(t * Math.PI) * 0.04, z0 + (z1 - z0) * t), ['#e07a5f', '#e9c46a', '#5fa8a0', '#f4f1de'][i % 4]); }
      k.lantern(0.44, 0.0, 0.36);
      return;
    }
    if (L >= 4) {
      // Markthalle: offene Arkaden auf Säulen, ab der Industrie mit Glasdach und Eisenbögen
      const glass = L >= 6;
      k.box(0.96, 0.05, 0.7, 0, 0, 0, STONE[1]);
      for (const x of [-0.42, -0.14, 0.14, 0.42]) for (const z of [-0.3, 0.3]) k.cyl(0.03, 0.035, 0.42, 8, x, 0.05, z, glass ? '#6f8f88' : '#f2ecdf');
      k.box(0.96, 0.05, 0.7, 0, 0.47, 0, glass ? '#6f8f88' : STONE[0]);
      if (glass) {
        k.add(vaultG(0.34, 0.92, 12, true).scale(1, 0.55, 1).translate(0, 0.52, 0), '#cfe6ec', 'win');
        for (const x of [-0.42, 0, 0.42]) k.add(new THREE.TorusGeometry(0.34, 0.012, 4, 12, Math.PI).scale(1, 0.55, 1).rotateY(Math.PI / 2).translate(x, 0.52, 0), '#6f8f88');
      } else {
        k.roof(0.96, 0.7, 0.24, 0.52, TERRA[v % 2], { rows: 4, gable: STONE[0], moss: 0.1 });
      }
      const aw = [['#e07a5f', '#f4f1de'], ['#e9c46a', '#f4f1de'], ['#5fa8a0', '#f4f1de']];
      for (let i = 0; i < 3; i++) {
        const x = -0.28 + i * 0.28;
        k.box(0.18, 0.08, 0.12, x, 0.05, 0, WOOD2);
        k.ball(0.03, x - 0.04, 0.15, 0, ['#e07a5f', '#9fbf6f', '#e9c46a'][i]); k.ball(0.03, x + 0.04, 0.15, 0, ['#f2c14e', '#e07a5f', '#9fbf6f'][i]);
        for (let s2 = 0; s2 < 3; s2++) k.box(0.06, 0.012, 0.16, x - 0.06 + s2 * 0.06, 0.24, 0, aw[i][s2 % 2]);
      }
      k.lantern(0.5, 0.4, 0.42);
      if (glass) {
        // Seit 19.10.2026: Emailleschild über dem Eingang, Hängelampen unter dem Glas, Kisten, zweite Gaslaterne
        k.box(0.3, 0.05, 0.012, 0, 0.47, 0.356, '#2f4b66'); k.box(0.22, 0.012, 0.014, 0, 0.488, 0.358, '#f4f1e8');
        if (k.fine()) for (const x of [-0.28, 0, 0.28]) { k.cyl(0.002, 0.002, 0.12, 3, x, 0.4, 0.12, DARK); k.cone(0.026, 0.024, 6, x, 0.376, 0.12, '#4a5560'); k.box(0.014, 0.008, 0.014, x, 0.372, 0.12, '#fff1c8', 'glow'); }
        if (k.fine()) for (const x of [-0.2, 0.1]) { k.box(0.08, 0.035, 0.05, x, 0.05, 0.25, WOOD2); for (let j = 0; j < 3; j++) k.ball(0.016, x - 0.022 + j * 0.022, 0.095, 0.25, ['#e07a5f', '#9fbf6f', '#f2c14e'][(j + v) % 3], null, 0); }
        k.lantern(-0.5, 0.4, 0.42);
      }
      return;
    }
    const aw = [['#e07a5f', '#f4f1de'], ['#e9c46a', '#f4f1de'], ['#5fa8a0', '#f4f1de'], ['#b98be0', '#f4f1de']];
    for (let i = 0; i < 3; i++) {
      const x = -0.3 + i * 0.3, z = (i % 2) * 0.22 - 0.1, pal = aw[(i + v) % 4];
      for (const dx of [-0.11, 0.11]) for (const dz of [-0.1, 0.1]) k.cyl(0.01, 0.01, 0.26, 4, x + dx, 0, z + dz, WOOD);
      for (let s = 0; s < 4; s++) k.box(0.07, 0.025, 0.28, x - 0.105 + s * 0.07, 0.26, z, pal[s % 2]);
      k.box(0.22, 0.08, 0.16, x, 0, z, WOOD2);
      k.ball(0.035, x - 0.04, 0.1, z, ['#e07a5f', '#9fbf6f', '#e9c46a'][i]); k.ball(0.035, x + 0.04, 0.1, z, ['#f2c14e', '#e07a5f', '#9fbf6f'][i]);
    }
    k.cyl(0.05, 0.05, 0.1, 8, 0.38, 0, 0.32, WOOD2); k.cyl(0.05, 0.05, 0.1, 8, 0.28, 0, 0.36, WOOD2);
    if (v === 1) {
      // Ochsenkarren mit Kisten
      k.box(0.2, 0.05, 0.13, -0.3, 0.07, 0.34, WOOD2);
      for (const sz of [-1, 1]) k.add(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 10).rotateX(Math.PI / 2).translate(-0.3, 0.06, 0.34 + sz * 0.075), DARK);
      k.add(new THREE.BoxGeometry(0.2, 0.012, 0.012).rotateZ(-0.25).translate(-0.12, 0.08, 0.34), WOOD);
      k.box(0.07, 0.06, 0.07, -0.33, 0.12, 0.34, '#c9a06a'); k.box(0.07, 0.05, 0.07, -0.26, 0.12, 0.33, '#e2c36e');
    } else if (v === 2) {
      // rundes Händlerzelt
      k.cyl(0.13, 0.14, 0.16, 10, -0.3, 0, 0.3, '#f2e6c8');
      k.cone(0.17, 0.16, 10, -0.3, 0.16, 0.3, '#c8553d');
      k.cyl(0.005, 0.005, 0.1, 3, -0.3, 0.32, 0.3, DARK); k.box(0.05, 0.03, 0.004, -0.27, 0.39, 0.3, '#e9c46a');
      k.box(0.06, 0.12, 0.012, -0.3, 0, 0.435, '#8a6a4c');
    }
  },
  schule(k, L, v) {
    if (L <= 3) {
      k.plinth(0.7, 0.46); k.walls(0.7, 0.36, 0.46, 0.06, L === 3 ? STONE[2] : '#efe2c6', L === 3 ? STONE[0] : null);
      k.roof(0.7, 0.46, 0.22, 0.42, L === 3 ? TERRA[0] : THATCH[0], { rows: 4, gable: '#efe6d6' });
      k.walls(0.14, 0.32, 0.14, 0.56, '#efe6d6', null); k.coneRoof(0.12, 0.2, 0.88, TERRA[1], 0, 0, 3);
      k.window(0, -0.2, 0.22, 0.23); k.window(0, 0.2, 0.22, 0.23); k.door(0, 0, 0.23);
      return;
    }
    const pl = PLASTER[(v + 2) % PLASTER.length];
    if (L <= 5) {
      k.plinth(0.82, 0.6); k.walls(0.8, 0.52, 0.6, 0.06, pl); k.roof(0.8, 0.6, 0.3, 0.58, SLATE[v % 2], { rows: 5, gable: pl });
      k.tower(0.42, 0.3, 0.13, 0.8, pl, SLATE[0]); k.window(0, -0.2, 0.3, 0.3); k.window(0, 0.1, 0.3, 0.3); k.door(0, -0.32, 0.3);
      return;
    }
    k.plinth(0.92, 0.62, '#9a958c'); k.walls(0.9, 0.72, 0.6, 0.06, L >= 7 ? '#eef0f0' : '#b0654a', '#e8dcc6'); k.roof(0.9, 0.6, 0.22, 0.78, SLATE[0], { rows: 4 });
    for (const yy of [0.22, 0.48]) for (const xx of [-0.3, 0, 0.3]) k.window(0, xx, yy, 0.3, 0.08, false);
  },
  // Militärbasis je Epoche (seit 24.10.2026, Kriegssystem): Übungsplatz, befestigtes Lager, Kaserne mit Säulengang,
  // Burgfried mit Stall, Arsenal mit Kanonen, Backsteinkaserne mit Exerzierplatz, moderne Basis mit Hangar und Landeplatz
  kaserne(k, L, v) {
    const dummy = (x, z) => { // Strohpuppe zum Üben
      k.cyl(0.012, 0.012, 0.26, 5, x, 0, z, WOOD);
      k.box(0.16, 0.018, 0.018, x, 0.18, z, WOOD);
      k.add(new THREE.IcosahedronGeometry(0.045, 1).scale(1, 1.25, 0.9).translate(x, 0.2, z), '#d9b968');
      k.ball(0.03, x, 0.29, z, '#e2c47a');
    };
    const rack = (x, z, n = 4) => { // Waffengestell mit Speeren
      k.box(0.2, 0.014, 0.03, x, 0.16, z, WOOD); k.box(0.2, 0.014, 0.03, x, 0.05, z, WOOD);
      for (let i = 0; i < n; i++) { const xx = x - 0.08 + i * 0.053; k.cyl(0.006, 0.006, 0.3, 4, xx, 0, z, '#8a6a4a'); k.cone(0.012, 0.035, 4, xx, 0.3, z, '#b9bec6'); }
    };
    const target = (x, z) => { // Zielscheibe
      k.cyl(0.008, 0.008, 0.2, 4, x - 0.05, 0, z, WOOD); k.cyl(0.008, 0.008, 0.2, 4, x + 0.05, 0, z, WOOD);
      const g = (r, c, off) => k.add(new THREE.CylinderGeometry(r, r, 0.012, 14).rotateX(Math.PI / 2).translate(x, 0.2, z + off), c);
      g(0.075, '#e9dfc8', 0); g(0.052, '#c8413a', 0.004); g(0.03, '#e9dfc8', 0.008); g(0.012, '#c8413a', 0.012);
    };
    const flagpole = (x, z, h = 0.75) => { k.cyl(0.008, 0.01, h, 5, x, 0, z, '#d8d4c8'); k.ball(0.014, x, h + 0.01, z, GOLD); k.box(0.14, 0.085, 0.006, x + 0.072, h - 0.07, z, '#c8413a'); };
    if (L <= 1) {
      // Übungsplatz: Hütte, Strohpuppen, Speergestell, Zielscheibe, niedriger Flechtzaun
      k.box(0.86, 0.012, 0.86, 0, 0, 0, '#c9b48a');
      hut(k, 1, v, THATCH[v % 2]);
      if (k.fine()) {
        dummy(-0.3, 0.3); dummy(0.05, 0.34); rack(0.3, -0.32); target(0.32, 0.3);
        for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; if (Math.abs(Math.sin(a)) > 0.92 && Math.cos(a) < 0) continue; k.cyl(0.01, 0.01, 0.12, 4, Math.cos(a) * 0.46, 0, Math.sin(a) * 0.46, WOOD2); }
      }
      return;
    }
    if (L === 2) {
      // befestigtes Lager: Palisade aus Spitzpfählen, Wachturm, Langhaus, Übungsplatz in der Mitte
      for (let a = 0; a < 22; a++) { const ang = a * Math.PI * 2 / 22; if (Math.abs(ang - Math.PI / 2) < 0.2) continue; const x = Math.cos(ang) * 0.45, z = Math.sin(ang) * 0.45; k.cyl(0.026, 0.028, 0.3, 5, x, 0, z, '#8a5f3c'); k.cone(0.026, 0.06, 5, x, 0.3, z, DARK); }
      k.box(0.16, 0.6, 0.16, -0.28, 0, -0.26, WOOD2); k.box(0.24, 0.04, 0.24, -0.28, 0.6, -0.26, WOOD); k.coneRoof(0.19, 0.2, 0.64, THATCH[0], -0.28, -0.26, 2);
      k.box(0.42, 0.22, 0.2, 0.12, 0, -0.24, WOOD2); k.roof(0.42, 0.2, 0.14, 0.22, THATCH[v % 2], { rows: 3, x: 0.12, z: -0.24 });
      if (k.fine()) { dummy(-0.12, 0.18); dummy(0.12, 0.2); rack(0.26, 0.12, 3); }
      return;
    }
    if (L === 3) {
      // Kaserne der Stadtstaaten: langes Haus mit Säulengang, Hof aus Sand mit Puppen und Zielscheibe
      k.box(0.9, 0.012, 0.9, 0, 0, 0, '#d8c79e');
      k.plinth(0.8, 0.34, STONE[1], 0, -0.25);
      k.walls(0.8, 0.3, 0.3, 0.06, PLASTER[6], STONE[0], 0, -0.27);
      k.roof(0.86, 0.38, 0.14, 0.36, TERRA[v % 2], { rows: 4, x: 0, z: -0.25 });
      for (let i = 0; i < 6; i++) k.cyl(0.022, 0.026, 0.3, 8, -0.36 + i * 0.144, 0.06, -0.06, '#f1ebdd');
      k.box(0.86, 0.03, 0.06, 0, 0.36, -0.06, STONE[0]);
      if (k.fine()) { dummy(-0.25, 0.25); dummy(0, 0.3); target(0.3, 0.28); rack(-0.2, 0.08); }
      return;
    }
    if (L === 4) {
      // Königreiche: viereckiger Burgfried mit Zinnen, Stall daneben, Hof mit Zielscheiben
      k.plinth(0.36, 0.36, STONE[1], -0.22, -0.22);
      k.walls(0.36, 0.72, 0.36, 0.06, STONE[2], STONE[0], -0.22, -0.22);
      for (let i = 0; i < 4; i++) for (const s of [-1, 1]) { k.box(0.06, 0.06, 0.05, -0.22 - 0.13 + i * 0.087, 0.78, -0.22 + s * 0.17, STONE[0]); k.box(0.05, 0.06, 0.06, -0.22 + s * 0.17, 0.78, -0.22 - 0.13 + i * 0.087, STONE[0]); }
      k.box(0.03, 0.1, 0.012, -0.22, 0.45, -0.035, DARK);
      k.box(0.42, 0.2, 0.26, 0.2, 0, -0.26, WOOD2); k.roof(0.42, 0.26, 0.12, 0.2, SLATE[v % 2], { rows: 3, x: 0.2, z: -0.26 });
      for (const x of [0.06, 0.2, 0.34]) k.box(0.1, 0.13, 0.012, x, 0.02, -0.126, DARK);
      if (k.fine()) { target(-0.25, 0.3); target(0.05, 0.32); rack(0.3, 0.12); flagpole(-0.36, 0.05, 0.6); }
      return;
    }
    if (L === 5) {
      // Arsenal der Renaissance: Backsteinbau mit Mansarddach, Kanonen und Kugeln davor, Pulverfässer, Fahne
      k.box(0.9, 0.012, 0.9, 0, 0, 0, '#cfc2a6');
      k.plinth(0.8, 0.38, STONE[1], 0, -0.22);
      k.walls(0.8, 0.36, 0.38, 0.06, BRICK[1], STONE[0], 0, -0.22);
      k.roof(0.84, 0.42, 0.18, 0.42, SLATE[v % 2], { rows: 4, x: 0, z: -0.22 });
      for (const x of [-0.25, 0.25]) k.box(0.1, 0.12, 0.02, x, 0.2, -0.02, '#ffd486', 'win');
      k.box(0.16, 0.2, 0.02, 0, 0.06, -0.02, DARK);
      if (k.fine()) {
        for (const x of [-0.24, 0.24]) {
          k.add(new THREE.CylinderGeometry(0.024, 0.018, 0.26, 10).rotateX(Math.PI / 2 - 0.12).translate(x, 0.08, 0.27), '#4a3e30');
          k.box(0.08, 0.04, 0.2, x, 0.02, 0.2, '#6a4a30');
          for (const s of [-1, 1]) k.add(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 12).rotateZ(Math.PI / 2).translate(x + s * 0.05, 0.05, 0.2), '#6a4a30');
        }
        for (let i = 0; i < 6; i++) k.ball(0.018, -0.04 + (i % 3) * 0.04, 0.02 + Math.floor(i / 3) * 0.03, 0.3 + (i % 2) * 0.02, '#2a2a2c');
        for (let i = 0; i < 3; i++) k.cyl(0.035, 0.035, 0.07, 10, 0.4 - i * 0.06, 0.012, 0.0, '#7a5232');
        flagpole(-0.4, 0.38);
      }
      return;
    }
    if (L === 6) {
      // Industrie: zweigeschossige Backsteinkaserne, Exerzierplatz mit Fahnenmast, Feldgeschütz
      k.box(0.92, 0.012, 0.92, 0, 0, 0, '#bdb7aa');
      k.plinth(0.84, 0.34, '#9a958c', 0, -0.26);
      k.walls(0.84, 0.48, 0.34, 0.06, BRICK[0], '#d8d0c0', 0, -0.26);
      k.roof(0.88, 0.38, 0.12, 0.54, SLATE[v % 2], { rows: 3, x: 0, z: -0.26 });
      for (const y of [0.14, 0.34]) for (let i = 0; i < 6; i++) k.box(0.07, 0.1, 0.02, -0.33 + i * 0.132, y, -0.084, '#ffd486', 'win');
      k.box(0.12, 0.17, 0.02, 0, 0.06, -0.083, DARK);
      if (k.fine()) {
        flagpole(0, 0.24, 0.8);
        k.box(0.5, 0.004, 0.012, 0, 0.013, 0.08, '#efe9dc'); k.box(0.5, 0.004, 0.012, 0, 0.013, 0.4, '#efe9dc');
        k.add(new THREE.CylinderGeometry(0.014, 0.012, 0.22, 8).rotateX(Math.PI / 2 - 0.1).translate(0.32, 0.08, 0.3), '#4a5040');
        k.box(0.012, 0.08, 0.1, 0.32, 0.04, 0.24, '#6a6e58');
        for (const s of [-1, 1]) k.add(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 12).rotateZ(Math.PI / 2).translate(0.32 + s * 0.05, 0.045, 0.24), '#3a3a36');
      }
      return;
    }
    // Moderne: Hangar mit Tonnendach, Fahrzeughalle, Hubschrauberlandeplatz mit H, Radar, Zaun
    k.box(0.94, 0.012, 0.94, 0, 0, 0, '#9fa39a');
    k.add(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(-0.18, 0.012, -0.2), '#7a8270');
    k.box(0.44, 0.22, 0.012, -0.18, 0.012, 0.05, '#5d6450');
    k.box(0.3, 0.16, 0.012, -0.18, 0.012, 0.058, '#3a3e36');
    k.box(0.3, 0.16, 0.36, 0.28, 0.012, -0.26, '#c9c8bf');
    k.box(0.32, 0.02, 0.38, 0.28, 0.17, -0.26, '#8d8f88');
    for (let i = 0; i < 2; i++) k.box(0.1, 0.11, 0.012, 0.21 + i * 0.14, 0.012, -0.075, '#4a4e48');
    k.add(new THREE.CylinderGeometry(0.17, 0.17, 0.008, 20).translate(0.18, 0.016, 0.24), '#5a5e58');
    if (k.fine()) {
      k.add(new THREE.TorusGeometry(0.15, 0.006, 4, 24).rotateX(Math.PI / 2).translate(0.18, 0.022, 0.24), '#f2c14e');
      k.box(0.02, 0.004, 0.11, 0.14, 0.022, 0.24, '#f4f2ea'); k.box(0.02, 0.004, 0.11, 0.22, 0.022, 0.24, '#f4f2ea'); k.box(0.08, 0.004, 0.02, 0.18, 0.022, 0.24, '#f4f2ea');
      k.cyl(0.01, 0.012, 0.36, 5, 0.42, 0.012, 0.05, '#c9c8bf');
      k.add(new THREE.SphereGeometry(0.08, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.4).rotateX(-0.9).translate(0.42, 0.4, 0.06), '#e8e6df');
      for (let i = 0; i < 20; i++) { const t = i / 19, x = -0.46 + t * 0.92; k.cyl(0.004, 0.004, 0.13, 3, x, 0, 0.46, '#8a8d88'); }
      k.box(0.92, 0.004, 0.004, 0, 0.12, 0.46, '#8a8d88'); k.box(0.92, 0.004, 0.004, 0, 0.07, 0.46, '#8a8d88');
      flagpole(-0.42, 0.3, 0.7);
    }
  },
  hafen(k, L, v) {
    k.box(0.28, 0.05, 1.3, 0, 0.02, 0.5, L >= 4 ? STONE[1] : WOOD2);
    for (const z of [0.2, 0.6, 1.0]) for (const x of [-0.12, 0.12]) k.cyl(0.025, 0.025, 0.45, 6, x, -0.4, z, WOOD);
    hut(k, Math.max(3, L), v, SLATE[v % 2]);
    k.cyl(0.02, 0.02, 0.7, 4, 0.2, 0, 0.9, WOOD); k.box(0.02, 0.02, 0.4, 0.2, 0.68, 0.75, WOOD);
    for (let i = 0; i < 3; i++) k.cyl(0.05, 0.05, 0.1, 8, -0.08 + i * 0.08, 0.06, 0.25 + (i % 2) * 0.1, '#9b7450');
  },
  heiler(k) {
    k.plinth(0.5, 0.42); k.walls(0.5, 0.36, 0.42, 0.06, '#f4f2ea'); k.roof(0.5, 0.42, 0.22, 0.42, ['#6fae9e', '#5f9e8e', '#7fbeae'], { rows: 4, gable: '#f4f2ea' });
    for (let i = 0; i < 5; i++) k.ball(0.06, -0.3 + i * 0.15, 0.05, -0.36, ['#6cab52', '#9fbf6f', '#b388eb', '#6cab52', '#e0679a'][i]);
    k.window(0, 0.12, 0.2, 0.21); k.door(0, -0.12, 0.21);
  },
  // Theater (Runde 2, 24.10.2026): Amphitheater mit Bühnenhaus, Barocktheater mit Säulenportal, Varieté mit Leuchtvordach,
  // Theater der Moderne mit Glasfoyer und Bühnenturm
  theater(k, L, v) {
    if (L <= 4) {
      // Sitzreihen als Ringe im Halbkreis hinten, außen höher, zur Kamera offen, Treppengänge, Orchestra
      for (let r = 0; r < 5; r++) {
        const rIn = 0.2 + r * 0.052, rOut = r === 4 ? 0.47 : rIn + 0.054, h = 0.035 + r * 0.045;
        k.add(ringSector(rIn, rOut, h, 0, Math.PI).translate(0, 0, -0.08), STONE[r % 3]);
        if (k.fine()) k.add(new THREE.TorusGeometry(rIn + 0.004, 0.005, 3, 24, Math.PI).rotateX(-Math.PI / 2).translate(0, h, -0.08), jit(STONE[r % 3], 0.84));
      }
      if (k.fine()) for (const a of [0.6, 1.57, 2.54]) for (let r = 0; r < 5; r++) { const R = 0.226 + r * 0.052; k.box(0.034, 0.035 + r * 0.045 + 0.004, 0.05, Math.cos(a) * R, 0, -0.08 - Math.sin(a) * R, STONE[1], null, -a + Math.PI / 2); }
      k.add(new THREE.CylinderGeometry(0.19, 0.19, 0.012, 24).translate(0, 0.006, -0.08), '#e4d7bf');
      k.box(0.7, 0.05, 0.12, 0, 0, 0.32, STONE[1]);
      for (let i = 0; i < 6; i++) column(k, -0.3 + i * 0.12, 0.05, 0.32, 0.24, 0.022, '#f4eee2');
      k.box(0.72, 0.04, 0.1, 0, 0.29, 0.32, '#efe6d2'); if (k.fine()) k.box(0.72, 0.012, 0.11, 0, 0.33, 0.32, STONE[0]);
      for (const x of [-0.42, 0.42]) { k.cyl(0.012, 0.015, 0.06, 5, x, 0, 0.12, '#7b5a3e'); k.cone(0.04, 0.24, 8, x, 0.05, 0.12, '#4f7a4a'); }
      for (const x of [-0.22, 0.22]) torch(k, x, 0.2, 0.18);
      return;
    }
    if (L === 5) {
      // Barocktheater: Säulenportal mit Giebel, runder Zuschauerbau mit Kuppel dahinter, Plakate, Laternen, Freitreppe
      const pl = PLASTER[(v * 3 + 2) % 8];
      k.plinth(0.7, 0.4, STONE[1], 0, 0.06);
      k.walls(0.7, 0.4, 0.4, 0.06, pl, STONE[0], 0, 0.06);
      k.cyl(0.3, 0.32, 0.46, 20, 0, 0.06, -0.2, pl); k.add(domeG(0.31, 20, 8, 0.7).translate(0, 0.52, -0.2), COPPER[0]);
      for (let i = 0; i < 7; i++) {
        const an = Math.PI * (0.62 + i * 0.13), x = Math.cos(an) * 0.312, z = -0.2 - Math.sin(an) * 0.312, ry = Math.atan2(x, z + 0.2);
        k.box(0.07, 0.13, 0.016, x, 0.22, z, '#f4eee2', null, ry); k.box(0.05, 0.11, 0.02, x * 1.012, 0.23, -0.2 + (z + 0.2) * 1.012, '#ffd486', 'win', ry);
        if (k.fine()) k.box(0.08, 0.016, 0.03, x * 1.02, 0.36, -0.2 + (z + 0.2) * 1.02, STONE[0], null, ry);
      }
      if (k.fine()) k.cyl(0.322, 0.322, 0.03, 20, 0, 0.47, -0.2, STONE[0]);
      k.cone(0.04, 0.1, 8, 0, 0.73, -0.2, COPPER[2]); k.ball(0.02, 0, 0.84, -0.2, GOLD, null, 1);
      for (let i = 0; i < 4; i++) column(k, -0.18 + i * 0.12, 0.12, 0.3, 0.3, 0.025, MARBLE);
      k.box(0.46, 0.04, 0.1, 0, 0.42, 0.3, MARBLE); prism(k, 0.48, 0.12, 0.1, 0.46, MARBLE, 0, 0.3);
      steps(k, 0.52, 0.22, 4, 0, STONE[2], 0, 0.36, 0.03);
      for (const x of [-0.12, 0, 0.12]) archway(k, 0, x, 0.26, 0.06, 0.16, '#5a3a2e', 0.12);
      for (const x of [-0.28, 0.28]) { pane(k, 0, x, 0.32, 0.26, 0.06, 0.1, { arch: true, frame: '#f4eee2' }); k.lantern(x, 0.4, 0.26); }
      if (k.fine()) for (const x of [-0.24, 0.24]) { k.box(0.06, 0.09, 0.006, x, 0.12, 0.262, ['#c8553d', '#2f4b66'][x < 0 ? 0 : 1]); k.box(0.04, 0.02, 0.007, x, 0.18, 0.263, '#f4ead2'); }
      flag(k, 0.3, 0.0, 0.32, ['#c8553d', '#2f6f73', '#e9c46a'][v], 0.46);
      return;
    }
    if (L === 6) {
      // Varieté: Stuckfassade mit Bogenfenstern, Leuchtvordach mit Glühbirnen, senkrechtes Leuchtschild, Plakate
      const pl = ['#e8c9b0', '#d9e0cf', '#e9d9b0'][v];
      k.plinth(0.74, 0.5, '#9a958c'); k.walls(0.74, 0.62, 0.5, 0.06, pl, STONE[0]);
      k.box(0.78, 0.06, 0.54, 0, 0.66, 0, jit(pl, 1.06)); attika(k, 0.74, 0.5, 0.72, pl, { h: 0.05 });
      for (const x of [-0.24, 0, 0.24]) pane(k, 0, x, 0.48, 0.25, 0.1, 0.16, { arch: true, frame: '#f4ece0', glass: '#ffd486' });
      for (const x of [-0.12, 0.12]) archway(k, 0, x, 0.25, 0.09, 0.2, '#5a3a2e', 0.06);
      // Vordach mit Glühbirnen und Schrift
      rbx(k, 0.6, 0.06, 0.16, 0, 0.28, 0.33, '#2f3439', 0.01);
      k.box(0.5, 0.045, 0.01, 0, 0.29, 0.412, '#c8553d');
      if (k.fine()) for (let i = 0; i < 14; i++) { k.ball(0.007, -0.28 + i * 0.043, 0.282, 0.414, '#fff1c8', 'glow', 0); k.box(0.022, 0.026, 0.004, -0.2 + (i % 8) * 0.057, 0.3, 0.418, '#f4ead2'); }
      for (const x of [-0.27, 0.27]) k.cyl(0.008, 0.008, 0.28, 6, x, 0, 0.4, '#2f3439');
      // senkrechtes Schild an der Ecke
      rbx(k, 0.05, 0.36, 0.03, 0.4, 0.3, 0.2, '#c8553d', 0.008);
      if (k.fine()) for (let i = 0; i < 7; i++) k.ball(0.008, 0.4, 0.33 + i * 0.045, 0.218, '#fff1c8', 'glow', 0);
      for (const x of [-0.31, 0.31]) { k.box(0.07, 0.11, 0.008, x, 0.08, 0.252, ['#e9c46a', '#5fa8a0'][x < 0 ? 0 : 1]); }
      return;
    }
    // Moderne: Glasfoyer mit schrägem Dach, Bühnenturm aus Sichtbeton, großes Leuchtplakat, Treppe, Bäume, Bänke
    body(k, 0.4, 0.66, 0.36, 0.08, 0, -0.18, '#cfcac2', 0.014);
    if (k.fine()) for (let i = 1; i < 5; i++) k.box(0.404, 0.004, 0.364, 0.08, i * 0.13, -0.18, '#bdb8af');
    k.box(0.7, 0.02, 0.36, 0, 0, 0.12, '#d8d3ca');
    k.box(0.64, 0.3, 0.012, 0, 0.02, 0.26, GLASS, 'win');
    for (let i = 0; i <= 8; i++) k.box(0.01, 0.3, 0.02, -0.32 + i * 0.08, 0.02, 0.265, ANTH);
    k.box(0.64, 0.012, 0.02, 0, 0.17, 0.265, ANTH);
    for (const sx of [-1, 1]) k.box(0.012, 0.3, 0.3, sx * 0.32, 0.02, 0.11, GLASS, 'win');
    k.box(0.64, 0.3, 0.012, 0, 0.02, -0.04, '#e4dfd6');
    k.add(new THREE.BoxGeometry(0.76, 0.03, 0.44).rotateX(-0.12).translate(0, 0.36, 0.1), '#f2efe8');
    for (const x of [-0.31, 0.31]) k.box(0.012, 0.34, 0.012, x, 0.02, 0.3, ANTH);
    rbx(k, 0.26, 0.2, 0.02, 0.08, 0.36, 0.0, ['#c8553d', '#2f6f9a', '#7a4f9a'][v], 0.006, 'win');
    if (k.fine()) { for (let i = 0; i < 5; i++) k.box(0.03, 0.035, 0.006, -0.01 + i * 0.045, 0.52, 0.012, '#f4ead2'); for (let i = 0; i < 3; i++) k.box(0.36 - i * 0.06, 0.02, 0.05, 0, i * 0.02, 0.34 + i * 0.02, '#e4dfd6'); }
    for (const x of [-0.4, 0.4]) { k.cyl(0.012, 0.016, 0.14, 5, x, 0, 0.36, '#7b5a3e'); k.ball(0.07, x, 0.2, 0.36, '#6aa64f', null, 1); }
    bench(k, -0.2, 0.42, 0, WOOD2); bench(k, 0.2, 0.42, 0, WOOD2);
  },
  // Statue des Gottes (Runde 2): der Geist im Kapuzengewand hält den Regentropfen, je Epoche aus Stein, Bronze, Marmor
  // im Brunnen, Bronze auf Granit mit Gitter und Laternen, in der Moderne ein großer Tropfen über einem Wasserbecken
  monument(k, L = 4, v = 0) {
    const flowers = r => { if (k.fine()) for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; k.ball(0.03, Math.cos(a) * r, 0.03, Math.sin(a) * r, i % 2 ? '#6aa64f' : '#5f9a4c', null, 1); k.ball(0.014, Math.cos(a) * r, 0.06, Math.sin(a) * r, FLOWERS[i % 5], null, 0); } };
    if (L >= 7) {
      // Tropfen aus dunklem Glas (spiegelt bei Tag, leuchtet nachts blau), Wasserbecken, Lichtring, Sitzkanten
      k.add(new THREE.CylinderGeometry(0.42, 0.44, 0.06, 32).translate(0, 0.03, 0), '#e4dfd6');
      k.add(new THREE.CylinderGeometry(0.38, 0.38, 0.012, 32).translate(0, 0.058, 0), '#6fb3c9', 'win');
      k.add(new THREE.CylinderGeometry(0.1, 0.12, 0.08, 16).translate(0, 0.06, 0), '#cfcac2');
      k.add(dropG(0.17, 0).translate(0, 0.27, 0), '#8fc6e8', 'win');
      if (k.fine()) { k.add(new THREE.TorusGeometry(0.4, 0.008, 4, 40).rotateX(Math.PI / 2).translate(0, 0.064, 0), '#cfeeff', 'glow'); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.26; k.cyl(0.004, 0.004, 0.1, 4, Math.cos(a) * 0.3, 0.06, Math.sin(a) * 0.3, '#cfeeff', 'glow'); } }
      return;
    }
    const mat = L >= 6 ? '#6fa894' : L === 5 ? '#f4eee2' : L === 4 ? '#8a6a3e' : '#d6cab2';
    if (L === 5) {
      // Marmor im Brunnenbecken mit Wasserspeiern
      k.add(new THREE.CylinderGeometry(0.44, 0.46, 0.1, 28).translate(0, 0.05, 0), STONE[2]);
      k.add(new THREE.CylinderGeometry(0.4, 0.4, 0.012, 28).translate(0, 0.095, 0), '#7fc0d0', 'win');
      k.add(new THREE.TorusGeometry(0.43, 0.026, 6, 32).rotateX(Math.PI / 2).translate(0, 0.1, 0), STONE[0]);
      if (k.fine()) for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; k.box(0.05, 0.035, 0.05, Math.cos(a) * 0.43, 0.1, Math.sin(a) * 0.43, STONE[0], null, -a); }
      k.cyl(0.12, 0.14, 0.24, 12, 0, 0.1, 0, STONE[0]);
      k.cyl(0.15, 0.15, 0.03, 12, 0, 0.34, 0, MARBLE);
      spirit(k, 0, 0.37, 0, 0.95, mat);
      if (k.fine()) for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + 0.78; strut(k, [Math.cos(a) * 0.13, 0.2, Math.sin(a) * 0.13], [Math.cos(a) * 0.3, 0.1, Math.sin(a) * 0.3], 0.006, '#cfeeff'); }
      return;
    }
    // Sockel: Stufen, Schaft mit Tafel, Gesims
    steps(k, 0.5, 0.5, 2, 0, STONE[1], 0, 0, 0.04);
    const ped = L >= 6 ? '#8f8a86' : STONE[0];
    rbx(k, 0.26, 0.3, 0.26, 0, 0.08, 0, ped, 0.012);
    rbx(k, 0.3, 0.04, 0.3, 0, 0.38, 0, jit(ped, 1.08), 0.01);
    k.box(0.12, 0.08, 0.008, 0, 0.18, 0.132, L >= 4 ? '#c9a24f' : jit(ped, 0.86));
    spirit(k, 0, 0.42, 0, L >= 6 ? 1.15 : 1.0, mat);
    if (L >= 6) {
      // Gitter und Gaslaternen an den Ecken
      if (k.fine()) for (const [x0, z0, x1, z1] of [[-0.3, 0.3, 0.3, 0.3], [-0.3, -0.3, 0.3, -0.3], [-0.3, -0.3, -0.3, 0.3], [0.3, -0.3, 0.3, 0.3]]) railing(k, x0, z0, x1, z1, 0, true, 0.1, '#2f3439');
      for (const [x, z] of [[-0.36, 0.36], [0.36, 0.36]]) k.lantern(x, z, 0.36);
    } else if (L === 4) {
      for (const [x, z] of [[-0.3, 0.3], [0.3, 0.3]]) torch(k, x, z, 0.26);
      flowers(0.34);
    } else {
      flowers(0.32);
      if (k.fine()) for (let i = 0; i < 5; i++) { k.cyl(0.008, 0.008, 0.025, 5, -0.08 + i * 0.04, 0.08, 0.2, '#f4ead2'); k.ball(0.006, -0.08 + i * 0.04, 0.112, 0.2, '#ffd27a', 'glow', 0); }
    }
  },
  muehle(k, L, v) {
    k.cyl(0.17, 0.25, 0.72, 14, 0, 0, 0, L >= 4 ? STONE[2] : '#e2d2b0');
    k.coneRoof(0.24, 0.3, 0.72, THATCH[v % 2], 0, 0, 3);
    k.door(0, 0, 0.24, true);
    k.box(0.06, 0.08, 0.02, 0, 0.42, 0.2, '#ffd486', 'win');
    const r = new Kit(7);
    for (let i = 0; i < 4; i++) {
      r.add(new THREE.BoxGeometry(0.02, 0.44, 0.012).translate(0, 0.26, 0).rotateZ(i * Math.PI / 2), WOOD);
      r.add(new THREE.BoxGeometry(0.08, 0.32, 0.006).translate(0.05, 0.3, 0).rotateZ(i * Math.PI / 2), '#f2ead8');
    }
    r.cyl(0.03, 0.03, 0.06, 6, 0, -0.03, 0, DARK);
    k.rotor = { geo: r.build(), pos: [0, 0.74, 0.25] };
  },
  burg(k, L, v) {
    const s = L >= 5 ? STONE[2] : STONE[1];
    const roofC = SLATE[v % 2];
    k.box(0.92, 0.42, 0.07, 0, 0, -0.46, s); k.box(0.92, 0.42, 0.07, 0, 0, 0.46, s); k.box(0.07, 0.42, 0.92, -0.46, 0, 0, s); k.box(0.07, 0.42, 0.92, 0.46, 0, 0, s);
    k.crenel(0.92, 0.92, 0.42, STONE[0]);
    for (const [x, z] of [[-0.46, -0.46], [0.46, -0.46], [-0.46, 0.46], [0.46, 0.46]]) k.tower(x, z, 0.14, 0.72, s, roofC);
    k.walls(0.38, 0.86, 0.38, 0, '#e9a48d');
    k.roof(0.38, 0.38, 0.3, 0.86, roofC, { rows: 4, gable: '#e9a48d' });
    k.box(0.16, 0.17, 0.08, 0, 0, 0.465, DARK);
    k.window(0, 0, 0.6, 0.19, 0.08);
  },
  // Sternwarte (Runde 2, 24.10.2026): Gelehrtenhaus mit Kuppeltrommel, Backsteinturm mit Wetterstation, Observatorium
  // der Moderne mit Radioteleskop. Die Kuppel hat einen offenen Spalt mit Fernrohr
  sternwarte(k, L = 5, v = 0) {
    const domeSlit = (x, y, z, r, c, tube = '#3e4348') => {
      k.add(domeG(r, 20, 8).translate(x, y, z), c);
      k.add(new THREE.BoxGeometry(r * 0.32, r * 1.05, r * 0.5).rotateX(-0.55).translate(x, y + r * 0.55, z + r * 0.55), '#1f2a36');
      if (k.fine()) { strut(k, [x, y + r * 0.2, z], [x, y + r * 1.15, z + r * 0.75], r * 0.13, tube, 10, r * 0.16); k.add(new THREE.TorusGeometry(r * 1.0, 0.008, 4, 24).rotateX(Math.PI / 2).translate(x, y + 0.004, z), jit(c, 0.85)); }
    };
    if (L >= 7) {
      // Weiße Kuppel auf Betontrommel, Glaslabor, große Antennenschüssel auf Gestell, Mast
      k.plinth(0.46, 0.46, '#cfcac2', -0.14, -0.12);
      k.cyl(0.2, 0.21, 0.24, 24, -0.14, 0.06, -0.12, '#e4dfd6');
      if (k.fine()) k.cyl(0.212, 0.212, 0.012, 24, -0.14, 0.2, -0.12, '#bdb8af');
      domeSlit(-0.14, 0.3, -0.12, 0.21, '#f4f2ee', '#c9ccd0');
      body(k, 0.34, 0.16, 0.2, 0.18, 0, 0.22, '#f2efe8', 0.01);
      k.box(0.3, 0.1, 0.012, 0.18, 0.03, 0.322, GLASS, 'win'); if (k.fine()) for (let i = 0; i <= 5; i++) k.box(0.008, 0.1, 0.016, 0.03 + i * 0.06, 0.03, 0.324, ANTH);
      k.box(0.36, 0.014, 0.22, 0.18, 0.16, 0.22, '#5d6670');
      // Radioteleskop
      k.cyl(0.02, 0.03, 0.2, 8, 0.3, 0, -0.22, '#c9ccd0');
      k.add(new THREE.SphereGeometry(0.15, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.32).rotateX(Math.PI).rotateX(-0.7).translate(0.3, 0.33, -0.2), '#eef0f2');
      if (k.fine()) { for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; strut(k, [0.3 + Math.cos(a) * 0.11, 0.3 + Math.sin(a) * 0.05, -0.2 + Math.sin(a) * 0.06], [0.3, 0.42, -0.06], 0.003, '#aeb4ba'); } k.ball(0.012, 0.3, 0.42, -0.06, '#aeb4ba', null, 1); }
      antenna(k, -0.36, 0.06, 0.2, 0.36);
      return;
    }
    if (L === 6) {
      // Backsteinbau mit Turm, weiße Kuppel, Wetterstation mit Schalenkreuz, Bogenfenster
      const br = BRICK[(v + 4) % BRICK.length];
      k.plinth(0.56, 0.36, '#9a958c', 0, 0.06);
      k.walls(0.56, 0.3, 0.36, 0.06, br, '#e8dcc6', 0, 0.06);
      k.roof(0.56, 0.36, 0.14, 0.36, SLATE[v % 2], { rows: 4, gable: br, z: 0.06 });
      for (const x of [-0.18, 0.18]) pane(k, 0, x, 0.22, 0.24, 0.07, 0.11, { arch: true, frame: '#e8dcc6' });
      k.door(0, 0, 0.24, true);
      body(k, 0.26, 0.56, 0.26, 0, 0, -0.2, br, 0.012);
      k.box(0.3, 0.04, 0.3, 0, 0.56, -0.2, '#e8dcc6');
      domeSlit(0, 0.6, -0.2, 0.15, '#eef0f2');
      pane(k, 0, 0, 0.44, -0.07, 0.05, 0.1, { arch: true, frame: '#e8dcc6' });
      k.cyl(0.006, 0.006, 0.5, 4, 0.34, 0, -0.3, '#3e4348');
      if (k.fine()) for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; k.box(0.05, 0.004, 0.004, 0.34 + Math.cos(a) * 0.025, 0.5, -0.3 + Math.sin(a) * 0.025, '#3e4348', null, -a); k.add(new THREE.SphereGeometry(0.01, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(Math.PI / 2).translate(0.34 + Math.cos(a) * 0.05, 0.5, -0.3 + Math.sin(a) * 0.05), '#c9ccd0'); }
      return;
    }
    // Gelehrtenhaus mit Gesims, Bogenfenstern und einer Trommel mit Kupferkuppel auf dem Dach, Balkon ringsum, Armillarsphäre
    const st = STONE[(v + 2) % 3];
    k.plinth(0.6, 0.42, STONE[1]);
    k.walls(0.6, 0.34, 0.42, 0.06, st, STONE[0]);
    k.add(roundBox(0.64, 0.04, 0.46, 0.012).translate(0, 0.41, 0), STONE[0]);
    for (const x of [-0.2, 0.2]) pane(k, 0, x, 0.24, 0.21, 0.07, 0.12, { arch: true, frame: '#f4eee2' });
    k.door(0, 0, 0.21, true);
    for (const z of [-0.1, 0.1]) pane(k, 1, 0.3, 0.24, z, 0.06, 0.1, { arch: true, frame: '#f4eee2' });
    k.cyl(0.17, 0.18, 0.16, 20, 0, 0.43, -0.02, st);
    if (k.fine()) for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.26; k.box(0.03, 0.05, 0.012, Math.cos(a) * 0.172, 0.48, -0.02 + Math.sin(a) * 0.172, '#ffd486', 'win', Math.atan2(Math.cos(a), Math.sin(a))); }
    railing(k, -0.3, 0.2, 0.3, 0.2, 0.43, true, 0.07, '#5a4636');
    domeSlit(0, 0.59, -0.02, 0.18, COPPER[0]);
    if (k.fine()) { k.cyl(0.006, 0.008, 0.12, 5, -0.38, 0, 0.3, DARK); for (const r of [0, 1.2, 2.3]) k.add(new THREE.TorusGeometry(0.05, 0.004, 4, 18).rotateX(r).rotateY(r * 0.7).translate(-0.38, 0.17, 0.3), GOLD); k.ball(0.012, -0.38, 0.17, 0.3, GOLD, null, 0); }
  },
  leuchtturm(k) {
    for (let i = 0; i < 5; i++) k.cyl(0.18 - i * 0.02, 0.2 - i * 0.02, 0.24, 12, 0, i * 0.24, 0, i % 2 ? '#d0644a' : '#f4f1ea');
    k.cyl(0.13, 0.13, 0.16, 12, 0, 1.2, 0, '#ffe7a0', 'glow');
    k.coneRoof(0.17, 0.18, 1.36, ['#3e3a39', '#4a4544'], 0, 0, 2);
    k.beam = { pos: [0, 1.28, 0] };
  },
  // Fabrik (Runde 2): Backsteinfabrik mit Sheddach, Schloten, Wasserturm und Kontor, Fabrik der Moderne mit Glasbüro
  fabrik(k, L = 6, v = 0) {
    if (L >= 7) {
      // Halle mit heller Verkleidung, farbigem Band, Solardach, Lichtbändern, Glasbüro mit Logo, Rampen, Silo, schlanker Schlot
      const band = ['#2f6f9a', '#c8553d', '#2f8a6a'][v];
      body(k, 0.66, 0.36, 0.48, 0.1, 0, -0.14, '#e4e2dc', 0.016);
      ribs(k, 0, 0.66, 0, 0.36, 0.1, '#d2cfc8', 0.035, 0.1);
      k.box(0.668, 0.035, 0.488, 0.1, 0.3, -0.14, band);
      k.box(0.68, 0.02, 0.5, 0.1, 0.36, -0.14, '#8f969c');
      solar(k, 0.1, 0.37, -0.22, 5, 2); for (const x of [-0.12, 0.32]) skylight(k, x, 0.37, 0.02, 0.12, 0.06);
      for (let i = 0; i < 2; i++) { const x = 0.2 + i * 0.16; k.box(0.12, 0.17, 0.01, x, 0.03, 0.104, '#c9ccd0'); if (k.fine()) for (let j = 1; j < 6; j++) k.box(0.12, 0.004, 0.012, x, 0.03 + j * 0.028, 0.105, '#a9b0b6'); k.box(0.14, 0.05, 0.05, x, 0, 0.13, '#9a958c'); }
      // Glasbüro zweigeschossig vorn links
      body(k, 0.26, 0.3, 0.2, -0.3, 0, 0.18, '#f2efe8', 0.012);
      for (const y of [0.04, 0.18]) { k.box(0.24, 0.1, 0.012, -0.3, y, 0.282, GLASS, 'win'); if (k.fine()) for (let i = 0; i <= 4; i++) k.box(0.008, 0.1, 0.016, -0.42 + i * 0.06, y, 0.284, ANTH); }
      k.box(0.18, 0.04, 0.012, 0.28, 0.215, 0.106, band); if (k.fine()) for (let i = 0; i < 5; i++) k.box(0.022, 0.024, 0.006, 0.214 + i * 0.033, 0.223, 0.114, '#f4f1ea');
      k.cyl(0.07, 0.07, 0.5, 14, 0.42, 0, 0.3, '#c9ccd0'); k.cone(0.074, 0.05, 14, 0.42, 0.5, 0.3, '#aeb4ba');
      k.cyl(0.022, 0.026, 0.7, 10, -0.2, 0.36, -0.3, '#c9ccd0'); k.cyl(0.03, 0.03, 0.03, 10, -0.2, 1.06, -0.3, '#c8553d'); k.smoke.push([-0.2, 1.12, -0.3]);
      for (let i = 0; i < 3; i++) pallet(k, 0.02 + i * 0.075, 0.3, ['#d9d4ca', '#c9a27a', '#e2d3ae'][i]);
      return;
    }
    // Backsteinfabrik: lange Halle mit Sheddach und Bogenfenstern, zwei Schlote, Wasserturm, Kontor mit Uhr, Gleis mit Wagen
    const br = BRICK[v % BRICK.length];
    k.plinth(0.78, 0.4, '#9a958c', 0.04, -0.14);
    k.walls(0.78, 0.32, 0.4, 0.06, br, '#e8dcc6', 0.04, -0.14);
    sawtooth(k, 0.04, 0.78, 0.4, 0.38, 4, SLATE[0][0], GLASS, -0.14);
    for (let i = 0; i < 5; i++) pane(k, 0, -0.26 + i * 0.13, 0.22, 0.06, 0.07, 0.12, { arch: true, frame: '#e8dcc6' });
    for (const x of [-0.3, 0.38]) k.box(0.02, 0.32, 0.02, x, 0.06, 0.065, jit(br, 0.85));
    stack(k, 0.3, -0.42, 1.25, 0.065); stack(k, -0.12, -0.42, 1.0, 0.055);
    waterTower(k, -0.4, -0.36, 0.52);
    // Kontor mit Giebel und Uhr
    k.plinth(0.24, 0.18, '#9a958c', -0.3, 0.24);
    k.walls(0.24, 0.26, 0.18, 0.06, PLASTER[(v + 1) % 8], STONE[0], -0.3, 0.24);
    k.roof(0.18, 0.24, 0.12, 0.32, SLATE[v % 2], { rows: 3, gable: PLASTER[(v + 1) % 8], ry: Math.PI / 2, x: -0.3, z: 0.24 });
    k.door(0, -0.3, 0.33, false);
    clock(k, -0.3, 0.38, 0.334, 0.03);
    rails(k, -0.14, 0.3, 0.48, 0.3);
    if (k.fine()) { k.box(0.16, 0.06, 0.06, 0.2, 0.03, 0.3, '#5d5650'); k.box(0.14, 0.05, 0.05, 0.2, 0.09, 0.3, '#6e543e'); for (const x of [0.15, 0.25]) for (const s of [-1, 1]) k.add(new THREE.CylinderGeometry(0.016, 0.016, 0.01, 8).rotateX(Math.PI / 2).translate(x, 0.02, 0.3 + s * 0.028), '#2f2b2c'); }
    for (let i = 0; i < 3; i++) k.box(0.06, 0.06, 0.06, 0.4 - (i % 2) * 0.07, Math.floor(i / 2) * 0.06, 0.16, WOOD2);
  },
  // Kraftwerk (Runde 2): Kohlekraftwerk mit Schloten und Kohlenhalde, Kraftwerk der Moderne mit Kühlturm, Windrad, Masten
  kraftwerk(k, L = 6, v = 0) {
    const yard = (x, z) => {
      k.box(0.24, 0.012, 0.16, x, 0, z, '#bdb8af');
      for (let i = 0; i < 3; i++) { rbx(k, 0.05, 0.06, 0.05, x - 0.08 + i * 0.08, 0.012, z, '#8f989e', 0.006); if (k.fine()) for (const s of [-1, 1]) k.cyl(0.006, 0.006, 0.04, 5, x - 0.08 + i * 0.08 + s * 0.012, 0.07, z, '#e8e2d6'); }
      if (k.fine()) fence(k, x - 0.13, z + 0.09, x + 0.13, z + 0.09, '#9aa1a8', 0.04, 0.06);
    };
    if (L >= 7) {
      // Kühlturm mit Rippen und Rand, Dampf, Turbinenhaus mit blauem Band, Umspannwerk, Mast, Windrad
      const pts = [];
      for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(0.3 - Math.sin(t * Math.PI * 0.92) * 0.1 + t * 0.02, t * 0.86)); }
      k.add(new THREE.LatheGeometry(pts, 28).translate(-0.16, 0, -0.16), '#e6e2da');
      if (k.fine()) { for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; k.box(0.014, 0.08, 0.014, -0.16 + Math.cos(a) * 0.29, 0, -0.16 + Math.sin(a) * 0.29, '#cfcac2', null, -a); } k.add(new THREE.TorusGeometry(0.22, 0.012, 4, 28).rotateX(Math.PI / 2).translate(-0.16, 0.86, -0.16), '#cfcac2'); }
      k.smoke.push([-0.16, 0.92, -0.16]); k.smoke.push([-0.1, 0.94, -0.2]);
      body(k, 0.36, 0.24, 0.22, 0.18, 0, 0.12, '#f2efe8', 0.014);
      k.box(0.364, 0.035, 0.224, 0.18, 0.17, 0.12, '#2f6f9a');
      for (let i = 0; i < 4; i++) mwin(k, 0, 0.06 + i * 0.08, 0.1, 0.23, 0.05, 0.08, { frame: '#5d6670', sill: false });
      k.box(0.38, 0.016, 0.24, 0.18, 0.24, 0.12, '#8f969c'); acUnit(k, 0.1, 0.256, 0.1); acUnit(k, 0.26, 0.256, 0.1);
      yard(-0.2, 0.32);
      pylon(k, 0.4, 0.36, 0.62);
      // Windrad: Turm, Gondel, Rotor dreht sich (k.rotor)
      k.cyl(0.014, 0.024, 0.84, 10, 0.36, 0, -0.34, '#f4f2ee');
      rbx(k, 0.05, 0.04, 0.09, 0.36, 0.84, -0.34, '#f4f2ee', 0.012);
      const r = new Kit(11);
      for (let i = 0; i < 3; i++) r.add(new THREE.BoxGeometry(0.03, 0.34, 0.008).translate(0, 0.17, 0).scale(1, 1, 1).rotateZ(i * Math.PI * 2 / 3), '#f4f2ee');
      r.ball(0.022, 0, 0, 0.01, '#f4f2ee');
      k.rotor = { geo: r.build(), pos: [0.36, 0.86, -0.28] };
      return;
    }
    // Kohlekraftwerk: Turbinenhalle aus Backstein mit hohen Bogenfenstern, drei Schlote, Kohlenhalde mit Förderband, Umspannwerk
    const br = BRICK[(v + 2) % BRICK.length];
    k.plinth(0.56, 0.36, '#9a958c', -0.08, -0.12);
    k.walls(0.56, 0.4, 0.36, 0.06, br, '#e8dcc6', -0.08, -0.12);
    k.roof(0.56, 0.36, 0.14, 0.46, SLATE[0], { rows: 4, gable: br, x: -0.08, z: -0.12 });
    for (let i = 0; i < 4; i++) pane(k, 0, -0.29 + i * 0.14, 0.26, 0.06, 0.06, 0.2, { arch: true, frame: '#e8dcc6' });
    for (const [x, h] of [[-0.24, 1.2], [-0.08, 1.3], [0.08, 1.2]]) stack(k, x, -0.38, h, 0.05);
    heap(k, 0.32, 0.22, 0.14, 0.13, '#2f2b2c');
    k.add(new THREE.BoxGeometry(0.05, 0.016, 0.34).rotateX(-0.6).translate(0.3, 0.26, 0.0).rotateY(0.3), '#4a4f55');
    yard(-0.24, 0.3);
    pylon(k, 0.38, -0.3, 0.6);
  },
  rakete(k) {
    k.box(1.2, 0.06, 1.2, 0, 0, 0, '#a39e98');
    for (const x of [-0.42, -0.26]) k.box(0.05, 2.6, 0.05, x, 0, -0.3, '#d0644a');
    for (let y = 0.2; y < 2.6; y += 0.3) k.box(0.2, 0.03, 0.03, -0.34, y, -0.3, '#d0644a');
    k.cyl(0.16, 0.16, 2.0, 14, 0, 0.06, 0, '#f4f2ee');
    k.cone(0.16, 0.45, 14, 0, 2.06, 0, '#d0644a');
    for (let a = 0; a < 4; a++) k.box(0.02, 0.3, 0.16, Math.cos(a * Math.PI / 2) * 0.17, 0.06, Math.sin(a * Math.PI / 2) * 0.17, '#3e3a39', null, a * Math.PI / 2);
  },
};

// ---------- Neue Gebäude (seit 17.10.2026): jedes mit eigener Gestalt je Epoche ----------
// L ist die Epoche des Baus (0 Ankunft bis 7 Moderne), v die Spielart 0..2 für Abwechslung.
// Gemeinsames Werkzeug: Anker, Tisch mit Bänken, Wimpelkette
function anvil(k, x, z) {
  k.box(0.07, 0.07, 0.06, x, 0, z, '#5a4a3c');
  k.box(0.05, 0.04, 0.04, x, 0.07, z, '#4a4f55');
  k.box(0.12, 0.035, 0.05, x, 0.11, z, '#3e4348');
  k.add(new THREE.ConeGeometry(0.022, 0.06, 5).rotateZ(-Math.PI / 2).translate(x + 0.088, 0.128, z), '#3e4348');
}
function tableSet(k, x, z, top = WOOD2) {
  k.box(0.18, 0.014, 0.09, x, 0.085, z, top);
  for (const sx of [-1, 1]) k.box(0.014, 0.085, 0.07, x + sx * 0.07, 0, z, DARK);
  for (const sz of [-1, 1]) { k.box(0.18, 0.012, 0.04, x, 0.05, z + sz * 0.08, WOOD); k.box(0.012, 0.05, 0.03, x - 0.07, 0, z + sz * 0.08, DARK); k.box(0.012, 0.05, 0.03, x + 0.07, 0, z + sz * 0.08, DARK); }
  k.cyl(0.012, 0.012, 0.025, 5, x - 0.03, 0.099, z, '#f2e6c8'); k.cyl(0.012, 0.012, 0.025, 5, x + 0.04, 0.099, z + 0.01, '#e9c46a');
}
function umbrellaTable(k, x, z, col) {
  k.cyl(0.05, 0.05, 0.01, 8, x, 0.08, z, '#f4f1ea'); k.cyl(0.006, 0.006, 0.26, 4, x, 0, z, '#5d6670');
  k.cone(0.13, 0.06, 8, x, 0.24, z, col);
  for (const a of [0.4, 2.2, 4.1]) k.box(0.04, 0.05, 0.04, x + Math.cos(a) * 0.08, 0, z + Math.sin(a) * 0.08, '#c9a27a');
}
// Lichterkette zwischen zwei Punkten mit Durchhang (leuchtet immer leicht, nachts stark)
function lights(k, x0, y0, z0, x1, y1, z1, n = 7, sag = 0.05) {
  for (let i = 0; i <= n; i++) { const t = i / n; k.ball(0.011, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * sag, z0 + (z1 - z0) * t, i % 2 ? '#ffd27a' : '#fff1c8', 'glow', 0); }
}
// Laden der Moderne im Stil von Naders Vorbildern (seit 24.10.2026, PLAN_GRAFIK.md: Café mit Glasfront, Buchladen,
// Laden mit Markise auf einem Sockel aus Gehweg): zwei Geschosse, Schaufenster mit Sprossen und Glastür, Schildband
// mit Schrift, gestreifte Markise mit Volant, Ausleger, Fenster oben mit Blumenkästen, Gesims und Attika, Dach mit
// Wassertank, Technik oder Garten, davor Kübelbäume, Aufsteller, Bank oder Tische, Fahrrad, Laterne. Front +z.
// o: tone Wandfarben je Variante, sign Schildfarbe, aw Markisen je Variante, emblem Geometrie für Schild und Ausleger,
// tables Tische draußen, smoke Edelstahlrohr mit Rauch, goods (k, x, y, z) Ware vor dem Fenster
function shop(k, v, o) {
  const tone = o.tone[v % o.tone.length], aw = o.aw[v % o.aw.length], sc = o.sign || '#2f3b44';
  const W = 0.62, D = 0.44, cz = -0.06, zf = cz + D / 2, H1 = 0.3, H2 = 0.26, y0 = 0.03, top = y0 + H1 + H2;
  const fine = k.fine();
  // Gehweg als Sockel mit Bordstein
  k.add(roundBox(0.86, 0.04, 0.72, 0.014).translate(0, 0.0, 0.02), '#d8d3ca');
  if (fine) for (const [x, z, w, d] of [[0, 0.375, 0.86, 0.03], [0.428, 0.02, 0.03, 0.72], [-0.428, 0.02, 0.03, 0.72]]) k.box(w, 0.045, d, x, -0.005, z, '#bdb8af');
  k.walls(W, H1 + H2, D, y0, tone, null, 0, cz);
  // Ecklisenen, Gesims, Attika mit Abdeckung, Flachdach
  const dark = jit(tone, 0.9), lite = jit(tone, 1.07);
  for (const sx of [-1, 1]) k.box(0.04, H1 + H2, 0.04, sx * (W / 2 - 0.004), y0, zf - 0.004, dark);
  k.add(roundBox(W + 0.04, 0.035, D + 0.04, 0.012).translate(0, top - 0.01, cz), lite);
  attika(k, W + 0.02, D + 0.02, top + 0.02, tone, { z: cz, h: 0.05, t: 0.03 });
  k.box(W - 0.02, 0.012, D - 0.02, 0, top + 0.02, cz, '#8f969c');
  // Erdgeschoss: Schaufenster, Glastür, Sockelstreifen
  const gx0 = -W / 2 + 0.05, gx1 = W / 2 - 0.05, gw = gx1 - gx0, gy = y0 + 0.035, gh = H1 - 0.1;
  k.box(gw, gh, 0.016, (gx0 + gx1) / 2, gy, zf + 0.002, GLASS, 'win');
  k.box(gw + 0.03, 0.03, 0.03, (gx0 + gx1) / 2, y0, zf + 0.01, '#5d6670');
  const nM = 4, door = o.door ?? 0.12;
  for (let i = 0; i <= nM; i++) k.box(0.014, gh, 0.03, gx0 + i * gw / nM, gy, zf + 0.012, '#3e4348');
  k.box(gw, 0.014, 0.03, (gx0 + gx1) / 2, gy + gh * 0.78, zf + 0.012, '#3e4348');
  k.box(gw + 0.02, 0.02, 0.034, (gx0 + gx1) / 2, gy + gh, zf + 0.012, '#3e4348');
  // Tür im ersten Feld: dunkler Rahmen, Griffstange, Stufe
  const dx = gx0 + gw / nM * 0.5;
  k.box(gw / nM - 0.01, gh * 0.76, 0.012, dx, gy, zf + 0.02, '#2f3439');
  if (fine) k.box(0.006, 0.07, 0.012, dx + 0.025, gy + 0.08, zf + 0.03, ALU);
  k.box(gw / nM + 0.04, 0.02, 0.06, dx, y0 - 0.01, zf + 0.03, '#cfcac2');
  // Schildband mit Schrift (helle Buchstabenblöcke) und Emblem
  const sy = y0 + H1 - 0.06;
  k.box(W - 0.06, 0.07, 0.03, 0, sy, zf + 0.015, sc);
  if (fine) {
    const word = o.word || [3, 2, 4], gap = 0.012, lw = 0.022;
    let n = word.reduce((a, b) => a + b, 0) + word.length - 1, x = -n * (lw + gap) / 2 + 0.03;
    for (const len of word) { for (let i = 0; i < len; i++) { k.box(lw, 0.032, 0.008, x, sy + 0.019, zf + 0.032, '#f4ead2'); x += lw + gap; } x += lw + gap; }
    if (o.emblem) k.add(o.emblem().translate(-W / 2 + 0.07, sy + 0.035, zf + 0.036), GOLD);
  }
  // Markise mit Volant über dem Schaufenster
  awning(k, 0.02, sy - 0.018, zf + 0.01, W - 0.1, aw);
  if (fine) { const n = Math.round((W - 0.1) / 0.03); for (let i = 0; i < n; i++) k.add(new THREE.CylinderGeometry(0.014, 0.014, 0.024, 6, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(0.02 - (W - 0.1) / 2 + (i + 0.5) * (W - 0.1) / n, sy - 0.088, zf + 0.115), aw[i % 2]); }
  // Ausleger an der Ecke
  if (o.emblem) hangSign(k, W / 2 + 0.01, y0 + H1 + 0.12, zf + 0.04, sc, o.emblem());
  // Obergeschoss: drei Fenster mit Bänken, Blumenkästen, mittig ein Balkon oder ein großes Fenster
  const uy = y0 + H1 + H2 * 0.52;
  for (const [i, x] of [[0, -0.19], [1, 0], [2, 0.19]]) {
    if (i === 1 && v === 1) { mwin(k, 0, x, uy, zf, 0.11, 0.15, { frame: '#3e4348' }); balcony(k, x, uy - 0.09, zf, 0.16, 0.06, true, lite); continue; }
    mwin(k, 0, x, uy, zf, 0.085, 0.13, { frame: '#f4f1ea', mull: 1 });
    if (fine && (i !== 1 || v === 2)) flowerBox(k, x, uy - 0.1, zf + 0.002, 0.1);
  }
  for (const x of [-0.12, 0.12]) mwin(k, 1, W / 2, uy, cz + x, 0.08, 0.12, { frame: '#f4f1ea' });
  mwin(k, 3, -W / 2, uy, cz, 0.08, 0.12, { frame: '#f4f1ea' });
  // Seite: Fallrohr, Leuchte neben der Tür
  downpipe(k, -W / 2 - 0.012, zf - 0.03, top);
  wallLamp(k, dx - 0.06, y0 + 0.2, zf);
  // Dach: Wassertank (Buchladen), Technik oder Garten
  const ry = top + 0.03;
  if (v === 0) { if (fine) { for (const [a, b] of [[-0.03, -0.03], [0.03, -0.03], [-0.03, 0.03], [0.03, 0.03]]) k.box(0.01, 0.05, 0.01, 0.12 + a, ry, cz + b, '#5a4636'); k.cyl(0.06, 0.06, 0.08, 10, 0.12, ry + 0.05, cz, '#c9b79a'); k.cone(0.065, 0.03, 10, 0.12, ry + 0.13, cz, '#8a7a62'); } acUnit(k, -0.14, ry, cz + 0.05); }
  else if (v === 1) { acUnit(k, 0.1, ry, cz - 0.04); acUnit(k, -0.06, ry, cz - 0.08, Math.PI / 2); vent(k, -0.18, ry, cz + 0.1); skylight(k, 0.05, ry, cz + 0.1); }
  else { k.box(W - 0.12, 0.02, D - 0.14, 0, ry, cz, '#86b06a'); if (fine) for (let i = 0; i < 5; i++) k.ball(0.03, -0.2 + i * 0.1, ry + 0.035, cz + (i % 2 ? 0.08 : -0.06), ['#6f9e52', '#e0679a', '#9fcf74', '#f2c14e', '#7fae5a'][i], null, 1); }
  if (o.smoke) { k.cyl(0.02, 0.02, 0.22, 8, -0.2, ry, cz - 0.12, '#c9ccd0'); k.cyl(0.03, 0.03, 0.02, 8, -0.2, ry + 0.22, cz - 0.12, '#a9b2b7'); k.smoke.push([-0.2, ry + 0.28, cz - 0.12]); }
  // Straße: Kübelbäume, Aufsteller, Bank oder Tische, Fahrrad, Laterne, Ware
  for (const x of [-0.36, 0.36]) { k.box(0.07, 0.06, 0.07, x, 0.015, zf + 0.06, '#cfc8bc'); k.cyl(0.006, 0.008, 0.08, 4, x, 0.075, zf + 0.06, '#6e543e'); k.ball(0.055, x, 0.19, zf + 0.06, x < 0 ? '#6aa64f' : '#7fae5a', null, 1); }
  if (fine) {
    // Aufsteller mit Tafel
    for (const s2 of [-1, 1]) k.add(new THREE.BoxGeometry(0.06, 0.09, 0.006).rotateX(s2 * 0.22).translate(dx + 0.02, 0.06, zf + 0.15 + s2 * 0.012), '#2f3439');
    k.box(0.05, 0.06, 0.004, dx + 0.02, 0.035, zf + 0.168, '#f4ead2');
    bike(k, 0.3, zf + 0.2, 0.1, BIKES[(v + 1) % BIKES.length]);
    // Laterne an der Gehwegecke
    k.cyl(0.008, 0.011, 0.4, 6, -0.4, 0.015, 0.34, '#3e4348'); k.box(0.03, 0.04, 0.03, -0.4, 0.4, 0.34, '#fff1c8', 'glow'); k.cone(0.026, 0.025, 4, -0.4, 0.44, 0.34, '#3e4348', null, Math.PI / 4);
  }
  if (o.tables) { umbrellaTable(k, 0.12, zf + 0.2, aw[0]); if (fine) bench(k, -0.18, zf + 0.22, 0, WOOD2, 0.015); }
  else if (fine) bench(k, -0.06, zf + 0.22, 0, WOOD2, 0.015);
  if (o.goods && fine) o.goods(k, 0.12, y0 + 0.015, zf + 0.09);
}
// ---------- Runde 2 (seit 24.10.2026, PLAN_GRAFIK.md): Helfer für Werkplätze, Industrie und Denkmäler ----------
// Kleinteile nur nah (k.fine), fern bleiben die großen Formen, damit die Bildzeit hält
const rbx = (k, w, h, d, x, y, z, c, r = 0.012, b) => k.add(roundBox(w, h, d, r).translate(x, y + h / 2, z), c, b);
// Baukörper mit runden Kanten: wie rbx, dazu als Block angemeldet, damit kahle Seiten Fenster bekommen (Kit.dress)
const body = (k, w, h, d, x, y, z, c, r = 0.012) => { k.blocks.push({ w, h, d, y0: y, ox: x, oz: z }); return rbx(k, w, h, d, x, y, z, c, r); };
// Stamm entlang x (gedreht um ry) mit hellen Schnittflächen und Kern
function logX(k, x, y, z, len, r, c = '#8a5f3c', ry = 0) {
  k.add(new THREE.CylinderGeometry(r, r * 1.04, len, 9).rotateZ(Math.PI / 2).rotateY(ry).translate(x, y, z), c);
  if (!k.fine()) return;
  for (const s of [-1, 1]) {
    k.add(new THREE.CylinderGeometry(r * 0.92, r * 0.92, 0.006, 9).rotateZ(Math.PI / 2).translate(s * len / 2, 0, 0).rotateY(ry).translate(x, y, z), '#d9b07a');
    k.add(new THREE.CylinderGeometry(r * 0.42, r * 0.42, 0.009, 7).rotateZ(Math.PI / 2).translate(s * len / 2, 0, 0).rotateY(ry).translate(x, y, z), '#c08f5a');
  }
}
// Holzstapel: Stämme in Lagen (n unten, eine weniger je Lage)
function logPile(k, x, z, len, r, n, ry = 0, c = '#8a5f3c') {
  let lay = 0;
  for (let m = n; m > 0; m--, lay++) for (let i = 0; i < m; i++) {
    const off = (i - (m - 1) / 2) * r * 2.02, y = r + lay * r * 1.72;
    logX(k, x + Math.sin(ry) * off, y, z + Math.cos(ry) * off, len * (0.94 + hash(i * 7 + lay, n) * 0.1), r * (0.92 + hash(i + lay * 5, 3) * 0.14), jit(c, 0.9 + hash(i * 3 + lay, 11) * 0.2), ry);
  }
}
// Bretterstapel mit Zwischenlagen
function planks(k, x, z, w, d, n, c = '#d8b27a', y0 = 0, ry = 0) {
  for (let i = 0; i < n; i++) {
    k.add(new THREE.BoxGeometry(w, 0.022, d).translate(0, y0 + 0.011 + i * 0.03, 0).rotateY(ry).translate(x, 0, z), i % 2 ? jit(c, 0.93) : c);
    if (k.fine() && i < n - 1) for (const s of [-0.38, 0, 0.38]) k.add(new THREE.BoxGeometry(0.014, 0.008, d * 1.02).translate(s * w, y0 + 0.026 + i * 0.03, 0).rotateY(ry).translate(x, 0, z), '#7b5a3e');
  }
}
// Felsbrocken mit Farbspiel
function rock(k, x, y, z, r, c = '#a8a198', sy = 0.8) { k.add(new THREE.IcosahedronGeometry(r, 1).scale(1, sy, 0.92).translate(x, y, z), jit(c, 0.92 + hash(x * 97 + z * 31, 5) * 0.16)); }
// Schüttkegel (Schotter, Kohle, Erz, Sägemehl) mit Brocken am Fuß
function heap(k, x, z, r, h, c) {
  k.add(new THREE.ConeGeometry(r, h, 14, 2).translate(x, h / 2, z), c);
  if (k.fine()) for (let i = 0; i < 5; i++) { const a = i * 1.3 + x * 7; rock(k, x + Math.cos(a) * r * 0.95, 0.012, z + Math.sin(a) * r * 0.95, 0.018 + (i % 2) * 0.008, c, 0.7); }
}
// Gleis von (x0, z0) nach (x1, z1) mit Schwellen
function rails(k, x0, z0, x1, z1, y = 0.004, g = 0.05) {
  const len = Math.hypot(x1 - x0, z1 - z0), ang = -Math.atan2(z1 - z0, x1 - x0), mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, nx = -(z1 - z0) / len, nz = (x1 - x0) / len;
  for (const s of [-1, 1]) k.box(len, 0.008, 0.007, mx + nx * s * g / 2, y + 0.008, mz + nz * s * g / 2, '#5d5650', null, ang);
  if (!k.fine()) return;
  const n = Math.max(2, Math.round(len / 0.045));
  for (let i = 0; i <= n; i++) k.box(0.012, 0.008, g + 0.03, x0 + (x1 - x0) * i / n, y, z0 + (z1 - z0) * i / n, '#6e543e', null, ang);
}
// Lore auf dem Gleis, mit Erz oder Kohle
function minecart(k, x, z, ry = 0, load = '#5a5550', y0 = 0.012) {
  const P = (g, c) => k.add(g.rotateY(ry).translate(x, y0, z), c);
  P(new THREE.CylinderGeometry(0.05, 0.036, 0.05, 4, 1).rotateY(Math.PI / 4).scale(1.3, 1, 0.8).translate(0, 0.045, 0), '#6b5a48');
  P(new THREE.BoxGeometry(0.1, 0.008, 0.07).translate(0, 0.072, 0), '#4a4440');
  for (const a of [-1, 1]) for (const b of [-1, 1]) P(new THREE.CylinderGeometry(0.014, 0.014, 0.008, 8).rotateX(Math.PI / 2).translate(a * 0.032, 0.014, b * 0.03), '#2f2b2c');
  if (k.fine()) for (let i = 0; i < 4; i++) P(new THREE.IcosahedronGeometry(0.018, 0).translate((i - 1.5) * 0.02, 0.078 + (i % 2) * 0.006, (i % 2 - 0.5) * 0.02), jit(load, 0.9 + i * 0.05));
}
// Stab zwischen zwei Punkten
const _up = new THREE.Vector3(0, 1, 0);
function strut(k, a, b, r, c, seg = 4, r2 = r) {
  const A = new THREE.Vector3(...a), D = new THREE.Vector3(...b).sub(A), L = D.length();
  if (L < 1e-5) return;
  k.add(new THREE.CylinderGeometry(r2, r, L, seg).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, D.clone().normalize())).translate(A.x + D.x / 2, A.y + D.y / 2, A.z + D.z / 2), c);
}
// Stahlfachwerk: vier Beine mit Riegeln und Kreuzstreben, oben schmaler
function lattice(k, x, z, w, h, c = '#c8553d', n = 6, taper = 0.6, y0 = 0) {
  const top = w * taper / 2, bot = w / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) strut(k, [x + sx * bot, y0, z + sz * bot], [x + sx * top, y0 + h, z + sz * top], 0.009, c, 4, 0.007);
  const fine = k.fine();
  for (let i = 1; i < n; i++) {
    if (!fine && i % 2) continue;
    const t = i / n, hw = bot + (top - bot) * t, y = y0 + h * t;
    for (const s of [-1, 1]) { k.box(hw * 2, 0.007, 0.007, x, y, z + s * hw, c); k.box(0.007, 0.007, hw * 2, x + s * hw, y, z, c); }
    if (!fine) continue;
    const t2 = (i - 1) / n, hw2 = bot + (top - bot) * t2, y2 = y0 + h * t2;
    for (const s of [-1, 1]) {
      const f = i % 2 ? 1 : -1;
      strut(k, [x - f * hw2, y2, z + s * hw2], [x + f * hw, y, z + s * hw], 0.0035, c, 3);
      strut(k, [x + s * hw2, y2, z - f * hw2], [x + s * hw, y, z + f * hw], 0.0035, c, 3);
    }
  }
}
// Speichenrad (Seilrad am Förderturm), Achse entlang z
function spokeWheel(k, x, y, z, r, c = '#3e3a39', n = 8) {
  k.add(new THREE.TorusGeometry(r, r * 0.09, 5, 18).translate(x, y, z), c);
  if (!k.fine()) return;
  for (let i = 0; i < n; i++) k.add(new THREE.BoxGeometry(0.005, r * 2, 0.005).rotateZ(i * Math.PI / n).translate(x, y, z), c);
  k.add(new THREE.CylinderGeometry(r * 0.16, r * 0.16, 0.02, 8).rotateX(Math.PI / 2).translate(x, y, z), c);
}
// Strommast mit Isolatoren
function pylon(k, x, z, h = 0.7, ry = 0, c = '#9aa1a8') {
  lattice(k, x, z, 0.1, h, c, 5, 0.3);
  if (!k.fine()) return;
  for (const [y, w] of [[h * 0.78, 0.22], [h * 0.92, 0.16]]) {
    k.add(new THREE.BoxGeometry(w, 0.008, 0.008).rotateY(ry).translate(x, y, z), c);
    for (const s of [-1, 1]) k.add(new THREE.CylinderGeometry(0.004, 0.004, 0.03, 4).translate(s * w / 2, y - 0.018, 0).rotateY(ry).translate(x, 0, z), '#e8e2d6');
  }
}
// Bagger mit Arm und Schaufel (Front +x, gedreht um ry)
function excavator(k, x, z, ry = 0, col = '#e9b13a') {
  const P = (g, c) => k.add(g.rotateY(ry).translate(x, 0, z), c);
  for (const s of [-1, 1]) P(roundBox(0.16, 0.035, 0.035, 0.016).translate(0, 0.018, s * 0.045), '#2f2b2c');
  P(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 10).translate(0, 0.045, 0), '#3e3a39');
  P(roundBox(0.12, 0.06, 0.1, 0.012).translate(-0.01, 0.085, 0), col);
  P(roundBox(0.05, 0.05, 0.05, 0.008).translate(0.025, 0.14, 0.02), col);
  P(new THREE.BoxGeometry(0.004, 0.036, 0.044).translate(0.051, 0.142, 0.02), '#2c3a44');
  P(new THREE.BoxGeometry(0.012, 0.012, 0.11).rotateY(Math.PI / 2).rotateZ(0.7).translate(0.08, 0.15, -0.02), col);
  P(new THREE.BoxGeometry(0.01, 0.01, 0.09).rotateY(Math.PI / 2).rotateZ(-0.9).translate(0.15, 0.13, -0.02), col);
  P(new THREE.BoxGeometry(0.035, 0.03, 0.04).translate(0.185, 0.07, -0.02), '#5d5650');
}
// Kipplaster (Front +x)
function dumpTruck(k, x, z, ry = 0, col = '#e9b13a') {
  const P = (g, c) => k.add(g.rotateY(ry).translate(x, 0, z), c);
  P(new THREE.BoxGeometry(0.2, 0.02, 0.08).translate(0, 0.04, 0), '#3a3633');
  P(roundBox(0.06, 0.06, 0.08, 0.01).translate(0.07, 0.08, 0), col);
  P(new THREE.BoxGeometry(0.004, 0.03, 0.066).translate(0.101, 0.09, 0), '#2c3a44');
  P(new THREE.CylinderGeometry(0.05, 0.04, 0.12, 4, 1).rotateY(Math.PI / 4).scale(1.1, 0.55, 0.62).rotateZ(Math.PI / 2).translate(-0.04, 0.085, 0), jit(col, 0.85));
  if (k.fine()) for (let i = 0; i < 4; i++) P(new THREE.IcosahedronGeometry(0.016, 0).translate(-0.06 + i * 0.03, 0.11, (i % 2 - 0.5) * 0.02), '#a8a198');
  for (const ax of [0.07, -0.05, -0.09]) for (const s of [-1, 1]) P(new THREE.CylinderGeometry(0.022, 0.022, 0.014, 10).rotateX(Math.PI / 2).translate(ax, 0.022, s * 0.042), '#2a2726');
}
// Gabelstapler mit Palette
function forklift(k, x, z, ry = 0) {
  const P = (g, c) => k.add(g.rotateY(ry).translate(x, 0, z), c);
  P(roundBox(0.07, 0.04, 0.05, 0.008).translate(0, 0.035, 0), '#e9b13a');
  for (const s of [-1, 1]) P(new THREE.BoxGeometry(0.004, 0.06, 0.004).translate(-0.02, 0.085, s * 0.02), '#2f2b2c');
  P(new THREE.BoxGeometry(0.044, 0.004, 0.05).translate(-0.01, 0.116, 0), '#2f2b2c');
  P(new THREE.BoxGeometry(0.006, 0.1, 0.04).translate(0.04, 0.06, 0), '#3e3a39');
  P(new THREE.BoxGeometry(0.05, 0.03, 0.05).translate(0.07, 0.03, 0), '#c9a27a');
  for (const a of [0.022, -0.022]) for (const s of [-1, 1]) P(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 8).rotateX(Math.PI / 2).translate(a, 0.012, s * 0.028), '#2a2726');
}
// Palette mit eingeschweißter Ware
function pallet(k, x, z, c = '#d9d4ca', h = 0.05, ry = 0) {
  k.add(new THREE.BoxGeometry(0.07, 0.012, 0.07).rotateY(ry).translate(x, 0.006, z), '#c9a27a');
  k.add(roundBox(0.064, h, 0.064, 0.006).rotateY(ry).translate(x, 0.012 + h / 2, z), c);
}
// Wellblechfassade: senkrechte Rippen auf einer Seite (face 0 vorn) eines Kastens w x h an der Stelle d, Mitte bei x0
function ribs(k, face, w, y0, h, d, c, step = 0.03, x0 = 0) {
  if (!k.fine()) return;
  const n = Math.floor(w / step);
  for (let i = 1; i < n; i++) fgeo(k, face, new THREE.BoxGeometry(0.006, h, 0.006), x0 - w / 2 + i * w / n, y0 + h / 2, d + 0.002, c);
}
// Sheddach (Sägezahn) über einer Halle: n Zähne entlang x, steile Glasseite nach hinten (Nordlicht)
function sawtooth(k, x0, w, d, y, n, roofC, glass = GLASS, z = 0, hgt = 0.12) {
  const tw = w / n;
  for (let i = 0; i < n; i++) {
    const cx = x0 - w / 2 + (i + 0.5) * tw, L = Math.hypot(tw, hgt);
    k.add(new THREE.BoxGeometry(L, 0.016, d + 0.02).rotateZ(Math.atan2(hgt, tw)).translate(cx, y + hgt / 2, z), roofC);
    k.add(new THREE.BoxGeometry(0.01, hgt, d).translate(cx + tw / 2 - 0.004, y + hgt / 2, z), glass, 'win');
    if (k.fine()) for (let j = 1; j < 6; j++) k.box(0.012, hgt, 0.006, cx + tw / 2, y, z - d / 2 + j * d / 6, ANTH);
  }
}
// Fabrikschlot aus Backstein mit Bändern und Kopf
function stack(k, x, z, h, r = 0.06, c = '#9a5a44', smoke = true) {
  k.cyl(r * 0.72, r, h, 12, x, 0, z, c);
  k.cyl(r * 0.86, r * 0.86, 0.04, 12, x, h - 0.04, z, jit(c, 0.8));
  if (k.fine()) for (const t of [0.35, 0.7]) k.cyl(r * (1 - t * 0.28) + 0.004, r * (1 - t * 0.28) + 0.004, 0.016, 12, x, h * t, z, jit(c, 1.12));
  if (smoke) k.smoke.push([x, h + 0.05, z]);
}
// Wasserturm: Tank auf Stelzen
function waterTower(k, x, z, h = 0.5, c = '#9a6b44') {
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.cyl(0.007, 0.009, h, 4, x + a * 0.05, 0, z + b * 0.05, '#55504c');
  if (k.fine()) for (const y of [h * 0.35, h * 0.7]) { k.box(0.1, 0.006, 0.006, x, y, z + 0.05, '#55504c'); k.box(0.1, 0.006, 0.006, x, y, z - 0.05, '#55504c'); k.box(0.006, 0.006, 0.1, x + 0.05, y, z, '#55504c'); k.box(0.006, 0.006, 0.1, x - 0.05, y, z, '#55504c'); }
  k.cyl(0.075, 0.075, 0.12, 12, x, h, z, c);
  if (k.fine()) for (let i = 0; i < 3; i++) k.cyl(0.077, 0.077, 0.006, 12, x, h + 0.02 + i * 0.04, z, '#5d5650');
  k.cone(0.082, 0.05, 12, x, h + 0.12, z, '#6d6660');
}
// Ringausschnitt (Sitzreihen, Mauerbögen): Innen- und Außenradius, Höhe, Winkel a0 bis a1 in der Ebene, Boden auf 0.
// Winkel 0 bis Pi liegt auf der Seite minus z
function ringSector(rIn, rOut, h, a0, a1) {
  const sh = new THREE.Shape();
  sh.moveTo(Math.cos(a0) * rOut, Math.sin(a0) * rOut); sh.absarc(0, 0, rOut, a0, a1, false);
  sh.lineTo(Math.cos(a1) * rIn, Math.sin(a1) * rIn); sh.absarc(0, 0, rIn, a1, a0, true); sh.closePath();
  return new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false, curveSegments: 20 }).rotateX(-Math.PI / 2);
}
// Teile einer Figur aus Drehkörpern (Statue des Gottes): Tropfen aus Kugel und Kegel
const dropG = (r, y) => mergeGeometries([new THREE.SphereGeometry(r, 12, 9).translate(0, y, 0), new THREE.ConeGeometry(r * 0.86, r * 1.7, 12).translate(0, y + r * 1.2, 0)]);
// Der Geist als Statue: Kapuzengewand, Arme gehoben, in den Händen der Regentropfen. mat: Stein, Bronze, Marmor
function spirit(k, x, y0, z, s, mat, dropC = '#bfe6ff') {
  // Gewand: weiter Saum, schmale Taille, breite Schultern mit Umhang
  const pts = [[0.0, 0], [0.125, 0], [0.12, 0.03], [0.095, 0.12], [0.07, 0.22], [0.072, 0.27], [0.09, 0.32], [0.085, 0.35], [0.05, 0.38], [0.0, 0.385]].map(([r, h]) => new THREE.Vector2(r * s, h * s));
  k.add(new THREE.LatheGeometry(pts, 18).scale(1, 1, 0.82).translate(x, y0, z), mat);
  // Kapuze mit dunkler Öffnung zur Front
  k.add(new THREE.SphereGeometry(0.058 * s, 14, 10).scale(1, 1.12, 1.05).translate(x, y0 + 0.43 * s, z - 0.006 * s), mat);
  k.add(new THREE.ConeGeometry(0.04 * s, 0.05 * s, 10).rotateX(-0.6).translate(x, y0 + 0.49 * s, z - 0.03 * s), mat);
  k.add(new THREE.SphereGeometry(0.034 * s, 10, 8).scale(1, 1.1, 0.45).translate(x, y0 + 0.425 * s, z + 0.044 * s), jit(mat, 0.42));
  // Arme weit nach oben, Ärmel weit, Hände halten den Tropfen über dem Kopf
  for (const sx of [-1, 1]) {
    const e = [x + sx * 0.1 * s, y0 + 0.45 * s, z + 0.012 * s], b = [x + sx * 0.05 * s, y0 + 0.58 * s, z + 0.025 * s];
    strut(k, [x + sx * 0.075 * s, y0 + 0.33 * s, z], e, 0.03 * s, mat, 8, 0.024 * s);
    strut(k, e, b, 0.024 * s, mat, 8, 0.017 * s);
    k.ball(0.019 * s, b[0], b[1], b[2], mat, null, 1);
  }
  k.add(dropG(0.045 * s, 0).translate(x, y0 + 0.62 * s, z + 0.025 * s), dropC, 'glow');
  // Falten im Gewand (nah)
  if (k.fine()) for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.3; k.add(new THREE.CylinderGeometry(0.008 * s, 0.014 * s, 0.26 * s, 5).translate(x + Math.cos(a) * 0.105 * s, y0 + 0.13 * s, z + Math.sin(a) * 0.105 * s), jit(mat, 0.94)); }
}

// Kuppel als Halbkugel mit eigener Feinheit
const domeG = (r, seg = 14, rings = 6, sy = 1) => new THREE.SphereGeometry(r, seg, rings, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, sy, 1);
// Halbe Tonne, First entlang x, Rundung nach oben
const vaultG = (r, len, seg = 12, open = false) => new THREE.CylinderGeometry(r, r, len, seg, 1, open, 0, Math.PI).rotateZ(Math.PI / 2);
// Uhr auf der Front (+z)
function clock(k, x, y, z, r = 0.06) {
  k.add(new THREE.CylinderGeometry(r + 0.01, r + 0.01, 0.012, 14).rotateX(Math.PI / 2).translate(x, y, z), '#e9b44c');
  k.add(new THREE.CylinderGeometry(r, r, 0.016, 14).rotateX(Math.PI / 2).translate(x, y, z + 0.002), '#fff6dc', 'win');
  k.box(0.006, r * 0.75, 0.006, x, y, z + 0.012, DARK); k.box(r * 0.55, 0.006, 0.006, x + r * 0.27, y, z + 0.012, DARK);
}
// Wappenschild auf der Front (+z)
function crest(k, x, y, z, c) {
  k.box(0.1, 0.1, 0.015, x, y - 0.1, z, c);
  k.add(new THREE.BoxGeometry(0.071, 0.071, 0.015).rotateZ(Math.PI / 4).translate(x, y - 0.1, z), c);
  k.box(0.11, 0.015, 0.02, x, y - 0.015, z, GOLD);
  k.ball(0.022, x, y - 0.06, z + 0.012, GOLD, null, 0);
}

const NEW = {
  // Ahnenpfahl: bemalter Schnitzpfahl mit Donnervogel, später Ahnenstein, Bildstock, Gedenksäule, Obelisk, Skulptur
  totem(k, L, v) {
    const P = [['#c8553d', '#2f6f73', '#e9c46a'], ['#3d6a8a', '#d98a4e', '#f2e6c8'], ['#7a4f9a', '#e9c46a', '#5fa8a0']][v];
    if (L <= 2) {
      for (let a = 0; a < 7; a++) k.ball(0.045, Math.cos(a * 0.9) * 0.25, 0.012, Math.sin(a * 0.9) * 0.25, STONE[a % 3], null, 0);
      let y = 0;
      if (L === 2) { k.box(0.24, 0.08, 0.24, 0, 0, 0, STONE[1]); y = 0.08; }
      const segs = 4 + (v % 2);
      for (let i = 0; i < segs; i++) {
        const h = 0.12 + (i % 2) * 0.02, r = 0.065 - i * 0.004;
        k.cyl(r * 0.9, r, h, 8, 0, y, 0, i % 2 ? WOOD2 : '#a87f55');
        k.cyl(r + 0.005, r + 0.005, 0.016, 8, 0, y, 0, P[(i + 2) % 3]);
        for (const sx of [-1, 1]) k.box(0.026, 0.022, 0.02, sx * 0.026, y + h * 0.62, r - 0.003, i % 2 ? '#f4ece0' : P[i % 3]);
        if (i % 2 === 0) k.add(new THREE.ConeGeometry(0.022, 0.07, 4).rotateX(Math.PI / 2).translate(0, y + h * 0.38, r + 0.03), P[(i + 1) % 3]);
        else k.box(0.06, 0.014, 0.02, 0, y + h * 0.25, r - 0.002, DARK);
        y += h;
      }
      // Donnervogel mit ausgebreiteten Flügeln
      k.box(0.34, 0.055, 0.028, 0, y - 0.07, 0, P[0]);
      for (const sx of [-1, 1]) { k.box(0.07, 0.035, 0.03, sx * 0.19, y - 0.045, 0, P[1]); k.box(0.05, 0.02, 0.032, sx * 0.12, y - 0.085, 0.002, P[2]); }
      k.cyl(0.045, 0.055, 0.07, 8, 0, y, 0, '#a87f55');
      k.add(new THREE.ConeGeometry(0.02, 0.08, 4).rotateX(Math.PI / 2).translate(0, y + 0.035, 0.08), P[2]);
      for (const sx of [-1, 1]) k.box(0.018, 0.018, 0.02, sx * 0.022, y + 0.045, 0.045, '#f4ece0');
      // Opfergaben: Schale mit Glut, Blumen, Bänder an Stangen
      k.cyl(0.05, 0.035, 0.03, 8, 0.14, 0, 0.16, '#9a6b44'); k.ball(0.026, 0.14, 0.035, 0.16, '#ffb25a', 'glow', 0);
      for (let i = 0; i < 4; i++) k.ball(0.02, -0.12 + i * 0.04, 0.02, 0.18 + (i % 2) * 0.03, FLOWERS[(i + v) % FLOWERS.length], null, 0);
      if (L >= 1) for (const sx of [-1, 1]) { k.cyl(0.008, 0.008, 0.3, 4, sx * 0.2, 0, -0.12, WOOD); k.box(0.012, 0.12, 0.004, sx * 0.2 + 0.008, 0.16, -0.12, P[sx > 0 ? 1 : 0]); }
      return;
    }
    if (L === 3) {
      // Ahnenstein: zwei Stelen mit Sturz, Altar mit Kerzen
      steps(k, 0.5, 0.36, 2, 0, STONE[1]);
      for (const sx of [-1, 1]) {
        k.box(0.09, 0.5, 0.08, sx * 0.14, 0.06, 0, STONE[0]);
        k.box(0.05, 0.06, 0.012, sx * 0.14, 0.38, 0.042, P[0]);
        k.box(0.04, 0.12, 0.012, sx * 0.14, 0.18, 0.042, STONE[2]);
      }
      k.box(0.44, 0.07, 0.11, 0, 0.56, 0, STONE[1]);
      k.box(0.18, 0.04, 0.012, 0, 0.575, 0.056, P[1]);
      k.box(0.16, 0.2, 0.06, 0, 0.06, -0.01, STONE[2]);
      for (const x of [-0.05, 0, 0.05]) { k.cyl(0.008, 0.008, 0.04, 5, x, 0.26, 0.0, '#f4ece0'); k.ball(0.01, x, 0.31, 0.0, '#ffd27a', 'glow', 0); }
      for (let i = 0; i < 5; i++) k.ball(0.02, -0.16 + i * 0.08, 0.075, 0.16, FLOWERS[(i + v) % FLOWERS.length], null, 0);
      return;
    }
    if (L === 4) {
      // Bildstock: Pfeiler mit Häuschen, Nische mit Licht, Bank
      steps(k, 0.3, 0.3, 2, 0, STONE[1]);
      k.box(0.09, 0.42, 0.09, 0, 0.06, 0, STONE[0]);
      k.box(0.17, 0.17, 0.14, 0, 0.48, 0, STONE[2]);
      k.box(0.1, 0.1, 0.02, 0, 0.51, 0.065, '#3b302a');
      k.box(0.06, 0.07, 0.01, 0, 0.525, 0.07, P[1]);
      k.ball(0.014, 0, 0.52, 0.08, '#ffd27a', 'glow', 0);
      k.roof(0.19, 0.17, 0.12, 0.65, ROOF_MIX[(v * 2) % ROOF_MIX.length], { rows: 2, over: 0.02, gable: STONE[2], moss: 0.15 });
      k.box(0.012, 0.08, 0.012, 0, 0.76, 0, DARK); k.box(0.045, 0.012, 0.012, 0, 0.8, 0, DARK);
      for (let i = 0; i < 4; i++) k.ball(0.022, -0.12 + i * 0.08, 0.02, 0.2, FLOWERS[(i + v) % FLOWERS.length], null, 0);
      bench(k, 0.3, 0.05, -Math.PI / 2);
      return;
    }
    if (L === 5) {
      // Gedenksäule mit goldener Ahnengestalt
      steps(k, 0.5, 0.5, 3, 0, STONE[1]);
      k.box(0.2, 0.2, 0.2, 0, 0.09, 0, STONE[0]); k.box(0.24, 0.03, 0.24, 0, 0.29, 0, STONE[2]);
      k.box(0.12, 0.08, 0.01, 0, 0.15, 0.1, '#a9824a');
      k.cyl(0.04, 0.05, 0.5, 10, 0, 0.32, 0, MARBLE); k.box(0.11, 0.04, 0.11, 0, 0.82, 0, MARBLE);
      k.cone(0.045, 0.14, 8, 0, 0.86, 0, GOLD); k.ball(0.028, 0, 1.02, 0, GOLD);
      k.add(new THREE.TorusGeometry(0.04, 0.006, 4, 12).translate(0, 1.04, -0.012), '#ffe08a');
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { k.box(0.025, 0.06, 0.025, sx * 0.21, 0.09, sz * 0.21, STONE[2]); k.ball(0.014, sx * 0.21, 0.165, sz * 0.21, '#ffd27a', 'glow', 0); }
      return;
    }
    if (L === 6) {
      // Obelisk mit Kranz und eisernem Gitter
      steps(k, 0.46, 0.46, 2, 0, '#b9b3a8');
      k.box(0.2, 0.12, 0.2, 0, 0.06, 0, '#a9a49b');
      k.add(new THREE.CylinderGeometry(0.045, 0.08, 0.75, 4).rotateY(Math.PI / 4).translate(0, 0.18 + 0.375, 0), '#c9c2b6');
      k.add(new THREE.ConeGeometry(0.045, 0.08, 4).rotateY(Math.PI / 4).translate(0, 0.97, 0), GOLD);
      k.add(new THREE.TorusGeometry(0.05, 0.016, 5, 12).translate(0, 0.32, 0.075), HEDGE);
      k.box(0.02, 0.06, 0.012, 0.012, 0.24, 0.085, CRIMSON);
      fence(k, -0.22, -0.22, 0.22, -0.22, DARK, 0.07, 0.09); fence(k, -0.22, -0.22, -0.22, 0.22, DARK, 0.07, 0.09); fence(k, 0.22, -0.22, 0.22, 0.22, DARK, 0.07, 0.09);
      fence(k, -0.22, 0.22, -0.07, 0.22, DARK, 0.07, 0.09); fence(k, 0.07, 0.22, 0.22, 0.22, DARK, 0.07, 0.09);
      return;
    }
    // Moderne: Kette aus Ringen auf einem Platz, Lichtband, Bänke, Bäumchen
    k.box(0.82, 0.03, 0.82, 0, 0, 0, '#e4dfd6');
    let y = 0.03;
    for (let i = 0; i < 3; i++) {
      const r = 0.13 - i * 0.025;
      k.add(new THREE.TorusGeometry(r, 0.024, 6, 18).rotateY(i * 0.9 + v).translate(0, y + r, 0), [P[0], GOLD, P[1]][i]);
      y += r * 2 - 0.03;
    }
    k.box(0.5, 0.012, 0.03, 0, 0.03, 0.26, '#fff1c8', 'win');
    bench(k, -0.26, 0.33, Math.PI); bench(k, 0.26, 0.33, Math.PI);
    for (const sx of [-1, 1]) { k.box(0.13, 0.08, 0.13, sx * 0.3, 0.03, -0.3, '#cfc8bc'); tree(k, sx * 0.3, -0.3, 0.7, sx > 0 ? '#86bd5a' : '#e9a7b8', 0.11); }
  },

  // Räucherhütte: Trockengestell über Glut, Rauchhütte, Räucherturm mit Laden, Feinkost
  raeucherei(k, L, v) {
    const fish = (x, y, z, n, dx = 0.045) => {
      for (let i = 0; i < n; i++) {
        const xx = x + (i - (n - 1) / 2) * dx;
        k.box(0.004, 0.03, 0.004, xx, y - 0.03, z, DARK);
        k.add(new THREE.IcosahedronGeometry(0.018, 0).scale(0.55, 1.6, 0.4).translate(xx, y - 0.06, z), i % 3 === 1 ? '#c98f5a' : i % 3 ? '#b8743f' : '#d9a066');
      }
    };
    const rack = (x, z) => {
      for (const dx of [-0.1, 0.1]) k.cyl(0.01, 0.012, 0.36, 4, x + dx, 0, z, WOOD);
      k.add(new THREE.CylinderGeometry(0.008, 0.008, 0.24, 4).rotateZ(Math.PI / 2).translate(x, 0.34, z), WOOD);
      fish(x, 0.34, z, 4);
    };
    if (L === 0) {
      // Trockengestell aus Astgabeln über einer Feuerstelle, Windschutz aus Fellen
      for (const sx of [-1, 1]) k.cyl(0.012, 0.016, 0.42, 5, sx * 0.24, 0, 0.05, WOOD);
      k.add(new THREE.CylinderGeometry(0.01, 0.01, 0.56, 5).rotateZ(Math.PI / 2).translate(0, 0.4, 0.05), WOOD);
      fish(0, 0.4, 0.05, 7);
      for (let a = 0; a < 6; a++) k.ball(0.035, Math.cos(a) * 0.1, 0.01, 0.05 + Math.sin(a) * 0.1, '#8f8a82', null, 0);
      k.cone(0.06, 0.1, 6, 0, 0, 0.05, '#ff9b3d', 'glow');
      k.smoke.push([0, 0.25, 0.05]);
      k.add(new THREE.BoxGeometry(0.5, 0.02, 0.32).rotateX(-0.9).translate(0, 0.16, -0.26), '#a8865f');
      for (const sx of [-1, 1]) k.cyl(0.01, 0.01, 0.3, 4, sx * 0.24, 0, -0.16, WOOD);
      return;
    }
    if (L <= 2) {
      if (L === 1) {
        k.cyl(0.2, 0.22, 0.24, 10, -0.08, 0, -0.08, '#c9a27a');
        k.coneRoof(0.3, 0.34, 0.22, THATCH[v % 2], -0.08, -0.08, 3);
        k.door(0, -0.08, 0.13, true, '#6e543e');
        k.smoke.push([-0.08, 0.66, -0.08]);
      } else {
        k.plinth(0.44, 0.36, STONE[1], -0.06, -0.08);
        k.walls(0.44, 0.26, 0.36, 0.06, '#e6d6b6', null, -0.06, -0.08); k.beams(0.44, 0.26, 0.36, 0.06, -0.06, -0.08);
        k.roof(0.44, 0.36, 0.24, 0.32, THATCH[v % 2], { rows: 3, gable: '#e0cfaa', x: -0.06, z: -0.08 });
        k.box(0.1, 0.07, 0.1, -0.06, 0.52, -0.08, '#a07a52');
        k.add(new THREE.ConeGeometry(0.1, 0.06, 4).rotateY(Math.PI / 4).translate(-0.06, 0.62, -0.08), THATCH[v % 2][1]);
        k.smoke.push([-0.06, 0.68, -0.08]);
        k.door(0, -0.14, 0.1, false, WOOD);
      }
      rack(0.3, 0.28);
      barrel(k, -0.34, 0.3); barrel(k, -0.24, 0.34);
      return;
    }
    if (L <= 5) {
      // Räucherturm aus Stein mit Lüftungshaube, daneben der Laden
      const wall = L === 3 ? STONE[2] : L === 4 ? PLASTER[(v + 1) % 8] : PLASTER[(v + 5) % 8];
      const roofC = L === 3 ? TERRA[v % 2] : SLATE[v % 2];
      const tx = -0.2, tz = -0.18;
      k.plinth(0.28, 0.28, STONE[1], tx, tz);
      k.walls(0.28, 0.62, 0.28, 0.06, STONE[(v + 1) % 3], '#c9b998', tx, tz);
      k.add(new THREE.ConeGeometry(0.24, 0.2, 4).rotateY(Math.PI / 4).translate(tx, 0.78, tz), roofC[0]);
      k.box(0.1, 0.06, 0.1, tx, 0.86, tz, STONE[1]); k.add(new THREE.ConeGeometry(0.1, 0.06, 4).rotateY(Math.PI / 4).translate(tx, 0.95, tz), roofC[1]);
      k.smoke.push([tx, 0.96, tz]);
      for (const dx of [-0.06, 0.06]) k.box(0.022, 0.09, 0.01, tx + dx, 0.45, tz + 0.142, '#3b302a');
      wing(k, 0.14, 0.1, 0.38, 0.3, 0.3, wall, roofC, { rh: 0.16, rows: 3 });
      k.door(0, 0.04, 0.25, true);
      pane(k, 0, 0.22, 0.2, 0.25, 0.09, 0.1);
      if (L >= 4) {
        awning(k, 0.22, 0.32, 0.25, 0.2, AWN[(v + 3) % AWN.length]);
        for (let i = 0; i < 3; i++) k.add(new THREE.IcosahedronGeometry(0.02, 0).scale(1, 1.5, 0.8).translate(0.16 + i * 0.06, 0.22, 0.34), '#a8603f');
      }
      hangSign(k, -0.02, 0.36, 0.27, '#6e543e', new THREE.IcosahedronGeometry(0.022, 0).scale(1.8, 0.8, 0.5));
      barrel(k, 0.38, 0.32);
      return;
    }
    // Industrie: Backsteinladen mit hohem Schlot. Moderne: Feinkost mit Edelstahlrohr und Tischen
    // seit 24.10.2026: die Moderne ist ein Feinkostladen im Stil der Vorbilder (shop), der Rest hier ist die Industriezeit
    if (L >= 7) {
      shop(k, v, { tone: ['#e3ece6', '#f0e4d4', '#dfe3ec'], sign: ['#33424a', '#7a2e2a', '#2f5d4a'][v], aw: [['#33424a', '#f4f1de'], ['#c8553d', '#f4f1de'], ['#2f5d4a', '#f4f1de']], emblem: () => new THREE.IcosahedronGeometry(0.022, 0).scale(1.8, 0.8, 0.5), smoke: true, word: [5, 2],
        goods: (k2, x, y, z) => { k2.box(0.16, 0.05, 0.06, x, y, z, '#c9a27a'); fish(x, y + 0.08, z, 3, 0.04); } });
      return;
    }
    const brick = L === 6, wall = brick ? BRICK[(v * 2) % BRICK.length] : ['#f2efe8', '#e9e2d6', '#f3ede6'][v];
    k.plinth(0.62, 0.42, brick ? '#9a958c' : '#d6d0c6', 0, -0.04);
    k.walls(0.62, 0.42, 0.42, 0.06, wall, brick ? '#e8dcc6' : null, 0, -0.04);
    if (brick) k.roof(0.62, 0.42, 0.2, 0.48, SLATE[v % 2], { rows: 4, gable: wall, z: -0.04, moss: 0.03 });
    else k.box(0.66, 0.04, 0.46, 0, 0.48, -0.04, '#5d6670');
    k.box(0.32, 0.18, 0.02, 0.1, 0.1, 0.172, brick ? '#ffd486' : GLASS, 'win');
    k.box(0.36, 0.025, 0.03, 0.1, 0.28, 0.176, brick ? '#ece2cf' : '#3e4348');
    for (let i = 0; i < 4; i++) k.add(new THREE.IcosahedronGeometry(0.018, 0).scale(1, 1.5, 0.8).translate(0.0 + i * 0.07, 0.24, 0.19), '#a8603f');
    awning(k, 0.1, 0.34, 0.175, 0.38, brick ? AWN[v % AWN.length] : ['#33424a', '#3d4e57']);
    k.box(0.1, 0.2, 0.02, -0.2, 0.06, 0.172, brick ? '#3e5a6a' : '#5d6670');
    if (brick) { k.box(0.1, 0.6, 0.1, -0.2, 0.4, -0.14, BRICK[1]); k.box(0.12, 0.03, 0.12, -0.2, 1.0, -0.14, '#e8dcc6'); k.smoke.push([-0.2, 1.05, -0.14]); }
    else { k.cyl(0.03, 0.03, 0.42, 8, -0.22, 0.5, -0.14, '#c9ccd0'); k.cyl(0.04, 0.04, 0.03, 8, -0.22, 0.92, -0.14, '#a9b2b7'); k.smoke.push([-0.22, 0.98, -0.14]); }
    if (brick) { barrel(k, 0.36, 0.32); barrel(k, 0.27, 0.36); }
    else { umbrellaTable(k, -0.24, 0.34, ['#e07a5f', '#e9c46a', '#5fa8a0'][v]); k.box(0.14, 0.12, 0.08, 0.34, 0.0, 0.32, '#c9a27a'); }
  },

  // Töpferei: Werkplatz mit Drehscheibe und Lehmofen, Werkstatt mit Flaschenofen, Keramikwerk, Studio
  toepferei(k, L, v) {
    const clay = ['#c9774f', '#b8693f', '#d98a5e', '#e2b07a', '#8fa8a0', '#6f8fbf', '#e8d8b8'];
    const pots = (x, z, n, y0 = 0, s = 1) => { for (let i = 0; i < n; i++) pot(k, x + (i - (n - 1) / 2) * 0.07 * s, z + (i % 2) * 0.02, s * (0.85 + (i % 3) * 0.15), clay[(i + v * 2) % clay.length], y0); };
    const kiln = (x, z, s = 1, c = '#c48a62') => {
      k.add(domeG(0.16 * s, 10, 5, 1.2).translate(x, 0, z), c);
      k.box(0.08 * s, 0.07 * s, 0.04, x, 0, z + 0.15 * s, '#3b302a');
      k.box(0.05 * s, 0.04 * s, 0.02, x, 0.01, z + 0.165 * s, '#ff8a3a', 'glow');
      k.cyl(0.035 * s, 0.04 * s, 0.08 * s, 6, x, 0.17 * s, z, '#b8794f');
      k.smoke.push([x, 0.3 * s, z]);
    };
    const bottle = (x, z, s, c) => {
      const prof = [[0.15, 0], [0.16, 0.1], [0.15, 0.22], [0.1, 0.36], [0.06, 0.47], [0.05, 0.58], [0.062, 0.6]].map(([r, y]) => new THREE.Vector2(r * s, y * s));
      k.add(new THREE.LatheGeometry(prof, 12).translate(x, 0, z), c);
      for (const y of [0.1, 0.2]) k.add(new THREE.TorusGeometry(0.162 * s - (y > 0.15 ? 0.008 : 0), 0.008, 3, 14).rotateX(Math.PI / 2).translate(x, y * s, z), '#4a4f55');
      k.box(0.07 * s, 0.08 * s, 0.03, x, 0, z + 0.135 * s, '#3b302a');
      k.box(0.04 * s, 0.04 * s, 0.02, x, 0.01, z + 0.15 * s, '#ff8a3a', 'glow');
      k.smoke.push([x, 0.64 * s, z]);
    };
    if (L <= 2) {
      // offener Werkplatz unter Strohdach
      for (const [x, z] of [[-0.34, -0.08], [0.06, -0.08], [-0.34, 0.24], [0.06, 0.24]]) k.cyl(0.014, 0.016, 0.3, 5, x, 0, z, WOOD);
      k.roof(0.48, 0.4, 0.14, 0.3, THATCH[v % 2], { rows: 3, over: 0.04, x: -0.14, z: 0.08, moss: 0.05 });
      k.cyl(0.02, 0.03, 0.08, 6, -0.1, 0, 0.1, WOOD); k.cyl(0.06, 0.06, 0.015, 10, -0.1, 0.08, 0.1, '#8a6a4c');
      pot(k, -0.1, 0.1, 0.8, clay[0], 0.095);
      k.box(0.36, 0.012, 0.07, -0.14, 0.14, -0.04, WOOD2);
      pots(-0.14, -0.04, 4, 0.152, 0.8);
      kiln(0.28, -0.2);
      pots(0.24, 0.32, 3);
      for (let i = 0; i < 3; i++) k.add(new THREE.CylinderGeometry(0.025, 0.025, 0.2, 6).rotateZ(Math.PI / 2).translate(0.32, 0.025 + i * 0.045, 0.06 - (i % 2) * 0.02), '#9a6b44');
      return;
    }
    if (L <= 5) {
      const wall = L === 3 ? STONE[2] : PLASTER[(v * 3 + 2) % 8];
      const roofC = L === 3 ? TERRA[v % 2] : ROOF_MIX[(v * 2 + 1) % ROOF_MIX.length];
      wing(k, -0.12, -0.08, 0.5, 0.36, 0.3, wall, roofC, { rh: 0.2, rows: 4 });
      k.door(0, -0.24, 0.1);
      pane(k, 0, -0.04, 0.22, 0.1, 0.1, 0.1);
      pane(k, 3, -0.37, 0.22, -0.08, 0.07, 0.09);
      bottle(0.3, -0.16, 1, L === 3 ? '#d09a72' : ['#c98a68', '#c07a5c', '#d0956f'][v]);
      k.box(0.32, 0.1, 0.1, -0.1, 0, 0.28, WOOD2);
      pots(-0.1, 0.28, 4, 0.1, 0.9);
      if (L >= 4) awning(k, -0.1, 0.32, 0.12, 0.36, AWN[(v + 2) % AWN.length]);
      pot(k, 0.22, 0.32, 1.6, clay[1]); pot(k, 0.34, 0.34, 1.3, clay[3]);
      if (L === 5) hangSign(k, -0.42, 0.38, 0.12, '#2f4b66', new THREE.CylinderGeometry(0.014, 0.022, 0.05, 6));
      return;
    }
    if (L === 6) {
      // Keramikwerk: Halle und zwei Flaschenöfen
      wing(k, -0.16, 0.08, 0.5, 0.42, 0.34, BRICK[(v + 2) % BRICK.length], SLATE[v % 2], { rh: 0.2 });
      winRows(k, -0.16, 0.08, 0.5, 0.42, [0.24], 3, { back: false, lit: true });
      k.box(0.1, 0.18, 0.02, -0.16, 0.06, 0.295, '#3e5a6a');
      bottle(0.3, -0.24, 1.1, ['#c98a68', '#bb7255', '#d0956f'][v]);
      bottle(0.3, 0.2, 0.85, ['#c07a5c', '#c98a68', '#bb7255'][v]);
      for (let i = 0; i < 3; i++) k.box(0.1, 0.06, 0.08, -0.38 + i * 0.12, 0, -0.28, WOOD2);
      return;
    }
    // Keramikstudio im Stil der Vorbilder (shop), Vasen vor dem Fenster
    shop(k, v, { tone: ['#f4f1ea', '#e8d6c6', '#d6e2e4'], sign: ['#8a5a3a', '#3e4348', '#2f4b66'][v], aw: [['#c9774f', '#f4f1de'], ['#3e4348', '#f4f1de'], ['#6f8fbf', '#f4f1de']], emblem: () => new THREE.CylinderGeometry(0.014, 0.022, 0.05, 7), smoke: true, word: [4, 4],
      goods: (k2, x, y, z) => { k2.box(0.18, 0.04, 0.06, x, y, z, '#c9a27a'); pots(x, z, 3, y + 0.04, 0.7); } });
  },

  // Viehhof: hinten Stall oder Scheune, vorn eine umzäunte Weide mit Schafen und Kühen
  stall(k, L, v) {
    const fc = L >= 5 ? '#f1ead9' : WOOD2;
    const F = 0.16;
    fence(k, -0.45, 0.02, -0.45, 0.45, fc, F); fence(k, 0.45, 0.02, 0.45, 0.45, fc, F);
    fence(k, -0.45, 0.45, -0.1, 0.45, fc, F); fence(k, 0.1, 0.45, 0.45, 0.45, fc, F);
    k.box(0.16, 0.05, 0.05, 0.3, 0, 0.1, WOOD2); k.box(0.14, 0.01, 0.035, 0.3, 0.045, 0.1, '#7cc4cf');
    if (L <= 2) { sheep(k, -0.24, 0.2, 0.5); sheep(k, 0.0, 0.32, -0.4); sheep(k, 0.18, 0.22, 2.4, '#e9e1cf'); if (L === 2) sheep(k, -0.08, 0.14, 3.0, '#d9cfbe'); }
    else if (L <= 4) { cow(k, -0.2, 0.24, 0.3, '#f4f1ea'); cow(k, 0.16, 0.3, 2.8, '#c98f5a', '#f4f1ea'); sheep(k, 0.02, 0.14, -0.6); }
    else { cow(k, -0.22, 0.24, 0.3); cow(k, 0.08, 0.32, 2.9, '#c98f5a', '#f4f1ea'); cow(k, 0.26, 0.2, 1.4, '#4a3f3a', '#f4f1ea'); }
    if (L <= 1) {
      k.cyl(0.17, 0.19, 0.2, 10, -0.2, 0, -0.24, '#c9a27a');
      k.coneRoof(0.27, 0.28, 0.2, THATCH[v % 2], -0.2, -0.24, 3);
      k.box(0.1, 0.14, 0.02, -0.2, 0, -0.06, '#6e543e');
      k.cone(0.13, 0.26, 8, 0.24, 0, -0.26, '#e2c36e'); k.cyl(0.012, 0.012, 0.1, 4, 0.24, 0.24, -0.26, WOOD);
      return;
    }
    const bz = -0.24;
    if (L === 2) {
      k.plinth(0.7, 0.34, STONE[1], 0, bz);
      k.walls(0.7, 0.24, 0.34, 0.06, '#efe2c6', null, 0, bz); k.beams(0.7, 0.24, 0.34, 0.06, 0, bz);
      k.roof(0.7, 0.34, 0.24, 0.3, THATCH[v % 2], { rows: 4, gable: '#e8d8b8', z: bz });
      k.box(0.16, 0.2, 0.02, 0, 0.06, bz + 0.175, WOOD);
      return;
    }
    if (L <= 4) {
      const wall = L === 3 ? STONE[(v + 2) % 3] : '#9b6b4a';
      k.plinth(0.72, 0.36, STONE[1], 0, bz);
      k.walls(0.72, 0.3, 0.36, 0.06, wall, L === 3 ? '#c9b998' : null, 0, bz);
      if (L === 4) for (let i = 0; i < 9; i++) k.box(0.01, 0.3, 0.37, -0.32 + i * 0.08, 0.06, bz, '#86593c');
      k.roof(0.72, 0.36, 0.26, 0.36, L === 3 ? TERRA[v % 2] : SLATE[v % 2], { rows: 4, gable: wall, z: bz, moss: 0.2 });
      k.box(0.2, 0.24, 0.02, 0, 0.06, bz + 0.185, WOOD2);
      k.add(new THREE.BoxGeometry(0.02, 0.3, 0.012).rotateZ(0.7).translate(0, 0.18, bz + 0.198), WOOD);
      k.add(new THREE.BoxGeometry(0.02, 0.3, 0.012).rotateZ(-0.7).translate(0, 0.18, bz + 0.198), WOOD);
      k.add(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 10).rotateZ(Math.PI / 2).translate(-0.3, 0.06, 0.06), '#e2c36e');
      k.add(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 10).rotateZ(Math.PI / 2).translate(-0.3, 0.17, 0.06), '#d8b85e');
      return;
    }
    if (L <= 6) {
      // rote Scheune mit Mansarddach und weißen Kanten, ab der Industrie mit Silo
      const red = ['#b5483a', '#a8443a', '#c0563f'][v], rc = '#6b5f5a', bx = -0.1, bw = 0.5, bd = 0.42;
      k.plinth(bw, bd, STONE[1], bx, bz);
      k.box(bw, 0.24, bd, bx, 0.06, bz, red);
      wedge(k, bd + 0.06, bw + 0.08, 0.15, 0.62, 0.3, rc, bx, bz, Math.PI / 2);
      prism(k, bd + 0.06, (bw + 0.08) * 0.62, 0.12, 0.45, rc, bx, bz, Math.PI / 2);
      wedge(k, 0.012, bw - 0.02, 0.14, 0.62, 0.3, red, bx, bz + bd / 2 + 0.02, Math.PI / 2);
      prism(k, 0.012, (bw - 0.02) * 0.6, 0.11, 0.44, red, bx, bz + bd / 2 + 0.02, Math.PI / 2);
      k.box(0.2, 0.22, 0.02, bx, 0.06, bz + bd / 2 + 0.005, '#f4f1ea');
      k.box(0.17, 0.2, 0.02, bx, 0.07, bz + bd / 2 + 0.012, red);
      k.add(new THREE.BoxGeometry(0.015, 0.26, 0.012).rotateZ(0.72).translate(bx, 0.17, bz + bd / 2 + 0.024), '#f4f1ea');
      k.add(new THREE.BoxGeometry(0.015, 0.26, 0.012).rotateZ(-0.72).translate(bx, 0.17, bz + bd / 2 + 0.024), '#f4f1ea');
      k.box(0.08, 0.08, 0.02, bx, 0.36, bz + bd / 2 + 0.03, '#f4f1ea'); k.box(0.06, 0.06, 0.02, bx, 0.37, bz + bd / 2 + 0.036, '#4a3f3a');
      if (L === 6) {
        k.cyl(0.11, 0.11, 0.72, 12, 0.3, 0, -0.26, '#d9d5cc');
        for (const y of [0.2, 0.45]) k.cyl(0.115, 0.115, 0.02, 12, 0.3, y, -0.26, '#b9b4aa');
        k.add(domeG(0.11, 12, 4).translate(0.3, 0.72, -0.26), '#8e969c');
      } else {
        k.add(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 10).rotateZ(Math.PI / 2).translate(0.3, 0.06, -0.22), '#e2c36e');
        k.add(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 10).rotateZ(Math.PI / 2).translate(0.3, 0.06, -0.34), '#d8b85e');
      }
      return;
    }
    // Moderne: langer heller Stall mit Tonnendach, Futtersilo, eingewickelte Heuballen
    k.plinth(0.76, 0.36, '#d6d0c6', 0, bz);
    k.box(0.76, 0.18, 0.36, 0, 0.06, bz, '#ece8e0');
    k.add(vaultG(0.2, 0.8, 10).scale(1, 0.55, 1).translate(0, 0.24, bz), '#8e969c');
    for (let i = 0; i < 8; i++) k.box(0.012, 0.18, 0.37, -0.33 + i * 0.094, 0.06, bz, '#c9a27a');
    k.box(0.5, 0.06, 0.02, 0, 0.16, bz + 0.182, '#3e4348');
    k.cyl(0.07, 0.07, 0.6, 10, 0.4, 0, -0.38, '#a9c0cf'); k.cone(0.072, 0.08, 10, 0.4, 0.6, -0.38, '#8e969c');
    for (const x of [-0.32, -0.2]) k.add(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 10).rotateX(Math.PI / 2).translate(x, 0.06, 0.06), '#f4f4f2');
  },

  // Schmiede: Esse mit Glut, Amboss, Schornstein; später Backsteinhalle und Metallwerkstatt
  schmiede(k, L, v) {
    const shoe = () => new THREE.TorusGeometry(0.026, 0.008, 4, 10, Math.PI * 1.5).rotateZ(Math.PI * 0.75);
    if (L <= 2) {
      const hx = -0.12, hz = -0.1;
      k.plinth(0.46, 0.36, STONE[1], hx, hz);
      k.walls(0.46, 0.26, 0.36, 0.06, '#e6d6b6', null, hx, hz); k.beams(0.46, 0.26, 0.36, 0.06, hx, hz);
      k.roof(0.46, 0.36, 0.22, 0.32, THATCH[v % 2], { rows: 3, gable: '#e0cfaa', x: hx, z: hz });
      k.door(0, hx - 0.06, hz + 0.18, false);
      pane(k, 0, hx + 0.12, 0.2, hz + 0.18, 0.07, 0.08);
      // offene Esse unter einem Vordach
      k.box(0.2, 0.16, 0.2, 0.27, 0, -0.14, STONE[0]);
      k.box(0.14, 0.02, 0.12, 0.27, 0.16, -0.12, '#ff7a2a', 'glow');
      k.box(0.12, 0.46, 0.1, 0.27, 0.16, -0.22, STONE[1]);
      k.smoke.push([0.27, 0.66, -0.22]);
      k.add(new THREE.BoxGeometry(0.3, 0.025, 0.32).rotateX(0.35).translate(0.27, 0.38, -0.04), THATCH[v % 2][1]);
      for (const x of [0.14, 0.4]) k.cyl(0.012, 0.012, 0.36, 4, x, 0, 0.1, WOOD);
      anvil(k, 0.16, 0.26); barrel(k, 0.38, 0.3, '#7b5a3e');
      k.box(0.12, 0.012, 0.02, 0.36, 0.11, 0.3, '#7cc4cf');
      hangSign(k, hx - 0.25, 0.36, hz + 0.21, '#6e543e', shoe());
      return;
    }
    if (L <= 5) {
      const wall = L === 3 ? STONE[2] : L === 4 ? STONE[(v + 1) % 3] : PLASTER[(v * 3 + 1) % 8];
      const roofC = L === 3 ? TERRA[v % 2] : L === 4 ? SLATE[v % 2] : ROOF_MIX[(v * 2 + 2) % ROOF_MIX.length];
      k.plinth(0.62, 0.46); k.walls(0.62, 0.34, 0.46, 0.06, wall, '#c9b998');
      k.roof(0.62, 0.46, 0.24, 0.4, roofC, { rows: 4, gable: wall, moss: 0.2 });
      archway(k, 0, 0.08, 0.23, 0.2, 0.26, '#2f2622', 0.04);
      if (L === 4) {
        // Vordach auf Pfosten über dem Amboss
        k.add(new THREE.BoxGeometry(0.3, 0.025, 0.24).rotateX(0.3).translate(-0.17, 0.33, 0.34), roofC[1]);
        for (const x of [-0.3, -0.04]) k.cyl(0.012, 0.012, 0.3, 4, x, 0, 0.44, WOOD);
      }
      if (L === 5) {
        // Gaube und Blumenfenster am Putzhaus
        k.box(0.12, 0.1, 0.1, 0.14, 0.5, 0.14, wall);
        k.roof(0.12, 0.12, 0.07, 0.6, roofC, { rows: 2, over: 0.02, ry: Math.PI / 2, x: 0.14, z: 0.14 });
        k.box(0.06, 0.06, 0.02, 0.14, 0.52, 0.192, '#ffd486', 'win');
        k.window(3, 0, 0.24, 0.31, 0.08);
      }
      k.box(0.13, 0.06, 0.01, 0.08, 0.06, 0.252, '#ff7a2a', 'glow');
      k.chimney(-0.2, 0.4, -0.08, 0.44);
      anvil(k, -0.16, 0.36);
      k.add(new THREE.CylinderGeometry(0.06, 0.06, 0.025, 10).rotateX(Math.PI / 2).translate(0.32, 0.09, 0.34), '#b9b3a8');
      k.box(0.02, 0.09, 0.08, 0.32, 0, 0.34, WOOD);
      pane(k, 1, 0.31, 0.24, 0, 0.07, 0.09);
      hangSign(k, L === 4 ? 0.2 : -0.31, 0.38, 0.25, '#5a4a3c', shoe());
      if (L >= 4) k.lantern(0.38, 0.3);
      return;
    }
    // Schmiedehalle (Industrie) oder Metallwerkstatt (Moderne)
    if (L >= 7) {
      shop(k, v, { tone: ['#c9ccd0', '#d9d2c4', '#b9c4c9'], sign: ['#3e4348', '#7a2e2a', '#2f4b66'][v], aw: [['#3e4348', '#c9ccd0'], ['#7a2e2a', '#f4f1de'], ['#2f4b66', '#f4f1de']], emblem: shoe, smoke: true, word: [5, 3],
        goods: (k2, x, y, z) => { for (let i = 0; i < 3; i++) k2.box(0.2, 0.02, 0.05, x, y + i * 0.022, z, '#7a8590'); } });
      return;
    }
    const brick = L === 6;
    k.plinth(0.7, 0.5, brick ? '#9a958c' : '#d6d0c6');
    k.walls(0.7, 0.4, 0.5, 0.06, brick ? BRICK[(v + 1) % BRICK.length] : '#c9ccd0', brick ? '#e8dcc6' : null);
    if (brick) k.roof(0.7, 0.5, 0.18, 0.46, SLATE[0], { rows: 4, gable: BRICK[(v + 1) % BRICK.length], moss: 0.03 });
    else { k.box(0.74, 0.04, 0.54, 0, 0.46, 0, '#5d6670'); for (let i = 0; i < 6; i++) k.box(0.012, 0.4, 0.51, -0.3 + i * 0.12, 0.06, 0, '#b9bec2'); }
    k.box(0.26, 0.26, 0.02, 0.1, 0.06, 0.252, brick ? '#2f2622' : '#8a9096');
    k.box(0.22, 0.1, 0.012, 0.1, 0.07, 0.264, '#ff8a3a', 'glow');
    if (!brick) for (let i = 0; i < 5; i++) k.box(0.26, 0.012, 0.024, 0.1, 0.2 + i * 0.024, 0.262, '#a9b2b7');
    for (const x of [-0.22, -0.08]) pane(k, 0, x, 0.26, 0.25, 0.08, 0.12, { arch: brick, glass: '#ffb86a', frame: brick ? '#e8dcc6' : '#3e4348' });
    if (brick) { k.cyl(0.05, 0.065, 1.0, 10, -0.26, 0, -0.16, '#9a5a44'); k.smoke.push([-0.26, 1.02, -0.16]); }
    else { k.cyl(0.03, 0.03, 0.4, 8, -0.24, 0.5, -0.14, '#c9ccd0'); k.smoke.push([-0.24, 0.94, -0.14]); }
    if (brick) anvil(k, 0.32, 0.36);
    else for (let i = 0; i < 3; i++) k.box(0.32, 0.025, 0.04, 0.24, i * 0.026, 0.38, '#7a8590');
  },

  // Bäckerei: Lehmofen und Brezel am Ausleger, später Laden mit Markise, zuletzt Café
  baeckerei(k, L, v) {
    const pretzel = () => new THREE.TorusGeometry(0.026, 0.009, 4, 10).scale(1.15, 0.85, 1);
    const breads = (x, y, z, n) => { for (let i = 0; i < n; i++) k.add(new THREE.IcosahedronGeometry(0.022, 0).scale(1.5, 0.7, 1).translate(x + (i - (n - 1) / 2) * 0.045, y + 0.015, z), i % 2 ? '#c98a4a' : '#d9a05a'); };
    const oven = (x, z, s = 1) => {
      k.add(domeG(0.13 * s, 10, 5, 1.1).translate(x, 0, z), '#c48a62');
      k.box(0.07 * s, 0.06 * s, 0.03, x, 0, z + 0.125 * s, '#3b302a');
      k.box(0.05 * s, 0.035 * s, 0.02, x, 0.008, z + 0.138 * s, '#ff8a3a', 'glow');
      k.cyl(0.03, 0.035, 0.08, 6, x, 0.13 * s, z - 0.02, '#b8794f');
      k.smoke.push([x, 0.13 * s + 0.12, z - 0.02]);
    };
    if (L <= 2) {
      const hx = -0.1, hz = -0.06;
      k.plinth(0.46, 0.38, STONE[1], hx, hz);
      k.walls(0.46, 0.28, 0.38, 0.06, '#efe2c6', null, hx, hz); k.beams(0.46, 0.28, 0.38, 0.06, hx, hz);
      k.roof(0.46, 0.38, 0.24, 0.34, THATCH[v % 2], { rows: 3, gable: '#e8d8b8', x: hx, z: hz });
      k.door(0, hx - 0.08, hz + 0.19, false);
      k.window(0, hx + 0.12, 0.2, hz + 0.19, 0.08);
      oven(0.3, -0.14);
      k.box(0.24, 0.08, 0.08, 0.18, 0, 0.3, WOOD2); breads(0.18, 0.08, 0.3, 4);
      for (const x of [-0.38, -0.3]) k.add(new THREE.IcosahedronGeometry(0.05, 0).scale(0.9, 1.1, 0.9).translate(x, 0.05, 0.3), '#e9e1cf');
      hangSign(k, hx - 0.26, 0.36, hz + 0.22, '#6e543e', pretzel());
      return;
    }
    if (L <= 4) {
      const wall = L === 3 ? STONE[2] : PLASTER[(v * 2 + 1) % 8], H = L === 3 ? 0.32 : 0.56, hx = -0.08, hz = -0.04;
      k.plinth(0.52, 0.44, STONE[1], hx, hz);
      k.walls(0.52, H, 0.44, 0.06, wall, '#c9b998', hx, hz);
      k.roof(0.52, 0.44, 0.26, 0.06 + H, L === 3 ? TERRA[v % 2] : ROOF_MIX[(v * 3 + 2) % ROOF_MIX.length], { rows: 4, gable: wall, x: hx, z: hz });
      k.door(0, hx - 0.14, hz + 0.22);
      k.box(0.2, 0.12, 0.02, hx + 0.1, 0.12, hz + 0.222, '#ffd486', 'win');
      k.box(0.24, 0.02, 0.06, hx + 0.1, 0.1, hz + 0.24, STONE[0]); breads(hx + 0.1, 0.12, hz + 0.25, 4);
      if (L === 4) { k.window(0, hx - 0.12, 0.44, hz + 0.22); k.window(0, hx + 0.12, 0.44, hz + 0.22); awning(k, hx + 0.1, 0.3, hz + 0.222, 0.26, AWN[(v + 2) % AWN.length]); }
      k.chimney(hx - 0.14, 0.06 + H + 0.06, hz - 0.1, 0.3);
      oven(0.32, -0.08, 0.9);
      hangSign(k, hx - 0.3, 0.32, hz + 0.25, '#6e543e', pretzel());
      return;
    }
    if (L <= 6) {
      const brick = L === 6, wall = brick ? BRICK[(v + 3) % BRICK.length] : PLASTER[(v * 3 + 4) % 8];
      k.plinth(0.56, 0.46, brick ? '#9a958c' : STONE[1]);
      k.walls(0.56, 0.62, 0.46, 0.06, wall, brick ? '#e8dcc6' : STONE[0]);
      k.roof(0.56, 0.46, 0.3, 0.68, SLATE[v % 2], { rows: 5, gable: wall, moss: brick ? 0.03 : 0.12 });
      k.box(0.34, 0.2, 0.02, 0.07, 0.08, 0.232, '#ffd486', 'win');
      k.box(0.38, 0.03, 0.03, 0.07, 0.28, 0.238, '#ece2cf');
      breads(0.07, 0.08, 0.25, 5);
      awning(k, 0.07, 0.34, 0.24, 0.4, AWN[(v + 1) % AWN.length]);
      k.door(0, -0.19, 0.23, true, '#5b4a6e');
      k.window(0, -0.13, 0.52, 0.23, 0.08, !brick); k.window(0, 0.13, 0.52, 0.23, 0.08, !brick);
      k.window(2, 0, 0.4, 0.23, 0.08, false);
      k.chimney(0.18, 0.8, -0.1, 0.3);
      hangSign(k, -0.3, 0.46, 0.25, '#2f4b66', pretzel());
      for (const x of [0.36, 0.42]) k.add(new THREE.IcosahedronGeometry(0.045, 0).scale(0.9, 1.1, 0.9).translate(x, 0.045, 0.32), '#e9e1cf');
      return;
    }
    // Café mit Backstube im Stil der Vorbilder (shop)
    shop(k, v, { tone: ['#f3d9c8', '#d9e6dc', '#f2e2b8'], sign: ['#2f4b66', '#7a2e2a', '#2f5d4a'][v], aw: [['#2f4b66', '#f4f1de'], ['#c8553d', '#f4f1de'], ['#5fa8a0', '#f4f1de']], emblem: pretzel, tables: true, smoke: true, word: [4, 3],
      goods: (k2, x, y, z) => { k2.box(0.16, 0.05, 0.06, x, y, z, WOOD2); breads(x, y + 0.04, z, 3); } });
  },

  // Taverne: Schild mit Krug, Bänke und Tische draußen, warme Fenster. Je Epoche ein anderes Wirtshaus
  taverne(k, L, v) {
    const mug = () => new THREE.CylinderGeometry(0.018, 0.016, 0.042, 6);
    if (L <= 2) {
      k.plinth(0.7, 0.4); k.walls(0.7, 0.28, 0.4, 0.06, '#efe2c6', null); k.beams(0.7, 0.28, 0.4, 0.06);
      k.roof(0.7, 0.4, 0.3, 0.34, THATCH[v % 2], { rows: 4, gable: '#e8d8b8' });
      k.door(0, 0, 0.2, false);
      k.window(0, -0.22, 0.2, 0.2, 0.085); k.window(0, 0.22, 0.2, 0.2, 0.085); k.window(2, 0, 0.2, 0.2, 0.085, false);
      k.chimney(0.22, 0.42, -0.06, 0.3);
      hangSign(k, 0.06, 0.34, 0.22, '#6e543e', mug());
      tableSet(k, -0.22, 0.37);
      barrel(k, 0.3, 0.34); barrel(k, 0.4, 0.3); barrel(k, 0.35, 0.32, '#8a6a4c', 0.1);
      torch(k, 0.42, 0.42, 0.26);
      return;
    }
    if (L === 3) {
      // Taverne im Süden: Steinhaus, Weinlaube mit Trauben, Amphoren
      const hz = -0.1;
      k.plinth(0.6, 0.36, STONE[1], 0, hz); k.walls(0.6, 0.34, 0.36, 0.06, STONE[2], '#c9b998', 0, hz);
      k.roof(0.6, 0.36, 0.18, 0.4, TERRA[v % 2], { rows: 4, gable: STONE[2], z: hz });
      k.door(0, -0.12, hz + 0.18);
      pane(k, 0, 0.12, 0.22, hz + 0.18, 0.08, 0.1); pane(k, 0, -0.26, 0.22, hz + 0.18, 0.06, 0.09);
      for (const x of [-0.28, 0.28]) for (const z of [0.12, 0.42]) k.cyl(0.012, 0.014, 0.34, 5, x, 0, z, WOOD);
      for (const z of [0.12, 0.27, 0.42]) k.box(0.62, 0.02, 0.02, 0, 0.34, z, WOOD);
      for (let i = 0; i < 7; i++) k.ball(0.045, -0.27 + i * 0.09, 0.37, 0.12 + (i % 3) * 0.15, ['#6f9e52', '#86b06a', '#7fae5a'][i % 3], null, 0);
      for (const [x, z] of [[-0.18, 0.3], [0.1, 0.38], [0.24, 0.2]]) k.ball(0.022, x, 0.3, z, '#7a4f9a', null, 0);
      tableSet(k, 0, 0.28);
      pot(k, 0.36, 0.36, 1.7, '#c9774f'); pot(k, 0.42, 0.26, 1.4, '#b8693f');
      k.lantern(-0.36, 0.3, 0.3);
      return;
    }
    if (L === 4) {
      // Gasthaus mit vorkragendem Fachwerk-Obergeschoss
      const pl = PLASTER[(v * 3 + 6) % 8], roofC = ROOF_MIX[(v * 2 + 3) % ROOF_MIX.length];
      k.plinth(0.62, 0.44); k.walls(0.62, 0.3, 0.44, 0.06, STONE[(v + 2) % 3], '#c9b998');
      k.box(0.66, 0.3, 0.52, 0, 0.36, 0.02, pl);
      for (const x of [-0.32, -0.16, 0, 0.16, 0.32]) k.box(0.024, 0.3, 0.02, x, 0.36, 0.282, WOOD);
      for (const y of [0.36, 0.64]) k.box(0.68, 0.024, 0.02, 0, y, 0.282, WOOD);
      for (const x of [-0.24, 0.24]) k.add(new THREE.BoxGeometry(0.018, 0.2, 0.015).rotateZ(x < 0 ? 0.55 : -0.55).translate(x, 0.5, 0.285), WOOD);
      for (const x of [-0.3, 0, 0.3]) k.box(0.03, 0.05, 0.06, x, 0.31, 0.25, WOOD);
      k.roof(0.66, 0.52, 0.34, 0.66, roofC, { rows: 5, gable: pl, z: 0.02, moss: 0.2 });
      k.box(0.14, 0.12, 0.12, 0.08, 0.86, 0.14, pl);
      k.roof(0.14, 0.14, 0.08, 0.98, roofC, { rows: 2, over: 0.03, ry: Math.PI / 2, x: 0.08, z: 0.14 });
      k.box(0.07, 0.08, 0.02, 0.08, 0.88, 0.205, '#ffd486', 'win');
      k.window(0, -0.08, 0.5, 0.29, 0.08); k.window(0, 0.08, 0.5, 0.29, 0.08, false);
      pane(k, 0, -0.24, 0.5, 0.29, 0.06, 0.09); pane(k, 0, 0.24, 0.5, 0.29, 0.06, 0.09);
      k.door(0, 0, 0.22);
      pane(k, 0, -0.18, 0.2, 0.22, 0.09, 0.1); pane(k, 0, 0.18, 0.2, 0.22, 0.09, 0.1);
      k.window(2, 0, 0.5, 0.26, 0.08, false);
      k.chimney(-0.2, 0.86, -0.1, 0.3);
      hangSign(k, 0.33, 0.44, 0.24, '#7a2e2a', mug());
      tableSet(k, -0.22, 0.4); barrel(k, 0.3, 0.38);
      k.lantern(-0.38, 0.3);
      return;
    }
    if (L === 5) {
      const pl = PLASTER[(v * 2 + 3) % 8];
      k.plinth(0.62, 0.46); k.walls(0.62, 0.66, 0.46, 0.06, pl);
      k.roof(0.62, 0.46, 0.32, 0.72, SLATE[v % 2], { rows: 5, gable: pl });
      k.door(0, 0, 0.23);
      pane(k, 0, -0.2, 0.2, 0.23, 0.1, 0.13); pane(k, 0, 0.2, 0.2, 0.23, 0.1, 0.13);
      k.window(0, -0.18, 0.5, 0.23); k.window(0, 0.18, 0.5, 0.23); pane(k, 0, 0, 0.5, 0.23, 0.07, 0.1);
      k.window(2, -0.14, 0.4, 0.23, 0.09, false); k.window(2, 0.14, 0.4, 0.23, 0.09, false);
      k.box(0.5, 0.025, 0.1, 0, 0.38, 0.28, WOOD2);
      for (let i = 0; i < 6; i++) k.box(0.012, 0.07, 0.012, -0.22 + i * 0.088, 0.405, 0.325, WOOD);
      k.box(0.5, 0.014, 0.014, 0, 0.475, 0.325, WOOD);
      k.chimney(0.16, 0.86, -0.1, 0.3);
      hangSign(k, -0.42, 0.44, 0.25, '#2f4b66', mug());
      umbrellaTable(k, -0.22, 0.4, '#c8553d'); umbrellaTable(k, 0.22, 0.4, '#e9c46a');
      k.lantern(0.38, 0.28);
      return;
    }
    if (L === 6) {
      // Kneipe aus Backstein mit gestrichener Holzfront, goldener Schrift und Lichterkette
      const brick = BRICK[(v * 2 + 1) % BRICK.length], front = ['#2f5d4a', '#7a2e2a', '#2f4b66'][v];
      k.plinth(0.62, 0.46, '#9a958c'); k.walls(0.62, 0.68, 0.46, 0.06, brick, '#e8dcc6');
      k.roof(0.62, 0.46, 0.26, 0.74, SLATE[0], { rows: 5, gable: brick, moss: 0.03 });
      k.box(0.6, 0.3, 0.02, 0, 0.06, 0.235, front);
      for (const x of [-0.18, 0.18]) k.box(0.16, 0.16, 0.02, x, 0.11, 0.245, '#ffd486', 'win');
      k.box(0.1, 0.2, 0.02, 0, 0.06, 0.245, '#3b302a');
      k.box(0.56, 0.05, 0.02, 0, 0.3, 0.25, front); k.box(0.3, 0.02, 0.01, 0, 0.315, 0.262, GOLD);
      for (const x of [-0.18, 0, 0.18]) k.window(0, x, 0.52, 0.23, 0.08, false);
      for (const x of [-0.3, 0.3]) k.cyl(0.008, 0.01, 0.34, 4, x, 0, 0.44, DARK);
      lights(k, -0.3, 0.34, 0.44, -0.3, 0.42, 0.25, 4, 0.02); lights(k, 0.3, 0.34, 0.44, 0.3, 0.42, 0.25, 4, 0.02);
      lights(k, -0.3, 0.34, 0.44, 0.3, 0.34, 0.44, 8, 0.05);
      tableSet(k, 0, 0.38, '#3e3a39');
      k.chimney(-0.18, 0.86, -0.1, 0.28);
      return;
    }
    // Moderne: Bistro mit Lichterkette über den Tischen (shop)
    shop(k, v, { tone: ['#e9dccb', '#cfdce4', '#efd3c4'], sign: ['#2f5d4a', '#3e3a39', '#7a2e2a'][v], aw: [['#2f5d4a', '#f4f1de'], ['#3e4348', '#e9c46a'], ['#7a2e2a', '#f4f1de']], emblem: mug, tables: true, word: [3, 4] });
    lights(k, -0.36, 0.42, 0.36, 0.36, 0.42, 0.36, 9, 0.05);
  },

  // Wachturm: Holzgerüst mit Plattform, Steinturm mit Zinnen, Rundturm, Backsteinturm, Stahlmast
  wachturm(k, L, v) {
    const col = [CRIMSON, '#2f6f73', '#e9c46a'][v];
    if (L <= 2) {
      const H = 0.72;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(new THREE.BoxGeometry(0.035, H + 0.02, 0.035).rotateX(-sz * 0.06).rotateZ(sx * 0.06).translate(sx * 0.14, H / 2, sz * 0.14), WOOD);
      for (const sz of [-1, 1]) for (const sg of [-1, 1]) k.add(new THREE.BoxGeometry(0.02, 0.4, 0.015).rotateZ(sg * 0.62).translate(0, 0.3, sz * 0.145), WOOD2);
      for (const sx of [-1, 1]) for (const sg of [-1, 1]) k.add(new THREE.BoxGeometry(0.015, 0.4, 0.02).rotateX(sg * 0.62).translate(sx * 0.145, 0.3, 0), WOOD2);
      k.box(0.38, 0.04, 0.38, 0, H, 0, WOOD2);
      for (const sz of [-1, 1]) k.box(0.38, 0.07, 0.02, 0, H + 0.04, sz * 0.18, WOOD);
      for (const sx of [-1, 1]) k.box(0.02, 0.07, 0.38, sx * 0.18, H + 0.04, 0, WOOD);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.025, 0.22, 0.025, sx * 0.17, H + 0.04, sz * 0.17, WOOD);
      k.add(new THREE.ConeGeometry(0.34, 0.24, 4).rotateY(Math.PI / 4).translate(0, H + 0.38, 0), THATCH[v % 2][0]);
      k.add(new THREE.ConeGeometry(0.2, 0.16, 4).rotateY(Math.PI / 4).translate(0, H + 0.46, 0), THATCH[v % 2][2]);
      for (const sx of [-1, 1]) k.add(new THREE.BoxGeometry(0.012, 0.8, 0.012).rotateX(-0.25).translate(sx * 0.04, 0.38, 0.26), WOOD);
      for (let i = 0; i < 6; i++) { const y = 0.08 + i * 0.12; k.box(0.08, 0.008, 0.01, 0, y, 0.26 + (0.38 - y) * 0.255, WOOD); }
      k.cone(0.02, 0.06, 5, 0.17, H + 0.26, 0.17, '#ffb24a', 'glow');
      k.box(0.06, 0.09, 0.012, -0.08, H + 0.03, 0.195, col);
      return;
    }
    if (L === 3) {
      k.plinth(0.36, 0.36); k.walls(0.34, 0.86, 0.34, 0.06, STONE[2], STONE[0]);
      k.box(0.4, 0.04, 0.4, 0, 0.92, 0, STONE[1]); k.crenel(0.38, 0.38, 0.96, STONE[0]);
      for (const y of [0.4, 0.66]) { k.box(0.025, 0.1, 0.01, 0, y, 0.175, '#3b302a'); k.box(0.01, 0.1, 0.025, 0.175, y, 0, '#3b302a'); }
      k.door(0, 0, 0.17, true);
      flag(k, 0, 0, 0.42, col, 0.96);
      torch(k, 0.22, 0.24, 0.28);
      return;
    }
    if (L <= 5) {
      if (L === 4) {
        const wall = STONE[(v + 1) % 3];
        k.cyl(0.2, 0.22, 0.06, 14, 0, -0.04, 0, STONE[1]);
        k.tower(0, 0, 0.17, 1.0, wall, SLATE[v % 2]);
        k.box(0.08, 0.22, 0.008, 0, 0.62, 0.178, col); k.ball(0.014, 0, 0.6, 0.182, GOLD, null, 0);
        wing(k, 0.24, 0.16, 0.24, 0.2, 0.2, STONE[2], TERRA[v % 2], { rh: 0.12, rows: 2 });
        k.door(0, -0.04, 0.17);
        k.lantern(-0.24, 0.24, 0.3);
      } else {
        const wall = PLASTER[(v + 1) % 8];
        k.cyl(0.2, 0.22, 0.06, 14, 0, -0.04, 0, STONE[1]);
        k.cyl(0.17, 0.18, 1.0, 14, 0, 0, 0, wall);
        k.cyl(0.21, 0.18, 0.08, 14, 0, 1.0, 0, STONE[0]);
        for (let a = 0; a < 10; a++) k.box(0.05, 0.06, 0.05, Math.cos(a * 0.628) * 0.19, 1.08, Math.sin(a * 0.628) * 0.19, STONE[0]);
        flag(k, 0, 0, 0.38, col, 1.08);
        pane(k, 0, 0, 0.45, 0.17, 0.05, 0.09, { arch: true }); pane(k, 0, 0, 0.75, 0.17, 0.05, 0.09, { arch: true });
        k.door(0, 0, 0.17);
        wing(k, -0.26, -0.14, 0.22, 0.24, 0.22, wall, SLATE[v % 2], { rh: 0.12, rows: 2, rot: true });
        k.lantern(0.24, 0.24, 0.32);
      }
      return;
    }
    if (L === 6) {
      // Backsteinturm mit Uhr, gläserner Ausguck, Fahne
      k.plinth(0.34, 0.34, '#9a958c'); k.walls(0.32, 1.0, 0.32, 0.06, BRICK[v % BRICK.length], '#e8dcc6');
      k.box(0.38, 0.04, 0.38, 0, 1.06, 0, '#e8dcc6');
      k.box(0.24, 0.16, 0.24, 0, 1.1, 0, '#cfe6ec', 'win');
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.02, 0.16, 0.02, sx * 0.12, 1.1, sz * 0.12, '#3e4348');
      k.add(new THREE.ConeGeometry(0.22, 0.14, 4).rotateY(Math.PI / 4).translate(0, 1.33, 0), '#4a5560');
      flag(k, 0, 0, 0.24, col, 1.4);
      clock(k, 0, 0.84, 0.165, 0.07);
      for (const y of [0.3, 0.56]) pane(k, 0, 0, y, 0.16, 0.06, 0.1, { arch: true, frame: '#e8dcc6' });
      k.door(0, 0, 0.16, true, '#3e5a6a');
      return;
    }
    // Moderne: Stahlgittermast mit Kanzel, Antennen, Schüssel und rotem Warnlicht
    const H = 1.5, mc = ['#d0644a', '#c9ccd0', '#d0644a'][v];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(new THREE.BoxGeometry(0.022, H, 0.022).rotateX(-sz * 0.06).rotateZ(sx * 0.06).translate(sx * 0.095, H / 2, sz * 0.095), mc);
    for (let i = 0; i < 3; i++) {
      const y0 = 0.05 + i * 0.4, y1 = y0 + 0.4, w0 = 0.28 - (y0 / H) * 0.18, w1 = 0.28 - (y1 / H) * 0.18, w = (w0 + w1) / 2;
      const len = Math.hypot(w, 0.4), a = Math.atan2(w, 0.4);
      for (const sg of [-1, 1]) {
        for (const sz of [-1, 1]) k.add(new THREE.BoxGeometry(0.01, len, 0.01).rotateZ(sg * a).translate(0, (y0 + y1) / 2, sz * w / 2), '#c9ccd0');
        for (const sx of [-1, 1]) k.add(new THREE.BoxGeometry(0.01, len, 0.01).rotateX(sg * a).translate(sx * w / 2, (y0 + y1) / 2, 0), '#c9ccd0');
      }
    }
    k.box(0.22, 0.12, 0.22, 0, 1.02, 0, '#f4f1ea');
    k.box(0.225, 0.05, 0.225, 0, 1.06, 0, GLASS, 'win');
    k.box(0.26, 0.02, 0.26, 0, 1.14, 0, '#5d6670');
    k.cyl(0.006, 0.01, 0.42, 4, 0, H, 0, '#c9ccd0');
    k.ball(0.022, 0, H + 0.44, 0, '#ff5a4a', 'glow', 0);
    k.ball(0.016, 0.11, 1.18, 0.11, '#ff5a4a', 'glow', 0);
    k.add(new THREE.CylinderGeometry(0.07, 0.025, 0.03, 10).rotateX(-0.8).translate(0.13, 0.8, 0.0), '#f4f4f2');
    k.box(0.28, 0.16, 0.2, 0.16, 0, 0.26, '#e4dfd6'); k.box(0.08, 0.13, 0.012, 0.1, 0, 0.362, '#5d6670');
  },

  // Tempel: Pfostenhalle, Säulentempel mit Giebel, Rundtempel, Kuppeltempel mit Vorhalle, Moderne mit Goldkuppel
  tempel(k, L, v) {
    if (L <= 2) {
      steps(k, 0.86, 0.66, 2, 0, STONE[1]);
      for (const x of [-0.3, 0, 0.3]) for (const z of [-0.2, 0.2]) k.cyl(0.03, 0.035, 0.36, 7, x, 0.06, z, WOOD2);
      k.box(0.74, 0.04, 0.5, 0, 0.42, 0, WOOD);
      k.roof(0.5, 0.74, 0.2, 0.46, L === 2 ? TERRA[v % 2] : THATCH[v % 2], { rows: 3, over: 0.06, gable: '#e8d8b8', ry: Math.PI / 2 });
      k.box(0.16, 0.12, 0.12, 0, 0.06, 0, STONE[0]);
      k.cone(0.04, 0.1, 6, 0, 0.18, 0, '#ffb24a', 'glow');
      for (const sx of [-1, 1]) { k.cyl(0.04, 0.025, 0.04, 8, sx * 0.3, 0.06, 0.3, '#b08a4a'); k.cone(0.025, 0.06, 5, sx * 0.3, 0.1, 0.3, '#ffb24a', 'glow'); }
      return;
    }
    if (L === 3) {
      // Säulentempel: Stufen, Säulenkranz, bemalter Fries, Giebel nach vorn
      steps(k, 0.92, 0.7, 3, 0, STONE[0]);
      for (const x of [-0.33, -0.11, 0.11, 0.33]) for (const z of [-0.24, 0.24]) column(k, x, 0.09, z, 0.44, 0.03);
      for (const z of [-0.08, 0.08]) for (const x of [-0.33, 0.33]) column(k, x, 0.09, z, 0.44, 0.03);
      k.box(0.46, 0.38, 0.3, 0, 0.09, 0, '#efe6d6');
      k.box(0.1, 0.2, 0.02, 0, 0.09, 0.152, '#a9824a');
      k.box(0.82, 0.06, 0.6, 0, 0.53, 0, MARBLE);
      k.box(0.83, 0.03, 0.61, 0, 0.555, 0, ['#5f8fa8', '#c8553d', '#7fae64'][v]);
      k.box(0.84, 0.025, 0.62, 0, 0.59, 0, '#e8dfcf');
      k.roof(0.62, 0.84, 0.18, 0.615, TERRA[v % 2], { rows: 3, over: 0.03, gable: MARBLE, ry: Math.PI / 2, moss: 0.05 });
      for (const sz of [-1, 1]) k.ball(0.025, 0, 0.82, sz * 0.33, GOLD, null, 0);
      k.box(0.12, 0.08, 0.08, 0, 0, 0.43, STONE[0]); k.cone(0.03, 0.08, 5, 0, 0.08, 0.43, '#ffb24a', 'glow');
      return;
    }
    if (L === 4) {
      // Rundtempel mit Säulenkranz und Ziegelkegel
      k.cyl(0.44, 0.46, 0.04, 18, 0, 0, 0, STONE[1]); k.cyl(0.4, 0.42, 0.04, 18, 0, 0.04, 0, STONE[0]);
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; column(k, Math.cos(a) * 0.34, 0.08, Math.sin(a) * 0.34, 0.42, 0.026); }
      k.cyl(0.22, 0.22, 0.42, 14, 0, 0.08, 0, '#efe6d6');
      archway(k, 0, 0, 0.22, 0.09, 0.2, '#a9824a', 0.08);
      k.cyl(0.39, 0.38, 0.06, 18, 0, 0.5, 0, MARBLE);
      k.coneRoof(0.42, 0.3, 0.56, TERRA[v % 2], 0, 0, 3);
      for (const sx of [-1, 1]) pot(k, sx * 0.2, 0.42, 1.4, '#c9774f', 0.04);
      return;
    }
    if (L <= 6) {
      // Kuppeltempel mit Säulenvorhalle (Pantheon), ab der Industrie mit Kupferkuppel und Laterne
      const dome = L === 5 ? ['#d9dde0', '#c9ced3', GOLD][v] : COPPER[v], dz = -0.08;
      k.cyl(0.34, 0.36, 0.08, 18, 0, -0.02, dz, STONE[1]);
      k.cyl(0.3, 0.3, 0.42, 18, 0, 0.06, dz, MARBLE);
      k.cyl(0.32, 0.32, 0.04, 18, 0, 0.46, dz, '#e8dfcf');
      k.add(domeG(0.3, 16, 6, 0.85).translate(0, 0.5, dz), dome);
      k.cyl(0.05, 0.05, 0.08, 8, 0, 0.75, dz, MARBLE); k.cone(0.06, 0.06, 8, 0, 0.83, dz, dome); k.ball(0.022, 0, 0.9, dz, GOLD, null, 0);
      k.box(0.52, 0.06, 0.26, 0, 0, 0.3, STONE[1]);
      steps(k, 0.4, 0.08, 2, 0, STONE[0], 0, 0.45);
      for (const x of [-0.21, -0.07, 0.07, 0.21]) column(k, x, 0.06, 0.39, 0.4, 0.024);
      k.box(0.52, 0.05, 0.26, 0, 0.46, 0.3, MARBLE);
      prism(k, 0.24, 0.54, 0.15, 0.51, TERRA[0][1], 0, 0.29, Math.PI / 2);
      prism(k, 0.02, 0.48, 0.12, 0.515, MARBLE, 0, 0.415, Math.PI / 2);
      archway(k, 0, 0, 0.22, 0.12, 0.26, '#a9824a', 0.06);
      for (let i = 0; i < 6; i++) { const a = Math.PI * (0.15 + i * 0.14) + Math.PI; pane(k, 0, Math.cos(a) * 0.3, 0.3, Math.sin(a) * 0.3 + dz, 0.04, 0.1, { arch: true, lit: true }); }
      return;
    }
    // Moderne: weiße Trommel, Glasring, goldene Kuppel, Wasserbecken
    k.box(0.92, 0.04, 0.92, 0, 0, 0, '#e4dfd6');
    k.box(0.5, 0.02, 0.2, 0, 0.04, 0.32, '#7cc4cf');
    k.cyl(0.28, 0.28, 0.36, 18, 0, 0.04, -0.08, '#f4f2ee');
    k.cyl(0.285, 0.285, 0.06, 18, 0, 0.3, -0.08, GLASS, 'win');
    k.add(domeG(0.27, 16, 6, 0.9).translate(0, 0.4, -0.08), GOLD);
    k.cyl(0.008, 0.012, 0.22, 4, 0, 0.64, -0.08, GOLD); k.ball(0.02, 0, 0.87, -0.08, '#fff0b0', 'glow', 0);
    archway(k, 0, 0, 0.2, 0.1, 0.26, '#c9a27a', 0.04);
    for (const sx of [-1, 1]) { k.cyl(0.008, 0.008, 0.2, 4, sx * 0.32, 0.04, 0.32, '#5d6670'); k.box(0.04, 0.012, 0.04, sx * 0.32, 0.24, 0.32, '#fff1c8', 'glow'); }
  },

  // Bibliothek: hohe Fenster. Säulenhalle, gotischer Saal, Renaissancebau mit Kuppel, Backstein mit Uhr, Glas mit Holzlamellen
  bibliothek(k, L, v) {
    if (L <= 3) {
      k.plinth(0.8, 0.5); k.walls(0.8, 0.44, 0.5, 0.06, STONE[2], STONE[0]);
      k.roof(0.8, 0.5, 0.2, 0.5, TERRA[v % 2], { rows: 4, gable: STONE[2] });
      for (const x of [-0.3, -0.18, 0.18, 0.3]) { pane(k, 0, x, 0.28, 0.25, 0.05, 0.16, { arch: true }); pane(k, 2, x, 0.28, -0.25, 0.05, 0.16); }
      k.box(0.38, 0.04, 0.18, 0, 0, 0.33, STONE[1]);
      for (const x of [-0.14, -0.05, 0.05, 0.14]) column(k, x, 0.04, 0.38, 0.36, 0.02);
      k.box(0.38, 0.04, 0.18, 0, 0.4, 0.33, MARBLE);
      prism(k, 0.18, 0.4, 0.1, 0.44, MARBLE, 0, 0.33, Math.PI / 2);
      k.add(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 8).rotateZ(Math.PI / 2).translate(0, 0.475, 0.43), '#f2e6c8');
      k.door(0, 0, 0.25);
      return;
    }
    if (L === 4) {
      const st = STONE[(v + 1) % 3];
      k.plinth(0.76, 0.46); k.walls(0.76, 0.5, 0.46, 0.06, st, STONE[0]);
      k.roof(0.76, 0.46, 0.38, 0.56, SLATE[v % 2], { rows: 6, gable: st, moss: 0.15 });
      for (const x of [-0.27, -0.13, 0.13, 0.27]) { pane(k, 0, x, 0.32, 0.23, 0.05, 0.2, { arch: true }); pane(k, 2, x, 0.32, -0.23, 0.05, 0.2, { arch: true }); }
      for (const x of [-0.2, 0.2, -0.36, 0.36]) for (const sz of [-1, 1]) k.box(0.04, 0.4, 0.05, x, 0.06, sz * 0.25, STONE[1]);
      k.door(0, 0, 0.23);
      k.add(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 12).rotateX(Math.PI / 2).translate(0, 0.42, 0.236), '#ffd486', 'win');
      k.box(0.08, 0.1, 0.08, 0.2, 0.88, 0, st); k.cone(0.07, 0.22, 8, 0.2, 0.98, 0, SLATE[0][0]);
      return;
    }
    if (L === 5) {
      const pl = PLASTER[(v * 2 + 5) % 8];
      k.plinth(0.84, 0.56); k.walls(0.84, 0.6, 0.56, 0.06, pl, STONE[0]);
      k.box(0.88, 0.04, 0.6, 0, 0.66, 0, '#f4ece0');
      k.box(0.86, 0.06, 0.58, 0, 0.7, 0, pl);
      for (const sz of [-1, 1]) k.box(0.86, 0.015, 0.03, 0, 0.76, sz * 0.28, '#f4ece0');
      k.cyl(0.14, 0.14, 0.1, 14, 0, 0.76, 0, pl);
      k.add(domeG(0.15, 14, 5).translate(0, 0.86, 0), [SLATE[0][0], COPPER[0], '#c8553d'][v]);
      k.cyl(0.03, 0.03, 0.06, 6, 0, 1.0, 0, '#f4ece0'); k.ball(0.02, 0, 1.08, 0, GOLD, null, 0);
      for (const x of [-0.33, -0.2, 0.2, 0.33]) { pane(k, 0, x, 0.48, 0.28, 0.06, 0.14, { arch: true }); pane(k, 0, x, 0.22, 0.28, 0.06, 0.12); pane(k, 2, x, 0.4, -0.28, 0.06, 0.14); }
      k.door(0, 0, 0.28, true, '#5b4a6e');
      for (const sx of [-1, 1]) column(k, sx * 0.1, 0.06, 0.31, 0.3, 0.018);
      k.box(0.26, 0.025, 0.08, 0, 0.36, 0.3, '#f4ece0');
      steps(k, 0.3, 0.08, 2, 0, STONE[0], 0, 0.33);
      return;
    }
    if (L === 6) {
      const brick = BRICK[(v + 2) % BRICK.length];
      k.plinth(0.84, 0.54, '#9a958c'); k.walls(0.84, 0.6, 0.54, 0.06, brick, '#e8dcc6');
      k.box(0.88, 0.035, 0.58, 0, 0.66, 0, '#e8dcc6');
      frustum(k, 0.86, 0.56, 0.2, 0.55, 0.695, SLATE[v % 2][0]);
      for (const x of [-0.3, -0.15, 0.15, 0.3]) { pane(k, 0, x, 0.3, 0.27, 0.09, 0.2, { arch: true, frame: '#e8dcc6' }); pane(k, 2, x, 0.3, -0.27, 0.09, 0.2, { frame: '#e8dcc6' }); }
      k.box(0.18, 1.0, 0.18, 0, 0.06, 0.2, brick);
      k.box(0.2, 0.03, 0.2, 0, 1.06, 0.2, '#e8dcc6');
      k.add(new THREE.ConeGeometry(0.16, 0.24, 4).rotateY(Math.PI / 4).translate(0, 1.21, 0.2), SLATE[0][1]);
      k.ball(0.02, 0, 1.34, 0.2, GOLD, null, 0);
      clock(k, 0, 0.86, 0.292, 0.06);
      archway(k, 0, 0, 0.29, 0.1, 0.24, '#3e5a6a', 0.06);
      pane(k, 0, 0, 0.5, 0.29, 0.06, 0.12, { arch: true, frame: '#e8dcc6' });
      return;
    }
    // Moderne: Glas unten mit Sprossen, auskragender Lesesaal mit Holzlamellen, Gründach mit Leseterrasse, Schriftzug,
    // Vordach, Sitzstufen, Bäume, Bänke, Fahrräder (Runde 2 seit 24.10.2026)
    k.plinth(0.84, 0.6, '#d6d0c6');
    k.box(0.76, 0.26, 0.52, 0, 0.06, -0.02, GLASS, 'win');
    if (k.fine()) { for (let i = 0; i <= 10; i++) k.box(0.01, 0.26, 0.02, -0.38 + i * 0.076, 0.06, 0.245, ANTH); k.box(0.76, 0.01, 0.02, 0, 0.2, 0.245, ANTH); }
    rbx(k, 0.86, 0.3, 0.56, 0.03, 0.32, -0.02, '#f4f1ea', 0.014);
    k.box(0.8, 0.22, 0.02, 0.03, 0.36, 0.262, GLASS, 'win');
    for (let i = 0; i < 12; i++) rbx(k, 0.018, 0.3, 0.04, -0.37 + i * 0.073, 0.32, 0.275, i % 3 ? '#c9a27a' : '#b88f66', 0.006);
    // Rückseite und Seiten auch mit Glas und Lamellen (die Kamera kreist, viele Bibliotheken zeigen ihr den Rücken)
    k.box(0.8, 0.22, 0.02, 0.03, 0.36, -0.302, GLASS, 'win');
    for (let i = 0; i < 12; i++) rbx(k, 0.018, 0.3, 0.04, -0.37 + i * 0.073, 0.32, -0.315, i % 3 ? '#c9a27a' : '#b88f66', 0.006);
    for (const sx of [-1, 1]) { k.box(0.02, 0.22, 0.48, 0.03 + sx * 0.432, 0.36, -0.02, GLASS, 'win'); if (k.fine()) for (let i = 0; i < 6; i++) rbx(k, 0.04, 0.3, 0.018, 0.03 + sx * 0.445, 0.32, -0.24 + i * 0.088, '#c9a27a', 0.006); }
    k.box(0.82, 0.04, 0.52, 0.03, 0.62, -0.02, '#86b06a');
    for (const [x, z] of [[-0.25, -0.1], [0.2, 0.05], [0.3, -0.15]]) k.ball(0.05, x, 0.68, z, ['#6aa64f', '#86bd5a', '#7fae5a'][Math.abs(Math.round(x * 10)) % 3], null, 1);
    if (k.fine()) { umbrellaTable(k, -0.05, -0.12, '#e9c46a'); k.box(0.86, 0.004, 0.004, 0.03, 0.74, 0.25, ANTH); railing(k, -0.4, 0.25, 0.46, 0.25, 0.66, false, 0.08); }
    // Schriftzug über dem Eingang, Vordach
    k.box(0.3, 0.05, 0.012, -0.18, 0.66, 0.262, '#2f4b66'); if (k.fine()) for (let i = 0; i < 7; i++) k.box(0.022, 0.026, 0.006, -0.28 + i * 0.033, 0.672, 0.27, '#f4f1ea');
    k.box(0.22, 0.014, 0.12, 0.26, 0.28, 0.31, '#f4f1ea'); for (const x of [0.16, 0.36]) k.box(0.01, 0.22, 0.01, x, 0.06, 0.36, ANTH);
    for (let i = 0; i < 3; i++) k.box(0.5 - i * 0.08, 0.025, 0.06, -0.1, i * 0.025, 0.36 - i * 0.04, '#e4dfd6');
    k.box(0.12, 0.22, 0.02, 0.26, 0.06, 0.252, '#5d6670');
    for (const x of [-0.44, 0.46]) { k.cyl(0.012, 0.016, 0.14, 5, x, 0, 0.38, '#7b5a3e'); k.ball(0.07, x, 0.2, 0.38, '#6aa64f', null, 1); }
    bench(k, -0.18, 0.44, 0, WOOD2); bikeRack(k, 0.36, 0.42, 3, Math.PI / 2); bike(k, 0.3, 0.44, 0, BIKES[v % BIKES.length]);
  },

  // Badehaus: Thermen mit Kuppel und Becken, Fachwerkbad mit Zubern, Renaissancebad, Halle mit Glasdach, Spa
  badehaus(k, L, v) {
    const pool = (x, z, w, d, y = 0, rim = STONE[0]) => { k.box(w + 0.06, 0.05, d + 0.06, x, y, z, rim); k.box(w, 0.012, d, x, y + 0.042, z, '#6fc0cc'); };
    if (L <= 3) {
      const wz = -0.2;
      wing(k, 0, wz, 0.8, 0.4, 0.34, STONE[2], null);
      k.box(0.84, 0.04, 0.44, 0, 0.4, wz, '#e8dfcf');
      k.cyl(0.18, 0.18, 0.1, 14, 0, 0.44, wz, STONE[2]);
      k.add(domeG(0.18, 14, 5).translate(0, 0.54, wz), '#d9dde0');
      for (const sx of [-1, 1]) { k.add(domeG(0.1, 10, 4).translate(sx * 0.42, 0.06, wz), STONE[2]); }
      for (const x of [-0.28, -0.14, 0.14, 0.28]) pane(k, 0, x, 0.24, wz + 0.2, 0.05, 0.12, { arch: true });
      k.door(0, 0, wz + 0.2);
      pool(0, 0.22, 0.52, 0.2);
      for (const x of [-0.36, 0, 0.36]) for (const z of [0.04, 0.4]) if (x !== 0 || z !== 0.04) column(k, x, 0, z, 0.3, 0.022);
      k.box(0.8, 0.03, 0.04, 0, 0.3, 0.4, MARBLE);
      k.smoke.push([-0.12, 0.1, 0.2], [0.14, 0.1, 0.24]);
      return;
    }
    if (L === 4) {
      const pl = PLASTER[(v + 3) % 8], hz = -0.12;
      k.plinth(0.6, 0.42, STONE[1], 0, hz); k.walls(0.6, 0.3, 0.42, 0.06, STONE[1], '#c9b998', 0, hz);
      k.box(0.6, 0.22, 0.42, 0, 0.36, hz, pl); k.beams(0.6, 0.22, 0.42, 0.36, 0, hz);
      k.roof(0.6, 0.42, 0.3, 0.58, ROOF_MIX[(v * 3 + 1) % ROOF_MIX.length], { rows: 5, gable: pl, z: hz });
      k.chimney(0.18, 0.66, hz - 0.08, 0.26);
      k.door(0, -0.1, hz + 0.21);
      pane(k, 0, 0.14, 0.2, hz + 0.21, 0.08, 0.1); pane(k, 0, -0.14, 0.46, hz + 0.21, 0.07, 0.09); pane(k, 0, 0.14, 0.46, hz + 0.21, 0.07, 0.09);
      for (const [x, z] of [[-0.22, 0.28], [0.18, 0.3]]) {
        k.cyl(0.09, 0.08, 0.1, 10, x, 0, z, WOOD2); k.cyl(0.092, 0.092, 0.012, 10, x, 0.07, z, DARK);
        k.cyl(0.08, 0.08, 0.01, 10, x, 0.092, z, '#7cc4cf'); k.smoke.push([x, 0.14, z]);
      }
      k.lantern(0.36, 0.28, 0.3);
      return;
    }
    if (L === 5) {
      const pl = PLASTER[(v * 3 + 1) % 8], wz = -0.22;
      wing(k, 0, wz, 0.86, 0.36, 0.44, pl, null);
      k.box(0.9, 0.04, 0.4, 0, 0.5, wz, '#f4ece0');
      k.cyl(0.13, 0.13, 0.12, 14, 0, 0.54, wz, pl); k.add(domeG(0.14, 14, 5).translate(0, 0.66, wz), COPPER[v]);
      k.ball(0.02, 0, 0.82, wz, GOLD, null, 0);
      for (const x of [-0.3, -0.15, 0.15, 0.3]) pane(k, 0, x, 0.28, wz + 0.18, 0.06, 0.16, { arch: true });
      archway(k, 0, 0, wz + 0.18, 0.1, 0.22, '#5b4a6e', 0.06);
      pool(0, 0.22, 0.6, 0.24, 0, MARBLE);
      k.cyl(0.03, 0.04, 0.12, 8, 0, 0.05, 0.22, MARBLE); k.cone(0.02, 0.08, 6, 0, 0.17, 0.22, '#bfe6ee');
      for (const sx of [-1, 1]) pot(k, sx * 0.4, 0.4, 1.4, '#e8dfcf');
      k.smoke.push([-0.18, 0.1, 0.22], [0.2, 0.1, 0.2]);
      return;
    }
    if (L === 6) {
      const brick = BRICK[(v + 4) % BRICK.length];
      k.plinth(0.84, 0.56, '#9a958c'); k.walls(0.84, 0.34, 0.56, 0.06, brick, '#e8dcc6');
      k.add(vaultG(0.28, 0.86, 12).scale(1, 0.55, 1).translate(0, 0.4, 0), '#cfe6ec', 'win');
      for (const x of [-0.4, -0.2, 0, 0.2, 0.4]) k.add(new THREE.TorusGeometry(0.28, 0.012, 4, 12, Math.PI).scale(1, 0.55, 1).rotateY(Math.PI / 2).translate(x, 0.4, 0), '#4a5560');
      for (const x of [-0.28, -0.14, 0.14, 0.28]) pane(k, 0, x, 0.22, 0.28, 0.08, 0.16, { arch: true, frame: '#e8dcc6' });
      archway(k, 0, 0, 0.28, 0.1, 0.24, '#3e5a6a', 0.06);
      k.cyl(0.04, 0.05, 0.8, 8, 0.34, 0, -0.2, '#9a5a44'); k.smoke.push([0.34, 0.82, -0.2]);
      return;
    }
    // Moderne: Spa mit flachem Pavillon, großem Becken, Liegen, Palmen und Dampf
    k.box(0.94, 0.03, 0.94, 0, 0, 0, '#e4dfd6');
    k.box(0.8, 0.3, 0.3, 0, 0.03, -0.28, '#f4f1ea');
    k.box(0.7, 0.2, 0.02, 0, 0.07, -0.124, GLASS, 'win');
    k.box(0.88, 0.035, 0.38, 0, 0.33, -0.26, '#f4f1ea'); k.box(0.8, 0.02, 0.3, 0, 0.365, -0.28, '#86b06a');
    k.box(0.56, 0.012, 0.3, -0.06, 0.03, 0.14, '#5fc4d4');
    k.cyl(0.08, 0.08, 0.05, 12, 0.34, 0.03, 0.08, '#e4dfd6'); k.cyl(0.07, 0.07, 0.01, 12, 0.34, 0.075, 0.08, '#7fd4e0'); k.smoke.push([0.34, 0.12, 0.08]);
    for (const x of [-0.24, -0.08, 0.08]) { k.add(new THREE.BoxGeometry(0.07, 0.012, 0.14).rotateX(-0.25).translate(x, 0.06, 0.4), '#f4f4f2'); k.box(0.06, 0.04, 0.012, x, 0.03, 0.34, '#c9a27a'); }
    for (const [x, z] of [[-0.4, 0.38], [0.4, 0.36]]) {
      k.add(new THREE.CylinderGeometry(0.012, 0.018, 0.4, 5).rotateZ(x < 0 ? -0.15 : 0.15).translate(x, 0.2, z), '#9b7a55');
      for (let i = 0; i < 5; i++) k.add(new THREE.BoxGeometry(0.16, 0.012, 0.04).translate(0.08, 0, 0).rotateZ(-0.35).rotateY(i * 1.26).translate(x - (x < 0 ? -0.06 : 0.06), 0.4, z), '#6aa64f');
    }
    umbrellaTable(k, 0.24, 0.42, '#f4f1de');
  },

  // Arena: ovaler Ring mit Bögen in zwei Reihen, Ränge, Sandboden, Sonnensegel; später Stahldach oder Membran
  arena(k, L, v) {
    const sz = 0.78, R = 0.56, stone = L >= 7 ? '#ece8e0' : L === 6 ? STONE[0] : STONE[(v + 2) % 3];
    const E = g => g.scale(1, 1, sz);
    k.add(E(new THREE.CylinderGeometry(0.31, 0.31, 0.03, 20)), L >= 7 ? '#5fa04e' : '#e8d3a0');
    const prof = [new THREE.Vector2(R, 0.46)];
    for (let i = 4; i >= 0; i--) { const r = 0.3 + i * 0.05, y = 0.08 + i * 0.07; prof.push(new THREE.Vector2(r + 0.05, y), new THREE.Vector2(r, y)); }
    prof.push(new THREE.Vector2(0.3, 0.02));
    k.add(E(new THREE.LatheGeometry(prof, 24)), STONE[(v + 1) % 3]);
    k.add(E(new THREE.CylinderGeometry(R, R + 0.01, 0.46, 28, 1, true)).translate(0, 0.23, 0), stone);
    for (const y of [0.16, 0.31, 0.45]) k.add(E(new THREE.CylinderGeometry(R + 0.016, R + 0.016, 0.03, 28, 1, true)).translate(0, y, 0), STONE[0]);
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i + 0.5) / n * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const x = c * (R + 0.008), z = s * (R + 0.008) * sz, ry = Math.atan2(c / R, s / (R * sz * sz));
      k.add(new THREE.BoxGeometry(0.07, 0.07, 0.03).translate(0, 0.035, 0).rotateY(ry).translate(x, 0.04, z), '#4a3e36');
      k.add(semi(0.035, 0.03, 5).rotateY(ry).translate(x, 0.11, z), '#4a3e36');
      k.add(new THREE.BoxGeometry(0.06, 0.07, 0.03).rotateY(ry).translate(x, 0.235, z), '#4a3e36');
      k.add(semi(0.03, 0.03, 5).rotateY(ry).translate(x, 0.27, z), '#4a3e36');
      if (i % 2 === 0) k.add(new THREE.BoxGeometry(0.04, 0.05, 0.03).rotateY(ry).translate(x, 0.39, z), '#4a3e36');
    }
    if (L <= 5) {
      // Sonnensegel in zwei Farben
      for (let i = 0; i < 14; i++) {
        if (i % 7 === 3) continue;
        const a = (i + 0.5) / 14 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), ry = Math.atan2(c, s / sz);
        k.add(new THREE.BoxGeometry(0.2, 0.008, 0.17).rotateX(-0.22).rotateY(ry).translate(c * 0.47, 0.49, s * 0.47 * sz), i % 2 ? '#f2e6c8' : ['#c8553d', '#2f6f73', '#d98a4e'][v]);
      }
      for (const a of [0.8, 2.35, 3.9, 5.5]) flag(k, Math.cos(a) * 0.55, Math.sin(a) * 0.55 * sz, 0.22, [CRIMSON, GOLD, '#2f6f73'][v], 0.46, 0.1);
    } else {
      // Dach über den Rängen: Stahl in der Industrie, weiße Membran in der Moderne
      k.add(E(new THREE.CylinderGeometry(0.42, R + 0.03, 0.08, 28, 1, true)).translate(0, 0.52, 0), L === 6 ? '#6f7a84' : '#f7f5ee');
      if (L >= 7) for (const a of [0.8, 2.35, 3.9, 5.5]) { k.cyl(0.01, 0.014, 0.42, 5, Math.cos(a) * 0.56, 0.46, Math.sin(a) * 0.56 * sz, '#c9ccd0'); k.box(0.08, 0.05, 0.03, Math.cos(a) * 0.56, 0.88, Math.sin(a) * 0.56 * sz, '#fff6dc', 'glow'); }
    }
  },

  // Palast: Saalbau mit Türmen und Torbau, Barockschloss mit Ehrenhof und Goldkuppel, Parlament mit Glaskuppel
  palast(k, L, v) {
    const ban = [CRIMSON, '#2f4b8a', '#5a3d7a'][v];
    if (L <= 4) {
      const wall = PLASTER[(v * 3 + 1) % 8], roofC = SLATE[v % 2], hz = -0.12;
      k.plinth(0.76, 0.42, STONE[1], 0, hz); k.walls(0.76, 0.6, 0.42, 0.06, wall, null, 0, hz);
      k.roof(0.76, 0.42, 0.36, 0.66, roofC, { rows: 6, gable: wall, z: hz, moss: 0.1 });
      for (const x of [-0.22, 0.22]) { k.box(0.12, 0.1, 0.1, x, 0.78, hz + 0.12, wall); k.roof(0.12, 0.12, 0.07, 0.88, roofC, { rows: 2, over: 0.02, ry: Math.PI / 2, x, z: hz + 0.12 }); k.box(0.06, 0.07, 0.02, x, 0.8, hz + 0.172, '#ffd486', 'win'); }
      for (const x of [-0.28, -0.16, 0.16, 0.28]) { pane(k, 0, x, 0.48, hz + 0.21, 0.06, 0.12, { arch: true }); pane(k, 0, x, 0.22, hz + 0.21, 0.06, 0.1); pane(k, 2, x, 0.4, hz - 0.21, 0.06, 0.12); }
      for (const sx of [-1, 1]) {
        k.tower(sx * 0.4, 0.12, 0.13, 0.86, wall, roofC);
        k.box(0.06, 0.2, 0.008, sx * 0.4, 0.46, 0.255, ban); k.ball(0.012, sx * 0.4, 0.45, 0.26, GOLD, null, 0);
      }
      k.walls(0.24, 0.74, 0.16, 0.06, STONE[2], null, 0, 0.14);
      for (const sx of [-1, 1]) k.box(0.03, 0.74, 0.03, sx * 0.12, 0.06, 0.22, STONE[0]);
      k.crenel(0.26, 0.18, 0.8, STONE[0]);
      k.add(new THREE.ConeGeometry(0.15, 0.3, 4).rotateY(Math.PI / 4).translate(0, 0.95, 0.14), roofC[0]);
      k.ball(0.02, 0, 1.11, 0.14, GOLD, null, 0);
      archway(k, 0, 0, 0.22, 0.12, 0.22, '#3b302a', 0.06);
      crest(k, 0, 0.6, 0.225, ban);
      flag(k, 0, hz, 0.24, ban, 1.02);
      for (const sx of [-1, 1]) { k.cone(0.05, 0.16, 7, sx * 0.2, 0, 0.36, '#4f7f42'); k.cyl(0.03, 0.035, 0.04, 6, sx * 0.2, 0, 0.36, '#c9774f'); }
      return;
    }
    if (L <= 6) {
      const wall = L === 5 ? ['#f0dcb8', '#efe5d1', '#f3cbb9'][v] : ['#e8d9c0', '#f0e2c8', '#e6d2c0'][v];
      const roofC = L === 5 ? SLATE[0] : COPPER, trim = '#f7f1e6', cz = -0.2;
      k.plinth(1.0, 0.36, STONE[1], 0, cz);
      k.box(1.0, 0.52, 0.36, 0, 0.06, cz, wall);
      k.box(1.04, 0.035, 0.4, 0, 0.58, cz, trim);
      wedge(k, 1.0, 0.36, 0.16, 0.45, 0.615, roofC[0], 0, cz);
      for (const sx of [-1, 1]) {
        const wx = sx * 0.39, wzc = 0.18;
        k.plinth(0.22, 0.4, STONE[1], wx, wzc);
        k.box(0.22, 0.44, 0.4, wx, 0.06, wzc, wall);
        k.box(0.25, 0.03, 0.43, wx, 0.5, wzc, trim);
        wedge(k, 0.4, 0.22, 0.12, 0.4, 0.53, roofC[1], wx, wzc, Math.PI / 2);
        for (const y of [0.18, 0.38]) { pane(k, 0, wx, y, wzc + 0.2, 0.06, 0.1, { arch: y > 0.3 }); pane(k, sx > 0 ? 3 : 1, wx - sx * 0.11, y, wzc + 0.08, 0.05, 0.1); pane(k, sx > 0 ? 3 : 1, wx - sx * 0.11, y, wzc - 0.08, 0.05, 0.1); }
        k.ball(0.02, wx, 0.7, wzc, GOLD, null, 0);
        flag(k, sx * 0.3, cz, 0.22, ban, 0.75);
      }
      for (const x of [-0.24, -0.15, 0.15, 0.24]) for (const y of [0.2, 0.42]) pane(k, 0, x, y, cz + 0.18, 0.055, 0.1, { arch: y > 0.3 });
      for (const x of [-0.36, -0.12, 0.12, 0.36]) pane(k, 2, x, 0.32, cz - 0.18, 0.06, 0.12);
      k.box(0.3, 0.56, 0.08, 0, 0.06, -0.0, trim);
      for (const x of [-0.11, -0.04, 0.04, 0.11]) column(k, x, 0.06, 0.055, 0.5, 0.018, trim);
      k.box(0.32, 0.04, 0.1, 0, 0.56, 0.01, trim);
      prism(k, 0.1, 0.34, 0.12, 0.6, trim, 0, 0.01, Math.PI / 2);
      k.ball(0.022, 0, 0.74, 0.03, GOLD, null, 0);
      k.cyl(0.11, 0.11, 0.08, 14, 0, 0.74, cz, wall);
      k.add(domeG(0.12, 14, 5).translate(0, 0.82, cz), GOLD);
      k.cyl(0.025, 0.025, 0.06, 6, 0, 0.94, cz, trim); k.ball(0.02, 0, 1.02, cz, GOLD, null, 0);
      archway(k, 0, 0, 0.04, 0.09, 0.2, '#5b4a6e', 0.06);
      pane(k, 0, 0, 0.42, 0.04, 0.06, 0.12, { arch: true });
      k.box(0.56, 0.012, 0.36, 0, 0.0, 0.22, GRAVEL);
      k.cyl(0.08, 0.09, 0.04, 12, 0, 0, 0.28, STONE[0]); k.cyl(0.07, 0.07, 0.01, 12, 0, 0.035, 0.28, '#7cc4cf'); k.cone(0.02, 0.1, 6, 0, 0.04, 0.28, '#bfe6ee');
      for (const sx of [-1, 1]) { k.box(0.04, 0.05, 0.3, sx * 0.24, 0, 0.24, HEDGE); k.cone(0.035, 0.14, 7, sx * 0.2, 0, 0.42, '#4f7f42'); }
      return;
    }
    // Moderne: Parlament aus hellem Stein mit Ecktürmen, Säulenfront und gläserner Kuppel
    k.plinth(0.96, 0.66, '#d6d0c6');
    k.box(0.96, 0.44, 0.66, 0, 0.06, 0, '#ede8df');
    k.box(1.0, 0.035, 0.7, 0, 0.5, 0, '#f7f5ee');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { k.box(0.16, 0.56, 0.16, sx * 0.4, 0.06, sz * 0.25, '#e4ded2'); k.box(0.18, 0.03, 0.18, sx * 0.4, 0.62, sz * 0.25, '#f7f5ee'); }
    for (let i = 0; i < 6; i++) column(k, -0.2 + i * 0.08, 0.06, 0.37, 0.42, 0.02, '#f7f5ee');
    k.box(0.5, 0.06, 0.1, 0, 0.48, 0.36, '#f7f5ee');
    steps(k, 0.5, 0.1, 2, 0, STONE[0], 0, 0.44);
    for (const x of [-0.24, -0.12, 0.12, 0.24]) for (const y of [0.18, 0.36]) pane(k, 0, x, y, 0.33, 0.04, 0.1, { frame: '#f7f5ee' });
    for (const x of [-0.24, -0.12, 0, 0.12, 0.24]) pane(k, 2, x, 0.3, -0.33, 0.05, 0.12, { frame: '#f7f5ee' });
    k.add(domeG(0.22, 14, 6).translate(0, 0.535, 0), '#bfe0ea', 'win');
    for (let i = 0; i < 4; i++) k.add(new THREE.TorusGeometry(0.222, 0.008, 3, 12, Math.PI).rotateY(i * Math.PI / 4).translate(0, 0.535, 0), '#c9ccd0');
    k.box(0.06, 0.04, 0.06, 0, 0.76, 0, '#c9ccd0');
    for (const x of [-0.3, 0, 0.3]) flag(k, x, 0.47, 0.4, x === 0 ? ban : ['#e9c46a', '#2f6f73', '#c8553d'][v], 0, 0.12);
  },

  // Kathedrale: gotisch mit Doppelturmfront, Fensterrose und Strebebögen; Renaissance mit Ziegelkuppel und Campanile;
  // Industrie als Backsteingotik mit Kupferspitzen; Moderne als weißer Spitzbau mit Glasband
  kathedrale(k, L, v) {
    const ROSE = ['#c86f8a', '#6f8fc8', '#c8a46f'][v];
    const gothic = (wall, trim, roofC, spireC) => {
      const nw = 0.4, nl = 0.92, nz = -0.14, nh = 0.56, fz = nz + nl / 2;
      k.plinth(nw + 0.28, nl, STONE[1], 0, nz);
      k.box(nw, nh, nl, 0, 0.06, nz, wall);
      k.roof(nl, nw, 0.36, 0.06 + nh, roofC, { rows: 6, gable: wall, ry: Math.PI / 2, z: nz, moss: 0.06, over: 0.04 });
      for (const sx of [-1, 1]) {
        k.box(0.12, 0.3, nl - 0.12, sx * 0.26, 0.06, nz - 0.04, wall);
        k.add(new THREE.BoxGeometry(0.16, 0.025, nl - 0.1).rotateZ(-sx * 0.5).translate(sx * 0.27, 0.4, nz - 0.04), roofC[1]);
        for (let i = 0; i < 4; i++) {
          const z = nz + 0.32 - i * 0.2;
          if (i === 2) continue;
          k.box(0.05, 0.42, 0.05, sx * 0.34, 0.06, z, trim);
          k.cone(0.026, 0.09, 4, sx * 0.34, 0.48, z, trim, null, Math.PI / 4);
          k.add(new THREE.BoxGeometry(0.15, 0.022, 0.028).rotateZ(sx * 0.55).translate(sx * 0.27, 0.53, z), trim);
          pane(k, sx > 0 ? 1 : 3, sx * nw / 2, 0.5, z + 0.1, 0.035, 0.1, { glass: ROSE, frame: trim });
          pane(k, sx > 0 ? 1 : 3, sx * 0.32, 0.2, z + 0.1, 0.04, 0.14, { glass: ['#8f7fc8', '#c87f7f', '#7fa8c8'][i % 3], frame: trim });
        }
      }
      const tz = nz - 0.18;
      k.box(0.86, nh, 0.24, 0, 0.06, tz, wall);
      k.roof(0.86, 0.24, 0.3, 0.06 + nh, roofC, { rows: 5, gable: wall, z: tz, moss: 0.06, over: 0.04 });
      for (const sx of [-1, 1]) k.add(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 12).rotateZ(Math.PI / 2).translate(sx * 0.43, 0.42, tz), ROSE, 'win');
      k.box(0.14, 0.2, 0.14, 0, 0.66, tz, wall);
      k.cone(0.1, 0.44, 8, 0, 0.86, tz, spireC);
      k.ball(0.018, 0, 1.31, tz, GOLD, null, 0);
      for (const sx of [-1, 1]) {
        const x = sx * 0.2;
        k.box(0.18, 1.0, 0.18, x, 0.06, fz, wall);
        for (const cx of [-1, 1]) k.box(0.035, 0.92, 0.035, x + cx * 0.09, 0.06, fz + 0.09, trim);
        archway(k, 0, x, fz + 0.09, 0.06, 0.16, '#3b302a', 0.8);
        archway(k, 0, x, fz + 0.09, 0.07, 0.16, '#3b302a', 0.06);
        pane(k, 0, x, 0.5, fz + 0.09, 0.04, 0.12, { arch: true, glass: ROSE, frame: trim });
        k.box(0.21, 0.04, 0.21, x, 1.06, fz, trim);
        for (const cx of [-1, 1]) for (const cz of [-1, 1]) k.cone(0.018, 0.1, 4, x + cx * 0.085, 1.1, fz + cz * 0.085, trim, null, Math.PI / 4);
        k.cone(0.1, 0.52, 8, x, 1.1, fz, spireC);
        k.ball(0.018, x, 1.63, fz, GOLD, null, 0);
      }
      k.box(0.24, 0.64, 0.04, 0, 0.06, fz + 0.06, wall);
      prism(k, 0.04, 0.24, 0.2, 0.7, wall, 0, fz + 0.06, Math.PI / 2);
      k.add(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 16).rotateX(Math.PI / 2).translate(0, 0.52, fz + 0.085), ROSE, 'win');
      k.add(new THREE.TorusGeometry(0.078, 0.01, 4, 16).translate(0, 0.52, fz + 0.092), trim);
      for (let i = 0; i < 4; i++) k.add(new THREE.BoxGeometry(0.15, 0.008, 0.008).rotateZ(i * Math.PI / 4).translate(0, 0.52, fz + 0.096), trim);
      archway(k, 0, 0, fz + 0.08, 0.11, 0.26, '#3b302a', 0.06);
      k.box(0.5, 0.03, 0.08, 0, 0, fz + 0.14, STONE[1]);
      const az = nz - nl / 2;
      k.add(new THREE.CylinderGeometry(0.2, 0.2, nh, 12, 1, false, Math.PI / 2, Math.PI).translate(0, 0.06 + nh / 2, az), wall);
      k.add(new THREE.ConeGeometry(0.22, 0.3, 12, 1, false, Math.PI / 2, Math.PI).translate(0, 0.06 + nh + 0.15, az), roofC[0]);
    };
    if (L <= 4) { gothic(STONE[(v + 2) % 3], STONE[0], SLATE[v % 2], SLATE[0][1]); return; }
    if (L === 6) { gothic(BRICK[(v + 1) % BRICK.length], '#e8dcc6', SLATE[0], COPPER[v]); return; }
    if (L === 5) {
      // Renaissance: Marmor mit grünen Bändern, Ziegelkuppel auf Achteck, Campanile
      const M = '#f4efe4', G = ['#5f8f72', '#c88f8f', '#6f8fa8'][v], nz = -0.12, nl = 0.86;
      k.plinth(0.46, nl, STONE[1], 0, nz);
      k.box(0.42, 0.52, nl, 0, 0.06, nz, M);
      for (const y of [0.2, 0.4]) k.box(0.43, 0.025, nl + 0.01, 0, y, nz, G);
      k.roof(nl, 0.42, 0.2, 0.58, TERRA[v % 2], { rows: 4, gable: M, ry: Math.PI / 2, z: nz, moss: 0.04 });
      const cz = nz - 0.24;
      k.box(0.8, 0.5, 0.26, 0, 0.06, cz, M);
      k.roof(0.8, 0.26, 0.16, 0.56, TERRA[(v + 1) % 2], { rows: 3, gable: M, z: cz, moss: 0.04 });
      k.cyl(0.24, 0.24, 0.22, 8, 0, 0.56, cz, M);
      k.cyl(0.245, 0.245, 0.03, 8, 0, 0.7, cz, G);
      k.add(domeG(0.24, 8, 6, 1.3).translate(0, 0.78, cz), '#c8664a');
      for (let i = 0; i < 8; i++) k.add(new THREE.TorusGeometry(0.242, 0.01, 3, 8, Math.PI / 2).scale(1, 1.3, 1).rotateY(i * Math.PI / 4 + Math.PI / 8).translate(0, 0.78, cz), M);
      k.cyl(0.05, 0.05, 0.1, 8, 0, 1.08, cz, M); k.cone(0.05, 0.1, 8, 0, 1.18, cz, M); k.ball(0.022, 0, 1.3, cz, GOLD, null, 0);
      const fz = nz + nl / 2;
      k.box(0.46, 0.66, 0.04, 0, 0.06, fz, M);
      for (const x of [-0.15, 0, 0.15]) k.box(0.1, 0.14, 0.01, x, 0.36, fz + 0.022, G);
      prism(k, 0.04, 0.46, 0.16, 0.72, M, 0, fz, Math.PI / 2);
      k.add(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 14).rotateX(Math.PI / 2).translate(0, 0.58, fz + 0.025), ROSE, 'win');
      archway(k, 0, 0, fz + 0.02, 0.1, 0.22, '#5b4a3c', 0.06);
      for (const sx of [-1, 1]) archway(k, 0, sx * 0.15, fz + 0.02, 0.06, 0.14, '#5b4a3c', 0.06);
      for (let i = 0; i < 4; i++) { pane(k, 1, 0.21, 0.32, nz + 0.3 - i * 0.18, 0.04, 0.12, { arch: true, glass: ROSE }); pane(k, 3, -0.21, 0.32, nz + 0.3 - i * 0.18, 0.04, 0.12, { arch: true, glass: ROSE }); }
      const bx = 0.36, bz = 0.2;
      k.box(0.16, 1.2, 0.16, bx, 0.06, bz, M);
      for (const y of [0.3, 0.6, 0.9]) k.box(0.17, 0.03, 0.17, bx, y, bz, G);
      archway(k, 0, bx, bz + 0.08, 0.06, 0.14, '#3b302a', 1.0);
      k.add(new THREE.ConeGeometry(0.13, 0.16, 4).rotateY(Math.PI / 4).translate(bx, 1.34, bz), TERRA[0][0]);
      k.ball(0.016, bx, 1.43, bz, GOLD, null, 0);
      k.box(0.5, 0.03, 0.08, 0, 0, fz + 0.06, STONE[1]);
      return;
    }
    // Moderne: hoher weißer Spitzbau, Glasband, freistehender Glockenturm mit Kreuz
    k.plinth(0.66, 0.86, '#d6d0c6', 0, -0.06);
    prism(k, 0.86, 0.66, 1.1, 0.06, '#f4f2ee', 0, -0.06, Math.PI / 2);
    prism(k, 0.02, 0.26, 0.8, 0.06, '#9fc4d8', 0, 0.375, Math.PI / 2, 'win');
    // Rückseite (seit 24.10.2026, Runde 3): Glasschlitz und Rundfenster auch hinten, die Kamera kreist
    prism(k, 0.02, 0.26, 0.8, 0.06, '#9fc4d8', 0, -0.495, Math.PI / 2, 'win');
    k.add(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 20).rotateX(Math.PI / 2).translate(0, 0.86, -0.49), '#ffd486', 'win');
    if (k.fine()) k.add(new THREE.TorusGeometry(0.08, 0.01, 4, 20).translate(0, 0.86, -0.5), '#e4dfd6');
    for (const sx of [-1, 1]) k.add(new THREE.BoxGeometry(0.02, 0.62, 0.8).rotateZ(sx * 0.53).translate(sx * 0.17, 0.4, -0.06), '#bcd8e4', 'win');
    k.box(0.3, 0.02, 0.12, 0, 0.26, 0.42, '#e4dfd6');
    k.box(0.12, 0.22, 0.02, 0, 0.06, 0.39, '#c9a27a');
    k.box(0.1, 1.5, 0.1, 0.38, 0.06, 0.3, '#f4f2ee');
    k.box(0.06, 0.16, 0.11, 0.38, 1.2, 0.3, '#3b302a');
    k.box(0.012, 0.16, 0.012, 0.38, 1.56, 0.3, GOLD); k.box(0.08, 0.012, 0.012, 0.38, 1.66, 0.3, GOLD);
    k.box(0.9, 0.012, 0.3, 0, 0, 0.36, '#e4dfd6');
    for (const sx of [-1, 1]) { tree(k, sx * 0.4, -0.38, 0.8, sx > 0 ? '#86bd5a' : '#e9a7b8'); bench(k, sx * 0.24, 0.44, Math.PI); }
  },

  // Gildenhaus: Laubengang unten, Fachwerk oben, Wappen; Treppengiebel; moderne Zentrale
  gilde(k, L, v) {
    const col = [CRIMSON, '#2f4b8a', '#2f6f73'][v];
    if (L <= 4) {
      const pl = PLASTER[(v * 3 + 7) % 8], roofC = ROOF_MIX[(v * 2 + 1) % ROOF_MIX.length];
      k.plinth(0.72, 0.48);
      k.box(0.72, 0.26, 0.48, 0, 0.06, 0, STONE[2]);
      for (const x of [-0.22, 0, 0.22]) archway(k, 0, x, 0.24, 0.13, 0.2, '#3b302a', 0.06);
      k.box(0.76, 0.34, 0.54, 0, 0.32, 0.02, pl);
      for (const x of [-0.36, -0.18, 0, 0.18, 0.36]) k.box(0.024, 0.34, 0.02, x, 0.32, 0.292, WOOD);
      for (const y of [0.32, 0.64]) k.box(0.78, 0.024, 0.02, 0, y, 0.292, WOOD);
      for (const x of [-0.27, -0.09, 0.09, 0.27]) k.add(new THREE.BoxGeometry(0.016, 0.16, 0.014).rotateZ(x < 0 ? 0.5 : -0.5).translate(x, 0.41, 0.294), WOOD);
      for (const x of [-0.27, 0.27, -0.09, 0.09]) pane(k, 0, x, 0.55, 0.29, 0.07, 0.09);
      for (const x of [-0.2, 0.2]) pane(k, 2, x, 0.48, -0.25, 0.07, 0.1);
      k.roof(0.76, 0.54, 0.42, 0.66, roofC, { rows: 6, gable: pl, z: 0.02, moss: 0.15 });
      crest(k, 0, 0.68, 0.3, col);
      k.cyl(0.07, 0.07, 0.3, 10, 0.39, 0.36, 0.28, pl);
      k.coneRoof(0.1, 0.22, 0.66, roofC, 0.39, 0.28, 2);
      pane(k, 0, 0.39, 0.5, 0.35, 0.04, 0.08);
      flag(k, -0.3, 0.02, 0.2, col, 1.06);
      return;
    }
    if (L <= 6) {
      // Treppengiebel zur Straße, goldene Spitzen, Wappen im Giebel, ab der Industrie mit Uhr
      const brick = L === 6, wall = brick ? BRICK[(v * 2) % BRICK.length] : PLASTER[(v * 2 + 7) % 8], trim = '#f4ece0';
      k.plinth(0.6, 0.6, brick ? '#9a958c' : STONE[1]); k.walls(0.6, 0.66, 0.6, 0.06, wall, brick ? null : STONE[0]);
      k.roof(0.6, 0.6, 0.36, 0.72, SLATE[(v + 1) % 2], { rows: 5, gable: wall, ry: Math.PI / 2 });
      for (let i = 0; i < 4; i++) {
        const ww = 0.6 - i * 0.14, y = 0.72 + i * 0.09;
        k.box(ww, 0.09, 0.05, 0, y, 0.3, wall);
        k.box(ww + 0.02, 0.02, 0.06, 0, y + 0.09, 0.3, trim);
        for (const sx of [-1, 1]) k.ball(0.016, sx * ww / 2, y + 0.12, 0.31, GOLD, null, 0);
      }
      for (const y of [0.22, 0.48]) for (const x of [-0.18, 0, 0.18]) { if (y < 0.3 && x === 0) continue; pane(k, 0, x, y, 0.3, 0.07, 0.12, { arch: y > 0.3, frame: trim }); }
      for (const y of [0.22, 0.48]) for (const z of [-0.14, 0.14]) { pane(k, 1, 0.3, y, z, 0.06, 0.1, { frame: trim }); pane(k, 3, -0.3, y, z, 0.06, 0.1, { frame: trim }); }
      for (const x of [-0.14, 0.14]) pane(k, 2, x, 0.4, -0.3, 0.07, 0.12, { frame: trim });
      k.door(0, 0, 0.3, true, '#5b4a3c');
      if (brick) clock(k, 0, 0.92, 0.33, 0.055); else crest(k, 0, 1.02, 0.33, col);
      if (brick) crest(k, 0, 0.42, 0.31, col);
      return;
    }
    // Moderne Gildenzentrale: helle Fassade, Glasbänder, Holzlamellen, Wappen als Logo
    k.plinth(0.64, 0.56, '#d6d0c6'); k.walls(0.64, 0.8, 0.56, 0.06, '#e9e6df', null);
    for (let f = 0; f < 3; f++) { const y = 0.12 + f * 0.25; glassBand(k, 0.56, y, 0.17, 0.282, 6); glassBand(k, 0.56, y, 0.17, -0.282, 6); k.box(0.02, 0.17, 0.4, 0.322, y, 0, GLASS, 'win'); k.box(0.02, 0.17, 0.4, -0.322, y, 0, GLASS, 'win'); }
    for (let i = 0; i < 7; i++) k.box(0.018, 0.8, 0.03, -0.27 + i * 0.09, 0.06, 0.3, '#c9a27a');
    k.box(0.68, 0.04, 0.6, 0, 0.86, 0, '#5d6670');
    crest(k, 0, 1.0, 0.24, col);
    k.box(0.24, 0.02, 0.12, 0, 0.3, 0.34, '#e4dfd6');
  },

  // Werft am Wasser (+z): Helling mit Schiffsgerippe, Kran, Werkschuppen; später Stahlrumpf und Portalkran
  werft(k, L, v) {
    const ang = 0.18, zc = 0.42, len = 1.05;
    const slip = (g, x, s, h, c) => { g.translate(x, h, s).rotateX(ang).translate(0, -0.035, zc); return k.add(g, c); };
    slip(new THREE.BoxGeometry(0.42, 0.04, len), 0, 0, 0, L >= 6 ? '#9a958c' : WOOD2);
    for (const sx of [-1, 1]) slip(new THREE.BoxGeometry(0.03, 0.03, len), sx * 0.16, 0, 0.035, L >= 6 ? '#5d6066' : WOOD);
    for (const sx of [-1, 1]) for (const s of [-0.3, 0.1, 0.45]) k.cyl(0.022, 0.022, 0.35, 5, sx * 0.19, -0.3, zc + s, WOOD);
    if (L <= 5) {
      // Holzschiff im Bau: Kiel, Spanten, ein paar Planken, Gerüst
      slip(new THREE.BoxGeometry(0.035, 0.035, 0.74), 0, 0, 0.06, WOOD);
      slip(new THREE.BoxGeometry(0.03, 0.3, 0.03).rotateX(-0.35), 0, 0.4, 0.18, WOOD);
      slip(new THREE.BoxGeometry(0.03, 0.26, 0.03).rotateX(0.15), 0, -0.36, 0.16, WOOD);
      for (let i = 0; i < 7; i++) {
        const s = -0.28 + i * 0.095, r = 0.13 * (1 - Math.pow(s / 0.42, 2) * 0.7);
        slip(new THREE.TorusGeometry(r, 0.009, 3, 8, Math.PI).rotateZ(Math.PI).scale(1, 1.15, 1), 0, s, 0.07 + r * 1.15, '#a8865f');
      }
      const planks = L === 5 ? 3 : 2;
      for (const sx of [-1, 1]) for (let j = 0; j < planks; j++) {
        const t = 0.25 + j * 0.25, r = 0.12;
        slip(new THREE.BoxGeometry(0.012, 0.03, 0.5 - j * 0.06), sx * r * Math.sin(t * 1.4 + 0.2) * 0.95, 0, 0.07 + r * 1.15 * (1 - Math.cos(t * 1.4 + 0.2)), j % 2 ? '#9b7450' : '#8a6a4c');
      }
      for (const sx of [-1, 1]) for (const s of [-0.2, 0.15]) { slip(new THREE.BoxGeometry(0.012, 0.3, 0.012), sx * 0.18, s, 0.17, WOOD); }
      slip(new THREE.BoxGeometry(0.38, 0.012, 0.012), 0, -0.2, 0.3, WOOD); slip(new THREE.BoxGeometry(0.38, 0.012, 0.012), 0, 0.15, 0.3, WOOD);
      // Kran mit Tretrad
      const cx = 0.34, cz = -0.12;
      k.cyl(0.025, 0.03, 0.78, 6, cx, 0, cz, WOOD);
      k.add(new THREE.BoxGeometry(0.025, 0.025, 0.5).rotateX(0.35).translate(cx - 0.1, 0.72, cz + 0.16).rotateY(0.0), WOOD);
      k.add(new THREE.BoxGeometry(0.2, 0.02, 0.02).translate(cx - 0.1, 0.78, cz), WOOD);
      k.cyl(0.003, 0.003, 0.36, 3, cx - 0.2, 0.42, cz + 0.06, DARK);
      k.box(0.12, 0.03, 0.03, cx - 0.2, 0.39, cz + 0.06, '#9b7450');
      k.add(new THREE.TorusGeometry(0.1, 0.014, 4, 14).rotateY(Math.PI / 2).translate(cx + 0.02, 0.12, cz - 0.12), WOOD2);
      // Werkschuppen und Holzstapel
      const roofC = L >= 5 ? SLATE[v % 2] : L === 4 ? TERRA[v % 2] : THATCH[v % 2];
      wing(k, -0.32, -0.26, 0.28, 0.4, 0.24, L >= 4 ? STONE[2] : '#e6d6b6', roofC, { rot: true, rh: 0.14, rows: 3 });
      k.box(0.1, 0.16, 0.02, -0.32, 0.06, -0.05, WOOD);
      for (let i = 0; i < 3; i++) k.add(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 6).rotateX(Math.PI / 2).translate(-0.36 + i * 0.065, 0.03, 0.2), i % 2 ? '#9a6b44' : '#8a5f3c');
      k.add(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 6).rotateX(Math.PI / 2).translate(-0.33, 0.085, 0.2), '#9a6b44');
      return;
    }
    // Stahlrumpf auf der Helling, Portalkran, Halle
    const hull = L === 6 ? ['#2f3a40', '#a35c44'] : ['#3d5a7a', '#c8553d'];
    slip(new THREE.BoxGeometry(0.22, 0.06, 0.58), 0, -0.04, 0.08, hull[1]);
    slip(new THREE.BoxGeometry(0.22, 0.08, 0.58), 0, -0.04, 0.15, hull[0]);
    slip(new THREE.ConeGeometry(0.155, 0.2, 4).rotateY(Math.PI / 4).rotateX(Math.PI / 2).scale(1, 0.64, 1), 0, 0.35, 0.12, hull[0]);
    slip(new THREE.BoxGeometry(0.2, 0.01, 0.5), 0, -0.04, 0.19, '#9a958c');
    if (L >= 7) { slip(new THREE.BoxGeometry(0.14, 0.1, 0.12), 0, -0.22, 0.2, '#f4f4f2'); slip(new THREE.BoxGeometry(0.15, 0.03, 0.13), 0, -0.22, 0.27, GLASS); }
    for (const sx of [-1, 1]) for (const s of [-0.25, 0.0, 0.25]) slip(new THREE.BoxGeometry(0.01, 0.26, 0.01), sx * 0.15, s, 0.16, '#c9a24a');
    const gc = L === 6 ? '#a35c44' : '#e9c46a';
    for (const sx of [-1, 1]) {
      k.add(new THREE.BoxGeometry(0.03, 0.95, 0.03).rotateX(0.12).translate(sx * 0.3, 0.47, -0.02), gc);
      k.add(new THREE.BoxGeometry(0.03, 0.95, 0.03).rotateX(-0.12).translate(sx * 0.3, 0.47, 0.22), gc);
      k.box(0.06, 0.03, 0.4, sx * 0.3, 0, 0.1, gc);
    }
    k.box(0.68, 0.06, 0.08, 0, 0.92, 0.1, gc);
    k.box(0.1, 0.06, 0.1, 0.06, 0.86, 0.1, '#3e4348');
    k.cyl(0.003, 0.003, 0.5, 3, 0.06, 0.36, 0.1, DARK);
    k.box(0.06, 0.03, 0.06, 0.06, 0.34, 0.1, '#3e4348');
    const hallC = L === 6 ? BRICK[(v + 2) % BRICK.length] : '#c9ccd0';
    k.plinth(0.26, 0.5, '#9a958c', -0.36, -0.2);
    k.box(0.26, 0.4, 0.5, -0.36, 0.06, -0.2, hallC);
    if (L === 6) k.roof(0.5, 0.26, 0.12, 0.46, SLATE[0], { rows: 3, gable: hallC, ry: Math.PI / 2, x: -0.36, z: -0.2 });
    else k.add(vaultG(0.13, 0.5, 8).scale(1, 0.5, 1).rotateY(Math.PI / 2).translate(-0.36, 0.46, -0.2), '#8e969c');
    k.box(0.14, 0.24, 0.02, -0.36, 0.06, 0.052, L === 6 ? '#3e5a6a' : '#8a9096');
    pane(k, 1, -0.23, 0.32, -0.3, 0.08, 0.1, { glass: '#ffd486', frame: '#e8dcc6' });
  },

  // Universität: vier Flügel um einen Hof mit Rasen und Bäumen, Torturm mit Uhr
  universitaet(k, L, v) {
    const modern = L >= 7, brick = L === 6;
    const wall = modern ? '#f2efe8' : brick ? BRICK[(v + 3) % BRICK.length] : L <= 4 ? STONE[2] : PLASTER[(v * 3 + 3) % 8];
    const roofC = modern ? null : brick ? SLATE[0] : L <= 4 ? SLATE[v % 2] : TERRA[v % 2];
    const frame = brick ? '#e8dcc6' : '#f4ece0';
    const W = 1.0, D = 0.9, t = 0.22, h = modern ? 0.5 : 0.44, fz = D / 2 - t / 2, sx0 = W / 2 - t / 2;
    k.box(W - 2 * t, 0.02, D - 2 * t, 0, 0, 0, LAWN);
    k.box(0.06, 0.024, D - 2 * t, 0, 0, 0, GRAVEL); k.box(W - 2 * t, 0.024, 0.06, 0, 0, 0, GRAVEL);
    tree(k, 0.15, -0.12, 0.85, '#7fae5a', 0.02); tree(k, -0.15, 0.1, 0.7, ['#e9a7b8', '#93b866', '#e8c27f'][v], 0.02);
    wing(k, 0, fz, W, t, h, wall, roofC, { rh: 0.16 });
    wing(k, 0, -fz, W, t, h, wall, roofC, { rh: 0.16 });
    for (const sx of [-1, 1]) wing(k, sx * sx0, 0, t, D - 2 * t, h, wall, roofC, { rot: true, rh: 0.16 });
    if (modern) {
      for (const [x, z, w, d] of [[0, fz, W, t], [0, -fz, W, t], [sx0, 0, t, D - 2 * t], [-sx0, 0, t, D - 2 * t]]) k.box(w + 0.02, 0.03, d + 0.02, x, 0.06 + h, z, '#86b06a');
      for (const z of [D / 2, -D / 2]) for (const y of [0.18, 0.38]) { const g = z > 0 ? 0 : 2; for (const x of [-0.3, 0.3]) pane(k, g, x, y, z, 0.3, 0.12, { glass: GLASS, frame: '#3e4348' }); }
      for (const sx of [-1, 1]) pane(k, sx > 0 ? 1 : 3, sx * W / 2, 0.3, 0, 0.36, 0.14, { glass: GLASS, frame: '#3e4348' });
    } else {
      for (const x of [-0.42, -0.3, -0.18, 0.18, 0.3, 0.42]) { for (const y of [0.2, 0.38]) pane(k, 0, x, y, D / 2, 0.055, 0.1, { arch: y > 0.3 && L === 5, frame }); pane(k, 2, x, 0.3, -D / 2, 0.055, 0.1, { frame }); }
      for (const sx of [-1, 1]) for (const z of [-0.2, 0, 0.2]) pane(k, sx > 0 ? 1 : 3, sx * W / 2, 0.3, z, 0.055, 0.1, { frame });
    }
    // Torturm mit Uhr
    k.box(0.24, 0.92, 0.26, 0, 0.06, fz, modern ? '#e4dfd6' : wall);
    archway(k, 0, 0, fz + 0.13, 0.12, 0.24, '#3b302a', 0.06);
    clock(k, 0, 0.76, fz + 0.132, 0.06);
    if (modern) {
      k.box(0.25, 0.2, 0.27, 0, 0.98, fz, GLASS, 'win'); k.box(0.27, 0.03, 0.29, 0, 1.18, fz, '#5d6670');
      k.cyl(0.006, 0.008, 0.3, 4, 0.06, 1.21, fz, '#c9ccd0'); k.ball(0.016, 0.06, 1.52, fz, '#ff5a4a', 'glow', 0);
    } else if (L === 5) {
      k.box(0.27, 0.03, 0.29, 0, 0.98, fz, frame);
      k.cyl(0.1, 0.11, 0.12, 10, 0, 1.01, fz, wall);
      k.add(domeG(0.11, 10, 5, 1.2).translate(0, 1.13, fz), COPPER[v]);
      k.cyl(0.025, 0.025, 0.06, 6, 0, 1.26, fz, frame); k.ball(0.02, 0, 1.34, fz, GOLD, null, 0);
    } else {
      k.box(0.27, 0.03, 0.29, 0, 0.98, fz, brick ? '#e8dcc6' : STONE[0]);
      k.add(new THREE.ConeGeometry(0.2, 0.32, 4).rotateY(Math.PI / 4).translate(0, 1.17, fz), (roofC || SLATE[0])[0]);
      k.ball(0.02, 0, 1.35, fz, GOLD, null, 0);
    }
    for (const sx of [-1, 1]) k.box(0.05, 0.18, 0.008, sx * 0.17, 0.2, D / 2 + 0.006, ['#2f4b8a', CRIMSON, '#2f6f73'][v]);
  },

  // Bank: Palazzo mit Säulenvorhalle und Goldmünze, klassizistischer Tempel des Geldes, Glasturm auf Sockel
  bank(k, L, v) {
    const coin = (x, y, z, r = 0.035) => k.add(new THREE.CylinderGeometry(r, r, 0.012, 14).rotateX(Math.PI / 2).translate(x, y, z), GOLD);
    if (L <= 5) {
      const pl = ['#efe5d1', '#f0dcb8', '#e6d8c8'][v];
      k.plinth(0.7, 0.5, STONE[1], 0, -0.04);
      k.box(0.7, 0.26, 0.5, 0, 0.06, -0.04, STONE[1]);
      for (const y of [0.12, 0.19, 0.26]) k.box(0.71, 0.01, 0.51, 0, y, -0.04, STONE[0]);
      k.box(0.7, 0.34, 0.5, 0, 0.32, -0.04, pl);
      k.box(0.74, 0.04, 0.54, 0, 0.66, -0.04, '#f7f1e6');
      frustum(k, 0.7, 0.5, 0.12, 0.6, 0.7, SLATE[v % 2][0], 0, -0.04);
      steps(k, 0.42, 0.14, 3, 0, STONE[0], 0, 0.3);
      for (const x of [-0.15, -0.05, 0.05, 0.15]) column(k, x, 0.09, 0.3, 0.48, 0.022);
      k.box(0.42, 0.05, 0.14, 0, 0.57, 0.28, MARBLE);
      prism(k, 0.14, 0.44, 0.12, 0.62, MARBLE, 0, 0.28, Math.PI / 2);
      coin(0, 0.67, 0.355);
      k.box(0.1, 0.22, 0.02, 0, 0.09, 0.212, '#a9824a');
      for (const x of [-0.28, 0.28]) { pane(k, 0, x, 0.46, 0.21, 0.06, 0.12, { arch: true }); pane(k, 0, x, 0.18, 0.21, 0.05, 0.07, { lit: false }); }
      for (const x of [-0.2, 0, 0.2]) pane(k, 2, x, 0.46, -0.29, 0.06, 0.12);
      for (const z of [-0.15, 0.08]) { pane(k, 1, 0.35, 0.46, z, 0.06, 0.12); pane(k, 3, -0.35, 0.46, z, 0.06, 0.12); }
      k.lantern(-0.4, 0.3, 0.32); k.lantern(0.34, 0.3, 0.32);
      return;
    }
    if (L === 6) {
      const st = '#ece6da', tr = '#f7f5ee';
      k.plinth(0.84, 0.56, STONE[1], 0, -0.06);
      k.box(0.84, 0.56, 0.56, 0, 0.06, -0.06, st);
      k.box(0.88, 0.05, 0.6, 0, 0.62, -0.06, tr); k.box(0.84, 0.08, 0.56, 0, 0.67, -0.06, st);
      steps(k, 0.72, 0.18, 3, 0, STONE[0], 0, 0.34);
      for (let i = 0; i < 6; i++) column(k, -0.3 + i * 0.12, 0.09, 0.32, 0.5, 0.026, tr);
      k.box(0.74, 0.05, 0.16, 0, 0.59, 0.3, tr);
      prism(k, 0.16, 0.76, 0.14, 0.64, tr, 0, 0.3, Math.PI / 2);
      coin(0, 0.69, 0.385, 0.03);
      k.box(0.12, 0.26, 0.02, 0, 0.09, 0.222, '#a9824a');
      for (const x of [-0.18, 0.18]) pane(k, 0, x, 0.36, 0.22, 0.06, 0.14, { frame: tr });
      for (const x of [-0.26, 0, 0.26]) pane(k, 2, x, 0.36, -0.34, 0.06, 0.14, { frame: tr });
      for (const z of [-0.2, 0.06]) { pane(k, 1, 0.42, 0.36, z, 0.06, 0.14, { frame: tr }); pane(k, 3, -0.42, 0.36, z, 0.06, 0.14, { frame: tr }); }
      // Seit 19.10.2026: Gaslaternen an der Treppe, Fahne auf dem Dach, Messingschild über der Tür
      k.lantern(-0.46, 0.36, 0.34); k.lantern(0.4, 0.36, 0.34);
      flag(k, 0, -0.06, 0.3, '#2f4b80', 0.75, 0.14);
      k.box(0.14, 0.03, 0.008, 0, 0.37, 0.224, GOLD);
      return;
    }
    // Moderne: Glasturm auf hellem Sockel mit Kolonnade
    k.plinth(0.72, 0.6, '#d6d0c6');
    k.box(0.72, 0.22, 0.6, 0, 0.06, 0, '#e4dfd6');
    for (let i = 0; i < 6; i++) k.box(0.04, 0.22, 0.04, -0.3 + i * 0.12, 0.06, 0.31, '#f4f2ee');
    k.box(0.6, 0.16, 0.02, 0, 0.08, 0.29, GLASS, 'win');
    const tz = -0.04;
    k.box(0.5, 0.9, 0.44, 0, 0.28, tz, '#5f7f8f');
    for (let i = 0; i < 6; i++) { const lit = hash(i * 3 + 1, v + 5) < 0.7; k.box(0.51, 0.09, 0.45, 0, 0.32 + i * 0.145, tz, lit ? '#9fc4d8' : '#7fa4b8', lit ? 'win' : 'solid'); }
    for (let i = 0; i < 7; i++) k.box(0.012, 0.9, 0.012, -0.24 + i * 0.08, 0.28, tz + 0.226, '#e4dfd6');
    k.box(0.52, 0.06, 0.46, 0, 1.18, tz, '#e4dfd6');
    coin(0, 1.21, tz + 0.235, 0.04);
    k.box(0.26, 0.02, 0.12, 0, 0.3, 0.37, '#f4f2ee');
    // Seit 19.10.2026: Drehtür, Geldautomat, Attika mit Fahnen und Kübeln auf dem Sockel, Technik auf dem Turm, Kübel vorn
    k.cyl(0.034, 0.034, 0.16, 10, 0, 0.06, 0.315, GLASS); k.cyl(0.038, 0.038, 0.014, 10, 0, 0.22, 0.315, ANTH); k.box(0.004, 0.15, 0.066, 0, 0.065, 0.315, ANTH);
    k.box(0.05, 0.08, 0.014, 0.24, 0.08, 0.3, '#3e4348'); k.box(0.03, 0.02, 0.006, 0.24, 0.13, 0.308, '#9fe0ff', 'glow');
    attika(k, 0.72, 0.6, 0.28, '#e4dfd6', { h: 0.03 });
    for (const sx of [-1, 1]) { flag(k, sx * 0.3, 0.24, 0.3, sx > 0 ? GOLD : '#2f4b80', 0.28, 0.1); planter(k, sx * 0.16, 0.235, 0.8, 0.28); planter(k, sx * 0.42, 0.38, 0.85); }
    acUnit(k, -0.12, 1.24, tz - 0.08); acUnit(k, 0.06, 1.24, tz - 0.1, Math.PI); antenna(k, 0.17, 1.24, tz + 0.06, 0.2);
  },

  // Oper: Prunkfassade mit Arkaden, Säulen und Goldfiguren, Kupferkuppel und Bühnenhaus; Moderne mit weißen Schalen
  oper(k, L, v) {
    if (L <= 6) {
      const wall = L === 5 ? ['#efe2c6', '#f0dcb8', '#e8d9c0'][v] : ['#e9d3b8', '#ecd9c4', '#e3cdb0'][v], trim = '#f7f1e6', dome = L === 5 ? COPPER[0] : '#5f8f7f', fz = 0.33;
      k.plinth(0.9, 0.96, STONE[1], 0, -0.02);
      k.box(0.5, 0.82, 0.3, 0, 0.06, -0.32, wall);
      k.roof(0.5, 0.3, 0.16, 0.88, COPPER, { rows: 3, gable: wall, z: -0.32, moss: 0 });
      k.cone(0.03, 0.1, 6, 0, 1.04, -0.32, GOLD); k.ball(0.025, 0, 1.15, -0.32, GOLD);
      k.cyl(0.36, 0.36, 0.5, 18, 0, 0.06, -0.02, wall);
      k.cyl(0.38, 0.38, 0.04, 18, 0, 0.54, -0.02, trim);
      k.add(domeG(0.36, 16, 6, 0.55).translate(0, 0.58, -0.02), dome);
      k.cyl(0.05, 0.05, 0.06, 8, 0, 0.77, -0.02, trim); k.ball(0.03, 0, 0.86, -0.02, GOLD);
      k.box(0.88, 0.56, 0.22, 0, 0.06, fz, wall);
      for (let i = 0; i < 5; i++) archway(k, 0, -0.32 + i * 0.16, fz + 0.11, 0.09, 0.19, '#ffd486', 0.06, 'win');
      k.box(0.9, 0.03, 0.24, 0, 0.27, fz, trim);
      for (const x of [-0.4, -0.24, -0.08, 0.08, 0.24, 0.4]) column(k, x, 0.3, fz + 0.125, 0.28, 0.016, trim);
      for (let i = 0; i < 5; i++) pane(k, 0, -0.32 + i * 0.16, 0.44, fz + 0.11, 0.06, 0.14);
      k.box(0.92, 0.035, 0.26, 0, 0.6, fz, trim);
      k.box(0.86, 0.06, 0.2, 0, 0.635, fz, wall);
      for (const sx of [-1, 1]) {
        k.add(domeG(0.07, 10, 4).translate(sx * 0.38, 0.695, fz), dome); k.ball(0.014, sx * 0.38, 0.775, fz, GOLD, null, 0);
        k.cone(0.035, 0.11, 6, sx * 0.2, 0.695, fz + 0.06, GOLD); k.ball(0.02, sx * 0.2, 0.82, fz + 0.06, GOLD);
        k.cyl(0.01, 0.012, 0.3, 5, sx * 0.42, 0, 0.47, DARK); k.ball(0.022, sx * 0.42, 0.32, 0.47, '#fff1c8', 'glow', 0);
        for (const dx of [-0.035, 0.035]) k.ball(0.014, sx * 0.42 + dx, 0.28, 0.47, '#fff1c8', 'glow', 0);
      }
      k.add(new THREE.TorusGeometry(0.045, 0.009, 4, 10, Math.PI).translate(0, 0.72, fz + 0.06), GOLD);
      k.box(0.05, 0.07, 0.012, 0, 0.695, fz + 0.06, GOLD);
      k.box(0.76, 0.03, 0.06, 0, 0, fz + 0.14, STONE[0]);
      return;
    }
    // Moderne: weiße Schalen auf einem Sockel, die offenen Seiten verglast
    k.plinth(1.0, 0.82, '#d9c9b0');
    k.box(1.0, 0.1, 0.82, 0, 0.06, 0, '#d9c9b0');
    for (let i = 0; i < 3; i++) k.box(0.5 - i * 0.06, 0.05, 0.06, 0, i * 0.05, 0.44 - i * 0.03, '#e4d8c4');
    const shells = [[-0.16, 0.2, 0.3], [-0.16, -0.02, 0.26], [-0.16, -0.22, 0.2], [0.24, 0.12, 0.22], [0.24, -0.08, 0.17]];
    for (const [x, z, s] of shells) {
      k.add(new THREE.SphereGeometry(s, 10, 5, 0, Math.PI, 0, Math.PI / 2).scale(0.75, 1.6, 0.9).rotateY(Math.PI).rotateX(-0.25).translate(x, 0.16, z), '#f7f5ee');
      k.add(semi(s * 0.94, 0.01, 8).scale(0.75, 1.6, 1).rotateX(-0.25).translate(x, 0.16, z - 0.006), '#cfe2ea', 'win');
    }
    for (const sx of [-1, 1]) { k.cyl(0.008, 0.008, 0.26, 4, sx * 0.44, 0.16, 0.36, '#5d6670'); k.box(0.04, 0.012, 0.04, sx * 0.44, 0.42, 0.36, '#fff1c8', 'glow'); }
  },

  // Museum: klassizistisch mit Säulenreihe, Giebel, flacher Kuppel und Ausstellungsbannern; Moderne als Spiralbau
  museum(k, L, v) {
    if (L <= 6) {
      const wall = L === 5 ? '#f2ead8' : '#ece6da', domeC = L === 5 ? SLATE[0][0] : COPPER[1];
      k.plinth(1.0, 0.62);
      k.box(1.0, 0.46, 0.62, 0, 0.06, 0, wall);
      k.box(1.04, 0.04, 0.66, 0, 0.52, 0, '#f7f1e6');
      k.box(0.7, 0.02, 0.2, 0, 0.56, -0.12, '#cfe6ec', 'win');
      steps(k, 0.66, 0.16, 3, 0, STONE[0], 0, 0.38);
      for (let i = 0; i < 8; i++) column(k, -0.28 + i * 0.08, 0.09, 0.38, 0.43, 0.018);
      k.box(0.66, 0.05, 0.14, 0, 0.52, 0.36, MARBLE);
      prism(k, 0.14, 0.68, 0.14, 0.57, MARBLE, 0, 0.36, Math.PI / 2);
      k.cyl(0.16, 0.16, 0.1, 16, 0, 0.56, -0.05, wall);
      k.add(domeG(0.17, 14, 5, 0.7).translate(0, 0.66, -0.05), domeC);
      k.ball(0.02, 0, 0.8, -0.05, GOLD, null, 0);
      const BAN = [['#c8553d', '#2f6f73', '#e9c46a'], ['#5a3d7a', '#e07a5f', '#5fa8a0'], ['#2f4b8a', '#e9c46a', '#c8553d']][v];
      for (let i = 0; i < 3; i++) k.box(0.05, 0.22, 0.006, -0.16 + i * 0.16, 0.2, 0.315, BAN[i]);
      for (const sx of [-1, 1]) for (const x of [0.38, 0.46]) pane(k, 0, sx * x, 0.28, 0.31, 0.05, 0.14, { arch: true });
      for (const x of [-0.36, -0.12, 0.12, 0.36]) pane(k, 2, x, 0.28, -0.31, 0.05, 0.14);
      for (const sx of [-1, 1]) { k.box(0.06, 0.1, 0.06, sx * 0.42, 0, 0.43, STONE[0]); k.cone(0.03, 0.1, 6, sx * 0.42, 0.1, 0.43, '#7f8f7a'); k.ball(0.02, sx * 0.42, 0.21, 0.43, '#7f8f7a'); }
      // Seit 19.10.2026: Bänke vor der Treppe, Gaslaternen
      for (const sx of [-1, 1]) { bench(k, sx * 0.24, 0.45, Math.PI); k.lantern(sx * 0.36, 0.47, 0.32); }
      return;
    }
    // Moderne: gestapelte weiße Ringe mit Glasbändern, Seitenflügel, rote Skulptur auf dem Platz
    k.box(0.96, 0.02, 0.96, 0, 0, 0, '#e4dfd6');
    for (let i = 0; i < 4; i++) {
      const r = 0.24 + i * 0.045, y = 0.02 + i * 0.16;
      k.cyl(r, r - 0.02, 0.12, 20, 0.06, y, -0.06, '#f7f5ee');
      k.cyl(r - 0.03, r - 0.03, 0.04, 20, 0.06, y + 0.12, -0.06, GLASS, 'win');
    }
    k.add(domeG(0.12, 12, 4, 0.6).translate(0.06, 0.66, -0.06), '#cfe6ec');
    k.box(0.3, 0.3, 0.46, -0.32, 0.02, -0.12, '#f2efe8');
    k.box(0.31, 0.08, 0.47, -0.32, 0.16, -0.12, GLASS, 'win');
    k.add(new THREE.TorusGeometry(0.07, 0.02, 6, 14).translate(0.3, 0.12, 0.36), '#d0443a');
    k.box(0.04, 0.05, 0.04, 0.3, 0.02, 0.36, '#3e4348');
    for (const x of [-0.36, -0.2]) tree(k, x, 0.36, 0.6, '#86bd5a', 0.02);
    // Seit 19.10.2026: gläserner Eingang mit Vordach, Bannermasten, Bank, Infotafel, Pfosten im Glasband des Flügels, Attika,
    // Oberlichter, Fahrräder
    k.box(0.12, 0.1, 0.02, 0.06, 0.02, 0.177, GLASS, 'win'); for (const x of [0, 0.06, 0.12]) k.box(0.01, 0.1, 0.024, x, 0.02, 0.18, ANTH);
    k.box(0.18, 0.012, 0.08, 0.06, 0.125, 0.215, CAPC); k.box(0.03, 0.005, 0.03, 0.06, 0.12, 0.215, '#fff1c8', 'glow');
    const BAN = [['#c8553d', '#2f6f73', '#e9c46a'], ['#5a3d7a', '#e07a5f', '#5fa8a0'], ['#2f4b8a', '#e9c46a', '#c8553d']][v];
    for (let i = 0; i < 3; i++) { const x = -0.06 + i * 0.12; k.cyl(0.005, 0.005, 0.32, 4, x, 0.02, 0.34, ANTH); k.box(0.05, 0.14, 0.004, x + 0.028, 0.18, 0.34, BAN[i]); }
    bench(k, 0.06, 0.45, Math.PI, WOOD2, 0.02);
    k.box(0.006, 0.08, 0.006, -0.1, 0.02, 0.24, ANTH); k.box(0.07, 0.05, 0.008, -0.1, 0.08, 0.24, '#2f4b66'); k.box(0.05, 0.008, 0.01, -0.1, 0.11, 0.241, '#f4f1e8');
    for (const x of [-0.44, -0.36, -0.28, -0.2]) k.box(0.01, 0.08, 0.012, x, 0.16, 0.117, '#e4e6e8');
    for (const z of [-0.3, -0.18, -0.06, 0.06]) k.box(0.012, 0.08, 0.01, -0.477, 0.16, z, '#e4e6e8');
    attika(k, 0.3, 0.46, 0.32, '#f2efe8', { x: -0.32, z: -0.12, h: 0.025 });
    skylight(k, -0.32, 0.32, -0.22); skylight(k, -0.32, 0.32, -0.02);
    bikeRack(k, -0.42, 0.18, 2); bike(k, -0.42, 0.192, 0, BIKES[(v + 1) % BIKES.length]);
  },

  // Stadtpark: Rasen, Kieswege, Brunnen, Bänke, Bäume, Laternen. Barockgarten, Stadtpark mit Pavillon, moderner Park
  park(k, L, v) {
    const Y = 0.04;
    k.box(0.98, 0.26, 0.98, 0, -0.22, 0, LAWN);
    k.box(0.98, 0.006, 0.12, 0, Y, 0, GRAVEL); k.box(0.12, 0.008, 0.98, 0, Y, 0, GRAVEL);
    k.cyl(0.2, 0.2, 0.01, 16, 0, Y, 0, GRAVEL);
    k.cyl(0.13, 0.14, 0.05, 14, 0, Y, 0, STONE[0]); k.cyl(0.115, 0.115, 0.012, 14, 0, Y + 0.042, 0, '#7cc4cf');
    k.cyl(0.02, 0.03, 0.12, 8, 0, Y + 0.05, 0, STONE[2]); k.cone(0.02, 0.08, 6, 0, Y + 0.17, 0, '#bfe6ee');
    const Q = [[-0.27, -0.27], [0.27, -0.27], [-0.27, 0.27], [0.27, 0.27]];
    const P = [[0, 1, 2, 3], [1, 3, 0, 2], [3, 2, 1, 0]][v].map(i => Q[i]);
    const lamp = (x, z) => { if (L >= 7) { k.cyl(0.008, 0.008, 0.3, 4, x, Y, z, '#5d6670'); k.box(0.05, 0.012, 0.05, x, Y + 0.3, z, '#fff1c8', 'glow'); } else k.lantern(x, z, 0.34); };
    if (L <= 5) {
      // Barockgarten: Heckenrahmen, Blumenbeete, Formschnitt
      P.forEach(([x, z], i) => {
        for (const sz of [-1, 1]) k.box(0.3, 0.05, 0.03, x, Y, z + sz * 0.14, HEDGE);
        for (const sx of [-1, 1]) k.box(0.03, 0.05, 0.3, x + sx * 0.14, Y, z, HEDGE);
        if (i < 2) {
          k.box(0.2, 0.02, 0.2, x, Y, z, '#7d5c3e');
          for (let j = 0; j < 4; j++) k.ball(0.028, x + (j % 2 ? 0.05 : -0.05), Y + 0.04, z + (j < 2 ? 0.05 : -0.05), FLOWERS[(j + i + v) % FLOWERS.length], null, 0);
          k.cone(0.04, 0.18, 7, x, Y, z, '#4f7f42');
        } else tree(k, x, z, 1.0, i === 2 ? '#e9a7b8' : '#7fae5a', Y);
      });
      bench(k, 0.13, 0.32, -Math.PI / 2); bench(k, -0.13, -0.32, Math.PI / 2);
      lamp(0.1, 0.13); lamp(-0.16, -0.13);
      return;
    }
    if (L === 6) {
      // Musikpavillon, Teich mit Enten, alte Bäume, Gaslaternen
      const [px, pz] = P[0];
      k.cyl(0.14, 0.15, 0.05, 8, px, Y, pz, STONE[0]);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; k.cyl(0.008, 0.008, 0.2, 4, px + Math.cos(a) * 0.12, Y + 0.05, pz + Math.sin(a) * 0.12, '#f4f1ea'); }
      k.cone(0.17, 0.12, 8, px, Y + 0.25, pz, ['#c8553d', COPPER[0], '#2f6f73'][v]); k.ball(0.016, px, Y + 0.38, pz, GOLD, null, 0);
      const [wx, wz] = P[1];
      k.add(new THREE.CylinderGeometry(0.15, 0.15, 0.012, 14).scale(1.2, 1, 0.9).translate(wx, Y + 0.004, wz), '#7cc4cf');
      for (const [dx, dz] of [[-0.05, 0.02], [0.06, -0.03]]) { k.ball(0.018, wx + dx, Y + 0.02, wz + dz, '#f4f1ea', null, 0); k.ball(0.01, wx + dx + 0.015, Y + 0.035, wz + dz, '#f4f1ea', null, 0); }
      for (let i = 0; i < 4; i++) k.cyl(0.004, 0.004, 0.08, 3, wx + 0.15 + (i % 2) * 0.02, Y, wz - 0.06 + i * 0.04, '#6f9e52');
      tree(k, P[2][0], P[2][1], 1.2, '#7fae5a', Y); tree(k, P[2][0] + 0.1, P[2][1] + 0.08, 0.7, '#93b866', Y);
      tree(k, P[3][0], P[3][1], 1.1, '#e9a7b8', Y);
      bench(k, 0.13, 0.32, -Math.PI / 2); bench(k, -0.13, 0.3, Math.PI / 2); bench(k, 0.32, -0.13, 0);
      lamp(0.1, 0.13); lamp(-0.1, -0.15);
      return;
    }
    // Moderner Park: Spielplatz, Teich mit Trittsteinen, Bäume, schlanke Leuchten
    const [sx, sz] = P[0];
    k.box(0.3, 0.012, 0.3, sx, Y, sz, '#e8d3a0');
    k.box(0.08, 0.12, 0.08, sx - 0.06, Y, sz - 0.06, '#e9c46a');
    k.add(new THREE.BoxGeometry(0.05, 0.012, 0.2).rotateX(0.55).translate(sx - 0.06, Y + 0.07, sz + 0.06), '#c8553d');
    for (const dx of [0.02, 0.12]) { k.add(new THREE.BoxGeometry(0.012, 0.18, 0.012).rotateX(0.25).translate(sx + 0.08, Y + 0.09, sz + dx - 0.02 - 0.02), '#5fa8a0'); k.add(new THREE.BoxGeometry(0.012, 0.18, 0.012).rotateX(-0.25).translate(sx + 0.08, Y + 0.09, sz + dx + 0.02), '#5fa8a0'); }
    k.box(0.012, 0.012, 0.16, sx + 0.08, Y + 0.18, sz + 0.05, '#5fa8a0');
    for (const dz of [0.02, 0.1]) { k.box(0.003, 0.11, 0.003, sx + 0.08, Y + 0.07, sz + dz, DARK); k.box(0.03, 0.008, 0.02, sx + 0.08, Y + 0.065, sz + dz, '#e07a5f'); }
    const [wx, wz] = P[1];
    k.add(new THREE.CylinderGeometry(0.15, 0.15, 0.012, 14).scale(1.2, 1, 0.9).translate(wx, Y + 0.004, wz), '#7cc4cf');
    for (let i = 0; i < 4; i++) k.cyl(0.02, 0.022, 0.016, 7, wx - 0.12 + i * 0.08, Y + 0.004, wz + (i % 2) * 0.03 - 0.015, STONE[i % 3]);
    tree(k, P[2][0], P[2][1], 1.0, '#86bd5a', Y); tree(k, P[2][0] + 0.12, P[2][1] - 0.06, 0.7, '#e8c27f', Y);
    tree(k, P[3][0], P[3][1], 1.1, '#6aa64f', Y);
    bench(k, 0.13, 0.32, -Math.PI / 2); bench(k, -0.13, -0.3, Math.PI / 2);
    lamp(0.1, 0.13); lamp(-0.1, -0.15); lamp(0.12, -0.36);
  },

  // Bahnhof: Empfangsgebäude mit Uhrturm, Gleis mit Bahnsteig und Hallenbögen, Dampflok oder moderner Zug
  bahnhof(k, L, v) {
    const modern = L >= 7, tz = -0.24, ty = 0.05, sz0 = 0.2;
    k.box(1.5, 0.03, 0.34, 0, 0, tz, '#a39e98');
    for (let i = 0; i < 14; i++) k.box(0.03, 0.012, 0.28, -0.7 + i * 0.108, 0.03, tz, modern ? '#8e8a84' : '#6b5040');
    for (const dz of [-0.07, 0.07]) k.box(1.5, 0.014, 0.012, 0, 0.042, tz + dz, '#5d6066');
    k.box(1.0, 0.06, 0.12, 0, 0, 0.0, STONE[1]);
    if (!modern) {
      // Bögen aus Eisen mit Glasbändern über dem Gleis
      for (const x of [-0.42, -0.21, 0, 0.21]) k.add(new THREE.TorusGeometry(0.25, 0.01, 3, 10, Math.PI).rotateY(Math.PI / 2).translate(x, 0.06, -0.14), '#4a5560');
      for (const [a0, a1] of [[0.35, 0.75], [Math.PI - 1.1, 0.75]]) k.add(new THREE.CylinderGeometry(0.25, 0.25, 0.66, 4, 1, true, a0, a1).rotateZ(Math.PI / 2).translate(-0.105, 0.06, -0.14), '#cfe6ec', 'win');
      // Dampflok mit Wagen
      const x0 = 0.4;
      k.add(new THREE.CylinderGeometry(0.05, 0.05, 0.24, 10).rotateZ(Math.PI / 2).translate(x0, ty + 0.09, tz), '#2f3a40');
      k.box(0.36, 0.03, 0.12, x0 - 0.04, ty + 0.03, tz, '#1f2a30');
      k.box(0.1, 0.13, 0.12, x0 - 0.16, ty + 0.04, tz, '#2f3a40'); k.box(0.12, 0.015, 0.14, x0 - 0.16, ty + 0.17, tz, '#1f2a30');
      k.box(0.06, 0.04, 0.122, x0 - 0.16, ty + 0.11, tz, '#ffd486', 'win');
      k.cyl(0.018, 0.026, 0.07, 8, x0 + 0.08, ty + 0.13, tz, '#1f2a30'); k.smoke.push([x0 + 0.08, ty + 0.25, tz]);
      k.ball(0.022, x0, ty + 0.145, tz, GOLD, null, 0);
      k.box(0.02, 0.025, 0.025, x0 + 0.13, ty + 0.1, tz, '#fff1c8', 'glow');
      k.add(new THREE.ConeGeometry(0.05, 0.06, 4).rotateZ(-Math.PI / 2).rotateX(Math.PI / 4).scale(1, 0.7, 1).translate(x0 + 0.16, ty + 0.03, tz), '#b8413a');
      for (const wx of [x0 - 0.16, x0 - 0.06, x0 + 0.04]) for (const s of [-1, 1]) k.add(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 8).rotateX(Math.PI / 2).translate(wx, ty + 0.035, tz + s * 0.066), '#b8413a');
      const cx = x0 - 0.46, cc = ['#2f6f73', '#7a2e2a', '#2f4b66'][v];
      k.box(0.3, 0.12, 0.12, cx, ty + 0.04, tz, cc);
      k.box(0.26, 0.04, 0.122, cx, ty + 0.1, tz, '#ffd486', 'win');
      k.add(vaultG(0.065, 0.31, 6).scale(1, 0.4, 1).translate(cx, ty + 0.16, tz), '#3e4348');
      for (const wx of [cx - 0.1, cx + 0.1]) for (const s of [-1, 1]) k.add(new THREE.CylinderGeometry(0.025, 0.025, 0.012, 8).rotateX(Math.PI / 2).translate(wx, ty + 0.025, tz + s * 0.062), '#1f2a30');
      // Empfangsgebäude aus Backstein mit Uhrturm
      const brick = BRICK[(v * 2 + 1) % BRICK.length];
      k.plinth(0.84, 0.26, '#9a958c', 0, sz0); k.walls(0.84, 0.4, 0.26, 0.06, brick, null, 0, sz0);
      for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) k.box(0.03, 0.4, 0.03, sx * 0.42, 0.06, sz0 + sz2 * 0.13, '#e8dcc6');
      k.roof(0.84, 0.26, 0.16, 0.46, SLATE[v % 2], { rows: 4, gable: brick, z: sz0 });
      for (const x of [-0.32, -0.2, 0.2, 0.32]) { pane(k, 0, x, 0.25, sz0 + 0.13, 0.06, 0.14, { arch: true, frame: '#e8dcc6' }); pane(k, 2, x, 0.25, sz0 - 0.13, 0.06, 0.14, { frame: '#e8dcc6' }); }
      k.box(0.2, 0.86, 0.2, 0, 0.06, sz0 + 0.02, brick);
      for (const cx2 of [-1, 1]) for (const cz of [-1, 1]) k.box(0.03, 0.86, 0.03, cx2 * 0.1, 0.06, sz0 + 0.02 + cz * 0.1, '#e8dcc6');
      archway(k, 0, 0, sz0 + 0.12, 0.12, 0.24, '#3b302a', 0.06);
      clock(k, 0, 0.74, sz0 + 0.124, 0.06);
      k.box(0.24, 0.03, 0.24, 0, 0.92, sz0 + 0.02, '#e8dcc6');
      k.add(new THREE.ConeGeometry(0.17, 0.24, 4).rotateY(Math.PI / 4).translate(0, 1.07, sz0 + 0.02), SLATE[0][1]);
      k.ball(0.018, 0, 1.2, sz0 + 0.02, GOLD, null, 0);
      k.lantern(-0.46, 0.38, 0.34);
      // Seit 19.10.2026: Bänke und Gaslaternen am Bahnsteig, Gepäckkarren, Wasserkran für die Dampflok, Stationsschild
      for (const x of [-0.3, 0.26]) bench(k, x, 0.02, Math.PI, WOOD2, 0.06);
      for (const x of [-0.44, 0.18]) k.lantern(x, 0.04, 0.34);
      k.box(0.1, 0.012, 0.06, -0.16, 0.1, 0.0, WOOD2); for (const s2 of [-1, 1]) k.add(new THREE.CylinderGeometry(0.018, 0.018, 0.008, 8).rotateX(Math.PI / 2).translate(-0.16 + s2 * 0.035, 0.078, 0.034), DARK);
      k.box(0.05, 0.035, 0.03, -0.18, 0.112, 0.0, '#7a4a32'); k.box(0.04, 0.03, 0.03, -0.135, 0.112, -0.004, '#4e5a3e');
      k.cyl(0.016, 0.02, 0.3, 7, 0.62, 0, -0.04, '#2f3a40'); k.box(0.014, 0.014, 0.16, 0.62, 0.28, -0.11, '#2f3a40'); k.cyl(0.008, 0.008, 0.07, 5, 0.62, 0.21, -0.18, '#3e4348');
      k.box(0.006, 0.12, 0.006, -0.08, 0.06, 0.04, DARK); k.box(0.006, 0.12, 0.006, 0.08, 0.06, 0.04, DARK);
      k.box(0.18, 0.045, 0.01, 0, 0.16, 0.04, '#2f4b66'); k.box(0.13, 0.012, 0.012, 0, 0.176, 0.041, '#f4f1e8');
      return;
    }
    // Moderne: Glashalle mit geschwungenem weißem Dach, schlanker Uhrturm, Bahnsteigdach, weißer Zug
    k.box(0.64, 0.16, 0.12, 0.14, ty + 0.03, tz, '#f4f2ee');
    k.box(0.64, 0.02, 0.122, 0.14, ty + 0.06, tz, '#c8553d');
    k.box(0.6, 0.045, 0.124, 0.14, ty + 0.11, tz, '#5d7a8a', 'win');
    k.add(new THREE.ConeGeometry(0.06, 0.18, 10).rotateZ(-Math.PI / 2).scale(1, 1.35, 1).translate(0.55, ty + 0.11, tz), '#f4f2ee');
    k.add(new THREE.ConeGeometry(0.06, 0.18, 10).rotateZ(Math.PI / 2).scale(1, 1.35, 1).translate(-0.27, ty + 0.11, tz), '#f4f2ee');
    for (const wx of [-0.1, 0.38]) k.box(0.1, 0.03, 0.1, wx, ty, tz, '#3e4348');
    k.box(1.0, 0.02, 0.24, 0, 0.36, -0.14, '#f4f2ee');
    for (const x of [-0.45, -0.15, 0.15, 0.45]) k.box(0.02, 0.3, 0.02, x, 0.06, -0.04, '#c9ccd0');
    k.plinth(0.86, 0.28, '#d6d0c6', 0, sz0);
    k.box(0.86, 0.3, 0.28, 0, 0.06, sz0, GLASS, 'win');
    for (let i = 0; i <= 6; i++) k.box(0.012, 0.3, 0.29, -0.42 + i * 0.14, 0.06, sz0, '#e4dfd6');
    k.add(vaultG(0.22, 0.94, 12).scale(1, 0.42, 1).translate(0, 0.36, sz0), '#f4f2ee');
    k.box(0.05, 1.0, 0.05, -0.44, 0.0, 0.4, '#5d6670');
    k.box(0.12, 0.12, 0.12, -0.44, 0.94, 0.4, '#fff6dc', 'win'); k.box(0.13, 0.02, 0.13, -0.44, 1.06, 0.4, '#5d6670');
    // Seit 19.10.2026: Fahrleitung über dem Gleis, Sicherheitslinie, Bänke, Stationsschild, Anzeigetafel, Eingang mit Vordach,
    // Fahrkartenautomat, Uhr am Turm, Poller, Fahrräder
    for (const x of [-0.62, -0.2, 0.22, 0.64]) { k.box(0.018, 0.33, 0.018, x, 0.03, -0.405, '#8e969c'); k.box(0.012, 0.012, 0.19, x, 0.3, -0.32, '#8e969c'); }
    k.box(1.44, 0.004, 0.004, 0, 0.283, -0.24, '#3e4348');
    k.box(1.0, 0.004, 0.012, 0, 0.06, -0.052, '#e9c46a');
    for (const x of [-0.3, 0.3]) bench(k, x, 0.03, Math.PI, '#5fa8a0', 0.06);
    for (const x of [-0.07, 0.07]) k.box(0.006, 0.13, 0.006, x, 0.06, 0.04, '#5d6670');
    k.box(0.17, 0.04, 0.01, 0, 0.17, 0.04, '#2f4b80'); k.box(0.12, 0.012, 0.012, 0, 0.184, 0.041, '#f4f1e8');
    k.box(0.006, 0.05, 0.006, 0.3, 0.31, -0.03, '#5d6670'); k.box(0.12, 0.04, 0.014, 0.3, 0.27, -0.03, '#2f3a40'); k.box(0.1, 0.008, 0.016, 0.3, 0.29, -0.03, '#ffb24a', 'glow');
    for (const x of [-0.06, 0.06]) k.box(0.012, 0.28, 0.02, x, 0.06, 0.345, ANTH);
    k.box(0.26, 0.015, 0.09, 0, 0.3, 0.385, '#f4f2ee'); k.box(0.04, 0.006, 0.04, 0, 0.295, 0.385, '#fff1c8', 'glow');
    k.box(0.04, 0.09, 0.03, 0.2, 0.0, 0.38, '#c8553d'); k.box(0.026, 0.02, 0.006, 0.2, 0.06, 0.396, '#9fe0ff', 'glow');
    clock(k, -0.44, 0.82, 0.427, 0.035);
    for (const x of [-0.36, -0.28, -0.2]) k.cyl(0.01, 0.012, 0.05, 6, x, 0, 0.45, '#5d6670');
    bikeRack(k, 0.32, 0.36, 2, Math.PI / 2); bike(k, 0.36, 0.38, Math.PI / 2, BIKES[v]); bike(k, 0.43, 0.38, Math.PI / 2, BIKES[v + 2]);
  },

  // Krankenhaus: weißer Pavillonbau mit rotem Kreuz im Giebel; Moderne mit Glasbändern, Landeplatz, Krankenwagen
  krankenhaus(k, L, v) {
    const cross = (x, y, z, s = 1) => { k.box(0.03 * s, 0.1 * s, 0.012, x, y - 0.05 * s, z, '#d8443a'); k.box(0.1 * s, 0.03 * s, 0.012, x, y - 0.015 * s, z, '#d8443a'); };
    if (L <= 6) {
      const wall = '#f4f2ea', hz = -0.06;
      k.plinth(0.92, 0.4, STONE[1], 0, hz);
      k.box(0.92, 0.56, 0.4, 0, 0.06, hz, wall);
      k.box(0.96, 0.03, 0.44, 0, 0.62, hz, '#e4dfd6');
      k.roof(0.92, 0.4, 0.22, 0.65, SLATE[v % 2], { rows: 4, gable: wall, z: hz });
      k.box(0.26, 0.66, 0.08, 0, 0.06, 0.16, wall);
      prism(k, 0.1, 0.3, 0.15, 0.715, SLATE[v % 2][0], 0, 0.15, Math.PI / 2);
      prism(k, 0.08, 0.28, 0.14, 0.72, wall, 0, 0.16, Math.PI / 2);
      k.add(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 14).rotateX(Math.PI / 2).translate(0, 0.79, 0.205), '#ffffff');
      cross(0, 0.835, 0.213, 0.7);
      for (const x of [-0.4, -0.3, -0.2, 0.2, 0.3, 0.4]) for (const y of [0.18, 0.36, 0.53]) pane(k, 0, x, y, hz + 0.2, 0.05, 0.09, { frame: '#e4dfd6' });
      for (const x of [-0.36, -0.18, 0, 0.18, 0.36]) for (const y of [0.25, 0.45]) pane(k, 2, x, y, hz - 0.2, 0.05, 0.09, { frame: '#e4dfd6' });
      for (const y of [0.36, 0.53]) pane(k, 0, 0, y, 0.2, 0.06, 0.1, { arch: y > 0.5, frame: '#e4dfd6' });
      k.box(0.1, 0.18, 0.02, 0, 0.06, 0.205, '#7f9aa8');
      k.box(0.22, 0.02, 0.12, 0, 0.26, 0.26, '#e4dfd6');
      for (const sx of [-1, 1]) { k.cyl(0.008, 0.008, 0.2, 4, sx * 0.1, 0.06, 0.31, '#e4dfd6'); tree(k, sx * 0.38, 0.32, 0.75, sx > 0 ? '#86bd5a' : '#e9a7b8'); }
      // Seit 19.10.2026: Gaslaternen am Eingang, Bänke für die Wartenden
      k.lantern(-0.2, 0.34, 0.3); k.lantern(0.16, 0.34, 0.3);
      for (const sx of [-1, 1]) bench(k, sx * 0.2, 0.43, 0);
      return;
    }
    // Moderne
    k.plinth(0.9, 0.7, '#d6d0c6');
    k.box(0.56, 0.9, 0.5, -0.14, 0.06, -0.08, '#f4f4f2');
    for (let f = 0; f < 5; f++) k.box(0.57, 0.08, 0.51, -0.14, 0.14 + f * 0.17, -0.08, '#9fc4d0', hash(f, v + 2) < 0.75 ? 'win' : 'solid');
    k.box(0.36, 0.3, 0.6, 0.28, 0.06, 0.0, '#eef0f0');
    k.box(0.37, 0.09, 0.61, 0.28, 0.14, 0.0, '#9fc4d0', 'win');
    k.box(0.38, 0.03, 0.62, 0.28, 0.36, 0.0, '#e4dfd6'); k.box(0.3, 0.02, 0.5, 0.28, 0.39, 0.0, '#86b06a');
    k.cyl(0.17, 0.17, 0.02, 16, -0.14, 0.96, -0.08, '#5d6670');
    k.add(new THREE.TorusGeometry(0.15, 0.006, 3, 16).rotateX(Math.PI / 2).translate(-0.14, 0.985, -0.08), '#e9c46a');
    for (const dx of [-0.04, 0.04]) k.box(0.016, 0.006, 0.11, -0.14 + dx, 0.98, -0.08, '#f4f4f2');
    k.box(0.08, 0.006, 0.016, -0.14, 0.98, -0.08, '#f4f4f2');
    k.box(0.16, 0.16, 0.02, -0.14, 0.7, 0.18, '#ffffff'); cross(-0.14, 0.835, 0.193, 1.1);
    k.box(0.3, 0.02, 0.14, 0.28, 0.24, 0.36, '#e4dfd6');
    k.box(0.12, 0.18, 0.02, 0.28, 0.06, 0.302, '#7f9aa8');
    k.box(0.18, 0.08, 0.09, -0.24, 0.02, 0.36, '#f4f4f2'); k.box(0.181, 0.015, 0.091, -0.24, 0.06, 0.36, '#d8443a');
    k.box(0.04, 0.05, 0.088, -0.15, 0.02, 0.36, '#9fc4d0'); k.box(0.03, 0.012, 0.03, -0.26, 0.1, 0.36, '#5fa8ff', 'glow');
    for (const wx of [-0.3, -0.18]) for (const s of [-1, 1]) k.add(new THREE.CylinderGeometry(0.02, 0.02, 0.01, 8).rotateX(Math.PI / 2).translate(wx, 0.02, 0.36 + s * 0.045), '#2f3a40');
    // Seit 19.10.2026: Pfosten in den Fensterbändern, Attika, Schild der Notaufnahme, Schiebetür, Technik auf dem Flügel, Kübel, Poller
    for (let i = 0; i < 7; i++) { const x = -0.38 + i * 0.08; k.box(0.01, 0.74, 0.012, x, 0.12, 0.178, '#e4e6e8'); k.box(0.01, 0.74, 0.012, x, 0.12, -0.338, '#e4e6e8'); }
    for (let i = 0; i < 5; i++) { const z = -0.26 + i * 0.09; k.box(0.012, 0.74, 0.01, -0.428, 0.12, z, '#e4e6e8'); k.box(0.012, 0.42, 0.01, 0.148, 0.44, z, '#e4e6e8'); }
    for (const x of [0.14, 0.2, 0.36, 0.42]) k.box(0.01, 0.09, 0.012, x, 0.14, 0.306, '#e4e6e8');
    for (const z of [-0.2, -0.07, 0.07, 0.2]) k.box(0.012, 0.09, 0.01, 0.466, 0.14, z, '#e4e6e8');
    attika(k, 0.56, 0.5, 0.96, '#f4f4f2', { x: -0.14, z: -0.08, h: 0.03 });
    k.box(0.18, 0.04, 0.012, 0.28, 0.26, 0.424, '#d8443a'); k.box(0.12, 0.012, 0.014, 0.28, 0.274, 0.426, '#ffffff');
    k.box(0.012, 0.18, 0.024, 0.28, 0.06, 0.304, ANTH); for (const s of [-1, 1]) k.box(0.012, 0.18, 0.024, 0.28 + s * 0.06, 0.06, 0.304, ANTH); k.box(0.13, 0.012, 0.024, 0.28, 0.234, 0.304, ANTH);
    acUnit(k, 0.38, 0.41, -0.2); acUnit(k, 0.2, 0.41, -0.2, Math.PI); vent(k, 0.36, 0.41, 0.18);
    planter(k, 0.1, 0.38, 0.85); planter(k, 0.46, 0.38, 0.85);
    for (const x of [0.16, 0.4]) k.cyl(0.01, 0.012, 0.05, 6, x, 0, 0.47, '#5d6670');
  },

  // Wohnturm: 6, 8 oder 10 Geschosse, Fenster teils hell, Balkone, Dachgarten. Vor der Moderne ein Mietshaus aus Backstein
  hochhaus(k, L, v) {
    if (L <= 6) {
      const brick = BRICK[(v * 2 + 3) % BRICK.length], fl = 5, fh = 0.2, H = fl * fh;
      k.plinth(0.6, 0.56, '#9a958c');
      k.box(0.6, H, 0.56, 0, 0.06, 0, brick);
      k.box(0.64, 0.04, 0.6, 0, 0.06 + H, 0, '#e8dcc6');
      for (let f = 0; f < fl; f++) {
        const y = 0.06 + f * fh + 0.1;
        for (const x of [-0.2, 0, 0.2]) { if (f === 0 && x === 0) continue; pane(k, 0, x, y, 0.28, 0.07, 0.1, { lit: hash(f * 5 + Math.round(x * 10), v) < 0.65, frame: '#e8dcc6' }); }
        for (const x of [-0.15, 0.15]) pane(k, 2, x, y, -0.28, 0.07, 0.1, { lit: hash(f * 7 + Math.round(x * 10), v + 3) < 0.5, frame: '#e8dcc6' });
        pane(k, 1, 0.3, y, 0, 0.07, 0.1, { lit: f % 2 === 0, frame: '#e8dcc6' }); pane(k, 3, -0.3, y, 0, 0.07, 0.1, { lit: f % 2 === 1, frame: '#e8dcc6' });
        if (k.fine()) for (const x of [-0.2, 0, 0.2]) if (f || x) k.box(0.095, 0.01, 0.03, x, y - 0.066, 0.295, '#e8dcc6');
        if (k.fine()) for (const x of [-0.15, 0.15]) k.box(0.095, 0.01, 0.03, x, y - 0.066, -0.295, '#e8dcc6');
        if (f > 0) { k.box(0.16, 0.012, 0.07, 0.2, 0.06 + f * fh, 0.315, DARK); k.box(0.16, 0.045, 0.006, 0.2, 0.06 + f * fh, 0.348, DARK); }
      }
      for (let f = 1; f < fl - 1; f++) k.add(new THREE.BoxGeometry(0.012, 0.25, 0.04).rotateZ(f % 2 ? 0.65 : -0.65).translate(0.2, 0.06 + f * fh + 0.1, 0.33), DARK);
      k.box(0.1, 0.2, 0.02, 0, 0.06, 0.282, '#3e5a6a');
      awning(k, -0.18, 0.24, 0.282, 0.2, AWN[v % AWN.length]);
      const top = 0.1 + H;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.015, 0.14, 0.015, 0.12 + sx * 0.07, top, -0.1 + sz * 0.07, DARK);
      k.cyl(0.1, 0.1, 0.14, 10, 0.12, top + 0.14, -0.1, '#8a6a4c'); k.cone(0.11, 0.08, 10, 0.12, top + 0.28, -0.1, '#5d5550');
      // Seit 19.10.2026: Konsolen unter dem Gesims, zwei Schornsteinköpfe mit Töpfen
      if (k.fine()) for (let i = 0; i < 5; i++) k.box(0.02, 0.03, 0.03, -0.24 + i * 0.12, 0.03 + H, 0.29, '#e8dcc6');
      for (const z of [-0.18, 0.18]) { k.box(0.08, 0.12, 0.06, -0.2, top, z, brick); k.box(0.09, 0.016, 0.07, -0.2, top + 0.12, z, '#e8dcc6'); for (const dx of [-0.02, 0.02]) k.cyl(0.012, 0.015, 0.04, 6, -0.2 + dx, top + 0.136, z, '#b8694a'); }
      return;
    }
    const fl = [6, 8, 10][v], fh = 0.19, H = fl * fh, W = 0.6, D = 0.56;
    const tone = ['#f4f1ea', '#e9b49a', '#dfe7ea'][v], acc = ['#c9a27a', '#7fae64', '#5fa8a0'][v];
    k.plinth(W, D, '#d6d0c6');
    k.box(W - 0.04, fh, D - 0.04, 0, 0.06, 0, GLASS, 'win');
    k.box(0.22, 0.02, 0.12, 0, 0.06 + fh * 0.8, D / 2 + 0.05, tone);
    k.box(W - 0.01, H - fh, D - 0.01, 0, 0.06 + fh, 0, tone);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.04, H - fh, 0.04, sx * (W / 2 - 0.01), 0.06 + fh, sz * (D / 2 - 0.01), acc);
    for (let f = 1; f < fl; f++) {
      const y = 0.06 + f * fh;
      k.box(W + 0.01, 0.03, D + 0.01, 0, y, 0, tone);
      for (let face = 0; face < 4; face++) for (const half of face % 2 ? [0] : [-1, 1]) {
        const lit = hash(f * 7 + face * 3 + (half > 0 ? 1 : 0), v + 11) < 0.62;
        const span = face % 2 ? D - 0.16 : W / 2 - 0.05;
        const X = face % 2 === 0 ? half * span / 2 * 1.08 : (face === 1 ? W / 2 : -W / 2);
        const Z = face % 2 === 0 ? (face === 0 ? D / 2 : -D / 2) : 0;
        const [x, d] = toFace(face, X, Z);
        fgeo(k, face, new THREE.BoxGeometry(span - 0.02, fh - 0.07, 0.02), x, y + 0.03 + (fh - 0.07) / 2, d, lit ? '#a9cbd9' : '#6f8797', lit ? 'win' : 'solid');
      }
      // Seit 19.10.2026: Pfosten in den Fensterbändern
      if (k.fine()) for (let face = 0; face < 4; face++) for (const lx of face % 2 ? [-0.1, 0.1] : [-0.135, 0.135]) fgeo(k, face, new THREE.BoxGeometry(0.01, fh - 0.07, 0.026), lx, y + 0.03 + (fh - 0.07) / 2, face % 2 ? W / 2 : D / 2, tone);
      if (v === 1 || f % 2 === 0) {
        k.box(W - 0.06, 0.02, 0.1, 0, y, D / 2 + 0.05, tone);
        k.box(W - 0.06, 0.06, 0.008, 0, y + 0.02, D / 2 + 0.1, v === 2 ? '#cfe0e6' : acc);
        if (k.fine()) k.box(W - 0.05, 0.01, 0.014, 0, y + 0.08, D / 2 + 0.1, ANTH); if (k.fine()) for (const x of [-(W - 0.07) / 2, 0, (W - 0.07) / 2]) k.box(0.012, 0.06, 0.012, x, y + 0.02, D / 2 + 0.1, ANTH);
        if (v === 1) for (const x of [-0.2, 0.05, 0.22]) k.ball(0.035, x, y + 0.07, D / 2 + 0.06, ['#6aa64f', '#86bd5a', '#7fae5a'][f % 3], null, 0);
      }
    }
    const top = 0.06 + H;
    k.box(W + 0.02, 0.04, D + 0.02, 0, top, 0, tone);
    k.box(W - 0.1, 0.03, D - 0.1, 0, top + 0.04, 0, '#86b06a');
    tree(k, -0.14, -0.1, 0.65, '#6aa64f', top + 0.07); tree(k, 0.12, 0.12, 0.5, '#86bd5a', top + 0.07);
    for (const [x, z] of [[-0.18, 0.12], [-0.02, 0.12], [-0.18, 0.2], [-0.02, 0.2]]) k.box(0.012, 0.14, 0.012, x, top + 0.07, z, '#a8845e');
    for (let i = 0; i < 4; i++) k.box(0.18, 0.01, 0.015, -0.1, top + 0.21, 0.12 + i * 0.027, '#a8845e');
    k.box(0.14, 0.1, 0.14, 0.16, top + 0.04, -0.15, '#d6d0c6');
    if (v === 2) { k.cyl(0.006, 0.008, 0.32, 4, 0.16, top + 0.14, -0.15, '#c9ccd0'); k.ball(0.016, 0.16, top + 0.47, -0.15, '#ff5a4a', 'glow', 0); }
    // Seit 19.10.2026: Attika, Technik, Eingang mit Rahmen und Briefkästen, Fahrräder, Tonnen
    attika(k, W + 0.02, D + 0.02, top + 0.04, tone, { h: 0.035 });
    if (v !== 2) solar(k, 0.16, top + 0.14, -0.15, 1, 1);
    acUnit(k, 0.2, top + 0.07, -0.02); vent(k, -0.05, top + 0.07, -0.22);
    if (k.fine()) {
      for (const x of [-0.07, 0, 0.07]) k.box(0.012, fh - 0.04, 0.02, x, 0.06, D / 2 - 0.01, ANTH);
      k.box(0.15, 0.012, 0.02, 0, 0.06 + fh - 0.05, D / 2 - 0.01, ANTH);
      k.box(0.07, 0.07, 0.02, 0.2, 0.08, D / 2 - 0.01, '#5d6670');
    }
    bikeRack(k, -0.24, 0.36, 2); bike(k, -0.24, 0.372, 0, BIKES[v]);
    bins(k, 0.14, 0.38, 4);
  },

  // Stadion: ovale Schüssel mit Rängen in Vereinsfarben, grünes Feld mit Linien, Dachring, Flutlichter
  stadion(k, L, v) {
    const sz = 0.8, R = 0.6, seat = [['#5f8fc8', '#e9eef2'], ['#c8553d', '#f4f1ea'], ['#2f6f73', '#e9c46a']][v];
    const E = g => g.scale(1, 1, sz);
    k.box(0.66, 0.02, 0.42, 0, 0, 0, '#5fa04e');
    for (let i = 0; i < 6; i++) k.box(0.11, 0.004, 0.42, -0.275 + i * 0.11, 0.02, 0, i % 2 ? '#68ab55' : '#5a9a49');
    for (const sz2 of [-1, 1]) k.box(0.62, 0.006, 0.008, 0, 0.022, sz2 * 0.19, '#ffffff');
    for (const sx of [-1, 1]) { k.box(0.008, 0.006, 0.38, sx * 0.31, 0.022, 0, '#ffffff'); k.box(0.012, 0.045, 0.08, sx * 0.315, 0.02, 0, '#ffffff'); }
    k.box(0.008, 0.006, 0.38, 0, 0.022, 0, '#ffffff');
    k.add(new THREE.TorusGeometry(0.06, 0.004, 3, 16).rotateX(Math.PI / 2).translate(0, 0.024, 0), '#ffffff');
    const tiers = (r0, r1, y0, y1, n, col) => {
      const pts = [];
      for (let i = n; i >= 0; i--) { const r = r0 + (r1 - r0) * i / n, y = y0 + (y1 - y0) * i / n; pts.push(new THREE.Vector2(r, y)); if (i > 0) pts.push(new THREE.Vector2(r, y - (y1 - y0) / n)); }
      k.add(E(new THREE.LatheGeometry(pts, 26)), col);
    };
    tiers(0.4, 0.5, 0.06, 0.2, 3, seat[0]);
    tiers(0.5, 0.59, 0.2, 0.38, 3, seat[1]);
    k.add(E(new THREE.CylinderGeometry(0.4, 0.4, 0.06, 26, 1, true)).translate(0, 0.03, 0), '#e4dfd6');
    k.add(E(new THREE.CylinderGeometry(R, R, 0.4, 30, 1, true)).translate(0, 0.2, 0), L >= 7 ? '#f2efe8' : BRICK[v % BRICK.length]);
    for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); k.box(0.025, 0.4, 0.025, c * (R + 0.01), 0, s * (R + 0.01) * sz, L >= 7 ? seat[0] : '#e8dcc6'); }
    if (L >= 7) k.add(E(new THREE.CylinderGeometry(0.48, R + 0.04, 0.07, 30, 1, true)).translate(0, 0.46, 0), '#f7f5ee');
    for (const a of [0.7, 2.44, 3.84, 5.58]) {
      const x = Math.cos(a) * 0.6, z = Math.sin(a) * 0.6 * sz;
      k.cyl(0.012, 0.018, 0.9, 5, x, 0, z, '#c9ccd0');
      k.add(new THREE.BoxGeometry(0.14, 0.08, 0.02).rotateX(0.5).rotateY(Math.atan2(-x, -z)).translate(x, 0.92, z), '#fff6dc', 'glow');
    }
    k.box(0.24, 0.12, 0.02, 0, 0.42, -R * sz + 0.02, '#2f3a40'); k.box(0.2, 0.08, 0.022, 0, 0.44, -R * sz + 0.02, '#8fe0a0', 'win');
    k.box(0.2, 0.2, 0.06, 0, 0, R * sz + 0.01, L >= 7 ? '#f2efe8' : '#e8dcc6'); k.box(0.12, 0.14, 0.012, 0, 0, R * sz + 0.045, '#3b302a');
    for (const sx of [-1, 1]) flag(k, sx * 0.14, R * sz + 0.04, 0.32, seat[0], 0, 0.1);
    // Seit 19.10.2026: Werbebanden ums Feld, Eckfahnen, Fahnen auf dem Rand, Rahmen hinter den Flutlichtern
    const ads = ['#e07a5f', '#f4f1ea', '#2f4b80', '#e9c46a'];
    for (const s2 of [-1, 1]) for (let i = 0; i < 4; i++) k.box(0.15, 0.022, 0.006, -0.24 + i * 0.16, 0.02, s2 * 0.222, ads[(i + (s2 > 0 ? 1 : 0) + v) % 4]);
    for (const sx of [-1, 1]) k.box(0.006, 0.022, 0.3, sx * 0.342, 0.02, 0, ads[(v + 2) % 4]);
    for (const sx of [-1, 1]) for (const s2 of [-1, 1]) { k.box(0.003, 0.035, 0.003, sx * 0.31, 0.022, s2 * 0.19, '#f4f1ea'); k.box(0.012, 0.009, 0.002, sx * 0.31 + 0.006, 0.048, s2 * 0.19, '#e9c46a'); }
    for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2, x = Math.cos(a) * (R + 0.012), z = Math.sin(a) * (R + 0.012) * sz; k.box(0.006, 0.15, 0.006, x, 0.4, z, ANTH); k.box(0.05, 0.03, 0.004, x + 0.025, 0.51, z, seat[i % 2]); }
    for (const a of [0.7, 2.44, 3.84, 5.58]) { const x = Math.cos(a) * 0.6, z = Math.sin(a) * 0.6 * sz; k.add(new THREE.BoxGeometry(0.16, 0.1, 0.014).rotateX(0.5).rotateY(Math.atan2(-x, -z)).translate(x * 1.03, 0.92, z * 1.03), '#3e4348'); }
  },

  // Forschungslabor: Backsteinhalle mit Teslaspule (vor der Moderne), sonst weißer Bau mit Glas, Kuppel, Schüssel, Solardach
  labor(k, L, v) {
    const dish = (x, y, z, r, tilt, ry) => {
      k.add(new THREE.CylinderGeometry(r, r * 0.3, r * 0.3, 14).rotateX(-tilt).rotateY(ry).translate(x, y, z), '#f4f4f2');
      k.add(new THREE.CylinderGeometry(0.005, 0.005, r * 1.1, 4).translate(0, r * 0.55, 0).rotateX(-tilt).rotateY(ry).translate(x, y, z), '#c9ccd0');
      k.add(new THREE.IcosahedronGeometry(0.016, 0).translate(0, r * 1.1, 0).rotateX(-tilt).rotateY(ry).translate(x, y, z), '#c9ccd0');
    };
    if (L <= 6) {
      const brick = BRICK[(v + 5) % BRICK.length];
      k.plinth(0.7, 0.46, '#9a958c', 0, -0.06); k.walls(0.7, 0.4, 0.46, 0.06, brick, '#e8dcc6', 0, -0.06);
      k.roof(0.7, 0.46, 0.18, 0.46, SLATE[1], { rows: 4, gable: brick, z: -0.06 });
      k.box(0.4, 0.06, 0.1, 0, 0.62, -0.06, '#cfe6ec', 'win');
      for (const x of [-0.22, 0, 0.22]) pane(k, 0, x, 0.26, 0.17, 0.08, 0.16, { arch: true, frame: '#e8dcc6' });
      for (const x of [-0.2, 0.2]) pane(k, 2, x, 0.26, -0.29, 0.08, 0.14, { frame: '#e8dcc6' });
      k.cyl(0.05, 0.06, 0.05, 8, 0.32, 0, 0.32, '#5d6670');
      k.cyl(0.02, 0.025, 0.3, 8, 0.32, 0.05, 0.32, '#b87333');
      k.add(new THREE.TorusGeometry(0.05, 0.018, 6, 14).rotateX(Math.PI / 2).translate(0.32, 0.38, 0.32), '#c9ccd0');
      k.ball(0.022, 0.32, 0.41, 0.32, '#bfe6ff', 'glow', 0);
      dish(-0.26, 0.6, -0.12, 0.07, 0.7, 0.5);
      return;
    }
    k.plinth(0.8, 0.5, '#d6d0c6', 0, -0.06);
    k.box(0.8, 0.32, 0.5, 0, 0.06, -0.06, '#f4f4f2');
    k.box(0.81, 0.1, 0.51, 0, 0.11, -0.06, GLASS, 'win');
    k.box(0.81, 0.05, 0.51, 0, 0.27, -0.06, GLASS, 'win');
    k.box(0.84, 0.03, 0.54, 0, 0.38, -0.06, '#e4dfd6');
    k.box(0.26, 0.3, 0.26, -0.22, 0.41, -0.12, '#f4f4f2');
    k.box(0.27, 0.06, 0.27, -0.22, 0.56, -0.12, GLASS, 'win');
    k.add(domeG(0.12, 12, 5).translate(-0.22, 0.71, -0.12), '#e9eef2');
    k.add(new THREE.BoxGeometry(0.04, 0.1, 0.02).rotateX(-0.6).translate(-0.22, 0.79, -0.04), '#3e4348');
    for (const x of [0.06, 0.2, 0.34]) k.add(new THREE.BoxGeometry(0.12, 0.01, 0.16).rotateX(-0.35).translate(x, 0.45, -0.1), '#2f4b66');
    dish(0.3, 0.26, 0.3, 0.13, 0.75, -0.6);
    k.cyl(0.03, 0.04, 0.2, 8, 0.3, 0, 0.3, '#c9ccd0');
    k.cyl(0.005, 0.008, 0.3, 4, -0.22, 0.83, -0.12, '#c9ccd0'); k.ball(0.016, -0.22, 1.14, -0.12, '#ff5a4a', 'glow', 0);
    k.box(0.16, 0.24, 0.02, -0.18, 0.06, 0.192, GLASS, 'win'); k.box(0.2, 0.02, 0.1, -0.18, 0.3, 0.24, '#e4dfd6');
  },
};
Object.assign(BUILDERS, NEW);

function scaffold() {
  const k = new Kit(3);
  for (const [x, z] of [[-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32], [0.32, 0.32]]) k.cyl(0.015, 0.015, 0.7, 4, x, 0, z, '#9a7450');
  for (const y of [0.25, 0.5]) { k.box(0.68, 0.02, 0.04, 0, y, 0.32, '#9a7450'); k.box(0.68, 0.02, 0.04, 0, y, -0.32, '#9a7450'); }
  k.box(0.18, 0.1, 0.18, 0.4, 0, 0.4, '#c9a46a');
  return k.build();
}

// Wahrzeichen dürfen größer sein als ein Feld
const DETAIL_NEAR = 36, DETAIL_FAR = 42;
const SCALE = { burg: 1.3, rakete: 1.3, kathedrale: 1.12, palast: 1.1, stadion: 1.15, arena: 1.1 };

// Lichtkegel des Leuchtturms (seit 19.10.2026): leicht nach oben geneigt, wird zur Spitze hin schwächer und blendet
// über Land und nahe am Boden aus (Höhenfeld HTEX), so streicht er nur übers Meer statt als heller Keil übers Ufer
let BEAM_GEO = null, BEAM_MAT = null;
function beamMat() {
  if (BEAM_MAT) return BEAM_MAT;
  BEAM_MAT = new THREE.ShaderMaterial({
    uniforms: { uHeight: { value: HTEX }, opacity: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: `uniform sampler2D uHeight; varying float vAlong; varying float vLand; varying vec3 vN; varying vec3 vV;
      float hAt(vec2 xz) { vec2 g = (xz + vec2(${(NX / 2).toFixed(1)}, ${(NY / 2).toFixed(1)})) * ${RES.toFixed(1)}; return texture2D(uHeight, (floor(g) + 0.5) / vec2(${NVX.toFixed(1)}, ${NVY.toFixed(1)})).r; }
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vAlong = clamp(position.x / 6.0, 0.0, 1.0);
        float h = hAt(w.xz); vLand = max(smoothstep(0.06, 0.3, h), 1.0 - smoothstep(0.08, 0.45, w.y - max(h, 0.0)));
        vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float opacity; varying float vAlong; varying float vLand; varying vec3 vN; varying vec3 vV;
      void main() { float edge = pow(abs(dot(normalize(vN), normalize(vV))), 0.8);
        float a = opacity * pow(1.0 - vAlong, 1.4) * (1.0 - vLand) * edge;
        gl_FragColor = vec4(vec3(1.0, 0.94, 0.72) * a, a); }`,
  });
  return BEAM_MAT;
}

// Material, das seine Eckpunkte auf die Bodenhöhe legt (Höhenfeld HTEX, bilinear von Hand, weil Gleitkomma-Texturen
// nicht überall linear gefiltert werden). Verschoben wird um den Unterschied zur Bodenhöhe am Ursprung des Objekts.
function drape(m0) {
  const m = m0.clone();
  const base = m0.onBeforeCompile;
  m.onBeforeCompile = sh => {
    if (base) base(sh);
    sh.uniforms.uHeight = { value: HTEX };
    sh.vertexShader = `uniform sampler2D uHeight;
      float drapeH(vec2 xz) {
        vec2 g = (xz + vec2(${(NX / 2).toFixed(1)}, ${(NY / 2).toFixed(1)})) * ${RES.toFixed(1)}; vec2 i = floor(g), f = g - i;
        float a = texture2D(uHeight, (i + vec2(0.5, 0.5)) / vec2(${NVX.toFixed(1)}, ${NVY.toFixed(1)})).r, b = texture2D(uHeight, (i + vec2(1.5, 0.5)) / vec2(${NVX.toFixed(1)}, ${NVY.toFixed(1)})).r;
        float c = texture2D(uHeight, (i + vec2(0.5, 1.5)) / vec2(${NVX.toFixed(1)}, ${NVY.toFixed(1)})).r, d = texture2D(uHeight, (i + vec2(1.5, 1.5)) / vec2(${NVX.toFixed(1)}, ${NVY.toFixed(1)})).r;
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }\n` + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec4 wq = modelMatrix * vec4(transformed, 1.0); vec3 o = modelMatrix[3].xyz;
          transformed.y += (drapeH(wq.xz) - drapeH(o.xz)) / max(0.001, length(modelMatrix[1].xyz)); }`);
  };
  const key = m0.customProgramCacheKey ? m0.customProgramCacheKey() : '';
  m.customProgramCacheKey = () => 'drape|' + key;
  return m;
}

export class Buildings {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.mats = [
      // glatt schattiert seit 24.10.2026 (PLAN_GRAFIK.md): Kuppeln, Kegel, Kugeln und Fasen werden rund wie Ton statt facettiert
      patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), { grain: 9, snow: 1.1 }),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, emissive: new THREE.Color('#ffc46a'), emissiveIntensity: 0.1 }),
      new THREE.MeshStandardMaterial({ vertexColors: true, emissive: new THREE.Color('#ff9a4a'), emissiveIntensity: 1.4 }),
    ];
    // Felder (seit 19.10.2026): jeder Eckpunkt folgt der Bodenhöhe an seiner Stelle, so liegen Beete und Zäune auch
    // am Hang und neben eingeebneten Straßen richtig (vorher flach auf der Höhe der Feldmitte, schwebend oder versunken)
    this.fieldMats = this.mats.map(drape);
    // Dunkle Fenster für Häuser, in denen gerade niemand wach ist (people.homeStats über this.occ)
    // Fensterlicht nach Fensterfarbe (seit 19.10.2026): warme Scheiben leuchten, große blaue Glasflächen moderner
    // Häuser nur schwach (vorher glühten ganze Glasfassaden und überstrahlten nachts die Stadt)
    // Glas (seit 24.10.2026, PLAN_GRAFIK.md): bei Tag dunkel mit Spiegelung von Himmel und Umgebung (Rauheit 0,12),
    // nachts die warme Fensterfarbe. uNightW geht mit der Nacht von 0 nach 1 (update)
    this.mats[1].roughness = 0.12;
    const NW = this.nightW = { value: 0 };
    const winGlow = m => { m.onBeforeCompile = sh => { sh.uniforms.uNightW = NW; sh.fragmentShader = 'uniform float uNightW;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb * 0.26 + vec3(0.02, 0.03, 0.045), diffuseColor.rgb, uNightW);').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= clamp(vColor.r * 1.25 - vColor.b * 0.65, 0.12, 1.0);'); }; m.customProgramCacheKey = () => 'winglow2'; return m; };
    winGlow(this.mats[1]);
    const dark = winGlow(this.mats[1].clone()); dark.emissiveIntensity = 0.02;
    this.matsDark = [this.mats[0], dark, this.mats[2]];
    this.occ = null; this.lastOcc = -1;
    this.cache = new Map();
    this.meshes = new Map();
    this.scaffoldGeo = scaffold();
    this.scaffoldMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true });
    this.rotors = []; this.beams = []; this.smokers = [];
    // Warme Lichtflecken vor beleuchteten Häusern und Laternen (nachts), alles in einem Zeichenaufruf
    this.poolMax = 1600;
    this.pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: { uNight: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: `varying vec2 vUv; varying vec3 vCol;
        void main(){ vUv = uv;
          #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
          #else
          vCol = vec3(1.0);
          #endif
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uNight; varying vec2 vUv; varying vec3 vCol;
        void main(){ float d = length(vUv - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - d), 2.4);
          gl_FragColor = vec4(vCol * a * uNight, 1.0); }`,
    }), this.poolMax);
    this.pools.frustumCulled = false; this.pools.count = 0; this.pools.renderOrder = 1;
    // Messpunkt ohne Fläche, der jedes Bild mit gezeichnet wird: so kennt die Zwischenstufe die Lage der Kamera,
    // ohne dass main.js sie übergeben muss (Schattenkameras sind orthografisch und zählen nicht)
    this.camPos = null;
    const probe = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3)), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false }));
    probe.frustumCulled = false;
    probe.onBeforeRender = (r, sc, cam) => { if (cam.isPerspectiveCamera) (this.camPos || (this.camPos = new THREE.Vector3())).copy(cam.position); };
    scene.add(probe);
    this.pools.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.pools);
  }

  // Lichtflecken neu setzen: je fertigem Gebäude mit Fenstern oder Laternen einer, vor der Tür
  placePools() {
    const o = this._po || (this._po = new THREE.Object3D()), c = this._pc || (this._pc = new THREE.Color());
    let n = 0;
    for (const m of this.meshes.values()) {
      const b = m.userData.b, g = m.userData.g;
      if (!b || b.prog < 1 || n >= this.poolMax || !g.lit) continue;
      const k = 0.55 + hash(b.id, 13) * 0.45;
      const r = (0.95 + Math.min(1.3, (g.h || 0.5) * 0.55)) * (m.userData.baseScale || 1);
      const ry = m.rotation.y, fwd = 0.28;
      o.position.set(m.position.x + Math.sin(ry) * fwd, m.position.y + 0.07, m.position.z + Math.cos(ry) * fwd);
      o.scale.set(r * 2, 1, r * 2); o.rotation.set(0, 0, 0); o.updateMatrix();
      this.pools.setMatrixAt(n, o.matrix);
      this.pools.setColorAt(n, c.setRGB(1.0 * k * 0.55, 0.62 * k * 0.55, 0.28 * k * 0.55));
      (this.poolIds || (this.poolIds = []))[n] = b.id;
      n++;
    }
    this.pools.count = n;
    this.pools.instanceMatrix.needsUpdate = true;
    if (this.pools.instanceColor) this.pools.instanceColor.needsUpdate = true;
  }

  geo(key, seed, fn) {
    let g = this.cache.get(key);
    if (!g) { const k = new Kit(seed); fn(k); g = { geo: k.build(), smoke: k.smoke, rotor: k.rotor, beam: k.beam, h: k.height, lit: k.win.length + k.glow.length > 0, fine: !!k.hasFine, seed, fn }; this.cache.set(key, g); }
    return g;
  }

  // Zwischenstufe (seit 19.10.2026): Kleinteile wie Klingeln, Tonnen, Fahrräder, Geländerstäbe, Fugen und Fensterbänke
  // gibt es nur bis rund 40 Abstand zur Kamera (DETAIL_NEAR und DETAIL_FAR, dazwischen bleibt es, wie es ist, gegen Flackern).
  // Weiter weg sind sie kleiner als ein Bildpunkt und kosteten in der Fernansicht 15 Prozent der Bildzeit.
  loGeo(g) {
    if (!g.fine) return g.geo;
    if (!g.lo) { const k = new Kit(g.seed); k.lo = true; g.fn(k); g.lo = k.build(); }
    return g.lo;
  }
  detail(t) {
    const cam = this.camPos;
    if (!cam) return;
    const c0 = this._dc || (this._dc = new THREE.Vector3(1e9, 0, 0));
    if (!this.detailDirty && c0.distanceToSquared(cam) < 0.5 && t - (this._dt || 0) < 1) return;
    const N2 = DETAIL_NEAR * DETAIL_NEAR, F2 = DETAIL_FAR * DETAIL_FAR;
    let built = 0, pending = false;
    for (const m of this.meshes.values()) {
      const u = m.userData, g = u.g;
      if (!g.fine) continue;
      const d2 = m.position.distanceToSquared(cam), want = u.lo ? d2 > N2 : d2 > F2;
      if (want === !!u.lo) continue;
      if (want && !g.lo) { if (built >= 6) { pending = true; continue; } built++; }
      u.lo = want;
      u.mesh.geometry = want ? this.loGeo(g) : g.geo;
    }
    this.detailDirty = pending; c0.copy(cam); this._dt = t;
  }

  // Modell-Sammlung (seit 24.10.2026, ui/collection.js): Bauform einer Art in Epoche L und Variante v ohne Spielstand.
  // opt: w Hausform 0 bis 4, d Detailvariante 0 bis 2, gov und col für die Dorfmitte, season für Felder
  sample(t, L, v = 0, opt = {}) {
    let key, seed, fn;
    if (t === 'zentrum') { const gov = opt.gov || 'rat', c = opt.col || '#d9b968'; key = `z|${L}|${v}|${gov}|${c}`; seed = v + 1; fn = k => { k.L = L; zentrum(k, L, v, gov, c); }; }
    else if (t === 'haus') { const w = opt.w ?? 0, d = opt.d ?? 0; key = `h|${L}|${v}|${w}|${d}`; seed = 1 + d * 13 + w; fn = k => { k.L = L; k.houseDetail = true; k.d = d; house(k, L, v, w); if (L >= 2 && L <= 5 && w % 2 === 0) garden(k, L, v); }; }
    else if (t === 'feld') { const season = opt.season ?? 1; key = `f|${v}|${season}|15`; seed = 2 + v; fn = k => feld(k, v, season, 15); }
    else { const B = BUILDERS[t] || (k => hut(k, L, v)); key = `${t}|${L}|${v}`; seed = v + 3; fn = k => { k.L = L; B(k, L, v); }; }
    return { g: this.geo(key, seed, fn), scale: SCALE[t] || 1 };
  }

  keyFor(st, b, s, season) {
    let L = b.prog < 1 && b.old != null ? b.old : b.lvl;
    // Was mehr als zwei Epochen hinter dem Ort zurückliegt, wird im Bild mit modernisiert (keine Lehmhütten neben Fabriken)
    if (s && b.t !== 'feld' && b.t !== 'rakete') L = Math.max(L, Math.min(7, (s.era | 0) - 2));
    const v = Math.floor(hash(b.id, 7) * 3);
    if (b.t === 'zentrum') return [`z|${L}|${v}|${s ? s.gov.type : ''}|${s ? s.color : ''}`, v + 1, k => { k.L = L; zentrum(k, L, v, s ? s.gov.type : '', s ? s.color : '#ccc'); }];
    if (b.t === 'haus') { const w = b.id % 5, d = Math.floor(hash(b.id, 19) * 3); return [`h|${L}|${v}|${w}|${d}`, 1 + d * 13 + w, k => { k.L = L; k.houseDetail = true; k.d = d; house(k, L, v, w); if (L >= 2 && L <= 5 && w % 2 === 0) garden(k, L, v); }]; }
    if (b.t === 'feld') {
      const rt = st._rt;
      let mask = 0;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy], i) => {
        const x = b.x + dx, y = b.y + dy;
        const o = x >= 0 && y >= 0 && x < NX && y < NY ? rt.bById.get(rt.bldAt[y * NX + x]) : null;
        if (!o || o.t !== 'feld') mask |= 1 << i;
      });
      return [`f|${v}|${season}|${mask}`, 2 + v, k => feld(k, v, season, mask)];
    }
    const fn = BUILDERS[b.t] || ((k) => hut(k, L, v));
    return [`${b.t}|${L}|${v}`, v + 3, k => { k.L = L; fn(k, L, v); }];
  }

  sync(st, season) {
    const rt = st._rt, seen = new Set();
    for (const b of st.buildings) {
      seen.add(b.id);
      const s = rt.sById.get(b.s);
      const [key, seed, fn] = this.keyFor(st, b, s, season);
      let m = this.meshes.get(b.id);
      if (!m || m.userData.key !== key) {
        if (m) this.dispose(m);
        const g = this.geo(key, seed, fn);
        m = new THREE.Group();
        const mesh = new THREE.Mesh(g.geo, b.t === 'feld' ? this.fieldMats : this.mats);
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.userData = { kind: 'building', id: b.id };
        m.add(mesh);
        m.userData = { key, mesh, g, id: b.id };
        if (g.fine) this.detailDirty = true;
        if (g.rotor) {
          const r = new THREE.Mesh(g.rotor.geo, this.mats);
          r.position.set(...g.rotor.pos); r.castShadow = true;
          m.add(r); m.userData.rotor = r;
        }
        if (g.beam) {
          const beam = new THREE.Mesh(BEAM_GEO || (BEAM_GEO = new THREE.ConeGeometry(0.42, 6, 16, 1, true).rotateZ(Math.PI / 2).translate(3, 0, 0).rotateZ(0.04)), beamMat());
          beam.position.set(...g.beam.pos);
          m.add(beam); m.userData.beam = beam;
        }
        const X = b.x - NX / 2 + 0.5, Z = b.y - NY / 2 + 0.5;
        m.position.set(X, groundY(X, Z) + (b.t === 'feld' ? 0.02 : 0), Z);
        m.rotation.y = this.facing(st, b);
        if (SCALE[b.t]) m.scale.setScalar(SCALE[b.t]);
        m.userData.baseScale = m.scale.x;
        this.group.add(m);
        this.meshes.set(b.id, m);
      }
      const building = b.prog < 1;
      // Gerade fertig geworden: kurz aufspringen, etwas Staub
      if (!building && m.userData.wasBuilding && b.old == null) { m.userData.popT = this.time || 0; if (this.onDone) this.onDone(m.position.x, m.position.y, m.position.z, m.userData.g.h || 0.5); }
      m.userData.wasBuilding = building;
      m.userData.mesh.scale.y = building ? (b.old != null ? 1 : 0.18 + b.prog * 0.82) : 1;
      if (building && !m.userData.scaffold) { const sf = new THREE.Mesh(this.scaffoldGeo, this.scaffoldMat); sf.castShadow = true; m.add(sf); m.userData.scaffold = sf; }
      if (!building && m.userData.scaffold) { m.remove(m.userData.scaffold); m.userData.scaffold = null; }
      if (m.userData.scaffold) m.userData.scaffold.scale.y = Math.max(0.6, (m.userData.g.h || 0.5) * 1.3);
      m.userData.mesh.rotation.z = b.hp < 0.6 ? (0.6 - b.hp) * 0.25 : 0;
      m.userData.b = b;
    }
    // Zerstörung (seit 19.10.2026): liegt an der Stelle eines verschwundenen Gebäudes eine Ruine (Beben, Meteor, Sturm,
    // Krieg, Feuer), stürzt es sichtbar ein statt zu verschwinden, danach bleibt ein Trümmerhaufen bis zum Neubau
    const TR = st.tiles.ruin;
    for (const [id, m] of this.meshes) if (!seen.has(id)) {
      const b = m.userData.b;
      if (b && b.t !== 'feld' && TR && TR[b.y * NX + b.x] > 0 && !this.replay && m.visible) { this.collapse(m); this.addRuin(b, m); }
      else this.dispose(m);
      this.meshes.delete(id);
    }
    this.syncRubble(st);
    this.farDirty = true;
    this.rotors = []; this.beams = []; this.smokers = [];
    for (const m of this.meshes.values()) {
      if (m.userData.rotor) this.rotors.push(m.userData.rotor);
      if (m.userData.beam) this.beams.push(m.userData.beam);
      if (m.userData.g.smoke.length && m.userData.b && m.userData.b.prog >= 1) this.smokers.push(m);
    }
    this.placePools();
  }

  // Häuser schauen zum Dorfplatz, Häfen zum Wasser
  facing(st, b, raw = false) {
    const T = st.tiles;
    if (b.rot != null) return b.rot; // im Baukasten von Hand gedreht
    if (b.t === 'hafen' || b.t === 'fischer' || b.t === 'werft') {
      const dirs = [[0, 1, 0], [1, 0, Math.PI / 2], [0, -1, Math.PI], [-1, 0, -Math.PI / 2]];
      for (const [dx, dy, r] of dirs) { const x = b.x + dx, y = b.y + dy; if (x >= 0 && y >= 0 && x < NX && y < NY && T.h[y * NX + x] < 0) return r; }
    }
    if (b.t === 'zentrum' || b.t === 'feld') return 0;
    // Seit dem Straßennetz (render/streets.js): die Tür zeigt zur Straße, an der das Haus liegt
    if (!raw && this.doorSides && this.doorSides.has(b.id) && b.t !== 'muehle' && b.t !== 'leuchtturm') return this.doorSides.get(b.id) + (hash(b.id, 5) - 0.5) * 0.12;
    const s = st._rt.sById.get(b.s);
    // Seit 18.10.2026: die Tür schaut zur Straße des Straßenplans, wenn eine angrenzt (die zum Platz hin zuerst)
    if (s && b.t !== 'muehle' && b.t !== 'leuchtturm') {
      const plan = streetPlan(st, s);
      let best = null, bd = 1e9;
      for (const [dx, dy, r] of [[0, 1, 0], [1, 0, Math.PI / 2], [0, -1, Math.PI], [-1, 0, -Math.PI / 2]]) {
        const x = b.x + dx, y = b.y + dy;
        if (!plan.has(y * NX + x) || st._rt.bldAt[y * NX + x]) continue;
        const d = Math.hypot(x - s.cx, y - s.cy);
        if (d < bd) { bd = d; best = r; }
      }
      if (best !== null) return best + (hash(b.id, 5) - 0.5) * 0.12;
    }
    if (s && (b.t === 'haus' || b.t === 'schrein' || b.t === 'schule' || b.t === 'heiler')) {
      const a = Math.atan2(s.cx - b.x, s.cy - b.y);
      return Math.round(a / (Math.PI / 2)) * (Math.PI / 2) + (hash(b.id, 5) - 0.5) * 0.25;
    }
    return Math.floor(hash(b.id, 3) * 4) * Math.PI / 2 + (hash(b.id, 9) - 0.5) * 0.2;
  }

  dispose(m) { this.group.remove(m); }

  // Weit weg (seit der großen Welt 18.10.2026): statt hunderter einzelner Häuser zwei Instanzen, Körper und Dach,
  // in den Farben der echten Häuser. Ab rund 210 Abstand sieht man den Unterschied nicht, das Bild bleibt flüssig.
  lod(st, dist) {
    const far = dist > 210;
    if (far && (this.farDirty || !this.farBody)) this.buildFar(st);
    if (far === this.isFar) return;
    this.isFar = far;
    this.group.visible = !far;
    if (this.farBody) { this.farBody.visible = far; this.farRoof.visible = far; }
  }

  buildFar(st) {
    this.farDirty = false;
    const n = this.meshes.size + 8;
    if (!this.farBody || this.farBody.instanceMatrix.count < n) {
      if (this.farBody) { this.scene.remove(this.farBody, this.farRoof); this.farBody.dispose(); this.farRoof.dispose(); }
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
      this.farBody = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mat, Math.ceil(n * 1.3));
      this.farRoof = new THREE.InstancedMesh(new THREE.ConeGeometry(0.72, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0), mat, Math.ceil(n * 1.3));
      for (const m of [this.farBody, this.farRoof]) { m.visible = !!this.isFar; m.frustumCulled = false; m.receiveShadow = true; this.scene.add(m); }
    }
    const o = new THREE.Object3D(), c = new THREE.Color();
    let nb = 0, nr = 0;
    for (const m of this.meshes.values()) {
      const b = m.userData.b; if (!b) continue;
      const h = Math.max(0.12, m.userData.g.h || 0.5), sc = m.userData.baseScale || 1;
      const s = st._rt.sById.get(b.s), era = s ? s.era | 0 : 0;
      if (b.t === 'feld') {
        o.position.copy(m.position); o.rotation.set(0, 0, 0); o.scale.set(0.96, 0.03, 0.96); o.updateMatrix();
        this.farBody.setMatrixAt(nb, o.matrix); this.farBody.setColorAt(nb++, c.set(['#c9b56a', '#a8b862', '#d0b878'][b.id % 3])); continue;
      }
      if (b.t === 'zentrum') {
        o.position.copy(m.position); o.rotation.set(0, 0, 0); o.scale.set(1.6, 0.04, 1.6); o.updateMatrix();
        this.farBody.setMatrixAt(nb, o.matrix); this.farBody.setColorAt(nb++, c.set('#d6ccb8')); continue;
      }
      const w = (b.t === 'haus' ? 0.6 : 0.78) * sc, modern = era >= 6 && b.t !== 'schrein';
      const bodyH = (modern ? h * 0.9 : h * 0.55) * sc;
      o.position.copy(m.position); o.rotation.set(0, m.rotation.y, 0); o.scale.set(w, bodyH, w * 0.85); o.updateMatrix();
      this.farBody.setMatrixAt(nb, o.matrix); this.farBody.setColorAt(nb++, c.set(modern ? ['#d8dde2', '#c9d2da', '#e4e0d8'][b.id % 3] : ['#eadfcd', '#e2d6c2', '#efe6d6'][b.id % 3]));
      if (!modern || b.t === 'haus') {
        o.position.set(m.position.x, m.position.y + bodyH, m.position.z); o.scale.set(w * 0.98, Math.max(0.12, h * 0.4) * sc, w * 0.85); o.updateMatrix();
        this.farRoof.setMatrixAt(nr, o.matrix); { const rc = ROOF_MIX[(b.id * 5) % ROOF_MIX.length]; this.farRoof.setColorAt(nr++, c.set(Array.isArray(rc) ? rc[b.id % rc.length] : rc)); }
      }
    }
    this.farBody.count = nb; this.farRoof.count = nr;
    for (const m of [this.farBody, this.farRoof]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  // Alle Häuser neu aufbauen (das Gelände hat sich geändert, etwa der Krater eines Meteors): was dabei zerstört wurde,
  // stürzt trotzdem sichtbar ein und hinterlässt Trümmer
  dropAll(st) {
    const alive = new Set(st.buildings.map(b => b.id)), TR = st.tiles.ruin;
    for (const [id, m] of this.meshes) {
      const b = m.userData.b;
      if (!alive.has(id) && b && b.t !== 'feld' && TR && TR[b.y * NX + b.x] > 0 && !this.replay && m.visible) { this.collapse(m); this.addRuin(b, m); }
      else this.dispose(m);
    }
    this.meshes.clear();
  }

  // Einsturz: kippen, einsinken, in sich zusammenfallen (1,5 s), dazu Staub und Brocken über onCollapse (main.js)
  collapse(m) {
    const g = m.userData.g, s = m.userData.baseScale || 1, h = (g.h || 0.5) * s, a = Math.random() * Math.PI * 2;
    (this.falling || (this.falling = [])).push({ m, t0: this.time || 0, y0: m.position.y, h, s, ax: Math.cos(a), az: Math.sin(a) });
    if (this.onCollapse) this.onCollapse(m.position.x, m.position.y, m.position.z, h);
  }

  // Trümmer: je Ruinenfeld Steinbrocken und (bis zur Industrie) Balken, so lange die Ruine liegt und nichts Neues steht
  addRuin(b, m) {
    (this.ruins || (this.ruins = new Map())).set(b.y * NX + b.x, { x: b.x, y: b.y, era: b.lvl | 0, w: Math.min(0.42, 0.22 + (m.userData.g.h || 0.5) * 0.12) * (m.userData.baseScale || 1) });
    this.rubbleDirty = true;
  }

  syncRubble(st) {
    const T = st.tiles, rt = st._rt;
    this.ruins = this.ruins || new Map();
    // beim ersten Mal (geladener Spielstand) alle vorhandenen Ruinen einsammeln
    if (!this.ruinScan && T.ruin) {
      this.ruinScan = true;
      for (let i = 0; i < T.ruin.length; i++) if (T.ruin[i] > 0 && !rt.bldAt[i]) this.ruins.set(i, { x: i % NX, y: (i / NX) | 0, era: 1, w: 0.3 });
      this.rubbleDirty = true;
    }
    for (const [i] of this.ruins) if (!T.ruin || T.ruin[i] <= 0 || rt.bldAt[i]) { this.ruins.delete(i); this.rubbleDirty = true; }
    if (!this.rubbleDirty) return;
    this.rubbleDirty = false;
    if (!this.rubble) {
      const mk = (geo, max) => { const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.92, flatShading: true }), max); im.castShadow = true; im.receiveShadow = true; im.count = 0; im.frustumCulled = false; this.group.add(im); return im; };
      this.rubble = { stone: mk(new THREE.IcosahedronGeometry(1, 0), 4000), beam: mk(new THREE.BoxGeometry(1, 1, 1), 1200) };
    }
    const o = this._ro || (this._ro = new THREE.Object3D()), c = this._rc || (this._rc = new THREE.Color());
    const hh = (a, b) => { let x = Math.imul(a * 374761393 + b * 668265263, 1274126177); x ^= x >>> 15; return ((x >>> 0) % 10000) / 10000; };
    let ns = 0, nb = 0;
    const SM = this.rubble.stone, BM = this.rubble.beam;
    for (const [i, R] of this.ruins) {
      const X = R.x - NX / 2 + 0.5, Z = R.y - NY / 2 + 0.5;
      for (let k = 0; k < 9 && ns < 4000; k++) {
        const a = hh(i, k) * Math.PI * 2, r = Math.sqrt(hh(k, i)) * R.w, x = X + Math.cos(a) * r, z = Z + Math.sin(a) * r;
        const sc = 0.018 + hh(i + 7, k) * 0.04 * (1.2 - r / (R.w + 0.01) * 0.5);
        o.position.set(x, groundY(x, z) + sc * 0.45, z); o.rotation.set(hh(i, k + 3) * 6, hh(i, k + 5) * 6, 0); o.scale.set(sc * 1.2, sc * 0.8, sc);
        o.updateMatrix(); SM.setMatrixAt(ns, o.matrix);
        const v = 0.55 + hh(i, k + 9) * 0.3;
        SM.setColorAt(ns, c.setRGB(v * 0.98, v * 0.88, v * 0.76)); ns++;
      }
      if (R.era <= 6) for (let k = 0; k < 3 && nb < 1200; k++) {
        const a = hh(i, k + 20) * Math.PI, x = X + (hh(i, k + 21) - 0.5) * R.w, z = Z + (hh(i, k + 22) - 0.5) * R.w, Lb = 0.18 + hh(i, k + 23) * 0.2;
        o.position.set(x, groundY(x, z) + 0.025 + k * 0.012, z); o.rotation.set((hh(i, k + 24) - 0.5) * 0.5, a, (hh(i, k + 25) - 0.5) * 0.4); o.scale.set(Lb, 0.022, 0.026);
        o.updateMatrix(); BM.setMatrixAt(nb, o.matrix);
        BM.setColorAt(nb, c.setRGB(0.36, 0.25, 0.16).multiplyScalar(0.8 + hh(i, k + 26) * 0.4)); nb++;
      }
    }
    SM.count = ns; BM.count = nb;
    for (const M of [SM, BM]) { M.instanceMatrix.needsUpdate = true; if (M.instanceColor) M.instanceColor.needsUpdate = true; }
  }

  update(t, night) {
    this.detail(t);
    this.time = t;
    // Zeitraffer: nur zeigen, was am Tag der Wiedergabe schon stand, Neues springt auf
    const R = this.replay;
    for (const m of this.meshes.values()) {
      const b = m.userData.b;
      if (R && b) {
        const vis = b.d <= R.day;
        if (vis && !m.visible) m.userData.popT = t;
        m.visible = vis;
      } else if (!m.visible) m.visible = true;
      if (m.userData.popT != null) {
        const u = (t - m.userData.popT) / 0.7;
        if (u >= 1) { m.userData.popT = null; m.scale.setScalar(m.userData.baseScale || 1); }
        else { const e = u < 0.6 ? 0.2 + (u / 0.6) * 0.95 : 1.15 - Math.sin((u - 0.6) / 0.4 * Math.PI / 2) * 0.15; m.scale.setScalar((m.userData.baseScale || 1) * e); }
      }
    }
    // Einstürzende Gebäude
    if (this.falling && this.falling.length) for (let k = this.falling.length - 1; k >= 0; k--) {
      const F = this.falling[k], u = (t - F.t0) / 1.5;
      if (u >= 1 || u < 0) { this.dispose(F.m); this.falling.splice(k, 1); continue; }
      const tilt = Math.min(1, u * 1.7) ** 2 * 0.5, sink = Math.max(0, (u - 0.12) / 0.88) ** 1.6;
      F.m.rotation.x = F.ax * tilt; F.m.rotation.z = F.az * tilt;
      F.m.position.y = F.y0 - F.h * 1.05 * sink;
      F.m.scale.set(F.s * (1 + sink * 0.12), F.s * (1 - sink * 0.5), F.s * (1 + sink * 0.12));
      if (this.onCrumble && Math.random() < 0.35) this.onCrumble(F.m.position.x, F.y0 + F.h * (1 - sink) * 0.6, F.m.position.z, F.h);
    }
    this.mats[1].emissiveIntensity = 0.05 + night * 1.55;
    this.nightW.value = Math.min(1, Math.max(0, night * 1.6 - 0.1));
    if (this.occ && t - this.lastOcc > 0.5) { this.lastOcc = t; this.occupancy(); }
    this.pools.material.uniforms.uNight.value = Math.max(0, night - 0.08) * 1.1;
    this.pools.visible = night > 0.1 && !this.replay;
    this.mats[2].emissiveIntensity = 0.8 + night * 1.2;
    for (const r of this.rotors) r.rotation.z = t * 0.9;
    for (const b of this.beams) b.rotation.y = t * 1.2;
    if (BEAM_MAT) BEAM_MAT.uniforms.opacity.value = night * 0.85;
  }

  // Grundriss eines Gebäudes in Weltkoordinaten [x0, x1, z0, z1, Boden, Dach] für den Geistmodus (seit 19.10.2026).
  // Aus der echten Form: nur Teile über 0,1 Höhe (ohne Zäune, Beete, Bodenplatten), gedreht und skaliert wie das Haus.
  foot(m) {
    const u = m.userData, g = u.g, s = u.baseScale || 1, r = m.rotation.y;
    if (u.foot && u.footR === r && u.footS === s) return u.foot;
    if (!g.box) {
      const p = g.geo.attributes.position;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) < 0.1) continue;
        const x = p.getX(i), z = p.getZ(i);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      g.box = x0 === Infinity ? [-0.3, 0.3, -0.3, 0.3] : [x0, x1, z0, z1];
    }
    const c = Math.cos(r), sn = Math.sin(r), B = g.box;
    let X0 = Infinity, X1 = -Infinity, Z0 = Infinity, Z1 = -Infinity;
    for (const [x, z] of [[B[0], B[2]], [B[1], B[2]], [B[0], B[3]], [B[1], B[3]]]) {
      const wx = (x * c + z * sn) * s, wz = (-x * sn + z * c) * s;
      X0 = Math.min(X0, wx); X1 = Math.max(X1, wx); Z0 = Math.min(Z0, wz); Z1 = Math.max(Z1, wz);
    }
    const P = m.position;
    u.foot = [P.x + X0, P.x + X1, P.z + Z0, P.z + Z1, P.y, P.y + Math.max(0.15, g.h || 0.5) * s];
    u.footR = r; u.footS = s;
    return u.foot;
  }

  // Begehbare Oberkante niedriger Teile (Sockel, Terrassen, Stufen) an einem Weltpunkt, sonst -Infinity (seit 24.10.2026).
  // Am Hang ragt der Sockel aus dem Boden: wer davor oder darauf geht, steht jetzt oben auf dem Stein statt darin (vorher
  // schauten nur die Köpfe heraus). Aus der echten Form: nach oben zeigende Flächen bis 0,1 Höhe, als Raster 24 x 24.
  floorAt(m, x, z) {
    const u = m.userData, g = u.g, s = u.baseScale || 1, r = m.rotation.y, N = 24, E = 0.6;
    if (!g.floor) {
      const F = g.floor = new Float32Array(N * N).fill(-1), p = g.geo.attributes.position, ix = g.geo.index;
      const n = ix ? ix.count : p.count, v = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let t = 0; t < n; t += 3) {
        let ok = true;
        for (let j = 0; j < 3; j++) {
          const q = ix ? ix.getX(t + j) : t + j;
          v[j * 3] = p.getX(q); v[j * 3 + 1] = p.getY(q); v[j * 3 + 2] = p.getZ(q);
          if (v[j * 3 + 1] > 0.1 || v[j * 3 + 1] < 0.012) ok = false;
        }
        if (!ok) continue;
        const ax = v[3] - v[0], ay = v[4] - v[1], az = v[5] - v[2], bx = v[6] - v[0], by = v[7] - v[1], bz = v[8] - v[2];
        const ny = az * bx - ax * bz, nl = Math.hypot(ay * bz - az * by, ny, ax * by - ay * bx);
        if (nl < 1e-9 || ny / nl < 0.85) continue;
        const y = Math.max(v[1], v[4], v[7]);
        const c0 = Math.max(0, Math.ceil((Math.min(v[0], v[3], v[6]) + E) / (2 * E) * N - 0.5)), c1 = Math.min(N - 1, Math.floor((Math.max(v[0], v[3], v[6]) + E) / (2 * E) * N - 0.5));
        const r0 = Math.max(0, Math.ceil((Math.min(v[2], v[5], v[8]) + E) / (2 * E) * N - 0.5)), r1 = Math.min(N - 1, Math.floor((Math.max(v[2], v[5], v[8]) + E) / (2 * E) * N - 0.5));
        for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) if (F[rr * N + cc] < y) F[rr * N + cc] = y;
      }
    }
    const P = m.position, dx = x - P.x, dz = z - P.z, c = Math.cos(r), sn = Math.sin(r);
    const lx = (dx * c - dz * sn) / s, lz = (dx * sn + dz * c) / s;
    const cc = Math.floor((lx + E) / (2 * E) * N), rr = Math.floor((lz + E) / (2 * E) * N);
    if (cc < 0 || rr < 0 || cc >= N || rr >= N) return -Infinity;
    const y = g.floor[rr * N + cc];
    return y < 0 ? -Infinity : P.y + y * s * (u.mesh ? u.mesh.scale.y : 1);
  }

  // Geistmodus: Gebäude zwischen Kamera und Geist werden weich durchsichtig (bis 0,18) und danach wieder fest.
  // Jedes bekommt dafür eigene, durchsichtige Kopien der Materialien, solange es ausgeblendet ist.
  seeThrough(ids, dt) {
    const F = this.fading || (this.fading = new Map());
    for (const id of ids) if (!F.has(id) && this.meshes.has(id)) F.set(id, 1);
    for (const [id, a0] of F) {
      const m = this.meshes.get(id);
      if (!m) { F.delete(id); continue; }
      const u = m.userData, want = ids.has(id) ? 0.18 : 1;
      const a = a0 + (want - a0) * Math.min(1, dt * 7);
      if (!u.fade) {
        const base = Array.isArray(u.mesh.material) ? u.mesh.material : [u.mesh.material];
        const mats = base.map(o => {
          const q = o.clone();
          q.onBeforeCompile = o.onBeforeCompile; q.customProgramCacheKey = o.customProgramCacheKey;
          q.transparent = true; q.depthWrite = false;
          return q;
        });
        u.fade = { mats, old: u.mesh.material };
        u.mesh.material = Array.isArray(u.mesh.material) ? mats : mats[0];
        if (u.rotor) u.rotor.material = u.mesh.material;
      }
      if (a > 0.995 && want === 1) {
        u.mesh.material = u.fade.old;
        if (u.rotor) u.rotor.material = this.mats;
        for (const q of u.fade.mats) q.dispose();
        u.fade = null;
        F.delete(id);
        continue;
      }
      for (const q of u.fade.mats) q.opacity = a;
      F.set(id, a);
    }
  }

  // Fensterlicht nach Bewohnern: ein Haus leuchtet nur, wenn jemand darin wach ist (nachts gehen die Lichter
  // nach und nach aus, früh macht als Erste die an, die kocht). Der Lichtfleck vor der Tür folgt.
  occupancy() {
    const occ = this.occ, c = this._pc || (this._pc = new THREE.Color());
    const home = t => t === 'haus' || t === 'hochhaus';
    const litOf = b => { if (!home(b.t)) return true; const v = occ.get(b.id); return !!(v && v.awake > 0); };
    for (const m of this.meshes.values()) {
      const b = m.userData.b;
      if (!b || !home(b.t) || b.prog < 1 || m.userData.fade) continue;
      const want = this.replay || litOf(b) ? this.mats : this.matsDark;
      if (m.userData.mesh.material !== want) m.userData.mesh.material = want;
    }
    const ids = this.poolIds || [];
    for (let i = 0; i < this.pools.count; i++) {
      const b = this.meshes.get(ids[i])?.userData.b;
      if (!b || !home(b.t)) continue;
      const k = (0.55 + hash(b.id, 13) * 0.45) * (litOf(b) ? 0.55 : 0);
      this.pools.setColorAt(i, c.setRGB(k, 0.62 * k, 0.28 * k));
    }
    if (this.pools.instanceColor) this.pools.instanceColor.needsUpdate = true;
  }

  pickables() { return this.group.children.map(g => g.userData.mesh).filter(Boolean); } // nicht jedes Kind ist ein Gebäude (Messpunkt, Trümmer)
}
