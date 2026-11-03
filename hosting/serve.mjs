import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrokerClient } from './broker-client.mjs';
import { createCoordinator } from './coordinator.mjs';
import { isolationError } from './errors.mjs';
import { resolveOperatorGeneration } from './generation.mjs';
import { createProductionPolicy } from './policy.mjs';
import { seedVerifiedParent } from './seed-parent.mjs';
import { createHostingServer } from './server.mjs';

const hosts = (process.env.HOSTING_PUBLIC_HOSTS ?? '').split(',').map(item => item.trim()).filter(Boolean);
const origins = (process.env.HOSTING_PUBLIC_ORIGINS ?? '').split(',').map(item => item.trim()).filter(Boolean);
const proxies = (process.env.HOSTING_TRUSTED_PROXIES ?? '').split(',').map(item => item.trim()).filter(Boolean);
const inviteCodes = (process.env.HOSTING_INVITE_CODES ?? '').split(',').map(item => item.trim()).filter(Boolean);
if (hosts.length === 0 || origins.length === 0) {
  console.error('HOSTING_PUBLIC_HOSTS and HOSTING_PUBLIC_ORIGINS are required');
  process.exit(1);
}
const generation = resolveOperatorGeneration(process.env, { origins });
if (generation) {
  console.error('Hosted generation is not enabled in this build. No Standard client is constructed and no phase ledger is opened.');
  process.exit(1);
}
const directory = resolve(process.env.HOSTING_DATA_DIR ?? '/data');
if (process.env.HOSTING_PARENT_ARTIFACT) {
  try {
    const seeded = await seedVerifiedParent({
      dataDirectory: directory,
      artifactDirectory: resolve(process.env.HOSTING_PARENT_ARTIFACT),
    });
    console.log(`Seeded verified parent ${seeded.id}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
let creatorRoot = null;
if (process.env.HOSTING_CREATOR_ROOT) {
  creatorRoot = resolve(process.env.HOSTING_CREATOR_ROOT);
  try { await access(creatorRoot); }
  catch {
    console.error('HOSTING_CREATOR_ROOT does not exist');
    process.exit(1);
  }
} else {
  const bundled = fileURLToPath(new URL('../web/dist/creator', import.meta.url));
  try { await access(bundled); creatorRoot = bundled; }
  catch { creatorRoot = null; }
}
const socketPath = process.env.HOSTING_BROKER_SOCKET ?? '';
const broker = socketPath ? createBrokerClient(socketPath) : {
  async available() { return false; },
  async submit() { throw isolationError(); },
};
const policy = createProductionPolicy({ hosts, origins, trustedProxies: proxies, inviteCodes });
const coordinator = await createCoordinator({ directory, broker, client: null, releasePublished: false });
const server = await createHostingServer({ policy, coordinator, creatorRoot, port: Number(process.env.PORT ?? 8080), host: '0.0.0.0' });
console.log(`Hosting coordinator listening on ${server.origin}`);
console.log('Public generation is not configured; playback stays up and the public reserve stays unused');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await server.close(); await coordinator.close(); process.exit(0); });
}
