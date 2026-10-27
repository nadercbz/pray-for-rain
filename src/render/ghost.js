// Geistmodus: Der Gott geht als Geist in dritter Person über die Insel. Die Menschen sehen ihn nicht,
// Tiere spüren ihn und weichen aus. Steuerung wie in Third-Person-Spielen (seit 19.10.2026): die Maus ist gesperrt und
// unsichtbar, jede Bewegung dreht die Kamera; W A S D gehen (immer von der Kamera aus), Shift rennt, Leertaste springt,
// in der Luft gehalten gleitet der Geist schnell (dabei durch Mauern), Mausrad zoomt, E sieht sich den nächsten
// Menschen an, Q wirkt die gewählte Kraft genau hier, Esc gibt die Maus frei, ein zweites Esc oder G beendet.
// Ohne Maussperre (geht sie nicht) schaut man per Ziehen um, geradeaus laufen dreht die Kamera hinter den Geist.
// Seit 19.10.2026: Wände nach dem echten Grundriss jedes Hauses (buildings.foot), Häuser vor der Kamera werden
// durchsichtig (buildings.seeThrough) statt dass die Kamera springt, Figur Fassung 2 mit 12.446 Dreiecken und weichen
// Normalen, nur die vorderste Schicht wird gezeichnet (Tiefe vorab) und GTAO lässt den Geist aus (stage.noAO).
// Figur: Higgsfield Meshy (assets/people/ghost.*, gebacken mit tools/bake_villagers.mjs assets/people/src/ghost.json),
// fehlt sie, leiht sich der Geist die Gestalt eines Dorfbewohners. Animationen werden weich überblendet.
import * as THREE from 'three';
import { NX, NY } from './scene.js';
import { groundY } from './terrain.js';
import { roadY } from './bridges.js';
import { Tracks } from './tracks.js';
import { L } from '../i18n.js';
import { POWER, BIOMES, DREAMS } from '../sim/data.js';

const HEIGHT = 0.2;            // etwas größer als die Menschen (0,18, people.js), seit 24.10.2026 (vorher 0,27)
// Tempo in Kacheln pro Sekunde: Gehen, Rennen (Shift), Gleiten (Leertaste). Die Beine folgen dem Tempo:
// die Animationen tragen bei Tempo 1 etwa 0,4 (Gehen) und 2 (Rennen) Körperlängen pro Sekunde
const WALK = 0.24, RUN = 0.8, GLIDE = 2.6;
// Sprung: Absprung in Kacheln pro Sekunde, Schwerkraft, Zeit in den Knien, Landung (im Stand), Gleithöhe.
// Etwa 0,17 hoch (zwei Drittel der Körpergröße) und 0,7 s in der Luft
const JUMP_V = 0.95, GRAV = 2.7, PRE_T = 0.13, LAND_T = 0.34, GLIDE_H = 0.12;
// Maus: Drehung je Pixel, Kamerawinkel von leicht unten bis steil von oben
const SENS = 0.0026, PMIN = -0.3, PMAX = 1.25;
const STRIDE = 0.4, RUN_STRIDE = 1.98;
// Zielen und Wirken (seit 19.10.2026, Naders Wunsch): Reichweite in Feldern, Farbe des Geschosses je Kraft
const AIM_R = 30;
const SHOT_COL = { regen: '#9fd2ff', sonne: '#ffd98a', sturm: '#b9c6d6', blitz: '#e8f4ff', schnee: '#f2f8ff', nebel: '#d9e2e6', regenbogen: '#ffc8ec',
  segen: '#b8f08a', fische: '#9ff0e0', beben: '#e0a868', vulkan: '#ff7a3a', flut: '#6fb8e8', meteor: '#ff9a4a',
  traum: '#d7b8ff', funke: '#ffe9a0', komet: '#bfe0ff', fremde: '#f0e0c0', heilung: '#fff2c0', seuche: '#b5d36a' };
const OPEN = new Set(['feld', 'zentrum', 'park']);   // begehbar (der Brunnen seit 19.10.2026 nicht mehr: man stand im Becken)
const VS_HEAD = `
uniform sampler2D uVat; uniform vec2 uVatSize; uniform float uTime;
uniform vec4 uA; uniform vec4 uB; uniform float uMix;
attribute float vid;
vec3 vatAt(float col, vec4 an) {
  float fr = fract(uTime * an.w + an.z) * an.y;
  float f0 = floor(fr), f1 = mod(f0 + 1.0, an.y), k = fr - f0;
  float x = (col + 0.5) / uVatSize.x;
  vec3 a = texture2D(uVat, vec2(x, (an.x + f0 + 0.5) / uVatSize.y)).xyz;
  vec3 b = texture2D(uVat, vec2(x, (an.x + f1 + 0.5) / uVatSize.y)).xyz;
  return mix(a, b, k);
}
vec3 ghostAt(float col) { return mix(vatAt(col, uA), vatAt(col, uB), uMix); }
#ifdef GHOST_SMOOTH
uniform sampler2D uNrm;
vec3 nrmAt(float col, vec4 an) {
  float fr = fract(uTime * an.w + an.z) * an.y;
  float f0 = floor(fr), f1 = mod(f0 + 1.0, an.y), k = fr - f0;
  float x = (col + 0.5) / uVatSize.x;
  vec3 a = texture2D(uNrm, vec2(x, (an.x + f0 + 0.5) / uVatSize.y)).xyz;
  vec3 b = texture2D(uNrm, vec2(x, (an.x + f1 + 0.5) / uVatSize.y)).xyz;
  return mix(a, b, k) * 2.0 - 1.0;
}
vec3 ghostNrm(float col) { return normalize(mix(nrmAt(col, uA), nrmAt(col, uB), uMix) + 1e-5); }
#endif
`;

// Runde Figur (seit 19.10.2026, Naders Wunsch "viel detailreicher, alles abgerundet"): jedes Dreieck der gebackenen Figur
// wird in 9 Teile geteilt und als gewölbte Bézier-Fläche aus Punkten und Normalen der drei Ecken berechnet (PN Triangles,
// Vlachos 2001), die Normalen quadratisch. Gleiche Kanten ergeben gleiche Kurven, also keine Risse.
const PN_HEAD = `
attribute vec3 cid; attribute vec2 bary;
vec3 pnPos; vec3 pnNrm;
void pnEval() {
  vec3 P1 = ghostAt(cid.x), P2 = ghostAt(cid.y), P3 = ghostAt(cid.z);
  vec3 N1 = ghostNrm(cid.x), N2 = ghostNrm(cid.y), N3 = ghostNrm(cid.z);
  float u = bary.x, v = bary.y, w = 1.0 - u - v;
  vec3 b210 = (2.0 * P1 + P2 - dot(P2 - P1, N1) * N1) / 3.0;
  vec3 b120 = (2.0 * P2 + P1 - dot(P1 - P2, N2) * N2) / 3.0;
  vec3 b021 = (2.0 * P2 + P3 - dot(P3 - P2, N2) * N2) / 3.0;
  vec3 b012 = (2.0 * P3 + P2 - dot(P2 - P3, N3) * N3) / 3.0;
  vec3 b102 = (2.0 * P3 + P1 - dot(P1 - P3, N3) * N3) / 3.0;
  vec3 b201 = (2.0 * P1 + P3 - dot(P3 - P1, N1) * N1) / 3.0;
  vec3 E = (b210 + b120 + b021 + b012 + b102 + b201) / 6.0, V = (P1 + P2 + P3) / 3.0;
  vec3 b111 = E + (E - V) * 0.5;
  pnPos = P1 * w * w * w + P2 * u * u * u + P3 * v * v * v
    + b210 * 3.0 * w * w * u + b120 * 3.0 * w * u * u + b201 * 3.0 * w * w * v
    + b021 * 3.0 * u * u * v + b102 * 3.0 * w * v * v + b012 * 3.0 * u * v * v + b111 * 6.0 * w * u * v;
  vec3 d12 = P2 - P1, d23 = P3 - P2, d31 = P1 - P3;
  vec3 n110 = normalize(N1 + N2 - 2.0 * dot(d12, N1 + N2) / max(dot(d12, d12), 1e-9) * d12 + 1e-6);
  vec3 n011 = normalize(N2 + N3 - 2.0 * dot(d23, N2 + N3) / max(dot(d23, d23), 1e-9) * d23 + 1e-6);
  vec3 n101 = normalize(N3 + N1 - 2.0 * dot(d31, N3 + N1) / max(dot(d31, d31), 1e-9) * d31 + 1e-6);
  pnNrm = normalize(N1 * w * w + N2 * u * u + N3 * v * v + n110 * w * u + n011 * u * v + n101 * w * v + 1e-6);
}
`;
const TESS = 3;   // Teilung je Dreieckskante

// Unterteilte Geometrie: je Dreieck ein Gitter mit Schwerpunktkoordinaten, die Ecken zeigen auf die gebackenen Punkte
function tessellate(index, vids, uvs, L) {
  const nT = index.length / 3, vpt = (L + 1) * (L + 2) / 2;
  const cid = new Float32Array(nT * vpt * 3), bary = new Float32Array(nT * vpt * 2), uv = new Float32Array(nT * vpt * 2);
  const ind = new Uint32Array(nT * L * L * 3);
  const at = (r, c) => r * (L + 1) - (r * (r - 1)) / 2 + c;   // Zeile r hat L + 1 - r Punkte
  let n = 0;
  for (let t = 0; t < nT; t++) {
    const i0 = index[t * 3], i1 = index[t * 3 + 1], i2 = index[t * 3 + 2], base = t * vpt;
    for (let r = 0; r <= L; r++) for (let c = 0; c <= L - r; c++) {
      const k = base + at(r, c), u = c / L, v = r / L, w = 1 - u - v;
      cid[k * 3] = vids[i0]; cid[k * 3 + 1] = vids[i1]; cid[k * 3 + 2] = vids[i2];
      bary[k * 2] = u; bary[k * 2 + 1] = v;
      uv[k * 2] = uvs[i0 * 2] * w + uvs[i1 * 2] * u + uvs[i2 * 2] * v;
      uv[k * 2 + 1] = uvs[i0 * 2 + 1] * w + uvs[i1 * 2 + 1] * u + uvs[i2 * 2 + 1] * v;
    }
    for (let r = 0; r < L; r++) for (let c = 0; c < L - r; c++) {
      ind[n++] = base + at(r, c); ind[n++] = base + at(r, c + 1); ind[n++] = base + at(r + 1, c);
      if (c < L - r - 1) { ind[n++] = base + at(r, c + 1); ind[n++] = base + at(r + 1, c + 1); ind[n++] = base + at(r + 1, c); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cid.length), 3));
  g.setAttribute('cid', new THREE.BufferAttribute(cid, 3));
  g.setAttribute('bary', new THREE.BufferAttribute(bary, 2));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(ind.subarray(0, n), 1));
  return g;
}

export class Ghost {
  constructor(stage, app) {
    this.stage = stage; this.app = app;
    this.active = false; this.ready = false;
    this.pos = new THREE.Vector3(); this.yaw = 0; this.speed = 0;
    this.camYaw = 0; this.camPitch = 0.3; this.dist = 1.3; this.lastDrag = 0;
    this.keys = new Set();
    this.uni = { uVat: { value: null }, uNrm: { value: null }, uVatSize: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
      uA: { value: new THREE.Vector4() }, uB: { value: new THREE.Vector4() }, uMix: { value: 0 }, uGlow: { value: 1 } };
    this.cur = 'idle'; this.prev = 'idle'; this.mixT = 1; this.castUntil = 0;
    this.group = new THREE.Group();
    this.group.visible = false;
    stage.scene.add(this.group);
    this.tracks = new Tracks(stage.scene); this.stepD = 0; this.stepSide = 1; // Fußspuren in Sand und Schnee (render/tracks.js)
    // Licht, das mit dem Geist wandert: nachts sieht man seinen Schein auf Gras und Mauern
    this.light = new THREE.PointLight(0xbfe9ff, 0, 4.5, 1.6);
    this.light.position.set(0, 0.35, 0);
    this.group.add(this.light);
    // weicher Lichtfleck am Boden
    const halo = new THREE.Mesh(new THREE.CircleGeometry(0.42, 40).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uT: this.uni.uTime },
      vertexShader: 'varying vec2 vU; void main(){ vU = position.xz / 0.42; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec2 vU; uniform float uT; void main(){ float r = length(vU); float a = smoothstep(1.0, 0.0, r) * (0.32 + 0.06 * sin(uT * 2.0)); gl_FragColor = vec4(vec3(0.75, 0.92, 1.0) * a, a); }',
    }));
    halo.renderOrder = 2;
    this.halo = halo;
    stage.scene.add(halo);
    halo.visible = false;
    // nicht in die Umgebungsverdeckung (sonst eine zweite, graue Figur in Ruhepose, siehe scene.js)
    if (stage.noAO) stage.noAO.add(halo);   // die Figur selbst kommt mit echter Pose in die Umgebungsverdeckung (aoProxy)
    this.tags = document.createElement('div');
    this.tags.id = 'ghostTags';
    document.body.append(this.tags);
    this.help = document.createElement('div');
    this.help.id = 'ghostHelp';
    this.help.innerHTML = L('<b>W A S D</b> gehen · <b>Maus</b> umsehen · <b>Shift</b> rennen · <b>Leertaste</b> springen, halten gleitet (auch durch Mauern) · <b>1 bis 9</b> Karte · <b>Tab</b> Reihe · <b>Linke Maus</b> wirken · <b>Rechte Maus</b> ablegen · <b>E</b> Mensch ansehen · <b>Esc</b> Maus frei · <b>G</b> zurück in den Himmel',
      '<b>W A S D</b> walk · <b>Mouse</b> look around · <b>Shift</b> run · <b>Space</b> jump, hold to glide (even through walls) · <b>1 to 9</b> card · <b>Tab</b> row · <b>Left click</b> cast · <b>Right click</b> put away · <b>E</b> look at person · <b>Esc</b> free the mouse · <b>G</b> back to the sky');
    document.body.append(this.help);
    this.prompt = document.createElement('div');
    this.prompt.id = 'ghostPrompt';
    document.body.append(this.prompt);
    // Fadenkreuz im Stil des Spiels: Creme und Gold, vier Bögen, in der Mitte ein kleiner Regentropfen wie im Logo.
    // Mit gewählter Karte nimmt es die Farbe der Kraft an und dreht sich langsam, darunter steht Kraft und Ziel.
    this.reticle = document.createElement('div');
    this.reticle.id = 'ghostAim';
    this.reticle.innerHTML = `<svg viewBox="-24 -24 48 48" aria-hidden="true">
      <circle class="halo" r="15"/>
      <g class="ring"><circle r="15" pathLength="96" stroke-dasharray="18 6" stroke-dashoffset="-3"/></g>
      <path class="ticks" d="M0 -22.5V-18.5M0 22.5V18.5M-22.5 0H-18.5M22.5 0H18.5"/>
      <path class="drop" d="M0 -4.6C2 -1.8 3 -0.2 3 1.3A3 3 0 0 1 -3 1.3C-3 -0.2 -2 -1.8 0 -4.6Z"/>
    </svg><div class="lbl"></div>`;
    document.body.append(this.reticle);
    this.aimLbl = this.reticle.querySelector('.lbl');
    this.aim = { ok: false, point: new THREE.Vector3(), pid: null, x: 0, y: 0, t: 0 };
    // Zielring am Boden in der Größe der Kraft (folgt dem Gelände)
    const SEG = 72;
    this.ringSeg = SEG;
    this.ringPos = new Float32Array((SEG + 1) * 2 * 3);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.ringPos, 3).setUsage(THREE.DynamicDrawUsage));
    const ri = [];
    for (let k = 0; k < SEG; k++) { const a = k * 2; ri.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    rg.setIndex(ri);
    this.ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false }));
    this.ring.frustumCulled = false; this.ring.visible = false; this.ring.renderOrder = 6;
    stage.scene.add(this.ring);
    if (stage.noAO) stage.noAO.add(this.ring);
    this.shots = [];
    this.shotGeo = new THREE.SphereGeometry(0.05, 16, 12);
    this.shotReady = 0; this.shotUntil = 0; this.shotT = -9;
    this.bind();
  }

  async load() {
    for (const name of ['ghost', 'villager_m1']) {
      try { await this.loadFigure(name); this.figure = name; this.ready = true; return; } catch (e) { /* nächste Gestalt */ }
    }
  }

  async loadFigure(name) {
    const [meta, bin] = await Promise.all([
      fetch(`assets/people/${name}.json`).then(r => { if (!r.ok) throw new Error(name); return r.json(); }),
      fetch(`assets/people/${name}.bin`).then(r => { if (!r.ok) throw new Error(name); return r.arrayBuffer(); }),
    ]);
    const { W, rows, layout, RV } = meta;
    this.clips = meta.clips;
    const index = new Uint16Array(bin, layout.index[0], layout.index[1]);
    const tex = new Uint16Array(bin, layout.tex[0], layout.tex[1]);
    const vids = new Uint16Array(bin, layout.vid[0], layout.vid[1]);
    const vat = new THREE.DataTexture(tex, W, rows, THREE.RGBAFormat, THREE.HalfFloatType);
    vat.magFilter = vat.minFilter = THREE.NearestFilter;
    vat.needsUpdate = true;
    this.uni.uVat.value = vat;
    this.uni.uVatSize.value.set(W, rows);
    const half = THREE.DataUtils.fromHalfFloat;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(RV * 3), vid = new Float32Array(RV);
    const r0 = (this.clips.idle || this.clips.walk).row;
    for (let u = 0; u < RV; u++) { const o = (r0 * W + vids[u]) * 4; pos.set([half(tex[o]), half(tex[o + 1]), half(tex[o + 2])], u * 3); vid[u] = vids[u]; }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(RV * 3).fill(0), 3));
    g.setAttribute('vid', new THREE.BufferAttribute(vid, 1));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(bin, layout.uv[0], layout.uv[1]).slice(), 2));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    // Weiche Normalen je Bild (seit 19.10.2026 mitgebacken), sonst flach schattiert wie früher
    const smooth = !!layout.nrm;
    if (smooth) {
      const nt = new THREE.DataTexture(new Uint8Array(bin, layout.nrm[0], layout.nrm[1]), W, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
      nt.magFilter = nt.minFilter = THREE.NearestFilter;
      nt.needsUpdate = true;
      this.uni.uNrm.value = nt;
    }
    const map = await new THREE.TextureLoader().loadAsync(`assets/people/${name}.webp`);
    map.colorSpace = THREE.SRGBColorSpace; map.flipY = false; map.anisotropy = 8;
    const uni = this.uni, defs = smooth ? '#define GHOST_SMOOTH\n' : '';
    const tess = smooth;   // runde Figur nur mit mitgebackenen Normalen
    const vatPatch = (sh, depthOnly = false) => {
      Object.assign(sh.uniforms, uni);
      if (tess) {
        let v = defs + VS_HEAD + PN_HEAD + 'varying float vH;\n' + sh.vertexShader;
        if (depthOnly) v = v.replace('#include <begin_vertex>', 'pnEval(); vec3 transformed = pnPos; vH = transformed.y;');
        else v = v.replace('#include <beginnormal_vertex>', 'pnEval(); vec3 objectNormal = pnNrm;').replace('#include <begin_vertex>', 'vec3 transformed = pnPos; vH = transformed.y;');
        sh.vertexShader = v;
        return;
      }
      let v = defs + VS_HEAD + 'varying float vH;\n' + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = ghostAt(vid); vH = transformed.y;');
      if (smooth) v = v.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = ghostNrm(vid);');
      sh.vertexShader = v;
    };
    // Seit 19.10.2026 abends (Naders Wunsch): eine richtige Spielfigur in dunkler Kleidung, die nicht leuchtet.
    // Undurchsichtig, normal beleuchtet, wirft einen echten Schatten (Tiefe mit derselben gebackenen Animation).
    // Farben aus tools/build_ghost_dark.py (Anthrazit, Schwarz, rote Akzente, Haut).
    const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.82, metalness: 0, flatShading: !smooth });
    mat.onBeforeCompile = sh => vatPatch(sh);
    mat.customProgramCacheKey = () => 'ghost-vat' + smooth + tess;
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = sh => vatPatch(sh, true);
    depth.customProgramCacheKey = () => 'ghost-vat-depth' + smooth + tess;
    for (const o of [this.mesh, this.pre, this.aura, this.aoProxy]) if (o) { this.group.remove(o); o.material.dispose(); if (this.stage.noAO) this.stage.noAO.delete(o); if (this.stage.aoOnly) this.stage.aoOnly.delete(o); }
    if (this.mesh) this.mesh.geometry.dispose();
    this.pre = null; this.aura = null; this.aoProxy = null;
    const geo = tess ? tessellate(index, vids, g.attributes.uv.array, TESS) : g;
    this.mesh = new THREE.Mesh(geo, mat);
    if (this.stage.noAO) this.stage.noAO.add(this.mesh);
    // Abbild für die Umgebungsverdeckung: die gebackene Pose im Prozessor (einfaches Netz, reicht für GTAO)
    if (smooth && this.stage.aoOnly) {
      const F = new Float32Array(rows * W * 3);
      for (let i = 0, n = rows * W; i < n; i++) { F[i * 3] = half(tex[i * 4]); F[i * 3 + 1] = half(tex[i * 4 + 1]); F[i * 3 + 2] = half(tex[i * 4 + 2]); }
      this.cpu = { F, N: new Uint8Array(bin, layout.nrm[0], layout.nrm[1]), W, vids, RV };
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RV * 3), 3).setUsage(THREE.DynamicDrawUsage));
      pg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(RV * 3), 3).setUsage(THREE.DynamicDrawUsage));
      pg.setIndex(new THREE.BufferAttribute(index, 1));
      this.aoProxy = new THREE.Mesh(pg, new THREE.MeshBasicMaterial());
      this.aoProxy.visible = false; this.aoProxy.frustumCulled = false; this.aoProxy.userData.aoOn = true;
      this.aoProxy.scale.setScalar(HEIGHT);
      this.group.add(this.aoProxy);
      this.stage.aoOnly.add(this.aoProxy);
    }
    this.mesh.customDepthMaterial = depth;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.scale.setScalar(HEIGHT);
    this.group.add(this.mesh);
    this.setAnim('idle', true);
  }

  clip(name) { return this.clips[name] || this.clips.idle || Object.values(this.clips)[0]; }

  // Dieselbe Pose wie im Shader (zwei Animationen, je zwei Bilder, überblendet), für das GTAO Abbild
  poseCPU() {
    const C = this.cpu, P = this.aoProxy;
    if (!C || !P) return;
    const t = this.uni.uTime.value, mx = this.uni.uMix.value;
    const fr = an => { const f = ((((t * an.w + an.z) % 1) + 1) % 1) * an.y, f0 = Math.floor(f); return [an.x + f0, an.x + (f0 + 1) % an.y, f - f0]; };
    const [a0, a1, ka] = fr(this.uni.uA.value), [b0, b1, kb] = fr(this.uni.uB.value);
    const { F, N, W, vids, RV } = C;
    const pos = P.geometry.attributes.position.array, nor = P.geometry.attributes.normal.array;
    const wa0 = (1 - ka) * (1 - mx), wa1 = ka * (1 - mx), wb0 = (1 - kb) * mx, wb1 = kb * mx;
    for (let u = 0; u < RV; u++) {
      const c = vids[u], A0 = (a0 * W + c), A1 = (a1 * W + c), B0 = (b0 * W + c), B1 = (b1 * W + c);
      for (let k = 0; k < 3; k++) {
        pos[u * 3 + k] = F[A0 * 3 + k] * wa0 + F[A1 * 3 + k] * wa1 + F[B0 * 3 + k] * wb0 + F[B1 * 3 + k] * wb1;
        nor[u * 3 + k] = ((N[A0 * 4 + k] * wa0 + N[A1 * 4 + k] * wa1 + N[B0 * 4 + k] * wb0 + N[B1 * 4 + k] * wb1) / 255) * 2 - 1;
      }
    }
    P.geometry.attributes.position.needsUpdate = true;
    P.geometry.attributes.normal.needsUpdate = true;
  }

  anim(name, phase = 0) {
    const C = this.clip(name);
    return [C.row, C.frames, phase, 1 / C.dur];
  }

  setAnim(name, now, blend = 0.25) {
    if (name === this.cur && !now) return;
    this.prev = this.cur; this.cur = name; this.mixT = now ? 1 : 0; this.blend = blend;
    this.uni.uA.value.fromArray(this.uni.uB.value.toArray());
    const t = this.uni.uTime.value;
    const a = this.anim(name);
    // Einmal Animation (Zaubern) beginnt am Anfang
    if (name === 'cast') a[2] = -t * a[3];
    // Sprung: die Phase setzt update() selbst, passend zu Absprung, Flug und Landung
    if (name === 'jump') { a[2] = 0; a[3] = 0; }
    this.uni.uB.value.fromArray(a);
    if (now) this.uni.uA.value.fromArray(a);
  }

  // Maus gesperrt (Pointer Lock): der Zeiger ist weg, jede Mausbewegung dreht die Kamera wie in Third-Person-Spielen.
  // Esc gibt die Maus frei (der Browser macht das selbst), ein Klick ins Bild sperrt sie wieder, ein zweites Esc
  // beendet den Geistmodus. Klappt die Sperre nicht, bleibt das Umsehen per Ziehen.
  lock() {
    const c = this.stage.renderer.domElement;
    if (!this.active || this.touchMode || document.pointerLockElement === c) return;   // am Handy gibt es keine Maussperre
    try {
      const p = c.requestPointerLock();
      // SecurityError heißt: Chrome sperrt kurz nach Esc keine neue Sperre, der nächste Klick klappt wieder.
      // Alles andere (eingebettete Ansichten, Testbrowser ohne Fenster): Umsehen per Ziehen, Zeiger bleibt sichtbar.
      if (p && p.catch) p.catch(e => { if (!e || e.name !== 'SecurityError') this.lockFailed = true; this.lockUI(); });
    } catch (e) { this.lockFailed = true; this.lockUI(); }
  }

  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  lockUI() {
    document.body.classList.toggle('ghost-lock', this.active && this.locked);
    document.body.classList.toggle('ghost-free', this.active && !this.locked && !this.lockFailed);
  }

  bind() {
    const canvas = this.stage.renderer.domElement;
    let drag = null;
    this.locked = false; this.unlockedAt = -1e9;
    this.lockHint = document.createElement('div');
    this.lockHint.id = 'ghostLock';
    this.lockHint.innerHTML = L('Klicke ins Bild, um weiterzusteuern<br><small>Esc beendet den Geistmodus</small>', 'Click the view to keep steering<br><small>Esc leaves spirit mode</small>');
    document.body.append(this.lockHint);
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) this.lockFailed = false;
      if (was && !this.locked) { this.unlockedAt = performance.now(); this.keys.clear(); }
      this.lockUI();
    });
    document.addEventListener('pointerlockerror', () => this.lockUI());
    canvas.addEventListener('pointerdown', e => {
      if (!this.active) return;
      e.preventDefault();
      // gesperrte Maus: links wirkt die gewählte Karte dort, wo das Fadenkreuz hinzeigt, rechts legt sie ab
      if (this.locked) { if (e.button === 0) this.shoot(); else if (e.button === 2 && this.app.cancelPower) this.app.cancelPower(); return; }
      this.lock();
      // je Finger getrennt: der Stick links dreht so nicht die Kamera mit. Ein kurzer Tipp wirkt am Handy genau dort
      drag = this.locked ? null : { x: e.clientX, y: e.clientY, id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now() };
    });
    canvas.addEventListener('contextmenu', e => { if (this.active) e.preventDefault(); });
    window.addEventListener('pointermove', e => {
      if (!this.active) return;
      if (this.locked) {
        // Ausreißer beim Sperren abfangen (Chrome meldet manchmal einen großen ersten Sprung)
        const mx = Math.max(-120, Math.min(120, e.movementX || 0)), my = Math.max(-120, Math.min(120, e.movementY || 0));
        this.camYaw -= mx * SENS;
        this.camPitch = Math.max(PMIN, Math.min(PMAX, this.camPitch + my * SENS * 0.8));
        this.lastDrag = this.uni.uTime.value;
        return;
      }
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y, k = this.touchMode ? 1.35 : 1;
      drag.x = e.clientX; drag.y = e.clientY;
      this.camYaw -= dx * 0.005 * k;
      this.camPitch = Math.max(PMIN, Math.min(PMAX, this.camPitch + dy * 0.004 * k));
      this.lastDrag = this.uni.uTime.value;
    });
    const up = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const tap = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 12 && performance.now() - drag.t0 < 380;
      drag = null;
      if (tap && this.active && this.touchMode && e.type === 'pointerup' && this.app.power) this.shootAt(e.clientX, e.clientY);
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', e => { if (!this.active) return; e.preventDefault(); this.dist = Math.max(0.38, Math.min(6, this.dist * (1 + Math.sign(e.deltaY) * 0.12))); }, { passive: false });
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === 'g' && !this.app.flying && !this.app.driving) { e.preventDefault(); e.stopImmediatePropagation(); this.toggle(); return; }
      if (!this.active) return;
      if (k === 'escape') {
        // erst die Maus frei, erst danach (zweites Esc) zurück in den Himmel
        if (this.locked || performance.now() - this.unlockedAt < 300) { e.preventDefault(); e.stopImmediatePropagation(); this.unlock(); return; }
        if (!this.app.power && document.querySelector('#modal')?.className !== 'show') { e.stopImmediatePropagation(); this.exit(); return; }
        return;
      }
      if (k === ' ' && !e.repeat) this.jumpReq = this.uni.uTime.value;
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', ' '].includes(k)) { this.keys.add(k); e.preventDefault(); e.stopImmediatePropagation(); }
      else if (k === 'e') { e.stopImmediatePropagation(); if (this.nearId) { this.unlock(); this.app.selectPerson(this.nearId); } }
      else if (k === 'q') { e.stopImmediatePropagation(); this.castHere(); }
      else if (/^[1-9]$/.test(k)) { e.preventDefault(); e.stopImmediatePropagation(); this.pickCard(+k); }
      else if (k === 'tab') { e.preventDefault(); e.stopImmediatePropagation(); this.nextTab(); }
      else if (k === 'm') this.unlock();   // die Karte braucht die Maus
    }, true);
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()), true);
    window.addEventListener('blur', () => this.keys.clear());
  }

  toggle() { if (this.active) this.exit(); else this.enter(); }

  enter() {
    if (!this.ready || !this.app.st || this.active) return;
    const cam = this.stage.camera, tgt = this.stage.controls.target;
    this.saved = { p: cam.position.clone(), t: tgt.clone() };
    this.pos.set(tgt.x, 0, tgt.z);
    // nie in einem Haus anfangen: ein paar Mal ganz hinausschieben
    if (this.app.st) for (let i = 0; i < 4; i++) this.pushOut(this.app.st, 1);
    this.pos.y = this.floorAt(this.pos.x, this.pos.z);
    this.camYaw = Math.atan2(tgt.x - cam.position.x, tgt.z - cam.position.z);
    this.yaw = this.camYaw;
    // Third Person: knapp hinter und über der Schulter, Blick etwa auf Kopfhöhe
    this.camPitch = 0.22; this.dist = 0.88; // näher, seit der Geist kleiner ist (24.10.2026)
    this.floorY = null; this.hover = 0.04; this.jy = 0; this.vy = 0; this.jumpState = null; this.jumpReq = null; this.bobK = 1;
    this.camLook = null; this.camY = null; this.gliding = false; this.speed = 0;
    this.active = true;
    this.stage.controls.enabled = false;
    this.group.visible = true; this.halo.visible = false;
    document.body.classList.add('ghost-mode');
    this.setAnim('idle', true);
    this.fadeIn = 0;
    this.lock();
    this.lockUI();
    if (this.onEnter) this.onEnter();
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.unlock();
    this.keys.clear();
    this.group.visible = false; this.halo.visible = false;
    document.body.classList.remove('ghost-mode', 'ghost-lock', 'ghost-free');
    this.tags.innerHTML = ''; this.prompt.textContent = '';
    this.ring.visible = false;
    for (const S of this.shots) if (S.mesh) { this.stage.scene.remove(S.mesh); S.mesh.material.dispose(); }
    this.shots.length = 0;
    this.reticle.classList.remove('armed', 'no', 'fire', 'bad');
    // Zurück in den Himmel, über der Stelle, an der der Geist zuletzt war
    const c = this.stage.controls;
    c.target.set(this.pos.x, Math.max(0, Math.min(3, this.pos.y)), this.pos.z);
    const back = new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
    this.stage.camera.position.copy(c.target).addScaledVector(back, 18).add(new THREE.Vector3(0, 16, 0));
    c.enabled = true;
    c.update();
    if (this.savedNear) { this.stage.camera.near = this.savedNear; this.stage.camera.updateProjectionMatrix(); this.savedNear = null; }
    if (this.app.buildings) this.app.buildings.seeThrough(new Set(), 1);
    if (this.onExit) this.onExit();
  }

  floorAt(x, z) {
    const sea = (this.app.fx ? this.app.fx.rise : 0) + 0.03;
    return Math.max(roadY(x, z), sea); // auch auf Brücken
  }

  // Kraft genau hier: Ort, Siedlung oder der nächste Mensch, je nachdem, was die Kraft braucht
  castHere() {
    const app = this.app, st = app.st;
    if (!st) return;
    const x = Math.floor(this.pos.x + NX / 2), y = Math.floor(this.pos.z + NY / 2);
    if (!app.power) { this.unlock(); if (app.toast) app.toast(L('Wähle unten erst eine Kraft, dann Q.', 'Pick a power below first, then press Q.')); return; }
    app.castHere(x, y, this.nearId);
  }

  playCast() {
    if (!this.active) return;
    if (this.uni.uTime.value - this.shotT < 1.5) return;   // geschossen: die Wurfbewegung lief schon
    this.setAnim('cast'); this.castUntil = this.uni.uTime.value + this.clip('cast').dur * 0.95;
  }

  // Karte unten wählen: Taste 1 bis 9 (nochmal dieselbe legt sie ab), Tab wechselt Himmel, Erde, Geist
  pickCard(n) {
    const c = document.querySelectorAll('#dock .card')[n - 1];
    if (!c) return;
    if (this.app.power === c.dataset.id) { if (this.app.cancelPower) this.app.cancelPower(); return; }
    if (c.dataset.id === 'traum') this.unlock();   // das Traumthema wählt man mit der Maus, danach ins Bild klicken
    c.click();
  }

  nextTab() {
    const tabs = [...document.querySelectorAll('#dock .dtab')];
    if (!tabs.length) return;
    const i = tabs.findIndex(b => b.classList.contains('on'));
    tabs[(i + 1) % tabs.length].click();
  }

  // Zielen: Strahl aus der Kamera durch die Bildmitte, trifft Boden, Wasser oder einen Menschen
  updateAim(st, people) {
    const cam = this.stage.camera, o = cam.position, d = this._d || (this._d = new THREE.Vector3());
    if (this._ndc) d.set(this._ndc.x, this._ndc.y, 0.5).unproject(cam).sub(o).normalize();   // Tipp ins Bild (Handy)
    else cam.getWorldDirection(d);
    const A = this.aim;
    A.ok = false; A.pid = null;
    const fl = (x, z) => this.floorAt(x, z);
    let prev = 0.3, hit = null;
    for (let t = 0.3; t <= AIM_R; t += 0.08) {
      if (o.y + d.y * t <= fl(o.x + d.x * t, o.z + d.z * t)) {
        let a = prev, b = t;
        for (let k = 0; k < 7; k++) { const m = (a + b) / 2; if (o.y + d.y * m <= fl(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; }
        hit = b; break;
      }
      prev = t;
    }
    let best = hit ?? AIM_R;
    if (people && people.pos) for (const [id, p] of people.pos) {
      const px = p[0] - o.x, py = p[1] + 0.14 - o.y, pz = p[2] - o.z;
      const t = px * d.x + py * d.y + pz * d.z;
      if (t < 0.3 || t > best + 0.2) continue;
      const cx = px - d.x * t, cy = py - d.y * t, cz = pz - d.z * t, r = 0.1 + t * 0.004;
      if (cx * cx + cy * cy * 0.45 + cz * cz < r * r) { best = t; A.pid = id; }
    }
    if (hit == null && A.pid == null) return;
    A.ok = true; A.t = best;
    if (A.pid) { const p = people.pos.get(A.pid); A.point.set(p[0], p[1], p[2]); }
    else A.point.set(o.x + d.x * best, fl(o.x + d.x * best, o.z + d.z * best), o.z + d.z * best);
    A.x = Math.floor(A.point.x + NX / 2); A.y = Math.floor(A.point.z + NY / 2);
  }

  // Was die gewählte Kraft dort träfe: { ok, tgt, point, label, msg, r, cx, cz }
  targetFor(P, st) {
    const A = this.aim, app = this.app;
    if (P.target === 'global') return { ok: true, tgt: {}, label: L('über die ganze Welt', 'across the whole world'), global: true };
    if (!A.ok) return { ok: false, msg: L('Zu weit. Ziele näher.', 'Too far. Aim closer.'), label: L('zu weit', 'too far') };
    const rt = st._rt, i = A.y * NX + A.x, inside = A.x >= 0 && A.y >= 0 && A.x < NX && A.y < NY;
    if (P.target === 'person') {
      let pid = A.pid;
      if (!pid && app.people) {
        let bd = 0.7;
        for (const [id, p] of app.people.pos) { const dd = Math.hypot(p[0] - A.point.x, p[2] - A.point.z); if (dd < bd) { bd = dd; pid = id; } }
      }
      const pp = pid && rt.pById.get(pid);
      if (!pp) return { ok: false, msg: L('Ziele auf einen Menschen.', 'Aim at a person.'), label: L('ziele auf einen Menschen', 'aim at a person') };
      const pos = app.people.pos.get(pid);
      const th = app.dreamTheme && DREAMS[app.dreamTheme];
      return { ok: true, tgt: { pid, theme: app.dreamTheme }, point: new THREE.Vector3(pos[0], pos[1] + 0.2, pos[2]), label: `${th ? th.name + ' · ' : ''}${pp.n}${app.jobName ? ' · ' + app.jobName(pp) : ''}`, r: 0.22, cx: pos[0], cz: pos[2] };
    }
    if (P.target === 'settlement') {
      let s = null, bd = 14;
      for (const o of st.settlements) if (o.alive) { const dd = Math.hypot(o.cx - A.x, o.cy - A.y); if (dd < Math.max(bd, o.R + 2) && dd < (s ? Math.hypot(s.cx - A.x, s.cy - A.y) : 1e9)) { s = o; bd = dd; } }
      if (!s) return { ok: false, msg: L('Hier lebt niemand. Ziele auf eine Siedlung.', 'Nobody lives here. Aim at a settlement.'), label: L('keine Siedlung', 'no settlement') };
      const X = s.cx - NX / 2 + 0.5, Z = s.cy - NY / 2 + 0.5;
      return { ok: true, tgt: { sid: s.id, x: s.cx, y: s.cy }, point: new THREE.Vector3(X, groundY(X, Z), Z), label: s.name, r: Math.max(1.2, s.R || 3), cx: X, cz: Z };
    }
    if (!inside) return { ok: false, msg: L('Daneben.', 'Missed.'), label: '' };
    const T = st.tiles, h = T.h[i];
    let place;
    let near = null;
    for (const o of st.settlements) if (o.alive && Math.hypot(o.cx - A.x, o.cy - A.y) < (o.R || 4) + 2) near = o;
    if (h < 0) place = L('Wasser', 'water');
    else if (near) place = near.name;
    else { const B = BIOMES[T.bio ? T.bio[i] : 0]; place = B ? B.name : ''; }
    const r = P.id === 'meteor' ? 4 : P.id === 'blitz' ? 0.6 : P.target === 'mountain' ? 3 : P.target === 'coast' ? 1.2 : (P.radius || 1);
    return { ok: true, tgt: { x: A.x, y: A.y }, point: A.point.clone(), label: place, r, cx: A.point.x, cz: A.point.z };
  }

  // Am Handy: ein Tipp ins Bild wirkt die gewählte Karte genau an dieser Stelle (das Fadenkreuz bleibt für den Knopf)
  shootAt(cx, cy) {
    const st = this.app.st;
    if (!st) return;
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    this._ndc = { x: (cx - r.left) / r.width * 2 - 1, y: -((cy - r.top) / r.height) * 2 + 1 };
    this.updateAim(st, this.app.people);
    this._ndc = null;
    this.shoot();
  }

  // Wirken: ein Geschoss fliegt aus der Hand dorthin, wo das Fadenkreuz hinzeigt, und löst dort die Kraft aus
  shoot() {
    const app = this.app, st = app.st, t = this.uni.uTime.value;
    if (!st || t < this.shotReady) return;
    const id = app.power;
    if (!id) { if (app.toast) app.toast(this.touchMode ? L('Wähle unten eine Karte, dann Wirken oder ins Bild tippen.', 'Pick a card below, then Cast or tap the view.') : L('Wähle unten eine Karte: Tasten 1 bis 9, Tab wechselt die Reihe.', 'Pick a card below: keys 1 to 9, Tab switches the row.')); return; }
    const P = POWER[id];
    if (st.mana < P.cost) { if (app.toast) app.toast(L(`Für ${P.name} fehlt dir Kraft.`, `You lack the power for ${P.name}.`)); this.flash('bad'); return; }
    const T = this.targetFor(P, st);
    if (!T.ok) { if (app.toast) app.toast(T.msg); this.flash('bad'); return; }
    const hand = this.handPos();
    let to = T.point;
    if (T.global) { const f = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw)); to = hand.clone().addScaledVector(f, 3).add(new THREE.Vector3(0, 9, 0)); }
    const dist = hand.distanceTo(to);
    this.shots.push({ id, tgt: T.tgt, theme: app.dreamTheme, from: hand, to: to.clone(), t0: t, dur: Math.max(0.16, Math.min(1.1, dist / 24)), arc: Math.min(1.5, dist * 0.08), col: new THREE.Color(SHOT_COL[id] || '#ffffff'), mesh: null });
    this.shotReady = t + 0.65;
    this.shotT = t;
    // zum Ziel drehen und, wenn er steht, die Wurfbewegung (Zauber-Animation schnell und nur der Wurf)
    this.faceUntil = t + 0.5; this.faceYaw = Math.atan2(to.x - this.pos.x, to.z - this.pos.z);
    if (this.speed < 0.1 && !this.jumpState && this.clips.cast) {
      const C = this.clip('cast'), rate = 2.6 / C.dur;
      if (this.cur !== 'cast') this.setAnim('cast', false, 0.08);
      const B = this.uni.uB.value; B.w = rate; B.z = 0.32 - t * rate;
      this.shotUntil = t + 0.62 * C.dur / 2.6;
    }
    this.flash('fire');
  }

  handPos() {
    const fy = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    return new THREE.Vector3(this.pos.x + fy * 0.07 - fz * 0.07, this.pos.y + HEIGHT * 0.66, this.pos.z + fz * 0.07 + fy * 0.07);
  }

  flash(cls) {
    const R = this.reticle;
    R.classList.remove('fire', 'bad'); void R.offsetWidth; R.classList.add(cls);
    clearTimeout(this._fl); this._fl = setTimeout(() => R.classList.remove(cls), 260);
  }

  // Geschosse fliegen lassen, am Ziel die Kraft auslösen (die Karte bleibt danach gewählt, man kann weiter wirken)
  updateShots(dt, t) {
    for (let k = this.shots.length - 1; k >= 0; k--) {
      const S = this.shots[k];
      if (!S.mesh) {
        S.mesh = new THREE.Mesh(this.shotGeo, new THREE.MeshBasicMaterial({ color: S.col.clone().multiplyScalar(2.2), toneMapped: false }));
        this.stage.scene.add(S.mesh);
      }
      const u = Math.min(1, (t - S.t0) / S.dur);
      const p = S.mesh.position.lerpVectors(S.from, S.to, u);
      p.y += Math.sin(u * Math.PI) * S.arc;
      S.mesh.scale.setScalar(0.8 + Math.sin(t * 40) * 0.15);
      if (this.onSpark) for (let q = 0; q < 3; q++) this.onSpark(p.x, p.y, p.z, S.col);
      if (u < 1) continue;
      this.stage.scene.remove(S.mesh); S.mesh.material.dispose();
      this.shots.splice(k, 1);
      const app = this.app;
      if (!app.st || !app.castAt) continue;
      const ok = app.castAt(S.id, S.tgt);
      // im Geistmodus bleibt die Karte gewählt (wie eine Waffe), auch das Traumthema
      if (this.active && app.rearm) app.rearm(S.id, S.theme);
      if (!ok) this.flash('bad');
    }
  }

  // Fadenkreuz, Beschriftung und Zielring nach der gewählten Karte
  updateReticle(st) {
    const app = this.app, P = app.power ? POWER[app.power] : null, R = this.reticle;
    if (!P || !st) {
      R.classList.remove('armed', 'no'); R.style.removeProperty('--ac'); this.aimLbl.textContent = ''; this.ring.visible = false; return;
    }
    const T = this.targetFor(P, st), poor = st.mana < P.cost;
    R.classList.add('armed'); R.classList.toggle('no', !T.ok || poor);
    R.style.setProperty('--ac', SHOT_COL[P.id] || '#fff6e2');
    this.aimLbl.innerHTML = `<b>${P.name}</b>${T.label ? ' · ' + T.label : ''}${poor ? ' · ' + L('zu wenig Kraft', 'not enough power') : ''}`;
    if (!T.ok || T.global || !T.r) { this.ring.visible = false; return; }
    // Ring auf dem Gelände
    const SEG = this.ringSeg, pos = this.ringPos, w = Math.max(0.035, T.r * 0.035);
    for (let k = 0; k <= SEG; k++) {
      const a = k / SEG * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      for (let j = 0; j < 2; j++) {
        const rr = T.r + (j ? -w : w) * 0.5, x = T.cx + ca * rr, z = T.cz + sa * rr;
        const o = (k * 2 + j) * 3;
        pos[o] = x; pos[o + 1] = Math.max(groundY(x, z), this.floorAt(x, z)) + 0.04; pos[o + 2] = z;
      }
    }
    this.ring.geometry.attributes.position.needsUpdate = true;
    this.ring.geometry.computeBoundingSphere();
    this.ring.material.color.set(SHOT_COL[P.id] || '#ffffff');
    this.ring.material.opacity = 0.55 + Math.sin(this.uni.uTime.value * 4) * 0.2;
    this.ring.visible = true;
  }

  // Sprung (seit 19.10.2026): kurz in die Knie (PRE_T), dann Flug mit Schwerkraft, Landung federt ab. Die Animation
  // (Meshy Regular_Jump, beim Backen ohne eigenes Abheben, siehe "lift" in bake_villagers.mjs) läuft nicht nach Zeit,
  // sondern nach dem Zustand: Knie bis zum Absprungbild, Flugbilder nach der Steiggeschwindigkeit, Landebilder danach.
  // Leertaste in der Luft gedrückt halten: der Geist gleitet (schnell, knapp über dem Boden, durch Mauern).
  jumpStep(dt, t, held, moving) {
    const req = this.jumpReq != null && t - this.jumpReq < 0.15;   // kurz vor der Landung gedrückt zählt auch
    if ((!this.jumpState || (this.jumpState === 'land' && this.jumpT > 0.06)) && req && t > this.castUntil) {
      this.jumpReq = null; this.jumpState = 'pre'; this.jumpT = 0;
    }
    if (!this.jumpState) return;
    this.jumpT += dt;
    const S = this.jumpState;
    if (S === 'pre') {
      if (this.jumpT >= PRE_T) { this.jumpState = 'air'; this.vy = JUMP_V; this.jumpT = 0; this.airT = 0; }
    } else if (S === 'air') {
      this.vy -= GRAV * dt; this.jy += this.vy * dt; this.airT += dt;
      if (held && this.airT > 0.28 && this.vy < 0.3) { this.jumpState = 'glide'; this.gliding = true; this.jumpReq = null; }
      else if (this.jy <= 0 && this.vy < 0) {
        this.jy = 0; this.vy = 0; this.jumpState = 'land'; this.jumpT = 0;
        this.landDur = moving ? 0.14 : LAND_T;
        if (this.onLand) this.onLand(this.pos.x, this.floorY, this.pos.z);
      }
    } else if (S === 'glide') {
      this.vy = 0; this.jy += (GLIDE_H - this.jy) * Math.min(1, dt * 3);
      if (!held) { this.jumpState = 'air'; this.gliding = false; this.airT = 1; }
    } else if (S === 'land' && this.jumpT >= this.landDur) this.jumpState = null;
  }

  // Fußspuren (seit 25.10.2026): im Sand (Strand, Wüste, Salz, Schlucht) und im Schnee (Winter, Gletscher, hohe Gipfel)
  // drückt jeder halbe Schritt einen Abdruck in den Boden, links und rechts im Wechsel; im Flug und beim Gleiten nicht
  footprints(st, dt, t, floor, inAir) {
    this.tracks.update(t);
    if (!st || inAir || this.gliding || this.speed < 0.04) return;
    this.stepD += this.speed * dt;
    const half = STRIDE * HEIGHT * 0.5;
    if (this.stepD < half) return;
    this.stepD -= half;
    const tx = Math.floor(this.pos.x + NX / 2), ty = Math.floor(this.pos.z + NY / 2);
    if (tx < 0 || ty < 0 || tx >= NX || ty >= NY) return;
    const i = ty * NX + tx, l = st.tiles.h[i], bk = BIOMES[(st.tiles.bio || [])[i] || 0]?.key;
    const snowK = this.app.U ? this.app.U.uSnow.value : 0;
    const snow = l >= 1 && (snowK > 0.35 || bk === 'eis' || l >= 7);
    const sand = !snow && (l === 0 || bk === 'wueste' || bk === 'salz' || bk === 'canyon');
    if (!snow && !sand) return;
    if (this.app.streets && this.app.streets.at(this.pos.x, this.pos.z)) return; // auf festem Belag keine Spur
    this.stepSide = -this.stepSide;
    const y = this.yaw, off = 0.016 * this.stepSide;
    const X = this.pos.x - Math.cos(y) * off, Z = this.pos.z + Math.sin(y) * off;
    this.tracks.step(X, groundY(X, Z), Z, y, snow ? 'snow' : 'sand');
  }

  update(dt, t, people, st) {
    this.uni.uTime.value = t;
    if (!this.active || !this.mesh) return;
    dt = Math.min(dt, 0.05);
    // Bewegung relativ zur Kamera: W vor, S zurück, A links, D rechts; Pfeile links und rechts drehen die Kamera
    let mx = 0, mz = 0;
    const K = this.keys;
    if (K.has('w') || K.has('arrowup')) mz += 1;
    if (K.has('s') || K.has('arrowdown')) mz -= 1;
    if (K.has('d')) mx += 1;
    if (K.has('a')) mx -= 1;
    if (K.has('arrowleft')) this.camYaw += dt * 2.2;
    if (K.has('arrowright')) this.camYaw -= dt * 2.2;
    let run = K.has('shift'), ana = 1;
    // Handy: Stick links, analog (wenig ausgelenkt geht er langsam, ganz am Rand rennt er)
    const tm = this.touchMove;
    if (tm) { const m = Math.hypot(tm.x, tm.y); if (m > 0.14) { mx += tm.x; mz += tm.y; ana = Math.min(1, m); if (tm.run) run = true; } }
    const len = Math.hypot(mx, mz);
    // Blickrichtung der Kamera und rechts davon (vom Bildschirm aus gesehen)
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    const rx = -fz, rz = fx;
    const inAir = this.jumpState === 'air' || this.jumpState === 'glide';
    let want = 0;
    if (len > 0 && t > this.castUntil) {
      const dx = (fx * mz + rx * mx) / len, dz = (fz * mz + rz * mx) / len;
      want = this.gliding ? GLIDE : run ? RUN : WALK;
      if (tm && !run && !this.gliding) want *= Math.max(0.35, ana);
      if (this.jumpState === 'land' && this.jumpT < 0.1) want *= 0.6;   // kurz abfedern
      const target = Math.atan2(dx, dz);
      let dy = target - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * Math.min(1, dt * (inAir && !this.gliding ? 5 : 10));
      this.dir = [dx, dz];
      // ohne Maussperre: geradeaus laufen schwenkt die Kamera langsam hinter den Geist (nicht beim Umsehen)
      if (!this.locked && mz > 0 && Math.abs(mx) < mz * 0.3 && t - this.lastDrag > 1.2) {
        let dc = this.yaw - this.camYaw; dc = Math.atan2(Math.sin(dc), Math.cos(dc));
        this.camYaw += dc * Math.min(1, dt * 1.6);
      }
    }
    // in der Luft bleibt der Schwung, gesteuert wird nur sanft
    const acc = inAir && !this.gliding ? 2.2 : want > this.speed ? 6 : 9;
    this.speed += (want - this.speed) * Math.min(1, dt * acc);
    if (this.speed > 0.01 && this.dir) {
      this.pos.x += this.dir[0] * this.speed * dt;
      this.pos.z += this.dir[1] * this.speed * dt;
      this.pos.x = Math.max(-NX / 2 + 2, Math.min(NX / 2 - 2, this.pos.x));
      this.pos.z = Math.max(-NY / 2 + 2, Math.min(NY / 2 - 2, this.pos.z));
    }
    this.jumpStep(dt, t, K.has(' '), len > 0);
    if (st) this.pushOut(st, dt);
    // Höhe: dem Boden weich folgen (Hügel, Wasser), darüber Schweben, Sprung und ein leichtes Wiegen im Stand
    const floor = this.floorAt(this.pos.x, this.pos.z);
    if (this.floorY == null) this.floorY = floor;
    this.floorY += (floor - this.floorY) * Math.min(1, dt * 10);
    this.hover += ((this.gliding ? 0.06 : 0.04) - this.hover) * Math.min(1, dt * 4);
    this.bobK += ((this.jumpState ? 0 : 1) - this.bobK) * Math.min(1, dt * 8);
    this.pos.y = this.floorY + this.hover + this.jy + Math.sin(t * 2.2) * 0.02 * this.bobK;
    this.group.position.copy(this.pos);
    this.footprints(st, dt, t, floor, inAir);
    // beim Wirken kurz zum Ziel drehen
    if (t < (this.faceUntil || 0)) { let dy = this.faceYaw - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); this.yaw += dy * Math.min(1, dt * 14); }
    for (const o of [this.pre, this.mesh, this.aura, this.aoProxy]) if (o) o.rotation.y = this.yaw;
    if (this.aoProxy && this.stage.gtao && this.stage.gtao.enabled) this.poseCPU();
    this.halo.position.set(this.pos.x, floor + 0.02, this.pos.z);
    this.halo.scale.setScalar(1 / (1 + this.jy * 4));
    // Animation: Zaubern hat Vorrang, dann Sprung, sonst nach Tempo
    const J = this.jumpState, JC = this.clips.jump;
    const byPace = this.gliding ? 'idle' : this.speed > (WALK + RUN) / 2 ? 'run' : this.speed > 0.03 ? 'walk' : 'idle';
    let name = t < this.castUntil || t < this.shotUntil ? 'cast' : J && J !== 'glide' && JC ? 'jump' : byPace;
    if (name === 'jump' && J === 'land' && len > 0 && this.jumpT > 0.07) name = byPace;   // wer weiterläuft, läuft weiter
    if (name !== this.cur) this.setAnim(name, false, name === 'jump' ? 0.07 : this.cur === 'jump' ? 0.16 : 0.25);
    this.mixT = Math.min(1, this.mixT + dt / (this.blend || 0.25));
    this.uni.uMix.value = this.mixT;
    const B = this.uni.uB.value;
    if (name === 'jump') {
      const last = (JC.frames - 1) / JC.frames;
      let p;
      const s0 = JC.start || 0, e0 = Math.min(last, JC.end || last);
      if (J === 'pre') p = s0 + (JC.up - s0) * Math.min(1, this.jumpT / PRE_T);
      else if (J === 'air') p = JC.up + (JC.down - JC.up) * Math.max(0, Math.min(0.98, (JUMP_V - this.vy) / (2 * JUMP_V)));
      else p = JC.down + (e0 - JC.down) * Math.min(1, this.jumpT / (this.landDur || LAND_T));
      B.z = Math.min(p, last); B.w = 0;
    } else if (name === 'walk' || name === 'run') {
      // Schrittlänge an das Tempo anpassen, ohne zu springen: Phase so halten, dass der Rahmen gleich bleibt
      const C = this.clip(name), base = 1 / C.dur;
      // Beine passend zum Tempo (Schrittlänge der Animation), damit nichts rutscht
      const rate = base * Math.max(0.5, Math.min(3, this.speed / ((name === 'run' ? RUN_STRIDE : STRIDE) * HEIGHT)));
      const ph = t * B.w + B.z;
      B.w = rate; B.z = ph - t * rate;
    }
    // kein eigenes Licht, kein Lichtfleck, keine Funkenspur mehr (Naders Wunsch: soll nicht leuchten)
    this.light.intensity = 0;
    // Third-Person-Kamera: Winkel und Abstand folgen direkt der Maus (kein Nachziehen beim Umsehen), der Blickpunkt
    // auf Kopfhöhe folgt dem Geist, in der Höhe weich (Hügel, Wiegen) und beim Sprung nur zur Hälfte, so sieht man ihn
    // abheben. Häuser zwischen Kamera und Geist werden durchsichtig (seeThrough), die Kamera springt nicht.
    const cam = this.stage.camera;
    const tx = this.pos.x, tz = this.pos.z, ty = this.floorY + this.hover + HEIGHT * 0.92 + this.jy * 0.45;
    if (!this.camLook) this.camLook = new THREE.Vector3(tx, ty, tz);
    const L0 = this.camLook, kxz = Math.min(1, dt * 20);
    L0.x += (tx - L0.x) * kxz; L0.z += (tz - L0.z) * kxz;
    L0.y += (ty - L0.y) * Math.min(1, dt * 7);
    const c = Math.cos(this.camPitch), sn = Math.sin(this.camPitch);
    // über die rechte Schulter (seit 19.10.2026): die Figur steht links der Mitte und verdeckt das Fadenkreuz nicht
    const sh = 0.09 + this.dist * 0.07, LS = this._ls || (this._ls = new THREE.Vector3());
    LS.set(L0.x - Math.cos(this.camYaw) * sh, L0.y, L0.z + Math.sin(this.camYaw) * sh);
    const want3 = new THREE.Vector3(LS.x - Math.sin(this.camYaw) * this.dist * c, LS.y + this.dist * sn, LS.z - Math.cos(this.camYaw) * this.dist * c);
    if (cam.near !== 0.04) { this.savedNear = this.savedNear || cam.near; cam.near = 0.04; cam.updateProjectionMatrix(); }
    // über Hügeln und Wasser nie unter den Boden: dann etwas höher, nicht näher
    want3.y = Math.max(want3.y, groundY(want3.x, want3.z) + 0.1, (this.app.fx ? this.app.fx.rise : 0) + 0.1);
    if (this.camY == null) this.camY = want3.y;
    this.camY += (want3.y - this.camY) * Math.min(1, dt * 14);
    cam.position.set(want3.x, this.camY, want3.z);
    cam.lookAt(LS);
    this.stage.controls.target.copy(L0);
    if (st && this.app.buildings) this.app.buildings.seeThrough(this.blockers(st, cam.position, new THREE.Vector3(this.pos.x, this.pos.y + HEIGHT * 0.8, this.pos.z)), dt);
    // Zielen, Fadenkreuz, Geschosse
    if (st) { this.updateAim(st, people); this.updateReticle(st); }
    this.updateShots(dt, t);
    // Menschen in der Nähe: Namen über den Köpfen, der nächste lässt sich mit E ansehen
    this.nearby(people, st);
  }

  // Gebäude rund um eine Stelle (Felder, Platz, Brunnen und Parks sind begehbar), mit Grundriss in Weltkoordinaten
  // [x0, x1, z0, z1, Boden, Dach] aus der echten Form (buildings.foot), nicht mehr ein ganzes Feld
  around(st, x, z, r, all = false) {
    const rt = st._rt, B = this.app.buildings, out = [];
    if (!B) return out;
    const x0 = Math.floor(x - r + NX / 2), x1 = Math.floor(x + r + NX / 2), z0 = Math.floor(z - r + NY / 2), z1 = Math.floor(z + r + NY / 2);
    for (let iz = Math.max(0, z0); iz <= Math.min(NY - 1, z1); iz++) for (let ix = Math.max(0, x0); ix <= Math.min(NX - 1, x1); ix++) {
      const bid = rt.bldAt[iz * NX + ix];
      if (!bid) continue;
      const b = rt.bById.get(bid);
      if (!b || b.t === 'feld' || (!all && OPEN.has(b.t))) continue;
      const m = B.meshes.get(b.id);
      if (m) out.push([b.id, B.foot(m)]);
    }
    return out;
  }

  // Welche Gebäude verdecken den Geist? Strahl von der Kamera zu Kopf und Füßen gegen die Kästen der Häuser.
  blockers(st, from, look) {
    const ids = new Set();
    const tx = from.x - look.x, tz = from.z - look.z;
    const list = this.around(st, (from.x + look.x) / 2, (from.z + look.z) / 2, Math.hypot(tx, tz) / 2 + 1.6, true);
    const ends = [look, new THREE.Vector3(look.x, this.pos.y + 0.03, look.z)];
    for (const [id, f] of list) {
      for (const e of ends) {
        // Strahl e -> Kamera gegen Kasten (Slab Test), etwas größer, damit auch der Rand frei bleibt
        let t0 = 0, t1 = 1, hit = true;
        const o = [e.x, e.y, e.z], d = [from.x - e.x, from.y - e.y, from.z - e.z];
        const lo = [f[0] - 0.04, f[4] - 0.1, f[2] - 0.04], hi = [f[1] + 0.04, f[5] + 0.04, f[3] + 0.04];
        for (let a = 0; a < 3 && hit; a++) {
          if (Math.abs(d[a]) < 1e-6) { if (o[a] < lo[a] || o[a] > hi[a]) hit = false; continue; }
          let u = (lo[a] - o[a]) / d[a], v = (hi[a] - o[a]) / d[a];
          if (u > v) [u, v] = [v, u];
          t0 = Math.max(t0, u); t1 = Math.min(t1, v);
          if (t0 > t1) hit = false;
        }
        if (hit) { ids.add(id); break; }
      }
    }
    return ids;
  }

  // Der Geist geht nicht durch Wände: als kleiner Kreis gegen den echten Grundriss jedes Hauses, er gleitet an der
  // Wand entlang und rutscht um Ecken herum. Beim Gleiten (Leertaste) schwebt er als Geist durch die Mauern;
  // steht er danach in einem Haus, schwebt er weich wieder hinaus.
  pushOut(st, dt = 0.016) {
    if (this.gliding) return;
    const R = 0.07;
    for (let it = 0; it < 2; it++) {
      for (const [, f] of this.around(st, this.pos.x, this.pos.z, 1.2)) {
        const qx = Math.max(f[0], Math.min(f[1], this.pos.x)), qz = Math.max(f[2], Math.min(f[3], this.pos.z));
        const dx = this.pos.x - qx, dz = this.pos.z - qz, d = Math.hypot(dx, dz);
        if (d >= R) continue;
        if (d > 1e-5) { this.pos.x = qx + dx / d * R; this.pos.z = qz + dz / d * R; continue; }
        // mitten im Haus (nach dem Gleiten): zur nächsten Wand hinaus, weich
        const l = this.pos.x - f[0], r = f[1] - this.pos.x, n = this.pos.z - f[2], s = f[3] - this.pos.z, mn = Math.min(l, r, n, s);
        let ox = this.pos.x, oz = this.pos.z;
        if (mn === l) ox = f[0] - R; else if (mn === r) ox = f[1] + R; else if (mn === n) oz = f[2] - R; else oz = f[3] + R;
        const kk = mn > 0.05 ? Math.min(1, dt * 5) : 1;
        this.pos.x += (ox - this.pos.x) * kk; this.pos.z += (oz - this.pos.z) * kk;
      }
    }
  }

  nearby(people, st) {
    if (!people || !st) return;
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3();
    const list = [];
    for (const [id, p] of people.pos) {
      const d = Math.hypot(p[0] - this.pos.x, p[2] - this.pos.z);
      if (d < 3.2) list.push([d, id, p]);
    }
    list.sort((a, b) => a[0] - b[0]);
    this.nearId = list.length && list[0][0] < 1.2 ? list[0][1] : null;
    if (this.onNear && this.nearId !== this._nearSent) { this._nearSent = this.nearId; this.onNear(this.nearId); }
    // Wer den Geist lange neben sich hat, spürt etwas, sehen kann er ihn nicht
    const t = this.uni.uTime.value;
    this.felt = this.felt || new Map();
    if (this.nearId !== this.lingerId) { this.lingerId = this.nearId; this.lingerT = t; }
    if (this.nearId && t - this.lingerT > 3.5 && !(this.felt.get(this.nearId) > t - 60)) {
      const LINES = L(['Ist da jemand?', 'Mir ist plötzlich so warm.', 'Hast du das auch gespürt?', 'Seltsam, als ob mich jemand ansieht.', 'Der Wind riecht nach Regen.'],
        ['Is someone there?', 'I suddenly feel so warm.', 'Did you feel that too?', 'Strange, as if someone is watching me.', 'The wind smells of rain.']);
      this.felt.set(this.nearId, t);
      this.whisper = { id: this.nearId, text: LINES[Math.floor(Math.random() * LINES.length)], until: t + 4 };
      if (this.app.onFelt) this.app.onFelt(this.nearId, this.whisper.text);
    }
    let html = '';
    for (const [d, id, p] of list.slice(0, 7)) {
      const P = st._rt.pById.get(id);
      if (!P) continue;
      v.set(p[0], p[1] + 0.34, p[2]).project(this.stage.camera);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue;
      const sx = (v.x + 1) / 2 * r.width, sy = (1 - v.y) / 2 * r.height;
      const job = this.app.jobName ? this.app.jobName(P) : '';
      const op = Math.max(0.25, 1 - d / 3.2);
      const w = this.whisper && this.whisper.id === id && t < this.whisper.until ? `<i>${this.whisper.text}</i>` : '';
      html += `<div class="gt${id === this.nearId ? ' near' : ''}" style="left:${sx.toFixed(0)}px;top:${sy.toFixed(0)}px;opacity:${op.toFixed(2)}">${w}<b>${P.n}</b>${job ? `<span>${job}</span>` : ''}</div>`;
    }
    this.tags.innerHTML = html;
    const N0 = this.nearId && st._rt.pById.get(this.nearId);
    if (this.touchMode) {
      this.prompt.innerHTML = N0 ? L(`<b>${N0.n}</b> ist nah: Ansehen`, `<b>${N0.n}</b> is near: Look`) + (this.app.power ? L(' · ins Bild tippen wirkt dort', ' · tap the view to cast there') : '')
        : this.app.power ? L('Wirken oder ins Bild tippen', 'Cast or tap the view') : '';
      return;
    }
    this.prompt.innerHTML = N0 ? L(`<kbd>E</kbd> ${N0.n} ansehen`, `<kbd>E</kbd> look at ${N0.n}`) + (this.app.power ? L(' · <kbd>Q</kbd> Kraft hier wirken', ' · <kbd>Q</kbd> cast here') : '')
      : this.app.power ? L('<kbd>Q</kbd> Kraft hier wirken', '<kbd>Q</kbd> cast here') : '';
  }
}
