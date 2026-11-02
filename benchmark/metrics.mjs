import { isDeepStrictEqual } from 'node:util';
import { requireInvestigationConclusion } from '../agent/investigation-completion.mjs';
import { stageDefinition } from './definition.mjs';

const finite = value => typeof value === 'number' && Number.isFinite(value);
export function evaluationMetrics(report, name) {
  const results = report?.results ?? [];
  return { name, passed: report?.passed === true, observedCases: results.length,
    failedCases: results.filter(result => !result.passed).length,
    updates: results.every(result => Number.isInteger(result.ticks)) ? results.reduce((sum, result) => sum + result.ticks, 0) : null,
    maxPositionError: results.some(result => finite(result.maxPositionError)) ? Math.max(...results.filter(result => finite(result.maxPositionError)).map(result => result.maxPositionError)) : null,
    firstFailures: results.filter(result => !result.passed).slice(0, 4).map(result => ({ name: result.name, firstDivergence: result.firstDivergence ?? null, error: result.error ?? null })),
    error: report?.error ?? null };
}

/** Measure the declared request, not just the model's own interpreted mapping. */
export function measureTaskAttempt(stage, job, artifact, definition, request) {
  const report = job.report ?? job.generation ?? {};
  const issues = [], evaluations = [];
  const check = (condition, message) => { if (!condition) issues.push(message); };
  const source = report.origin === 'local-verification' || job.origin === 'local-verification' || definition.origin === 'local-verification'
    ? 'local-verification' : 'fresh-meta';
  check(job.status === 'ready', job.error ?? 'Job did not reach ready');
  if (stage === 'recovery') {
    const recovery = report.session?.recovery;
    const accepted = recovery?.attempts?.find(item => item.attempt === recovery.acceptedAttempt);
    for (const attempt of recovery?.attempts ?? []) {
      evaluations.push(evaluationMetrics(attempt.development, 'development-attempt-' + attempt.attempt));
      if (attempt.acceptance) evaluations.push(evaluationMetrics(attempt.acceptance, 'acceptance-attempt-' + attempt.attempt));
    }
    check(accepted?.candidateId === recovery?.frozenCandidateId && accepted?.acceptance?.passed, 'No matching frozen accepted candidate');
    check(Boolean(job.task?.integration), 'No newly verified integration');
    if (source === 'fresh-meta') {
      check(report.model === 'muse-spark-1.3', 'Unexpected recovery model');
      check(report.requirements?.selectedRecoveryEvidence === true, 'Recovery did not enforce selected experiment/code linkage');
      try { requireInvestigationConclusion(report, [{ text: report.conclusion ?? '' }]); }
      catch (error) { issues.push(error.message); }
    }
    const verification = artifact?.verification;
    check(verification?.passed && verification?.componentId === job.task?.integration?.componentId, 'Missing matching standalone verification');
    check(verification?.candidateId === accepted?.candidateId, 'Standalone candidate identity mismatch');
    check(verification?.packageId === job.task?.integration?.packageId && verification?.zipSha256 === job.task?.integration?.zipSha256, 'Delivered package identity mismatch');
    check(verification?.nodeChecks?.passed && verification?.nodeChecks?.count === 3, 'Independent Node checks did not pass');
    check(verification?.browser?.passed && verification?.browser?.results?.length === 7, 'Independent browser checks did not pass');
    if (verification?.browser) evaluations.push(evaluationMetrics(verification.browser, 'standalone-browser'));
  } else {
    const expected = stageDefinition(stage)?.expectedIntent;
    check(isDeepStrictEqual(artifact?.intent, expected), 'Delivered intent does not match the predefined developer request');
    check(artifact?.parentArtifactId === request.parentArtifactId, 'Parent lineage does not match the requested parent');
    check(artifact?.componentId === definition.snapshot.componentId, 'The existing frozen component identity changed');
    let verification;
    if (stage === 'roadster' && artifact?.files?.['verification.json']) verification = JSON.parse(artifact.files['verification.json']);
    else verification = artifact?.evaluation;
    check(verification?.conformance?.passed && verification?.browser?.passed, 'Recipient conformance or browser checks failed');
    if (verification) for (const suite of ['conformance', 'browser']) evaluations.push(evaluationMetrics(verification[suite], suite));
  }
  const times = job.events?.map(event => Date.parse(event.at)).filter(Number.isFinite) ?? [];
  const requests = report.requests ?? [];
  return { passed: issues.length === 0, issues: [...new Set(issues)], origin: source,
    modelRequests: requests.length || (job.report || job.generation ? 0 : null), model: report.model ?? null,
    estimatedCostUsd: report.estimatedCostUsd ?? job.estimatedCostUsd ?? 0,
    reservedCostUsd: report.reservedCostUsd ?? job.reservedCostUsd ?? 0,
    elapsedMachineMs: times.length >= 2 ? Math.max(...times) - Math.min(...times) : null,
    tokens: requests.length ? requests.reduce((sum, request) => {
      for (const field of ['inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningTokens']) sum[field] += request.usage?.[field] ?? 0;
      return sum;
    }, { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 }) : null,
    evaluations, manualInterventionsDuringRun: 0,
    interventionScope: 'Closed task execution accepts no source edits. Between-trial implementation-agent fixes are recorded separately; prior setup effort remains unmeasured.' };
}

export function campaignMetrics(campaign) {
  const attempts = campaign.attempts ?? [];
  const knownSpend = attempts.reduce((sum, item) => sum + (item.measurements?.estimatedCostUsd ?? item.accounting?.estimatedCostUsd ?? 0), 0);
  const providerReserved = attempts.reduce((sum, item) => sum + (item.measurements?.reservedCostUsd ?? item.accounting?.reservedCostUsd ?? 0), 0);
  const committed = attempts.reduce((sum, item) => sum + (['completed', 'failed', 'blocked'].includes(item.status)
    && !(item.measurements?.reservedCostUsd ?? item.accounting?.reservedCostUsd) ? item.measurements?.estimatedCostUsd ?? item.accounting?.estimatedCostUsd ?? 0
      : Math.max(item.maxCostUsd, (item.accounting?.estimatedCostUsd ?? 0) + (item.accounting?.reservedCostUsd ?? 0))), 0);
  const stagePasses = stage => attempts.some(item => item.stage === stage && item.measurements?.passed);
  const tasks = campaign.definition.tasks.map(task => {
    const stages = task.stages?.map(stage => stage.id) ?? [task.id];
    const taskAttempts = attempts.filter(item => stages.includes(item.stage));
    const complete = stages.every(stagePasses);
    return { id: task.id, name: task.name, kind: task.kind, attempted: taskAttempts.length > 0, complete,
      partial: !complete && stages.some(stagePasses), attempts: taskAttempts.length };
  });
  return { estimatedCostUsd: knownSpend, providerReservedUsd: providerReserved, committedUsd: committed,
    remainingUsd: Math.max(0, campaign.definition.additionalLimitUsd - committed), tasks,
    completedTasks: tasks.filter(task => task.complete).length, attemptedTasks: tasks.filter(task => task.attempted).length,
    recoveryTrials: attempts.filter(item => item.stage === 'recovery').length,
    manualTimeSavedMinutes: null, baselineComparison: null, independentAdoption: null };
}
