import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { digest } from '../src/component/build.mjs';
import { benchmarkDefinition } from '../src/benchmark/definition.mjs';
import { benchmarkStore } from '../src/benchmark/store.mjs';
import { developerBenchmarkAssets } from '../src/benchmark/assets.mjs';
import { createPakuBrowser } from '../src/evaluator/browser-harness.mjs';
import { reveal } from './helpers/app-navigation.mjs';

async function localFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'benchmark-ui-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = benchmarkStore(directory, { savedDirectory: join(directory, 'saved') });
  const campaign = await store.create(benchmarkDefinition({ componentId: 'a'.repeat(64) }, { id: randomUUID(), origin: 'local-verification' }));
  const verification = { conformance: { passed: true, results: [{ name: 'route fixture only', passed: true }] },
    browser: { passed: true, results: [{ name: 'not a gameplay verification', passed: true }] } };
  const artifactRef = await store.saveEvidence(campaign.id, { html: '<!doctype html><title>Local route fixture</title><p>Protocol fixture only</p>', evaluation: verification });
  const jobRef = await store.saveEvidence(campaign.id, { origin: 'local-verification', error: 'Injected lost direction after second edit' });
  const measurements = { passed: true, issues: [], origin: 'local-verification', modelRequests: 0, estimatedCostUsd: 0,
    reservedCostUsd: 0, elapsedMachineMs: 1200, evaluations: [], manualInterventionsDuringRun: 0,
    interventionScope: 'Local UI fixture only; no model or gameplay result.' };
  const attempt = stage => {
    const request = { idempotencyKey: randomUUID() };
    return { id: randomUUID(), stage, status: 'completed', maxCostUsd: 0.03, request, requestSha256: digest(JSON.stringify(request)), measurements };
  };
  campaign.attempts = [attempt('roadster'), { ...attempt('paku-first'), artifactRef },
    { ...attempt('paku-final'), jobRef, status: 'failed', measurements: { ...measurements, passed: false, issues: ['Injected lost direction after second edit'],
      evaluations: [{ name: 'local protocol fixture', observedCases: 1, failedCases: 1, maxPositionError: 12, firstFailures: [{ name: 'direction', firstDivergence: { frame: 1 } }], error: null }] } }];
  campaign.status = 'incomplete'; await store.write(campaign);
  return { directory, store, campaign, assets: developerBenchmarkAssets({ directory, savedDirectory: join(directory, 'saved') }) };
}

test('benchmark routes verify evidence, block unverified play and preserve sandboxed read-only access', async t => {
  const { directory, store, campaign, assets } = await localFixture(t);
  const attempt = campaign.attempts[1], base = '/api/developer-benchmarks/' + campaign.id + '/' + attempt.id;
  const index = JSON.parse((await assets('/api/developer-benchmarks')).body);
  assert.equal(index[0].summary.completedTasks, 1);
  assert.equal(index[0].summary.tasks[2].partial, true);
  assert.equal(JSON.parse((await assets(base + '/source')).body).evaluation.browser.passed, true);
  const failed = campaign.attempts[2];
  assert.match(JSON.parse((await assets('/api/developer-benchmarks/' + campaign.id + '/' + failed.id + '/report')).body).error, /Injected lost direction/);
  assert.equal((await assets('/developer-benchmarks/' + campaign.id + '/' + attempt.id + '/play.html')).sandbox, true);
  const bad = await store.saveEvidence(campaign.id, { html: '<p>Failed fixture</p>', evaluation: { conformance: { passed: true, results: [{ passed: false }] }, browser: { passed: true, results: [] } } });
  attempt.artifactRef = bad; await store.write(campaign);
  await assert.rejects(assets('/developer-benchmarks/' + campaign.id + '/' + attempt.id + '/play.html'), /Only verified/);
  await writeFile(join(directory, campaign.id, 'evidence', bad.sha256 + '.json'), '{}');
  await assert.rejects(assets(base + '/source'), /integrity/);
});

test('React task results label local fixtures, expose partial failure and fit mobile without inference', async t => {
  const { campaign, assets } = await localFixture(t);
  const harness = await createPakuBrowser({ benchmarks: assets });
  try {
    const { page, errors } = await harness.page(), methods = [];
    page.on('request', request => methods.push(request.method()));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(harness.origin + '/?destination=jujump#developer-benchmarks');
    await reveal(page, '#benchmark-tasks');
    await page.locator('#developer-benchmarks summary').filter({ hasText: 'Setup effort, protocol and measurement limits' }).click();
    await page.waitForFunction(() => document.querySelector('.benchmark-attempt'));
    assert.match(await page.locator('#developer-benchmarks').textContent(), /HUMAN-SCRIPTED LOCAL VERIFICATION/);
    assert.match(await page.locator('#benchmark-summary').textContent(), /1 \/ 2 attempted tasks completed/);
    assert.match(await page.locator('#benchmark-tasks').textContent(), /Partial/);
    assert.match(await page.locator('#developer-benchmarks').textContent(), /Historical setup effort is unmeasured/);
    await page.locator('.benchmark-attempt').last().locator('summary').first().click();
    assert.match(await page.locator('.benchmark-attempt').last().textContent(), /Injected lost direction/);
    assert.equal(await page.getByText('Full task report and investigation evidence').count(), 1);
    assert.equal(await page.locator('a').filter({ hasText: 'Play recorded output' }).count(), 1);
    const play = '/developer-benchmarks/' + campaign.id + '/' + campaign.attempts[1].id + '/play.html';
    const response = await fetch(harness.origin + play);
    assert.equal(response.headers.get('content-security-policy'), 'sandbox allow-scripts');
    const post = await fetch(harness.origin + '/api/developer-benchmarks', { method: 'POST' });
    assert.equal(post.status, 404);
    await page.getByRole('button', { name: 'Refresh measured results' }).click();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    assert.ok(methods.every(method => method === 'GET'));
    assert.deepEqual(errors, []);
  } finally { await harness.close(); }
});
