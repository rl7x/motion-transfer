import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import wabtFactory from 'wabt';
import { BUTTONS, createReplayRuntime } from '../runtime/replay.mjs';
import { replayTrace, validateTrace } from '../runtime/trace.mjs';

const cartridge = await readFile(new URL('../targets/dashy-dango/cart.wasm', import.meta.url));
const trace = JSON.parse(await readFile(new URL('../experiments/dashy-dango/start-move-dash.json', import.meta.url), 'utf8'));
const wabt = await wabtFactory();

function compile(wat) {
  const module = wabt.parseWat('probe.wat', wat);
  try {
    return module.toBinary({}).buffer;
  } finally {
    module.destroy();
  }
}

test('three donor replays match every frame and checkpoint and reach gameplay', async () => {
  const runtime = await createReplayRuntime(cartridge);
  const first = replayTrace(runtime, trace);
  assert.deepEqual(replayTrace(runtime, trace), first);
  assert.deepEqual(replayTrace(runtime, trace), first);
  assert.equal(first.frames.length, 83);
  assert.match(first.checkpoints.find(c => c.checkpoint === 'title').drawCalls
    .map(call => call.text ?? '').join(' '), /Press x to start/i);
  assert.match(first.checkpoints.find(c => c.checkpoint === 'gameplay').drawCalls
    .map(call => call.text ?? '').join(' '), /Score/i);
});

test('changing movement changes rendered output, and removing dash changes its checkpoint', async () => {
  const runtime = await createReplayRuntime(cartridge);
  const original = replayTrace(runtime, trace);
  const movement = structuredClone(trace);
  movement.steps.find(step => step.checkpoint === 'move-right').buttons = BUTTONS.LEFT;
  const different = replayTrace(runtime, movement);
  const at = (result, name) => result.checkpoints.find(c => c.checkpoint === name);
  assert.notEqual(at(original, 'move-right').framebufferHash, at(different, 'move-right').framebufferHash);
  const noDash = structuredClone(trace);
  noDash.steps.find(step => step.checkpoint === 'dash-right').buttons = BUTTONS.RIGHT;
  const walking = replayTrace(runtime, noDash);
  assert.notEqual(at(original, 'dash-right').framebufferHash, at(walking, 'dash-right').framebufferHash);
});

test('batched updates match stepping once per frame', async () => {
  const runtime = await createReplayRuntime(cartridge);
  runtime.step(BUTTONS.X);
  const batched = runtime.step(BUTTONS.RIGHT, 40);
  runtime.reset();
  runtime.step(BUTTONS.X);
  for (let frame = 0; frame < 40; frame++) runtime.step(BUTTONS.RIGHT);
  assert.deepEqual(runtime.observe(), batched);
});

test('reset recreates WASM globals, memory, input, and empty storage', async () => {
  const probe = compile(`(module
    (import "env" "memory" (memory 1 1))
    (import "env" "rect" (func $rect (param i32 i32 i32 i32)))
    (import "env" "diskr" (func $read (param i32 i32) (result i32)))
    (import "env" "diskw" (func $write (param i32 i32) (result i32)))
    (global $counter (mut i32) (i32.const 0))
    (func (export "start")
      (call $rect (call $read (i32.const 8192) (i32.const 4)) (i32.const 0) (i32.const 2) (i32.const 2)))
    (func (export "update")
      (global.set $counter (i32.add (global.get $counter) (i32.const 1)))
      (i32.store (i32.const 8192) (global.get $counter))
      (drop (call $write (i32.const 8192) (i32.const 4)))
      (call $rect (global.get $counter) (i32.const 0) (i32.const 2) (i32.const 2))))`);
  const runtime = await createReplayRuntime(probe);
  const initial = runtime.observe();
  const first = runtime.step(BUTTONS.RIGHT);
  assert.equal(first.storage.bytes, 4);
  assert.equal(first.drawCalls[0].args[0], 1);
  runtime.step(BUTTONS.X, 5);
  assert.deepEqual(runtime.reset(), initial);
  assert.equal(runtime.observe().storage.bytes, 0);
  assert.equal(runtime.observe().drawCalls[0].args[0], 0);
  assert.deepEqual(runtime.step(BUTTONS.RIGHT), first);
});

test('invalid input and traces fail before advancing the runtime', async () => {
  const runtime = await createReplayRuntime(cartridge);
  const initial = runtime.observe();
  for (const buttons of [-1, 4, 256, 1.5, NaN]) assert.throws(() => runtime.step(buttons), RangeError);
  for (const frames of [0, -1, 1.5, 36_001, Infinity]) assert.throws(() => runtime.step(0, frames), RangeError);
  assert.deepEqual(runtime.observe(), initial);
  assert.throws(() => validateTrace({ ...trace, steps: [] }));
  assert.throws(() => validateTrace({ ...trace, steps: [trace.steps[0], trace.steps[0]] }));
  assert.throws(() => validateTrace({ ...trace, steps: [{ buttons: 0, frames: 36_001, checkpoint: 'too-long' }] }));
});

test('a cartridge trap fails the replay with its frame number', async () => {
  const probe = compile('(module (import "env" "memory" (memory 1 1)) (func (export "update") unreachable))');
  const runtime = await createReplayRuntime(probe);
  assert.throws(() => runtime.step(0), /update failed at frame 1.*unreachable/);
  assert.throws(() => runtime.step(0), /reset before stepping again/);
  runtime.reset();
  assert.throws(() => runtime.step(0), /update failed at frame 1.*unreachable/);
});
