// 手元確認用サーバ。web/ を配信し、/api で gas/Code.gs を模擬スプシの上で動かす。
// node dev/server.mjs → http://localhost:8788（窓口 URL は http://localhost:8788/api、合言葉は fixture.json の token）
// SEED=1 で半年分のサンプルを入れる。DELAY_MS=3000 で GAS の遅さを真似る。curl localhost:8788/api/_offline?on=1 で /api を通信断にする（on=0 で戻る）。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGas } from './gas-mock.mjs';
import { seed } from './seed.mjs';

const PORT = Number(process.env.PORT) || 8788;
const webDir = fileURLToPath(new URL('../web/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.js': 'text/javascript' };
const DELAY_MS = Number(process.env.DELAY_MS) || 0;
const gas = loadGas();
if (process.env.SEED) console.log('seeded:', seed(gas));
let offline = false;

// ページの読み込み直しで通信が途中で切れても、サーバごと落ちないようにする
createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.log('request dropped:', err.code || err.message);
    if (!res.headersSent && !res.destroyed) { res.writeHead(500); res.end(); }
  });
}).listen(PORT, () => console.log(`kozeni dev: http://localhost:${PORT}`));

async function handle(req, res) {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');

  if (pathname === '/api/_offline') {
    offline = searchParams.get('on') === '1';
    console.log('offline:', offline);
    return res.end(`offline=${offline}\n`);
  }

  if (pathname === '/api') {
    if (offline) return req.socket.destroy();
    if (DELAY_MS) await new Promise((r) => setTimeout(r, DELAY_MS));
    const send = (obj) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'GET') return send(gas.get());
    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    let body = '';
    for await (const chunk of req) body += chunk;
    const out = gas.post(body);
    const action = (() => { try { return JSON.parse(body).action; } catch { return '?'; } })();
    console.log('POST /api', action, out.ok ? 'ok' : out.error, '| expenses rows:', gas.sheets.expenses.length - 1);
    return send(out);
  }

  if (pathname === '/api/_sheets') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(gas.sheets, null, 2));
  }

  const rel = normalize(pathname === '/' ? 'index.html' : pathname.slice(1));
  if (rel.startsWith('..')) { res.writeHead(400); return res.end(); }
  try {
    const data = await readFile(webDir + rel);
    res.writeHead(200, { 'Content-Type': types[extname(rel)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}
