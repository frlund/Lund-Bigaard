/* Bigårdsjournal – service worker
 * Lagrer appens filer i en hurtigbuffer slik at appen åpnes uten nett.
 * Selve journalen ligger i IndexedDB og påvirkes ikke av denne filen.
 * Øk CACHE_VERSION når du endrer noen av filene under, slik at telefonen henter nye filer.
 */
'use strict';

const CACHE_VERSION = 'bigardsjournal-v1.1.0';

const APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './db.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './img/lund-bigaard-logo.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // cache: 'reload' sikrer at vi ikke legger gamle filer fra nettleserens HTTP-buffer i hurtigbufferen
      cache.addAll(APP_FILES.map((url) => new Request(url, { cache: 'reload' })))
    )
  );
  // Første installasjon tar kontroll med en gang. Ved oppdatering venter vi på at brukeren trykker «Oppdater».
  if (!self.registration.active) self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('bigardsjournal-') && key !== CACHE_VERSION)
            .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Sidevisninger: svar alltid med app-skallet (index.html) fra hurtigbufferen.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_VERSION)
        .then((cache) => cache.match('./index.html'))
        .then((cached) => cached || fetch(request))
        .catch(() => fetch(request))
    );
    return;
  }

  // Øvrige filer: hurtigbuffer først, deretter nett.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      });
    })
  );
});
