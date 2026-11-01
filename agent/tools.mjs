import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MAX_TOOL_OUTPUT_BYTES, validateToolInput } from './tool-schema.mjs';

const worker = fileURLToPath(new URL('tool-worker.mjs', import.meta.url));

export function createCartridgeTools({signal,timeoutMs=10_000}={}){
  const child=spawn(process.execPath,[worker],{
    env: { PATH: process.env.PATH ?? '', ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}) },
    stdio:['pipe','pipe','pipe'],
  });
  let pending=null,sequence=0,buffer='',closed=false,failure=null,lastState=null,stderrBytes=0;
  child.stdout.setEncoding('utf8');
  function stop(error){failure??=error;closed=true;child.kill('SIGKILL');if(pending){pending.reject(error);pending=null;}}
  const aborted=()=>stop(Error('Cartridge experiment cancelled'));
  signal?.addEventListener('abort',aborted,{once:true});if(signal?.aborted)aborted();
  child.on('error',()=>stop(Error('Cartridge tool process failed')));
  child.stdin.on('error',()=>stop(Error('Cartridge tool input closed')));
  child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>65_536)stop(Error('Cartridge diagnostic output limit exceeded'));});
  child.stdout.on('data',chunk=>{
    buffer+=chunk.toString('utf8');
    if(Buffer.byteLength(buffer)>4*1024*1024){stop(Error('Cartridge worker output limit exceeded'));return;}
    let end;
    while((end=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
      try{
        const response=JSON.parse(line);
        if(!pending||response.id!==pending.id)throw Error('Invalid cartridge worker response');
        if(response.sessionState)lastState=response.sessionState;
        const current=pending;pending=null;
        if(!response.ok){const error=Error(response.error);error.sessionState=lastState;current.reject(error);}
        else if(Buffer.byteLength(JSON.stringify(response.result))>MAX_TOOL_OUTPUT_BYTES)current.reject(Error('Tool output exceeds 32 KB; use fewer checkpoints or a smaller WAT range'));
        else{const {id,ok,...value}=response;current.resolve(value);}
      }catch(error){stop(error);}
    }
  });
  const exited=new Promise(resolve=>child.once('close',()=>{closed=true;signal?.removeEventListener('abort',aborted);if(pending){pending.reject(failure??Error('Cartridge tool process exited'));pending=null;}resolve();}));
  async function request(name,args,{signal:callSignal}={}){
      const input=JSON.stringify({id:++sequence,name,args});
      if(Buffer.byteLength(input)>(name==='$open'?2*1024*1024:32_768))throw Error('Tool request exceeds its input limit');
      if(closed)throw failure??Error('Cartridge worker is closed');
      if(pending)throw Error('Cartridge commands must execute sequentially');
      const cancel=()=>stop(Error('Cartridge experiment cancelled'));
      callSignal?.addEventListener('abort',cancel,{once:true});
      if(callSignal?.aborted){cancel();throw failure;}
      const timer=setTimeout(()=>stop(Error('Cartridge experiment exceeded its time limit')),timeoutMs);
      try{return await new Promise((resolve,reject)=>{pending={id:sequence,resolve,reject};child.stdin.write(input+'\n');});}
      finally{clearTimeout(timer);callSignal?.removeEventListener('abort',cancel);}
  }
  return{
    get pid(){return child.pid;},
    get sessionState(){return lastState;},
    open(sessionState){return request('$open',{sessionState});},
    async run(name,args,options){validateToolInput(name,args);return request(name,args,options);},
    async close(){
      signal?.removeEventListener('abort',aborted);
      if(!closed){closed=true;child.stdin.end();const timer=setTimeout(()=>child.kill('SIGKILL'),500);try{await exited;}finally{clearTimeout(timer);}}
      else await exited;
    },
  };
}

// One-shot callers remain available; an investigation owns one shared client.
export async function runCartridgeTool(name,args,options={}){
  validateToolInput(name,args);
  const tools=createCartridgeTools(options);
  try{return await tools.run(name,args);}finally{await tools.close();}
}
