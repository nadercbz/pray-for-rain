// Briefe und Gerüchte (26.11.2026). Reine Anzeige aus dem Spielstand, nichts wird gespeichert.
//   Briefe: was ein Mensch seinen Nächsten schreibt (vor der Schrift: was er ausrichten lässt). Der Inhalt folgt aus
//   seinem Wesen, seinem Lebenslauf und der Lage seines Ortes (Hunger, Krieg, Krankheit, Glaube, Wetter).
//   Gerüchte: was man sich im Ort erzählt, über Nachbarn, Berühmte, den Himmel und den Schatten.
// Der Zufall hängt an Mensch, Ort und Jahr: derselbe Mensch schreibt im selben Jahr dieselben Briefe.
import { L } from '../i18n.js';
import * as D from '../sim/data.js';

const YEAR = D.DAYS_PER_YEAR;
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function rnd(seed) { let a = seed | 0 || 1; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, a) => a[Math.floor(r() * a.length)];

function mood(st, s, p) {
  const out = [];
  if (!s) return out;
  if (s.war) { const e = st._rt.sById.get(s.war.enemy || s.war.with || s.war); out.push(L(`Es ist Krieg${e && e.name ? ' mit ' + e.name : ''}. Nachts brennen die Wachfeuer, und ich schlafe schlecht.`, `There is war${e && e.name ? ' with ' + e.name : ''}. The watch fires burn at night, and I sleep badly.`)); }
  if (s.hunger > 0.15) out.push(L('Das Brot ist knapp geworden. Wir teilen, was da ist, aber die Kinder fragen jeden Abend.', 'Bread has grown scarce. We share what there is, but the children ask every evening.'));
  else if (s.stock && s.stock.food > (s.pop || 1) * 20) out.push(L('Die Speicher sind voll wie nie. Niemand hier muss den Winter fürchten.', 'The stores are fuller than ever. No one here needs to fear the winter.'));
  if (p.sick) out.push(L('Ich liege seit Tagen mit Fieber. Mach dir keine Sorgen, man kümmert sich um mich.', 'I have been down with fever for days. Do not worry, I am being looked after.'));
  else if (st.people.some(q => q.s === s.id && q.sick)) out.push(L('Eine Krankheit geht um. Wir halten die Türen geschlossen und hoffen.', 'A sickness is going round. We keep our doors shut and hope.'));
  if ((s.unanswered | 0) >= 2) out.push(L('Wir beten, aber der Himmel schweigt. Manche sagen laut, dass niemand zuhört.', 'We pray, but the sky stays silent. Some say out loud that no one is listening.'));
  else if (s.blessed && s.blessed > st.day - 20) out.push(L('Unser Gebet wurde erhört. Ich habe es mit eigenen Augen gesehen und werde es nie vergessen.', 'Our prayer was answered. I saw it with my own eyes and shall never forget it.'));
  const w = st.weather && st.weather.kind;
  if (w === 'schnee') out.push(L('Draußen liegt Schnee bis an die Fensterbank.', 'Outside the snow lies up to the window sill.'));
  else if (w === 'sturm') out.push(L('Der Sturm rüttelt am Dach, während ich das hier schreibe.', 'The storm is shaking the roof as I write this.'));
  else if (st.weather && st.weather.moist < 0.15) out.push(L('Es hat seit Wochen nicht geregnet. Die Felder sind hart wie Stein.', 'It has not rained for weeks. The fields are hard as stone.'));
  return out;
}
function self(p, r) {
  const t = p.tr || {}, out = [];
  if (t.neugier > 0.65) out.push(L('Ich frage mich oft, was hinter dem Horizont liegt. Eines Tages will ich es sehen.', 'I often wonder what lies beyond the horizon. One day I want to see it.'));
  if (t.wut > 0.65) out.push(L('Ich habe mich wieder gestritten. Du kennst mich ja. Es tut mir schon leid.', 'I got into a quarrel again. You know me. I am already sorry.'));
  if (t.glaube > 0.7 || p.faith > 0.75) out.push(L('Ich danke jeden Morgen dem Himmel. Es gibt jemanden, der über uns wacht, da bin ich sicher.', 'I thank the sky every morning. Someone watches over us, I am sure of it.'));
  if (t.kunst > 0.65) out.push(L('Ich habe wieder etwas geschnitzt. Es ist nicht nützlich, aber es ist schön.', 'I have carved something again. It is of no use, but it is beautiful.'));
  if (t.mut > 0.7) out.push(L('Angst habe ich keine. Irgendwer muss ja vorangehen.', 'I am not afraid. Someone has to go first, after all.'));
  if (p.dream && D.DREAMS[p.dream]) out.push(L(`Ich träume noch immer von ${D.DREAMS[p.dream].name}. Seit jener Nacht bin ich ein anderer Mensch.`, `I still dream of ${D.DREAMS[p.dream].name.toLowerCase()}. Since that night I have been a different person.`));
  if (p.hap < 0.3) out.push(L('Mir ist das Herz schwer in diesen Tagen.', 'My heart is heavy these days.'));
  else if (p.hap > 0.8) out.push(L('Mir geht es gut, besser als ich es verdiene.', 'I am well, better than I deserve.'));
  if (!out.length) out.push(pick(r, L(['Hier geht alles seinen Gang.', 'Viel Neues gibt es nicht, und das ist gut so.'], ['Everything here takes its course.', 'There is not much news, and that is a good thing.'])));
  return out;
}

export function letters(st, p) {
  const rt = st._rt, s = rt.sById.get(p.s), yr = Math.floor(st.day / YEAR);
  const r = rnd(p.id * 7919 + yr * 104729);
  const g = id => (id ? rt.pById.get(id) : null);
  const kin = [];
  const add = (q, rel) => { if (q && q !== p && !kin.some(k => k.q === q)) kin.push({ q, rel }); };
  add(g(p.pa), L('Liebste', 'Dearest')); add(g(p.mo), L('Liebe Mutter', 'Dear mother')); add(g(p.fa), L('Lieber Vater', 'Dear father'));
  for (const q of st.people) { if (q.mo === p.id || q.fa === p.id) add(q, L('Mein Kind', 'My child')); else if ((p.mo && q.mo === p.mo) || (p.fa && q.fa === p.fa)) add(q, q.sex === 'm' ? L('Lieber Bruder', 'Dear brother') : L('Liebe Schwester', 'Dear sister')); if (kin.length > 7) break; }
  if (Math.floor((st.day - p.b) / YEAR) < 8) return { oral: true, list: [] };
  const era = s ? s.era | 0 : 0, oral = era < 2;
  // wer weit weg wohnt, bekommt eher einen Brief
  kin.sort((a, b) => (b.q.s !== p.s) - (a.q.s !== p.s));
  const M = mood(st, s, p), S = self(p, r), list = [];
  const last = p.bio && p.bio.length > 1 ? p.bio[p.bio.length - 1] : null;
  for (const k of kin.slice(0, 3)) {
    const far = k.q.s !== p.s, qs = rt.sById.get(k.q.s);
    const lines = [];
    if (far && qs) lines.push(L(`wie lebt es sich in ${qs.name}? Hier in ${s ? s.name : 'der Fremde'} denke ich oft an dich.`, `how is life in ${qs.name}? Here in ${s ? s.name : 'this far place'} I often think of you.`));
    else if (oral) lines.push(L('ich sage es dir lieber durch einen Boten, als es für mich zu behalten.', 'I would rather send you word than keep this to myself.'));
    else lines.push(pick(r, L(['wir sehen uns jeden Tag, und doch sage ich dir manches nie.', 'ich schreibe dir, weil mir die Worte im Gespräch fehlen.'], ['we see each other every day, and yet there are things I never tell you.', 'I write to you because the words fail me when we speak.'])));
    if (M.length) lines.push(M[Math.floor(r() * M.length)]);
    lines.push(S[Math.floor(r() * S.length)]);
    if (last && r() < 0.6) lines.push(L(`Du sollst es von mir hören: ${p.n} ${last[1]}.`, `You should hear it from me: ${p.n} ${last[1]}.`));
    list.push({ to: k.q, hello: k.rel, text: lines.join(' '), far, place: qs ? qs.name : '' });
  }
  return { oral, list };
}

export function rumours(st, s) {
  const rt = st._rt, yr = Math.floor(st.day / YEAR), r = rnd(s.id * 3571 + yr * 7907), out = [];
  const others = st.settlements.filter(o => o.alive && o !== s);
  const famous = st.people.filter(p => p.s === s.id && ((p.fame | 0) >= 2 || p.lt || p.title)).sort((a, b) => (b.fame | 0) - (a.fame | 0))[0];
  if (famous) out.push(L(`${famous.n} soll nachts mit dem Himmel sprechen. Andere sagen, das sei nur Wichtigtuerei.`, `They say ${famous.n} speaks with the sky at night. Others call it mere showing off.`));
  for (const o of others) {
    const rel = (s.rel && s.rel[o.id]) || 0;
    if (rel < -20) { out.push(L(`Die aus ${o.name} sollen ihre Brunnen vergiften und Kinder stehlen. Beweise hat niemand.`, `Those from ${o.name} are said to poison wells and steal children. No one has proof.`)); break; }
    if (rel > 40) { out.push(L(`In ${o.name} soll es Brot im Überfluss geben. Wer dort einheiratet, hat ausgesorgt.`, `They say ${o.name} has bread in plenty. Marry into it and you are set for life.`)); break; }
  }
  const g = st.godLog[st.godLog.length - 1];
  if (g && st.day - g.d < 3 * YEAR && D.POWER[g.id]) out.push(L(`${D.POWER[g.id].name}: das war kein Zufall, sagen die Alten. Jemand dort oben will uns etwas sagen.`, `${D.POWER[g.id].name}: that was no accident, the elders say. Someone up there is trying to tell us something.`));
  if ((s.unanswered | 0) >= 2) out.push(L('Man flüstert, die Götter hätten den Ort verlassen.', 'It is whispered that the gods have abandoned this place.'));
  const myth = st.myths.filter(m => m.s === s.id).slice(-1)[0];
  if (myth) out.push(L(`Die Geschichte von „${myth.name}“ wird mit jedem Jahr größer. Die Kinder kennen schon drei Fassungen.`, `The tale of “${myth.name}” grows bigger every year. The children already know three versions.`));
  if (s.hunger > 0.15) out.push(L('Der Müller soll Mehl beiseiteschaffen. Gesehen hat es keiner.', 'The miller is said to be hiding flour. No one has seen it.'));
  out.push(pick(r, L([
    'Am Waldrand soll ein weißer Hirsch gesehen worden sein. Das bringt Glück, oder Unglück, je nachdem wen man fragt.',
    'Ein Fremder soll hinter den Hügeln lagern. Niemand weiß, was er will.',
    'Die alte Heilerin sagt einen strengen Winter voraus. Sie hat sich noch selten geirrt.',
    'Ein Schatten soll nachts über den Dächern stehen. Die Hunde schlagen an.',
    'Es heißt, im Berg liege ein Schatz aus der Zeit der Ahnen.',
  ], [
    'A white stag is said to have been seen at the forest edge. That means luck, or ill luck, depending on whom you ask.',
    'A stranger is said to be camping behind the hills. No one knows what he wants.',
    'The old healer foretells a harsh winter. She has rarely been wrong.',
    'A shadow is said to stand over the roofs at night. The dogs give tongue.',
    'They say a treasure from the time of the ancestors lies in the mountain.',
  ])));
  return out.slice(0, 4);
}

export function initPost(app) {
  const ov = document.createElement('div');
  ov.id = 'post';
  document.body.append(ov);
  const close = () => ov.classList.remove('show');
  ov.addEventListener('pointerdown', e => { if (e.target === ov) close(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && ov.classList.contains('show')) { e.stopImmediatePropagation(); close(); } }, true);
  app.openLetters = pid => {
    const st = app.st; if (!st) return;
    const p = st._rt.pById.get(pid); if (!p) return;
    const s = st._rt.sById.get(p.s), yr = Math.floor(st.day / YEAR) + 1;
    const { oral, list } = letters(st, p);
    const R = s ? rumours(st, s) : [];
    ov.innerHTML = `<div class="po-box"><button class="po-x" aria-label="${L('Schließen', 'Close')}">×</button>
      <h2>${oral ? L('Worte von', 'Words from') : L('Briefe von', 'Letters from')} ${esc(p.n)}</h2>
      ${list.length ? list.map(l => `<article class="po-l${oral ? ' oral' : ''}"><small>${oral ? L('lässt ausrichten an', 'sends word to') : L('an', 'to')} <button data-pid="${l.to.id}">${esc(l.to.n)}</button>${l.far && l.place ? ' · ' + esc(l.place) : ''} · ${L('Jahr', 'Year')} ${yr}</small><p><i>${esc(l.hello)},</i> ${esc(l.text)}</p><em>${esc(p.n)}</em></article>`).join('')
        : `<p class="po-0">${L('Dieser Mensch hat niemanden, dem er schreiben könnte.', 'This person has no one to write to.')}</p>`}
      ${R.length ? `<h3>${L(`Was man sich in ${esc(s.name)} erzählt`, `What people say in ${esc(s.name)}`)}</h3><ul class="po-r">${R.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}</div>`;
    ov.classList.add('show');
    ov.querySelector('.po-x').onclick = close;
    ov.querySelectorAll('button[data-pid]').forEach(b => { b.onclick = () => { close(); app.selectPerson && app.selectPerson(+b.dataset.pid, true); }; });
    app.sound && app.sound.openSnd && app.sound.openSnd();
  };
}
