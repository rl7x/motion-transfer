import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Sandbox } from './vercel/sdk.mjs';
import { parseJobText } from './protocol.mjs';
import { profileFor, WORKER_ENV } from './isolation.mjs';
import { JOB_LIMIT } from './constants.mjs';

const workerName = /^motion-worker-[a-f0-9]{32}$/;
function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

/** Private typed worker control plane. Browser requests never receive its credential. */
export async function handleVercelWorkerRequest(request, response) {
  const expected = process.env.MOTION_PROXY_KEY;
  const actual = request.headers['x-motion-proxy-key'];
  if (typeof actual !== 'string' || !expected || Buffer.byteLength(actual) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) { json(response, 401, { error: 'Private worker control plane' }); return; }
  try {
    if (!process.env.MOTION_WORKER_SNAPSHOT_ID) throw Error('Worker snapshot is not configured');
    const url = new URL(request.url, 'https://motion.local');
    if (request.method === 'GET' && url.searchParams.get('health') === '1') { json(response, 200, { available: true }); return; }
    if (request.method === 'POST') {
      const chunks=[];let bytes=0;
      for await(const chunk of request) { bytes+=chunk.length;if(bytes>JOB_LIMIT){json(response,413,{error:'Worker job exceeds limit'});return;}chunks.push(chunk); }
      const job = parseJobText(Buffer.concat(chunks).toString('utf8'));
      const profile = profileFor(job.operation);
      const name = 'motion-worker-' + randomUUID().replaceAll('-', '');
      const worker = await Sandbox.create({ name, source: { type: 'snapshot', snapshotId: process.env.MOTION_WORKER_SNAPSHOT_ID },
        resources: { vcpus: job.operation === 'verify-browser' ? 2 : 1 }, persistent: false,
        timeout: profile.timeoutMs + 20_000, networkPolicy: 'deny-all',
        env: Object.fromEntries(WORKER_ENV.map(entry=>{const at=entry.indexOf('=');return [entry.slice(0,at),entry.slice(at+1)];})),
      });
      await worker.writeFiles([{path:'/tmp/motion-job.json',content:Buffer.from(JSON.stringify(job))}]);
      await worker.runCommand({cmd:'node',args:['scripts/run-vercel-worker.mjs'],cwd:'/app',detached:true});
      json(response,202,{name});return;
    }
    if (request.method !== 'GET' || !workerName.test(url.searchParams.get('name'))) { json(response,400,{error:'Invalid worker request'});return; }
    const worker=await Sandbox.get({name:url.searchParams.get('name')});
    if(!['running','pending'].includes(worker.status)){json(response,200,{ok:false,terminated:true,error:'Isolated worker terminated before returning a result'});return;}
    const bytes=await worker.readFileToBuffer({path:'/tmp/motion-result.json'});
    if(!bytes){json(response,200,{pending:true});return;}
    const result=JSON.parse(bytes.toString('utf8'));
    await worker.stop();
    json(response,200,result);
  } catch { json(response,503,{error:'Isolated worker unavailable within the free hosting quota'}); }
}
