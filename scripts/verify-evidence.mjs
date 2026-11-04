import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { applyPatches } from '../src/auto-port/patches.mjs';

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

const outside = await json('assets/evidence/port-example.json');
const outsideLock = await json('assets/port-example/lock.json');
for (const file of outsideLock.files) assert.equal(digest(await readFile(`assets/port-example/${file.local}`)), file.sha256, file.local);
const platformer = await readFile('assets/port-example/tiny-platformer/platformer.js', 'utf8');
for (const run of outside.runs) if (run.sweep) applyPatches(platformer, run.patches);
const [first, finalPort] = [outside.runs[0], outside.runs[outside.runs.length - 1]];
assert.equal(finalPort.sweep.enteredWalls, 0);
assert.ok(readme.includes(`${first.sweep.enteredWalls} of ${outside.sweep.dashes.toLocaleString('en-US')} measured dashes`), 'README must state the port command trial');
lines.push(`Port command: ${first.sweep.enteredWalls} then ${finalPort.sweep.enteredWalls} of ${outside.sweep.dashes} dashes into walls, ${outside.runs.length} runs, $${outside.runs.reduce((sum, run) => sum + run.estimatedCostUsd, 0).toFixed(4)}`);

console.log(lines.join('\n'));
console.log('Evidence verified from committed files. No model request was made.');
