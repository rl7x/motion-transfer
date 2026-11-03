import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ROADSTER_CHALLENGE } from '../roadster/challenge-contract.mjs';
import { assertCreationDisabled, startRecordingServer } from './server.mjs';

const SAVED_REMIX_ID = 'f67245c401fc82cfd516d6e333fe67dad2acfd232ca7607baea6a6d05d912fbf';
const ONE_GAME = `
  .donor-card, article.game-card:not(.transferred) { display: none !important; }
  .games { display: block !important; }
  article.transferred { max-width: 960px; margin: 24px auto; }
`;

function launchOptions(headed) {
  return {
    channel: process.env.BROWSER_CHANNEL || 'chrome',
    headless: !headed,
    args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      TMPDIR: process.env.TMPDIR ?? '',
    },
  };
}

async function guard(page, origin, log) {
  page.setDefaultTimeout(240000);
  page.on('pageerror', error => log.pageErrors.push(error.message));
  await page.route('**/*', route => {
    const request = route.request();
    const url = request.url();
    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      log.posts.push(url);
      return route.abort();
    }
    if (url.startsWith(origin + '/') || url.startsWith('blob:') || url.startsWith('data:')) return route.continue();
    log.external.push(url);
    return route.abort();
  });
}

async function settleAge(page) {
  const box = page.locator('#confirm-age');
  if (await box.count() && await box.isVisible() && !(await box.isChecked())) await box.check();
}

async function park(page, selector, top) {
  await page.locator(selector).first().waitFor({ state: 'visible' });
  await page.evaluate(({ selector: target, top: requested }) => {
    const node = document.querySelector(target);
    const rect = node.getBoundingClientRect();
    const desired = requested ?? Math.max(88, window.innerHeight - 124 - rect.height);
    window.scrollBy(0, rect.top - desired);
  }, { selector, top: top ?? null });
}

async function holdPointer(page, locator, ms) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw Error('A playback control is not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

async function scrollToText(page, selector, needle) {
  const found = await page.evaluate(({ selector: target, needle: phrase }) => {
    const node = document.querySelector(target);
    if (!node) return false;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const wanted = phrase.toLowerCase();
    let current;
    while ((current = walker.nextNode())) {
      const index = current.textContent.toLowerCase().indexOf(wanted);
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(current, index);
      range.setEnd(current, Math.min(current.textContent.length, index + phrase.length));
      const rect = range.getBoundingClientRect();
      window.scrollBy(0, rect.top - 150);
      return true;
    }
    return false;
  }, { selector, needle });
  if (!found) throw Error('Could not show the recorded sentence: ' + needle);
}

async function recordShot(browser, origin, directory, name, action) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    recordVideo: { dir: join(directory, 'clips'), size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  const log = { posts: [], external: [], pageErrors: [] };
  const started = Date.now();
  const mark = () => Number(((Date.now() - started) / 1000).toFixed(3));
  let result = {};
  const video = page.video();
  try {
    await guard(page, origin, log);
    result = await action(page, { mark, origin, still: join(directory, 'stills', name + '.png') }) ?? {};
    await page.screenshot({ path: join(directory, 'stills', name + '.png') }).catch(() => {});
  } finally {
    await context.close();
  }
  const raw = await video.path();
  const file = join(directory, 'clips', name + '.webm');
  await rename(raw, file);
  if (log.posts.length) throw Error(name + ' attempted a request that was not a read');
  return {
    ...result,
    file,
    wallClockMs: Date.now() - started,
    external: [...new Set(log.external)].slice(0, 20),
    pageErrors: log.pageErrors.slice(0, 15),
  };
}

async function openHome(page, origin) {
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await settleAge(page);
}

async function waitForChallenge(page) {
  await page.waitForFunction(() => document.querySelector('#hybrid-title')?.textContent?.includes('Land in the green zone'));
  await page.waitForFunction(() => document.querySelector('#transfer-status')?.textContent === 'VERIFIED TRANSFER' && !document.querySelector('[data-challenge="original"]')?.disabled);
  await page.locator('.challenge-card').scrollIntoViewIfNeeded();
}

async function captureLanding(page, tools, which) {
  await openHome(page, tools.origin);
  await waitForChallenge(page);
  const selector = which === 'original' ? '[data-challenge="original"]' : '#watch-transfer';
  const expected = which === 'original' ? 'Outside the zone' : 'Landed in the zone';
  const content = tools.mark();
  await page.locator(selector).click();
  await page.waitForFunction(phrase => (document.querySelector('#challenge-result')?.textContent ?? '').includes(phrase), expected);
  await park(page, '#challenge-result');
  await page.waitForTimeout(3500);
  const result = (await page.locator('#challenge-result').innerText()).replace(/\s+/g, ' ').trim();
  if (!result.includes(expected)) throw Error(which + ' result was ' + result);
  const artifactId = await page.evaluate(() => window.currentRoadsterArtifact?.id ?? null);
  return { urlPath: '/', result, artifactId, marks: { content } };
}

async function captureDonor(page, tools) {
  await page.goto(tools.origin + '/donor/play', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.donorReady === true);
  const content = tools.mark();
  await page.locator('wasm4-app').click({ force: true }).catch(() => {});
  await page.keyboard.press('KeyX');
  await page.waitForTimeout(700);
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('KeyX');
  let dashed = false;
  let status = 'unknown';
  for (let step = 0; step < 30 && !dashed; step += 1) {
    const snap = await page.evaluate(() => window.donorSnapshot?.() ?? null);
    status = snap?.status ?? status;
    if (snap?.remaining > 0) dashed = true;
    else await page.waitForTimeout(150);
  }
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyX');
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(600);
  return { urlPath: '/donor/play', dashed, status, marks: { content } };
}

async function captureAbility(page, tools) {
  await openHome(page, tools.origin);
  await page.waitForFunction(() => document.body.innerText.includes('SAVED RECOVERY'));
  const content = tools.mark();
  await park(page, '.ability-card', 110);
  await page.waitForTimeout(5000);
  return { urlPath: '/', marks: { content } };
}

async function capturePixel(page, tools, destination) {
  await page.goto(tools.origin + '/?destination=' + destination, { waitUntil: 'domcontentloaded' });
  await settleAge(page);
  await page.waitForFunction(() => document.querySelector('#transfer-status')?.textContent === 'VERIFIED TRANSFER');
  await page.addStyleTag({ content: ONE_GAME });
  const turn = page.locator('article.transferred [data-turn]');
  const dash = page.locator('article.transferred [data-dash]');
  await page.waitForFunction(() => {
    const button = document.querySelector('article.transferred [data-dash]');
    return button && !button.disabled;
  });
  const content = tools.mark();
  if (destination === 'jujump') {
    await page.locator('#shared-component').scrollIntoViewIfNeeded();
    await page.waitForTimeout(6000);
  }
  await page.locator('article.transferred').scrollIntoViewIfNeeded();
  await holdPointer(page, turn, destination === 'jujump' ? 280 : 400);
  await page.waitForTimeout(350);
  await holdPointer(page, dash, destination === 'jujump' ? 1800 : 2200);
  await page.waitForTimeout(destination === 'jujump' ? 12000 : 1200);
  const dashState = (await page.locator('#dash-state').innerText()).replace(/\s+/g, ' ').trim();
  const component = (await page.locator('#shared-component').innerText()).replace(/\s+/g, ' ').trim();
  return {
    urlPath: '/?destination=' + destination,
    dashState,
    dashVisible: /DASH ACTIVE|RECHARGING/.test(dashState),
    component,
    framing: 'donor and before cards hidden so one transferred game fills the shot',
    marks: { content },
  };
}

async function captureInvestigation(page, tools) {
  await openHome(page, tools.origin);
  await page.locator('#evidence-details > summary').click();
  await page.locator('#view-investigation').scrollIntoViewIfNeeded();
  const content = tools.mark();
  await page.waitForTimeout(2500);
  await page.locator('#view-investigation').click();
  await page.waitForFunction(() => document.querySelector('#lab-mode')?.textContent === 'SAVED RECORDING');
  await page.waitForFunction(() => (document.querySelector('#investigation-conclusion')?.textContent ?? '').toLowerCase().includes('rejects preservation hypothesis'));
  await page.locator('#investigation-hypothesis').scrollIntoViewIfNeeded();
  await page.waitForTimeout(4500);
  await scrollToText(page, '#investigation-conclusion', 'rejects preservation hypothesis');
  const rejection = tools.mark();
  await page.waitForTimeout(21000);
  const mode = (await page.locator('#lab-mode').innerText()).trim();
  return { urlPath: '/', mode, marks: { content, rejection } };
}

async function captureEvidence(page, tools, measurements) {
  await openHome(page, tools.origin);
  await waitForChallenge(page);
  const summary = page.locator('summary', { hasText: 'See the matched-input evidence' });
  await summary.click();
  const base = measurements.baselineLandingX.toFixed(2);
  const moved = measurements.transferredLandingX.toFixed(2);
  await page.waitForFunction(({ base: left, moved: right }) => {
    const text = document.body.innerText;
    return text.includes(left) && text.includes(right);
  }, { base, moved });
  const content = tools.mark();
  await park(page, '.challenge-context');
  await page.waitForTimeout(20000);
  return { urlPath: '/', marks: { content } };
}

async function captureRemix(browser, origin, directory) {
  const listed = await fetch(origin + '/api/roadster/artifacts/' + SAVED_REMIX_ID);
  if (listed.status === 404) return recordForm(browser, origin, directory);
  if (!listed.ok) throw Error('Saved remix lookup failed with status ' + listed.status);
  const probeContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const probe = await probeContext.newPage();
  const log = { posts: [], external: [], pageErrors: [] };
  let ready = false;
  try {
    await guard(probe, origin, log);
    await probe.goto(origin + '/roadster/play/' + SAVED_REMIX_ID, { waitUntil: 'domcontentloaded' });
    await settleAge(probe);
    await probe.waitForFunction(() => /Press to dash/.test(document.querySelector('[data-dash]')?.textContent ?? ''), null, { timeout: 240000 });
    ready = true;
  } catch {
    ready = false;
  } finally {
    await probeContext.close();
  }
  if (log.posts.length) throw Error('Remix probe attempted a request that was not a read');
  if (!ready) throw Error('Saved remix artifact loaded, but the fresh-press control did not appear');
  return recordShot(browser, origin, directory, 'remix', async (page, tools) => {
    await page.goto(origin + '/roadster/play/' + SAVED_REMIX_ID, { waitUntil: 'domcontentloaded' });
    await settleAge(page);
    await page.waitForFunction(() => /Press to dash/.test(document.querySelector('[data-dash]')?.textContent ?? '') && document.querySelector('#transfer-status')?.textContent === 'CHECKED REMIX');
    const content = tools.mark();
    await park(page, '[data-dash]', 430);
    await page.waitForTimeout(8000);
    const mapping = (await page.locator('#checked-mapping').innerText()).replace(/\s+/g, ' ').trim();
    if (!/3m backward/i.test(mapping)) throw Error('Saved remix mapping was not the 3 m backward child');
    await park(page, '#checked-mapping', 180);
    await page.waitForTimeout(12000);
    const button = (await page.locator('[data-dash]').innerText()).replace(/\s+/g, ' ').trim();
    return {
      urlPath: '/roadster/play/' + SAVED_REMIX_ID,
      artifactId: SAVED_REMIX_ID,
      available: true,
      button,
      mapping,
      marks: { content },
    };
  });
}

async function recordForm(browser, origin, directory) {
  return recordShot(browser, origin, directory, 'remix-form', async (page, tools) => {
    await openHome(page, tools.origin);
    await page.locator('#remix-heading').scrollIntoViewIfNeeded();
    const content = tools.mark();
    await park(page, '#remix-heading', 140);
    await page.waitForTimeout(12000);
    return { urlPath: '/', available: false, marks: { content } };
  });
}

async function captureCredits(page, tools) {
  await openHome(page, tools.origin);
  await page.locator('footer').scrollIntoViewIfNeeded();
  const footer = (await page.locator('footer').innerText()).replace(/\s+/g, ' ').trim();
  if (!/willGuimont/.test(footer) || !/Kenta Cho/.test(footer) || !/sebayaki/.test(footer)) {
    throw Error('Footer is missing an upstream credit');
  }
  const content = tools.mark();
  await park(page, 'footer');
  await page.waitForTimeout(14000);
  return { urlPath: '/', footer, marks: { content } };
}

async function challengeReady(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const log = { posts: [], external: [], pageErrors: [] };
  try {
    await guard(page, origin, log);
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (document.querySelector('#hybrid-title')?.textContent ?? '').length > 0);
    const title = (await page.locator('#hybrid-title').innerText()).replace(/\s+/g, ' ').trim();
    return { ready: title.includes('green zone'), title, external: [...new Set(log.external)].slice(0, 10), posts: log.posts };
  } finally {
    await context.close();
  }
}

async function readMeasurements(origin, parentId) {
  const summary = await (await fetch(origin + '/api/roadster/challenge/' + parentId)).json();
  const verification = await (await fetch(origin + '/roadster/challenge/' + parentId + '/challenge.json')).json();
  const frames = verification.measurement?.transferred?.frames ?? [];
  const active = frames.filter(frame => frame.motion?.output?.ownsMotion);
  const dashMeters = active.reduce((sum, frame) => sum + Number(frame.motion.output.displacement), 0);
  return {
    parentArtifactId: parentId,
    componentId: summary.componentId,
    challengeRecordId: summary.id,
    contractId: summary.target?.minX === ROADSTER_CHALLENGE.target.minX && summary.target?.maxX === ROADSTER_CHALLENGE.target.maxX
      ? ROADSTER_CHALLENGE.id : null,
    targetMinX: summary.target.minX,
    targetMaxX: summary.target.maxX,
    baselineLandingX: summary.measurements.baselineLandingX,
    transferredLandingX: summary.measurements.transferredLandingX,
    netLandingShiftMeters: summary.measurements.netLandingShiftMeters,
    dashActiveUpdates: active.length,
    dashMeters,
    controlFrames: verification.measurement?.controls?.length ?? null,
    ordinaryOutsideTarget: summary.ordinaryOutsideTarget === true,
    borrowedInsideTarget: summary.borrowedInsideTarget === true,
  };
}

export async function captureAll({ root, out, headed = false }) {
  await mkdir(join(out, 'clips'), { recursive: true });
  await mkdir(join(out, 'stills'), { recursive: true });
  const server = await startRecordingServer(root);
  const shots = {};
  let browser;
  try {
    const creation = await assertCreationDisabled(server.origin);
    browser = await chromium.launch(launchOptions(headed));
    let probe = await challengeReady(browser, server.origin);
    let usedHeaded = headed;
    if (!probe.ready && !headed) {
      await browser.close();
      usedHeaded = true;
      browser = await chromium.launch(launchOptions(true));
      probe = await challengeReady(browser, server.origin);
    }
    if (probe.posts?.length) throw Error('Challenge probe attempted a request that was not a read');
    if (!probe.ready) throw Error('Roadster challenge did not load (' + probe.title + '). One local 3D scene is required.');
    console.log('capture original');
    shots.original = await recordShot(browser, server.origin, out, 'original', (page, tools) => captureLanding(page, tools, 'original'));
    console.log('capture borrowed');
    shots.borrowed = await recordShot(browser, server.origin, out, 'borrowed', (page, tools) => captureLanding(page, tools, 'borrowed'));
    const measurements = await readMeasurements(server.origin, shots.original.artifactId);
    if (!measurements.ordinaryOutsideTarget || !measurements.borrowedInsideTarget) {
      throw Error('Challenge report does not show a miss and a landing in the zone');
    }
    console.log('capture donor');
    shots.donor = await recordShot(browser, server.origin, out, 'donor', captureDonor);
    console.log('capture ability');
    shots.ability = await recordShot(browser, server.origin, out, 'ability', captureAbility);
    console.log('capture paku');
    shots.paku = await recordShot(browser, server.origin, out, 'paku', (page, tools) => capturePixel(page, tools, 'paku-paku'));
    console.log('capture jujump');
    shots.jujump = await recordShot(browser, server.origin, out, 'jujump', (page, tools) => capturePixel(page, tools, 'jujump'));
    console.log('capture investigation');
    shots.investigation = await recordShot(browser, server.origin, out, 'investigation', captureInvestigation);
    console.log('capture evidence');
    shots.evidence = await recordShot(browser, server.origin, out, 'evidence', (page, tools) => captureEvidence(page, tools, measurements));
    console.log('capture remix');
    const remix = await captureRemix(browser, server.origin, out);
    shots[remix.available === false ? 'remix-form' : 'remix'] = remix;
    console.log('capture credits');
    shots.credits = await recordShot(browser, server.origin, out, 'credits', captureCredits);
    const capture = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      origin: server.origin,
      headed: usedHeaded,
      creation,
      webglProbe: { title: probe.title, external: probe.external },
      measurements,
      remixAvailable: remix.available !== false,
      donorDashVisible: shots.donor.dashed === true,
      shots,
    };
    await writeFile(join(out, 'capture.json'), JSON.stringify(capture, null, 2) + '\n');
    return capture;
  } catch (error) {
    await writeFile(join(out, 'capture-error.json'), JSON.stringify({
      message: error.message,
      shots: Object.keys(shots),
    }, null, 2) + '\n').catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    await server.close();
  }
}
