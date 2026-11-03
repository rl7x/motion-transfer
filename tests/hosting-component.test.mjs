import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { access, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createPhaseBudget } from '../src/campaign/phase-budget.mjs';
import { createHostedTestBudget } from './helpers/hosting-budget.mjs';
import { createCoordinator } from '../src/hosting/coordinator.mjs';
import { loadPinnedComponent } from '../src/hosting/component-load.mjs';
import {
  ACCEPTED_ARTIFACT_ID, ACCEPTED_COMPONENT_ID, SAVED_ARTIFACT_ID, SAVED_COMPONENT_ID,
} from '../src/hosting/component-pin.mjs';
import { createFakeMetaClient } from '../src/hosting/fake-client.mjs';
import { seedVerifiedParent } from '../src/hosting/seed-parent.mjs';
import { verifyNative } from '../src/hosting/worker.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const savedDir = join(repo, 'assets/transfers/roadster/versions', SAVED_ARTIFACT_ID);
const acceptedDir = join(repo, 'assets/transfers/roadster/accepted', ACCEPTED_ARTIFACT_ID, 'published/artifacts', ACCEPTED_ARTIFACT_ID);
const workerJavaScript = 'export {}\n';

async function temp(t) {
  const directory = await mkdtemp(join(tmpdir(), 'motion-hosting-pin-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function verified(componentId, frame) {
  return job => {
    const sourceSha256 = createHash('sha256').update(job.source).digest('hex');
    const javascriptSha256 = createHash('sha256').update(workerJavaScript).digest('hex');
    const frameSha = createHash('sha256').update(frame).digest('hex');
    return {
      ok: true, terminated: null, error: null,
      result: {
        ok: true, passed: true, operation: job.operation, executedIn: 'worker', uid: 10001, componentId,
        sourceSha256, javascriptSha256, checks: [{ name: job.operation, passed: true }],
        javascript: job.operation === 'verify-native' ? workerJavaScript : null,
        frame: job.operation === 'verify-browser' ? { sha256: frameSha, bytes: frame.length } : null,
        frameSha256: job.operation === 'verify-browser' ? frameSha : null,
      },
      frame: job.operation === 'verify-browser' ? frame : null,
    };
  };
}

function brokerReturning(componentId) {
  const calls = [];
  const frame = Buffer.from('<!doctype html><title>pin</title>');
  return {
    calls,
    up: true,
    async available() { return this.up; },
    async submit(job) { calls.push(job); return verified(componentId, frame)(job); },
  };
}

test('the worker loads the saved and accepted pins and does not fall back', async () => {
  const saved = await loadPinnedComponent(SAVED_COMPONENT_ID);
  const accepted = await loadPinnedComponent(ACCEPTED_COMPONENT_ID);
  assert.equal(saved.provenance.id, SAVED_COMPONENT_ID);
  assert.equal(saved.candidateId, undefined);
  assert.equal(accepted.provenance.id, ACCEPTED_COMPONENT_ID);
  assert.match(accepted.candidateId, /^[a-f0-9]{64}$/);
  assert.notEqual(saved.javascript, accepted.javascript);
  await assert.rejects(() => loadPinnedComponent('ab'.repeat(32)), /allowlisted host pin/);

  const savedManifest = JSON.parse(await readFile(join(savedDir, 'manifest.json'), 'utf8'));
  const savedSource = await readFile(join(savedDir, 'adapter.ts'), 'utf8');
  const savedResult = await verifyNative({
    operation: 'verify-native', source: savedSource, intent: savedManifest.intent, componentId: SAVED_COMPONENT_ID,
  });
  assert.equal(savedResult.passed, true);
  assert.equal(savedResult.componentId, SAVED_COMPONENT_ID);

  const acceptedManifest = JSON.parse(await readFile(join(acceptedDir, 'manifest.json'), 'utf8'));
  const acceptedSource = await readFile(join(acceptedDir, 'adapter.ts'), 'utf8');
  const acceptedResult = await verifyNative({
    operation: 'verify-native', source: acceptedSource, intent: acceptedManifest.intent, componentId: ACCEPTED_COMPONENT_ID,
  });
  assert.equal(acceptedResult.passed, true, JSON.stringify(acceptedResult.checks));
  assert.equal(acceptedResult.componentId, ACCEPTED_COMPONENT_ID);
  assert.notEqual(acceptedResult.componentId, SAVED_COMPONENT_ID);
});

test('seeding reads the real pins and rejects mismatched frame evidence', async t => {
  const dataDirectory = await temp(t);
  const saved = await seedVerifiedParent({ dataDirectory, artifactDirectory: savedDir });
  assert.equal(saved.id, SAVED_ARTIFACT_ID);
  assert.equal(saved.componentId, SAVED_COMPONENT_ID);
  const savedComponent = JSON.parse(await readFile(join(dataDirectory, 'parents', `${saved.id}.component.json`), 'utf8'));
  assert.equal(savedComponent.javascript, await readFile(join(repo, 'assets/components/dashy-dango-dash/component.js'), 'utf8'));

  const acceptedData = await temp(t);
  const accepted = await seedVerifiedParent({ dataDirectory: acceptedData, artifactDirectory: acceptedDir });
  assert.equal(accepted.id, ACCEPTED_ARTIFACT_ID);
  assert.equal(accepted.componentId, ACCEPTED_COMPONENT_ID);
  const acceptedComponent = JSON.parse(await readFile(join(acceptedData, 'parents', `${accepted.id}.component.json`), 'utf8'));
  assert.equal(acceptedComponent.id, ACCEPTED_COMPONENT_ID);
  assert.notEqual(acceptedComponent.javascript, savedComponent.javascript);
  const manifest = JSON.parse(await readFile(join(acceptedDir, 'manifest.json'), 'utf8'));
  assert.equal(acceptedComponent.javascript, manifest.component.javascript);

  const tamperedRoot = await temp(t);
  const tampered = join(tamperedRoot, SAVED_ARTIFACT_ID);
  await cp(savedDir, tampered, { recursive: true });
  const framePath = join(tampered, 'frame.html');
  const frame = await readFile(framePath);
  frame[0] = frame[0] === 0x3c ? 0x20 : 0x3c;
  await writeFile(framePath, frame);
  const rejected = await temp(t);
  await assert.rejects(() => seedVerifiedParent({ dataDirectory: rejected, artifactDirectory: tampered }), /integrity mismatch/);
  await assert.rejects(() => access(join(rejected, 'parents', SAVED_ARTIFACT_ID)), error => error.code === 'ENOENT');

  const renamed = join(tamperedRoot, 'ab'.repeat(32));
  await cp(savedDir, renamed, { recursive: true });
  await assert.rejects(() => seedVerifiedParent({ dataDirectory: rejected, artifactDirectory: renamed }), /not an allowlisted pin/);
});

test('an accepted parent binds follow-ups and rejects a saved-component worker result', async t => {
  const directory = await temp(t);
  const seeded = await seedVerifiedParent({ dataDirectory: directory, artifactDirectory: acceptedDir });
  const ledgerDirectory = await temp(t);
  await createHostedTestBudget(ledgerDirectory);
  const parentIntent = JSON.parse(await readFile(join(directory, 'parents', `${seeded.id}.intent.json`), 'utf8'));
  const client = createFakeMetaClient({
    source: 'export function step(){return {}}\n',
    intent: { ...parentIntent, unitScale: parentIntent.unitScale === 0.1 ? 0.2 : 0.1 },
  });
  const respond = client.respond.bind(client);
  let responses = 0;
  client.respond = async request => {
    const response = await respond(request);
    responses += 1;
    if (responses > 1) {
      response.output[0].arguments = JSON.stringify({
        status: 'supported', source: 'export function step(){return {}}\n', summary: 'Follow the accepted pin.',
        intent: { ...parentIntent, activation: parentIntent.activation === 'held' ? 'press' : 'held' },
      });
    }
    return response;
  };
  const broker = brokerReturning(ACCEPTED_COMPONENT_ID);
  const coordinator = await createCoordinator({ directory, broker, client, ledgerDirectory, localVerification: true });
  t.after(() => coordinator.close());
  const sessionId = randomUUID();
  const first = await coordinator.wait((await coordinator.submit({
    prompt: 'Shorten the accepted dash.', parentArtifactId: seeded.id, idempotencyKey: randomUUID(), sessionId, adultConfirmed: true,
  })).id);
  assert.equal(first.status, 'ready', first.error);
  assert.equal(broker.calls[0].componentId, ACCEPTED_COMPONENT_ID);
  const child = JSON.parse((await coordinator.artifactFile(first.artifactId, 'component.json')).toString('utf8'));
  assert.equal(child.id, ACCEPTED_COMPONENT_ID);
  const second = await coordinator.wait((await coordinator.submit({
    prompt: 'Press instead of hold.', parentArtifactId: first.artifactId, idempotencyKey: randomUUID(), sessionId, adultConfirmed: true,
  })).id);
  assert.equal(second.status, 'ready', second.error);
  const nativeJobs = broker.calls.filter(job => job.operation === 'verify-native');
  assert.deepEqual(nativeJobs.map(job => job.componentId), [ACCEPTED_COMPONENT_ID, ACCEPTED_COMPONENT_ID]);

  const mismatchDir = await temp(t);
  await seedVerifiedParent({ dataDirectory: mismatchDir, artifactDirectory: acceptedDir });
  const mismatchLedger = await temp(t);
  await createHostedTestBudget(mismatchLedger);
  const liar = brokerReturning(SAVED_COMPONENT_ID);
  const mismatch = await createCoordinator({
    directory: mismatchDir, broker: liar, client, ledgerDirectory: mismatchLedger, localVerification: true,
  });
  t.after(() => mismatch.close());
  const failed = await mismatch.wait((await mismatch.submit({
    prompt: 'Shorten the accepted dash.', parentArtifactId: seeded.id, idempotencyKey: randomUUID(),
    sessionId: randomUUID(), adultConfirmed: true,
  })).id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /component identity changed/);
  assert.equal(failed.artifactId, null);
  assert.equal(liar.calls[0].componentId, ACCEPTED_COMPONENT_ID);

  const unknownDir = await temp(t);
  const unknownLedger = await temp(t);
  await createHostedTestBudget(unknownLedger);
  const quiet = brokerReturning(SAVED_COMPONENT_ID);
  const unknown = await createCoordinator({
    directory: unknownDir, broker: quiet, client, ledgerDirectory: unknownLedger, localVerification: true,
  });
  t.after(() => unknown.close());
  await unknown.putParent({
    id: 'ab'.repeat(32), bytes: Buffer.from('parent-v1'), intent: parentIntent,
    source: 'export function init(){return {}}\n',
    component: { id: 'ab'.repeat(32), javascript: 'export function init(){return {}}\n', contract: { name: 'other' } },
    recipient: { name: 'RDSTR Stunts', revision: '8486687c6c885d49231744d5d9434ac4fe21f951' },
  });
  const refused = await unknown.wait((await unknown.submit({
    prompt: 'Use another component.', parentArtifactId: 'ab'.repeat(32), idempotencyKey: randomUUID(),
    sessionId: randomUUID(), adultConfirmed: true,
  })).id);
  assert.equal(refused.status, 'failed');
  assert.match(refused.error, /allowlisted host pin/);
  assert.equal(quiet.calls.length, 0);
  assert.equal((await (await createPhaseBudget(unknownLedger)).status()).categories.remix.reservedUsd, 0);
});
