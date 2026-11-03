import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { buildParallaxiaFrame } from '../parallaxia/build.mjs';
import { digest } from '../component/build.mjs';

export async function verifyParallaxiaBrowser(source, intent, { componentRef } = {}) {
  const built = await buildParallaxiaFrame({ source, intent, componentRef, collisionPolicy: 'native' });
  const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': 'sandbox allow-scripts' }); res.end(built.html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser; const results = [], errors = [], external = [];
  try {
    browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || (process.platform === 'linux' ? 'chromium' : 'chrome'), headless: true,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '', PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? '' } });
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => { if (route.request().url().startsWith(origin + '/')) return route.continue(); external.push(route.request().url()); return route.abort(); });
    await page.goto(origin + '/?test=1'); await page.waitForFunction(() => window.roadsterReady);
    const run = await page.evaluate(() => {
      roadsterStart(false); const before = roadsterAdvance(40, { driver: 0, dash: false });
      const frames = []; for (let i = 0; i < 10; i++) frames.push(roadsterAdvance(1, { driver: 0, dash: i === 0 }));
      return { before, frames, shield: Boolean(globalThis.parallaxiaChallengeShield) };
    });
    assert.equal(run.shield, false); assert.equal(run.frames[0].componentId, built.componentId);
    assert.equal(run.frames.at(-1).motion.coreCalls, 50);
    assert.equal(run.frames.filter(frame => frame.motion.output.ownsMotion).length, 8);
    for (const frame of run.frames) assert.equal(frame.car.position.y, run.before.car.position.y);
    results.push({ name: 'standalone-native-frame-and-component-clock', passed: true, updates: 50, activeUpdates: 8 });
    await page.keyboard.down('KeyX'); assert.equal(await page.evaluate(() => roadsterSnapshot().motion.dashHeld), true);
    await page.keyboard.up('KeyX'); assert.equal(await page.evaluate(() => roadsterSnapshot().motion.dashHeld), false);
    const reset = await page.evaluate(() => { roadsterStart(false); return roadsterSnapshot(); }); assert.equal(reset.motion.tick, 0);
    results.push({ name: 'keyboard-release-and-reset', passed: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    results.push({ name: 'mobile-canvas-and-offline-execution', passed: true });
  } catch (error) { results.push({ name: 'browser', passed: false, error: error.message }); }
  finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  return { gate: 'parallaxia-browser', passed: results.length === 3 && results.every(result => result.passed), sourceSha256: digest(source),
    componentId: built.componentId, frameSha256: digest(built.html), environment: built.environment, intent, results };
}
