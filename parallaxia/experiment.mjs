import { loadParallaxiaSim } from './sim.mjs';
import { installParallaxiaRule } from './rule.mjs';
import { createParallaxiaPort } from './port.mjs';
import { validateCheckpoint, validateScenario, checkpointState, replayDigest, NATIVE_INPUT_MASK, DASH_INPUT } from './replay.mjs';

export async function reconstructCheckpoint({ checkpoint, identity, component, adapter, defaults, intent, rule = null }) {
  const inputs = validateCheckpoint(checkpoint, identity);
  const engine = await loadParallaxiaSim();
  installParallaxiaRule(rule, engine);
  const port = createParallaxiaPort({ component, adapter, defaults, intent });
  globalThis.roadsterPort = port; globalThis.parallaxiaChallengeShield = false;
  const sim = engine.createSim({ seed: checkpoint.seed, mode: checkpoint.mode, startSector: checkpoint.startSector });
  for (const bits of inputs) { port.setDash(Boolean(bits & DASH_INPUT)); engine.stepSim(sim, bits & NATIVE_INPUT_MASK); }
  port.setDash(false);
  const stateDigest = await replayDigest(checkpointState(sim, port));
  if (stateDigest !== checkpoint.stateDigest) throw Error('Checkpoint reconstruction digest differs; reset-boundary migration rejected');
  return { engine, sim, port, stateDigest };
}

export async function compareExperiment({ checkpoint, identity, scenario, component, parent, candidate, interventionTick }) {
  const controls = validateScenario(scenario);
  if (!Number.isInteger(interventionTick) || interventionTick < 0 || interventionTick >= scenario.horizonTicks) throw Error('Dash intervention exceeds the fixed horizon');
  const branches = [];
  for (const [kind, source] of [['original', parent], ['candidate', candidate]]) {
    const run = await reconstructCheckpoint({ checkpoint, identity, component, adapter: source.adapter, defaults: source.defaults, intent: source.intent, rule: source.rule });
    const startLives = run.sim.lives; const frames = []; let reachedTick = null; let lostLife = false;
    for (let tick = 0; tick < controls.length; tick++) {
      const dash = kind === 'candidate' && tick === interventionTick;
      run.port.setDash(dash); run.engine.stepSim(run.sim, controls[tick]);
      const { ship } = run.sim, target = scenario.target;
      if (run.sim.events.some(event => event.type === 'miss') || run.sim.lives < startLives) lostLife = true;
      if (reachedTick === null && run.sim.phase === 'play' && ship.x >= target.minX && ship.x <= target.maxX && ship.y >= target.minY && ship.y <= target.maxY) reachedTick = tick + 1;
      frames.push({ tick: tick + 1, x: ship.x, y: ship.y, lives: run.sim.lives, phase: run.sim.phase,
        dash, nativeInput: controls[tick], events: run.port.snapshot(run.sim)?.output?.events ?? [] });
    }
    branches.push({ kind, startingDigest: run.stateDigest, reachedTick, lostLife, alive: run.sim.phase === 'play',
      succeeded: reachedTick !== null && !lostLife && run.sim.phase === 'play', frames, endDigest: await replayDigest(checkpointState(run.sim, run.port)) });
  }
  const [original, changed] = branches;
  const firstDifferenceTick = original.frames.findIndex((frame, index) => frame.x !== changed.frames[index].x || frame.y !== changed.frames[index].y || frame.lives !== changed.frames[index].lives);
  return { version: 1, checkpoint, scenario, interventionTick, changedInputs: { dashTick: interventionTick, nativeControlsChanged: false },
    firstDifferenceTick: firstDifferenceTick < 0 ? null : firstDifferenceTick + 1,
    original, candidate: changed, satisfied: changed.succeeded,
    scope: 'Bounded unshielded replay at 60 Hz, identical recorded native controls and frozen target. Changed dash input is explicit; downstream enemy events may differ under unchanged rules.' };
}
