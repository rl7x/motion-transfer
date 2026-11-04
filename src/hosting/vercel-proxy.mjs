import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const BODY_LIMIT = 4096;
const RESPONSE_LIMIT = 4 * 1024 * 1024;
// These change as people generate, so the running backend answers them when it can.
const LIVE = new Set(['/api/catalog', '/api/remixes/status']);
const WAKE_BUDGET_MS = 4000;
const WRITES = /^\/api\/remixes(?:\/[a-f0-9-]{36}\/cancel)?$/;
const forwardedHeaders = ['content-type', 'content-disposition', 'content-security-policy', 'x-content-type-options', 'access-control-allow-origin'];

function fail(response, status, error) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify({ error }));
}

function sameKey(actual, expected) {
  return typeof actual === 'string' && Buffer.byteLength(actual) === Buffer.byteLength(expected)
    && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

async function requestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw Object.assign(Error('Request exceeds 4 KB'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function forward(request, response, { origin, headers, body, fetchImpl = fetch }) {
  if (!request.url?.startsWith('/') || request.url.startsWith('//')) {
    fail(response, 400, 'Invalid application path'); return;
  }
  const target = new URL(request.url, origin);
  if (target.origin !== new URL(origin).origin) { fail(response, 400, 'Invalid application path'); return; }
  body ??= request.method === 'POST' ? await requestBody(request) : undefined;
  const result = await fetchImpl(target, {
    method: request.method, headers, ...(body ? { body } : {}), redirect: 'manual',
    signal: AbortSignal.timeout(45_000),
  });
  const bytes = request.method === 'HEAD' ? null : Buffer.from(await result.arrayBuffer());
  if (bytes?.length > RESPONSE_LIMIT) { fail(response, 502, 'Application response exceeds the hosting limit'); return; }
  const output = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  for (const name of forwardedHeaders) if (result.headers.has(name)) output[name] = result.headers.get(name);
  response.writeHead(result.status, output);
  response.end(bytes);
}

function sendSaved(request, response, saved, { live = false, paused = false } = {}) {
  let bytes = saved.bytes;
  if (paused) bytes = Buffer.from(JSON.stringify({ ...JSON.parse(bytes.toString('utf8')), generationConfigured: false }));
  response.writeHead(200, { ...saved.headers, 'X-Content-Type-Options': 'nosniff', 'X-Motion-Snapshot': '1',
    'Cache-Control': live ? 'no-store' : 'public, max-age=3600, s-maxage=31536000' });
  response.end(request.method === 'HEAD' ? undefined : bytes);
}

/**
 * Answers a live read from the backend. If it is still waking after the budget, the saved copy
 * goes out and the wake carries on. If it can't start at all, generation is reported as paused.
 */
async function liveOrSaved(request, response, { saved, getBackend, background, forwardTo }) {
  let timer;
  const wake = getBackend();
  const waited = new Promise(resolve => { timer = setTimeout(resolve, WAKE_BUDGET_MS, null); });
  try {
    const origin = await Promise.race([wake, waited]);
    clearTimeout(timer);
    if (origin) { await forwardTo(origin); return; }
    background?.(wake.catch(() => {}));
    sendSaved(request, response, saved, { live: true });
  } catch {
    clearTimeout(timer);
    sendSaved(request, response, saved, { live: true, paused: true });
  }
}

/** The public Function validates browser writes before adding the private sandbox credential. */
export function createVercelProxy({ getBackend, proxyKey, hosts, fetchImpl = fetch, snapshot = null, background = null }) {
  if (typeof proxyKey !== 'string' || proxyKey.length < 32 || !Array.isArray(hosts) || hosts.length === 0) {
    throw Error('Vercel backend configuration is incomplete');
  }
  const allowed = new Set(hosts);
  return async (request, response) => {
    try {
      const host = request.headers.host;
      if (!allowed.has(host)) { fail(response, 403, 'Unrecognized application host'); return; }
      const path = new URL(request.url, 'https://' + host).pathname;
      if (path.startsWith('/_motion/')) { fail(response, 404, 'Not found'); return; }
      if (!['GET', 'HEAD', 'POST'].includes(request.method)) { fail(response, 405, 'Method not allowed'); return; }
      if (request.method === 'POST' && (!WRITES.test(path) || request.headers.origin !== 'https://' + host
        || request.headers['content-type']?.split(';')[0] !== 'application/json')) {
        fail(response, 403, 'A same-origin JSON remix request is required'); return;
      }
      const body = request.method === 'POST' ? await requestBody(request) : undefined;
      const forwardTo = origin => forward(request, response, { origin, body, fetchImpl, headers: {
        'x-motion-proxy-key': proxyKey, 'x-motion-public-host': host,
        ...(request.method === 'POST' ? { 'content-type': 'application/json', 'x-motion-public-origin': request.headers.origin } : {}),
      } });
      const saved = request.method === 'POST' ? null : await snapshot?.read(request.url);
      if (saved && LIVE.has(path)) { await liveOrSaved(request, response, { saved, getBackend, background, forwardTo }); return; }
      if (saved) { sendSaved(request, response, saved); return; }
      await forwardTo(await getBackend());
    } catch (error) {
      fail(response, error.status ?? 503, error.status === 413 ? error.message : 'The free backend is starting or temporarily unavailable. Please retry shortly.');
    }
  };
}

/** Only the Function can reach the loopback application, including its write endpoints. */
export async function createSandboxIngress({ previewOrigin, proxyKey, port = 3000, host = '0.0.0.0' }) {
  if (typeof proxyKey !== 'string' || proxyKey.length < 32) throw Error('A private proxy credential is required');
  const server = createServer(async (request, response) => {
    try {
      if (!sameKey(request.headers['x-motion-proxy-key'], proxyKey)) { fail(response, 401, 'Private backend'); return; }
      if (request.url === '/_motion/health' && request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ ready: true })); return;
      }
      const path = new URL(request.url, previewOrigin).pathname;
      if (!['GET', 'HEAD', 'POST'].includes(request.method)
        || (request.method === 'POST' && !WRITES.test(path))) { fail(response, 405, 'Method not allowed'); return; }
      await forward(request, response, { origin: previewOrigin, headers: {
        ...(request.method === 'POST' ? { origin: previewOrigin, 'content-type': 'application/json' } : {}),
      } });
    } catch (error) { fail(response, error.status ?? 502, error.status === 413 ? error.message : 'Backend request failed'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
