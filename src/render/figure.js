// Figuren der Menschen (seit 27.10.2026 eigenes Modul, vorher in people.js): Ton Figuren mit gebackenen Animationen
// (Vertex Animation Texturen), Hüte, Zubehör, Farben je Mensch. Inselwelt (people.js, Heere, Innenansicht) und die
// nahtlose Erde (city/life.js) nutzen dieselben Figuren. Hängt nur an three.js, nicht an Gelände oder Simulation.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
// Hemdfarben je Beruf, kräftig genug, dass man sie auch von weitem unterscheidet
export const JOBC = {
  sammler: '#b7834a', jaeger: '#6f5a3a', bauer: '#c98f3a', fischer: '#3f86b5', holzfaeller: '#a0523a', steinmetz: '#8c8c86',
  bergmann: '#4c4a52', handwerker: '#b4643c', baumeister: '#d9a53a', priester: '#efe9dc', gelehrter: '#5f6fc0', haendler: '#2f8f84',
  krieger: '#b8402e', heiler: '#6fa55c', kuenstler: '#9b6ad6', arbeiter: '#4f5d6c', kind: '#e07a5f', alt: '#8f877c',
};
export const KIDS = ['#e07a5f', '#f2b45a', '#81b29a', '#3d85c6', '#e99ab0', '#f4a261', '#9b7fd1'];
// Hüte: wer trägt was (null = barhäuptig)
export const HAT_OF = (p, h) => p.lt ? 'krone' : p.job === 'krieger' ? 'helm' : p.job === 'priester' || p.job === 'heiler' || p.job === 'gelehrter' ? 'kapuze'
  : (p.job === 'bauer' || p.job === 'sammler') && h < 0.7 ? 'stroh'
  : ['fischer', 'handwerker', 'holzfaeller', 'bergmann', 'arbeiter', 'haendler', 'steinmetz', 'baumeister'].includes(p.job) && h < 0.5 ? 'muetze'
  : p.job === 'alt' && h < 0.35 ? 'muetze' : null;
export const HAT_COLORS = { muetze: ['#b8402e', '#3f6fb5', '#5f8f4a', '#d9a53a', '#7a5a8c', '#3e4a5c'], kapuze: { priester: '#efe9dc', heiler: '#6f9a5c', gelehrter: '#4f5fa8' } };
// Arbeit mit Hammer oder Werkzeug, Arbeit am Boden
export const CRAFT = new Set(['holzfaeller', 'steinmetz', 'bergmann', 'handwerker', 'baumeister', 'arbeiter']);
export const FIELD = new Set(['bauer', 'sammler', 'fischer', 'jaeger', 'heiler']);
export const SKIN = ['#f1c9a5', '#e0ac85', '#c68d62', '#a86e47', '#8a5634', '#6b4229'].map(c => new THREE.Color(c));
// seit 19.10.2026 mehr Haar und Hosenfarben (Paket 5): Kupfer, Rotblond, Aschblond, Kastanie; Khaki, Marine, Rost, Schiefer
export const HAIR = ['#2b211c', '#3d2a1f', '#5a3d27', '#7a5232', '#b08a4e', '#d8b878', '#8a3b22', '#1c1c22', '#a0522d', '#c27a45', '#cbb89a', '#4a2a22'].map(c => new THREE.Color(c));
export const PANTS = ['#5a4a3a', '#3e4a5c', '#6b5a44', '#4a5a46', '#7a6a58', '#54473f', '#6a5f70', '#8a7a5a', '#2e3440', '#7a4a3a', '#5a6a7a'].map(c => new THREE.Color(c));
export const GREY = new THREE.Color('#cfcac2'), SICK = new THREE.Color('#9fc28a'), GOLD = new THREE.Color('#e9b44c');
export const MAX = 2400;
// Körpergröße (seit 24.10.2026 0,18 statt 0,27, Naders Kritik: die Gebäude wirkten zu klein, die Menschen waren größer
// als die Türen mit 0,17). Gilt für Dorf, Heere, Kundschafter und Geist (dort importiert)
export const HEIGHT = 0.18;
export const FAR = 80; // größte Entfernung zur Kamera, in der Figuren gezeichnet werden
// Fehlt eine Animation bei einer Figur, nimmt sie diese
export const FALLBACK = { hammer: 'work', pickup: 'work', chat: 'idle', cheer: 'idle', fight: 'punch', work: 'idle', punch: 'hammer', run: 'walk' };
// Ton Figuren (seit 24.10.2026, Naders Wahl 1 bis 4, PLAN_GRAFIK.md): je Geschlecht zwei Figuren. Die ersten beiden laden
// sofort, die zweiten im Hintergrund nach (loadVillagers). Fehlen die Dateien, springen die alten Figuren m und f ein.
export const VILLAGERS = [{ id: 'm1', sex: 'm' }, { id: 'f1', sex: 'f' }, { id: 'm2', sex: 'm', later: true }, { id: 'f2', sex: 'f', later: true }];
export const VILLAGERS_OLD = [{ id: 'm', sex: 'm' }, { id: 'f', sex: 'f' }];
// Figur eines Menschen: fest je Person (hash) eine der Figuren seines Geschlechts aus der Liste figs
export function figFor(figs, p) {
  if (!figs._by || figs._n !== figs.length) { figs._by = { m: figs.filter(F => F.sex === 'm'), f: figs.filter(F => F.sex === 'f') }; figs._n = figs.length; }
  const L = figs._by[p.sex === 'f' ? 'f' : 'm'];
  if (!L.length) return figs._by.m[0] || figs[0];
  return L.length > 1 ? L[Math.floor(hash(p.id, 23) * L.length)] : L[0];
}

export const VS_HEAD = `
uniform sampler2D uVat; uniform vec2 uVatSize; uniform float uTime;
attribute vec4 aAnim;
vec3 vatAt(float col) {
  float fr = fract(uTime * aAnim.w + aAnim.z) * aAnim.y;
  float f0 = floor(fr), f1 = mod(f0 + 1.0, aAnim.y), k = fr - f0;
  float x = (col + 0.5) / uVatSize.x;
  vec3 a = texture2D(uVat, vec2(x, (aAnim.x + f0 + 0.5) / uVatSize.y)).xyz;
  vec3 b = texture2D(uVat, vec2(x, (aAnim.x + f1 + 0.5) / uVatSize.y)).xyz;
  return mix(a, b, k);
}
// Hüte sitzen auf dem Scheitel und neigen sich mit dem Kopf (Richtung Kopfgelenk zu Scheitel)
vec3 hatPos(vec3 p) {
  vec3 top = vatAt(uVatSize.x - 2.0), bone = vatAt(uVatSize.x - 1.0);
  vec3 d = top - bone;
  vec3 up = length(d) > 1e-4 ? normalize(d) : vec3(0.0, 1.0, 0.0);
  vec3 axis = cross(vec3(0.0, 1.0, 0.0), up);
  float sa = length(axis), ca = up.y;
  if (sa > 1e-4) { axis /= sa; p = p * ca + cross(axis, p) * sa + axis * dot(axis, p) * (1.0 - ca); }
  return top + p;
}
// Zubehör hängt an der rechten Hand (eigene Spalte vor Scheitel und Kopfgelenk, nur Figuren mit "hand")
vec3 handPos(vec3 p) { return vatAt(uVatSize.x - 3.0) + p; }
`;

// Gebackene Normale an einer Spalte (wie vatAt, Werte als n * 0,5 + 0,5 gespeichert)
export const NRM_HEAD = `
uniform sampler2D uNrm;
vec3 nrmAt(float col) {
  float fr = fract(uTime * aAnim.w + aAnim.z) * aAnim.y;
  float f0 = floor(fr), f1 = mod(f0 + 1.0, aAnim.y), k = fr - f0;
  float x = (col + 0.5) / uVatSize.x;
  vec3 a = texture2D(uNrm, vec2(x, (aAnim.x + f0 + 0.5) / uVatSize.y)).xyz;
  vec3 b = texture2D(uNrm, vec2(x, (aAnim.x + f1 + 0.5) / uVatSize.y)).xyz;
  return normalize(mix(a, b, k) * 2.0 - 1.0 + 1e-5);
}
`;
export const half = THREE.DataUtils.fromHalfFloat;
export const srgb = { r: 0, g: 0, b: 0 };
// Farbe als sRGB Werte in ein Array (für das Umfärben der Textur im Shader)
export const putSRGB = (c, arr, i) => { c.getRGB(srgb, THREE.SRGBColorSpace); arr[i] = srgb.r; arr[i + 1] = srgb.g; arr[i + 2] = srgb.b; };

// Eine Figur: Geometrie, gebackene Animationen, Material, Hüte
export class Figure {
  constructor(scene, uTime, max = MAX) {
    this.scene = scene;
    this.max = max;
    this.uni = { uVat: { value: null }, uNrm: { value: null }, uVatSize: { value: new THREE.Vector2(1, 1) }, uTime };
  }

  async load(name, textured) {
    const [meta, bin] = await Promise.all([
      fetch(`assets/people/${name}.json`).then(r => { if (!r.ok) throw new Error(name); return r.json(); }),
      fetch(`assets/people/${name}.bin`).then(r => { if (!r.ok) throw new Error(name); return r.arrayBuffer(); }),
    ]);
    const { U, W, rows, layout } = meta;
    this.clips = meta.clips;
    this.forward = meta.forward;
    this.textured = textured;
    this.headR = textured ? meta.headR * 0.8 : meta.head.r;
    const index = new Uint16Array(bin, layout.index[0], layout.index[1]);
    const tex = new Uint16Array(bin, layout.tex[0], layout.tex[1]);
    const vat = new THREE.DataTexture(tex, W, rows, THREE.RGBAFormat, THREE.HalfFloatType);
    vat.magFilter = vat.minFilter = THREE.NearestFilter;
    vat.needsUpdate = true;
    this.uni.uVat.value = vat;
    this.uni.uVatSize.value.set(W, rows);
    // Rumpf je Animation (Kopfgelenk im ersten Bild): Sitzende sitzen nicht über dem Nullpunkt, so passen sie auf Stuhl und Bank
    this.trunk = {};
    for (const [k, c] of Object.entries(this.clips)) { const o = (c.row * W + W - 1) * 4; this.trunk[k] = [half(tex[o]), half(tex[o + 2])]; }

    const g = new THREE.BufferGeometry();
    // Zeichenpunkte: bei den Dorfbewohnern zeigt vid auf die animierte Position (Nähte teilen sich eine), sonst 1 zu 1
    const RV = meta.RV || U;
    const vids = layout.vid ? new Uint16Array(bin, layout.vid[0], layout.vid[1]) : null;
    const pos = new Float32Array(RV * 3), vid = new Float32Array(RV), nor = new Float32Array(RV * 3);
    const r0 = (this.clips.idle || this.clips.walk).row;
    for (let u = 0; u < RV; u++) {
      const pid = vids ? vids[u] : u, o = (r0 * W + pid) * 4;
      pos[u * 3] = half(tex[o]); pos[u * 3 + 1] = half(tex[o + 1]); pos[u * 3 + 2] = half(tex[o + 2]);
      vid[u] = pid; nor[u * 3 + 1] = 1;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('vid', new THREE.BufferAttribute(vid, 1));
    if (textured) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(bin, layout.uv[0], layout.uv[1]).slice(), 2));
      g.setAttribute('region', new THREE.BufferAttribute(Float32Array.from(new Uint8Array(bin, layout.region[0], layout.region[1])), 1));
    } else {
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(U * 3).fill(1), 3));
      g.setAttribute('part', new THREE.BufferAttribute(Float32Array.from(new Uint8Array(bin, layout.part[0], layout.part[1])), 1));
    }
    g.setIndex(new THREE.BufferAttribute(index, 1));
    const inst = (n, s) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(this.max * s), s); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a; };
    this.aAnim = inst('aAnim', 4);
    this.aSkin = inst('aSkin', 3); this.aHair = inst('aHair', 3); this.aShirt = inst('aShirt', 3); this.aPants = inst('aPants', 3);

    const uni = this.uni;
    // Weiche Normalen je Bild (seit 19.10.2026 mitgebacken, Paket 5): vorher zeigte jede Normale nach oben,
    // die Dorfbewohner waren überall gleich hell und wirkten flach
    const smooth = textured && !!layout.nrm;
    if (smooth) {
      const nt = new THREE.DataTexture(new Uint8Array(bin, layout.nrm[0], layout.nrm[1]), W, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
      nt.magFilter = nt.minFilter = THREE.NearestFilter;
      nt.needsUpdate = true;
      uni.uNrm.value = nt;
    }
    let mat;
    if (textured) {
      const map = await new THREE.TextureLoader().loadAsync(`assets/people/${name}.webp`);
      map.colorSpace = THREE.SRGBColorSpace; map.flipY = false; map.anisotropy = 8;
      // Umfärbe Gewichte (seit 24.10.2026, tools/build_villager_tex.py): R Hemd, G Haut, B Braun, in voller Auflösung
      // vorab gerechnet. Fehlt die Karte, rät der Shader wie früher aus der Farbe.
      const wmap = await new THREE.TextureLoader().loadAsync(`assets/people/${name}_w.webp`).catch(() => null);
      if (wmap) { wmap.flipY = false; wmap.anisotropy = 8; wmap.colorSpace = THREE.NoColorSpace; uni.uWeights = { value: wmap }; }
      mat = new THREE.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0 });
      const R = meta.refs;
      const v3 = a => new THREE.Vector3(...a);
      Object.assign(uni, { uCloth: { value: v3(R.cloth) }, uSkinRef: { value: v3(R.skin) }, uBrown: { value: v3(R.brown) } });
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, uni);
        sh.vertexShader = VS_HEAD + (smooth ? NRM_HEAD : '') + `attribute float vid; attribute float region; attribute vec3 aSkin; attribute vec3 aHair; attribute vec3 aShirt; attribute vec3 aPants;
          varying float vRegion; varying vec3 vSkin; varying vec3 vHair; varying vec3 vShirt; varying vec3 vPants;\n` + sh.vertexShader
          .replace('#include <begin_vertex>', 'vec3 transformed = vatAt(vid); vRegion = region; vSkin = aSkin; vHair = aHair; vShirt = aShirt; vPants = aPants;');
        if (smooth) sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = nrmAt(vid);');
        // Umfärben: Leinen wird zur Berufsfarbe, Haut zur Hautfarbe, Braun am Kopf zu Haaren, an den Beinen zur Hose
        sh.fragmentShader = `uniform vec3 uCloth; uniform vec3 uSkinRef; uniform vec3 uBrown;${wmap ? ' uniform sampler2D uWeights;' : ''}
          varying float vRegion; varying vec3 vSkin; varying vec3 vHair; varying vec3 vShirt; varying vec3 vPants;\n` + sh.fragmentShader
          .replace('#include <map_fragment>', `#include <map_fragment>
          {
            vec3 c = sqrt(max(diffuseColor.rgb, vec3(0.0)));
            float L = dot(c, vec3(0.333));
            ${wmap ? `vec3 W = texture2D(uWeights, vMapUv).rgb; float wC = W.r, wS = W.g, wB = W.b;` : `
            float wC = 1.0 - smoothstep(0.09, 0.2, distance(c, uCloth));
            float wS = (1.0 - smoothstep(0.08, 0.17, distance(c, uSkinRef))) * (1.0 - wC);
            float wB = (1.0 - smoothstep(0.09, 0.19, distance(c, uBrown))) * (1.0 - wC) * (1.0 - wS);`}
            vec3 o = c;
            o = mix(o, vShirt * (L / dot(uCloth, vec3(0.333))), wC);
            o = mix(o, vSkin * (L / dot(uSkinRef, vec3(0.333))), wS);
            if (vRegion < 0.5) o = mix(o, vHair * (L / dot(uBrown, vec3(0.333))), wB);
            else if (vRegion > 1.5 && vRegion < 2.5) o = mix(o, vPants * (L / dot(uBrown, vec3(0.333))), wB);
            diffuseColor.rgb = o * o;
          }`);
      };
      mat.customProgramCacheKey = () => 'villager-vat' + smooth + !!wmap;
    } else {
      mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.78, metalness: 0 });
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, uni);
        sh.vertexShader = VS_HEAD + 'attribute float vid; attribute float part; attribute vec3 aSkin; attribute vec3 aHair; attribute vec3 aShirt; attribute vec3 aPants;\n' + sh.vertexShader
          .replace('#include <begin_vertex>', 'vec3 transformed = vatAt(vid);')
          .replace('#include <color_vertex>', `#include <color_vertex>
            vColor = part < 0.5 ? aSkin : part < 1.5 ? vec3(0.12, 0.1, 0.1) : part < 2.5 ? aHair : part < 3.5 ? aShirt : aPants;`);
      };
      mat.customProgramCacheKey = () => 'people-vat';
    }
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = VS_HEAD + 'attribute float vid;\n' + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = vatAt(vid);');
    };
    depth.customProgramCacheKey = () => 'people-vat-depth';

    const mesh = new THREE.InstancedMesh(g, mat, this.max);
    mesh.customDepthMaterial = depth;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.userData.kind = 'people';
    this.scene.add(mesh);
    this.mesh = mesh;
    this.hats = this.makeHats();
    this.items = meta.hand >= 0 ? this.makeItems() : null;
    this.n = 0;
    return this;
  }

  // Zubehör je Beruf (seit 19.10.2026, Paket 5), in Figurenmaßen (Höhe 1), hängt von der Hand nach unten:
  // Korb, Eimer, Beutel, Netz, Axt, Hammer, Speer, Stab, Laterne, Buch
  makeItems() {
    const uni = this.uni;
    const paint = (g, c) => {
      g = g.index ? g.toNonIndexed() : g;
      if (g.attributes.uv) g.deleteAttribute('uv');
      const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.toArray(a, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return g;
    };
    const cyl = (r0, r1, h, y, c, seg = 8, x = 0, z = 0) => paint(new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y, z), c);
    const box = (w, h, d, x, y, z, c) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);
    const ball = (r, x, y, z, c, sx = 1, sy = 1, sz = 1) => paint(new THREE.IcosahedronGeometry(r, 1).scale(sx, sy, sz).translate(x, y, z), c);
    const arc = (r, y, c) => paint(new THREE.TorusGeometry(r, 0.006, 4, 10, Math.PI).translate(0, y, 0), c);
    const shapes = {
      korb: [cyl(0.075, 0.058, 0.08, -0.13, '#c9a46a', 10), cyl(0.077, 0.077, 0.012, -0.093, '#a8844e', 10), arc(0.072, -0.095, '#a8844e'),
        ball(0.028, -0.025, -0.085, 0.01, '#d8503a'), ball(0.026, 0.025, -0.087, -0.015, '#e8b844'), ball(0.024, 0.005, -0.08, 0.03, '#7fae5a')],
      eimer: [cyl(0.055, 0.045, 0.08, -0.13, '#9b7450', 10), cyl(0.057, 0.057, 0.01, -0.1, '#575c66', 10), cyl(0.047, 0.047, 0.01, -0.155, '#575c66', 10), arc(0.052, -0.09, '#575c66'), cyl(0.05, 0.05, 0.004, -0.095, '#7cc4cf', 10)],
      beutel: [ball(0.06, 0, -0.1, 0, '#d8c8a0', 1, 1.15, 0.9), cyl(0.018, 0.026, 0.035, -0.035, '#c4b48a', 6), cyl(0.02, 0.02, 0.008, -0.05, '#8a6a4a', 6)],
      netz: [ball(0.065, 0, -0.1, 0, '#6f7a64', 1.3, 0.8, 0.9), ball(0.012, 0.05, -0.09, 0.03, '#e8b844'), ball(0.012, -0.05, -0.11, -0.02, '#e8b844'), ball(0.012, 0.0, -0.06, 0.05, '#e8b844')],
      axt: [cyl(0.011, 0.012, 0.36, -0.13, '#9b7450', 5), box(0.012, 0.05, 0.075, 0, 0.035, 0.03, '#8e939b')],
      hammer: [cyl(0.01, 0.011, 0.24, -0.08, '#9b7450', 5), box(0.03, 0.035, 0.08, 0, 0.03, 0, '#575c66')],
      speer: [cyl(0.009, 0.009, 0.95, 0.0, '#8a6a4a', 5), paint(new THREE.ConeGeometry(0.02, 0.09, 5).translate(0, 0.52, 0), '#b9bec6')],
      stab: [cyl(0.011, 0.012, 0.85, -0.05, '#7d5a3e', 5), ball(0.024, 0, 0.39, 0, '#6d4a32')],
      laterne: [cyl(0.004, 0.004, 0.05, -0.025, '#3a3532', 3), box(0.05, 0.065, 0.05, 0, -0.085, 0, '#ffd27a'), paint(new THREE.ConeGeometry(0.038, 0.03, 4).rotateY(Math.PI / 4).translate(0, -0.038, 0), '#3a3532'), box(0.056, 0.008, 0.056, 0, -0.12, 0, '#3a3532')],
      buch: [box(0.03, 0.1, 0.075, 0, -0.04, 0.0, '#7a2e2a'), box(0.024, 0.092, 0.07, 0.004, -0.04, 0.0, '#f1e6d0')],
      // Angel (seit 21.10.2026, Unternehmung Angeln): Rute schräg nach vorn oben, Schnur hängt bis zum Wasser
      angel: [paint(new THREE.CylinderGeometry(0.004, 0.009, 0.62, 5).rotateX(0.95).translate(0, 0.18, 0.25), '#8a6a4a'),
        paint(new THREE.CylinderGeometry(0.0022, 0.0022, 0.62, 3).translate(0, 0.05, 0.5), '#e8e2d6'), cyl(0.014, 0.014, 0.02, -0.02, '#575c66', 6, 0, 0.03)],
      // Waffen der Heere (seit 24.10.2026, render/armies.js): Keule, Schwert, Bogen, Muskete mit Bajonett, Gewehr
      keule: [cyl(0.026, 0.012, 0.3, -0.04, '#8a6a4a', 6), ball(0.034, 0, 0.12, 0, '#6d4a32', 1, 1.2, 1)],
      schwert: [cyl(0.011, 0.011, 0.08, -0.02, '#6d4a32', 6), box(0.014, 0.014, 0.1, 0, 0.026, 0, '#c9a24a'), box(0.012, 0.3, 0.034, 0, 0.18, 0, '#d4d8de'),
        paint(new THREE.ConeGeometry(0.017, 0.05, 4).rotateY(Math.PI / 4).scale(0.7, 1, 1.4).translate(0, 0.355, 0), '#d4d8de'), ball(0.016, 0, -0.068, 0, '#c9a24a')],
      bogen: [paint(new THREE.TorusGeometry(0.26, 0.009, 4, 14, 2.0).rotateZ(-1.0).translate(-0.26, 0, 0).rotateY(-Math.PI / 2), '#7a5232'),
        paint(new THREE.CylinderGeometry(0.0022, 0.0022, 0.44, 3).translate(0, 0, -0.12), '#efe9dc')],
      muskete: [box(0.024, 0.16, 0.04, 0, -0.1, 0.006, '#7a5232'), cyl(0.008, 0.009, 0.62, 0.21, '#3e3a38', 6), box(0.03, 0.04, 0.018, 0, 0.0, 0.012, '#c9a24a'),
        paint(new THREE.ConeGeometry(0.006, 0.12, 4).translate(0, 0.58, 0), '#d4d8de')],
      gewehr: [box(0.022, 0.13, 0.038, 0, -0.1, 0.004, '#4a4038'), box(0.026, 0.3, 0.03, 0, 0.1, 0, '#2e3034'), cyl(0.007, 0.007, 0.16, 0.33, '#2e3034', 6),
        box(0.02, 0.07, 0.03, 0, 0.0, 0.03, '#2e3034')],
    };
    const items = {};
    for (const [k, parts] of Object.entries(shapes)) {
      const g = mergeGeometries(parts);
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 4), 4);
      anim.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aAnim', anim);
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0, emissive: k === 'laterne' ? new THREE.Color('#ff9a4a') : new THREE.Color(0), emissiveIntensity: k === 'laterne' ? 0.35 : 0 });
      mat.onBeforeCompile = sh => { Object.assign(sh.uniforms, uni); sh.vertexShader = VS_HEAD + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = handPos(position);'); };
      mat.customProgramCacheKey = () => 'people-item' + (k === 'laterne');
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      depth.onBeforeCompile = sh => { Object.assign(sh.uniforms, uni); sh.vertexShader = VS_HEAD + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = handPos(position);'); };
      depth.customProgramCacheKey = () => 'people-item-depth';
      const m = new THREE.InstancedMesh(g, mat, this.max);
      m.customDepthMaterial = depth;
      m.castShadow = true; m.frustumCulled = false; m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(m);
      items[k] = { m, anim, n: 0 };
    }
    return items;
  }

  clip(name) {
    let k = name;
    for (let i = 0; i < 4 && !this.clips[k]; i++) k = FALLBACK[k] || 'idle';
    return this.clips[k] || this.clips.idle || this.clips.walk;
  }

  // Hüte als eigene InstancedMeshes, jeder Hut folgt über dieselbe Animation dem Kopf seiner Figur
  makeHats() {
    const r = this.headR, uni = this.uni;
    const paint = (g, c) => {
      g = g.index ? g.toNonIndexed() : g;
      if (g.attributes.uv) g.deleteAttribute('uv');
      const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.toArray(a, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return g;
    };
    const dome = (rad, frac, y, z = 0) => new THREE.SphereGeometry(rad, 16, 8, 0, Math.PI * 2, 0, Math.PI * frac).scale(1, 1, 1.12).translate(0, y, z);
    const shapes = {
      stroh: [
        paint(new THREE.CylinderGeometry(r * 2.2, r * 2.3, r * 0.14, 20).translate(0, -r * 0.52, 0.004), '#e6c77e'),
        paint(new THREE.CylinderGeometry(r * 1.0, r * 1.12, r * 0.62, 16).translate(0, -r * 0.2, 0.004), '#e9cd88'),
        paint(new THREE.CylinderGeometry(r * 1.13, r * 1.13, r * 0.16, 16).translate(0, -r * 0.42, 0.004), '#9b6a3a'),
      ],
      helm: [
        paint(dome(r * 1.18, 0.52, -r * 0.92), '#ffffff'),
        paint(new THREE.TorusGeometry(r * 1.16, r * 0.09, 6, 18).rotateX(Math.PI / 2).scale(1, 1, 1.12).translate(0, -r * 0.92, 0), '#d9d2c4'),
        paint(new THREE.BoxGeometry(r * 0.16, r * 0.62, r * 0.12).translate(0, -r * 1.08, r * 1.24), '#d9d2c4'),
      ],
      kapuze: [
        paint(dome(r * 1.26, 0.62, -r * 0.98, -r * 0.14), '#ffffff'),
        paint(new THREE.ConeGeometry(r * 0.5, r * 0.9, 8).rotateX(-1.9).translate(0, -r * 0.55, -r * 1.25), '#ffffff'),
      ],
      muetze: [
        paint(dome(r * 1.1, 0.48, -r * 0.84), '#ffffff'),
        paint(new THREE.TorusGeometry(r * 1.08, r * 0.12, 6, 18).rotateX(Math.PI / 2).scale(1, 1, 1.12).translate(0, -r * 0.82, 0), '#e8e2d6'),
        paint(new THREE.IcosahedronGeometry(r * 0.32, 1).translate(0, r * 0.28, 0), '#f3eee4'),
      ],
      // Helme der Heere je Epoche (seit 24.10.2026, render/armies.js): Bronzehelm mit Rosshaarkamm, Dreispitz, Käppi
      kamm: [
        paint(dome(r * 1.18, 0.55, -r * 0.92), '#ffffff'),
        paint(new THREE.BoxGeometry(r * 0.28, r * 0.5, r * 1.9).translate(0, r * 0.32, -r * 0.1), '#c8413a'),
        paint(new THREE.BoxGeometry(r * 0.5, r * 0.62, r * 0.14).translate(r * 0.72, -r * 1.18, r * 0.7), '#ffffff'),
        paint(new THREE.BoxGeometry(r * 0.5, r * 0.62, r * 0.14).translate(-r * 0.72, -r * 1.18, r * 0.7), '#ffffff'),
      ],
      dreispitz: [
        paint(new THREE.CylinderGeometry(r * 1.85, r * 1.9, r * 0.12, 3).rotateY(Math.PI / 6).translate(0, -r * 0.48, 0), '#ffffff'),
        paint(dome(r * 1.08, 0.5, -r * 0.6), '#ffffff'),
        paint(new THREE.TorusGeometry(r * 1.55, r * 0.08, 4, 3).rotateX(Math.PI / 2).rotateY(Math.PI / 6).translate(0, -r * 0.4, 0), '#e9d9a8'),
      ],
      kepi: [
        paint(new THREE.CylinderGeometry(r * 0.98, r * 1.12, r * 0.85, 14).rotateX(-0.12).translate(0, -r * 0.42, -r * 0.05), '#ffffff'),
        paint(new THREE.CylinderGeometry(r * 0.75, r * 0.75, r * 0.06, 12, 1, false, 0, Math.PI).rotateY(-Math.PI / 2).translate(0, -r * 0.86, r * 0.92), '#2a2624'),
        paint(new THREE.TorusGeometry(r * 1.1, r * 0.06, 4, 16).rotateX(Math.PI / 2).translate(0, -r * 0.76, 0), '#2a2624'),
      ],
      krone: [
        paint(new THREE.CylinderGeometry(r * 0.92, r * 0.88, r * 0.42, 14, 1, true).translate(0, -r * 0.05, 0), '#f2c14e'),
        ...Array.from({ length: 6 }, (_, i) => { const a = i / 6 * Math.PI * 2; return paint(new THREE.ConeGeometry(r * 0.16, r * 0.42, 5).translate(Math.cos(a) * r * 0.9, r * 0.36, Math.sin(a) * r * 0.9 * 1.05), '#f2c14e'); }),
        paint(new THREE.IcosahedronGeometry(r * 0.13, 0).translate(0, -r * 0.02, r * 0.97), '#d9604c'),
      ],
    };
    const hats = {};
    for (const [k, parts] of Object.entries(shapes)) {
      const g = mergeGeometries(parts);
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 4), 4);
      anim.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aAnim', anim);
      const metal = k === 'helm' || k === 'kamm';
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: metal || k === 'krone' ? 0.45 : 0.85, metalness: metal ? 0.35 : k === 'krone' ? 0.5 : 0 });
      mat.onBeforeCompile = sh => { Object.assign(sh.uniforms, uni); sh.vertexShader = VS_HEAD + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = hatPos(position);'); };
      mat.customProgramCacheKey = () => 'people-hat';
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      depth.onBeforeCompile = sh => { Object.assign(sh.uniforms, uni); sh.vertexShader = VS_HEAD + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = hatPos(position);'); };
      depth.customProgramCacheKey = () => 'people-hat-depth';
      const m = new THREE.InstancedMesh(g, mat, this.max);
      m.customDepthMaterial = depth;
      m.castShadow = true; m.frustumCulled = false; m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      this.scene.add(m);
      hats[k] = { m, anim, n: 0 };
    }
    return hats;
  }

  begin(shadow) {
    this.n = 0;
    for (const H of Object.values(this.hats)) H.n = 0;
    if (this.items) for (const H of Object.values(this.items)) H.n = 0;
    if (this.mesh.castShadow !== shadow) { this.mesh.castShadow = shadow; for (const H of Object.values(this.hats)) H.m.castShadow = shadow; if (this.items) for (const H of Object.values(this.items)) H.m.castShadow = shadow; }
  }

  end() {
    const n = this.n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const H of Object.values(this.hats)) {
      H.m.count = H.n; H.m.instanceMatrix.needsUpdate = true; H.anim.needsUpdate = true;
      if (H.m.instanceColor) H.m.instanceColor.needsUpdate = true;
    }
    if (this.items) for (const H of Object.values(this.items)) { H.m.count = H.n; H.m.instanceMatrix.needsUpdate = true; H.anim.needsUpdate = true; }
    for (const a of [this.aAnim, this.aSkin, this.aHair, this.aShirt, this.aPants]) { a.needsUpdate = true; a.addUpdateRange(0, n * a.itemSize); }
  }
}

// Eine Person in eine Figur schreiben: Lage (Matrix), Animation, Farben, Hut. Draußen und im Haus gleich, damit man
// jeden Menschen drinnen wiedererkennt. look (seit 24.10.2026, Uniformen der Heere): { shirt, pants, hat, hatCol }
// ersetzt Kittel, Hose und Hut (hat: null barhäuptig), Farben als THREE.Color
export function drawPerson(F, p, matrix, mode, rate, kid, old, indoor = false, item, look) {
  const n = F.n++;
  F.mesh.setMatrixAt(n, matrix);
  const C = F.clip(mode), A = F.aAnim.array;
  A[n * 4] = C.row; A[n * 4 + 1] = C.frames; A[n * 4 + 2] = hash(p.id, 17); A[n * 4 + 3] = rate / C.dur;
  const c = TMP;
  const put = F.textured ? putSRGB : (col, arr, i) => col.toArray(arr, i);
  put(SKIN[Math.floor(hash(p.clan ? p.clan.length * 7 + p.clan.charCodeAt(0) : p.id, 4) * 6)], F.aSkin.array, n * 3);
  put(old ? GREY : HAIR[Math.floor(hash(p.id, 18) * HAIR.length)], F.aHair.array, n * 3);
  c.set(p.lt ? GOLD : kid ? KIDS[Math.floor(hash(p.id, 22) * KIDS.length)] : JOBC[p.job] || '#cccccc');
  c.offsetHSL((hash(p.id, 23) - 0.5) * 0.03, (hash(p.id, 24) - 0.5) * 0.12, (hash(p.id, 25) - 0.5) * 0.1);
  if (p.sick) c.lerp(SICK, 0.5);
  if (look && look.shirt) c.copy(look.shirt);
  put(c, F.aShirt.array, n * 3);
  put(look && look.pants ? look.pants : PANTS[Math.floor(hash(p.id, 19) * PANTS.length)], F.aPants.array, n * 3);
  let hk = kid || mode === 'sleep' ? null : look && look.hat !== undefined ? look.hat : HAT_OF(p, hash(p.id, 26));
  if (indoor && (hk === 'stroh' || hk === 'helm' || hk === 'muetze')) hk = null; // drinnen nimmt man den Hut ab
  if (hk && F.hats[hk]) {
    const Hm = F.hats[hk], m = Hm.n++;
    Hm.m.setMatrixAt(m, matrix);
    for (let j = 0; j < 4; j++) Hm.anim.array[m * 4 + j] = A[n * 4 + j];
    if (look && look.hatCol) c.copy(look.hatCol);
    else if (hk === 'muetze') c.set(HAT_COLORS.muetze[Math.floor(hash(p.id, 27) * 6)]);
    else if (hk === 'kapuze') c.set(HAT_COLORS.kapuze[p.job] || '#efe9dc');
    else if (hk === 'helm') c.set('#a9afb5');
    else c.setRGB(1, 1, 1);
    Hm.m.setColorAt(m, c);
  }
  // Zubehör je Beruf in der rechten Hand: nur beim Gehen, Stehen, Rennen und Reden, nicht drinnen
  // item: undefined wie bisher nach Beruf, null nichts, sonst genau dieses (Angel, Buch, Eimer bei Unternehmungen)
  if (F.items && !indoor && (item ? true : item === undefined && !kid && CARRY_MODES.has(mode))) {
    const ik = item || ITEM_OF(p, old, hash(p.id, 31));
    const Im = ik && F.items[ik];
    if (Im) { const m = Im.n++; Im.m.setMatrixAt(m, matrix); for (let j = 0; j < 4; j++) Im.anim.array[m * 4 + j] = A[n * 4 + j]; }
  }
  return n;
}
export const CARRY_MODES = new Set(['walk', 'idle', 'run', 'chat']);
// Was jemand trägt (null = nichts), etwa sieben von zehn tragen etwas
export const ITEM_OF = (p, old, h) => {
  if (h > 0.72) return null;
  if (old && h < 0.5) return 'stab';
  switch (p.job) {
    case 'bauer': case 'sammler': return h < 0.45 ? 'korb' : 'eimer';
    case 'fischer': return h < 0.4 ? 'netz' : 'eimer';
    case 'jaeger': case 'krieger': return 'speer';
    case 'holzfaeller': return 'axt';
    case 'steinmetz': case 'handwerker': case 'baumeister': return 'hammer';
    case 'bergmann': return h < 0.4 ? 'laterne' : 'hammer';
    case 'haendler': return 'beutel';
    case 'priester': return 'stab';
    case 'heiler': return h < 0.4 ? 'korb' : 'beutel';
    case 'gelehrter': return 'buch';
    case 'arbeiter': return 'eimer';
    default: return null;
  }
};
export const TMP = new THREE.Color();
// Farben eines Menschen als Hexwerte (für Bilder in der Oberfläche, gleiche Regeln wie die Figur)
export function personLook(p, kid, old) {
  const c = new THREE.Color();
  c.set(p.lt ? GOLD : kid ? KIDS[Math.floor(hash(p.id, 22) * KIDS.length)] : JOBC[p.job] || '#cccccc');
  c.offsetHSL((hash(p.id, 23) - 0.5) * 0.03, (hash(p.id, 24) - 0.5) * 0.12, (hash(p.id, 25) - 0.5) * 0.1);
  return {
    skin: '#' + SKIN[Math.floor(hash(p.clan ? p.clan.length * 7 + p.clan.charCodeAt(0) : p.id, 4) * 6)].getHexString(),
    hair: '#' + (old ? GREY : HAIR[Math.floor(hash(p.id, 18) * HAIR.length)]).getHexString(),
    shirt: '#' + c.getHexString(),
    pants: '#' + PANTS[Math.floor(hash(p.id, 19) * PANTS.length)].getHexString(),
  };
}
export const figureScale = (p, kid, old) => (kid ? 0.66 : old ? 0.94 : 1) * (p.sex === 'f' ? 0.95 : 1) * (0.94 + hash(p.id, 15) * 0.12);
// Gibt die Liste mit den ersten Figuren zurück und hängt die übrigen an dieselbe Liste an, sobald sie geladen sind
export async function loadVillagers(scene, uTime, max) {
  const one = v => new Figure(scene, uTime, max).load('villager_' + v.id, true).then(f => Object.assign(f, { sex: v.sex, vid: v.id }));
  let figs;
  try { figs = await Promise.all(VILLAGERS.filter(v => !v.later).map(one)); }
  catch { return Promise.all(VILLAGERS_OLD.map(one)); }
  for (const v of VILLAGERS.filter(v => v.later)) one(v).then(f => figs.push(f)).catch(() => {});
  return figs;
}

