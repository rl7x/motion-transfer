import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPhaseBudget } from '../src/campaign/phase-budget.mjs';

const execute = promisify(execFile);
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'motion-phase-budget-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, budget: await createPhaseBudget(directory) };
}

test('additional spending is reserved before work and does not reset when another client opens the ledger', async t => {
  const { directory, budget } = await setup(t);
  const initial = await budget.status();
  assert.equal(initial.limitUsd, 45);
  assert.deepEqual(Object.fromEntries(Object.entries(initial.categories).map(([name, value]) => [name, value.limitUsd])),
    { recovery: 6, wonder: 12, video: 2, remix: 5, public: 15, reserve: 5 });
  const reservation = { id: 'recovery:trial-1', category: 'recovery', maxCostUsd: 0.5, metadata: { trial: 1 } };
  await budget.reserve(reservation);
  await budget.reserve(reservation);
  assert.equal((await budget.status()).reservedUsd, 0.5);
  await budget.settle({ id: reservation.id, estimatedCostUsd: 0.12, uncertain: false });
  const reopened = await createPhaseBudget(directory), actual = await reopened.status();
  assert.equal(actual.reservations, 1);
  assert.equal(actual.settledUsd, 0.12);
  assert.equal(actual.reservedUsd, 0);
  assert.equal(actual.remainingUsd, 44.88);
  assert.equal(actual.definition.historicalSpendingIncluded, false);
  await assert.rejects(reopened.reserve(reservation), /completed or externally owned/);
  await assert.rejects(reopened.settle({ id: reservation.id, estimatedCostUsd: 0, uncertain: false }), /cannot be reduced/);
});

test('simultaneous clients cannot overcommit a category or substitute reservation input', async t => {
  const { directory, budget } = await setup(t), second = await createPhaseBudget(directory);
  const attempts = await Promise.allSettled([
    budget.reserve({ id: 'first', category: 'recovery', maxCostUsd: 3.1 }),
    second.reserve({ id: 'second', category: 'recovery', maxCostUsd: 3.1 }),
  ]);
  assert.equal(attempts.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(value => value.status === 'rejected').length, 1);
  assert.equal((await budget.status()).reservedUsd, 3.1);
  const winner = attempts[0].status === 'fulfilled' ? 'first' : 'second';
  await assert.rejects(budget.reserve({ id: winner, category: 'recovery', maxCostUsd: 3 }), /different input/);
  await assert.rejects(budget.reserve({ id: 'video-too-large', category: 'video', maxCostUsd: 2.01 }), /Invalid phase budget reservation/);
});

test('uncertain billing retains the unused reservation and blocks every family until reconciled', async t => {
  const { directory, budget } = await setup(t);
  await budget.reserve({ id: 'uncertain-recovery', category: 'recovery', maxCostUsd: 0.5 });
  await budget.settle({ id: 'uncertain-recovery', estimatedCostUsd: 0.1, uncertain: true });
  let current = await budget.status();
  assert.equal(current.uncertain, true);
  assert.equal(current.settledUsd, 0.1);
  assert.equal(current.reservedUsd, 0.4);
  const reopened = await createPhaseBudget(directory);
  await assert.rejects(reopened.reserve({ id: 'blocked-video', category: 'video', maxCostUsd: 1 }), /billing is uncertain/);
  await reopened.settle({ id: 'uncertain-recovery', estimatedCostUsd: 0.15, uncertain: false });
  await reopened.reserve({ id: 'allowed-video', category: 'video', maxCostUsd: 1 });
  current = await budget.status();
  assert.equal(current.uncertain, false);
  assert.equal(current.settledUsd, 0.15);
  assert.equal(current.reservedUsd, 1);
});

test('an interrupted owner becomes uncertain on restart and is never silently released', async t => {
  const { directory, budget } = await setup(t);
  const moduleUrl = new URL('../src/campaign/phase-budget.mjs', import.meta.url).href;
  await execute(process.execPath, ['--input-type=module', '-e',
    'const {createPhaseBudget}=await import(process.argv[1]);const ledger=await createPhaseBudget(process.argv[2]);await ledger.reserve({id:"interrupted",category:"recovery",maxCostUsd:0.5});',
    moduleUrl, directory], { env: { PATH: process.env.PATH ?? '' } });
  const current = await budget.status();
  assert.equal(current.uncertain, true);
  assert.equal(current.reservedUsd, 0.5);
  await assert.rejects(budget.reserve({ id: 'new-family', category: 'remix', maxCostUsd: 0.03 }), /billing is uncertain/);
});

test('provider overruns and journal tampering are recorded or rejected without freeing spending', async t => {
  const { directory, budget } = await setup(t);
  await budget.reserve({ id: 'overrun', category: 'recovery', maxCostUsd: 0.1 });
  await budget.settle({ id: 'overrun', estimatedCostUsd: 0.11, uncertain: false });
  assert.equal((await budget.status()).overrun, true);
  assert.equal((await budget.status()).settledUsd, 0.11);
  await assert.rejects(budget.reserve({ id: 'after-overrun', category: 'remix', maxCostUsd: 0.01 }), /exceeded a reservation/);
  const path = join(directory, 'phase-budget.json');
  const edited = JSON.parse(await readFile(path, 'utf8')); edited.reservations[0].estimatedCostUsd = 0;
  await writeFile(path, JSON.stringify(edited));
  await assert.rejects(createPhaseBudget(directory), /integrity mismatch/);
});

test('an explicit allowance increase preserves spending, uncertainty and the previous definition', async t => {
  const { directory, budget } = await setup(t);
  await budget.reserve({ id: 'pending', category: 'recovery', maxCostUsd: 0.5 });
  await budget.settle({ id: 'pending', estimatedCostUsd: 0.018, uncertain: true });
  const before = await budget.journal(), second = await createPhaseBudget(directory);
  assert.equal((await second.status()).limitUsd, 45);
  await assert.rejects(budget.approveAllowanceIncrease({ maxCostUsd: 51, reason: 'not authorized' }), /explicit \$50/);
  await assert.rejects(budget.approveAllowanceIncrease({ maxCostUsd: 50, reason: '' }), /reason/);
  await Promise.all([budget, second].map(client => client.approveAllowanceIncrease({ maxCostUsd: 50, reason: 'User authorized $50 total' })));
  const after = await budget.journal(), status = await second.status();
  assert.equal(after.allowanceMigrations.length, 1);
  assert.deepEqual(after.allowanceMigrations[0].previousDefinition, before.definition);
  assert.deepEqual(after.reservations, before.reservations);
  assert.equal(after.createdAt, before.createdAt);
  assert.equal(status.limitUsd, 50);
  assert.equal(status.categories.reserve.limitUsd, 10);
  assert.equal(status.categories.recovery.limitUsd, 6);
  assert.equal(status.settledUsd + status.reservedUsd, 0.5);
  assert.equal(status.remainingUsd, 49.5);
  assert.equal(status.uncertain, true);
  await assert.rejects(budget.reserve({ id: 'still-blocked', category: 'video', maxCostUsd: 1 }), /billing is uncertain/);
  assert.equal((await (await createPhaseBudget(directory)).status()).limitUsd, 50);
});

test('acknowledged unknown billing retains its full bound while allowing only other jobs', async t => {
  const { directory, budget } = await setup(t);
  const request = { id: 'pending', category: 'recovery', maxCostUsd: 0.5 };
  await budget.reserve(request);
  await assert.rejects(budget.reconcileBoundedUnknown({ id: request.id, reason: 'still running' }), /Only an uncertain/);
  await budget.settle({ id: request.id, estimatedCostUsd: 0.018, uncertain: true });
  await assert.rejects(budget.reconcileBoundedUnknown({ id: request.id, reason: ' ' }), /reason/);
  await budget.reconcileBoundedUnknown({ id: request.id, reason: 'User acknowledged interrupted request; retain whole job ceiling' });
  const reopened = await createPhaseBudget(directory), status = await reopened.status();
  assert.equal(status.uncertain, false);
  assert.equal(status.unresolvedBilling, true);
  assert.equal(status.boundedUnknownReservations, 1);
  assert.equal(status.settledUsd, 0.018);
  assert.equal(status.settledUsd + status.reservedUsd, 0.5);
  await assert.rejects(reopened.reserve(request), /completed or externally owned/);
  await assert.rejects(reopened.settle({ id: request.id, estimatedCostUsd: 0.01, uncertain: false }), /cannot be reduced/);
  await reopened.reserve({ id: 'different-job', category: 'video', maxCostUsd: 1 });
  await reopened.settle({ id: request.id, estimatedCostUsd: 0.02, uncertain: true });
  assert.equal((await reopened.status()).uncertain, false);
  assert.equal((await reopened.status()).reservedUsd, 1.48);
  await reopened.settle({ id: request.id, estimatedCostUsd: 0.025, uncertain: false });
  assert.equal((await reopened.status()).unresolvedBilling, false);
  assert.equal((await reopened.status()).reservedUsd, 1);
  const entry = (await reopened.journal()).reservations[0];
  assert.equal(entry.boundedUnknown.knownCostUsd, 0.018);
  assert.equal(entry.boundedUnknown.resolution.estimatedCostUsd, 0.025);
  await assert.rejects(reopened.reserve(request), /completed or externally owned/);
});

test('bounded unknown costs cannot overcommit a category and a late overrun blocks new jobs', async t => {
  const { directory, budget } = await setup(t);
  await budget.approveAllowanceIncrease({ maxCostUsd: 50, reason: 'Authorized ceiling' });
  await budget.reserve({ id: 'pending', category: 'recovery', maxCostUsd: 0.5 });
  await budget.settle({ id: 'pending', estimatedCostUsd: 0.01, uncertain: true });
  await budget.reconcileBoundedUnknown({ id: 'pending', reason: 'Retain full bound' });
  const second = await createPhaseBudget(directory);
  const results = await Promise.allSettled([budget, second].map((client, index) =>
    client.reserve({ id: 'parallel-' + index, category: 'recovery', maxCostUsd: 3 })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  await budget.reserve({ id: 'new-reserve-allocation', category: 'reserve', maxCostUsd: 10 });
  await budget.settle({ id: 'pending', estimatedCostUsd: 0.51, uncertain: false });
  assert.equal((await budget.status()).overrun, true);
  assert.equal((await budget.status()).settledUsd, 0.51);
  await assert.rejects(second.reserve({ id: 'blocked', category: 'video', maxCostUsd: 1 }), /exceeded a reservation/);
});
