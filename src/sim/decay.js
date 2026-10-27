// Verlassene Orte (seit 24.10.2026, Naders Auftrag: manche Orte werden verlassen, Ruinen bleiben, keine Straßen ins Leere).
// Stirbt ein Ort aus (politicsStep in society.js), bleibt an seinem Platz eine Ruinenstätte (st.finds, Typ ruine, im Bild
// aus render/sites.js), die Häuser stehen leer und verfallen langsam (core.js), ihre Trümmer liegen rund zehn Jahre.
// Die Gassen im Ort wachsen sofort zu (das Bild zeichnet Ortsstraßen nur für bewohnte Orte), halb gebaute Landstraßen
// dorthin werden aufgegeben, fertige führen noch ROAD_KEEP Jahre zu den Ruinen und verwittern dann.
import * as D from './data.js';
import { NX, NY, idx } from './world.js';
import { addSite } from './sites.js';
import { roadFloor } from './roads.js';
import { L } from '../i18n.js';

const BUILT = 4, MANUAL = 16, TRACK = 32;
export const ROAD_KEEP = 40;

export function abandonTown(st, s) {
  const rt = st._rt, S = st.tiles.st;
  s.ruined = st.day;
  addSite(st, 'ruine', s.cx, s.cy, { found: st.day, done: true, town: s.id, name: L(`die Ruinen von ${s.name}`, `the ruins of ${s.name}`) });
  // Gassen und Plätze des Ortes (was keinem bewohnten Ort näher liegt)
  if (S && s.plan) {
    const e = Math.ceil(s.plan.ext + 2);
    const others = st.settlements.filter(o => o !== s && o.alive && Math.abs(o.cx - s.cx) < 60 && Math.abs(o.cy - s.cy) < 60);
    for (let y = Math.max(1, s.cy - e); y <= Math.min(NY - 2, s.cy + e); y++) for (let x = Math.max(1, s.cx - e); x <= Math.min(NX - 2, s.cx + e); x++) {
      const i = idx(x, y);
      if (!(S[i] & BUILT) || (S[i] & MANUAL)) continue; // von Hand gemalt (Baukasten) bleibt
      const d = Math.hypot(x - s.cx, y - s.cy);
      if (others.some(o => Math.hypot(x - o.cx, y - o.cy) <= d)) continue;
      S[i] = (S[i] & TRACK) ? 0 : S[i] & ~BUILT;
    }
    rt.dirtyT = true;
  }
  pruneDeadLinks(st); // addSite kann eine alte Ruinenstätte verdrängt haben: deren Straßen gehen gleich mit
  // Landstraßen: halb gebaute werden aufgegeben, fertige bleiben noch eine Weile
  let changed = false;
  st.links = (st.links || []).filter(k => {
    if (k.a !== s.id && k.b !== s.id) return true;
    if (!k.path || k.built < k.path.length) { changed = true; return false; }
    k.dead = st.day;
    return true;
  });
  if (changed) roadFloor(st);
}

// Einmal im Jahr: Straßen zu Ruinen verwittern nach ROAD_KEEP Jahren, eine Ruinenstätte weicht einem neuen Ort darüber
export function decayStep(st) { pruneDeadLinks(st); }

function pruneDeadLinks(st) {
  const Y = D.DAYS_PER_YEAR;
  const n = (st.links || []).length;
  const ruin = new Set((st.finds || []).filter(o => o.t === 'ruine' && o.town).map(o => o.town));
  // tot und ohne Ruinen: verdrängt, weggeräumt, oder aus einem alten Spielstand (vor decay.js verlassen, nie Ruinen)
  const gone = id => { const s = st._rt.sById.get(id); return !!(s && !s.alive && (s.ruined || !s.endedBy) && !ruin.has(id)); };
  // nach ROAD_KEEP Jahren, oder früher, wenn am toten Ende keine Ruinen mehr stehen
  st.links = (st.links || []).filter(k => !(k.path && (gone(k.a) || gone(k.b) || (k.dead && st.day - k.dead > ROAD_KEEP * Y))));
  if (st.links.length !== n) roadFloor(st);
}

// Neuer Ort auf alten Ruinen: die Siedler räumen die Steine weg (die Ruinenstätte verschwindet)
export function clearRuinsNear(st, x, y, r = 6) {
  if (!st.finds) return;
  st.finds = st.finds.filter(o => !(o.t === 'ruine' && o.town && Math.hypot(o.x - x, o.y - y) < r));
}
