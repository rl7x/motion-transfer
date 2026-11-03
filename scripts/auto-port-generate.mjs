import { readFile, writeFile } from 'node:fs/promises';
import { PRICES, readUsage, tokenCost } from '../src/agent/accounting.mjs';
import { createMetaClient } from '../src/agent/meta-client.mjs';
import { createPhaseBudget } from '../src/campaign/phase-budget.mjs';
import { SHARED_PHASE_DIRECTORY } from '../src/hosting/constants.mjs';

/*
 * Runs where the authoritative spending ledger lives, so a campaign never forks the allowance.
 * Reads one prepared request, spends under its own reservation, and writes the raw response.
 */
const [input, output] = process.argv.slice(2);
const { id, game, attempt, maxCostUsd, request, dryRun } = JSON.parse(await readFile(input, 'utf8'));
const budget = await createPhaseBudget(SHARED_PHASE_DIRECTORY);
if (dryRun) {
  const { categories, remainingUsd } = await budget.status();
  console.log(JSON.stringify({ dryRun: true, key: Boolean(process.env.MODEL_API_KEY), remainingUsd, reserve: categories.reserve, wonder: categories.wonder }));
  process.exit(0);
}
const client = createMetaClient(process.env.MODEL_API_KEY, { requestTimeoutMs: 170_000 });
const price = PRICES[request.model];
await budget.reserve({ id, category: 'reserve', maxCostUsd, metadata: { campaign: 'auto-port', game, attempt, model: request.model } });
let cost = 0, settled = false;
try {
  const inputTokens = await client.countInputTokens(request);
  const ceiling = (inputTokens * price.input + request.max_output_tokens * price.output) / 1e6;
  if (ceiling > maxCostUsd) {
    await budget.settle({ id, estimatedCostUsd: 0, uncertain: false }); settled = true;
    throw Error(`This request could cost $${ceiling.toFixed(4)}, above its $${maxCostUsd} ceiling; nothing was sent`);
  }
  const startedAt = new Date().toISOString();
  const response = await client.respond(request);
  cost = tokenCost(readUsage(response.usage), price);
  const uncertain = response.status !== 'completed' || cost > maxCostUsd;
  await budget.settle({ id, estimatedCostUsd: cost, uncertain }); settled = true;
  if (uncertain) await budget.reconcileBoundedUnknown({ id, reason: 'Auto-port campaign response incomplete; the full reservation stays held.' });
  await writeFile(output, JSON.stringify({ id, game, attempt, inputTokens, startedAt, finishedAt: new Date().toISOString(), estimatedCostUsd: cost, response }));
} finally {
  // An unsettled call may have billed. Keep its whole ceiling held so public remixes are not blocked.
  if (!settled) {
    await budget.settle({ id, estimatedCostUsd: cost, uncertain: true });
    await budget.reconcileBoundedUnknown({ id, reason: 'Auto-port campaign call failed; the full reservation stays held.' });
  }
}
