import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {digest} from '../component/build.mjs';
import {loadTarget} from '../agent/target.mjs';

export async function savedInvestigations(){
  const root=new URL('./recordings/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
  const target=await loadTarget(),records=[];
  assert.equal(manifest.schemaVersion,1);
  for(const record of manifest.records){
    if(!/^[a-z-]+$/.test(record.id)||record.file!==record.id+'.json')throw Error('Invalid recorded investigation path');
    const bytes=await readFile(new URL(record.file,root));assert.equal(digest(bytes),record.sha256);
    const job=JSON.parse(bytes);assert.equal(job.id,record.runId);assert.ok(['ready','failed'].includes(job.status));
    if(job.status==='ready')assert.equal(job.report.status,'completed');else assert.ok(['failed','timed_out'].includes(job.report.status));
    assert.equal(job.report.model,'muse-spark-1.3');assert.equal(job.report.target.sha256,target.sha256);assert.equal(job.report.conclusionVerified,false);
    assert.equal(job.report.reservedCostUsd,0);assert.ok(job.report.requests.every(request=>request.usage&&request.status==='completed'));
    records.push({...record,job});
  }
  return records;
}
