import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFrontend } from '../web/build.mjs';
import { buildDonorFrame } from '../web/donor-frame.mjs';
import { loadRecoveredMotion } from '../component/load.mjs';
import { loadSavedRoadster } from '../roadster/saved.mjs';
import { buildRoadsterChallenge } from '../roadster/challenge.mjs';
import { buildRoadsterFrame } from '../roadster/build.mjs';
import { sha256 } from './sha.mjs';
import { loadLabRemixChain } from './lab-chain.mjs';
import { normalizePublicOrigin } from './share.mjs';
import { reportInject } from './materialize.mjs';
import { buildReleasePlayer } from './player-bundle.mjs';
import { loadSuppliedChallenge } from './supplied.mjs';

const savedRoot = fileURLToPath(new URL('../transfers/roadster/versions/', import.meta.url));

export function roadsterVersion(artifact, manifestBytes, origin) {
  const verification = artifact.files['verification.json'];
  return {
    id: artifact.id, kind: artifact.parentArtifactId ? 'roadster-remix' : 'roadster-transfer',
    title: artifact.parentArtifactId ? artifact.summary : (origin === 'accepted-roadster' ? 'Accepted Roadster transfer' : 'Saved Roadster transfer'),
    summary: artifact.summary, parentArtifactId: artifact.parentArtifactId || null,
    componentId: artifact.componentId, intent: artifact.intent, protocol: 'roadster', origin,
    model: artifact.model ?? null,
    estimatedCostUsd: Number.isFinite(artifact.estimatedCostUsd) ? artifact.estimatedCostUsd : null,
    estimatedGenerationCostUsd: Number.isFinite(artifact.estimatedGenerationCostUsd) ? artifact.estimatedGenerationCostUsd : null,
    frame: artifact.files['frame.html'], notices: artifact.files['notices.txt'], adapter: artifact.files['adapter.ts'],
    sourceBytes: manifestBytes, evidenceName: 'verification.json', evidenceBytes: verification,
    zipFiles: artifact.files, report: origin === 'transfers/roadster' || origin === 'accepted-roadster' ? reportInject(verification) : null,
  };
}

export async function collectRelease({
  publicOrigin = process.env.RELEASE_PUBLIC_ORIGIN ?? null,
  extraArtifacts = null,
  challengeDirectory = null,
  acceptedRoadster = null,
  recipient = 'roadster', liveDirectory = null, featuredId = null, taskEvidence = null, reuseBaseline = false,
} = {}) {
  if(recipient==='parallaxia'){if(acceptedRoadster||extraArtifacts||challengeDirectory)throw Error('PARALLAXIA requires its own publication inputs');return (await import('./parallaxia.mjs')).collectParallaxiaRelease({liveDirectory,featuredId,publicOrigin,taskEvidence,reuseBaseline});}
  if(recipient!=='roadster')throw Error('Unknown release recipient');
  if (acceptedRoadster) {
    if (extraArtifacts || challengeDirectory) {
      throw Error('An accepted Roadster release does not take a saved challenge or extra artifacts');
    }
    const { collectAcceptedRelease } = await import('./accepted.mjs');
    return collectAcceptedRelease({ publicOrigin, acceptedRoadster }, { roadsterVersion });
  }
  const origin = normalizePublicOrigin(publicOrigin);
  const savedComponent = new URL('../components/dashy-dango-dash/', import.meta.url);
  const [component, notice, provenance, contract, componentSource, history, evidence, acceptance, style] = await Promise.all([
    loadRecoveredMotion(),
    readFile(new URL('../targets/dashy-dango/NOTICE.txt', import.meta.url)),
    readFile(new URL('provenance.json', savedComponent), 'utf8'),
    readFile(new URL('contract.json', savedComponent), 'utf8'),
    readFile(new URL('component.ts', savedComponent), 'utf8'),
    readFile(new URL('recovery-history.json', savedComponent), 'utf8'),
    readFile(new URL('evidence.json', savedComponent), 'utf8'),
    readFile(new URL('evaluation-acceptance.json', savedComponent), 'utf8'),
    readFile(new URL('../web/style.css', import.meta.url), 'utf8'),
  ]);
  assert.equal(componentSource, component.source);
  const saved = await loadSavedRoadster();
  const savedFrame = join(savedRoot, saved.id, 'frame.html');
  const savedHash = sha256(await readFile(savedFrame));
  const { chain, warnings } = await loadLabRemixChain();
  const chainHashes = new Map(await Promise.all(chain.map(async item => {
    const path = fileURLToPath(new URL('../reports/lab/artifacts/' + item.id + '/frame.html', import.meta.url));
    return [path, sha256(await readFile(path))];
  })));
  let featured;
  if (challengeDirectory) {
    featured = await loadSuppliedChallenge(challengeDirectory, saved);
    warnings.push('Featured challenge files were read from a supplied directory. This copy does not claim a new recovery.');
  } else {
    const challenge = await buildRoadsterChallenge({ parent: saved });
    const evidence = JSON.parse(challenge.files['challenge.json']);
    assert.equal(challenge.parentArtifactId, saved.id);
    assert.equal(challenge.componentId, component.provenance.id);
    assert.equal(evidence.ordinaryOutsideTarget, true);
    assert.equal(evidence.borrowedInsideTarget, true);
    assert.equal(evidence.frameSha256, sha256(challenge.files['play.html']));
    featured = {
      id: challenge.id, kind: 'roadster-challenge', protocol: 'challenge', origin: 'built-challenge',
      title: 'Land in the green zone', summary: evidence.scope,
      parentArtifactId: saved.id, componentId: challenge.componentId, intent: challenge.intent,
      frame: challenge.files['play.html'], notices: challenge.files['notices.txt'], adapter: challenge.files['adapter.ts'],
      sourceBytes: challenge.files['manifest.json'], evidenceName: 'challenge.json', evidenceBytes: challenge.files['challenge.json'],
      zipFiles: challenge.files, report: null,
      api: {
        target: challenge.challenge.target,
        ordinaryOutsideTarget: evidence.ordinaryOutsideTarget,
        borrowedInsideTarget: evidence.borrowedInsideTarget,
        measurements: {
          baselineLandingX: evidence.measurement.baseline.landing.position.x,
          transferredLandingX: evidence.measurement.transferred.landing.position.x,
          netLandingShiftMeters: evidence.netLandingShiftMeters,
          maxVerticalDifference: evidence.maxVerticalDifference,
          durationSeconds: evidence.measurement.controls.length / 60,
        },
      },
    };
  }
  const [donor, original, appJs, playerJs, savedManifest] = await Promise.all([
    buildDonorFrame(),
    buildRoadsterFrame(),
    buildFrontend(),
    buildReleasePlayer(),
    readFile(join(savedRoot, saved.id, 'manifest.json')),
  ]);
  assert.equal(sha256(await readFile(savedFrame)), savedHash, 'Saved Roadster frame changed while building the release');
  for (const [path, hash] of chainHashes) assert.equal(sha256(await readFile(path)), hash, 'Lab artifact changed while building the release');
  const parent = roadsterVersion(saved, savedManifest, 'transfers/roadster');
  const versions = [featured, parent];
  const seen = new Set(versions.map(version => version.id));
  const addChain = (items, source) => {
    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      versions.push(roadsterVersion({ ...item, parentArtifactId: item.parentArtifactId, files: item.files, summary: item.summary, intent: item.intent, componentId: item.componentId, id: item.id }, item.manifestBytes, source));
    }
  };
  addChain(chain, 'reports/lab/artifacts');
  let remixChain = chain.map(item => item.id);
  if (extraArtifacts) {
    const extra = await loadLabRemixChain(extraArtifacts);
    warnings.push(...extra.warnings.map(item => 'extra-artifacts: ' + item));
    addChain(extra.chain, extraArtifacts);
    if (remixChain.length < 2 && extra.chain.length >= 2) remixChain = extra.chain.map(item => item.id);
  }
  return {
    publicOrigin: origin, recovery: 'saved', componentId: component.provenance.id, featuredId: featured.id, warnings,
    remixChain, versions,
    shell: { css: style, appJs, playerJs },
    extras: {
      'NOTICE.txt': notice,
      'evidence/provenance.json': provenance,
      'evidence/contract.json': contract,
      'evidence/component.ts': componentSource,
      'evidence/recovery-history.json': history,
      'evidence/evidence.json': evidence,
      'evidence/evaluation-acceptance.json': acceptance,
      'donor/play.html': donor,
      'roadster/play.html': original.html,
      ['roadster/artifacts/' + saved.id + '/play.html']: saved.files['frame.html'],
    },
  };
}
