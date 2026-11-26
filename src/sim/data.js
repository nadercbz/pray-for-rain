import { L } from '../i18n.js';

// Alle festen Spielwerte an einer Stelle: Zeit, Epochen, Wissen, Gebäude, Berufe,
// Regierungen, Gesetze, Götterkräfte. Zahlen hier ändern = Spielbalance ändern.

export const DAY_SECONDS = 30;          // Echtzeit-Sekunden pro Spieltag bei 1x
export const DAYS_PER_SEASON = 6;
export const DAYS_PER_YEAR = 24;
export const SEASONS = [L('Frühling', 'Spring'), L('Sommer', 'Summer'), L('Herbst', 'Autumn'), L('Winter', 'Winter')];
export const MAP = 320;                 // Weltraster MAP x MAP (seit 18.10.2026: Archipel plus neue Welt)
export const ARCH = 160;                // der Archipel liegt oben links in ARCH x ARCH (so groß war die ganze Welt bis 18.10.2026)
export const MAX_SETTLEMENTS = 34;      // auf allen Inseln und dem Festland zusammen
export const WORLD_VERSION = 2;
export const CATCHUP_MAX_DAYS = DAYS_PER_YEAR * 1500; // Obergrenze beim Nachholen

export const ERAS = [
  { id: 0, name: L('Ankunft', 'Arrival'), sub: L('Die ersten Feuer', 'The First Fires'), mana: 100 },
  { id: 1, name: L('Dorfzeit', 'Village Age'), sub: L('Felder und Hütten', 'Fields and Huts'), mana: 110 },
  { id: 2, name: L('Bronzezeit', 'Bronze Age'), sub: L('Märkte und Häfen', 'Markets and Harbors'), mana: 120 },
  { id: 3, name: L('Stadtstaaten', 'City States'), sub: L('Stein, Recht und Schrift', 'Stone, Law and Writing'), mana: 140 },
  { id: 4, name: L('Königreiche', 'Kingdoms'), sub: L('Burgen und Mühlen', 'Castles and Mills'), mana: 150 },
  { id: 5, name: L('Renaissance', 'Renaissance'), sub: L('Bücher und Sterne', 'Books and Stars'), mana: 160 },
  { id: 6, name: L('Industrie', 'Industry'), sub: L('Dampf und Strom', 'Steam and Power'), mana: 180 },
  { id: 7, name: L('Moderne', 'Modern Age'), sub: L('Türme aus Licht', 'Towers of Light'), mana: 200 },
];

// Wissen: id, Name, Epoche, Kosten, Voraussetzungen, kurze Wirkung
export const TECHS = [
  { id: 'feuer', name: L('Feuer', 'Fire'), era: 0, cost: 24, req: [], info: L('Wärme, gekochtes Essen, weniger Kältetote', 'Warmth, cooked food, fewer cold deaths') },
  { id: 'rituale', name: L('Rituale', 'Rituals'), era: 0, cost: 30, req: ['feuer'], info: L('Erste Schreine für das Göttliche', 'First shrines for the divine') },
  { id: 'werkzeug', name: L('Steinwerkzeug', 'Stone Tools'), era: 0, cost: 36, req: [], info: L('Holzfäller, Steinbruch, Werkstatt', 'Woodcutter, quarry, workshop') },
  { id: 'jagd', name: L('Jagd', 'Hunting'), era: 0, cost: 28, req: ['werkzeug'], info: L('Mehr Nahrung aus dem Wald', 'More food from the forest') },
  { id: 'ackerbau', name: L('Ackerbau', 'Farming'), era: 1, cost: 80, req: ['werkzeug'], key: 1, info: L('Felder anlegen', 'Lay out fields') },
  { id: 'fischerei', name: L('Fischerei', 'Fishing'), era: 1, cost: 70, req: ['werkzeug'], info: L('Fischerhütten an der Küste', 'Fishing huts on the coast') },
  { id: 'holzbau', name: L('Holzbau', 'Timber Building'), era: 1, cost: 80, req: ['werkzeug'], info: L('Bessere Häuser, Speicher', 'Better houses, storehouses') },
  { id: 'toepferei', name: L('Töpferei', 'Pottery'), era: 1, cost: 90, req: ['feuer'], info: L('Vorräte verderben langsamer', 'Supplies spoil more slowly') },
  { id: 'viehzucht', name: L('Viehzucht', 'Herding'), era: 1, cost: 120, req: ['ackerbau'], info: L('Schafe, mehr Nahrung', 'Sheep, more food') },
  { id: 'bronze', name: L('Bronze', 'Bronze'), era: 2, cost: 260, req: ['feuer', 'holzbau'], key: 2, info: L('Minen, Waffen, Kaserne', 'Mines, weapons, barracks') },
  { id: 'steinbau', name: L('Steinbau', 'Masonry'), era: 2, cost: 240, req: ['holzbau'], info: L('Steinhäuser, Brunnen, Tempel', 'Stone houses, wells, temples') },
  { id: 'schrift', name: L('Schrift', 'Writing'), era: 2, cost: 300, req: ['rituale'], info: L('Schulen, schnelleres Wissen', 'Schools, faster learning') },
  { id: 'handel', name: L('Handel', 'Trade'), era: 2, cost: 260, req: ['toepferei'], info: L('Märkte und Gold', 'Markets and gold') },
  { id: 'segeln', name: L('Segeln', 'Sailing'), era: 2, cost: 280, req: ['fischerei', 'holzbau'], info: L('Häfen, Boote', 'Harbors, boats') },
  { id: 'kalender', name: L('Kalender', 'Calendar'), era: 2, cost: 260, req: ['rituale', 'ackerbau'], info: L('Bessere Ernten, Feste', 'Better harvests, festivals') },
  { id: 'eisen', name: L('Eisen', 'Iron'), era: 3, cost: 560, req: ['bronze'], key: 3, info: L('Starke Werkzeuge und Waffen', 'Strong tools and weapons') },
  { id: 'mathematik', name: L('Mathematik', 'Mathematics'), era: 3, cost: 520, req: ['schrift'], info: L('Grundlage der Wissenschaft', 'Foundation of science') },
  { id: 'recht', name: L('Recht', 'Law'), era: 3, cost: 500, req: ['schrift'], info: L('Gesetze, Republik möglich', 'Laws, a republic becomes possible') },
  { id: 'medizin', name: L('Heilkunde', 'Medicine'), era: 3, cost: 520, req: ['schrift'], info: L('Heilerhäuser, längeres Leben', 'Healer houses, longer life') },
  { id: 'philosophie', name: L('Philosophie', 'Philosophy'), era: 3, cost: 600, req: ['mathematik'], info: L('Theater, neue Staatsformen', 'Theaters, new forms of government') },
  { id: 'architektur', name: L('Architektur', 'Architecture'), era: 3, cost: 620, req: ['steinbau', 'mathematik'], info: L('Monumente, größere Häuser', 'Monuments, bigger houses') },
  { id: 'lehnswesen', name: L('Lehnswesen', 'Feudalism'), era: 4, cost: 1000, req: ['recht', 'eisen'], key: 4, info: L('Burgen, Königreiche', 'Castles, kingdoms') },
  { id: 'mechanik', name: L('Mechanik', 'Mechanics'), era: 4, cost: 1050, req: ['mathematik'], info: L('Windmühlen', 'Windmills') },
  { id: 'schiffbau', name: L('Schiffbau', 'Shipbuilding'), era: 4, cost: 1000, req: ['segeln'], info: L('Große Schiffe', 'Big ships') },
  { id: 'geldwesen', name: L('Geldwesen', 'Currency'), era: 4, cost: 980, req: ['handel'], info: L('Mehr Gold', 'More gold') },
  { id: 'universitaet', name: L('Universität', 'University'), era: 4, cost: 1150, req: ['philosophie'], info: L('Hohe Schulen', 'Higher schools') },
  { id: 'buchdruck', name: L('Buchdruck', 'Printing'), era: 5, cost: 1700, req: ['universitaet', 'mechanik'], key: 5, info: L('Wissen für alle', 'Knowledge for all') },
  { id: 'astronomie', name: L('Astronomie', 'Astronomy'), era: 5, cost: 1700, req: ['mathematik', 'kalender'], info: L('Sternwarten, Kometen werden erklärbar', 'Observatories, comets become explainable') },
  { id: 'navigation', name: L('Navigation', 'Navigation'), era: 5, cost: 1600, req: ['schiffbau', 'astronomie'], info: L('Leuchttürme', 'Lighthouses') },
  { id: 'kuenste', name: L('Schöne Künste', 'Fine Arts'), era: 5, cost: 1500, req: ['philosophie'], info: L('Kunst und Stolz', 'Art and pride') },
  { id: 'dampf', name: L('Dampfkraft', 'Steam Power'), era: 6, cost: 2600, req: ['mechanik', 'eisen'], key: 6, info: L('Fabriken', 'Factories') },
  { id: 'chemie', name: L('Chemie', 'Chemistry'), era: 6, cost: 2500, req: ['medizin', 'astronomie'], info: L('Neue Stoffe', 'New substances') },
  { id: 'impfung', name: L('Impfung', 'Vaccination'), era: 6, cost: 2600, req: ['chemie'], info: L('Seuchen verlieren ihren Schrecken', 'Plagues lose their terror') },
  { id: 'zeitung', name: L('Zeitung', 'Newspaper'), era: 6, cost: 2300, req: ['buchdruck'], info: L('Politik wird schneller', 'Politics gets faster') },
  { id: 'strom', name: L('Elektrizität', 'Electricity'), era: 6, cost: 3000, req: ['dampf', 'chemie'], info: L('Kraftwerke, Licht in der Nacht', 'Power plants, light at night') },
  { id: 'elektronik', name: L('Elektronik', 'Electronics'), era: 7, cost: 4200, req: ['strom'], key: 7, info: L('Die moderne Welt', 'The modern world') },
  { id: 'luftfahrt', name: L('Luftfahrt', 'Aviation'), era: 7, cost: 4000, req: ['dampf', 'strom'], info: L('Flugzeuge am Himmel', 'Airplanes in the sky') },
  { id: 'meteorologie', name: L('Meteorologie', 'Meteorology'), era: 7, cost: 3800, req: ['elektronik'], info: L('Das Wetter wird erklärbar', 'The weather becomes explainable') },
  { id: 'raumfahrt', name: L('Raumfahrt', 'Spaceflight'), era: 7, cost: 7000, req: ['elektronik', 'luftfahrt'], info: L('Der Sternenturm', 'The Star Tower') },
];
// Spätere Epochen dauern länger: Grundkosten mal Epochenfaktor
const ERA_COST = [1, 1.1, 1.5, 2.6, 4.5, 6.5, 8.5, 10];
for (const t of TECHS) t.cost = Math.round(t.cost * ERA_COST[t.era]);
export const TECH = Object.fromEntries(TECHS.map(t => [t.id, t]));

// Gebäude. tech = benötigtes Wissen, cost = Rohstoffe, work = Baupunkte,
// workers = Arbeitsplätze, job = Beruf dort, home = Wohnplätze (nach Epoche).
export const BUILDINGS = {
  zentrum: { name: L('Feuerplatz', 'Hearth'), tech: null, cost: {}, work: 1, workers: 0, place: 'center' },
  haus: { name: L('Haus', 'House'), tech: null, cost: { wood: 3 }, work: 5, workers: 0, home: [3, 4, 5, 6, 8, 10, 16, 28], place: 'home' },
  feld: { name: L('Feld', 'Field'), tech: 'ackerbau', cost: { wood: 1 }, work: 4, workers: 2, job: 'bauer', place: 'field' },
  fischer: { name: L('Fischerhütte', 'Fishing Hut'), tech: 'fischerei', cost: { wood: 4 }, work: 6, workers: 3, job: 'fischer', place: 'coast' },
  holz: { name: L('Holzfällerlager', 'Woodcutter\'s Camp'), tech: 'werkzeug', cost: { wood: 2 }, work: 4, workers: 3, job: 'holzfaeller', place: 'forest' },
  stein: { name: L('Steinbruch', 'Quarry'), tech: 'werkzeug', cost: { wood: 4 }, work: 6, workers: 3, job: 'steinmetz', place: 'rock' },
  mine: { name: L('Mine', 'Mine'), tech: 'bronze', cost: { wood: 8, stone: 4 }, work: 10, workers: 4, job: 'bergmann', place: 'mountain' },
  speicher: { name: L('Speicher', 'Storehouse'), tech: 'holzbau', cost: { wood: 8 }, work: 8, workers: 0, store: 120, place: 'near' },
  werkstatt: { name: L('Werkstatt', 'Workshop'), tech: 'werkzeug', cost: { wood: 5 }, work: 6, workers: 2, job: 'handwerker', place: 'near' },
  schrein: { name: L('Schrein', 'Shrine'), tech: 'rituale', cost: { wood: 4, stone: 2 }, work: 6, workers: 2, job: 'priester', place: 'high' },
  brunnen: { name: L('Brunnen', 'Well'), tech: 'steinbau', cost: { stone: 6 }, work: 6, workers: 0, place: 'near' },
  markt: { name: L('Markt', 'Market'), tech: 'handel', cost: { wood: 10, stone: 4 }, work: 10, workers: 3, job: 'haendler', place: 'near' },
  schule: { name: L('Schule', 'School'), tech: 'schrift', cost: { wood: 8, stone: 8 }, work: 12, workers: 3, job: 'gelehrter', place: 'near' },
  kaserne: { name: L('Kaserne', 'Barracks'), tech: 'bronze', cost: { wood: 10, stone: 8 }, work: 12, workers: 6, job: 'krieger', place: 'edge' },
  hafen: { name: L('Hafen', 'Harbor'), tech: 'segeln', cost: { wood: 16, stone: 4 }, work: 14, workers: 4, job: 'haendler', place: 'coast' },
  heiler: { name: L('Heilerhaus', 'Healer\'s House'), tech: 'medizin', cost: { wood: 8, stone: 8 }, work: 12, workers: 2, job: 'heiler', place: 'near' },
  theater: { name: L('Theater', 'Theater'), tech: 'philosophie', cost: { wood: 10, stone: 16 }, work: 18, workers: 3, job: 'kuenstler', place: 'near' },
  monument: { name: L('Statue des Gottes', 'Statue of the God'), tech: 'architektur', cost: { stone: 30, goods: 6 }, work: 40, workers: 0, place: 'high', unique: true },
  muehle: { name: L('Windmühle', 'Windmill'), tech: 'mechanik', cost: { wood: 14, stone: 6 }, work: 14, workers: 1, job: 'bauer', place: 'fieldnear' },
  burg: { name: L('Burg', 'Castle'), tech: 'lehnswesen', cost: { stone: 40, wood: 10 }, work: 50, workers: 6, job: 'krieger', place: 'high', unique: true },
  sternwarte: { name: L('Sternwarte', 'Observatory'), tech: 'astronomie', cost: { stone: 24, goods: 8 }, work: 30, workers: 3, job: 'gelehrter', place: 'high', unique: true },
  leuchtturm: { name: L('Leuchtturm', 'Lighthouse'), tech: 'navigation', cost: { stone: 24 }, work: 24, workers: 1, job: 'fischer', place: 'coast', unique: true },
  fabrik: { name: L('Fabrik', 'Factory'), tech: 'dampf', cost: { stone: 30, ore: 10 }, work: 30, workers: 10, job: 'arbeiter', place: 'edge' },
  kraftwerk: { name: L('Kraftwerk', 'Power Plant'), tech: 'strom', cost: { stone: 40, ore: 20 }, work: 40, workers: 6, job: 'arbeiter', place: 'edge', unique: true },
  rakete: { name: L('Sternenturm', 'Star Tower'), tech: 'raumfahrt', cost: { stone: 80, ore: 60, goods: 60 }, work: 400, workers: 0, place: 'edge', unique: true, wonder: true },
  // Seit 17.10.2026: mehr Vielfalt in jeder Epoche. bon = Wirkung (core.js, bonuses): food und know als Anteil mehr,
  // tools und goods je Tag, hap und faith als Stimmung und Glaubensziel, health weniger Krankheit und Tod, def stärkere
  // Verteidigung, spoil weniger Verderb, pirate und navy gegen Piraten (pirates.js). plan = Bauplaner: per (je so viele
  // Einwohner eines), min (ab Einwohnern), base (Wichtigkeit), w (Kulturwert, der sie wichtiger macht), era (ab Epoche),
  // war (Zusatz im Krieg), gov (nur bei diesen Staatsformen)
  totem: { name: L('Ahnenpfahl', 'Ancestor Pole'), tech: 'rituale', cost: { wood: 3 }, work: 4, workers: 0, place: 'near', bon: { faith: 0.03, hap: 0.01 }, plan: { per: 60, min: 8, base: 2, w: 'glaube' } },
  raeucherei: { name: L('Räucherhütte', 'Smokehouse'), tech: 'jagd', cost: { wood: 4 }, work: 5, workers: 1, job: 'jaeger', place: 'near', bon: { food: 0.04, spoil: 0.25 }, plan: { per: 60, min: 14, base: 3 } },
  toepferei: { name: L('Töpferei', 'Pottery'), tech: 'toepferei', cost: { wood: 4, stone: 2 }, work: 6, workers: 1, job: 'handwerker', place: 'near', bon: { goods: 0.25, spoil: 0.1 }, plan: { per: 70, min: 16, base: 2.5, w: 'kunst' } },
  stall: { name: L('Viehhof', 'Livestock Farm'), tech: 'viehzucht', cost: { wood: 6 }, work: 6, workers: 1, job: 'bauer', place: 'fieldnear', bon: { food: 0.07 }, plan: { per: 50, min: 16, base: 4 } },
  schmiede: { name: L('Schmiede', 'Smithy'), tech: 'bronze', cost: { wood: 6, stone: 4 }, work: 8, workers: 2, job: 'handwerker', place: 'near', bon: { tools: 0.3, def: 0.06 }, plan: { per: 80, min: 20, base: 3.5 } },
  baeckerei: { name: L('Bäckerei', 'Bakery'), tech: 'kalender', cost: { wood: 5, stone: 4 }, work: 8, workers: 1, job: 'handwerker', place: 'near', bon: { food: 0.05, hap: 0.012 }, plan: { per: 70, min: 25, base: 3.5 } },
  taverne: { name: L('Taverne', 'Tavern'), tech: 'handel', cost: { wood: 8, stone: 4 }, work: 10, workers: 1, job: 'haendler', place: 'near', bon: { hap: 0.025, goods: 0.05 }, plan: { per: 80, min: 25, base: 3 } },
  wachturm: { name: L('Wachturm', 'Watchtower'), tech: 'bronze', cost: { wood: 6, stone: 8 }, work: 10, workers: 1, job: 'krieger', place: 'edge', bon: { def: 0.1, pirate: 0.2 }, plan: { per: 100, min: 30, base: 1.5, w: 'macht', war: 4 } },
  tempel: { name: L('Tempel', 'Temple'), tech: 'steinbau', cost: { stone: 20, wood: 6 }, work: 24, workers: 2, job: 'priester', place: 'high', bon: { faith: 0.05, hap: 0.012 }, plan: { per: 160, min: 50, base: 2, w: 'glaube' } },
  bibliothek: { name: L('Bibliothek', 'Library'), tech: 'schrift', cost: { wood: 8, stone: 10 }, work: 16, workers: 1, job: 'gelehrter', place: 'near', bon: { know: 0.1 }, plan: { per: 140, min: 40, base: 2, w: 'wissen', era: 3 } },
  badehaus: { name: L('Badehaus', 'Bathhouse'), tech: 'medizin', cost: { stone: 14, wood: 6 }, work: 16, workers: 1, job: 'heiler', place: 'near', bon: { health: 0.18, hap: 0.015 }, plan: { per: 140, min: 45, base: 2.5 } },
  arena: { name: L('Arena', 'Arena'), tech: 'architektur', cost: { stone: 30, wood: 10 }, work: 34, workers: 2, job: 'kuenstler', place: 'edge', unique: true, bon: { hap: 0.035 }, plan: { min: 90, base: 2.5, w: 'macht' } },
  palast: { name: L('Palast', 'Palace'), tech: 'lehnswesen', cost: { stone: 40, wood: 12, goods: 10 }, work: 50, workers: 0, place: 'high', unique: true, bon: { hap: 0.01, def: 0.05 }, plan: { min: 70, base: 4, gov: ['koenigtum', 'diktatur', 'theokratie', 'haeuptling'] } },
  kathedrale: { name: L('Kathedrale', 'Cathedral'), tech: 'architektur', cost: { stone: 50, wood: 14, goods: 8 }, work: 70, workers: 3, job: 'priester', place: 'high', unique: true, bon: { faith: 0.08, hap: 0.02 }, plan: { min: 120, base: 2.5, w: 'glaube', era: 4 } },
  gilde: { name: L('Gildenhaus', 'Guild Hall'), tech: 'geldwesen', cost: { stone: 16, wood: 8, goods: 4 }, work: 22, workers: 2, job: 'haendler', place: 'near', bon: { goods: 0.4 }, plan: { per: 160, min: 60, base: 2.5, w: 'handel' } },
  werft: { name: L('Werft', 'Shipyard'), tech: 'schiffbau', cost: { wood: 24, stone: 6 }, work: 26, workers: 3, job: 'handwerker', place: 'coast', bon: { navy: 1, pirate: 0.4 }, plan: { per: 220, min: 60, base: 2.5, w: 'handel', war: 3 } },
  universitaet: { name: L('Universität', 'University'), tech: 'universitaet', cost: { stone: 40, wood: 12, goods: 12 }, work: 60, workers: 3, job: 'gelehrter', place: 'near', unique: true, bon: { know: 0.25 }, plan: { min: 80, base: 3, w: 'wissen' } },
  bank: { name: L('Bank', 'Bank'), tech: 'geldwesen', cost: { stone: 24, goods: 10 }, work: 30, workers: 2, job: 'haendler', place: 'near', bon: { goods: 0.2 }, plan: { per: 250, min: 100, base: 2, w: 'handel', era: 5 } },
  oper: { name: L('Opernhaus', 'Opera House'), tech: 'kuenste', cost: { stone: 40, wood: 10, goods: 16 }, work: 60, workers: 2, job: 'kuenstler', place: 'near', unique: true, bon: { hap: 0.035 }, plan: { min: 100, base: 2.5, w: 'kunst' } },
  museum: { name: L('Museum', 'Museum'), tech: 'buchdruck', cost: { stone: 30, goods: 12 }, work: 50, workers: 1, job: 'gelehrter', place: 'near', unique: true, bon: { know: 0.08, hap: 0.02 }, plan: { min: 110, base: 2.5, w: 'wissen' } },
  park: { name: L('Stadtpark', 'City Park'), tech: 'kuenste', cost: { wood: 6, stone: 6 }, work: 12, workers: 0, place: 'near', bon: { hap: 0.02, health: 0.05 }, plan: { per: 160, min: 80, base: 2.5, w: 'kunst' } },
  bahnhof: { name: L('Bahnhof', 'Railway Station'), tech: 'dampf', cost: { stone: 40, ore: 20 }, work: 60, workers: 2, job: 'arbeiter', place: 'edge', unique: true, bon: { goods: 0.6 }, plan: { min: 120, base: 4 } },
  krankenhaus: { name: L('Krankenhaus', 'Hospital'), tech: 'impfung', cost: { stone: 40, goods: 16 }, work: 50, workers: 3, job: 'heiler', place: 'near', bon: { health: 0.35 }, plan: { per: 280, min: 100, base: 4 } },
  hochhaus: { name: L('Wohnturm', 'Apartment Tower'), tech: 'elektronik', cost: { stone: 40, ore: 16 }, work: 50, workers: 0, home: [0, 0, 0, 0, 0, 0, 0, 44], place: 'near' },
  stadion: { name: L('Stadion', 'Stadium'), tech: 'elektronik', cost: { stone: 60, ore: 20 }, work: 80, workers: 2, job: 'kuenstler', place: 'edge', unique: true, bon: { hap: 0.045 }, plan: { min: 150, base: 3 } },
  labor: { name: L('Forschungslabor', 'Research Lab'), tech: 'elektronik', cost: { stone: 30, ore: 20, goods: 20 }, work: 50, workers: 3, job: 'gelehrter', place: 'near', bon: { know: 0.3 }, plan: { per: 300, min: 120, base: 3, w: 'wissen' } },
};

export const JOBS = {
  sammler: { name: L('Sammler', 'Gatherer'), icon: '🫐' },
  jaeger: { name: L('Jäger', 'Hunter'), icon: '🏹' },
  bauer: { name: L('Bauer', 'Farmer'), icon: '🌾' },
  fischer: { name: L('Fischer', 'Fisher'), icon: '🐟' },
  holzfaeller: { name: L('Holzfäller', 'Woodcutter'), icon: '🪓' },
  steinmetz: { name: L('Steinmetz', 'Stonemason'), icon: '🪨' },
  bergmann: { name: L('Bergmann', 'Miner'), icon: '⛏' },
  handwerker: { name: L('Handwerker', 'Craftsman'), icon: '🔨' },
  baumeister: { name: L('Baumeister', 'Builder'), icon: '🏗' },
  priester: { name: L('Priester', 'Priest'), icon: '🕯' },
  gelehrter: { name: L('Gelehrter', 'Scholar'), icon: '📜' },
  haendler: { name: L('Händler', 'Merchant'), icon: '⚖' },
  krieger: { name: L('Krieger', 'Warrior'), icon: '🛡' },
  heiler: { name: L('Heiler', 'Healer'), icon: '🌿' },
  kuenstler: { name: L('Künstler', 'Artist'), icon: '🎭' },
  arbeiter: { name: L('Arbeiter', 'Worker'), icon: '⚙' },
  kind: { name: L('Kind', 'Child'), icon: '🧒' },
  alt: { name: L('Ältere', 'Elder'), icon: '👵' },
};

// Kulturwerte jeder Siedlung (0..1)
export const CULTURE = {
  glaube: L('Glaube', 'Faith'), tradition: L('Tradition', 'Tradition'), freiheit: L('Freiheit', 'Freedom'), macht: L('Macht', 'Power'),
  wissen: L('Wissen', 'Knowledge'), kunst: L('Kunst', 'Art'), handel: L('Handel', 'Trade'),
};

export const FACTIONS = {
  glaeubige: { name: L('Die Gläubigen', 'The Faithful'), color: '#e9b44c', values: ['glaube', 'tradition'] },
  krieger: { name: L('Die Wächter', 'The Guardians'), color: '#c8553d', values: ['macht', 'tradition'] },
  haendler: { name: L('Die Händler', 'The Merchants'), color: '#5fa8a0', values: ['handel', 'freiheit'] },
  gelehrte: { name: L('Die Gelehrten', 'The Scholars'), color: '#7d8fd6', values: ['wissen', 'freiheit'] },
  volk: { name: L('Das Volk', 'The People'), color: '#9fbf6f', values: ['tradition', 'freiheit'] },
};

export const GOVS = {
  rat: { name: L('Ältestenrat', 'Council of Elders'), era: 0, faction: 'volk', fit: { tradition: 1 } },
  haeuptling: { name: L('Häuptlingstum', 'Chieftainship'), era: 0, faction: 'krieger', fit: { macht: 1, tradition: 0.5 } },
  koenigtum: { name: L('Königtum', 'Monarchy'), era: 2, faction: 'krieger', fit: { macht: 1, tradition: 1 }, hereditary: true },
  theokratie: { name: L('Theokratie', 'Theocracy'), era: 1, faction: 'glaeubige', fit: { glaube: 2 } },
  republik: { name: L('Republik', 'Republic'), era: 3, faction: 'haendler', fit: { freiheit: 1, handel: 1 }, elect: 5 },
  demokratie: { name: L('Demokratie', 'Democracy'), era: 5, faction: 'volk', fit: { freiheit: 1.5, wissen: 0.5 }, elect: 4 },
  diktatur: { name: L('Militärherrschaft', 'Military Rule'), era: 2, faction: 'krieger', fit: { macht: 1.5 } },
  volksrat: { name: L('Volksrat', 'People\'s Council'), era: 3, faction: 'volk', fit: { freiheit: 1, tradition: 0.5 } },
  technokratie: { name: L('Technokratie', 'Technocracy'), era: 6, faction: 'gelehrte', fit: { wissen: 2 } },
};

export const LAWS = {
  opfergaben: { name: L('Opfergaben', 'Offerings'), faction: 'glaeubige', info: L('Ein Teil der Ernte gehört dem Gott', 'A share of the harvest belongs to the god') },
  tempelzehnt: { name: L('Tempelzehnt', 'Temple Tithe'), faction: 'glaeubige', era: 2, info: L('Gold fließt in die Tempel', 'Gold flows into the temples') },
  sternenverbot: { name: L('Verbot der Sternenkunde', 'Ban on Stargazing'), faction: 'glaeubige', era: 3, info: L('Fragen an den Himmel sind Frevel', 'Questions to the sky are blasphemy') },
  wehrpflicht: { name: L('Wehrpflicht', 'Conscription'), faction: 'krieger', era: 2, info: L('Jeder kann zur Waffe gerufen werden', 'Anyone can be called to arms') },
  ausgangssperre: { name: L('Nachtwache', 'Night Watch'), faction: 'krieger', info: L('Strenge Ordnung, weniger Freude', 'Strict order, less joy') },
  freihandel: { name: L('Freier Handel', 'Free Trade'), faction: 'haendler', era: 2, info: L('Mehr Gold, mehr Ungleichheit', 'More gold, more inequality') },
  gastrecht: { name: L('Gastrecht', 'Guest Right'), faction: 'haendler', info: L('Fremde sind willkommen', 'Strangers are welcome') },
  schulpflicht: { name: L('Schulpflicht', 'Compulsory Schooling'), faction: 'gelehrte', era: 3, info: L('Mehr Wissen', 'More knowledge') },
  freiedenker: { name: L('Freiheit des Wortes', 'Freedom of Speech'), faction: 'gelehrte', era: 3, info: L('Neue Ideen, weniger Gehorsam', 'New ideas, less obedience') },
  ruhetag: { name: L('Ruhetag', 'Day of Rest'), faction: 'volk', info: L('Mehr Freude, etwas weniger Arbeit', 'More joy, a little less work') },
  gemeinschaft: { name: L('Gemeinsame Ernte', 'Shared Harvest'), faction: 'volk', info: L('Niemand hungert allein', 'No one goes hungry alone') },
  abschottung: { name: L('Abschottung', 'Isolation'), faction: 'krieger', info: L('Fremde werden abgewiesen', 'Strangers are turned away') },
  zinsverbot: { name: L('Zinsverbot', 'Ban on Usury'), faction: 'glaeubige', era: 2, info: L('Wer leiht, darf nichts dazuverlangen', 'Whoever lends may not ask for more back') },
  schuldenerlass: { name: L('Schuldenerlass', 'Debt Jubilee'), faction: 'volk', era: 2, info: L('Alte Schulden verfallen nach sieben Jahren', 'Old debts expire after seven years') },
  schutzzoll: { name: L('Schutzzoll', 'Protective Tariff'), faction: 'krieger', era: 2, info: L('Fremde Waren werden teurer, die Kasse voller', 'Foreign goods cost more, the treasury fills') },
  erbsteuer: { name: L('Erbschaftssteuer', 'Inheritance Tax'), faction: 'volk', era: 3, info: L('Ein Drittel jedes Erbes gehört allen', 'A third of every inheritance belongs to all') },
  // seit 20.10.2026 (Gesellschaft: peoples.js, faith.js, migration.js)
  toleranz: { name: L('Toleranzedikt', 'Edict of Tolerance'), faction: 'gelehrte', era: 3, info: L('Jeder darf glauben, was er will', 'Everyone may believe what they wish') },
  staatskirche: { name: L('Staatskirche', 'State Church'), faction: 'glaeubige', era: 2, info: L('Ein Glaube für alle, die anderen werden bedrängt', 'One faith for all, the others are pressed') },
  staende: { name: L('Ständeordnung', 'Estate Order'), faction: 'krieger', era: 2, info: L('Jeder bleibt in seinem Stand, Ämter und Berufe nach Geburt', 'Everyone stays in their rank, offices and trades by birth') },
  einbuergerung: { name: L('Bürgerrecht für Zugezogene', 'Naturalization'), faction: 'haendler', era: 3, info: L('Wer kommt, gehört bald dazu', 'Whoever comes soon belongs') },
};

// Traum-Themen für die Kraft "Traum senden"
export const DREAMS = {
  frieden: { name: L('Frieden', 'Peace'), culture: { macht: -0.12, freiheit: 0.04 }, trait: { wut: -0.4, charisma: 0.15 } },
  krieg: { name: L('Krieg', 'War'), culture: { macht: 0.14 }, trait: { wut: 0.4, mut: 0.3 } },
  wissen: { name: L('Wissen', 'Knowledge'), culture: { wissen: 0.12 }, trait: { neugier: 0.4 } },
  glaube: { name: L('Glaube', 'Faith'), culture: { glaube: 0.14, tradition: 0.04 }, trait: { glaube: 0.5 } },
  freiheit: { name: L('Freiheit', 'Freedom'), culture: { freiheit: 0.14, tradition: -0.06 }, trait: { mut: 0.2, charisma: 0.2 } },
  meer: { name: L('Das Meer', 'The Sea'), culture: { handel: 0.08, freiheit: 0.04 }, trait: { neugier: 0.3, mut: 0.3 } },
  kunst: { name: L('Schönheit', 'Beauty'), culture: { kunst: 0.14 }, trait: { kunst: 0.5 } },
  sterne: { name: L('Die Sterne', 'The Stars'), culture: { wissen: 0.08, glaube: 0.04 }, trait: { neugier: 0.4 } },
};

// Götterkräfte. target: global | point | settlement | person
export const POWERS = [
  { id: 'regen', cat: 'wetter', name: L('Regen', 'Rain'), cost: 12, target: 'global', days: 3, info: L('Felder trinken, Brände erlöschen. Zu viel davon macht trübsinnig.', 'Fields drink, fires die out. Too much of it makes people gloomy.') },
  { id: 'sonne', cat: 'wetter', name: L('Sonne', 'Sun'), cost: 12, target: 'global', days: 3, info: L('Wärme und Wachstum. Im Winter ein Geschenk, im Sommer eine Dürre.', 'Warmth and growth. A gift in winter, a drought in summer.') },
  { id: 'sturm', cat: 'wetter', name: L('Sturm', 'Storm'), cost: 28, target: 'global', days: 2, info: L('Wind reißt Dächer ab und Bäume um. Furcht macht fromm.', 'Wind tears off roofs and topples trees. Fear makes people devout.') },
  { id: 'blitz', cat: 'wetter', name: L('Blitz', 'Lightning'), cost: 16, target: 'point', info: L('Ein Schlag vom Himmel. Kann Feuer bringen, im wörtlichen Sinn.', 'A strike from the sky. Can bring fire, in the literal sense.') },
  { id: 'schnee', cat: 'wetter', name: L('Schnee', 'Snow'), cost: 16, target: 'global', days: 3, info: L('Stille und Kälte. Vorräte halten, Obdachlose frieren.', 'Stillness and cold. Supplies keep, the homeless freeze.') },
  { id: 'nebel', cat: 'wetter', name: L('Nebel', 'Fog'), cost: 14, target: 'global', days: 3, info: L('Geheimnis über der Insel. Armeen verirren sich.', 'Mystery over the island. Armies lose their way.') },
  { id: 'regenbogen', cat: 'wetter', name: L('Regenbogen', 'Rainbow'), cost: 20, target: 'global', info: L('Ein Zeichen der Versöhnung zwischen allen Siedlungen.', 'A sign of reconciliation between all settlements.') },
  { id: 'segen', cat: 'erde', name: L('Segen der Erde', 'Blessing of the Earth'), cost: 22, target: 'point', radius: 6, info: L('Fruchtbare Böden, junge Wälder, reiche Ernte.', 'Fertile soil, young forests, rich harvests.') },
  { id: 'fische', cat: 'erde', name: L('Fischschwarm', 'Fish Shoal'), cost: 16, target: 'point', radius: 8, info: L('Silberne Schwärme an der Küste.', 'Silver shoals along the coast.') },
  { id: 'beben', cat: 'erde', name: L('Erdbeben', 'Earthquake'), cost: 45, target: 'point', radius: 5, info: L('Die Erde bricht. Häuser fallen, Erz kommt ans Licht.', 'The ground breaks. Houses fall, ore comes to light.') },
  { id: 'vulkan', cat: 'erde', name: L('Vulkan', 'Volcano'), cost: 60, target: 'mountain', radius: 6, info: L('Der Berg erwacht. Zerstörung, danach fruchtbare Asche.', 'The mountain awakens. Destruction, then fertile ash.') },
  { id: 'flut', cat: 'erde', name: L('Flut', 'Flood'), cost: 50, target: 'global', info: L('Das Meer holt sich die Küste.', 'The sea takes back the coast.') },
  { id: 'meteor', cat: 'erde', name: L('Meteor', 'Meteor'), cost: 55, target: 'point', radius: 3, info: L('Ein Stern fällt. Krater, Sternenmetall, ein neuer Kult.', 'A star falls. A crater, star metal, a new cult.') },
  { id: 'traum', cat: 'geist', name: L('Traum senden', 'Send a Dream'), cost: 24, target: 'person', info: L('Eine Vision für einen Menschen. Visionen verändern Völker.', 'A vision for one person. Visions change peoples.') },
  { id: 'funke', cat: 'geist', name: L('Funke der Erkenntnis', 'Spark of Insight'), cost: 26, target: 'settlement', info: L('Eine Idee fällt vom Himmel in einen Kopf.', 'An idea falls from the sky into a mind.') },
  { id: 'komet', cat: 'geist', name: L('Komet', 'Comet'), cost: 22, target: 'global', days: 4, info: L('Ein Zeichen am Himmel. Jeder deutet es anders.', 'A sign in the sky. Everyone reads it differently.') },
  { id: 'fremde', cat: 'geist', name: L('Fremde', 'Strangers'), cost: 30, target: 'coast', info: L('Ein Boot mit Schiffbrüchigen. Neue Namen, neue Ideen.', 'A boat with shipwrecked survivors. New names, new ideas.') },
  { id: 'heilung', cat: 'geist', name: L('Heilung', 'Healing'), cost: 20, target: 'settlement', info: L('Kranke stehen auf, eine heilige Quelle entspringt.', 'The sick rise, a sacred spring wells up.') },
  { id: 'seuche', cat: 'geist', name: L('Seuche', 'Plague'), cost: 40, target: 'settlement', info: L('Fieber geht um. Wer überlebt, sucht nach Antworten.', 'Fever spreads. Those who survive search for answers.') },
];
export const POWER = Object.fromEntries(POWERS.map(p => [p.id, p]));

export const POWER_CATS = {
  wetter: L('Himmel', 'Sky'),
  erde: L('Erde', 'Earth'),
  geist: L('Geist', 'Spirit'),
};

// Lebensräume (seit 18.10.2026): Kachelwert in st.tiles.bio. 0 ist das milde Land des Archipels (so sah die Welt immer aus).
// fert: Grundfruchtbarkeit, food: Nahrung aus Sammeln, Jagd, Feldern, sick: Seuchenneigung, cold: Kälte im Winter,
// snow: wie viel Schnee im Bild liegt (0 nie, 1 wie bisher, über 1 auch außerhalb des Winters), live: ob man dort siedeln mag
export const BIOMES = [
  { key: 'mild', name: L('Grasland', 'Grassland'), fert: 60, food: 1, sick: 1, cold: 1, snow: 1, live: 1 },
  { key: 'wald', name: L('Laubwald', 'Broadleaf Forest'), fert: 58, food: 1.05, sick: 1, cold: 1, snow: 1, live: 1 },
  { key: 'taiga', name: L('Nadelwald', 'Taiga'), fert: 30, food: 0.85, sick: 0.8, cold: 1.6, snow: 1.5, live: 0.8 },
  { key: 'tundra', name: L('Tundra', 'Tundra'), fert: 12, food: 0.6, sick: 0.6, cold: 2.4, snow: 1.9, live: 0.4 },
  { key: 'eis', name: L('Gletscher', 'Glacier'), fert: 0, food: 0.2, sick: 0.5, cold: 3, snow: 3, live: 0 },
  { key: 'steppe', name: L('Steppe', 'Steppe'), fert: 44, food: 0.9, sick: 0.9, cold: 1.2, snow: 0.8, live: 0.85 },
  { key: 'sumpf', name: L('Sumpf', 'Marshland'), fert: 36, food: 0.9, sick: 1.8, cold: 1, snow: 0.7, live: 0.5 },
  { key: 'savanne', name: L('Savanne', 'Savanna'), fert: 34, food: 1, sick: 1.2, cold: 0, snow: 0, live: 0.8 },
  { key: 'wueste', name: L('Wüste', 'Desert'), fert: 5, food: 0.45, sick: 0.9, cold: 0, snow: 0, live: 0.25 },
  { key: 'tropen', name: L('Regenwald', 'Rainforest'), fert: 66, food: 1.2, sick: 1.7, cold: 0, snow: 0, live: 0.75 },
  { key: 'vulkan', name: L('Vulkanland', 'Volcanic Land'), fert: 62, food: 0.9, sick: 1, cold: 0, snow: 0.3, live: 0.6 },
  { key: 'salz', name: L('Salzpfanne', 'Salt Flat'), fert: 0, food: 0.3, sick: 0.8, cold: 0, snow: 0, live: 0.1 },
  { key: 'canyon', name: L('Rote Schluchten', 'Red Canyons'), fert: 8, food: 0.5, sick: 0.8, cold: 0, snow: 0.1, live: 0.3 },
  { key: 'oase', name: L('Oase', 'Oasis'), fert: 70, food: 1.1, sick: 1.1, cold: 0, snow: 0, live: 1 },
  { key: 'fjord', name: L('Fjordland', 'Fjord Land'), fert: 26, food: 0.95, sick: 0.7, cold: 1.7, snow: 1.6, live: 0.7 },
];
export const BIO = Object.fromEntries(BIOMES.map((b, i) => [b.key, i]));
