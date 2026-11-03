import assert from 'node:assert/strict';
import { compileAdapter, executeAdapter } from '../transfer/adapter.mjs';
import { compileMotion } from '../component/build.mjs';
import { executeMotion } from '../component/run.mjs';
import { resolveComponentRef, componentIdentity } from '../component/reference.mjs';

/** Probe the horizontal adapter contract, independently of any game engine. */
export async function probeIntegration(source, {
  unitScale = 0.1, activation = 'held', direction = 'facing', activationGate = 'airborne', componentRef,
} = {}) {
  if (!Number.isFinite(unitScale) || unitScale <= 0 || unitScale > 2
    || !['held', 'press'].includes(activation) || !['facing', 'opposite'].includes(direction)
    || !['airborne', 'always'].includes(activationGate)) throw Error('Invalid integration probe mapping');
  const component = await resolveComponentRef(componentRef);
  const compiled = await compileAdapter(source, { componentRef: component });
  const frames = fn => Array.from({ length: 100 }, (_, tick) => ({ tick: tick + 1, position: 0,
    facing: 1, dash: false, airborne: true, normalDisplacement: (tick % 7 - 3) * 0.17, ...fn(tick) }));
  const traces = [
    { name: 'inactive-native-motion', frames: frames(() => ({})) },
    { name: 'held-and-startup-cooldown', frames: frames(() => ({ dash: true })) },
    { name: 'press-and-cooldown', frames: frames(tick => ({ dash: [4, 14, 47, 80].includes(tick) })) },
    { name: 'landing-and-relaunch', frames: frames(tick => ({ dash: true, airborne: tick < 13 || tick >= 55 })) },
    { name: 'direction-and-press-inheritance', frames: frames(tick => ({ facing: tick % 2 ? -1 : 1, dash: tick % 35 >= 10 })) },
    { name: 'component-counterfactuals', frames: frames(tick => ({ dash: tick % 3 === 0 })),
      mockOutputs: Array.from({ length: 100 }, (_, tick) => ({ ownsMotion: tick % 2 === 0,
        displacement: { x: tick % 2 === 0 ? (tick % 4 === 0 ? -3.25 : 1.75) : 0, y: 0 },
        events: tick === 2 ? ['dash-start'] : tick === 4 ? ['dash-end'] : [] })) },
  ].map(trace => ({ ...trace, scale: unitScale }));
  const report = { schemaVersion: 1, kind: 'horizontal-integration-probe', metaCalled: false,
    componentRef: componentIdentity(component), sourceSha256: compiled.sourceSha256,
    mapping: { unitScale, activation, direction, activationGate }, passed: false, results: [],
    scope: 'Checks the supplied adapter at 60 Hz, not the surrounding game loop, collisions, rendering, or player experience.' };
  let actual;
  try { actual = await executeAdapter(compiled, traces); }
  catch (error) { return { ...report, results: [{ name: 'adapter-execution-and-delegation', passed: false, error: error.message }] }; }
  const mapped = traces.map(trace => {
    let previous = false;
    return { name: trace.name, inputs: trace.frames.map(frame => {
      const eligible = activationGate === 'always' || frame.airborne;
      const dash = eligible && frame.dash && (activation === 'held' || !previous);
      previous = frame.dash;
      return { buttons: (frame.facing * (direction === 'opposite' ? -1 : 1) < 0 ? 16 : 32) | (dash ? 1 : 0), sourceBodyWidth: 8 };
    }) };
  });
  const reference = await executeMotion(await compileMotion(component.source), mapped, component.contract.defaults);
  for (const [index, trace] of traces.entries()) {
    try {
      for (let tick = 0; tick < trace.frames.length; tick++) {
        const expected = trace.mockOutputs?.[tick] ?? reference[index].frames[tick];
        const observed = actual[index].outputs[tick];
        assert.deepEqual(actual[index].inputs[tick], mapped[index].inputs[tick], 'Component input or activation mapping differs');
        const displacement = expected.ownsMotion ? expected.displacement.x * unitScale : trace.frames[tick].normalDisplacement;
        assert.ok(Math.abs(observed.displacement - displacement) < 1e-9, 'Unit scaling or inactive native motion differs');
        assert.equal(observed.ownsMotion, expected.ownsMotion, 'Motion ownership differs');
        assert.deepEqual(observed.events, expected.events, 'Component events were dropped, added or retimed');
      }
      report.results.push({ name: trace.name, passed: true, ticks: trace.frames.length });
    } catch (error) { report.results.push({ name: trace.name, passed: false, error: error.message }); }
  }
  report.passed = report.results.every(result => result.passed);
  return report;
}
