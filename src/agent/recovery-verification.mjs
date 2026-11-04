import { randomUUID } from 'node:crypto';
import { recoveryStep } from './recovery-progress.mjs';
import { requireInvestigationConclusion } from './investigation-completion.mjs';

/** Mechanical gates run once through the same journal executor after synthesis. */
export async function finishRecoveryVerification({ report, catalog, runToolCall, turn, onUpdate }) {
  if(report.recoveryProtocol?.exhaustive){
    report.exhaustiveVerification={schemaVersion:1,attempts:(report.session?.recovery?.attempts??[])
      .filter(attempt=>attempt.exhaustive).map(attempt=>({attempt:attempt.attempt,candidateId:attempt.candidateId,...attempt.exhaustive}))};
    await onUpdate(report);
    if(report.session?.recovery?.abstractionConflict)throw Error(report.session.recovery.abstractionConflict.reason);
  }
  if (report.recoveryProtocol?.completion !== 'host-after-development-v1'
    || recoveryStep(report).stage !== 'freeze') return false;
  const candidateId = report.session.recovery.attempts.at(-1).candidateId;
  for (const [stage, name] of [['freeze', 'freeze_component'], ['accept', 'accept_component']]) {
    if (recoveryStep(report).stage !== stage) throw Error('Unexpected recovery verification stage');
    catalog.definitions({ stage });
    const { entry, result } = await runToolCall({ type: 'function_call', call_id: 'host-' + randomUUID(), name,
      arguments: JSON.stringify({ candidateId }) }, turn, { actor: 'host-verifier' });
    if (!entry.ok) throw Error(result.error ?? 'Host recovery verification failed');
    if (name === 'accept_component' && !result.passed) throw Error('Frozen candidate failed separate acceptance');
  }
  const recovery = report.session.recovery;
  const candidate = recovery.attempts.find(attempt => attempt.candidateId === candidateId);
  const selection = recovery.selections.find(item => item.id === candidate.selectionId);
  const citations = selection.evidence.traces.map(trace => trace.id).join(', ');
  const conclusion = `Host verification: candidate ${candidateId} passed ${candidate.development.results.length} development checks and ${candidate.acceptance.results.length} separately generated acceptance checks. Selected execution evidence: ${citations}. The model wrote the candidate; the host froze and evaluated it. This is finite motion verification; recipient integration has not run.`
    +(report.recoveryProtocol?.exhaustive?' Exhaustive verdict: proved; matches the compiled binary on every reachable dash state and button combination (275 states, 17,600 transitions). The four state fields were chosen by humans and checked empirically. Default configuration and body width 8 only; combat is out of scope; float behavior beyond tested positions is unverified. The model is never told where state lives. Development feedback includes expected positions and timers.':'');
  report.conclusion = requireInvestigationConclusion(report, [{ text: conclusion }]);
  report.completion = { actor: 'host-verifier', candidateId, modelConclusionRequested: false };
  report.status = 'completed';
  await onUpdate(report);
  return true;
}
