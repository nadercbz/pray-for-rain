// Charakter einer Welt: jede neue Welt bekommt aus ihrem Seed ein eigenes Temperament.
// Mal streitlustig, mal fromm, mal ruhelos. Das verschiebt Kriege, Glauben, Gründungen,
// Abspaltungen, Kinder und wilde Tiere, damit kein Spiel wie das andere verläuft.
import { Rng } from './rng.js';
import { L } from '../i18n.js';

export function worldCharacter(seed) {
  const r = new Rng(Math.imul((seed ^ 0x51ed27) >>> 0, 2246822519) >>> 0);
  const v = (lo, hi) => Math.round((lo + (hi - lo) * r.next()) * 100) / 100;
  return {
    aggr: v(0.55, 1.6),    // Streitlust: Beziehungen, Kriegserklärungen
    piety: v(0.7, 1.35),   // Frömmigkeit: Glaube
    wander: v(0.6, 1.7),   // Wanderlust: Neugründungen
    schism: v(0.45, 1.8),  // Zwietracht: Abspaltungen
    fert: v(0.9, 1.14),    // Kinderreichtum
    wild: v(0.5, 1.8),     // Wildnis: Wölfe, Angriffe
  };
}

// Ein Satz für die Chronik am ersten Tag, aus dem stärksten Zug der Welt
export function characterLine(c) {
  const traits = [
    ['aggr', c.aggr - 1, L('Auf diesen Inseln ist der Wind rau, und die Herzen sind es auch.', 'The wind is harsh on these islands, and so are the hearts.')],
    ['aggr', 1 - c.aggr, L('Es ist eine sanfte Welt. Die Menschen hier vergeben schneller als anderswo.', 'It is a gentle world. People here forgive faster than elsewhere.')],
    ['piety', (c.piety - 1) * 1.6, L('Diese Menschen blicken oft zum Himmel, als suchten sie dort jemanden.', 'These people often look up at the sky, as if searching for someone there.')],
    ['wander', (c.wander - 1) * 0.9, L('Eine Unruhe liegt in ihren Füßen. Kein Tal wird sie lange halten.', 'There is a restlessness in their feet. No valley will hold them for long.')],
    ['schism', (c.schism - 1) * 0.8, L('Sie streiten gern über das Richtige. Einigkeit wird hier selten sein.', 'They love to argue about what is right. Unity will be rare here.')],
    ['wild', (c.wild - 1) * 0.8, L('In den Wäldern heulen nachts die Wölfe. Die Wildnis ist hier noch stark.', 'At night the wolves howl in the forests. The wild is still strong here.')],
  ].sort((a, b) => b[1] - a[1]);
  return traits[0][2];
}
