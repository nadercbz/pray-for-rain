// Offline Speicher für Pray For Rain (seit 26.11.2026, PLAN_QUALITAET.md Runde 3). Nur online aktiv (index.html meldet
// ihn nur auf der Live Seite an). Bilder, Modelle und Bibliotheken kommen beim zweiten Besuch sofort aus dem Speicher,
// Code und Seiten immer zuerst aus dem Netz (damit jede neue Fassung ankommt), ohne Netz aus dem Speicher.
// VERSION setzt deploy_github.py bei jedem Deploy neu: alte Speicher werden dann gelöscht.
const VERSION = '202611260212';
const CACHE = 'pfr-' + VERSION;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('pfr-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.headers.has('range') || /\.(mp4|mp3|webm|m4a)$/.test(url.pathname)) return; // Film und Ton streamt der Browser selbst
  const fest = /\/(assets|vendor)\//.test(url.pathname);
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (fest) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.status === 200) cache.put(req, res.clone()).catch(() => {});
      return res;
    }
    try {
      const res = await fetch(req);
      if (res.ok && res.status === 200) cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
