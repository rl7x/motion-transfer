import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createComponentWorkbench} from '../agent/component-workbench.mjs';
import {createInvestigationSession} from '../runtime/investigation-session.mjs';
import {loadTarget} from '../agent/target.mjs';
import {compileMotion,digest} from '../component/build.mjs';
import {saveInvestigationEvidence} from '../lab/investigation-evidence.mjs';

const source=`export function init(){return {cooldown:0,remaining:0};}
export function step(state){return {state,output:{ownsMotion:false,displacement:{x:0,y:0},events:[]}};}`;
async function setup(options){
  const session=await createInvestigationSession((await loadTarget()).bytes);
  session.recordStatic({id:'binary:func9',functionIndex:9,kind:'wat'});
  const observed=(await session.execute('session_advance',{branchId:'main',hypothesis:'Collect test evidence without model calls.',watches:[],steps:[{buttons:1,frames:1,checkpoint:'entered'}]})).result.checkpoints[0];
  const workbench=createComponentWorkbench(session,options);
  const selection=(await workbench.execute('select_component_evidence',{functionIndices:[9],evidenceIds:[observed.observationId],scope:'Offline fixture for the workbench protocol.'})).result;
  const candidate={selectionId:selection.selectionId,source,timerFields:{cooldown:'cooldown',remaining:'remaining'},contract:{name:'offline fixture',scope:'Motion only.',defaults:{walkingSpeed:2,dashDistance:60,cooldownTicks:25,initialCooldownTicks:10},stateDescription:'Integer counters.',rules:[{description:'A deliberately incomplete fixture.',evidence:[observed.observationId]}],limitations:['No independent recovery is claimed by this fixture.']}};
  return{session,workbench,candidate};
}

test('real development failures expose normalized movement, timer and event divergence for revision',async()=>{
  const {session,workbench,candidate}=await setup();
  await assert.rejects(workbench.execute('submit_component_candidate',{...candidate,source:source.replaceAll('export ','')}),/must export named ES module functions init and step/);
  assert.equal(session.recovery.attempts.length,0,'Invalid modules are rejected before consuming a behavioral evaluation');
  const first=(await workbench.execute('submit_component_candidate',candidate)).result;
  assert.equal(first.development.passed,false);assert.equal(first.acceptanceRun,false);assert.equal(first.canRevise,true);
  assert.equal(first.attempt,1);
  assert.ok(first.development.results.some(result=>result.firstDivergence?.expected.timers));
  assert.equal(first.development.eventTiming,'exact');
  assert.ok(first.development.results.some(result=>Array.isArray(result.firstDivergence?.expected.events)));
  await assert.rejects(workbench.execute('freeze_component',{candidateId:first.candidateId}),/development-passed/);
  const second=(await workbench.execute('submit_component_candidate',{...candidate,source:source.replace('x:0','x:1')})).result;
  assert.equal(second.attempt,2);assert.notEqual(second.candidateId,first.candidateId);assert.equal(second.development.passed,false);
  assert.equal(session.recovery.acceptanceStarted,undefined);
  await assert.rejects(workbench.execute('select_component_evidence',{functionIndices:[102],evidenceIds:[],scope:'Uninspected source.'}),/Inspect or decompile/);
});

test('freezing precedes independent acceptance and accepted source uses the existing package pipeline',async()=>{
  const stages=[];
  // This injected evaluator verifies orchestration only; it claims no recovery.
  const {session,workbench,candidate}=await setup({seed:()=>123,evaluate:async(text,config,cases,{suite})=>{stages.push(suite);const compiled=await compileMotion(text);return{passed:true,suite,sourceSha256:compiled.sourceSha256,javascriptSha256:compiled.javascriptSha256,results:[{passed:true,name:'injected protocol fixture'}]};}});
  const submitted=(await workbench.execute('submit_component_candidate',candidate)).result;
  await assert.rejects(workbench.execute('accept_component',{candidateId:submitted.candidateId}),/frozen candidate/);
  await workbench.execute('freeze_component',{candidateId:submitted.candidateId});
  const journal=session.snapshot();assert.equal(journal.recovery.acceptanceStarted,undefined);
  await assert.rejects(workbench.execute('submit_component_candidate',candidate),/frozen/);
  assert.equal((await workbench.execute('accept_component',{candidateId:submitted.candidateId})).result.passed,true);
  assert.deepEqual(stages,['development','acceptance']);
  await assert.rejects(workbench.execute('accept_component',{candidateId:submitted.candidateId}),/once only/);
  const directory=await mkdtemp(join(tmpdir(),'component-publication-'));
  try{
    await saveInvestigationEvidence(directory,session.snapshot(),{model:'injected-local-fixture'});
    const root=join(directory,'sessions',session.id,'components',submitted.candidateId);
    assert.equal(await readFile(join(root,'component.ts'),'utf8'),source);
    const provenance=JSON.parse(await readFile(join(root,'provenance.json'),'utf8'));assert.equal(provenance.sourceSha256,digest(source));
    const receipt=JSON.parse(await readFile(join(root,'publication.json'),'utf8'));assert.equal(receipt.candidateId,submitted.candidateId);
    await saveInvestigationEvidence(directory,session.snapshot(),{model:'injected-local-fixture'});
    await writeFile(join(root,'contract.json'),'changed fixture');
    await assert.rejects(saveInvestigationEvidence(directory,session.snapshot()),/integrity mismatch/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('acceptance failure never unlocks development or another held-out trial',async()=>{
  const {workbench,candidate}=await setup({evaluate:async(text,config,cases,{suite})=>{const compiled=await compileMotion(text);return{...compiled,passed:suite==='development',results:[]};}});
  const submitted=(await workbench.execute('submit_component_candidate',candidate)).result;
  await workbench.execute('freeze_component',{candidateId:submitted.candidateId});
  assert.equal((await workbench.execute('accept_component',{candidateId:submitted.candidateId})).result.passed,false);
  await assert.rejects(workbench.execute('submit_component_candidate',candidate),/frozen/);
  await assert.rejects(workbench.execute('accept_component',{candidateId:submitted.candidateId}),/once only/);
});
