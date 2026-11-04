import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { digest } from '../component/build.mjs';
import { compileExhaustiveCandidate } from './exhaustive-candidate.mjs';
import { evaluateRecoveryMotion } from './recovery-motion.mjs';
import { assertVerifiedStateSpace, DEFAULT_CONFIG, DISPLACEMENT_TOLERANCE, getDonorStateSpace } from './state-space.mjs';

export const MAX_EXHAUSTIVE_CHECKS = 12_000_000;
const execute = promisify(execFile);
const worker = fileURLToPath(new URL('exhaustive-worker.mjs', import.meta.url));

export function counterexampleTrace(buttons, idleTicks = 12) {
  const steps = [];
  for (const input of [...buttons, ...Array(idleTicks).fill(0)]) {
    if (steps.at(-1)?.buttons === input) steps.at(-1).frames++;
    else steps.push({ buttons: input, frames: 1 });
  }
  return { name: 'exhaustive-counterexample', steps };
}

/** No pass is possible on a cap, invalid state, failed projection or unconfirmed trace. */
export async function verifyExhaustiveMotion(source, config, {
  timerFields, space, maxChecks = MAX_EXHAUSTIVE_CHECKS, timeoutMs = 120_000, signal,
} = {}) {
  const identity = { schemaVersion: 1, sourceSha256: digest(typeof source === 'string' ? source : ''),
    displacementTolerance: DISPLACEMENT_TOLERANCE, maxChecks };
  try {
    if (!Number.isSafeInteger(maxChecks) || maxChecks < 1 || maxChecks > MAX_EXHAUSTIVE_CHECKS) throw Error('Invalid exhaustive search cap');
    if (!timerFields || Object.keys(timerFields).sort().join(',') !== 'cooldown,remaining'
      || !Object.values(timerFields).every(field => typeof field === 'string' && /^[a-zA-Z_$][\w$]{0,39}$/.test(field)
        && !['__proto__', 'prototype', 'constructor', 'x', 'y'].includes(field))) throw Error('Invalid exhaustive timerFields');
    if (!config || Object.keys(config).sort().join(',') !== Object.keys(DEFAULT_CONFIG).sort().join(',')
      || !Object.values(config).every(Number.isFinite)) throw Error('Invalid candidate configuration');
    const compiled = await compileExhaustiveCandidate(source);
    space ??= await getDonorStateSpace();
    assertVerifiedStateSpace(space);
    const child = execute(process.execPath, ['--max-old-space-size=192', worker], {
      env: { PATH: process.env.PATH ?? '' }, timeout: timeoutMs, maxBuffer: 512 * 1024, signal,
    });
    child.child.stdin.on('error', () => {}); // The child may be killed while the graph is being sent.
    child.child.stdin.end(JSON.stringify({ code: compiled.code, config, timerFields,
      space: { rootKey: space.rootKey, buttonMasks: space.buttonMasks, states: space.states }, maxChecks, tolerance: DISPLACEMENT_TOLERANCE }));
    const { stdout } = await child;
    const result = JSON.parse(stdout);
    if (!['proved', 'counterexample', 'inconclusive'].includes(result.verdict)) throw Error('Invalid exhaustive worker response');
    if (result.verdict === 'counterexample') {
      const trace = counterexampleTrace(result.counterexample.buttons);
      const confirmation = await evaluateRecoveryMotion(source, config, [trace], { suite: 'development', timerFields, signal });
      result.counterexample.trace = trace;
      result.counterexample.confirmation = confirmation;
      if (confirmation.passed) {
        result.verdict = 'inconclusive';
        result.reason = 'counterexample-not-confirmed';
      }
    }
    return { ...identity, cartridgeSha256: space.cartridgeSha256,
      transitionsSha256: space.verification.transitionsSha256, ...result };
  } catch (error) {
    return { ...identity, verdict: 'inconclusive', reason: signal?.aborted ? 'cancelled' : error.killed ? 'time-limit' : 'verification-error',
      error: String(error.message).slice(0, 500) };
  }
}
