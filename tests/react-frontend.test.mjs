import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLabService } from '../lab/service.mjs';
import { createPakuBrowser } from '../evaluator/browser-harness.mjs';

test('an offscreen Roadster receives visibility after delayed player initialization', async () => {
  const harness = await createPakuBrowser();
  try {
    const { page } = await harness.page();
    await page.setViewportSize({ width: 1200, height: 400 });
    await page.addInitScript(() => {
      window.visibilityEvidence = [];
      window.addEventListener('message', event => {
        if (event.data?.type === 'roadster-visibility')
          window.visibilityEvidence.push({ ready: window.roadsterReady === true, visible: event.data.pressed });
      });
    });
    await page.route('**/roadster/artifacts/*/play.html*', async route => {
      const response = await route.fetch();
      const body = (await response.text()).replace('<script>', '<script>setTimeout(() => {').replace('</script>', '}, 400);</script>');
      await route.fulfill({ response, body });
    });
    await page.goto(harness.origin);
    await page.waitForFunction(() => document.querySelector('#transfer-status').textContent === 'VERIFIED TRANSFER');
    const frame = await (await page.$('#transfer-game')).contentFrame();
    await frame.waitForFunction(() => window.visibilityEvidence.some(event => event.ready && event.visible === false));
    assert.equal(await frame.evaluate(() => window.visibilityEvidence.at(-1).visible), false);
  } finally { await harness.close(); }
});

test('a failed status read reconnects through GET without submitting another paid job', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'react-job-read-'));
  let calls = 0;
  const lab = await createLabService({ directory, client: {}, investigateRun: async () => {
    calls++;
    return { status: 'completed', estimatedCostUsd: 0.01, reservedCostUsd: 0, requests: [], toolCalls: [], conclusion: 'Injected read reconnection fixture', conclusionVerified: false };
  } });
  const harness = await createPakuBrowser({ lab });
  try {
    const { page, errors } = await harness.page();
    let posts = 0;
    page.on('request', request => { if (request.method() === 'POST') posts++; });
    await page.goto(harness.origin + '/?destination=paku-paku');
    await page.route(/\/api\/investigations\/[a-f0-9-]{36}$/, route => route.abort('failed'), { times: 1 });
    await page.waitForFunction(() => !document.querySelector('#investigation-submit').disabled);
    await page.locator('#investigation-submit').click();
    await page.waitForFunction(() => document.querySelector('#investigation-submit').textContent.includes('Reconnect') && !document.querySelector('#investigation-submit').disabled);
    await page.locator('#investigation-submit').click();
    await page.waitForFunction(() => document.querySelector('#investigation-conclusion').textContent.includes('Injected read reconnection fixture'));
    assert.equal(posts, 1); assert.equal(calls, 1); assert.deepEqual(errors, []);
  } finally { await harness.close(); await lab.close(); await rm(directory, { recursive: true, force: true }); }
});

test('React status renders preserve the running iframe and browser navigation selects the correct recipient', async () => {
  const harness = await createPakuBrowser();
  try {
    const { page, errors } = await harness.page();
    let reads = 0;
    page.on('response', response => { if (response.url().endsWith('/api/lab/status')) reads++; });
    await page.goto(harness.origin + '/?destination=paku-paku');
    await page.waitForFunction(() => window.currentDestination === 'paku-paku' && document.querySelector('#transfer-status').textContent === 'VERIFIED TRANSFER');
    const frame = await (await page.$('#transfer-game')).contentFrame();
    await frame.evaluate(() => { window.reactPlayerSession = 'retained'; });
    const initial = reads;
    await page.waitForResponse(response => response.url().endsWith('/api/lab/status'));
    await page.waitForResponse(response => response.url().endsWith('/api/lab/status'));
    assert.ok(reads >= initial + 2);
    assert.equal(await frame.evaluate(() => window.reactPlayerSession), 'retained');
    await page.locator('[data-destination="jujump"]').click();
    await page.waitForFunction(() => window.currentDestination === 'jujump');
    await page.goBack();
    await page.waitForFunction(() => window.currentDestination === 'paku-paku' && document.querySelector('#transfer-status').textContent === 'VERIFIED TRANSFER');
    assert.equal(await page.locator('#recipient-title').textContent(), 'PAKU PAKU');
    assert.deepEqual(errors, []);
  } finally { await harness.close(); }
});
