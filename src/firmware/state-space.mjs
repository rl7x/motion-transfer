import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import wabtFactory from 'wabt';

const root = new URL('../../assets/targets/px4-arming/', import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const BOOT_STATES = Object.freeze([0, 1, 2, 3, 4, 5]);
// The declared input domain: a 0..5, b, c and d 0..1, e 0..14.
export const INPUTS = Object.freeze([0, 1, 2, 3, 4, 5].flatMap(a => [0, 1].flatMap(b => [0, 1].flatMap(c => [0, 1].flatMap(d =>
  Array.from({ length: 15 }, (_, e) => Object.freeze([a, b, c, d, e])))))));

export async function loadFirmware() {
  const lock = JSON.parse(await readFile(new URL('target.lock.json', root), 'utf8'));
  const bytes = await readFile(new URL('arming.wasm', root));
  assert.equal(digest(bytes), lock.sha256, 'The firmware binary does not match its lock');
  return { lock, bytes };
}

/** All state must live in linear memory, or comparing memory would not compare state. */
export async function assertSelfContained(bytes) {
  const module = new WebAssembly.Module(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), [], 'Firmware must have no host imports');
  const wabt = await wabtFactory(), parsed = wabt.readWasm(bytes, { readDebugNames: false });
  let mutable;
  try {
    parsed.generateNames(); parsed.applyNames();
    mutable = parsed.toText({ foldExprs: false, inlineExport: false }).split('\n').filter(line => /^ {2}\(global /.test(line) && /\(mut /.test(line));
  } finally { parsed.destroy(); }
  assert.equal(mutable.length, 1, 'The stack pointer must be the only mutable global');
  return { imports: 0, mutableGlobals: 1 };
}

export async function createDonor(bytes) {
  const { instance: { exports: api } } = await WebAssembly.instantiate(bytes, {});
  const stackTop = api.__stack_pointer.value, heapBase = api.__heap_base.value;
  const memory = new Uint8Array(api.memory.buffer);
  const live = memory.subarray(stackTop, heapBase), buffer = Buffer.from(live.buffer, live.byteOffset, live.byteLength);
  const heap = memory.subarray(heapBase), pristineHeap = heap.slice(), stack = memory.subarray(0, stackTop);
  return {
    boot: state => api.boot(state),
    step: input => api.step(...input) >>> 0,
    snapshot: () => live.slice(),
    restore: saved => live.set(saved),
    key: () => buffer.latin1Slice(0, buffer.length),
    fillStack: value => stack.fill(value),
    // Between calls, memory below the stack pointer is dead and the heap is never used.
    assertBalanced() {
      assert.equal(api.__stack_pointer.value, stackTop, 'The stack pointer did not return');
      assert.equal(Buffer.compare(heap, pristineHeap), 0, 'Firmware wrote outside its static data');
    },
    bytes: { memory: memory.length, live: live.length, stack: stack.length, heap: heap.length },
  };
}

/** Compare the optimized restore with a fresh module instance run from boot. */
export async function verifyRestore(bytes) {
  const fresh = await createDonor(bytes), restored = await createDonor(bytes);
  let seed = 7; const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const path = Array.from({ length: 400 }, () => INPUTS[next() % INPUTS.length]);
  const noise = Array.from({ length: 150 }, () => INPUTS[next() % INPUTS.length]);
  fresh.boot(0); restored.boot(0);
  for (const input of path.slice(0, 200)) { fresh.step(input); restored.step(input); }
  const saved = restored.snapshot();
  for (const input of noise) restored.step(input);
  restored.restore(saved);
  for (const input of path.slice(200)) {
    assert.equal(restored.step(input), fresh.step(input), 'Restored output differs from a fresh run');
    assert.equal(restored.key(), fresh.key(), 'Restored memory differs from a fresh run');
  }
  return { comparedSteps: 200 };
}

/** Breadth-first search over complete live memory. No human names a state field. */
export async function enumerateFirmware({ bytes } = {}) {
  bytes ??= (await loadFirmware()).bytes;
  const globals = await assertSelfContained(bytes), restore = await verifyRestore(bytes);
  const donor = await createDonor(bytes);
  const ids = new Map(), snapshots = [], roots = [];
  const visit = () => {
    const key = donor.key();
    let id = ids.get(key);
    if (id === undefined) { id = snapshots.length; ids.set(key, id); snapshots.push(donor.snapshot()); }
    return id;
  };
  for (const state of BOOT_STATES) { donor.boot(state); roots.push(visit()); }
  const edges = [];
  for (let id = 0; id < snapshots.length; id++) {
    const row = new Uint32Array(INPUTS.length * 2);
    for (let index = 0; index < INPUTS.length; index++) {
      donor.restore(snapshots[id]);
      row[index * 2 + 1] = donor.step(INPUTS[index]);
      row[index * 2] = visit();
    }
    donor.assertBalanced();
    edges.push(row);
  }
  // Prove the stack really is dead: garbage there must change nothing, on every transition.
  let stackChecks = 0;
  for (let id = 0; id < snapshots.length; id++) {
    for (let index = 0; index < INPUTS.length; index++) {
      donor.restore(snapshots[id]);
      donor.fillStack(0xa5);
      assert.equal(donor.step(INPUTS[index]), edges[id][index * 2 + 1], 'Dead stack bytes changed an output');
      assert.equal(ids.get(donor.key()), edges[id][index * 2], 'Dead stack bytes changed the next state');
      stackChecks++;
    }
  }
  const hash = createHash('sha256');
  edges.forEach(row => hash.update(Buffer.from(row.buffer)));
  return { bytes, roots, snapshots, edges, ids, verification: { globals, restore, memory: donor.bytes, stackChecks,
    states: snapshots.length, inputsPerState: INPUTS.length, transitions: snapshots.length * INPUTS.length, transitionsSha256: hash.digest('hex') } };
}

/** Decodes the packed integer for people. The model is never given these names. */
export function describeOutput(value) {
  return { result: (value & 3) - 1, armState: value >>> 2 & 7, lockdown: value >>> 5 & 1, armedTimeSet: value >>> 6 & 1,
    checksRan: value >>> 7 & 1, denialLogged: value >>> 8 & 1, armingReason: value >>> 9 & 15, disarmingReason: value >>> 13 & 15 };
}
