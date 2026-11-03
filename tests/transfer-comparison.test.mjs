import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {recordTransferComparison} from '../src/evaluator/transfer-comparison.mjs';

test('the displayed comparison reproduces actual donor, component and recipient measurements',async()=>{
  const saved=JSON.parse(await readFile(new URL('../assets/transfers/comparison.json',import.meta.url),'utf8'));
  const replay=await recordTransferComparison();
  assert.deepEqual(replay,saved);
  assert.equal(replay.metaCalled,false);assert.deepEqual(replay.activationTicks,[11,44,77]);
  assert.deepEqual(replay.endTicks,[18,51,84]);
});
