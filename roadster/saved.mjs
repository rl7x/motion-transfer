import assert from 'node:assert/strict';
import { readFile,mkdir,writeFile,rename } from 'node:fs/promises';
import { digest } from '../component/build.mjs';
import { buildRoadsterFrame } from './build.mjs';
import { validateRoadsterIntent } from './port.mjs';

const root=new URL('../transfers/roadster/',import.meta.url);
export async function validateRoadsterArtifact(artifact){
  validateRoadsterIntent(artifact.intent);
  const frame=await buildRoadsterFrame({source:artifact.files['adapter.ts'],intent:artifact.intent});
  assert.equal(artifact.componentId,frame.componentId);assert.equal(artifact.recipientRevision,frame.recipient.manifest.revision);
  assert.deepEqual(artifact.environment,frame.environment,'Roadster environment is stale; rerun verification');
  const verification=JSON.parse(artifact.files['verification.json']),generation=JSON.parse(artifact.files['generation.json']);
  assert.equal(verification.passed,true);assert.equal(generation.status,'verified');assert.equal(generation.model,'muse-spark-1.3');assert.equal(generation.submission.source,artifact.files['adapter.ts']);assert.deepEqual(generation.submission.intent,artifact.intent);
  for(const report of [verification.conformance,verification.browser]){
    assert.equal(report.passed,true);assert.equal(report.componentId,artifact.componentId);assert.equal(report.sourceSha256,digest(artifact.files['adapter.ts']));assert.deepEqual(report.intent,artifact.intent);assert.ok(report.results.every(result=>result.passed));
  }
  assert.equal(verification.browser.results.length,7);assert.equal(verification.conformance.results.length,8);
  assert.equal(verification.browser.frameSha256,digest(artifact.files['frame.html']));assert.equal(artifact.files['frame.html'],frame.html);
  return artifact;
}
export async function loadSavedRoadster({optional=false}={}){
  let current;try{current=JSON.parse(await readFile(new URL('current.json',root),'utf8'));}catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
  if(!/^[a-f0-9]{64}$/.test(current.id))throw Error('Invalid saved Roadster ID');
  const base=new URL('versions/'+current.id+'/',root),record=JSON.parse(await readFile(new URL('manifest.json',base),'utf8'));
  const {id,...manifest}=record;assert.equal(id,current.id);assert.equal(digest(JSON.stringify(manifest)),id);
  if(Object.keys(manifest.files).sort().join(',')!=='adapter.js,adapter.ts,frame.html,generation.json,notices.txt,verification.json')throw Error('Invalid saved Roadster files');
  const files={};for(const [name,hash]of Object.entries(manifest.files)){files[name]=await readFile(new URL(name,base),'utf8');assert.equal(digest(files[name]),hash);}
  return validateRoadsterArtifact({...record,files});
}
export async function saveRoadsterArtifact(artifact){
  await validateRoadsterArtifact(artifact);const directory=new URL('versions/'+artifact.id+'/',root);await mkdir(directory,{recursive:true});
  const {files,...metadata}=artifact;const manifest={...metadata,files:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,digest(bytes)]))};
  for(const [name,bytes]of Object.entries(files))await writeFile(new URL(name,directory),bytes);
  await writeFile(new URL('manifest.json',directory),JSON.stringify(manifest,null,2)+'\n');
  await writeFile(new URL('current.json.tmp',root),JSON.stringify({id:artifact.id},null,2)+'\n');await rename(new URL('current.json.tmp',root),new URL('current.json',root));
}
