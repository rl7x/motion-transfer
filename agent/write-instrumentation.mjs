import wabtFactory from 'wabt';
import {digest} from '../component/build.mjs';

// Reassemble a separate analysis copy with store callbacks. Original function
// identities below refer to the pre-instrumentation WAT, never shifted indices.
export async function instrumentMemoryWrites(bytes,inspection){
  const {lines,functions}=inspection,sites=[],unsupported=[];
  const owners=new Map();
  for(const fn of functions.filter(fn=>!fn.imported))for(let index=fn.startLine-1;index<fn.startLine-1+fn.lineCount;index++)owners.set(index,fn);
  const prefix='$analysis_';if(lines.some(line=>line.includes(prefix)))throw Error('Analysis symbol prefix already exists');
  const output=[];let imported=false;
  for(let index=0;index<lines.length;index++){
    const line=lines[index],fn=owners.get(index);
    if(fn&&index===fn.startLine-1){
      if(!imported){output.push('  (import "env" "analysis_write" (func $analysis_write (param i32 i32 i32 i32)))');imported=true;}
      output.push(line);
      if(fn.memoryAccesses.some(access=>/\.store/.test(access.instruction)))output.push('    (local $analysis_address i32) (local $analysis_i32 i32) (local $analysis_i64 i64) (local $analysis_f32 f32) (local $analysis_f64 f64)');continue;
    }
    const store=fn&&line.match(/^\s*((i32|i64|f32|f64)\.store(8|16|32)?)\b/);
    if(!store){if(fn&&/\b(?:memory\.(?:copy|fill|init)|v128\.store|atomic\.(?:store|rmw))\b/.test(line))unsupported.push({functionIndex:fn.index,functionLine:index-fn.startLine+2,instruction:line.trim()});output.push(line);continue;}
    const width=store[3]?Number(store[3])/8:Number(store[2].slice(1))/8,offset=Number(line.match(/\boffset=(\d+)/)?.[1]??0),functionLine=index-fn.startLine+2;
    sites.push({functionIndex:fn.index,functionLine,instruction:store[1],staticOffset:offset,width});
    const closing=line.match(/\)+\s*$/)?.[0]??'';
    output.push(`    local.set $analysis_${store[2]}`,'    local.tee $analysis_address',`    local.get $analysis_${store[2]}`,line.slice(0,line.length-closing.length),'    local.get $analysis_address',`    i32.const ${offset}`,'    i32.add',`    i32.const ${width}`,`    i32.const ${fn.index}`,`    i32.const ${functionLine}`,'    call $analysis_write'+closing);
  }
  if(!imported)throw Error('No defined functions are available for instrumentation');
  const wabt=await wabtFactory(),module=wabt.parseWat('analysis-copy.wat',output.join('\n'));
  try{
    module.resolveNames();module.validate();const copy=module.toBinary({write_debug_names:false}).buffer;
    new WebAssembly.Module(copy);
    return{bytes:copy,manifest:{originalSha256:digest(bytes),analysisSha256:digest(copy),wabtVersion:'1.0.39',instrumentedStores:sites.length,sites,unsupportedWrites:unsupported,scope:'Executed scalar i32/i64/f32/f64 store instructions only. No host-import writes, bulk memory operations, SIMD or atomic operations. Reports WAT function lines, not machine instruction addresses. No pausing watchpoints.'}};
  }finally{module.destroy();}
}

export async function traceMemoryWriters(session,inspection,bytes,args){
  const copy=await instrumentMemoryWrites(bytes,inspection);let recording=false,callbacks=0,matchingWrites=0;const hits=[];
  const onMemoryWrite=hit=>{
    if(++callbacks>250000)throw Error('Writer trace callback limit reached');
    if(!recording||hit.address>=args.address+args.byteLength||hit.address+hit.width<=args.address)return;
    matchingWrites++;if(hits.length<64)hits.push(hit);
  };
  const original=await session.reconstructCheckpoint(args.checkpointId),analysis=await session.reconstructCheckpoint(args.checkpointId,{bytes:copy.bytes,onMemoryWrite});
  recording=true;let framesCompared=0,firstDivergence=null;
  for(const step of args.steps)for(let index=0;index<step.frames;index++){
    const a=original.step(step.buttons,1),b=analysis.step(step.buttons,1);framesCompared++;
    for(const field of ['memoryHash','framebufferHash','storage','drawCalls','tones'])if(!firstDivergence&&JSON.stringify(a[field])!==JSON.stringify(b[field]))firstDivergence={frame:a.frame,field};
  }
  return{checkpointId:args.checkpointId,address:args.address,byteLength:args.byteLength,steps:args.steps,matchingWrites,hits,omittedHits:matchingWrites-hits.length,
    behavioralComparison:{passed:firstDivergence===null,framesCompared,firstDivergence},manifest:{...copy.manifest,sites:undefined},notice:'Evidence from a separate instrumented copy. Trust writer attribution only when the finite behavioral comparison passes; unsupported write sources remain unobserved.'};
}
