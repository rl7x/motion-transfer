import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { collectRelease } from '../release/collect.mjs';
import { publishRelease } from '../release/publish.mjs';
import { browserCheck } from '../release/browser-check.mjs';

const acceptedRoadster = option('accepted-roadster');
const output = acceptedRoadster
  ? fileURLToPath(new URL('../reports/release-accepted', import.meta.url))
  : fileURLToPath(new URL('../reports/release', import.meta.url));
function option(name) {
  const flag = '--' + name;
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw Error('Missing value for ' + flag);
  return value;
}
const publicOrigin = option('public-origin') ?? process.env.RELEASE_PUBLIC_ORIGIN ?? null;
const release = await collectRelease({
  publicOrigin,
  extraArtifacts: option('extra-artifacts'),
  challengeDirectory: option('challenge'),
  acceptedRoadster,
});
await mkdir(dirname(output), { recursive: true });
const manifest = await publishRelease(output, release, {
  verify: (directory, audited) => browserCheck(directory, audited),
});
console.log(JSON.stringify({
  id: manifest.id, output, publicOrigin: manifest.publicOrigin, recovery: release.recovery,
  componentId: manifest.componentId, featuredId: manifest.featuredId,
  remixChain: manifest.remixChain, versions: manifest.versions.map(version => version.id),
  warnings: manifest.warnings, files: Object.keys(manifest.files).length,
}, null, 2));
