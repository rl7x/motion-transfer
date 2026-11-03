import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeFidelityStudy, scoreFidelityStudy } from '../benchmark/fidelity.mjs';

const sourcePath = fileURLToPath(new URL('../components/dashy-dango-dash/component.ts', import.meta.url));
const configPath = fileURLToPath(new URL('../components/dashy-dango-dash/contract.json', import.meta.url));
test('fidelity freezes all candidates, scores every outcome, and never overwrites results', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'fidelity-'));
  try {
    const broken = join(temp, 'broken.ts');
    await writeFile(broken, 'export const broken = true;');
    const directory = join(temp, 'study');
    const manifest = await freezeFidelityStudy(directory, [
      { id: 'saved', condition: 'saved-recovery', sourcePath, configPath },
      { id: 'broken', condition: 'author-baseline', sourcePath: broken, configPath },
    ]);
    await writeFile(broken, 'changed after freeze');
    const report = await scoreFidelityStudy(directory);
    assert.equal(report.studyId, manifest.id);
    assert.equal(report.results[0].passed, 40);
    assert.equal(report.results[0].maxPositionError, 0);
    assert.equal(report.results[1].status, 'failed');
    assert.equal(report.results[1].passed, 0);
    assert.equal(report.metaCalled, false);
    assert.ok(!report.results[0].evaluation.normalizedTimers);
    await assert.rejects(scoreFidelityStudy(directory), /EEXIST/);
    await assert.rejects(freezeFidelityStudy(directory, [{ id: 'saved', condition: 'saved-recovery', sourcePath, configPath }]), /EEXIST/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('fidelity rejects a changed frozen candidate before revealing donor answers', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'fidelity-'));
  try {
    const directory = join(temp, 'study');
    await freezeFidelityStudy(directory, [{ id: 'saved', condition: 'saved-recovery', sourcePath, configPath }]);
    await writeFile(join(directory, 'saved.ts'), 'export const changed = true;');
    await assert.rejects(scoreFidelityStudy(directory), /Frozen candidate changed/);
    await assert.rejects(readFile(join(directory, 'results.json')), /ENOENT/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
