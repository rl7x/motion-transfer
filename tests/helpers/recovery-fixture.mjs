import { readFile } from 'node:fs/promises';
import { createInvestigationSession } from '../../runtime/investigation-session.mjs';
import { loadTarget } from '../../agent/target.mjs';
import { createComponentWorkbench } from '../../agent/component-workbench.mjs';
import { saveInvestigationEvidence } from '../../lab/investigation-evidence.mjs';

// Explicit human-scripted fixture. Never supplied to a live model or advertised
// as a new recovery. Real development and separately generated acceptance run.
export async function acceptedRecoveryFixture(directory, { failedAttempt = false } = {}) {
  const target = await loadTarget(), session = await createInvestigationSession(target.bytes);
  session.recordStatic({ id: 'binary:func9', functionIndex: 9, kind: 'wat' });
  const observation = (await session.execute('session_advance', { branchId: 'main', hypothesis: 'Human-scripted local integration fixture.', watches: [],
    steps: [{ buttons: 1, frames: 1, checkpoint: 'entered' }] })).result.checkpoints[0];
  const workbench = createComponentWorkbench(session, { seed: () => 0x72ae13 });
  const selection = (await workbench.execute('select_component_evidence', { functionIndices: [9], evidenceIds: [observation.observationId],
    scope: 'Local pipeline fixture only; not independent recovery.' })).result;
  const source = '// Human-scripted local integration fixture; not a new Meta recovery.\n'
    + await readFile(new URL('../../components/dashy-dango-dash/component.ts', import.meta.url), 'utf8');
  const contract = JSON.parse(await readFile(new URL('../../components/dashy-dango-dash/contract.json', import.meta.url), 'utf8'));
  for (const key of ['interfaceVersion', 'tickRate', 'units', 'numericDomain']) delete contract[key];
  contract.rules = [{ description: 'Fixture behavior is supplied by a human for local pipeline verification.', evidence: [observation.observationId] }];
  if (failedAttempt) {
    const failed = (await workbench.execute('submit_component_candidate', {
      source: 'export function init(){return {cooldown:0,remaining:0};} export function step(state){return {state,output:{displacement:{x:0,y:0},ownsMotion:false,events:[]}};}',
      contract, selectionId: selection.selectionId, timerFields: { cooldown: 'cooldown', remaining: 'remaining' },
    })).result;
    if (failed.development.passed) throw Error('Negative integration fixture unexpectedly passed');
  }
  const submitted = (await workbench.execute('submit_component_candidate', { source, contract, selectionId: selection.selectionId,
    timerFields: { cooldown: 'cooldown', remaining: 'remaining' } })).result;
  if (!submitted.development.passed) throw Error('Local fixture development failed: ' + JSON.stringify(submitted.development));
  await workbench.execute('freeze_component', { candidateId: submitted.candidateId });
  const accepted = (await workbench.execute('accept_component', { candidateId: submitted.candidateId })).result;
  if (!accepted.passed) throw Error('Local fixture acceptance failed');
  const report = { schemaVersion: 1, status: 'completed', origin: 'local-verification', model: 'none',
    target: { id: target.id, sha256: target.sha256 }, session: session.snapshot(), toolCalls: [],
    requests: [], estimatedCostUsd: 0, reservedCostUsd: 0, humanAssistance: ['Human supplied this local fixture implementation.'],
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), conclusionVerified: false,
    conclusion: 'Human-scripted verification of the pipeline, not Meta recovery.' };
  await saveInvestigationEvidence(directory, report.session, report);
  return report;
}
