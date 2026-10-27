// Bühne: Renderer, Kamera, Licht, Himmel, Tageszeit und Nachbearbeitung (Tilt Shift, Farbe, Korn).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { U } from './mats.js';
import { NX, NY } from '../sim/world.js';

// Weltgröße (seit 19.10.2026 rechteckig): Inselwelten 320 x 320, die echte Erde 2048 x 1024. Feld (x, y) liegt bei
// Welt X = x - NX / 2 + 0.5, Z = y - NY / 2 + 0.5. NX, NY stehen beim Laden der Seite fest (index.html, PFR_SIZE).
export { NX, NY };
const LY = { '-2': -1.0, '-1': -0.42, 0: 0.12, 1: 0.42, 2: 0.86, 3: 1.4, 4: 2.1, 5: 2.95, 6: 3.95, 7: 5.3, 8: 6.8, 9: 8.5 }; // 7 bis 9: hohe Gipfel der neuen Welt
export const tileY = l => LY[l] ?? l * 0.7;
export const wx = x => x - NX / 2 + 0.5;
export const wz = y => y - NY / 2 + 0.5;

const C = h => new THREE.Color(h);
// Tageszeit-Palette: Zeitpunkt (0 = Mitternacht) mit Himmel, Licht und Nebel
const KEYS = [
  // Nacht: silberblaues Mondlicht, aufgehellte blaue Schatten, damit die Insel lesbar bleibt
  { t: 0.0, zen: C('#17254c'), hor: C('#3a4c7c'), sun: C('#b8cdf4'), si: 0.95, sky: C('#5f78b2'), gnd: C('#2a3150'), hi: 0.95, fog: C('#2c3c66'), exp: 1.32 },
  { t: 0.2, zen: C('#24336a'), hor: C('#6a5a90'), sun: C('#bcaee6'), si: 0.78, sky: C('#6a72aa'), gnd: C('#382f4e'), hi: 0.9, fog: C('#4a4878'), exp: 1.24 },
  { t: 0.255, zen: C('#3f6096'), hor: C('#f6a77c'), sun: C('#ffb47a'), si: 1.15, sky: C('#93aacb'), gnd: C('#5a443c'), hi: 0.66, fog: C('#eab79e'), exp: 1.08 },
  { t: 0.32, zen: C('#74b4e6'), hor: C('#f9e7c8'), sun: C('#ffe8c2'), si: 1.85, sky: C('#cfe0f2'), gnd: C('#a08868'), hi: 0.82, fog: C('#e6edee'), exp: 1.08 },
  { t: 0.5, zen: C('#68ade6'), hor: C('#f0eedf'), sun: C('#fff0d8'), si: 2.0, sky: C('#d4e4f4'), gnd: C('#a68e6a'), hi: 0.8, fog: C('#e4ecee'), exp: 1.1 },
  { t: 0.68, zen: C('#74a6da'), hor: C('#fadeb0'), sun: C('#ffd9a2'), si: 1.85, sky: C('#d8dbee'), gnd: C('#a07e5a'), hi: 0.8, fog: C('#f0e2c8'), exp: 1.08 },
  { t: 0.75, zen: C('#4e5292'), hor: C('#ff9c6a'), sun: C('#ff8c52'), si: 1.25, sky: C('#aa9cc4'), gnd: C('#62443a'), hi: 0.66, fog: C('#ea9f86'), exp: 1.06 },
  { t: 0.82, zen: C('#28306a'), hor: C('#7c5a8c'), sun: C('#b4a0dc'), si: 0.75, sky: C('#62689e'), gnd: C('#352c4a'), hi: 0.86, fog: C('#4c4472'), exp: 1.2 },
  { t: 1.0, zen: C('#17254c'), hor: C('#3a4c7c'), sun: C('#b8cdf4'), si: 0.95, sky: C('#5f78b2'), gnd: C('#2a3150'), hi: 0.95, fog: C('#2c3c66'), exp: 1.32 },
];

export function sampleDay(f) {
  let a = KEYS[0], b = KEYS[1];
  for (let i = 0; i < KEYS.length - 1; i++) if (f >= KEYS[i].t && f <= KEYS[i + 1].t) { a = KEYS[i]; b = KEYS[i + 1]; break; }
  const k = (f - a.t) / Math.max(1e-6, b.t - a.t);
  const o = {};
  for (const key of ['zen', 'hor', 'sun', 'sky', 'gnd', 'fog']) o[key] = a[key].clone().lerp(b[key], k);
  for (const key of ['si', 'hi', 'exp']) o[key] = a[key] + (b[key] - a[key]) * k;
  return o;
}

// Himmel (seit 19.10.2026, Naders Wunsch: atemberaubend). Verlauf Horizont zu Zenit aus den Tageszeit-Schlüsseln, dazu
// eine helle Dunstschicht über dem Horizont, Lichthof und scharfe Sonnenscheibe, bei tiefer Sonne ein warmes Farbband
// in ihrer Richtung (Abend- und Morgenrot), hohe Schleierwolken, die langsam ziehen und von unten Sonnenfarbe
// bekommen, nachts eine Milchstraße. Ein Hauch Rauschen gegen Stufen im Verlauf.
const SkyShader = {
  uniforms: { zen: { value: C('#5aa6e0') }, hor: { value: C('#dcf0f7') }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: C('#fff') }, glow: { value: 1 },
    time: { value: 0 }, night: { value: 0 }, cirrus: { value: 0.5 }, gloom: { value: 0 } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform vec3 zen, hor, sunCol, sunDir; uniform float glow, time, night, cirrus, gloom; varying vec3 vDir;
    float hs(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float ns(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hs(i), hs(i + vec2(1.0, 0.0)), f.x), mix(hs(i + vec2(0.0, 1.0)), hs(i + vec2(1.0, 1.0)), f.x), f.y); }
    float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += ns(p) * a; p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
    void main(){
      vec3 d = normalize(vDir);
      float h = clamp(d.y, -0.2, 1.0);
      vec3 c = mix(hor, zen, pow(smoothstep(-0.02, 0.3, h), 0.5)); // die Kamera sieht nur bis etwa 15 Grad über den Horizont, dort soll es schon blau sein
      vec3 sd = normalize(sunDir);
      float s = max(dot(d, sd), 0.0);
      // Dunst über dem Horizont: heller, leicht ins Sonnenlicht gefärbt
      float haze = exp(-max(h, 0.0) * 9.0);
      c = mix(c, mix(hor, sunCol, 0.25) * 1.06, haze * 0.35 * (1.0 - night * 0.8));
      // Morgen- und Abendrot: warmes Band am Horizont in Richtung der tiefen Sonne
      float low = 1.0 - smoothstep(-0.05, 0.38, sd.y);
      vec2 dh = d.xz / max(length(d.xz), 1e-4), sh = sd.xz / max(length(sd.xz), 1e-4);
      float toward = pow(clamp(dot(dh, sh) * 0.5 + 0.5, 0.0, 1.0), 2.5); // clamp: gegenüber der Sonne sonst pow(-0) = NaN, der Bloom macht daraus schwarze Flächen
      float band = exp(-max(h, 0.0) * 5.5) * low * glow;
      c = mix(c, sunCol * vec3(1.08, 0.66, 0.42), clamp(band * (0.18 + toward * 0.62), 0.0, 1.0));
      c += vec3(0.25, 0.08, 0.12) * band * toward * 0.25;
      // Lichthof und Sonnenscheibe
      c += sunCol * (pow(s, 6.0) * 0.12 + pow(s, 40.0) * 0.32 + pow(s, 400.0) * 0.7) * glow;
      c += sunCol * smoothstep(0.99935, 0.99965, s) * 2.6 * glow * (1.0 - gloom);
      // hohe Schleierwolken, auf eine Himmelsebene gelegt, gestreckt, ziehen langsam
      if (d.y > 0.01 && cirrus > 0.01) {
        vec2 uv = d.xz / (d.y + 0.12) * 1.3;
        uv = mat2(0.86, -0.5, 0.5, 0.86) * uv + vec2(time * 0.006, time * 0.002);
        float n = fbm(uv * vec2(0.55, 1.9)) * 0.7 + fbm(uv * 3.1 + 4.0) * 0.3;
        float cir = smoothstep(0.52, 0.82, n) * cirrus * smoothstep(0.01, 0.22, d.y);
        vec3 cc = mix(vec3(1.0, 0.99, 0.97), sunCol * vec3(1.05, 0.8, 0.7), 0.25 + low * 0.6) * (0.75 + 0.25 * glow);
        cc = mix(cc, vec3(0.42, 0.46, 0.6), night * 0.8);
        c = mix(c, cc, cir * 0.55 * (1.0 - gloom * 0.7));
      }
      // Milchstraße: ein schräges, fleckiges Lichtband über den Nachthimmel
      if (night > 0.01) {
        float mw = exp(-pow(dot(d, normalize(vec3(0.38, 0.52, 0.76))), 2.0) * 16.0);
        float nz = fbm(vec2(atan(d.z, d.x) * 6.0, d.y * 9.0));
        c += vec3(0.55, 0.6, 0.88) * mw * (0.25 + nz * 0.75) * night * 0.16 * (1.0 - gloom) * smoothstep(-0.05, 0.25, d.y);
      }
      // ACES bleicht helle Himmelsfarben fast weiß: über dem Horizont die Sättigung vorab anheben, am Horizont selbst
      // bleibt die Farbe gleich (sie muss zum Nebel passen, sonst steht dort eine Kante)
      float up = smoothstep(0.02, 0.22, h) * (1.0 - gloom * 0.5);
      float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(c, mix(vec3(L), c, 1.55) * 0.86, up);
      c = mix(c, hor * 0.8, smoothstep(0.02, -0.2, h));
      c += (hs(gl_FragCoord.xy) - 0.5) / 255.0;
      gl_FragColor = vec4(c, 1.0); }`,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, res: { value: new THREE.Vector2(1, 1) }, time: { value: 0 },
    focus: { value: 0.52 }, blur: { value: 1.0 }, near: { value: 1.0 }, sat: { value: 1.06 }, warm: { value: 0.02 },
    vig: { value: 0.3 }, grain: { value: 0.014 }, lift: { value: 0.0 }, flash: { value: 0 }, tint: { value: C('#ffffff') },
    shadowTint: { value: new THREE.Vector3(0, 0, 0) }, hiTint: { value: new THREE.Vector3(0, 0, 0) }, contrast: { value: 0.0 },
    // Schärfentiefe aus dem Tiefenpuffer (seit 24.10.2026, PLAN_GRAFIK.md): Tiefe aus dem GTAO Durchgang, scharf in der
    // Entfernung des Blickziels, davor und dahinter unscharf wie beim Foto einer Miniatur
    tDepth: { value: null }, useDepth: { value: 0 }, cNear: { value: 0.5 }, cFar: { value: 2400 }, focusZ: { value: 30 }, aperture: { value: 1.0 }, maxR: { value: 12 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse, tDepth; uniform vec2 res; uniform float time, focus, blur, near, sat, warm, vig, grain, lift, flash, contrast, useDepth, cNear, cFar, focusZ, aperture, maxR; uniform vec3 tint, shadowTint, hiTint; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    float viewZ(float d){ return cNear * cFar / (cFar - d * (cFar - cNear)); }
    // Unschärfekreis in Bildpunkten: dünne Linse, relativ zur Fokusentfernung (gleicher Look bei jedem Zoom). Seit
    // 24.10.2026 (Naders Wunsch: "die Mitte soll immer scharf sein, wie beim Tilt Shift") mit einem festen scharfen Band
    // in der Bildmitte: dort keine Unschärfe, egal wie tief etwas steht (hohe Häuser, Figuren). Nach oben und unten wächst
    // die Tiefenunschärfe weich hinein, am Rand gibt es immer mindestens einen Tilt Shift Schleier.
    float coc(vec2 uv){
      float z = viewZ(texture2D(tDepth, uv).x), dy = abs(uv.y - focus);
      float c = clamp(aperture * abs(z - focusZ) / z, 0.0, 1.0) * smoothstep(0.1, 0.34, dy);
      return max(c, smoothstep(0.2, 0.5, dy) * 0.55 * aperture) * maxR;
    }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float b = 0.0;
      if (useDepth > 0.5) {
        float R = coc(vUv);
        if (R > 0.7) {
          // 24 Proben auf einer Spirale, jede zählt nur, wenn ihr eigener Kreis bis hierher reicht (sonst bluten scharfe
          // Kanten in die Unschärfe dahinter)
          vec4 acc = c; float tot = 1.0;
          float rot = hash(vUv * res) * 6.2832;
          for (int i = 0; i < 24; i++) {
            float a = float(i) * 2.39996 + rot; float r = sqrt((float(i) + 0.5) / 24.0) * R;
            vec2 uv = vUv + vec2(cos(a), sin(a)) * r / res;
            float w = clamp(coc(uv) - r + 1.0, 0.0, 1.0);
            acc += texture2D(tDiffuse, uv) * w; tot += w;
          }
          c = acc / tot;
        }
      } else {
      float d = abs(vUv.y - focus);
      // Nah an den Figuren: breiteres scharfes Band und weniger Unschärfe, damit niemand verschmiert
      b = smoothstep(0.16 + (1.0 - near) * 0.18, 0.55 + (1.0 - near) * 0.12, d) * blur * 3.2 * mix(0.18, 1.0, near);
      }
      if (b > 0.05) {
        vec2 px = b / res; vec4 acc = c; float tot = 1.0;
        for (int i = 0; i < 12; i++) {
          float a = float(i) * 2.39996; float r = sqrt(float(i) + 0.5) / 3.5;
          vec2 o = vec2(cos(a), sin(a)) * r * px * 2.2;
          acc += texture2D(tDiffuse, vUv + o); tot += 1.0;
        }
        c = acc / tot;
      }
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, sat);
      col.r += warm; col.b -= warm * 0.8;
      col = col * tint + lift;
      // Farbstimmung: kühle Schatten, warme Lichter, sanfter Kontrast um ein mittleres Grau (linear)
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col += shadowTint * (1.0 - smoothstep(0.0, 0.22, lum)) + hiTint * smoothstep(0.25, 0.9, lum);
      col = max(col, 0.0);
      col = mix(col, col * (1.0 + contrast * (lum - 0.18) / (lum + 0.18)), 1.0);
      vec2 q = vUv - 0.5; col *= 1.0 - dot(q, q) * vig * 1.8;
      col += (hash(vUv * res + time) - 0.5) * grain;
      col += flash;
      gl_FragColor = vec4(col, c.a);
    }`,
};

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // mit radius weicher als PCFSoft (das radius ignoriert)
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd2e6ef, 160, 520);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 2400);
  camera.position.set(0, 88, 118);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 4.5; // nah genug, um die Dorfbewohner zu sehen
  controls.maxDistance = NX > 1000 ? 1500 : 470; // weit genug, um Archipel und Festland zugleich zu sehen (Erde: halbe Welt)
  controls.maxPolarAngle = 1.2;
  controls.minPolarAngle = 0.22;
  controls.screenSpacePanning = false;
  controls.zoomSpeed = 0.9;
  controls.rotateSpeed = 0.55;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  const hemi = new THREE.HemisphereLight(0xcfe6f6, 0x857456, 0.8);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff8ee, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(3072, 3072);
  const sc = sun.shadow.camera;
  sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 5; sc.far = 400;
  sun.shadow.radius = 2.4;
  sun.shadow.intensity = 0.86;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({ ...SkyShader, uniforms: THREE.UniformsUtils.clone(SkyShader.uniforms), side: THREE.BackSide, depthWrite: false, fog: false }));
  scene.add(sky);

  // Sterne
  const starGeo = new THREE.BufferGeometry();
  const sp = [];
  for (let i = 0; i < 1400; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
    const y = Math.abs(u) * 0.95 + 0.05, r = Math.sqrt(1 - y * y);
    sp.push(Math.cos(a) * r * 850, y * 850, Math.sin(a) * r * 850);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  scene.add(stars);

  // Mond
  const moon = new THREE.Mesh(new THREE.SphereGeometry(14, 24, 16), new THREE.MeshBasicMaterial({ color: 0xf3efe2, fog: false, transparent: true }));
  scene.add(moon);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // Weiche Kontaktschatten (Ambient Occlusion) für den Puppenhaus-Look
  const gtao = new GTAOPass(scene, camera, 512, 512);
  gtao.blendIntensity = 0.92; // seit 24.10.2026 kräftiger (vorher 0,7): dunkle Kontaktschatten in jeder Ecke wie im Diorama
  gtao.updateGtaoMaterial({ radius: 0.62, distanceExponent: 1.25, thickness: 1.3, scale: 1.0, samples: 12 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  composer.addPass(gtao);
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.35, 0.6, 0.86);
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());

  grade.uniforms.tDepth.value = gtao.depthTexture;
  grade.uniforms.useDepth.value = 1;

  // Licht aus der Umgebung (seit 24.10.2026, PLAN_GRAFIK.md): ein kleiner Himmel nur für das Licht (Zenit, Horizont,
  // Boden, Sonnenhof), daraus eine vorgefilterte Umgebungskarte (PMREM). Jede Fläche bekommt Himmelslicht von oben,
  // warmes Bodenlicht von unten und weiche Spiegelungen, wie das indirekte Licht einer Spiel Engine. Neu gerechnet, wenn
  // sich Tageszeit oder Wetter sichtbar ändern (höchstens alle 0,5 s, rund 2 ms).
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envMat = new THREE.ShaderMaterial({
    uniforms: { zen: { value: C('#68ade6') }, hor: { value: C('#f0eedf') }, gnd: { value: C('#a68e6a') }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: C('#fff') }, sunI: { value: 1 } },
    side: THREE.BackSide, depthWrite: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 zen, hor, gnd, sunDir, sunCol; uniform float sunI; varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir); float h = d.y;
        vec3 sky = mix(hor, zen, smoothstep(0.0, 0.55, h));
        vec3 g = mix(hor * 0.7, gnd, smoothstep(0.0, -0.3, h));
        vec3 c = h >= 0.0 ? sky : g;
        float s = max(dot(d, normalize(sunDir)), 0.0);
        c += sunCol * (pow(s, 6.0) * 0.3 + pow(s, 48.0) * 1.1) * sunI;
        gl_FragColor = vec4(c, 1.0); }`,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), envMat));
  let envRT = null, envAt = -1e9, envSum = -1;

  const stage = { renderer, scene, camera, controls, hemi, sun, sky, stars, moon, composer, bloom, grade, gtao, quality: 'hoch', sunDir: new THREE.Vector3(0, 1, 0), envMat };
  stage.updateEnv = force => {
    const u = envMat.uniforms, now = performance.now();
    const sum = u.zen.value.r + u.zen.value.g * 3 + u.zen.value.b * 7 + u.hor.value.r * 11 + u.hor.value.g * 13 + u.hor.value.b * 17 + u.gnd.value.g * 19 + u.sunI.value * 23 + u.sunDir.value.x * 5 + u.sunDir.value.y * 29;
    if (!force && (Math.abs(sum - envSum) < 0.02 || now - envAt < 500)) return;
    envSum = sum; envAt = now;
    const rt = pmrem.fromScene(envScene, 0, 0.1, 100, { size: 128 });
    scene.environment = rt.texture;
    if (envRT) envRT.dispose();
    envRT = rt;
  };
  // Was hier drin ist, fehlt in der Umgebungsverdeckung (seit 19.10.2026): GTAO zeichnet jede Figur noch einmal mit
  // einem eigenen Material, ohne die gebackene Animation, also in der Ruhepose. Beim Geist sah man diese zweite,
  // graue Figur als "Schatten" mit anderen Armen.
  // Seit 19.10.2026 bleiben auch alle durchsichtigen Flächen draußen (Wasser, Flüsse, Straßenbänder, Lichtkegel, Wolken,
  // Partikel): GTAO zeichnete sie als feste Flächen und verdunkelte darunter, so endete jeder Fluss als dunkle Fläche im Meer.
  stage.noAO = new Set();
  gtao._overrideVisibility = () => {
    const cache = gtao._visibilityCache, noAO = stage.noAO;
    scene.traverse(o => {
      if (!o.visible) return;
      const m = o.material, tr = m && (Array.isArray(m) ? m[0] && m[0].transparent : m.transparent);
      if (o.isPoints || o.isLine || o.isLine2 || tr || noAO.has(o)) { o.visible = false; cache.push(o); }
    });
    // nur für GTAO sichtbar (seit 19.10.2026): der Geist hat dafür ein im Prozessor mitbewegtes Abbild in echter Pose,
    // sonst legte GTAO die Schattierung des Hintergrunds auf ihn und er wirkte durchsichtig
    for (const o of stage.aoOnly) if (o.userData.aoOn) o.visible = true;
  };
  stage.aoOnly = new Set();
  const restoreAO = gtao._restoreVisibility.bind(gtao);
  gtao._restoreVisibility = () => { restoreAO(); for (const o of stage.aoOnly) o.visible = false; };

  stage.resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio();
    grade.uniforms.res.value.set(w * pr, h * pr);
    grade.uniforms.maxR.value = 13 * h * pr / 1000; // größter Unschärfekreis, gleich groß auf jeder Auflösung
  };
  window.addEventListener('resize', stage.resize);
  stage.resize();

  // Lichtmischung (seit 24.10.2026, PLAN_GRAFIK.md): Anteil Umgebungskarte, Rest Halbkugel, Sonne, Schattentiefe, Belichtung
  const T = stage.tune = { env: 0.36, hemi: 0.2, sun: 1.15, shadow: 0.95, exp: 0.94 };
  const tmp = new THREE.Vector3();
  // Licht und Himmel für Tageszeit f (0..1) und Wetter
  stage.setTime = (f, wx) => {
    const d = sampleDay(f);
    const gloom = wx.gloom || 0;
    const grey = C('#8f9aa3');
    const angle = (f - 0.25) * Math.PI * 2;
    const elev = Math.sin(angle);
    const dayLight = THREE.MathUtils.smoothstep(elev, -0.12, 0.25);
    // Sonnenweg (seit 24.10.2026, PLAN_GRAFIK.md): mittags von hinten links und nicht mehr steil aus Richtung Kamera
    // (vorher z 45, Höhe 110: die Schatten fielen hinter die Häuser, alles wirkte flach). So fallen die Schatten zur
    // Kamera hin und zur Seite, wie im Licht eines Dioramas, die Sonne steht mittags rund 50 Grad hoch.
    tmp.set(Math.cos(angle) * 80 - 18, Math.max(elev, 0.12) * 66, -46);
    const isDay = elev > -0.06;
    if (!isDay) tmp.set(-Math.cos(angle) * 80, Math.max(-elev, 0.15) * 100, -30);
    stage.sunDir.copy(tmp).normalize();
    sun.color.copy(d.sun).lerp(grey, gloom * 0.7);
    sun.intensity = d.si * (1 - gloom * 0.6) * T.sun;
    hemi.color.copy(d.sky).lerp(grey, gloom * 0.6);
    // Schnee wirft kühles Himmelslicht zurück statt warmem Erdbraun (sonst werden Kronen und Dächer unten rosa)
    hemi.groundColor.copy(d.gnd).lerp(d.sky, Math.min(1, U.uSnow.value) * 0.8);
    // seit 24.10.2026 kommt das meiste Himmelslicht aus der Umgebungskarte (updateEnv), die Halbkugel bleibt als Rest
    hemi.intensity = d.hi * (1 + gloom * 0.15) * (scene.environment ? T.hemi : 1);
    {
      const u = envMat.uniforms;
      u.zen.value.copy(d.zen).lerp(C('#8f9aa3'), gloom * 0.7);
      u.hor.value.copy(d.sky).lerp(d.hor, 0.35).lerp(C('#a9b2b8'), gloom * 0.6);
      u.gnd.value.copy(d.gnd).lerp(d.sky, Math.min(1, U.uSnow.value) * 0.8);
      u.sunDir.value.copy(stage.sunDir);
      u.sunCol.value.copy(d.sun);
      u.sunI.value = dayLight * (1 - gloom * 0.85);
      scene.environmentIntensity = T.env * d.hi * (1 + gloom * 0.25);
      stage.updateEnv();
    }
    grade.uniforms.cNear.value = camera.near; grade.uniforms.cFar.value = camera.far;
    const zen = d.zen.clone().lerp(C('#6d7884'), gloom * 0.75);
    const hor = d.hor.clone().lerp(C('#a9b2b8'), gloom * 0.7);
    if (wx.fog) { hor.lerp(C('#dfe6ea'), wx.fog * 0.8 * dayLight + 0.2 * wx.fog); zen.lerp(C('#cdd6db'), wx.fog * 0.7 * dayLight); }
    sky.material.uniforms.zen.value.copy(zen);
    sky.material.uniforms.hor.value.copy(hor);
    sky.material.uniforms.sunDir.value.copy(isDay ? stage.sunDir : tmp.set(0, -1, 0)).normalize();
    sky.material.uniforms.sunCol.value.copy(d.sun);
    sky.material.uniforms.glow.value = (1 - gloom) * dayLight;
    sky.material.uniforms.night.value = 1 - dayLight;
    sky.material.uniforms.gloom.value = gloom;
    sky.material.uniforms.cirrus.value = THREE.MathUtils.clamp(0.25 + (wx.clouds ?? 0.3) * 0.6 - (wx.storm || 0) * 0.5, 0, 0.85);
    sky.material.uniforms.time.value = performance.now() / 1000;
    const fogCol = d.fog.clone().lerp(C('#9aa4ab'), gloom * 0.5);
    if (wx.fog) fogCol.lerp(C('#e4eaed').multiplyScalar(0.3 + dayLight * 0.7), wx.fog);
    // Nebel wächst mit dem Kameraabstand mit: nah klare Luft, weit ein leichter blauer Dunst statt grauer Suppe
    const camD = camera.position.distanceTo(controls.target);
    grade.uniforms.near.value = THREE.MathUtils.smoothstep(camD, 5, 22);
    const nearB = 110 + camD * 0.85, farB = 470 + camD * 1.7;
    // in der Ferne genau die Himmelsfarbe am Horizont (wie im Himmels-Shader), sonst bleibt dort eine harte Kante zwischen Meer und Himmel
    const skyH = hor.clone().lerp(zen, 0.1).lerp(hor.clone().lerp(d.sun, 0.25).multiplyScalar(1.06), 0.29 * (1 - (1 - dayLight) * 0.8));
    if (!wx.fog) fogCol.lerp(skyH, 0.75 * dayLight + 0.4 * (1 - dayLight));
    scene.fog.color.copy(fogCol);
    scene.fog.near = wx.fog ? 25 + (1 - wx.fog) * 120 : nearB - gloom * 50;
    scene.fog.far = wx.fog ? 120 + (1 - wx.fog) * 300 : farB - gloom * 160;
    renderer.toneMappingExposure = d.exp * T.exp;
    stars.material.opacity = (1 - dayLight) * (1 - gloom) * 0.9;
    stars.rotation.y = f * Math.PI * 2 * 0.2;
    const ma = angle + Math.PI;
    moon.position.set(Math.cos(ma) * 600, Math.sin(ma) * 520, -260);
    moon.material.opacity = (1 - dayLight) * (1 - gloom * 0.8);
    moon.visible = Math.sin(ma) > -0.05;
    const g = grade.uniforms;
    g.sat.value = 0.98 - gloom * 0.32 + (wx.sunny ? 0.04 : 0);
    g.warm.value = 0.008 + (wx.sunny ? 0.01 : 0) - gloom * 0.02 + (1 - dayLight) * -0.025;
    g.lift.value = wx.fog ? wx.fog * 0.05 : 0;
    const nightK = 1 - dayLight;
    g.tint.value.setRGB(1 - nightK * 0.06, 1 - nightK * 0.02, 1 + nightK * 0.08);
    g.shadowTint.value.set(-0.004 + nightK * 0.002, 0.002 + nightK * 0.006, 0.010 + nightK * 0.016);
    g.hiTint.value.set(0.018 * dayLight, 0.010 * dayLight, -0.006 * dayLight);
    g.contrast.value = 0.1 * (1 - gloom * 0.6);
    sun.shadow.intensity = T.shadow - nightK * 0.3;
    bloomFor(dayLight);
    return { dayLight, elev };
  };

  function bloomFor(dayLight) {
    stage.bloom.strength = 0.22 + (1 - dayLight) * 0.6;
    stage.bloom.threshold = 0.8 - (1 - dayLight) * 0.3;
  }

  // Schatten folgen dem Blick: nah scharf, fern weit
  stage.followShadow = (target, dist, max = 95) => {
    const size = THREE.MathUtils.clamp(dist * 0.85, 12, max); // max größer im Flug (render/flight.js)
    if (Math.abs(sc.right - size) > 0.5) { sc.left = -size; sc.right = size; sc.top = size; sc.bottom = -size; sc.updateProjectionMatrix(); }
    sun.target.position.copy(target);
    sun.position.copy(target).addScaledVector(stage.sunDir, 160);
  };

  stage.setQuality = q => {
    stage.quality = q;
    renderer.setPixelRatio(q === 'hoch' ? Math.min(window.devicePixelRatio, 1.5) : q === 'mittel' ? Math.min(window.devicePixelRatio, stage.prMid || 1) : 1);
    renderer.shadowMap.enabled = q !== 'niedrig';
    stage.bloom.enabled = q !== 'niedrig';
    stage.gtao.enabled = q === 'hoch';
    // Schärfentiefe braucht die Tiefe aus dem GTAO Durchgang, ohne ihn gibt es das alte Band (Tilt Shift)
    stage.grade.uniforms.useDepth.value = q === 'hoch' ? 1 : 0;
    // feinere Schatten auf hoch (seit 24.10.2026)
    const ms = q === 'hoch' ? 3072 : 2048;
    if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    stage.resize();
  };

  return stage;
}
