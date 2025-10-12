'use strict';
// Basic offline cache for PWA installability and Android WebView/Chrome
const CACHE_NAME = 'racer-cache-v12';
const ASSETS = [
  './racer_start_menu.html',
  './racer_mode_grip.html',
  './racer_mode_drift.html',
  './physics.js',
  './physics/planckWorld.js',
  './trackCollision.js',
  './manifest.webmanifest'
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match('./racer_start_menu.html')))
    );
  }
});
