import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCartridgeTools} from '../src/agent/tools.mjs';
import {loadTarget} from '../src/agent/target.mjs';
import {saveInvestigationEvidence} from '../src/lab/investigation-evidence.mjs';

// Human-scripted local verification, never a model discovery or an API run.
const tools=createCartridgeTools(),calls=[],startedAt=new Date().toISOString();
async function run(name,args){const {result}=await tools.run(name,args);calls.push({name,args,result,ok:true,author:'human-script'});return result;}
try{
  await tools.open();
  const baseline=await run('session_advance',{branchId:'main',hypothesis:'Human-scripted setup reaches a ready donor state.',watches:[],steps:[{buttons:1,frames:1,checkpoint:'gameplay'},{buttons:0,frames:10,checkpoint:'ready'}]});
  const address=baseline.checkpoints.at(-1).motion.fieldHints.cooldown.address;
  const checkpoint=await run('checkpoint_state',{branchId:'main',label:'local control before intervention'});
  for(const branchId of ['control','variant'])await run('fork_checkpoint',{checkpointId:checkpoint.checkpointId,branchId,watches:[]});
  await run('write_memory',{branchId:'variant',edits:[{address,type:'i16',value:40,hypothesis:'Human-selected intervention: increasing this human-mapped timer may delay activation.'}],watches:[]});
  const compared=await run('compare_branches',{controlBranchId:'control',experimentalBranchId:'variant',hypothesis:'Human-scripted comparison: apply identical right-dash inputs to both branches.',watches:[],steps:[{buttons:33,frames:8,checkpoint:'same-eight-inputs'}]});
  const point=compared.checkpoints[0];
  await run('diff_memory',{fromObservationId:point.control.observationId,toObservationId:point.experimental.observationId,range:{address,byteLength:4,type:'i16'}});
  const originalAddressTrace=await run('trace_writers',{checkpointId:checkpoint.checkpointId,address,byteLength:4,steps:[{buttons:33,frames:8,checkpoint:'checkpoint address stores'}]});
  // The donor relocates component allocations. Follow the actual endpoint hint
  // from the control instead of interpreting a static offset as an address.
  const writerAddress=point.control.motion.fieldHints.cooldown.address;
  const writers=await run('trace_writers',{checkpointId:checkpoint.checkpointId,address:writerAddress,byteLength:4,steps:[{buttons:33,frames:8,checkpoint:'observed endpoint address stores'}]});
  if(!writers.behavioralComparison.passed||!writers.hits.length||!compared.firstBehaviorDivergence)throw Error('Local control evidence did not pass: '+JSON.stringify({writerComparison:writers.behavioralComparison,matchingWrites:writers.matchingWrites,firstBehaviorDivergence:compared.firstBehaviorDivergence}));
  const functionIndex=writers.hits[0].functionIndex;
  await run('inspect_function',{functionIndex,startLine:1,lineCount:30});
  await run('decompile_function',{functionIndex,startLine:1,lineCount:30});
  for(const branchId of ['control','variant'])await run('capture_frame',{branchId,reason:'Actual framebuffer after the human-scripted controlled experiment.'});
  const target=await loadTarget(),session=tools.sessionState;
  const report={schemaVersion:1,status:'completed',model:'none',origin:'local-verification',startedAt,finishedAt:new Date().toISOString(),target:{id:target.id,sha256:target.sha256},requests:[],turns:[],toolCalls:calls,session,estimatedCostUsd:0,reservedCostUsd:0,conclusionVerified:false,
    humanAssistance:['All inputs, field selection, intervention and interpretation are human-scripted. No model was called.','The field addresses use the existing human-mapped motion registry.'],
    conclusion:`Human-scripted local verification, ${compared.comparisonId}: after eight identical inputs the control moved ${compared.normalizedTrace.at(-1).control.dx} source pixels and the timer-edited variant moved ${compared.normalizedTrace.at(-1).experimental.dx}. The first motion/timer/event difference occurred at update ${compared.firstBehaviorDivergence.elapsedFrame}. The human-mapped timer address relocated from ${address} to ${writerAddress}; the first range had ${originalAddressTrace.matchingWrites} matching stores while the endpoint range had ${writers.matchingWrites}. Both writer-copy comparisons matched the original. This finite intervention does not establish all timer rules, stable addresses or independent recovery.`};
  const job={id:randomUUID(),kind:'investigation',origin:'local-verification',status:'ready',events:[],error:null,report};
  await mkdir(resolve('reports'),{recursive:true});await writeFile(resolve('reports/investigation-toolset-smoke.json'),JSON.stringify(job,null,2)+'\n');
  await saveInvestigationEvidence(resolve('reports/investigation-local'),session,report);
  console.log(JSON.stringify({passed:true,sessionId:session.id,firstDifference:compared.firstBehaviorDivergence.elapsedFrame,controlDisplacement:compared.normalizedTrace.at(-1).control.dx,variantDisplacement:compared.normalizedTrace.at(-1).experimental.dx,writerComparison: writers.behavioralComparison.passed,originalAddressWrites:originalAddressTrace.matchingWrites,endpointAddressWrites:writers.matchingWrites,captures:session.captures.length,modelCalled:false}));
}catch(error){console.error(error.message);process.exitCode=1;}
finally{await tools.close();}
