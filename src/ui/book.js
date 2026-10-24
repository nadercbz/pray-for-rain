// Inselbuch, neue Reiter: Menschen (alle Einwohner, Beziehungen, Beziehungsnetz) und Wirtschaft (Geld, Preise, Löhne,
// Haushalt, Vermögen, Handel). Dazu Bausteine für die Personenkarte und die Siedlungsseite.
import * as D from '../sim/data.js';
import { ageOf, yearOf } from '../sim/util.js';
import { GOODS, BASE, CLASSES, taxRate, wealthOf } from '../sim/money.js';
import { L } from '../i18n.js';
import { openDiary } from './diary_ui.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const bar = (v, cls = '') => `<div class="mbar ${cls}"><i style="width:${Math.max(0, Math.min(100, v * 100)).toFixed(0)}%"></i></div>`;
const ibar = (v, cls = '') => `<span class="mbar ibar ${cls}"><i style="width:${Math.max(0, Math.min(100, v * 100)).toFixed(0)}%"></i></span>`;
const pct = v => Math.round(v * 100) + '%';
const GOOD_NAME = { food: L('Nahrung', 'Food'), wood: L('Holz', 'Wood'), stone: L('Stein', 'Stone'), ore: L('Erz', 'Ore'), tools: L('Werkzeug', 'Tools'), goods: L('Waren', 'Goods') };
const CLS_COL = ['#8fa3b8', '#e8dcc6', '#7fc4b4', '#e9b44c', '#b388eb'];

// Geldbeträge lesbar: 0,4 · 12 · 1.240 · 12,4k
export function money(v) {
  const a = Math.abs(v), sgn = v < 0 ? '-' : '';
  if (a >= 100000) return sgn + (a / 1000).toFixed(0) + 'k';
  if (a >= 10000) return sgn + (a / 1000).toFixed(1).replace('.', L(',', '.')) + 'k';
  if (a >= 100) return sgn + Math.round(a).toLocaleString(L('de-DE', 'en-US'));
  if (a >= 10) return sgn + a.toFixed(0);
  return sgn + a.toFixed(1).replace('.', L(',', '.'));
}
export const curOf = (st, s) => { const I = s && st._rt.iById.get(s.isle); return I && I.cur ? I.cur.n : L('Muscheln', 'shells'); };
const sOf = (st, p) => st._rt.sById.get(p.s);
const nameOf = (st, id) => { const q = st._rt.pById.get(id); return q ? q.n : null; };

// ---------- Personenkarte ----------

export function personBlocks(st, p, plink) {
  const rt = st._rt, s = sOf(st, p), cur = curOf(st, s);
  const age = ageOf(st, p);
  let html = '';
  if (age >= 14) {
    // Rang im Ort
    const all = st.people.filter(q => q.s === p.s && ageOf(st, q) >= 14);
    const w = wealthOf(st, p);
    const rank = all.filter(q => wealthOf(st, q) > w).length + 1;
    const own = st.buildings.filter(b => b.own === p.id);
    const ownCount = {};
    for (const b of own) ownCount[b.t] = (ownCount[b.t] || 0) + 1;
    const ownTxt = Object.entries(ownCount).map(([t, n]) => `${D.BUILDINGS[t].name}${n > 1 ? ' ×' + n : ''}`).join(', ');
    const work = p.w > 0 ? rt.bById.get(p.w) : null;
    const boss = work && work.own && work.own !== p.id ? rt.pById.get(work.own) : null;
    const years = Math.max(0, Math.floor((st.day - (p.jy ?? st.day)) / D.DAYS_PER_YEAR));
    const cls = CLASSES[p.cls ?? 1];
    html += `<h4 class="isect">${L('Besitz und Arbeit', 'Wealth and Work')}</h4>
      <div class="pmoney">
        <div><b>${money(p.gold || 0)}</b><small>${esc(cur)}</small></div>
        <div><b>${(p.inc || 0) >= 0 ? '+' : ''}${money(p.inc || 0)}</b><small>${L('pro Tag', 'per day')}</small></div>
        <div><b style="color:${CLS_COL[p.cls ?? 1]}">${cls}</b><small>${L(`Platz ${rank} von ${all.length}`, `rank ${rank} of ${all.length}`)}</small></div>
      </div>
      <p class="fam">${p.job !== 'kind' && p.job !== 'alt' ? L(`Arbeitet als ${D.JOBS[p.job]?.name || p.job}`, `Works as ${(D.JOBS[p.job]?.name || p.job).toLowerCase()}`) + (work ? L(` (${D.BUILDINGS[work.t].name})`, ` (${D.BUILDINGS[work.t].name.toLowerCase()})`) : '') + (boss ? L(`, angestellt bei ${plink(boss)}`, `, employed by ${plink(boss)}`) : work && work.own === p.id ? L(', im eigenen Betrieb', ', in their own business') : '') + L(` seit ${years} ${years === 1 ? 'Jahr' : 'Jahren'}. `, ` for ${years} ${years === 1 ? 'year' : 'years'}. `) : ''}${(p.edu || 0) > 0.3 ? L('Hat eine Schule besucht. ', 'Went to school. ') : ''}${ownTxt ? L(`Besitzt ${esc(ownTxt)}. `, `Owns ${esc(ownTxt)}. `) : ''}${p.dep > 1 ? L(`${money(p.dep)} ${esc(cur)} auf der Bank. `, `${money(p.dep)} ${esc(cur)} in the bank. `) : ''}${p.debt > 0.5 ? L(`Schuldet ${money(p.debt)} ${esc(cur)} ${p.cred < 0 ? 'der Bank' : p.cred && nameOf(st, p.cred) ? 'an ' + esc(nameOf(st, p.cred)) : ''}${p.bond ? ', in Schuldknechtschaft' : ''}. `, `Owes ${money(p.debt)} ${esc(cur)} ${p.cred < 0 ? 'to the bank' : p.cred && nameOf(st, p.cred) ? 'to ' + esc(nameOf(st, p.cred)) : ''}${p.bond ? ', in debt bondage' : ''}. `) : ''}${p.poor > 6 ? L('Lebt in Not. ', 'Lives in hardship. ') : ''}${p.unpaid > 6 ? L('Bekommt seit Wochen nicht den vollen Lohn. ', 'Has not been paid in full for weeks. ') : ''}</p>`;
  }
  // Beziehungen
  const pa = p.pa && rt.pById.get(p.pa), fi = p.fi && rt.pById.get(p.fi), lov = p.lov && rt.pById.get(p.lov), aff = p.aff && rt.pById.get(p.aff);
  const lines = [];
  if (pa) lines.push((p.sec ? L(`Lebt heimlich mit ${plink(pa)}`, `Secretly lives with ${plink(pa)}`) : L(`Verheiratet mit ${plink(pa)}`, `Married to ${plink(pa)}`)) + (p.wed != null ? L(` seit Jahr ${yearOf(p.wed)}`, ` since year ${yearOf(p.wed)}`) : '') + '.');
  if (fi) lines.push(L(`Verlobt mit ${plink(fi)}, die Hochzeit ist in ${Math.max(0, (p.wedAt || st.day) - st.day)} Tagen.`, `Engaged to ${plink(fi)}, the wedding is in ${Math.max(0, (p.wedAt || st.day) - st.day)} days.`));
  if (lov && !fi && !pa) lines.push(L(`Heimlich verliebt in ${plink(lov)}${lov.lov === p.id ? ', und es ist gegenseitig' : ''}.`, `Secretly in love with ${plink(lov)}${lov.lov === p.id ? ', and it is mutual' : ''}.`));
  if (aff) lines.push(`<span class="secret">${L(`Hat eine heimliche Affäre mit ${plink(aff)}. Nur du weißt es.`, `Is having a secret affair with ${plink(aff)}. Only you know.`)}</span>`);
  if (p.affKnown) lines.push(L('Eine Affäre ist schon einmal aufgeflogen.', 'An affair has been exposed before.'));
  const exs = (p.ex || []).map(id => rt.pById.get(id)).filter(Boolean);
  if (exs.length) lines.push(L(`Geschieden von ${exs.map(plink).join(', ')}.`, `Divorced from ${exs.map(plink).join(', ')}.`));
  if (p.wid && !pa) lines.push(L(`Verwitwet seit Jahr ${yearOf(p.wid)}.`, `Widowed since year ${yearOf(p.wid)}.`));
  if (pa && p.ms != null) lines.push(`${L('Glück in der Ehe', 'Happiness in marriage')} ${ibar(p.ms, p.ms < 0.35 ? 'red' : 'gold')}`);
  const kids = (rt.kidsOf.get(p.id) || []).filter(k => rt.pById.has(k.id));
  const adopted = st.people.filter(k => k.ad === p.id);
  if (kids.length || adopted.length) lines.push(L('Kinder: ', 'Children: ') + kids.map(plink).join(', ') + (adopted.length ? L(` (aufgenommen: ${adopted.map(plink).join(', ')})`, ` (taken in: ${adopted.map(plink).join(', ')})`) : ''));
  if (p.ofa) { const real = p.fa && rt.pById.get(p.fa); const off = rt.pById.get(p.ofa); lines.push(`<span class="secret">${L(`Offiziell Kind von ${off ? plink(off) : 'einem anderen'}, in Wahrheit von ${real ? plink(real) : 'jemand anderem'}.`, `Officially the child of ${off ? plink(off) : 'someone else'}, in truth of ${real ? plink(real) : 'another'}.`)}</span>`); }
  const ties = Object.entries(p.ties || {}).map(([id, v]) => [rt.pById.get(+id), v]).filter(([q]) => q && q.id !== p.pa).sort((a, b) => b[1] - a[1]);
  const friends = ties.filter(([, v]) => v > 25).slice(0, 6), enemies = ties.filter(([, v]) => v < -25).reverse().slice(0, 4);
  html += `<h4 class="isect">${L('Beziehungen', 'Relationships')}</h4><p class="fam">${lines.join(' ') || L('Allein, noch.', 'Alone, for now.')}</p>`;
  if (friends.length || enemies.length) {
    html += `<div class="ptie">${friends.map(([q, v]) => `<span>${plink(q)}</span>${bar(v / 100, 'green')}<em>${v > 70 ? L('enge Freundschaft', 'close friends') : L('Freundschaft', 'friends')}</em>`).join('')}${enemies.map(([q, v]) => `<span>${plink(q)}</span>${bar(-v / 100, 'red')}<em>${v < -70 ? L('Todfeinde', 'mortal enemies') : L('Feindschaft', 'enemies')}</em>`).join('')}</div>`;
  }
  return html;
}

// ---------- Siedlungsseite: Geld und Arbeit ----------

export function settlementEconomy(st, s, plink) {
  const cur = curOf(st, s), F = s.finY || s.fin || {};
  const rich = st.people.filter(p => p.s === s.id && ageOf(st, p) >= 14).sort((a, b) => wealthOf(st, b) - wealthOf(st, a)).slice(0, 3);
  const yr = s.yrLast || {};
  return `<h3 class="sect">${L('Geld und Arbeit', 'Money and Work')}</h3>
    <div class="stock">
      <div><b>${money(s.stock.gold)}</b><small>${L('Stadtkasse', 'Treasury')}</small></div>
      <div><b>${pct(taxRate(s))}</b><small>${L('Steuer', 'Tax')}</small></div>
      <div><b>${money(s.avgWage || 0)}</b><small>${L('Lohn am Tag', 'Daily wage')}</small></div>
      <div><b>${money(s.price ? s.price.food : 1)}</b><small>${L('Brot', 'Bread')}</small></div>
      <div><b>${pct(s.gini || 0)}</b><small>${L('Ungleichheit', 'Inequality')}</small></div>
      <div><b>${pct(s.unemp || 0)}</b><small>${L('ohne Arbeit', 'Jobless')}</small></div>
    </div>
    <p class="muted small">${L(`Beträge in ${esc(cur)}.`, `Amounts in ${esc(cur)}.`)} ${s.bank ? L(`Bank von ${esc(nameOf(st, s.bank.own) || 'der Stadt')}. `, `Bank of ${esc(nameOf(st, s.bank.own) || 'the town')}. `) : ''}${s.strike && s.strike.until > st.day ? L(`Streik in ${D.BUILDINGS[s.strike.t].name}! `, `Strike at the ${D.BUILDINGS[s.strike.t].name.toLowerCase()}! `) : ''}${yr.wed ? L(`${yr.wed} Hochzeiten`, `${yr.wed} ${yr.wed === 1 ? 'wedding' : 'weddings'}`) : ''}${yr.div ? L(`, ${yr.div} Scheidungen`, `, ${yr.div} ${yr.div === 1 ? 'divorce' : 'divorces'}`) : ''}${yr.wed || yr.div ? L(' im letzten Jahr. ', ' last year. ') : ''}${s.feuds && s.feuds.length ? L(`Fehden: ${s.feuds.map(f => esc(f.a) + ' gegen ' + esc(f.b)).join(', ')}.`, `Feuds: ${s.feuds.map(f => esc(f.a) + ' against ' + esc(f.b)).join(', ')}.`) : ''}</p>
    ${rich.length ? `<div class="people">${rich.map(p => `<button class="plink" data-pid="${p.id}">${esc(p.n)} · ${money(wealthOf(st, p))}</button>`).join('')}</div>` : ''}
    ${F.tax != null ? `<p class="muted small">${L(`Letztes Jahr: Steuern ${money(F.tax)}, Gehälter ${money(F.salary || 0)}, Sozialhilfe ${money(F.welfare || 0)}, Aufträge ${money(F.build || 0)}${F.mint > 1 ? `, neue Münzen ${money(F.mint)}` : ''}.`, `Last year: taxes ${money(F.tax)}, salaries ${money(F.salary || 0)}, welfare ${money(F.welfare || 0)}, public works ${money(F.build || 0)}${F.mint > 1 ? `, new coins ${money(F.mint)}` : ''}.`)}</p>` : ''}`;
}

// ---------- Reiter Menschen ----------

const FILTERS = [
  ['alle', L('Alle', 'All')], ['paare', L('Paare', 'Couples')], ['single', L('Allein', 'Single')], ['liebe', L('Verliebt', 'In love')],
  ['geschieden', L('Geschieden', 'Divorced')], ['witwe', L('Verwitwet', 'Widowed')], ['reich', L('Reiche', 'Rich')], ['arm', L('Arme', 'Poor')],
  ['feinde', L('Feinde', 'Enemies')], ['geheim', L('Geheimnisse', 'Secrets')], ['kinder', L('Kinder', 'Children')],
];

export function peopleTab(ui, st, body) {
  const P = ui.pp || (ui.pp = { sid: 0, q: '', sort: 'gold', f: 'alle', view: 'liste', n: 60 });
  const rt = st._rt;
  const sets = st.settlements.filter(s => s.alive);
  if (P.sid && !rt.sById.get(P.sid)?.alive) P.sid = 0;
  let pool = st.people.filter(p => !P.sid || p.s === P.sid);
  const q = P.q.trim().toLowerCase();
  if (q) pool = pool.filter(p => p.n.toLowerCase().includes(q) || (p.clan || '').toLowerCase().includes(q));
  const adult = p => ageOf(st, p) >= 14;
  const F = {
    paare: p => p.pa, single: p => adult(p) && !p.pa && !p.fi, liebe: p => p.lov || p.fi, geschieden: p => p.ex && p.ex.length, witwe: p => p.wid && !p.pa,
    reich: p => (p.cls ?? 1) >= 3, arm: p => p.cls === 0 && adult(p), feinde: p => (p.ne || 0) > 0, geheim: p => p.aff || p.ofa || p.sec || p.lov, kinder: p => !adult(p),
  }[P.f];
  if (F) pool = pool.filter(F);
  const sorts = {
    gold: (a, b) => wealthOf(st, b) - wealthOf(st, a), name: (a, b) => a.n.localeCompare(b.n), alter: (a, b) => a.b - b.b,
    freunde: (a, b) => (b.nf || 0) - (a.nf || 0) || (b.ne || 0) - (a.ne || 0),
  };
  pool.sort(sorts[P.sort] || sorts.gold);
  // Kennzahlen
  const base = st.people.filter(p => !P.sid || p.s === P.sid);
  const couples = base.filter(p => p.pa).length / 2, friendships = base.reduce((a, p) => a + (p.nf || 0), 0) / 2, feuds = base.reduce((a, p) => a + (p.ne || 0), 0) / 2;
  const affairs = base.filter(p => p.aff).length;
  const S = P.sid ? rt.sById.get(P.sid) : null;
  let html = `<div class="isle-chips"><button data-sid="0" class="${!P.sid ? 'on' : ''}">${L('Alle Orte', 'All places')}</button>${sets.map(s => `<button data-sid="${s.id}" class="${P.sid === s.id ? 'on' : ''}"><i style="background:${s.color}"></i>${esc(s.name)}</button>`).join('')}</div>
    <div class="pp-tools"><input id="ppq" type="search" placeholder="${L('Name oder Familie suchen', 'Search name or family')}" value="${esc(P.q)}">
      <select id="pps"><option value="gold">${L('nach Vermögen', 'by wealth')}</option><option value="name">${L('nach Name', 'by name')}</option><option value="alter">${L('nach Alter', 'by age')}</option><option value="freunde">${L('nach Freunden', 'by friends')}</option></select>
      <div class="seg2"><button data-v="liste" class="${P.view === 'liste' ? 'on' : ''}">${L('Liste', 'List')}</button><button data-v="netz" class="${P.view === 'netz' ? 'on' : ''}">${L('Netz', 'Network')}</button></div></div>
    <div class="pp-filters">${FILTERS.map(([k, n]) => `<button data-f="${k}" class="${P.f === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    <p class="muted small">${L(`${base.length} Menschen · ${couples} Paare · ${Math.round(friendships)} Freundschaften · ${Math.round(feuds)} Feindschaften${affairs ? ` · ${affairs} heimliche Affären, nur du siehst sie` : ''}`, `${base.length} people · ${couples} couples · ${Math.round(friendships)} friendships · ${Math.round(feuds)} feuds${affairs ? ` · ${affairs} secret affairs, only you can see them` : ''}`)}</p>`;
  // Tagebücher: Familiengeschichten über Generationen
  const diaries = st.diaries || [];
  if (diaries.length) html += `<div class="pdiaries">${diaries.map(d => { const cur = rt.pById.get(d.cur); return `<button class="pdiary" data-did="${d.id}"><b>${esc((rt.pById.get(d.line[0]) || cur || {}).clan || d.names[d.line[0]])}</b><small>${d.line.length} ${L(d.line.length === 1 ? 'Schreiber' : 'Schreiber', d.line.length === 1 ? 'writer' : 'writers')} · ${d.e.length} ${L('Einträge', 'entries')} · ${d.end ? L('beendet', 'ended') : esc(d.names[d.cur] || '')}</small></button>`; }).join('')}</div>`;
  if (P.view === 'netz') {
    const target = S || sets.slice().sort((a, b) => b.pop - a.pop)[0];
    html += `<div class="netwrap"><canvas id="net" width="1200" height="1000"></canvas><div id="nettip"></div></div>
      <p class="muted small">${S ? '' : L(`Gezeigt wird ${esc(target ? target.name : '')}, die größte Siedlung. Wähle oben einen Ort.`, `Showing ${esc(target ? target.name : '')}, the largest settlement. Pick a place above.`)}</p>
      <div class="netlegend"><span><i class="ln gold"></i>${L('Ehe', 'Marriage')}</span><span><i class="ln gold dash"></i>${L('Verlobt', 'Engaged')}</span><span><i class="ln green"></i>${L('Freundschaft', 'Friendship')}</span><span><i class="ln red"></i>${L('Feindschaft', 'Enmity')}</span><span><i class="ln pink dash"></i>${L('Affäre', 'Affair')}</span>
      ${CLASSES.map((c, i) => `<span><i class="dot" style="background:${CLS_COL[i]}"></i>${c}</span>`).join('')}<span>${L('Größe = Vermögen', 'Size = wealth')}</span></div>`;
    body.innerHTML = html;
    if (target) drawNetwork(ui, st, target);
  } else {
    const show = pool.slice(0, P.n);
    html += `<div class="plist">${show.map(p => row(st, p)).join('') || `<p class="muted">${L('Niemand passt.', 'Nobody matches.')}</p>`}</div>`;
    if (pool.length > P.n) html += `<button class="more">${L(`Weitere ${Math.min(60, pool.length - P.n)} von ${pool.length - P.n} zeigen`, `Show ${Math.min(60, pool.length - P.n)} more of ${pool.length - P.n}`)}</button>`;
    body.innerHTML = html;
  }
  // Bedienung
  body.querySelectorAll('[data-sid]').forEach(b => { b.onclick = () => { P.sid = +b.dataset.sid; P.n = 60; ui.netCache = null; ui.renderLeft(true); }; });
  body.querySelectorAll('[data-f]').forEach(b => { b.onclick = () => { P.f = b.dataset.f; P.n = 60; ui.renderLeft(true); }; });
  body.querySelectorAll('[data-v]').forEach(b => { b.onclick = () => { P.view = b.dataset.v; ui.renderLeft(true); }; });
  const sel = body.querySelector('#pps'); sel.value = P.sort; sel.onchange = () => { P.sort = sel.value; ui.renderLeft(true); };
  const inp = body.querySelector('#ppq');
  inp.oninput = () => { P.q = inp.value; P.n = 60; clearTimeout(ui.ppT); ui.ppT = setTimeout(() => { ui.renderLeft(true); const i2 = document.querySelector('#ppq'); if (i2) { i2.focus(); i2.setSelectionRange(i2.value.length, i2.value.length); } }, 220); };
  const more = body.querySelector('.more'); if (more) more.onclick = () => { P.n += 60; ui.renderLeft(true); };
  body.querySelectorAll('.prow').forEach(b => { b.onclick = () => ui.app.selectPerson(+b.dataset.pid, true); });
  body.querySelectorAll('.pdiary').forEach(b => { b.onclick = () => openDiary(ui.app, { id: +b.dataset.did }); });
}

function row(st, p) {
  const rt = st._rt, s = sOf(st, p);
  const age = Math.floor(ageOf(st, p));
  const pa = p.pa && rt.pById.get(p.pa), fi = p.fi && rt.pById.get(p.fi);
  const rel = [];
  if (pa) rel.push(`<span class="r-gold">${p.sec ? L('heimlich mit', 'secretly with') : L('verheiratet mit', 'married to')} ${esc(pa.n)}</span>`);
  else if (fi) rel.push(`<span class="r-gold">${L('verlobt mit', 'engaged to')} ${esc(fi.n)}</span>`);
  else if (p.wid) rel.push(`<span>${L('verwitwet', 'widowed')}</span>`);
  else if (p.ex && p.ex.length) rel.push(`<span>${L('geschieden', 'divorced')}</span>`);
  if (p.aff) rel.push(`<span class="r-pink">${L('Affäre', 'affair')}</span>`);
  if (p.lov && !p.fi && !p.pa) rel.push(`<span class="r-pink">${L('verliebt', 'in love')}</span>`);
  if (p.nf) rel.push(`<span class="r-green">${L(`${p.nf} ${p.nf === 1 ? 'Freund' : 'Freunde'}`, `${p.nf} ${p.nf === 1 ? 'friend' : 'friends'}`)}</span>`);
  if (p.ne) rel.push(`<span class="r-red">${L(`${p.ne} ${p.ne === 1 ? 'Feind' : 'Feinde'}`, `${p.ne} ${p.ne === 1 ? 'enemy' : 'enemies'}`)}</span>`);
  const w = wealthOf(st, p);
  return `<button class="prow" data-pid="${p.id}"><i class="pav" style="--c:${s ? s.color : '#999'}">${esc(p.n[0])}</i>
    <div class="pmain"><b>${esc(p.lt || p.title ? (p.lt || p.title) + ' ' : '')}${esc(p.n)}</b><small>${age} · ${esc(D.JOBS[p.job]?.name || p.job)}${s ? ' · ' + esc(s.name) : ''}</small><div class="prel">${rel.join('')}</div></div>
    <div class="pgold"><b>${money(w)}</b><small style="color:${CLS_COL[p.cls ?? 1]}">${ageOf(st, p) >= 14 ? CLASSES[p.cls ?? 1] : ''}</small></div></button>`;
}

// Beziehungsnetz einer Siedlung: Kräfte-Layout (einmal berechnet, gecacht), Menschen als Punkte, Bindungen als Linien
function drawNetwork(ui, st, s) {
  const cv = document.getElementById('net');
  if (!cv) return;
  const rt = st._rt;
  let C = ui.netCache;
  if (!C || C.sid !== s.id || st.day - C.day > 24) {
    let nodes = st.people.filter(p => p.s === s.id && ageOf(st, p) >= 14);
    if (nodes.length > 150) nodes = nodes.sort((a, b) => (Object.keys(b.ties || {}).length + (b.pa ? 4 : 0) + Math.log10(1 + Math.max(0, b.gold || 0))) - (Object.keys(a.ties || {}).length + (a.pa ? 4 : 0) + Math.log10(1 + Math.max(0, a.gold || 0)))).slice(0, 150);
    const idx = new Map(nodes.map((p, i) => [p.id, i]));
    const edges = [];
    for (const p of nodes) {
      const i = idx.get(p.id);
      for (const k in p.ties || {}) {
        const j = idx.get(+k);
        if (j == null || j <= i) continue;
        const v = p.ties[k];
        const q = nodes[j];
        const kind = p.pa === q.id ? 'pa' : p.fi === q.id ? 'fi' : (p.aff === q.id || q.aff === p.id) ? 'aff' : v > 20 ? 'f' : v < -20 ? 'e' : null;
        if (kind) edges.push([i, j, kind, v]);
      }
    }
    // Startpositionen nach Familie auf einem Kreis, dann Kräfte im Einheitsraum; am Ende auf die Fläche skaliert
    const n = nodes.length, W = 1200, H = 1000;
    const clans = [...new Set(nodes.map(p => p.clan))];
    const P = nodes.map((p, i) => { const a = (clans.indexOf(p.clan) / clans.length) * Math.PI * 2 + (i % 9) * 0.04; const r = 0.6 + (i % 5) * 0.05; return [Math.cos(a) * r, Math.sin(a) * r]; });
    const deg = new Array(n).fill(0);
    for (const [a, b] of edges) { deg[a]++; deg[b]++; }
    const rep = 0.0016 * 120 / Math.max(40, n);
    for (let it = 0; it < 300; it++) {
      const F = P.map(() => [0, 0]);
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
        const dx = P[a][0] - P[b][0], dy = P[a][1] - P[b][1], d2 = dx * dx + dy * dy + 1e-4;
        if (d2 > 0.25) continue;
        const f = rep / d2;
        F[a][0] += dx * f; F[a][1] += dy * f; F[b][0] -= dx * f; F[b][1] -= dy * f;
      }
      for (const [a, b, kind] of edges) {
        const dx = P[b][0] - P[a][0], dy = P[b][1] - P[a][1], d = Math.sqrt(dx * dx + dy * dy) + 1e-4;
        const L0 = kind === 'pa' || kind === 'fi' ? 0.05 : kind === 'e' ? 0.7 : 0.14;
        const f = (kind === 'e' ? 0.02 : 0.08) * (d - L0) / d;
        F[a][0] += dx * f; F[a][1] += dy * f; F[b][0] -= dx * f; F[b][1] -= dy * f;
      }
      const step = 0.6 * (1 - it / 300) + 0.05;
      for (let a = 0; a < n; a++) {
        const g = deg[a] ? 0.02 : 0.006;
        F[a][0] -= P[a][0] * g; F[a][1] -= P[a][1] * g;
        const m = Math.hypot(F[a][0], F[a][1]), lim = 0.05 * step;
        const k = m > lim ? lim / m : 1;
        P[a][0] += F[a][0] * k; P[a][1] += F[a][1] * k;
      }
    }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const sc = Math.min((W - 140) / Math.max(1e-3, x1 - x0), (H - 100) / Math.max(1e-3, y1 - y0));
    const pos = P.map(([x, y]) => [W / 2 + (x - (x0 + x1) / 2) * sc, H / 2 + (y - (y0 + y1) / 2) * sc]);
    C = ui.netCache = { sid: s.id, day: st.day, ids: nodes.map(p => p.id), pos, edges };
  }
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  const people = C.ids.map(id => rt.pById.get(id));
  const COL = { pa: 'rgba(233,180,76,0.95)', fi: 'rgba(233,180,76,0.8)', aff: 'rgba(240,130,170,0.9)', f: 'rgba(140,200,130,', e: 'rgba(225,95,80,' };
  for (const [a, b, kind, v] of C.edges) {
    if (!people[a] || !people[b]) continue;
    g.beginPath(); g.moveTo(C.pos[a][0], C.pos[a][1]); g.lineTo(C.pos[b][0], C.pos[b][1]);
    g.setLineDash(kind === 'fi' || kind === 'aff' ? [10, 8] : []);
    g.lineWidth = kind === 'pa' ? 4.5 : kind === 'fi' || kind === 'aff' ? 3 : 1.2 + Math.abs(v) / 50;
    g.strokeStyle = kind === 'f' || kind === 'e' ? COL[kind] + (0.18 + Math.abs(v) / 160).toFixed(2) + ')' : COL[kind];
    g.stroke();
  }
  g.setLineDash([]);
  const leader = s.gov.leader;
  const rad = p => 7 + Math.min(16, Math.log10(1 + Math.max(0, wealthOf(st, p))) * 4.5);
  const label = new Set(people.filter(Boolean).sort((a, b) => wealthOf(st, b) - wealthOf(st, a)).slice(0, 10).map(p => p.id));
  if (leader) label.add(leader);
  people.forEach((p, i) => {
    if (!p) return;
    const [x, y] = C.pos[i], r = rad(p);
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = CLS_COL[p.cls ?? 1]; g.fill();
    g.lineWidth = p.id === leader ? 4 : 2; g.strokeStyle = p.id === leader ? '#fff' : 'rgba(20,30,40,0.55)'; g.stroke();
    if (label.has(p.id)) { g.font = '600 22px Manrope, sans-serif'; g.fillStyle = 'rgba(255,250,240,0.95)'; g.fillText(p.n, x + r + 5, y + 7); }
  });
  // Hover und Klick
  const tip = document.getElementById('nettip');
  const hit = ev => {
    const rc = cv.getBoundingClientRect(), x = (ev.clientX - rc.left) * cv.width / rc.width, y = (ev.clientY - rc.top) * cv.height / rc.height;
    let best = -1, bd = 1e9;
    people.forEach((p, i) => { if (!p) return; const d = Math.hypot(C.pos[i][0] - x, C.pos[i][1] - y); if (d < rad(p) + 10 && d < bd) { bd = d; best = i; } });
    return best;
  };
  cv.onmousemove = ev => {
    const i = hit(ev);
    if (i < 0) { tip.style.opacity = 0; cv.style.cursor = ''; return; }
    const p = people[i], pa = p.pa && rt.pById.get(p.pa);
    tip.innerHTML = `<b>${esc(p.n)}</b> · ${Math.floor(ageOf(st, p))} · ${esc(D.JOBS[p.job]?.name || '')}<br>${money(wealthOf(st, p))} ${esc(curOf(st, s))} · ${CLASSES[p.cls ?? 1]}${pa ? '<br>' + L('verheiratet mit ', 'married to ') + esc(pa.n) : ''}${p.nf ? '<br>' + L(`${p.nf} Freunde`, `${p.nf} friends`) : ''}${p.ne ? ', ' + L(`${p.ne} Feinde`, `${p.ne} enemies`) : ''}`;
    const rc = cv.getBoundingClientRect();
    tip.style.left = (ev.clientX - rc.left + 14) + 'px'; tip.style.top = (ev.clientY - rc.top + 10) + 'px'; tip.style.opacity = 1;
    cv.style.cursor = 'pointer';
  };
  cv.onmouseleave = () => { tip.style.opacity = 0; };
  cv.onclick = ev => { const i = hit(ev); if (i >= 0 && people[i]) ui.app.selectPerson(people[i].id, true); };
}

// ---------- Reiter Wirtschaft ----------

export function economyTab(ui, st, body) {
  const rt = st._rt;
  const E = ui.ec || (ui.ec = { sid: 0 });
  const sets = st.settlements.filter(s => s.alive);
  let S = E.sid ? rt.sById.get(E.sid) : null;
  if (!S || !S.alive) S = sets.slice().sort((a, b) => b.pop - a.pop)[0];
  if (!S) { body.innerHTML = ''; return; }
  const cur = curOf(st, S), F = S.finY || S.fin || {};
  // Inseln: Geld, Preisniveau, Inflation, Kaufkraft
  const isles = st.isles.filter(I => sets.some(s => s.isle === I.id));
  const myI = rt.iById.get(S.isle);
  let html = `<h3 class="sect">${L('Geld der Inseln', 'Money of the Islands')}</h3><div class="ecisles">${isles.map(I => {
    const infl = (I.infl || 0) * 100;
    const pp = myI && I !== myI ? (myI.pl || 1) / (I.pl || 1) : 1;
    return `<div class="ecisle"><b>${esc(I.name)}</b><span>${I.cur ? L(`${esc(I.cur.n)}${I.cur.from ? ' (von Siedlern)' : ''}`, `${esc(I.cur.n)}${I.cur.from ? ' (from settlers)' : ''}`) : L('Muscheln, Tausch', 'Shells, barter')}</span>
      <small>${L('Preisniveau', 'Price level')} ${Math.round((I.pl || 1) * 100)} · ${L('Teuerung', 'Inflation')} <em class="${infl > 8 ? 'up' : infl < -5 ? 'down' : ''}">${infl >= 0 ? '+' : ''}${infl.toFixed(1)}%</em>${myI && I !== myI ? ` · ${L(`1 ${esc(curOf(st, sets.find(s => s.isle === myI.id)))} = ${pp.toFixed(2)} hier`, `1 ${esc(curOf(st, sets.find(s => s.isle === myI.id)))} = ${pp.toFixed(2)} here`)}` : ''}</small></div>`;
  }).join('')}</div>`;
  html += `<div class="isle-chips">${sets.map(s => `<button data-sid="${s.id}" class="${s === S ? 'on' : ''}"><i style="background:${s.color}"></i>${esc(s.name)}</button>`).join('')}</div>`;
  // Preise
  const pl = myI ? myI.pl || 1 : 1;
  html += `<h3 class="sect">${L(`Preise in ${esc(S.name)}`, `Prices in ${esc(S.name)}`)}</h3><div class="ecprices">${GOODS.map(g => {
    const p = S.price ? S.price[g] : BASE[g], norm = p / (BASE[g] * pl);
    return `<div><small>${GOOD_NAME[g]}</small><b>${money(p)}</b><em class="${norm > 1.4 ? 'up' : norm < 0.7 ? 'down' : ''}">${norm > 1.4 ? L('knapp', 'scarce') : norm < 0.7 ? L('reichlich', 'plenty') : L('normal', 'normal')}</em><small>${L('Vorrat', 'Stock')} ${Math.floor(S.stock[g] || 0)}</small></div>`;
  }).join('')}</div><p class="muted small">${L(`In ${esc(cur)}. Die Preise folgen Vorrat und Nachfrage und dem Geld, das auf der Insel umläuft.`, `In ${esc(cur)}. Prices follow stock and demand, and the money circulating on the island.`)}</p>`;
  // Löhne nach Beruf
  const M = st.people.filter(p => p.s === S.id && ageOf(st, p) >= 14 && ageOf(st, p) < 64);
  const byJob = {};
  for (const p of M) { const j = byJob[p.job] || (byJob[p.job] = { n: 0, inc: 0 }); j.n++; j.inc += p.inc || 0; }
  const jobs = Object.entries(byJob).map(([k, v]) => [k, v.n, v.inc / v.n]).sort((a, b) => b[2] - a[2]);
  const maxInc = Math.max(0.01, ...jobs.map(j => j[2]));
  html += `<h3 class="sect">${L('Löhne nach Beruf', 'Wages by Job')}</h3><div class="ecjobs">${jobs.map(([k, n, inc]) => `<span>${esc(D.JOBS[k]?.name || k)} <small>${n}</small></span>${bar(inc / maxInc, 'gold')}<em>${money(inc)}</em>`).join('')}</div>
    <p class="muted small">${L('Einkommen pro Tag im Schnitt (Lohn, Gewinn, Miete). Staatsdiener bekommen ihr Gehalt aus der Stadtkasse', 'Average income per day (wages, profit, rent). Public servants are paid from the treasury')}${S.budget != null && S.budget < 0.98 ? L(`, gerade nur ${pct(S.budget)} davon.`, `, currently only ${pct(S.budget)} of it.`) : '.'}</p>`;
  // Haushalt
  const rows = [
    [L('Steuern und Gebühren', 'Taxes and fees'), F.tax || 0, 1], [L('Zölle und Tribut', 'Tariffs and tribute'), F.tariff || 0, 1],
    [L('Neue Münzen', 'New coins'), F.mint || 0, 1], [L('Gehälter', 'Salaries'), F.salary || 0, -1], [L('Sozialhilfe', 'Welfare'), F.welfare || 0, -1], [L('Bauten und Aufträge', 'Buildings and works'), F.build || 0, -1],
  ].filter(r => r[1] > 0.5);
  const debt = S.bonds ? S.bonds.reduce((a, b) => a + b.amt, 0) : 0;
  html += `<h3 class="sect">${L('Stadtkasse', 'Treasury')}</h3><div class="stock"><div><b>${money(S.stock.gold)}</b><small>${L('in der Kasse', 'in the treasury')}</small></div><div><b>${pct(taxRate(S))}</b><small>${L('Steuersatz', 'Tax rate')}</small></div><div><b>${money(debt)}</b><small>${L('Staatsschulden', 'State debt')}</small></div></div>
    <div class="ecbudget">${rows.map(([n, v, sg]) => `<span>${n}</span><em class="${sg > 0 ? 'in' : 'out'}">${sg > 0 ? '+' : '-'}${money(v)}</em>`).join('') || `<p class="muted small">${L('Nach dem ersten Jahr erscheint hier der Haushalt.', 'The budget appears here after the first year.')}</p>`}</div>`;
  // Wirtschaft des Ortes
  html += `<div class="stock"><div><b>${money(F.wage || 0)}</b><small>${L('Löhne', 'Wages')}</small></div><div><b>${money(F.profit || 0)}</b><small>${L('Gewinne', 'Profits')}</small></div><div><b>${money(F.rent || 0)}</b><small>${L('Mieten', 'Rents')}</small></div>
    <div><b>${money(F.lux || 0)}</b><small>${L('Luxus', 'Luxury')}</small></div><div><b>${money(F.exp || 0)}</b><small>${L('Ausfuhr', 'Exports')}</small></div><div><b>${money(F.imp || 0)}</b><small>${L('Einfuhr', 'Imports')}</small></div></div>`;
  // Vermögen
  const all = st.people.filter(p => p.s === S.id && ageOf(st, p) >= 14);
  const cls = [0, 0, 0, 0, 0]; for (const p of all) cls[p.cls ?? 1]++;
  html += `<h3 class="sect">${L('Wer hat wie viel', 'Who Owns What')}</h3><canvas id="lorenz" width="560" height="200"></canvas>
    <div class="facbar">${cls.map((n, i) => `<i style="flex:${n + 0.001};background:${CLS_COL[i]}" title="${CLASSES[i]} ${n}"></i>`).join('')}</div>
    <div class="faclegend">${cls.map((n, i) => n ? `<span><i style="background:${CLS_COL[i]}"></i>${CLASSES[i]} ${n}</span>` : '').join('')}</div>
    <p class="muted small">${L(`Ungleichheit (Gini) ${pct(S.gini || 0)}. Die reichsten zehn Prozent besitzen ${pct(S.top10 || 0)} von allem.`, `Inequality (Gini) ${pct(S.gini || 0)}. The richest ten percent own ${pct(S.top10 || 0)} of everything.`)}</p>`;
  const rich = all.slice().sort((a, b) => wealthOf(st, b) - wealthOf(st, a)).slice(0, 10);
  html += `<div class="plist">${rich.map(p => row(st, p)).join('')}</div>`;
  // Schulden und Bank
  const debtors = all.filter(p => p.debt > 0.5);
  const credSum = {};
  for (const p of debtors) { const k = p.cred < 0 ? 'bank' : p.cred; credSum[k] = (credSum[k] || 0) + p.debt; }
  const creds = Object.entries(credSum).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k === 'bank' ? L('die Bank', 'the bank') : esc(nameOf(st, +k) || '?')} ${money(v)}`);
  html += `<h3 class="sect">${L('Schulden und Bank', 'Debt and Bank')}</h3><p class="fam">${debtors.length ? L(`${debtors.length} Menschen haben Schulden, zusammen ${money(debtors.reduce((a, p) => a + p.debt, 0))} ${esc(cur)}${debtors.filter(p => p.bond).length ? `, ${debtors.filter(p => p.bond).length} davon in Schuldknechtschaft` : ''}. Die größten Gläubiger: ${creds.join(', ')}.`, `${debtors.length} people are in debt, ${money(debtors.reduce((a, p) => a + p.debt, 0))} ${esc(cur)} in total${debtors.filter(p => p.bond).length ? `, ${debtors.filter(p => p.bond).length} of them in debt bondage` : ''}. Biggest creditors: ${creds.join(', ')}.`) : L('Niemand hat Schulden.', 'Nobody is in debt.')} ${S.bank ? L(`Die Bank von ${esc(nameOf(st, S.bank.own) || 'der Stadt')} hält ${money(S.bank.dep || 0)} an Einlagen und ${money(S.bank.res)} in der Kasse${S.laws.includes('zinsverbot') ? ', Zinsen sind verboten' : ''}.`, `The bank of ${esc(nameOf(st, S.bank.own) || 'the town')} holds ${money(S.bank.dep || 0)} in deposits and ${money(S.bank.res)} in reserve${S.laws.includes('zinsverbot') ? ', interest is forbidden' : ''}.`) : L('Noch gibt es keine Bank.', 'There is no bank yet.')}</p>`;
  // Handel
  const flows = (st.flows || []).filter(f => !E.sid || f.a === S.id || f.b === S.id).slice(0, 14);
  const routes = (st.routes || []).slice().sort((a, b) => b.val - a.val).slice(0, 10);
  html += `<h3 class="sect">${L('Handel', 'Trade')}</h3>${routes.length ? `<div class="ecroutes">${routes.map(r => { const a = rt.sById.get(r.a), b = rt.sById.get(r.b); return a && b ? `<span><i style="background:${a.color}"></i>${esc(a.name)} ${r.sea ? '⛵' : '↔'} <i style="background:${b.color}"></i>${esc(b.name)}</span><em>${money(r.val)}</em>` : ''; }).join('')}</div>` : `<p class="muted small">${L('Noch handelt niemand über Ortsgrenzen hinweg.', 'Nobody trades across town borders yet.')}</p>`}
    ${flows.length ? `<div class="ecflows">${flows.map(f => { const a = rt.sById.get(f.a), b = rt.sById.get(f.b); return a && b ? `<span>${esc(a.name)} → ${esc(b.name)}</span><span>${f.v} ${GOOD_NAME[f.g]}</span><em>${money(f.val)}</em>` : ''; }).join('')}</div>` : ''}`;
  // Weltweit die Reichsten
  const world = st.people.filter(p => ageOf(st, p) >= 14).sort((a, b) => wealthOf(st, b) - wealthOf(st, a)).slice(0, 8);
  html += `<h3 class="sect">${L('Die Reichsten der Welt', 'The Richest in the World')}</h3><div class="plist">${world.map(p => row(st, p)).join('')}</div>`;
  body.innerHTML = html;
  body.querySelectorAll('[data-sid]').forEach(b => { b.onclick = () => { E.sid = +b.dataset.sid; ui.renderLeft(true); }; });
  body.querySelectorAll('.prow').forEach(b => { b.onclick = () => ui.app.selectPerson(+b.dataset.pid, true); });
  drawLorenz(st, all);
}

// Lorenzkurve: wie weit die Verteilung von "alle gleich" entfernt ist
function drawLorenz(st, all) {
  const cv = document.getElementById('lorenz');
  if (!cv) return;
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, pad = 24;
  g.clearRect(0, 0, W, H);
  const w = all.map(p => Math.max(0, wealthOf(st, p))).sort((a, b) => a - b);
  const tot = w.reduce((a, b) => a + b, 0) || 1;
  g.strokeStyle = 'rgba(246,239,226,0.25)'; g.lineWidth = 1.5; g.setLineDash([6, 6]);
  g.beginPath(); g.moveTo(pad, H - pad); g.lineTo(W - pad, pad); g.stroke(); g.setLineDash([]);
  g.beginPath(); g.moveTo(pad, H - pad);
  let cum = 0;
  w.forEach((v, i) => { cum += v; g.lineTo(pad + (i + 1) / w.length * (W - 2 * pad), H - pad - cum / tot * (H - 2 * pad)); });
  g.lineTo(W - pad, H - pad); g.closePath();
  g.fillStyle = 'rgba(233,180,76,0.18)'; g.fill();
  g.strokeStyle = '#e9b44c'; g.lineWidth = 2.5; g.stroke();
  g.fillStyle = 'rgba(246,239,226,0.7)'; g.font = '600 12px Manrope, sans-serif';
  g.fillText(L('ärmste', 'poorest'), pad, H - 6); g.fillText(L('reichste', 'richest'), W - pad - 48, H - 6);
  g.fillText(L('Anteil am Vermögen', 'Share of wealth'), pad, 14);
}
