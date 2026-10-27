// Vektorkacheln (Mapbox Vector Tile, Protobuf) lesen, ohne Zusatzbibliothek. Quelle im Spiel: OpenFreeMap
// (OpenMapTiles Schema, kostenlos, ohne Schlüssel). Liefert je Ebene die Objekte mit Art (1 Punkt, 2 Linie,
// 3 Fläche), Eigenschaften und Ringen in Kachelkoordinaten (0 bis extent, meist 4096). Reines JS, läuft auch in Node.
export function decodeTile(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const layers = {};
  readMsg(b, 0, b.length, (tag, type, p, end) => {
    if (tag === 3 && type === 2) { const L = readLayer(b, p, end); layers[L.name] = L; }
  });
  return layers;
}

function varint(b, p) {
  let v = 0, s = 0, c;
  do { c = b[p.i++]; v += (c & 0x7f) * 2 ** s; s += 7; } while (c & 0x80);
  return v;
}
// Felder einer Nachricht durchgehen: cb(tag, wiretype, start, end) für Längenfelder, sonst Wert in start
function readMsg(b, start, end, cb) {
  const p = { i: start };
  while (p.i < end) {
    const key = varint(b, p), tag = Math.floor(key / 8), type = key & 7;
    if (type === 2) { const len = varint(b, p), s = p.i; p.i += len; cb(tag, 2, s, s + len); }
    else if (type === 0) { const v = varint(b, p); cb(tag, 0, v, 0); }
    else if (type === 1) { cb(tag, 1, p.i, p.i + 8); p.i += 8; }
    else if (type === 5) { cb(tag, 5, p.i, p.i + 4); p.i += 4; }
    else throw new Error('mvt wire ' + type);
  }
}
const td = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
const str = (b, s, e) => td.decode(b.subarray(s, e));

function readValue(b, s, e) {
  let out = null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  readMsg(b, s, e, (tag, type, a, z) => {
    if (tag === 1) out = str(b, a, z);
    else if (tag === 2) out = dv.getFloat32(a, true);
    else if (tag === 3) out = dv.getFloat64(a, true);
    else if (tag === 4 || tag === 5) out = a;
    else if (tag === 6) out = (a % 2 ? -(a + 1) / 2 : a / 2);
    else if (tag === 7) out = !!a;
  });
  return out;
}

function packed(b, s, e) {
  const p = { i: s }, out = [];
  while (p.i < e) out.push(varint(b, p));
  return out;
}

function readLayer(b, s, e) {
  const L = { name: '', extent: 4096, keys: [], values: [], features: [] };
  const raw = [];
  readMsg(b, s, e, (tag, type, a, z) => {
    if (tag === 1) L.name = str(b, a, z);
    else if (tag === 2) raw.push([a, z]);
    else if (tag === 3) L.keys.push(str(b, a, z));
    else if (tag === 4) L.values.push(readValue(b, a, z));
    else if (tag === 5) L.extent = a;
  });
  for (const [a, z] of raw) {
    let id = 0, type = 0, tags = [], geom = [];
    readMsg(b, a, z, (tag, t, x, y) => {
      if (tag === 1) id = x;
      else if (tag === 2) tags = packed(b, x, y);
      else if (tag === 3) type = x;
      else if (tag === 4) geom = packed(b, x, y);
    });
    const props = {};
    for (let k = 0; k + 1 < tags.length; k += 2) props[L.keys[tags[k]]] = L.values[tags[k + 1]];
    L.features.push({ id, type, props, rings: geometry(geom) });
  }
  return L;
}

// Befehle MoveTo (1), LineTo (2), ClosePath (7) mit Zickzack Deltas
function geometry(g) {
  const rings = [];
  let x = 0, y = 0, cur = null, i = 0;
  while (i < g.length) {
    const c = g[i++], cmd = c & 7, n = c >> 3;
    if (cmd === 7) { if (cur && cur.length) cur.closed = true; continue; }
    for (let k = 0; k < n; k++) {
      const dx = g[i++], dy = g[i++];
      x += (dx >> 1) ^ -(dx & 1); y += (dy >> 1) ^ -(dy & 1);
      if (cmd === 1) { cur = []; rings.push(cur); }
      cur.push(x, y);
    }
  }
  return rings;
}

// Fläche eines Rings (Kachelkoordinaten, y nach unten): positiv = Außenring im MVT Sinn
export function ringArea(r) {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i += 2) { const j = (i + 2) % n; a += r[i] * r[j + 1] - r[j] * r[i + 1]; }
  return a / 2;
}
