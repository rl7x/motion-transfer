import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRoadsterArtifact } from '../roadster/artifact.mjs';
import { sha256 } from './sha.mjs';

const root = fileURLToPath(new URL('../reports/lab/artifacts/', import.meta.url));

/** Longest intact parent chain in the local lab store. Invalid artifacts are skipped. */
export async function loadLabRemixChain(directory = root) {
  const warnings = [];
  let names = [];
  try { names = (await readdir(directory)).filter(name => /^[a-f0-9]{64}$/.test(name)); }
  catch (error) {
    if (error.code === 'ENOENT') return { chain: [], warnings: ['No lab artifact directory.'] };
    throw error;
  }
  const records = new Map();
  for (const id of names) {
    try {
      const artifact = await readRoadsterArtifact(directory, id);
      const manifestBytes = await readFile(join(directory, id, 'manifest.json'));
      const parsed = JSON.parse(manifestBytes.toString('utf8'));
      if (parsed.id !== id) throw Error('Manifest id does not match its directory');
      records.set(id, { artifact, manifestBytes });
    } catch (error) {
      warnings.push(id + ': ' + error.message);
    }
  }
  const chainOf = (id, seen = new Set()) => {
    if (!id || seen.has(id) || !records.has(id)) return [];
    seen.add(id);
    const { artifact } = records.get(id);
    const parent = artifact.parentArtifactId || null;
    if (!parent) return [records.get(id)];
    if (!records.has(parent)) return [];
    const prefix = chainOf(parent, seen);
    if (!prefix.length) return [];
    return [...prefix, records.get(id)];
  };
  let chain = [];
  for (const id of records.keys()) {
    const candidate = chainOf(id);
    if (candidate.length > chain.length) chain = candidate;
  }
  if (chain.length < 2) warnings.push('No saved lab remix with its parent passed integrity checks.');
  return {
    warnings,
    chain: chain.map(({ artifact, manifestBytes }) => ({
      id: artifact.id,
      kind: artifact.parentArtifactId ? 'roadster-remix' : 'roadster-transfer',
      title: artifact.parentArtifactId ? artifact.summary : 'Saved Roadster transfer',
      summary: artifact.summary,
      parentArtifactId: artifact.parentArtifactId || null,
      componentId: artifact.componentId,
      intent: artifact.intent,
      files: artifact.files,
      manifestBytes,
      frameSha256: sha256(artifact.files['frame.html']),
    })),
  };
}
