import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { investigate } from '../src/agent/investigate.mjs';
import { captureInvestigationContract } from './helpers/investigation-contract.mjs';

test('provider requests, continuation, dispatch and accounting retain the pre-refactor contract', async () => {
  const baseline = JSON.parse(await readFile(new URL('fixtures/investigation-contract.json', import.meta.url)));
  const result = await captureInvestigationContract(investigate);
  assert.deepEqual(result, baseline.scenarios);
  assert.equal(result.native.report.status, 'completed');
  assert.equal(result.native.report.reservedCostUsd, 0);
  assert.equal(result.native.requests.length, 5);
  assert.equal(result.native.report.contextCompactions.length, 2);
  for (const name of ['transport', 'missing-usage']) {
    assert.equal(result[name].requests.length, 1);
    assert.equal(result[name].report.requests[0].status, 'unsettled');
    assert.ok(result[name].report.reservedCostUsd > 0);
  }
});
