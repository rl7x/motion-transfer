import { createCoordinator } from '../src/hosting/coordinator.mjs';
import { createVercelWorkerBroker } from '../src/hosting/vercel-worker-client.mjs';
import { createMetaClient } from '../src/agent/meta-client.mjs';
import { loadParallaxiaBaseline } from '../src/parallaxia/artifact.mjs';
import { createPreviewServer } from '../web/server.mjs';
import { createSandboxIngress } from '../src/hosting/vercel-proxy.mjs';
import { HOSTING_GENERATION_CONFIRMATION, SHARED_LEDGER_CONFIRMATION, SHARED_PHASE_DIRECTORY } from '../src/hosting/constants.mjs';

const broker = createVercelWorkerBroker({origin:process.env.MOTION_PUBLIC_ORIGIN,proxyKey:process.env.MOTION_PROXY_KEY});
const coordinator = await createCoordinator({ directory: 'reports/parallaxia/live', broker,
  client: process.env.MODEL_API_KEY ? createMetaClient(process.env.MODEL_API_KEY) : null,
  ledgerDirectory: SHARED_PHASE_DIRECTORY, confirmSharedLedger: SHARED_LEDGER_CONFIRMATION,
  operatorConfirmation: HOSTING_GENERATION_CONFIRMATION,
  publishedOrigin: process.env.MOTION_PUBLIC_ORIGIN, maxJobCostUsd: 5, sessionJobLimit: 2,
});
const baseline = await loadParallaxiaBaseline();
if (!await coordinator.parentBytes(baseline.id).catch(error => { if (error.status === 404) return null; throw error; })) {
  await coordinator.putParent({ id: baseline.id, bytes: Buffer.from(baseline.files['frame.html']), intent: baseline.intent,
    source: baseline.files['adapter.ts'], component: { id: baseline.componentId, javascript: baseline.component.javascript, contract: baseline.component.contract },
    recipient: { ...baseline.recipient, notices: baseline.files['notices.txt'] }, summary: baseline.summary });
}
const preview = await createPreviewServer({ port: 4173, coordinator });
const ingress = await createSandboxIngress({ previewOrigin: preview.origin, proxyKey: process.env.MOTION_PROXY_KEY });
console.log('Motion Transfer backend ready; isolated verification, two jobs per session, $5 whole-job credit cap.');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  await ingress.close(); await preview.close(); await coordinator.close(); await broker.close(); process.exit(0);
});
