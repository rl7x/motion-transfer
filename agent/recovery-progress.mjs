import { managedExperiments, hasFollowup } from './investigation-completion.mjs';

/** Public milestones describe evidence presence, never the truth of a hypothesis. */
export function recoveryProgress(report) {
  const calls = report.toolCalls ?? [];
  const staticEvidence = report.session?.staticEvidence ?? [];
  const operations = report.session?.experimentWorkbench?.programs?.flatMap(program => program.operations) ?? [];
  const experiments = managedExperiments(calls);
  const recovery = report.session?.recovery;
  const latest = recovery?.attempts?.at(-1);
  const accepted = recovery?.attempts?.find(attempt => attempt.attempt === recovery.acceptedAttempt);
  const milestones = [
    ['orientation', 'Inspect the compiled donor', calls.some(call => call.name === 'inspect_wasm' && call.ok)
      || operations.some(operation => operation.name === 'inspect_wasm' && operation.status === 'completed')],
    ['code', 'Inspect chosen function bodies', staticEvidence.some(item => ['wat', 'decompilation', 'writer-trace'].includes(item.kind))
      || calls.some(call => ['inspect_function', 'decompile_function', 'trace_writers'].includes(call.name) && call.ok)],
    ['experiment', 'Run a controlled intervention', experiments.length > 0],
    ['decision', 'Choose a later action from the result', experiments.some(experiment => hasFollowup(calls, experiment))],
    ['development', 'Pass component development', Boolean(latest?.development?.passed)],
    ['freeze', 'Freeze the exact candidate', Boolean(recovery?.frozenCandidateId)],
    ['acceptance', 'Pass separate acceptance', Boolean(accepted?.acceptance?.passed && accepted.candidateId === recovery.frozenCandidateId)],
  ].map(([id, label, complete]) => ({ id, label, complete }));
  return { milestones, next: milestones.find(item => !item.complete)?.id ?? null,
    candidateId: latest?.candidateId ?? null, attemptCount: recovery?.attempts?.length ?? 0,
    acceptanceFailed: Boolean(recovery?.acceptanceStarted && !recovery.acceptedAttempt) };
}

export function recoveryGuidance(report) {
  const progress = recoveryProgress(report);
  const missing = progress.milestones.filter(item => !item.complete).map(item => item.label);
  return '\nRecovery task progress (evidence presence, not verified interpretation): ' + JSON.stringify(progress)
    + '\nUnfinished milestones: ' + (missing.join('; ') || 'none; conclude with the actual experiment citations') + '.'
    + '\nChoose scientific hypotheses, code and interventions yourself. Do not repeat satisfied milestones without a reason.'
    + ' Prefer one compact program for orientation, targeted code inspection and an experiment; return only measurements and IDs.'
    + ' Use a subsequent model turn to interpret its actual result and select the evidence. Reserve remaining calls for candidate development, freezing, separate acceptance and conclusion.'
    + ' A development failure is feedback for a revision; an acceptance failure is terminal and cannot be repaired in this run.';
}
