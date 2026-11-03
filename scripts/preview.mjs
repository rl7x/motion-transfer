import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createPreviewServer } from '../web/server.mjs';
import { createLocalParallaxia, localMetaClient } from '../src/hosting/local-parallaxia.mjs';

try { loadEnvFile(resolve('.env')); } catch (error) { if (error.code !== 'ENOENT') throw Error('Could not load .env'); }
const local = await createLocalParallaxia({ client: localMetaClient() });
let server;
try { server = await createPreviewServer({ port: Number(process.env.PORT ?? 4173), coordinator: local.coordinator }); }
catch (error) { await local.close(); throw error; }
console.log(`Motion Transfer: ${server.origin}`);
console.log(existsSync(resolve('.vercel/remote-generation.json'))
  ? 'Live generation and its spending ledger are owned by Vercel. This local preview plays saved versions without creating another allowance.'
  : 'PARALLAXIA playback reuses the accepted component. New requests require Docker isolation and Standard Meta; $7 maximum per whole job, including one repair, charged to the existing reserve allocation in the reconciled $50 phase ledger.');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); await local.close(); process.exit(0); });
