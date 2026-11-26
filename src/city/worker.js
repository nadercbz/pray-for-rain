// Worker der Stadtansicht: lädt eine Vektorkachel, liest sie und baut die Geometrie, ohne den Hauptfaden zu stören.
import { decodeTile } from './mvt.js';
import { buildTile } from './build.js';

const bufs = (o, acc = []) => {
  if (!o || typeof o !== 'object') return acc;
  if (ArrayBuffer.isView(o)) { acc.push(o.buffer); return acc; }
  for (const v of Array.isArray(o) ? o : Object.values(o)) bufs(v, acc);
  return acc;
};

self.onmessage = async e => {
  const { id, url, tx, ty, F, style, lang, z, far } = e.data;
  try {
    let buf = null, err = null;
    for (let k = 0; k < 3 && !buf; k++) {
      try {
        const r = await fetch(url);
        if (r.status === 204 || r.status === 404) { buf = new ArrayBuffer(0); break; }
        if (!r.ok) throw new Error('http ' + r.status);
        buf = await r.arrayBuffer();
      } catch (x) { err = x; await new Promise(res => setTimeout(res, 600 * (k + 1))); }
    }
    if (!buf) throw err || new Error('fetch');
    const L = buf.byteLength ? decodeTile(buf) : {};
    const o = buildTile(L, tx, ty, F, style, lang, z || 14, !!far);
    const list = [...new Set(bufs(o))];
    self.postMessage({ id, ok: true, tile: o }, list);
  } catch (x) {
    self.postMessage({ id, ok: false, error: String(x && x.message || x) });
  }
};
