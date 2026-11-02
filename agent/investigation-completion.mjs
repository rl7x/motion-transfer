const EXECUTION_TOOLS = ['run_original', 'session_advance', 'compare_branches'];
const INSPECTION_TOOLS = ['inspect_function', 'decompile_function', 'trace_writers'];
const INSPECTION_EVIDENCE = ['wat', 'decompilation', 'writer-trace'];
const FOLLOWUP_TOOLS = ['record_finding', 'run_experiment', 'run_experiment_program', 'read_experiment', 'select_component_evidence', 'annotate_function'];

export function managedExperiments(toolCalls) {
  return toolCalls.filter(call => call.ok).flatMap(call => {
    const results = call.name === 'run_experiment' ? [call.result]
      : call.name === 'run_experiment_program' ? call.result.experiments ?? [] : [];
    return results.filter(result => result.status === 'completed'
      && result.initialEditDifference?.edits.length && result.frameCount > 0)
      .map(result => ({ call, result }));
  });
}

export function hasFollowup(toolCalls, { call, result }) {
  return toolCalls.some(next => {
    if (!(next.ok && next.requestAttempt > call.requestAttempt && FOLLOWUP_TOOLS.includes(next.name))) return false;
    const evidenceIds = [result.experimentId, result.artifactRef.id,
      ...(next.name === 'run_experiment' ? [result.checkpointId] : [])];
    return evidenceIds.some(id => JSON.stringify(next.args).includes(id));
  });
}

/**
 * Return a conclusion only after the existing finite evidence requirements pass.
 * Enumeration is not body inspection; only separate acceptance establishes a
 * new accepted component. This function does not modify evidence or repair code.
 */
export function requireInvestigationConclusion(report, publicMessages) {
  const conclusion = publicMessages.map(message => message.text).filter(Boolean).join('\n');
  const successful = report.toolCalls.filter(call => EXECUTION_TOOLS.includes(call.name) && call.ok);
  const citations = new Set(conclusion.match(/\b(?:exp-\d{3}|cmp-\d{3}|experiment-[a-f0-9-]{36}|[a-f0-9]{64})\b/g) ?? []);
  const cited = successful.filter(call => citations.has(call.experimentId) || citations.has(call.result?.comparisonId));
  const signatures = new Set(cited.filter(call => call.name !== 'compare_branches')
    .map(call => JSON.stringify(call.args.steps.map(step => [step.buttons, step.frames]))));
  const citedManaged = managedExperiments(report.toolCalls)
    .filter(({ result }) => citations.has(result.experimentId) || citations.has(result.artifactRef.id));
  const comparison = citedManaged.length > 0 || cited.some(call => call.name === 'compare_branches'
    && call.result.edits?.length && call.result.checkpoints?.length);
  const inspected = report.session?.staticEvidence?.some(item => INSPECTION_EVIDENCE.includes(item.kind))
    || report.toolCalls.some(call => INSPECTION_TOOLS.includes(call.name) && call.ok);
  const oriented = report.toolCalls.some(call => call.name === 'inspect_wasm' && call.ok)
    || report.session?.experimentWorkbench?.programs.some(program => program.operations
      .some(operation => operation.name === 'inspect_wasm' && operation.status === 'completed'));

  if (!conclusion || (!comparison && (signatures.size < 2 || cited.length < 2)) || !oriented) {
    throw new Error('Model ended without an inspection and two contrasting, cited experiments');
  }
  if (report.requirements?.branchComparison && !comparison) {
    throw new Error('This investigation requires a cited controlled branch perturbation comparison');
  }
  if (report.requirements?.codeInspection && !inspected) {
    throw new Error('This investigation requires actual code inspection');
  }
  if (report.requirements?.followupDecision && !citedManaged.some(experiment => hasFollowup(report.toolCalls, experiment))) {
    throw new Error('The managed experiment needs a subsequent model action linked to its actual result');
  }
  if (report.requirements?.componentAcceptance && !report.session?.recovery?.acceptedAttempt) {
    throw new Error('No new component passed separate acceptance; recovery remains incomplete');
  }
  return conclusion;
}
