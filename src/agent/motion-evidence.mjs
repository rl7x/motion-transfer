import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { loadTarget } from './target.mjs';
import { digest } from '../component/build.mjs';
import { DEVELOPMENT_CASES } from '../evaluator/cases.mjs';
import { recordDonorMotion } from '../evaluator/dashy-dango.mjs';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);

export function sampleMotionEvidence(reference) {
  const indices = new Set();
  const add = index => { if (index >= 0 && index < reference.frames.length) indices.add(index); };
  for (let index = 0; index < Math.min(12, reference.frames.length); index++) add(index);
  add(reference.frames.length - 1);
  reference.frames.forEach((frame, index) => {
    if (frame.output.events.length || frame.buttons !== reference.frames[index - 1]?.buttons) {
      add(index - 1); add(index); add(index + 1);
    }
  });
  return {
    id: `dev:${reference.name}`, steps: reference.steps, totalTicks: reference.frames.length,
    columns: ['tick', 'buttons', 'x', 'y', 'remaining', 'cooldown', 'directionX', 'directionY', 'ownsMotion', 'events'],
    samples: [...indices].sort((a, b) => a - b).map(index => {
      const frame = reference.frames[index], state = frame.observation;
      return [frame.tick, frame.buttons, state.position.x, state.position.y, state.remaining, state.cooldown,
        state.direction.x, state.direction.y, frame.output.ownsMotion, frame.output.events];
    }),
  };
}

export async function prepareMotionEvidence({ signal } = {}) {
  const target = await loadTarget();
  const directory = await mkdtemp(join(tmpdir(), 'motion-evidence-'));
  let decompiled;
  try {
    const cartridge = join(directory, 'cart.wasm');
    await writeFile(cartridge, target.bytes);
    const tool = join(dirname(require.resolve('wabt/package.json')), 'bin/wasm-decompile');
    ({ stdout: decompiled } = await execute(process.execPath, [tool, cartridge], {
      env: { PATH: process.env.PATH ?? '' }, timeout: 10_000, maxBuffer: 2 * 1024 * 1024, signal,
    }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const lines = decompiled.split('\n');
  const functions = [];
  lines.forEach((line, index) => {
    const match = line.match(/^(?:export |import )?function .*\/\/ func(\d+)$/);
    if (match) functions.push({ index: Number(match[1]), start: index });
  });
  const selected = [9, 23, 70, 102].map(index => {
    const at = functions.findIndex(fn => fn.index === index);
    if (at === -1) throw new Error(`Decompiler did not expose function ${index}`);
    return {
      id: `binary:func${index}`, functionIndex: index,
      text: lines.slice(functions[at].start, functions[at + 1]?.start ?? lines.length).join('\n').trim(),
    };
  });
  const traces = [];
  let initial;
  for (const trace of DEVELOPMENT_CASES) {
    if (signal?.aborted) throw new Error('Evidence preparation cancelled');
    const reference = await recordDonorMotion(trace);
    const { pointers, frame, entity, ...state } = reference.initial;
    initial ??= state;
    traces.push(sampleMotionEvidence(reference));
  }
  const evidence = {
    schemaVersion: 1, cartridgeSha256: target.sha256,
    origin: 'Pinned binary, WABT 1.0.39 decompilation, and actual donor execution. No original source.',
    humanAssistance: ['Selected the motion boundary and function slices', 'Mapped live registry and numeric state fields', 'Selected development inputs and evaluator events'],
    decompilationNotice: 'Approximate C-like pseudocode, not original source. Validate interpretations through execution.',
    numericNotice: 'Positions and direction are float32; timers are signed int16; distance and body width are uint16.',
    initial, functions: selected, traces,
  };
  return { ...evidence, sha256: digest(JSON.stringify(evidence)) };
}
