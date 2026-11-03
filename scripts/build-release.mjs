import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { collectRelease } from '../src/release/collect.mjs';
import { publishRelease } from '../src/release/publish.mjs';
import { browserCheck } from '../src/release/browser-check.mjs';

const recipient=option('recipient')??'roadster';
const acceptedRoadster = option('accepted-roadster');
const output = option('output') ?? (recipient==='parallaxia' ? fileURLToPath(new URL('../reports/release-parallaxia',import.meta.url)) : acceptedRoadster
  ? fileURLToPath(new URL('../reports/release-accepted', import.meta.url))
  : fileURLToPath(new URL('../reports/release', import.meta.url)));
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
  publicOrigin, recipient, liveDirectory:option('live-directory'), featuredId:option('artifact'), taskEvidence:option('task-evidence'),reuseBaseline:process.argv.includes('--reuse-baseline'),
  extraArtifacts: option('extra-artifacts'),
  challengeDirectory: option('challenge'),
  acceptedRoadster,
});
await mkdir(dirname(output), { recursive: true });
const manifest = await publishRelease(output, release, {
  verify: async (directory, audited) => recipient==='parallaxia' ? (await import('../src/release/parallaxia-browser-check.mjs')).browserCheckParallaxia(directory,audited) : browserCheck(directory, audited),
});
console.log(JSON.stringify({
  id: manifest.id, output, publicOrigin: manifest.publicOrigin, recovery: release.recovery,
  componentId: manifest.componentId, featuredId: manifest.featuredId,
  remixChain: manifest.remixChain, versions: manifest.versions.map(version => version.id),
  warnings: manifest.warnings, files: Object.keys(manifest.files).length,
}, null, 2));
