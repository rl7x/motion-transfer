import assert from 'node:assert/strict';
import test from 'node:test';
import wabtFactory from 'wabt';
import {createInvestigationSession} from '../runtime/investigation-session.mjs';
import {createCartridgeTools} from '../agent/tools.mjs';

async function fixture(){
  const wabt=await wabtFactory();
  const module=wabt.parseWat('private-state.wat',`(module
    (import "env" "memory" (memory 1 1))
    (import "env" "diskw" (func $diskw (param i32 i32) (result i32)))
    (global $private (mut i32) (i32.const 7))
    (func (export "update")
      global.get $private i32.const 3 i32.add global.set $private
      i32.const 4096 global.get $private i32.store
      i32.const 4096 i32.const 4 call $diskw drop))`);
  try{return module.toBinary({}).buffer;}finally{module.destroy();}
}
const steps=(branchId,buttons=0,frames=3)=>({branchId,hypothesis:'Controlled replay of hidden and host state.',watches:[],steps:[{buttons,frames,checkpoint:'after'}]});

test('checkpoint replay reconstructs private mutable globals and host storage, including after interruption',async()=>{
  const bytes=await fixture(),session=await createInvestigationSession(bytes);
  await session.execute('session_advance',steps('main'));
  const cp=(await session.execute('checkpoint_state',{branchId:'main',label:'private state and disk'})).result;
  const restored=(await session.execute('fork_checkpoint',{branchId:'control',checkpointId:cp.checkpointId,watches:[]})).result;
  assert.equal(restored.restorationVerified,true);assert.equal(restored.storage.bytes,4);
  const original=(await session.execute('session_advance',steps('main',32,2))).result.checkpoints[0];
  const fork=(await session.execute('session_advance',steps('control',32,2))).result.checkpoints[0];
  assert.equal(original.memoryHash,fork.memoryHash);assert.equal(original.storage.hash,fork.storage.hash);
  const saved=JSON.parse(JSON.stringify(session.snapshot()));
  const reopened=await createInvestigationSession(bytes,saved);
  assert.equal(reopened.id,session.id);
  const next=(await reopened.execute('session_advance',steps('control',0,1))).result.checkpoints[0];
  assert.notEqual(next.memoryHash,fork.memoryHash);
  const expected=(await session.execute('session_advance',steps('control',0,1))).result.checkpoints[0];
  assert.equal(next.memoryHash,expected.memoryHash);assert.equal(next.storage.hash,expected.storage.hash);
  const bad=structuredClone(saved);bad.branches[0].verification.memoryHash='0'.repeat(64);
  await assert.rejects(createInvestigationSession(bytes,bad),/hash mismatch/);
  const wrong=structuredClone(saved);wrong.identity.cartridgeSha256='0'.repeat(64);
  await assert.rejects(createInvestigationSession(bytes,wrong),/identity mismatch/);
});

test('a worker journal can restore a real cartridge and keep experimental branches isolated',async()=>{
  let tools=createCartridgeTools();let saved,checkpoint;
  try{
    await tools.open();await tools.run('session_advance',steps('main',1,2));
    checkpoint=(await tools.run('checkpoint_state',{branchId:'main',label:'entered gameplay'})).result;
    await tools.run('fork_checkpoint',{branchId:'left',checkpointId:checkpoint.checkpointId,watches:[]});
    await tools.run('session_advance',steps('left',16,5));
    const main=(await tools.run('session_observe',{branchId:'main',watches:[]})).result;
    assert.equal(main.frame,2);assert.equal(main.memoryHash,checkpoint.verification.memoryHash);
    saved=JSON.parse(JSON.stringify(tools.sessionState));
  }finally{await tools.close();}
  tools=createCartridgeTools();
  try{
    assert.equal((await tools.open(saved)).result.restored,true);
    const state=(await tools.run('session_observe',{branchId:'left',watches:[]})).result;
    assert.equal(state.frame,7);assert.equal(state.sessionId,saved.id);
    await assert.rejects(tools.run('$open',{}),/Unknown tool/);
  }finally{await tools.close();}
});
