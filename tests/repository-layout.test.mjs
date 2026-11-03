import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { repositoryPath, repositoryUrl } from '../src/paths.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('historical JUJUMP source names still resolve to the exact verified executable inputs', async () => {
  const report = JSON.parse(await readFile(repositoryUrl('transfers/jujump/verification.json'), 'utf8'));
  for (const [logicalPath, expected] of Object.entries(report.environment.files)) {
    assert.equal(digest(await readFile(repositoryUrl(logicalPath))), expected, logicalPath);
  }
});

test('the frozen fidelity evaluator and cartridge resolve without changing the study identity', async () => {
  const file = 'benchmark/fidelity-recordings/f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5/fidelity-study/study.json';
  const { id, ...study } = JSON.parse(await readFile(repositoryUrl(file), 'utf8'));
  assert.equal(digest(JSON.stringify(study)), id);
  for (const [logicalPath, expected] of Object.entries(study.evaluator)) {
    assert.equal(digest(await readFile(repositoryUrl(logicalPath))), expected, logicalPath);
  }
});

test('repository resolution accepts current paths and refuses paths outside the checkout', () => {
  for (const path of ['src/agent/target.mjs', 'assets/targets/dashy-dango/cart.wasm', 'reports/phase/phase-budget.json', 'web/app/main.tsx']) {
    assert.equal(repositoryPath(path), path);
  }
  for (const path of ['../outside', 'agent/../../outside', '/outside', 'agent\\outside']) {
    assert.throws(() => repositoryUrl(path), /repository-relative/);
  }
});
