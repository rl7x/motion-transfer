import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';

const execute=promisify(execFile),require=createRequire(import.meta.url);
export async function decompileWasm(bytes,{signal}={}){
  const directory=await mkdtemp(join(tmpdir(),'wasm-analysis-'));
  try{
    const path=join(directory,'analysis.wasm');await writeFile(path,bytes);
    const tool=join(dirname(require.resolve('wabt/package.json')),'bin/wasm-decompile');
    const {stdout}=await execute(process.execPath,[tool,path],{env:{PATH:process.env.PATH??''},timeout:10000,maxBuffer:2*1024*1024,signal});
    const lines=stdout.split('\n'),functions=[];
    lines.forEach((line,index)=>{const match=line.match(/^(?:export |import )?function .*\/\/ func(\d+)$/);if(match)functions.push({index:Number(match[1]),start:index});});
    return{lines,functions};
  }finally{await rm(directory,{recursive:true,force:true});}
}
export function decompileFunction(analysis,{functionIndex,startLine,lineCount}){
  const at=analysis.functions.findIndex(fn=>fn.index===functionIndex);
  if(at<0)throw Error('Decompiler did not expose this function');
  const fn=analysis.functions[at],lines=analysis.lines.slice(fn.start,analysis.functions[at+1]?.start??analysis.lines.length);
  if(startLine>lines.length)throw Error('Decompilation line range is outside this function');
  return{functionIndex,evidenceId:`binary:func${functionIndex}`,nameSource:'wabt-generated',notice:'WABT 1.0.39 approximate C-like interpretation, not original source. WAT is authoritative; static memory offsets are not runtime addresses.',totalLines:lines.length,
    lines:lines.slice(startLine-1,startLine-1+lineCount).map((text,index)=>({functionLine:startLine+index,text:text.slice(0,240),truncated:text.length>240})),nextLine:startLine+lineCount<=lines.length?startLine+lineCount:null};
}
