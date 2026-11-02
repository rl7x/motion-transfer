import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const digest = value => createHash('sha256').update(value).digest('hex');
const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));
export const PHASE_ALLOCATIONS = Object.freeze({ recovery: 6, wonder: 12, video: 2, remix: 5, public: 15, reserve: 5 });
const controls = { schemaVersion: 1, name: 'motion-transfer-additional-inference-v1',
  maxCostUsd: 45, allocations: PHASE_ALLOCATIONS, historicalSpendingIncluded: false };
const definition = Object.freeze({ ...controls, id: digest(JSON.stringify(controls)) });
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,179}$/.test(id);
const validCost = value => Number.isFinite(value) && value >= 0;
const alive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
};

function summary(journal) {
  const categories = Object.fromEntries(Object.entries(PHASE_ALLOCATIONS).map(([name, limitUsd]) => [name,
    { limitUsd, settledUsd: 0, reservedUsd: 0, remainingUsd: limitUsd }]));
  let settledUsd = 0, reservedUsd = 0;
  for (const entry of journal.reservations) {
    const remaining = ['reserved', 'uncertain'].includes(entry.status) ? Math.max(0, entry.maxCostUsd - entry.estimatedCostUsd) : 0;
    settledUsd += entry.estimatedCostUsd; reservedUsd += remaining;
    categories[entry.category].settledUsd += entry.estimatedCostUsd;
    categories[entry.category].reservedUsd += remaining;
  }
  for (const category of Object.values(categories)) category.remainingUsd = Math.max(0, category.limitUsd - category.settledUsd - category.reservedUsd);
  return { limitUsd: 45, settledUsd, reservedUsd, remainingUsd: Math.max(0, 45 - settledUsd - reservedUsd),
    uncertain: journal.reservations.some(entry => entry.status === 'uncertain'),
    overrun: journal.reservations.some(entry => entry.status === 'overrun'), categories,
    reservations: journal.reservations.length };
}

function validate(journal) {
  assert.equal(journal.schemaVersion, 1, 'Unsupported phase budget journal');
  assert.deepEqual(journal.definition, definition, 'Phase budget controls changed; existing spending cannot be reset');
  assert.ok(Array.isArray(journal.reservations));
  const ids = new Set();
  for (const entry of journal.reservations) {
    assert.ok(validId(entry.id) && !ids.has(entry.id), 'Invalid or duplicate phase reservation'); ids.add(entry.id);
    assert.ok(Object.hasOwn(PHASE_ALLOCATIONS, entry.category));
    assert.ok(validCost(entry.maxCostUsd) && entry.maxCostUsd > 0 && entry.maxCostUsd <= PHASE_ALLOCATIONS[entry.category]);
    assert.ok(validCost(entry.estimatedCostUsd));
    assert.ok(['reserved', 'settled', 'uncertain', 'overrun'].includes(entry.status));
    assert.ok(Number.isSafeInteger(entry.ownerPid) && entry.ownerPid > 0);
    assert.equal(entry.requestSha256, digest(JSON.stringify({ id: entry.id, category: entry.category,
      maxCostUsd: entry.maxCostUsd, metadata: entry.metadata })), 'Phase reservation request changed');
    assert.ok(entry.status === 'overrun' || entry.estimatedCostUsd <= entry.maxCostUsd + 1e-9);
  }
  const totals = summary(journal);
  if (!totals.overrun) {
    assert.ok(totals.settledUsd + totals.reservedUsd <= 45 + 1e-9, 'Phase budget is overcommitted');
    for (const value of Object.values(totals.categories)) assert.ok(value.settledUsd + value.reservedUsd <= value.limitUsd + 1e-9, 'Phase category is overcommitted');
  }
}

/** Additional spending only. A durable full-job reservation precedes inference. */
export async function createPhaseBudget(directory) {
  const root = resolve(directory), path = join(root, 'phase-budget.json'), lock = join(root, '.phase-budget-lock');
  await mkdir(root, { recursive: true });
  async function locked(action) {
    const token = randomUUID(), deadline = Date.now() + 5000;
    for (;;) {
      try {
        await mkdir(lock);
        await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, token }), { mode: 0o600 });
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        try {
          const owner = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8'));
          if (!Number.isSafeInteger(owner.pid) || owner.pid < 1 || typeof owner.token !== 'string') throw Error('Invalid phase budget lock');
          if (!alive(owner.pid)) {
            // Only one reclaimer may inspect/remove a stale lock. A second
            // reclaimer must reread ownership after the first has finished.
            const recoveryLock = lock + '.recovering';
            let reclaiming = false;
            try {
              await mkdir(recoveryLock); reclaiming = true;
              const current = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8'));
              if (current.token === owner.token && !alive(current.pid)) {
                const stale = lock + '.stale-' + token;
                await rename(lock, stale); await rm(stale, { recursive: true, force: true });
              }
            } catch (failure) { if (!['ENOENT', 'EEXIST'].includes(failure.code)) throw failure; }
            finally { if (reclaiming) await rm(recoveryLock, { recursive: true }); }
            continue;
          }
        } catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
        if (Date.now() >= deadline) throw Error('Phase budget is busy or has an incomplete lock; no inference admitted');
        await wait(10);
      }
    }
    try { return await action(); }
    finally {
      const owner = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8'));
      if (owner.token !== token) throw Error('Phase budget lock ownership changed');
      await rm(lock, { recursive: true });
    }
  }
  async function save(journal) {
    validate(journal);
    journal.updatedAt = new Date().toISOString();
    const temporary = path + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, JSON.stringify({ ...journal, integritySha256: digest(JSON.stringify(journal)) }, null, 2) + '\n', { mode: 0o600 });
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }); }
  }
  async function read() {
    const { integritySha256, ...journal } = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(digest(JSON.stringify(journal)), integritySha256, 'Phase budget integrity mismatch');
    validate(journal);
    let interrupted = false;
    for (const entry of journal.reservations) if (entry.status === 'reserved' && !alive(entry.ownerPid)) {
      entry.status = 'uncertain'; entry.interruptedAt = new Date().toISOString(); interrupted = true;
    }
    if (interrupted) await save(journal);
    return journal;
  }
  await locked(async () => {
    try { await read(); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await save({ schemaVersion: 1, definition, createdAt: new Date().toISOString(), reservations: [] });
    }
  });

  return {
    directory: root,
    async status() { return locked(async () => { const journal = await read(); return { definition: journal.definition, ...summary(journal) }; }); },
    async journal() { return locked(read); },
    async reserve({ id, category, maxCostUsd, metadata = {} }) {
      if (!validId(id) || !Object.hasOwn(PHASE_ALLOCATIONS, category) || !validCost(maxCostUsd) || maxCostUsd <= 0
        || maxCostUsd > PHASE_ALLOCATIONS[category]) throw Error('Invalid phase budget reservation');
      const request = JSON.parse(JSON.stringify({ id, category, maxCostUsd, metadata }));
      if (Buffer.byteLength(JSON.stringify(request)) > 32768) throw Error('Phase reservation metadata is too large');
      const requestSha256 = digest(JSON.stringify(request));
      return locked(async () => {
        const journal = await read(), totals = summary(journal);
        if (totals.uncertain || totals.overrun) throw Error('Phase billing is uncertain or exceeded a reservation; no further inference admitted');
        const existing = journal.reservations.find(entry => entry.id === id);
        if (existing) {
          if (existing.requestSha256 !== requestSha256) throw Error('Phase reservation ID already binds different input');
          if (existing.status !== 'reserved' || existing.ownerPid !== process.pid) throw Error('A completed or externally owned phase reservation cannot start another request');
          return structuredClone(existing);
        }
        if (maxCostUsd > totals.remainingUsd + 1e-9 || maxCostUsd > totals.categories[category].remainingUsd + 1e-9) {
          throw Error('Phase budget or category cannot cover this full job reservation');
        }
        const entry = { ...request, requestSha256, ownerPid: process.pid, status: 'reserved', estimatedCostUsd: 0, createdAt: new Date().toISOString() };
        journal.reservations.push(entry); await save(journal); return structuredClone(entry);
      });
    },
    async settle({ id, estimatedCostUsd, uncertain }) {
      if (!validId(id) || !validCost(estimatedCostUsd) || typeof uncertain !== 'boolean') throw Error('Invalid phase budget settlement');
      return locked(async () => {
        const journal = await read(), entry = journal.reservations.find(value => value.id === id);
        if (!entry) throw Error('Unknown phase budget reservation');
        if (estimatedCostUsd + 1e-9 < entry.estimatedCostUsd) throw Error('Settled phase spending cannot be reduced');
        if (['settled', 'overrun'].includes(entry.status)) {
          if (entry.estimatedCostUsd !== estimatedCostUsd || uncertain) throw Error('A final phase settlement cannot be changed');
          return structuredClone(entry);
        }
        entry.estimatedCostUsd = estimatedCostUsd;
        entry.status = estimatedCostUsd > entry.maxCostUsd + 1e-9 ? 'overrun' : uncertain ? 'uncertain' : 'settled';
        entry.settledAt = new Date().toISOString();
        await save(journal); return structuredClone(entry);
      });
    },
  };
}
