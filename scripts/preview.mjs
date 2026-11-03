import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { createPreviewServer } from '../web/server.mjs';
import { createLocalParallaxia, localMetaClient } from '../hosting/local-parallaxia.mjs';

try { loadEnvFile(resolve('.env')); } catch (error) { if (error.code !== 'ENOENT') throw Error('Could not load .env'); }
const local = await createLocalParallaxia({ client: localMetaClient() });
let server;
try { server = await createPreviewServer({ port: Number(process.env.PORT ?? 4173), coordinator: local.coordinator }); }
catch (error) { await local.close(); throw error; }
console.log(`Motion Transfer: ${server.origin}`);
console.log('PARALLAXIA playback reuses the accepted component. New requests require Docker isolation and Standard Meta; $0.15 maximum per whole job, including one repair, charged to the reconciled phase ledger.');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); await local.close(); process.exit(0); });
