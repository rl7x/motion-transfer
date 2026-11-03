import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { createPreviewServer } from '../web/server.mjs';
import { ACCEPTED_COMPONENT_ID } from '../hosting/component-pin.mjs';

test('the version picker reopens exact older candidates, preserves failed comparisons and refreshes after publication without inference', async () => {
  const server=await createPreviewServer();let browser;
  try{
    const base=await(await fetch(server.origin+'/api/parallaxia/base')).json();
    const ids=['a','b','c','d'].map(char=>char.repeat(64));let completed=false;
    const versions=ids.map((id,index)=>({id,parentArtifactId:index===1?ids[0]:base.id,
      recipientId:'parallaxia',componentId:ACCEPTED_COMPONENT_ID,status:index===2?'unsuccessful':'ready',
      createdAt:`2026-11-03T16:0${index}:00.000Z`,prompt:`Synthetic saved request ${index+1}`,estimatedCostUsd:0.01,
      summary:'Synthetic UI fixture; not a model result',intent:{unitScale:index===0?0.05:0.1,direction:index===0?'opposite':'facing',activation:'press'}}));
    const original={succeeded:false,lostLife:false,reachedTick:null,endDigest:'e'.repeat(64),frames:[]};
    const experiment={checkpoint:{tick:40,stateDigest:'f'.repeat(64)},scenario:{target:{minX:100,maxX:101,minY:-11,maxY:-7},horizonTicks:120},
      interventionTick:1,firstDifferenceTick:2,original,candidate:original,satisfied:false};
    browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});
    const page=await browser.newPage({viewport:{width:1200,height:1000}}),posts=[],errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST')posts.push(request.url());});
    const jobId='11111111-1111-4111-8111-111111111111';
    await page.addInitScript(({jobId,parentId})=>{
      if(window.top!==window||sessionStorage.getItem('history-test-initialized'))return;
      sessionStorage.setItem('history-test-initialized','true');
      sessionStorage.setItem('motion-creator-session',JSON.stringify({sessionId:'history-fixture',invite:'',adult:true,pending:{
        idempotencyKey:'history-fixture-request',parentArtifactId:parentId,prompt:'Synthetic pending request',jobId,
      }}));
    },{jobId,parentId:base.id});
    await page.route('**/api/remixes/status',route=>route.fulfill({json:{generationConfigured:true,maxJobCostUsd:7}}));
    await page.route('**/api/remixes/'+jobId,route=>route.fulfill({json:{id:jobId,status:completed?'ready':'verifying',
      artifactId:completed?ids[3]:null,parentArtifactId:base.id,estimatedCostUsd:0,createdAt:'2026-11-03T16:03:00.000Z',
      finishedAt:completed?'2026-11-03T16:03:05.000Z':null,summary:'Synthetic pending fixture',urls:completed?{play:`/artifacts/${ids[3]}/play.html`}:null}}));
    await page.route('**/api/catalog',route=>route.fulfill({json:{versions:completed?versions:versions.slice(0,3),parents:[],artifacts:[]}}));
    for(const version of versions){
      await page.route('**/artifacts/'+version.id+'/receipt.json',route=>route.fulfill({json:{componentId:ACCEPTED_COMPONENT_ID,
        recipient:{id:'parallaxia'},passed:version.status==='ready',intent:version.intent,parentArtifactId:version.parentArtifactId,
        ...(version.status==='unsuccessful'?{experiment}:{})}}));
      await page.route('**/artifacts/'+version.id+'/play.html*',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><body data-version="${version.id}">Synthetic saved frame</body>`}));
    }
    await page.goto(server.origin);await page.locator('#generation-version option').nth(3).waitFor({state:'attached'});
    assert.equal(await page.locator('#generation-version option').count(),4);
    for(const id of [ids[1],ids[0]]){
      await page.locator('#generation-version').selectOption(id);await page.locator('#generation-play').click();
      await page.waitForFunction(id=>document.querySelector('#parallaxia-game')?.getAttribute('src').includes(id),id);
      const frame=await page.locator('#parallaxia-game').contentFrame();await frame.locator('body[data-version="'+id+'"]').waitFor();
      assert.equal(new URL(page.url()).searchParams.get('artifact'),id);
      assert.equal(await page.getByRole('link',{name:'Download this exact game',exact:true}).getAttribute('href'),`/artifacts/${id}/download.zip`);
    }
    await page.reload();await page.waitForFunction(id=>document.querySelector('#parallaxia-game')?.getAttribute('src').includes(id),ids[0]);
    await page.locator('#generation-version').selectOption(ids[1]);await page.getByRole('button',{name:'Play parent',exact:true}).click();
    await page.waitForFunction(id=>document.querySelector('#parallaxia-game')?.getAttribute('src').includes(id),ids[0]);
    await page.locator('#generation-version').selectOption(ids[2]);await page.getByRole('button',{name:'View unsuccessful comparison',exact:true}).click();
    await page.getByRole('heading',{name:'Goal unsatisfied · original retained',exact:true}).waitFor();
    assert.ok((await page.locator('#parallaxia-game').getAttribute('src')).includes(base.id));
    assert.equal(await page.locator('#generation-version').inputValue(),ids[2]);
    completed=true;await page.locator('#generation-version option[value="'+ids[3]+'"]').waitFor({state:'attached'});
    assert.equal(await page.locator('#generation-version').inputValue(),ids[2],'A new ready job must not replace the selected historical view');
    await page.locator('#generation-version').selectOption(base.id);await page.locator('#generation-play').click();
    await page.waitForURL('**/?artifact='+base.id);await page.waitForFunction(id=>document.querySelector('#parallaxia-game')?.getAttribute('src').includes(id),base.id);
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(posts,[]);assert.deepEqual(errors,[]);
  }finally{await browser?.close();await server.close();}
});
