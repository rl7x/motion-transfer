import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

test('a failed CLI replay replaces a previous success report with a failure', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cartridge-replay-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tracePath = join(directory, 'invalid.json');
  const output = join(directory, 'report.json');
  await writeFile(tracePath, JSON.stringify({ schemaVersion: 1, target: 'dashy-dango', steps: [] }));
  await writeFile(output, JSON.stringify({ verified: true, runs: ['stale'] }));
  const result = spawnSync(process.execPath, ['scripts/replay.mjs', tracePath, output], {
    cwd: root, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  const report = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(report.verified, false);
  assert.deepEqual(report.runs, []);
  assert.match(report.error, /nonempty steps/);
  assert.match(result.stderr, /nonempty steps/);
});
