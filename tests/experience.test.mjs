import assert from 'node:assert/strict';
import test from 'node:test';
import { createPakuBrowser } from '../evaluator/browser-harness.mjs';

test('visitors can play the compiled donor and move one frozen ability between both working destinations',async()=>{
  const harness=await createPakuBrowser();
  try{
    const {page,errors}=await harness.page();await page.setViewportSize({width:1440,height:1050});await page.goto(harness.origin);
    await page.waitForFunction(()=>window.currentDestination==='paku-paku'&&document.querySelector('#transfer-status').textContent==='VERIFIED TRANSFER');
    assert.equal(await page.locator('.games iframe').count(),3);
    assert.equal(await page.locator('[data-destination]').count(),2);
    await page.waitForSelector('#trace-comparison svg');
    const catalog=await(await fetch(harness.origin+'/api/destinations')).json();
    assert.ok(catalog.destinations.every(item=>item.componentId===catalog.componentId));
    const comparison=await(await fetch(harness.origin+'/evidence/transfer-comparison.json')).json();
    assert.equal(comparison.passed,true);assert.equal(comparison.lanes.length,4);
    for(const lane of comparison.lanes)assert.equal(lane.frames.at(-1).cumulativeSourcePixels,180);
    const donor=await(await page.$('#donor-game')).contentFrame();
    const hash=new URL(donor.url()).hash;
    await donor.goto(harness.origin+'/donor/play?test=1'+hash);await donor.waitForFunction(()=>window.donorReady===true,{}, {polling:10});
    assert.ok(await donor.evaluate(()=>{
      const bounds=document.querySelector('wasm4-app').shadowRoot.querySelector('canvas').getBoundingClientRect();
      return bounds.x>=0&&bounds.right<=innerWidth&&Math.abs(bounds.width-bounds.height)<1;
    }));
    const hold=async(selector,frame,condition)=>{
      const button=page.locator(selector);await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await frame.waitForFunction(condition,{}, {polling:10});
    };
    await page.waitForFunction(()=>!document.querySelector('[data-donor="dash"]').disabled);
    await hold('[data-donor="dash"]',donor,()=>document.querySelector('wasm4-app').inputState.gamepad[0]===1);
    await donor.evaluate(()=>donorAdvance());await page.mouse.up();
    await donor.waitForFunction(()=>Boolean(donorInput().pendingRelease&1),{}, {polling:10});
    await donor.evaluate(()=>donorAdvance(10));
    assert.equal(await donor.evaluate(()=>document.querySelector('wasm4-app').inputState.gamepad[0]),0);
    const initial=await donor.evaluate(()=>donorSnapshot());
    await hold('[data-donor="dash"]',donor,()=>document.querySelector('wasm4-app').inputState.gamepad[0]===1);
    await donor.evaluate(()=>donorAdvance(8));await page.mouse.up();
    const dashed=await donor.evaluate(()=>donorSnapshot());assert.equal(dashed.position.x-initial.position.x,60);assert.equal(dashed.cooldown,25);
    await page.locator('[data-destination="jujump"]').click();
    await page.waitForFunction(()=>window.currentDestination==='jujump'&&document.querySelector('#transfer-status').textContent==='VERIFIED TRANSFER');
    assert.equal(await page.locator('#remix-details').isHidden(),true);assert.equal(await page.locator('#remix-submit').isDisabled(),true);
    const frames=[];
    for(const id of ['original-game','transfer-game']){
      const frame=await(await page.$('#'+id)).contentFrame();await frame.goto(frame.url()+'&test=1');await frame.waitForFunction(()=>window.jujumpReady===true);
      await page.locator(`[data-turn="${id}"]`).click();await frame.evaluate(()=>gameClock.advance(2));await frame.evaluate(()=>gameClock.advance(9));
      await frame.evaluate(()=>jujumpFixture({p:{x:30,y:20},v:{x:1,y:0.5},floors:[],jumpWay:1,floorAppDist:99999}));frames.push(frame);
    }
    await hold('[data-dash]',frames[1],()=>motionPort.snapshot().dashHeld===true);
    for(const frame of frames)await frame.evaluate(()=>gameClock.advance(8));await page.mouse.up();
    const before=await frames[0].evaluate(()=>jujumpSnapshot()),after=await frames[1].evaluate(()=>jujumpSnapshot());
    assert.equal(before.p.x,38);assert.equal(after.p.x,60);assert.ok(Math.abs(before.p.y-after.p.y)<1e-9);
    await page.locator('[data-destination="paku-paku"]').click();
    await page.waitForFunction(()=>window.currentDestination==='paku-paku'&&document.querySelector('#transfer-status').textContent==='VERIFIED TRANSFER');
    assert.equal(await page.locator('#remix-details').isHidden(),false);
    assert.deepEqual(errors,[]);
  }finally{await harness.close();}
});

test('mobile touch controls operate the transferred ability without viewport overflow',async()=>{
  const harness=await createPakuBrowser();let context;
  try{
    const {page:seed}=await harness.page();
    context=await seed.context().browser().newContext({viewport:{width:375,height:812},hasTouch:true,isMobile:true});
    const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(harness.origin+'/?destination=jujump');
    await page.waitForFunction(()=>window.currentDestination==='jujump'&&document.querySelector('#transfer-status').textContent==='VERIFIED TRANSFER');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.locator('[data-turn="transfer-game"]').tap();
    const frame=await(await page.$('#transfer-game')).contentFrame();
    await frame.waitForFunction(()=>jujumpSnapshot().status==='playing'&&jujumpSnapshot().motion.core.cooldown===0);
    const button=page.locator('[data-dash]');await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();
    const session=await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2,id:1}]});
    await frame.waitForFunction(()=>jujumpSnapshot().motion.output?.ownsMotion===true);
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await frame.waitForFunction(()=>motionPort.snapshot().dashHeld===false);assert.deepEqual(errors,[]);
    await page.setViewportSize({width:320,height:740});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }finally{await context?.close();await harness.close();}
});
