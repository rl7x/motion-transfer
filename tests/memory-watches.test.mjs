import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import wabtFactory from 'wabt';
import { createReplayRuntime } from '../src/runtime/replay.mjs';
import { validateMemoryWatches } from '../src/runtime/memory.mjs';
import { replayTrace } from '../src/runtime/trace.mjs';
import { runCartridgeTool } from '../src/agent/tools.mjs';

const wabt = await wabtFactory();
const module = wabt.parseWat('memory-probe.wat', `(module
  (import "env" "memory" (memory 1 1))
  (func (export "start")
    (i32.store (i32.const 8192) (i32.const 0x78563412))
    (f32.store (i32.const 8196) (f32.const -1.5))
    (f64.store (i32.const 8200) (f64.const inf))
    (f64.store (i32.const 8208) (f64.const -0))
    (f32.store (i32.const 8216) (f32.const nan)))
  (func (export "update")
    (i32.store (i32.const 8192) (i32.add (i32.load (i32.const 8192)) (i32.const 1)))))`);
let cartridge;
try {
  cartridge = module.toBinary({}).buffer;
} finally {
  module.destroy();
}
const watch = (name, address, type, count = 1) => ({ name, address, type, count });

test('memory watches read typed little-endian values without changing state or sharing buffers', async () => {
  const runtime = await createReplayRuntime(cartridge);
  const before = runtime.observe();
  const results = runtime.readMemory([
    watch('unsigned', 8192, 'u32'), watch('signed', 8196, 'i32'), watch('float', 8196, 'f32'),
    watch('special', 8200, 'f64', 2), watch('bytes', 8192, 'u8', 4), watch('signedBytes', 8198, 'i8', 2),
    watch('unaligned', 8193, 'u16'), watch('short', 8198, 'i16'),
  ]);
  assert.deepEqual(results.map(result => result.values), [
    [0x78563412], [-1077936128], [-1.5], ['Infinity', '-0'], [0x12, 0x34, 0x56, 0x78], [-64, -65], [0x5634], [-16448],
  ]);
  assert.equal(results[0].bytesHex, '12345678');
  assert.deepEqual(runtime.observe(), before);
  results[0].values[0] = 0;
  assert.equal(runtime.readMemory([watch('unsigned', 8192, 'u32')])[0].values[0], 0x78563412);
  const nan = runtime.readMemory([watch('nan', 8216, 'f32')]);
  assert.deepEqual(JSON.parse(JSON.stringify(nan))[0].values, ['NaN']);
});

test('trace watches capture reset and checkpoint state without changing replay hashes', async () => {
  const runtime = await createReplayRuntime(cartridge);
  const trace = { schemaVersion: 1, steps: [
    { buttons: 0, frames: 1, checkpoint: 'first' }, { buttons: 32, frames: 2, checkpoint: 'third' },
  ] };
  const plain = replayTrace(runtime, trace);
  const observed = replayTrace(runtime, trace, { watches: [watch('counter', 8192, 'u32')] });
  assert.deepEqual(observed.frames, plain.frames);
  assert.deepEqual(observed.checkpoints.map(checkpoint => checkpoint.memory[0].values[0]), [0x78563412, 0x78563413, 0x78563415]);
  assert.deepEqual(observed.checkpoints.map(({ memory, ...checkpoint }) => checkpoint), plain.checkpoints);
  const before = runtime.observe();
  assert.throws(() => replayTrace(runtime, trace, { watches: [watch('invalid', 65_535, 'u16')] }), /outside/);
  assert.deepEqual(runtime.observe(), before);
});

test('watch validation bounds addresses, types, names, counts, and total observation size', () => {
  validateMemoryWatches([watch('lastByte', 65_535, 'u8'), watch('lastDouble', 65_528, 'f64')]);
  for (const invalid of [
    [watch('pastEnd', 65_536, 'u8')], [watch('crossEnd', 65_529, 'f64')], [watch('negative', -1, 'u8')],
    [watch('fractional', 0.5, 'u8')], [watch('badType', 0, 'constructor')], [watch('notAString', 0, ['u8'])], [watch('empty', 0, 'u8', 0)],
    [watch('tooMany', 0, 'u8', 17)], [watch('', 0, 'u8')],
    [watch('same', 0, 'u8'), watch('same', 1, 'u8')], [{ ...watch('extra', 0, 'u8'), value: 10 }],
    Array.from({ length: 9 }, (_, index) => watch(`watch-${index}`, 0, 'u8')),
    Array.from({ length: 5 }, (_, index) => watch(`watch-${index}`, 0, 'u8', 16)),
  ]) assert.throws(() => validateMemoryWatches(invalid));
});

test('isolated donor experiments return requested watches alongside replay evidence', async () => {
  const trace = JSON.parse(await readFile(new URL('../assets/experiments/dashy-dango/start-move-dash.json', import.meta.url), 'utf8'));
  const watches = [watch('gamepadRegister', 0x16, 'u8')];
  const { result, evidence } = await runCartridgeTool('run_original', {
    hypothesis: 'The documented gamepad register reflects each held input mask.', watches, steps: trace.steps,
  });
  assert.deepEqual(result.memoryWatches, watches);
  assert.deepEqual(result.checkpoints.map(checkpoint => checkpoint.memory[0].values[0]), [0, ...trace.steps.map(step => step.buttons)]);
  assert.deepEqual(result.checkpoints.map(checkpoint => checkpoint.memory), evidence.checkpoints.map(checkpoint => checkpoint.memory));
  await assert.rejects(runCartridgeTool('run_original', {
    hypothesis: 'Invalid watch must be rejected before execution.', watches: [watch('bad', 65_535, 'f32')], steps: trace.steps,
  }), /outside/);
});
