// Weiße Cartoon Hand als Mauszeiger (Vorlage von Nader, gemalt in Higgsfield, vier Posen).
// Zeigen: schwebt leicht und dreht sich um die Fingerspitze, der Klickpunkt bleibt genau.
// Bewegen: neigt sich in Bewegungsrichtung. Über Knöpfen: kurzes Wackeln. Drücken: Finger knickt, Hand staucht, federt zurück.
// Kamera ziehen: Faust. Kraft gewählt: offene, leuchtende Hand, Funken folgen ihr. Lange still: winkt.
// Touch Geräte bekommen keine Hand, nur den Tipp Ring unter dem Finger.

const SIZE = 58; // Anzeigehöhe der Zeigehand in px, alle Posen im selben Maßstab
const K = SIZE / 150;
const POSES = {
  point: { w: 138, h: 150, x: 17, y: 4 },
  press: { w: 130, h: 136, x: 4, y: 20 },
  open: { w: 156, h: 164, x: 83.9, y: 81.9 },
  fist: { w: 128, h: 140, x: 61.2, y: 70.8 },
};
const CLICKABLE = 'button, a, input, select, label, .card, .prayer, .prayer-more, .tk, .ce[onclick], .scard, .chip, .slabel, [data-click]';
const IDLE_WAVE = 9000; // ms ohne Bewegung, dann winkt die Hand

export function initHand(canvas) {
  const taps = document.createElement('div');
  taps.id = 'taps';
  document.body.append(taps);

  const tap = (x, y, gold) => {
    const t = document.createElement('div');
    t.className = 'tap' + (gold ? ' gold' : '');
    t.style.left = x + 'px'; t.style.top = y + 'px';
    t.innerHTML = '<b></b><b></b><i></i>' + Array.from({ length: 7 }, (_, i) => {
      const a = (i / 7) * Math.PI * 2 + Math.random() * 0.6, r = 16 + Math.random() * 16;
      return `<s style="--dx:${(Math.cos(a) * r).toFixed(1)}px;--dy:${(Math.sin(a) * r).toFixed(1)}px;--d:${(Math.random() * 0.08).toFixed(2)}s"></s>`;
    }).join('');
    taps.append(t);
    setTimeout(() => t.remove(), 950);
  };
  const spark = (x, y) => {
    const s = document.createElement('div');
    s.className = 'trail';
    s.style.left = x + (Math.random() - 0.5) * 18 + 'px'; s.style.top = y + (Math.random() - 0.5) * 18 + 'px';
    taps.append(s);
    setTimeout(() => s.remove(), 900);
  };

  if (!matchMedia('(pointer: fine)').matches) {
    document.addEventListener('pointerdown', e => tap(e.clientX, e.clientY, document.body.classList.contains('targeting')), true);
    return;
  }

  document.documentElement.classList.add('godhand');
  const hand = document.createElement('div');
  hand.id = 'hand';
  hand.innerHTML = '<i class="glow"></i><div class="lean"><div class="tapper"><div class="sway"></div></div></div>';
  const sway = hand.querySelector('.sway'), lean = hand.querySelector('.lean');
  for (const [name, p] of Object.entries(POSES)) {
    const el = document.createElement('img');
    el.src = `assets/glove_${name}.webp`; el.className = name; el.alt = ''; el.draggable = false;
    Object.assign(el.style, { width: p.w * K + 'px', height: p.h * K + 'px', left: -p.x * K + 'px', top: -p.y * K + 'px' });
    sway.append(el);
  }
  document.body.append(hand);

  let x = -100, y = -100, vx = 0, vy = 0, ang = 0, last = performance.now(), moved = performance.now();
  let downAt = 0, down = null, upTimer = 0, overEl = null, lastSpark = 0, waved = false;
  const one = (cls, ms) => { hand.classList.remove(cls); void hand.offsetWidth; hand.classList.add(cls); setTimeout(() => hand.classList.remove(cls), ms); };

  document.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const now = performance.now(), dt = Math.max(8, now - last);
    vx = vx * 0.6 + ((e.clientX - x) / dt) * 0.4;
    vy = vy * 0.6 + ((e.clientY - y) / dt) * 0.4;
    x = e.clientX; y = e.clientY; last = now; moved = now;
    if (waved) { waved = false; hand.classList.remove('wave'); }
    hand.classList.remove('away');
    const el = e.target instanceof Element ? e.target.closest(CLICKABLE) : null;
    const ready = !!el && !el.disabled;
    if (ready && el !== overEl) one('wiggle', 450);
    overEl = ready ? el : null;
    hand.classList.toggle('ready', ready);
    if (down && !hand.classList.contains('grab') && down.onCanvas && Math.hypot(x - down.x, y - down.y) > 6) hand.classList.add('grab');
    if (hand.classList.contains('charged') && now - lastSpark > 45 && Math.hypot(vx, vy) > 0.15) { lastSpark = now; spark(x, y); }
  }, { passive: true, capture: true });

  document.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse') return;
    x = e.clientX; y = e.clientY; moved = performance.now();
    const onCanvas = e.target === canvas;
    down = { x, y, onCanvas };
    downAt = performance.now();
    clearTimeout(upTimer);
    hand.classList.remove('bounce', 'wave');
    // Rechte oder mittlere Taste auf der Welt bewegt die Kamera: gleich die Faust
    if (onCanvas && e.button !== 0) { hand.classList.add('grab'); return; }
    hand.classList.add('press');
    tap(x, y, hand.classList.contains('charged'));
  }, true);

  const release = () => {
    if (!down && !hand.classList.contains('press') && !hand.classList.contains('grab')) return;
    const wait = Math.max(0, 110 - (performance.now() - downAt)); // auch ein kurzer Klick soll sichtbar drücken
    const pressed = hand.classList.contains('press') && !hand.classList.contains('grab');
    down = null;
    upTimer = setTimeout(() => { hand.classList.remove('press', 'grab'); if (pressed) one('bounce', 420); }, wait);
  };
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);
  window.addEventListener('blur', release);
  document.documentElement.addEventListener('mouseleave', () => hand.classList.add('away'));
  document.addEventListener('contextmenu', e => { if (e.target === canvas) e.preventDefault(); });

  // Kraft gewählt: offene, leuchtende Hand
  new MutationObserver(() => hand.classList.toggle('charged', document.body.classList.contains('targeting')))
    .observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // Neigung aus der Geschwindigkeit, weich nachfedernd; langes Stillhalten: winken
  const loop = now => {
    const idle = now - moved;
    if (idle > 40) { vx *= 0.86; vy *= 0.86; }
    const target = Math.max(-22, Math.min(22, vx * 9 + (hand.classList.contains('grab') ? vx * 6 : 0)));
    ang += (target - ang) * 0.18;
    const stretch = Math.min(0.08, Math.hypot(vx, vy) * 0.025);
    lean.style.transform = `rotate(${ang.toFixed(2)}deg) scale(${(1 + stretch).toFixed(3)}, ${(1 - stretch * 0.6).toFixed(3)})`;
    hand.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    if (!waved && idle > IDLE_WAVE && !down && !hand.classList.contains('away') && !hand.classList.contains('charged')) {
      waved = true;
      hand.classList.add('wave');
      setTimeout(() => hand.classList.remove('wave'), 1900);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
