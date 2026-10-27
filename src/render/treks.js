// Kundschafterzüge im Bild (seit 18.10.2026). Die Simulation (sim/explore.js, trekStep) schickt Kundschafter ins
// Unbekannte und legt den Weg in st.treks ab ({ a: Ort, d: Tag, p: Pfadpunkte alle 3 Felder}). Hier wird daraus eine
// kleine Gruppe: 3 bis 5 Menschen des Ortes (dieselben Figuren wie im Dorf, drawPerson in die Instanzen von people.js),
// dazu je Epoche ein Handkarren (Ankunft, Dorfzeit), ein Packochse (Bronzezeit, Stadtstaaten), ein Packpferd
// (Königreiche, Renaissance) oder ein Maultier mit Segeltuch (ab Industrie). Sie gehen tagsüber den Pfad ab, schlagen
// nachts ein Lager mit Feuer auf (abends sitzen und erzählen, nachts schlafen mit einer Wache), kehren am Ende des
// Pfades um und lösen sich am Ortsrand wieder auf. Wo sie sind, folgt nur aus Spielzeit und Zug (kein Speicher, die
// Simulation bleibt unberührt). Wer unterwegs ist, fehlt im Dorf (people.skip) und steht in people.pos (Klick, Folgen,
// Geistmodus). Gezeichnet wird nur in Sichtweite der Kamera, ferne Lagerfeuer nachts als kleiner Schein.
import * as THREE from 'three';
import { NX, NY, wx, wz } from './scene.js';
import { groundY } from './terrain.js';
import { drawPerson, figureScale, figFor, HEIGHT } from './people.js';
import { Bld, K, shade, paintable } from './ships.js';
import { beast, handcart } from './vehicles.js';
import { DAY_SECONDS } from '../sim/data.js';
import { L } from '../i18n.js';

const STRIDE = 0.45;          // wie in people.js (HEIGHT von dort)
const V = 7.5;                                // Felder je Spieltag beim Gehen (zügig, etwas schneller als im Dorf)
const W0 = 0.27, W1 = 0.745;                  // Gehzeit: nach Sonnenaufgang bis Sonnenuntergang (Tageszeit 0 bis 1)
const FIRE_ON = 0.765, EMBER = 0.93, WAKE = 0.2;
const GAP = 0.17, STAY = 1.6;                 // Abstand in der Reihe, Rast am Ende des Pfades (Gehweg in Feldern)
const ANIMAL = 1.45, CART = 1.25;             // Maßstab der Fahrzeugformen neben den großen Figuren
const R_SIT = 0.19, R_SLEEP = 0.29, R_ANIMAL = 0.52, CAMP_SIDE = 0.26;
const MAXT = 24;                              // höchstens so viele Züge gleichzeitig im Bild
const FIRE_FAR = 300;                         // ferne Lagerfeuer bis zu diesem Abstand
const PREF = { jaeger: 3, sammler: 2.2, haendler: 2, krieger: 1.6, fischer: 1, holzfaeller: 1, gelehrter: 0.8 };

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
// Tageszeit wie tod() in main.js, und wie viel Gehzeit (in Spieltagen) bis T vergangen ist: je sichtbarem Tag nur von W0 bis W1
const todOf = (T, VD) => { const u = T / VD + 0.3; return u - Math.floor(u); };
const walked = (T, VD) => { const u = T / VD + 0.3, c = Math.floor(u); return VD * (c * (W1 - W0) + clamp(u - c - W0, 0, W1 - W0)); };
// Feuerstärke über die Nacht: anzünden, brennen, Glut, aus
const fireK = f => (f >= FIRE_ON && f < EMBER ? clamp((f - FIRE_ON) / 0.02) : f >= EMBER ? 1 - 0.55 * clamp((f - EMBER) / 0.025)
  : f < WAKE ? 0.45 : f < WAKE + 0.025 ? 0.45 * (1 - (f - WAKE) / 0.025) : 0);

// ---------- Formen ----------
const PACK = {
  ox: { L: 0.15, H: 0.085, body: '#a68b6c', dark: '#6a4c36', belly: '#cdb792', bag: '#9b6a3a', roll: K.cream, cloth: '#c9b48a' },
  horse: { L: 0.16, H: 0.08, body: '#9a6a46', dark: '#4a3326', belly: '#b98a60', horse: true, bag: '#7a5a3a', roll: '#5f8f4a', cloth: '#b8402e' },
  mule: { L: 0.15, H: 0.078, body: '#8d8378', dark: '#5a524a', belly: '#b5ab9c', horse: true, bag: '#9c9466', roll: '#5f7a4a', cloth: '#6f93bd' },
};
const kindOf = era => (era <= 1 ? 'cart' : era <= 3 ? 'ox' : era <= 5 ? 'horse' : 'mule');

// Packtier (Blick nach +x) ohne Beine: die Beine sind eigene Instanzen und schwingen beim Gehen
function packAnimal(kind) {
  const o = PACK[kind], B = new Bld(), top = 0.07 + o.H, side = o.H * 0.42 + 0.012;
  beast(B, 0, 0, { ...o, legs: false });
  B.box(0.085, 0.006, o.H * 0.95, -0.005, top + 0.004, 0, o.cloth);                       // Decke
  for (const z of [side, -side]) {
    B.box(0.06, 0.05, 0.022, -0.005, top - 0.03, z, o.bag);                                // Packtaschen
    B.box(0.062, 0.008, 0.024, -0.005, top - 0.003, z, shade(o.bag, 0.8));
  }
  B.cyl(0.017, 0.017, o.H * 0.95, -0.012, top + 0.024, 0, o.roll, 7, [Math.PI / 2, 0, 0]); // Deckenrolle
  B.cyl(0.012, 0.014, 0.022, 0.03, top + 0.018, 0.012, K.woodL, 6);                        // Wasserkrug
  const g = B.done(false);
  g.scale(ANIMAL, ANIMAL, ANIMAL);
  return g;
}

// Ein Bein mit dem Drehpunkt an der Hüfte (oben), Huf dunkel; das Bein nimmt die Instanzfarbe an
function legGeo() {
  const B = new Bld();
  B.pf = 1; B.cyl(0.011, 0.008, 0.075, 0, -0.0375, 0, '#ffffff', 5); B.pf = 0;
  B.cyl(0.0095, 0.0095, 0.012, 0, -0.069, 0, '#3d3029', 5);
  return B.done(false);
}

// Feuerstelle: Steinkreis, Asche, Holz als Zelt, daneben ein Bündel Feuerholz
function firePit() {
  const B = new Bld();
  B.cyl(0.05, 0.055, 0.004, 0, 0.002, 0, '#3a3430', 10);
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; B.sph(0.016, Math.cos(a) * 0.062, 0.008, Math.sin(a) * 0.062, i % 2 ? '#8f8a84' : '#a39e96', 1.2, 0.8, 1, 5, 3); }
  for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + 0.4; B.rod([Math.cos(a) * 0.045, 0.004, Math.sin(a) * 0.045], [Math.cos(a) * 0.006, 0.05, Math.sin(a) * 0.006], 0.0075, i % 2 ? K.woodD : K.wood, 5); }
  for (let i = 0; i < 3; i++) B.cyl(0.007, 0.007, 0.06, 0.1, 0.008 + i * 0.004, -0.03 + i * 0.013, K.woodD, 5, [Math.PI / 2, 0.3, 0]);
  const g = B.done(false);
  g.scale(1.3, 1.3, 1.3);
  return g;
}

// ---------- Weg ----------
function smoothPts(pts) { // Chaikin, zweimal
  for (let k = 0; k < 2; k++) {
    const o = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    o.push(pts[pts.length - 1]);
    pts = o;
  }
  return pts;
}
// Stelle und Richtung nach Strecke d
function at(R, d, o) {
  d = clamp(d, 0, R.len);
  let lo = 0, hi = R.n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (R.cum[mid] <= d) lo = mid; else hi = mid; }
  const sl = Math.max(1e-6, R.cum[hi] - R.cum[lo]), k = (d - R.cum[lo]) / sl;
  const dx = R.x[hi] - R.x[lo], dz = R.z[hi] - R.z[lo], l = Math.hypot(dx, dz) || 1;
  o.x = R.x[lo] + dx * k; o.z = R.z[lo] + dz * k; o.dx = dx / l; o.dz = dz / l;
  return o;
}
// Strecke q der Runde (hin, Rast, zurück) auf den Pfad gefaltet: Stelle, Richtung (1 hin, -1 zurück), Abschnitt
function fold(E, q, o) {
  const len = E.R.len;
  if (q < len) { at(E.R, Math.max(0, q), o); o.dir = 1; o.ph = 'out'; }
  else if (q < len + STAY) { at(E.R, len, o); o.dir = 1; o.ph = 'stay'; o.k = (q - len) / STAY; }
  else if (q < 2 * len + STAY) { at(E.R, 2 * len + STAY - q, o); o.dir = -1; o.ph = 'back'; }
  else { at(E.R, 0, o); o.dir = -1; o.ph = 'home'; }
  o.fx = o.dx * o.dir; o.fz = o.dz * o.dir; // Blickrichtung
  return o;
}

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _m = new THREE.Matrix4(), _l = new THREE.Matrix4(), _c = new THREE.Color();
// Fahrzeugformen schauen nach +x: yaw aus der Richtung (dx, dz) ist atan2(-dz, dx)
function compose(m, x, y, z, yaw, pitch, s) { _e.set(0, yaw, pitch, 'YZX'); _q.setFromEuler(_e); return m.compose(_p.set(x, y, z), _q, _s.set(s, s, s)); }

export class Treks {
  constructor(stage, people, fx) {
    this.stage = stage; this.people = people; this.fx = fx;
    const scene = stage.scene;
    this.cache = new Map();   // Zug → Weg, Leute, Tier, Zustand im Bild
    this.ms = new Map();      // Mensch → Lage im Bild (weich nachgeführt)
    this.away = new Set();    // wer gerade unterwegs ist (fehlt im Dorf, people.skip)
    this.frame = 0; this.lastT = null; this.lastClock = null;
    this.o = new THREE.Object3D();
    this.stat = { active: 0, shown: 0, camps: 0, people: 0 };
    this.labels = [];
    const mat = paintable(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
    const inst = (g, cap, m = mat, shadow = true) => {
      const M = new THREE.InstancedMesh(g, m, cap);
      M.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      M.count = 0; M.frustumCulled = false; M.castShadow = shadow;
      scene.add(M);
      return M;
    };
    const cart = handcart(false); cart.scale(CART, CART, CART);
    this.body = { cart: inst(cart, MAXT), ox: inst(packAnimal('ox'), MAXT), horse: inst(packAnimal('horse'), MAXT), mule: inst(packAnimal('mule'), MAXT) };
    this.legs = inst(legGeo(), MAXT * 4);
    this.legs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXT * 4 * 3), 3);
    this.legs.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.pit = inst(firePit(), MAXT, mat, false);
    // Flammen: zwei Kegel je Feuer, hell über der Bloom Schwelle, flackern über die Größe
    const flame = new THREE.ConeGeometry(0.03, 0.1, 7, 1, true).translate(0, 0.05, 0);
    this.flame = inst(flame, MAXT * 2, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }), false);
    this.flame.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXT * 2 * 3), 3);
    this.flame.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.flame.renderOrder = 2;
    // warmer Lichtfleck am Boden (wie die Scheinwerfer in vehicles.js)
    this.poolMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uA: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uA; varying vec2 vUv; void main(){ float r = length((vUv - 0.5) * 2.0); float a = smoothstep(1.0, 0.0, r); a *= a * uA; gl_FragColor = vec4(1.0, 0.58, 0.26, a); }',
    });
    this.pool = inst(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), MAXT, this.poolMat, false);
    this.pool.renderOrder = 2;
    // ferne Lagerfeuer: ein weicher Punkt, der mit der Entfernung nicht ganz verschwindet
    const gg = new THREE.BufferGeometry();
    this.gPos = new Float32Array(MAXT * 3); this.gA = new Float32Array(MAXT);
    gg.setAttribute('position', new THREE.BufferAttribute(this.gPos, 3).setUsage(THREE.DynamicDrawUsage));
    gg.setAttribute('alpha', new THREE.BufferAttribute(this.gA, 1).setUsage(THREE.DynamicDrawUsage));
    this.glint = new THREE.Points(gg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { scale: { value: 800 } },
      vertexShader: `attribute float alpha; uniform float scale; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vA = alpha * smoothstep(14.0, 40.0, -mv.z);
          gl_PointSize = clamp(1.5 * scale / -mv.z, 5.0, 34.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float r2 = dot(d, d) * 4.0; if (r2 > 1.0) discard;
        float a = exp(-r2 * 4.0) * (1.0 - r2) * vA; gl_FragColor = vec4(vec3(1.0, 0.5, 0.16) * 1.8, a); }`,
    }));
    this.glint.frustumCulled = false; this.glint.renderOrder = 3;
    gg.setDrawRange(0, 0);
    scene.add(this.glint);
  }

  // Ein Zug, wie er im Bild erscheint: Weg (ab Ortsrand), wer mitgeht, welches Tier, Reihenfolge
  make(st, t, VD) {
    const rt = st._rt, s = rt.sById.get(t.a);
    const pts = t.p;
    if (!s || !pts || pts.length < 2) return { bad: true };
    // am Ortsrand anfangen, nicht quer durch die Häuser
    let k0 = 0;
    const R0 = (s.R || 4) + 1.2;
    while (k0 < pts.length - 2 && Math.hypot(pts[k0][0] - s.cx, pts[k0][1] - s.cy) < R0) k0++;
    const raw = smoothPts(pts.slice(k0).map(q => [wx(q[0]), wz(q[1])]));
    const n0 = raw.length, x = new Float32Array(n0), z = new Float32Array(n0), cum = new Float32Array(n0);
    for (let i = 0; i < n0; i++) {
      x[i] = raw[i][0]; z[i] = raw[i][1];
      if (i) cum[i] = cum[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]);
    }
    const len = cum[n0 - 1];
    if (len < 2) return { bad: true };
    const t0 = t.d + hash(t.a, t.d * 3 + 1) * 0.25;
    return {
      a: t.a, d: t.d, name: s.name, era: s.era | 0, R: { x, z, cum, n: n0, len }, ids: null,
      w0: walked(t0, VD), end: 2 * len + STAY, seen: 0, an: null, h: hash(t.a, t.d * 7 + 3),
    };
  }

  // Wer mitgeht (erst, wenn der Zug aufbricht): Jäger, Sammler, Händler zuerst, nie Kinder, Alte, Kranke oder der
  // Herrscher. Dazu die Reihe: Anführer vorn, dahinter wer das Tier führt oder den Karren zieht, Tier oder Karren, der Rest
  crew(st, E) {
    const want = 3 + Math.floor(hash(E.a, E.d) * 3), cand = [], busy = new Set();
    for (const E2 of this.cache.values()) if (E2 !== E && E2.ids && E2.act >= this.frame - 1) for (const id of E2.ids) busy.add(id); // schon in einem anderen Zug
    for (const p of st.people) {
      if (p.s !== E.a || p.away || p.sick || p.lt || p.job === 'kind' || p.job === 'alt' || busy.has(p.id)) continue;
      cand.push([(PREF[p.job] || 0.3) + hash(p.id, E.d) * 2.2, p.id]);
    }
    cand.sort((a, b) => b[0] - a[0]);
    E.ids = cand.slice(0, want).map(c => c[1]);
    const kind = E.ids.length >= 2 ? kindOf(E.era) : null, offs = [0];
    let o = 0, aOff = -1;
    for (let k = 1; k < E.ids.length; k++) {
      o += k === 2 && kind ? (kind === 'cart' ? 0.27 : 0.29) : GAP;
      offs.push(o);
      if (k === 1 && kind) { aOff = o + (kind === 'cart' ? 0.34 : 0.3); o = aOff; }
    }
    Object.assign(E, { kind, offs, aOff, col: Math.max(o, aOff + 0.15) });
  }

  // Jedes Bild: Leute, Tier, Lager, Feuer. frac = Bruchteil des laufenden Spieltags, t = Uhr in Sekunden
  update(st, frac, t, o = {}) {
    const P = this.people, figs = P.figs, VD = o.vdays || 6;
    const T = st.day + frac, f = todOf(T, VD);
    const dt = this.lastClock == null ? 0 : clamp(t - this.lastClock, 0, 0.2);
    const dT = this.lastT == null ? 0 : T - this.lastT;
    this.lastClock = t; this.lastT = T;
    const gs = dt > 0 && dT > 0 ? clamp(dT * DAY_SECONDS / dt, 0, 12) : 0; // Spieltempo (1, 3, 10)
    const vWalk = V / DAY_SECONDS * gs; // Felder je Sekunde
    this.frame++;
    const rt = st._rt, cam = this.stage.camera.position, night = o.night || 0;
    const show = !P.hidden && !o.fast && figs.length > 0;
    const far2 = !show || cam.y > 75 ? 0 : Math.min(80, 14 + cam.y * 1.5) ** 2;
    const fire2 = show ? FIRE_FAR * FIRE_FAR : 0;
    const camp = f < W0 || f >= W1, fk = fireK(f);
    const wNow = walked(T, VD);
    this.away.clear();
    const S = this.stat; S.active = 0; S.shown = 0; S.camps = 0; S.people = 0;
    const cnt = { cart: 0, ox: 0, horse: 0, mule: 0 };
    let nLeg = 0, nPit = 0, nFlame = 0, nPool = 0, nGlint = 0, nLab = 0, drew = false;

    const R = { x: 0, z: 0, dx: 0, dz: 0, dir: 1, ph: '', fx: 0, fz: 0, k: 0 };
    let canvasRect = null;
    for (const tr of st.treks || []) {
      const key = tr.a + ':' + tr.d;
      let E = this.cache.get(key);
      if (!E) { E = this.make(st, tr, VD); this.cache.set(key, E); }
      E.seen = this.frame;
      if (E.bad) continue;
      const s = V * (wNow - E.w0);
      if (!(s > 0 && s < E.end)) continue;
      if (!E.ids) this.crew(st, E);
      E.act = this.frame;
      const ppl = [];
      for (const id of E.ids) { const p = rt.pById.get(id); if (p && p.s === E.a && !p.away) ppl.push(p); }
      if (!ppl.length) continue;
      S.active++;
      for (const p of ppl) this.away.add(p.id);
      // Mitte der Gruppe, Lagerplatz (neben dem Pfad, nicht im Wasser)
      fold(E, s + E.col * 0.5, R);
      let mx = R.x, mz = R.z, cx = mx - R.fz * CAMP_SIDE, cz = mz + R.fx * CAMP_SIDE;
      if (camp) {
        const ck = Math.round(s * 100);
        if (E.ck !== ck) { E.ck = ck; E.camp = this.campSpot(st, E, s + E.col * 0.5); }
        [cx, cz, mx, mz] = E.camp;
      }
      const aGap = Math.atan2(cz - mz, cx - mx);
      const gy = groundY(mx, mz);
      const d2 = (mx - cam.x) ** 2 + (gy - cam.y) ** 2 + (mz - cam.z) ** 2;
      const near = d2 < far2;
      // Wer nicht gezeichnet wird, steht trotzdem in people.pos (Klick in Listen fliegt hin)
      if (!near) {
        for (let k = 0; k < ppl.length; k++) {
          const p = ppl[k];
          this.ms.delete(p.id);
          if (camp) P.pos.set(p.id, [cx, groundY(cx, cz), cz]);
          else { fold(E, s + E.col - E.offs[k], R); P.pos.set(p.id, [R.x, groundY(R.x, R.z), R.z]); }
        }
        E.an = null;
      }
      // Lagerfeuer (auch von weitem: Schein in der Nacht)
      if (camp && show) {
        S.camps++;
        const cy = groundY(cx, cz);
        const dc2 = (cx - cam.x) ** 2 + (cy - cam.y) ** 2 + (cz - cam.z) ** 2;
        if (dc2 < far2 * 1.6 && nPit < MAXT) { compose(_m, cx, cy, cz, E.h * 6.28, 0, 1); this.pit.setMatrixAt(nPit++, _m); }
        if (fk > 0.01 && dc2 < far2 * 1.6 && nFlame < MAXT * 2 - 1) {
          const fl = 1 + 0.22 * Math.sin(t * 13.1 + E.h * 40) + 0.12 * Math.sin(t * 23.7 + E.h * 9), w = 1 + 0.1 * Math.sin(t * 17.3 + E.h * 3);
          _e.set(0, t * 0.7 + E.h * 6, 0); _q.setFromEuler(_e);
          _m.compose(_p.set(cx, cy + 0.006, cz), _q, _s.set(fk * w * 1.3, fk * fl * 1.3, fk * w * 1.3)); this.flame.setMatrixAt(nFlame, _m);
          this.flame.instanceColor.setXYZ(nFlame++, 2.6, 0.95 + 0.2 * fk, 0.28);
          _m.compose(_p.set(cx, cy + 0.01, cz), _q, _s.set(fk * 0.6 * 1.3, fk * fl * 0.72 * 1.3, fk * 0.6 * 1.3)); this.flame.setMatrixAt(nFlame, _m);
          this.flame.instanceColor.setXYZ(nFlame++, 3.0, 2.1, 0.9);
          // Funken und etwas Rauch nahe der Kamera
          if (this.fx && dc2 < 1600) {
            if (Math.random() < dt * 5 * fk) this.fx.glow.emit({ x: cx + (Math.random() - 0.5) * 0.04, y: cy + 0.08, z: cz + (Math.random() - 0.5) * 0.04, vx: (Math.random() - 0.5) * 0.06, vy: 0.22 + Math.random() * 0.2, vz: (Math.random() - 0.5) * 0.06, life: 0.9 + Math.random() * 0.8, size: 0.022, c: [1, 0.62, 0.25], a: 0.95, drag: 0.97 });
            if (Math.random() < dt * 1.6) this.fx.smoke.emit({ x: cx, y: cy + 0.16, z: cz, vy: 0.1, vx: 0.02, life: 3, size: 0.07, grow: 2.2, c: [0.55, 0.55, 0.58], a: 0.18 });
          }
        } else if (this.fx && f >= WAKE && f < W0 && dc2 < 1600 && Math.random() < dt * 1.5) {
          this.fx.smoke.emit({ x: cx, y: cy + 0.05, z: cz, vy: 0.08, vx: 0.015, life: 3, size: 0.06, grow: 2, c: [0.6, 0.6, 0.62], a: 0.2 }); // die Glut qualmt aus
        }
        if (fk > 0.01 && nPool < MAXT && dc2 < far2 * 2.5) {
          // Lichtfleck liegt schräg wie der Hang und etwas darüber, sonst schneidet das Gelände harte Kanten hinein
          const sz = 0.5 + 0.9 * fk * (1 + 0.06 * Math.sin(t * 11 + E.h * 20)), r = sz * 0.4;
          const sx = (groundY(cx + r, cz) - groundY(cx - r, cz)) / (2 * r), sz2 = (groundY(cx, cz + r) - groundY(cx, cz - r)) / (2 * r);
          _e.set(-Math.atan(sz2), 0, Math.atan(sx), 'XYZ'); _q.setFromEuler(_e);
          _m.compose(_p.set(cx, cy + 0.035, cz), _q, _s.set(sz, 1, sz)); this.pool.setMatrixAt(nPool++, _m);
        }
        if (fk > 0.01 && night > 0.2 && nGlint < MAXT && dc2 < fire2) {
          this.gPos[nGlint * 3] = cx; this.gPos[nGlint * 3 + 1] = cy + 0.55; this.gPos[nGlint * 3 + 2] = cz;
          this.gA[nGlint++] = fk * clamp((night - 0.2) * 2) * (0.85 + 0.15 * Math.sin(t * 9 + E.h * 30));
        }
      }
      if (!near) continue;
      S.shown++;
      // ---- Menschen ----
      const n = ppl.length, ni = Math.floor(T / VD + 0.3 + 0.5), watch = ni % n;
      const teller = n > 2 ? 1 : 0, singing = hash(E.a + ni, Math.floor(t / 11)) < 0.18;
      let lx = 0, lz = 0, ly = 0;
      for (let k = 0; k < n; k++) {
        const p = ppl[k], sc = figureScale(p, false, false), body = HEIGHT * sc;
        let gx, gz, mode = 'idle', hx = 0, hz = 1, lie = false, trunk = null;
        if (camp) {
          const a = aGap + 0.6 + (Math.PI * 2 - 1.2) * (k + 0.5) / n, ca = Math.cos(a), sa = Math.sin(a);
          hx = -ca; hz = -sa; // zum Feuer
          if (f >= W1 && f < FIRE_ON) { // Lager aufschlagen: einer sammelt Holz am Feuer, einer kümmert sich ums Tier
            if (k === 0) { gx = cx + ca * 0.11; gz = cz + sa * 0.11; mode = 'pickup'; }
            else if (k === 1 && E.kind) { gx = cx + Math.cos(aGap) * (R_ANIMAL - 0.16); gz = cz + Math.sin(aGap) * (R_ANIMAL - 0.16); mode = 'idle'; hx = Math.cos(aGap); hz = Math.sin(aGap); }
            else { gx = cx + ca * R_SIT; gz = cz + sa * R_SIT; mode = 'chat'; }
          } else if (f >= FIRE_ON && f < EMBER) { // am Feuer sitzen, einer erzählt, manchmal wird gesungen
            gx = cx + ca * R_SIT; gz = cz + sa * R_SIT;
            mode = k === teller && hash(E.a * 3 + k, Math.floor(t / 9)) < 0.45 ? 'chat' : singing && k === n - 1 ? 'cheer' : 'floor';
          } else if (f >= EMBER || f < WAKE) { // schlafen, die Füße zum Feuer, einer hält Wache
            if (k === watch) { gx = cx + ca * R_SIT; gz = cz + sa * R_SIT; mode = 'floor'; }
            else { gx = cx + ca * R_SLEEP; gz = cz + sa * R_SLEEP; mode = 'sleep'; lie = true; }
          } else { // Morgen: aufstehen, das Feuer löschen, packen
            gx = cx + ca * (k === 0 ? 0.11 : R_SIT + 0.04); gz = cz + sa * (k === 0 ? 0.11 : R_SIT + 0.04);
            mode = k === 0 ? 'pickup' : k === 1 && E.kind ? 'pickup' : 'idle';
          }
          if (mode === 'floor') trunk = figFor(figs, p).trunk?.floor;
        } else {
          fold(E, s + E.col - E.offs[k], R);
          hx = R.fx; hz = R.fz;
          if (R.ph === 'stay' || R.ph === 'home') { // am Ziel kurz stehen und schauen, am Ende zu Hause zusammenkommen
            const lat = (k - (n - 1) / 2) * 0.14, back = R.ph === 'stay' ? 0.05 * k : 0;
            gx = R.x - R.fz * lat - R.fx * back; gz = R.z + R.fx * lat - R.fz * back;
            mode = R.ph === 'stay' ? (k === 0 && R.k < 0.6 ? 'cheer' : k === n - 1 ? 'pickup' : 'idle') : 'idle';
            if (R.ph === 'home') { hx = -R.fx; hz = -R.fz; }
          } else { // gehen, mit Rechtsverkehr leicht versetzt
            const lat = 0.045 + (k % 2) * 0.035;
            gx = R.x - R.fz * lat; gz = R.z + R.fx * lat;
            mode = gs > 0 ? 'walk' : 'idle';
          }
        }
        // Rumpf der Sitzpose auf den Platz setzen (wie in der Innenansicht)
        if (trunk) {
          const ry = Math.atan2(hx, hz), c = Math.cos(ry), sn = Math.sin(ry);
          gx -= (trunk[0] * c + trunk[1] * sn) * body; gz -= (-trunk[0] * sn + trunk[1] * c) * body;
        }
        // weich nachführen: wer seinen Platz wechselt, geht dorthin
        let M = this.ms.get(p.id);
        if (!M || M.f < this.frame - 2 || Math.hypot(gx - M.x, gz - M.z) > 3) { M = { x: gx, z: gz, h: Math.atan2(hx, hz), f: 0 }; this.ms.set(p.id, M); }
        M.f = this.frame;
        const ddx = gx - M.x, ddz = gz - M.z, dd = Math.hypot(ddx, ddz);
        let v = mode === 'walk' ? vWalk : 0;
        if (dd > 0.02 && gs > 0) {
          const step = Math.min(dd, Math.max(vWalk * 1.35, 0.21 * gs) * dt);
          M.x += ddx / dd * step; M.z += ddz / dd * step;
          mode = 'walk'; v = step / Math.max(dt, 1e-4); hx = ddx; hz = ddz; lie = false;
        } else if (dd > 0 && dd <= 0.02) { M.x = gx; M.z = gz; }
        const want = Math.atan2(hx, hz);
        M.h += wrapPi(want - M.h) * Math.min(1, dt * (lie ? 4 : 9));
        const x = M.x, z = M.z, y = groundY(x, z) + (lie ? 0.006 : 0);
        P.pos.set(p.id, [x, y, z]);
        if (k === 0) { lx = x; lz = z; ly = y; }
        if (o.selId === p.id) { P.ring.visible = true; P.ring.position.set(x, y + 0.02, z); P.ring.scale.setScalar(1 + Math.sin(t * 4) * 0.12); }
        if (P.heroId === p.id) { P.heroMark.visible = true; P.heroMark.position.set(x, y + HEIGHT * 1.35 + Math.sin(t * 2.5) * 0.015, z); P.heroMark.rotation.y = t * 1.5; }
        const F = figFor(figs, p);
        if (F.n >= F.max) continue;
        this.o.position.set(x, y, z);
        this.o.rotation.set(0, M.h, 0);
        this.o.scale.setScalar(body);
        this.o.updateMatrix();
        const rate = mode === 'walk' ? clamp((v || vWalk || 0.21) / (STRIDE * body), 0.5, 4) : 1;
        const ni2 = drawPerson(F, p, this.o.matrix, mode, rate, false, false);
        drew = true; S.people++;
        // Feuerschein ohne echtes Licht (ein Punktlicht kostet jedes Bild überall): wer nah am Feuer ist, wird warm und
        // heller. Die Farben stehen als sRGB in den Instanzen, der Shader quadriert sie, darum kleine Faktoren
        if (camp && fk > 0.01 && night > 0.15) {
          const w = fk * clamp((night - 0.15) * 1.6) * clamp(1.6 - Math.hypot(x - cx, z - cz) * 2.4) * (0.92 + 0.08 * Math.sin(t * 12.7 + E.h * 40));
          if (w > 0.01) for (const a of [F.aSkin.array, F.aHair.array, F.aShirt.array, F.aPants.array]) {
            a[ni2 * 3] *= 1 + 0.75 * w; a[ni2 * 3 + 1] *= 1 + 0.38 * w; a[ni2 * 3 + 2] *= 1 - 0.1 * w;
          }
        }
      }
      // ---- Packtier oder Handkarren ----
      if (E.kind && cnt[E.kind] < MAXT) {
        let gx, gz, hx, hz, walking = false;
        if (camp) {
          gx = cx + Math.cos(aGap) * R_ANIMAL; gz = cz + Math.sin(aGap) * R_ANIMAL;
          hx = -Math.sin(aGap); hz = Math.cos(aGap); // quer zum Feuer
        } else {
          fold(E, s + E.col - E.aOff, R);
          hx = R.fx; hz = R.fz;
          if (R.ph === 'stay' || R.ph === 'home') { gx = R.x - R.fz * 0.28 - R.fx * 0.12; gz = R.z + R.fx * 0.28 - R.fz * 0.12; }
          else { gx = R.x; gz = R.z; walking = gs > 0; }
        }
        let A = E.an;
        if (!A || A.f < this.frame - 2 || Math.hypot(gx - A.x, gz - A.z) > 3) A = E.an = { x: gx, z: gz, yaw: Math.atan2(-hz, hx), ph: 0, amp: 0, f: 0 };
        A.f = this.frame;
        const ddx = gx - A.x, ddz = gz - A.z, dd = Math.hypot(ddx, ddz);
        let moved = 0;
        if (dd > 0.02 && gs > 0) {
          const step = Math.min(dd, Math.max(vWalk * 1.35, 0.21 * gs) * dt);
          A.x += ddx / dd * step; A.z += ddz / dd * step; moved = step; hx = ddx; hz = ddz;
        } else { moved = Math.min(dd, 0.5); A.x = gx; A.z = gz; }
        if (walking && moved < 1e-5) moved = vWalk * dt;
        A.yaw += wrapPi(Math.atan2(-hz, hx) - A.yaw) * Math.min(1, dt * 5);
        A.ph += moved / (0.105 * ANIMAL) * Math.PI;
        A.amp += ((moved > 1e-4 ? 0.45 : 0) - A.amp) * Math.min(1, dt * 6);
        const c = Math.cos(A.yaw), sn = Math.sin(A.yaw), fo = 0.12;
        const yf = groundY(A.x + c * fo, A.z - sn * fo), yb = groundY(A.x - c * fo, A.z + sn * fo);
        const pitch = Math.atan2(yf - yb, 2 * fo), bob = Math.abs(Math.sin(A.ph)) * 0.006 * A.amp / 0.45;
        const ay = (yf + yb) * 0.5 + (E.kind === 'cart' ? 0.004 : bob);
        compose(_m, A.x, ay, A.z, A.yaw, pitch, 1);
        const mesh = this.body[E.kind];
        mesh.setMatrixAt(cnt[E.kind]++, _m);
        if (E.kind !== 'cart' && nLeg < MAXT * 4 - 3) {
          const o2 = PACK[E.kind], sw = Math.sin(A.ph) * A.amp;
          _c.set(o2.dark);
          compose(_m, A.x, ay, A.z, A.yaw, pitch, ANIMAL);
          for (const [lx2, lz2, sg] of [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]) {
            _l.makeRotationZ(sw * sg); _l.setPosition(o2.L * 0.32 * lx2, 0.075, o2.H * 0.24 * lz2);
            this.legs.setMatrixAt(nLeg, _l.premultiply(_m));
            this.legs.instanceColor.setXYZ(nLeg++, _c.r, _c.g, _c.b);
          }
        }
      }
      // ---- Schild über dem Zug, wenn die Kamera nah ist ----
      if (o.labels && d2 < 38 * 38 && cam.y < 60 && nLab < 4) {
        if (!canvasRect) canvasRect = this.stage.renderer.domElement.getBoundingClientRect();
        const ph = camp ? (fk > 0 && f >= FIRE_ON && f < EMBER ? L('Nachtlager am Feuer', 'night camp by the fire') : f >= WAKE && f < W0 ? L('brechen das Lager ab', 'breaking camp') : camp && f >= W1 && f < FIRE_ON ? L('schlagen ein Lager auf', 'making camp') : L('schlafen am Feuer', 'asleep by the fire'))
          : (fold(E, s + E.col, R), R.ph === 'stay' ? L('am Rand des Bekannten, sie kehren um', 'at the edge of the known, turning back') : R.ph === 'out' ? L('ziehen ins Unbekannte', 'heading into the unknown') : L('auf dem Heimweg', 'heading home'));
        this.label(nLab++, `${L('Kundschafter aus', 'Scouts from')} ${E.name}`, ph, lx, ly + 0.62, lz, canvasRect, d2);
      }
    }
    // Instanzen abschließen (leere ganz aus, dann kosten sie nichts, auch nicht im Schatten)
    const fin = (m, n) => { m.count = n; m.visible = n > 0; if (n) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; } };
    for (const k in this.body) fin(this.body[k], cnt[k]);
    fin(this.legs, nLeg); fin(this.pit, nPit); fin(this.flame, nFlame); fin(this.pool, nPool);
    this.poolMat.uniforms.uA.value = clamp(0.12 + night * 0.4, 0, 0.45);
    const g = this.glint.geometry;
    this.glint.visible = nGlint > 0;
    g.setDrawRange(0, nGlint);
    if (nGlint) { g.attributes.position.needsUpdate = true; g.attributes.alpha.needsUpdate = true; }
    const cmr = this.stage.camera, h = this.stage.renderer.domElement.height;
    this.glint.material.uniforms.scale.value = h / 2 / Math.tan(THREE.MathUtils.degToRad(cmr.fov / 2));
    // Die Figuren der Kundschafter hängen hinten an den Instanzen von people.js: Zahl und Daten neu hochladen
    if (drew) for (const F of figs) {
      for (const a of [F.aAnim, F.aSkin, F.aHair, F.aShirt, F.aPants]) a.clearUpdateRanges();
      F.end();
    }
    for (let i = nLab; i < this.labels.length; i++) if (this.labels[i]._o !== 0) { this.labels[i]._o = 0; this.labels[i].style.opacity = 0; }
    // Vergessen, was es nicht mehr gibt
    if (this.frame % 240 === 0) {
      for (const [k, E] of this.cache) if (E.seen < this.frame - 1) this.cache.delete(k);
      for (const [id, M] of this.ms) if (M.f < this.frame - 60) this.ms.delete(id);
    }
  }

  // Lagerplatz für die Nacht (einmal je Halt berechnet): erst rechts, dann links vom Pfad, immer weiter weg, notfalls
  // ein Stück zurück oder voraus, bis der Boden trocken ist; lieber auf einer Lichtung, im dichten Wald auch zwischen
  // den Bäumen. Rückgabe [Feuer x, z, Pfadpunkt x, z]
  campSpot(st, E, q) {
    const R = {};
    for (const clear of [true, false]) for (const back of [0, -1.2, 1.2, -2.4, 2.4]) {
      fold(E, Math.max(0, q + back), R);
      for (const d of [CAMP_SIDE, -CAMP_SIDE, 0.7, -0.7, 1.2, -1.2, 1.8, -1.8]) {
        const x = R.x - R.fz * d, z = R.z + R.fx * d;
        if (this.dry(st, x, z, clear)) return [x, z, R.x, R.z];
      }
    }
    fold(E, q, R);
    return [R.x - R.fz * CAMP_SIDE, R.z + R.fx * CAMP_SIDE, R.x, R.z];
  }

  // Trocken genug für ein Lager? Das gezeichnete Flussband ist bis zu 1,5 Felder breit, das Lager mit den Schlafenden
  // rund 0,9: Abstand zu Flussfeldern 1,3, zu Meer und See 0,9 (sonst liegen sie halb unter Wasser oder Eis)
  dry(st, X, Z, clear = false) {
    const T = st.tiles, fx = X + NX / 2 - 0.5, fz = Z + NY / 2 - 0.5, x0 = Math.round(fx), y0 = Math.round(fz);
    for (let y = y0 - 2; y <= y0 + 2; y++) for (let x = x0 - 2; x <= x0 + 2; x++) {
      if (x < 0 || y < 0 || x >= NX || y >= NY) return false;
      const i = y * NX + x, d = Math.hypot(x - fx, y - fz);
      if ((T.river && T.river[i] && d < 1.3) || (T.h[i] < 0 && d < 0.9) || (clear && d < 1.05 && (this.treeCount ? this.treeCount(T, i, x, y) : T.tree[i]))) return false;
    }
    return true;
  }

  label(i, title, sub, x, y, z, rect, d2) {
    if (i === 0) this.placed = [];
    let el = this.labels[i];
    if (!el) {
      el = document.createElement('div');
      el.className = 'rlabel';
      el.style.fontSize = '12.5px'; el.style.textAlign = 'center'; el.style.lineHeight = '1.25';
      el.innerHTML = '<b style="font-weight:600"></b><br><small style="font-size:11px;opacity:0.8"></small>';
      (document.querySelector('#labels') || document.body).append(el);
      this.labels[i] = el;
    }
    if (el._t !== title) { el._t = title; el.firstChild.textContent = title; el._w = 0; }
    if (el._s !== sub) { el._s = sub; el.lastChild.textContent = sub; el._w = 0; }
    if (!el._w) { el._w = el.offsetWidth; el._h = el.offsetHeight; }
    _p.set(x, y, z).project(this.stage.camera);
    const vis = _p.z < 1 && Math.abs(_p.x) < 1.05 && Math.abs(_p.y) < 1.05;
    if (!vis) { if (el._o !== 0) { el._o = 0; el.style.opacity = 0; } return; }
    const sx = (_p.x + 1) / 2 * rect.width;
    let sy = (1 - _p.y) / 2 * rect.height;
    // zwei Züge dicht beieinander: das zweite Schild rückt nach oben
    for (let g = 0; g < 4 && this.placed.some(([x2, y2]) => Math.abs(x2 - sx) < 170 && Math.abs(y2 - sy) < 34); g++) sy -= 34;
    this.placed.push([sx, sy]);
    const zf = this.zoneFade ? this.zoneFade(sx - el._w / 2, sy - el._h, sx + el._w / 2, sy) : 1;
    const op = Math.round(clamp((38 - Math.sqrt(d2)) / 8) * zf * 20) / 20 * 0.95;
    if (el._o !== op) { el._o = op; el.style.opacity = op; }
    el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
  }
}
