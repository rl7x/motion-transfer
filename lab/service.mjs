import { randomUUID } from 'node:crypto';
import { investigate } from '../agent/investigate.mjs';
import { createLabStore,artifactId } from './store.mjs';
import { finishRecoveryIntegration } from '../integration/recovery.mjs';
import { createIntegrationPublication } from '../integration/publication.mjs';
import { recoveryTask } from './recovery-task.mjs';

export const LAB_BUDGET_USD=10;
export const INVESTIGATION_QUESTIONS=Object.freeze({
  held:'Does holding dash behave differently from pressing and releasing it? Choose controlled donor experiments, inspect the compiled instructions, and cite the actual observations. Do not assume a familiar dash implementation.',
  neutral:'After a LEFT directional dash and full recovery, what happens when dash is activated without any directional input: does it keep the previous left direction or choose another? Choose contrasting donor experiments with the same preparation and elapsed time, inspect compiled instructions, and use actual motion readings to discriminate explanations. Do not assume the answer. Distinguish observations from hypotheses, cite experiments and report uncertainty honestly.',
  memory:'Choose and test a motion hypothesis through run_experiment_program or prepare_checkpoint plus run_experiment. You choose the inputs and interventions; the host creates verified paired branches. Use actual returned checkpoint targets, keeping human-mapped hints distinct from discoveries. Inspect code through sdk.static or loaded static tools. Complete one controlled trial, then in a subsequent model turn choose a follow-up, evidence read or record_finding linked to the actual experiment ID. Select at most one informative image initially. Record supported/rejected/unresolved interpretations honestly and cite the experiment ID. Do not manually invent branch names or browse the whole binary.',
  extraction:'Developer request: bring the compiled donor’s dash into JUJUMP while retaining its timing and the platformer’s own physics. Recover a NEW standalone motion candidate. Prefer a compact experiment program to inspect the binary and chosen function bodies and run a checkpoint-bound controlled memory comparison. Choose hypotheses, code and inputs yourself. In a later model turn, use the actual result to choose evidence or a follow-up. Select inspected code and execution evidence, submit source, inspect real development first divergences and revise if needed. Use cooldown and remaining as the timer state field names for the current recipient instrumentation; infer their values and rules. Freeze a development-passed candidate and call separate acceptance, then conclude with actual experiment citations. The host checks the recipient only after recovery; you cannot claim recipient success. No pre-existing recovered implementation is available. Report incomplete work honestly; mapped fields, ABI, evaluators and recipient adapter are human assistance.',
});
/** @typedef {'investigation' | 'roadster'} LabJobKind */
/** @typedef {{idempotencyKey: string, questionId?: string, parentArtifactId?: string, prompt?: string}} LabRequest */

const terminal = job => ['ready', 'failed'].includes(job.status);

/** Validate the existing public JSON contract and retain its canonical key order. */
function validateRequest(kind, value) {
  const keys = kind === 'investigation'
    ? ['idempotencyKey', 'questionId']
    : ['idempotencyKey', 'parentArtifactId', 'prompt'];
  if (!value || Object.keys(value).sort().join(',') !== keys.sort().join(',')
    || typeof value.idempotencyKey !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(value.idempotencyKey)) {
    throw Error('Invalid lab request');
  }
  if (kind === 'investigation' && !Object.hasOwn(INVESTIGATION_QUESTIONS, value.questionId)) {
    throw Error('Choose a supported investigation question');
  }
  if (kind === 'roadster' && (!artifactId(value.parentArtifactId)
    || typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 600)) {
    throw Error('Invalid Roadster transfer request');
  }
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}

function validateSavedJob(job) {
  if (!['investigation', 'roadster'].includes(job.kind) || !Array.isArray(job.events)
    || !Number.isFinite(job.report?.estimatedCostUsd ?? 0) || !Number.isFinite(job.report?.reservedCostUsd ?? 0)
    || (job.report?.estimatedCostUsd ?? 0) < 0 || (job.report?.reservedCostUsd ?? 0) < 0) {
    throw Error('Invalid lab accounting journal');
  }
}

function calculateBudget(jobs, limitUsd) {
  let spentUsd = 0, reservedUsd = 0;
  for (const job of jobs.values()) {
    spentUsd += job.report?.estimatedCostUsd ?? 0;
    reservedUsd += job.report?.reservedCostUsd ?? 0;
  }
  return { limitUsd, spentUsd, reservedUsd, remainingUsd: Math.max(0, limitUsd - spentUsd - reservedUsd) };
}

function investigationOptions(job) {
  const extended = ['memory', 'extraction'].includes(job.request.questionId);
  const extraction = job.request.questionId === 'extraction';
  return {
    model: 'muse-spark-1.3',
    question: INVESTIGATION_QUESTIONS[job.request.questionId],
    limits: {
      maxCostUsd: job.maxCostUsd,
      ...(extended ? { maxModelCalls: extraction ? 16 : 12, maxToolCalls: 24, maxOutputTokens: extraction ? 4000 : 2000 } : {}),
    },
    requirements: extended ? { branchComparison: true, codeInspection: true, componentAcceptance: extraction, followupDecision: true,
      ...(extraction ? { selectedRecoveryEvidence: true } : {}) } : {},
    toolDiscovery: extended ? 'client' : 'none',
    reasoningEffort: extended ? 'low' : 'high',
  };
}

/**
 * Serialize paid jobs against one locked durable journal. A restart retains both
 * settled costs and unknown reservations; neither admission nor recovery retries
 * a model request. Clients and generators can be injected for local validation.
 */
export async function createLabService({
  directory, apiKey, client, investigateRun = investigate, generateTransfer, baseArtifact, budgetUsd = LAB_BUDGET_USD,
  integrateRecovery = finishRecoveryIntegration,
} = {}) {
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > LAB_BUDGET_USD) throw Error('Invalid lab budget');
  const store = await createLabStore(directory);
  const integrations = createIntegrationPublication(directory);
  const jobs = new Map();
  let active = null, admitting = false, closed = false;
  const scrub = value => JSON.parse(JSON.stringify(value).replaceAll(apiKey || '\0', '[redacted]'));
  const budget = () => calculateBudget(jobs, budgetUsd);

  async function transition(job, status) {
    job.status = status;
    job.events.push({ sequence: job.events.length + 1, status, at: new Date().toISOString() });
    await store.writeJob(job);
  }

  try {
    for (const job of await store.jobs()) {
      validateSavedJob(job);
      if (!terminal(job)) {
        job.error = 'Server restarted before completion; unsettled spending remains reserved.';
        await transition(job, 'failed');
      }
      jobs.set(job.id, job);
    }
  } catch (error) {
    await store.close();
    throw error;
  }

  const publicJob = job => scrub({
    id: job.id, kind: job.kind, request: job.request, status: job.status, events: job.events,
    report: job.report, artifactId: job.artifactId ?? null, error: job.error ?? null,
    ...(job.request.questionId === 'extraction' ? { task: recoveryTask(job) } : {}),
    ...(job.report?.origin === 'local-verification' ? { origin: 'local-verification' } : {}),
  });

  async function parent(id) {
    if (baseArtifact?.id === id) return baseArtifact;
    const artifact = await store.artifact(id);
    if (artifact.componentId !== baseArtifact?.componentId || artifact.recipientRevision !== baseArtifact?.recipientRevision) {
      throw Error('Roadster parent identity mismatch');
    }
    return artifact;
  }

  async function execute(job, selected) {
    const update = async report => {
      job.report = scrub(report);
      await store.writeJob(job);
      if (budget().spentUsd + budget().reservedUsd > budgetUsd + 1e-9) {
        throw Error('Development budget exceeded; no further generation permitted');
      }
    };
    try {
      await transition(job, 'generating');
      if (job.kind === 'investigation') {
        const report = await investigateRun({ apiKey, client, ...investigationOptions(job), onUpdate: update });
        if (report.status !== 'completed') throw Error('Investigation did not reach an evidence-backed conclusion');
        await update(report);
        if (job.request.questionId === 'extraction') {
          const result = await integrateRecovery({ directory, report, onStage: status => transition(job, status) });
          await transition(job, 'publishing');
          job.integration = await integrations.publish(result);
        }
      } else {
        const result = await generateTransfer({
          apiKey, client, parent: selected, prompt: job.request.prompt, maxCostUsd: job.maxCostUsd,
          onUpdate: update, onStage: status => transition(job, status),
        });
        await transition(job, 'publishing');
        const artifact = await store.publish(result.files, result.metadata);
        job.artifactId = artifact.id;
      }
      await transition(job, 'ready');
    } catch (error) {
      if (error.report) job.report = scrub(error.report);
      job.error = String(error.message).replaceAll(apiKey || '\0', '[redacted]').slice(0, 1200);
      await transition(job, 'failed');
    } finally {
      active = null;
    }
  }

  return {
    status() {
      return {
        enabled: Boolean(apiKey || client), activeRunId: active?.id ?? null, budget: budget(),
        unsettled: [...jobs.values()].some(job => (job.report?.reservedCostUsd ?? 0) > 0),
        questions: INVESTIGATION_QUESTIONS, baseArtifactId: baseArtifact?.id ?? null,
      };
    },
    async run(id) {
      const job = jobs.get(id);
      if (!job) throw Error('Run not found');
      return publicJob(job);
    },
    async artifact(id) { return parent(id); },
    async integration(id) { return integrations.read(id); },
    async previewIntegration(id) { return integrations.preview(id); },
    /** @param {LabJobKind} kind @param {LabRequest} value */
    async submit(kind, value) {
      if (closed) throw Error('Lab service is closed');
      if (!['investigation', 'roadster'].includes(kind)) throw Error('Invalid lab task');
      const request = validateRequest(kind, value);
      const existing = [...jobs.values()].find(job => job.request.idempotencyKey === request.idempotencyKey);
      if (existing) {
        if (existing.kind !== kind || JSON.stringify(existing.request) !== JSON.stringify(request)) {
          throw Error('Request ID already used for different input');
        }
        return publicJob(existing);
      }
      if (active || admitting) throw Error('A lab job is already running');
      if (!apiKey && !client) throw Error('Live investigation needs MODEL_API_KEY in the server .env');
      if (this.status().unsettled) throw Error('Previous lab billing is uncertain; no further paid requests will start');
      if (kind === 'roadster' && (!generateTransfer || !baseArtifact)) throw Error('Roadster live transfers are not available yet');
      const maxCostUsd = Math.min(kind === 'investigation' ? 0.50 : 0.05, budget().remainingUsd);
      if (maxCostUsd < 0.005) throw Error('Development budget is exhausted');

      // Hold admission across parent lookup and the first durable job write.
      admitting = true;
      try {
        const selected = kind === 'roadster' ? await parent(request.parentArtifactId) : null;
        const job = { schemaVersion: 1, id: randomUUID(), kind, request, maxCostUsd, status: 'queued', events: [], report: null };
        await transition(job, 'queued');
        jobs.set(job.id, job);
        active = { id: job.id, promise: null };
        active.promise = execute(job, selected);
        active.promise.catch(() => {});
        return publicJob(job);
      } finally {
        admitting = false;
      }
    },
    async close() {
      closed = true;
      if (active?.promise) await active.promise;
      await integrations.close();
      await store.close();
    },
  };
}
