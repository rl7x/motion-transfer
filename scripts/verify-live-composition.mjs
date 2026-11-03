import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { createLocalParallaxia, localMetaClient } from '../hosting/local-parallaxia.mjs';
import { createPreviewServer } from '../web/server.mjs';
import { digest } from '../component/build.mjs';

if (!process.argv.includes('--allow-paid')) throw Error('This validation makes two paid Standard Meta composition requests. Pass --allow-paid after ledger reconciliation.');
try { loadEnvFile(resolve('.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const client = localMetaClient(); if (!client) throw Error('MODEL_API_KEY is missing');
const resumeIndex=process.argv.indexOf('--resume');
const directory = resumeIndex>=0 ? resolve(process.argv[resumeIndex+1]) : resolve('reports/live-mechanics/composition-' + randomUUID()); await mkdir(directory, { recursive: true });
let responses = 0; const respond = client.respond;
client.respond = (...args) => { responses++; return respond(...args); };
let local, server, browser;
let previous=null;
if(resumeIndex>=0){let raw;try{raw=await readFile(join(directory,'development-evidence-v2.json'),'utf8');await writeFile(join(directory,'validation-failure-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json'),raw,{flag:'wx'});}catch(error){if(error.code!=='ENOENT')throw error;raw=await readFile(join(directory,'development-evidence.json'),'utf8');}previous=JSON.parse(raw);}
const evidence = { kind: 'development-browser-composition', fixture: false, startedAt: new Date().toISOString(), directory, jobs: previous?.jobs??[], errors: [], priorValidationFailure:previous?.failure??null };
let priorResponses=0;for(const job of previous?.jobs??[]){const stored=JSON.parse(await readFile(join(directory,'jobs',job.id+'.json'),'utf8'));priorResponses+=stored.attempts?.length??0;}
try {
  evidence.ledgerBeforeSha256 = digest(await readFile('reports/motion-transfer-phase/phase-budget.json'));
  local = await createLocalParallaxia({ directory, client });
  server = await createPreviewServer({ coordinator: local.coordinator });
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  page.on('pageerror', error => evidence.errors.push(error.message));
  await page.goto(server.origin); await page.locator('#parallaxia-game').waitFor();

  for (const [index, prompt] of ['Add the dash-end to native-shot rule. Keep the dash mapping unchanged.', 'Remove the dash-end shot rule. Keep the dash mapping unchanged.'].entries()) {
    const started = Date.now();
    let job=evidence.jobs[index], pending;const reused=Boolean(job);
    if (!job) {
      await page.locator('#motion-task').selectOption(index===0?'dash-end-shot':'none');
      await page.locator('#motion-prompt').fill(prompt); await page.locator('#motion-submit').click();if(await page.getByRole('dialog',{name:'Confirm before creating'}).isVisible())await page.locator('#confirm-age').click();
      await page.waitForFunction(previous=>{const value=JSON.parse(sessionStorage.getItem('motion-creator-session'))?.pending;return Boolean(value?.jobId&&value.jobId!==previous);},evidence.jobs.at(-1)?.id??null);
      pending = await page.evaluate(() => JSON.parse(sessionStorage.getItem('motion-creator-session')).pending);
      console.log('Submitted',index + 1,pending.jobId);
      await page.reload();
      job = await local.coordinator.wait(pending.jobId); evidence.jobs.push({ ...job, prompt, observedWallMs: Date.now() - started });
    } else {
      const saved=JSON.parse(await readFile(join(directory,'jobs',job.id+'.json'),'utf8'));
      pending={idempotencyKey:saved.idempotencyKey,parentArtifactId:saved.parentArtifactId,prompt:saved.prompt,composition:saved.composition};
      console.log('Reusing existing verified job',job.id);
    }
    await writeFile(join(directory, resumeIndex>=0?'development-evidence-v2.json':'development-evidence.json'), JSON.stringify(evidence, null, 2));
    console.log('Result',index + 1,job.status,job.estimatedCostUsd,job.error ?? '');
    assert.equal(job.status,'ready',job.error);
    assert.equal(job.intent.direction,'facing'); assert.equal(job.intent.activation,'held'); assert.equal(job.intent.unitScale,0.1);assert.equal(job.rule.kind,index===0?'dash-end-shot':'none');
    if(reused){await page.goto(server.origin+'/?artifact='+job.artifactId);await page.locator('#parallaxia-game').waitFor();}
    else {await page.locator('#motion-play-child').waitFor({ timeout: 20000 }); await page.locator('#motion-play-child').click();}
    const receipt = JSON.parse((await local.coordinator.artifactFile(job.artifactId, 'receipt.json')).toString());
    assert.equal(receipt.recipient.id,'parallaxia'); assert.equal(receipt.native.recipientId,'parallaxia'); assert.equal(receipt.browser.recipientId,'parallaxia');
    const bytes = await local.coordinator.artifactFile(job.artifactId,'play.html'); assert.equal(digest(bytes),receipt.frameSha256);
    if(!reused)assert.equal((await local.coordinator.submit({ ...pending, sessionId: await page.evaluate(() => JSON.parse(sessionStorage.getItem('motion-creator-session')).sessionId), adultConfirmed: true })).artifactId,job.artifactId);
    await page.waitForFunction(id=>document.querySelector('#parallaxia-game')?.getAttribute('src').includes(id),job.artifactId);
    const frame=await browser.newPage();await frame.goto(server.origin+job.urls.play+'?test=1');await frame.waitForFunction(()=>window.roadsterReady);
    const observed=await frame.evaluate(()=>{roadsterStart(false);roadsterAdvance(40,{driver:0,dash:false});roadsterAdvance(1,{driver:0,dash:true});roadsterAdvance(7,{driver:0,dash:false});const before=structuredClone(roadsterSnapshot());const after=roadsterAdvance(1,{driver:0,dash:false});return {before:before.game.rule,after:after.game.rule,coreCalls:after.motion.coreCalls};});evidence.jobs.at(index).observedRule=observed;assert.equal(observed.before.attempts,0);assert.equal(observed.after.fired,index===0?1:0);assert.equal(observed.coreCalls,49);evidence.jobs.at(index).observedRule=observed;await frame.close();
    await page.screenshot({path:join(directory,`child-${index + 1}.png`),fullPage:true});
  }
  const last = evidence.jobs.at(-1);
  await server.close(); server=null; await local.close(); local=null;
  local=await createLocalParallaxia({directory,client}); server=await createPreviewServer({coordinator:local.coordinator});
  await page.goto(server.origin+'/?artifact='+last.artifactId); await page.waitForFunction(id=>document.querySelector('#parallaxia-game')?.getAttribute('src').includes(id),last.artifactId);
  assert.equal((await local.coordinator.job(last.id)).artifactId,last.artifactId); const responseRecords=await Promise.all(evidence.jobs.map(async job=>JSON.parse(await readFile(join(directory,'jobs',job.id+'.json'),'utf8')).attempts.length));assert.equal(responses+priorResponses,responseRecords.reduce((sum,count)=>sum+count,0));
  assert.deepEqual(evidence.errors,[]); evidence.passed=true; evidence.responseCalls=responses+priorResponses;
} catch (error) { evidence.passed=false; evidence.failure=error.message;evidence.stack=error.stack; process.exitCode=1; console.log('FAILED',error.message); }
finally {
  await browser?.close(); await server?.close(); await local?.close();
  evidence.finishedAt=new Date().toISOString(); evidence.ledgerAfterSha256=digest(await readFile('reports/motion-transfer-phase/phase-budget.json'));
  await writeFile(join(directory,resumeIndex>=0?'development-evidence-v2.json':'development-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
  console.log('Evidence:',join(directory,resumeIndex>=0?'development-evidence-v2.json':'development-evidence.json'));
}
