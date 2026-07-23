const CACHE = 'lyricsmaster-shell-v12';
const SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/chordpro.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/display.html',
  '/display.js',
  '/setlist-view.html',
  '/setlist-view.js',
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

  // Nätverk först, cache bara som reservplan. Servern körs alltid lokalt på enheten
  // när appen överhuvudtaget går att använda, så cache-first gav inget verkligt värde -
  // bara förvirring när uppdateringar kändes "fastnade". Nu hämtas senaste versionen
  // varje gång du laddar om, och cachen används bara om servern skulle vara onåbar.
  evt.respondWith(
    fetch(evt.request).then(res => {
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(evt.request, copy));
      }
      return res;
    }).catch(() => caches.match(evt.request))
  );
});
