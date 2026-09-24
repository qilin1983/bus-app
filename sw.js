// Service worker: lets the app open without a connection and load faster.
// The browser runs this file in the background, separately from the page.
//
// What gets saved (cached) and how:
// - The app's own files (HTML, CSS, JS, icons): try the network first so you always get
//   the latest version, and fall back to the saved copy when offline.
// - The bus network data (stops, routes, first/last bus times): use the saved copy
//   straight away, and quietly download a fresh copy for next time. It rarely changes.
// - Live arrival times: never saved. Old arrival times would be misleading.

// Change this name whenever you change APP_FILES, so old caches are cleaned up
const CACHE_NAME = 'bus-app-v1';

const APP_FILES = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

// The bus network data. On the very first visit the page downloads these before this service
// worker is running, so we download them here too, to make sure they're saved for offline use.
const DATA_FILES = [
  'https://data.busrouter.sg/v1/stops.min.json',
  'https://data.busrouter.sg/v1/services.min.json',
  'https://data.busrouter.sg/v1/firstlast.min.json',
];

// 1. Install: save the app's files ready for offline use
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(APP_FILES);
      // The data is nice to have offline but not required, so a failure here
      // shouldn't stop the service worker from installing
      await cache.addAll(DATA_FILES).catch(() => {});
    })
  );
  self.skipWaiting(); // start using this version straight away
});

// 2. Activate: delete caches left over from older versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

// 3. Fetch: decide where each request is answered from
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  } else if (url.hostname === 'data.busrouter.sg') {
    event.respondWith(savedCopyFirst(request, event));
  }
  // Anything else (e.g. live arrivals) goes straight to the network as normal
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    // Offline: use the saved copy. `ignoreSearch` lets "index.html?x" match "index.html".
    const saved = await cache.match(request, { ignoreSearch: true });
    if (saved) return saved;
    throw error;
  }
}

async function savedCopyFirst(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const saved = await cache.match(request);

  const download = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });

  if (saved) {
    // Answer now with the saved copy, and keep the service worker alive until the
    // fresh copy has been saved for next time
    event.waitUntil(download.catch(() => {}));
    return saved;
  }
  return download;
}
