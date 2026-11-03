import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readTaskManifest,runLiveMechanicsTasks } from '../src/benchmark/live-mechanics.mjs';
import { localMetaClient } from '../src/hosting/local-parallaxia.mjs';
if(process.argv.includes('--validate-only')){const {manifest,sha256}=await readTaskManifest();console.log(JSON.stringify({tasks:manifest.tasks.length,sha256,paidRequestsStarted:0},null,2));}
else{
 if(!process.argv.includes('--allow-paid'))throw Error('Pass --allow-paid to run the frozen measured task set using the reconciled ledger');
 try{loadEnvFile(resolve('.env'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const client=localMetaClient();if(!client)throw Error('MODEL_API_KEY is missing');
 const index=process.argv.indexOf('--output');const directory=resolve(index>=0?process.argv[index+1]:'reports/live-mechanics/task-run-'+randomUUID());
 const result=await runLiveMechanicsTasks({client,directory});console.log(JSON.stringify({directory,passed:result.passed,positive:result.positive,negative:result.negative,estimatedCostUsd:result.estimatedCostUsd},null,2));if(!result.passed)process.exitCode=1;
}
