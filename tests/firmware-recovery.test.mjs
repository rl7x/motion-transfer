import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import wabtFactory from 'wabt';
import { assertSelfContained, BOOT_STATES, createDonor, describeOutput, enumerateFirmware, INPUTS, loadFirmware } from '../src/firmware/state-space.mjs';
import { verifyFirmwareCandidate } from '../src/firmware/verify.mjs';
import { disassemble, FIRMWARE_INSTRUCTIONS, FIRMWARE_PROTOCOL, FIRMWARE_TOOLS, firstHistory, runFirmwareSession, submissionFeedback } from '../src/firmware/session.mjs';

const reference = await readFile(new URL('fixtures/px4-arming-reference.ts', import.meta.url), 'utf8');
const { bytes, lock } = await loadFirmware();
const alter = (from, to) => { assert.ok(reference.includes(from), from); return reference.replace(from, to); };

test('the binary enumerates from complete memory with no human state fields', async () => {
  const space = await enumerateFirmware();
  assert.equal(space.verification.states, 2254);
  assert.equal(space.verification.transitions, 1622880);
  assert.equal(space.verification.stackChecks, 1622880);
  assert.equal(INPUTS.length, 720);
  assert.equal(new Set(INPUTS.map(String)).size, 720);
  assert.deepEqual(space.verification.globals, { imports: 0, mutableGlobals: 1 });
  assert.equal(space.verification.memory.live + space.verification.memory.stack + space.verification.memory.heap, 65536);
});

test('the committed binary keeps exactly two changed table cells', () => {
  assert.deepEqual(lock.alteredCells.map(cell => [cell.row, cell.column]), [['STANDBY', 'STANDBY_ERROR'], ['SHUTDOWN', 'ARMED']]);
  assert.equal(lock.upstream.license, 'BSD-3-Clause');
});

test('the independent reference matches on every reachable state and input', { timeout: 170000 }, async () => {
  const result = await verifyFirmwareCandidate(reference);
  assert.equal(result.verdict, 'proved', JSON.stringify(result).slice(0, 400));
  assert.equal(result.complete, true);
  assert.equal(result.pairs, 2254);
  assert.equal(result.checked, 1622880);
});

const controls = {
  'public PX4 table recalled from memory': [alter('[1, 1, 1, 1, 0, 0], [0, 1, 1, 0, 0, 1], [1, 1, 1, 1, 0, 0], [1, 1, 1, 1, 1, 1]', '[1, 1, 1, 0, 0, 0], [0, 1, 1, 0, 0, 1], [1, 1, 1, 1, 0, 0], [1, 1, 0, 1, 1, 1]')],
  'second altered cell only': [alter('[1, 1, 1, 1, 1, 1]]'.slice(0, 18), '[1, 1, 0, 1, 1, 1]')],
  'lockdown is not latched': [alter('s.lockdown = 1;', 's.lockdown = 0;')],
  'hardware in the loop does not repair standby error': [alter('if (s.arm === STANDBY_ERROR) s.arm = STANDBY;', '')],
  'preflight checks run in hardware in the loop': [alter('runChecks && !hil &&', 'runChecks &&')],
  'preflight checks run on in-air restore': [alter(' && s.arm !== IN_AIR_RESTORE', '')],
  'a failed preflight also logs a denial': [alter('{ feedback = true; valid = false; }', '{ valid = false; }')],
  'arm and disarm reasons are swapped': [alter('s.disarmingReason = reason;', 's.armingReason = reason;')],
  'armed time survives a disarm': [alter('s.armedTime = s.arm === ARMED ? 1 : 0;', 'if (s.arm === ARMED) s.armedTime = 1;')],
};
for (const [name, [source]] of Object.entries(controls)) {
  test(`negative control: ${name}`, { timeout: 170000 }, async () => {
    const result = await verifyFirmwareCandidate(source);
    assert.equal(result.verdict, 'counterexample', JSON.stringify(result).slice(0, 300));
    const { trace } = result.counterexample;
    assert.notEqual(trace.at(-1).expected, trace.at(-1).actual);
    assert.ok(trace.slice(0, -1).every(step => step.expected === step.actual));
    assert.ok(typeof describeOutput(trace.at(-1).expected).armState === 'number');
  });
}

test('a counterexample is the shortest failure, not just any failure', async () => {
  const memorized = await verifyFirmwareCandidate(controls['public PX4 table recalled from memory'][0]);
  assert.equal(memorized.counterexample.boot, 2, 'Boot states run in order, and boot state 2 reaches an altered cell first');
  assert.equal(memorized.counterexample.length, 1);
  assert.deepEqual(memorized.counterexample.trace[0].input.slice(0, 2), [4, 0]);
  const armed = await verifyFirmwareCandidate(controls['second altered cell only'][0]);
  assert.equal(armed.counterexample.boot, 2, 'Boot state 2 reaches the altered cell in one step');
  assert.equal(armed.counterexample.length, 1);
});

test('nothing but a completed, clean search can pass', { timeout: 170000 }, async () => {
  const capped = await verifyFirmwareCandidate(reference, { maxChecks: 1000 });
  assert.equal(capped.verdict, 'inconclusive'); assert.equal(capped.reason, 'search-cap');
  const growing = await verifyFirmwareCandidate(alter('const s = { ...state };', 'const s: any = { ...state, n: ((state as any).n ?? 0) + 1 };'), { maxChecks: 200000 });
  assert.equal(growing.verdict, 'inconclusive'); assert.equal(growing.reason, 'search-cap');
  for (const [source, pattern] of [
    ['let ticks = 0; ' + reference, /module scope/i],
    ['const SHIFT = 1 << 4; ' + reference, /module constants/i],
    ['const noop = (v: number) => v; ' + reference, /module constants/i],
    ['export function init() { while (true) {} } export function step() {}', /timed out|Script execution/i],
    [alter('const s = { ...state };', 'const s = { ...state }; const f: any = Object.getPrototypeOf(step); f.n = 1;'), /read only|not extensible|Cannot add/i],
  ]) {
    const result = await verifyFirmwareCandidate(source);
    assert.equal(result.verdict, 'inconclusive', source.slice(0, 80));
    assert.match(result.error ?? '', pattern, JSON.stringify(result).slice(0, 300));
    assert.match(JSON.stringify(submissionFeedback(result)), pattern, 'The model must get the real reason');
  }
});

test('cartridges with imports or hidden globals are refused', async () => {
  const wabt = await wabtFactory();
  for (const text of ['(module (global (mut i32) (i32.const 1)) (global (mut i32) (i32.const 2)))', '(module (import "env" "clock" (func)))']) {
    const module = wabt.parseWat('refused.wat', text);
    try { await assert.rejects(assertSelfContained(module.toBinary({}).buffer), /mutable global|host imports/); } finally { module.destroy(); }
  }
});

test('the model is not told what the binary is', async () => {
  const visible = FIRMWARE_INSTRUCTIONS + JSON.stringify(FIRMWARE_TOOLS) + JSON.stringify(await firstHistory(bytes));
  assert.doesNotMatch(visible, /px4|arm|drone|flight|autopilot|standby|lockdown|preflight/i);
  assert.equal(FIRMWARE_PROTOCOL.limits.maxCostUsd, 1.19);
  assert.equal(FIRMWARE_PROTOCOL.name, 'firmware-recovery-v2');
  assert.match(await disassemble(bytes), /\(export "step"/);
});

function mockClient(sources, usage = { input_tokens: 4000, output_tokens: 1500 }) {
  const requests = [];
  let turn = 0;
  return { requests, client: { countInputTokens: async request => { requests.push(request); return Math.ceil(JSON.stringify(request.input).length / 4); },
    respond: async () => { const step = sources[turn++]; if (step === 'cut') return { id: 'mock-' + turn, status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage, output: [] };
      return { id: 'mock-' + turn, status: 'completed', usage,
      output: step === null ? [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }]
        : [{ type: 'function_call', call_id: 'call-' + turn, ...step }] }; } } };
}
const submit = source => ({ name: 'submit_candidate', arguments: JSON.stringify({ source }) });

test('the first request carries no disassembly, and the tool returns it in pieces', { timeout: 170000 }, async () => {
  const { client, requests } = mockClient([{ name: 'read_disassembly', arguments: JSON.stringify({ startLine: 1, lineCount: 120 }) },
    { name: 'read_disassembly', arguments: JSON.stringify({ startLine: 1, lineCount: 500 }) }, submit(reference)]);
  const report = await runFirmwareSession({ client, bytes });
  assert.equal(report.status, 'completed', report.error);
  assert.doesNotMatch(JSON.stringify(requests[0].input[0]), /i32\.const/, 'History grows in place, so only its first item is the first request');
  const replies = requests.at(-1).input.filter(item => item.type === 'function_call_output').map(item => JSON.parse(item.output));
  assert.equal(replies[0].lines.length, 120);
  assert.ok(replies[0].totalLines > 300);
  assert.match(replies[1].error, /1 to 120/);
  assert.equal(report.toolCalls[0].output.lines, 120, 'The report keeps the count, not the text');
});

test('a truncated response is paid for and survived, but only within its limit', { timeout: 170000 }, async () => {
  const survived = await runFirmwareSession({ bytes, client: mockClient(['cut', submit(reference)]).client });
  assert.equal(survived.status, 'completed', survived.error);
  assert.equal(survived.truncations, 1);
  assert.equal(survived.requests[0].incompleteReason, 'max_output_tokens');
  assert.equal(survived.requests.length, 2);
  assert.ok(survived.estimatedCostUsd > 0, 'A truncated response still costs money');
  const exhausted = await runFirmwareSession({ bytes, client: mockClient(['cut', 'cut', 'cut']).client });
  assert.equal(exhausted.status, 'failed');
  assert.match(exhausted.error, /status incomplete/);
  assert.equal(exhausted.truncations, 2);
});

test('a mocked session reaches proved through a real counterexample and a real run', { timeout: 170000 }, async () => {
  const { client, requests } = mockClient([
    { name: 'run_binary', arguments: JSON.stringify({ boot: 0, inputs: [[1, 0, 0, 0, 0], [2, 0, 1, 1, 3]] }) },
    { name: 'run_binary', arguments: JSON.stringify({ boot: 9, inputs: [[1, 0, 0, 0, 0]] }) },
    submit(controls['public PX4 table recalled from memory'][0]), submit('const noop = (v: number) => v; ' + reference), submit(reference)]);
  const report = await runFirmwareSession({ client, bytes });
  assert.equal(report.status, 'completed', report.error);
  assert.equal(report.acceptedAttempt, 3);
  assert.deepEqual(report.attempts.map(attempt => attempt.result.verdict), ['counterexample', 'inconclusive', 'proved']);
  assert.equal(report.binaryRuns, 1);
  assert.equal(report.toolCalls[1].ok, false);
  const donor = await createDonor(bytes); donor.boot(0);
  assert.deepEqual(report.toolCalls[0].output.outputs, [donor.step([1, 0, 0, 0, 0]), donor.step([2, 0, 1, 1, 3])]);
  const feedback = requests.at(-1).input.filter(item => item.type === 'function_call_output').map(item => JSON.parse(item.output));
  assert.equal(feedback[2].verdict, 'counterexample');
  assert.match(feedback[3].error, /module constants/i);
  assert.equal(report.reservedCostUsd, 0);
  assert.ok(requests.every(request => JSON.stringify(request.tools) === JSON.stringify(FIRMWARE_TOOLS)));
});

test('failures stay failures: ceiling, exhausted submissions and a silent model', { timeout: 170000 }, async () => {
  const expensive = await runFirmwareSession({ bytes, client: mockClient(Array(20).fill({ name: 'run_binary', arguments: JSON.stringify({ boot: 0, inputs: [[1, 0, 0, 0, 0]] }) }), { input_tokens: 20000, output_tokens: 5000 }).client });
  assert.equal(expensive.status, 'failed'); assert.match(expensive.error, /Cost budget cannot cover/);
  assert.ok(expensive.estimatedCostUsd <= FIRMWARE_PROTOCOL.limits.maxCostUsd);
  const overrun = await runFirmwareSession({ bytes, client: mockClient(Array(20).fill({ name: 'run_binary', arguments: JSON.stringify({ boot: 0, inputs: [[1, 0, 0, 0, 0]] }) }), { input_tokens: 20000, output_tokens: 8000 }).client });
  assert.equal(overrun.status, 'failed'); assert.match(overrun.error, /exceeded the session cost ceiling/);
  const wrong = await runFirmwareSession({ bytes, client: mockClient(Array(5).fill(submit(controls['lockdown is not latched'][0]))).client });
  assert.equal(wrong.status, 'failed'); assert.match(wrong.error, /All 5 submissions failed/); assert.equal(wrong.acceptedAttempt, undefined);
  const silent = await runFirmwareSession({ bytes, client: mockClient([null]).client });
  assert.equal(silent.status, 'failed'); assert.match(silent.error, /stopped without a matching submission/);
});

test('every boot state is a declared root', () => assert.deepEqual([...BOOT_STATES], [0, 1, 2, 3, 4, 5]));
