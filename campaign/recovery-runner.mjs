import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { digest } from '../component/build.mjs';
import { investigate } from '../agent/investigate.mjs';
import { snapshotRecoveryProtocol, validateRecoveryProtocol, assertRecoveryProtocolSources } from '../agent/recovery-protocol.mjs';
import { INVESTIGATION_QUESTIONS } from '../lab/service.mjs';
import { saveInvestigationEvidence } from '../lab/investigation-evidence.mjs';
import { finishRecoveryIntegration } from '../integration/recovery.mjs';
import { loadAcceptedComponent } from '../integration/accepted-component.mjs';
import { createIntegrationPublication } from '../integration/publication.mjs';

const terminal = status => ['delivered', 'failed', 'interrupted'].includes(status);
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const bytes = value => JSON.stringify(value, null, 2) + '\n';

export function wilsonInterval(successes, count) {
  if (!Number.isInteger(successes) || !Number.isInteger(count) || count < 1 || successes < 0 || successes > count) throw Error('Invalid reliability counts');
  const z = 1.959963984540054, proportion = successes / count, denominator = 1 + z * z / count;
  const center = (proportion + z * z / (2 * count)) / denominator;
  const margin = z * Math.sqrt(proportion * (1 - proportion) / count + z * z / (4 * count * count)) / denominator;
  return { confidence: 0.95, lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

export function recoveryCampaignSummary(campaign) {
  const trials = campaign.trials, complete = trials.filter(trial => terminal(trial.status));
  const acceptedDeliveries = trials.filter(trial => trial.status === 'delivered').length;
  const failureCategories = {};
  for (const trial of complete.filter(trial => trial.status !== 'delivered')) {
    const category = trial.failureCategory ?? 'unclassified'; failureCategories[category] = (failureCategories[category] ?? 0) + 1;
  }
  return { plannedTrials: campaign.definition.trials.length, completedTrials: complete.length,
    acceptedDeliveries, donorAcceptances: trials.filter(trial => trial.report?.session?.recovery?.acceptedAttempt).length,
    estimatedCostUsd: trials.reduce((sum, trial) => sum + (trial.report?.estimatedCostUsd ?? 0), 0),
    reservedCostUsd: trials.reduce((sum, trial) => sum + (trial.report?.reservedCostUsd ?? 0), 0),
    interval: campaign.definition.mode === 'frozen' && complete.length === campaign.definition.trials.length
      ? wilsonInterval(acceptedDeliveries, complete.length) : null,
    failureCategories, externalUsers: null, developerTimeSaved: null };
}

function failureCategory(report, message) {
  if ((report?.reservedCostUsd ?? 0) > 0) return 'uncertain-billing';
  if (/Frozen recovery protocol source changed/.test(message)) return 'protocol-drift';
  if (report?.session?.recovery?.acceptedAttempt) return 'recipient-or-export';
  if (report?.session?.recovery?.acceptanceStarted) return 'acceptance';
  if (/token limit|context limit/i.test(message)) return 'context-limit';
  if (/timed out|wall-clock|time limit/i.test(message)) return 'timeout';
  if (/call limit|attempt limit|allowance/i.test(message)) return 'allowance-exhausted';
  return report?.requests?.length ? 'recovery-incomplete' : 'preflight';
}

async function readCampaign(directory) {
  const definition = await json(join(directory, 'definition.json'));
  const { sha256, ...body } = definition;
  assert.equal(digest(JSON.stringify(body)), sha256, 'Recovery campaign definition changed');
  validateRecoveryProtocol(definition.protocol);
  assert.ok(['development', 'frozen'].includes(definition.mode), 'Invalid recovery campaign mode');
  assert.equal(definition.trials.length, definition.mode === 'development' ? 1 : 10, 'Recovery trial count changed');
  assert.equal(definition.questionSha256, digest(definition.question), 'Recovery task changed');
  const { integritySha256, ...campaign } = await json(join(directory, 'journal.json'));
  assert.equal(digest(JSON.stringify(campaign)), integritySha256, 'Recovery campaign journal integrity mismatch');
  assert.deepEqual(campaign.definition, definition);
  assert.equal(campaign.trials.length, definition.trials.length);
  for (let index = 0; index < campaign.trials.length; index++) {
    const trial = campaign.trials[index], expected = definition.trials[index];
    assert.equal(trial.id, expected.id); assert.equal(trial.ordinal, expected.ordinal);
    assert.equal(trial.phaseReservationId, expected.phaseReservationId);
    if (trial.reportRef) {
      assert.match(trial.reportRef.path, /^reports\/[a-f0-9]{64}\.json$/, 'Invalid recovery report path');
      const reportBytes = await readFile(join(directory, trial.reportRef.path));
      assert.equal(digest(reportBytes), trial.reportRef.sha256, 'Recovery trial report integrity mismatch');
      assert.deepEqual(JSON.parse(reportBytes), trial.report, 'Recovery journal and exact report differ');
    }
  }
  assert.deepEqual(campaign.summary, recoveryCampaignSummary(campaign));
  return campaign;
}

async function developmentGate(path, protocol) {
  const directory = resolve(path), campaign = await readCampaign(directory);
  assert.equal(campaign.definition.mode, 'development', 'Freeze requires a development run');
  assert.equal(campaign.definition.protocol.id, protocol.id, 'Development and frozen campaign must use the same protocol and sources');
  const delivered = campaign.trials.find(trial => trial.status === 'delivered');
  assert.ok(delivered?.integration?.id, 'A checked development delivery is required before freezing ten trials');
  assert.notEqual(delivered.report?.origin, 'local-verification', 'Local fixtures cannot open a paid campaign');
  const component = await loadAcceptedComponent(directory, delivered.report);
  const publication = createIntegrationPublication(directory);
  try {
    const artifact = await publication.read(delivered.integration.id);
    assert.equal(artifact.receipt.componentId, component.provenance.id);
    assert.equal(artifact.receipt.candidateId, component.candidateId);
    assert.equal(artifact.receipt.sessionId, delivered.report.session.id);
    return { definitionSha256: campaign.definition.sha256, trialId: delivered.id,
      artifactId: artifact.id, componentId: component.provenance.id };
  } finally { await publication.close(); }
}

/** A frozen campaign never retries a started trial, including after restart. */
export async function runRecoveryCampaign({
  directory, phaseBudget, development = false, developmentReport, model = 'muse-spark-1.3-contributor',
  apiKey, client, investigateRun = investigate, integrateRecovery = finishRecoveryIntegration,
  signal, onProgress = () => {},
} = {}) {
  if (!phaseBudget?.reserve || !phaseBudget?.settle) throw Error('A durable phase ledger is required before recovery');
  if (!development && model !== 'muse-spark-1.3-contributor') throw Error('The frozen ten-trial arm uses Contributor Spark');
  const root = resolve(directory), lock = join(root, '.runner-lock');
  await mkdir(root, { recursive: true });
  try { await mkdir(lock); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await readFile(join(lock, 'pid'), 'utf8'));
    if (!Number.isSafeInteger(pid) || pid < 1) throw Error('Invalid recovery campaign lock');
    try { process.kill(pid, 0); throw Error('Another process owns this recovery campaign'); }
    catch (failure) { if (failure.code !== 'ESRCH') throw failure; }
    const reaper = lock + '.recovering';
    try { await mkdir(reaper); }
    catch (failure) { if (failure.code === 'EEXIST') throw Error('Another process is recovering this campaign lock'); throw failure; }
    try {
      assert.equal(Number(await readFile(join(lock, 'pid'), 'utf8')), pid, 'Recovery lock ownership changed');
      try { process.kill(pid, 0); throw Error('Another process owns this recovery campaign'); }
      catch (failure) { if (failure.code !== 'ESRCH') throw failure; }
      await rm(lock, { recursive: true }); await mkdir(lock);
    } finally { await rm(reaper, { recursive: true }); }
  }
  await writeFile(join(lock, 'pid'), String(process.pid));
  const publications = createIntegrationPublication(root);
  let campaign;
  const scrub = value => JSON.parse(JSON.stringify(value).replaceAll(apiKey || '\0', '[redacted]'));
  async function save() {
    campaign.updatedAt = new Date().toISOString(); campaign.summary = recoveryCampaignSummary(campaign);
    const temporary = join(root, 'journal.' + randomUUID() + '.tmp');
    try {
      await writeFile(temporary, bytes({ ...campaign, integritySha256: digest(JSON.stringify(campaign)) }), { mode: 0o600 });
      await rename(temporary, join(root, 'journal.json'));
    } finally { await rm(temporary, { force: true }); }
  }
  async function settle(trial) {
    await phaseBudget.settle({ id: trial.phaseReservationId,
      estimatedCostUsd: trial.report?.estimatedCostUsd ?? 0, uncertain: (trial.report?.reservedCostUsd ?? 0) > 0 });
  }
  async function finishReport(trial) {
    if (!trial.report) return;
    const text = bytes(trial.report), sha256 = digest(text), relative = 'reports/' + sha256 + '.json';
    await mkdir(join(root, 'reports'), { recursive: true });
    try { await writeFile(join(root, relative), text, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST' || digest(await readFile(join(root, relative))) !== sha256) throw error; }
    trial.reportRef = { path: relative, sha256 };
  }
  try {
    let exists = true;
    try { await readFile(join(root, 'definition.json')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
    if (exists) {
      campaign = await readCampaign(root);
      assert.equal(campaign.definition.mode, development ? 'development' : 'frozen', 'Resume must retain campaign mode');
      assert.equal(campaign.definition.protocol.model, model, 'Resume must retain campaign model');
    } else {
      const protocol = await snapshotRecoveryProtocol({ model });
      if (!development && !developmentReport) throw Error('Freeze requires --development-report with a checked accepted delivery');
      const gate = development ? null : await developmentGate(developmentReport, protocol);
      const id = randomUUID();
      const body = { schemaVersion: 1, id, mode: development ? 'development' : 'frozen',
        createdAt: new Date().toISOString(), protocol, question: INVESTIGATION_QUESTIONS.extraction,
        questionSha256: digest(INVESTIGATION_QUESTIONS.extraction), developmentGate: gate,
        concurrency: 1, providerRetries: false,
        trials: Array.from({ length: development ? 1 : 10 }, (_, index) => {
          const trialId = randomUUID(); return { id: trialId, ordinal: index + 1, phaseReservationId: 'recovery:' + id + ':' + trialId };
        }) };
      const definition = { ...body, sha256: digest(JSON.stringify(body)) };
      await writeFile(join(root, 'definition.json'), bytes(definition), { flag: 'wx', mode: 0o600 });
      campaign = { schemaVersion: 1, definition, status: 'prepared', trials: definition.trials.map(trial => ({ ...trial, status: 'prepared' })) };
      await save();
    }
    await assertRecoveryProtocolSources(campaign.definition.protocol);
    // A started trial can be reconciled from its durable report, never sent again.
    for (const trial of campaign.trials.filter(value => ['reserved', 'running'].includes(value.status))) {
      trial.status = 'interrupted'; trial.failureCategory = (trial.report?.reservedCostUsd ?? 0) > 0 ? 'uncertain-billing' : 'interrupted';
      trial.error = 'Previous runner stopped; this trial is retained without an automatic model retry.';
      trial.finishedAt = new Date().toISOString(); await finishReport(trial); await save(); await settle(trial);
    }
    campaign.status = 'running'; await save();
    for (const trial of campaign.trials.filter(value => value.status === 'prepared')) {
      if (signal?.aborted) throw Error('Recovery campaign cancelled before starting another trial');
      await assertRecoveryProtocolSources(campaign.definition.protocol);
      const protocol = campaign.definition.protocol;
      await phaseBudget.reserve({ id: trial.phaseReservationId, category: model === 'muse-wonder-1.0' ? 'wonder' : 'recovery',
        maxCostUsd: protocol.limits.maxCostUsd, metadata: { campaignId: campaign.definition.id, trialId: trial.id, protocolId: protocol.id } });
      trial.status = 'reserved'; await save();
      trial.status = 'running'; trial.startedAt = new Date().toISOString(); await save();
      onProgress(`Recovery ${trial.ordinal}/${campaign.definition.trials.length}: ${trial.id}`);
      try {
        trial.report = scrub(await investigateRun({ apiKey, client, recoveryProtocol: protocol, question: campaign.definition.question, signal,
          onProgress, onUpdate: async report => {
            trial.report = scrub(report); await save(); await saveInvestigationEvidence(root, trial.report.session, trial.report);
          } }));
        assert.equal(trial.report.status, 'completed', 'Recovery did not pass all evidence and acceptance gates');
        assert.notEqual(trial.report.origin, 'local-verification', 'Local fixtures are not live recovery deliveries');
        await assertRecoveryProtocolSources(protocol);
        const result = await integrateRecovery({ directory: root, report: trial.report });
        await assertRecoveryProtocolSources(protocol);
        trial.integration = await publications.publish(result);
        await publications.read(trial.integration.id);
        trial.status = 'delivered';
      } catch (error) {
        if (error.report) trial.report = scrub(error.report);
        trial.error = String(error.message).replaceAll(apiKey || '\0', '[redacted]').slice(0, 2000);
        trial.failureCategory = failureCategory(trial.report, trial.error); trial.status = signal?.aborted ? 'interrupted' : 'failed';
      } finally {
        trial.finishedAt = new Date().toISOString();
        trial.elapsedMachineMs = Date.parse(trial.finishedAt) - Date.parse(trial.startedAt);
        await finishReport(trial); await save(); await settle(trial);
      }
      onProgress(`Recovery ${trial.ordinal}: ${trial.status}; $${(trial.report?.estimatedCostUsd ?? 0).toFixed(5)} estimated`);
      if ((trial.report?.reservedCostUsd ?? 0) > 0) throw Error('Recovery billing is uncertain; the phase ledger blocks further inference');
    }
    campaign.status = campaign.trials.every(trial => terminal(trial.status)) ? 'completed' : 'incomplete';
    campaign.finishedAt = new Date().toISOString(); await save(); return campaign;
  } catch (error) {
    if (campaign) { campaign.status = 'stopped'; campaign.error = String(error.message).replaceAll(apiKey || '\0', '[redacted]'); await save(); }
    throw error;
  } finally { await publications.close(); await rm(lock, { recursive: true, force: true }); }
}

export async function readRecoveryCampaign(directory) { return readCampaign(resolve(directory)); }
