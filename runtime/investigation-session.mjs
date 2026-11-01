import { randomUUID } from 'node:crypto';
import { createReplayRuntime } from './replay.mjs';
import { observeDonorMotion } from './donor-observation.mjs';
import { summarizeObservation } from '../agent/observation.mjs';

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
export async function createInvestigationSession(bytes){
  const runtime=await createReplayRuntime(bytes),id=randomUUID();
  const branches=new Map([['main',{id:'main',runtime,actions:[],experimental:false}]]);
  const identity=runtime.provenance;
  const branch=id=>{const value=branches.get(id);if(!value)throw Error('Unknown investigation branch: '+id);return value;};
  const describe=(value,watches=[])=>({sessionId:id,branchId:value.id,experimental:value.experimental,motionNotice:MOTION_ASSISTANCE,...summarizeObservation(observeRuntime(value.runtime,watches))});
  return{
    id,identity,
    async execute(name,args){
      const value=branch(args.branchId);
      if(name==='session_observe'||name==='read_memory')return{result:describe(value,args.watches)};
      if(name==='session_reset'){
        value.runtime.reset();value.actions.push({kind:'reset'});
        return{result:describe(value,args.watches)};
      }
      if(name==='session_advance'){
        if(value.actions.length>=128)throw Error('Branch journal limit reached');
        if(value.runtime.frame+args.steps.reduce((sum,step)=>sum+step.frames,0)>7200)throw Error('Branch frame limit reached');
        const checkpoints=[];
        for(const step of args.steps){
          value.runtime.step(step.buttons,step.frames);
          value.actions.push({kind:'advance',buttons:step.buttons,frames:step.frames});
          checkpoints.push({...describe(value,args.watches),checkpoint:step.checkpoint});
        }
        return{result:{sessionId:id,branchId:value.id,hypothesis:args.hypothesis,checkpoints,motionNotice:MOTION_ASSISTANCE}};
      }
      throw Error('Unknown session command');
    },
  };
}
