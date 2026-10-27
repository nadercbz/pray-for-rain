// Erde heute, nahtlos (seit 27.10.2026, Naders Wunsch: rauszoomen ohne Kartenwechsel, alles zusammenhängend 1 zu 1).
// Geometrie der Erdkugel: Länge, Breite und Höhe zu ECEF (erdfeste Koordinaten), lokale Tangentialebene (Ost, Oben,
// Süd), Kacheln im Web Mercator Raster (Stufe z, Spalte x, Zeile y) wie bei OpenFreeMap und den Höhenkacheln.
// Einheit wie im Spiel: 1 = 10 m. Die Kugel hat den mittleren Erdradius (Abweichung zum Ellipsoid unter 0,3 %).
export const UNIT = 10;
export const R = 6371008.8 / UNIT;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

export function ecef(lon, lat, h = 0, out = [0, 0, 0]) {
  const l = lon * D2R, p = lat * D2R, r = R + h, cp = Math.cos(p);
  out[0] = r * cp * Math.cos(l); out[1] = r * cp * Math.sin(l); out[2] = r * Math.sin(p);
  return out;
}
export function lonLatOf(x, y, z) {
  const r = Math.hypot(x, y, z);
  return [Math.atan2(y, x) * R2D, Math.asin(z / r) * R2D, r - R];
}
// Achsen der lokalen Ebene an einem Punkt (in ECEF): Ost, Oben, Süd (wie die Stadtansicht: x Ost, y oben, z Süd)
export function enu(lon, lat) {
  const l = lon * D2R, p = lat * D2R, sl = Math.sin(l), cl = Math.cos(l), sp = Math.sin(p), cp = Math.cos(p);
  return { E: [-sl, cl, 0], U: [cp * cl, cp * sl, sp], S: [sp * cl, sp * sl, -cp] };
}
// lokaler Punkt (x Ost, y oben, z Süd) eines Rahmens zu ECEF und zurück
export function toLocal(F, p, out = [0, 0, 0]) {
  const dx = p[0] - F.o[0], dy = p[1] - F.o[1], dz = p[2] - F.o[2];
  out[0] = dx * F.E[0] + dy * F.E[1] + dz * F.E[2];
  out[1] = dx * F.U[0] + dy * F.U[1] + dz * F.U[2];
  out[2] = dx * F.S[0] + dy * F.S[1] + dz * F.S[2];
  return out;
}
export function toEcef(F, q, out = [0, 0, 0]) {
  for (let k = 0; k < 3; k++) out[k] = F.o[k] + q[0] * F.E[k] + q[1] * F.U[k] + q[2] * F.S[k];
  return out;
}
// Rahmen an Länge und Breite (Ursprung auf Meereshöhe)
export function frame(lon, lat) { return { lon, lat, o: ecef(lon, lat, 0), ...enu(lon, lat) }; }

// ---------- Web Mercator Kacheln ----------
export const mercX = lon => (lon + 180) / 360;
export function mercY(lat) { const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * D2R); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); }
export const lonOfX = X => X * 360 - 180;
export const latOfY = Y => Math.atan(Math.sinh(Math.PI * (1 - 2 * Y))) * R2D;
export function tileCenter(z, x, y) { const n = 2 ** z; return [lonOfX((x + 0.5) / n), latOfY((y + 0.5) / n)]; }
// Kantenlänge einer Kachel in Einheiten an ihrer Mitte
export function tileSize(z, y) { const n = 2 ** z, lat = latOfY((y + 0.5) / n); return 2 * Math.PI * R * Math.cos(lat * D2R) / n; }
export function tileAt(z, lon, lat) { const n = 2 ** z; return [Math.min(n - 1, Math.max(0, Math.floor(mercX(lon) * n))), Math.min(n - 1, Math.max(0, Math.floor(mercY(lat) * n)))]; }
export const MAXLAT = 85.0511;
