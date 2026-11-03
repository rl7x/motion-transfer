import { init, step } from '../../assets/components/dashy-dango-dash/component.js';
import { compileAdapter, executeAdapter } from '../transfer/adapter.mjs';

const frame = (facing = 1, dash = false, normalDisplacement = facing * 0.5) => ({ facing, dash, normalDisplacement });
const hold = (count, facing = 1, dash = false) => Array.from({ length: count }, () => frame(facing, dash));

export function adapterCases() {
  const cases = [
    { name: 'idle-and-turn', frames: [...hold(20), ...hold(20, -1)] },
    { name: 'early-held', frames: hold(100, 1, true) },
    { name: 'left-tap', frames: [...hold(10), frame(-1, true), ...hold(40, -1)] },
    { name: 'release-during-dash', frames: [...hold(10), frame(1, true), ...hold(20)] },
    { name: 'turn-during-dash', frames: [...hold(10), frame(1, true), ...hold(7, -1), ...hold(40, -1, true)] },
    { name: 'recipient-speed', frames: Array.from({ length: 100 }, (_, index) => frame(index % 2 ? -1 : 1, false, (index % 2 ? -1 : 1) * (0.5 + index / 100))) },
    { name: 'cooldown-boundary', frames: [...hold(10), frame(1, true), ...hold(30), frame(-1, true), frame(-1), frame(-1, true), ...hold(10, -1)] },
    { name: 'scale-without-timer-change', scale: 1, frames: hold(100, -1, true) },
    { name: 'restart', frames: hold(30, 1, true) },
    { name: 'restart-again', frames: hold(30, 1, true) },
    { name: 'counterfactual-component-output', frames: hold(8), mockOutputs: Array.from({ length: 8 }, (_, index) => ({
      ownsMotion: index % 2 === 0, displacement: { x: index % 4 === 0 ? -3.125 : 1.75, y: 91 },
      events: index === 0 ? ['dash-start'] : index === 6 ? ['dash-end'] : [],
    })) },
  ];
  return cases.map(trace=>({...trace,frames:trace.frames.map((frame,tick)=>({tick,position:40,...frame}))}));
}

export async function evaluatePakuAdapter(source, { signal } = {}) {
  const compiled = await compileAdapter(source);
  const cases = adapterCases();
  const actual = await executeAdapter(compiled, cases, { signal });
  const results = cases.map((trace, traceIndex) => {
    let state = init(compiled.defaults), firstDivergence = null;
    trace.frames.forEach((frame, index) => {
      const input = { buttons: (frame.facing < 0 ? 16 : 32) | (frame.dash ? 1 : 0), sourceBodyWidth: 8 };
      const result = step(state, input, compiled.defaults);
      state = result.state;
      const expected = trace.mockOutputs?.[index] ?? result.output;
      const displacement = expected.ownsMotion ? expected.displacement.x * (trace.scale ?? 0.5) : frame.normalDisplacement;
      const output = actual[traceIndex].outputs[index];
      if (!firstDivergence && (Math.abs(displacement - output.displacement) > 1e-9
        || expected.ownsMotion !== output.ownsMotion || JSON.stringify(expected.events) !== JSON.stringify(output.events))) {
        firstDivergence = { tick: index + 1, frame, expected: { displacement, ownsMotion: expected.ownsMotion, events: expected.events }, actual: output };
      }
    });
    return { name: trace.name, ticks: trace.frames.length, passed: firstDivergence === null, firstDivergence };
  });
  return { schemaVersion: 1, gate: 'adapter-conformance', passed: results.every(result => result.passed),
    componentId: compiled.componentId, sourceSha256: compiled.sourceSha256, javascriptSha256: compiled.javascriptSha256, results };
}
