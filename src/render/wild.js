// Wildtiere je Lebensraum (seit 19.10.2026, Paket 4 aus PLAN_WELTLOGIK.md, Naders Wunsch: Tiere passend zur Landschaft
// mit Verhalten). Nur im Bild, die Simulation kennt weiter nur Füchse und Wölfe.
// Herden mit Leittier (Rehe, Hirsche, Pferde, Zebras, Antilopen, Giraffen, Kamele, Rentiere, Kühe am Viehhof): grasen,
// ziehen weiter, ruhen, trinken am Wasser, fliehen im Galopp vor Menschen und dem Geist. Einzelgänger am Boden (Hasen,
// Echsen, Skorpione, Frösche, Schlangen) streifen um ihren Platz und huschen weg. Schmetterlinge und Libellen flattern
// bei Sonne, Reiher stehen im Flachen und stoßen nach Fischen, Robben liegen an kalten Küsten. Tagesrhythmus je Art.
// Es entstehen nur Tiere nahe am Blick und außerhalb des Bildes (kein Aufploppen), wer weit weg ist, verschwindet.
// Seit 21.10.2026 mit festen Regeln je Art (animal_rules.js): Wildtiere nie auf Straßen, Plätzen, in Orten oder Gebäuden,
// scheu mit Abstand zu Orten, Huftiere der Ebene nicht an Steilhängen. Kühe stehen auf einer eingezäunten Weide am Viehhof
// (`farms`), grasen von Feld zu Feld, liegen nachts und laufen nie davon.
import * as THREE from 'three';
import { AnimalRules } from './animal_rules.js';
import { NX, NY, wx, wz } from './scene.js';
import { groundY } from './terrain.js';
import { BIOMES } from '../sim/data.js';
import { U as MU } from './mats.js';

const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const rnd = (a, b) => a + Math.random() * (b - a);
const BKEY = BIOMES.map(b => b.key);
const WHITE = new THREE.Color('#ffffff');
const tints = list => list.map(c => new THREE.Color(c));

// Arten: Gruppe (herd, solo, fly, wader, shore), Tempo Gehen und Flucht (Welteinheiten je Sekunde), Fluchtdistanz,
// Abstand in der Herde, aktiv (Tag, Dämmerung, Nacht als Anteil), Clips, Tönungen
// Größe zu den Menschen (seit 25.10.2026, Menschen 0,18 statt 0,27 hoch): vorher war ein Hund länger als ein Mensch groß.
// Faktor auf die Länge (animals.js SPECIES), die Tempi der Wildtiere und Haustiere gehen mit, etwas größer als in echt,
// damit man sie von oben noch erkennt
export const SHRINK = {
  wolf: 0.48, fox: 0.45, dog: 0.43, cat: 0.42, chick: 0.55, bird: 0.67, fish: 0.75, whale: 0.8,
  deer: 0.52, stag: 0.5, reindeer: 0.5, antelope: 0.52, horse: 0.58, zebra: 0.57, giraffe: 0.72, camel: 0.58, cow: 0.6,
  hare: 0.38, snowhare: 0.38, lizard: 0.36, scorpion: 0.38, frog: 0.42, snake: 0.5, butterfly: 0.4, dragonfly: 0.42, heron: 0.58, seal: 0.6,
};
export const WILD_SPECIES = {
  deer: { group: 'herd', walk: 0.32, run: 1.9, fd: 3.6, gap: 0.55, act: [0.55, 1, 0.25], tint: tints(['#ffffff', '#f2e6dc', '#e8ddd0']) },
  stag: { group: 'herd', walk: 0.34, run: 1.9, fd: 3.4, gap: 0.7, act: [0.5, 1, 0.25] },
  reindeer: { group: 'herd', walk: 0.34, run: 1.7, fd: 3.0, gap: 0.6, act: [1, 1, 0.4], tint: tints(['#ffffff', '#ece6de', '#d8d2cc']) },
  antelope: { group: 'herd', walk: 0.36, run: 2.2, fd: 3.8, gap: 0.5, act: [1, 1, 0.3], tint: tints(['#ffffff', '#f6ece0']) },
  horse: { group: 'herd', walk: 0.36, run: 1.8, fd: 2.8, gap: 0.75, act: [1, 1, 0.35], tint: tints(['#8a5a36', '#5a3a26', '#a8784a', '#2e2622', '#e8e2d6', '#c8a070', '#7a6a5a']) },
  zebra: { group: 'herd', walk: 0.34, run: 1.8, fd: 3.0, gap: 0.7, act: [1, 1, 0.35] },
  giraffe: { group: 'herd', walk: 0.3, run: 1.4, fd: 3.4, gap: 1.0, act: [1, 1, 0.4] },
  camel: { group: 'herd', walk: 0.28, run: 1.2, fd: 2.2, gap: 0.9, act: [1, 1, 0.3], tint: tints(['#ffffff', '#f0e2d0', '#e0ccb4']) },
  cow: { group: 'farm', walk: 0.12, run: 0.26, fd: 0, gap: 0.8, act: [1, 0.8, 0.1], tint: tints(['#ffffff', '#e6d6c6', '#8a6a52', '#4a3a32']) },
  hare: { group: 'solo', walk: 0.5, run: 1.6, fd: 2.4, act: [0.6, 1, 0.8] },
  snowhare: { group: 'solo', walk: 0.5, run: 1.6, fd: 2.4, act: [0.6, 1, 0.8] },
  lizard: { group: 'solo', walk: 0.3, run: 1.1, fd: 1.4, act: [1, 0.4, 0], tint: tints(['#b8c878', '#d8c088', '#8ab070', '#c8a878']) },
  scorpion: { group: 'solo', walk: 0.12, run: 0.4, fd: 0.9, act: [0, 0.6, 1], tint: tints(['#d8b878', '#3a3430', '#c89858']) },
  frog: { group: 'solo', walk: 0.25, run: 0.8, fd: 1.2, act: [0.7, 1, 1] },
  snake: { group: 'solo', walk: 0.14, run: 0.5, fd: 1.2, act: [1, 0.5, 0.2], tint: tints(['#ffffff', '#d8c890', '#9a8a6a']) },
  butterfly: { group: 'fly', act: [1, 0.2, 0], tint: tints(['#f08a2a', '#f4d24a', '#5a8ee8', '#ffffff', '#d8503a', '#c890e0']) },
  dragonfly: { group: 'fly', act: [1, 0.4, 0], tint: tints(['#ffffff', '#c0ffd0', '#ffc8b0']) },
  heron: { group: 'wader', walk: 0.18, run: 0.6, fd: 2.6, act: [1, 1, 0.2] },
  seal: { group: 'shore', walk: 0.12, run: 0.35, fd: 2.0, act: [1, 1, 0.6] },
};
// Kleinere Tiere (animals.js SHRINK, seit 25.10.2026): Schritt, Lauf und Abstand in der Herde gehen mit der Größe
for (const [k, S] of Object.entries(WILD_SPECIES)) {
  const f = SHRINK[k] ?? 1;
  if (S.walk) S.walk *= f ** 0.8;
  if (S.run) S.run *= f ** 0.8;
  if (S.gap) S.gap *= f;
  if (S.fd) S.fd *= 0.5 + 0.5 * f;
}
// Wer lebt wo: [Art, Gewicht, kleinste und größte Gruppe]
const HOME = {
  wald: [['deer', 3, 2, 5], ['stag', 1.2, 1, 3], ['hare', 2.2, 1, 2], ['butterfly', 3, 4, 9]],
  taiga: [['deer', 2, 2, 4], ['stag', 1.6, 1, 3], ['hare', 1.6, 1, 2]],
  mild: [['horse', 2.2, 4, 9], ['deer', 0.8, 2, 4], ['hare', 2.4, 1, 3], ['butterfly', 5, 5, 11], ['heron', 0.6, 1, 1]],
  steppe: [['horse', 3, 5, 11], ['hare', 2, 1, 2], ['butterfly', 2.4, 3, 7]],
  savanne: [['antelope', 3, 5, 12], ['zebra', 3, 4, 10], ['giraffe', 1.6, 2, 5]],
  wueste: [['camel', 1.6, 2, 5], ['scorpion', 2, 1, 1], ['lizard', 3, 1, 1], ['snake', 1, 1, 1]],
  salz: [['camel', 1, 2, 4], ['lizard', 1.4, 1, 1], ['scorpion', 1, 1, 1]],
  canyon: [['lizard', 2.6, 1, 1], ['scorpion', 1.6, 1, 1], ['snake', 1, 1, 1]],
  oase: [['camel', 2, 2, 4], ['dragonfly', 2, 2, 4], ['lizard', 1, 1, 1], ['frog', 1, 1, 2]],
  tropen: [['frog', 3, 1, 2], ['butterfly', 4.5, 5, 10], ['snake', 1, 1, 1]],
  sumpf: [['frog', 3, 1, 3], ['heron', 2, 1, 2], ['dragonfly', 3, 2, 5], ['snake', 0.6, 1, 1]],
  tundra: [['reindeer', 3, 4, 10], ['snowhare', 2, 1, 2]],
  eis: [['reindeer', 0.6, 2, 5], ['snowhare', 1, 1, 1]],
  fjord: [['reindeer', 2, 3, 7], ['snowhare', 1.2, 1, 2], ['seal', 1.6, 1, 3]],
  vulkan: [['lizard', 2, 1, 1]],
};
const COLD_COAST = new Set(['fjord', 'tundra', 'eis', 'taiga']);
const INSECT = new Set(['butterfly', 'dragonfly']);
const COLD_BLOOD = new Set(['butterfly', 'dragonfly', 'lizard', 'scorpion', 'frog', 'snake']);
// Greifvögel und Geier kreisen über offenem Land, Papageien im Regenwald (die Vögel aus animals.js)
const SOAR = new Set(['steppe', 'savanne', 'wueste', 'canyon', 'salz', 'mild']);
export const PARROT = tints(['#d8402e', '#3aa84a', '#2e7ad8', '#f0c83a', '#e8743a']);
const RAPTOR = new THREE.Color('#5a4232');

export class Wild {
  constructor(animals) {
    this.A = animals;
    this.groups = [];
    this.soar = [];
    this.v = new THREE.Vector3();
    this.frustum = new THREE.Frustum();
    this.pm = new THREE.Matrix4();
    this.threats = new Map();
    this.n = 0;
    this.R = new AnimalRules();
    this.farms = new Map(); // Viehhof → { tiles, set, cows, sig }
    this.fence = null;
  }

  idx(x, z) { const i = Math.round(x + (NX - 1) / 2), j = Math.round(z + (NY - 1) / 2); return i < 0 || j < 0 || i >= NX || j >= NY ? -1 : j * NX + i; }

  wet(st, i) {
    const T = st.tiles;
    if (T.river && T.river[i]) return true;
    return T.h[i - 1] < 0 || T.h[i + 1] < 0 || T.h[i - NX] < 0 || T.h[i + NX] < 0;
  }
  nearestSea(st, X, Z) {
    let best = null, bd = 9;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const i = this.idx(X + a, Z + b); if (i >= 0 && st.tiles.h[i] < 0 && a * a + b * b < bd) { bd = a * a + b * b; best = [X + a, Z + b]; } }
    return best;
  }
  sea(st, i) { const T = st.tiles; return T.h[i - 1] < -0.5 || T.h[i + 1] < -0.5 || T.h[i - NX] < -0.5 || T.h[i + NX] < -0.5; }

  // Menschen und Geist in der Nähe: grobes Raster der sichtbaren Menschen, einmal je Bild
  buildThreats() {
    this.threats.clear();
    const P = this.A.people?.pos;
    if (P) for (const p of P.values()) {
      const k = (Math.floor(p[0] / 3) * 4099 + Math.floor(p[2] / 3)) | 0;
      const l = this.threats.get(k);
      if (l) { if (l.length < 6) l.push(p); } else this.threats.set(k, [p]);
    }
  }
  threat(X, Z, fd) {
    const G = this.A.ghost || this.fake; // fake: zum Prüfen ein Schreckpunkt
    let best = null, bd = fd * fd;
    if (G) { const d = (G.x - X) ** 2 + (G.z - Z) ** 2; if (d < bd) { bd = d; best = [G.x, G.z]; } }
    const cx = Math.floor(X / 3), cz = Math.floor(Z / 3), r = Math.ceil(fd / 3);
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
      const l = this.threats.get(((cx + a) * 4099 + cz + b) | 0);
      if (l) for (const p of l) { const d = (p[0] - X) ** 2 + (p[2] - Z) ** 2; if (d < bd) { bd = d; best = [p[0], p[2]]; } }
    }
    return best;
  }

  // Anteil aktiver Tiere: Tag, Dämmerung, Nacht
  activity(sp, night) {
    const a = WILD_SPECIES[sp].act;
    if (night > 0.75) return a[2];
    if (night > 0.3) return a[1];
    return a[0];
  }

  pick(list, night) {
    let sum = 0;
    for (const e of list) sum += e[1] * this.activity(e[0], night);
    let r = Math.random() * sum;
    for (const e of list) { r -= e[1] * this.activity(e[0], night); if (r <= 0) return e; }
    return null;
  }

  // Darf ein Tier dieser Art hier stehen (Regeln aus animal_rules.js)
  ok(sp, i) { return this.R.can(sp, i); }

  // Eine neue Gruppe nahe am Blick, aber außerhalb des Bildes oder weit genug weg
  spawn(st, cam, tgt, rad, night, wxs, cold, kindOk) {
    const T = st.tiles;
    // zum Prüfen (warm): gleich im Bild entstehen, sonst irgendwo rund um den Blick
    const a = this.warm ? Math.atan2(tgt.x - cam.position.x, tgt.z - cam.position.z) + (Math.random() - 0.5) * 0.9 : Math.random() * Math.PI * 2;
    const r = this.warm ? rnd(0.35, 0.95) * rad : Math.sqrt(Math.random()) * rad;
    const X = tgt.x + (this.warm ? Math.sin(a) : Math.cos(a)) * r * (this.warm ? 0.6 : 1), Z = tgt.z + (this.warm ? Math.cos(a) : Math.sin(a)) * r * (this.warm ? 0.6 : 1);
    const i = this.idx(X, Z);
    if (i < 0 || T.h[i] < 0) return;
    const bio = BKEY[T.bio[i]];
    let list = HOME[bio] || [];
    if (this.sea(st, i) && COLD_COAST.has(bio)) list = [['seal', 3, 1, 3]];
    else if (bio !== 'sumpf' && this.wet(st, i) && T.river?.[i] && ['wald', 'mild', 'taiga', 'steppe'].includes(bio) && Math.random() < 0.3) list = [['heron', 1, 1, 1], ['dragonfly', 1, 2, 3], ['frog', 1, 1, 2]];
    if (!list.length) return;
    const e = this.pick(list, night);
    if (!e) return;
    const [sp, , n0, n1] = e, S = WILD_SPECIES[sp];
    if (!kindOk(sp)) return;
    // nicht zu viele von einer Art, damit es bunt bleibt
    let same = 0;
    for (const g of this.groups) if (g.sp === sp) same++;
    if (same >= (S.group === 'herd' ? 4 : S.group === 'fly' ? 4 : 5)) return;
    if (COLD_BLOOD.has(sp) && cold) return;
    if (INSECT.has(sp) && (wxs.storm > 0.3 || wxs.rain > 0.2 || night > 0.3)) return;
    const wet = sp === 'heron' || sp === 'frog' || sp === 'dragonfly';
    if (wet && !this.wet(st, i)) return;
    if (sp === 'seal' && !this.sea(st, i)) return;
    if (!this.ok(sp, i)) return;
    // die ganze Herde braucht Platz: rund um das Leittier muss es auch erlaubt sein
    if (S.group === 'herd') for (const [a, b] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) if (!this.ok(sp, this.idx(X + a, Z + b))) return;
    // nicht mitten im Bild entstehen
    const Y = groundY(X, Z);
    this.v.set(X, Y + 0.3, Z);
    const dc = Math.hypot(cam.position.x - X, cam.position.z - Z);
    if (!this.warm && this.frustum.containsPoint(this.v) && dc < rad * 0.8) return;
    const n = n0 + Math.floor(Math.random() * (n1 - n0 + 1));
    this.groups.push(this.make(sp, X, Z, n));
  }

  make(sp, X, Z, n, home = null) {
    const S = WILD_SPECIES[sp], seed = Math.floor(Math.random() * 1e6);
    const g = { sp, S, seed, x: X, z: Z, hx: X, hz: Z, yaw: Math.random() * 6.28, mode: 'graze', until: 0, tx: X, tz: Z, home, members: [], flee: null, born: this.A.lastT };
    const tint = S.tint ? S.tint[Math.floor(hash(seed, 3) * S.tint.length)] : WHITE;
    for (let k = 0; k < n; k++) {
      const a = k * 2.4 + hash(seed, k) * 0.8, r = k === 0 ? 0 : (S.gap || 0.5) * (0.6 + Math.sqrt(k) * 0.55);
      const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
      g.members.push({ ox, oz, x: X + ox, z: Z + oz, yaw: g.yaw + (hash(seed, k + 9) - 0.5), clip: 'idle', ph: hash(seed, k + 3), next: 0, tint: S.group === 'fly' || sp === 'horse' || sp === 'cow' ? S.tint[Math.floor(hash(seed, k + 21) * S.tint.length)] : tint, sc: 0.88 + hash(seed, k + 5) * 0.24 * (k === 0 ? 1.2 : 1), fy: 0, rest: 0 });
    }
    return g;
  }

  // neues Ziel für die Herde: ein Stück weiter im gleichen Lebensraum, manchmal ans Wasser zum Trinken
  retarget(st, g) {
    const T = st.tiles, i0 = this.idx(g.x, g.z), bio = i0 >= 0 ? T.bio[i0] : -1;
    const range = g.home ? 2.5 : { herd: 9, solo: 1.8, wader: 1.2, shore: 1.0 }[g.S.group] || 2;
    for (let k = 0; k < 10; k++) {
      const a = g.yaw + (Math.random() - 0.5) * 2.6, r = rnd(range * 0.4, range);
      // Einzelgänger bleiben in der Nähe ihres Platzes
      const cx = g.home || g.S.group !== 'herd' ? g.hx : g.x, cz = g.home || g.S.group !== 'herd' ? g.hz : g.z;
      const X = cx + Math.sin(a) * r, Z = cz + Math.cos(a) * r;
      const i = this.idx(X, Z);
      if (!this.ok(g.sp, i) || (bio >= 0 && T.bio[i] !== bio)) continue;
      if ((g.S.group === 'wader' || g.S.group === 'shore' || g.sp === 'frog') && !this.wet(st, i)) continue;
      // der ganze Weg muss erlaubt sein (keine Straße, kein Ort dazwischen)
      if (!this.clearPath(g.sp, g.x, g.z, X, Z)) continue;
      g.tx = X; g.tz = Z; g.drink = this.wet(st, i);
      return true;
    }
    return false;
  }

  // Ist der gerade Weg frei (alle halben Felder geprüft)?
  clearPath(sp, x0, z0, x1, z1) {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) * 2);
    for (let k = 1; k <= n; k++) if (!this.ok(sp, this.idx(x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n))) return false;
    return true;
  }

  // Regeln auffrischen (alle 3 Sekunden oder bei neuer Welt), auch für die Dorftiere in animals.js
  rules(st, t) {
    if (this.R.st !== st || !this._rulesT || t - this._rulesT > 3) { this.R.street = this.A.streets ? this.A.streets.tile : null; this.R.refresh(st); this._rulesT = t; }
    return this.R;
  }

  update(st, t, dt, night, wxs, cam, tgt, far) {
    const A = this.A;
    this.rules(st, t);
    this.pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pm);
    this.buildThreats();
    const camD = cam.position.distanceTo(tgt);
    // große Tiere sieht man von weit, kleine nur nah
    const bigR = far * 0.85, smallR = camD < 34 ? Math.min(20, 7 + camD * 0.45) : 0;
    const cold = MU.uSnow.value > 0.35;
    const kindOk = sp => !!A.need(sp);
    if (far) {
      let big = 0, small = 0;
      for (const g of this.groups) if (g.S.group === 'herd') big++; else small++;
      const wantBig = Math.min(10, 3 + Math.floor(bigR / 9)), wantSmall = smallR ? 16 : 0;
      for (let k = 0; k < 3; k++) {
        if (big < wantBig && Math.random() < 0.5) { const n = this.groups.length; this.spawn(st, cam, tgt, bigR, night, wxs, cold, sp => WILD_SPECIES[sp].group === 'herd' && kindOk(sp)); if (this.groups.length > n) big++; }
        else if (small < wantSmall) { const n = this.groups.length; this.spawn(st, cam, tgt, smallR, night, wxs, cold, sp => WILD_SPECIES[sp].group !== 'herd' && kindOk(sp)); if (this.groups.length > n) small++; }
      }
    }
    this.pastures(st, t, dt, night, cam, far, kindOk);
    // wer weit weg ist oder nicht mehr in seine Zeit passt, geht
    this.groups = this.groups.filter(g => {
      const d = Math.hypot(g.x - tgt.x, g.z - tgt.z);
      const lim = g.S.group === 'herd' ? bigR * 1.35 + 6 : smallR * 1.6 + 3;
      if (!far || d > lim || g.gone) return false;
      if (INSECT.has(g.sp) && (night > 0.4 || wxs.rain > 0.3) && d > 6) return false;
      return true;
    });
    for (const g of this.groups) this.step(st, g, t, dt, night, wxs);
    this.soaring(st, t, tgt, far, night, wxs);
  }

  // Kühe auf der Weide am Viehhof (seit 21.10.2026 mit Regeln): jeder Viehhof bekommt eine eingezäunte Weide aus freier
  // Wiese rund um den Stall (AnimalRules.pasture: kein Weg, kein Feld, kein Haus, kein Wasser, kein Steilhang, lieber weg
  // vom Ort). Die Kühe bleiben darauf: sie grasen lange, gehen langsam aufs Nachbarfeld, liegen nachts, weichen dem Geist
  // ein paar Schritte aus, fliehen aber nie im Galopp. Ohne Wiese gibt es keine Kühe. Der Zaun steht immer, auch fern.
  pastures(st, t, dt, night, cam, far, kindOk) {
    const A = this.A;
    if (!this._pastT || t - this._pastT > 4 || this._pastSt !== st) {
      this._pastT = t; this._pastSt = st;
      const seen = new Set();
      let change = false;
      for (const b of st.buildings) {
        if (b.t !== 'stall' || !(b.prog >= 1)) continue;
        seen.add(b.id);
        const tiles = this.R.pasture(st, b), sig = tiles.join(',');
        const F = this.farms.get(b.id);
        if (F && F.sig === sig) continue;
        change = true;
        if (tiles.length < 2) { this.farms.set(b.id, { b, tiles: [], set: new Set(), cows: [], sig }); continue; }
        const set = new Set(tiles), n = Math.min(2 + Math.floor(hash(b.id, 5) * 3), Math.ceil(tiles.length * 0.8));
        const cows = [];
        for (let k = 0; k < n; k++) {
          const i = tiles[Math.floor(hash(b.id, k + 31) * tiles.length)];
          const X = wx(i % NX) + (hash(b.id, k + 7) - 0.5) * 0.5, Z = wz((i / NX) | 0) + (hash(b.id, k + 11) - 0.5) * 0.5;
          cows.push({ x: X, z: Z, tx: X, tz: Z, yaw: hash(b.id, k) * 6.28, mode: 'eat', until: 0, ph: hash(b.id, k + 3), sc: 0.9 + hash(b.id, k + 5) * 0.2,
            tint: WILD_SPECIES.cow.tint[Math.floor(hash(b.id, k + 21) * WILD_SPECIES.cow.tint.length)] });
        }
        this.farms.set(b.id, { b, tiles, set, cows, sig });
      }
      for (const id of [...this.farms.keys()]) if (!seen.has(id)) { this.farms.delete(id); change = true; }
      if (change) this.buildFence(st);
    }
    if (!far || !kindOk('cow')) return;
    const K = A.kinds.cow;
    if (!K) return;
    for (const F of this.farms.values()) {
      if (!F.cows.length) continue;
      const X0 = wx(F.b.x), Z0 = wz(F.b.y);
      if ((X0 - cam.position.x) ** 2 + (Z0 - cam.position.z) ** 2 > (far * 0.85) ** 2) continue;
      this.cows(F, K, t, dt, night);
    }
  }

  // Liegt ein Punkt auf der Weide (mit Abstand zum Zaun)?
  onFarm(F, X, Z, m = 0.24) {
    const i = this.idx(X, Z);
    if (!F.set.has(i)) return false;
    const fx = X - wx(i % NX), fz = Z - wz((i / NX) | 0);
    if (fx > 0.5 - m && !F.set.has(i + 1)) return false;
    if (fx < -0.5 + m && !F.set.has(i - 1)) return false;
    if (fz > 0.5 - m && !F.set.has(i + NX)) return false;
    if (fz < -0.5 + m && !F.set.has(i - NX)) return false;
    return true;
  }

  cows(F, K, t, dt, night) {
    const G = this.A.ghost, S = WILD_SPECIES.cow, o = this.A.o;
    for (let k = 0; k < F.cows.length; k++) {
      const c = F.cows[k];
      // Geist in der Nähe: ein paar Schritte weg aufs entfernteste Nachbarfeld, nie rennen
      const gd = G ? Math.hypot(G.x - c.x, G.z - c.z) : 9;
      if (gd < 1.2 && c.mode !== 'shy') {
        const i0 = this.idx(c.x, c.z);
        let best = null, bd = gd;
        for (const j of [i0, i0 + 1, i0 - 1, i0 + NX, i0 - NX]) if (F.set.has(j)) { const X = wx(j % NX), Z = wz((j / NX) | 0), d = Math.hypot(G.x - X, G.z - Z); if (d > bd) { bd = d; best = [X, Z]; } }
        if (best) { c.tx = best[0] + (Math.random() - 0.5) * 0.4; c.tz = best[1] + (Math.random() - 0.5) * 0.4; c.mode = 'shy'; c.until = t + 4; }
      }
      if (t > c.until && c.mode !== 'walk') {
        if (night > 0.6) { c.mode = 'rest'; c.until = t + rnd(20, 40); }
        else {
          const r = Math.random();
          if (r < 0.62) { c.mode = 'eat'; c.until = t + rnd(8, 20); }
          else if (r < 0.78) { c.mode = 'idle'; c.until = t + rnd(3, 7); }
          else {
            // aufs eigene oder ein Nachbarfeld der Weide, nie quer über fremde Felder
            const i0 = this.idx(c.x, c.z), nb = [i0, i0 + 1, i0 - 1, i0 + NX, i0 - NX].filter(j => F.set.has(j));
            const j = nb.length ? nb[Math.floor(Math.random() * nb.length)] : F.tiles[0];
            c.tx = wx(j % NX) + (Math.random() - 0.5) * 0.6; c.tz = wz((j / NX) | 0) + (Math.random() - 0.5) * 0.6;
            if (!this.onFarm(F, c.tx, c.tz)) { c.tx = wx(j % NX); c.tz = wz((j / NX) | 0); }
            c.mode = 'walk'; c.until = t + 30;
          }
        }
      }
      let moving = false, v = 0;
      if (c.mode === 'walk' || c.mode === 'shy') {
        const dx = c.tx - c.x, dz = c.tz - c.z, d = Math.hypot(dx, dz);
        if (d < 0.06) { if (c.mode === 'walk') { c.mode = 'eat'; c.until = t + rnd(8, 18); } else c.until = t + rnd(2, 4); }
        else {
          v = c.mode === 'shy' ? S.run : S.walk;
          const nx = c.x + dx / d * v * dt, nz = c.z + dz / d * v * dt;
          if (this.onFarm(F, nx, nz, 0.2) || !this.onFarm(F, c.x, c.z, 0.2)) { c.x = nx; c.z = nz; moving = true; } else { c.mode = 'idle'; c.until = 0; }
          c.yaw = turn(c.yaw, Math.atan2(dx, dz), dt * 2);
        }
      }
      // Abstand halten, aber nie über den Zaun schieben
      for (let j = 0; j < k; j++) {
        const q = F.cows[j], ex = c.x - q.x, ez = c.z - q.z, e = Math.hypot(ex, ez), want = 0.42 * SHRINK.cow;
        if (e < want && e > 1e-4) {
          const p = (want - e) * 0.5, ax = c.x + ex / e * p, az = c.z + ez / e * p, bx = q.x - ex / e * p, bz = q.z - ez / e * p;
          if (this.onFarm(F, ax, az, 0.2)) { c.x = ax; c.z = az; }
          if (this.onFarm(F, bx, bz, 0.2)) { q.x = bx; q.z = bz; }
        }
      }
      const len = K.S.len * c.sc;
      const fy = groundY(c.x + Math.sin(c.yaw) * len * 0.4, c.z + Math.cos(c.yaw) * len * 0.4), by = groundY(c.x - Math.sin(c.yaw) * len * 0.4, c.z - Math.cos(c.yaw) * len * 0.4);
      const pitch = Math.max(-0.3, Math.min(0.3, -Math.atan2(fy - by, len * 0.8)));
      const Y = Math.min(fy, by, groundY(c.x, c.z)) + 0.005;
      const clip = moving ? 'walk' : c.mode === 'rest' ? 'rest' : c.mode === 'eat' ? 'eat' : 'idle';
      K.add(o, c.x, Y, c.z, c.yaw, clip, c.ph, moving ? Math.max(0.6, v / 0.2) : 1, c.tint, c.sc, pitch, 0);
    }
  }

  // Zaun um alle Weiden: Pfosten und zwei Latten je Außenkante, am Stall bleibt ein Tor offen. Ein InstancedMesh.
  buildFence(st) {
    const scene = this.A.stage && this.A.stage.scene;
    if (!scene) return;
    const parts = [];
    const post = (X, Z) => { const y = groundY(X, Z); parts.push([X, y + 0.11, Z, 0.032, 0.22, 0.032, 0]); };
    for (const F of this.farms.values()) {
      if (!F.tiles.length) continue;
      const stall = F.b.y * NX + F.b.x, posts = new Set();
      for (const i of F.tiles) {
        const X = wx(i % NX), Z = wz((i / NX) | 0);
        for (const [dx, dz, d] of [[1, 0, 1], [-1, 0, -1], [0, 1, NX], [0, -1, -NX]]) {
          const j = i + d;
          if (F.set.has(j) || j === stall) continue;
          // genau auf der Feldgrenze, so treffen sich die Latten benachbarter Felder und Ecken in einem Pfosten
          const mx = X + dx * 0.5, mz = Z + dz * 0.5, along = dx ? [0, 1] : [1, 0];
          const ax = mx - along[0] * 0.5, az = mz - along[1] * 0.5, bx = mx + along[0] * 0.5, bz = mz + along[1] * 0.5;
          for (const [px, pz] of [[ax, az], [bx, bz]]) { const k = Math.round(px * 100) + ',' + Math.round(pz * 100); if (!posts.has(k)) { posts.add(k); post(px, pz); } }
          // Latte liegt längs der Kante (Box lang in x: Kante längs z braucht 90 Grad), am Hang geneigt
          const ya = groundY(ax, az), yb = groundY(bx, bz), rot = dx ? Math.PI / 2 : 0, tilt = dx ? Math.atan2(ya - yb, 1) : Math.atan2(yb - ya, 1);
          for (const h of [0.085, 0.165]) parts.push([mx, (ya + yb) / 2 + h, mz, Math.hypot(1, yb - ya), 0.02, 0.022, rot, tilt]);
        }
      }
    }
    if (!this.fence || this.fence.instanceMatrix.count < parts.length) {
      if (this.fence) { scene.remove(this.fence); this.fence.dispose(); }
      const mat = new THREE.MeshStandardMaterial({ color: '#a8835a', roughness: 0.9 });
      this.fence = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, Math.max(64, Math.ceil(parts.length * 1.5)));
      this.fence.castShadow = true; this.fence.receiveShadow = true; this.fence.frustumCulled = false;
      scene.add(this.fence);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    parts.forEach((P, k) => {
      e.set(0, P[6] || 0, 0); q.setFromEuler(e);
      // Latten am Hang: um die eigene Längsachse geneigt
      if (P[7]) { const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), P[7]); q.multiply(tilt); }
      m.compose(p.set(P[0], P[1], P[2]), q, sc.set(P[3], P[4], P[5]));
      this.fence.setMatrixAt(k, m);
    });
    this.fence.count = parts.length;
    this.fence.instanceMatrix.needsUpdate = true;
  }

  step(st, g, t, dt, night, wxs) {
    const A = this.A, K = A.kinds[g.sp], S = g.S, o = A.o;
    if (!K) return;
    if (S.group === 'fly') return this.flyers(g, K, t, dt);
    // Gefahr: Mensch oder Geist näher als die Fluchtdistanz, dann weg in die Gegenrichtung
    const th = this.threat(g.x, g.z, S.fd);
    if (th && (!g.flee || t > g.fleeCheck)) {
      const a = Math.atan2(g.x - th[0], g.z - th[1]);
      g.flee = { a, until: t + (S.group === 'herd' ? rnd(4, 6.5) : rnd(1.5, 3)) }; g.fleeCheck = t + 0.6;
      g.mode = 'flee';
    }
    if (g.mode === 'flee' && t > g.flee.until) { g.mode = 'graze'; g.until = t + rnd(3, 6); g.flee = null; }
    const resting = this.activity(g.sp, night) < 0.5 && !g.flee;
    // Leittier: grasen, ziehen, ruhen
    if (g.mode !== 'flee' && t > g.until) {
      if (g.mode === 'walk' || resting) { g.mode = resting ? 'rest' : (g.drink ? 'drink' : 'graze'); g.until = t + (S.group === 'herd' ? rnd(10, 24) : rnd(2, 6)); }
      else if (this.retarget(st, g)) { g.mode = 'walk'; g.until = t + 40; }
      else g.until = t + 3;
    }
    let speed = 0;
    if (g.mode === 'flee') {
      speed = S.run;
      let X = g.x + Math.sin(g.flee.a) * speed * dt, Z = g.z + Math.cos(g.flee.a) * speed * dt;
      if (g.sp !== 'seal' && !this.ok(g.sp, this.idx(X + Math.sin(g.flee.a) * 0.8, Z + Math.cos(g.flee.a) * 0.8))) {
        // nicht auf Straßen oder in den Ort fliehen: seitlich ausweichen, geht auch das nicht, stehen bleiben
        g.flee.a += (hash(g.seed, Math.floor(t)) > 0.5 ? 1 : -1) * 1.3; X = g.x; Z = g.z;
        g.flee.tries = (g.flee.tries || 0) + 1;
        if (g.flee.tries > 5) { g.mode = 'graze'; g.until = t + rnd(2, 4); g.flee = null; g.fleeCheck = t + 3; }
      }
      if (g.flee) { g.x = X; g.z = Z; g.yaw = turn(g.yaw, g.flee.a, dt * 5); }
      // Robben flüchten ins Meer und tauchen ab
      if (g.sp === 'seal') { const sea = this.nearestSea(st, g.x, g.z); if (sea) g.flee.a = Math.atan2(sea[0] - g.x, sea[1] - g.z); if (st.tiles.h[this.idx(g.x, g.z)] < 0) g.dive = (g.dive || 0) + dt; }
    } else if (g.mode === 'walk') {
      const dx = g.tx - g.x, dz = g.tz - g.z, d = Math.hypot(dx, dz);
      if (d < 0.2) { g.until = 0; }
      else {
        speed = S.walk;
        const nx = g.x + dx / d * speed * dt, nz = g.z + dz / d * speed * dt;
        if (this.ok(g.sp, this.idx(nx, nz))) { g.x = nx; g.z = nz; } else g.until = 0;
        g.yaw = turn(g.yaw, Math.atan2(dx, dz), dt * 2.5);
      }
    }
    // Mitglieder folgen mit ihrem Abstand, beim Grasen bummeln sie ein wenig
    const cy = Math.cos(g.yaw), sy = Math.sin(g.yaw);
    for (let k = 0; k < g.members.length; k++) {
      const m = g.members[k];
      const wob = g.mode === 'graze' || g.mode === 'rest' || g.mode === 'drink' ? 0.35 : 0.08;
      const sl = Math.floor(t / (6 + hash(g.seed, k) * 6) + hash(k, g.seed) * 5);
      const jx = (hash(sl, k * 7 + g.seed) - 0.5) * wob, jz = (hash(k * 5 + g.seed, sl) - 0.5) * wob;
      let tx = g.x + m.ox * cy + m.oz * sy + jx, tz = g.z - m.ox * sy + m.oz * cy + jz;
      // ein Platz auf Straße, im Ort oder im Wasser: näher ans Leittier rücken
      if (g.sp !== 'seal' && !this.ok(g.sp, this.idx(tx, tz))) { tx = g.x + (tx - g.x) * 0.35; tz = g.z + (tz - g.z) * 0.35; if (!this.ok(g.sp, this.idx(tx, tz))) { tx = g.x; tz = g.z; } }
      const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz);
      let moving = false, v = 0;
      if (d > 3) { m.x = tx; m.z = tz; }
      else if (d > 0.05) {
        v = Math.min(d * 2.2, (g.mode === 'flee' ? S.run * 1.1 : Math.max(S.walk * 1.4, speed * 1.2)));
        if (g.mode === 'walk' || g.mode === 'flee' || d > 0.25) {
          const nx = m.x + dx / d * v * dt, nz = m.z + dz / d * v * dt;
          if (g.sp === 'seal' || this.ok(g.sp, this.idx(nx, nz)) || !this.ok(g.sp, this.idx(m.x, m.z))) { m.x = nx; m.z = nz; }
          m.yaw = turn(m.yaw, Math.atan2(dx, dz), dt * (g.mode === 'flee' ? 6 : 3));
          moving = true;
        }
      }
      // Abstand zu den Nachbarn in der Herde
      for (let j = 0; j < k; j++) {
        const q = g.members[j], ex = m.x - q.x, ez = m.z - q.z, e = Math.hypot(ex, ez), want = Math.max((S.gap || 0.4) * 0.7, K.S.len * 0.75);
        if (e < want && e > 1e-4) {
          // auseinanderrücken, aber nie auf verbotenen Boden (Wasser, Straße, zu nah am Ort)
          const p = (want - e) * 0.5, ax = m.x + ex / e * p, az = m.z + ez / e * p, bx = q.x - ex / e * p, bz = q.z - ez / e * p;
          if (g.sp === 'seal' || this.ok(g.sp, this.idx(ax, az))) { m.x = ax; m.z = az; }
          if (g.sp === 'seal' || this.ok(g.sp, this.idx(bx, bz))) { q.x = bx; q.z = bz; }
        }
      }
      this.draw(g, m, K, k, moving, v, t, night);
    }
  }

  draw(g, m, K, k, moving, v, t, night) {
    const S = g.S, sp = g.sp, o = this.A.o;
    let Y = groundY(m.x, m.z);
    let clip, rate = 1, pitch = 0;
    const len = K.S.len * m.sc;
    if (S.group === 'herd') {
      if (moving && v > S.walk * 1.8) { clip = 'gallop'; rate = v / S.run * 1.1; }
      else if (moving) { clip = 'walk'; rate = Math.max(0.6, v / S.walk); }
      else {
        // stehend: grasen, Kopf heben, ruhen; jedes Tier für sich
        const sl = Math.floor(t / (5 + hash(g.seed, k) * 5) + hash(k, g.seed) * 9);
        const r = hash(sl, k + g.seed);
        if (g.mode === 'rest') clip = r < 0.6 ? 'rest' : 'idle';
        else if (g.mode === 'drink') clip = 'eat';
        else clip = r < 0.62 ? 'eat' : r < 0.85 ? 'idle' : 'rest';
        if (!K.clips[clip]) clip = 'idle';
      }
      // am Hang mitkippen
      const fy = groundY(m.x + Math.sin(m.yaw) * len * 0.4, m.z + Math.cos(m.yaw) * len * 0.4), by = groundY(m.x - Math.sin(m.yaw) * len * 0.4, m.z - Math.cos(m.yaw) * len * 0.4);
      pitch = Math.max(-0.35, Math.min(0.35, -Math.atan2(fy - by, len * 0.8)));
      Y = Math.min(fy, by, Y) + 0.005;
    } else if (S.group === 'solo') {
      const solo = this.solo(g, m, k, t);
      clip = solo.clip; rate = solo.rate;
    } else if (S.group === 'wader') {
      if (moving) { clip = 'walk'; rate = Math.max(0.7, v / S.walk); }
      else { const c = (t + m.ph * 9) % 9; clip = c < 1.6 ? 'strike' : 'idle'; if (clip === 'strike') { rate = 1; } }
      if (clip === 'strike' && !K.clips.strike) clip = 'idle';
      // der Reiher steht im Flachen: tief stehen wie im Wasser
      Y = Math.max(Y - 0.02, this.A.rise - 0.03);
    } else if (S.group === 'shore') {
      clip = moving ? 'crawl' : 'idle'; rate = moving ? 1.2 : 1;
      if (g.dive) { Y -= Math.min(0.4, g.dive * 0.3); if (g.dive > 2) g.gone = true; }
    }
    if (!K.clips[clip]) clip = Object.keys(K.clips)[0];
    // der Stoß beginnt genau am Anfang seines Takts (Phase so, dass der Clip bei 0 startet)
    let phase = m.ph;
    if (clip === 'strike') { const c = (t + m.ph * 9) % 9, d = K.clips.strike.dur; phase = (((c - t) / d) % 1 + 1) % 1; }
    K.add(o, m.x, Y, m.z, m.yaw, clip, phase, rate, m.tint, m.sc, pitch, 0);
  }

  // Einzelgänger am Boden: kurze Wege um den Platz, Pausen, Flucht im Sprint
  solo(g, m, k, t) {
    const S = g.S, sp = g.sp;
    const moving = g.mode === 'walk' || g.mode === 'flee';
    if (sp === 'hare' || sp === 'snowhare') return moving ? { clip: 'hop', rate: g.mode === 'flee' ? 2.2 : 1.1 } : { clip: hash(Math.floor(t / 4), g.seed + k) < 0.5 ? 'eat' : 'idle', rate: 1 };
    if (sp === 'frog') return moving ? { clip: 'jump', rate: g.mode === 'flee' ? 1.8 : 1 } : { clip: 'idle', rate: 1 };
    return moving ? { clip: 'walk', rate: g.mode === 'flee' ? 2.6 : 1.2 } : { clip: 'idle', rate: 1 };
  }

  // Schmetterlinge und Libellen: jeder für sich auf einer weichen, zufälligen Bahn um den Platz, ab und zu Pause
  flyers(g, K, t, dt) {
    const o = this.A.o, dfly = g.sp === 'dragonfly';
    for (let k = 0; k < g.members.length; k++) {
      const m = g.members[k], s = g.seed + k * 17, a = hash(s, 1), b = hash(s, 2), c = hash(s, 3);
      const T = t * (dfly ? 0.55 : 0.32);
      // Libellen stehen kurz in der Luft und schießen dann weiter, Schmetterlinge gaukeln
      const TT = dfly ? Math.floor(T * 1.3) + smoothStep(fract(T * 1.3) * 4) : T;
      const X = g.hx + Math.sin(TT * (0.9 + a) + c * 6) * 1.3 + Math.sin(TT * (2.1 + b) + a * 6) * 0.45;
      const Z = g.hz + Math.cos(TT * (0.8 + b) + a * 6) * 1.3 + Math.cos(TT * (1.7 + c) + b * 6) * 0.45;
      const sit = !dfly && Math.sin(t * 0.11 + c * 9) > 0.72;
      const gy = groundY(X, Z);
      const Y = sit ? gy + 0.06 : gy + (dfly ? 0.28 + Math.sin(t * 0.7 + a * 6) * 0.08 : 0.22 + Math.abs(Math.sin(t * 1.3 + b * 6)) * 0.35);
      const vx = X - (m.px ?? X), vz = Z - (m.pz ?? Z);
      if (vx * vx + vz * vz > 1e-7) m.yaw = Math.atan2(vx, vz);
      m.px = X; m.pz = Z;
      // fliegt der Geist hindurch, weichen sie aus (steigen auf)
      const G = this.A.ghost, gd = G ? Math.hypot(G.x - X, G.z - Z) : 9;
      const up = gd < 0.8 ? (0.8 - gd) * 0.8 : 0;
      K.add(o, X, Y + up, Z, m.yaw, sit ? 'rest' : 'fly', m.ph, dfly ? 1 : 1 + a * 0.4, m.tint, m.sc, 0, 0);
    }
  }

  // Greifvögel kreisen hoch über offenem Land
  soaring(st, t, tgt, far, night, wxs) {
    const B = this.A.kinds.bird;
    if (!B || !far || night > 0.4 || wxs.storm > 0.4) { this.soar.length = 0; return; }
    this.soar = this.soar.filter(s => Math.hypot(s.cx - tgt.x, s.cz - tgt.z) < 70 && t - s.born < s.life);
    if (this.soar.length < 2 && Math.random() < 0.01) {
      const X = tgt.x + rnd(-30, 30), Z = tgt.z + rnd(-30, 30), i = this.idx(X, Z);
      if (i >= 0 && st.tiles.h[i] >= 0 && SOAR.has(BKEY[st.tiles.bio[i]])) this.soar.push({ cx: X, cz: Z, r: rnd(3, 6), h: rnd(6, 10), w: rnd(0.12, 0.2) * (Math.random() < 0.5 ? 1 : -1), ph: Math.random() * 6.28, born: t, life: rnd(60, 140), n: 1 + (Math.random() < 0.35 ? 1 : 0), vult: ['wueste', 'savanne', 'canyon', 'salz'].includes(BKEY[st.tiles.bio[i]]) });
    }
    for (const s of this.soar) {
      const age = t - s.born, fade = Math.min(1, age / 4, (s.life - age) / 4);
      for (let k = 0; k < s.n; k++) {
        const a = t * s.w + s.ph + k * 2.6, r = s.r * (1 + k * 0.3);
        const X = s.cx + Math.cos(a) * r, Z = s.cz + Math.sin(a) * r;
        const Y = groundY(s.cx, s.cz) + s.h + k * 0.8 + (1 - fade) * 6 + Math.sin(t * 0.3 + k) * 0.4;
        const yaw = Math.atan2(-Math.sin(a) * Math.sign(s.w), Math.cos(a) * Math.sign(s.w));
        const flap = Math.sin(t * 0.25 + k * 3 + s.ph) > 0.85;
        const cf = this.A.camFade ? this.A.camFade(X, Y, Z) : 1;
        if (cf < 0.02) continue;
        B.add(this.A.o, X, Y, Z, yaw, 'fly', s.ph, flap ? 0.9 : 0.0001, RAPTOR, (s.vult ? 2.6 : 2.1) * cf, 0, -0.3 * Math.sign(s.w));
      }
    }
  }
}

function turn(a, b, k) { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * Math.min(1, k); }
function fract(x) { return x - Math.floor(x); }
function smoothStep(x) { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); }
