// Große Binärdateien laden (seit 26.11.2026, PLAN_QUALITAET.md Runde 3). Online liegt neben jeder großen .bin eine
// gepackte Fassung .bin.gz (deploy_github.py setzt dann window.PFR_GZ in index.html), der Browser entpackt sie selbst.
// GitHub Pages packt .bin Dateien nicht von sich aus. Lokal und in alten Browsern wird die ungepackte Datei geladen.
export async function fetchBin(url) {
  if (globalThis.PFR_GZ && typeof DecompressionStream === 'function') {
    try {
      const r = await fetch(url + '.gz');
      if (r.ok && r.body) return await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    } catch { /* weiter unten die ungepackte Datei */ }
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(url);
  return r.arrayBuffer();
}
