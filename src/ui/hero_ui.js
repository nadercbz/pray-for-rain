// Dein Mensch in der Oberfläche: Auswahl beim Start einer neuen Welt (Karten mit Bild, Alter, Wesen, Vorgeschichte)
// und "Meine Geschichte" (Taste H oder Knopf oben): das Leben deines Menschen und seiner Nachfahren in Stichpunkten.
import { yearOf } from '../sim/util.js';
import * as D from '../sim/data.js';
import { heroCandidates, chooseHero, traitWords, backstory, backstoryKey, heroChapters, jobName } from '../sim/hero.js';
import { adultFace, faceOf, faceHTML, keepFace } from './faces.js';
import { say, stopVoice, lineText } from './voice.js';
import { personLook } from '../render/people.js';
import { openDiary } from './diary_ui.js';
import { L } from '../i18n.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const age = (st, p) => Math.floor((st.day - p.b) / D.DAYS_PER_YEAR);

const CSS = `
#heroStory { position: fixed; inset: 0; z-index: 45; display: grid; place-items: center; background: rgba(8, 14, 20, 0.6); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); opacity: 0; pointer-events: none; transition: opacity 0.35s; }
#heroStory.show { opacity: 1; pointer-events: auto; }
#heroStory .hs { width: min(760px, calc(100vw - 32px)); height: min(820px, calc(100vh - 40px)); display: flex; flex-direction: column; border-radius: 24px; overflow: hidden; background: linear-gradient(180deg, #f8f1e4, #efe4cf); color: #2b2620; box-shadow: 0 30px 80px rgba(0,0,0,0.45); }
#heroStory .hh { display: flex; gap: 16px; align-items: center; padding: 22px 24px 16px; border-bottom: 1px solid rgba(43,38,32,0.12); }
#heroStory .hh .face { width: 84px; height: 84px; flex: none; border-radius: 18px; }
#heroStory .hh h2 { font-family: var(--serif); font-size: 26px; margin: 0; }
#heroStory .hh p { margin: 4px 0 0; font-size: 13.5px; color: #6b6052; }
#heroStory .hx { margin-left: auto; align-self: flex-start; font-size: 26px; line-height: 1; background: none; color: #6b6052; }
#heroStory .acts { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 24px; border-bottom: 1px solid rgba(43,38,32,0.08); }
#heroStory .acts button { padding: 6px 12px; border-radius: 999px; font-size: 12.5px; font-weight: 600; background: rgba(43,38,32,0.08); color: #2b2620; }
#heroStory .acts button.on { background: #2b2620; color: #f8f1e4; }
#heroStory .hl { flex: 1; overflow: auto; padding: 8px 24px 28px; }
#heroStory h3 { font-family: var(--serif); font-size: 19px; margin: 22px 0 8px; display: flex; align-items: baseline; gap: 10px; }
#heroStory h3 small { font-family: inherit; font-size: 12.5px; color: #8a7d6c; font-weight: 400; }
#heroStory ul { list-style: none; margin: 0; padding: 0; }
#heroStory li { display: grid; grid-template-columns: 68px 1fr; gap: 10px; padding: 5px 0; font-size: 14.5px; line-height: 1.4; border-bottom: 1px dashed rgba(43,38,32,0.08); }
#heroStory li span { color: #a08d70; font-size: 12.5px; padding-top: 2px; }
#heroStory li.w { color: #7a6e60; font-size: 13.5px; }
#heroStory li.p { font-family: var(--serif); font-style: italic; color: #7a5a14; }
#heroStory .empty { color: #8a7d6c; font-style: italic; margin-top: 30px; }
`;

function ensure(id) {
  if (!document.getElementById('heroCss')) { const c = document.createElement('style'); c.id = 'heroCss'; c.textContent = CSS; document.head.append(c); }
  let box = document.getElementById(id);
  if (!box) { box = document.createElement('div'); box.id = id; document.body.append(box); }
  return box;
}

// Kleines Bild eines Menschen in seinen Farben (Kopf, Haare, Hemd, Hose)
export function portrait(st, p) {
  const kid = age(st, p) < 14, old = age(st, p) >= 60;
  const c = personLook(p, kid && p.job === 'kind', old);
  const f = p.sex === 'f';
  return `<svg viewBox="0 0 100 124" aria-hidden="true">
    <ellipse cx="50" cy="118" rx="30" ry="5" fill="rgba(43,38,32,0.12)"/>
    <path d="M30 116 L34 86 L66 86 L70 116 Z" fill="${c.pants}"/>
    <path d="M24 92 Q26 60 50 58 Q74 60 76 92 Q64 98 50 98 Q36 98 24 92 Z" fill="${c.shirt}"/>
    <rect x="44" y="48" width="12" height="12" rx="4" fill="${c.skin}"/>
    <circle cx="50" cy="38" r="17" fill="${c.skin}"/>
    ${f ? `<path d="M32 40 Q30 18 50 17 Q70 18 68 40 Q70 58 64 62 Q66 44 60 30 Q50 26 40 30 Q34 44 36 62 Q30 58 32 40 Z" fill="${c.hair}"/>`
      : `<path d="M33 36 Q32 19 50 19 Q68 19 67 36 Q62 27 50 27 Q38 27 33 36 Z" fill="${c.hair}"/>`}
    <circle cx="44" cy="39" r="1.8" fill="#2b2620"/><circle cx="56" cy="39" r="1.8" fill="#2b2620"/>
    <path d="M45 46 Q50 49 55 46" stroke="#2b2620" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  </svg>`;
}

// Auswahl: wessen Leben lebst du? Große Figuren im Pixar Look (faces.js), die atmen und sich umschauen.
// Die Erzählstimme liest die Erklärung vor (pk1). done(pid oder null) kommt, wenn die Auswahl samt Einleitung vorbei ist.
export function openHeroPicker(app, done) {
  const st = app.st;
  if (!st) return;
  const box = ensure('heroPick');
  const cands = heroCandidates(st, 5);
  const s = (st.earth && st.settlements.find(o => o.alive && st._rt.iById.get(o.isle)?.player)) || st.settlements.filter(o => o.alive).sort((a, b) => b.pop - a.pop)[0];
  const isle = s && st._rt.iById ? st._rt.iById.get(s.isle) : null;
  const taken = new Set(), faceKey = {};
  for (const p of cands) { const k = adultFace(st, p, taken); taken.add(k); faceKey[p.id] = k; }
  const card = (p, i) => {
    const k = faceKey[p.id];
    return `<button class="hc" data-pid="${p.id}" style="--d:${i * 0.08}s">
    ${faceHTML({ key: k, video: `assets/heroes/${k}.mp4`, poster: `assets/heroes/${k}.webp` }, 'big')}
    <div class="hinfo"><b>${esc(p.n)}</b><div class="meta">${age(st, p)} ${L('Jahre', 'years')} · ${esc(L('Familie', 'family'))} ${esc(p.clan)}</div>
    <div class="chips">${traitWords(p).map(w => `<span>${esc(w)}</span>`).join('')}</div>
    <i>${esc(backstory(p, !!st.earth))}</i></div><span class="go">${L('Dieses Leben leben', 'Live this life')}</span></button>`;
  };
  const kick = st.earth ? L(`Die Ersten von ${s ? s.name : ''}, das Volk der ${isle ? isle.name : ''}`, `The first of ${s ? s.name : ''}, the ${isle ? isle.name : ''} people`) : L(`Die Gestrandeten von ${isle ? isle.name : s ? s.name : 'der Insel'}`, `The castaways of ${isle ? isle.name : s ? s.name : 'the island'}`);
  box.innerHTML = `<div class="hp"><div class="hhead"><small class="kicker">${esc(kick)}</small>
    <h2>${L('Wessen Leben lebst du?', 'Whose life will you live?')}</h2>
    <p class="sub">${L('Als Geist siehst du alles. Ein Leben erlebst du ganz nah, mit Tagebuch. Stirbt dein Mensch, erzählen seine Kinder weiter.', 'As the spirit you see everything. One life you live up close, with a diary. When they die, their children carry the story on.')}</p></div>
    <div class="cards">${cands.map(card).join('')}</div>
    <div class="foot"><button class="skip">${L('Ohne eigenes Leben spielen', 'Play without a life of your own')}</button></div></div>`;
  let closed = false;
  const close = pid => {
    if (closed) return; closed = true;
    stopVoice();
    box.classList.remove('show');
    setTimeout(() => { box.innerHTML = ''; }, 500);
    if (pid) heroIntro(app, pid, () => done && done(pid));
    else if (done) setTimeout(() => done(null), 350);
  };
  box.querySelectorAll('.hc').forEach(b => {
    b.onclick = () => {
      const pid = +b.dataset.pid;
      chooseHero(st, pid);
      const p = st._rt.pById.get(pid);
      keepFace(st, p, faceKey[pid]);
      b.classList.add('chosen');
      box.classList.add('picked');
      app.sound && app.sound.chime && app.sound.chime();
      setTimeout(() => close(pid), 650);
    };
  });
  box.querySelector('.skip').onclick = () => close(null);
  requestAnimationFrame(() => box.classList.add('show'));
  setTimeout(() => { if (!closed) say('pk1', { caption: false }); }, 700);
}

// Einleitung nach der Wahl: dein Mensch groß im Bild, die Stimme erzählt seine Vorgeschichte
export function heroIntro(app, pid, done) {
  const st = app.st, p = st._rt.pById.get(pid);
  if (!p) { if (done) done(); return; }
  const box = ensure('heroIntro');
  const s = st._rt.sById.get(p.s);
  const bs = backstory(p, !!st.earth), key = backstoryKey(p, !!st.earth);
  box.innerHTML = `<div class="hi">${faceHTML(faceOf(st, p), 'hero')}
    <div class="htext"><small class="kicker">${L('Hier beginnt deine Geschichte', 'This is where your story begins')}</small>
    <h2>${esc(p.n)}</h2>
    <p class="meta">${age(st, p)} ${L('Jahre', 'years')} · ${esc(L('Familie', 'family'))} ${esc(p.clan)} · ${esc(s ? s.name : '')}</p>
    <p class="bs">${esc(bs)}</p>
    <p class="hint">${L('Dein Tagebuch ist offen. Mit <kbd>H</kbd> blickst du zurück.', 'Your diary is open. Press <kbd>H</kbd> to look back.')}</p>
    <button class="go">${L('Weiter', 'Continue')}</button></div></div>`;
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    stopVoice();
    box.classList.remove('show');
    setTimeout(() => { box.innerHTML = ''; }, 600);
    app.selectPerson && app.selectPerson(pid, true);
    app.follow && app.follow(pid);
    if (done) setTimeout(done, 450);
  };
  box.querySelector('.go').onclick = close;
  const esc2 = e => { if (e.key === 'Escape' && box.classList.contains('show')) { e.stopImmediatePropagation(); window.removeEventListener('keydown', esc2, true); close(); } };
  window.addEventListener('keydown', esc2, true);
  requestAnimationFrame(() => box.classList.add('show'));
  const steps = box.querySelectorAll('.htext > *');
  steps.forEach(x => x.classList.add('wait'));
  const reveal = n => steps.forEach((x, i) => { if (i < n) x.classList.remove('wait'); });
  reveal(3);
  // Vorgeschichte in der Du-Form wie gesprochen (lines.json), sonst der Text aus hero.js
  if (key) lineText(key).then(t => { if (t) box.querySelector('.bs').textContent = t; });
  say(['hi_start', ...(key ? [key] : []), 'hi_end'], {
    caption: false, gap: 0.5,
    onLine: i => reveal(i === 0 ? 3 : i === 1 && key ? 4 : 6),
    onEnd: () => { reveal(6); box.querySelector('.go').classList.add('pulse'); },
  });
  setTimeout(() => reveal(6), 14000);
}

// Meine Geschichte: Stichpunkte je Generation
export function openHeroStory(app) {
  const st = app.st;
  if (!st) return;
  if (!st.hero) { openHeroPicker(app); return; }
  const box = ensure('heroStory');
  const view = { world: true };
  const render = () => {
    const H = st.hero, rt = st._rt, p = rt.pById.get(H.id);
    const s = p ? rt.sById.get(p.s) : null;
    const gen = H.line.length;
    const head = p ? `${faceHTML(faceOf(st, p), 'mini')}<div><h2>${esc(p.n)}</h2><p>${L(`${gen}. Generation · ${age(st, p)} Jahre · ${jobName(st, p).de} in ${s ? s.name : 'der Fremde'}`, `Generation ${gen} · ${age(st, p)} years · ${jobName(st, p).en} in ${s ? s.name : 'a strange land'}`)}</p>
      <p>${L(`Deine Geschichte seit Jahr ${yearOf(H.start)}: ${H.line.map(id => esc(H.names[id])).join(' › ')}`, `Your story since year ${yearOf(H.start)}: ${H.line.map(id => esc(H.names[id])).join(' › ')}`)}</p></div>`
      : `<div><h2>${L('Deine Geschichte ist zu Ende', 'Your story has ended')}</h2><p>${L('Niemand aus der Familie lebt mehr, der sie weitererzählen könnte.', 'No one in the family is left alive to carry it on.')}</p></div>`;
    let html = '';
    for (const ch of heroChapters(st)) {
      const items = ch.items.filter(x => view.world || x[3] !== 'world');
      if (!items.length) continue;
      const from = items[0][0], to = items[items.length - 1][0];
      html += `<h3>${esc(ch.name)}<small>${L('Jahr', 'Year')} ${yearOf(from)}${ch.alive ? ' ' + L('bis heute', 'to today') : ' ' + L('bis', 'to') + ' ' + yearOf(to)}</small></h3><ul>`;
      let last = -1;
      for (const [d, , t, k] of items) {
        const y = yearOf(d);
        html += `<li class="${k === 'world' ? 'w' : k === 'pass' || k === 'end' || k === 'start' ? 'p' : ''}"><span>${y !== last ? L('Jahr', 'Year') + ' ' + y : ''}</span><div>${esc(t)}</div></li>`;
        last = y;
      }
      html += '</ul>';
    }
    box.innerHTML = `<div class="hs"><div class="hh">${head}<button class="hx" title="${L('Schließen', 'Close')}">×</button></div>
      <div class="acts">
        ${p ? `<button data-a="look">${L('Ansehen', 'Look')}</button>` : ''}
        <button data-a="diary">${L('Ganzes Tagebuch lesen', 'Read the full diary')}</button>
        <button data-a="world" class="${view.world ? 'on' : ''}">${L('Mit Weltgeschehen', 'With world events')}</button>
        ${!p ? `<button data-a="new">${L('Neuen Menschen wählen', 'Choose a new person')}</button>` : ''}
      </div>
      <div class="hl">${html || `<p class="empty">${L('Noch ist nichts geschehen.', 'Nothing has happened yet.')}</p>`}</div></div>`;
    box.querySelector('.hx').onclick = () => box.classList.remove('show');
    box.querySelectorAll('[data-a]').forEach(b => {
      b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'look' && p) { box.classList.remove('show'); app.selectPerson && app.selectPerson(p.id, true); app.follow && app.follow(p.id); }
        else if (a === 'diary') { box.classList.remove('show'); openDiary(app, { id: st.hero.diary }); }
        else if (a === 'world') { view.world = !view.world; render(); }
        else if (a === 'new') { box.classList.remove('show'); st.hero = null; openHeroPicker(app); }
      };
    });
    const list = box.querySelector('.hl');
    list.scrollTop = list.scrollHeight;
  };
  if (!box._esc) { box._esc = true; window.addEventListener('keydown', e => { if (e.key === 'Escape' && box.classList.contains('show')) { e.stopImmediatePropagation(); box.classList.remove('show'); } }, true); }
  render();
  box.classList.add('show');
}
