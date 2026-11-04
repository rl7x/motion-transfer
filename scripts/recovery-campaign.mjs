import { loadEnvFile } from 'node:process';
import { stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createPhaseBudget } from '../src/campaign/phase-budget.mjs';
import { runRecoveryCampaign } from '../src/campaign/recovery-runner.mjs';

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    development: { type: 'boolean' }, out: { type: 'string' }, 'phase-ledger': { type: 'string' },
    'development-report': { type: 'string' }, model: { type: 'string' }, 'env-file': { type: 'string' }, help: { type: 'boolean' },
    protocol: { type: 'string' }, 'max-cost-usd': { type: 'string' },
  } });
  if (values.help) {
    console.log('node scripts/recovery-campaign.mjs --development --out <directory> --phase-ledger <existing-directory> [--model <id>] [--env-file <path>]');
    console.log('Frozen campaign: omit --development and pass --development-report <accepted-development-directory>. Ten predeclared Contributor trials, one at a time; a started trial is never automatically repeated.');
    console.log('This command makes paid Meta calls. It requires the existing additional-spend ledger and preserves all historical ledgers.');
    console.log('New runs default to motion-recovery-v4 with host-run freeze and acceptance. Wonder reserves at most $8 per session. --protocol motion-recovery-v2 retains the earlier development suite; --max-cost-usd <amount> can lower the ceiling. Both controls are frozen before generation.');
    return;
  }
  if (!values.out || !values['phase-ledger']) throw Error('--out and --phase-ledger are required');
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
    const campaign = await runRecoveryCampaign({ directory: resolve(values.out), phaseBudget, apiKey,
      development: Boolean(values.development), developmentReport: values['development-report'], model: values.model,
      protocolName: values.protocol, maxCostUsd: values['max-cost-usd'] === undefined ? undefined : Number(values['max-cost-usd']),
      signal: controller.signal, onProgress: console.log });
    console.log(JSON.stringify({ id: campaign.definition.id, status: campaign.status, summary: campaign.summary }));
  } finally { for (const name of ['SIGINT', 'SIGTERM']) process.removeListener(name, stop); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(String(error.message).replaceAll(process.env.MODEL_API_KEY || '\0', '[redacted]')); process.exitCode = 1;
  });
}
