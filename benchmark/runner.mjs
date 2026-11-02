import { randomUUID } from 'node:crypto';
import { digest } from '../component/build.mjs';
import { MAX_RECOVERY_TRIALS, stageDefinition } from './definition.mjs';
import { campaignMetrics, measureTaskAttempt } from './metrics.mjs';

const terminal = status => ['ready', 'failed'].includes(status);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const taskFor = stage => stage.startsWith('paku-') ? 'paku-lineage' : stage;

/** Own campaign orchestration only. Existing services own inference and billing. */
export async function runDeveloperBenchmark({ store, campaignId, transport, protocol, recoveryFix,
  onProgress = () => {}, wait = () => delay(500), signal } = {}) {
  const unlock = await store.lock(campaignId);
  let campaign;
  const save = async () => { campaign = await store.write(campaign); };
  const stopCheck = () => { if (signal?.aborted) throw Error('Benchmark runner cancelled; resume reads existing jobs without automatic resubmission'); };
  async function execute(stage, request) {
    let attempt = campaign.attempts.find(item => item.stage === stage && !['completed', 'failed', 'blocked'].includes(item.status));
    if (!attempt) {
      const maxCostUsd = stage === 'recovery' ? 0.5 : stage === 'roadster' ? 0.05 : 0.03;
      if (campaignMetrics(campaign).remainingUsd + 1e-9 < maxCostUsd) throw Error('Campaign ceiling cannot reserve another task');
      const status = await transport.status(stage);
      if (status.activeRunId) throw Error('An existing service job is active; no benchmark inference started');
      if (status.unsettled) throw Error('Existing service billing is uncertain; benchmark inference blocked');
      if (status.budget.remainingUsd + 1e-9 < maxCostUsd) throw Error('Existing persistent budget cannot cover the task; no limits were increased');
      request = { ...request, idempotencyKey: randomUUID() };
      attempt = { id: randomUUID(), stage, taskId: taskFor(stage), ordinal: campaign.attempts.filter(item => item.stage === stage).length + 1,
        maxCostUsd, request, requestSha256: digest(JSON.stringify(request)), protocol, status: 'prepared', startedAt: new Date().toISOString() };
      campaign.attempts.push(attempt); await save();
      stopCheck();
      // Persist the uncertainty boundary before POST. A restart resolves the
      // idempotency key from the existing journal and never sends another POST.
      attempt.status = 'submitting'; await save();
      try { const job = await transport.submit(stage, request); attempt.jobId = job.id; attempt.status = 'running'; await save(); }
      catch (error) { attempt.status = 'submission-uncertain'; attempt.error = error.message; await save(); throw error; }
    } else if (!attempt.jobId) {
      const job = await transport.findSubmitted(stage, attempt.request);
      if (!job) throw Error('Submission has no recoverable job identity; reservation retained and no automatic resubmission');
      attempt.jobId = job.id; attempt.status = 'running'; await save();
    }
    onProgress(`${stage}: observing job ${attempt.jobId}`);
    for (;;) {
      stopCheck();
      const job = await transport.run(stage, attempt.jobId);
      attempt.accounting = { estimatedCostUsd: job.report?.estimatedCostUsd ?? job.estimatedCostUsd ?? 0,
        reservedCostUsd: job.report?.reservedCostUsd ?? job.reservedCostUsd ?? 0 };
      attempt.jobStatus = job.status; await save();
      if (!terminal(job.status) || (await transport.status(stage)).activeRunId === attempt.jobId) { await wait(); continue; }
      const evidenceJob = await transport.evidenceJob(stage, job);
      const artifact = job.status === 'ready' ? await transport.artifact(stage, job) : null;
      attempt.jobRef = await store.saveEvidence(campaign.id, evidenceJob);
      if (artifact) attempt.artifactRef = await store.saveEvidence(campaign.id, artifact);
      attempt.artifactId = stage === 'recovery' ? job.task?.integration?.id ?? null : artifact?.id ?? null;
      attempt.measurements = measureTaskAttempt(stage, evidenceJob, artifact, campaign.definition, attempt.request);
      attempt.status = attempt.measurements.passed ? 'completed' : 'failed';
      attempt.finishedAt = new Date().toISOString();
      attempt.acceptanceStarted = evidenceJob.report?.session?.recovery?.acceptanceStarted === true;
      await save();
      onProgress(`${stage}: ${attempt.status}; $${attempt.measurements.estimatedCostUsd.toFixed(5)} estimated`);
      if (attempt.measurements.reservedCostUsd > 0 || (await transport.status(stage)).unsettled) {
        throw Error('Billing is uncertain; stopped all further benchmark inference');
      }
      return attempt;
    }
  }
  try {
    campaign = await store.read(campaignId);
    if (campaign.definition.origin !== transport.origin) throw Error('Benchmark origin does not match the transport');
    campaign.status = 'running'; delete campaign.error; await save();
    for (const attempt of campaign.attempts.filter(item => (item.measurements?.reservedCostUsd ?? item.accounting?.reservedCostUsd ?? 0) > 0)) {
      attempt.status = 'running'; await save();
      await execute(attempt.stage, attempt.request); // Read-only reconciliation; never another submission.
    }
    const prior = campaign.attempts.filter(item => item.stage === 'recovery').at(-1);
    const successful = campaign.attempts.some(item => item.stage === 'recovery' && item.status === 'completed');
    const pending = prior && !['completed', 'failed', 'blocked'].includes(prior.status);
    let allowRecovery = !prior || pending;
    if (recoveryFix) {
      if (!prior || prior.status !== 'failed' || prior.acceptanceStarted || successful) throw Error('A recovery fix is allowed only after a pre-acceptance failure');
      if (campaign.attempts.filter(item => item.stage === 'recovery').length >= MAX_RECOVERY_TRIALS) throw Error('Recovery trial allowance exhausted');
      if (prior.protocol.sha256 === protocol.sha256 || !recoveryFix.note?.trim() || !recoveryFix.validation?.sha256) {
        throw Error('Another recovery trial needs a changed protocol, documented fix and local validation evidence');
      }
      campaign.interventions.push({ actor: 'implementation-agent', at: new Date().toISOString(), stage: 'between-recovery-trials',
        previousAttemptId: prior.id, note: recoveryFix.note, validation: recoveryFix.validation,
        previousProtocol: prior.protocol.sha256, nextProtocol: protocol.sha256, commit: protocol.commit,
        handsOnHumanMinutes: null });
      allowRecovery = true; await save();
    }
    if (!successful && allowRecovery) await execute('recovery', { questionId: 'extraction' });
    if (!campaign.attempts.some(item => item.stage === 'roadster' && ['completed', 'failed'].includes(item.status))) {
      await execute('roadster', { parentArtifactId: campaign.definition.snapshot.roadsterParentId, prompt: stageDefinition('roadster').request });
    }
    let first = campaign.attempts.find(item => item.stage === 'paku-first' && item.status === 'completed');
    if (!first && !campaign.attempts.some(item => item.stage === 'paku-first' && item.status === 'failed')) {
      first = await execute('paku-first', { parentArtifactId: campaign.definition.snapshot.pakuParentId, prompt: stageDefinition('paku-first').request });
    }
    if (first?.status === 'completed' && !campaign.attempts.some(item => item.stage === 'paku-final' && ['completed', 'failed'].includes(item.status))) {
      await execute('paku-final', { parentArtifactId: first.artifactId, prompt: stageDefinition('paku-final').request });
    }
    campaign.status = campaignMetrics(campaign).completedTasks === 3 ? 'completed' : 'incomplete';
    campaign.finishedAt = new Date().toISOString(); await save();
    return campaign;
  } catch (error) {
    if (campaign) { campaign.status = 'stopped'; campaign.error = error.message; await save(); }
    throw error;
  } finally { await unlock(); }
}
