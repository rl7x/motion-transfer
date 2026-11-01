import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLabStore} from '../lab/store.mjs';
import {digest} from '../component/build.mjs';

test('reading and exporting a Roadster artifact preserves its historical manifest identity',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'roadster-export-')),store=await createLabStore(directory);
  try{
    const files={'adapter.ts':'fixture TypeScript','adapter.js':'fixture JavaScript','frame.html':'fixture HTML','verification.json':'{}','generation.json':'{}','notices.txt':'fixture notice'};
    const artifact=await store.publish(files,{kind:'roadster',fixture:true});
    assert.deepEqual(Object.keys(artifact.files),Object.keys(files));
    const {id,files:read,...metadata}=artifact;
    const exported={...metadata,files:Object.fromEntries(Object.entries(read).map(([name,bytes])=>[name,digest(bytes)]))};
    assert.equal(digest(JSON.stringify(exported)),id);
    await writeFile(join(directory,'artifacts',id,'adapter.ts'),'changed fixture');
    await assert.rejects(store.artifact(id),/integrity mismatch/);
  }finally{await store.close();await rm(directory,{recursive:true,force:true});}
});
