import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createPreviewServer } from '../web/server.mjs';

const software = process.argv.includes('--software');
const server = await createPreviewServer();
let browser;
const started = performance.now();
const report = { schemaVersion: 1, kind: 'local-guided-demo-verification', metaCalled: false,
  rendering: software ? 'forced-swiftshader' : 'browser-default', passed: false };
try {
  browser = await chromium.launch({ headless: true,
    ...(software ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : { channel: process.env.BROWSER_CHANNEL || 'chrome' }) });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const posts = [], errors = [];
  page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.origin);
  await page.waitForFunction(() => document.querySelector('#transfer-status')?.textContent === 'VERIFIED TRANSFER');
  report.loadedMs = Math.round(performance.now() - started);
  const guidedAt = performance.now();
  await page.locator('#watch-transfer').click();
  try {
    await page.waitForFunction(() => ['complete', 'failed'].includes(window.guidedState?.phase), {}, { timeout: 60000 });
  } finally { report.guidedMs = Math.round(performance.now() - guidedAt); report.state = await page.evaluate(() => window.guidedState); }
  assert.equal(report.state.phase, 'complete', report.state.error);
  assert.equal(report.state.activeUpdates, 8);
  assert.ok(Math.abs(report.state.measuredMeters - 6) < 1e-8);
  assert.deepEqual(posts, []); assert.deepEqual(errors, []);
  report.passed = true;
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  report.elapsedMs = Math.round(performance.now() - started);
  await mkdir(new URL('../reports/', import.meta.url), { recursive: true });
  await writeFile(new URL('../reports/guided-demo-' + (software ? 'software' : 'default') + '.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, state: report.state ? { ...report.state, trace: undefined } : undefined }));
  await browser?.close(); await server.close();
}
