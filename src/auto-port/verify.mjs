import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { repositoryUrl } from '../paths.mjs';
import { DRIVERS } from './drivers.mjs';
import { applyPatches } from './patches.mjs';
import { buildRuntime } from './runtime.mjs';

export const VERIFY = Object.freeze({
  seeds: [11, 22, 33], ticks: 1200, settleTicks: 30, measureTicks: 12, holdTicks: 90, burstPixels: 60,
  minShare: 0.02, maxShare: 0.5, relativeTolerance: 0.1, fieldTolerance: 0.02, testTimeoutMs: 90_000,
});

/** Stable text of a game's state, leaving out the host's dash slot and anything a driver skips. */
export function snapshot(state, skip = []) {
  const ignored = new Set(['motionDash', ...skip]), seen = new WeakSet();
  return JSON.stringify(state, function replacer(key, value) {
    if (ignored.has(key) || typeof value === 'function') return undefined;
    if (ArrayBuffer.isView(value)) return Array.from(value);
    if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
    if (value instanceof Map) return [...value.entries()];
    if (value instanceof Set) return [...value.values()];
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[repeat]';
      seen.add(value);
    }
    return value;
  });
}

function firstDifference(left, right, path = 'state') {
  if (JSON.stringify(left) === JSON.stringify(right)) return null;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return `${path}: ${JSON.stringify(left)} became ${JSON.stringify(right)}`;
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const found = firstDifference(left[key], right[key], `${path}.${key}`);
    if (found) return found;
  }
  return path;
}

function check(name, run) {
  return async () => {
    try { return { name, passed: true, ...(await run()) }; }
    catch (error) { return { name, passed: false, error: String(error?.message ?? error).slice(0, 600) }; }
  };
}

function runTest(directory, runtimePath, file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--require', runtimePath, file], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const keep = chunk => { output = (output + chunk).slice(-800); };
    child.stdout.on('data', keep); child.stderr.on('data', keep);
    const timer = setTimeout(() => child.kill('SIGKILL'), VERIFY.testTimeoutMs);
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error(`${file} failed: ${output.slice(-400)}`)); });
  });
}

/** Ticks between the first two dash starts when the recovered component runs on its own. */
function componentGap(MotionDash) {
  const game = {}, starts = [];
  const held = MotionDash.held, events = MotionDash.events.length;
  MotionDash.held = true;
  for (let tick = 0; tick < 120 && starts.length < 2; tick += 1) {
    if (MotionDash.update(game, { right: true }).events.includes('dash-start')) starts.push(tick);
  }
  MotionDash.held = held; MotionDash.events.length = events;
  return starts[1] - starts[0];
}

function settle(driver, session) {
  let ready = 0;
  for (let tick = 0; tick < 1200 && ready < VERIFY.settleTicks; tick += 1) {
    session.step(session.idle);
    ready = driver.ready(session.state) ? ready + 1 : 0;
  }
  if (ready < VERIFY.settleTicks) throw Error('The avatar never stayed controllable long enough to measure a dash');
}

/** Check a set of patches against one game. Pure measurement: nothing here comes from the model. */
export async function verifyPort({ gameId, patches, unitsPerSourcePixel, component, browser }) {
  const driver = DRIVERS[gameId];
  if (!driver) throw Error('Unknown auto-port game');
  const root = await mkdtemp(join(tmpdir(), 'auto-port-'));
  const original = join(root, 'original'), ported = join(root, 'ported');
  const checks = [];
  const add = async (name, run) => { const result = await check(name, run)(); checks.push(result); return result.passed; };
  const measurements = {};
  try {
    const game = fileURLToPath(repositoryUrl(`assets/auto-port/games/${gameId}`));
    await cp(game, original, { recursive: true }); await cp(game, ported, { recursive: true });
    const applied = await add('patches-apply-exactly', async () => {
      const file = join(ported, driver.core);
      await writeFile(file, applyPatches(await readFile(file, 'utf8'), patches));
    });
    if (!applied) return { gameId, passed: false, checks, measurements };
    const runtime = await buildRuntime({ component, dashKey: driver.dashKey });
    const runtimePath = join(root, 'motion-dash.cjs');
    await writeFile(runtimePath, runtime);
    vm.runInThisContext(runtime, { filename: 'motion-dash.cjs' });
    const { MotionDash } = globalThis;
    let originalApi, portedApi;
    const loaded = await add('patched-game-loads', async () => {
      originalApi = await driver.load(original); portedApi = await driver.load(ported);
    });
    if (!loaded) return { gameId, passed: false, checks, measurements };
    await add('no-interference-without-dash', async () => {
      for (const seed of VERIFY.seeds) {
        const base = driver.session(originalApi, seed), port = driver.session(portedApi, seed);
        for (let tick = 1; tick <= VERIFY.ticks; tick += 1) {
          base.step(base.act()); port.step(port.act());
          const left = snapshot(base.state, driver.skip), right = snapshot(port.state, driver.skip);
          if (left !== right) throw Error(`Seed ${seed} diverged at tick ${tick}: ${firstDifference(JSON.parse(left), JSON.parse(right))}`);
        }
      }
      return { detail: `${VERIFY.seeds.length} seeds × ${VERIFY.ticks} ticks identical` };
    });
    await add('game-tests-pass', async () => {
      for (const file of driver.tests) await runTest(ported, runtimePath, file);
      return { detail: driver.tests.join(', ') };
    });
    await add('dash-fidelity', async () => {
      const expected = VERIFY.burstPixels * unitsPerSourcePixel, field = driver.field;
      if (!(expected >= field * VERIFY.minShare && expected <= field * VERIFY.maxShare)) throw Error(`A ${expected}-unit burst is outside ${VERIFY.minShare * 100}–${VERIFY.maxShare * 100}% of the ${field}-unit field`);
      const dash = driver.session(portedApi, VERIFY.seeds[0]), control = driver.session(portedApi, VERIFY.seeds[0]);
      settle(driver, dash); settle(driver, control);
      for (let tick = 0; tick < VERIFY.measureTicks; tick += 1) {
        MotionDash.held = tick === 0; dash.step(dash.heading);
        MotionDash.held = false; control.step(control.heading);
      }
      const measured = driver.distance(portedApi, driver.position(dash.state), driver.position(control.state));
      measurements.expected = expected; measurements.measured = measured;
      const tolerance = Math.max(expected * VERIFY.relativeTolerance, field * VERIFY.fieldTolerance);
      if (Math.abs(measured - expected) > tolerance) throw Error(`The dash moved ${measured} units; expected ${expected} ± ${tolerance}`);
      return { detail: `${measured.toFixed(2)} of ${expected} units` };
    });
    await add('recharge-blocks-second-dash', async () => {
      const gap = componentGap(MotionDash), session = driver.session(portedApi, VERIFY.seeds[1]), starts = [];
      settle(driver, session);
      MotionDash.held = true;
      for (let tick = 0; tick < VERIFY.holdTicks && starts.length < 2; tick += 1) {
        const before = MotionDash.events.length;
        session.step(session.heading);
        if (MotionDash.events.slice(before).includes('dash-start')) starts.push(tick);
      }
      MotionDash.held = false;
      if (starts.length === 0) throw Error('Holding the dash never started one: MotionDash.update is not reached during play');
      if (starts.length === 2 && starts[1] - starts[0] < gap) throw Error(`A second dash started after ${starts[1] - starts[0]} ticks; the recovered recharge needs ${gap}`);
      measurements.rechargeTicks = gap;
      return { detail: `recovered gap ${gap} ticks respected` };
    });
    if (browser) await add('browser-frame-runs-dash', () => browser({ directory: ported, runtime, driver }));
    return { gameId, passed: checks.every(entry => entry.passed), checks, measurements };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
