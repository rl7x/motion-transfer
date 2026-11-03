import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PINNED_MUSE_BINARY, musePreflightAvailability } from '../mcp/control.mjs';
import { runEchoPreflight } from '../mcp/preflight.mjs';

const scriptPath = fileURLToPath(new URL('../scripts/recover-muse-code.mjs', import.meta.url));
const echoSupport = await musePreflightAvailability({ binary: PINNED_MUSE_BINARY });

test('paid CLI refuses before Muse or a ledger reservation', async () => {
  const ledger = await mkdtemp(join(tmpdir(), 'muse-paid-ledger-'));
  const child = spawn(process.execPath, [scriptPath, '--paid', '--phase-ledger', ledger], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
  const code = await new Promise(resolve => child.once('close', resolve));
  assert.equal(code, 1);
  assert.match(stderr, /Paid Muse run refused/);
  assert.equal(stderr.includes('accepted'), false);
  await assert.rejects(readFile(join(ledger, 'phase-budget.json'), 'utf8'), { code: 'ENOENT' });
  await rm(ledger, { recursive: true, force: true });
});

test('explicit preflight fails clearly when the pinned binary is unavailable', async () => {
  const out = await mkdtemp(join(tmpdir(), 'muse-missing-'));
  const ledger = await mkdtemp(join(tmpdir(), 'muse-missing-ledger-'));
  const child = spawn(process.execPath, [
    scriptPath, '--preflight', '--out', out, '--phase-ledger', ledger, '--muse-binary', join(out, 'missing-muse'),
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
  const code = await new Promise(resolve => child.once('close', resolve));
  assert.equal(code, 1);
  assert.match(stderr, /sandbox-exec is not executable|not executable at/);
  assert.equal(stderr.includes('accepted'), false);
  await assert.rejects(readFile(join(ledger, 'phase-budget.json'), 'utf8'), { code: 'ENOENT' });
  await assert.rejects(readFile(join(out, 'preflight.json'), 'utf8'), { code: 'ENOENT' });
  await rm(out, { recursive: true, force: true });
  await rm(ledger, { recursive: true, force: true });
});

test('echo preflight stays unpaid and checks containment', {
  timeout: 240_000,
  skip: echoSupport.ok ? false : echoSupport.reason,
}, async () => {
  const out = await mkdtemp(join(tmpdir(), 'muse-echo-'));
  const ledger = await mkdtemp(join(tmpdir(), 'muse-echo-ledger-'));
  try {
    const result = await runEchoPreflight({ binary: PINNED_MUSE_BINARY, out, phaseLedger: ledger });
    assert.equal(result.paidRun, false);
    assert.equal(result.accepted, false);
    assert.equal(result.recoveryRate, null);
    assert.equal(result.checks.serverStarted, true);
    assert.equal(result.checks.workspaceOnlyTask, true);
    assert.equal(result.checks.requiredServerAborts, true);
    assert.equal(result.checks.bothKeysDropServer, true);
    assert.equal(result.checks.legacyKeyStillLoads, true);
    assert.equal(result.checks.homePreserved, true);
    assert.equal(result.checks.codexHomeOmitted, true);
    assert.equal(result.checks.paidSpendRefused, true);
    assert.equal(result.checks.paidTurnOrderingRefused, true);
    assert.equal(result.checks.defaultAuthUnchanged, true);
    assert.equal(result.checks.defaultConfigPathHidden, true);
    assert.equal(result.phaseLedger.present, false);
    assert.ok(result.checks.trustedGenerations >= 1);
    assert.equal(result.checks.usageEvents, 0);
    assert.ok(result.limitations.some(item => item.includes('j/3')));
    assert.ok(result.limitations.some(item => item.includes('did not create a replacement journal')));
    await assert.rejects(readFile(join(ledger, 'phase-budget.json'), 'utf8'), { code: 'ENOENT' });
    const saved = JSON.parse(await readFile(join(out, 'preflight.json'), 'utf8'));
    assert.equal(saved.accepted, false);
    assert.equal(saved.paidRun, false);
  } finally {
    await rm(out, { recursive: true, force: true });
    await rm(ledger, { recursive: true, force: true });
  }
});
