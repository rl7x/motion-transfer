import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createPakuBrowser } from '../evaluator/browser-harness.mjs';
import { reveal } from './helpers/app-navigation.mjs';

test('the developer task links a verified download and working standalone comparison without inference', async () => {
  const harness = await createPakuBrowser();
  try {
    const { page, errors } = await harness.page();
    const requests = []; page.on('request', request => requests.push(request.method()));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(harness.origin + '/?destination=paku-paku#developer-task');
    await reveal(page, '#developer-download');
    await reveal(page, '#developer-history');
    await reveal(page, '#developer-effort');
    assert.match(await page.locator('#developer-recovery').textContent(), /53 saved traces/);
    assert.match(await page.locator('#developer-history').textContent(), /1 candidate failing acceptance/);
    assert.match(await page.locator('#developer-effort').textContent(), /time savings were not measured/);
    await page.locator('#developer-select').click();
    await page.waitForFunction(() => window.currentDestination === 'jujump' && document.querySelector('#transfer-status').textContent === 'VERIFIED TRANSFER');
    const task = await (await fetch(harness.origin + '/api/developer-task')).json();
    assert.equal(task.verification.kind, 'human-scripted-standalone-verification');
    assert.equal(task.verification.browserChecks, 7);
    const verification = await (await fetch(harness.origin + task.verification.report)).json();
    assert.equal(verification.packageId, task.package.id);
    assert.equal(verification.zipSha256, task.package.sha256);
    assert.equal(task.package.play, '/integrations/jujump/index.html');
    const response = await fetch(harness.origin + task.package.download);
    assert.equal(response.headers.get('content-type'), 'application/zip');
    assert.match(response.headers.get('content-disposition'), /attachment; filename="jujump-dash.zip"/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, task.package.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), task.package.sha256);
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 812 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.goto(harness.origin + task.package.play);
    await page.locator('#compare').click();
    await page.waitForFunction(() => document.querySelector('#measurements-summary').textContent.startsWith('PASS'));
    assert.match(await page.locator('#measurements-summary').textContent(), /8 → 30 horizontal pixels/);
    assert.deepEqual(errors, []); assert.ok(requests.every(method => method === 'GET'));
  } finally { await harness.close(); }
});
