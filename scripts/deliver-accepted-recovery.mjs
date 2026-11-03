import { repositoryPath } from '../src/paths.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { digest } from '../src/component/build.mjs';
import { readRecoveryCampaign } from '../src/campaign/recovery-runner.mjs';
import { finishRecoveryIntegration } from '../src/integration/recovery.mjs';
import { createIntegrationPublication } from '../src/integration/publication.mjs';

const RECEIPT_NAME = 'delivery-receipt.json';
const SOURCE_PATHS = [
  'integration/accepted-component.mjs',
  'integration/jujump.mjs',
  'integration/publication.mjs',
  'integration/recovery.mjs',
  'scripts/deliver-accepted-recovery.mjs',
];

function receiptExists(path) {
  const error = Error(`Delivery receipt already exists and was not overwritten: ${path}`);
  error.code = 'DELIVERY_RECEIPT_EXISTS';
  return error;
}

function overlaps(parent, child) {
  const relation = relative(parent, child);
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

export function selectAcceptedTrial(campaign) {
  const accepted = campaign.trials.filter(trial => trial.report?.status === 'completed'
    && Number.isInteger(trial.report.session?.recovery?.acceptedAttempt) && trial.report.session.recovery.acceptedAttempt >= 1);
  if (accepted.length !== 1) throw Error(accepted.length ? 'More than one accepted recovery trial' : 'No completed trial has an accepted candidate');
  const trial = accepted[0];
  if (trial.report.origin === 'local-verification') throw Error('Local fixtures are not accepted recovery deliveries');
  if (!/^reports\/[a-f0-9]{64}\.json$/.test(trial.reportRef?.path ?? '') || !/^[a-f0-9]{64}$/.test(trial.reportRef?.sha256 ?? '')) {
    throw Error('Accepted trial is missing its exact report');
  }
  return trial;
}

export async function deliverySource() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('Invalid delivery source commit');
  const files = {};
  for (const path of SOURCE_PATHS) files[path] = digest(await readFile(join(root, repositoryPath(path))));
  return { commit, hash: digest(JSON.stringify(files)) };
}

export function verifyDeliveryReceipt(text) {
  const parsed = JSON.parse(text);
  const { sha256, ...body } = parsed;
  assert.equal(digest(JSON.stringify(body)), sha256, 'Delivery receipt changed');
  return parsed;
}

async function assertReceiptAbsent(path) {
  try { await stat(path); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw receiptExists(path);
}

async function writeReceipt(path, body) {
  const sha256 = digest(JSON.stringify(body));
  await mkdir(dirname(path), { recursive: true });
  try { await writeFile(path, JSON.stringify({ ...body, sha256 }, null, 2) + '\n', { flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') throw receiptExists(path); throw error; }
}

async function snapshotCampaign(directory, trial) {
  const reportPath = join(directory, trial.reportRef.path);
  return {
    journal: await readFile(join(directory, 'journal.json')),
    definition: await readFile(join(directory, 'definition.json')),
    report: await readFile(reportPath),
    reportPath,
  };
}

async function assertUnchanged(directory, saved) {
  assert.deepEqual(await readFile(join(directory, 'journal.json')), saved.journal, 'Source campaign journal changed');
  assert.deepEqual(await readFile(join(directory, 'definition.json')), saved.definition, 'Source campaign definition changed');
  assert.deepEqual(await readFile(saved.reportPath), saved.report, 'Source campaign report changed');
}

function assertDeliveryResult(result, trial) {
  const recovery = trial.report.session.recovery;
  const verification = result?.verification;
  assert.equal(verification?.passed, true, 'Accepted recovery delivery did not pass');
  assert.equal(verification.metaCalled, false, 'Accepted recovery delivery made a model call');
  assert.equal(verification.componentId, result.project?.manifest?.componentId, 'Published component identity drifted');
  assert.equal(verification.candidateId, recovery.frozenCandidateId, 'Published candidate is not the frozen candidate');
  assert.equal(verification.sessionId, trial.report.session.id, 'Published session does not match the accepted trial');
  assert.equal(verification.packageId, result.project.manifest.id);
  assert.equal(verification.zipSha256, result.project.zipSha256);
  assert.equal(verification.nodeChecks?.passed, true);
  assert.equal(verification.nodeChecks.count, 3);
  assert.equal(verification.browser?.passed, true);
  assert.equal(verification.browser.results.length, 7);
  assert.ok(verification.browser.results.every(item => item.passed), 'A recipient browser check failed');
  assert.deepEqual(verification.externalRequests, []);
  assert.deepEqual(verification.nonGetRequests, []);
}

function assertReloaded(loaded, result, publicationId) {
  assert.equal(loaded.id, publicationId, 'Reloaded publication identity changed');
  assert.equal(loaded.verification.componentId, result.verification.componentId);
  assert.equal(loaded.verification.candidateId, result.verification.candidateId);
  assert.equal(loaded.verification.sessionId, result.verification.sessionId);
  assert.equal(loaded.verification.nodeChecks.count, 3);
  assert.equal(loaded.verification.browser.results.length, 7);
  assert.equal(loaded.project.manifest.componentId, result.verification.componentId);
  assert.equal(loaded.project.manifest.id, result.project.manifest.id);
  assert.equal(loaded.project.zipSha256, result.project.zipSha256);
  assert.equal(loaded.receipt.componentId, result.verification.componentId);
  assert.equal(loaded.receipt.candidateId, result.verification.candidateId);
  assert.equal(loaded.receipt.sessionId, result.verification.sessionId);
}

function receiptBody({ campaign, trial, source, result, publicationId, error }) {
  const body = {
    schemaVersion: 1, kind: 'accepted-recovery-delivery', status: publicationId ? 'delivered' : 'failed',
    recordedAt: new Date().toISOString(), campaignId: campaign.definition.id, definitionSha256: campaign.definition.sha256,
    report: { path: trial.reportRef.path, sha256: trial.reportRef.sha256 }, protocolId: campaign.definition.protocol.id,
    trialId: trial.id, candidateId: trial.report.session.recovery.frozenCandidateId, sessionId: trial.report.session.id, source,
  };
  if (result) {
    body.componentId = result.verification.componentId;
    body.packageId = result.project.manifest.id;
    body.zipSha256 = result.project.zipSha256;
    body.nodeChecks = result.verification.nodeChecks.count;
    body.browserChecks = result.verification.browser.results.length;
  }
  if (publicationId) body.publicationId = publicationId;
  if (error) body.error = String(error.message).slice(0, 2000);
  return body;
}

export async function deliverAcceptedRecovery({
  campaignDirectory, outDirectory, integrate = finishRecoveryIntegration, openPublication = createIntegrationPublication, source,
} = {}) {
  const campaignRoot = resolve(campaignDirectory), outputRoot = resolve(outDirectory);
  if (overlaps(campaignRoot, outputRoot) || overlaps(outputRoot, campaignRoot)) throw Error('Delivery output must be a new directory outside the campaign');
  const receiptPath = join(outputRoot, RECEIPT_NAME);
  await assertReceiptAbsent(receiptPath);
  const campaign = await readRecoveryCampaign(campaignRoot);
  const trial = selectAcceptedTrial(campaign);
  const saved = await snapshotCampaign(campaignRoot, trial);
  const sourceInfo = source ?? await deliverySource();
  const publications = openPublication(outputRoot);
  try {
    try {
      const result = await integrate({ directory: campaignRoot, report: trial.report });
      assertDeliveryResult(result, trial);
      await assertUnchanged(campaignRoot, saved);
      const published = await publications.publish(result);
      const loaded = await publications.read(published.id);
      assertReloaded(loaded, result, published.id);
      await assertUnchanged(campaignRoot, saved);
      await writeReceipt(receiptPath, receiptBody({ campaign, trial, source: sourceInfo, result, publicationId: published.id }));
      return {
        status: 'delivered', campaignId: campaign.definition.id, trialId: trial.id,
        componentId: result.verification.componentId, candidateId: result.verification.candidateId,
        sessionId: result.verification.sessionId, publicationId: published.id,
        nodeChecks: result.verification.nodeChecks.count, browserChecks: result.verification.browser.results.length,
        receiptPath, artifactPath: join(outputRoot, 'integrations', published.id),
      };
    } finally { await publications.close(); }
  } catch (error) {
    if (error.code === 'DELIVERY_RECEIPT_EXISTS') throw error;
    try { await writeReceipt(receiptPath, receiptBody({ campaign, trial, source: sourceInfo, error })); }
    catch (writeError) {
      if (writeError.code === 'DELIVERY_RECEIPT_EXISTS') throw Error(`${error.message} Failed receipt was not overwritten: ${receiptPath}`);
      throw writeError;
    }
    throw Error(`${error.message} Failed receipt: ${receiptPath}`);
  }
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { campaign: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('node scripts/deliver-accepted-recovery.mjs --campaign <existing-directory> --out <new-directory>');
    console.log('Publishes one already accepted recovery offline. It does not read credentials, call Meta, or modify the source campaign.');
    console.log('An existing delivery receipt is never rewritten. A failed delivery keeps its receipt.');
    return;
  }
  if (!values.campaign || !values.out) throw Error('--campaign and --out are required');
  const result = await deliverAcceptedRecovery({ campaignDirectory: values.campaign, outDirectory: values.out });
  console.log(JSON.stringify({
    status: result.status, campaignId: result.campaignId, trialId: result.trialId, componentId: result.componentId,
    candidateId: result.candidateId, sessionId: result.sessionId, publicationId: result.publicationId,
    nodeChecks: result.nodeChecks, browserChecks: result.browserChecks, receipt: result.receiptPath, artifact: result.artifactPath,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
