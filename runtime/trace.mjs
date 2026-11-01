import { MAX_FRAMES } from './replay.mjs';
import { validateMemoryWatches } from './memory.mjs';

export function validateTrace(trace) {
  if (trace?.schemaVersion !== 1 || !Array.isArray(trace.steps) || !trace.steps.length) {
    throw new Error('Trace must have schemaVersion 1 and a nonempty steps array');
  }
  let total = 0;
  const checkpoints = new Set(['reset']);
  for (const step of trace.steps) {
    if (typeof step?.checkpoint !== 'string' || !step.checkpoint.trim() || checkpoints.has(step.checkpoint)) {
      throw new Error('Each trace step needs a unique nonempty checkpoint name');
    }
    if (!Number.isInteger(step.buttons) || step.buttons < 0 || step.buttons > 255 || (step.buttons & 0x0c)) {
      throw new Error(`Invalid buttons at ${step.checkpoint}`);
    }
    if (!Number.isSafeInteger(step.frames) || step.frames < 1 || step.frames > MAX_FRAMES) {
      throw new Error(`Invalid frame count at ${step.checkpoint}`);
    }
    total += step.frames;
    checkpoints.add(step.checkpoint);
  }
  if (total > MAX_FRAMES) throw new Error(`Trace exceeds ${MAX_FRAMES} frames`);
  return total;
}

export function replayTrace(runtime, trace, { watches = [] } = {}) {
  validateTrace(trace);
  validateMemoryWatches(watches, runtime.memory.buffer.byteLength);
  const observe = observation => watches.length ? { ...observation, memory: runtime.readMemory(watches) } : observation;
  const checkpoints = [{ checkpoint: 'reset', ...observe(runtime.reset()) }];
  const frames = [];
  for (const step of trace.steps) {
    let observation;
    for (let frame = 0; frame < step.frames; frame++) {
      observation = runtime.step(step.buttons);
      frames.push({
        frame: observation.frame,
        framebufferHash: observation.framebufferHash,
        memoryHash: observation.memoryHash,
        palette: observation.palette,
        storage: observation.storage,
      });
    }
    checkpoints.push({ checkpoint: step.checkpoint, ...observe(observation) });
  }
  return { frames, checkpoints };
}
