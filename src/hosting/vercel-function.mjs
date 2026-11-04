import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sandbox } from './vercel/sdk.mjs';
import { createVercelProxy } from './vercel-proxy.mjs';
import { loadSnapshot } from './vercel-snapshot.mjs';
import { handleVercelWorkerRequest } from './vercel-worker-gateway.mjs';

let backend = null;
let handler;
let waking = null;

const REQUEST_CONTEXT = Symbol.for('@vercel/request-context');

/** Lets a sandbox wake finish after the visitor has already received the saved copy. */
function keepRunning(promise) {
  globalThis[REQUEST_CONTEXT]?.get?.()?.waitUntil?.(promise);
}

/** Every request during a cold start shares one wake. */
function getBackend() {
  if (backend && backend.expires > Date.now()) return Promise.resolve(backend.origin);
  waking ??= wake().finally(() => { waking = null; });
  return waking;
}

async function wake() {
  const sandbox = await Sandbox.get({ name: process.env.MOTION_SANDBOX_NAME, resume: true });
  await sandbox.runCommand({
    cmd: 'flock', args: ['-n', '/tmp/motion-transfer-service.lock', 'node', 'scripts/serve-vercel-backend.mjs'],
    cwd: '/app', detached: true, env: { MOTION_PUBLIC_ORIGIN: 'https://' + process.env.MOTION_PUBLIC_HOST },
  });
  const origin = sandbox.domain(3000);
  const deadline = Date.now() + 35_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin + '/_motion/health', {
        headers: { 'x-motion-proxy-key': process.env.MOTION_PROXY_KEY }, signal: AbortSignal.timeout(2500),
      });
      if (response.ok) {
        backend = { origin, expires: Math.min(Date.now() + 20_000, (sandbox.expiresAt?.getTime() ?? Infinity) - 5000) };
        return origin;
      }
    } catch { /* A restored session needs to restart its application and Docker daemon. */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw Error('Sandbox application did not become ready');
}

export default async function vercelFunction(request, response) {
  if (new URL(request.url, 'https://motion.local').pathname === '/_motion/worker') return handleVercelWorkerRequest(request, response);
  handler ??= createVercelProxy({ getBackend, proxyKey: process.env.MOTION_PROXY_KEY, background: keepRunning,
    snapshot: await loadSnapshot(join(dirname(fileURLToPath(import.meta.url)), 'snapshot')),
    hosts: [...new Set([process.env.MOTION_PUBLIC_HOST, process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean))] });
  return handler(request, response);
}
