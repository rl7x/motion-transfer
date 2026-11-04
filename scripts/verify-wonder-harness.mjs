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
import { verifyExhaustiveMotion } from '../src/evaluator/exhaustive.mjs';
import { validateV6Plan, v6Verification } from './wonder-harness-v6.mjs';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`);

/** Verify every recorded start, including interruption. Optional replay uses no model. */
export async function verifyWonderHarness({ replay = false, version = 'v3', planOnly = false } = {}) {
  assert.ok(['v3', 'v4', 'v5', 'v6'].includes(version));
  const root = new URL(`../assets/benchmark/wonder-harness-${version}/`, import.meta.url);
  const json = async name => JSON.parse(await readFile(new URL(name, root), 'utf8'));
  const plan = await json('plan.json'), followup = version === 'v3' ? await json('followup-plan.json') : null;
  validateRecoveryProtocol(plan.protocol);
  assert.equal(plan.protocol.name, 'motion-recovery-' + version);
  if(version==='v6')validateV6Plan(plan);
  if(planOnly){assert.equal(version,'v6');return `Wonder harness v6: frozen plan verified; ${plan.plannedTrials} planned session(s), $2.50 ceiling each. Results were not checked.`;}
  const results = await json('results.json');
  if (followup) {
    assert.equal(followup.originalPlan, plan.name);
    assert.equal(followup.protocolId, plan.protocol.id);
    assert.equal(followup.ordinal, plan.plannedTrials + 1);
  }
  assert.equal(results.protocolId, plan.protocol.id);
  assert.equal(results.trials.length, plan.plannedTrials + (followup?.plannedAdditionalTrials ?? 0));
  const identities = new Set();
  let accepted = 0, interrupted = 0, cost = 0;
  for (const [index, trial] of results.trials.entries()) {
    assert.equal(trial.ordinal, index + 1);
    if (trial.status === 'not-run') {
      assert.ok(trial.reason);
      assert.equal(trial.requests, 0);
      assert.equal(trial.estimatedCostUsd, 0);
      continue;
    }
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
      if(version==='v6'){
        assert.equal(expected.exhaustiveVerdict,attempt.exhaustive?.verdict??'not-run');
        if(attempt.development.passed)assert.equal(attempt.exhaustive?.verdict,'proved');
        if(replay&&attempt.exhaustive){
          const measured=await verifyExhaustiveMotion(attempt.candidate.source,attempt.candidate.contract.defaults,{timerFields:attempt.timerFields});
          assert.deepEqual(measured,attempt.exhaustive,`Trial ${trial.ordinal}, attempt ${attempt.attempt}: exhaustive replay`);
        }
      }
    }
    let component = recovery.attempts.find(attempt => attempt.attempt === recovery.acceptedAttempt);
    if(version==='v6'){
      const bytes=await readFile(new URL(trial.verificationFile,root));
      assert.equal(digest(bytes),trial.verificationSha256);
      const verification=v6Verification(report);
      assert.deepEqual(JSON.parse(bytes),verification);
      assert.equal(trial.exhaustiveAccepted,verification.passed);
      const recorded=report.exhaustiveVerification?.attempts??[];
      assert.deepEqual(recorded,recovery.attempts.filter(attempt=>attempt.exhaustive).map(attempt=>({attempt:attempt.attempt,candidateId:attempt.candidateId,...attempt.exhaustive})));
      if(verification.abstractionConflict)assert.equal(verification.passed,false);
      if(!verification.passed)component=undefined;
    }
    if (trial.status === 'interrupted') {
      interrupted++;
      assert.equal(component, undefined);
      if(version!=='v6'){
        assert.equal(trial.reservedCostUsd, 0, 'This interrupted session has only completed, billed requests');
        assert.ok(report.requests.every(request => request.status === 'completed'));
      }
    } else if (component?.acceptance?.passed) {
      accepted++;
      assert.ok(['delivered', 'failed'].includes(trial.status));
      assert.equal(report.status, 'completed');
      assert.equal(report.conclusionVerified, false, 'Finite checks do not certify all model interpretations');
      assert.equal(component?.candidateId, recovery.frozenCandidateId);
      assert.equal(component.development.passed, true);
      assert.equal(component.development.results.length, plan.protocol.development.caseCount);
      assert.equal(component.acceptance.passed, true);
      assert.equal(component.acceptance.results.length, plan.protocol.acceptance.caseCount);
      assert.ok(component.development.results.every(result => result.passed));
      assert.ok(component.acceptance.results.every(result => result.passed));
      if (trial.status === 'delivered') assert.equal(trial.integration.candidateId, component.candidateId);
      else assert.equal(trial.failureCategory, 'recipient-or-export');
      if (['v4', 'v5', 'v6'].includes(version)) {
        assert.equal(report.completion.actor, 'host-verifier');
        assert.equal(report.completion.candidateId, component.candidateId);
        assert.equal(report.completion.modelConclusionRequested, false);
        assert.deepEqual(report.toolCalls.slice(-2).map(call => [call.name, call.actor, call.ok]),
          [['freeze_component', 'host-verifier', true], ['accept_component', 'host-verifier', true]]);
        assert.equal(report.toolCalls.at(-1).requestAttempt, report.requests.length);
      }
      const integrationFile=version==='v6'?trial.integrationVerificationFile:trial.verificationFile;
      if (integrationFile) {
        const verificationBytes = await readFile(new URL(integrationFile, root));
        assert.equal(digest(verificationBytes), version==='v6'?trial.integrationVerificationSha256:trial.verificationSha256);
        const verification = JSON.parse(verificationBytes);
        assert.equal(verification.passed, true);
        assert.equal(verification.candidateId, component.candidateId);
        assert.equal(verification.nodeChecks.count, 3);
        assert.ok(verification.browser.results.every(result => result.passed));
      }
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
  return `Wonder harness ${version}: ${accepted} accepted, ${interrupted} interrupted, ${results.trials.filter(trial => trial.status !== 'not-run').length} starts; $${cost.toFixed(6)}${replay ? '; accepted sources replayed successfully' : ''}.`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const flags=process.argv.slice(2);
  assert.ok(flags.every(flag=>['--replay','--v3','--v4','--v5','--v6','--plan-only'].includes(flag)),'Pass flags as separate arguments');
  assert.ok(flags.filter(flag=>/^--v[3456]$/.test(flag)).length<=1,'Choose one harness version');
  console.log(await verifyWonderHarness({ replay: process.argv.includes('--replay'),
    version: process.argv.includes('--v6') ? 'v6' : process.argv.includes('--v5') ? 'v5' : process.argv.includes('--v4') ? 'v4' : 'v3', planOnly:process.argv.includes('--plan-only') }));
}
