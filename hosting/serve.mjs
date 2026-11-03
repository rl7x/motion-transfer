import { resolve } from 'node:path';
import { createBrokerClient } from './broker-client.mjs';
import { createCoordinator } from './coordinator.mjs';
import { isolationError } from './errors.mjs';
import { createProductionPolicy } from './policy.mjs';
import { createHostingServer } from './server.mjs';

const hosts = (process.env.HOSTING_PUBLIC_HOSTS ?? '').split(',').map(item => item.trim()).filter(Boolean);
const origins = (process.env.HOSTING_PUBLIC_ORIGINS ?? '').split(',').map(item => item.trim()).filter(Boolean);
const proxies = (process.env.HOSTING_TRUSTED_PROXIES ?? '').split(',').map(item => item.trim()).filter(Boolean);
const inviteCodes = (process.env.HOSTING_INVITE_CODES ?? '').split(',').map(item => item.trim()).filter(Boolean);
if (hosts.length === 0 || origins.length === 0) {
  console.error('HOSTING_PUBLIC_HOSTS and HOSTING_PUBLIC_ORIGINS are required');
  process.exit(1);
}
const directory = resolve(process.env.HOSTING_DATA_DIR ?? '/data');
const socketPath = process.env.HOSTING_BROKER_SOCKET ?? '';
const broker = socketPath ? createBrokerClient(socketPath) : {
  async available() { return false; },
  async submit() { throw isolationError(); },
};
const policy = createProductionPolicy({ hosts, origins, trustedProxies: proxies, inviteCodes });
const coordinator = await createCoordinator({ directory, broker, client: null, releasePublished: false });
const server = await createHostingServer({ policy, coordinator, port: Number(process.env.PORT ?? 8080), host: '0.0.0.0' });
console.log(`Hosting coordinator listening on ${server.origin}`);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await server.close(); await coordinator.close(); process.exit(0); });
}
