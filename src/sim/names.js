// Jede Siedlung spricht ihre eigene kleine Sprache. Namen entstehen aus Silben.
import { L } from '../i18n.js';

export const LANGS = [
  { // Atlas: warm, berberisch inspiriert
    syl: ['ta', 'zi', 'ri', 'ma', 'nu', 'ya', 'ki', 'la', 'si', 'ra', 'am', 'tin', 'dir', 'mel', 'sa', 'iz', 'ou', 'den', 'ar', 'na'],
    f: ['a', 'i', 'ra', 'ya', 'ine', 'na'], m: ['an', 'ir', 'u', 'as', 'ou', 'en'],
    place: ['dar', 'aghir', 'tisa', 'oued', 'asni', 'amar'],
  },
  { // Lagune: weich, polynesisch klingend
    syl: ['lu', 'mi', 'ko', 'na', 'e', 'ha', 'ri', 'wa', 'lo', 'pa', 'ka', 'nui', 'mo', 'ai', 'le', 'te', 'ho'],
    f: ['a', 'ani', 'ina', 'ea', 'li'], m: ['o', 'u', 'ako', 'oa', 'ki'],
    place: ['nui', 'moana', 'loa', 'kai', 'ahu'],
  },
  { // Nordwind: kantig
    syl: ['bjo', 'ka', 'rik', 'tor', 'ul', 'va', 'gun', 'dal', 'e', 'hel', 'ma', 'sig', 'run', 'ast', 'ol', 'fen'],
    f: ['a', 'hild', 'run', 'dis', 'ja'], m: ['ar', 'ulf', 'ik', 'or', 'stein'],
    place: ['holm', 'vik', 'heim', 'fjell', 'stad'],
  },
  { // Sonnenküste: mediterran
    syl: ['al', 've', 'ri', 'o', 'an', 'ce', 'li', 'da', 'mar', 'te', 'si', 'na', 'lo', 'ber', 'gio', 'fi', 'el'],
    f: ['a', 'ia', 'ella', 'ina', 'e'], m: ['o', 'io', 'eo', 'as', 'ian'],
    place: ['mare', 'serra', 'porto', 'vela', 'luna'],
  },
  { // Fremde vom Meer
    syl: ['xi', 'qua', 'zhe', 'ou', 'yan', 'tse', 'mei', 'kai', 'lin', 'po', 'shu', 'ren', 'ao', 'jin'],
    f: ['mei', 'lin', 'yu', 'a'], m: ['ren', 'kai', 'jin', 'o'],
    place: ['jiang', 'shan', 'wan', 'ling'],
  },
  // Seit 19.10.2026 für die Völker der echten Erde (earth.js langFor). Nur angehängt, die alten Sprachen bleiben gleich.
  { // Stromland: Nil und Ostafrika
    syl: ['ka', 'ne', 'hor', 'set', 'mi', 'ra', 'tep', 'nu', 'amu', 'sen', 'pta', 'is', 'mer', 'ur', 'ankh'],
    f: ['et', 'it', 'ra', 'nefer', 'a'], m: ['es', 'ot', 'hor', 'mose', 'u'],
    place: ['hotep', 'men', 'nefer', 'abu', 'wadj'],
  },
  { // Zweistrom: Euphrat, Tigris, Indus
    syl: ['ur', 'ki', 'lu', 'gal', 'nin', 'sar', 'dum', 'ash', 'ba', 'zi', 'en', 'lil', 'ma', 'du', 'har'],
    f: ['a', 'itu', 'ana', 'ishti'], m: ['um', 'ak', 'abi', 'ish', 'an'],
    place: ['ki', 'dur', 'gal', 'sar', 'abu'],
  },
  { // Hochland der Kondore: Anden und Südamerika
    syl: ['qu', 'tu', 'pa', 'chi', 'ka', 'wa', 'ri', 'ma', 'yu', 'an', 'ti', 'ku', 'la', 'sun', 'pi'],
    f: ['a', 'ya', 'illa', 'sisa'], m: ['ac', 'uq', 'ku', 'pac', 'o'],
    place: ['pampa', 'marka', 'llaqta', 'qucha', 'kancha'],
  },
  { // Präriewind: Nordamerika
    syl: ['wa', 'ko', 'ta', 'ni', 'she', 'yo', 'ma', 'ha', 'ki', 'na', 'so', 'wi', 'ah', 'lo', 'chu'],
    f: ['a', 'ena', 'ita', 'ewa'], m: ['o', 'an', 'atu', 'ahe'],
    place: ['ota', 'wena', 'haska', 'tawa', 'misi'],
  },
  { // Steppe: Mittelasien
    syl: ['ba', 'tur', 'khan', 'ar', 'sa', 'gul', 'ka', 'mir', 'to', 'ul', 'tem', 'bai', 'yer', 'os', 'ag'],
    f: ['gul', 'ai', 'a', 'ana'], m: ['bek', 'tai', 'an', 'ur', 'khan'],
    place: ['kent', 'abad', 'bulak', 'tau', 'kul'],
  },
  { // Südland: Afrika südlich der Sahara
    syl: ['ba', 'ku', 'zi', 'mbe', 'lo', 'na', 'tu', 'wa', 'ndi', 'ma', 'sa', 'ri', 'ko', 'ya', 'nya'],
    f: ['a', 'ini', 'ola', 'esi'], m: ['o', 'ele', 'umi', 'ani'],
    place: ['ngo', 'wezi', 'mbari', 'tunda', 'kaya'],
  },
];

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function clean(s) {
  // doppelte Vokale am Silbenstoß glätten, zu lange Namen kürzen
  s = s.replace(/([aeiou])\1+/g, '$1').replace(/([^aeiou])\1{2,}/g, '$1$1');
  if (s.length > 9) s = s.slice(0, 9);
  return s;
}

export function personName(rng, lang, sex) {
  const G = LANGS[lang % LANGS.length];
  const n = rng.chance(0.6) ? 1 : 2;
  let s = '';
  for (let i = 0; i < n; i++) s += rng.pick(G.syl);
  s += rng.pick(sex === 'f' ? G.f : G.m);
  return cap(clean(s));
}

export function clanName(rng, lang) {
  const G = LANGS[lang % LANGS.length];
  let s = rng.pick(G.syl) + rng.pick(G.syl);
  if (rng.chance(0.5)) s += rng.pick(['n', 'r', 'sh', 'k', 'l', 'th', 'm']);
  return cap(clean(s));
}

export function placeName(rng, lang) {
  const G = LANGS[lang % LANGS.length];
  const base = rng.pick(G.syl) + (rng.chance(0.5) ? rng.pick(G.syl) : '');
  return cap(clean(base + rng.pick(G.place)));
}

export function mythName(rng, kind) {
  const T = {
    blitz: L(['Das Geschenk des Feuers', 'Der Zorn aus den Wolken', 'Die weiße Hand'],
      ['The Gift of Fire', 'The Wrath from the Clouds', 'The White Hand']),
    meteor: L(['Die Nacht des fallenden Sterns', 'Der Himmelsstein', 'Das Sternenherz'],
      ['The Night of the Falling Star', 'The Sky Stone', 'The Star Heart']),
    regenbogen: L(['Die Brücke der Farben', 'Das Band des Friedens'],
      ['The Bridge of Colors', 'The Band of Peace']),
    sturm: L(['Der große Sturm', 'Das Brüllen des Meeres'],
      ['The Great Storm', 'The Roar of the Sea']),
    komet: L(['Der Stern mit dem Schweif', 'Das wandernde Licht'],
      ['The Star with the Tail', 'The Wandering Light']),
    beben: L(['Als die Erde sprach', 'Der Riss'],
      ['When the Earth Spoke', 'The Rift']),
    vulkan: L(['Das Erwachen des Berges', 'Der rote Atem'],
      ['The Awakening of the Mountain', 'The Red Breath']),
    flut: L(['Die große Welle', 'Das Kommen des Meeres'],
      ['The Great Wave', 'The Coming of the Sea']),
    fremde: L(['Die Ankunft der Fremden', 'Das Boot aus dem Morgen'],
      ['The Arrival of the Strangers', 'The Boat from the Morning']),
    heilung: L(['Die heilige Quelle', 'Das Wasser des Lebens'],
      ['The Sacred Spring', 'The Water of Life']),
    segen: L(['Der grüne Frühling', 'Die goldene Ernte'],
      ['The Green Spring', 'The Golden Harvest']),
    fische: L(['Der Silberfang', 'Die Wiederkehr der Fische'],
      ['The Silver Catch', 'The Return of the Fish']),
    nebel: L(['Die Tage im Weißen', 'Der Schleier'],
      ['The Days in the White', 'The Veil']),
    schnee: L(['Der stille Winter', 'Das weiße Schweigen'],
      ['The Quiet Winter', 'The White Silence']),
    seuche: L(['Das Fieber', 'Der graue Sommer'],
      ['The Fever', 'The Gray Summer']),
    traum: L(['Die Vision', 'Der Traum der Seherin'],
      ['The Vision', 'The Dream of the Seer']),
    funke: L(['Der Funke', 'Die Erleuchtung'],
      ['The Spark', 'The Enlightenment']),
    regen: L(['Die Tränen des Himmels', 'Der erlösende Regen'],
      ['The Tears of the Sky', 'The Redeeming Rain']),
    sonne: L(['Der goldene Sommer', 'Das Lächeln der Sonne'],
      ['The Golden Summer', 'The Smile of the Sun']),
  };
  return rng.pick(T[kind] || [L('Das Zeichen', 'The Sign')]);
}
