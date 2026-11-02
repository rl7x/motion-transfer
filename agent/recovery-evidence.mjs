import { managedExperiments } from './investigation-completion.mjs';

/** Mechanical evidence linkage only; scientific interpretations remain reviewable. */
export function validateRecoveryEvidence(report, args, requestAttempt) {
  const selection = report.session?.recovery?.selections.find(item => item.id === args.selectionId);
  if (!selection) throw Error('Select inspected code and execution evidence before submitting source');
  const selectedIds = new Set(selection.evidence.traces.map(item => item.id));
  const experiment = managedExperiments(report.toolCalls).find(({ call, result }) => call.requestAttempt < requestAttempt
    && [result.experimentId, result.artifactRef.id].some(id => selectedIds.has(id)));
  const chosen = report.toolCalls.find(call => call.ok && call.name === 'select_component_evidence'
    && call.result?.selectionId === args.selectionId && experiment && call.requestAttempt > experiment.call.requestAttempt);
  if (!experiment || !chosen) throw Error('Choose component evidence in a later model turn using the actual controlled intervention result; a finding alone is insufficient for recovery');
  const inspected = new Set((report.session.staticEvidence ?? []).filter(item => ['wat', 'decompilation', 'writer-trace'].includes(item.kind))
    .map(item => item.functionIndex).filter(Number.isInteger));
  if (!selection.evidence.functions.length || selection.evidence.functions.some(item => !inspected.has(item.functionIndex))) {
    throw Error('Each selected component function needs actual body inspection or executed writer evidence');
  }
  const citations = new Set(args.contract?.rules?.flatMap(rule => rule.evidence) ?? []);
  if (!selection.evidence.functions.some(item => citations.has(item.id))
    || ![experiment.result.experimentId, experiment.result.artifactRef.id].some(id => citations.has(id))) {
    throw Error('The candidate contract must cite both selected inspected code and an actual controlled experiment');
  }
  return { selectionId: selection.id, experimentId: experiment.result.experimentId,
    inspectionFunctions: selection.evidence.functions.map(item => item.functionIndex), selectionRequestAttempt: chosen.requestAttempt };
}
