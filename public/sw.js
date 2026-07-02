/*
 * Offline service worker for the PWA install ("Add to Home Screen" on iPad).
 *
 * Strategy: network-first for page navigations (so a new deploy is picked up
 * when online), cache-first for everything else (Vite's hashed assets never
 * change under the same name). Every successful same-origin GET is cached, so
 * after one full online session the game runs entirely offline.
 */
const CACHE = 'quake-blast-v2';
const PRECACHE = ['./', 'index.html', 'icon.svg', 'manifest.webmanifest', 'apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  const cachePut = (res) => {
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  };

  if (req.mode === 'navigate') {
    // Network-first: fresh index.html when online, cached shell when offline.
    e.respondWith(fetch(req).then(cachePut).catch(() => caches.match(req).then((hit) => hit || caches.match('./'))));
  } else {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(cachePut)));
  }
});
