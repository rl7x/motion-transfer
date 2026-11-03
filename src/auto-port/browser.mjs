import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

/** Inject the host runtime ahead of the game's first script, the only change to the page. */
export function injectRuntime(html) {
  const tag = '<script src="/__motion-dash.js"></script>';
  const at = html.indexOf('<script');
  if (at !== -1) return html.slice(0, at) + tag + html.slice(at);
  return html.replace('</head>', tag + '</head>');
}

export function serveGame(directory, runtime) {
  const server = createServer(async (request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, 'http://game').pathname));
    try {
      if (path === '/__motion-dash.js') return response.writeHead(200, { 'Content-Type': TYPES['.js'] }).end(runtime);
      if (path === '/favicon.ico') return response.writeHead(204).end();
      const file = path === '/' ? 'index.html' : path.slice(1);
      if (file.split('/').includes('..')) return response.writeHead(403).end();
      const bytes = await readFile(join(directory, file));
      const body = extname(file) === '.html' ? injectRuntime(bytes.toString('utf8')) : bytes;
      response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch { response.writeHead(404).end(); }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ origin: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(done => server.close(done)) })));
}

/** The patched game must load in a real page, start from real input and fire the dash. */
export async function runPortInBrowser({ directory, runtime, driver }) {
  const server = await serveGame(directory, runtime);
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || (process.platform === 'linux' ? 'chromium' : 'chrome'), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('**/*', route => {
      if (route.request().url().startsWith(server.origin)) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    await page.goto(server.origin, { waitUntil: 'load' });
    await page.waitForTimeout(600);
    const calls = () => page.evaluate(() => globalThis.MotionDash.calls);
    for (let round = 0; round < 8 && (await calls()) === 0; round += 1) {
      await page.mouse.click(480, 360);
      for (const key of ['Enter', 'Space', 'KeyZ']) { await page.keyboard.press(key); await page.waitForTimeout(120); }
      await page.waitForTimeout(600);
    }
    if ((await calls()) === 0) throw Error('The running page never reached MotionDash.update after start input');
    for (let round = 0; round < 6; round += 1) {
      await page.keyboard.down(driver.dashKey); await page.waitForTimeout(200); await page.keyboard.up(driver.dashKey); await page.waitForTimeout(150);
      if (await page.evaluate(() => globalThis.MotionDash.events.includes('dash-start'))) break;
    }
    if (!(await page.evaluate(() => globalThis.MotionDash.events.includes('dash-start')))) throw Error('The dash key never started a dash in the running page');
    if (errors.length) throw Error(`Page errors: ${errors.slice(0, 3).join(' | ')}`);
    if (external.length) throw Error(`External requests: ${external.slice(0, 3).join(' | ')}`);
    if (!(await page.locator('canvas').count())) throw Error('The page has no canvas');
    return { detail: `${await calls()} live updates, dash fired from ${driver.dashKey}` };
  } finally {
    await browser.close(); await server.close();
  }
}
