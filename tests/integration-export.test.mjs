import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildJujumpIntegration } from '../src/integration/jujump.mjs';
import { projectZip } from '../src/integration/archive.mjs';
import { loadJujumpAdapter } from '../src/transfer/jujump.mjs';
import { verifyJujumpBrowser } from '../src/evaluator/jujump-browser.mjs';
import { extractIntegration, serveIntegration, integrationBrowser, exec, cleanEnv } from '../src/evaluator/integration-harness.mjs';

test('the deterministic ZIP preserves exact component identity and detects edits after extraction', async () => {
  const project = await buildJujumpIntegration(), again = await buildJujumpIntegration();
  assert.equal(project.manifest.id, again.manifest.id); assert.deepEqual(project.zip, again.zip);
  assert.equal(project.caseStudy.measurements.manualTimeSavedMinutes, null);
  assert.equal(project.caseStudy.recovery.attempts[0].acceptancePassed, false);
  assert.ok(project.caseStudy.recovery.attempts[0].firstFailure);
  assert.ok(!Object.keys(project.files).some(path => path.endsWith('.wasm') || path.includes('.env')));
  const extracted = await extractIntegration(project);
  try {
    const result = await exec(process.execPath, ['--test', '--test-reporter=tap', 'verify.test.mjs'], { cwd: extracted.directory, env: cleanEnv() });
    assert.match(result.stdout, /# pass 3/);
    const component = join(extracted.directory, 'component/component.js');
    assert.equal(await readFile(component, 'utf8'), project.files['component/component.js']);
    await writeFile(component, project.files['component/component.js'] + '\n// changed\n');
    await assert.rejects(exec(process.execPath, ['--test', '--test-reporter=tap', 'verify.test.mjs'], { cwd: extracted.directory, env: cleanEnv() }), error => error.stdout.includes('Modified file: component/component.js'));
  } finally { await extracted.close(); }
  for (const path of ['../secret', '/secret', 'a/../../secret', 'a//b', 'a\\b']) assert.throws(() => projectZip({ [path]: 'x' }), /Invalid project path/);
});

test('the actual downloaded project passes all seven recipient checks on its own server', async () => {
  const project = await buildJujumpIntegration(), extracted = await extractIntegration(project);
  let server, harness;
  try {
    server = await serveIntegration(extracted.directory); harness = await integrationBrowser(server.origin);
    const report = await verifyJujumpBrowser(await loadJujumpAdapter(), {
      createHarness: async () => ({ ...harness, close: async () => {} }),
      playerPath: mode => `/${mode === 'original' ? 'original' : 'transferred'}.html?mode=${mode}&test=1`,
    });
    assert.equal(report.passed, true, JSON.stringify(report.results.filter(result => !result.passed)));
    assert.equal(report.results.length, 7);
    assert.equal((await fetch(server.origin + '/api/lab/status')).status, 404);
    assert.equal((await fetch(server.origin + '/.env')).status, 404);
    assert.equal((await fetch(server.origin + '/manifest.json', { method: 'POST' })).status, 404);
    assert.deepEqual(harness.externalRequests, []); assert.ok(harness.methods.every(method => method === 'GET'));
  } finally { await harness?.close(); await server?.close(); await extracted.close(); }
});

test('the downloaded example measures real before/after motion and supports mobile touch', async () => {
  const project = await buildJujumpIntegration(), extracted = await extractIntegration(project);
  let server, harness;
  try {
    server = await serveIntegration(extracted.directory); harness = await integrationBrowser(server.origin);
    const { page, errors } = await harness.page({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
    await page.goto(server.origin);
    await page.locator('#compare').tap();
    await page.waitForFunction(() => document.querySelector('#measurements-summary').textContent.startsWith('PASS'));
    assert.match(await page.locator('#measurements-summary').textContent(), /8 → 30 horizontal pixels/);
    const report = await page.evaluate(async () => (await fetch(document.querySelector('#measurements').href)).json());
    assert.equal(report.metaCalled, false); assert.equal(report.packageId, project.manifest.id);
    assert.equal(report.before.length, 9); assert.equal(report.after.length, 9);
    assert.ok(report.metrics.maxVerticalDifference < 1e-9);
    await page.locator('#resume').tap();
    await page.waitForFunction(() => !document.querySelector('[data-frame="after"]').disabled);
    const frame = await (await page.$('#after')).contentFrame();
    await frame.goto(server.origin + '/transferred.html?mode=transfer&test=1');
    await frame.waitForFunction(() => window.jujumpReady === true);
    const jump = page.locator('[data-frame="after"][data-key="Space"]');
    await jump.scrollIntoViewIfNeeded();
    const touch = await page.context().newCDPSession(page);
    const hold = async (button, condition) => {
      await button.scrollIntoViewIfNeeded(); const box = await button.boundingBox();
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }] });
      if (condition) await frame.waitForFunction(condition);
    };
    await hold(jump); await frame.evaluate(() => gameClock.advance());
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await frame.evaluate(() => { gameClock.advance(11); jujumpFixture({ p: { x: 30, y: 20 }, v: { x: 1, y: 0.5 }, floors: [], jumpWay: 1, floorAppDist: 99999 }); });
    await hold(page.locator('[data-key="KeyD"]'), () => motionPort.snapshot().dashHeld === true);
    await frame.evaluate(() => gameClock.advance(8));
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await frame.waitForFunction(() => motionPort.snapshot().dashHeld === false);
    assert.equal(await frame.evaluate(() => jujumpSnapshot().p.x), 60);
    for (const width of [375, 320]) { await page.setViewportSize({ width, height: 812 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
    assert.deepEqual(errors, []); assert.deepEqual(harness.externalRequests, []);
  } finally { await harness?.close(); await server?.close(); await extracted.close(); }
});
