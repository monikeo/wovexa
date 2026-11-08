/*
 * WOVEXA service worker (spec §23, PWA-01/02).
 * - Static build assets: cache first (they are content-hashed and immutable).
 * - Pages: network first, falling back to the last cached copy when offline.
 * - Never caches /api, auth, cross-origin requests or anything but GET (no private data in shared caches).
 * Designs themselves live in IndexedDB, not here.
 */
const VERSION = 'wovexa-v1';
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const PRECACHE = ['/dashboard', '/projects', '/brand/wovexa-favicon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page asks before activating a new version, so an update never interrupts an edit.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/brand/')) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(PAGES).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(PAGES);
          // Studio routes share one shell; any cached studio page can boot any local project.
          const match =
            (await cache.match(request)) ||
            (url.pathname.startsWith('/studio/') ? await firstMatching(cache, '/studio/') : undefined) ||
            (await cache.match('/dashboard'));
          return match || new Response('You are offline and this page has not been opened before.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        }),
    );
  }
});

async function firstMatching(cache, prefix) {
  const keys = await cache.keys();
  const key = keys.find((k) => new URL(k.url).pathname.startsWith(prefix));
  return key ? cache.match(key) : undefined;
}
