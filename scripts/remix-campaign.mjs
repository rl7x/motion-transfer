import { loadEnvFile } from 'node:process';
import { stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createPhaseBudget } from '../campaign/phase-budget.mjs';
import { SHARED_PHASE_LEDGER, runRemixCampaign } from '../campaign/remix-campaign.mjs';
import { loadSavedRoadster } from '../roadster/saved.mjs';

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    out: { type: 'string' }, 'phase-ledger': { type: 'string', default: SHARED_PHASE_LEDGER },
    'env-file': { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('node scripts/remix-campaign.mjs --out <directory> --phase-ledger reports/motion-transfer-phase [--env-file <path>]');
    console.log('Runs the frozen six-prompt Roadster remix set plus the flight and no-op negatives. Each call reserves $0.05 on the shared remix category before generation.');
    console.log('A matched result is published under <out>/published/artifacts with its frame, notices, source, verification, and generation record. Mismatches stay unpublished. A started prompt is not retried. This command makes paid Meta calls.');
    return;
  }
  if (!values.out) throw Error('--out is required');
  const phaseDirectory = resolve(values['phase-ledger']);
  await stat(join(phaseDirectory, 'phase-budget.json'));
  try { loadEnvFile(resolve(values['env-file'] ?? '.env')); }
  catch (error) { if (error.code !== 'ENOENT') throw Error('Could not load the requested environment file'); }
  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey?.trim()) throw Error('MODEL_API_KEY is not set');
  const phaseBudget = await createPhaseBudget(phaseDirectory), controller = new AbortController();
  const stop = () => controller.abort();
  for (const name of ['SIGINT', 'SIGTERM']) process.once(name, stop);
  try {
    const campaign = await runRemixCampaign({ directory: resolve(values.out), phaseBudget, apiKey, parent: await loadSavedRoadster(),
      signal: controller.signal, onProgress: console.log });
    console.log(JSON.stringify({ id: campaign.definition.id, status: campaign.status, summary: campaign.summary }));
  } finally { for (const name of ['SIGINT', 'SIGTERM']) process.removeListener(name, stop); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(String(error.message).split(process.env.MODEL_API_KEY || '\0').join('[redacted]').slice(0, 500));
    process.exitCode = 1;
  });
}
