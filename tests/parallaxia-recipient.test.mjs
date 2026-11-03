import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { loadParallaxia } from '../src/recipients/parallaxia/load.mjs';
import { loadSavedRoadster } from '../src/roadster/saved.mjs';
import { buildParallaxiaChallenge } from '../src/parallaxia/challenge.mjs';
import { landingInTarget } from '../src/parallaxia/challenge-contract.mjs';
import { digest } from '../src/component/build.mjs';

test('PARALLAXIA recipient lock verifies all 29 upstream files and MIT license', async () => {
  const recipient = await loadParallaxia();
  assert.equal(recipient.manifest.id, 'parallaxia');
  assert.equal(recipient.manifest.license, 'MIT');
  assert.equal(Object.keys(recipient.manifest.files).length, 29);
  assert.match(recipient.notices, /MIT License/);
  assert.match(recipient.notices, /ABA Games/);
});

test('PARALLAXIA barrage challenge pins ordinary flight outside the safe zone and phase-dashes inside', async () => {
  const parent = await loadSavedRoadster();
  const challenge = await buildParallaxiaChallenge({ parent });
  const report = challenge.verification;
  assert.equal(report.passed, true);
  assert.equal(report.ordinaryOutsideTarget, true);
  assert.equal(report.borrowedInsideTarget, true);
  assert.equal(report.maxVerticalDifference, 0);
  assert.equal(report.measurement.controls.length, 766);
  assert.equal(report.measurement.dashTick, 636);
  assert.ok(Math.abs(report.measurement.baseline.landing.position.x + 3.2) < 1e-8);
  assert.ok(Math.abs(report.measurement.transferred.landing.position.x - 1.2) < 1e-8);
  assert.equal(digest(challenge.files['play.html']), report.frameSha256);
  const active = report.measurement.transferred.frames.filter(
    (frame) => frame.motion.output?.ownsMotion,
  );
  assert.equal(active.length, 8);
  assert.equal(
    active.reduce((sum, frame) => sum + frame.motion.output.displacement, 0),
    6,
  );
  assert.equal(landingInTarget({ type: 'land', position: { x: -3.2 } }), false);
  assert.equal(landingInTarget({ type: 'land', position: { x: 1.2 } }), true);
});

test('standalone PARALLAXIA challenge frame runs in Chromium without external requests', async () => {
  const challenge = await buildParallaxiaChallenge({ parent: await loadSavedRoadster() });
  const server = createServer((request, response) => {
    response.writeHead(200, {
      'Content-Type': 'text/html',
      'Content-Security-Policy': 'sandbox allow-scripts',
    });
    response.end(challenge.files['play.html']);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || 'chrome',
      headless: true,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        TMPDIR: process.env.TMPDIR ?? '',
      },
    });
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = [];
    const external = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) => {
      if (route.request().url().startsWith(origin + '/')) return route.continue();
      external.push(route.request().url());
      return route.abort();
    });
    await page.goto(origin + '/?test=1&quality=low');
    await page.waitForFunction(() => window.roadsterReady && window.roadsterChallengeSnapshot);
    const before = await page.evaluate(() => {
      roadsterChallengeStart({ borrow: false });
      return roadsterChallengeAdvance(1200);
    });
    assert.equal(before.phase, 'missed');
    assert.equal(before.tick, 766);
    assert.ok(Math.abs(before.landing.position.x + 3.2) < 1e-8);
    const after = await page.evaluate(() => {
      roadsterChallengeStart({ borrow: true, demo: true });
      return roadsterChallengeAdvance(1200);
    });
    assert.equal(after.phase, 'landed');
    assert.equal(after.componentId, challenge.componentId);
    assert.ok(Math.abs(after.landing.position.x - 1.2) < 1e-8);
    await page.evaluate(() => {
      roadsterChallengeStart({ borrow: true });
      roadsterChallengeAdvance(636);
    });
    await page.keyboard.down('KeyX');
    const dashed = await page.evaluate(() => roadsterChallengeAdvance(8));
    await page.keyboard.up('KeyX');
    assert.equal(dashed.motion.coreCalls, 644);
    assert.equal(dashed.activeUpdates, 8);
    assert.equal(dashed.dashMeters, 6);
    assert.equal((await page.evaluate(() => roadsterChallengeAdvance(1200))).phase, 'landed');
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
