const CACHE_NAME = 'prenota-tavolo-v2';
const ASSETS_TO_CACHE = [
  './index.html',
  './css/style.css',
  './js/main.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Installazione: mette in cache la "shell" statica dell'app
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

// Attivazione: pulisce cache vecchie
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Le chiamate al backend (Google Apps Script, altro dominio) vanno sempre in
// rete, mai in cache: qui basta controllare che l'host sia diverso da quello
// della pagina, invece di cercare un percorso "/api/" che non esiste più.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) {
    return; // richiesta verso Apps Script (o altro dominio): lascia passare alla rete
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        }).catch(() => cached)
      );
    })
  );
});
