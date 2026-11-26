// Menschen und Geschichten (seit 26.11.2026, Naders Auftrag "alles umsetzen"):
//   Stammbaum: die Familie eines Menschen über fünf Generationen (Großeltern bis Enkel), Lebende anklickbar.
//   Legenden: die berühmtesten Lebenden und die Ahnen der Welt mit Titel, Lebensjahren und letzten Taten.
//   Leben begleiten: die Kamera bleibt nah an einem Menschen, die Oberfläche tritt zurück, unten steht, wer das ist.
// Verstorbene kennt der Spielstand nur, wenn sie berühmt waren (st.ancestors). Die Namen toter Eltern stehen im ersten
// Eintrag des Lebenslaufs ("wird geboren, Kind von A und B") und werden von dort gelesen.
import { L } from '../i18n.js';
import * as D from '../sim/data.js';

const YEAR = D.DAYS_PER_YEAR;
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function initMenschen(app) {
  const ov = document.createElement('div');
  ov.id = 'familie';
  document.body.append(ov);
  const close = () => ov.classList.remove('show');
  ov.addEventListener('pointerdown', e => { if (e.target === ov) close(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && ov.classList.contains('show')) { e.stopImmediatePropagation(); close(); } }, true);
  const age = (st, p) => Math.floor((st.day - p.b) / YEAR);
  const chip = (st, p, cls = '') => {
    const s = st._rt.sById.get(p.s);
    return `<button class="fm-p ${cls}" data-pid="${p.id}" style="--c:${s ? s.color : '#999'}"><b>${esc((p.lt || p.title ? (p.lt || p.title) + ' ' : '') + p.n)}</b><span>${age(st, p)} · ${esc(D.JOBS[p.job]?.name || p.job || '')}</span></button>`;
  };
  const ghost = name => `<span class="fm-p tot"><b>${esc(name)}</b><span>${L('verstorben', 'deceased')}</span></span>`;
  const deadParents = p => { const t = p.bio && p.bio[0] ? p.bio[0][1] : ''; const m = t.match(/(?:Kind von|child of)\s+(.+?)\s+(?:und|and)\s+(.+?)[.,]?$/); return m ? [m[1], m[2]] : []; };

  app.openTree = pid => {
    const st = app.st; if (!st) return;
    const rt = st._rt, p = rt.pById.get(pid);
    if (!p) return;
    const get = id => (id ? rt.pById.get(id) : null);
    const mo = get(p.mo), fa = get(p.fa), dp = deadParents(p);
    const parents = [mo, fa].filter(Boolean);
    const grand = parents.flatMap(q => [get(q.mo), get(q.fa)]).filter(Boolean);
    const sibs = st.people.filter(q => q !== p && ((p.mo && q.mo === p.mo) || (p.fa && q.fa === p.fa)));
    const kids = st.people.filter(q => q.mo === p.id || q.fa === p.id);
    const kidIds = new Set(kids.map(k => k.id));
    const gkids = st.people.filter(q => kidIds.has(q.mo) || kidIds.has(q.fa));
    const pa = get(p.pa);
    const row = (title, html) => (html ? `<div class="fm-row"><small>${title}</small><div>${html}</div></div>` : '');
    const parentHtml = parents.map(q => chip(st, q)).join('') + (parents.length < 2 ? dp.filter(n => !parents.some(q => q.n === n)).slice(0, 2 - parents.length).map(ghost).join('') : '');
    ov.innerHTML = `<div class="fm-box"><button class="fm-x" aria-label="${L('Schließen', 'Close')}">×</button>
      <h2>${L('Stammbaum', 'Family tree')}</h2><p class="fm-sub">${L('Familie', 'Family')} ${esc(p.clan)}${kids.length !== (p.kids | 0) && p.kids ? ' · ' + L(`${p.kids} Kinder, ${kids.length} leben`, `${p.kids} children, ${kids.length} alive`) : ''}</p>
      ${row(L('Großeltern', 'Grandparents'), grand.map(q => chip(st, q)).join(''))}
      ${row(L('Eltern', 'Parents'), parentHtml)}
      ${row(L('Diese Generation', 'This generation'), chip(st, p, 'ich') + (pa ? `<i class="fm-h">♥</i>` + chip(st, pa) : '') + (sibs.length ? `<i class="fm-gap"></i>` + sibs.slice(0, 8).map(q => chip(st, q, 'klein')).join('') : ''))}
      ${row(L('Kinder', 'Children'), kids.map(q => chip(st, q)).join(''))}
      ${row(L('Enkel', 'Grandchildren'), gkids.slice(0, 14).map(q => chip(st, q, 'klein')).join(''))}
      ${!parents.length && !dp.length && !kids.length && !pa && !sibs.length ? `<p class="fm-0">${L('Von dieser Familie lebt sonst niemand mehr.', 'No one else of this family is alive.')}</p>` : ''}
      <div class="fm-act"><button class="fm-leg">${L('Legenden der Welt', 'Legends of the world')}</button></div></div>`;
    ov.classList.add('show');
    ov.querySelector('.fm-x').onclick = close;
    ov.querySelector('.fm-leg').onclick = () => app.openLegends();
    ov.querySelectorAll('button.fm-p').forEach(b => { b.onclick = () => { const id = +b.dataset.pid; if (id === p.id) { close(); app.selectPerson(id, true); } else app.openTree(id); }; });
  };

  app.openLegends = () => {
    const st = app.st; if (!st) return;
    const rt = st._rt;
    const live = st.people.filter(p => (p.fame | 0) >= 2 || p.lt || p.title).sort((a, b) => (b.fame | 0) - (a.fame | 0) || (b.lt ? 1 : 0) - (a.lt ? 1 : 0)).slice(0, 12);
    const dead = (st.ancestors || []).slice(0, 18);
    const yr = d => Math.floor(d / YEAR) + 1;
    ov.innerHTML = `<div class="fm-box"><button class="fm-x" aria-label="${L('Schließen', 'Close')}">×</button>
      <h2>${L('Legenden der Welt', 'Legends of the world')}</h2><p class="fm-sub">${L('Wer in Erinnerung bleibt', 'Those who are remembered')}</p>
      <div class="fm-row"><small>${L('Unter den Lebenden', 'Among the living')}</small><div>${live.map(p => chip(st, p)).join('') || `<span class="fm-0">${L('Noch niemand hat sich einen Namen gemacht.', 'No one has made a name yet.')}</span>`}</div></div>
      <div class="fm-row"><small>${L('Ahnen', 'Ancestors')}</small><div class="fm-list">${dead.map(a => { const s = rt.sById.get(a.s); return `<div class="fm-a"><b>${esc((a.title ? a.title + ' ' : '') + a.n + ' ' + (a.clan || ''))}</b><span>${L('Jahr', 'Year')} ${yr(a.b)} ${L('bis', 'to')} ${yr(a.d)}${s ? ' · ' + esc(s.name) : ''}</span>${a.bio && a.bio.length ? `<em>${esc(a.bio[a.bio.length - 1][1])}</em>` : ''}</div>`; }).join('') || `<span class="fm-0">${L('Die Ahnenhalle ist noch leer.', 'The hall of ancestors is still empty.')}</span>`}</div></div></div>`;
    ov.classList.add('show');
    ov.querySelector('.fm-x').onclick = close;
    ov.querySelectorAll('button.fm-p').forEach(b => { b.onclick = () => { close(); app.selectPerson(+b.dataset.pid, true); }; });
  };

  // ---------- Leben begleiten ----------
  const lifeBar = document.createElement('div');
  lifeBar.id = 'lebenBar';
  document.body.append(lifeBar);
  let life = null;
  app.startLife = pid => {
    const st = app.st, p = st && st._rt.pById.get(pid);
    if (!p) return;
    if (life) app.stopLife();
    const cam = app.stage.camera, tg = app.stage.controls.target;
    life = { id: pid, speed: app.speed, cp: cam.position.clone(), ct: tg.clone(), last: '' };
    app.ui.closeInspector && app.ui.closeInspector();
    app.setSpeed && app.speed > 3 && app.setSpeed(1);
    app.selId = pid; app.follow(pid);
    // nah heran: Kamera auf rund 7 Abstand zum Ziel ziehen
    const dir = cam.position.clone().sub(tg); const d = dir.length(); if (d > 8) cam.position.copy(tg).addScaledVector(dir.normalize(), 7);
    document.body.classList.add('leben');
    lifeBar.classList.add('show');
    life.timer = setInterval(() => {
      const q = app.st && app.st._rt.pById.get(pid);
      if (!q) { app.ui.toast(L(`${p.n} ist gestorben. Die Geschichte endet hier.`, `${p.n} has died. The story ends here.`), 'god'); return app.stopLife(); }
      const s = app.st._rt.sById.get(q.s), b = q.bio && q.bio.length ? q.bio[q.bio.length - 1] : null;
      const html = `<small>${L('Du begleitest', 'You are following')}</small><b>${esc((q.lt || q.title ? (q.lt || q.title) + ' ' : '') + q.n + ' ' + (q.clan || ''))}</b><span>${age(app.st, q)} ${L('Jahre', 'years')} · ${esc(D.JOBS[q.job]?.name || q.job || '')}${s ? ' · ' + esc(s.name) : ''}</span>${b ? `<em>${L('Zuletzt', 'Lately')}: ${esc(b[1])}</em>` : ''}<button class="lb-x">${L('Beenden', 'Stop')} <kbd>Esc</kbd></button>`;
      if (html !== life.last) { life.last = html; lifeBar.innerHTML = html; lifeBar.querySelector('.lb-x').onclick = () => app.stopLife(); }
    }, 800);
  };
  app.stopLife = () => {
    if (!life) return;
    clearInterval(life.timer);
    app.follow(null);
    document.body.classList.remove('leben');
    lifeBar.classList.remove('show');
    life = null;
  };
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && life) { e.stopImmediatePropagation(); app.stopLife(); } }, true);
}
