// Die Menschen: animierte Dorfbewohner, Mann und Frau (gemalt und in 3D gebaut mit Higgsfield, Meshy Skelett und Animationen).
// Fehlen die Dateien, springt die freie Quaternius Figur ein (CC0). Alle Animationen sind vorab in Texturen gebacken
// (tools/bake_villagers.mjs, tools/bake_people.mjs): je Figur ein InstancedMesh, jede Person mit eigener Animation, Phase,
// Blickrichtung und Farben. Der Tagesablauf kommt aus schedule.js (gemeinsam mit der Innenansicht): wer drinnen ist,
// fehlt draußen. Wege gehen von Tür zu Tür, meiden Häuser, bevorzugen Straßen, mit Rechtsverkehr. Niemand steht in
// einem Gebäude, alle halten Abstand zueinander, und Wechsel zwischen Gehen und Stehen werden weich nachgeführt.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NX, NY, wx, wz } from './scene.js';
import { groundY } from './terrain.js';
import { roadY } from './bridges.js';
import { findPath } from '../sim/world.js';
import { plan, prep, INDOOR, festive, phaseOf } from './schedule.js';
import { DAY_SECONDS } from '../sim/data.js';
import { program, nextEvent } from './leisure.js';
import { Props, BENCH_H } from './props.js';

import * as FG from './figure.js';
export { HEIGHT, figFor, Figure, drawPerson, personLook, figureScale, loadVillagers } from './figure.js';
const { hash, JOBC, KIDS, HAT_OF, HAT_COLORS, CRAFT, FIELD, SKIN, HAIR, PANTS, GREY, MAX, HEIGHT, FAR, FALLBACK, VILLAGERS, VILLAGERS_OLD, figFor, VS_HEAD, NRM_HEAD, half, srgb, putSRGB, Figure, drawPerson, CARRY_MODES, ITEM_OF, TMP, personLook, figureScale, loadVillagers } = FG;

// Gebäude, durch die man laufen darf (Felder, Feuerplatz, Brunnen)
const OPEN = new Set(['feld', 'zentrum', 'brunnen', 'park']);
// begehbar (seit 19.10.2026 nach echtem Grundriss, buildings.foot): Felder, Platz, Parks, der Hafen (Stege, dort arbeiten
// Händler und Fischer). Den Brunnen umgeht man
const WALK = new Set(['feld', 'zentrum', 'park', 'hafen']);
// die Dorfmitte ist nur als offene Feuerstelle begehbar (Bauform bis Stufe 1), danach ein Haus wie jedes andere
const walkable = (st, b) => WALK.has(b.t) && (b.t !== 'zentrum' || Math.max(b.lvl | 0, ((st._rt.sById.get(b.s) || {}).era | 0) - 2) <= 1);
const SEP = 0.072; // Abstand, den Menschen zueinander halten (seit 24.10.2026 passend zu den kleineren Menschen, vorher 0,095)
const LANE = 0.05; // Rechtsverkehr auf den Wegen
// Schritttempo: Kacheln pro Sekunde bei 1× (eine Kachel sind gut 6 Meter, ein Mensch ist 0,27 hoch) und wie weit die
// Lauf-Animationen bei Tempo 1 tragen (Körperlängen pro Sekunde, aus den Fußbewegungen gemessen)
const WALK_V = 0.18, STRIDE = 0.45, RUN_STRIDE = 1.95; // Gehtempo seit 24.10.2026 0,18 (kleinere Menschen, sonst trippeln sie)
const CELL = 0.25; // Rastergröße für die Nachbarsuche
const AV_MAX = 0.2; // so weit weicht ein Gehender höchstens seitlich aus
const EV_MAX = 10; // längster Weg (Felder) zu einer Unternehmung (10 Felder sind bei Tempo 1 rund 50 Sekunden)
const DOOR_RAMP = 0.35; // auf diesem Stück vor und nach der Tür geht man mittig (hinein und hinaus)
// Weg kürzen: Anfang (oder Ende) ist der Punkt der ersten (letzten) Abschnitte, der (x, z) am nächsten liegt
function trimPath(pa, x, z, atEnd) {
  const P = pa.pts, n = P.length;
  if (n < 3) return pa;
  let best = Infinity, bk = 0, bu = 0;
  const k0 = atEnd ? Math.max(0, n - 6) : 0, k1 = atEnd ? n - 1 : Math.min(n - 1, 5);
  for (let k = k0; k < k1; k++) {
    const a = P[k], b = P[k + 1], vx = b[0] - a[0], vz = b[1] - a[1], vv = vx * vx + vz * vz || 1e-9;
    const u = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / vv));
    const d = Math.hypot(a[0] + vx * u - x, a[1] + vz * u - z);
    if (d < best - 1e-6) { best = d; bk = k; bu = u; }
  }
  const q = [P[bk][0] + (P[bk + 1][0] - P[bk][0]) * bu, P[bk][1] + (P[bk + 1][1] - P[bk][1]) * bu];
  const pts = atEnd ? P.slice(0, bk + 1).concat([q]) : [q].concat(P.slice(bk + 1));
  if (pts.length < 2) return pa;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, len: cum[cum.length - 1] || 0.001 };
}
// Anteil des seitlichen Versatzes an Stelle d eines Weges: an Türen weich auf null, draußen nur ein kurzes Stück
const rampK = (T, d) => Math.min(1, d / (T.r0 || 0.12), (T.L - d) / (T.r1 || 0.12));
// Posen mit Rumpfausgleich (wie im Haus), davon sitzend auf Bank oder Stuhl
const SEAT_Y = 0.255;
const POSED = new Set(['sit', 'drink', 'talksit', 'doze', 'floor']);
const SEATED = new Set(['sit', 'drink', 'talksit', 'doze']);

export class People {
  constructor(scene) {
    this.scene = scene;
    this.figs = [];
    this.ids = [];
    this.pos = new Map();
    this.head = new Map();
    this.paths = new Map();
    this.doors = new Map();
    this.sm = new Map(); // Läufer je Mensch: Stelle, Weg, Ziel, drinnen
    this.recs = [];
    this.grid = new Map(); // Raster dieses Bildes (Ausweichen)
    this.snap = []; this.sgrid = new Map(); this.pgrid = new Map(); this.snapN = 0; // Schnappschuss des letzten Bildes (Stellen und Plätze)
    this.claims = []; // in diesem Bild vergebene Stehplätze (x, z, id)
    this.doorT = new Map(); // Gebäude → wann zuletzt jemand durch die Tür ging (Türschlange)
    this.evs = new Map(); this.evState = new Map(); this.present = new Map(); // Unternehmungen (leisure.js)
    this.props = new Props(scene);
    this.budget = 0;
    this.o = new THREE.Object3D();
    this.uTime = { value: 0 };
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.2, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, depthWrite: false }));
    this.ring.visible = false;
    scene.add(this.ring);
    // Dein Mensch (hero.js): ein kleiner goldener Stern schwebt über ihm, auch wenn er im Haus ist (dann über der Tür)
    this.heroMark = new THREE.Mesh(new THREE.OctahedronGeometry(0.035, 0).scale(1, 1.5, 1), new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.95, depthTest: false }));
    this.heroMark.renderOrder = 5; this.heroMark.visible = false;
    scene.add(this.heroMark);
    this.siteCache = new Map();
    this.pa = { tx: 0, ty: 0, X: 0, Z: 0 }; this.pb = { tx: 0, ty: 0, X: 0, Z: 0 };
    this.load();
  }

  async load() {
    try {
      this.figs = await loadVillagers(this.scene, this.uTime);
    } catch (err) {
      console.info('Dorfbewohner fehlen, die einfache Figur springt ein', err.message);
      try { this.figs = [await new Figure(this.scene, this.uTime).load('people', false)]; } catch (e) { console.error('Menschen konnten nicht geladen werden', e); }
    }
  }

  get mesh() { return this.figs[0] ? this.figs[0].mesh : null; }

  // Weg von Feld a nach Feld b: Häuser meiden, Straßen bevorzugen, Ecken weich
  path(st, ax, ay, bx, by) {
    const key = ax + ',' + ay + '>' + bx + ',' + by;
    let p = this.paths.get(key);
    if (p) return p;
    if (this.budget <= 0) return null;
    this.budget--;
    const rt = st._rt, T = st.tiles;
    const extra = j => {
      const bid = rt.bldAt[j];
      let e = 0;
      if (bid) { const b = rt.bById.get(bid); if (b && !OPEN.has(b.t)) e += 5; }
      if (T.road[j] > 80) e -= 0.35;
      if (this.streetTiles && this.streetTiles[j]) e -= 0.3 + this.streetTiles[j] * 0.1; // auf der Straße geht es sich leichter
      return e;
    };
    const raw = findPath(T.h, ax, ay, bx, by, 3000, false, extra) || [[ax, ay], [bx, by]];
    let pts = raw.map(([x, y]) => [wx(x), wz(y)]);
    // Chaikin: Zickzack der Felder glätten
    if (pts.length > 2) {
      const sm = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (i > 0) sm.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
        if (i < pts.length - 2) sm.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      sm.push(pts[pts.length - 1]);
      pts = sm;
    }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    p = { pts, cum, len: cum[cum.length - 1] || 0.001 };
    if (this.paths.size > 6000) this.paths.clear();
    this.paths.set(key, p);
    return p;
  }

  // Punkt auf dem Weg, dazu die Laufrichtung in out[3], out[4]
  along(p, u, out) {
    const d = Math.max(0, Math.min(1, u)) * p.len;
    let i = 1;
    while (i < p.cum.length - 1 && p.cum[i] < d) i++;
    const a = p.pts[i - 1], b = p.pts[Math.min(i, p.pts.length - 1)];
    const seg = (p.cum[i] - p.cum[i - 1]) || 1;
    const k = Math.max(0, Math.min(1, (d - p.cum[i - 1]) / seg));
    out[0] = a[0] + (b[0] - a[0]) * k; out[1] = a[1] + (b[1] - a[1]) * k;
    out[3] = b[0] - a[0]; out[4] = b[1] - a[1];
    return out;
  }

  // Tür eines Gebäudes: das Feld davor (für die Wege) und der Punkt direkt vor der Tür (dort geht man hinein)
  door(st, b) {
    let d = this.doors.get(b.id);
    if (d && d.t === b.t && !(d.nofp && this.footOf && this.footOf(b.id))) return d;
    const X = wx(b.x), Z = wz(b.y);
    if (OPEN.has(b.t) || !this.facing) d = { t: b.t, tx: b.x, ty: b.y, X, Z, cx: X, cz: Z, sx: 0, sz: 1, open: true };
    else {
      const ry = this.facing(st, b), sx = Math.sin(ry), sz = Math.cos(ry);
      let tx = b.x + Math.round(sx), ty = b.y + Math.round(sz);
      if (tx < 0 || ty < 0 || tx >= NX || ty >= NY || st.tiles.h[ty * NX + tx] < 0) { tx = b.x; ty = b.y; }
      // der Türpunkt liegt knapp vor der echten Wand (vorher fest 0,44 vom Feldmittelpunkt, bei großen Häusern in der
      // Wand: dann schob das Ausweichen alle, die hinausgingen, auf denselben Punkt)
      const f = this.footOf ? this.footOf(b.id) : null;
      let k = 0.44;
      if (f) {
        const m = 0.06, ex = sx > 1e-3 ? (f[1] + m - X) / sx : sx < -1e-3 ? (f[0] - m - X) / sx : Infinity, ez = sz > 1e-3 ? (f[3] + m - Z) / sz : sz < -1e-3 ? (f[2] - m - Z) / sz : Infinity;
        k = Math.max(0.2, Math.min(0.8, Math.min(ex, ez)));
      }
      d = { t: b.t, tx, ty, X: X + sx * k, Z: Z + sz * k, cx: X, cz: Z, sx, sz, nofp: !f };
    }
    if (this.doors.size > 8000) this.doors.clear();
    this.doors.set(b.id, d);
    return d;
  }

  // Wo arbeitet jemand ohne festes Gebäude? [x, y, Baustelle]
  spot(st, p, s) {
    if (p.job === 'baumeister') {
      let site = this.siteCache.get(s.id);
      if (site === undefined) {
        site = st.buildings.find(b => b.s === s.id && (b.prog < 1 || b.hp < 1)) || null;
        this.siteCache.set(s.id, site);
      }
      if (site) return [site.x, site.y, site];
    }
    if (p.job === 'krieger' && s.war) {
      const e = st._rt.sById.get(s.war);
      if (e) return [Math.round(s.cx + (e.cx - s.cx) * 0.35), Math.round(s.cy + (e.cy - s.cy) * 0.35), null];
    }
    if (p.job === 'sammler' || p.job === 'jaeger') {
      const a = hash(p.id, 9) * Math.PI * 2, r = s.R * (0.7 + hash(p.id, 4) * 0.5);
      const x = Math.round(s.cx + Math.cos(a) * r), y = Math.round(s.cy + Math.sin(a) * r);
      if (x >= 0 && y >= 0 && x < NX && y < NY && st.tiles.h[y * NX + x] >= 0) return [x, y, null];
    }
    return [s.cx, s.cy, null];
  }

  // Arbeitsplatz draußen: vor der Tür (nie im Gebäude), auf dem Feld, an der Baustelle
  workArea(st, p, s, yard, out) {
    const rt = st._rt;
    let b = p.w > 0 ? rt.bById.get(p.w) : null;
    let tile = null;
    if (!b) { const sp = this.spot(st, p, s); b = sp[2]; if (!b) tile = sp; }
    if (b) {
      const d = this.door(st, b);
      if (d.open) { out[0] = d.cx; out[1] = d.cz; out[2] = b.t === 'feld' ? 0.38 : 0.5; }
      else { out[0] = d.cx + d.sx * 0.72; out[1] = d.cz + d.sz * 0.72; out[2] = yard ? 0.22 : 0.3; }
      return out;
    }
    out[0] = wx(tile[0]); out[1] = wz(tile[1]); out[2] = p.job === 'krieger' && s.war ? 0.9 : 0.5;
    return out;
  }

  // Gesprächskreis auf dem Platz: man stellt sich zu einem guten Freund (aus p.ties), alle paar Minuten zu einem anderen.
  // Ohne Freunde schlendert man wie bisher. Blickrichtung zur Mitte des Kreises.
  circle(p, s, t, out) {
    const T = p.ties;
    if (!T) return false;
    let f1 = 0, v1 = 28, f2 = 0, v2 = 28;
    for (const k in T) { const v = T[k]; if (v > v1) { f2 = f1; v2 = v1; f1 = +k; v1 = v; } else if (v > v2) { f2 = +k; v2 = v; } }
    if (!f1) return false;
    const slot = Math.floor(t / 26 + hash(p.id, 61));
    const fid = f2 && hash(p.id, slot) < 0.4 ? f2 : f1;
    const key = Math.min(p.id, fid) * 7 + Math.max(p.id, fid);
    const a = hash(key, 1) * Math.PI * 2, rr = 0.8 + hash(key, 2) * 1.4;
    const cx = wx(s.cx) + Math.cos(a) * rr, cz = wz(s.cy) + Math.sin(a) * rr;
    const b = hash(key, 5) * Math.PI * 2 + (p.id < fid ? 0 : Math.PI) + (hash(p.id, 7) - 0.5) * 1.2;
    out[0] = cx + Math.cos(b) * 0.13; out[1] = cz + Math.sin(b) * 0.13;
    out[3] = cx - out[0]; out[4] = cz - out[1];
    return true;
  }

  // Gehwegregel (seit 24.10.2026, feste Regel statt Schätzung nach Feldern, Naders Wunsch: Menschen gehen neben der Straße,
  // nicht darauf): Hat die Straße an dieser Stelle einen Gehweg (render/streets.js, Streets.at), geht man auf dem Gehweg
  // rechts in Laufrichtung, gemessen am echten Straßenband. Wer quer zur Straße geht, überquert sie auf geradem Weg.
  // Auf Gassen, Fußwegen und Feldwegen wie bisher leicht rechts der Mitte. (x, z) ist die Wegmitte, (dx, dz) die Richtung.
  sideAt(st, x, z, id, dx = 0, dz = 0) {
    const ix = Math.floor(x + NX / 2), iy = Math.floor(z + NY / 2), M = this.streetTiles;
    const base = LANE + hash(id, 6) * 0.04;
    const S = this.streets, ll = Math.hypot(dx, dz);
    if (S && ll > 1e-6) {
      const q = S.at(x, z, dx, dz);
      if (q && q.sw > 0) {
        const rx = -dz / ll, rz = dx / ll;
        if (Math.abs(dx * q.tx + dz * q.tz) / ll < 0.55) return base; // quert: gerade hinüber
        const sg = rx * q.nx + rz * q.nz >= 0 ? 1 : -1;
        const want = sg * (q.cw + q.sw * (0.38 + hash(id, 6) * 0.3));
        return Math.max(-0.7, Math.min(0.7, (want - q.lat) * sg));
      }
      if (q) return base;
    }
    if (!M || ix < 0 || iy < 0 || ix >= NX || iy >= NY) return base;
    const i = iy * NX + ix, v = M[i];
    if (v < 2) return base;
    const own = st._rt.owner[i], s = own ? st._rt.sById.get(own) : null;
    if (s ? (s.era | 0) < 3 : v < 3) return base;
    return (v >= 3 ? 0.31 : 0.25) + hash(id, 6) * 0.025;
  }

  // Niemand steht in einem Haus: an den echten Grundriss jedes Gebäudes (buildings.foot über this.footOf) hinausschieben,
  // als kleiner Kreis, der an der Wand entlang gleitet. Felder, Platz und Parks sind begehbar.
  unblock(st, n, fresh = false) {
    const rt = st._rt, R = this.recs, RAD = 0.045;
    for (let i = 0; i < n; i++) {
      const r = R[i];
      if (r.fixed) continue; // sitzt oder liegt auf seinem geprüften Platz
      // Grundrisse in der Nähe am Menschen merken, neu gesucht wird nur auf einem neuen Feld oder alle 40 Bilder
      const H = r.A, ix = Math.floor(r.x + NX / 2), iy = Math.floor(r.z + NY / 2), ti = iy * NX + ix;
      if (fresh && (H.fpTile !== ti || this.frame - (H.fpF || 0) > 40 || !H.fp)) {
        const fp = H.fp || (H.fp = []);
        fp.length = 0; H.fpOld = null; H.fpTile = ti; H.fpF = this.frame;
        if (ix < 1 || iy < 1 || ix >= NX - 1 || iy >= NY - 1) continue;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const bid = rt.bldAt[(iy + oy) * NX + ix + ox];
          if (!bid) continue;
          const b = rt.bById.get(bid);
          if (!b || walkable(st, b)) continue;
          const f = this.footOf ? this.footOf(b.id) : null;
          if (f) fp.push(f, b);
          else if (!ox && !oy) H.fpOld = b; // ohne Bild (noch nicht gebaut): wie früher ein Kreis um die Feldmitte
        }
      }
      if (!H.fp) continue;
      if (H.fpOld) {
        const b = H.fpOld, cx = wx(b.x), cz = wz(b.y), vx = r.x - cx, vz = r.z - cz, d = Math.hypot(vx, vz);
        if (d < 0.44) { if (d < 1e-3) { const dd = this.door(st, b); r.x = cx + dd.sx * 0.44; r.z = cz + dd.sz * 0.44; } else { r.x = cx + vx / d * 0.44; r.z = cz + vz / d * 0.44; } }
      }
      const fp = H.fp;
      for (let k = 0; k < fp.length; k += 2) {
        const f = fp[k];
        const qx = Math.max(f[0], Math.min(f[1], r.x)), qz = Math.max(f[2], Math.min(f[3], r.z));
        const dx = r.x - qx, dz = r.z - qz, d = Math.hypot(dx, dz);
        if (d >= RAD) continue;
        if (d > 1e-5) { r.x = qx + dx / d * RAD; r.z = qz + dz / d * RAD; continue; }
        // mitten drin: zur Tür hinaus, sonst zur nächsten Wand
        const dd = this.door(st, fp[k + 1]);
        const l = r.x - f[0], rr = f[1] - r.x, nn = r.z - f[2], ss = f[3] - r.z, mn = Math.min(l, rr, nn, ss);
        if (Math.abs(dd.sx) > 0.7 || Math.abs(dd.sz) > 0.7) {
          if (dd.sx > 0.7) r.x = f[1] + RAD; else if (dd.sx < -0.7) r.x = f[0] - RAD; else if (dd.sz > 0.7) r.z = f[3] + RAD; else r.z = f[2] - RAD;
        } else if (mn === l) r.x = f[0] - RAD; else if (mn === rr) r.x = f[1] + RAD; else if (mn === nn) r.z = f[2] - RAD; else r.z = f[3] + RAD;
      }
    }
  }

  // Wo steht dein Mensch, wenn er drinnen ist? Über der Tür des Gebäudes
  heroDoor(st) {
    const A = this.sm.get(this.heroId);
    if (!A || !(A.inside > 0)) return null;
    const b = st._rt.bById.get(A.inside);
    if (!b) return null;
    const d = this.door(st, b);
    return [d.X, groundY(d.X, d.Z), d.Z];
  }

  // Ziel aus dem Tagesplan: H daheim (drinnen), I+id in einem Gebäude (drinnen), W Arbeitsplatz draußen, C Dorfplatz,
  // E+id eine Unternehmung (leisure.js)
  keyOf(st, p, P) {
    if (P.out === 'ev' && P.ev) return 'E' + P.ev.id;
    if (P.at === 'home') return 'H';
    if (P.at === 'in') return 'I' + P.bid;
    if (P.out === 'walk') {
      if (P.b === 'H') return 'H';
      if (P.b === 'S') { const C = prep(st); const id = C.school.get(p.id) || C.heal.get(p.id); return id ? 'I' + id : 'C'; }
      if (P.b === 'W') { const w = p.w > 0 ? st._rt.bById.get(p.w) : null; return w && w.prog >= 1 && INDOOR[w.t] ? 'I' + w.id : 'W'; }
      return 'C';
    }
    return P.out === 'work' || P.out === 'yard' ? 'W' : 'C';
  }

  // Wo liegt ein Ziel? { tx, ty, X, Z, bid (drinnen, -1 ohne Haus), cx, cz, r (Bereich draußen) }
  target(st, p, s, key) {
    const rt = st._rt, T = this.tg || (this.tg = {});
    T.bid = 0; T.r = 0;
    if (key === 'H' || key[0] === 'I') {
      const b = key === 'H' ? (p.home > 0 ? rt.bById.get(p.home) : null) : rt.bById.get(+key.slice(1));
      if (b) { const d = this.door(st, b); T.tx = d.tx; T.ty = d.ty; T.X = d.X; T.Z = d.Z; T.bid = b.id; return T; }
      T.tx = s.cx; T.ty = s.cy; T.X = wx(s.cx); T.Z = wz(s.cy); T.bid = -1; return T; // ohne Haus: nachts unsichtbar am Feuer
    }
    if (key[0] === 'E') {
      // Unternehmung: der eigene Platz, auf einer Runde der nächste Wegpunkt, beim Besuch vor der Tür
      const ev = this.evs.get(+key.slice(1)), sl = ev && ev.sl.get(p.id);
      if (ev && sl) {
        let X, Z;
        if (ev.dyn === 'loop' && ev.way) { const q = ev.way[((this.curA && this.curA.loopK) || 0) % ev.way.length]; X = wx(q[0]); Z = wz(q[1]); }
        else if (sl.door && ev.visit) { const b = rt.bById.get(ev.visit); if (b) { const d = this.door(st, b), k = sl.role === 'wirt' ? 0.08 : 0.3; X = d.X + d.sx * k; Z = d.Z + d.sz * k; } }
        if (X === undefined) {
          X = wx(ev.x) + (sl.dx || 0); Z = wz(ev.y) + (sl.dz || 0);
          // Spiele ohne festen Platz (Fangen, Toben am Wasser): jeder kommt an einer eigenen Stelle an, nicht alle in der Mitte
          if (!sl.dx && !sl.dz && ev.m.length > 1) { const a = hash(p.id, 61) * 6.283, r = 0.15 + hash(p.id, 62) * 0.25; X += Math.cos(a) * r; Z += Math.sin(a) * r; }
        }
        T.X = X; T.Z = Z; T.cx = X; T.cz = Z; T.r = 0.25;
        T.tx = Math.max(0, Math.min(NX - 1, Math.floor(X + NX / 2))); T.ty = Math.max(0, Math.min(NY - 1, Math.floor(Z + NY / 2)));
        return T;
      }
    }
    if (key === 'W') {
      const wa = this.workArea(st, p, s, false, this.wa || (this.wa = [0, 0, 0]));
      T.X = wa[0]; T.Z = wa[1]; T.cx = wa[0]; T.cz = wa[1]; T.r = wa[2];
      T.tx = Math.max(0, Math.min(NX - 1, Math.floor(T.X + NX / 2))); T.ty = Math.max(0, Math.min(NY - 1, Math.floor(T.Z + NY / 2)));
      return T;
    }
    // Dorfplatz: jeder hat dort seinen eigenen Fleck
    const a = hash(p.id, 51) * Math.PI * 2, r = 0.9 + hash(p.id, 52) * 0.9;
    T.tx = s.cx; T.ty = s.cy; T.X = wx(s.cx) + Math.cos(a) * r; T.Z = wz(s.cy) + Math.sin(a) * r;
    T.cx = wx(s.cx); T.cz = wz(s.cy); T.r = p.job === 'kind' ? 1.7 : p.job === 'alt' ? 1.1 : 1.0 + hash(p.id, 13) * 1.2;
    return T;
  }

  // Einen Weg beginnen: von dort, wo man gerade ist (Tür oder Stelle draußen), zum Ziel
  startTrip(st, p, s, A, key) {
    let fx, fz, ftx, fty;
    // Türschlange: aus derselben Tür tritt höchstens alle 0,8 Sekunden einer hinaus, und keiner, solange jemand hineingeht
    const door = A.inside > 0 ? A.inside : 0, now = this.lastT || 0;
    if (door) { const last = this.doorT.get(door); if (last != null && now >= last && now - last < 0.8 / Math.max(1, this.speed || 1)) return false; }
    if (A.inside > 0) { const b = st._rt.bById.get(A.inside); if (b) { const d = this.door(st, b); fx = d.X; fz = d.Z; ftx = d.tx; fty = d.ty; } }
    if (fx === undefined) {
      if (A.inside) { fx = wx(s.cx); fz = wz(s.cy); } else { fx = A.x; fz = A.z; }
      ftx = Math.max(0, Math.min(NX - 1, Math.floor(fx + NX / 2))); fty = Math.max(0, Math.min(NY - 1, Math.floor(fz + NY / 2)));
    }
    const to = this.target(st, p, s, key);
    let pa = this.path(st, ftx, fty, to.tx, to.ty);
    if (!pa) return false;
    // Ziel draußen (nicht bei Unternehmungen, die haben ihre Plätze): schon beim Losgehen einen freien Platz nehmen,
    // sonst kommen alle am selben Punkt an
    let bx = to.X, bz = to.Z, spot = false;
    if (!to.bid && key[0] !== 'E') { const fs = this.freeSpot(st, to.X, to.Z, p.id); if (fs[2]) { bx = fs[0]; bz = fs[1]; spot = true; } }
    // draußen nicht erst zur Feldmitte laufen: der Weg beginnt und endet am nächsten Punkt der Strecke
    if (!A.inside) pa = trimPath(pa, fx, fz, false);
    if (!to.bid) pa = trimPath(pa, bx, bz, true);
    const f0 = pa.pts[0], f1 = pa.pts[pa.pts.length - 1];
    const s0 = Math.hypot(f0[0] - fx, f0[1] - fz), s1 = Math.hypot(bx - f1[0], bz - f1[1]);
    // zu einer Unternehmung, die auf dem echten Weg weiter als EV_MAX Felder ist, geht man heute nicht (man käme erst am Ende an)
    // (am eigenen Haus nicht: dorthin geht man nach der Arbeit ohnehin)
    if (key[0] === 'E' && A.place !== key && s0 + pa.len + s1 > EV_MAX && !(this.evs.get(+key.slice(1)) || {}).home) { A.skipEv = +key.slice(1); return false; }
    A.trip = { to: key, pa, ax: fx, az: fz, bx, bz, spot, s0, s1, L: s0 + pa.len + s1, d: 0, bid: to.bid, r0: door ? DOOR_RAMP : 0.12, r1: to.bid > 0 ? DOOR_RAMP : 0.12 };
    if (door) this.doorT.set(door, now);
    A.inside = 0; A.place = null; A.wx = null;
    return true;
  }

  // Stelle auf dem Weg nach Strecke d, mit Rechtsverkehr (an den Türen weich auf null)
  tripPos(T, d, id, out, lat = null) {
    const pa = T.pa, f0 = pa.pts[0], f1 = pa.pts[pa.pts.length - 1];
    if (d <= T.s0) { const k = T.s0 ? d / T.s0 : 1; out[0] = T.ax + (f0[0] - T.ax) * k; out[1] = T.az + (f0[1] - T.az) * k; out[3] = f0[0] - T.ax; out[4] = f0[1] - T.az; }
    else if (d >= T.s0 + pa.len) { const k = T.s1 ? (d - T.s0 - pa.len) / T.s1 : 1; out[0] = f1[0] + (T.bx - f1[0]) * k; out[1] = f1[1] + (T.bz - f1[1]) * k; out[3] = T.bx - f1[0]; out[4] = T.bz - f1[1]; }
    else this.along(pa, (d - T.s0) / pa.len, out);
    const ll = Math.hypot(out[3], out[4]);
    if (ll > 1e-5) {
      const side = (lat ?? (LANE + hash(id, 6) * 0.04)) * Math.max(0, rampK(T, d));
      out[0] += -out[4] / ll * side; out[1] += out[3] / ll * side;
    }
    return out;
  }

  // ---------- Nachbarn (seit 21.10.2026) ----------
  // Früher wurden alle jedes Bild auseinandergeschoben und wieder aus den Wänden gedrückt: daher das Ineinanderlaufen und
  // Wackeln. Jetzt: Gehende weichen vorausschauend aus (seitlich vorbei, hinter Langsamen bremsen), Stehende suchen sich
  // einen freien Platz, bevor sie dort ankommen, und bleiben dann ruhig stehen. Grundlage ist ein Raster aller Menschen
  // draußen (aus dem laufenden Bild für das Ausweichen, als Schnappschuss des letzten Bildes für die Platzwahl).
  gridBuild(n) {
    const R = this.recs, G = this.grid;
    G.clear();
    for (let i = 0; i < n; i++) {
      const k = (Math.floor(R[i].x / CELL) + 8192) * 16384 + Math.floor(R[i].z / CELL) + 8192;
      const a = G.get(k);
      if (a) a.push(i); else G.set(k, [i]);
    }
  }
  near(G, list, x, z, rad, fn) {
    const c = Math.ceil(rad / CELL), cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let a = -c; a <= c; a++) for (let b = -c; b <= c; b++) {
      const l = G.get((cx + a + 8192) * 16384 + cz + b + 8192);
      if (l) for (const j of l) fn(list[j], j);
    }
  }
  // Verkehrsregel 4 (render/vehicles.js, seit 24.10.2026): steht oder geht jemand im Kasten vor einem Fahrzeug? Mitte
  // (x, z), vorwärts (c, -s), längs von f0 bis f1, quer bis hw. Aus dem Schnappschuss des letzten Bildes.
  inBox(x, z, c, s, f0, f1, hw) {
    const G = this.sgrid, S = this.snap;
    if (!G || !G.size) return false;
    const m = (f0 + f1) / 2, cx = x + c * m, cz = z - s * m;
    let hit = false;
    this.near(G, S, cx, cz, (f1 - f0) / 2 + hw, q => {
      if (hit) return;
      const rx = q.x - x, rz = q.z - z, fwd = rx * c - rz * s, lat = rx * s + rz * c;
      if (fwd > f0 && fwd < f1 && Math.abs(lat) < hw) hit = true;
    });
    return hit;
  }

  // Schnappschuss des Bildes für das nächste: Stelle, Richtung, bewegt, wer
  snapshot(n) {
    const R = this.recs, S = this.snap, G = this.sgrid, Q = this.pgrid;
    G.clear(); Q.clear();
    for (let i = 0; i < n; i++) {
      const r = R[i], q = S[i] || (S[i] = {});
      q.x = r.x; q.z = r.z; q.id = r.p.id; q.mv = r.moving; q.lie = r.lie; q.trip = r.trip;
      const k = (Math.floor(r.x / CELL) + 8192) * 16384 + Math.floor(r.z / CELL) + 8192;
      const a = G.get(k);
      if (a) a.push(i); else G.set(k, [i]);
      // wer draußen steht oder ein paar Schritte zu einem Platz geht, belegt diesen Platz, wer unterwegs ist, sein Ziel
      if (r.trip) { const T = r.A.trip; if (!T || !T.spot) continue; q.sx = T.bx; q.sz = T.bz; } else { q.sx = r.spx; q.sz = r.spz; }
      const k2 = (Math.floor(q.sx / CELL) + 8192) * 16384 + Math.floor(q.sz / CELL) + 8192;
      const b = Q.get(k2);
      if (b) b.push(i); else Q.set(k2, [i]);
    }
    this.snapN = n;
  }

  // Rückfall für Gehende, die sich trotz Vorausschau berühren: zur Seite über den Versatz (nur quer zum eigenen Weg),
  // und wer hinten ist, bleibt einen Augenblick stehen. Nie rückwärts, darum kein Zittern.
  contact(n, dt) {
    const R = this.recs;
    for (let i = 0; i < n; i++) {
      const a = R[i];
      if (!a.trip || !a.A.trip) continue;
      this.near(this.grid, R, a.x, a.z, 0.08, (b, j) => {
        if (j === i || (a.grp && b.grp === a.grp)) return;
        const min = a.kid || b.kid ? 0.062 : 0.074;
        const rx = b.x - a.x, rz = b.z - a.z, d = Math.hypot(rx, rz);
        if (d >= min) return;
        const T = a.A.trip, l = Math.hypot(a.dx, a.dz) || 1, ux = a.dx / l, uz = a.dz / l;
        const along = rx * ux + rz * uz, side = -rx * uz + rz * ux;
        const kl = Math.max(0.2, rampK(T, T.d));
        const sg = Math.abs(side) > 0.004 ? Math.sign(side) : (a.p.id < b.p.id ? 1 : -1);
        a.A.av = Math.max(-AV_MAX, Math.min(AV_MAX, (a.A.av || 0) - sg * Math.min(0.01, (min - d) / kl)));
        // nur hinter jemandem, der in dieselbe Richtung geht (bei Gegenverkehr hilft nur die Seite)
        const bl = Math.hypot(b.dx, b.dz) || 1, same = b.trip ? (b.dx * ux + b.dz * uz) / bl : 0;
        if (same > 0.5 && !(a.A.passT > this.lastT) && (along > 0.005 || (Math.abs(along) <= 0.005 && a.p.id > b.p.id)) && a.A.cf !== this.frame) { a.A.cf = this.frame; T.d = Math.max(0, T.d - Math.min(a.v * dt, min - d)); }
      });
    }
  }

  // Rückfall für Stehende, die doch aufeinander stehen (Platz nicht frei, Steg, Ankunft): langsam auseinander treten,
  // nie mehr als nötig, wer geht, sitzt oder liegt, wird nicht geschoben. So entsteht kein Zittern.
  settle(n, dt, gs) {
    const R = this.recs, step = 0.12 * Math.max(1, gs) * dt;
    for (let i = 0; i < n; i++) {
      const a = R[i];
      if (a.trip || a.moving || a.fixed) continue;
      this.near(this.grid, R, a.x, a.z, 0.08, (b, j) => {
        if (j <= i || b.trip || b.moving || b.fixed) return;
        const min = (a.kid || b.kid ? 0.065 : 0.078);
        let dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d >= min) return;
        if (d < 1e-4) { const g = hash(a.p.id, b.p.id) * 6.283; dx = Math.cos(g); dz = Math.sin(g); } else { dx /= d; dz /= d; }
        const m = Math.min(step, (min - d) / 2);
        a.x -= dx * m; a.z -= dz * m; b.x += dx * m; b.z += dz * m;
      });
    }
  }

  // Liegt ein Punkt in einem Gebäude (echter Grundriss) oder im Wasser?
  // (water = false: Wasser zählt nicht, für Arbeitsplätze auf Stegen und Booten)
  blockedAt(st, x, z, water = true) {
    const rt = st._rt, ix = Math.floor(x + NX / 2), iy = Math.floor(z + NY / 2);
    if (ix < 1 || iy < 1 || ix >= NX - 1 || iy >= NY - 1) return true;
    if (water && st.tiles.h[iy * NX + ix] < 0) return true;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const bid = rt.bldAt[(iy + oy) * NX + ix + ox];
      if (!bid) continue;
      const b = rt.bById.get(bid);
      if (!b || walkable(st, b)) continue;
      const f = this.footOf ? this.footOf(b.id) : null;
      if (f) { if (x > f[0] - 0.05 && x < f[1] + 0.05 && z > f[2] - 0.05 && z < f[3] + 0.05) return true; } else if (!ox && !oy) return true;
    }
    return false;
  }
  // Steht dort schon jemand oder geht jemand dorthin (letztes Bild), oder hat sich in diesem Bild schon jemand den Platz genommen?
  crowded(x, z, id) {
    let hit = false;
    const lim = SEP * 1.25;
    this.near(this.pgrid, this.snap, x, z, lim, q => { if (!hit && q.id !== id && Math.hypot(q.sx - x, q.sz - z) < lim) hit = true; });
    if (hit) return true;
    const C = this.claims;
    for (let k = 0; k < C.length; k += 3) if (C[k + 2] !== id && Math.hypot(C[k] - x, C[k + 1] - z) < lim) return true;
    return false;
  }
  // Freier Platz nahe (x, z): nicht im Haus, nicht im Wasser, nicht auf jemandem (Spirale nach außen)
  // Mit Ausgangspunkt (fx, fz) muss der gerade Weg dorthin frei sein (man geht die paar Schritte ohne Wegsuche).
  // o[2]: gefunden (sonst o = der gewünschte Punkt)
  freeSpot(st, x, z, id, crowd = true, fx = null, fz = null) {
    const o = this.fsOut || (this.fsOut = [0, 0, false]);
    // liegt der gewünschte Platz selbst im Wasser (Steg, Hafen), zählt Wasser nicht als Hindernis
    const water = !(st.tiles.h[Math.floor(z + NY / 2) * NX + Math.floor(x + NX / 2)] < 0);
    for (let k = 0; k < 16; k++) {
      const a = k * 2.39996, rr = k ? 0.05 + k * 0.035 : 0;
      const cx = x + Math.cos(a) * rr, cz = z + Math.sin(a) * rr;
      if (this.blockedAt(st, cx, cz, water) || (crowd && this.crowded(cx, cz, id))) continue;
      if (fx != null && !this.lineFree(st, fx, fz, cx, cz, water)) continue;
      o[0] = cx; o[1] = cz; o[2] = true;
      this.claims.push(cx, cz, id);
      return o;
    }
    o[0] = x; o[1] = z; o[2] = false;
    return o;
  }
  lineFree(st, ax, az, bx, bz, water = true) {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.12);
    for (let k = 1; k < n; k++) if (this.blockedAt(st, ax + (bx - ax) * k / n, az + (bz - az) * k / n, water)) return false;
    return true;
  }

  // Wer frei geht (nicht auf einem Weg): steht jemand vor ihm, geht er seitlich vorbei und bleibt auf dieser Seite,
  // bis er vorbei ist. Steht jemand direkt auf dem Weg, wartet er kurz.
  steer(A, id, ux, uz, look) {
    let bA = look, bS = 0, hit = false, close = false;
    const W = SEP * 1.15;
    this.near(this.sgrid, this.snap, A.x, A.z, look + 0.15, q => {
      if (q.id === id) return;
      const rx = q.x - A.x, rz = q.z - A.z, along = rx * ux + rz * uz;
      if (along <= 0 || along > look) return;
      const side = -rx * uz + rz * ux;
      if (Math.abs(side) > W) return;
      if (along < bA) { bA = along; bS = side; hit = true; close = along < 0.075; }
    });
    if (!hit) { A.sdir = 0; return null; }
    if (!A.sdir) A.sdir = bS >= 0 ? -1 : 1;
    const nx = -uz * A.sdir, nz = ux * A.sdir;
    const vx = ux + nx * 1.4, vz = uz + nz * 1.4, l = Math.hypot(vx, vz);
    const o = this.stOut || (this.stOut = [0, 0, false]);
    o[0] = vx / l; o[1] = vz / l; o[2] = close;
    return o;
  }

  // Gehende auf einem Weg: vorausschauend ausweichen (seitlicher Versatz av, weich), sonst hinter dem anderen bremsen.
  // Gegenverkehr geht rechts vorbei, wer gleich schnell in dieselbe Richtung geht, ist kein Hindernis. An den Türen
  // (Anfang und Ende des Weges) gibt es keinen Platz zur Seite: dort geht man hintereinander, die kleinere Id zuerst.
  // Kreuzt jemand den Weg, wartet der, der später an der Kreuzung wäre (gleich: die größere Id), kurz.
  avoid(r, i, dt, gs) {
    const A = r.A, l = Math.hypot(r.dx, r.dz), T = A.trip;
    if (l < 1e-5) return;
    if (T && T.L - T.d < 0.05) { A.slow = 1; return; } // gleich da: nicht mehr bremsen
    const ux = r.dx / l, uz = r.dz / l, nx = -uz, nz = ux, v = Math.max(1e-3, r.v);
    // wie stark wirkt der seitliche Versatz hier (tripPos blendet ihn an den Türen aus)
    const kl = T ? Math.max(0.05, rampK(T, T.d)) : 1;
    let bA = 9, bS = 0, bW = 0, found = false, keep = false, yieldS = 1;
    this.near(this.grid, this.recs, r.x, r.z, 0.62, (q, j) => {
      if (j === i || (r.grp && q.grp === r.grp)) return;
      const rx = q.x - r.x, rz = q.z - r.z, dist = Math.hypot(rx, rz);
      let along = rx * ux + rz * uz;
      const side = rx * nx + rz * nz, w = (q.kid || r.kid ? 0.85 : 1) * SEP * 1.25;
      let same = 0;
      if (q.trip) {
        const ql = Math.hypot(q.dx, q.dz) || 1;
        same = (q.dx * ux + q.dz * uz) / ql;
        if (Math.abs(same) < 0.7 && dist < 0.6) {
          // kreuzt: wann sind wir uns am nächsten, und wie nah?
          const qv = q.v / ql, vx = q.dx * qv - ux * v, vz = q.dz * qv - uz * v, vv = vx * vx + vz * vz;
          if (vv > 1e-6) {
            const tc = -(rx * vx + rz * vz) / vv;
            if (tc > -0.1 && tc < 2.2) {
              const cx = rx + vx * tc, cz = rz + vz * tc;
              if (Math.hypot(cx, cz) < w) {
                // wer ist später an der Stelle, an der sich die Wege treffen? (Abstand längs des eigenen Weges)
                const mine = along, theirs = -(rx * q.dx + rz * q.dz) / ql;
                const iWait = mine > theirs + 0.03 || (Math.abs(mine - theirs) <= 0.03 && r.p.id > q.p.id);
                if (iWait) yieldS = Math.min(yieldS, Math.max(0, Math.min(1, (dist - 0.08) / 0.3)) * 0.4);
              }
            }
          }
          return;
        }
      }
      if (along < -0.01 || along > 0.55) return; // wer hinter mir ist, achtet selbst auf mich
      if (along < 0.2 && Math.abs(side) < w * 1.6) keep = true; // jemand dicht daneben: nicht zurück in die Spur
      if (Math.abs(side) >= w) return;
      if (q.trip) {
        if (same > 0.7 && q.v >= r.v * 0.95 && along > 0.1) return; // läuft mit Abstand vorweg, gleich schnell oder schneller
        if (along < 0.01) {
          // gleichauf: in derselben Richtung geht die kleinere Id vor, die andere lässt ihr den Vortritt; sonst nur zur Seite
          if (same <= 0.7 || r.p.id < q.p.id) return;
          along = 0.03;
        }
      } else if (along < 0) return;
      // genau auf derselben Spur: wer die kleinere Id hat, geht rechts daneben
      const sd = Math.abs(side) < 0.012 ? (r.p.id < q.p.id ? -0.012 : 0.012) : side;
      if (along < bA) { bA = along; bS = sd; bW = w; found = true; }
    });
    let want = 0, slow = 1;
    const av = A.av || 0;
    if (found) {
      // eigener Versatz um d verschiebt den anderen relativ um -d: so weit, dass er ganz neben einem ist
      const dPlus = (bS + bW) / kl, dMinus = (bS - bW) / kl;
      // bei der Seite bleiben, zu der man schon ausweicht (sonst pendelt man zwischen links und rechts)
      let d = A.avD ? (A.avD > 0 ? dPlus : dMinus) : Math.abs(dPlus) <= Math.abs(dMinus) ? dPlus : dMinus;
      if (Math.abs(av + d) > AV_MAX) d = Math.abs(av + (d === dPlus ? dMinus : dPlus)) <= AV_MAX ? (d === dPlus ? dMinus : dPlus) : d;
      want = Math.max(-AV_MAX, Math.min(AV_MAX, av + d));
      if (Math.abs(av + d) > AV_MAX + 1e-3) slow = Math.max(0, Math.min(1, (bA - 0.1) / 0.25)); // kein Platz: hinterher
      else if (Math.abs(want - av) > 0.02) slow = Math.max(0.35, Math.min(1, (bA - 0.05) / 0.3)); // beim Ausweichen etwas langsamer
      A.avT = 0.6; A.avD = Math.sign(want - av) || A.avD || 0;
    } else if (keep || (A.avT = (A.avT || 0) - dt) > 0) want = av; // auf der Seite bleiben, bis man vorbei ist
    if (!found && !keep) A.avD = 0;
    slow = Math.min(slow, yieldS);
    // nicht ewig warten: nach 2,5 Sekunden geht er gut eine Sekunde einfach weiter (dann weichen die anderen)
    const now = this.lastT || 0;
    if (A.passT > now) slow = 1;
    else { A.stuck = slow < 0.2 ? (A.stuck || 0) + dt : 0; if (A.stuck > 2.5) { A.passT = now + 1.2; A.stuck = 0; slow = 1; } }
    // seitlich weich; ist jemand schon ganz nah, schneller zur Seite
    const rate = (found ? (bA < 0.12 && Math.abs(bS) < 0.08 ? 0.9 : 0.3) : 0.12) * Math.max(1, gs);
    A.av = av + Math.max(-rate * dt, Math.min(rate * dt, want - av));
    A.slow = (A.slow ?? 1) + (slow - (A.slow ?? 1)) * Math.min(1, dt * 5);
  }

  // Unternehmung vor Ort: wohin, welche Pose, wohin schauen (Spiele bewegen sich, alles andere steht auf seinem Platz)
  eventAct(st, p, s, A, ev, sl, t, dt, gs) {
    const E = this.ea || (this.ea = {});
    E.gx = null; E.gz = null; E.run = false; E.pose = sl.pose || 'idle'; E.face = sl.face ?? null; E.lie = !!sl.lie; E.seat = !!sl.seat;
    E.item = sl.item === undefined ? null : sl.item; // bei Unternehmungen nur, was dazu gehört (Angel, Buch, Korb), kein Werkzeug E.mv = WALK_V * 0.8 * gs; E.fixed = E.lie || E.seat || POSED.has(E.pose); E.next = false;
    const cx = wx(ev.x), cz = wz(ev.y), dyn = sl.dyn || ev.dyn, rs = Math.max(1, gs);
    let S = this.evState.get(ev.id);
    if (!S) this.evState.set(ev.id, S = { t0: t, ready: new Set(), found: new Set(), from: 0, to: 1, tt: t, phase: 0, idx: 0 });
    const idx = ev.m.indexOf(p.id);
    if (A.evKey !== ev.id) { A.evKey = ev.id; A.tgx = null; A.tgT = 0; A.slot = null; }
    if (dyn === 'loop') {
      // am Treffpunkt warten, bis alle da sind (höchstens 8 Sekunden), dann gemeinsam die Runde gehen
      S.ready.add(p.id);
      if (!S.goT && (S.ready.size >= ev.m.length || t - S.t0 > 8 / rs)) S.goT = t;
      E.gx = A.x; E.gz = A.z; E.pose = 'idle'; E.fixed = false;
      const other = ev.m.find(id => id !== p.id), oa = other && this.sm.get(other);
      if (oa) E.face = Math.atan2(oa.x - A.x, oa.z - A.z);
      // an jedem weiteren Punkt kurz auf den anderen warten, wenn er zurückgefallen ist (höchstens 4 Sekunden)
      const behind = ev.m.some(id => { const o = id !== p.id && this.sm.get(id); return o && !o.inside && (o.loopK || 0) < (A.loopK || 0); });
      if (behind) A.lw = (A.lw || 0) + dt; else A.lw = 0;
      if (S.goT && (!behind || A.lw > 4 / rs)) { E.next = true; A.lw = 0; }
      return E;
    }
    if (dyn === 'tag' || dyn === 'shore') {
      // Fangen und Spielen am Wasser: alle paar Augenblicke ein neues Ziel, wer "dran" ist, jagt den Nächsten
      if (!A.tgx || t > A.tgT) {
        let tx, tz;
        if (dyn === 'shore') {
          const nx = ev.nx ?? 0, nz = ev.ny ?? 1, u = (hash(p.id, Math.floor(t * 3)) - 0.5) * 1.6, w = 0.12 + hash(Math.floor(t * 3), p.id) * 0.28;
          tx = cx - nz * u + nx * w; tz = cz + nx * u + nz * w;
        } else if (sl.it) {
          let bd = 9; tx = cx; tz = cz;
          for (const id of ev.m) { if (id === p.id) continue; const q = this.sm.get(id); if (q && !q.inside) { const d = Math.hypot(q.x - A.x, q.z - A.z); if (d < bd) { bd = d; tx = q.x; tz = q.z; } } }
        } else {
          const a = hash(p.id, Math.floor(t * 2)) * Math.PI * 2, r = (sl.r || 1) * Math.sqrt(hash(Math.floor(t * 2), p.id));
          tx = cx + Math.cos(a) * r; tz = cz + Math.sin(a) * r;
        }
        if (this.blockedAt(st, tx, tz)) { tx = cx; tz = cz; }
        A.tgx = tx; A.tgz = tz; A.tgT = t + (sl.it ? 0.5 : 1.1 + hash(p.id, Math.floor(t)) * 1.4) / rs;
      }
      E.gx = A.tgx; E.gz = A.tgz; E.run = true; E.mv = 0.4 * gs; E.pose = 'cheer'; E.fixed = false;
      return E;
    }
    if (dyn === 'ball') {
      // Ball im Kreis zuwerfen: alle 1,5 Sekunden ein Wurf, wer fängt, bückt sich, wer wirft, holt aus
      const n = ev.m.length, dur = (ev.k === 'fussball' ? 0.7 : 0.9) / rs, pause = 0.6 / rs;
      if (t - S.tt > dur + pause) { S.from = S.to; S.to = (S.from + 1 + Math.floor(hash(ev.id, Math.floor(t * 10)) * (n - 1))) % n; S.tt = t; }
      E.gx = cx + sl.dx; E.gz = cz + sl.dz; E.fixed = false;
      const u = (t - S.tt) / dur;
      const fid = ev.m[S.from], tid = ev.m[S.to], fa = this.sm.get(fid), ta = this.sm.get(tid);
      if (idx === S.to && u > 0.75 && u < 1.4) E.pose = 'pickup';
      else if (idx === S.from && u < 0.25) E.pose = 'cheer';
      else E.pose = 'idle';
      const look = idx === S.from ? ta : fa;
      if (look) E.face = Math.atan2(look.x - A.x, look.z - A.z);
      return E;
    }
    if (dyn === 'seek') {
      // Verstecken: einer zählt (5 Sekunden), dann sucht er einen nach dem anderen; Gefundene warten an der Mitte
      const hiders = ev.m.filter((id, k) => k > 0);
      if (S.phase === 0 && t - S.t0 > 5 / rs) S.phase = 1;
      if (idx === 0) {
        if (S.phase === 0) { E.gx = cx; E.gz = cz; E.pose = 'idle'; E.face = 0; return E; }
        const hid = hiders[S.idx % Math.max(1, hiders.length)], hs = hid && ev.sl.get(hid);
        if (!hs || S.found.size >= hiders.length) { if (!S.doneT) S.doneT = t; if (t - S.doneT > 3 / rs) { S.found.clear(); S.phase = 0; S.t0 = t; S.idx = 0; S.doneT = 0; } E.gx = cx; E.gz = cz; E.pose = 'cheer'; return E; }
        E.gx = cx + hs.dx; E.gz = cz + hs.dz; E.run = true; E.mv = 0.32 * gs; E.pose = 'idle';
        if (Math.hypot(A.x - E.gx, A.z - E.gz) < 0.16) { S.found.add(hid); S.idx++; }
        return E;
      }
      if (S.found.has(p.id)) { const a = idx * 1.3; E.gx = cx + Math.cos(a) * 0.22; E.gz = cz + Math.sin(a) * 0.22; E.pose = 'cheer'; E.face = Math.atan2(-Math.cos(a), -Math.sin(a)); return E; }
      E.gx = cx + sl.dx; E.gz = cz + sl.dz; E.pose = S.phase === 0 ? 'idle' : 'pickup'; E.run = true; E.mv = 0.36 * gs; // geduckt im Versteck
      return E;
    }
    if (sl.door && ev.visit) {
      const b = st._rt.bById.get(ev.visit);
      if (b) {
        const d = this.door(st, b), k = sl.role === 'wirt' ? 0.08 : 0.3;
        E.gx = d.X + d.sx * k; E.gz = d.Z + d.sz * k; E.face = sl.role === 'wirt' ? Math.atan2(d.sx, d.sz) : Math.atan2(-d.sx, -d.sz);
        return E;
      }
    }
    // fester Platz: einmal gegen Wände geprüft und gemerkt
    if (!A.slot) {
      const X = cx + (sl.dx || 0), Z = cz + (sl.dz || 0);
      const f = (E.fixed || E.lie) && !this.blockedAt(st, X, Z) ? [X, Z] : this.freeSpot(st, X, Z, p.id, false);
      A.slot = [f[0], f[1]];
    }
    E.gx = A.slot[0]; E.gz = A.slot[1];
    return E;
  }

  // Jedes Bild: jeder Mensch ist ein kleiner Läufer mit eigenem Weg. Tagesplan sagt, wohin er gehört; er geht dorthin
  // in echtem Schritttempo (bei 3× und 10× entsprechend schneller), weite Wege beginnen früher. Drinnen ist er unsichtbar.
  update(st, f, t, weather, selId) {
    if (!this.figs.length) return;
    const rt = st._rt, o = this.o;
    const cam = this.cam ? this.cam.position : null;
    // Schatten der Menschen nur, wenn die Kamera nah genug ist; Sichtweite wächst mit der Höhe der Kamera
    const close = !cam || cam.y < 42;
    const far2 = this.hidden ? 0 : !cam ? Infinity : cam.y > 75 ? 0 : Math.min(FAR, 14 + cam.y * 1.5) ** 2;
    for (const F of this.figs) F.begin(close);
    this.props.begin();
    this.uTime.value = t;
    this.frame = (this.frame || 0) + 1;
    const dt = Math.min(0.2, Math.max(0, t - (this.lastT ?? t)));
    this.lastT = t;
    this.budget = 30;
    this.siteCache.clear();
    this.claims.length = 0;
    const stormy = weather.kind === 'sturm' || weather.kind === 'schnee' && hash(Math.floor(t / 30)) < 0.5;
    this.stormy = stormy;
    const wet = stormy || weather.kind === 'regen';
    const gs = Math.max(1, Math.min(12, this.speed || 1));
    const dayLen = (this.vdays || 6) * DAY_SECONDS;
    // Programm des Tages (leisure.js): Unternehmungen nach Id
    const PG = program(st);
    if (this.pg !== PG) { this.pg = PG; this.evs = new Map(PG.list.map(e => [e.id, e])); this.evState.clear(); }
    const present = this.present;
    present.clear();
    this.ids.length = 0;
    this.pos.clear();
    const out = [0, 0, 0, 0, 0];
    const R = this.recs;
    let n = 0;
    // Wer ist in welchem Haus wach, schläft, kocht? (für Fensterlicht, Rauch und die Innenansicht)
    const HS = this.homeStats || (this.homeStats = new Map());
    for (const v of HS.values()) { v.awake = 0; v.sleep = 0; v.cook = false; v.n = 0; }
    const IN = this.inside || (this.inside = new Map());
    IN.clear();
    const noon = f > 0.47 && f < 0.515;
    for (const p of st.people) {
      if (p.away || (this.skip && this.skip.has(p.id))) { this.sm.delete(p.id); continue; } // skip: unterwegs als Kundschafter (treks.js)
      const s = rt.sById.get(p.s);
      if (!s || !s.alive) continue;
      const kid = p.job === 'kind', old = p.job === 'alt';
      let A = this.sm.get(p.id);
      const skipE = (A && A.skipEv) || 0; // Unternehmung, die er heute auslässt (zu weit)
      const P = plan(st, p, f, t, stormy, skipE);
      const at = P.at, act = P.act, outK = P.out;
      let key = this.keyOf(st, p, P);
      if (!A) {
        // Neu im Bild (Spielstart, Laden): gleich dort, wo er laut Plan sein soll
        A = { x: 0, z: 0, inside: 0, place: key, trip: null, wx: null, wait: hash(p.id, 3) * 4, mode: 'idle', dx: 0, dz: 1, av: 0, slow: 1 };
        this.curA = A;
        const T0 = this.target(st, p, s, key);
        if (T0.bid) A.inside = T0.bid; else { A.x = T0.X; A.z = T0.Z; }
        this.sm.set(p.id, A);
      }
      this.curA = A;
      const key0 = key;
      let fresh = false; // in diesem Bild früher aufgebrochen
      // Vorausschauen: wer weit gehen muss, bricht früher auf (aber nicht aus dem Schlaf)
      if (!A.trip && A.place === key && act !== 'sleep' && act !== 'sick' && outK !== 'walk' && gs < 50) {
        // beginnt bald eine Unternehmung, geht man direkt dorthin, so dass man zum Beginn da ist (nicht erst nach Hause)
        const nev = key[0] !== 'E' ? nextEvent(st, p, phaseOf(p, f), 0.3, skipE) : null;
        if (nev) {
          const k2 = 'E' + nev.id, T2 = this.target(st, p, s, k2);
          let hx = A.x, hz = A.z;
          if (A.inside > 0) { const b = rt.bById.get(A.inside); if (b) { const d = this.door(st, b); hx = d.X; hz = d.Z; } }
          const lead = Math.min(0.3, Math.hypot(T2.X - hx, T2.Z - hz) * 1.4 / (WALK_V * dayLen));
          if (phaseOf(p, f) + lead >= nev.w[0]) { A.ahead = k2; A.aheadFrom = key; key = k2; fresh = true; }
        }
        let key2 = nev ? key : this.keyOf(st, p, plan(st, p, (f + 0.14) % 1, t, stormy, skipE)), cap = key[0] === 'E' ? 0.02 : 0.14;
        if (key2 !== key) {
          const T2 = this.target(st, p, s, key2);
          let hx = A.x, hz = A.z;
          if (A.inside > 0) { const b = rt.bById.get(A.inside); if (b) { const d = this.door(st, b); hx = d.X; hz = d.Z; } }
          // von einer Unternehmung geht man nicht früher weg (sonst ist man kaum da, wenn man weit wohnt)
          const lead = Math.min(cap, Math.hypot(T2.X - hx, T2.Z - hz) * 1.35 / (WALK_V * dayLen));
          if (lead > 0.004 && this.keyOf(st, p, plan(st, p, (f + lead) % 1, t, stormy, skipE)) === key2) { A.ahead = key2; A.aheadFrom = key; key = key2; fresh = true; }
        }
      }
      // schon früher aufgebrochen: solange der Plan noch das alte Ziel sagt, bleibt es beim neuen (sonst pendelt man).
      // Zu einer Unternehmung geht man weiter, auch wenn der Plan unterwegs wechselt, bis sie beginnt
      if (A.ahead && !fresh) {
        const on = A.trip ? A.trip.to === A.ahead : A.place === A.ahead, aev = A.ahead[0] === 'E' && this.evs.get(+A.ahead.slice(1));
        if (key0 === A.ahead) A.ahead = null;
        else if (on && (key0 === A.aheadFrom || (aev && key0[0] !== 'E' && phaseOf(p, f) < aev.w[0] && aev.w[0] - phaseOf(p, f) < 0.35))) key = A.ahead;
        else A.ahead = null;
      }
      // Unterwegs, Ziel gewechselt oder noch nicht angekommen: Weg (neu) beginnen
      // (gibt es gerade keinen neuen Weg, geht er den alten weiter, statt mitten auf der Straße stehen zu bleiben)
      if ((A.trip && A.trip.to !== key) || (!A.trip && A.place !== key)) {
        const old = A.trip, ox = A.x, oz = A.z;
        if (old) { const pos = this.tripPos(old, old.d, p.id, out, A.lat); A.x = pos[0]; A.z = pos[1]; A.trip = null; A.inside = 0; }
        if (A.place !== key) { A.loopK = 0; A.slot = null; A.evKey = 0; }
        if (!this.startTrip(st, p, s, A, key) && old) { A.trip = old; A.x = ox; A.z = oz; }
      }
      const ev = key[0] === 'E' && this.evs ? this.evs.get(+key.slice(1)) : null, sl = ev ? ev.sl.get(p.id) : null;
      let x = A.x, z = A.z, dx = A.dx, dz = A.dz, mode = 'idle', moving = false, vNow = 0;
      let faceAng = null, lie = false, seat = false, item, fixed = false, spx = null, spz = null;
      if (A.trip) {
        const T = A.trip;
        const loopEv = ev && ev.dyn === 'loop' && T.to === key;
        // Tempo nach Alter und Wetter: Alte langsamer, Kinder etwas flotter, bei Regen und Sturm eilig; auf einer Runde
        // zu zweit gehen beide genau gleich schnell (Seite an Seite)
        vNow = loopEv ? WALK_V * gs * ev.slow : WALK_V * gs * (old ? 0.74 + hash(p.id, 21) * 0.12 : kid ? 1.02 + hash(p.id, 21) * 0.16 : 0.92 + hash(p.id, 21) * 0.16) * (wet ? 1.3 : 1);
        vNow *= A.slow ?? 1;
        T.d += vNow * dt;
        if (T.bid > 0 && T.L - T.d < 0.35) this.doorT.set(T.bid, t); // geht gleich hinein: niemand kommt ihm entgegen heraus
        if (T.d >= T.L - 1e-3 || T.L < 0.03) { // (ein Weg ohne Länge endet sofort)
          A.trip = null; A.place = T.to;
          if (T.bid) A.inside = T.bid;
          else {
            A.x = T.bx; A.z = T.bz; A.wait = 1 + hash(p.id, Math.floor(t)) * 3; A.wx = null;
            // nicht auf jemandem stehen bleiben, der schon dort ist: die letzten Schritte zu einem freien Platz
            if (!(ev && sl)) {
              const fs = this.freeSpot(st, T.bx, T.bz, p.id, true, T.bx, T.bz);
              if (fs[2] && Math.hypot(fs[0] - T.bx, fs[1] - T.bz) > 0.01) { A.wx = fs[0]; A.wz = fs[1]; A.wait = 0; A.wT = t + 2 + Math.hypot(fs[0] - T.bx, fs[1] - T.bz) / (0.13 * gs); }
            }
          }
          if (loopEv) A.loopK = (A.loopK || 0) + 1;
          A.av = 0; A.slow = 1;
        } else {
          this.tripPos(T, T.d, p.id, out, A.lat);
          // seitlicher Versatz: Gehweg oder rechts der Mitte (zu zweit: Seite an Seite) plus Ausweichen, weich nachgeführt.
          // Gemessen auf der Wegmitte, nicht an der eigenen Stelle (sonst springt man an Straßenkanten hin und her)
          const ll = Math.hypot(out[3], out[4]) || 1, sd = Math.max(0, rampK(T, T.d)) * (A.lat || 0);
          const lane = loopEv && sl && sl.lane != null ? sl.lane : this.sideAt(st, out[0] + out[4] / ll * sd, out[1] - out[3] / ll * sd, p.id, out[3], out[4]);
          A.lane = A.lane == null ? lane : A.lane + (lane - A.lane) * Math.min(1, dt * 4);
          A.lat = A.lane + (A.av || 0);
          x = out[0]; z = out[1]; dx = out[3]; dz = out[4]; mode = loopEv && ev.run ? 'run' : 'walk'; moving = true;
          A.x = x; A.z = z;
        }
      }
      if (!A.trip && !A.inside && A.place === key) {
        let gx = null, gz = null, run = false, mv = WALK_V * 0.8 * gs, pose = null;
        const war = outK === 'work' && p.job === 'krieger' && s.war;
        if (ev && sl) {
          present.set(ev.id, (present.get(ev.id) || 0) + 1);
          const E = this.eventAct(st, p, s, A, ev, sl, t, dt, gs);
          if (E.next) {
            // Runde: weiter zum nächsten Punkt (gemeinsam losgegangen), ohne Weg dorthin den Punkt auslassen
            if (!this.startTrip(st, p, s, A, key)) A.loopK = (A.loopK || 0) + 1;
          }
          gx = E.gx; gz = E.gz; run = E.run; mv = E.mv; pose = E.pose; faceAng = E.face; lie = E.lie; seat = E.seat; item = E.item; fixed = E.fixed;
        } else {
          // Angekommen draußen: arbeiten, plaudern, spielen, ab und zu ein paar Schritte auf einen freien Platz
          const T = this.target(st, p, s, key);
          if (outK === 'work' && noon && (FIELD.has(p.job) || CRAFT.has(p.job)) && hash(p.id, Math.floor(st.day / 6)) < 0.7) {
            // Mittagspause: hinsetzen und essen, wo man gerade ist
            pose = 'floor'; fixed = true; faceAng = hash(p.id, 5) * 6.283; gx = A.x; gz = A.z;
          } else if (outK === 'plaza' && !kid && this.circle(p, s, t, out)) {
            if (!A.cir || Math.hypot(A.cir[2] - out[0], A.cir[3] - out[1]) > 0.01) {
              const fs = this.freeSpot(st, out[0], out[1], p.id);
              A.cir = [fs[0], fs[1], out[0], out[1]];
            }
            gx = A.cir[0]; gz = A.cir[1]; faceAng = Math.atan2(out[3], out[4]);
          } else {
            A.cir = null;
            if (A.wx == null && A.wait <= 0) {
              const ang = hash(p.id, Math.floor(t * 7)) * Math.PI * 2, rr = T.r * Math.sqrt(hash(Math.floor(t * 7), p.id));
              let tx = T.cx + Math.cos(ang) * rr, tz = T.cz + Math.sin(ang) * rr;
              const ddx = tx - A.x, ddz = tz - A.z, dd = Math.hypot(ddx, ddz), mx = kid ? 1.6 : 0.9;
              if (dd > mx) { tx = A.x + ddx / dd * mx; tz = A.z + ddz / dd * mx; }
              const fs = this.freeSpot(st, tx, tz, p.id, true, A.x, A.z);
              if (fs[2]) { A.wx = fs[0]; A.wz = fs[1]; A.wT = t + 2 + Math.hypot(fs[0] - A.x, fs[1] - A.z) / (0.13 * gs); }
              else A.wait = 1 + hash(p.id, Math.floor(t)) * 2; // gerade kein freier Platz in Reichweite: noch etwas stehen
            }
            if (A.wx != null && t > (A.wT ?? Infinity)) { A.wx = null; A.wait = 0.5; } // kommt nicht hin: anderes Ziel
            if (A.wx != null) { gx = A.wx; gz = A.wz; }
            run = (kid && outK !== 'work') || war;
            mv = (run ? 0.34 : WALK_V * 0.8) * gs;
          }
        }
        if (gx != null) {
          spx = gx; spz = gz;
          const ddx = gx - A.x, ddz = gz - A.z, dd = Math.hypot(ddx, ddz);
          if (dd > 0.02) {
            let ux = ddx / dd, uz = ddz / dd;
            const sv = dd > 0.12 ? this.steer(A, p.id, ux, uz, 0.3) : null;
            let go = 1;
            if (sv) { ux = sv[0]; uz = sv[1]; if (sv[2]) { A.wt = (A.wt || 0) + dt; if (A.wt < 1) go = 0; } else A.wt = 0; } else A.wt = 0;
            const step = Math.min(dd, mv * dt) * go;
            A.x += ux * step; A.z += uz * step;
            dx = ux; dz = uz; moving = step > 1e-6; vNow = mv;
            mode = moving ? (run ? 'run' : 'walk') : 'idle';
          } else {
            if (fixed) { A.x = gx; A.z = gz; }
            if (A.wx != null && !(ev && sl)) { A.wx = null; A.wait = (outK === 'work' ? 8 + hash(p.id, Math.floor(t)) * 14 : kid ? 0.5 + hash(p.id, Math.floor(t)) * 2.5 : 4 + hash(p.id, Math.floor(t)) * 9); }
          }
        }
        if (A.wait > 0) A.wait -= dt * gs;
        if (!moving) {
          if (pose) mode = pose;
          else if (outK === 'work') mode = war ? 'fight' : CRAFT.has(p.job) ? 'hammer' : FIELD.has(p.job) ? 'pickup' : p.job === 'haendler' || p.job === 'priester' || p.job === 'gelehrter' ? 'chat' : 'idle';
          else if (outK === 'yard') mode = hash(p.id, 34) < 0.6 ? 'chat' : 'idle';
          else if (outK === 'play') mode = kid ? (hash(p.id, Math.floor(t / 6)) < 0.3 ? 'cheer' : 'idle') : 'chat';
          else if (outK === 'plaza') {
            const happy = (s.happy ?? s.hap ?? 0.5) > 0.72, fest = festive(st, s.id);
            // Festtag: viele jubeln und tanzen, Kinder hüpfen
            mode = fest ? (hash(p.id, Math.floor(t / 7)) < (kid ? 0.7 : 0.55) ? 'cheer' : 'chat')
              : kid ? 'idle' : happy && hash(p.id, 32) < 0.12 ? 'cheer' : hash(p.id, Math.floor(t / 9)) < 0.78 ? 'chat' : 'idle';
          }
        } else { lie = false; seat = false; fixed = false; faceAng = null; }
        x = A.x; z = A.z;
      }
      A.dx = dx; A.dz = dz;
      A.ev = ev && sl && !A.trip ? ev.k : null; // für den Prüfstand (tools/peoplelab.js)
      // Drinnen: nicht zeichnen, aber für Innenansicht, Fenster und Rauch merken
      if (A.inside) {
        IN.set(p.id, A.inside);
        if (A.inside > 0) {
          let v = HS.get(A.inside);
          if (!v) HS.set(A.inside, v = { awake: 0, sleep: 0, cook: false, n: 0 });
          v.n++;
          if (at !== 'out' && (act === 'sleep' || act === 'sick')) v.sleep++; else v.awake++;
          if (at === 'home' && act === 'cook') v.cook = true;
        }
        if (p.id === selId) {
          const b = A.inside > 0 ? rt.bById.get(A.inside) : null;
          if (b) { const d = this.door(st, b); this.pos.set(p.id, [d.X, groundY(d.X, d.Z), d.Z]); }
        }
        continue;
      }
      const r = R[n] || (R[n] = {});
      r.p = p; r.A = A; r.x = x; r.z = z; r.dx = dx; r.dz = dz; r.mode = mode; r.kid = kid; r.old = old; r.trip = !!A.trip; r.v = moving ? vNow : 0;
      r.moving = moving; r.face = moving ? null : faceAng; r.lie = lie && !moving; r.seat = seat && !moving; r.item = item; r.fixed = fixed && !moving; r.ev = ev;
      r.spx = spx ?? x; r.spz = spz ?? z;
      r.grp = A.trip && ev && ev.dyn === 'loop' && A.trip.to === key ? ev.id : 0; // zu zweit auf einer Runde: Seite an Seite
      n++;
    }
    // Niemand steht in Häusern (wer geht, gleitet an der Wand entlang; Sitzende und Liegende bleiben, wo sie sind)
    this.unblock(st, n, true);
    // Ausweichen der Gehenden auf ihren Wegen für das nächste Bild, dann der Schnappschuss für die Platzwahl
    this.gridBuild(n);
    for (let i = 0; i < n; i++) if (R[i].trip) this.avoid(R[i], i, dt, gs);
    this.contact(n, dt);
    this.settle(n, dt, gs);
    const figs = this.figs;
    for (let i = 0; i < n; i++) {
      const r = R[i], p = r.p;
      if (!r.trip) { r.A.x = r.x; r.A.z = r.z; }
      let x = r.x, z = r.z;
      let ground = roadY(x, z); // auch über Brücken
      if (this.streets) ground += this.streets.lift(x, z); // auf dem Belag stehen, auf dem Gehweg eine Stufe höher
      if (this.floorAt) { // auf Sockel und Terrassen stehen, nicht darin (Feld des Menschen, seit 24.10.2026)
        const ix = Math.floor(x + NX / 2), iy = Math.floor(z + NY / 2), bid = ix >= 0 && iy >= 0 && ix < NX && iy < NY ? st._rt.bldAt[iy * NX + ix] : 0;
        if (bid) ground = Math.max(ground, this.floorAt(bid, x, z));
      }
      let y = ground;
      this.pos.set(p.id, [x, y, z]);
      // Weit weg von der Kamera sind Menschen nur Pünktchen: nicht zeichnen (Klicken und Folgen gehen trotzdem)
      if (cam && p.id !== selId && (x - cam.x) ** 2 + (y - cam.y) ** 2 + (z - cam.z) ** 2 > far2) continue;
      const F = figFor(figs, p);
      if (F.n >= F.max) continue;
      const sc = figureScale(p, r.kid, r.old), body = HEIGHT * sc;
      // Blickrichtung weich nachführen: wer steht und etwas tut, schaut dorthin (Mitte des Kreises, Wasser, Partner)
      const want = r.face != null ? r.face : r.dx || r.dz ? Math.atan2(r.dx, r.dz) : (this.head.get(p.id) ?? hash(p.id, 16) * 6.283);
      let h = this.head.get(p.id);
      if (h === undefined) h = want;
      else { let dd = want - h; dd = Math.atan2(Math.sin(dd), Math.cos(dd)); h += dd * Math.min(1, dt * (r.fixed ? 6 : 10)); }
      this.head.set(p.id, h);
      // Posen: Sitzen und Schneidersitz mit dem Rumpf genau über dem Platz (wie im Haus), auf der Bank höher, Liegen flach
      if (POSED.has(r.mode) && F.trunk && F.trunk[r.mode]) {
        const tr = F.trunk[r.mode], c = Math.cos(h), sn = Math.sin(h);
        x -= (tr[0] * c + tr[1] * sn) * body; z -= (-tr[0] * sn + tr[1] * c) * body;
        if (r.seat && SEATED.has(r.mode)) y = ground + BENCH_H - SEAT_Y * body;
      }
      const mode = r.lie ? 'sleep' : r.mode;
      if (r.lie) y = ground + 0.012;
      o.position.set(x, y, z);
      o.rotation.set(0, h, 0);
      o.scale.setScalar(body);
      o.updateMatrix();
      // Beine passend zum Tempo: Schrittlänge gemessen an der Animation (kein Rutschen)
      const rate = mode === 'walk' ? Math.max(0.5, Math.min(4, (r.v || WALK_V) / (STRIDE * body)))
        : mode === 'run' ? Math.max(0.5, Math.min(3, (r.v || 0.34) / (RUN_STRIDE * body))) : mode === 'fight' ? 0.8 : 1;
      drawPerson(F, p, o.matrix, mode, rate, r.kid, r.old, false, r.item);
      this.ids.push(p.id);
    }
    for (const F of this.figs) F.end();
    this.snapshot(n);
    this.drawProps(st, PG, present, t, dt, cam, far2);
    if (this.head.size > MAX * 2) this.head.clear();
    if (this.sm.size > MAX * 2) this.sm.clear();
    if (this.doorT.size > 8000) this.doorT.clear();
    if (HS.size > 6000) HS.clear();
    // Festtag: Funken und Lichter über dem Dorfplatz (abends, wenn alle da sind)
    if (this.fx && !this.hidden && f > 0.76 && f < 0.95) for (const s of st.settlements) {
      if (!s.alive || !festive(st, s.id) || Math.random() > dt * 6) continue;
      const X = wx(s.cx) + (Math.random() - 0.5) * 2.4, Z = wz(s.cy) + (Math.random() - 0.5) * 2.4;
      const col = [[1, 0.8, 0.4], [1, 0.55, 0.45], [0.6, 0.85, 1], [1, 0.95, 0.6]][Math.floor(Math.random() * 4)];
      this.fx.glow.emit({ x: X, y: groundY(X, Z) + 0.5 + Math.random() * 0.6, z: Z, vy: 0.15, vx: (Math.random() - 0.5) * 0.1, life: 2.2, size: 0.07, c: col, a: 0.9 });
    }
    // Stern über deinem Menschen
    const hp = this.heroId && (this.pos.get(this.heroId) || this.heroDoor(st));
    if (hp && !this.hidden) {
      this.heroMark.visible = true;
      this.heroMark.position.set(hp[0], hp[1] + HEIGHT * 1.35 + Math.sin(t * 2.5) * 0.015, hp[2]);
      this.heroMark.rotation.y = t * 1.5;
    } else this.heroMark.visible = false;
    if (selId && this.pos.has(selId)) {
      const [x, y, z] = this.pos.get(selId);
      this.ring.visible = true; this.ring.position.set(x, y + 0.02, z);
      this.ring.scale.setScalar(1 + Math.sin(t * 4) * 0.12);
    } else this.ring.visible = false;
  }

  // Requisiten: feste Bänke auf den Plätzen und Biergärten (immer), Tücher, Decken, Schirme nur, wenn jemand da ist,
  // der Ball fliegt zwischen den Kindern, über Paaren beim Date steigen ab und zu kleine rosa Lichter auf.
  drawProps(st, PG, present, t, dt, cam, far2) {
    const PR = this.props;
    // Requisiten stehen so weit, wie Menschen gezeichnet werden (mindestens 30 Felder)
    const lim = Math.max(far2, 900), near = (X, Z, r = 0) => !cam || Math.hypot(X - cam.x, Z - cam.z) < Math.sqrt(lim) + r;
    if (!this.hidden && far2) {
      for (const [sid, P] of PG.places) {
        const s = st._rt.sById.get(sid);
        if (!s || !s.alive || !near(wx(s.cx), wz(s.cy), (s.R || 4) + 8)) continue;
        for (const b of P.benches || []) { const X = wx(b.x), Z = wz(b.y); if (near(X, Z)) PR.add('bank', X, groundY(X, Z), Z, Math.atan2(b.nx, b.ny), 2); }
        if (P.garden && (P.bld.taverne || []).length && (s.era | 0) >= 2 && near(wx(P.garden.x), wz(P.garden.y))) {
          const X = wx(P.garden.x), Z = wz(P.garden.y), Y = groundY(X, Z);
          PR.add('tisch', X, Y, Z, 0); PR.add('bank', X, Y, Z - 0.115, 0, 4); PR.add('bank', X, Y, Z + 0.115, Math.PI, 4);
        }
      }
      for (const [id] of present) {
        const ev = this.evs.get(id);
        if (!ev) continue;
        const cx = wx(ev.x), cz = wz(ev.y);
        if (!near(cx, cz)) continue;
        if (ev.props) for (const q of ev.props) {
          const X = cx + (q.dx || 0), Z = cz + (q.dz || 0), Y = groundY(X, Z);
          if (q.t === 'feuer') {
            // flackert, Funken und etwas Rauch nahe der Kamera (wie bei den Kundschaftern)
            const fl = 1 + 0.22 * Math.sin(t * 13.1 + id) + 0.12 * Math.sin(t * 23.7 + id * 0.3);
            PR.add('feuer', X, Y, Z, 0, fl, 1, (id % 97) / 97);
            if (this.fx && cam && (X - cam.x) ** 2 + (Z - cam.z) ** 2 < 900) {
              if (Math.random() < dt * 6) this.fx.glow.emit({ x: X + (Math.random() - 0.5) * 0.06, y: Y + 0.14, z: Z + (Math.random() - 0.5) * 0.06, vx: (Math.random() - 0.5) * 0.06, vy: 0.25 + Math.random() * 0.2, vz: (Math.random() - 0.5) * 0.06, life: 0.9 + Math.random() * 0.8, size: 0.026, c: [1, 0.62, 0.25], a: 0.95, drag: 0.97 });
              if (Math.random() < dt * 1.6) this.fx.smoke.emit({ x: X, y: Y + 0.25, z: Z, vy: 0.1, vx: 0.02, life: 3, size: 0.09, grow: 2.2, c: [0.55, 0.55, 0.58], a: 0.18 });
            }
          } else PR.add(q.t, X, Y, Z, q.rot || 0, q.w || 1, q.d || 1, q.c || 0);
        }
        if (ev.ball) {
          const S = this.evState.get(id);
          if (S) {
            const fa = this.sm.get(ev.m[S.from]), ta = this.sm.get(ev.m[S.to]);
            if (fa && ta && !fa.inside && !ta.inside) {
              const gs = Math.max(1, Math.min(12, this.speed || 1)), dur = (ev.k === 'fussball' ? 0.7 : 0.9) / gs, u = Math.min(1, (t - S.tt) / dur);
              const X = fa.x + (ta.x - fa.x) * u, Z = fa.z + (ta.z - fa.z) * u, hgt = ev.k === 'fussball' ? 0.03 * Math.sin(u * Math.PI) : 0.16 * Math.sin(u * Math.PI);
              PR.add('ball', X, groundY(X, Z) + 0.022 + hgt + (ev.k === 'fussball' ? 0 : 0.07), Z, 0, 1, 1, ev.k === 'fussball' ? 0.9 : 0.1);
            }
          }
        }
        if (ev.hearts && this.fx && present.get(id) >= 2 && Math.random() < dt * 0.8) {
          const a = this.sm.get(ev.m[0]), b = this.sm.get(ev.m[1]);
          if (a && b && !a.trip && !b.trip && Math.hypot(a.x - b.x, a.z - b.z) < 0.5) {
            const X = (a.x + b.x) / 2, Z = (a.z + b.z) / 2;
            this.fx.glow.emit({ x: X, y: groundY(X, Z) + 0.3, z: Z, vy: 0.08, vx: 0, life: 1.8, size: 0.045, c: [1, 0.55, 0.72], a: 0.85 });
          }
        }
      }
    }
    PR.end();
  }
}
