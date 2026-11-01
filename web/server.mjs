import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { loadPakuPaku } from '../recipients/paku-paku/load.mjs';
import { clockedPakuRuntime, pakuObservationSource, hookedPakuSource } from '../runtime/paku-browser.mjs';
import { loadRecoveredMotion } from '../component/load.mjs';

export async function createPreviewServer({ port = 0, host = '127.0.0.1', adapter } = {}) {
  const recipient = await loadPakuPaku();
  const recovered = await loadRecoveredMotion();
  const assets = new Map([
    ['/assets/runtime.js', ['text/javascript', clockedPakuRuntime(recipient.runtime)]],
    ['/assets/sound.js', ['text/javascript', recipient.sound]],
    ['/assets/game.js', ['text/javascript', recipient.source + '\n' + pakuObservationSource()]],
    ['/assets/game-transfer.js', ['text/javascript', hookedPakuSource(recipient.source) + '\n' + pakuObservationSource()]],
    ['/assets/component.js', ['text/javascript', recovered.javascript]],
    ['/assets/transfer-output.js', ['text/javascript', await readFile(new URL('../transfer/output.mjs', import.meta.url), 'utf8')]],
    ['/api/transfer-config', ['application/json', JSON.stringify({ motion: recovered.contract.defaults, unitScale: 0.5, componentId: recovered.provenance.id })]],
    ['/licenses', ['text/plain', recipient.licenses.join('\n\n----------------\n\n')]],
    ['/api/recipient', ['application/json', JSON.stringify(recipient.manifest)]],
  ]);
  for (const [path, file, type] of [
    ['/', 'index.html', 'text/html'], ['/style.css', 'style.css', 'text/css'],
    ['/play', 'play.html', 'text/html'], ['/assets/clock.js', 'clock.js', 'text/javascript'],
    ['/assets/boot.js', 'boot.js', 'text/javascript'], ['/assets/port.js', 'port.js', 'text/javascript'],
  ]) assets.set(path, [type, await readFile(new URL(file, import.meta.url), 'utf8')]);
  if (adapter) assets.set('/assets/adapter.js', ['text/javascript', adapter.javascript]);
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const path = url.pathname;
    let asset = assets.get(path);
    if (path === '/play' && url.searchParams.get('mode') === 'transfer') {
      asset = adapter ? ['text/html', asset[1].replace('src="/assets/game.js"', 'src="/assets/game-transfer.js"')] : undefined;
    }
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
