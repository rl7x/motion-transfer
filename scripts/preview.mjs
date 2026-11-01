import { createPreviewServer } from '../web/server.mjs';
import { createRemixService } from '../remix/service.mjs';
import { createLabService } from '../lab/service.mjs';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';

try { loadEnvFile(resolve('.env')); } catch (error) { if (error.code !== 'ENOENT') throw Error('Could not load .env'); }
const remixes = await createRemixService({directory:resolve('reports/remixes'),apiKey:process.env.MODEL_API_KEY});
const lab=await createLabService({directory:resolve('reports/lab'),apiKey:process.env.MODEL_API_KEY});
let server;
try { server = await createPreviewServer({ port: 4173, remixes,lab }); }
catch (error) { await remixes.close();await lab.close(); throw error; }
console.log(`Motion Transfer: ${server.origin}`);
console.log('Live remixes: one request at a time, $0.03 per request, $0.10 persistent local budget. No automatic retries.');
console.log('Investigation lab: $0.50 per investigation, $10 persistent development ceiling, no automatic retries.');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); await Promise.all([remixes.close(),lab.close()]); process.exit(0); });
