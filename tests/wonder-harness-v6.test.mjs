import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPhaseBudget } from '../src/campaign/phase-budget.mjs';
import { createRecoveryProtocol } from '../src/agent/recovery-protocol.mjs';
import { workingBudgetSnapshot, v6Verification, validateV6Plan, loadV6Plan } from '../scripts/wonder-harness-v6.mjs';
import { digest } from '../src/component/build.mjs';

test('an unstarted plan revision binds the preserved original and cannot replace a started plan', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'v6-plan-revision-'));
  try {
    const bytes = await readFile(new URL('../assets/benchmark/wonder-harness-v6/plan.json', import.meta.url));
    const original = JSON.parse(bytes);
    await writeFile(join(directory, 'plan.json'), bytes);
    assert.equal((await loadV6Plan(directory)).file, 'plan.json');
    const revision = { ...original, workspace: original.workspace + '-revision', output: original.output + '-revision',
      supersedesPlanSha256: digest(bytes), revisionReason: 'Offline source correction before any request.', previousPlanStartedSessions: 0 };
    await writeFile(join(directory, 'plan-revision-1.json'), JSON.stringify(revision));
    assert.equal((await loadV6Plan(directory)).file, 'plan-revision-1.json');
    assert.deepEqual(await readFile(join(directory, 'plan.json')), bytes);
    for (const fields of [{ previousPlanStartedSessions: 1 }, { supersedesPlanSha256: '0'.repeat(64) }, { workspace: original.workspace }]) {
      await writeFile(join(directory, 'plan-revision-1.json'), JSON.stringify({ ...revision, ...fields }));
      await assert.rejects(loadV6Plan(directory));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a second revision binds the first and every superseded plan stays checked', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'v6-plan-second-'));
  try {
    const originalBytes = await readFile(new URL('../assets/benchmark/wonder-harness-v6/plan.json', import.meta.url));
    const firstBytes = await readFile(new URL('../assets/benchmark/wonder-harness-v6/plan-revision-1.json', import.meta.url));
    const first = JSON.parse(firstBytes);
    await writeFile(join(directory, 'plan.json'), originalBytes);
    await writeFile(join(directory, 'plan-revision-1.json'), firstBytes);
    const second = { ...first, workspace: first.workspace + '-two', output: first.output + '-two', supersedesPlanSha256: digest(firstBytes),
      revisionReason: 'Offline feedback correction before any request.', previousPlanStartedSessions: 0 };
    await writeFile(join(directory, 'plan-revision-2.json'), JSON.stringify(second));
    const loaded = await loadV6Plan(directory);
    assert.equal(loaded.file, 'plan-revision-2.json');
    assert.equal(loaded.superseded.length, 2);
    await writeFile(join(directory, 'plan-revision-2.json'), JSON.stringify({ ...second, supersedesPlanSha256: digest(originalBytes) }));
    await assert.rejects(loadV6Plan(directory), /exact preserved plan/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the working limit counts settled and held spending under the existing ledger lock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'v6-working-limit-'));
  try {
    const since = '2026-01-01T00:00:00Z';
    const budget = await createPhaseBudget(directory);
    await budget.reserve({ id: 'earlier-work', category: 'video', maxCostUsd: 2 });
    await budget.settle({ id: 'earlier-work', estimatedCostUsd: 1.1, uncertain: false });
    const bounded = await createPhaseBudget(directory, { workingLimit: { maxCostUsd: 5, since } });
    const definition = (await budget.status()).definition;
    await bounded.reserve({ id: 'fresh-v6-session', category: 'wonder', maxCostUsd: 2.5 });
    const bytes = await readFile(join(directory, 'phase-budget.json'));
    const status = workingBudgetSnapshot(bytes, since);
    assert.equal(status.usedUsd, 3.6);
    assert.equal(status.remainingUsd, 1.4);
    await assert.rejects(bounded.reserve({ id: 'second-v6-session', category: 'wonder', maxCostUsd: 2.5 }), /working limit/);
    assert.deepEqual((await budget.status()).definition, definition, 'No category or allowance is changed');
    assert.deepEqual(await readFile(join(directory, 'phase-budget.json')), bytes, 'Read-only summary and refused reservation do not rewrite the ledger');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('v6 success requires all three gates and budget exhaustion remains a failure', () => {
  const protocol = createRecoveryProtocol({ name: 'motion-recovery-v6', model: 'muse-wonder-1.0' });
  const attempt = { attempt: 1, candidateId: 'candidate', development: { passed: true, results: Array(32).fill({ passed: true }) },
    exhaustive: { verdict: 'proved' }, acceptance: { passed: true, results: Array(20).fill({ passed: true }) } };
  const report = { recoveryProtocol: protocol, estimatedCostUsd: 1, session: { id: 'fixture', recovery: {
    attempts: [attempt], acceptedAttempt: 1, frozenCandidateId: 'candidate' } } };
  assert.equal(v6Verification(report).passed, true);
  for (const verdict of ['inconclusive', 'counterexample']) {
    const changed = structuredClone(report); changed.session.recovery.attempts[0].exhaustive.verdict = verdict;
    assert.equal(v6Verification(changed).passed, false);
  }
  const exhausted = { ...report, error: 'Cost budget cannot cover the next request; generation was not started' };
  assert.equal(v6Verification(exhausted).passed, false);
  assert.equal(v6Verification(exhausted).ceilingReached, true);
  const noCandidate = structuredClone(report); noCandidate.session.recovery.attempts = []; delete noCandidate.session.recovery.acceptedAttempt;
  assert.equal(v6Verification(noCandidate).passed, false);
  const shortSuite = structuredClone(report); shortSuite.session.recovery.attempts[0].development.results.pop();
  assert.equal(v6Verification(shortSuite).passed, false);
  const failedCase = structuredClone(report); failedCase.session.recovery.attempts[0].acceptance.results[0].passed = false;
  assert.equal(v6Verification(failedCase).passed, false);
  assert.throws(() => validateV6Plan({ schemaVersion: 1, name: 'wonder-harness-v6-fixture', createdAt: '2026-11-04T14:00:00Z',
    protocol, model: protocol.model, plannedTrials: 2,
    budget: { workingLimitUsd: 5, usedUsd: 1.1, since: '2026-11-04T05:00:00Z', ledgerSha256: 'a'.repeat(64) } }), /working limit/);
});
