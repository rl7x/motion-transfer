import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCartridgeTools} from '../src/agent/tools.mjs';
import {loadTarget} from '../src/agent/target.mjs';
import {saveInvestigationEvidence} from '../src/lab/investigation-evidence.mjs';

// Human-scripted measurements. No model client or API credentials are used.
const steps=[{buttons:1,frames:1,checkpoint:'gameplay'},{buttons:0,frames:10,checkpoint:'ready'}];
const trialSteps=[{buttons:33,frames:8,checkpoint:'same-eight-inputs'}];
const hypothesis='Human-scripted comparison of a timer intervention under identical inputs.';
async function scenario(workflow,value){
  const tools=createCartridgeTools(),calls=[];
  const run=async(name,args)=>{const output=await tools.run(name,args);calls.push({name,result:output.result});return output.result;};
  try{
    await tools.open();let final;
    if(workflow==='low-level'){
      const baseline=await run('session_advance',{branchId:'main',hypothesis,steps,watches:[]});
      const checkpoint=await run('checkpoint_state',{branchId:'main',label:hypothesis});
      for(const branchId of ['control','variant'])await run('fork_checkpoint',{checkpointId:checkpoint.checkpointId,branchId,watches:[]});
      await run('write_memory',{branchId:'variant',edits:[{address:baseline.checkpoints.at(-1).motion.fieldHints.cooldown.address,type:'i16',value,hypothesis}],watches:[]});
      const compared=await run('compare_branches',{controlBranchId:'control',experimentalBranchId:'variant',hypothesis,steps:trialSteps,watches:[]});
      const last=compared.normalizedTrace.at(-1);final={control:last.control,intervention:last.experimental};
    }else if(workflow==='complete-tool'){
      const prepared=await run('prepare_checkpoint',{requestId:'benchmark-preparation',hypothesis,steps,watches:[]});
      const compared=await run('run_experiment',{requestId:'benchmark-trial',hypothesis,checkpointId:prepared.checkpointId,interventions:[{targetId:prepared.targets.find(item=>item.name==='cooldown').id,value,hypothesis}],steps:trialSteps,observations:{channels:['motion','timers','events','memory','rendering'],watches:[],captures:[]}});final=compared.final;
    }else{
      const source=`const prepared=await sdk.prepareCheckpoint(${JSON.stringify({hypothesis,steps,watches:[]})});
const target=prepared.targets.find(item=>item.name==='cooldown');
const result=await sdk.runExperiment({hypothesis:${JSON.stringify(hypothesis)},checkpointId:prepared.checkpointId,interventions:[{targetId:target.id,value:${value},hypothesis:${JSON.stringify(hypothesis)}}],steps:${JSON.stringify(trialSteps)},observations:{channels:['motion','timers','events','memory','rendering'],watches:[],captures:[]}});
return result.final;`;
      const compared=await run('run_experiment_program',{requestId:'benchmark-program',hypothesis,language:'javascript',source});assert.equal(compared.status,'completed');final=compared.output;
    }
    const session=tools.sessionState;
    return{workflow,value,completed:true,modelFacingToolInvocations:calls.length,sdkCapabilityInvocations:session.experimentWorkbench?.programs[0]?.operations.length??0,modelGenerationRequestsMeasured:null,modelFacingResultBytes:Buffer.byteLength(JSON.stringify(calls.map(call=>call.result))),persistedSessionBytes:Buffer.byteLength(JSON.stringify(session)),immutableArtifactBytes:session.experimentWorkbench?.usage.evidenceBytes??0,final};
  }finally{await tools.close();}
}

const source=`
await sdk.static.inspectWasm({view:'overview',startLine:1,lineCount:5});
const listed=await sdk.static.listFunctions({startIndex:0,limit:20});
const fn=listed.functions.find(fn=>fn.exports.includes('update'));
await sdk.static.inspectFunction({functionIndex:fn.index,startLine:1,lineCount:8});
const prepared=await sdk.prepareCheckpoint({hypothesis:'Human-scripted local setup: enter gameplay and wait ten updates.',steps:[{buttons:1,frames:1,checkpoint:'gameplay'},{buttons:0,frames:10,checkpoint:'ready'}],watches:[]});
const target=prepared.targets.find(item=>item.name==='cooldown');
const request=value=>({hypothesis:'Human-scripted parameter sweep of a supplied timer hint.',checkpointId:prepared.checkpointId,interventions:[{targetId:target.id,value,hypothesis:'Test this timer value; measure the result.'}],steps:[{buttons:33,frames:8,checkpoint:'same-eight-inputs'}],observations:{channels:['motion','timers','events','memory','rendering'],watches:[],captures:[]}});
const trials=await sdk.sweep([0,40],request);
const delayed=trials.find(trial=>trial.final.intervention.dx<trial.final.control.dx);
let followup=null;
if(delayed){
  followup=await sdk.runExperiment(request(5));
  await sdk.capture({artifactId:followup.artifactRef.id,branch:'intervention',reason:'Actual endpoint of the conditional follow-up, not an illustration.'});
  await sdk.emitFinding({claim:'In these eight identical held-right inputs, the selected trial moved '+delayed.final.intervention.dx+' pixels versus '+delayed.final.control.dx+' in its control. The follow-up value moved '+followup.final.intervention.dx+'. This is finite human-scripted verification using supplied field hints.',status:'supported',confidence:'medium',evidenceIds:[delayed.experimentId,followup.experimentId]});
}
return {trials:trials.map(trial=>({id:trial.experimentId,control:trial.final.control.dx,intervention:trial.final.intervention.dx})),followup:followup?{id:followup.experimentId,control:followup.final.control.dx,intervention:followup.final.intervention.dx}:null};`;

const tools=createCartridgeTools(),startedAt=new Date().toISOString();
try{
  const scenarios=[];
  for(const value of [40,5]){
    const matched=[];for(const workflow of ['low-level','complete-tool','program'])matched.push(await scenario(workflow,value));
    for(const item of matched)assert.deepEqual(item.final,matched[0].final,'Workflow endpoints must match for the same scenario');scenarios.push(...matched);
  }
  const benchmark={schemaVersion:1,origin:'local-verification',generatedAt:new Date().toISOString(),method:'Same clean donor, X for one update, ten idle updates, checkpoint timer intervention, eight held-right-dash inputs. No images during the paired benchmark. Tool invocations are measured; model round trips, cost savings and reliability improvements are not measured. Persisted evidence sizes cover different evidence detail and are not equivalence claims.',modelCalled:false,scenarios};
  await tools.open();const args={requestId:'local-programmatic-control',hypothesis:'Human-scripted local sweep and conditional follow-up; not a model discovery.',language:'javascript',source};
  const result=(await tools.run('run_experiment_program',args)).result;assert.equal(result.status,'completed');assert.equal(result.experiments.length,3);assert.ok(result.output.followup);
  const session=tools.sessionState,target=await loadTarget();
  const report={schemaVersion:1,status:'completed',model:'none',origin:'local-verification',startedAt,finishedAt:new Date().toISOString(),target:{id:target.id,sha256:target.sha256},requests:[],turns:[],toolCalls:[{name:'run_experiment_program',args,result,ok:true,author:'human-script'}],session,estimatedCostUsd:0,reservedCostUsd:0,conclusionVerified:false,humanAssistance:['The program, inputs, field selection, values and interpretation are human-scripted. No model was called.','World position and timer hints come from the existing human-mapped registry.'],conclusion:'Human-scripted verification: one local program inspected compiled code, ran two parameter values, then used actual displacement to choose another experiment and capture. '+JSON.stringify(result.output)+'. These finite donor experiments are not independent component recovery or recipient acceptance.'};
  const job={id:randomUUID(),kind:'investigation',origin:'local-verification',status:'ready',events:[],error:null,report};
  await mkdir(resolve('reports'),{recursive:true});await writeFile(resolve('reports/programmatic-experiment-benchmark.json'),JSON.stringify(benchmark,null,2)+'\n');await writeFile(resolve('reports/programmatic-control.json'),JSON.stringify(job,null,2)+'\n');await saveInvestigationEvidence(resolve('reports/programmatic-local'),session,report);
  console.log(JSON.stringify({passed:true,modelCalled:false,benchmark:scenarios.map(({workflow,value,modelFacingToolInvocations,modelFacingResultBytes,immutableArtifactBytes})=>({workflow,value,modelFacingToolInvocations,modelFacingResultBytes,immutableArtifactBytes})),programExperiments:result.experiments.length,captures:session.experimentWorkbench.usage.captures}));
}catch(error){console.error(error.stack);process.exitCode=1;}
finally{await tools.close();}
