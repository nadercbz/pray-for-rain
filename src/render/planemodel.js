// Detailreiches Flugzeug im Tiny Glade Stil, in Metern: Nase nach +z, oben +y. Achtung: im rechtshändigen three.js ist
// bei Nase nach +z die Seite +x im Bild LINKS (rotes Positionslicht), -x rechts (grün). Pilot sitzt links (+x).
// Rumpf als Loft aus Superellipsen mit Fenstern (Löcher im Shader, darunter Glas und Kabine mit Pilot), Flügel mit
// NACA Profil, Rippen, Klappen und Querrudern an Scharnieren, Leitwerk mit Zierstreifen, Dreiblatt-Propeller mit
// Unschärfescheibe, Positionslichter mit Blitz, Kennzeichen, Radverkleidungen. Lack mit Klarlack und Spiegelung.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const D2R = Math.PI / 180;
export const COL = { cream: '#f3ead7', coral: '#d9644c', teal: '#3f9f97', ink: '#2c4f55', frame: '#3b4246', rubber: '#25272a', metal: '#bdb8ae', seat: '#6b4a3a', skin: '#e2b48e', interior: '#2b2826', panel: '#2f3437', yellow: '#f2c84b' };
const P = 2.5; // Superellipse: zwischen rund (2) und kastig

// ---------- Umgebung für Spiegelungen (einmal gebacken) ----------
export function makeEnv(renderer) {
  const sc = new THREE.Scene();
  sc.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP; void main(){
      float y = vP.y; vec3 top = vec3(0.30, 0.52, 0.85), hor = vec3(0.95, 0.92, 0.86), gnd = vec3(0.30, 0.36, 0.25);
      vec3 c = y > 0.0 ? mix(hor, top, pow(y, 0.55)) : mix(hor, gnd, pow(-y, 0.35));
      c += vec3(1.0, 0.95, 0.85) * pow(max(dot(vP, normalize(vec3(0.5, 0.75, 0.35))), 0.0), 80.0) * 8.0;
      gl_FragColor = vec4(c, 1.0); }`,
  })));
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(sc, 0.02).texture;
  pm.dispose();
  return tex;
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ---------- Rumpfquerschnitte: z, halbe Breite, halbe Höhe, Mitte y ----------
const SEC = [
  [2.44, 0.17, 0.17, 0.05], [2.36, 0.36, 0.34, 0.05], [2.15, 0.48, 0.44, 0.07], [1.85, 0.54, 0.48, 0.06],
  [1.50, 0.55, 0.47, 0.05], [1.25, 0.565, 0.58, 0.17], [1.05, 0.57, 0.685, 0.23], [0.60, 0.575, 0.69, 0.23], [0.0, 0.57, 0.69, 0.23],
  [-0.60, 0.54, 0.64, 0.26], [-1.30, 0.45, 0.52, 0.29], [-2.20, 0.33, 0.38, 0.32], [-3.30, 0.21, 0.26, 0.35],
  [-4.40, 0.12, 0.16, 0.38], [-4.92, 0.06, 0.08, 0.40],
];
function sec(z) {
  const n = SEC.length;
  if (z >= SEC[0][0]) return SEC[0].slice(1);
  if (z <= SEC[n - 1][0]) return SEC[n - 1].slice(1);
  let i = 0; while (SEC[i + 1][0] > z) i++;
  const t = (SEC[i][0] - z) / (SEC[i][0] - SEC[i + 1][0]);
  const p0 = SEC[Math.max(0, i - 1)], p1 = SEC[i], p2 = SEC[i + 1], p3 = SEC[Math.min(n - 1, i + 2)];
  const out = [];
  for (let k = 1; k < 4; k++) { // Catmull-Rom
    const a = p0[k], b = p1[k], c = p2[k], d = p3[k];
    out.push(0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t));
  }
  return out;
}
const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
// Punkt auf dem Rumpf: Winkel th (0 = Seite +x, pi/2 = oben)
function hull(z, th) { const [a, b, yc] = sec(z); return [a * spow(Math.cos(th), 2 / P), yc + b * spow(Math.sin(th), 2 / P), z]; }
// x auf der Rumpfseite bei Höhe y (für Dinge, die außen aufliegen)
function surfX(z, y) { const [a, b, yc] = sec(z); const s = Math.min(1, Math.abs((y - yc) / b)); const sn = Math.pow(s, P / 2); return a * Math.pow(Math.max(0, 1 - sn * sn) ** 0.5, 2 / P); }

// Fenster als abgerundete Rechtecke (Abstandsfunktion), gleich im Shader und beim Glas
function rbox(px, py, cx, cy, hx, hy, r) { const qx = Math.abs(px - cx) - hx + r, qy = Math.abs(py - cy) - hy + r; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; }
function winD(x, y, z) {
  let d = 1e3;
  if (Math.abs(x) > 0.25) {
    d = Math.min(d, rbox(z, y, 0.655, 0.60, 0.315, 0.235, 0.07));
    d = Math.min(d, rbox(z, y, -0.13, 0.59, 0.33, 0.205, 0.09));
  }
  if (y > 0.35 && z > 0.9) d = Math.min(d, rbox(z, x, 1.27, 0, 0.19, 0.40, 0.08));
  return d;
}
const WIN_GLSL = `
  float rbox(vec2 p, vec2 c, vec2 h, float r){ vec2 q = abs(p - c) - h + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  float winD(vec3 l){
    float d = 1e3;
    if (abs(l.x) > 0.25) { d = min(d, rbox(l.zy, vec2(0.655, 0.60), vec2(0.315, 0.235), 0.07)); d = min(d, rbox(l.zy, vec2(-0.13, 0.59), vec2(0.33, 0.205), 0.09)); }
    if (l.y > 0.35 && l.z > 0.9) d = min(d, rbox(l.zx, vec2(1.27, 0.0), vec2(0.19, 0.40), 0.08));
    return d;
  }`;

function fuselage(mats) {
  const RAD = 48, zs = [];
  for (let z = 2.44; z > -4.92; z -= (z > -0.8 && z < 1.7) ? 0.045 : 0.08) zs.push(z);
  zs.push(-4.92);
  const pos = [], idx = [];
  for (const z of zs) for (let j = 0; j < RAD; j++) pos.push(...hull(z, j / RAD * Math.PI * 2));
  for (let i = 0; i < zs.length - 1; i++) for (let j = 0; j < RAD; j++) {
    const a = i * RAD + j, b = i * RAD + (j + 1) % RAD, c = a + RAD, d = b + RAD;
    idx.push(a, c, b, b, c, d); // Wicklung so, dass die Vorderseite außen liegt (gl_FrontFacing im Shader)
  }
  // Heckkappe (Fächer)
  const tip = pos.length / 3; pos.push(0, sec(-4.95)[2], -4.97);
  const last = (zs.length - 1) * RAD;
  for (let j = 0; j < RAD; j++) idx.push(last + j, tip, last + (j + 1) % RAD);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const body = new THREE.Mesh(g, mats.body);
  body.castShadow = true; body.receiveShadow = true;
  // Glas: die Vierecke unter den Fensterlöchern, leicht nach innen gesetzt (der Lack deckt die Ecken)
  const P3 = g.attributes.position.array, N3 = g.attributes.normal.array, gi = [], gp = [];
  const map = new Map();
  const vert = k => { if (!map.has(k)) { map.set(k, gp.length / 3); gp.push(P3[k * 3] - N3[k * 3] * 0.008, P3[k * 3 + 1] - N3[k * 3 + 1] * 0.008, P3[k * 3 + 2] - N3[k * 3 + 2] * 0.008); } return map.get(k); };
  for (let i = 0; i < zs.length - 1; i++) for (let j = 0; j < RAD; j++) {
    const a = i * RAD + j, b = i * RAD + (j + 1) % RAD, c = a + RAD, d = b + RAD;
    const cx = (P3[a * 3] + P3[d * 3]) / 2, cy = (P3[a * 3 + 1] + P3[d * 3 + 1]) / 2, cz = (P3[a * 3 + 2] + P3[d * 3 + 2]) / 2;
    if (winD(cx, cy, cz) < 0.07) gi.push(vert(a), vert(c), vert(b), vert(b), vert(c), vert(d));
  }
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3)); gg.setIndex(gi); gg.computeVertexNormals();
  const glass = new THREE.Mesh(gg, mats.glass);
  glass.renderOrder = 3;
  return { body, glass };
}

function bodyMaterial(env) {
  const m = new THREE.MeshPhysicalMaterial({ color: COL.cream, roughness: 0.4, metalness: 0, clearcoat: 0.65, clearcoatRoughness: 0.2, envMap: env, envMapIntensity: 0.55, side: THREE.DoubleSide });
  const U = { cCream: new THREE.Color(COL.cream), cCoral: new THREE.Color(COL.coral), cTeal: new THREE.Color(COL.teal), cFrame: new THREE.Color(COL.frame), cIn: new THREE.Color(COL.interior) };
  m.onBeforeCompile = sh => {
    Object.entries(U).forEach(([k, v]) => { sh.uniforms[k] = { value: v }; });
    sh.vertexShader = 'varying vec3 vLoc;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vLoc = position;');
    sh.fragmentShader = 'varying vec3 vLoc; uniform vec3 cCream, cCoral, cTeal, cFrame, cIn;\n' + WIN_GLSL + '\n' + sh.fragmentShader.replace('#include <color_fragment>', `
      float wd = winD(vLoc);
      if (wd < 0.0) discard; // Fensterloch: dahinter Glas und Kabine
      vec3 col = cCream;
      float ys = 0.02 + max(0.0, -vLoc.z - 0.6) * 0.07; // Zierlinie steigt zum Heck hin an
      if (vLoc.y > ys && vLoc.y < ys + 0.12) col = cCoral;
      if (vLoc.y > ys - 0.05 && vLoc.y < ys - 0.025) col = cTeal;
      if (vLoc.z > 1.47) col = cTeal; // Motorhaube
      if (abs(vLoc.z - 1.47) < 0.01) col = cFrame; // Fuge an der Haube
      float door = rbox(vLoc.zy, vec2(0.66, 0.33), vec2(0.37, 0.53), 0.06);
      if (abs(vLoc.x) > 0.3 && abs(door) < 0.007 && wd > 0.03) col = mix(col, cFrame, 0.7); // Türfuge
      if (wd < 0.024) col = cFrame; // Fensterrahmen
      if (!gl_FrontFacing) col = cIn; // innen dunkel
      diffuseColor.rgb = col;`).replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
      if (!gl_FrontFacing) { material.clearcoat = 0.0; material.roughness = 0.95; } // Kabinenwand matt`);
  };
  return m;
}

// ---------- Profile ----------
// NACA 4 Ziffern: Wölbung m bei p, Dicke t. Liefert Ober- und Unterseite bei u (0 Nase, 1 Hinterkante)
function naca(m, p, t) {
  return u => {
    const yt = 5 * t * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
    const yc = m ? (u < p ? m / (p * p) * (2 * p * u - u * u) : m / ((1 - p) ** 2) * (1 - 2 * p + 2 * p * u - u * u)) : 0;
    return [yc + yt, yc - yt];
  };
}
// geschlossene Schleife (u, y) zwischen u0 und u1: oben von hinten nach vorn, unten von vorn nach hinten
function loop(f, u0, u1, n = 18) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const k = 1 - i / n; const u = u0 + (u1 - u0) * (0.5 - 0.5 * Math.cos(k * Math.PI)); pts.push([u, f(u)[0]]); }
  for (let i = 1; i < n; i++) { const k = i / n; const u = u0 + (u1 - u0) * (0.5 - 0.5 * Math.cos(k * Math.PI)); pts.push([u, f(u)[1]]); }
  return pts;
}
// Fläche aus Profilschleifen an Spannweitenstationen. st: [{x, s}] (s skaliert Dicke für runde Enden), Sehne C, Nase bei zLE.
// sx = ±1 spiegelt (mit gedrehter Wicklung). Ursprung (ox, oy, oz) wird abgezogen (für Drehpunkte).
function foilGeo(pts, st, C, zLE, sx = 1, o = [0, 0, 0], caps = true) {
  const pos = [], idx = [], L = pts.length;
  for (const { x, s = 1, c = 1 } of st) for (const [u, y] of pts) {
    const uc = 0.35 + (u - 0.35) * c; // zur Spitze hin kürzere Sehne um die Mitte des Profils
    pos.push(sx * x - o[0], y * C * s - o[1], zLE - uc * C - o[2]);
  }
  const tri = (a, b, c) => (sx > 0 ? idx.push(a, b, c) : idx.push(a, c, b));
  for (let i = 0; i < st.length - 1; i++) for (let j = 0; j < L; j++) {
    const a = i * L + j, b = i * L + (j + 1) % L, c = a + L, d = b + L;
    tri(a, c, b); tri(b, c, d);
  }
  if (caps) for (const [i, flip] of [[0, true], [st.length - 1, false]]) {
    const ctr = pos.length / 3; let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < L; j++) { cx += pos[(i * L + j) * 3]; cy += pos[(i * L + j) * 3 + 1]; cz += pos[(i * L + j) * 3 + 2]; }
    pos.push(cx / L, cy / L, cz / L);
    for (let j = 0; j < L; j++) { const a = i * L + j, b = i * L + (j + 1) % L; if (flip) tri(a, b, ctr); else tri(b, a, ctr); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// schmales Band auf der Oberseite des Profils (Rippen- und Nahtlinien)
function ribGeo(f, u0, u1, x, C, zLE, w = 0.012, lift = 0.004) {
  const pos = [], idx = [], n = 14;
  for (let i = 0; i <= n; i++) {
    const u = u0 + (u1 - u0) * i / n, y = f(u)[0] * C + lift;
    pos.push(x - w / 2, y, zLE - u * C, x + w / 2, y, zLE - u * C);
    if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const mirrorX = g => { const m = g.clone(); m.scale(-1, 1, 1); const ix = m.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } m.computeVertexNormals(); return m; };

// ---------- Propeller ----------
function bladeGeo() {
  const pos = [], col = [], idx = [], R = 0.96, stations = 12, S6 = 6, yel = new THREE.Color(COL.yellow), blk = new THREE.Color('#2b2b2c');
  for (let i = 0; i <= stations; i++) {
    const r = 0.1 + (R - 0.1) * i / stations, k = r / R;
    let c = 0.07 + 0.1 * Math.sin(Math.PI * Math.min(1, k * 1.05) ** 0.75); if (i === stations) c *= 0.45;
    const t = 0.03 * (1 - k * 0.6), beta = Math.atan(1.7 / (2 * Math.PI * r));
    const cd = [Math.cos(beta), -Math.sin(beta)], td = [Math.sin(beta), Math.cos(beta)]; // Sehne und Dicke in der x-z Ebene
    const sec = [[-0.5, 0], [-0.25, 0.5], [0.25, 0.5], [0.5, 0], [0.25, -0.5], [-0.25, -0.5]];
    const cc = k > 0.88 ? yel : blk;
    for (const [a, b] of sec) { pos.push(cd[0] * a * c + td[0] * b * t, r, cd[1] * a * c + td[1] * b * t); col.push(cc.r, cc.g, cc.b); }
    if (i < stations) for (let j = 0; j < S6; j++) { const a = i * S6 + j, b = i * S6 + (j + 1) % S6; idx.push(a, b, a + S6, b, b + S6, a + S6); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function blurTex() {
  return canvasTex(512, 512, (x, w, h) => {
    const cx = w / 2, cy = h / 2, R = w / 2;
    for (let b = 0; b < 3; b++) {
      const a0 = b * Math.PI * 2 / 3;
      const g = x.createConicGradient(a0, cx, cy);
      g.addColorStop(0, 'rgba(40,40,42,0.55)'); g.addColorStop(0.03, 'rgba(40,40,42,0.32)'); g.addColorStop(0.2, 'rgba(40,40,42,0.08)'); g.addColorStop(0.33, 'rgba(40,40,42,0)'); g.addColorStop(1, 'rgba(40,40,42,0)');
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, R * 0.86, 0, Math.PI * 2); x.arc(cx, cy, R * 0.16, 0, Math.PI * 2, true); x.fill();
    }
    x.strokeStyle = 'rgba(242,200,75,0.55)'; x.lineWidth = R * 0.09; x.beginPath(); x.arc(cx, cy, R * 0.91, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,0.12)'; x.lineWidth = R * 0.02; x.beginPath(); x.arc(cx, cy, R * 0.6, 0, Math.PI * 2); x.stroke();
  });
}
export function glowTex() {
  return canvasTex(128, 128, (x, w) => {
    const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,0.75)'); g.addColorStop(0.45, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, w);
  });
}

// ---------- Aufbau ----------
export function buildPlane(renderer) {
  const env = makeEnv(renderer);
  const root = new THREE.Group();
  const paint = (c, o = {}) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.4, metalness: 0, clearcoat: 0.65, clearcoatRoughness: 0.2, envMap: env, envMapIntensity: 0.55, side: THREE.DoubleSide, ...o });
  const plain = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0, envMap: env, envMapIntensity: 0.3, ...o });
  const M = {
    body: bodyMaterial(env), cream: paint(COL.cream), coral: paint(COL.coral), teal: paint(COL.teal), rib: paint('#c4573f'), ribCream: paint('#e3d8c2'),
    glass: new THREE.MeshPhysicalMaterial({ color: '#a9cbd3', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.3, envMap: env, envMapIntensity: 1.8, clearcoat: 1, depthWrite: false }), // nur von außen: im Cockpit klare Sicht
    metal: plain(COL.metal, { roughness: 0.32, metalness: 0.75, envMapIntensity: 0.9 }), dark: plain('#3a3f42'), rubber: plain(COL.rubber, { roughness: 0.9 }),
    seat: plain(COL.seat), panel: plain(COL.panel, { roughness: 0.6 }), skin: plain(COL.skin, { roughness: 0.65 }), shirt: plain('#e8e1d3'),
    blade: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25, envMap: env, envMapIntensity: 0.6, side: THREE.DoubleSide }),
  };
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = root, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m; };

  // Rumpf, Glas
  const F = fuselage(M);
  root.add(F.body, F.glass);

  // Motorhaube: Lufteinlässe, Lüftungsschlitze, Auspuff, Ölkühler
  for (const s of [-1, 1]) {
    const inl = add(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 20).rotateX(Math.PI / 2), M.dark, s * 0.25, -0.04, 2.33, root, false); inl.scale.set(1, 0.62, 1);
    for (let k = 0; k < 5; k++) {
      const z = 1.62 + k * 0.065, y = 0.3, x = surfX(z, y) + 0.004;
      const sl = add(new THREE.BoxGeometry(0.012, 0.022, 0.05), M.dark, s * x, y, z, root, false); sl.rotation.y = s * 0.12;
    }
  }
  for (const dz of [0, 0.11]) { const ex = add(new THREE.CylinderGeometry(0.03, 0.034, 0.2, 10), M.metal, -0.2, -0.36, 1.5 - dz, root, false); ex.rotation.x = 0.9; }
  add(new THREE.BoxGeometry(0.26, 0.08, 0.3), M.dark, 0, -0.39, 1.95, root, false);
  // Auspuffflamme beim Turbo
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const flame = new THREE.Group();
  for (const dz of [0, 0.11]) { const f = add(new THREE.ConeGeometry(0.045, 0.35, 10).translate(0, -0.175, 0), flameMat, -0.2, -0.43, 1.45 - dz, flame, false); f.rotation.x = 0.9; }
  root.add(flame);

  // Spinner, Propeller, Unschärfescheibe
  const prof = []; for (let i = 0; i <= 14; i++) { const h = 0.46 * i / 14; prof.push(new THREE.Vector2(0.205 * Math.pow(Math.max(0, 1 - (h / 0.46) ** 2), 0.55), h)); }
  add(new THREE.LatheGeometry(prof, 28).rotateX(Math.PI / 2), M.coral, 0, 0.05, 2.43);
  add(new THREE.CylinderGeometry(0.21, 0.21, 0.035, 28).rotateX(Math.PI / 2), M.cream, 0, 0.05, 2.43);
  const prop = new THREE.Group(); prop.position.set(0, 0.05, 2.5); root.add(prop);
  const bg = bladeGeo();
  for (let b = 0; b < 3; b++) { const m = add(bg, M.blade, 0, 0, 0, prop); m.rotation.z = b * Math.PI * 2 / 3; }
  const blur = new THREE.Mesh(new THREE.CircleGeometry(0.98, 48), new THREE.MeshBasicMaterial({ map: blurTex(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  blur.position.set(0, 0.05, 2.5); blur.renderOrder = 4; root.add(blur);

  // Flügel: Hochdecker, zwei Hälften mit V Stellung und Einstellwinkel
  const wf = naca(0.02, 0.4, 0.13), C = 1.55, zLE = 1.085, HU = 0.735;
  const mainPts = loop(wf, 0, 0.725), backPts = loop(wf, 0.75, 1.0, 10);
  const ail = {}, lights = { nav: [], strobe: [], beacon: null, tail: null };
  const glow = glowTex();
  const lamp = (parent, x, y, z, color, size) => {
    const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
    add(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshBasicMaterial({ color, toneMapped: false }), 0, 0, 0, g, false);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
    sp.scale.setScalar(size); g.add(sp); g.userData.sprite = sp; g.userData.size = size;
    return g;
  };
  for (const s of [-1, 1]) {
    const half = new THREE.Group(); half.position.set(0, 0.95, 0); half.rotation.set(-2 * D2R, 0, s * 3 * D2R); root.add(half);
    const main = foilGeo(mainPts, [{ x: 0 }, { x: 4.4 }], C, zLE, s, [0, 0, 0], true);
    add(main, M.coral, 0, 0, 0, half);
    // runde Spitze in Creme
    add(foilGeo(mainPts, [{ x: 4.4 }, { x: 4.55, s: 0.85, c: 0.97 }, { x: 4.64, s: 0.55, c: 0.9 }, { x: 4.68, s: 0.2, c: 0.8 }], C, zLE, s, [0, 0, 0], true), M.cream, 0, 0, 0, half);
    add(foilGeo(backPts, [{ x: 4.44 }, { x: 4.55, s: 0.85, c: 0.97 }, { x: 4.62, s: 0.5, c: 0.9 }], C, zLE, s, [0, 0, 0], true), M.cream, 0, 0, 0, half);
    // Wurzel hinten fest, Klappe (fest, mit Scharnieren), Querruder an Drehpunkt
    add(foilGeo(backPts, [{ x: 0 }, { x: 0.6 }], C, zLE, s), M.coral, 0, 0, 0, half);
    add(foilGeo(backPts, [{ x: 0.62 }, { x: 2.36 }], C, zLE, s), M.cream, 0, 0, 0, half);
    const hz = zLE - HU * C, hy = wf(HU)[0] * C * 0.3 + wf(HU)[1] * C * 0.7;
    const piv = new THREE.Group(); piv.position.set(s * 3.42, hy, hz); half.add(piv);
    add(foilGeo(backPts, [{ x: 2.4 }, { x: 4.42 }], C, zLE, s, [s * 3.42, hy, hz]), M.cream, 0, 0, 0, piv);
    ail[s < 0 ? 'L' : 'R'] = piv;
    // Scharniere unter der Klappe und dem Querruder
    for (const x of [0.9, 1.6, 2.2, 2.7, 3.4, 4.1]) add(new THREE.BoxGeometry(0.03, 0.05, 0.07), M.dark, s * x, hy - 0.03, hz + 0.02, half, false);
    // Rippen- und Nahtlinien oben
    const ribs = [];
    for (let x = 0.35; x < 4.4; x += 0.45) ribs.push(ribGeo(wf, 0.02, 0.72, x, C, zLE));
    const rg = mergeGeometries(ribs); if (s < 0) rg.copy(mirrorX(rg));
    add(rg, M.rib, 0, 0, 0, half, false);
    const sribs = []; for (let x = 0.8; x < 2.36; x += 0.45) sribs.push(ribGeo(wf, 0.77, 0.98, x, C, zLE, 0.01));
    const sg = mergeGeometries(sribs); if (s < 0) sg.copy(mirrorX(sg));
    add(sg, M.ribCream, 0, 0, 0, half, false);
    // Positionslicht vorne an der Spitze: links (+x) rot, rechts (-x) grün; dahinter der Blitz; Landescheinwerfer links
    lights.nav.push(lamp(half, s * 4.69, 0.02, 0.86, s > 0 ? 0xff3a30 : 0x35ff6a, 0.55));
    lights.strobe.push(lamp(half, s * 4.69, 0.02, 0.55, 0xffffff, 0.0));
    if (s > 0) add(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff6e0, toneMapped: false }), 1.7, -0.01, zLE - 0.01, half, false);
    // Strebe vom Rumpf zum Flügel, abgeflacht wie ein Profil
    const from = new THREE.Vector3(s * 0.5, -0.28, 0.42), to = new THREE.Vector3(s * 2.55, 0.99 + 2.55 * Math.tan(3 * D2R) - 0.12, 0.62);
    const st = add(new THREE.CylinderGeometry(0.03, 0.03, from.distanceTo(to), 10).scale(1, 1, 2.2), M.cream, 0, 0, 0);
    st.position.copy(from).add(to).multiplyScalar(0.5);
    st.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  }

  // Höhenleitwerk mit Ruder (symmetrisches Profil)
  const tf = naca(0, 0.4, 0.1), TC = 0.82, TZ = -3.92, TU = 0.6;
  const tPts = loop(tf, 0, TU - 0.02, 14), ePts = loop(tf, TU + 0.02, 1, 8);
  for (const s of [-1, 1]) {
    add(foilGeo(tPts, [{ x: 0 }, { x: 1.38 }, { x: 1.48, s: 0.6, c: 0.92 }, { x: 1.52, s: 0.2, c: 0.85 }], TC, TZ, s), M.coral, 0, 0.33, 0);
  }
  const elev = new THREE.Group(); const ez = TZ - TU * TC; elev.position.set(0, 0.33, ez); root.add(elev);
  for (const s of [-1, 1]) {
    add(foilGeo(ePts, [{ x: 0 }, { x: 1.36 }, { x: 1.46, s: 0.5, c: 0.9 }], TC, TZ, s, [0, 0, ez]), M.cream, 0, 0, 0, elev);
    for (const x of [0.4, 1.0]) add(new THREE.BoxGeometry(0.025, 0.04, 0.05), M.dark, s * x, -0.02, 0.02, elev, false);
  }

  // Seitenleitwerk (Platte mit runden Kanten), Ruder, Zierstreifen und Regentropfen
  const finShape = new THREE.Shape([[-3.1, 0.55], [-3.65, 0.66], [-3.95, 0.82], [-4.5, 1.58], [-4.62, 1.66], [-4.8, 1.66], [-4.8, 0.38], [-3.6, 0.38]].map(([z, y]) => new THREE.Vector2(-z, y)));
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.018, bevelSegments: 3, curveSegments: 4 }).rotateY(Math.PI / 2).translate(-0.025, 0, 0);
  add(finGeo, M.cream);
  const rud = new THREE.Group(); rud.position.set(0, 0.4, -4.83); root.add(rud);
  const rudShape = new THREE.Shape([[-4.84, 1.6], [-5.03, 1.6], [-5.13, 1.46], [-5.12, 0.66], [-5.0, 0.44], [-4.84, 0.44]].map(([z, y]) => new THREE.Vector2(-(z + 4.83), y - 0.4)));
  add(new THREE.ExtrudeGeometry(rudShape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.014, bevelSegments: 2, curveSegments: 4 }).rotateY(Math.PI / 2).translate(-0.02, 0, 0), M.cream, 0, 0, 0, rud);
  const zle = y => -3.95 - (y - 0.82) * (0.55 / 0.76);
  const band = (y0, y1, z1) => new THREE.ShapeGeometry(new THREE.Shape([[zle(y0), y0], [z1, y0], [z1, y1], [zle(y1), y1]].map(([z, y]) => new THREE.Vector2(-z, y)))).rotateY(Math.PI / 2);
  const rband = (y0, y1) => new THREE.ShapeGeometry(new THREE.Shape([[-4.84, y0], [-5.12, y0], [-5.12, y1], [-4.84, y1]].map(([z, y]) => new THREE.Vector2(-(z + 4.83), y - 0.4)))).rotateY(Math.PI / 2);
  const decal = (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.4, clearcoat: 0.6, envMap: env, envMapIntensity: 0.5, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
  const dCoral = decal(COL.coral), dTeal = decal(COL.teal);
  for (const s of [-1, 1]) {
    const off = s * 0.046;
    add(band(0.95, 1.1, -4.8), dCoral, off, 0, 0, root, false);
    add(band(1.15, 1.22, -4.8), dTeal, off, 0, 0, root, false);
    add(rband(0.95, 1.1), dCoral, s * 0.036, 0, 0, rud, false);
    add(rband(1.15, 1.22), dTeal, s * 0.036, 0, 0, rud, false);
  }
  const drop = canvasTex(256, 256, (x, w) => {
    x.fillStyle = COL.teal; x.beginPath(); x.moveTo(w * 0.5, w * 0.06); x.bezierCurveTo(w * 0.62, w * 0.3, w * 0.84, w * 0.5, w * 0.84, w * 0.66); x.arc(w * 0.5, w * 0.66, w * 0.34, 0, Math.PI); x.bezierCurveTo(w * 0.16, w * 0.5, w * 0.38, w * 0.3, w * 0.5, w * 0.06); x.fill();
    x.fillStyle = 'rgba(255,248,232,0.85)'; x.beginPath(); x.ellipse(w * 0.38, w * 0.66, w * 0.07, w * 0.12, -0.4, 0, Math.PI * 2); x.fill();
  });
  for (const s of [-1, 1]) { const d = add(new THREE.PlaneGeometry(0.24, 0.3), new THREE.MeshBasicMaterial({ map: drop, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), s * 0.047, 1.38, -4.5, root, false); d.rotation.y = s * Math.PI / 2; }

  // Kennzeichen auf beiden Rumpfseiten (auf die Rumpfform gelegt)
  const reg = canvasTex(1024, 220, (x, w, h) => { x.fillStyle = COL.ink; x.font = '800 170px Manrope, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('D-EPFR', w / 2, h / 2 + 6); });
  for (const s of [-1, 1]) {
    const pos = [], uv = [], idx = [], NU = 28, NV = 6, z0 = -1.35, z1 = -2.95, y0 = 0.36, y1 = 0.58;
    for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) {
      const z = z0 + (z1 - z0) * i / NU, y = y0 + (y1 - y0) * j / NV;
      pos.push(s * (surfX(z, y) + 0.004), y, z); uv.push(s > 0 ? i / NU : 1 - i / NU, j / NV);
      if (i < NU && j < NV) { const a = i * (NV + 1) + j, b = a + NV + 1; if (s > 0) idx.push(a, a + 1, b, a + 1, b + 1, b); else idx.push(a, b, a + 1, a + 1, b, b + 1); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    add(g, new THREE.MeshBasicMaterial({ map: reg, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide }), 0, 0, 0, root, false);
  }

  // Kabine: Boden, Sitze, Instrumentenbrett mit Uhren, Steuerhörner, Pilot (links, +x)
  add(new THREE.BoxGeometry(0.78, 0.04, 1.9), M.dark, 0, -0.26, 0.1, root, false);
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.4, 0.12, 0.44), M.seat, s * 0.27, -0.12, 0.05, root, false);
    const back = add(new THREE.BoxGeometry(0.4, 0.58, 0.1), M.seat, s * 0.27, 0.2, -0.2, root, false); back.rotation.x = 0.18;
    const yoke = new THREE.Group(); yoke.position.set(s * 0.27, 0.27, 0.86); root.add(yoke);
    add(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 8).rotateX(Math.PI / 2), M.dark, 0, 0, 0.1, yoke, false);
    add(new THREE.BoxGeometry(0.26, 0.04, 0.03), M.dark, 0, 0.0, -0.01, yoke, false);
  }
  add(new THREE.BoxGeometry(0.84, 0.08, 0.36), M.seat, 0, -0.1, -0.62, root, false); // Rückbank
  add(new THREE.BoxGeometry(0.92, 0.3, 0.06), M.panel, 0, 0.27, 1.05, root, false);
  add(new THREE.BoxGeometry(0.9, 0.05, 0.2), M.panel, 0, 0.43, 1.0, root, false); // Blendschutz
  const dial = canvasTex(128, 128, (x, w) => {
    x.fillStyle = '#15191b'; x.beginPath(); x.arc(w / 2, w / 2, w / 2 - 2, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#e8e2d2'; x.lineWidth = 3; x.beginPath(); x.arc(w / 2, w / 2, w / 2 - 8, 0, Math.PI * 2); x.stroke();
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; x.beginPath(); x.moveTo(w / 2 + Math.cos(a) * (w / 2 - 12), w / 2 + Math.sin(a) * (w / 2 - 12)); x.lineTo(w / 2 + Math.cos(a) * (w / 2 - 20), w / 2 + Math.sin(a) * (w / 2 - 20)); x.stroke(); }
    x.strokeStyle = '#f2c84b'; x.lineWidth = 4; x.beginPath(); x.moveTo(w / 2, w / 2); x.lineTo(w / 2 + 30, w / 2 - 26); x.stroke();
  });
  const dialMat = new THREE.MeshBasicMaterial({ map: dial });
  for (let i = 0; i < 6; i++) { const d = add(new THREE.CircleGeometry(0.055, 24), dialMat, (i % 3 - 1) * 0.13 + 0.27, 0.33 - Math.floor(i / 3) * 0.12, 1.018, root, false); d.rotation.y = Math.PI; }
  const pilot = new THREE.Group(); pilot.position.set(0.27, 0.08, 0.02); root.add(pilot);
  add(new THREE.CapsuleGeometry(0.15, 0.24, 6, 12), M.shirt, 0, 0.27, 0, pilot, false).rotation.x = -0.15;
  add(new THREE.SphereGeometry(0.115, 18, 14), M.skin, 0, 0.6, 0.02, pilot, false);
  const cap = add(new THREE.SphereGeometry(0.12, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.teal, 0, 0.62, 0.015, pilot, false); cap.scale.set(1, 0.8, 1);
  add(new THREE.BoxGeometry(0.16, 0.015, 0.12), M.teal, 0, 0.635, 0.14, pilot, false);
  add(new THREE.TorusGeometry(0.125, 0.012, 6, 18, Math.PI), M.dark, 0, 0.6, 0.02, pilot, false);
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 12).rotateZ(Math.PI / 2), M.dark, s * 0.12, 0.6, 0.02, pilot, false);
    const arm = add(new THREE.CapsuleGeometry(0.04, 0.42, 4, 8), M.shirt, s * 0.13, 0.38, 0.32, pilot, false); arm.rotation.x = Math.PI / 2 - 0.25;
  }

  // Antennen
  const ant = add(new THREE.CylinderGeometry(0.006, 0.012, 0.5, 6), M.dark, 0, 1.12, -0.85, root, false); ant.rotation.x = -0.5;
  add(new THREE.BoxGeometry(0.02, 0.12, 0.16), M.dark, 0, -0.45, -1.2, root, false);

  // Fahrwerk: Federstahlbeine, Räder mit Felgen, tropfenförmige Verkleidungen; Bugrad mit Federbein
  const wheel = (x, y, z, spatScale) => {
    const g = new THREE.Group(); g.position.set(x, y, z); root.add(g);
    add(new THREE.TorusGeometry(0.163, 0.058, 10, 24).rotateY(Math.PI / 2), M.rubber, 0, 0, 0, g);
    add(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 18).rotateZ(Math.PI / 2), M.metal, 0, 0, 0, g, false);
    const pr = []; for (let i = 0; i <= 16; i++) { const t = i / 16, h = -0.42 + 0.84 * t; pr.push(new THREE.Vector2(0.2 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.8), h)); }
    const sp = add(new THREE.LatheGeometry(pr, 24).rotateX(Math.PI / 2), M.coral, 0, 0.075, 0.03, g); sp.scale.set(0.66 * spatScale, spatScale, spatScale);
    return g;
  };
  for (const s of [-1, 1]) {
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(s * 0.4, -0.32, -0.26), new THREE.Vector3(s * 0.88, -0.5, -0.28), new THREE.Vector3(s * 1.12, -0.95, -0.3));
    add(new THREE.TubeGeometry(curve, 14, 0.032, 8), M.cream);
    wheel(s * 1.15, -0.98, -0.3, 1);
  }
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.32, 12), M.metal, 0, -0.42, 1.74);
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 10), M.metal, 0, -0.72, 1.75);
  wheel(0, -0.98, 1.75, 0.82);

  // Lichter am Heck: weißes Rücklicht, rote Rundumleuchte oben am Leitwerk
  lights.tail = lamp(root, 0, 0.41, -4.99, 0xffffff, 0.4);
  lights.beacon = lamp(root, 0, 1.71, -4.7, 0xff2a1a, 0.0);

  root.traverse(o => { if (o.isMesh && o.material && o.material.transparent) o.castShadow = false; });
  return { root, prop, blur, ail, elev, rud, flame, flameMat, lights, hideInCockpit: [pilot], env };
}

// Lichter jedes Bild: Blitz zweimal kurz, Rundumleuchte pulsiert, nachts größere Lichthöfe
export function updateLights(L, t, night) {
  const k = 0.6 + night * 1.6;
  for (const g of L.nav) g.userData.sprite.scale.setScalar(g.userData.size * k);
  L.tail.userData.sprite.scale.setScalar(L.tail.userData.size * k);
  const ph = t % 1.3, on = ph < 0.05 || (ph > 0.13 && ph < 0.17);
  for (const g of L.strobe) { g.userData.sprite.scale.setScalar(on ? 1.6 * k : 0.001); g.visible = true; }
  const b = Math.max(0, Math.sin(t * 5.2)) ** 6;
  L.beacon.userData.sprite.scale.setScalar(0.2 + b * 1.1 * k);
}
