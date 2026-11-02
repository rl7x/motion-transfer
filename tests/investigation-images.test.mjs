import assert from 'node:assert/strict';
import test from 'node:test';
import {inflateSync} from 'node:zlib';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {framebufferPng} from '../runtime/png.mjs';
import {createCartridgeTools} from '../agent/tools.mjs';
import {saveInvestigationEvidence} from '../lab/investigation-evidence.mjs';
import {digest} from '../component/build.mjs';

test('PNG pixels decode from the real packed framebuffer and palette',()=>{
  const pixels=new Uint8Array(6400);pixels[0]=0b11100100;
  const png=framebufferPng(pixels,[0xff0000,0x00ff00,0x0000ff,0xffffff]);
  assert.equal(png.subarray(1,4).toString(),'PNG');
  let offset=8;const compressed=[];
  while(offset<png.length){const size=png.readUInt32BE(offset),kind=png.subarray(offset+4,offset+8).toString();if(kind==='IDAT')compressed.push(png.subarray(offset+8,offset+8+size));offset+=12+size;}
  assert.deepEqual([...inflateSync(Buffer.concat(compressed)).subarray(1,13)],[255,0,0,0,255,0,0,0,255,255,255,255]);
});

test('selective captures retain hashes and session identity and persist as PNG evidence',async()=>{
  const tools=createCartridgeTools(),directory=await mkdtemp(join(tmpdir(),'investigation-images-'));
  try{
    await tools.open();await tools.run('session_advance',{branchId:'main',hypothesis:'Capture actual gameplay.',watches:[],steps:[{buttons:1,frames:2,checkpoint:'gameplay'}]});
    const capture=await tools.run('capture_frame',{branchId:'main',reason:'Inspect the gameplay frame before perturbation.'});
    assert.equal(capture.result.frame,2);assert.equal(capture.images[0].sessionId,tools.sessionState.id);
    const bytes=Buffer.from(capture.images[0].dataUrl.split(',')[1],'base64');assert.equal(digest(bytes),capture.result.pngSha256);
    await saveInvestigationEvidence(directory,tools.sessionState);
    assert.deepEqual(await readFile(join(directory,'sessions',tools.sessionState.id,capture.result.pngSha256+'.png')),bytes);
    for(let i=0;i<3;i++)await tools.run('capture_frame',{branchId:'main',reason:'Bounded capture fixture.'});
    await assert.rejects(tools.run('capture_frame',{branchId:'main',reason:'Exceeds image cap.'}),/image budget/);
  }finally{await tools.close();await rm(directory,{recursive:true,force:true});}
});
