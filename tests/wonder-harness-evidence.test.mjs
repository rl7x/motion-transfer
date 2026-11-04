import test from 'node:test';
import { verifyWonderHarness } from '../scripts/verify-wonder-harness.mjs';
import { access } from 'node:fs/promises';

for (const version of ['v3', 'v4', 'v5']) {
  test(`the ${version} recovery results preserve every planned outcome and exact report`, async () => {
    await verifyWonderHarness({ version });
  });
}

test('the v6 plan is bounded and any recorded results retain every outcome', async () => {
  await verifyWonderHarness({ version: 'v6', planOnly: true });
  try { await access(new URL('../assets/benchmark/wonder-harness-v6/results.json', import.meta.url)); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  await verifyWonderHarness({ version: 'v6' });
});
