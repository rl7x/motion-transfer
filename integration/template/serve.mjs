import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

// A static server for this downloaded project. No dependencies, API, or keys.
const root = new URL('./', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root)));
const allowed = new Set([...Object.keys(manifest.files), 'manifest.json']);
const types = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', md: 'text/plain', ts: 'text/plain', txt: 'text/plain' };
const port = Number(process.argv[2] ?? 4174);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid port');
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!['GET', 'HEAD'].includes(request.method) || !allowed.has(path)) {
      response.writeHead(404); response.end('Not found'); return;
    }
    const bytes = await readFile(new URL(path, root));
    response.writeHead(200, { 'Content-Type': types[path.split('.').at(-1)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch {
    response.writeHead(500); response.end('Could not read project file');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`JUJUMP integration: http://127.0.0.1:${server.address().port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); server.closeAllConnections(); });
