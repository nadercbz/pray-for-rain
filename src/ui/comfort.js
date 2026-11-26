// Komfort (seit 26.11.2026, PLAN_QUALITAET.md Runde 7 und 8): Pause, Lautstärke, Größe der Oberfläche, weniger Bewegung,
// hoher Kontrast, Bestätigung für teure Kräfte, Beschriftungen für Vorleser. Alles hier, damit main.js und ui.js klein
// bleiben. Einstellungen im Browser: pfr.vol, pfr.volVoice, pfr.uiScale, pfr.calm, pfr.contrast.
import { L } from '../i18n.js';

const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const put = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* egal */ } };
export const voiceVol = () => Math.max(0, Math.min(1, +get('pfr.volVoice', '1')));

export function initComfort(app) {
  const C = {
    vol: Math.max(0, Math.min(1, +get('pfr.vol', '0.8'))),
    scale: +get('pfr.uiScale', '1') || 1,
    calm: get('pfr.calm', matchMedia('(prefers-reduced-motion: reduce)').matches ? '1' : '0') === '1',
    contrast: get('pfr.contrast', '0') === '1',
    setVol(v) { C.vol = Math.max(0, Math.min(1, v)); put('pfr.vol', C.vol); app.sound.setVol && app.sound.setVol(C.vol); },
    setVoice(v) { put('pfr.volVoice', Math.max(0, Math.min(1, v))); },
    setScale(v) { C.scale = v; put('pfr.uiScale', v); document.documentElement.style.setProperty('--ui', v); },
    setCalm(v) { C.calm = !!v; put('pfr.calm', v ? 1 : 0); document.body.classList.toggle('calm', C.calm); app.calm = C.calm; },
    setContrast(v) { C.contrast = !!v; put('pfr.contrast', v ? 1 : 0); document.body.classList.toggle('contrast', C.contrast); },
  };
  app.comfort = C;
  document.documentElement.style.setProperty('--ui', C.scale);
  document.body.classList.toggle('calm', C.calm); app.calm = C.calm;
  document.body.classList.toggle('contrast', C.contrast);
  app.sound.setVol && app.sound.setVol(C.vol);

  // ---------- Pause ----------
  const pill = document.createElement('button');
  pill.id = 'pausePill';
  pill.innerHTML = `<b>${L('Pause', 'Paused')}</b><small>${L('Leertaste oder hier tippen', 'Space or tap here')}</small>`;
  pill.onclick = () => app.setPaused(false);
  document.body.append(pill);
  app.paused = false;
  app.setPaused = v => {
    if (app.coopGuest) return;
    app.paused = !!v;
    document.body.classList.toggle('paused', app.paused);
    const b = document.getElementById('btnPause'); if (b) { b.classList.toggle('on', app.paused); b.setAttribute('aria-pressed', app.paused ? 'true' : 'false'); }
  };
  // Knopf in der Tempoleiste
  const speed = document.getElementById('speed');
  if (speed && !document.getElementById('btnPause')) {
    const b = document.createElement('button');
    b.id = 'btnPause'; b.title = L('Pause (Leertaste)', 'Pause (Space)'); b.setAttribute('aria-label', b.title);
    b.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M8 5v14 M16 5v14" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/></svg>';
    b.onclick = e => { e.stopPropagation(); app.setPaused(!app.paused); };
    speed.insertBefore(b, speed.firstChild);
  }
  const busy = () => document.body.classList.contains('ghost-mode') || app.flying || app.driving || app.mapOpen || app.collectionOpen || (app.editor && app.editor.active) || document.querySelector('#modal.show, #trailer, #heroPick.show, #heroIntro.show, #storyAsk, #intro:not(.gone)');
  window.addEventListener('keydown', e => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if ((e.key === ' ' || e.code === 'Space') && !e.repeat && !busy() && app.running) { e.preventDefault(); app.setPaused(!app.paused); }
    else if (e.key === '?' && !busy() && app.ui) app.ui.help();
  });

  // ---------- leiser Klick für Knöpfe (ui/sfx.js) ----------
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('button, .card, .dtab, .prayer'); if (b && app.sound && app.sound.click && !b.classList.contains('card')) app.sound.click(); }, true);

  // ---------- Beschriftungen für Vorleser: jeder Knopf mit title bekommt denselben Text als aria-label ----------
  const label = root => { for (const b of root.querySelectorAll('button[title]:not([aria-label])')) b.setAttribute('aria-label', b.title); };
  label(document);
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) label(n); }).observe(document.body, { childList: true, subtree: true });
  // Meldungen werden vorgelesen
  const toast = document.getElementById('toasts') || document.getElementById('toast');
  if (toast) { toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); }
  return C;
}

// Teure Kraft, die sofort auf die ganze Welt wirkt: erst beim zweiten Tippen innerhalb von 4 Sekunden auslösen.
// Gibt true zurück, wenn gewirkt werden darf.
let armed = null;
export function confirmCast(app, id, P) {
  if (P.cost < 30) return true;
  const now = performance.now();
  if (armed && armed.id === id && now - armed.t < 4000) { armed = null; return true; }
  armed = { id, t: now };
  app.ui && app.ui.toast(L(`${P.name} kostet ${P.cost} Kraft und trifft die ganze Welt. Tippe die Karte noch einmal, um sie zu wirken.`, `${P.name} costs ${P.cost} power and affects the whole world. Tap the card again to cast it.`), 'warn');
  return false;
}

// Zeilen für das Einstellungsmenü (ui.js menu) und ihre Verdrahtung
export function comfortRows(app) {
  const C = app.comfort; if (!C) return '';
  const seg = (id, opts, cur) => `<div class="seg" id="${id}">${opts.map(([v, t]) => `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  return `
    <label for="optVol">${L('Lautstärke', 'Volume')}</label><div class="rng"><input type="range" id="optVol" min="0" max="100" step="5" value="${Math.round(C.vol * 100)}"><output>${Math.round(C.vol * 100)}</output></div>
    <label for="optVoiceVol">${L('Lautstärke der Stimme', 'Voice volume')}</label><div class="rng"><input type="range" id="optVoiceVol" min="0" max="100" step="5" value="${Math.round(voiceVol() * 100)}"><output>${Math.round(voiceVol() * 100)}</output></div>
    <label>${L('Größe der Oberfläche', 'Interface size')}</label>${seg('optScale', [[0.9, L('klein', 'small')], [1, L('normal', 'normal')], [1.15, L('groß', 'large')], [1.3, L('sehr groß', 'very large')]], C.scale)}
    <label>${L('Weniger Bewegung', 'Reduce motion')}</label>${seg('optCalm', [[1, L('an', 'on')], [0, L('aus', 'off')]], C.calm ? 1 : 0)}
    <label>${L('Hoher Kontrast', 'High contrast')}</label>${seg('optContrast', [[1, L('an', 'on')], [0, L('aus', 'off')]], C.contrast ? 1 : 0)}
    <label>${L('Welten', 'Worlds')}</label><div class="seg"><button id="optScen">${L('Szenarien', 'Scenarios')}</button><button id="optBackups">${L('Sicherungen', 'Backups')}</button><button id="optShare">${L('Startwelt teilen', 'Share start world')}</button></div>
    <label>${L('Kräfte', 'Powers')}</label>${seg('optUnlock', [[0, L('nach und nach', 'step by step')], [1, L('alle sofort', 'all at once')]], get('pfr.unlockAll', '0') === '1' ? 1 : 0)}
    <label>${L('Der Schatten (Rivale)', 'The Shadow (rival)')}</label>${seg('optRival', [[1, L('an', 'on')], [0, L('aus', 'off')]], get('pfr.rival', '1') === '1' ? 1 : 0)}
    <label>${L('Naturereignisse mit Vorzeichen', 'Natural events with omens')}</label>${seg('optNatur', [[1, L('an', 'on')], [0, L('aus', 'off')]], get('pfr.naturOn', '1') === '1' ? 1 : 0)}
    <label>${L('Tipps', 'Tips')}</label>${seg('optTips', [[1, L('an', 'on')], [0, L('aus', 'off')]], get('pfr.tipsOff', '0') === '1' ? 0 : 1)}
    <label>${L('Tasten und Gamepad', 'Keys and gamepad')}</label><div class="seg"><button id="optKeys">${L('Tasten belegen', 'Key bindings')}</button></div>
    <label>${L('Ziele anzeigen', 'Show goals')}</label>${seg('optGoals', [[1, L('an', 'on')], [0, L('aus', 'off')]], app.goals && app.goals.isOff() ? 0 : 1)}`;
}
export function comfortWire(app) {
  const C = app.comfort; if (!C) return;
  const $ = s => document.querySelector(s);
  const rng = (id, fn) => { const el = $(id); if (el) el.oninput = () => { el.nextElementSibling.textContent = el.value; fn(el.value / 100); }; };
  rng('#optVol', v => { C.setVol(v); app.sound.start && app.sound.start(); });
  rng('#optVoiceVol', v => C.setVoice(v));
  const seg = (id, fn) => document.querySelectorAll(id + ' button').forEach(b => { b.onclick = () => { fn(+b.dataset.v); document.querySelectorAll(id + ' button').forEach(x => x.classList.toggle('on', x === b)); }; });
  seg('#optScale', v => C.setScale(v));
  seg('#optCalm', v => C.setCalm(v === 1));
  seg('#optContrast', v => C.setContrast(v === 1));
  seg('#optGoals', v => app.goals && app.goals.setOff(v !== 1));
  const W = app.welten; if (W) { const c = () => { const m = document.querySelector('#modal'); if (m) m.className = ''; }; $('#optScen').onclick = () => { c(); W.openScenarios(); }; $('#optBackups').onclick = () => { c(); W.openBackups(); }; $('#optShare').onclick = () => W.shareLink(); }
  seg('#optTips', v => put('pfr.tipsOff', v === 1 ? 0 : 1));
  { const kb = $('#optKeys'); if (kb) kb.onclick = () => app.steuer && app.steuer.openKeys(); }
  seg('#optNatur', v => put('pfr.naturOn', v));
  seg('#optRival', v => put('pfr.rival', v));
  seg('#optUnlock', v => { put('pfr.unlockAll', v); app.ui && app.ui.updateCards && app.ui.updateCards(); });
}
