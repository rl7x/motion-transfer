import { replayDigest, validateScenario, expandInputs } from '../parallaxia/replay.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { access, appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PRICES, readUsage, tokenCost } from '../agent/accounting.mjs';
import {
  assertRoadsterInputTokens, ROADSTER_MAX_OUTPUT_TOKENS,
} from '../agent/roadster-request.mjs';
import { recipientRequest, recipientSubmission } from '../agent/recipient-request.mjs';
import { createPhaseBudget, PHASE_ALLOCATIONS } from '../campaign/phase-budget.mjs';
import {
  FRAME_LIMIT, HOSTING_GENERATION_CONFIRMATION, PROVIDER_DEADLINE_MS, PUBLIC_MODEL, PUBLIC_RESERVE_USD,
  REMIX_MAX_COST_USD, SHARED_LEDGER_CONFIRMATION, SHARED_PHASE_DIRECTORY, SOURCE_LIMIT, WORKER_UID,
} from './constants.mjs';
import { assertHostedComponentId } from './component-pin.mjs';
import { isolationError } from './errors.mjs';
import { openExistingPhaseLedger } from './generation.mjs';
import { createJobQueue } from './queue.mjs';
import { publishArtifact } from './publish.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const hexId = /^[a-f0-9]{64}$/;

function statusError(message, status) {
  const error = Error(message);
  error.status = status;
  return error;
}

function assertPaths(urls) {
  for (const url of Object.values(urls)) {
    if (String(url).includes('localhost') || String(url).includes('127.0.0.1') || /^https?:/i.test(url)) {
      throw Error('Artifact URL must be a path');
    }
  }
}

export function isSharedPhaseDirectory(directory) {
  return resolve(directory) === resolve(SHARED_PHASE_DIRECTORY);
}

/**
 * The paid-wrapper hook for the shared phase ledger. Unpublished releases throw
 * before opening the ledger. Charging the shared file also requires an explicit
 * confirmation that this task never passes. A missing shared ledger is not created.
 */
export async function reservePublicGeneration({
  directory, releasePublished = false, confirmSharedLedger, id, maxCostUsd, metadata = {},
} = {}) {
  if (releasePublished !== true) throw Error('Public reserve remains unused because the release is not published');
  if (!directory) throw Error('An explicit phase ledger path is required');
  if (!(maxCostUsd > 0) || maxCostUsd > REMIX_MAX_COST_USD) throw Error('Invalid public remix reservation');
  if (isSharedPhaseDirectory(directory) && confirmSharedLedger !== SHARED_LEDGER_CONFIRMATION) {
    throw Error('Shared public reserve was not confirmed');
  }
  try { await access(join(directory, 'phase-budget.json')); }
  catch (error) {
    if (error.code === 'ENOENT') {
      throw Error(isSharedPhaseDirectory(directory) ? 'Shared public reserve ledger is missing' : 'Phase ledger is missing');
    }
    throw error;
  }
  const budget = await createPhaseBudget(directory);
  return budget.reserve({ id, category: 'public', maxCostUsd, metadata });
}

function withDeadline(signal, promise) {
  if (signal.aborted) return Promise.reject(signal.reason ?? Error('Roadster provider timed out'));
  return new Promise((resolve, reject) => {
    const finish = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      finish();
      reject(signal.reason ?? Error('Roadster provider timed out'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(value => {
      finish();
      resolve(value);
    }, error => {
      finish();
      reject(error);
    });
  });
}

function requireWorker(payload, operation, source, componentId) {
  if (payload?.terminated) throw statusError(`${payload.error || 'Isolated worker did not finish'}; parent unchanged`, 503);
  const result = payload?.result;
  if (payload?.ok !== true || result?.ok !== true || result.passed !== true || result.executedIn !== 'worker'
    || result.operation !== operation || result.uid !== WORKER_UID || result.sourceSha256 !== digest(source)) {
    const error = statusError('Publication requires a real isolated worker result; parent unchanged', 422);
    error.diagnostic = { ...payload, frame: undefined, operation };
    throw error;
  }
  if (result.componentId !== componentId) throw statusError('Verifier component identity changed; parent unchanged', 422);
  return result;
}

export async function createCoordinator({
  directory, broker, client = null, releasePublished = false, ledgerDirectory = null, localVerification = false,
  providerDeadlineMs = PROVIDER_DEADLINE_MS, publishedOrigin = null, operatorConfirmation = null, confirmSharedLedger = null, onAdmit = null,
  maxJobCostUsd = REMIX_MAX_COST_USD,
} = {}) {
  if (releasePublished === true) throw Error('This release build cannot publish or spend the public reserve');
  if (!broker?.submit || !broker.available) throw Error('Hosted mode requires an isolated worker broker');
  if (!Number.isFinite(providerDeadlineMs) || providerDeadlineMs <= 0) throw Error('Invalid provider deadline');
  if (!Number.isFinite(maxJobCostUsd) || maxJobCostUsd <= 0 || maxJobCostUsd > REMIX_MAX_COST_USD) throw Error('Invalid whole-job cost cap');
  // A $7 envelope fits the existing $10 reserve allocation. Keep the $50 ledger,
  // its fixed allocations and every historical reservation unchanged.
  const budgetCategory = maxJobCostUsd > PHASE_ALLOCATIONS.remix ? 'reserve' : 'remix';
  const queue = await createJobQueue(directory);
  const parents = join(directory, 'parents');
  await mkdir(parents, { recursive: true });
  const runners = new Map();
  const inflight = new Map();
  let admitting = false;
  const generationConfigured = Boolean(client?.countInputTokens && client?.respond);

  async function journal(event) {
    await appendFile(join(directory, 'journal.jsonl'), `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`);
  }
  async function hasRoot(id) {
    try { await access(join(parents, id)); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  async function readReceipt(id) {
    try { return JSON.parse(await readFile(join(directory, 'artifacts', id, 'receipt.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function parentSummary(id) {
    for (const path of [join(parents, `${id}.summary.txt`), join(directory, 'artifacts', id, 'summary.txt')]) {
      try {
        const text = (await readFile(path, 'utf8')).trim();
        return text || null;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return null;
  }
  async function parentIntent(id) {
    for (const path of [join(parents, `${id}.intent.json`), join(directory, 'artifacts', id, 'intent.json')]) {
      try { return JSON.parse(await readFile(path, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return null;
  }
  async function parentBytes(id) {
    if (!hexId.test(id)) throw statusError('Unknown parent artifact', 404);
    try { return await readFile(join(parents, id)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { return await readFile(join(directory, 'artifacts', id, 'play.html')); }
    catch (error) {
      if (error.code === 'ENOENT') throw statusError('Unknown parent artifact', 404);
      throw error;
    }
  }
  async function names(dir) {
    try { return (await readdir(dir)).filter(name => hexId.test(name)).sort(); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function lineage(id) {
    const seen = new Set();
    const reversed = [];
    let current = id;
    for (;;) {
      if (typeof current !== 'string' || !hexId.test(current)) throw statusError('Unknown parent artifact', 404);
      if (seen.has(current)) throw statusError('Parent chain is cyclic', 422);
      if (reversed.length >= 32) throw statusError('Parent chain is too long', 422);
      seen.add(current);
      reversed.push(current);
      if (await hasRoot(current)) break;
      const receipt = await readReceipt(current);
      if (!receipt || typeof receipt.parentArtifactId !== 'string' || !hexId.test(receipt.parentArtifactId)
        || !Array.isArray(receipt.parentChain) || receipt.parentChain.at(-1) !== receipt.parentArtifactId) {
        throw statusError('Parent chain is incomplete', 422);
      }
      current = receipt.parentArtifactId;
    }
    const chain = reversed.reverse();
    for (let index = 1; index < chain.length; index += 1) {
      const receipt = await readReceipt(chain[index]);
      const prefix = chain.slice(0, index);
      if (!receipt || receipt.parentArtifactId !== chain[index - 1] || JSON.stringify(receipt.parentChain) !== JSON.stringify(prefix)) {
        throw statusError('Parent chain is incomplete', 422);
      }
    }
    for (const ancestor of chain) await parentBytes(ancestor);
    return chain;
  }
  function parentLinks(parentId, rooted) {
    return rooted
      ? { parent: `/parents/${parentId}`, parentDownload: `/parents/${parentId}/download` }
      : { parent: `/artifacts/${parentId}/play.html`, parentDownload: `/artifacts/${parentId}/download` };
  }
  function publicJob(job) {
    return {
      id: job.id, status: job.status, parentArtifactId: job.parentArtifactId, artifactId: job.artifactId ?? null,
      parentChain: job.parentChain ?? job.ancestors ?? null,
      error: job.error ?? null, model: PUBLIC_MODEL, estimatedCostUsd: job.inference?.estimatedCostUsd ?? 0,
      publicReservedUsd: 0, publicReserveUsd: PUBLIC_RESERVE_USD, urls: job.urls ?? null,
      intent: job.intent ?? null, summary: job.summary ?? null, events: job.events, createdAt: job.createdAt, finishedAt: job.finishedAt, rule: job.ruleIdentity ?? null, experiment: job.experimentReport ?? null,
    };
  }

  async function verifyIsolated({ source, intent, componentId, recipientId, ruleSource = null, ruleId = null, checkContinue = () => {}, runtime, fallback, localVerifier } = {}) {
    if (runtime === 'vm' || fallback || localVerifier) throw Error('Hosted mode cannot fall back to vm');
    assertHostedComponentId(componentId);
    if (await broker.available() !== true) throw isolationError();
    checkContinue();
    const nativePayload = await broker.submit({ operation: 'verify-native', source, intent, componentId, ...(recipientId ? { recipientId,ruleSource } : {}) });
    const native = requireWorker(nativePayload, 'verify-native', source, componentId);
    if (typeof native.javascript !== 'string' || !native.javascript.trim() || Buffer.byteLength(native.javascript) > 32 * 1024
      || native.javascriptSha256 !== digest(native.javascript)) {
      throw statusError('Isolated worker did not return compiled adapter JavaScript; parent unchanged', 422);
    }
    checkContinue();
    const browserPayload = await broker.submit({ operation: 'verify-browser', source, intent, componentId, ...(recipientId ? { recipientId,ruleSource } : {}) });
    const browser = requireWorker(browserPayload, 'verify-browser', source, componentId);
    if (recipientId==='parallaxia' && ((native.ruleId??null)!==ruleId || (browser.ruleId??null)!==ruleId)) throw statusError('Verifier rule identity changed; parent unchanged',422);
    if (recipientId && (native.recipientId !== recipientId || browser.recipientId !== recipientId)) throw statusError('Verifier recipient identity changed; parent unchanged', 422);
    if (native.componentId !== componentId || browser.componentId !== componentId) {
      throw statusError('Verifier component identity changed; parent unchanged', 422);
    }
    if (!Buffer.isBuffer(browserPayload.frame) || !browser.frame?.sha256 || browser.frameSha256 !== browser.frame.sha256
      || digest(browserPayload.frame) !== browser.frame.sha256 || browserPayload.frame.length !== browser.frame.bytes) {
      throw statusError('Verified frame was not returned by the worker; parent unchanged', 422);
    }
    return { native, browser, frame: browserPayload.frame, javascript: native.javascript };
  }

  async function fail(job, error) {
    job.status = 'failed';
    job.error = String(error.message ?? error).slice(0, 500);
    job.finishedAt = new Date().toISOString();
    job.events.push({ status: 'failed', at: job.finishedAt });
    await queue.save(job);
    await journal({ kind: 'failed', jobId: job.id, parentArtifactId: job.parentArtifactId, error: job.error });
  }

  async function parentContext(id) {
    const rooted = await hasRoot(id);
    const sourcePath = rooted ? join(parents, `${id}.source.ts`) : join(directory, 'artifacts', id, 'adapter.ts');
    const componentPath = rooted ? join(parents, `${id}.component.json`) : join(directory, 'artifacts', id, 'component.json');
    const recipientPath = rooted ? join(parents, `${id}.recipient.json`) : join(directory, 'artifacts', id, 'recipient.json');
    try {
      const source = await readFile(sourcePath, 'utf8');
      const component = JSON.parse(await readFile(componentPath, 'utf8'));
      const recipient = JSON.parse(await readFile(recipientPath, 'utf8'));
      const intent = await parentIntent(id);
      let ruleIdentity = (await readReceipt(id))?.rule ?? null;
      let ruleSource = null;
      try {const bytes=await readFile(rooted?join(parents,`${id}.rule.mjs`):join(directory,'artifacts',id,'rule.mjs'),'utf8');if(ruleIdentity?.id)ruleSource=bytes;}catch(error){if(error.code!=='ENOENT')throw error;}
      if (!intent || typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > SOURCE_LIMIT) throw Error('Verified parent context is incomplete');
      if (!component?.javascript || component.contract == null || Buffer.byteLength(component.javascript) > 65536) throw Error('Verified parent context is incomplete');
      if (component.id && !hexId.test(component.id)) throw Error('Verified parent context is incomplete');
      if (typeof recipient?.name !== 'string' || typeof recipient?.revision !== 'string') throw Error('Verified parent context is incomplete');
      return {
        intent,
        source, ruleSource, ruleIdentity,
        component: { id: component.id ?? null, javascript: component.javascript, contract: component.contract },
        recipient: { ...recipient },
      };
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) throw statusError('Verified parent context is incomplete', 422);
      if (error.status) throw error;
      throw statusError(error.message || 'Verified parent context is incomplete', 422);
    }
  }

  async function run(job) {
    let before = null, budget = null, reserved = false, settled = false, uncertain = false, cost = 0;
    const reservationId = `remix:${job.id}`;
    const cancelled = () => { if (job.cancelRequested) throw statusError('Cancelled; parent unchanged. In-flight charges are retained.', 409); };
    const stage = async status => { job.status = status; job.events.push({ status, at: new Date().toISOString() }); await queue.save(job); };
    try {
      if (await broker.available() !== true) throw isolationError();
      const ancestors = await lineage(job.parentArtifactId);
      if (JSON.stringify(ancestors) !== JSON.stringify(job.ancestors)) throw statusError('Parent chain changed during verification', 422);
      before = await parentBytes(job.parentArtifactId);
      const context = await parentContext(job.parentArtifactId);
      assertHostedComponentId(context.component.id);
      let observation = null;
      if (job.experiment) {
        await stage('reconstructing');
        const payload = await broker.submit({operation:'verify-checkpoint',recipientId:'parallaxia',source:context.source,intent:context.intent,componentId:context.component.id,checkpoint:job.experiment.checkpoint,ruleSource:context.ruleSource});
        const checked = requireWorker(payload,'verify-checkpoint',context.source,context.component.id);
        if (checked.checkpointId !== await replayDigest(job.experiment.checkpoint)) throw Error('Checkpoint identity changed in worker');
        observation = checked.observation;
      }
      budget = await openExistingPhaseLedger(ledgerDirectory, { confirmSharedLedger });
      await budget.reserve({ id: reservationId, category: job.budgetCategory, maxCostUsd: job.maxCostUsd,
        metadata: { localVerification: localVerification === true, model: PUBLIC_MODEL, jobId: job.id, recipientId: context.recipient.id ?? 'roadster' } });
      reserved = true;
      job.attempts = [];
      let submission, verified;
      const maxAttempts = context.recipient.id === 'parallaxia' ? 2 : 1;
      let feedback = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        cancelled();
        job.provider = { status: 'pending', reservationId, attempt };
        await stage(attempt === 1 ? 'pending' : 'repairing');
        uncertain = true;
        const request = recipientRequest({ model: PUBLIC_MODEL, context, prompt: job.prompt, feedback, experiment: job.experiment, observation, composition: job.composition });
        const signal = AbortSignal.timeout(providerDeadlineMs);
        const inputTokens = assertRoadsterInputTokens(await withDeadline(signal, client.countInputTokens(request, signal)));
        const estimate = (inputTokens * PRICES[PUBLIC_MODEL].input + ROADSTER_MAX_OUTPUT_TOKENS * PRICES[PUBLIC_MODEL].output) / 1e6;
        if (cost + estimate > job.maxCostUsd) throw statusError('Whole-job budget cannot cover another response; no generation started', 402);
        cancelled();
        job.provider = { status: 'pending', reservationId, attempt }; await queue.save(job);
        const startedAt = new Date().toISOString();
        uncertain = true;
        const response = await withDeadline(signal, client.respond(request, signal));
        cost += tokenCost(readUsage(response.usage), PRICES[PUBLIC_MODEL]);
        uncertain = response.status !== 'completed' || cost > job.maxCostUsd;
        const record = { attempt, startedAt, finishedAt: new Date().toISOString(), inputTokens, request, response, estimatedCostUsd: cost };
        await mkdir(join(directory, 'provider'), { recursive: true });
        await writeFile(join(directory, 'provider', `${job.id}-${attempt}.json`), JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
        job.attempts.push(record);
        job.inference = { model: PUBLIC_MODEL, estimatedCostUsd: cost, publicReserveUsd: PUBLIC_RESERVE_USD, publicReservedUsd: 0,
          ledgerReservedUsd: job.maxCostUsd, ledgerSettledUsd: 0, budgetCategory: job.budgetCategory, reason: `local development; existing ${job.budgetCategory} allocation` };
        job.provider = { status: 'responded', reservationId, attempt }; await stage('responded');
        await journal({ kind: 'provider-responded', jobId: job.id, reservationId, attempt, estimatedCostUsd: cost, publicReservedUsd: 0 });
        if (uncertain) throw statusError('Recipient response incomplete or whole-job budget exceeded', 402);
        cancelled();
        try {
          submission = recipientSubmission(response, context, job.prompt, { experiment: job.experiment, composition: job.composition });
          if (submission.status === 'unsupported') {
            await budget.settle({ id: reservationId, estimatedCostUsd: cost, uncertain: false }); settled = true;
            job.summary = submission.summary; job.intent = submission.intent; job.error = submission.summary;
            job.finishedAt = new Date().toISOString(); await stage('unsupported'); return;
          }
          await stage('verifying');
          const ruleSource = job.composition ? submission.ruleSource : context.ruleSource;
          const ruleId = job.composition === 'dash-end-shot' ? digest(ruleSource) : job.composition === 'none' ? null : context.ruleIdentity?.id ?? null;
          job.ruleSource=ruleSource;job.ruleIdentity={id:ruleId,kind:ruleId?'dash-end-shot':'none'};
          verified = await verifyIsolated({ source: submission.source, checkContinue:cancelled, intent: submission.intent,
            componentId: context.component.id, ...(context.recipient.id === 'parallaxia' ? { recipientId: 'parallaxia',ruleSource,ruleId } : {}) });
          if (job.experiment) {
            const payload = await broker.submit({operation:'verify-experiment',recipientId:'parallaxia',source:submission.source,intent:submission.intent,
              parentSource:context.source,parentIntent:context.intent,parentRuleSource:context.ruleSource,ruleSource:job.ruleSource,componentId:context.component.id,checkpoint:job.experiment.checkpoint,scenario:job.experiment.scenario,interventionTick:submission.interventionTick});
            const checked = requireWorker(payload,'verify-experiment',submission.source,context.component.id);
            if (checked.checkpointId !== await replayDigest(job.experiment.checkpoint) || checked.scenarioSha256 !== await replayDigest(job.experiment.scenario)) throw Error('Frozen experiment identity changed in worker');
            job.experimentReport = {...checked.report,parentAdapterSha256:digest(context.source),candidateAdapterSha256:digest(submission.source)};
            record.experiment = job.experimentReport;
            if (!checked.report.satisfied && attempt < maxAttempts) throw Error('Candidate failed the fixed goal or no-life-loss constraint');
          }
          record.passed = !job.experiment || job.experimentReport.satisfied; break;
        } catch (error) {
          record.passed = false; record.failure = error.message; record.diagnostic = error.diagnostic ?? null;
          await writeFile(join(directory, 'provider', `${job.id}-${attempt}.json`), JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
          await queue.save(job);
          if (attempt === maxAttempts || /component identity|isolation|terminated|timeout/i.test(error.message)) throw error;
          feedback = { error: error.message, workerError: error.diagnostic?.result?.error ?? error.diagnostic?.error ?? null, failedOperation:error.diagnostic?.operation??null, rejectedRuleSource:submission?.ruleSource??null, checks: error.diagnostic?.result?.checks ?? [], rejectedSource: submission?.source ?? null,
            experiment: job.experimentReport ? {satisfied:job.experimentReport.satisfied,target:job.experimentReport.scenario.target,interventionTick:job.experimentReport.interventionTick,branches:['original','candidate'].map(kind=>{const branch=job.experimentReport[kind];return {kind,reachedTick:branch.reachedTick,lostLife:branch.lostLife,alive:branch.alive,first:branch.frames[0],last:branch.frames.at(-1)}})} : null, instruction: 'Repair only the failed adapter. Preserve the requested complete parent mapping and the accepted component.' };
        }
      }
      cancelled();
      await budget.settle({ id: reservationId, estimatedCostUsd: cost, uncertain: false }); settled = true;
      job.inference.ledgerSettledUsd = cost;
      if (!before.equals(await parentBytes(job.parentArtifactId))) throw statusError('Parent artifact changed during verification', 422);
      const nativeReceipt = { ...verified.native }; delete nativeReceipt.javascript;
      const rooted = await hasRoot(job.parentArtifactId);
      await stage('publishing'); cancelled();
      const published = await publishArtifact({ directory, parentId: job.parentArtifactId, files: {
        ...(job.experimentReport ? {'experiment.json':JSON.stringify(job.experimentReport,null,2)+'\n'} : {}),
        ...(context.recipient.id==='parallaxia'?{'rule.mjs':job.ruleSource??'export default null;\n'}:{}),
        'adapter.ts': submission.source, 'adapter.js': verified.javascript,
        'intent.json': JSON.stringify(submission.intent) + '\n',
        'component.json': JSON.stringify(context.component) + '\n',
        'recipient.json': JSON.stringify(context.recipient) + '\n',
        'notices.txt': context.recipient.notices ?? '',
        'generation.json': JSON.stringify({ kind: 'new-meta-generation', jobId: job.id, prompt: job.prompt,
          model: PUBLIC_MODEL, attempts: job.attempts, estimatedCostUsd: cost, maxJobCostUsd: job.maxCostUsd, budgetCategory: job.budgetCategory, createdAt: job.createdAt }, null, 2) + '\n',
        'receipt.json': JSON.stringify({ passed: !job.experimentReport || job.experimentReport.satisfied, adapterVerified: true, kind: job.experimentReport ? 'checkpoint-experiment' : 'recipient-adaptation', model: PUBLIC_MODEL, parentArtifactId: job.parentArtifactId, parentChain: ancestors,
          summary: submission.summary, intent: submission.intent, recipient: context.recipient, rule:job.ruleIdentity??null, ...(job.experimentReport ? {experiment:job.experimentReport} : {}),
          componentId: verified.native.componentId, sourceSha256: verified.native.sourceSha256,
          javascriptSha256: verified.native.javascriptSha256, frameSha256: verified.browser.frameSha256,
          native: nativeReceipt, browser: verified.browser }, null, 2) + '\n',
        'play.html': verified.frame,
      } });
      const urls = { ...published.urls, ...parentLinks(job.parentArtifactId, rooted) }; assertPaths(urls);
      job.intent = submission.intent; job.summary = submission.summary; job.artifactId = published.id;
      job.parentChain = [...ancestors, published.id]; job.urls = urls; job.finishedAt = new Date().toISOString();
      await stage(job.experimentReport && !job.experimentReport.satisfied ? 'unsuccessful' : 'ready');
      await journal({ kind: 'published', jobId: job.id, artifactId: published.id, parentChain: job.parentChain, urls });
    } catch (error) {
      if (reserved && !settled) {
        try { await budget.settle({ id: reservationId, estimatedCostUsd: cost, uncertain }); }
        catch { /* Retain the existing full reservation if settlement fails. */ }
      }
      if (job.cancelRequested) {
        job.error = error.message; job.finishedAt = new Date().toISOString(); await stage('cancelled');
      } else await fail(job, error);
    } finally {
      if (before) {
        try { if (!before.equals(await parentBytes(job.parentArtifactId))) await fail(job, Error('Parent artifact changed during verification')); }
        catch (error) { await fail(job, error); }
      }
    }
  }

  function sameRequest(existing, request) {
    return existing.prompt === request.prompt && existing.parentArtifactId === request.parentArtifactId && existing.sessionId === request.sessionId && JSON.stringify(existing.experiment ?? null) === JSON.stringify(request.experiment ?? null) && (existing.composition??null)===(request.composition??null);
  }
  function replay(request) {
    const existing = queue.findIdempotent(request.idempotencyKey);
    if (!existing) return null;
    if (!sameRequest(existing, request)) throw statusError('Request ID already used for different input', 409);
    return publicJob(existing);
  }

  return {
    model: PUBLIC_MODEL,
    publicReserveUsd: PUBLIC_RESERVE_USD,
    releasePublished: false,
    verifyIsolated,
    async brokerAvailable() { return broker.available(); },
    async putParent({ id, bytes, intent = null, source = null, component = null, recipient = null, summary = null }) {
      if (!hexId.test(id)) throw Error('Invalid parent artifact');
      if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > FRAME_LIMIT) throw Error('Parent frame is invalid');
      await writeFile(join(parents, id), bytes, { flag: 'wx' });
      if (intent) await writeFile(join(parents, `${id}.intent.json`), JSON.stringify(intent), { flag: 'wx' });
      if (source != null) {
        if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > SOURCE_LIMIT) throw Error('Parent source is invalid');
        await writeFile(join(parents, `${id}.source.ts`), source, { flag: 'wx' });
      }
      if (component != null) {
        if (!component.javascript || component.contract == null || (component.id && !hexId.test(component.id))) throw Error('Parent component is invalid');
        if (Buffer.byteLength(component.javascript) > 65536) throw Error('Parent component is invalid');
        await writeFile(join(parents, `${id}.component.json`), JSON.stringify({
          id: component.id ?? null, javascript: component.javascript, contract: component.contract,
        }), { flag: 'wx' });
      }
      if (recipient != null) {
        if (typeof recipient.name !== 'string' || typeof recipient.revision !== 'string') throw Error('Parent recipient is invalid');
        await writeFile(join(parents, `${id}.recipient.json`), JSON.stringify(recipient), { flag: 'wx' });
      }
      if (summary != null) {
        if (typeof summary !== 'string' || !summary.trim() || summary.length > 1000) throw Error('Parent summary is invalid');
        await writeFile(join(parents, `${id}.summary.txt`), summary, { flag: 'wx' });
      }
    },
    parentBytes,
    async artifactFile(id, name) {
      if (!hexId.test(id) || !/^[a-z0-9.-]+$/i.test(name)) return null;
      try { return await readFile(join(directory, 'artifacts', id, name)); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async catalog() {
      const artifacts = [];
      for (const id of await names(join(directory, 'artifacts'))) {
        const receipt = await readReceipt(id);
        if (receipt?.experiment && receipt.experiment.satisfied !== true) continue;
        artifacts.push({
          id, parentArtifactId: receipt?.parentArtifactId ?? null,
          parentChain: Array.isArray(receipt?.parentChain) ? [...receipt.parentChain, id] : [id],
          play: `/artifacts/${id}/play.html`, download: `/artifacts/${id}/download`, receipt: `/artifacts/${id}`,
          intent: await parentIntent(id), summary: receipt?.summary ?? await parentSummary(id),
        });
      }
      const parentIds = await names(parents);
      const parentEntries = [];
      for (const id of parentIds) {
        parentEntries.push({
          id, play: `/parents/${id}`, download: `/parents/${id}/download`,
          intent: await parentIntent(id), summary: await parentSummary(id),
        });
      }
      return {
        playback: true, generationConfigured, releasePublished: false, publicReservedUsd: 0,
        publicReserveUsd: PUBLIC_RESERVE_USD, model: PUBLIC_MODEL, maxJobCostUsd,
        routes: {
          catalog: '/api/catalog', remix: '/api/remixes', job: '/api/remixes/:id', privacy: '/privacy',
          parent: '/parents/:id', play: '/artifacts/:id/play.html', creator: '/',
        },
        parents: parentEntries,
        artifacts,
      };
    },
    async submit(request) {
      const already = replay(request);
      if (already) return already;
      const pending = inflight.get(request.idempotencyKey);
      if (pending) {
        if (!sameRequest(pending.request, request)) throw statusError('Request ID already used for different input', 409);
        return pending.gate;
      }
      let settle;
      let failSubmit;
      const gate = new Promise((resolveGate, rejectGate) => { settle = resolveGate; failSubmit = rejectGate; });
      gate.catch(() => {});
      inflight.set(request.idempotencyKey, {
        request: { prompt: request.prompt, parentArtifactId: request.parentArtifactId, sessionId: request.sessionId, experiment: request.experiment ?? null, composition: request.composition ?? null },
        gate,
      });
      try {
        if (onAdmit) await onAdmit(request);
        const raced = replay(request);
        if (raced) { settle(raced); return raced; }
        if (queue.sessionCount(request.sessionId) >= queue.sessionJobLimit) throw statusError('Session remix quota is exhausted', 429);
        if (queue.activeCount() >= queue.globalActiveLimit || admitting) throw statusError('A remix is already running', 429);
        admitting = true;
        try {
          if (request.experiment) {validateScenario(request.experiment.scenario);expandInputs(request.experiment.checkpoint?.frames);}
          const ancestors = await lineage(request.parentArtifactId);
          if (await broker.available() !== true) throw isolationError();
          if (!generationConfigured) throw statusError('Public generation is not configured', 503);
          if (localVerification !== true) {
            if (operatorConfirmation !== HOSTING_GENERATION_CONFIRMATION) throw statusError('Hosted generation confirmation is required', 503);
            if (typeof publishedOrigin !== 'string' || !publishedOrigin.startsWith('https://') || publishedOrigin.includes('localhost') || publishedOrigin.includes('127.0.0.1')) {
              throw statusError('Published origin was not confirmed', 503);
            }
          }
          if (!ledgerDirectory) throw statusError('An explicit phase ledger path is required', 503);
          const phase = await (await openExistingPhaseLedger(ledgerDirectory, { confirmSharedLedger })).status();
          if (phase.uncertain || phase.overrun) throw statusError('Phase billing is uncertain or exceeded a reservation; no further inference admitted', 402);
          if (phase.remainingUsd < maxJobCostUsd || phase.categories[budgetCategory].remainingUsd < maxJobCostUsd) {
            throw statusError('Phase budget cannot cover the whole-job reservation; no inference admitted', 402);
          }
          const job = {
            schemaVersion: 1, id: randomUUID(), sessionId: request.sessionId, idempotencyKey: request.idempotencyKey,
            parentArtifactId: request.parentArtifactId, experiment: request.experiment ?? null, composition: request.composition ?? null, ancestors, prompt: request.prompt, model: PUBLIC_MODEL, status: 'queued',
            maxCostUsd: maxJobCostUsd, budgetCategory,
            error: null, artifactId: null, urls: null, inference: null,
            events: [{ status: 'queued', at: new Date().toISOString() }],
            createdAt: new Date().toISOString(), finishedAt: null,
          };
          await queue.save(job);
          await journal({ kind: 'queued', jobId: job.id, parentArtifactId: job.parentArtifactId, parentChain: ancestors });
          const promise = run(job).finally(() => runners.delete(job.id));
          runners.set(job.id, promise);
          promise.catch(() => {});
          const view = publicJob(job);
          settle(view);
          return view;
        } finally { admitting = false; }
      } catch (error) {
        failSubmit(error);
        throw error;
      } finally { inflight.delete(request.idempotencyKey); }
    },
    async job(id) {
      const found = queue.get(id);
      if (!found) throw statusError('Run not found', 404);
      return publicJob(found);
    },
    async cancel(id, sessionId) {
      const job = queue.get(id); if (!job) throw statusError('Run not found', 404);
      if (sessionId !== job.sessionId) throw statusError('Session does not own this job', 403);
      if (['ready','failed','unsupported','cancelled','unsuccessful'].includes(job.status)) return publicJob(job);
      job.cancelRequested = true; job.events.push({status:'cancel-requested',at:new Date().toISOString()}); await queue.save(job); return publicJob(job);
    },
    async wait(id) {
      if (runners.has(id)) await runners.get(id);
      return this.job(id);
    },
    status() {
      return {
        ok: true, model: PUBLIC_MODEL, publicReserveUsd: PUBLIC_RESERVE_USD, publicReservedUsd: 0,
        releasePublished: false, recoveryEnabled: false, generationConfigured, maxJobCostUsd,
      };
    },
    async close() {
      await Promise.all([...runners.values()].map(promise => promise.catch(() => {})));
      await queue.close();
    },
  };
}
