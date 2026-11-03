import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRecoveryEvidence, recoveryCitationRequirements } from '../src/agent/recovery-evidence.mjs';

function fixture() {
  const trials = [1, 2, 3].map(index => ({ name: 'run_experiment', ok: true, requestAttempt: index,
    result: { status: 'completed', experimentId: `experiment-${index}`, artifactRef: { id: String(index).repeat(64) },
      initialEditDifference: { edits: index === 3 ? [] : [{ value: 40 }] }, frameCount: 8 } }));
  const evidence = { functions: [{ id: 'binary:func9', functionIndex: 9 }],
    traces: trials.map(call => ({ id: call.result.experimentId })) };
  return { toolCalls: [...trials, { name: 'select_component_evidence', ok: true, requestAttempt: 4, result: { selectionId: 'selection-1' } }],
    session: { staticEvidence: [{ kind: 'wat', functionIndex: 9 }], recovery: { selections: [{ id: 'selection-1', evidence }] } } };
}
const submission = evidence => ({ selectionId: 'selection-1', contract: { rules: [{ evidence }] } });

test('a contract can cite any selected controlled experiment, not just the first', () => {
  const report = fixture();
  const checked = validateRecoveryEvidence(report, submission(['binary:func9', 'experiment-2']), 5);
  assert.equal(checked.experimentId, 'experiment-2');
  assert.equal(checked.selectionRequestAttempt, 4);
  const requirements = recoveryCitationRequirements(report, 'selection-1');
  assert.deepEqual(requirements.controlledExperimentIds, ['experiment-1', 'experiment-2']);
  assert.ok(requirements.allowedEvidenceIds.includes('experiment-3'));
});

test('citation feedback preserves evidence requirements and never replaces missing code or interventions', () => {
  const report = fixture();
  for (const citations of [['binary:func9', 'experiment-3'], ['experiment-2'], ['binary:func9', 'invented-id']]) {
    assert.throws(() => validateRecoveryEvidence(report, submission(citations), 5), error => {
      assert.match(error.message, /must cite both/);
      assert.deepEqual(error.inputFeedback.inspectedCodeIds, ['binary:func9']);
      assert.deepEqual(error.inputFeedback.controlledExperimentIds, ['experiment-1', 'experiment-2']);
      return true;
    });
  }
  report.toolCalls.at(-1).requestAttempt = 1;
  assert.throws(() => validateRecoveryEvidence(report, submission(['binary:func9', 'experiment-1']), 5), /later model turn/);
  report.toolCalls.at(-1).requestAttempt = 4;
  report.session.staticEvidence = [];
  assert.throws(() => validateRecoveryEvidence(report, submission(['binary:func9', 'experiment-1']), 5), /actual body inspection/);
});
