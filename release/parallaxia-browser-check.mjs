import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { createStaticReleaseServer, RELEASE_CHECK_BASE_PATH } from './static-server.mjs';
import { readStoredZip } from './zip.mjs';
import { digest } from '../component/build.mjs';

/** Fresh browser and system-extracted exact archive, with nonlocal requests blocked. */
export async function browserCheckParallaxia(directory, manifest){
 const server=await createStaticReleaseServer({root:directory,basePath:RELEASE_CHECK_BASE_PATH});
 let browser,extractedServer;const temporary=await mkdtemp(join(tmpdir(),'parallaxia-cold-export-'));
 const errors=[],external=[],posts=[];let pairedExportReplay=false,siteExperimentReplay=false;
 try{
  browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true,env:{PATH:process.env.PATH??'',HOME:process.env.HOME??'',TMPDIR:process.env.TMPDIR??''}});
  const context=await browser.newContext({viewport:{width:1200,height:900}});
  const allow=new Set([new URL(server.origin).origin]);
  await context.route('**/*',route=>{const req=route.request();if(req.method()!=='GET')posts.push(req.url());if(!allow.has(new URL(req.url()).origin)){external.push(req.url());return route.abort();}return route.continue();});
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  const page=await context.newPage();await page.goto(server.origin);await page.locator('#parallaxia-game').waitFor();
  await page.waitForFunction(id=>document.querySelector('#parallaxia-game')?.getAttribute('src').includes(id),manifest.featuredId);
  assert.match(await page.locator('main').innerText(),/REUSE/);assert.equal(await page.locator('#motion-submit').count(),0);
  const featured=manifest.versions.find(version=>version.id===manifest.featuredId);
  assert.equal(await page.getByRole('link',{name:'Compiled donor',exact:true}).getAttribute('href'),new URL('donor/play',server.origin).pathname);
  const data=JSON.parse(await readFile(join(directory,'motion-data.json'),'utf8'));
  const saved=data.resources['/api/catalog'].versions;
  assert.equal(await page.locator('#generation-version option').count(),saved.length+1);
  const measured=data.resources['/api/live-mechanics/results'];
  if(measured){
    const results=page.getByRole('region',{name:'Measured task results'});
    assert.ok((await results.innerText()).includes(`${measured.positive.passed}/${measured.positive.total} positive tasks passed`));
    await results.locator('summary').click();assert.equal(await results.locator('tbody tr').count(),measured.tasks.length);
  }
  const baseline=manifest.versions.find(version=>version.kind==='parallaxia-reuse');
  if(featured.id!==baseline.id){
    await page.getByRole('button',{name:'Keep original integration',exact:true}).click();
    await page.waitForFunction(id=>document.querySelector('#parallaxia-game')?.getAttribute('src').includes(id),baseline.id);
    assert.equal(await page.getByRole('region',{name:'Verified experiment comparison'}).count(),0);
    await page.reload();await page.waitForFunction(id=>document.querySelector('#parallaxia-game')?.getAttribute('src').includes(id),baseline.id);
    assert.equal(await page.getByRole('region',{name:'Verified experiment comparison'}).count(),0);
    await page.goBack();
    await page.waitForFunction(id=>document.querySelector('#parallaxia-game')?.getAttribute('src').includes(id),featured.id);
  }
  const diagnostic=manifest.versions.find(version=>version.kind==='parallaxia-unsuccessful-experiment');
  if(diagnostic){
    await page.locator('#generation-version').selectOption(diagnostic.id);await page.locator('#generation-play').click();
    await page.getByRole('alert').filter({hasText:'Saved diagnostic: goal unsatisfied'}).waitFor();
    assert.ok((await page.locator('#parallaxia-game').getAttribute('src')).includes(baseline.id));
    assert.equal(await page.locator('#generation-version').inputValue(),diagnostic.id);
    await page.getByRole('heading',{name:'Goal unsatisfied · original retained',exact:true}).waitFor();
    await page.goto(server.origin);
  }
  const zipBytes=await readFile(join(directory,featured.download));const entries=readStoredZip(zipBytes);
  const frame=await readFile(join(directory,featured.frame));assert.equal(digest(entries.get('play.html')??entries.get('frame.html')),digest(frame));
  const archive=join(temporary,'download.zip');await writeFile(archive,zipBytes);
  await promisify(execFile)('unzip',['-q',archive,'-d',temporary]);
  extractedServer=await createStaticReleaseServer({root:temporary});allow.add(new URL(extractedServer.origin).origin);
  const cold=await context.newPage();await cold.goto(extractedServer.origin+(entries.has('play.html')?'play.html':'frame.html')+'?test=1');
  await cold.waitForFunction(()=>window.roadsterReady);
  const state=await cold.evaluate(()=>{roadsterStart(false);return roadsterAdvance(50,{driver:0,dash:true});});assert.equal(state.componentId,manifest.componentId);
  assert.equal(state.motion.coreCalls,50);
  if(entries.has('replay.html')){const replay=await context.newPage();await replay.goto(extractedServer.origin+'replay.html');await replay.locator('#motion-compare').click();await replay.waitForFunction(()=>{const statuses=[...document.querySelectorAll('.experiment-comparison [role="status"]')];return statuses.length===2&&statuses.every(node=>node.textContent.includes('Reproduced worker'));},null,{timeout:15000});pairedExportReplay=true;await replay.close();}
  const experiment=manifest.versions.find(version=>version.kind!=='parallaxia-unsuccessful-experiment'&&version.id!==manifest.featuredId&&manifest.files[`artifacts/${version.id}/experiment.json`])??(manifest.files[`artifacts/${manifest.featuredId}/experiment.json`]?featured:null);
  if(experiment){
   const receipt=JSON.parse(await readFile(join(directory,`artifacts/${experiment.id}/experiment.json`),'utf8'));
   const parent=manifest.versions.find(version=>version.id===experiment.parentArtifactId);assert.ok(parent);
   for(const [branch,version]of [['original',parent],['candidate',experiment]]){
    const replay=await context.newPage();await replay.goto(server.origin+version.frame+'?test=1');await replay.waitForFunction(()=>window.roadsterReady);
    const observed=await replay.evaluate(async({receipt,branch})=>parallaxiaReplayExperiment(receipt,branch),{receipt,branch});assert.equal(observed.endDigest,receipt[branch].endDigest);await replay.close();
   }
  }
  siteExperimentReplay=Boolean(experiment);
  await page.goto(server.origin+'jujump/index.html');await page.locator('#compare').click();await page.waitForFunction(()=>document.querySelector('#measurements-summary')?.textContent.startsWith('PASS'));
  await page.goto(server.origin);await page.locator('#parallaxia-game').waitFor();await page.setViewportSize({width:390,height:844});if(measured)await page.getByRole('region',{name:'Measured task results'}).locator('summary').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(posts,[]);
  return {passed:true,kind:'parallaxia-clean-start-release',componentId:manifest.componentId,featuredId:manifest.featuredId,zipSha256:digest(zipBytes),frameSha256:digest(frame),systemUnzip:true,nestedBasePath:true,pairedExportReplay,siteExperimentReplay,acceptedJujump:true,measuredTaskResults:Boolean(measured),externalRequests:external,posts,pageErrors:errors};
 }finally{await browser?.close();await extractedServer?.close();await server.close();await rm(temporary,{recursive:true,force:true});}
}
