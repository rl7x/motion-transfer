import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileAdapter } from '../transfer/adapter.mjs';
import { checkPakuPackage, loadPakuTransfer } from '../transfer/saved-paku.mjs';
import { evaluatePakuAdapter } from '../evaluator/paku-adapter.mjs';
import { verifyPakuBrowser } from '../evaluator/paku-browser.mjs';
import { pakuEnvironment } from '../transfer/paku-environment.mjs';

test('the frozen Meta adapter passes conformance and playable browser integration', async () => {
  const saved = await loadPakuTransfer();
  const compiled = await compileAdapter(saved.source);
  assert.equal(compiled.javascript, saved.javascript);
  const conformance = await evaluatePakuAdapter(saved.source);
  const browser = await verifyPakuBrowser(compiled);
  assert.equal(conformance.passed, true);
  assert.equal(browser.passed, true, JSON.stringify(browser.results.filter(result => !result.passed)));
  assert.equal(browser.results.length, 8);
  assert.deepEqual(browser.environment, await pakuEnvironment());
  assert.equal(browser.componentId, saved.componentId);
});

test('historical playback preserves its proof while current-host publication rejects a stale environment', async () => {
  const saved = await loadPakuTransfer();
  assert.equal(saved.receipt.id.length, 64);
  await assert.rejects(loadPakuTransfer({ currentEnvironment: true }), /environment is stale/);
  const current = await pakuEnvironment();
  assert.throws(() => checkPakuPackage(saved, current), /environment is stale/);
});

test('promotion rejects changed source, stale identity, missing checks, and failed browser evidence', async () => {
  const { directory, ...saved } = await loadPakuTransfer();
  const environment = saved.receipt.environment;
  checkPakuPackage(saved, environment);
  assert.throws(() => checkPakuPackage({ ...saved, source: saved.source + '\n' }, environment));
  const stale = structuredClone(saved);
  stale.browser.componentId = 'another-component';
  assert.throws(() => checkPakuPackage(stale, environment), /identity mismatch/);
  const missing = structuredClone(saved);
  missing.browser.results = [];
  assert.throws(() => checkPakuPackage(missing, environment), /check set changed/);
  const failed = structuredClone(saved);
  failed.browser.results[0].passed = false;
  assert.throws(() => checkPakuPackage(failed, environment), /failed check/);
  const oldHost = structuredClone(saved);
  oldHost.browser.environment.policy.unitScale = 1;
  assert.throws(() => checkPakuPackage(oldHost, environment), /environment is stale/);
});

test('loading a saved transfer rejects changed artifact bytes before serving them', async () => {
  const saved = await loadPakuTransfer();
  const temporary = await mkdtemp(join(tmpdir(), 'paku-transfer-'));
  const directory = pathToFileURL(temporary + '/');
  try {
    for (const name of [...Object.keys(saved.receipt.files), 'receipt.json']) await copyFile(new URL(name, saved.directory), new URL(name, directory));
    await writeFile(new URL('adapter.js', directory), saved.javascript + '\n// altered\n');
    await assert.rejects(loadPakuTransfer({ directory }), /integrity mismatch: adapter.js/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
