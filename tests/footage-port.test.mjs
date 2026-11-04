import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { applyPatches } from '../src/auto-port/patches.mjs';
import { portGame } from '../src/auto-port/port-game.mjs';
import { buildRuntime } from '../src/auto-port/runtime.mjs';
import { loadRecoveredMove } from '../src/footage/component.mjs';
import { repositoryUrl } from '../src/paths.mjs';
import { firstDivergence, sweepDashes } from './fixtures/port-example-sweep.mjs';

const example = fileURLToPath(repositoryUrl('assets/port-example/tiny-platformer'));
const move = await loadRecoveredMove(fileURLToPath(repositoryUrl('assets/footage/recovered-dash')));
const port = JSON.parse(await readFile(repositoryUrl('assets/evidence/footage-port.json'), 'utf8'));
const original = await readFile(`${example}/platformer.js`, 'utf8');
const level = await readFile(`${example}/level.json`, 'utf8');
const runtime = await buildRuntime({ component: move.component });
const patched = applyPatches(original, port.patches);

test('the footage-recovered move is the one that was ported', () => {
  assert.equal(port.componentId, move.component.provenance.id);
  assert.equal(move.component.contract.label, 'footage match');
  assert.match(move.guidance, /lasts 8 ticks, moves 60 source pixels/);
});

test('the saved record says what the person stated, and that nobody verified it', () => {
  const { rights, clip } = move.component.provenance;
  assert.equal(rights.basis, 'open-license');
  assert.match(rights.note, /not verified/);
  assert.match(clip.note, /not kept/);
});

test('a port of the footage-recovered move stops at walls, and the game is unchanged without it', () => {
  assert.deepEqual(sweepDashes({ source: patched, level, runtime }), port.sweep);
  assert.equal(firstDivergence({ original, patched, level, runtime }), port.noDashDivergence);
});

test('the port command can carry a recovered move, and tells the model its real numbers', async t => {
  const out = join(await mkdtemp(join(tmpdir(), 'footage-port-')), 'game');
  t.after(() => rm(out, { recursive: true, force: true }));
  const requests = [];
  const submission = { status: 'supported', summary: port.summary, unitsPerSourcePixel: port.unitsPerSourcePixel, patches: port.patches };
  const generate = async request => {
    requests.push(request);
    return { estimatedCostUsd: 0, response: { output: [{ type: 'function_call', name: 'submit_auto_port', arguments: JSON.stringify(submission) }] } };
  };
  const report = await portGame({ directory: example, core: 'platformer.js', out, generate, component: move.component, guidance: move.guidance, model: 'Muse Spark Open' });
  assert.equal(report.model, 'Muse Spark Open');
  assert.equal(report.componentId, move.component.provenance.id);
  assert.match(report.browser, /dash fired from KeyX/);
  assert.match(JSON.stringify(requests[0].input), /these numbers replace the 8 ticks/);
  const shipped = await readFile(join(out, 'motion-dash.js'), 'utf8');
  assert.ok(shipped.includes(move.component.contract.defaults.cooldownTicks.toString()));
});
