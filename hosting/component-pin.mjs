import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const digest = value => createHash('sha256').update(value).digest('hex');
const ROADSTER_FILES = Object.freeze([
  'adapter.js', 'adapter.ts', 'frame.html', 'generation.json', 'notices.txt', 'verification.json',
]);

/** Committed saved dash. The worker loads this package; the coordinator never compiles it. */
export const SAVED_COMPONENT_ID = '1bc4250c3ca3c1e9a59849d0fd1335e9f7a02a95184d7d51fd6ac678d83226a2';
/** Current saved Roadster artifact. Its directory is transfers/roadster/versions/<id>. */
export const SAVED_ARTIFACT_ID = '6790a603505a6435dc25835896a4d1d09c5a1f1f3d10115daf524ec7a2d9ab38';
/** Accepted Wonder component published with the Roadster pin. */
export const ACCEPTED_COMPONENT_ID = '544657417fe9752f91b0b72a451cd9cb8d2650839824be35881e52f81f223858';
/** Accepted Roadster delivery. Its artifact directory is published/artifacts/<id>. */
export const ACCEPTED_ARTIFACT_ID = '216a2c7621dedf133de9d45f464cb478956f376a07b0ead9212d453b6eb8069c';

const PINS = Object.freeze({
  [SAVED_ARTIFACT_ID]: SAVED_COMPONENT_ID,
  [ACCEPTED_ARTIFACT_ID]: ACCEPTED_COMPONENT_ID,
});

export function assertHostedComponentId(componentId) {
  if (componentId !== SAVED_COMPONENT_ID && componentId !== ACCEPTED_COMPONENT_ID) {
    throw Error('Component is not an allowlisted host pin');
  }
}

function sameMap(left, right) {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const a = Object.keys(left).sort();
  const b = Object.keys(right).sort();
  return a.length === b.length && a.every((key, index) => key === b[index] && left[key] === right[key]);
}

async function savedPackage() {
  const root = new URL('../components/dashy-dango-dash/', import.meta.url);
  const source = await readFile(new URL('component.ts', root), 'utf8');
  const javascript = await readFile(new URL('component.js', root), 'utf8');
  const contract = JSON.parse(await readFile(new URL('contract.json', root), 'utf8'));
  const provenance = JSON.parse(await readFile(new URL('provenance.json', root), 'utf8'));
  if (provenance.id !== SAVED_COMPONENT_ID || digest(source) !== provenance.sourceSha256
    || digest(javascript) !== provenance.javascriptSha256
    || digest(JSON.stringify({ source: provenance.sourceSha256, javascript: provenance.javascriptSha256, contract })) !== provenance.id) {
    throw Error('Saved component pin mismatch');
  }
  return { id: provenance.id, javascript, contract };
}

function acceptedPackage(component) {
  const provenance = component?.provenance;
  if (!component?.candidateId || !provenance || provenance.id !== ACCEPTED_COMPONENT_ID) {
    throw Error('Accepted component pin mismatch');
  }
  if (digest(component.source) !== provenance.sourceSha256 || digest(component.javascript) !== provenance.javascriptSha256
    || digest(JSON.stringify({
      source: provenance.sourceSha256, javascript: provenance.javascriptSha256, contract: component.contract,
    })) !== provenance.id) {
    throw Error('Accepted component pin mismatch');
  }
  return { id: provenance.id, javascript: component.javascript, contract: component.contract };
}

/**
 * Reads one allowlisted Roadster artifact directory. File names are fixed.
 * The directory is not a command, and an unknown id is not a path to search.
 */
export async function readVerifiedPin(artifactDirectory) {
  const artifact = resolve(artifactDirectory);
  const id = basename(artifact);
  const componentId = PINS[id];
  if (!componentId) throw Error('Verified parent artifact is not an allowlisted pin');
  const record = JSON.parse(await readFile(join(artifact, 'manifest.json'), 'utf8'));
  const { id: claimed, ...manifest } = record;
  if (claimed !== id || digest(JSON.stringify(manifest)) !== id) throw Error('Roadster artifact identity mismatch');
  const names = Object.keys(record.files);
  if (names.length !== ROADSTER_FILES.length || !ROADSTER_FILES.every(name => names.includes(name))) {
    throw Error('Roadster artifact integrity mismatch');
  }
  const files = {};
  for (const name of names) {
    if (!/^[a-z][a-z0-9.-]+$/.test(name)) throw Error('Roadster artifact integrity mismatch');
    const text = await readFile(join(artifact, name), 'utf8');
    if (digest(text) !== record.files[name]) throw Error(`Roadster artifact integrity mismatch: ${name}`);
    files[name] = text;
  }
  if (record.componentId !== componentId) throw Error('Verified parent component does not match the pinned package');
  const verification = JSON.parse(files['verification.json']);
  const generation = JSON.parse(files['generation.json']);
  if (verification?.passed !== true || verification.conformance?.passed !== true || verification.browser?.passed !== true) {
    throw Error('Verified parent evidence did not pass');
  }
  if (verification.conformance.componentId !== componentId || verification.browser.componentId !== componentId
    || generation.componentId !== componentId) {
    throw Error('Verified parent component does not match the pinned package');
  }
  if (verification.conformance.sourceSha256 !== digest(files['adapter.ts'])
    || verification.browser.sourceSha256 !== digest(files['adapter.ts'])) {
    throw Error('Verified parent source does not match the pinned evidence');
  }
  if (verification.browser.frameSha256 !== digest(files['frame.html'])) {
    throw Error('Verified parent frame does not match the pinned evidence');
  }
  const lock = JSON.parse(await readFile(new URL('../recipients/roadster/recipient.lock.json', import.meta.url), 'utf8'));
  if (lock.revision !== record.recipientRevision || record.environment?.recipientRevision !== lock.revision
    || !sameMap(record.environment?.recipientFiles, lock.files) || typeof lock.name !== 'string' || !lock.name.trim()) {
    throw Error('Verified parent recipient does not match the pinned revision');
  }
  const component = id === ACCEPTED_ARTIFACT_ID ? acceptedPackage(record.component) : await savedPackage();
  if (component.id !== componentId) throw Error('Verified parent component does not match the pinned package');
  return {
    id, componentId, intent: record.intent, summary: record.summary ?? null,
    source: files['adapter.ts'], frame: files['frame.html'], component,
    recipient: { name: lock.name, revision: lock.revision },
  };
}
