import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { integrationAssets, packageRecordingName, readPackageVerification, savePackageRecording } from '../integration/assets.mjs';

const LEGACY_SHA = '777e93f1ec31d6af946491570b7470fc570a01c8ee533ac9483e044abdd5b90e';
const LEGACY_PACKAGE = '9005034bd2a0fa44e543f8609b9c3bb3d864ba4de4049f5bcc705b55478eb863';
const CURRENT = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const ZIP = 'c'.repeat(64);
const OTHER_ZIP = 'd'.repeat(64);

function project(id, zipSha256) {
  return { manifest: { id }, zipSha256 };
}

function recording(packageId, zipSha256, extra = {}) {
  return {
    passed: true, metaCalled: false, kind: 'human-scripted-standalone-verification', packageId, zipSha256,
    nodeChecks: { count: 3, passed: true },
    browser: { passed: true, results: Array.from({ length: 7 }, (_, index) => ({ name: `check-${index}`, passed: true })) },
    ...extra,
  };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'jujump-recordings-'));
  return { directory, url: pathToFileURL(`${directory}/`) };
}

test('package recording names stay inside the recordings directory', () => {
  assert.equal(packageRecordingName(CURRENT), `${CURRENT}.json`);
  assert.notEqual(packageRecordingName(CURRENT), 'jujump-validation.json');
  for (const value of ['../jujump-validation', 'jujump-validation', 'jujump-validation.json', `${CURRENT}.json`, '', CURRENT.slice(1), CURRENT.toUpperCase()]) {
    assert.throws(() => packageRecordingName(value), /Invalid integration package id/);
  }
});

test('a package recording is preferred and the legacy file is only an exact match', async () => {
  const { directory, url } = await fixture();
  try {
    const legacy = recording(CURRENT, ZIP, { marker: 'legacy' });
    const keyed = recording(CURRENT, ZIP, { marker: 'keyed' });
    await writeFile(join(directory, 'jujump-validation.json'), JSON.stringify(legacy));
    assert.equal((await readPackageVerification(url, project(CURRENT, ZIP))).marker, 'legacy');
    await writeFile(join(directory, packageRecordingName(CURRENT)), JSON.stringify(keyed));
    assert.equal((await readPackageVerification(url, project(CURRENT, ZIP))).marker, 'keyed');
    await writeFile(join(directory, packageRecordingName(CURRENT)), JSON.stringify(recording(CURRENT, OTHER_ZIP, { marker: 'stale-keyed' })));
    assert.equal((await readPackageVerification(url, project(CURRENT, ZIP))).marker, 'legacy');
    await writeFile(join(directory, 'jujump-validation.json'), JSON.stringify(recording(CURRENT, OTHER_ZIP)));
    assert.equal(await readPackageVerification(url, project(CURRENT, ZIP)), null);
    await writeFile(join(directory, 'jujump-validation.json'), JSON.stringify(recording(OTHER, ZIP)));
    assert.equal(await readPackageVerification(url, project(CURRENT, ZIP)), null);
    await writeFile(join(directory, packageRecordingName(OTHER)), JSON.stringify(recording(OTHER, ZIP)));
    assert.equal(await readPackageVerification(url, project(CURRENT, ZIP)), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a rejected or corrupt package recording is not treated as verification', async () => {
  const { directory, url } = await fixture();
  try {
    await writeFile(join(directory, packageRecordingName(CURRENT)), JSON.stringify(recording(CURRENT, ZIP, { metaCalled: true })));
    await writeFile(join(directory, 'jujump-validation.json'), JSON.stringify(recording(OTHER, OTHER_ZIP)));
    assert.equal(await readPackageVerification(url, project(CURRENT, ZIP)), null);
    for (const extra of [
      { nodeChecks: { passed: false, count: 3 } },
      { browser: { passed: false, results: [{ passed: true }] } },
      { browser: { passed: true, results: [{ passed: false }] } },
    ]) {
      await writeFile(join(directory, packageRecordingName(CURRENT)), JSON.stringify(recording(CURRENT, ZIP, extra)));
      assert.equal(await readPackageVerification(url, project(CURRENT, ZIP)), null);
    }
    await writeFile(join(directory, packageRecordingName(CURRENT)), '{');
    await assert.rejects(() => readPackageVerification(url, project(CURRENT, ZIP)), SyntaxError);
    await assert.rejects(() => savePackageRecording(url, recording(CURRENT, ZIP, { passed: false })), /Only a passed standalone verification can be saved/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('saving a package recording does not overwrite an earlier recording', async () => {
  const { directory, url } = await fixture();
  try {
    const legacy = Buffer.from('{"legacy":true}\n');
    await writeFile(join(directory, 'jujump-validation.json'), legacy);
    const first = recording(CURRENT, ZIP, { marker: 'first' });
    const name = await savePackageRecording(url, first);
    assert.equal(name, `${CURRENT}.json`);
    const saved = await readFile(join(directory, name));
    await assert.rejects(() => savePackageRecording(url, recording(CURRENT, ZIP, { marker: 'second' })), /already exists and was not overwritten/);
    assert.deepEqual(await readFile(join(directory, name)), saved);
    assert.deepEqual(await readFile(join(directory, 'jujump-validation.json')), legacy);
    assert.equal((await readPackageVerification(url, project(CURRENT, ZIP))).marker, 'first');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the current export uses its package recording and leaves the legacy file unchanged', async () => {
  const legacyUrl = new URL('../integration/recordings/jujump-validation.json', import.meta.url);
  const before = await readFile(legacyUrl);
  assert.equal(createHash('sha256').update(before).digest('hex'), LEGACY_SHA);
  assert.equal(JSON.parse(before).packageId, LEGACY_PACKAGE);
  const assets = await integrationAssets();
  const task = JSON.parse(assets.get('/api/developer-task')[1]);
  assert.equal(task.verification.kind, 'human-scripted-standalone-verification');
  assert.equal(task.verification.nodeChecks, 3);
  assert.equal(task.verification.browserChecks, 7);
  assert.equal(task.verification.report, '/integrations/jujump/validation.json');
  const saved = JSON.parse(assets.get(task.verification.report)[1]);
  assert.equal(saved.passed, true);
  assert.equal(saved.metaCalled, false);
  assert.equal(saved.packageId, task.package.id);
  assert.equal(saved.zipSha256, task.package.sha256);
  assert.equal(saved.nodeChecks.count, 3);
  assert.equal(saved.browser.results.length, 7);
  assert.notEqual(saved.packageId, LEGACY_PACKAGE);
  const keyed = await readFile(new URL(`../integration/recordings/${packageRecordingName(saved.packageId)}`, import.meta.url));
  assert.equal(JSON.parse(keyed).packageId, saved.packageId);
  assert.equal(JSON.parse(keyed).zipSha256, saved.zipSha256);
  const after = await readFile(legacyUrl);
  assert.deepEqual(after, before);
  assert.equal(createHash('sha256').update(after).digest('hex'), LEGACY_SHA);
});
