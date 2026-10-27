// Erde heute: die Kräfte des Geistes in der echten Welt. Dieselben 19 Kräfte wie im übrigen Spiel (data.js POWERS),
// gewirkt auf ein Feld des Globus, eine Stadt oder ein Land. Die Menschen deuten sie nach Glauben und Wissen: Forscher
// erklären, Gläubige sehen ein Zeichen, die Nachrichten berichten. Passende Gebete gelten als erhört.
import { POWER } from '../sim/data.js';
import { L, LANG } from '../i18n.js';
import { TODAY, cityName, citiesNear } from './data.js';
import { news, cName, quake, epidemic, answerPrayers, capitalAt, relation, DPY } from './sim.js';

const ctryAt = (x, y) => { const id = TODAY.ctry[y * 2048 + ((x % 2048) + 2048) % 2048]; const C = id && TODAY.byId.get(id); return C ? TODAY.list.indexOf(C) : -1; };

// Wie die Menschen eines Landes ein Zeichen deuten: Anteil, der darin mehr als Wetter sieht
function reading(ts, i, sciDe, sciEn, faithDe, faithEn) {
  const c = ts.c[i], C = TODAY.list[i];
  const edu = Math.min(1, Math.log10(Math.max(500, C.gdppc || 3000)) / 5);
  const belief = c.faith * (1.1 - edu * 0.6);
  return belief > 0.42 ? L(faithDe, faithEn) : L(sciDe, sciEn);
}

export function castToday(ts, id, tgt) {
  const P = POWER[id];
  if (!P) return { ok: false };
  if (ts.mana < P.cost) return { ok: false, why: L('Zu wenig Kraft. Sie wächst mit dem Glauben der Menschen.', 'Not enough power. It grows with people\'s faith.') };
  const R = ts._rt.r;
  let x = tgt.x, y = tgt.y, city = tgt.city ?? null;
  if (city != null) { x = TODAY.cities.tx[city]; y = TODAY.cities.ty[city]; }
  const i = tgt.ctry != null ? tgt.ctry : x != null ? ctryAt(x, y) : -1;
  if (city == null && x != null) { const near = citiesNear(x, y, 4); city = near.length ? near[0] : null; }
  const where = city != null ? cityName(city, LANG) : i >= 0 ? cName(i) : L('dem offenen Meer', 'the open sea');
  const at = x != null ? [x, y] : i >= 0 ? capitalAt(i) : null;
  const c = i >= 0 ? ts.c[i] : null;
  ts.mana -= P.cost; ts.counts.powers++;
  ts._rt.fx.push({ type: 'power', id, x, y });
  let t = '';
  switch (id) {
    case 'regen': {
      if (c) { const was = c.dry; c.dry = Math.max(0, c.dry - 0.6); if (was > 0.3) c.g += 0.01; }
      t = c && c.dry < 0.2 && ts.prayers.some(p => p.c === i && p.kind === 'regen')
        ? reading(ts, i, `Über ${where} öffnet sich der Himmel. Meteorologen sprechen von einem ungewöhnlichen Tiefdruckgebiet.`, `The sky opens over ${where}. Meteorologists speak of an unusual low-pressure system.`, `Über ${where} fällt Regen, nach Wochen der Dürre. Menschen tanzen auf den Straßen und danken dem Himmel.`, `Rain falls over ${where} after weeks of drought. People dance in the streets and thank the heavens.`)
        : L(`Kräftiger Regen über ${where}.`, `Heavy rain over ${where}.`);
      break;
    }
    case 'sonne': if (c) { c.flood = 0; c.dmg = Math.max(0, c.dmg - 0.02); } t = L(`Die Sonne bricht über ${where} durch. Die Cafés stellen die Stühle raus.`, `The sun breaks through over ${where}. Cafés put their chairs outside.`); break;
    case 'sturm': {
      if (c) { c.dmg = Math.min(1, c.dmg + 0.05); c.faith = Math.min(1, c.faith + 0.01); }
      if (city != null) ts.cdmg[city] = Math.min(1, (ts.cdmg[city] || 0) + 0.2);
      t = L(`Ein Sturm fegt über ${where}. Bäume stürzen auf Autos, Flüge werden gestrichen.`, `A storm sweeps across ${where}. Trees fall on cars, flights are cancelled.`);
      break;
    }
    case 'blitz': t = L(`Ein Blitz schlägt in ${where} ein. Ein Video davon geht um die Welt.`, `Lightning strikes in ${where}. A video of it goes around the world.`); if (c) c.faith = Math.min(1, c.faith + 0.003); break;
    case 'schnee': t = L(`Schnee in ${where}. Kinder bauen Schneemänner, der Verkehr steht still.`, `Snow in ${where}. Children build snowmen, traffic grinds to a halt.`); break;
    case 'nebel': t = L(`Dichter Nebel legt sich über ${where}. Die Stadt klingt plötzlich leise.`, `Thick fog settles over ${where}. The city suddenly sounds quiet.`); break;
    case 'regenbogen': {
      ts.w.peace = DPY;
      for (const W of ts.wars) if (W.a === i || W.b === i) ts.w.peace = DPY * 2;
      t = i >= 0 ? reading(ts, i, `Ein doppelter Regenbogen über ${where}. Millionen Fotos in einer Stunde.`, `A double rainbow over ${where}. Millions of photos in an hour.`, `Ein Regenbogen spannt sich über ${where}. Viele sehen darin ein Zeichen für Frieden.`, `A rainbow arches over ${where}. Many see it as a sign of peace.`) : L('Ein Regenbogen über dem Meer.', 'A rainbow over the sea.');
      break;
    }
    case 'segen': if (c) { c.g += 0.015; c.infl = Math.max(0, c.infl - 0.01); } t = L(`Rekordernte rund um ${where}. Die Preise für Brot und Reis sinken.`, `Record harvest around ${where}. Prices for bread and rice fall.`); break;
    case 'fische': if (c) c.g += 0.004; t = L(`Riesige Fischschwärme vor der Küste von ${where}. Die Fischer kommen mit vollen Netzen heim.`, `Huge shoals of fish off the coast of ${where}. Fishers return with full nets.`); break;
    case 'beben': {
      if (i < 0) { t = L('Ein Seebeben weit draußen. Nur die Messgeräte bemerken es.', 'A seaquake far out at sea. Only the instruments notice.'); break; }
      quake(ts, i, 6.4 + R.next() * 1.4, city);
      t = '';
      break;
    }
    case 'vulkan': t = L(`Bei ${where} spuckt ein Vulkan Asche bis in 15 km Höhe. Der Flugverkehr steht still.`, `A volcano near ${where} spews ash 15 km high. Air traffic stops.`); if (c) c.dmg = Math.min(1, c.dmg + 0.08); ts.w.temp -= 0.02; break;
    case 'flut': if (c) { c.flood = 1; c.dmg = Math.min(1, c.dmg + 0.1); } if (city != null) ts.cdmg[city] = Math.min(1, (ts.cdmg[city] || 0) + 0.3); t = L(`Sturmflut in ${where}. Das Meer steht in den Straßen.`, `Storm surge in ${where}. The sea stands in the streets.`); break;
    case 'meteor': {
      if (city != null) ts.cdmg[city] = Math.min(1, (ts.cdmg[city] || 0) + 0.5);
      if (c) c.dmg = Math.min(1, c.dmg + 0.1);
      t = L(`Ein Meteorit schlägt bei ${where} ein. Forscher aus aller Welt reisen an, Sammler bieten Millionen für jedes Stück.`, `A meteorite strikes near ${where}. Researchers from all over the world arrive, collectors offer millions for every piece.`);
      break;
    }
    case 'traum': {
      if (tgt.hero && ts.hero) { ts.hero.log.push({ d: ts.day, t: L(`${ts.hero.first} träumt in dieser Nacht etwas, das alles verändert. Am Morgen kündigt ${ts.hero.sex === 'f' ? 'sie' : 'er'} und beginnt etwas Neues.`, `${ts.hero.first} dreams something that night that changes everything. In the morning ${ts.hero.sex === 'f' ? 'she' : 'he'} quits and starts something new.`) }); t = ''; break; }
      if (c) {
        // Traum an die Regierung: Wut auf den Nachbarn sinkt, Friedensgespräche werden wahrscheinlicher
        for (let j = 0; j < ts.c.length; j++) if (relation(ts, i, j) < -30) { const k = i < j ? i + '-' + j : j + '-' + i; ts.rel[k] = (ts.rel[k] || 0) + 12; }
        t = L(`${TODAY.list[i].headDe || 'Regierungschef'} ${c.lead} wacht nach einem seltsamen Traum auf und lädt die Nachbarn zu Gesprächen ein.`, `${TODAY.list[i].head || 'Head of government'} ${c.lead} wakes from a strange dream and invites the neighbours to talks.`);
      }
      break;
    }
    case 'funke': {
      ts.w.boost = (ts.w.boost || 0) + 1.5;
      if (c) c.g += 0.01;
      t = L(`An einer Universität in ${where} hat eine Forscherin um drei Uhr nachts die Idee ihres Lebens.`, `At a university in ${where}, a researcher has the idea of her life at three in the morning.`);
      break;
    }
    case 'komet': {
      for (const cc of ts.c) cc.faith = Math.min(1, cc.faith + 0.006);
      t = L('Ein heller Komet steht wochenlang am Himmel. Astronomen jubeln, Sekten verkünden das Ende, die meisten machen einfach Fotos.', 'A bright comet hangs in the sky for weeks. Astronomers cheer, sects proclaim the end, most people simply take photos.');
      break;
    }
    case 'fremde': if (c) c.g += 0.002; t = L(`Ein Boot mit Menschen aus einem fernen Land erreicht ${where}. Die Stadt streitet und hilft zugleich.`, `A boat with people from a distant land reaches ${where}. The city argues and helps at the same time.`); break;
    case 'heilung': if (c) { c.sick = 0; c.faith = Math.min(1, c.faith + 0.02); } t = c ? reading(ts, i, `In ${where} sinken die Krankenzahlen schlagartig. Ärzte rätseln über die Ursache.`, `In ${where} case numbers suddenly drop. Doctors puzzle over the cause.`, `In ${where} stehen Kranke von ihren Betten auf. Man spricht von einem Wunder.`, `In ${where} the sick rise from their beds. People speak of a miracle.`) : ''; break;
    case 'seuche': if (i >= 0) epidemic(ts, i, 0.03 + R.next() * 0.03, true); t = ''; break;
  }
  if (t) news(ts, 'gott', t, i, 2, at);
  if (i >= 0) answerPrayers(ts, id, i);
  return { ok: true, text: t, ctry: i, city };
}
