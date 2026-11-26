// Interface Zusätze (seit 26.11.2026, Naders Auftrag "alles umsetzen"):
//   Zeitleiste: schmaler Balken am unteren Rand mit den großen Ereignissen der Welt, Klick fliegt hin und zeigt den Text.
//   Suche: Taste / oder Strg K, findet Menschen, Orte und Ereignisse.
//   Leiste: die Knöpfe oben rechts in vier Gruppen (Welt, Unterwegs, Werkstatt, System).
//   Meldungen: im schnellen Zeitraffer werden Meldungen gesammelt und alle paar Sekunden als eine gezeigt.
import { L } from '../i18n.js';

const YEAR = 24;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const COL = { krieg: '#e2664f', epoche: '#e9b949', gruendung: '#8fd08a', mythos: '#d9a8ff', gott: '#7fd7e6', politik: '#c9c2b0', fund: '#f0c27a', erkundung: '#8fb8ff', fremde: '#8fb8ff', piraten: '#b08968', seuche: '#b6d36a', glaube: '#d9a8ff', tod: '#9aa3a8', natur: '#8fd08a' };

export function initExtras(app) {
  const $ = s => document.querySelector(s);

  // ---------- Leiste in Gruppen ----------
  const icons = $('.icons');
  if (icons) {
    const order = [['btnHero', 'btnIsland', 'btnChron', 'btnMap'], ['btnGhost', 'btnFly', 'btnDrive'], ['btnLab', 'btnFoto', 'btnEditor'], ['btnSound', 'btnHelp', 'btnMenu']];
    const seen = new Set();
    order.forEach((grp, gi) => grp.forEach((id, k) => { const b = document.getElementById(id); if (!b) return; seen.add(b); b.classList.toggle('grp', k === 0 && gi > 0); icons.append(b); }));
    for (const b of [...icons.children]) if (!seen.has(b)) icons.insertBefore(b, document.getElementById('btnSound'));
  }

  // ---------- Meldungen bündeln ----------
  const ui = app.ui;
  if (ui && ui.toast && !ui._toast0) {
    ui._toast0 = ui.toast.bind(ui);
    const Q = [];
    let lastFlush = 0;
    ui.toast = (text, kind = '') => {
      if ((app.speed || 1) < 100 || kind === 'warn' || !app.running) return ui._toast0(text, kind);
      if (Q.length < 40 && !Q.some(q => q.text === text)) Q.push({ text, kind, y: app.st ? Math.floor(app.st.day / YEAR) + 1 : 0 });
    };
    setInterval(() => {
      if (!Q.length) return;
      const now = performance.now();
      if ((app.speed || 1) >= 100 && now - lastFlush < 5000) return;
      lastFlush = now;
      const list = Q.splice(0);
      if (list.length === 1) return ui._toast0(list[0].text, list[0].kind);
      const god = list.filter(q => q.kind === 'god'), rest = list.filter(q => q.kind !== 'god');
      const pick = [...god, ...rest].slice(0, 2);
      const y0 = list[0].y, y1 = list[list.length - 1].y;
      ui._toast0((y1 > y0 ? L(`Jahr ${y0} bis ${y1}: `, `Years ${y0} to ${y1}: `) : '') + pick.map(q => q.text).join(' · ') + (list.length > 2 ? L(` · und ${list.length - 2} weitere Meldungen`, ` · and ${list.length - 2} more`) : ''), pick[0].kind);
    }, 1200);
  }

  // ---------- Zeitleiste ----------
  const bar = document.createElement('div');
  bar.id = 'zeitleiste';
  bar.innerHTML = '<div class="zl-track"></div><div class="zl-tip"></div>';
  document.body.append(bar);
  const track = bar.querySelector('.zl-track'), tip = bar.querySelector('.zl-tip');
  let sig = '';
  const draw = () => {
    const st = app.st;
    if (!st || !app.running) { bar.classList.remove('show'); return; }
    bar.classList.add('show');
    // über die ganze Geschichte verteilt: je Abschnitt der Leiste höchstens ein Ereignis (das wichtigste), sonst drängt sich alles am Ende
    const all = st.chronicle.filter(c => c.imp >= 2), B = 110, dMax = Math.max(YEAR, st.day), slot = new Map();
    for (const c of all) { const k = Math.min(B - 1, Math.floor(c.d / dMax * B)); const o = slot.get(k); if (!o || c.imp > o.imp || (c.imp === o.imp && (c.k === 'epoche' || c.k === 'krieg') && o.k !== 'epoche')) slot.set(k, c); }
    const ev = [...slot.values()].sort((x, y) => x.d - y.d);
    const s2 = st.seed + ':' + ev.length + ':' + (ev.length ? ev[ev.length - 1].d : 0) + ':' + Math.floor(st.day / 12);
    if (s2 === sig) return;
    sig = s2;
    const d0 = 0, d1 = Math.max(YEAR, st.day);
    let html = '';
    // Jahresmarken
    const years = d1 / YEAR, step = years > 800 ? 200 : years > 300 ? 100 : years > 120 ? 50 : years > 40 ? 20 : years > 12 ? 5 : 1;
    for (let y = step; y < years; y += step) html += `<i class="zl-y" style="left:${(y * YEAR / d1 * 100).toFixed(2)}%"><em>${y}</em></i>`;
    ev.forEach((c, i) => { html += `<button class="zl-e" data-i="${i}" style="left:${((c.d - d0) / (d1 - d0) * 100).toFixed(2)}%;--c:${COL[c.k] || '#f3ead6'}" aria-label="${esc(L('Jahr', 'Year') + ' ' + (Math.floor(c.d / YEAR) + 1) + ': ' + c.t)}"></button>`; });
    track.innerHTML = html;
    track.querySelectorAll('.zl-e').forEach(b => {
      const c = ev[+b.dataset.i];
      const showTip = () => { tip.innerHTML = `<small>${L('Jahr', 'Year')} ${Math.floor(c.d / YEAR) + 1}</small>${esc(c.t)}`; const r = b.getBoundingClientRect(); tip.style.left = Math.max(170, Math.min(innerWidth - 170, r.left)) + 'px'; tip.classList.add('show'); };
      b.onmouseenter = showTip; b.onfocus = showTip;
      b.onmouseleave = b.onblur = () => tip.classList.remove('show');
      b.onclick = () => { showTip(); const s = c.s > 0 && st._rt.sById.get(c.s); if (s && s.alive && app.focus) app.focus(s.cx, s.cy); setTimeout(() => tip.classList.remove('show'), 6000); };
    });
  };
  setInterval(draw, 3000);

  // ---------- Suche ----------
  const box = document.createElement('div');
  box.id = 'suche';
  box.innerHTML = `<div class="su-box"><input type="search" placeholder="${L('Suche nach Menschen, Orten, Ereignissen', 'Search people, places, events')}" aria-label="${L('Suche', 'Search')}" autocomplete="off"><div class="su-quick"><button data-q="leg">${L('Legenden der Welt', 'Legends of the world')}</button><button data-q="baum">${L('Mein Stammbaum', 'My family tree')}</button><button data-q="foto">${L('Fotomodus', 'Photo mode')}</button></div><div class="su-list" role="listbox"></div><small>${L('Enter öffnet · Pfeiltasten wählen · Esc schließt', 'Enter opens · arrows select · Esc closes')}</small></div>`;
  document.body.append(box);
  const input = box.querySelector('input'), list = box.querySelector('.su-list');
  let results = [], sel = 0;
  const open = () => { if (!app.st || !app.running) return; box.classList.add('show'); input.value = ''; list.innerHTML = ''; results = []; setTimeout(() => input.focus(), 30); };
  const close = () => { box.classList.remove('show'); input.blur(); };
  const go = r => {
    if (!r) return; close();
    const st = app.st;
    if (r.type === 'ort') { app.focus && app.focus(r.o.cx, r.o.cy); ui.showSettlement ? ui.showSettlement(r.o) : 0; }
    else if (r.type === 'mensch') { app.selectPerson && app.selectPerson(r.o.id, true); ui.showPerson && ui.showPerson(r.o); }
    else if (r.type === 'ereignis') { const s = r.o.s > 0 && st._rt.sById.get(r.o.s); if (s && s.alive) app.focus && app.focus(s.cx, s.cy); ui._toast0 ? ui._toast0(L('Jahr', 'Year') + ' ' + (Math.floor(r.o.d / YEAR) + 1) + ': ' + r.o.t, 'god') : ui.toast(r.o.t, 'god'); }
  };
  const render = () => {
    list.innerHTML = results.map((r, i) => `<button class="su-r${i === sel ? ' on' : ''}" data-i="${i}" role="option"><b>${esc(r.t)}</b><span>${esc(r.sub)}</span></button>`).join('') || (input.value.trim().length >= 2 ? `<p class="su-0">${L('Nichts gefunden.', 'Nothing found.')}</p>` : '');
    list.querySelectorAll('.su-r').forEach(b => { b.onclick = () => go(results[+b.dataset.i]); });
  };
  const search = () => {
    const q = input.value.trim().toLowerCase(), st = app.st;
    results = []; sel = 0;
    if (q.length >= 2 && st) {
      const rt = st._rt;
      for (const s of st.settlements) if (s.alive && s.name.toLowerCase().includes(q)) results.push({ type: 'ort', o: s, t: s.name, sub: L(`Ort · ${s.pop} Menschen`, `Settlement · ${s.pop} people`) });
      let n = 0;
      for (const p of st.people) { const nm = (p.n || '') + (p.clan ? ' ' + p.clan : ''); if (nm.toLowerCase().includes(q)) { const s = rt.sById.get(p.s); results.push({ type: 'mensch', o: p, t: nm, sub: L(`Mensch · ${Math.floor((st.day - p.b) / YEAR)} Jahre${s ? ' · ' + s.name : ''}`, `Person · ${Math.floor((st.day - p.b) / YEAR)} years${s ? ' · ' + s.name : ''}`) }); if (++n >= 8) break; } }
      n = 0;
      for (let i = st.chronicle.length - 1; i >= 0 && n < 6; i--) { const c = st.chronicle[i]; if (c.imp >= 1 && c.t.toLowerCase().includes(q)) { results.push({ type: 'ereignis', o: c, t: c.t.length > 90 ? c.t.slice(0, 88) + ' …' : c.t, sub: L('Ereignis · Jahr ', 'Event · year ') + (Math.floor(c.d / YEAR) + 1) }); n++; } }
      results = results.slice(0, 14);
    }
    render();
  };
  box.querySelectorAll('.su-quick button').forEach(b => { b.onclick = () => { close(); const q = b.dataset.q; if (q === 'leg') app.openLegends && app.openLegends(); else if (q === 'foto') app.foto && app.foto.enter(); else { const h = app.st.hero && !app.st.hero.end ? app.st.hero.id : 0; if (h && app.openTree) app.openTree(h); else ui._toast0 ? ui._toast0(L('Du lebst gerade kein eigenes Leben.', 'You are not living a life of your own right now.')) : 0; } }; });
  input.addEventListener('input', search);
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
    else if (e.key === 'Enter') go(results[sel]);
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
  });
  box.addEventListener('pointerdown', e => { if (e.target === box) close(); });
  window.addEventListener('keydown', e => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const busy = document.body.classList.contains('ghost-mode') || app.flying || app.driving || app.mapOpen || document.querySelector('#modal.show, #trailer, #heroPick.show');
    if (!busy && (e.key === '/' || ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')))) { e.preventDefault(); open(); }
  });
  app.openSearch = open;
}
