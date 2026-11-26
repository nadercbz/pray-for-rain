// Die gezeichnete Karte der echten Erde (seit 19.10.2026, PLAN_ERDE.md E5). Für 2048 mal 1024 Felder ist ein Grundbild
// wie bei den Inseln (7 Bildpunkte je Feld) viel zu groß. Darum Kacheln zu 128 Feldern, die erst gezeichnet werden, wenn
// sie im Bild sind, in drei Feinheiten je nach Zoom (1,5, 4 und 10 Bildpunkte je Feld), mit einem kleinen Vorrat.
// Jede Kachel: Aquarell nach Lebensraum, Tuscheküste mit Wellenlinien, Flüsse nach Rang, Zeichen für Berge, Wälder,
// Wüsten, nur so weit die Menschen die Welt kennen (st.tiles.seen). Darüber jedes Bild neu: Straßen, Seewege,
// Kundschafterpfade, Orte, Schiffe, Namen (echte Namen nach Rang je Zoomstufe, darunter klein der Name der Völker),
// zartes Gradnetz, Maßstab in km.
import { L } from '../i18n.js';
import { BIOMES } from '../sim/data.js';
import { EARTH, kmPerTile, lonLat } from '../sim/earth.js';
import { NX, NY } from '../sim/world.js';
import * as G from './map.js';

const TS = 128;                 // Felder je Kartenkachel
const LODS = [1.5, 4, 10];      // Bildpunkte je Feld der drei Feinheiten
const MAX_CACHE = 48;
const BK = BIOMES.map(b => b.key);
const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

export class EarthLayer {
  constructor() {
    this.cache = new Map();   // key "tx,ty,S" -> { cv, sig, used }
    this.prepared = null;
    this.maskGen = -1;
    this.tick = 0;
  }

  // Einmal je Welt (und nach Beben, Vulkanen): Aquarell, Küsten, Wellenlinien, Flüsse in Kacheln
  prepare(st) {
    const T = st.tiles, W = NX, H = NY;
    const hsig = this.hashH(T.h);
    if (this.prepared && this.prepared.hsig === hsig && this.prepared.st === st) return;
    this.W = W; this.H = H;
    const n = W * H, h = T.h;
    // Abstand zum Land (für die Meeresfarbe und Wellenlinien), höchstens 9 Felder
    const dist = new Uint8Array(n).fill(255), q = new Int32Array(n);
    let qa = 0, qb = 0;
    for (let i = 0; i < n; i++) if (h[i] >= 0) { dist[i] = 0; q[qb++] = i; }
    while (qa < qb) {
      const i = q[qa++], d = dist[i]; if (d >= 9) continue;
      const x = i % W, y = (i / W) | 0;
      if (x > 0 && dist[i - 1] > d + 1) { dist[i - 1] = d + 1; q[qb++] = i - 1; }
      if (x < W - 1 && dist[i + 1] > d + 1) { dist[i + 1] = d + 1; q[qb++] = i + 1; }
      if (y > 0 && dist[i - W] > d + 1) { dist[i - W] = d + 1; q[qb++] = i - W; }
      if (y < H - 1 && dist[i + W] > d + 1) { dist[i + W] = d + 1; q[qb++] = i + W; }
    }
    this.dist = dist;
    this.buildWash(st);
    // Küste und zwei Wellenlinien als Strecken, sortiert in Kacheln
    const land = new Float32Array(n);
    for (let i = 0; i < n; i++) land[i] = h[i] >= 0 ? 1 : 0;
    const df = new Float32Array(n);
    for (let i = 0; i < n; i++) df[i] = Math.min(9, dist[i]);
    this.coast = this.contourTiles(blur1(land, W, H), 0.5);
    this.wave1 = this.contourTiles(blur1(df, W, H), 1.6);
    this.wave2 = this.contourTiles(blur1(df, W, H), 3.1);
    // Flüsse je Kachel (Index in st.rivers)
    this.rivers = new Map();
    (st.rivers || []).forEach((p, k) => {
      const seen = new Set();
      for (let m = 0; m < p.length; m += 4) { const i = p[m], key = ((i % W) / TS | 0) + ',' + ((i / W / TS) | 0); if (!seen.has(key)) { seen.add(key); let a = this.rivers.get(key); if (!a) this.rivers.set(key, a = []); a.push(k); } }
    });
    this.prepared = { st, hsig };
    this.cache.clear();
    this.maskGen = -1;
  }

  hashH(h) { let s = h.length; for (let i = 0; i < h.length; i += 97) s = (Math.imul(s, 31) + h[i]) | 0; return s; }

  buildWash(st) {
    const T = st.tiles, W = this.W, H = this.H;
    const cv = this.wash || document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d'), img = c.createImageData(W, H), D = img.data;
    const WR = BK.map(b => hex(G.WASH[b] || G.WASH.mild));
    const sea = hex('#c5d6cf'), deep = hex('#d6e0d6');
    for (let i = 0; i < W * H; i++) {
      let col;
      if (T.h[i] < 0) { const t = Math.min(1, this.dist[i] / 9); col = [sea[0] + (deep[0] - sea[0]) * t, sea[1] + (deep[1] - sea[1]) * t, sea[2] + (deep[2] - sea[2]) * t]; }
      else {
        col = WR[T.bio[i]].slice();
        const x = i % W, y = (i / W) | 0, nz = G.sn(x * 0.35, y * 0.35) - 0.5;
        if (T.h[i] >= 4) { const k = Math.min(1, (T.h[i] - 3) * 0.25); col[0] = col[0] * (1 - 0.12 * k) + 26 * k; col[1] = col[1] * (1 - 0.12 * k) + 20 * k; col[2] = col[2] * (1 - 0.12 * k) + 12 * k; }
        if (T.tree[i] >= 2) { col[0] -= 14; col[1] -= 6; col[2] -= 14; }
        col[0] += nz * 16; col[1] += nz * 14; col[2] += nz * 10;
      }
      D[i * 4] = col[0]; D[i * 4 + 1] = col[1]; D[i * 4 + 2] = col[2]; D[i * 4 + 3] = 235;
    }
    c.putImageData(img, 0, 0);
    this.wash = cv;
    this.washDay = st.day;
  }

  // Marching Squares wie in map.js, aber nur dort, wo sich etwas ändert, und gleich in Kacheln einsortiert
  contourTiles(f, iso) {
    const W = this.W, H = this.H, out = new Map();
    const lerp = (a, b) => (iso - a) / (b - a);
    for (let y = 0; y < H - 1; y++) {
      const r0 = y * W, r1 = r0 + W;
      for (let x = 0; x < W - 1; x++) {
        const a = f[r0 + x], b = f[r0 + x + 1], c = f[r1 + x + 1], d = f[r1 + x];
        const id = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (c > iso ? 2 : 0) | (d > iso ? 1 : 0);
        if (id === 0 || id === 15) continue;
        const Tp = [x + lerp(a, b), y], R = [x + 1, y + lerp(b, c)], B = [x + lerp(d, c), y + 1], Lf = [x, y + lerp(a, d)];
        const P = { 1: [[Lf, B]], 2: [[B, R]], 3: [[Lf, R]], 4: [[Tp, R]], 5: [[Lf, Tp], [B, R]], 6: [[Tp, B]], 7: [[Lf, Tp]], 8: [[Lf, Tp]], 9: [[Tp, B]], 10: [[Tp, R], [Lf, B]], 11: [[Tp, R]], 12: [[Lf, R]], 13: [[B, R]], 14: [[Lf, B]] }[id];
        const key = ((x / TS) | 0) + ',' + ((y / TS) | 0);
        let a2 = out.get(key); if (!a2) out.set(key, a2 = []);
        for (const [p, q] of P) a2.push(p[0], p[1], q[0], q[1]);
      }
    }
    return out;
  }

  // Bekanntes als Maske (ein Bildpunkt je Feld, weich vergrößert) und je Kachel eine Prüfsumme, damit nur Kacheln mit
  // neu entdecktem Land neu gezeichnet werden
  update(st) {
    const gen = (st._rt.seenGen || 0);
    if (gen === this.maskGen && this.mask) return;
    this.maskGen = gen;
    const W = this.W, H = this.H, S0 = st.tiles.seen;
    const cv = this.mask || document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d'), img = c.createImageData(W, H), D = img.data;
    const tw = Math.ceil(W / TS), th = Math.ceil(H / TS);
    const sum = new Float64Array(tw * th);
    for (let y = 0; y < H; y++) {
      const ty = (y / TS) | 0;
      for (let x = 0; x < W; x++) {
        const i = y * W + x, v = S0[i];
        if (!v) continue;
        D[i * 4 + 3] = Math.max(0, Math.min(255, (v - 110) * 2.2));
        sum[ty * tw + ((x / TS) | 0)] += v;
      }
    }
    c.putImageData(img, 0, 0);
    this.mask = cv;
    this.tileSum = sum; this.tw = tw;
  }

  sigOf(tx, ty, st) { return (this.tileSum ? this.tileSum[ty * this.tw + tx] : 0) + ':' + Math.floor(st.day / 240) + ':' + (this.washDay | 0); }

  renderTile(st, tx, ty, S) {
    const T = st.tiles, W = this.W, H = this.H;
    const x0 = tx * TS, y0 = ty * TS, w = Math.min(TS, W - x0), hgt = Math.min(TS, H - y0);
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(w * S); cv.height = Math.ceil(hgt * S);
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(this.wash, x0, y0, w, hgt, 0, 0, w * S, hgt * S);
    c.save();
    c.translate(-x0 * S, -y0 * S);
    const key = tx + ',' + ty;
    const ink = (segs, color, width, alpha, jit) => {
      if (!segs) return;
      c.strokeStyle = color; c.globalAlpha = alpha; c.lineWidth = width; c.lineCap = 'round';
      c.beginPath();
      for (let k = 0; k < segs.length; k += 4) {
        const ax = segs[k], ay = segs[k + 1], bx = segs[k + 2], by = segs[k + 3];
        const j = jit ? (u, v) => (G.sn(u * 1.7, v * 1.7) - 0.5) * 0.5 : () => 0;
        c.moveTo((ax + 0.5 + j(ax, ay)) * S, (ay + 0.5 + j(ay + 3, ax)) * S);
        c.lineTo((bx + 0.5 + j(bx, by)) * S, (by + 0.5 + j(by + 3, bx)) * S);
      }
      c.stroke();
      c.globalAlpha = 1;
    };
    if (S >= 4) { ink(this.wave2.get(key), G.SEPIA, 0.7, 0.22, true); ink(this.wave1.get(key), G.SEPIA, 0.9, 0.38, true); }
    ink(this.coast.get(key), G.INK, S >= 4 ? 1.6 : 1, 0.95, S >= 4);
    // Flüsse: breiter nach Rang und zur Mündung hin
    c.strokeStyle = 'rgba(70, 110, 140, 0.9)'; c.lineCap = 'round'; c.lineJoin = 'round';
    const rank = st.riverRank || [];
    for (const k of this.rivers.get(key) || []) {
      const p = st.rivers[k], rk = rank[k] || 6;
      if (S < 4 && rk > 4) continue;
      const base = Math.max(0.6, (8 - rk) * 0.32) * Math.min(S, 6) / 4;
      c.beginPath();
      p.forEach((i, m) => {
        const x = (i % W + 0.5) * S + (G.hash(i, 3) - 0.5) * S * 0.3, y = (((i / W) | 0) + 0.5) * S + (G.hash(i, 5) - 0.5) * S * 0.3;
        if (m) c.lineTo(x, y); else c.moveTo(x, y);
      });
      c.lineWidth = base;
      c.stroke();
    }
    // Zeichen für die Landschaft, dichter bei feinerer Kachel
    const step = S >= 10 ? 2 : S >= 4 ? 3 : 6, gs = step * S * 0.42;
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (let y = y0 + 1; y < y0 + hgt - 1; y += step) for (let x = x0 + ((y / step) % 2 ? Math.floor(step / 2) : 0); x < x0 + w - 1; x += step) {
      const i = y * W + x, l = T.h[i];
      if (l < 3 || T.seen[i] < 120) continue;
      const X = (x + 0.5 + (G.hash(x, y) - 0.5) * step * 0.45) * S, Y = (y + 0.5 + (G.hash(y, x) - 0.5) * step * 0.4) * S;
      const bk = BK[T.bio[i]];
      if (l === 3) { if (G.hash(x + 3, y) < 0.5) G.hill(c, X, Y, gs * 1.1); continue; }
      G.mountain(c, X, Y, gs * (0.85 + Math.min(5, l - 4) * 0.18), bk === 'eis' || bk === 'tundra' || bk === 'taiga' || bk === 'fjord' || l >= 6, bk === 'canyon' ? '#c98a62' : null);
    }
    for (let y = y0; y < y0 + hgt; y += step) for (let x = x0 + ((y / step) % 2 ? 1 : 0); x < x0 + w; x += step) {
      const i = y * W + x, l = T.h[i];
      if (l < 0 || l >= 3 || T.seen[i] < 120) continue;
      const bk = BK[T.bio[i]];
      const X = (x + 0.5 + (G.hash(x * 3, y) - 0.5) * step * 0.5) * S, Y = (y + 0.5 + (G.hash(x, y * 3) - 0.5) * step * 0.5) * S;
      const r = G.hash(x + 7, y + 7);
      if (T.tree[i] >= 2 || (T.tree[i] === 1 && r < 0.35)) {
        if (bk === 'taiga' || bk === 'fjord' || bk === 'tundra') G.pine(c, X, Y, gs * 0.9);
        else if (bk === 'tropen') { if (r < 0.4) G.palm(c, X, Y, gs); else G.blob(c, X, Y, gs * 0.95, '#6f9a58'); }
        else if (bk === 'savanne') G.acacia(c, X, Y, gs);
        else if (bk === 'oase') G.palm(c, X, Y, gs);
        else if (bk === 'sumpf') G.blob(c, X, Y, gs * 0.8, '#7f9265');
        else G.blob(c, X, Y, gs * 0.85, '#8fae6c');
        continue;
      }
      if (bk === 'wueste' && r < 0.3) G.dune(c, X, Y, gs);
      else if (bk === 'canyon' && r < 0.25) G.mesa(c, X, Y, gs);
      else if (bk === 'salz' && r < 0.3) G.crack(c, X, Y, gs);
      else if (bk === 'sumpf' && r < 0.45) G.tuft(c, X, Y, gs, true);
      else if ((bk === 'tundra' || bk === 'steppe') && r < 0.18) G.tuft(c, X, Y, gs, false);
      else if (bk === 'savanne' && r < 0.12) G.acacia(c, X, Y, gs * 0.9);
      else if (bk === 'eis' && r < 0.4) G.iceHatch(c, X, Y, gs);
    }
    for (const [vx, vy] of st.volc || []) if (vx >= x0 && vx < x0 + w && vy >= y0 && vy < y0 + hgt && T.seen[vy * W + vx] >= 120) G.volcano(c, (vx + 0.5) * S, (vy + 0.5) * S, Math.max(4, S * 1.6));
    c.restore();
    // nur Bekanntes: Maske darüber
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(this.mask, x0, y0, w, hgt, 0, 0, w * S, hgt * S);
    c.globalCompositeOperation = 'source-over';
    return cv;
  }

  tileCanvas(st, tx, ty, S, allowRender) {
    const key = tx + ',' + ty + ',' + S, sig = this.sigOf(tx, ty, st);
    const e = this.cache.get(key);
    if (e && e.sig === sig) { e.used = ++this.tick; return e.cv; }
    if (!allowRender) return e ? e.cv : null;
    const cv = this.renderTile(st, tx, ty, S);
    this.cache.set(key, { cv, sig, used: ++this.tick });
    if (this.cache.size > MAX_CACHE) {
      let old = null, ou = Infinity;
      for (const [k, v] of this.cache) if (v.used < ou) { ou = v.used; old = k; }
      if (old) this.cache.delete(old);
    }
    return cv;
  }

  // Ein Bild: Kacheln im Blick, darüber was sich bewegt
  draw(c, st, app, cx, cy, k, w, h) {
    this.prepare(st);
    if (st.day - (this.washDay || 0) > 240) this.buildWash(st);
    this.update(st);
    const W = this.W, H = this.H;
    const ox = w / 2 - cx * k, oy = h / 2 - cy * k;
    const S = LODS.find(s => s >= k * 0.8) || LODS[LODS.length - 1];
    const tx0 = Math.max(0, Math.floor(-ox / k / TS)), ty0 = Math.max(0, Math.floor(-oy / k / TS));
    const tx1 = Math.min(Math.ceil(W / TS) - 1, Math.floor((w - ox) / k / TS)), ty1 = Math.min(Math.ceil(H / TS) - 1, Math.floor((h - oy) / k / TS));
    // Unbekanntes bleibt Pergament: unter den Kacheln das Aquarell nur als Hauch, damit die Erde nicht leer wirkt
    let budget = 3;
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      let cv = this.tileCanvas(st, tx, ty, S, budget > 0);
      if (cv && !this.cache.get(tx + ',' + ty + ',' + S)?.drawnOnce) { budget--; const e = this.cache.get(tx + ',' + ty + ',' + S); if (e) e.drawnOnce = 1; }
      if (!cv) for (const s2 of LODS) { cv = this.tileCanvas(st, tx, ty, s2, false); if (cv) break; }
      if (!cv) continue;
      const tw = Math.min(TS, W - tx * TS), th = Math.min(TS, H - ty * TS);
      c.drawImage(cv, ox + tx * TS * k, oy + ty * TS * k, tw * k + 0.5, th * k + 0.5);
    }
    this.pending = budget <= 0;
    // zartes Gradnetz (15 Grad, ab Zoom 4 alle 5 Grad)
    const stepDeg = k >= 4 ? 5 : 15, lon0 = EARTH ? EARTH.meta.lon0 : -169;
    c.save();
    c.strokeStyle = 'rgba(110, 75, 45, 0.16)'; c.lineWidth = 1;
    c.beginPath();
    for (let la = -90 + stepDeg; la < 90; la += stepDeg) { const y = oy + (90 - la) / 180 * H * k; if (y > 0 && y < h) { c.moveTo(0, y); c.lineTo(w, y); } }
    for (let lo = -180; lo < 180; lo += stepDeg) { const x = ox + (((lo - lon0) % 360) + 360) % 360 / 360 * W * k; if (x > 0 && x < w) { c.moveTo(x, 0); c.lineTo(x, h); } }
    c.stroke();
    c.restore();
    this.overlays(c, st, app, ox, oy, k, w, h);
  }

  // Seeweg zwischen zwei Orten über ein grobes Raster (4 x 4 Felder je Zelle, Wasser wenn die Hälfte Wasser ist),
  // damit Seewege und Schiffe auf der Karte dem Meer folgen statt quer über Wüsten. Gemerkt je Paar.
  seaGrid(st) {
    if (this._sg && this._sgT === st.tiles.h) return this._sg;
    const T = st.tiles.h, W = this.W, C = 4, GW = W / C, GH = this.H / C, g = new Uint8Array(GW * GH);
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      let n = 0;
      for (let dy = 0; dy < C; dy++) { const r = (gy * C + dy) * W + gx * C; for (let dx = 0; dx < C; dx++) if (T[r + dx] < 0) n++; }
      g[gy * GW + gx] = n >= 8 ? 1 : 0;
    }
    this._sgT = T; this._sp = new Map();
    return (this._sg = { g, GW, GH, C });
  }
  seaPath(st, a, b) {
    const { g, GW, GH, C } = this.seaGrid(st);
    const key = Math.min(a.id, b.id) + '-' + Math.max(a.id, b.id);
    if (this._sp.has(key)) { const p = this._sp.get(key); return p && a.id > b.id ? p.slice().reverse() : p; }
    const near = (x, y) => {
      const cx = Math.floor(x / C), cy = Math.floor(y / C);
      for (let r = 0; r <= 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const X = cx + dx, Y = cy + dy;
        if (X >= 0 && Y >= 0 && X < GW && Y < GH && g[Y * GW + X]) return Y * GW + X;
      }
      return -1;
    };
    const [p, q] = a.id < b.id ? [a, b] : [b, a];
    const s0 = near(p.cx, p.cy), s1 = near(q.cx, q.cy);
    let path = null;
    if (s0 >= 0 && s1 >= 0) {
      const N = GW * GH, gs = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), done = new Uint8Array(N);
      const heap = [], hv = [];
      const push = (i, f) => { heap.push(i); hv.push(f); let n = heap.length - 1; while (n) { const m = (n - 1) >> 1; if (hv[m] <= hv[n]) break; [heap[m], heap[n]] = [heap[n], heap[m]]; [hv[m], hv[n]] = [hv[n], hv[m]]; n = m; } };
      const pop = () => { const top = heap[0], li = heap.pop(), lv = hv.pop(); if (heap.length) { heap[0] = li; hv[0] = lv; let n = 0; for (;;) { const l = 2 * n + 1, r = l + 1; let m = n; if (l < heap.length && hv[l] < hv[m]) m = l; if (r < heap.length && hv[r] < hv[m]) m = r; if (m === n) break; [heap[m], heap[n]] = [heap[n], heap[m]]; [hv[m], hv[n]] = [hv[n], hv[m]]; n = m; } } return top; };
      const ex = s1 % GW, ey = (s1 / GW) | 0;
      gs[s0] = 0; push(s0, 0);
      let it = 0;
      while (heap.length && it++ < 200000) {
        const i = pop(); if (done[i]) continue; done[i] = 1;
        if (i === s1) break;
        const x = i % GW, y = (i / GW) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= GW || Y >= GH) continue;
          const j = Y * GW + X; if (!g[j] || done[j]) continue;
          if (dx && dy && (!g[y * GW + X] || !g[Y * GW + x])) continue;
          const ng = gs[i] + (dx && dy ? 1.4142 : 1);
          if (ng < gs[j]) { gs[j] = ng; from[j] = i; push(j, ng + Math.hypot(X - ex, Y - ey)); }
        }
      }
      if (done[s1]) {
        const cells = []; for (let i = s1; i >= 0; i = from[i]) cells.push(i);
        cells.reverse();
        path = [[p.cx, p.cy]];
        cells.forEach((i, n) => { if (n % 2 === 0 || n === cells.length - 1) path.push([(i % GW) * C + C / 2, ((i / GW) | 0) * C + C / 2]); });
        path.push([q.cx, q.cy]);
        let L = 0; path.len = [0];
        for (let n = 1; n < path.length; n++) { L += Math.hypot(path[n][0] - path[n - 1][0], path[n][1] - path[n - 1][1]); path.len.push(L); }
      }
    }
    this._sp.set(key, path);
    if (this._sp.size > 400) this._sp.delete(this._sp.keys().next().value);
    return path && a.id > b.id ? path.slice().reverse() : path;
  }
  pathAt(path, u) {
    const len = path.len || (path.len = path.reduce((acc, p, n) => (acc.push(n ? acc[n - 1] + Math.hypot(p[0] - path[n - 1][0], p[1] - path[n - 1][1]) : 0), acc), []));
    const L = len[len.length - 1] * u;
    let n = 1; while (n < path.length - 1 && len[n] < L) n++;
    const f = (L - len[n - 1]) / Math.max(1e-6, len[n] - len[n - 1]);
    return [path[n - 1][0] + (path[n][0] - path[n - 1][0]) * f, path[n - 1][1] + (path[n][1] - path[n - 1][1]) * f, path[n][0] < path[n - 1][0]];
  }

  overlays(c, st, app, ox, oy, k, w, h) {
    const rt = st._rt, W = this.W;
    const P = (x, y) => [ox + (x + 0.5) * k, oy + (y + 0.5) * k];
    const vis = (x, y, m = 60) => { const [sx, sy] = P(x, y); return sx > -m && sy > -m && sx < w + m && sy < h + m; };
    c.save();
    c.lineCap = 'round';
    // Straßen
    for (const l of st.links || []) {
      if (!l.path || !l.built) continue;
      const a = l.path[0], b = l.path[l.path.length - 1];
      if (!vis(a % W, (a / W) | 0, 400) && !vis(b % W, (b / W) | 0, 400)) continue;
      c.strokeStyle = l.lvl >= 3 ? 'rgba(60, 50, 45, 0.85)' : 'rgba(110, 70, 40, 0.85)';
      c.lineWidth = Math.max(0.8, Math.min(1.8, k * (l.lvl >= 2 ? 0.16 : 0.12)));
      c.setLineDash(l.lvl >= 3 ? [] : [5, 3]);
      c.beginPath();
      l.path.slice(0, l.built).forEach((i, n) => { const [x, y] = P(i % W, (i / W) | 0); if (n) c.lineTo(x, y); else c.moveTo(x, y); });
      c.stroke();
    }
    // Seewege und Kundschafterpfade
    // Seewege: höchstens 24, die nächsten zur Mitte des Blicks (sonst ist das Meer der späten Erde voller Linien)
    c.setLineDash([2, 5]); c.strokeStyle = 'rgba(70, 60, 90, 0.5)'; c.lineWidth = 1.1;
    const routes = new Map(), mid = [w / 2, h / 2];
    for (const r of [...(st.trade || []), ...(st.routes || []).filter(x => x.sea)]) {
      const a = rt.sById.get(r.a), b = rt.sById.get(r.b);
      if (!a || !b) continue;
      const key = Math.min(a.id, b.id) + '-' + Math.max(a.id, b.id); if (routes.has(key)) continue;
      if (!vis(a.cx, a.cy, 300) && !vis(b.cx, b.cy, 300)) continue;
      const [ax, ay] = P(a.cx, a.cy), [bx, by] = P(b.cx, b.cy);
      routes.set(key, [a, b, Math.min(Math.hypot(ax - mid[0], ay - mid[1]), Math.hypot(bx - mid[0], by - mid[1]))]);
    }
    for (const [a, b] of [...routes.values()].sort((p, q) => p[2] - q[2]).slice(0, 24)) {
      const path = this.seaPath(st, a, b);
      if (!path) continue;
      c.beginPath(); path.forEach(([x, y], n) => { const [X, Y] = P(x, y); if (n) c.lineTo(X, Y); else c.moveTo(X, Y); }); c.stroke();
    }
    c.setLineDash([1.5, 3.5]); c.strokeStyle = 'rgba(150, 50, 30, 0.6)'; c.lineWidth = 1.3;
    for (const t of st.treks || []) {
      if (!t.p || t.p.length < 2 || !vis(t.p[0][0], t.p[0][1], 600)) continue;
      c.beginPath(); t.p.forEach(([x, y], n) => { const [X, Y] = P(x, y); if (n) c.lineTo(X, Y); else c.moveTo(X, Y); }); c.stroke();
    }
    c.setLineDash([]);
    // Orte: Größe nach Zoom, ganz weit draußen nur ein Punkt in der Farbe des Ortes
    for (const s of st.settlements) {
      if (!s.alive || !vis(s.cx, s.cy)) continue;
      const [x, y] = P(s.cx, s.cy);
      if (k < 1.6) {
        c.fillStyle = s.color || '#c85'; c.strokeStyle = G.INK; c.lineWidth = 1;
        c.beginPath(); c.arc(x, y, s.pop >= 120 ? 3.6 : 2.6, 0, Math.PI * 2); c.fill(); c.stroke();
        continue;
      }
      c.save(); c.translate(x, y); const z = Math.min(1.6, 0.45 + k * 0.12); c.scale(z, z); c.translate(-(s.cx + 0.5) * G.S, -(s.cy + 0.5) * G.S);
      G.town(c, s, rt);
      c.restore();
    }
    // Schiffe unterwegs
    const now = app.acc / 30;
    let ships = 0;
    for (const v of st.voyages) {
      if (ships > 40) break;
      if (v.k === 'pirat') continue;
      const A = rt.sById.get(v.a), B = v.b != null ? rt.sById.get(v.b) : null, to = B ? [B.cx, B.cy] : v.to;
      if (!A || !to) continue;
      const u = Math.max(0, Math.min(1, (st.day - v.d + now) / Math.max(1, v.dur)));
      if (!vis(A.cx, A.cy, 2000) && !vis(to[0], to[1], 2000)) continue;
      const path = this.seaPath(st, A, B || { id: -1 - (to[1] * this.W + to[0]), cx: to[0], cy: to[1] });
      if (!path) continue;
      const [xx, yy, left] = this.pathAt(path, u);
      if (!vis(xx, yy)) continue;
      const [X, Y] = P(xx, yy);
      ships++;
      G.shipGlyph(c, X, Y, Math.max(5, Math.min(14, k * 1.6)), left);
    }
    c.restore();
  }

  // Namen: Kontinente und Ozeane weit draußen, dann Meere, große Gegenden, Seen, Flüsse, Völker, Orte.
  // Echte Namen nur über bekanntem Land und Meer, darunter klein der Name, den ein Volk gegeben hat.
  labels(c, st, cx, cy, k, w, h, zoomBase) {
    const T = st.tiles, W = this.W, H = this.H, SEEN = T.seen;
    const ox = w / 2 - cx * k, oy = h / 2 - cy * k;
    const placed = [];
    const known = (x, y) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return false; return SEEN[y * W + x] >= 150; };
    const nearKnown = (x, y, r) => known(x, y) || known(x + r, y) || known(x - r, y) || known(x, y + r) || known(x, y - r);
    const put = (text, tx, ty, size, color, italic, spacing = 0, dy = 0, sub = null) => {
      const x = ox + (tx + 0.5) * k, y = oy + (ty + 0.5) * k + dy;
      if (x < -200 || y < -50 || x > w + 200 || y > h + 50) return false;
      c.font = `${italic ? 'italic ' : ''}${Math.round(size)}px ${G.FONT}`;
      c.letterSpacing = spacing ? `${spacing}em` : '0px';
      const tw = c.measureText(text).width, bw = tw / 2 + 4, bh = size * 0.62 + (sub ? size * 0.45 : 0);
      if (placed.some(b => Math.abs(b[0] - x) < b[2] + bw && Math.abs(b[1] - y) < b[3] + bh)) return false;
      placed.push([x, y, bw, bh]);
      c.lineWidth = Math.max(3, size * 0.3); c.strokeStyle = 'rgba(242, 231, 204, 0.9)'; c.lineJoin = 'round';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.strokeText(text, x, y); c.fillStyle = color; c.fillText(text, x, y);
      if (sub) {
        c.letterSpacing = '0px';
        c.font = `italic ${Math.round(size * 0.62)}px ${G.FONT}`;
        c.strokeText(sub, x, y + size * 0.82); c.fillStyle = 'rgba(95, 62, 38, 0.85)'; c.fillText(sub, x, y + size * 0.82);
      }
      return true;
    };
    const z = k;
    c.save();
    // Orte zuerst (am wichtigsten)
    for (const s of st.settlements) if (s.alive && (z >= 1.6 || s.pop >= 60)) put(s.name, s.cx, s.cy, (s.pop >= 120 ? 17 : s.pop >= 40 ? 15 : 13) * Math.min(1.25, 0.8 + z * 0.08), G.INK, true, 0, z >= 1.6 ? 15 : 10);
    // Völker an ihrer Hauptstadt (weit draußen)
    if (z < 2.4) for (const I of st.isles) {
      const cap = st._rt.sById.get(I.capital);
      if (!cap || !cap.alive) continue;
      put(L(`die ${I.name}`, `the ${I.name}`).toUpperCase(), cap.cx, cap.cy, 13, 'rgba(120, 40, 30, 0.8)', false, 0.25, -18);
    }
    // Ozeane und Meere (aus den Erddaten)
    for (const s of EARTH ? EARTH.meta.seas : []) {
      const maxR = z < 1 ? 0 : z < 2 ? 1 : z < 4 ? 3 : 6;
      if (s.rank > maxR || !nearKnown(s.x, s.y, 12)) continue;
      put(L(s.de, s.en), s.x, s.y, s.cla === 'ocean' ? 20 : s.rank <= 1 ? 16 : 13, 'rgba(50, 80, 100, 0.72)', true, s.cla === 'ocean' ? 0.3 : 0.12);
    }
    // Gegenden, Gebirge, Seen nach Rang je Zoomstufe
    const maxRank = z < 0.9 ? 1 : z < 1.6 ? 2 : z < 3 ? 3 : z < 6 ? 5 : 9;
    const regs = (st.regions || []).filter(g => (g.rank ?? 9) <= maxRank && known(g.cx, g.cy)).sort((a, b) => (a.rank - b.rank) || (b.n - a.n));
    for (const g of regs) {
      const real = g.de ? L(g.de, g.en) : null;
      const folk = g.name ? G.cap(g.name) : null;
      const txt = real || folk;
      if (!txt) continue;
      const size = Math.max(11, Math.min(20, 8 + Math.sqrt(g.n) * 0.12 * Math.min(2, z))) ;
      put(txt, g.cx, g.cy, size, g.b === 'see' ? 'rgba(50, 80, 100, 0.85)' : g.b === 'berge' ? 'rgba(80, 55, 35, 0.85)' : 'rgba(95, 62, 38, 0.8)', true, g.b === 'berge' ? 0.18 : 0.06, 0, real && folk && z >= 1.2 ? folk : null);
    }
    // große Flüsse am mittleren Stück
    if (z >= 1.8 && EARTH) {
      const done = new Set();
      EARTH.meta.rivers.forEach((r, k2) => {
        if (r.rank > (z < 4 ? 2 : 4) || done.has(r.name) || r.path.length < 20) return;
        const i = r.path[r.path.length >> 1], x = i % W, y = (i / W) | 0;
        if (!known(x, y)) return;
        if (put(L(r.name, r.en || r.name), x, y, 12, 'rgba(50, 85, 115, 0.85)', true, 0.1, -8)) done.add(r.name);
        void k2;
      });
    }
    c.restore();
    void zoomBase;
  }

  // Maßstab in km (waagrecht, in der Breite der Bildmitte) unten links
  scaleBar(c, cy, k, h) {
    const lat = lonLat(0, Math.round(cy))[1];
    const kmPx = kmPerTile() * Math.max(0.05, Math.cos(lat * Math.PI / 180)) / k;
    const nice = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];
    const target = 150 * kmPx;
    const km = nice.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a), nice[0]);
    const px = km / kmPx, x = 46, y = h - 64;
    c.save();
    c.strokeStyle = G.INK; c.fillStyle = 'rgba(242, 231, 204, 0.9)'; c.lineWidth = 1.2;
    c.fillRect(x - 8, y - 22, px + 16, 34);
    c.beginPath(); c.moveTo(x, y - 6); c.lineTo(x, y); c.lineTo(x + px, y); c.lineTo(x + px, y - 6); c.moveTo(x + px / 2, y); c.lineTo(x + px / 2, y - 4); c.stroke();
    c.font = `italic 13px ${G.FONT}`; c.fillStyle = G.INK; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.fillText(`${km.toLocaleString()} km`, x + px / 2, y - 9);
    c.restore();
  }

  // Was unter der Maus liegt
  hoverText(st, x, y) {
    const T = st.tiles, W = this.W, H = this.H, rt = st._rt;
    if (x < 0 || y < 0 || x >= W || y >= H) return '';
    const i = y * W + x;
    if (T.seen[i] < 120) return L('Unerforscht', 'Unexplored');
    let best = null, bd = 6;
    for (const s of st.settlements) if (s.alive) { const d = Math.hypot(s.cx - x, s.cy - y); if (d < bd) { bd = d; best = s; } }
    const I = best && rt.iById.get(best.isle);
    if (best) return `<b>${best.name}</b> · ${best.pop} ${L('Menschen', 'people')}${I ? ' · ' + L(`die ${I.name}`, `the ${I.name}`) : ''}`;
    const g = T.reg[i] ? (st.regions || [])[T.reg[i] - 1] : null;
    const real = g && g.de ? L(g.de, g.en) : '';
    const folk = g && g.name ? G.cap(g.name) : '';
    const Ld = rt.lById && rt.lById.get(rt.isleOf[i]);
    const [lo, la] = lonLat(x, y);
    const where = `${Math.abs(la).toFixed(0)}° ${la >= 0 ? 'N' : 'S'} ${Math.abs(lo).toFixed(0)}° ${lo >= 0 ? L('O', 'E') : 'W'}`;
    if (T.h[i] < 0) return (real ? `<b>${real}</b>${folk ? ` (${folk})` : ''} · ` : '') + (g && g.b === 'see' ? '' : L('Meer', 'Sea') + ' · ') + where;
    return (real ? `<b>${real}</b>${folk ? ` (${folk})` : ''} · ` : folk ? `<b>${folk}</b> · ` : '') + (BIOMES[T.bio[i]] ? BIOMES[T.bio[i]].name : '') + (Ld ? ` · ${L(Ld.de, Ld.en)}` : '') + ' · ' + where;
  }
}

// Weichzeichnen in einem Durchgang (3 mal 3, Mitte doppelt), wie blur in map.js
function blur1(a, W, H) {
  const b = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, w = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy; if (yy < 0 || yy >= H) continue;
      for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; const k = dx || dy ? 1 : 2; s += a[yy * W + xx] * k; w += k; }
    }
    b[y * W + x] = s / w;
  }
  return b;
}
