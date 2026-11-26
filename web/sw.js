// 画面のファイルは端末のキャッシュからすぐ返し、裏で取り直して次に開いたときに反映する。
// 新しい版（CACHE の名前が変わった sw.js）が入ったら、app.js が一度だけ読み込み直して切り替える。
// GAS への POST や他のサイトへの通信には触らない。
const CACHE = 'kozeni-v7';
const ASSETS = [
  './', './index.html', './app.js', './calc.js', './store.js', './api.js', './month.js', './history.js', './summary.js', './income.js',
  './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png',
];

self.addEventListener('install', (e) => {
  // ブラウザの HTTP キャッシュ（GitHub Pages は10分）を通さずに取る。通すと新しい版のキャッシュに古いファイルが入る
  const fresh = ASSETS.map((url) => new Request(url, { cache: 'reload' }));
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(fresh)).then(() => self.skipWaiting()));
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
  // 裏での取り直しも HTTP キャッシュに聞き直す（変わっていなければ 304 で軽く済む）
  const fresh = fetch(new Request(req.url, { cache: 'no-cache' })).then(async (res) => {
    if (res.ok) await (await caches.open(CACHE)).put(req, res.clone());
    return res;
  });
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((cached) => cached || fresh));
  e.waitUntil(fresh.then(() => {}, () => {}));
});
