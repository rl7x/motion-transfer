import assert from 'node:assert/strict';
import test from 'node:test';
import wabtFactory from 'wabt';
import { acceptanceCases } from '../src/evaluator/cases.mjs';
import { RECOVERY_DEVELOPMENT_CASES } from '../src/evaluator/recovery-cases.mjs';
import { loadExhaustiveCandidates } from '../src/evaluator/exhaustive-evidence.mjs';
import { verifyExhaustiveMotion } from '../src/evaluator/exhaustive.mjs';
import { ALL_BUTTON_MASKS, assertSameTransition, assertSnapshotCartridge, DEFAULT_CONFIG,
  getDonorStateSpace, measureTransitionCoverage } from '../src/evaluator/state-space.mjs';

const candidates = await loadExhaustiveCandidates();
const expected = {
  'first-session': 'proved',
  'v3-session-1-attempt-1': 1,
  'v3-session-1-attempt-2': 'proved',
  'v3-session-3-attempt-1': 1,
  'v3-session-3-attempt-2': 10,
  'v3-session-3-attempt-3': 'inconclusive',
  'v4-session-1-attempt-1': 1,
  'v4-session-1-attempt-2': 1,
  'v5-session-1-attempt-1': 1,
  'v5-session-1-attempt-2': 1,
  'v5-session-1-attempt-3': 'proved',
  'v5-session-3-attempt-1': 1,
  'v5-session-3-attempt-2': 1,
  'v5-session-3-attempt-3': 'proved',
  'fixture-premature-activation': 10,
  'fixture-edge-trigger-oscillation': 10,
  'fixture-walking-facing-assumption': 11,
  'older-spark-1bc4250c': 'proved',
};

test('enumeration cross-checks the pinned binary and reproduces sampled coverage', async () => {
  const space = await getDonorStateSpace();
  assert.equal(space.states.length, 275);
  assert.equal(space.verification.transitions, 17600);
  assert.equal(space.verification.concreteSteps, 154048);
  assert.equal(space.verification.alternateStates, 548);
  assert.equal(space.verification.conflicts, 0);
  assert.equal(space.verification.restore.byteIdenticalFrames, 200);
  assert.deepEqual(space.verification.contexts.map(context => context.frames), [120, 300, 600, 1200, 2400, 4800]);
  assert.ok(space.verification.contexts.every(context => context.states === 264 && context.conflicts === 0));
  assert.equal(new Set(ALL_BUTTON_MASKS).size, 64);
  assert.ok(ALL_BUTTON_MASKS.every(mask => !(mask & ~243)));
  assert.ok(space.states.every(node => node.transitions.length === 64));
  assert.deepEqual(measureTransitionCoverage(space, [...RECOVERY_DEVELOPMENT_CASES, ...acceptanceCases(1348471918, 20)]),
    { transitions: 1878, total: 17600, percent: 10.7, withoutZ: { transitions: 1878, total: 8800, percent: 21.3 } });
  assert.equal(measureTransitionCoverage(space, RECOVERY_DEVELOPMENT_CASES).transitions, 550);
  assert.equal(measureTransitionCoverage(space, acceptanceCases(1348471918, 20)).transitions, 1605);
  assert.deepEqual(candidates.map(candidate => candidate.id).sort(), Object.keys(expected).sort());
});

for (const candidate of candidates) {
  test(`exhaustive search: ${candidate.id}`, { timeout: 180000 }, async () => {
    const result = await verifyExhaustiveMotion(candidate.source, candidate.defaults, { timerFields: candidate.timerFields });
    const verdict = expected[candidate.id];
    assert.equal(result.verdict, typeof verdict === 'number' ? 'counterexample' : verdict, JSON.stringify(result));
    if (verdict === 'proved') {
      assert.equal(result.complete, true);
      assert.equal(result.pairs, 275);
      assert.equal(result.checked, 17600);
      assert.equal(result.projection.failures, 0);
      if (candidate.id === 'v5-session-3-attempt-3') assert.equal(result.projection.checked, 17600);
    } else if (typeof verdict === 'number') {
      assert.equal(result.counterexample.length, verdict);
      assert.equal(result.counterexample.buttons.length, verdict);
      assert.equal(result.counterexample.confirmation.passed, false);
      assert.equal(result.counterexample.trace.steps.reduce((sum, step) => sum + step.frames, 0), verdict + 12);
      assert.ok(result.counterexample.confirmation.results[0].firstDivergence);
    } else {
      assert.equal(result.reason, 'position-affects-behavior');
      assert.equal(result.complete, true);
      assert.equal(result.pairs, 17057);
      assert.equal(result.projection.checked, 1091648);
      assert.equal(result.projection.failures, 721840);
      assert.notDeepEqual(result.projection.firstFailure.original.output, result.projection.firstFailure.perturbed.output);
    }
  });
}

test('a forced search cap never passes', async () => {
  const candidate = candidates[0];
  const result = await verifyExhaustiveMotion(candidate.source, candidate.defaults, { timerFields: candidate.timerFields, maxChecks: 1 });
  assert.equal(result.verdict, 'inconclusive');
  assert.equal(result.reason, 'search-cap');
  assert.equal(result.checked, 1);
  assert.equal(result.complete, false);
});

test('snapshot refuses an additional mutable global', async () => {
  const wabt = await wabtFactory();
  const module = wabt.parseWat('extra-global.wat', '(module (global (mut i32) (i32.const 14752)) (global (mut i32) (i32.const 0)))');
  try {
    await assert.rejects(assertSnapshotCartridge(module.toBinary({}).buffer), /only mutable global/);
  } finally { module.destroy(); }
});

test('abstraction conflicts fail closed for motion, timers, events and next states', () => {
  const expected = { next: '0|0|1|0', displacement: { x: 2, y: 0 }, ownsMotion: false, events: [], timers: { cooldown: 0, remaining: 0 } };
  for (const change of [{ displacement: { x: 2.002, y: 0 } }, { ownsMotion: true }, { events: ['dash-start'] },
    { next: '0|0|0|1' }, { timers: { cooldown: 1, remaining: 0 } }]) {
    assert.throws(() => assertSameTransition(expected, { ...expected, ...change }, 'test'), /abstraction conflict/);
  }
});

test('candidate exceptions, hidden state and unsupported configurations are inconclusive', async () => {
  const candidate = candidates[0], options = { timerFields: candidate.timerFields };
  for (const source of [
    'export function init() { while (true) {} } export function step() {}',
    'export function init() { return { cooldown: NaN }; } export function step() {}',
    'let ticks = 0; export function init() { return {}; } export function step() { return ++ticks; }',
    'export function init() { return { value: process.env }; } export function step() {}',
    'export function init() { return { value: Math.random() }; } export function step() {}',
    'export function init() { return { value: encode({}) }; } export function step() {}',
    'const hidden = { ticks: 0 }; export function init() { hidden.ticks++; return hidden; } export function step() {}',
    'export function init() { init.prototype.ticks = 1; return {}; } export function step() {}',
  ]) {
    const result = await verifyExhaustiveMotion(source, DEFAULT_CONFIG, options);
    assert.equal(result.verdict, 'inconclusive');
  }
  assert.equal((await verifyExhaustiveMotion(candidate.source, { ...candidate.defaults, walkingSpeed: NaN }, options)).verdict, 'inconclusive');
  assert.equal((await verifyExhaustiveMotion(candidate.source, candidate.defaults, { timerFields: { cooldown: 'x', remaining: 'remaining' } })).verdict, 'inconclusive');
});
