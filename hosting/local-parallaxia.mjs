import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createMetaClient } from '../agent/meta-client.mjs';
import { loadParallaxiaBaseline } from '../parallaxia/artifact.mjs';
import { createWorkerBroker } from './broker.mjs';
import { createCoordinator } from './coordinator.mjs';
import { SHARED_PHASE_DIRECTORY, SHARED_LEDGER_CONFIRMATION } from './constants.mjs';

/** Local operator flow. Generated source still runs only in the restricted Docker worker. */
export async function createLocalParallaxia({ directory = resolve('reports/parallaxia/live'), client = null, broker: suppliedBroker } = {}) {
  const broker = suppliedBroker ?? await createWorkerBroker();
  const coordinator = await createCoordinator({ directory, broker, client, localVerification: true,
    ledgerDirectory: SHARED_PHASE_DIRECTORY, confirmSharedLedger: SHARED_LEDGER_CONFIRMATION });
  const baseline = await loadParallaxiaBaseline();
  const component = baseline.component;
  const existing = await coordinator.parentBytes(baseline.id).catch(error => { if (error.status === 404) return null; throw error; });
  if (!existing) await coordinator.putParent({ id: baseline.id, bytes: Buffer.from(baseline.files['frame.html']), intent: baseline.intent,
    source: baseline.files['adapter.ts'], component: { id: baseline.componentId, javascript: component.javascript, contract: component.contract },
    recipient: { ...baseline.recipient, notices: baseline.files['notices.txt'] }, summary: baseline.summary });
  else if (existing.toString() !== baseline.files['frame.html']) throw Error('Immutable PARALLAXIA root changed');
  return { coordinator, baseline, async close() { await coordinator.close(); if (!suppliedBroker) await broker.close(); } };
}

export function localMetaClient(env = process.env) {
  return env.MODEL_API_KEY ? createMetaClient(env.MODEL_API_KEY) : null;
}
