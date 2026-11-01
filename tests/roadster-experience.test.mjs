import assert from 'node:assert/strict';
import test from 'node:test';
import {createPakuBrowser} from '../evaluator/browser-harness.mjs';

test('the default Roadster transfer and guided comparison execute without model requests',async()=>{
  const harness=await createPakuBrowser();
  try{
    const {page,errors}=await harness.page();await page.setViewportSize({width:1500,height:1000});
    const posts=[];page.on('request',request=>{if(request.method()==='POST')posts.push(request.url());});
    await page.goto(harness.origin);await page.waitForFunction(()=>window.currentDestination==='roadster'&&document.querySelector('#transfer-status').textContent==='VERIFIED TRANSFER');
    assert.equal(await page.locator('[data-destination]').count(),3);assert.equal(await page.locator('#remix-details').isHidden(),true);
    await page.locator('#watch-transfer').click();await page.waitForFunction(()=>['complete','failed'].includes(window.guidedState?.phase),{},{timeout:60000});
    const state=await page.evaluate(()=>window.guidedState);assert.equal(state.phase,'complete',state.error);assert.equal(state.activeUpdates,8);assert.ok(Math.abs(state.measuredMeters-6)<1e-8);
    assert.deepEqual(posts,[]);assert.deepEqual(errors,[]);
    await page.locator('[data-destination="paku-paku"]').click();await page.waitForFunction(()=>window.currentDestination==='paku-paku'&&document.querySelector('#transfer-status').textContent==='VERIFIED TRANSFER');
    assert.equal(await page.locator('#roadster-panel').isHidden(),true);
  }finally{await harness.close();}
});

test('Roadster touch dash reaches the isolated frame and large player preserves its state',async()=>{
  const harness=await createPakuBrowser();let context;
  try{
    const {page:seed}=await harness.page();context=await seed.context().browser().newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    const page=await context.newPage();await page.goto(harness.origin);await page.waitForFunction(()=>window.currentDestination==='roadster'&&document.querySelector('#transfer-status').textContent==='VERIFIED TRANSFER');
    const frame=await(await page.$('#transfer-game')).contentFrame(),url=new URL(frame.url());url.searchParams.set('test','1');await frame.goto(url.href);await frame.waitForFunction(()=>window.roadsterReady);
    await frame.evaluate(()=>{roadsterStart();roadsterAdvance(60);roadsterFixture({x:-30,y:100,vx:8,vy:2,pitch:0,roll:0,gas:0});});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.locator('[data-expand="transfer-game"]').tap();
    const initial=await frame.evaluate(()=>roadsterSnapshot().car),button=page.locator('[data-dash]');await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();
    const session=await context.newCDPSession(page);await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2,id:1}]});
    await frame.waitForFunction(()=>roadsterSnapshot().motion.dashHeld);const after=await frame.evaluate(()=>roadsterAdvance(8,{driver:{throttle:0,brake:0,thrust:false,spin:0}}));
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await frame.waitForFunction(()=>!roadsterSnapshot().motion.dashHeld);
    assert.ok(Math.abs(after.car.position.x-initial.position.x-6)<1e-9);
    await page.locator('[data-expand="transfer-game"]').tap();assert.deepEqual((await frame.evaluate(()=>roadsterSnapshot())).car,after.car);
  }finally{await context?.close();await harness.close();}
});
