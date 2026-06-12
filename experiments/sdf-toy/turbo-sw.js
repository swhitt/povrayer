// povrayer turbo's service worker: network-first with cache fallback, scoped
// to /turbo* only (the main povrayer app manages itself). Network-first keeps
// deploys instant; the cache means the toy still opens on the subway.
/* global self, caches, fetch, location, URL */
const CACHE = 'turbo-v1';
const ASSETS = [
  '/turbo',
  '/turbo.webmanifest',
  '/turbo-icon-192.png',
  '/turbo-icon-512.png',
  '/turbo-apple-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) =>
        Promise.all(
          ks.filter((k) => k.startsWith('turbo-') && k !== CACHE).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || !u.pathname.startsWith('/turbo')) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
