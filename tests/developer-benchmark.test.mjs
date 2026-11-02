import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { benchmarkDefinition, stageDefinition } from '../benchmark/definition.mjs';
import { benchmarkStore } from '../benchmark/store.mjs';
import { campaignMetrics, measureTaskAttempt } from '../benchmark/metrics.mjs';
import { runDeveloperBenchmark } from '../benchmark/runner.mjs';

const componentId = 'a'.repeat(64), protocol = { sha256: 'b'.repeat(64), commit: 'local-fixture' };
const snapshot = { componentId, roadsterParentId: 'c'.repeat(64), pakuParentId: 'd'.repeat(64) };
const suite = { passed: true, results: [{ name: 'injected protocol fixture, not browser verification', passed: true }] };
function fixtureTransport({ failRecovery = false, lostResponse = false, unknownBilling = false } = {}) {
  const jobs = new Map(), artifacts = new Map(); let posts = 0, lost = false;
  return { origin: 'local-verification', get posts() { return posts; },
    status: async () => ({ activeRunId: null, unsettled: false, budget: { remainingUsd: 10 } }),
    submit: async (stage, request) => {
      posts++; const id = randomUUID(), failed = stage === 'recovery' && failRecovery;
      const report = { model: 'none', origin: 'local-verification', estimatedCostUsd: 0.01, reservedCostUsd: unknownBilling ? 0.02 : 0,
        requests: [], session: { recovery: { attempts: [{ attempt: 1, candidateId: componentId, development: suite, acceptance: suite }], acceptedAttempt: 1, frozenCandidateId: componentId } } };
      const job = { id, request, status: failed ? 'failed' : 'ready', error: failed ? 'Injected pre-acceptance fixture failure' : null, report,
        events: [{ at: '2026-11-02T00:00:00Z' }, { at: '2026-11-02T00:00:02Z' }], artifactId: id.replaceAll('-', '').padEnd(64, '0') };
      if (stage === 'recovery') {
        job.task = { integration: { id: componentId, componentId, packageId: componentId, zipSha256: componentId } };
        artifacts.set(id, { verification: { passed: true, candidateId: componentId, componentId, packageId: componentId, zipSha256: componentId,
          nodeChecks: { passed: true, count: 3 }, browser: { passed: true, results: Array.from({ length: 7 }, () => ({ passed: true })) } } });
      } else {
        const artifact = { id: job.artifactId, intent: stageDefinition(stage).expectedIntent, componentId, parentArtifactId: request.parentArtifactId,
          evaluation: { conformance: suite, browser: suite } };
        if (stage === 'roadster') artifact.files = { 'verification.json': JSON.stringify(artifact.evaluation) };
        artifacts.set(id, artifact);
      }
      jobs.set(id, job);
      if (lostResponse && !lost) { lost = true; throw Error('Injected response loss after durable admission'); }
      return job;
    },
    run: async (stage, id) => jobs.get(id),
    findSubmitted: async (stage, request) => [...jobs.values()].find(job => job.request.idempotencyKey === request.idempotencyKey),
    evidenceJob: async (stage, job) => job,
    artifact: async (stage, job) => artifacts.get(job.id),
  };
}
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'developer-benchmark-')), store = benchmarkStore(directory, { savedDirectory: join(directory, 'saved') });
  t.after(() => rm(directory, { recursive: true, force: true }));
  const campaign = await store.create(benchmarkDefinition(snapshot, { id: randomUUID(), origin: 'local-verification' }));
  return { directory, store, campaignId: campaign.id };
}

test('predefined task outcomes measure request correctness, partial lineage and all trial costs', async t => {
  const { store, campaignId } = await setup(t), transport = fixtureTransport();
  const result = await runDeveloperBenchmark({ store, campaignId, transport, protocol, wait: async () => {} });
  assert.equal(result.status, 'completed'); assert.equal(result.summary.completedTasks, 3); assert.equal(transport.posts, 4);
  assert.equal(result.summary.estimatedCostUsd, 0.04); assert.equal(result.summary.manualTimeSavedMinutes, null);
  const final = result.attempts.find(attempt => attempt.stage === 'paku-final');
  assert.equal(final.request.parentArtifactId, result.attempts.find(attempt => attempt.stage === 'paku-first').artifactId);
  const artifact = await store.evidence(campaignId, final.artifactRef.sha256), job = await store.evidence(campaignId, final.jobRef.sha256);
  artifact.intent = { ...artifact.intent, direction: 'facing' };
  assert.equal(measureTaskAttempt(final.stage, job, artifact, result.definition, final.request).passed, false);
  final.measurements.passed = false; final.status = 'failed';
  const measured = campaignMetrics(result);
  assert.equal(measured.completedTasks, 2); assert.equal(measured.tasks[2].partial, true);
  assert.equal(measured.estimatedCostUsd, 0.04);
  const resumed = await runDeveloperBenchmark({ store, campaignId, transport, protocol });
  assert.equal(resumed.summary.completedTasks, 3); assert.equal(transport.posts, 4, 'Completed jobs must not repeat');
});

test('lost admission responses recover the existing job through reads without another POST', async t => {
  const options = await setup(t), transport = fixtureTransport({ lostResponse: true });
  await assert.rejects(runDeveloperBenchmark({ ...options, transport, protocol }), /response loss/);
  assert.equal(transport.posts, 1);
  const stopped = await options.store.read(options.campaignId); assert.equal(stopped.summary.committedUsd, 0.5);
  const resumed = await runDeveloperBenchmark({ ...options, transport, protocol });
  assert.equal(resumed.summary.completedTasks, 3); assert.equal(transport.posts, 4);
});

test('a failed recovery never automatically resamples and a changed protocol needs a logged local fix', async t => {
  const options = await setup(t), transport = fixtureTransport({ failRecovery: true });
  const first = await runDeveloperBenchmark({ ...options, transport, protocol });
  assert.equal(first.status, 'incomplete'); assert.equal(first.summary.completedTasks, 2);
  await runDeveloperBenchmark({ ...options, transport, protocol }); assert.equal(transport.posts, 4);
  await assert.rejects(runDeveloperBenchmark({ ...options, transport, protocol, recoveryFix: { note: 'No source change', validation: { sha256: componentId } } }), /changed protocol/);
  const next = await runDeveloperBenchmark({ ...options, transport, protocol: { ...protocol, sha256: 'e'.repeat(64) },
    recoveryFix: { note: 'Injected local protocol repair, not a real model result.', validation: { sha256: componentId } } });
  assert.equal(next.summary.recoveryTrials, 2); assert.equal(next.interventions.length, 1); assert.equal(transport.posts, 5);
  assert.equal(next.summary.estimatedCostUsd, 0.05);
});

test('unknown billing stops the campaign and all existing ceilings remain intact', async t => {
  const options = await setup(t), transport = fixtureTransport({ unknownBilling: true });
  await assert.rejects(runDeveloperBenchmark({ ...options, transport, protocol }), /Billing is uncertain/);
  assert.equal(transport.posts, 1);
  const saved = await options.store.read(options.campaignId);
  assert.equal(saved.summary.providerReservedUsd, 0.02); assert.equal(saved.summary.committedUsd, 0.5);
  assert.equal(saved.definition.additionalLimitUsd, 2);
  await assert.rejects(runDeveloperBenchmark({ ...options, transport, protocol }), /Billing is uncertain/);
  assert.equal(transport.posts, 1, 'Uncertain billing must block other tasks across runner restarts');
});

test('journal and evidence tampering fail without falling back to a successful recording', async t => {
  const { directory, store, campaignId } = await setup(t);
  const evidence = await store.saveEvidence(campaignId, { actual: 'finite fixture' });
  await writeFile(join(directory, campaignId, 'evidence', evidence.sha256 + '.json'), '{}');
  await assert.rejects(store.evidence(campaignId, evidence.sha256), /integrity/);
  const path = join(directory, campaignId, 'journal.json'), value = JSON.parse(await readFile(path, 'utf8'));
  value.status = 'completed'; await writeFile(path, JSON.stringify(value));
  await assert.rejects(store.read(campaignId), /integrity/);
});

test('measurements use the frozen task definition and do not invent missing usage', async t => {
  const { store, campaignId } = await setup(t), transport = fixtureTransport();
  const campaign = await runDeveloperBenchmark({ store, campaignId, transport, protocol });
  const attempt = campaign.attempts.find(item => item.stage === 'roadster');
  const job = await store.evidence(campaignId, attempt.jobRef.sha256);
  const artifact = await store.evidence(campaignId, attempt.artifactRef.sha256);
  const definition = structuredClone(campaign.definition);
  definition.tasks.find(task => task.id === 'roadster').expectedIntent.direction = 'facing';
  job.report.requests = [{ usage: { inputTokens: 10 } }];
  const result = measureTaskAttempt('roadster', job, artifact, definition, attempt.request);
  assert.equal(result.passed, false);
  assert.equal(result.tokens.inputTokens, 10);
  assert.equal(result.tokens.outputTokens, null);
  artifact.evaluation.browser.results[0].passed = false;
  artifact.files['verification.json'] = JSON.stringify(artifact.evaluation);
  assert.match(measureTaskAttempt('roadster', job, artifact, campaign.definition, attempt.request).issues.join(' '), /browser checks failed/);
});
