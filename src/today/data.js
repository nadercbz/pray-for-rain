// Erde heute (seit 26.10.2026, PLAN_ERDE_HEUTE.md): Laden der Weltdaten aus assets/today/ (tools/today/build_today.py).
// Länder (countries.json), Länder je Feld (ctry_2048.bin), alle Orte ab 1000 Einwohnern (cities.json + cities.bin),
// Namen (names.json), Sehenswürdigkeiten (landmarks.json), Bevölkerungsgruppen je Land (groups.json, seit 27.10.2026).
// Browser per fetch und DecompressionStream, Node per fs und zlib.
const isNode = typeof window === 'undefined' && typeof process !== 'undefined' && !!(process.versions && process.versions.node);
const TYPES = { int8: Int8Array, uint8: Uint8Array, int16: Int16Array, uint16: Uint16Array, uint32: Uint32Array, int32: Int32Array, float32: Float32Array };

export let TODAY = null;
let loading = null;

export function loadToday() {
  if (TODAY) return Promise.resolve(TODAY);
  if (!loading) loading = (isNode ? loadNode() : loadBrowser()).then(prepare).then(t => (TODAY = t)).catch(e => { loading = null; throw e; });
  return loading;
}

async function inflateBrowser(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const typed = (raw, t) => t === 'utf8' ? new TextDecoder().decode(raw).split('\n') : new TYPES[t](raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));

async function loadBrowser() {
  const base = new URL('../../assets/today/', import.meta.url);
  const get = (f, kind) => fetch(new URL(f, base)).then(r => { if (!r.ok) throw new Error(f + ' ' + r.status); return kind === 'bin' ? r.arrayBuffer() : r.json(); });
  const [countries, cmeta, cbin, ctry, names, landmarks, groups] = await Promise.all([
    get('countries.json'), get('cities.json'), get('cities.bin', 'bin'), get('ctry_2048.bin', 'bin'), get('names.json').catch(() => ({})), get('landmarks.json').catch(() => []), get('groups.json').catch(() => null),
  ]);
  const cities = { meta: cmeta };
  await Promise.all(Object.entries(cmeta.layers).map(async ([k, [o, n, t]]) => { cities[k] = typed(await inflateBrowser(new Uint8Array(cbin, o, n)), t); }));
  const raw = await inflateBrowser(new Uint8Array(ctry));
  return { countries, cities, ctry: typed(raw, 'uint16'), names, landmarks, groups };
}

async function loadNode() {
  const fs = await import('node:fs'), zlib = await import('node:zlib'), { fileURLToPath } = await import('node:url');
  const dir = fileURLToPath(new URL('../../assets/today/', import.meta.url));
  const js = f => { try { return JSON.parse(fs.readFileSync(dir + f, 'utf8')); } catch { return null; } };
  const countries = js('countries.json'), cmeta = js('cities.json');
  const cbin = fs.readFileSync(dir + 'cities.bin');
  const cities = { meta: cmeta };
  for (const [k, [o, n, t]] of Object.entries(cmeta.layers)) cities[k] = typed(zlib.inflateSync(cbin.subarray(o, o + n)), t);
  const ctry = typed(zlib.inflateSync(fs.readFileSync(dir + 'ctry_2048.bin')), 'uint16');
  return { countries, cities, ctry, names: js('names.json') || {}, landmarks: js('landmarks.json') || [], groups: js('groups.json') };
}

// Nachschlagen: Länder nach id und iso3, Orte nach Feld (für Klicks auf dem Globus) und nach Name (Suche)
function prepare(t) {
  const list = t.countries.countries || t.countries;
  t.list = list;
  t.byId = new Map(list.map(c => [c.id, c]));
  t.byIso = new Map(list.map(c => [c.iso3, c]));
  t.rels = t.countries.relations || [];
  t.conflicts = t.countries.conflicts || [];
  if (!Array.isArray(t.landmarks)) t.landmarks = t.landmarks.landmarks || [];
  // Bevölkerungsgruppen je Land (Alter, Herkunft, Sprachen, Religionen, Migration, Armut) als C.grp
  const G = (t.groups && t.groups.countries) || {};
  for (const c of list) c.grp = G[c.iso3] || null;
  const C = t.cities, n = C.meta.count || C.pop.length;
  C.n = n;
  // Orte je grobem Gitter (8 mal 8 Felder) für die Suche nach Nähe
  const grid = new Map();
  for (let i = 0; i < n; i++) {
    const k = (C.ty[i] >> 3) * 256 + (C.tx[i] >> 3);
    let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(i);
  }
  C.grid = grid;
  // Mittelpunkt und Felderzahl je Land aus dem Raster (für die Ländernamen auf dem Globus)
  const sx = new Float64Array(65536), sy = new Float64Array(65536), sn = new Uint32Array(65536), W = 2048;
  for (let i = 0; i < t.ctry.length; i++) { const k = t.ctry[i]; if (k) { sx[k] += i % W; sy[k] += (i / W) | 0; sn[k]++; } }
  for (const c of list) if (sn[c.id]) { c.cx = Math.round(sx[c.id] / sn[c.id]); c.cy = Math.round(sy[c.id] / sn[c.id]); c.tiles = c.tiles || sn[c.id]; }
  // Hauptstädte je Land
  t.capitalOf = new Map();
  for (let i = 0; i < n; i++) if (C.flag[i] & 1) { const c = C.ctry[i]; if (!t.capitalOf.has(c)) t.capitalOf.set(c, i); }
  return t;
}

export const cityName = (i, lang) => { const C = TODAY.cities; return (lang === 'de' && C.de && C.de[i]) || C.en[i] || ''; };
export const countryName = (c, lang) => c ? (lang === 'de' ? c.de : c.en) || c.en : '';

// Orte in der Nähe eines Feldes, nach Einwohnern absteigend
export function citiesNear(x, y, r = 6, min = 0) {
  const C = TODAY.cities, out = [];
  for (let gy = (y - r) >> 3; gy <= (y + r) >> 3; gy++) for (let gx = (x - r) >> 3; gx <= (x + r) >> 3; gx++) {
    const a = C.grid.get(gy * 256 + ((gx + 256) % 256));
    if (!a) continue;
    for (const i of a) if (C.pop[i] >= min && Math.hypot(C.tx[i] - x, C.ty[i] - y) <= r) out.push(i);
  }
  return out.sort((a, b) => C.pop[b] - C.pop[a]);
}

// Suche nach Namen (Anfang zählt mehr), die größten zuerst
export function searchCities(q, max = 12) {
  const C = TODAY.cities, s = norm(q), out = [];
  if (!s) return out;
  for (let i = 0; i < C.n && out.length < 400; i++) {
    const a = norm(C.en[i]), b = C.de && C.de[i] ? norm(C.de[i]) : '';
    if (a.startsWith(s) || b.startsWith(s)) out.push([i, 0]);
    else if (s.length > 2 && (a.includes(s) || b.includes(s))) out.push([i, 1]);
  }
  out.sort((x, y) => x[1] - y[1] || C.pop[y[0]] - C.pop[x[0]]);
  return out.slice(0, max).map(o => o[0]);
}
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

// Stil der Stadtansicht nach Land (Farben der Häuser, Dächer, Boden)
const JP = new Set(['JPN', 'KOR', 'TWN', 'CHN', 'HKG', 'MAC', 'PRK', 'MNG', 'SGP']);
const US = new Set(['USA', 'CAN', 'AUS', 'NZL']);
const WARM = new Set(['MAR', 'DZA', 'TUN', 'LBY', 'EGY', 'SAU', 'ARE', 'QAT', 'BHR', 'KWT', 'OMN', 'YEM', 'IRQ', 'IRN', 'SYR', 'JOR', 'LBN', 'ISR', 'PSE', 'TUR', 'AFG', 'PAK', 'IND', 'MRT', 'MLI', 'NER', 'TCD', 'SDN', 'ESP', 'PRT', 'GRC', 'CYP', 'MLT', 'ITA']);
export function cityStyle(iso3, lat) {
  if (JP.has(iso3)) return 'jp';
  if (US.has(iso3)) return 'us';
  if (WARM.has(iso3)) return iso3 === 'ITA' && lat > 44 ? 'eu' : 'warm';
  if (Math.abs(lat) < 30) return 'trop';
  return 'eu';
}
// Linksverkehr
export const LEFT_DRIVE = new Set(['GBR', 'IRL', 'JPN', 'IND', 'PAK', 'BGD', 'LKA', 'NPL', 'THA', 'MYS', 'SGP', 'IDN', 'AUS', 'NZL', 'ZAF', 'KEN', 'TZA', 'UGA', 'ZMB', 'ZWE', 'MOZ', 'BWA', 'NAM', 'MWI', 'HKG', 'MAC', 'CYP', 'MLT', 'JAM', 'TTO', 'BHS', 'BRB', 'GUY', 'SUR', 'FJI', 'PNG', 'BRN', 'BTN', 'MUS', 'SYC', 'LSO', 'SWZ']);
