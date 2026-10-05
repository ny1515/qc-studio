import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const base = '/qc-studio/';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };
const port = Number(process.env.QC_WEB_PORT || 4318);
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (!['GET', 'HEAD'].includes(req.method) || !url.pathname.startsWith(base)) throw new Error('Not found');
    const name = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html';
    const target = path.resolve(folder, name);
    if (!target.startsWith(folder + path.sep)) throw new Error('Not found');
    const data = await fs.readFile(target);
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`QC Studio web: http://127.0.0.1:${port}${base}`));
