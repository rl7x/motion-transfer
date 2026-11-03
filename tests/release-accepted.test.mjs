import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../component/build.mjs';
import { loadRecoveredMotion } from '../component/load.mjs';
import {
  ACCEPTED_JUJUMP_PUBLICATION, acceptedComponentFromArtifact, acceptedJujumpComparison,
  assertAcceptedIdentities, assertLiveDelivery, loadAcceptedRoadsterRelease,
} from '../release/accepted.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const deliveryDirectory = fileURLToPath(new URL('../reports/motion-transfer-phase/fresh-roadster-001/', import.meta.url));
const pinnedDelivery = fileURLToPath(new URL('../transfers/roadster/accepted/216a2c7621dedf133de9d45f464cb478956f376a07b0ead9212d453b6eb8069c/', import.meta.url));
const acceptedComponentId = '544657417fe9752f91b0b72a451cd9cb8d2650839824be35881e52f81f223858';

test('accepted release loader does not import the saved component', async () => {
  const source = await readFile(new URL('../release/accepted.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes('loadRecoveredMotion'), false);
  assert.equal(source.includes('loadSavedRoadster'), false);
  assert.equal(source.includes('buildRoadsterChallenge'), false);
  assert.equal(source.includes('motion-transfer-phase'), false);
  assert.match(source, /acceptedComponentFromArtifact\(artifact\)/);
});

test('a missing or non-live delivery is refused', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'accepted-release-'));
  try {
    await assert.rejects(() => loadAcceptedRoadsterRelease(join(directory, 'missing')), /Refusing to use the saved component/);
    const live = JSON.parse(await readFile(join(deliveryDirectory, 'delivery.json'), 'utf8'));
    const { sha256, ...receipt } = live;
    assert.equal(digest(JSON.stringify(receipt)), sha256);
    assertLiveDelivery(receipt);
    const fixture = { ...receipt, status: 'local-fixture', liveMeta: false, fixture: true, injected: true };
    await writeFile(join(directory, 'delivery.json'), JSON.stringify({ ...fixture, sha256: digest(JSON.stringify(fixture)) }));
    await assert.rejects(() => loadAcceptedRoadsterRelease(directory), /delivered live receipt/);
    receipt.report = { ...receipt.report, sha256: 'd'.repeat(64) };
    assert.throws(() => assertLiveDelivery(receipt), /Accepted report hash/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('component ids must match and a drifted id is rejected', () => {
  const id = 'a'.repeat(64);
  const candidateId = 'b'.repeat(64);
  const sessionId = 'fa8e3d4a-8578-4098-8042-f29e607c9267';
  const artifactId = 'c'.repeat(64);
  const component = { provenance: { id }, candidateId, sessionId };
  const artifact = { id: artifactId, componentId: id, component: id, parentArtifactId: null,
    componentRef: { id, kind: 'accepted', candidateId, sessionId } };
  const generation = { componentId: id, parentArtifactId: null, componentRef: { id, kind: 'accepted', candidateId, sessionId } };
  const verification = { passed: true, conformance: { componentId: id }, browser: { componentId: id } };
  const manifest = { componentId: id, parentArtifactId: artifactId, componentRef: { id, kind: 'accepted', candidateId, sessionId } };
  const evidence = { componentId: id, parentArtifactId: artifactId, passed: true, ordinaryOutsideTarget: true, borrowedInsideTarget: true,
    componentRef: { id, kind: 'accepted', candidateId, sessionId } };
  const receipt = { componentId: id, candidateId, sessionId, artifactId };
  assertAcceptedIdentities({ receipt, artifact, component, generation, verification, manifest, evidence });
  assert.throws(() => assertAcceptedIdentities({
    receipt, artifact: { ...artifact, componentId: 'e'.repeat(64) }, component, generation, verification, manifest, evidence,
  }), /Published artifact component drifted/);
});

test('the fresh delivery loads the accepted component and not the saved package', async () => {
  const saved = await loadRecoveredMotion();
  const loaded = await loadAcceptedRoadsterRelease(deliveryDirectory);
  assert.equal(loaded.receipt.status, 'delivered');
  assert.equal(loaded.receipt.liveMeta, true);
  assert.equal(loaded.receipt.fixture, false);
  assert.equal(loaded.receipt.injected, false);
  assert.equal(loaded.component.provenance.id, loaded.receipt.componentId);
  assert.notEqual(loaded.component.provenance.id, saved.provenance.id);
  assert.equal(loaded.component.source, loaded.component.files['component.ts']);
  assert.equal(loaded.artifact.id, loaded.receipt.artifactId);
  assert.equal(loaded.artifact.componentId, loaded.component.provenance.id);
  assert.equal(loaded.challenge.id, loaded.receipt.challengeId);
  assert.equal(loaded.artifact.parentArtifactId, null);
});

test('the pinned delivery loads without a campaign and a malformed package is refused', async () => {
  const saved = await loadRecoveredMotion();
  const isolated = await mkdtemp(join(tmpdir(), 'accepted-pin-'));
  try {
    const copy = join(isolated, 'delivery');
    await cp(pinnedDelivery, copy, { recursive: true });
    const loaded = await loadAcceptedRoadsterRelease(copy);
    const tracked = await loadAcceptedRoadsterRelease(pinnedDelivery);
    assert.equal(loaded.component.provenance.id, acceptedComponentId);
    assert.equal(tracked.component.provenance.id, acceptedComponentId);
    assert.notEqual(loaded.component.provenance.id, saved.provenance.id);
    assert.equal(loaded.component.source, loaded.artifact.component.source);
    assert.equal(loaded.component.source, loaded.component.files['component.ts']);
    assert.equal(loaded.component.source, JSON.parse(loaded.challenge.files['component.json']).source);
    assert.equal(loaded.generation.componentId, acceptedComponentId);
    assert.equal(loaded.challenge.id, loaded.receipt.challengeId);
    const comparison = await acceptedJujumpComparison(loaded.component.provenance.id);
    assert.equal(ACCEPTED_JUJUMP_PUBLICATION, 'f1c783c3994175ac6014d0b5414fc47418f35b868a91122844d9455557971f57');
    assert.equal(comparison.path, '/jujump/index.html');
    assert.equal(JSON.parse(comparison.extras['jujump/config.json']).componentId, acceptedComponentId);
    assert.equal(comparison.extras['jujump/index.html'].includes('id="compare"'), true);
    assert.equal(comparison.extras['evidence/component.ts'], undefined);
    await assert.rejects(() => acceptedJujumpComparison(saved.provenance.id), /does not match the accepted Roadster/);
    await assert.rejects(() => acceptedComponentFromArtifact({}), /Refusing to use the saved component/);
    await assert.rejects(() => acceptedComponentFromArtifact({ component: { source: saved.source } }), /Refusing to use the saved component/);
    const broken = structuredClone(loaded.artifact.component);
    broken.files['component.ts'] += '\n';
    await assert.rejects(() => acceptedComponentFromArtifact({ component: broken }), /Component publication file differs: component\.ts/);
  } finally {
    await rm(isolated, { recursive: true, force: true });
  }
});

test('serve-release stays on loopback and audits before it listens', async () => {
  const source = await readFile(new URL('../scripts/serve-release.mjs', import.meta.url), 'utf8');
  assert.match(source, /host: '127\.0\.0\.1'/);
  assert.equal(source.includes('0.0.0.0'), false);
  assert.equal(source.includes('--host'), true);
  assert.match(source, /auditDirectory/);
  assert.match(source, /createStaticReleaseServer/);
  const help = spawnSync(process.execPath, ['scripts/serve-release.mjs', '--help'], { encoding: 'utf8', cwd: repoRoot });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /node scripts\/serve-release\.mjs --root reports\/release-accepted --port 4173 --base-path \/motion-transfer\//);
  const directory = await mkdtemp(join(tmpdir(), 'serve-release-'));
  try {
    const refused = spawnSync(process.execPath, [
      'scripts/serve-release.mjs', '--root', directory, '--port', '4173', '--base-path', '/',
    ], { encoding: 'utf8', cwd: repoRoot });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /manifest\.json/);
    const host = spawnSync(process.execPath, [
      'scripts/serve-release.mjs', '--root', directory, '--host', '0.0.0.0',
    ], { encoding: 'utf8', cwd: repoRoot });
    assert.notEqual(host.status, 0);
    assert.match(host.stderr, /127\.0\.0\.1 only/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
