// Service Worker with Timestamped Cache Key
const CACHE_NAME = 'grid-collage-cache-2026-09-01-0800';

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

self.addEventListener('fetch', (event) => {
  // Navigation requests (loading the page itself) go to the network first.
  // index.html is what registers the current sw.js?v=... URL, so serving it
  // from cache would mean a new deploy's newer registration URL -- the only
  // signal that tells the browser a newer service worker exists at all --
  // never gets seen, and the page would keep re-registering the same stale
  // service worker forever, on every load, even a hard refresh (a refresh
  // bypasses the browser's own HTTP cache, but not this fetch handler).
  // Cache is only a fallback for when the network is unreachable (offline).
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});
