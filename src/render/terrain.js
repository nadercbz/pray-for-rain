// Weiches Gelände im Stil von Tiny Glade: sanfte Hügel, Strände, Felsen an steilen Hängen,
// dichtes Gras, Blumenwiesen, flauschige Bäume, Kiesel auf den Wegen.
// Seit 18.10.2026 für die große Welt (320 x 320): Gelände, Bäume und Felsen in Kacheln von 64 Feldern (jede wird nur
// gezeichnet, wenn sie im Bild ist, und nur neu gefärbt, wenn sich dort etwas geändert hat), Farben, Bäume und Gras je
// Lebensraum (st.tiles.bio), Flüsse als Bänder in ihrem Bett, Schnee nur, wo es kalt genug ist (Klimakarte uClimate).
// Gras, Blumen und Kiesel stehen nur rund um den Blick (follow), weit weg sieht man sie ohnehin nicht.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NX, NY, tileY } from './scene.js';
import { patch, U } from './mats.js';
import { BIOMES } from '../sim/data.js';
import { EARTH } from '../sim/earth.js';

export const RES = 2;                 // Gitterpunkte je Kachel
// Gitterpunkte je Zeile und Spalte (seit 19.10.2026 rechteckig: Erde 4097 x 2049)
export const NVX = NX * RES + 1, NVY = NY * RES + 1;
const CH = 64, CNX = Math.ceil(NX / CH), CNY = Math.ceil(NY / CH), CV = CH * RES; // Kachelgröße der Stücke, Stücke je Zeile und Spalte, Gitterschritte je Stück
let HV = new Float32Array(NVX * NVY);   // Höhe je Gitterpunkt

const idx = (x, y) => y * NX + x;
const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function smoothN(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const col = h => new THREE.Color(h);
const lin = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const BKEY = BIOMES.map(b => b.key);
// Wüstenfarben der Erde (buildEarthClimate): 1 Australien, 2 Namib und Kalahari, 3 Gobi und Atacama, 4 Südwesten Amerikas
const TINTS = [null, lin('#c4683e'), lin('#d08a52'), lin('#c9bc9a'), lin('#c97e52')];

// Bodenhöhe an einer Weltposition
export function groundY(X, Z) {
  const gx = (X + NX / 2) * RES, gz = (Z + NY / 2) * RES;
  const x0 = Math.max(0, Math.min(NVX - 2, Math.floor(gx))), z0 = Math.max(0, Math.min(NVY - 2, Math.floor(gz)));
  const fx = Math.max(0, Math.min(1, gx - x0)), fz = Math.max(0, Math.min(1, gz - z0));
  const a = HV[z0 * NVX + x0], b = HV[z0 * NVX + x0 + 1], c = HV[(z0 + 1) * NVX + x0], d = HV[(z0 + 1) * NVX + x0 + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
export const tileGround = (x, y) => groundY(x - NX / 2 + 0.5, y - NY / 2 + 0.5);
// Bodenhöhe ohne Straßenbett (für das Längsprofil der Straßen, render/roadnet.js)
let HV0 = null;
// Kacheln, auf denen keine Bäume gezeichnet werden (Flugplätze, terrain.setPads)
let BLOCK = null;
// Höhenfeld als Textur (seit 19.10.2026): Felder schmiegen sich im Shader an den Boden (buildings.js drape)
export const HTEX = new THREE.DataTexture(new Float32Array(1), 1, 1, THREE.RedFormat, THREE.FloatType);
HTEX.magFilter = HTEX.minFilter = THREE.NearestFilter;
const refreshHTEX = () => {
  if (HTEX.image.width !== NVX || HTEX.image.height !== NVY) { HTEX.dispose(); HTEX.image = { data: HV, width: NVX, height: NVY }; }
  else HTEX.image.data = HV;
  HTEX.needsUpdate = true;
};
export function baseY(X, Z) {
  const A = HV0 || HV;
  const gx = (X + NX / 2) * RES, gz = (Z + NY / 2) * RES;
  const x0 = Math.max(0, Math.min(NVX - 2, Math.floor(gx))), z0 = Math.max(0, Math.min(NVY - 2, Math.floor(gz)));
  const fx = Math.max(0, Math.min(1, gx - x0)), fz = Math.max(0, Math.min(1, gz - z0));
  const a = A[z0 * NVX + x0], b = A[z0 * NVX + x0 + 1], c = A[(z0 + 1) * NVX + x0], d = A[(z0 + 1) * NVX + x0 + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

const PAL = {
  sand: col('#eedaa8'), wetSand: col('#d9c28c'), shallow: col('#86c7b5'), deep: col('#2f7484'),
  moss: col('#8c9e6a'), alpine: col('#b8b2a8'),
  burn: col('#4c423b'), crater: col('#6b5d50'), ash: col('#6a645c'), ruin: col('#b3aa9c'),
};

// Farben je Lebensraum (A, B Grundton und Wechsel, M Wiese, F unter Wald, P magerer Boden, S Jahreszeiten mit Stärke K,
// g Grasanteil für die Feinzeichnung, sand Strand, hi Hochlage, moss Moos, red Fels rot (+) oder schwarz (-), dune Sandrippen)
const BP0 = {
  mild: { A: '#a4c96d', B: '#82b35a', M: '#c2d27a', F: '#6f9c50', P: '#b6c486', S: [null, '#bccb6c', '#c4b46a', '#b3bba8'], K: [0, 0.18, 0.42, 0.45], g: 1 },
  wald: { A: '#93c063', B: '#74a650', M: '#a9c86c', F: '#5f8e45', P: '#a9ba78', S: [null, '#a9c463', '#c2a861', '#aab3a2'], K: [0, 0.16, 0.45, 0.45], g: 1 },
  taiga: { A: '#86a368', B: '#6d8f5a', M: '#97ad6e', F: '#557a4c', P: '#a4aa82', S: [null, '#8fa766', '#a8a06a', '#c9d0d2'], K: [0, 0.1, 0.3, 0.55], g: 0.8, sand: '#c9c3b5' },
  tundra: { A: '#a9a77e', B: '#939a72', M: '#bdb48a', F: '#7f8c66', P: '#b9b294', S: [null, '#b0aa7a', '#b89c6c', '#dfe3e5'], K: [0, 0.1, 0.45, 0.65], g: 0.5, sand: '#c6c2b8' },
  eis: { A: '#eef3f6', B: '#d6e3ec', M: '#f6f8fa', F: '#d6e3ec', P: '#e4ecf0', S: [null, null, null, null], K: [0, 0, 0, 0], g: 0, sand: '#e2e8ec', hi: '#f2f5f7' },
  steppe: { A: '#c3c47e', B: '#a8b06a', M: '#d3c98c', F: '#8e9e5c', P: '#cfc595', S: [null, '#d2c27c', '#c9ad72', '#bfbaa2'], K: [0, 0.35, 0.4, 0.4], g: 0.9 },
  sumpf: { A: '#7f9757', B: '#677f4a', M: '#8e9a5a', F: '#566f42', P: '#7a7552', S: [null, '#7f9254', '#998a55', '#a2a69a'], K: [0, 0.1, 0.35, 0.4], g: 0.9, wet: '#56684c', sand: '#857f5c' },
  savanne: { A: '#d4c272', B: '#bead5e', M: '#c9c06e', F: '#a3a25a', P: '#dcc98a', S: ['#b3ba62', null, '#d6b768', null], K: [0.3, 0, 0.2, 0], g: 1 },
  wueste: { A: '#ecd5a2', B: '#e0c28c', M: '#f1dcae', F: '#d8bd88', P: '#ecd5a2', S: [null, null, null, null], K: [0, 0, 0, 0], g: 0, sand: '#ecd2a0', hi: '#cdb08a', moss: null, dune: 1 },
  tropen: { A: '#62a84c', B: '#4b933e', M: '#74b453', F: '#3e7f35', P: '#7da05a', S: [null, null, null, null], K: [0, 0, 0, 0], g: 1, sand: '#f4e8c8', moss: '#5f9a4a' },
  vulkan: { A: '#66605a', B: '#4f4b48', M: '#7f8d55', F: '#5f7448', P: '#5a5550', S: [null, null, null, '#9a9a98'], K: [0, 0, 0, 0.3], g: 0.25, sand: '#55504c', hi: '#4a4644', moss: null, red: -0.8 },
  salz: { A: '#f2efe7', B: '#e3ded3', M: '#f7f5ef', F: '#e3ded3', P: '#f2efe7', S: [null, null, null, null], K: [0, 0, 0, 0], g: 0, sand: '#efece4', moss: null },
  canyon: { A: '#cf8452', B: '#b9693f', M: '#dc9a62', F: '#a86a40', P: '#cf8452', S: [null, null, null, null], K: [0, 0, 0, 0], g: 0.05, sand: '#d9a476', hi: '#b8714a', moss: null, red: 1, dune: 0.4 },
  oase: { A: '#86b85a', B: '#6ba44b', M: '#9cc368', F: '#5a9444', P: '#a5b56c', S: [null, null, null, null], K: [0, 0, 0, 0], g: 1, sand: '#ecd2a0' },
  fjord: { A: '#7f9e64', B: '#678a56', M: '#8fa86a', F: '#527548', P: '#9da482', S: [null, '#88a262', '#a69e68', '#cdd4d6'], K: [0, 0.1, 0.32, 0.55], g: 0.8, sand: '#bdb9b0' },
};
const BP = BKEY.map(k => {
  const p = BP0[k] || BP0.mild;
  return {
    A: lin(p.A), B: lin(p.B), M: lin(p.M), F: lin(p.F), P: lin(p.P), S: p.S.map(c => (c ? lin(c) : null)), K: p.K, g: p.g,
    sand: lin(p.sand || '#eedaa8'), hi: lin(p.hi || '#b8b2a8'), moss: p.moss === null ? null : lin(p.moss || '#8c9e6a'), red: p.red || 0, dune: p.dune || 0,
    wet: p.wet ? lin(p.wet) : null,
  };
});

// Boden Shader: alles in Weltkoordinaten, Feinheiten blenden mit der Entfernung aus (fwidth), damit nichts flimmert
const TERRAIN_HEAD = `uniform sampler2D uRoad, uDens; uniform vec3 uPath, uPathEdge, uWorn, uCobble, uCobbleGap, uSlab, uAsphalt, uRockA, uRockB; varying vec4 vSurf;
float th2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(th2(i), th2(i + vec2(1., 0.)), f.x), mix(th2(i + vec2(0., 1.)), th2(i + vec2(1., 1.)), f.x), f.y); }
`;
const TERRAIN_DETAIL = `{
  vec2 xz = vWPos.xz;
  float gr = vSurf.x, rk = vSurf.y, dune = vSurf.z, red = vSurf.w;
  float px = length(fwidth(xz));
  float fine = 1.0 - smoothstep(0.035, 0.11, px);
  float nA = tn2(xz * 0.19), nB = tn2(xz * 0.83 + 7.3), nC = tn2(xz * 3.6 + 1.7);
  vec3 c = diffuseColor.rgb;
  // Wiese: kühle satte und warme sonnige Flecken, feines Büschelrauschen
  float v = nA * 0.55 + nB * 0.45;
  c = mix(c, mix(c * vec3(0.80, 0.95, 0.86), c * vec3(1.14, 1.08, 0.80), smoothstep(0.28, 0.74, v)), gr * 0.8);
  c *= 1.0 + (nC - 0.5) * 0.18 * gr * fine;
  // Sand: Dünenrücken und feine Windrippeln (Wüste, rote Schluchten)
  if (dune > 0.01) {
    float big = sin(xz.x * 0.21 + xz.y * 0.09 + nA * 6.0) * 0.5 + 0.5;
    float rip = sin(dot(xz, vec2(5.2, 2.1)) + nB * 3.0) * 0.5 + 0.5;
    c *= 1.0 + ((big - 0.5) * 0.16 + (rip - 0.5) * 0.07 * fine) * dune;
  }
  // Felswände mit Schichtbändern (rot in den Schluchten, schwarz am Vulkan)
  if (rk > 0.002) {
    float s = vWPos.y * ${NX > 1000 ? '0.5 + nB * 0.45 + nA * 0.25' : '2.3 + nB * 1.4 + nA * 0.8'}; // Erde: Bänder weit auseinander, kaum verbogen (Wände bis 40 hoch)
    float band = fract(s);
    vec3 rc = mix(uRockB, uRockA, ${NX > 1000 ? '0.35 + 0.4 * ' : ''}smoothstep(0.08, 0.3, band) * smoothstep(0.98, 0.72, band));
    if (red > 0.01) rc = mix(rc, mix(vec3(0.52, 0.2, 0.09), vec3(0.75, 0.38, 0.18), smoothstep(0.1, 0.5, band) * smoothstep(1.0, 0.7, band)), red);
    if (red < -0.01) rc = mix(rc, vec3(0.06, 0.055, 0.055) * (0.8 + band * 0.5), -red);
    rc *= 0.88 + nC * 0.24;
    c = mix(c, rc, rk);
  }
  // nasser Sand direkt über dem Wasser
  float wet = smoothstep(0.26, 0.07, vWPos.y) * (1.0 - gr) * (1.0 - rk) * step(-0.05, vWPos.y);
  c *= 1.0 - wet * 0.2;
  // Wege aus der Wegekarte (R Trampelpfad, G Pflaster, B Asphalt, A Platten), Kanten verwirbelt
  vec2 uv = (xz + vec2(${(NX / 2).toFixed(1)}, ${(NY / 2).toFixed(1)})) / vec2(${NX.toFixed(1)}, ${NY.toFixed(1)});
  vec2 wp = vec2(tn2(xz * 1.7) - 0.5, tn2(xz * 1.7 + 5.2) - 0.5) * vec2(${(0.45 / NX).toFixed(6)}, ${(0.45 / NY).toFixed(6)});
  vec4 R = texture2D(uRoad, uv + wp);
  float nP = tn2(xz * 2.4 + 3.1);
  float paved = max(R.g, max(R.b, R.a));
  c = mix(c, uWorn * (0.9 + nB * 0.18), smoothstep(0.08, 0.45, R.r) * gr * 0.32);
  float dens = texture2D(uDens, uv).r;
  float hn = tn2(xz * 0.55 + 11.0) * 0.65 + tn2(xz * 1.9 + 4.0) * 0.35;
  float hole = smoothstep(0.62 - dens * 0.3, 0.76 - dens * 0.26, hn) * (1.0 - smoothstep(0.2, 0.5, paved));
  float tv = R.r + (nP - 0.5) * 0.26 - hole * 0.6;
  float trail = smoothstep(0.47, 0.53, tv);
  float rim = smoothstep(0.39, 0.48, tv) * (1.0 - trail);
  vec3 dirt = uPath * (0.9 + nC * 0.18);
  dirt = mix(dirt, uPath * 1.16, smoothstep(0.7, 0.8, tn2(xz * 13.0)) * fine * 0.6);
  dirt = mix(dirt, uPathEdge, 0.3 * (1.0 - smoothstep(0.53, 0.72, tv)));
  c = mix(c, uPathEdge, rim * 0.45);
  c = mix(c, dirt, trail);
  float cob = smoothstep(0.42, 0.5, R.g + (nP - 0.5) * 0.14);
  if (cob > 0.002) {
    // seit 24.10.2026 (PLAN_GRAFIK.md): kleinere, gewölbte Steine mit hellen Fugen wie im Diorama (vorher 6 je Feld, dicke dunkle Fugen)
    vec2 q = xz * vec2(11.0, 13.0); q.x += step(1.0, mod(floor(q.y), 2.0)) * 0.5 + (th2(vec2(floor(q.y), 3.0)) - 0.5) * 0.3;
    vec2 id = floor(q), f = fract(q) - 0.5;
    float e = max(abs(f.x) * 1.08, abs(f.y));
    float g = smoothstep(0.36, 0.48, e + (th2(id + 7.0) - 0.5) * 0.05);
    float lod = 1.0 - smoothstep(0.035, 0.1, px);
    float dome = 1.0 - dot(f, f) * 1.4;
    vec3 sc = uCobble * (0.86 + th2(id) * 0.26) * (0.9 + dome * 0.16);
    c = mix(c, mix(uCobble * 0.95, mix(sc, mix(uCobbleGap, uCobble, 0.45), g), lod), cob);
  }
  float slab = smoothstep(0.42, 0.5, R.a + (nP - 0.5) * 0.1);
  if (slab > 0.002) {
    vec2 q = xz * vec2(4.2, 6.3); q.x += step(1.0, mod(floor(q.y), 2.0)) * 0.5;
    vec2 id = floor(q), f = fract(q) - 0.5;
    float g = smoothstep(0.455, 0.49, max(abs(f.x), abs(f.y)));
    float lod = 1.0 - smoothstep(0.1, 0.25, px);
    vec3 sc = uSlab * (0.92 + th2(id) * 0.12);
    c = mix(c, mix(uSlab * 0.95, mix(sc, uSlab * 0.74, g), lod), slab);
  }
  float av = R.b + (nP - 0.5) * 0.06;
  float asp = smoothstep(0.44, 0.5, av);
  if (asp > 0.002) {
    c = mix(c, uAsphalt * (0.94 + nC * 0.12), asp);
    c = mix(c, uSlab * 0.92, asp * (1.0 - smoothstep(0.5, 0.58, av)) * 0.7);
  }
  diffuseColor.rgb = c;
}
`;

// Findling: verbeulte Kugel, unten flach, Moos auf der Oberseite, warmes Grau an den Flanken
function boulder(seed) {
  const g = new THREE.IcosahedronGeometry(0.22, 1);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    const n = 0.82 + smoothN(v.x * 9 + seed * 3, v.z * 9 + v.y * 7) * 0.36;
    v.multiplyScalar(n);
    v.y = v.y < 0 ? v.y * 0.35 : v.y * 0.85;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const nr = g.attributes.normal, col = new Float32Array(p.count * 3), a = new THREE.Color(), moss = new THREE.Color('#8fa36a'), stone = new THREE.Color(['#b5aea3', '#a8a39b', '#bdb4a6'][seed % 3]);
  for (let i = 0; i < p.count; i++) {
    const up = nr.getY(i);
    a.copy(stone).multiplyScalar(0.86 + (p.getY(i) + 0.1) * 0.6).lerp(moss, THREE.MathUtils.smoothstep(up, 0.55, 0.85) * 0.75);
    col[i * 3] = a.r; col[i * 3 + 1] = a.g; col[i * 3 + 2] = a.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Flüsse: Wasserband mit ziehenden Streifen, Rand weich ins Ufer
const RIVER_VS = `attribute float aW; attribute float aV; attribute float aM; varying float vW; varying float vV; varying float vM; varying vec3 vP;
  #include <fog_pars_vertex>
  void main(){ vW = aW; vV = aV; vM = aM; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); vP = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
  }`;
const RIVER_FS = `uniform float uTime; uniform vec3 uDeep, uShallow, uFoam, uSky; varying float vW; varying float vV; varying float vM; varying vec3 vP;
  #include <fog_pars_fragment>
  float h1(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
  void main(){
    float e = abs(vW);
    vec3 c = mix(uDeep, uShallow, smoothstep(0.15, 0.95, e));
    float flow = vV * 1.4 - uTime * 0.55;
    float st = smoothstep(0.82, 0.97, sin(flow * 6.283 + vW * 2.3 + sin(vV * 3.1) * 1.4) * 0.5 + 0.5) * (1.0 - e) * 0.35;
    c = mix(c, uFoam, st + smoothstep(0.78, 1.0, e) * 0.25);
    c = mix(c, uSky, 0.12);
    // an der Mündung breiter, heller wie das flache Meer, und weich ausgeblendet (die Ränder zuerst)
    c = mix(c, uShallow, vM * 0.45);
    float edgeA = smoothstep(1.0, 0.72 - vM * 0.5, e);
    gl_FragColor = vec4(c, edgeA * 0.94 * (1.0 - smoothstep(0.35, 1.0, vM)));
    #include <fog_fragment>
  }`;

// Erde: Meter in Geländehöhe. Bis 600 m wie die Stufen des Archipels, darüber fast doppelt so steil und ab 1800 m
// immer steiler (Naders Wunsch 19.10.2026: Gebirge wirklich hoch und mächtig, der Himalaya extrem). Die Daten sind
// Mittel über 20 km, echte Gipfel liegen 2 bis 3 km höher. Täler und Orte bis rund 1500 m bleiben wie vorher.
// Asni 1340 m rund 4,3, Alpen 2500 m rund 16, Toubkal-Feld 3092 m rund 25, Rocky Mountains 3782 m rund 34,
// Tibet 5000 m rund 51, Anden 5100 m rund 53, Himalaya 6145 m rund 71 (ein Feld ist 1 breit)
let ABOVE_TL = null; // Erde: über der Baumgrenze (rund 900 m unter der Schneegrenze, Himalaya 3500 m, Alpen 1800 m)
const earthY = m => { m = Math.max(0, m); return 0.15 + m * 0.0019 + Math.max(0, m - 600) * 0.0016 + 1.3 * (Math.max(0, m - 1200) * 0.0025 + Math.max(0, m - 1600) * 0.0025 + 2.2e-5 * Math.pow(Math.max(0, m - 1800), 1.6)); };

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    // Feinzeichnung im Shader: Wiesenflecken, Felsbänder, nasser Sand, schmale Trampelpfade, Pflaster, Platten, Asphalt
    this.tu = {
      uRoad: { value: null },
      uPath: { value: col('#dcc9a0') }, uPathEdge: { value: col('#a48c68') }, uWorn: { value: col('#c9c48c') },
      uCobble: { value: col('#d2c5b0') }, uCobbleGap: { value: col('#8c8274') }, uSlab: { value: col('#e2ddd3') },
      uAsphalt: { value: col('#74767c') }, uRockA: { value: col('#b9b0a2') }, uRockB: { value: col('#8e877e') },
    };
    this.roadData = new Uint8Array(NX * NY * 4);
    this.roadTex = new THREE.DataTexture(this.roadData, NX, NY, THREE.RGBAFormat);
    this.roadTex.magFilter = THREE.LinearFilter; this.roadTex.minFilter = THREE.LinearFilter;
    this.roadTex.needsUpdate = true;
    this.tu.uRoad.value = this.roadTex;
    // Dichte der Trampelflächen (5x5 Mittel): große zertretene Flächen zerfallen in Pfade mit Grasinseln
    this.densData = new Uint8Array(NX * NY);
    this.densTex = new THREE.DataTexture(this.densData, NX, NY, THREE.RedFormat);
    this.densTex.magFilter = THREE.LinearFilter; this.densTex.minFilter = THREE.LinearFilter;
    this.densTex.needsUpdate = true;
    this.tu.uDens = { value: this.densTex };
    this.pathField = new Float32Array(NX * NY);
    // Klimakarte für den Schnee: R wie stark der Winter hier schneit, G Schnee, der immer liegt (Gletscher, hohe Gipfel im Norden)
    this.climData = new Uint8Array(NX * NY * 4);
    this.climTex = new THREE.DataTexture(this.climData, NX, NY, THREE.RGBAFormat);
    this.climTex.magFilter = THREE.LinearFilter; this.climTex.minFilter = THREE.LinearFilter;
    U.uClimate.value = this.climTex;
    this.mat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), { grain: 2.2, snow: 1 });
    const base = this.mat.onBeforeCompile;
    this.mat.onBeforeCompile = sh => {
      base(sh);
      Object.assign(sh.uniforms, this.tu);
      sh.vertexShader = 'attribute vec4 surf; varying vec4 vSurf;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vSurf = surf;');
      sh.fragmentShader = TERRAIN_HEAD + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + TERRAIN_DETAIL);
    };
    this.mat.customProgramCacheKey = () => 'terrain-v3';
    this.mesh = new THREE.Group(); // die Stücke, für Klicks per Strahl (intersectObject(mesh, true))
    scene.add(this.mesh);
    this.chunks = [];
    this.trees = new Trees(scene);
    this.grass = new Grass(scene);
    this.flowers = new Flowers(scene);
    this.stones = new PathStones(scene);
    this.rocks = null;
    this.rivers = null;
    this.riverU = { uTime: { value: 0 }, uDeep: { value: col('#3a8a96') }, uShallow: { value: col('#7fc9bd') }, uFoam: { value: col('#eef6f2') }, uSky: { value: col('#cfe6f6') } };
    this.local = null;
    // Die echte Erde (seit 19.10.2026, PLAN_ERDE.md E2): feine Stücke nur rund um den Blick, auf Abruf gebaut und weit weg
    // wieder freigegeben, dazu grobe Fernstücke (ein Punkt je 4 Felder) mit demselben Shader. Wo ein feines Stück liegt,
    // blendet die Ferne sich per Maske (uFine) aus. Inselwelten bauen wie bisher alle Stücke auf einmal.
    this.streaming = NX * NY > 400000;
    if (this.streaming) {
      this.fineData = new Uint8Array(CNX * CNY);
      this.fineTex = new THREE.DataTexture(this.fineData, CNX, CNY, THREE.RedFormat);
      this.fineTex.magFilter = THREE.NearestFilter; this.fineTex.minFilter = THREE.NearestFilter;
      this.fineTex.needsUpdate = true;
      this.matFar = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), { grain: 2.2, snow: 1 });
      const baseF = this.matFar.onBeforeCompile;
      const fineTex = this.fineTex;
      this.matFar.onBeforeCompile = sh => {
        baseF(sh);
        Object.assign(sh.uniforms, this.tu, { uFine: { value: fineTex } });
        sh.vertexShader = 'attribute vec4 surf; varying vec4 vSurf;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vSurf = surf;');
        sh.fragmentShader = 'uniform sampler2D uFine;\n' + TERRAIN_HEAD + sh.fragmentShader
          .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n if (texture2D(uFine, (vWPos.xz + vec2(${(NX / 2).toFixed(1)}, ${(NY / 2).toFixed(1)})) / vec2(${NX.toFixed(1)}, ${NY.toFixed(1)})).r > 0.5) discard;`)
          .replace('#include <color_fragment>', '#include <color_fragment>\n' + TERRAIN_DETAIL);
      };
      this.matFar.customProgramCacheKey = () => 'terrain-far-v1';
      this.far = [];
      this.chunkAt = new Map();
      this.active = new Set();
      this.rockAt = new Map();
    }
  }

  build(st) {
    const T = st.tiles, H = T.h;
    // Kachelhöhen weichzeichnen, Gipfel bleiben etwas schärfer
    let a = new Float32Array(NX * NY);
    // Erde: Landhöhe stufenlos aus den echten Metern (Gipfel etwas überhöht, sonst wirken Atlas, Alpen, Anden flach),
    // nur wo die Stufe noch der aus den Daten entspricht (Kräfte, die das Land formen, bleiben sichtbar)
    const E = st.earth && EARTH && EARTH.W === NX ? EARTH : null;
    for (let i = 0; i < NX * NY; i++) a[i] = E && H[i] >= 0 && H[i] === E.h[i] ? earthY(E.elev[i]) : tileY(H[i]);
    // Erde: Bergseen (Tibet, Titicaca, Victoria) lagen auf Meereshöhe, im Hochland also als tiefe Krater. Jetzt liegt
    // jeder See auf der Höhe seines niedrigsten Ufers, mit eigener Wasserfläche (lakeMesh)
    const LK = E ? this.highLakes(st, E, a) : null;
    const base = a.slice();
    // Erde: Zerklüftung je Feld (Spanne der Nachbarn), Grate kommen nur dorthin, nicht auf Hochebenen wie Tibet oder Äthiopien
    const RELIEF = E ? new Float32Array(NX * NY) : null;
    if (E) for (let y = 1; y < NY - 1; y++) for (let x = 1; x < NX - 1; x++) {
      const i = idx(x, y); if (H[i] < 0) continue;
      let lo = 1e9, hi = -1e9;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const v = base[i + dy * NX + dx]; if (v < lo) lo = v; if (v > hi) hi = v; }
      RELIEF[i] = Math.min(1, (hi - lo) / 6);
    }
    // Erde: mehr Durchgänge und kaum festgehaltene Gipfel, sonst werden die überhöhten Hänge aus Geistsicht zu Wänden
    for (let pass = 0, passes = E ? 6 : 3; pass < passes; pass++) {
      const b = new Float32Array(NX * NY);
      for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
        let s = 0, w = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.max(0, Math.min(NX - 1, x + dx)), yy = Math.max(0, Math.min(NY - 1, y + dy));
          const k = dx || dy ? (dx && dy ? 0.6 : 1) : 2;
          s += a[idx(xx, yy)] * k; w += k;
        }
        const i = idx(x, y), l = H[i];
        // Erde: Täler weich, hohe Kämme behalten ihre Höhe (sonst glätten 5 Durchgänge den Himalaya flach)
        // (Hänge und Vorberge werden breit verstrichen, so steht das Gebirge auf einem Sockel statt als Wand)
        const keep = E ? (l < 0 && !(LK && LK.mask[i]) ? 0.1 : 0.1 + 0.35 * Math.min(1, Math.max(0, (base[i] - 10) / 24))) : l >= 7 ? 0.62 : l >= 5 ? 0.45 : l >= 3 ? 0.3 : l < 0 ? 0.1 : 0.15;
        b[i] = (s / w) * (1 - keep) + base[i] * keep;
      }
      a = b;
    }
    // Erde: Vorberge. Kein Land fällt steiler als 2,4 je Feld ab (Vorwärts- und Rückwärtsdurchlauf wie eine Distanzkarte),
    // so bekommt der Himalaya einen Sockel aus Vorbergen statt als Wand aus der Ganges-Ebene zu ragen. Wasser bleibt.
    // Flaches Tiefland (Baustufe rt.hb 1 bis 3 und unter 1600 m, dazu jedes Feld mit Gebäude und seine Nachbarn) hebt sich dabei höchstens
    // um 2,5, und Berge direkt daneben steigen höchstens 5,5 je Feld an (zweiter Durchlauf von unten). So steht Meldar
    // bei Asni eben im Tal und der Toubkal ragt dahinter auf, statt dass der Ort am Hang klebt.
    const HBm = E && st._rt && st._rt.hb ? st._rt.hb : null;
    const FLAT = E ? new Float32Array(NX * NY) : null;
    if (E) {
      if (HBm) for (let i = 0; i < NX * NY; i++) if (H[i] >= 0 && HBm[i] >= 1 && HBm[i] <= 3 && E.elev[i] < 1600) FLAT[i] = 1;
      const BA = st._rt && st._rt.bldAt;
      if (BA) for (let y = 1; y < NY - 1; y++) for (let x = 1; x < NX - 1; x++) {
        if (!BA[idx(x, y)]) continue;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = idx(x + dx, y + dy); if (H[j] >= 0) FLAT[j] = 1; }
      }
      const S = 2.4, SD = S * 1.4142, CAP = 2.5, a0 = a.slice();
      // das Glätten hat Talböden mit hohen Nachbarn vermischt (Asni lag so auf 12 statt 4): flaches Land zurück auf
      // seine eigene Höhe, höchstens 0,6 darüber
      for (let i = 0; i < NX * NY; i++) if (FLAT[i] && a0[i] > base[i] + 0.6) a0[i] = a[i] = base[i] + 0.6;
      const up = (i, v) => { if (FLAT[i]) v = Math.min(v, a0[i] + CAP); if (v > a[i]) a[i] = v; };
      for (let y = 1; y < NY - 1; y++) for (let x = 1; x < NX - 1; x++) {
        const i = idx(x, y); if (H[i] < 0) continue;
        up(i, Math.max(a[i - 1] - S, a[i - NX] - S, a[i - NX - 1] - SD, a[i - NX + 1] - SD));
      }
      for (let y = NY - 2; y > 0; y--) for (let x = NX - 2; x > 0; x--) {
        const i = idx(x, y); if (H[i] < 0) continue;
        up(i, Math.max(a[i + 1] - S, a[i + NX] - S, a[i + NX + 1] - SD, a[i + NX - 1] - SD));
      }
      // Talböden und Orte: zwischen flachen Feldern höchstens 0,6 Anstieg je Feld (durch die Überhöhung wäre sonst schon
      // der Talboden so steil, dass die Häuser am Hang kleben). Höhere flache Felder sinken auf ihren tieferen Nachbarn zu.
      const F = 0.6, FD = F * 1.4142;
      for (let y = 1; y < NY - 1; y++) for (let x = 1; x < NX - 1; x++) {
        const i = idx(x, y); if (!FLAT[i]) continue;
        let v = a[i];
        if (FLAT[i - 1]) v = Math.min(v, a[i - 1] + F); if (FLAT[i - NX]) v = Math.min(v, a[i - NX] + F);
        if (FLAT[i - NX - 1]) v = Math.min(v, a[i - NX - 1] + FD); if (FLAT[i - NX + 1]) v = Math.min(v, a[i - NX + 1] + FD);
        a[i] = v;
      }
      for (let y = NY - 2; y > 0; y--) for (let x = NX - 2; x > 0; x--) {
        const i = idx(x, y); if (!FLAT[i]) continue;
        let v = a[i];
        if (FLAT[i + 1]) v = Math.min(v, a[i + 1] + F); if (FLAT[i + NX]) v = Math.min(v, a[i + NX] + F);
        if (FLAT[i + NX + 1]) v = Math.min(v, a[i + NX + 1] + FD); if (FLAT[i + NX - 1]) v = Math.min(v, a[i + NX - 1] + FD);
        a[i] = v;
      }
      if (HBm) {
        const S2 = 5.5, S2D = S2 * 1.4142, lim = new Float32Array(NX * NY).fill(1e9);
        for (let i = 0; i < NX * NY; i++) if (FLAT[i]) lim[i] = a[i];
        for (let y = 1; y < NY - 1; y++) for (let x = 1; x < NX - 1; x++) {
          const i = idx(x, y); if (H[i] < 0 || FLAT[i]) continue;
          lim[i] = Math.min(lim[i], lim[i - 1] + S2, lim[i - NX] + S2, lim[i - NX - 1] + S2D, lim[i - NX + 1] + S2D);
        }
        for (let y = NY - 2; y > 0; y--) for (let x = NX - 2; x > 0; x--) {
          const i = idx(x, y); if (H[i] < 0 || FLAT[i]) continue;
          lim[i] = Math.min(lim[i], lim[i + 1] + S2, lim[i + NX] + S2, lim[i + NX + 1] + S2D, lim[i + NX - 1] + S2D);
          if (a[i] > lim[i]) a[i] = lim[i];
        }
      }
    }
    if (LK) for (const i of LK.tiles) a[i] = Math.min(a[i], LK.surf[i] - 0.4);
    // Meeresboden (seit 19.10.2026): abseits der Küste deutlich weicher, sonst sieht man die Tiefenstufen als eckige
    // Platten durch das flache Wasser. Die Küstenlinie selbst (Wasser mit Land daneben) bleibt, wie sie ist.
    for (let pass = 0; pass < 6; pass++) {
      const b = a.slice();
      for (let y = 1; y < NY - 1; y++) for (let x = 1; x < NX - 1; x++) {
        const i = idx(x, y);
        if (H[i] >= 0 || H[i - 1] >= 0 || H[i + 1] >= 0 || H[i - NX] >= 0 || H[i + NX] >= 0 || (LK && LK.mask[i])) continue;
        let sum = 0, w = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = dx || dy ? (dx && dy ? 0.6 : 1) : 1.2; sum += a[i + dy * NX + dx] * k; w += k; }
        b[i] = Math.min(sum / w, tileY(-1) + 0.05);
      }
      a = b;
    }
    this.A = a; // geglättete Kachelhöhen, für den Teil-Neuaufbau im Baukasten (patchHeights)
    // Flussbett: wo ein Fluss fließt, liegt der Boden etwas tiefer (weich verlaufend)
    const RV = new Float32Array(NX * NY);
    if (T.river) for (let i = 0; i < NX * NY; i++) if (T.river[i] && H[i] >= 0) RV[i] = 1;
    HV = new Float32Array(NVX * NVY);
    const samp = (arr, u, v) => {
      const x0 = Math.max(0, Math.min(NX - 2, Math.floor(u))), y0 = Math.max(0, Math.min(NY - 2, Math.floor(v)));
      const fx = Math.max(0, Math.min(1, u - x0)), fy = Math.max(0, Math.min(1, v - y0));
      const p = arr[idx(x0, y0)], q = arr[idx(x0 + 1, y0)], r = arr[idx(x0, y0 + 1)], s = arr[idx(x0 + 1, y0 + 1)];
      return p + (q - p) * fx + (r - p) * fy + (p - q - r + s) * fx * fy;
    };
    const LKF = LK ? LK.maskF : null;
    for (let vy = 0; vy < NVY; vy++) for (let vx = 0; vx < NVX; vx++) {
      const u = vx / RES - 0.5, v = vy / RES - 0.5;
      let h = samp(a, u, v);
      if (E && h > 3) {
        // Erde: Grate und Gipfel statt runder Buckel, je höher, desto schroffer (bis plus 4, minus 2), nicht in Seen
        const fl = FLAT ? samp(FLAT, u, v) : 0;
        if (!(LKF && samp(LKF, u, v) > 0.2) && fl < 0.98) {
          // große Grate über 3 bis 5 Felder, dazu feinere Rippen, leicht verbogen (keine Nadelreihen)
          const wx2 = vx + (smoothN(vx * 0.05 + 7, vy * 0.05) - 0.5) * 9, wy2 = vy + (smoothN(vx * 0.05, vy * 0.05 + 7) - 0.5) * 9;
          const n1 = 1 - Math.abs(smoothN(wx2 * 0.12 + 11, wy2 * 0.12 + 5) * 2 - 1), n2 = 1 - Math.abs(smoothN(wx2 * 0.3 + 3, wy2 * 0.3 + 17) * 2 - 1);
          h += (n1 * n1 * 0.75 + n2 * n2 * 0.25 - 0.32) * Math.min(9, (h - 3) * 0.24) * (1 - fl) * (0.25 + 0.75 * samp(RELIEF, u, v)); // Bauland bleibt eben
        }
      } else if (h > 0.15) h += (smoothN(vx * 0.21, vy * 0.21) - 0.5) * (0.06 + Math.max(0, h - 1.4) * 0.12);
      const rv = samp(RV, u, v);
      if (rv > 0.05 && h > 0.18) h -= Math.min(0.2, h - 0.12) * Math.min(1, rv * 1.6);
      if (vx === 0 || vy === 0 || vx === NVX - 1 || vy === NVY - 1) h = -1.2;
      HV[vy * NVX + vx] = h;
    }
    // Erde: hohe Lagen auf Feinebene zweimal weich nachziehen (je höher, desto mehr), sonst stehen die Gipfel als
    // Kegel im Raster der Felder. Grate aus dem Rauschen bleiben, werden aber zu Kämmen statt Nadeln.
    if (E) for (let pass = 0; pass < 2; pass++) {
      const src = HV.slice();
      for (let vy = 1; vy < NVY - 1; vy++) for (let vx = 1; vx < NVX - 1; vx++) {
        const g = vy * NVX + vx, h = src[g]; if (h < 6) continue;
        const avg = (src[g - 1] + src[g + 1] + src[g - NVX] + src[g + NVX]) * 0.17 + (src[g - NVX - 1] + src[g - NVX + 1] + src[g + NVX - 1] + src[g + NVX + 1]) * 0.08;
        const w = Math.min(0.6, (h - 6) / 30);
        HV[g] = h * (1 - w) + avg * w;
      }
    }
    HV0 = HV.slice(); this.bedNet = null; this.bedW = null;
    refreshHTEX();
    this.lakeMesh(LK);
    if (this.streaming) { this.initStreaming(st); return; }
    // Normalen direkt aus dem Höhenfeld (gleich an allen Stücknähten)
    const NRM = new Float32Array(NVX * NVY * 3);
    for (let vy = 0; vy < NVY; vy++) for (let vx = 0; vx < NVX; vx++) {
      const l = HV[vy * NVX + Math.max(0, vx - 1)], r = HV[vy * NVX + Math.min(NVX - 1, vx + 1)];
      const d = HV[Math.max(0, vy - 1) * NVX + vx], u = HV[Math.min(NVY - 1, vy + 1) * NVX + vx];
      const nx = (l - r) * RES * 0.5, nz = (d - u) * RES * 0.5, len = Math.hypot(nx, 1, nz);
      const k = (vy * NVX + vx) * 3;
      NRM[k] = nx / len; NRM[k + 1] = 1 / len; NRM[k + 2] = nz / len;
    }
    // Feste Rauschwerte je Gitterpunkt (Wiesenflecken, Farbwechsel, Körnung), damit das Färben schnell geht
    this.noise = new Float32Array(NVX * NVY * 3);
    for (let vy = 0; vy < NVY; vy++) for (let vx = 0; vx < NVX; vx++) {
      const k = (vy * NVX + vx) * 3;
      this.noise[k] = smoothN(vx * 0.11 + 3, vy * 0.11 + 9);
      this.noise[k + 1] = smoothN(vx * 0.07, vy * 0.07) * 0.6 + smoothN(vx * 0.19 + 7, vy * 0.19) * 0.4;
      this.noise[k + 2] = 0.97 + hash(vx, vy) * 0.06;
    }
    // Stücke bauen (alle mit derselben Dreiecksliste)
    for (const c of this.chunks) { this.mesh.remove(c.mesh); c.mesh.geometry.dispose(); }
    this.chunks = [];
    const VS = CV + 1;
    const index = new Uint32Array(CV * CV * 6);
    let n = 0;
    for (let ly = 0; ly < CV; ly++) for (let lx = 0; lx < CV; lx++) {
      const a0 = ly * VS + lx, b0 = a0 + 1, c0 = a0 + VS, d0 = c0 + 1;
      if ((lx + ly) % 2) index.set([a0, c0, b0, b0, c0, d0], n); else index.set([a0, c0, d0, a0, d0, b0], n);
      n += 6;
    }
    const ib = new THREE.BufferAttribute(index, 1);
    for (let cz = 0; cz < CNY; cz++) for (let cx = 0; cx < CNX; cx++) {
      const pos = new Float32Array(VS * VS * 3), nrm = new Float32Array(VS * VS * 3), gidx = new Int32Array(VS * VS);
      let lo = 1e9, hi = -1e9;
      for (let ly = 0; ly < VS; ly++) for (let lx = 0; lx < VS; lx++) {
        const vx = cx * CV + lx, vy = cz * CV + ly, g = vy * NVX + vx, k = ly * VS + lx;
        gidx[k] = g;
        pos[k * 3] = vx / RES - NX / 2; pos[k * 3 + 1] = HV[g]; pos[k * 3 + 2] = vy / RES - NY / 2;
        nrm[k * 3] = NRM[g * 3]; nrm[k * 3 + 1] = NRM[g * 3 + 1]; nrm[k * 3 + 2] = NRM[g * 3 + 2];
        lo = Math.min(lo, HV[g]); hi = Math.max(hi, HV[g]);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(VS * VS * 3), 3));
      geo.setAttribute('surf', new THREE.BufferAttribute(new Float32Array(VS * VS * 4), 4));
      geo.setIndex(ib);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.mat);
      mesh.receiveShadow = true;
      this.mesh.add(mesh);
      this.chunks.push({ cx, cz, mesh, gidx, sig: -1, lo, hi, tx0: cx * CH, ty0: cz * CH, tw: CH, step: 1 });
    }
    this.buildClimate(st);
    this.buildRocks(st);
    this.buildRivers(st);
    this.buildVolcanoes(st);
    this.trees.reset();
    this.local = null;
    this.roadSig = -1;
  }

  // Teil-Neuaufbau (seit 20.10.2026, Baukasten): nur die Kacheln im Kasten [x0, x1, y0, y1] haben neue Höhen. Gleiche
  // Rechnung wie build (Glätten, Meeresboden, Flussbett, Rauschen), aber nur in einem Rand von 10 Feldern um den Kasten,
  // danach Lage und Normalen der berührten Stücke. Rund 10 statt 120 ms (plus Wasser, siehe water.patch).
  // Die Erde und ein Gelände ohne vorherigen build nehmen den vollen Weg.
  // quick (während eines Strichs): Klima, Felsen und Bäume erst am Ende des Strichs
  patchHeights(st, box, quick = false) {
    if (st.earth || this.streaming || !this.A || this.A.length !== NX * NY) { this.build(st); return null; }
    const T = st.tiles, H = T.h;
    const [bx0, bx1, by0, by1] = box;
    const cx0 = Math.max(0, bx0 - 10), cx1 = Math.min(NX - 1, bx1 + 10), cy0 = Math.max(0, by0 - 10), cy1 = Math.min(NY - 1, by1 + 10);
    const wx0 = Math.max(0, bx0 - 5), wx1 = Math.min(NX - 1, bx1 + 5), wy0 = Math.max(0, by0 - 5), wy1 = Math.min(NY - 1, by1 + 5);
    let a = new Float32Array(this.A);
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) a[idx(x, y)] = tileY(H[idx(x, y)]);
    const base = a.slice();
    for (let pass = 0; pass < 3; pass++) {
      const b = a.slice();
      for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) {
        let s = 0, w = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.max(0, Math.min(NX - 1, x + dx)), yy = Math.max(0, Math.min(NY - 1, y + dy));
          const k = dx || dy ? (dx && dy ? 0.6 : 1) : 2;
          s += a[idx(xx, yy)] * k; w += k;
        }
        const i = idx(x, y), l = H[i];
        const keep = l >= 7 ? 0.62 : l >= 5 ? 0.45 : l >= 3 ? 0.3 : l < 0 ? 0.1 : 0.15;
        b[i] = (s / w) * (1 - keep) + base[i] * keep;
      }
      a = b;
    }
    for (let pass = 0; pass < 6; pass++) {
      const b = a.slice();
      for (let y = Math.max(1, cy0); y <= Math.min(NY - 2, cy1); y++) for (let x = Math.max(1, cx0); x <= Math.min(NX - 2, cx1); x++) {
        const i = idx(x, y);
        if (H[i] >= 0 || H[i - 1] >= 0 || H[i + 1] >= 0 || H[i - NX] >= 0 || H[i + NX] >= 0) continue;
        let sum = 0, w = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = dx || dy ? (dx && dy ? 0.6 : 1) : 1.2; sum += a[i + dy * NX + dx] * k; w += k; }
        b[i] = Math.min(sum / w, tileY(-1) + 0.05);
      }
      a = b;
    }
    // nur der innere Kasten wird übernommen, der Rand dient als Umgebung für das Glätten
    for (let y = wy0; y <= wy1; y++) for (let x = wx0; x <= wx1; x++) this.A[idx(x, y)] = a[idx(x, y)];
    a = this.A;
    const samp = (arr, u, v) => {
      const x0 = Math.max(0, Math.min(NX - 2, Math.floor(u))), y0 = Math.max(0, Math.min(NY - 2, Math.floor(v)));
      const fx = Math.max(0, Math.min(1, u - x0)), fy = Math.max(0, Math.min(1, v - y0));
      const p = arr[idx(x0, y0)], q = arr[idx(x0 + 1, y0)], r = arr[idx(x0, y0 + 1)], s = arr[idx(x0 + 1, y0 + 1)];
      return p + (q - p) * fx + (r - p) * fy + (p - q - r + s) * fx * fy;
    };
    const riv = (x, y) => (T.river && x >= 0 && y >= 0 && x < NX && y < NY && T.river[idx(x, y)] && H[idx(x, y)] >= 0 ? 1 : 0);
    const rvS = (u, v) => {
      const x0 = Math.max(0, Math.min(NX - 2, Math.floor(u))), y0 = Math.max(0, Math.min(NY - 2, Math.floor(v)));
      const fx = Math.max(0, Math.min(1, u - x0)), fy = Math.max(0, Math.min(1, v - y0));
      const p = riv(x0, y0), q = riv(x0 + 1, y0), r = riv(x0, y0 + 1), s = riv(x0 + 1, y0 + 1);
      return p + (q - p) * fx + (r - p) * fy + (p - q - r + s) * fx * fy;
    };
    const gx0 = Math.max(0, (wx0 + 1) * RES), gx1 = Math.min(NVX - 1, wx1 * RES), gy0 = Math.max(0, (wy0 + 1) * RES), gy1 = Math.min(NVY - 1, wy1 * RES);
    for (let vy = gy0; vy <= gy1; vy++) for (let vx = gx0; vx <= gx1; vx++) {
      const u = vx / RES - 0.5, v = vy / RES - 0.5;
      let h = samp(a, u, v);
      if (h > 0.15) h += (smoothN(vx * 0.21, vy * 0.21) - 0.5) * (0.06 + Math.max(0, h - 1.4) * 0.12);
      const rv = rvS(u, v);
      if (rv > 0.05 && h > 0.18) h -= Math.min(0.2, h - 0.12) * Math.min(1, rv * 1.6);
      if (vx === 0 || vy === 0 || vx === NVX - 1 || vy === NVY - 1) h = -1.2;
      const g = vy * NVX + vx;
      HV[g] = h;
      if (HV0) HV0[g] = h;
      if (this.bedNH && !(this.bedW && this.bedW[g])) this.bedNH[g] = h;
    }
    this.bedNet = null; // Straßenbett beim nächsten applyRoadBed wieder darüberlegen
    refreshHTEX();
    // Stücke mit geänderten Punkten: Lage und Normalen neu, neu färben
    const VS = CV + 1;
    for (const c of this.chunks) {
      const cvx0 = c.cx * CV, cvy0 = c.cz * CV;
      if (cvx0 > gx1 + 1 || cvx0 + CV < gx0 - 1 || cvy0 > gy1 + 1 || cvy0 + CV < gy0 - 1) continue;
      const geo = c.mesh.geometry, pos = geo.attributes.position.array, nrm = geo.attributes.normal.array;
      let lo = 1e9, hi = -1e9;
      for (let ly = 0; ly < VS; ly++) for (let lx = 0; lx < VS; lx++) {
        const vx = cvx0 + lx, vy = cvy0 + ly, g = vy * NVX + vx, k = ly * VS + lx;
        pos[k * 3 + 1] = HV[g];
        const l = HV[vy * NVX + Math.max(0, vx - 1)], r = HV[vy * NVX + Math.min(NVX - 1, vx + 1)];
        const d = HV[Math.max(0, vy - 1) * NVX + vx], up = HV[Math.min(NVY - 1, vy + 1) * NVX + vx];
        const nx = (l - r) * RES * 0.5, nz = (d - up) * RES * 0.5, len = Math.hypot(nx, 1, nz);
        nrm[k * 3] = nx / len; nrm[k * 3 + 1] = 1 / len; nrm[k * 3 + 2] = nz / len;
        lo = Math.min(lo, HV[g]); hi = Math.max(hi, HV[g]);
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true;
      geo.computeBoundingSphere();
      c.lo = lo; c.hi = hi; c.sig = -1;
    }
    if (st.rivers && st.rivers.length) this.buildRivers(st);
    if (!quick) {
      this.buildClimate(st);
      this.buildRocks(st);
      this.trees.quiet = true;
      this.trees.reset();
    }
    this.local = null;
    this.roadSig = -1;
    return [wx0, wx1, wy0, wy1];
  }

  // ---------- Erde: Stücke auf Abruf ----------
  initStreaming(st) {
    for (const c of this.chunks) { this.mesh.remove(c.mesh); c.mesh.geometry.dispose(); }
    for (const c of this.far) { this.mesh.remove(c.mesh); c.mesh.geometry.dispose(); }
    for (const ms of this.rockAt.values()) for (const m of ms) { this.scene.remove(m); m.dispose(); }
    this.chunks = []; this.far = []; this.chunkAt.clear(); this.active.clear(); this.rockAt.clear();
    this.fineData.fill(0); this.fineTex.needsUpdate = true;
    this.noise = null;
    // Dreiecksliste der feinen Stücke (alle gleich)
    const VS = CV + 1, index = new Uint32Array(CV * CV * 6);
    let n = 0;
    for (let ly = 0; ly < CV; ly++) for (let lx = 0; lx < CV; lx++) {
      const a0 = ly * VS + lx, b0 = a0 + 1, c0 = a0 + VS, d0 = c0 + 1;
      if ((lx + ly) % 2) index.set([a0, c0, b0, b0, c0, d0], n); else index.set([a0, c0, d0, a0, d0, b0], n);
      n += 6;
    }
    this.ib = new THREE.BufferAttribute(index, 1);
    // Fernstücke: 256 Felder, ein Punkt je 4 Felder (8 Gitterpunkte), 65 x 65 Punkte
    const FT = 256, FS = 4, FV = FT / FS + 1, gs = FS * RES;
    const fi = new Uint32Array((FV - 1) * (FV - 1) * 6);
    n = 0;
    for (let ly = 0; ly < FV - 1; ly++) for (let lx = 0; lx < FV - 1; lx++) {
      const a0 = ly * FV + lx, b0 = a0 + 1, c0 = a0 + FV, d0 = c0 + 1;
      fi.set([a0, c0, d0, a0, d0, b0], n); n += 6;
    }
    const fib = new THREE.BufferAttribute(fi, 1);
    for (let ty0 = 0; ty0 < NY; ty0 += FT) for (let tx0 = 0; tx0 < NX; tx0 += FT) {
      const pos = new Float32Array(FV * FV * 3), nrm = new Float32Array(FV * FV * 3), gidx = new Int32Array(FV * FV), nz = new Float32Array(FV * FV * 3);
      for (let ly = 0; ly < FV; ly++) for (let lx = 0; lx < FV; lx++) {
        const vx = Math.min(NVX - 1, tx0 * RES + lx * gs), vy = Math.min(NVY - 1, ty0 * RES + ly * gs), g = vy * NVX + vx, k = ly * FV + lx;
        gidx[k] = g;
        pos[k * 3] = vx / RES - NX / 2; pos[k * 3 + 1] = HV[g] - 0.03; pos[k * 3 + 2] = vy / RES - NY / 2;
        const l = HV[vy * NVX + Math.max(0, vx - gs)], r = HV[vy * NVX + Math.min(NVX - 1, vx + gs)];
        const d = HV[Math.max(0, vy - gs) * NVX + vx], u = HV[Math.min(NVY - 1, vy + gs) * NVX + vx];
        const ax = (l - r) * RES * 0.5 / gs, az = (d - u) * RES * 0.5 / gs, len = Math.hypot(ax, 1, az);
        nrm[k * 3] = ax / len; nrm[k * 3 + 1] = 1 / len; nrm[k * 3 + 2] = az / len;
        nz[k * 3] = smoothN(vx * 0.11 + 3, vy * 0.11 + 9); nz[k * 3 + 1] = smoothN(vx * 0.07, vy * 0.07) * 0.6 + smoothN(vx * 0.19 + 7, vy * 0.19) * 0.4; nz[k * 3 + 2] = 0.97 + hash(vx, vy) * 0.06;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(FV * FV * 3), 3));
      geo.setAttribute('surf', new THREE.BufferAttribute(new Float32Array(FV * FV * 4), 4));
      geo.setIndex(fib);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.matFar);
      mesh.receiveShadow = false;
      this.mesh.add(mesh);
      this.far.push({ far: true, mesh, gidx, noise: nz, sig: -1, tx0, ty0, tw: FT, step: FS });
    }
    this.buildClimate(st);
    this.buildRivers(st);
    this.buildVolcanoes(st);
    this.trees.reset();
    this.local = null;
    this.roadSig = -1;
  }

  // Ein feines Stück bauen (Lage, Normalen, Rauschen je Punkt), noch ungefärbt
  makeChunk(cx, cz) {
    const VS = CV + 1;
    const pos = new Float32Array(VS * VS * 3), nrm = new Float32Array(VS * VS * 3), gidx = new Int32Array(VS * VS), nz = new Float32Array(VS * VS * 3);
    let lo = 1e9, hi = -1e9;
    for (let ly = 0; ly < VS; ly++) for (let lx = 0; lx < VS; lx++) {
      const vx = Math.min(NVX - 1, cx * CV + lx), vy = Math.min(NVY - 1, cz * CV + ly), g = vy * NVX + vx, k = ly * VS + lx;
      gidx[k] = g;
      pos[k * 3] = vx / RES - NX / 2; pos[k * 3 + 1] = HV[g]; pos[k * 3 + 2] = vy / RES - NY / 2;
      const l = HV[vy * NVX + Math.max(0, vx - 1)], r = HV[vy * NVX + Math.min(NVX - 1, vx + 1)];
      const d = HV[Math.max(0, vy - 1) * NVX + vx], u = HV[Math.min(NVY - 1, vy + 1) * NVX + vx];
      const ax = (l - r) * RES * 0.5, az = (d - u) * RES * 0.5, len = Math.hypot(ax, 1, az);
      nrm[k * 3] = ax / len; nrm[k * 3 + 1] = 1 / len; nrm[k * 3 + 2] = az / len;
      nz[k * 3] = smoothN(vx * 0.11 + 3, vy * 0.11 + 9); nz[k * 3 + 1] = smoothN(vx * 0.07, vy * 0.07) * 0.6 + smoothN(vx * 0.19 + 7, vy * 0.19) * 0.4; nz[k * 3 + 2] = 0.97 + hash(vx, vy) * 0.06;
      lo = Math.min(lo, HV[g]); hi = Math.max(hi, HV[g]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(VS * VS * 3), 3));
    geo.setAttribute('surf', new THREE.BufferAttribute(new Float32Array(VS * VS * 4), 4));
    geo.setIndex(this.ib);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.receiveShadow = true;
    this.mesh.add(mesh);
    const C = { cx, cz, mesh, gidx, noise: nz, sig: -1, lo, hi, tx0: cx * CH, ty0: cz * CH, tw: CH, step: 1 };
    this.chunks.push(C);
    this.chunkAt.set(cz * CNX + cx, C);
    return C;
  }

  dropChunk(ci) {
    const C = this.chunkAt.get(ci);
    if (!C) return;
    this.mesh.remove(C.mesh); C.mesh.geometry.dispose();
    this.chunkAt.delete(ci);
    this.chunks = this.chunks.filter(o => o !== C);
    const rk = this.rockAt.get(ci);
    if (rk) { for (const m of rk) { this.scene.remove(m); m.dispose(); } this.rockAt.delete(ci); }
  }

  // Jedes Bild (aus follow): fehlende Stücke rund um den Blick bauen (höchstens zwei je Bild), ferne freigeben,
  // die Maske der Fernstücke nachführen. Neue Stücke werden gleich gefärbt, Bäume und Felsen kommen dazu.
  stream(st, season, bldAt, target, dist) {
    const tx = target.x + NX / 2, tz = target.z + NY / 2;
    const R = Math.min(230, Math.max(100, dist * 1.15 + 50));
    const want = [];
    for (let cz = 0; cz < CNY; cz++) for (let cx = 0; cx < CNX; cx++) {
      const d = Math.hypot((cx + 0.5) * CH - tx, (cz + 0.5) * CH - tz) - CH * 0.7;
      if (d < R) want.push([d, cz * CNX + cx, cx, cz]);
    }
    want.sort((a, b) => a[0] - b[0]);
    const MAXC = 72;
    want.length = Math.min(want.length, MAXC);
    const wantSet = new Set(want.map(w => w[1]));
    let made = 0;
    for (const [, ci, cx, cz] of want) {
      if (this.chunkAt.has(ci)) continue;
      if (made >= 2) break;
      this.makeChunk(cx, cz); made++;
    }
    let dropped = 0;
    if (this.chunkAt.size > MAXC || made) for (const ci of [...this.chunkAt.keys()]) if (!wantSet.has(ci) && this.chunkAt.size > MAXC * 0.8) { this.dropChunk(ci); dropped++; }
    if (made || dropped) {
      this.active = new Set(this.chunkAt.keys());
      if (made) this.colors(st, season, this.lastView || {});
      this.trees.active = this.active;
      this.trees.update(st, season, bldAt);
      for (const ci of this.active) if (!this.rockAt.has(ci)) this.rockAt.set(ci, this.rockChunk(st, ci));
      let changed = false;
      for (let ci = 0; ci < CNX * CNY; ci++) {
        const v = this.chunkAt.has(ci) && this.chunkAt.get(ci).sig !== -1 ? 255 : 0;
        if (this.fineData[ci] !== v) { this.fineData[ci] = v; changed = true; }
      }
      if (changed) this.fineTex.needsUpdate = true;
      this.local = null;
    }
  }

  // Straßenbett (seit 19.10.2026): das Gelände entlang jeder Landstraße auf ihr Längsprofil einebnen, quer waagrecht über
  // Fahrbahn und Bankett (Halbbreite plus 0,4), danach weiche Böschung bis plus 1,0. Nicht unter Brücken, nicht in Flüssen
  // und nicht am Wasser. Immer aus den ursprünglichen Höhen (HV0) neu, nur Stücke mit Änderungen werden neu aufgebaut.
  // Gibt zurück, ob sich etwas geändert hat (dann Gebäude und Bäume an die neue Höhe setzen).
  // Flugplätze (vehicles.js findStrip): flache Flächen für Bahn, Rollweg, Vorfeld und Hallen, keine Bäume darauf
  setPads(pads) {
    const key = pads.map(p => p.x0.toFixed(1) + ',' + p.z0.toFixed(1)).join('|');
    if (key === this.padKey) return false;
    this.padKey = key; this.pads = pads;
    BLOCK = pads.length ? new Uint8Array(NX * NY) : null;
    for (const p of pads) for (const i of p.tiles) if (i >= 0 && i < NX * NY) BLOCK[i] = 1;
    this.bedNet = null;
    this.trees.reset();
    return true;
  }

  applyRoadBed(st, net) {
    if (!HV0 || this.bedNet === net) return false;
    this.bedNet = net;
    // Seit 19.10.2026 nur in den Rechtecken der Straßen und Flugplätze (dieses Mal und letztes Mal) statt über das ganze
    // Gitter (die Erde hat 8 Millionen Gitterpunkte); die Felder W und NH bleiben im Speicher. Gleiches Ergebnis wie vorher.
    const T = st.tiles;
    if (!this.bedW || this.bedW.length !== NVX * NVY) { this.bedW = new Float32Array(NVX * NVY); this.bedNH = HV0.slice(); this.bedBoxes = []; }
    const W = this.bedW, NH = this.bedNH, boxes = [];
    const padBox = p => {
      const mx = (p.x0 + p.x1) / 2, mz = (p.z0 + p.z1) / 2, half = Math.hypot(p.x1 - p.x0, p.z1 - p.z0) / 2 + 1.0, ext = half + 4.5;
      return [Math.max(0, Math.floor((mx - ext + NX / 2) * RES)), Math.min(NVX - 1, Math.ceil((mx + ext + NX / 2) * RES)), Math.max(0, Math.floor((mz - ext + NY / 2) * RES)), Math.min(NVY - 1, Math.ceil((mz + ext + NY / 2) * RES))];
    };
    const segBox = (c, k) => {
      const { pts, hw } = c, R = hw + 1.0, ax = pts[k][0], az = pts[k][1], bx = pts[k + 1][0], bz = pts[k + 1][1];
      return [Math.max(0, Math.floor((Math.min(ax, bx) - R + NX / 2) * RES)), Math.min(NVX - 1, Math.ceil((Math.max(ax, bx) + R + NX / 2) * RES)), Math.max(0, Math.floor((Math.min(az, bz) - R + NY / 2) * RES)), Math.min(NVY - 1, Math.ceil((Math.max(az, bz) + R + NY / 2) * RES))];
    };
    for (const p of this.pads || []) boxes.push(padBox(p));
    for (const c of net.chains) for (let k = 0; k < c.pts.length - 1; k++) if (!(c.fixed[k] && c.fixed[k + 1])) boxes.push(segBox(c, k));
    const touch = this.bedBoxes.concat(boxes);
    this.bedBoxes = boxes;
    for (const [gx0, gx1, gz0, gz1] of touch) for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) { const g = gz * NVX + gx; W[g] = 0; NH[g] = HV0[g]; }
    // Flugplätze: Rechteck längs der Bahn (ein halbes Feld über die Enden), quer von der Bahn bis über die Hallen
    for (const p of this.pads || []) {
      const mx = (p.x0 + p.x1) / 2, mz = (p.z0 + p.z1) / 2, half = Math.hypot(p.x1 - p.x0, p.z1 - p.z0) / 2 + 1.0;
      const l0 = p.side < 0 ? -3.0 : -0.7, l1 = p.side < 0 ? 0.7 : 3.0, B = 1.0;
      const [gx0, gx1, gz0, gz1] = padBox(p);
      for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
        const X = gx / RES - NX / 2, Z = gz / RES - NY / 2, a = (X - mx) * p.dx + (Z - mz) * p.dz, l = (X - mx) * p.dz - (Z - mz) * p.dx;
        const da = Math.max(0, Math.abs(a) - half), dl = Math.max(0, l0 - l, l - l1), d = Math.hypot(da, dl);
        if (d > B) continue;
        const u = d / B, w = 1 - u * u * (3 - 2 * u), g = gz * NVX + gx;
        if (w <= W[g] || HV0[g] < 0.06) continue;
        W[g] = w; NH[g] = HV0[g] + (p.y - HV0[g]) * w;
      }
    }
    for (const c of net.chains) {
      const { pts, prof, hw, fixed } = c;
      const R = hw + 1.0, full = hw + 0.4;
      for (let k = 0; k < pts.length - 1; k++) {
        if (fixed[k] && fixed[k + 1]) continue;
        const ax = pts[k][0], az = pts[k][1], bx = pts[k + 1][0], bz = pts[k + 1][1], ya = prof[k], yb = prof[k + 1];
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-6;
        const [gx0, gx1, gz0, gz1] = segBox(c, k);
        for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
          const X = gx / RES - NX / 2, Z = gz / RES - NY / 2;
          let t = ((X - ax) * dx + (Z - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(X - ax - dx * t, Z - az - dz * t);
          if (d > R) continue;
          const u = d <= full ? 0 : (d - full) / (R - full), w = 1 - u * u * (3 - 2 * u);
          const g = gz * NVX + gx;
          if (w <= W[g]) continue;
          const tx = Math.max(0, Math.min(NX - 1, Math.floor(X + NX / 2))), tz = Math.max(0, Math.min(NY - 1, Math.floor(Z + NY / 2))), ti = tz * NX + tx;
          if (HV0[g] < 0.06 || T.h[ti] < 0 || T.river[ti]) continue;
          W[g] = w; NH[g] = HV0[g] + (ya + (yb - ya) * t - HV0[g]) * w;
        }
      }
    }
    // geänderte Stücke finden, Höhen übernehmen, Lage und Normalen der Stücke neu
    const dirty = new Set();
    for (const [gx0, gx1, gz0, gz1] of touch) for (let vy = gz0; vy <= gz1; vy++) for (let vx = gx0; vx <= gx1; vx++) {
      const g = vy * NVX + vx;
      if (Math.abs(NH[g] - HV[g]) < 1e-5) { HV[g] = NH[g]; continue; }
      HV[g] = NH[g];
      const cx = Math.min(CNX - 1, Math.floor(vx / CV)), cz = Math.min(CNY - 1, Math.floor(vy / CV));
      for (const ox of [0, -1, 1]) for (const oz of [0, -1, 1]) {
        const ux = cx + ox, uz = cz + oz;
        if (ux >= 0 && uz >= 0 && ux < CNX && uz < CNY) dirty.add(uz * CNX + ux);
      }
    }
    if (!dirty.size) return false;
    refreshHTEX();
    // Felsen der geänderten Stücke neu setzen, sonst schweben sie über dem eingeebneten Straßenbett
    if (this.streaming) for (const ci of dirty) { const rk = this.rockAt.get(ci); if (rk) { for (const m of rk) { this.scene.remove(m); m.dispose(); } this.rockAt.delete(ci); } }
    const VS = CV + 1;
    for (const c of this.chunks) {
      if (!dirty.has(c.cz * CNX + c.cx)) continue;
      const geo = c.mesh.geometry, pos = geo.attributes.position.array, nrm = geo.attributes.normal.array;
      let lo = 1e9, hi = -1e9;
      for (let ly = 0; ly < VS; ly++) for (let lx = 0; lx < VS; lx++) {
        const vx = c.cx * CV + lx, vy = c.cz * CV + ly, g = vy * NVX + vx, k = ly * VS + lx;
        pos[k * 3 + 1] = HV[g];
        const l = HV[vy * NVX + Math.max(0, vx - 1)], r = HV[vy * NVX + Math.min(NVX - 1, vx + 1)];
        const d = HV[Math.max(0, vy - 1) * NVX + vx], u = HV[Math.min(NVY - 1, vy + 1) * NVX + vx];
        const nx = (l - r) * RES * 0.5, nz = (d - u) * RES * 0.5, len = Math.hypot(nx, 1, nz);
        nrm[k * 3] = nx / len; nrm[k * 3 + 1] = 1 / len; nrm[k * 3 + 2] = nz / len;
        lo = Math.min(lo, HV[g]); hi = Math.max(hi, HV[g]);
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true;
      geo.computeBoundingSphere();
      c.lo = lo; c.hi = hi; c.sig = -1;
    }
    return true;
  }

  // Klimakarte für den Schnee (R: Winterschnee, G: liegt immer)
  buildClimate(st) {
    const T = st.tiles, D = this.climData;
    if (st.earth && EARTH) return this.buildEarthClimate(st);
    for (let i = 0; i < NX * NY; i++) {
      const B = BIOMES[T.bio ? T.bio[i] : 0] || BIOMES[0];
      const h = T.h[i];
      let perm = B.key === 'eis' ? 0.92 : 0;
      if (h >= 5 && B.snow > 1.2) perm = Math.max(perm, 0.55);
      if (h >= 6 && B.snow >= 1) perm = Math.max(perm, 0.35);
      if (h >= 7) perm = Math.max(perm, B.snow >= 0.5 ? 0.8 : 0.4); // hohe Gipfel tragen Schnee, auch im Süden ein wenig
      if (h >= 8) perm = Math.max(perm, 0.9);
      if (B.key === 'vulkan') perm = 0; // der Feuerberg ist warm
      D[i * 4] = Math.min(255, Math.round(B.snow / 2 * 255)); D[i * 4 + 1] = Math.round(perm * 255); D[i * 4 + 2] = 0; D[i * 4 + 3] = 255;
    }
    // Ränder weich (Schnee und Eis enden nicht an der Kachelkante)
    for (let pass = 0; pass < 2; pass++) for (const ch of [0, 1]) {
      const src = new Uint8Array(NX * NY);
      for (let i = 0; i < NX * NY; i++) src[i] = D[i * 4 + ch];
      for (let y = 1; y < NY - 1; y++) for (let x = 1; x < NX - 1; x++) {
        const i = idx(x, y);
        D[i * 4 + ch] = (src[i] * 4 + src[i - 1] + src[i + 1] + src[i - NX] + src[i + NX]) >> 3;
      }
    }
    this.climTex.needsUpdate = true;
  }

  // Erde (seit 19.10.2026, PLAN_ERDE.md E6): Schnee aus echter Breite und Höhe. Ewiger Schnee über der Schneegrenze
  // (am Äquator rund 5200 m, in den Alpen rund 2800 m, in Norwegen 1400 m, am Polarkreis fast auf Meereshöhe),
  // gerechnet mit der Gipfelhöhe statt dem Mittel eines 20 km Feldes. Winterschnee nach Breite und Höhe, in Wüsten kaum.
  // Dazu die Wüstenfarben je Gegend (this.tint): Australien rot, Namib und Kalahari orange, Gobi grau, Südwesten Amerikas rötlich.
  buildEarthClimate(st) {
    const T = st.tiles, D = this.climData, E = EARTH;
    const sm = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
    this.tint = new Uint8Array(NX * NY);
    ABOVE_TL = new Uint8Array(NX * NY);
    for (let y = 0; y < NY; y++) {
      const lat = 90 - (y + 0.5) / NY * 180, al = Math.abs(lat);
      const line = al < 20 ? 5200 : Math.max(0, 5200 - (al - 20) * 95);
      for (let x = 0; x < NX; x++) { const i = y * NX + x; if (T.h[i] >= 0 && E.elev[i] > line - 900 + (hash(x, y) - 0.5) * 300) ABOVE_TL[i] = 1; }
      for (let x = 0; x < NX; x++) {
        const i = y * NX + x, B = BIOMES[T.bio[i]] || BIOMES[0];
        // Höhe als Ersatz für echte Gipfel: je zerklüfteter (Spanne der Nachbarn), desto höher die echten Spitzen.
        // Trockenes Hochland (Tibet, Altiplano) hat seine Schneegrenze viel höher, dort tragen nur die Kämme Schnee
        let lo = 1e9, hi = -1e9;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = Math.max(0, Math.min(NY - 1, y + dy)), xx = Math.max(0, Math.min(NX - 1, x + dx)), e = E.elev[yy * NX + xx]; if (e < lo) lo = e; if (e > hi) hi = e; }
        const m = Math.max(0, E.elev[i]), eff = m > 800 ? m * (1.1 + 0.25 * Math.min(1, (hi - lo) / 1500)) : m;
        const dryHigh = al < 42 && (B.key === 'tundra' || B.key === 'steppe' || B.key === 'wueste' || B.key === 'salz') ? 1700 : 0;
        let perm = B.key === 'eis' ? 0.92 : T.h[i] >= 0 ? sm(line + dryHigh - 450, line + dryHigh + 350, eff) * 0.9 : 0;
        if (B.key === 'vulkan' && eff < line + 600) perm *= 0.2;
        const dry = (B.key === 'wueste' || B.key === 'salz' || B.key === 'oase') && eff < 1800 ? 0.08 : 1;
        const win = T.h[i] < 0 ? 0 : Math.min(1, Math.max(0, (al - 32) / 24 + eff / 3200)) * dry;
        D[i * 4] = Math.round(win * 255); D[i * 4 + 1] = Math.round(perm * 255); D[i * 4 + 2] = 0; D[i * 4 + 3] = 255;
        // Wüstenfarbe
        if (T.h[i] >= 0 && (B.key === 'wueste' || B.key === 'steppe' || B.key === 'savanne' || B.key === 'canyon' || B.key === 'salz')) {
          const c = E.cont[i], lon = -169 + (x + 0.5) / NX * 360, lo = lon > 180 ? lon - 360 : lon;
          this.tint[i] = c === 2 ? 1 : c === 3 && lat < -14 ? 2 : c === 5 && lo > 75 && lo < 125 && lat > 35 ? 3 : c === 7 && lat > 24 && lat < 42 && lo > -122 && lo < -100 ? 4 : c === 1 && lat < -15 && lat > -30 && lo < -66 ? 3 : 0;
        }
      }
    }
    for (let pass = 0; pass < 2; pass++) for (const ch of [0, 1]) {
      const src = new Uint8Array(NX * NY);
      for (let i = 0; i < NX * NY; i++) src[i] = D[i * 4 + ch];
      for (let y = 1; y < NY - 1; y++) for (let x = 1; x < NX - 1; x++) {
        const i = idx(x, y);
        D[i * 4 + ch] = (src[i] * 4 + src[i - 1] + src[i + 1] + src[i - NX] + src[i + NX]) >> 3;
      }
    }
    this.climTex.needsUpdate = true;
  }

  // Schnee Faktor an einer Weltposition (für Wetterbilder: in der Wüste fällt kein Schnee)
  snowAt(X, Z) {
    const x = Math.max(0, Math.min(NX - 1, Math.floor(X + NX / 2))), y = Math.max(0, Math.min(NY - 1, Math.floor(Z + NY / 2)));
    const i = idx(x, y);
    return [this.climData[i * 4] / 127.5, this.climData[i * 4 + 1] / 255];
  }

  // Farben je Gitterpunkt: Wiese, Strand, Brand. Fels, Wege und Feinheiten zeichnet der Shader (surf: Wiese, Fels, Düne, Rotfels)
  // Neu gefärbt wird nur ein Stück, in dem sich etwas geändert hat (Bäume, Brand, Ruinen, Fruchtbarkeit, Besitz) oder bei neuer Jahreszeit
  colors(st, season, view = {}) {
    const T = st.tiles;
    this.lastView = view;
    const sites = new Map();
    for (const s of st.sites) sites.set(idx(s.x, s.y), s.k);
    const lava = st.effects.filter(e => e.k === 'vulkan');
    const dry = st.weather.moist < 0.18 && season < 3 ? 0.25 : 0;
    const terr = !!(view.territory && view.owner);
    const gkey = season * 7 + (dry ? 1 : 0) * 3 + (terr ? 1 : 0) + st.sites.length * 31 + lava.length * 977 + (lava.length ? st.day * 13 : 0);
    const B = T.bio || new Uint8Array(NX * NY);
    const tmp = [0, 0, 0], tb = [0, 0, 0];
    const noise = this.noise;
    const sampT = (arr, u, v) => {
      const x0 = Math.max(0, Math.min(NX - 2, Math.floor(u))), y0 = Math.max(0, Math.min(NY - 2, Math.floor(v)));
      const fx = Math.max(0, Math.min(1, u - x0)), fy = Math.max(0, Math.min(1, v - y0));
      const p = arr[idx(x0, y0)], q = arr[idx(x0 + 1, y0)], r = arr[idx(x0, y0 + 1)], s = arr[idx(x0 + 1, y0 + 1)];
      return p + (q - p) * fx + (r - p) * fy + (p - q - r + s) * fx * fy;
    };
    const mix = (o, c, k) => { o[0] += (c[0] - o[0]) * k; o[1] += (c[1] - o[1]) * k; o[2] += (c[2] - o[2]) * k; };
    // Grundfarbe eines Lebensraums an einem Punkt
    const ground = (o, P, nA, pN, fert, trees, g) => {
      o[0] = P.A[0] + (P.B[0] - P.A[0]) * nA; o[1] = P.A[1] + (P.B[1] - P.A[1]) * nA; o[2] = P.A[2] + (P.B[2] - P.A[2]) * nA;
      mix(o, pN > 0.56 ? P.M : P.B, Math.abs(pN - 0.56) * 1.3);
      if (P.wet && pN > 0.6) mix(o, P.wet, Math.min(0.6, (pN - 0.6) * 4));
      if (fert < 0.45 && g > 0.3) mix(o, P.P, (0.45 - fert) * 1.4);
      if (trees > 0.3) mix(o, P.F, Math.min(0.6, trees * 0.25));
      const sc = P.S[season];
      if (sc) mix(o, sc, P.K[season] + (P.K[season] ? dry : 0));
    };
    // Erde: auch die Fernstücke (ihre Unterschrift nur aus jedem vierten Feld, gefärbt höchstens alle paar Sekunden)
    const list = this.streaming ? this.chunks.concat(this.far) : this.chunks;
    for (const C of list) {
      // Unterschrift: hat sich in diesem Stück etwas geändert?
      let sig = gkey;
      const tx0 = C.tx0, ty0 = C.ty0, st0 = C.step || 1;
      for (let y = ty0; y < Math.min(NY, ty0 + C.tw); y += st0) for (let x = tx0; x < Math.min(NX, tx0 + C.tw); x += st0) {
        const i = idx(x, y);
        sig = (Math.imul(sig, 31) + T.tree[i] * 3 + T.burn[i] * 7 + (T.ruin[i] ? 11 : 0) + (T.fert[i] >> 3) + (terr ? view.owner[i] * 5 : 0) + T.h[i] * 17) | 0;
      }
      if (sig === C.sig) continue;
      if (C.far && C.sig !== -1 && performance.now() - (C.at || 0) < 4000) continue;
      C.sig = sig; C.at = performance.now();
      const g = C.mesh.geometry, c = g.attributes.color.array, sf = g.attributes.surf.array, nr = g.attributes.normal.array, gidx = C.gidx;
      const NZ = C.noise;
      for (let k = 0; k < gidx.length; k++) {
        const gv = gidx[k], h = HV[gv];
        const vx = gv % NVX, vy = (gv / NVX) | 0;
        const u = vx / RES - 0.5, v = vy / RES - 0.5;
        const tx = Math.max(0, Math.min(NX - 1, Math.round(u))), ty = Math.max(0, Math.min(NY - 1, Math.round(v)));
        const ti = idx(tx, ty);
        const up = nr[k * 3 + 1];
        let grass = 0, rockK = 0, dune = 0, red = 0;
        if (h < 0.05) {
          tmp[0] = PAL.shallow.r; tmp[1] = PAL.shallow.g; tmp[2] = PAL.shallow.b;
          mix(tmp, [PAL.deep.r, PAL.deep.g, PAL.deep.b], Math.min(1, Math.max(0, -h - 0.15) / 0.8));
          if (h > -0.18) mix(tmp, [PAL.wetSand.r, PAL.wetSand.g, PAL.wetSand.b], (h + 0.18) / 0.23);
        } else {
          const nA = NZ ? NZ[k * 3] : noise[gv * 3], pN = NZ ? NZ[k * 3 + 1] : noise[gv * 3 + 1];
          const fert = sampT(T.fert, u, v) / 100, trees = sampT(T.tree, u, v);
          // Lebensraum: an Grenzen die vier Nachbarfelder weich mischen
          const x0 = Math.max(0, Math.min(NX - 2, Math.floor(u))), y0 = Math.max(0, Math.min(NY - 2, Math.floor(v)));
          const fx = Math.max(0, Math.min(1, u - x0)), fy = Math.max(0, Math.min(1, v - y0));
          const b00 = B[idx(x0, y0)], b10 = B[idx(x0 + 1, y0)], b01 = B[idx(x0, y0 + 1)], b11 = B[idx(x0 + 1, y0 + 1)];
          let P = BP[b00], gK = P.g, sandC = P.sand, hiC = P.hi, mossC = P.moss;
          if (b00 === b10 && b00 === b01 && b00 === b11) {
            ground(tmp, P, nA, pN, fert, trees, P.g); red = P.red; dune = P.dune;
          } else {
            const ws = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy], bs = [b00, b10, b01, b11];
            tmp[0] = tmp[1] = tmp[2] = 0; gK = 0; red = 0; dune = 0;
            let bw = -1;
            for (let q = 0; q < 4; q++) {
              const Q = BP[bs[q]];
              ground(tb, Q, nA, pN, fert, trees, Q.g);
              tmp[0] += tb[0] * ws[q]; tmp[1] += tb[1] * ws[q]; tmp[2] += tb[2] * ws[q];
              gK += Q.g * ws[q]; red += Q.red * ws[q]; dune += Q.dune * ws[q];
              if (ws[q] > bw) { bw = ws[q]; P = Q; }
            }
            sandC = P.sand; hiC = P.hi; mossC = P.moss;
          }
          const sandK = h < 0.34 ? Math.min(1, (0.34 - h) / 0.2) : 0;
          if (sandK > 0) mix(tmp, sandC, sandK);
          const tn = this.tint ? this.tint[ti] : 0;
          if (tn) mix(tmp, TINTS[tn], tn === 1 ? 0.5 : 0.35);
          rockK = THREE.MathUtils.smoothstep(0.88 - up, 0.06, 0.24);
          let alp = 0;
          if (h > 1.9 && mossC) mix(tmp, mossC, Math.min(0.7, (h - 1.9) * 0.6));
          if (h > 2.7) { alp = Math.min(0.85, (h - 2.7) * 0.9); mix(tmp, hiC, alp); }
          grass = (1 - sandK) * (1 - alp) * gK;
          if (dune > 0) dune *= 1 - rockK;
          if (T.ruin[ti]) mix(tmp, [PAL.ruin.r, PAL.ruin.g, PAL.ruin.b], 0.4);
          const sk = sites.get(ti);
          if (sk === 'krater') { mix(tmp, [PAL.crater.r, PAL.crater.g, PAL.crater.b], 0.75); grass = 0; }
          if (sk === 'asche') { mix(tmp, [PAL.ash.r, PAL.ash.g, PAL.ash.b], 0.35); grass *= 0.5; }
          if (T.burn[ti]) { mix(tmp, [PAL.burn.r, PAL.burn.g, PAL.burn.b], 0.8); grass = 0; rockK *= 0.3; }
          for (const e of lava) if (Math.hypot(e.x - u, e.y - v) < 3) { tmp[0] = 1; tmp[1] = 0.15; tmp[2] = 0.02; grass = 0; rockK = 0; }
          if (terr) {
            const o = view.owner[ti];
            if (o && view.colors[o]) { const oc = view.colors[o]; mix(tmp, [oc.r, oc.g, oc.b], 0.25); }
          }
        }
        const m = NZ ? NZ[k * 3 + 2] : noise[gv * 3 + 2];
        c[k * 3] = tmp[0] * m; c[k * 3 + 1] = tmp[1] * m; c[k * 3 + 2] = tmp[2] * m;
        sf[k * 4] = grass * (1 - rockK); sf[k * 4 + 1] = rockK; sf[k * 4 + 2] = dune; sf[k * 4 + 3] = red;
      }
      g.attributes.color.needsUpdate = true;
      g.attributes.surf.needsUpdate = true;
    }
    this.paths(st);
  }

  // Wegekarte für den Shader: R Trampelpfad und Feldweg, G Pflaster, B Asphalt, A Platten (moderne Plätze).
  // Pflaster und Asphalt nur auf echten Straßen und in Ortskernen, nicht auf jedem zertretenen Feld.
  paths(st) {
    if (this.streaming) return this.pathsLocal(st);
    const T = st.tiles, rt = st._rt, D = this.roadData, F = this.pathField;
    // nur neu, wenn sich Wege oder Straßen geändert haben
    let sig = 7;
    for (let i = 0; i < NX * NY; i += 3) sig = (sig + T.road[i] * (i % 97 + 1)) | 0;
    for (const k of st.links || []) sig = (Math.imul(sig, 31) + (k.built | 0) * 7 + (k.lvl | 0)) | 0;
    if (this.streetMask) for (let i = 0; i < NX * NY; i += 7) sig = (sig + this.streetMask[i] * (i % 89 + 3)) | 0;
    for (const s of st.settlements) if (s.alive) sig = (Math.imul(sig, 17) + s.era + Math.round(s.R * 4)) | 0;
    sig = (sig + st.buildings.length * 131) | 0;
    if (sig === this.roadSig) return;
    this.roadSig = sig;
    D.fill(0);
    const SM = this.streetMask;
    for (let i = 0; i < NX * NY; i++) {
      if (T.h[i] < 0) continue;
      let r = T.road[i];
      if (!r) continue;
      // Wo echte Straßen liegen (render/streets.js), keine Trampelflecken darunter und daneben
      if (SM) {
        const x = i % NX, y = (i / NX) | 0;
        if (SM[i] || (x > 0 && SM[i - 1] >= 2) || (x < NX - 1 && SM[i + 1] >= 2) || (y > 0 && SM[i - NX] >= 2) || (y < NY - 1 && SM[i + NX] >= 2)) r = Math.min(r, 40);
      }
      // seltene Pfade bleiben nur ein Hauch, oft begangene werden schmale Wege
      D[i * 4] = r;
      const s = rt.owner && rt.sById ? rt.sById.get(rt.owner[i]) : null;
      if (s && s.alive && s.era >= 3) {
        // der Platz am Zentrum wird gepflastert (moderne Orte: helle Platten); Straßen zeichnet streets.js
        const x = i % NX, y = (i / NX) | 0, d = Math.hypot(x - s.cx, y - s.cy);
        if (d < 2.6) { if (s.era >= 6) D[i * 4 + 3] = 255; else D[i * 4 + 1] = 255; }
      }
    }
    // Plätze auch ohne Trampelspur
    for (const s of st.settlements) {
      if (!s.alive || s.era < 3) continue;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const x = s.cx + dx, y = s.cy + dy; if (x < 0 || y < 0 || x >= NX || y >= NY || Math.hypot(dx, dy) >= 2.6) continue;
        const i = y * NX + x; if (T.h[i] < 0) continue;
        if (s.era >= 6) D[i * 4 + 3] = 255; else D[i * 4 + 1] = 255;
      }
    }
    const E = this.densData;
    E.fill(0);
    // Dichte nur dort, wo überhaupt Wege sind (spart auf der großen Karte fast alles)
    for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
      if (!T.road[idx(x, y)] && !(x % 3 === 0 && y % 3 === 0)) continue;
      let sum = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = Math.max(0, Math.min(NX - 1, x + dx)), yy = Math.max(0, Math.min(NY - 1, y + dy)), j = yy * NX + xx;
        sum += D[j * 4 + 1] || D[j * 4 + 2] || D[j * 4 + 3] ? 0 : T.road[j];
      }
      if (!sum) continue;
      for (let dy = 0; dy < (T.road[idx(x, y)] ? 1 : 3); dy++) for (let dx = 0; dx < (T.road[idx(x, y)] ? 1 : 3); dx++) {
        const xx = Math.min(NX - 1, x + dx), yy = Math.min(NY - 1, y + dy);
        E[yy * NX + xx] = Math.min(255, Math.max(0, (sum / 25 - 70) * 1.6));
      }
    }
    for (let i = 0; i < NX * NY; i++) F[i] = Math.max(D[i * 4] * (0.92 - E[i] / 255 * 0.25), D[i * 4 + 1], D[i * 4 + 2], D[i * 4 + 3]) / 255;
    // echte Straßen: dort kein Gras, keine Blumen, keine Kiesel
    if (SM) for (let i = 0; i < NX * NY; i++) if (SM[i]) F[i] = Math.max(F[i], SM[i] >= 2 ? 0.95 : 0.7);
    this.roadTex.needsUpdate = true;
    this.densTex.needsUpdate = true;
    this.local = null; // Gras, Blumen und Kiesel rund um den Blick neu (Wege haben sich geändert)
  }

  // Erde: dieselbe Wegekarte, aber nur in den feinen Stücken rund um den Blick (anderswo sieht man keine Wege)
  pathsLocal(st) {
    const T = st.tiles, rt = st._rt, D = this.roadData, F = this.pathField, E = this.densData, SM = this.streetMask;
    const rects = [...this.active].sort((a, b) => a - b).map(ci => [(ci % CNX) * CH, Math.floor(ci / CNX) * CH]);
    const each = fn => { for (const [x0, y0] of rects) for (let y = y0; y < Math.min(NY, y0 + CH); y++) for (let x = x0; x < Math.min(NX, x0 + CH); x++) fn(y * NX + x, x, y); };
    let sig = 7 + rects.length * 13;
    for (const [x0, y0] of rects) { sig = (Math.imul(sig, 31) + x0 * 7 + y0) | 0; for (let y = y0; y < y0 + CH; y += 3) for (let x = x0; x < x0 + CH; x++) { const i = y * NX + x; sig = (sig + T.road[i] * (i % 97 + 1) + (SM ? SM[i] * 5 : 0)) | 0; } }
    for (const k of st.links || []) sig = (Math.imul(sig, 31) + (k.built | 0) * 7 + (k.lvl | 0)) | 0;
    for (const s of st.settlements) if (s.alive) sig = (Math.imul(sig, 17) + s.era + Math.round(s.R * 4)) | 0;
    sig = (sig + st.buildings.length * 131) | 0;
    if (sig === this.roadSig) return;
    this.roadSig = sig;
    // vorher bearbeitete Flächen leeren, die nicht mehr aktiv sind
    for (const [x0, y0] of this.pathRects || []) for (let y = y0; y < Math.min(NY, y0 + CH); y++) for (let x = x0; x < Math.min(NX, x0 + CH); x++) { const i = y * NX + x; D[i * 4] = D[i * 4 + 1] = D[i * 4 + 2] = D[i * 4 + 3] = 0; E[i] = 0; F[i] = 0; }
    this.pathRects = rects;
    each(i => { D[i * 4] = D[i * 4 + 1] = D[i * 4 + 2] = D[i * 4 + 3] = 0; E[i] = 0; });
    each((i, x, y) => {
      if (T.h[i] < 0) return;
      let r = T.road[i];
      if (!r) return;
      if (SM && (SM[i] || (x > 0 && SM[i - 1] >= 2) || (x < NX - 1 && SM[i + 1] >= 2) || (y > 0 && SM[i - NX] >= 2) || (y < NY - 1 && SM[i + NX] >= 2))) r = Math.min(r, 40);
      D[i * 4] = r;
      const s = rt.owner && rt.sById ? rt.sById.get(rt.owner[i]) : null;
      if (s && s.alive && s.era >= 3) { const d = Math.hypot(x - s.cx, y - s.cy); if (d < 2.6) { if (s.era >= 6) D[i * 4 + 3] = 255; else D[i * 4 + 1] = 255; } }
    });
    for (const s of st.settlements) {
      if (!s.alive || s.era < 3) continue;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const x = s.cx + dx, y = s.cy + dy; if (x < 0 || y < 0 || x >= NX || y >= NY || Math.hypot(dx, dy) >= 2.6) continue;
        const i = y * NX + x; if (T.h[i] < 0) continue;
        if (s.era >= 6) D[i * 4 + 3] = 255; else D[i * 4 + 1] = 255;
      }
    }
    each((i, x, y) => {
      if (!T.road[i] && !(x % 3 === 0 && y % 3 === 0)) return;
      let sum = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = Math.max(0, Math.min(NX - 1, x + dx)), yy = Math.max(0, Math.min(NY - 1, y + dy)), j = yy * NX + xx;
        sum += D[j * 4 + 1] || D[j * 4 + 2] || D[j * 4 + 3] ? 0 : T.road[j];
      }
      if (!sum) return;
      for (let dy = 0; dy < (T.road[i] ? 1 : 3); dy++) for (let dx = 0; dx < (T.road[i] ? 1 : 3); dx++) {
        const xx = Math.min(NX - 1, x + dx), yy = Math.min(NY - 1, y + dy);
        E[yy * NX + xx] = Math.min(255, Math.max(0, (sum / 25 - 70) * 1.6));
      }
    });
    each(i => { F[i] = Math.max(D[i * 4] * (0.92 - E[i] / 255 * 0.25), D[i * 4 + 1], D[i * 4 + 2], D[i * 4 + 3]) / 255; if (SM && SM[i]) F[i] = Math.max(F[i], SM[i] >= 2 ? 0.95 : 0.7); });
    this.roadTex.needsUpdate = true;
    this.densTex.needsUpdate = true;
    this.local = null;
  }

  // Wie stark an dieser Weltposition ein Weg liegt (0..1), für Gras, Blumen und Kiesel
  pathAt(X, Z) {
    const u = X + NX / 2 - 0.5, v = Z + NY / 2 - 0.5, F = this.pathField;
    const x0 = Math.max(0, Math.min(NX - 2, Math.floor(u))), y0 = Math.max(0, Math.min(NY - 2, Math.floor(v)));
    const fx = Math.max(0, Math.min(1, u - x0)), fy = Math.max(0, Math.min(1, v - y0));
    const p = F[idx(x0, y0)], q = F[idx(x0 + 1, y0)], r = F[idx(x0, y0 + 1)], s = F[idx(x0 + 1, y0 + 1)];
    return p + (q - p) * fx + (r - p) * fy + (p - q - r + s) * fx * fy;
  }

  // Findlinge, in Stücken (nur sichtbare werden gezeichnet). Rot in den Schluchten, schwarz am Vulkan, bläulich im Eis
  buildRocks(st) {
    if (this.rocks) for (const m of this.rocks) { this.scene.remove(m); m.dispose(); }
    const T = st.tiles, B = T.bio || new Uint8Array(NX * NY);
    if (!this.rockMat) {
      this.rockMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }), { snow: 0.9, grain: 7 });
      this.rockGeos = [1, 2, 3].map(seed => boulder(seed));
    }
    const per = this.rockGeos.length;
    const TINT = { canyon: [1.25, 0.72, 0.52], vulkan: [0.42, 0.4, 0.4], eis: [0.95, 1.0, 1.08], wueste: [1.12, 1.0, 0.82], tundra: [0.92, 0.94, 0.92], salz: [1.1, 1.08, 1.04] };
    const lists = Array.from({ length: CNX * CNY }, () => []);
    for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
      const i = idx(x, y), l = T.h[i], k = BKEY[B[i]];
      const more = k === 'canyon' || k === 'wueste' || k === 'tundra' || k === 'vulkan' ? 0.06 : 0;
      if ((l >= 3 && hash(x + 11, y) < 0.32) || (l === 0 && hash(x, y + 5) < 0.07) || (l >= 1 && l <= 2 && hash(x + 3, y + 1) < 0.02 + more)) lists[Math.floor(y / CH) * CNX + Math.floor(x / CH)].push([x, y, l, k]);
    }
    const o = new THREE.Object3D(), c = new THREE.Color();
    this.rocks = [];
    lists.forEach((list, ci) => {
      if (!list.length) return;
      const max = list.length * 3;
      const meshes = this.rockGeos.map(g => { const m = new THREE.InstancedMesh(g, this.rockMat, max); m.count = 0; m.castShadow = true; m.receiveShadow = true; return m; });
      const put = (X, Z, s, sy, ry, tint, kind, tc) => {
        const m = meshes[kind % per];
        o.position.set(X, groundY(X, Z) - s * 0.06, Z);
        o.scale.set(s, s * sy, s * (0.85 + tint * 0.3)); o.rotation.set(0, ry, 0);
        o.updateMatrix(); m.setMatrixAt(m.count, o.matrix);
        c.setRGB(0.94 + tint * 0.1, 0.93 + tint * 0.08, 0.9 + tint * 0.1);
        if (tc) c.setRGB(c.r * tc[0], c.g * tc[1], c.b * tc[2]);
        m.setColorAt(m.count, c);
        m.count++;
      };
      for (const [x, y, l, k] of list) {
        const big = l >= 4 ? 1.5 : l === 3 ? 1.15 : 0.85;
        const X = x - NX / 2 + 0.5 + (hash(x, y) - 0.5) * 0.6, Z = y - NY / 2 + 0.5 + (hash(x + 2, y) - 0.5) * 0.6;
        const s = (0.7 + hash(x * 3, y) * 0.8) * big, ry = hash(x, y * 2) * 6.28, tc = TINT[k];
        put(X, Z, s, 0.6 + hash(y, x) * 0.35, ry, hash(x, y + 7), Math.floor(hash(x + 5, y) * per), tc);
        const n = l >= 3 ? 2 : 1;
        for (let q = 0; q < n; q++) {
          const a = ry + q * 2.4 + hash(x + q, y) * 1.5, d = s * (0.32 + hash(q, x + y) * 0.18);
          put(X + Math.cos(a) * d, Z + Math.sin(a) * d, s * (0.35 + hash(x + q, y + 3) * 0.25), 0.55 + hash(y + q, x) * 0.3, ry + q, hash(x + q, y + 9), q + x, tc);
        }
      }
      const cx = (ci % CNX) * CH + CH / 2 - NX / 2, cz = Math.floor(ci / CNX) * CH + CH / 2 - NY / 2;
      for (const m of meshes) {
        m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, 1.5, cz), CH * 0.75 + 4);
        if (m.count) { this.scene.add(m); this.rocks.push(m); } else m.dispose();
      }
    });
  }

  // Erde: Findlinge eines einzelnen feinen Stücks (gleiche Auswahl und Formen wie buildRocks), beim Bauen des Stücks
  rockChunk(st, ci) {
    const T = st.tiles, B = T.bio || new Uint8Array(NX * NY);
    if (!this.rockMat) {
      this.rockMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }), { snow: 0.9, grain: 7 });
      this.rockGeos = [1, 2, 3].map(seed => boulder(seed));
    }
    const per = this.rockGeos.length;
    const TINT = { canyon: [1.25, 0.72, 0.52], vulkan: [0.42, 0.4, 0.4], eis: [0.95, 1.0, 1.08], wueste: [1.12, 1.0, 0.82], tundra: [0.92, 0.94, 0.92], salz: [1.1, 1.08, 1.04] };
    const tx0 = (ci % CNX) * CH, ty0 = Math.floor(ci / CNX) * CH, list = [];
    for (let y = ty0; y < Math.min(NY, ty0 + CH); y++) for (let x = tx0; x < Math.min(NX, tx0 + CH); x++) {
      const i = idx(x, y), l = T.h[i], k = BKEY[B[i]];
      const more = k === 'canyon' || k === 'wueste' || k === 'tundra' || k === 'vulkan' ? 0.06 : 0;
      if ((l >= 3 && hash(x + 11, y) < 0.32) || (l === 0 && hash(x, y + 5) < 0.07) || (l >= 1 && l <= 2 && hash(x + 3, y + 1) < 0.02 + more)) list.push([x, y, l, k]);
    }
    if (!list.length) return [];
    const o = new THREE.Object3D(), c = new THREE.Color();
    const max = list.length * 3;
    const meshes = this.rockGeos.map(g => { const m = new THREE.InstancedMesh(g, this.rockMat, max); m.count = 0; m.castShadow = true; m.receiveShadow = true; return m; });
    const put = (X, Z, s, sy, ry, tint, kind, tc) => {
      const m = meshes[kind % per];
      o.position.set(X, groundY(X, Z) - s * 0.06, Z);
      o.scale.set(s, s * sy, s * (0.85 + tint * 0.3)); o.rotation.set(0, ry, 0);
      o.updateMatrix(); m.setMatrixAt(m.count, o.matrix);
      c.setRGB(0.94 + tint * 0.1, 0.93 + tint * 0.08, 0.9 + tint * 0.1);
      if (tc) c.setRGB(c.r * tc[0], c.g * tc[1], c.b * tc[2]);
      m.setColorAt(m.count, c);
      m.count++;
    };
    for (const [x, y, l, k] of list) {
      const big = l >= 4 ? 1.5 : l === 3 ? 1.15 : 0.85;
      const X = x - NX / 2 + 0.5 + (hash(x, y) - 0.5) * 0.6, Z = y - NY / 2 + 0.5 + (hash(x + 2, y) - 0.5) * 0.6;
      const s = (0.7 + hash(x * 3, y) * 0.8) * big, ry = hash(x, y * 2) * 6.28, tc = TINT[k];
      put(X, Z, s, 0.6 + hash(y, x) * 0.35, ry, hash(x, y + 7), Math.floor(hash(x + 5, y) * per), tc);
      const n = l >= 3 ? 2 : 1;
      for (let q = 0; q < n; q++) {
        const a = ry + q * 2.4 + hash(x + q, y) * 1.5, d = s * (0.32 + hash(q, x + y) * 0.18);
        put(X + Math.cos(a) * d, Z + Math.sin(a) * d, s * (0.35 + hash(x + q, y + 3) * 0.25), 0.55 + hash(y + q, x) * 0.3, ry + q, hash(x + q, y + 9), q + x, tc);
      }
    }
    const cx = tx0 + CH / 2 - NX / 2, cz = ty0 + CH / 2 - NY / 2, out = [];
    for (const m of meshes) {
      m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, 1.5, cz), CH * 0.75 + 4);
      if (m.count) { this.scene.add(m); out.push(m); } else m.dispose();
    }
    return out;
  }

  // Erde: Seen über Meereshöhe. Jeder See (EARTH.lake, eine Nummer je See) bekommt als Wasserspiegel sein niedrigstes
  // Ufer minus 0,12, der Grund liegt darunter. Seen nahe Meereshöhe bleiben beim Meer (water.js).
  highLakes(st, E, a) {
    const T = st.tiles, n = NX * NY, low = new Map();
    for (let i = 0; i < n; i++) {
      const id = E.lake[i]; if (!id || T.h[i] >= 0) continue;
      const x = i % NX;
      for (const j of [i - 1, i + 1, i - NX, i + NX]) {
        if (j < 0 || j >= n || (j === i - 1 && x === 0) || (j === i + 1 && x === NX - 1) || T.h[j] < 0) continue;
        if (!low.has(id) || a[j] < low.get(id)) low.set(id, a[j]);
      }
    }
    const mask = new Uint8Array(n), maskF = new Float32Array(n), surf = new Float32Array(n), tiles = [];
    for (let i = 0; i < n; i++) {
      const id = E.lake[i]; if (!id || T.h[i] >= 0) continue;
      const s = (low.get(id) ?? 0) - 0.12;
      if (s < 0.45) continue;
      mask[i] = 1; maskF[i] = 1; surf[i] = s; tiles.push(i);
      a[i] = s - 0.8;
    }
    return tiles.length ? { mask, maskF, surf, tiles } : null;
  }

  lakeMesh(LK) {
    if (this.lakes) { this.scene.remove(this.lakes); this.lakes.geometry.dispose(); this.lakes = null; }
    if (!LK) return;
    // Seefelder plus ein Feld Rand (das Ufer schneidet die Fläche sauber ab), Höhe vom nächsten Seefeld
    const pos = [], ind = [], done = new Set();
    for (const i of LK.tiles) {
      const x0 = i % NX, y0 = (i / NX) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = x0 + dx, y = y0 + dy; if (x < 0 || y < 0 || x >= NX || y >= NY) continue;
        const j = y * NX + x; if (done.has(j)) continue;
        if (!LK.mask[j] && (dx || dy) === 0) continue;
        if (LK.mask[j] && (dx || dy)) continue; // eigenes Feld kommt selbst dran
        done.add(j);
        const sy = LK.mask[j] ? LK.surf[j] : LK.surf[i];
        const X = x - NX / 2, Z = y - NY / 2, b = pos.length / 3;
        pos.push(X, sy, Z, X + 1, sy, Z, X, sy, Z + 1, X + 1, sy, Z + 1);
        ind.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(ind); g.computeBoundingSphere();
    const mat = new THREE.MeshPhongMaterial({ color: 0x3d8fa0, specular: 0xbfe6f0, shininess: 80, transparent: true, opacity: 0.9, depthWrite: false });
    this.lakes = new THREE.Mesh(g, mat);
    this.lakes.renderOrder = 1;
    this.scene.add(this.lakes);
  }

  // Flüsse als Bänder entlang ihres Laufs (st.rivers: Kachelfolgen von der Quelle zur Mündung)
  buildRivers(st) {
    if (this.rivers) { this.scene.remove(this.rivers); this.rivers.geometry.dispose(); this.rivers = null; }
    const list = st.rivers || [];
    if (!list.length) return;
    const pos = [], aw = [], av = [], am = [], ind = [];
    const rank = st.riverRank || null;
    list.forEach((path, ri) => {
      if (path.length < 3) return;
      // Mittelpunkte, zweimal geglättet (Chaikin), dann alle 0,25 Felder ein Querschnitt
      let pts = path.map(i => [i % NX - NX / 2 + 0.5, ((i / NX) | 0) - NY / 2 + 0.5]);
      // Erde: die Feldtreppen (acht Richtungen) erst über 5 Punkte mitteln, sonst falten sich breite Bänder an jeder Ecke
      if (rank && pts.length > 4) for (let pass = 0; pass < 2; pass++) pts = pts.map((p, k) => {
        if (k < 2 || k > pts.length - 3) return p;
        let x = 0, z = 0; for (let d = -2; d <= 2; d++) { x += pts[k + d][0]; z += pts[k + d][1]; }
        return [x / 5, z / 5];
      });
      for (let pass = 0; pass < 2; pass++) {
        const q = [pts[0]];
        for (let k = 0; k < pts.length - 1; k++) { const [ax, az] = pts[k], [bx, bz] = pts[k + 1]; q.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]); }
        q.push(pts[pts.length - 1]);
        pts = q;
      }
      // Mündung (seit 19.10.2026): der Fluss läuft ein Stück ins Meer hinaus, wird breiter und blendet weich in die
      // Meeresfarbe aus, statt hart an der Küste zu enden
      { const n = pts.length, [ax, az] = pts[n - 2], [bx, bz] = pts[n - 1]; let dx = bx - ax, dz = bz - az; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        if (groundY(bx, bz) < 0.25) for (let q = 1; q <= 6; q++) pts.push([bx + dx * q * 0.35, bz + dz * q * 0.35]); }
      let total = 0; for (let k = 1; k < pts.length; k++) total += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      let vlen = 0;
      const base = pos.length / 3;
      for (let k = 0; k < pts.length; k++) {
        const [x, z] = pts[k];
        const [px, pz] = pts[Math.max(0, k - 1)], [nx, nz] = pts[Math.min(pts.length - 1, k + 1)];
        let dx = nx - px, dz = nz - pz;
        const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
        if (k) vlen += Math.hypot(x - pts[k - 1][0], z - pts[k - 1][1]);
        const t = k / (pts.length - 1);
        const mouth = Math.max(1 - Math.min(1, (total - vlen) / 2.2), 1 - Math.min(1, Math.max(0, groundY(x, z) - 0.02) / 0.2));
        // Erde: Breite nach Rang (Amazonas, Nil, Jangtse breit, kleine Flüsse schmal), zur Mündung hin breiter
        const w = (rank ? (0.12 + (8 - (rank[ri] || 7)) * 0.048) * (0.7 + t * 0.4) : 0.22 + t * 0.32 + Math.min(0.2, path.length / 400)) * (1 + mouth * 1.4);
        for (const side of [-1, 1]) {
          const X = x - dz * w * side, Z = z + dx * w * side;
          const y = Math.max(0.02, Math.min(groundY(x, z), groundY(X, Z)) + 0.05);
          pos.push(X, y, Z); aw.push(side); av.push(vlen); am.push(mouth);
        }
        if (k) { const a = base + (k - 1) * 2; ind.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aW', new THREE.Float32BufferAttribute(aw, 1));
    g.setAttribute('aV', new THREE.Float32BufferAttribute(av, 1));
    g.setAttribute('aM', new THREE.Float32BufferAttribute(am, 1));
    g.setIndex(ind);
    g.computeBoundingSphere();
    const mat = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, this.riverU]), vertexShader: RIVER_VS, fragmentShader: RIVER_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    mat.uniforms.uTime = this.riverU.uTime; mat.uniforms.uSky = this.riverU.uSky;
    this.rivers = new THREE.Mesh(g, mat);
    this.rivers.renderOrder = 1;
    this.scene.add(this.rivers);
  }

  // Glühender Kratersee in jedem Feuerberg (Rauch macht fx.js)
  buildVolcanoes(st) {
    if (this.lava) { this.scene.remove(this.lava); this.lava.traverse(o => o.geometry && o.geometry.dispose()); }
    this.lava = new THREE.Group();
    if (!this.lavaMat) this.lavaMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.7, 0.15), toneMapped: false });
    for (const [x, y] of st.volc || []) {
      const X = x - NX / 2 + 0.5, Z = y - NY / 2 + 0.5;
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.75, 20).rotateX(-Math.PI / 2), this.lavaMat);
      m.position.set(X, groundY(X, Z) + 0.12, Z);
      this.lava.add(m);
    }
    this.scene.add(this.lava);
  }

  tick(t) {
    this.riverU.uTime.value = t;
    if (this.lavaMat) { const k = 0.85 + Math.sin(t * 1.7) * 0.1 + Math.sin(t * 4.3) * 0.05; this.lavaMat.color.setRGB(2.4 * k, 0.7 * k, 0.15 * k); }
  }

  // Gras, Blumen, Kiesel und Bäume passend zum Stand
  scatter(st, season, bldAt) {
    this.trees.update(st, season, bldAt);
    this.local = null; // Gras rund um den Blick beim nächsten follow neu
  }

  // Jedes Bild: liegt der Blick weit genug weg vom letzten Mal, werden Gras, Blumen und Kiesel dort neu verteilt
  follow(st, season, bldAt, target, dist) {
    if (this.streaming && this.ib) this.stream(st, season, bldAt, target, dist);
    const show = dist < 85;
    this.grass.mesh.visible = show;
    for (const m of this.flowers.kinds) m.visible = show;
    this.stones.mesh.visible = show;
    if (!show) return;
    const cx = Math.round(target.x + NX / 2), cy = Math.round(target.z + NY / 2);
    const L = this.local;
    if (L && L.season === season && Math.hypot(L.cx - cx, L.cy - cy) < 12) return;
    this.local = { cx, cy, season };
    const R = 46;
    this.grass.update(st, season, bldAt, this, cx, cy, R);
    this.flowers.update(st, season, bldAt, this, cx, cy, R);
    this.stones.update(st, this, cx, cy, R);
  }
}

// ---------- Bäume ----------

function paint(g, top, bottom, cy0, cy1) {
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
function softNormals(g, center, k = 0.8) {
  const p = g.attributes.position, nr = g.attributes.normal, v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i)).sub(center).normalize();
    n.set(nr.getX(i), nr.getY(i), nr.getZ(i)).lerp(v, k).normalize();
    nr.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

const clean = g => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; };

// Krone (seit 24.10.2026 runder, PLAN_GRAFIK.md, nach dem Mittelmeerdorf der Vorbilder): ein Kern und 9 bis 11 Ballen
// auf einer Schale verteilt, glatte Kugeln statt facettierter Ikosaeder, jeder Ballen im Ton etwas anders (Klumpen
// sichtbar), Normalen weich zur Mitte. Rund 1400 Dreiecke, fern bleibt die einfache Form (lowCrown)
function crown(seed, kind) {
  const r = i => hash(seed * 31 + i, seed);
  const parts = [], tone = [];
  const center = new THREE.Vector3(0, 0.95, 0);
  if (kind === 'pine') {
    for (let i = 0; i < 4; i++) {
      const rad = 0.36 - i * 0.07, y = 0.45 + i * 0.27;
      parts.push(new THREE.ConeGeometry(rad, 0.48, 12, 2).translate(0, y + 0.24, 0)); tone.push(1 - i * 0.02);
    }
  } else {
    const bush = kind === 'bush', s = bush ? 0.6 : 1, cy = bush ? 0.24 : 0.98;
    parts.push(new THREE.SphereGeometry(0.34 * s, 14, 10).scale(1, 0.92, 1).translate(0, cy, 0)); tone.push(1);
    const n = 9 + Math.floor(r(0) * 3);
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + r(i + 1) * 0.7, e = (r(i + 2) - 0.32) * 1.25, d = (0.25 + r(i + 3) * 0.08) * s;
      const rad = (0.16 + r(i + 4) * 0.08) * s;
      parts.push(new THREE.SphereGeometry(rad, 10, 7).translate(Math.cos(a) * Math.cos(e) * d, cy + Math.sin(e) * d * 0.9, Math.sin(a) * Math.cos(e) * d));
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

function trunk(kind) {
  const parts = [];
  const h = kind === 'pine' ? 0.6 : 0.85;
  parts.push(new THREE.CylinderGeometry(0.04, 0.075, h, 8).translate(0, h / 2, 0));
  if (kind !== 'pine') {
    parts.push(new THREE.CylinderGeometry(0.02, 0.035, 0.38, 5).rotateZ(0.7).translate(0.12, 0.62, 0));
    parts.push(new THREE.CylinderGeometry(0.02, 0.03, 0.3, 5).rotateZ(-0.8).rotateY(1.2).translate(-0.06, 0.66, 0.08));
  }
  return paint(mergeGeometries(parts.map(clean)), '#7a5a40', '#5e4430', 0, 1);
}

// Akazie: flache, breite Schirmkrone auf schlankem, leicht schiefem Stamm (Savanne)
function acaciaCrown() {
  const parts = [
    new THREE.SphereGeometry(0.34, 14, 7).scale(1.55, 0.3, 1.35).translate(0.04, 1.14, 0),
    new THREE.SphereGeometry(0.26, 12, 6).scale(1.45, 0.3, 1.25).translate(-0.3, 1.02, 0.12),
    new THREE.SphereGeometry(0.24, 12, 6).scale(1.4, 0.28, 1.2).translate(0.3, 1.0, -0.16),
  ];
  const g = mergeGeometries(parts.map(clean));
  softNormals(g, new THREE.Vector3(0, 1.0, 0), 0.6);
  return paint(g, '#ffffff', '#9a9a9a', 0.95, 1.2);
}
function acaciaTrunk() {
  return paint(mergeGeometries([
    new THREE.CylinderGeometry(0.028, 0.05, 1.02, 6).rotateZ(0.08).translate(-0.03, 0.5, 0),
    new THREE.CylinderGeometry(0.016, 0.028, 0.46, 5).rotateZ(0.75).translate(-0.2, 0.86, 0.05),
    new THREE.CylinderGeometry(0.016, 0.026, 0.42, 5).rotateZ(-0.7).translate(0.17, 0.88, -0.06),
  ].map(clean)), '#8a6a4c', '#5e4430', 0, 1);
}
// Kaktus (Wüste): Säule mit zwei Armen
function cactusGeo() {
  const parts = [
    new THREE.CylinderGeometry(0.075, 0.085, 0.86, 8).translate(0, 0.43, 0), new THREE.SphereGeometry(0.075, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.86, 0),
    new THREE.CylinderGeometry(0.048, 0.048, 0.2, 6).rotateZ(Math.PI / 2).translate(0.13, 0.4, 0), new THREE.CylinderGeometry(0.048, 0.05, 0.28, 6).translate(0.23, 0.53, 0), new THREE.SphereGeometry(0.048, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0.23, 0.67, 0),
    new THREE.CylinderGeometry(0.044, 0.044, 0.18, 6).rotateZ(Math.PI / 2).translate(-0.12, 0.28, 0), new THREE.CylinderGeometry(0.044, 0.046, 0.22, 6).translate(-0.21, 0.38, 0), new THREE.SphereGeometry(0.044, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(-0.21, 0.49, 0),
  ];
  const g = mergeGeometries(parts.map(clean));
  return paint(g, '#ffffff', '#a8a8a8', 0, 0.9);
}
// Urwaldriese: hoher Stamm mit Brettwurzeln, breite dunkle Krone (Regenwald)
function jungleCrown() {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + hash(i, 3), d = i === 0 ? 0 : 0.3 + hash(i, 5) * 0.12;
    parts.push(new THREE.SphereGeometry(i === 0 ? 0.46 : 0.3 + hash(i, 7) * 0.1, 12, 8).scale(1, 0.7, 1).translate(Math.cos(a) * d, 1.5 + hash(i, 9) * 0.18, Math.sin(a) * d));
  }
  const g = mergeGeometries(parts.map(clean));
  softNormals(g, new THREE.Vector3(0, 1.55, 0), 0.75);
  return paint(g, '#ffffff', '#8c8c8c', 1.2, 1.8);
}
function jungleTrunk() {
  const parts = [new THREE.CylinderGeometry(0.05, 0.09, 1.5, 7).translate(0, 0.75, 0)];
  for (let i = 0; i < 3; i++) parts.push(new THREE.ConeGeometry(0.05, 0.3, 3).scale(0.4, 1, 1.6).translate(0, 0.15, 0.07).rotateY(i * 2.1));
  return paint(mergeGeometries(parts.map(clean)), '#8c7660', '#5a4a3a', 0, 1.5);
}
// Toter Baum: kahler Stamm mit Ästen (Sumpf, Vulkan, Tundra)
function deadTree() {
  return paint(mergeGeometries([
    new THREE.CylinderGeometry(0.03, 0.065, 0.95, 6).translate(0, 0.47, 0),
    new THREE.CylinderGeometry(0.012, 0.025, 0.42, 4).rotateZ(0.8).translate(0.15, 0.72, 0),
    new THREE.CylinderGeometry(0.01, 0.022, 0.36, 4).rotateZ(-0.9).rotateY(1.4).translate(-0.08, 0.8, 0.1),
    new THREE.CylinderGeometry(0.008, 0.016, 0.26, 4).rotateZ(0.4).rotateY(-1.1).translate(0.02, 0.98, -0.05),
  ].map(clean)), '#8e8478', '#5c5248', 0, 1);
}

// Einfache Formen für die Ferne (gleiche Umrisse, ein Zehntel der Dreiecke)
function lowCrown(kind) {
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
const lowTrunk = h => paint(clean(new THREE.CylinderGeometry(0.04, 0.07, h, 4).translate(0, h / 2, 0)), '#7a5a40', '#5e4430', 0, 1);

const onLot = (T, i) => { const S = T.st; if (!S) return false; if (S[i]) return true; return !!((S[i + 1] & 4) || (S[i - 1] & 4) || (S[i + NX] & 4) || (S[i - NX] & 4)); };

class Trees {
  constructor(scene) {
    this.scene = scene;
    const leafMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }), { sway: 0.03, leaf: true, snow: 1.1, cap: true });
    const barkMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), { sway: 0.02, snow: 0.7 });
    this.leafMat = leafMat; this.barkMat = barkMat;
    // Palme (seit 24.10.2026): Stamm mit Ringen und Kokosnüssen, 8 gebogene Wedel aus je 5 Gliedern, die nach außen hängen
    const trunkP = [new THREE.CylinderGeometry(0.035, 0.055, 0.9, 8).translate(0, 0.45, 0)];
    for (let i = 1; i < 7; i++) trunkP.push(new THREE.CylinderGeometry(0.046 - i * 0.002, 0.048 - i * 0.002, 0.018, 8).translate(0, i * 0.13, 0));
    for (let i = 0; i < 3; i++) trunkP.push(new THREE.SphereGeometry(0.032, 8, 6).translate(Math.cos(i * 2.1) * 0.04, 0.86, Math.sin(i * 2.1) * 0.04));
    const palmG = paint(mergeGeometries(trunkP.map(clean)), '#8a6a48', '#6e5238', 0, 0.9);
    const frond = [];
    for (let i = 0; i < 8; i++) {
      let x = 0, y = 0.9, ang = 0.55 + (i % 2) * 0.2;
      for (let j = 0; j < 5; j++) {
        const L = 0.13, w = 0.085 - j * 0.014, nx = x + Math.cos(ang) * L, ny = y + Math.sin(ang) * L;
        frond.push(new THREE.BoxGeometry(L * 1.08, 0.008, w).rotateX(0.18).rotateZ(ang).translate((x + nx) / 2, (y + ny) / 2, 0).rotateY(i * Math.PI / 4 + (i % 2) * 0.2));
        x = nx; y = ny; ang -= 0.36;
      }
    }
    const fr = mergeGeometries(frond.map(clean));
    softNormals(fr, new THREE.Vector3(0, 0.9, 0), 0.5);
    paint(fr, '#ffffff', '#b0b0b0', 0.8, 1.0);
    // Teile je Art: Krone (Blattmaterial, Farbe je Baum) und Stamm (Rinde)
    this.kinds = {
      round1: [[crown(1, 'round'), leafMat], [trunk('round'), barkMat]],
      round2: [[crown(7, 'round'), leafMat], [trunk('round'), barkMat]],
      pine: [[crown(3, 'pine'), leafMat], [trunk('pine'), barkMat]],
      bush: [[crown(5, 'bush'), leafMat]],
      palm: [[fr, leafMat], [palmG, barkMat]],
      acacia: [[acaciaCrown(), leafMat], [acaciaTrunk(), barkMat]],
      cactus: [[cactusGeo(), leafMat]],
      jungle: [[jungleCrown(), leafMat], [jungleTrunk(), barkMat]],
      dead: [[deadTree(), barkMat]],
    };
    this.names = Object.keys(this.kinds);
    // Fernformen je Teil (null: in der Ferne weglassen)
    const LOW = {
      round1: [lowCrown('round'), lowTrunk(0.8)], round2: [lowCrown('round'), lowTrunk(0.8)], pine: [lowCrown('pine'), lowTrunk(0.6)],
      bush: [lowCrown('bush')], palm: [lowCrown('palm'), lowTrunk(0.9)], acacia: [lowCrown('acacia'), lowTrunk(1.0)],
      cactus: [lowCrown('cactus')], jungle: [lowCrown('jungle'), lowTrunk(1.5)], dead: [lowTrunk(0.95)],
    };
    this.low = LOW;
    this.chunks = [];
    // Kleiner Vorrat für umfallende Bäume, gleiche Form
    this.fallers = {};
    for (const [name, parts] of Object.entries(this.kinds)) {
      const ms = parts.map(([g, m]) => { const im = new THREE.InstancedMesh(g, m, 40); im.castShadow = true; im.frustumCulled = false; im.count = 0; scene.add(im); return im; });
      for (const im of ms) for (let k = 0; k < 40; k++) im.setColorAt(k, new THREE.Color('#ffffff'));
      this.fallers[name] = { ms, max: 40, n: 0 };
    }
    this.falling = [];
    this.camera = null;
  }

  reset() {
    for (const C of this.chunks) if (C) for (const K of Object.values(C.kinds)) { for (const m of K.ms) { this.scene.remove(m); m.dispose(); } for (const m of K.lo) this.scene.remove(m); }
    this.chunks = Array.from({ length: CNX * CNY }, () => null);
    this.prev = null; this.growing = new Map();
  }

  // Wie viele Bäume auf einer Kachel stehen (Wald aus der Simulation plus lockere Zierbäume, je Lebensraum).
  // Zierbäume nicht auf Straßen und Parzellen des Stadtplans (sim/cityplan.js), in den Gärten dahinter schon.
  static count(T, i, x, y, inTown) {
    if ((BLOCK && BLOCK[i]) || (ABOVE_TL && ABOVE_TL[i])) return 0;
    const n = T.tree[i], l = T.h[i];
    let cnt = n >= 3 ? 2 : n === 2 ? (hash(x, y + 3) < 0.6 ? 2 : 1) : n === 1 ? (hash(x + 1, y) < 0.75 ? 1 : 0) : 0;
    if (!n && l >= 1 && T.road[i] < 12 && !(T.burn && T.burn[i]) && !(T.river && T.river[i]) && hash(x + 7, y + 3) < WILD[T.bio ? T.bio[i] : 0] && !inTown(x, y) && !onLot(T, i)) cnt = 1;
    if (T.st && T.st[i] && (T.st[i] & 4)) cnt = 0; // auf gebauten Straßen und Plätzen des Stadtplans steht kein Baum
    return cnt;
  }

  // Form, Ort, Größe und Farbe des k-ten Baums einer Kachel (immer gleich, aus dem Hash)
  place(x, y, k, n, l, season, tc, b = 0) {
    const SPRING = ['#9cc966', '#86bd5a', '#b6d77a'], SUMMER = ['#7db552', '#6aa646', '#8fbf5c'];
    // Winter: kühles, entsättigtes Graugrün und Schieferblau, die Schneehaube kommt aus dem Shader (cap)
    const AUTUMN = ['#e3a35a', '#d98048', '#e8c167', '#cf6e45', '#b9a052'], WINTER = ['#86999f', '#92a6a6', '#7e9298', '#9fb0b2'];
    const BLOSSOM = ['#f4c6d6', '#f7e2ea', '#eeb7c9', '#fbf3ea'];
    const r1 = hash(x * 13 + k, y * 7), r2 = hash(x * 3, y * 11 + k), r3 = hash(x + k * 31, y + 17);
    const X = x - NX / 2 + 0.5 + (r1 - 0.5) * 0.8, Z = y - NY / 2 + 0.5 + (r2 - 0.5) * 0.8;
    const Y = groundY(X, Z) - 0.02;
    const s = (0.7 + r3 * 0.55) * (n === 3 ? 1.1 : 1);
    const key = BKEY[b];
    const P = { X, Y, Z, s, ry: r2 * 6.28, color: tc, lean: r1, sy: 1, name: 'round1' };
    const pick = arr => tc.set(arr[Math.floor(r2 * arr.length)]).offsetHSL((r1 - 0.5) * 0.02, 0, (r3 - 0.5) * 0.06);
    switch (key) {
      case 'taiga': case 'fjord':
        if (r3 < 0.04) { P.name = 'dead'; tc.set('#ffffff'); return P; }
        P.name = 'pine'; P.s *= 0.95; P.sy = 1.3; pick(['#4f7a54', '#5a8458', '#476f4e', '#5f8a5e']); return P;
      case 'tundra':
        if (r3 < 0.5) { P.name = 'bush'; P.s *= 0.7; pick(season === 2 ? ['#b58650', '#a77a48'] : ['#8a9466', '#7e8a5e']); return P; }
        P.name = 'pine'; P.s *= 0.6; P.sy = 1.1; pick(['#5d7f5a', '#647f5c']); return P;
      case 'savanne':
        if (r3 < 0.22) { P.name = 'bush'; pick(['#8f9a52', '#a1a35a']); return P; }
        P.name = 'acacia'; P.s *= 1.05; pick(season === 1 ? ['#8e9a4c', '#9aa252'] : ['#7d9448', '#879c4e', '#94a456']); return P;
      case 'wueste': case 'canyon': case 'salz':
        P.name = 'cactus'; P.s *= 0.85 + r1 * 0.3; pick(['#5f8d4e', '#6c9852', '#577f47']); return P;
      case 'tropen':
        if (l === 0 || r3 < 0.32) { P.name = 'palm'; pick(['#6fae4c', '#5f9e46']); return P; }
        if (r3 < 0.86) { P.name = 'jungle'; P.s *= 1.05; pick(['#3f7f36', '#4a8c3c', '#356f30', '#58963f']); return P; }
        P.name = r1 < 0.5 ? 'round1' : 'round2'; pick(['#4a8a3a', '#3e7a33']); return P;
      case 'oase':
        if (r3 < 0.8) { P.name = 'palm'; pick(['#6fae4c', '#7cb656']); return P; }
        P.name = 'bush'; pick(['#6a9c48']); return P;
      case 'sumpf':
        if (r3 < 0.25) { P.name = 'dead'; tc.set('#ffffff'); return P; }
        if (r3 < 0.5) { P.name = 'bush'; pick(season === 2 ? ['#9c8a52'] : ['#5f7e44', '#6a8448']); return P; }
        P.name = r1 < 0.5 ? 'round1' : 'round2'; P.sy = 1.1;
        pick(season === 2 ? ['#a8904e', '#9a8a4c'] : season === 3 ? WINTER : ['#5c7e46', '#66884a', '#537443']); return P;
      case 'vulkan':
        if (r3 < 0.5) { P.name = 'dead'; tc.set('#d8d0c8'); return P; }
        P.name = 'pine'; pick(['#55775a', '#4f6e52']); return P;
      case 'steppe':
        if (r3 < 0.6) { P.name = 'bush'; pick(season === 2 ? ['#c99a56'] : ['#8fa058', '#9aa860']); return P; }
        break;
      default: break;
    }
    if (l === 0) { P.name = 'palm'; tc.set('#7fae58'); return P; }
    if (l >= 3 || r3 < 0.16) {
      tc.set(r1 < 0.5 ? '#6a9a5e' : '#5f8f62').offsetHSL(0, 0, (r2 - 0.5) * 0.06);
      P.name = 'pine'; P.s *= 0.95; return P;
    }
    const pal = season === 0 && r1 > 0.72 ? BLOSSOM : [SPRING, SUMMER, AUTUMN, WINTER][season];
    tc.set(pal[Math.floor(r2 * pal.length)]).offsetHSL((r1 - 0.5) * 0.02, 0, (r3 - 0.5) * 0.06);
    P.name = r1 < 0.5 ? 'round1' : 'round2';
    return P;
  }

  update(st, season, bldAt) {
    const T = st.tiles, o = new THREE.Object3D(), c = new THREE.Color(), tc = new THREE.Color();
    const B = T.bio || new Uint8Array(NX * NY);
    const now = this.time || 0;
    if (this.chunks.length !== CNX * CNY) this.reset();
    // Ortskerne bleiben frei von Zierbäumen
    const towns = st.settlements.filter(o => o.alive).map(o => [o.cx, o.cy, ((o.R || 6) * 0.8) ** 2]);
    const inTown = (x, y) => towns.some(([cx, cy, r2]) => (x - cx) ** 2 + (y - cy) ** 2 < r2);
    // Was hat sich seit dem letzten Mal geändert? Neue Bäume wachsen sichtbar, verschwundene fallen um.
    // Erde (this.active): nur die feinen Stücke rund um den Blick, zwei Puffer im Wechsel statt neuer Felder je Lauf
    const act = this.active || null, was0 = this.prevAct || null;
    const both = ci => !act || (was0 && was0.has(ci));
    let cur, curN;
    if (act) {
      if (!this.bufA || this.bufA[0].length !== NX * NY) { this.bufA = [new Uint8Array(NX * NY), new Uint8Array(NX * NY)]; this.bufN = [new Uint8Array(NX * NY), new Uint8Array(NX * NY)]; this.bufK = 0; }
      this.bufK ^= 1; cur = this.bufA[this.bufK]; curN = this.bufN[this.bufK];
      for (const ci of act) {
        const tx0 = (ci % CNX) * CH, ty0 = Math.floor(ci / CNX) * CH;
        for (let y = ty0; y < Math.min(NY, ty0 + CH); y++) for (let x = tx0; x < Math.min(NX, tx0 + CH); x++) {
          const i = idx(x, y);
          if (T.h[i] < 0 || bldAt[i]) { cur[i] = 0; curN[i] = 0; continue; }
          cur[i] = Trees.count(T, i, x, y, inTown); curN[i] = T.tree[i];
        }
      }
    } else {
      cur = new Uint8Array(NX * NY); curN = new Uint8Array(NX * NY);
      for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
        const i = idx(x, y);
        if (T.h[i] < 0 || bldAt[i]) continue;
        cur[i] = Trees.count(T, i, x, y, inTown); curN[i] = T.tree[i];
      }
    }
    const tilesOf = fn => {
      if (!act) { for (let i = 0; i < NX * NY; i++) fn(i); return; }
      for (const ci of act) {
        if (!both(ci)) continue;
        const tx0 = (ci % CNX) * CH, ty0 = Math.floor(ci / CNX) * CH;
        for (let y = ty0; y < Math.min(NY, ty0 + CH); y++) for (let x = tx0; x < Math.min(NX, tx0 + CH); x++) fn(idx(x, y));
      }
    };
    let changes = 0;
    if (this.prev && !this.quiet) tilesOf(i => { if (cur[i] !== this.prev[i]) changes++; });
    const animate = this.prev && !this.quiet && changes > 0 && changes < 160;
    const oldGrow = this.growing || new Map();
    this.growing = new Map();
    if (animate) {
      tilesOf(i => {
        const was = this.prev[i];
        if (cur[i] >= was || (T.burn && T.burn[i])) return;
        const x = i % NX, y = (i / NX) | 0;
        for (let k = cur[i]; k < was; k++) if (this.falling.length < 40) {
          const P = this.place(x, y, k, this.prevN[i], T.h[i], season, new THREE.Color(), B[i]);
          this.falling.push({ ...P, color: P.color.clone(), a: hash(x * 7 + k, y * 5) * 6.28, t0: now + hash(x + k, y * 3) * 1.5 });
        }
      });
    }
    // Je Stück: nur neu bauen, wenn sich dort etwas geändert hat
    for (let ci = 0; ci < CNX * CNY; ci++) {
      if (act && !act.has(ci)) {
        // Erde: Stück außer Sicht, seine Bäume freigeben
        const C0 = this.chunks[ci];
        if (C0) { for (const K of Object.values(C0.kinds)) { for (const m of K.ms) { this.scene.remove(m); m.dispose(); } for (const m of K.lo) this.scene.remove(m); } this.chunks[ci] = null; }
        continue;
      }
      const tx0 = (ci % CNX) * CH, ty0 = Math.floor(ci / CNX) * CH;
      let sig = season + 1;
      for (let y = ty0; y < ty0 + CH; y++) for (let x = tx0; x < tx0 + CH; x++) { const i = idx(x, y); sig = (Math.imul(sig, 31) + cur[i] * 5 + curN[i]) | 0; }
      let C = this.chunks[ci];
      let growHere = false;
      if (animate && both(ci)) for (let y = ty0; y < ty0 + CH && !growHere; y++) for (let x = tx0; x < tx0 + CH; x++) { const i = idx(x, y); if (cur[i] > this.prev[i]) { growHere = true; break; } }
      // Wachsende aus dem letzten Lauf in Stücken, die nicht neu gebaut werden, behalten ihren Platz
      if (C && C.sig === sig && !growHere) {
        for (const [key, g] of oldGrow) { const i = (key / 4) | 0, x = i % NX, y = (i / NX) | 0; if (x >= tx0 && x < tx0 + CH && y >= ty0 && y < ty0 + CH) this.growing.set(key, g); }
        continue;
      }
      // Bäume des Stücks einsammeln, in Hash Reihenfolge (so ist jeder Anfang der Liste eine gleichmäßige Auswahl, für die Ferne)
      const lists = {};
      for (let y = ty0; y < ty0 + CH; y++) for (let x = tx0; x < tx0 + CH; x++) {
        const i = idx(x, y), n = T.tree[i], l = T.h[i];
        if (l < 0 || bldAt[i]) continue;
        for (let k = 0; k < cur[i]; k++) {
          const key = i * 4 + k;
          let g = oldGrow.get(key);
          if (!g && animate && both(ci) && k >= this.prev[i]) g = { t0: now + hash(x * 5 + k, y) * 2.5 };
          const P = this.place(x, y, k, n, l, season, new THREE.Color(), B[i]);
          P.h = hash(x * 17 + k, y * 23);
          if (g) { g.P = { ...P, color: null }; this.growing.set(key, g); P.g = g; }
          (lists[P.name] = lists[P.name] || []).push(P);
        }
        if (l >= 1 && l <= 2 && T.road[i] < 40 && hash(x + 5, y + 9) < BUSH[B[i]]) {
          const X = x - NX / 2 + 0.5 + (hash(x, y + 3) - 0.5) * 0.7, Z = y - NY / 2 + 0.5 + (hash(x + 4, y) - 0.5) * 0.7;
          const bk = BKEY[B[i]];
          tc.set(bk === 'tundra' ? '#8a9466' : bk === 'savanne' ? '#9aa252' : bk === 'tropen' ? '#4f8f3c' : season === 2 ? '#c98d52' : season === 3 ? '#8fa19f' : '#76ab55');
          (lists.bush = lists.bush || []).push({ name: 'bush', X, Y: groundY(X, Z), Z, s: 0.9 + hash(x, y) * 0.6, ry: hash(y, x) * 6, color: tc.clone(), lean: 0.5, sy: 1, h: hash(x, y * 3 + 1) });
        }
      }
      if (!C) C = this.chunks[ci] = { kinds: {}, sig: 0, cx: tx0 + CH / 2 - NX / 2, cz: ty0 + CH / 2 - NY / 2 };
      C.sig = sig;
      for (const name of this.names) {
        const list = lists[name] || [];
        let K = C.kinds[name];
        if (!list.length) { if (K) for (const m of [...K.ms, ...K.lo]) { m.count = 0; m.visible = false; } if (K) K.n = 0; continue; }
        if (!K || K.cap < list.length) {
          if (K) { for (const m of K.ms) { this.scene.remove(m); m.dispose(); } for (const m of K.lo) this.scene.remove(m); }
          const cap = Math.ceil(list.length * 1.3) + 8;
          const sph = new THREE.Sphere(new THREE.Vector3(C.cx, 1.5, C.cz), CH * 0.75 + 3);
          const ms = this.kinds[name].map(([g, m]) => {
            const im = new THREE.InstancedMesh(g, m, cap);
            im.castShadow = true; im.receiveShadow = true; im.count = 0;
            im.boundingSphere = sph;
            this.scene.add(im);
            return im;
          });
          // Fernform teilt sich Lage und Farbe mit der Nahform
          const lo = this.low[name].map((g, q) => {
            const im = new THREE.InstancedMesh(g, this.kinds[name][q] ? this.kinds[name][q][1] : this.barkMat, cap);
            im.instanceMatrix = ms[q].instanceMatrix;
            if (!ms[q].instanceColor) ms[q].setColorAt(0, c.set('#ffffff'));
            im.instanceColor = ms[q].instanceColor;
            im.castShadow = false; im.receiveShadow = false; im.count = 0; im.visible = false;
            im.boundingSphere = sph;
            this.scene.add(im);
            return im;
          });
          K = C.kinds[name] = { ms, lo, cap, n: 0 };
        }
        list.sort((a, b) => a.h - b.h);
        list.forEach((P, n) => {
          const sc = P.g ? 0.04 : 1;
          o.position.set(P.X, P.Y, P.Z); o.scale.set(P.s * sc, P.s * (0.9 + P.lean * 0.3) * (P.sy || 1) * sc, P.s * sc); o.rotation.set(0, P.ry, 0); o.updateMatrix();
          K.ms.forEach((m, q) => { m.setMatrixAt(n, o.matrix); m.setColorAt(n, q === 0 && this.kinds[name][0][1] === this.leafMat ? P.color : c.set('#ffffff')); });
          if (P.g) P.g.slot = [K, n];
        });
        K.n = list.length;
        for (const m of K.ms) { m.count = K.n; m.visible = true; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
        K.near = -1; // Nah oder fern entscheidet tick()
      }
    }
    this.prev = cur; this.prevN = curN; this.quiet = false;
    this.prevAct = act ? new Set(act) : null;
  }

  // Jedes Bild: Setzlinge wachsen hoch (rund 6 Sekunden), gefällte Bäume kippen, federn nach und versinken.
  // Ferne Stücke zeigen nur einen Teil ihrer Bäume (gleichmäßig verteilt), damit die große Welt flüssig bleibt
  tick(t) {
    this.time = t;
    const o = this._o || (this._o = new THREE.Object3D());
    if (this.camera) {
      const cp = this.camera.position;
      for (const C of this.chunks) {
        if (!C) continue;
        // Abstand zum nächsten Punkt des Stücks (nicht zur Mitte), dazu die Höhe der Kamera
        const dx = Math.max(0, Math.abs(cp.x - C.cx) - CH / 2), dz = Math.max(0, Math.abs(cp.z - C.cz) - CH / 2);
        const d = Math.hypot(dx, dz, cp.y);
        const near = d < 75;
        const lod = d < 110 ? 1 : Math.max(0.2, 1 - (d - 110) / 300);
        for (const K of Object.values(C.kinds)) {
          const n = Math.max(0, Math.min(K.n, Math.ceil(K.n * lod)));
          if (K.near !== near) { K.near = near; for (const m of K.ms) m.visible = near && K.n > 0; for (const m of K.lo) m.visible = !near && K.n > 0; }
          for (const m of near ? K.ms : K.lo) if (m.count !== n) m.count = n;
        }
      }
    }
    if (this.growing && this.growing.size) {
      const touched = new Set();
      for (const [key, g] of this.growing) {
        if (!g.slot) { this.growing.delete(key); continue; }
        const u = Math.max(0, Math.min(1, (t - g.t0) / 6));
        // sanft herausdrücken, kurz über das Ziel hinaus, dann ruhig
        const e = u >= 1 ? 1 : Math.max(0.04, 1 + 2.2 * Math.pow(u - 1, 3) + 1.2 * Math.pow(u - 1, 2));
        const P = g.P, [K, n] = g.slot;
        o.position.set(P.X, P.Y, P.Z); o.scale.set(P.s * e, P.s * (0.9 + P.lean * 0.3) * (P.sy || 1) * e, P.s * e); o.rotation.set(0, P.ry, 0); o.updateMatrix();
        for (const m of K.ms) m.setMatrixAt(n, o.matrix);
        touched.add(K);
        if (u >= 1) this.growing.delete(key);
      }
      for (const K of touched) for (const m of K.ms) m.instanceMatrix.needsUpdate = true;
    }
    if (!this.falling.length) { for (const F of Object.values(this.fallers)) if (F.ms[0].count) for (const m of F.ms) m.count = 0; return; }
    for (const F of Object.values(this.fallers)) F.n = 0;
    const qY = this._qY || (this._qY = new THREE.Quaternion()), qT = this._qT || (this._qT = new THREE.Quaternion()), ax = this._ax || (this._ax = new THREE.Vector3());
    const keep = [];
    for (const f of this.falling) {
      const u = t - f.t0;
      if (u > 6.4) continue;
      keep.push(f);
      const F = this.fallers[f.name];
      if (!F || F.n >= F.max) continue;
      // 0 bis 0,5 s Hiebe (Zittern), bis 1,9 s Fall, dann Nachfedern, ab 4,6 s versinken
      let ang = 0;
      if (u < 0.5) ang = Math.sin(u * 40) * 0.035 * Math.max(0, u);
      else if (u < 1.9) { const v = (u - 0.5) / 1.4; ang = 1.48 * v * v; }
      else { const v = u - 1.9; ang = 1.48 - Math.sin(v * 9) * 0.09 * Math.exp(-v * 4); }
      if (u >= 1.9 && !f.hit) { f.hit = true; if (this.onFall) this.onFall(f.X + Math.cos(f.a) * f.s * 1.1, f.Y, f.Z + Math.sin(f.a) * f.s * 1.1, f.s); }
      const sink = u > 4.6 ? Math.min(1, (u - 4.6) / 1.8) : 0;
      ax.set(Math.sin(f.a), 0, -Math.cos(f.a));
      qT.setFromAxisAngle(ax, ang); qY.setFromAxisAngle(ax.set(0, 1, 0), f.ry);
      o.quaternion.copy(qT).multiply(qY);
      o.position.set(f.X, f.Y - sink * 0.5, f.Z);
      const e = 1 - sink * 0.85;
      o.scale.set(f.s * e, f.s * (0.9 + f.lean * 0.3) * (f.sy || 1) * e, f.s * e);
      o.updateMatrix();
      F.ms.forEach((m, q) => { m.setMatrixAt(F.n, o.matrix); if (q === 0 && this.kinds[f.name][0][1] === this.leafMat) m.setColorAt(F.n, f.color); });
      F.n++;
    }
    this.falling = keep;
    for (const F of Object.values(this.fallers)) for (const m of F.ms) { m.count = F.n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
}
// Zierbäume außerhalb der Wälder und Büsche je Lebensraum (Anteil der Felder)
const WILD = BKEY.map(k => ({ mild: 0.4, wald: 0.45, taiga: 0.35, fjord: 0.32, tundra: 0.06, eis: 0, steppe: 0.08, sumpf: 0.3, savanne: 0.12, wueste: 0.04, tropen: 0.5, vulkan: 0.06, salz: 0, canyon: 0.035, oase: 0.5 })[k] ?? 0.3);
const BUSH = BKEY.map(k => ({ eis: 0, salz: 0, wueste: 0.01, canyon: 0.02, tundra: 0.08, steppe: 0.08, savanne: 0.06, tropen: 0.1 })[k] ?? 0.06);

// ---------- Gras ----------

// Grasfarben je Lebensraum und Jahreszeit, dazu Dichte und Höhe
const GRASS = {
  mild: [['#a6d06c', '#8cc25c', '#bcd97e'], ['#b0c766', '#9cb85a', '#c6d074'], ['#c7bd6c', '#b6ab60', '#d4c680'], ['#cdc9ae', '#bfbaa2', '#dad6c4']],
  taiga: [['#8fb062', '#7aa35a', '#a0b86c'], ['#93ad60', '#82a058', '#a4b86a'], ['#b0a868', '#a29a5e', '#bdb476'], ['#c8ccc0', '#bcc0b4', '#d4d8cc']],
  tundra: [['#a9a77a', '#9a9c70', '#bab48a'], ['#aaa678', '#9c9a6e', '#bab286'], ['#b89c6c', '#a88c60', '#c4a878'], ['#d7dad6', '#cbcfcb', '#e2e5e2']],
  steppe: [['#bcc67a', '#a9b46a', '#cfcf86'], ['#d0c47c', '#c2b56c', '#ddd08e'], ['#c9ae72', '#bba064', '#d6bc80'], ['#cdc9ae', '#bfbaa2', '#dad6c4']],
  savanne: [['#c9c572', '#b6b660', '#d6cf80'], ['#dcc56c', '#cdb35e', '#e6d27c'], ['#d6b768', '#c6a75a', '#e2c67a'], ['#d8c06e', '#c9b060', '#e4cc7e']],
  sumpf: [['#7f9a52', '#6c8a4a', '#91a85c'], ['#86a056', '#73904c', '#98ac60'], ['#a28e56', '#94804c', '#b09c62'], ['#a8ab9c', '#9a9e90', '#b6b8aa']],
  tropen: [['#5fae48', '#4f9c3e', '#73bb55'], ['#5fae48', '#4f9c3e', '#73bb55'], ['#62aa48', '#529a3e', '#76b655'], ['#5fae48', '#4f9c3e', '#73bb55']],
  vulkan: [['#8b9a62', '#7c8c58', '#9aa86c'], ['#8b9a62', '#7c8c58', '#9aa86c'], ['#9a9462', '#8c8658', '#a8a26c'], ['#a6a8a0', '#9a9c94', '#b2b4ac']],
};
GRASS.wald = GRASS.mild; GRASS.fjord = GRASS.taiga; GRASS.oase = GRASS.tropen;
const GRASS_N = BKEY.map(k => ({ mild: 1, wald: 0.8, taiga: 0.6, fjord: 0.6, tundra: 0.55, steppe: 1.1, savanne: 1.2, sumpf: 1, tropen: 1, oase: 1, vulkan: 0.25 })[k] || 0);
const GRASS_H = BKEY.map(k => ({ savanne: 1.5, steppe: 1.2, tundra: 0.6, tropen: 1.2, sumpf: 1.3 })[k] || 1);

class Grass {
  constructor(scene) {
    // Büschel aus 8 schmalen, leicht gebogenen Halmen: dunkler Fuß im Bodenton, helle Spitze
    const blades = [];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + (i % 3) * 0.4, r = 0.02 + (i % 3) * 0.028, h = 0.075 + (i % 4) * 0.026 + (i % 2) * 0.012;
      const g = new THREE.BufferGeometry();
      const bx = Math.cos(a) * r, bz = Math.sin(a) * r, w = 0.024;
      const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
      const lean = 1.9 + (i % 3) * 0.35;
      g.setAttribute('position', new THREE.Float32BufferAttribute([bx - px, 0, bz - pz, bx + px, 0, bz + pz, bx * lean, h, bz * lean], 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute([0.74, 0.8, 0.7, 0.74, 0.8, 0.7, 1.2, 1.18, 1.0], 3));
      blades.push(g);
    }
    const mat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), { sway: 0.5, snow: 0.6, upN: 1 });
    this.max = 90000;
    this.mesh = new THREE.InstancedMesh(mergeGeometries(blades), mat, this.max);
    this.mesh.receiveShadow = true; this.mesh.frustumCulled = false; this.mesh.count = 0;
    scene.add(this.mesh);
  }

  update(st, season, bldAt, ter, cx, cy, R) {
    const T = st.tiles, o = new THREE.Object3D(), c = new THREE.Color();
    const B = T.bio || new Uint8Array(NX * NY);
    let n = 0;
    for (let y = Math.max(0, cy - R); y < Math.min(NY, cy + R) && n < this.max; y++) for (let x = Math.max(0, cx - R); x < Math.min(NX, cx + R) && n < this.max; x++) {
      const i = idx(x, y), l = T.h[i];
      if (l < 1 || l > 4 || bldAt[i] || T.burn[i] || T.river[i] || (BLOCK && BLOCK[i])) continue;
      const b = B[i], dens = GRASS_N[b];
      if (!dens) continue;
      const cnt = Math.round(((l <= 2 ? 4 : 2) + (T.fert[i] / 100) * 3 - T.tree[i] * 0.9 - T.road[i] / 90) * dens);
      const base = (GRASS[BKEY[b]] || GRASS.mild)[season], hk = GRASS_H[b];
      for (let k = 0; k < cnt; k++) {
        const X = x - NX / 2 + 0.5 + (hash(x * 7 + k, y) - 0.5) * 0.98, Z = y - NY / 2 + 0.5 + (hash(x, y * 5 + k) - 0.5) * 0.98;
        if (ter && ter.pathAt(X, Z) > 0.5) continue;
        const Y = groundY(X, Z);
        if (Y < 0.3) continue;
        const s = 0.85 + hash(x + k, y + 2) * 0.8;
        o.position.set(X, Y - 0.01, Z); o.scale.set(s, s * (0.8 + hash(y, x + k) * 0.6) * hk, s); o.rotation.set(0, hash(k, x + y) * 6.28, 0);
        o.updateMatrix(); this.mesh.setMatrixAt(n, o.matrix);
        this.mesh.setColorAt(n, c.set(base[Math.floor(hash(x * 3 + k, y * 3) * 3)]));
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// ---------- Blumen ----------

class Flowers {
  constructor(scene) {
    // Lupine: Stiel mit einer Traube kleiner Blütenkugeln statt eines spitzen Kegels
    const spike = paint(mergeGeometries([
      new THREE.CylinderGeometry(0.006, 0.008, 0.12, 3).translate(0, 0.06, 0),
      ...[0, 1, 2, 3, 4].map(i => new THREE.IcosahedronGeometry(0.026 - i * 0.004, 0).translate((i % 2 ? 0.006 : -0.006), 0.13 + i * 0.033, 0)),
    ].map(clean)), '#ffffff', '#5f8a45', 0.1, 0.13);
    const daisy = paint(mergeGeometries([
      new THREE.CylinderGeometry(0.005, 0.006, 0.1, 3).translate(0, 0.05, 0),
      new THREE.IcosahedronGeometry(0.03, 0).scale(1, 0.5, 1).translate(0, 0.11, 0),
    ].map(clean)), '#ffffff', '#5f8a45', 0.08, 0.1);
    const mat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), { sway: 0.5, snow: 0.5 });
    this.max = 26000;
    this.kinds = [spike, daisy].map(g => {
      const m = new THREE.InstancedMesh(g, mat, this.max);
      m.frustumCulled = false; m.count = 0;
      scene.add(m);
      return m;
    });
  }

  update(st, season, bldAt, ter, cx, cy, R) {
    const T = st.tiles, o = new THREE.Object3D(), c = new THREE.Color(), rt = st._rt;
    const B = T.bio || new Uint8Array(NX * NY);
    const LUP = ['#d779b2', '#b893de', '#e8a4c8', '#f0eef5', '#9f8fd8'], DAI = ['#fbf6ec', '#f6d25e', '#f2b9c9', '#ffffff', '#f3a96b'];
    const TROP = ['#ef6b4a', '#f2a03c', '#f7d14c', '#e8507a', '#ffffff'], TUN = ['#f4f1e6', '#efe6a8', '#e8e0f0', '#ffffff', '#f2ecc8'];
    const vis = [1, 0.85, 0.3, 0][season];
    const counts = [0, 0];
    if (vis > 0) for (let y = Math.max(1, cy - R); y < Math.min(NY - 1, cy + R); y++) for (let x = Math.max(1, cx - R); x < Math.min(NX - 1, cx + R); x++) {
      const i = idx(x, y), l = T.h[i];
      if (l < 1 || l > 3 || bldAt[i] || T.road[i] > 200 || T.burn[i] || T.river[i]) continue;
      const bk = BKEY[B[i]];
      if (!(bk === 'mild' || bk === 'wald' || bk === 'steppe' || bk === 'tropen' || bk === 'oase' || bk === 'tundra' || bk === 'sumpf')) continue;
      const meadow = smoothN(x * 0.14 + 3, y * 0.14) > (bk === 'tundra' || bk === 'sumpf' ? 0.68 : 0.6);
      let garden = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const b = rt.bById.get(bldAt[idx(x + dx, y + dy)]); if (b && b.t === 'haus') garden = true; }
      if ((!meadow && !garden) || (BLOCK && BLOCK[i])) continue;
      const cnt = Math.round((garden ? 5 : 4) * vis * (0.5 + hash(x, y + 9)));
      const huePick = Math.floor(smoothN(x * 0.3, y * 0.3) * 5);
      const pal = bk === 'tropen' || bk === 'oase' ? [TROP, TROP] : bk === 'tundra' ? [TUN, TUN] : [LUP, DAI];
      for (let k = 0; k < cnt; k++) {
        const kind = hash(x + k, y * 3) < 0.55 ? 0 : 1;
        if (counts[kind] >= this.max) continue;
        const X = x - NX / 2 + 0.5 + (hash(x * 5 + k, y + 1) - 0.5) * 0.9, Z = y - NY / 2 + 0.5 + (hash(x + 9, y * 7 + k) - 0.5) * 0.9;
        if (ter && ter.pathAt(X, Z) > 0.36) continue;
        o.position.set(X, groundY(X, Z), Z); o.scale.setScalar(0.9 + hash(k, x * y) * 0.7); o.rotation.set(0, hash(x, k) * 6, 0); o.updateMatrix();
        const m = this.kinds[kind];
        m.setMatrixAt(counts[kind], o.matrix);
        m.setColorAt(counts[kind], c.set(pal[kind][(huePick + (hash(k, y) < 0.3 ? 1 : 0)) % 5]));
        counts[kind]++;
      }
    }
    this.kinds.forEach((m, k) => { m.count = counts[k]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
  }
}

// ---------- Kiesel auf Wegen ----------

class PathStones {
  constructor(scene) {
    const mat = patch(new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), { snow: 0.8 });
    this.max = 30000;
    this.mesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.07, 0).scale(1, 0.28, 0.8), mat, this.max);
    this.mesh.receiveShadow = true; this.mesh.frustumCulled = false; this.mesh.count = 0;
    scene.add(this.mesh);
  }

  update(st, ter, cx, cy, R) {
    const T = st.tiles, rt = st._rt, o = new THREE.Object3D(), c = new THREE.Color();
    const D = ter ? ter.roadData : null;
    let n = 0;
    for (let y = Math.max(0, cy - R); y < Math.min(NY, cy + R) && n < this.max; y++) for (let x = Math.max(0, cx - R); x < Math.min(NX, cx + R) && n < this.max; x++) {
      const i = idx(x, y), r = T.road[i];
      if (r < 110 || T.h[i] < 0 || rt.bldAt[i] || (ter && ter.streetMask && ter.streetMask[i])) continue;
      if (D && (D[i * 4 + 1] || D[i * 4 + 2] || D[i * 4 + 3])) continue; // Pflaster, Asphalt, Platten zeichnet der Shader
      const cnt = r > 200 ? 3 : 2;
      for (let k = 0; k < cnt; k++) {
        const X = x - NX / 2 + 0.5 + (hash(x * 3 + k, y) - 0.5) * 0.9, Z = y - NY / 2 + 0.5 + (hash(x, y * 3 + k) - 0.5) * 0.9;
        if (ter && ter.pathAt(X, Z) < 0.62) continue;
        const s = 0.45 + hash(k, x + y) * 0.45;
        o.position.set(X, groundY(X, Z) + 0.004, Z); o.scale.set(s, 0.5 + hash(x, k) * 0.6, s * (0.7 + hash(y, k) * 0.5)); o.rotation.set(0, hash(x + k, y) * 6, 0);
        o.updateMatrix(); this.mesh.setMatrixAt(n, o.matrix);
        this.mesh.setColorAt(n, c.set(hash(x + k, y + 1) < 0.5 ? '#e2d8c4' : '#c9bfad').offsetHSL(0, 0, (hash(k, y) - 0.5) * 0.06));
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
