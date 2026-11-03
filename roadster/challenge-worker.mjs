import vm from 'node:vm';
import { loadRoadsterPhysics } from './physics.mjs';
import { createRoadsterPort } from './port.mjs';
import { ROADSTER_CHALLENGE, landingInTarget } from './challenge-contract.mjs';

try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 512 * 1024) throw Error('Challenge input exceeds 512 KB');
  }
  const request = JSON.parse(input);
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  const { component, adapter } = new vm.Script(`${request.componentCode}\n${request.adapterCode}\n({component:recovered,adapter:candidate})`)
    .runInContext(context, { timeout: 500 });
  const { CarPhysics, getLevel, createAutopilot } = await loadRoadsterPhysics();
  const level = getLevel(ROADSTER_CHALLENGE.levelId);
  const sample = (physics, tick, port) => ({ tick, car: structuredClone(physics.car),
    ...(port ? { motion: port.snapshot(physics) } : {}) });
  const native = new CarPhysics(level), driver = createAutopilot(level);
  globalThis.roadsterPort = createRoadsterPort({});
  const controls = [], before = [];
  let dashTick = null, nativeLanding = null;
  for (let tick = 0; tick < ROADSTER_CHALLENGE.maxTicks; tick++) {
    const control = { ...driver(native.car, 1 / ROADSTER_CHALLENGE.tickRate) };
    controls.push(control); native.step(1 / ROADSTER_CHALLENGE.tickRate, control);
    before.push(sample(native, tick + 1));
    if (dashTick === null && native.car.mode === 'airborne'
      && native.car.airTime >= ROADSTER_CHALLENGE.dashAfterAirSeconds && native.car.heightAboveGround > 5) dashTick = tick + 1;
    const end = native.drainEvents().find(event => event.type === 'land' || event.type === 'crash');
    if (end) { nativeLanding = end; break; }
  }
  if (dashTick === null || nativeLanding?.type !== 'land') throw Error('The native challenge did not produce a repeatable landing');
  const port = createRoadsterPort({ component, adapter, defaults: request.defaults, intent: request.intent });
  globalThis.roadsterPort = port;
  const transferred = new CarPhysics(level), after = [];
  let transferredLanding = null;
  for (let tick = 0; tick < ROADSTER_CHALLENGE.maxTicks; tick++) {
    const control = controls[tick] ?? { throttle: 0, brake: 0, thrust: false, spin: 0 };
    port.setDash(tick === dashTick);
    transferred.step(1 / ROADSTER_CHALLENGE.tickRate, control);
    after.push(sample(transferred, tick + 1, port));
    const end = transferred.drainEvents().find(event => event.type === 'land' || event.type === 'crash');
    if (end) { transferredLanding = end; break; }
  }
  const target = request.target ?? ROADSTER_CHALLENGE.target;
  process.stdout.write(JSON.stringify({ passed: nativeLanding.type === 'land' && Boolean(transferredLanding),
    challengeId: ROADSTER_CHALLENGE.id, levelId: ROADSTER_CHALLENGE.levelId, tickRate: 60, dashTick, target, controls,
    baseline: { landing: nativeLanding, inTarget: landingInTarget(nativeLanding, target), frames: before },
    transferred: { landing: transferredLanding, inTarget: landingInTarget(transferredLanding, target), frames: after } }));
} catch (error) {
  process.stdout.write(JSON.stringify({ error: String(error.message).slice(0, 500) }));
  process.exitCode = 1;
} finally { delete globalThis.roadsterPort; }
