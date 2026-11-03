import { parseJob } from './protocol.mjs';
import { profileFor } from './isolation.mjs';

/** Typed verifier transport. Only the Vercel Function holds sandbox orchestration credentials. */
export function createVercelWorkerBroker({ origin, proxyKey, fetchImpl = fetch }) {
  const endpoint = new URL('/_motion/worker', origin);
  const headers = { 'x-motion-proxy-key': proxyKey, 'content-type': 'application/json' };
  async function read(url, options = {}) {
    const response = await fetchImpl(url, { ...options, headers, signal: AbortSignal.timeout(30_000) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error ?? 'Isolated cloud worker unavailable');
    return result;
  }
  return {
    async available() { try { return (await read(endpoint + '?health=1')).available === true; } catch { return false; } },
    async submit(value) {
      const job = parseJob(value);
      const { name } = await read(endpoint, { method: 'POST', body: JSON.stringify(job) });
      const deadline = Date.now() + profileFor(job.operation).timeoutMs + 45_000;
      while (Date.now() < deadline) {
        const result = await read(endpoint + '?name=' + encodeURIComponent(name));
        if (!result.pending) return { ...result, frame: result.frame ? Buffer.from(result.frame, 'base64') : null };
        await new Promise(resolve => setTimeout(resolve, 800));
      }
      return { ok: false, terminated: true, error: 'Isolated cloud worker timeout; terminated' };
    },
    async close() {},
  };
}
