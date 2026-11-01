import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePakuRemix } from '../evaluator/paku-remix.mjs';
import { BASE_REMIX_INTENT } from '../remix/contract.mjs';
import { compileAdapter } from '../transfer/adapter.mjs';
import { buildRemixFrame } from '../remix/frame.mjs';
import { verifyRemixBrowser } from '../evaluator/remix-browser.mjs';
import { remixFixture } from './helpers/remix-fixture.mjs';

const intent={unitScale:0.75,activation:'press',direction:'opposite'};
const submission={status:'supported',intent,source:remixFixture(intent),summary:'Backward dash on a fresh press, 45 pixels'};
test('remix conformance verifies the full inherited intent and rejects a mismatched or rewritten controller',async()=>{
  const passing=await evaluatePakuRemix(submission.source,intent);
  assert.equal(passing.passed,true);assert.equal(passing.results.length,12);
  const wrong=await evaluatePakuRemix(remixFixture(BASE_REMIX_INTENT),intent);
  assert.equal(wrong.passed,false);
  const timerRewrite=submission.source.replace('sourceBodyWidth:8},config.motion','sourceBodyWidth:8},{...config.motion,cooldownTicks:1}');
  await assert.rejects(evaluatePakuRemix(timerRewrite,intent),/frozen component configuration/);
});

test('the emitted remix plays in an isolated iframe with checked controls, collisions, reset and replay',async()=>{
  const compiled=await compileAdapter(submission.source),html=await buildRemixFrame(compiled,intent);
  const result=await verifyRemixBrowser(compiled,intent,html);
  assert.equal(result.passed,true,JSON.stringify(result.results.filter(result=>!result.passed)));
  assert.equal(result.results.length,6);
  assert.match(html,/connect-src 'none'/);
});
