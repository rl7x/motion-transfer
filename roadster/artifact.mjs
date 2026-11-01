import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from '../component/build.mjs';

export const ROADSTER_FILES=Object.freeze(['adapter.js','adapter.ts','frame.html','generation.json','notices.txt','verification.json']);
export const artifactId=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export async function readRoadsterArtifact(directory,id){
  if(!artifactId(id))throw Error('Invalid Roadster artifact ID');
  const root=join(directory,id),record=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
  const {id:claimed,...manifest}=record;
  assert.equal(claimed,id,'Roadster artifact identity mismatch');assert.equal(digest(JSON.stringify(manifest)),id,'Roadster artifact identity mismatch');
  assert.deepEqual(Object.keys(record.files).sort(),[...ROADSTER_FILES],'Invalid Roadster artifact files');
  const files={};
  for(const name of ROADSTER_FILES){const bytes=await readFile(join(root,name),'utf8');assert.equal(digest(bytes),record.files[name],'Roadster artifact integrity mismatch: '+name);files[name]=bytes;}
  return{...record,files};
}
