// Trailer beim allerersten Start (und auf Wunsch aus dem Menü): Vollbild Video mit Ton, jederzeit überspringbar.
// Erlaubt der Browser keinen automatischen Start mit Ton, erscheint ein großer Abspielknopf.
// Die Erzählstimme ist Englisch, bei Sprache Deutsch laufen deutsche Untertitel mit (assets/trailer/subs.json aus trailer_mix.py).
import { L, LANG } from '../i18n.js';

const KEY = 'pfr.trailerSeen';
const SRC = 'assets/trailer/trailer.mp4';

export function trailerSeen() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return true; }
}

export function playTrailer({ onEnd } = {}) {
  if (document.getElementById('trailer')) return;
  const box = document.createElement('div');
  box.id = 'trailer';
  box.innerHTML = `
    <video src="${SRC}" poster="assets/trailer/poster.webp" playsinline preload="auto"></video>
    <div class="tr-start"><button class="tr-play"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>${L('Einführung ansehen', 'Watch the introduction')}</button></div>
    <button class="tr-skip">${L('Überspringen', 'Skip')}<kbd>Esc</kbd></button>
    <div class="tr-sub"></div>
    <div class="tr-bar"><i></i></div>`;
  document.body.append(box);
  const v = box.querySelector('video'), bar = box.querySelector('.tr-bar i');
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    try { localStorage.setItem(KEY, '1'); } catch { /* egal */ }
    box.classList.add('out');
    v.pause();
    window.removeEventListener('keydown', key, true);
    setTimeout(() => { box.remove(); if (onEnd) onEnd(); }, 900);
  };
  const start = () => { box.classList.remove('wait'); v.muted = false; v.play().catch(() => box.classList.add('wait')); };
  const key = e => { if (e.key === 'Escape' || (e.key === ' ' && !box.classList.contains('wait'))) { e.preventDefault(); e.stopPropagation(); finish(); } };
  window.addEventListener('keydown', key, true);
  box.querySelector('.tr-skip').onclick = finish;
  box.querySelector('.tr-play').onclick = start;
  v.addEventListener('ended', finish);
  v.addEventListener('error', finish);
  const subEl = box.querySelector('.tr-sub');
  let subs = [];
  if (LANG === 'de') fetch('assets/trailer/subs.json').then(r => r.json()).then(x => { subs = x; }).catch(() => {});
  v.addEventListener('timeupdate', () => {
    if (v.duration) bar.style.width = (v.currentTime / v.duration * 100).toFixed(2) + '%';
    const cur = subs.find(x => v.currentTime >= x.t0 && v.currentTime < x.t1);
    const txt = cur ? cur.de : '';
    if (subEl.textContent !== txt) subEl.textContent = txt;
    subEl.classList.toggle('on', !!txt);
  });
  v.addEventListener('click', () => { if (v.paused) start(); else v.pause(); });
  // Mit Ton versuchen, sonst auf den Klick warten
  v.play().then(() => box.classList.add('on')).catch(() => box.classList.add('on', 'wait'));
}
