import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runCartridgeTool } from '../agent/tools.mjs';

async function main() {
  const root = new URL('../', import.meta.url);
  const trace = JSON.parse(await readFile(new URL('experiments/dashy-dango/start-move-dash.json', root), 'utf8'));
  const overview = await runCartridgeTool('inspect_wasm', { view: 'overview', startLine: 1, lineCount: 20 });
  const functions = [];
  let startIndex = 0;
  do {
    const { result } = await runCartridgeTool('list_functions', { startIndex, limit: 50 });
    functions.push(...result.functions);
    startIndex = result.nextIndex;
    assert.equal(result.sha256, overview.result.sha256);
    if (startIndex === null) assert.equal(functions.length, result.totalFunctions);
  } while (startIndex !== null);
  const update = functions.find(fn => fn.exports.includes('update'));
  assert.ok(update, 'The cartridge needs an indexed update export');
  const disassembly = await runCartridgeTool('inspect_function', { functionIndex: update.index, startLine: 1, lineCount: 100 });
  assert.equal(disassembly.result.lines[0].number, update.startLine);
  assert.ok(disassembly.result.directCallees.length > 0, 'Expected direct calls from the donor update function');

  // This is a documented console register, not a claim about recovered donor state.
  const watches = [{ name: 'gamepadRegister', address: 0x16, type: 'u8', count: 1 }];
  const original = await runCartridgeTool('run_original', { hypothesis: 'Local smoke: original recorded controls produce observable gameplay.', watches, steps: trace.steps });
  const changed = structuredClone(trace.steps);
  changed.find(step => step.checkpoint === 'move-right').buttons = 16;
  const contrast = await runCartridgeTool('run_original', { hypothesis: 'Local smoke: changing right movement to left changes the rendered checkpoint.', watches, steps: changed });
  const atMovement = output => output.result.checkpoints.find(checkpoint => checkpoint.checkpoint === 'move-right');
  assert.notEqual(atMovement(original).framebufferHash, atMovement(contrast).framebufferHash, 'Changed movement produced an identical checkpoint');
  assert.deepEqual(atMovement(original).memory[0].values, [32]);
  assert.deepEqual(atMovement(contrast).memory[0].values, [16]);
  for (const output of [original, contrast]) {
    const steps = output === original ? trace.steps : changed;
    assert.deepEqual(output.result.checkpoints.map(checkpoint => checkpoint.memory[0].values[0]), [0, ...steps.map(step => step.buttons)]);
  }
  const directory = new URL('reports/', root);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('cartridge-tools-smoke.json', directory), JSON.stringify({
    mode: 'local-tools-only', metaCalled: false,
    overview: overview.result,
    functionIndex: functions,
    updateDisassembly: disassembly.result,
    original: original.result,
    contrast: contrast.result,
  }, null, 2) + '\n');
  console.log(`Local tool smoke passed: ${functions.length} indexed functions; update is function ${update.index}.`);
  console.log('Contrasting movement changes both the rendered checkpoint and watched input register (32 vs 16).');
  console.log('No Meta API requests were made.');
  console.log(`Report: ${fileURLToPath(new URL('cartridge-tools-smoke.json', directory))}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
