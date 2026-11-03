import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { createPreviewServer } from '../web/server.mjs';

test('a rejected PARALLAXIA admission stops retrying, retains its draft and allows an explicit new request', async () => {
  const server=await createPreviewServer();let browser;
  try{
    browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});
    const page=await browser.newPage(),posts=[],errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const prompt='Make the dash backward, only on a fresh press. And half as far';
    const originalKey=crypto.randomUUID();
    await page.addInitScript(({prompt,key})=>{
      if(window.top!==window)return;
      if(sessionStorage.getItem('admission-test-initialized'))return;
      sessionStorage.setItem('admission-test-initialized','true');
      sessionStorage.setItem('motion-transfer-age',JSON.stringify('18+'));
      sessionStorage.setItem('motion-creator-session',JSON.stringify({sessionId:'local-test-session',invite:'',adult:true,pending:{
        idempotencyKey:key,parentArtifactId:'ab'.repeat(32),prompt,jobId:null,
      }}));
    },{prompt,key:originalKey});
    await page.route('**/api/remixes/status',route=>route.fulfill({json:{generationConfigured:true,maxJobCostUsd:7,sessionJobLimit:null}}));
    const job={id:'11111111-1111-4111-8111-111111111111',status:'unsupported',artifactId:null,urls:null,
      estimatedCostUsd:0,createdAt:new Date().toISOString(),finishedAt:new Date().toISOString(),summary:'Synthetic admission fixture'};
    await page.route('**/api/remixes',async route=>{
      posts.push(route.request().postDataJSON());
      await route.fulfill(posts.length===1?{status:429,json:{error:'Session request quota of 2 jobs is exhausted; this is separate from the dollar budget'}}:{status:202,json:job});
    });
    await page.route('**/api/remixes/'+job.id,route=>route.fulfill({json:job}));
    await page.goto(server.origin);
    await page.getByRole('alert').filter({hasText:'Automatic retries stopped'}).waitFor();
    assert.equal(posts.length,1);assert.doesNotMatch(await page.getByRole('alert').innerText(),/Reconnecting/);
    assert.equal(await page.locator('#motion-prompt').inputValue(),prompt);
    assert.equal(await page.locator('#motion-submit').isEnabled(),true);
    assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('motion-creator-session')).pending),null);
    // The old client retried every 2.5 seconds even after a definitive 429.
    await new Promise(resolve=>setTimeout(resolve,2800));assert.equal(posts.length,1);
    await page.reload();await page.locator('#parallaxia-game').waitFor();assert.equal(posts.length,1);
    await page.locator('#motion-prompt').fill(prompt);await page.locator('#motion-submit').click();
    await page.waitForFunction(()=>document.querySelector('#motion-job')?.textContent.includes('unsupported'));
    assert.equal(posts.length,2);assert.equal(posts[0].idempotencyKey,originalKey);assert.notEqual(posts[1].idempotencyKey,originalKey);
    assert.equal(posts[1].prompt,prompt);assert.deepEqual(errors,[]);
  }finally{await browser?.close();await server.close();}
});
