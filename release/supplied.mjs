import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from '../component/build.mjs';

const required = ['play.html', 'challenge.json', 'adapter.ts', 'notices.txt'];

/** Read a future challenge directory without labeling it as a new recovery. */
export async function loadSuppliedChallenge(directory, parent) {
  const manifestText = await readFile(join(directory, 'manifest.json'), 'utf8');
  const record = JSON.parse(manifestText);
  const { id: claimed, ...manifest } = record;
  if (manifest.kind !== 'roadster-challenge') throw Error('Challenge directory is not a roadster challenge');
  if (digest(JSON.stringify(manifest)) !== claimed) throw Error('Supplied challenge identity does not match its manifest');
  if (!parent?.id || manifest.parentArtifactId !== parent.id) {
    throw Error('Supplied challenge parent is not the saved Roadster transfer');
  }
  if (parent.componentId && manifest.componentId !== parent.componentId) {
    throw Error('Supplied challenge component does not match the saved transfer');
  }
  const files = { 'manifest.json': manifestText };
  for (const [name, hash] of Object.entries(record.files ?? {})) {
    if (name.includes('..') || name.includes('/') || name.includes('\\')) throw Error('Challenge file escapes the directory');
    const bytes = await readFile(join(directory, name), 'utf8');
    if (digest(bytes) !== hash) throw Error('Supplied challenge file hash mismatch: ' + name);
    files[name] = bytes;
  }
  for (const name of required) {
    if (typeof files[name] !== 'string') throw Error('Supplied challenge is missing ' + name);
  }
  const evidence = JSON.parse(files['challenge.json']);
  if (evidence.ordinaryOutsideTarget !== true || evidence.borrowedInsideTarget !== true) {
    throw Error('Supplied challenge is missing the saved landing result');
  }
  const baseline = evidence.measurement?.baseline?.landing?.position?.x;
  const transferred = evidence.measurement?.transferred?.landing?.position?.x;
  if (!Number.isFinite(baseline) || !Number.isFinite(transferred)) {
    throw Error('Supplied challenge is missing landing measurements');
  }
  return {
    id: claimed,
    kind: 'roadster-challenge',
    protocol: 'challenge',
    origin: 'supplied-challenge',
    freshRecovery: false,
    title: 'Land in the green zone',
    summary: typeof evidence.scope === 'string' ? evidence.scope : 'Supplied saved challenge',
    parentArtifactId: parent.id,
    componentId: manifest.componentId,
    intent: manifest.intent,
    frame: files['play.html'],
    notices: files['notices.txt'],
    adapter: files['adapter.ts'],
    sourceBytes: manifestText,
    evidenceName: 'challenge.json',
    evidenceBytes: files['challenge.json'],
    zipFiles: files,
    report: null,
    api: {
      target: evidence.target ?? null,
      ordinaryOutsideTarget: true,
      borrowedInsideTarget: true,
      measurements: {
        baselineLandingX: baseline,
        transferredLandingX: transferred,
        netLandingShiftMeters: Number.isFinite(evidence.netLandingShiftMeters) ? evidence.netLandingShiftMeters : transferred - baseline,
        maxVerticalDifference: Number.isFinite(evidence.maxVerticalDifference) ? evidence.maxVerticalDifference : 0,
        durationSeconds: Array.isArray(evidence.measurement?.controls) ? evidence.measurement.controls.length / 60 : 0,
      },
    },
  };
}
