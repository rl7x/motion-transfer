import {newQuickJSWASMModule} from 'quickjs-emscripten';
import {transform} from 'esbuild';
import {digest} from '../component/build.mjs';

export const INTERPRETER_LIMITS=Object.freeze({timeoutMs:5000,memoryBytes:8*1024*1024,stackBytes:256*1024,maxInterrupts:1024,maxJobs:2048,maxOperations:16,maxOutputBytes:4096});
const METHODS={prepareCheckpoint:'prepare_checkpoint',readCheckpoint:'read_checkpoint',runExperiment:'run_experiment',readExperiment:'read_experiment',capture:'capture_experiment',emitFinding:'record_finding'};
const STATIC={inspectWasm:'inspect_wasm',listFunctions:'list_functions',inspectFunction:'inspect_function',decompileFunction:'decompile_function',callGraph:'call_graph',traceWriters:'trace_writers'};

// Guest code runs in a fresh QuickJS interpreter compiled to WebAssembly. Only
// JSON strings cross the capability boundary; no Node objects enter the guest.
export async function executeExperimentProgram({source,language='javascript',invoke,signal,limits=INTERPRETER_LIMITS}={}){
  if(signal?.aborted)throw Error('Experiment program cancelled');
  if(typeof source!=='string'||!source.trim()||Buffer.byteLength(source)>8192||!['javascript','typescript'].includes(language))throw Error('Experiment programs need 1–8192 bytes of JavaScript or TypeScript');
  for(const [key,max]of Object.entries(INTERPRETER_LIMITS))if(!Number.isSafeInteger(limits[key])||limits[key]<1||limits[key]>max)throw Error('Invalid interpreter limit: '+key);
  const compiled=await transform(`(async function(sdk){\n${source}\n})(globalThis.sdk).then(globalThis.__encodeResult)`,{loader:language==='typescript'?'ts':'js',target:'es2022',logLevel:'silent'});
  const module=await newQuickJSWASMModule(),runtime=module.newRuntime();
  runtime.setMemoryLimit(limits.memoryBytes);runtime.setMaxStackSize(limits.stackBytes);runtime.removeModuleLoader();
  const deadline=Date.now()+limits.timeoutMs;let interrupts=0,jobs=0,operations=0,fatal=null,pending=null,alive=true;
  runtime.setInterruptHandler(()=>Boolean(fatal||signal?.aborted||Date.now()>deadline||++interrupts>limits.maxInterrupts));
  const context=runtime.newContext(),deferreds=[];let promise;
  const errorText=handle=>{try{const value=context.dump(handle);return String(value?.message??value).slice(0,1000);}finally{handle.dispose();}};
  function settle(deferred,value){if(!alive)return;const handle=context.newString(JSON.stringify(value));try{deferred.resolve(handle);}finally{handle.dispose();}}
  const bridge=context.newFunction('experimentCapability',(nameHandle,argsHandle)=>{
    const deferred=context.newPromise();deferreds.push(deferred);
    let name,args;
    try{
      name=context.getString(nameHandle);const encoded=context.getString(argsHandle);
      if(Buffer.byteLength(encoded)>32768)throw Error('SDK argument byte limit exceeded');
      args=JSON.parse(encoded);
      if(!Object.values(METHODS).includes(name)&&!Object.values(STATIC).includes(name))throw Error('Forbidden experiment capability');
      if(pending)throw Error('Await SDK operations sequentially');
      if(++operations>limits.maxOperations)throw Error('SDK operation budget exhausted');
      if(signal?.aborted||Date.now()>deadline)throw Error('Experiment program cancelled or deadline exceeded');
    }catch(error){fatal=error;settle(deferred,{ok:false,error:error.message});return deferred.handle;}
    pending=Promise.resolve().then(()=>invoke(name,args)).then(value=>{
      const encoded=JSON.stringify({ok:true,result:value});if(Buffer.byteLength(encoded)>32768)throw Error('SDK result byte limit exceeded; read a smaller evidence window');settle(deferred,{ok:true,result:value});
    }).catch(error=>{if(/budget|limit|cancel|deadline|trapped/i.test(error.message))fatal=error;settle(deferred,{ok:false,error:String(error.message).slice(0,1000)});}).finally(()=>{pending=null;});
    return deferred.handle;
  });
  context.setProp(context.global,'__hostCapability',bridge);bridge.dispose();
  const wrapper=`(() => {
    'use strict';
    const capability=globalThis.__hostCapability, encode=JSON.stringify.bind(JSON), decode=JSON.parse.bind(JSON);
    delete globalThis.__hostCapability;
    const call=async(name,args)=>{const response=decode(await capability(name,encode(args)));if(!response.ok)throw new Error(response.error);return response.result;};
    const sdk={};
    for(const [method,name] of Object.entries(${JSON.stringify(METHODS)}))sdk[method]=args=>call(name,args);
    const analysis={};for(const [method,name]of Object.entries(${JSON.stringify(STATIC)}))analysis[method]=args=>call(name,args);
    sdk.static=Object.freeze(analysis);
    sdk.sweep=async(values,makeRequest)=>{if(!Array.isArray(values)||values.length>4)throw new Error('At most four sweep values');const results=[];for(const value of values)results.push(await sdk.runExperiment(makeRequest(value)));return results;};
    Object.defineProperty(globalThis,'sdk',{value:Object.freeze(sdk),writable:false,configurable:false});
    Object.defineProperty(globalThis,'__encodeResult',{value:value=>encode(value??null),writable:false,configurable:false});
    globalThis.Date=undefined;Math.random=()=>{throw new Error('Randomness is unavailable in reproducible experiment programs');};
  })()`;
  try{
    if(signal?.aborted)throw Error('Experiment program cancelled');
    const setup=context.evalCode(wrapper,'experiment-capabilities.js');if(setup.error)throw Error(errorText(setup.error));setup.value.dispose();
    const evaluated=context.evalCode(compiled.code,'experiment-program.'+(language==='typescript'?'ts':'js'));
    if(evaluated.error)throw Error(errorText(evaluated.error));promise=evaluated.value;
    for(;;){
      if(signal?.aborted)throw Error('Experiment program cancelled');if(fatal)throw fatal;if(Date.now()>deadline)throw Error('Experiment program deadline exceeded');
      const executed=runtime.executePendingJobs(32);if(executed.error)throw Error(errorText(executed.error));jobs+=executed.value;
      if(jobs>limits.maxJobs)throw Error('Interpreter job budget exhausted');
      const result=context.getPromiseState(promise);
      if(result.type==='rejected')throw Error(errorText(result.error));
      if(result.type==='fulfilled'){
        let encoded;try{encoded=context.getString(result.value);}finally{result.value.dispose();}
        if(pending){await pending;throw Error('Experiment program returned without awaiting an SDK operation');}
        if(fatal)throw fatal;
        if(Buffer.byteLength(encoded)>limits.maxOutputBytes)throw Error('Experiment program output byte limit exceeded');
        return{output:JSON.parse(encoded),sourceSha256:digest(source),compiledSha256:digest(compiled.code),operations,interpreter:{name:'quickjs-emscripten',version:'0.32.0',boundary:'WebAssembly interpreter with JSON-only capabilities',limits}};
      }
      if(pending)await pending;
      else if(runtime.hasPendingJob())await Promise.resolve();
      else throw Error('Experiment program awaits an unresolved promise');
    }
  }finally{
    alive=false;if(pending)await pending;for(const deferred of deferreds)deferred.dispose();promise?.dispose();context.dispose();runtime.dispose();
  }
}
