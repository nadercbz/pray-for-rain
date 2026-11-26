// Prüfsumme für den Mehrspieler (src/net/coop.js): billig genug für jeden Tag, empfindlich genug für jede Abweichung.
// Der Zufallsgenerator ist der beste Zeuge: läuft irgendwo eine Rechnung anders, zieht sie andere Zahlen.
// Reines JS, läuft auch in Node (tools/cooptest.mjs).
export function checksum(st) {
  const rt = st._rt;
  let h = (rt && rt.rng ? rt.rng.s : st.rng) >>> 0;
  const mix = v => { h = Math.imul(h ^ (v | 0), 2654435761) >>> 0; h ^= h >>> 15; };
  mix(st.day);
  mix(st.people.length);
  mix(st.buildings.length);
  mix(st.settlements.length);
  mix(Math.round((st.mana || 0) * 16));
  if (st.counts) { mix(st.counts.births || 0); mix(st.counts.deaths || 0); }
  return h >>> 0;
}
