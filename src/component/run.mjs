import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const worker = fileURLToPath(new URL('worker.mjs', import.meta.url));

function validateOutput(output) {
  if (!output || Object.keys(output).sort().join(',') !== 'displacement,events,ownsMotion'
    || typeof output.ownsMotion !== 'boolean'
    || !output.displacement || Object.keys(output.displacement).sort().join(',') !== 'x,y'
    || ![output.displacement.x, output.displacement.y].every(Number.isFinite)
    || !Array.isArray(output.events) || output.events.length > 2
    || new Set(output.events).size !== output.events.length
    || output.events.some(event => !['dash-start', 'dash-end'].includes(event))) {
    throw new Error('Component returned an invalid motion output');
  }
}

export async function executeMotion(compiled, traces, config, { signal, timeoutMs = 5_000,timerFields } = {}) {
  if(timerFields&&(!timerFields||Object.keys(timerFields).sort().join(',')!=='cooldown,remaining'||!Object.values(timerFields).every(name=>typeof name==='string'&&/^[a-zA-Z_$][\w$]{0,39}$/.test(name)&&!['__proto__','constructor','prototype'].includes(name))))throw Error('Invalid normalized timer fields');
  if (!Array.isArray(traces) || traces.length < 1 || traces.length > 32
    || traces.some(trace => !Array.isArray(trace.inputs) || trace.inputs.length < 1 || trace.inputs.length > 600)) {
    throw new Error('Run 1–32 traces of 1–600 motion inputs');
  }
  const payload = JSON.stringify({ code: compiled.code, traces, config,timerFields });
  if (Buffer.byteLength(payload) > 512 * 1024) throw new Error('Candidate request exceeds 512 KB');
  const promise = execute(process.execPath, ['--max-old-space-size=64', worker], {
    env: { PATH: process.env.PATH ?? '' }, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, signal,
  });
  promise.child.stdin.end(payload);
  let stdout;
  try {
    ({ stdout } = await promise);
  } catch (error) {
    if (signal?.aborted) throw new Error('Component execution cancelled');
    if (error.killed) throw new Error('Component execution exceeded its time limit');
    try {
      const failure = JSON.parse(error.stdout);
      if (failure.ok === false) throw new Error(failure.error);
    } catch (failure) {
      if (!(failure instanceof SyntaxError)) throw failure;
    }
    throw new Error('Component process failed');
  }
  const result = JSON.parse(stdout);
  if (!result.ok || !Array.isArray(result.traces) || result.traces.length !== traces.length) throw new Error('Invalid component process response');
  result.traces.forEach((trace, index) => {
    if (trace.name !== traces[index].name || trace.frames.length !== traces[index].inputs.length) throw new Error('Component rollout length mismatch');
    trace.frames.forEach(validateOutput);
    if(timerFields&&(!Array.isArray(trace.timerSamples)||trace.timerSamples.length!==trace.frames.length||trace.timerSamples.some(timers=>!Number.isSafeInteger(timers.cooldown)||!Number.isSafeInteger(timers.remaining))))throw Error('Component returned invalid normalized timers');
  });
  return result.traces;
}
