// Materialien der Stadtansicht (seit 26.10.2026): Fassaden mit Fensterreihen aus dem Shader (Wohnhaus, Glas und Büro,
// Halle, Sockel), nachts zufällig erleuchtete Fenster, Straßen mit Asphalt, Markierungen, Gehwegplatten, Gleisen,
// Grünflächen, Wasser mit leichtem Wellenspiel. Keine Texturen, alles aus Weltposition und Vertexmerkmalen.
import * as THREE from 'three';

export const CU = { uNight: { value: 0 }, uTime: { value: 0 }, uLit: { value: 0.5 }, uNear: { value: new THREE.Vector4(1e9, 1e9, -1e9, -1e9) }, uGrd: { value: new THREE.Vector2() } };
// Fernsicht (Stufe 13): was im Bereich der nahen Kacheln liegt, zeichnen die nahen Kacheln (uNear = x0, z0, x1, z1)
const FAR = sh => { sh.uniforms.uNear = CU.uNear; sh.fragmentShader = 'uniform vec4 uNear;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n  if (vWP.x > uNear.x && vWP.x < uNear.z && vWP.z > uNear.y && vWP.z < uNear.w) discard;'); };

const HASH = `
float ch(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float cn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  float a = ch(vec3(i, 0.)), b = ch(vec3(i + vec2(1., 0.), 0.)), c = ch(vec3(i + vec2(0., 1.), 0.)), d = ch(vec3(i + vec2(1., 1.), 0.));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
`;
// Muster für den Boden der ganzen Erde (seit 27.10.2026): Koordinate in Metern = (Weltposition + uGrd) * 10, uGrd führt
// earthview beim Wandern des Ursprungs mit (Rest durch 1024 m). Alles hier wiederholt sich genau alle 1024 m, darum
// springt nichts, wenn der Ursprung wandert. f: Zellen je Meter, 1024 * f muss ganzzahlig sein.
export const PN = `
float ph(vec2 i, float N){ i = mod(i, N); return fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453); }
float pn(vec2 p, float f){ float N = 1024.0 * f; vec2 q = p * f, i = floor(q), r = fract(q); r = r * r * (3. - 2. * r);
  return mix(mix(ph(i, N), ph(i + vec2(1., 0.), N), r.x), mix(ph(i + vec2(0., 1.), N), ph(i + vec2(1., 1.), N), r.x), r.y); }
`;

// Gebäude. aB: x Samen, y Höhe oben, z Sockel, w Art (0 Wohnhaus, 1 Glas, 2 Halle, 3 Sockel oder Aufbau).
// aW (seit 27.10.2026): Stelle entlang der Wand und Wandlänge in Dezimetern. Fassaden wie die Häuser der Inselwelt:
// Fenster mit Rahmen, Sprossen, Bank und Sturz, Fensterläden, Balkone, Läden mit Markisen im Erdgeschoss, Sockel,
// Eckquader, Gesimse, Dachziegel, Bürofassaden mit Bändern, Hallen mit Wellblech und Toren. Gerechnet in Kachelkoordinaten
// (vLP), damit nichts springt, wenn der Ursprung der Erde wandert.
export function buildingMat(far = false) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.0 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, CU);
    sh.vertexShader = 'attribute vec4 aB; attribute vec2 aW; varying vec4 vB; varying vec2 vW; varying vec3 vWP; varying vec3 vLP; varying vec3 vLN;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vB = vec4(aB.x / 65535.0, aB.y / 100.0, aB.z / 100.0, aB.w); vW = aW / 10.0; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vLP = transformed; vLN = objectNormal;`);
    sh.fragmentShader = 'uniform float uNight, uTime, uLit; varying vec4 vB; varying vec2 vW; varying vec3 vWP; varying vec3 vLP; varying vec3 vLN;\n' + HASH + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
      float WIN = 0.0, LIT = 0.0, GLS = 0.0, MET = 0.0;
      {
        float kind = vB.w, seed = vB.x;
        float hgt = (vB.y - vB.z) * 10.0, v = (vLP.y - vB.z) * 10.0;
        vec3 base = diffuseColor.rgb, c = base;
        float L = vW.y, uw = vW.x;
        float px = length(fwidth(vLP)) * 10.0, fine = 1.0 - smoothstep(0.06, 0.35, px);
        if (abs(vLN.y) < 0.4 && kind < 2.5) {
          bool glass = kind > 0.5 && kind < 1.5, hall = kind > 1.5;
          float fh = glass ? 3.8 : hall ? 6.0 : 3.05 + fract(seed * 3.7) * 0.5;
          float bw0 = glass ? 1.5 : hall ? 4.5 : 2.6 + fract(seed * 7.0) * 1.0;
          float u, bw, edge = 99.0;
          // Eckquader nur an echten Ecken: kurze Wandstücke sind meist Rundungen (Erker, Kurven)
          if (L > 0.8) { float nb = max(1.0, floor(L / bw0 + 0.5)); bw = L / nb; u = uw; edge = L > 4.0 ? min(uw, L - uw) : 99.0; }
          else { vec2 dir = normalize(vec2(-vLN.z, vLN.x) + 1e-5); u = dot(vLP.xz, dir) * 10.0 + seed * 37.0; bw = bw0; }
          float fl = floor(v / fh), bay = floor(u / bw);
          vec2 f = vec2(fract(u / bw), fract(v / fh));
          float topOK = step(v, hgt - 0.8) * step(1.0, hgt);
          float bayR = ch(vec3(bay, fl, seed * 113.0));
          if (glass) {
            // Glasfassade: Pfosten je Feld, dunkle Brüstungsbänder an den Decken, alle paar Felder eine Lisene
            float mull = step(0.035, f.x) * step(f.x, 0.965);
            float spand = step(0.16, f.y) * step(f.y, 0.97);
            WIN = mull * spand * topOK;
            float fin = step(mod(bay, 4.0), 0.5) * (1.0 - step(0.12, f.x));
            c = mix(c * 0.78, c, spand);
            c = mix(c, c * 1.12 + 0.04, fin * 0.8);
            GLS = 1.0;
            vec3 gc = mix(vec3(0.42, 0.55, 0.66), base, 0.3) * (0.82 + 0.3 * ch(vec3(bay, fl, 7.0)));
            gc *= 0.86 + 0.14 * smoothstep(0.16, 0.6, f.y);
            c = mix(c, gc, WIN);
            MET = WIN * 0.35;
          } else if (hall) {
            // Halle: Wellblech, Fensterband oben, Rolltore unten
            float rib = 0.5 + 0.5 * sin(v * 25.13);
            c *= 0.9 + rib * 0.1 * fine;
            float band = step(0.62, f.y) * step(f.y, 0.86) * step(0.06, f.x) * step(f.x, 0.94) * step(0.5, fl + 0.6);
            WIN = band * topOK;
            float door = step(fl, 0.5) * step(0.62, ch(vec3(bay, seed * 31.0, 5.0))) * step(0.12, f.x) * step(f.x, 0.88) * step(v, 4.2);
            float slat = 0.85 + 0.15 * step(0.5, fract(v * 3.3));
            c = mix(c, mix(vec3(0.62, 0.64, 0.66), base, 0.35) * slat, door);
            c = mix(c, vec3(0.2, 0.24, 0.28), WIN);
            MET = 0.25 * (1.0 - WIN);
          } else {
            // Wohnhaus und Geschäftshaus
            float ww = 0.25 + fract(seed * 13.0) * 0.08, wb = 0.3, wt = 0.8;
            bool shopFl = fl < 0.5 && hgt > 6.0;
            float shop = shopFl ? step(0.42, ch(vec3(bay, seed * 91.0, 3.0))) : 0.0;
            float inX = step(0.5 - ww, f.x) * step(f.x, 0.5 + ww), inY = step(wb, f.y) * step(f.y, wt);
            WIN = inX * inY;
            vec3 trim = mix(base, vec3(0.97, 0.95, 0.9), 0.62);
            // Rahmen, Bank (unten breiter, mit Schatten), Sturz
            float frX = step(0.5 - ww - 0.045, f.x) * step(f.x, 0.5 + ww + 0.045);
            float frame = frX * step(wb - 0.035, f.y) * step(f.y, wt + 0.035) * (1.0 - WIN);
            float sill = step(0.5 - ww - 0.075, f.x) * step(f.x, 0.5 + ww + 0.075) * step(wb - 0.075, f.y) * step(f.y, wb - 0.02);
            float sillSh = step(0.5 - ww - 0.07, f.x) * step(f.x, 0.5 + ww + 0.07) * step(wb - 0.11, f.y) * step(f.y, wb - 0.075);
            float lint = frX * step(wt + 0.035, f.y) * step(f.y, wt + 0.09);
            // Fensterläden in manchen Häusern (Farbe je Haus)
            float shut = step(fract(seed * 29.0), 0.32) * (1.0 - shop) * step(0.5, fl + 0.6 - (shopFl ? 1.0 : 0.0));
            float sx = abs(f.x - 0.5);
            float shutA = shut * step(ww + 0.05, sx) * step(sx, ww + 0.05 + ww * 0.55) * inY;
            vec3 shC = mix(vec3(0.33, 0.5, 0.36), vec3(0.36, 0.48, 0.62), step(0.5, fract(seed * 41.0)));
            shC = mix(shC, vec3(0.55, 0.4, 0.3), step(0.8, fract(seed * 53.0)));
            shC *= 0.9 + 0.1 * step(0.5, fract(v * 9.0));
            // Balkone an manchen Wohnhäusern
            float balc = step(fract(seed * 5.1), 0.3) * step(0.5, fl) * (1.0 - shop) * step(0.5, fract(bay * 0.5 + seed * 3.0) + 0.3);
            float rail = balc * step(0.1, f.x) * step(f.x, 0.9) * step(f.y, wb + 0.02);
            float bars = step(0.72, fract(u * 9.0)) * step(f.y, wb - 0.02) + step(wb - 0.02, f.y);
            float slab = balc * step(0.08, f.x) * step(f.x, 0.92) * step(f.y, 0.035);
            c = mix(c, trim, max(frame, lint) * 0.9);
            c = mix(c, trim * 1.02, sill);
            c *= 1.0 - sillSh * 0.28;
            c = mix(c, shC, shutA);
            // Erdgeschoss: Sockel aus Stein, Läden mit großen Scheiben und gestreiften Markisen
            float plinth = step(v, 0.85) * (1.0 - shop);
            c = mix(c, base * vec3(0.78, 0.76, 0.74), plinth);
            if (shop > 0.5) {
              WIN = step(0.07, f.x) * step(f.x, 0.93) * step(0.06, f.y) * step(f.y, 0.7);
              float door = step(0.7, ch(vec3(bay, seed, 9.0))) * step(0.38, f.x) * step(f.x, 0.62) * step(f.y, 0.7);
              WIN *= 1.0 - door;
              c = mix(c, vec3(0.32, 0.24, 0.18), door);
              float aw = step(0.74, f.y) * step(f.y, 0.94);
              float ai = floor(ch(vec3(bay, seed, 4.0)) * 5.0);
              vec3 awC = ai < 1.0 ? vec3(0.72, 0.2, 0.18) : ai < 2.0 ? vec3(0.2, 0.42, 0.3) : ai < 3.0 ? vec3(0.2, 0.32, 0.55) : ai < 4.0 ? vec3(0.78, 0.46, 0.22) : vec3(0.3, 0.3, 0.32);
              float stripe = step(0.5, fract(u * 1.6));
              awC = mix(awC, vec3(0.94, 0.92, 0.86), stripe * step(ai, 3.5));
              awC *= 0.85 + 0.15 * smoothstep(0.74, 0.94, f.y);
              c = mix(c, awC, aw);
              c *= 1.0 - 0.3 * step(0.7, f.y) * step(f.y, 0.74);
            }
            WIN *= topOK;
            // Sprossen und tiefe Laibung (oben Schatten)
            float mul = (1.0 - step(0.012, abs(f.x - 0.5))) + (1.0 - step(0.015, abs(f.y - (wb + (wt - wb) * 0.62))));
            float glassShade = 0.72 + 0.28 * smoothstep(wt, wt - 0.14, f.y);
            vec3 gc = vec3(0.2, 0.26, 0.32) * (0.85 + 0.3 * bayR) * glassShade;
            gc = mix(gc, vec3(0.45, 0.55, 0.62), 0.25 * step(0.75, bayR));
            c = mix(c, gc, WIN);
            c = mix(c, trim, WIN * clamp(mul, 0.0, 1.0) * (1.0 - shop) * fine);
            c = mix(c, base * 0.6 + vec3(0.02), rail * clamp(bars, 0.0, 1.0) * 0.85);
            c = mix(c, base * 0.7, slab);
            // Eckquader an manchen Häusern
            if (edge < 0.7) {
              float row = floor(v / 0.42), qw = mod(row, 2.0) < 1.0 ? 0.62 : 0.38;
              float q = step(edge, qw) * step(fract(seed * 61.0), 0.55);
              float joint = 1.0 - step(0.06, fract(v / 0.42)) ;
              c = mix(c, mix(base, vec3(0.88, 0.86, 0.8), 0.55) * (1.0 - joint * 0.25 * fine), q);
            }
            // Gesims über jedem Geschoss, Hauptgesims oben
            c *= 1.0 - 0.07 * step(0.955, f.y) * step(0.5, fl + 0.6);
            float corn = step(hgt - 0.55, v), cornSh = step(hgt - 0.8, v) * (1.0 - corn);
            c = mix(c, trim, corn * 0.8);
            c *= 1.0 - cornSh * 0.25;
          }
          LIT = step(bayR, uLit) * WIN;
          // Kontaktschatten am Fuß der Wand
          c *= 0.8 + 0.2 * smoothstep(0.0, 3.0, v + vB.z * 10.0);
        } else if (vLN.y > 0.95) {
          // Flachdach: Kies und Bahnen, leichte Flecken
          vec2 rp = vLP.xz * 10.0;
          c *= 0.92 + cn(rp * 0.6) * 0.1 + cn(rp * 3.0) * 0.05 * fine;
        } else if (vLN.y > 0.25) {
          // Steildach: Ziegelreihen versetzt, unten je Reihe ein Schatten, etwas Moos und Schmutz
          float rv = (vLP.y - vB.y) * 10.0;
          float row = rv / 0.26, rowF = fract(row);
          float colU = (L > 0.8 ? uw : dot(vLP.xz, vec2(0.7, 0.7)) * 10.0) / 0.3 + step(1.0, mod(floor(row), 2.0)) * 0.5;
          float tile = ch(vec3(floor(colU), floor(row), seed * 17.0));
          float edgeT = smoothstep(0.0, 0.25, rowF) * (1.0 - 0.35 * (1.0 - step(0.06, fract(colU))));
          c *= mix(1.0, (0.78 + 0.22 * edgeT) * (0.9 + tile * 0.18), fine);
          c = mix(c, c * vec3(0.86, 0.95, 0.82), smoothstep(0.62, 0.9, cn(vLP.xz * 18.0)) * 0.4);
        }
        diffuseColor.rgb = c;
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, mix(0.14, 0.06, GLS), WIN);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      metalnessFactor = max(metalnessFactor, max(MET, WIN * mix(0.15, 0.4, GLS)));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += vec3(1.0, 0.78, 0.5) * LIT * uNight * 0.5;`);
  };
  m.customProgramCacheKey = () => 'city-bld-4' + (far ? 'f' : '');
  if (far) { const ob = m.onBeforeCompile; m.onBeforeCompile = sh => { ob(sh); FAR(sh); }; }
  return m;
}

// Straßen. aR: x quer (-1..1), y längs in Metern, z Stufe (1 Weg, 1.5 Platz, 2 Nebenstraße, 3 Hauptstraße, 4 Autobahn,
// 5 Bahn, 6 Straßenbahn, 7 Gehweg), w Einbahn (beim Gehweg: Gesamtbreite * 1000 + Fahrbahnbreite, halbe Breiten in dm).
// Seit 27.10.2026 wie die Straßen der Inselwelt: dunkler Asphalt, klare Markierungen, Kanaldeckel, heller Bordstein,
// Gehwegplatten entlang der Straße, Plätze mit Platten, Wege aus Sand mit Rand.
export function roadMat(far = false) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, CU);
    sh.vertexShader = 'attribute vec4 aR; varying vec4 vR; varying vec3 vWP;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vR = aR; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = 'uniform float uNight; uniform vec2 uGrd; varying vec4 vR; varying vec3 vWP;\n' + HASH + PN + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      {
        float u = abs(vR.x), s = vR.y, lvl = vR.z;
        vec2 p = (vWP.xz + uGrd) * 10.0;
        float px = length(fwidth(p)), fine = 1.0 - smoothstep(0.05, 0.25, px);
        float n = pn(p, 0.25) * 0.6 + pn(p, 2.0) * 0.4;
        vec3 c;
        if (lvl > 6.5) {
          // Gehweg: heller Bordstein an der Fahrbahn, dann Platten in Reihen entlang der Straße
          float tot = floor(vR.w / 1000.0) / 10.0, road = mod(vR.w, 1000.0) / 10.0;
          float a = u * max(tot, 0.1), off = a - road;
          vec2 q = vec2(s / 1.0, off / 0.6); q.x += step(1.0, mod(floor(q.y), 2.0)) * 0.5;
          vec2 g = abs(fract(q) - 0.5);
          c = vec3(0.8, 0.78, 0.74) * (0.93 + ch(vec3(floor(q), 1.0)) * 0.09);
          c *= 1.0 - 0.13 * smoothstep(0.45, 0.5, max(g.x, g.y)) * fine;
          float curb = step(road > 0.1 ? 0.0 : 9.0, off) * step(off, 0.28);
          c = mix(c, vec3(0.86, 0.85, 0.82) * (0.94 + 0.06 * step(0.5, fract(s / 0.8))), curb);
          c *= 1.0 - 0.25 * curb * smoothstep(0.2, 0.28, off);
        } else if (lvl > 5.5) {
          // Straßenbahn: nur die Schienen im Pflaster
          float r1 = 1.0 - smoothstep(0.03, 0.06, abs(u - 0.45));
          if (r1 < 0.05) discard;
          c = vec3(0.55, 0.56, 0.58);
        } else if (lvl > 4.5) {
          // Bahn: Schotter, Schwellen, zwei Schienen
          c = vec3(0.56, 0.52, 0.48) * (0.8 + n * 0.3);
          float sl = step(fract(s / 0.65), 0.35) * step(u, 0.75);
          c = mix(c, vec3(0.42, 0.33, 0.26), sl * 0.85);
          float rl = 1.0 - smoothstep(0.02, 0.05, abs(u - 0.36));
          c = mix(c, vec3(0.7, 0.72, 0.75), rl);
        } else if (lvl < 1.9) {
          if (lvl > 1.4) {
            // Platz und Fußgängerzone: helle Platten
            vec2 q = p / vec2(1.0, 0.5); q.x += step(1.0, mod(floor(q.y), 2.0)) * 0.5;
            vec2 g = abs(fract(q) - 0.5);
            c = vec3(0.84, 0.82, 0.77) * (0.93 + ph(floor(q), 2048.0) * 0.09);
            c *= 1.0 - 0.12 * smoothstep(0.45, 0.5, max(g.x, g.y)) * fine;
          } else {
            // Weg: festgetretener Sand, Ränder dunkler, kleine Steinchen
            c = vec3(0.82, 0.74, 0.58) * (0.9 + n * 0.16);
            c = mix(c, vec3(0.62, 0.53, 0.4), smoothstep(0.7, 1.0, u + (pn(p, 1.0) - 0.5) * 0.3) * 0.6);
            c = mix(c, c * 1.15, step(0.82, pn(p, 8.0)) * fine * 0.5);
          }
        } else {
          // Asphalt mit Körnung und Flicken, Markierungen je Stufe, Kanaldeckel, dunkle Kante zum Bordstein
          c = vec3(0.27, 0.28, 0.3) * (0.88 + n * 0.2);
          c *= 1.0 + (pn(p, 8.0) - 0.5) * 0.12 * fine;
          c = mix(c, vec3(0.22, 0.23, 0.25), smoothstep(0.66, 0.72, pn(p, 0.125)) * 0.55);
          float line = 0.0;
          if (lvl > 2.5) {
            line += (1.0 - smoothstep(0.014, 0.03, u)) * step(fract(s / 9.0), 0.5) * (1.0 - step(0.5, vR.w));
            line += (1.0 - smoothstep(0.012, 0.028, abs(u - 0.9)));
            if (lvl > 3.5) line += (1.0 - smoothstep(0.01, 0.024, abs(u - 0.45))) * step(fract(s / 12.0), 0.4);
          } else if (lvl > 1.9) {
            line += (1.0 - smoothstep(0.012, 0.026, u)) * step(fract(s / 6.0), 0.4) * (1.0 - step(0.5, vR.w)) * 0.7;
          }
          c = mix(c, vec3(0.95, 0.94, 0.9), clamp(line, 0.0, 1.0) * 0.9);
          float mh = step(0.55, ch(vec3(floor(s / 37.0), lvl, 3.0))) * (1.0 - smoothstep(0.035, 0.05, length(vec2((fract(s / 37.0) - 0.5) * 37.0 * 0.05, (u - 0.45) * 0.4))));
          c = mix(c, vec3(0.2, 0.2, 0.21), mh * fine);
          c *= 1.0 - 0.22 * smoothstep(0.88, 1.0, u);
        }
        diffuseColor.rgb = c;
      }`);
  };
  m.customProgramCacheKey = () => 'city-road-2' + (far ? 'f' : '');
  if (far) { const ob = m.onBeforeCompile; m.onBeforeCompile = sh => { ob(sh); FAR(sh); }; }
  return m;
}

export function groundMat(far = false) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  m.onBeforeCompile = sh => {
    sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = 'varying vec3 vWP;\n' + HASH + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      { vec2 p = vWP.xz * 10.0; float n = cn(p * 0.12) * 0.5 + cn(p * 0.6) * 0.3 + cn(p * 2.4) * 0.2; diffuseColor.rgb *= 0.86 + n * 0.26; }`);
  };
  m.customProgramCacheKey = () => 'city-ground-1' + (far ? 'f' : '');
  if (far) { const ob = m.onBeforeCompile; m.onBeforeCompile = sh => { ob(sh); FAR(sh); }; }
  return m;
}

export function baseMat(color) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 });
  m.onBeforeCompile = sh => {
    sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = 'varying vec3 vWP;\n' + HASH + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      { vec2 p = vWP.xz * 10.0; float n = cn(p * 0.05) * 0.45 + cn(p * 0.3) * 0.35 + cn(p * 1.9) * 0.2; diffuseColor.rgb *= 0.88 + n * 0.22; }`);
  };
  m.customProgramCacheKey = () => 'city-base-1';
  return m;
}

export function waterMat(far = false) {
  const m = new THREE.MeshStandardMaterial({ color: 0x5f9ec2, roughness: 0.08, metalness: 0.15, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, CU);
    sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = 'uniform float uTime; varying vec3 vWP;\n' + HASH + sh.fragmentShader
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      { vec2 p = vWP.xz * 10.0; float t = uTime;
        float a = cn(p * 0.09 + vec2(t * 0.35, t * 0.2)) - cn(p * 0.09 + vec2(-t * 0.25, t * 0.3));
        float b = cn(p * 0.23 + vec2(t * 0.6, -t * 0.4)) - cn(p * 0.23 + vec2(t * 0.3, t * 0.55));
        vec3 wn = normalize(vec3(a * 0.22 + b * 0.12, 1.0, b * 0.22 - a * 0.1));
        normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      { vec2 p = vWP.xz * 10.0; diffuseColor.rgb *= 0.9 + cn(p * 0.02) * 0.2; }`);
  };
  m.customProgramCacheKey = () => 'city-water-1' + (far ? 'f' : '');
  if (far) { const ob = m.onBeforeCompile; m.onBeforeCompile = sh => { ob(sh); FAR(sh); }; }
  return m;
}
