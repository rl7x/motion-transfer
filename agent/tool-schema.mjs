import { MEMORY_TYPES, validateMemoryWatches } from '../runtime/memory.mjs';

export const MAX_TOOL_OUTPUT_BYTES = 32_768;

export const TOOLS = [{
  type: 'function',
  name: 'inspect_wasm',
  description: 'Inspect the pinned cartridge only. overview returns imports/exports; wat returns numbered disassembly lines with generated names and no debug names. Long lines are abbreviated. No source files are accessible.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      view: { type: 'string', enum: ['overview', 'wat'] },
      startLine: { type: 'integer', minimum: 1, maximum: 100_000, description: 'First WAT line; ignored for overview.' },
      lineCount: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum WAT lines; ignored for overview.' },
    },
    required: ['view', 'startLine', 'lineCount'],
    additionalProperties: false,
  },
}, {
  type: 'function',
  name: 'list_functions',
  description: 'List generated function names, signatures, exports, WAT locations, and counts of direct calls and memory instructions in the pinned cartridge. Function indices include imports. Page with nextIndex; names are not recovered source names.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      startIndex: { type: 'integer', minimum: 0, maximum: 100_000 },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
    required: ['startIndex', 'limit'],
    additionalProperties: false,
  },
}, {
  type: 'function',
  name: 'inspect_function',
  description: 'Inspect one function by index from list_functions. Returns direct callers/callees and up to 100 WAT lines with call sites and memory load/store offsets in that window. startLine is relative to the function, starting at 1. Indirect calls are marked unresolved. A memory offset is added to a runtime base address; it is not necessarily an absolute address. This is disassembly, not recovered source.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      functionIndex: { type: 'integer', minimum: 0, maximum: 100_000 },
      startLine: { type: 'integer', minimum: 1, maximum: 100_000 },
      lineCount: { type: 'integer', minimum: 1, maximum: 100 },
    },
    required: ['functionIndex', 'startLine', 'lineCount'],
    additionalProperties: false,
  },
}, {
  type: 'function',
  name: 'run_original',
  description: 'Run a controlled experiment from fresh cartridge, memory, and empty storage. Each step holds a gamepad mask for fixed 60 Hz updates. Returns checkpoint hashes, visible text, grouped sprite coordinates, requested read-only memory watches, and motion fields from the host\'s HUMAN-MAPPED, hash-guarded donor registry: world position, direction, remaining active ticks, cooldown, sourceBodyWidth. Null motion means unavailable outside gameplay. The agent does not discover this registry mapping. Use world position to distinguish player movement from camera motion. Watches read little-endian numeric values at absolute byte addresses; use [] when unused. X=1 starts/dashes; Z=2; left=16; right=32; up=64; down=128. OR bits to combine; 0 releases. Maximum 12 checkpoints, 1,800 total frames, and 64 watched values. No source or filesystem access.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      hypothesis: { type: 'string', minLength: 1, maxLength: 500 },
      watches: {
        type: 'array', maxItems: 8,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 40 },
            address: { type: 'integer', minimum: 0, maximum: 65_535 },
            type: { type: 'string', enum: MEMORY_TYPES },
            count: { type: 'integer', minimum: 1, maximum: 16 },
          },
          required: ['name', 'address', 'type', 'count'],
          additionalProperties: false,
        },
      },
      steps: {
        type: 'array', minItems: 1, maxItems: 12,
        items: {
          type: 'object',
          properties: {
            buttons: { type: 'integer', minimum: 0, maximum: 255 },
            frames: { type: 'integer', minimum: 1, maximum: 600 },
            checkpoint: { type: 'string', minLength: 1, maxLength: 40 },
          },
          required: ['buttons', 'frames', 'checkpoint'],
          additionalProperties: false,
        },
      },
    },
    required: ['hypothesis', 'watches', 'steps'],
    additionalProperties: false,
  },
}];

function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`Expected only these fields: ${keys.join(', ')}`);
  }
}

function integer(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

export function validateToolInput(name, args) {
  if (name === 'list_functions') {
    object(args, ['startIndex', 'limit']);
    if (!integer(args.startIndex, 0, 100_000) || !integer(args.limit, 1, 50)) {
      throw new Error('Invalid function index range');
    }
    return;
  }
  if (name === 'inspect_function') {
    object(args, ['functionIndex', 'startLine', 'lineCount']);
    if (!integer(args.functionIndex, 0, 100_000) || !integer(args.startLine, 1, 100_000) || !integer(args.lineCount, 1, 100)) {
      throw new Error('Invalid function index or relative line range');
    }
    return;
  }
  if (name === 'inspect_wasm') {
    object(args, ['view', 'startLine', 'lineCount']);
    if (!['overview', 'wat'].includes(args.view) || !integer(args.startLine, 1, 100_000) || !integer(args.lineCount, 1, 100)) {
      throw new Error('Invalid inspection view or WAT line range');
    }
    return;
  }
  if (name !== 'run_original') throw new Error(`Unknown tool: ${name}`);
  object(args, ['hypothesis', 'watches', 'steps']);
  validateMemoryWatches(args.watches);
  if (typeof args.hypothesis !== 'string' || !args.hypothesis.trim() || args.hypothesis.length > 500) {
    throw new Error('hypothesis must contain 1–500 characters');
  }
  if (!Array.isArray(args.steps) || args.steps.length < 1 || args.steps.length > 12) {
    throw new Error('An experiment needs 1–12 steps');
  }
  let frames = 0;
  const names = new Set(['reset']);
  for (const step of args.steps) {
    object(step, ['buttons', 'frames', 'checkpoint']);
    if (!integer(step.buttons, 0, 255) || (step.buttons & 0x0c) || !integer(step.frames, 1, 600)) {
      throw new Error('Each step needs valid gamepad bits and 1–600 frames');
    }
    if (typeof step.checkpoint !== 'string' || !step.checkpoint.trim() || step.checkpoint.length > 40 || names.has(step.checkpoint)) {
      throw new Error('Checkpoints must be unique names of 1–40 characters; reset is reserved');
    }
    frames += step.frames;
    names.add(step.checkpoint);
  }
  if (frames > 1_800) throw new Error('An experiment cannot exceed 1,800 frames');
}
