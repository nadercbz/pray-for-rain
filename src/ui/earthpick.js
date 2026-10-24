// Neue Welt: Erde (seit 19.10.2026). Große gemalte Erdkarte zur Wahl des Startorts: Klick auf Land zeigt Gegend,
// Lebensraum und Klima, ungeeignete Orte (Meer, Eis, Hochgebirge ohne Platz, tiefe Wüste, Polargebiete) sind gesperrt.
// Vorschlag ist Asni im Hohen Atlas, die besten Startplätze aus den Erddaten stehen als kleine Marken auf der Karte.
// Die sieben anderen Völker werden erst nach der Wahl gesetzt (core.js createEarthWorld) und hier nicht verraten.
import { L } from '../i18n.js';
import { EARTH, startCheck, lonLat, lonLatText, kmPerTile, contName } from '../sim/earth.js';

const PAL = {
  mild: '#bcd07c', wald: '#8db565', taiga: '#6f9566', tundra: '#b9b48f', eis: '#f3f6f5', steppe: '#d8d090', sumpf: '#8ea46a',
  savanne: '#ddc87f', wueste: '#efd9a7', tropen: '#5f9f53', vulkan: '#7d7168', salz: '#f5f1e7', canyon: '#d4905f', oase: '#9ac36c', fjord: '#88a47b',
};
const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// Grundbild der Erde, ein Bildpunkt je Feld: Aquarellfarben je Lebensraum, Schummerung aus den echten Höhen,
// Meer nach Tiefe mit hellem Saum an der Küste, Tuschelinie an der Küste, Flüsse und Seen. Wird einmal gemalt.
let BASE = null;
export function paintEarth() {
  if (BASE) return BASE;
  const E = EARTH, W = E.W, H = E.H, n = W * H;
  const keys = E.meta.biomes, pal = keys.map(k => hex(PAL[k] || '#cccccc'));
  // Abstand zur Küste über dem Meer (bis 8 Felder) für den hellen Saum
  const dist = new Uint8Array(n).fill(255), q = [];
  for (let i = 0; i < n; i++) if (E.h[i] >= 0) { dist[i] = 0; q.push(i); }
  for (let k = 0; k < q.length; k++) {
    const i = q[k], d = dist[i]; if (d >= 8) continue;
    const x = i % W, y = (i / W) | 0;
    for (const j of [y * W + (x + 1) % W, y * W + (x + W - 1) % W, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && dist[j] > d + 1) { dist[j] = d + 1; q.push(j); }
  }
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const cx = cv.getContext('2d'), img = cx.createImageData(W, H), px = img.data;
  const deep = hex('#3f8494'), shallow = hex('#8ccac0'), lake = hex('#79bcc6'), riv = hex('#4d8db0'), ink = [70, 86, 78];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, l = E.h[i], o = i * 4;
    let c;
    const g = 0.97 + hash(x, y) * 0.06;
    if (l < 0) {
      if (E.lake[i]) c = lake;
      else {
        const t = Math.min(1, dist[i] / 8), s = l === -1 ? 0.25 : 0;
        const k = Math.min(1, t * 0.85 + 0.15 - s);
        c = [shallow[0] + (deep[0] - shallow[0]) * k, shallow[1] + (deep[1] - shallow[1]) * k, shallow[2] + (deep[2] - shallow[2]) * k];
      }
      px[o] = c[0] * g; px[o + 1] = c[1] * g; px[o + 2] = c[2] * g; px[o + 3] = 255;
      continue;
    }
    c = pal[E.bio[i]];
    const m = Math.max(0, E.elev[i]);
    // Schummerung, Licht von Nordwesten
    const a = E.elev[Math.max(0, y - 1) * W + (x + W - 1) % W], b = E.elev[Math.min(H - 1, y + 1) * W + (x + 1) % W];
    let sh = 1 + Math.max(-0.28, Math.min(0.28, (Math.max(0, a) - Math.max(0, b)) / 1400));
    const hi = Math.min(1, Math.max(0, (m - 1800) / 2600)) * 0.45; // hohe Lagen heller und kühler
    let r = c[0] * sh * (1 - hi) + 236 * hi, gg = c[1] * sh * (1 - hi) + 234 * hi, bb = c[2] * sh * (1 - hi) + 230 * hi;
    if (E.river[i] && E.river[i] >= 2) { const k = Math.min(0.85, 0.3 + E.river[i] * 0.09); r += (riv[0] - r) * k; gg += (riv[1] - gg) * k; bb += (riv[2] - bb) * k; }
    // Tuschelinie an der Küste
    let coast = false;
    for (const j of [y * W + (x + 1) % W, y * W + (x + W - 1) % W, y > 0 ? i - W : i, y < H - 1 ? i + W : i]) if (E.h[j] < 0 && !E.lake[j]) coast = true;
    if (coast) { r = r * 0.55 + ink[0] * 0.45; gg = gg * 0.55 + ink[1] * 0.45; bb = bb * 0.55 + ink[2] * 0.45; }
    void sh;
    px[o] = r * g; px[o + 1] = gg * g; px[o + 2] = bb * g; px[o + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  // Beschriftung vorbereiten: Kontinente (Schwerpunkt), große Gegenden, Meere
  const cs = new Map();
  for (let i = 0; i < n; i += 7) { const c = E.cont[i]; if (!c) continue; let a = cs.get(c); if (!a) cs.set(c, a = [0, 0, 0]); a[0] += i % W; a[1] += (i / W) | 0; a[2]++; }
  const labels = [];
  for (const c of E.meta.continents) { const a = cs.get(c.id); if (a && a[2] > 50) labels.push({ x: a[0] / a[2], y: a[1] / a[2], t: L(c.de, c.en), k: 'cont', r: 0 }); }
  for (const s of E.meta.seas) if (s.rank <= 3 && (s.cla === 'ocean' || s.cla === 'sea')) labels.push({ x: s.x, y: s.y, t: L(s.de, s.en), k: 'sea', r: s.rank });
  const rs = new Map();
  for (let i = 0; i < n; i += 3) { const g = E.reg[i]; if (!g) continue; let a = rs.get(g); if (!a) rs.set(g, a = [0, 0, 0]); a[0] += i % W; a[1] += (i / W) | 0; a[2]++; }
  for (const g of E.meta.regions) { const a = rs.get(g.id); if (a && a[2] > 25 && g.rank <= 4) labels.push({ x: a[0] / a[2], y: a[1] / a[2], t: L(g.de, g.en), k: 'reg', r: g.rank, n: a[2] * 3 }); }
  return (BASE = { canvas: cv, labels });
}

export function openEarthPicker({ onPick, onCancel }) {
  const E = EARTH, W = E.W, H = E.H;
  const base = paintEarth();
  let box = document.getElementById('earthPick');
  if (!box) { box = document.createElement('div'); box.id = 'earthPick'; document.body.append(box); }
  box.innerHTML = `<canvas></canvas>
    <div class="ep-head"><span class="kicker">${L('Neue Welt: Erde', 'New World: Earth')}</span><h2>${L('Wo beginnt dein Volk?', 'Where do your people begin?')}</h2>
      <p>${L('Wähle einen Ort auf der Erde. Dort entsteht die erste Siedlung, dort lebt der Mensch, dessen Leben du wählst. Sieben andere Völker wachsen irgendwo auf den anderen Kontinenten, ohne von euch zu wissen.', 'Choose a place on Earth. The first settlement rises there, and there lives the person whose life you choose. Seven other peoples grow somewhere on the other continents, knowing nothing of you.')}</p><small>${L('Ziehen verschiebt, Mausrad zoomt, Klick wählt', 'Drag to pan, wheel to zoom, click to choose')}</small></div>
    <div class="ep-info"><div class="ep-place"></div><div class="ep-lines"></div><div class="ep-btns"><button class="ep-go" disabled>${L('Hier beginnen', 'Begin here')}</button><button class="ep-asni">${L('Vorschlag: Asni', 'Suggestion: Asni')}</button></div></div>
    <div class="ep-scale"><i></i><span></span></div>
    <button class="ep-back">${L('Zurück', 'Back')}</button>
`;
  const cv = box.querySelector('canvas'), g = cv.getContext('2d');
  const info = box.querySelector('.ep-info'), place = info.querySelector('.ep-place'), lines = info.querySelector('.ep-lines'), go = info.querySelector('.ep-go');
  const asni = { x: E.meta.start.x, y: E.meta.start.y, name: L(E.meta.start.de, E.meta.start.en) };
  const prime = E.meta.startSpots.slice();
  let dpr = 1, vw = 0, vh = 0;
  // Ansicht: Mittelpunkt in Feldern und Bildpunkte je Feld
  const view = { x: asni.x + 60, y: asni.y - 10, s: 1 };
  let sel = null, hover = null, closed = false, raf = 0, t0 = performance.now();
  const fit = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    vw = window.innerWidth; vh = window.innerHeight;
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
    cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
    if (!view.init) { view.s = Math.max(vw / 1050, vh / 620); view.init = 1; }
    clampView();
  };
  const onResize = () => { fit(); redraw(); };
  const minS = () => Math.max(vw / W, vh / H);
  const clampView = () => {
    view.s = Math.max(minS(), Math.min(9, view.s));
    const hw = vw / 2 / view.s, hh = vh / 2 / view.s;
    view.x = Math.max(hw, Math.min(W - hw, view.x)); view.y = Math.max(hh, Math.min(H - hh, view.y));
  };
  const toScreen = (x, y) => [(x - view.x) * view.s + vw / 2, (y - view.y) * view.s + vh / 2];
  const toTile = (sx, sy) => [Math.floor((sx - vw / 2) / view.s + view.x), Math.floor((sy - vh / 2) / view.s + view.y)];

  const draw = () => {
    raf = 0;
    if (closed) return;
    const t = (performance.now() - t0) / 1000;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#2f6f7e'; g.fillRect(0, 0, vw, vh);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    const [ox, oy] = toScreen(0, 0);
    g.drawImage(base.canvas, ox, oy, W * view.s, H * view.s);
    // zartes Gradnetz alle 15 Grad
    g.strokeStyle = 'rgba(255,250,235,0.16)'; g.lineWidth = 1;
    g.beginPath();
    for (let la = -75; la <= 75; la += 15) { const y = (90 - la) / 180 * H, [, sy] = toScreen(0, y); g.moveTo(0, sy); g.lineTo(vw, sy); }
    for (let lo = -180; lo < 180; lo += 15) { const x = (((lo - E.meta.lon0) % 360) + 360) % 360 / 360 * W, [sx] = toScreen(x, 0); g.moveTo(sx, 0); g.lineTo(sx, vh); }
    g.stroke();
    // Namen: Kontinente groß, Meere kursiv, Gegenden je nach Zoom
    const placed = [];
    const tryLabel = (lb, font, color, alpha) => {
      const [sx, sy] = toScreen(lb.x, lb.y);
      if (sx < -200 || sy < -40 || sx > vw + 200 || sy > vh + 40) return;
      g.font = font;
      const w = g.measureText(lb.t).width, box2 = [sx - w / 2 - 4, sy - 10, sx + w / 2 + 4, sy + 10];
      if (placed.some(b => b[0] < box2[2] && b[2] > box2[0] && b[1] < box2[3] && b[3] > box2[1])) return;
      placed.push(box2);
      g.globalAlpha = alpha; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 3; g.strokeStyle = 'rgba(250,244,230,0.55)'; g.strokeText(lb.t, sx, sy);
      g.fillText(lb.t, sx, sy); g.globalAlpha = 1;
    };
    const z = view.s;
    for (const lb of base.labels) if (lb.k === 'cont' && z < 2.2) tryLabel(lb, `600 ${Math.round(15 + z * 4)}px Fraunces, Georgia, serif`, '#3b3020', 0.62);
    for (const lb of base.labels) if (lb.k === 'sea' && lb.r <= (z < 1.4 ? 0 : z < 2.5 ? 1 : 3)) tryLabel(lb, `italic 400 ${lb.r ? 12 : 14}px Fraunces, Georgia, serif`, '#e9f4f1', 0.85);
    const maxR = z < 1.2 ? 0 : z < 1.8 ? 1 : z < 3 ? 2 : z < 5 ? 3 : 4;
    for (const lb of base.labels.filter(o => o.k === 'reg' && o.r <= maxR).sort((a, b) => a.r - b.r || b.n - a.n)) tryLabel(lb, `italic 400 ${lb.r <= 1 ? 12.5 : 11.5}px Fraunces, Georgia, serif`, '#4a3d2a', 0.78);
    // Startplätze aus den Erddaten als kleine Marken
    for (const sp of prime) {
      const [sx, sy] = toScreen(sp.x + 0.5, sp.y + 0.5);
      g.beginPath(); g.arc(sx, sy, 3.2, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,248,232,0.92)'; g.fill(); g.lineWidth = 1.4; g.strokeStyle = 'rgba(60,50,35,0.7)'; g.stroke();
    }
    // Vorschlag Asni: goldener Stern
    {
      const [sx, sy] = toScreen(asni.x + 0.5, asni.y + 0.5), R = 9 + Math.sin(t * 2.2) * 1.2;
      g.beginPath();
      for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? R * 0.45 : R; g.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r); }
      g.closePath(); g.fillStyle = '#ffd98a'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#7a5418'; g.stroke();
      g.font = 'italic 600 13px Fraunces, Georgia, serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.lineWidth = 3; g.strokeStyle = 'rgba(30,22,10,0.55)'; g.strokeText(asni.name, sx + 13, sy); g.fillStyle = '#ffe7b0'; g.fillText(asni.name, sx + 13, sy);
    }
    // Auswahl und Mauszeiger
    for (const [p, main] of [[hover, false], [sel, true]]) {
      if (!p) continue;
      const [sx, sy] = toScreen(p.x + 0.5, p.y + 0.5);
      const ok = p.c.ok;
      g.beginPath(); g.arc(sx, sy, main ? 11 + Math.sin(t * 3) * 2 : 8, 0, Math.PI * 2);
      g.lineWidth = main ? 3 : 2; g.strokeStyle = ok ? (main ? '#ffd98a' : 'rgba(255,250,235,0.9)') : 'rgba(224,90,70,0.95)'; g.stroke();
      if (ok && p.c.moved) { const [tx, ty] = toScreen(p.c.x + 0.5, p.c.y + 0.5); g.beginPath(); g.arc(tx, ty, 4, 0, Math.PI * 2); g.fillStyle = main ? '#ffd98a' : 'rgba(255,250,235,0.85)'; g.fill(); }
    }
    // Maßstab in km (waagrecht in der Breite der Bildmitte)
    const lat = lonLat(0, Math.round(view.y))[1], kmPx = kmPerTile() * Math.max(0.05, Math.cos(lat * Math.PI / 180)) / view.s;
    const nice = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000], target = 140 * kmPx;
    const km = nice.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a), nice[0]);
    box.querySelector('.ep-scale i').style.width = (km / kmPx).toFixed(0) + 'px';
    box.querySelector('.ep-scale span').textContent = km.toLocaleString() + ' km';
    if (!raf) raf = requestAnimationFrame(draw); // Stern und Auswahl pulsieren
  };
  // sofort zeichnen (auch wenn der Tab im Hintergrund keine Bilder bekommt), danach weiter im Bildtakt
  const redraw = () => { if (raf) cancelAnimationFrame(raf); raf = 0; draw(); };

  const describe = (p, chosen) => {
    const c = p.c;
    const where = lonLatText(p.x, p.y);
    if (!c.ok) {
      place.textContent = L('Nicht geeignet', 'Not suitable');
      lines.innerHTML = `<p class="bad">${c.why}</p><p class="dim">${where}</p>`;
      if (chosen) go.disabled = true;
      return;
    }
    const isAsni = Math.abs(p.x - asni.x) <= 1 && Math.abs(p.y - asni.y) <= 1;
    place.textContent = isAsni ? asni.name : c.region || contName(c.cont) || L('Namenloses Land', 'Nameless land');
    lines.innerHTML = `<p><b>${c.bioName}</b>${isAsni && c.region ? ' · ' + c.region : ''}${c.region ? ' · ' + contName(c.cont) : ''}</p><p>${c.climate}</p>`
      + (c.hard ? `<p class="warn">${L('Ein harter Ort. Die Menschen werden kämpfen müssen.', 'A harsh place. The people will have to struggle.')}</p>` : '')
      + (c.moved ? `<p class="dim">${L('Die Siedlung entsteht am nächsten guten Platz, ', 'The settlement rises at the nearest good spot, ')}${Math.round(Math.hypot(c.x - p.x, c.y - p.y) * kmPerTile())} km ${L('entfernt', 'away')}.</p>` : '')
      + `<p class="dim">${lonLatText(c.x, c.y)}</p>`;
    if (chosen) go.disabled = false;
  };
  const choose = (x, y) => {
    x = ((x % W) + W) % W; y = Math.max(0, Math.min(H - 1, y));
    sel = { x, y, c: startCheck(x, y) };
    info.classList.add('show');
    describe(sel, true);
    redraw();
  };

  // Eingabe: ziehen, zoomen, klicken, Tasten, Finger
  const ptr = new Map();
  let drag = null, pinch = null;
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    ptr.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptr.size === 1) drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: 0 };
    if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: view.s }; drag = null; }
  });
  cv.addEventListener('pointermove', e => {
    if (ptr.has(e.pointerId)) ptr.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && ptr.size === 2) {
      const [a, b] = [...ptr.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      view.s = pinch.s * d / Math.max(10, pinch.d); clampView(); redraw(); return;
    }
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
      if (drag.moved > 5) { view.x = drag.vx - dx / view.s; view.y = drag.vy - dy / view.s; clampView(); cv.style.cursor = 'grabbing'; }
    }
    if (e.pointerType === 'mouse') {
      const [x, y] = toTile(e.clientX, e.clientY);
      if (y >= 0 && y < H) { hover = { x: ((x % W) + W) % W, y, c: startCheck(x, y) }; if (!sel) { info.classList.add('show'); describe(hover, false); } }
    }
    redraw();
  });
  const up = e => {
    ptr.delete(e.pointerId);
    if (ptr.size < 2) pinch = null;
    if (drag && drag.moved <= 5 && e.type === 'pointerup') {
      const [x, y] = toTile(e.clientX, e.clientY);
      // Klick auf den Stern wählt Asni genau
      const [ax, ay] = toScreen(asni.x + 0.5, asni.y + 0.5);
      if (Math.hypot(e.clientX - ax, e.clientY - ay) < 12) choose(asni.x, asni.y); else choose(x, y);
    }
    drag = null; cv.style.cursor = '';
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', () => { hover = null; if (!sel) intro(); redraw(); });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const [bx, by] = [(e.clientX - vw / 2) / view.s + view.x, (e.clientY - vh / 2) / view.s + view.y];
    view.s *= Math.exp(-e.deltaY * 0.0016);
    clampView();
    view.x = bx - (e.clientX - vw / 2) / view.s; view.y = by - (e.clientY - vh / 2) / view.s;
    clampView(); redraw();
  }, { passive: false });
  const key = e => {
    if (closed) return;
    const k = e.key, step = 60 / view.s;
    if (k === 'ArrowLeft' || k === 'a') view.x -= step; else if (k === 'ArrowRight' || k === 'd') view.x += step;
    else if (k === 'ArrowUp' || k === 'w') view.y -= step; else if (k === 'ArrowDown' || k === 's') view.y += step;
    else if (k === '+' || k === '=') view.s *= 1.25; else if (k === '-') view.s /= 1.25;
    else if (k === 'Enter' && sel && sel.c.ok) { e.preventDefault(); finish(); return; }
    else if (k === 'Escape') { e.preventDefault(); cancel(); return; }
    else return;
    e.preventDefault(); e.stopImmediatePropagation(); clampView(); redraw();
  };
  window.addEventListener('keydown', key, true);
  window.addEventListener('resize', onResize);
  const close = () => {
    closed = true;
    window.removeEventListener('keydown', key, true);
    window.removeEventListener('resize', onResize);
    box.classList.remove('show');
    setTimeout(() => { box.innerHTML = ''; }, 600);
  };
  const finish = () => { if (!sel || !sel.c.ok) return; const c = sel.c; close(); onPick && onPick(c.x, c.y, c); };
  const cancel = () => { close(); onCancel && onCancel(); };
  go.onclick = finish;
  box.querySelector('.ep-asni').onclick = () => { view.x = asni.x; view.y = asni.y; view.s = Math.max(view.s, 3.2); clampView(); choose(asni.x, asni.y); };
  box.querySelector('.ep-back').onclick = cancel;
  // Am Anfang: Hinweis und der Vorschlag Asni gleich sichtbar
  const intro = () => {
    place.textContent = L('Wähle einen Ort', 'Choose a place');
    lines.innerHTML = `<p>${L('Klicke auf Land. Der goldene Stern ist ein Vorschlag: Asni im Hohen Atlas, ein Tal am Fuß des Toubkal.', 'Click on land. The golden star is a suggestion: Asni in the High Atlas, a valley at the foot of Toubkal.')}</p><p class="dim">${L('Weiße Punkte: gute Plätze an Flüssen und Küsten.', 'White dots: good places by rivers and coasts.')}</p>`;
    go.disabled = true;
  };
  intro();
  info.classList.add('show');
  fit();
  requestAnimationFrame(() => box.classList.add('show'));
  setTimeout(() => box.classList.add('show'), 50);
  redraw();
  return { close, choose };
}
