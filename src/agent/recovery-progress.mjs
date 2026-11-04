import { managedExperiments, hasFollowup } from './investigation-completion.mjs';
import { recoveryCitationRequirements } from './recovery-evidence.mjs';
import { recoveryPolicy, reportRecoveryProtocol } from './recovery-protocol.mjs';

export const RECOVERY_INSTRUCTIONS = `Recover a new standalone motion component from the registered compiled donor.
You have the binary and restricted tools, not original source, a saved implementation, files, shell,
internet or credentials. Choose scientific hypotheses, function bodies, interventions and inputs yourself.
Mapped motion fields and checkpoint targets are HUMAN assistance, not your discovery of memory layout.
Inspect the binary overview and a chosen function body. Enumeration alone is not body inspection.
If an exported function only dispatches work, follow its callees or trace checkpoint-bound field writers.
Use a controlled typed intervention with identical input sequences on an unedited control and edited branch.
An unchanged pair is a reproducibility control. Use world-coordinate motion, timers and event traces;
an inactive endpoint does not establish no prior activity. Do not confuse camera movement with world motion.
Targets bind to their returned checkpoint and previous bytes; never guess addresses or reuse stale handles.
Choose component evidence in a later request from actual experimental results, then develop source.
Generated function names are not source names; indirect calls are unresolved. Static offsets are not addresses.
Inputs are WASM-4 masks: X=1 starts/dashes, left=16, right=32, up=64, down=128, 0 releases. Fixed 60 Hz.
Recover both axes of donor motion, including walking, for all directions. The recipient adapter is separate.
Named ES module exports init(config) and step(state,input,config) return JSON state and {state,output}.
The output contains only ownsMotion, displacement:{x,y}, events. Infer rules and defaults from evidence.
No imports, donor binary, runtime, DOM, randomness, or networking. The worker receives inputs only.
Three behavioral development attempts are available. Invalid modules fail before evaluation; all calls still cost budget.
Use every actual first divergence, its preceding samples and input sequence to repair the underlying rules.
Preserve already passing behavior. Compare timer order before/after an update and movement deltas across frames.
Freeze an exact development-passed candidate, then call separate acceptance. No repairs after freezing.
Acceptance covers finite donor cases; the host runs recipient/export checks after your conclusion.
Never claim acceptance or integration that did not run. End with actual experiment IDs and remaining uncertainties.
No automatic retries or budget extensions. All listed tools are directly callable; no namespace search is needed.`;

export function recoveryInstructions(protocol) {
  const policy = recoveryPolicy(protocol);
  const instructions = protocol ? RECOVERY_INSTRUCTIONS.replace('Three behavioral development attempts', `${policy.maxDevelopmentAttempts} behavioral development attempts`)
    : RECOVERY_INSTRUCTIONS;
  return instructions + (protocol?.development ? `
Development starts immediately after one title-screen start update, not at your later experiment checkpoint.
Read each failure's preceding AND following frames. A premature event and a missing event imply different bugs.
Compare prior development failures before revising; do not alternate between previously disproven rules.
Infer update order explicitly from consecutive timer samples and input levels before changing trigger conditions.
Test hypotheses about direction history with changed input sequences; plausible conventions need measurements.
Use record_finding to retain measured rules and remaining uncertainties with their actual evidence IDs.` : '');
}

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

/** Route work from recorded results, never from a model's claim of success. */
export function recoveryStep(report) {
  const recovery = report.session?.recovery;
  const latest = recovery?.attempts?.at(-1);
  const selection = recovery?.selections?.at(-1);
  const policy = recoveryPolicy(reportRecoveryProtocol(report));
  if (recovery?.acceptanceStarted) return { stage: 'conclude', minimumRequests: 1,
    action: recovery.acceptedAttempt ? 'Conclude with actual experiment IDs and the accepted candidate identity. Recipient checks have not run yet.'
      : 'Acceptance failed. Conclude honestly; this frozen candidate cannot be repaired or replaced in this run.' };
  if (recovery?.frozenCandidateId) return { stage: 'accept', minimumRequests: 2,
    action: `Call accept_component with candidateId ${recovery.frozenCandidateId}.` };
  if (latest?.development?.passed) return { stage: 'freeze', minimumRequests: 3,
    action: `Development passed. Call freeze_component with candidateId ${latest.candidateId}.` };
  if ((recovery?.attempts?.length ?? 0) >= policy.maxDevelopmentAttempts) return { stage: 'conclude', minimumRequests: 1,
    action: `All ${policy.maxDevelopmentAttempts} development attempts failed. Conclude with the remaining failures; no accepted component exists.` };
  if (selection) return { stage: 'develop', minimumRequests: 4,
    action: latest ? `Revise the candidate from its actual first divergences and submit_component_candidate using ${selection.id}. Preserve supported rules; do not restart discovery.`
      : `Write standalone source now and call submit_component_candidate using ${selection.id}. Test your best evidence-backed implementation; development will expose mistakes. Do not spend the remaining budget re-enumerating tools or the binary.` };
  if (recoveryProgress(report).milestones.slice(0, 3).every(item => item.complete)) return { stage: 'select', minimumRequests: 5,
    action: 'Code inspection and a controlled intervention are recorded. Interpret the actual result and call select_component_evidence now. Read more code or trace frames only to resolve a specific uncertainty; reserve calls for testing source.' };
  return { stage: 'investigate', minimumRequests: 5,
    action: 'Gather targeted code and a controlled intervention, then select_component_evidence in a later request using its actual result. Selection is the handoff to writing source, not the final result.' };
}

export function recoveryGuidance(report, { remainingRequests } = {}) {
  const progress = recoveryProgress(report);
  const step = recoveryStep(report);
  const citations = recoveryCitationRequirements(report, report.session?.recovery?.selections?.at(-1)?.id);
  const missing = progress.milestones.filter(item => !item.complete).map(item => item.label);
  const policy = recoveryPolicy(reportRecoveryProtocol(report));
  const remainingAttempts = Math.max(0, policy.maxDevelopmentAttempts - (report.session?.recovery?.attempts?.length ?? 0));
  return '\nRecovery task progress (evidence presence, not verified interpretation): ' + JSON.stringify(progress)
    + '\nUnfinished milestones: ' + (missing.join('; ') || 'none; conclude with the actual experiment citations') + '.'
    + `\nCurrent stage: ${step.stage}. Next action: ${step.action}`
    + (citations ? '\nSelected evidence citation requirements: ' + JSON.stringify(citations) : '')
    + (report.session?.experimentWorkbench?.usage ? '\nExperiment usage (shared across all programs and direct calls): '
      + JSON.stringify(report.session.experimentWorkbench.usage) + '. At most four experiments total; reserve at least one for a development failure.' : '')
    + (remainingRequests === undefined ? '' : `\n${remainingRequests} generation requests remain, including this one. At least ${step.minimumRequests} are needed from this stage, excluding further investigation and repairs. Allow ${Math.max(0, remainingAttempts - 1)} additional requests for development revisions when possible.`)
    + (step.stage === 'select' && remainingRequests <= policy.developmentRequestReserve ? `\nThe remaining requests are reserved for evidence selection, ${policy.maxDevelopmentAttempts} development evaluations, freezing, acceptance and conclusion. Select your actual evidence now; no further browsing tools are offered at this stage.` : '')
    + '\nChoose scientific hypotheses, code and interventions yourself. Do not repeat satisfied milestones without a reason.'
    + ' Recover the full declared donor motion boundary in both axes, including ordinary movement, for every button direction. The recipient adapter projects that motion into the platformer later; do not remove donor behavior to fit the recipient.'
    + ' Candidate source needs named ES module exports init and step, with step returning {state,output}. Evidence citations must include a selected binary:func ID AND a selected controlled experiment ID.'
    + ' Program source is an ALREADY-INVOKED async function BODY: put awaited SDK calls directly in it. Defining async function main() without calling it performs zero operations.'
    + ' Static methods are sdk.static.inspectWasm/listFunctions/inspectFunction/decompileFunction; sdk.inspectWasm does not exist.'
    + ' The current stage exposes directly callable tools. There is no tool-search step in this recovery workflow. Additional static inspection and controlled experiments remain available during development if a concrete failure needs them.'
    + ' Paired branches receive identical inputs. With no edit they are a reproducibility control, not different input conditions. A final inactive state does not prove no dash occurred; inspect event and timer observations within the trace.'
    + ' Prefer one compact program for orientation, targeted code inspection and an experiment; return only measurements and IDs.'
    + ' All tools listed in this request are immediately callable; use their exact schemas.'
    + ' In program output include only a chosen short code excerpt and the measurements you need, not whole result objects. Full experiment summaries arrive automatically even when the output limit rejects your return value.'
    + ' SDK steps are [{buttons,frames,checkpoint}] with a unique checkpoint label for every step. observations always contains channels, watches and captures; use [] for unrequested watches/captures.'
    + ' select_component_evidence uses functionIndices for inspected code; evidenceIds are actual execution IDs, not binary:func IDs. Cite the returned binary IDs later in the candidate contract.'
    + ' Use a subsequent model turn to interpret its actual result and select the evidence. Reserve remaining calls for candidate development, freezing, separate acceptance and conclusion.'
    + ' For recovery, choose select_component_evidence in a later model turn after the controlled trial, with a public scope explaining your next action. Cite both selected binary code and that actual experiment in your candidate contract.'
    + ' A development failure is feedback for a revision; an acceptance failure is terminal and cannot be repaired in this run.';
}
