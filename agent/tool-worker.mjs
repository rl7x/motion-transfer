import { loadTarget } from './target.mjs';
import { validateToolInput } from './tool-schema.mjs';
import { createReplayRuntime } from '../runtime/replay.mjs';
import { replayTrace } from '../runtime/trace.mjs';
import { createWasmInspection, inspectFunction, listFunctions,navigateCallGraph } from './wasm-inspection.mjs';
import {decompileWasm,decompileFunction} from './decompile.mjs';
import {traceMemoryWriters} from './write-instrumentation.mjs';
import {createComponentWorkbench,COMPONENT_TOOLS} from './component-workbench.mjs';
import { summarizeObservation } from './observation.mjs';
import { observeDonorMotion } from '../runtime/donor-observation.mjs';
import { createInvestigationSession } from '../runtime/investigation-session.mjs';
import {digest} from '../component/build.mjs';
import {createExperimentWorkbench} from '../experiment/workbench.mjs';
import {EXPERIMENT_TOOLS} from '../experiment/schema.mjs';

const target=await loadTarget();
let session,inspection,decompilation,workbench,experiments;
const snapshot=()=>session?{...session.snapshot(),...(experiments?{experimentWorkbench:experiments.snapshot()}:{})}:undefined;
async function experimentTools(saved){session??=await createInvestigationSession(target.bytes);experiments??=await createExperimentWorkbench(session,{saved});return experiments;}


async function execute(name, args) {
  if(name==='$open'){
    if(session)throw Error('Investigation session is already open');
    session=await createInvestigationSession(target.bytes,args.sessionState);
    if(args.sessionState?.experimentWorkbench)await experimentTools(args.sessionState.experimentWorkbench);
    return{result:{sessionId:session.id,identity:session.identity,restored:Boolean(args.sessionState)}};
  }
  validateToolInput(name, args);
  if(EXPERIMENT_TOOLS.some(tool=>tool.name===name))return(await experimentTools()).execute(name,args);
  if(name==='capture_frame'&&session&&session.snapshot().captures.length+(experiments?.snapshot().usage.captures??0)>=4)throw Error('Investigation image budget exhausted');
  if(COMPONENT_TOOLS.some(tool=>tool.name===name)){
    if(!session)throw Error('Inspect code and collect session execution evidence first');
    workbench??=createComponentWorkbench(session);return workbench.execute(name,args);
  }
  if(name.startsWith('session_')||['read_memory','checkpoint_state','fork_checkpoint','write_memory','diff_memory','compare_branches','capture_frame','record_finding'].includes(name)){
    session??=await createInvestigationSession(target.bytes);
    return session.execute(name,args);
  }
  if (name === 'run_original') {
    const runtime = await createReplayRuntime(target.bytes);
    const evidence = replayTrace(runtime, { schemaVersion: 1, steps: args.steps }, { watches: args.watches,checkpointData:runtime=>{
      try{const {position,direction,cooldown,remaining,sourceBodyWidth}=observeDonorMotion(runtime);return{motion:{position,direction,cooldown,remaining,sourceBodyWidth}};}
      catch{return{motion:null};}
    } });
    return {
      result: {
        target: target.id,
        cartridgeSha256: target.sha256,
        frames: evidence.frames.length,
        memoryWatches: args.watches,
        motionNotice:'Motion fields are read from the actual binary through a HUMAN-MAPPED, hash-guarded registry. The agent did not discover that mapping. Null means the mapping was unavailable (for example outside gameplay). World position is distinct from camera-relative sprites. No expected outputs or recovered controller were used.',
        checkpoints: evidence.checkpoints.map(summarizeObservation),
      },
      evidence,
    };
  }

  const module = new WebAssembly.Module(target.bytes);
  if (args.view === 'overview') return {
    result: {
      target: target.id, bytes: target.bytes.length, sha256: target.sha256,
      imports: WebAssembly.Module.imports(module), exports: WebAssembly.Module.exports(module),
    },
  };
  inspection??=await createWasmInspection(target.bytes);
  if(name==='trace_writers'){
    if(!session)throw Error('Create an investigation checkpoint first');
    const result=await traceMemoryWriters(session,inspection,target.bytes,args);
    result.evidenceId='writers:'+digest(JSON.stringify(result)).slice(0,24);
    session.recordStatic({id:result.evidenceId,kind:'writer-trace',passed:result.behavioralComparison.passed});return{result};
  }
  if(name==='decompile_function'){
    decompilation??=await decompileWasm(target.bytes);
    const result={sha256:target.sha256,...decompileFunction(decompilation,args)};
    session?.recordStatic({id:result.evidenceId,functionIndex:args.functionIndex,kind:'decompilation'});return{result};
  }
  if(name==='call_graph')return{result:{sha256:target.sha256,...navigateCallGraph(inspection,args)}};
  if(name==='annotate_function'){
    if(!inspection.functions[args.functionIndex])throw Error('Unknown function index');
    session??=await createInvestigationSession(target.bytes);return session.annotate(args);
  }
  if (name === 'list_functions') return { result: { sha256: target.sha256, ...listFunctions(inspection, args) } };
  if (name === 'inspect_function'){
    const evidenceId=`binary:func${args.functionIndex}`;const result={sha256:target.sha256,evidenceId,...inspectFunction(inspection,args)};
    session?.recordStatic({id:evidenceId,functionIndex:args.functionIndex,kind:'wat'});return{result};
  }
  const { lines } = inspection;
  if (args.startLine > lines.length) throw new Error(`startLine exceeds the ${lines.length} WAT lines`);
  return {
    result: {
      sha256: target.sha256,
      totalLines: lines.length,
      lines: lines.slice(args.startLine - 1, args.startLine - 1 + args.lineCount).map((text, index) => ({
        number: args.startLine + index, text: text.slice(0, 240), truncated: text.length > 240,
      })),
      nextLine: args.startLine + args.lineCount <= lines.length ? args.startLine + args.lineCount : null,
    },
  };
}

let buffer='';
process.stdin.setEncoding('utf8');
for await(const chunk of process.stdin){
  buffer+=chunk.toString('utf8');
  if(Buffer.byteLength(buffer)>2*1024*1024)throw Error('Worker input limit exceeded');
  let end;
  while((end=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let id;
    try{
      const request=JSON.parse(line);id=request.id;
      if(!Number.isSafeInteger(id))throw Error('Invalid worker request identity');
      const output=await execute(request.name,request.args);
      process.stdout.write(JSON.stringify({id,ok:true,...output,...(session?{sessionState:snapshot()}:{} )})+'\n');
    }catch(error){process.stdout.write(JSON.stringify({id,ok:false,error:String(error.message).slice(0,1000),...(session?{sessionState:snapshot()}:{} )})+'\n');}
  }
}
