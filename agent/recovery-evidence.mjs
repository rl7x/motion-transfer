import { managedExperiments } from './investigation-completion.mjs';

/** List only IDs already selected from this run; never supply scientific claims. */
export function recoveryCitationRequirements(report, selectionId) {
  const selection = report.session?.recovery?.selections?.find(item => item.id === selectionId);
  if (!selection) return null;
  const selectedIds = new Set(selection.evidence.traces.map(item => item.id));
  const chosen = report.toolCalls.find(call => call.ok && call.name === 'select_component_evidence'
    && call.result?.selectionId === selectionId);
  const experiments = managedExperiments(report.toolCalls).filter(({ call, result }) => chosen
    && chosen.requestAttempt > call.requestAttempt
    && [result.experimentId, result.artifactRef.id].some(id => selectedIds.has(id)));
  return { selectionId, inspectedCodeIds: selection.evidence.functions.map(item => item.id),
    controlledExperimentIds: experiments.flatMap(({ result }) => [result.experimentId, result.artifactRef.id].filter(id => selectedIds.has(id))),
    allowedEvidenceIds: [...selection.evidence.functions.map(item => item.id), ...selectedIds],
    requirement: 'contract.rules[].evidence must cite at least one inspectedCodeId AND one controlledExperimentId. A reproducibility control alone does not satisfy the intervention requirement. Every citation must belong to allowedEvidenceIds. Choose the claims yourself.' };
}

/** Mechanical evidence linkage only; scientific interpretations remain reviewable. */
export function validateRecoveryEvidence(report, args, requestAttempt) {
  const selection = report.session?.recovery?.selections.find(item => item.id === args.selectionId);
  if (!selection) throw Error('Select inspected code and execution evidence before submitting source');
  const selectedIds = new Set(selection.evidence.traces.map(item => item.id));
  const experiments = managedExperiments(report.toolCalls).filter(({ call, result }) => call.requestAttempt < requestAttempt
    && [result.experimentId, result.artifactRef.id].some(id => selectedIds.has(id)));
  const chosen = report.toolCalls.find(call => call.ok && call.name === 'select_component_evidence'
    && call.result?.selectionId === args.selectionId);
  const eligible = experiments.filter(experiment => chosen && chosen.requestAttempt > experiment.call.requestAttempt);
  if (!eligible.length) throw Error('Choose component evidence in a later model turn using the actual controlled intervention result; a finding alone is insufficient for recovery');
  const inspected = new Set((report.session.staticEvidence ?? []).filter(item => ['wat', 'decompilation', 'writer-trace'].includes(item.kind))
    .map(item => item.functionIndex).filter(Number.isInteger));
  if (!selection.evidence.functions.length || selection.evidence.functions.some(item => !inspected.has(item.functionIndex))) {
    throw Error('Each selected component function needs actual body inspection or executed writer evidence');
  }
  const citations = new Set(args.contract?.rules?.flatMap(rule => rule.evidence) ?? []);
  const experiment = eligible.find(({ result }) => [result.experimentId, result.artifactRef.id]
    .some(id => selectedIds.has(id) && citations.has(id)));
  if (!selection.evidence.functions.some(item => citations.has(item.id))
    || !experiment) {
    const error = new Error('The candidate contract must cite both selected inspected code and an actual controlled experiment');
    error.inputFeedback = recoveryCitationRequirements(report, args.selectionId);
    throw error;
  }
  return { selectionId: selection.id, experimentId: experiment.result.experimentId,
    inspectionFunctions: selection.evidence.functions.map(item => item.functionIndex), selectionRequestAttempt: chosen.requestAttempt };
}
