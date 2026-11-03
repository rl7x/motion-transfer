import { randomUUID, createHash } from 'node:crypto';
import { access, appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PRICES, readUsage, tokenCost } from '../agent/accounting.mjs';
import {
  assertRoadsterInputTokens, readRoadsterSubmission, ROADSTER_MAX_OUTPUT_TOKENS, ROADSTER_TOOL, roadsterEvidence, roadsterProviderRequest,
} from '../agent/roadster-request.mjs';
import { createPhaseBudget } from '../campaign/phase-budget.mjs';
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
    throw statusError('Publication requires a real isolated worker result; parent unchanged', 422);
  }
  if (result.componentId !== componentId) throw statusError('Verifier component identity changed; parent unchanged', 422);
  return result;
}

export async function createCoordinator({
  directory, broker, client = null, releasePublished = false, ledgerDirectory = null, localVerification = false,
  providerDeadlineMs = PROVIDER_DEADLINE_MS, publishedOrigin = null, operatorConfirmation = null, onAdmit = null,
} = {}) {
  if (releasePublished === true) throw Error('This release build cannot publish or spend the public reserve');
  if (!broker?.submit || !broker.available) throw Error('Hosted mode requires an isolated worker broker');
  if (!Number.isFinite(providerDeadlineMs) || providerDeadlineMs <= 0) throw Error('Invalid provider deadline');
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
      intent: job.intent ?? null, summary: job.summary ?? null,
    };
  }

  async function verifyIsolated({ source, intent, componentId, runtime, fallback, localVerifier } = {}) {
    if (runtime === 'vm' || fallback || localVerifier) throw Error('Hosted mode cannot fall back to vm');
    assertHostedComponentId(componentId);
    if (await broker.available() !== true) throw isolationError();
    const nativePayload = await broker.submit({ operation: 'verify-native', source, intent, componentId });
    const native = requireWorker(nativePayload, 'verify-native', source, componentId);
    if (typeof native.javascript !== 'string' || !native.javascript.trim() || Buffer.byteLength(native.javascript) > 32 * 1024
      || native.javascriptSha256 !== digest(native.javascript)) {
      throw statusError('Isolated worker did not return compiled adapter JavaScript; parent unchanged', 422);
    }
    const browserPayload = await broker.submit({ operation: 'verify-browser', source, intent, componentId });
    const browser = requireWorker(browserPayload, 'verify-browser', source, componentId);
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
      if (!intent || typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > SOURCE_LIMIT) throw Error('Verified parent context is incomplete');
      if (!component?.javascript || component.contract == null || Buffer.byteLength(component.javascript) > 65536) throw Error('Verified parent context is incomplete');
      if (component.id && !hexId.test(component.id)) throw Error('Verified parent context is incomplete');
      if (typeof recipient?.name !== 'string' || typeof recipient?.revision !== 'string') throw Error('Verified parent context is incomplete');
      return {
        intent,
        source,
        component: { id: component.id ?? null, javascript: component.javascript, contract: component.contract },
        recipient: { name: recipient.name, revision: recipient.revision },
      };
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) throw statusError('Verified parent context is incomplete', 422);
      if (error.status) throw error;
      throw statusError(error.message || 'Verified parent context is incomplete', 422);
    }
  }

  async function run(job) {
    let before = null;
    let reserved = false;
    let settled = false;
    const reservationId = `remix:${job.id}`;
    try {
      if (await broker.available() !== true) throw isolationError();
      const ancestors = await lineage(job.parentArtifactId);
      if (JSON.stringify(ancestors) !== JSON.stringify(job.ancestors)) throw statusError('Parent chain changed during verification', 422);
      before = await parentBytes(job.parentArtifactId);
      const context = await parentContext(job.parentArtifactId);
      assertHostedComponentId(context.component.id);
      const budget = await openExistingPhaseLedger(ledgerDirectory);
      await budget.reserve({
        id: reservationId, category: 'remix', maxCostUsd: REMIX_MAX_COST_USD,
        metadata: { localVerification: localVerification === true, model: PUBLIC_MODEL, jobId: job.id },
      });
      reserved = true;
      job.status = 'pending';
      job.provider = { status: 'pending', reservationId };
      job.events.push({ status: 'pending', at: new Date().toISOString() });
      await queue.save(job);
      await journal({ kind: 'provider-pending', jobId: job.id, reservationId, publicReservedUsd: 0 });
      {
        const evidence = roadsterEvidence({
          prompt: job.prompt, parentIntent: context.intent, parentSource: context.source,
          component: context.component, recipient: context.recipient,
        });
        const request = roadsterProviderRequest({ model: PUBLIC_MODEL, evidence });
        const signal = AbortSignal.timeout(providerDeadlineMs);
        const price = PRICES[PUBLIC_MODEL];
        const inputTokens = assertRoadsterInputTokens(await withDeadline(signal, client.countInputTokens(request, signal)));
        const estimate = (inputTokens * price.input + ROADSTER_MAX_OUTPUT_TOKENS * price.output) / 1e6;
        if (estimate > REMIX_MAX_COST_USD) throw statusError('Roadster budget cannot cover this request; no generation started', 402);
        const response = await withDeadline(signal, client.respond(request, signal));
        job.provider = { status: 'responded', reservationId };
        job.events.push({ status: 'responded', at: new Date().toISOString() });
        await queue.save(job);
        await journal({ kind: 'provider-responded', jobId: job.id, reservationId, publicReservedUsd: 0 });
        const estimatedCostUsd = tokenCost(readUsage(response.usage), price);
        const incomplete = response.status !== 'completed' || estimatedCostUsd > REMIX_MAX_COST_USD;
        await budget.settle({ id: reservationId, estimatedCostUsd, uncertain: incomplete });
        settled = true;
        if (incomplete) throw statusError('Roadster response incomplete or budget exceeded', 402);
        job.inference = {
          model: PUBLIC_MODEL, estimatedCostUsd, publicReserveUsd: PUBLIC_RESERVE_USD, publicReservedUsd: 0,
          ledgerReservedUsd: REMIX_MAX_COST_USD, ledgerSettledUsd: estimatedCostUsd,
          reason: 'release not published; public reserve unused',
        };
        await journal({ kind: 'provider', jobId: job.id, model: PUBLIC_MODEL, estimatedCostUsd, publicReservedUsd: 0 });
        const calls = response.output?.filter(item => item.type === 'function_call') ?? [];
        if (calls.length !== 1 || calls[0].name !== ROADSTER_TOOL.name) throw statusError('Meta did not submit one Roadster adapter', 502);
        const submission = readRoadsterSubmission(calls[0].arguments, context.intent, { parentSource: context.source });
        if ((submission.status ?? 'supported') === 'unsupported') {
          job.status = 'unsupported';
          job.summary = submission.summary;
          job.intent = submission.intent;
          job.error = submission.summary.slice(0, 500);
          job.finishedAt = new Date().toISOString();
          job.events.push({ status: 'unsupported', at: job.finishedAt });
          await queue.save(job);
          await journal({ kind: 'unsupported', jobId: job.id, parentChain: ancestors });
          return;
        }
        job.status = 'verifying';
        job.events.push({ status: 'verifying', at: new Date().toISOString() });
        await queue.save(job);
        const verified = await verifyIsolated({
          source: submission.source, intent: submission.intent, componentId: context.component.id,
        });
        const during = await parentBytes(job.parentArtifactId);
        if (!before.equals(during)) throw statusError('Parent artifact changed during verification', 422);
        const nativeReceipt = { ...verified.native };
        delete nativeReceipt.javascript;
        const rooted = await hasRoot(job.parentArtifactId);
        const published = await publishArtifact({
          directory, parentId: job.parentArtifactId, files: {
            'adapter.ts': submission.source,
            'adapter.js': verified.javascript,
            'intent.json': `${JSON.stringify(submission.intent)}\n`,
            'component.json': `${JSON.stringify(context.component)}\n`,
            'recipient.json': `${JSON.stringify(context.recipient)}\n`,
            'receipt.json': `${JSON.stringify({
              passed: true, model: PUBLIC_MODEL, parentArtifactId: job.parentArtifactId, parentChain: ancestors,
              summary: submission.summary, intent: submission.intent,
              componentId: verified.native.componentId, sourceSha256: verified.native.sourceSha256,
              javascriptSha256: verified.native.javascriptSha256, frameSha256: verified.browser.frameSha256,
              native: nativeReceipt, browser: verified.browser,
            }, null, 2)}\n`,
            'play.html': verified.frame,
          },
        });
      const urls = { ...published.urls, ...parentLinks(job.parentArtifactId, rooted) };
      assertPaths(urls);
      job.status = 'ready';
      job.intent = submission.intent;
      job.summary = submission.summary;
      job.artifactId = published.id;
      job.parentChain = [...ancestors, published.id];
      job.urls = urls;
      job.finishedAt = new Date().toISOString();
      job.events.push({ status: 'ready', at: job.finishedAt });
      await queue.save(job);
      await journal({ kind: 'published', jobId: job.id, artifactId: published.id, parentChain: job.parentChain, urls });
      }
    } catch (error) {
      if (reserved && !settled) {
        try {
          const budget = await openExistingPhaseLedger(ledgerDirectory);
          await budget.settle({ id: reservationId, estimatedCostUsd: 0, uncertain: true });
        } catch { /* a failed settlement stays reserved and still blocks the next call once the owner is gone */ }
      }
      await fail(job, error);
    } finally {
      if (before) {
        try {
          const after = await parentBytes(job.parentArtifactId);
          if (!before.equals(after)) await fail(job, Error('Parent artifact changed during verification'));
        } catch (error) {
          await fail(job, error);
        }
      }
    }
  }

  function sameRequest(existing, request) {
    return existing.prompt === request.prompt && existing.parentArtifactId === request.parentArtifactId && existing.sessionId === request.sessionId;
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
        await writeFile(join(parents, `${id}.recipient.json`), JSON.stringify({ name: recipient.name, revision: recipient.revision }), { flag: 'wx' });
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
        publicReserveUsd: PUBLIC_RESERVE_USD, model: PUBLIC_MODEL,
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
        request: { prompt: request.prompt, parentArtifactId: request.parentArtifactId, sessionId: request.sessionId },
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
          const phase = await (await openExistingPhaseLedger(ledgerDirectory)).status();
          if (phase.uncertain || phase.overrun) throw statusError('Phase billing is uncertain or exceeded a reservation; no further inference admitted', 402);
          const job = {
            schemaVersion: 1, id: randomUUID(), sessionId: request.sessionId, idempotencyKey: request.idempotencyKey,
            parentArtifactId: request.parentArtifactId, ancestors, prompt: request.prompt, model: PUBLIC_MODEL, status: 'queued',
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
    async wait(id) {
      if (runners.has(id)) await runners.get(id);
      return this.job(id);
    },
    status() {
      return {
        ok: true, model: PUBLIC_MODEL, publicReserveUsd: PUBLIC_RESERVE_USD, publicReservedUsd: 0,
        releasePublished: false, recoveryEnabled: false, generationConfigured,
      };
    },
    async close() {
      await Promise.all([...runners.values()].map(promise => promise.catch(() => {})));
      await queue.close();
    },
  };
}
