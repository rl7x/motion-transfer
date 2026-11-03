import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {digest} from '../component/build.mjs';
import {readMemoryWatches,writeMemoryValue,validateMemoryEdit,memoryTypeSize} from '../runtime/memory.mjs';
import {framebufferPng} from '../runtime/png.mjs';
import {fingerprint,measure,normalized,behavior,equal} from './compare.mjs';
import {validateExperimentInput} from './schema.mjs';
import {executeExperimentProgram} from './interpreter.mjs';

export const EXPERIMENT_LIMITS=Object.freeze({maxExperiments:4,maxOperations:24,maxFrames:7200,maxCaptures:4,maxEvidenceBytes:1024*1024});
export async function createExperimentWorkbench(session,{saved,persist=async()=>{},dispatch,limits=EXPERIMENT_LIMITS}={}){
  for(const [key,ceiling]of Object.entries(EXPERIMENT_LIMITS))if(!Number.isSafeInteger(limits[key])||limits[key]<1||limits[key]>ceiling)throw Error('Invalid experiment limit: '+key);
  const engineSha256=digest((await Promise.all(['workbench.mjs','compare.mjs','schema.mjs','interpreter.mjs'].map(name=>readFile(new URL(name,import.meta.url),'utf8')))).join('\n'));
  let state=saved?structuredClone(saved):{schemaVersion:1,sessionId:session.id,identity:session.identity,engineSha256,requests:[],targets:[],artifacts:[],programs:[],usage:{operations:0,experiments:0,frames:0,captures:0,evidenceBytes:0}};
  if(saved){
    assert.equal(state.schemaVersion,1);assert.equal(state.sessionId,session.id);assert.deepEqual(state.identity,session.identity,'Experiment runtime identity mismatch');assert.equal(state.engineSha256,engineSha256,'Experiment engine changed; old evidence remains readable but execution cannot resume');
    for(const artifact of state.artifacts)if(digest(JSON.stringify(artifact.payload))!==artifact.id)throw Error('Experiment evidence integrity mismatch');
    for(const program of state.programs??[])if(typeof program.source!=='string'||digest(program.source)!==program.sourceSha256)throw Error('Experiment program source identity mismatch');
    for(const request of state.requests)if(request.status==='running'){request.status='interrupted';request.error='Execution was interrupted; completed artifacts are retained. No interpreter stack or partial experiment is resumed.';}
    for(const program of state.programs??[])if(program.status==='running'){program.status='interrupted';program.error='Interpreter stack was not restored. Completed experiment artifacts remain available.';}
  }
  state.programs??=[];
  function checkpoint(id){const value=session.snapshot().checkpoints.find(item=>item.id===id);if(!value)throw Error('Unknown checkpoint');assert.deepEqual(value.identity,session.identity);return value;}
  function charge(frames=0){if(!Number.isSafeInteger(frames)||frames<0)throw Error('Invalid experiment frame charge');if(state.usage.operations>=limits.maxOperations||state.usage.frames+frames>limits.maxFrames)throw Error('Experiment operation or frame budget exhausted');state.usage.operations++;state.usage.frames+=frames;}
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
    const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
    const argsSha256=digest(JSON.stringify(canonical(args))),prior=state.requests.find(item=>item.requestId===args.requestId);
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
    if(session.snapshot().branches.length+2>6)throw Error('Active branch budget exhausted; existing branches are retained');
    if(state.usage.experiments>=limits.maxExperiments)throw Error('Experiment count budget exhausted');
    if(session.snapshot().captures.length+state.usage.captures+args.observations.captures.length>limits.maxCaptures)throw Error('Investigation image budget exhausted');
    const edits=args.interventions.map(edit=>{const found=state.targets.find(target=>target.id===edit.targetId);if(!found||found.checkpointId!==cp.id||found.memoryHash!==cp.verification.memoryHash)throw Error('Intervention target is stale or belongs to a different checkpoint');validateMemoryEdit({...found,value:edit.value});return{...found,value:edit.value,hypothesis:edit.hypothesis};});
    const ranges=[];for(const edit of edits){const end=edit.address+memoryTypeSize(edit.type);if(ranges.some(([a,b])=>edit.address<b&&end>a))throw Error('Overlapping interventions are not supported');ranges.push([edit.address,end]);}
    charge(replayed+frames*2);state.usage.experiments++;
    const control=await session.reconstructCheckpoint(cp.id),intervention=await session.reconstructCheckpoint(cp.id);
    const controlHandle='branch-'+randomUUID(),interventionHandle='branch-'+randomUUID(),experimentId='experiment-'+randomUUID();
    const starting=fingerprint(control);assert.deepEqual(fingerprint(intervention),starting,'Experiment branches did not start identically');
    assert.equal(starting.memoryHash,cp.verification.memoryHash);
    const payload={schemaVersion:1,kind:'experiment',experimentId,sessionId:session.id,requestId:args.requestId,hypothesis:args.hypothesis,checkpoint:{id:cp.id,identity:cp.identity,actions:cp.actions,verification:cp.verification},branches:{control:controlHandle,intervention:interventionHandle},inputs:args.steps,observations:args.observations,identicalStartingConditions:true,starting,edits:[],trace:[],captures:[],normalization:'Human-mapped motion/timers and human-authored start/end convention; finite measurements, not inferred field layout or expected conclusions.'};
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
  function artifactById(id){const value=state.artifacts.find(item=>item.id===id);if(!value||value.payload.kind!=='experiment')throw Error('Unknown experiment artifact');return value;}
  async function captureExperiment(args){return idempotent('capture',args,async()=>{
    const original=artifactById(args.artifactId).payload;if(original.status!=='completed')throw Error('Only complete endpoints can be captured');
    const frames=original.checkpoint.actions.reduce((sum,step)=>sum+(step.frames??0),0)+original.inputs.reduce((sum,step)=>sum+step.frames,0);charge(frames);
    const runtime=await session.reconstructCheckpoint(original.checkpoint.id);
    if(args.branch==='intervention')for(const edit of original.edits){const change=writeMemoryValue(runtime.memory.buffer,edit);assert.equal(change.previousBytesHex,edit.previousBytesHex,'Capture intervention replay mismatch');}
    for(const step of original.inputs)runtime.step(step.buttons,step.frames);
    assert.deepEqual(fingerprint(runtime),fingerprintFromMeasurement(original.final[args.branch]),'Captured endpoint replay mismatch');
    const image=capture(runtime,original.branches[args.branch],args.branch+'-after',original.experimentId);image.reason=args.reason;
    const artifact=remember({kind:'capture',sessionId:session.id,experimentId:original.experimentId,sourceArtifactId:args.artifactId,captures:[image]});
    session.recordStatic({id:image.evidenceId,kind:'experiment-capture',artifactId:artifact.id});
    return{result:{...image,dataUrl:undefined,artifactRef:{id:artifact.id,sessionId:session.id,bytes:artifact.bytes}},images:[image]};
  });}
  const fingerprintFromMeasurement=({frame,memoryHash,framebufferHash,renderingHash,storage,faulted})=>({frame,memoryHash,framebufferHash,renderingHash,storage,faulted});
  async function runProgram(args){return idempotent('program',args,async()=>{
    if(state.programs.length>=2)throw Error('Experiment program count budget exhausted');
    charge();const program={id:'program-'+randomUUID(),requestId:args.requestId,hypothesis:args.hypothesis,source:args.source,sourceSha256:digest(args.source),language:args.language,status:'running',operations:[],startedAt:new Date().toISOString()};state.programs.push(program);await persist();
    const images=[],beforeIds=new Set(state.artifacts.map(item=>item.id));
    try{
      const executed=await executeExperimentProgram({source:args.source,language:args.language,invoke:async(name,input)=>{
        const operation={index:program.operations.length+1,name,args:input,status:'running'};
        if(['prepare_checkpoint','run_experiment','capture_experiment'].includes(name)){
          if(!input||typeof input!=='object'||Array.isArray(input))throw Error('SDK arguments must be a JSON object');
          const label=input.requestId??String(operation.index);if(typeof label!=='string'||label.length>80)throw Error('SDK request label exceeds its limit');
          const requestId='sdk-'+digest(JSON.stringify({programId:program.id,name,label})).slice(0,40);operation.requestIdentity={label,requestId};input={...input,requestId};operation.args=input;
        }
        program.operations.push(operation);await persist();
        try{
          let output;
          if(['prepare_checkpoint','read_checkpoint','run_experiment','read_experiment','capture_experiment'].includes(name))output=await api.execute(name,input);
          else if(['inspect_wasm','list_functions','inspect_function','decompile_function','call_graph','trace_writers','record_finding'].includes(name)){
            if(!dispatch)throw Error('Static SDK dispatch is unavailable');
            const frames=name==='trace_writers'?2*(checkpoint(input.checkpointId).actions.reduce((sum,action)=>sum+(action.frames??0),0)+input.steps.reduce((sum,step)=>sum+step.frames,0)):0;
            charge(frames);output=await dispatch(name,input);
          }else throw Error('Forbidden experiment capability');
          operation.result=output.result;operation.status='completed';
          if(output.images)images.push(...output.images);
          await persist();
          if(name==='run_experiment'&&output.result.status!=='completed')throw Error('Experiment trapped or failed; completed partial evidence is retained');
          return output.result;
        }catch(error){operation.status='failed';operation.error=String(error.message).slice(0,1000);await persist();throw error;}
      }});
      program.output=executed.output;program.compiledSha256=executed.compiledSha256;program.interpreter=executed.interpreter;program.status='completed';
    }catch(error){program.status='failed';program.error=String(error.message).slice(0,1000);}
    program.finishedAt=new Date().toISOString();
    const record=remember({kind:'program',sessionId:session.id,...program});program.artifactId=record.id;
    const artifacts=state.artifacts.filter(item=>!beforeIds.has(item.id)).map(({id,bytes,payload})=>({id,bytes,kind:payload.kind,experimentId:payload.experimentId}));
    const summaries=state.requests.filter(request=>request.kind==='experiment'&&request.status==='completed'&&!beforeIds.has(request.output.result.artifactRef.id)).map(request=>request.output.result);
    const result={programId:program.id,status:program.status,hypothesis:program.hypothesis,sourceSha256:program.sourceSha256,output:program.output,operations:program.operations.length,experiments:summaries,artifactRefs:artifacts,completedExperimentArtifacts:artifacts.filter(item=>item.kind==='experiment').length,stackSnapshot:false,...(program.error?{error:program.error}:{})};
    session.recordStatic({id:program.id,kind:'experiment-program',artifactId:record.id,summary:result});
    return{result,images};
  });}
  const api={
    snapshot:()=>structuredClone(state),
    async execute(name,args){
      validateExperimentInput(name,args);
      if(name==='run_experiment_program')return runProgram(args);
      if(name==='run_experiment')return runExperiment(args);
      if(name==='capture_experiment')return captureExperiment(args);
      if(name==='read_experiment'){
        charge();const artifact=artifactById(args.artifactId),payload=artifact.payload;
        const frames=payload.trace.slice(args.startFrame-1,args.startFrame-1+args.frameCount);await persist();
        return{result:{experimentId:payload.experimentId,artifactRef:{id:artifact.id,sessionId:session.id,bytes:artifact.bytes},initialEditDifference:payload.initialEditDifference,frames,final:payload.final,totalFrames:payload.trace.length,notice:'This is a bounded page of actual observations. Full evidence remains in the artifact.'}};
      }
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
  return api;
}
