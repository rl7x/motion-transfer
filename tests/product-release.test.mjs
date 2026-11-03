import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPakuBrowser } from '../evaluator/browser-harness.mjs';
import { createLabService } from '../lab/service.mjs';
import { loadSavedRoadster } from '../roadster/saved.mjs';

const shot = join('reports', 'product-review');

test('the challenge keeps one 3D player, a local share address, and the saved ability', async () => {
  const harness = await createPakuBrowser();
  try {
    const { page, errors } = await harness.page();
    const posts = [];
    page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(harness.origin+'/?destination=roadster');
    await page.waitForFunction(() => window.currentDestination === 'roadster' && document.querySelector('#transfer-status')?.textContent === 'VERIFIED TRANSFER', undefined, { timeout: 90000 });
    assert.equal(await page.locator('.games iframe').count(), 1);
    assert.equal(await page.locator('#original-game').count(), 0);
    assert.equal(await page.locator('canvas').count(), 0);
    assert.equal(await page.locator('#confirm-age').count(), 0);
    assert.equal(await page.locator('#model-policy').count(), 0);
    assert.equal(await page.locator('#age-acknowledgment').count(), 0);
    assert.match(await page.locator('.compact-ability').innerText(), /SAVED RECOVERY/);
    assert.doesNotMatch(await page.locator('.compact-ability').innerText(), /completed success|fresh campaign/i);
    assert.match(await page.locator('#supported-capabilities').innerText(), /fresh press/i);
    assert.match(await page.locator('#supported-capabilities').innerText(), /Not supported: one dash per flight/);
    assert.match(await page.locator('#inherited-intent').innerText(), /Saved transfer/);
    assert.match(await page.locator('#audience-notice').innerText(), /18 and older/);
    assert.match(await page.locator('#guided-progress').innerText(), /no model request/i);
    await page.locator('#privacy-note > summary').click();
    const privacy = await page.locator('#privacy-note').innerText();
    assert.match(privacy, /until an operator deletes them/i);
    assert.match(privacy, /does not send data to a third-party/i);
    assert.match(privacy, /does not collect anonymous aggregate/i);
    assert.match(privacy, /muse-spark-1\.3/);
    assert.match(privacy, /Contributor mode is only for authorized project development/);
    assert.doesNotMatch(privacy, /automatically deleted|30 days|google analytics/i);
    await page.locator('[data-challenge="borrow"]').click();
    await page.waitForFunction(() => /Dash borrowed/.test(document.querySelector('#challenge-result')?.textContent ?? ''));
    assert.deepEqual(posts, []);
    await page.locator('[data-share-challenge]').click();
    await page.waitForFunction(() => /not a public share link/i.test(document.querySelector('#challenge-share-status')?.textContent ?? ''));
    const address = await page.locator('#share-fallback').inputValue();
    assert.match(address, /^http:\/\/127\.0\.0\.1:\d+\/roadster\/play\/[a-f0-9]{64}$/);
    assert.doesNotMatch(await page.locator('#challenge-share-status').innerText(), /vercel|github\.io|pages\.dev/i);
    assert.equal(await page.getByRole('dialog').count(), 0);
    await mkdir(shot, { recursive: true });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: join(shot, 'playback-without-banner-desktop.png') });
    await page.locator('.challenge-section').evaluate(element => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: join(shot, 'challenge-desktop.png') });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
    assert.match(await page.locator('#challenge-result').innerText(), /Dash borrowed|Launch/);
    assert.deepEqual(errors, []);
    assert.deepEqual(posts, []);

    const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const mobile = await context.newPage();
    const mobileErrors = [];
    mobile.on('pageerror', error => mobileErrors.push(error.message));
    await mobile.goto(harness.origin+'/?destination=roadster');
    await mobile.waitForFunction(() => document.querySelector('#transfer-status')?.textContent === 'VERIFIED TRANSFER', undefined, { timeout: 90000 });
    assert.equal(await mobile.locator('.games iframe').count(), 1);
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await mobile.locator('[data-challenge="borrow"]').tap();
    await mobile.waitForFunction(() => /Dash borrowed/.test(document.querySelector('#challenge-result')?.textContent ?? ''));
    await mobile.screenshot({ path: join(shot, 'challenge-390.png') });
    await mobile.setViewportSize({ width: 320, height: 740 });
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await mobile.screenshot({ path: join(shot, 'challenge-320.png') });
    assert.deepEqual(mobileErrors, []);
    await context.close();
  } finally { await harness.close(); }
});

test('an 18+ confirmation blocks a new adaptation and a rejected request leaves the parent playing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'product-age-'));
  const base = await loadSavedRoadster();
  let calls = 0;
  const lab = await createLabService({
    directory, client: {}, baseArtifact: base,
    generateTransfer: async () => {
      calls += 1;
      throw Error('Unsupported request: one dash per flight is not a supported edit.');
    },
  });
  const harness = await createPakuBrowser({ lab });
  try {
    const { page, errors } = await harness.page();
    const posts = [];
    page.on('request', request => { if (request.method() === 'POST') posts.push(new URL(request.url()).pathname); });
    await page.goto(harness.origin+'/?destination=roadster');
    await page.waitForFunction(() => window.currentRoadsterArtifact && document.querySelector('#transfer-game') && !document.querySelector('#roadster-submit').disabled, undefined, { timeout: 90000 });
    await page.locator('#roadster-prompt').fill('Give me one air dash, and restore it when I land.');
    await page.locator('#roadster-submit').click();
    await page.waitForFunction(() => document.querySelector('#age-required')?.textContent.includes('18 or older'));
    assert.equal(calls, 0);
    assert.deepEqual(posts, []);
    assert.equal(await page.locator('.games iframe').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(calls, 0);
    await page.locator('#roadster-submit').click();
    await page.locator('#confirm-age').press('Space');
    await page.locator('#roadster-submit').click();
    await page.waitForFunction(() => /No new version was saved/.test(document.querySelector('#roadster-progress')?.textContent ?? ''), undefined, { timeout: 30000 });
    assert.equal(calls, 1);
    assert.deepEqual(posts, ['/api/roadster/transfers']);
    assert.equal(await page.evaluate(() => window.currentRoadsterArtifact.id), base.id);
    assert.equal(await page.locator('.games iframe').count(), 1);
    assert.equal(await page.locator('#transfer-game').count(), 1);
    assert.match(await page.locator('#roadster-progress').innerText(), /playable parent stays as it is/);
    assert.deepEqual(errors, []);
  } finally { await harness.close(); await lab.close(); await rm(directory, { recursive: true, force: true }); }
});

test('reconnecting a stored adaptation polls the same job and does not POST', async () => {
  const harness = await createPakuBrowser();
  try {
    const { page, errors } = await harness.page();
    const posts = [];
    const gets = [];
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (request.method() === 'POST') posts.push(path);
      if (request.method() === 'GET' && path.startsWith('/api/roadster/transfers/')) gets.push(path);
    });
    await page.addInitScript(pending => {
      try { sessionStorage.setItem('motion-roadster-request', JSON.stringify(pending)); } catch { /* Sandboxed game frames cannot use this storage. */ }
    }, {
      request: {
        idempotencyKey: 'product-reconnect-01',
        parentArtifactId: 'a'.repeat(64),
        prompt: 'Make the dash half as long.',
      },
      id: '11111111-1111-4111-8111-111111111111',
    });
    await page.goto(harness.origin+'/?destination=roadster');
    await page.waitForFunction(() => window.currentRoadsterArtifact
      && document.querySelector('#roadster-submit')?.textContent.includes('Reconnect')
      && !document.querySelector('#roadster-submit').disabled, undefined, { timeout: 90000 });
    assert.ok(gets.length >= 1);
    const next = page.waitForRequest(request => request.method() === 'GET' && new URL(request.url()).pathname.startsWith('/api/roadster/transfers/'));
    await page.locator('#roadster-submit').click();
    await next;
    assert.ok(gets.length >= 2);
    assert.deepEqual(posts, []);
    assert.deepEqual(errors, []);
  } finally { await harness.close(); }
});

test('an injected playback catalog renders the challenge without the live catalog routes', async () => {
  const harness = await createPakuBrowser();
  try {
    const id = 'ab'.repeat(32);
    const componentId = 'cd'.repeat(32);
    const resources = {
      '/api/destinations': { destinations: [{
        id: 'roadster', name: 'RDSTR STUNTS', kind: 'A 3D Roadster stunt simulation', componentId,
        before: '/roadster/play?mode=original&quality=low', after: '/roadster/play?mode=transfer&quality=low',
        artifactId: id, aspect: 1.5, keeps: 'Its ramp.', carries: 'A six-meter air dash.',
        control: 'Hold X.', action: 'Run stunt', dashKey: 'X', liveEdits: ['distance', 'activation', 'direction'],
        report: '/roadster/report.json', source: '/roadster/adapter.ts', author: 'Saved adapter',
      }] },
      '/api/ability': { id: componentId, name: 'Dash' },
      '/api/transfer': { status: 'unavailable' },
      ['/api/roadster/artifacts/' + id]: {
        id, componentId, parentArtifactId: null,
        intent: { unitScale: 0.1, activation: 'held', direction: 'facing' },
        summary: 'Injected saved transfer',
      },
      ['/roadster/artifacts/' + id + '/report.json']: { conformance: { results: [{}] }, browser: { results: [{}] } },
      ['/api/roadster/challenge/' + id]: {
        id, componentId, play: '/roadster/challenge/' + id + '/play.html',
        download: '/roadster/challenge/' + id + '/download.html',
        source: '/roadster/challenge/' + id + '/source.json',
        report: '/roadster/challenge/' + id + '/challenge.json',
        target: { minX: 1, maxX: 2 },
        measurements: { baselineLandingX: 1, transferredLandingX: 2, netLandingShiftMeters: 1, durationSeconds: 13 },
      },
    };
    const { page, errors } = await harness.page();
    const hits = [];
    await page.addInitScript(data => { window.__MOTION_TRANSFER__ = data; }, { generation: 'playback-only', resources });
    await page.route('**/*', route => {
      const path = new URL(route.request().url()).pathname;
      if (Object.prototype.hasOwnProperty.call(resources, path)) { hits.push(path); return route.abort(); }
      return route.continue();
    });
    await page.goto(harness.origin+'/?destination=roadster');
    await page.waitForFunction(expected => document.querySelector('#challenge-download')?.getAttribute('href') === expected, '/roadster/challenge/' + id + '/download.html');
    assert.deepEqual(hits, []);
    assert.equal(await page.locator('#confirm-age').count(), 0);
    assert.equal(await page.locator('#age-acknowledgment').count(), 0);
    assert.equal(await page.locator('#model-policy').count(), 0);
    assert.equal(await page.locator('#audience-notice').count(), 0);
    assert.match(await page.locator('#playback-note').innerText(), /cannot start a model request/i);
    assert.equal(await page.locator('#roadster-submit').isDisabled(), true);
    assert.equal(await page.locator('.games iframe').count(), 1);
    await page.locator('.challenge-context summary').click();
    assert.match(await page.locator('.challenge-context').innerText(), /1\.00 m/);
    assert.deepEqual(errors, []);
  } finally { await harness.close(); }
});
