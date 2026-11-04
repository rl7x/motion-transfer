import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import wabtFactory from 'wabt';
import { loadTarget } from '../agent/target.mjs';
import { createReplayRuntime } from '../runtime/replay.mjs';
import { DONOR_SHA256, observeDonorMotion } from '../runtime/donor-observation.mjs';

// Preserve a deterministic input order for breadth-first counterexamples.
export const ALL_BUTTON_MASKS = Object.freeze([0, 1].flatMap(x =>
  [0, 2].flatMap(z => Array.from({ length: 16 }, (_, direction) => direction * 16 | z | x))));
export const DISPLACEMENT_TOLERANCE = 0.001;
export const DEFAULT_CONFIG = Object.freeze({ walkingSpeed: 2, dashDistance: 60, cooldownTicks: 25, initialCooldownTicks: 10 });
export const GAMEPLAY_CONTEXTS = Object.freeze([
  [11, 120], [23, 300], [37, 600], [41, 1200], [53, 2400], [67, 4800],
].map(([seed, frames]) => Object.freeze({ seed, frames })));

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const randomSequence = seed => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
export const motionStateKey = observation =>
  `${observation.remaining}|${observation.cooldown}|${observation.direction.x}|${observation.direction.y}`;

/** Only this pinned cartridge's balanced stack pointer may live outside memory. */
export async function assertSnapshotCartridge(bytes) {
  const wabt = await wabtFactory();
  const module = wabt.readWasm(bytes, { readDebugNames: false });
  let globals;
  try {
    module.generateNames();
    module.applyNames();
    globals = module.toText({ foldExprs: false, inlineExport: false }).split('\n')
      .filter(line => /^  \((?:global|import) /.test(line) && /\(mut /.test(line));
  } finally {
    module.destroy();
  }
  if (globals.length !== 1 || globals[0].trim() !== '(global $g0 (mut i32) (i32.const 14752))') {
    throw Error('Snapshot refused: the only mutable global must be the pinned $g0 stack pointer');
  }
  if (digest(bytes) !== DONOR_SHA256) throw Error('Snapshot requires the pinned donor cartridge');
  return { mutableGlobals: ['$g0'], stackPointerInitial: 14752 };
}

export function snapshotRuntime(runtime) {
  if (runtime.faulted || runtime.executingUpdate) throw Error('Snapshot requires a completed, non-trapping frame');
  return { memory: new Uint8Array(runtime.memory.buffer).slice(), disk: runtime.disk.slice(),
    diskSize: runtime.diskSize, frame: runtime.frame };
}

export function restoreRuntime(runtime, snapshot) {
  if (snapshot.memory.length !== 65536 || runtime.memory.buffer.byteLength !== 65536
    || snapshot.disk.length !== runtime.disk.length) throw Error('Snapshot storage size mismatch');
  new Uint8Array(runtime.memory.buffer).set(snapshot.memory);
  runtime.disk.set(snapshot.disk);
  runtime.diskSize = snapshot.diskSize;
  runtime.frame = snapshot.frame;
  runtime.drawCalls = [];
  runtime.tones = [];
  runtime.faulted = false;
  runtime.executingUpdate = false;
}

// Rendering still executes and writes the same framebuffer bytes. Only diagnostic
// draw records and sprite/memory hashes are skipped; the pinned host is untouched.
function useFastRendering(runtime) {
  runtime.draw = (_name, _args, render) => render();
  runtime.blit = function (pointer, x, y, width, height, flags) {
    this.framebuffer.blit(new Uint8Array(this.memory.buffer, pointer), x, y, width, height,
      0, 0, width, flags & 1, flags & 2, flags & 4, flags & 8);
  };
  return runtime;
}

export function tickRuntime(runtime, buttons) {
  if (!ALL_BUTTON_MASKS.includes(buttons) || runtime.faulted) throw Error('Invalid exhaustive runtime step');
  runtime.drawCalls = [];
  runtime.tones = [];
  runtime.data.setUint8(runtime.core.ADDR_GAMEPAD1, buttons);
  if (!(runtime.data.getUint8(runtime.core.ADDR_SYSTEM_FLAGS) & runtime.core.SYSTEM_PRESERVE_FRAMEBUFFER)) {
    runtime.framebuffer.clear();
  }
  try {
    runtime.executingUpdate = true;
    runtime.instance.exports.update();
    runtime.frame++;
  } catch (error) {
    runtime.faulted = true;
    throw error;
  } finally {
    runtime.executingUpdate = false;
  }
}

/** Compare the optimized, restored execution with an ordinary replay from reset. */
export async function verifySnapshotRestore(bytes) {
  await assertSnapshotCartridge(bytes);
  const fresh = await createReplayRuntime(bytes);
  const restored = useFastRendering(await createReplayRuntime(bytes));
  fresh.step(1);
  restored.step(1);
  const next = randomSequence(7);
  const path = Array.from({ length: 400 }, () => ALL_BUTTON_MASKS[next() % 64]);
  const noise = Array.from({ length: 150 }, () => ALL_BUTTON_MASKS[next() % 64]);
  for (const buttons of path.slice(0, 200)) {
    fresh.step(buttons);
    tickRuntime(restored, buttons);
  }
  const saved = snapshotRuntime(restored);
  for (const buttons of noise) tickRuntime(restored, buttons);
  restoreRuntime(restored, saved);
  for (const buttons of path.slice(200)) {
    fresh.step(buttons);
    tickRuntime(restored, buttons);
    assert.deepEqual(snapshotRuntime(restored), snapshotRuntime(fresh), 'Restored frame differs from fresh replay');
  }
  return { comparedFrames: 200, byteIdenticalFrames: 200, includes: ['linear-memory', 'host-disk', 'disk-size', 'frame'] };
}

function transition(previous, current) {
  const activated = previous.remaining <= 0 && current.remaining > 0;
  return {
    next: motionStateKey(current),
    displacement: { x: current.position.x - previous.position.x, y: current.position.y - previous.position.y },
    ownsMotion: activated || previous.remaining > 0,
    events: [...(activated ? ['dash-start'] : []), ...(previous.remaining > 0 && current.remaining === 0 ? ['dash-end'] : [])],
    timers: { remaining: current.remaining, cooldown: current.cooldown },
  };
}

export function assertSameTransition(expected, actual, context) {
  if (expected.next !== actual.next || expected.ownsMotion !== actual.ownsMotion
    || JSON.stringify(expected.events) !== JSON.stringify(actual.events)
    || expected.timers.remaining !== actual.timers.remaining || expected.timers.cooldown !== actual.timers.cooldown
    || Math.abs(expected.displacement.x - actual.displacement.x) > DISPLACEMENT_TOLERANCE
    || Math.abs(expected.displacement.y - actual.displacement.y) > DISPLACEMENT_TOLERANCE) {
    throw Error(`Dash state abstraction conflict: ${JSON.stringify({ context, expected, actual })}`);
  }
}

const verifiedSpaces = new WeakSet();
export function assertVerifiedStateSpace(space) {
  if (!verifiedSpaces.has(space)) throw Error('Use a freshly enumerated and cross-checked donor state space');
}

/** Enumerate the four-field abstraction, then try to falsify it in other concrete states. */
export async function enumerateDonorStateSpace({ cartridge } = {}) {
  const bytes = cartridge ?? (await loadTarget()).bytes;
  const globals = await assertSnapshotCartridge(bytes);
  const restore = await verifySnapshotRestore(bytes);
  const runtime = useFastRendering(await createReplayRuntime(bytes));
  runtime.step(1);
  const root = snapshotRuntime(runtime), rootObservation = observeDonorMotion(runtime);
  const nodes = new Map(), queue = [];
  let concreteSteps = 0, alternateStates = 0, maxDisplacementDifference = 0;

  function visit(observation, snapshot) {
    if (observation.sourceBodyWidth !== 8) throw Error('Exhaustive verification only covers body width 8');
    const key = motionStateKey(observation);
    let node = nodes.get(key);
    if (!node) {
      node = { key, observation, snapshot, alternatives: [], transitions: [] };
      nodes.set(key, node);
      queue.push(node);
      if (queue.length > 10000) throw Error('Donor state enumeration exceeded its state limit');
    } else if (node.alternatives.length < 2 && (observation.position.x !== node.observation.position.x
      || observation.position.y !== node.observation.position.y)) {
      node.alternatives.push(snapshot);
    }
    return node;
  }

  function step(snapshot, buttons) {
    restoreRuntime(runtime, snapshot);
    const previous = observeDonorMotion(runtime);
    tickRuntime(runtime, buttons);
    concreteSteps++;
    const current = observeDonorMotion(runtime); // Losing gameplay is a failure, never a skipped edge.
    return { current, edge: transition(previous, current) };
  }

  function crossCheck(node, edge, index, context) {
    const expected = node.transitions[index];
    if (!expected) throw Error('Cross-check reached an unenumerated transition');
    assertSameTransition(expected, edge, { ...context, state: node.key, buttons: ALL_BUTTON_MASKS[index] });
    maxDisplacementDifference = Math.max(maxDisplacementDifference,
      Math.abs(expected.displacement.x - edge.displacement.x), Math.abs(expected.displacement.y - edge.displacement.y));
  }

  visit(rootObservation, root);
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index];
    for (const buttons of ALL_BUTTON_MASKS) {
      const { current, edge } = step(node.snapshot, buttons);
      node.transitions.push(edge);
      visit(current, snapshotRuntime(runtime));
    }
  }
  for (const node of queue) {
    for (const snapshot of node.alternatives) {
      alternateStates++;
      for (const [index, buttons] of ALL_BUTTON_MASKS.entries()) {
        const { current, edge } = step(snapshot, buttons);
        crossCheck(node, edge, index, { kind: 'alternate-position' });
        if (!nodes.has(edge.next)) throw Error('Alternate state introduced a new control state');
        visit(current, snapshotRuntime(runtime));
      }
    }
  }

  const contexts = [];
  for (const { seed, frames } of GAMEPLAY_CONTEXTS) {
    restoreRuntime(runtime, root);
    const next = randomSequence(seed);
    let run = 0, buttons = 0;
    for (let frame = 0; frame < frames; frame++) {
      if (run-- <= 0) { buttons = ALL_BUTTON_MASKS[next() % 64]; run = 1 + next() % 24; }
      tickRuntime(runtime, buttons);
      observeDonorMotion(runtime);
    }
    const observation = observeDonorMotion(runtime), key = motionStateKey(observation);
    const local = new Map([[key, snapshotRuntime(runtime)]]), keys = [key];
    for (let cursor = 0; cursor < keys.length; cursor++) {
      const node = nodes.get(keys[cursor]);
      if (!node) throw Error('Gameplay context introduced a new control state');
      for (const [index, input] of ALL_BUTTON_MASKS.entries()) {
        const { edge } = step(local.get(node.key), input);
        crossCheck(node, edge, index, { kind: 'seeded-gameplay', seed, frames });
        if (!local.has(edge.next)) { local.set(edge.next, snapshotRuntime(runtime)); keys.push(edge.next); }
      }
    }
    contexts.push({ seed, frames, position: observation.position, states: keys.length, conflicts: 0 });
  }

  const states = queue.map(node => ({ key: node.key,
    control: { remaining: node.observation.remaining, cooldown: node.observation.cooldown, direction: node.observation.direction },
    transitions: node.transitions }));
  const space = { schemaVersion: 1, cartridgeSha256: digest(bytes), rootKey: motionStateKey(rootObservation),
    buttonMasks: ALL_BUTTON_MASKS, states,
    verification: { globals, restore, states: states.length, transitions: states.length * ALL_BUTTON_MASKS.length,
      transitionsSha256: digest(JSON.stringify(states)), alternateStates, concreteSteps, contexts,
      conflicts: 0, maxDisplacementDifference, displacementTolerance: DISPLACEMENT_TOLERANCE } };
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(space);
  verifiedSpaces.add(space);
  return space;
}

let cachedSpace;
export function getDonorStateSpace() {
  cachedSpace ??= enumerateDonorStateSpace().catch(error => { cachedSpace = undefined; throw error; });
  return cachedSpace;
}

export function measureTransitionCoverage(space, cases) {
  assertVerifiedStateSpace(space);
  const nodes = new Map(space.states.map(node => [node.key, node]));
  const covered = new Set();
  for (const trace of cases) {
    let key = space.rootKey;
    for (const step of trace.steps) {
      const index = ALL_BUTTON_MASKS.indexOf(step.buttons);
      if (index < 0) throw Error('Coverage trace has unsupported buttons');
      for (let frame = 0; frame < step.frames; frame++) {
        covered.add(`${key}#${step.buttons}`);
        key = nodes.get(key).transitions[index].next;
      }
    }
  }
  return { transitions: covered.size, total: space.verification.transitions,
    percent: Number((100 * covered.size / space.verification.transitions).toFixed(1)),
    withoutZ: { transitions: [...covered].filter(entry => !(Number(entry.split('#')[1]) & 2)).length,
      total: space.states.length * 32,
      percent: Number((100 * [...covered].filter(entry => !(Number(entry.split('#')[1]) & 2)).length / (space.states.length * 32)).toFixed(1)) } };
}
