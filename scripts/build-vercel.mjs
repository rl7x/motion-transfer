import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';

execFileSync('npm', ['ci', '--prefix', 'src/hosting/vercel', '--no-audit', '--no-fund'], { stdio: 'inherit' });

const directory = '.vercel/output/functions/proxy.func';
await mkdir(directory, { recursive: true });
await build({ entryPoints: ['src/hosting/vercel-function.mjs'], outfile: directory + '/index.mjs',
  bundle: true, platform: 'node', target: 'node22', format: 'esm', packages: 'bundle',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
await writeFile(directory + '/.vc-config.json', JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', maxDuration: 60 }));
await writeFile('.vercel/output/config.json', JSON.stringify({ version: 3, routes: [{ src: '/(.*)', dest: '/proxy' }] }));
console.log('Built the Vercel gateway for the persistent app and isolated verifier sandboxes.');
