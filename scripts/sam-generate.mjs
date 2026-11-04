import { readFile, writeFile } from 'node:fs/promises';
import { createPhaseBudget } from '../src/campaign/phase-budget.mjs';
import { SHARED_PHASE_DIRECTORY } from '../src/hosting/constants.mjs';
import { callSam, samCostUsd, textFromStream } from '../src/footage/sam.mjs';

/*
 * Runs where the authoritative spending ledger lives, like auto-port-generate. Spends one SAM
 * request under its own reservation in the video category and writes the raw text back.
 */
const [input, output] = process.argv.slice(2);
const { id, frames, request } = JSON.parse(await readFile(input, 'utf8'));
const budget = await createPhaseBudget(SHARED_PHASE_DIRECTORY);
const cost = samCostUsd(frames);
await budget.reserve({ id, category: 'video', maxCostUsd: cost, metadata: { campaign: 'footage', frames, model: request.model } });
let settled = false;
try {
  const stream = await callSam(process.env.MODEL_API_KEY, request);
  await budget.settle({ id, estimatedCostUsd: cost, uncertain: false }); settled = true;
  await writeFile(output, JSON.stringify({ id, frames, estimatedCostUsd: cost, text: textFromStream(stream) }));
} finally {
  if (!settled) {
    await budget.settle({ id, estimatedCostUsd: cost, uncertain: true });
    await budget.reconcileBoundedUnknown({ id, reason: 'A SAM request failed without a confirmed bill; its whole ceiling stays held.' });
  }
}
