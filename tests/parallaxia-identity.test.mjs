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
