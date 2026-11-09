/*
 * WOVEXA service worker (spec §23, PWA-01/02/08): the studio installs and works offline.
 * - Installing caches the main pages and every build file they load, so the app opens offline
 *   from the first visit; files loaded later (panels, the 3D view) are kept as they are used.
 * - Build files, icons and brand art: cache first (content-hashed and immutable).
 * - Pages and their data (RSC payloads): network first, falling back to the last copy offline.
 * - Artwork fonts and the public 3D model library: kept, refreshed in the background.
 * - Never caches other /api routes, auth, or anything but GET (no private data in shared caches).
 * Designs themselves live in IndexedDB, not here.
 */
const VERSION = 'wovexa-v2';
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const MEDIA = `${VERSION}-media`;
/** A studio page for a project that doesn't exist: the studio's shell, which opens any local project. */
const STUDIO_SHELL = '/studio/offline';
const PRECACHE_PAGES = ['/dashboard', '/projects', '/exports', STUDIO_SHELL];
const PRECACHE_STATIC = ['/brand/wovexa-favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/manifest.webmanifest'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

/** Cache a page and the build files its HTML loads. One failure never stops the rest. */
async function precachePage(path, pages, files) {
  try {
    const response = await fetch(path, { credentials: 'same-origin' });
    if (!response.ok) return;
    await pages.put(path, response.clone());
    const html = await response.text();
    const assets = new Set(html.match(/\/_next\/static\/[^"'\\\s)]+/g) ?? []);
    await Promise.all([...assets].map((url) => files.add(url).catch(() => undefined)));
  } catch {
    // Offline while installing: these pages are cached when next visited.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const [pages, files] = await Promise.all([caches.open(PAGES), caches.open(STATIC)]);
      await Promise.all(PRECACHE_STATIC.map((url) => files.add(url).catch(() => undefined)));
      for (const path of PRECACHE_PAGES) await precachePage(path, pages, files);
    })(),
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

/** Cache first: content-hashed files never change. */
async function cacheFirst(request, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

/** The kept copy at once (refreshed in the background), else the network. */
async function staleWhileRevalidate(event, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(event.request);
  const refresh = fetch(event.request)
    .then((response) => {
      // Font files come back opaque from a stylesheet request; they are still worth keeping.
      if (response.ok || response.type === 'opaque') cache.put(event.request, response.clone());
      return response;
    })
    .catch(() => undefined);
  if (hit) {
    event.waitUntil(refresh);
    return hit;
  }
  return (await refresh) ?? new Response('', { status: 504, statusText: 'Offline' });
}

/**
 * Network first, keeping a copy; offline, the last copy. Page data varies by router headers that
 * its `_rsc` query already encodes, so the offline lookup ignores Vary.
 */
async function networkFirst(request, name, fallback) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      caches.open(name).then((cache) => cache.put(request, copy));
    }
    return response;
  } catch (error) {
    const cache = await caches.open(name);
    const hit = (await cache.match(request, { ignoreVary: request.mode !== 'navigate' })) ?? (fallback ? await fallback(cache) : undefined);
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    if (FONT_HOSTS.includes(url.hostname)) event.respondWith(staleWhileRevalidate(event, MEDIA));
    return;
  }
  // The 3D model library is public and large: kept once fetched, so chosen models work offline.
  if (url.pathname.startsWith('/api/models')) {
    event.respondWith(staleWhileRevalidate(event, MEDIA));
    return;
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/brand/')) {
    event.respondWith(cacheFirst(request, STATIC));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request, PAGES, async (cache) => {
        // Studio pages share one shell, which opens whatever project the address asks for.
        if (url.pathname.startsWith('/studio/')) return (await cache.match(STUDIO_SHELL)) ?? (await firstMatching(cache, '/studio/'));
        return cache.match('/dashboard');
      }).catch(() => new Response('You are offline and this page has not been opened on this device yet.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })),
    );
    return;
  }

  // Page data for moves between pages (RSC payloads) and other same-origin files.
  event.respondWith(networkFirst(request, PAGES));
});

async function firstMatching(cache, prefix) {
  const keys = await cache.keys();
  const key = keys.find((k) => new URL(k.url).pathname.startsWith(prefix));
  return key ? cache.match(key) : undefined;
}
