import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

/*
 * Saves everything a visitor can reach on the running site. Run it after the backend is updated
 * and after build:vercel, then deploy with --prebuilt. The page itself becomes static output, and
 * the rest sits beside the Function so saved games play with the backend asleep or paused.
 */
const ORIGIN = (process.argv[2] ?? 'https://motion-transfer-rl7x.vercel.app').replace(/\/$/, '');
const OUTPUT = '.vercel/output';
const SNAPSHOT = join(OUTPUT, 'functions/proxy.func/snapshot');
const STATIC = join(OUTPUT, 'static');
const KEPT_HEADERS = [
  'content-type',
  'content-disposition',
  'content-security-policy',
  'access-control-allow-origin',
];
const SIZE_LIMIT = 4 * 1024 * 1024; // The same limit the Function already applies.
// A visitor must always see these files, even if a browser skipped one during the crawl.
const REQUIRED = [
  '/',
  '/style.css',
  '/assets/app.js',
  '/api/catalog',
  '/api/remixes/status',
  '/api/parallaxia/base',
  '/donor/play',
];

const saved = new Map();
const failed = [];

async function keep(url, status, headers, read) {
  const { origin, pathname, search } = new URL(url);
  if (origin !== ORIGIN || status !== 200) return;
  const key = pathname + search;
  if (saved.has(key)) return;
  const bytes = await read().catch(() => null);
  if (!bytes || bytes.length > SIZE_LIMIT) {
    failed.push(key);
    return;
  }
  saved.set(key, {
    bytes,
    headers: Object.fromEntries(
      KEPT_HEADERS.filter((name) => headers[name]).map((name) => [name, headers[name]]),
    ),
  });
}

async function fetchInto(path) {
  const response = await fetch(ORIGIN + path, {
    redirect: 'error',
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    failed.push(`${path} (${response.status})`);
    return;
  }
  await keep(ORIGIN + path, 200, Object.fromEntries(response.headers), async () =>
    Buffer.from(await response.arrayBuffer()),
  );
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const waits = [];
context.on('response', (response) => {
  if (response.request().method() === 'GET')
    waits.push(keep(response.url(), response.status(), response.headers(), () => response.body()));
});
const page = await context.newPage();
const visit = async (path) => {
  await page
    .goto(ORIGIN + path, { waitUntil: 'load', timeout: 60_000 })
    .catch((error) => failed.push(`${path}: ${error.message.split('\n')[0]}`));
  await page.waitForTimeout(1500);
};

await visit('/');
const catalog = await (await fetch(ORIGIN + '/api/catalog')).json();
const base = await (await fetch(ORIGIN + '/api/parallaxia/base')).json();
for (const path of REQUIRED) await fetchInto(path);

// Everything the catalog links to, for each saved version and parent.
const links = new Set();
const collect = (value) => {
  if (
    typeof value === 'string' &&
    /^\/(artifacts|parents|parallaxia|roadster|accepted|jujump|paku)/.test(value) &&
    !value.includes(':')
  )
    links.add(value);
  else if (value && typeof value === 'object') Object.values(value).forEach(collect);
};
collect(catalog);
collect(base);
for (const entry of [...catalog.artifacts, ...catalog.versions]) {
  for (const part of [
    'receipt.json',
    'generation.json',
    'adapter.ts',
    'adapter.js',
    'notices.txt',
    'download.zip',
  ])
    links.add(`/artifacts/${entry.id}/${part}`);
}
const pages = [...links].filter((link) => link.endsWith('/play.html'));
for (const link of links)
  if (!pages.includes(link))
    await fetchInto(link).catch((error) => failed.push(`${link}: ${error.message}`));
for (const link of pages) await visit(link);

// Every game a visitor can open from the page.
const games = JSON.parse(await readFile('assets/evidence/auto-port.json', 'utf8')).games.filter(
  (game) => game.status !== 'excluded',
);
await visit('/donor/play');
for (const game of games) {
  await visit(`/ported/${game.id}/before/index.html`);
  if (game.status === 'passed') await visit(`/ported/${game.id}/after/index.html`);
}
const savedGames = [
  '/accepted/jujump/original.html?mode=original',
  '/accepted/jujump/transferred.html?mode=transfer',
  '/play?mode=original',
  '/play?mode=transfer',
];
for (const path of savedGames) await visit(path);
await Promise.allSettled(waits);
await browser.close();

for (const path of REQUIRED) if (!saved.has(path)) throw Error(`The snapshot is missing ${path}`);

await rm(SNAPSHOT, { recursive: true, force: true });
await rm(STATIC, { recursive: true, force: true });
await mkdir(join(SNAPSHOT, 'files'), { recursive: true });
const files = {};
let total = 0;
for (const [url, { bytes, headers }] of saved) {
  const file = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(SNAPSHOT, 'files', file), bytes);
  files[url] = { file, headers };
  total += bytes.length;
  // The page shell is plain static output, so it loads without running the Function at all.
  if (url === '/' || url === '/style.css' || url === '/assets/app.js') {
    const target = join(STATIC, url === '/' ? 'index.html' : url.slice(1));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}
await writeFile(
  join(SNAPSHOT, 'manifest.json'),
  JSON.stringify({ origin: ORIGIN, capturedAt: new Date().toISOString(), files }) + '\n',
);
console.log(`Saved ${saved.size} files, ${(total / 1048576).toFixed(1)} MB, from ${ORIGIN}.`);
if (failed.length)
  console.log(`Not saved (${failed.length}):\n  ${[...new Set(failed)].join('\n  ')}`);
