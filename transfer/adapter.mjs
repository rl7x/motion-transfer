import { validateAdapterOutput } from './output.mjs';
export { validateAdapterOutput } from './output.mjs';
import { transform } from 'esbuild';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { compileMotion } from '../component/build.mjs';
import { resolveComponentRef, componentIdentity } from '../component/reference.mjs';

const execute = promisify(execFile);
const worker = fileURLToPath(new URL('worker.mjs', import.meta.url));

export async function compileAdapter(source, { componentRef } = {}) {
  const adapter = await compileMotion(source);
  const motion = await resolveComponentRef(componentRef);
  const compiled = await transform(motion.javascript, { format: 'iife', globalName: 'recovered', target: 'es2022' });
  return { ...adapter, componentCode: compiled.code, componentId: motion.provenance.id,
    componentRef: componentIdentity(motion), defaults: motion.contract.defaults };
}

export async function executeAdapter(compiled, traces, { signal } = {}) {
  const payload = JSON.stringify({ code: compiled.code, componentCode: compiled.componentCode, defaults: compiled.defaults, traces });
  if (Buffer.byteLength(payload) > 512 * 1024) throw new Error('Adapter request exceeds 512 KB');
  const promise = execute(process.execPath, ['--max-old-space-size=64', worker], {
    env: { PATH: process.env.PATH ?? '' }, timeout: 5_000, maxBuffer: 4 * 1024 * 1024, signal,
  });
  promise.child.stdin.end(payload);
  let stdout;
  try { ({ stdout } = await promise); }
  catch (error) {
    if (signal?.aborted) throw new Error('Adapter execution cancelled');
    if (error.killed) throw new Error('Adapter exceeded its process time limit');
    try { const result = JSON.parse(error.stdout); if (!result.ok) throw new Error(result.error); }
    catch (failure) { if (!(failure instanceof SyntaxError)) throw failure; }
    throw new Error('Adapter worker failed');
  }
  const result = JSON.parse(stdout);
  if (!result.ok || !Array.isArray(result.traces) || result.traces.length !== traces.length) throw new Error('Invalid adapter worker response');
  result.traces.forEach((trace, index) => {
    if (trace.name !== traces[index].name || trace.outputs.length !== traces[index].frames.length) throw new Error('Adapter trace length mismatch');
    trace.outputs.forEach(validateAdapterOutput);
  });
  return result.traces;
}
