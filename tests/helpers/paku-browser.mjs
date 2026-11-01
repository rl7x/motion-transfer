import { chromium } from 'playwright';
import { createPreviewServer } from '../../web/server.mjs';

export async function createPakuBrowser(options = {}) {
  const server = await createPreviewServer(options);
  let browser;
  try {
    browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true,
      env: { PATH: process.env.PATH ?? '', ...(process.env.HOME ? { HOME: process.env.HOME } : {}), ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}) },
    });
  } catch (error) { await server.close(); throw error; }
  return {
    origin: server.origin,
    async page(mode = 'original') {
      const page = await browser.newPage({ viewport: { width: 500, height: 300 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.request().url().startsWith(server.origin + '/') ? route.continue() : route.abort());
      await page.goto(`${server.origin}/play?mode=${mode}&test=1`);
      await page.waitForFunction(() => window.pakuReady === true);
      return { page, errors };
    },
    async close() { await browser.close(); await server.close(); },
  };
}

export async function startPaku(page) {
  await page.keyboard.down('Space');
  await page.evaluate(() => gameClock.advance());
  await page.keyboard.up('Space');
  await page.evaluate(() => gameClock.advance());
  return page.evaluate(() => pakuSnapshot());
}

export async function replayPaku(page, steps) {
  const observations = [await startPaku(page)];
  let turn = false, dash = false;
  for (const step of steps) {
    for (const [name, previous, code] of [['turn', turn, 'Space'], ['dash', dash, 'KeyD']]) {
      const next = Boolean(step[name]);
      if (next !== previous) await page.keyboard[next ? 'down' : 'up'](code);
    }
    turn = Boolean(step.turn); dash = Boolean(step.dash);
    await page.evaluate(frames => gameClock.advance(frames), step.frames);
    observations.push(await page.evaluate(() => pakuSnapshot()));
  }
  return observations;
}
