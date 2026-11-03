import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCartridgeTools} from '../src/agent/tools.mjs';
import {saveInvestigationEvidence} from '../src/lab/investigation-evidence.mjs';

const prepare={requestId:'durable-preparation',hypothesis:'Persist each completed host action.',steps:[{buttons:1,frames:1,checkpoint:'gameplay'},{buttons:0,frames:10,checkpoint:'ready'}],watches:[]};
test('an acknowledged completed experiment survives interruption before the command response',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'experiment-durable-')),controller=new AbortController();let saved,interrupt=false;
  let tools=createCartridgeTools({signal:controller.signal,onCheckpoint:async state=>{
    await saveInvestigationEvidence(directory,state);
    if(interrupt&&state.experimentWorkbench?.requests.some(request=>request.kind==='experiment'&&request.status==='completed')){saved=JSON.parse(JSON.stringify(state));controller.abort();}
  }});
  let args;
  try{
    await tools.open();const prepared=(await tools.run('prepare_checkpoint',prepare)).result;
    args={requestId:'durable-experiment',hypothesis:'Record a completed paired experiment before cancellation.',checkpointId:prepared.checkpointId,interventions:[{targetId:prepared.targets.find(target=>target.name==='cooldown').id,value:40,hypothesis:'A human-scripted persistence fixture.'}],steps:[{buttons:33,frames:8,checkpoint:'after'}],observations:{channels:['motion','timers'],watches:[],captures:[]}};
    interrupt=true;await assert.rejects(tools.run('run_experiment',args),/cancelled/);await tools.close();
    assert.equal(saved.experimentWorkbench.artifacts.length,1);
    const artifact=saved.experimentWorkbench.artifacts[0];assert.equal(JSON.parse(await readFile(join(directory,'sessions',saved.id,'experiments',artifact.id+'.json'),'utf8')).trace.length,8);
    tools=createCartridgeTools();await tools.open(saved);
    const completed=(await tools.run('run_experiment',args)).result;assert.equal(completed.status,'completed');assert.equal(completed.artifactRef.id,artifact.id);assert.equal(tools.sessionState.experimentWorkbench.usage.experiments,1);
  }finally{await tools.close();await rm(directory,{recursive:true,force:true});}
});

test('a failed durability acknowledgement stops execution before advancing the cartridge',async()=>{
  const tools=createCartridgeTools({onCheckpoint:async()=>{throw Error('Injected storage failure');}});
  try{
    await tools.open();await assert.rejects(tools.run('prepare_checkpoint',prepare),/durably persist/);
    assert.equal(tools.sessionState.branches[0].verification.frame,0);
  }finally{await tools.close();}
});
