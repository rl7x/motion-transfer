import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { init, step } from '../../assets/components/dashy-dango-dash/component.js';
import { digest } from '../component/build.mjs';
import { buildRemixFrame } from '../remix/frame.mjs';
import { remixInput } from './paku-remix.mjs';

export const REMIX_BROWSER_CHECKS = [
  'ordinary-play-preserves-recipient', 'mapping-and-core-state-agree', 'swept-collision-and-restart',
  'wrap-is-not-a-collision-segment', 'raw-controls-replay', 'isolated-frame-and-authenticated-controls',
];

export async function verifyRemixBrowser(compiled, intent, html) {
  const original = await buildRemixFrame(compiled, intent, {original:true});
  const server = createServer((request,response)=>{
    const path=new URL(request.url,'http://localhost').pathname;
    const body=path==='/frame' ? html : path==='/original' ? original
      : path==='/' ? '<iframe sandbox="allow-scripts" style="border:0;width:500px;height:250px" src="/frame?test=1#channel=test-channel"></iframe>' : null;
    response.writeHead(body?200:404,{'Content-Type':'text/html; charset=utf-8'});response.end(body??'Not found');
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`;
  let browser;
  const results=[];
  try {
    browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true,
      env:{PATH:process.env.PATH??'',...(process.env.HOME?{HOME:process.env.HOME}:{}),...(process.env.TMPDIR?{TMPDIR:process.env.TMPDIR}:{})}});
    const open=async(path='/frame',scale)=>{
      const page=await browser.newPage({viewport:{width:520,height:280}}),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',route=>route.request().method()==='GET'&&route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      await page.goto(origin);
      await page.locator('iframe').evaluate((frame,src)=>{frame.src=src;},`${path}?test=1${scale?`&scale=${scale}`:''}#channel=test-channel`);
      const frame=await (await page.$('iframe')).contentFrame();
      try { await frame.waitForFunction(()=>window.pakuReady===true,{}, {timeout:5000}); }
      catch(error) { await page.close(); throw Error(`Remix did not boot: ${errors.join('; ')||error.message}`); }
      await page.locator('iframe').click();
      await page.keyboard.down('Space');await frame.evaluate(()=>gameClock.advance());
      await page.keyboard.up('Space');await frame.evaluate(()=>gameClock.advance());
      return {page,frame,errors};
    };
    const check=async(name,run)=>{
      try{results.push({name,passed:true,...await run()});}
      catch(error){results.push({name,passed:false,error:error.message});}
    };
    const child=async(run,scale)=>{
      const session=await open('/frame',scale);
      try{const result=await run(session);assert.deepEqual(session.errors,[]);return result;}
      finally{await session.page.close();}
    };
    await check(REMIX_BROWSER_CHECKS[0],async()=>{
      const snapshots=[];
      for(const path of ['/original','/frame']){
        const {page,frame,errors}=await open(path);
        try{
          const states=[await frame.evaluate(()=>pakuSnapshot())];
          await frame.evaluate(()=>gameClock.advance(20));states.push(await frame.evaluate(()=>pakuSnapshot()));
          await page.keyboard.down('Space');await frame.evaluate(()=>gameClock.advance());await page.keyboard.up('Space');
          await frame.evaluate(()=>gameClock.advance(40));states.push(await frame.evaluate(()=>pakuSnapshot()));
          snapshots.push(states.map(({motion,...state})=>state));assert.deepEqual(errors,[]);
        }finally{await page.close();}
      }
      assert.deepEqual(snapshots[0],snapshots[1]);return {checkpoints:3};
    });
    await check(REMIX_BROWSER_CHECKS[1],()=>child(async({frame})=>{
      const frames=await frame.evaluate(()=>{
        const states=[pakuSnapshot()];
        for(let index=1;index<135;index++){
          const down=(index>=10&&index<80)||index>=90;
          document.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code:'KeyD',bubbles:true}));
          pakuFixture({enemyX:100,eyeVx:-1,facing:index<70?1:-1});
          gameClock.advance();states.push(pakuSnapshot());
        }
        return states;
      });
      let core=init(compiled.defaults),previousDash=false;
      const activationTicks=[];
      for(let index=0;index<frames.length;index++){
        const dash=(index>=10&&index<80)||index>=90;
        const expected=step(core,remixInput({facing:index<70?1:-1,dash},intent,previousDash),compiled.defaults);
        core=expected.state;previousDash=dash;
        const actual=frames[index];assert.equal(actual.status,'playing');assert.deepEqual(actual.motion.core,core);
        assert.equal(actual.motion.output.ownsMotion,expected.output.ownsMotion);
        assert.deepEqual(actual.motion.output.events,expected.output.events);
        if(expected.output.ownsMotion)assert.equal(actual.motion.output.displacement,expected.output.displacement.x*intent.unitScale);
        if(expected.output.events.includes('dash-start'))activationTicks.push(index+1);
      }
      assert.ok(activationTicks.length>0);return {ticks:frames.length,activationTicks,intent};
    }));
    await check(REMIX_BROWSER_CHECKS[2],()=>child(async({frame,page})=>{
      const sign=intent.direction==='opposite'?-1:1;
      await frame.evaluate(()=>gameClock.advance(9));
      await frame.evaluate(sign=>pakuFixture({playerX:40,facing:1,enemyX:40+sign*7,eyeVx:0,powerTicks:0,
        dots:[{x:40+sign*7,isPower:false},{x:10,isPower:false}]}),sign);
      await page.keyboard.down('KeyD');await frame.evaluate(()=>gameClock.advance());await page.keyboard.up('KeyD');
      const state=await frame.evaluate(()=>pakuSnapshot());
      assert.equal(state.player.x,40+sign*15);assert.ok(Math.abs(state.player.x-state.enemy.x)>6);
      assert.equal(state.status,'game-over');assert.ok(!state.dots.some(dot=>dot.x===40+sign*7));
      await frame.evaluate(()=>gameClock.advance(22));
      await page.keyboard.down('Space');await frame.evaluate(()=>gameClock.advance());await page.keyboard.up('Space');await frame.evaluate(()=>gameClock.advance());
      const fresh=await frame.evaluate(()=>pakuSnapshot());assert.equal(fresh.status,'playing');
      assert.equal(fresh.motion.initCalls,1);assert.equal(fresh.motion.stepCalls,1);assert.equal(fresh.motion.core.cooldown,9);
      return {fixtureScale:2,sweptContact:true,restart:true};
    },2));
    await check(REMIX_BROWSER_CHECKS[3],()=>child(async({frame,page})=>{
      await frame.evaluate(()=>gameClock.advance(9));
      await frame.evaluate(facing=>pakuFixture({playerX:102.5,facing,enemyX:50,eyeVx:0,powerTicks:0}),intent.direction==='opposite'?-1:1);
      await page.keyboard.down('KeyD');await frame.evaluate(()=>gameClock.advance());
      const state=await frame.evaluate(()=>pakuSnapshot());assert.equal(state.player.x,-3);assert.equal(state.status,'playing');
      return {wrappedTo:-3};
    }));
    await check(REMIX_BROWSER_CHECKS[4],()=>child(async({frame,page})=>{
      const select=state=>({x:state.player.x,core:state.motion.core,output:state.motion.output});
      const before=[select(await frame.evaluate(()=>pakuSnapshot()))];
      for(let index=1;index<20;index++){
        if(index===10)await page.keyboard.down('KeyD');
        await frame.evaluate(()=>gameClock.advance());const state=await frame.evaluate(()=>pakuSnapshot());before.push(select(state));
        if(state.status!=='playing')break;
      }
      await page.keyboard.up('KeyD');await frame.evaluate(()=>{
        if(pakuSnapshot().status==='playing')window.end();
        for(let index=0;index<150&&!isReplaying;index++)gameClock.advance();
        if(!isReplaying)throw Error('Attract replay did not start');
      });
      const replay=[];
      for(let index=0;index<before.length;index++){await frame.evaluate(()=>gameClock.advance());replay.push(select(await frame.evaluate(()=>pakuSnapshot())));}
      assert.deepEqual(replay,before);return {replayedTicks:before.length,lifecycleEndFixture:true};
    }));
    await check(REMIX_BROWSER_CHECKS[5],()=>child(async({frame,page})=>{
      assert.equal(await frame.evaluate(()=>{try{parent.document.body;return false;}catch{return true;}}),true);
      assert.equal(await frame.evaluate(async()=>{try{await fetch('/api/remixes');return false;}catch{return true;}}),true);
      const send=channel=>page.evaluate(channel=>document.querySelector('iframe').contentWindow.postMessage({type:'dash',pressed:true,channel},'*'),channel);
      await send('wrong-channel');await frame.evaluate(()=>gameClock.advance());
      assert.equal(await frame.evaluate(()=>motionPort.snapshot().dashHeld),false);
      await send('test-channel');await frame.waitForFunction(()=>motionPort.snapshot().dashHeld===true);
      return {opaqueOrigin:true,networkBlocked:true,channelChecked:true};
    }));
  } finally {
    if(browser)await browser.close();
    await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  }
  return {schemaVersion:1,gate:'remix-browser',passed:results.length===REMIX_BROWSER_CHECKS.length&&results.every(result=>result.passed),
    sourceSha256:compiled.sourceSha256,javascriptSha256:compiled.javascriptSha256,frameSha256:digest(html),componentId:compiled.componentId,intent,results};
}
