import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runCartridgeTool } from '../agent/tools.mjs';

async function main() {
  const root = new URL('../', import.meta.url);
  const trace = JSON.parse(await readFile(new URL('experiments/dashy-dango/start-move-dash.json', root), 'utf8'));
  const overview = await runCartridgeTool('inspect_wasm', { view: 'overview', startLine: 1, lineCount: 20 });
  const original = await runCartridgeTool('run_original', { hypothesis: 'Local smoke: original recorded controls produce observable gameplay.', watches: [], steps: trace.steps });
  const changed = structuredClone(trace.steps);
  changed.find(step => step.checkpoint === 'move-right').buttons = 16;
  const contrast = await runCartridgeTool('run_original', { hypothesis: 'Local smoke: changing right movement to left changes the rendered checkpoint.', watches: [], steps: changed });
  const getHash = output => output.result.checkpoints.find(checkpoint => checkpoint.checkpoint === 'move-right').framebufferHash;
  if (getHash(original) === getHash(contrast)) throw new Error('Changed movement produced an identical checkpoint');
  const directory = new URL('reports/', root);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('cartridge-tools-smoke.json', directory), JSON.stringify({
    mode: 'local-tools-only', metaCalled: false,
    overview: overview.result,
    original: original.result,
    contrast: contrast.result,
  }, null, 2) + '\n');
  console.log('Local tool smoke passed: pinned imports/exports and contrasting replay observations.');
  console.log('No Meta API requests were made.');
  console.log(`Report: ${fileURLToPath(new URL('cartridge-tools-smoke.json', directory))}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
