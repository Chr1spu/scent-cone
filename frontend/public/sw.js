/*
 * Scentline service worker: keeps the app usable with no signal once it has been opened online.
 * - Pages: network first, falling back to the cached app shell (single-page app).
 * - Hashed build assets (/assets/*): cache first (their names change when they change).
 * - Models, demo data, icons: stale-while-revalidate.
 * - Everything else (server.json, the backend, other origins): straight to the network.
 * Areas themselves are saved separately in IndexedDB (src/api/savedAreas.ts).
 */
const VERSION = 'scentline-v1';
const SHELL = '/__shell__';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      try {
        const res = await fetch('/', { cache: 'no-cache' });
        if (res.ok) {
          const html = await res.clone().text();
          await cache.put(SHELL, res);
          // precache what the shell loads directly
          const urls = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
          await Promise.all(urls.map((u) => cache.add(u).catch(() => {})));
        }
      } catch {
        // offline at install: runtime caching fills in later
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/server.json' || url.pathname === '/sw.js' || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(VERSION);
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(SHELL, res.clone());
          return res;
        } catch {
          return (await cache.match(SHELL)) ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(VERSION);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })(),
    );
    return;
  }

  if (/^\/(models|demo|icons|fonts)\//.test(url.pathname) || /\.(png|svg|ico|webp|jpg|glb|bin|json|geojson)$/.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(VERSION);
        const hit = await cache.match(req);
        const refresh = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);
        return hit ?? (await refresh) ?? Response.error();
      })(),
    );
  }
});
