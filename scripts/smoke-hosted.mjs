import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from '../src/release/sha.mjs';
import { createStaticReleaseServer, RELEASE_CHECK_BASE_PATH } from '../src/release/static-server.mjs';
import { runHostedGeneration } from '../src/release/generation.mjs';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const value = name => flag(name) ? args[args.indexOf(name) + 1] : null;
const root = value('--root') ?? fileURLToPath(new URL('../reports/release', import.meta.url));

if (flag('--generate')) {
  const hook = value('--hook') ?? process.env.RELEASE_GENERATION_HOOK ?? '';
  const result = await runHostedGeneration({ hook });
  if (!result.allowed) {
    console.error(result.reason);
    process.exitCode = 2;
  } else console.log(JSON.stringify({ generated: false, settled: result.settled, id: result.id }));
  process.exit(process.exitCode ?? 0);
}

const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const server = await createStaticReleaseServer({ root, basePath: RELEASE_CHECK_BASE_PATH });
try {
  const read = async path => {
    const response = await fetch(server.origin + path);
    if (!response.ok) throw Error(path + ' returned ' + response.status);
    return response;
  };
  const index = await (await read('index.html')).text();
  if (!index.includes('playback-only') || !index.includes('Creation is unavailable')) throw Error('Index is not a playback-only release');
  if (!manifest.publicOrigin && !index.includes('data-share-state="unconfigured"')) throw Error('Index invents a public link');
  const motion = await (await read('motion-data.json')).json();
  if (motion.generation !== 'playback-only' || motion.resources['/api/lab/status'].enabled !== false) throw Error('Injected catalog still offers generation');
  const version = manifest.versions.find(item => item.id === manifest.featuredId);
  const page = await (await read(version.play)).text();
  if (!page.includes('Creation is unavailable')) throw Error('Featured version is missing the playback notice');
  if (version.parentArtifactId && !page.includes('../' + version.parentArtifactId + '/index.html')) throw Error('Featured version is missing its parent link');
  const download = await read(version.download);
  const bytes = Buffer.from(await download.arrayBuffer());
  const hash = sha256(bytes);
  const recorded = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')).files[version.download];
  if (hash !== recorded) throw Error('Download bytes do not match the manifest');
  const leaf = manifest.remixChain?.at(-1);
  if (leaf) {
    const child = manifest.versions.find(item => item.id === leaf);
    const childPage = await (await read(child.play)).text();
    if (!childPage.includes('../' + child.parentArtifactId + '/index.html')) throw Error('Saved remix is missing its parent');
    await read(child.download);
  }
  const rejected = await fetch(server.origin + 'api/remixes', { method: 'POST', body: '{}' });
  if (rejected.status !== 405) throw Error('Creation request was not rejected');
  console.log(JSON.stringify({ passed: true, mode: 'read-only', origin: server.origin, featuredId: version.id,
    downloadSha256: hash, remix: leaf ?? null }, null, 2));
} finally { await server.close(); }
