// Stilisiertes Meer: Tiefenfarbe, Schaumlinien an der Küste, Glanzlichter, Sturmwellen.
// Von weitem: Verlauf vom Schelf ins offene Meer (Kanal B der Küstenkarte), ziehende Windfelder, Sonnenschimmer mit Glitzern.
import * as THREE from 'three';
import { NX, NY } from './scene.js';
import { groundY } from './terrain.js';

// Feinheit der Küstenkarte pro Kachel: Inselwelten 4, die Erde (2048 x 1024) 1, sonst wäre die Karte 134 MB groß
const RES = NX > 1000 ? 1 : 4;
const FAR = 48; // ab so vielen Kacheln vom Land ist das Meer ganz offen (dunkelstes Blau)
const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export class Water {
  constructor(scene) {
    this.scene = scene;
    this.tex = null;
    this.uniforms = {
      time: { value: 0 }, shore: { value: null }, storm: { value: 0 }, dayLight: { value: 1 },
      deepCol: { value: new THREE.Color('#25738b') }, shallowCol: { value: new THREE.Color('#6dd0c3') }, abyssCol: { value: new THREE.Color('#1a5a7c') },
      foamCol: { value: new THREE.Color('#f4f7f2') }, skyCol: { value: new THREE.Color('#cfe6f6') },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color('#fff') },
      fogColor: { value: new THREE.Color() }, fogNear: { value: 100 }, fogFar: { value: 400 },
      fish: { value: new THREE.Vector4(0, 0, 0, 0) }, rise: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      vertexShader: `
        uniform float time, storm, rise; varying vec3 vW; varying float vWave;
        void main(){
          vec3 p = position;
          vec4 w = modelMatrix * vec4(p, 1.0);
          float wave = sin(w.x * 0.35 + time * 1.1) * cos(w.z * 0.29 + time * 0.8) * (0.035 + storm * 0.22);
          wave *= 1.0 - smoothstep(1.2, 2.5, length(modelMatrix[0].xyz)); // im Flug ist das Netz groß gezogen: grobe Wellen würden Dreiecke zeigen
          w.y += wave + rise;
          vWave = wave; vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform float time, storm, dayLight, fogNear, fogFar; uniform sampler2D shore;
        uniform vec3 deepCol, shallowCol, abyssCol, foamCol, skyCol, sunDir, sunCol, fogColor; uniform vec4 fish;
        varying vec3 vW; varying float vWave;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5); }
        float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec2 uv = (vW.xz + vec2(${(NX / 2).toFixed(1)}, ${(NY / 2).toFixed(1)})) / vec2(${NX.toFixed(1)}, ${NY.toFixed(1)});
          float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
          vec4 s = texture2D(shore, clamp(uv, 0.0, 1.0));
          float nearC = s.r * inside;
          float depth = mix(1.0, s.g, inside);
          // Abstand zum Land über große Strecken; außerhalb der Karte läuft er einfach weiter
          vec2 ov = max(-uv, uv - 1.0);
          float farD = s.b + max(0.0, max(ov.x * ${(NX / FAR).toFixed(3)}, ov.y * ${(NY / FAR).toFixed(3)}));
          vec2 p = vW.xz;
          float t = time;
          float deepK = smoothstep(0.55, 0.95, depth);
          float pxw = length(fwidth(p));
          // Windfelder: gestreckte, aufgeraute Bahnen ziehen langsam über das offene Meer und glänzen heller
          vec2 wq = mat2(0.84, -0.54, 0.54, 0.84) * p;
          float wind = n2(wq * vec2(0.016, 0.052) + vec2(t * 0.012, t * 0.004)) * 0.65 + n2(wq * vec2(0.035, 0.11) - vec2(t * 0.02, 0.0)) * 0.35;
          float gust = smoothstep(0.5, 0.82, wind) * deepK * (1.0 - storm);
          float a = n2(p * 0.35 + vec2(t * 0.12, t * 0.08)) - 0.5;
          float b = n2(p * 0.9 - vec2(t * 0.2, -t * 0.15)) - 0.5;
          float rough = 0.12 + storm * 0.6 + gust * 0.1;
          // aus großer Höhe (Flugzeug) ist ein Bildpunkt mehrere Felder groß: feines Rauschen ausblenden, sonst flimmern Blöcke
          float lodK = 1.0 - smoothstep(0.35, 2.2, pxw);
          a *= lodK; b *= lodK;
          vec3 n = normalize(vec3(a * rough + b * 0.05, 1.0, b * rough - a * 0.05));
          vec3 col = mix(shallowCol, deepCol, smoothstep(0.05, 0.85, depth));
          // vom Schelf ins offene Meer: tiefer und blauer, der Übergang folgt sanften Bänken und Rinnen am Grund
          // (Grundrauschen ist in Kanal A gebacken, außerhalb der Karte läuft es neutral aus)
          float bed = mix(s.a, 0.5, smoothstep(0.0, 0.06, max(ov.x, ov.y)));
          float abyss = smoothstep(0.06, 0.8, farD + (bed - 0.5) * 0.3);
          col = mix(col, abyssCol, abyss * deepK * 0.85);
          col = mix(col, mix(deepCol, shallowCol, 0.22), smoothstep(0.3, 0.12, bed) * deepK * (1.0 - abyss) * 0.35);
          float big = n2(p * 0.06 + vec2(t * 0.01, 0.0));
          col *= 0.92 + big * 0.16;
          col = mix(col, col * vec3(1.08, 1.13, 1.15) + vec3(0.0, 0.018, 0.028), gust * 0.6);
          col = mix(col, col * 0.75 + vec3(0.02, 0.04, 0.05), storm * 0.6);
          // gemalte Wellenstriche
          // (teure Rauschen nur, wo ihr Faktor nicht ohnehin 0 ist: gleiches Bild, weniger Arbeit auf dem offenen Meer)
          if (depth > 0.3) {
            float stroke = smoothstep(0.992, 1.0, sin(p.x * 0.7 + p.y * 0.25 + n2(p * 0.3 + t * 0.05) * 6.0 + t * 0.6)) * smoothstep(0.3, 0.9, depth) * smoothstep(0.55, 0.8, n2(p * 0.08 + t * 0.02)) * smoothstep(0.5, 0.75, n2(p * 0.9 + t * 0.08));
            col += vec3(0.12, 0.16, 0.16) * stroke * (0.26 + storm) * lodK;
          }
          // Lichtnetz im Flachwasser (Kaustik), tanzt langsam
          float shallowK = (1.0 - smoothstep(0.08, 0.5, depth)) * inside;
          float caAA = 1.0 - smoothstep(0.06, 0.16, pxw);
          if (shallowK * caAA > 0.0) {
            float ca = abs(n2(p * 2.2 + vec2(t * 0.35, t * 0.2)) - n2(p * 2.6 - vec2(t * 0.25, -t * 0.3)));
            col += vec3(0.16, 0.2, 0.17) * pow(1.0 - min(1.0, ca * 3.0), 6.0) * shallowK * dayLight * caAA;
          }
          // Schaum: dünne Brandungslinie direkt am Ufer, dazu zarte Wellen, die zum Strand laufen und zerfallen
          float foam = 0.0;
          if (nearC > 0.55) {
            float lap = 0.9 + 0.035 * sin(t * 1.3 + n2(p * 0.7) * 6.0);
            foam = smoothstep(lap, lap + 0.035, nearC) * 0.95;
            float band = sin(nearC * 22.0 - t * 1.6 + n2(p * 0.45) * 4.0);
            float brk = smoothstep(0.42, 0.62, n2(p * 0.8 + vec2(t * 0.05, 0.0)));
            foam += smoothstep(0.82, 0.97, band) * smoothstep(0.55, 0.92, nearC) * (1.0 - smoothstep(0.92, 0.97, nearC)) * brk * 0.42;
          }
          if (storm > 0.5) {
            vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * p;
            float wn = n2(q * 0.9 + t * 0.7) * 0.6 + n2(q * 2.3 - t) * 0.4;
            foam += smoothstep(0.5, 1.0, storm) * smoothstep(0.66, 0.85, wn) * 0.45;
          }
          vec3 v = normalize(cameraPosition - vW);
          vec3 h = normalize(normalize(sunDir) + v);
          float spec = pow(max(dot(n, h), 0.0), 140.0) * dayLight;
          float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
          col = mix(col, mix(skyCol, deepCol, 0.4), fres * 0.5);
          // flacher Blick (zum Horizont hin) spiegelt mehr Himmel: sanfter Verlauf von nah satt zu fern licht
          col = mix(col, mix(deepCol, skyCol, 0.4), smoothstep(0.35, 0.9, 1.0 - v.y) * 0.16 * deepK);
          col += sunCol * spec * 0.5;
          // breiter Sonnenschimmer auf dem offenen Meer, darin Glitzerpunkte, die kurz aufblitzen (fern ausgeblendet gegen Flimmern)
          float hu = max(dot(normalize(mix(n, vec3(0.0, 1.0, 0.0), 0.6)), h), 0.0);
          float sheen = pow(hu, 22.0) * dayLight * (1.0 - storm * 0.7);
          col += sunCol * sheen * (0.18 + gust * 0.16) * (0.4 + deepK * 0.6);
          vec2 gq = p * 3.2, gi = floor(gq);
          float gAA = 1.0 - smoothstep(0.3, 0.6, pxw * 3.2);
          float blink = h21(gi + floor(t * 1.6 + h21(gi + 7.1) * 9.0));
          float dot2 = smoothstep(0.2, 0.06, length(fract(gq) - 0.5));
          float glit = step(0.965, blink) * dot2 * smoothstep(0.5, 0.9, pow(hu, 10.0)) * gAA;
          col += sunCol * glit * 0.7 * dayLight * deepK;
          // Fischschwarm
          if (fish.w > 0.0) {
            float d = length(p - fish.xy);
            float ring = smoothstep(fish.z, 0.0, d);
            float sparkle = step(0.93, n2(p * 6.0 + vec2(t * 2.0, -t * 1.3)));
            col += vec3(0.75, 0.85, 0.9) * sparkle * ring * fish.w;
          }
          col = mix(col, foamCol, clamp(foam, 0.0, 1.0) * 0.85);
          col *= mix(0.3, 1.0, dayLight);
          float alpha = mix(0.58, 0.95, smoothstep(0.0, 0.5, depth)); // seit 19.10.2026 etwas deckender: der Meeresboden schimmert nur im ganz Flachen durch
          alpha = max(alpha, foam * 0.9);
          float fd = length(cameraPosition - vW);
          ${NX > 1000 ? `// Erde: Meereis an den Polen (Arktis ab rund 78 Grad, um die Antarktis ab rund 65 Grad), mit Rissen
          float lat = 90.0 - (vW.z + ${(NY / 2).toFixed(1)}) / ${NY.toFixed(1)} * 180.0;
          float ice = smoothstep(76.5, 80.0, lat) + smoothstep(-63.0, -67.0, lat);
          if (ice > 0.0) { float cr = n2(vW.xz * 0.9) * 0.6 + n2(vW.xz * 3.1) * 0.4; vec3 iceC = mix(vec3(0.86, 0.92, 0.95), vec3(0.97, 0.99, 1.0), cr); iceC *= 0.75 + 0.25 * dayLight; col = mix(col, iceC, clamp(ice * (0.75 + cr * 0.5), 0.0, 1.0)); alpha = mix(alpha, 1.0, clamp(ice, 0.0, 1.0)); }` : ''}
          col = mix(col, fogColor, smoothstep(fogNear, fogFar, fd));
          gl_FragColor = vec4(col, alpha);
        }`,
    });
    const SZ = Math.max(1600, Math.max(NX, NY) * 1.6); // die Erde ist 2048 breit
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(SZ, SZ, 160, 160).rotateX(-Math.PI / 2), mat);
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(SZ, SZ).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x155166 }));
    floor.position.y = -1.15;
    scene.add(floor);
    this.floor = floor;
  }

  // Abstand zum Land in feiner Auflösung, für Schaum und Tiefe
  build(st) {
    const M = NX * RES, MY = NY * RES, H = st.tiles.h;
    const land = new Uint8Array(M * MY), dist = new Float32Array(M * MY).fill(1e9);
    // Land, wo das weiche Gelände über dem Wasser liegt: runde Küsten statt Treppen
    for (let y = 0; y < MY; y++) for (let x = 0; x < M; x++) {
      const gy = groundY((x + 0.5) / RES - NX / 2, (y + 0.5) / RES - NY / 2);
      if (gy > 0.02) { land[y * M + x] = 1; dist[y * M + x] = 0; }
    }
    // Zweiphasige Distanz (Chamfer)
    for (let pass = 0; pass < 2; pass++) {
      const ys = pass ? [MY - 1, -1, -1] : [0, MY, 1];
      for (let y = ys[0]; y !== ys[1]; y += ys[2]) {
        const xs = pass ? [M - 1, -1, -1] : [0, M, 1];
        for (let x = xs[0]; x !== xs[1]; x += xs[2]) {
          const i = y * M + x;
          if (land[i]) continue;
          let d = dist[i];
          const nb = pass ? [[1, 0, 1], [0, 1, 1], [1, 1, 1.414], [-1, 1, 1.414]] : [[-1, 0, 1], [0, -1, 1], [-1, -1, 1.414], [1, -1, 1.414]];
          for (const [dx, dy, c] of nb) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= M || yy >= MY) continue;
            d = Math.min(d, dist[yy * M + xx] + c);
          }
          dist[i] = d;
        }
      }
    }
    const data = new Uint8Array(M * MY * 4);
    for (let y = 0; y < MY; y++) for (let x = 0; x < M; x++) {
      const i = y * M + x;
      const dTiles = dist[i] / RES;
      const nearC = land[i] ? 1 : Math.max(0, 1 - dTiles / 5);
      // Tiefe aus dem weichen Meeresboden, nicht aus den Kacheln: keine Treppen im Flachwasser
      const gy = groundY((x + 0.5) / RES - NX / 2, (y + 0.5) / RES - NY / 2);
      const depth = land[i] ? 0 : Math.min(1, 0.08 + Math.max(0, -gy) * 0.5 + dTiles / 14);
      // B: Weg ins offene Meer, A: sanfte Bänke und Rinnen am Grund (fest, zieht nicht mit)
      const X = (x + 0.5) / RES - NX / 2, Z = (y + 0.5) / RES - NY / 2;
      const bed = vnoise(X * 0.021 + 3.7, Z * 0.021 + 1.3) * 0.62 + vnoise(X * 0.047 + 9.1, Z * 0.047 + 4.4) * 0.38;
      data[i * 4] = nearC * 255; data[i * 4 + 1] = depth * 255; data[i * 4 + 2] = Math.min(1, dTiles / FAR) * 255; data[i * 4 + 3] = bed * 255;
    }
    this.land = land; this.dist = dist; this.data = data; // für patch (Baukasten)
    if (this.tex) this.tex.dispose();
    this.tex = new THREE.DataTexture(data, M, MY, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter; this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    this.uniforms.shore.value = this.tex;
  }

  // Teil-Neuaufbau (seit 20.10.2026, Baukasten): Land und Abstand nur im Kasten plus 52 Felder Rand neu (der Weg ins
  // offene Meer reicht 48 Felder), der Rand der Region behält seine alten Abstände. Rund 15 statt 290 ms.
  patch(st, box, margin = 52) {
    const M = NX * RES, MY = NY * RES;
    if (!this.dist || this.dist.length !== M * MY) { this.build(st); return; }
    const m = margin * RES, land = this.land, dist = this.dist, data = this.data;
    const X0 = Math.max(0, box[0] * RES - m), X1 = Math.min(M - 1, (box[1] + 1) * RES + m), Y0 = Math.max(0, box[2] * RES - m), Y1 = Math.min(MY - 1, (box[3] + 1) * RES + m);
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
      const i = y * M + x, gy = groundY((x + 0.5) / RES - NX / 2, (y + 0.5) / RES - NY / 2);
      land[i] = gy > 0.02 ? 1 : 0;
      const edge = x === X0 || x === X1 || y === Y0 || y === Y1;
      if (land[i]) dist[i] = 0; else if (!edge || dist[i] === 0) dist[i] = 1e9;
    }
    for (let pass = 0; pass < 2; pass++) {
      const nb = pass ? [[1, 0, 1], [0, 1, 1], [1, 1, 1.414], [-1, 1, 1.414]] : [[-1, 0, 1], [0, -1, 1], [-1, -1, 1.414], [1, -1, 1.414]];
      for (let y = pass ? Y1 : Y0; pass ? y >= Y0 : y <= Y1; y += pass ? -1 : 1) for (let x = pass ? X1 : X0; pass ? x >= X0 : x <= X1; x += pass ? -1 : 1) {
        const i = y * M + x;
        if (land[i]) continue;
        let d = dist[i];
        for (const [dx, dy, c] of nb) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= M || yy >= MY) continue; d = Math.min(d, dist[yy * M + xx] + c); }
        dist[i] = d;
      }
    }
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
      const i = y * M + x, dTiles = dist[i] / RES;
      const nearC = land[i] ? 1 : Math.max(0, 1 - dTiles / 5);
      const gy = groundY((x + 0.5) / RES - NX / 2, (y + 0.5) / RES - NY / 2);
      const depth = land[i] ? 0 : Math.min(1, 0.08 + Math.max(0, -gy) * 0.5 + dTiles / 14);
      data[i * 4] = nearC * 255; data[i * 4 + 1] = depth * 255; data[i * 4 + 2] = Math.min(1, dTiles / FAR) * 255;
    }
    this.tex.needsUpdate = true;
  }

  update(time, stage, wx) {
    const u = this.uniforms;
    u.time.value = time;
    u.storm.value += ((wx.storm || 0) - u.storm.value) * 0.02;
    u.sunDir.value.copy(stage.sunDir);
    u.sunCol.value.copy(stage.sun.color);
    u.skyCol.value.copy(stage.sky.material.uniforms.hor.value);
    u.fogColor.value.copy(stage.scene.fog.color);
    u.fogNear.value = stage.scene.fog.near;
    u.fogFar.value = stage.scene.fog.far;
  }
}
