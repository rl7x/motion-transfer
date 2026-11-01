import { loadTarget } from './target.mjs';
import { validateToolInput } from './tool-schema.mjs';
import { createReplayRuntime } from '../runtime/replay.mjs';
import { replayTrace } from '../runtime/trace.mjs';

function summarize(observation) {
  const groups = new Map();
  for (const call of observation.drawCalls) {
    if (call.name !== 'blit') continue;
    const [pointer, x, y, width, height, flags] = call.args;
    const key = `${pointer}:${width}:${height}:${call.drawColors}:${call.spriteSha256}`;
    if (!groups.has(key)) groups.set(key, {
      pointer, width, height, drawColors: call.drawColors, spriteSha256: call.spriteSha256, count: 0, positions: [],
    });
    const group = groups.get(key);
    group.count++;
    if (group.positions.length < 4) group.positions.push({ x, y, flags });
  }
  const text = observation.drawCalls.filter(call => call.name === 'textUtf8').map(call => call.text);
  return {
    checkpoint: observation.checkpoint,
    frame: observation.frame,
    framebufferHash: observation.framebufferHash,
    memoryHash: observation.memoryHash,
    palette: observation.palette,
    text: text.join('\n').slice(0, 1_000),
    textTruncated: text.join('\n').length > 1_000,
    sprites: [...groups.values()].slice(0, 8).map(group => ({
      ...group, omittedPositions: group.count - group.positions.length,
    })),
    omittedSpriteGroups: Math.max(0, groups.size - 8),
    tones: observation.tones,
  };
}

async function execute(name, args) {
  validateToolInput(name, args);
  const target = await loadTarget();
  if (name === 'run_original') {
    const runtime = await createReplayRuntime(target.bytes);
    const evidence = replayTrace(runtime, { schemaVersion: 1, steps: args.steps });
    return {
      result: {
        target: target.id,
        cartridgeSha256: target.sha256,
        frames: evidence.frames.length,
        checkpoints: evidence.checkpoints.map(summarize),
      },
      evidence,
    };
  }

  const module = new WebAssembly.Module(target.bytes);
  if (args.view === 'overview') return {
    result: {
      target: target.id, bytes: target.bytes.length, sha256: target.sha256,
      imports: WebAssembly.Module.imports(module), exports: WebAssembly.Module.exports(module),
    },
  };
  const { default: wabtFactory } = await import('wabt');
  const wabt = await wabtFactory();
  const disassembly = wabt.readWasm(target.bytes, { readDebugNames: false });
  try {
    disassembly.generateNames();
    disassembly.applyNames();
    const lines = disassembly.toText({ foldExprs: false, inlineExport: false }).split('\n');
    if (args.startLine > lines.length) throw new Error(`startLine exceeds the ${lines.length} WAT lines`);
    return {
      result: {
        sha256: target.sha256,
        totalLines: lines.length,
        lines: lines.slice(args.startLine - 1, args.startLine - 1 + args.lineCount).map((text, index) => ({
          number: args.startLine + index, text: text.slice(0, 240), truncated: text.length > 240,
        })),
        nextLine: args.startLine + args.lineCount <= lines.length ? args.startLine + args.lineCount : null,
      },
    };
  } finally {
    disassembly.destroy();
  }
}

try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 8_192) throw new Error('Tool request exceeds 8 KB');
  }
  const { name, args } = JSON.parse(input);
  process.stdout.write(JSON.stringify({ ok: true, ...await execute(name, args) }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
}
