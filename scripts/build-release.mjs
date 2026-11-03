import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { collectRelease } from '../release/collect.mjs';
import { publishRelease } from '../release/publish.mjs';
import { browserCheck } from '../release/browser-check.mjs';

const output = fileURLToPath(new URL('../reports/release', import.meta.url));
const publicOrigin = process.argv.includes('--public-origin')
  ? process.argv[process.argv.indexOf('--public-origin') + 1]
  : process.env.RELEASE_PUBLIC_ORIGIN ?? null;
const release = await collectRelease({ publicOrigin });
await mkdir(dirname(output), { recursive: true });
const manifest = await publishRelease(output, release, {
  verify: (directory, audited) => browserCheck(directory, audited),
});
console.log(JSON.stringify({
  id: manifest.id, output, publicOrigin: manifest.publicOrigin, featuredId: manifest.featuredId,
  remixChain: manifest.remixChain, versions: manifest.versions.map(version => version.id),
  warnings: manifest.warnings, files: Object.keys(manifest.files).length,
}, null, 2));
