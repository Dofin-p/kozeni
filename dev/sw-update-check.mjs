// 新しい版を出したとき、端末が何回開き直せば新しい画面になるかを、ヘッドレスの Chrome で確かめる。
// GitHub Pages と同じく Cache-Control: max-age=600 で web/ の写しを配り、途中で写しを「新しい版」に書き換える。
//   node dev/sw-update-check.mjs            … いまの web/ で確かめる
//   node dev/sw-update-check.mjs <dir>      … 別の web/ の写し（たとえば直す前の版）で確かめる
// 1) 開き直し：同じ URL を開き直したあと、新しい画面になっているか
// 2) 復帰：アプリ切り替えから戻った（visibilitychange）だけで、新しい画面になるか
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = process.argv[2] || fileURLToPath(new URL('../web/', import.meta.url));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTTP_PORT = 8790;
const CDP_PORT = 9334;
const URL_TO_CHECK = `http://127.0.0.1:${HTTP_PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const site = mkdtempSync(join(tmpdir(), 'kozeni-site-'));
cpSync(SRC, site, { recursive: true });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const rel = normalize(path === '/' ? 'index.html' : path.slice(1));
  try {
    const body = readFileSync(join(site, rel));
    res.writeHead(200, { 'Content-Type': types[extname(rel)] || 'application/octet-stream', 'Cache-Control': 'max-age=600' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(HTTP_PORT, '127.0.0.1');

// 写しを「新しい版」にする：画面に印を足し、sw.js のキャッシュ名を変える（実際のリリースと同じ）
function release(build) {
  const index = join(site, 'index.html');
  const html = readFileSync(index, 'utf8').replace(/<meta name="kozeni-build"[^>]*>\n?/, '');
  writeFileSync(index, html.replace('<head>', `<head>\n<meta name="kozeni-build" content="${build}">`));
  const sw = join(site, 'sw.js');
  writeFileSync(sw, readFileSync(sw, 'utf8').replace(/const CACHE = '[^']*';/, `const CACHE = 'kozeni-test-${build}';`));
}

const profile = mkdtempSync(join(tmpdir(), 'kozeni-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });

async function target() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('Chrome did not start');
}

const ws = new WebSocket(await target());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r.result.exceptionDetails ? `ERR ${r.result.exceptionDetails.exception?.description}` : r.result.result.value;
};
const build = () => evaluate(`(document.querySelector('meta[name="kozeni-build"]') || {}).content || 'none'`);

const results = {};
try {
  await send('Page.enable');
  await send('Page.navigate', { url: URL_TO_CHECK });
  await sleep(1500);
  // 設定シートが開いていると読み込み直しを待つので、先に設定を入れておく（つながらない先でよい）
  await evaluate(`localStorage.setItem('kozeni.config', JSON.stringify({ url: 'http://127.0.0.1:1/api', token: 'x' }))`);
  await evaluate('navigator.serviceWorker.ready.then(() => true)');
  await send('Page.reload');
  await sleep(2000);
  results.start = { build: await build(), controlled: await evaluate('!!navigator.serviceWorker.controller') };

  // 1) 新しい版を出し、1回だけ開き直す
  release(2);
  await send('Page.navigate', { url: URL_TO_CHECK });
  await sleep(5000);
  results.reopenOnce = await build();
  await send('Page.navigate', { url: URL_TO_CHECK });
  await sleep(5000);
  results.reopenTwice = await build();

  // 2) 新しい版を出し、アプリ切り替えから戻っただけ（読み込み直しなし）
  release(3);
  await evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);
  await sleep(5000);
  results.resume = await build();

  console.log(JSON.stringify(results, null, 2));
  const ok = results.start.controlled && results.reopenOnce === '2' && results.resume === '3';
  console.log(ok ? 'OK: 1回の開き直し・復帰で新しい画面になる' : 'NG: 新しい画面になるまでに余計な開き直しが要る');
  process.exitCode = ok ? 0 : 1;
} finally {
  ws.close();
  chrome.kill();
  server.close();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
  rmSync(site, { recursive: true, force: true });
}
