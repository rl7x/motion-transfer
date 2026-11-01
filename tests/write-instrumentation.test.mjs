import assert from 'node:assert/strict';
import test from 'node:test';
import wabtFactory from 'wabt';
import {instrumentMemoryWrites,traceMemoryWriters} from '../agent/write-instrumentation.mjs';
import {createWasmInspection} from '../agent/wasm-inspection.mjs';
import {createReplayRuntime} from '../runtime/replay.mjs';
import {createInvestigationSession} from '../runtime/investigation-session.mjs';
import {loadTarget} from '../agent/target.mjs';
import {observeDonorMotion} from '../runtime/donor-observation.mjs';

test('analysis-copy callbacks preserve direct/indirect calls, store types and effective addresses',async()=>{
  const wabt=await wabtFactory(),module=wabt.parseWat('stores.wat',`(module
    (type $void (func)) (import "env" "memory" (memory 1 1))
    (table 1 funcref) (elem (i32.const 0) $writer)
    (func $writer
      i32.const 8192 i32.const 123 i32.store offset=8
      i32.const 8208 i64.const 4294967297 i64.store
      i32.const 8224 f32.const 1.25 f32.store
      i32.const 8240 f64.const 2.5 f64.store
      i32.const 8256 i32.const 258 i32.store8)
    (func (export "update") i32.const 0 call_indirect (type $void)))`);
  const bytes=module.toBinary({}).buffer;module.destroy();
  const copy=await instrumentMemoryWrites(bytes,await createWasmInspection(bytes)),hits=[];
  const original=await createReplayRuntime(bytes),analysis=await createReplayRuntime(copy.bytes,{onMemoryWrite:hit=>hits.push(hit)});
  for(let i=0;i<4;i++)assert.deepEqual(analysis.step(0),original.step(0));
  assert.equal(hits[0].address,8200);assert.equal(hits[0].width,4);assert.equal(hits[0].functionIndex,0);assert.equal(hits[0].frame,1);
  assert.deepEqual(hits.slice(0,5).map(hit=>hit.width),[4,8,4,8,1]);
  assert.notEqual(copy.manifest.analysisSha256,copy.manifest.originalSha256);
});

test('a selected donor timer range reports actual writer functions with matching original behavior',async()=>{
  const {bytes}=await loadTarget(),runtime=await createReplayRuntime(bytes);runtime.step(1,2);
  const address=observeDonorMotion(runtime).pointers.dash+42;
  const session=await createInvestigationSession(bytes);
  await session.execute('session_advance',{branchId:'main',hypothesis:'Reach gameplay before tracing.',watches:[],steps:[{buttons:1,frames:2,checkpoint:'gameplay'}]});
  const checkpointId=(await session.execute('checkpoint_state',{branchId:'main',label:'timer trace'})).result.checkpointId;
  const result=await traceMemoryWriters(session,await createWasmInspection(bytes),bytes,{checkpointId,address,byteLength:4,steps:[{buttons:33,frames:16,checkpoint:'held dash'}]});
  assert.equal(result.behavioralComparison.passed,true);assert.equal(result.behavioralComparison.framesCompared,16);
  assert.ok(result.matchingWrites>0);assert.ok(result.hits.every(hit=>Number.isInteger(hit.functionIndex)&&hit.functionLine>0));
  assert.match(result.manifest.scope,/No pausing watchpoints/);
  assert.equal(session.snapshot().branches[0].verification.frame,2);
});
