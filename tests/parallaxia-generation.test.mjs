import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCoordinator } from '../src/hosting/coordinator.mjs';
import { createPhaseBudget } from '../src/campaign/phase-budget.mjs';
import { createHostedTestBudget } from './helpers/hosting-budget.mjs';
import { parseJob } from '../src/hosting/protocol.mjs';
import { loadPinnedComponent } from '../src/hosting/component-load.mjs';
import { ACCEPTED_COMPONENT_ID } from '../src/hosting/component-pin.mjs';
import { createFakeMetaClient } from '../src/hosting/fake-client.mjs';
import { roadsterAdapterFixture } from './helpers/roadster-adapter.mjs';
import { requestedParallaxiaIntent } from '../src/agent/recipient-request.mjs';
const digest = value => createHash('sha256').update(value).digest('hex');

test('PARALLAXIA requests preserve inherited intent and reject unknown worker recipients', () => {
  const parent = { unitScale: 0.1, direction: 'opposite', activation: 'press' };
  assert.deepEqual(requestedParallaxiaIntent('Half as far.', parent), { ...parent, unitScale: 0.05 });
  assert.equal(requestedParallaxiaIntent('Make it invulnerable.', parent), null);
  assert.throws(() => parseJob({ operation: 'verify-native', source: 'x', componentId: ACCEPTED_COMPONENT_ID, intent: parent, recipientId: 'other' }), /Unknown recipient/);
});

test('one PARALLAXIA reservation covers a failed candidate and one repair; restart reuses the job', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'motion-parallaxia-generation-'));
  const ledgerDirectory = await mkdtemp(join(tmpdir(), 'motion-parallaxia-ledger-'));
  t.after(() => rm(directory, { recursive: true, force: true })); t.after(() => rm(ledgerDirectory, { recursive: true, force: true }));
  const budget = await createHostedTestBudget(ledgerDirectory);
  const component = await loadPinnedComponent(ACCEPTED_COMPONENT_ID);
  const parentIntent = { unitScale: 0.1, activation: 'held', direction: 'facing' };
  const intent = { ...parentIntent, direction: 'opposite', activation: 'press' };
  const client = createFakeMetaClient({ source: roadsterAdapterFixture(intent), intent });
  let checks = 0;
  const broker = { available: async () => true, async submit(job) {
    assert.equal(job.recipientId, 'parallaxia'); checks++;
    if (checks === 1) return { ok: true, result: { ok: true, passed: false, checks: [{ name: 'component-delegation', passed: false, error: 'did not delegate' }] } };
    const javascript = 'export {};\n', frame = Buffer.from('<!doctype html><title>test fixture</title>');
    return { ok: true, frame: job.operation === 'verify-browser' ? frame : null, result: {
      ok: true, passed: true, executedIn: 'worker', operation: job.operation, uid: 10001, recipientId: job.recipientId,
      componentId: job.componentId, sourceSha256: digest(job.source), javascript, javascriptSha256: digest(javascript),
      frameSha256: digest(frame), frame: { sha256: digest(frame), bytes: frame.length }, checks: [{ name: job.operation, passed: true }],
    } };
  } };
  let coordinator = await createCoordinator({ directory, ledgerDirectory, broker, client, localVerification: true });
  const parentId = 'ab'.repeat(32);
  await coordinator.putParent({ id: parentId, bytes: Buffer.from('parent'), source: roadsterAdapterFixture(parentIntent), intent: parentIntent,
    component: { id: component.provenance.id, javascript: component.javascript, contract: component.contract },
    recipient: { id: 'parallaxia', name: 'PARALLAXIA', revision: 'test-fixture', collisionPolicy: 'native' } });
  const request = { parentArtifactId: parentId, prompt: 'Make it backward, only on a fresh press.', sessionId: randomUUID(), idempotencyKey: randomUUID(), adultConfirmed: true };
  const ready = await coordinator.wait((await coordinator.submit(request)).id);
  assert.equal(ready.status, 'ready', ready.error);
  assert.equal(client.calls.filter(call => call.method === 'respond').length, 2);
  assert.equal((await budget.status()).reservations, 1);
  assert.equal((await budget.journal()).reservations[0].maxCostUsd,7);
  assert.equal((await budget.journal()).reservations[0].category,'reserve');
  const saved = JSON.parse(await readFile(join(directory, 'jobs', ready.id + '.json'), 'utf8'));
  assert.equal(saved.attempts.length, 2); assert.equal(saved.attempts[0].passed, false); assert.equal(saved.attempts[1].passed, true);
  assert.match(client.calls.at(-1).request.input[0].content[0].text, /component-delegation/);
  assert.deepEqual(ready.intent, intent);
  const receipt = JSON.parse((await coordinator.artifactFile(ready.artifactId, 'receipt.json')).toString());
  assert.equal(receipt.recipient.id, 'parallaxia'); assert.equal(receipt.componentId, ACCEPTED_COMPONENT_ID);
  await coordinator.close(); coordinator = await createCoordinator({ directory, ledgerDirectory, broker, client, localVerification: true });
  try {
    assert.equal((await coordinator.submit(request)).artifactId, ready.artifactId);
    assert.equal(client.calls.filter(call => call.method === 'respond').length, 2);
    assert.equal((await budget.status()).reservations, 1);
  } finally { await coordinator.close(); }
});
