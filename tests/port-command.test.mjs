import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyPatches } from '../src/auto-port/patches.mjs';
import { NOT_CHECKED, PORT_GUIDANCE, portGame, revision } from '../src/auto-port/port-game.mjs';
import { buildRuntime } from '../src/auto-port/runtime.mjs';
import { loadPinnedComponent } from '../src/hosting/component-load.mjs';
import { ACCEPTED_COMPONENT_ID } from '../src/hosting/component-pin.mjs';
import { repositoryUrl } from '../src/paths.mjs';
import { firstDivergence, sweepDashes } from './fixtures/port-example-sweep.mjs';

const example = fileURLToPath(repositoryUrl('assets/port-example/tiny-platformer'));
const evidence = JSON.parse(await readFile(repositoryUrl('assets/evidence/port-example.json'), 'utf8'));
const lock = JSON.parse(await readFile(repositoryUrl('assets/port-example/lock.json'), 'utf8'));
const original = await readFile(join(example, 'platformer.js'), 'utf8');
const level = await readFile(join(example, 'level.json'), 'utf8');
const runtime = await buildRuntime({ component: await loadPinnedComponent(ACCEPTED_COMPONENT_ID) });
const run = id => evidence.runs.find(entry => entry.id === id);
const measured = evidence.runs.filter(entry => entry.sweep);
const finished = run('fresh-final');

/** The response Meta would have returned for a saved port. No model request is made anywhere in this file. */
const respond = ({ patches, summary = 'saved', unitsPerSourcePixel = 2, status = 'supported' }) => ({
  output: [{ type: 'function_call', name: 'submit_auto_port', arguments: JSON.stringify({ status, summary, unitsPerSourcePixel, patches }) }],
});
const scripted = responses => {
  const requests = [];
  const generate = async request => { requests.push(request); return { response: responses.shift(), estimatedCostUsd: 0.01 }; };
  return { requests, generate };
};
const sentInput = request => JSON.parse(request.input[0].content[0].text);

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'port-command-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('the outside game matches its pinned hashes and keeps its MIT license and notices', async () => {
  assert.equal(lock.license, 'MIT');
  for (const file of lock.files) {
    const bytes = await readFile(repositoryUrl(`assets/port-example/${file.local}`));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.local);
  }
  const license = await readFile(join(example, 'LICENSE'), 'utf8');
  assert.match(license, /Jake Gordon and contributors/);
  assert.match(license, /Permission is hereby granted, free of charge/);
  assert.match(await readFile(repositoryUrl('assets/port-example/NOTICE.md'), 'utf8'), /FPSMeter/);
});

test('every saved port reproduces its measured wall result, including the failures', () => {
  for (const entry of measured) {
    const result = sweepDashes({ source: applyPatches(original, entry.patches), level, runtime });
    assert.deepEqual(result, { dashes: evidence.sweep.dashes, ...entry.sweep }, entry.id);
  }
});

test('the sweep raises no false alarm on the same moves without a dash', () => {
  const result = sweepDashes({ source: applyPatches(original, run('first').patches), level, runtime, useDash: false });
  assert.deepEqual(result, { dashes: evidence.sweep.dashes, fired: 0, enteredWalls: 0, leftMap: 0 });
});

test('every saved port leaves the game unchanged while the dash is unused', () => {
  for (const entry of measured) {
    assert.equal(firstDivergence({ original, patched: applyPatches(original, entry.patches), level, runtime }), null, entry.id);
  }
});

test('a port is written to a new folder and leaves the original untouched', async t => {
  const root = await workspace(t), directory = join(root, 'game'), out = join(root, 'game-dash');
  await cp(example, directory, { recursive: true });
  const { requests, generate } = scripted([respond(finished)]);
  const report = await portGame({ directory, core: 'platformer.js', generate });
  assert.equal(report.out, out);
  assert.equal(await readFile(join(directory, 'platformer.js'), 'utf8'), original);
  assert.equal(await readFile(join(out, 'platformer.js'), 'utf8'), applyPatches(original, finished.patches));
  assert.match(await readFile(join(out, 'index.html'), 'utf8'), /<script src="motion-dash\.js"><\/script><script src="fpsmeter\.min\.js">/);
  assert.equal(await readFile(join(out, 'motion-dash.js'), 'utf8'), runtime);
  assert.deepEqual(JSON.parse(await readFile(join(out, 'motion-port.json'), 'utf8')).notChecked, NOT_CHECKED);
  assert.equal(sentInput(requests[0]).verifierFeedback.guidance, PORT_GUIDANCE);
  assert.equal(sentInput(requests[0]).source, original);
});

test('a billed response with no submission counts as an attempt and is retried', async t => {
  const root = await workspace(t);
  const { requests, generate } = scripted([{ output: [{ type: 'message' }] }, respond(finished)]);
  const report = await portGame({ directory: example, core: 'platformer.js', out: join(root, 'out'), generate });
  assert.equal(requests.length, 2);
  assert.deepEqual(report.attempts.map(attempt => attempt.status), ['no-submission', 'supported']);
  assert.equal(report.estimatedCostUsd, 0.02);
});

test('a patch that cannot apply is repaired with the failure and the previous patches', async t => {
  const root = await workspace(t);
  const broken = [{ anchor: 'this text is not in the game', replacement: 'var dash = 1;' }];
  const { requests, generate } = scripted([respond({ patches: broken }), respond(finished)]);
  await portGame({ directory: example, core: 'platformer.js', out: join(root, 'out'), generate });
  const feedback = sentInput(requests[1]).verifierFeedback;
  assert.deepEqual(feedback.previous.patches, broken);
  assert.match(feedback.failed[0].error, /matched 0 times/);
  assert.equal(feedback.guidance, PORT_GUIDANCE);
});

test('a playtest note goes back to Spark with the previous patches', async t => {
  const root = await workspace(t), note = 'The dash passes through walls';
  const { requests, generate } = scripted([respond(finished)]);
  await portGame({ directory: example, core: 'platformer.js', out: join(root, 'out'), revise: revision(run('first'), note), generate });
  const feedback = sentInput(requests[0]).verifierFeedback;
  assert.deepEqual(feedback.failed, [{ name: 'developer-playtest', error: note }]);
  assert.deepEqual(feedback.previous.patches, run('first').patches);
});

test('a declined game and two failed attempts write nothing', async t => {
  const root = await workspace(t);
  const declined = scripted([respond({ status: 'unsupported', summary: 'No avatar', patches: [] })]);
  await assert.rejects(portGame({ directory: example, core: 'platformer.js', out: join(root, 'declined'), generate: declined.generate }), /declined this game: No avatar/);
  assert.equal(existsSync(join(root, 'declined')), false);
  const broken = [{ anchor: 'not in the game', replacement: 'x' }];
  const failed = scripted([respond({ patches: broken }), respond({ patches: broken })]);
  await assert.rejects(portGame({ directory: example, core: 'platformer.js', out: join(root, 'failed'), generate: failed.generate }), /failed after 2 attempts/);
  assert.equal(existsSync(join(root, 'failed')), false);
});

test('bad inputs are refused before any request is sent', async t => {
  const root = await workspace(t), full = join(root, 'full');
  await mkdir(full);
  await writeFile(join(full, 'keep.txt'), 'keep');
  const { requests, generate } = scripted([]);
  await assert.rejects(portGame({ directory: example, core: 'platformer.js', out: full, generate }), /not empty/);
  await assert.rejects(portGame({ directory: example, core: '../outside.js', out: join(root, 'a'), generate }), /inside the game directory/);
  await assert.rejects(portGame({ directory: example, core: 'missing.js', out: join(root, 'b'), generate }), /is not in/);
  await assert.rejects(portGame({ directory: root, core: 'platformer.js', out: join(root, 'c'), generate }), /has no index\.html/);
  await assert.rejects(portGame({ directory: example, core: 'platformer.js', out: example, generate }), /must not be the game directory/);
  assert.equal(requests.length, 0);
  assert.equal(await readFile(join(full, 'keep.txt'), 'utf8'), 'keep');
});
