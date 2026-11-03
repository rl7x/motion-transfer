import { VERIFIER_IMAGE } from './constants.mjs';
import { createWorkerBroker } from './broker.mjs';

const socketPath = process.env.HOSTING_BROKER_SOCKET;
const image = process.env.HOSTING_VERIFIER_IMAGE ?? VERIFIER_IMAGE;
if (!socketPath) {
  console.error('HOSTING_BROKER_SOCKET is required');
  process.exit(1);
}
const broker = await createWorkerBroker({ image, socketPath });
console.log(`Host broker listening for typed jobs on ${socketPath}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await broker.close(); process.exit(0); });
