import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest } from '../src/component/build.mjs';
import { validateRecoveryProtocol } from '../src/agent/recovery-protocol.mjs';
import { evaluateRecoveryMotion as evaluateMotion } from '../src/evaluator/recovery-motion.mjs';
import { acceptanceCases } from '../src/evaluator/cases.mjs';
import { RECOVERY_DEVELOPMENT_CASES } from '../src/evaluator/recovery-cases.mjs';

const root = new URL('../assets/benchmark/wonder-harness-v3/', import.meta.url);
const json = async name => JSON.parse(await readFile(new URL(name, root), 'utf8'));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`);

/** Verify every recorded start, including interruption. Optional replay uses no model. */
export async function verifyWonderHarness({ replay = false } = {}) {
  const plan = await json('plan.json'), followup = await json('followup-plan.json'), results = await json('results.json');
  validateRecoveryProtocol(plan.protocol);
  assert.equal(plan.protocol.name, 'motion-recovery-v3');
  assert.equal(followup.originalPlan, plan.name);
  assert.equal(followup.protocolId, plan.protocol.id);
  assert.equal(results.protocolId, plan.protocol.id);
  assert.equal(results.trials.length, plan.plannedTrials + followup.plannedAdditionalTrials);
  assert.equal(followup.ordinal, plan.plannedTrials + 1);
  const identities = new Set();
  let accepted = 0, interrupted = 0, cost = 0;
  for (const [index, trial] of results.trials.entries()) {
    assert.equal(trial.ordinal, index + 1);
    assert.equal(trial.reportFile, `report-${trial.ordinal}.json.gz`);
    const bytes = gunzipSync(await readFile(new URL(trial.reportFile, root)));
    assert.equal(digest(bytes), trial.reportSha256, 'Exact saved report identity');
    const report = JSON.parse(bytes);
    assert.equal(report.model, plan.model);
    assert.notEqual(report.origin, 'local-verification');
    assert.deepEqual(report.recoveryProtocol, plan.protocol);
    assert.deepEqual(report.session.recovery.protocol, plan.protocol);
    assert.equal(report.session.id, trial.sessionId);
    assert.ok(!identities.has(trial.sessionId), 'Every start uses a fresh session');
    identities.add(trial.sessionId);
    assert.ok(Date.parse(index < plan.plannedTrials ? plan.createdAt : followup.createdAt) <= Date.parse(report.startedAt));
    assert.equal(report.requests.length, trial.requests);
    near(report.estimatedCostUsd, trial.estimatedCostUsd);
    near(report.requests.reduce((sum, request) => sum + (request.estimatedCostUsd ?? 0), 0), trial.estimatedCostUsd);
    assert.equal(report.reservedCostUsd, trial.reservedCostUsd);
    assert.ok(trial.estimatedCostUsd <= plan.protocol.limits.maxCostUsd);
    cost += trial.estimatedCostUsd;
    const recovery = report.session.recovery;
    assert.equal(recovery.attempts.length, trial.attempts.length);
    for (const [attemptIndex, attempt] of recovery.attempts.entries()) {
      const expected = trial.attempts[attemptIndex];
      assert.equal(attempt.sourceSha256, digest(attempt.candidate.source));
      assert.equal(attempt.candidateId, digest(JSON.stringify({ candidate: attempt.candidate, timerFields: attempt.timerFields })));
      assert.equal(expected.candidateId, attempt.candidateId);
      assert.equal(expected.developmentPassed, attempt.development.results?.filter(result => result.passed).length ?? 0);
      assert.equal(expected.acceptancePassed, attempt.acceptance?.results?.filter(result => result.passed).length ?? null);
    }
    const component = recovery.attempts.find(attempt => attempt.attempt === recovery.acceptedAttempt);
    if (trial.status === 'interrupted') {
      interrupted++;
      assert.equal(component, undefined);
      assert.equal(trial.reservedCostUsd, 0, 'This interrupted session has only completed, billed requests');
      assert.ok(report.requests.every(request => request.status === 'completed'));
    } else if (trial.status === 'delivered') {
      accepted++;
      assert.equal(report.status, 'completed');
      assert.equal(report.conclusionVerified, false, 'Finite checks do not certify all model interpretations');
      assert.equal(component?.candidateId, recovery.frozenCandidateId);
      assert.equal(component.development.passed, true);
      assert.equal(component.development.results.length, plan.protocol.development.caseCount);
      assert.equal(component.acceptance.passed, true);
      assert.equal(component.acceptance.results.length, plan.protocol.acceptance.caseCount);
      assert.ok(component.development.results.every(result => result.passed));
      assert.ok(component.acceptance.results.every(result => result.passed));
      assert.equal(trial.integration.candidateId, component.candidateId);
      if (replay) {
        for (const [suite, cases] of [['development', RECOVERY_DEVELOPMENT_CASES],
          ['acceptance', acceptanceCases(recovery.acceptanceSeed, plan.protocol.acceptance.caseCount)]]) {
          const measured = await evaluateMotion(component.candidate.source, component.candidate.contract.defaults, cases,
            { suite, timerFields: component.timerFields });
          assert.equal(measured.passed, true, `Trial ${trial.ordinal} ${suite}: ${JSON.stringify(measured.results.filter(result => !result.passed))}`);
        }
      }
    } else {
      assert.equal(trial.status, 'failed');
      assert.equal(component, undefined);
    }
  }
  assert.equal(results.accepted, accepted);
  assert.equal(results.interrupted, interrupted);
  near(results.estimatedCostUsd, cost);
  return `Wonder harness v3: ${accepted} accepted, ${interrupted} interrupted, ${results.trials.length} starts; $${cost.toFixed(6)}${replay ? '; accepted sources replayed successfully' : ''}.`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(await verifyWonderHarness({ replay: process.argv.includes('--replay') }));
}
