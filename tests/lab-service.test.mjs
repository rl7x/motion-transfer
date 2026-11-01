import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLabService } from '../lab/service.mjs';
const request={questionId:'held',idempotencyKey:'lab-test-request'};
async function fixture(t,options={}){const directory=await mkdtemp(join(tmpdir(),'motion-lab-'));const service=await createLabService({directory,client:{},...options});t.after(async()=>{await service.close();await rm(directory,{recursive:true,force:true});});return{service,directory};}
async function done(service,id){for(let i=0;i<100;i++){const job=await service.run(id);if(['ready','failed'].includes(job.status))return job;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Job did not finish');}
test('lab jobs persist measured progress, idempotency and settled spend',async t=>{
  let calls=0;const {service}=await fixture(t,{investigateRun:async({onUpdate,model,limits})=>{calls++;assert.equal(model,'muse-spark-1.3');assert.equal(limits.maxCostUsd,.5);const report={status:'completed',estimatedCostUsd:.02,reservedCostUsd:0,toolCalls:[],conclusionVerified:false};await onUpdate(report);return report;}});
  const first=await service.submit('investigation',request);assert.equal((await done(service,first.id)).status,'ready');
  assert.equal((await service.submit('investigation',request)).id,first.id);assert.equal(calls,1);assert.equal(service.status().budget.spentUsd,.02);
  await assert.rejects(service.submit('investigation',{...request,questionId:'neutral'}),/different input/);
});
test('uncertain lab billing survives restart and blocks new requests',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'motion-lab-restart-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  let service=await createLabService({directory,client:{},investigateRun:async({onUpdate})=>{await onUpdate({estimatedCostUsd:0,reservedCostUsd:.1});throw Error('unknown billing');}});
  const first=await service.submit('investigation',request);assert.equal((await done(service,first.id)).status,'failed');await service.close();
  service=await createLabService({directory,client:{}});try{assert.equal(service.status().budget.reservedUsd,.1);await assert.rejects(service.submit('investigation',{...request,idempotencyKey:'new-request-key'}),/billing is uncertain/);}finally{await service.close();}
});
test('lab serializes paid tasks and preserves the ten dollar ceiling',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});const {service}=await fixture(t,{investigateRun:async()=>{await gate;return{status:'completed',estimatedCostUsd:0,reservedCostUsd:0};}});
  const first=await service.submit('investigation',request);await assert.rejects(service.submit('investigation',{...request,idempotencyKey:'another-request-key'}),/already running/);release();await done(service,first.id);
  await assert.rejects(createLabService({directory:'/unused',budgetUsd:11}),/Invalid lab budget/);
});
test('lab reports redact credentials and reject unsupported requests',async t=>{
  const {service}=await fixture(t,{apiKey:'test-private-credential',investigateRun:async()=>{throw Error('test-private-credential failed');}});
  await assert.rejects(service.submit('investigation',{...request,extra:1}),/Invalid lab request/);
  const job=await service.submit('investigation',request);assert.doesNotMatch(JSON.stringify(await done(service,job.id)),/test-private-credential/);
});
