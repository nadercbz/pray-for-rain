// Straßenplan je Ort (seit 18.10.2026): vom Dorfplatz laufen vier oder fünf leicht geschwungene Hauptstraßen nach außen,
// alle vier Felder schließt eine Ringstraße sie zusammen. Dazwischen liegen die Häuserblöcke. Der Plan hängt nur an
// Ort, Lage und Gelände (keine Zufallszahlen der Simulation, kein Speicher nötig) und wächst mit dem Ort mit.
// findSite (core.js) baut nicht auf Plan-Felder, solange es anderswo Platz gibt, und mag Felder an einer Straße.
// render/streets.js zeichnet daraus und aus den Wegen von jeder Haustür die echten Straßen.
import { idx, inb, NX, NY } from './world.js';

const hh = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export function streetPlan(st, s) {
  const rt = st._rt;
  rt.plans = rt.plans || new Map();
  // Seit 20.10.2026 hat jeder Ort einen echten Plan im Boden (cityplan.js, T.st): geplante und gebaute Straßen ohne Platz
  if (s.plan && st.tiles.st) {
    const P0 = rt.plans.get(s.id);
    if (P0 && P0.bv === s.plan.bv) return P0.set;
    const S = st.tiles.st, e = Math.ceil(s.plan.ext + 1), set = new Set();
    for (let y = Math.max(0, s.cy - e); y <= Math.min(NY - 1, s.cy + e); y++) for (let x = Math.max(0, s.cx - e); x <= Math.min(NX - 1, s.cx + e); x++) {
      const i = idx(x, y);
      if (S[i] && !(S[i] & 8)) set.add(i);
    }
    rt.plans.set(s.id, { bv: s.plan.bv, set });
    return set;
  }
  const want = Math.ceil(Math.max(9, (s.R || 4) + 6));
  const P = rt.plans.get(s.id);
  if (P && P.r >= want && P.cx === s.cx && P.cy === s.cy) return P.set;
  const T = st.tiles, set = new Set();
  const ok = (x, y) => inb(x, y) && T.h[idx(x, y)] >= 0 && T.h[idx(x, y)] <= 3 && !T.river[idx(x, y)];
  const mark = (x, y) => { if (ok(x, y)) set.add(idx(x, y)); };
  // Linie mit Vierer-Nachbarschaft (keine Diagonalsprünge, damit die Straße durchgehend ist)
  const line4 = (x0, y0, x1, y1) => {
    let x = x0, y = y0;
    mark(x, y);
    while (x !== x1 || y !== y1) {
      const dx = x1 - x, dy = y1 - y;
      if (Math.abs(dx) >= Math.abs(dy)) x += Math.sign(dx); else y += Math.sign(dy);
      mark(x, y);
    }
  };
  const n = 4 + (s.id % 2);
  const a0 = hh(s.id, 7) * Math.PI * 2;
  for (let k = 0; k < n; k++) {
    const base = a0 + k * Math.PI * 2 / n + (hh(s.id, k + 1) - 0.5) * 0.5;
    let px = s.cx, py = s.cy, started = false;
    for (let d = 1.5; d <= want; d += 0.8) {
      const a = base + Math.sin(d * 0.22 + k * 1.7 + s.id) * 0.2;
      const x = Math.round(s.cx + Math.cos(a) * d), y = Math.round(s.cy + Math.sin(a) * d);
      if (!ok(x, y)) break;
      if (started) line4(px, py, x, y); else { mark(x, y); started = true; }
      px = x; py = y;
    }
  }
  for (let rr = 3.6; rr <= want - 0.5; rr += 4) {
    const steps = Math.ceil(rr * 2 * Math.PI * 1.4);
    let px = null, py = null;
    for (let q = 0; q <= steps; q++) {
      const a = q / steps * Math.PI * 2;
      const rad = rr + Math.sin(a * 3 + s.id * 0.7) * 0.5;
      const x = Math.round(s.cx + Math.cos(a) * rad), y = Math.round(s.cy + Math.sin(a) * rad);
      if (!ok(x, y)) { px = null; continue; }
      if (px !== null) line4(px, py, x, y); else mark(x, y);
      px = x; py = y;
    }
  }
  set.delete(idx(s.cx, s.cy));
  rt.plans.set(s.id, { r: want, cx: s.cx, cy: s.cy, set });
  return set;
}

// Liegt ein Feld an einer Planstraße (Vierer-Nachbar)?
export function onStreet(set, x, y) {
  return set.has(idx(x + 1, y)) || set.has(idx(x - 1, y)) || set.has(idx(x, y + 1)) || set.has(idx(x, y - 1));
}
