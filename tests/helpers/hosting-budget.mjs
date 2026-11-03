import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { createPhaseBudget } from '../../campaign/phase-budget.mjs';

/** Isolated $50 fixtures for the $7 job envelope; never opens the shared ledger. */
export async function createHostedTestBudget(directory) {
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  const budget = await createPhaseBudget(directory);
  await budget.approveAllowanceIncrease({ maxCostUsd: 50, reason: 'Temporary hosted-generation test fixture for the authorized $7 job cap' });
  return budget;
}
