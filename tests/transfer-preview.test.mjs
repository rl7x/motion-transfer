import assert from 'node:assert/strict';
import test from 'node:test';
import { createPakuBrowser } from '../src/evaluator/browser-harness.mjs';
import { prepareVisitor } from './helpers/app-navigation.mjs';

test('the preview starts both games and its dash button calls the verified component without turning', async () => {
  const harness = await createPakuBrowser();
  try {
    const { page, errors } = await harness.page();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(harness.origin+'/?destination=paku-paku');
    await page.waitForFunction(() => document.querySelector('#transfer-status')?.textContent === 'VERIFIED TRANSFER');
    await prepareVisitor(page);
    const frames = [];
    for (const [id, mode] of [['original-game', 'original'], ['transfer-game', 'transfer']]) {
      const frame = await (await page.$('#' + id)).contentFrame();
      await frame.goto(`${harness.origin}/play?mode=${mode}&test=1`);
      await frame.waitForFunction(() => window.pakuReady === true);
      await page.locator(`[data-turn="${id}"]`).click();
      await frame.evaluate(() => gameClock.advance(2));
      assert.equal((await frame.evaluate(() => pakuSnapshot())).status, 'playing');
      frames.push(frame);
    }
    const transfer = frames[1];
    await transfer.evaluate(() => gameClock.advance(9));
    const target = await page.locator('[data-dash]').boundingBox();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
    await page.mouse.down();
    await transfer.waitForFunction(() => window.motionPort.snapshot().dashHeld === true);
    await transfer.evaluate(() => gameClock.advance());
    await page.mouse.up();
    await transfer.waitForFunction(() => window.motionPort.snapshot().dashHeld === false);
    const state = await transfer.evaluate(() => pakuSnapshot());
    assert.equal(state.motion.output.ownsMotion, true);
    assert.equal(state.motion.output.displacement, 3.75);
    assert.equal(state.player.vx, 1);
    assert.deepEqual(state.motion.output.events, ['dash-start']);
    const metadata = await (await fetch(harness.origin + '/api/transfer')).json();
    assert.equal(metadata.status, 'verified');
    assert.equal(metadata.conformanceChecks, 11);
    assert.equal(metadata.browserChecks, 8);
    assert.match(await (await fetch(harness.origin + '/artifact/adapter.ts')).text(), /motion\.step/);
    await page.setViewportSize({ width: 375, height: 812 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
  } finally { await harness.close(); }
});
