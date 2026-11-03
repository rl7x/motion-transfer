import { spawn } from 'node:child_process';
import { readFile, writeFile, rename, mkdir, chmod } from 'node:fs/promises';
import { parseJobText } from '../src/hosting/protocol.mjs';
import { profileFor, WORKER_ENV } from '../src/hosting/isolation.mjs';
import { STDOUT_LIMIT } from '../src/hosting/constants.mjs';
import { readOutput } from '../src/hosting/broker.mjs';

const job=parseJobText(await readFile('/tmp/motion-job.json','utf8'));
const profile=profileFor(job.operation);
await mkdir('/output',{recursive:true});await chmod('/output',0o777);
const execution=await new Promise(resolve=>{
 const child=spawn('sudo',['-n','runuser','-u','verifier','--','env','-i',...WORKER_ENV,'node','/app/src/hosting/worker.mjs'],{stdio:['pipe','pipe','pipe'],detached:true});
 const out=[],err=[];let size=0,terminated=false;
 const kill=()=>{terminated=true;try{process.kill(-child.pid,'SIGKILL');}catch{}};
 const timer=setTimeout(kill,profile.timeoutMs);
 child.stdout.on('data',chunk=>{size+=chunk.length;if(size>STDOUT_LIMIT)kill();else out.push(chunk);});
 child.stderr.on('data',chunk=>{if(err.length<4)err.push(chunk);});
 child.stdin.on('error',()=>{});child.on('error',()=>{clearTimeout(timer);resolve({code:1,stdout:'',terminated:true});});
 child.on('close',code=>{clearTimeout(timer);resolve({code,stdout:Buffer.concat(out).toString('utf8'),terminated});});
 child.stdin.end(JSON.stringify(job));
});
let payload;
try {
 const result=JSON.parse(execution.stdout);
 const frame=job.operation.startsWith('verify-')?await readOutput('/output',execution.stdout,result):null;
 payload={ok:execution.code===0&&result.ok===true,terminated:execution.terminated,result,frame:frame?.toString('base64')??null,
   isolation:{kind:'vercel-microvm',network:'deny-all',uid:10001,timeoutMs:profile.timeoutMs}};
} catch {payload={ok:false,terminated:execution.terminated,error:'Isolated verifier did not return a valid bounded result'};}
await writeFile('/tmp/motion-result.json.tmp',JSON.stringify(payload));
await rename('/tmp/motion-result.json.tmp','/tmp/motion-result.json');
