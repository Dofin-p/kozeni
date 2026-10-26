// 手元確認用サーバ。web/ を配信し、/api で gas/Code.gs を模擬スプシの上で動かす。
// node dev/server.mjs → http://localhost:8788（窓口 URL は http://localhost:8788/api、合言葉は fixture.json の token）
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGas } from './gas-mock.mjs';

const PORT = Number(process.env.PORT) || 8788;
const webDir = fileURLToPath(new URL('../web/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.js': 'text/javascript' };
const gas = loadGas();

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/api') {
    const send = (obj) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'GET') return send(gas.get());
    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    let body = '';
    for await (const chunk of req) body += chunk;
    const out = gas.post(body);
    console.log('POST /api', out.ok ? 'ok' : out.error, '| expenses rows:', gas.sheets.expenses.length - 1);
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
}).listen(PORT, () => console.log(`kozeni dev: http://localhost:${PORT}`));
