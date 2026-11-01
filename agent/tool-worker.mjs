import { loadTarget } from './target.mjs';
import { validateToolInput } from './tool-schema.mjs';
import { createReplayRuntime } from '../runtime/replay.mjs';
import { replayTrace } from '../runtime/trace.mjs';
import { createWasmInspection, inspectFunction, listFunctions } from './wasm-inspection.mjs';
import { summarizeObservation } from './observation.mjs';
import { observeDonorMotion } from '../runtime/donor-observation.mjs';
import { createInvestigationSession } from '../runtime/investigation-session.mjs';

const target=await loadTarget();
let session,inspection;


async function execute(name, args) {
  validateToolInput(name, args);
  if(name.startsWith('session_')||name==='read_memory'){
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
  if (name === 'list_functions') return { result: { sha256: target.sha256, ...listFunctions(inspection, args) } };
  if (name === 'inspect_function') return { result: { sha256: target.sha256, ...inspectFunction(inspection, args) } };
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
for await(const chunk of process.stdin){
  buffer+=chunk.toString('utf8');
  if(Buffer.byteLength(buffer)>2*1024*1024)throw Error('Worker input limit exceeded');
  let end;
  while((end=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let id;
    try{
      const request=JSON.parse(line);id=request.id;
      if(!Number.isSafeInteger(id))throw Error('Invalid worker request identity');
      process.stdout.write(JSON.stringify({id,ok:true,...await execute(request.name,request.args)})+'\n');
    }catch(error){process.stdout.write(JSON.stringify({id,ok:false,error:String(error.message).slice(0,1000)})+'\n');}
  }
}
