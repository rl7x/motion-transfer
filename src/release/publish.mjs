import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sha256 } from './sha.mjs';
import { materialize } from './materialize.mjs';
import { auditDirectory } from './audit.mjs';

function summary(version) {
  const base = 'versions/' + version.id + '/';
  return { id: version.id, kind: version.kind, parentArtifactId: version.parentArtifactId,
    play: base + 'index.html', frame: base + 'frame.html', download: base + 'download.zip',
    source: base + 'source.json', notices: base + 'notices.txt' };
}

async function writeTree(directory, files) {
  for (const [path, contents] of Object.entries(files)) {
    if (path.startsWith('/') || path.split('/').includes('..')) throw Error('Release path escapes the tree');
    const full = join(directory, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, contents);
  }
}

async function commitDirectory(staging, target) {
  const backup = target + '.previous-' + randomUUID();
  let moved = false;
  try { await rename(target, backup); moved = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await rename(staging, target); }
  catch (error) {
    if (moved) await rename(backup, target);
    throw error;
  }
  if (moved) await rm(backup, { recursive: true, force: true });
}

export async function publishRelease(target, release, { verify } = {}) {
  target = target.replace(/\/$/, '');
  const staging = target + '.staging-' + randomUUID();
  await mkdir(staging, { recursive: true });
  try {
    const files = await materialize(release);
    const listed = Object.fromEntries(Object.keys(files).sort().map(path => [path, sha256(files[path])]));
    const body = { ...(release.recipient?{recipient:release.recipient}:{}), schemaVersion: 1, kind: 'motion-transfer-static-release', creation: 'unavailable',
      publicOrigin: release.publicOrigin, componentId: release.componentId, featuredId: release.featuredId,
      remixChain: release.remixChain ?? [], warnings: release.warnings ?? [],
      versions: release.versions.map(summary), files: listed };
    const id = sha256(JSON.stringify(body));
    const manifest = JSON.stringify({ id, ...body }, null, 2) + '\n';
    files['manifest.json'] = manifest;
    files['manifest.sha256'] = sha256(manifest) + '\n';
    await writeTree(staging, files);
    const audited = await auditDirectory(staging);
    if (verify) await verify(staging, audited);
    await commitDirectory(staging, target);
    return audited;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
