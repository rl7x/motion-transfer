import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { investigate } from '../agent/investigate.mjs';
import { saveInvestigationEvidence } from '../lab/investigation-evidence.mjs';
import { loadAcceptedComponent } from '../integration/accepted-component.mjs';

const tool = (turn, name, args, namespace) => ({ type: 'function_call', name, arguments: JSON.stringify(args),
  call_id: 'local-recovery-' + turn, status: 'completed', ...(namespace ? { namespace } : {}) });
const program = `
await sdk.static.inspectWasm({view:'overview',startLine:1,lineCount:5});
await sdk.static.inspectFunction({functionIndex:9,startLine:1,lineCount:12});
const prepared=await sdk.prepareCheckpoint({hypothesis:'Human-scripted local setup.',steps:[{buttons:1,frames:1,checkpoint:'start'},{buttons:0,frames:10,checkpoint:'ready'}],watches:[]});
const timer=prepared.targets.find(item=>item.name==='cooldown');
const trial=await sdk.runExperiment({hypothesis:'Human-scripted timer perturbation for pipeline verification.',checkpointId:prepared.checkpointId,interventions:[{targetId:timer.id,value:40,hypothesis:'Measure whether this typed edit changes activation under identical input.'}],steps:[{buttons:33,frames:8,checkpoint:'endpoint'}],observations:{channels:['motion','timers','events','memory','rendering'],watches:[],captures:[]}});
return {experimentId:trial.experimentId,control:trial.final.control.dx,intervention:trial.final.intervention.dx};`;

test('an injected agent inspects real code, reacts to an actual experiment and development failure, then freezes before acceptance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recovery-injected-agent-'));
  const goodSource = '// Local injected client fixture; not a Meta recovery.\n' + await readFile(new URL('../components/dashy-dango-dash/component.ts', import.meta.url), 'utf8');
  let turn = 0, experimentId, selectionId, candidateId, sawFailure = false;
  const results = request => request.input.filter(item => item.type === 'function_call_output').map(item => JSON.parse(item.output));
  const contract = evidenceId => ({ name: 'Local injected fixture', scope: 'Motion only; fixture for real host execution.',
    defaults: { walkingSpeed: 2, dashDistance: 60, cooldownTicks: 25, initialCooldownTicks: 10 }, stateDescription: 'Fixture state.',
    rules: [{ description: 'Human-supplied fixture behavior; not independent discovery.', evidence: [evidenceId] }], limitations: ['Injected responses are not real Meta inference.'] });
  const client = { countInputTokens: async () => 1000, respond: async request => {
    turn++; let output;
    assert.match(request.instructions, /Unfinished milestones/);
    const previous = results(request).at(-1);
    if (turn === 1) output = [tool(turn, 'run_experiment_program', { requestId: 'local-recovery-program', hypothesis: 'Local fixture program.', language: 'javascript', source: program })];
    if (turn === 2) {
      assert.equal(previous.status, 'completed'); assert.notEqual(previous.output.control, previous.output.intervention);
      experimentId = previous.output.experimentId;
      output = [tool(turn, 'record_finding', { claim: `Observed ${previous.output.control} vs ${previous.output.intervention}; choose this evidence for the local candidate.`, status: 'supported', confidence: 'medium', evidenceIds: [experimentId] })];
    }
    if (turn === 3) output = [{ type: 'tool_search_call', execution: 'client', call_id: 'local-recovery-search', status: 'completed', arguments: { namespace: 'recovery' } }];
    if (turn === 4) output = [tool(turn, 'select_component_evidence', { functionIndices: [9], evidenceIds: [experimentId], scope: 'Actual local tool execution with injected agent choices.' }, 'recovery')];
    if (turn === 5) {
      selectionId = previous.selectionId;
      output = [tool(turn, 'submit_component_candidate', { selectionId,
        source: 'export function init(){return {cooldown:0,remaining:0}};export function step(state){return {state,output:{ownsMotion:false,displacement:{x:0,y:0},events:[]}}}',
        contract: contract(experimentId), timerFields: { cooldown: 'cooldown', remaining: 'remaining' } }, 'recovery')];
    }
    if (turn === 6) {
      assert.equal(previous.development.passed, false); assert.equal(previous.acceptanceRun, false);
      sawFailure = previous.development.results.some(result => result.firstDivergence?.expected.timers);
      output = [tool(turn, 'submit_component_candidate', { selectionId, source: goodSource, contract: contract(experimentId), timerFields: { cooldown: 'cooldown', remaining: 'remaining' } }, 'recovery')];
    }
    if (turn === 7) { assert.equal(previous.development.passed, true); candidateId = previous.candidateId; output = [tool(turn, 'freeze_component', { candidateId }, 'recovery')]; }
    if (turn === 8) { assert.equal(previous.status, 'frozen-awaiting-acceptance'); output = [tool(turn, 'accept_component', { candidateId }, 'recovery')]; }
    if (turn === 9) { assert.equal(previous.passed, true); output = [{ type: 'message', content: [{ type: 'output_text', text: `Local injected recovery completed using ${experimentId}. Finite checks only; human fixture implementation, no real Meta inference.` }] }]; }
    return { id: 'local-recovery-response-' + turn, model: 'muse-spark-1.3', status: 'completed', output,
      usage: { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
  } };
  try {
    const report = await investigate({ client, model: 'muse-spark-1.3', toolDiscovery: 'client', limits: { maxModelCalls: 16, maxToolCalls: 24 },
      requirements: { codeInspection: true, branchComparison: true, followupDecision: true, componentAcceptance: true },
      onUpdate: report => saveInvestigationEvidence(directory, report.session, report) });
    assert.equal(report.status, 'completed'); assert.equal(turn, 9); assert.equal(sawFailure, true);
    const component = await loadAcceptedComponent(directory, report);
    assert.equal(component.source, goodSource); assert.equal(component.candidateId, candidateId);
    assert.equal(report.session.recovery.attempts.length, 2);
    assert.equal(report.reservedCostUsd, 0);
    assert.ok(report.session.staticEvidence.some(item => item.kind === 'wat' && item.functionIndex === 9));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
