import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { evidenceHistory } from '../agent/evidence.mjs';
import { createToolDiscovery, discoveryReplay } from '../agent/tool-discovery.mjs';
import { requestInvestigationTurn } from '../agent/investigation-request.mjs';
import { PRICES } from '../agent/accounting.mjs';

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
      assert.ok(request.tools.some(tool => tool.name === 'submit_component_candidate'));
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
  assert.throws(() => catalog.route({ name: 'read_memory', namespace: 'memory' }), /unloaded/);
  assert.equal(catalog.route({ name: 'submit_component_candidate' }), 'submit_component_candidate');
  assert.equal(report.contextCompactions.at(-1).reason, 'deferred-context-limit');
});
