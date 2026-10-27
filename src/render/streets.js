// Echte Straßen (seit 18.10.2026). Je Ort ein Straßennetz: vom Platz aus wird jede Haustür auf dem kürzesten Weg
// angeschlossen, bevorzugt über den Straßenplan (sim/streets.js) und schon gebaute Straßen. So entstehen Hauptstraßen,
// Gassen und kurze Wege bis vor jede Tür. Dazu die Landstraßen zwischen den Orten (st.links).
// Gezeichnet als Bänder auf dem Gelände in zwei Lagen: unten der Rand (Bordstein, Kante), oben die Fahrbahn.
// Feldweg mit Spurrillen und weichem Rand, Pflaster mit Steinen und Bordstein, ab der Industrie Asphalt mit Gehweg
// und Mittellinie. Das Netz (tile: 1 Fußweg, 2 Straße, 3 Hauptstraße) nutzen auch Menschen und Fahrzeuge.
import * as THREE from 'three';
import { NX, NY } from './scene.js';
import { groundY } from './terrain.js';
import { patch } from './mats.js';
import { streetPlan } from '../sim/streets.js';
import { frontOf } from '../sim/cityplan.js';
import { getNet, netSig, WIDTH } from './roadnet.js';

const OPEN = new Set(['feld', 'park', 'zentrum']);
// große Bauten, die über ihr Feld hinausragen: keine Gasse an ihren Kanten
const BIG = new Set(['burg', 'rakete', 'kathedrale', 'palast', 'stadion', 'arena', 'oper', 'universitaet', 'bahnhof', 'museum', 'krankenhaus', 'werft']);
const wx = x => x - NX / 2 + 0.5, wz = y => y - NY / 2 + 0.5;

const HEAD = `attribute vec4 aRoad; varying vec4 vRoad;`;
const FRAG_HEAD = `varying vec4 vRoad; uniform vec3 uDirt, uDirtDark, uGrassRd, uCobble, uCobbleGap, uCurb, uAsphalt, uWalk, uLine;
float rh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(rh(i), rh(i + vec2(1., 0.)), f.x), mix(rh(i + vec2(0., 1.)), rh(i + vec2(1., 1.)), f.x), f.y); }
`;
// vRoad: x quer (-1..1), y längs (Felder), z Stufe (1 Feldweg, 2 Pflaster, 3 Asphalt, +0.5 Fußweg),
// w Merkmale (seit 24.10.2026): ganzzahlig 1 Mittellinie, 2 Gehweg, der Bruchteil ist die Bordsteinkante quer (|x| ab dort Gehweg)
const FRAG = (curb) => `{
  float u = abs(vRoad.x), v = vRoad.y, lvl = floor(vRoad.z + 0.01), foot = step(0.4, fract(vRoad.z));
  float fl = floor(vRoad.w + 0.002), edge = vRoad.w - fl, line = step(0.5, mod(fl, 2.0)), side = step(1.5, fl);
  float walkM = side * step(edge - 0.004, u), kerb = side * (1.0 - smoothstep(0.0, 0.035, u - edge + 0.004)) * walkM;
  vec2 xz = vWPos.xz;
  float px = length(fwidth(xz)), fine = 1.0 - smoothstep(0.04, 0.14, px);
  float n = rn(xz * 3.1), n2 = rn(xz * 11.0 + 3.0);
  vec3 c; float a = 1.0;
  ${curb ? `
  if (lvl < 1.5) discard;
  c = uCurb * (0.88 + n * 0.2);
  a = smoothstep(1.0, 0.9, u);
  ` : `
  if (lvl < 1.5) {
    // Feldweg: helle Mitte mit Grasstreifen, zwei Spurrillen, weicher Rand ins Gras
    c = uDirt * (0.9 + n * 0.18);
    if (foot < 0.5) { c = mix(c, uDirtDark, smoothstep(0.16, 0.0, abs(u - 0.52)) * 0.45 * fine); c = mix(c, uGrassRd, smoothstep(0.16, 0.0, u) * 0.5); }
    a = 1.0 - smoothstep(0.55, 1.0, u + (n - 0.5) * 0.35);
  } else if (lvl < 2.5) {
    // Pflaster: versetzte Steine, Fugen, leicht gewölbte Mitte
    vec2 q = xz * (foot > 0.5 ? 5.0 : 6.5); q.x += step(1.0, mod(floor(q.y), 2.0)) * 0.5;
    vec2 id = floor(q), f = fract(q) - 0.5;
    float g = smoothstep(0.3, 0.47, max(abs(f.x), abs(f.y)));
    c = uCobble * (0.82 + rh(id) * 0.3);
    c = mix(c, uCobbleGap, g * fine * 0.85);
    c *= 1.04 - u * 0.1;
    if (walkM > 0.5) {
      // Gehweg: große helle Platten, am Rand der Fahrbahn ein Bordstein
      vec2 qq = xz * 2.6; qq.x += step(1.0, mod(floor(qq.y), 2.0)) * 0.5;
      vec2 ff = fract(qq) - 0.5; float gg = smoothstep(0.42, 0.49, max(abs(ff.x), abs(ff.y)));
      c = uWalk * (0.9 + rh(floor(qq)) * 0.12) * (1.0 - gg * 0.2 * fine);
      c = mix(c, uCurb * 1.12, kerb);
    }
    a = smoothstep(1.0, 0.93, u);
  } else {
    // Asphalt mit Gehweg am Rand (in den Orten) und gestrichelter Mittellinie (lange Straßen)
    c = uAsphalt * (0.9 + n * 0.12 + (n2 - 0.5) * 0.08 * fine);
    if (foot > 0.5) c = uWalk * (0.92 + n * 0.1);
    if (walkM > 0.5) { vec2 q = xz * 3.2; vec2 f = fract(q) - 0.5; float g = smoothstep(0.44, 0.49, max(abs(f.x), abs(f.y))); c = uWalk * (0.93 + n * 0.08) * (1.0 - g * 0.18 * fine); c = mix(c, uCurb * 1.15, kerb); }
    // gestrichelte Mittellinie zwischen den beiden Spuren (Rechtsverkehr), am Bordstein eine feine Randlinie
    float mark = line * step(u, 0.03) * step(fract(v * 1.4), 0.5);
    mark = max(mark, side * (1.0 - walkM) * smoothstep(edge - 0.07, edge - 0.05, u) * (1.0 - smoothstep(edge - 0.035, edge - 0.02, u)) * 0.6);
    c = mix(c, uLine, mark * fine);
    a = smoothstep(1.0, 0.95, u);
  }
  `}
  diffuseColor.rgb = c;
  diffuseColor.a = a;
}`;

function material(curb, uni) {
  const m = patch(new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: curb ? -3 : -4, polygonOffsetUnits: curb ? -3 : -4 }), { snow: 0.45 }); // festgetretener Schnee: weniger als auf der Wiese
  const base = m.onBeforeCompile;
  m.onBeforeCompile = sh => {
    base(sh);
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = HEAD + '\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vRoad = aRoad;');
    sh.fragmentShader = FRAG_HEAD + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG(curb));
  };
  m.customProgramCacheKey = () => 'street-' + (curb ? 'c' : 's');
  return m;
}

// kleiner Binärheap für die Wegsuche
class Heap {
  constructor() { this.a = []; }
  push(f, n) { const a = this.a; a.push([f, n]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

// Chaikin (zweimal, Enden bleiben): wie bei den Fahrzeugen, damit sie auf der Fahrbahn bleiben
function chaikin(pts, passes = 2) {
  let p = pts;
  for (let k = 0; k < passes; k++) {
    if (p.length < 3) return p;
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, a[2] * 0.75 + b[2] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, a[2] * 0.25 + b[2] * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

export class Streets {
  constructor(scene) {
    this.scene = scene;
    this.tile = new Uint8Array(NX * NY);
    this.towns = new Map(); // Ort → { sig, mesh: [unten, oben], tiles }
    this.links = null; this.linkSig = '';
    const C = h => new THREE.Color(h);
    this.uni = {
      uDirt: { value: C('#cdb38a') }, uDirtDark: { value: C('#9c8462') }, uGrassRd: { value: C('#9fb46a') },
      uCobble: { value: C('#cbbfab') }, uCobbleGap: { value: C('#867c6e') }, uCurb: { value: C('#a39b8f') },
      uAsphalt: { value: C('#5f6166') }, uWalk: { value: C('#cfcac0') }, uLine: { value: C('#f2efe6') },
    };
    this.matCurb = material(true, this.uni);
    this.matTop = material(false, this.uni);
    this.facing = null;
    this.version = 0;
    this.doorSide = new Map(); // Gebäude → Türseite (zur Straße), buildings.facing nutzt das
  }

  reset() {
    for (const T of this.towns.values()) this.dropTown(T);
    this.towns.clear();
    if (this.links) for (const m of this.links) { this.scene.remove(m); m.geometry.dispose(); }
    this.links = null; this.linkSig = ''; this.linkTiles = []; this.linkSegs = [];
    this.seg = null; this.segGrid = null;
    this.tile.fill(0);
    this.doorSide.clear();
  }

  // Tür eines Gebäudes: Feld davor und Punkt an der Hauswand (wie people.door)
  // Ist das Feld vor der Tür zugebaut, führt der Weg von der nächsten freien Seite (zum Platz hin) weg
  door(st, b) {
    const X = wx(b.x), Z = wz(b.y);
    if (OPEN.has(b.t) || !this.facing) return null;
    const rt = st._rt, H = st.tiles.h;
    const free = (x, y) => { if (x < 1 || y < 1 || x >= NX - 1 || y >= NY - 1) return false; const j = y * NX + x; if (H[j] < 0 || H[j] > 3) return false; const id = rt.bldAt[j]; if (!id) return true; const o = rt.bById.get(id); return !o || OPEN.has(o.t); };
    const ry = this.facing(st, b);
    let sx = Math.round(Math.sin(ry)), sz = Math.round(Math.cos(ry));
    if (!free(b.x + sx, b.y + sz)) {
      const s = rt.sById.get(b.s);
      let best = null, bd = 1e9;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!free(b.x + dx, b.y + dy)) continue;
        const d = s ? Math.hypot(b.x + dx - s.cx, b.y + dy - s.cy) : 0;
        if (d < bd) { bd = d; best = [dx, dy]; }
      }
      if (!best) return null;
      [sx, sz] = best;
    }
    return { tx: b.x + sx, ty: b.y + sz, X: X + sx * 0.4, Z: Z + sz * 0.4 };
  }

  sync(st) {
    let changed = false;
    const alive = new Set();
    for (const s of st.settlements) {
      if (!s.alive) continue;
      alive.add(s.id);
      let sig = s.era + ':' + Math.round(s.R * 2) + ':' + (s.plan ? s.plan.bv : 0);
      for (const b of st.buildings) if (b.s === s.id && b.prog > 0.05) sig += ',' + b.id;
      const T = this.towns.get(s.id);
      if (T && T.sig === sig) continue;
      this.buildTown(st, s, sig);
      changed = true;
    }
    for (const [id, T] of this.towns) if (!alive.has(id)) { this.dropTown(T); this.towns.delete(id); changed = true; }
    const ls = netSig(st);
    if (ls !== this.linkSig) { this.linkSig = ls; this.buildLinks(st); changed = true; this.netChanged = true; }
    if (changed) { this.version++; this.mask(); }
    return changed;
  }

  dropTown(T) {
    for (const m of T.mesh || []) { this.scene.remove(m); m.geometry.dispose(); }
  }

  // Straßenfelder für Menschen, Fahrzeuge und das Gelände neu zusammensetzen
  mask() {
    const M = this.tile;
    M.fill(0);
    for (const T of this.towns.values()) for (const [i, v] of T.tiles) if (v > M[i]) M[i] = v;
    for (const i of this.linkTiles || []) M[i] = 3;
    this.index();
  }

  // Register aller Straßenstücke je Feld (seit 24.10.2026): für die Gehwegregel, die Höhe auf der Straße und die Spuren
  index() {
    const all = [];
    for (const T of this.towns.values()) if (T.segs) for (let i = 0; i < T.segs.length; i++) all.push(T.segs[i]);
    for (const v of this.linkSegs || []) all.push(v);
    const S = this.seg = new Float32Array(all), G = this.segGrid = new Map();
    for (let o = 0, i = 0; o < S.length; o += SEG, i++) {
      const hw = S[o + 7] + S[o + 8] + 0.05;
      const x0 = Math.floor(Math.min(S[o], S[o + 2]) - hw + NX / 2), x1 = Math.floor(Math.max(S[o], S[o + 2]) + hw + NX / 2);
      const y0 = Math.floor(Math.min(S[o + 1], S[o + 3]) - hw + NY / 2), y1 = Math.floor(Math.max(S[o + 1], S[o + 3]) + hw + NY / 2);
      for (let y = Math.max(0, y0); y <= Math.min(NY - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(NX - 1, x1); x++) {
        const k = y * NX + x, L = G.get(k);
        if (L) L.push(i); else G.set(k, [i]);
      }
    }
  }

  // Straße an einer Stelle: das Stück im Feld, auf dem (x, z) liegt; an Kreuzungen das, das am besten zur Richtung (dx, dz)
  // passt. Ergebnis (wiederverwendet): lat quer zur Mitte (rechts positiv), nx nz Quernormale nach rechts, tx tz Richtung,
  // cw halbe Fahrbahn, sw Gehweg, hw halbe Gesamtbreite, fl Merkmale (F_WALK Gehweg, F_DRIVE Fahrspuren). Sonst null.
  at(x, z, dx = 0, dz = 0) {
    const G = this.segGrid;
    if (!G) return null;
    const ix = Math.floor(x + NX / 2), iy = Math.floor(z + NY / 2), L = G.get(iy * NX + ix);
    if (!L) return null;
    const S = this.seg, dl = Math.hypot(dx, dz);
    let best = -1, bs = Infinity, blat = 0;
    for (const i of L) {
      const o = i * SEG, hw = S[o + 7] + S[o + 8], tx = S[o + 4], tz = S[o + 5], len = S[o + 6];
      const u = (x - S[o]) * tx + (z - S[o + 1]) * tz;
      if (u < -hw || u > len + hw) continue;
      const uc = u < 0 ? 0 : u > len ? len : u, px = S[o] + tx * uc, pz = S[o + 1] + tz * uc;
      const dist = Math.hypot(x - px, z - pz);
      if (dist > hw) continue;
      const sc = dist - (dl > 1e-6 ? Math.abs(dx * tx + dz * tz) / dl * 0.3 : 0) + (u < 0 || u > len ? 0.05 : 0);
      if (sc < bs) { bs = sc; best = o; blat = (x - px) * -tz + (z - pz) * tx; }
    }
    if (best < 0) return null;
    const q = this.q || (this.q = {}), o = best;
    q.lat = blat; q.tx = S[o + 4]; q.tz = S[o + 5]; q.nx = -S[o + 5]; q.nz = S[o + 4];
    q.cw = S[o + 7]; q.sw = S[o + 8]; q.hw = q.cw + q.sw; q.fl = S[o + 9];
    return q;
  }

  // Höhe über dem Gelände an einer Stelle: auf der Fahrbahn LIFT, auf dem Gehweg dazu der Bordstein, sonst 0
  lift(x, z) {
    const q = this.at(x, z);
    if (!q) return 0;
    return LIFT + (q.sw > 0 && Math.abs(q.lat) > q.cw ? CURB : 0);
  }

  // Netz eines Ortes über Feldecken und Feldmitten: zwischen dicht stehenden Häusern laufen Gassen auf den Feldkanten
  // (die Häuser sind kleiner als ein Feld, die Lücke dazwischen wird zur Gasse), über freie Felder geht es durch die Mitte.
  // Vom Platz aus wird jede Tür (nahe zuerst) auf dem günstigsten Weg angeschlossen; schon gebaute Wege sind billig.
  buildTown(st, s, sig) {
    const old = this.towns.get(s.id);
    if (old) this.dropTown(old);
    const rt = st._rt, T = st.tiles, H = T.h;
    const plan = streetPlan(st, s);
    const M = NX + 1, OFF = M * (NY + 1);
    const R = Math.ceil(Math.max((s.R || 6) + 6, s.plan ? s.plan.ext + 1.5 : 0));
    const x0 = Math.max(1, s.cx - R), x1 = Math.min(NX - 2, s.cx + R), y0 = Math.max(1, s.cy - R), y1 = Math.min(NY - 2, s.cy + R);
    const inBox = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
    const bAt = (x, y) => { const id = rt.bldAt[y * NX + x]; return id ? rt.bById.get(id) : null; };
    const land = (x, y) => { const h = H[y * NX + x]; return h >= 0 && h <= 3; };
    const free = (x, y) => { if (!land(x, y) || T.river[y * NX + x]) return false; const b = bAt(x, y); return !b || b.t === 'zentrum' || b.t === 'park'; };
    const big = (x, y) => { const b = bAt(x, y); return b && (BIG.has(b.t)); };
    // Knoten: Ecke (cx, cy) → cy * M + cx; Mitte (x, y) → OFF + y * NX + x
    const pos = k => (k >= OFF ? [(k - OFF) % NX - NX / 2 + 0.5, (((k - OFF) / NX) | 0) - NY / 2 + 0.5] : [k % M - NX / 2, ((k / M) | 0) - NY / 2]);
    const net = new Map(), use = new Map();
    const center = OFF + s.cy * NX + s.cx;
    net.set(center, -1);
    // Platz: freie Felder nahe der Mitte (Mitten und Ecken) gehören von Anfang an dazu
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (Math.hypot(dx, dy) > 2.7) continue;
      const x = s.cx + dx, y = s.cy + dy;
      if (!inBox(x, y) || !free(x, y)) continue;
      net.set(OFF + y * NX + x, center);
      for (const [ex, ey] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (!net.has((y + ey) * M + x + ex)) net.set((y + ey) * M + x + ex, center);
    }
    const nbrs = (k, out) => {
      out.length = 0;
      if (k >= OFF) {
        const t = k - OFF, x = t % NX, y = (t / NX) | 0;
        for (const [ex, ey] of [[0, 0], [1, 0], [0, 1], [1, 1]]) out.push([(y + ey) * M + x + ex, 0.72 * (plan.has(t) ? 0.6 : 1)]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (!inBox(xx, yy) || !free(xx, yy)) continue;
          const pl = plan.has(t) && plan.has(yy * NX + xx);
          out.push([OFF + yy * NX + xx, (pl ? 0.42 : 0.85) + Math.abs(H[yy * NX + xx] - H[t]) * 0.9]);
        }
      } else {
        const cx = k % M, cy = (k / M) | 0;
        // Kanten zu den Nachbarecken: die beiden Felder links und rechts der Kante entscheiden
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          let ax, ay, bx, by;
          if (dy === 0) { const x = Math.min(cx, nx); ax = x; ay = cy - 1; bx = x; by = cy; } else { const y = Math.min(cy, ny); ax = cx - 1; ay = y; bx = cx; by = y; }
          if (!inBox(ax, ay) || !inBox(bx, by)) continue;
          const la = land(ax, ay), lb = land(bx, by);
          if (!la && !lb) continue;
          if (big(ax, ay) || big(bx, by)) continue;
          const fa = free(ax, ay), fb = free(bx, by);
          let c = fa && fb ? 0.95 : fa || fb ? 1.0 : 1.18;
          if (!la || !lb) c += 0.6; // am Ufer entlang nur ungern
          if (plan.has(ay * NX + ax) || plan.has(by * NX + bx)) c *= 0.75;
          const fA = bAt(ax, ay), fB = bAt(bx, by);
          if ((fA && fA.t === 'feld') || (fB && fB.t === 'feld')) c += 0.35;
          out.push([ny * M + nx, c]);
        }
        // in freie Felder hinein
        for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
          const x = cx + dx, y = cy + dy;
          if (inBox(x, y) && free(x, y)) out.push([OFF + y * NX + x, 0.72 * (plan.has(y * NX + x) ? 0.6 : 1)]);
        }
      }
      return out;
    };
    const lines = [];
    const blds = st.buildings.filter(b => b.s === s.id && b.prog > 0.05 && !OPEN.has(b.t) && inBox(b.x, b.y)).sort((a, b) => Math.hypot(a.x - s.cx, a.y - s.cy) - Math.hypot(b.x - s.cx, b.y - s.cy));
    // Seit 20.10.2026: die gebauten Straßen des Stadtplans (sim/cityplan.js, T.st) liegen fest im Netz. Gezeichnet werden
    // sie als Ketten zwischen Kreuzungen, Breite nach Klasse; Häuser an einer Planstraße drehen die Tür dorthin.
    const pl = this.planStreets(st, s, x0, x1, y0, y1);
    for (const [i, v] of pl.tiles) { net.set(OFF + i, -1); use.set(OFF + i, [0, 1, 4, 14][v & 3] || 1); }
    const fronted = new Set();
    if (pl.tiles.size) for (const b of blds) {
      const k = frontOf(st, b.x, b.y);
      if (k < 0 || b.hh) continue;
      this.doorSide.set(b.id, [Math.PI / 2, -Math.PI / 2, 0, Math.PI][k]);
      fronted.add(b.id);
    }
    // auch die Enden der Landstraßen werden angeschlossen
    const ends = [];
    for (const k of st.links || []) {
      if (!k.path || !(k.a === s.id || k.b === s.id) || !k.built) continue;
      const path = k.a === s.id ? k.path.slice(0, k.built | 0) : k.path.slice(Math.max(0, k.path.length - (k.built | 0))).reverse();
      // erstes Feld außerhalb der Bebauung
      let q = 0;
      while (q < path.length - 1) { const x = path[q] % NX, y = (path[q] / NX) | 0; if (Math.hypot(x - s.cx, y - s.cy) > (s.R || 4) * 0.7 && free(x, y)) break; q++; }
      const i = path[q], x = i % NX, y = (i / NX) | 0;
      if (inBox(x, y) && free(x, y)) ends.push({ x, y });
    }
    const out = [];
    const connect = (starts, anchor, weight, isDoor) => {
      const g = new Map(), came = new Map(), heap = new Heap();
      for (const [k, c] of starts) { if (c < (g.get(k) ?? Infinity)) { g.set(k, c); heap.push(c, k); } }
      let hit = -1, iter = 0;
      while (heap.size && iter++ < 4000) {
        const [gc, cur] = heap.pop();
        if (gc > (g.get(cur) ?? Infinity)) continue;
        if (net.has(cur)) { hit = cur; break; }
        for (const [j, c0] of nbrs(cur, out)) {
          let c = net.has(j) ? c0 * 0.12 : c0; // vorhandene Straßen stark bevorzugen: Wege bündeln sich
          // keine Straße direkt neben einer anderen her (Parallelstraßen): Ecken neben dem Netz kosten extra
          if (!net.has(j) && j < OFF) { const cx = j % M, cy = (j / M) | 0; if (net.has(j + 1) || net.has(j - 1) || net.has(j + M) || net.has(j - M)) c += 0.15; else if (net.has(j + 2) || net.has(j - 2) || net.has(j + 2 * M) || net.has(j - 2 * M)) c += 0.5; void cx; void cy; }
          const ng = gc + c;
          if (ng < (g.get(j) ?? Infinity)) { g.set(j, ng); came.set(j, cur); heap.push(ng, j); }
        }
      }
      if (hit < 0) return;
      const path = [];
      for (let c = hit; c !== undefined; c = came.get(c)) path.push(c);
      path.reverse();
      for (let k = 0; k < path.length - 1; k++) if (!net.has(path[k])) net.set(path[k], path[k + 1]);
      for (let c = path[0], n = 0; c !== -1 && c !== undefined && n < 600; c = net.get(c), n++) use.set(c, (use.get(c) || 0) + weight);
      lines.push({ anchor, path, door: isDoor });
    };
    for (const e of ends) connect([[OFF + e.y * NX + e.x, 0]], null, 10, false);
    // Jedes Haus braucht eine Straße an einer seiner vier Seiten. Liegt schon eine an, ist es angeschlossen (die Tür
    // zeigt dann dorthin, siehe doorSide und buildings.facing). Nur wenn keine anliegt, wird ein Weg gebaut, und der
    // nutzt bevorzugt, was schon da ist. So entstehen wenige, sinnvolle Straßen statt einer Gasse hinter jeder Häuserzeile.
    const SIDES = [[1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2], [0, 1, 0], [0, -1, Math.PI]];
    const corners = (b, dx, dy) => dx === 1 ? [[b.x + 1, b.y], [b.x + 1, b.y + 1]] : dx === -1 ? [[b.x, b.y], [b.x, b.y + 1]] : dy === 1 ? [[b.x, b.y + 1], [b.x + 1, b.y + 1]] : [[b.x, b.y], [b.x + 1, b.y]];
    const sideOf = (b, k) => {
      if (k >= OFF) { const t = k - OFF, x = t % NX, y = (t / NX) | 0; return SIDES.find(([dx, dy]) => b.x + dx === x && b.y + dy === y) || null; }
      const cx = k % M, cy = (k / M) | 0;
      return SIDES.find(([dx, dy]) => corners(b, dx, dy).some(([a, c]) => a === cx && c === cy)) || null;
    };
    const touch = (node, w) => { for (let c = node, n = 0; c !== -1 && c !== undefined && n < 600; c = net.get(c), n++) use.set(c, (use.get(c) || 0) + w); };
    // Erst die fernsten Häuser: ihre Wege laufen als lange Straßen durch den Ort und erschließen alles, woran sie
    // vorbeiführen. Ein Haus gilt als erschlossen, wenn eine Straße an ihm oder höchstens ein Feld entfernt liegt
    // (Hinterhaus, Hof). Die Tür zeigt zur nächsten Straße.
    const near = (b, rad) => {
      let bestK = -1, bd = 1e9;
      for (let cy = b.y - rad; cy <= b.y + 1 + rad; cy++) for (let cx = b.x - rad; cx <= b.x + 1 + rad; cx++) {
        const k = cy * M + cx;
        if (!net.has(k)) continue;
        const d = Math.hypot(cx - (b.x + 0.5), cy - (b.y + 0.5));
        if (d < bd) { bd = d; bestK = k; }
      }
      return bestK;
    };
    const sideToward = (b, k) => {
      const cx = k % M - (b.x + 0.5), cy = ((k / M) | 0) - (b.y + 0.5);
      return Math.abs(cx) > Math.abs(cy) ? (cx > 0 ? Math.PI / 2 : -Math.PI / 2) : (cy > 0 ? 0 : Math.PI);
    };
    const order = blds.slice().sort((a, b) => Math.hypot(b.x - s.cx, b.y - s.cy) - Math.hypot(a.x - s.cx, a.y - s.cy));
    const pending = [];
    for (const b of order) {
      if (fronted.has(b.id)) continue; // liegt an einer Straße des Plans
      const w = b.t === 'haus' || b.t === 'hochhaus' ? 1 : 2;
      const k = near(b, 1);
      if (k >= 0) { pending.push([b, k, w]); continue; }
      const want = this.facing ? this.facing(st, b, true) : 0;
      const starts = [];
      for (const [dx, dy, ang] of SIDES) {
        const pref = Math.abs(Math.atan2(Math.sin(ang - want), Math.cos(ang - want))) < 0.3 ? 0 : 0.4;
        for (const [cx, cy] of corners(b, dx, dy)) starts.push([cy * M + cx, 0.2 + pref]);
      }
      const L0 = lines.length;
      connect(starts, null, w, false);
      if (lines.length > L0) { const sd = sideOf(b, lines[lines.length - 1].path[0]); if (sd) this.doorSide.set(b.id, sd[2]); }
    }
    // Häuser, die schon an einer Straße lagen: Tür dorthin, Verkehr zählt mit
    for (const [b, k0, w] of pending) {
      const k = near(b, 1);
      const kk = k >= 0 ? k : k0;
      this.doorSide.set(b.id, sideToward(b, kk));
      touch(kk, w);
    }
    // Bänder bauen: Breite nach Verkehr (Hauptstraße, Straße, Gasse)
    const lvl = s.era <= 2 ? 1 : s.era <= 5 ? 2 : 3; // Feldwege bis zur Bronzezeit, dann Pflaster, ab der Industrie Asphalt
    const curb = { pos: [], road: [], idx: [] }, top = { pos: [], road: [], idx: [] };
    const segs = [], drive = [];
    for (const L of lines) {
      const pts = [];
      for (const k of L.path) { const [X, Z] = pos(k); pts.push([X, Z, use.get(k) || 1]); }
      if (pts.length < 2) continue;
      const sm = chaikin(pts, 2);
      const widthAt = (len, u) => (u >= 20 ? 0.52 : u >= 8 ? 0.42 : u >= 3 ? 0.34 : 0.26);
      ribbon(curb, top, sm, widthAt, lvl, 0, st, s, false, null, null, segs);
    }
    // Felder mit Straße (für Menschen und Fahrzeuge): Mitten direkt, Ecken färben ihre vier Felder schwach
    const tiles = new Map();
    for (const [k, u] of use) {
      const lv = u >= 12 ? 3 : u >= 2 ? 2 : 1;
      if (k >= OFF) { const t = k - OFF; tiles.set(t, Math.max(tiles.get(t) || 0, lv)); }
      else { const cx = k % M, cy = (k / M) | 0; for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) { const x = cx + dx, y = cy + dy; if (free(x, y)) tiles.set(y * NX + x, Math.max(tiles.get(y * NX + x) || 0, Math.min(lv, 2))); } }
    }
    this.drawPlan(curb, top, pl, st, s, lvl, segs, drive);
    const mesh = [mk(curb, this.matCurb, 2), mk(top, this.matTop, 3)].filter(Boolean);
    for (const m of mesh) this.scene.add(m);
    this.towns.set(s.id, { sig, mesh, tiles: [...tiles], segs, drive, era: s.era | 0 });
  }

  // Gebaute Planstraßen eines Ortes im Kasten (nur die, die näher an ihm liegen als an einem anderen Ort) und Plätze
  planStreets(st, s, x0, x1, y0, y1) {
    const S = st.tiles.st, tiles = new Map(), sq = new Set();
    if (!S || !s.plan) return { tiles, sq };
    const others = st.settlements.filter(o => o !== s && o.alive && Math.abs(o.cx - s.cx) < 60 && Math.abs(o.cy - s.cy) < 60);
    const oR = o => Math.ceil(Math.max((o.R || 6) + 6, o.plan ? o.plan.ext + 1.5 : 0)); // Kasten R wie in buildTown
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * NX + x, v = S[i];
      if (!(v & 4)) continue;
      const d = Math.hypot(x - s.cx, y - s.cy);
      // ein näherer Ort nimmt die Kachel nur, wenn sie auch in seinem Zeichenkasten liegt (sonst zeichnet sie niemand und
      // die Straße endet im Nichts, seit 25.10.2026, gleiche Regel wie tools/worldcheck.mjs und sim/cityplan.js)
      if (others.some(o => Math.hypot(x - o.cx, y - o.cy) < d && Math.abs(x - o.cx) <= oR(o) && Math.abs(y - o.cy) <= oR(o))) continue;
      if (st.tiles.h[i] < 0 && !(st.tiles.river && st.tiles.river[i])) continue; // nie ins Meer hinaus (seit 25.10.2026)
      if (v & 8) sq.add(i); else tiles.set(i, v);
    }
    return { tiles, sq };
  }

  // Planstraßen als Bänder: Ketten zwischen Kreuzungen (Grad nicht 2), über Feldmitten, sanft geglättet, Breite nach Klasse
  // (Gasse, Straße, Hauptstraße; Zufahrten schmal und als Feldweg), runde Flicken an Kreuzungen und Enden
  // Seit 24.10.2026 feste Verkehrsregeln: Straße und Hauptstraße haben zwei Fahrspuren (Rechtsverkehr) und ab dem Pflaster
  // Gehwege mit Bordstein, an Kreuzungen ist der Bordstein abgesenkt. Gassen und Zufahrten bleiben einspurig ohne Verkehr.
  // Die befahrbaren Ketten (alle Stücke Straße oder Hauptstraße) bilden das Fahrnetz des Ortes (drive), Knoten sind die
  // Felder der Kreuzungen und Enden.
  drawPlan(curb, top, plan, st, s, lvl, segs = null, drive = null) {
    const { tiles, sq } = plan;
    if (!tiles.size) return;
    const HB = st._rt.hb || st.tiles.h;
    const nb = i => {
      const out = [], x = i % NX;
      for (const j of [i + 1, i - 1, i + NX, i - NX]) {
        if ((j === i + 1 && x === NX - 1) || (j === i - 1 && x === 0)) continue;
        if ((tiles.has(j) || sq.has(j)) && Math.abs(HB[j] - HB[i]) <= 1) out.push(j);
      }
      return out;
    };
    const deg = new Map();
    for (const i of tiles.keys()) deg.set(i, nb(i).length);
    const W = [0.24, 0.3, 0.4, 0.5];
    const cls = u => Math.max(0, Math.min(3, Math.round(u)));
    const cwOf = c => (c >= 3 ? 0.28 : c >= 2 ? 0.25 : W[c] / 2), swOf = c => (lvl >= 2 && c >= 2 ? (c >= 3 ? 0.13 : 0.11) : 0);
    const rOf = i => { const v = tiles.get(i); const c = v ? (v & 32 ? 0 : v & 3) : 2; return cwOf(c) + swOf(c) + 0.02; };
    const done = new Set(), key = (a, b) => (a < b ? a + ':' + b : b + ':' + a);
    const P = i => [wx(i % NX), wz((i / NX) | 0)];
    const draw = chain => {
      if (chain.length < 2) return;
      const track = chain.some(i => (tiles.get(i) || 0) & 32);
      const pts = chain.map(i => { const [X, Z] = P(i); const v = tiles.get(i); return [X, Z, v ? (v & 32 ? 0 : v & 3) : 2]; });
      const sm = chaikin(pts, 2);
      const a = chain[0], b = chain[chain.length - 1];
      const end = i => (sq.has(i) || (deg.get(i) || 0) >= 3 ? rOf(i) + 0.03 : 0);
      const drivable = !track && (s.era | 0) >= 3 && pts.every(p => p[2] >= 2);
      const lanes = track ? null : { cw: u => cwOf(cls(u)), sw: u => swOf(cls(u)), cut0: end(a), cut1: end(b), line: lvl >= 3 && drivable, drive: drivable };
      ribbon(curb, top, sm, (len, u) => W[cls(u)], track ? 1 : lvl, 0, st, s, false, null, lanes, segs);
      if (drivable && drive) drive.push({ pts: sm.map(p => [p[0], p[1]]), a, b, cw: Math.min(...pts.map(p => cwOf(p[2]))) });
    };
    const walk = (a, b) => {
      const chain = [a, b];
      done.add(key(a, b));
      let prev = a, cur = b;
      while (tiles.has(cur) && deg.get(cur) === 2) {
        const nx = nb(cur).find(j => j !== prev);
        if (nx === undefined || done.has(key(cur, nx))) break;
        done.add(key(cur, nx));
        chain.push(nx); prev = cur; cur = nx;
      }
      draw(chain);
    };
    for (const [i, d] of deg) if (d !== 2) for (const j of nb(i)) if (!done.has(key(i, j))) walk(i, j);
    for (const i of tiles.keys()) for (const j of nb(i)) if (!done.has(key(i, j))) walk(i, j); // Ringe ohne Kreuzung
    // Flicken an Kreuzungen und Enden in der Breite der breitesten Straße
    for (const [i, d] of deg) {
      if (d === 2) continue;
      const v = tiles.get(i), [x, z] = P(i), r = (v & 32) ? W[0] / 2 + 0.02 : rOf(i);
      let y = groundY(x, z);
      for (const [ox, oz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) y = Math.max(y, groundY(x + ox, z + oz));
      disc(curb, top, { x, z, y, lvl: (v & 32) ? 1 : lvl, r });
      // Gehweg an der Kreuzung: vier Ecken, und wo kein Arm abgeht, läuft der Gehweg quer durch
      const c = (v & 32) ? 0 : v & 3, cw = cwOf(c), sw = swOf(c);
      if (sw > 0 && !(v & 32) && d >= 3) {
        const arms = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([ax, az]) => nb(i).includes(i + ax + az * NX));
        for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) slab(top, x + sx * (cw + sw / 2), z + sz * (cw + sw / 2), sw / 2 + 0.008, sw / 2 + 0.008, lvl);
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([ax, az], k) => { if (!arms[k]) slab(top, x + ax * (cw + sw / 2), z + az * (cw + sw / 2), ax ? sw / 2 + 0.008 : cw, az ? sw / 2 + 0.008 : cw, lvl); });
      }
    }
  }

  // Landstraßen zwischen den Orten (nur der gebaute Teil), Mittellinie ab Asphalt
  // Landstraßen als Netz (seit 19.10.2026, render/roadnet.js): je Kette zwischen Kreuzungen ein Band, genau auf dem
  // Längsprofil (das Gelände ist dort eingeebnet, über Flüssen liegt eine Brücke), an Kreuzungen ein runder Flicken.
  buildLinks(st) {
    if (this.links) for (const m of this.links) { this.scene.remove(m); m.geometry.dispose(); }
    this.links = [];
    this.linkTiles = [];
    const rt = st._rt;
    const net = getNet(st);
    this.net = net;
    const curb = { pos: [], road: [], idx: [] }, top = { pos: [], road: [], idx: [] };
    const segs = this.linkSegs = [];
    const deg = new Map();
    for (const c of net.chains) for (const i of [c.tiles[0], c.tiles[c.tiles.length - 1]]) deg.set(i, (deg.get(i) || 0) + 1);
    const discs = new Map();
    for (const c of net.chains) {
      const pts = c.pts.map(p => [p[0], p[1], 0]);
      const w = WIDTH[c.lvl];
      ribbon(curb, top, pts, () => w, c.lvl, c.lvl >= 3 ? 1 : 0, st, null, false, c.prof, { cw: () => w / 2, line: c.lvl >= 3, drive: true }, segs);
      for (const i of c.tiles) if (!rt.bldAt[i]) this.linkTiles.push(i);
      // Kreuzung (drei oder mehr Kettenenden an einer Kachel) und offenes Ende (Baustelle, Ortsrand): runder Flicken
      // in der breitesten Stufe, statt einer eckigen Kante
      for (const [i, q] of [[c.tiles[0], 0], [c.tiles[c.tiles.length - 1], c.pts.length - 1]]) {
        if ((deg.get(i) || 0) === 2) continue;
        const o = discs.get(i);
        if (!o || o.lvl < c.lvl) discs.set(i, { x: c.pts[q][0], z: c.pts[q][1], y: c.prof[q], lvl: c.lvl });
      }
    }
    for (const d of discs.values()) disc(curb, top, d);
    this.links = [mk(curb, this.matCurb, 2), mk(top, this.matTop, 3)].filter(Boolean);
    for (const m of this.links) this.scene.add(m);
  }
}

// Gehwegplatte (Ecke an einer Kreuzung): flach in Gehweghöhe, Mitte (x, z), halbe Größen hx, hz
function slab(top, x, z, hx, hz, lvl) {
  const c0 = top.pos.length / 3;
  for (const [ox, oz] of [[-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz]]) {
    top.pos.push(x + ox, groundY(x + ox, z + oz) + LIFT + CURB, z + oz);
    top.road.push(0.9, 0, lvl, 2.5);
  }
  top.idx.push(c0, c0 + 2, c0 + 1, c0 + 1, c0 + 2, c0 + 3);
}

// Runder Flicken an einer Kreuzung: Mitte (quer 0) und Rand (quer 1), gleiche Höhe wie die Bänder
function disc(curb, top, d) {
  const r = d.r ?? WIDTH[d.lvl] / 2, seg = 18;
  for (const [L, rr] of d.lvl >= 2 ? [[curb, r + 0.06], [top, r]] : [[top, r]]) {
    const c0 = L.pos.length / 3;
    const lv = d.lvl < 1.5 ? d.lvl + 0.5 : d.lvl; // Feldweg: ohne Spurrillen, sonst zeichnen sie einen Kreis
    L.pos.push(d.x, d.y + 0.026, d.z); L.road.push(0, 0, lv, 0);
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      L.pos.push(d.x + Math.cos(a) * rr, d.y + 0.026, d.z + Math.sin(a) * rr); L.road.push(1, 0, lv, 0);
    }
    for (let k = 0; k < seg; k++) L.idx.push(c0, c0 + k + 2, c0 + k + 1); // nach oben gewickelt
  }
}

// Ein Band entlang der Punkte (x, z, Verkehr) in beide Lagen schreiben.
// Seit 24.10.2026 (Verkehrsregeln, Naders Wunsch nach zweispurigen Straßen und Gehwegen): mit lanes hat das Band eine
// Fahrbahn (halbe Breite lanes.cw) und an beiden Seiten einen Gehweg (lanes.sw) als echte Stufe mit Bordstein. Auf den
// ersten cut0 und letzten cut1 (Kreuzungen) gibt es keinen Gehweg, dort ist alles Fahrbahn (abgesenkter Bordstein).
// Jedes Stück landet in segs (Gehwegregel der Menschen, Höhe auf der Straße, Fahrspuren), siehe Streets.at.
const CURB = 0.014;      // Höhe des Gehwegs über der Fahrbahn
const LIFT = 0.025;      // Fahrbahn über dem Gelände (wie die Bänder gezeichnet sind)
const SEG = 10;          // Werte je Stück in segs: ax az bx bz tx tz len cw sw fl
export const F_WALK = 2, F_DRIVE = 4;
function ribbon(curb, top, pts, widthAt, lvl, mark, st, s, door = false, prof = null, lanes = null, segs = null) {
  const T = st.tiles, withCurb = lvl >= 2;
  let ns = null; // je Punkt: ohne Gehweg (Kreuzungsbereich)
  if (lanes && lanes.sw && (lanes.cut0 || lanes.cut1)) [pts, ns] = cutAt(pts, lanes.cut0 || 0, lanes.cut1 || 0);
  const n = pts.length;
  const ys = [];
  // Seit 24.10.2026 (Naders Kritik: Menschen sahen wie schwebende Haare aus): auf festem Land liegt jede Straße genau auf
  // dem Gelände (je Eckpunkt groundY), nur über Wasser und Flüssen gilt die Brückenhöhe. Vorher folgten Landstraßen einem
  // geglätteten Profil, das bis 0,55 über und anderswo unter dem Gelände lag: darunter liefen Menschen unsichtbar, und
  // Straßen tauchten ins Gelände ab.
  const bridge = [], cum = [0];
  for (let k = 0; k < n; k++) {
    const [x, z] = pts[k];
    if (k) cum.push(cum[k - 1] + Math.hypot(x - pts[k - 1][0], z - pts[k - 1][1]));
    const tx = Math.round(x + NX / 2 - 0.5), ty = Math.round(z + NY / 2 - 0.5);
    const inside = tx >= 0 && ty >= 0 && tx < NX && ty < NY, wet = inside && (T.river[ty * NX + tx] || T.h[ty * NX + tx] < 0);
    let y = groundY(x, z);
    if (prof && wet) y = Math.max(y, prof[k]); // Landstraßen über Wasser: Profil der Brücke
    else if (!prof && wet && inside && T.river[ty * NX + tx]) {
      let hi = y;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) hi = Math.max(hi, groundY(x + dx, z + dz));
      y = hi + 0.06;
    }
    bridge.push(wet);
    ys.push(y);
  }
  const total = cum[n - 1] || 0;
  const b0 = curb.pos.length / 3, t0 = top.pos.length / 3;
  const CW = new Float32Array(n), SW = new Float32Array(n);
  let six = false;
  for (let k = 0; k < n; k++) {
    const u = pts[k][2], len = cum[k];
    let cw = widthAt(len, u) / 2, sw = 0;
    if (lanes) {
      cw = lanes.cw(u); sw = lanes.sw ? lanes.sw(u) : 0;
      if (sw && ns && ns[k]) { cw += sw; sw = 0; }
    }
    CW[k] = cw; SW[k] = sw; if (sw > 0) six = true;
  }
  for (let k = 0; k < n; k++) {
    const [x, z] = pts[k], len = cum[k];
    const [px, pz] = pts[Math.max(0, k - 1)], [nx, nz] = pts[Math.min(n - 1, k + 1)];
    let dx = nx - px, dz = nz - pz; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const foot = door && len < 0.45 ? 0.5 : 0;
    const cw = CW[k], sw = SW[k];
    const hw = cw + sw, e = sw > 0 ? cw / hw : 1;
    const flags = (lanes && lanes.line && !(ns && ns[k]) ? 1 : mark ? 1 : 0) + (sw > 0 ? 2 : 0);
    const wv = flags + Math.min(0.99, e);
    const yAt = (X, Z, raised) => (bridge[k] ? ys[k] : groundY(X, Z)) + LIFT + (raised ? CURB : 0);
    if (withCurb) for (const side of [-1, 1]) {
      const X = x - dz * (hw + 0.06) * side, Z = z + dx * (hw + 0.06) * side;
      curb.pos.push(X, yAt(X, Z, false), Z); curb.road.push(side, len, lvl + foot, 0);
    }
    if (six) {
      // quer: Gehweg außen, Gehweg innen, Bordstein unten, dasselbe auf der anderen Seite (die Stufe ist eine echte Kante)
      for (const [o, raised] of [[-hw, true], [-cw, true], [-cw, false], [cw, false], [cw, true], [hw, true]]) {
        const X = x - dz * o, Z = z + dx * o; // o > 0: rechts in Laufrichtung der Punkte (rechts ist (-dz, dx))
        top.pos.push(X, yAt(X, Z, raised && sw > 0), Z);
        top.road.push(o / hw, len, lvl + foot, wv);
      }
    } else {
      for (const side of [-1, 1]) {
        const X = x - dz * hw * side, Z = z + dx * hw * side;
        top.pos.push(X, yAt(X, Z, false), Z);
        top.road.push(side, len, lvl + foot, wv);
      }
    }
  }
  const C = six ? 6 : 2;
  for (let k = 0; k < n - 1; k++) {
    if (withCurb) { const a = b0 + k * 2; curb.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    for (let c = 0; c < C - 1; c++) {
      const a = t0 + k * C + c, b = a + C;
      if (six) top.idx.push(a, a + 1, b, a + 1, b + 1, b); // Spalten von links nach rechts, gewickelt wie unten
      else top.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); // gegen den Uhrzeigersinn von oben: Fläche zeigt nach oben
    }
  }
  if (segs) for (let k = 0; k < n - 1; k++) {
    const ax = pts[k][0], az = pts[k][1], bx = pts[k + 1][0], bz = pts[k + 1][1], len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-4) continue;
    segs.push(ax, az, bx, bz, (bx - ax) / len, (bz - az) / len, len, Math.min(CW[k], CW[k + 1]), Math.min(SW[k], SW[k + 1]),
      (SW[k] > 0 && SW[k + 1] > 0 ? F_WALK : 0) + (lanes && lanes.drive ? F_DRIVE : 0));
  }
  return { cum, CW, SW };
}

// Punkte an den Gehweg-Enden (Länge c0 vom Anfang, c1 vom Ende) doppelt einfügen: davor ohne, danach mit Gehweg
function cutAt(pts, c0, c1) {
  const cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  const total = cum[cum.length - 1];
  if (c0 + c1 >= total - 0.05) return [pts, pts.map(() => true)];
  const out = [], ns = [];
  const at = L => { let k = 1; while (k < pts.length - 1 && cum[k] < L) k++; const a = pts[k - 1], b = pts[k], t = (L - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
  const A = c0, B = total - c1;
  for (let k = 0; k < pts.length; k++) {
    const L = cum[k];
    if (c0 > 0 && k > 0 && cum[k - 1] < A && L >= A) { const p = at(A); out.push(p, p.slice()); ns.push(true, false); }
    if (c1 > 0 && k > 0 && cum[k - 1] < B && L >= B) { const p = at(B); out.push(p, p.slice()); ns.push(false, true); }
    if (Math.abs(L - A) < 1e-6 && c0 > 0 || Math.abs(L - B) < 1e-6 && c1 > 0) continue;
    out.push(pts[k]); ns.push((c0 > 0 && L < A) || (c1 > 0 && L > B));
  }
  return [out, ns];
}

function mk(B, mat, order) {
  if (!B.idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
  g.setAttribute('aRoad', new THREE.Float32BufferAttribute(B.road, 4));
  const nrm = new Float32Array(B.pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(B.idx);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  m.renderOrder = order;
  return m;
}
