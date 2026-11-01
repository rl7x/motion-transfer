import { compileMotion } from '../component/build.mjs';
import { executeMotion } from '../component/run.mjs';
import { recordDonorMotion } from './dashy-dango.mjs';

export const POSITION_TOLERANCE = 0.25;

export async function evaluateMotion(source, config, cases, { suite = 'development', signal,timerFields } = {}) {
  const compiled = await compileMotion(source);
  const references = [];
  for (const trace of cases) references.push(await recordDonorMotion(trace));
  // The candidate receives inputs only. No donor positions, timers, expected
  // outputs, hashes, or evaluator implementation are sent to the worker.
  const actual = await executeMotion(compiled, references.map(reference => ({
    name: reference.name,
    inputs: reference.frames.map(frame => ({ buttons: frame.buttons, sourceBodyWidth: reference.initial.sourceBodyWidth })),
  })), config, { signal,timerFields });
  const results = references.map((reference, index) => {
    const position = { ...reference.initial.position };
    let maxPositionError = 0, firstDivergence = null;
    reference.frames.forEach((frame, tick) => {
      const output = actual[index].frames[tick];
      const timers=actual[index].timerSamples?.[tick];
      const timerMismatch=timerFields&&(timers.cooldown!==frame.observation.cooldown||timers.remaining!==frame.observation.remaining);
      position.x = Math.fround(position.x + output.displacement.x);
      position.y = Math.fround(position.y + output.displacement.y);
      if (![position.x, position.y].every(Number.isFinite)) throw new Error('Component trajectory became non-finite');
      const error = Math.hypot(position.x - frame.observation.position.x, position.y - frame.observation.position.y);
      maxPositionError = Math.max(maxPositionError, error);
      if (!firstDivergence && (error > POSITION_TOLERANCE || output.ownsMotion !== frame.output.ownsMotion
        || JSON.stringify(output.events) !== JSON.stringify(frame.output.events)||timerMismatch)) {
        firstDivergence = {
          tick: frame.tick, buttons: frame.buttons,
          expected: { position: frame.observation.position, ownsMotion: frame.output.ownsMotion, events: frame.output.events,...(timerFields?{timers:{cooldown:frame.observation.cooldown,remaining:frame.observation.remaining}}:{}) },
          actual: { position: { ...position }, ownsMotion: output.ownsMotion, events: output.events,...(timerFields?{timers}:{}) },
        };
      }
    });
    return { name: reference.name, ticks: reference.frames.length, passed: firstDivergence === null, maxPositionError, firstDivergence };
  });
  return {
    schemaVersion: 1, suite, sourceSha256: compiled.sourceSha256, javascriptSha256: compiled.javascriptSha256,
    passed: results.every(result => result.passed), positionTolerance: POSITION_TOLERANCE,
    eventTiming: 'exact', positionAccumulation: 'closed-loop-f32', results,
    ...(timerFields?{normalizedTimers:'exact cooldown and remaining after every update',timerFields}:{}),
  };
}
