import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLabService} from '../lab/service.mjs';
import {createPakuBrowser} from '../evaluator/browser-harness.mjs';

test('the investigation form shows actual public tool events and a qualified conclusion',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'motion-lab-ui-'));let calls=0;
  const lab=await createLabService({directory,client:{},investigateRun:async({onUpdate})=>{
    calls++;const report={status:'running',estimatedCostUsd:.01,reservedCostUsd:0,requests:[{status:'completed'}],toolCalls:[{callId:'fixture-inspect',name:'inspect_wasm',ok:true,args:{view:'overview'},result:{exports:['update']}}],conclusionVerified:false};await onUpdate(report);
    report.toolCalls.push({callId:'fixture-experiment',name:'run_original',experimentId:'exp-001',ok:true,args:{hypothesis:'Fixture hypothesis chosen by the injected test client.',steps:[{buttons:33,frames:50,checkpoint:'held'}]},result:{checkpoints:[{text:'fixture observation'}]}});
    report.conclusion='Fixture interpretation, exp-001 and exp-002; this test does not call Meta.';report.status='completed';await onUpdate(report);return report;
  }});
  const harness=await createPakuBrowser({lab});
  try{
    const {page,errors}=await harness.page();await page.goto(harness.origin+'/?destination=paku-paku');await page.waitForFunction(()=>!document.querySelector('#investigation-submit').disabled);assert.equal(calls,0);
    await page.locator('#investigation-submit').click();await page.waitForFunction(()=>document.querySelector('#lab-mode').textContent==='RECORDED RUN');
    assert.match(await page.locator('#investigation-events').innerText(),/Fixture hypothesis/);assert.match(await page.locator('#investigation-conclusion').innerText(),/NOT INDEPENDENTLY VERIFIED/);assert.equal(calls,1);
    const path=await page.locator('#investigation-report').getAttribute('href'),report=await(await fetch(harness.origin+path)).json();assert.equal(report.report.conclusionVerified,false);
    const denied=await fetch(harness.origin+'/api/investigations',{method:'POST',headers:{Origin:'https://example.invalid','Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,403);assert.deepEqual(errors,[]);
  }finally{await harness.close();await lab.close();await rm(directory,{recursive:true,force:true});}
});
