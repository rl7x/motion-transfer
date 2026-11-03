import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const ACCEPTED_ARTIFACT_ID = '216a2c7621dedf133de9d45f464cb478956f376a07b0ead9212d453b6eb8069c';
export const ACCEPTED_COMPONENT_ID = '544657417fe9752f91b0b72a451cd9cb8d2650839824be35881e52f81f223858';
export const ACCEPTED_CANDIDATE_ID = 'accf3a817133ddc94b9d2c00de1a87f18aab34c6bb7d8b3f9ae66b4cedc18c0f';
export const ACCEPTED_PUBLICATION_ID = 'f1c783c3994175ac6014d0b5414fc47418f35b868a91122844d9455557971f57';
export const WONDER_REPORT_SHA256 = 'aa6b3cf7c82f88102242356fa5aab2f3cb9e9f8a4e61f069e6251aecf598cf76';
export const FIDELITY_STUDY_ID = 'f8ced9b80f59333d528caa226ae8576643d465293e8b64a33dd9c5fdc783f1c5';
export const REMIX_CAMPAIGN_ID = 'c1655c4c-221d-487f-b05f-c1d667c05b39';
export const CHOSEN_EXPERIMENT_ID = 'experiment-9699b756-a38d-42bb-8ffb-2d6a2a274f3e';

const ADAPTER_COST = 0.008666;
const WONDER_COST = 1.689036;
const FIDELITY_COST = 0.02293425;
const REMIX_COST = 0.06688125;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function same(actual, expected) {
  return Math.abs(Number(actual) - expected) < 1e-9;
}

function requireValue(label, actual, expected) {
  if (actual !== expected) throw Error(label + ' does not match the pinned record');
}

function requireCost(label, actual, expected) {
  if (!same(actual, expected)) throw Error(label + ' does not match the pinned record');
}

export function usd(value) {
  return '$' + Number(value).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

export function assertAcceptedProof(proof) {
  if (!proof || typeof proof !== 'object') throw Error('Accepted proof is missing');
  if (proof.accepted === true && proof.componentId !== ACCEPTED_COMPONENT_ID) {
    throw Error('An accepted flag is not the Roadster proof');
  }
  requireValue('artifact', proof.artifactId, ACCEPTED_ARTIFACT_ID);
  requireValue('component', proof.componentId, ACCEPTED_COMPONENT_ID);
  requireValue('candidate', proof.candidateId, ACCEPTED_CANDIDATE_ID);
  requireValue('publication', proof.publicationId, ACCEPTED_PUBLICATION_ID);
  requireValue('report', proof.reportSha256, WONDER_REPORT_SHA256);
  if (proof.liveMeta !== true || proof.fixture !== false || proof.injected !== false) {
    throw Error('Roadster delivery flags do not match the pin');
  }
  if (proof.zone?.ordinaryOutside !== true || proof.zone?.borrowedInside !== true) {
    throw Error('Zone checks did not both pass');
  }
  requireValue('conformance', proof.conformance, 8);
  requireValue('browser', proof.browser, 8);
  requireCost('adapter cost', proof.adapterCostUsd, ADAPTER_COST);
  requireCost('wonder cost', proof.wonder?.costUsd, WONDER_COST);
  requireValue('development', proof.wonder?.development?.join(','), '0/13,11/13,13/13');
  requireValue('acceptance', proof.wonder?.acceptance, '20/20');
  requireValue('campaign deliveries', proof.wonder?.acceptedDeliveries, 0);
  requireValue('campaign failure', proof.wonder?.failureCategory, 'recipient-or-export');
  if (proof.wonder?.campaignStatus !== 'failed' || proof.wonder?.offlineDelivery !== true || proof.wonder?.metaCalled !== false) {
    throw Error('Publication failure and later offline delivery do not both match');
  }
  requireValue('experiment', proof.wonder?.experimentId, CHOSEN_EXPERIMENT_ID);
  requireValue('fidelity study', proof.fidelity?.studyId, FIDELITY_STUDY_ID);
  requireValue('fidelity input', proof.fidelity?.inputKind, 'image');
  requireValue('contact sheet', proof.fidelity?.contactPassed + '/' + proof.fidelity?.contactTotal, '0/40');
  requireValue('saved recovery', proof.fidelity?.savedPassed + '/' + proof.fidelity?.savedTotal, '40/40');
  requireCost('fidelity cost', proof.fidelity?.costUsd, FIDELITY_COST);
  requireValue('remix campaign', proof.remixCampaign?.id, REMIX_CAMPAIGN_ID);
  requireValue('remix outcomes', proof.remixCampaign?.completed + '/' + proof.remixCampaign?.matched + '/' + proof.remixCampaign?.negatives, '8/6/2');
  requireCost('remix cost', proof.remixCampaign?.costUsd, REMIX_COST);
  if (!proof.remixCampaign?.olderComponentId || proof.remixCampaign.olderComponentId === proof.componentId) {
    throw Error('Remix campaign is not labeled with the older saved component');
  }
  if (!proof.playSha256 || !proof.projectSha256 || !proof.fidelity?.svgSha256) {
    throw Error('Accepted proof is missing recorded file hashes');
  }
  return proof;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function passedCount(results) {
  return (results ?? []).filter(item => item.passed === true).length;
}

export async function loadAcceptedRoadster(root) {
  const artifactDir = join(root, 'assets/transfers/roadster/accepted', ACCEPTED_ARTIFACT_ID);
  const publicationDir = join(root, 'assets/integration/recordings/recoveries', ACCEPTED_PUBLICATION_ID);
  const fidelityDir = join(root, 'assets/benchmark/fidelity-recordings', FIDELITY_STUDY_ID);
  const remixDir = join(root, 'assets/benchmark/remix-recordings', REMIX_CAMPAIGN_ID);
  const wonderDir = join(root, 'reports/motion-transfer-phase/wonder-development-001');
  const delivery = await readJson(join(artifactDir, 'delivery.json'));
  const journal = await readJson(join(artifactDir, 'journal.json'));
  const challenge = await readJson(join(artifactDir, 'challenge/challenge.json'));
  const challengeManifest = await readJson(join(artifactDir, 'challenge/manifest.json'));
  const publishedManifest = await readJson(join(artifactDir, 'published/artifacts', ACCEPTED_ARTIFACT_ID, 'manifest.json'));
  const generation = await readJson(join(artifactDir, 'published/artifacts', ACCEPTED_ARTIFACT_ID, 'generation.json'));
  const verification = await readJson(join(artifactDir, 'published/artifacts', ACCEPTED_ARTIFACT_ID, 'verification.json'));
  const receipt = await readJson(join(publicationDir, 'receipt.json'));
  const validation = await readJson(join(publicationDir, 'validation.json'));
  const projectBytes = await readFile(join(publicationDir, 'project.json'));
  const project = JSON.parse(projectBytes.toString('utf8'));
  const reportPath = join(wonderDir, 'reports', WONDER_REPORT_SHA256 + '.json');
  const reportBytes = await readFile(reportPath);
  const report = JSON.parse(reportBytes.toString('utf8'));
  const wonderJournal = await readJson(join(wonderDir, 'journal.json'));
  const session = await readJson(join(wonderDir, 'sessions/fa8e3d4a-8578-4098-8042-f29e607c9267/journal.json'));
  const fidelityComparison = await readJson(join(fidelityDir, 'fidelity-comparison.json'));
  const fidelityJournal = await readJson(join(fidelityDir, 'journal.json'));
  const fidelityRecording = await readJson(join(fidelityDir, 'recording.json'));
  const svgBytes = await readFile(join(fidelityDir, 'fidelity-comparison.svg'));
  const remixChecks = await readJson(join(remixDir, 'checks.json'));
  const savedProvenance = await readJson(join(root, 'assets/components/dashy-dango-dash/provenance.json'));
  const playBytes = await readFile(join(artifactDir, 'challenge/play.html'));

  requireValue('delivery status', delivery.status, 'delivered');
  requireValue('delivery artifact', delivery.artifactId, ACCEPTED_ARTIFACT_ID);
  requireValue('delivery component', delivery.componentId, ACCEPTED_COMPONENT_ID);
  requireValue('delivery candidate', delivery.candidateId, ACCEPTED_CANDIDATE_ID);
  requireValue('delivery report', delivery.report?.sha256, WONDER_REPORT_SHA256);
  if (delivery.liveMeta !== true || delivery.fixture !== false || delivery.injected !== false) {
    throw Error('Delivery flags are not live, non-fixture, and non-injected');
  }
  requireValue('journal outcome', journal.summary?.outcome, 'delivered');
  requireValue('journal artifact', journal.summary?.artifactId, ACCEPTED_ARTIFACT_ID);
  requireValue('journal component', journal.summary?.componentId, ACCEPTED_COMPONENT_ID);
  if (journal.summary?.fixture !== false || journal.summary?.injected !== false) {
    throw Error('Adapter journal is not a live non-fixture delivery');
  }
  requireCost('adapter journal', journal.summary?.estimatedCostUsd, ADAPTER_COST);
  requireCost('adapter generation', generation.estimatedCostUsd, ADAPTER_COST);
  requireValue('adapter model', generation.model, 'muse-spark-1.3');
  requireValue('published component', publishedManifest.componentId, ACCEPTED_COMPONENT_ID);
  if (verification.passed !== true || verification.conformance?.passed !== true || verification.browser?.passed !== true) {
    throw Error('Published verification did not pass');
  }
  requireValue('conformance count', verification.conformance?.results?.length, 8);
  requireValue('browser count', verification.browser?.results?.length, 8);
  if (challenge.passed !== true || challenge.ordinaryOutsideTarget !== true || challenge.borrowedInsideTarget !== true) {
    throw Error('Pinned challenge did not record both zone results');
  }
  requireValue('challenge component', challenge.componentId, ACCEPTED_COMPONENT_ID);
  requireValue('challenge conformance', challenge.conformance?.results?.length, 8);
  requireValue('play.html', sha256(playBytes), challengeManifest.files?.['play.html']);
  requireValue('receipt', receipt.id, ACCEPTED_PUBLICATION_ID);
  requireValue('receipt component', receipt.componentId, ACCEPTED_COMPONENT_ID);
  requireValue('receipt candidate', receipt.candidateId, ACCEPTED_CANDIDATE_ID);
  requireValue('project hash', sha256(projectBytes), receipt.projectSha256);
  requireValue('project component', project.caseStudy?.componentId, ACCEPTED_COMPONENT_ID);
  if (validation.passed !== true || validation.metaCalled !== false || validation.componentId !== ACCEPTED_COMPONENT_ID) {
    throw Error('Offline JUJUMP validation does not match the publication');
  }
  requireValue('report hash', sha256(reportBytes), WONDER_REPORT_SHA256);
  requireValue('report model', report.model, 'muse-wonder-1.0');
  requireCost('wonder journal', wonderJournal.summary?.estimatedCostUsd, WONDER_COST);
  requireCost('wonder report', report.estimatedCostUsd, WONDER_COST);
  requireValue('donor acceptances', wonderJournal.summary?.donorAcceptances, 1);
  requireValue('accepted deliveries', wonderJournal.summary?.acceptedDeliveries, 0);
  const trial = wonderJournal.trials?.[0];
  requireValue('campaign status', trial?.status, 'failed');
  requireValue('campaign failure', trial?.failureCategory, 'recipient-or-export');
  const conclusion = String(report.conclusion ?? '');
  for (const phrase of [CHOSEN_EXPERIMENT_ID, '21→0', 'dx 7.5 vs 2', 'frame 1', 'dash lasted 8 frames']) {
    if (!conclusion.includes(phrase)) throw Error('Wonder report is missing the chosen experiment record');
  }
  const attempts = session.recovery?.attempts ?? [];
  const development = attempts.map(attempt => passedCount(attempt.development?.results) + '/' + (attempt.development?.results?.length ?? 0));
  requireValue('development scores', development.join(','), '0/13,11/13,13/13');
  const acceptanceResults = attempts[2]?.acceptance?.results ?? [];
  requireValue('acceptance score', passedCount(acceptanceResults) + '/' + acceptanceResults.length, '20/20');
  requireValue('frozen candidate', session.recovery?.frozenCandidateId, ACCEPTED_CANDIDATE_ID);
  const humanAssistance = project.caseStudy?.recovery?.humanAssistance ?? [];
  if (!humanAssistance.some(item => /boundary/i.test(item) && /motion/i.test(item))) {
    throw Error('Publication does not record the human motion boundary');
  }
  if (!humanAssistance.some(item => /ABI/i.test(item) && /evaluator/i.test(item))) {
    throw Error('Publication does not record the human ABI and evaluator');
  }
  const contact = fidelityComparison.candidates?.find(item => item.condition === 'contact-sheet');
  const saved = fidelityComparison.candidates?.find(item => item.condition === 'saved-recovery');
  requireValue('contact score', contact?.passed + '/' + contact?.total, '0/40');
  requireValue('saved score', saved?.passed + '/' + saved?.total, '40/40');
  requireCost('fidelity cost', fidelityComparison.costs?.totalUsd, FIDELITY_COST);
  requireValue('fidelity input', fidelityJournal.summary?.inputKind, 'image');
  requireValue('fidelity study', fidelityComparison.studyId, FIDELITY_STUDY_ID);
  const svgRecord = fidelityRecording.files?.find(item => item.path === 'fidelity-comparison.svg');
  requireValue('fidelity chart', sha256(svgBytes), svgRecord?.sha256);
  if (!svgBytes.includes(Buffer.from('0/40')) || !svgBytes.includes(Buffer.from('40/40'))) {
    throw Error('Fidelity chart is missing its score labels');
  }
  requireValue('remix campaign', remixChecks.campaignId, REMIX_CAMPAIGN_ID);
  requireValue('remix completed', remixChecks.completed, 8);
  requireValue('remix matched', remixChecks.matched, 6);
  requireValue('remix negatives', remixChecks.expectedNegatives, 2);
  requireCost('remix cost', remixChecks.attemptCostUsd, REMIX_COST);
  requireValue('older component', remixChecks.base?.componentId, savedProvenance.id);
  if (savedProvenance.id === ACCEPTED_COMPONENT_ID) throw Error('Saved component id collided with the accepted component');

  return assertAcceptedProof({
    artifactId: ACCEPTED_ARTIFACT_ID,
    componentId: ACCEPTED_COMPONENT_ID,
    candidateId: ACCEPTED_CANDIDATE_ID,
    publicationId: ACCEPTED_PUBLICATION_ID,
    reportSha256: WONDER_REPORT_SHA256,
    liveMeta: true,
    fixture: false,
    injected: false,
    conformance: 8,
    browser: 8,
    adapterCostUsd: ADAPTER_COST,
    adapterModel: 'muse-spark-1.3',
    playSha256: sha256(playBytes),
    projectSha256: receipt.projectSha256,
    challengeDir: join(artifactDir, 'challenge'),
    publicationProject: join(publicationDir, 'project.json'),
    zone: {
      ordinaryOutside: true,
      borrowedInside: true,
      baselineX: challenge.measurement.baseline.landing.position.x,
      transferredX: challenge.measurement.transferred.landing.position.x,
      shift: challenge.netLandingShiftMeters,
      targetMin: challenge.measurement.target.minX,
      targetMax: challenge.measurement.target.maxX,
    },
    wonder: {
      costUsd: WONDER_COST,
      model: 'muse-wonder-1.0',
      experimentId: CHOSEN_EXPERIMENT_ID,
      development,
      acceptance: '20/20',
      acceptedDeliveries: 0,
      donorAcceptances: 1,
      campaignStatus: 'failed',
      failureCategory: 'recipient-or-export',
      offlineDelivery: true,
      metaCalled: false,
      humanAssistance,
    },
    fidelity: {
      studyId: FIDELITY_STUDY_ID,
      costUsd: FIDELITY_COST,
      inputKind: 'image',
      contactPassed: 0,
      contactTotal: 40,
      savedPassed: 40,
      savedTotal: 40,
      contactLabel: contact.label,
      savedLabel: saved.label,
      svgPath: join(fidelityDir, 'fidelity-comparison.svg'),
      svgSha256: svgRecord.sha256,
    },
    remixCampaign: {
      id: REMIX_CAMPAIGN_ID,
      completed: 8,
      matched: 6,
      negatives: 2,
      costUsd: REMIX_COST,
      olderComponentId: savedProvenance.id,
    },
  });
}
