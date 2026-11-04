import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { investigate } from '../src/agent/investigate.mjs';
import { createRecoveryProtocol } from '../src/agent/recovery-protocol.mjs';
import { finishRecoveryVerification } from '../src/agent/recovery-verification.mjs';

const program = `
await sdk.static.inspectWasm({view:'overview',startLine:1,lineCount:5});
await sdk.static.inspectFunction({functionIndex:9,startLine:1,lineCount:12});
const prepared=await sdk.prepareCheckpoint({hypothesis:'Local verification fixture.',steps:[{buttons:1,frames:1,checkpoint:'start'},{buttons:0,frames:10,checkpoint:'ready'}],watches:[]});
const timer=prepared.targets.find(item=>item.name==='cooldown');
const trial=await sdk.runExperiment({hypothesis:'Local controlled timer experiment.',checkpointId:prepared.checkpointId,interventions:[{targetId:timer.id,value:40,hypothesis:'Measure activation under identical input.'}],steps:[{buttons:33,frames:8,checkpoint:'end'}],observations:{channels:['motion','timers','events'],watches:[],captures:[]}});
return {experimentId:trial.experimentId};`;

const outputs = request => request.input.flatMap(item => {
  if (item.type === 'function_call_output') return [JSON.parse(item.output)];
  const text = item.content?.find(block => block.text?.includes('ledger contains actual'))?.text;
  return text ? JSON.parse(text.slice(text.indexOf('\n') + 1)).observations.filter(call => call.ok).map(call => call.result) : [];
});

test('v4 freezes and accepts through the real worker without another model request', async () => {
  const protocol = createRecoveryProtocol({ model: 'muse-wonder-1.0' });
  assert.equal(protocol.limits.maxCostUsd, 8);
  assert.equal(createRecoveryProtocol({ name: 'motion-recovery-v3', model: protocol.model }).limits.maxCostUsd, 6);
  assert.throws(() => createRecoveryProtocol({ name: 'motion-recovery-v3', model: protocol.model, maxCostUsd: 8 }), /ceiling/);
  const source = await readFile(new URL('../assets/components/dashy-dango-dash/component.ts', import.meta.url), 'utf8');
  let turn = 0, experimentId;
  const client = { countInputTokens: async () => 1000, respond: async request => {
    turn++;
    assert.ok(turn <= 3, 'Passing development must not require another billed request');
    const previous = outputs(request).at(-1);
    let name, args;
    if (turn === 1) {
      name = 'run_experiment_program'; args = { requestId: 'host-verifier-fixture', hypothesis: 'Local protocol verification.', language: 'javascript', source: program };
    } else if (turn === 2) {
      experimentId = previous.output.experimentId;
      name = 'select_component_evidence'; args = { functionIndices: [9], evidenceIds: [experimentId], scope: 'Use the observed intervention for the fixture.' };
    } else {
      name = 'submit_component_candidate'; args = { selectionId: previous.selectionId, source,
        timerFields: { cooldown: 'cooldown', remaining: 'remaining' }, contract: {
          name: 'Local injected fixture', scope: 'No independent model recovery.',
          defaults: { walkingSpeed: 2, dashDistance: 60, cooldownTicks: 25, initialCooldownTicks: 10 },
          stateDescription: 'Fixture timers.', limitations: ['Human-supplied test controller.'],
          rules: [{ description: 'Local verification only.', evidence: ['binary:func9', experimentId] }],
        } };
    }
    return { id: 'fixture-' + turn, status: 'completed', usage: { input_tokens: 1000, output_tokens: 100 },
      output: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: 'fixture-' + turn, status: 'completed' }] };
  } };
  const report = await investigate({ client, recoveryProtocol: protocol });
  assert.equal(turn, 3);
  assert.equal(report.status, 'completed');
  assert.equal(report.completion.actor, 'host-verifier');
  assert.equal(report.conclusionVerified, false);
  assert.match(report.conclusion, /32 development checks and 20 separately generated acceptance/);
  assert.deepEqual(report.toolCalls.slice(-2).map(call => [call.name, call.actor, call.ok]),
    [['freeze_component', 'host-verifier', true], ['accept_component', 'host-verifier', true]]);
  assert.equal(report.session.recovery.acceptedAttempt, 1);
  assert.equal(report.reservedCostUsd, 0);
});

test('host verification stops on acceptance failure and never changes or retries the frozen candidate', async () => {
  const protocol = createRecoveryProtocol(), candidateId = 'a'.repeat(64);
  const recovery = { protocol, selections: [], attempts: [{ candidateId, development: { passed: true } }] };
  const report = { recoveryProtocol: protocol, session: { recovery }, toolCalls: [] };
  const calls = [];
  const runToolCall = async (call, turn, options) => {
    assert.equal(options.actor, 'host-verifier'); calls.push(call.name);
    if (call.name === 'freeze_component') recovery.frozenCandidateId = candidateId;
    else recovery.acceptanceStarted = true;
    return { entry: { ok: true }, result: { passed: false } };
  };
  await assert.rejects(finishRecoveryVerification({ report, catalog: { definitions() {} }, runToolCall, turn: 3, onUpdate: async () => {} }), /failed separate acceptance/);
  assert.deepEqual(calls, ['freeze_component', 'accept_component']);
  assert.equal(await finishRecoveryVerification({ report, catalog: {}, runToolCall, turn: 3 }), false);
  assert.equal(recovery.attempts.length, 1);
});
