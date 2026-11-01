import {MEMORY_TYPES,validateMemoryWatches} from '../runtime/memory.mjs';
import {validateSchema} from '../agent/schema.mjs';

const text=(maxLength=500)=>({type:'string',minLength:1,maxLength});
const requestId={...text(80),pattern:'^[a-zA-Z0-9_-]{8,80}$'};
const checkpointId={...text(40),pattern:'^cp-[a-f0-9]{20}$'};
const watches={type:'array',maxItems:8,items:{type:'object',properties:{name:text(40),address:{type:'integer',minimum:0,maximum:65535},type:{type:'string',enum:MEMORY_TYPES},count:{type:'integer',minimum:1,maximum:16}},required:['name','address','type','count'],additionalProperties:false}};
const steps={type:'array',minItems:1,maxItems:4,items:{type:'object',properties:{buttons:{type:'integer',minimum:0,maximum:255},frames:{type:'integer',minimum:1,maximum:120},checkpoint:text(40)},required:['buttons','frames','checkpoint'],additionalProperties:false}};
export const EXPERIMENT_TOOLS=[{
  type:'function',name:'run_experiment_program',strict:true,
  description:'Execute a short JS/TS async function body in a capability-only WebAssembly interpreter. sdk.prepareCheckpoint({requestId,hypothesis,steps,watches}) returns {checkpointId,targets}; targets have id,name,type and checkpoint binding. sdk.runExperiment({requestId,hypothesis,checkpointId,interventions:[{targetId,value,hypothesis}],steps,observations:{channels,watches,captures}}) performs the complete pair. sdk.sweep(values,value=>request) runs at most four values sequentially. sdk.readExperiment({artifactId,startFrame,frameCount}) reads at most four trace frames; sdk.capture({requestId,artifactId,branch:"control"|"intervention",reason}) selects a final PNG. sdk.static offers inspectWasm,listFunctions,inspectFunction,decompileFunction,callGraph,traceWriters with their normal bounded arguments. sdk.emitFinding({claim,status,confidence,evidenceIds}) records an interpretation. Await every operation. Use actual returned values for loops/conditional follow-ups; return concise JSON. No imports, files, shell, network, credentials, recovered implementation or host globals. Max 8192 source bytes, 16 SDK operations, four experiments and four total images; shared existing frame/spending bounds remain. Two programs maximum. Failed/interrupted programs are not automatically retried or stack-resumed.',
  parameters:{type:'object',properties:{requestId,hypothesis:text(),language:{type:'string',enum:['javascript','typescript']},source:text(8192)},required:['requestId','hypothesis','language','source'],additionalProperties:false},
},{
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
},{
  type:'function',name:'read_experiment',strict:true,description:'Read a bounded window from an immutable completed experiment artifact. Large complete traces stay in the evidence store; this returns at most four requested frames and endpoint observations.',
  parameters:{type:'object',properties:{artifactId:{...text(64),pattern:'^[a-f0-9]{64}$'},startFrame:{type:'integer',minimum:1,maximum:120},frameCount:{type:'integer',minimum:1,maximum:4}},required:['artifactId','startFrame','frameCount'],additionalProperties:false},
},{
  type:'function',name:'capture_experiment',strict:true,description:'Reconstruct and verify one completed experiment endpoint, then selectively capture its actual PNG. Image identity retains session, branch, frame and source artifact. Counts against the same four-image investigation budget; requestId is idempotent.',
  parameters:{type:'object',properties:{requestId,artifactId:{...text(64),pattern:'^[a-f0-9]{64}$'},branch:{type:'string',enum:['control','intervention']},reason:text(300)},required:['requestId','artifactId','branch','reason'],additionalProperties:false},
}];

export function validateExperimentInput(name,args){
  const tool=EXPERIMENT_TOOLS.find(tool=>tool.name===name);if(!tool)throw Error('Unknown experiment operation');
  validateSchema(args,tool.parameters);
  if(args.watches)validateMemoryWatches(args.watches);
  if(args.observations){validateMemoryWatches(args.observations.watches);for(const key of ['channels','captures'])if(new Set(args.observations[key]).size!==args.observations[key].length)throw Error('Duplicate observation request');}
  if(args.steps){let frames=0;const labels=new Set();for(const step of args.steps){if(step.buttons&0x0c)throw Error('Unsupported gamepad bits');if(labels.has(step.checkpoint))throw Error('Input checkpoint labels must be unique');labels.add(step.checkpoint);frames+=step.frames;}if(frames>120)throw Error('At most 120 updates per experiment or preparation');}
}
