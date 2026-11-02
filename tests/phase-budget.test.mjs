import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPhaseBudget } from '../campaign/phase-budget.mjs';

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
  const moduleUrl = new URL('../campaign/phase-budget.mjs', import.meta.url).href;
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
