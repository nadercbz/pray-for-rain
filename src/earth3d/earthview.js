// Die nahtlose Erde (seit 27.10.2026, Naders Wunsch: "rauszoomen ohne Kartenwechsel, alles zusammenhängend, eins zu
// eins"). Eine Kugel im Maßstab 1 zu 1 (1 Einheit = 10 m) aus Web Mercator Kacheln: je näher, desto feiner (Stufe 2 bis
// 14), von der Umlaufbahn bis auf den Gehweg ohne Wechsel. Boden und Textur rechnet der Worker (worker.js), nahe am Blick
// kommen die echten Gebäude, Straßenbänder, Bäume und Wahrzeichen dazu (city/build.js, city/landmarks.js).
// Wandernder Ursprung: die Welt ist immer die Tangentialebene am Blickziel (x Ost, y oben, z Süd), die Wurzelgruppe dreht
// die erdfesten Koordinaten (ECEF) hinein, jede Kachel steht in ihrer eigenen Tangentialebene. So bleibt die Rechnung in
// Float32 genau, egal wo auf der Erde und in welcher Höhe.
import * as THREE from 'three';
import { R, UNIT, ecef, frame, toLocal, toEcef, lonLatOf, tileCenter, tileSize, tileAt, latOfY, lonOfX, MAXLAT } from './geo.js';
import { buildingMat, roadMat, CU, PN } from '../city/mats.js';
import { patch } from '../render/mats.js';
import { crown as crownGeo, trunk as trunkGeo, lowCrown, lowTrunk } from '../render/treegeo.js';
import { tuftGeo, lupineGeo, daisyGeo, lanternGeo, lanternGlassGeo, benchGeo } from '../render/plantgeo.js';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
const FALLBACK = 'https://tiles.openfreemap.org/planet/20261025_080012_pt/{z}/{x}/{y}.pbf';
const ROOTZ = 2, MAXZ = 14;
const D2R = Math.PI / 180;
const GRD = 102.4;
const FREE = function () { this.array = null; };
const CLOSE = tex => { const im = tex.image; if (im && im.close) { im.close(); } };
const UPV = new THREE.Vector3(0, 1, 0);
// Laubfarben wie die Bäume der Inselwelt (Vertexfarbe der Krone ist weiß nach grau, hier kommt der Ton dazu)
const GREENS = ['#86b55a', '#74a650', '#93c063', '#7fae5a', '#6f9c50', '#8cbb5e', '#a1c46a'].map(h => new THREE.Color(h));
const PINES = ['#557a4c', '#5f8752', '#4d7145'].map(h => new THREE.Color(h));
// Bodendecker wie auf den Inseln: Halme, Lupinen, Margeriten, Büsche
const TUFTS = ['#9cc35f', '#8ab655', '#a8c96a', '#93bd5a'].map(h => new THREE.Color(h));
const LUPINS = ['#9b7fd1', '#c77dbb', '#7f9fe0', '#e99ab0', '#f2efe6'].map(h => new THREE.Color(h));
const DAISIES = ['#f7f4ea', '#f2d45a', '#f7f4ea', '#f0a35a'].map(h => new THREE.Color(h));
const hh = (a, b, c) => { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }; // Wiederholung der Bodenmuster: 1024 m (city/mats.js PN)
const BLACK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); BLACK.needsUpdate = true;

// Boden der Erde (seit 27.10.2026, Naders Wunsch: so aufwendig wie die Inselwelt). Grundlage ist die Kacheltextur aus dem
// Worker, nah am Boden (ab Stufe 13) kommt die Feinzeichnung der Inselwelt dazu, gesteuert von der Flächenkarte uSurf
// (R Wiese und Grün, G Pflaster und Plätze, R und G zusammen Sand, B Wasser, schwaches B Wohngebiet): satte Wiesen mit kühlen und warmen Flecken,
// feine Büschel (echte Halme und Blumen setzt updateNearCover), helle Platten, Sandrippeln, Wasser mit bewegten Wellen und Spiegelung.
function earthGroundMat(surf) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0, side: THREE.DoubleSide });
  m.userData.uSurf = { value: surf || BLACK }; m.userData.uDet = { value: surf ? 1 : 0 };
  m.onBeforeCompile = function (sh) {
    sh.uniforms.uSurf = this.userData.uSurf; sh.uniforms.uDet = this.userData.uDet;
    sh.uniforms.uGrd = CU.uGrd; sh.uniforms.uTime = CU.uTime;
    sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform sampler2D uSurf; uniform float uDet, uTime; uniform vec2 uGrd; varying vec3 vWP; float WAT = 0.0;\n' + PN + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
      if (uDet > 0.5) {
        vec4 S = texture2D(uSurf, vMapUv);
        float sand = min(S.r, S.g), grass = max(0.0, S.r - sand), paved = max(0.0, S.g - sand), wat = smoothstep(0.45, 0.85, S.b);
        float urb = clamp((S.b - 0.08) / 0.15, 0.0, 1.0) * (1.0 - step(0.42, S.b));
        vec2 p = (vWP.xz + uGrd) * 10.0;
        float px = length(fwidth(p));
        float mid = 1.0 - smoothstep(2.0, 8.0, px), near = 1.0 - smoothstep(0.06, 0.25, px);
        vec3 c = diffuseColor.rgb;
        float nA = pn(p, 0.125), nB = pn(p, 0.5), nC = pn(p, 2.0), nD = pn(p, 8.0);
        float lum = dot(c, vec3(0.3, 0.59, 0.11));
        // Wiese: Farbe der Inselwelt, Wald und Schatten bleiben dunkler (Helligkeit der Karte)
        vec3 gA = vec3(0.371, 0.584, 0.153), gB = vec3(0.223, 0.451, 0.102);
        float v = nA * 0.55 + nB * 0.45;
        vec3 gT = mix(gB, gA, smoothstep(0.25, 0.75, v)) * clamp(lum / 0.4, 0.55, 1.2);
        c = mix(c, gT, grass * mid * 0.7);
        c = mix(c, mix(c * vec3(0.82, 0.95, 0.86), c * vec3(1.12, 1.07, 0.82), smoothstep(0.28, 0.74, v)), grass * mid * 0.7);
        c *= 1.0 + ((nC - 0.5) * 0.22 + (nD - 0.5) * 0.14) * grass * near;
        // Pflaster und Plätze: helle Platten im Verband
        vec2 q = p / vec2(1.0, 0.5); q.x += step(1.0, mod(floor(q.y), 2.0)) * 0.5;
        vec2 g = abs(fract(q) - 0.5);
        vec3 sl = vec3(0.7, 0.67, 0.6) * (0.93 + ph(floor(q), 2048.0) * 0.09);
        sl *= 1.0 - 0.12 * smoothstep(0.45, 0.5, max(g.x, g.y)) * near;
        c = mix(c, sl, paved * mid * 0.8);
        // Wohngebiet ohne eigene Fläche: Höfe und Plätze mit leichtem Pflaster
        c = mix(c, mix(c, sl, 0.45), urb * near * smoothstep(0.25, 0.45, lum));
        // Sand: große Wellen und feine Windrippeln
        float big = sin(dot(p, vec2(0.30679, 0.12272)) + nA * 6.0) * 0.5 + 0.5;
        float rip = sin(dot(p, vec2(5.2339, 2.0923)) + nB * 3.0) * 0.5 + 0.5;
        c *= 1.0 + ((big - 0.5) * 0.12 + (rip - 0.5) * 0.08 * near) * sand * mid;
        // Wasser: Farbe zwischen tief und flach wie im Meer der Inselwelt
        WAT = wat;
        c = mix(c, mix(vec3(0.03, 0.17, 0.22), vec3(0.2, 0.48, 0.42), 0.3 + nB * 0.2), wat * 0.45);
        c *= 0.95 + nC * 0.1 * near * (1.0 - wat);
        diffuseColor.rgb = c;
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.07, WAT);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      if (WAT > 0.01) {
        vec2 p = (vWP.xz + uGrd) * 10.0; float t = uTime;
        float a = pn(p + vec2(t * 0.6, t * 0.35), 0.25) - pn(p + vec2(-t * 0.4, t * 0.5), 0.25);
        float b = pn(p + vec2(t * 0.9, -t * 0.6), 1.0) - pn(p + vec2(t * 0.45, t * 0.8), 1.0);
        vec3 wn = normalize(vec3(a * 0.32 + b * 0.14, 1.0, b * 0.32 - a * 0.12));
        normal = normalize(mix(normal, normalize((viewMatrix * vec4(wn, 0.0)).xyz), WAT));
      }`);
  };
  m.customProgramCacheKey = () => 'earth-ground-4';
  return m;
}

export class EarthView {
  constructor(stage, opts = {}) {
    this.stage = stage;
    this.root = new THREE.Group();
    stage.scene.add(this.root);
    this.tiles = new Map();
    this.details = new Map();
    this.queue = []; this.dqueue = [];
    this.busy = 0; this.maxBusy = opts.coarse ? 4 : 7;
    this.splitPx = opts.coarse ? 420 : 330;
    // volle Stadtkacheln im Feld 3 mal 3 (vorher 5 mal 5 auf dem Desktop, zu viel Speicher in dichten Städten), weiter weg die
    // großen Gebäude der Stufe 13
    this.detailRing = 1;
    this.coarse = !!opts.coarse;
    this.workers = []; this.cb = new Map(); this.reqId = 1; this.wid = 0;
    this.F = frame(13.4, 52.5);
    this.M = new THREE.Matrix4(); this.Mi = new THREE.Matrix4();
    this.mats = { bld: buildingMat(), road: roadMat(), farBld: buildingMat(true), farRoad: roadMat(true), lm: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 }), glow: new THREE.MeshBasicMaterial({ vertexColors: true }) };
    // Bäume der Inselwelt (render/treegeo.js, ein Baum rund 14 m bei Größe 1): je Kachel einfache Formen, nahe am Blick
    // die runden Ballenkronen und Kegelkiefern (updateNearTrees), Wind wie auf den Inseln
    this.treeGeo = { lo: lowCrown('round'), loPine: lowCrown('pine'), trunk: lowTrunk(0.85), hi: crownGeo(1, 'round', true), hi2: crownGeo(7, 'round', true), pine: crownGeo(3, 'pine', true), hiTrunk: trunkGeo('round'), pineTrunk: trunkGeo('pine') };
    this.treeMat = { crown: patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }), { sway: 0.03 }), trunk: patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), { sway: 0.02 }) };
    this.near = null;
    this.sunEcef = new THREE.Vector3(1, 0, 0);
    this.landmarks = []; this.landmarkLib = null;
    this.frameNo = 0;
    this.buildSpace();
  }

  // ---------- Rahmen ----------
  setOrigin(lon, lat) {
    // Bodenmuster festhalten: der neue Ursprung lag im alten Rahmen bei w, um so viel wandert uGrd (Rest durch 1024 m)
    if (this.F) { const w = this.worldOf(lon, lat, 0), g = CU.uGrd.value; g.x = (((g.x + w.x) % GRD) + GRD) % GRD; g.y = (((g.y + w.z) % GRD) + GRD) % GRD; }
    this.nearDirty = true; this.coverDirty = true;
    this.F = frame(lon, lat);
    const { E, U, S } = this.F;
    this.M.set(E[0], E[1], E[2], 0, U[0], U[1], U[2], 0, S[0], S[1], S[2], 0, 0, 0, 0, 1);
    this.Mi.copy(this.M).transpose();
    this.root.quaternion.setFromRotationMatrix(this.M);
    this.root.updateMatrixWorld(true);
    for (const t of this.tiles.values()) if (t.group) this.place(t);
    for (const d of this.details.values()) if (d.group) this.place(d);
    for (const L of this.landmarks) if (L.group) this.place(L);
    this.placeSpace();
  }
  // Gruppe einer Kachel an ihre Stelle: Position (Mitte minus Ursprung) in ECEF Achsen, Drehung Tangentialebene zu ECEF
  place(t) {
    const o = this.F.o;
    t.group.position.set(t.ce[0] - o[0], t.ce[1] - o[1], t.ce[2] - o[2]);
    t.group.quaternion.copy(t.q);
    t.group.updateMatrixWorld(true);
  }
  // Welt (Tangentialebene am Ursprung) und ECEF
  worldOf(lon, lat, h = 0, out = new THREE.Vector3()) { const p = ecef(lon, lat, h), o = this.F.o; out.set(p[0] - o[0], p[1] - o[1], p[2] - o[2]).applyMatrix4(this.M); return out; }
  ecefOf(v) { const w = v.clone().applyMatrix4(this.Mi); return [w.x + this.F.o[0], w.y + this.F.o[1], w.z + this.F.o[2]]; }
  lonLatOfWorld(v) { const e = this.ecefOf(v); return lonLatOf(e[0], e[1], e[2]); }
  dirToWorld(e, out = new THREE.Vector3()) { return out.set(e[0], e[1], e[2]).applyMatrix4(this.M); }

  // ---------- Start ----------
  // Auftrag an einen Worker: feine Kacheln (ab Stufe 11) und Stadtdetails nach Gegend (Vorfahr der Stufe 10), damit Boden
  // und Details derselben Kachel denselben Speicher der Vektorkacheln nutzen; grobe Kacheln reihum
  workerFor(z, x, y) {
    this.worker();
    if (z < 11) return this.worker();
    const a = x >> (z - 10), b = y >> (z - 10), h = Math.imul(a * 73856093 ^ b * 19349663, 2654435761) >>> 0;
    return this.workers[h % this.workers.length];
  }
  worker() {
    if (!this.workers.length) {
      const n = Math.max(2, Math.min(5, (navigator.hardwareConcurrency || 4) - 2));
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        w.onmessage = e => { const f = this.cb.get(e.data.id); if (f) { this.cb.delete(e.data.id); f(e.data); } };
        w.postMessage(this.initMsg);
        this.workers.push(w);
      }
    }
    return this.workers[this.wid++ % this.workers.length];
  }
  async init(bio, W, H, lon0) {
    let tmpl = FALLBACK;
    try { const j = await (await fetch(TILEJSON, { cache: 'force-cache' })).json(); tmpl = (j.tiles && j.tiles[0]) || FALLBACK; } catch { /* Rückfall */ }
    this.initMsg = { type: 'init', bio, W, H, lon0, tmpl };
    this.worker();
    // Grundstufe: die ganze Erde in 16 Kacheln, vor dem ersten Bild geladen
    const n = 2 ** ROOTZ, wait = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const t = this.tile(ROOTZ, x, y); t.keep = true; wait.push(this.load(t)); }
    await Promise.all(wait);
  }

  tile(z, x, y) {
    const key = z + '/' + x + '/' + y;
    let t = this.tiles.get(key);
    if (t) return t;
    const [lon, lat] = tileCenter(z, x, y), ce = ecef(lon, lat, 0), F = frame(lon, lat);
    const sizeU = tileSize(z, y), n2 = 2 ** z;
    // Radius: weitester Eckpunkt plus Gebirge
    let rad = 0;
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0], [0.5, 1]]) { const p = ecef(lonOfX((x + u) / n2), latOfY((y + v) / n2), 0); rad = Math.max(rad, Math.hypot(p[0] - ce[0], p[1] - ce[1], p[2] - ce[2])); }
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...F.E), new THREE.Vector3(...F.U), new THREE.Vector3(...F.S)));
    t = { key, z, x, y, lon, lat, ce, q, sizeU, rad: rad + 900, nrm: [ce[0] / R, ce[1] / R, ce[2] / R], state: 'new', seen: 0 };
    this.tiles.set(key, t);
    return t;
  }

  load(t) {
    if (t.state !== 'new' && t.state !== 'fail') return t.promise;
    t.state = 'load';
    this.busy++;
    const S = t.z >= 13 ? 512 : 256;
    t.promise = new Promise(res => {
      const id = this.reqId++;
      this.cb.set(id, msg => {
        this.busy--;
        if (!msg.ok || t.state === 'gone') { t.state = msg.ok ? 'gone' : 'fail'; if (!msg.ok) setTimeout(() => { if (t.state === 'fail') t.state = 'new'; }, 3000); res(); return; }
        this.makeGround(t, msg.out);
        res();
      });
      this.workerFor(t.z, t.x, t.y).postMessage({ type: 'ground', id, z: t.z, x: t.x, y: t.y, S });
    });
    return t.promise;
  }

  makeGround(t, o) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(o.pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(o.uv, 2));
    g.setAttribute('aLL', new THREE.BufferAttribute(o.ll, 2));
    g.setIndex(new THREE.BufferAttribute(o.idx, 1));
    if (o.nrm) g.setAttribute('normal', new THREE.BufferAttribute(o.nrm, 3)); else g.computeVertexNormals();
    g.computeBoundingSphere();
    // nach dem Hochladen auf die Grafikkarte die Kopien im Hauptspeicher freigeben (Höhen bleiben in t.hg)
    for (const a of Object.values(g.attributes)) a.onUpload(FREE);
    g.index.onUpload(FREE);
    const tex = new THREE.Texture(o.bmp);
    tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true; tex.onUpdate = CLOSE;
    let surf = null;
    if (o.surf) { surf = new THREE.Texture(o.surf); surf.flipY = false; surf.wrapS = surf.wrapT = THREE.ClampToEdgeWrapping; surf.needsUpdate = true; surf.onUpdate = CLOSE; t.surf = surf; }
    // Grafikspeicher dieser Kachel (Texturen mit Mipmaps, Netz)
    t.bytes = (o.bmp.width * o.bmp.height * 4 * (o.surf ? 2 : 1)) * 1.34 + o.pos.length * 4 * 3 + o.idx.length * 4;
    this.gpuBytes = (this.gpuBytes || 0) + t.bytes;
    const mat = earthGroundMat(surf); mat.map = tex;
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    t.group = new THREE.Group(); t.group.matrixAutoUpdate = true; t.group.add(mesh); t.group.visible = false;
    this.root.add(t.group);
    this.place(t);
    t.mesh = mesh; t.tex = tex; t.hg = o.hg; t.n = o.n; t.hmin = o.hmin; t.hmax = o.hmax;
    t.rad = (t.rad - 900) + Math.max(10, o.hmax);
    t.state = 'ready';
  }

  dropTile(t) {
    if (t.group) { this.root.remove(t.group); t.mesh.geometry.dispose(); t.mesh.material.dispose(); t.tex.dispose(); if (t.tex.image && t.tex.image.close) t.tex.image.close(); if (t.surf) { t.surf.dispose(); if (t.surf.image && t.surf.image.close) t.surf.image.close(); } this.gpuBytes -= t.bytes || 0; t.mesh = t.tex = t.surf = t.hg = null; }
    t.group = null; t.state = 'gone';
    this.tiles.delete(t.key);
  }

  // ---------- Höhe ----------
  // Bodenhöhe (Einheiten) an Länge und Breite aus der feinsten geladenen Kachel
  heightAt(lon, lat) {
    for (let z = MAXZ; z >= ROOTZ; z--) {
      const [x, y] = tileAt(z, lon, lat), t = this.tiles.get(z + '/' + x + '/' + y);
      if (!t || t.state !== 'ready') continue;
      const n2 = 2 ** z, X = (lon + 180) / 360 * n2 - x;
      const s = Math.sin(Math.max(-MAXLAT, Math.min(MAXLAT, lat)) * D2R), Y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n2 - y;
      const n = t.n, N1 = n + 1, fx = Math.min(n, Math.max(0, X * n)), fy = Math.min(n, Math.max(0, Y * n));
      const x0 = Math.min(n - 1, fx | 0), y0 = Math.min(n - 1, fy | 0), ax = fx - x0, ay = fy - y0, H = t.hg;
      const a = H[y0 * N1 + x0], b = H[y0 * N1 + x0 + 1], c = H[(y0 + 1) * N1 + x0], d = H[(y0 + 1) * N1 + x0 + 1];
      return a + (b - a) * ax + (c - a) * ay + (a - b - c + d) * ax * ay;
    }
    return 0;
  }

  // Bodenhöhe unter einem Weltpunkt (x, z in Einheiten), bezogen auf die Tangentialebene des Ursprungs (die Erde krümmt
  // sich darunter weg): für den Flug (earthflight.js), viele Aufrufe je Bild, darum ohne neue Vektoren
  groundWorld(x, z) {
    const F = this.F, o = F.o, E = F.E, Sv = F.S;
    const lonlat = lonLatOf(o[0] + E[0] * x + Sv[0] * z, o[1] + E[1] * x + Sv[1] * z, o[2] + E[2] * x + Sv[2] * z);
    return this.heightAt(lonlat[0], lonlat[1]) - (x * x + z * z) / (2 * R);
  }

  // ---------- Auswahl der Kacheln ----------
  update(dt, camera, target) {
    this.frameNo++;
    const camE = this.ecefOf(camera.position), camR = Math.hypot(camE[0], camE[1], camE[2]);
    const alt = Math.max(0.05, camR - R - this.heightAt(...lonLatOf(camE[0], camE[1], camE[2]).slice(0, 2)));
    this.alt = alt;
    const horizon = Math.acos(Math.min(1, R / Math.max(R + 1, camR)));
    const pxK = (innerHeight / 2) / Math.tan(camera.fov * D2R / 2);
    const cn = [camE[0] / camR, camE[1] / camR, camE[2] / camR];
    const shown = this.shown = [];
    const want = [];
    const visit = t => {
      if (t.z > ROOTZ) {
        const ang = Math.acos(Math.max(-1, Math.min(1, cn[0] * t.nrm[0] + cn[1] * t.nrm[1] + cn[2] * t.nrm[2])));
        if (ang > horizon + t.rad / R + 0.02) return;
      }
      const d = Math.max(1, Math.hypot(camE[0] - t.ce[0], camE[1] - t.ce[1], camE[2] - t.ce[2]) - t.rad * 0.7);
      const px = t.sizeU / d * pxK;
      t.seen = this.frameNo;
      if (t.z < MAXZ && px > this.splitPx) {
        const kids = [];
        for (let k = 0; k < 4; k++) kids.push(this.tile(t.z + 1, t.x * 2 + (k & 1), t.y * 2 + (k >> 1)));
        let ready = true;
        for (const c of kids) { c.seen = this.frameNo; if (c.state !== 'ready') { ready = false; if (c.state === 'new') want.push([c, d / t.sizeU + c.z * 0.01]); } }
        if (ready) { for (const c of kids) visit(c); return; }
      }
      shown.push(t);
    };
    const n = 2 ** ROOTZ;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) visit(this.tiles.get(ROOTZ + '/' + x + '/' + y));
    for (const t of this.tiles.values()) if (t.group) t.group.visible = false;
    for (const t of shown) if (t.group) t.group.visible = true;
    // Laden: zuerst grobe und nahe Kacheln
    want.sort((a, b) => a[1] - b[1]);
    for (const [t] of want) { if (this.busy >= this.maxBusy) break; this.load(t); }
    // Aufräumen (seit 27.10.2026 nach Abstürzen): Grafikspeicher der Bodenkacheln unter einem festen Budget halten (Desktop
    // rund 550 MB, Handy 220 MB), die am längsten nicht gesehenen zuerst; leere Platzhalter nach einer Weile vergessen
    if (this.frameNo % 20 === 0) {
      const budget = this.coarse ? 220e6 : 550e6;
      if (this.gpuBytes > budget || this.tiles.size > 900) {
        const old = [...this.tiles.values()].filter(t => !t.keep && t.state === 'ready' && this.frameNo - t.seen > 30).sort((a, b) => a.seen - b.seen);
        for (const t of old) { if (this.gpuBytes <= budget * 0.85 && this.tiles.size <= 800) break; this.dropTile(t); }
      }
      if (this.frameNo % 600 === 0) for (const t of [...this.tiles.values()]) if ((t.state === 'new' || t.state === 'fail' || t.state === 'gone') && !t.keep && this.frameNo - t.seen > 300) this.tiles.delete(t.key);
    }
    this.updateDetails(camera, target, alt);
    this.updateSpace(camera, alt);
    return alt;
  }

  // ---------- Stadtdetails ----------
  detailKey(z, x, y) { return 'd' + z + '/' + x + '/' + y; }
  updateDetails(camera, target, alt) {
    const [lon, lat] = this.lonLatOfWorld(target);
    // im Flug ist die Kamera nah am Flugzeug, der Boden aber weit unten: dann zählt die Höhe
    const dist = Math.max(camera.position.distanceTo(target), (this.alt || 0) * 1.1);
    const wantD = new Map();
    if (dist < 420) {
      const [cx, cy] = tileAt(14, lon, lat), r = dist < 160 ? this.detailRing : 1;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) wantD.set(this.detailKey(14, cx + dx, cy + dy), [14, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy))]);
      this.nearRect = [cx - r, cy - r, cx + r, cy + r];
    } else this.nearRect = null;
    if (dist < 1400 && !this.coarse) {
      const [fx, fy] = tileAt(13, lon, lat);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) wantD.set(this.detailKey(13, fx + dx, fy + dy), [13, fx + dx, fy + dy, 9]);
    }
    for (const [key, [z, x, y, ring]] of wantD) {
      let d = this.details.get(key);
      if (!d) { d = this.newDetail(z, x, y); this.details.set(key, d); }
      d.ring = ring; d.seen = this.frameNo;
    }
    for (const d of [...this.details.values()]) {
      if (!wantD.has(d.key)) { if (this.frameNo - d.seen > 90) this.dropDetail(d); else if (d.group) d.group.visible = false; continue; }
      if (d.group) {
        d.group.visible = true;
        if (d.bld && d.z === 14) d.bld.geometry.setDrawRange(0, d.ring <= 1 ? Infinity : d.bigTris * 3);
        if (d.bld) d.bld.castShadow = d.z === 14 && d.ring <= 1 && dist < 260;
        d.Mw.copy(d.group.matrixWorld);
      }
    }
    // Fernsicht: im Bereich der nahen Kacheln ausblenden (Rechteck in Weltkoordinaten)
    if (this.nearRect) {
      const [x0, y0, x1, y1] = this.nearRect, n2 = 2 ** 14;
      const a = this.worldOf(lonOfX(x0 / n2), latOfY(y0 / n2)), b = this.worldOf(lonOfX((x1 + 1) / n2), latOfY((y1 + 1) / n2));
      CU.uNear.value.set(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z));
    } else CU.uNear.value.set(1e9, 1e9, -1e9, -1e9);
    const pend = [...this.details.values()].filter(d => d.state === 'new').sort((a, b) => (a.z === 14 ? 0 : 100) + a.ring - ((b.z === 14 ? 0 : 100) + b.ring));
    for (const d of pend) { if (this.busy >= this.maxBusy + 1) break; this.loadDetail(d); }
    this.updateLandmarks(lon, lat, dist);
    this.updateNearTrees(target, dist);
    this.updateNearCover(target, dist);
  }
  // Einfache Form eines Kachelbaums zeigen oder (unter einem vollen Baum) ausblenden
  loTree(d, i, hide) {
    const T = d.trees, k = T[i * 5 + 3], sc = hide ? 0 : k * (T[i * 5 + 4] === 2 ? 0.8 : 1), m = this._lm || (this._lm = new THREE.Matrix4());
    m.compose(new THREE.Vector3(T[i * 5], T[i * 5 + 1] - 0.03, T[i * 5 + 2]), new THREE.Quaternion().setFromAxisAngle(UPV, i * 2.39996), new THREE.Vector3(sc, sc, sc));
    const sl = d.lo.slot[i], M = sl >= 0 ? d.lo.cr : d.lo.cp;
    M.setMatrixAt(sl >= 0 ? sl : -sl - 1, m); d.lo.tr.setMatrixAt(i, m);
    M.instanceMatrix.needsUpdate = true; d.lo.tr.instanceMatrix.needsUpdate = true;
  }
  restoreLo() { for (const [d, i] of this.loHidden || []) if (d.group && d.lo) this.loTree(d, i, false); this.loHidden = []; }
  // Bodendecker und Stadtmöbel nahe am Blick (seit 27.10.2026): Grasbüschel, Lupinen, Margeriten und Büsche der Inselwelt
  // auf Wiesen und in Parks, Laternen an den Straßen (leuchten nachts), Bänke an den Fußwegen. Gestreut im Worker
  // (city/build.js), hier nur im Umkreis gesammelt, wenn der Blick wandert.
  updateNearCover(target, dist) {
    const co = this.coarse;
    if (!this.cov) {
      const mk = (g, mat, n, cast, colored = true) => { const M = new THREE.InstancedMesh(g, mat, n); M.count = 0; M.frustumCulled = false; M.castShadow = cast; M.receiveShadow = true; M.instanceMatrix.setUsage(THREE.DynamicDrawUsage); if (colored) M.setColorAt(0, new THREE.Color(1, 1, 1)); this.stage.scene.add(M); return M; };
      const grassMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), { sway: 0.5, upN: 1 });
      const flowerMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), { sway: 0.5 });
      this.glassMat = new THREE.MeshStandardMaterial({ color: '#fff2c8', emissive: '#ffc46a', emissiveIntensity: 0, roughness: 0.3 });
      const cap = co ? [6000, 800, 800, 500, 400, 200] : [24000, 3000, 3000, 1500, 1200, 600];
      this.cov = {
        cap, at: new THREE.Vector3(1e9, 0, 0), R: 0,
        m: [mk(tuftGeo(), grassMat, cap[0], false), mk(lupineGeo(), flowerMat, cap[1], false), mk(daisyGeo(), flowerMat, cap[2], false), mk(crownGeo(5, 'bush', true), this.treeMat.crown, cap[3], true)],
        lamp: mk(lanternGeo(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 }), cap[4], true, false),
        glass: mk(lanternGlassGeo(), this.glassMat, cap[4], false, false),
        bench: mk(benchGeo(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), cap[5], true, false),
      };
    }
    const V = this.cov, all = [...V.m, V.lamp, V.glass, V.bench];
    this.glassMat.emissiveIntensity = CU.uNight.value * 2.2;
    if (dist > 260) { if (V.at.x < 1e8) { for (const M of all) M.count = 0; V.at.set(1e9, 0, 0); } return; }
    const Rc = Math.min(28, 10 + dist * 0.6), Rp = Math.min(70, 25 + dist), Rg = Math.min(13, 5 + dist * 0.45);
    if (!this.coverDirty && !this.nearDirty && V.at.distanceTo(target) < Math.min(Rc, Rg) * 0.22 && Math.abs(V.R - Rc) < Rc * 0.25 && this.frameNo % 60) return;
    this.coverDirty = false; V.at.copy(target); V.R = Rc;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), v = new THREE.Vector3();
    const n = [0, 0, 0, 0], nl = [0, 0];
    const SC = [0.38, 0.4, 0.36, 0.3], PAL = [TUFTS, LUPINS, DAISIES, GREENS];
    const showCover = dist < 160, showGrass = dist < 70, inv = new THREE.Matrix4();
    for (const d of this.details.values()) {
      if (d.state !== 'ready' || d.z !== 14 || !d.group || !d.group.visible) continue;
      v.set(0, 0, 0).applyMatrix4(d.Mw);
      const dc = Math.hypot(v.x - target.x, v.z - target.z), e = d.Mw.elements;
      const W = (x, y, z) => p.set(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
      // Gras und Blumen aus der Graskarte, Zelle für Zelle um den Blick (fest je Zelle, darum kein Flimmern beim Wandern)
      if (showGrass && d.gmask && dc < Rg + 190) {
        const [gx0, gz0, cell, GN] = d.gmeta, G = d.gmask, H = d.gelev, Tz = cell * GN;
        const lt = v.copy(target).applyMatrix4(inv.copy(d.Mw).invert());
        const ax = Math.max(0, Math.floor((lt.x - Rg - gx0) / cell)), bx = Math.min(GN - 1, Math.ceil((lt.x + Rg - gx0) / cell));
        const az = Math.max(0, Math.floor((lt.z - Rg - gz0) / cell)), bz = Math.min(GN - 1, Math.ceil((lt.z + Rg - gz0) / cell));
        const tx = lt.x, tz = lt.z;
        for (let gz = az; gz <= bz; gz++) for (let gx = ax; gx <= bx; gx++) {
          const val = G[gz * GN + gx]; if (!val) continue;
          const h1 = hh(gx, gz, d.x), h2 = hh(gz, gx, d.y);
          if (val === 3 && h1 > 0.45) continue;
          const lx = gx0 + (gx + h1) * cell, lz = gz0 + (gz + h2) * cell;
          const dd2 = (lx - tx) ** 2 + (lz - tz) ** 2;
          if (dd2 > Rg * Rg) continue;
          const fu = (lx - gx0) / Tz * 32, fv = (lz - gz0) / Tz * 32, i0 = Math.min(31, Math.max(0, fu | 0)), j0 = Math.min(31, Math.max(0, fv | 0)), ku = fu - i0, kv = fv - j0;
          const ly = H[j0 * 33 + i0] * (1 - ku) * (1 - kv) + H[j0 * 33 + i0 + 1] * ku * (1 - kv) + H[(j0 + 1) * 33 + i0] * (1 - ku) * kv + H[(j0 + 1) * 33 + i0 + 1] * ku * kv;
          const h3 = hh(gx + 7, gz + 3, d.x + d.y);
          const k = val === 2 && h3 < 0.07 ? (h3 < 0.03 ? 1 : 2) : 0;
          if (n[k] >= V.cap[k]) continue;
          W(lx, ly - 0.01, lz);
          // zum Rand hin kleiner, damit kein harter Kreis entsteht
          const sc = SC[k] * (0.7 + h2 * 0.6) * Math.min(1, (Rg - Math.sqrt(dd2)) / (Rg * 0.3));
          q.setFromAxisAngle(UPV, h3 * 40); s.set(sc, sc * (k === 0 ? 0.75 + h1 * 0.5 : 1), sc); m.compose(p, q, s);
          V.m[k].setMatrixAt(n[k], m); V.m[k].setColorAt(n[k], c.copy(PAL[k][((h1 * 97) | 0) % PAL[k].length]));
          n[k]++;
        }
      }
      if (showCover && d.cover && dc < Rc + 190) {
        const C = d.cover;
        for (let i = 0; i < C.length; i += 6) {
          const k = C[i + 3]; if (n[k] >= V.cap[k]) continue;
          W(C[i], C[i + 1], C[i + 2]);
          if (Math.abs(p.x - target.x) > Rc || Math.abs(p.z - target.z) > Rc || Math.hypot(p.x - target.x, p.z - target.z) > Rc) continue;
          const sc = SC[k] * C[i + 4];
          q.setFromAxisAngle(UPV, C[i + 5]); s.set(sc, sc * (k === 0 ? 0.8 + (C[i + 4] - 0.7) * 0.6 : 1), sc); p.y -= 0.01; m.compose(p, q, s);
          V.m[k].setMatrixAt(n[k], m); V.m[k].setColorAt(n[k], c.copy(PAL[k][(i / 6 | 0) % PAL[k].length]));
          n[k]++;
        }
      }
      if (d.props && dc < Rp + 190) {
        const P = d.props;
        for (let i = 0; i < P.length; i += 5) {
          const k = P[i + 3]; if (k < 0) continue;
          if (k === 0 ? nl[0] >= V.cap[4] : nl[1] >= V.cap[5]) continue;
          W(P[i], P[i + 1], P[i + 2]);
          if (Math.hypot(p.x - target.x, p.z - target.z) > Rp) continue;
          q.setFromAxisAngle(UPV, P[i + 4]); s.set(1, 1, 1); p.y -= 0.005; m.compose(p, q, s);
          if (k === 0) { V.lamp.setMatrixAt(nl[0], m); V.glass.setMatrixAt(nl[0], m); nl[0]++; }
          else { V.bench.setMatrixAt(nl[1], m); nl[1]++; }
        }
      }
    }
    V.m.forEach((M, k) => { M.count = n[k]; });
    V.lamp.count = V.glass.count = nl[0]; V.bench.count = nl[1];
    for (const M of all) { M.instanceMatrix.needsUpdate = true; if (M.instanceColor) M.instanceColor.needsUpdate = true; }
  }
  // Volle Bäume nahe am Blick (seit 27.10.2026): Ballenkronen und Kegelkiefern der Inselwelt für die Bäume der Kacheln im
  // Umkreis, neu gesammelt, wenn der Blick ein Stück wandert oder der Ursprung neu liegt. Die einfachen Formen der Kachel
  // stecken innen drin und bleiben, so gibt es kein Aufploppen.
  updateNearTrees(target, dist) {
    const maxN = this.coarse ? 450 : 1600;
    if (!this.near) {
      const mk = (g, mat) => { const M = new THREE.InstancedMesh(g, mat, maxN); M.count = 0; M.frustumCulled = false; M.castShadow = true; M.receiveShadow = true; M.instanceMatrix.setUsage(THREE.DynamicDrawUsage); M.setColorAt(0, new THREE.Color(1, 1, 1)); this.stage.scene.add(M); return M; };
      this.near = { a: mk(this.treeGeo.hi, this.treeMat.crown), b: mk(this.treeGeo.hi2, this.treeMat.crown), p: mk(this.treeGeo.pine, this.treeMat.crown), t: mk(this.treeGeo.hiTrunk, this.treeMat.trunk), tp: mk(this.treeGeo.pineTrunk, this.treeMat.trunk), at: new THREE.Vector3(1e9, 0, 0), R: 0 };
    }
    const N = this.near, all = [N.a, N.b, N.p, N.t, N.tp];
    if (dist > 230) { if (N.a.count || N.b.count || N.p.count) { for (const M of all) M.count = 0; N.at.set(1e9, 0, 0); this.restoreLo(); } return; }
    const R = Math.min(75, 20 + dist * 0.9);
    if (!this.nearDirty && N.at.distanceTo(target) < R * 0.18 && Math.abs(N.R - R) < R * 0.25 && this.frameNo % 45) return;
    this.nearDirty = false; N.at.copy(target); N.R = R;
    const list = [], v = new THREE.Vector3();
    for (const d of this.details.values()) {
      if (d.state !== 'ready' || d.z !== 14 || !d.trees || !d.group || !d.group.visible) continue;
      v.set(0, 0, 0).applyMatrix4(d.Mw);
      if (Math.hypot(v.x - target.x, v.z - target.z) > R + 190) continue;
      const T = d.trees, n = T.length / 5, e = d.Mw.elements;
      for (let i = 0; i < n; i++) {
        const x = T[i * 5], y = T[i * 5 + 1], z = T[i * 5 + 2];
        const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
        const dd = Math.hypot(wx - target.x, wz - target.z);
        if (dd > R) continue;
        list.push([dd, wx, e[1] * x + e[5] * y + e[9] * z + e[13], wz, T[i * 5 + 3], T[i * 5 + 4], i, d.pineK || 0, d]);
      }
    }
    list.sort((a, b) => a[0] - b[0]);
    if (list.length > maxN) list.length = maxN;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    // Die einfachen Formen der Kachel unter den vollen Bäumen ausblenden (sonst schauen ihre Kanten durch), die vom letzten
    // Mal wieder zeigen
    this.restoreLo();
    for (const it of list) if (it[8] && it[8].lo) { this.loTree(it[8], it[6], true); this.loHidden.push([it[8], it[6]]); }
    let na = 0, nb = 0, np = 0, nt = 0, ntp = 0;
    for (const [, x, y, z, k, kind, i, pineK] of list) {
      const sc = k * (kind === 2 ? 0.8 : 1), pine = kind === 0 && ((i * 2654435761) >>> 0) / 4294967296 < pineK;
      q.setFromAxisAngle(UPV, i * 2.39996); p.set(x, y - 0.03, z); s.set(sc, sc, sc); m.compose(p, q, s);
      if (pine) { N.p.setMatrixAt(np, m); N.p.setColorAt(np++, c.copy(PINES[i % PINES.length])); N.tp.setMatrixAt(ntp++, m); }
      else {
        const M = i & 1 ? N.b : N.a, j = i & 1 ? nb++ : na++;
        M.setMatrixAt(j, m); M.setColorAt(j, c.copy(GREENS[(i * 7) % GREENS.length]).multiplyScalar(0.92 + ((i * 13) % 10) / 60));
        N.t.setMatrixAt(nt++, m);
      }
    }
    N.a.count = na; N.b.count = nb; N.p.count = np; N.t.count = nt; N.tp.count = ntp;
    for (const M of all) { M.instanceMatrix.needsUpdate = true; if (M.instanceColor) M.instanceColor.needsUpdate = true; }
  }
  newDetail(z, x, y) {
    const [lon, lat] = tileCenter(z, x, y), F = frame(lon, lat);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...F.E), new THREE.Vector3(...F.U), new THREE.Vector3(...F.S)));
    return { key: this.detailKey(z, x, y), z, x, y, lon, lat, ce: ecef(lon, lat, 0), q, state: 'new', seen: this.frameNo, Mw: new THREE.Matrix4(), ring: 9 };
  }
  loadDetail(d) {
    d.state = 'load'; this.busy++;
    const id = this.reqId++;
    this.cb.set(id, msg => {
      this.busy--;
      if (!this.details.has(d.key)) return;
      if (!msg.ok) { d.state = 'fail'; setTimeout(() => { if (d.state === 'fail') d.state = 'new'; }, 4000); return; }
      this.makeDetail(d, msg.out);
    });
    this.workerFor(d.z, d.x, d.y).postMessage({ type: 'detail', id, z: d.z, x: d.x, y: d.y, far: d.z < 14, style: this.style || 'eu', lang: this.lang || 'de' });
  }
  makeDetail(d, o) {
    const far = d.z < 14;
    d.group = new THREE.Group();
    const add = (m, shadow) => { m.receiveShadow = !far; m.castShadow = !!shadow; m.matrixAutoUpdate = false; d.group.add(m); if (far) this.stage.noAO.add(m); return m; };
    const up = n => { const a = new Float32Array(n * 3); for (let i = 1; i < a.length; i += 3) a[i] = 1; return a; };
    if (o.bld.pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(o.bld.pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(o.bld.nrm, 4, true));
      g.setAttribute('color', new THREE.BufferAttribute(o.bld.col, 4, true));
      g.setAttribute('aB', new THREE.BufferAttribute(o.bld.attr, 4));
      if (o.bld.wall) g.setAttribute('aW', new THREE.BufferAttribute(o.bld.wall, 2));
      g.setIndex(new THREE.BufferAttribute(o.bld.index, 1));
      g.computeBoundingSphere();
      // Kopien nach dem Hochladen freigeben, die Positionen bleiben (Wahrzeichen räumen Gebäude darunter frei)
      for (const [k, a] of Object.entries(g.attributes)) if (k !== 'position') a.onUpload(FREE);
      g.index.onUpload(FREE);
      d.bld = add(new THREE.Mesh(g, far ? this.mats.farBld : this.mats.bld), !far);
      d.bigTris = o.bigTris; d.bldList = o.bldList;
    }
    const strip = (pos, attr) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aR', new THREE.BufferAttribute(attr, 4)); g.setAttribute('normal', new THREE.BufferAttribute(up(pos.length / 3), 3)); g.computeBoundingSphere(); for (const a of Object.values(g.attributes)) a.onUpload(FREE); return g; };
    if (o.walkway.pos.length) add(new THREE.Mesh(strip(o.walkway.pos, o.walkway.attr), far ? this.mats.farRoad : this.mats.road));
    if (o.rail.pos.length) add(new THREE.Mesh(strip(o.rail.pos, o.rail.attr), far ? this.mats.farRoad : this.mats.road));
    if (o.road.pos.length) add(new THREE.Mesh(strip(o.road.pos, o.road.attr), far ? this.mats.farRoad : this.mats.road));
    const nT = o.trees.length / 5;
    if (nT && !far) {
      // je Kachel einfache Kronen (Kiefern im Wald des Nordens), nahe am Blick legt updateNearTrees die vollen darüber
      const pineK = Math.max(0, Math.min(0.85, (Math.abs(d.lat) - 45) / 18));
      const isPine = (i, kind) => kind === 0 && ((i * 2654435761) >>> 0) / 4294967296 < pineK;
      let nP = 0; for (let i = 0; i < nT; i++) if (isPine(i, o.trees[i * 5 + 4])) nP++;
      const cr = new THREE.InstancedMesh(this.treeGeo.lo, this.treeMat.crown, Math.max(1, nT - nP)), cp = new THREE.InstancedMesh(this.treeGeo.loPine, this.treeMat.crown, Math.max(1, nP)), tr = new THREE.InstancedMesh(this.treeGeo.trunk, this.treeMat.trunk, nT);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
      let a = 0, b = 0;
      const slot = new Int32Array(nT);
      for (let i = 0; i < nT; i++) {
        const x = o.trees[i * 5], y = o.trees[i * 5 + 1], z = o.trees[i * 5 + 2], k = o.trees[i * 5 + 3], kind = o.trees[i * 5 + 4];
        const sc = k * (kind === 2 ? 0.8 : 1), pine = isPine(i, kind);
        q.setFromAxisAngle(UPV, i * 2.39996);
        p.set(x, y - 0.03, z); s.set(sc, sc, sc); m.compose(p, q, s);
        tr.setMatrixAt(i, m);
        if (pine) { slot[i] = -(b + 1); cp.setMatrixAt(b, m); cp.setColorAt(b++, c.copy(PINES[i % PINES.length])); }
        else { slot[i] = a; cr.setMatrixAt(a, m); cr.setColorAt(a++, c.copy(GREENS[(i * 7) % GREENS.length]).multiplyScalar(0.92 + ((i * 13) % 10) / 60)); }
      }
      cr.count = a; cp.count = b;
      for (const M of [cr, cp, tr]) { M.instanceMatrix.needsUpdate = true; if (M.instanceColor) M.instanceColor.needsUpdate = true; M.computeBoundingSphere(); }
      add(cr, true); if (b) add(cp, true); add(tr, false);
      d.trees = o.trees; d.pineK = pineK; d.lo = { cr, cp, tr, slot };
    }
    d.data = { walk: o.walk || [], drive: o.drive || [], labels: o.labels || [] };
    this.root.add(d.group);
    this.place(d);
    d.Mw.copy(d.group.matrixWorld);
    d.state = 'ready';
    if (d.trees) this.nearDirty = true;
    d.cover = o.cover || null; d.props = o.props || null; d.gmask = o.gmask || null; d.gmeta = o.gmeta || null; d.gelev = o.gelev || null;
    if (d.cover || d.props) this.coverDirty = true;
    for (const L of this.landmarks) if (L.placed) this.landmarkTile(L, d);
  }
  dropDetail(d) {
    if (d.group) { this.root.remove(d.group); for (const m of d.group.children) { this.stage.noAO.delete(m); if (m.isInstancedMesh) m.dispose(); else m.geometry.dispose(); } }
    d.Mw.dead = true; d.group = null; d.state = 'gone';
    this.details.delete(d.key);
  }

  // Wege für life.js (Paare [Weg, Matrix der Kachel])
  lifeLines(kind, target, r) {
    const out = [], v = new THREE.Vector3();
    for (const d of this.details.values()) {
      if (d.state !== 'ready' || d.z !== 14 || !d.group || !d.group.visible) continue;
      v.set(0, 0, 0).applyMatrix4(d.Mw);
      if (Math.hypot(v.x - target.x, v.z - target.z) > r + 160) continue;
      for (const l of d.data[kind]) out.push([l, d.Mw]);
    }
    return out;
  }
  // Namen der Viertel, Orte und Sehenswürdigkeiten nahe am Blick (Weltkoordinaten)
  labelsNear(target, max = 34) {
    const out = [], v = new THREE.Vector3();
    for (const d of this.details.values()) {
      if (d.state !== 'ready' || d.z !== 14 || !d.group || !d.group.visible) continue;
      for (const l of d.data.labels) { v.set(l.x, l.y || 0, l.z).applyMatrix4(d.Mw); out.push({ ...l, x: v.x, y: v.y, z: v.z }); }
    }
    for (const L of this.landmarks) if (L.group && L.group.visible) { L.group.getWorldPosition(v); out.push({ k: 'lm', name: this.lang === 'de' ? L.de : L.en, x: v.x, y: v.y + (L.h || 30) / UNIT, z: v.z, rank: 0 }); }
    out.sort((a, b) => (a.rank - b.rank) * 3 + (Math.hypot(a.x - target.x, a.z - target.z) - Math.hypot(b.x - target.x, b.z - target.z)) / 40);
    const seen = new Set(), res = [];
    for (const l of out) { if (seen.has(l.name)) continue; seen.add(l.name); res.push(l); if (res.length >= max) break; }
    return res;
  }

  // ---------- Wahrzeichen ----------
  setLandmarks(list) { this.allLandmarks = list || []; }
  async updateLandmarks(lon, lat, dist) {
    if (!this.allLandmarks || this.frameNo % 20) return;
    const near = dist < 2500 ? this.allLandmarks.filter(l => l.model && Math.abs(l.lat - lat) < 0.2 && Math.abs(l.lon - lon) < 0.3) : [];
    for (const L of this.landmarks) if (!near.includes(L.src) && L.group) { this.root.remove(L.group); L.group.traverse(m => m.geometry && m.geometry.dispose()); L.group = null; L.placed = false; }
    this.landmarks = this.landmarks.filter(L => L.group);
    const missing = near.filter(l => !this.landmarks.some(L => L.src === l));
    if (!missing.length) return;
    if (!this.landmarkLib) { try { this.landmarkLib = await import('../city/landmarks.js'); } catch { return; } }
    for (const l of missing) {
      let M = null;
      try { M = this.landmarkLib.buildLandmark(l.model); } catch (e) { console.warn('Wahrzeichen', l.model, e); }
      if (!M || !M.geo) continue;
      const F = frame(l.lon, l.lat), L = { src: l, model: l.model, lon: l.lon, lat: l.lat, h: l.h, de: l.de, en: l.en };
      L.ce = ecef(l.lon, l.lat, 0);
      L.q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...F.E), new THREE.Vector3(...F.U), new THREE.Vector3(...F.S)));
      L.group = new THREE.Group();
      const base = this.heightAt(l.lon, l.lat);
      const mesh = new THREE.Mesh(M.geo, this.mats.lm); mesh.scale.setScalar(1 / UNIT); mesh.position.y = base; mesh.castShadow = true; mesh.receiveShadow = true;
      L.group.add(mesh); L.mesh = mesh;
      if (M.glow) { const g = new THREE.Mesh(M.glow, this.mats.glow); g.scale.setScalar(1 / UNIT); g.position.y = base; L.group.add(g); L.glow = g; }
      // Freiräumen nur im eigenen Grundriss (große Brücken und die Pyramiden nicht mit vollem Radius)
      const big = Math.max(M.w || 0, M.d || 0);
      L.R = Math.min(big, 260) / (2 * UNIT) + 0.3;
      L.fixed = l.model === 'pyramiden_gizeh' || l.model === 'golden_gate' || l.model === 'rainbow_bridge' || l.model === 'harbour_bridge' || l.model === 'tower_bridge';
      this.root.add(L.group); this.place(L);
      L.placed = true;
      this.landmarks.push(L);
      for (const d of this.details.values()) if (d.state === 'ready') this.landmarkTile(L, d);
    }
  }
  landmarkTile(L, d) {
    if (!d.bldList || !d.bld) return;
    // Lage des Wahrzeichens in der Kachelebene
    const F = frame(d.lon, d.lat), p = toLocal(F, ecef(L.lon, L.lat, 0));
    const lx = p[0], lz = p[2], Ls = d.bldList, P = d.bld.geometry.attributes.position.array;
    if (Math.abs(lx) > 260 || Math.abs(lz) > 260) return;
    let best = 0, pts = null, dirty = false;
    for (let i = 0; i < Ls.length; i += 8) {
      const dd = Math.hypot(Ls[i] - lx, Ls[i + 1] - lz);
      if (dd > L.R) continue;
      const v0 = Ls[i + 6], vn = Ls[i + 7];
      if (!L.fixed && Ls[i + 3] > best && dd < L.R * 0.7) { best = Ls[i + 3]; pts = []; for (let k = v0 * 3; k < (v0 + vn) * 3; k += 3) pts.push(P[k], P[k + 2]); }
      for (let k = v0 * 3; k < (v0 + vn) * 3; k += 3) { P[k] = Ls[i]; P[k + 1] = -50; P[k + 2] = Ls[i + 1]; }
      dirty = true;
    }
    if (dirty) { d.bld.geometry.attributes.position.needsUpdate = true; d.bld.geometry.computeBoundingSphere(); }
    if (pts && pts.length >= 6 && !L.oriented && d.z === 14) {
      let mx = 0, mz = 0; const n = pts.length / 2;
      for (let i = 0; i < pts.length; i += 2) { mx += pts[i]; mz += pts[i + 1]; }
      mx /= n; mz /= n;
      let sxx = 0, szz = 0, sxz = 0;
      for (let i = 0; i < pts.length; i += 2) { const a = pts[i] - mx, b = pts[i + 1] - mz; sxx += a * a; szz += b * b; sxz += a * b; }
      const th = 0.5 * Math.atan2(2 * sxz, sxx - szz);
      L.mesh.rotation.y = -th; if (L.glow) L.glow.rotation.y = -th;
      L.oriented = true;
    }
  }

  // ---------- Weltraum: Atmosphäre, Polkappen, Stadtlichter ----------
  buildSpace() {
    // Atmosphärensaum: von außen gesehen ein blauer Lichtrand um die Kugel
    const atm = new THREE.Mesh(new THREE.SphereGeometry(R * 1.025, 96, 64), new THREE.ShaderMaterial({
      uniforms: { uSun: { value: new THREE.Vector3(1, 0, 0) }, uFade: { value: 1 } },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vWN;
        void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vWN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `uniform vec3 uSun; uniform float uFade; varying vec3 vN; varying vec3 vV; varying vec3 vWN;
        void main(){ float rim = pow(1.0 - abs(dot(normalize(vWN), normalize(vV))), 3.0);
          float lit = smoothstep(-0.25, 0.35, dot(normalize(vWN), normalize(uSun)));
          vec3 c = mix(vec3(0.25, 0.45, 0.95), vec3(0.6, 0.8, 1.0), rim) * (0.15 + lit);
          gl_FragColor = vec4(c, rim * uFade * (0.25 + lit * 0.75)); }`,
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    atm.renderOrder = -1; atm.frustumCulled = false;
    this.atm = atm; this.stage.scene.add(atm); this.stage.noAO.add(atm);
    // Polkappen ab 85,05 Grad (dort enden die Kacheln): Nordpolarmeer mit Eis, Antarktis
    this.caps = [];
    for (const [sgn, col] of [[1, '#e9f1f5'], [-1, '#f4f7f8']]) {
      const pole = ecef(0, 90 * sgn, sgn > 0 ? 0 : 280), pos = [], idx = [];
      pos.push(0, 0, 0);
      for (let i = 0; i <= 64; i++) { const p = ecef(i / 64 * 360 - 180, MAXLAT * sgn, sgn > 0 ? 0 : 150); pos.push(p[0] - pole[0], p[1] - pole[1], p[2] - pole[2]); }
      for (let i = 1; i <= 64; i++) idx.push(0, i, i + 1);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col, roughness: 0.9, side: THREE.DoubleSide }));
      m.userData.pole = pole; this.root.add(m); this.caps.push(m);
    }
    this.placeSpace();
  }
  placeSpace() {
    const o = this.F.o;
    for (const m of this.caps || []) m.position.set(m.userData.pole[0] - o[0], m.userData.pole[1] - o[1], m.userData.pole[2] - o[2]);
    if (this.atm) { const c = new THREE.Vector3(-o[0], -o[1], -o[2]).applyMatrix4(this.M); this.atm.position.copy(c); }
    if (this.lights) this.lights.position.set(-o[0], -o[1], -o[2]);
  }
  // Lichtpunkte aller Städte ab 30.000 Einwohnern, nur auf der Nachtseite (erdfeste Koordinaten)
  buildLights(cities) {
    const C = cities, pos = [], size = [];
    for (let i = 0; i < C.n; i++) {
      const p = Math.max(C.pop[i], C.metro[i] || 0); if (p < 30000) break;
      const e = ecef(C.lon[i], C.lat[i], 30); pos.push(e[0], e[1], e[2]); size.push(Math.min(7, 1.6 + Math.log10(p / 30000) * 2.2));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aS', new THREE.Float32BufferAttribute(size, 1));
    this.lightMat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: new THREE.Vector3(1, 0, 0) }, uFade: { value: 0 }, uPx: { value: 1 } },
      vertexShader: `attribute float aS; uniform vec3 uSun; uniform float uFade, uPx; varying float vA;
        void main(){ vec3 n = normalize(position); float night = smoothstep(0.08, -0.12, dot(n, uSun));
          vec4 mv = modelViewMatrix * vec4(position, 1.0); vec3 vdir = normalize(-mv.xyz); vec3 vn = normalize(normalMatrix * n);
          float facing = smoothstep(-0.05, 0.25, dot(vn, vdir));
          vA = night * uFade * facing; gl_PointSize = aS * uPx; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5 || vA < 0.01) discard;
        gl_FragColor = vec4(vec3(1.0, 0.82, 0.55) * (1.0 - d * 1.6), vA * (1.0 - d * 2.0)); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.lights = new THREE.Points(g, this.lightMat);
    this.lights.frustumCulled = false;
    this.root.add(this.lights); this.stage.noAO.add(this.lights);
    this.placeSpace();
  }
  updateSpace(camera, alt) {
    const sw = this.dirToWorld([this.sunEcef.x, this.sunEcef.y, this.sunEcef.z]);
    this.atm.material.uniforms.uSun.value.copy(sw);
    // nur von außerhalb der Hülle (159 km), darunter macht der Himmel die Luft
    this.atm.material.uniforms.uFade.value = THREE.MathUtils.smoothstep(alt, 16500, 60000);
    this.atm.visible = alt > 16500;
    if (this.lightMat) {
      this.lightMat.uniforms.uSun.value.copy(this.sunEcef);
      this.lightMat.uniforms.uFade.value = THREE.MathUtils.smoothstep(alt, 1500, 12000);
      this.lightMat.uniforms.uPx.value = Math.min(2, window.devicePixelRatio || 1);
    }
  }

  stats() {
    let shown = 0, load = 0, tris = 0, det = 0;
    for (const t of this.tiles.values()) { if (t.group && t.group.visible) { shown++; tris += t.mesh.geometry.index.count / 3; } if (t.state === 'load') load++; }
    for (const d of this.details.values()) if (d.state === 'ready' && d.group && d.group.visible) { det++; if (d.bld) tris += Math.min(d.bld.geometry.drawRange.count, d.bld.geometry.index.count) / 3; }
    return { tiles: this.tiles.size, shown, load, details: det, tris: Math.round(tris), alt: Math.round(this.alt || 0) };
  }
}
