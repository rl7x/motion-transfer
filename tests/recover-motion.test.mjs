import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { recoverMotion } from '../agent/recover-motion.mjs';
import { prepareMotionEvidence } from '../agent/motion-evidence.mjs';
import { compileMotion, digest } from '../component/build.mjs';
import { validateMotionCandidate } from '../component/contract.mjs';
import { writeMotionPackage } from '../component/package.mjs';

const evidence = {
  sha256: 'e'.repeat(64), cartridgeSha256: 'd'.repeat(64), humanAssistance: ['Test fixture'],
  functions: [{ id: 'binary:func9' }], traces: [],
};
const candidate = {
  source: `export const init = () => ({});
    export const step = (state, input, config) => ({state, output: {
      ownsMotion: false, displacement: {x: config.walkingSpeed, y: 0}, events: []
    }});`,
  contract: {
    name: 'Test fixture', scope: 'Unit test fixture, not a recovered component',
    defaults: { walkingSpeed: 2, dashDistance: 60, cooldownTicks: 25, initialCooldownTicks: 10 },
    stateDescription: 'Empty object', rules: [{ description: 'Test citation', evidence: ['binary:func9'] }],
    limitations: ['Not a real dash implementation'],
  },
};
const response = (number, value = candidate) => ({
  id: `response-${number}`, status: 'completed',
  usage: { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 100 }, output_tokens_details: { reasoning_tokens: 20 } },
  output: [
    { type: 'reasoning', encrypted_content: 'private-reasoning-fixture' },
    { type: 'function_call', name: 'submit_motion_candidate', arguments: JSON.stringify(value), status: 'completed' },
  ],
});
const verdict = async (source, suite, passed = true) => {
  const compiled = await compileMotion(source);
  return { passed, suite, sourceSha256: compiled.sourceSha256, javascriptSha256: compiled.javascriptSha256, results: [] };
};

test('recovery evidence comes from the binary and development execution only', async () => {
  const actual = await prepareMotionEvidence();
  assert.equal(actual.traces.length, 12);
  assert.deepEqual(actual.functions.map(fn => fn.functionIndex), [9, 23, 70, 102]);
  assert.ok(actual.functions.every(fn => fn.text.includes(`// func${fn.functionIndex}`)));
  assert.equal(actual.initial.cooldown, 10);
  assert.equal(actual.initial.position.x, 0);
  assert.doesNotMatch(JSON.stringify(actual), /acceptance-\d|MODEL_API_KEY|encrypted_content/);
  const { sha256, ...contents } = actual;
  assert.equal(sha256, digest(JSON.stringify(contents)));
});

test('candidate contracts reject extra status claims, invalid defaults, and unknown citations', () => {
  validateMotionCandidate(candidate, evidence);
  assert.throws(() => validateMotionCandidate({ ...candidate, passed: true }, evidence), /Invalid fields/);
  const unknown = structuredClone(candidate);
  unknown.contract.rules[0].evidence = ['invented-experiment'];
  assert.throws(() => validateMotionCandidate(unknown, evidence), /unknown evidence/);
  const invalid = structuredClone(candidate);
  invalid.contract.defaults.cooldownTicks = -1;
  assert.throws(() => validateMotionCandidate(invalid, evidence), /Invalid integer/);
});

test('bounded synthesis repairs using development feedback and freezes before separate acceptance', async () => {
  const requests = [], evaluated = [];
  let seeds = 0;
  const report = await recoverMotion({ evidence, apiKey: 'fake-secret', seed: () => { seeds++; return 123; },
    client: {
      countInputTokens: async () => 1000,
      respond: async request => { requests.push(request); return response(requests.length); },
    },
    evaluate: async (source, config, cases, options) => {
      evaluated.push({ suite: options.suite, cases: cases.length, source });
      return verdict(source, options.suite, evaluated.length !== 1);
    },
  });
  assert.equal(report.status, 'accepted');
  assert.equal(report.acceptedAttempt, 2);
  assert.deepEqual(evaluated.map(call => [call.suite, call.cases]), [['development', 12], ['development', 12], ['acceptance', 20]]);
  assert.equal(seeds, 1);
  assert.equal(report.reservedCostUsd, 0);
  assert.ok(Math.abs(report.estimatedCostUsd - 0.01124) < 1e-9);
  assert.match(requests[1].input[1].content[0].text, /development/);
  assert.doesNotMatch(JSON.stringify(requests[1]), /private-reasoning-fixture/);
  assert.doesNotMatch(JSON.stringify(report), /private-reasoning-fixture|fake-secret/);
});

test('preflight blocks spending and ambiguous billing is never retried', async () => {
  let calls = 0;
  const client = { countInputTokens: async () => 1000, respond: async () => { calls++; throw new Error('transport interrupted'); } };
  await assert.rejects(recoverMotion({ evidence, client, limits: { maxCostUsd: 0.01 } }), /cost budget/);
  assert.equal(calls, 0);
  await assert.rejects(recoverMotion({ evidence, client }), error => {
    assert.equal(error.report.requests[0].status, 'unsettled');
    assert.ok(error.report.reservedCostUsd > 0);
    return true;
  });
  assert.equal(calls, 1);
  await assert.rejects(recoverMotion({ evidence, client: { ...client, respond: async () => ({ ...response(1), usage: undefined }) } }), error => {
    assert.ok(error.report.reservedCostUsd > 0);
    return true;
  });
});

test('an acceptance failure is retained without starting a repair request', async () => {
  let calls = 0;
  await assert.rejects(recoverMotion({ evidence, seed: () => 321,
    client: { countInputTokens: async () => 1000, respond: async () => response(++calls) },
    evaluate: async (source, config, cases, options) => verdict(source, options.suite, options.suite === 'development'),
  }), error => {
    assert.match(error.message, /failed acceptance/);
    assert.equal(error.report.attempts[0].acceptance.passed, false);
    return true;
  });
  assert.equal(calls, 1);
});

test('packaging checks evaluated hashes and exports runnable JavaScript without the donor', async () => {
  const report = {
    status: 'accepted', acceptedAttempt: 1, evidenceSha256: evidence.sha256, cartridgeSha256: evidence.cartridgeSha256,
    model: 'mock-model', humanAssistance: ['Test fixture'], estimatedCostUsd: 0, acceptanceSeed: 123,
    attempts: [{ attempt: 1, sourceSha256: digest(candidate.source), responseId: 'mock', candidate,
      development: await verdict(candidate.source, 'development'), acceptance: await verdict(candidate.source, 'acceptance'),
    }],
  };
  const directory = await mkdtemp(join(tmpdir(), 'motion-package-test-'));
  try {
    const changed = structuredClone(report);
    changed.attempts[0].candidate.source += '\n// changed after evaluation';
    await assert.rejects(writeMotionPackage(join(directory, 'changed'), changed, evidence), /does not match/);
    const destination = join(directory, 'export');
    await writeMotionPackage(destination, report, evidence);
    const code = `import {init,step} from ${JSON.stringify(pathToFileURL(join(destination, 'component.js')).href)};
      const config={walkingSpeed:2}; console.log(JSON.stringify(step(init(config),{buttons:32,sourceBodyWidth:8},config).output));`;
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], {
      cwd: destination, env: { PATH: process.env.PATH ?? '' },
    });
    assert.deepEqual(JSON.parse(stdout).displacement, { x: 2, y: 0 });
    const files = await readdir(destination);
    assert.ok(!files.includes('cart.wasm') && !files.includes('node_modules'));
    const provenance = JSON.parse(await readFile(join(destination, 'provenance.json'), 'utf8'));
    assert.equal(provenance.sourceSha256, digest(candidate.source));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
