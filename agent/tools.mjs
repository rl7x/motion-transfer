import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { MAX_TOOL_OUTPUT_BYTES, validateToolInput } from './tool-schema.mjs';

const execute = promisify(execFile);
const worker = fileURLToPath(new URL('tool-worker.mjs', import.meta.url));

export async function runCartridgeTool(name, args, { signal, timeoutMs = 10_000 } = {}) {
  validateToolInput(name, args);
  const input = JSON.stringify({ name, args });
  if (Buffer.byteLength(input) > 8_192) throw new Error('Tool request exceeds 8 KB');
  const promise = execute(process.execPath, [worker], {
    env: { PATH: process.env.PATH ?? '', ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}) },
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    signal,
  });
  promise.child.stdin.end(input);
  let output;
  try {
    ({ stdout: output } = await promise);
  } catch (error) {
    if (signal?.aborted) throw new Error('Cartridge experiment cancelled');
    if (error.killed) throw new Error('Cartridge experiment exceeded its time limit');
    try {
      const failure = JSON.parse(error.stdout);
      if (failure.ok === false) throw new Error(failure.error);
    } catch (failure) {
      if (!(failure instanceof SyntaxError)) throw failure;
    }
    throw new Error('Cartridge tool process failed');
  }
  const result = JSON.parse(output);
  if (!result.ok) throw new Error(result.error);
  if (Buffer.byteLength(JSON.stringify(result.result)) > MAX_TOOL_OUTPUT_BYTES) {
    throw new Error('Tool output exceeds 32 KB; use fewer checkpoints or a smaller WAT range');
  }
  return { result: result.result, evidence: result.evidence };
}
