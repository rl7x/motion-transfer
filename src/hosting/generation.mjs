import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createPhaseBudget } from '../campaign/phase-budget.mjs';
import {
  HOSTING_GENERATION_CONFIRMATION, PUBLIC_MODEL, REMIX_MAX_COST_USD, SHARED_LEDGER_CONFIRMATION, SHARED_PHASE_DIRECTORY,
} from './constants.mjs';

/** Operator env for a later enablement. An empty env stays playback-only and opens nothing. */
export function resolveOperatorGeneration(env, { origins = [] } = {}) {
  const confirmation = env.HOSTING_GENERATION_CONFIRMATION ?? '';
  const ledger = env.HOSTING_PHASE_LEDGER ?? '';
  const origin = env.HOSTING_PUBLISHED_ORIGIN ?? '';
  const shared = env.HOSTING_SHARED_LEDGER_CONFIRMATION ?? '';
  if (confirmation === '' && ledger === '' && origin === '' && shared === '' && (env.HOSTING_STANDARD_CLIENT ?? '') === '') return null;
  if (confirmation !== HOSTING_GENERATION_CONFIRMATION) throw Error('Hosted generation confirmation is required');
  if (!ledger) throw Error('An explicit phase ledger path is required');
  if (!origin || !origins.includes(origin) || origin.includes('localhost') || origin.includes('127.0.0.1')) {
    throw Error('Published origin was not confirmed');
  }
  if (env.HOSTING_STANDARD_CLIENT !== 'operator') throw Error('A Standard client must be supplied by the operator');
  if (shared !== SHARED_LEDGER_CONFIRMATION) throw Error('Shared public reserve was not confirmed');
  const ledgerDirectory = resolve(ledger);
  if (ledgerDirectory !== resolve(SHARED_PHASE_DIRECTORY)) throw Error('Hosted generation requires the existing shared phase ledger');
  return {
    ledgerDirectory, origin, model: PUBLIC_MODEL, maxCostUsd: REMIX_MAX_COST_USD, confirmSharedLedger: shared,
  };
}

/** Opens a ledger that already exists. A missing file is an error, never a new journal. */
export async function openExistingPhaseLedger(directory, { confirmSharedLedger } = {}) {
  if (!directory || typeof directory !== 'string') throw Error('An explicit phase ledger path is required');
  const root = resolve(directory);
  if (root === resolve(SHARED_PHASE_DIRECTORY) && confirmSharedLedger !== SHARED_LEDGER_CONFIRMATION) throw Error('Shared public reserve was not confirmed');
  const path = join(root, 'phase-budget.json');
  try { await access(path); }
  catch (error) {
    if (error.code === 'ENOENT') throw Error('Phase ledger is missing');
    throw error;
  }
  return createPhaseBudget(root);
}
