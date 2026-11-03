import { zipStored } from '../release/zip.mjs';
import { constants } from 'node:fs';
import { createServer } from 'node:http';
import { open } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { BODY_LIMIT, PUBLIC_MODEL, PUBLIC_RESERVE_USD } from './constants.mjs';
import { admitProductionRequest, parseRemixBody } from './policy.mjs';

const CREATOR_TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.map': 'application/json', '.txt': 'text/plain', '.woff2': 'font/woff2',
};
const CREATOR_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

const SANDBOX = { 'Content-Security-Policy': 'sandbox allow-scripts' };
const IMMUTABLE = 'public, max-age=31536000, immutable';

function isHtml(bytes) {
  const head = bytes.subarray(0, 64).toString('utf8').trim().toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html');
}

export const PRIVACY_NOTE = `Motion transfer playback does not call a model.
Remix creation is limited to adults 18 and older and uses Standard Muse Spark 1.3.
Contributor mode is not used for visitor traffic.
Remix prompts are retained with the job so the result can be explained and replayed.
Playback does not require an account.
`;

async function readCreatorFile(root, pathname) {
  if (!root || !pathname.startsWith('/creator/')) return null;
  const relative = pathname.slice('/creator/'.length);
  if (!relative || relative.includes('..') || relative.includes('\\') || relative.includes('\0')) return null;
  const base = resolve(root);
  const file = resolve(base, relative);
  if (file !== base && !file.startsWith(base + sep)) return null;
  const handle = await open(file, CREATOR_FLAGS);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw Error('Creator bundle file is not a bounded regular file');
    const bytes = Buffer.alloc(stat.size);
    await handle.read(bytes, 0, stat.size, 0);
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function createHostingServer({ policy, coordinator, creatorRoot = null, port = 0, host = '127.0.0.1' } = {}) {
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
      const rawPath = (request.url ?? '/').split('?')[0];
      if (rawPath.includes('..') || rawPath.includes('\\') || rawPath.includes('\0')) {
        json(request, response, 404, { error: 'Not found' });
        return;
      }
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
      if (path === '/api/catalog') { json(request, response, 200, await coordinator.catalog()); return; }
      if (path === '/' || path === '/index.html') {
        let page = null;
        if (creatorRoot) {
          try { page = await readCreatorFile(creatorRoot, '/creator/index.html'); }
          catch (error) {
            if (!['ENOENT', 'ELOOP', 'ENOTDIR'].includes(error.code)) throw error;
          }
        }
        if (page) {
          send(request, response, 200, 'text/html', page, { cache: 'no-store' });
          return;
        }
        if (path === '/') { json(request, response, 200, await coordinator.catalog()); return; }
      }
      if (decision.route === 'creator') {
        let file;
        try { file = await readCreatorFile(creatorRoot, path); }
        catch (error) {
          if (error.code === 'ENOENT' || error.code === 'ELOOP' || error.code === 'ENOTDIR') {
            json(request, response, 404, { error: 'Not found' });
            return;
          }
          throw error;
        }
        if (!file) { json(request, response, 404, { error: 'Not found' }); return; }
        const type = CREATOR_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
        send(request, response, 200, type, file, { cache: 'no-store' });
        return;
      }
      if (path === '/health') {
        json(request, response, 200, { ...coordinator.status(), isolation: await coordinator.brokerAvailable() ? 'required' : 'unavailable' });
        return;
      }
      if (path === '/privacy') { send(request, response, 200, 'text/plain', PRIVACY_NOTE); return; }
      if (path === '/api/remixes/status') { json(request, response, 200, { ...coordinator.status(), model: PUBLIC_MODEL, publicReserveUsd: PUBLIC_RESERVE_USD }); return; }
      if (decision.route === 'cancel') {
        const value = JSON.parse(body);
        json(request,response,200,await coordinator.cancel(path.split('/')[3],value.sessionId)); return;
      }
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
      const parentPath = path.match(/^\/parents\/([a-f0-9]{64})(\/download)?$/);
      if (parentPath) {
        let bytes;
        try { bytes = await coordinator.parentBytes(parentPath[1]); }
        catch (error) {
          if (error.status === 404) { json(request, response, 404, { error: 'Artifact not found' }); return; }
          throw error;
        }
        const html = isHtml(bytes);
        const headers = html ? { ...SANDBOX } : {};
        if (parentPath[2]) headers['Content-Disposition'] = `attachment; filename="parent-${parentPath[1].slice(0, 12)}.${html ? 'html' : 'bin'}"`;
        send(request, response, 200, html ? 'text/html' : 'application/octet-stream', bytes, { cache: IMMUTABLE, headers });
        return;
      }
      const artifactPath = path.match(/^\/artifacts\/([a-f0-9]{64})(?:\/(play\.html|adapter\.js|adapter\.ts|receipt\.json|generation\.json|experiment\.json|notices\.txt|download|download\.zip))?$/);
      if (artifactPath) {
        const [, id, part] = artifactPath;
        if (part === 'download.zip') {
          const files={};for(const name of ['play.html','adapter.ts','adapter.js','intent.json','recipient.json','component.json','receipt.json','generation.json','experiment.json','notices.txt']){const file=await coordinator.artifactFile(id,name);if(file)files[name]=file;}
          if(!files['receipt.json']){json(request,response,404,{error:'Artifact not found'});return;}
          send(request,response,200,'application/zip',zipStored(files),{cache:IMMUTABLE,headers:{'Content-Disposition':`attachment; filename="motion-transfer-${id.slice(0,12)}.zip"`}});return;
        }
        const stored = ['adapter.ts','receipt.json','generation.json','experiment.json','notices.txt'].includes(part) ? part : part === 'adapter.js' ? 'adapter.js' : part === 'play.html' || part === 'download' ? 'play.html' : 'receipt.json';
        const file = await coordinator.artifactFile(id, stored);
        if (!file) { json(request, response, 404, { error: 'Artifact not found' }); return; }
        if (part === 'download') {
          send(request, response, 200, 'text/html', file, {
            cache: IMMUTABLE, headers: { ...SANDBOX, 'Content-Disposition': `attachment; filename="motion-transfer-${id.slice(0, 12)}.html"` },
          });
          return;
        }
        if (part === 'play.html') {
          send(request, response, 200, 'text/html', file, { cache: IMMUTABLE, headers: SANDBOX });
          return;
        }
        if (part === 'adapter.js') {
          send(request, response, 200, 'text/javascript', file, {
            cache: IMMUTABLE, headers: { ...SANDBOX, 'Content-Disposition': 'attachment; filename="adapter.js"' },
          });
          return;
        }
        send(request, response, 200, part === 'adapter.ts' || part === 'notices.txt' ? 'text/plain' : 'application/json', file, { cache: IMMUTABLE });
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
