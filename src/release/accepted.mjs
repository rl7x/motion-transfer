import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { readAcceptedRoadster } from '../campaign/accepted-roadster.mjs';
import { digest } from '../component/build.mjs';
import { resolveComponentRef } from '../component/reference.mjs';
import { loadAcceptedComponent } from '../integration/accepted-component.mjs';
import { createIntegrationPublication } from '../integration/publication.mjs';
import { readRoadsterArtifact } from '../roadster/artifact.mjs';
import { buildFrontend } from '../../web/build.mjs';
import { buildDonorFrame } from '../../web/donor-frame.mjs';
import { normalizePublicOrigin } from './share.mjs';
import { buildReleasePlayer } from './player-bundle.mjs';

const hex64 = /^[a-f0-9]{64}$/;
const reportPath = /^reports\/[a-f0-9]{64}\.json$/;
export const ACCEPTED_JUJUMP_PUBLICATION = 'f1c783c3994175ac6014d0b5414fc47418f35b868a91122844d9455557971f57';

function evidenceExtras(files) {
  const extras = {
    'evidence/component.ts': files['component.ts'],
    'evidence/provenance.json': files['provenance.json'],
    'evidence/contract.json': files['contract.json'],
  };
  for (const name of ['recovery-history.json', 'evidence.json', 'evaluation-acceptance.json']) {
    if (typeof files[name] === 'string') extras['evidence/' + name] = files[name];
  }
  return extras;
}

/** A requested accepted release must be a live delivered receipt. Fixture and injected runs stop here. */
export function assertLiveDelivery(receipt) {
  if (receipt?.kind !== 'accepted-roadster-delivery' || receipt.status !== 'delivered'
    || receipt.liveMeta !== true || receipt.fixture !== false || receipt.injected !== false) {
    throw Error('Accepted release requires a delivered live receipt');
  }
  if (receipt.parentArtifactId !== null || receipt.ordinaryOutsideTarget !== true || receipt.borrowedInsideTarget !== true) {
    throw Error('Accepted release receipt does not bind a new adapter with both landing results');
  }
  assert.match(receipt.componentId, hex64, 'Accepted component id');
  assert.match(receipt.candidateId, hex64, 'Accepted candidate id');
  assert.match(receipt.artifactId, hex64, 'Accepted artifact id');
  assert.match(receipt.challengeId, hex64, 'Accepted challenge id');
  assert.match(receipt.protocolId, hex64, 'Accepted protocol id');
  assert.match(receipt.sessionId, /^[a-f0-9-]{36}$/, 'Accepted session id');
  assert.match(receipt.campaignId, /^[a-f0-9-]{36}$/, 'Accepted campaign id');
  assert.match(receipt.trialId, /^[a-f0-9-]{36}$/, 'Accepted trial id');
  assert.match(receipt.report?.path ?? '', reportPath, 'Accepted report path');
  assert.equal(receipt.report.sha256, receipt.report.path.slice('reports/'.length, -'.json'.length), 'Accepted report hash');
}

export function assertAcceptedIdentities({ receipt, artifact, component, generation, verification, manifest, evidence }) {
  const id = component.provenance.id;
  assert.equal(id, receipt.componentId, 'Accepted component does not match the delivery receipt');
  assert.equal(component.candidateId, receipt.candidateId, 'Accepted candidate does not match the delivery receipt');
  assert.equal(component.sessionId, receipt.sessionId, 'Accepted session does not match the delivery receipt');
  assert.equal(artifact.id, receipt.artifactId, 'Published artifact does not match the delivery receipt');
  assert.equal(artifact.componentId, id, 'Published artifact component drifted');
  if (typeof artifact.component === 'string') assert.equal(artifact.component, id, 'Published artifact component drifted');
  else if (artifact.component != null) {
    assert.equal(artifact.component.provenance?.id ?? artifact.component.id, id, 'Published artifact component drifted');
    if (typeof artifact.component.source === 'string') {
      assert.equal(artifact.component.source, component.source, 'Published artifact component bytes drifted');
    }
  }
  assert.equal(artifact.parentArtifactId, null, 'A first adapter must not name a saved parent');
  assert.equal(artifact.componentRef?.id, id, 'Published artifact component drifted');
  assert.equal(artifact.componentRef?.kind, 'accepted', 'Published artifact component drifted');
  assert.equal(artifact.componentRef?.candidateId, component.candidateId, 'Published artifact candidate drifted');
  assert.equal(artifact.componentRef?.sessionId, component.sessionId, 'Published artifact session drifted');
  assert.equal(generation.componentId, id, 'Published generation component drifted');
  assert.equal(generation.componentRef?.id, id, 'Published generation component drifted');
  assert.equal(generation.componentRef?.kind, 'accepted', 'Published generation component drifted');
  assert.equal(generation.componentRef?.candidateId, component.candidateId, 'Published generation candidate drifted');
  assert.equal(generation.componentRef?.sessionId, component.sessionId, 'Published generation session drifted');
  assert.equal(generation.parentArtifactId ?? null, null, 'A first adapter must not name a saved parent');
  assert.equal(verification.passed, true, 'Published verification did not pass');
  assert.equal(verification.conformance?.componentId, id, 'Published conformance component drifted');
  assert.equal(verification.browser?.componentId, id, 'Published browser component drifted');
  assert.equal(manifest.componentId, id, 'Challenge component drifted');
  assert.equal(manifest.parentArtifactId, artifact.id, 'Challenge parent drifted');
  assert.equal(manifest.componentRef?.id, id, 'Challenge component drifted');
  assert.equal(manifest.componentRef?.kind, 'accepted', 'Challenge component drifted');
  assert.equal(manifest.componentRef?.candidateId, component.candidateId, 'Challenge candidate drifted');
  assert.equal(manifest.componentRef?.sessionId, component.sessionId, 'Challenge session drifted');
  assert.equal(evidence.componentId, id, 'Challenge evidence component drifted');
  assert.equal(evidence.parentArtifactId, artifact.id, 'Challenge evidence parent drifted');
  assert.equal(evidence.componentRef?.id, id, 'Challenge evidence component drifted');
  assert.equal(evidence.componentRef?.candidateId, component.candidateId, 'Challenge evidence candidate drifted');
  assert.equal(evidence.componentRef?.sessionId, component.sessionId, 'Challenge evidence session drifted');
  assert.equal(evidence.ordinaryOutsideTarget, true, 'Ordinary run must land outside the marked zone');
  assert.equal(evidence.borrowedInsideTarget, true, 'Borrowed dash must land inside the marked zone');
  assert.equal(evidence.passed, true, 'Challenge evidence did not pass');
}

async function readReceipt(directory) {
  let parsed;
  try { parsed = JSON.parse(await readFile(join(directory, 'delivery.json'), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') throw Error('Accepted Roadster delivery was not found at ' + directory + '. Refusing to use the saved component.');
    throw error;
  }
  const { sha256, ...receipt } = parsed;
  assert.equal(digest(JSON.stringify(receipt)), sha256, 'Accepted delivery receipt hash mismatch');
  assertLiveDelivery(receipt);
  return receipt;
}

/** Resolve the package stored on the artifact. A missing candidate never falls through to the saved dash. */
export async function acceptedComponentFromArtifact(artifact) {
  const component = artifact?.component;
  if (!component || typeof component !== 'object' || Array.isArray(component) || typeof component.candidateId !== 'string') {
    throw Error('Accepted artifact is missing its component package. Refusing to use the saved component.');
  }
  return resolveComponentRef(component);
}

/** A sibling report is an extra check. No sibling is a complete delivery, not a missing dependency. */
async function crossCheckAvailableReport(deliveryDirectory, receipt, component) {
  const root = dirname(resolve(deliveryDirectory));
  let entries = [];
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const campaign = resolve(root, entry.name);
    if (campaign === resolve(deliveryDirectory)) continue;
    const reportFile = join(campaign, receipt.report.path);
    const publication = join(campaign, 'sessions', receipt.sessionId, 'components', receipt.candidateId, 'publication.json');
    try {
      const bytes = await readFile(reportFile);
      if (digest(bytes) !== receipt.report.sha256) continue;
      await readFile(publication);
      found.push(campaign);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (found.length > 1) throw Error('Accepted component package is ambiguous for this delivery. Refusing to use the saved component.');
  if (found.length !== 1) return;
  const report = JSON.parse(await readFile(join(found[0], receipt.report.path), 'utf8'));
  const published = await resolveComponentRef(await loadAcceptedComponent(found[0], report));
  if (published.source !== component.source || published.provenance.id !== component.provenance.id
    || published.candidateId !== component.candidateId || published.sessionId !== component.sessionId) {
    throw Error('Accepted report component does not match the artifact package. Refusing to use the saved component.');
  }
}

export async function acceptedJujumpComparison(componentId) {
  const publication = createIntegrationPublication(join(tmpdir(), 'accepted-jujump-unused'));
  const published = await publication.read(ACCEPTED_JUJUMP_PUBLICATION);
  if (published.receipt.componentId !== componentId) {
    throw Error('JUJUMP publication component does not match the accepted Roadster');
  }
  const extras = {};
  for (const [name, bytes] of Object.entries(published.project.files)) {
    if (typeof name !== 'string' || name === '' || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || name.split('/').includes('')) {
      throw Error('JUJUMP file escapes the publication');
    }
    extras['jujump/' + name] = bytes;
  }
  const page = extras['jujump/index.html'];
  const config = JSON.parse(extras['jujump/config.json'] ?? 'null');
  if (typeof page !== 'string' || !page.includes('id="compare"') || config?.componentId !== componentId) {
    throw Error('JUJUMP publication component does not match the accepted Roadster');
  }
  return { path: '/jujump/index.html', extras };
}

/** Load one accepted-roadster delivery. A failure stops; this never reads the saved component package. */
export async function loadAcceptedRoadsterRelease(directory) {
  const receipt = await readReceipt(directory);
  const campaign = await readAcceptedRoadster(directory);
  const input = campaign.definition.input;
  assert.deepEqual(input.report, receipt.report, 'Delivery report does not match the journal');
  assert.equal(input.protocolId, receipt.protocolId, 'Delivery protocol does not match the journal');
  assert.equal(input.sessionId, receipt.sessionId, 'Delivery session does not match the journal');
  assert.equal(input.candidateId, receipt.candidateId, 'Delivery candidate does not match the journal');
  assert.equal(input.componentId, receipt.componentId, 'Delivery component does not match the journal');
  assert.equal(input.trialId, receipt.trialId, 'Delivery trial does not match the journal');
  assert.equal(input.recoveryCampaignId, receipt.campaignId, 'Delivery campaign does not match the journal');
  assert.equal(input.parentArtifactId, null, 'Delivery journal names a saved parent');
  assert.equal(input.fixture, false, 'Delivery journal is a fixture');
  assert.equal(campaign.definition.recoveryCampaignId, receipt.campaignId);
  assert.equal(campaign.status, 'complete', 'Accepted Roadster journal is not complete');
  assert.equal(campaign.job?.status, 'complete', 'Accepted Roadster job is not complete');
  assert.equal(campaign.job.outcome, 'delivered', 'Accepted Roadster job was not delivered');
  assert.equal(campaign.job.injected, false, 'Accepted Roadster job was injected');
  assert.equal(campaign.job.artifactId, receipt.artifactId, 'Delivery artifact does not match the journal');
  assert.equal(campaign.job.challengeId, receipt.challengeId, 'Delivery challenge does not match the journal');
  assert.equal(campaign.summary?.componentId, receipt.componentId, 'Delivery component does not match the journal summary');
  assert.equal(campaign.summary?.outcome, 'delivered');
  assert.equal(campaign.summary?.fixture, false);
  assert.equal(campaign.summary?.injected, false);

  const artifact = await readRoadsterArtifact(join(directory, 'published', 'artifacts'), receipt.artifactId);
  const component = await acceptedComponentFromArtifact(artifact);
  await crossCheckAvailableReport(directory, receipt, component);
  const manifestText = await readFile(join(directory, 'challenge', 'manifest.json'), 'utf8');
  const manifestRecord = JSON.parse(manifestText);
  const { id: challengeId, ...manifest } = manifestRecord;
  assert.equal(digest(JSON.stringify(manifest)), challengeId, 'Challenge manifest hash mismatch');
  assert.equal(challengeId, receipt.challengeId, 'Challenge manifest does not match the delivery receipt');
  const files = { 'manifest.json': manifestText };
  for (const [name, hash] of Object.entries(manifestRecord.files ?? {})) {
    if (name.includes('..') || name.includes('/') || name.includes('\\')) throw Error('Challenge file escapes the directory');
    const bytes = await readFile(join(directory, 'challenge', name), 'utf8');
    assert.equal(digest(bytes), hash, 'Challenge file hash mismatch: ' + name);
    files[name] = bytes;
  }
  for (const name of ['play.html', 'challenge.json', 'adapter.ts', 'notices.txt', 'component.json']) {
    if (typeof files[name] !== 'string') throw Error('Accepted challenge is missing ' + name);
  }
  assert.equal(digest(files['adapter.ts']), digest(artifact.files['adapter.ts']), 'Challenge adapter does not match the published artifact');
  const evidence = JSON.parse(files['challenge.json']);
  const publishedComponent = JSON.parse(files['component.json']);
  if (publishedComponent.source !== component.source || publishedComponent.provenance?.id !== component.provenance.id
    || publishedComponent.candidateId !== component.candidateId || publishedComponent.sessionId !== component.sessionId) {
    throw Error('Challenge component bytes do not match the accepted publication');
  }
  const generation = JSON.parse(artifact.files['generation.json']);
  const verification = JSON.parse(artifact.files['verification.json']);
  assertAcceptedIdentities({ receipt, artifact, component, generation, verification, manifest, evidence });
  return { receipt, component, artifact, challenge: { id: challengeId, manifest, files, evidence }, generation };
}

export async function collectAcceptedRelease({ publicOrigin = null, acceptedRoadster }, { roadsterVersion }) {
  const loaded = await loadAcceptedRoadsterRelease(acceptedRoadster);
  const comparison = await acceptedJujumpComparison(loaded.component.provenance.id);
  const origin = normalizePublicOrigin(publicOrigin);
  const evidence = loaded.challenge.evidence;
  const baseline = evidence.measurement?.baseline?.landing?.position?.x;
  const transferred = evidence.measurement?.transferred?.landing?.position?.x;
  if (!Number.isFinite(baseline) || !Number.isFinite(transferred)) throw Error('Accepted challenge is missing landing measurements');
  const [notice, style, donor, appJs, playerJs, manifestBytes] = await Promise.all([
    readFile(new URL('../../assets/targets/dashy-dango/NOTICE.txt', import.meta.url)),
    readFile(new URL('../../web/style.css', import.meta.url), 'utf8'),
    buildDonorFrame(),
    buildFrontend(),
    buildReleasePlayer(),
    readFile(join(acceptedRoadster, 'published', 'artifacts', loaded.artifact.id, 'manifest.json'), 'utf8'),
  ]);
  const cost = loaded.generation.estimatedCostUsd;
  const artifact = {
    ...loaded.artifact,
    model: typeof loaded.generation.model === 'string' ? loaded.generation.model : null,
    estimatedCostUsd: Number.isFinite(cost) ? cost : null,
    estimatedGenerationCostUsd: Number.isFinite(cost) ? cost : null,
  };
  const parent = roadsterVersion(artifact, manifestBytes, 'accepted-roadster');
  const featured = {
    id: loaded.challenge.id, kind: 'roadster-challenge', protocol: 'challenge', origin: 'accepted-roadster',
    title: 'Land in the green zone', summary: typeof evidence.scope === 'string' ? evidence.scope : 'Accepted Roadster challenge',
    parentArtifactId: artifact.id, componentId: loaded.component.provenance.id, intent: loaded.challenge.manifest.intent,
    frame: loaded.challenge.files['play.html'], notices: loaded.challenge.files['notices.txt'], adapter: loaded.challenge.files['adapter.ts'],
    sourceBytes: loaded.challenge.files['manifest.json'], evidenceName: 'challenge.json', evidenceBytes: loaded.challenge.files['challenge.json'],
    zipFiles: loaded.challenge.files, report: null,
    api: {
      target: evidence.measurement?.target ?? evidence.target ?? null,
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
  return {
    publicOrigin: origin, recovery: 'accepted', componentId: loaded.component.provenance.id,
    featuredId: featured.id, warnings: [], remixChain: [], versions: [featured, parent],
    jujumpComparison: comparison.path,
    shell: { css: style, appJs, playerJs },
    extras: {
      'NOTICE.txt': notice,
      'donor/play.html': donor,
      ['roadster/artifacts/' + artifact.id + '/play.html']: artifact.files['frame.html'],
      ...evidenceExtras(loaded.component.files),
      ...comparison.extras,
    },
  };
}
