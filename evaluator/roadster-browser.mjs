import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { buildRoadsterFrame } from '../roadster/build.mjs';
import { digest } from '../component/build.mjs';
import { ROADSTER_INTENT } from '../roadster/port.mjs';

export async function verifyRoadsterBrowser(source,intent=ROADSTER_INTENT,{onProgress=()=>{},componentRef}={}){
  const original=await buildRoadsterFrame({componentRef}),transfer=await buildRoadsterFrame({source,intent,componentRef});
  const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.setHeader('Content-Security-Policy','sandbox allow-scripts');res.end(req.url.startsWith('/original')?original.html:transfer.html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  let browser;const results=[],errors=[];
  const check=async(name,run)=>{try{const detail=await run();results.push({name,passed:true,...detail});}catch(error){results.push({name,passed:false,error:error.message});}onProgress(name+': '+results.at(-1).passed);};
  try{
    browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true,env:{PATH:process.env.PATH??'',HOME:process.env.HOME??'',TMPDIR:process.env.TMPDIR??''}});
    const page=async(mode,viewport={width:1100,height:740},query='')=>{
      const page=await browser.newPage({viewport});page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      await page.goto(origin+'/'+mode+'?test=1&quality=low'+query);await page.waitForFunction(()=>window.roadsterReady);
      await page.evaluate(()=>{roadsterStart();roadsterAdvance(60);});return page;
    };
    await check('ordinary-stunt-agrees-with-original',async()=>{
      const a=await page('original'),b=await page('transfer');
      const replay=()=>{roadsterStart();const frames=[];for(let i=0;i<1000;i++){const state=roadsterAdvance();if(i%20===0)frames.push(state.car);}return frames;};
      assert.deepEqual(await b.evaluate(replay),await a.evaluate(replay));await a.close();await b.close();return{updates:1000};
    });
    await check('airborne-dash-retains-vertical-and-rotation',async()=>{
      const a=await page('original'),b=await page('transfer');
      const replay=()=>{roadsterFixture({x:-30,y:100,vx:8,vy:2,pitch:0,roll:0,gas:0});const frames=[];for(let i=0;i<8;i++)frames.push(roadsterAdvance(1,{dash:true,driver:{throttle:0,brake:0,thrust:false,spin:0}}));return frames;};
      const before=await a.evaluate(replay),after=await b.evaluate(replay),active=after.filter(frame=>frame.motion.output.ownsMotion);
      if(intent.activation==='press')assert.equal(active.length,8);else assert.equal(active.length,8);
      const wanted=60*intent.unitScale*(intent.direction==='opposite'?-1:1);assert.ok(Math.abs(after.at(-1).car.position.x+30-wanted)<1e-9);
      for(let i=0;i<8;i++){assert.ok(Math.abs(before[i].car.position.y-after[i].car.position.y)<1e-9);assert.deepEqual(after[i].car.quaternion,before[i].car.quaternion);}
      await a.close();await b.close();return{fixture:'Declared free-flight state, no contact',requestedMeters:wanted,before:before.map(f=>f.car.position),after:after.map(f=>f.car.position),events:after.map(f=>({tick:f.motion.tick,events:f.motion.output.events,cooldown:f.motion.state?.core?.cooldown}))};
    });
    await check('grounded-activation-is-blocked',async()=>{const p=await page('transfer');const state=await p.evaluate(()=>roadsterAdvance(100,{dash:true,driver:{throttle:0,brake:0,thrust:false,spin:0}}));assert.equal(state.car.mode,'grounded');assert.equal(state.motion.output.ownsMotion,false);await p.close();return{};});
    await check('dash-contact-stops-at-thin-obstacle',async()=>{
      const p=await page('transfer');const state=await p.evaluate(direction=>{roadsterFixture({x:-30,y:20,vx:0,vy:0,pitch:0,roll:0,gas:0});roadsterObstacle(-30+direction*2.7);return roadsterAdvance(8,{dash:true,driver:{throttle:0,brake:0,thrust:false,spin:0}});},intent.direction==='opposite'?-1:1);
      assert.equal(state.car.mode,'crashed');assert.equal(state.game.crash.reason,'obstacle');assert.ok(state.motion.state.core.cooldown>0);await p.close();return{fixture:'Declared 0.02m-thick obstacle in the actual collision model',position:state.car.position};
    });
    await check('logical-clock-is-display-rate-independent',async()=>{
      const states=[];for(const hz of [30,60,144]){const p=await page('transfer');states.push(await p.evaluate(hz=>{roadsterFixture({x:-30,y:100,vx:8,vy:2,pitch:0,roll:0,gas:0});roadsterPort.setDash(true);return roadsterElapsed(1,1/hz);},hz));await p.close();}
      for(const state of states.slice(1)){assert.deepEqual(state.motion,states[0].motion);assert.deepEqual(state.car,states[0].car);}return{displayRates:[30,60,144],logicalUpdates:states[0].motion.coreCalls};
    });
    await check('restart-and-keyboard-release',async()=>{const p=await page('transfer');await p.keyboard.down('KeyX');assert.equal(await p.evaluate(()=>roadsterSnapshot().motion.dashHeld),true);await p.keyboard.up('KeyX');assert.equal(await p.evaluate(()=>roadsterSnapshot().motion.dashHeld),false);const state=await p.evaluate(()=>{roadsterStart(false);return roadsterSnapshot();});assert.equal(state.motion.tick,0);assert.equal(state.motion.state.core.cooldown,10);await p.close();return{};});
    await check('visual-hold-and-afterimages-preserve-physics',async()=>{
      const a=await page('transfer',undefined,'&presentation=off'),b=await page('transfer');
      const setup=()=>{roadsterFixture({x:-30,y:100,vx:8,vy:2,pitch:0,roll:0,gas:0});roadsterAdvance(1,{dash:false,driver:{throttle:0,brake:0,thrust:false,spin:0}});};
      await a.evaluate(setup);await b.evaluate(setup);
      const image=await b.locator('canvas').screenshot(),presented=await b.evaluate(()=>roadsterPresentation().presentedPose);
      const advance=()=>roadsterAdvance(1,{dash:true,driver:{throttle:0,brake:0,thrust:false,spin:0}});
      for(let tick=0;tick<3;tick++){
        const before=await a.evaluate(advance),after=await b.evaluate(advance);
        assert.deepEqual(after.car,before.car);assert.deepEqual(after.motion,before.motion);assert.equal(await b.evaluate(()=>roadsterPresentation().hold),true);
        assert.deepEqual(await b.evaluate(()=>roadsterPresentation().presentedPose),presented,'The drawn car stays at its last pose while actual physics advances');
      }
      await a.evaluate(advance);await b.evaluate(advance);const effect=await b.evaluate(()=>roadsterPresentation());
      assert.equal(effect.hold,false);assert.ok(effect.visibleAfterimages>=3);assert.notDeepEqual(effect.presentedPose,presented);assert.notEqual(digest(await b.locator('canvas').screenshot()),digest(image));
      await b.evaluate(()=>roadsterAdvance(20,{dash:false,driver:{throttle:0,brake:0,thrust:false,spin:0}}));assert.equal(await b.evaluate(()=>roadsterPresentation().visibleAfterimages),0);
      await b.emulateMedia({reducedMotion:'reduce'});await b.reload();await b.waitForFunction(()=>window.roadsterReady);await b.evaluate(()=>{roadsterStart();roadsterAdvance(60);});await b.evaluate(setup);await b.evaluate(advance);
      assert.equal(await b.evaluate(()=>roadsterPresentation().hold),false);assert.equal(await b.evaluate(()=>roadsterPresentation().visibleAfterimages),0);
      await a.close();await b.close();return{holdLogicalUpdates:3,holdTargetMs:50,trailLifetimeUpdates:5,physicsComparison:'Identical component state and car state with presentation enabled and disabled',reducedMotion:true};
    });
    await check('mobile-canvas-fits-and-touch-controls-exist',async()=>{const p=await page('transfer',{width:390,height:844});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const bounds=await p.locator('canvas').boundingBox();assert.ok(bounds.width>=389);await p.close();assert.deepEqual(errors,[]);return{viewport:[390,844]};});
  }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  return{gate:'roadster-browser',passed:results.length===8&&results.every(result=>result.passed),sourceSha256:digest(source),componentId:transfer.componentId,frameSha256:digest(transfer.html),intent,environment:transfer.environment,results};
}
