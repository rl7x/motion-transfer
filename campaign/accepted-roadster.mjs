import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { generateRoadsterTransfer } from '../agent/transfer-roadster.mjs';
import { digest } from '../component/build.mjs';
import { loadAcceptedComponent } from '../integration/accepted-component.mjs';
import { createLabStore } from '../lab/store.mjs';
import { buildRoadsterChallenge } from '../roadster/challenge.mjs';
import { ROADSTER_INTENT } from '../roadster/port.mjs';
import { readRecoveryCampaign } from './recovery-runner.mjs';

export { generateRoadsterTransfer as roadsterGenerator };
export const ACCEPTED_ROADSTER_MAX_USD = 0.05;
export const ACCEPTED_ROADSTER_CATEGORY = 'remix';
export const ACCEPTED_ROADSTER_MODEL = 'muse-spark-1.3';
export const ACCEPTED_ROADSTER_PROMPT = 'Bind the accepted recovered dash to the car as a new adapter. Use the default forward held mapping of 0.1 meters per source pixel. Do not copy a saved adapter.';

const bytesOf = value => JSON.stringify(value, null, 2) + '\n';
const clean = (error, apiKey) => String(error?.message ?? error).split(apiKey || '\0').join('[redacted]').slice(0, 500);
const scrub = (value, apiKey) => value == null ? value : JSON.parse(JSON.stringify(value).split(apiKey || '\0').join('[redacted]'));

function overlaps(parent, child) {
  const relation = relative(parent, child);
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

function uncertainReport(report) {
  if (!report || !Number.isFinite(report.estimatedCostUsd)) return true;
  if ((report.reservedCostUsd ?? 0) > 0) return true;
  return (report.requests ?? []).some(request => request.status !== 'completed');
}

function summarize(campaign) {
  const job = campaign.job;
  return {
    outcome: job.outcome ?? job.status, estimatedCostUsd: job.estimatedCostUsd ?? job.report?.estimatedCostUsd ?? 0,
    artifactId: job.artifactId ?? null, challengeId: job.challengeId ?? null,
    componentId: campaign.definition.input.componentId, fixture: campaign.definition.input.fixture === true,
    injected: job.injected === true, providerRetries: false,
  };
}

/** Same completed-report rule as selectAcceptedTrial. The fixture hook is not a CLI flag. */
export function selectAcceptedRoadsterTrial(campaign, { allowLocalFixture = false } = {}) {
  const accepted = (campaign?.trials ?? []).filter(trial => trial.report?.status === 'completed'
    && Number.isInteger(trial.report.session?.recovery?.acceptedAttempt) && trial.report.session.recovery.acceptedAttempt >= 1);
  if (accepted.length !== 1) throw Error(accepted.length ? 'More than one accepted recovery trial' : 'No completed trial has an accepted candidate');
  const trial = accepted[0];
  const fixture = trial.report.origin === 'local-verification';
  if (fixture && !allowLocalFixture) throw Error('Local fixtures are not accepted recovery deliveries');
  if (allowLocalFixture && !fixture) throw Error('The local fixture hook only admits an explicit local-verification report');
  if (!/^reports\/[a-f0-9]{64}\.json$/.test(trial.reportRef?.path ?? '') || !/^[a-f0-9]{64}$/.test(trial.reportRef?.sha256 ?? '')) {
    throw Error('Accepted trial is missing its exact report');
  }
  const recovery = trial.report.session.recovery;
  const entry = recovery.attempts?.find(item => item.attempt === recovery.acceptedAttempt);
  if (!entry || recovery.frozenCandidateId !== entry.candidateId) throw Error('Accepted candidate must match the frozen identity');
  return trial;
}

export async function readAcceptedRoadster(directory) {
  const { integritySha256, ...campaign } = JSON.parse(await readFile(join(directory, 'journal.json'), 'utf8'));
  assert.equal(digest(JSON.stringify(campaign)), integritySha256, 'Accepted Roadster journal integrity mismatch');
  const { sha256, ...definition } = campaign.definition;
  assert.equal(digest(JSON.stringify(definition)), sha256, 'Accepted Roadster definition changed');
  assert.equal(definition.kind, 'accepted-roadster-transfer');
  assert.equal(definition.category, ACCEPTED_ROADSTER_CATEGORY);
  assert.equal(definition.maxCostUsd, ACCEPTED_ROADSTER_MAX_USD);
  assert.equal(definition.model, ACCEPTED_ROADSTER_MODEL);
  assert.equal(definition.prompt, ACCEPTED_ROADSTER_PROMPT);
  assert.equal(definition.providerRetries, false);
  assert.deepEqual(definition.intent, { ...ROADSTER_INTENT });
  assert.equal(definition.input?.parentArtifactId, null);
  return campaign;
}

function freshParent(component) {
  return { id: null, componentId: component.provenance.id, component, intent: ROADSTER_INTENT, files: {} };
}

/** Defaults match the CLI. A fixture or any caller-supplied client, generator, browser, or challenge hook is not a live delivery. */
export function acceptedRoadsterExecution({
  client, generateTransfer = generateRoadsterTransfer, verifyBrowser, buildChallenge = buildRoadsterChallenge,
  allowLocalFixture = false, fixture = false,
} = {}) {
  const injected = client != null || verifyBrowser != null || allowLocalFixture === true || fixture === true
    || generateTransfer !== generateRoadsterTransfer || buildChallenge !== buildRoadsterChallenge;
  if (fixture === true || allowLocalFixture === true) return { outcome: 'local-fixture', liveMeta: false, injected: true };
  if (injected) return { outcome: 'injected', liveMeta: false, injected: true };
  return { outcome: 'delivered', liveMeta: true, injected: false };
}

function assertAgreement(component, artifact, challenge) {
  const id = component.provenance.id;
  const generation = JSON.parse(artifact.files['generation.json']);
  const verification = JSON.parse(artifact.files['verification.json']);
  const manifest = JSON.parse(challenge.files['manifest.json']);
  assert.equal(artifact.componentId, id, 'Published artifact component drifted');
  assert.equal(artifact.parentArtifactId, null, 'A first adapter must not name a saved parent');
  assert.equal(generation.componentId, id);
  assert.equal(generation.componentRef?.id, id);
  assert.equal(generation.componentRef?.kind, 'accepted');
  assert.equal(generation.componentRef?.candidateId, component.candidateId);
  assert.equal(generation.componentRef?.sessionId, component.sessionId);
  assert.equal(verification.passed, true);
  assert.equal(verification.conformance?.componentId, id);
  assert.equal(verification.browser?.componentId, id);
  assert.equal(challenge.componentId, id);
  assert.equal(challenge.parentArtifactId, artifact.id);
  assert.equal(challenge.verification.componentId, id);
  assert.equal(challenge.verification.componentRef.id, id);
  assert.equal(challenge.verification.componentRef.kind, 'accepted');
  assert.equal(challenge.verification.componentRef.candidateId, component.candidateId);
  assert.equal(challenge.verification.componentRef.sessionId, component.sessionId);
  assert.equal(challenge.verification.ordinaryOutsideTarget, true, 'Ordinary run must land outside the marked zone');
  assert.equal(challenge.verification.borrowedInsideTarget, true, 'Borrowed dash must land inside the marked zone');
  assert.equal(manifest.componentId, id);
  assert.equal(manifest.componentRef.candidateId, component.candidateId);
  assert.equal(manifest.parentArtifactId, artifact.id);
  assert.equal(digest(challenge.files['adapter.ts']), digest(artifact.files['adapter.ts']));
}

async function writeFresh(directory, files) {
  await mkdir(directory, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    if (typeof bytes !== 'string' || !/^[a-z0-9.-]+$/i.test(name)) throw Error('Invalid challenge output: ' + name);
    await writeFile(join(directory, name), bytes, { flag: 'wx' });
  }
}

/**
 * One Roadster adapter for an already accepted recovery component.
 * allowLocalFixture is a test hook for an explicit local-verification report. The CLI never sets it.
 * A supplied client, generator, browser gate, or challenge builder is injected and cannot be recorded as delivered.
 */
export async function transferAcceptedRoadster({
  campaignDirectory, outDirectory, phaseBudget, apiKey, client, generateTransfer = generateRoadsterTransfer,
  buildChallenge = buildRoadsterChallenge, verifyBrowser, allowLocalFixture = false, signal,
} = {}) {
  if (!phaseBudget?.reserve || !phaseBudget?.settle) throw Error('A durable phase ledger is required before Roadster generation');
  const campaignRoot = resolve(campaignDirectory), root = resolve(outDirectory);
  if (overlaps(campaignRoot, root) || overlaps(root, campaignRoot)) throw Error('Roadster output must be a new directory outside the campaign');
  await mkdir(root, { recursive: true });
  const lock = join(root, '.runner-lock');
  try { await mkdir(lock); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await readFile(join(lock, 'pid'), 'utf8'));
    if (!Number.isSafeInteger(pid) || pid < 1) throw Error('Invalid accepted Roadster lock');
    try { process.kill(pid, 0); throw Error('Another process owns this accepted Roadster delivery'); }
    catch (failure) { if (failure.code !== 'ESRCH') throw failure; }
    await rm(lock, { recursive: true }); await mkdir(lock);
  }
  await writeFile(join(lock, 'pid'), String(process.pid));
  let store, campaign, locked = true;
  const save = async () => {
    campaign.updatedAt = new Date().toISOString();
    campaign.summary = summarize(campaign);
    const temporary = join(root, 'journal.' + randomUUID() + '.tmp');
    try {
      await writeFile(temporary, bytesOf({ ...campaign, integritySha256: digest(JSON.stringify(campaign)) }), { mode: 0o600 });
      await rename(temporary, join(root, 'journal.json'));
    } finally { await rm(temporary, { force: true }); }
  };
  const reconcile = async () => {
    const report = campaign.job.report;
    const uncertain = uncertainReport(report);
    try {
      await phaseBudget.settle({ id: campaign.job.phaseReservationId, estimatedCostUsd: report?.estimatedCostUsd ?? 0, uncertain });
    } catch (error) { campaign.job.settleError = clean(error, apiKey); }
    campaign.job.status = 'interrupted';
    campaign.job.outcome = 'interrupted';
    campaign.job.error = 'Previous runner stopped; this transfer is retained without an automatic model retry.';
    campaign.status = uncertain ? 'blocked' : 'interrupted';
    await save();
  };
  try {
    try { campaign = await readAcceptedRoadster(root); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (campaign?.job.status === 'running') {
      await reconcile();
      return campaign;
    }
    const recovery = await readRecoveryCampaign(campaignRoot);
    const trial = selectAcceptedRoadsterTrial(recovery, { allowLocalFixture });
    const reportSha = digest(await readFile(join(campaignRoot, trial.reportRef.path)));
    assert.equal(reportSha, trial.reportRef.sha256, 'Accepted report bytes changed');
    const component = await loadAcceptedComponent(campaignRoot, trial.report);
    assert.equal(component.frozenCandidateId, component.candidateId, 'Accepted candidate must match the frozen identity');
    assert.equal(component.candidateId, trial.report.session.recovery.frozenCandidateId);
    assert.equal(component.sessionId, trial.report.session.id);
    const input = {
      report: { path: trial.reportRef.path, sha256: reportSha }, protocolId: recovery.definition.protocol.id,
      sessionId: component.sessionId, candidateId: component.candidateId, componentId: component.provenance.id,
      trialId: trial.id, recoveryCampaignId: recovery.definition.id, parentArtifactId: null,
      fixture: trial.report.origin === 'local-verification',
    };
    if (!campaign) {
      const execution = acceptedRoadsterExecution({
        client, generateTransfer, verifyBrowser, buildChallenge, allowLocalFixture, fixture: input.fixture,
      });
      const id = randomUUID();
      const definition = {
        schemaVersion: 1, id, kind: 'accepted-roadster-transfer', model: ACCEPTED_ROADSTER_MODEL,
        category: ACCEPTED_ROADSTER_CATEGORY, maxCostUsd: ACCEPTED_ROADSTER_MAX_USD, providerRetries: false,
        prompt: ACCEPTED_ROADSTER_PROMPT, intent: { ...ROADSTER_INTENT }, recoveryCampaignId: recovery.definition.id,
        recoveryDefinitionSha256: recovery.definition.sha256, input,
      };
      campaign = {
        schemaVersion: 1, definition: { ...definition, sha256: digest(JSON.stringify(definition)) }, status: 'prepared',
        job: {
          status: 'prepared', phaseReservationId: `remix:${id}:accepted-roadster`, outcome: null, artifactId: null,
          challengeId: null, estimatedCostUsd: 0, report: null, error: null, injected: execution.injected,
        },
        createdAt: new Date().toISOString(),
      };
      await save();
    } else {
      assert.deepEqual(campaign.definition.input, input, 'Resume input does not match the accepted recovery');
      if (campaign.job.status !== 'prepared') return campaign;
    }
    const ledger = await phaseBudget.status();
    if (ledger.uncertain || ledger.overrun) {
      campaign.status = 'blocked';
      campaign.job.status = 'blocked';
      campaign.job.outcome = 'blocked';
      campaign.job.error = 'Phase billing is uncertain or exceeded a reservation; no further inference admitted';
      await save();
      return campaign;
    }
    if (signal?.aborted) throw Error('Accepted Roadster transfer cancelled before generation');
    try {
      await phaseBudget.reserve({
        id: campaign.job.phaseReservationId, category: ACCEPTED_ROADSTER_CATEGORY, maxCostUsd: ACCEPTED_ROADSTER_MAX_USD,
        metadata: {
          recoveryCampaignId: input.recoveryCampaignId, reportSha256: input.report.sha256, protocolId: input.protocolId,
          sessionId: input.sessionId, candidateId: input.candidateId, componentId: input.componentId,
        },
      });
    } catch (error) {
      if (/uncertain|overrun|cannot cover|cannot start another request/.test(error.message)) {
        campaign.status = 'blocked';
        campaign.job.status = 'blocked';
        campaign.job.outcome = 'blocked';
        campaign.job.error = clean(error, apiKey);
        await save();
        return campaign;
      }
      throw error;
    }
    campaign.job.status = 'running';
    campaign.job.startedAt = new Date().toISOString();
    campaign.status = 'running';
    await save();
    const parent = freshParent(component);
    try {
      const result = await generateTransfer({
        apiKey, client, parent, prompt: ACCEPTED_ROADSTER_PROMPT, maxCostUsd: ACCEPTED_ROADSTER_MAX_USD, componentRef: component,
        ...(verifyBrowser ? { verifyBrowser } : {}),
        onUpdate: async report => { campaign.job.report = scrub(report, apiKey); await save(); },
      });
      if (parent.id !== null || parent.componentId !== component.provenance.id || parent.files['adapter.ts']) {
        throw Error('Fresh adapter parent was replaced before publication');
      }
      if (result?.metadata?.componentId !== component.provenance.id || result?.metadata?.parentArtifactId != null) {
        const error = Error('Roadster generation did not bind the accepted component as a new adapter');
        error.report = campaign.job.report;
        throw error;
      }
      store = await createLabStore(join(root, 'published'));
      const artifact = await store.publish(result.files, result.metadata);
      campaign.job.artifactId = artifact.id;
      campaign.job.report = scrub(JSON.parse(artifact.files['generation.json']), apiKey);
      await save();
      const challenge = await buildChallenge({ parent: artifact, componentRef: component });
      assertAgreement(component, artifact, challenge);
      await writeFresh(join(root, 'challenge'), challenge.files);
      const execution = acceptedRoadsterExecution({
        client, generateTransfer, verifyBrowser, buildChallenge, allowLocalFixture, fixture: input.fixture,
      });
      if (execution.injected && (execution.liveMeta || execution.outcome === 'delivered')) {
        throw Error('Injected Roadster execution cannot be recorded as a live delivery');
      }
      const receipt = {
        schemaVersion: 1, kind: 'accepted-roadster-delivery', status: execution.outcome, recordedAt: new Date().toISOString(),
        campaignId: input.recoveryCampaignId, trialId: input.trialId, report: input.report, protocolId: input.protocolId,
        sessionId: input.sessionId, candidateId: input.candidateId, componentId: input.componentId, parentArtifactId: null,
        artifactId: artifact.id, challengeId: challenge.id, ordinaryOutsideTarget: true, borrowedInsideTarget: true,
        injected: execution.injected, fixture: input.fixture, liveMeta: execution.liveMeta,
      };
      await writeFile(join(root, 'delivery.json'), bytesOf({ ...receipt, sha256: digest(JSON.stringify(receipt)) }), { flag: 'wx' });
      campaign.job.status = 'complete';
      campaign.job.outcome = execution.outcome;
      campaign.job.injected = execution.injected;
      campaign.job.challengeId = challenge.id;
      campaign.job.estimatedCostUsd = campaign.job.report?.estimatedCostUsd ?? 0;
      campaign.job.ordinaryOutsideTarget = true;
      campaign.job.borrowedInsideTarget = true;
      campaign.status = 'complete';
      await save();
      await phaseBudget.settle({ id: campaign.job.phaseReservationId, estimatedCostUsd: campaign.job.estimatedCostUsd, uncertain: uncertainReport(campaign.job.report) });
      return campaign;
    } catch (error) {
      campaign.job.report = scrub(error.report ?? campaign.job.report, apiKey);
      campaign.job.error = clean(error, apiKey);
      campaign.job.status = 'failed';
      campaign.job.outcome = 'failed';
      campaign.job.estimatedCostUsd = campaign.job.report?.estimatedCostUsd ?? 0;
      const uncertain = uncertainReport(campaign.job.report);
      campaign.status = uncertain ? 'blocked' : 'failed';
      await save();
      await phaseBudget.settle({ id: campaign.job.phaseReservationId, estimatedCostUsd: campaign.job.estimatedCostUsd, uncertain });
      return campaign;
    }
  } finally {
    try { if (store) await store.close(); }
    finally { if (locked) await rm(lock, { recursive: true, force: true }); }
  }
}
