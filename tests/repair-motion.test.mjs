import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMotionPatch, repairMotion } from '../agent/repair-motion.mjs';
import { RECOVERY_LIMITS } from '../agent/recover-motion.mjs';

const candidate = {
  source: '// faulty marker\nexport const init=()=>({}); export const step=(state)=>({state,output:{ownsMotion:false,displacement:{x:0,y:0},events:[]}});',
  contract: {
    name: 'Mock repair fixture', scope: 'Unit test only',
    defaults: { walkingSpeed: 2, dashDistance: 60, cooldownTicks: 25, initialCooldownTicks: 10 },
    stateDescription: 'Empty fixture', rules: [{ description: 'Faulty fixture rule', evidence: ['binary:func9'] }],
    limitations: ['Not a recovered controller'],
  },
};
const edits = {
  sourceEdits: [{ old: '// faulty marker', new: '// repaired marker' }],
  ruleEdits: [{ old: 'Faulty fixture rule', new: 'Corrected fixture rule' }],
};
const evidence = { sha256: 'e'.repeat(64), cartridgeSha256: 'd'.repeat(64),
  functions: [{ id: 'binary:func9', functionIndex: 9, text: 'compiled fixture' }], traces: [],
};
function failedParent() {
  return {
    status: 'failed', model: 'muse-wonder-1.0', limits: { ...RECOVERY_LIMITS },
    evidenceSha256: evidence.sha256, cartridgeSha256: evidence.cartridgeSha256,
    estimatedCostUsd: 0.277728, reservedCostUsd: 0, humanAssistance: [], acceptanceSeed: 12345,
    requests: [
      { status: 'completed', usage: { inputTokens: 11762, outputTokens: 6000, cachedInputTokens: 0 } },
      { status: 'completed', usage: { inputTokens: 11800, outputTokens: 3174, cachedInputTokens: 0 } },
    ],
    attempts: [{ attempt: 2, candidate, development: { passed: true }, acceptance: { passed: false } }],
  };
}

test('motion patches require exact unique anchors and leave the parent untouched', () => {
  const result = applyMotionPatch(candidate, edits);
  assert.match(result.source, /repaired marker/);
  assert.equal(result.contract.rules[0].description, 'Corrected fixture rule');
  assert.match(candidate.source, /faulty marker/);
  assert.throws(() => applyMotionPatch(candidate, { ...edits, path: '.env' }), /fields/);
  assert.throws(() => applyMotionPatch(candidate, { ...edits, sourceEdits: [{ old: 'missing', new: 'x' }] }), /exactly once/);
  assert.throws(() => applyMotionPatch({ ...candidate, source: candidate.source + '\n// faulty marker' }, edits), /exactly once/);
});

test('focused repair carries all costs and turns old acceptance into regressions before a fresh suite', async () => {
  const evaluated = [];
  let calls = 0;
  const report = await repairMotion({ parent: failedParent(), evidence, seed: () => 54321,
    client: {
      countInputTokens: async () => 1000,
      respond: async request => {
        calls++;
        assert.equal(request.model, 'muse-spark-1.3');
        assert.doesNotMatch(JSON.stringify(request.input), /acceptance-\d/);
        return { id: 'spark-patch', status: 'completed', usage: { input_tokens: 1000, output_tokens: 100 },
          output: [{ type: 'function_call', name: 'submit_motion_patch', arguments: JSON.stringify(edits) }] };
      },
    },
    evaluate: async (source, config, cases, options) => {
      evaluated.push([options.suite, cases.length]);
      return { passed: true, suite: options.suite };
    },
  });
  assert.equal(calls, 1);
  assert.equal(report.status, 'accepted');
  assert.equal(report.acceptedAttempt, 3);
  assert.equal(report.acceptanceSeed, 54321);
  assert.deepEqual(evaluated, [['development', 12], ['regression-from-prior-acceptance', 21], ['acceptance', 20]]);
  assert.ok(Math.abs(report.estimatedCostUsd - 0.279403) < 1e-9);
  assert.equal(report.attempts[0].acceptance.passed, false);
  assert.equal(report.requests[0].model, 'muse-wonder-1.0');
  assert.equal(report.requests[2].model, 'muse-spark-1.3');
  assert.equal(report.reservedCostUsd, 0);
});

test('focused repair refuses insufficient remaining funds or ambiguous parent charges', async () => {
  let calls = 0;
  const client = { countInputTokens: async () => 1000, respond: async () => { calls++; } };
  const parent = failedParent(); parent.limits.maxCostUsd = 0.28;
  await assert.rejects(repairMotion({ parent, evidence, client }), /Remaining recovery budget/);
  assert.equal(calls, 0);
  await assert.rejects(repairMotion({ parent: { ...failedParent(), reservedCostUsd: 0.01 }, evidence, client }), /settled/);
  await assert.rejects(repairMotion({ parent: { ...failedParent(), repairExtension: {} }, evidence, client }), /settled/);
});
