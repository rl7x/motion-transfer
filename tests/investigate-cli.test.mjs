import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../scripts/investigate.mjs', import.meta.url));

test('CLI fails clearly without a key and help works without reading repo credentials', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cartridge-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { cwd: directory, env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 10_000 };
  const missing = spawnSync(process.execPath, [script], options);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /MODEL_API_KEY is not set/);
  const help = spawnSync(process.execPath, [script, '--help'], options);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /0\.50/);
});
