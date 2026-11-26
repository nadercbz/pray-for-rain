// Stadtansicht 1 zu 1 (seit 26.10.2026, PLAN_ERDE_HEUTE.md). Jede Stadt der Welt aus echten Kartendaten: OpenFreeMap
// Vektorkacheln (OpenMapTiles Schema, Stufe 14, kostenlos, ohne Schlüssel). Kacheln rund um den Blick werden im Worker
// geladen und gebaut (worker.js, build.js), hier zu Meshes gemacht, weit entfernte wieder freigegeben. Dazu Wahrzeichen
// (landmarks.js), Namen der Viertel und Orte, Menschen und Verkehr (life.js).
import * as THREE from 'three';
import { frameAt, tileAt, tileOrigin, tileSize, localOf, lonLatOf, Z } from './build.js';
import { buildingMat, roadMat, groundMat, baseMat, waterMat, CU } from './mats.js';
import { tileOrigin as tileOriginZ } from './build.js';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
const FALLBACK = 'https://tiles.openfreemap.org/planet/20261018_080001_pt/{z}/{x}/{y}.pbf';
const BASE = { eu: '#b6bba3', jp: '#bcbbb3', us: '#b5b9a3', warm: '#cbbd9d', trop: '#b1b597' };

let template = null;
async function tileUrl() {
  if (template) return template;
  try {
    const r = await fetch(TILEJSON, { cache: 'force-cache' });
    const j = await r.json();
    template = (j.tiles && j.tiles[0]) || FALLBACK;
  } catch { template = FALLBACK; }
  return template;
}

const ATTRIB = '© <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

export class CityView {
  constructor(stage, opts = {}) {
    this.stage = stage;
    this.group = new THREE.Group();
    this.group.visible = false;
    stage.scene.add(this.group);
    this.mats = { bld: buildingMat(), road: roadMat(), ground: groundMat(), water: waterMat(), lm: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.02 }), glow: new THREE.MeshBasicMaterial({ color: 0xffd9a0 }) };
    // Fernsicht (Stufe 13): dieselben Shader, im Bereich der nahen Kacheln ausgeblendet
    this.farMats = { bld: buildingMat(true), road: roadMat(true), ground: groundMat(true), water: waterMat(true) };
    this.farOn = opts.far ?? true;
    this.farR = opts.farR ?? 2;   // Fernsicht: Kacheln der Stufe 13 rund um die Mitte (2: 5 mal 5)
    this.mats.walk = this.mats.road; // Gehwege nutzen denselben Shader (Stufe 7)
    this.tiles = new Map();
    this.queue = [];
    this.busy = 0;
    this.maxBusy = 4;
    this.workers = [];
    this.wid = 0;
    this.cb = new Map();
    this.active = false;
    this.labels = [];
    this.labelRoot = opts.labelRoot || null;
    this.onTile = opts.onTile || null;
    this.ring = opts.ring ?? 2;   // Kacheln rund um die Mitte (2: 5 mal 5)
    this.keep = this.ring + 1;    // ab diesem Abstand freigeben
    // Bäume: eine Krone und ein Stamm für alle Kacheln
    const crown = new THREE.IcosahedronGeometry(1, 1);
    const pos = crown.attributes.position;
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); pos.setY(i, y * 0.85 + (y > 0 ? 0.08 : 0)); }
    crown.computeVertexNormals();
    this.treeGeo = { crown, trunk: new THREE.CylinderGeometry(0.06, 0.09, 1, 6).translate(0, 0.5, 0) };
    this.treeMat = { crown: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), trunk: new THREE.MeshStandardMaterial({ color: 0x6e5440, roughness: 0.95 }) };
    this.landmarkLib = null;
  }

  worker() {
    if (!this.workers.length) {
      const n = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 2));
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        w.onmessage = e => { const f = this.cb.get(e.data.id); if (f) { this.cb.delete(e.data.id); f(e.data); } };
        this.workers.push(w);
      }
    }
    return this.workers[this.wid++ % this.workers.length];
  }

  // city: { lon, lat, name, style ('eu', 'jp', 'us', 'warm', 'trop'), lang ('de', 'en'), landmarks: [{ model, lon, lat, h, de, en }] }
  async enter(city) {
    this.exit();
    this.city = city;
    this.F = frameAt(city.lon, city.lat);
    this.style = city.style || 'eu';
    this.lang = city.lang || 'de';
    this.T = tileSize(this.F);
    this.active = true;
    this.group.visible = true;
    const base = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), baseMat(BASE[this.style] || BASE.eu));
    base.position.y = -0.02;
    base.receiveShadow = true;
    this.base = base;
    this.group.add(base);
    this.tmpl = await tileUrl();
    this.landmarks = (city.landmarks || []).map(l => { const [x, z] = localOf(this.F, l.lon, l.lat); return { ...l, x, z, placed: false }; });
    if (this.landmarks.some(l => l.model)) {
      try { this.landmarkLib = this.landmarkLib || await import('./landmarks.js'); } catch { this.landmarkLib = null; }
      this.placeAll();
    }
    this.attrib(true);
  }

  exit() {
    for (const t of this.tiles.values()) this.drop(t);
    this.tiles.clear();
    this.queue.length = 0;
    if (this.base) { this.group.remove(this.base); this.base.geometry.dispose(); this.base.material.dispose(); this.base = null; }
    for (const l of this.landmarks || []) if (l.mesh) { this.group.remove(l.mesh); l.mesh.geometry.dispose(); if (l.glowMesh) { this.group.remove(l.glowMesh); l.glowMesh.geometry.dispose(); } }
    this.landmarks = [];
    this.active = false;
    this.group.visible = false;
    this.attrib(false);
    if (this.labelRoot) this.labelRoot.innerHTML = '';
    this.labelEls = [];
  }

  attrib(on) {
    let el = document.getElementById('cityAttrib');
    if (!on) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'cityAttrib'; document.body.appendChild(el); }
    el.innerHTML = ATTRIB;
  }

  // Punkt in Länge, Breite zu Stadtkoordinaten und zurück
  local(lon, lat) { return localOf(this.F, lon, lat); }
  lonLat(x, z) { return lonLatOf(this.F, x, z); }

  update(dt, target) {
    if (!this.active) return;
    CU.uTime.value += dt;
    // Leuchtteile der Wahrzeichen: am Tag dunkles Glas, nachts warmes Licht
    const nk = CU.uNight.value;
    this.mats.glow.color.setRGB(0.24 + 0.76 * nk, 0.29 + 0.56 * nk, 0.34 + 0.29 * nk);
    const [cx, cy] = tileAt(this.F, target.x, target.z);
    this.focus = [cx, cy];
    if (this.base) { this.base.position.x = Math.round(target.x / 50) * 50; this.base.position.z = Math.round(target.z / 50) * 50; }
    // gewünschte Kacheln nach Abstand
    const want = [];
    for (let dy = -this.ring; dy <= this.ring; dy++) for (let dx = -this.ring; dx <= this.ring; dx++) want.push([cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)), Math.hypot(dx, dy)]);
    want.sort((a, b) => a[3] - b[3]);
    for (const [tx, ty, ring] of want) {
      const key = tx + ',' + ty;
      if (!this.tiles.has(key)) { const t = { key, tx, ty, ring, state: 'want', meshes: [] }; this.tiles.set(key, t); this.queue.push(t); }
      else this.tiles.get(key).ring = ring;
    }
    for (const t of [...this.tiles.values()]) {
      if (t.far) continue;
      const r = Math.max(Math.abs(t.tx - cx), Math.abs(t.ty - cy));
      if (r > this.keep) { this.drop(t); this.tiles.delete(t.key); }
      else if (t.shadowMesh) {
        t.shadowMesh.castShadow = r <= 1;
        // Detailstufe: im äußeren Ring nur die großen Gebäude, Bäume nur nah
        t.bldGeo.setDrawRange(0, r <= 1 ? Infinity : t.bigTris * 3);
        if (t.shadowTrees) t.shadowTrees.castShadow = r <= 1;
      }
    }
    // Fernsicht: 5 mal 5 Kacheln der Stufe 13 rund um die Mitte, nur große Gebäude, Wasser, Wald, Hauptstraßen
    if (this.farOn) {
      const fx = cx >> 1, fy = cy >> 1;
      for (let dy = -this.farR; dy <= this.farR; dy++) for (let dx = -this.farR; dx <= this.farR; dx++) {
        const key = 'f' + (fx + dx) + ',' + (fy + dy);
        if (!this.tiles.has(key)) { const t = { key, tx: fx + dx, ty: fy + dy, z: 13, far: true, ring: 9, state: 'want', meshes: [] }; this.tiles.set(key, t); this.queue.push(t); }
      }
      for (const t of [...this.tiles.values()]) if (t.far && Math.max(Math.abs(t.tx - fx), Math.abs(t.ty - fy)) > this.farR + 1) { this.drop(t); this.tiles.delete(t.key); }
      const r = this.ring, a = tileOriginZ(this.F, cx - r, cy - r), b = tileOriginZ(this.F, cx + r + 1, cy + r + 1);
      CU.uNear.value.set(a[0], a[1], b[0], b[1]);
    }
    // nahe Kacheln zuerst, die Fernsicht danach
    const pri = t => t.far ? 100 + Math.hypot(t.tx * 2 + 1 - cx, t.ty * 2 + 1 - cy) : Math.hypot(t.tx - cx, t.ty - cy);
    this.queue.sort((a, b) => pri(a) - pri(b));
    while (this.busy < this.maxBusy && this.queue.length) {
      const t = this.queue.shift();
      if (!this.tiles.has(t.key) || t.state !== 'want') continue;
      this.load(t);
    }
  }

  load(t) {
    t.state = 'load';
    this.busy++;
    const id = ++this.reqId || (this.reqId = 1);
    const url = this.tmpl.replace('{z}', t.z || Z).replace('{x}', t.tx).replace('{y}', t.ty);
    this.cb.set(id, msg => {
      this.busy--;
      if (!this.tiles.has(t.key) || !this.active) return;
      if (!msg.ok) { t.state = 'fail'; t.error = msg.error; setTimeout(() => { if (this.tiles.get(t.key) === t) { t.state = 'want'; this.queue.push(t); } }, 4000); return; }
      this.make(t, msg.tile);
    });
    this.worker().postMessage({ id, url, tx: t.tx, ty: t.ty, z: t.z || Z, far: !!t.far, F: { X0: this.F.X0, Y0: this.F.Y0, C: this.F.C }, style: this.style, lang: this.lang });
  }

  make(t, o) {
    const up = n => { const a = new Float32Array(n * 3); for (let i = 1; i < a.length; i += 3) a[i] = 1; return a; };
    const M = t.far ? { ...this.mats, ...this.farMats, walk: this.farMats.road } : this.mats;
    const add = (mesh, shadow) => { mesh.receiveShadow = !t.far; mesh.castShadow = !!shadow && !t.far; mesh.matrixAutoUpdate = false; this.group.add(mesh); t.meshes.push(mesh); if (t.far) this.stage.noAO.add(mesh); return mesh; };
    const geo = (pos, extra) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      for (const [k, v, n] of extra) g.setAttribute(k, new THREE.BufferAttribute(v, n));
      if (!g.attributes.normal) g.setAttribute('normal', new THREE.BufferAttribute(up(pos.length / 3), 3));
      g.computeBoundingSphere();
      return g;
    };
    if (o.bld.pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(o.bld.pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(o.bld.nrm, 4, true));
      g.setAttribute('color', new THREE.BufferAttribute(o.bld.col, 4, true));
      g.setAttribute('aB', new THREE.BufferAttribute(o.bld.attr, 4));
      if (o.bld.wall) g.setAttribute('aW', new THREE.BufferAttribute(o.bld.wall, 2));
      g.setIndex(new THREE.BufferAttribute(o.bld.index, 1));
      g.computeBoundingSphere();
      t.bldGeo = g;
      t.bigTris = o.bigTris;
      if (!t.far) t.bldGeo.setDrawRange(0, t.ring <= 1 ? Infinity : t.bigTris * 3);
      const bm = add(new THREE.Mesh(t.bldGeo, M.bld), t.ring <= 1);
      if (!t.far) t.shadowMesh = bm;
    }
    if (o.ground.pos.length) add(new THREE.Mesh(geo(o.ground.pos, [['color', o.ground.col, 3]]), M.ground));
    if (o.water.length) add(new THREE.Mesh(geo(o.water, []), M.water));
    if (o.walkway.pos.length) add(new THREE.Mesh(geo(o.walkway.pos, [['aR', o.walkway.attr, 4]]), M.walk));
    if (o.rail.pos.length) add(new THREE.Mesh(geo(o.rail.pos, [['aR', o.rail.attr, 4]]), M.road));
    if (o.road.pos.length) add(new THREE.Mesh(geo(o.road.pos, [['aR', o.road.attr, 4]]), M.road));
    // Bäume
    const nT = o.trees.length / 5;
    if (nT) {
      const cr = new THREE.InstancedMesh(this.treeGeo.crown, this.treeMat.crown, nT), tr = new THREE.InstancedMesh(this.treeGeo.trunk, this.treeMat.trunk, nT);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
      const greens = ['#7fa55e', '#6f9a58', '#8bb067', '#93b46a', '#6b8f55', '#7ea361'].map(h => new THREE.Color(h));
      for (let i = 0; i < nT; i++) {
        const x = o.trees[i * 5], z = o.trees[i * 5 + 2], k = o.trees[i * 5 + 3], kind = o.trees[i * 5 + 4];
        const r = (kind === 2 ? 0.34 : kind === 0 ? 0.3 : 0.28) * k, hT = (kind === 2 ? 0.55 : 0.42) * k;
        p.set(x, hT + r * 0.7, z); s.set(r, r * 1.05, r); m.compose(p, q, s); cr.setMatrixAt(i, m);
        p.set(x, 0, z); s.set(k, hT + r * 0.3, k); m.compose(p, q, s); tr.setMatrixAt(i, m);
        c.copy(greens[(((i * 7 + Math.round(x * 3)) % greens.length) + greens.length) % greens.length]).multiplyScalar(0.9 + ((i * 13) % 10) / 50);
        cr.setColorAt(i, c);
      }
      cr.instanceMatrix.needsUpdate = true; tr.instanceMatrix.needsUpdate = true; cr.instanceColor.needsUpdate = true;
      cr.computeBoundingSphere(); tr.computeBoundingSphere();
      add(cr, t.ring <= 1); add(tr, false);
      t.shadowTrees = cr; t.treeMeshes = [cr, tr];
    }
    t.data = { bldList: o.bldList, walk: o.walk || [], drive: o.drive || [], labels: o.labels || [], ox: o.ox, oz: o.oz, size: o.size };
    t.state = 'ready';
    for (const L of this.landmarks) if (L.placed) this.landmarkTile(L, t);
    if (t.far) return;
    if (this.onTile) this.onTile(t);
  }

  drop(t) {
    for (const m of t.meshes) {
      this.group.remove(m); this.stage.noAO.delete(m);
      if (!m.isInstancedMesh) m.geometry.dispose(); else m.dispose();
    }
    t.meshes.length = 0;
    t.state = 'gone';
  }

  // Wahrzeichen: eigenes Modell an der echten Stelle, sofort beim Betreten (auch weit entfernte stehen am Horizont).
  // Die Gebäude darunter verschwinden, sobald ihre Kachel geladen ist; die Richtung kommt vom echten Grundriss.
  placeAll() {
    const lib = this.landmarkLib;
    if (!lib) return;
    for (const L of this.landmarks) {
      if (L.placed || !L.model) continue;
      let M = null;
      try { M = lib.buildLandmark(L.model); } catch (e) { console.warn('Wahrzeichen', L.model, e); }
      if (!M || !M.geo) continue;
      L.R = Math.max(M.w || 0, M.d || 0, (M.r || 10) * 2) / 20 + 0.4;
      const ang = L.yaw ? -L.yaw * Math.PI / 180 : 0;
      const mesh = new THREE.Mesh(M.geo, this.mats.lm);
      mesh.scale.setScalar(0.1); mesh.position.set(L.x, 0, L.z); mesh.rotation.y = ang;
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh);
      L.mesh = mesh;
      if (M.glow) { const g = new THREE.Mesh(M.glow, this.mats.glow); g.scale.setScalar(0.1); g.position.copy(mesh.position); g.rotation.y = ang; this.group.add(g); L.glowMesh = g; }
      L.placed = true;
      for (const t of this.tiles.values()) if (t.state === 'ready') this.landmarkTile(L, t);
    }
  }
  landmarkTile(L, t) {
    const d = t.data, T = d.size;
    if (L.x + L.R < d.ox || L.x - L.R > d.ox + T || L.z + L.R < d.oz || L.z - L.R > d.oz + T) return;
    const ang = this.clearUnder(L.x, L.z, L.R, null, [t]);
    if (ang != null && !L.oriented && !t.far && !L.yaw) { L.oriented = true; L.mesh.rotation.y = ang; if (L.glowMesh) L.glowMesh.rotation.y = ang; }
  }

  // Gebäude im Umkreis R unter einem Wahrzeichen ausblenden; liefert die Richtung der Längsachse des größten davon
  clearUnder(x, z, R, M, tiles) {
    let best = null, bestA = 0;
    const pts = [];
    for (const t of tiles || this.tiles.values()) {
      if (t.state !== 'ready' || !t.bldGeo) continue;
      const L = t.data.bldList, P = t.bldGeo.attributes.position.array;
      let dirty = false;
      for (let i = 0; i < L.length; i += 8) {
        const d = Math.hypot(L[i] - x, L[i + 1] - z);
        if (d > R) continue;
        const v0 = L[i + 6], vn = L[i + 7];
        if (!t.far && L[i + 3] > bestA && d < R * 0.7) {
          bestA = L[i + 3]; best = true; pts.length = 0;
          for (let k = v0 * 3; k < (v0 + vn) * 3; k += 3) pts.push(P[k], P[k + 2]);
        }
        for (let k = v0 * 3; k < (v0 + vn) * 3; k += 3) { P[k] = L[i]; P[k + 1] = -1; P[k + 2] = L[i + 1]; }
        dirty = true;
      }
      if (dirty) { t.bldGeo.attributes.position.needsUpdate = true; t.bldGeo.computeBoundingSphere(); }
    }
    if (!best || pts.length < 6) return null;
    // Hauptachse aus der Streuung der Wandpunkte
    let mx = 0, mz = 0; const n = pts.length / 2;
    for (let i = 0; i < pts.length; i += 2) { mx += pts[i]; mz += pts[i + 1]; }
    mx /= n; mz /= n;
    let sxx = 0, szz = 0, sxz = 0;
    for (let i = 0; i < pts.length; i += 2) { const a = pts[i] - mx, b = pts[i + 1] - mz; sxx += a * a; szz += b * b; sxz += a * b; }
    if (Math.abs(sxx - szz) < 1e-6 && Math.abs(sxz) < 1e-6) return null;
    const th = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    return -th;
  }

  // Namen für die Anzeige (nächste zuerst), je Art gefiltert
  labelsNear(target, max = 40) {
    const out = [];
    for (const t of this.tiles.values()) if (t.state === 'ready' && !t.far) for (const l of t.data.labels) out.push(l);
    for (const L of this.landmarks) out.push({ k: 'lm', name: this.lang === 'de' ? L.de : L.en, x: L.x, z: L.z, rank: 0, h: (L.h || 30) / 10 });
    out.sort((a, b) => (a.rank - b.rank) * 3 + (Math.hypot(a.x - target.x, a.z - target.z) - Math.hypot(b.x - target.x, b.z - target.z)) / 40);
    // derselbe Name aus mehreren Kacheln (Viertel an der Kachelgrenze) nur einmal
    const seen = new Set(), res = [];
    for (const l of out) { if (seen.has(l.name)) continue; seen.add(l.name); res.push(l); if (res.length >= max) break; }
    return res;
  }

  // Wege für life.js: Paare [Weg, Matrix]; die Stadtansicht liegt schon in Weltkoordinaten (Matrix null)
  lifeLines(kind, target, r) {
    const out = [];
    for (const t of this.tiles.values()) {
      if (t.state !== 'ready' || t.far) continue;
      const cx = t.data.ox + t.data.size / 2, cz = t.data.oz + t.data.size / 2;
      if (Math.hypot(cx - target.x, cz - target.z) > r + t.data.size) continue;
      for (const l of t.data[kind]) out.push([l, null]);
    }
    return out;
  }

  stats() {
    let ready = 0, tris = 0, load = 0;
    for (const t of this.tiles.values()) { if (t.state === 'ready') { ready++; for (const m of t.meshes) if (!m.isInstancedMesh) { const g = m.geometry; tris += Math.min(g.drawRange.count, g.index ? g.index.count : g.attributes.position.count) / 3; } } else if (t.state === 'load') load++; }
    return { ready, load, tiles: this.tiles.size, tris: Math.round(tris) };
  }
}
