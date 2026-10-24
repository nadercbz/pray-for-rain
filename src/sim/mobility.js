// Sozialer Aufstieg über Generationen (seit 20.10.2026, Naders Wunsch: Menschen aus anderen Gesellschaftsschichten, für
// Experimente). Die Schicht p.cls kommt weiter aus dem Vermögen (money.js classes). Neu:
// - p.oc: Herkunftsschicht, die Schicht der Familie bei der Geburt (Mittel der Eltern, peoples.js personHook).
// - s.rig: Ständeordnung eines Ortes, 0 offen bis 1 streng, aus Staatsform, Kultur, Epoche und Gesetzen.
// - Zugang zu angesehenen Berufen (Gelehrte, Heiler, Händler, Priester, Künstler) hängt in strengen Orten an der Herkunft,
//   Bildung (p.edu) öffnet die Tür. Kinder übernehmen dort gern den Beruf der Eltern (jobGate in core.js jobs).
// - Heiraten bleiben in strengen Orten eher in der eigenen Schicht (social.js compat, arranged).
// - Wer gebildet ist und trotzdem unten bleibt, murrt: Unruhe in strengen Orten (Bildungsproletariat).
// - Jährlich je Ort: Aufsteiger, Absteiger, Gebliebene unter den Erwachsenen mit bekannter Herkunft (s.mob), Labor-Zeitreihe.
import * as D from './data.js';
import { clamp } from './rng.js';
import { chron, rng, members, ageOf, bio } from './util.js';
import { L } from '../i18n.js';

// Angesehene Berufe: hier zählt in strengen Orten die Herkunft
export const PRESTIGE = new Set(['gelehrter', 'heiler', 'haendler', 'priester', 'kuenstler']);
const GOV_RIG = { haeuptling: 0.5, koenigtum: 0.68, theokratie: 0.62, diktatur: 0.55, rat: 0.45, republik: 0.32, volksrat: 0.28, demokratie: 0.18, technokratie: 0.25 };
export const RIG_LAW = { staende: 0.3, schulpflicht: -0.14, erbsteuer: -0.1, freiedenker: -0.05, gemeinschaft: -0.04 };

export function rigidity(st, s) {
  const C = s.cult || {};
  let r = GOV_RIG[s.gov && s.gov.type] ?? 0.45;
  r += ((C.tradition ?? 0.5) - 0.5) * 0.4 - ((C.freiheit ?? 0.5) - 0.5) * 0.4;
  for (const l of s.laws || []) r += RIG_LAW[l] || 0;
  if ((s.era || 0) >= 6) r -= 0.08;
  return clamp(r, 0.12, 0.92); // keine Gesellschaft ist ganz offen oder ganz geschlossen
}

// Wie offen steht ein angesehener Beruf diesem Menschen offen (0 gar nicht, 1 ganz)
export function access(p) {
  const oc = p.oc ?? p.cls ?? 1;
  return clamp(oc / 3 + (p.edu || 0) * 0.65, 0, 1);
}

// Abzug in der Berufswahl (core.js jobs): strenge Orte halten Angesehenes den Oberen vor, Kinder folgen den Eltern
export function jobGate(st, s, p, job) {
  const rig = s.rig ?? 0.45;
  let g = 0;
  if (PRESTIGE.has(job)) g += rig * (1 - access(p)) * 2.2;
  if (rig > 0.4) {
    const rt = st._rt, fa = p.fa && rt.pById.get(p.fa), mo = p.mo && rt.pById.get(p.mo);
    if ((fa && fa.job === job) || (mo && mo.job === job)) g -= (rig - 0.4) * 1.2; // der Beruf der Eltern liegt nahe
  }
  return g;
}

// Herkunftsschicht bei der Geburt (peoples.js personHook ruft das)
// (Mittel beider Eltern, aufgerundet: das Haus, in dem man aufwächst; das höhere Elternteil allein überschätzt die Herkunft)
export function originClass(mo, fa) {
  if (!mo && !fa) return undefined;
  if (!mo || !fa) return (mo || fa).cls ?? 1;
  return Math.ceil(((mo.cls ?? 1) + (fa.cls ?? 1)) / 2);
}

// Jährlich: Ständeordnung, Messung der Mobilität, Unmut der Blockierten, seltene Geschichten von Aufstieg und Fall
export function mobilityYear(st) {
  const r = rng(st);
  let up = 0, down = 0, n = 0;
  for (const s of st.settlements) {
    if (!s.alive) continue;
    s.rig = Math.round(rigidity(st, s) * 100) / 100;
    const M = members(st, s), ad = M.adults.concat(M.old);
    let u = 0, d = 0, k = 0, blocked = 0;
    for (const p of ad) {
      if (p.oc == null || ageOf(st, p) < 35) continue; // erst Gestandene: junge Erwachsene haben noch nichts
      k++;
      const c = p.cls ?? 1;
      if (c > p.oc) u++; else if (c < p.oc) d++;
      if ((p.edu || 0) >= 0.5 && c <= 1 && p.oc <= 1 && !PRESTIGE.has(p.job)) blocked++;
    }
    s.mob = { up: u, down: d, n: k, blocked };
    up += u; down += d; n += k;
    if (!ad.length) continue;
    // Gebildete ohne Aussicht: in strengen Orten wächst der Unmut
    const share = blocked / ad.length;
    if (s.rig > 0.5 && share > 0.04) {
      s.unrest = clamp(s.unrest + Math.min(0.06, share * 0.35 * (s.rig - 0.3)), 0, 1);
      if (share > 0.1 && !(s.mobMsg > st.day - D.DAYS_PER_YEAR * 12) && r.chance(0.5)) {
        s.mobMsg = st.day;
        chron(st, 'politik', r.pick(L([
          `In ${s.name} haben ${blocked} Kinder einfacher Leute lesen gelernt, doch Gelehrte, Händler und Priester werden nur die Söhne und Töchter der Oberen. Die Gebildeten murren.`,
          `In den Gassen von ${s.name} spotten junge Leute über die alte Ordnung: Wer unten geboren ist, bleibt unten, so klug er auch ist.`,
        ], [
          `In ${s.name}, ${blocked} children of common folk have learned to read, yet only the sons and daughters of the upper ranks become scholars, merchants and priests. The educated grumble.`,
          `In the lanes of ${s.name} young people mock the old order: whoever is born low stays low, however clever.`,
        ])), s.id, 1);
      }
    }
    // Geschichten: vom Kind armer Leute zu Reichtum, oder ein Abstieg aus gutem Haus (selten, nur in der Chronik)
    if (r.chance(0.08)) {
      const riser = ad.find(p => p.oc === 0 && (p.cls ?? 1) >= 3);
      if (riser && !riser.rose) {
        riser.rose = 1; riser.fame += 1;
        bio(riser, st.day, L('ist aus armem Haus reich geworden', 'rose from a poor home to wealth'));
        chron(st, 'geld', L(`${riser.n} aus ${s.name} wurde arm geboren und ist heute einer der Reichsten des Ortes.${s.rig > 0.6 ? ' Die alten Familien rümpfen die Nase.' : ' Man erzählt es den Kindern als Beispiel.'}`,
          `${riser.n} of ${s.name} was born poor and is now among the richest in town.${s.rig > 0.6 ? ' The old families turn up their noses.' : ' People tell the children as an example.'}`), s.id, 0);
      }
    }
  }
  st.mob = { up, down, n };
}

// Kurztext für die Oberfläche
export const rigName = v => (v >= 0.7 ? L('strenge Ständeordnung', 'rigid estates') : v >= 0.5 ? L('feste Stände', 'fixed ranks') : v >= 0.3 ? L('durchlässig', 'permeable') : L('offen', 'open'));
export { ageOf };
