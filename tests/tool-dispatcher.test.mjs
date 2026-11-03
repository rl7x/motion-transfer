import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolDispatcher } from '../src/agent/tool-dispatcher.mjs';
import { loadTarget } from '../src/agent/target.mjs';

test('dispatchers initialize lazily and own separate live session and inspection state', async () => {
  const target = await loadTarget();
  const first = createToolDispatcher({ target, persistCheckpoint: async () => {} });
  const second = createToolDispatcher({ target, persistCheckpoint: async () => {} });
  assert.equal(first.snapshot(), undefined); assert.equal(second.snapshot(), undefined);
  const overview = await first.execute('inspect_wasm', { view: 'overview', startLine: 1, lineCount: 5 });
  assert.equal(overview.result.sha256, target.sha256);
  assert.equal(first.snapshot(), undefined, 'Static orientation does not create a live session');
  await first.execute('$open', {}); await second.execute('$open', {});
  assert.notEqual(first.snapshot().id, second.snapshot().id);
  await first.execute('session_advance', { branchId: 'main', hypothesis: 'Local dispatcher isolation fixture.', watches: [], steps: [{ buttons: 1, frames: 1, checkpoint: 'start' }] });
  const initial = await second.execute('session_observe', { branchId: 'main', watches: [] });
  assert.equal(initial.result.frame, 0);
  await first.execute('inspect_function', { functionIndex: 9, startLine: 1, lineCount: 5 });
  assert.ok(first.snapshot().staticEvidence.some(item => item.id === 'binary:func9'));
  assert.equal(second.snapshot().staticEvidence.length, 0);
  await assert.rejects(first.execute('$open', {}), /already open/);
});

test('managed dispatch persists through the supplied handshake and restores its real checkpoint handles', async () => {
  const target = await loadTarget();
  let writes = 0, saved;
  const dispatcher = createToolDispatcher({ target, persistCheckpoint: async () => {
    writes++; saved = dispatcher.snapshot();
    assert.ok(saved.experimentWorkbench);
  } });
  await dispatcher.execute('$open', {});
  const prepared = await dispatcher.execute('prepare_checkpoint', {
    requestId: 'dispatcher-preparation', hypothesis: 'Local checkpoint persistence fixture.', watches: [],
    steps: [{ buttons: 1, frames: 1, checkpoint: 'gameplay' }, { buttons: 0, frames: 10, checkpoint: 'ready' }],
  });
  assert.ok(writes > 0); assert.ok(saved.experimentWorkbench.requests.some(request => request.status === 'completed'));
  const restored = createToolDispatcher({ target, persistCheckpoint: async () => {} });
  assert.equal((await restored.execute('$open', { sessionState: saved })).result.restored, true);
  const result = await restored.execute('read_checkpoint', { checkpointId: prepared.result.checkpointId, watches: [] });
  assert.equal(result.result.checkpointId, prepared.result.checkpointId);
  assert.deepEqual(restored.snapshot().identity, dispatcher.snapshot().identity);
});
