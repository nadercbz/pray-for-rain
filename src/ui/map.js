// Die gezeichnete Karte (seit 18.10.2026, Taste M oder Knopf oben): Pergament, Tusche und Aquarell, so wie die Menschen
// ihre Welt kennen. Gezeichnet wird nur, was bekannt ist (st.tiles.seen); der Rest bleibt leeres Pergament mit Seeungeheuern.
// Mit jeder Seefahrt, jedem Kundschafterzug und jeder neuen Stadt wächst die Karte. Pfeiltasten oder WASD schieben,
// Mausrad oder + und - zoomen, ziehen schiebt, Klick fliegt mit der Kamera dorthin, M oder Esc schließt.
import { BIOMES } from '../sim/data.js';
import { L } from '../i18n.js';
import { yearOf } from '../sim/util.js';
import { NX, NY } from '../sim/world.js';
import { EarthLayer } from './earthmap.js';

// Inselwelten: ein Grundbild mit 7 Bildpunkten je Feld. Die echte Erde (st.earth) zeichnet earthmap.js in Kacheln.
// Die Weltgröße steht beim Laden der Seite fest (index.html setzt PFR_SIZE), ein Wechsel der Welt lädt neu.
const N = NX, S = 7; // Pixel je Feld auf dem Grundbild
const W = N * S;
const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const sn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
const INK = '#3d2c1e', SEPIA = '#6b4f36', PAPER = '#efe3c6', FONT = "'IM Fell English', 'Fraunces', Georgia, serif";

// Aquarellfarben je Lebensraum (blass, wie auf alten Karten)
const WASH = { mild: '#d3dca6', wald: '#b2c690', taiga: '#a6b796', tundra: '#d4cfb4', eis: '#f2f5f3', steppe: '#e2d9a6', sumpf: '#b9bf94', savanne: '#e8d69e', wueste: '#edddae', tropen: '#a8c58c', vulkan: '#b9ab9e', salz: '#f3eee2', canyon: '#e6bc96', oase: '#c0d69c', fjord: '#b0bfa6' };
const BK = BIOMES.map(b => b.key);

export class WorldMap {
  constructor(app) {
    this.app = app;
    this.open = false;
    this.zoom = 1; this.cx = N / 2; this.cy = N / 2; // Mitte der Ansicht in Feldern
    this.keys = new Set();
    this.vel = [0, 0];
    this.base = document.createElement('canvas'); // Größe erst beim ersten Zeichnen (die Erde braucht es nicht)
    this.key = '';
    this.el = document.createElement('div');
    this.el.id = 'worldMap';
    this.el.innerHTML = `<canvas></canvas>
      <div class="wm-title"><b></b><i></i></div>
      <div class="wm-tip"></div>
      <div class="wm-ui"><button data-z="1" title="${L('Näher', 'Zoom in')}">+</button><button data-z="-1" title="${L('Weiter', 'Zoom out')}">−</button><button data-c="1" title="${L('Zur Kamera', 'To camera')}">◎</button><button data-x="1" title="${L('Schließen (M)', 'Close (M)')}">✕</button></div>
      <div class="wm-hint">${L('Pfeiltasten oder WASD bewegen · Mausrad zoomt · Klick fliegt hin · M schließt', 'Arrow keys or WASD move · wheel zooms · click flies there · M closes')}</div>`;
    document.body.appendChild(this.el);
    this.cv = this.el.querySelector('canvas');
    this.ctx = this.cv.getContext('2d');
    this.tip = this.el.querySelector('.wm-tip');
    injectCss();
    this.el.querySelector('.wm-ui').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.z) this.zoomAt(+b.dataset.z > 0 ? 1.35 : 1 / 1.35);
      if (b.dataset.c) this.centerOnCamera();
      if (b.dataset.x) this.toggle(false);
    });
    // Ziehen schiebt, Klick fliegt
    let drag = null;
    this.cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy, moved: false }; this.cv.setPointerCapture(e.pointerId); });
    this.cv.addEventListener('pointermove', e => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.hypot(dx, dy) > 4) drag.moved = true;
        const k = this.scale();
        this.cx = drag.cx - dx / k; this.cy = drag.cy - dy / k;
      }
      this.hover(e);
    });
    this.cv.addEventListener('pointerup', e => {
      if (drag && !drag.moved) {
        const [x, y] = this.toTile(e.clientX, e.clientY);
        if (x >= 0 && y >= 0 && x < NX && y < NY) { this.toggle(false); this.app.focus(x, y, 60); }
      }
      drag = null;
    });
    this.cv.addEventListener('wheel', e => { e.preventDefault(); this.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
    window.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey) { if (!this.app.ghostActive || !this.app.ghostActive()) { this.toggle(); e.preventDefault(); } return; }
      if (!this.open) return;
      if (e.key === 'Escape') { this.toggle(false); e.stopPropagation(); return; }
      const k = { ArrowUp: 'u', w: 'u', W: 'u', ArrowDown: 'd', s: 'd', S: 'd', ArrowLeft: 'l', a: 'l', A: 'l', ArrowRight: 'r', d: 'r', D: 'r' }[e.key];
      if (k) { this.keys.add(k); e.preventDefault(); }
      if (e.key === '+' || e.key === '=') this.zoomAt(1.25);
      if (e.key === '-' || e.key === '_') this.zoomAt(1 / 1.25);
    }, true);
    window.addEventListener('keyup', e => {
      const k = { ArrowUp: 'u', w: 'u', W: 'u', ArrowDown: 'd', s: 'd', S: 'd', ArrowLeft: 'l', a: 'l', A: 'l', ArrowRight: 'r', d: 'r', D: 'r' }[e.key];
      if (k) this.keys.delete(k);
    });
    window.addEventListener('resize', () => { if (this.open) this.fit(); });
  }

  toggle(on = !this.open) {
    if (on === this.open) return;
    this.open = on;
    this.app.mapOpen = on;
    this.el.classList.toggle('show', on);
    this.keys.clear();
    if (on) {
      this.fit();
      this.centerOnCamera(true);
      this.rebuild(true);
    }
  }

  fit() {
    const r = window.devicePixelRatio || 1;
    this.cv.width = Math.round(innerWidth * r); this.cv.height = Math.round(innerHeight * r);
    this.cv.style.width = innerWidth + 'px'; this.cv.style.height = innerHeight + 'px';
  }

  // Die Karte bleibt im Bild: nie über den Rand der Welt hinaus schieben
  clamp() {
    const k = this.scale(), hw = innerWidth / 2 / k, hh = innerHeight / 2 / k;
    this.cx = NX > hw * 2 ? Math.max(hw, Math.min(NX - hw, this.cx)) : NX / 2;
    this.cy = NY > hh * 2 ? Math.max(hh, Math.min(NY - hh, this.cy)) : NY / 2;
  }

  get isEarth() { return !!(this.app.st && this.app.st.earth); }
  // Pixel je Feld auf dem Bildschirm (Erde: bei Zoom 1 passt die ganze Breite ins Bild)
  scale() { return this.isEarth ? innerWidth / NX * this.zoom : Math.min(innerWidth, innerHeight) / N * 1.15 * this.zoom; }
  zoomRange() { return this.isEarth ? [Math.max(1, innerHeight / NY / (innerWidth / NX)), 60] : [0.6, 5]; }
  toTile(px, py) { const k = this.scale(); return [Math.floor(this.cx + (px - innerWidth / 2) / k), Math.floor(this.cy + (py - innerHeight / 2) / k)]; }

  zoomAt(f, px = innerWidth / 2, py = innerHeight / 2) {
    const k0 = this.scale();
    const tx = this.cx + (px - innerWidth / 2) / k0, ty = this.cy + (py - innerHeight / 2) / k0;
    const [zmin, zmax] = this.zoomRange();
    this.zoom = Math.max(zmin, Math.min(zmax, this.zoom * f));
    const k1 = this.scale();
    this.cx = tx - (px - innerWidth / 2) / k1; this.cy = ty - (py - innerHeight / 2) / k1;
  }

  centerOnCamera(fitKnown) {
    const st = this.app.st; if (!st) return;
    const t = this.app.stage.controls.target;
    this.cx = t.x + NX / 2; this.cy = t.z + NY / 2;
    if (fitKnown) {
      // so weit hinaus, dass alles Bekannte zu sehen ist (auf der Erde: rund um die Kamera, die Welt ist zu groß)
      const S0 = st.tiles.seen, R = this.isEarth ? 260 : Infinity;
      let x0 = NX, y0 = NY, x1 = 0, y1 = 0;
      const xa = Math.max(0, Math.floor(this.cx - R)), xb = Math.min(NX, Math.ceil(this.cx + R)), ya = Math.max(0, Math.floor(this.cy - R)), yb = Math.min(NY, Math.ceil(this.cy + R));
      for (let y = ya; y < yb; y += 2) for (let x = xa; x < xb; x += 2) if (S0[y * NX + x] > 150) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      if (x1 > x0) {
        const span = Math.max(x1 - x0, y1 - y0) + 30;
        const [zmin, zmax] = this.zoomRange();
        if (this.isEarth) this.zoom = Math.max(zmin, Math.min(zmax, Math.min(innerWidth, innerHeight) / span / (innerWidth / NX)));
        else this.zoom = Math.max(0.8, Math.min(5, N / span));
        this.cx = (x0 + x1) / 2; this.cy = (y0 + y1) / 2;
      }
    }
  }

  // Was die Karte gerade zeigen muss: ändert sich etwas daran, wird das Grundbild neu gezeichnet
  stateKey(st) {
    const rt = st._rt;
    let k = (rt.seenGen || 0) + ':' + st.settlements.filter(s => s.alive).map(s => s.id + '.' + Math.round(s.pop / 10)).join(',');
    k += ':' + (st.links || []).reduce((a, l) => a + (l.built | 0) + (l.lvl | 0) * 1000, 0);
    k += ':' + (st.regions || []).filter(g => g.name).length + ':' + (st.treks || []).length + ':' + (st.trade || []).length;
    return k;
  }

  rebuild(force) {
    const st = this.app.st; if (!st) return;
    if (st.earth) return; // die Erde zeichnet ihre Kacheln selbst (earthmap.js)
    const key = this.stateKey(st);
    if (!force && key === this.key) return;
    this.key = key;
    const t0 = performance.now();
    if (this.base.width !== W) { this.base.width = W; this.base.height = W; }
    drawBase(this.base, st);
    this.buildMs = performance.now() - t0;
  }

  frame(dt) {
    if (!this.open) return;
    const st = this.app.st;
    this.t = (this.t || 0) + dt;
    if (this.t - (this.lastCheck || 0) > 1.5) { this.lastCheck = this.t; this.rebuild(false); }
    // Tasten: weich anfahren, Tempo nach Zoom
    const want = [(this.keys.has('r') ? 1 : 0) - (this.keys.has('l') ? 1 : 0), (this.keys.has('d') ? 1 : 0) - (this.keys.has('u') ? 1 : 0)];
    const sp = 140 / this.zoom;
    this.vel[0] += (want[0] * sp - this.vel[0]) * Math.min(1, dt * 8);
    this.vel[1] += (want[1] * sp - this.vel[1]) * Math.min(1, dt * 8);
    this.cx += this.vel[0] * dt; this.cy += this.vel[1] * dt;
    this.clamp();
    if (st.earth) this.drawEarth(st); else this.draw(st);
  }

  // Die Erde: Kacheln aus earthmap.js, darüber Blick der Kamera, dein Mensch, Namen, Rahmen, Windrose, Maßstab
  drawEarth(st) {
    const c = this.ctx, r = window.devicePixelRatio || 1, w = innerWidth, h = innerHeight, k = this.scale();
    if (!this.earth) this.earth = new EarthLayer();
    c.setTransform(r, 0, 0, r, 0, 0);
    c.fillStyle = '#e3d3ad'; c.fillRect(0, 0, w, h);
    this.earth.draw(c, st, this.app, this.cx, this.cy, k, w, h);
    const rt = st._rt, ox = w / 2 - this.cx * k, oy = h / 2 - this.cy * k;
    const t = this.app.stage.controls.target;
    const tx = ox + (t.x + NX / 2) * k, ty = oy + (t.z + NY / 2) * k;
    const dist = this.app.stage.camera.position.distanceTo(t);
    c.strokeStyle = 'rgba(160, 40, 30, 0.85)'; c.lineWidth = 2; c.setLineDash([6, 4]);
    const vw = Math.max(10, dist * 0.55 * k);
    c.strokeRect(tx - vw, ty - vw * 0.62, vw * 2, vw * 1.24);
    c.setLineDash([]);
    const H = st.hero && !st.hero.end ? rt.pById.get(st.hero.id) : null;
    if (H) { const s = rt.sById.get(H.s); if (s) star(c, ox + (s.cx + 0.5) * k, oy + (s.cy + 0.5) * k - 14, 7); }
    this.earth.labels(c, st, this.cx, this.cy, k, w, h);
    vignette(c, w, h);
    compass(c, w - 92, h - 110, 62, this.t);
    this.earth.scaleBar(c, this.cy, k, h);
    const yr = yearOf ? yearOf(st.day) : Math.floor(st.day / 24) + 1;
    this.el.querySelector('.wm-title b').textContent = L('Karte der bekannten Welt', 'Map of the Known World');
    this.el.querySelector('.wm-title i').textContent = L(`gezeichnet im Jahr ${yr}`, `drawn in the year ${yr}`);
  }

  draw(st) {
    const c = this.ctx, r = window.devicePixelRatio || 1, w = innerWidth, h = innerHeight, k = this.scale();
    c.setTransform(r, 0, 0, r, 0, 0);
    c.fillStyle = '#d9c9a3'; c.fillRect(0, 0, w, h);
    // Grundbild
    c.save();
    c.translate(w / 2 - this.cx * k, h / 2 - this.cy * k);
    c.scale(k / S, k / S);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(this.base, 0, 0);
    c.restore();
    // Bewegliches: Schiffe unterwegs, Blick der Kamera, dein Mensch
    c.save();
    c.translate(w / 2 - this.cx * k, h / 2 - this.cy * k);
    const rt = st._rt;
    const now = this.app.acc / 30;
    for (const v of st.voyages) {
      if (v.k === 'pirat') continue;
      const A = rt.sById.get(v.a), B = v.b != null ? rt.sById.get(v.b) : null, to = B ? [B.cx, B.cy] : v.to;
      if (!A || !to) continue;
      const u = Math.max(0, Math.min(1, (st.day - v.d + now) / Math.max(1, v.dur)));
      const x = (A.cx + (to[0] - A.cx) * u + 0.5) * k, y = (A.cy + (to[1] - A.cy) * u + 0.5) * k;
      shipGlyph(c, x, y, Math.max(5, k * 1.6), to[0] < A.cx);
    }
    const t = this.app.stage.controls.target;
    const tx = (t.x + N / 2) * k, ty = (t.z + N / 2) * k;
    const dist = this.app.stage.camera.position.distanceTo(t);
    c.strokeStyle = 'rgba(160, 40, 30, 0.85)'; c.lineWidth = 2; c.setLineDash([6, 4]);
    const vw = Math.max(10, dist * 0.55 * k);
    c.strokeRect(tx - vw, ty - vw * 0.62, vw * 2, vw * 1.24);
    c.setLineDash([]);
    const H = st.hero && !st.hero.end ? rt.pById.get(st.hero.id) : null;
    if (H) { const s = rt.sById.get(H.s); if (s) star(c, (s.cx + 0.5) * k, (s.cy + 0.5) * k - 14, 7); }
    c.restore();
    this.labels(st, k);
    // Rahmen und Windrose
    vignette(c, w, h);
    compass(c, w - 92, h - 110, 62, this.t);
    const yr = yearOf ? yearOf(st.day) : Math.floor(st.day / 24) + 1;
    this.el.querySelector('.wm-title b').textContent = L('Karte der bekannten Welt', 'Map of the Known World');
    this.el.querySelector('.wm-title i').textContent = L(`gezeichnet im Jahr ${yr}`, `drawn in the year ${yr}`);
  }

  // Namen: Festland und Inseln, dann Orte, dann Gegenden; was sich überdeckt, fällt weg
  labels(st, k) {
    const c = this.ctx, w = innerWidth, h = innerHeight, SEEN = st.tiles.seen;
    const ox = w / 2 - this.cx * k, oy = h / 2 - this.cy * k;
    const placed = [];
    const z = Math.max(0.75, Math.min(1.5, 0.8 + this.zoom * 0.12));
    const put = (text, tx, ty, size, color, italic, spacing, dy = 0) => {
      const x = ox + (tx + 0.5) * k, y = oy + (ty + 0.5) * k + dy;
      if (x < -200 || y < -50 || x > w + 200 || y > h + 50) return;
      c.font = `${italic ? 'italic ' : ''}${Math.round(size)}px ${FONT}`;
      c.letterSpacing = spacing ? `${spacing}em` : '0px';
      const tw = c.measureText(text).width, bw = tw / 2 + 4, bh = size * 0.62;
      if (placed.some(b => Math.abs(b[0] - x) < b[2] + bw && Math.abs(b[1] - y) < b[3] + bh)) return;
      placed.push([x, y, bw, bh]);
      c.lineWidth = Math.max(3, size * 0.3); c.strokeStyle = 'rgba(242, 231, 204, 0.9)'; c.lineJoin = 'round';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.strokeText(text, x, y); c.fillStyle = color; c.fillText(text, x, y);
    };
    c.save();
    for (const I of st.isles) {
      if (SEEN[I.cy * N + I.cx] < 150 && SEEN[I.ry * N + I.rx] < 150) continue;
      if (I.cont) put(I.name.toUpperCase(), I.cx, I.cy, 30 * z + this.zoom * 3, 'rgba(45, 32, 22, 0.85)', false, 0.5);
      else put(I.name, I.cx, I.cy, Math.max(15, Math.min(24, 9 + Math.sqrt(I.area) * 0.4)) * z, 'rgba(45, 32, 22, 0.88)', false, 0.18, -Math.min(26, Math.sqrt(I.area) * 0.35 * k / 3));
    }
    for (const s of st.settlements) if (s.alive) put(s.name, s.cx, s.cy, (s.pop >= 120 ? 17 : s.pop >= 40 ? 15 : 13) * z, INK, true, 0, 15 * z);
    if (this.zoom > 0.9) for (const g of [...(st.regions || [])].sort((a, b) => b.n - a.n)) {
      if (!g.name || SEEN[g.cy * N + g.cx] < 150) continue;
      if (g.n < 140 / this.zoom && g.b !== 'see' && g.b !== 'vulkan' && g.b !== 'oase') continue;
      put(cap(g.name), g.cx, g.cy, Math.max(11, Math.min(22, 7 + Math.sqrt(g.n) * 0.3)) * z, g.b === 'see' ? 'rgba(50, 80, 100, 0.85)' : 'rgba(95, 62, 38, 0.8)', true, 0.08);
    }
    c.restore();
  }

  hover(e) {
    const st = this.app.st; if (!st) return;
    const [x, y] = this.toTile(e.clientX, e.clientY);
    if (x < 0 || y < 0 || x >= NX || y >= NY) { this.tip.style.opacity = 0; return; }
    if (st.earth && this.earth) {
      this.tip.innerHTML = this.earth.hoverText(st, x, y);
      this.tip.style.left = e.clientX + 16 + 'px'; this.tip.style.top = e.clientY + 14 + 'px';
      this.tip.style.opacity = 1;
      return;
    }
    const i = y * N + x, T = st.tiles, rt = st._rt;
    let txt = '';
    if (T.seen[i] < 120) txt = L('Unerforscht', 'Unexplored');
    else {
      let best = null, bd = 6;
      for (const s of st.settlements) if (s.alive) { const d = Math.hypot(s.cx - x, s.cy - y); if (d < bd) { bd = d; best = s; } }
      if (best) txt = `<b>${best.name}</b> · ${best.pop} ${L('Menschen', 'people')}`;
      else {
        const g = T.reg[i] ? (st.regions || [])[T.reg[i] - 1] : null;
        const I = rt.iById.get(rt.isleOf[i]);
        if (T.h[i] < 0) txt = g && g.name ? `<b>${cap(g.name)}</b>` : L('Meer', 'Sea');
        else txt = (g && g.name ? `<b>${cap(g.name)}</b> · ` : '') + (BIOMES[T.bio[i]] ? (I && !I.nw && !T.bio[i] ? L('Grasland', 'Grassland') : BIOMES[T.bio[i]].name) : '') + (I ? ` · ${I.name}` : '');
      }
    }
    this.tip.innerHTML = txt;
    this.tip.style.left = e.clientX + 16 + 'px'; this.tip.style.top = e.clientY + 14 + 'px';
    this.tip.style.opacity = 1;
  }
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- Grundbild ----------

function drawBase(cv, st) {
  const c = cv.getContext('2d');
  const T = st.tiles, rt = st._rt, Hh = T.h, SEEN = T.seen;
  const known = i => SEEN[i] >= 150;
  // 1 Pergament
  paper(c);
  // 2 Bekanntes in eine eigene Ebene, die am Ende mit dem Erkundungsrand ausgeschnitten wird
  const kv = document.createElement('canvas'); kv.width = W; kv.height = W;
  const k = kv.getContext('2d');
  // Meer und Land als Aquarell (ein Bild mit einem Pixel je Feld, weich vergrößert)
  const small = document.createElement('canvas'); small.width = N; small.height = N;
  const sc = small.getContext('2d'), img = sc.createImageData(N, N), D = img.data;
  const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const WR = BK.map(b => rgb(WASH[b] || WASH.mild));
  const sea = rgb('#c5d6cf'), deep = rgb('#d6e0d6');
  const dist = landDist(Hh);
  for (let i = 0; i < N * N; i++) {
    let col;
    if (Hh[i] < 0) { const t = Math.min(1, dist[i] / 9); col = [sea[0] + (deep[0] - sea[0]) * t, sea[1] + (deep[1] - sea[1]) * t, sea[2] + (deep[2] - sea[2]) * t]; }
    else {
      col = WR[T.bio[i]].slice();
      const x = i % N, y = (i / N) | 0, n = sn(x * 0.35, y * 0.35) - 0.5;
      if (Hh[i] >= 4) { col[0] = col[0] * 0.92 + 14; col[1] = col[1] * 0.92 + 10; col[2] = col[2] * 0.92 + 4; }
      if (T.tree[i] >= 2) { col[0] -= 14; col[1] -= 6; col[2] -= 14; }
      col[0] += n * 16; col[1] += n * 14; col[2] += n * 10;
    }
    D[i * 4] = col[0]; D[i * 4 + 1] = col[1]; D[i * 4 + 2] = col[2]; D[i * 4 + 3] = 235;
  }
  sc.putImageData(img, 0, 0);
  k.imageSmoothingEnabled = true; k.imageSmoothingQuality = 'high';
  k.drawImage(small, 0, 0, W, W);
  // Pinselkörnung
  grain(k, 0.06);
  // 3 Küstenlinien und Wellenlinien davor
  const landF = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) landF[i] = Hh[i] >= 0 ? 1 : 0;
  const blurred = blur(landF, 1);
  ink(k, contour(blurred, 0.5), INK, 1.7, 0.95);
  const df = new Float32Array(N * N); for (let i = 0; i < N * N; i++) df[i] = Math.min(9, dist[i]);
  ink(k, contour(blur(df, 1), 1.6), SEPIA, 0.9, 0.45);
  ink(k, contour(blur(df, 1), 3.1), SEPIA, 0.7, 0.28);
  ink(k, contour(blur(df, 1), 4.8), SEPIA, 0.6, 0.16);
  // 4 Flüsse
  k.strokeStyle = 'rgba(70, 110, 140, 0.9)'; k.lineCap = 'round'; k.lineJoin = 'round';
  for (const p of st.rivers || []) {
    k.lineWidth = 1.2;
    k.beginPath();
    p.forEach((i, n) => { const x = (i % N + 0.5) * S + (hash(i, 3) - 0.5) * 2, y = (((i / N) | 0) + 0.5) * S + (hash(i, 5) - 0.5) * 2; if (n) k.lineTo(x, y); else k.moveTo(x, y); if (n % 12 === 11) { k.stroke(); k.lineWidth = Math.min(3, k.lineWidth + 0.35); k.beginPath(); k.moveTo(x, y); } });
    k.stroke();
  }
  // 5 Zeichen für die Landschaft
  symbols(k, st);
  // 6 Straßen, Seewege, Kundschafterpfade
  k.lineCap = 'round';
  for (const l of st.links || []) {
    if (!l.path || !l.built) continue;
    k.strokeStyle = l.lvl >= 3 ? 'rgba(60, 50, 45, 0.85)' : 'rgba(110, 70, 40, 0.85)';
    k.lineWidth = l.lvl >= 2 ? 1.8 : 1.2;
    k.setLineDash(l.lvl >= 3 ? [] : [5, 3]);
    k.beginPath();
    l.path.slice(0, l.built).forEach((i, n) => { const x = (i % N + 0.5) * S, y = (((i / N) | 0) + 0.5) * S; if (n) k.lineTo(x, y); else k.moveTo(x, y); });
    k.stroke();
  }
  k.setLineDash([2, 5]); k.strokeStyle = 'rgba(70, 60, 90, 0.55)'; k.lineWidth = 1.1;
  const routes = new Set();
  for (const r of [...(st.trade || []), ...(st.routes || [])]) {
    const a = rt.sById.get(r.a), b = rt.sById.get(r.b);
    if (!a || !b || a.isle === b.isle) continue;
    const key = Math.min(a.id, b.id) + '-' + Math.max(a.id, b.id); if (routes.has(key)) continue; routes.add(key);
    const mx = (a.cx + b.cx) / 2 + (b.cy - a.cy) * 0.12, my = (a.cy + b.cy) / 2 - (b.cx - a.cx) * 0.12;
    k.beginPath(); k.moveTo((a.cx + 0.5) * S, (a.cy + 0.5) * S); k.quadraticCurveTo(mx * S, my * S, (b.cx + 0.5) * S, (b.cy + 0.5) * S); k.stroke();
  }
  k.setLineDash([1.5, 3.5]); k.strokeStyle = 'rgba(150, 50, 30, 0.6)'; k.lineWidth = 1.3;
  for (const t of st.treks || []) {
    if (!t.p || t.p.length < 2) continue;
    k.beginPath(); t.p.forEach(([x, y], n) => { if (n) k.lineTo((x + 0.5) * S, (y + 0.5) * S); else k.moveTo((x + 0.5) * S, (y + 0.5) * S); }); k.stroke();
  }
  k.setLineDash([]);
  // 7 Orte
  const alive = st.settlements.filter(s => s.alive);
  for (const s of alive) town(k, s, rt);
  // 8 Namen kommen beim Zeichnen dazu (scharf in jeder Zoomstufe, ohne Überlappung)
  // 9 Erkundungsrand: Bekanntes ausschneiden, Rand leicht gerissen.
  // Kleine unbekannte Meeresflecken zwischen befahrenen Routen gelten als bekannt (sonst Löcher im Meer)
  const KN = fillSeaHoles(SEEN, Hh);
  const mask = document.createElement('canvas'); mask.width = N * 2; mask.height = N * 2;
  const mc = mask.getContext('2d'), mi = mc.createImageData(N * 2, N * 2), MD = mi.data;
  for (let y = 0; y < N * 2; y++) for (let x = 0; x < N * 2; x++) {
    const u = x / 2 - 0.25, v = y / 2 - 0.25;
    const x0 = Math.max(0, Math.min(N - 2, Math.floor(u))), y0 = Math.max(0, Math.min(N - 2, Math.floor(v)));
    const fx = u - x0, fy = v - y0;
    const a = KN[y0 * N + x0], b = KN[y0 * N + x0 + 1], cc = KN[(y0 + 1) * N + x0], d = KN[(y0 + 1) * N + x0 + 1];
    const val = (a + (b - a) * fx + (cc - a) * fy + (a - b - cc + d) * fx * fy) / 255;
    const nz = sn(x * 0.21, y * 0.21) * 0.6 + sn(x * 0.7 + 9, y * 0.7) * 0.4;
    const al = Math.max(0, Math.min(1, (val - 0.42 + (nz - 0.5) * 0.38) * 9));
    const j = (y * N * 2 + x) * 4; MD[j] = MD[j + 1] = MD[j + 2] = 0; MD[j + 3] = al * 255;
  }
  mc.putImageData(mi, 0, 0);
  k.globalCompositeOperation = 'destination-in';
  k.imageSmoothingEnabled = true;
  k.drawImage(mask, 0, 0, W, W);
  k.globalCompositeOperation = 'source-over';
  // Rhumblinien und Ungeheuer aufs leere Pergament, Schatten des Randes, dann das Bekannte darüber
  rhumb(c);
  monsters(c, st);
  c.save(); c.filter = 'blur(5px)'; c.globalAlpha = 0.28; c.drawImage(mask, 0, 0, W, W); c.restore();
  c.drawImage(kv, 0, 0);
}

function fillSeaHoles(SEEN, h) {
  const K = SEEN.slice();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    if (SEEN[i] >= 150 || h[i] >= 0) continue;
    let dirs = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let k = 1; k <= 16; k++) { const xx = x + dx * k, yy = y + dy * k; if (xx < 0 || yy < 0 || xx >= N || yy >= N) break; if (SEEN[yy * N + xx] >= 150) { dirs++; break; } }
    }
    if (dirs >= 4) K[i] = 220;
  }
  return K;
}

function paper(c) {
  const g = c.createRadialGradient(W / 2, W / 2, W * 0.1, W / 2, W / 2, W * 0.75);
  g.addColorStop(0, '#f2e7cc'); g.addColorStop(1, '#dfcda6');
  c.fillStyle = g; c.fillRect(0, 0, W, W);
  // Flecken und Fasern
  for (let k = 0; k < 90; k++) {
    const x = hash(k, 1) * W, y = hash(k, 2) * W, r = 20 + hash(k, 3) * 120;
    const gg = c.createRadialGradient(x, y, 0, x, y, r);
    gg.addColorStop(0, `rgba(150, 110, 60, ${0.04 + hash(k, 4) * 0.05})`); gg.addColorStop(1, 'rgba(150, 110, 60, 0)');
    c.fillStyle = gg; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  grain(c, 0.08);
}

function grain(c, a) {
  const n = 2600;
  c.save();
  for (let k = 0; k < n; k++) {
    const x = hash(k, 11) * W, y = hash(k, 12) * W;
    c.fillStyle = hash(k, 13) < 0.5 ? `rgba(90, 60, 30, ${a})` : `rgba(255, 250, 235, ${a * 1.4})`;
    c.fillRect(x, y, 1 + hash(k, 14) * 2, 1);
  }
  c.restore();
}

// Abstand zum Land je Feld (für Wellenlinien und die Meeresfarbe)
function landDist(h) {
  const d = new Float32Array(N * N).fill(1e9), q = [];
  for (let i = 0; i < N * N; i++) if (h[i] >= 0) { d[i] = 0; q.push(i); }
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % N, y = (i / N) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
      const j = yy * N + xx; if (d[j] > d[i] + 1) { d[j] = d[i] + 1; q.push(j); }
    }
  }
  return d;
}

function blur(f, passes) {
  let a = f;
  for (let p = 0; p < passes; p++) {
    const b = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let s = 0, w = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue; const k = dx || dy ? 1 : 2; s += a[yy * N + xx] * k; w += k; }
      b[y * N + x] = s / w;
    }
    a = b;
  }
  return a;
}

// Höhenlinie (Marching Squares) als Liste von Strecken in Feldkoordinaten
function contour(f, iso) {
  const seg = [];
  const v = (x, y) => f[y * N + x];
  const lerp = (a, b) => (iso - a) / (b - a);
  for (let y = 0; y < N - 1; y++) for (let x = 0; x < N - 1; x++) {
    const a = v(x, y), b = v(x + 1, y), c = v(x + 1, y + 1), d = v(x, y + 1);
    const idx = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (c > iso ? 2 : 0) | (d > iso ? 1 : 0);
    if (idx === 0 || idx === 15) continue;
    const T = [x + lerp(a, b), y], R = [x + 1, y + lerp(b, c)], B = [x + lerp(d, c), y + 1], Lf = [x, y + lerp(a, d)];
    const P = { 1: [[Lf, B]], 2: [[B, R]], 3: [[Lf, R]], 4: [[T, R]], 5: [[Lf, T], [B, R]], 6: [[T, B]], 7: [[Lf, T]], 8: [[Lf, T]], 9: [[T, B]], 10: [[T, R], [Lf, B]], 11: [[T, R]], 12: [[Lf, R]], 13: [[B, R]], 14: [[Lf, B]] }[idx];
    for (const s of P) seg.push(s);
  }
  return seg;
}

// Tuschestrich mit leichtem Zittern (wie mit der Feder gezogen)
function ink(c, seg, color, width, alpha) {
  c.save();
  c.strokeStyle = color; c.globalAlpha = alpha; c.lineWidth = width; c.lineCap = 'round';
  c.beginPath();
  for (const [p, q] of seg) {
    const j = (x, y) => (sn(x * 1.7, y * 1.7) - 0.5) * 0.5;
    c.moveTo((p[0] + 0.5 + j(p[0], p[1])) * S, (p[1] + 0.5 + j(p[1] + 3, p[0])) * S);
    c.lineTo((q[0] + 0.5 + j(q[0], q[1])) * S, (q[1] + 0.5 + j(q[1] + 3, q[0])) * S);
  }
  c.stroke();
  c.restore();
}

// Berge, Wälder, Wüsten, Sümpfe, Eis, Vulkane als kleine Zeichen
function symbols(c, st) {
  const T = st.tiles, h = T.h;
  c.save();
  c.lineCap = 'round'; c.lineJoin = 'round';
  // Berge zuerst (von hinten nach vorn: oben zuerst)
  for (let y = 1; y < N - 1; y += 2) for (let x = 1 + (y % 4 === 1 ? 1 : 0); x < N - 1; x += 3) {
    const i = y * N + x, l = h[i];
    if (l < 3) continue;
    const jx = (hash(x, y) - 0.5) * 1.4, jy = (hash(y, x) - 0.5) * 1.2;
    const X = (x + 0.5 + jx) * S, Y = (y + 0.5 + jy) * S;
    if (l === 3) { if (hash(x + 3, y) < 0.55) hill(c, X, Y, S * 1.1); continue; }
    const bk = BK[T.bio[i]];
    mountain(c, X, Y, S * (0.9 + (l - 4) * 0.28), bk === 'eis' || bk === 'tundra' || bk === 'taiga' || bk === 'fjord' || l >= 6, bk === 'canyon' ? '#c98a62' : null);
  }
  for (const [vx, vy] of st.volc || []) volcano(c, (vx + 0.5) * S, (vy + 0.5) * S, S * 2.4);
  // Wälder und Landschaftszeichen
  for (let y = 0; y < N; y += 2) for (let x = (y % 4 ? 1 : 0); x < N; x += 2) {
    const i = y * N + x, l = h[i];
    if (l < 0 || l >= 4) continue;
    const bk = BK[T.bio[i]];
    const X = (x + 0.5 + (hash(x * 3, y) - 0.5) * 1.2) * S, Y = (y + 0.5 + (hash(x, y * 3) - 0.5) * 1.2) * S;
    const r = hash(x + 7, y + 7);
    if (T.tree[i] >= 2 || (T.tree[i] === 1 && r < 0.35)) {
      if (bk === 'taiga' || bk === 'fjord' || (bk === 'tundra') || l === 3) pine(c, X, Y, S * 0.9);
      else if (bk === 'tropen') { if (r < 0.4) palm(c, X, Y, S); else blob(c, X, Y, S * 0.95, '#6f9a58'); }
      else if (bk === 'savanne') acacia(c, X, Y, S);
      else if (bk === 'oase') palm(c, X, Y, S);
      else if (bk === 'sumpf') blob(c, X, Y, S * 0.8, '#7f9265');
      else blob(c, X, Y, S * 0.85, '#8fae6c');
      continue;
    }
    if (bk === 'wueste' && r < 0.3) dune(c, X, Y, S);
    else if (bk === 'wueste' && r < 0.36) cactus(c, X, Y, S * 0.8);
    else if (bk === 'canyon' && r < 0.25) mesa(c, X, Y, S);
    else if (bk === 'salz' && r < 0.3) crack(c, X, Y, S);
    else if (bk === 'sumpf' && r < 0.45) tuft(c, X, Y, S, true);
    else if ((bk === 'tundra' || bk === 'steppe') && r < 0.18) tuft(c, X, Y, S, false);
    else if (bk === 'savanne' && r < 0.12) acacia(c, X, Y, S * 0.9);
    else if (bk === 'eis' && r < 0.4) iceHatch(c, X, Y, S);
  }
  c.restore();
}

function mountain(c, x, y, s, snow, tint) {
  const w = s * 1.15, hgt = s * 1.35;
  c.fillStyle = tint || '#e9dcc0';
  c.beginPath(); c.moveTo(x - w, y); c.lineTo(x - w * 0.1, y - hgt); c.lineTo(x + w, y); c.closePath(); c.fill();
  // Schattenseite schraffiert
  c.strokeStyle = 'rgba(70, 50, 35, 0.55)'; c.lineWidth = 0.8;
  c.beginPath();
  for (let k = 1; k < 5; k++) { const u = k / 5; c.moveTo(x - w * 0.1 + w * 1.1 * u * 0.9, y - hgt + hgt * u); c.lineTo(x - w * 0.1 + w * 0.15 * u, y - hgt * 0.55 + hgt * 0.55 * u); }
  c.stroke();
  if (snow) { c.fillStyle = '#fbfaf6'; c.beginPath(); c.moveTo(x - w * 0.1, y - hgt); c.lineTo(x - w * 0.42, y - hgt * 0.62); c.lineTo(x - w * 0.18, y - hgt * 0.7); c.lineTo(x + w * 0.05, y - hgt * 0.58); c.lineTo(x + w * 0.24, y - hgt * 0.7); c.closePath(); c.fill(); }
  c.strokeStyle = INK; c.lineWidth = 1.2;
  c.beginPath(); c.moveTo(x - w, y); c.lineTo(x - w * 0.1, y - hgt); c.lineTo(x + w, y); c.stroke();
}
function hill(c, x, y, s) { c.strokeStyle = 'rgba(70, 50, 35, 0.7)'; c.lineWidth = 1; c.beginPath(); c.arc(x, y + s * 0.4, s * 0.9, Math.PI * 1.15, Math.PI * 1.85); c.stroke(); }
function volcano(c, x, y, s) {
  c.fillStyle = '#8c7a6a'; c.strokeStyle = INK; c.lineWidth = 1.4;
  c.beginPath(); c.moveTo(x - s, y + s * 0.3); c.lineTo(x - s * 0.22, y - s * 0.75); c.lineTo(x + s * 0.22, y - s * 0.75); c.lineTo(x + s, y + s * 0.3); c.closePath(); c.fill(); c.stroke();
  c.fillStyle = '#d2542c'; c.beginPath(); c.ellipse(x, y - s * 0.75, s * 0.22, s * 0.08, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(80, 70, 70, 0.6)'; c.lineWidth = 1.2;
  c.beginPath(); c.moveTo(x, y - s * 0.8); c.bezierCurveTo(x - s * 0.4, y - s * 1.2, x + s * 0.4, y - s * 1.4, x - s * 0.1, y - s * 1.8); c.stroke();
}
function pine(c, x, y, s) {
  c.fillStyle = '#6f8f68'; c.strokeStyle = INK; c.lineWidth = 0.9;
  c.beginPath(); c.moveTo(x, y - s * 1.3); c.lineTo(x - s * 0.5, y); c.lineTo(x + s * 0.5, y); c.closePath(); c.fill(); c.stroke();
  c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + s * 0.3); c.stroke();
}
function blob(c, x, y, s, fill) {
  c.fillStyle = fill; c.strokeStyle = INK; c.lineWidth = 0.9;
  c.beginPath(); c.arc(x, y - s * 0.45, s * 0.55, 0, Math.PI * 2); c.fill(); c.stroke();
  c.beginPath(); c.moveTo(x, y + s * 0.1); c.lineTo(x, y + s * 0.4); c.stroke();
}
function palm(c, x, y, s) {
  c.strokeStyle = INK; c.lineWidth = 1;
  c.beginPath(); c.moveTo(x, y + s * 0.3); c.quadraticCurveTo(x + s * 0.15, y - s * 0.3, x + s * 0.05, y - s * 0.8); c.stroke();
  c.strokeStyle = '#4f7a3a'; c.lineWidth = 1.3;
  for (const a of [-2.5, -1.9, -1.2, -0.6]) { c.beginPath(); c.moveTo(x + s * 0.05, y - s * 0.8); c.quadraticCurveTo(x + Math.cos(a) * s * 0.4, y - s * 0.95 + Math.sin(a) * s * 0.3, x + Math.cos(a) * s * 0.7, y - s * 0.75 + Math.sin(a) * s * 0.1); c.stroke(); }
}
function acacia(c, x, y, s) {
  c.strokeStyle = INK; c.lineWidth = 0.9;
  c.beginPath(); c.moveTo(x, y + s * 0.3); c.lineTo(x, y - s * 0.4); c.stroke();
  c.fillStyle = '#8f9c5c'; c.beginPath(); c.ellipse(x, y - s * 0.55, s * 0.7, s * 0.2, 0, 0, Math.PI * 2); c.fill(); c.stroke();
}
function cactus(c, x, y, s) { c.strokeStyle = '#4f6d3a'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(x, y + s * 0.3); c.lineTo(x, y - s * 0.7); c.moveTo(x, y - s * 0.1); c.lineTo(x + s * 0.3, y - s * 0.1); c.lineTo(x + s * 0.3, y - s * 0.4); c.stroke(); }
function dune(c, x, y, s) { c.strokeStyle = 'rgba(140, 100, 50, 0.6)'; c.lineWidth = 0.9; c.beginPath(); c.arc(x, y + s * 0.6, s * 0.8, Math.PI * 1.2, Math.PI * 1.8); c.stroke(); c.fillStyle = 'rgba(140, 100, 50, 0.4)'; for (let k = 0; k < 3; k++) c.fillRect(x + (hash(x, k) - 0.5) * s * 1.6, y + (hash(k, y) - 0.5) * s, 1, 1); }
function mesa(c, x, y, s) { c.fillStyle = '#d59a72'; c.strokeStyle = INK; c.lineWidth = 0.9; c.beginPath(); c.moveTo(x - s * 0.8, y); c.lineTo(x - s * 0.5, y - s * 0.6); c.lineTo(x + s * 0.5, y - s * 0.6); c.lineTo(x + s * 0.8, y); c.closePath(); c.fill(); c.stroke(); }
function crack(c, x, y, s) { c.strokeStyle = 'rgba(150, 140, 120, 0.6)'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(x - s * 0.6, y); c.lineTo(x - s * 0.1, y - s * 0.2); c.lineTo(x + s * 0.5, y + s * 0.1); c.moveTo(x - s * 0.1, y - s * 0.2); c.lineTo(x, y - s * 0.6); c.stroke(); }
function tuft(c, x, y, s, wet) {
  c.strokeStyle = wet ? 'rgba(60, 85, 60, 0.75)' : 'rgba(110, 100, 60, 0.6)'; c.lineWidth = 0.8;
  c.beginPath(); for (const a of [-0.5, 0, 0.5]) { c.moveTo(x, y); c.lineTo(x + a * s * 0.6, y - s * 0.55); } c.stroke();
  if (wet) { c.strokeStyle = 'rgba(70, 110, 140, 0.55)'; c.beginPath(); c.moveTo(x - s * 0.7, y + s * 0.25); c.lineTo(x + s * 0.7, y + s * 0.25); c.stroke(); }
}
function iceHatch(c, x, y, s) { c.strokeStyle = 'rgba(110, 150, 180, 0.5)'; c.lineWidth = 0.8; c.beginPath(); for (let k = -1; k <= 1; k++) { c.moveTo(x - s * 0.6, y + k * s * 0.35); c.lineTo(x + s * 0.6, y + k * s * 0.35 - s * 0.25); } c.stroke(); }

// Orte: Hütten, Stadt mit Turm, große Stadt mit Mauer, moderne Stadt mit Türmen
function town(c, s, rt) {
  const x = (s.cx + 0.5) * S, y = (s.cy + 0.5) * S, era = s.era || 0, pop = s.pop || 0;
  const big = pop >= 120 ? 3 : pop >= 40 ? 2 : 1;
  c.save();
  c.fillStyle = s.color || '#c85'; c.globalAlpha = 0.35;
  c.beginPath(); c.arc(x, y, 8 + big * 4, 0, Math.PI * 2); c.fill();
  c.globalAlpha = 1; c.strokeStyle = INK; c.fillStyle = '#f4ead2'; c.lineWidth = 1.1;
  const house = (hx, hy, w, hh) => { c.beginPath(); c.rect(hx - w / 2, hy - hh, w, hh); c.fill(); c.stroke(); c.beginPath(); c.moveTo(hx - w / 2 - 1, hy - hh); c.lineTo(hx, hy - hh - w * 0.6); c.lineTo(hx + w / 2 + 1, hy - hh); c.closePath(); c.fillStyle = '#b5583e'; c.fill(); c.stroke(); c.fillStyle = '#f4ead2'; };
  if (era >= 6 && big >= 2) {
    for (const [dx, hh] of [[-7, 14], [-2, 20], [4, 16], [9, 11]]) { c.beginPath(); c.rect(x + dx - 2.5, y - hh, 5, hh); c.fill(); c.stroke(); }
  } else if (big === 3) {
    c.beginPath(); c.arc(x, y - 2, 11, Math.PI, 0); c.stroke();
    house(x - 6, y + 2, 6, 6); house(x + 6, y + 2, 6, 6);
    c.beginPath(); c.rect(x - 2.5, y - 14, 5, 14); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(x - 3.5, y - 14); c.lineTo(x, y - 20); c.lineTo(x + 3.5, y - 14); c.closePath(); c.fillStyle = '#b5583e'; c.fill(); c.stroke();
  } else if (big === 2) { house(x - 5, y + 2, 6, 5); house(x + 4, y + 1, 7, 7); house(x - 1, y - 5, 5, 4); }
  else { house(x - 3, y + 2, 5, 4); house(x + 3, y + 1, 5, 4); }
  c.restore();
}

function label(c, text, x, y, size, color, italic, spacing) {
  c.save();
  c.font = `${italic ? 'italic ' : ''}${Math.round(size)}px ${FONT}`;
  if (spacing) c.letterSpacing = `${spacing}em`;
  c.lineWidth = Math.max(3, size * 0.28); c.strokeStyle = 'rgba(242, 231, 204, 0.85)'; c.lineJoin = 'round';
  c.strokeText(text, x, y);
  c.fillStyle = color; c.fillText(text, x, y);
  c.restore();
}

// Rhumblinien wie auf alten Seekarten, sehr blass
function rhumb(c) {
  c.save();
  c.strokeStyle = 'rgba(120, 80, 50, 0.1)'; c.lineWidth = 1;
  const cx = W * 0.5, cy = W * 0.5;
  c.beginPath();
  for (let k = 0; k < 32; k++) { const a = k / 32 * Math.PI * 2; c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * W, cy + Math.sin(a) * W); }
  c.stroke();
  c.restore();
}

// Seeungeheuer und ein Segler im unbekannten Meer
function monsters(c, st) {
  const T = st.tiles;
  const spots = [];
  for (let k = 0; k < 400 && spots.length < 4; k++) {
    const x = 10 + Math.floor(hash(k, 31) * (N - 20)), y = 10 + Math.floor(hash(k, 37) * (N - 20));
    let ok = true;
    for (let dy = -7; dy <= 7 && ok; dy += 2) for (let dx = -10; dx <= 10; dx += 2) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue; const i = yy * N + xx; if (T.h[i] >= 0 || T.seen[i] > 60) { ok = false; break; } }
    if (ok && !spots.some(([a, b]) => Math.hypot(a - x, b - y) < 50)) spots.push([x, y]);
  }
  spots.forEach(([x, y], n) => (n % 2 ? sailShip : serpent)(c, x * S, y * S, S * 6, hash(n, 9) < 0.5));
}

function serpent(c, x, y, s, flip) {
  c.save(); c.translate(x, y); if (flip) c.scale(-1, 1);
  c.strokeStyle = 'rgba(70, 55, 40, 0.75)'; c.fillStyle = 'rgba(120, 140, 120, 0.55)'; c.lineWidth = 1.4;
  for (let k = 0; k < 3; k++) { const hx = -s * 1.2 + k * s * 0.8; c.beginPath(); c.arc(hx, 0, s * 0.35, Math.PI, 0); c.fill(); c.stroke(); }
  c.beginPath(); c.moveTo(s * 1.05, 0); c.quadraticCurveTo(s * 1.15, -s * 0.9, s * 1.55, -s * 0.75); c.quadraticCurveTo(s * 1.7, -s * 0.6, s * 1.45, -s * 0.55); c.quadraticCurveTo(s * 1.3, -s * 0.4, s * 1.35, 0); c.fill(); c.stroke();
  c.fillStyle = INK; c.beginPath(); c.arc(s * 1.48, -s * 0.68, 1.5, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(90, 120, 140, 0.5)'; c.beginPath(); c.moveTo(-s * 1.8, s * 0.1); c.lineTo(s * 1.8, s * 0.1); c.stroke();
  c.restore();
}
function sailShip(c, x, y, s) { shipGlyph(c, x, y, s, false); }
function shipGlyph(c, x, y, s, flip) {
  c.save(); c.translate(x, y); if (flip) c.scale(-1, 1);
  c.strokeStyle = INK; c.lineWidth = Math.max(0.8, s * 0.08); c.fillStyle = '#8a6040';
  c.beginPath(); c.moveTo(-s * 0.7, 0); c.lineTo(s * 0.7, 0); c.lineTo(s * 0.45, s * 0.3); c.lineTo(-s * 0.5, s * 0.3); c.closePath(); c.fill(); c.stroke();
  c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -s * 0.95); c.stroke();
  c.fillStyle = '#f6efe0'; c.beginPath(); c.moveTo(s * 0.04, -s * 0.9); c.quadraticCurveTo(s * 0.55, -s * 0.5, s * 0.04, -s * 0.12); c.closePath(); c.fill(); c.stroke();
  c.restore();
}
function star(c, x, y, r) {
  c.save(); c.fillStyle = '#e2a93a'; c.strokeStyle = INK; c.lineWidth = 1;
  c.beginPath();
  for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  c.closePath(); c.fill(); c.stroke(); c.restore();
}

function vignette(c, w, h) {
  const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(60, 40, 20, 0)'); g.addColorStop(1, 'rgba(60, 40, 20, 0.35)');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(60, 40, 25, 0.65)'; c.lineWidth = 2; c.strokeRect(14, 14, w - 28, h - 28);
  c.lineWidth = 0.8; c.strokeRect(20, 20, w - 40, h - 40);
}

function compass(c, x, y, r, t) {
  c.save(); c.translate(x, y);
  c.strokeStyle = INK; c.lineWidth = 1;
  c.fillStyle = 'rgba(242, 231, 204, 0.9)'; c.beginPath(); c.arc(0, 0, r * 0.82, 0, Math.PI * 2); c.fill(); c.stroke();
  c.beginPath(); c.arc(0, 0, r * 0.72, 0, Math.PI * 2); c.stroke();
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4 - Math.PI / 2, long = k % 2 === 0, R = long ? r : r * 0.6;
    c.fillStyle = k % 2 ? '#c9b48c' : (k === 0 ? '#a83c28' : '#5a4632');
    c.beginPath(); c.moveTo(Math.cos(a) * R, Math.sin(a) * R); c.lineTo(Math.cos(a + 0.32) * r * 0.16, Math.sin(a + 0.32) * r * 0.16); c.lineTo(0, 0); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = k % 2 ? '#e8dcc0' : '#8a7458';
    c.beginPath(); c.moveTo(Math.cos(a) * R, Math.sin(a) * R); c.lineTo(Math.cos(a - 0.32) * r * 0.16, Math.sin(a - 0.32) * r * 0.16); c.lineTo(0, 0); c.closePath(); c.fill(); c.stroke();
  }
  c.font = `italic 15px ${FONT}`; c.fillStyle = INK; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(L('N', 'N'), 0, -r - 10); c.fillText(L('S', 'S'), 0, r + 10); c.fillText(L('O', 'E'), r + 11, 0); c.fillText(L('W', 'W'), -r - 11, 0);
  c.restore();
}

function injectCss() {
  if (document.getElementById('wmCss')) return;
  const st = document.createElement('style');
  st.id = 'wmCss';
  st.textContent = `
#worldMap { position: fixed; inset: 0; z-index: 60; display: none; background: #d9c9a3; cursor: grab; }
#worldMap.show { display: block; animation: wmIn .35s ease-out; }
@keyframes wmIn { from { opacity: 0; transform: scale(1.02); } to { opacity: 1; transform: none; } }
#worldMap canvas { position: absolute; inset: 0; }
#worldMap canvas:active { cursor: grabbing; }
#worldMap .wm-title { position: absolute; left: 50%; top: 28px; transform: translateX(-50%); text-align: center; pointer-events: none; padding: 8px 46px 10px;
  background: radial-gradient(ellipse at center, rgba(242, 231, 204, 0.95) 55%, rgba(242, 231, 204, 0) 72%);
  font-family: ${FONT}; color: #3d2c1e; text-shadow: 0 0 6px rgba(242, 231, 204, 0.95), 0 0 2px rgba(242, 231, 204, 1); }
#worldMap .wm-title b { display: block; font-size: 34px; font-weight: 400; letter-spacing: 0.06em; }
#worldMap .wm-title i { display: block; font-size: 17px; opacity: 0.8; }
#worldMap .wm-ui { position: absolute; right: 30px; top: 30px; display: flex; flex-direction: column; gap: 8px; }
#worldMap .wm-ui button { width: 40px; height: 40px; border-radius: 50%; border: 1.5px solid rgba(61, 44, 30, 0.7); background: rgba(242, 231, 204, 0.92);
  color: #3d2c1e; font: 20px ${FONT}; cursor: pointer; box-shadow: 0 2px 8px rgba(60, 40, 20, 0.25); }
#worldMap .wm-ui button:hover { background: #fff6e0; }
#worldMap .wm-hint { position: absolute; left: 50%; bottom: 26px; transform: translateX(-50%); font: italic 15px ${FONT}; color: rgba(61, 44, 30, 0.85);
  text-shadow: 0 0 6px rgba(242, 231, 204, 1); pointer-events: none; white-space: nowrap; }
#worldMap .wm-tip { position: fixed; padding: 6px 10px; background: rgba(246, 237, 214, 0.96); border: 1px solid rgba(61, 44, 30, 0.45); border-radius: 4px;
  font: 15px ${FONT}; color: #3d2c1e; pointer-events: none; opacity: 0; transition: opacity .15s; white-space: nowrap; box-shadow: 0 3px 10px rgba(60, 40, 20, 0.25); }
#worldMap .wm-tip b { font-weight: 400; font-style: italic; }
`;
  document.head.appendChild(st);
}

// Zeichen und Helfer auch für die Karte der Erde (earthmap.js)
export { S, INK, SEPIA, FONT, WASH, hash, sn, cap, mountain, hill, volcano, pine, blob, palm, acacia, cactus, dune, mesa, crack, tuft, iceHatch, town, star, shipGlyph };
