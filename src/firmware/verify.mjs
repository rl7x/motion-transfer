import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { digest } from '../component/build.mjs';
import { compileExhaustiveCandidate } from '../evaluator/exhaustive-candidate.mjs';

export const MAX_FIRMWARE_CHECKS = 12_000_000;
const execute = promisify(execFile);
const worker = fileURLToPath(new URL('verify-worker.mjs', import.meta.url));
const firmwarePath = fileURLToPath(new URL('../../assets/targets/px4-arming/arming.wasm', import.meta.url));

/** A cap, a refusal or an unconfirmed trace is never a pass. */
export async function verifyFirmwareCandidate(source, { maxChecks = MAX_FIRMWARE_CHECKS, timeoutMs = 170_000, signal } = {}) {
  const identity = { schemaVersion: 1, sourceSha256: digest(typeof source === 'string' ? source : ''), maxChecks };
  try {
    const compiled = await compileExhaustiveCandidate(source);
    const child = execute(process.execPath, ['--max-old-space-size=512', worker], {
      env: { PATH: process.env.PATH ?? '' }, timeout: timeoutMs, maxBuffer: 512 * 1024, signal,
    });
    child.child.stdin.on('error', () => {});
    child.child.stdin.end(JSON.stringify({ code: compiled.code, firmwarePath, maxChecks }));
    const { stdout } = await child;
    const result = JSON.parse(stdout);
    if (!['proved', 'counterexample', 'inconclusive'].includes(result.verdict)) throw Error('Invalid worker response');
    return { ...identity, ...result };
  } catch (error) {
    return { ...identity, verdict: 'inconclusive', reason: signal?.aborted ? 'cancelled' : error.killed ? 'time-limit' : 'verification-error',
      error: String(error.message).slice(0, 500) };
  }
}
