import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { evaluateRecoveryMotion as evaluateMotion } from '../src/evaluator/recovery-motion.mjs';
import { DEVELOPMENT_CASES, MOTION_REGRESSIONS } from '../src/evaluator/cases.mjs';
import { RECOVERY_DEVELOPMENT_CASES } from '../src/evaluator/recovery-cases.mjs';
import { developmentFeedback, developmentHistory } from '../src/agent/development-feedback.mjs';
import { createRecoveryProtocol, validateRecoveryProtocol } from '../src/agent/recovery-protocol.mjs';
import { createCartridgeTools } from '../src/agent/tools.mjs';
import { recoveryEvidenceHistory } from '../src/agent/recovery-context.mjs';
import { digest } from '../src/component/build.mjs';

const fixtures = JSON.parse(await readFile(new URL('fixtures/wonder-recovery-failures.json', import.meta.url)));
const timerFields = { cooldown: 'cooldown', remaining: 'remaining' };

test('new protocols record the expanded suite while historical v2 protocols still validate', () => {
  const modern = createRecoveryProtocol({ model: 'muse-wonder-1.0', maxCostUsd: 2.4 });
  assert.equal(modern.name, 'motion-recovery-v3');
  assert.equal(modern.development.caseCount, RECOVERY_DEVELOPMENT_CASES.length);
  assert.equal(modern.limits.maxCostUsd, 2.4);
  const legacy = createRecoveryProtocol({ name: 'motion-recovery-v2', model: modern.model });
  assert.equal(legacy.development, undefined);
  assert.deepEqual(validateRecoveryProtocol(legacy), legacy);
  const changed = structuredClone(modern); changed.development.caseCount = 13;
  assert.throws(() => validateRecoveryProtocol(changed), /controls changed/);
});

test('real historical failures receive distinct timing windows and direction-history counterexamples', async () => {
  const reports = [];
  for (const fixture of fixtures) {
    assert.equal(digest(fixture.source), fixture.sourceSha256);
    const report = await evaluateMotion(fixture.source, fixture.defaults, RECOVERY_DEVELOPMENT_CASES, { timerFields });
    assert.equal(report.passed, false, fixture.label);
    const feedback = developmentFeedback(report);
    assert.equal(feedback.observedCases, 32);
    assert.ok(feedback.firstFailures.length <= 6);
    assert.ok(Buffer.byteLength(JSON.stringify(feedback)) < 28000, 'Feedback fits the worker transport limit');
    reports.push(report);
  }
  const early = reports[0].results.find(result => result.name === 'startup-held').firstDivergence;
  assert.equal(early.tick, 10);
  assert.deepEqual(early.expected.events, []);
  assert.deepEqual(early.actual.events, ['dash-start']);
  assert.deepEqual(early.following[0].expected.events, ['dash-start']);
  assert.equal(early.initial.cooldown, 10);
  const missing = reports[1].results.find(result => result.name === 'startup-held').firstDivergence;
  assert.equal(missing.tick, 11);
  assert.deepEqual(missing.actual.events, []);
  const facing = reports[2];
  assert.ok(facing.results.slice(0, 13).every(result => result.passed), 'The old gate accepted this wrong rule');
  assert.ok(facing.results.some(result => result.name === 'direction-history-16' && !result.passed));
  const history = developmentHistory(reports.map((development, index) => ({ attempt: index + 1, development })));
  assert.equal(history[0].failures.find(result => result.name === 'startup-held').tick, 10);
  assert.equal(history[1].failures.find(result => result.name === 'startup-held').tick, 11);
});

test('the saved accepted controller passes the expanded public suite without changing acceptance', async () => {
  const source = await readFile(new URL('../assets/components/dashy-dango-dash/component.ts', import.meta.url), 'utf8');
  const { defaults } = JSON.parse(await readFile(new URL('../assets/components/dashy-dango-dash/contract.json', import.meta.url)));
  const report = await evaluateMotion(source, defaults, RECOVERY_DEVELOPMENT_CASES, { timerFields });
  assert.equal(report.passed, true);
  assert.equal(DEVELOPMENT_CASES.length + MOTION_REGRESSIONS.length, 13);
  const acceptance = await evaluateMotion(fixtures[0].source, fixtures[0].defaults, [DEVELOPMENT_CASES[2]], { suite: 'acceptance', timerFields });
  assert.equal(acceptance.results[0].firstDivergence.following, undefined);
  assert.equal(acceptance.results[0].firstDivergence.inputs, undefined);
});

test('v3 workbench uses the real expanded gate and retains bounded failures after compaction', async () => {
  const tools = createCartridgeTools(), protocol = createRecoveryProtocol({ model: 'muse-wonder-1.0' });
  try {
    await tools.open(undefined, protocol);
    await tools.run('inspect_function', { functionIndex: 9, startLine: 1, lineCount: 4 });
    const observed = (await tools.run('session_observe', { branchId: 'main', watches: [] })).result;
    const selection = (await tools.run('select_component_evidence', { functionIndices: [9], evidenceIds: [observed.observationId], scope: 'Local regression test only.' })).result;
    const fixture = fixtures[2];
    const result = (await tools.run('submit_component_candidate', { selectionId: selection.selectionId, source: fixture.source, timerFields,
      contract: { name: 'Historical failure fixture', scope: 'Local regression only.', defaults: fixture.defaults, stateDescription: 'Historical generated state.',
        rules: [{ description: 'Fixture supplied by test, not model discovery.', evidence: ['binary:func9'] }], limitations: ['Known incorrect implementation.'] } })).result;
    assert.equal(result.development.observedCases, 32);
    assert.equal(result.development.passed, false);
    await assert.rejects(tools.run('freeze_component', { candidateId: result.candidateId }), /development-passed/);
    const report = { question: 'Fixture', session: tools.sessionState, toolCalls: [{ name: 'submit_component_candidate', ok: true, result }] };
    report.session.experimentWorkbench ??= { programs: [] };
    const before = JSON.stringify(report);
    const text = recoveryEvidenceHistory(report)[1].content[0].text;
    const ledger = JSON.parse(text.slice(text.indexOf('\n') + 1));
    assert.deepEqual(ledger.observations[0].result.development, result.development);
    assert.ok(ledger.currentSession.developmentHistory[0].failures.length > 0);
    assert.equal(JSON.stringify(report), before);
  } finally { await tools.close(); }
});
