import { fileURLToPath } from 'node:url';
import { auditDirectory } from '../src/release/audit.mjs';
import { browserCheck } from '../src/release/browser-check.mjs';

const root = process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : fileURLToPath(new URL('../reports/release', import.meta.url));
const manifest = await auditDirectory(root);
const verification = manifest.recipient?.id === 'parallaxia'
  ? await (await import('../src/release/parallaxia-browser-check.mjs')).browserCheckParallaxia(root, manifest)
  : await browserCheck(root, manifest);
console.log(JSON.stringify({ passed: true, verification, id: manifest.id, featuredId: manifest.featuredId, remixChain: manifest.remixChain,
  publicOrigin: manifest.publicOrigin, files: Object.keys(manifest.files).length }, null, 2));
