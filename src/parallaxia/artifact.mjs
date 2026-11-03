import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from '../component/build.mjs';
import { componentIdentity } from '../component/reference.mjs';
import { loadPinnedComponent } from '../hosting/component-load.mjs';
import { ACCEPTED_ARTIFACT_ID, ACCEPTED_COMPONENT_ID, readVerifiedPin } from '../hosting/component-pin.mjs';
import { evaluateParallaxiaAdapter } from '../evaluator/parallaxia.mjs';
import { verifyParallaxiaBrowser } from '../evaluator/parallaxia-browser.mjs';
import { buildParallaxiaFrame } from './build.mjs';
import { parallaxiaDescriptor } from './recipient.mjs';

export const PARALLAXIA_STORE = new URL('../../reports/parallaxia/artifacts/', import.meta.url);

export async function buildParallaxiaArtifact({ source, intent, component, provenance, parentArtifactId = null }) {
  const conformance = await evaluateParallaxiaAdapter(source, intent, { componentRef: component });
  const browser = await verifyParallaxiaBrowser(source, intent, { componentRef: component });
  assert.ok(conformance.passed && browser.passed, 'PARALLAXIA recipient verification failed');
  const frame = await buildParallaxiaFrame({ source, intent, componentRef: component });
  assert.equal(digest(frame.html), browser.frameSha256, 'PARALLAXIA frame changed after verification');
  const recipient = await parallaxiaDescriptor();
  const verification = { passed: true, componentId: frame.componentId, recipient, collisionPolicy: 'native',
    addedDashInvulnerability: false, conformance, browser };
  const notice = await readFile(new URL('../../assets/targets/dashy-dango/NOTICE.txt', import.meta.url), 'utf8');
  const files = {
    'rule.mjs': 'export default null;\n',
    'adapter.ts': source, 'frame.html': frame.html,
    'verification.json': JSON.stringify(verification, null, 2) + '\n',
    'generation.json': JSON.stringify(provenance, null, 2) + '\n',
    'component.json': JSON.stringify(component, null, 2) + '\n',
    'notices.txt': notice + '\n\n' + recipient.notices,
  };
  const manifest = { schemaVersion: 1, kind: 'parallaxia-transfer', recipient, parentArtifactId,
    componentId: component.provenance.id, componentRef: componentIdentity(component), intent,
    environment: frame.environment, provenance,
    files: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, digest(value)])) };
  const id = digest(JSON.stringify(manifest));
  return { id, ...manifest, files, component, summary: 'Accepted dash reused in PARALLAXIA; native collisions, no added invulnerability.' };
}

export async function saveParallaxiaArtifact(artifact, root = PARALLAXIA_STORE) {
  const directory = new URL(artifact.id + '/', root);
  await mkdir(directory, { recursive: true });
  for (const [name, value] of Object.entries(artifact.files)) {
    const file=new URL(name,directory);
    try {await writeFile(file,value,{flag:'wx'});} catch(error){if(error.code!=='EEXIST')throw error;assert.equal(digest(await readFile(file)),digest(value),'Immutable PARALLAXIA bytes changed');}
  }
  const { component, summary, ...record } = artifact;
  await writeFile(new URL('manifest.json', directory), JSON.stringify({ ...record,
    files: Object.fromEntries(Object.entries(artifact.files).map(([name, value]) => [name, digest(value)])) }, null, 2) + '\n');
}

export async function readParallaxiaArtifact(directory, id) {
  assert.match(id, /^[a-f0-9]{64}$/);
  const record = JSON.parse(await readFile(join(directory, id, 'manifest.json'), 'utf8'));
  const { id: claimed, ...manifest } = record;
  assert.equal(claimed, id); assert.equal(digest(JSON.stringify(manifest)), id);
  assert.equal(record.kind, 'parallaxia-transfer');
  const files = {};
  for (const [name, sha] of Object.entries(record.files)) {
    assert.match(name, /^[a-z][a-z0-9.-]+$/); assert.ok(!name.includes('..'));
    files[name] = await readFile(join(directory, id, name), 'utf8'); assert.equal(digest(files[name]), sha);
  }
  assert.equal(JSON.parse(files['verification.json']).passed, true);
  return { ...record, files, component: JSON.parse(files['component.json']) };
}

let baseline;
export function loadParallaxiaBaseline() {
  baseline ??= (async () => {
    const component = await loadPinnedComponent(ACCEPTED_COMPONENT_ID);
    const parent = await readVerifiedPin(new URL(`../../assets/transfers/roadster/accepted/${ACCEPTED_ARTIFACT_ID}/published/artifacts/${ACCEPTED_ARTIFACT_ID}`, import.meta.url).pathname);
    const artifact = await buildParallaxiaArtifact({ source: parent.source, intent: parent.intent, component,
      provenance: { kind: 'reuse', adapterOrigin: 'Meta-generated Roadster adapter, independently verified for PARALLAXIA',
        sourceArtifactId: ACCEPTED_ARTIFACT_ID, componentId: ACCEPTED_COMPONENT_ID, modelCalls: 0 } });
    await saveParallaxiaArtifact(artifact);
    return artifact;
  })().catch(error => { baseline = null; throw error; });
  return baseline;
}
