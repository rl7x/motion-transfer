import { randomUUID } from 'node:crypto';
import { recoveryStep } from './recovery-progress.mjs';
import { requireInvestigationConclusion } from './investigation-completion.mjs';

/** Mechanical gates run once through the same journal executor after synthesis. */
export async function finishRecoveryVerification({ report, catalog, runToolCall, turn, onUpdate }) {
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
  const conclusion = `Host verification: candidate ${candidateId} passed ${candidate.development.results.length} development checks and ${candidate.acceptance.results.length} separately generated acceptance checks. Selected execution evidence: ${citations}. The model wrote the candidate; the host froze and evaluated it. This is finite motion verification; recipient integration has not run.`;
  report.conclusion = requireInvestigationConclusion(report, [{ text: conclusion }]);
  report.completion = { actor: 'host-verifier', candidateId, modelConclusionRequested: false };
  report.status = 'completed';
  await onUpdate(report);
  return true;
}
