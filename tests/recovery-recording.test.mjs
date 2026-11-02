import assert from 'node:assert/strict';
import test from 'node:test';
import { savedInvestigations } from '../lab/saved.mjs';

test('the single live recovery remains incomplete despite its real intervention and later finding', async () => {
  const { job } = (await savedInvestigations()).find(record => record.id === 'recovery-handoff');
  assert.equal(job.id, '5e570dca-e9aa-4b69-9d65-74d69bcc6e5f');
  assert.equal(job.status, 'failed'); assert.equal(job.task.status, 'recovery-incomplete');
  assert.equal(job.report.requests.length, 16); assert.equal(job.report.estimatedCostUsd, 0.26616675);
  assert.equal(job.report.reservedCostUsd, 0); assert.equal(job.task.integration, null);
  assert.equal(job.report.session.recovery.attempts.length, 0);
  assert.equal(job.task.milestones.find(item => item.id === 'code').complete, false);
  assert.equal(job.task.milestones.find(item => item.id === 'decision').complete, true);
  const trial = job.report.toolCalls.find(call => call.name === 'run_experiment' && call.args.interventions.length);
  assert.equal(trial.result.initialEditDifference.edits[0].address, 22441);
  assert.equal(trial.result.initialEditDifference.edits[0].frame, 30);
  assert.equal(trial.result.final.control.dx, 40); assert.equal(trial.result.final.intervention.dx, 84);
  assert.equal(trial.result.firstBehavioralDivergence.elapsedFrame, 1);
  const finding = job.report.toolCalls.find(call => call.name === 'record_finding');
  assert.ok(finding.requestAttempt > trial.requestAttempt);
  assert.ok(finding.args.evidenceIds.includes(trial.result.experimentId));
  const programs = job.report.session.experimentWorkbench.programs;
  assert.equal(programs[0].operations.length, 0); assert.equal(programs[0].output, null);
  assert.match(programs[1].error, /not a function/);
});

test('the stage-guided trial preserves candidate failures and never claims an accepted project', async () => {
  const { job } = (await savedInvestigations()).find(record => record.id === 'stage-guided-recovery');
  assert.equal(job.id, 'dec3cd86-cbbe-48dd-8e73-36b6ad79db44');
  assert.equal(job.status, 'failed'); assert.equal(job.task.integration, null);
  assert.equal(job.report.estimatedCostUsd, 0.312026); assert.equal(job.report.reservedCostUsd, 0);
  assert.deepEqual(job.task.development.map(item => item.passedChecks), [0, 9, 10]);
  assert.equal(job.report.session.recovery.acceptedAttempt, undefined);
  assert.equal(job.report.toolCalls.filter(call => call.name === 'submit_component_candidate' && call.ok).length, 3);
});
