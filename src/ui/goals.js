// Ziele nach dem Tutorial (seit 26.11.2026, PLAN_QUALITAET.md Runde 6): unten links steht immer der nächste sinnvolle
// Schritt, damit man nach der Einführung weiß, worauf man hinspielen kann. Reine Anzeige, die Welt läuft auch ohne.
// Jedes Ziel prüft den Spielstand (st), erreichte Ziele merkt sich der Browser je Welt (pfr.goals). Ausblenden: Kreuz
// am Ziel oder in den Einstellungen (pfr.goalsOff).
import { scenarioOf } from './welten.js';
import { L } from '../i18n.js';

const KEY = 'pfr.goals', OFF = 'pfr.goalsOff';
const alive = st => st.settlements.filter(s => s.alive);
const era = st => Math.max(0, ...st.isles.map(i => i.era | 0));
const GOALS = [
  { id: 'kraft', t: L('Wirke deine erste Kraft', 'Use your first power'), h: L('Wähle unten eine Karte, zum Beispiel Regen.', 'Pick a card below, for example Rain.'), ok: st => (st.counts.powers | 0) >= 1 },
  { id: 'gebet', t: L('Erhöre ein Gebet', 'Answer a prayer'), h: L('Oben stehen die Gebete. Wirke die Kraft, um die gebeten wird.', 'Prayers appear at the top. Use the power they ask for.'), ok: st => (st.counts.answered | 0) >= 1 },
  { id: 'dorf', t: L('Führe dein Volk in die Dorfzeit', 'Lead your people into the Village Age'), h: L('Regen und Sonne lassen die Ernte wachsen. Träume bringen neues Wissen.', 'Rain and sun grow the harvest. Dreams bring new knowledge.'), ok: st => era(st) >= 1, n: st => [era(st), 1] },
  { id: 'ort2', t: L('Ein zweiter Ort entsteht', 'A second settlement is founded'), h: L('Wächst ein Ort, ziehen Menschen weiter und gründen einen neuen.', 'When a place grows, people move on and found a new one.'), ok: st => alive(st).length >= 2, n: st => [alive(st).length, 2] },
  { id: 'p100', t: L('100 Menschen leben in deiner Welt', '100 people live in your world'), h: L('Halte Hunger und Seuchen fern.', 'Keep hunger and plague away.'), ok: st => st.people.length >= 100, n: st => [st.people.length, 100] },
  { id: 'mythos', t: L('Ein Mythos entsteht', 'A myth is born'), h: L('Große Zeichen wie Blitz, Regenbogen oder ein Stern bleiben in Erinnerung.', 'Great signs such as lightning, a rainbow or a star are remembered.'), ok: st => (st.myths || []).length >= 1 },
  { id: 'bronze', t: L('Erreiche die Bronzezeit', 'Reach the Bronze Age'), h: L('Der Funke der Erkenntnis und Träume vom Wissen helfen.', 'The Spark of insight and dreams of knowledge help.'), ok: st => era(st) >= 2, n: st => [era(st), 2] },
  { id: 'kontakt', t: L('Zwei Völker begegnen sich', 'Two peoples meet'), h: L('Träume vom Meer schicken Schiffe hinaus.', 'Dreams of the sea send ships out.'), ok: st => st.isles.some(i => (i.contact || []).length > 0) },
  { id: 'stadt', t: L('Erreiche die Zeit der Stadtstaaten', 'Reach the age of City States'), h: '', ok: st => era(st) >= 3, n: st => [era(st), 3] },
  { id: 'p500', t: L('500 Menschen leben in deiner Welt', '500 people live in your world'), h: '', ok: st => st.people.length >= 500, n: st => [st.people.length, 500] },
  { id: 'koenig', t: L('Erreiche die Königreiche', 'Reach the Kingdoms'), h: '', ok: st => era(st) >= 4, n: st => [era(st), 4] },
  { id: 'industrie', t: L('Erreiche das Zeitalter der Industrie', 'Reach the age of Industry'), h: '', ok: st => era(st) >= 6, n: st => [era(st), 6] },
  { id: 'p1500', t: L('1500 Menschen leben in deiner Welt', '1500 people live in your world'), h: '', ok: st => st.people.length >= 1500, n: st => [st.people.length, 1500] },
  { id: 'modern', t: L('Erreiche die Moderne', 'Reach the Modern Age'), h: L('Danach geht der Fortschritt ohne Ende weiter, bis zu den Sternen.', 'After that, progress goes on without end, all the way to the stars.'), ok: st => era(st) >= 7, n: st => [era(st), 7] },
];

export function initGoals(app) {
  let off = false;
  try { off = localStorage.getItem(OFF) === '1'; } catch { /* egal */ }
  const el = document.createElement('div');
  el.id = 'goal';
  el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
  document.body.append(el);
  let cur = null, done = new Set(), seed = null, flash = 0;
  const load = () => { done = new Set(); try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d && d.seed === app.st.seed) done = new Set(d.done); } catch { /* egal */ } };
  const store = () => { try { localStorage.setItem(KEY, JSON.stringify({ seed: app.st.seed, done: [...done] })); } catch { /* egal */ } };
  const draw = (g, st, won) => {
    const p = g.n ? g.n(st) : null;
    el.innerHTML = `<span class="gk">${won ? L('Geschafft', 'Done') : L('Nächstes Ziel', 'Next goal')}</span><b>${g.t}</b>${p && !won ? `<i class="gp"><i style="width:${Math.max(4, Math.min(100, p[0] / p[1] * 100)).toFixed(0)}%"></i></i>` : ''}${g.h && !won ? `<small>${g.h}</small>` : ''}<button class="gx" title="${L('Ziele ausblenden', 'Hide goals')}" aria-label="${L('Ziele ausblenden', 'Hide goals')}">×</button>`;
    el.classList.toggle('won', !!won);
    el.querySelector('.gx').onclick = () => api.setOff(true);
  };
  const tick = () => {
    const st = app.st;
    const busy = document.querySelector('#tourTip.show, #heroPick.show, #heroIntro.show, #trailer, #storyAsk, #intro:not(.gone)') || document.body.classList.contains('cine') || app.editor && app.editor.active;
    if (off || !st || !app.running || busy || st.level) { el.classList.remove('show'); return; }
    if (seed !== st.seed) { seed = st.seed; load(); cur = null; }
    // Szenario (ui/welten.js): seine Aufgabe steht vor allen anderen Zielen, Sieg und Niederlage werden einmal gemeldet
    const sc = scenarioOf(st);
    if (sc && !st.scen.done) {
      let g = null; try { g = sc.goal(st, st.scen); } catch { g = null; }
      if (g) {
        if (g.won || g.lost) {
          st.scen.done = g.won ? 'won' : 'lost';
          app.sound && (g.won ? app.sound.goal && app.sound.goal() : app.sound.deny && app.sound.deny());
          app.ui.modal(`<h2>${g.won ? L('Geschafft', 'You did it') : L('Nicht geschafft', 'Not this time')}</h2><p><b>${sc.t}</b></p><p>${g.won ? L('Die Aufgabe ist erfüllt. Die Welt gehört weiter dir, spiele sie, so lange du magst.', 'The task is complete. The world remains yours, play on as long as you like.') : L('Die Aufgabe ist gescheitert. Die Welt läuft weiter, oder du versuchst es im Menü unter Szenarien noch einmal.', 'The task has failed. The world carries on, or try again from the menu under Scenarios.')}</p>`, [[L('Weiter', 'Continue'), null]]);
        } else {
          draw({ t: g.text, h: sc.d, n: () => g.n }, st, false);
          el.querySelector('.gk').textContent = L('Szenario', 'Scenario');
          el.classList.add('show');
          return;
        }
      }
    }
    if (performance.now() < flash) return;
    let changed = false, last = null;
    for (const g of GOALS) { if (done.has(g.id)) continue; let ok = false; try { ok = g.ok(st); } catch { ok = false; } if (ok) { done.add(g.id); changed = true; if (cur === g) last = g; } }
    if (changed) store();
    if (last) { draw(last, st, true); el.classList.add('show'); flash = performance.now() + 3500; app.sound && (app.sound.goal ? app.sound.goal() : app.sound.chime && app.sound.chime()); cur = null; return; }
    const next = GOALS.find(g => !done.has(g.id));
    if (!next) { el.classList.remove('show'); return; }
    cur = next; draw(next, st, false); el.classList.add('show');
  };
  setInterval(tick, 1500);
  const api = { setOff(v) { off = !!v; try { localStorage.setItem(OFF, v ? '1' : '0'); } catch { /* egal */ } tick(); }, isOff: () => off };
  app.goals = api;
  return api;
}
