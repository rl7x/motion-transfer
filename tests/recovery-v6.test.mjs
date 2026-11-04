import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRecoveryProtocol, validateRecoveryProtocol, RECOVERY_REQUIREMENTS } from '../src/agent/recovery-protocol.mjs';
import { blindOutput, inconclusiveFeedback, recoveryQuestion } from '../src/agent/blind-output.mjs';
import { recoveryGuidance } from '../src/agent/recovery-progress.mjs';
import { INVESTIGATION_QUESTIONS } from '../src/lab/service.mjs';
import { createJournalToolExecutor } from '../src/agent/journal-tools.mjs';
import { evidenceHistory } from '../src/agent/evidence.mjs';
import { investigate } from '../src/agent/investigate.mjs';
import { createToolDispatcher } from '../src/agent/tool-dispatcher.mjs';
import { createComponentWorkbench } from '../src/agent/component-workbench.mjs';
import { createInvestigationSession } from '../src/runtime/investigation-session.mjs';
import { loadTarget } from '../src/agent/target.mjs';
import { compileMotion } from '../src/component/build.mjs';
import { evaluateRecoveryMotion } from '../src/evaluator/recovery-motion.mjs';
import { DEFAULT_CONFIG } from '../src/evaluator/state-space.mjs';
import { RECOVERY_DEVELOPMENT_CASES } from '../src/evaluator/recovery-cases.mjs';

const protocol = createRecoveryProtocol({ name: 'motion-recovery-v6', model: 'muse-wonder-1.0' });
const timerFields = { cooldown: 'cooldown', remaining: 'remaining' };
const goodSource = await readFile(new URL('../assets/components/dashy-dango-dash/component.ts', import.meta.url), 'utf8');
const fixtures = JSON.parse(await readFile(new URL('fixtures/wonder-recovery-failures.json', import.meta.url)));

function assertBlind(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!['motion', 'motionNotice', 'fieldHints', 'normalized', 'normalizedTrace'].includes(key), key);
    assert.notEqual(child, 'human-mapped-assistance');
    assertBlind(child);
  }
}

test('v6 records its gates while all historical protocol bodies remain valid', async () => {
  const v5 = createRecoveryProtocol({ model: 'muse-wonder-1.0' });
  assert.equal(v5.name, 'motion-recovery-v5');
  assert.deepEqual(protocol.limits, { ...v5.limits, maxCostUsd: 2.5 });
  for (const key of ['maxDevelopmentAttempts', 'maxSelections', 'developmentRequestReserve', 'requestTimeoutMs', 'development', 'context', 'acceptance', 'completion']) {
    assert.deepEqual(protocol[key], v5[key]);
  }
  assert.equal(protocol.investigation.stateReader, false);
  assert.equal(protocol.exhaustive.success, 'proved-and-20-of-20-acceptance');
  assert.throws(() => createRecoveryProtocol({ name: protocol.name, model: protocol.model, maxCostUsd: 2.51 }), /ceiling/);
  for (const version of ['v3', 'v4', 'v5']) {
    const plan = JSON.parse(await readFile(new URL(`../assets/benchmark/wonder-harness-${version}/plan.json`, import.meta.url)));
    assert.deepEqual(validateRecoveryProtocol(plan.protocol), plan.protocol);
  }
});

test('blinding is recursive, leaves raw model watches intact, and preserves old outputs by identity', () => {
  const original = { motion: { position: { x: 8 }, fieldHints: { x: { address: 33333 } } }, motionNotice: 'private marker',
    children: [{ fieldHints: { address: 44444 } }], targets: [{ address: 55555, origin: 'human-mapped-assistance' },
      { address: 4, origin: 'agent-requested-raw-watch' }], memory: [{ address: 4, values: [2] }] };
  const result = blindOutput(original, protocol);
  assertBlind(result);
  assert.doesNotMatch(JSON.stringify(result), /33333|44444|55555|private marker/);
  assert.equal(result.targets[0].address, 4);
  assert.equal(result.memory[0].address, 4);
  assert.equal(blindOutput(original, createRecoveryProtocol()), original);
  assert.ok(original.motion.fieldHints);
});

test('real raw tools and target-free preparation never return private hints', async () => {
  const dispatcher = createToolDispatcher({ target: await loadTarget(), persistCheckpoint: async () => {} });
  await dispatcher.execute('$open', { recoveryProtocol: protocol });
  const run = async (name, args) => {
    const output = await dispatcher.execute(name, args); assertBlind(output); return output.result;
  };
  const started = await run('session_advance', { branchId: 'main', hypothesis: 'Local blinding test.', watches: [], steps: [{ buttons: 1, frames: 1, checkpoint: 'start' }] });
  const original = await run('run_original', { hypothesis: 'Local fresh replay.', watches: [], steps: [{ buttons: 1, frames: 2, checkpoint: 'start' }] });
  assert.ok(original.checkpoints.at(-1).sprites.length);
  const ledger = evidenceHistory({ recoveryProtocol: protocol, question: 'Local compaction test.',
    toolCalls: [{ ok: true, name: 'run_original', args: { steps: [], watches: [] }, result: original }] }, { includeDiscovery: false });
  assertBlind(JSON.parse(ledger[1].content[0].text.split('\n').slice(1).join('\n')));
  const prepared = await run('prepare_checkpoint', { requestId: 'blind-preparation', hypothesis: 'Target-free preparation.', watches: [], steps: [{ buttons: 0, frames: 1, checkpoint: 'ready' }] });
  assert.deepEqual(prepared.targets, []);
  const raw = await run('read_checkpoint', { checkpointId: prepared.checkpointId, watches: [{ name: 'raw palette hypothesis', address: 4, type: 'u32', count: 1 }] });
  assert.equal(raw.targets.length, 1);
  assert.equal(raw.targets[0].origin, 'agent-requested-raw-watch');
  const observed = await run('session_observe', { branchId: 'main', watches: [] });
  await run('diff_memory', { fromObservationId: started.checkpoints[0].observationId, toObservationId: observed.observationId,
    range: { address: 0, byteLength: 32, type: 'u8' } });
  for (const branchId of ['control', 'changed']) await run('fork_checkpoint', { checkpointId: prepared.checkpointId, branchId, watches: [] });
  await run('compare_branches', { controlBranchId: 'control', experimentalBranchId: 'changed', hypothesis: 'Identical branches.', watches: [], steps: [{ buttons: 33, frames: 2, checkpoint: 'end' }] });
});

test('the final journal boundary removes injected mapped addresses before provider serialization', async () => {
  const history = [], report = { model: protocol.model, recoveryProtocol: protocol, requirements: RECOVERY_REQUIREMENTS,
    limits: protocol.limits, toolCalls: [] };
  const execute = createJournalToolExecutor({ report, history, dispatch: async () => ({ result: {
    motion: { fieldHints: { x: { address: 33333 } } }, motionNotice: 'private marker',
    nested: [{ fieldHints: { address: 44444 }, normalizedTrace: [{ address: 55555 }] }],
    memory: [{ name: 'agent watch', address: 4, values: [1] }],
  } }) });
  const result = await execute({ type: 'function_call', call_id: 'injected-observation', name: 'session_observe',
    arguments: JSON.stringify({ branchId: 'main', watches: [] }) }, 0);
  assert.equal(result.entry.ok, true);
  assertBlind(JSON.parse(history[0].output));
  assert.doesNotMatch(history[0].output, /33333|44444|55555|private marker/);
  assert.equal(JSON.parse(history[0].output).memory[0].address, 4);
});

const outputs = request => request.input.flatMap(item => {
  if (item.type === 'function_call_output') { const result = JSON.parse(item.output); assertBlind(result); return [result]; }
  const text = item.content?.find(block => block.text?.includes('ledger contains actual'))?.text;
  if (!text) return [];
  const ledger = JSON.parse(text.slice(text.indexOf('\n') + 1)); assertBlind(ledger);
  return ledger.observations.filter(call => call.ok).map(call => call.result);
});

test('a mocked model sees no hints through SDK output, evidence selection or compaction and reaches all three real gates', { timeout: 180000 }, async () => {
  let turn = 0, experimentId, compacted = false;
  const inspectRequest = request => {
    const results = outputs(request);
    assert.doesNotMatch(JSON.stringify(request.tools), /HUMAN-MAPPED|Human-mapped motion hints|human-mapped hints/);
    assert.match(request.instructions, /never told where state lives/);
    return results;
  };
  const client = { countInputTokens: async request => { inspectRequest(request); return 1000; }, respond: async request => {
    turn++; assert.ok(turn <= 3);
    const previous = inspectRequest(request).at(-1);
    let name, args;
    if (turn === 1) {
      for (const tool of ['run_original', 'session_advance', 'fork_checkpoint', 'compare_branches', 'diff_memory', 'trace_writers']) {
        assert.ok(request.tools.some(entry => entry.name === tool), tool);
      }
      name = 'run_experiment_program';
      args = { requestId: 'blind-mocked-program', hypothesis: 'Local raw palette intervention fixture.', language: 'javascript', source: `
await sdk.static.inspectWasm({view:'overview',startLine:1,lineCount:5});
await sdk.static.inspectFunction({functionIndex:9,startLine:1,lineCount:12});
const prepared=await sdk.prepareCheckpoint({hypothesis:'Local target-free test.',steps:[{buttons:1,frames:1,checkpoint:'start'}],watches:[]});
if(prepared.targets.length!==0||JSON.stringify(prepared).includes('fieldHints'))throw Error('Private hint reached SDK');
const raw=await sdk.readCheckpoint({checkpointId:prepared.checkpointId,watches:[{name:'raw palette hypothesis',address:4,type:'u32',count:1}]});
const trial=await sdk.runExperiment({hypothesis:'Raw palette intervention.',checkpointId:prepared.checkpointId,interventions:[{targetId:raw.targets[0].id,value:0,hypothesis:'Observe rendering change.'}],steps:[{buttons:0,frames:1,checkpoint:'end'}],observations:{channels:['rendering','memory'],watches:[],captures:[]}});
if(JSON.stringify(trial).includes('fieldHints'))throw Error('Private hint reached experiment program');
return {experimentId:trial.experimentId,prepared:prepared,trial:trial};` };
    } else if (turn === 2) {
      assert.equal(previous.status, 'completed', JSON.stringify(previous));
      assertBlind(previous.output);
      assert.equal(previous.activity, undefined, 'Unavailable normalized motion must not become a zero-activity claim');
      experimentId = previous.output.experimentId;
      name = 'select_component_evidence'; args = { functionIndices: [9], evidenceIds: [experimentId], scope: 'Local mocked selection from observed raw intervention.' };
    } else {
      compacted = request.input.some(item => item.content?.some(block => block.text?.includes('ledger contains actual')));
      name = 'submit_component_candidate'; args = { selectionId: previous.selectionId, source: goodSource, timerFields,
        contract: { name: 'Local injected fixture', scope: 'No new model recovery.', defaults: DEFAULT_CONFIG, stateDescription: 'Timers and direction.',
          limitations: ['Human-supplied local fixture.'], rules: [{ description: 'Local orchestration check.', evidence: ['binary:func9', experimentId] }] } };
    }
    return { id: 'blind-fixture-' + turn, status: 'completed', usage: { input_tokens: 1000, output_tokens: 100 },
      output: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: 'blind-fixture-' + turn, status: 'completed' }] };
  } };
  const report = await investigate({ client, recoveryProtocol: protocol });
  assert.equal(turn, 3); assert.equal(compacted, true);
  assert.equal(report.status, 'completed');
  assert.equal(report.exhaustiveVerification.attempts[0].verdict, 'proved');
  const attempt = report.session.recovery.attempts[0];
  assert.equal(attempt.development.results.length, 32);
  assert.equal(attempt.exhaustive.checked, 17600);
  assert.equal(attempt.acceptance.results.length, 20);
  assert.equal(attempt.acceptance.passed, true);
  assert.ok(report.humanAssistance.some(line => line.includes('private grader')));
  report.toolCalls.forEach(call => assertBlind(call.result));
});

async function setup(options = {}) {
  const session = await createInvestigationSession((await loadTarget()).bytes, undefined, { recoveryProtocol: protocol });
  session.recordStatic({ id: 'binary:func9', functionIndex: 9, kind: 'wat' });
  const observation = (await session.execute('session_observe', { branchId: 'main', watches: [] })).result;
  const workbench = createComponentWorkbench(session, options);
  const selected = (await workbench.execute('select_component_evidence', { functionIndices: [9], evidenceIds: [observation.observationId], scope: 'Local gate test.' })).result;
  return { session, workbench, args: { selectionId: selected.selectionId, source: goodSource, timerFields,
    contract: { name: 'Gate fixture', scope: 'Local test only.', defaults: DEFAULT_CONFIG, stateDescription: 'Timers.',
      limitations: ['Local fixture.'], rules: [{ description: 'Gate orchestration.', evidence: ['binary:func9'] }] } } };
}

test('confirmed counterexamples consume development attempts and expose normal failure windows', async () => {
  const { session, workbench, args } = await setup({ evaluate: async (source, config, cases, options) => {
    // Simulate a sampled suite missing a known bug; its counterexample replay is real.
    if (cases === RECOVERY_DEVELOPMENT_CASES) return { ...await compileMotion(source), passed: true, results: cases.map(trace => ({ name: trace.name, passed: true })) };
    return evaluateRecoveryMotion(source, config, cases, options);
  } });
  const result = (await workbench.execute('submit_component_candidate', { ...args, source: fixtures[2].source })).result;
  assert.equal(result.exhaustive.verdict, 'counterexample');
  assert.equal(result.development.passed, false);
  assert.equal(result.development.firstFailures[0].firstDivergence.tick, 11);
  assert.ok(result.development.firstFailures[0].firstDivergence.expected.timers);
  assert.equal(session.recovery.attempts.length, 1);
  assert.equal(result.canRevise, true);
  await assert.rejects(workbench.execute('freeze_component', { candidateId: result.candidateId }), /development-passed/);
});

test('inconclusive results cannot freeze and a proved/acceptance disagreement stops', async () => {
  const inconclusive = await setup({ verifyExhaustive: async () => ({ verdict: 'inconclusive', reason: 'search-cap' }) });
  const result = (await inconclusive.workbench.execute('submit_component_candidate', inconclusive.args)).result;
  assert.equal(result.development.passed, false);
  assert.match(result.development.error, /Keep state to timers and direction/);
  await assert.rejects(inconclusive.workbench.execute('freeze_component', { candidateId: result.candidateId }), /development-passed/);
  const conflict = await setup({ verifyExhaustive: async () => ({ verdict: 'proved' }),
    evaluate: async (source, config, cases, options) => options.suite === 'acceptance'
      ? { passed: false, results: [] } : evaluateRecoveryMotion(source, config, cases, options) });
  const submitted = (await conflict.workbench.execute('submit_component_candidate', conflict.args)).result;
  await conflict.workbench.execute('freeze_component', { candidateId: submitted.candidateId });
  await assert.rejects(conflict.workbench.execute('accept_component', { candidateId: submitted.candidateId }), /state abstraction/);
  assert.ok(conflict.session.recovery.abstractionConflict);
  assert.equal(conflict.session.recovery.acceptedAttempt, undefined);
  await assert.rejects(conflict.workbench.execute('accept_component', { candidateId: submitted.candidateId }), /once only/);
});

test('verifier exceptions remain an inconclusive consumed attempt', async () => {
  const { session, workbench, args } = await setup({ verifyExhaustive: async () => { throw Error('Local verifier interruption'); } });
  const result = (await workbench.execute('submit_component_candidate', args)).result;
  assert.equal(result.exhaustive.verdict, 'inconclusive');
  assert.equal(result.development.passed, false);
  assert.equal(result.canRevise, true);
  assert.equal(session.recovery.attempts.length, 1);
  await assert.rejects(workbench.execute('freeze_component', { candidateId: result.candidateId }), /development-passed/);
});

test('the real recovery request has no mapped-field wording in v6 and is unchanged before it', () => {
  const question = INVESTIGATION_QUESTIONS.extraction;
  assert.doesNotMatch(recoveryQuestion(question, protocol), /mapped/i);
  assert.match(recoveryQuestion(question, protocol), /the ABI, evaluators and recipient adapter are human assistance/);
  assert.equal(recoveryQuestion(question, createRecoveryProtocol()), question);
  const report = { recoveryProtocol: protocol, toolCalls: [], session: { recovery: { protocol, selections: [], attempts: [] } } };
  assert.doesNotMatch(recoveryGuidance(report, { remainingRequests: 32 }), /event and timer observations/);
});

test('refusals give the model their real cause, and only state problems get state advice', () => {
  const refused = inconclusiveFeedback({ reason: 'verification-error', error: 'Exhaustive search requires module constants to be JSON literals' });
  assert.match(refused, /module constants/); assert.doesNotMatch(refused, /timers and direction/);
  assert.match(inconclusiveFeedback({ reason: 'candidate-execution', error: 'Component returned invalid normalized timers' }), /invalid normalized timers/);
  for (const reason of ['position-affects-behavior', 'search-cap', 'time-limit']) assert.match(inconclusiveFeedback({ reason }), /timers and direction/);
});
