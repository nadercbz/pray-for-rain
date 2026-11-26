// Wolken (seit 19.10.2026, Naders Wunsch: viel schönere Wolken und ein atemberaubender Himmel).
// Haufenwolken aus vielen weichen Kugeln (ein InstancedMesh, ein Zeichenaufruf), jede Kugel im Vertex Shader mit
// Rauschen aufgebeult. Eigenes Licht: oben warm von der Sonne, unten kühl und dunkler (die Unterseite flacher
// Wolken), am Rand gegen die Sonne ein Silberrand, die Kanten blenden weich aus (keine harten Kugelränder).
// Die Wolken liegen rund um den Blick (wandern mit, wo auch immer man auf der Karte ist), ziehen mit dem Wind,
// ihre Zahl folgt dem Wetter, bei Sturm dunkel und tief. Sie werfen weiche Schatten auf den Boden.
import * as THREE from 'three';
import { groundY } from './terrain.js';

const MAXC = 44, FARC = 14, PER = 16, MAXP = (MAXC + FARC) * PER;
const SPREAD = 260;   // halbe Kantenlänge des Felds um den Blick
const rnd = (a, b) => a + Math.random() * (b - a);

const VS = `
  attribute vec4 aC; // x Höhe der Wolkenunterseite, y Zufall, z Sichtbarkeit, w Größe der Kugel
  varying vec3 vN; varying vec3 vW; varying vec4 vC;
  #include <common>
  #include <fog_pars_vertex>
  float hh(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float nz(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hh(i), hh(i + vec3(1,0,0)), f.x), mix(hh(i + vec3(0,1,0)), hh(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hh(i + vec3(0,0,1)), hh(i + vec3(1,0,1)), f.x), mix(hh(i + vec3(0,1,1)), hh(i + vec3(1,1,1)), f.x), f.y), f.z); }
  void main() {
    vC = aC;
    vec3 p = position;
    vec3 n = normalize(position);
    // aufgebeulte Kugel: zwei Rauschlagen entlang der Normale, unten etwas flacher
    float b = nz(p * 1.7 + aC.y * 13.0) * 0.55 + nz(p * 3.9 + aC.y * 7.0) * 0.25;
    p += n * (b - 0.35) * 0.42;
    p.y *= mix(0.7, 1.0, step(0.0, p.y));
    vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix * instanceMatrix) * n);
    vec4 mvPosition = viewMatrix * w;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const FS = `
  uniform vec3 uSun, uSunCol, uLit, uShade, uRim; uniform float uOpacity, uNight;
  varying vec3 vN; varying vec3 vW; varying vec4 vC;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    vec3 n = normalize(vN), v = normalize(cameraPosition - vW), s = normalize(uSun);
    float ndl = dot(n, s) * 0.5 + 0.5;
    vec3 c = mix(uShade, uLit, smoothstep(0.15, 0.95, ndl));
    // Unterseite: je tiefer in der Wolke, desto kühler und dunkler
    float under = 1.0 - smoothstep(vC.x, vC.x + 5.0, vW.y);
    c = mix(c, uShade * 0.9, under * 0.5);
    // Silberrand: Kanten, hinter denen die Sonne steht, leuchten
    float edge = 1.0 - abs(dot(n, v));
    float back = pow(max(dot(-v, s), 0.0), 3.0);
    c += uRim * pow(edge, 2.5) * (0.35 + back * 1.4);
    // Gegenlicht: steht die Sonne hinter der Wolke, leuchtet sie warm durch (sonst nur dunkle Scherenschnitte am Abend)
    c += uRim * back * (1.0 - ndl) * 0.45;
    // weiche Kanten statt harter Kugelränder
    float a = uOpacity * vC.z * smoothstep(0.0, 0.42, abs(dot(n, v)));
    gl_FragColor = vec4(c, a);
    // eigener, viel weiterer Dunst: mit dem normalen Nebel verschwänden Wolken schon ab 160 Einheiten in der Suppe
    #ifdef USE_FOG
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(fogNear * 1.6, fogFar * 1.25, vFogDepth) * 0.85);
    #endif
  }`;

export class Clouds {
  constructor(scene) {
    this.scene = scene;
    const geo = new THREE.IcosahedronGeometry(1, 2);
    this.aC = new Float32Array(MAXP * 4);
    geo.setAttribute('aC', new THREE.InstancedBufferAttribute(this.aC, 4));
    this.uni = {
      uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color('#fff') },
      uLit: { value: new THREE.Color('#ffffff') }, uShade: { value: new THREE.Color('#aab8c8') }, uRim: { value: new THREE.Color('#fff4dc') },
      uOpacity: { value: 0.96 }, uNight: { value: 0 },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, this.uni]), vertexShader: VS, fragmentShader: FS,
      transparent: true, depthWrite: false, fog: true,
    });
    for (const k of Object.keys(this.uni)) this.mat.uniforms[k] = this.uni[k];
    this.mesh = new THREE.InstancedMesh(geo, this.mat, MAXP);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.renderOrder = 6;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.list = [];
    this.o = new THREE.Object3D();
    this.inited = false;
  }

  // eine Wolke wie ein Haufen: breite, flache Basis aus großen Kugeln, darüber gewölbte Kuppen, bei großen eine Spitze
  make(x, z) {
    const big = Math.random() < 0.35, len = rnd(10, big ? 24 : 16), wid = rnd(4, 8), puffs = [];
    const n0 = 6 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n0; i++) {
      const t = i / (n0 - 1) - 0.5;
      puffs.push({ x: t * len + rnd(-1, 1), y: rnd(0, 1.2), z: rnd(-wid, wid) * 0.4, r: rnd(3.2, 5.2) * (1 - Math.abs(t) * 0.55) });
    }
    const n1 = 3 + Math.floor(Math.random() * (big ? 4 : 3));
    for (let i = 0; i < n1; i++) {
      const t = (n1 > 1 ? i / (n1 - 1) - 0.5 : 0) * 0.6;
      puffs.push({ x: t * len + rnd(-1.5, 1.5), y: rnd(2.6, 4.8), z: rnd(-wid, wid) * 0.25, r: rnd(3.0, 4.6) });
    }
    if (big) for (let i = 0; i < 2; i++) puffs.push({ x: rnd(-len, len) * 0.15, y: rnd(5.5, 7.8), z: rnd(-1.5, 1.5), r: rnd(2.6, 3.8) });
    return { x, z, y: rnd(30, 40), sp: rnd(0.6, 1.4), s: rnd(0.8, 1.25), puffs: puffs.slice(0, PER), vis: 0, seed: Math.random(), on: false };
  }

  // ferne Wolkenbänke: ein Ring weit draußen, groß und hoch, damit über dem Horizont immer Wolken stehen
  makeFar(i) {
    const c = this.make(0, 0);
    c.far = true; c.a = (i / FARC) * Math.PI * 2 + rnd(-0.2, 0.2); c.r = rnd(360, 520);
    c.y = rnd(44, 62); c.s = rnd(1.8, 2.7); c.sp = rnd(0.0006, 0.0014);
    return c;
  }

  update(dt, cam, target, wxs, night, sunDir, sunCol, hor, zen) {
    if (!this.inited) {
      this.inited = true;
      for (let i = 0; i < MAXC; i++) this.list.push(this.make(target.x + rnd(-SPREAD, SPREAD), target.z + rnd(-SPREAD, SPREAD)));
      for (let i = 0; i < FARC; i++) this.list.push(this.makeFar(i));
    }
    const want = Math.round((wxs.clouds ?? 0.3) * MAXC), wantFar = Math.round(Math.min(1, 0.25 + (wxs.clouds ?? 0.3)) * FARC);
    const storm = wxs.storm || 0, gloom = wxs.gloom || 0, day = 1 - night;
    // Farben aus Himmel und Sonne: oben das Sonnenlicht, unten der Himmel am Horizont, nachts mondgrau
    const U = this.uni;
    U.uSun.value.copy(sunDir);
    const lit = new THREE.Color(1, 1, 1).lerp(sunCol, 0.45).multiplyScalar(0.85 + day * 0.2);
    const shade = hor.clone().lerp(zen, 0.35).lerp(new THREE.Color('#8f9aa8'), 0.35);
    const grey = new THREE.Color('#5d646d');
    lit.lerp(new THREE.Color('#b5bcc4'), gloom * 0.6).lerp(grey, storm * 0.55);
    shade.lerp(grey, gloom * 0.6 + storm * 0.3);
    // tiefe Sonne: die Wolken glühen warm (Abendrot), erst wenn es wirklich dunkel wird, werden sie mondgrau
    const low = 1 - THREE.MathUtils.smoothstep(sunDir.y, -0.05, 0.38);
    if (low > 0.01) {
      const g = (1 - gloom * 0.6) * low;
      lit.lerp(hor.clone().multiplyScalar(1.15), g * 0.7).multiplyScalar(1 + g * 0.2);
      shade.lerp(hor.clone().lerp(zen, 0.45), g * 0.55);
    }
    const nk = THREE.MathUtils.smoothstep(night, 0.7, 1.0);
    if (nk > 0.01) { lit.lerp(new THREE.Color('#5c6688'), nk * 0.85); shade.lerp(new THREE.Color('#262c44'), nk * 0.85); }
    U.uLit.value.copy(lit); U.uShade.value.copy(shade);
    U.uRim.value.copy(sunCol).multiplyScalar((0.55 * day + 0.8 * low * (1 - nk)) * (1 - gloom * 0.8));
    U.uNight.value = night;
    const windS = (1 + storm * 4) * 0.8;
    let k = 0;
    const o = this.o;
    for (let i = 0; i < this.list.length; i++) {
      const c = this.list[i];
      if (c.far) {
        c.a += c.sp * dt * windS;
        c.x = target.x + Math.cos(c.a) * c.r; c.z = target.z + Math.sin(c.a) * c.r;
        c.vis += ((i - MAXC < wantFar ? 1 : 0) - c.vis) * Math.min(1, dt * 0.3);
      } else {
        c.x += c.sp * dt * windS;
        // um den Blick herum: wer zu weit weg ist, kommt auf der anderen Seite wieder herein
        if (c.x - target.x > SPREAD) { c.x -= SPREAD * 2; c.z = target.z + rnd(-SPREAD, SPREAD); c.vis = 0; }
        if (c.x - target.x < -SPREAD) c.x += SPREAD * 2;
        if (c.z - target.z > SPREAD) c.z -= SPREAD * 2;
        if (c.z - target.z < -SPREAD) c.z += SPREAD * 2;
        c.vis += ((i < want ? 1 : 0) - c.vis) * Math.min(1, dt * 0.5);
      }
      if (c.vis < 0.01) continue;
      // hohe Gebirge (Erde): die Wolke bleibt mindestens 5 über dem Boden unter ihr, sanft nachgeführt, so legen sich
      // Wolken an die Hänge des Himalaya statt im Fels zu stecken. Im Archipel liegt der Boden immer weit darunter.
      const g = groundY(c.x, c.z) + 5; c.gy = c.gy == null ? g : c.gy + (g - c.gy) * Math.min(1, dt * 0.6);
      const cy = Math.max(c.y - storm * 5, c.gy);
      // nah an der Kamera ausblenden (man fliegt sonst durch Watte)
      const dCam = Math.hypot(cam.position.x - c.x, cam.position.y - cy, cam.position.z - c.z);
      const near = THREE.MathUtils.smoothstep(dCam, 18, 46);
      // von oben (Gottblick) durchscheinender, damit die Wolken die Welt nicht zudecken
      const above = THREE.MathUtils.smoothstep(cam.position.y - cy, 4, 60);
      const vis = c.vis * near * (1 - above * 0.6);
      if (vis < 0.01) continue;
      for (const p of c.puffs) {
        if (k >= MAXP) break;
        o.position.set(c.x + p.x * c.s, cy + p.y * c.s, c.z + p.z * c.s);
        o.scale.setScalar(p.r * c.s * (0.75 + c.vis * 0.25));
        o.updateMatrix();
        this.mesh.setMatrixAt(k, o.matrix);
        this.aC[k * 4] = cy - 1.5 * c.s; this.aC[k * 4 + 1] = c.seed + p.x * 0.13; this.aC[k * 4 + 2] = vis; this.aC[k * 4 + 3] = p.r;
        k++;
      }
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.attributes.aC.needsUpdate = true;
  }
}
