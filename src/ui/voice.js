// Erzählstimme im Spiel: spielt die Sätze aus assets/voice/{en,de}/<id>.mp3 (Englisch Soraya aus Higgsfield, Deutsch Edge TTS)
// und zeigt dazu einen Untertitel unten in der Mitte. Texte und Dauern stehen in assets/voice/lines.json und durations.json.
// Eine Kette von Sätzen läuft nacheinander (say(['hi_start', 'bs_mut_0'])), ein neuer Aufruf mit force bricht die alte ab.
// Ein- und ausschalten in den Einstellungen (localStorage 'pfr.voice'). Ist der Ton aus, gibt es nur den Untertitel.
import { LANG } from '../i18n.js';

const KEY = 'pfr.voice';
let app = null, lines = null, durs = {}, cur = null, chain = null, token = 0;

export function initVoice(a) {
  app = a;
  const base = 'assets/voice/';
  lines = fetch(base + 'lines.json').then(r => r.json()).then(j => { const m = {}; for (const x of j.lines) m[x.id] = x; return m; }).catch(() => ({}));
  fetch(base + 'durations.json').then(r => r.json()).then(j => { durs = j[LANG] || {}; }).catch(() => {});
}

export function voiceOn() { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } }
export function setVoiceOn(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* egal */ } if (!v) stopVoice(); }
export const speaking = () => !!chain;

function bar() {
  let b = document.getElementById('narr');
  if (!b) {
    b = document.createElement('div');
    b.id = 'narr';
    b.innerHTML = '<p></p><small></small>';
    document.body.append(b);
  }
  return b;
}
function showCaption(text, sub) {
  const b = bar();
  b.querySelector('p').textContent = text || '';
  b.querySelector('small').textContent = sub || '';
  b.classList.toggle('show', !!text);
}
function hideCaption() { const b = document.getElementById('narr'); if (b) b.classList.remove('show'); }

export function stopVoice() {
  token++;
  if (cur) { cur.pause(); cur.src = ''; cur = null; }
  chain = null;
  hideCaption();
  app && app.sound && app.sound.duck && app.sound.duck(false);
}

// ids: ein Satz oder eine Liste. opts: { sub (zweite Zeile im Untertitel), caption (false = kein Untertitel),
// onEnd, force (laufende Kette abbrechen), gap (Pause zwischen Sätzen in s) }
export async function say(ids, opts = {}) {
  if (!Array.isArray(ids)) ids = [ids];
  if (chain && !opts.force) return false;
  stopVoice();
  const my = ++token;
  chain = ids;
  const map = await lines;
  const sound = voiceOn() && (!app || !app.sound || app.sound.on);
  if (sound && app && app.sound && app.sound.duck) app.sound.duck(true);
  for (let i = 0; i < ids.length; i++) {
    if (my !== token) return false;
    const id = ids[i], x = map[id];
    const text = x ? (LANG === 'de' ? x.de : x.en) : '';
    if (opts.caption !== false) showCaption(text, i === ids.length - 1 ? opts.sub : opts.subAll || '');
    if (opts.onLine) opts.onLine(i, id);
    const ms = Math.max(1600, (durs[id] || text.length / 14) * 1000);
    if (sound) {
      await new Promise(done => {
        const a = cur = new Audio(`assets/voice/${LANG}/${id}.mp3`);
        a.volume = 1;
        let t = setTimeout(done, ms + 4000); // falls das Ende nie kommt
        a.onended = () => { clearTimeout(t); done(); };
        a.onerror = () => { clearTimeout(t); t = setTimeout(done, ms); };
        a.play().catch(() => { clearTimeout(t); t = setTimeout(done, ms); });
      });
    } else {
      await new Promise(done => setTimeout(done, ms + 400));
    }
    if (my !== token) return false;
    if (i < ids.length - 1) await new Promise(done => setTimeout(done, (opts.gap ?? 0.35) * 1000));
  }
  if (my !== token) return false;
  chain = null; cur = null;
  setTimeout(() => { if (!chain) hideCaption(); }, 900);
  if (app && app.sound && app.sound.duck) app.sound.duck(false);
  if (opts.onEnd) opts.onEnd();
  return true;
}

// Text eines Satzes (für Untertitel in eigenen Fenstern)
export async function lineText(id) { const m = await lines; const x = m[id]; return x ? (LANG === 'de' ? x.de : x.en) : ''; }
