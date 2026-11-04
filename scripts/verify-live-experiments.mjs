import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { createLocalParallaxia, localMetaClient } from '../src/hosting/local-parallaxia.mjs';
import { createPreviewServer } from '../web/server.mjs';
import { digest } from '../src/component/build.mjs';

if (!process.argv.includes('--allow-paid')) throw Error('This validation makes bounded paid Standard Meta experiment requests. Pass --allow-paid after reconciliation.');
try { loadEnvFile(resolve('.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const client=localMetaClient();if(!client)throw Error('MODEL_API_KEY is missing');
const directory=resolve('reports/live-mechanics/experiments-'+randomUUID());await mkdir(directory,{recursive:true});
const evidence={kind:'development-checkpoint-experiments',fixture:false,startedAt:new Date().toISOString(),directory,jobs:[],errors:[]};
let local,server,browser;
try{
 evidence.ledgerBeforeSha256=digest(await readFile('reports/motion-transfer-phase/phase-budget.json'));
 local=await createLocalParallaxia({directory,client});server=await createPreviewServer({coordinator:local.coordinator});
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});const page=await browser.newPage({viewport:{width:1300,height:1000}});
 page.on('pageerror',error=>evidence.errors.push(error.message));await page.goto(server.origin);await page.locator('#parallaxia-game').waitFor();
 await page.locator('#motion-curated').click();await page.locator('#checkpoint-status').waitFor();
 for(const [index,goal] of ['right','infeasible'].entries()){
  if(index>0)await page.locator('#motion-freeze').click();
  await page.locator('#motion-goal').selectOption(goal);await page.locator('#motion-freeze').click();
  const prompt=index===0?'Reach the frozen right region. Preserve the parent mapping if timing alone suffices.':'Try one supported dash against the frozen out-of-bounds target, even if it cannot succeed. Preserve the target and all constraints; let the worker record the actual failed outcome.';
  await page.locator('#motion-prompt').fill(prompt);await page.locator('#motion-submit').click();
  await page.waitForFunction(previous=>{const pending=JSON.parse(sessionStorage.getItem('motion-creator-session'))?.pending;return Boolean(pending?.jobId&&pending.jobId!==previous);},evidence.jobs.at(-1)?.id??null);
  const id=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('motion-creator-session')).pending.jobId);console.log('Experiment submitted',goal,id);
  const job=await local.coordinator.wait(id);evidence.jobs.push(job);await writeFile(join(directory,'development-evidence.json'),JSON.stringify(evidence,null,2));
  console.log('Experiment result',goal,job.status,job.estimatedCostUsd,job.error??'');
  assert.equal(job.status,index===0?'ready':'unsuccessful',job.error);
  assert.equal(job.experiment.satisfied,index===0);assert.equal(job.experiment.scenario.target.minX,index===0?5.5:100);
  assert.equal(job.experiment.scenario.noAddedInvulnerability,true);
  await page.locator('#motion-compare').waitFor({timeout:10000});await page.locator('#motion-compare').click();
  await page.waitForFunction(()=>{const items=[...document.querySelectorAll('.experiment-comparison [role="status"]')];return items.length===2&&items.every(item=>item.textContent.includes('Reproduced worker'));},null,{timeout:15000});
  const exported=await(await fetch(server.origin+'/artifacts/'+job.artifactId+'/experiment.json')).json();assert.deepEqual(exported,job.experiment);
  await page.screenshot({path:join(directory,goal+'.png'),fullPage:true});
 }
 assert.deepEqual(evidence.errors,[]);evidence.passed=true;
}catch(error){evidence.passed=false;evidence.failure=error.message;process.exitCode=1;console.log('FAILED',error.message);}
finally{await browser?.close();await server?.close();await local?.close();evidence.finishedAt=new Date().toISOString();evidence.ledgerAfterSha256=digest(await readFile('reports/motion-transfer-phase/phase-budget.json'));await writeFile(join(directory,'development-evidence.json'),JSON.stringify(evidence,null,2)+'\n');console.log('Evidence:',join(directory,'development-evidence.json'));}
