import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLabService} from '../src/lab/service.mjs';
import {createPakuBrowser} from '../src/evaluator/browser-harness.mjs';
import {reveal} from './helpers/app-navigation.mjs';
import {loadSavedRoadster} from '../src/roadster/saved.mjs';

test('the investigation form shows actual public tool events and a qualified conclusion',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'motion-lab-ui-'));let calls=0;
  const lab=await createLabService({directory,client:{},investigateRun:async({onUpdate})=>{
    calls++;const report={status:'running',estimatedCostUsd:.01,reservedCostUsd:0,requests:[{status:'completed'}],toolCalls:[{callId:'fixture-inspect',name:'inspect_wasm',ok:true,args:{view:'overview'},result:{exports:['update']}}],conclusionVerified:false};await onUpdate(report);
    report.toolCalls.push({callId:'fixture-experiment',name:'run_original',experimentId:'exp-001',ok:true,args:{hypothesis:'Fixture hypothesis chosen by the injected test client.',steps:[{buttons:33,frames:50,checkpoint:'held'}]},result:{checkpoints:[{text:'fixture observation'}]}});
    report.conclusion='Fixture interpretation, exp-001 and exp-002; this test does not call Meta.';report.status='completed';await onUpdate(report);return report;
  }});
  const harness=await createPakuBrowser({lab});
  try{
    const {page,errors}=await harness.page();await page.goto(harness.origin+'/?destination=paku-paku');await reveal(page,'#investigation-submit');await page.waitForFunction(()=>!document.querySelector('#investigation-submit').disabled);assert.equal(calls,0);
    await page.locator('#investigation-submit').click();await page.waitForFunction(()=>document.querySelector('#lab-mode').textContent==='COMPLETED META RUN');
    assert.match(await page.locator('#investigation-events').innerText(),/Fixture hypothesis/);assert.match(await page.locator('#investigation-conclusion').innerText(),/NOT INDEPENDENTLY VERIFIED/);assert.equal(calls,1);
    const path=await page.locator('#investigation-report').getAttribute('href'),report=await(await fetch(harness.origin+path)).json();assert.equal(report.report.conclusionVerified,false);
    const denied=await fetch(harness.origin+'/api/investigations',{method:'POST',headers:{Origin:'https://example.invalid','Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,403);assert.deepEqual(errors,[]);
  }finally{await harness.close();await lab.close();await rm(directory,{recursive:true,force:true});}
});

test('a lost investigation response can reconnect after refresh without duplicate generation',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'motion-lab-reconnect-'));let calls=0;
  const lab=await createLabService({directory,client:{},investigateRun:async()=>{calls++;return{status:'completed',estimatedCostUsd:.01,reservedCostUsd:0,requests:[],toolCalls:[],conclusion:'Injected reconnect fixture',conclusionVerified:false};}});
  const harness=await createPakuBrowser({lab});
  try{
    const {page}=await harness.page();await page.goto(harness.origin+'/?destination=paku-paku');
    await page.route('**/api/investigations',async route=>{await route.fetch();await route.abort('failed');},{times:1});
    await reveal(page,'#investigation-submit');await page.waitForFunction(()=>!document.querySelector('#investigation-submit').disabled);await page.locator('#investigation-submit').click();
    await page.waitForFunction(()=>document.querySelector('#investigation-submit').textContent.includes('Reconnect'));
    await page.reload();await reveal(page,'#investigation-submit');await page.waitForFunction(()=>document.querySelector('#investigation-submit').textContent.includes('Reconnect')&&!document.querySelector('#investigation-submit').disabled);
    await page.locator('#investigation-submit').click();await page.waitForFunction(()=>document.querySelector('#investigation-conclusion').textContent.includes('Injected reconnect fixture'));
    assert.equal(calls,1);
  }finally{await harness.close();await lab.close();await rm(directory,{recursive:true,force:true});}
});

test('a lost Roadster response retains its request across refresh and reconnects to one artifact',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'motion-car-reconnect-')),base=await loadSavedRoadster();let calls=0;
  const lab=await createLabService({directory,client:{},baseArtifact:base,generateTransfer:async({parent,onUpdate})=>{
    calls++;await onUpdate({estimatedCostUsd:.01,reservedCostUsd:0,fixture:true});
    return{files:parent.files,metadata:{kind:'roadster',fixture:true,componentId:parent.componentId,recipientRevision:parent.recipientRevision,parentArtifactId:parent.id,intent:parent.intent,environment:parent.environment,summary:'Injected reconnect fixture; no model call'}};
  }});
  const harness=await createPakuBrowser({lab});
  try{
    const {page}=await harness.page();await page.goto(harness.origin+'/?destination=roadster');
    await page.waitForFunction(()=>window.currentRoadsterArtifact);
    await page.waitForFunction(()=>!document.querySelector('#roadster-submit').disabled);
    await page.route('**/api/roadster/transfers',async route=>{await route.fetch();await route.abort('failed');},{times:1});
    await page.locator('#roadster-prompt').fill('Injected reconnect fixture');await page.locator('#roadster-submit').click();
    await page.waitForFunction(()=>document.querySelector('#roadster-submit').textContent.includes('Reconnect'));
    await page.reload();await page.waitForFunction(()=>document.querySelector('#roadster-submit')?.textContent.includes('Reconnect'));await page.waitForFunction(()=>document.querySelector('#roadster-submit').textContent.includes('Reconnect')&&!document.querySelector('#roadster-submit').disabled);
    await page.locator('#roadster-submit').click();await page.waitForFunction(()=>window.currentRoadsterArtifact?.summary==='Injected reconnect fixture; no model call');
    assert.equal(calls,1);assert.equal((await page.evaluate(()=>window.currentRoadsterArtifact)).parentArtifactId,base.id);
    await page.waitForFunction(()=>document.querySelector('#transfer-status').textContent==='CHECKED REMIX');
  }finally{await harness.close();await lab.close();await rm(directory,{recursive:true,force:true});}
});

test('recorded investigation displays its measured contrast without a POST or API key',async()=>{
  const harness=await createPakuBrowser();
  try{
    const {page}=await harness.page(),posts=[];page.on('request',request=>{if(request.method()==='POST')posts.push(request.url());});
    await page.goto(harness.origin+'/?destination=paku-paku');await reveal(page,'#view-investigation');await page.locator('#view-investigation').click();
    await page.waitForFunction(()=>document.querySelector('#investigation-conclusion').textContent.includes('rejects preservation hypothesis'));
    assert.ok(await page.locator('.measurement-table').count()>=2);assert.match(await page.locator('#lab-mode').innerText(),/SAVED RECORDING/);
    assert.equal(await page.locator('#investigation-report').getAttribute('href'),'/api/investigations/saved/neutral-after-left');assert.deepEqual(posts,[]);
  }finally{await harness.close();}
});

test('an incomplete saved exploration is labelled as failed and never presented as a completed comparison',async()=>{
  const harness=await createPakuBrowser();
  try{
    const {page,errors}=await harness.page(),posts=[];page.on('request',request=>{if(request.method()==='POST')posts.push(request.url());});
    await page.goto(harness.origin+'/?destination=paku-paku');await reveal(page,'#view-branch-investigation');await page.locator('#view-branch-investigation').click();
    await page.waitForFunction(()=>document.querySelector('#investigation-conclusion').textContent.includes('INCOMPLETE RUN'));
    assert.equal(await page.locator('#lab-mode').innerText(),'SAVED RECORDING');
    assert.match(await page.locator('#lab-progress').innerText(),/incomplete comparison/);
    assert.equal(await page.locator('.branch-card').count(),2);assert.equal(await page.locator('.comparison-card').count(),0);
    assert.match(await page.locator('#investigation-events').innerText(),/fork_checkpoint/);assert.deepEqual(posts,[]);assert.deepEqual(errors,[]);
  }finally{await harness.close();}
});

test('the saved local control displays real comparison and images without attributing it to Meta',async()=>{
  const harness=await createPakuBrowser();
  try{
    const {page,errors}=await harness.page(),posts=[];page.on('request',request=>{if(request.method()==='POST')posts.push(request.url());});
    await page.goto(harness.origin+'/?destination=paku-paku');await reveal(page,'#view-local-control');await page.locator('#view-local-control').click();
    await page.waitForFunction(()=>document.querySelector('#lab-mode').textContent==='LOCAL VERIFICATION');
    assert.match(await page.locator('#lab-progress').innerText(),/human-scripted/);assert.match(await page.locator('#investigation-conclusion').innerText(),/60 source pixels/);
    assert.equal(await page.locator('.comparison-card').count(),1);assert.equal(await page.locator('#investigation-captures img').count(),2);
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(posts,[]);assert.deepEqual(errors,[]);
  }finally{await harness.close();}
});
