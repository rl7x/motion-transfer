import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCartridgeTools} from '../src/agent/tools.mjs';
import {createLabService} from '../src/lab/service.mjs';
import {createPakuBrowser} from '../src/evaluator/browser-harness.mjs';
import {reveal} from './helpers/app-navigation.mjs';

test('desktop and mobile investigation views expose actual branches, edits, images, evidence and source exports',async()=>{
  const tools=createCartridgeTools(),directory=await mkdtemp(join(tmpdir(),'session-ui-'));let lab,harness,calls=0;
  try{
    await tools.open();
    const advanced=(await tools.run('session_advance',{branchId:'main',hypothesis:'Offline UI fixture: observe the prepared donor.',watches:[],steps:[{buttons:1,frames:1,checkpoint:'gameplay'},{buttons:0,frames:10,checkpoint:'ready'}]})).result;
    await tools.run('inspect_function',{functionIndex:9,startLine:1,lineCount:8});
    const checkpoint=(await tools.run('checkpoint_state',{branchId:'main',label:'UI fixture branch point'})).result;
    for(const branchId of ['control','variant'])await tools.run('fork_checkpoint',{branchId,checkpointId:checkpoint.checkpointId,watches:[]});
    await tools.run('write_memory',{branchId:'variant',edits:[{address:advanced.checkpoints.at(-1).motion.fieldHints.cooldown.address,type:'i16',value:40,hypothesis:'Offline fixture delays activation.'}],watches:[]});
    const comparison=(await tools.run('compare_branches',{controlBranchId:'control',experimentalBranchId:'variant',hypothesis:'Offline fixture uses identical inputs.',watches:[],steps:[{buttons:33,frames:8,checkpoint:'dash'}]})).result;
    await tools.run('capture_frame',{branchId:'variant',reason:'Actual framebuffer from an offline test fixture.'});
    for(const status of ['supported','rejected','unresolved'])await tools.run('record_finding',{claim:'Offline '+status+' interpretation; no live model.',status,confidence:'low',evidenceIds:[comparison.comparisonId]});
    const selection=(await tools.run('select_component_evidence',{functionIndices:[9],evidenceIds:[comparison.comparisonId],scope:'Offline UI protocol fixture.'})).result;
    const source='export function init(){return {c:0,r:0}};export function step(state){return {state,output:{ownsMotion:false,displacement:{x:0,y:0},events:[]}}}';
    await tools.run('submit_component_candidate',{selectionId:selection.selectionId,source,timerFields:{cooldown:'c',remaining:'r'},contract:{name:'offline UI fixture',scope:'Motion only.',defaults:{walkingSpeed:2,dashDistance:60,cooldownTicks:25,initialCooldownTicks:10},stateDescription:'Fixture counters.',rules:[{description:'Deliberately incomplete fixture.',evidence:[comparison.comparisonId]}],limitations:['No model inference or independent recovery.']}});
    const report={status:'completed',model:'injected-offline-fixture',startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),estimatedCostUsd:0,reservedCostUsd:0,requests:[],session:tools.sessionState,toolCalls:[{name:'session_advance',experimentId:'exp-001',ok:true,args:{hypothesis:'Actual offline test observations.'},result:advanced},{name:'checkpoint_state',ok:true,args:{},result:checkpoint},{name:'compare_branches',experimentId:'exp-002',ok:true,args:{hypothesis:comparison.hypothesis},result:comparison}],conclusion:'Offline protocol fixture; model claims are not independently verified.',conclusionVerified:false};
    lab=await createLabService({directory,client:{},investigateRun:async()=>{calls++;return report;}});harness=await createPakuBrowser({lab});
    const {page,errors}=await harness.page();await page.setViewportSize({width:1280,height:900});await page.goto(harness.origin+'/?destination=paku-paku');
    await reveal(page,'#investigation-submit');await page.waitForFunction(()=>!document.querySelector('#investigation-submit').disabled);assert.equal(calls,0);
    await page.locator('#investigation-submit').click();await page.waitForFunction(()=>!document.querySelector('#investigation-workspace').hidden);
    assert.equal(await page.locator('.branch-card').count(),3);assert.match(await page.locator('#investigation-edits').innerText(),/40/);
    assert.match(await page.locator('#investigation-comparisons').innerText(),/First measured motion/);
    assert.equal(await page.locator('.finding-group').count(),3);assert.equal(await page.locator('#investigation-captures img').count(),1);
    assert.equal(await page.locator('#investigation-captures img').evaluate(img=>img.complete&&img.naturalWidth===160),true);
    await page.getByText('Component development and exports',{exact:true}).click();
    assert.match(await page.locator('#investigation-candidates').innerText(),/development failed/);
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download candidate TypeScript'}).click();
    assert.equal(await readFile(await(await pending).path(),'utf8'),source);
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);assert.equal(calls,1);
  }finally{await harness?.close();await lab?.close();await tools.close();await rm(directory,{recursive:true,force:true});}
});
