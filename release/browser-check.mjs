import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from './sha.mjs';
import { createStaticReleaseServer, RELEASE_CHECK_BASE_PATH } from './static-server.mjs';

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
    page.on('pageerror', error => shellErrors.push(error.message));
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path.includes('/api/')) apiRequests.push(path);
    });
    await page.goto(server.origin + 'index.html');
    await page.waitForFunction(() => window.__MOTION_TRANSFER__?.generation === 'playback-only');
    try { await page.waitForSelector('#hybrid-title', { timeout: 45_000 }); }
    catch { throw Error('Playback shell did not render the saved transfer. ' + shellErrors.join('\n')); }
    if (shellErrors.length) throw Error(shellErrors.join('\n'));
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
      game.on('pageerror', error => errors.push(error.message));
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
      cold.on('pageerror', error => coldErrors.push(error.message));
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
    } finally { await cold.close(); }
    assert.deepEqual(external, []);
  } finally {
    await browser.close();
    await server.close();
  }
}
