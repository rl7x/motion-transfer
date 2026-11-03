import { createServer } from 'node:http';
import { BODY_LIMIT, PUBLIC_MODEL, PUBLIC_RESERVE_USD } from './constants.mjs';
import { admitProductionRequest, parseRemixBody } from './policy.mjs';

export const PRIVACY_NOTE = `Motion transfer playback does not call a model.
Remix creation is limited to adults 18 and older and uses Standard Muse Spark 1.3.
Contributor mode is not used for visitor traffic.
Remix prompts are retained with the job so the result can be explained and replayed.
The service counts anonymous events such as plays, remixes, and downloads. It does not ask for an account.
`;

export async function createHostingServer({ policy, coordinator, port = 0, host = '127.0.0.1' } = {}) {
  if (!policy || !coordinator) throw Error('Production hosting requires a policy and coordinator');
  const send = (request, response, status, type, body, extra = {}) => {
    const headers = {
      'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': extra.cache ?? 'no-store',
      'X-Content-Type-Options': 'nosniff', ...extra.headers,
    };
    if (headers.Location || headers.location) throw Error('Hosted responses do not redirect');
    response.writeHead(status, headers);
    response.end(request.method === 'HEAD' || body === undefined ? undefined : body);
  };
  const json = (request, response, status, value) => send(request, response, status, 'application/json', JSON.stringify(value));
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'https://play.example');
      const path = url.pathname;
      let body = '';
      if (request.method === 'POST') {
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > BODY_LIMIT) { json(request, response, 413, { error: 'Request exceeds 4 KB' }); return; }
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks).toString('utf8');
      }
      const decision = admitProductionRequest({
        policy, headers: request.headers, remoteAddress: request.socket.remoteAddress,
        method: request.method, path, bodyLength: Buffer.byteLength(body),
      });
      if (!decision.ok) { json(request, response, decision.status, { error: decision.error }); return; }
      if (path === '/health') {
        json(request, response, 200, { ...coordinator.status(), isolation: await coordinator.brokerAvailable() ? 'required' : 'unavailable' });
        return;
      }
      if (path === '/privacy') { send(request, response, 200, 'text/plain', PRIVACY_NOTE); return; }
      if (path === '/api/remixes/status') { json(request, response, 200, { ...coordinator.status(), model: PUBLIC_MODEL, publicReserveUsd: PUBLIC_RESERVE_USD }); return; }
      if (decision.route === 'remix') {
        let remix;
        try { remix = parseRemixBody(JSON.parse(body)); }
        catch (error) {
          json(request, response, String(error.message).includes('18 and older') ? 403 : 400, { error: error.message });
          return;
        }
        json(request, response, 202, await coordinator.submit(remix));
        return;
      }
      const jobPath = path.match(/^\/api\/remixes\/([0-9a-f-]{36})$/i);
      if (jobPath) { json(request, response, 200, await coordinator.job(jobPath[1].toLowerCase())); return; }
      const artifactPath = path.match(/^\/artifacts\/([a-f0-9]{64})(?:\/(play\.html))?$/);
      if (artifactPath) {
        const [, id, play] = artifactPath;
        const file = await coordinator.artifactFile(id, play ? 'play.html' : 'receipt.json');
        if (!file) { json(request, response, 404, { error: 'Artifact not found' }); return; }
        if (play) {
          send(request, response, 200, 'text/html', file, {
            cache: 'public, max-age=31536000, immutable',
            headers: { 'Content-Security-Policy': 'sandbox allow-scripts' },
          });
          return;
        }
        send(request, response, 200, 'application/json', file, { cache: 'public, max-age=31536000, immutable' });
        return;
      }
      json(request, response, 404, { error: 'Not found' });
    } catch (error) {
      json(request, response, error.status ?? 400, { error: error.message ?? 'Bad request' });
    }
  });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, host, resolveListen); });
  return {
    origin: `http://${host}:${server.address().port}`,
    port: server.address().port,
    close: () => new Promise((resolveClose, reject) => {
      server.close(error => error ? reject(error) : resolveClose());
      server.closeAllConnections();
    }),
  };
}
