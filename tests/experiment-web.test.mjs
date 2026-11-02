import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createPakuBrowser} from '../evaluator/browser-harness.mjs';
import {reveal} from './helpers/app-navigation.mjs';
import {digest} from '../component/build.mjs';

test('the workbench displays programs, managed pairs, actual evidence and downloads on desktop and mobile',async()=>{
  const harness=await createPakuBrowser();
  try{
    const {page,errors}=await harness.page(),posts=[];page.on('request',request=>{if(request.method()==='POST')posts.push(request.url());});
    await page.setViewportSize({width:1440,height:1000});await page.goto(harness.origin+'/?destination=paku-paku');
    await reveal(page,'#view-programmatic-control');await page.locator('#view-programmatic-control').click();await page.waitForFunction(()=>document.querySelectorAll('.managed-comparison').length===3);
    assert.equal(await page.locator('#lab-mode').innerText(),'LOCAL VERIFICATION');
    assert.match(await page.locator('#investigation-programs').innerText(),/Human-scripted local verification/);
    assert.match(await page.locator('#investigation-programs').innerText(),/sdk.sweep/);
    assert.equal(await page.locator('.managed-branch').count(),6);assert.match(await page.locator('#investigation-edits').innerText(),/40/);
    assert.doesNotMatch(await page.locator('#investigation-edits').innerText(),/No experimental memory writes/);
    assert.match(await page.locator('#investigation-comparisons').innerText(),/Initial memory edit: checkpoint update 11/);
    assert.match(await page.locator('#investigation-comparisons').innerText(),/First observed behavior or rendering divergence/);
    assert.match(await page.locator('#investigation-findings').innerText(),/human-scripted interpretation/);
    assert.equal(await page.locator('#investigation-captures img').count(),1);
    assert.equal(await page.locator('#investigation-captures img').evaluate(img=>img.complete&&img.naturalWidth===160),true);
    const programDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download experiment program',exact:true}).click();
    assert.match(await readFile(await(await programDownload).path(),'utf8'),/sdk.sweep/);
    const evidenceDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download experiment evidence',exact:true}).nth(1).click();
    const evidence=await evidenceDownload,bytes=await readFile(await evidence.path());assert.equal(digest(bytes),evidence.suggestedFilename().slice(0,-5));
    const payload=JSON.parse(bytes);assert.equal(payload.trace.length,8);assert.equal(payload.edits[0].newValue,40);assert.equal(payload.trace.at(-1).control.normalized.dx,60);assert.equal(payload.trace.at(-1).intervention.normalized.dx,16);
    const evidenceId=payload.experimentId;await page.locator('#investigation-findings a').first().click();assert.equal(await page.evaluate(()=>decodeURIComponent(location.hash)),'#evidence-'+evidenceId);
    await page.setViewportSize({width:320,height:740});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await reveal(page,'#view-investigation');await page.locator('#view-investigation').click();await page.waitForFunction(()=>document.querySelector('#lab-mode').textContent==='SAVED RECORDING');
    assert.equal(await page.locator('.program-card:visible').count(),0);assert.equal(await page.locator('.managed-branch:visible').count(),0);
    assert.deepEqual(posts,[]);assert.deepEqual(errors,[]);
  }finally{await harness.close();}
});

test('the local benchmark measures matching scenarios and does not invent model or cost results',async()=>{
  const report=JSON.parse(await readFile(new URL('../lab/recordings/experiment-benchmark.json',import.meta.url),'utf8'));
  assert.equal(report.modelCalled,false);assert.equal(report.scenarios.length,6);
  for(const value of [40,5]){
    const group=report.scenarios.filter(item=>item.value===value);assert.deepEqual(group.map(item=>item.modelFacingToolInvocations),[6,2,1]);
    for(const item of group){assert.deepEqual(item.final,group[0].final);assert.equal(item.modelGenerationRequestsMeasured,null);assert.equal(item.completed,true);assert.ok(item.modelFacingResultBytes>0);}
  }
});

test('the saved Meta program failure shows the completed trial and later decision without claiming a completed investigation',async()=>{
  const harness=await createPakuBrowser();
  try{
    const {page,errors}=await harness.page(),posts=[];page.on('request',request=>{if(request.method()==='POST')posts.push(request.url());});
    await page.goto(harness.origin+'/?destination=paku-paku');await reveal(page,'#view-programmatic-investigation');await page.locator('#view-programmatic-investigation').click();
    await page.waitForFunction(()=>document.querySelectorAll('.program-card').length===2);
    assert.equal(await page.locator('#lab-mode').innerText(),'SAVED RECORDING');assert.match(await page.locator('#lab-progress').innerText(),/code inspection/);
    assert.match(await page.locator('#investigation-conclusion').innerText(),/INCOMPLETE RUN/);
    assert.equal(await page.locator('.managed-comparison').count(),1);assert.equal(await page.locator('.managed-branch').count(),2);
    assert.match(await page.locator('#investigation-programs').innerText(),/output byte limit exceeded/);assert.match(await page.locator('#investigation-programs').innerText(),/read_experiment/);
    await page.locator('#investigation-findings a').first().click();const target=await page.evaluate(()=>document.getElementById(decodeURIComponent(location.hash.slice(1)))?.textContent);assert.match(target,/Replay checkpoint/);
    await page.setViewportSize({width:320,height:740});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(posts,[]);assert.deepEqual(errors,[]);
  }finally{await harness.close();}
});
