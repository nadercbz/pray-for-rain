// Gemeinsame Shader-Zusätze für den gemalten Look: Wind, Blätterrauschen, Schnee auf allem, was nach oben zeigt.
import * as THREE from 'three';
import { NX, NY } from '../sim/world.js';

// Klimakarte (terrain.js baut sie): R Winterschnee je Ort (0,5 = wie bisher), G Schnee, der immer liegt. Vorgabe: wie bisher
const climDefault = new THREE.DataTexture(new Uint8Array([128, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
climDefault.needsUpdate = true;

export const U = {
  uTime: { value: 0 },
  uSnow: { value: 0 },
  uClimate: { value: climDefault },
  uWind: { value: 1 },
  uViewUp: { value: new THREE.Vector3(0, 1, 0) },
};

const NOISE = `
float bh3(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float vn3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(bh3(i), bh3(i + vec3(1,0,0)), f.x), mix(bh3(i + vec3(0,1,0)), bh3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(bh3(i + vec3(0,0,1)), bh3(i + vec3(1,0,1)), f.x), mix(bh3(i + vec3(0,1,1)), bh3(i + vec3(1,1,1)), f.x), f.y), f.z); }
`;

// opt: sway (Windstärke je Höhe), leaf (Blätterrauschen), grain (Putz/Erde Rauschen), snow (Schnee Faktor), upN (Normale nach oben, 0..1),
// cap (Baumkronen: scharfe Schneehaube statt Schleier, uSnow bestimmt, wie weit sie herunterreicht)
export function patch(mat, opt = {}) {
  const key = JSON.stringify(opt);
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'uniform float uTime; uniform float uWind; uniform vec3 uViewUp; varying vec3 vWPos; varying float vUp;\n' + sh.vertexShader;
    if (opt.sway) {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec3 ip = vec3(0.);
          #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
          #endif
          float k = max(0., position.y) * ${opt.sway.toFixed(3)} * uWind;
          transformed.x += sin(uTime * 1.6 + ip.x * 0.35 + ip.z * 0.21) * k;
          transformed.z += cos(uTime * 1.3 + ip.x * 0.17 + ip.z * 0.33) * k * 0.6; }`);
    }
    sh.vertexShader = sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      { vec4 wp4 = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        wp4 = instanceMatrix * wp4;
        #endif
        vWPos = (modelMatrix * wp4).xyz; }
      vUp = dot(normalize(transformedNormal), uViewUp);`);
    sh.fragmentShader = 'uniform float uSnow; uniform float uTime; uniform sampler2D uClimate; varying vec3 vWPos; varying float vUp;\n' + (opt.upN ? 'uniform vec3 uViewUp;\n' : '') + NOISE + sh.fragmentShader;
    // Schnee nach Klima: in der Wüste nie, im Norden mehr, auf Gletschern immer (seit 18.10.2026)
    const SN = `vec4 clim = texture2D(uClimate, (vWPos.xz + vec2(${(NX / 2).toFixed(1)}, ${(NY / 2).toFixed(1)})) / vec2(${NX.toFixed(1)}, ${NY.toFixed(1)})); float SNOW = clamp(uSnow * clim.r * 2.0 + clim.g, 0.0, 1.0);`;
    // Gras: Halme werden wie der Boden darunter beleuchtet, auch von hinten (sonst kippen sie ins Schwarze)
    if (opt.upN) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      normal = normalize(mix(normal * faceDirection, uViewUp, ${opt.upN.toFixed(2)})); nonPerturbedNormal = normal;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      ${opt.leaf || opt.cap || opt.snow ? SN : ''}
      ${opt.leaf ? 'float ln = vn3(vWPos * 6.5) * 0.6 + vn3(vWPos * 14.0) * 0.4; diffuseColor.rgb *= 0.97 + (ln - 0.5) * mix(0.46, 0.18, min(1.0, SNOW * 2.2));' : ''}
      ${opt.grain ? `float gn = vn3(vWPos * ${opt.grain.toFixed(2)}); diffuseColor.rgb *= 0.93 + gn * 0.14;` : ''}
      ${opt.cap ? `{ float cn = vn3(vWPos * 3.1) * 0.65 + vn3(vWPos * 7.3) * 0.35 - 0.5;
        float edge = 1.02 - SNOW * 1.15;
        float sn = smoothstep(edge - 0.05, edge + 0.07, vUp + cn * 0.3) * smoothstep(0.02, 0.15, SNOW);
        vec3 sc = mix(vec3(0.80, 0.86, 0.95), vec3(0.97, 0.975, 0.99), smoothstep(edge, edge + 0.45, vUp));
        diffuseColor.rgb = mix(diffuseColor.rgb, sc, sn); }`
      : opt.snow ? `{ float sn = ${NX > 1000 ? 'max(smoothstep(0.3, 0.75, vUp), smoothstep(0.15, 0.6, clim.g) * smoothstep(-0.45, 0.1, vUp + (vn3(vWPos * 0.7) - 0.5) * 0.5))' : 'smoothstep(0.3, 0.75, vUp)'} * min(1.0, SNOW * ${opt.snow.toFixed(2)} * ${NX > 1000 ? '1.25' : '1.0'}); // Erde: ewiger Schnee auch an steilen Flanken, fleckig
        float ice = clim.g * (0.5 + vn3(vWPos * 0.9) * 0.5); // Gletscher: bläulich, mit Schlieren
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.96, 0.965, 0.98), vec3(0.78, 0.87, 0.95), ice * 0.7), sn); }` : ''}`);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}
