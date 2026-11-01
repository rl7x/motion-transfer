import {MEMORY_TYPES,validateMemoryWatches} from '../runtime/memory.mjs';
import {validateSchema} from '../agent/schema.mjs';

const text=(maxLength=500)=>({type:'string',minLength:1,maxLength});
const requestId={...text(80),pattern:'^[a-zA-Z0-9_-]{8,80}$'};
const checkpointId={...text(40),pattern:'^cp-[a-f0-9]{20}$'};
const watches={type:'array',maxItems:8,items:{type:'object',properties:{name:text(40),address:{type:'integer',minimum:0,maximum:65535},type:{type:'string',enum:MEMORY_TYPES},count:{type:'integer',minimum:1,maximum:16}},required:['name','address','type','count'],additionalProperties:false}};
const steps={type:'array',minItems:1,maxItems:4,items:{type:'object',properties:{buttons:{type:'integer',minimum:0,maximum:255},frames:{type:'integer',minimum:1,maximum:120},checkpoint:text(40)},required:['buttons','frames','checkpoint'],additionalProperties:false}};
export const EXPERIMENT_TOOLS=[{
  type:'function',name:'prepare_checkpoint',strict:true,
  description:'Advance inputs YOU choose on the persistent main branch, then save a replay-verified checkpoint and return bound typed target handles. X=1 starts/dashes; left=16, right=32, up=64, down=128; 0 releases. Human-mapped motion hints are labelled assistance. Target handles refer to this exact checkpoint; addresses can relocate later. Repeating requestId reconnects without advancing again.',
  parameters:{type:'object',properties:{requestId,hypothesis:text(),steps,watches},required:['requestId','hypothesis','steps','watches'],additionalProperties:false},
},{
  type:'function',name:'read_checkpoint',strict:true,
  description:'Observe an existing checkpoint without advancing or changing main. Return typed target handles for human-mapped hints and requested raw memory watches. Handles bind address, type, previous bytes and checkpoint identity; raw watch names are hypotheses.',
  parameters:{type:'object',properties:{checkpointId,watches},required:['checkpointId','watches'],additionalProperties:false},
},{
  type:'function',name:'run_experiment',strict:true,
  description:'Run one complete controlled experiment from an existing checkpoint. The host restores both instances, creates opaque branch handles, preserves an unedited control, applies your bounded typed interventions, executes identical inputs and collects actual evidence. Use targetId from prepare_checkpoint/read_checkpoint, never a guessed or stale address. Separate edit-induced initial differences from later behavior, timer and rendering differences. Returns a concise result and a full evidence artifact reference, not expected conclusions. Request IDs are idempotent.',
  parameters:{type:'object',properties:{requestId,hypothesis:text(),checkpointId,interventions:{type:'array',maxItems:8,items:{type:'object',properties:{targetId:{...text(80),pattern:'^target-[a-f0-9]{32}$'},value:{type:'number'},hypothesis:text()},required:['targetId','value','hypothesis'],additionalProperties:false}},steps,observations:{type:'object',properties:{channels:{type:'array',minItems:1,maxItems:5,items:{type:'string',enum:['motion','timers','events','memory','rendering']}},watches,captures:{type:'array',maxItems:4,items:{type:'string',enum:['control-before','intervention-before','control-after','intervention-after']}}},required:['channels','watches','captures'],additionalProperties:false}},required:['requestId','hypothesis','checkpointId','interventions','steps','observations'],additionalProperties:false},
}];

export function validateExperimentInput(name,args){
  const tool=EXPERIMENT_TOOLS.find(tool=>tool.name===name);if(!tool)throw Error('Unknown experiment operation');
  validateSchema(args,tool.parameters);
  if(args.watches)validateMemoryWatches(args.watches);
  if(args.observations){validateMemoryWatches(args.observations.watches);for(const key of ['channels','captures'])if(new Set(args.observations[key]).size!==args.observations[key].length)throw Error('Duplicate observation request');}
  if(args.steps){let frames=0;const labels=new Set();for(const step of args.steps){if(step.buttons&0x0c)throw Error('Unsupported gamepad bits');if(labels.has(step.checkpoint))throw Error('Input checkpoint labels must be unique');labels.add(step.checkpoint);frames+=step.frames;}if(frames>120)throw Error('At most 120 updates per experiment or preparation');}
}
