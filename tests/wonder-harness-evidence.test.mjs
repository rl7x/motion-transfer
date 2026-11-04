import test from 'node:test';
import { verifyWonderHarness } from '../scripts/verify-wonder-harness.mjs';

for (const version of ['v3', 'v4', 'v5']) {
  test(`the ${version} recovery results preserve every planned outcome and exact report`, async () => {
    await verifyWonderHarness({ version });
  });
}
