import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { chromium } from 'playwright';

export const exec = promisify(execFile);
export const cleanEnv = () => ({ PATH: process.env.PATH ?? '', ...(process.env.HOME ? { HOME: process.env.HOME } : {}), ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}) });

export async function extractIntegration(project) {
  const directory = await mkdtemp(join(tmpdir(), 'motion-transfer-export-'));
  const archive = join(directory, 'project.zip');
  try {
    await writeFile(archive, project.zip);
    // Exercise the delivered ZIP with a system extractor, not the ZIP writer.
    await exec('unzip', ['-q', archive, '-d', directory]);
    return { directory: join(directory, 'jujump-dash'), close: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

export async function serveIntegration(directory) {
  const child = spawn(process.execPath, ['serve.mjs', '0'], { cwd: directory, env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', stderr = '';
  child.stderr.on('data', bytes => { stderr += bytes; });
  const exited = once(child, 'exit');
  try {
    const origin = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill(); reject(Error('Standalone server startup timeout: ' + stderr)); }, 8000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', () => { clearTimeout(timeout); reject(Error('Standalone server exited: ' + stderr)); });
      child.stdout.on('data', bytes => {
        output += bytes;
        const found = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (found) { clearTimeout(timeout); resolve(found[0]); }
      });
    });
    return { origin, close: async () => { if (child.exitCode === null) child.kill('SIGTERM'); await exited; } };
  } catch (error) { child.kill(); throw error; }
}

export async function integrationBrowser(origin) {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true, env: cleanEnv() });
  const externalRequests = [], methods = [];
  async function page(options = {}) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, ...options });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      methods.push(route.request().method());
      if (route.request().url().startsWith(origin + '/')) return route.continue();
      externalRequests.push(route.request().url()); return route.abort();
    });
    return { page, errors };
  }
  return { origin, browser, externalRequests, methods, page, close: () => browser.close() };
}
