// Inselbuch, Reiter Staaten (seit 24.10.2026, Entwicklungssystem, PLAN_ENTWICKLUNG.md): jeder Staat mit Hauptstadt,
// Oberhaupt, Staatsform, Konjunktur, Parlament als Sitzbalken mit Koalition, Kabinett mit Können, Orten mit
// Bürgermeistern; dazu die Welt: Rat der Völker, Spiele der Völker, vergangene Staaten. Daten aus src/sim/states.js.
// Frei stehend mit den Stilen des Reiters Gesellschaft (injectSocietyCss). Dazu officesHtml für die Personenkarte.
import * as D from '../sim/data.js';
import { yearOf } from '../sim/util.js';
import { membersOfState, MINISTRIES, ECON_NAME } from '../sim/states.js';
import { progName, progCost } from '../sim/progress.js';
import { esc, injectSocietyCss } from './society_ui.js';
import { L } from '../i18n.js';

const SUB = [['staaten', L('Staaten', 'States')], ['welt', L('Welt', 'World')]];
const ECON_COL = { boom: '#7fc4b4', normal: '#cfcac2', krise: '#e07a5f' };
const bar = (v, col) => `<span class="sobar"><i style="width:${Math.max(0, Math.min(100, v * 100)).toFixed(0)}%;${col ? `background:${col}` : ''}"></i></span>`;
const dot = c => `<i class="sodot" style="background:${c}"></i>`;

let css = false;
function injectCss() {
  if (css) return; css = true;
  const el = document.createElement('style');
  el.textContent = `.sodot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:middle}
    .stparl{display:flex;height:12px;border-radius:6px;overflow:hidden;margin:6px 0 4px;background:rgba(255,255,255,0.08)}
    .stparl i{display:block;height:100%}.stparl i.coal{box-shadow:inset 0 -3px 0 rgba(255,255,255,0.85)}
    .stlist{font-size:12px;line-height:1.55;opacity:0.92}.stlist a{cursor:pointer;border-bottom:1px dotted currentColor}
    .stcard{margin:10px 0 14px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.08)}
    .stcard h4{margin:0 0 2px;font-size:15px}.stcard .stsub{font-size:12px;opacity:0.8}
    .stoff{margin:6px 0 2px;font-size:12px;line-height:1.5}.stoff b{font-weight:600}
    .stcab{display:grid;grid-template-columns:auto 1fr 64px;gap:2px 10px;align-items:center;font-size:12px;margin-top:6px}
    .stcab .sobar{width:64px;display:inline-block}.stcab a{cursor:pointer;border-bottom:1px dotted currentColor}`;
  document.head.append(el);
}

export function statesTab(ui, st, body) {
  injectSocietyCss(); injectCss();
  const S0 = ui.sts || (ui.sts = { tab: 'staaten' });
  let html = `<div class="isle-chips sosub">${SUB.map(([k, n]) => `<button data-sub="${k}" class="${k === S0.tab ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  html += S0.tab === 'welt' ? worldHtml(st) : statesHtml(st);
  body.innerHTML = html;
  body.querySelectorAll('[data-sub]').forEach(b => { b.onclick = () => { S0.tab = b.dataset.sub; statesTab(ui, st, body); }; });
  body.querySelectorAll('[data-sid]').forEach(b => { b.onclick = () => { const s = st._rt.sById.get(+b.dataset.sid); if (s) ui.app.focus(s.cx, s.cy, 45); }; });
  body.querySelectorAll('[data-pid]').forEach(b => { b.onclick = () => ui.app.selectPerson && ui.app.selectPerson(+b.dataset.pid, true); });
}

const sLink = s => (s ? `<a data-sid="${s.id}">${esc(s.name)}</a>` : '?');
const pLink = p => (p ? `<a data-pid="${p.id}">${esc(p.n)}</a>` : '');

function statesHtml(st) {
  const rt = st._rt;
  if (!st.states) return `<p class="muted">${L('Noch keine Staaten.', 'No states yet.')}</p>`;
  const live = st.states.filter(S => S.alive && membersOfState(st, S).length);
  const pop = S => membersOfState(st, S).reduce((a, s) => a + s.pop, 0);
  live.sort((a, b) => pop(b) - pop(a));
  const multi = live.filter(S => membersOfState(st, S).length > 1).length;
  let html = `<p class="muted">${L(`${live.length} Staaten, ${multi} davon mit mehreren Orten. Die Hauptstadt regiert, die anderen Orte haben Bürgermeister.`, `${live.length} states, ${multi} of them with several towns. The capital governs, the other towns have mayors.`)}</p>`;
  for (const S of live) {
    const sets = membersOfState(st, S), cap = rt.sById.get(S.cap), head = cap && rt.pById.get(cap.gov.leader);
    const I = cap && rt.iById.get(cap.isle);
    const prog = I && I.prog ? L(` · Fortschritt ${I.prog}`, ` · Progress ${I.prog}`) : '';
    html += `<div class="stcard"><h4>${dot(S.col)}${esc(S.name)}</h4>
      <div class="stsub">${L('Hauptstadt', 'Capital')} ${sLink(cap)} · ${D.GOVS[cap.gov.type].name} · ${D.ERAS[cap.era | 0].name}${prog} · ${pop(S)} ${L('Menschen', 'people')} · ${sets.length} ${sets.length === 1 ? L('Ort', 'town') : L('Orte', 'towns')} · <span style="color:${ECON_COL[S.econ.k]}">${ECON_NAME[S.econ.k]}</span>${S.from ? L(` · seit Jahr ${yearOf(S.founded)} unabhängig`, ` · independent since year ${yearOf(S.founded)}`) : ''}</div>
      ${head ? `<div class="stoff"><b>${esc(head.lt || L('Oberhaupt', 'Head of state'))}</b> ${pLink(head)}${cap.mil && cap.mil.min && rt.pById.get(cap.mil.min) ? ` · <b>${L('Verteidigung', 'Defense')}</b> ${pLink(rt.pById.get(cap.mil.min))}` : ''}</div>` : ''}`;
    if (S.parl && S.parl.total) {
      const seats = S.parl.seats, coal = S.parl.coal || [];
      const order = S.parties.filter(P => seats[P.id]).sort((a, b) => seats[b.id] - seats[a.id]);
      html += `<div class="stparl">${order.map(P => `<i class="${coal.includes(P.id) ? 'coal' : ''}" style="width:${(seats[P.id] / S.parl.total * 100).toFixed(1)}%;background:${P.col}" title="${esc(P.name)} ${seats[P.id]}"></i>`).join('')}</div>
        <div class="stlist">${order.map(P => { const ld = rt.pById.get(P.lead); return `${dot(P.col)}${esc(P.name)} ${seats[P.id]}${coal.includes(P.id) ? ' ✓' : ''}${ld ? ` (${pLink(ld)})` : ''}`; }).join(' · ')}<br><span class="muted">${S.parl.total} ${L('Sitze, gewählt im Jahr', 'seats, elected in year')} ${yearOf(S.parl.last)}, ${L('nächste Wahl', 'next election')} ${yearOf(S.parl.next)} · ✓ ${L('Regierung', 'government')}</span></div>`;
    }
    const cab = MINISTRIES.filter(([k]) => S.cab && S.cab[k] && rt.pById.get(S.cab[k].id));
    if (cab.length) html += `<div class="stcab">${cab.map(([k, n]) => { const m = S.cab[k]; return `<b>${n}</b><span>${pLink(rt.pById.get(m.id))}</span>${bar(m.c, '#e9c46a')}`; }).join('')}</div>`;
    const others = sets.filter(s => s !== cap).sort((a, b) => b.pop - a.pop);
    if (others.length) html += `<div class="stlist" style="margin-top:6px">${others.slice(0, 12).map(s => { const m = rt.pById.get(s.gov.leader); return `${sLink(s)} ${s.pop}${m ? ` · ${esc(m.lt || '')} ${pLink(m)}` : ''}${s.occ && st.day - s.occ < 30 * D.DAYS_PER_YEAR ? L(' · besetzt', ' · occupied') : ''}`; }).join('<br>')}${others.length > 12 ? `<br>${L(`und ${others.length - 12} weitere`, `and ${others.length - 12} more`)}` : ''}</div>`;
    html += `</div>`;
  }
  return html;
}

function worldHtml(st) {
  const rt = st._rt;
  let html = `<h3 class="sect">${L('Rat der Völker', 'Council of Nations')}</h3>`;
  const C = st.council;
  if (!C) html += `<p class="muted">${L('Noch gibt es keinen Rat. Er entsteht, sobald zwei Staaten die Industrie erreichen.', 'There is no council yet. It forms once two states reach the industrial age.')}</p>`;
  else {
    const seat = rt.sById.get(C.seat), mem = (C.members || []).map(id => rt.stById.get(id)).filter(Boolean);
    html += `<p class="stlist">${L('Gegründet im Jahr', 'Founded in year')} ${yearOf(C.founded)} · ${L('Sitz', 'Seat')} ${sLink(seat)} · ${C.sessions} ${L('Sitzungen', 'sessions')}<br>${mem.map(S => `${dot(S.col)}${esc(S.name)}`).join(' · ')}</p>`;
  }
  html += `<h3 class="sect">${L('Spiele der Völker', 'Games of the Nations')}</h3>`;
  const G = st.games;
  if (!G) html += `<p class="muted">${L('Die ersten Spiele finden statt, sobald zwei Staaten der Stadtstaatenzeit voneinander wissen.', 'The first games take place once two city-state-age states know of each other.')}</p>`;
  else { const host = rt.sById.get(G.host), win = rt.stById.get(G.win); html += `<p class="stlist">${G.count}. ${L('Spiele', 'Games')} ${L('im Jahr', 'in year')} ${G.y + 1} ${L('in', 'in')} ${sLink(host)}, ${G.n} ${L('Staaten', 'states')} · ${L('Sieger', 'Winner')} ${win ? `${dot(win.col)}${esc(win.name)}` : '?'}</p>`; }
  html += `<h3 class="sect">${L('Fortschritt', 'Progress')}</h3><div class="sorows">`;
  for (const I of st.isles.filter(I => st.settlements.some(s => s.alive && s.isle === I.id)).sort((a, b) => (b.prog | 0) - (a.prog | 0) || b.era - a.era).slice(0, 8)) {
    const done = I.techs.length >= D.TECHS.length;
    html += `<div class="sorow"><b>${esc(I.name)}</b><span>${I.prog | 0}</span>${bar(done ? I.research.pts / progCost(I.prog | 0) : I.techs.length / D.TECHS.length, '#8a9bd4')}<small>${D.ERAS[I.era].name}${done ? L(` · als Nächstes: ${progName(I.prog | 0)}`, ` · next: ${progName(I.prog | 0)}`) : L(` · ${I.techs.length} von ${D.TECHS.length} Wissen`, ` · ${I.techs.length} of ${D.TECHS.length} known`)}</small></div>`;
  }
  html += `</div>`;
  const gone = st.states.filter(S => !S.alive && S.ended).slice(-10).reverse();
  if (gone.length) {
    html += `<h3 class="sect">${L('Vergangene Staaten', 'Former States')}</h3><p class="stlist">`;
    html += gone.map(S => { const by = S.endedBy && rt.stById.get(S.endedBy); return `${dot(S.col)}${esc(S.name)} · ${L('bis Jahr', 'until year')} ${yearOf(S.ended)}${by ? L(`, aufgegangen in ${esc(by.name)}`, `, merged into ${esc(by.name)}`) : ''}`; }).join('<br>');
    html += `</p>`;
  }
  return html;
}

// Ämter eines Menschen für die Personenkarte: Staatsoberhaupt, Minister, Verteidigung, Parteichef, Bürgermeister
export function officesHtml(st, p) {
  if (!st.states) return '';
  const rt = st._rt, out = [];
  const home = rt.sById.get(p.s);
  for (const S of st.states) {
    if (!S.alive) continue;
    const cap = rt.sById.get(S.cap);
    if (!cap) continue;
    if (cap.gov.leader === p.id) out.push(L(`Staatsoberhaupt von ${esc(S.name)}`, `Head of state of ${esc(S.name)}`));
    for (const [k, n] of MINISTRIES) if (S.cab && S.cab[k] && S.cab[k].id === p.id) out.push(L(`Minister für ${n} in ${esc(S.name)}`, `Minister of ${n} in ${esc(S.name)}`));
    if (cap.mil && cap.mil.min === p.id) out.push(L(`Verteidigung in ${esc(S.name)}`, `Defense in ${esc(S.name)}`));
    for (const P of S.parties || []) if (P.lead === p.id) out.push(L(`führt die ${esc(P.name)}`, `leads the ${esc(P.name)}`));
  }
  if (home && home.gov.leader === p.id && home.state) { const S = rt.stById.get(home.state); if (S && S.cap !== home.id) out.push(L(`${esc(p.lt || 'Bürgermeister')} von ${esc(home.name)}`, `${esc(p.lt || 'Mayor')} of ${esc(home.name)}`)); }
  return out.length ? `<div class="fam"><b>${L('Ämter', 'Offices')}:</b> ${out.join(' · ')}</div>` : '';
}
