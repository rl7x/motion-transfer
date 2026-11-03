import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from '../component/build.mjs';
import { ROADSTER_FILES, readRoadsterArtifact } from '../roadster/artifact.mjs';

export const SAVED_REMIX_ID = 'f67245c401fc82cfd516d6e333fe67dad2acfd232ca7607baea6a6d05d912fbf';
export const COMMITTED_REMIX_EVIDENCE = 'benchmark/recordings/eb9ac874-30ad-4a0b-9bcc-78f8c25f539a/evidence/6461b9fba4d0d129297028ae18b0cceade49cfca808c9e8e5482a11ed25eac55.json';

function sameNames(left, right) {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

export function remixRecordFromEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  const { id, ...rest } = evidence;
  if (id !== SAVED_REMIX_ID || !rest.files || typeof rest.files !== 'object') return null;
  const names = Object.keys(rest.files);
  if (!sameNames([...names].sort(), [...ROADSTER_FILES].sort())) return null;
  for (const name of names) {
    if (typeof rest.files[name] !== 'string') return null;
  }
  const manifest = {
    ...rest,
    files: Object.fromEntries(names.map(name => [name, digest(rest.files[name])])),
  };
  if (digest(JSON.stringify(manifest)) !== id) return null;
  return { id, manifest, files: rest.files };
}

export async function loadCommittedRemix(root) {
  let text;
  try {
    text = await readFile(join(root, COMMITTED_REMIX_EVIDENCE), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let evidence;
  try {
    evidence = JSON.parse(text);
  } catch {
    throw Error('Committed remix evidence is not valid JSON');
  }
  const record = remixRecordFromEvidence(evidence);
  if (!record) throw Error('Committed remix evidence failed the identity check');
  return { ...record, source: COMMITTED_REMIX_EVIDENCE };
}

async function assertCurrentChild(root, record) {
  const current = JSON.parse(await readFile(join(root, 'transfers/roadster/current.json'), 'utf8'));
  const provenance = JSON.parse(await readFile(join(root, 'components/dashy-dango-dash/provenance.json'), 'utf8'));
  if (record.manifest.parentArtifactId !== current.id || record.manifest.componentId !== provenance.id) {
    throw Error('Committed remix is not a child of the current Roadster transfer');
  }
}

export async function describeCommittedRemix(root) {
  const record = await loadCommittedRemix(root);
  if (!record) return null;
  await assertCurrentChild(root, record);
  return {
    id: record.id,
    parentId: record.manifest.parentArtifactId,
    componentId: record.manifest.componentId,
    intent: record.manifest.intent,
    summary: record.manifest.summary,
    source: record.source,
  };
}

export async function materializeCommittedRemix(root, directory) {
  const record = await loadCommittedRemix(root);
  if (!record) return null;
  await assertCurrentChild(root, record);
  const target = join(directory, record.id);
  await mkdir(target, { recursive: true });
  for (const [name, bytes] of Object.entries(record.files)) await writeFile(join(target, name), bytes);
  await writeFile(join(target, 'manifest.json'), JSON.stringify({ ...record.manifest, id: record.id }, null, 2) + '\n');
  const artifact = await readRoadsterArtifact(directory, record.id);
  return {
    id: artifact.id,
    parentId: artifact.parentArtifactId,
    componentId: artifact.componentId,
    intent: artifact.intent,
    summary: artifact.summary,
    source: record.source,
    directory,
  };
}
