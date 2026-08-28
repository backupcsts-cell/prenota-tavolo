const CACHE_NAME = 'prenota-tavolo-v3';
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
//
// STRATEGIA: "network-first" (prima la rete, poi la cache). In precedenza era
// "cache-first" e questo causava un problema serio: la primissima copia della
// pagina salvata in cache veniva servita per SEMPRE, anche dopo aver
// pubblicato aggiornamenti su GitHub Pages — l'utente restava bloccato su una
// versione vecchia senza nessun modo semplice per accorgersene. Con
// network-first, ogni apertura della pagina prende prima la versione più
// recente online; la cache serve solo come riserva se manca la connessione.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) {
    return; // richiesta verso Apps Script (o altro dominio): lascia passare alla rete
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
