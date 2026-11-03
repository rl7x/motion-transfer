import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { experimentFeedback } from '../src/agent/experiment-feedback.mjs';
import { validateRecoveryEvidence } from '../src/agent/recovery-evidence.mjs';

test('actual saved traces expose activity before an inactive endpoint without changing the evidence', async () => {
  const { report } = JSON.parse(await readFile(new URL('../assets/lab/recordings/recovery-handoff.json', import.meta.url)));
  const before = JSON.stringify(report.session.experimentWorkbench.artifacts);
  const trial = report.toolCalls.find(call => call.name === 'run_experiment' && call.args.interventions.length);
  const result = experimentFeedback(trial.name, trial.result, report.session);
  assert.equal(result.final.intervention.ownsMotion, false);
  assert.equal(result.activity[0].intervention.activeUpdates, 8);
  assert.equal(result.activity[0].control.activeUpdates, 0);
  assert.deepEqual(result.activity[0].intervention.eventFrames, [{ elapsedFrame: 8, events: ['dash-end'] }]);
  assert.equal(result.activity[0].comparisonKind, 'typed-intervention');
  const control = report.toolCalls.find(call => call.name === 'run_experiment' && !call.args.interventions.length);
  assert.equal(experimentFeedback(control.name, control.result, report.session).activity[0].comparisonKind, 'identical-input-reproducibility-control');
  assert.equal(JSON.stringify(report.session.experimentWorkbench.artifacts), before);
  const artifact = report.session.experimentWorkbench.artifacts.find(item => item.id === trial.result.artifactRef.id);
  artifact.payload.trace[0].control.normalized.dx++;
  assert.throws(() => experimentFeedback(trial.name, trial.result, report.session), /integrity mismatch/);
});

test('uninvoked helper and nonexistent SDK method receive mechanical help without scientific answers', async () => {
  const { report } = JSON.parse(await readFile(new URL('../assets/lab/recordings/recovery-handoff.json', import.meta.url)));
  for (const call of report.toolCalls.filter(call => call.name === 'run_experiment_program' && call.result)) {
    const result = experimentFeedback(call.name, call.result, report.session);
    assert.equal(result.operations, 0); assert.equal(result.executionFeedback.didExecuteCapabilities, false);
    assert.match(result.executionFeedback.message, /sdk.static.inspectWasm/);
    assert.doesNotMatch(result.executionFeedback.message, /cooldownTicks|dashDistance|22441|func9/);
    assert.equal(result.status, call.result.status);
  }
});

test('recovery contracts need inspected code and actual experiment citations selected in a later model turn', () => {
  const result = { experimentId: 'experiment-fixture', artifactRef: { id: 'a'.repeat(64) }, status: 'completed', frameCount: 8, initialEditDifference: { edits: [{}] } };
  const selection = { id: 'selection-1', evidence: { functions: [{ id: 'binary:func9', functionIndex: 9 }], traces: [{ id: result.experimentId }] } };
  const report = { toolCalls: [{ name: 'run_experiment', ok: true, requestAttempt: 2, result },
    { name: 'select_component_evidence', ok: true, requestAttempt: 3, result: { selectionId: selection.id } }],
    session: { staticEvidence: [{ kind: 'wat', functionIndex: 9 }], recovery: { selections: [selection] } } };
  const args = { selectionId: selection.id, contract: { rules: [{ evidence: ['binary:func9', result.experimentId] }] } };
  assert.equal(validateRecoveryEvidence(report, args, 4).experimentId, result.experimentId);
  assert.throws(() => validateRecoveryEvidence(report, { ...args, contract: { rules: [{ evidence: ['binary:func9'] }] } }, 4), /both selected/);
  report.toolCalls[1].requestAttempt = 2;
  assert.throws(() => validateRecoveryEvidence(report, args, 4), /later model turn/);
});
