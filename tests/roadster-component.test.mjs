import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acceptedRecoveryFixture } from './helpers/recovery-fixture.mjs';
import { roadsterAdapterFixture } from './helpers/roadster-adapter.mjs';
import { loadAcceptedComponent } from '../src/integration/accepted-component.mjs';
import { compileAdapter } from '../src/transfer/adapter.mjs';
import { evaluateRoadsterAdapter } from '../src/evaluator/roadster.mjs';
import { buildRoadsterFrame } from '../src/roadster/build.mjs';
import { generateRoadsterTransfer } from '../src/agent/transfer-roadster.mjs';
import { loadSavedRoadster, validateRoadsterArtifact } from '../src/roadster/saved.mjs';
import { ROADSTER_INTENT } from '../src/roadster/port.mjs';

test('Roadster compilation, evaluation, frame and portable export use the exact accepted component', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'roadster-component-'));
  try {
    const componentRef = await loadAcceptedComponent(directory, await acceptedRecoveryFixture(directory));
    const saved = await loadSavedRoadster();
    assert.notEqual(componentRef.provenance.id, saved.componentId);
    const source = roadsterAdapterFixture();
    const compiled = await compileAdapter(source, { componentRef });
    const conformance = await evaluateRoadsterAdapter(source, ROADSTER_INTENT, { componentRef });
    const frame = await buildRoadsterFrame({ source, componentRef });
    for (const result of [compiled, conformance, frame]) assert.equal(result.componentId, componentRef.provenance.id);
    assert.equal(conformance.passed, true, JSON.stringify(conformance.results));
    assert.ok(frame.html.includes(componentRef.provenance.id));
    assert.ok(!frame.html.includes(saved.componentId));
    assert.match(frame.html, /Copyright.*samX500/);
    let calls = 0;
    const client = { countInputTokens: async () => 1000, respond: async () => {
      calls++;
      return { id: 'fixture', status: 'completed', usage: { input_tokens: 1000, output_tokens: 200 },
        output: [{ type: 'function_call', name: 'submit_roadster_adapter', arguments: JSON.stringify({ status: 'supported',
          source, intent: ROADSTER_INTENT, summary: 'Human-scripted candidate binding fixture' }) }] };
    } };
    const parent = { id: '0'.repeat(64), componentId: componentRef.provenance.id, intent: ROADSTER_INTENT, files: {} };
    const result = await generateRoadsterTransfer({ parent, componentRef, prompt: 'Use the default mapping.', client,
      verifyBrowser: async (_source, _intent, options) => {
        assert.equal(options.componentRef.provenance.id, componentRef.provenance.id);
        return { passed: true, componentId: componentRef.provenance.id, fixture: true };
      } });
    assert.equal(result.metadata.componentId, componentRef.provenance.id);
    assert.equal(result.metadata.componentRef.kind, 'accepted');
    assert.equal(result.metadata.component.source, componentRef.source);
    assert.equal(result.metadata.component.javascript, componentRef.javascript);
    assert.equal(result.metadata.component.sessionId, componentRef.sessionId);
    await assert.rejects(generateRoadsterTransfer({ parent: saved, componentRef, prompt: 'Shorter.', client }), /identities differ/);
    assert.equal(calls, 1, 'Mixed identities must fail before inference');
    const broken = structuredClone(componentRef);
    broken.files['evaluation-acceptance.json'] = JSON.stringify({ passed: false });
    await assert.rejects(compileAdapter(source, { componentRef: broken }), /publication file differs/);
    for (const [field, value] of [['candidateId', 'a'.repeat(64)], ['sessionId', '00000000-0000-0000-0000-000000000000'],
      ['frozenCandidateId', 'b'.repeat(64)], ['timerFields', { cooldown: 'other', remaining: 'remaining' }]]) {
      const mixed = structuredClone(componentRef); mixed[field] = value;
      await assert.rejects(compileAdapter(source, { componentRef: mixed }), /identity|mapping differs/,
        'A portable reference must reject a mixed ' + field);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('immutable saved playback stays readable while a new publication must match the current host', async () => {
  const before = await readFile(new URL('../assets/transfers/roadster/current.json', import.meta.url), 'utf8');
  const saved = await loadSavedRoadster();
  await validateRoadsterArtifact(saved);
  await assert.rejects(validateRoadsterArtifact(saved, { currentEnvironment: true }), /stale/);
  const broken = structuredClone(saved);
  broken.files['frame.html'] += '\n<!-- modified -->';
  await assert.rejects(validateRoadsterArtifact(broken));
  assert.equal(await readFile(new URL('../assets/transfers/roadster/current.json', import.meta.url), 'utf8'), before);
});

test('Roadster unsupported explanations and no-op requests preserve their parent', async () => {
  const source = roadsterAdapterFixture(), parent = { id: '0'.repeat(64), intent: ROADSTER_INTENT, files: { 'adapter.ts': source } };
  const client = submission => ({ countInputTokens: async () => 1000, respond: async () => ({ id: 'fixture', status: 'completed',
    usage: { input_tokens: 1000, output_tokens: 100 }, output: [{ type: 'function_call', name: 'submit_roadster_adapter',
      arguments: JSON.stringify(submission) }] }) });
  await assert.rejects(generateRoadsterTransfer({ parent, prompt: 'One dash per flight.', client: client({ status: 'unsupported', source: '',
    intent: ROADSTER_INTENT, summary: 'One dash per flight is not supported; change distance, direction or activation.' }) }), error => {
    assert.match(error.message, /One dash per flight is not supported/);
    assert.equal(error.report.status, 'unsupported');
    assert.equal(error.report.reservedCostUsd, 0);
    return true;
  });
  await assert.rejects(generateRoadsterTransfer({ parent, prompt: 'Keep it the same.', client: client({ status: 'supported', source,
    intent: ROADSTER_INTENT, summary: 'No change' }) }), /does not change/);
  assert.equal(parent.files['adapter.ts'], source);
});
