import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { loadSavedRoadster } from '../src/roadster/saved.mjs';
import { buildRoadsterChallenge } from '../src/roadster/challenge.mjs';
import { landingInTarget } from '../src/roadster/challenge-contract.mjs';
import { digest } from '../src/component/build.mjs';

test('the exact native input trace lands short and the same trace plus the borrowed dash reaches the marked zone', async () => {
  const parent = await loadSavedRoadster(), challenge = await buildRoadsterChallenge({ parent });
  const report = challenge.verification;
  assert.equal(report.passed, true);
  assert.equal(report.ordinaryOutsideTarget, true);
  assert.equal(report.borrowedInsideTarget, true);
  assert.equal(report.maxVerticalDifference < 1e-8, true);
  assert.equal(report.measurement.controls.length, 766);
  assert.equal(report.measurement.dashTick, 636);
  assert.equal(report.measurement.baseline.landing.result.grade, 'perfect');
  assert.equal(report.measurement.transferred.landing.result.grade, 'perfect');
  assert.ok(Math.abs(report.measurement.baseline.landing.position.x + 49.46847388339292) < 1e-8);
  assert.ok(Math.abs(report.measurement.transferred.landing.position.x + 41.37543628862018) < 1e-8);
  assert.equal(digest(challenge.files['play.html']), report.frameSha256);
  const active = report.measurement.transferred.frames.filter(frame => frame.motion.output?.ownsMotion);
  assert.equal(active.length, 8);
  assert.equal(active.reduce((sum, frame) => sum + frame.motion.output.displacement, 0), 6);
  assert.notEqual(report.netLandingShiftMeters, 6, 'Net landing shift includes displaced native horizontal motion');
  assert.notDeepEqual(report.measurement.baseline.frames[0].car.position, report.measurement.baseline.frames.at(-1).car.position,
    'Recorded frames must be immutable snapshots');
  assert.equal(landingInTarget({ type: 'crash', position: { x: -41 } }), false);
  assert.equal(landingInTarget({ type: 'land', position: { x: -41 } }), true);
});

test('standalone challenge replays actual native landings and supports an interactive dash without external requests', async () => {
  const challenge = await buildRoadsterChallenge({ parent: await loadSavedRoadster() });
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': 'sandbox allow-scripts' });
    response.end(challenge.files['play.html']);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '' } });
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (route.request().url().startsWith(origin + '/')) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    await page.goto(origin + '/?test=1&quality=low');
    await page.waitForFunction(() => window.roadsterReady && window.roadsterChallengeSnapshot);
    const before = await page.evaluate(() => {
      roadsterChallengeStart({ borrow: false }); return roadsterChallengeAdvance(1200);
    });
    assert.equal(before.phase, 'missed');
    assert.equal(before.tick, 766);
    assert.ok(Math.abs(before.landing.position.x - challenge.verification.measurement.baseline.landing.position.x) < 1e-8);
    const after = await page.evaluate(() => {
      roadsterChallengeStart({ borrow: true, demo: true }); return roadsterChallengeAdvance(1200);
    });
    assert.equal(after.phase, 'landed');
    assert.equal(after.componentId, challenge.componentId);
    assert.ok(Math.abs(after.landing.position.x - challenge.verification.measurement.transferred.landing.position.x) < 1e-8);
    await page.evaluate(() => { roadsterChallengeStart({ borrow: true }); roadsterChallengeAdvance(636); });
    await page.keyboard.down('KeyX');
    const dashed = await page.evaluate(() => roadsterChallengeAdvance(8));
    await page.keyboard.up('KeyX');
    assert.equal(dashed.motion.coreCalls, 644);
    assert.equal((await page.evaluate(() => roadsterChallengeAdvance(1200))).phase, 'landed');
    const reset = await page.evaluate(() => roadsterChallengeStart({ borrow: true }));
    assert.equal(reset.tick, 0); assert.equal(reset.motion.state.core.cooldown, 10);
    await page.evaluate(() => roadsterChallengeAdvance(644));
    await mkdir(new URL('../reports/', import.meta.url), { recursive: true });
    await page.screenshot({ path: new URL('../reports/roadster-challenge.png', import.meta.url).pathname });
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
  } finally {
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
