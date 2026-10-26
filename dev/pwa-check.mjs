// Service Worker が入り、電波がなくても画面が開けるかを、ヘッドレスの Chrome で確かめる。
// 先に node dev/server.mjs を起動しておき、node dev/pwa-check.mjs [URL] で実行する。
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_TO_CHECK = process.argv[2] || 'http://localhost:8788/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), 'kozeni-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
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
  return r.result.exceptionDetails ? { error: r.result.exceptionDetails.exception?.description } : r.result.result.value;
};

try {
  await send('Page.enable');
  await send('Network.enable');
  await send('Page.navigate', { url: URL_TO_CHECK });
  await sleep(3000);
  const online = await evaluate(`(async () => {
    const reg = await navigator.serviceWorker.ready;
    const keys = await caches.keys();
    const cached = keys.length ? (await (await caches.open(keys[0])).keys()).map((r) => new URL(r.url).pathname) : [];
    return { active: reg.active && reg.active.state, caches: keys, cached };
  })()`);
  console.log('online :', JSON.stringify(online));

  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await send('Page.reload');
  await sleep(2000);
  const offline = await evaluate(`({ title: document.title, controlled: !!navigator.serviceWorker.controller, keys: document.querySelectorAll('#pad [data-key]').length, cats: document.querySelectorAll('#cats .cat').length })`);
  console.log('offline:', JSON.stringify(offline));
  process.exitCode = online.active === 'activated' && offline.title === 'KOZENI' && offline.keys === 14 ? 0 : 1;
} finally {
  ws.close();
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
