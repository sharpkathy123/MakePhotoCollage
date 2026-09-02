// Service Worker with Timestamped Cache Key
const CACHE_NAME = 'grid-collage-cache-2026-09-02-0100';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './sw.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Deleting stale cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Network first, falling back to cache only when the network is
// unreachable (offline). This applies to every request, not just page
// navigation: index.html is what registers the current sw.js?v=... URL, so
// serving it from cache on ANY fetch -- including the footer's own
// self-check of index.html's Last-Modified header -- would mean the one
// signal that tells the browser a newer version exists never gets seen.
// The cached list here is tiny (just this app's own few files), so there's
// no real cost to always preferring a fresh network response when online.
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
