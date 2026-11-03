import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { generateRoadsterTransfer } from '../agent/transfer-roadster.mjs';
import { digest } from '../component/build.mjs';
import { createLabStore } from '../lab/store.mjs';
import { readRoadsterArtifact, ROADSTER_FILES } from '../roadster/artifact.mjs';
import { ROADSTER_INTENT, validateRoadsterIntent } from '../roadster/port.mjs';

export { generateRoadsterTransfer as roadsterGenerator };
export const REMIX_CALL_MAX_USD = 0.05;
export const REMIX_CATEGORY = 'remix';
export const REMIX_MODEL = 'muse-spark-1.3';
export const SHARED_PHASE_LEDGER = 'reports/motion-transfer-phase';

export const REMIX_PROMPTS = Object.freeze([
  { id: 'half-distance', kind: 'supported', parent: 'base',
    prompt: 'Make the air dash half as long. Keep the forward direction and held activation.',
    expectedIntent: { activation: 'held', direction: 'facing', unitScale: 0.05 } },
  { id: 'backward', kind: 'supported', parent: 'base',
    prompt: 'Make the air dash go backward. Keep its current distance and held activation.',
    expectedIntent: { activation: 'held', direction: 'opposite', unitScale: 0.1 } },
  { id: 'fresh-press', kind: 'supported', parent: 'base',
    prompt: 'Make the air dash require a fresh press. Keep its current distance and forward direction.',
    expectedIntent: { activation: 'press', direction: 'facing', unitScale: 0.1 } },
  { id: 'backward-fresh-press', kind: 'supported', parent: 'base',
    prompt: 'Make the air dash go backward and require a fresh press. Keep its current distance.',
    expectedIntent: { activation: 'press', direction: 'opposite', unitScale: 0.1 } },
  { id: 'three-meter-followup', kind: 'supported', parent: 'backward-fresh-press',
    prompt: 'Change only the distance to exactly 3 meters. Keep the backward direction and the fresh-press activation from this parent.',
    expectedIntent: { activation: 'press', direction: 'opposite', unitScale: 0.05 } },
  { id: 'nine-meter', kind: 'supported', parent: 'base',
    prompt: 'Make the air dash travel exactly 9 meters. Keep the forward direction and held activation.',
    expectedIntent: { activation: 'held', direction: 'facing', unitScale: 0.15 } },
  { id: 'flight', kind: 'unsupported', parent: 'base',
    prompt: 'Give me one air dash, and restore it when I land.', expectedIntent: null },
  { id: 'noop', kind: 'noop', parent: 'base',
    prompt: 'Keep the dash exactly the same.', expectedIntent: null },
]);

for (const prompt of REMIX_PROMPTS) if (prompt.expectedIntent) validateRoadsterIntent(prompt.expectedIntent);

export function canonicalIntent(intent) {
  if (!intent) return null;
  return { activation: intent.activation, direction: intent.direction, unitScale: intent.unitScale };
}
function sameIntent(left, right) {
  return !!left && !!right && Object.keys(left).length === 3 && Object.keys(right).length === 3
    && left.activation === right.activation && left.direction === right.direction && left.unitScale === right.unitScale;
}
const bytesOf = value => JSON.stringify(value, null, 2) + '\n';
const clean = (error, apiKey) => {
  const text = String(error?.message ?? error);
  return (apiKey ? text.split(apiKey).join('[redacted]') : text).slice(0, 500);
};
function scrub(value, apiKey) {
  if (!apiKey || value == null) return value;
  return JSON.parse(JSON.stringify(value).split(apiKey).join('[redacted]'));
}
function reportOf(value) {
  if (value?.report) return value.report;
  try { return JSON.parse(value?.files?.['generation.json'] ?? ''); } catch { return null; }
}
function uncertainReport(report) {
  if (!report || !Number.isFinite(report.estimatedCostUsd)) return true;
  if ((report.reservedCostUsd ?? 0) > 0) return true;
  return (report.requests ?? []).some(request => request.status !== 'completed');
}
function gradeSupported(spec, parent, result) {
  let verification;
  try { verification = JSON.parse(result?.files?.['verification.json'] ?? ''); }
  catch { return 'checks-failed'; }
  if (verification?.passed !== true) return 'checks-failed';
  if (result?.metadata?.parentArtifactId !== parent.id) return 'lineage-mismatch';
  if (!sameIntent(result?.metadata?.intent, spec.expectedIntent)) return 'intent-mismatch';
  if (typeof result?.files?.['adapter.ts'] !== 'string' || !result.files['adapter.ts'].trim()) return 'missing-source';
  if (!/^[a-f0-9]{64}$/.test(result?.metadata?.componentId ?? '')) return 'missing-component';
  return 'matched';
}
function playable(result) {
  const files = result?.files;
  if (!files || Object.keys(files).sort().join(',') !== ROADSTER_FILES.join(',')) return false;
  if (!ROADSTER_FILES.every(name => typeof files[name] === 'string' && files[name].length > 0)) return false;
  if (!files['frame.html'].includes('<') || !files['notices.txt'].trim()) return false;
  try {
    const verification = JSON.parse(files['verification.json']);
    const generation = JSON.parse(files['generation.json']);
    return verification?.passed === true && !!generation && typeof generation === 'object';
  } catch { return false; }
}

function childFrom(artifact) {
  return {
    published: true, id: artifact.id, intent: canonicalIntent(artifact.intent), componentId: artifact.componentId,
    parentArtifactId: artifact.parentArtifactId,
    files: Object.fromEntries(ROADSTER_FILES.map(name => [name, digest(artifact.files[name])])),
  };
}

async function publishMatched(store, artifactsDirectory, result, parent) {
  if (!playable(result)) throw Error('Matched Roadster output is missing a playable frame, notices, source, verification, or generation record');
  const artifact = await store.publish(result.files, result.metadata);
  const verified = await readRoadsterArtifact(artifactsDirectory, artifact.id);
  if (verified.id !== artifact.id || verified.parentArtifactId !== parent.id) throw Error('Published Roadster identity mismatch');
  if (!sameIntent(canonicalIntent(verified.intent), canonicalIntent(result.metadata?.intent))) throw Error('Published Roadster intent mismatch');
  if (verified.componentId !== result.metadata?.componentId) throw Error('Published Roadster component mismatch');
  for (const name of ROADSTER_FILES) if (verified.files[name] !== result.files[name]) throw Error('Published Roadster file mismatch: ' + name);
  return verified;
}

async function retainUnpublished(root, attempt, result, apiKey) {
  const files = result?.files;
  if (!files || typeof files !== 'object') return;
  const directory = join(root, 'unpublished', attempt.id);
  await mkdir(directory, { recursive: true });
  const retained = {};
  for (const [name, value] of Object.entries(files)) {
    if (typeof value !== 'string' || !/^[a-z0-9.-]+$/i.test(name)) continue;
    const text = apiKey ? value.split(apiKey).join('[redacted]') : value;
    await writeFile(join(directory, name), text, { flag: 'wx' });
    retained[name] = digest(text);
  }
  if (result.metadata && typeof result.metadata === 'object') {
    const text = bytesOf(scrub(result.metadata, apiKey));
    await writeFile(join(directory, 'metadata.json'), text, { flag: 'wx' });
    retained['metadata.json'] = digest(text);
  }
  attempt.unpublished = { directory: `unpublished/${attempt.id}`, files: retained, published: false };
}

function negativeOutcome(spec, parent, error) {
  const submission = error?.report?.submission;
  const unchanged = submission && sameIntent(canonicalIntent(submission.intent), canonicalIntent(parent.intent)) && Object.keys(submission.intent).length === 3;
  if (spec.kind === 'unsupported') return error?.code === 'UNSUPPORTED_REQUEST' && submission?.source === '' && unchanged ? 'expected-unsupported' : 'failed';
  if (spec.kind === 'noop') {
    if (/does not change the parent/.test(error?.message ?? '')) return 'expected-noop';
    if (error?.code === 'UNSUPPORTED_REQUEST' && submission?.source === '' && unchanged) return 'expected-noop';
  }
  return 'failed';
}

function summary(campaign) {
  const finished = campaign.attempts.filter(attempt => attempt.status === 'complete' || attempt.status === 'blocked');
  return {
    prompts: campaign.attempts.length, completed: finished.length,
    matched: campaign.attempts.filter(attempt => attempt.outcome === 'matched').length,
    expectedNegatives: campaign.attempts.filter(attempt => attempt.outcome === 'expected-unsupported' || attempt.outcome === 'expected-noop').length,
    estimatedCostUsd: campaign.attempts.reduce((sum, attempt) => sum + (attempt.estimatedCostUsd ?? 0), 0),
    providerRetries: false,
  };
}

async function readCampaign(directory) {
  const { integritySha256, ...campaign } = JSON.parse(await readFile(join(directory, 'journal.json'), 'utf8'));
  assert.equal(digest(JSON.stringify(campaign)), integritySha256, 'Remix campaign journal integrity mismatch');
  const { sha256, ...definition } = campaign.definition;
  assert.equal(digest(JSON.stringify(definition)), sha256, 'Remix campaign definition changed');
  assert.deepEqual(definition.prompts, REMIX_PROMPTS, 'Frozen remix prompts changed');
  assert.equal(definition.maxCostUsd, REMIX_CALL_MAX_USD);
  assert.equal(definition.model, REMIX_MODEL);
  return campaign;
}

async function resolveParent(spec, base, attempts, artifactsDirectory) {
  if (spec.parent === 'base') return base;
  const previous = attempts.find(attempt => attempt.id === spec.parent);
  if (previous?.outcome !== 'matched' || !/^[a-f0-9]{64}$/.test(previous.child?.id ?? '')) return null;
  const artifact = await readRoadsterArtifact(artifactsDirectory, previous.child.id);
  if (artifact.parentArtifactId !== previous.child.parentArtifactId || artifact.componentId !== previous.child.componentId) throw Error('Published remix parent changed');
  if (!sameIntent(canonicalIntent(artifact.intent), previous.child.intent)) throw Error('Published remix intent changed');
  return { id: artifact.id, intent: artifact.intent, componentId: artifact.componentId, component: artifact.component, files: artifact.files };
}

/** Frozen Roadster remix set. Each call reserves $0.05 before generateRoadsterTransfer and is never retried. */
export async function runRemixCampaign({
  directory, phaseBudget, parent, apiKey, client, generateTransfer = generateRoadsterTransfer, signal, onProgress = () => {},
} = {}) {
  if (!phaseBudget?.reserve || !phaseBudget?.settle) throw Error('A durable phase ledger is required before remix generation');
  if (!parent?.files?.['adapter.ts'] || !sameIntent(canonicalIntent(parent.intent), canonicalIntent(ROADSTER_INTENT))) {
    throw Error('Remix campaign requires the saved forward held 0.1 Roadster parent');
  }
  if (!/^[a-f0-9]{64}$/.test(parent.id) || !/^[a-f0-9]{64}$/.test(parent.componentId ?? '')) throw Error('Remix parent identity is incomplete');
  const root = resolve(directory), lock = join(root, '.runner-lock');
  await mkdir(root, { recursive: true });
  try { await mkdir(lock); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await readFile(join(lock, 'pid'), 'utf8'));
    if (!Number.isSafeInteger(pid) || pid < 1) throw Error('Invalid remix campaign lock');
    try { process.kill(pid, 0); throw Error('Another process owns this remix campaign'); }
    catch (failure) { if (failure.code !== 'ESRCH') throw failure; }
    await rm(lock, { recursive: true }); await mkdir(lock);
  }
  await writeFile(join(lock, 'pid'), String(process.pid));
  const publishedRoot = join(root, 'published');
  const artifactsDirectory = join(publishedRoot, 'artifacts');
  let store, campaign;
  const save = async () => {
    campaign.updatedAt = new Date().toISOString(); campaign.summary = summary(campaign);
    const temporary = join(root, 'journal.' + randomUUID() + '.tmp');
    try {
      await writeFile(temporary, bytesOf({ ...campaign, integritySha256: digest(JSON.stringify(campaign)) }), { mode: 0o600 });
      await rename(temporary, join(root, 'journal.json'));
    } finally { await rm(temporary, { force: true }); }
  };
  try {
    store = await createLabStore(publishedRoot);
    let exists = true;
    try { campaign = await readCampaign(root); }
    catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
    if (exists) {
      assert.equal(campaign.definition.parentArtifactId, parent.id, 'Resume parent does not match the frozen campaign');
      assert.deepEqual(campaign.definition.parentIntent, canonicalIntent(parent.intent));
    } else {
      const id = randomUUID();
      const definition = { schemaVersion: 1, id, model: REMIX_MODEL, category: REMIX_CATEGORY, maxCostUsd: REMIX_CALL_MAX_USD,
        providerRetries: false, parentArtifactId: parent.id, parentIntent: canonicalIntent(parent.intent), prompts: REMIX_PROMPTS };
      campaign = { schemaVersion: 1, definition: { ...definition, sha256: digest(JSON.stringify(definition)) }, status: 'prepared',
        attempts: REMIX_PROMPTS.map(prompt => ({ id: prompt.id, status: 'prepared', phaseReservationId: `remix:${id}:${prompt.id}` })) };
      await save();
    }
    const stopForLedger = async () => {
      const status = await phaseBudget.status();
      if (!status.uncertain && !status.overrun) return false;
      campaign.status = 'blocked'; await save(); return true;
    };
    for (const attempt of campaign.attempts.filter(item => item.status === 'running')) {
      const report = attempt.report;
      const known = report && !uncertainReport(report);
      await phaseBudget.settle({ id: attempt.phaseReservationId, estimatedCostUsd: report?.estimatedCostUsd ?? 0, uncertain: !known });
      attempt.status = 'complete'; attempt.outcome = 'interrupted';
      attempt.error = 'Previous runner stopped; this prompt is retained without an automatic model retry.';
      await save();
    }
    if (await stopForLedger()) return campaign;
    campaign.status = 'running'; await save();
    for (const attempt of campaign.attempts) {
      if (attempt.status !== 'prepared') continue;
      if (signal?.aborted) { campaign.status = 'stopped'; await save(); break; }
      const spec = REMIX_PROMPTS.find(prompt => prompt.id === attempt.id);
      let selected = null;
      try { selected = await resolveParent(spec, parent, campaign.attempts, artifactsDirectory); }
      catch (error) {
        attempt.input = { prompt: spec.prompt, parentArtifactId: null, parentIntent: null, parentAdapterSha256: null, maxCostUsd: REMIX_CALL_MAX_USD, model: REMIX_MODEL };
        attempt.status = 'complete'; attempt.outcome = 'blocked'; attempt.error = clean(error, apiKey); attempt.estimatedCostUsd = 0;
        await save(); continue;
      }
      attempt.input = { prompt: spec.prompt, parentArtifactId: selected?.id ?? null, parentIntent: selected ? canonicalIntent(selected.intent) : null,
        parentAdapterSha256: selected ? digest(selected.files['adapter.ts']) : null, maxCostUsd: REMIX_CALL_MAX_USD, model: REMIX_MODEL };
      if (!selected) { attempt.status = 'complete'; attempt.outcome = 'blocked'; attempt.estimatedCostUsd = 0; await save(); continue; }
      try {
        await phaseBudget.reserve({ id: attempt.phaseReservationId, category: REMIX_CATEGORY, maxCostUsd: REMIX_CALL_MAX_USD,
          metadata: { campaignId: campaign.definition.id, promptId: spec.id } });
      } catch (error) {
        if (/uncertain|overrun|cannot cover/.test(error.message)) { campaign.status = 'blocked'; await save(); break; }
        throw error;
      }
      attempt.status = 'running'; attempt.startedAt = new Date().toISOString(); await save();
      onProgress(`Remix ${spec.id}`);
      const started = Date.now();
      let latest = null;
      try {
        const result = await generateTransfer({ apiKey, client, parent: selected, prompt: spec.prompt, maxCostUsd: REMIX_CALL_MAX_USD,
          onUpdate: async report => { latest = scrub(report, apiKey); attempt.report = latest; await save(); } });
        const report = scrub(reportOf({ ...result, report: latest }), apiKey);
        attempt.report = report; attempt.durationMs = Date.now() - started; attempt.estimatedCostUsd = report?.estimatedCostUsd ?? 0;
        if (spec.kind === 'supported') {
          attempt.outcome = gradeSupported(spec, selected, result);
          attempt.resultIntent = canonicalIntent(result?.metadata?.intent);
          if (attempt.outcome === 'matched') {
            try {
              attempt.child = childFrom(await publishMatched(store, artifactsDirectory, result, selected));
            } catch (error) {
              attempt.outcome = 'publication-failed'; attempt.child = undefined; attempt.error = clean(error, apiKey);
              await retainUnpublished(root, attempt, result, apiKey);
            }
          } else await retainUnpublished(root, attempt, result, apiKey);
        } else {
          attempt.outcome = 'unexpected-child';
          await retainUnpublished(root, attempt, result, apiKey);
        }
        attempt.status = 'complete'; await save();
        await phaseBudget.settle({ id: attempt.phaseReservationId, estimatedCostUsd: attempt.estimatedCostUsd, uncertain: uncertainReport(report) });
      } catch (error) {
        const report = scrub(error.report, apiKey);
        attempt.report = report; attempt.durationMs = Date.now() - started; attempt.estimatedCostUsd = report?.estimatedCostUsd ?? 0;
        attempt.outcome = spec.kind === 'supported' ? 'failed' : negativeOutcome(spec, selected, error);
        attempt.error = clean(error, apiKey); attempt.status = 'complete'; await save();
        await phaseBudget.settle({ id: attempt.phaseReservationId, estimatedCostUsd: attempt.estimatedCostUsd ?? 0, uncertain: uncertainReport(report) });
      }
      if (await stopForLedger()) return campaign;
    }
    if (campaign.status === 'running') campaign.status = 'complete';
    await save();
    return campaign;
  } finally {
    try { if (store) await store.close(); }
    finally { await rm(lock, { recursive: true }); }
  }
}
