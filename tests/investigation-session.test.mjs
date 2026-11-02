import assert from 'node:assert/strict';
import test from 'node:test';
import {createCartridgeTools} from '../agent/tools.mjs';

const advance=(buttons,frames=1)=>({branchId:'main',hypothesis:'Observe an actual input transition.',watches:[],steps:[{buttons,frames,checkpoint:'observed'}]});
test('an isolated investigation worker preserves live cartridge state between commands',async()=>{
  const tools=createCartridgeTools();
  try{
    const pid=tools.pid;
    const first=(await tools.run('session_advance',advance(1,2))).result;
    const next=(await tools.run('session_advance',advance(32,10))).result;
    const observed=(await tools.run('session_observe',{branchId:'main',watches:[{name:'input',address:0x16,type:'u8',count:1}]})).result;
    assert.equal(tools.pid,pid);assert.equal(first.sessionId,next.sessionId);
    assert.equal(observed.frame,12);assert.equal(observed.memory[0].values[0],32);
    assert.equal(observed.memoryHash,next.checkpoints[0].memoryHash);
    const reset=(await tools.run('session_reset',{branchId:'main',watches:[]})).result;
    assert.equal(reset.frame,0);assert.equal(reset.storage.bytes,0);
    assert.notEqual(reset.memoryHash,observed.memoryHash);
  }finally{await tools.close();}
  assert.throws(()=>process.kill(tools.pid,0),error=>error.code==='ESRCH');
});

test('bad commands leave the persistent worker available and deadlines stop it',async()=>{
  const tools=createCartridgeTools();
  try{
    await assert.rejects(tools.run('session_observe',{branchId:'missing',watches:[]}),/Unknown investigation branch/);
    assert.equal((await tools.run('session_observe',{branchId:'main',watches:[]})).result.frame,0);
    await assert.rejects(tools.run('session_advance',{...advance(32),path:'.env'}),/only these fields/);
  }finally{await tools.close();}
  const limited=createCartridgeTools({timeoutMs:1});
  try{await assert.rejects(limited.run('session_observe',{branchId:'main',watches:[]}),/time limit/);}
  finally{await limited.close();}
});
