import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRemixService } from '../remix/service.mjs';
import { createPreviewServer } from '../web/server.mjs';
import { digest } from '../component/build.mjs';
import { REMIX_BROWSER_CHECKS } from '../evaluator/remix-browser.mjs';
import { remixFixture } from './helpers/remix-fixture.mjs';

const browserFixture=async(compiled,intent,html)=>({schemaVersion:1,gate:'remix-browser',passed:true,
  sourceSha256:compiled.sourceSha256,javascriptSha256:compiled.javascriptSha256,componentId:compiled.componentId,
  frameSha256:digest(html),intent,results:REMIX_BROWSER_CHECKS.map(name=>({name,passed:true,testFixture:true}))});
const wait=async(service,id)=>{
  for(let index=0;index<250;index++){
    const job=await service.run(id);if(['ready','failed'].includes(job.status))return job;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw Error('Test job did not finish');
};
function generatorFixture(onCall=()=>{}) {
  return async({parent,onUpdate})=>{
    onCall(parent);
    const intent={...parent.intent,activation:'press',direction:'opposite',unitScale:parent.intent.unitScale+0.25};
    const submission={status:'supported',source:remixFixture(intent),intent,summary:'Test-only inherited remix'};
    const report={schemaVersion:1,model:'test-only',parentArtifactId:parent.id,status:'generating',estimatedCostUsd:0,reservedCostUsd:0.02};
    await onUpdate(report);report.estimatedCostUsd=0.004;report.reservedCostUsd=0;report.status='submitted';report.submission=submission;
    await onUpdate(report);return{report,submission};
  };
}

test('remix jobs persist idempotency, child lineage, budget and immutable bytes across restart',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'remix-service-'));
  const parents=[];let calls=0,service;
  const generate=generatorFixture(parent=>{calls++;parents.push(parent);});
  try{
    service=await createRemixService({directory,client:{},generate,verifyBrowser:browserFixture});
    const versions=await readdir(new URL('../transfers/paku-paku/versions/',import.meta.url));
    const historical=versions.find(id=>id!==service.status().baseArtifactId);
    assert.ok(historical);assert.equal((await service.artifact(historical)).id,historical);
    const request={parentArtifactId:historical,prompt:'Test-only backward press remix',idempotencyKey:randomUUID()};
    const first=await service.submit(request),ready=await wait(service,first.id);
    assert.equal(ready.status,'ready',ready.error);assert.equal(calls,1);
    assert.equal((await service.submit(request)).id,first.id);assert.equal(calls,1);
    assert.ok(Math.abs(service.status().budget.spentUsd-0.004)<1e-9);
    const artifact=await service.artifact(ready.artifactId);
    assert.equal(artifact.parentArtifactId,request.parentArtifactId);assert.equal(artifact.intent.activation,'press');
    const second=await service.submit({parentArtifactId:artifact.id,prompt:'Test-only longer dash',idempotencyKey:randomUUID()});
    const next=await wait(service,second.id);assert.equal(next.status,'ready',next.error);
    assert.equal(parents[1].intent.direction,'opposite');assert.equal(parents[1].intent.activation,'press');
    const nextArtifact=await service.artifact(next.artifactId);assert.equal(nextArtifact.parentArtifactId,artifact.id);
    assert.equal(nextArtifact.intent.unitScale,1);
    await service.close();service=null;
    service=await createRemixService({directory,client:{},generate,verifyBrowser:browserFixture});
    assert.equal((await service.submit(request)).id,first.id);assert.equal(calls,2);
    assert.ok(Math.abs(service.status().budget.spentUsd-0.008)<1e-9);
    assert.equal((await service.artifact(artifact.id)).source,artifact.source);
    await writeFile(join(directory,'artifacts',artifact.id,'adapter.js'),artifact.javascript+'\n// changed');
    await assert.rejects(service.artifact(artifact.id),/integrity mismatch/);
  }finally{await service?.close();await rm(directory,{recursive:true,force:true});}
});

test('an interrupted or ambiguous job retains its reservation and cannot silently reset the budget',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'remix-uncertain-'));let service,calls=0;
  try{
    service=await createRemixService({directory,client:{},generate:async({onUpdate})=>{
      calls++;const report={estimatedCostUsd:0,reservedCostUsd:0.02,status:'failed',requests:[{status:'unsettled'}]};
      await onUpdate(report);const error=Error('Uncertain transport');error.report=report;throw error;
    }});
    const request={parentArtifactId:service.status().baseArtifactId,prompt:'Test-only request',idempotencyKey:randomUUID()};
    const job=await service.submit(request);assert.equal((await wait(service,job.id)).status,'failed');
    assert.equal(service.status().budget.reservedUsd,0.02);
    await assert.rejects(service.submit({...request,idempotencyKey:randomUUID()}),/uncertain billing/);
    await service.close();service=null;
    const path=join(directory,'jobs',job.id+'.json'),saved=JSON.parse(await readFile(path,'utf8'));
    saved.status='generating';await writeFile(path,JSON.stringify(saved));
    service=await createRemixService({directory,client:{}});
    assert.equal(service.status().budget.reservedUsd,0.02);assert.equal((await service.run(job.id)).status,'failed');
    await assert.rejects(service.submit({...request,idempotencyKey:randomUUID()}),/uncertain billing/);assert.equal(calls,1);
    await assert.rejects(createRemixService({directory,client:{}}),/Another preview/);
  }finally{await service?.close();await rm(directory,{recursive:true,force:true});}
});

test('the HTTP boundary rejects cross-origin paid requests and exposes actual run state',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'remix-http-'));let service,server;
  try{
    service=await createRemixService({directory,client:{},generate:generatorFixture(),verifyBrowser:browserFixture});
    server=await createPreviewServer({remixes:service});
    const body=JSON.stringify({parentArtifactId:service.status().baseArtifactId,prompt:'Test-only mapping',idempotencyKey:randomUUID()});
    const post=origin=>fetch(server.origin+'/api/remixes',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body});
    assert.equal((await post('https://untrusted.example')).status,403);
    assert.equal(service.status().budget.spentUsd,0);
    const response=await post(server.origin);assert.equal(response.status,202);
    const job=await response.json();const ready=await wait(service,job.id);assert.equal(ready.status,'ready',ready.error);
    assert.equal((await(await fetch(server.origin+'/api/runs/'+job.id)).json()).status,'ready');
    assert.equal((await fetch(server.origin+'/play/'+ready.artifactId)).status,200);
    const frameResponse=await fetch(server.origin+'/artifacts/'+ready.artifactId+'/play.html');
    assert.equal(frameResponse.headers.get('content-security-policy'),'sandbox allow-scripts');
    assert.match(await frameResponse.text(),/connect-src 'none'/);
    const source=await(await fetch(server.origin+'/api/artifacts/'+ready.artifactId+'/source')).json();
    assert.equal(source.parentArtifactId,service.status().baseArtifactId);assert.match(source.notices,/ABA Games/);
    assert.equal((await fetch(server.origin+'/.env')).status,404);
  }finally{await server?.close();await service?.close();await rm(directory,{recursive:true,force:true});}
});
