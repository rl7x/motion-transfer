import { mkdir,readFile,readdir,rename,rm,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from '../component/build.mjs';

export const artifactId=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export async function createLabStore(directory){
  await mkdir(join(directory,'jobs'),{recursive:true});await mkdir(join(directory,'artifacts'),{recursive:true});
  const lock=join(directory,'.lock');
  try{await mkdir(lock);}catch(error){
    if(error.code!=='EEXIST')throw error;
    const pid=Number(await readFile(join(lock,'pid'),'utf8'));
    if(!Number.isSafeInteger(pid)||pid<1)throw Error('Invalid lab journal lock');
    try{process.kill(pid,0);throw Error('Another server owns the lab journal');}catch(failure){if(failure.code!=='ESRCH')throw failure;}
    await rm(lock,{recursive:true});await mkdir(lock);
  }
  await writeFile(join(lock,'pid'),String(process.pid));
  const json=async path=>JSON.parse(await readFile(path,'utf8'));
  const pathFor=id=>{if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid lab run ID');return join(directory,'jobs',id+'.json');};
  return{
    async close(){await rm(lock,{recursive:true});},
    async jobs(){return Promise.all((await readdir(join(directory,'jobs'))).filter(name=>name.endsWith('.json')).map(name=>json(pathFor(name.slice(0,-5)))));},
    async writeJob(job){const path=pathFor(job.id),temporary=path+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(job,null,2)+'\n',{mode:0o600});await rename(temporary,path);},
    async publish(files,metadata){
      if(Object.keys(files).sort().join(',')!=='adapter.js,adapter.ts,frame.html,generation.json,notices.txt,verification.json')throw Error('Invalid Roadster artifact files');
      const manifest={schemaVersion:1,...metadata,files:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,digest(bytes)]))};
      const id=digest(JSON.stringify(manifest)),target=join(directory,'artifacts',id),temporary=target+'.'+randomUUID()+'.tmp';
      await mkdir(temporary);
      try{for(const [name,bytes]of Object.entries(files))await writeFile(join(temporary,name),bytes);await writeFile(join(temporary,'manifest.json'),JSON.stringify({...manifest,id},null,2)+'\n');await rename(temporary,target);}
      catch(error){await rm(temporary,{recursive:true,force:true});throw error;}
      return this.artifact(id);
    },
    async artifact(id){
      if(!artifactId(id))throw Error('Invalid Roadster artifact ID');
      const root=join(directory,'artifacts',id),record=await json(join(root,'manifest.json'));
      const {id:claimed,...manifest}=record;
      if(claimed!==id||digest(JSON.stringify(manifest))!==id)throw Error('Roadster artifact identity mismatch');
      if(Object.keys(record.files).sort().join(',')!=='adapter.js,adapter.ts,frame.html,generation.json,notices.txt,verification.json')throw Error('Invalid Roadster artifact files');
      const files={};for(const [name,hash]of Object.entries(record.files)){const bytes=await readFile(join(root,name),'utf8');if(digest(bytes)!==hash)throw Error('Roadster artifact integrity mismatch: '+name);files[name]=bytes;}
      return{...record,files};
    },
  };
}
