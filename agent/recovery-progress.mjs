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
    + ' Program source is an ALREADY-INVOKED async function BODY: put awaited SDK calls directly in it. Defining async function main() without calling it performs zero operations.'
    + ' Static methods are sdk.static.inspectWasm/listFunctions/inspectFunction/decompileFunction; sdk.inspectWasm does not exist.'
    + ' Function-body inspection and all four component-development tools are directly callable in the recovery profile; specialized tracing and memory tools can still use discovery.'
    + ' Paired branches receive identical inputs. With no edit they are a reproducibility control, not different input conditions. A final inactive state does not prove no dash occurred; inspect event and timer observations within the trace.'
    + ' Prefer one compact program for orientation, targeted code inspection and an experiment; return only measurements and IDs.'
    + ' All tools listed in this request are immediately callable; do not load namespaces speculatively. Search only for a missing specialized tool.'
    + ' In program output include only a chosen short code excerpt and the measurements you need, not whole result objects. Full experiment summaries arrive automatically even when the output limit rejects your return value.'
    + ' Use a subsequent model turn to interpret its actual result and select the evidence. Reserve remaining calls for candidate development, freezing, separate acceptance and conclusion.'
    + ' For recovery, choose select_component_evidence in a later model turn after the controlled trial, with a public scope explaining your next action. Cite both selected binary code and that actual experiment in your candidate contract.'
    + ' A development failure is feedback for a revision; an acceptance failure is terminal and cannot be repaired in this run.';
}
