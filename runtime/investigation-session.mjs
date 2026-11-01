import { randomUUID } from 'node:crypto';
import { createReplayRuntime } from './replay.mjs';
import { observeDonorMotion } from './donor-observation.mjs';
import { summarizeObservation } from '../agent/observation.mjs';
import { readFile } from 'node:fs/promises';
import { digest } from '../component/build.mjs';
import assert from 'node:assert/strict';
import { writeMemoryValue,compareMemoryValues,validateMemoryEdit } from './memory.mjs';

export const MOTION_ASSISTANCE='Motion fields come from a HUMAN-MAPPED read-only registry, not agent-discovered variable names. Memory addresses are absolute runtime addresses; static instruction offsets are not addresses.';

export function observeRuntime(runtime,watches=[]){
  const observation=runtime.observe();
  try{const {position,direction,cooldown,remaining,sourceBodyWidth}=observeDonorMotion(runtime);observation.motion={position,direction,cooldown,remaining,sourceBodyWidth};}
  catch{observation.motion=null;}
  observation.memory=runtime.readMemory(watches);
  return observation;
}

// One session owns its live instances. Replaying a journal always instantiates
// a new module instance, restoring private globals and empty host storage too.
export async function createInvestigationSession(bytes,saved){
  const runtime=await createReplayRuntime(bytes),id=saved?.id??randomUUID();
  const branches=new Map([['main',{id:'main',runtime,actions:[],experimental:false}]]);
  const hostSources=await Promise.all(['replay.mjs','memory.mjs','investigation-session.mjs'].map(name=>readFile(new URL(name,import.meta.url),'utf8')));
  const identity={...runtime.provenance,hostSha256:digest(hostSources.join('\n'))};
  const checkpoints=new Map(),observations=new Map(),comparisons=[];
  const fingerprint=runtime=>{const {frame,memoryHash,framebufferHash,storage}=runtime.observe();return{frame,memoryHash,framebufferHash,storage,faulted:runtime.faulted};};
  function verify(runtime,expected){assert.deepEqual(fingerprint(runtime),expected,'Replay restoration hash mismatch');}
  const branch=id=>{const value=branches.get(id);if(!value)throw Error('Unknown investigation branch: '+id);return value;};
  async function replay(actions,expected){
    if(!Array.isArray(actions)||actions.length>128)throw Error('Invalid replay journal');
    const restored=await createReplayRuntime(bytes);let frames=0;
    for(const action of actions){
      try{
        if(action.kind==='reset')restored.reset();
        else if(action.kind==='advance'){
          if(!Number.isSafeInteger(action.frames)||action.frames<1||action.frames>600)throw Error('Invalid replay frame count');
          frames+=action.frames;if(frames>7200)throw Error('Replay frame limit reached');
          restored.step(action.buttons,action.frames);
        }else if(action.kind==='write'){
          assert.equal(restored.frame,action.frame,'Memory edit replay frame mismatch');
          const change=writeMemoryValue(restored.memory.buffer,action);
          for(const key of ['previousValue','previousBytesHex','newValue','newBytesHex'])assert.equal(change[key],action[key],'Memory edit replay value mismatch');
        }else throw Error('Unknown replay operation');
        if(action.error)throw Error('Expected replay failure did not occur');
      }catch(error){if(!action.error||error.message!==action.error)throw error;}
      verify(restored,action.after);
    }
    verify(restored,expected);return restored;
  }
  function describe(value,watches=[]){
    if(observations.size>=128)throw Error('Observation limit reached');
    const observationId=`obs-${String(observations.size+1).padStart(4,'0')}`;
    const result={observationId,sessionId:id,branchId:value.id,experimental:value.experimental,motionNotice:MOTION_ASSISTANCE,...summarizeObservation(observeRuntime(value.runtime,watches))};
    observations.set(observationId,{id:observationId,branchId:value.id,actionCount:value.actions.length,verification:fingerprint(value.runtime),result});
    return result;
  }
  function snapshot(){return structuredClone({schemaVersion:1,id,identity,branches:[...branches.values()].map(({runtime,...value})=>({...value,verification:fingerprint(runtime)})),checkpoints:[...checkpoints.values()],observations:[...observations.values()],comparisons});}
  if(saved){
    if(saved.schemaVersion!==1||typeof id!=='string'||!Array.isArray(saved.branches)||!saved.branches.length||saved.branches.length>6||saved.checkpoints?.length>16||saved.observations?.length>128)throw Error('Invalid investigation session journal');
    assert.deepEqual(saved.identity,identity,'Checkpoint cartridge/runtime identity mismatch');
    branches.clear();
    for(const record of saved.branches){
      if(!/^[a-z][a-z0-9-]{0,39}$/.test(record.id)||branches.has(record.id))throw Error('Invalid restored branch');
      const restored=await replay(record.actions,record.verification);
      branches.set(record.id,{...record,runtime:restored});
    }
    if(!branches.has('main')||branches.get('main').experimental)throw Error('Missing unchanged main branch');
    for(const record of saved.checkpoints??[]){
      assert.deepEqual(record.identity,identity,'Checkpoint cartridge/runtime identity mismatch');
      assert.equal(record.id,'cp-'+digest(JSON.stringify({...record,id:undefined})).slice(0,20),'Checkpoint identity mismatch');
      checkpoints.set(record.id,record);
    }
    for(const record of saved.observations??[]){
      const value=branch(record.branchId);
      if(!Number.isSafeInteger(record.actionCount)||record.actionCount<0||record.actionCount>value.actions.length)throw Error('Invalid restored observation');
      observations.set(record.id,record);
    }
    if((saved.comparisons?.length??0)>12)throw Error('Comparison limit reached');
    comparisons.push(...(saved.comparisons??[]));
  }
  return{
    id,identity,snapshot,
    async execute(name,args){
      if(name==='diff_memory'){
        const records=[args.fromObservationId,args.toObservationId].map(key=>{const value=observations.get(key);if(!value)throw Error('Unknown observation identity');return value;});
        const runtimes=await Promise.all(records.map(record=>replay(branch(record.branchId).actions.slice(0,record.actionCount),record.verification)));
        return{result:{sessionId:id,from:records[0].result,to:records[1].result,difference:compareMemoryValues(runtimes[0].memory.buffer,runtimes[1].memory.buffer,args.range)}};
      }
      if(name==='compare_branches'){
        const control=branch(args.controlBranchId),experimental=branch(args.experimentalBranchId);
        if(control===experimental||!control.parentCheckpointId||control.parentCheckpointId!==experimental.parentCheckpointId)throw Error('Compare two independent branches from the same checkpoint');
        const checkpoint=checkpoints.get(control.parentCheckpointId);
        const suffix=value=>value.actions.slice(checkpoint.actions.length);
        const inputs=value=>suffix(value).filter(action=>action.kind!=='write').map(({kind,buttons,frames})=>({kind,buttons,frames}));
        if(suffix(control).some(action=>action.kind==='write')||JSON.stringify(inputs(control))!==JSON.stringify(inputs(experimental))||control.runtime.frame!==experimental.runtime.frame)throw Error('Control must be unedited, with identical prior inputs and elapsed frames');
        const total=args.steps.reduce((sum,step)=>sum+step.frames,0);
        if(total>600||comparisons.length>=12||observations.size+2*args.steps.length>128)throw Error('Comparison frame, observation or count limit reached');
        for(const value of [control,experimental])if(value.runtime.faulted||value.actions.length+args.steps.length>128||value.actions.reduce((sum,action)=>sum+(action.frames??0),0)+total>7200)throw Error('Branch cannot advance this comparison');
        const result={comparisonId:`cmp-${String(comparisons.length+1).padStart(3,'0')}`,sessionId:id,hypothesis:args.hypothesis,checkpointId:checkpoint.id,controlBranchId:control.id,experimentalBranchId:experimental.id,identicalInputs:args.steps,edits:suffix(experimental).filter(action=>action.kind==='write'),firstDivergence:null,checkpoints:[],scope:'Identical inputs and elapsed frames in two replay-verified branches. Finite observations; no causal claim is assigned automatically.'};
        for(const step of args.steps){
          const count={control:0,experimental:0};let failure;
          try{
            for(let tick=0;tick<step.frames;tick++){
              count.control++;control.runtime.step(step.buttons,1);
              count.experimental++;experimental.runtime.step(step.buttons,1);
              const a=observeRuntime(control.runtime,args.watches),b=observeRuntime(experimental.runtime,args.watches);
              if(!result.firstDivergence&&(a.memoryHash!==b.memoryHash||a.framebufferHash!==b.framebufferHash||a.storage.hash!==b.storage.hash))result.firstDivergence={elapsedFrame:result.checkpoints.reduce((sum,point)=>sum+point.frames,0)+tick+1,frame:a.frame,control:summarizeObservation(a),experimental:summarizeObservation(b)};
            }
          }catch(error){failure=error;}
          finally{
            for(const [key,value]of [['control',control],['experimental',experimental]])if(count[key])value.actions.push({kind:'advance',buttons:step.buttons,frames:count[key],hypothesis:args.hypothesis,...(value.runtime.faulted?{error:failure?.message}:{}),after:fingerprint(value.runtime)});
          }
          if(failure){result.error=failure.message;comparisons.push(result);throw failure;}
          result.checkpoints.push({label:step.checkpoint,frames:step.frames,control:describe(control,args.watches),experimental:describe(experimental,args.watches)});
        }
        comparisons.push(result);return{result};
      }
      if(name==='fork_checkpoint'){
        if(branches.size>=6||branches.has(args.branchId))throw Error('Use a new branch identity; at most six branches');
        const checkpoint=checkpoints.get(args.checkpointId);if(!checkpoint)throw Error('Unknown checkpoint');
        assert.deepEqual(checkpoint.identity,identity,'Checkpoint cartridge/runtime identity mismatch');
        const restored=await replay(checkpoint.actions,checkpoint.verification);
        const value={id:args.branchId,experimental:true,parentCheckpointId:checkpoint.id,actions:structuredClone(checkpoint.actions),runtime:restored};
        branches.set(value.id,value);
        return{result:{...describe(value,args.watches),restoredFrom:checkpoint.id,restorationVerified:true}};
      }
      const value=branch(args.branchId);
      if(name==='write_memory'){
        if(!value.experimental)throw Error('Memory writes are permitted only in checkpoint branches');
        if(value.runtime.faulted||value.actions.length+args.edits.length>128)throw Error('Cannot edit this branch');
        for(const edit of args.edits)validateMemoryEdit(edit,value.runtime.memory.buffer.byteLength);
        const edits=[];
        for(const edit of args.edits){
          const action={kind:'write',...edit,frame:value.runtime.frame,...writeMemoryValue(value.runtime.memory.buffer,edit),after:fingerprint(value.runtime)};
          value.actions.push(action);edits.push(action);
        }
        return{result:{...describe(value,args.watches),edits,notice:'Experimental linear-memory writes only; the original cartridge bytes are unchanged.'}};
      }
      if(name==='session_observe'||name==='read_memory')return{result:describe(value,args.watches)};
      if(name==='checkpoint_state'){
        if(checkpoints.size>=16||value.runtime.faulted)throw Error('Cannot checkpoint a faulted branch or exceed 16 checkpoints');
        const record={label:args.label,sourceBranchId:value.id,identity,actions:structuredClone(value.actions),verification:fingerprint(value.runtime)};
        const checkpoint={...record,id:'cp-'+digest(JSON.stringify(record)).slice(0,20)};checkpoints.set(checkpoint.id,checkpoint);
        return{result:{sessionId:id,branchId:value.id,checkpointId:checkpoint.id,label:args.label,verification:checkpoint.verification,restoration:'Replay from a clean instance; no memory-only snapshots'}};
      }
      if(name==='session_reset'){
        if(value.actions.length>=128)throw Error('Branch journal limit reached');
        value.runtime.reset();value.actions.push({kind:'reset',after:fingerprint(value.runtime)});
        return{result:describe(value,args.watches)};
      }
      if(name==='session_advance'){
        if(value.actions.length+args.steps.length>128)throw Error('Branch journal limit reached');
        if(value.actions.reduce((sum,step)=>sum+(step.frames??0),0)+args.steps.reduce((sum,step)=>sum+step.frames,0)>7200)throw Error('Branch frame limit reached');
        const checkpoints=[];
        for(const step of args.steps){
          const action={kind:'advance',buttons:step.buttons,frames:step.frames,hypothesis:args.hypothesis};
          try{value.runtime.step(step.buttons,step.frames);}catch(error){action.error=error.message;throw error;}
          finally{action.after=fingerprint(value.runtime);value.actions.push(action);}
          checkpoints.push({...describe(value,args.watches),checkpoint:step.checkpoint});
        }
        return{result:{sessionId:id,branchId:value.id,hypothesis:args.hypothesis,checkpoints,motionNotice:MOTION_ASSISTANCE}};
      }
      throw Error('Unknown session command');
    },
  };
}
