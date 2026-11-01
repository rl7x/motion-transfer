import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {digest} from '../component/build.mjs';
import {readMemoryWatches,writeMemoryValue,validateMemoryEdit,memoryTypeSize} from '../runtime/memory.mjs';
import {framebufferPng} from '../runtime/png.mjs';
import {fingerprint,measure,normalized,behavior,equal} from './compare.mjs';
import {validateExperimentInput} from './schema.mjs';

export const EXPERIMENT_LIMITS=Object.freeze({maxExperiments:4,maxOperations:24,maxFrames:7200,maxCaptures:4,maxEvidenceBytes:1024*1024});
export async function createExperimentWorkbench(session,{saved,persist=async()=>{},limits=EXPERIMENT_LIMITS}={}){
  for(const [key,ceiling]of Object.entries(EXPERIMENT_LIMITS))if(!Number.isSafeInteger(limits[key])||limits[key]<1||limits[key]>ceiling)throw Error('Invalid experiment limit: '+key);
  const engineSha256=digest((await Promise.all(['workbench.mjs','compare.mjs','schema.mjs'].map(name=>readFile(new URL(name,import.meta.url),'utf8')))).join('\n'));
  let state=saved?structuredClone(saved):{schemaVersion:1,sessionId:session.id,identity:session.identity,engineSha256,requests:[],targets:[],artifacts:[],usage:{operations:0,experiments:0,frames:0,captures:0,evidenceBytes:0}};
  if(saved){
    assert.equal(state.schemaVersion,1);assert.equal(state.sessionId,session.id);assert.deepEqual(state.identity,session.identity,'Experiment runtime identity mismatch');assert.equal(state.engineSha256,engineSha256,'Experiment engine changed; old evidence remains readable but execution cannot resume');
    for(const artifact of state.artifacts)if(digest(JSON.stringify(artifact.payload))!==artifact.id)throw Error('Experiment evidence integrity mismatch');
    for(const request of state.requests)if(request.status==='running'){request.status='interrupted';request.error='Execution was interrupted; completed artifacts are retained. No interpreter stack or partial experiment is resumed.';}
  }
  function checkpoint(id){const value=session.snapshot().checkpoints.find(item=>item.id===id);if(!value)throw Error('Unknown checkpoint');assert.deepEqual(value.identity,session.identity);return value;}
  function charge(frames=0){if(state.usage.operations>=limits.maxOperations||state.usage.frames+frames>limits.maxFrames)throw Error('Experiment operation or frame budget exhausted');state.usage.operations++;state.usage.frames+=frames;}
  function remember(payload){
    const json=JSON.stringify(payload),id=digest(json),bytes=Buffer.byteLength(json);
    if(state.artifacts.some(item=>item.id===id))return state.artifacts.find(item=>item.id===id);
    if(state.usage.evidenceBytes+bytes>limits.maxEvidenceBytes)throw Error('Experiment evidence byte budget exhausted');
    const artifact={id,bytes,payload};state.artifacts.push(artifact);state.usage.evidenceBytes+=bytes;return artifact;
  }
  function target(runtime,cp,address,type,name,origin){
    const previous=readMemoryWatches(runtime.memory.buffer,[{name:'checkpoint target',address,type,count:1}])[0];
    const binding={sessionId:session.id,checkpointId:cp.id,memoryHash:cp.verification.memoryHash,frame:cp.verification.frame,address,type,previousBytesHex:previous.bytesHex};
    const id='target-'+digest(JSON.stringify(binding)).slice(0,32);
    if(!state.targets.some(item=>item.id===id)){if(state.targets.length>=128)throw Error('Checkpoint target budget exhausted');state.targets.push({id,...binding,name,origin,previousValue:previous.values[0]});}
    return state.targets.find(item=>item.id===id);
  }
  async function readCheckpoint(args){
    const cp=checkpoint(args.checkpointId),frames=cp.actions.reduce((sum,action)=>sum+(action.frames??0),0);charge(frames);
    const runtime=await session.reconstructCheckpoint(cp.id),observation=measure(runtime,args.watches),targets=[];
    for(const [name,hint]of Object.entries(observation.motion?.fieldHints??{}))if(name!=='source')targets.push(target(runtime,cp,hint.address,hint.type,name,'human-mapped-assistance'));
    for(const watch of args.watches)for(let index=0;index<watch.count;index++)targets.push(target(runtime,cp,watch.address+index*memoryTypeSize(watch.type),watch.type,watch.name+(watch.count>1?'['+index+']':''),'agent-requested-raw-watch'));
    return{checkpointId:cp.id,sessionId:session.id,verification:cp.verification,observation,targets,notice:'Target handles bind to this checkpoint only. Human-mapped hints are assistance; raw watch names are hypotheses. An address may hold a different allocation later.'};
  }
  async function idempotent(kind,args,operation){
    const argsSha256=digest(JSON.stringify(args)),prior=state.requests.find(item=>item.requestId===args.requestId);
    if(prior){if(prior.kind!==kind||prior.argsSha256!==argsSha256)throw Error('Experiment request identity reused with different input');if(prior.status==='completed')return structuredClone(prior.output);throw Error(prior.error??'Experiment request did not complete; no automatic retry');}
    if(state.requests.length>=32)throw Error('Experiment request journal budget exhausted');
    const request={requestId:args.requestId,kind,argsSha256,status:'running'};state.requests.push(request);await persist();
    try{const output=await operation();request.output=output;request.status='completed';await persist();return structuredClone(output);}
    catch(error){request.status='failed';request.error=String(error.message).slice(0,1000);await persist();throw error;}
  }
  function capture(runtime,branchId,stage,experimentId){
    const existing=session.snapshot().captures.length;
    if(existing+state.usage.captures>=limits.maxCaptures)throw Error('Investigation image budget exhausted');
    const measured=fingerprint(runtime),png=framebufferPng(runtime.framebuffer.bytes,runtime.observe().palette);state.usage.captures++;
    return{evidenceId:'image-'+digest(JSON.stringify({sessionId:session.id,experimentId,branchId,stage,frame:runtime.frame,pngSha256:digest(png)})).slice(0,24),sessionId:session.id,experimentId,branchId,stage,frame:runtime.frame,pngSha256:digest(png),framebufferHash:measured.framebufferHash,renderingHash:measured.renderingHash,width:160,height:160,dataUrl:'data:image/png;base64,'+png.toString('base64')};
  }
  async function runExperiment(args){return idempotent('experiment',args,async()=>{
    const cp=checkpoint(args.checkpointId),frames=args.steps.reduce((sum,step)=>sum+step.frames,0),replayed=cp.actions.reduce((sum,action)=>sum+(action.frames??0),0)*2;
    if(state.usage.experiments>=limits.maxExperiments)throw Error('Experiment count budget exhausted');
    if(session.snapshot().captures.length+state.usage.captures+args.observations.captures.length>limits.maxCaptures)throw Error('Investigation image budget exhausted');
    const edits=args.interventions.map(edit=>{const found=state.targets.find(target=>target.id===edit.targetId);if(!found||found.checkpointId!==cp.id||found.memoryHash!==cp.verification.memoryHash)throw Error('Intervention target is stale or belongs to a different checkpoint');validateMemoryEdit({...found,value:edit.value});return{...found,value:edit.value,hypothesis:edit.hypothesis};});
    const ranges=[];for(const edit of edits){const end=edit.address+memoryTypeSize(edit.type);if(ranges.some(([a,b])=>edit.address<b&&end>a))throw Error('Overlapping interventions are not supported');ranges.push([edit.address,end]);}
    charge(replayed+frames*2);state.usage.experiments++;
    const control=await session.reconstructCheckpoint(cp.id),intervention=await session.reconstructCheckpoint(cp.id);
    const controlHandle='branch-'+randomUUID(),interventionHandle='branch-'+randomUUID(),experimentId='experiment-'+randomUUID();
    const starting=fingerprint(control);assert.deepEqual(fingerprint(intervention),starting,'Experiment branches did not start identically');
    assert.equal(starting.memoryHash,cp.verification.memoryHash);
    const payload={schemaVersion:1,experimentId,sessionId:session.id,requestId:args.requestId,hypothesis:args.hypothesis,checkpoint:{id:cp.id,identity:cp.identity,actions:cp.actions,verification:cp.verification},branches:{control:controlHandle,intervention:interventionHandle},inputs:args.steps,observations:args.observations,identicalStartingConditions:true,starting,edits:[],trace:[],captures:[],normalization:'Human-mapped motion/timers and human-authored start/end convention; finite measurements, not inferred field layout or expected conclusions.'};
    const take=(runtime,handle,stage)=>{if(args.observations.captures.includes(stage))payload.captures.push(capture(runtime,handle,stage,experimentId));};
    take(control,controlHandle,'control-before');
    for(const edit of edits){const actual=readMemoryWatches(intervention.memory.buffer,[{name:'bound target',address:edit.address,type:edit.type,count:1}])[0];if(actual.bytesHex!==edit.previousBytesHex)throw Error('Intervention previous bytes do not match checkpoint');payload.edits.push({...edit,frame:intervention.frame,...writeMemoryValue(intervention.memory.buffer,edit)});}
    payload.initialEditDifference={frame:control.frame,control:measure(control,args.observations.watches),intervention:measure(intervention,args.observations.watches),edits:payload.edits};
    take(intervention,interventionHandle,'intervention-before');
    let priorA=measure(control).motion,priorB=measure(intervention).motion;const initialA=priorA,initialB=priorB;
    payload.firstBehavioralDivergence=null;payload.firstTimerDifference=null;payload.firstRenderingDifference=null;payload.firstPostInputMemoryDifference=null;
    try{
      for(const step of args.steps)for(let tick=0;tick<step.frames;tick++){
        control.step(step.buttons,1);intervention.step(step.buttons,1);
        const a=measure(control,args.observations.watches),b=measure(intervention,args.observations.watches),na=normalized(a.motion,priorA,initialA),nb=normalized(b.motion,priorB,initialB);priorA=a.motion;priorB=b.motion;
        const sample={elapsedFrame:payload.trace.length+1,frame:a.frame,buttons:step.buttons,inputCheckpoint:step.checkpoint,control:{...a,normalized:na},intervention:{...b,normalized:nb}};
        payload.trace.push(sample);
        if(!payload.firstBehavioralDivergence&&(!equal(behavior(na),behavior(nb))||a.renderingHash!==b.renderingHash))payload.firstBehavioralDivergence=sample;
        if(!payload.firstTimerDifference&&!equal(na&&[na.cooldown,na.remaining],nb&&[nb.cooldown,nb.remaining]))payload.firstTimerDifference=sample.elapsedFrame;
        if(!payload.firstRenderingDifference&&a.renderingHash!==b.renderingHash)payload.firstRenderingDifference=sample.elapsedFrame;
        if(!payload.firstPostInputMemoryDifference&&a.memoryHash!==b.memoryHash)payload.firstPostInputMemoryDifference=sample.elapsedFrame;
        if(Buffer.byteLength(JSON.stringify(payload))+state.usage.evidenceBytes>limits.maxEvidenceBytes-32768)throw Error('Experiment evidence byte budget exhausted');
      }
      take(control,controlHandle,'control-after');take(intervention,interventionHandle,'intervention-after');payload.status='completed';
    }catch(error){payload.status='failed';payload.error=String(error.message).slice(0,1000);}
    payload.final={control:measure(control,args.observations.watches),intervention:measure(intervention,args.observations.watches)};
    const artifact=remember(payload),last=payload.trace.at(-1);
    const summary={experimentId,requestId:args.requestId,status:payload.status,hypothesis:args.hypothesis,checkpointId:cp.id,branches:payload.branches,identicalStartingConditions:true,frameCount:payload.trace.length,initialEditDifference:{frame:starting.frame,edits:payload.edits,controlMemoryHash:payload.initialEditDifference.control.memoryHash,interventionMemoryHash:payload.initialEditDifference.intervention.memoryHash},firstBehavioralDivergence:payload.firstBehavioralDivergence?{elapsedFrame:payload.firstBehavioralDivergence.elapsedFrame,control:payload.firstBehavioralDivergence.control.normalized,intervention:payload.firstBehavioralDivergence.intervention.normalized}:null,firstTimerDifference:payload.firstTimerDifference,firstRenderingDifference:payload.firstRenderingDifference,final:last?{control:last.control.normalized,intervention:last.intervention.normalized}:null,artifactRef:{id:artifact.id,sessionId:session.id,bytes:artifact.bytes},captures:payload.captures.map(({dataUrl,...metadata})=>metadata),...(payload.error?{error:payload.error}:{})};
    session.recordStatic({id:experimentId,kind:'experiment',artifactId:artifact.id,summary});
    return{result:summary,images:payload.captures};
  });}
  return{
    snapshot:()=>structuredClone(state),
    async execute(name,args){
      validateExperimentInput(name,args);
      if(name==='run_experiment')return runExperiment(args);
      if(name==='read_checkpoint'){const result=await readCheckpoint(args);await persist();return{result};}
      if(name==='prepare_checkpoint')return idempotent('prepare',args,async()=>{
        charge(args.steps.reduce((sum,step)=>sum+step.frames,0));
        await session.execute('session_advance',{branchId:'main',hypothesis:args.hypothesis,steps:args.steps,watches:args.watches});
        const cp=(await session.execute('checkpoint_state',{branchId:'main',label:args.hypothesis.slice(0,80)})).result;
        return{result:await readCheckpoint({checkpointId:cp.checkpointId,watches:args.watches})};
      });
      throw Error('Unknown experiment operation');
    },
  };
}
