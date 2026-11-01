import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { loadPakuPaku } from '../recipients/paku-paku/load.mjs';
import { clockedPakuRuntime, pakuObservationSource } from '../runtime/paku-browser.mjs';

export async function createPreviewServer({ port = 0, host = '127.0.0.1' } = {}) {
  const recipient = await loadPakuPaku();
  const assets = new Map([
    ['/assets/runtime.js', ['text/javascript', clockedPakuRuntime(recipient.runtime)]],
    ['/assets/sound.js', ['text/javascript', recipient.sound]],
    ['/assets/game.js', ['text/javascript', recipient.source + '\n' + pakuObservationSource()]],
    ['/licenses', ['text/plain', recipient.licenses.join('\n\n----------------\n\n')]],
    ['/api/recipient', ['application/json', JSON.stringify(recipient.manifest)]],
  ]);
  for (const [path, file, type] of [
    ['/', 'index.html', 'text/html'], ['/style.css', 'style.css', 'text/css'],
    ['/play', 'play.html', 'text/html'], ['/assets/clock.js', 'clock.js', 'text/javascript'],
    ['/assets/boot.js', 'boot.js', 'text/javascript'],
  ]) assets.set(path, [type, await readFile(new URL(file, import.meta.url), 'utf8')]);
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const asset = assets.get(path);
    if (!['GET', 'HEAD'].includes(request.method) || !asset) {
      response.writeHead(404); response.end('Not found'); return;
    }
    response.writeHead(200, { 'Content-Type': `${asset[0]}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : asset[1]);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return {
    origin: `http://${host}:${server.address().port}`,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
