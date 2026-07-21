// Aurora Chase Copilot service worker.
// Aurora chasing happens in places with weak or no signal, so the app shell must
// load offline and the last generated plan (kept in localStorage by app.js) must
// remain reachable. Strategy: precache the shell, network-first for navigations,
// stale-while-revalidate for assets and fonts. Never touch /api/ — live weather
// and aurora data must not be served stale.

const CACHE_NAME = 'aurora-copilot-shell-v1';
const RUNTIME_CACHE = 'aurora-copilot-runtime-v1';

const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/icon.svg',
  '/apple-touch-icon.svg',
];

const FONT_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // Live data is never cached — always hit the network.
  if (sameOrigin && url.pathname.startsWith('/api/')) return;

  // App shell navigations: fresh when online, cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/index.html'));
    return;
  }

  if (sameOrigin) {
    event.respondWith(staleWhileRevalidate(request, CACHE_NAME));
    return;
  }

  // Keep the type system available offline (Google Fonts, cross-origin).
  if (FONT_ORIGINS.includes(url.origin)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
  }
});

async function networkFirst(request, fallbackPath) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || (await cache.match(fallbackPath)) || Response.error();
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      // Cache successful basic/cors responses; opaque font responses are fine to keep too.
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);
  return cached || network || fetch(request);
}
