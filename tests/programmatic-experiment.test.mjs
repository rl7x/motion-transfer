import assert from 'node:assert/strict';
import test from 'node:test';
import {createCartridgeTools} from '../src/agent/tools.mjs';

const preparation={requestId:'prepare-regression',hypothesis:'Reach an actual ready checkpoint, without choosing branch names.',steps:[{buttons:1,frames:1,checkpoint:'gameplay'},{buttons:0,frames:10,checkpoint:'ready'}],watches:[]};
function experiment(prepared,requestId='paired-regression',value=40){return{requestId,hypothesis:'Test a timer intervention without prescribing its outcome.',checkpointId:prepared.checkpointId,interventions:[{targetId:prepared.targets.find(target=>target.name==='cooldown').id,value,hypothesis:'A candidate cooldown intervention.'}],steps:[{buttons:33,frames:8,checkpoint:'same inputs'}],observations:{channels:['motion','timers','events','memory','rendering'],watches:[],captures:['control-after','intervention-after']}};}

test('one experiment restores identical instances, owns branch names, and separates edits from behavior',async()=>{
  const tools=createCartridgeTools();
  try{
    await tools.open();const prepared=(await tools.run('prepare_checkpoint',preparation)).result;
    const initial=tools.sessionState.branches[0].verification;
    const args=experiment(prepared),output=await tools.run('run_experiment',args),result=output.result;
    assert.equal(result.status,'completed');assert.equal(result.identicalStartingConditions,true);assert.equal(result.firstBehavioralDivergence.elapsedFrame,1);
    assert.equal(result.initialEditDifference.frame,11);assert.equal(result.initialEditDifference.edits[0].previousValue,0);assert.equal(result.initialEditDifference.edits[0].newValue,40);
    assert.equal(result.final.control.dx,60);assert.equal(result.final.intervention.dx,16);
    assert.notEqual(result.branches.control,result.branches.intervention);assert.notEqual(result.branches.control,'main');
    assert.deepEqual(tools.sessionState.branches[0].verification,initial);assert.equal(output.images.length,2);
    const before=structuredClone(tools.sessionState.experimentWorkbench.usage);
    assert.deepEqual(await tools.run('run_experiment',args),output);assert.deepEqual(tools.sessionState.experimentWorkbench.usage,before);
    await assert.rejects(tools.run('run_experiment',{...args,hypothesis:'Changed input with reused identity.'}),/reused with different input/);
    const artifact=tools.sessionState.experimentWorkbench.artifacts[0];assert.equal(artifact.id,result.artifactRef.id);assert.equal(artifact.payload.trace.length,8);
    const addresses=artifact.payload.trace.map(sample=>sample.control.motion.fieldHints.cooldown.address);assert.ok(new Set(addresses).size>1,'Observed addresses really relocate');
    assert.equal(artifact.payload.trace[0].control.normalized.events[0],'dash-start');
  }finally{await tools.close();}
});

test('targets are checkpoint-bound and completion is idempotent after worker reconstruction',async()=>{
  let tools=createCartridgeTools();let saved,args,result;
  try{
    await tools.open();const prepared=(await tools.run('prepare_checkpoint',preparation)).result;args=experiment(prepared);result=await tools.run('run_experiment',args);
    const different=(await tools.run('checkpoint_state',{branchId:'main',label:'same state, different checkpoint'})).result;
    await assert.rejects(tools.run('run_experiment',{...args,requestId:'stale-target-request',checkpointId:different.checkpointId}),/stale or belongs/);
    saved=JSON.parse(JSON.stringify(tools.sessionState));
  }finally{await tools.close();}
  tools=createCartridgeTools();
  try{await tools.open(saved);const restored=await tools.run('run_experiment',args);assert.deepEqual(restored.result,result.result);assert.deepEqual(restored.images,result.images);assert.equal(tools.sessionState.experimentWorkbench.usage.experiments,1);}
  finally{await tools.close();}
});

test('the recorded occupied-main failure can use its checkpoint without any agent-created branch',async()=>{
  const {readFile}=await import('node:fs/promises'),record=JSON.parse(await readFile(new URL('../assets/lab/recordings/branch-experiment.json',import.meta.url),'utf8'));
  const tools=createCartridgeTools();
  try{
    await tools.open(record.report.session);const cp=record.report.session.checkpoints[0];
    const prepared=(await tools.run('read_checkpoint',{checkpointId:cp.id,watches:[]})).result;
    const args=experiment(prepared,'occupied-main-regression');args.observations.captures=[];
    const result=(await tools.run('run_experiment',args)).result;
    assert.equal(result.status,'completed');assert.equal(result.frameCount,8);assert.deepEqual(tools.sessionState.branches.map(branch=>branch.id),['main','ctrl']);
  }finally{await tools.close();}
});
