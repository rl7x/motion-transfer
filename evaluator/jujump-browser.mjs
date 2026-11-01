import assert from 'node:assert/strict';
import { createPakuBrowser } from './browser-harness.mjs';
import { init, step } from '../components/dashy-dango-dash/component.js';
import { jujumpEnvironment } from '../transfer/jujump.mjs';

export const JUJUMP_CHECKS=['ordinary-play-matches-original','native-jumps-gravity-and-landing','airborne-dash-retains-gravity',
  'swept-platform-contact','held-timing-and-frozen-direction','death-restart-resets-controller','dash-controls-replay'];

export async function verifyJujumpBrowser(compiled,{onProgress=()=>{}}={}) {
  const environment=await jujumpEnvironment(),harness=await createPakuBrowser({adapter:compiled,allowUnverified:true});
  const results=[],traces={};
  const advance=(page,n=1)=>page.evaluate(n=>gameClock.advance(n),n);
  const snapshot=page=>page.evaluate(()=>jujumpSnapshot());
  async function open(mode='transfer'){
    const session=await harness.page();
    await session.page.goto(harness.origin+`/jujump/play?mode=${mode}&test=1`);
    await session.page.waitForFunction(()=>window.jujumpReady===true);
    await session.page.keyboard.down('Space');await advance(session.page);
    await session.page.keyboard.up('Space');await advance(session.page);
    return session;
  }
  const child=async(run,mode)=>{
    const session=await open(mode);
    try{const details=await run(session.page);assert.deepEqual(session.errors,[]);return details;}
    finally{await session.page.close();}
  };
  const check=async(name,run)=>{
    onProgress(name);
    try{results.push({name,passed:true,...await run()});}
    catch(error){results.push({name,passed:false,error:error.message});}
  };
  try{
    await check(JUJUMP_CHECKS[0],async()=>{
      const captures=[];
      for(const mode of ['original','transfer'])captures.push(await child(async page=>{
        const states=[];
        for(const action of [{n:20},{down:true,n:1},{n:8},{down:true,n:1},{n:70}]){
          await page.keyboard[action.down?'down':'up']('Space');await advance(page,action.n);
          const {motion,...state}=await snapshot(page);states.push(state);
        }
        return states;
      },mode));
      assert.deepEqual(captures[0],captures[1]);return{checkpoints:captures[0].length};
    });
    await check(JUJUMP_CHECKS[1],()=>child(async page=>{
      await page.keyboard.down('Space');await advance(page);await page.keyboard.up('Space');
      const first=await snapshot(page);assert.equal(first.jumpPower,0.7);assert.equal(first.v.y,-3);
      await advance(page,3);await page.keyboard.down('Space');await advance(page);await page.keyboard.up('Space');
      const second=await snapshot(page);assert.ok(Math.abs(second.jumpPower-0.49)<1e-9);assert.ok(Math.abs(second.v.y+2.1)<1e-9);
      await page.evaluate(()=>jujumpFixture({p:{x:50,y:60},v:{x:0,y:1},floors:[{x:50,y:70}],jumpPower:0.49,floorAppDist:99999}));
      let landed;
      for(let index=0;index<10;index++){
        await advance(page);const state=await snapshot(page);
        if(state.jumpPower===1&&state.v.y===0)landed=state;
      }
      assert.ok(landed,'Landing must restore jump strength and clear velocity');
      return{airJumpStrengths:[first.jumpPower,second.jumpPower],landingRestoresStrength:landed.jumpPower};
    }));
    await check(JUJUMP_CHECKS[2],async()=>{
      const paths=[];
      for(const mode of ['original','transfer'])paths.push(await child(async page=>{
        await advance(page,9);
        await page.evaluate(()=>jujumpFixture({p:{x:30,y:20},v:{x:1,y:0.5},floors:[],jumpWay:1,floorAppDist:99999}));
        const states=[await snapshot(page)];
        if(mode==='transfer')await page.keyboard.down('KeyD');
        for(let index=0;index<8;index++){await advance(page);states.push(await snapshot(page));}
        return states;
      },mode));
      const [before,after]=paths;
      for(let index=0;index<after.length;index++){
        assert.ok(Math.abs(before[index].p.y-after[index].p.y)<1e-9);assert.equal(before[index].v.y,after[index].v.y);
      }
      assert.ok(after.at(-1).p.y>after[0].p.y);assert.ok(Math.abs(after.at(-1).p.x-after[0].p.x-30)<1e-9);
      assert.equal(after.at(-1).motion.core.cooldown,25);assert.deepEqual(after.at(-1).motion.output.events,['dash-end']);
      traces.airborne={fixture:'Open air, x30/y20, velocity x1/y0.5; matched initial state; no platforms',original:before,transfer:after};
      return{ticks:8,dashDistance:30,ordinaryDistance:before.at(-1).p.x-before[0].p.x,
        startY:after[0].p.y,endY:after.at(-1).p.y,maxVerticalDifference:Math.max(...before.map((s,i)=>Math.abs(s.p.y-after[i].p.y)))};
    });
    await check(JUJUMP_CHECKS[3],()=>child(async page=>{
      await advance(page,9);
      await page.evaluate(()=>jujumpFixture({p:{x:40,y:30},v:{x:1,y:35},floors:[{x:50,y:50}],jumpWay:1,jumpPower:0.49,floorAppDist:99999}));
      await page.keyboard.down('KeyD');await advance(page);
      const state=await snapshot(page);assert.equal(state.status,'playing');assert.equal(state.v.y,0);assert.equal(state.v.x,0);
      assert.equal(state.jumpPower,1);assert.ok(state.p.y<state.floors[0].y-5);
      assert.equal(state.motion.core.remaining,7);assert.equal(state.motion.core.cooldown,25);
      return{fixtureIncomingVerticalSpeed:35,landedY:state.p.y,floorY:state.floors[0].y,remainingDashTicks:7};
    }));
    await check(JUJUMP_CHECKS[4],()=>child(async page=>{
      const frames=[await snapshot(page)];
      frames.push(...await page.evaluate(()=>{
        const states=[];
        for(let index=1;index<100;index++){
          if(index===10)document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD',bubbles:true}));
          jujumpFixture({p:{x:30,y:20},v:{x:1,y:0.2},floors:[],jumpWay:index>=13&&index<18?-1:1,floorAppDist:99999});
          gameClock.advance();states.push(jujumpSnapshot());
        }
        return states;
      }));
      let core=init(compiled.defaults);const starts=[],ends=[];
      for(let index=0;index<frames.length;index++){
        const state=frames[index],buttons=(state.jumpWay<0?16:32)|(index>=10?1:0);
        const expected=step(core,{buttons,sourceBodyWidth:8},compiled.defaults);core=expected.state;
        assert.deepEqual(state.motion.core,core);assert.deepEqual(state.motion.output.events,expected.output.events);
        if(expected.output.ownsMotion)assert.equal(state.motion.output.displacement,expected.output.displacement.x*0.5);
        if(expected.output.events.includes('dash-start'))starts.push(index+1);
        if(expected.output.events.includes('dash-end'))ends.push(index+1);
      }
      assert.deepEqual(starts,[11,44,77]);assert.deepEqual(ends,[18,51,84]);
      traces.timing={fixture:'Open-air position/velocity reset each tick to isolate the controller; facing changes on ticks 14–18',
        frames:frames.map(s=>({tick:s.ticks,core:s.motion.core,output:s.motion.output}))};
      return{ticks:100,activationTicks:starts,endTicks:ends,sourceBodyWidth:8};
    }));
    await check(JUJUMP_CHECKS[5],()=>child(async page=>{
      await page.evaluate(()=>jujumpFixture({p:{x:50,y:110},v:{x:0,y:0},floors:[],floorAppDist:99999}));
      await advance(page);assert.equal((await snapshot(page)).status,'game-over');await advance(page,22);
      await page.keyboard.down('Space');await advance(page);await page.keyboard.up('Space');await advance(page);
      const state=await snapshot(page);assert.equal(state.status,'playing');assert.equal(state.motion.initCalls,1);
      assert.equal(state.motion.stepCalls,1);assert.equal(state.motion.core.cooldown,9);return{restarted:true};
    }));
    await check(JUJUMP_CHECKS[6],()=>child(async page=>{
      const select=s=>({p:s.p,v:s.v,core:s.motion.core,output:s.motion.output});
      const recorded=[select(await snapshot(page))];
      for(let index=1;index<20;index++){
        if(index===10)await page.keyboard.down('KeyD');await advance(page);recorded.push(select(await snapshot(page)));
      }
      await page.keyboard.up('KeyD');await page.evaluate(()=>{
        window.end();for(let index=0;index<150&&!isReplaying;index++)gameClock.advance();if(!isReplaying)throw Error('No attract replay');
      });
      const replay=[];for(let index=0;index<20;index++){await advance(page);replay.push(select(await snapshot(page)));}
      assert.deepEqual(replay,recorded);return{replayedTicks:20,lifecycleEndFixture:true};
    }));
  }finally{await harness.close();}
  assert.deepEqual(await jujumpEnvironment(),environment,'JUJUMP host changed during verification');
  return{schemaVersion:1,gate:'jujump-browser',passed:results.length===JUJUMP_CHECKS.length&&results.every(result=>result.passed),results,traces,environment};
}
