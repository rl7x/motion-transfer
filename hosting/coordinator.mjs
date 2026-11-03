import { randomUUID, createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PRICES, readUsage, tokenCost } from '../agent/accounting.mjs';
import { createPhaseBudget } from '../campaign/phase-budget.mjs';
import {
  PUBLIC_MODEL, PUBLIC_RESERVE_USD, REMIX_MAX_COST_USD, SHARED_LEDGER_CONFIRMATION, SHARED_PHASE_DIRECTORY,
} from './constants.mjs';
import { isolationError } from './errors.mjs';
import { createJobQueue } from './queue.mjs';
import { publishArtifact } from './publish.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');

function intentText(intent) {
  return JSON.stringify({ unitScale: intent?.unitScale, activation: intent?.activation, direction: intent?.direction });
}

function statusError(message, status) {
  const error = Error(message);
  error.status = status;
  return error;
}

export function isSharedPhaseDirectory(directory) {
  return resolve(directory) === resolve(SHARED_PHASE_DIRECTORY);
}

/**
 * The paid-wrapper hook for the shared phase ledger. Unpublished releases throw
 * before opening the ledger. Charging the shared file also requires an explicit
 * confirmation that this task never passes.
 */
export async function reservePublicGeneration({
  directory, releasePublished = false, confirmSharedLedger, id, maxCostUsd, metadata = {},
} = {}) {
  if (releasePublished !== true) throw Error('Public reserve remains unused because the release is not published');
  if (!directory || !(maxCostUsd > 0) || maxCostUsd > REMIX_MAX_COST_USD) throw Error('Invalid public remix reservation');
  if (isSharedPhaseDirectory(directory) && confirmSharedLedger !== SHARED_LEDGER_CONFIRMATION) {
    throw Error('Shared public reserve was not confirmed');
  }
  const budget = await createPhaseBudget(directory);
  return budget.reserve({ id, category: 'public', maxCostUsd, metadata });
}

function readSubmission(response) {
  const calls = response.output?.filter(item => item.type === 'function_call') ?? [];
  if (calls.length !== 1 || calls[0].name !== 'submit_roadster_adapter' || typeof calls[0].arguments !== 'string') {
    throw statusError('Meta did not submit one Roadster adapter', 502);
  }
  let submission;
  try { submission = JSON.parse(calls[0].arguments); }
  catch { throw statusError('Meta did not submit one Roadster adapter', 502); }
  if (submission.status === 'unsupported') {
    if (typeof submission.summary !== 'string' || !submission.summary.trim()) throw statusError('Unsupported requests need an explanation', 422);
    return { status: 'unsupported', summary: submission.summary };
  }
  if (submission.status && submission.status !== 'supported') throw statusError('Invalid Roadster submission', 422);
  if (typeof submission.source !== 'string' || !submission.source.trim()) throw statusError('A supported adapter needs complete source', 422);
  return { status: 'supported', source: submission.source, intent: submission.intent, summary: submission.summary ?? '' };
}

export async function createCoordinator({ directory, broker, client = null, releasePublished = false } = {}) {
  if (releasePublished === true) throw Error('This release build cannot publish or spend the public reserve');
  if (!broker?.submit || !broker.available) throw Error('Hosted mode requires an isolated worker broker');
  const queue = await createJobQueue(directory);
  const parents = join(directory, 'parents');
  await mkdir(parents, { recursive: true });
  const runners = new Map();
  let admitting = false;

  async function journal(event) {
    await appendFile(join(directory, 'journal.jsonl'), `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`);
  }
  async function parentIntent(id) {
    try { return JSON.parse(await readFile(join(parents, `${id}.intent.json`), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function parentBytes(id) {
    try { return await readFile(join(parents, id)); }
    catch (error) {
      if (error.code === 'ENOENT') throw statusError('Unknown parent artifact', 404);
      throw error;
    }
  }
  function publicJob(job) {
    return {
      id: job.id, status: job.status, parentArtifactId: job.parentArtifactId, artifactId: job.artifactId ?? null,
      error: job.error ?? null, model: PUBLIC_MODEL, estimatedCostUsd: job.inference?.estimatedCostUsd ?? 0,
      publicReservedUsd: 0, publicReserveUsd: PUBLIC_RESERVE_USD, urls: job.urls ?? null,
    };
  }

  async function verifyIsolated({ source, intent, runtime, fallback, localVerifier } = {}) {
    if (runtime === 'vm' || fallback || localVerifier) throw Error('Hosted mode cannot fall back to vm');
    if (await broker.available() !== true) throw isolationError();
    const native = await broker.submit({ operation: 'verify-native', source, intent });
    if (native.terminated || native.ok !== true || native.result?.passed !== true) {
      throw statusError(native.error || 'Native verification failed; parent unchanged', native.terminated ? 503 : 422);
    }
    const browser = await broker.submit({ operation: 'verify-browser', source, intent });
    if (browser.terminated || browser.ok !== true || browser.result?.passed !== true) {
      throw statusError(browser.error || 'Browser verification failed; parent unchanged', browser.terminated ? 503 : 422);
    }
    if (!native.result.componentId || native.result.componentId !== browser.result.componentId) {
      throw statusError('Verifier component identity changed; parent unchanged', 422);
    }
    if (browser.frame && browser.result.frame?.sha256) {
      if (digest(browser.frame) !== browser.result.frame.sha256 || browser.frame.length !== browser.result.frame.bytes) {
        throw statusError('Verified frame hash mismatch; parent unchanged', 422);
      }
    }
    return { native: native.result, browser: browser.result, frame: browser.frame ?? null };
  }

  async function fail(job, error) {
    job.status = 'failed';
    job.error = String(error.message ?? error).slice(0, 500);
    job.finishedAt = new Date().toISOString();
    job.events.push({ status: 'failed', at: job.finishedAt });
    await queue.save(job);
    await journal({ kind: 'failed', jobId: job.id, error: job.error });
  }

  async function run(job) {
    const before = await parentBytes(job.parentArtifactId);
    try {
      if (await broker.available() !== true) throw isolationError();
      job.status = 'generating';
      job.events.push({ status: 'generating', at: new Date().toISOString() });
      await queue.save(job);
      const request = {
        model: PUBLIC_MODEL,
        instructions: 'Submit one supported Roadster adapter or an explicit unsupported explanation. The host verifies supported source in an isolated worker and does not accept a claim of verification.',
        input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ prompt: job.prompt, parentArtifactId: job.parentArtifactId }) }] }],
        tools: [{ type: 'function', name: 'submit_roadster_adapter' }],
        store: false, max_output_tokens: 3000,
      };
      const inputTokens = await client.countInputTokens(request);
      const price = PRICES[PUBLIC_MODEL];
      const reserved = (inputTokens * price.input + 3000 * price.output) / 1e6;
      if (reserved > REMIX_MAX_COST_USD) throw statusError('Remix budget cannot cover this request; no generation started', 402);
      const response = await client.respond(request);
      const estimatedCostUsd = tokenCost(readUsage(response.usage), price);
      job.inference = {
        model: PUBLIC_MODEL, estimatedCostUsd, publicReserveUsd: PUBLIC_RESERVE_USD, publicReservedUsd: 0,
        reason: 'release not published; public reserve unused',
      };
      if (response.status !== 'completed' || estimatedCostUsd > REMIX_MAX_COST_USD) throw statusError('Roadster response incomplete or budget exceeded', 402);
      await journal({ kind: 'provider', jobId: job.id, model: PUBLIC_MODEL, estimatedCostUsd, publicReservedUsd: 0 });
      const submission = readSubmission(response);
      const storedIntent = await parentIntent(job.parentArtifactId);
      if (submission.status === 'unsupported') {
        job.status = 'unsupported';
        job.error = submission.summary.slice(0, 500);
        job.finishedAt = new Date().toISOString();
        job.events.push({ status: 'unsupported', at: job.finishedAt });
        await queue.save(job);
        await journal({ kind: 'unsupported', jobId: job.id });
        return;
      }
      if (storedIntent && intentText(storedIntent) === intentText(submission.intent)) {
        throw statusError('The proposed mapping does not change the parent', 422);
      }
      job.status = 'verifying';
      job.events.push({ status: 'verifying', at: new Date().toISOString() });
      await queue.save(job);
      const verified = await verifyIsolated({ source: submission.source, intent: submission.intent });
      const published = await publishArtifact({
        directory, parentId: job.parentArtifactId, files: {
          'adapter.ts': submission.source,
          'receipt.json': `${JSON.stringify({
            passed: true, model: PUBLIC_MODEL, parentArtifactId: job.parentArtifactId,
            componentId: verified.native.componentId, native: verified.native, browser: verified.browser,
          }, null, 2)}\n`,
          ...(verified.frame ? { 'play.html': verified.frame } : {}),
        },
      });
      job.status = 'ready';
      job.artifactId = published.id;
      job.urls = published.urls;
      job.finishedAt = new Date().toISOString();
      job.events.push({ status: 'ready', at: job.finishedAt });
      await queue.save(job);
      await journal({ kind: 'published', jobId: job.id, artifactId: published.id, urls: published.urls });
    } catch (error) {
      await fail(job, error);
    } finally {
      const after = await parentBytes(job.parentArtifactId);
      if (!before.equals(after)) await fail(job, Error('Parent artifact changed during verification'));
    }
  }

  return {
    model: PUBLIC_MODEL,
    publicReserveUsd: PUBLIC_RESERVE_USD,
    releasePublished: false,
    verifyIsolated,
    async brokerAvailable() { return broker.available(); },
    async putParent({ id, bytes, intent = null }) {
      if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Invalid parent artifact');
      await writeFile(join(parents, id), bytes, { flag: 'wx' });
      if (intent) await writeFile(join(parents, `${id}.intent.json`), JSON.stringify(intent), { flag: 'wx' });
    },
    parentBytes,
    async artifactFile(id, name) {
      if (!/^[a-f0-9]{64}$/.test(id) || !/^[a-z0-9.-]+$/i.test(name)) return null;
      try { return await readFile(join(directory, 'artifacts', id, name)); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async submit(request) {
      const existing = queue.findIdempotent(request.idempotencyKey);
      if (existing) {
        if (existing.prompt !== request.prompt || existing.parentArtifactId !== request.parentArtifactId || existing.sessionId !== request.sessionId) {
          throw statusError('Request ID already used for different input', 409);
        }
        return publicJob(existing);
      }
      if (queue.sessionCount(request.sessionId) >= queue.sessionJobLimit) throw statusError('Session remix quota is exhausted', 429);
      if (queue.activeCount() >= queue.globalActiveLimit || admitting) throw statusError('A remix is already running', 429);
      admitting = true;
      try {
        await parentBytes(request.parentArtifactId);
        if (await broker.available() !== true) throw isolationError();
        if (!client?.countInputTokens || !client.respond) throw statusError('Public generation is not configured', 503);
        const job = {
          schemaVersion: 1, id: randomUUID(), sessionId: request.sessionId, idempotencyKey: request.idempotencyKey,
          parentArtifactId: request.parentArtifactId, prompt: request.prompt, model: PUBLIC_MODEL, status: 'queued',
          error: null, artifactId: null, urls: null, inference: null,
          events: [{ status: 'queued', at: new Date().toISOString() }],
          createdAt: new Date().toISOString(), finishedAt: null,
        };
        await queue.save(job);
        const promise = run(job).finally(() => runners.delete(job.id));
        runners.set(job.id, promise);
        promise.catch(() => {});
        return publicJob(job);
      } finally { admitting = false; }
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
        releasePublished: false, recoveryEnabled: false,
      };
    },
    async close() {
      await Promise.all([...runners.values()].map(promise => promise.catch(() => {})));
      await queue.close();
    },
  };
}
