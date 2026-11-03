import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { loadAcceptedRoadster } from './accepted-roadster.mjs';
import { launchOptions, recordShot } from './capture.mjs';
import { startStaticServer } from './static-server.mjs';

const HARNESS = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; background: #101b16; color: #e3f3dd; }
    iframe { display: block; width: 1280px; height: 640px; border: 0; }
    #status { height: 80px; margin: 0; padding: 22px 28px; font: 28px/1.2 system-ui, sans-serif; }
  </style>
</head>
<body>
  <iframe id="game" src="/play.html?quality=low#channel=demo" title="Accepted Roadster challenge"></iframe>
  <p id="status" role="status">Loading the pinned challenge.</p>
  <script>
    const frame = document.querySelector('#game');
    const status = document.querySelector('#status');
    window.addEventListener('message', (event) => {
      if (event.source !== frame.contentWindow || event.data?.type !== 'challenge-status' || event.data.channel !== 'demo') return;
      const state = event.data.state || {};
      status.dataset.phase = state.phase || '';
      status.dataset.borrowed = state.borrowed ? 'true' : 'false';
      status.dataset.x = state.landing?.position?.x ?? '';
      status.textContent = state.phase === 'landed'
        ? 'Landed in the zone!'
        : state.phase === 'missed'
          ? 'Landed outside the zone.'
          : (state.phase || 'Ready');
    });
    window.__command = (action) => frame.contentWindow.postMessage({ type: 'challenge-command', channel: 'demo', action }, '*');
  </script>
</body>
</html>`;

async function hashFile(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function reuseClip(root, out, name) {
  const source = join(root, 'reports/demo/clips', name + '.webm');
  const bytes = await readFile(source);
  const file = join(out, 'clips', name + '.webm');
  await copyFile(source, file);
  return {
    file,
    reusedFrom: source,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    urlPath: null,
    external: [],
    pageErrors: [],
  };
}

async function captureLanding(page, tools, action) {
  await page.goto(tools.origin + '/harness.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const frame = document.querySelector('#game');
    return frame?.contentWindow?.roadsterChallengeSnapshot;
  });
  await page.evaluate(next => window.__command(next), action);
  await page.waitForFunction(() => ['missed', 'landed'].includes(document.querySelector('#status')?.dataset.phase), null, { timeout: 30000 });
  const state = await page.evaluate(() => ({
    phase: document.querySelector('#status').dataset.phase,
    borrowed: document.querySelector('#status').dataset.borrowed === 'true',
    x: Number(document.querySelector('#status').dataset.x),
    text: document.querySelector('#status').textContent,
  }));
  return { result: state.text, landing: state };
}

async function materializePublication(projectPath, directory) {
  const project = JSON.parse(await readFile(projectPath, 'utf8'));
  for (const [name, contents] of Object.entries(project.files)) {
    if (name.split('/').includes('..')) throw Error('Publication file escapes the player directory');
    const file = join(directory, name);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, contents);
  }
}

async function captureJujump(page, tools) {
  await page.goto(tools.origin + '/', { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({
    content: `header, h1, .eyebrow, .lede, .note, .actions, #comparison-status, .handoff, .players article:first-of-type, article h2, article p { display: none !important; }
      main { max-width: none; width: 1280px; margin: 0; padding: 0; }
      .players { display: block; }
      .players article { width: 1280px; border: 0; background: #101010; }
      iframe#after { width: 1280px; height: 720px; aspect-ratio: auto; }
      .controls { position: fixed; left: 16px; bottom: 16px; z-index: 5; }`,
  });
  const jump = page.locator('button[data-frame="after"][data-key="Space"]');
  const dash = page.locator('button[data-frame="after"][data-key="KeyD"]');
  await page.waitForFunction(() => {
    const button = document.querySelector('button[data-frame="after"][data-key="KeyD"]');
    return button && !button.disabled;
  });
  const content = tools.mark();
  const canvas = page.frameLocator('#after').locator('canvas');
  await canvas.click({ position: { x: 80, y: 80 } });
  await page.keyboard.press('Space');
  await page.waitForTimeout(700);
  await hold(page, dash, 1400);
  await jump.click();
  await page.waitForTimeout(600);
  await hold(page, dash, 1400);
  await jump.click();
  await page.waitForTimeout(800);
  await hold(page, dash, 1200);
  await page.waitForTimeout(1500);
  return { marks: { content }, result: 'pinned JUJUMP player' };
}

async function hold(page, locator, ms) {
  const box = await locator.boundingBox();
  if (!box) throw Error('JUJUMP dash control is not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

function closeEnough(actual, expected) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= 0.05;
}

export async function captureAccepted({ root, out, headed = false }) {
  const proof = await loadAcceptedRoadster(root);
  await mkdir(join(out, 'clips'), { recursive: true });
  await mkdir(join(out, 'stills'), { recursive: true });
  const player = join(out, 'jujump-player');
  await materializePublication(proof.publicationProject, player);
  const challengeServer = await startStaticServer(proof.challengeDir, { '/harness.html': HARNESS });
  const playerServer = await startStaticServer(player);
  const shots = {};
  let browser;
  try {
    const servedPlay = await (await fetch(challengeServer.origin + '/play.html')).text();
    if (createHash('sha256').update(servedPlay).digest('hex') !== proof.playSha256) {
      throw Error('Served challenge HTML does not match the pinned play.html hash');
    }
    browser = await chromium.launch(launchOptions(headed));
    console.log('capture accepted original');
    shots.original = await recordShot(browser, challengeServer.origin, out, 'original', (page, tools) => captureLanding(page, tools, 'original'));
    console.log('capture accepted borrowed');
    shots.borrowed = await recordShot(browser, challengeServer.origin, out, 'borrowed', (page, tools) => captureLanding(page, tools, 'demonstrate'));
    const ordinary = shots.original.landing;
    const borrowed = shots.borrowed.landing;
    if (ordinary?.phase !== 'missed' || ordinary.borrowed !== false || !closeEnough(ordinary.x, proof.zone.baselineX)) {
      throw Error('Pinned ordinary landing did not miss at the recorded coordinate');
    }
    if (borrowed?.phase !== 'landed' || borrowed.borrowed !== true || !closeEnough(borrowed.x, proof.zone.transferredX)) {
      throw Error('Pinned borrowed landing did not hit at the recorded coordinate');
    }
    const savedCapturePath = join(root, 'reports/demo/capture.json');
    const savedCapture = JSON.parse(await readFile(savedCapturePath, 'utf8'));
    console.log('reuse donor, remix, credits');
    shots.donor = await reuseClip(root, out, 'donor');
    shots.remix = await reuseClip(root, out, 'remix');
    shots.credits = await reuseClip(root, out, 'credits');
    if (savedCapture.donorDashVisible !== true) shots.donor.dashUnconfirmed = true;
    console.log('capture pinned jujump');
    shots.jujump = await recordShot(browser, playerServer.origin, out, 'jujump', captureJujump);
    const servedProvenance = await (await fetch(playerServer.origin + '/component/provenance.json')).json();
    if (servedProvenance.id !== proof.componentId) throw Error('Pinned JUJUMP player component does not match the receipt');
    const capture = {
      schemaVersion: 1,
      mode: 'accepted-roadster',
      createdAt: new Date().toISOString(),
      origin: challengeServer.origin,
      playerOrigin: playerServer.origin,
      headed,
      creation: { disabled: true, requests: 0 },
      proof,
      measurements: {
        baselineLandingX: proof.zone.baselineX,
        transferredLandingX: proof.zone.transferredX,
        netLandingShiftMeters: proof.zone.shift,
        targetMinX: proof.zone.targetMin,
        targetMaxX: proof.zone.targetMax,
        liveBaselineLandingX: ordinary.x,
        liveTransferredLandingX: borrowed.x,
        ordinaryOutsideTarget: true,
        borrowedInsideTarget: true,
      },
      remixAvailable: true,
      donorDashVisible: savedCapture.donorDashVisible === true,
      reusedFrom: savedCapturePath,
      shots,
    };
    await writeFile(join(out, 'capture.json'), JSON.stringify(capture, null, 2) + '\n');
    return capture;
  } catch (error) {
    await writeFile(join(out, 'capture-error.json'), JSON.stringify({ message: error.message, shots: Object.keys(shots) }, null, 2) + '\n').catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    await challengeServer.close();
    await playerServer.close();
  }
}

export async function reusedClipHash(file) {
  return hashFile(file);
}
