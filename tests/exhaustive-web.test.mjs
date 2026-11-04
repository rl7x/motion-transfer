import assert from 'node:assert/strict';
import test from 'node:test';
import { createPakuBrowser } from '../src/evaluator/browser-harness.mjs';

test('the standalone evidence replay fills the grid and exposes the recorded counterexample', async () => {
  const harness = await createPakuBrowser();
  try {
    const { page, errors } = await harness.page();
    await page.setViewportSize({ width: 1280, height: 900 });
    let posts = 0;
    page.on('request', request => { if (request.method() === 'POST') posts++; });
    await page.goto(harness.origin + '/?view=exhaustive');
    await page.getByRole('heading', { name: 'Every reachable dash transition.' }).waitFor();
    assert.equal(await page.getByTestId('state-count').textContent(), '0 / 275');
    await page.getByRole('button', { name: 'Play evidence replay' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.ex-cell.checked').length > 0);
    await page.getByRole('button', { name: 'Pause replay' }).click();
    const paused = await page.getByTestId('state-count').textContent();
    await page.waitForTimeout(100);
    assert.equal(await page.getByTestId('state-count').textContent(), paused);
    await page.getByRole('button', { name: 'Show result' }).click();
    assert.equal(await page.locator('.ex-cell.checked').count(), 275);
    assert.equal(await page.locator('.ex-cell.failed').count(), 1);
    assert.match(await page.getByTestId('counterexample-verdict').textContent(), /Tick 11: the binary dashes right/);
    assert.equal(await page.locator('.ex-replay img').evaluate(image => image.complete && image.naturalWidth === 160), true);
    assert.equal(await page.locator('.ex-limits li').count(), 4);
    if (process.env.EXHAUSTIVE_SCREENSHOT) await page.screenshot({ path: process.env.EXHAUSTIVE_SCREENSHOT, fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    assert.equal(await page.getByTestId('state-count').textContent(), '0 / 275');
    assert.equal(posts, 0);
    assert.deepEqual(errors, []);
  } finally { await harness.close(); }
});
