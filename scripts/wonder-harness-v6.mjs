import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from '../src/component/build.mjs';
import { validateRecoveryProtocol } from '../src/agent/recovery-protocol.mjs';

/** Read-only accounting; never migrates, reallocates, settles or creates a ledger. */
export function workingBudgetSnapshot(bytes, since) {
  assert.ok(Number.isFinite(Date.parse(since)), 'A working-limit start time is required');
  const { integritySha256, ...ledger } = JSON.parse(bytes);
  assert.equal(digest(JSON.stringify(ledger)), integritySha256, 'Cloud ledger integrity mismatch');
  const held = entry => ['reserved', 'uncertain', 'bounded-unknown'].includes(entry.status)
    ? Math.max(0, entry.maxCostUsd - entry.estimatedCostUsd) : 0;
  const total = entries => entries.reduce((sum, entry) => sum + entry.estimatedCostUsd + held(entry), 0);
  const recent = ledger.reservations.filter(entry => Date.parse(entry.createdAt) >= Date.parse(since));
  return { ledgerSha256: digest(bytes), since, workingLimitUsd: 5, usedUsd: total(recent),
    remainingUsd: Math.max(0, 5 - total(recent)),
    cloudRemainingUsd: ledger.definition.maxCostUsd - total(ledger.reservations),
    wonderRemainingUsd: ledger.definition.allocations.wonder - total(ledger.reservations.filter(entry => entry.category === 'wonder')),
    uncertain: ledger.reservations.some(entry => ['reserved', 'uncertain', 'overrun'].includes(entry.status)),
    countedReservations: recent.map(entry => entry.id) };
}

export function validateV6Plan(plan) {
  assert.equal(plan.schemaVersion, 1);
  assert.match(plan.name, /^wonder-harness-v6-[a-z0-9-]+$/);
  assert.ok(Number.isFinite(Date.parse(plan.createdAt)));
  validateRecoveryProtocol(plan.protocol);
  assert.equal(plan.protocol.name, 'motion-recovery-v6');
  assert.equal(plan.model, 'muse-wonder-1.0');
  assert.equal(plan.protocol.limits.maxCostUsd, 2.5);
  assert.ok(Number.isInteger(plan.plannedTrials) && plan.plannedTrials >= 1 && plan.plannedTrials <= 2);
  assert.equal(plan.budget.workingLimitUsd, 5);
  assert.ok(Number.isFinite(Date.parse(plan.budget.since)));
  assert.ok(Date.parse(plan.budget.since) <= Date.parse(plan.createdAt));
  assert.match(plan.budget.ledgerSha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isFinite(plan.budget.usedUsd) && plan.budget.usedUsd >= 0);
  assert.ok(plan.budget.usedUsd + plan.plannedTrials * 2.5 <= 5 + 1e-9, 'Plan exceeds the $5 working limit');
  assert.equal(plan.success, 'proved-and-20-of-20-acceptance');
  assert.equal(plan.stateReader, false);
  assert.match(plan.workspace, /^\/tmp\/wonder-harness-v6-[a-z0-9-]+$/);
  assert.match(plan.output, /^\/app\/reports\/wonder-harness-v6-[a-z0-9-]+$/);
  assert.equal(plan.phaseLedger, '/app/reports/motion-transfer-phase');
  assert.match(plan.sourceArchiveSha256, /^[a-f0-9]{64}$/);
  assert.match(plan.implementationCommit, /^[a-f0-9]{40}$/);
  assert.ok(Number.isFinite(Date.parse(plan.startCutoff)), 'A session start cutoff is required');
  assert.ok(Date.parse(plan.createdAt) < Date.parse(plan.startCutoff));
  return plan;
}

/** A pre-request correction gets its own record; the original plan is immutable. */
export async function loadV6Plan(directory) {
  const originalBytes = await readFile(join(directory, 'plan.json'));
  const original = validateV6Plan(JSON.parse(originalBytes));
  let revisionBytes;
  try { revisionBytes = await readFile(join(directory, 'plan-revision-1.json')); }
  catch (error) { if (error.code === 'ENOENT') return { plan: original, file: 'plan.json' }; throw error; }
  const assertRevision = (revision, previous, previousBytes) => {
    assert.equal(revision.supersedesPlanSha256, digest(previousBytes), 'Plan revision must bind the exact preserved plan before it');
    assert.ok(typeof revision.revisionReason === 'string' && revision.revisionReason.length > 0);
    assert.equal(revision.previousPlanStartedSessions, 0, 'Only an unstarted plan can be superseded');
    assert.equal(revision.plannedTrials, previous.plannedTrials);
    assert.equal(revision.budget.since, previous.budget.since);
    assert.notEqual(revision.workspace, previous.workspace);
    assert.notEqual(revision.output, previous.output);
    assert.ok(Date.parse(revision.createdAt) >= Date.parse(previous.createdAt));
  };
  const first = validateV6Plan(JSON.parse(revisionBytes));
  assertRevision(first, original, originalBytes);
  let secondBytes;
  try { secondBytes = await readFile(join(directory, 'plan-revision-2.json')); }
  catch (error) { if (error.code === 'ENOENT') return { plan: first, file: 'plan-revision-1.json', superseded: [original] }; throw error; }
  const second = validateV6Plan(JSON.parse(secondBytes));
  assertRevision(second, first, revisionBytes);
  return { plan: second, file: 'plan-revision-2.json', superseded: [original, first] };
}

export function v6Verification(report) {
  const recovery = report.session?.recovery;
  assert.ok(recovery && report.recoveryProtocol?.name === 'motion-recovery-v6');
  const attempts = recovery.attempts.map(attempt => ({ attempt: attempt.attempt, candidateId: attempt.candidateId,
    development: { passed: attempt.development?.passed === true && attempt.development.results?.every(result => result.passed) === true,
      count: attempt.development?.results?.length ?? 0 },
    exhaustive: attempt.exhaustive ?? { verdict: 'not-run', reason: 'development-did-not-pass' },
    acceptance: { passed: attempt.acceptance?.passed === true && attempt.acceptance.results?.every(result => result.passed) === true,
      count: attempt.acceptance?.results?.length ?? 0 } }));
  const accepted = attempts.find(attempt => attempt.attempt === recovery.acceptedAttempt);
  const ceilingReached = /cost budget|cost ceiling|budget cannot cover|cost limit/i.test(report.error ?? '')
    || report.estimatedCostUsd >= report.recoveryProtocol.limits.maxCostUsd;
  const passed = Boolean(!ceilingReached && !recovery.abstractionConflict && accepted?.candidateId === recovery.frozenCandidateId
    && accepted?.development.passed && accepted?.development.count === 32 && accepted?.exhaustive.verdict === 'proved'
    && accepted?.acceptance.passed && accepted?.acceptance.count === 20);
  return { schemaVersion: 1, kind: 'recovery-v6-three-gates', protocolId: report.recoveryProtocol.id,
    sessionId: report.session.id, passed, ceilingReached, candidateId: accepted?.candidateId ?? null,
    abstractionConflict: recovery.abstractionConflict ?? null, attempts };
}
