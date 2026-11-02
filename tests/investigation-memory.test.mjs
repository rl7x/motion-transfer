import assert from 'node:assert/strict';
import test from 'node:test';
import wabtFactory from 'wabt';
import {createInvestigationSession} from '../runtime/investigation-session.mjs';
import {writeMemoryValue} from '../runtime/memory.mjs';
import {loadTarget} from '../agent/target.mjs';
import {createReplayRuntime} from '../runtime/replay.mjs';
import {observeDonorMotion} from '../runtime/donor-observation.mjs';

async function fixture(){
  const wabt=await wabtFactory();
  const module=wabt.parseWat('memory-experiment.wat',`(module
    (import "env" "memory" (memory 1 1))
    (func (export "update")
      i32.const 8192 i32.const 8192 i32.load i32.const 8196 i32.load i32.add i32.store))`);
  try{return module.toBinary({}).buffer;}finally{module.destroy();}
}
test('typed edits and identical-input comparisons record actual consequences without altering the control',async()=>{
  const bytes=await fixture(),session=await createInvestigationSession(bytes);
  const checkpoint=(await session.execute('checkpoint_state',{branchId:'main',label:'before motion'})).result.checkpointId;
  for(const branchId of ['control','variant'])await session.execute('fork_checkpoint',{branchId,checkpointId:checkpoint,watches:[]});
  const edit=(await session.execute('write_memory',{branchId:'variant',edits:[{address:8196,type:'i32',value:3,hypothesis:'This field adds three units per update.'}],watches:[]})).result;
  assert.equal(edit.edits[0].previousValue,0);assert.equal(edit.edits[0].newValue,3);assert.equal(edit.edits[0].frame,0);
  const args={controlBranchId:'control',experimentalBranchId:'variant',hypothesis:'Only the mutated branch should accumulate position.',watches:[{name:'candidate position',address:8192,type:'i32',count:2}],steps:[{buttons:32,frames:4,checkpoint:'same-input'}]};
  const result=(await session.execute('compare_branches',args)).result;
  assert.equal(result.firstDivergence.elapsedFrame,1);
  const point=result.checkpoints[0];
  assert.equal(point.control.frame,point.experimental.frame);
  assert.deepEqual(point.control.memory[0].values,[0,0]);assert.deepEqual(point.experimental.memory[0].values,[12,3]);
  const diff=(await session.execute('diff_memory',{fromObservationId:point.control.observationId,toObservationId:point.experimental.observationId,range:{address:8192,byteLength:8,type:'i32'}})).result.difference;
  assert.equal(diff.changedValues,2);assert.equal(diff.changes[0].address,8192);assert.equal(diff.changes[0].newValue,12);
  const reopened=await createInvestigationSession(bytes,JSON.parse(JSON.stringify(session.snapshot())));
  assert.equal((await reopened.execute('session_observe',{branchId:'variant',watches:args.watches})).result.memory[0].values[0],12);
  assert.equal((await session.execute('session_observe',{branchId:'main',watches:args.watches})).result.memory[0].values[0],0);
  await assert.rejects(session.execute('write_memory',{branchId:'main',edits:[{address:8196,type:'i32',value:3,hypothesis:'Forbidden original edit.'}],watches:[]}),/only in checkpoint branches/);
});

test('invalid writes are rejected before mutation and traps can be replayed then reset',async()=>{
  const buffer=new ArrayBuffer(65536);
  for(const edit of [{address:65535,type:'i32',value:1},{address:0,type:'u8',value:256},{address:0,type:'i16',value:1.5},{address:0,type:'f32',value:Infinity},{address:0,type:'f32',value:1e99}])assert.throws(()=>writeMemoryValue(buffer,edit));
  assert.deepEqual([...new Uint8Array(buffer).slice(0,8)],[0,0,0,0,0,0,0,0]);
  assert.equal(writeMemoryValue(buffer,{address:0,type:'f32',value:1/3}).newValue,Math.fround(1/3));
  const wabt=await wabtFactory(),module=wabt.parseWat('trap.wat','(module (import "env" "memory" (memory 1 1)) (func (export "update") unreachable))');
  const bytes=module.toBinary({}).buffer;module.destroy();const session=await createInvestigationSession(bytes);
  await assert.rejects(session.execute('session_advance',{branchId:'main',hypothesis:'Check trap persistence.',watches:[],steps:[{buttons:0,frames:1,checkpoint:'trap'}]}),/update failed/);
  const reopened=await createInvestigationSession(bytes,session.snapshot());
  await assert.rejects(reopened.execute('checkpoint_state',{branchId:'main',label:'faulted'}),/faulted/);
  await reopened.execute('session_reset',{branchId:'main',watches:[]});
  assert.equal(reopened.snapshot().branches[0].verification.faulted,false);
});

test('an actual donor timer perturbation changes the next dash under identical inputs',async()=>{
  const {bytes}=await loadTarget(),runtime=await createReplayRuntime(bytes);runtime.step(1,2);
  // Test setup uses the existing human mapping. This is not an agent discovery.
  const address=observeDonorMotion(runtime).pointers.dash+42;
  const session=await createInvestigationSession(bytes);
  await session.execute('session_advance',{branchId:'main',hypothesis:'Reach the same gameplay state.',watches:[],steps:[{buttons:1,frames:2,checkpoint:'gameplay'}]});
  const checkpointId=(await session.execute('checkpoint_state',{branchId:'main',label:'initial recharge'})).result.checkpointId;
  for(const branchId of ['control','variant'])await session.execute('fork_checkpoint',{branchId,checkpointId,watches:[]});
  await session.execute('write_memory',{branchId:'variant',edits:[{address,type:'i16',value:0,hypothesis:'Removing the candidate recharge field may permit an earlier dash.'}],watches:[]});
  const result=(await session.execute('compare_branches',{controlBranchId:'control',experimentalBranchId:'variant',hypothesis:'Test the timer intervention against an unchanged control.',watches:[],steps:[{buttons:33,frames:5,checkpoint:'first-five-updates'}]})).result;
  const point=result.checkpoints[0];
  assert.equal(point.control.motion.remaining,0);assert.ok(point.experimental.motion.remaining>0);
  assert.ok(point.experimental.motion.position.x-point.control.motion.position.x>20);
  assert.equal((await session.execute('session_observe',{branchId:'main',watches:[]})).result.frame,2);
  const restored=await createInvestigationSession(bytes,session.snapshot());
  assert.equal((await restored.execute('session_observe',{branchId:'variant',watches:[]})).result.memoryHash,point.experimental.memoryHash);
});
