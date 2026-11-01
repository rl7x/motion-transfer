import assert from 'node:assert/strict';
import { init, step } from '../components/dashy-dango-dash/component.js';
import { createPakuBrowser, replayPaku, startPaku } from './browser-harness.mjs';
import { loadPakuPaku } from '../recipients/paku-paku/load.mjs';
import { pakuEnvironment } from '../transfer/paku-environment.mjs';

export async function verifyPakuBrowser(compiled, { onProgress = () => {} } = {}) {
  const environment = await pakuEnvironment();
  const harness = await createPakuBrowser({ adapter: compiled });
  const results = [];
  const check = async (name, run) => {
    onProgress(`Browser check: ${name}`);
    try { results.push({ name, passed: true, ...await run() }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  };
  const child = async (run, options) => {
    const { page, errors } = await harness.page('transfer', options);
    try { await startPaku(page); const details = await run(page); assert.deepEqual(errors, []); return details; }
    finally { await page.close(); }
  };
  const snapshot = page => page.evaluate(()=>pakuSnapshot());
  const advance = (page,count=1) => page.evaluate(count=>gameClock.advance(count),count);
  try {
    await check('ordinary-play-matches-original', async () => {
      const original = await harness.page(), transfer = await harness.page('transfer');
      try {
        const inputs = [{frames:20},{turn:true,frames:1},{frames:40}];
        const expected = await replayPaku(original.page, inputs), actual = await replayPaku(transfer.page, inputs);
        const core = states => states.map(({motion,...state})=>state);
        assert.deepEqual(core(actual), core(expected));
        assert.deepEqual([...original.errors,...transfer.errors],[]);
        return { checkpoints: expected.length };
      } finally { await original.page.close(); await transfer.page.close(); }
    });
    await check('dash-output-and-frozen-direction-match-component', () => child(async page => {
      await page.evaluate(()=>pakuFixture({enemyX:0}));
      let state = init(compiled.defaults);
      for(let index=0;index<10;index++) state=step(state,{buttons:32,sourceBodyWidth:8},compiled.defaults).state;
      await advance(page,9);
      const start = await snapshot(page);
      assert.equal(start.motion.core.cooldown,0);
      await page.keyboard.down('KeyD');
      const events=[];
      for(let index=0;index<8;index++) {
        if(index===1)await page.keyboard.up('KeyD');
        if(index===3)await page.keyboard.down('Space');
        if(index===4)await page.keyboard.up('Space');
        await advance(page);
        const actual=await snapshot(page);
        const expected=step(state,{buttons:(actual.player.vx<0?16:32)|(index===0?1:0),sourceBodyWidth:8},compiled.defaults);
        state=expected.state;
        assert.deepEqual(actual.motion.core,state);
        assert.equal(actual.motion.output.displacement,expected.output.displacement.x*0.5);
        assert.deepEqual(actual.motion.output.events,expected.output.events);
        events.push(...actual.motion.output.events);
      }
      const end=await snapshot(page);
      assert.ok(Math.abs(end.player.x-start.player.x-30)<1e-9);
      assert.equal(end.player.vx,-1); assert.deepEqual(events,['dash-start','dash-end']);
      await advance(page); const resumed=await snapshot(page);
      assert.equal(resumed.motion.output.ownsMotion,false); assert.ok(resumed.player.x<end.player.x);
      return { activeTicks:8, recipientDistance:30, events };
    }));
    await check('held-dash-retriggers-without-turning', () => child(async page => {
      await page.evaluate(()=>pakuFixture({enemyX:100,eyeVx:-1}));
      await page.keyboard.down('KeyD');
      const result=await page.evaluate(()=>{
        const starts=[],ends=[];
        for(let index=0;index<100;index++) {
          gameClock.advance(); const state=pakuSnapshot();
          if(state.motion.output.events.includes('dash-start'))starts.push(state.ticks);
          if(state.motion.output.events.includes('dash-end'))ends.push(state.ticks);
        }
        return{starts,ends,state:pakuSnapshot()};
      });
      assert.deepEqual(result.starts,[11,44,77]); assert.deepEqual(result.ends,[18,51,84]);
      assert.equal(result.state.player.vx,1); assert.equal(result.state.status,'playing');
      return { activationTicks:result.starts,endTicks:result.ends };
    }));
    await check('swept-ghost-contact-and-restart', () => child(async page => {
      await advance(page,9);
      await page.evaluate(()=>pakuFixture({playerX:40,facing:1,enemyX:47,eyeVx:0,powerTicks:0,dots:[{x:47,isPower:false},{x:10,isPower:false}]}));
      await page.keyboard.down('KeyD'); await advance(page); await page.keyboard.up('KeyD');
      const state=await snapshot(page);
      assert.equal(state.player.x,55); assert.ok(Math.abs(state.player.x-state.enemy.x)>6);
      assert.equal(state.status,'game-over'); assert.ok(!state.dots.some(dot=>dot.x===47));
      await advance(page,22);
      await page.keyboard.down('Space'); await advance(page); await page.keyboard.up('Space'); await advance(page);
      const restarted=await snapshot(page);
      assert.equal(restarted.status,'playing'); assert.equal(restarted.motion.initCalls,1);
      assert.equal(restarted.motion.stepCalls,1); assert.equal(restarted.motion.core.cooldown,9);
      return { fixtureScale:2, endpointSeparation:Math.abs(state.player.x-state.enemy.x), sweptContact:true, restart:true };
    }, {scale:2}));
    await check('power-cookie-retains-recipient-ghost-rule', () => child(async page => {
      await advance(page,9);
      await page.evaluate(()=>pakuFixture({playerX:40,facing:1,enemyX:47,eyeVx:0,powerTicks:0,dots:[{x:44.5,isPower:true},{x:10,isPower:false}]}));
      await page.keyboard.down('KeyD'); await advance(page);
      const state=await snapshot(page);
      assert.equal(state.status,'playing'); assert.equal(state.enemy.eyeVx,-1); assert.ok(state.score>0);
      return {fixtureScale:2,ghostEaten:true};
    }, {scale:2}));
    await check('wrap-teleport-does-not-sweep-across-the-lane', () => child(async page => {
      await advance(page,9);
      await page.evaluate(()=>pakuFixture({playerX:102.5,facing:1,enemyX:50,eyeVx:0,powerTicks:0}));
      await page.keyboard.down('KeyD'); await advance(page);
      const state=await snapshot(page);
      assert.equal(state.player.x,-3); assert.equal(state.status,'playing'); assert.equal(state.enemy.eyeVx,0);
      return {wrappedTo:-3,falseGhostContact:false};
    }));
    await check('dash-input-is-preserved-in-attract-replay', () => child(async page => {
      const select=state=>({x:state.player.x,core:state.motion.core,output:state.motion.output});
      const recorded=[select(await snapshot(page))];
      await page.keyboard.down('KeyD');
      for(let index=0;index<19;index++){await advance(page);recorded.push(select(await snapshot(page)));}
      await page.keyboard.up('KeyD');
      await page.evaluate(()=>window.end()); // Explicit lifecycle fixture; initial natural play is retained.
      await page.evaluate(()=>{
        for(let index=0;index<150&&!isReplaying;index++)gameClock.advance();
        if(!isReplaying)throw Error('Attract replay did not start');
      });
      const replay=[];
      for(let index=0;index<20;index++){await advance(page);replay.push(select(await snapshot(page)));}
      assert.deepEqual(replay,recorded);
      return {replayedTicks:20,lifecycleEndFixture:true};
    }));
    await check('active-transfer-is-invariant-to-display-rate', async () => {
      const states=[];
      for(const fps of [30,60,144]) states.push(await child(async page=>{
        await page.evaluate(()=>pakuFixture({enemyX:100,eyeVx:-1})); await page.keyboard.down('KeyD');
        return page.evaluate(fps=>{for(let index=0;index<fps;index++)gameClock.elapse(1000/fps);return pakuSnapshot();},fps);
      }));
      assert.deepEqual(states[0],states[1]); assert.deepEqual(states[0],states[2]); assert.equal(states[0].motion.stepCalls,61);
      return {displayRates:[30,60,144],simulationTicks:60};
    });
  } finally { await harness.close(); }
  assert.deepEqual(await pakuEnvironment(), environment, 'Host changed during browser verification');
  const recipient=await loadPakuPaku();
  return {schemaVersion:1,gate:'paku-browser-integration',passed:results.every(result=>result.passed),
    sourceSha256:compiled.sourceSha256,javascriptSha256:compiled.javascriptSha256,componentId:compiled.componentId,
    recipientRevision:recipient.manifest.revision,tickRate:60,defaultUnitScale:0.5,environment,results};
}
