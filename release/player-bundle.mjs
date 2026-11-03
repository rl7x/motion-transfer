import { build } from 'esbuild';

let player;

/** Small React entry for immutable version pages. The index shell stays the main app bundle. */
export async function buildReleasePlayer() {
  player ??= build({
    entryPoints: [new URL('../web/app/release-player.tsx', import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    tsconfig: new URL('../web/tsconfig.json', import.meta.url).pathname,
    legalComments: 'inline',
    logLevel: 'silent',
  }).catch((error) => {
    player = null;
    throw error;
  });
  return (await player).outputFiles[0].text;
}
