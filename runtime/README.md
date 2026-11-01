# Deterministic cartridge replay

Run from the repository root with Node.js 22 or newer:

```sh
npm install
npm run replay
npm test
```

`npm run replay` verifies the cartridge against `targets/dashy-dango/target.lock.json`, then replays [start-move-dash.json](../experiments/dashy-dango/start-move-dash.json) three times from reset. It advances 83 simulation updates per run with no wall-clock delays. The sequence reaches gameplay, moves right, dashes, releases input, and moves down.

The command compares framebuffer and linear-memory hashes, palettes, and storage at every frame, plus drawing calls and tone requests at nine checkpoints including reset. A mismatch exits unsuccessfully. The report is written to `reports/dashy-dango-replay.json`, which is ignored by Git. Its metadata records the cartridge hash and the renderer version and source hashes.

To use a different trace or report path:

```sh
npm run replay -- experiments/dashy-dango/start-move-dash.json reports/my-replay.json
```

## API

```js
import { readFile } from 'node:fs/promises';
import { BUTTONS, createReplayRuntime } from './runtime/replay.mjs';

const cartridge = await readFile('targets/dashy-dango/cart.wasm');
const runtime = await createReplayRuntime(cartridge);

runtime.reset();
runtime.step(BUTTONS.X, 1);
runtime.step(BUTTONS.RIGHT, 30);
const observation = runtime.observe();
```

- `reset()` creates a new WebAssembly instance, memory, framebuffer, input state, and empty 1 KB disk. It runs cartridge initialization and `start`; the frame count is then zero. Storage never reads or writes the browser's saved game.
- `step(buttonMask, frames = 1)` holds the supplied input for exactly that many `update` calls and returns the final observation. Input persists through those calls; pass `0` to release all buttons. Invalid inputs are rejected before execution. A trap fails with its frame number and requires reset before further stepping.
- `observe()` returns the completed-update count, SHA-256 framebuffer and memory hashes, palette, storage size/hash, and the most recent update's drawing calls and tone requests. Calling it does not advance the simulation. After reset, calls are those emitted by initialization instead.
- `readMemory(watches)` reads explicit absolute byte addresses without advancing or changing the game. Each watch is `{name, address, type, count}`; types are `u8`, `i8`, `u16`, `i16`, `u32`, `i32`, `f32`, and `f64`. Values use little-endian byte order and may be unaligned. Results contain the watch fields, numeric `values`, and exact `bytesHex`. Non-finite floats and negative zero use strings (`"NaN"`, `"Infinity"`, `"-Infinity"`, `"-0"`) to survive JSON serialization. There are at most eight uniquely named watches, 16 values per watch, and 64 values total. Out-of-bounds reads fail before execution.

Pass `{watches}` as the third argument to `replayTrace(runtime, trace, {watches})` to add these readings at reset and named checkpoints. Per-frame hash records remain unchanged; memory values are sampled only at checkpoints. For example, `{name: 'gamepad', address: 0x16, type: 'u8', count: 1}` observes the documented WASM-4 input register. A label assigned to an unknown address is a hypothesis about its meaning. Watches do not read private WASM globals or establish the cause of a state change.

The bit masks are X `1`, Z `2`, left `16`, right `32`, up `64`, down `128`; combine them with bitwise OR. A trace uses `schemaVersion: 1`, `target: "dashy-dango"`, and a `steps` array of `{buttons, frames, checkpoint}` objects. Checkpoint names must be unique; `reset` is reserved. Traces are limited to 36,000 updates.

## Runtime reuse and limits

The harness compiles the original `constants.ts` and `framebuffer.ts` sources included in the installed `wasm4@2.7.1` developer source map using esbuild. It reuses upstream pixel rendering and fonts. The source map is checked for the required files, and any other WASM-4 package version is rejected. Installation supplies these sources; replay needs no browser, network, or upstream game source.

The local host implements the imports needed by the pinned cartridge: imported memory, drawing, `textUtf8`, `diskr`, `diskw`, and `tone`. Unimplemented imports fail at instantiation. Audio requests are recorded without synthesizing sound. This is a headless observation harness for this target, not a complete replacement for the WASM-4 browser player. `npm run dev` still uses that original player.

Repeatability checks establish that these observations match for the tested inputs. They do not establish that a recovered component is equivalent to the donor. Memory hashes cover linear memory, not private WASM globals; the reset test uses a separate probe cartridge to verify that mutable globals and storage are recreated.

This process runs the registered local target directly. It is not an isolation boundary for arbitrary uploaded or generated cartridges; those will need an external process timeout and sandbox before being exposed as agent tools.

WASM-4 is copyright Bruno Garcia and distributed under the ISC license. The installed package includes its notice in `node_modules/wasm4/LICENSE.txt`. [Upstream renderer](https://github.com/aduros/wasm4/blob/v2.7.1/runtimes/web/src/framebuffer.ts), [license](https://github.com/aduros/wasm4/blob/v2.7.1/LICENSE.txt).
