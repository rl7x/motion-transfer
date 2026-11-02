import assert from 'node:assert/strict';
import test from 'node:test';
import { requireInvestigationConclusion } from '../agent/investigation-completion.mjs';

const experimentId = 'experiment-00000000-0000-0000-0000-000000000001';
const artifactId = 'a'.repeat(64);
const messages = [{ text: `${experimentId} measured a difference under this intervention; scope is finite.` }];
function fixture() {
  return {
    requirements: { branchComparison: true, codeInspection: true, followupDecision: true },
    toolCalls: [
      { name: 'inspect_wasm', ok: true, requestAttempt: 1 },
      { name: 'run_experiment_program', ok: true, requestAttempt: 2, result: { experiments: [{
        experimentId, artifactRef: { id: artifactId }, status: 'completed',
        initialEditDifference: { edits: [{ address: 18877, type: 'f32', value: 20 }] }, frameCount: 8,
      }] } },
      { name: 'read_experiment', ok: true, requestAttempt: 3, args: { experimentId } },
    ],
    session: { staticEvidence: [{ kind: 'wat', id: 'binary:func9' }], recovery: {} },
  };
}

test('completion requires body inspection and a later decision citing the actual managed evidence', () => {
  const report = fixture();
  assert.equal(requireInvestigationConclusion(report, messages), messages[0].text);
  report.session.staticEvidence = [{ kind: 'function-list' }];
  report.toolCalls.push({ name: 'list_functions', ok: true, requestAttempt: 4 });
  assert.throws(() => requireInvestigationConclusion(report, messages), /actual code inspection/);
  report.session.staticEvidence = [{ kind: 'writer-trace' }];
  const followup = report.toolCalls[2];
  for (const requestAttempt of [undefined, 1, 2]) {
    followup.requestAttempt = requestAttempt;
    assert.throws(() => requireInvestigationConclusion(report, messages), /subsequent model action/);
  }
  followup.requestAttempt = 3; followup.args = { experimentId: 'unknown-evidence' };
  assert.throws(() => requireInvestigationConclusion(report, messages), /subsequent model action/);
  followup.args = { artifactId };
  assert.equal(requireInvestigationConclusion(report, messages), messages[0].text);
});

test('freeze alone cannot satisfy separate component acceptance and an uncited trial cannot support completion', () => {
  const report = fixture();
  report.requirements.componentAcceptance = true;
  report.session.recovery.frozenCandidateId = 'frozen-fixture';
  assert.throws(() => requireInvestigationConclusion(report, messages), /separate acceptance/);
  report.session.recovery.acceptedAttempt = 1;
  assert.equal(requireInvestigationConclusion(report, messages), messages[0].text);
  assert.throws(() => requireInvestigationConclusion(report, [{ text: 'A conclusion without its experiment citation.' }]), /contrasting, cited experiments/);
  assert.equal(report.session.recovery.frozenCandidateId, 'frozen-fixture');
});
