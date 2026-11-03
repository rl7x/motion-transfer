import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { buildRoadsterFrame } from '../roadster/build.mjs';
import { digest } from '../component/build.mjs';
import { ROADSTER_INTENT } from '../roadster/port.mjs';

const RUN_BUDGET_MS = 210_000;
const OPEN_BUDGET_MS = 30_000;

/** Run the same 1000 native ticks and sample points while batching redundant renders. */
export function replayOrdinaryStunt({ start = globalThis.roadsterStart, advance = globalThis.roadsterAdvance } = {}) {
  start();
  const frames = [advance(1).car];
  for (let i = 20; i < 1000; i += 20) frames.push(advance(20).car);
  advance(19);
  return frames;
}

function stageLimit(startedAt, requested) {
  return Math.min(requested, RUN_BUDGET_MS - (Date.now() - startedAt));
}

async function settle(ms, run) {
  let timer;
  let expired = false;
  const result = await Promise.race([
    run().then(value => ({ ok: true, value }), error => ({ ok: false, error })),
    new Promise(resolve => {
      timer = setTimeout(() => {
        expired = true;
        resolve({ ok: false, error: Error('stage budget exceeded') });
      }, ms);
    }),
  ]);
  clearTimeout(timer);
  return { ...result, expired };
}

export async function verifyRoadsterBrowser(source, intent = ROADSTER_INTENT, { onProgress = () => {}, componentRef } = {}) {
  const originalFrame = await buildRoadsterFrame({ componentRef }), transferFrame = await buildRoadsterFrame({ source, intent, componentRef });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Security-Policy', 'sandbox allow-scripts');
    res.end(req.url.startsWith('/original') ? originalFrame.html : transferFrame.html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const startedAt = Date.now();
  let browser;
  let stop = false;
  const results = [], errors = [];
  const note = (name, passed) => onProgress(`${name}: ${passed} ${Date.now() - startedAt}ms`);
  const fail = (name, error) => {
    results.push({ name, passed: false, error: String(error?.message ?? error).slice(0, 300) });
    note(name, false);
  };
  const check = async (name, requested, run) => {
    if (stop) return fail(name, Error('not run after an earlier stage budget'));
    const budget = stageLimit(startedAt, requested);
    if (budget < 1_000) {
      stop = true;
      return fail(name, Error('run budget exhausted'));
    }
    onProgress(`${name} started ${Date.now() - startedAt}ms`);
    const outcome = await settle(budget, run);
    if (outcome.ok) {
      results.push({ name, passed: true, ...outcome.value });
      note(name, true);
      return;
    }
    fail(name, outcome.error);
    if (!outcome.expired) return;
    stop = true;
    await browser?.close().catch(() => {});
    browser = undefined;
  };
  try {
    const launch = await settle(OPEN_BUDGET_MS, () => chromium.launch({
      channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true, timeout: 20_000,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '' },
    }));
    if (!launch.ok) throw launch.error;
    browser = launch.value;
    const open = async (mode, viewport = { width: 1100, height: 740 }, query = '') => {
      const opened = await browser.newPage({ viewport });
      opened.setDefaultTimeout(20_000);
      opened.on('pageerror', error => errors.push(error.message));
      await opened.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
      await opened.goto(origin + '/' + mode + '?test=1&quality=low' + query, { timeout: 20_000 });
      await opened.waitForFunction(() => window.roadsterReady, null, { timeout: 20_000 });
      await opened.evaluate(() => { roadsterStart(); roadsterAdvance(60); });
      return opened;
    };
    const opened = await settle(OPEN_BUDGET_MS * 2, async () => {
      const original = await open('original');
      const transfer = await open('transfer');
      return { original, transfer };
    });
    if (!opened.ok) throw opened.error;
    const { original, transfer } = opened.value;
    const settleRun = page => page.evaluate(() => { roadsterStart(); roadsterAdvance(60); });
    await check('ordinary-stunt-agrees-with-original', 120_000, async () => {
      assert.deepEqual(await transfer.evaluate(replayOrdinaryStunt), await original.evaluate(replayOrdinaryStunt));
      return { updates: 1000 };
    });
    await check('airborne-dash-retains-vertical-and-rotation', 45_000, async () => {
      await settleRun(original);
      await settleRun(transfer);
      const replay = () => {
        roadsterFixture({ x: -30, y: 100, vx: 8, vy: 2, pitch: 0, roll: 0, gas: 0 });
        const frames = [];
        for (let i = 0; i < 8; i++) frames.push(roadsterAdvance(1, { dash: true, driver: { throttle: 0, brake: 0, thrust: false, spin: 0 } }));
        return frames;
      };
      const before = await original.evaluate(replay), after = await transfer.evaluate(replay), active = after.filter(frame => frame.motion.output.ownsMotion);
      if (intent.activation === 'press') assert.equal(active.length, 8); else assert.equal(active.length, 8);
      const wanted = 60 * intent.unitScale * (intent.direction === 'opposite' ? -1 : 1);
      assert.ok(Math.abs(after.at(-1).car.position.x + 30 - wanted) < 1e-9);
      for (let i = 0; i < 8; i++) {
        assert.ok(Math.abs(before[i].car.position.y - after[i].car.position.y) < 1e-9);
        assert.deepEqual(after[i].car.quaternion, before[i].car.quaternion);
      }
      return { fixture: 'Declared free-flight state, no contact', requestedMeters: wanted, before: before.map(f => f.car.position), after: after.map(f => f.car.position), events: after.map(f => ({ tick: f.motion.tick, events: f.motion.output.events, cooldown: f.motion.state?.core?.cooldown })) };
    });
    await check('grounded-activation-is-blocked', 30_000, async () => {
      await settleRun(transfer);
      const state = await transfer.evaluate(() => roadsterAdvance(100, { dash: true, driver: { throttle: 0, brake: 0, thrust: false, spin: 0 } }));
      assert.equal(state.car.mode, 'grounded');
      assert.equal(state.motion.output.ownsMotion, false);
      return {};
    });
    await check('dash-contact-stops-at-thin-obstacle', 30_000, async () => {
      try {
        await settleRun(transfer);
        const state = await transfer.evaluate(direction => {
          roadsterFixture({ x: -30, y: 20, vx: 0, vy: 0, pitch: 0, roll: 0, gas: 0 });
          roadsterObstacle(-30 + direction * 2.7);
          return roadsterAdvance(8, { dash: true, driver: { throttle: 0, brake: 0, thrust: false, spin: 0 } });
        }, intent.direction === 'opposite' ? -1 : 1);
        assert.equal(state.car.mode, 'crashed');
        assert.equal(state.game.crash.reason, 'obstacle');
        assert.ok(state.motion.state.core.cooldown > 0);
        return { fixture: 'Declared 0.02m-thick obstacle in the actual collision model', position: state.car.position };
      } finally {
        await transfer.evaluate(() => roadsterStart()).catch(() => {});
      }
    });
    await check('logical-clock-is-display-rate-independent', 45_000, async () => {
      const states = [];
      for (const hz of [30, 60, 144]) {
        states.push(await transfer.evaluate(hz => {
          roadsterStart();
          roadsterFixture({ x: -30, y: 100, vx: 8, vy: 2, pitch: 0, roll: 0, gas: 0 });
          roadsterPort.setDash(true);
          return roadsterElapsed(1, 1 / hz);
        }, hz));
      }
      for (const state of states.slice(1)) {
        assert.deepEqual(state.motion, states[0].motion);
        assert.deepEqual(state.car, states[0].car);
      }
      return { displayRates: [30, 60, 144], logicalUpdates: states[0].motion.coreCalls };
    });
    await check('restart-and-keyboard-release', 30_000, async () => {
      await transfer.bringToFront();
      await transfer.evaluate(() => roadsterStart());
      await transfer.keyboard.down('KeyX');
      assert.equal(await transfer.evaluate(() => roadsterSnapshot().motion.dashHeld), true);
      await transfer.keyboard.up('KeyX');
      assert.equal(await transfer.evaluate(() => roadsterSnapshot().motion.dashHeld), false);
      const state = await transfer.evaluate(() => { roadsterStart(false); return roadsterSnapshot(); });
      assert.equal(state.motion.tick, 0);
      assert.equal(state.motion.state.core.cooldown, 10);
      return {};
    });
    await check('visual-hold-and-afterimages-preserve-physics', 90_000, async () => {
      const off = await open('transfer', { width: 1100, height: 740 }, '&presentation=off');
      try {
        await transfer.evaluate(() => { roadsterStart(); roadsterAdvance(60); });
        const setup = () => { roadsterFixture({ x: -30, y: 100, vx: 8, vy: 2, pitch: 0, roll: 0, gas: 0 }); roadsterAdvance(1, { dash: false, driver: { throttle: 0, brake: 0, thrust: false, spin: 0 } }); };
        await off.evaluate(setup);
        await transfer.evaluate(setup);
        const image = await transfer.locator('canvas').screenshot(), presented = await transfer.evaluate(() => roadsterPresentation().presentedPose);
        const advance = () => roadsterAdvance(1, { dash: true, driver: { throttle: 0, brake: 0, thrust: false, spin: 0 } });
        for (let tick = 0; tick < 3; tick++) {
          const before = await off.evaluate(advance), after = await transfer.evaluate(advance);
          assert.deepEqual(after.car, before.car);
          assert.deepEqual(after.motion, before.motion);
          assert.equal(await transfer.evaluate(() => roadsterPresentation().hold), true);
          assert.deepEqual(await transfer.evaluate(() => roadsterPresentation().presentedPose), presented, 'The drawn car stays at its last pose while actual physics advances');
        }
        await off.evaluate(advance);
        await transfer.evaluate(advance);
        const effect = await transfer.evaluate(() => roadsterPresentation());
        assert.equal(effect.hold, false);
        assert.ok(effect.visibleAfterimages >= 3);
        assert.notDeepEqual(effect.presentedPose, presented);
        assert.notEqual(digest(await transfer.locator('canvas').screenshot()), digest(image));
        await transfer.evaluate(() => roadsterAdvance(20, { dash: false, driver: { throttle: 0, brake: 0, thrust: false, spin: 0 } }));
        assert.equal(await transfer.evaluate(() => roadsterPresentation().visibleAfterimages), 0);
        await transfer.emulateMedia({ reducedMotion: 'reduce' });
        await transfer.reload();
        await transfer.waitForFunction(() => window.roadsterReady);
        await transfer.evaluate(() => { roadsterStart(); roadsterAdvance(60); });
        await transfer.evaluate(setup);
        await transfer.evaluate(advance);
        assert.equal(await transfer.evaluate(() => roadsterPresentation().hold), false);
        assert.equal(await transfer.evaluate(() => roadsterPresentation().visibleAfterimages), 0);
        return { holdLogicalUpdates: 3, holdTargetMs: 50, trailLifetimeUpdates: 5, physicsComparison: 'Identical component state and car state with presentation enabled and disabled', reducedMotion: true };
      } finally {
        await off.close().catch(() => {});
      }
    });
    await check('mobile-canvas-fits-and-touch-controls-exist', 30_000, async () => {
      await transfer.setViewportSize({ width: 390, height: 844 });
      assert.ok(await transfer.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const bounds = await transfer.locator('canvas').boundingBox();
      assert.ok(bounds.width >= 389);
      assert.deepEqual(errors, []);
      return { viewport: [390, 844] };
    });
  } catch (error) {
    if (!results.some(result => result.name === 'runner')) fail('runner', error);
  } finally {
    await browser?.close().catch(() => {});
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  return {
    gate: 'roadster-browser', passed: results.length === 8 && results.every(result => result.passed),
    sourceSha256: digest(source), componentId: transferFrame.componentId, frameSha256: digest(transferFrame.html),
    intent, environment: transferFrame.environment, results,
  };
}
