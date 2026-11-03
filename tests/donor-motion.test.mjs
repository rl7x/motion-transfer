import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTarget } from '../src/agent/target.mjs';
import { createReplayRuntime } from '../src/runtime/replay.mjs';
import { observeDonorMotion, recordDonorMotion } from '../src/evaluator/dashy-dango.mjs';

test('mapped observations follow the live entity across allocations without changing memory', async () => {
  const runtime = await createReplayRuntime((await loadTarget()).bytes);
  assert.throws(() => observeDonorMotion(runtime), /active gameplay/);
  runtime.step(1);
  const before = runtime.observe();
  const initial = observeDonorMotion(runtime);
  assert.deepEqual(runtime.observe(), before);
  assert.deepEqual(initial.position, { x: 0, y: 0 });
  assert.equal(initial.sourceBodyWidth, 8);
  assert.equal(initial.walkingSpeed, 2);
  assert.equal(initial.distance, 60);
  assert.equal(initial.cooldown, 10);
  runtime.step(0, 10);
  runtime.step(32);
  assert.deepEqual(observeDonorMotion(runtime).position, { x: 2, y: 0 });
  runtime.step(33);
  const dash = observeDonorMotion(runtime);
  assert.deepEqual(dash.position, { x: 9.5, y: 0 });
  assert.equal(dash.remaining, 7);
  assert.equal(dash.cooldown, 25);
  assert.notEqual(dash.pointers.position, initial.pointers.position);
  assert.throws(() => observeDonorMotion({ ...runtime, provenance: { cartridgeSha256: 'wrong' } }), /pinned donor/);
});

test('motion traces record independent numeric positions and exact dash event ticks', async () => {
  const trace = { name: 'dash-then-release', steps: [
    { buttons: 0, frames: 10 }, { buttons: 33, frames: 1 }, { buttons: 0, frames: 10 },
  ] };
  const first = await recordDonorMotion(trace);
  assert.deepEqual(await recordDonorMotion(trace), first);
  assert.equal(first.frames.length, 21);
  assert.deepEqual(first.frames.filter(frame => frame.output.events.length).map(frame => [frame.tick, frame.output.events]), [
    [11, ['dash-start']], [18, ['dash-end']],
  ]);
  assert.deepEqual(first.frames[17].observation.position, { x: 60, y: 0 });
  assert.equal(first.frames[17].observation.cooldown, 25);
  assert.equal(first.frames[18].observation.cooldown, 24);
  assert.ok(first.frames.slice(10, 18).every(frame => frame.output.ownsMotion));
  assert.ok(first.frames.slice(18).every(frame => !frame.output.ownsMotion));
  await assert.rejects(recordDonorMotion({ steps: [{ buttons: 0, frames: 601 }] }), /600 gameplay/);
});
