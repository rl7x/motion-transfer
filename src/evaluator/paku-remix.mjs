import { init, step } from '../../assets/components/dashy-dango-dash/component.js';
import { compileAdapter, executeAdapter } from '../transfer/adapter.mjs';
import { adapterCases } from './paku-adapter.mjs';
import { validateIntent } from '../remix/contract.mjs';

export function remixInput(frame, intent, previousDash) {
  const direction = frame.facing * (intent.direction === 'opposite' ? -1 : 1);
  const active = frame.dash && (intent.activation === 'held' || !previousDash);
  return { buttons: (direction < 0 ? 16 : 32) | (active ? 1 : 0), sourceBodyWidth: 8 };
}

export async function evaluatePakuRemix(source, intent, { signal } = {}) {
  validateIntent(intent);
  const compiled = await compileAdapter(source);
  const cases = adapterCases().map(trace => ({ ...trace, scale: intent.unitScale }));
  cases.push({ name: 'fresh-press-after-recharge', scale: intent.unitScale,
    frames: Array.from({ length: 130 }, (_, tick) => ({tick, position:40, facing:tick < 70 ? 1 : -1,
      normalDisplacement:tick < 70 ? 0.6 : -0.6, dash:(tick >= 10 && tick < 80) || tick >= 90})) });
  const actual = await executeAdapter(compiled, cases, { signal });
  const results = cases.map((trace, traceIndex) => {
    let state = init(compiled.defaults), previousDash = false, firstDivergence = null;
    trace.frames.forEach((frame, index) => {
      const input = remixInput(frame, intent, previousDash);
      previousDash = frame.dash;
      const result = step(state, input, compiled.defaults);
      state = result.state;
      const expected = trace.mockOutputs?.[index] ?? result.output;
      const displacement = expected.ownsMotion ? expected.displacement.x * intent.unitScale : frame.normalDisplacement;
      const output = actual[traceIndex].outputs[index];
      const supplied = actual[traceIndex].inputs[index];
      if (!firstDivergence && (supplied.buttons !== input.buttons || supplied.sourceBodyWidth !== 8
        || Math.abs(displacement - output.displacement) > 1e-9 || output.ownsMotion !== expected.ownsMotion
        || JSON.stringify(output.events) !== JSON.stringify(expected.events))) {
        firstDivergence = { tick:index + 1, expected:{input,displacement,ownsMotion:expected.ownsMotion,events:expected.events}, actual:{input:supplied,...output} };
      }
    });
    return {name:trace.name,ticks:trace.frames.length,passed:firstDivergence===null,firstDivergence};
  });
  return { schemaVersion:1, gate:'remix-conformance', passed:results.every(result=>result.passed), intent,
    componentId:compiled.componentId,sourceSha256:compiled.sourceSha256,javascriptSha256:compiled.javascriptSha256,results };
}
