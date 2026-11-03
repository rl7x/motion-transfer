import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

export function startStaticServer(root, extras = {}) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405);
        response.end();
        return;
      }
      if (Object.prototype.hasOwnProperty.call(extras, url.pathname)) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(extras[url.pathname]);
        return;
      }
      let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if (!relative) relative = 'index.html';
      if (relative.split('/').includes('..')) {
        response.writeHead(403);
        response.end();
        return;
      }
      const body = await readFile(join(root, relative));
      const type = TYPES[extname(relative)] ?? 'application/octet-stream';
      response.writeHead(200, { 'content-type': type });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        origin: 'http://127.0.0.1:' + address.port,
        close: () => new Promise(done => server.close(done)),
      });
    });
  });
}
