import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { sha256 } from '../release/sha.mjs';
import { zipEntryHashes, zipStored } from '../release/zip.mjs';
import { normalizePublicOrigin, shareDecision } from '../release/share.mjs';
import { PHASE_BUDGET_DIRECTORY, runHostedGeneration } from '../release/generation.mjs';
import { loadLabRemixChain } from '../release/lab-chain.mjs';
import { publishRelease } from '../release/publish.mjs';
import { auditDirectory } from '../release/audit.mjs';
import { createStaticReleaseServer } from '../release/static-server.mjs';
import { createPhaseBudget } from '../campaign/phase-budget.mjs';

const parentId = 'a'.repeat(64);
const childId = 'b'.repeat(64);
const componentId = 'c'.repeat(64);
const labRoot = '9126d1dd00b794daab3fda1711fd3b7058b4962eed800cc8105fd4b874d6eed3';
const labMid = '576debe434d97387f068f34e67da65f298788d44c9796b816721b82193f9f87f';
const labLeaf = 'd0c3a8884def82732dcc12e70269dce8548029552e58087e7eccc6ee1f05d470';

test('a public link is absent until an https origin is configured', () => {
  const missing = shareDecision(null, 'index.html');
  assert.equal(missing.configured, false);
  assert.equal(missing.text, 'A public link is not configured.');
  assert.equal(Object.hasOwn(missing, 'url'), false);
  const origin = normalizePublicOrigin('https://example.com/repo');
  assert.equal(origin, 'https://example.com/repo/');
  assert.equal(shareDecision(origin, 'versions/abc/index.html').url, 'https://example.com/repo/versions/abc/index.html');
  assert.throws(() => normalizePublicOrigin('http://example.com/repo'), /https/);
  assert.throws(() => shareDecision(origin, '/index.html'), /inside the configured public origin/);
});

test('stored downloads round-trip the exact entry bytes', () => {
  const first = zipStored({ 'b.txt': 'beta', 'a.txt': 'alpha' });
  const second = zipStored({ 'a.txt': 'alpha', 'b.txt': 'beta' });
  assert.equal(sha256(first), sha256(second));
  assert.deepEqual(zipEntryHashes(first), { 'a.txt': sha256('alpha'), 'b.txt': sha256('beta') });
});

test('hosted generation does not open the shared ledger without a hook', async () => {
  const ledger = join(PHASE_BUDGET_DIRECTORY, 'phase-budget.json');
  let before = null;
  try { before = await stat(ledger); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const decision = await runHostedGeneration({ hook: null });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /orchestration hook/);
  if (!before) await assert.rejects(() => stat(ledger), { code: 'ENOENT' });
  else {
    const after = await stat(ledger);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(after.size, before.size);
  }
});

test('an uncertain allowance rejects before a hook or reservation', async () => {
  let reserved = false;
  const budget = {
    async status() { return { uncertain: true, overrun: false, categories: { public: { remainingUsd: 15 } } }; },
    async reserve() { reserved = true; throw Error('reserved'); },
  };
  const decision = await runHostedGeneration({ hook: '/tmp/motion-release-missing-hook.mjs', budget });
  assert.equal(decision.allowed, false);
  assert.equal(reserved, false);
  assert.match(decision.reason, /uncertain/i);
});

test('an opt-in hook can settle a private ledger at zero and cannot mark a paid call', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'motion-release-budget-'));
  try {
    const freeHook = join(directory, 'free.mjs');
    await writeFile(freeHook, 'export async function run(){ return { estimatedCostUsd: 0, paid: false }; }\n');
    const ledger = await createPhaseBudget(directory);
    const settled = await runHostedGeneration({ hook: freeHook, budget: ledger });
    assert.equal(settled.settled, true);
    const status = await ledger.status();
    assert.equal(status.uncertain, false);
    assert.equal(status.categories.public.settledUsd, 0);
    const paidHook = join(directory, 'paid.mjs');
    await writeFile(paidHook, 'export async function run(){ return { paid: true }; }\n');
    const paidLedger = await createPhaseBudget(join(directory, 'paid'));
    await assert.rejects(() => runHostedGeneration({ hook: paidHook, budget: paidLedger }), /paid model call/);
    assert.equal((await paidLedger.status()).uncertain, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function fixtureVersion(id, parentArtifactId, title) {
  const frame = '<!doctype html><title>' + title + '</title><p>play</p>';
  const notices = 'ISC notice\n';
  const adapter = 'export const dash = true;\n';
  const evidence = '{"conformance":{"results":[]},"browser":{"results":[]}}';
  const files = { 'frame.html': frame, 'notices.txt': notices, 'adapter.ts': adapter, 'verification.json': evidence };
  return {
    id, parentArtifactId, componentId, title, summary: title,
    kind: parentArtifactId ? 'roadster-remix' : 'roadster-transfer',
    intent: { unitScale: 6, activation: 'held', direction: 'facing' },
    protocol: 'roadster', origin: 'test-fixture',
    frame, notices, adapter, evidenceName: 'verification.json', evidenceBytes: evidence,
    sourceBytes: JSON.stringify({ id, parentArtifactId, componentId, files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, sha256(content)])) }),
    zipFiles: files,
    report: parentArtifactId ? null : { conformance: { results: [] }, browser: { results: [] } },
  };
}

test('a synthetic release publishes exact files, a parent link, and no public URL', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'motion-release-'));
  const target = join(directory, 'site');
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '' } });
  try {
    const release = {
      publicOrigin: null, componentId, featuredId: childId, warnings: [], remixChain: [parentId, childId],
      versions: [fixtureVersion(parentId, null, 'Saved root'), fixtureVersion(childId, parentId, 'Saved remix')],
      shell: { css: 'body{margin:0}', appJs: "const frame=document.createElement('iframe');frame.src='/donor/play.html';document.querySelector('#root').append(frame);" },
      extras: { 'donor/play.html': '<!doctype html><title>donor</title>' },
    };
    const manifest = await publishRelease(target, release);
    assert.equal(manifest.creation, 'unavailable');
    assert.equal(manifest.publicOrigin, null);
    assert.equal(manifest.versions.find(version => version.id === childId).parentArtifactId, parentId);
    const again = await auditDirectory(target);
    assert.equal(again.id, manifest.id);
    const server = await createStaticReleaseServer({ root: target, basePath: '/preview/' });
    try {
      const page = await browser.newPage();
      const external = [];
      await page.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(server.origin) || url.startsWith('blob:') || url.startsWith('data:') || url.endsWith('/favicon.ico')) return route.continue();
        external.push(url); return route.abort();
      });
      await page.goto(server.origin + 'index.html');
      await page.waitForFunction(() => window.__MOTION_TRANSFER__?.generation === 'playback-only');
      await page.waitForSelector('iframe');
      const src = await page.locator('iframe').evaluate(frame => frame.src);
      assert.match(src, /\/preview\/donor\/play\.html$/);
      const rejected = await fetch(server.origin + 'api/remixes', { method: 'POST', body: '{}' });
      assert.equal(rejected.status, 405);
      const child = manifest.versions.find(version => version.id === childId);
      await page.goto(server.origin + child.play);
      await page.reload();
      assert.equal(await page.locator('[data-parent]').getAttribute('href'), '../' + parentId + '/index.html');
      assert.equal(await page.locator('[data-share-state="unconfigured"]').count(), 1);
      await page.locator('[data-parent]').click();
      await page.waitForURL(new RegExp('/versions/' + parentId + '/'));
      const download = await fetch(server.origin + child.download);
      assert.match(download.headers.get('content-disposition') ?? '', /attachment/);
      const bytes = Buffer.from(await download.arrayBuffer());
      assert.equal(sha256(bytes), manifest.files[child.download]);
      assert.deepEqual(external, []);
    } finally { await server.close(); }
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('the saved lab remix keeps its parent chain and its frame bytes', async () => {
  const directory = fileURLToPath(new URL('../reports/lab/artifacts/', import.meta.url));
  let names = [];
  try { names = (await readdir(directory)).filter(name => /^[a-f0-9]{64}$/.test(name)); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const before = new Map();
  for (const id of names) {
    try { before.set(id, sha256(await readFile(join(directory, id, 'frame.html')))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const result = await loadLabRemixChain(directory);
  assert.ok(result.chain.length >= 2, result.warnings.join('\n'));
  for (let index = 1; index < result.chain.length; index += 1) {
    assert.equal(result.chain[index].parentArtifactId, result.chain[index - 1].id);
  }
  for (const item of result.chain) assert.equal(item.frameSha256, before.get(item.id));
  for (const [id, hash] of before) assert.equal(sha256(await readFile(join(directory, id, 'frame.html'))), hash);
  const ids = result.chain.map(item => item.id);
  if (ids.includes(labLeaf)) {
    assert.equal(ids[ids.indexOf(labLeaf) - 1], labMid);
    assert.equal(ids[ids.indexOf(labMid) - 1], labRoot);
  } else if (before.has(labLeaf) && before.has(labMid) && before.has(labRoot)) {
    assert.fail('The saved lab remix and its parents did not form an intact chain');
  }
});
