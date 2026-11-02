import assert from 'node:assert/strict';
import test from 'node:test';
import {createPakuBrowser} from '../evaluator/browser-harness.mjs';
import {prepareVisitor,reveal} from './helpers/app-navigation.mjs';
import {readRoadsterArtifact} from '../roadster/artifact.mjs';
import {fileURLToPath} from 'node:url';

test('the default Roadster transfer and guided comparison execute without model requests',async()=>{
  const harness=await createPakuBrowser();
  try{
    const {page,errors}=await harness.page();await page.setViewportSize({width:1500,height:1000});
    const posts=[];page.on('request',request=>{if(request.method()==='POST')posts.push(request.url());});
    await page.goto(harness.origin);await page.waitForFunction(()=>window.currentDestination==='roadster'&&document.querySelector('#transfer-status').textContent==='VERIFIED TRANSFER');
    await prepareVisitor(page);
    assert.equal(await page.locator('[data-destination]').count(),3);assert.equal(await page.locator('#remix-details').isHidden(),true);
    assert.equal(await page.locator('.games iframe').count(),1,'The featured experience keeps one active 3D canvas');
    assert.equal(await page.locator('#original-game').count(),0);
    const player=await(await page.$('#transfer-game')).contentFrame(),url=new URL(player.url());url.searchParams.set('test','1');
    await player.goto(url.href);await player.waitForFunction(()=>window.roadsterChallengeSnapshot);
    await page.locator('#watch-transfer').click();
    await player.waitForFunction(()=>roadsterChallengeSnapshot().phase==='running');
    await player.evaluate(()=>roadsterChallengeAdvance(1200));
    await page.waitForFunction(()=>['complete','failed'].includes(window.guidedState?.phase),{},{timeout:60000});
    const state=await page.evaluate(()=>window.guidedState);assert.equal(state.phase,'complete',state.error);assert.equal(state.activeUpdates,8);assert.ok(Math.abs(state.measuredMeters-6)<1e-8);
    assert.equal(player.isDetached(),false,'The guided challenge should reuse the loaded saved transfer');
    assert.equal(await player.evaluate(()=>roadsterChallengeSnapshot().phase),'landed');
    const downloadable=await fetch(harness.origin+await page.locator('#challenge-download').getAttribute('href'));
    assert.equal(downloadable.status,200);assert.match(downloadable.headers.get('content-disposition'),/attachment/);
    assert.deepEqual(posts,[]);assert.deepEqual(errors,[]);
    await page.locator('[data-destination="paku-paku"]').click();await page.waitForFunction(()=>window.currentDestination==='paku-paku'&&document.querySelector('#transfer-status').textContent==='VERIFIED TRANSFER');
    assert.equal(await page.locator('#roadster-panel').isHidden(),true);
  }finally{await harness.close();}
});

test('historical Roadster versions display their own verification count',async()=>{
  const historical=await readRoadsterArtifact(fileURLToPath(new URL('../transfers/roadster/versions/',import.meta.url)),'9126d1dd00b794daab3fda1711fd3b7058b4962eed800cc8105fd4b874d6eed3');
  const lab={status:()=>({enabled:false,activeRunId:null,budget:null}),artifact:async id=>{assert.equal(id,historical.id);return historical;}};
  const harness=await createPakuBrowser({lab});
  try{
    const {page}=await harness.page();await page.goto(harness.origin+'/roadster/play/'+historical.id);
    await page.waitForFunction(id=>window.currentRoadsterArtifact?.id===id,historical.id);
    await reveal(page,'#check-count');
    assert.equal(await page.locator('#check-count').textContent(),'8 mapping cases + 7 browser checks');
    await page.locator('[data-destination="paku-paku"]').click();
    assert.equal(await page.locator('#check-count').textContent(),'11 mapping cases + 8 browser checks');
  }finally{await harness.close();}
});

test('Roadster touch dash reaches the isolated frame and large player preserves its state',async()=>{
  const harness=await createPakuBrowser();let context;
  try{
    const {page:seed}=await harness.page();context=await seed.context().browser().newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    const page=await context.newPage();await page.goto(harness.origin);await page.waitForFunction(()=>window.currentDestination==='roadster'&&document.querySelector('#transfer-status').textContent==='VERIFIED TRANSFER');
    await prepareVisitor(page);
    const frame=await(await page.$('#transfer-game')).contentFrame(),url=new URL(frame.url());url.searchParams.set('test','1');await frame.goto(url.href);await frame.waitForFunction(()=>window.roadsterReady);
    await frame.evaluate(()=>{roadsterChallengeStart({borrow:true});roadsterChallengeAdvance(636);});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.locator('[data-expand="transfer-game"]').tap();
    const button=page.locator('[data-dash]');await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();
    const session=await context.newCDPSession(page);await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2,id:1}]});
    await frame.waitForFunction(()=>roadsterSnapshot().motion.dashHeld);const after=await frame.evaluate(()=>roadsterChallengeAdvance(8));
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await frame.waitForFunction(()=>!roadsterSnapshot().motion.dashHeld);
    assert.equal(after.activeUpdates,8);assert.equal(after.dashMeters,6);
    const car=await frame.evaluate(()=>roadsterSnapshot().car);
    await page.locator('[data-expand="transfer-game"]').tap();assert.deepEqual(await frame.evaluate(()=>roadsterSnapshot().car),car);
    assert.equal((await frame.evaluate(()=>roadsterChallengeSnapshot())).tick,after.tick);
  }finally{await context?.close();await harness.close();}
});
