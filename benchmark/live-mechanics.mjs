import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { createLocalParallaxia } from '../hosting/local-parallaxia.mjs';
import { createPreviewServer } from '../web/server.mjs';
import { acceptedJujumpComparison } from '../release/accepted.mjs';
import { projectZip } from '../integration/archive.mjs';
import { extractIntegration, serveIntegration, cleanEnv } from '../evaluator/integration-harness.mjs';
import { digest } from '../component/build.mjs';

export async function readTaskManifest(){
 const bytes=await readFile(new URL('live-mechanics-tasks.json',import.meta.url));const manifest=JSON.parse(bytes);
 assert.equal(manifest.tasks.length,10);assert.equal(new Set(manifest.tasks.map(task=>task.id)).size,10);
 assert.equal(manifest.maxJobCostUsd,0.15);assert.equal(manifest.maxAttemptsPerJob,2);
 assert.equal(manifest.tasks.filter(task=>task.kind==='negative').length,1);
 return {manifest,sha256:digest(bytes)};
}

export async function runLiveMechanicsTasks({client,directory,allowDirty=false,onProgress=console.log}={}){
 const {manifest,sha256}=await readTaskManifest();
 const git=async args=>(await promisify(execFile)('git',args,{cwd:new URL('..',import.meta.url).pathname})).stdout.trim();
 if(!allowDirty)assert.equal(await git(['status','--porcelain']), '','Freeze/commit source before the measured run');
 assert.notEqual(await git(['branch','--show-current']),'main');
 directory=resolve(directory);await mkdir(directory,{recursive:true});
 const sessions=Object.fromEntries(['a','b','c','d'].map(key=>[key,randomUUID()]));
 const result={schemaVersion:1,kind:'frozen-live-mechanics-task-run',fixture:false,taskManifest:manifest,taskManifestSha256:sha256,codeCommit:await git(['rev-parse','HEAD']),frozenAt:new Date().toISOString(),sessions,tasks:[]};
 await writeFile(join(directory,'definition.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 result.ledgerBeforeSha256=digest(await readFile('reports/motion-transfer-phase/phase-budget.json'));
 let local,server,browser;const jobs=new Map();let checkpoint;
 const save=()=>writeFile(join(directory,'results.json'),JSON.stringify(result,null,2)+'\n');
 try{
  local=await createLocalParallaxia({directory:join(directory,'live'),client,maxJobCostUsd:manifest.maxJobCostUsd});server=await createPreviewServer({coordinator:local.coordinator});
  result.baselineId=local.baseline.id;assert.equal(local.baseline.componentId,manifest.componentId);
  browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true,env:cleanEnv()});
  const capture=await browser.newPage();await capture.goto(server.origin+`/parallaxia/artifacts/${local.baseline.id}/play.html?test=1`);await capture.waitForFunction(()=>window.roadsterReady);
  checkpoint=await capture.evaluate(async()=>{roadsterStart(false);roadsterAdvance(40,{driver:0,dash:false});return parallaxiaCaptureCheckpoint();});await capture.close();
  result.checkpoint=checkpoint;await save();
  for(const task of manifest.tasks){
   const record={id:task.id,kind:task.kind,startedAt:new Date().toISOString(),passed:false};result.tasks.push(record);await save();
   const began=Date.now();onProgress('Task '+task.id+' started');
   try{
    if(task.operation==='accepted-jujump-clean-start'){
     const comparison=await acceptedJujumpComparison(manifest.componentId),files=Object.fromEntries(Object.entries(comparison.extras).map(([name,bytes])=>[name.slice(7),bytes]));
     const zip=projectZip(files);await writeFile(join(directory,'accepted-jujump.zip'),zip);
     const extracted=await extractIntegration({zip});let standalone;
     try{
      const checks=await promisify(execFile)(process.execPath,['--test','verify.test.mjs'],{cwd:extracted.directory,env:cleanEnv(),timeout:30000});
      standalone=await serveIntegration(extracted.directory);const page=await browser.newPage();await page.goto(standalone.origin);await page.locator('#compare').click();await page.waitForFunction(()=>document.querySelector('#measurements-summary').textContent.startsWith('PASS'));
      record.measurement=await page.locator('#measurements-summary').textContent();record.nodeChecks=checks.stdout;record.zipSha256=digest(zip);await page.close();
     }finally{await standalone?.close();await extracted.close();}
    }else if(task.operation==='restart-reconnect-and-exact-export-replay'){
     const final=jobs.get(task.parent),experiment=jobs.get(task.experiment);assert.equal(final?.status,'ready');assert.equal(experiment?.status,'ready');
     await server.close();server=null;await local.close();local=null;
     local=await createLocalParallaxia({directory:join(directory,'live'),client,maxJobCostUsd:manifest.maxJobCostUsd});server=await createPreviewServer({coordinator:local.coordinator});
     assert.equal((await local.coordinator.job(final.id)).artifactId,final.artifactId);
     const request=result.tasks.find(item=>item.job?.id===final.id).request;assert.equal((await local.coordinator.submit(request)).artifactId,final.artifactId);
     const page=await browser.newPage();await page.goto(server.origin+'/?artifact='+final.artifactId);await page.waitForFunction(id=>document.querySelector('#parallaxia-game')?.getAttribute('src').includes(id),final.artifactId);
     const receipt=experiment.experiment;const parent=await browser.newPage();await parent.goto(server.origin+experiment.urls.parent+'?test=1');await parent.waitForFunction(()=>window.roadsterReady);
     const original=await parent.evaluate(async receipt=>parallaxiaReplayExperiment(receipt,'original'),receipt);assert.equal(original.endDigest,receipt.original.endDigest);await parent.close();
     const candidate=await browser.newPage();await candidate.goto(server.origin+experiment.urls.play+'?test=1');await candidate.waitForFunction(()=>window.roadsterReady);
     const changed=await candidate.evaluate(async receipt=>parallaxiaReplayExperiment(receipt,'candidate'),receipt);assert.equal(changed.endDigest,receipt.candidate.endDigest);await candidate.close();
     const exported=await(await fetch(server.origin+'/artifacts/'+experiment.artifactId+'/experiment.json')).json();assert.deepEqual(exported,receipt);
     record.reconnectedArtifactId=final.artifactId;record.replayedExperimentArtifactId=experiment.artifactId;record.originalDigest=original.endDigest;record.candidateDigest=changed.endDigest;await page.close();
    }else{
     const parentId=task.parent==='baseline'?local.baseline.id:jobs.get(task.parent)?.artifactId;
     if(!parentId)throw Error('Blocked by failed parent task '+task.parent);
     const request={adultConfirmed:true,idempotencyKey:randomUUID(),sessionId:sessions[task.session],parentArtifactId:parentId,prompt:task.prompt,
      ...(task.target?{experiment:{checkpoint,scenario:{...manifest.scenario,target:task.target}}}:{}),...(task.composition?{composition:task.composition}:{})};
     record.request=request;await save();
     const response=await fetch(server.origin+'/api/remixes',{method:'POST',headers:{Origin:server.origin,'Content-Type':'application/json'},body:JSON.stringify(request)});
     const admitted=await response.json();assert.equal(response.status,202,admitted.error);
     const job=await local.coordinator.wait(admitted.id);record.job=job;jobs.set(task.id,job);
     const stored=JSON.parse(await readFile(join(directory,'live','jobs',job.id+'.json'),'utf8'));
     record.attempts=stored.attempts?.map(attempt=>({attempt:attempt.attempt,passed:attempt.passed,failure:attempt.failure??null,estimatedCumulativeCostUsd:attempt.estimatedCostUsd,startedAt:attempt.startedAt,finishedAt:attempt.finishedAt}))??[];
     if(task.kind==='negative'){
      assert.ok(task.expectedStatuses.includes(job.status),job.error??job.status);
      assert.deepEqual(stored.experiment.scenario.target,task.target);
      if(job.status==='unsuccessful')assert.equal(job.experiment.satisfied,false);
      assert.ok(await local.coordinator.parentBytes(parentId));
     }else{
      assert.equal(job.status,'ready',job.error);
      if(task.intent)assert.deepEqual(job.intent,task.intent);
      if(task.target)assert.equal(job.experiment.satisfied,true);
      if(task.composition)assert.equal(job.rule.kind,task.composition);
      const receipt=JSON.parse((await local.coordinator.artifactFile(job.artifactId,'receipt.json')).toString());assert.equal(receipt.componentId,manifest.componentId);
      assert.equal(receipt.native.executedIn,'worker');assert.equal(receipt.browser.executedIn,'worker');
     }
     assert.ok(job.estimatedCostUsd<=manifest.maxJobCostUsd);assert.ok(record.attempts.length<=2);
    }
    record.passed=true;
   }catch(error){record.failure=error.message;}
   record.finishedAt=new Date().toISOString();record.wallMs=Date.now()-began;await save();onProgress('Task '+task.id+': '+(record.passed?'passed':'FAILED '+record.failure));
  }
 }finally{
  await browser?.close();await server?.close();await local?.close();
  result.finishedAt=new Date().toISOString();result.ledgerAfterSha256=digest(await readFile('reports/motion-transfer-phase/phase-budget.json'));
  result.positive={passed:result.tasks.filter(task=>task.kind==='positive'&&task.passed).length,total:9};result.negative={correct:result.tasks.filter(task=>task.kind==='negative'&&task.passed).length,total:1};
  result.estimatedCostUsd=result.tasks.reduce((sum,task)=>sum+(task.job?.estimatedCostUsd??0),0);
  result.observedRepairBenefits=result.tasks.filter(task=>task.attempts?.length===2&&task.attempts[0].passed===false&&task.attempts[1].passed===true).map(task=>task.id);
  result.passed=result.positive.passed===9&&result.negative.correct===1;await save();
 }
 return result;
}
