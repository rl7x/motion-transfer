import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { digest } from '../component/build.mjs';
import { acceptanceCases } from './cases.mjs';
import { RECOVERY_DEVELOPMENT_CASES } from './recovery-cases.mjs';
import { verifyExhaustiveMotion } from './exhaustive.mjs';
import { getDonorStateSpace, measureTransitionCoverage } from './state-space.mjs';

const root = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, root));
const json = async path => JSON.parse(await read(path));
const defaultTimerFields = { cooldown: 'cooldown', remaining: 'remaining' };

export async function loadExhaustiveCandidates() {
  const candidates = [];
  const recoveries = 'assets/integration/recordings/recoveries/';
  for (const directory of (await readdir(new URL(recoveries, root), { withFileTypes: true })).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = `${recoveries}${directory.name}/project.json`, project = await json(path);
    const file = name => typeof project.files[name] === 'string' ? project.files[name] : project.files[name].text ?? project.files[name].content;
    const contract = JSON.parse(file('component/contract.json'));
    candidates.push({ id: 'first-session', origin: path, accepted: true, source: file('component/component.ts'),
      defaults: contract.defaults, timerFields: defaultTimerFields });
  }
  for (const [version, trials] of [['v3', [1, 2, 3]], ['v4', [1]], ['v5', [1, 2, 3]]]) {
    for (const trial of trials) {
      const path = `assets/benchmark/wonder-harness-${version}/report-${trial}.json.gz`;
      const { session: { recovery } } = JSON.parse(gunzipSync(await read(path)));
      for (const attempt of recovery.attempts) {
        candidates.push({ id: `${version}-session-${trial}-attempt-${attempt.attempt}`, origin: path,
          accepted: attempt.attempt === recovery.acceptedAttempt && attempt.acceptance?.passed === true,
          source: attempt.candidate.source, defaults: attempt.candidate.contract.defaults, timerFields: attempt.timerFields });
      }
    }
  }
  const fixturePath = 'tests/fixtures/wonder-recovery-failures.json';
  for (const fixture of await json(fixturePath)) {
    assert.equal(digest(fixture.source), fixture.sourceSha256, fixture.label);
    candidates.push({ id: `fixture-${fixture.label}`, origin: fixturePath, accepted: false,
      source: fixture.source, defaults: fixture.defaults, timerFields: fixture.timerFields });
  }
  const path = 'assets/components/dashy-dango-dash/component.ts';
  candidates.push({ id: 'older-spark-1bc4250c', origin: path, accepted: false, source: String(await read(path)),
    defaults: (await json('assets/components/dashy-dango-dash/contract.json')).defaults, timerFields: defaultTimerFields });
  assert.equal(new Set(candidates.map(candidate => candidate.id)).size, candidates.length, 'Candidate identities must be unique');
  return candidates;
}

export const EXHAUSTIVE_LIMITATIONS = Object.freeze([
  'The four state fields were chosen by humans and checked empirically.',
  'Covers default configuration and body width 8 only.',
  'Combat is out of scope.',
  'Float behavior beyond the tested positions is unverified.',
]);

export async function buildExhaustiveEvidence({ onCandidate = () => {} } = {}) {
  const space = await getDonorStateSpace();
  const candidates = await loadExhaustiveCandidates();
  const results = [];
  for (const candidate of candidates) {
    const result = await verifyExhaustiveMotion(candidate.source, candidate.defaults, { timerFields: candidate.timerFields, space });
    results.push({ id: candidate.id, origin: candidate.origin, accepted: candidate.accepted, ...result });
    onCandidate(results.at(-1));
  }
  const inputs = [
    'src/evaluator/state-space.mjs', 'src/evaluator/exhaustive.mjs', 'src/evaluator/exhaustive-worker.mjs',
    'src/evaluator/exhaustive-candidate.mjs', 'src/evaluator/exhaustive-evidence.mjs',
    'src/evaluator/recovery-motion.mjs', 'src/evaluator/recovery-cases.mjs', 'src/evaluator/cases.mjs', 'src/evaluator/dashy-dango.mjs',
    'src/component/build.mjs', 'src/component/run.mjs', 'src/component/worker.mjs',
    'src/runtime/replay.mjs', 'src/runtime/memory.mjs', 'src/runtime/investigation-session.mjs',
    'src/runtime/donor-observation.mjs', 'src/runtime/wasm4-core.mjs', 'src/agent/target.mjs',
    'assets/targets/dashy-dango/cart.wasm', 'assets/components/dashy-dango-dash/contract.json', 'package-lock.json',
    ...candidates.map(candidate => candidate.origin),
  ];
  const hashes = {};
  for (const path of [...new Set(inputs)].sort()) hashes[path] = digest(await read(path));
  const acceptanceSeed = 1348471918;
  return { schemaVersion: 1, claim: 'matches the compiled binary on every reachable dash state and button combination (275 states, 17,600 transitions).',
    limitations: EXHAUSTIVE_LIMITATIONS, modelRequests: 0, inputs: hashes,
    donor: { cartridgeSha256: space.cartridgeSha256, ...space.verification },
    coverage: { developmentCases: RECOVERY_DEVELOPMENT_CASES.length, acceptanceCases: 20, acceptanceSeed,
      development: measureTransitionCoverage(space, RECOVERY_DEVELOPMENT_CASES),
      acceptance: measureTransitionCoverage(space, acceptanceCases(acceptanceSeed, 20)),
      combined: measureTransitionCoverage(space, [...RECOVERY_DEVELOPMENT_CASES, ...acceptanceCases(acceptanceSeed, 20)]) },
    candidates: results };
}
