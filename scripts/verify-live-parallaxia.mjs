import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { createLocalParallaxia, localMetaClient } from '../src/hosting/local-parallaxia.mjs';
import { createPreviewServer } from '../web/server.mjs';
import { digest } from '../src/component/build.mjs';

if (!process.argv.includes('--allow-paid')) throw Error('This validation makes two paid Standard Meta requests. Pass --allow-paid after ledger reconciliation.');
try { loadEnvFile(resolve('.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const client = localMetaClient(); if (!client) throw Error('MODEL_API_KEY is missing');
const directory = resolve('reports/live-mechanics/live-' + randomUUID()); await mkdir(directory, { recursive: true });
let responses = 0; const respond = client.respond;
client.respond = (...args) => { responses++; return respond(...args); };
let local, server, browser;
const evidence = { kind: 'development-browser-generation', fixture: false, startedAt: new Date().toISOString(), directory, jobs: [], errors: [] };
try {
  evidence.ledgerBeforeSha256 = digest(await readFile('reports/motion-transfer-phase/phase-budget.json'));
  local = await createLocalParallaxia({ directory, client });
  server = await createPreviewServer({ coordinator: local.coordinator });
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  page.on('pageerror', error => evidence.errors.push(error.message));
  await page.goto(server.origin); await page.locator('#parallaxia-game').waitFor();

  for (const [index, prompt] of ['Make the dash backward, only on a fresh press.', 'Half as far.'].entries()) {
    const started = Date.now();
    await page.locator('#motion-prompt').fill(prompt); await page.locator('#motion-submit').click();
    await page.waitForFunction(() => Boolean(JSON.parse(sessionStorage.getItem('motion-creator-session'))?.pending?.jobId));
    const pending = await page.evaluate(() => JSON.parse(sessionStorage.getItem('motion-creator-session')).pending);
    console.log('Submitted',index + 1,pending.jobId);
    // Refresh during the job and reconnect using the persisted job, never a new request key.
    await page.reload();
    const job = await local.coordinator.wait(pending.jobId); evidence.jobs.push({ ...job, prompt, observedWallMs: Date.now() - started });
    await writeFile(join(directory, 'development-evidence.json'), JSON.stringify(evidence, null, 2));
    console.log('Result',index + 1,job.status,job.estimatedCostUsd,job.error ?? '');
    assert.equal(job.status,'ready',job.error);
    assert.equal(job.intent.direction,'opposite'); assert.equal(job.intent.activation,'press'); assert.equal(job.intent.unitScale,index === 0 ? 0.1 : 0.05);
    await page.locator('#motion-play-child').waitFor({ timeout: 20000 }); await page.locator('#motion-play-child').click();
    const receipt = JSON.parse((await local.coordinator.artifactFile(job.artifactId, 'receipt.json')).toString());
    assert.equal(receipt.recipient.id,'parallaxia'); assert.equal(receipt.native.recipientId,'parallaxia'); assert.equal(receipt.browser.recipientId,'parallaxia');
    const bytes = await local.coordinator.artifactFile(job.artifactId,'play.html'); assert.equal(digest(bytes),receipt.frameSha256);
    assert.equal((await local.coordinator.submit({ ...pending, sessionId: await page.evaluate(() => JSON.parse(sessionStorage.getItem('motion-creator-session')).sessionId), adultConfirmed: true })).artifactId,job.artifactId);
    await page.screenshot({path:join(directory,`child-${index + 1}.png`),fullPage:true});
  }
  const last = evidence.jobs.at(-1);
  await server.close(); server=null; await local.close(); local=null;
  local=await createLocalParallaxia({directory,client}); server=await createPreviewServer({coordinator:local.coordinator});
  await page.goto(server.origin+'/?artifact='+last.artifactId); await page.waitForFunction(id=>document.querySelector('#parallaxia-game')?.getAttribute('src').includes(id),last.artifactId);
  assert.equal((await local.coordinator.job(last.id)).artifactId,last.artifactId); assert.equal(responses,2);
  assert.deepEqual(evidence.errors,[]); evidence.passed=true; evidence.responseCalls=responses;
} catch (error) { evidence.passed=false; evidence.failure=error.message; process.exitCode=1; console.log('FAILED',error.message); }
finally {
  await browser?.close(); await server?.close(); await local?.close();
  evidence.finishedAt=new Date().toISOString(); evidence.ledgerAfterSha256=digest(await readFile('reports/motion-transfer-phase/phase-budget.json'));
  await writeFile(join(directory,'development-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
  console.log('Evidence:',join(directory,'development-evidence.json'));
}
