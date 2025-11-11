// RacerVibes offline shell: precache core bundle and fall back to cache-first for same-origin GETs.
const CACHE_VERSION = 'rv-static-v20251024';
const CORE_ASSETS = [
  'racer_start_menu.html',
  'racer_mode_grip.html',
  'racer_mode_drift.html',
  'manifest.webmanifest',
  'physics.js',
  'physics/planckWorld.js',
  'gearbox.js',
  'src/gearbox.js',
  'decor_generator.js',
  'trackCollision.js',
  'track_storage.js',
  'ui/speedometer.js',
  'decor_atlas.png',
  'favicon.ico',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    try {
      await cache.addAll(CORE_ASSETS);
    } catch (err) {
      console.warn('[SW] Precache failed', err);
    }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)));
    self.clients.claim();
  })());
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.status === 200 && response.type === 'basic') {
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(CACHE_VERSION);
        cache.put(request, response.clone());
        return response;
      } catch (err) {
        const cached = await caches.match(request);
        if (cached) return cached;
        return caches.match('racer_start_menu.html');
      }
    })());
    return;
  }

  event.respondWith((async () => {
    try {
      return await cacheFirst(request);
    } catch (err) {
      const cache = await caches.open(CACHE_VERSION);
      const fallback = await cache.match(request);
      if (fallback) return fallback;
      throw err;
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
