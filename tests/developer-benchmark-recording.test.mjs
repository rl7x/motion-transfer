import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { benchmarkStore } from '../benchmark/store.mjs';
import { measureTaskAttempt } from '../benchmark/metrics.mjs';
import { developerBenchmarkAssets } from '../benchmark/assets.mjs';

test('published campaign preserves the actual two successes and three failed recoveries without inference', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'saved-developer-campaign-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = benchmarkStore(directory), campaigns = await store.list();
  const campaign = campaigns.find(item => item.id === 'eb9ac874-30ad-4a0b-9bcc-78f8c25f539a');
  assert.equal(campaign.definition.origin, 'fresh-meta'); assert.equal(campaign.status, 'incomplete');
  assert.equal(campaign.summary.completedTasks, 2); assert.equal(campaign.summary.recoveryTrials, 3);
  assert.equal(campaign.summary.providerReservedUsd, 0);
  assert.ok(Math.abs(campaign.summary.estimatedCostUsd - 0.7299162) < 1e-9);
  assert.equal(campaign.interventions.length, 2); assert.equal(campaign.summary.manualTimeSavedMinutes, null);
  const assets = developerBenchmarkAssets({ directory });
  let modelRequests = 0;
  for (const attempt of campaign.attempts) {
    const job = await store.evidence(campaign.id, attempt.jobRef.sha256);
    const artifact = attempt.artifactRef ? await store.evidence(campaign.id, attempt.artifactRef.sha256) : null;
    assert.deepEqual(measureTaskAttempt(attempt.stage, job, artifact, campaign.definition, attempt.request), attempt.measurements);
    modelRequests += attempt.measurements.modelRequests;
    if (attempt.stage === 'recovery') {
      assert.equal(attempt.status, 'failed'); assert.equal(attempt.acceptanceStarted, false);
      assert.equal(job.report.session.recovery.attempts.length, 0); assert.equal(artifact, null);
    } else {
      assert.equal(attempt.status, 'completed');
      const play = await assets('/developer-benchmarks/' + campaign.id + '/' + attempt.id + '/play.html');
      assert.equal(play.sandbox, true); assert.ok(play.body.length > 10000);
      assert.equal(artifact.componentId, campaign.definition.snapshot.componentId);
    }
    const report = await assets('/api/developer-benchmarks/' + campaign.id + '/' + attempt.id + '/report');
    assert.equal(JSON.parse(report.body).id, attempt.jobId);
  }
  assert.equal(modelRequests, 38);
  assert.equal(campaign.attempts.find(attempt => attempt.stage === 'paku-final').request.parentArtifactId,
    campaign.attempts.find(attempt => attempt.stage === 'paku-first').artifactId);
});
