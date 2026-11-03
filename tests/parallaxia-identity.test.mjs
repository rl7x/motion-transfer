import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { createPreviewServer } from '../web/server.mjs';
import { loadSavedRoadster } from '../roadster/saved.mjs';
import { loadParallaxiaBaseline, readParallaxiaArtifact, PARALLAXIA_STORE } from '../parallaxia/artifact.mjs';
import { ACCEPTED_COMPONENT_ID } from '../hosting/component-pin.mjs';
import { digest } from '../component/build.mjs';

test('PARALLAXIA has independent accepted-component evidence, native collisions and immutable routes', async () => {
  const server = await createPreviewServer();
  try {
    const base = await (await fetch(server.origin + '/api/parallaxia/base')).json();
    const roadster = await loadSavedRoadster();
    assert.equal(base.componentId, ACCEPTED_COMPONENT_ID); assert.notEqual(base.id, roadster.id);
    assert.equal(base.recipient.id, 'parallaxia'); assert.equal(base.provenance.kind, 'reuse');
    const report = await (await fetch(server.origin + base.report)).json();
    assert.equal(report.conformance.passed, true); assert.equal(report.browser.passed, true);
    assert.equal(report.collisionPolicy, 'native'); assert.equal(report.addedDashInvulnerability, false);
    assert.ok(report.conformance.results.some(result => result.name === 'swept-bullet-collision-during-dash' && result.passed));
    const old = await (await fetch(server.origin + '/roadster/artifacts/' + roadster.id + '/play.html')).text();
    assert.equal(old, roadster.files['frame.html'], 'Historical Roadster bytes must not be rebuilt as PARALLAXIA');
    const frame = await (await fetch(server.origin + base.play)).text();
    assert.equal(digest(frame), report.browser.frameSha256);
    assert.equal(await (await fetch(server.origin + base.download)).text(), frame);
    const saved = await readParallaxiaArtifact(PARALLAXIA_STORE.pathname, base.id);
    assert.equal(saved.id, (await loadParallaxiaBaseline()).id);
    const portability = await (await fetch(server.origin + '/accepted/jujump/config.json')).json();
    assert.equal(portability.componentId, base.componentId);
  } finally { await server.close(); }
});

test('featured PARALLAXIA UI labels verified reuse and keeps practice shielding explicit', async () => {
  const server = await createPreviewServer(); let browser;
  try {
    browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } }); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.origin); await page.locator('#parallaxia-game').waitFor();
    assert.match(await page.locator('main').innerText(), /VERIFIED REUSE/);
    await page.getByRole('button', { name: 'Open shielded practice' }).click();
    await page.getByRole('heading', { name: 'Practice challenge · shield enabled' }).waitFor();
    assert.match(await page.locator('main').innerText(), /not survival/);
    await page.screenshot({ path: 'reports/parallaxia-m0-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server.close(); }
});

test('PARALLAXIA omits the notice, shows the configured $7 cap and confirms only when creating', async () => {
  const server = await createPreviewServer(); let browser;
  try {
    browser = await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});
    const page = await browser.newPage();const posts=[],errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const job={id:'11111111-1111-4111-8111-111111111111',status:'unsupported',artifactId:null,urls:null,
      estimatedCostUsd:0,createdAt:new Date().toISOString(),finishedAt:new Date().toISOString(),summary:'Synthetic UI fixture: unsupported request'};
    await page.route('**/api/remixes/status',route=>route.fulfill({json:{generationConfigured:true,maxJobCostUsd:7}}));
    await page.route('**/api/remixes',async route=>{
      assert.equal(route.request().method(),'POST');posts.push(route.request().postDataJSON());
      await route.fulfill({status:202,json:job});
    });
    await page.route('**/api/remixes/'+job.id,route=>route.fulfill({json:job}));
    await page.goto(server.origin);await page.waitForFunction(()=>{const button=document.querySelector('#motion-submit');return Boolean(button&&!button.disabled);});
    assert.equal(await page.locator('#age-acknowledgment, #model-policy, #confirm-age').count(),0);
    assert.equal(await page.getByRole('link',{name:'Privacy',exact:true}).count(),0);
    assert.ok((await page.locator('main').innerText()).includes('Maximum $7 for the whole job'));
    const baseline=await page.locator('#parallaxia-game').getAttribute('src');
    await page.locator('#motion-submit').click();await page.getByRole('dialog',{name:'Confirm before creating'}).waitFor();
    assert.equal(posts.length,0);await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
    await page.locator('#motion-submit').click();await page.locator('#confirm-age').click();
    await page.waitForFunction(()=>document.querySelector('#motion-job')?.textContent.includes('unsupported'));
    assert.equal(posts.length,1);assert.equal(posts[0].adultConfirmed,true);
    assert.equal(await page.locator('#parallaxia-game').getAttribute('src'),baseline);
    await page.reload();await page.waitForFunction(()=>document.querySelector('#motion-job')?.textContent.includes('unsupported'));
    assert.equal(posts.length,1);assert.equal(await page.getByRole('dialog').count(),0);assert.deepEqual(errors,[]);
  } finally {await browser?.close();await server.close();}
});
