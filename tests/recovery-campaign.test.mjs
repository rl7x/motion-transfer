import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPhaseBudget } from '../src/campaign/phase-budget.mjs';
import { runRecoveryCampaign, readRecoveryCampaign, wilsonInterval } from '../src/campaign/recovery-runner.mjs';
import { digest } from '../src/component/build.mjs';
import { main } from '../scripts/recovery-campaign.mjs';

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'recovery-campaign-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { directory: join(root, 'trial'), phaseBudget: await createPhaseBudget(join(root, 'phase')) };
}

test('a failed development trial retains exact spending and is never automatically repeated', async t => {
  const fixture = await setup(t);
  let calls = 0;
  const investigateRun = async ({ recoveryProtocol, onUpdate }) => {
    calls++;
    const report = { status: 'failed', model: recoveryProtocol.model, recoveryProtocol,
      requests: [{ status: 'completed' }], estimatedCostUsd: 0.013, reservedCostUsd: 0,
      error: 'Injected local failure; no Meta request occurred.' };
    await onUpdate(report); const error = Error(report.error); error.report = report; throw error;
  };
  const first = await runRecoveryCampaign({ ...fixture, development: true, investigateRun });
  assert.equal(first.summary.acceptedDeliveries, 0);
  assert.equal(first.summary.completedTrials, 1);
  assert.equal(first.summary.interval, null);
  assert.equal(first.trials[0].failureCategory, 'recovery-incomplete');
  assert.equal((await fixture.phaseBudget.status()).settledUsd, 0.013);
  const saved = await readRecoveryCampaign(fixture.directory);
  assert.equal(saved.trials[0].reportRef.sha256, digest(await readFile(join(fixture.directory, saved.trials[0].reportRef.path))));
  const resumed = await runRecoveryCampaign({ ...fixture, development: true, investigateRun });
  assert.equal(resumed.definition.sha256, first.definition.sha256);
  assert.equal(calls, 1);
  assert.equal((await fixture.phaseBudget.status()).reservations, 1);
  await assert.rejects(runRecoveryCampaign({ ...fixture, directory: join(fixture.directory, 'frozen'), developmentReport: fixture.directory, investigateRun }), /checked development delivery/);
  assert.equal(calls, 1);
});

test('unknown per-request billing remains reserved across restart and stops every model family', async t => {
  const fixture = await setup(t);
  let calls = 0;
  await assert.rejects(runRecoveryCampaign({ ...fixture, development: true, investigateRun: async ({ onUpdate }) => {
    calls++;
    const report = { status: 'failed', estimatedCostUsd: 0.01, reservedCostUsd: 0.1, requests: [{ status: 'unsettled' }] };
    await onUpdate(report); const error = Error('Injected unknown billing.'); error.report = report; throw error;
  } }), /billing is uncertain/);
  assert.equal(calls, 1);
  const status = await fixture.phaseBudget.status();
  assert.equal(status.uncertain, true);
  assert.equal(status.settledUsd, 0.01);
  assert.equal(status.reservedUsd, 0.49);
  assert.equal((await readRecoveryCampaign(fixture.directory)).trials[0].failureCategory, 'uncertain-billing');
  await assert.rejects(fixture.phaseBudget.reserve({ id: 'blocked-other-family', category: 'video', maxCostUsd: 1 }), /billing is uncertain/);
  const resumed = await runRecoveryCampaign({ ...fixture, development: true, investigateRun: async () => { calls++; } });
  assert.equal(resumed.summary.acceptedDeliveries, 0);
  assert.equal(calls, 1);
});

test('a started trial is reconciled from its journal without a second provider call', async t => {
  const fixture = await setup(t);
  const first = await runRecoveryCampaign({ ...fixture, development: true, investigateRun: async () => {
    const error = Error('Local fixture failure.'); error.report = { status: 'failed', estimatedCostUsd: 0.02, reservedCostUsd: 0, requests: [] }; throw error;
  } });
  // Simulate a previously persisted running boundary with the same known usage.
  const journalPath = join(fixture.directory, 'journal.json');
  const { integritySha256: ignored, ...journal } = JSON.parse(await readFile(journalPath, 'utf8'));
  journal.status = 'running'; journal.trials[0].status = 'running';
  journal.summary.completedTrials = 0; journal.summary.failureCategories = {};
  await writeFile(journalPath, JSON.stringify({ ...journal, integritySha256: digest(JSON.stringify(journal)) }));
  let calls = 0;
  const resumed = await runRecoveryCampaign({ ...fixture, development: true, investigateRun: async () => { calls++; } });
  assert.equal(calls, 0);
  assert.equal(resumed.trials[0].status, 'interrupted');
  assert.equal(resumed.trials[0].phaseReservationId, first.trials[0].phaseReservationId);
  assert.equal((await fixture.phaseBudget.status()).settledUsd, 0.02);
});

test('frozen trials require a checked development delivery and CLI requires an existing shared ledger', async t => {
  const fixture = await setup(t);
  await assert.rejects(runRecoveryCampaign({ ...fixture, investigateRun: async () => assert.fail('Must not request inference') }), /Freeze requires --development-report/);
  assert.equal((await fixture.phaseBudget.status()).reservations, 0);
  await assert.rejects(main(['--development', '--out', fixture.directory, '--phase-ledger', join(fixture.directory, 'missing')]), error => error.code === 'ENOENT');
  const interval = wilsonInterval(4, 10);
  assert.ok(interval.lower > 0.16 && interval.lower < 0.18);
  assert.ok(interval.upper > 0.68 && interval.upper < 0.70);
});
