// Labor (seit 20.10.2026): Experimente mit der Gesellschaft starten und messen. Knopf oben (#btnLab) oder im Inselbuch,
// Reiter Gesellschaft. Frei stehendes Glas rechts, am Handy ein Blatt von unten (Stile in society_ui.js injectSocietyCss).
// Experimente: Seuche (Vorlage oder eigene Werte), Wanderung oder Flucht, Glaube stiften, Gesetz setzen, Menschen
// ansiedeln. Messung: Kurven aus st.lab (alle 6 Tage), Protokoll aus st.lab.ev. Alles läuft über src/sim/lab.js.
import * as D from '../sim/data.js';
import { yearOf } from '../sim/util.js';
import { PRESETS, startEpidemic, startMigration, foundFaith, setLaw, settleGroup, addOrigin } from '../sim/lab.js';
import { TENETS } from '../sim/faith.js';
import { esc, stackSvg, lineSvg, legend, labRows, CLS_NAME, wayName, injectSocietyCss } from './society_ui.js';
import { L } from '../i18n.js';

const $ = s => document.querySelector(s);
const LAWS = ['gastrecht', 'abschottung', 'einbuergerung', 'toleranz', 'staatskirche', 'quarantaene', 'staende', 'schulpflicht', 'erbsteuer'];
const lawName = k => (k === 'quarantaene' ? L('Quarantäne', 'Quarantine') : D.LAWS[k].name);
const CHARTS = [['og', L('Herkunft', 'Origin'), true], ['rl', L('Glaube', 'Faith'), true], ['cls', L('Schicht', 'Class'), true], ['seir', L('Seuche', 'Epidemic'), true], ['dead', L('Tote', 'Deaths'), false], ['mig', L('Wanderung', 'Migration'), false]];
const EXP = [['seuche', L('Seuche', 'Epidemic')], ['wanderung', L('Wanderung', 'Migration')], ['glaube', L('Glaube', 'Faith')], ['gesetz', L('Gesetz', 'Law')], ['menschen', L('Menschen', 'People')]];

let state = { exp: 'seuche', chart: 'seir', timer: 0 };

export function toggleLab(app, force) {
  injectSocietyCss();
  injectLabCss();
  let el = $('#lab');
  const open = force ?? !(el && el.classList.contains('open'));
  if (!el) { el = document.createElement('div'); el.id = 'lab'; document.body.append(el); }
  el.classList.toggle('open', open);
  document.body.classList.toggle('lab-open', open);
  clearInterval(state.timer);
  if (!open) return;
  render(app);
  state.timer = setInterval(() => { if (!document.hidden) renderChart(app); }, 2000);
}

const opts = (list, sel) => list.map(([v, n]) => `<option value="${v}"${String(v) === String(sel) ? ' selected' : ''}>${esc(n)}</option>`).join('');

function render(app) {
  const st = app.st, el = $('#lab');
  if (!st || !el) return;
  const sets = st.settlements.filter(s => s.alive && s.pop).sort((a, b) => b.pop - a.pop);
  const fi = app.focusIsle ? app.focusIsle() : null;
  const def = (fi && sets.find(s => s.isle === fi.id)) || sets[0];
  const sopt = sets.map(s => [s.id, `${s.name} (${s.pop})`]);
  let form = '';
  if (state.exp === 'seuche') {
    form = `<label>${L('Krankheit', 'Disease')}<select data-k="preset">${opts([...Object.entries(PRESETS).map(([k, p]) => [k, p.n]), ['eigen', L('Eigene Werte', 'Custom values')]], state.preset || 'beulenpest')}</select></label>
      <div class="labvals" data-vals></div>
      <label>${L('Wo', 'Where')}<select data-k="sid">${opts(sopt, def && def.id)}</select></label>
      <label>${L('Erste Kranke', 'First cases')} <b data-show="share">2%</b><input type="range" data-k="share" min="0.5" max="20" step="0.5" value="2"></label>
      <button class="labgo" data-go="seuche">${L('Auslösen', 'Release')}</button>`;
  } else if (state.exp === 'wanderung') {
    form = `<label>${L('Von', 'From')}<select data-k="from">${opts(sopt, def && def.id)}</select></label>
      <label>${L('Nach', 'To')}<select data-k="to">${opts(sopt, sets[1] ? sets[1].id : def && def.id)}</select></label>
      <label>${L('Menschen', 'People')} <b data-show="n">20</b><input type="range" data-k="n" min="2" max="200" step="1" value="20"></label>
      <label class="labchk"><input type="checkbox" data-k="ref" checked> ${L('als Flucht (bleiben arm, kommen als Fremde)', 'as refugees (stay poor, arrive as strangers)')}</label>
      <button class="labgo" data-go="wanderung">${L('Losziehen lassen', 'Send them')}</button>`;
  } else if (state.exp === 'glaube') {
    form = `<label>${L('Wo', 'Where')}<select data-k="sid">${opts(sopt, def && def.id)}</select></label>
      <label>${L('Name', 'Name')}<input type="text" data-k="name" maxlength="40" placeholder="${L('Kirche der Stille', 'Church of Silence')}"></label>
      ${Object.entries(TENETS).map(([k, n]) => `<label>${n} <b data-show="t_${k}">50%</b><input type="range" data-k="t_${k}" min="0" max="1" step="0.05" value="0.5"></label>`).join('')}
      <label>${L('Gleich übertreten', 'Convert at once')} <b data-show="share">15%</b><input type="range" data-k="share" min="1" max="60" step="1" value="15"></label>
      <button class="labgo" data-go="glaube">${L('Stiften', 'Found')}</button>`;
  } else if (state.exp === 'gesetz') {
    const s = st._rt.sById.get(state.lawSid) || def;
    form = `<label>${L('Wo', 'Where')}<select data-k="lawSid">${opts(sopt, s && s.id)}</select></label>
      <div class="lablaws">${LAWS.map(k => { const on = k === 'quarantaene' ? s && s.quar > st.day : s && s.laws.includes(k); return `<button data-law="${k}" class="${on ? 'on' : ''}">${esc(lawName(k))}</button>`; }).join('')}</div>
      <p class="muted small">${L('Tippen schaltet ein oder aus. Gastrecht und Abschottung, Toleranz und Staatskirche schließen sich aus. Die Herrscher können Gesetze später wieder ändern.', 'Tap to switch on or off. Guest right and isolation, tolerance and state church exclude each other. Rulers may change laws again later.')}</p>`;
  } else {
    form = `<label>${L('Wo', 'Where')}<select data-k="sid">${opts(sopt, def && def.id)}</select></label>
      <label>${L('Menschen', 'People')} <b data-show="n">12</b><input type="range" data-k="n" min="2" max="120" step="1" value="12"></label>
      <label>${L('Herkunft', 'Origin')}<select data-k="og">${opts([...st.origins.map(o => [o.id, o.n]), ['neu', L('Neues Volk', 'New people')]], 'neu')}</select></label>
      <label>${L('Glaube', 'Faith')}<select data-k="rl">${opts([['auto', L('ihr eigener', 'their own')], ...st.faiths.filter(f => !f.end).map(f => [f.id, f.n])], 'auto')}</select></label>
      <label>${L('Schicht', 'Class')}<select data-k="cls">${opts(CLS_NAME.map((n, i) => [i, n]), 1)}</select></label>
      <button class="labgo" data-go="menschen">${L('Ansiedeln', 'Settle')}</button>`;
  }
  const ev = (st.lab && st.lab.ev || []).slice(-10).reverse();
  el.innerHTML = `<div class="phead"><h2>${L('Labor', 'Lab')}</h2><button class="close" title="${L('Schließen', 'Close')}">×</button></div>
    <div class="labbody">
      <p class="muted small">${L('Hier greifst du nicht als Geist ein, sondern als Forscher. Starte ein Experiment und sieh zu, wie sich die Welt verändert. Zeitraffer hilft.', 'Here you do not act as the spirit but as a researcher. Start an experiment and watch the world change. Time lapse helps.')}</p>
      <div class="isle-chips">${EXP.map(([k, n]) => `<button data-exp="${k}" class="${k === state.exp ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="labform">${form}</div>
      <div class="labmsg" data-msg></div>
      <h3 class="sect">${L('Messung', 'Measurement')}</h3>
      <div class="isle-chips">${CHARTS.map(([k, n]) => `<button data-chart="${k}" class="${k === state.chart ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div data-chartbox></div>
      <div class="labspeed">${[1, 10, 100, 500].map(v => `<button data-speed="${v}">${v}×</button>`).join('')}</div>
      <h3 class="sect">${L('Protokoll', 'Log')}</h3>
      <div class="labev">${ev.length ? ev.map(e => { const s = st._rt.sById.get(e.s); return `<div><small>${L('Jahr', 'Year')} ${yearOf(e.d)}${s ? ' · ' + esc(s.name) : ''}</small>${esc(e.t)}</div>`; }).join('') : `<p class="muted small">${L('Noch kein Experiment.', 'No experiment yet.')}</p>`}</div>
    </div>`;
  el.querySelector('.close').onclick = () => toggleLab(app, false);
  el.querySelectorAll('[data-exp]').forEach(b => { b.onclick = () => { state.exp = b.dataset.exp; render(app); }; });
  el.querySelectorAll('[data-chart]').forEach(b => { b.onclick = () => { state.chart = b.dataset.chart; el.querySelectorAll('[data-chart]').forEach(x => x.classList.toggle('on', x === b)); renderChart(app); }; });
  el.querySelectorAll('[data-speed]').forEach(b => { b.onclick = () => app.setSpeed && app.setSpeed(+b.dataset.speed); });
  el.querySelectorAll('input[type=range]').forEach(i => { const show = () => { const o = el.querySelector(`[data-show="${i.dataset.k}"]`); if (o) o.textContent = i.dataset.k.startsWith('t_') ? Math.round(i.value * 100) + '%' : i.dataset.k === 'share' ? i.value + '%' : i.value; }; i.oninput = show; show(); });
  const pre = el.querySelector('[data-k="preset"]');
  if (pre) { const showVals = () => { state.preset = pre.value; valsForm(el); }; pre.onchange = showVals; showVals(); }
  const ls = el.querySelector('[data-k="lawSid"]');
  if (ls) ls.onchange = () => { state.lawSid = +ls.value; render(app); };
  el.querySelectorAll('[data-law]').forEach(b => { b.onclick = () => { const s = st._rt.sById.get(+el.querySelector('[data-k="lawSid"]').value); if (!s) return; const on = !b.classList.contains('on'); setLaw(st, s, b.dataset.law, on); state.lawSid = s.id; done(app, on ? L(`${lawName(b.dataset.law)} gilt jetzt in ${s.name}.`, `${lawName(b.dataset.law)} now applies in ${s.name}.`) : L(`${lawName(b.dataset.law)} ist in ${s.name} aufgehoben.`, `${lawName(b.dataset.law)} is repealed in ${s.name}.`)); }; });
  el.querySelectorAll('[data-go]').forEach(b => { b.onclick = () => go(app, b.dataset.go); });
  renderChart(app);
}

// Eigene Werte der Seuche (vorbelegt mit der gewählten Vorlage)
function valsForm(el) {
  const box = el.querySelector('[data-vals]');
  const P = PRESETS[state.preset] || PRESETS.beulenpest;
  const custom = state.preset === 'eigen';
  const f = (k, n, min, max, step, v) => `<label>${n} <b data-show="${k}">${v}</b><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v}"${custom ? '' : ' disabled'}></label>`;
  box.innerHTML = f('r0', 'R0', 0.3, 18, 0.1, P.r0) + f('inc', L('Inkubation (echte Tage)', 'Incubation (real days)'), 1, 21, 1, P.inc) + f('inf', L('Krank (echte Tage)', 'Sick (real days)'), 1, 30, 1, P.inf)
    + f('cfr', L('Letalität', 'Fatality'), 0, 1, 0.01, P.cfr)
    + `<label>${L('Weg', 'Route')}<select data-k="way"${custom ? '' : ' disabled'}>${opts(['luft', 'wasser', 'ratten', 'muecken'].map(w => [w, wayName(w)]), P.way)}</select></label>`
    + `<label>${L('Immunität', 'Immunity')}<select data-k="imm"${custom ? '' : ' disabled'}>${opts([[0, L('kurz', 'brief')], [1, L('1 Jahr', '1 year')], [3, L('3 Jahre', '3 years')], [-1, L('lebenslang', 'lifelong')]], P.imm)}</select></label>`;
  box.querySelectorAll('input[type=range]').forEach(i => { i.oninput = () => { box.querySelector(`[data-show="${i.dataset.k}"]`).textContent = i.dataset.k === 'cfr' ? Math.round(i.value * 100) + '%' : i.value; }; i.oninput(); });
}

function val(el, k) { const i = el.querySelector(`[data-k="${k}"]`); return i ? (i.type === 'checkbox' ? i.checked : i.value) : null; }

function go(app, kind) {
  const st = app.st, el = $('#lab'), rt = st._rt;
  const S = id => rt.sById.get(+id);
  let msg = '';
  if (kind === 'seuche') {
    const s = S(val(el, 'sid'));
    if (!s) return;
    const def = state.preset === 'eigen'
      ? { n: L('Neue Seuche', 'New Plague'), r0: +val(el, 'r0'), inc: +val(el, 'inc'), inf: +val(el, 'inf'), cfr: +val(el, 'cfr'), way: val(el, 'way'), imm: +val(el, 'imm') }
      : state.preset;
    const d = startEpidemic(st, s, def, { share: +val(el, 'share') / 100 });
    msg = L(`${d.cases} Menschen in ${s.name} sind krank.`, `${d.cases} people in ${s.name} are sick.`);
  } else if (kind === 'wanderung') {
    const a = S(val(el, 'from')), b = S(val(el, 'to'));
    if (!a || !b || a === b) { note(el, L('Bitte zwei verschiedene Orte wählen.', 'Please choose two different places.')); return; }
    const ref = !!val(el, 'ref');
    const n = startMigration(st, a, b, +val(el, 'n'), { refugee: ref });
    if (ref) for (const p of st.people) if (p.s === b.id && p.ref === st.day) p.cls = Math.min(p.cls ?? 1, 0);
    msg = L(`${n} Menschen sind unterwegs nach ${b.name}.`, `${n} people are on their way to ${b.name}.`);
  } else if (kind === 'glaube') {
    const s = S(val(el, 'sid'));
    if (!s) return;
    const ten = Object.fromEntries(Object.keys(TENETS).map(k => [k, +val(el, 't_' + k)]));
    const f = foundFaith(st, s, { name: (val(el, 'name') || '').trim() || undefined, ten, share: +val(el, 'share') / 100 });
    msg = L(`${f.n} ist gestiftet.`, `${f.n} has been founded.`);
  } else if (kind === 'menschen') {
    const s = S(val(el, 'sid'));
    if (!s) return;
    let og = val(el, 'og');
    if (og === 'neu') { const used = new Set(st.origins.map(o => o.lang)); let lang = 0; while (used.has(lang) && lang < 9) lang++; og = addOrigin(st, { lang }).id; } else og = +og;
    const o = rt.ogById.get(og);
    const rl = val(el, 'rl') === 'auto' ? (o && o.fv) || 0 : +val(el, 'rl');
    const ps = settleGroup(st, s, +val(el, 'n'), { og, rl, cls: +val(el, 'cls'), lang: o ? o.lang : undefined });
    msg = L(`${ps.length} Menschen (${o ? o.n : ''}) leben jetzt in ${s.name}.`, `${ps.length} people (${o ? o.n : ''}) now live in ${s.name}.`);
  }
  done(app, msg);
}

function done(app, msg) {
  if (app.refresh) app.refresh();
  render(app);
  note($('#lab'), msg);
}
function note(el, msg) { const m = el && el.querySelector('[data-msg]'); if (m) { m.textContent = msg; m.classList.add('show'); setTimeout(() => m.classList.remove('show'), 4000); } }

function renderChart(app) {
  const st = app.st, box = document.querySelector('#lab [data-chartbox]');
  if (!st || !box) return;
  const c = CHARTS.find(x => x[0] === state.chart);
  const rows = labRows(st, state.chart);
  box.innerHTML = (c[2] ? stackSvg(rows, { pctMode: true, t: st.lab.t, h: 140 }) : lineSvg(rows, { t: st.lab.t, h: 140 })) + legend(rows.slice(0, 10));
}

function injectLabCss() {
  if (document.getElementById('labCss')) return;
  const el = document.createElement('style');
  el.id = 'labCss';
  el.textContent = `
#lab { position: fixed; top: 86px; right: 18px; bottom: 150px; width: 400px; z-index: 22; display: flex; flex-direction: column; color: var(--paper, #f6efe2);
  background: var(--glass, rgba(14,34,40,.72)); backdrop-filter: blur(18px) saturate(1.2); -webkit-backdrop-filter: blur(18px) saturate(1.2); border-radius: 18px;
  transform: translateX(calc(100% + 30px)); transition: transform .35s cubic-bezier(.2,.8,.2,1); pointer-events: none; }
#lab.open { transform: none; pointer-events: auto; }
/* frei stehend wie Leiste und Dock (Naders Wunsch: keine Kästen): nur ein weicher Schleier von rechts für die Lesbarkeit */
@media (min-width: 761px) and (min-height: 521px) {
  #lab { background: none; backdrop-filter: none; -webkit-backdrop-filter: none; border-radius: 0; right: 0; width: 440px; padding-right: 14px; text-shadow: var(--float-shadow); }
  #lab::before { content: ''; position: absolute; top: -30px; bottom: -30px; left: -70px; right: 0; z-index: -1; pointer-events: none; background: linear-gradient(270deg, rgba(8,16,22,.66), rgba(8,16,22,.42) 62%, transparent); }
  #lab select, #lab input[type=text] { background: rgba(8,16,22,.45); text-shadow: none; }
}
#lab .phead { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px 4px; }
#lab .phead h2 { font-family: var(--serif); font-size: 20px; margin: 0; }
#lab .close { font-size: 22px; opacity: .7; }
#lab .labbody { overflow-y: auto; padding: 0 18px 18px; flex: 1; overscroll-behavior: contain; }
#lab .labform { display: flex; flex-direction: column; gap: 8px; }
#lab label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
#lab label b { color: var(--gold2); font-weight: 600; }
#lab label.labchk { flex-direction: row; align-items: center; gap: 8px; }
#lab select, #lab input[type=text] { background: rgba(246,239,226,.08); color: inherit; border: 1px solid var(--line, rgba(246,239,226,.18)); border-radius: 10px; padding: 7px 9px; font: inherit; font-size: 13px; }
#lab select option { color: #222; }
#lab input[type=range] { width: 100%; accent-color: var(--gold, #e9b44c); }
#lab input[disabled], #lab select[disabled] { opacity: .45; }
#lab .labvals { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
#lab .labgo { margin-top: 4px; padding: 10px 14px; border-radius: 999px; background: var(--gold, #e9b44c); color: #2b2620; font-weight: 600; font-size: 14px; }
#lab .lablaws { display: flex; flex-wrap: wrap; gap: 6px; }
#lab .lablaws button, #lab .labspeed button { padding: 6px 12px; border-radius: 999px; font-size: 12px; border: 1px solid var(--line, rgba(246,239,226,.2)); color: var(--muted); }
#lab .lablaws button.on { background: var(--paper, #f6efe2); color: var(--ink, #2b2620); }
#lab .labspeed { display: flex; gap: 6px; margin: 6px 0; }
#lab .labmsg { min-height: 0; font-size: 13px; color: var(--gold2); opacity: 0; transition: opacity .3s; margin-top: 6px; }
#lab .labmsg.show { opacity: 1; }
#lab .labev div { font-size: 12.5px; padding: 4px 0; border-bottom: 1px solid rgba(246,239,226,.08); }
#lab .labev small { display: block; font-size: 11px; color: var(--muted); }
@media (max-width: 760px) {
  #lab { left: 0; right: 0; width: auto; top: auto; bottom: 0; height: min(70vh, calc(100vh - 118px)); border-radius: 22px 22px 0 0; transform: translateY(104%); padding-bottom: env(safe-area-inset-bottom); z-index: 26; }
  @supports (height: 100dvh) { #lab { height: min(70dvh, calc(100dvh - 118px)); } }
  #lab.open { transform: none; }
  body.lab-open #dock, body.lab-open #prayers { opacity: 0; pointer-events: none; }
  #lab .labvals { grid-template-columns: 1fr; }
}
@media (max-height: 520px) and (orientation: landscape) {
  #lab { top: calc(54px + env(safe-area-inset-top)); bottom: max(8px, env(safe-area-inset-bottom)); right: max(8px, env(safe-area-inset-right)); width: min(380px, 48vw); height: auto; border-radius: 18px; transform: translateX(calc(100% + 30px)); }
  #lab.open { transform: none; }
}
`;
  document.head.append(el);
}
