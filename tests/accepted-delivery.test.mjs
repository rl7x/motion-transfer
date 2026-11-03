import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPhaseBudget } from '../src/campaign/phase-budget.mjs';
import { readRecoveryCampaign, runRecoveryCampaign } from '../src/campaign/recovery-runner.mjs';
import { digest } from '../src/component/build.mjs';
import { deliverAcceptedRecovery, deliverySource, main, selectAcceptedTrial, verifyDeliveryReceipt } from '../scripts/deliver-accepted-recovery.mjs';

const SESSION = 'fa8e3d4a-8578-4098-8042-f29e607c9267';
const CANDIDATE = 'a'.repeat(64);
const COMPONENT = 'c'.repeat(64);
const PACKAGE = 'b'.repeat(64);
const ZIP = 'd'.repeat(64);

function acceptedReport(extra = {}) {
  return {
    status: 'completed', estimatedCostUsd: 0.01, reservedCostUsd: 0,
    requests: [{ status: 'completed', estimatedCostUsd: 0.01 }],
    session: { id: SESSION, recovery: { acceptedAttempt: 3, frozenCandidateId: CANDIDATE } },
    ...extra,
  };
}

function deliveryResult() {
  return {
    project: { manifest: { id: PACKAGE, componentId: COMPONENT }, zipSha256: ZIP, files: {}, zip: Buffer.from('zip') },
    verification: {
      passed: true, metaCalled: false, componentId: COMPONENT, candidateId: CANDIDATE, sessionId: SESSION,
      packageId: PACKAGE, zipSha256: ZIP, nodeChecks: { passed: true, count: 3 },
      browser: { passed: true, results: Array.from({ length: 7 }, () => ({ passed: true })) },
      externalRequests: [], nonGetRequests: [],
    },
  };
}

function publicationStore() {
  const stored = new Map();
  return {
    async publish({ project, verification }) {
      const id = 'e'.repeat(64);
      stored.set(id, { project, verification });
      return { id, componentId: verification.componentId, candidateId: verification.candidateId, packageId: project.manifest.id, zipSha256: project.zipSha256 };
    },
    async read(id) {
      const value = stored.get(id);
      return {
        id, project: value.project, verification: value.verification,
        receipt: { componentId: value.verification.componentId, candidateId: value.verification.candidateId, sessionId: value.verification.sessionId },
      };
    },
    async close() {},
  };
}

async function failedCampaign(investigateRun = async () => acceptedReport()) {
  const root = await mkdtemp(join(tmpdir(), 'accepted-delivery-'));
  const directory = join(root, 'campaign');
  await runRecoveryCampaign({
    directory, phaseBudget: await createPhaseBudget(join(root, 'phase')), development: true, investigateRun,
    integrateRecovery: async () => { throw Error('Injected publication mismatch'); },
  });
  return { root, directory, journal: await readFile(join(directory, 'journal.json')) };
}

test('accepted delivery rejects the wrong trial and never reads credentials', async () => {
  const report = { status: 'completed', session: { recovery: { acceptedAttempt: 1 } }, reportRef: { path: `reports/${'a'.repeat(64)}.json`, sha256: 'b'.repeat(64) } };
  assert.throws(() => selectAcceptedTrial({ trials: [] }), /No completed trial/);
  assert.throws(() => selectAcceptedTrial({ trials: [{ report, reportRef: report.reportRef }, { report, reportRef: report.reportRef }] }), /More than one/);
  assert.throws(() => selectAcceptedTrial({ trials: [{ report, reportRef: {} }] }), /exact report/);
  const source = await readFile(new URL('../scripts/deliver-accepted-recovery.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /loadEnvFile|MODEL_API_KEY|process\.env|fetch\(/);
  await main(['--help']);
  await assert.rejects(() => main([]), /--campaign and --out are required/);
});

test('a failed delivery keeps one receipt and the source campaign failure', async t => {
  const fixture = await failedCampaign();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const out = join(fixture.root, 'out');
  let calls = 0;
  await assert.rejects(() => deliverAcceptedRecovery({
    campaignDirectory: fixture.directory, outDirectory: out,
    integrate: async () => { calls += 1; throw Error('Injected export failure'); },
    source: { commit: '1'.repeat(40), hash: '2'.repeat(64) },
  }), /Injected export failure[\s\S]*Failed receipt:/);
  const receiptPath = join(out, 'delivery-receipt.json');
  const first = await readFile(receiptPath);
  const failed = verifyDeliveryReceipt(first.toString());
  const campaign = await readRecoveryCampaign(fixture.directory);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.definitionSha256, campaign.definition.sha256);
  assert.deepEqual(failed.report, campaign.trials[0].reportRef);
  assert.equal(failed.protocolId, campaign.definition.protocol.id);
  assert.equal(failed.trialId, campaign.trials[0].id);
  assert.equal(failed.candidateId, CANDIDATE);
  assert.equal(failed.sessionId, SESSION);
  assert.equal(failed.source.commit, '1'.repeat(40));
  assert.equal(Object.hasOwn(failed, 'publicationId'), false);
  assert.equal(Object.hasOwn(failed, 'componentId'), false);
  assert.equal(campaign.trials[0].status, 'failed');
  assert.equal(campaign.summary.acceptedDeliveries, 0);
  assert.equal(campaign.summary.donorAcceptances, 1);
  assert.deepEqual(await readFile(join(fixture.directory, 'journal.json')), fixture.journal);
  await assert.rejects(() => deliverAcceptedRecovery({
    campaignDirectory: fixture.directory, outDirectory: out, integrate: async () => { calls += 1; return deliveryResult(); },
    openPublication: () => publicationStore(), source: { commit: '1'.repeat(40), hash: '2'.repeat(64) },
  }), /already exists and was not overwritten/);
  assert.equal(calls, 1);
  assert.deepEqual(await readFile(receiptPath), first);
  assert.deepEqual(await readFile(join(fixture.directory, 'journal.json')), fixture.journal);
});

test('a local fixture and an occupied receipt are not rewritten into a delivery', async t => {
  const fixture = await failedCampaign(async () => acceptedReport({ origin: 'local-verification' }));
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const out = join(fixture.root, 'out');
  await assert.rejects(() => deliverAcceptedRecovery({
    campaignDirectory: fixture.directory, outDirectory: out, integrate: async () => { throw Error('should not integrate'); },
  }), /Local fixtures are not accepted recovery deliveries/);
  await assert.rejects(() => stat(join(out, 'delivery-receipt.json')), error => error.code === 'ENOENT');
  const occupied = join(fixture.root, 'occupied');
  await mkdir(occupied);
  await writeFile(join(occupied, 'delivery-receipt.json'), '{}\n');
  await assert.rejects(() => deliverAcceptedRecovery({
    campaignDirectory: fixture.directory, outDirectory: occupied, integrate: async () => { throw Error('should not integrate'); },
  }), /already exists and was not overwritten/);
  assert.equal(await readFile(join(occupied, 'delivery-receipt.json'), 'utf8'), '{}\n');
  assert.deepEqual(await readFile(join(fixture.directory, 'journal.json')), fixture.journal);
});

test('delivery binds the accepted trial to a new publication and reloads it', async t => {
  const fixture = await failedCampaign();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const out = join(fixture.root, 'published');
  const result = await deliverAcceptedRecovery({
    campaignDirectory: fixture.directory, outDirectory: out, integrate: async () => deliveryResult(), openPublication: () => publicationStore(),
  });
  const campaign = await readRecoveryCampaign(fixture.directory);
  const receipt = verifyDeliveryReceipt(await readFile(result.receiptPath, 'utf8'));
  assert.equal(result.status, 'delivered');
  assert.equal(result.nodeChecks, 3);
  assert.equal(result.browserChecks, 7);
  assert.equal(receipt.status, 'delivered');
  assert.equal(receipt.definitionSha256, campaign.definition.sha256);
  assert.deepEqual(receipt.report, campaign.trials[0].reportRef);
  assert.equal(digest(await readFile(join(fixture.directory, receipt.report.path))), receipt.report.sha256);
  assert.equal(receipt.protocolId, campaign.definition.protocol.id);
  assert.equal(receipt.trialId, campaign.trials[0].id);
  assert.equal(receipt.componentId, COMPONENT);
  assert.equal(receipt.candidateId, CANDIDATE);
  assert.equal(receipt.sessionId, SESSION);
  assert.equal(receipt.publicationId, result.publicationId);
  assert.equal(receipt.packageId, PACKAGE);
  assert.equal(receipt.zipSha256, ZIP);
  assert.equal(receipt.nodeChecks, 3);
  assert.equal(receipt.browserChecks, 7);
  const source = await deliverySource();
  assert.equal(receipt.source.commit, execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
  assert.equal(receipt.source.hash, source.hash);
  assert.match(receipt.source.hash, /^[a-f0-9]{64}$/);
  assert.equal(campaign.trials[0].status, 'failed');
  assert.equal(campaign.summary.acceptedDeliveries, 0);
  assert.equal(campaign.summary.failureCategories['recipient-or-export'], 1);
  assert.equal(campaign.summary.interval, null);
  assert.deepEqual(await readFile(join(fixture.directory, 'journal.json')), fixture.journal);
  await assert.rejects(() => deliverAcceptedRecovery({
    campaignDirectory: fixture.directory, outDirectory: join(fixture.directory, 'inside'), integrate: async () => deliveryResult(),
  }), /outside the campaign/);
});
