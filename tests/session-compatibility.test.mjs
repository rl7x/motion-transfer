import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createInvestigationSession } from '../src/runtime/investigation-session.mjs';
import { loadTarget } from '../src/agent/target.mjs';
import { createRecoveryProtocol } from '../src/agent/recovery-protocol.mjs';

test('reviewed historical sessions retain their identity while replay verifies actual machine state', async () => {
  const { report } = JSON.parse(await readFile(new URL('../assets/lab/recordings/programmatic-investigation.json', import.meta.url), 'utf8'));
  const bytes = (await loadTarget()).bytes;
  const restored = await createInvestigationSession(bytes, report.session);
  assert.deepEqual(restored.identity, report.session.identity);
  const snapshot = restored.snapshot();
  assert.equal(snapshot.restorationCompatibility.historicalHostSha256, report.session.identity.hostSha256);
  assert.notEqual(snapshot.restorationCompatibility.implementationHostSha256, report.session.identity.hostSha256);
  await createInvestigationSession(bytes, snapshot);
  const wrong = structuredClone(report.session); wrong.identity.hostSha256 = '0'.repeat(64);
  await assert.rejects(createInvestigationSession(bytes, wrong), /identity mismatch/);
  const corrupt = structuredClone(report.session); corrupt.branches[0].verification.memoryHash = '0'.repeat(64);
  await assert.rejects(createInvestigationSession(bytes, corrupt), /restoration hash mismatch/);
  await assert.rejects(createInvestigationSession(bytes, report.session, { recoveryProtocol: createRecoveryProtocol() }), /protocol cannot change/);
});
