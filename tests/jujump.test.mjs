import assert from 'node:assert/strict';
import test from 'node:test';
import { loadJujump } from '../src/recipients/jujump/load.mjs';
import { loadJujumpTransfer } from '../src/transfer/jujump.mjs';
import { loadRecoveredMotion } from '../src/component/load.mjs';
import { verifyJujumpBrowser } from '../src/evaluator/jujump-browser.mjs';
import { evaluatePakuAdapter } from '../src/evaluator/paku-adapter.mjs';

test('the distinct JUJUMP adapter delegates to the exact frozen controller and preserves native physics in Chrome',async()=>{
  const [recipient,transfer,component]=await Promise.all([loadJujump(),loadJujumpTransfer(),loadRecoveredMotion()]);
  assert.equal(recipient.manifest.revision,'cfb39d2f988feb5918eb83697145b5a35adabf58');
  assert.equal(transfer.componentId,component.provenance.id);assert.equal(transfer.verified,true);
  assert.match(recipient.licenses[0],/Copyright \(c\) 2021 ABA Games/);
  assert.equal((await evaluatePakuAdapter(transfer.source)).passed,true);
  const browser=await verifyJujumpBrowser(transfer);
  assert.equal(browser.passed,true,JSON.stringify(browser.results.filter(result=>!result.passed)));
  assert.equal(browser.results.length,7);
  assert.deepEqual(browser.environment,transfer.report.environment);
});
