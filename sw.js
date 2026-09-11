// Hollowmere service worker.
// Stale-while-revalidate: the game starts instantly from cache and works with no
// network, while a fresh copy is fetched in the background for the next visit.
// (A plain cache-first worker would pin players to the first version forever.)
const CACHE = 'hollowmere-v2';
const FILES = ['./', './index.html', './style.css', './game.js', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(cache =>
    cache.match(req, { ignoreSearch: true }).then(hit => {
      const fresh = fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || fresh;
    })));
});
