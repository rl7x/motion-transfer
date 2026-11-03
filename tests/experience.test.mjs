import assert from 'node:assert/strict';
import test from 'node:test';
import { createPakuBrowser } from '../src/evaluator/browser-harness.mjs';
import { prepareVisitor, reveal } from './helpers/app-navigation.mjs';

test('visitors can play the compiled donor and move one frozen ability between both working destinations',async()=>{
  const harness=await createPakuBrowser();
  try{
    const {page,errors}=await harness.page();await page.setViewportSize({width:1440,height:1050});await page.goto(harness.origin+'/?destination=paku-paku');
    await page.waitForFunction(()=>window.currentDestination==='paku-paku'&&document.querySelector('#transfer-status').textContent==='VERIFIED TRANSFER');
    await prepareVisitor(page);
    assert.equal(await page.locator('.games iframe').count(),3);
    assert.equal(await page.locator('[data-destination]').count(),3);
    await reveal(page,'#trace-comparison svg');
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
    await prepareVisitor(page);
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

test('expanding a player enlarges its actual canvas and preserves the current game and dash controls',async()=>{
  const harness=await createPakuBrowser();
  try{
    const {page,errors}=await harness.page();await page.setViewportSize({width:1440,height:1050});
    await page.goto(harness.origin+'/?destination=jujump');
    await page.waitForFunction(()=>window.currentDestination==='jujump'&&document.querySelector('#transfer-status').textContent==='VERIFIED TRANSFER');
    await prepareVisitor(page);
    const frame=await(await page.$('#transfer-game')).contentFrame();
    await frame.goto(frame.url()+'&test=1');await frame.waitForFunction(()=>window.jujumpReady===true);
    await page.locator('[data-turn="transfer-game"]').click();await frame.evaluate(()=>gameClock.advance(11));
    await frame.evaluate(()=>jujumpFixture({p:{x:30,y:20},v:{x:1,y:0.5},floors:[],jumpWay:1,floorAppDist:99999}));
    const before=await frame.evaluate(()=>jujumpSnapshot());
    const width=await frame.locator('canvas').evaluate(canvas=>canvas.getBoundingClientRect().width);
    await page.locator('[data-expand="transfer-game"]').click();
    await page.waitForFunction(()=>document.fullscreenElement?.contains(document.querySelector('#transfer-game')));
    await frame.waitForFunction(width=>document.querySelector('canvas').getBoundingClientRect().width>width*1.5,width);
    assert.deepEqual(await frame.evaluate(()=>jujumpSnapshot()),before);
    const button=page.locator('[data-dash]'),box=await button.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    await frame.waitForFunction(()=>motionPort.snapshot().dashHeld===true);await frame.evaluate(()=>gameClock.advance(8));
    await page.mouse.up();await frame.waitForFunction(()=>motionPort.snapshot().dashHeld===false);
    const dashed=await frame.evaluate(()=>jujumpSnapshot());assert.equal(dashed.p.x-before.p.x,30);
    await page.locator('[data-expand="transfer-game"]').click();
    await page.waitForFunction(()=>document.fullscreenElement===null);
    await page.waitForFunction(()=>document.querySelector('[data-expand="transfer-game"]').getAttribute('aria-expanded')==='false');
    assert.deepEqual(await frame.evaluate(()=>jujumpSnapshot()),dashed);
    assert.equal(await page.locator('[data-expand="transfer-game"]').getAttribute('aria-expanded'),'false');
    assert.deepEqual(errors,[]);
  }finally{await harness.close();}
});

test('the large touch player works when browser fullscreen is unavailable',async()=>{
  const harness=await createPakuBrowser();let context;
  try{
    const {page:seed}=await harness.page();
    context=await seed.context().browser().newContext({viewport:{width:375,height:812},hasTouch:true,isMobile:true});
    await context.addInitScript(()=>Object.defineProperty(document,'fullscreenEnabled',{get:()=>false}));
    const page=await context.newPage();await page.goto(harness.origin+'/?destination=jujump');
    await page.waitForFunction(()=>window.currentDestination==='jujump'&&document.querySelector('#transfer-status').textContent==='VERIFIED TRANSFER');
    await prepareVisitor(page);
    const frame=await(await page.$('#transfer-game')).contentFrame();
    await frame.evaluate(()=>{window.playSession='retained';});
    await page.locator('[data-expand="transfer-game"]').tap();
    const bounds=await page.locator('#transfer-game').boundingBox();assert.ok(bounds.width>=370);assert.ok(bounds.height>450);
    assert.equal(await frame.evaluate(()=>window.playSession),'retained');
    assert.equal(await page.locator('.intro').evaluate(element=>element.inert),true);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.locator('[data-turn="transfer-game"]').tap();await frame.waitForFunction(()=>jujumpSnapshot().status==='playing');
    await page.locator('[data-expand="transfer-game"]').tap();
    assert.equal(await page.locator('.intro').evaluate(element=>element.inert),false);
    assert.equal(await page.locator('[data-expand="transfer-game"]').getAttribute('aria-expanded'),'false');
    assert.equal(await frame.evaluate(()=>window.playSession),'retained');
  }finally{await context?.close();await harness.close();}
});
