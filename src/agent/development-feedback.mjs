// Keep the full evaluator report in the journal. The model receives bounded,
// representative counterexamples, including the frame after a premature event.
export function developmentFeedback(report) {
  if (!report?.results) return report;
  const failures = report.results.filter(result => !result.passed);
  const groups = new Map();
  for (const failure of failures) {
    const divergence = failure.firstDivergence;
    const behavior = side => divergence?.[side] && {
      displacement: divergence[side].displacement,
      timers: divergence[side].timers,
      events: divergence[side].events,
      ownsMotion: divergence[side].ownsMotion,
    };
    const signature = JSON.stringify([divergence?.buttons, behavior('expected'), behavior('actual')]);
    if (!groups.has(signature)) groups.set(signature, { ...failure, relatedCases: [] });
    groups.get(signature).relatedCases.push(failure.name);
  }
  const { results, ...summary } = report;
  return { ...summary, observedCases: results.length, failedCases: failures.length,
    failedCaseNames: failures.map(result => result.name),
    firstFailures: [...groups.values()].slice(0, 6),
    omittedFailureGroups: Math.max(0, groups.size - 6),
    scope: 'Actual development measurements. Up to six distinct failure windows; all cases and full results remain in the journal. Acceptance inputs remain withheld.' };
}

export function developmentHistory(attempts) {
  return attempts.map(attempt => ({ attempt: attempt.attempt, candidateId: attempt.candidateId,
    sourceSha256: attempt.sourceSha256, passed: attempt.development?.passed,
    ...(attempt.development?.error ? { error: attempt.development.error } : {}),
    failures: (developmentFeedback(attempt.development)?.firstFailures ?? []).map(result => ({
      name: result.name, relatedCases: result.relatedCases,
      tick: result.firstDivergence?.tick, buttons: result.firstDivergence?.buttons,
      expected: result.firstDivergence?.expected, actual: result.firstDivergence?.actual,
    })),
  }));
}
