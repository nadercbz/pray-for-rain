// Gesichter der Menschen in Auswahl und Geschichte: Figuren im Pixar Look aus Higgsfield (assets/heroes/).
// Erwachsene als kleine Videoschleifen (atmen, blinzeln, schauen zur Seite), Alte und Kinder als Standbild.
// Welches Gesicht passt, entscheiden Geschlecht, Hautton der Sippe, Haarfarbe und Alter (wie personLook in people.js).
// Einmal gewählte Gesichter bleiben: st.hero.faces = { personId: 'f3' }.
import { DAYS_PER_YEAR } from '../sim/data.js';

const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
// gleiche Rechnung wie personLook: Hautton 0 (hell) bis 5 (sehr dunkel), Haar 0..7
const skinOf = p => Math.floor(hash(p.clan ? p.clan.length * 7 + p.clan.charCodeAt(0) : p.id, 4) * 6);
const HAIR_CLASS = ['dark', 'dark', 'brown', 'brown', 'blond', 'blond', 'red', 'dark'];
const hairOf = p => HAIR_CLASS[Math.floor(hash(p.id, 18) * 8)];
const ageOf = (st, p) => Math.floor((st.day - p.b) / DAYS_PER_YEAR);

// Die Figuren auf den Bögen (assets/raw/sheet_women.png, sheet_men.png): Hautton, Haar, ungefähres Alter
const ADULT = {
  f: [[0, 'dark', 25], [0.5, 'red', 30], [1, 'dark', 20], [1, 'blond', 35], [2, 'dark', 28], [3, 'dark', 40], [4, 'dark', 22], [5, 'dark', 33]],
  m: [[0, 'brown', 28], [0, 'blond', 20], [1, 'red', 38], [1, 'dark', 25], [2, 'dark', 32], [3, 'dark', 18], [4, 'dark', 42], [5, 'dark', 27]],
};

function cost(p, age, [sk, hair, a]) {
  const s = skinOf(p), h = hairOf(p);
  let c = Math.abs(s - sk) * 2;
  if (h !== hair) c += (h === 'brown' && hair === 'dark') || (h === 'dark' && hair === 'brown') ? 0.4 : (s >= 3 ? 0.3 : 1.6);
  c += Math.abs(age - a) / 8;
  return c;
}

// Beste Figur für einen Erwachsenen; taken = schon vergebene Gesichter (damit in der Auswahl niemand doppelt ist)
export function adultFace(st, p, taken) {
  const sex = p.sex === 'f' ? 'f' : 'm', age = ageOf(st, p);
  let best = 0, bc = 1e9;
  ADULT[sex].forEach((d, i) => {
    const c = cost(p, age, d) + (taken && taken.has(sex + i) ? 6 : 0) + hash(p.id, 90 + i) * 0.05;
    if (c < bc) { bc = c; best = i; }
  });
  return sex + best;
}

// Gesicht für die Anzeige: Kinder und Alte als Standbild, sonst die gemerkte oder passende Figur
export function faceOf(st, p) {
  const age = ageOf(st, p), sex = p.sex === 'f' ? 'f' : 'm', dark = skinOf(p) >= 3 ? 1 : 0;
  if (age < 14) return { still: `assets/heroes/${sex}k${dark}.webp` };
  if (age >= 60) return { still: `assets/heroes/${sex}o${dark}.webp` };
  const faces = st.hero && st.hero.faces;
  const key = (faces && faces[p.id]) || adultFace(st, p);
  return { key, video: `assets/heroes/${key}.mp4`, poster: `assets/heroes/${key}.webp` };
}

export function faceHTML(f, cls = '') {
  if (f.video) return `<div class="face ${cls}"><img src="${f.poster}" alt=""><video src="${f.video}" poster="${f.poster}" autoplay loop muted playsinline preload="auto"></video></div>`;
  return `<div class="face still ${cls}"><img src="${f.still}" alt=""></div>`;
}

// Gesicht dauerhaft merken (beim Wählen und bei der Übergabe an Nachfahren)
export function keepFace(st, p, key) {
  if (!st.hero) return;
  st.hero.faces = st.hero.faces || {};
  st.hero.faces[p.id] = key || st.hero.faces[p.id] || adultFace(st, p);
}
