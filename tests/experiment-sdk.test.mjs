import assert from 'node:assert/strict';
import test from 'node:test';
import {createCartridgeTools} from '../src/agent/tools.mjs';
import {digest} from '../src/component/build.mjs';
import {evidenceHistory} from '../src/agent/evidence.mjs';

const source=`
const overview=await sdk.static.inspectWasm({view:'overview',startLine:1,lineCount:5});
const listed=await sdk.static.listFunctions({startIndex:0,limit:20});
const fn=listed.functions.find(fn=>fn.exports.includes('update'));
await sdk.static.inspectFunction({functionIndex:fn.index,startLine:1,lineCount:8});
const prepared=await sdk.prepareCheckpoint({requestId:'sdk-preparation',hypothesis:'Human-scripted SDK setup; no Meta inference.',steps:[{buttons:1,frames:1,checkpoint:'gameplay'},{buttons:0,frames:10,checkpoint:'ready'}],watches:[]});
const target=prepared.targets.find(target=>target.name==='cooldown');
const make=value=>({requestId:'sdk-value-'+value,hypothesis:'Human-scripted parameter trial, not an expected conclusion.',checkpointId:prepared.checkpointId,interventions:[{targetId:target.id,value,hypothesis:'Test the selected timer value.'}],steps:[{buttons:33,frames:8,checkpoint:'after'}],observations:{channels:['motion','timers','events'],watches:[],captures:[]}});
const trials=await sdk.sweep([0,40],make);
const next=trials[1].final.intervention.dx<trials[0].final.intervention.dx?5:10;
const followup=await sdk.runExperiment(make(next));
const page=await sdk.readExperiment({artifactId:followup.artifactRef.id,startFrame:5,frameCount:4});
const activation=page.frames.find(point=>point.intervention.normalized.events.includes('dash-start'));
await sdk.capture({requestId:'sdk-selected-image',artifactId:followup.artifactRef.id,branch:'intervention',reason:'Selected after observing the conditional follow-up.'});
await sdk.emitFinding({claim:'A finite local follow-up observed activation at update '+activation.elapsedFrame,status:'supported',confidence:'low',evidenceIds:[followup.experimentId]});
return {next,activation:activation.elapsedFrame,dx:followup.final.intervention.dx,evidenceId:followup.experimentId};
`;
test('one program executes real sweeps and conditionally chooses a follow-up from returned measurements',async()=>{
  const tools=createCartridgeTools();
  try{
    await tools.open();const args={requestId:'sdk-program-request',hypothesis:'Offline SDK orchestration fixture.',language:'typescript',source};
    const output=await tools.run('run_experiment_program',args),result=output.result;
    assert.equal(result.status,'completed',result.error);assert.equal(result.output.next,5);assert.equal(result.output.activation,6);assert.ok(result.output.dx>16&&result.output.dx<60);
    assert.equal(result.experiments.length,3);assert.equal(result.sourceSha256,digest(source));assert.equal(result.stackSnapshot,false);assert.equal(output.images.length,1);
    const state=tools.sessionState.experimentWorkbench;assert.equal(state.programs[0].source,source);assert.equal(state.programs[0].interpreter.name,'quickjs-emscripten');
    assert.ok(state.programs[0].operations.some(operation=>operation.name==='read_experiment'&&operation.status==='completed'));
    assert.equal(tools.sessionState.findings[0].evidenceIds[0],result.output.evidenceId);assert.equal(tools.sessionState.branches.length,1);
    const history=evidenceHistory({question:'Offline image replay.',session:tools.sessionState,toolCalls:[{name:'run_experiment_program',ok:true,result,images:output.images.map(({dataUrl,...metadata})=>metadata)}]});
    const image=history.flatMap(item=>item.content??[]).filter(item=>item.type==='input_image');assert.equal(image.length,1);assert.equal(image[0].image_url,output.images[0].dataUrl);
    assert.ok(JSON.stringify(history).includes(output.images[0].pngSha256));
    const usage=structuredClone(state.usage);assert.equal((await tools.run('run_experiment_program',args)).result.programId,result.programId);assert.deepEqual(tools.sessionState.experimentWorkbench.usage,usage);
  }finally{await tools.close();}
});

test('completed trial evidence survives interruption, while the interpreter stack is never resumed',async()=>{
  const controller=new AbortController();let saved;
  let tools=createCartridgeTools({signal:controller.signal,onCheckpoint:async state=>{
    if(state.experimentWorkbench?.programs[0]?.operations.some(operation=>operation.name==='run_experiment'&&operation.status==='completed')){saved=JSON.parse(JSON.stringify(state));controller.abort();}
  }});
  const args={requestId:'interrupted-sdk-program',hypothesis:'Retain completed evidence after interruption.',language:'javascript',source};
  try{
    await tools.open();await assert.rejects(tools.run('run_experiment_program',args),/cancelled/);await tools.close();
    assert.equal(saved.experimentWorkbench.artifacts.filter(artifact=>artifact.payload.kind==='experiment').length,1);
    tools=createCartridgeTools();await tools.open(saved);
    assert.equal(tools.sessionState.experimentWorkbench.programs[0].status,'interrupted');
    await assert.rejects(tools.run('run_experiment_program',args),/interrupted/);
    const artifact=saved.experimentWorkbench.artifacts.find(artifact=>artifact.payload.kind==='experiment');
    const result=(await tools.run('read_experiment',{artifactId:artifact.id,startFrame:1,frameCount:1})).result;
    assert.equal(result.frames.length,1);assert.equal(result.experimentId,artifact.payload.experimentId);
  }finally{await tools.close();}
});

test('invalid programs and exhausted operation budgets retain source, failures and completed operations',async()=>{
  const tools=createCartridgeTools();
  try{
    await tools.open();
    const invalid=(await tools.run('run_experiment_program',{requestId:'invalid-sdk-program',hypothesis:'Reject a forbidden capability.',language:'javascript',source:'return process.env.MODEL_API_KEY;'})).result;
    assert.equal(invalid.status,'failed');assert.match(invalid.error,/process/);
    const limited=(await tools.run('run_experiment_program',{requestId:'limited-sdk-program',hypothesis:'Enforce operation bounds.',language:'javascript',source:'for(let i=0;i<20;i++)await sdk.static.inspectWasm({view:"overview",startLine:1,lineCount:1});return 1;'})).result;
    assert.equal(limited.status,'failed');assert.match(limited.error,/budget/);assert.equal(limited.operations,16);
    assert.equal(tools.sessionState.experimentWorkbench.programs.length,2);
    await assert.rejects(tools.run('run_experiment_program',{requestId:'third-sdk-program',hypothesis:'No extra program budget.',language:'javascript',source:'return 1;'}),/program count budget/);
  }finally{await tools.close();}
});
