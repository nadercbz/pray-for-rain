// Inselbuch, Reiter Militär (seit 24.10.2026, Kriegssystem): Lage (Kriege, Heere, Schlachten), Streitkräfte je Ort
// (Verteidigungsminister, General, Admiral, Truppen, Mauer, Bedrohung), Bündnisse als Netz und das Kriegsbuch mit allen
// Schlachten. Daten aus src/sim/military.js (s.mil, s.wall, st.armies, st.fights, st.milLog) und diplomacy.js (s.pact,
// Kriege). Frei stehend mit den Stilen des Reiters Gesellschaft (injectSocietyCss), Klick auf Ort oder Heer fliegt hin.
import * as D from '../sim/data.js';
import { yearOf } from '../sim/util.js';
import { WALLS, DOCTRINE, UNITS, unitOf, ministerTitle, rankName, armyName, powerOf, wallDef } from '../sim/military.js';
import { GOALS } from '../sim/diplomacy.js';
import { esc, injectSocietyCss } from './society_ui.js';
import { L } from '../i18n.js';

const bar = (v, col) => `<span class="sobar"><i style="width:${Math.max(0, Math.min(100, v * 100)).toFixed(0)}%;${col ? `background:${col}` : ''}"></i></span>`;
const SUB = [['lage', L('Lage', 'Situation')], ['orte', L('Streitkräfte', 'Forces')], ['pakte', L('Bündnisse', 'Alliances')], ['buch', L('Kriegsbuch', 'War Book')]];
export const PACT_NAME = {
  verteidigung: L('Verteidigungsbündnis', 'Defensive alliance'), militaer: L('Militärbündnis', 'Military alliance'), nichtangriff: L('Nichtangriffspakt', 'Non-aggression pact'),
  heirat: L('Heiratsbund', 'Marriage pact'), handel: L('Handelsvertrag', 'Trade treaty'), grenze: L('Grenzvertrag', 'Border treaty'), waffenstillstand: L('Waffenstillstand', 'Truce'),
  tribut: L('Tributvertrag', 'Tribute treaty'), glaube: L('Glaubensauflage', 'Faith treaty'),
};
const PACT_COL = { verteidigung: '#7fc4b4', militaer: '#e07a5f', nichtangriff: '#e9c46a', heirat: '#e99ab0', handel: '#8a9bd4', grenze: '#c9b48a', waffenstillstand: '#cfcac2', tribut: '#b388eb', glaube: '#efe9dc' };
const STATE = { muster: L('sammelt sich', 'mustering'), march: L('marschiert', 'marching'), siege: L('belagert', 'besieging'), battle: L('in der Schlacht', 'in battle'), guard: L('hält Wache', 'standing guard'), home: L('auf dem Heimweg', 'heading home') };
const KIND = { feld: L('Feldschlacht', 'Field battle'), sturm: L('Sturm', 'Storming'), see: L('Seeschlacht', 'Naval battle'), ausfall: L('Ausfall', 'Sortie') };
const cap = t => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');

let css = false;
function injectMilCss() {
  if (css) return; css = true;
  const el = document.createElement('style');
  el.textContent = `.sodot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:middle}
    #left .sorow a[data-aid],#left .sorow a[data-fid],#left .sorow a[data-sid],#left .sorow a[data-pid]{cursor:pointer;text-decoration:none;border-bottom:1px dotted currentColor}`;
  document.head.append(el);
}

export function militaryTab(ui, st, body) {
  injectSocietyCss(); injectMilCss();
  const S = ui.mil || (ui.mil = { tab: 'lage' });
  let html = `<div class="isle-chips sosub">${SUB.map(([k, n]) => `<button data-sub="${k}" class="${k === S.tab ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  if (S.tab === 'lage') html += lageHtml(st);
  else if (S.tab === 'orte') html += forcesHtml(st);
  else if (S.tab === 'pakte') html += pactsHtml(st);
  else html += bookHtml(st);
  body.innerHTML = html;
  body.querySelectorAll('[data-sub]').forEach(b => { b.onclick = () => { S.tab = b.dataset.sub; militaryTab(ui, st, body); }; });
  body.querySelectorAll('[data-sid]').forEach(b => { b.onclick = () => { const s = st._rt.sById.get(+b.dataset.sid); if (s) ui.app.focus(s.cx, s.cy, 45); }; });
  body.querySelectorAll('[data-aid]').forEach(b => { b.onclick = () => { const A = (st.armies || []).find(a => a.id === +b.dataset.aid); if (A) ui.app.focus(A.x, A.y, 26); }; });
  body.querySelectorAll('[data-fid]').forEach(b => { b.onclick = () => { const F = (st.fights || []).find(f => f.id === +b.dataset.fid); if (F) ui.app.focus(F.x, F.y, 24); }; });
  body.querySelectorAll('[data-pid]').forEach(b => { b.onclick = () => ui.app.selectPerson && ui.app.selectPerson(+b.dataset.pid, true); });
}

const sLink = (s) => (s ? `<a data-sid="${s.id}"><i class="sodot" style="background:${s.color}"></i>${esc(s.name)}</a>` : '?');
const pLink = (p, pre = '') => (p ? `<a data-pid="${p.id}">${pre}${esc(p.n)}</a>` : '');

// ---------- Lage ----------
function lageHtml(st) {
  const rt = st._rt;
  let html = `<h3 class="sect">${L('Kriege', 'Wars')}</h3>`;
  const wars = st.settlements.filter(s => s.alive && s.war && s.aggressor);
  if (!wars.length) html += `<p class="muted">${L('Kein Krieg. Die Völker leben in Frieden, noch.', 'No war. The peoples live in peace, for now.')}</p>`;
  else {
    html += `<div class="sorows">`;
    for (const a of wars) {
      const b = rt.sById.get(a.war), G = GOALS[a.warGoal];
      const helpA = (a.helpers || []).map(id => rt.sById.get(id)).filter(Boolean), helpB = ((b && b.helpers) || []).map(id => rt.sById.get(id)).filter(Boolean);
      const lead = (a.warScore || 0) - ((b && b.warScore) || 0);
      html += `<div class="sorow"><b>${esc(cap(a.warName || L('Krieg', 'War')))}</b><span>${yearOf(a.warSince || st.day)}</span>
        <small>${L('seit Jahr', 'since year')} ${yearOf(a.warSince || st.day)} · ${sLink(a)}${helpA.length ? ' + ' + helpA.map(sLink).join(', ') : ''} ${L('gegen', 'against')} ${sLink(b)}${helpB.length ? ' + ' + helpB.map(sLink).join(', ') : ''}<br>
        ${G ? esc(G.name) : ''} · ${L('Schlachten', 'battles')} ${a.warBattles || 0} · ${L('Stand', 'score')} ${a.warScore || 0} : ${(b && b.warScore) || 0}${lead ? ` · ${esc(lead > 0 ? a.name : b ? b.name : '')} ${L('führt', 'leads')}` : ''}</small></div>`;
    }
    html += `</div>`;
  }
  const armies = (st.armies || []).filter(A => A.st !== 'gone');
  html += `<h3 class="sect">${L('Heere und Flotten', 'Armies and Fleets')}</h3>`;
  if (!armies.length) html += `<p class="muted">${L('Kein Heer ist unterwegs.', 'No army is in the field.')}</p>`;
  else {
    html += `<div class="sorows">`;
    for (const A of armies) {
      const s = rt.sById.get(A.s), T = rt.sById.get(A.foe), g = rt.pById.get(A.gen) || rt.pById.get(A.adm);
      const units = new Map();
      for (const id of A.ids) { const u = unitOf(A.era | 0, id); units.set(u, (units.get(u) || 0) + 1); }
      // Fahrzeuge zählen als Fahrzeug, nicht als Besatzung (4 Panzer statt 12)
      const uTxt = [...units].sort((a, b) => b[1] - a[1]).map(([u, n]) => `${UNITS[u].crew > 1 ? Math.ceil(n / UNITS[u].crew) : n} ${esc(UNITS[u].n)}`).join(', ');
      html += `<div class="sorow"><b><a data-aid="${A.id}"><i class="sodot" style="background:${s ? s.color : '#999'}"></i>${esc(armyName(st, A))}</a></b><span>${A.ids.length}</span>${bar(A.mor, '#7fc4b4')}
        <small>${STATE[A.st] || A.st}${T && A.st !== 'home' ? ` · ${L('gegen', 'against')} ${sLink(T)}` : ''}${A.st === 'siege' ? ` · ${L('Tag', 'day')} ${(A.siegeDays || 0) + 1}` : ''}${g ? ` · ${esc(rankName(g) || L('General', 'General'))} ${pLink(g)}` : ''}<br>${uTxt} · ${L('Moral', 'morale')} ${Math.round(A.mor * 100)}% · ${L('Vorräte', 'supplies')} ${Math.round(A.sup * 100)}%</small></div>`;
    }
    html += `</div>`;
  }
  const fights = (st.fights || []).filter(F => F.end == null);
  if (fights.length) {
    html += `<h3 class="sect">${L('Laufende Schlachten', 'Battles Under Way')}</h3><div class="sorows">`;
    for (const F of fights) html += `<div class="sorow"><b><a data-fid="${F.id}">${esc(cap(F.name))}</a></b><span>${KIND[F.k] || ''}</span><small>${F.n0[0]} ${L('gegen', 'against')} ${F.n0[1]} · ${L('Runde', 'round')} ${F.rounds + 1} · ${F.dead[0] + F.dead[1]} ${L('Tote', 'dead')}</small></div>`;
    html += `</div>`;
  }
  return html;
}

// ---------- Streitkräfte je Ort ----------
function forcesHtml(st) {
  const rt = st._rt;
  const sets = st.settlements.filter(s => s.alive && s.mil && s.mil.min).sort((a, b) => powerOf(st, b) - powerOf(st, a));
  if (!sets.length) return `<p class="muted">${L('Noch hat kein Ort einen Verteidigungsminister. Das beginnt in der Dorfzeit ab 12 Menschen.', 'No town has a minister of defense yet. That begins in the Village Age with 12 people.')}</p>`;
  const maxP = Math.max(1, ...sets.map(s => powerOf(st, s)));
  let html = `<p class="muted">${L('Stärke, wie die Minister sie einschätzen: Krieger, Miliz, Ausrüstung der Epoche und Befestigung.', 'Strength as the ministers judge it: warriors, militia, equipment of the era and fortifications.')}</p><div class="sorows">`;
  for (const s of sets) {
    const M = s.mil, W = s.wall || {}, m = rt.pById.get(M.min), g = rt.pById.get(M.gen), a = rt.pById.get(M.adm), from = M.from && rt.sById.get(M.from);
    let k = 0, mil = 0;
    for (const p of st.people) if (p.s === s.id && p.job === 'krieger') k++;
    for (const b of st.buildings) if (b.s === s.id && b.t === 'kaserne') mil++;
    const pw = powerOf(st, s);
    const wall = W.lvl ? `${esc(WALLS[W.lvl].n)} ${Math.round((W.hp ?? 1) * 100)}%` : L('keine Mauer', 'no wall');
    const build = W.b ? ` · ${L('baut', 'building')} ${esc(WALLS[W.b].n)} ${Math.round((W.prog || 0) * 100)}%` : '';
    html += `<div class="sorow"><b>${sLink(s)}</b><span>${Math.round(pw)}</span>${bar(pw / maxP, s.color)}
      <small>${m ? `${esc(ministerTitle(m))} ${pLink(m)} · „${esc(DOCTRINE[M.doc])}“` : ''}<br>
      ${g ? `${L('General', 'General')} ${pLink(g)}` : L('kein General', 'no general')}${a ? ` · ${L('Admiral', 'Admiral')} ${pLink(a)}` : ''} · ${k} ${L('Krieger', 'warriors')} · ${mil} ${mil === 1 ? L('Kaserne', 'barracks') : L('Kasernen', 'barracks')} · ${D.ERAS[s.era | 0].name}<br>
      ${wall}${build} · ${L('Verteidigung', 'defense')} +${Math.round(wallDef(s) * 100)}%${M.threat > 0.05 ? ` · ${L('Bedrohung', 'threat')} ${Math.round(M.threat * 100)}%${from ? ` ${L('durch', 'from')} ${sLink(from)}` : ''}` : ''} · ${L('Siege', 'victories')} ${M.won || 0}, ${L('Niederlagen', 'defeats')} ${M.lost || 0}</small></div>`;
  }
  return html + `</div>`;
}

// ---------- Bündnisse ----------
function pactsHtml(st) {
  const rt = st._rt, sets = st.settlements.filter(s => s.alive);
  const list = [];
  for (const s of sets) for (const [id, P] of Object.entries(s.pact || {})) if (P.until > st.day && s.id < +id) { const o = rt.sById.get(+id); if (o && o.alive) list.push([s, o, P]); }
  let html = '';
  // Netz: nur Orte mit Pakt oder Krieg, auf einem Kreis, Linien je Pakt in der Farbe der Art, Kriege rot gestrichelt
  const inNet = new Set();
  for (const [s, o] of list) { inNet.add(s.id); inNet.add(o.id); }
  for (const s of sets) if (s.war) { inNet.add(s.id); inNet.add(s.war); }
  const net = sets.filter(s => inNet.has(s.id));
  if (net.length > 1) {
    const w = 560, h = net.length > 10 ? 320 : 260, cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 34;
    const pos = new Map(net.map((s, i) => { const a = i / net.length * Math.PI * 2 - Math.PI / 2; return [s.id, [cx + Math.cos(a) * R * 1.5, cy + Math.sin(a) * R]]; }));
    let svg = `<svg class="sochart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">`;
    for (const [s, o, P] of list) { const [x1, y1] = pos.get(s.id), [x2, y2] = pos.get(o.id); svg += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${PACT_COL[P.kind] || '#ccc'}" stroke-width="${P.kind === 'militaer' || P.kind === 'verteidigung' ? 3 : 1.6}" opacity="0.85"/>`; }
    for (const s of sets) if (s.war && s.aggressor) { const o = rt.sById.get(s.war); if (!o || !pos.has(o.id)) continue; const [x1, y1] = pos.get(s.id), [x2, y2] = pos.get(o.id); svg += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#e05040" stroke-width="2.4" stroke-dasharray="6 5"/>`; }
    for (const s of net) { const [x, y] = pos.get(s.id); svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(4 + Math.sqrt(s.pop) * 0.6).toFixed(1)}" fill="${s.color}" stroke="rgba(0,0,0,0.35)"/><text x="${x.toFixed(1)}" y="${(y - 9 - Math.sqrt(s.pop) * 0.6).toFixed(1)}" text-anchor="middle" font-size="14" fill="currentColor">${esc(s.name)}</text>`; }
    svg += `</svg>`;
    const kinds = [...new Set(list.map(x => x[2].kind))];
    html += svg + `<div class="solegend">${kinds.map(k => `<span><i style="background:${PACT_COL[k] || '#ccc'}"></i>${esc(PACT_NAME[k] || k)}</span>`).join('')}<span><i style="background:#e05040"></i>${L('Krieg', 'war')}</span></div>`;
  }
  html += `<h3 class="sect">${L('Verträge', 'Treaties')}</h3>`;
  if (!list.length) return html + `<p class="muted">${L('Keine Verträge. Jeder steht für sich.', 'No treaties. Everyone stands alone.')}</p>`;
  html += `<div class="sorows">`;
  for (const [s, o, P] of list.sort((a, b) => (a[2].kind > b[2].kind ? 1 : -1))) {
    html += `<div class="sorow"><b><i class="sodot" style="background:${PACT_COL[P.kind] || '#ccc'}"></i>${esc(PACT_NAME[P.kind] || P.kind)}</b><span>${yearOf(P.until)}</span><small>${sLink(s)} ${L('und', 'and')} ${sLink(o)} · ${L('seit Jahr', 'since year')} ${yearOf(P.start || st.day)}, ${L('bis Jahr', 'until year')} ${yearOf(P.until)}</small></div>`;
  }
  return html + `</div>`;
}

// ---------- Kriegsbuch ----------
function bookHtml(st) {
  const rt = st._rt, log = (st.milLog || []).slice().reverse();
  if (!log.length) return `<p class="muted">${L('Noch keine Schlacht. Das Kriegsbuch ist leer.', 'No battle yet. The war book is empty.')}</p>`;
  const kinds = {}; let dead = 0;
  for (const e of log) { kinds[e.k] = (kinds[e.k] || 0) + 1; dead += e.dead[0] + e.dead[1]; }
  let html = `<p class="muted">${Object.entries(kinds).map(([k, n]) => `${n} × ${esc(KIND[k] || k)}`).join(' · ')} · ${dead} ${L('Gefallene', 'fallen')}</p><div class="sorows">`;
  for (const e of log) {
    const a = rt.sById.get(e.a), b = rt.sById.get(e.b), W = rt.sById.get(e.win);
    const nm = o => (o ? sLink(o) : esc(L('ein vergangener Ort', 'a vanished town')));
    html += `<div class="sorow"><b>${esc(cap(e.name))}</b><span>${yearOf(e.d)}</span>
      <small>${L('Jahr', 'Year')} ${yearOf(e.d)} · ${esc(KIND[e.k] || '')} · ${nm(a)} (${e.n0[0]}) ${L('gegen', 'against')} ${nm(b)} (${e.n0[1]}) · ${L('Sieger', 'victor')} ${W ? sLink(W) : '?'} · ${L('Tote', 'dead')} ${e.dead[0]} / ${e.dead[1]}${e.gen ? ` · ${L('General', 'General')} ${esc(e.gen)}` : ''}</small></div>`;
  }
  return html + `</div>`;
}
