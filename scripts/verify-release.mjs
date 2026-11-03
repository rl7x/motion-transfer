import { fileURLToPath } from 'node:url';
import { auditDirectory } from '../release/audit.mjs';
import { browserCheck } from '../release/browser-check.mjs';

const root = process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : fileURLToPath(new URL('../reports/release', import.meta.url));
const manifest = await auditDirectory(root);
await browserCheck(root, manifest);
console.log(JSON.stringify({ passed: true, id: manifest.id, featuredId: manifest.featuredId, remixChain: manifest.remixChain,
  publicOrigin: manifest.publicOrigin, files: Object.keys(manifest.files).length }, null, 2));
