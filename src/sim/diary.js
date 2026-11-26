// Tagebücher: Ein Mensch schreibt in der Ich-Form über sein Leben, seine Familie und was in der Welt geschieht.
// Kinder und Enkel fragen nach, er erzählt ihnen von früher. Stirbt er, schreibt das Kind weiter, das am meisten
// gefragt hat (sonst ein Enkel, der Partner, ein enger Freund). So entsteht über Generationen eine Familiengeschichte.
// st.diaries = [{ id, line: [Schreiber], cur, start, end, asks: {id: n}, e: [[Tag, Art, Text, Schreiber, Wichtigkeit]] }]
// Arten: life (eigenes Leben), fam (Familie), world (Welt), tale (Erzählen), pass (Übergabe), secret (Geheimes)
// Nur Text, die Simulation hängt nicht davon ab. Die Zufälle kommen aus Hashes, nicht aus rng(st).
import * as D from './data.js';
import { ageOf, yearOf, members } from './util.js';
import { L } from '../i18n.js';

const MAX_ENTRIES = 1400;
const MAX_DIARIES = 6;
const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const pick = (arr, a, b) => arr[Math.floor(hash(a, b) * arr.length) % arr.length];
const isF = p => p && p.sex === 'f';
const child = p => (isF(p) ? L('Tochter', 'daughter') : L('Sohn', 'son'));
const parentWord = p => (isF(p) ? L('Mutter', 'mother') : L('Vater', 'father'));
const spouseWord = p => (isF(p) ? L('Frau', 'wife') : L('Mann', 'husband'));
const grandWord = p => (isF(p) ? L('Enkelin', 'granddaughter') : L('Enkel', 'grandson'));
const friendWord = p => (isF(p) ? L('Freundin', 'friend') : L('Freund', 'friend'));
const her = p => (isF(p) ? L('ihr', 'her') : L('ihm', 'him'));

// ---------- Anlegen ----------

export function startDiary(st, p, quiet) {
  st.diaries = st.diaries || [];
  if (st.diaries.some(d => d.cur === p.id && !d.end)) return st.diaries.find(d => d.cur === p.id && !d.end);
  // Platz schaffen: zuerst beendete, dann die älteste
  while (st.diaries.length >= MAX_DIARIES) {
    // das Buch deines Menschen (hero) bleibt immer
    const k = st.diaries.findIndex(d => d.end && !d.hero);
    const j = k >= 0 ? k : st.diaries.findIndex(d => !d.hero);
    if (j < 0) break;
    st.diaries.splice(j, 1);
  }
  st.diaryId = (st.diaryId || 0) + 1;
  const d = { id: st.diaryId, line: [p.id], names: { [p.id]: p.n }, cur: p.id, start: st.day, asks: {}, e: [] };
  st.diaries.push(d);
  const s = st._rt.sById.get(p.s);
  const age = Math.floor(ageOf(st, p));
  add(d, st.day, 'pass', L(`Ich bin ${p.n} aus der Familie ${p.clan}, ${age} Jahre alt, ich lebe in ${s ? s.name : 'der Fremde'}. Ab heute schreibe ich auf, was geschieht. Vielleicht liest es eines Tages jemand.`,
    `I am ${p.n} of the ${p.clan} family, ${age} years old, and I live in ${s ? s.name : 'a strange land'}. From today on I will write down what happens. Perhaps someone will read it one day.`), p, 2);
  // Erinnerungen: was man sich in der Familie und im Ort erzählt
  const past = st.chronicle.filter(c => c.imp >= 2 && (c.s === p.s || c.s === -1) && c.d < st.day).slice(-3);
  for (const c of past) add(d, st.day, 'tale', L(`Die Alten erzählen von Jahr ${yearOf(c.d)}: ${c.t}`, `The elders tell of year ${yearOf(c.d)}: ${c.t}`), p, 1);
  snapshot(st, p);
  void quiet;
  return d;
}

function add(d, day, k, text, p, imp = 1, raw) {
  d.e.push(raw ? [day, k, text, p ? p.id : 0, imp, raw] : [day, k, text, p ? p.id : 0, imp]);
  if (d.e.length > MAX_ENTRIES) {
    const i = d.e.findIndex(x => x[4] === 0);
    d.e.splice(i >= 0 ? i : 0, 1);
  }
}

// Was über einen Menschen bekannt ist, um Änderungen zu erkennen (nur zur Laufzeit)
function snapshot(st, p) {
  const rt = st._rt;
  const kids = (rt.kidsOf.get(p.id) || []).filter(k => rt.pById.has(k.id)).map(k => k.id);
  const grand = [];
  for (const k of kids) for (const g of (rt.kidsOf.get(k) || [])) if (rt.pById.has(g.id)) grand.push(g.id);
  const friends = Object.entries(p.ties || {}).filter(([, v]) => v > 60).map(([id]) => +id);
  const enemies = Object.entries(p.ties || {}).filter(([, v]) => v < -60).map(([id]) => +id);
  const own = st.buildings.filter(b => b.own === p.id).length;
  const kidsPa = {};
  for (const k of kids) { const q = rt.pById.get(k); if (q) kidsPa[k] = q.pa || 0; }
  const S = { pa: p.pa || 0, fi: p.fi || 0, lov: p.lov || 0, aff: p.aff || 0, affKnown: p.affKnown || 0, ex: (p.ex || []).length, kids, grand, kidsPa, job: p.job, s: p.s, lt: p.lt || '', cls: p.cls ?? 1,
    sick: p.sick ? 1 : 0, mo: p.mo && rt.pById.has(p.mo) ? p.mo : 0, fa: p.fa && rt.pById.has(p.fa) ? p.fa : 0, debt: p.debt > 0.5 ? 1 : 0, bond: p.bond || 0, friends, enemies, own, dream: p.dream || null, gold: p.gold || 0 };
  (rt.dsnap || (rt.dsnap = new Map())).set(p.id, S);
  return S;
}

// ---------- Täglich ----------

export function diaryStep(st) {
  if (!st.diaries || !st.diaries.length) return;
  const rt = st._rt;
  const today = rt.newChron.slice(rt.newChronDay || 0);
  for (const d of st.diaries) {
    if (d.end) continue;
    let p = rt.pById.get(d.cur);
    if (!p) { p = handOver(st, d); if (!p) continue; }
    const S = rt.dsnap && rt.dsnap.get(p.id);
    if (!S) { snapshot(st, p); continue; }
    diff(st, d, p, S);
    world(st, d, p, today);
    if ((st.day + d.id * 7) % 24 === 0) storytelling(st, d, p);
    snapshot(st, p);
  }
}

function nm(st, id) { const q = st._rt.pById.get(id); return q ? q.n : null; }

function diff(st, d, p, S) {
  const rt = st._rt, day = st.day, s = rt.sById.get(p.s);
  const say = (k, de, en, imp = 1) => add(d, day, k, L(de, en), p, imp);
  const sayT = (k, text, imp = 1) => add(d, day, k, text, p, imp);
  const dead = id => (rt.deadName && rt.deadName.get(id)) || nm(st, id) || '';
  // Liebe und Ehe
  if (p.lov && p.lov !== S.lov && !p.pa) { const q = nm(st, p.lov); if (q) say('secret', `Ich glaube, ich habe mich in ${q} verliebt. Ich sage es keinem.`, `I think I have fallen in love with ${q}. I am telling no one.`); }
  if (p.fi && p.fi !== S.fi) { const q = nm(st, p.fi); if (q) say('life', `${q} und ich haben uns versprochen. In ${Math.max(1, (p.wedAt || day) - day)} Tagen ist die Hochzeit.`, `${q} and I are promised to each other. The wedding is in ${Math.max(1, (p.wedAt || day) - day)} days.`, 1); }
  if (p.pa && p.pa !== S.pa) {
    const q = rt.pById.get(p.pa);
    if (q) {
      if (p.sec) say('secret', `${q.n} und ich leben jetzt zusammen. Heimlich, denn in ${s ? s.name : 'unserem Ort'} würden sie es nicht verstehen.`, `${q.n} and I live together now. In secret, because in ${s ? s.name : 'our town'} they would not understand.`, 2);
      else sayT('life', pick(L([`Heute habe ich ${q.n} geheiratet. Wir haben getanzt, bis das Feuer nur noch glühte.`, `${q.n} ist jetzt mein${isF(q) ? 'e Frau' : ' Mann'}. Das ganze Haus roch nach Brot und Blumen.`],
        [`Today I married ${q.n}. We danced until the fire only glowed.`, `${q.n} is my ${spouseWord(q)} now. The whole house smelled of bread and flowers.`]), day, p.id), 2);
    }
  }
  if (!p.pa && S.pa) {
    const q = S.pa;
    if ((p.ex || []).length > S.ex) say('life', `${dead(q)} und ich gehen getrennte Wege. Ich weiß nicht, ob ich traurig bin oder erleichtert.`, `${dead(q)} and I are going our separate ways. I do not know whether I am sad or relieved.`, 2);
    else say('life', `${dead(q)} ist tot. Das Haus ist so still, dass ich mein Herz höre.`, `${dead(q)} is dead. The house is so quiet that I can hear my heart.`, 2);
  }
  if (p.aff && p.aff !== S.aff) { const q = nm(st, p.aff); if (q) say('secret', `Ich treffe mich heimlich mit ${q}. Niemand darf es wissen. Ich schreibe es nur hier auf.`, `I am meeting ${q} in secret. No one may know. I am only writing it here.`, 1); }
  if (p.affKnown && !S.affKnown) say('secret', 'Es ist herausgekommen. Alle wissen es jetzt. Ich wünschte, ich könnte die Zeit zurückdrehen.', 'It has come out. Everyone knows now. I wish I could turn back time.', 2);
  // Kinder und Enkel
  const kids = (rt.kidsOf.get(p.id) || []).filter(k => rt.pById.has(k.id));
  for (const k of kids) if (!S.kids.includes(k.id) && st.day - k.b < 3) sayT('fam', pick(L([`${k.n} ist geboren, ${isF(k) ? 'eine Tochter' : 'ein Sohn'}. So klein und so laut.`, `Heute kam ${k.n} zur Welt. Ich habe geweint, als ${isF(k) ? 'sie' : 'er'} mich ansah.`],
    [`${k.n} is born, a ${child(k)}. So small and so loud.`, `Today ${k.n} came into the world. I cried when ${isF(k) ? 'she' : 'he'} looked at me.`]), day, k.id), 2);
  for (const id of S.kids) if (!rt.pById.has(id) && rt.deadName && rt.deadName.has(id)) say('fam', `Mein Kind ${dead(id)} ist gestorben. Kein Tag war je schwerer.`, `My child ${dead(id)} has died. No day was ever harder.`, 2);
  for (const k of kids) { const was = S.kidsPa[k.id]; if (k.pa && !was) { const q = nm(st, k.pa); if (q) say('fam', `Mein${isF(k) ? 'e Tochter' : ' Sohn'} ${k.n} hat ${q} geheiratet. Wo sind die Jahre hin?`, `My ${child(k)} ${k.n} married ${q}. Where have the years gone?`, 1); } }
  for (const k of kids) for (const g of (rt.kidsOf.get(k.id) || [])) if (rt.pById.has(g.id) && !S.grand.includes(g.id) && st.day - g.b < 3) say('fam', `Ich bin ${isF(p) ? 'Großmutter' : 'Großvater'} geworden: ${g.n}, ${isF(g) ? 'die Tochter' : 'der Sohn'} von ${k.n}.`, `I have become a ${isF(p) ? 'grandmother' : 'grandfather'}: ${g.n}, the ${child(g)} of ${k.n}.`, 2);
  // Eltern und Freunde
  for (const k of ['mo', 'fa']) if (S[k] && !rt.pById.has(S[k])) say('fam', `${k === 'mo' ? 'Meine Mutter' : 'Mein Vater'} ist gestorben. Ich höre ${k === 'mo' ? 'ihre' : 'seine'} Stimme noch, wenn es still ist.`, `My ${k === 'mo' ? 'mother' : 'father'} has died. I still hear ${k === 'mo' ? 'her' : 'his'} voice when it is quiet.`, 2);
  for (const id of S.friends) if (!rt.pById.has(id) && rt.deadName && rt.deadName.has(id) && id !== S.pa) say('fam', `${dead(id)} ist tot. Wir haben so oft zusammen gelacht.`, `${dead(id)} is dead. We laughed together so often.`, 1);
  for (const [id, v] of Object.entries(p.ties || {})) {
    const q = rt.pById.get(+id);
    if (!q || +id === p.pa) continue;
    if (v > 70 && !S.friends.includes(+id) && hash(day, +id) < 0.5) say('life', `${q.n} ist mir ${isF(q) ? 'eine echte Freundin' : 'ein echter Freund'} geworden.`, `${q.n} has become a true ${friendWord(q)} to me.`, 0);
    if (v < -70 && !S.enemies.includes(+id)) say('life', `Mit ${q.n} rede ich kein Wort mehr.`, `I will not say another word to ${q.n}.`, 0);
  }
  // Arbeit, Ort, Macht, Geld, Gesundheit, Träume
  // Berufswechsel nur, wenn sich wirklich etwas ändert (nicht jede Umbesetzung)
  if (p.job !== S.job && !['kind', 'alt', 'sammler'].includes(p.job) && S.job !== 'kind' && day - (d.jobAt || -1e9) > 24 * 4) { d.jobAt = day; say('life', `Ich arbeite jetzt als ${D.JOBS[p.job]?.name || p.job}.`, `I now work as a ${(D.JOBS[p.job]?.name || p.job).toLowerCase()}.`, 0); }
  if (S.job === 'kind' && p.job !== 'kind' && p.job !== 'alt') say('life', `Ich bin kein Kind mehr. Ab heute bin ich ${D.JOBS[p.job]?.name || p.job}.`, `I am no longer a child. From today I am a ${(D.JOBS[p.job]?.name || p.job).toLowerCase()}.`, 1);
  if (p.s !== S.s && s) say('life', `Wir leben jetzt in ${s.name}. Alles riecht hier anders.`, `We live in ${s.name} now. Everything smells different here.`, 1);
  if (p.lt && !S.lt) say('life', `Sie haben mich zur Führung von ${s ? s.name : 'unserem Ort'} bestimmt. ${p.lt}. Ich hoffe, ich werde ihnen gerecht.`, `They have chosen me to lead ${s ? s.name : 'our town'}. ${p.lt}. I hope I will do them justice.`, 2);
  if (!p.lt && S.lt) say('life', 'Ich führe nicht mehr. Es ist leichter so, aber auch leerer.', 'I no longer lead. It is easier this way, but emptier too.', 1);
  if ((p.cls ?? 1) > S.cls && p.cls >= 3 && day - (d.richAt || -1e9) > 24 * 5) { d.richAt = day; say('life', `Wir gehören jetzt zu den Reichen. ${Math.round(p.gold || 0)} in der Truhe, wer hätte das gedacht.`, `We are among the rich now. ${Math.round(p.gold || 0)} in the chest, who would have thought.`, 1); }
  if ((p.poor || 0) > 5 && !(d.poorAt && day - d.poorAt < 24 * 5)) { d.poorAt = day; say('life', 'Das Geld reicht nicht mehr. Ich zähle jede Münze zweimal.', 'The money is not enough any more. I count every coin twice.', 1); }
  if (p.debt > 0.5 && !S.debt) { const c = p.cred < 0 ? L('der Bank', 'the bank') : nm(st, p.cred) || L('jemandem', 'someone'); say('life', `Ich musste mir Geld leihen, bei ${c}. Ich schäme mich ein wenig.`, `I had to borrow money from ${c}. I am a little ashamed.`, 1); }
  if (p.bond && !S.bond) say('life', 'Meine Schulden fressen meinen Lohn. Ich arbeite für einen anderen.', 'My debts eat my wages. I am working for someone else.', 1);
  const own = st.buildings.filter(b => b.own === p.id).length;
  if (own > S.own) say('life', own === 1 ? 'Ich besitze jetzt etwas Eigenes. Ein Stück Land, das mir gehört.' : `Ich besitze jetzt ${own} Häuser und Betriebe.`, own === 1 ? 'I own something of my own now. A piece of land that is mine.' : `I now own ${own} houses and businesses.`, 0);
  if (p.sick && !S.sick) say('life', 'Ich habe Fieber. Die Wände drehen sich.', 'I have a fever. The walls are spinning.', 0);
  if (p.dream && p.dream !== S.dream) say('life', `Ich hatte einen Traum, so klar wie der Tag: ${D.DREAMS[p.dream]?.name || ''}. Ich glaube, er kam nicht von mir.`, `I had a dream, as clear as day: ${D.DREAMS[p.dream]?.name || ''}. I do not think it came from me.`, 2);
}

// Was in der Welt geschieht, aus der Sicht des Schreibers
function world(st, d, p, today) {
  const rt = st._rt, s = rt.sById.get(p.s);
  for (const c of today) {
    const here = c.s === p.s;
    const sameIsle = c.s > 0 && rt.sById.get(c.s)?.isle === (s ? s.isle : -1);
    if (!(here || (sameIsle && c.imp >= 1) || (c.s === -1 && c.imp >= 1) || c.imp >= 2)) continue;
    if (!here && c.imp < 1) continue;
    const seen = ['natur', 'gott', 'krieg', 'fest', 'bau', 'deutung', 'mythos'].includes(c.k);
    const pre = here ? pick(seen ? L(['', 'Heute: ', 'Ich habe es mit eigenen Augen gesehen. ', 'Alle reden davon. '], ['', 'Today: ', 'I saw it with my own eyes. ', 'Everyone is talking about it. ']) : L(['', '', 'Heute: ', 'Alle reden davon. '], ['', '', 'Today: ', 'Everyone is talking about it. ']), st.day, c.t.length)
      : pick(L(['Man erzählt sich: ', 'Ein Händler berichtet: ', 'Die Nachricht kam heute: '], ['People say: ', 'A trader reports: ', 'The news came today: ']), st.day, c.t.length);
    add(d, st.day, 'world', pre + c.t, p, here ? Math.max(1, c.imp) : 0, c.t);
  }
}

// Kinder und Enkel fragen, der Schreiber erzählt von früher
function storytelling(st, d, p) {
  const rt = st._rt;
  if (ageOf(st, p) < 26) return;
  const young = [];
  const fam = (rt.kidsOf.get(p.id) || []).filter(k => rt.pById.has(k.id));
  for (const k of fam) { young.push(k); for (const g of (rt.kidsOf.get(k.id) || [])) if (rt.pById.has(g.id)) young.push(g); }
  const ask = young.filter(k => k.s === p.s && ageOf(st, k) >= 5 && ageOf(st, k) <= 16);
  if (!ask.length) return;
  const k = ask[Math.floor(hash(st.day, p.id) * ask.length)];
  // Am liebsten die großen Ereignisse, und nicht immer dieselben
  const told = new Set(d.e.filter(x => x[1] === 'tale').slice(-12).map(x => x[6]));
  const pool = d.e.filter(x => (x[1] === 'world' || x[1] === 'life' || x[1] === 'fam') && x[4] >= 1 && st.day - x[0] > 24 * 3 && !told.has(x[0] * 1000 + x[2].length));
  if (!pool.length) return;
  const big = pool.filter(x => x[4] >= 2);
  const old = big.length && hash(st.day, k.id) < 0.7 ? big : pool;
  const ev = old[Math.floor(hash(k.id, st.day) * old.length)];
  const grand = (rt.kidsOf.get(p.id) || []).every(c => c.id !== k.id);
  const who = grand ? grandWord(k) : child(k);
  const src = ev[5] || ev[2];
  const short = src.length > 180 ? src.slice(0, 177) + '…' : src;
  const Q = L([
    `${k.n}, ${grand ? 'mein' + (isF(k) ? 'e Enkelin' : ' Enkel') : 'mein' + (isF(k) ? 'e Tochter' : ' Sohn')}, fragt mich, wie es früher war.`,
    `Am Feuer will ${k.n} wieder eine Geschichte hören.`,
    `${k.n} fragt, warum die Alten manchmal so still werden.`,
    `${k.n} kann nicht schlafen und will wissen, was in Jahr ${yearOf(ev[0])} geschah.`,
  ], [
    `${k.n}, my ${who}, asks me what it was like in the old days.`,
    `By the fire ${k.n} wants to hear another story.`,
    `${k.n} asks why the old ones sometimes fall so quiet.`,
    `${k.n} cannot sleep and wants to know what happened in year ${yearOf(ev[0])}.`,
  ]);
  // Was frühere Schreiber erlebt haben, wird vorgelesen, nicht als eigenes erzählt
  const by = ev[3] && ev[3] !== p.id && ev[1] !== 'world' ? d.names[ev[3]] : null;
  add(d, st.day, 'tale', pick(Q, st.day, k.id) + ' ' + (by
    ? L(`Ich lese ${her(k)} vor, was ${by} im Jahr ${yearOf(ev[0])} geschrieben hat: „${short}“`, `I read to ${her(k)} what ${by} wrote in year ${yearOf(ev[0])}: "${short}"`)
    : L(`Ich erzähle ${her(k)} von Jahr ${yearOf(ev[0])}: „${short}“`, `I tell ${her(k)} about year ${yearOf(ev[0])}: "${short}"`)), p, 1);
  d.e[d.e.length - 1][6] = ev[0] * 1000 + ev[2].length;
  d.asks[k.id] = (d.asks[k.id] || 0) + 1;
}

// Der Schreiber ist gestorben: wer schreibt weiter?
function handOver(st, d) {
  const rt = st._rt;
  const oldId = d.cur, oldName = d.names[oldId] || '';
  const kids = st.people.filter(k => (k.mo === oldId || k.fa === oldId || k.ad === oldId) && ageOf(st, k) >= 8);
  let heir = kids.sort((a, b) => (d.asks[b.id] || 0) - (d.asks[a.id] || 0) || a.b - b.b)[0];
  let rel = heir ? child(heir) : '';
  if (!heir) {
    const grand = st.people.filter(g => kids.length === 0 && ((g.mo && (rt.kidsOf.get(oldId) || []).some(k => k.id === g.mo)) || (g.fa && (rt.kidsOf.get(oldId) || []).some(k => k.id === g.fa))) && ageOf(st, g) >= 8);
    heir = grand.sort((a, b) => (d.asks[b.id] || 0) - (d.asks[a.id] || 0))[0];
    if (heir) rel = grandWord(heir);
  }
  if (!heir) { const sp = st.people.find(q => q.exw === oldId && !q.pa); if (sp) { heir = sp; rel = isF(sp) ? L('Witwe', 'widow') : L('Witwer', 'widower'); } }
  if (!heir) {
    const fr = st.people.filter(q => q.ties && q.ties[oldId] > 40).sort((a, b) => b.ties[oldId] - a.ties[oldId])[0];
    if (fr) { heir = fr; rel = friendWord(fr); }
  }
  // Dein Mensch (hero.js): lieber irgendein Nachfahre oder Verwandter als ein Ende der Geschichte
  if (!heir && d.hero && st.hero) {
    const kin = new Set(st.hero.kin || []);
    heir = st.people.filter(q => kin.has(q.id) && q.id !== oldId && ageOf(st, q) >= 8).sort((a, b) => a.b - b.b)[0]
      || st.people.filter(q => q.clan === st.hero.clan && q.id !== oldId && ageOf(st, q) >= 12).sort((a, b) => a.b - b.b)[0];
    if (heir) rel = isF(heir) ? L('Verwandte', 'relative') : L('Verwandter', 'relative');
  }
  if (!heir) {
    d.end = st.day;
    add(d, st.day, 'pass', L(`${oldName} ist gestorben, und niemand ist da, der weiterschreibt. Hier endet das Buch.`, `${oldName} has died, and there is no one left to keep writing. Here the book ends.`), null, 2);
    return null;
  }
  d.cur = heir.id;
  d.line.push(heir.id);
  d.names[heir.id] = heir.n;
  const s = rt.sById.get(heir.s);
  const told = d.e.filter(x => x[1] === 'tale' && x[3] === oldId).slice(-2).map(x => x[2].split(/[„"]/)[1]).filter(Boolean).map(t => t.replace(/[“"]$/, ''));
  add(d, st.day, 'pass', L(`Heute haben wir ${oldName} begraben. Ich bin ${heir.n}, ${rel === child(heir) ? (isF(heir) ? 'die Tochter' : 'der Sohn') : rel === grandWord(heir) ? (isF(heir) ? 'die Enkelin' : 'der Enkel') : rel}. ${oldName} hat mir dieses Buch gegeben.${told.length ? ' Wie oft hat ' + oldName + ' mir erzählt: „' + told[0] + '“' : ''} Jetzt schreibe ich weiter, in ${s ? s.name : 'der Fremde'}.`,
    `Today we buried ${oldName}. I am ${heir.n}, ${oldName}'s ${rel}. ${oldName} gave me this book.${told.length ? ' How often ' + oldName + ' told me: "' + told[0] + '"' : ''} Now I will keep writing, in ${s ? s.name : 'a strange land'}.`), heir, 2);
  snapshot(st, heir);
  return heir;
}

// Für Hinweise aus dem Bild (Geistmodus): eine Notiz, wenn der Schreiber etwas spürt
export function diaryNote(st, pid, de, en) {
  for (const d of st.diaries || []) if (d.cur === pid && !d.end) add(d, st.day, 'secret', L(de, en), st._rt.pById.get(pid), 1);
}

// Lebensgeschichte für jeden Menschen, auch ohne Tagebuch: Lebenslauf plus was in seinem Ort geschah
export function lifeStory(st, p) {
  const rt = st._rt, out = [];
  for (const [day, t] of p.bio) out.push([day, 'life', t, p.id, 1]);
  const s = rt.sById.get(p.s);
  for (const c of st.chronicle) if (c.d >= p.b && (c.s === p.s || (c.imp >= 2 && (c.s === -1 || rt.sById.get(c.s)?.isle === (s ? s.isle : -1))))) out.push([c.d, 'world', c.t, 0, c.imp]);
  out.sort((a, b) => a[0] - b[0]);
  return out;
}

// Neue Welt oder alter Spielstand: ein erstes Tagebuch für den Menschen, der die größte Siedlung prägt
export function initDiaries(st) {
  if (st.diaries) return;
  st.diaries = [];
  const s = st.settlements.filter(o => o.alive).sort((a, b) => b.pop - a.pop)[0];
  if (!s) return;
  const M = members(st, s);
  const p = (s.gov.leader && st._rt.pById.get(s.gov.leader)) || M.adults[0];
  if (p) startDiary(st, p, true);
}
