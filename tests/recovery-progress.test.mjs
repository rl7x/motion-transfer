import assert from 'node:assert/strict';
import test from 'node:test';
import { recoveryProgress, recoveryGuidance } from '../agent/recovery-progress.mjs';
import { requireInvestigationConclusion } from '../agent/investigation-completion.mjs';

test('recovery guidance describes missing work without supplying behavioral answers', () => {
  const report = { toolCalls: [], session: { recovery: {} } };
  assert.equal(recoveryProgress(report).next, 'orientation');
  assert.match(recoveryGuidance(report), /Choose scientific hypotheses, code and interventions yourself/);
  assert.doesNotMatch(recoveryGuidance(report), /dashDistance|func9|18877|cooldownTicks/);
  report.toolCalls.push({ name: 'inspect_wasm', ok: true });
  report.session.staticEvidence = [{ kind: 'function-list' }];
  assert.equal(recoveryProgress(report).next, 'code');
});

test('an accepted extraction still needs a later model action based on the actual experiment', () => {
  const experimentId = 'experiment-00000000-0000-0000-0000-000000000001';
  const result = { status: 'completed', experimentId, artifactRef: { id: 'a'.repeat(64) }, frameCount: 8,
    initialEditDifference: { edits: [{ value: 20 }] } };
  const entry = { candidateId: 'b'.repeat(64), attempt: 1, development: { passed: true }, acceptance: { passed: true } };
  const report = { requirements: { codeInspection: true, branchComparison: true, componentAcceptance: true, followupDecision: true },
    toolCalls: [{ name: 'inspect_wasm', ok: true }, { name: 'run_experiment', ok: true, requestAttempt: 2, result }],
    session: { staticEvidence: [{ kind: 'wat' }], recovery: { attempts: [entry], acceptedAttempt: 1, frozenCandidateId: entry.candidateId } } };
  const messages = [{ text: `Finite findings from ${experimentId}.` }];
  assert.throws(() => requireInvestigationConclusion(report, messages), /subsequent model action/);
  assert.equal(recoveryProgress(report).next, 'decision');
  report.toolCalls.push({ name: 'select_component_evidence', ok: true, requestAttempt: 3, args: { evidenceIds: [experimentId] } });
  assert.equal(recoveryProgress(report).next, null);
  assert.equal(requireInvestigationConclusion(report, messages), messages[0].text);
  report.session.recovery.attempts[0].acceptance.passed = false;
  assert.equal(recoveryProgress(report).milestones.at(-1).complete, false);
});
