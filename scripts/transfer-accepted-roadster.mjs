import { loadEnvFile } from 'node:process';
import { stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createPhaseBudget } from '../campaign/phase-budget.mjs';
import { transferAcceptedRoadster } from '../campaign/accepted-roadster.mjs';

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    campaign: { type: 'string' }, out: { type: 'string' }, 'phase-ledger': { type: 'string' },
    'env-file': { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('node scripts/transfer-accepted-roadster.mjs --campaign reports/motion-transfer-phase/wonder-development-001 --out reports/motion-transfer-phase/fresh-roadster-001 --phase-ledger reports/motion-transfer-phase [--env-file <path>]');
    console.log('Reads one completed frozen recovery, reserves $0.05 on the existing remix category, and requests one new Roadster adapter for that accepted component. A started generation is not retried. Uncertain charges stay reserved. Local fixtures are rejected. The command does not reset the phase ledger. Running it makes one paid Meta call.');
    return;
  }
  if (!values.campaign || !values.out || !values['phase-ledger']) throw Error('--campaign, --out, and --phase-ledger are required');
  const phaseDirectory = resolve(values['phase-ledger']);
  await stat(join(phaseDirectory, 'phase-budget.json'));
  try { loadEnvFile(resolve(values['env-file'] ?? '.env')); }
  catch (error) { if (error.code !== 'ENOENT') throw Error('Could not load the requested environment file'); }
  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey?.trim()) throw Error('MODEL_API_KEY is not set');
  const phaseBudget = await createPhaseBudget(phaseDirectory);
  const campaign = await transferAcceptedRoadster({
    campaignDirectory: resolve(values.campaign), outDirectory: resolve(values.out), phaseBudget, apiKey,
  });
  console.log(JSON.stringify({
    id: campaign.definition.id, status: campaign.status, outcome: campaign.job.outcome, summary: campaign.summary,
  }));
  if (campaign.status !== 'complete') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(String(error.message).split(process.env.MODEL_API_KEY || '\0').join('[redacted]').slice(0, 500));
    process.exitCode = 1;
  });
}
