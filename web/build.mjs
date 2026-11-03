import { build } from 'esbuild';

let frontend;
export async function buildFrontend() {
  frontend ??= build({
    entryPoints: [new URL('app/main.tsx', import.meta.url).pathname],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    jsx: 'automatic', minify: true, define: { 'process.env.NODE_ENV': '"production"' },
    tsconfig: new URL('tsconfig.json', import.meta.url).pathname,
    legalComments: 'inline', logLevel: 'silent',
  }).catch(error => { frontend = null; throw error; });
  return (await frontend).outputFiles[0].text;
}

let exportedReplay;
export async function buildExportedExperiment() {
  exportedReplay ??= build({entryPoints:[new URL('app/exported-experiment.tsx',import.meta.url).pathname],bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',jsx:'automatic',minify:true,
    define:{'process.env.NODE_ENV':'"production"'},tsconfig:new URL('tsconfig.json',import.meta.url).pathname,legalComments:'inline',logLevel:'silent'});
  return (await exportedReplay).outputFiles[0].text;
}
