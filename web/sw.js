// 画面のファイルは端末のキャッシュからすぐ返し、裏で取り直して次に開いたときに反映する。
// GAS への POST や他のサイトへの通信には触らない。
const CACHE = 'kozeni-v3';
const ASSETS = [
  './', './index.html', './app.js', './calc.js', './store.js', './api.js', './month.js', './history.js', './summary.js',
  './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const fresh = fetch(req).then(async (res) => {
    if (res.ok) await (await caches.open(CACHE)).put(req, res.clone());
    return res;
  });
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((cached) => cached || fresh));
  e.waitUntil(fresh.then(() => {}, () => {}));
});
