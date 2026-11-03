import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadParallaxiaSim } from '../parallaxia/sim.mjs';
import { createParallaxiaPort } from '../parallaxia/port.mjs';

let text = '';
for await (const chunk of process.stdin) { text += chunk; if (text.length > 262144) throw Error('Native job too large'); }
const request = JSON.parse(text);
const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
const { component, adapter } = new vm.Script(`${request.componentCode}\n${request.adapterCode}\n({component:recovered,adapter:candidate})`).runInContext(context, { timeout: 500 });
const hooked = await loadParallaxiaSim();
const native = await loadParallaxiaSim({ native: true });
const results = [];
const check = (name, run) => { try { results.push({ name, passed: true, ...run() }); } catch (error) { results.push({ name, passed: false, error: error.message }); } };
const createPort = () => createParallaxiaPort({ component, adapter, defaults: request.defaults, intent: request.intent });
const nativeState = sim => ({ x: sim.ship.x, y: sim.ship.y, shots: sim.shots, bullets: sim.bullets, enemies: sim.enemies, score: sim.score, lives: sim.lives, rng: sim.rng.s, respawn: sim.ship.respawn });
globalThis.parallaxiaChallengeShield = false;
check('inactive-native-movement-and-enemy-rules', () => {
  globalThis.roadsterPort = null;
  const before = native.createSim({ seed: 7 });
  const port = createPort(); globalThis.roadsterPort = port;
  const after = hooked.createSim({ seed: 7 });
  for (let tick = 0; tick < 500; tick++) {
    const bits = 16 | (tick % 40 < 10 ? 8 : tick % 40 < 20 ? 4 : tick % 40 < 30 ? 1 : 2);
    native.stepSim(before, bits); hooked.stepSim(after, bits);
    assert.deepEqual(nativeState(after), nativeState(before));
  }
  return { updates: 500 };
});
check('swept-bullet-collision-during-dash', () => {
  const port = createPort(); globalThis.roadsterPort = port;
  const sim = hooked.createSim({ seed: 3 });
  for (let i = 0; i < 40; i++) hooked.stepSim(sim, 0);
  const lives = sim.lives;
  const direction = request.intent.direction === 'opposite' ? -1 : 1;
  sim.bullets = [{ x: sim.ship.x + direction * 0.5, y: sim.ship.y, dir: 0, speed: 0, age: 100, fuse: -1 }];
  port.setDash(true); hooked.stepSim(sim, 0);
  assert.equal(sim.ship.dashing, true);
  assert.equal(sim.lives, lives - 1, 'A dash must not bypass the native swept bullet collision');
  assert.ok(sim.events.some(event => event.type === 'miss'));
  return { collisionPolicy: 'native', addedInvulnerability: false };
});
check('dash-does-not-suppress-native-hit-handling', () => {
  const sim = hooked.createSim({ seed: 2 }); const lives = sim.lives;
  sim.ship.dashing = true; hooked.missShip(sim, 'ram');
  assert.equal(sim.lives, lives - 1);
  return { causes: ['ram', 'bullet'] };
});
check('practice-shield-is-explicit', () => {
  globalThis.parallaxiaChallengeShield = true;
  const sim = hooked.createSim({ seed: 2 }); const lives = sim.lives;
  hooked.missShip(sim); assert.equal(sim.lives, lives); assert.ok(sim.events.some(event => event.type === 'hit'));
  globalThis.parallaxiaChallengeShield = false;
  return { survivalClaim: false };
});
delete globalThis.roadsterPort; delete globalThis.parallaxiaChallengeShield;
process.stdout.write(JSON.stringify({ passed: results.every(result => result.passed), results }));
