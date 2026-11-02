import { recoveryProgress } from '../agent/recovery-progress.mjs';

export const RECOVERY_TASK = 'Bring the compiled donor’s dash into JUJUMP while preserving its timing, jumping, gravity and landing.';

/** Derive task outcomes from actual evidence; no hand-entered success numbers. */
export function recoveryTask(job) {
  const report = job.report ?? {}, progress = recoveryProgress(report);
  const attempts = report.session?.recovery?.attempts ?? [];
  const accepted = attempts.find(attempt => attempt.attempt === report.session?.recovery?.acceptedAttempt);
  const integrated = Boolean(job.integration), terminal = ['ready', 'failed'].includes(job.status);
  const development = attempts.map(attempt => {
    const results = attempt.development?.results ?? [];
    const failure = results.find(result => !result.passed && result.firstDivergence);
    return { attempt: attempt.attempt, passed: Boolean(attempt.development?.passed),
      checks: results.length, passedChecks: results.filter(result => result.passed).length,
      error: attempt.development?.error ?? null,
      firstFailure: failure ? { name: failure.name, ...failure.firstDivergence } : null };
  });
  return { schemaVersion: 1, request: RECOVERY_TASK,
    status: integrated ? 'ready' : terminal ? accepted ? 'integration-failed' : 'recovery-incomplete' : job.status,
    origin: report.origin === 'local-verification' ? 'local-verification' : 'meta',
    milestones: [...progress.milestones,
      { id: 'integration', label: 'Preserve JUJUMP behavior', complete: integrated },
      { id: 'standalone', label: 'Check the independently runnable ZIP', complete: integrated }],
    sessionId: report.session?.id ?? null, candidateId: progress.candidateId,
    integration: job.integration ?? null, development,
    measurements: { modelRequests: report.requests?.length ?? 0, usage: report.usage ?? null,
      estimatedCostUsd: report.estimatedCostUsd ?? 0, reservedCostUsd: report.reservedCostUsd ?? 0,
      recoveryElapsedMs: report.startedAt && report.finishedAt ? Date.parse(report.finishedAt) - Date.parse(report.startedAt) : null,
      taskElapsedMs: terminal && job.events?.[0]?.at ? Date.parse(job.events.at(-1).at) - Date.parse(job.events[0].at) : null,
      developmentAttempts: attempts.length, acceptanceTraces: accepted?.acceptance?.results.length ?? 0,
      acceptanceUpdates: accepted?.acceptance?.results.reduce((sum, result) => sum + result.ticks, 0) ?? 0,
      humanElapsedMinutes: null, manualTimeSavedMinutes: null, baselineComparison: null },
    humanAssistance: report.humanAssistance ?? [],
    humanInterventionsDuringRun: [],
    assistanceScope: 'The task runner accepts no human edits during a run. Registration, mapped fields, ABI, tools, evaluators, adapter and host hooks were supplied beforehand; their construction time is unmeasured.',
    error: job.error ?? null, conclusionVerified: false };
}
