import assert from 'node:assert/strict';
import test from 'node:test';
import { compileAdapter } from '../transfer/adapter.mjs';
import { createPakuBrowser, replayPaku, startPaku } from './helpers/paku-browser.mjs';

// Deliberately incomplete adapters test the host port only. They cannot pass
// adapter conformance and are never published as a recovered transfer.
const inactive = `export const init=(motion,config)=>({core:motion.init(config.motion)});
  export function step(state,frame,motion,config) {
    const result=motion.step(state.core,{buttons:0,sourceBodyWidth:8},config.motion);
    return {state:{core:result.state},output:{displacement:frame.normalDisplacement,ownsMotion:false,events:[],sweep:[]}};
  }`;

test('inactive generic port preserves original gameplay and isolates the added dash key', async () => {
  const harness = await createPakuBrowser({ adapter: await compileAdapter(inactive) });
  try {
    const original = await harness.page(), transferred = await harness.page('transfer');
    const steps = [{frames:15},{turn:true,frames:1},{frames:25}];
    const baseline = await replayPaku(original.page, steps), child = await replayPaku(transferred.page, steps);
    assert.deepEqual(child.map(({motion,...state})=>state), baseline.map(({motion,...state})=>state));
    const before = child.at(-1);
    await transferred.page.keyboard.down('KeyD');
    await transferred.page.evaluate(()=>gameClock.advance());
    const after = await transferred.page.evaluate(()=>pakuSnapshot());
    assert.equal(after.player.vx, before.player.vx);
    assert.equal(after.motion.dashHeld, true);
    assert.equal(after.motion.stepCalls, before.motion.stepCalls + 1);
    assert.deepEqual([...original.errors,...transferred.errors], []);
  } finally { await harness.close(); }
});

test('the host draws swept collision hitboxes and resets component state on a new life', async () => {
  const fixture = inactive.replace(
    'displacement:frame.normalDisplacement,ownsMotion:false,events:[],sweep:[]',
    'displacement:15,ownsMotion:true,events:[],sweep:Array.from({length:14},(_,i)=>i+1)',
  );
  const harness = await createPakuBrowser({ adapter: await compileAdapter(fixture) });
  try {
    const {page,errors} = await harness.page('transfer');
    await startPaku(page);
    await page.evaluate(()=>pakuFixture({playerX:40,facing:1,enemyX:47,powerTicks:0,dots:[{x:47,isPower:false},{x:10,isPower:false}]}));
    await page.evaluate(()=>gameClock.advance());
    const result = await page.evaluate(()=>pakuSnapshot());
    assert.equal(result.player.x, 55);
    assert.equal(result.status, 'game-over');
    assert.ok(!result.dots.some(dot=>dot.x===47));
    await page.evaluate(()=>gameClock.advance(22));
    await page.keyboard.down('Space'); await page.evaluate(()=>gameClock.advance());
    await page.keyboard.up('Space'); await page.evaluate(()=>gameClock.advance());
    const restarted = await page.evaluate(()=>pakuSnapshot());
    assert.equal(restarted.status,'playing');
    assert.equal(restarted.motion.initCalls,1);
    assert.equal(restarted.motion.stepCalls,1);
    assert.equal(restarted.motion.core.cooldown,9);
    assert.deepEqual(errors,[]);
  } finally { await harness.close(); }
});
