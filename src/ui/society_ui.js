// Inselbuch, Reiter Gesellschaft (seit 20.10.2026): Völker, Glaube, Seuchen, Wanderung. Daten aus src/sim/peoples.js,
// faith.js, epidemic.js, migration.js und der Zeitreihe st.lab (lab.js). Frei stehend wie die anderen Reiter.
// Dazu Diagramme als kleines SVG (stackSvg, lineSvg), die auch das Labor (lab_ui.js) nutzt.
import * as D from '../sim/data.js';
import { yearOf, ageOf } from '../sim/util.js';
import { mix, top, tolerance, segregation } from '../sim/peoples.js';
import { TENETS, KIND_NAME } from '../sim/faith.js';
import { dzName, dzCol, seirCounts } from '../sim/epidemic.js';
import { rigName, PRESTIGE } from '../sim/mobility.js';
import { L } from '../i18n.js';

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = v => Math.round(v * 100) + '%';
const bar = (v, col) => `<span class="sobar"><i style="width:${Math.max(0, Math.min(100, v * 100)).toFixed(0)}%;${col ? `background:${col}` : ''}"></i></span>`;
export const CLS_NAME = [L('arm', 'poor'), L('einfach', 'common'), L('wohlhabend', 'well-off'), L('reich', 'rich'), L('Adel', 'nobility')];
export const CLS_COL = ['#8fa3b8', '#e8dcc6', '#7fc4b4', '#e9b44c', '#b388eb'];
export const SEIR_NAME = [L('gesund', 'susceptible'), L('angesteckt', 'exposed'), L('krank', 'infectious'), L('immun', 'immune')];
export const SEIR_COL = ['#7fc4b4', '#e9c46a', '#e07a5f', '#8a9bd4'];
const WAY = { luft: L('Luft', 'air'), wasser: L('Wasser', 'water'), ratten: L('Ratten und Flöhe', 'rats and fleas'), muecken: L('Mücken', 'mosquitoes') };
export const wayName = w => WAY[w] || w;
export const ogName = o => (o ? L(`die ${o.n}`, `the ${o.n}`) : L('unbekannt', 'unknown'));

// ---------- Diagramme ----------

// Gestapelte Flächen: rows = [{ v: [Zahlen], col, name }], gleiche Länge. Prozent = true normiert jede Spalte auf 1
export function stackSvg(rows, { w = 560, h = 110, pctMode = false, t } = {}) {
  const n = rows.length ? rows[0].v.length : 0;
  if (n < 2) return `<div class="sochart empty">${L('Noch keine Messwerte. Die Zeitreihe wächst alle 6 Tage.', 'No data yet. The series grows every 6 days.')}</div>`;
  const tot = new Array(n).fill(0);
  for (const r of rows) r.v.forEach((x, i) => { tot[i] += x; });
  const max = pctMode ? 1 : Math.max(1, ...tot);
  const X = i => (i / (n - 1)) * w;
  const base = new Array(n).fill(0);
  let paths = '';
  for (const r of rows) {
    const top = r.v.map((x, i) => base[i] + (pctMode ? (tot[i] ? x / tot[i] : 0) : x));
    const up = top.map((y, i) => `${X(i).toFixed(1)},${(h - y / max * h).toFixed(1)}`).join(' ');
    const dn = base.map((y, i) => `${X(i).toFixed(1)},${(h - y / max * h).toFixed(1)}`).reverse().join(' ');
    paths += `<polygon points="${up} ${dn}" fill="${r.col}" opacity="0.85"><title>${esc(r.name)}</title></polygon>`;
    for (let i = 0; i < n; i++) base[i] = top[i];
  }
  return `<svg class="sochart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${paths}</svg>${axis(t)}`;
}

// Linien: rows = [{ v, col, name }]
export function lineSvg(rows, { w = 560, h = 110, t } = {}) {
  const n = rows.length ? rows[0].v.length : 0;
  if (n < 2) return `<div class="sochart empty">${L('Noch keine Messwerte.', 'No data yet.')}</div>`;
  const max = Math.max(1, ...rows.flatMap(r => r.v));
  const X = i => (i / (n - 1)) * w;
  let out = '';
  for (const r of rows) out += `<polyline points="${r.v.map((y, i) => `${X(i).toFixed(1)},${(h - 2 - y / max * (h - 4)).toFixed(1)}`).join(' ')}" fill="none" stroke="${r.col}" stroke-width="1.6" vector-effect="non-scaling-stroke"><title>${esc(r.name)}</title></polyline>`;
  return `<svg class="sochart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${out}</svg>${axis(t, max)}`;
}

function axis(t, max) {
  if (!t || t.length < 2) return '';
  return `<div class="soaxis"><span>${L('Jahr', 'Year')} ${yearOf(t[0])}</span>${max ? `<span>${L('bis', 'up to')} ${Math.round(max)}</span>` : ''}<span>${L('Jahr', 'Year')} ${yearOf(t[t.length - 1])}</span></div>`;
}

export const legend = rows => `<div class="solegend">${rows.map(r => `<span><i style="background:${r.col}"></i>${esc(r.name)}</span>`).join('')}</div>`;

// Reihen aus der Zeitreihe st.lab
export function labRows(st, which) {
  const Lb = st.lab || {}, rt = st._rt;
  if (!Lb.t) return [];
  if (which === 'og') return Object.entries(Lb.og || {}).map(([k, v]) => { const o = rt.ogById.get(+k); return { v, col: o ? o.col : '#999', name: o ? o.n : '?' }; }).sort((a, b) => b.v[b.v.length - 1] - a.v[a.v.length - 1]);
  if (which === 'rl') return Object.entries(Lb.rl || {}).map(([k, v]) => { const f = rt.fById.get(+k); return { v, col: f ? f.col : '#666', name: f ? f.n : L('ohne Glauben', 'no faith') }; }).sort((a, b) => b.v[b.v.length - 1] - a.v[a.v.length - 1]);
  if (which === 'cls') return (Lb.cls || []).map((v, i) => ({ v, col: CLS_COL[i], name: CLS_NAME[i] }));
  if (which === 'seir') return (Lb.seir || []).map((v, i) => ({ v, col: SEIR_COL[i], name: SEIR_NAME[i] }));
  if (which === 'dead') {
    const C = { Seuche: '#e07a5f', Alter: '#8a9bd4', Hunger: '#c9a227', Krieg: '#c46b4a', Fieber: '#e9c46a', Verfolgung: '#b388eb' };
    return Object.entries(Lb.dead || {}).map(([k, v]) => ({ v, col: C[k] || '#9aa3a8', name: causeLabel(k) })).sort((a, b) => b.v.reduce((x, y) => x + y, 0) - a.v.reduce((x, y) => x + y, 0)).slice(0, 7);
  }
  if (which === 'mob') return [{ v: (Lb.mob ? Lb.mob[0] : []).map(x => x / 10), col: '#7fc4b4', name: L('Aufsteiger in Prozent', 'risers in percent') }, { v: (Lb.mob ? Lb.mob[1] : []).map(x => x / 10), col: '#e07a5f', name: L('Absteiger in Prozent', 'fallers in percent') }];
  if (which === 'mig') return [{ v: Lb.mig ? Lb.mig[0] : [], col: '#7fc4b4', name: L('Umzüge', 'moves') }, { v: Lb.mig ? Lb.mig[1] : [], col: '#e07a5f', name: L('davon Flucht', 'of which fleeing') }];
  return [];
}
const CAUSE = {
  Alter: L('Alter', 'Old age'), Fieber: L('Fieber', 'Fever'), Hunger: L('Hunger', 'Hunger'), 'Schwäche': L('Schwäche', 'Frailty'), 'Unglück': L('Unglück', 'Accident'),
  Krieg: L('Krieg', 'War'), Seuche: L('Seuche', 'Plague'), Verfolgung: L('Verfolgung', 'Persecution'), Streit: L('Streit', 'Quarrel'), Aufstand: L('Aufstand', 'Uprising'), See: L('See', 'At sea'),
};
export const causeLabel = k => CAUSE[k] || k;

// ---------- Reiter ----------

const SUB = [['voelker', L('Völker', 'Peoples')], ['glaube', L('Glaube', 'Faith')], ['schichten', L('Schichten', 'Classes')], ['seuchen', L('Seuchen', 'Epidemics')], ['wanderung', L('Wanderung', 'Migration')]];

export function societyTab(ui, st, body) {
  const S = ui.soc || (ui.soc = { tab: 'voelker' });
  let html = `<div class="isle-chips sosub">${SUB.map(([k, n]) => `<button data-sub="${k}" class="${k === S.tab ? 'on' : ''}">${n}</button>`).join('')}<button class="solab" data-lab="1">${L('Labor öffnen', 'Open lab')}</button></div>`;
  if (!st.origins) { body.innerHTML = html; return; }
  if (S.tab === 'voelker') html += peoplesHtml(st);
  else if (S.tab === 'glaube') html += faithHtml(st);
  else if (S.tab === 'schichten') html += classHtml(st);
  else if (S.tab === 'seuchen') html += plagueHtml(st);
  else html += migrationHtml(st);
  body.innerHTML = html;
  body.querySelectorAll('[data-sub]').forEach(b => { b.onclick = () => { S.tab = b.dataset.sub; societyTab(ui, st, body); }; });
  const lb = body.querySelector('[data-lab]');
  if (lb) lb.onclick = () => ui.app.openLab && ui.app.openLab();
  body.querySelectorAll('[data-sid]').forEach(b => { b.onclick = () => { const s = st._rt.sById.get(+b.dataset.sid); if (s) ui.app.focus(s.cx, s.cy, 45); }; });
}

function peoplesHtml(st) {
  const rt = st._rt, N = Math.max(1, st.people.length);
  const sets = st.settlements.filter(s => s.alive && s.pop);
  let html = `<h3 class="sect">${L('Herkunft der Menschen', 'Origins of the People')}</h3>`;
  const rows = labRows(st, 'og');
  html += stackSvg(rows, { pctMode: true, t: st.lab.t }) + legend(rows);
  const cnt = new Map(), lg = new Map(), mg1 = new Map(), mg2 = new Map();
  for (const p of st.people) {
    cnt.set(p.og, (cnt.get(p.og) || 0) + 1);
    lg.set(p.lg, (lg.get(p.lg) || 0) + 1);
    if (p.mg === 1) mg1.set(p.og, (mg1.get(p.og) || 0) + 1);
    if (p.mg === 2) mg2.set(p.og, (mg2.get(p.og) || 0) + 1);
  }
  html += `<div class="sorows">`;
  for (const o of st.origins.slice().sort((a, b) => (cnt.get(b.id) || 0) - (cnt.get(a.id) || 0))) {
    const c = cnt.get(o.id) || 0;
    if (!c) continue;
    const where = sets.map(s => [s, mix(st, s).og.get(o.id) || 0]).filter(x => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const speak = lg.get(o.lang) || 0;
    html += `<div class="sorow"><b><i style="background:${o.col}"></i>${esc(ogName(o))}</b><span>${c}</span>${bar(c / N, o.col)}
      <small>${L(`Sprache der ${esc(o.n)}: ${speak} sprechen sie`, `Language of the ${esc(o.n)}: ${speak} speak it`)}${mg1.get(o.id) ? L(` · ${mg1.get(o.id)} zugezogen`, ` · ${mg1.get(o.id)} immigrated`) : ''}${mg2.get(o.id) ? L(` · ${mg2.get(o.id)} in zweiter Generation`, ` · ${mg2.get(o.id)} second generation`) : ''}<br>${where.map(([s, n]) => `<a data-sid="${s.id}">${esc(s.name)}</a> ${n}`).join(' · ')}</small></div>`;
  }
  html += `</div><h3 class="sect">${L('Wer wo lebt', 'Who Lives Where')}</h3><div class="sorows">`;
  for (const s of sets.slice().sort((a, b) => b.pop - a.pop)) {
    const m = mix(st, s), n = Math.max(1, m.n);
    const parts = [...m.og].sort((a, b) => b[1] - a[1]);
    const stack = `<span class="sostack">${parts.map(([k, c]) => { const o = rt.ogById.get(k); return `<i style="width:${(c / n * 100).toFixed(1)}%;background:${o ? o.col : '#999'}" title="${esc(o ? o.n : '?')} ${c}"></i>`; }).join('')}</span>`;
    const seg = parts.length > 1 ? segregation(st, s) : 0;
    const tol = tolerance(st, s);
    html += `<div class="sorow"><b><a data-sid="${s.id}">${esc(s.name)}</a></b><span>${s.pop}</span>${stack}
      <small>${L('Toleranz', 'Tolerance')} ${pct(tol)}${m.mg ? L(` · ${m.mg} Zugezogene und ihre Kinder`, ` · ${m.mg} immigrants and their children`) : ''}${parts.length > 1 ? ` · ${seg > 0.45 ? L('eigene Viertel', 'separate quarters') : seg > 0.25 ? L('halb gemischt', 'partly mixed') : L('gemischt', 'mixed')} (${pct(seg)})` : ''}${['gastrecht', 'abschottung', 'einbuergerung'].filter(l => s.laws.includes(l)).map(l => ' · ' + esc(D.LAWS[l].name)).join('')}</small></div>`;
  }
  html += `</div><p class="muted small">${L('Herkunft erbt man, Sprache lernt man. Kinder von Zugezogenen sprechen nach einer Generation meist die Sprache des Ortes. Wie getrennt die Menschen wohnen, zeigt der Wert hinter dem Ort (0 gemischt, 100 ganz getrennt).', 'Origin is inherited, language is learned. Children of immigrants usually speak the local language after one generation. How separately people live is shown by the value behind each place (0 mixed, 100 fully separate).')}</p>`;
  return html;
}

// Schichten und Aufstieg (mobility.js): Anteile über die Zeit, Aufsteiger und Absteiger, Ständeordnung je Ort
function classHtml(st) {
  const sets = st.settlements.filter(s => s.alive && s.pop);
  const rows = labRows(st, 'cls');
  let html = `<h3 class="sect">${L('Schichten über die Zeit', 'Classes over Time')}</h3>` + stackSvg(rows, { pctMode: true, t: st.lab.t }) + legend(rows);
  const mob = labRows(st, 'mob');
  html += `<h3 class="sect">${L('Aufstieg und Abstieg', 'Rising and Falling')}</h3>` + lineSvg(mob, { t: st.lab.t }) + legend(mob);
  html += `<div class="sorows">`;
  for (const s of sets.slice().sort((a, b) => b.pop - a.pop)) {
    const m = s.mob || { up: 0, down: 0, n: 0, blocked: 0 }, n = Math.max(1, m.n), rig = s.rig ?? 0.45;
    const elite = st.people.filter(p => p.s === s.id && PRESTIGE.has(p.job));
    const low = elite.filter(p => (p.oc ?? p.cls ?? 1) <= 1).length;
    html += `<div class="sorow"><b><a data-sid="${s.id}">${esc(s.name)}</a></b><span>${s.pop}</span>${bar(rig, rig >= 0.6 ? '#b388eb' : rig >= 0.35 ? '#e9c46a' : '#7fc4b4')}
      <small>${rigName(rig)} (${pct(rig)}) · ${L('Aufsteiger', 'risers')} ${pct(m.up / n)} · ${L('Absteiger', 'fallers')} ${pct(m.down / n)}${m.blocked ? L(` · ${m.blocked} Gebildete ohne Aussicht`, ` · ${m.blocked} educated without prospects`) : ''}<br>${L(`Angesehene Berufe: ${elite.length}, davon ${low} aus einfachem Haus`, `Respected trades: ${elite.length}, ${low} of them from a simple home`)} · Gini ${pct(s.gini || 0)}${s.laws.includes('staende') ? ' · ' + esc(D.LAWS.staende.name) : ''}${s.laws.includes('schulpflicht') ? ' · ' + esc(D.LAWS.schulpflicht.name) : ''}</small></div>`;
  }
  html += `</div><p class="muted small">${L('Die Schicht kommt aus dem Vermögen, die Herkunft aus der Familie bei der Geburt. In strengen Ständeordnungen (Königtum, Theokratie, viel Tradition, Gesetz Ständeordnung) werden Gelehrte, Heiler, Händler und Priester fast nur Kinder der Oberen, Kinder übernehmen den Beruf der Eltern und heiraten unter ihresgleichen. Schule öffnet die Tür, Schulpflicht und Erbschaftssteuer machen die Gesellschaft durchlässiger. Wer gebildet ist und unten bleibt, murrt.', 'Class comes from wealth, origin from the family at birth. Under rigid estate orders (monarchy, theocracy, strong tradition, the Estate Order law) scholars, healers, merchants and priests come almost only from the upper ranks, children follow their parents trade and marry their own kind. School opens the door, compulsory schooling and inheritance tax make society more permeable. Whoever is educated and stays low grumbles.')}</p>`;
  return html;
}

function faithHtml(st) {
  const rt = st._rt, N = Math.max(1, st.people.length);
  const sets = st.settlements.filter(s => s.alive && s.pop);
  const cnt = new Map();
  for (const p of st.people) cnt.set(p.rl || 0, (cnt.get(p.rl || 0) || 0) + 1);
  let html = `<h3 class="sect">${L('Glaube über die Zeit', 'Faith over Time')}</h3>`;
  const rows = labRows(st, 'rl');
  html += stackSvg(rows, { pctMode: true, t: st.lab.t }) + legend(rows.slice(0, 8));
  html += `<div class="sorows">`;
  const live = st.faiths.filter(f => cnt.get(f.id)).sort((a, b) => cnt.get(b.id) - cnt.get(a.id));
  for (const f of live) {
    const c = cnt.get(f.id);
    const from = f.from && rt.fById.get(f.from);
    const holy = f.s && rt.sById.get(f.s);
    const state = sets.filter(s => s.srel === f.id && s.sroff);
    const ten = Object.entries(TENETS).map(([k, n]) => `<em title="${Math.round((f.ten[k] || 0) * 100)}">${n} ${'●'.repeat(Math.round((f.ten[k] || 0) * 4))}${'○'.repeat(4 - Math.round((f.ten[k] || 0) * 4))}</em>`).join('');
    html += `<div class="sorow"><b><i style="background:${f.col}"></i>${esc(f.n)}</b><span>${c}</span>${bar(c / N, f.col)}
      <small>${KIND_NAME[f.kind] || ''}${f.kind !== 'volk' ? L(`, seit Jahr ${yearOf(f.d)}`, `, since year ${yearOf(f.d)}`) : ''}${f.founder ? L(`, gestiftet von ${esc(f.founder)}`, `, founded by ${esc(f.founder)}`) : ''}${from ? L(`, abgespalten von ${esc(from.n)}`, `, split from ${esc(from.n)}`) : ''}${holy ? L(` · heiliger Ort ${esc(holy.name)}`, ` · holy place ${esc(holy.name)}`) : ''}${state.length ? L(` · Staatsglaube in ${state.map(s => esc(s.name)).join(', ')}`, ` · state faith in ${state.map(s => esc(s.name)).join(', ')}`) : ''}</small>
      <div class="soten">${ten}</div></div>`;
  }
  const gone = st.faiths.filter(f => !cnt.get(f.id) && f.kind !== 'volk');
  html += `</div>`;
  if (gone.length) html += `<p class="muted small">${L('Vergangen', 'Gone')}: ${gone.map(f => `${esc(f.n)} (${L('Jahr', 'year')} ${yearOf(f.d)}${f.end ? L(' bis ', ' to ') + yearOf(f.end) : ''})`).join(', ')}</p>`;
  html += `<h3 class="sect">${L('Orte', 'Places')}</h3><div class="sorows">`;
  for (const s of sets.slice().sort((a, b) => b.pop - a.pop)) {
    const m = mix(st, s), n = Math.max(1, m.n);
    const parts = [...m.rl].sort((a, b) => b[1] - a[1]);
    const stack = `<span class="sostack">${parts.map(([k, c]) => { const f = rt.fById.get(k); return `<i style="width:${(c / n * 100).toFixed(1)}%;background:${f ? f.col : '#555'}" title="${esc(f ? f.n : '')} ${c}"></i>`; }).join('')}</span>`;
    const sf = s.srel && rt.fById.get(s.srel);
    const per = (s.persec || []).map(k => rt.fById.get(k)).filter(Boolean);
    html += `<div class="sorow"><b><a data-sid="${s.id}">${esc(s.name)}</a></b><span>${s.pop}</span>${stack}
      <small>${sf ? (s.sroff ? L(`Staatsglaube: ${esc(sf.n)}`, `State faith: ${esc(sf.n)}`) : L(`meist ${esc(sf.n)}`, `mostly ${esc(sf.n)}`)) : ''} · ${L('Toleranz', 'Tolerance')} ${pct(tolerance(st, s))}${per.length ? ` · <span class="sored">${L('verfolgt', 'persecuted')}: ${per.map(f => esc(f.n)).join(', ')}</span>` : ''}</small></div>`;
  }
  html += `</div><p class="muted small">${L(`${st.counts.conv || 0} Übertritte und ${st.counts.sects || 0} Abspaltungen bisher. Glaube wandert über Ehe, Familie und Freunde, Prediger tragen ihn weiter. Propheten stehen in Krisen auf, oft nach einem deiner Zeichen.`, `${st.counts.conv || 0} conversions and ${st.counts.sects || 0} schisms so far. Faith travels through marriage, family and friends, preachers carry it further. Prophets rise in crises, often after one of your signs.`)}</p>`;
  return html;
}

function plagueHtml(st) {
  const rt = st._rt;
  let html = `<h3 class="sect">${L('Gesundheit über die Zeit', 'Health over Time')}</h3>`;
  const rows = labRows(st, 'seir');
  html += stackSvg(rows, { pctMode: true, t: st.lab.t }) + legend(rows);
  const S = seirCounts(st);
  html += `<p class="muted small">${L(`Jetzt: ${S.S} gesund, ${S.E} angesteckt, ${S.I} krank, ${S.R} immun.`, `Now: ${S.S} susceptible, ${S.E} exposed, ${S.I} infectious, ${S.R} immune.`)}</p>`;
  const now = new Map();
  for (const p of st.people) if (p.dz) now.set(p.dz, (now.get(p.dz) || 0) + 1);
  const act = st.diseases.filter(d => !d.end && (now.get(d.id) || !d.endemic));
  const card = d => {
    const from = d.from && rt.dzById.get(d.from), src = d.s && rt.sById.get(d.s);
    return `<div class="sorow"><b><i style="background:${dzCol(d)}"></i>${esc(dzName(d))}</b><span>${now.get(d.id) || 0}</span>${bar(Math.min(1, (now.get(d.id) || 0) / Math.max(1, st.people.length) * 5), dzCol(d))}
      <small>R0 ${d.r0} · ${L('Inkubation', 'incubation')} ${d.inc} · ${L('krank', 'sick')} ${d.inf} ${L('Tage', 'days')} · ${L('Letalität', 'fatality')} ${pct(d.cfr)} · ${wayName(d.way)} · ${d.imm === -1 ? L('Immunität lebenslang', 'lifelong immunity') : d.imm ? L(`Immunität ${d.imm} Jahre`, `immunity ${d.imm} years`) : L('kurze Schonzeit', 'brief protection')}<br>${L(`${d.cases} Fälle, ${d.dead} Tote`, `${d.cases} cases, ${d.dead} deaths`)}${src ? L(`, begann in ${esc(src.name)}`, `, began in ${esc(src.name)}`) : ''} ${L('Jahr', 'year')} ${yearOf(d.d)}${d.end ? L(`, vorüber Jahr ${yearOf(d.end)}`, `, over in year ${yearOf(d.end)}`) : ''}${from ? L(`, Stamm von ${esc(dzName(from))}`, `, strain of ${esc(dzName(from))}`) : ''}</small></div>`;
  };
  html += `<h3 class="sect">${L('Seuchen jetzt', 'Epidemics Now')}</h3>`;
  html += act.length ? `<div class="sorows">${act.map(card).join('')}</div>` : `<p class="muted small">${L('Keine Seuche geht um.', 'No epidemic is going around.')}</p>`;
  const quar = st.settlements.filter(s => s.alive && s.quar > st.day);
  if (quar.length) html += `<p class="muted small">${L('Quarantäne', 'Quarantine')}: ${quar.map(s => `<a data-sid="${s.id}">${esc(s.name)}</a>`).join(', ')}</p>`;
  const past = st.diseases.filter(d => d.end && d.cases > 1).slice(-12).reverse();
  if (past.length) html += `<h3 class="sect">${L('Vergangene Seuchen', 'Past Epidemics')}</h3><div class="sorows">${past.map(card).join('')}</div>`;
  const deadRows = labRows(st, 'dead');
  if (deadRows.length) html += `<h3 class="sect">${L('Tote nach Ursache', 'Deaths by Cause')}</h3>${lineSvg(deadRows, { t: st.lab.t })}${legend(deadRows)}`;
  return html;
}

function migrationHtml(st) {
  const rt = st._rt;
  let html = `<h3 class="sect">${L('Wanderung über die Zeit', 'Migration over Time')}</h3>`;
  const rows = labRows(st, 'mig');
  html += lineSvg(rows, { t: st.lab.t }) + legend(rows);
  html += `<p class="muted small">${L(`Bisher ${st.counts.migr || 0} Umzüge zwischen Orten, ${st.counts.refugees || 0} davon auf der Flucht.`, `So far ${st.counts.migr || 0} moves between places, ${st.counts.refugees || 0} of them fleeing.`)}</p>`;
  const log = (st.mig && st.mig.log || []).slice(-24).reverse();
  if (log.length) {
    html += `<h3 class="sect">${L('Letzte Züge', 'Recent Moves')}</h3><div class="sorows">`;
    for (const e of log) {
      const a = rt.sById.get(e.a), b = rt.sById.get(e.b);
      html += `<div class="sorow mini"><b>${a ? `<a data-sid="${a.id}">${esc(a.name)}</a>` : '?'} → ${b ? `<a data-sid="${b.id}">${esc(b.name)}</a>` : '?'}</b><span>${e.n}</span><small>${e.k === 'flucht' ? `<span class="sored">${L('Flucht', 'fleeing')}</span>` : L('Zuzug', 'moving')} · ${L('Jahr', 'year')} ${yearOf(e.d)}</small></div>`;
    }
    html += `</div>`;
  }
  html += `<h3 class="sect">${L('Zugezogene je Ort', 'Immigrants by Place')}</h3><div class="sorows">`;
  for (const s of st.settlements.filter(o => o.alive && o.pop).sort((a, b) => b.pop - a.pop)) {
    const M = st.people.filter(p => p.s === s.id);
    const m1 = M.filter(p => p.mg === 1).length, m2 = M.filter(p => p.mg === 2).length, ref = M.filter(p => p.ref && st.day - p.ref < 10 * D.DAYS_PER_YEAR).length;
    html += `<div class="sorow"><b><a data-sid="${s.id}">${esc(s.name)}</a></b><span>${s.pop}</span>${bar((m1 + m2) / Math.max(1, s.pop), '#7fc4b4')}<small>${L(`${m1} zugezogen, ${m2} zweite Generation`, `${m1} immigrated, ${m2} second generation`)}${ref ? L(`, ${ref} Geflohene`, `, ${ref} refugees`) : ''}${['gastrecht', 'abschottung', 'einbuergerung'].filter(l => s.laws.includes(l)).map(l => ' · ' + esc(D.LAWS[l].name)).join('')}</small></div>`;
  }
  html += `</div><p class="muted small">${L('Menschen ziehen dorthin, wo es Brot, Arbeit und Sicherheit gibt, lieber zu Landsleuten und nicht zu weit. Krieg, Hunger, Seuchen und Verfolgung treiben ganze Familien in die Flucht. Gastrecht lockt, Abschottung weist ab.', 'People move where there is bread, work and safety, preferably to their own kind and not too far. War, hunger, epidemics and persecution drive whole families to flee. Guest right attracts, isolation turns away.')}</p>`;
  void ageOf; void top;
  return html;
}

// Stile einmal einsetzen (gilt auch für das Labor)
export function injectSocietyCss() {
  if (document.getElementById('soCss')) return;
  const el = document.createElement('style');
  el.id = 'soCss';
  el.textContent = `
.sosub .solab { margin-left: auto; color: var(--gold2); border-color: rgba(233,180,76,.45); }
.sochart { display: block; width: 100%; height: 110px; margin: 4px 0 2px; border-radius: 8px; background: rgba(246,239,226,.04); }
.sochart.empty { height: auto; padding: 14px 4px; font-size: 12px; color: var(--muted); background: none; }
.soaxis { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--muted); margin-bottom: 4px; }
.solegend { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 11.5px; color: var(--muted); margin: 2px 0 8px; }
.solegend i, .sorow b i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: 0; }
.sorows { display: flex; flex-direction: column; gap: 9px; }
.sorow { display: grid; grid-template-columns: minmax(0, 1fr) 48px 140px; gap: 2px 10px; align-items: center; font-size: 13px; }
.sorow > b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sorow > span:not(.sobar):not(.sostack) { text-align: right; font-variant-numeric: tabular-nums; color: var(--gold2); }
.sorow small { grid-column: 1 / -1; font-size: 11.5px; color: var(--muted); line-height: 1.5; }
.sorow.mini small { grid-column: 1 / -1; }
.sorow a, .sobox a { cursor: pointer; color: inherit; text-decoration: underline dotted rgba(246,239,226,.35); text-underline-offset: 2px; }
.sobar { display: block; height: 6px; border-radius: 6px; background: rgba(255,255,255,.1); overflow: hidden; }
.sobar i { display: block; height: 100%; border-radius: 6px; background: var(--teal); }
.sostack { display: flex; height: 8px; border-radius: 6px; overflow: hidden; background: rgba(255,255,255,.08); }
.sostack i { display: block; height: 100%; }
.soten { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 2px 10px; font-size: 11px; color: var(--muted); }
.soten em { font-style: normal; letter-spacing: .02em; }
.sored { color: #e8907a; }
@media (max-width: 760px) { .sorow { grid-template-columns: minmax(0, 1fr) 40px 96px; } .sochart { height: 90px; } }
`;
  document.head.append(el);
}
