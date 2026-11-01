import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { digest } from '../component/build.mjs';
import { validateIntent } from './contract.mjs';
import { REMIX_BROWSER_CHECKS } from '../evaluator/remix-browser.mjs';

const artifactFiles = ['adapter.ts','adapter.js','frame.html','evaluation.json','generation.json','notices.txt'];
export const isArtifactId = value => typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

export async function createRemixStore(directory) {
  await mkdir(join(directory,'jobs'),{recursive:true});await mkdir(join(directory,'artifacts'),{recursive:true});
  const lock=join(directory,'.lock');
  try{await mkdir(lock);}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    let owner;
    try{owner=Number(await readFile(join(lock,'pid'),'utf8'));}catch{throw Error('Remix store is locked; another server may be starting');}
    if(!Number.isSafeInteger(owner)||owner<1)throw Error('Invalid remix store lock');
    try{process.kill(owner,0);throw Error('Another preview already owns the remix store');}
    catch(failure){if(failure.code!=='ESRCH')throw failure;}
    await rm(lock,{recursive:true});await mkdir(lock);
  }
  await writeFile(join(lock,'pid'),String(process.pid));
  const json=async path=>JSON.parse(await readFile(path,'utf8'));
  const jobPath=id=>{
    if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid run ID');
    return join(directory,'jobs',id+'.json');
  };
  return {
    async close(){await rm(lock,{recursive:true});},
    async jobs(){
      const files=await readdir(join(directory,'jobs'));
      const jobs=[];
      for(const name of files.filter(name=>name.endsWith('.json')))jobs.push(await json(jobPath(name.slice(0,-5))));
      return jobs;
    },
    async readJob(id){return json(jobPath(id));},
    async writeJob(job){
      const target=jobPath(job.id),temporary=target+'.'+randomUUID()+'.tmp';
      await writeFile(temporary,JSON.stringify(job,null,2)+'\n',{mode:0o600});await rename(temporary,target);
    },
    async publish({parent,intent,summary,source,compiled,html,conformance,browser,generation,notices}){
      validateIntent(intent);
      assert.equal(conformance.passed,true);assert.equal(browser.passed,true);
      assert.equal(conformance.gate,'remix-conformance');assert.equal(conformance.results.length,12);
      assert.ok(conformance.results.every(result=>result.passed));
      assert.equal(browser.gate,'remix-browser');assert.deepEqual(browser.results.map(result=>result.name),REMIX_BROWSER_CHECKS);
      assert.ok(browser.results.every(result=>result.passed));
      for(const report of [conformance,browser]){
        assert.equal(report.sourceSha256,digest(source));assert.equal(report.javascriptSha256,digest(compiled.javascript));
        assert.equal(report.componentId,parent.componentId);assert.deepEqual(report.intent,intent);
      }
      assert.equal(browser.frameSha256,digest(html));assert.equal(generation.parentArtifactId,parent.id);
      assert.equal(generation.submission.source,source);assert.deepEqual(generation.submission.intent,intent);
      const evaluation={scope:'Requested adapter mapping and preserved recipient behavior; frozen component defaults, finite regression inputs',conformance,browser};
      const files={'adapter.ts':source,'adapter.js':compiled.javascript,'frame.html':html,
        'evaluation.json':JSON.stringify(evaluation,null,2)+'\n','generation.json':JSON.stringify(generation,null,2)+'\n','notices.txt':notices};
      const manifest={schemaVersion:1,status:'ready',parentArtifactId:parent.id,baseTransferId:parent.baseTransferId,
        componentId:parent.componentId,recipientRevision:parent.recipientRevision,intent,summary,
        sourceSha256:digest(source),javascriptSha256:digest(compiled.javascript),
        files:Object.fromEntries(Object.entries(files).map(([name,content])=>[name,digest(content)]))};
      const id=digest(JSON.stringify(manifest)),target=join(directory,'artifacts',id),temporary=target+'.'+randomUUID()+'.tmp';
      await mkdir(temporary);
      try{
        for(const [name,content]of Object.entries(files))await writeFile(join(temporary,name),content);
        await writeFile(join(temporary,'manifest.json'),JSON.stringify({...manifest,id},null,2)+'\n');
        await rename(temporary,target);
      }catch(error){await rm(temporary,{recursive:true,force:true});throw error;}
      // Do not return a playable ID until all artifact bytes can be read and checked.
      return this.readArtifact(id);
    },
    async readArtifact(id){
      if(!isArtifactId(id))throw Error('Invalid artifact ID');
      const root=join(directory,'artifacts',id),record=await json(join(root,'manifest.json'));
      const {id:claimed,...manifest}=record;
      assert.equal(claimed,id);assert.equal(digest(JSON.stringify(manifest)),id,'Artifact manifest integrity mismatch');
      assert.equal(record.status,'ready');validateIntent(record.intent);
      assert.deepEqual(Object.keys(record.files).sort(),[...artifactFiles].sort());
      const files={};
      for(const name of artifactFiles){files[name]=await readFile(join(root,name),'utf8');assert.equal(digest(files[name]),record.files[name],`Artifact integrity mismatch: ${name}`);}
      return {...record,source:files['adapter.ts'],javascript:files['adapter.js'],html:files['frame.html'],
        evaluation:JSON.parse(files['evaluation.json']),generation:JSON.parse(files['generation.json']),notices:files['notices.txt']};
    },
  };
}
