import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecoveryProtocol, validateRecoveryProtocol, recoveryPolicy, assertRecoveryProtocolSources,
  snapshotRecoveryProtocol, RECOVERY_REQUIREMENTS } from '../agent/recovery-protocol.mjs';
import { investigate } from '../agent/investigate.mjs';
import { createInvestigationSession } from '../runtime/investigation-session.mjs';
import { createComponentWorkbench } from '../agent/component-workbench.mjs';
import { createToolDiscovery } from '../agent/tool-discovery.mjs';
import { createJournalToolExecutor } from '../agent/journal-tools.mjs';
import { requestInvestigationTurn } from '../agent/investigation-request.mjs';
import { recoveryStep } from '../agent/recovery-progress.mjs';
import { compileMotion } from '../component/build.mjs';
import { loadTarget } from '../agent/target.mjs';
import { PRICES, tokenCost } from '../agent/accounting.mjs';

const source = 'export function init(){return {cooldown:0,remaining:0}};export function step(state){return {state,output:{ownsMotion:false,displacement:{x:0,y:0},events:[]}}}';
const usage = { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } };

test('new recovery controls are immutable and reject changed identity, prices or limits', async () => {
  const protocol = createRecoveryProtocol();
  assert.equal(protocol.model, 'muse-spark-1.3-contributor');
  assert.equal(protocol.reasoningEffort, 'high');
  assert.equal(protocol.toolDiscovery, 'none');
  assert.deepEqual(protocol.limits, { maxModelCalls: 32, maxToolCalls: 48, maxInputTokens: 32000,
    maxOutputTokens: 12000, maxCostUsd: 0.5, timeoutMs: 720000 });
  assert.equal(protocol.requestTimeoutMs, 120000);
  assert.equal(protocol.maxDevelopmentAttempts, 5);
  assert.equal(protocol.developmentRequestReserve, 14);
  assert.ok(Object.isFrozen(protocol) && Object.isFrozen(protocol.limits));
  for (const edit of [value => value.limits.maxToolCalls++, value => value.maxDevelopmentAttempts++,
    value => value.pricingPerMillionTokens.output++, value => { value.extra = true; }]) {
    const changed = structuredClone(protocol); edit(changed);
    assert.throws(() => validateRecoveryProtocol(changed), /protocol identity or controls changed/);
  }
  assert.equal(recoveryPolicy().maxDevelopmentAttempts, 3);
  assert.equal(recoveryPolicy().developmentRequestReserve, 7);
  const snapshot = await snapshotRecoveryProtocol();
  assert.ok(snapshot.sourceHashes['agent/recovery-protocol.mjs']);
  assert.ok(snapshot.sourceHashes['targets/dashy-dango/cart.wasm']);
  await assertRecoveryProtocolSources(snapshot);
  const wrong = createRecoveryProtocol({ sourceHashes: { 'agent/recovery-protocol.mjs': '0'.repeat(64) } });
  await assert.rejects(assertRecoveryProtocolSources(wrong), /Frozen recovery protocol source changed/);
  assert.equal(tokenCost({ inputTokens: 32000, cachedInputTokens: 0, outputTokens: 12000 }, PRICES[protocol.model]) * 32, 0.1792);
});

test('the real worker retains the new protocol while the API uses recorded Contributor controls', async () => {
  const protocol = createRecoveryProtocol();
  let requests = 0;
  const client = { countInputTokens: async () => 1000, respond: async request => {
    requests++;
    assert.equal(request.model, protocol.model);
    assert.deepEqual(request.reasoning, { effort: 'high' });
    assert.equal(request.max_output_tokens, 12000);
    assert.ok(!request.tools.some(tool => tool.type === 'tool_search'));
    return { id: 'injected-contributor', model: protocol.model, status: 'completed', usage,
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'No investigation was attempted by this injected fixture.' }] }] };
  } };
  await assert.rejects(investigate({ client, recoveryProtocol: protocol }), error => {
    assert.equal(error.report.recoveryProtocol.id, protocol.id);
    assert.equal(error.report.session.recovery.protocol.id, protocol.id);
    assert.deepEqual(error.report.requirements, RECOVERY_REQUIREMENTS);
    assert.equal(error.report.requests.length, 1);
    assert.equal(error.report.reservedCostUsd, 0);
    assert.equal(error.report.estimatedCostUsd, 0.00012);
    return /without an inspection/.test(error.message);
  });
  assert.equal(requests, 1);
  await assert.rejects(investigate({ client, recoveryProtocol: protocol, limits: { maxModelCalls: 33 } }), /recorded recovery protocol controls/);
  await assert.rejects(investigate({ client, recoveryProtocol: protocol, reasoningEffort: 'low' }), /recorded recovery protocol controls/);
  await assert.rejects(investigate({ client, recoveryProtocol: protocol, requirements: { followupDecision: false } }), /requirements cannot be relaxed/);
  assert.equal(requests, 1);
});

test('five behavioral attempts survive replay and cannot be extended or added to a legacy journal', async () => {
  const bytes = (await loadTarget()).bytes, protocol = createRecoveryProtocol();
  const session = await createInvestigationSession(bytes, undefined, { recoveryProtocol: protocol });
  session.recordStatic({ id: 'binary:func9', functionIndex: 9, kind: 'wat' });
  const observation = (await session.execute('session_observe', { branchId: 'main', watches: [] })).result;
  const workbench = createComponentWorkbench(session, { evaluate: async text => ({ ...await compileMotion(text), passed: false, results: [] }) });
  const selected = (await workbench.execute('select_component_evidence', { functionIndices: [9],
    evidenceIds: [observation.observationId], scope: 'Human-authored orchestration fixture.' })).result;
  const contract = { name: 'Attempt fixture', scope: 'Protocol testing only.',
    defaults: { walkingSpeed: 2, dashDistance: 60, cooldownTicks: 25, initialCooldownTicks: 10 }, stateDescription: 'Fixture timers.',
    rules: [{ description: 'Fixture behavior.', evidence: ['binary:func9'] }], limitations: ['No model discovery.'] };
  const candidate = { selectionId: selected.selectionId, source, contract, timerFields: { cooldown: 'cooldown', remaining: 'remaining' } };
  for (let index = 1; index <= 5; index++) {
    const result = (await workbench.execute('submit_component_candidate', { ...candidate, source: source + '\n// ' + index })).result;
    assert.equal(result.attempt, index);
    assert.equal(result.canRevise, index < 5);
  }
  await assert.rejects(workbench.execute('submit_component_candidate', candidate), /attempt limit/);
  const restored = await createInvestigationSession(bytes, session.snapshot());
  assert.equal(restored.recovery.attempts.length, 5);
  assert.equal(restored.recovery.protocol.id, protocol.id);
  await assert.rejects(createComponentWorkbench(restored).execute('submit_component_candidate', candidate), /attempt limit/);
  const report = { recoveryProtocol: protocol, session: restored.snapshot(), toolCalls: [] };
  assert.equal(recoveryStep(report).stage, 'conclude');
  const legacy = session.snapshot(); delete legacy.recovery.protocol;
  await assert.rejects(createInvestigationSession(bytes, legacy), /Invalid component development journal/);
  await assert.rejects(createInvestigationSession(bytes, session.snapshot(), { recoveryProtocol: createRecoveryProtocol({ model: 'muse-wonder-1.0' }) }), /protocol cannot change/);
});

test('the fourteenth remaining request reserves selection and the new protocol advertises five attempts', async () => {
  const protocol = createRecoveryProtocol();
  const report = { recoveryProtocol: protocol, requirements: RECOVERY_REQUIREMENTS,
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 },
    requests: [], turns: [], contextCompactions: [], estimatedCostUsd: 0, reservedCostUsd: 0,
    toolCalls: [{ name: 'inspect_wasm', ok: true }, { name: 'run_experiment', ok: true, requestAttempt: 1,
      result: { status: 'completed', experimentId: 'experiment-fixture', artifactRef: { id: 'a'.repeat(64) },
        initialEditDifference: { edits: [{ value: 40 }] }, frameCount: 8 } }],
    session: { staticEvidence: [{ kind: 'wat', functionIndex: 9 }], recovery: { protocol, attempts: [], selections: [] } } };
  const catalog = createToolDiscovery({ model: protocol.model, profile: 'recovery', recoveryProtocol: protocol });
  assert.match(catalog.definitions({ stage: 'develop' }).find(tool => tool.name === 'submit_component_candidate').description, /5 behavioral attempts/);
  const client = { countInputTokens: async () => 1000, respond: async request => {
    assert.deepEqual(request.tools.map(tool => tool.name), ['select_component_evidence']);
    assert.match(request.instructions, /5 behavioral development attempts/);
    return { id: 'reserve-fixture', status: 'completed', output: [], usage };
  } };
  await requestInvestigationTurn({ report, history: [], catalog, client, model: protocol.model, limits: protocol.limits,
    price: PRICES[protocol.model], turn: 18, requirements: RECOVERY_REQUIREMENTS, reasoningEffort: 'high',
    checkTime: () => {}, onProgress: () => {}, onUpdate: async () => {} });
  assert.equal(report.requests[0].recoveryStage, 'select');
});

test('the shared journal executor rejects same-turn evidence and relaxed gates before dispatch', async () => {
  const protocol = createRecoveryProtocol(), experimentId = 'experiment-fixture';
  const report = { model: protocol.model, recoveryProtocol: protocol, requirements: RECOVERY_REQUIREMENTS, limits: protocol.limits,
    toolCalls: [{ callId: 'experiment', name: 'run_experiment', ok: true, requestAttempt: 1,
      result: { status: 'completed', experimentId, artifactRef: { id: 'a'.repeat(64) }, initialEditDifference: { edits: [{ value: 40 }] }, frameCount: 8 } },
    { callId: 'selection', name: 'select_component_evidence', ok: true, requestAttempt: 1, result: { selectionId: 'selection-1' } }],
    session: { branches: [], checkpoints: [], staticEvidence: [{ kind: 'wat', functionIndex: 9 }], recovery: { protocol, attempts: [],
      selections: [{ id: 'selection-1', evidence: { functions: [{ id: 'binary:func9', functionIndex: 9 }], traces: [{ id: experimentId }] } }] } } };
  let dispatched = 0, persisted = 0;
  const execute = createJournalToolExecutor({ report, dispatch: async () => { dispatched++; }, onUpdate: async () => { persisted++; } });
  const result = await execute({ type: 'function_call', call_id: 'candidate', name: 'submit_component_candidate',
    arguments: JSON.stringify({ selectionId: 'selection-1', contract: { rules: [{ evidence: ['binary:func9', experimentId] }] } }) }, 2);
  assert.equal(result.entry.ok, false);
  assert.match(result.result.error, /later model turn/);
  assert.equal(dispatched, 0);
  assert.equal(persisted, 1);
  await assert.rejects(execute({ call_id: 'untrusted', name: 'inspect_wasm', arguments: '{}' }, NaN), /trusted model turn/);
  assert.throws(() => createJournalToolExecutor({ report: { ...report, requirements: {} }, dispatch: async () => {} }), /every recorded evidence requirement/);
});
