import {loadEnvFile} from 'node:process';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createLabService} from '../lab/service.mjs';
import {generateRoadsterTransfer} from '../agent/transfer-roadster.mjs';
import {loadSavedRoadster,saveRoadsterArtifact} from '../roadster/saved.mjs';
import {loadRecoveredMotion} from '../component/load.mjs';
import {loadRoadster} from '../recipients/roadster/load.mjs';
import {ROADSTER_INTENT} from '../roadster/port.mjs';

try{
  try{loadEnvFile(resolve('.env'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const initial=process.argv.includes('--initial'),save=process.argv.includes('--save');
  const component=await loadRecoveredMotion(),recipient=await loadRoadster();
  const parent=initial?{id:'0'.repeat(64),componentId:component.provenance.id,recipientRevision:recipient.manifest.revision,intent:ROADSTER_INTENT,files:{}}:await loadSavedRoadster();
  const prompt=process.argv.find(arg=>arg.startsWith('--prompt='))?.slice(9)??'Give the car the recovered dash while airborne. Keep the default 6-meter forward, held-activation mapping.';
  const service=await createLabService({directory:resolve('reports/lab'),apiKey:process.env.MODEL_API_KEY,generateTransfer:generateRoadsterTransfer,baseArtifact:parent});
  try{
    let job=await service.submit('roadster',{parentArtifactId:parent.id,prompt,idempotencyKey:randomUUID()}),last='';
    console.log('Roadster run: '+job.id+'; maximum estimated generation spend $0.05.');
    while(!['ready','failed'].includes(job.status)){
      const progress=job.status+': '+(job.report?.status??'queued');if(progress!==last){console.log(progress);last=progress;}
      await new Promise(resolve=>setTimeout(resolve,500));job=await service.run(job.id);
    }
    if(job.status!=='ready')throw Error(job.error);
    const artifact=await service.artifact(job.artifactId);if(save)await saveRoadsterArtifact(artifact);
    console.log(JSON.stringify({artifactId:artifact.id,saved:save,estimatedCostUsd:job.report.estimatedCostUsd,budget:service.status().budget}));
  }finally{await service.close();}
}catch(error){console.error(String(error.message).replaceAll(process.env.MODEL_API_KEY||'\0','[redacted]'));process.exitCode=1;}
