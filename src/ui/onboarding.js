// Ablauf bei jeder neuen Insel: Einführungsvideo, dann die Wahl deines Lebens (hero_ui.js) mit gesprochener Vorgeschichte,
// dann das Tutorial zum Mitmachen (tour.js). Bei der Erde (kein Video) steht vorher "Du bist kein Gott" (spiritIntro).
import { L } from '../i18n.js';
import { say, stopVoice } from './voice.js';
import { openHeroPicker } from './hero_ui.js';
import { playTrailer } from './trailer.js';
import { startTour, resetTour } from './tour.js';
import { openEarthPicker } from './earthpick.js';

const CARD = id => `assets/cards/${id}.webp`;
const PANELS = [
  { voice: 'sp1', art: `<div class="sp-one"><img src="${CARD('segen')}" alt=""></div>`,
    t: L('Du bist kein Gott.', 'You are not a god.'), s: L('Du bist der Geist dieser Welt.', 'You are the spirit of this world.') },
  { voice: 'sp2', art: `<div class="sp-fan">${[['sturm', L('Wind', 'Wind')], ['flut', L('Wasser', 'Water')], ['schnee', L('Schnee', 'Snow')], ['beben', L('Land', 'Land')], ['traum', L('Träume', 'Dreams')]]
      .map(([id, n], i) => `<figure style="--i:${i - 2}"><img src="${CARD(id)}" alt=""><figcaption>${n}</figcaption></figure>`).join('')}</div>`,
    t: L('Wind, Wasser, Land und Träume.', 'Wind, water, land and dreams.'), s: L('Du formst die Welt und gehst in ihre Träume.', 'You shape the world and walk into their dreams.') },
  { voice: 'sp3', art: `<div class="sp-one fog"><img src="${CARD('nebel')}" alt=""></div>`,
    t: L('Sie sehen dich nicht.', 'They cannot see you.'), s: L('Sie spüren dich nur und versuchen, dich zu verstehen.', 'They only feel you, and try to understand you.') },
];

export function spiritIntro(app, done) {
  let box = document.getElementById('spiritIntro');
  if (!box) { box = document.createElement('div'); box.id = 'spiritIntro'; document.body.append(box); }
  box.innerHTML = `<div class="si"><div class="art"></div><h2></h2><p></p>
    <div class="dots">${PANELS.map(() => '<i></i>').join('')}</div>
    <div class="sbtn"><button class="next">${L('Weiter', 'Continue')}</button><button class="skip">${L('Überspringen', 'Skip')}</button></div></div>`;
  let k = -1, closed = false, timer = 0;
  const show = i => {
    k = i;
    clearTimeout(timer);
    const P = PANELS[i];
    const si = box.querySelector('.si');
    si.classList.remove('in'); void si.offsetWidth; si.classList.add('in');
    box.querySelector('.art').innerHTML = P.art;
    box.querySelector('h2').textContent = P.t;
    box.querySelector('p').textContent = P.s;
    box.querySelectorAll('.dots i').forEach((d, j) => d.classList.toggle('on', j <= i));
    box.querySelector('.next').textContent = i === PANELS.length - 1 ? L('Los geht’s', 'Begin') : L('Weiter', 'Continue');
    say(P.voice, { caption: false, force: true, onEnd: () => { timer = setTimeout(() => { if (k === i && !closed) next(); }, 1300); } });
  };
  const close = () => {
    if (closed) return; closed = true;
    clearTimeout(timer); stopVoice();
    window.removeEventListener('keydown', key, true);
    box.classList.remove('show');
    setTimeout(() => { box.innerHTML = ''; if (done) done(); }, 700);
  };
  const next = () => (k < PANELS.length - 1 ? show(k + 1) : close());
  const key = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopImmediatePropagation(); next(); } };
  window.addEventListener('keydown', key, true);
  box.querySelector('.next').onclick = next;
  box.querySelector('.skip').onclick = close;
  requestAnimationFrame(() => box.classList.add('show'));
  setTimeout(() => show(0), 350);
}

// Neue Welt: Erde (seit 19.10.2026): wer du bist, dann der Startort auf der gemalten Erdkarte, dann ein Leben wählen,
// dann das Tutorial. Das Einführungsvideo zeigt Inseln und läuft hier nicht. Abbrechen führt zurück in die Inselwelt.
export function newEarthFlow(app) {
  resetTour(app);
  spiritIntro(app, () => openEarthPicker({
    onPick: (x, y) => { app.createEarth(x, y); setTimeout(() => openHeroPicker(app, () => startTour(app)), 900); },
    onCancel: () => app.leaveEarth(),
  }));
}

// Eine neue Insel beginnt: Video, Leben wählen, Tutorial. withVideo = false überspringt das Video (?notrailer).
// Seit 20.10.2026 ohne die drei Bilder "Du bist kein Gott": das sagen das Video (Fassung 3) und die erste Station des Tutorials.
export function newGameFlow(app, withVideo = true) {
  resetTour(app);
  const afterVideo = () => openHeroPicker(app, () => startTour(app));
  if (withVideo) playTrailer({ onEnd: afterVideo }); else afterVideo();
}
