import { loadEnvFile } from 'node:process';
import { stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createPhaseBudget } from '../src/campaign/phase-budget.mjs';
import { SHARED_PHASE_LEDGER, runVideoCandidate } from '../src/campaign/video-candidate.mjs';

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    out: { type: 'string' }, 'phase-ledger': { type: 'string', default: SHARED_PHASE_LEDGER },
    'env-file': { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('node scripts/video-candidate.mjs --out <directory> --phase-ledger reports/motion-transfer-phase [--env-file <path>]');
    console.log('Renders donor media if needed, reserves the shared video category, then sends one Muse Spark 1.3 Standard sampling probe and one candidate request.');
    console.log('Probe cap $0.40. Candidate cap $1.50. Inline video data URLs. A contact sheet is image input only when the probe cannot localize the sprite.');
    console.log('An accepted candidate is frozen as video or contact-sheet, with the supplied public-contract defaults, beside the existing saved recovery. The saved source is not sent to the provider. Started calls are not retried, and neither candidate is scored or repaired. This command makes paid Meta calls.');
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
    const campaign = await runVideoCandidate({ directory: resolve(values.out), phaseBudget, apiKey, signal: controller.signal, onProgress: console.log });
    console.log(JSON.stringify({ id: campaign.definition.id, status: campaign.status, summary: campaign.summary }));
  } finally { for (const name of ['SIGINT', 'SIGTERM']) process.removeListener(name, stop); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(String(error.message).split(process.env.MODEL_API_KEY || '\0').join('[redacted]').slice(0, 500));
    process.exitCode = 1;
  });
}
