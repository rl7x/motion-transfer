import assert from 'node:assert/strict';
import test from 'node:test';
import wabtFactory from 'wabt';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCartridgeTools} from '../src/agent/tools.mjs';
import {createInvestigationSession} from '../src/runtime/investigation-session.mjs';
import {createExperimentWorkbench,EXPERIMENT_LIMITS} from '../src/experiment/workbench.mjs';
import {saveInvestigationEvidence} from '../src/lab/investigation-evidence.mjs';

const preparation={requestId:'boundary-preparation',hypothesis:'Offline preparation for resource and integrity verification.',steps:[{buttons:1,frames:1,checkpoint:'gameplay'},{buttons:0,frames:10,checkpoint:'ready'}],watches:[]};
const trial=prepared=>({requestId:'boundary-experiment',hypothesis:'An offline bounded intervention.',checkpointId:prepared.checkpointId,interventions:[{targetId:prepared.targets.find(item=>item.name==='cooldown').id,value:40,hypothesis:'Human-scripted timer edit.'}],steps:[{buttons:33,frames:8,checkpoint:'after'}],observations:{channels:['motion','timers','events','memory','rendering'],watches:[],captures:[]}});

test('legacy occupied branches and shared image quotas stop managed experiments without replacing evidence',async()=>{
  const tools=createCartridgeTools();
  try{
    await tools.open();const prepared=(await tools.run('prepare_checkpoint',preparation)).result;
    const captured=await tools.run('run_experiment',{...trial(prepared),observations:{channels:['motion'],watches:[],captures:['control-before','control-after','intervention-after']}});
    assert.equal(captured.images.length,3);await tools.run('capture_frame',{branchId:'main',reason:'Fourth image uses the existing low-level path.'});
    await assert.rejects(tools.run('capture_experiment',{requestId:'excess-image-request',artifactId:captured.result.artifactRef.id,branch:'control',reason:'No fifth image.'}),/image budget/);
    await assert.rejects(tools.run('capture_frame',{branchId:'main',reason:'Also no fifth low-level image.'}),/image budget/);
    for(const branchId of ['one','two','three','four'])await tools.run('fork_checkpoint',{checkpointId:prepared.checkpointId,branchId,watches:[]});
    const before=tools.sessionState.branches.map(branch=>branch.verification);
    await assert.rejects(tools.run('run_experiment',{...trial(prepared),requestId:'excess-branch-request'}),/branch budget/);
    assert.deepEqual(tools.sessionState.branches.map(branch=>branch.verification),before);assert.equal(tools.sessionState.experimentWorkbench.usage.experiments,1);
  }finally{await tools.close();}
});

test('corrupted full evidence and program source are rejected on restoration and persistence',async()=>{
  let saved;const tools=createCartridgeTools(),directory=await mkdtemp(join(tmpdir(),'experiment-integrity-'));
  try{
    await tools.open();const prepared=(await tools.run('prepare_checkpoint',preparation)).result;await tools.run('run_experiment',trial(prepared));
    await tools.run('run_experiment_program',{requestId:'source-integrity-program',hypothesis:'Preserve exact source identity.',language:'javascript',source:'return 7;'});saved=JSON.parse(JSON.stringify(tools.sessionState));
    const bad=structuredClone(saved);bad.experimentWorkbench.artifacts[0].payload.trace[0].buttons=0;
    await assert.rejects(saveInvestigationEvidence(directory,bad),/integrity mismatch/);
    for(const sourceChange of [false,true]){
      const altered=structuredClone(saved);if(sourceChange)altered.experimentWorkbench.programs[0].source='return 8;';else altered.experimentWorkbench.artifacts[0].payload.hypothesis='Altered evidence';
      const restored=createCartridgeTools();try{await assert.rejects(restored.open(altered),/identity mismatch|integrity mismatch/);}finally{await restored.close();}
    }
  }finally{await tools.close();await rm(directory,{recursive:true,force:true});}
});

test('actual WASM traps retain failed evidence and frame budgets stop execution before mutation',async()=>{
  const wabt=await wabtFactory(),module=wabt.parseWat('intervention-trap.wat',`(module
    (import "env" "memory" (memory 1 1))
    (func (export "update") i32.const 8192 i32.load if unreachable end))`);
  const bytes=module.toBinary({}).buffer;module.destroy();const session=await createInvestigationSession(bytes);
  const cp=(await session.execute('checkpoint_state',{branchId:'main',label:'Clean trap fixture'})).result;
  const workbench=await createExperimentWorkbench(session),prepared=(await workbench.execute('read_checkpoint',{checkpointId:cp.checkpointId,watches:[{name:'fixture flag',address:8192,type:'u32',count:1}]})).result;
  const args={requestId:'actual-trap-experiment',hypothesis:'Observe a deliberately trap-inducing fixture intervention.',checkpointId:cp.checkpointId,interventions:[{targetId:prepared.targets.find(item=>item.name==='fixture flag').id,value:1,hypothesis:'Set the fixture trap flag.'}],steps:[{buttons:0,frames:1,checkpoint:'trap'}],observations:{channels:['memory','rendering'],watches:[],captures:[]}};
  const result=(await workbench.execute('run_experiment',args)).result;assert.equal(result.status,'failed');assert.match(result.error,/update failed/);assert.equal(result.frameCount,0);
  assert.equal(workbench.snapshot().artifacts[0].payload.final.intervention.faulted,true);assert.equal(session.snapshot().branches[0].verification.faulted,false);
  assert.deepEqual((await workbench.execute('run_experiment',args)).result,result,'Failed execution evidence reconnects without rerunning');
  const limited=await createExperimentWorkbench(session,{limits:{...EXPERIMENT_LIMITS,maxFrames:1}});
  await limited.execute('read_checkpoint',{checkpointId:cp.checkpointId,watches:[]});
  await assert.rejects(limited.execute('run_experiment',{...args,interventions:[]}),/frame budget/);assert.equal(limited.snapshot().artifacts.length,0);
});

test('the program SDK can trace actual scalar writers without gaining recovery or arbitrary dispatch capabilities',async()=>{
  const tools=createCartridgeTools();
  try{
    await tools.open();
    const result=(await tools.run('run_experiment_program',{requestId:'sdk-writer-inspection',hypothesis:'Offline writer capability verification.',language:'javascript',source:`
const cp=await sdk.prepareCheckpoint(${JSON.stringify(preparation)});
const target=cp.targets.find(item=>item.name==='cooldown');
const trace=await sdk.static.traceWriters({checkpointId:cp.checkpointId,address:target.address,byteLength:4,steps:[{buttons:33,frames:2,checkpoint:'actual writes'}]});
return {passed:trace.behavioralComparison.passed,hits:trace.matchingWrites,recovery:typeof sdk.submitComponentCandidate,arbitrary:typeof sdk.dispatch};`})).result;
    assert.equal(result.status,'completed',result.error);assert.equal(result.output.passed,true);assert.ok(Number.isInteger(result.output.hits));assert.equal(result.output.recovery,'undefined');assert.equal(result.output.arbitrary,'undefined');
    const operation=tools.sessionState.experimentWorkbench.programs[0].operations.find(item=>item.name==='trace_writers');assert.equal(operation.status,'completed');
    assert.equal(tools.sessionState.experimentWorkbench.usage.frames,48,'Both analysis-copy and original replay/updates count against the SDK frame budget');
  }finally{await tools.close();}
});
