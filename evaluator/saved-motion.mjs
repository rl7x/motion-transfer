import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileMotion, digest } from '../component/build.mjs';
import { evaluateMotion } from './motion.mjs';
import { DEVELOPMENT_CASES, MOTION_REGRESSIONS, acceptanceCases } from './cases.mjs';
import { PRICES, tokenCost } from '../agent/accounting.mjs';

const savedDirectory = fileURLToPath(new URL('../components/dashy-dango-dash/', import.meta.url));

export async function verifySavedMotion(directory = savedDirectory) {
  const json = async name => JSON.parse(await readFile(join(directory, name), 'utf8'));
  const source = await readFile(join(directory, 'component.ts'), 'utf8');
  const javascript = await readFile(join(directory, 'component.js'), 'utf8');
  const provenance = await json('provenance.json'), contract = await json('contract.json');
  const evidence = await json('evidence.json'), history = await json('recovery-history.json');
  const compiled = await compileMotion(source);
  assert.equal(compiled.sourceSha256, provenance.sourceSha256, 'Saved source hash mismatch');
  assert.equal(digest(javascript), provenance.javascriptSha256, 'Saved JavaScript hash mismatch');
  assert.equal(compiled.javascriptSha256, provenance.javascriptSha256, 'Rebuilt JavaScript hash mismatch');
  assert.equal(digest(JSON.stringify({ source: compiled.sourceSha256, javascript: compiled.javascriptSha256, contract })), provenance.id, 'Component identity mismatch');
  const { sha256, ...contents } = evidence;
  assert.equal(digest(JSON.stringify(contents)), sha256, 'Evidence content hash mismatch');
  assert.equal(sha256, provenance.evidenceSha256, 'Evidence provenance mismatch');
  const cost = history.requests.reduce((sum, request) => sum + tokenCost(request.usage, PRICES[request.model ?? history.model]), 0);
  assert.ok(Math.abs(cost - provenance.estimatedCostUsd) < 1e-9 && cost <= history.limits.maxCostUsd, 'Recovery cost chain mismatch');
  const acceptance = await json('evaluation-acceptance.json'), regressions = await json('evaluation-regressions.json');
  for (const seed of [acceptance.seed, regressions.previousAcceptanceSeed]) {
    assert.ok(Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff, 'Evaluation seed is missing or invalid');
  }
  assert.notEqual(acceptance.seed, regressions.previousAcceptanceSeed, 'Acceptance reused the prior seed');
  assert.equal(history.acceptanceSeed, acceptance.seed, 'Acceptance history seed mismatch');
  assert.equal(history.repairExtension.priorAcceptanceSeed, regressions.previousAcceptanceSeed, 'Regression history seed mismatch');
  assert.equal(history.status, 'accepted', 'Recovery history is not accepted');
  const accepted = history.attempts.find(attempt => attempt.attempt === history.acceptedAttempt);
  assert.equal(digest(accepted.candidate.source), compiled.sourceSha256, 'Accepted history source mismatch');
  for (const name of ['evaluation-development.json', 'evaluation-regressions.json', 'evaluation-acceptance.json']) {
    const verdict = await json(name);
    assert.equal(verdict.sourceSha256, compiled.sourceSha256, 'Evaluation source mismatch');
    assert.equal(verdict.javascriptSha256, compiled.javascriptSha256, 'Evaluation build mismatch');
    assert.equal(verdict.passed, true, 'Saved verdict failed');
  }
  const suites = [
    ['development', DEVELOPMENT_CASES],
    ['regression-from-prior-acceptance', [...MOTION_REGRESSIONS, ...acceptanceCases(regressions.previousAcceptanceSeed).map(trace => ({ ...trace, name: `previous-${trace.name}` }))]],
    ['frozen-acceptance-regression', acceptanceCases(acceptance.seed)],
  ];
  const results = [];
  for (const [suite, cases] of suites) {
    const result = await evaluateMotion(source, contract.defaults, cases, { suite });
    assert.equal(result.passed, true, `Saved component diverged in ${suite}`);
    results.push(result);
  }
  return {
    status: 'passed', mode: 'frozen-suite-regression', metaCalled: false,
    id: provenance.id, sourceSha256: compiled.sourceSha256,
    cases: results.reduce((sum, suite) => sum + suite.results.length, 0),
    ticks: results.reduce((sum, suite) => sum + suite.results.reduce((count, trace) => count + trace.ticks, 0), 0),
    maxPositionError: Math.max(...results.flatMap(suite => suite.results.map(trace => trace.maxPositionError))),
    suites: results,
  };
}
