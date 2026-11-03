import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { captureAll } from '../demo/capture.mjs';
import { parseArgs } from '../demo/cli.mjs';
import { renderDemo } from '../demo/render.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const out = resolve(root, args.out);
  if (args.mode === 'capture' || args.mode === 'all') {
    await captureAll({ root, out, headed: args.headed });
  }
  if (args.mode === 'render' || args.mode === 'all') {
    const rendered = await renderDemo({ root, out, freshPath: args.fresh });
    console.log(rendered.video);
    console.log(rendered.srt);
    console.log(rendered.provenance);
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
