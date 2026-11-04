import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { applyPatches } from '../src/auto-port/patches.mjs';
import { acceptanceCases } from '../src/evaluator/cases.mjs';
import { footageSummary } from '../src/footage/summary.mjs';
import { evaluateMotion } from '../src/evaluator/motion.mjs';
import { verifyWonderHarness } from './verify-wonder-harness.mjs';
import { verifyExhaustiveEvidence } from './verify-exhaustive.mjs';

// Recomputes every headline number from committed files. Makes no model request, and needs no gitignored reports.
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const near = (left, right, label) => assert.ok(Math.abs(left - right) < 1e-6, `${label}: ${left} is not ${right}`);
const readme = await readFile('README.md', 'utf8');
const lines = [];

const recovery = await json('assets/evidence/recovery.json');
const final = recovery.attempts[recovery.attempts.length - 1];
assert.equal(Object.values(recovery.stages).reduce((sum, count) => sum + count, 0), recovery.requests);
assert.deepEqual(recovery.attempts.map(attempt => attempt.passed), [0, 11, 13]);
assert.ok(recovery.attempts.slice(0, -1).every(attempt => attempt.firstFailure), 'Failed attempts keep their first divergence');
assert.equal(final.passed, final.total);
assert.equal(final.acceptance.passed, final.acceptance.total);
assert.equal(final.candidateId, recovery.frozenCandidateId);
lines.push(`Recovery: ${recovery.attempts.length} attempts, ${final.passed}/${final.total} development, ${final.acceptance.passed}/${final.acceptance.total} acceptance, ${recovery.requests} requests, $${recovery.estimatedCostUsd}`);

const live = await json('assets/evidence/live-mechanics.json');
const positive = live.tasks.filter(task => task.kind === 'positive'), negative = live.tasks.filter(task => task.kind === 'negative');
assert.equal(positive.filter(task => task.passed).length, live.positive.passed);
assert.equal(positive.length, live.positive.total);
assert.equal(negative.filter(task => task.passed).length, live.negative.correct);
near(live.tasks.reduce((sum, task) => sum + (task.job?.estimatedCostUsd ?? 0), 0), live.estimatedCostUsd, 'Live task cost');
assert.ok(readme.includes(`${live.positive.passed}/${live.positive.total} positive tasks passed`), 'README must state the live task result');
lines.push(`Live tasks: ${live.positive.passed}/${live.positive.total} positive, ${live.negative.correct}/${live.negative.total} negative, $${live.estimatedCostUsd.toFixed(6)}`);

const ports = await json('assets/evidence/auto-port.json');
const manifest = await json('src/benchmark/auto-port-tasks.json');
const lock = await json('assets/auto-port/lock.json');
assert.deepEqual(ports.games.map(game => game.id), manifest.games.map(game => game.id), 'Every frozen game is reported, in order');
for (const file of lock.files) assert.equal(digest(await readFile(`assets/auto-port/${file.local}`)), file.sha256, file.local);
for (const [path, hash] of Object.entries(manifest.sources)) assert.equal(digest(await readFile(path)), hash, `${path} changed after the freeze`);
for (const game of ports.games) {
  const declared = manifest.games.find(entry => entry.id === game.id);
  assert.equal(game.status === 'excluded', declared.status === 'excluded', game.id);
  if (game.status === 'excluded') continue;
  near(game.attempts.reduce((sum, attempt) => sum + attempt.estimatedCostUsd, 0), game.estimatedCostUsd, `${game.id} cost`);
  const last = game.attempts[game.attempts.length - 1];
  const allPassed = last.checks.length > 0 && last.checks.every(check => check.passed);
  assert.equal(game.status === 'passed', allPassed, `${game.id} status must follow its recorded checks`);
  if (game.status !== 'passed') continue;
  assert.equal(last.checks.length, 7, `${game.id} ran every check`);
  applyPatches(await readFile(`assets/auto-port/games/${game.id}/${declared.core}`, 'utf8'), last.patches);
}
const eligible = ports.games.filter(game => game.status !== 'excluded'), passed = eligible.filter(game => game.status === 'passed');
const responses = eligible.reduce((sum, game) => sum + game.attempts.length, 0), cost = eligible.reduce((sum, game) => sum + game.estimatedCostUsd, 0);
assert.ok(readme.includes(`${passed.length} of ${eligible.length} eligible games`), 'README must state the port result');
lines.push(`Auto-port: ${passed.length} of ${eligible.length} eligible games, ${ports.games.length - eligible.length} excluded, ${responses} Spark responses, $${cost.toFixed(4)}`);

const open = await json('assets/evidence/open-port.json');
const openPlan = await json('src/benchmark/open-port-tasks.json');
assert.deepEqual(open.games.map(game => game.id), openPlan.games.map(game => game.id), 'Every frozen game is reported, in order');
assert.deepEqual(openPlan.games, manifest.games, 'Both models face the same games');
for (const [path, hash] of Object.entries(manifest.sources)) assert.equal(openPlan.sources[path], hash, `${path} differs between the two campaigns`);
for (const game of open.games) {
  if (game.status === 'excluded') continue;
  near(game.attempts.reduce((sum, attempt) => sum + attempt.estimatedCostUsd, 0), game.estimatedCostUsd, `${game.id} open cost`);
  const last = game.attempts[game.attempts.length - 1];
  assert.equal(game.status === 'passed', last.checks.length === 7 && last.checks.every(check => check.passed), `${game.id} status must follow its recorded checks`);
}
const openEligible = open.games.filter(game => game.status !== 'excluded'), openPassed = openEligible.filter(game => game.status === 'passed');
const openCost = openEligible.reduce((sum, game) => sum + game.estimatedCostUsd, 0);
assert.ok(readme.includes(`Muse Spark Open passed ${openPassed.length} of ${openEligible.length}`), 'README must state the open-weight result');
lines.push(`Open-weight port: ${openPassed.length} of ${openEligible.length} eligible games on ${open.model}, $${openCost.toFixed(4)}`);

// The exam runs again here, from the committed controller and seed, against the real cartridge.
const footage = await json('assets/evidence/footage-recovery.json');
const examScore = async ({ source, config, seed, total }) => {
  const cases = acceptanceCases(seed, total);
  let passedTraces = 0;
  for (let offset = 0; offset < cases.length; offset += 20) {
    const { results } = await evaluateMotion(source, config, cases.slice(offset, offset + 20), { suite: 'fidelity-comparison' });
    passedTraces += results.filter(result => result.passed).length;
  }
  return passedTraces;
};
assert.equal(await examScore({ ...footage.latest.controller, ...footage.latest.exam }), footage.latest.exam.fromFootage, 'Footage exam score');
assert.equal(footage.latest.exam.savedRecovery, footage.latest.exam.total, 'Saved recovery exam score');
const repeatPlans = [await json('src/benchmark/footage-repeat-tasks.json'), await json('src/benchmark/footage-repeat-v2-tasks.json')];
footage.repeats.forEach((run, index) => {
  assert.equal(run.name, repeatPlans[index].name, 'Repeat runs match their frozen plans');
  assert.equal(run.sessions.length, repeatPlans[index].sessions, 'Every planned session is reported');
  for (const session of run.sessions) assert.ok(session.exam || session.failure, `Session ${session.session} needs a score or a reason`);
});
assert.deepEqual(await json('assets/evidence/footage-summary.json'), footageSummary(footage), 'The site summary must match the full record');
const finalSessions = footage.repeats[1].sessions, accepted = finalSessions.filter(session => session.exam);
assert.ok(accepted.every(session => session.exam.passed === session.exam.total), 'The README says every accepted session scored in full');
assert.ok(readme.includes(`${accepted.length} of ${finalSessions.length} fresh footage sessions scored ${footage.latest.exam.total}/${footage.latest.exam.total}`), 'README must state the footage result');
const footagePlan = await json('src/benchmark/footage-tasks.json');
assert.equal(footagePlan.name, footage.latest.name, 'The evidence must come from the frozen plan');
lines.push(`Footage: ${accepted.length} of ${finalSessions.length} final sessions accepted, all scoring ${footage.latest.exam.total}/${footage.latest.exam.total}; ${footage.latest.bursts.found} of ${footage.latest.bursts.real} bursts measured, worst step error ${footage.latest.tracking.all.worst} px`);

const outside = await json('assets/evidence/port-example.json');
const outsideLock = await json('assets/port-example/lock.json');
for (const file of outsideLock.files) assert.equal(digest(await readFile(`assets/port-example/${file.local}`)), file.sha256, file.local);
const platformer = await readFile('assets/port-example/tiny-platformer/platformer.js', 'utf8');
for (const run of outside.runs) if (run.sweep) applyPatches(platformer, run.patches);
const [first, finalPort] = [outside.runs[0], outside.runs[outside.runs.length - 1]];
assert.equal(finalPort.sweep.enteredWalls, 0);
assert.ok(readme.includes(`${first.sweep.enteredWalls} of ${outside.sweep.dashes.toLocaleString('en-US')} measured dashes`), 'README must state the port command trial');
lines.push(`Port command: ${first.sweep.enteredWalls} then ${finalPort.sweep.enteredWalls} of ${outside.sweep.dashes} dashes into walls, ${outside.runs.length} runs, $${outside.runs.reduce((sum, run) => sum + run.estimatedCostUsd, 0).toFixed(4)}`);

const wonder = await json('assets/evidence/wonder-repeat.json');
const wonderPlan = await json('src/benchmark/wonder-repeat-tasks.json');
const repeats = wonder.sessions.filter(session => session.kind === 'repeat'), finished = repeats.filter(session => session.status !== 'not-run');
assert.equal(wonder.protocolId, wonderPlan.protocolId);
assert.equal(repeats.length, wonderPlan.plannedTrials, 'Every planned repeat is reported, including one that could not run');
assert.equal(finished.length, wonder.repeatsRun);
assert.equal(finished.filter(session => session.status === 'accepted').length, wonder.repeatsAccepted);
assert.equal(wonder.sessions.filter(session => session.status === 'accepted').length, wonder.acceptedSessions);
near(finished.reduce((sum, session) => sum + session.estimatedCostUsd, 0), wonder.repeatCostUsd, 'Wonder repeat cost');
for (const session of repeats.filter(session => session.status === 'not-run')) assert.ok(wonder.remainingUsd < wonderPlan.budget.reservedPerTrialUsd, `${session.label} could have run`);
assert.ok(readme.includes(`${wonder.acceptedSessions} of ${wonder.fullSessions} full sessions`), 'README must state the Wonder repeat result');
lines.push(`Wonder repeats: ${wonder.repeatsAccepted} of ${wonder.repeatsRun} accepted, ${wonder.acceptedSessions} of ${wonder.fullSessions} full sessions, $${wonder.repeatCostUsd.toFixed(4)}`);

for (const version of ['v3', 'v4', 'v5']) lines.push(await verifyWonderHarness({ version }));
const latest = await json('assets/benchmark/wonder-harness-v5/results.json');
const latestStarted = latest.trials.filter(trial => trial.status !== 'not-run').length;
assert.ok(readme.includes(`${latest.accepted} of ${latestStarted} fresh sessions`), 'README must state the latest harness result');

lines.push(await verifyExhaustiveEvidence());
console.log(lines.join('\n'));
console.log('Evidence verified from committed files. No model request was made.');
