import { randomUUID } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createPhaseBudget } from '../campaign/phase-budget.mjs';

export const PUBLIC_REMIX_CEILING_USD = 0.15;
export const PHASE_BUDGET_DIRECTORY = fileURLToPath(new URL('../../reports/motion-transfer-phase/', import.meta.url));

export function generationDecision({ generate, hook, budget }) {
  if (!generate) return { allowed: false, mode: 'read-only' };
  if (!hook) {
    return { allowed: false, reject: true,
      reason: 'Generation is rejected until an orchestration hook is configured. No paid request was made.' };
  }
  if (!budget || budget.uncertain || budget.overrun) {
    return { allowed: false, reject: true,
      reason: 'Phase allowance is uncertain or exceeded a reservation. No paid request was made.' };
  }
  const remaining = budget.categories?.public?.remainingUsd ?? 0;
  if (remaining + 1e-9 < PUBLIC_REMIX_CEILING_USD) {
    return { allowed: false, reject: true,
      reason: 'Public creation allowance cannot cover a remix reservation. No paid request was made.' };
  }
  return { allowed: true, category: 'public', maxCostUsd: PUBLIC_REMIX_CEILING_USD };
}

/** Opt-in generation. A missing hook returns before any ledger is opened. */
export async function runHostedGeneration({ hook, directory = PHASE_BUDGET_DIRECTORY, budget }) {
  if (!hook) return generationDecision({ generate: true, hook: null, budget: null });
  const ledger = budget ?? await createPhaseBudget(directory);
  const decision = generationDecision({ generate: true, hook, budget: await ledger.status() });
  if (!decision.allowed) return decision;
  const id = 'public:smoke-hosted:' + randomUUID();
  const reservation = await ledger.reserve({ id, category: decision.category, maxCostUsd: decision.maxCostUsd,
    metadata: { source: 'smoke-hosted', paid: false } });
  const imported = await import(pathToFileURL(hook).href);
  if (typeof imported.run !== 'function') throw Error('Generation hook has no run function');
  try {
    const result = await imported.run({ reservation });
    if (result?.paid === true) throw Error('This release task cannot place a paid model call');
    await ledger.settle({ id, estimatedCostUsd: result?.estimatedCostUsd ?? 0, uncertain: false });
    return { allowed: true, settled: true, id };
  } catch (error) {
    await ledger.settle({ id, estimatedCostUsd: reservation.estimatedCostUsd, uncertain: true });
    throw error;
  }
}
