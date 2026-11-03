import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from './sha.mjs';
import { createStaticReleaseServer, RELEASE_CHECK_BASE_PATH } from './static-server.mjs';

function recordFailure(response, failures) {
  const url = response.url();
  if (url.endsWith('/favicon.ico')) return;
  if (response.status() >= 400) failures.push(response.status() + ' ' + url);
}

async function exercisePlaybackEvidence(page, origin) {
  const drawer = page.locator('#evidence-details');
  await drawer.waitFor();
  if (!(await drawer.evaluate(node => node.open))) await drawer.locator('summary').first().click();
  const nested = drawer.locator('details > summary');
  const nestedCount = await nested.count();
  for (let index = 0; index < nestedCount; index += 1) {
    const summary = nested.nth(index);
    const open = await summary.evaluate(node => node.parentElement.open);
    if (!open) await summary.click();
  }
  await page.waitForSelector('.challenge-context details');
  const challengeSummary = page.locator('.challenge-context details > summary');
  if (!(await challengeSummary.evaluate(node => node.parentElement.open))) await challengeSummary.click();
  await page.waitForSelector('.ability-links a[href*="evidence/component.ts"]');
  await page.waitForSelector('#roadster-source');
  const sourceHref = await page.locator('#roadster-source').getAttribute('href');
  assert.match(sourceHref ?? '', /\/versions\/[a-f0-9]{64}\/download\.zip$/);
  assert.doesNotMatch(sourceHref ?? '', /\/api\//);
  const apiHrefs = await page.locator('a[href*="/api/"]').evaluateAll(nodes => nodes
    .filter(node => !node.closest('[hidden]'))
    .map(node => node.getAttribute('href')));
  assert.deepEqual(apiHrefs, []);
  const hrefs = await page.locator([
    '#evidence-details a[href]',
    '.ability-links a[href]',
    '#roadster-source',
    '.challenge-context a[href]',
    'footer a[href]',
    '#challenge-download',
  ].join(', ')).evaluateAll(nodes => nodes.map(node => node.closest('[hidden]') ? null : node.getAttribute('href')));
  const failures = [];
  const checked = [];
  const seen = new Set();
  for (const href of hrefs) {
    if (!href || href.startsWith('#') || seen.has(href)) continue;
    seen.add(href);
    const absolute = new URL(href, page.url());
    if (absolute.pathname.endsWith('/favicon.ico')) continue;
    if (!absolute.href.startsWith(origin)) {
      failures.push('external ' + absolute.href);
      continue;
    }
    checked.push(absolute.pathname);
    const response = await page.request.get(absolute.href);
    if (response.status() >= 400) failures.push(response.status() + ' ' + absolute.pathname + absolute.search);
  }
  if (!checked.some(path => path.includes('/evidence/component.ts'))) throw Error('Component source link was not exercised');
  if (!checked.some(path => path.endsWith('/adapter.ts'))) throw Error('Adapter source link was not exercised');
  if (!checked.some(path => path.endsWith('/notices.txt') || path.endsWith('/NOTICE.txt'))) throw Error('Notices link was not exercised');
  assert.deepEqual(failures, []);
}

async function exerciseJujumpFallback(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  try {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        if (kind === 'webgl2') return null;
        return original.call(this, kind, ...args);
      };
    });
    page.setDefaultTimeout(60_000);
    const failures = [];
    const external = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('response', response => recordFailure(response, failures));
    await page.route('**/*', route => {
      const url = route.request().url();
      if (escaped(url, origin)) { external.push(url); return route.abort(); }
      return route.continue();
    });
    await page.goto(origin + 'index.html');
    await page.waitForSelector('#jujump-comparison');
    assert.equal(await page.evaluate(() => document.createElement('canvas').getContext('webgl2')), null);
    assert.equal(await page.locator('#jujump-comparison').isVisible(), true);
    assert.equal(await page.locator('.compact-ability .pill').innerText(), 'ACCEPTED RECOVERY');
    const href = await page.locator('#jujump-comparison').getAttribute('href');
    assert.match(href ?? '', /\/jujump\/index\.html$/);
    await page.goto(new URL(href, page.url()).href);
    await page.locator('#compare').click();
    try {
      await page.waitForFunction(() => document.querySelector('#measurements-summary')?.textContent?.startsWith('PASS'));
    } catch (error) {
      const status = await page.locator('#comparison-status').innerText().catch(() => '');
      throw Error((status ? status + '. ' : '') + error.message);
    }
    assert.match(await page.locator('#measurements-summary').innerText(), /^PASS · /);
    assert.deepEqual(external, []);
    assert.deepEqual(failures, []);
  } finally { await page.close(); }
}

function escaped(url, origin) {
  if (url.startsWith(origin) || url.startsWith('blob:') || url.startsWith('data:') || url.endsWith('/favicon.ico')) return false;
  return true;
}

export async function browserCheck(directory, manifest, { basePath = RELEASE_CHECK_BASE_PATH } = {}) {
  const { chromium } = await import('playwright');
  const server = await createStaticReleaseServer({ root: directory, basePath });
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '' } });
  const external = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    page.setDefaultTimeout(60_000);
    await page.route('**/*', route => {
      const url = route.request().url();
      if (escaped(url, server.origin)) { external.push(url); return route.abort(); }
      return route.continue();
    });
    const shellErrors = [];
    const apiRequests = [];
    const httpFailures = [];
    page.on('pageerror', error => shellErrors.push(error.message));
    page.on('response', response => recordFailure(response, httpFailures));
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path.includes('/api/')) apiRequests.push(path);
    });
    await page.goto(server.origin + 'index.html');
    await page.waitForFunction(() => window.__MOTION_TRANSFER__?.generation === 'playback-only');
    try { await page.waitForSelector('#hybrid-title', { timeout: 45_000 }); }
    catch { throw Error('Playback shell did not render the saved transfer. ' + shellErrors.join('\n')); }
    if (shellErrors.length) throw Error(shellErrors.join('\n'));
    assert.deepEqual(httpFailures, []);
    const recovery = await page.evaluate(() => window.__MOTION_TRANSFER__.recovery);
    const abilityId = await page.evaluate(() => window.__MOTION_TRANSFER__.resources['/api/ability'].id);
    assert.equal(abilityId, manifest.componentId);
    const pill = await page.locator('.compact-ability .pill').innerText();
    if (recovery === 'accepted') {
      assert.equal(pill, 'ACCEPTED RECOVERY');
      assert.doesNotMatch(await page.locator('.compact-ability').innerText(), /reliable|wilson|success rate/i);
    } else {
      assert.equal(recovery, 'saved');
      assert.equal(pill, 'SAVED RECOVERY');
    }
    const destinations = await page.evaluate(() => window.__MOTION_TRANSFER__.resources['/api/destinations'].destinations);
    for (const destination of destinations) assert.equal(destination.componentId, manifest.componentId);
    await exercisePlaybackEvidence(page, server.origin);
    if (recovery === 'accepted') await exerciseJujumpFallback(browser, server.origin);
    assert.deepEqual(httpFailures, []);
    const injected = await page.evaluate(() => Object.keys(window.__MOTION_TRANSFER__.resources));
    const leaked = apiRequests.filter(path => injected.includes(path));
    assert.deepEqual(leaked, [], 'Injected resources were requested from the network');
    const submit = page.locator('#roadster-submit');
    if (await submit.count()) assert.equal(await submit.isDisabled(), true);
    const shell = await page.evaluate(() => ({
      generation: window.__MOTION_TRANSFER__.generation,
      enabled: window.__MOTION_TRANSFER__.resources['/api/lab/status'].enabled,
      challenge: Object.keys(window.__MOTION_TRANSFER__.resources).some(path => path.startsWith('/api/roadster/challenge/')),
    }));
    assert.equal(shell.generation, 'playback-only');
    assert.equal(shell.enabled, false);
    assert.equal(shell.challenge, manifest.versions.some(version => version.kind === 'roadster-challenge'));
    await page.waitForSelector('#transfer-game', { timeout: 45_000 });
    const frameSrc = await page.locator('#transfer-game').evaluate(frame => frame.src);
    assert.match(frameSrc, new RegExp(basePath.replace(/\/$/, '') + '/versions/[a-f0-9]{64}/frame\\.html'));
    const leaf = manifest.remixChain?.at(-1) ?? manifest.versions.find(version => version.parentArtifactId)?.id;
    if (leaf) {
      await page.goto(server.origin + 'versions/' + leaf + '/index.html');
      await page.reload();
      const parent = page.locator('[data-parent]');
      assert.equal(await parent.getAttribute('href'), '../' + manifest.versions.find(version => version.id === leaf).parentArtifactId + '/index.html');
      await parent.scrollIntoViewIfNeeded();
      await parent.click();
      await page.waitForURL(new RegExp('/versions/' + manifest.versions.find(version => version.id === leaf).parentArtifactId + '/'));
    }
    const challenge = join(directory, 'versions', manifest.featuredId, 'challenge.json');
    try {
      const evidence = JSON.parse(await readFile(challenge, 'utf8'));
      const game = await browser.newPage({ viewport: { width: 1200, height: 800 } });
      const gameExternal = [];
      await game.route('**/*', route => {
        const url = route.request().url();
        if (escaped(url, server.origin)) { gameExternal.push(url); return route.abort(); }
        return route.continue();
      });
      const errors = [];
      const gameFailures = [];
      game.on('pageerror', error => errors.push(error.message));
      game.on('response', response => recordFailure(response, gameFailures));
      await game.goto(server.origin + 'versions/' + manifest.featuredId + '/frame.html?test=1&quality=low');
      await game.waitForFunction(() => window.roadsterReady && window.roadsterChallengeSnapshot);
      const before = await game.evaluate(() => { roadsterChallengeStart({ borrow: false }); return roadsterChallengeAdvance(1200); });
      assert.equal(before.phase, 'missed');
      assert.ok(Math.abs(before.landing.position.x - evidence.measurement.baseline.landing.position.x) < 1e-6);
      const after = await game.evaluate(() => { roadsterChallengeStart({ borrow: true, demo: true }); return roadsterChallengeAdvance(1200); });
      assert.equal(after.phase, 'landed');
      assert.ok(Math.abs(after.landing.position.x - evidence.measurement.transferred.landing.position.x) < 1e-6);
      assert.deepEqual(errors, []);
      assert.deepEqual(gameExternal, []);
      assert.deepEqual(gameFailures, []);
      await game.close();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const featured = manifest.versions.find(version => version.id === manifest.featuredId);
    const cold = await browser.newPage();
    const coldExternal = [];
    try {
      await cold.route('**/*', route => {
        const url = route.request().url();
        if (escaped(url, server.origin)) { coldExternal.push(url); return route.abort(); }
        return route.continue();
      });
      const coldErrors = [];
      const coldFailures = [];
      cold.on('pageerror', error => coldErrors.push(error.message));
      cold.on('response', response => recordFailure(response, coldFailures));
      await cold.goto(server.origin + featured.play);
      await cold.reload();
      const downloaded = await cold.evaluate(async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw Error('download failed');
        return [...new Uint8Array(await response.arrayBuffer())];
      }, new URL(featured.download, server.origin).href);
      assert.equal(sha256(Buffer.from(downloaded)), manifest.files[featured.download]);
      assert.deepEqual(coldErrors, []);
      assert.deepEqual(coldExternal, []);
      assert.deepEqual(coldFailures, []);
    } finally { await cold.close(); }
    assert.deepEqual(httpFailures, []);
    assert.deepEqual(external, []);
  } finally {
    await browser.close();
    await server.close();
  }
}
