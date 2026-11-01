import { MEMORY_TYPES, validateMemoryWatches,validateMemoryEdit,memoryTypeSize } from '../runtime/memory.mjs';
import {COMPONENT_TOOLS} from './component-workbench.mjs';
import {validateSchema} from './schema.mjs';

export const MAX_TOOL_OUTPUT_BYTES = 32_768;

export const TOOLS = [{
  type: 'function',
  name: 'inspect_wasm',
  description: 'Inspect the pinned cartridge only. overview returns imports/exports; wat returns numbered disassembly lines with generated names and no debug names. Long lines are abbreviated. No source files are accessible.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      view: { type: 'string', enum: ['overview', 'wat'] },
      startLine: { type: 'integer', minimum: 1, maximum: 100_000, description: 'First WAT line; ignored for overview.' },
      lineCount: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum WAT lines; ignored for overview.' },
    },
    required: ['view', 'startLine', 'lineCount'],
    additionalProperties: false,
  },
}, {
  type: 'function',
  name: 'list_functions',
  description: 'List generated function names, signatures, exports, WAT locations, and counts of direct calls and memory instructions in the pinned cartridge. Function indices include imports. Page with nextIndex; names are not recovered source names.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      startIndex: { type: 'integer', minimum: 0, maximum: 100_000 },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
    required: ['startIndex', 'limit'],
    additionalProperties: false,
  },
}, {
  type: 'function',
  name: 'inspect_function',
  description: 'Inspect one function by index from list_functions. Returns direct callers/callees and up to 100 WAT lines with call sites and memory load/store offsets in that window. startLine is relative to the function, starting at 1. Indirect calls are marked unresolved. A memory offset is added to a runtime base address; it is not necessarily an absolute address. This is disassembly, not recovered source.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      functionIndex: { type: 'integer', minimum: 0, maximum: 100_000 },
      startLine: { type: 'integer', minimum: 1, maximum: 100_000 },
      lineCount: { type: 'integer', minimum: 1, maximum: 100 },
    },
    required: ['functionIndex', 'startLine', 'lineCount'],
    additionalProperties: false,
  },
}, {
  type: 'function',
  name: 'run_original',
  description: 'Run a controlled experiment from fresh cartridge, memory, and empty storage. Each step holds a gamepad mask for fixed 60 Hz updates. Returns checkpoint hashes, visible text, grouped sprite coordinates, requested read-only memory watches, and motion fields from the host\'s HUMAN-MAPPED, hash-guarded donor registry: world position, direction, remaining active ticks, cooldown, sourceBodyWidth. Null motion means unavailable outside gameplay. The agent does not discover this registry mapping. Use world position to distinguish player movement from camera motion. Watches read little-endian numeric values at absolute byte addresses; use [] when unused. X=1 starts/dashes; Z=2; left=16; right=32; up=64; down=128. OR bits to combine; 0 releases. Maximum 12 checkpoints, 1,800 total frames, and 64 watched values. No source or filesystem access.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      hypothesis: { type: 'string', minLength: 1, maxLength: 500 },
      watches: {
        type: 'array', maxItems: 8,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 40 },
            address: { type: 'integer', minimum: 0, maximum: 65_535 },
            type: { type: 'string', enum: MEMORY_TYPES },
            count: { type: 'integer', minimum: 1, maximum: 16 },
          },
          required: ['name', 'address', 'type', 'count'],
          additionalProperties: false,
        },
      },
      steps: {
        type: 'array', minItems: 1, maxItems: 12,
        items: {
          type: 'object',
          properties: {
            buttons: { type: 'integer', minimum: 0, maximum: 255 },
            frames: { type: 'integer', minimum: 1, maximum: 600 },
            checkpoint: { type: 'string', minLength: 1, maxLength: 40 },
          },
          required: ['buttons', 'frames', 'checkpoint'],
          additionalProperties: false,
        },
      },
    },
    required: ['hypothesis', 'watches', 'steps'],
    additionalProperties: false,
  },
}];

const branchId={type:'string',pattern:'^[a-z][a-z0-9-]{0,39}$',description:'Identity of an existing branch for observation or execution. main is the initial branch.'};
TOOLS.push(...COMPONENT_TOOLS);
const watches=TOOLS.find(tool=>tool.name==='run_original').parameters.properties.watches;
const steps=TOOLS.find(tool=>tool.name==='run_original').parameters.properties.steps;
for(const name of ['session_observe','read_memory','session_reset'])TOOLS.push({
  type:'function',name,strict:true,
  description:name==='session_reset'?'Reset only this branch to a clean cartridge instance, including private globals and host storage.':'Observe the current persistent branch without advancing; include bounded typed memory watches. Motion fields are HUMAN-MAPPED assistance.',
  parameters:{type:'object',properties:{branchId,watches},required:['branchId','watches'],additionalProperties:false},
});
TOOLS.push({type:'function',name:'session_advance',strict:true,
  description:'Continue this persistent branch with held inputs at 60 Hz, preserving prior state. Checkpoints here are observation labels; use checkpoint_state for a reusable branch point. The initial branch is main. X=1 starts/dashes; left=16, right=32, up=64, down=128. Frames and output are bounded.',
  parameters:{type:'object',properties:{branchId,hypothesis:{type:'string',minLength:1,maxLength:500},watches,steps},required:['branchId','hypothesis','watches','steps'],additionalProperties:false},
});
TOOLS.push({type:'function',name:'checkpoint_state',strict:true,
  description:'Record a reusable checkpoint bound to cartridge and runtime identity. Restoration replays inputs and edits into a clean instance and verifies frame, memory, framebuffer and host-storage hashes. Private globals are reconstructed, not copied.',
  parameters:{type:'object',properties:{branchId,label:{type:'string',minLength:1,maxLength:80}},required:['branchId','label'],additionalProperties:false},
},{type:'function',name:'fork_checkpoint',strict:true,
  description:'Restore a checkpoint into a new independent experimental branch. main remains unchanged. Give the new branch a short lowercase identity; use the returned identity in later commands.',
  parameters:{type:'object',properties:{checkpointId:{type:'string',pattern:'^cp-[a-f0-9]{20}$'},branchId:{...branchId,description:'A NEW unused branch name, such as control or variant. Never use main or any already-created branch. This is the name to CREATE, not the checkpoint source.'},watches},required:['checkpointId','branchId','watches'],additionalProperties:false},
});
const memoryRange={type:'object',properties:{address:{type:'integer',minimum:0,maximum:65535},byteLength:{type:'integer',minimum:1,maximum:4096},type:{type:'string',enum:MEMORY_TYPES}},required:['address','byteLength','type'],additionalProperties:false};
TOOLS.push({type:'function',name:'decompile_function',strict:true,
  description:'Read bounded WABT C-like pseudocode for an agent-selected function index. This derived interpretation is not original source. Page relative lines as with inspect_function; WAT remains authoritative.',
  parameters:TOOLS.find(tool=>tool.name==='inspect_function').parameters,
},{type:'function',name:'call_graph',strict:true,
  description:'Navigate direct callers or callees of an agent-selected function to depth three, bounded to 60 nodes and 100 edges. Indirect calls remain unresolved. Generated and inferred names are distinct.',
  parameters:{type:'object',properties:{functionIndex:{type:'integer',minimum:0,maximum:100000},direction:{type:'string',enum:['callers','callees']},depth:{type:'integer',minimum:1,maximum:3}},required:['functionIndex','direction','depth'],additionalProperties:false},
},{type:'function',name:'annotate_function',strict:true,
  description:'Attach an agent-inferred name and testable interpretation to a function. Include confidence, supported/rejected/unresolved status, and actual observation/comparison/binary evidence IDs from this session. These are annotations, not established source names.',
  parameters:{type:'object',properties:{functionIndex:{type:'integer',minimum:0,maximum:100000},inferredName:{type:'string',minLength:1,maxLength:80},hypothesis:{type:'string',minLength:1,maxLength:500},confidence:{type:'string',enum:['low','medium','high']},status:{type:'string',enum:['supported','rejected','unresolved']},evidenceIds:{type:'array',minItems:1,maxItems:8,items:{type:'string',minLength:1,maxLength:80}}},required:['functionIndex','inferredName','hypothesis','confidence','status','evidenceIds'],additionalProperties:false},
});
const edit={type:'object',properties:{address:{type:'integer',minimum:0,maximum:65535},type:{type:'string',enum:MEMORY_TYPES},value:{type:'number'},hypothesis:{type:'string',minLength:1,maxLength:500}},required:['address','type','value','hypothesis'],additionalProperties:false};
TOOLS.push({type:'function',name:'capture_frame',strict:true,
  description:'Capture the current native framebuffer as a real PNG and send it alongside structured evidence to the model. Select only informative frames: at most four images per investigation. The image retains session, branch, frame, palette and hashes.',
  parameters:{type:'object',properties:{branchId,reason:{type:'string',minLength:1,maxLength:300}},required:['branchId','reason'],additionalProperties:false},
});
TOOLS.push({type:'function',name:'record_finding',strict:true,
  description:'Record a supported, rejected, or unresolved model interpretation with confidence and real session evidence links. Status describes your interpretation of finite observations; it does not establish universal correctness.',
  parameters:{type:'object',properties:{claim:{type:'string',minLength:1,maxLength:800},status:{type:'string',enum:['supported','rejected','unresolved']},confidence:{type:'string',enum:['low','medium','high']},evidenceIds:{type:'array',minItems:1,maxItems:8,items:{type:'string',minLength:1,maxLength:80}}},required:['claim','status','confidence','evidenceIds'],additionalProperties:false},
});
TOOLS.push({type:'function',name:'trace_writers',strict:true,
  description:'Trace executed scalar store writers to a selected absolute memory range in a separate instrumented analysis copy restored from a checkpoint. Compare its full observed behavior against the unchanged cartridge for the same inputs. At most 120 frames and 64 hits. Does not implement pausing watchpoints, host writes, SIMD, bulk or atomic write tracing.',
  parameters:{type:'object',properties:{checkpointId:{type:'string'},address:{type:'integer',minimum:0,maximum:65535},byteLength:{type:'integer',minimum:1,maximum:256},steps:{...steps,maxItems:4}},required:['checkpointId','address','byteLength','steps'],additionalProperties:false},
});
TOOLS.push({type:'function',name:'write_memory',strict:true,
  description:'Apply up to eight finite typed writes to an experimental checkpoint branch. Writes to main are forbidden. Records the previous value, rounded new value, address, frame and hypothesis. Code bytes remain immutable. A trapped branch must reset before advancing.',
  parameters:{type:'object',properties:{branchId,edits:{type:'array',minItems:1,maxItems:8,items:edit},watches},required:['branchId','edits','watches'],additionalProperties:false},
},{type:'function',name:'diff_memory',strict:true,
  description:'Compare up to 4096 bytes as typed values between two observation IDs from this session. Returns absolute candidate addresses and changes, capped at 64. Reconstructs each observation by verified replay. Changes alone are correlation, not inferred names.',
  parameters:{type:'object',properties:{fromObservationId:{type:'string'},toObservationId:{type:'string'},range:memoryRange},required:['fromObservationId','toObservationId','range'],additionalProperties:false},
},{type:'function',name:'compare_branches',strict:true,
  description:'Advance two branches forked from the same checkpoint with exactly the same inputs. The control must have no additional writes. Prior input histories and elapsed frames must match. Observe actual motion, memory and rendering differences; mutations alone are not proof of a field meaning. At most 600 frames total.',
  parameters:{type:'object',properties:{controlBranchId:branchId,experimentalBranchId:branchId,hypothesis:{type:'string',minLength:1,maxLength:500},watches,steps:{...steps,maxItems:4}},required:['controlBranchId','experimentalBranchId','hypothesis','watches','steps'],additionalProperties:false},
});

function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`Expected only these fields: ${keys.join(', ')}`);
  }
}

function integer(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

export function validateToolInput(name, args) {
  if(name==='record_finding'){validateSchema(args,TOOLS.find(tool=>tool.name===name).parameters);return;}
  const component=COMPONENT_TOOLS.find(tool=>tool.name===name);
  if(component){validateSchema(args,component.parameters);return;}
  if(name==='capture_frame'){
    object(args,['branchId','reason']);validateToolInput('session_observe',{branchId:args.branchId,watches:[]});
    if(typeof args.reason!=='string'||!args.reason.trim()||args.reason.length>300)throw Error('An image needs a selective capture reason');return;
  }
  if(name==='trace_writers'){
    object(args,['checkpointId','address','byteLength','steps']);
    if(typeof args.checkpointId!=='string'||!/^cp-[a-f0-9]{20}$/.test(args.checkpointId)||!integer(args.address,0,65535)||!integer(args.byteLength,1,256)||args.address+args.byteLength>65536)throw Error('Invalid writer range or checkpoint');
    validateToolInput('run_original',{hypothesis:'Trace selected writers.',watches:[],steps:args.steps});
    if(args.steps.length>4||args.steps.reduce((sum,step)=>sum+step.frames,0)>120)throw Error('Writer tracing is limited to four steps and 120 frames');return;
  }
  if(name==='decompile_function'){validateToolInput('inspect_function',args);return;}
  if(name==='call_graph'){
    object(args,['functionIndex','direction','depth']);
    if(!integer(args.functionIndex,0,100000)||!['callers','callees'].includes(args.direction)||!integer(args.depth,1,3))throw Error('Invalid call graph navigation');return;
  }
  if(name==='annotate_function'){
    object(args,['functionIndex','inferredName','hypothesis','confidence','status','evidenceIds']);
    if(!integer(args.functionIndex,0,100000)||typeof args.inferredName!=='string'||!args.inferredName.trim()||args.inferredName.length>80||typeof args.hypothesis!=='string'||!args.hypothesis.trim()||args.hypothesis.length>500||!['low','medium','high'].includes(args.confidence)||!['supported','rejected','unresolved'].includes(args.status)||!Array.isArray(args.evidenceIds)||!args.evidenceIds.length||args.evidenceIds.length>8||!args.evidenceIds.every(id=>typeof id==='string'&&id.length>0&&id.length<=80))throw Error('Invalid function annotation');return;
  }
  if(name==='write_memory'){
    object(args,['branchId','edits','watches']);validateToolInput('session_observe',{branchId:args.branchId,watches:args.watches});
    if(!Array.isArray(args.edits)||!args.edits.length||args.edits.length>8)throw Error('Use one to eight memory edits');
    for(const edit of args.edits){object(edit,['address','type','value','hypothesis']);validateMemoryEdit(edit);if(typeof edit.hypothesis!=='string'||!edit.hypothesis.trim()||edit.hypothesis.length>500)throw Error('Each edit needs a hypothesis');}
    return;
  }
  if(name==='diff_memory'){
    object(args,['fromObservationId','toObservationId','range']);object(args.range,['address','byteLength','type']);
    const size=memoryTypeSize(args.range.type);
    if(![args.fromObservationId,args.toObservationId].every(id=>typeof id==='string'&&/^obs-\d{4}$/.test(id))||!size||!integer(args.range.address,0,65535)||!integer(args.range.byteLength,1,4096)||args.range.byteLength%size||args.range.address+args.range.byteLength>65536)throw Error('Invalid observation IDs or memory comparison range');
    return;
  }
  if(name==='compare_branches'){
    object(args,['controlBranchId','experimentalBranchId','hypothesis','watches','steps']);
    for(const branchId of [args.controlBranchId,args.experimentalBranchId])validateToolInput('session_observe',{branchId,watches:args.watches});
    validateToolInput('run_original',{hypothesis:args.hypothesis,watches:args.watches,steps:args.steps});
    if(args.steps.length>4||args.steps.reduce((sum,step)=>sum+step.frames,0)>600)throw Error('Compare at most four steps and 600 frames');
    return;
  }
  if(name==='checkpoint_state'||name==='fork_checkpoint'){
    object(args,name==='checkpoint_state'?['branchId','label']:['checkpointId','branchId','watches']);
    if(typeof args.branchId!=='string'||!/^[a-z][a-z0-9-]{0,39}$/.test(args.branchId))throw Error('Invalid branch identity');
    if(name==='checkpoint_state'){
      if(typeof args.label!=='string'||!args.label.trim()||args.label.length>80)throw Error('Invalid checkpoint label');
    }else{
      if(typeof args.checkpointId!=='string'||!/^cp-[a-f0-9]{20}$/.test(args.checkpointId))throw Error('Invalid checkpoint identity');
      validateMemoryWatches(args.watches);
    }
    return;
  }
  if(['session_observe','read_memory','session_reset','session_advance'].includes(name)){
    if(name==='session_advance'){
      object(args,['branchId','hypothesis','watches','steps']);
      validateToolInput('run_original',{hypothesis:args.hypothesis,watches:args.watches,steps:args.steps});
    }else{object(args,['branchId','watches']);validateMemoryWatches(args.watches);}
    if(typeof args.branchId!=='string'||!/^[a-z][a-z0-9-]{0,39}$/.test(args.branchId))throw Error('Invalid branch identity');
    return;
  }
  if (name === 'list_functions') {
    object(args, ['startIndex', 'limit']);
    if (!integer(args.startIndex, 0, 100_000) || !integer(args.limit, 1, 50)) {
      throw new Error('Invalid function index range');
    }
    return;
  }
  if (name === 'inspect_function') {
    object(args, ['functionIndex', 'startLine', 'lineCount']);
    if (!integer(args.functionIndex, 0, 100_000) || !integer(args.startLine, 1, 100_000) || !integer(args.lineCount, 1, 100)) {
      throw new Error('Invalid function index or relative line range');
    }
    return;
  }
  if (name === 'inspect_wasm') {
    object(args, ['view', 'startLine', 'lineCount']);
    if (!['overview', 'wat'].includes(args.view) || !integer(args.startLine, 1, 100_000) || !integer(args.lineCount, 1, 100)) {
      throw new Error('Invalid inspection view or WAT line range');
    }
    return;
  }
  if (name !== 'run_original') throw new Error(`Unknown tool: ${name}`);
  object(args, ['hypothesis', 'watches', 'steps']);
  validateMemoryWatches(args.watches);
  if (typeof args.hypothesis !== 'string' || !args.hypothesis.trim() || args.hypothesis.length > 500) {
    throw new Error('hypothesis must contain 1–500 characters');
  }
  if (!Array.isArray(args.steps) || args.steps.length < 1 || args.steps.length > 12) {
    throw new Error('An experiment needs 1–12 steps');
  }
  let frames = 0;
  const names = new Set(['reset']);
  for (const step of args.steps) {
    object(step, ['buttons', 'frames', 'checkpoint']);
    if (!integer(step.buttons, 0, 255) || (step.buttons & 0x0c) || !integer(step.frames, 1, 600)) {
      throw new Error('Each step needs valid gamepad bits and 1–600 frames');
    }
    if (typeof step.checkpoint !== 'string' || !step.checkpoint.trim() || step.checkpoint.length > 40 || names.has(step.checkpoint)) {
      throw new Error('Checkpoints must be unique names of 1–40 characters; reset is reserved');
    }
    frames += step.frames;
    names.add(step.checkpoint);
  }
  if (frames > 1_800) throw new Error('An experiment cannot exceed 1,800 frames');
}
