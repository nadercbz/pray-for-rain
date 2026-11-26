// Fundorte im Bild (sim/sites.js): Säulen der Alten, Steinkreise, Wracks am Strand, Höhleneingänge, dampfende
// Quellen, uralte Riesenbäume, Drachenknochen, Türme der versunkenen Stadt im Flachwasser, Piratennester mit
// schwarzer Flagge und Lagerfeuer, Schatzfelsen, Gräber alter Schlachtfelder. Unentdeckte Orte funkeln leise (nur der
// Gott sieht sie), entdeckte tragen ihren Namen, wenn die Kamera nah ist. Ein Klick erzählt ihre Geschichte.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NX, NY } from './scene.js';
import { groundY } from './terrain.js';
import { SITES } from '../sim/sites.js';
import { L } from '../i18n.js';

const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const STONE = '#cfc6b4', STONE2 = '#b3aa9a', MOSS = '#8fa66a', WOOD = '#8a6544', WOODD = '#5e4330', DARK = '#2a2624';

class B {
  constructor(seed) { this.g = []; this.glow = []; this.seed = seed; this.n = 0; }
  rnd() { return hash(this.seed * 97 + this.n++, 7); }
  add(geo, c, glow) {
    geo = geo.index ? geo.toNonIndexed() : geo;
    for (const k of ['uv', 'uv1']) if (geo.attributes[k]) geo.deleteAttribute(k);
    const col = new THREE.Color(c), n = geo.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.toArray(a, i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
    (glow ? this.glow : this.g).push(geo);
  }
  box(w, h, d, x, y, z, c, ry = 0, rz = 0) { const g = new THREE.BoxGeometry(w, h, d); if (rz) g.rotateZ(rz); if (ry) g.rotateY(ry); g.translate(x, y + h / 2, z); this.add(g, c); }
  cyl(r1, r2, h, x, y, z, c, seg = 8, rz = 0, ry = 0) { const g = new THREE.CylinderGeometry(r1, r2, h, seg); g.translate(0, h / 2, 0); if (rz) g.rotateZ(rz); if (ry) g.rotateY(ry); g.translate(x, y, z); this.add(g, c); }
  ball(r, x, y, z, c, sx = 1, sy = 1, sz = 1, glow) { this.add(new THREE.SphereGeometry(r, 10, 7).scale(sx, sy, sz).translate(x, y, z), c, glow); }
  cone(r, h, x, y, z, c, seg = 6, glow) { this.add(new THREE.ConeGeometry(r, h, seg).translate(x, y + h / 2, z), c, glow); }
  torus(R, r, arc, x, y, z, c, rx = 0, ry = 0) { const g = new THREE.TorusGeometry(R, r, 5, 12, arc); g.rotateX(rx); g.rotateY(ry); g.translate(x, y, z); this.add(g, c); }
  build() { return { geo: this.g.length ? mergeGeometries(this.g) : null, glow: this.glow.length ? mergeGeometries(this.glow) : null }; }
}

// Bauplan je Art (Kachel = 1, Menschen sind 0,27 hoch)
const MAKE = {
  ruine(k) {
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, h = 0.15 + k.rnd() * 0.45; k.cyl(0.045, 0.05, h, Math.cos(a) * 0.32, 0, Math.sin(a) * 0.28, i % 2 ? STONE : STONE2, 8); if (h > 0.4) k.box(0.13, 0.04, 0.13, Math.cos(a) * 0.32, h, Math.sin(a) * 0.28, STONE); }
    k.box(0.5, 0.05, 0.12, 0, 0.5, -0.28, STONE2, 0.1); k.box(0.12, 0.08, 0.1, 0.2, 0, 0.1, STONE, 0.6, 0.3); k.box(0.16, 0.06, 0.09, -0.1, 0, 0.15, STONE2, 1.2);
    for (let i = 0; i < 5; i++) k.ball(0.06, (k.rnd() - 0.5) * 0.7, 0.02, (k.rnd() - 0.5) * 0.6, MOSS, 1, 0.5, 1);
    k.box(0.36, 0.02, 0.3, 0, 0, 0, '#d8cfbd');
  },
  steinkreis(k) {
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2, h = 0.2 + k.rnd() * 0.12; k.box(0.08, h, 0.05, Math.cos(a) * 0.34, 0, Math.sin(a) * 0.34, i % 2 ? '#a9a39a' : '#bdb6aa', -a + Math.PI / 2, (k.rnd() - 0.5) * 0.15); }
    k.box(0.16, 0.06, 0.1, 0, 0, 0, '#9c968c'); k.ball(0.025, 0, 0.09, 0, '#bfe8ff', 1, 1, 1, true);
  },
  wrack(k) {
    for (let i = 0; i < 6; i++) k.torus(0.13, 0.012, Math.PI, -0.3 + i * 0.12, 0.02, 0, WOODD, 0, Math.PI / 2);
    k.box(0.75, 0.03, 0.05, 0, 0.01, 0, WOOD, 0.2, 0.08); k.cyl(0.018, 0.018, 0.45, 0.1, 0, 0.05, WOODD, 6, 0.9);
    k.box(0.08, 0.06, 0.08, 0.32, 0, 0.18, WOOD, 0.5); k.box(0.07, 0.07, 0.07, 0.25, 0, -0.2, '#a07a52', 0.2);
  },
  hoehle(k) {
    k.ball(0.42, 0, 0, 0, '#9a948a', 1, 0.62, 0.9); k.ball(0.28, 0.25, 0.05, -0.15, '#8a857c', 1, 0.7, 1);
    k.add(new THREE.CircleGeometry(0.13, 12, 0, Math.PI).translate(0, 0.0, 0).rotateY(0).translate(0, 0.01, 0.38), DARK);
    k.box(0.28, 0.14, 0.02, 0, 0, 0.37, DARK);
  },
  quelle(k) {
    k.add(new THREE.CircleGeometry(0.22, 18).rotateX(-Math.PI / 2).translate(0, 0.02, 0), '#7fd0d6');
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; k.ball(0.05, Math.cos(a) * 0.25, 0.02, Math.sin(a) * 0.25, i % 2 ? '#b8b0a4' : '#a39c90', 1, 0.6, 1); }
  },
  riesenbaum(k) {
    k.cyl(0.11, 0.17, 0.75, 0, 0, 0, '#7a5638', 9);
    for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; k.cyl(0.03, 0.06, 0.3, Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12, '#6e4d33', 5, Math.cos(a) * 0.9, -a); }
    for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; k.ball(0.24 + k.rnd() * 0.08, Math.cos(a) * 0.26, 0.85 + k.rnd() * 0.2, Math.sin(a) * 0.26, ['#5f8f4a', '#6f9e52', '#57844a'][i % 3]); }
    k.ball(0.32, 0, 1.05, 0, '#6a9a50');
    for (let i = 0; i < 4; i++) k.box(0.012, 0.16, 0.012, Math.cos(i * 1.6) * 0.3, 0.6, Math.sin(i * 1.6) * 0.3, ['#c8553d', '#e0a640', '#5fa8a0', '#f1e6d0'][i]);
  },
  knochen(k) {
    for (let i = 0; i < 7; i++) k.torus(0.16 - Math.abs(i - 3) * 0.02, 0.014, Math.PI, -0.3 + i * 0.1, 0.0, 0, '#ece4d2', 0, Math.PI / 2);
    k.cyl(0.02, 0.02, 0.75, -0.38, 0.03, 0, '#e2d9c4', 6, Math.PI / 2);
    k.ball(0.09, 0.45, 0.06, 0, '#ece4d2', 1.5, 0.8, 0.9); k.cone(0.02, 0.1, 0.5, 0.1, 0.05, '#e2d9c4');
  },
  versunken(k) {
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; k.cyl(0.05, 0.055, 0.08 + k.rnd() * 0.14, Math.cos(a) * 0.35, -0.05, Math.sin(a) * 0.35, '#c9d4cf', 8); }
    k.box(0.12, 0.25, 0.12, 0, -0.05, 0, '#b9c6c0'); k.cone(0.09, 0.12, 0, 0.2, 0, '#d9b65a');
  },
  schatz(k, o) {
    k.ball(0.14, 0, 0.04, 0, '#9a948a', 1.2, 0.8, 0.9);
    if (o.found) { k.box(0.12, 0.07, 0.08, 0.18, 0, 0.05, '#8a5a3a'); k.ball(0.04, 0.18, 0.08, 0.05, '#f2c14e', 1, 0.5, 1, true); }
    else { k.box(0.1, 0.012, 0.025, 0.18, 0.005, 0.1, '#7a4a33', 0.785); k.box(0.1, 0.012, 0.025, 0.18, 0.005, 0.1, '#7a4a33', -0.785); }
  },
  nest(k, o) {
    const dead = o.done;
    k.cone(0.16, 0.2, -0.18, 0, -0.1, dead ? '#6b6258' : '#7a6a5a', 4); k.cone(0.13, 0.17, 0.12, 0, -0.2, dead ? '#6b6258' : '#8a5a4a', 4);
    k.cyl(0.008, 0.008, 0.55, 0.25, 0, 0.1, WOODD, 4);
    if (!dead) { k.box(0.16, 0.1, 0.004, 0.33, 0.43, 0.1, '#161414'); k.ball(0.016, 0.3, 0.48, 0.105, '#f1e6d0'); }
    k.box(0.06, 0.06, 0.06, -0.02, 0, 0.18, WOOD, 0.3); k.box(0.05, 0.05, 0.05, 0.06, 0, 0.22, '#a07a52', 0.8);
    for (let i = 0; i < 5; i++) k.ball(0.022, Math.cos(i * 1.25) * 0.06, 0.01, 0.02 + Math.sin(i * 1.25) * 0.06, '#8a857c');
    if (!dead) k.cone(0.035, 0.08, 0, 0.01, 0.02, '#ffb347', 5, true);
    k.box(0.32, 0.03, 0.1, 0.02, 0, 0.4, WOOD, 0.4); // kleines Ruderboot am Strand
  },
  // neue Welt: Stufenpyramide mit goldener Spitze, überwachsener Tempel, Mammut im Eisblock, Geysir mit Sinterterrassen
  pyramide(k) {
    for (let i = 0; i < 5; i++) { const w = 0.95 - i * 0.18; k.box(w, 0.14, w, 0, i * 0.14, 0, i % 2 ? '#e2c48e' : '#d6b67e'); }
    k.cone(0.08, 0.12, 0, 0.7, 0, '#f2c14e', 4, true);
    k.box(0.12, 0.12, 0.04, 0, 0, 0.48, '#3a2e24');
    for (let i = 0; i < 4; i++) k.box(0.06, 0.03, 0.06, (k.rnd() - 0.5) * 1.2, 0, (k.rnd() - 0.5) * 1.2, '#cdb183', k.rnd() * 3);
  },
  tempel(k) {
    for (let i = 0; i < 4; i++) { const w = 0.8 - i * 0.16; k.box(w, 0.13, w, 0, i * 0.13, 0, i % 2 ? '#8f9b84' : '#7f8c76'); }
    k.box(0.22, 0.18, 0.22, 0, 0.52, 0, '#9aa58c'); k.box(0.08, 0.1, 0.02, 0, 0.52, 0.11, '#2d2a24');
    k.box(0.12, 0.36, 0.08, 0, 0, 0.4, '#87947c', 0, 0.62);
    for (let i = 0; i < 9; i++) k.ball(0.07 + k.rnd() * 0.06, (k.rnd() - 0.5) * 0.85, k.rnd() * 0.5, (k.rnd() - 0.5) * 0.85, ['#4f8a3e', '#5f9a48', '#3f7a36'][i % 3], 1, 0.7, 1);
  },
  mammut(k) {
    k.box(0.85, 0.32, 0.5, 0, 0, 0, '#cfe6f0');
    k.ball(0.22, -0.05, 0.22, 0, '#6e4b33', 1.4, 1, 0.9); k.ball(0.12, 0.28, 0.3, 0, '#6e4b33');
    k.torus(0.1, 0.014, Math.PI, 0.38, 0.22, 0.05, '#efe6d2', 0, Math.PI / 2); k.torus(0.1, 0.014, Math.PI, 0.38, 0.22, -0.05, '#efe6d2', 0, Math.PI / 2);
    for (const [x, z] of [[-0.22, 0.12], [-0.22, -0.12], [0.12, 0.12], [0.12, -0.12]]) k.cyl(0.05, 0.05, 0.16, x, 0, z, '#5e3f2b', 6);
  },
  geysir(k) {
    for (let i = 0; i < 3; i++) { const r = 0.42 - i * 0.12; k.cyl(r, r + 0.04, 0.05, 0, i * 0.05, 0, i % 2 ? '#e6dcc0' : '#d9c79e', 16); }
    k.add(new THREE.CircleGeometry(0.12, 14).rotateX(-Math.PI / 2).translate(0, 0.16, 0), '#7fd0d6');
    k.cone(0.05, 0.5, 0, 0.16, 0, '#e8f6f8', 8, true);
  },
  schlacht(k) {
    for (let i = 0; i < 6; i++) { const x = (k.rnd() - 0.5) * 0.7, z = (k.rnd() - 0.5) * 0.6; k.ball(0.06, x, 0, z, '#7d8a5a', 1.4, 0.45, 0.9); if (i % 2) { k.box(0.012, 0.11, 0.012, x, 0.02, z - 0.04, WOODD); k.box(0.06, 0.012, 0.012, x, 0.09, z - 0.04, WOODD); } else k.box(0.03, 0.08, 0.02, x, 0.01, z - 0.05, '#a9a39a'); }
    k.cyl(0.006, 0.006, 0.3, 0.2, 0, 0.1, WOODD, 4, 0.6);
  },
};

// Modell-Sammlung (seit 24.10.2026, ui/collection.js): Bauform eines Fundorts ohne Spielstand
export const SITE_KINDS = Object.keys(MAKE);
export function siteModel(t, found = true) {
  const b = new B(SITE_KINDS.indexOf(t) * 7 + 3);
  (MAKE[t] || MAKE.ruine)(b, { t, found, done: false, id: 1 });
  return b.build();
}

export class Sites {
  constructor(scene, fx) {
    this.scene = scene; this.fx = fx;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.items = new Map();
    this.tags = document.createElement('div');
    this.tags.id = 'siteTags';
    this.tags.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:6;';
    document.body.append(this.tags);
    const css = document.createElement('style');
    css.textContent = `#siteTags .st { position: absolute; transform: translate(-50%, -100%); white-space: nowrap; font-size: 11.5px; color: #fff6e0; text-shadow: 0 1px 4px rgba(0,0,0,0.75); text-align: center; }
      #siteTags .st b { display: block; font-family: var(--serif); font-size: 13px; font-weight: 600; }
      #siteTags .st i { font-style: normal; opacity: 0.75; font-size: 10.5px; }
      body.interior #siteTags { display: none; }`;
    document.head.append(css);
  }

  key(o) { return `${o.t}|${o.found ? 1 : 0}|${o.done ? 1 : 0}`; }

  sync(st) {
    const seen = new Set();
    for (const o of st.finds || []) {
      seen.add(o.id);
      let it = this.items.get(o.id);
      const k = this.key(o);
      if (it && it.k === k) continue;
      if (it) this.group.remove(it.g);
      const b = new B(o.id);
      (MAKE[o.t] || MAKE.ruine)(b, o);
      const { geo, glow } = b.build();
      const g = new THREE.Group();
      if (geo) { const m = new THREE.Mesh(geo, this.mat); m.castShadow = true; m.receiveShadow = true; g.add(m); }
      if (glow) g.add(new THREE.Mesh(glow, this.glowMat));
      const X = o.x - NX / 2 + 0.5, Z = o.y - NY / 2 + 0.5;
      g.position.set(X, Math.max(o.t === 'versunken' ? -0.1 : 0, groundY(X, Z)), Z);
      g.rotation.y = hash(o.id, 5) * Math.PI * 2;
      g.scale.setScalar(o.t === 'riesenbaum' ? 1.5 : 1);
      this.group.add(g);
      this.items.set(o.id, it = { g, k, o });
    }
    for (const [id, it] of this.items) if (!seen.has(id)) { this.group.remove(it.g); this.items.delete(id); }
  }

  update(st, t, dt, cam, hidden) {
    if (!st) return;
    if (t - (this.lastSync || -9) > 1 || this.syncSt !== st) { this.lastSync = t; this.syncSt = st; this.sync(st); }
    this.group.visible = !hidden;
    const fx = this.fx;
    let html = '';
    const v = this.v || (this.v = new THREE.Vector3());
    const W = innerWidth, H = innerHeight;
    for (const it of this.items.values()) {
      const o = it.o, p = it.g.position;
      // Funkeln über Unentdecktem, Dampf aus Quellen, Rauch aus dem Piratenlager
      if (fx && !hidden) {
        if (!o.found && o.t !== 'schlacht' && Math.random() < dt * 1.2) fx.glow.emit({ x: p.x + (Math.random() - 0.5) * 0.5, y: p.y + 0.15 + Math.random() * 0.3, z: p.z + (Math.random() - 0.5) * 0.5, vy: 0.08, life: 1.6, size: 0.05, c: [1, 0.86, 0.5], a: 0.7 });
        if (o.t === 'quelle' && Math.random() < dt * 3) fx.smoke.emit({ x: p.x + (Math.random() - 0.5) * 0.3, y: p.y + 0.05, z: p.z + (Math.random() - 0.5) * 0.3, vy: 0.25, life: 2.2, size: 0.12, grow: 2, c: [0.95, 0.97, 1], a: 0.25 });
        // Geysir: alle paar Sekunden eine Fontäne
        if (o.t === 'geysir') { const ph = (t * 0.22 + o.id * 0.37) % 1; if (ph < 0.12 && Math.random() < dt * 40) fx.smoke.emit({ x: p.x + (Math.random() - 0.5) * 0.08, y: p.y + 0.2, z: p.z + (Math.random() - 0.5) * 0.08, vx: (Math.random() - 0.5) * 0.3, vy: 2.2 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 0.3, g: -2.2, life: 1.6, size: 0.14, grow: 1.6, c: [0.96, 0.98, 1], a: 0.5 }); else if (Math.random() < dt * 2) fx.smoke.emit({ x: p.x, y: p.y + 0.18, z: p.z, vy: 0.2, life: 2, size: 0.1, grow: 2, c: [0.95, 0.97, 1], a: 0.2 }); }
        if (o.t === 'nest' && !o.done && Math.random() < dt * 2) fx.smoke.emit({ x: p.x, y: p.y + 0.1, z: p.z + 0.02, vy: 0.3, vx: 0.05, life: 2.5, size: 0.08, grow: 2.2, c: [0.55, 0.53, 0.52], a: 0.3 });
      }
      if (hidden || !cam) continue;
      const d = cam.position.distanceTo(p);
      if (d > 26 || (!o.found && d > 9)) continue;
      v.set(p.x, p.y + (o.t === 'riesenbaum' ? 2 : 0.7), p.z).project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) continue;
      const name = o.found ? (o.name || SITES[o.t].name) : L('Etwas Verborgenes', 'Something hidden');
      const sub = o.found ? SITES[o.t].name : '';
      html += `<div class="st" style="left:${((v.x + 1) / 2 * W).toFixed(0)}px;top:${((1 - v.y) / 2 * H).toFixed(0)}px;opacity:${Math.max(0.3, 1 - d / 26).toFixed(2)}"><b>${SITES[o.t].icon} ${name}</b>${sub && sub !== name ? `<i>${sub}</i>` : ''}</div>`;
    }
    if (html !== this.lastHtml) { this.tags.innerHTML = html; this.lastHtml = html; }
  }

  // Klick auf eine Kachel: liegt dort ein Fundort?
  at(st, x, y) {
    let best = null, bd = 2.2;
    for (const o of st.finds || []) { const d = Math.hypot(o.x - x, o.y - y); if (d < bd) { bd = d; best = o; } }
    return best;
  }
}

// Text für die Karte eines Fundorts
export function siteInfo(st, o) {
  const s = o.by ? st._rt.sById.get(o.by) : null;
  const y = o.found ? Math.floor(o.found / 24) + 1 : 0;
  const base = SITES[o.t].name;
  if (o.t === 'nest') {
    const c = (st.pirates || []).find(q => q.id === o.crew);
    if (!c) return `${o.name || base}.`;
    return c.end ? L(`${o.name || base}. Verlassen. Hier hausten einst ${c.name}.`, `${o.name || base}. Abandoned. ${c.name} once lived here.`)
      : L(`${o.name || base}: Hier verstecken sich ${c.name} unter ${c.capN}. ${c.crew.length} Mann, ${c.ships} ${c.ships === 1 ? 'Schiff' : 'Schiffe'}, Beute von ${Math.round(c.gold)} Münzen.`, `${o.name || base}: ${c.name} hide here under ${c.capN}. ${c.crew.length} crew, ${c.ships} ${c.ships === 1 ? 'ship' : 'ships'}, ${Math.round(c.gold)} coins of loot.`);
  }
  if (!o.found) return L(`${base}. Noch hat kein Mensch diesen Ort gefunden. Nur du weißt, dass er hier liegt.`, `${base}. No one has found this place yet. Only you know it is here.`);
  return L(`${o.name || base} (${base}). Gefunden im Jahr ${y}${s ? ' von Menschen aus ' + s.name : ''}.${o.done ? ' Längst geplündert.' : ''}`, `${o.name || base} (${base}). Found in year ${y}${s ? ' by people from ' + s.name : ''}.${o.done ? ' Plundered long ago.' : ''}`);
}
