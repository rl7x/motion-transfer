import assert from 'node:assert/strict';
import test from 'node:test';
import { replayOrdinaryStunt } from '../evaluator/roadster-browser.mjs';

test('the actual browser replay preserves sampled ticks with bounded render calls', () => {
  let tick = -1;
  let starts = 0;
  let renders = 0;
  const frames = replayOrdinaryStunt({
    start() { starts += 1; tick = 0; },
    advance(count) { renders += 1; tick += count; return { car: { tick } }; },
  });
  const original = [];
  for (let i = 0; i < 1000; i += 1) if (i % 20 === 0) original.push({ tick: i + 1 });
  assert.deepEqual(frames, original);
  assert.equal(starts, 1);
  assert.equal(tick, 1000);
  assert.ok(renders <= 60, `replay issued ${renders} render calls`);
});
