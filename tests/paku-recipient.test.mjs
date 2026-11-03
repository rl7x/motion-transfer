import assert from 'node:assert/strict';
import { after, before } from 'node:test';
import test from 'node:test';
import { loadPakuPaku } from '../src/recipients/paku-paku/load.mjs';
import { createPakuBrowser, replayPaku, startPaku } from './helpers/paku-browser.mjs';

let harness;
before(async () => { harness = await createPakuBrowser(); });
after(async () => { await harness?.close(); });

test('the pinned PAKU PAKU runs deterministically through the actual browser runtime', async () => {
  const recipient = await loadPakuPaku();
  assert.equal(recipient.manifest.revision, '6fea4eefe2deaa42706051d96a04ec9e36104696');
  const results = [];
  for (let index = 0; index < 3; index++) {
    const { page, errors } = await harness.page();
    try {
      results.push(await replayPaku(page, [{ frames: 20 }, { turn: true, frames: 1 }, { frames: 40 }]));
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[0], results[2]);
  assert.equal(results[0][0].player.x, 40.5);
  assert.equal(results[0].at(-1).player.vx, -1);
  assert.ok(results[0].at(-1).score > 0);
});

test('the normalized recipient clock produces the same updates at 30, 60, and 144 display frames', async () => {
  const results = [];
  for (const fps of [30, 60, 144]) {
    const { page, errors } = await harness.page();
    try {
      await startPaku(page);
      await page.evaluate(() => pakuFixture({ playerX: 60, facing: -1, enemyX: 100, powerTicks: 0 }));
      results.push(await page.evaluate(fps => {
        for (let frame = 0; frame < fps; frame++) gameClock.elapse(1000 / fps);
        return pakuSnapshot();
      }, fps));
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[0], results[2]);
  assert.equal(results[0].ticks, 61);
});

test('recipient baseline retains wraparound, pellets, ghost death, and power-cookie interaction', async () => {
  const { page, errors } = await harness.page();
  try {
    await startPaku(page);
    await page.evaluate(() => pakuFixture({ playerX: 102.8, facing: 1, enemyX: 50 }));
    await page.evaluate(() => gameClock.advance());
    assert.equal((await page.evaluate(() => pakuSnapshot())).player.x, -3);
    await page.evaluate(() => pakuFixture({ playerX: 40, facing: 1, enemyX: 80, powerTicks: 0, dots: [{ x: 40.5, isPower: true }, { x: 10, isPower: false }] }));
    await page.evaluate(() => gameClock.advance());
    assert.ok((await page.evaluate(() => pakuSnapshot())).powerTicks > 100);
    await page.evaluate(() => pakuFixture({ playerX: 40, facing: 1, enemyX: 45, powerTicks: 60 }));
    await page.evaluate(() => gameClock.advance());
    assert.equal((await page.evaluate(() => pakuSnapshot())).enemy.eyeVx, 1);
    await page.evaluate(() => pakuFixture({ playerX: 40, facing: 1, enemyX: 45, eyeVx: 0, powerTicks: 0 }));
    await page.evaluate(() => gameClock.advance());
    assert.equal((await page.evaluate(() => pakuSnapshot())).status, 'game-over');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('preview serves only registered assets and retains upstream license notices', async () => {
  assert.equal((await fetch(harness.origin + '/.env')).status, 404);
  assert.equal((await fetch(harness.origin + '/node_modules/')).status, 404);
  assert.match(await (await fetch(harness.origin + '/licenses')).text(), /Copyright \(c\) 2022 ABA Games/);
});
