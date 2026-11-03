import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const types = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8', txt: 'text/plain; charset=utf-8',
  ts: 'text/plain; charset=utf-8', zip: 'application/zip' };

async function open(root, pathname) {
  const decoded = decodeURIComponent(pathname);
  if (decoded.includes('\0') || decoded.split('/').includes('..')) return null;
  const relative = decoded.replace(/^\/+/, '');
  const base = resolve(root);
  for (const candidate of [relative, relative && relative + '.html', join(relative, 'index.html')].filter(Boolean)) {
    const full = resolve(base, candidate);
    if (full !== base && !full.startsWith(base + sep)) return null;
    try {
      const info = await stat(full);
      if (info.isFile()) return full;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return null;
}

export const RELEASE_CHECK_BASE_PATH = '/motion-transfer/';

export function createStaticReleaseServer({ root, basePath = '/', host = '127.0.0.1', port = 0 }) {
  if (!basePath.startsWith('/') || !basePath.endsWith('/')) throw Error('Base path must start and end with /');
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const send = (status, type, body, extra = {}) => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (!['GET', 'HEAD'].includes(request.method ?? '')) {
      send(405, 'application/json; charset=utf-8', JSON.stringify({ error: 'Creation is unavailable on this static copy.' }));
      return;
    }
    const path = url.pathname;
    if (path + '/' === basePath) { response.writeHead(302, { Location: basePath }); response.end(); return; }
    if (path !== basePath && !path.startsWith(basePath)) { send(404, 'text/plain; charset=utf-8', 'Not found'); return; }
    const file = await open(root, path.slice(basePath.length));
    if (!file) { send(404, 'text/plain; charset=utf-8', 'Not found'); return; }
    const body = await readFile(file);
    const extension = file.split('.').pop();
    const extra = extension === 'zip' ? { 'Content-Disposition': 'attachment; filename="download.zip"' } : {};
    send(200, types[extension] ?? 'application/octet-stream', body, extra);
  });
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolveListen({
      origin: `http://${host}:${server.address().port}${basePath}`,
      close: () => new Promise((done, fail) => server.close(error => error ? fail(error) : done())),
    }));
  });
}
