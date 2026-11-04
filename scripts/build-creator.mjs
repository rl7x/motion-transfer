import { buildExportedExperiment } from '../web/build.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, '../web/app/creator/main.tsx');
const cssPath = join(here, '../web/app/creator/creator.css');
const sharedCssPath = join(here, '../web/style.css');

/** The shared AI Lab block from the site stylesheet, so both pages use one design. */
async function aiLabCss() {
  const shared = await readFile(sharedCssPath, 'utf8');
  const start = shared.indexOf('/* ai-lab:start */');
  const end = shared.indexOf('/* ai-lab:end */');
  if (start === -1 || end === -1) throw Error('The shared AI Lab stylesheet block is missing');
  return shared.slice(start, end + '/* ai-lab:end */'.length);
}
const tsconfig = join(here, '../web/tsconfig.json');

/**
 * Bundle the trusted creator React app into one HTML document.
 * The coordinator should send this document as a static response. It must not
 * execute the script, and the script does not evaluate model output.
 */
export async function buildCreatorPage() {
  const css = `${await aiLabCss()}\n${await readFile(cssPath, 'utf8')}`;
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    minify: true,
    legalComments: 'none',
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    tsconfig,
  });
  const file = result.outputFiles[0];
  if (!file) throw Error('Creator bundle produced no JavaScript');
  const js = file.text.replaceAll('</', '<\\/');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Motion transfer</title>
<style>
${css}
</style>
</head>
<body>
<div id="creator-root"></div>
<script>
${js}
</script>
</body>
</html>
`;
  return { html, js, css };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const out = process.argv[2];
  const page = await buildCreatorPage();
  if (!out) {
    console.log(
      `Creator page ${Buffer.byteLength(page.html)} bytes. Pass an output directory to write index.html.`,
    );
  } else {
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'index.html'), page.html);
    await writeFile(join(out, 'replay.js'), await buildExportedExperiment());
    console.log(`Wrote ${join(out, 'index.html')}`);
  }
}
