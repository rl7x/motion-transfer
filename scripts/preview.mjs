import { createPreviewServer } from '../web/server.mjs';
import { createRemixService } from '../remix/service.mjs';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';

try { loadEnvFile(resolve('.env')); } catch (error) { if (error.code !== 'ENOENT') throw Error('Could not load .env'); }
const remixes = await createRemixService({directory:resolve('reports/remixes'),apiKey:process.env.MODEL_API_KEY});
let server;
try { server = await createPreviewServer({ port: 4173, remixes }); }
catch (error) { await remixes.close(); throw error; }
console.log(`Motion Transfer: ${server.origin}`);
console.log('Live remixes: one request at a time, $0.03 per request, $0.10 persistent local budget. No automatic retries.');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); await remixes.close(); process.exit(0); });
