import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { evidenceHistory } from '../agent/evidence.mjs';
import { createToolDiscovery, discoveryReplay } from '../agent/tool-discovery.mjs';
import { requestInvestigationTurn } from '../agent/investigation-request.mjs';
import { PRICES } from '../agent/accounting.mjs';
import { experimentFeedback } from '../agent/experiment-feedback.mjs';
import { inputDiagnostics, recoverySelectionHelp } from '../agent/input-diagnostics.mjs';

const recorded = async () => JSON.parse(await readFile(new URL('../lab/recordings/benchmark-recovery-one.json', import.meta.url)));
test('recorded context-limit failure compacts actual experiments once and keeps errors and identities', async () => {
  const { report } = await recorded(), original = JSON.stringify(report);
  const history = evidenceHistory(report, { includeDiscovery: false });
  assert.ok(Buffer.byteLength(JSON.stringify(history)) < 26000);
  const text = history[1].content[0].text, ledger = JSON.parse(text.slice(text.indexOf('\n') + 1));
  const program = ledger.observations.find(call => call.tool === 'run_experiment_program');
  assert.equal(program.result.experiments.length, 3);
  assert.equal(program.result.error, 'Experiment program output byte limit exceeded');
  assert.equal(program.result.activity[0].control.activeUpdates, 8);
  assert.ok(!Object.hasOwn(ledger.currentSession, 'managedExperiments'), 'Do not duplicate full experiment summaries');
  assert.ok(!Object.hasOwn(ledger.currentSession.experimentPrograms[0], 'source'));
  assert.ok(ledger.currentSession.staticEvidence.some(item => item.functionIndex === 11));
  assert.equal(JSON.stringify(report), original);
});

test('recovery preflight drops stale deferred context before generation without raising limits or retries', async () => {
  const { report } = await recorded();
  const catalog = createToolDiscovery({ mode: 'client', model: report.model, state: report.toolDiscovery, profile: 'recovery' });
  const history = [{ role: 'user', content: [{ type: 'input_text', text: report.question }] }];
  let preflights = 0, generations = 0;
  const priorCost = report.estimatedCostUsd;
  const client = {
    countInputTokens: async request => {
      preflights++;
      if (preflights === 1 || request.input.some(item => item.type === 'tool_search_output')) return 25000;
      assert.ok(JSON.stringify(request.input).includes('experiment-58fa2f3e-2295-4bd9-bbbe-f2336cceaa7d'));
      return 1000;
    },
    respond: async request => {
      generations++; assert.equal(request.max_output_tokens, 4000);
      assert.ok(request.tools.some(tool => tool.name === 'select_component_evidence'));
      assert.ok(!request.tools.some(tool => tool.type === 'tool_search'));
      return { id: 'injected-context-regression', status: 'completed', output: [], usage: { input_tokens: 1000, output_tokens: 10 } };
    },
  };
  await requestInvestigationTurn({ report, history, catalog, client, model: report.model,
    limits: report.limits, price: PRICES[report.model], turn: 7, requirements: report.requirements,
    reasoningEffort: 'high', signal: new AbortController().signal, checkTime: () => {}, onProgress: () => {}, onUpdate: async () => {} });
  assert.equal(preflights, 3); assert.equal(generations, 1); assert.equal(report.reservedCostUsd, 0);
  assert.ok(report.estimatedCostUsd > priorCost); assert.equal(report.limits.maxInputTokens, 20000);
  assert.equal(discoveryReplay(report).length, 0);
  assert.equal(report.toolDiscovery.exchanges.length, 4, 'Retain original search exchanges for audit');
  assert.throws(() => catalog.route({ name: 'read_memory', namespace: 'memory' }), /current recovery stage/);
  assert.equal(catalog.route({ name: 'select_component_evidence' }), 'select_component_evidence');
  assert.equal(report.contextCompactions.at(-1).reason, 'deferred-context-limit');
});

test('the second recorded failure compacts duplicate metadata while preserving code, evidence and selection', async () => {
  const { report } = JSON.parse(await readFile(new URL('../lab/recordings/benchmark-recovery-two.json', import.meta.url)));
  const before = JSON.stringify(report);
  const history = evidenceHistory(report, { includeDiscovery: false });
  assert.ok(Buffer.byteLength(JSON.stringify(history)) < 28000);
  const text = history[1].content[0].text, ledger = JSON.parse(text.slice(text.indexOf('\n') + 1));
  const original = report.toolCalls.filter(call => call.name === 'inspect_function' && call.ok).at(-1).result;
  const compact = ledger.observations.filter(call => call.tool === 'inspect_function' && call.ok).at(-1).result;
  assert.equal(compact.evidenceId, original.evidenceId);
  assert.deepEqual(compact.lines.map(line => line[1]), original.lines.map(line => line.text));
  assert.equal(compact.nextLine, original.nextLine); assert.equal(compact.indirectCallsResolved, false);
  const selection = ledger.observations.find(call => call.tool === 'select_component_evidence' && call.ok).result;
  assert.equal(selection.evidence.sha256, report.session.recovery.selections[0].evidence.sha256);
  assert.deepEqual(selection.evidence.traces.map(trace => trace.id), report.session.recovery.selections[0].evidence.traces.map(trace => trace.id));
  assert.equal(JSON.stringify(report), before);
});

test('actual malformed SDK and direct requests receive structural feedback without repaired inputs or answers', async () => {
  const { report } = JSON.parse(await readFile(new URL('../lab/recordings/benchmark-recovery-two.json', import.meta.url)));
  const program = report.toolCalls.find(call => call.name === 'run_experiment_program');
  const result = experimentFeedback(program.name, program.result, report.session);
  assert.equal(result.status, 'failed'); assert.equal(result.inputFeedback.path, 'tool.steps[0]');
  assert.deepEqual(result.inputFeedback.missingFields, ['checkpoint']);
  const trial = report.toolCalls.find(call => call.name === 'run_experiment' && !call.ok);
  assert.deepEqual(inputDiagnostics(trial.name, trial.args).missingFields, ['captures']);
  const selection = report.toolCalls.find(call => call.name === 'select_component_evidence' && !call.ok);
  const help = recoverySelectionHelp(selection.name, report.session, selection.error);
  assert.ok(help.availableExecutionIds.includes('experiment-c7153953-3293-4f3b-85e0-501ccd69441d'));
  assert.doesNotMatch(JSON.stringify(result.inputFeedback), /dashDistance|cooldownTicks|walkingSpeed/);
  assert.equal(inputDiagnostics('prepare_checkpoint', { requestId: 'fixture-key', hypothesis: 'local schema fixture',
    steps: [{ buttons: 1, frames: 1, checkpoint: 'label' }], watches: [] }), null);
});

test('the final recorded program preserves its array-shape diagnostics without another inference attempt', async () => {
  const { report } = JSON.parse(await readFile(new URL('../lab/recordings/benchmark-recovery-three.json', import.meta.url)));
  const program = report.toolCalls.find(call => call.name === 'run_experiment_program');
  const result = experimentFeedback(program.name, program.result, report.session);
  assert.equal(result.status, 'failed'); assert.equal(result.inputFeedback.path, 'tool.steps');
  assert.equal(result.inputFeedback.expectedType, 'array');
  assert.equal(result.error, 'Invalid array at tool.steps');
  assert.equal(report.session.recovery.attempts.length, 0);
  assert.equal(report.reservedCostUsd, 0);
});

test('compacting a trace page preserves measured inputs, motion, timers and watches while dropping repeated fingerprints', async () => {
  const { report } = await recorded();
  const artifact = report.session.experimentWorkbench.artifacts.find(item => item.payload.kind === 'experiment');
  const payload = artifact.payload;
  const result = { experimentId: payload.experimentId, artifactRef: { id: artifact.id },
    initialEditDifference: payload.initialEditDifference, frames: payload.trace.slice(0, 4),
    final: payload.final, totalFrames: payload.trace.length };
  report.toolCalls.push({ name: 'read_experiment', ok: true, result, requestAttempt: 8 });
  const original = JSON.stringify(report);
  const text = evidenceHistory(report, { includeDiscovery: false })[1].content[0].text;
  const compact = JSON.parse(text.slice(text.indexOf('\n') + 1)).observations.at(-1).result;
  assert.equal(compact.artifactRef.id, artifact.id);
  assert.deepEqual(compact.frames.map(frame => [frame.frame, frame.elapsedFrame, frame.buttons]),
    result.frames.map(frame => [frame.frame, frame.elapsedFrame, frame.buttons]));
  for (const branch of ['control', 'intervention']) {
    assert.deepEqual(compact.frames.map(frame => frame[branch].normalized), result.frames.map(frame => frame[branch].normalized));
    assert.deepEqual(compact.frames.map(frame => frame[branch].memory), result.frames.map(frame => frame[branch].memory));
    assert.deepEqual(compact.final[branch].motion.position, result.final[branch].motion.position);
  }
  assert.ok(JSON.stringify(compact).length < JSON.stringify(result).length * 0.75);
  assert.equal(JSON.stringify(report), original);
});
