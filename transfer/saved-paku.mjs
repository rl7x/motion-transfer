import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { digest } from '../component/build.mjs';
import { pakuEnvironment } from './paku-environment.mjs';
import { BROWSER_CHECKS, CONFORMANCE_CHECKS } from './paku-policy.mjs';

export const savedPakuDirectory = new URL('../transfers/paku-paku/', import.meta.url);
const packageFiles = ['adapter.ts', 'adapter.js', 'generation.json', 'evidence.json', 'conformance.json', 'browser.json'];

function checkEvaluation(report, gate, names, identity) {
  assert.equal(report.schemaVersion, 1, 'Unknown transfer evaluation schema');
  assert.equal(report.gate, gate, 'Unexpected transfer evaluation gate');
  assert.equal(report.passed, true, `${gate} did not pass`);
  assert.deepEqual(report.results.map(result => result.name), names, `${gate} check set changed`);
  assert.ok(report.results.every(result => result.passed === true), `${gate} contains a failed check`);
  for (const [key, value] of Object.entries(identity)) assert.equal(report[key], value, `${gate} identity mismatch: ${key}`);
}

export function checkPakuGeneration({ source, javascript, generation, evidence }, environment) {
  const identity = { sourceSha256: digest(source), javascriptSha256: digest(javascript), componentId: environment.componentId };
  assert.equal(generation.schemaVersion, 1);
  assert.equal(generation.status, 'conformant', 'No conformant Meta candidate');
  assert.equal(generation.componentId, identity.componentId);
  assert.equal(generation.recipientRevision, environment.recipient.revision);
  assert.equal(generation.evidenceSha256, digest(JSON.stringify(evidence)), 'Generation evidence mismatch');
  assert.equal(evidence.component.id, identity.componentId);
  assert.equal(evidence.recipient.revision, environment.recipient.revision);
  const selected = generation.attempts.find(item => item.attempt === generation.selectedAttempt);
  assert.ok(selected, 'Selected Meta attempt is missing');
  assert.equal(selected.candidate.source, source, 'Saved adapter is not the Meta submission');
  assert.equal(selected.sourceSha256, identity.sourceSha256);
  checkEvaluation(selected.conformance, 'adapter-conformance', CONFORMANCE_CHECKS, identity);
  return identity;
}

export function checkPakuPackage(candidate, environment) {
  const identity = checkPakuGeneration(candidate, environment);
  const { conformance, browser } = candidate;
  checkEvaluation(conformance, 'adapter-conformance', CONFORMANCE_CHECKS, identity);
  checkEvaluation(browser, 'paku-browser-integration', BROWSER_CHECKS, {
    ...identity, recipientRevision: environment.recipient.revision,
    tickRate: environment.policy.tickRate, defaultUnitScale: environment.policy.unitScale,
  });
  assert.deepEqual(browser.environment, environment, 'Browser evaluation environment is stale');
  return identity;
}

export async function readPakuCandidate(directory) {
  const files = Object.fromEntries(await Promise.all(packageFiles.map(async name => [name, await readFile(new URL(name, directory), 'utf8')])));
  return { files, source: files['adapter.ts'], javascript: files['adapter.js'],
    ...Object.fromEntries(['generation', 'evidence', 'conformance', 'browser'].map(name => [name, JSON.parse(files[name + '.json'])])) };
}

export async function savePakuTransfer(candidate, directory = savedPakuDirectory) {
  const environment = await pakuEnvironment();
  const identity = checkPakuPackage(candidate, environment);
  const files = { 'adapter.ts': candidate.source, 'adapter.js': candidate.javascript };
  for (const key of ['generation', 'evidence', 'conformance', 'browser']) files[key + '.json'] = JSON.stringify(candidate[key], null, 2) + '\n';
  const hashes = Object.fromEntries(Object.entries(files).map(([name, content]) => [name, digest(content)]));
  const id = digest(JSON.stringify({ files: hashes, environment }));
  const receipt = { schemaVersion: 1, status: 'verified', id, ...identity, environment, files: hashes,
    model: candidate.generation.model, estimatedGenerationCostUsd: candidate.generation.estimatedCostUsd,
    humanAssistance: candidate.generation.humanAssistance };
  // A new directory is required: never overwrite a previously verified artifact.
  await mkdir(new URL('../', directory), { recursive: true });
  await mkdir(directory);
  await Promise.all(Object.entries(files).map(([name, content]) => writeFile(new URL(name, directory), content)));
  await writeFile(new URL('receipt.json', directory), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}

export async function loadPakuTransfer({ directory = savedPakuDirectory, optional = false } = {}) {
  let receipt;
  try { receipt = JSON.parse(await readFile(new URL('receipt.json', directory), 'utf8')); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.status, 'verified', 'Transfer is not verified');
  const candidate = await readPakuCandidate(directory);
  assert.deepEqual(Object.keys(receipt.files).sort(), [...packageFiles].sort(), 'Transfer file set mismatch');
  for (const name of packageFiles) assert.equal(digest(candidate.files[name]), receipt.files[name], `Transfer integrity mismatch: ${name}`);
  const environment = await pakuEnvironment();
  assert.deepEqual(receipt.environment, environment, 'Saved transfer environment is stale; verify and export a new artifact');
  assert.equal(receipt.id, digest(JSON.stringify({ files: receipt.files, environment })), 'Transfer receipt identity mismatch');
  const identity = checkPakuPackage(candidate, environment);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value, `Receipt identity mismatch: ${key}`);
  return { ...candidate, ...identity, receipt };
}
