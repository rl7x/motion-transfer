import { digest } from '../component/build.mjs';

export const CAMPAIGN_LIMIT_USD = 2;
export const MAX_RECOVERY_TRIALS = 3;
export const TASKS = [
  { id: 'recovery', name: 'Recover and export to JUJUMP', kind: 'binary-recovery', maxCostUsd: 0.50,
    request: 'Recover the compiled donor movement component, preserve its supported dash timing, and deliver an independently checked JUJUMP project retaining native gravity and landing.',
    success: ['actual-body-inspection', 'controlled-intervention', 'later-evidence-selection', 'development-pass', 'freeze', 'separate-acceptance', 'recipient-checks', 'independent-zip-checks'] },
  { id: 'roadster', name: 'Change the Roadster air dash', kind: 'adapter-edit', maxCostUsd: 0.05,
    request: 'Make the air dash go backward, travel exactly 3 meters, and require a fresh press. Preserve the frozen controller and native physics.',
    expectedIntent: { unitScale: 0.05, activation: 'press', direction: 'opposite' } },
  { id: 'paku-lineage', name: 'Preserve changes across a second PAKU edit', kind: 'iterative-adapter-edit', maxCostUsd: 0.06,
    stages: [
      { id: 'paku-first', request: 'Make the dash go backward and require a fresh press. Keep its current 30-pixel distance.',
        expectedIntent: { unitScale: 0.5, activation: 'press', direction: 'opposite' } },
      { id: 'paku-final', request: 'Shorten the dash to exactly 15 pixels. Keep the backward direction and fresh-press activation from this parent.',
        expectedIntent: { unitScale: 0.25, activation: 'press', direction: 'opposite' } },
    ] },
];

export function benchmarkDefinition(snapshot, { id, origin = 'fresh-meta', setup = null, createdAt = new Date().toISOString() }) {
  const definition = { schemaVersion: 1, id, origin, createdAt, additionalLimitUsd: CAMPAIGN_LIMIT_USD,
    maxRecoveryTrials: MAX_RECOVERY_TRIALS, tasks: TASKS, snapshot, observedSetup: setup,
    historicalSetup: { elapsedMinutes: null, supplied: ['registered donor and controls', 'human-mapped motion fields', 'motion ABI and finite evaluators', 'recipient adapters and host hooks'] },
    scope: 'Self-run evaluation of three prepared developer tasks. Only the first is a fresh binary recovery. Adapter tasks use the existing accepted component. No baseline productivity, adoption or time-saving claim.' };
  return { ...definition, sha256: digest(JSON.stringify(definition)) };
}

export function stageDefinition(stage) {
  return TASKS.find(task => task.id === stage) ?? TASKS[2].stages.find(item => item.id === stage);
}
