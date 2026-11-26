// Einstieg (26.11.2026): die ersten Minuten als kleine Geschichte und Tipps im richtigen Moment.
//   Geschichte: in einer frischen Welt erzählen kurze Kapitelkarten, was gerade zum ersten Mal geschieht (Ankunft,
//   erstes Gebet, erstes Zeichen, erstes Kind, erster Abschied, erstes Haus, das Dorf). Jede Karte einmal je Welt.
//   Tipps: einmalige Hinweise, wenn die Lage sie braucht (Dürre, Feuer, Krankheit, Krieg, volle Kraft, Tempo).
// Beides ist reine Anzeige. Geschichte: pfr.story je Welt. Tipps: pfr.tips für alle Welten, abschaltbar (pfr.tipsOff).
import { L } from '../i18n.js';
import * as D from '../sim/data.js';

const YEAR = D.DAYS_PER_YEAR;
const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const put = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
export const tipsOn = () => get('pfr.tipsOff', '0') !== '1';

const STORY = [
  { id: 'ankunft', k: L('Kapitel 1 · Ankunft', 'Chapter 1 · Arrival'), t: L('Sie sind an Land gegangen, müde und nass. Sie wissen nicht, dass du da bist. Noch nicht.', 'They have come ashore, tired and wet. They do not know that you are there. Not yet.'), ok: (st, S) => S.sec > 12 },
  { id: 'feuer', k: L('Kapitel 2 · Das erste Feuer', 'Chapter 2 · The first fire'), t: L('Am Abend brennt ein Feuer. Jemand erzählt von der alten Heimat. Die Kinder schlafen ein.', 'In the evening a fire burns. Someone tells of the old home. The children fall asleep.'), ok: (st, S) => S.sec > 70 && st.day >= 1 },
  { id: 'gebet', k: L('Kapitel 3 · Ein Ruf', 'Chapter 3 · A call'), t: L('Zum ersten Mal ruft jemand in den Himmel. Oben siehst du das Gebet. Ob du antwortest, liegt bei dir.', 'For the first time someone calls out to the sky. You can see the prayer at the top. Whether you answer is up to you.'), ok: st => st.prayers.length > 0 },
  { id: 'zeichen', k: L('Kapitel 4 · Das Zeichen', 'Chapter 4 · The sign'), t: L('Sie haben es gesehen. Heute Abend spricht niemand von etwas anderem. Aus Staunen wird Glaube.', 'They saw it. Tonight no one speaks of anything else. Wonder turns into faith.'), ok: st => (st.counts.powers | 0) >= 1 },
  { id: 'erhoert', k: L('Kapitel 5 · Erhört', 'Chapter 5 · Answered'), t: L('Ein Gebet wurde erhört. Von nun an beten sie nicht mehr ins Leere. Deine Kraft wächst mit ihrem Glauben.', 'A prayer was answered. From now on they no longer pray into the void. Your power grows with their faith.'), ok: st => (st.counts.answered | 0) >= 1 },
  { id: 'kind', k: L('Kapitel 6 · Ein neues Leben', 'Chapter 6 · A new life'), t: L('Das erste Kind der neuen Heimat ist geboren. Es wird diese Insel nie anders kennen.', 'The first child of the new home is born. It will never know this island any other way.'), ok: (st, S) => (st.counts.births | 0) > S.b0 },
  { id: 'abschied', k: L('Kapitel 7 · Der erste Abschied', 'Chapter 7 · The first farewell'), t: L('Jemand ist gestorben. Sie begraben ihn mit Blick aufs Meer. Wer berühmt war, lebt als Ahne weiter.', 'Someone has died. They bury them facing the sea. Those who were famous live on as ancestors.'), ok: (st, S) => (st.counts.deaths | 0) > S.d0 },
  { id: 'haus', k: L('Kapitel 8 · Ein Dach', 'Chapter 8 · A roof'), t: L('Die ersten festen Hütten stehen. Wer baut, hat beschlossen zu bleiben.', 'The first solid huts are standing. Whoever builds has decided to stay.'), ok: (st, S) => st.buildings.filter(b => b.prog >= 1).length >= S.h0 + 4 },
  { id: 'dorf', k: L('Kapitel 9 · Das Dorf', 'Chapter 9 · The village'), t: L('Aus dem Lager ist ein Dorf geworden. Was jetzt kommt, schreiben sie selbst. Du kannst nur Zeichen geben.', 'The camp has become a village. What comes next they will write themselves. You can only give signs.'), ok: st => st.people.length >= 40 || st.settlements.filter(s => s.alive).length > 1 || Math.max(0, ...st.isles.map(i => i.era | 0)) >= 1, end: true },
];

const TIPS = [
  { id: 'voll', t: L('Deine Kraft ist voll. Was darüber hinaus wächst, geht verloren. Wirke etwas, zum Beispiel einen Segen auf die Felder.', 'Your power is full. Anything beyond that is lost. Use something, for example a blessing on the fields.'), ok: (st, S) => st.mana >= D.ERAS[st.era].mana - 1 && S.sec > 150 },
  { id: 'duerre', t: L('Es ist trocken, die Ernte leidet. Regen hilft den Feldern und macht die Menschen froh.', 'It is dry and the harvest suffers. Rain helps the fields and cheers the people.'), ok: st => st.weather.moist < 0.14 && st.day % YEAR < 18 },
  { id: 'feuer', t: L('Es brennt. Regen löscht jedes Feuer, bevor es auf die Häuser überspringt.', 'There is a fire. Rain puts out any fire before it reaches the houses.'), ok: st => st._rt.fire === 1 && st.buildings.some(b => b.hp < 0.8) },
  { id: 'krank', t: L('Eine Krankheit geht um. Die Kraft Heilung hilft einem ganzen Ort auf einmal.', 'A sickness is going round. The Healing power helps a whole settlement at once.'), ok: st => st.people.filter(p => p.sick).length >= 4 },
  { id: 'krieg', t: L('Es ist Krieg. Ein Traum vom Frieden bei einem Anführer kann ihn beenden. Ein Regenbogen stimmt alle milder.', 'There is war. A dream of peace sent to a leader can end it. A rainbow softens everyone.'), ok: st => st.settlements.some(s => s.alive && s.war) },
  { id: 'hunger', t: L('Ein Ort hungert. Segen macht die Felder fruchtbar, Fische füllen die Netze an der Küste.', 'A settlement is starving. Blessing makes fields fertile, Fish fill the nets along the coast.'), ok: st => st.settlements.some(s => s.alive && s.hunger > 0.25) },
  { id: 'tempo', t: L('Die Zeit läuft dir zu langsam? Mit den Tasten 2 und 3 oder oben rechts geht es schneller. Die Leertaste hält die Welt an.', 'Is time too slow for you? Keys 2 and 3, or the buttons at the top right, speed it up. Space pauses the world.'), ok: (st, S) => S.sec > 240 && (S.app.speed || 1) === 1 && !S.spedUp },
  { id: 'mensch', t: L('Klicke einen Menschen an. Jeder hat einen Namen, eine Familie, einen Lebenslauf und schreibt Briefe.', 'Click on a person. Each has a name, a family, a life story and writes letters.'), ok: (st, S) => S.sec > 180 && !S.app.selId && !S.clicked },
  { id: 'kombi', t: L('Zwei Kräfte kurz nacheinander können sich verbinden. Probiere Regen und danach Sonne.', 'Two powers in quick succession can combine. Try Rain and then Sun.'), ok: st => (st.counts.powers | 0) >= 4 },
  { id: 'gunst', t: L('Oben steht die Gunst. Sie steigt mit erhörten Gebeten und fällt, wenn du zerstörst oder Gebete verhallen. Sie bestimmt, wie schnell deine Kraft wächst.', 'Favour is shown at the top. It rises with answered prayers and falls when you destroy or let prayers go unheard. It decides how fast your power grows.'), ok: (st, S) => S.app.geist && (S.app.geist.gunst < 42 || S.app.geist.gunst > 68) },
  { id: 'foto', t: L('Ein schöner Moment? Mit O öffnest du den Fotomodus und nimmst ein Bild oder ein Video auf.', 'A beautiful moment? Press O to open photo mode and take a picture or a video.'), ok: (st, S) => S.sec > 600 && Math.max(0, ...st.isles.map(i => i.era | 0)) >= 1 },
];

export function initEinstieg(app) {
  const S = { app, sec: 0, seed: null, story: null, done: {}, b0: 0, d0: 0, h0: 0, shownAt: 0, spedUp: false, clicked: false };
  let tips = {}; try { tips = JSON.parse(get('pfr.tips', '{}')) || {}; } catch { tips = {}; }
  const sc = document.createElement('div'); sc.id = 'kapitel'; document.body.append(sc);
  const tc = document.createElement('div'); tc.id = 'tipp'; document.body.append(tc);
  let hs = 0;
  const sync = () => {
    const st = app.st; if (!st || S.seed === st.seed) return;
    S.seed = st.seed; S.sec = 0; S.spedUp = false;
    S.b0 = st.counts.births | 0; S.d0 = st.counts.deaths | 0; S.h0 = st.buildings.filter(b => b.prog >= 1).length;
    let d = null; try { d = JSON.parse(get('pfr.story', 'null')); } catch { /* egal */ }
    const fresh = st.day < 2 * YEAR && !st.level && !st.scen;
    S.done = d && d.seed === st.seed ? d.done : fresh ? {} : null;   // null: alte Welt, keine Geschichte
    if (S.done && !(d && d.seed === st.seed)) put('pfr.story', JSON.stringify({ seed: st.seed, done: {} }));
  };
  const busy = () => !!document.querySelector('#tourTip.show, #modal.show, #heroPick.show, #trailer, #storyAsk, #epoche.show, #post.show, #familie.show') || document.body.classList.contains('foto') || (app.speed || 1) >= 100;
  function chapter(c) {
    sc.innerHTML = `<small>${c.k}</small><p>${c.t}</p>`;
    sc.classList.add('show'); clearTimeout(hs); hs = setTimeout(() => sc.classList.remove('show'), 11000);
    sc.onclick = () => sc.classList.remove('show');
    app.sound && app.sound.openSnd && app.sound.openSnd();
  }
  function tip(t) {
    tc.innerHTML = `<small>${L('Tipp', 'Tip')}</small><p>${t.t}</p><div><button class="ok">${L('Verstanden', 'Got it')}</button><button class="ghost off">${L('Keine Tipps mehr', 'No more tips')}</button></div>`;
    tc.classList.add('show');
    const close = () => tc.classList.remove('show');
    tc.querySelector('.ok').onclick = close;
    tc.querySelector('.off').onclick = () => { put('pfr.tipsOff', '1'); close(); };
    setTimeout(close, 20000);
  }
  window.addEventListener('pointerdown', e => { if (e.target && e.target.tagName === 'CANVAS') S.clicked = S.clicked || !!app.selId; }, true);
  setInterval(() => {
    const st = app.st;
    if (!st || !app.running || app.paused) return;
    sync(); S.sec += 2;
    if ((app.speed || 1) > 1) S.spedUp = true;
    if (app.selId) S.clicked = true;
    if (busy() || performance.now() - S.shownAt < 16000) return;
    if (S.done) for (const c of STORY) {
      if (S.done[c.id]) continue;
      let ok = false; try { ok = c.ok(st, S); } catch { ok = false; }
      if (!ok) continue;
      S.done[c.id] = 1; if (c.end) for (const o of STORY) S.done[o.id] = 1;
      put('pfr.story', JSON.stringify({ seed: st.seed, done: S.done }));
      S.shownAt = performance.now(); chapter(c); return;
    }
    if (!tipsOn() || tc.classList.contains('show') || S.sec < 60) return;
    for (const t of TIPS) {
      if (tips[t.id]) continue;
      let ok = false; try { ok = t.ok(st, S); } catch { ok = false; }
      if (!ok) continue;
      tips[t.id] = 1; put('pfr.tips', JSON.stringify(tips));
      S.shownAt = performance.now(); tip(t); return;
    }
  }, 2000);
  S.testChapter = i => chapter(STORY[i || 0]);
  S.testTip = i => tip(TIPS[i || 0]);
  app.einstieg = S;
  return S;
}
