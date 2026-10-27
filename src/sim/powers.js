// Götterkräfte. Der Spieler greift nur indirekt ein: Jede Kraft verändert Natur oder Geist,
// und die Menschen deuten sie nach ihrer Kultur, ihrer Lage und ihrem Wissen.
import * as D from './data.js';
import { clamp } from './rng.js';
import { NX, NY, idx, inb } from './world.js';
import { mythName } from './names.js';
import {
  ageOf, knows, chron, fx, bio, makePerson, killPerson, members, shiftCult, rng, titleFor, seasonOf, isleOf,
} from './util.js';
import { learn, refreshCoast, destroyBuilding, indexMembers, newSettlement } from './core.js';
import { outbreak, foundSettlement, endWar, leaderOf, label, chooseLeader } from './society.js';
import { contact } from './sea.js';
import { L } from '../i18n.js';

const alive = st => st.settlements.filter(s => s.alive && s.pop > 0);

function nudge(s, k, v) {
  s.bias = s.bias || {};
  s.bias[k] = clamp((s.bias[k] || 0) + v, -0.35, 0.35);
  shiftCult(s, k, v * 0.5);
}

function faithAll(st, s, v) { for (const p of members(st, s).all) p.faith = clamp(p.faith + v, 0, 1); }
function hapAll(st, s, v) { for (const p of members(st, s).all) p.hap = clamp(p.hap + v, 0, 1); }

function nearSets(st, x, y, r) {
  return alive(st).filter(s => Math.hypot(s.cx - x, s.cy - y) <= r + s.R);
}

function nearestSet(st, x, y) {
  let best = null, bd = 1e9;
  for (const s of alive(st)) { const d = Math.hypot(s.cx - x, s.cy - y) - s.R; if (d < bd) { bd = d; best = s; } }
  return best;
}

export function myth(st, s, kind, good) {
  if (st.myths.some(m => m.s === s.id && m.kind === kind)) return null;
  const m = { name: mythName(rng(st), kind), d: st.day, doy: st.day % D.DAYS_PER_YEAR, s: s.id, kind, good };
  st.myths.push(m);
  chron(st, 'mythos', L(`In ${s.name} erzählt man sich fortan von „${m.name}“.${good ? ' Jedes Jahr an diesem Tag wird gefeiert.' : ''}`, `From now on, ${s.name} tells the tale of “${m.name}”.${good ? ' Every year on this day it is celebrated.' : ''}`), s.id, 1);
  return m;
}

function answer(st, id, sets) {
  const ids = new Set(sets.map(s => s.id));
  const done = st.prayers.filter(p => p.power === id && ids.has(p.s));
  for (const pr of done) {
    const s = st._rt.sById.get(pr.s);
    st.prayers = st.prayers.filter(p => p !== pr);
    if (!s) continue;
    faithAll(st, s, 0.12);
    hapAll(st, s, 0.05);
    s.blessed = st.day + 12;
    s.unanswered = 0;
    nudge(s, 'glaube', 0.05);
    st.counts.answered++;
    const who = st._rt.pById.get(pr.who);
    if (who) { who.fame += 2; bio(who, st.day, L('wird erhört', 'has a prayer answered')); }
    chron(st, 'gebet', rng(st).pick(L([
      `Das Gebet von ${pr.whoN} in ${s.name} wurde erhört. Man weint vor Freude.`,
      `${pr.whoN} hatte darum gebeten, und der Himmel hat geantwortet. ${s.name} wird diesen Tag nicht vergessen.`,
      `Erhört! In ${s.name} singen sie bis zum Morgen.`,
    ], [
      `The prayer of ${pr.whoN} in ${s.name} was answered. People weep for joy.`,
      `${pr.whoN} had asked for it, and the sky answered. ${s.name} will never forget this day.`,
      `Answered! In ${s.name} they sing until morning.`,
    ])), s.id, 1);
    myth(st, s, id, true);
  }
  return done.length;
}

// Wie eine Siedlung einen Eingriff deutet
function interpret(st, s, kind, power) {
  const r = rng(st), c = s.cult, ld = leaderOf(st, s);
  const science = (['regen', 'sonne', 'sturm', 'schnee', 'nebel', 'regenbogen'].includes(power) && knows(st, 'meteorologie', s))
    || (['komet', 'meteor'].includes(power) && knows(st, 'astronomie', s))
    || (['beben', 'vulkan', 'flut'].includes(power) && knows(st, 'elektronik', s));
  if (science && r.chance(0.75)) {
    nudge(s, 'wissen', 0.02); faithAll(st, s, kind === 'harm' ? -0.01 : 0.01);
    return r.pick(L([
      `Die Gelehrten von ${s.name} erklären alles mit Zahlen und Karten. Nur die Alten flüstern von einem Zeichen.`,
      `${s.name} misst, berechnet und schreibt Berichte. Ein paar Kinder legen trotzdem Blumen an den alten Schrein.`,
    ], [
      `The scholars of ${s.name} explain everything with numbers and maps. Only the old whisper of a sign.`,
      `${s.name} measures, calculates and writes reports. A few children still lay flowers at the old shrine.`,
    ]));
  }
  if (kind === 'gift') {
    faithAll(st, s, 0.05); hapAll(st, s, 0.04); nudge(s, 'glaube', 0.025);
    return c.glaube > 0.45 ? r.pick(L([
      `In ${s.name} spricht man von einem Wunder und bringt Gaben zum Schrein.`,
      `${s.name} dankt dem Himmel. ${ld ? label(ld) + ' ruft ein Fest aus.' : ''}`,
    ], [
      `In ${s.name} they speak of a miracle and bring gifts to the shrine.`,
      `${s.name} thanks the heavens. ${ld ? label(ld) + ' proclaims a feast.' : ''}`,
    ])) : r.pick(L([
      `In ${s.name} nennt man es Glück. Nur die Alten lächeln wissend.`,
      `${s.name} nimmt das Geschenk, ohne viel zu fragen.`,
    ], [
      `In ${s.name} they call it luck. Only the old smile knowingly.`,
      `${s.name} accepts the gift without asking many questions.`,
    ]));
  }
  if (kind === 'harm') {
    hapAll(st, s, -0.05);
    if (c.glaube > 0.5) {
      faithAll(st, s, 0.04); nudge(s, 'glaube', 0.04); nudge(s, 'tradition', 0.02);
      return r.pick(L([
        `In ${s.name} glaubt man, der Himmel zürne. Man fastet, man betet, man sucht Schuldige.`,
        `Die Priester von ${s.name} sagen, das sei die Strafe für den Hochmut der letzten Jahre.`,
      ], [
        `In ${s.name} people believe the heavens are angry. They fast, they pray, they look for someone to blame.`,
        `The priests of ${s.name} say this is the punishment for the pride of recent years.`,
      ]));
    }
    if (ld && ld.tr.wut > 0.65) {
      faithAll(st, s, -0.05); nudge(s, 'glaube', -0.04); nudge(s, 'macht', 0.03);
      return L(`${label(ld)} von ${s.name} schwört, dem Himmel zu trotzen. Man baut neu, nur trotziger.`, `${label(ld)} of ${s.name} vows to defy the heavens. They rebuild, only more stubbornly.`);
    }
    faithAll(st, s, -0.02); nudge(s, 'wissen', 0.03); nudge(s, 'glaube', -0.02);
    return r.pick(L([
      `In ${s.name} sucht man nach Ursachen, nicht nach Schuldigen.`,
      `${s.name} begräbt seine Toten und fragt, ob da oben überhaupt jemand ist.`,
    ], [
      `In ${s.name} they look for causes, not for culprits.`,
      `${s.name} buries its dead and wonders whether anyone is up there at all.`,
    ]));
  }
  // Zeichen
  if (s.unrest > 0.45) {
    s.omen = (s.omen || 0) + 0.2;
    return L(`Für viele in ${s.name} ist es das Ende der alten Ordnung. ${ld ? label(ld) + ' wirkt plötzlich sehr klein.' : ''}`, `For many in ${s.name} this is the end of the old order. ${ld ? label(ld) + ' suddenly looks very small.' : ''}`);
  }
  if (c.glaube > 0.5) {
    faithAll(st, s, 0.05); nudge(s, 'glaube', 0.03);
    return r.pick(L([`Ein Zeichen! In ${s.name} streiten die Deuter bis tief in die Nacht.`, `${s.name} versammelt sich am Strand und schaut nach oben. Niemand spricht.`], [`A sign! In ${s.name} the interpreters argue deep into the night.`, `${s.name} gathers on the beach and looks up. Nobody speaks.`]));
  }
  nudge(s, 'wissen', 0.02);
  return L(`In ${s.name} zeichnen Neugierige auf, was sie sehen.`, `In ${s.name} the curious write down what they see.`);
}

function tellAll(st, sets, kind, power, lead) {
  const lines = sets.map(s => interpret(st, s, kind, power));
  if (lead) chron(st, 'gott', lead, -1, 1, { power });
  for (let i = 0; i < sets.length; i++) chron(st, 'deutung', lines[i], sets[i].id, 0);
}

function setWeather(st, kind, god, days) {
  const w = st.weather;
  w.kind = kind; w.god = god; w.until = st.day + days;
}

// cause ist ein interner Code für killPerson (wird nicht übersetzt), why der Text für die Chronik
function damageArea(st, x, y, r, strength, cause, why = cause) {
  const rr = rng(st), rt = st._rt;
  let destroyed = 0, dead = 0;
  for (const b of st.buildings.slice()) {
    const d = Math.hypot(b.x - x, b.y - y);
    if (d > r) continue;
    b.hp -= (1 - d / (r + 1)) * rr.range(0.6, 1.3) * strength;
    if (b.hp <= 0) { destroyBuilding(st, b, why); destroyed++; }
  }
  for (const p of st.people.slice()) {
    const h = p.home > 0 ? rt.bById.get(p.home) : null;
    const s = rt.sById.get(p.s);
    const px = h ? h.x : s ? s.cx : 0, py = h ? h.y : s ? s.cy : 0;
    const d = Math.hypot(px - x, py - y);
    if (d <= r && rr.chance(0.07 * strength * (1 - d / (r + 1)))) { killPerson(st, p, cause); dead++; }
  }
  return { destroyed, dead };
}

// ---------- Kräfte ----------

const H = {
  regen(st) {
    const before = st.weather.moist;
    setWeather(st, 'regen', 'regen', 3);
    st.weather.moist = clamp(before + 0.2, 0, 1);
    st.tiles.burn.fill(0);
    const sets = alive(st);
    const n = answer(st, 'regen', sets);
    if (before > 0.8) tellAll(st, sets, 'harm', 'regen', L('Noch mehr Regen. Die Felder ertrinken, die Kinder schauen sehnsüchtig aus den Türen.', 'Even more rain. The fields drown, the children gaze longingly out of the doorways.'));
    else if (!n) tellAll(st, sets.filter(s => before < 0.35 || s.hunger > 0.05), 'gift', 'regen', before < 0.35 ? L('Regen nach langer Dürre. Die Erde atmet auf.', 'Rain after a long drought. The earth breathes again.') : null);
    return { msg: L('Regen fällt über die Insel.', 'Rain falls over the island.') };
  },
  sonne(st) {
    const season = seasonOf(st.day), sets = alive(st);
    setWeather(st, 'klar', 'sonne', 3);
    const n = answer(st, 'sonne', sets);
    if (season === 1 && st.weather.moist < 0.4) {
      st.weather.moist = Math.max(0, st.weather.moist - 0.15);
      tellAll(st, sets, 'harm', 'sonne', L('Die Sonne brennt erbarmungslos. Das Korn wird gelb, bevor es reif ist.', 'The sun burns mercilessly. The grain turns yellow before it is ripe.'));
    } else if (!n) tellAll(st, sets, 'gift', 'sonne', season === 3 ? L('Mitten im Winter wird es warm. Die Alten setzen sich vor die Türen.', 'Warmth in the middle of winter. The old ones sit down in front of their doors.') : L('Goldenes Licht über der Insel.', 'Golden light over the island.'));
    return { msg: L('Die Sonne lacht.', 'The sun smiles.') };
  },
  sturm(st) {
    const r = rng(st), T = st.tiles, sets = alive(st);
    setWeather(st, 'sturm', 'sturm', 2);
    let destroyed = 0, trees = 0;
    for (const b of st.buildings.slice()) {
      if (b.t === 'zentrum') continue;
      b.hp -= r.range(0, st.era <= 2 ? 0.55 : 0.28) * (b.t === 'feld' ? 0.3 : 1);
      if (b.hp <= 0) { destroyBuilding(st, b, L('im Sturm', 'in the storm')); destroyed++; }
    }
    for (let i = 0; i < NX * NY; i++) if (T.tree[i] && r.chance(0.08)) { T.tree[i]--; trees++; }
    for (const s of sets) s.stock.wood += trees / sets.length * 0.5;
    let drowned = 0;
    for (const s of sets) {
      if (s.has.leuchtturm) continue;
      const fishers = members(st, s).adults.filter(p => p.job === 'fischer');
      if (fishers.length && r.chance(0.5)) { const p = r.pick(fishers); killPerson(st, p, 'See'); drowned++; }
    }
    tellAll(st, sets, 'harm', 'sturm', L(`Ein Sturm fegt über die Insel. ${destroyed ? destroyed + ' Gebäude stürzen ein' : 'Dächer fliegen'}${drowned ? `, ${drowned} Fischer kehren nicht heim` : ''}.`, `A storm sweeps across the island. ${destroyed ? destroyed + (destroyed === 1 ? ' building collapses' : ' buildings collapse') : 'Roofs fly off'}${drowned ? `, ${drowned} ${drowned === 1 ? 'fisherman does' : 'fishermen do'} not return home` : ''}.`));
    for (const s of sets) myth(st, s, 'sturm', false);
    st._rt.dirtyT = true;
    return { msg: L('Der Sturm bricht los.', 'The storm breaks loose.') };
  },
  blitz(st, t) {
    const r = rng(st), T = st.tiles, rt = st._rt;
    const { x, y } = t;
    if (!inb(x, y)) return { ok: false, msg: L('Daneben.', 'Missed.') };
    const i = idx(x, y);
    const bid = rt.bldAt[i];
    let hit = null;
    if (bid) { const b = rt.bById.get(bid); hit = b; b.hp -= 0.4; T.burn[i] = 3; }
    if (T.tree[i]) T.burn[i] = 3;
    let dead = 0;
    for (const p of st.people.slice()) {
      const h = p.home > 0 ? rt.bById.get(p.home) : null;
      const w = p.w > 0 ? rt.bById.get(p.w) : null;
      if ([h, w].some(b => b && Math.hypot(b.x - x, b.y - y) <= 1) && r.chance(0.2)) { killPerson(st, p, 'Blitz'); dead++; }
    }
    const s = nearestSet(st, x, y);
    if (s && !knows(st, 'feuer', s) && Math.hypot(s.cx - x, s.cy - y) < 18) {
      T.burn[i] = Math.max(T.burn[i], 2);
      learn(st, 'feuer', null, isleOf(st, s));
      chron(st, 'gott', L(`Ein Blitz fährt in einen Baum bei ${s.name}. Die Menschen tragen die Flamme in Schalen nach Hause. Sie haben das Feuer.`, `A bolt of lightning strikes a tree near ${s.name}. The people carry the flame home in bowls. They have fire.`), s.id, 2, { power: 'blitz' });
      myth(st, s, 'blitz', true);
      nudge(s, 'glaube', 0.06);
      faithAll(st, s, 0.1);
    } else if (s && Math.hypot(s.cx - x, s.cy - y) < s.R + 4) {
      const line = interpret(st, s, hit || dead ? 'harm' : 'sign', 'blitz');
      chron(st, 'gott', L(`Ein Blitz schlägt bei ${s.name} ein${hit ? `, ${D.BUILDINGS[hit.t].name} brennt` : ''}${dead ? `, ${dead} ${dead === 1 ? 'Mensch stirbt' : 'Menschen sterben'}` : ''}.`, `Lightning strikes near ${s.name}${hit ? `, the ${D.BUILDINGS[hit.t].name.toLowerCase()} burns` : ''}${dead ? `, ${dead} ${dead === 1 ? 'person dies' : 'people die'}` : ''}.`), s.id, 1, { power: 'blitz' });
      chron(st, 'deutung', line, s.id, 0);
      if (hit || dead) myth(st, s, 'blitz', false);
    }
    rt.dirtyT = true;
    return { msg: L('Ein Blitz zuckt herab.', 'Lightning flashes down.'), fx: { x, y } };
  },
  schnee(st) {
    const season = seasonOf(st.day), sets = alive(st);
    setWeather(st, 'schnee', 'schnee', 3);
    st.weather.moist = clamp(st.weather.moist + 0.05, 0, 1);
    if (season !== 3) {
      for (const s of sets) s.stock.food *= 0.9;
      tellAll(st, sets, 'sign', 'schnee', season === 1 ? L('Schnee im Hochsommer! Das Korn erfriert, die Kinder bauen Figuren.', 'Snow in high summer! The grain freezes, the children build snow figures.') : L('Früher Schnee legt sich über die Insel.', 'Early snow settles over the island.'));
    } else tellAll(st, sets, 'sign', 'schnee', L('Tiefer Schnee. Die Insel wird still.', 'Deep snow. The island falls silent.'));
    for (const s of sets) for (const p of members(st, s).all) if (p.home <= 0) p.hp = Math.max(0, p.hp - 0.12);
    return { msg: L('Schnee fällt.', 'Snow falls.') };
  },
  nebel(st) {
    const sets = alive(st);
    setWeather(st, 'nebel', 'nebel', 3);
    answer(st, 'nebel', sets);
    tellAll(st, sets, 'sign', 'nebel', L('Dichter Nebel steigt aus dem Meer. Man sieht die eigene Hand kaum.', 'Thick fog rises from the sea. You can barely see your own hand.'));
    return { msg: L('Nebel legt sich über alles.', 'Fog settles over everything.') };
  },
  regenbogen(st) {
    const sets = alive(st);
    st.flags.rainbow = st.day + 2;
    for (const s of sets) { hapAll(st, s, 0.08); faithAll(st, s, 0.04); nudge(s, 'glaube', 0.02); }
    for (const a of sets) for (const b of sets) if (a !== b) a.rel[b.id] = clamp((a.rel[b.id] ?? 0) + 25, -100, 100);
    let peace = 0;
    for (const a of sets) if (a.war && a.aggressor) { const b = st._rt.sById.get(a.war); if (b && (a.rel[b.id] ?? 0) > -35) { endWar(st, a, b); peace++; } }
    answer(st, 'regenbogen', sets);
    chron(st, 'gott', peace ? L('Ein Regenbogen spannt sich über die Insel, genau zwischen den Heerlagern. Die Krieger lassen die Waffen sinken.', 'A rainbow arches over the island, right between the war camps. The warriors lower their weapons.') : L('Ein Regenbogen spannt sich von Küste zu Küste. Für einen Moment sind alle Siedlungen eins.', 'A rainbow stretches from coast to coast. For a moment all settlements are one.'), -1, 1, { power: 'regenbogen' });
    for (const s of sets) myth(st, s, 'regenbogen', true);
    return { msg: L('Ein Regenbogen erscheint.', 'A rainbow appears.') };
  },
  segen(st, t, P) {
    const r = rng(st), T = st.tiles, rt = st._rt;
    const { x, y } = t;
    st.effects.push({ k: 'segen', x, y, r: P.radius, until: st.day + 24 });
    for (let dy = -P.radius; dy <= P.radius; dy++) for (let dx = -P.radius; dx <= P.radius; dx++) {
      const xx = x + dx, yy = y + dy;
      if (!inb(xx, yy) || Math.hypot(dx, dy) > P.radius) continue;
      const i = idx(xx, yy);
      const hb = (rt.hb || T.h)[i];
      if (hb < 1 || hb > 3) continue;
      T.fert[i] = Math.min(100, T.fert[i] + 25);
      if (!rt.bldAt[i] && T.road[i] < 40 && r.chance(0.3)) T.tree[i] = Math.min(3, T.tree[i] + 1);
    }
    const sets = nearSets(st, x, y, P.radius);
    for (const s of sets) s.cache.at = -99;
    const n = answer(st, 'segen', sets);
    if (!n) tellAll(st, sets, 'gift', 'segen', sets.length ? L('Die Erde wird weich und dunkel. Wo man hinsieht, keimt es.', 'The earth turns soft and dark. Wherever you look, something sprouts.') : null);
    for (const s of sets) myth(st, s, 'segen', true);
    rt.dirtyT = true;
    return { msg: L('Das Land ergrünt.', 'The land turns green.'), fx: { x, y, r: P.radius } };
  },
  fische(st, t, P) {
    const { x, y } = t;
    st.effects.push({ k: 'fische', x, y, r: P.radius, until: st.day + 18 });
    const sets = nearSets(st, x, y, P.radius + 4);
    for (const s of sets) s.cache.at = -99;
    const n = answer(st, 'fische', sets);
    if (!n) tellAll(st, sets, 'gift', 'fische', sets.length ? L('Das Wasser vor der Küste glitzert silbern. Die Netze reißen fast.', 'The water off the coast glitters silver. The nets nearly tear.') : null);
    return { msg: L('Silberne Schwärme ziehen heran.', 'Silver shoals draw near.'), fx: { x, y, r: P.radius } };
  },
  beben(st, t, P) {
    const T = st.tiles;
    const { x, y } = t;
    const res = damageArea(st, x, y, P.radius, 1, 'beim Beben', L('beim Beben', 'in the quake'));
    for (let dy = -P.radius; dy <= P.radius; dy++) for (let dx = -P.radius; dx <= P.radius; dx++) {
      const xx = x + dx, yy = y + dy;
      if (inb(xx, yy) && T.h[idx(xx, yy)] >= 3) T.ore[idx(xx, yy)] = Math.min(255, T.ore[idx(xx, yy)] + 60);
    }
    const sets = nearSets(st, x, y, P.radius);
    tellAll(st, sets, 'harm', 'beben', L(`Die Erde bebt. ${res.destroyed} Gebäude fallen${res.dead ? `, ${res.dead} Menschen sterben unter den Trümmern` : ''}.`, `The earth shakes. ${res.destroyed} ${res.destroyed === 1 ? 'building falls' : 'buildings fall'}${res.dead ? `, ${res.dead} ${res.dead === 1 ? 'person dies' : 'people die'} under the rubble` : ''}.`));
    for (const s of sets) myth(st, s, 'beben', false);
    st._rt.dirtyT = true;
    return { msg: L('Die Erde bebt.', 'The earth shakes.'), fx: { x, y, r: P.radius } };
  },
  vulkan(st, t, P) {
    const T = st.tiles;
    let best = null, bh = 2;
    for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) {
      const xx = t.x + dx, yy = t.y + dy;
      if (!inb(xx, yy)) continue;
      const h = T.h[idx(xx, yy)] - Math.hypot(dx, dy) * 0.05;
      if (h > bh) { bh = h; best = [xx, yy]; }
    }
    if (!best) return { ok: false, msg: L('Hier ist kein Berg, der erwachen könnte.', 'There is no mountain here that could awaken.') };
    const [x, y] = best;
    st.effects.push({ k: 'vulkan', x, y, r: P.radius, until: st.day + 5 });
    const i = idx(x, y);
    T.h[i] = Math.min(6, T.h[i] + 1);
    const res = damageArea(st, x, y, 3, 2.5, 'unter der Lava', L('unter der Lava', 'under the lava'));
    for (let dy = -P.radius; dy <= P.radius; dy++) for (let dx = -P.radius; dx <= P.radius; dx++) {
      const xx = x + dx, yy = y + dy;
      if (inb(xx, yy) && T.tree[idx(xx, yy)] && Math.hypot(dx, dy) <= P.radius) T.burn[idx(xx, yy)] = 3;
    }
    const near = nearSets(st, x, y, P.radius + 2), far = alive(st).filter(s => !near.includes(s));
    tellAll(st, near, 'harm', 'vulkan', L(`Der Berg erwacht. Feuer läuft die Hänge hinab, Asche verdunkelt den Himmel.${res.dead ? ` ${res.dead} Menschen sterben.` : ''}`, `The mountain awakens. Fire runs down the slopes, ash darkens the sky.${res.dead ? ` ${res.dead} ${res.dead === 1 ? 'person dies' : 'people die'}.` : ''}`));
    for (const s of far) chron(st, 'deutung', interpret(st, s, 'sign', 'vulkan'), s.id, 0);
    for (const s of alive(st)) myth(st, s, 'vulkan', false);
    st._rt.dirtyT = true; st._rt.dirtyH = true;
    return { msg: L('Der Vulkan bricht aus.', 'The volcano erupts.'), fx: { x, y, r: P.radius } };
  },
  flut(st) {
    const r = rng(st), T = st.tiles, rt = st._rt;
    let destroyed = 0, dead = 0;
    for (const b of st.buildings.slice()) {
      const h = T.h[idx(b.x, b.y)];
      if (h === 0 || (h === 1 && rt.coast[idx(b.x, b.y)])) {
        b.hp -= h === 0 ? 0.95 : 0.5;
        if (b.hp <= 0) {
          for (const p of st.people.slice()) if ((p.home === b.id || p.w === b.id) && r.chance(0.15)) { killPerson(st, p, 'Flut'); dead++; }
          destroyBuilding(st, b, L('in der Flut', 'in the flood')); destroyed++;
        }
      }
    }
    for (let i = 0; i < NX * NY; i++) {
      if (T.h[i] === 0) T.tree[i] = 0;
      if ((T.h[i] === 0 || T.h[i] === 1) && rt.coast[i]) T.fert[i] = Math.max(0, T.fert[i] - 20);
    }
    const sets = alive(st);
    tellAll(st, sets, 'harm', 'flut', L(`Das Meer steigt und holt sich die Küste. ${destroyed} Gebäude werden fortgespült${dead ? `, ${dead} Menschen ertrinken` : ''}.`, `The sea rises and claims the coast. ${destroyed} ${destroyed === 1 ? 'building is' : 'buildings are'} washed away${dead ? `, ${dead} ${dead === 1 ? 'person drowns' : 'people drown'}` : ''}.`));
    for (const s of sets) myth(st, s, 'flut', false);
    rt.dirtyT = true;
    return { msg: L('Die Flut kommt.', 'The flood comes.') };
  },
  meteor(st, t, P) {
    const T = st.tiles;
    const { x, y } = t;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (!inb(xx, yy) || Math.hypot(dx, dy) > 1.6) continue;
      const i = idx(xx, yy);
      if (T.h[i] > 0) T.h[i] = Math.max(0, T.h[i] - 1);
      T.tree[i] = 0;
    }
    if (inb(x, y)) T.ore[idx(x, y)] = 240;
    const res = damageArea(st, x, y, 4, 1.8, 'beim Einschlag', L('beim Einschlag', 'in the impact'));
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (inb(x + dx, y + dy) && T.tree[idx(x + dx, y + dy)]) T.burn[idx(x + dx, y + dy)] = 2;
    st.sites.push({ k: 'krater', x, y, d: st.day });
    const s = nearestSet(st, x, y);
    const Im = s && isleOf(st, s);
    const cur = Im && Im.research.cur && D.TECH[Im.research.cur];
    if (cur) Im.research.pts += cur.cost * 0.25;
    chron(st, 'gott', L(`Ein Stern fällt vom Himmel und schlägt ${s ? `bei ${s.name}` : 'in die Wildnis'} ein.${res.dead ? ` ${res.dead} Menschen sterben im Feuer.` : ''} Im Krater glänzt Metall, das niemand kennt.`, `A star falls from the sky and crashes ${s ? `near ${s.name}` : 'into the wilderness'}.${res.dead ? ` ${res.dead} ${res.dead === 1 ? 'person dies' : 'people die'} in the fire.` : ''} In the crater gleams a metal that nobody knows.`), s ? s.id : -1, 2, { power: 'meteor', x, y });
    if (s) {
      chron(st, 'deutung', interpret(st, s, res.dead ? 'harm' : 'sign', 'meteor'), s.id, 0);
      nudge(s, 'glaube', 0.05); nudge(s, 'wissen', 0.05);
      myth(st, s, 'meteor', !res.dead);
    }
    refreshCoast(st);
    st._rt.dirtyT = true; st._rt.dirtyH = true;
    return { msg: L('Ein Stern fällt.', 'A star falls.'), fx: { x, y } };
  },
  traum(st, t) {
    const r = rng(st), rt = st._rt;
    const p = rt.pById.get(t.pid);
    if (!p) return { ok: false, msg: L('Dieser Mensch lebt nicht mehr.', 'This person is no longer alive.') };
    const theme = D.DREAMS[t.theme] ? t.theme : 'frieden';
    const Dm = D.DREAMS[theme];
    const s = rt.sById.get(p.s);
    for (const [k, v] of Object.entries(Dm.trait)) p.tr[k] = clamp(p.tr[k] + v, 0.02, 0.98);
    p.dream = theme;
    p.title = p.title || titleFor(p, theme === 'glaube' ? 'Prophet' : L('Seher', 'Seer'));
    p.fame += 4; p.fac = null;
    bio(p, st.day, L(`träumt von ${Dm.name}`, `dreams of ${Dm.name.toLowerCase()}`));
    const power = 0.6 + p.tr.charisma * 0.8 + (p.lt ? 0.5 : 0);
    for (const [k, v] of Object.entries(Dm.culture)) nudge(s, k, v * power);
    let extra = '';
    // Pronomen für die englischen Sätze (die deutschen werden unten per Ersetzung angepasst)
    const pn = p.sex === 'm' ? { he: 'he', He: 'He', his: 'his', His: 'His', him: 'him' } : { he: 'she', He: 'She', his: 'her', His: 'Her', him: 'her' };
    const sets = alive(st).filter(o => o !== s);
    switch (theme) {
      case 'frieden':
        for (const o of sets) { s.rel[o.id] = clamp((s.rel[o.id] ?? 0) + 20, -100, 100); o.rel[s.id] = s.rel[o.id]; }
        if (s.war && (p.lt || p.tr.charisma > 0.55)) { const o = rt.sById.get(s.war); endWar(st, s, o); extra = L(' Die Waffen schweigen.', ' The weapons fall silent.'); }
        else extra = L(' Man hört ihr zu, wenn sie vom Frieden spricht.', ` People listen to ${pn.him} when ${pn.he} speaks of peace.`);
        break;
      case 'krieg':
        for (const o of sets) { s.rel[o.id] = clamp((s.rel[o.id] ?? 0) - 22, -100, 100); o.rel[s.id] = s.rel[o.id]; }
        extra = L(' Junge Leute beginnen, Speere zu schnitzen.', ' Young people begin to carve spears.');
        break;
      case 'wissen': {
        const Is = isleOf(st, s), cur = Is.research.cur && D.TECH[Is.research.cur];
        if (cur) Is.research.pts += cur.cost * 0.2;
        if (ageOf(st, p) >= 14 && ageOf(st, p) < 64) { p.job = 'gelehrter'; p.w = -1; }
        extra = L(' Am Morgen zeichnet sie Dinge in den Sand, die es noch nicht gibt.', ` By morning ${pn.he} draws things in the sand that do not exist yet.`);
        break;
      }
      case 'glaube':
        faithAll(st, s, 0.06);
        if (p.tr.charisma > 0.55 && s.gov.type !== 'theokratie') s.omen = (s.omen || 0) + 0.15;
        if (ageOf(st, p) >= 14 && ageOf(st, p) < 64) { p.job = 'priester'; p.w = -1; }
        extra = L(' Sie predigt auf dem Platz, und die Menge wächst jeden Tag.', ` ${pn.He} preaches in the square, and the crowd grows every day.`);
        break;
      case 'freiheit':
        if (['koenigtum', 'diktatur', 'theokratie', 'haeuptling'].includes(s.gov.type)) { s.unrest = clamp(s.unrest + 0.15, 0, 1); extra = L(` Ihre Worte gehen von Mund zu Mund. ${label(leaderOf(st, s))} lässt sie beobachten.`, ` ${pn.His} words pass from mouth to mouth. ${label(leaderOf(st, s))} has ${pn.him} watched.`); }
        else extra = L(' Man schreibt ihre Worte auf.', ` People write down ${pn.his} words.`);
        break;
      case 'meer':
        if (!knows(st, 'segeln', s)) {
          const Is = isleOf(st, s);
          if (D.TECH.segeln.req.every(q => knows(st, q, s))) { Is.research.cur = 'segeln'; Is.research.pts += D.TECH.segeln.cost * 0.3; }
          extra = L(' Sie baut ein Boot, obwohl keiner weiß, wie das geht.', ` ${pn.He} builds a boat, although nobody knows how it is done.`);
        } else {
          const crew = members(st, s).adults.filter(q => q !== p && !q.lt && q.tr.mut > 0.5).slice(0, r.int(2, 4));
          const names = [p.n, ...crew.map(q => q.n)];
          for (const q of [p, ...crew]) { q.s = -1; q.away = true; }
          st.flags.exp = st.flags.exp || [];
          st.flags.exp.push({ d: st.day + r.int(24, 72), s: s.id, ids: [p.id, ...crew.map(q => q.id)], lead: p.n });
          extra = L(` Mit ${names.length - 1} Gefährten sticht sie in See, dem Horizont entgegen.`, ` With ${names.length - 1} ${names.length - 1 === 1 ? 'companion' : 'companions'} ${pn.he} sets sail toward the horizon.`);
        }
        break;
      case 'kunst':
        if (ageOf(st, p) >= 14 && ageOf(st, p) < 64) { p.job = 'kuenstler'; p.w = -1; }
        extra = L(' Sie malt die Wände von ' + s.name + ' in Farben, die es vorher nicht gab.', ` ${pn.He} paints the walls of ${s.name} in colors that did not exist before.`);
        break;
      case 'sterne': {
        const Is = isleOf(st, s), cur = Is.research.cur && D.TECH[Is.research.cur];
        if (cur) Is.research.pts += cur.cost * 0.15;
        extra = L(' Sie zählt die Sterne und gibt ihnen Namen.', ` ${pn.He} counts the stars and gives them names.`);
        break;
      }
    }
    if (p.sex === 'm') extra = extra.replace(/\bsie\b/g, 'er').replace(/\bSie\b/g, 'Er').replace(/\bihr\b/g, 'ihm');
    chron(st, 'gott', L(`${p.lt ? p.lt + ' ' : ''}${p.n} aus ${s.name} träumt von ${Dm.name}.${extra}`, `${p.lt ? p.lt + ' ' : ''}${p.n} of ${s.name} dreams of ${Dm.name.toLowerCase()}.${extra}`), s.id, 1, { power: 'traum', pid: p.id });
    myth(st, s, 'traum', true);
    indexMembers(st);
    return { msg: L(`${p.n} träumt.`, `${p.n} dreams.`) };
  },
  funke(st, t) {
    const r = rng(st);
    const s = st._rt.sById.get(t.sid) || nearestSet(st, t.x, t.y);
    if (!s) return { ok: false, msg: L('Niemand da, der denken könnte.', 'There is nobody who could think.') };
    const Is = isleOf(st, s), cur = Is.research.cur && D.TECH[Is.research.cur];
    if (cur) Is.research.pts += Math.max(20, cur.cost * 0.3);
    const M = members(st, s);
    const pool = M.adults.concat(M.old);
    const who = pool.length ? pool.reduce((a, p) => (p.tr.neugier + r.next() * 0.2 > a.tr.neugier ? p : a), pool[0]) : null;
    if (who) { who.title = who.title || titleFor(who, L('Erfinder', 'Inventor')); who.fame += 3; bio(who, st.day, L('hat eine Erleuchtung', 'has an epiphany')); who.tr.neugier = clamp(who.tr.neugier + 0.2, 0, 0.98); }
    nudge(s, 'wissen', 0.05);
    const n = answer(st, 'funke', [s]);
    if (!n) chron(st, 'gott', L(`${who ? who.n : 'Jemand'} in ${s.name} schreckt nachts hoch, eine Idee im Kopf, so hell wie ein Feuer.${cur ? ` Das Wissen um ${cur.name} rückt näher.` : ''}`, `${who ? who.n : 'Someone'} in ${s.name} wakes with a start in the night, an idea in mind as bright as a fire.${cur ? ` Knowledge of ${cur.name.toLowerCase()} draws closer.` : ''}`), s.id, 1, { power: 'funke' });
    return { msg: L('Ein Funke springt über.', 'A spark leaps across.') };
  },
  komet(st) {
    const sets = alive(st);
    st.effects.push({ k: 'komet', x: 0, y: 0, r: 0, until: st.day + 4 });
    answer(st, 'komet', sets);
    tellAll(st, sets, 'sign', 'komet', L('Ein Komet steht am Himmel, mit einem Schweif aus Licht. Er bleibt vier Nächte.', 'A comet hangs in the sky, with a tail of light. It stays for four nights.'));
    for (const s of sets) myth(st, s, 'komet', s.cult.glaube > 0.5);
    return { msg: L('Ein Komet erscheint.', 'A comet appears.') };
  },
  fremde(st, t) {
    const r = rng(st), T = st.tiles, rt = st._rt;
    let spot = null, bd = 1e9;
    for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
      const xx = t.x + dx, yy = t.y + dy;
      if (!inb(xx, yy)) continue;
      const i = idx(xx, yy);
      if (!rt.coast[i] || !rt.isleOf[i] || T.h[i] > 1 || rt.bldAt[i]) continue;
      const d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; spot = [xx, yy]; }
    }
    if (!spot) return { ok: false, msg: L('Hier gibt es keinen Strand zum Landen.', 'There is no beach here to land on.') };
    const [x, y] = spot;
    const n = r.int(4, 7);
    const s = nearestSet(st, x, y);
    const dist = s ? Math.hypot(s.cx - x, s.cy - y) : 99;
    const hostile = s && (s.laws.includes('abschottung') || (s.cult.tradition > 0.65 && s.cult.macht > 0.55));
    const welcome = s && s.laws.includes('gastrecht');
    const canFound = st.settlements.filter(o => o.alive).length < st._rt.maxSet;
    let host = s || st.settlements.find(o => o.alive);
    let fresh = false;
    if (!host) {
      // Die Insel ist leer: die Fremden beginnen ganz von vorn
      host = newSettlement(st, x, y, 4, Object.fromEntries(Object.keys(D.CULTURE).map(k => [k, r.range(0.3, 0.6)])));
      fresh = true;
    }
    const arrivals = [];
    for (let k = 0; k < n; k++) {
      const p = makePerson(st, host, { b: st.day - r.int(16, 34) * D.DAYS_PER_YEAR, lang: 4, traits: { neugier: r.range(0.5, 0.95) } });
      p.foreign = true; p.fame = 1;
      bio(p, st.day, L('strandet als Fremde auf der Insel', 'washes ashore on the island as a stranger'));
      arrivals.push(p);
    }
    for (let k = 0; k + 1 < arrivals.length; k += 2) if (arrivals[k].sex !== arrivals[k + 1].sex) { arrivals[k].pa = arrivals[k + 1].id; arrivals[k + 1].pa = arrivals[k].id; }
    if (fresh) {
      indexMembers(st);
      chooseLeader(st, host, true);
      chron(st, 'fremde', L(`Die Insel war still geworden. Nun landet ein Boot mit ${n} Fremden, und an den alten Ruinen brennt wieder ein Feuer. Sie nennen den Ort ${host.name}.`, `The island had fallen silent. Now a boat lands with ${n} strangers, and a fire burns again among the old ruins. They name the place ${host.name}.`), host.id, 2, { power: 'fremde' });
      myth(st, host, 'fremde', true);
      return { msg: L('Ein Boot nähert sich der Küste.', 'A boat approaches the coast.'), fx: { x, y } };
    }
    const gift = () => {
      const Ih = isleOf(st, arrivals[0].s) || isleOf(st, host);
      const avail = D.TECHS.filter(tt => !knows(st, tt.id, Ih.id) && tt.req.every(q => knows(st, q, Ih.id)) && tt.era <= Ih.era + 1);
      if (avail.length && r.chance(0.45)) { const tt = r.pick(avail); learn(st, tt.id, arrivals[0], Ih); return L(` Sie bringen das Wissen um ${tt.name}.`, ` They bring knowledge of ${tt.name.toLowerCase()}.`); }
      const cur = Ih.research.cur && D.TECH[Ih.research.cur];
      if (cur) Ih.research.pts += cur.cost * 0.25;
      return L(' Sie erzählen von Inseln jenseits des Horizonts.', ' They tell of islands beyond the horizon.');
    };
    if ((hostile || !s || dist > 24) && canFound) {
      indexMembers(st);
      const ns = foundSettlement(st, x, y, arrivals, { lang: 4, cultShift: { wissen: 0.15, handel: 0.1 } });
      if (s) { ns.rel[s.id] = s.rel[ns.id] = hostile ? -35 : 10; }
      const gf = gift();
      chron(st, 'fremde', L(`Ein fremdes Boot landet. ${n} Menschen mit seltsamer Sprache bleiben am Strand und gründen ${ns.name}.${hostile ? ` ${s.name} betrachtet sie mit Argwohn.` : ''}${gf}`, `A strange boat lands. ${n} people with a strange tongue stay on the beach and found ${ns.name}.${hostile ? ` ${s.name} regards them with suspicion.` : ''}${gf}`), ns.id, 2, { power: 'fremde' });
      myth(st, ns, 'fremde', true);
    } else if (hostile) {
      let dead = 0;
      for (const p of arrivals) if (r.chance(0.4)) { killPerson(st, p, 'Vertreibung'); dead++; }
      chron(st, 'fremde', L(`Fremde landen bei ${s.name}, doch man empfängt sie mit Speeren.${dead ? ` ${dead} sterben am Strand.` : ''} Der Rest bleibt, geduldet, aber nicht willkommen.`, `Strangers land near ${s.name}, but they are met with spears.${dead ? ` ${dead} ${dead === 1 ? 'dies' : 'die'} on the beach.` : ''} The rest stay, tolerated but not welcome.`), s.id, 1, { power: 'fremde' });
      nudge(s, 'macht', 0.04);
    } else {
      const gf = gift();
      chron(st, 'fremde', L(`${n} Fremde stranden bei ${s.name}.${welcome ? ' Das Gastrecht gilt, man teilt Brot und Bett.' : ' Nach einigem Zögern teilt man das Feuer mit ihnen.'}${gf}`, `${n} strangers wash ashore near ${s.name}.${welcome ? ' The right of hospitality holds, they share bread and bed.' : ' After some hesitation, they share the fire with them.'}${gf}`), s.id, 1, { power: 'fremde' });
      nudge(s, 'wissen', 0.04); nudge(s, 'freiheit', 0.03);
      myth(st, s, 'fremde', true);
    }
    indexMembers(st);
    return { msg: L('Ein Boot nähert sich der Küste.', 'A boat approaches the coast.'), fx: { x, y } };
  },
  heilung(st, t) {
    const T = st.tiles, rt = st._rt;
    const s = rt.sById.get(t.sid) || nearestSet(st, t.x, t.y);
    if (!s) return { ok: false, msg: L('Niemand zu heilen.', 'Nobody to heal.') };
    let healed = 0;
    for (const p of members(st, s).all) { if (p.sick) healed++; p.sick = 0; p.hp = clamp(p.hp + 0.4, 0, 1); }
    if (!st.sites.some(q => q.k === 'quelle' && q.s === s.id)) {
      let spot = null;
      for (let k = 2; k < 8 && !spot; k++) for (let a = 0; a < 12 && !spot; a++) {
        const xx = Math.round(s.cx + Math.cos(a) * k), yy = Math.round(s.cy + Math.sin(a) * k);
        if (inb(xx, yy) && T.h[idx(xx, yy)] >= 1 && !rt.bldAt[idx(xx, yy)]) spot = [xx, yy];
      }
      if (spot) { st.sites.push({ k: 'quelle', x: spot[0], y: spot[1], s: s.id, d: st.day }); s.spring = true; }
    }
    faithAll(st, s, 0.08); nudge(s, 'glaube', 0.04);
    const n = answer(st, 'heilung', [s]);
    if (!n) chron(st, 'gott', L(`In ${s.name} stehen die Kranken auf.${healed ? ` ${healed} Menschen genesen über Nacht.` : ''} Am Hang sprudelt eine Quelle, die vorher nicht da war.`, `In ${s.name} the sick rise from their beds.${healed ? ` ${healed} ${healed === 1 ? 'person recovers' : 'people recover'} overnight.` : ''} On the hillside a spring bubbles up that was not there before.`), s.id, 1, { power: 'heilung' });
    myth(st, s, 'heilung', true);
    return { msg: L('Heilung fließt.', 'Healing flows.') };
  },
  seuche(st, t) {
    const r = rng(st), rt = st._rt;
    const s = rt.sById.get(t.sid) || nearestSet(st, t.x, t.y);
    if (!s) return { ok: false, msg: L('Niemand da.', 'Nobody there.') };
    const n = outbreak(st, s, knows(st, 'impfung', s) ? 0.12 : 0.35, [8, 14]);
    for (const o of alive(st)) if (o !== s && (s.ally[o.id] || (s.rel[o.id] ?? 0) > 40) && r.chance(0.5)) outbreak(st, o, 0.08);
    const Is = isleOf(st, s);
    if (D.TECH.medizin.req.every(q => knows(st, q, s)) && !knows(st, 'medizin', s)) { Is.research.cur = 'medizin'; Is.research.pts += D.TECH.medizin.cost * 0.2; }
    const line = interpret(st, s, 'harm', 'seuche');
    chron(st, 'gott', L(`Ein Fieber kriecht durch ${s.name}. ${n} Menschen erkranken.`, `A fever creeps through ${s.name}. ${n} ${n === 1 ? 'person falls' : 'people fall'} ill.`), s.id, 1, { power: 'seuche' });
    chron(st, 'deutung', line, s.id, 0);
    myth(st, s, 'seuche', false);
    return { msg: L('Die Seuche beginnt.', 'The plague begins.') };
  },
};

export function cast(st, id, t = {}) {
  st._rt.fire = 1; // Blitz, Meteor, Vulkan können Feuer legen: natureStep sucht danach wieder
  const P = D.POWER[id];
  if (!P) return { ok: false, msg: L('Unbekannte Kraft.', 'Unknown power.') };
  if (st.mana < P.cost) return { ok: false, msg: L('Nicht genug göttliche Kraft.', 'Not enough divine power.') };
  if (!alive(st).length && id !== 'fremde') return { ok: false, msg: L('Niemand mehr da, der es sehen könnte.', 'Nobody left who could see it.') };
  const res = H[id](st, t, P) || {};
  if (res.ok === false) return res;
  st.mana -= P.cost;
  st.lastGod = st.day;
  st.counts.powers++;
  st.godLog.push({ d: st.day, id, x: t.x, y: t.y });
  if (st.godLog.length > 300) st.godLog.shift();
  fx(st, { type: 'power', id, x: t.x, y: t.y, ...(res.fx || {}) });
  return { ok: true, msg: res.msg };
}

// Wenn niemand mehr lebt, stranden irgendwann neue Menschen von selbst
export function newcomers(st) {
  const r = rng(st), rt = st._rt, T = st.tiles;
  for (let k = 0; k < 400; k++) {
    const x = r.int(4, NX - 5), y = r.int(4, NY - 5), i = idx(x, y);
    if (rt.coast[i] && rt.isleOf[i] && T.h[i] <= 1 && !rt.bldAt[i]) { H.fremde(st, { x, y }); return true; }
  }
  return false;
}

// Heimkehr von Seefahrern, die einem Traum vom Meer gefolgt sind
export function expeditionsStep(st) {
  const r = rng(st), rt = st._rt;
  const list = st.flags.exp || [];
  const due = list.filter(e => st.day >= e.d);
  if (!due.length) return;
  st.flags.exp = list.filter(e => st.day < e.d);
  for (const e of due) {
    const s = rt.sById.get(e.s);
    const crew = e.ids.map(id => rt.pById.get(id)).filter(Boolean);
    if (!s || !s.alive || r.chance(0.3)) {
      for (const p of crew) killPerson(st, p, 'See');
      chron(st, 'fremde', L(`Von ${e.lead} und den Gefährten hört man nie wieder. Am Strand von ${s ? s.name : 'der Insel'} brennt jede Nacht ein Feuer für sie.`, `Nobody ever hears from ${e.lead} and the companions again. On the beach of ${s ? s.name : 'the island'} a fire burns every night for them.`), s ? s.id : -1, 1);
      continue;
    }
    for (const p of crew) { p.s = s.id; p.away = false; p.fame += 3; bio(p, st.day, L('kehrt von der großen Fahrt zurück', 'returns from the great voyage')); }
    const n = r.int(2, 5);
    for (let k = 0; k < n; k++) { const q = makePerson(st, s, { b: st.day - r.int(16, 30) * D.DAYS_PER_YEAR, lang: 4 }); q.foreign = true; bio(q, st.day, L(`kommt mit ${e.lead} von fernen Inseln`, `comes from distant islands with ${e.lead}`)); }
    const Is = isleOf(st, s);
    const avail = D.TECHS.filter(tt => !knows(st, tt.id, s) && tt.req.every(q => knows(st, q, s)));
    let gift = '';
    if (avail.length && r.chance(0.6)) { const tt = r.pick(avail); learn(st, tt.id, crew[0], Is); gift = L(` Sie bringen ${tt.name} mit.`, ` They bring ${tt.name.toLowerCase()} with them.`); }
    // Die Fahrt hat eine fremde Insel gefunden
    const J = st.earth ? null : st.isles.filter(o => o.id !== Is.id && !Is.seen[o.id]).sort((a, b) => Math.hypot(a.cx - s.cx, a.cy - s.cy) - Math.hypot(b.cx - s.cx, b.cy - s.cy))[0];
    if (J) {
      Is.seen[J.id] = st.day;
      const natives = st.settlements.filter(o => o.alive && o.isle === J.id);
      if (natives.length) contact(st, Is, J, s, natives[0]);
      else gift += L(` Sie erzählen von einer leeren Insel: ${J.name}.`, ` They tell of an empty island: ${J.name}.`);
    }
    s.stock.gold += 30; s.stock.goods += 15;
    chron(st, 'fremde', L(`${e.lead} kehrt zurück! Die Fahrt führte zu fernen Inseln. Mit an Bord: ${n} Fremde, Gewürze und Geschichten.${gift}`, `${e.lead} returns! The voyage led to distant islands. On board: ${n} strangers, spices and stories.${gift}`), s.id, 2);
  }
  indexMembers(st);
}
