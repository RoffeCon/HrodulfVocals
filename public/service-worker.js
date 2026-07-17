const CACHE = 'songbook-shell-v2';
const SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/chordpro.js',
  '/manifest.json',
  '/icons/icon-192.svg',
];

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evt) => {
  const url = new URL(evt.request.url);

  // API-anrop och websocket ska alltid gå live mot servern - aldrig cache.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) {
    return;
  }

  // App-skalet: cache-first, uppdatera i bakgrunden (stale-while-revalidate)
  evt.respondWith(
    caches.match(evt.request).then(cached => {
      const network = fetch(evt.request).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(evt.request, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
