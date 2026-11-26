// Dein Mensch: Beim Start einer neuen Welt wählt man einen der ersten Siedler. Man erlebt die Geschichte durch ihn,
// sein Tagebuch (diary.js) schreibt er in der Ich-Form, und in "Meine Geschichte" steht sein Leben in kurzen
// Stichpunkten. Stirbt er, geht das Tagebuch an ein Kind (das am meisten gefragt hat), einen Enkel, die Witwe oder
// einen Freund, und die Geschichte geht mit diesem Menschen weiter. Endet die Linie, wählt man einen neuen.
// st.hero = { id, diary, line: [ids], names: {id: Name}, start, log: [[Tag, id, Text, Art]], bio: {id: Anzahl}, end }
// Arten im log: start, life (Lebenslauf), world (Ereignis im Ort), pass (Übergabe), end
// Nur Text und Kamera, die Simulation hängt nicht davon ab.
import { DAYS_PER_YEAR, JOBS } from './data.js';
import { startDiary } from './diary.js';
import { L } from '../i18n.js';

const MAX_LOG = 600;
// Beruf als Wort; am ersten Tag haben die Gestrandeten noch keinen, dann sind sie Siedler
export function jobName(st, p) {
  if (p.job === 'kind' && age(st, p) >= 14) return { de: p.sex === 'f' ? 'Siedlerin' : 'Siedler', en: 'settler', t: L(p.sex === 'f' ? 'Siedlerin' : 'Siedler', 'Settler') };
  const n = JOBS[p.job] ? JOBS[p.job].name : '';
  return { de: n, en: n.toLowerCase(), t: n };
}
const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const age = (st, p) => Math.floor((st.day - p.b) / DAYS_PER_YEAR);

// Eigenschaften als Worte (die stärksten zwei)
const TRAIT = {
  mut: L('mutig', 'brave'), fleiss: L('fleißig', 'hard-working'), glaube: L('fromm', 'devout'), neugier: L('neugierig', 'curious'),
  wut: L('hitzköpfig', 'hot-headed'), charisma: L('einnehmend', 'charming'), kunst: L('verträumt', 'dreamy'),
};
export function traitWords(p) {
  return Object.entries(p.tr || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => TRAIT[k] || k);
}

// Eine kleine Vorgeschichte aus den Eigenschaften (immer gleich für denselben Menschen)
const PAST = {
  mut: L(['Hat als Erste ihren Fuß an Land gesetzt, als das Boot zerbrach.', 'Hat beim Schiffbruch zwei Kinder aus den Wellen gezogen.'], ['Was first to set foot ashore when the boat broke apart.', 'Pulled two children from the waves when the ship went down.']),
  fleiss: L(['Hat schon am ersten Abend eine Hütte aus Treibholz gebaut.', 'Steht vor allen anderen auf und legt sich als Letzte hin.'], ['Built a hut of driftwood on the very first evening.', 'Rises before everyone else and is the last to lie down.']),
  glaube: L(['Glaubt, dass jemand über die Insel wacht, und spricht abends mit dem Himmel.', 'Hat im Sturm ein Licht gesehen, das niemand sonst sah.'], ['Believes someone watches over the island and talks to the sky at night.', 'Saw a light in the storm that no one else saw.']),
  neugier: L(['Will wissen, was hinter jedem Hügel liegt.', 'Sammelt Muscheln, Steine und Geschichten.'], ['Wants to know what lies beyond every hill.', 'Collects shells, stones and stories.']),
  wut: L(['Streitet schnell und vergibt langsam.', 'Hat auf dem Schiff einen Streit angefangen, der fast alle das Leben kostete.'], ['Quick to quarrel and slow to forgive.', 'Started a fight on the ship that nearly cost everyone their lives.']),
  charisma: L(['Wenn sie spricht, hören alle zu.', 'Hat die Verzweifelten am Strand wieder zum Lachen gebracht.'], ['When they speak, everyone listens.', 'Made the desperate laugh again on the beach.']),
  kunst: L(['Singt Lieder über das versunkene Land, aus dem alle kamen.', 'Schnitzt Figuren aus allem, was das Meer anspült.'], ['Sings songs of the sunken land everyone came from.', 'Carves figures from whatever the sea washes ashore.']),
};
// Erde (seit 19.10.2026): keine Gestrandeten. Wo es eine Vorgeschichte ohne Meer gibt, wird sie genommen (mit Stimme),
// für Mut und Kunst gibt es eigene Sätze über das Land (ohne Stimme, nur Text)
const EARTH_PICK = { fleiss: 1, glaube: 1, neugier: 0, wut: 0, charisma: 0 };
const EARTH_PAST = {
  mut: L(['Ist als Erste über den Pass gegangen, als alle anderen zögerten.'], ['Was first to cross the pass when everyone else hesitated.']),
  kunst: L(['Ritzt Tiere und Sterne in die Felsen am Fluss.'], ['Carves animals and stars into the rocks by the river.']),
};
// Welche Vorgeschichte (für die Erzählstimme: assets/voice/<sprache>/bs_<eigenschaft>_<nr>.mp3)
export function backstoryKey(p, earth = false) {
  const top = Object.entries(p.tr || {}).sort((a, b) => b[1] - a[1])[0];
  const list = top ? PAST[top[0]] : null;
  if (earth && top) { if (EARTH_PAST[top[0]]) return ''; if (EARTH_PICK[top[0]] != null) return `bs_${top[0]}_${EARTH_PICK[top[0]]}`; }
  return list ? `bs_${top[0]}_${Math.floor(hash(p.id, 3) * list.length)}` : '';
}
export function backstory(p, earth = false) {
  const top = Object.entries(p.tr || {}).sort((a, b) => b[1] - a[1])[0];
  const list = top ? PAST[top[0]] : null;
  if (!list) return '';
  let t = list[Math.floor(hash(p.id, 3) * list.length)];
  if (earth) t = EARTH_PAST[top[0]] ? EARTH_PAST[top[0]][0] : EARTH_PICK[top[0]] != null ? list[EARTH_PICK[top[0]]] : t;
  if (p.sex !== 'f') t = t.replace('als Erste', 'als Erster').replace('als Letzte', 'als Letzter').replace('Wenn sie spricht', 'Wenn er spricht');
  return t;
}

// Kandidaten für die Wahl: Erwachsene aus der größten Siedlung, möglichst verschieden (Geschlecht, Beruf, Wesen)
export function heroCandidates(st, n = 5) {
  const rt = st._rt;
  // in der Erde die Siedlung des Spielers (sein Volk), sonst die größte
  const s = (st.earth && st.settlements.find(o => o.alive && rt.iById.get(o.isle)?.player)) || st.settlements.filter(o => o.alive).sort((a, b) => b.pop - a.pop)[0];
  const pool = st.people.filter(p => (!s || p.s === s.id) && age(st, p) >= 16 && age(st, p) <= 45 && !p.away);
  const pickd = [], usedTop = new Set();
  for (const p of pool.sort((a, b) => hash(a.id, 7) - hash(b.id, 7))) {
    const top = Object.entries(p.tr).sort((a, b) => b[1] - a[1])[0][0];
    if (usedTop.has(top) && pool.length > n * 2) continue;
    usedTop.add(top); pickd.push(p);
    if (pickd.length >= n) break;
  }
  void rt;
  return pickd;
}

const short = t => { const s = String(t).split(/(?<=[.!?])\s/)[0]; return s.length > 110 ? s.slice(0, 107) + '…' : s; };

// Art eines Ereignisses für die Erzählstimme (src/ui/story_voice.js spielt dann ev_<art>). Nur Text, keine Simulation.
// Reihenfolge zählt: Streit vor Führung, Verlobung vor Hochzeit.
const LIFE_CATS = [
  ['love', /falls in love|verliebt sich|gets engaged|verlobt sich|promised to|versprochen/i],
  ['wed', /marries|heiratet|secretly lives with|heimlich mit/i],
  ['child', /gives birth|^bekommt |becomes the father|wird Vater/i],
  ['divorce', /divorces|scheiden/i],
  ['crisis', /marriage crisis|Ehekrise|secretly loves|heimlich .* liebt/i],
  ['widow', /widowed|Witwe/i],
  ['mourn', /mourns|trauert/i],
  ['quarrel', /enemies|verfeindet|is beaten|verprügelt|in a quarrel|im Streit|erschlägt/i],
  ['pirates', /pirates|Piraten/i],
  ['battle', /fights in the battle|in der Schlacht/i],
  ['dream', /dreams of|träumt von/i],
  ['answered', /prayer answered|wird erhört/i],
  ['discover', /discovers|entdeckt|epiphany|Erleuchtung/i],
  ['leader', /^becomes .+ of |^wird .+ von /i],
  ['move', /moves to|zieht zu|sails to|segelt nach|founds|gründet|leads the split|Abspaltung/i],
];
function lifeCat(t) { for (const [c, re] of LIFE_CATS) if (re.test(t)) return c; return ''; }
function worldCat(c) {
  const t = c.t || '';
  if (/hunger|famine|starv|verhunger|Hungersnot/i.test(t)) return 'hunger';
  if (/fever|sickness|plague|Fieber|Seuche|krank/i.test(t)) return 'plague';
  if (c.k === 'krieg') return /peace|Frieden|truce|Waffenstillstand|treaty|Vertrag/i.test(t) ? 'peace' : 'war';
  if (c.k === 'epoche') return 'era';
  if (c.k === 'mythos') return 'myth';
  if (c.k === 'piraten') return 'pirates';
  return '';
}
function say(st, cat, text) { if (cat) (st._rt.fx || (st._rt.fx = [])).push({ type: 'heroSay', cat, text }); }
function log(st, H, id, text, kind) {
  // dasselbe nicht mehrmals kurz hintereinander (Feindschaften, Gerüchte kommen oft wieder)
  for (let i = H.log.length - 1; i >= 0 && st.day - H.log[i][0] < 72; i--) if (H.log[i][1] === id && H.log[i][2] === text) return;
  H.log.push([st.day, id, text, kind]);
  if (H.log.length > MAX_LOG) { const i = H.log.findIndex(x => x[3] === 'world'); H.log.splice(i >= 0 ? i : 1, 1); }
}

export function chooseHero(st, pid) {
  const p = st._rt.pById.get(pid);
  if (!p) return null;
  const d = startDiary(st, p, true);
  d.hero = true;
  const s = st._rt.sById.get(p.s);
  const kin = st.people.filter(q => q.mo === p.id || q.fa === p.id).map(q => q.id);
  st.hero = { id: p.id, diary: d.id, line: [p.id], names: { [p.id]: p.n }, clan: p.clan, kin, start: st.day, log: [], bio: { [p.id]: p.bio.length }, end: 0 };
  log(st, st.hero, p.id, L(`Du bist ${p.n} aus der Familie ${p.clan}, ${age(st, p)} Jahre alt, ${jobName(st, p).de} in ${s ? s.name : 'der Fremde'}.`, `You are ${p.n} of the ${p.clan} family, ${age(st, p)} years old, ${jobName(st, p).en} in ${s ? s.name : 'a strange land'}.`), 'start');
  const bs = backstory(p);
  if (bs) log(st, st.hero, p.id, bs, 'life');
  return st.hero;
}

// Täglich (nach den Tagebüchern): neue Stichpunkte aus dem Lebenslauf, große Ereignisse im Ort, Übergabe an Nachfahren
export function heroStep(st) {
  const H = st.hero;
  if (!H || H.end) return;
  const rt = st._rt;
  const d = (st.diaries || []).find(x => x.id === H.diary);
  // Übergabe: das Tagebuch hat einen neuen Schreiber
  if (d && d.cur !== H.id && !d.end) {
    const old = H.names[H.id] || '', heir = rt.pById.get(d.cur);
    if (heir) {
      log(st, H, H.id, L(`${old} stirbt.`, `${old} dies.`), 'pass');
      H.id = heir.id; H.line.push(heir.id); H.names[heir.id] = heir.n; H.bio[heir.id] = heir.bio.length;
      log(st, H, heir.id, L(`Die Geschichte geht weiter mit ${heir.n}, ${age(st, heir)} Jahre alt.`, `The story continues with ${heir.n}, ${age(st, heir)} years old.`), 'pass');
      (rt.fx || (rt.fx = [])).push({ type: 'hero', from: old, to: heir.id });
    }
  }
  if (!d || d.end) {
    H.end = st.day;
    log(st, H, H.id, L(`${H.names[H.id] || ''} stirbt, und niemand führt die Geschichte weiter.`, `${H.names[H.id] || ''} dies, and no one carries the story on.`), 'end');
    (rt.fx || (rt.fx = [])).push({ type: 'heroEnd', name: H.names[H.id] || '' });
    return;
  }
  // Familiengedächtnis: wer heute in der Linie geboren wird, gehört dazu (damit Enkel weitererzählen können)
  const kin = new Set(H.kin || []);
  for (const id of H.line) kin.add(id);
  for (let i = st.people.length - 1; i >= 0 && st.people[i].b === st.day; i--) {
    const q = st.people[i];
    if ((q.mo && kin.has(q.mo)) || (q.fa && kin.has(q.fa))) { kin.add(q.id); (H.kin || (H.kin = [])).push(q.id); }
    // Väter bekommen keinen Eintrag im Lebenslauf (nur die Mutter), darum hier
    if (q.fa === H.id) { const t = L(`Wird Vater von ${q.n}.`, `Becomes the father of ${q.n}.`); log(st, H, H.id, t, 'life'); say(st, 'child', t); }
  }
  if (st.day % 24 === 0 && H.kin) H.kin = H.kin.filter(id => rt.pById.has(id));
  const p = rt.pById.get(H.id);
  if (!p) return;
  // Lebenslauf: was neu dazukam (bio hält höchstens 10 Einträge, darum zählen wir mit)
  const seen = H.bio[p.id] ?? p.bio.length;
  if (p.bio.length > seen || (p.bio.length === 10 && p.bio[9] && p.bio[9][0] === st.day && seen === 10)) {
    const fresh = p.bio.length > seen ? p.bio.slice(seen) : [p.bio[9]];
    for (const [day, t] of fresh) {
      if (day !== st.day && day !== st.day - 1) continue;
      const line = t.charAt(0).toUpperCase() + t.slice(1) + '.';
      log(st, H, p.id, line, 'life');
      say(st, lifeCat(t), line);
    }
  }
  H.bio[p.id] = p.bio.length;
  if (st.day - p.b === 60 * DAYS_PER_YEAR) say(st, 'old', L(`${p.n} wird 60.`, `${p.n} turns 60.`));
  // Große Ereignisse im eigenen Ort und auf der Insel
  const today = rt.newChron || [];
  const s = rt.sById.get(p.s);
  for (const c of today) {
    if (c.d !== st.day) continue;
    // Nur was das Leben im Ort wirklich verändert: große Ereignisse, Krieg, Macht, Götter, Feste, Katastrophen
    const own = c.s === p.s, isle = c.s === -1 || (s && rt.sById.get(c.s)?.isle === s.isle);
    if (c.k === 'leben' || c.k === 'wirtschaft') continue;
    const big = c.imp >= 2 && c.k !== 'politik' || (c.imp >= 2 && own);
    const cat = worldCat(c);
    if ((own && (big || ['krieg', 'gott', 'gruendung', 'epoche', 'mythos', 'piraten', 'fund'].includes(c.k))) || (isle && big && c.k !== 'fremde')) { log(st, H, p.id, short(c.t), 'world'); say(st, cat, short(c.t)); }
    else if (own && (cat === 'plague' || cat === 'hunger')) say(st, cat, short(c.t));
  }
}

// Stichpunkte für die Anzeige: nach Schreibern gruppiert
export function heroChapters(st) {
  const H = st.hero;
  if (!H) return [];
  const out = [];
  for (const id of H.line) out.push({ id, name: H.names[id] || '?', alive: st._rt.pById.has(id), items: H.log.filter(x => x[1] === id) });
  return out;
}
