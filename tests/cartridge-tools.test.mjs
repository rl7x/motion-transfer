import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runCartridgeTool } from '../agent/tools.mjs';

const trace = JSON.parse(await readFile(new URL('../experiments/dashy-dango/start-move-dash.json', import.meta.url), 'utf8'));

test('inspection returns pinned metadata and bounded generated WAT', async () => {
  const { result: overview } = await runCartridgeTool('inspect_wasm', { view: 'overview', startLine: 1, lineCount: 10 });
  assert.equal(overview.bytes, 47_101);
  assert.ok(overview.exports.some(item => item.name === 'update'));
  assert.ok(overview.imports.some(item => item.name === 'memory'));
  const { result: wat } = await runCartridgeTool('inspect_wasm', { view: 'wat', startLine: 1, lineCount: 10 });
  assert.equal(wat.sha256, overview.sha256);
  assert.equal(wat.lines.length, 10);
  assert.equal(wat.lines[0].number, 1);
  assert.equal(wat.lines[0].text, '(module');
  assert.equal(wat.nextLine, 11);
  assert.ok(wat.totalLines > 10);
});

test('isolated experiment tools produce fresh, contrasting observations', async () => {
  const args = { hypothesis: 'Moving right produces a repeatable checkpoint.', watches: [], steps: trace.steps };
  const first = await runCartridgeTool('run_original', args);
  const repeat = await runCartridgeTool('run_original', args);
  assert.deepEqual(repeat, first);
  const changed = structuredClone(args);
  changed.steps.find(step => step.checkpoint === 'move-right').buttons = 16;
  const contrast = await runCartridgeTool('run_original', changed);
  const hash = output => output.result.checkpoints.find(c => c.checkpoint === 'move-right').framebufferHash;
  assert.notEqual(hash(first), hash(contrast));
  assert.equal(first.result.frames, 83);
  assert.match(first.result.checkpoints.find(c => c.checkpoint === 'gameplay').text, /Score/);
  assert.equal(first.evidence.frames.length, 83);
  assert.equal(first.result.checkpoints[0].motion,null);
  const motion=first.result.checkpoints.find(c=>c.checkpoint==='move-right').motion;
  assert.ok(Number.isFinite(motion.position.x));assert.equal(motion.sourceBodyWidth,8);
  assert.match(first.result.motionNotice,/HUMAN-MAPPED/);
});

test('unknown tools, extra filesystem arguments, and excessive traces are rejected', async () => {
  await assert.rejects(runCartridgeTool('read_file', { path: '.env' }), /Unknown tool/);
  await assert.rejects(runCartridgeTool('inspect_wasm', { view: 'wat', startLine: 1, lineCount: 10, path: '.env' }), /only these fields/);
  await assert.rejects(runCartridgeTool('run_original', { hypothesis: 'Oversized', watches: [], steps: [
    { buttons: 0, frames: 600, checkpoint: 'one' },
    { buttons: 0, frames: 600, checkpoint: 'two' },
    { buttons: 0, frames: 600, checkpoint: 'three' },
    { buttons: 0, frames: 1, checkpoint: 'four' },
  ] }), /1,800/);
});

test('tool subprocesses are terminated by their timeout or cancellation', async () => {
  const args = { view: 'wat', startLine: 1, lineCount: 10 };
  await assert.rejects(runCartridgeTool('inspect_wasm', args, { timeoutMs: 1 }), /time limit/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runCartridgeTool('inspect_wasm', args, { signal: controller.signal }), /cancelled/);
});
