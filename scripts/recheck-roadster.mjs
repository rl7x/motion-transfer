import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createLabStore} from '../src/lab/store.mjs';
import {verifyRoadsterSubmission} from '../src/agent/transfer-roadster.mjs';
import {saveRoadsterArtifact} from '../src/roadster/saved.mjs';

try{
  const id=process.argv[2];if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Usage: node scripts/recheck-roadster.mjs <run-id> [--save]');
  const root=resolve('reports/lab'),store=await createLabStore(root);
  try{
    const job=(await store.jobs()).find(job=>job.id===id);if(!job||job.kind!=='roadster')throw Error('Roadster run not found');
    await writeFile(resolve(root,'jobs',id+'.before-local-recheck.json.backup'),JSON.stringify(job,null,2)+'\n');
    const report=job.report;report.previousErrors??=[];if(report.error)report.previousErrors.push(report.error);delete report.error;
    const parent=job.request.parentArtifactId==='0'.repeat(64)?{id:job.request.parentArtifactId,files:{}}:await store.artifact(job.request.parentArtifactId);
    const result=await verifyRoadsterSubmission({report,parent,onUpdate:async report=>{job.report=report;await store.writeJob(job);},onStage:async status=>{console.log(status+' (local, no inference)');}});
    const artifact=await store.publish(result.files,result.metadata);
    if(process.argv.includes('--save'))await saveRoadsterArtifact(artifact);
    job.status='ready';job.artifactId=artifact.id;job.error=null;job.events.push({sequence:job.events.length+1,status:'ready',reason:'explicit local re-verification; no new inference',at:new Date().toISOString()});await store.writeJob(job);
    console.log(JSON.stringify({artifactId:artifact.id,metaCalled:false,originalEstimatedCostUsd:report.estimatedCostUsd}));
  }finally{await store.close();}
}catch(error){console.error(error.message);process.exitCode=1;}
