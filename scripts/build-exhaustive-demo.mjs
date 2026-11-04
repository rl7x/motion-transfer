import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadTarget } from '../src/agent/target.mjs';
import { compileMotion, digest } from '../src/component/build.mjs';
import { executeMotion } from '../src/component/run.mjs';
import { loadExhaustiveCandidates } from '../src/evaluator/exhaustive-evidence.mjs';
import { getDonorStateSpace, motionStateKey } from '../src/evaluator/state-space.mjs';
import { createReplayRuntime } from '../src/runtime/replay.mjs';
import { observeDonorMotion } from '../src/runtime/donor-observation.mjs';
import { framebufferPng } from '../src/runtime/png.mjs';

const evidenceFile = new URL('../assets/evidence/exhaustive.json', import.meta.url);
const demoFile = new URL('../assets/evidence/exhaustive-demo.json', import.meta.url);

export async function buildExhaustiveDemo() {
  const evidenceBytes = await readFile(evidenceFile), evidence = JSON.parse(evidenceBytes);
  const recorded = evidence.candidates.find(candidate => candidate.id === 'fixture-walking-facing-assumption');
  assert.equal(recorded.verdict, 'counterexample');
  const candidate = (await loadExhaustiveCandidates()).find(candidate => candidate.id === recorded.id);
  assert.equal(digest(candidate.source), recorded.sourceSha256);
  const space = await getDonorStateSpace();
  const inputs = recorded.counterexample.trace.steps.flatMap(step =>
    Array.from({ length: step.frames }, () => ({ buttons: step.buttons, sourceBodyWidth: 8 })));
  const [rollout] = await executeMotion(await compileMotion(candidate.source), [{ name: 'demo', inputs }], candidate.defaults);
  const runtime = await createReplayRuntime((await loadTarget()).bytes);
  runtime.step(1);
  let position = { ...observeDonorMotion(runtime).position };
  const sample = (tick, buttons) => {
    const observed = observeDonorMotion(runtime);
    const palette = runtime.observe().palette;
    return { tick, buttons, stateKey: motionStateKey(observed), donor: observed.position,
      candidate: { ...position }, png: 'data:image/png;base64,' + framebufferPng(runtime.framebuffer.bytes, palette).toString('base64') };
  };
  const frames = [sample(0, 0)];
  for (const [index, input] of inputs.entries()) {
    runtime.step(input.buttons);
    const output = rollout.frames[index];
    position = { x: Math.fround(position.x + output.displacement.x), y: Math.fround(position.y + output.displacement.y) };
    frames.push(sample(index + 1, input.buttons));
  }
  return { schemaVersion: 1, evidenceSha256: digest(evidenceBytes), cartridgeSha256: space.cartridgeSha256,
    states: space.states.map(({ key, control }) => ({ key, ...control })),
    transitions: evidence.donor.transitions, sampledTransitions: evidence.coverage.combined.transitions,
    limitations: evidence.limitations, candidateId: recorded.id, candidateSourceSha256: recorded.sourceSha256,
    divergenceTick: recorded.counterexample.length, frames };
}

export async function verifyExhaustiveDemo() {
  assert.deepEqual(await buildExhaustiveDemo(), JSON.parse(await readFile(demoFile)), 'Demo must replay the recorded binary/candidate evidence');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--check')) await verifyExhaustiveDemo();
  else await writeFile(demoFile, JSON.stringify(await buildExhaustiveDemo(), null, 2) + '\n', { flag: 'wx' });
  console.log('Exhaustive demo frames verified against the real cartridge and historical candidate.');
}
