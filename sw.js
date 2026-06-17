// sw.js — smart cache for the single-file Tens build
const CACHE_VERSION = 'v72';
const STATIC_CACHE = `tens-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `tens-runtime-${CACHE_VERSION}`;

// The game now lives in index.html. Keep styles.css/script.js out of the precache.
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const base = self.registration.scope;
    for (const rel of ASSETS) {
      const url = new URL(rel, base).toString();
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        await cache.put(url, res.clone());
      } catch (err) {
        console.warn('[SW] precache skipped:', url, '→', err.message);
      }
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(name => ![STATIC_CACHE, RUNTIME_CACHE].includes(name))
        .map(name => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

function isHTMLRequest(request) {
  return request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isHTMLRequest(request)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request, { cache: 'no-cache' });
        const staticCache = await caches.open(STATIC_CACHE);
        await staticCache.put(new URL('index.html', self.registration.scope).toString(), fresh.clone());
        return fresh;
      } catch {
        const staticCache = await caches.open(STATIC_CACHE);
        const fallback = await staticCache.match(new URL('index.html', self.registration.scope).toString());
        return fallback || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const staticCache = await caches.open(STATIC_CACHE);
    const runtimeCache = await caches.open(RUNTIME_CACHE);
    const cached = await staticCache.match(request) || await runtimeCache.match(request);

    const network = fetch(request)
      .then(res => {
        if (res && res.ok) runtimeCache.put(request, res.clone());
        return res;
      })
      .catch(() => null);

    return cached || await network || new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
