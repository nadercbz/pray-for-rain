// Das Tagebuch als Buch: links die Schreiber über die Generationen, rechts ihre Einträge.
// Auch für jeden Menschen ohne Tagebuch: seine Lebensgeschichte aus Lebenslauf und dem, was in seinem Ort geschah.
import { dateStr, yearOf, ageOf } from '../sim/util.js';
import { startDiary, lifeStory } from '../sim/diary.js';
import { L } from '../i18n.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KIND = { life: '', fam: L('Familie', 'Family'), world: L('Welt', 'World'), tale: L('Erzählt', 'Told'), pass: L('Übergabe', 'Handover'), secret: L('Geheim', 'Secret') };

export const diaryOf = (st, pid) => (st.diaries || []).find(d => d.line.includes(pid));

export function openDiary(app, opt) {
  const st = app.st;
  if (!st) return;
  let box = document.getElementById('diary');
  if (!box) {
    box = document.createElement('div');
    box.id = 'diary';
    document.body.append(box);
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && box.classList.contains('show')) { e.stopImmediatePropagation(); close(); } }, true);
  }
  const close = () => { box.classList.remove('show'); };
  const view = { filter: 'alle', ...opt };
  const render = () => {
    const rt = st._rt;
    let entries, chapters, title, sub, writer = null, d = null;
    if (view.story) {
      const p = rt.pById.get(view.story);
      if (!p) return close();
      entries = lifeStory(st, p);
      title = L(`Die Geschichte von ${p.n}`, `The Story of ${p.n}`);
      sub = L(`Lebenslauf und was in ${rt.sById.get(p.s)?.name || 'der Welt'} geschah, seit ${p.n} geboren wurde.`, `Life and what happened in ${rt.sById.get(p.s)?.name || 'the world'} since ${p.n} was born.`);
      chapters = [{ id: p.id, name: p.n, from: p.b, to: st.day, alive: true }];
      writer = p;
    } else {
      d = (st.diaries || []).find(x => x.id === view.id) || (st.diaries || [])[0];
      if (!d) return close();
      entries = d.e;
      const first = d.names[d.line[0]];
      title = L(`Das Buch der Familie ${clanOf(st, d) || first}`, `The Book of the ${clanOf(st, d) || first} Family`);
      sub = L(`Begonnen von ${first} im Jahr ${yearOf(d.start)}. ${d.line.length} ${d.line.length === 1 ? 'Schreiber' : 'Schreiber nacheinander'}${d.end ? ', beendet im Jahr ' + yearOf(d.end) : ''}.`,
        `Begun by ${first} in year ${yearOf(d.start)}. ${d.line.length} ${d.line.length === 1 ? 'writer' : 'writers, one after another'}${d.end ? ', ended in year ' + yearOf(d.end) : ''}.`);
      chapters = d.line.map((id, i) => {
        const from = i === 0 ? d.start : (d.e.find(e => e[3] === id && e[1] === 'pass') || [d.start])[0];
        const next = d.line[i + 1];
        const to = next ? (d.e.find(e => e[3] === next && e[1] === 'pass') || [st.day])[0] : (d.end || st.day);
        return { id, name: d.names[id] || '?', from, to, alive: rt.pById.has(id) };
      });
      writer = rt.pById.get(d.cur);
    }
    const shown = entries.filter(e => view.filter === 'alle' || (view.filter === 'leben' ? e[1] !== 'world' : view.filter === 'erzaehlt' ? (e[1] === 'tale' || e[1] === 'pass') : e[1] === 'secret'));
    let last = -1, html = '';
    for (const e of shown) {
      const ch = chapters.find(c => c.id === e[3]);
      if (!view.story && e[1] === 'pass') html += `<div class="dchap">${esc(ch ? ch.name : '')}</div>`;
      const y = yearOf(e[0]);
      html += `<div class="dent k-${e[1]}"><div class="dmeta">${y !== last ? `<b>${esc(dateStr(e[0]))}</b>` : ''}${KIND[e[1]] ? `<span>${KIND[e[1]]}</span>` : ''}</div><p>${esc(e[2])}</p></div>`;
      last = y;
    }
    const others = (st.diaries || []).filter(x => x !== d);
    box.innerHTML = `<div class="dbook">
      <button class="dx" title="${L('Schließen', 'Close')}">×</button>
      <aside class="dside">
        <h2>${esc(title)}</h2><p class="dsub">${esc(sub)}</p>
        <div class="dwriters">${chapters.map(c => `<button class="dw${c.alive ? ' alive' : ''}" data-pid="${c.id}"><b>${esc(c.name)}</b><small>${L('Jahr', 'Year')} ${yearOf(c.from)} ${L('bis', 'to')} ${c.alive && !d?.end && c.id === (d ? d.cur : c.id) ? L('heute', 'today') : yearOf(c.to)}</small></button>`).join('')}</div>
        ${writer ? `<button class="dfollow" data-pid="${writer.id}">${L(`${writer.n} ansehen`, `Look at ${writer.n}`)}</button>` : ''}
        ${view.story && writer && !diaryOf(st, writer.id) ? `<button class="dstart">${L('Ab jetzt Tagebuch führen lassen', 'Have them keep a diary from now on')}</button>` : ''}
        ${others.length ? `<h3>${L('Weitere Bücher', 'Other books')}</h3>${others.map(x => `<button class="dother" data-id="${x.id}">${esc(clanOf(st, x) || x.names[x.line[0]])}<small>${esc(x.names[x.cur] || '')}${x.end ? ' · ' + L('beendet', 'ended') : ''}</small></button>`).join('')}` : ''}
      </aside>
      <section class="dpages">
        <div class="dfilters">${[['alle', L('Alles', 'Everything')], ['leben', L('Nur das Leben', 'Life only')], ['erzaehlt', L('Erzählungen', 'Stories')], ['geheim', L('Geheimnisse', 'Secrets')]].map(([k, n]) => `<button data-f="${k}" class="${view.filter === k ? 'on' : ''}">${n}</button>`).join('')}</div>
        <div class="dlist">${html || `<p class="dempty">${L('Noch steht nichts darin.', 'Nothing written yet.')}</p>`}</div>
      </section></div>`;
    box.querySelector('.dx').onclick = close;
    box.querySelectorAll('[data-f]').forEach(b => { b.onclick = () => { view.filter = b.dataset.f; render(); }; });
    box.querySelectorAll('.dother').forEach(b => { b.onclick = () => { view.id = +b.dataset.id; view.story = null; render(); }; });
    box.querySelectorAll('.dw, .dfollow').forEach(b => { b.onclick = () => { const p = rt.pById.get(+b.dataset.pid); if (p) app.selectPerson(p.id, true); else app.toast && app.toast(L('Dieser Mensch lebt nicht mehr.', 'This person is no longer alive.')); }; });
    const ds = box.querySelector('.dstart');
    if (ds) ds.onclick = () => { const dd = startDiary(st, writer); view.story = null; view.id = dd.id; render(); };
    const list = box.querySelector('.dlist');
    list.scrollTop = list.scrollHeight;
  };
  render();
  box.classList.add('show');
}

function clanOf(st, d) {
  const p = st._rt.pById.get(d.line[0]);
  if (p) return p.clan;
  const q = st._rt.pById.get(d.cur);
  return q ? q.clan : null;
}

// Für die Personenkarte: Knöpfe zum Tagebuch
export function diaryButtons(st, p) {
  const d = diaryOf(st, p.id);
  const age = ageOf(st, p);
  return `${d ? `<button class="dread" data-id="${d.id}">${L('Tagebuch lesen', 'Read diary')}</button>` : age >= 12 ? `<button class="dbegin">${L('Tagebuch führen lassen', 'Have them keep a diary')}</button>` : ''}<button class="dstory">${L('Geschichte', 'Story')}</button>`;
}
