import vm from 'node:vm';
import { loadParallaxiaSim } from './sim.mjs';
import { createParallaxiaPort } from './port.mjs';
import {
  PARALLAXIA_CHALLENGE,
  createParallaxiaChallengeControls,
  landingInTarget,
} from './challenge-contract.mjs';

function shipSnapshot(sim) {
  return {
    position: { x: sim.ship.x, y: sim.ship.y, z: 0 },
    velocity: { x: sim.vx ?? 0, y: sim.vy ?? 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    mode: 'airborne',
    gas: sim.lives,
    inAir: sim.phase === 'play',
  };
}

function landingEvent(sim) {
  return {
    type: 'land',
    position: { x: sim.ship.x, y: sim.ship.y, z: 0 },
    result: { grade: 'perfect', score: sim.score, sector: sim.stage.section + 1 },
  };
}

try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 512 * 1024) throw Error('Challenge input exceeds 512 KB');
  }
  const request = JSON.parse(input);
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });
  const { component, adapter } = new vm.Script(
    `${request.componentCode}\n${request.adapterCode}\n({component:recovered,adapter:candidate})`,
  ).runInContext(context, { timeout: 500 });
  const { createSim, stepSim } = await loadParallaxiaSim();
  const controls = createParallaxiaChallengeControls();
  const dashTick = PARALLAXIA_CHALLENGE.dashTick;
  const sample = (sim, tick, port) => ({
    tick,
    car: shipSnapshot(sim),
    ...(port ? { motion: port.snapshot(sim) } : {}),
  });

  globalThis.parallaxiaChallengeShield = true;
  globalThis.roadsterPort = createParallaxiaPort({});
  const nativeSim = createSim({
    seed: PARALLAXIA_CHALLENGE.seed,
    mode: PARALLAXIA_CHALLENGE.mode,
    startSector: 1,
  });
  const before = [];
  for (let tick = 0; tick < controls.length; tick++) {
    stepSim(nativeSim, controls[tick]);
    before.push(sample(nativeSim, tick + 1));
  }
  const nativeLanding = landingEvent(nativeSim);

  const port = createParallaxiaPort({
    component,
    adapter,
    defaults: request.defaults,
    intent: request.intent,
  });
  globalThis.roadsterPort = port;
  const transferredSim = createSim({
    seed: PARALLAXIA_CHALLENGE.seed,
    mode: PARALLAXIA_CHALLENGE.mode,
    startSector: 1,
  });
  const after = [];
  for (let tick = 0; tick < controls.length; tick++) {
    port.setDash(tick === dashTick);
    stepSim(transferredSim, controls[tick]);
    after.push(sample(transferredSim, tick + 1, port));
  }
  const transferredLanding = landingEvent(transferredSim);
  const target = request.target ?? PARALLAXIA_CHALLENGE.target;

  process.stdout.write(
    JSON.stringify({
      passed: nativeLanding.type === 'land' && Boolean(transferredLanding),
      challengeId: PARALLAXIA_CHALLENGE.id,
      levelId: PARALLAXIA_CHALLENGE.levelId,
      tickRate: 60,
      dashTick,
      target,
      controls,
      baseline: {
        landing: nativeLanding,
        inTarget: landingInTarget(nativeLanding, target),
        frames: before,
      },
      transferred: {
        landing: transferredLanding,
        inTarget: landingInTarget(transferredLanding, target),
        frames: after,
      },
    }),
  );
} catch (error) {
  process.stdout.write(JSON.stringify({ error: String(error.message).slice(0, 500) }));
  process.exitCode = 1;
} finally {
  delete globalThis.roadsterPort;
  delete globalThis.parallaxiaChallengeShield;
}
