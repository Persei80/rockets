// Network-first for the app's own files so updates show up right away;
// the cache only serves them when offline. Market data requests are not touched.
const CACHE = 'rockets-v5';
const SHELL = [
  './', 'index.html', 'style.css', 'manifest.webmanifest', 'icons/icon-192.png',
  'js/app.js', 'js/achievements.js', 'js/api.js', 'js/bus.js', 'js/calc.js', 'js/chart.js', 'js/detail.js', 'js/effects.js', 'js/format.js',
  'js/forms.js', 'js/i18n.js', 'js/live.js', 'js/machine.js', 'js/opinions.js', 'js/plan.js', 'js/portfolio.js', 'js/store.js', 'js/strings.js', 'js/ui.js', 'js/watch.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('rockets-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
