import { discoveryReplay } from './tool-discovery.mjs';

const pick = (object, keys) => Object.fromEntries(keys.filter(key => object?.[key] !== undefined).map(key => [key, object[key]]));
function development(report, retainFailures) {
  if (!report) return report;
  return { ...pick(report, ['passed', 'error', 'suite', 'sourceSha256', 'javascriptSha256']),
    observedCases: report.results?.length ?? 0, failedCases: report.results?.filter(result => !result.passed).length ?? 0,
    ...(retainFailures ? { firstFailures: report.results?.filter(result => !result.passed) ?? [] } : {}),
    scope: retainFailures ? 'Actual first divergence for each failed development case; acceptance inputs remain withheld.'
      : 'Earlier attempt summarized; full development results remain in the saved report.' };
}
function compactMeasurement(value) {
  return { ...pick(value, ['frame', 'normalized', 'memory']),
    ...(value?.motion !== undefined ? { motion: value.motion === null ? null
      : Object.fromEntries(Object.entries(value.motion).filter(([key]) => key !== 'fieldHints')) } : {}) };
}
function compactFrame(value) {
  return value ? { ...pick(value, ['elapsedFrame', 'frame', 'buttons', 'inputCheckpoint']),
    control: compactMeasurement(value.control), intervention: compactMeasurement(value.intervention) } : value;
}
function compactResult(call, retainCode, latestCandidate) {
  const result = call.result;
  if (call.name === 'tool_search') return result;
  if (call.name === 'list_functions') return { ...pick(result, ['nextIndex', 'totalFunctions']),
    format: 'functions are [index, generated name, exports, body lines, direct callees, memory instructions]; enumeration only.',
    functions: result.functions.map(fn => [fn.index, fn.name, fn.exports, fn.lineCount, fn.directCalleeCount, fn.memoryInstructionCount]) };
  if (call.name === 'run_experiment_program') return pick(result,
    ['programId', 'status', 'sourceSha256', 'operations', 'output', 'error', 'experiments', 'activity', 'artifactRefs', 'executionFeedback', 'inputFeedback']);
  if (call.name === 'submit_component_candidate') return { ...result, development: development(result.development, latestCandidate) };
  if (call.name === 'read_experiment') return {
    ...pick(result, ['experimentId', 'artifactRef', 'totalFrames']),
    initialEditDifference: { ...pick(result.initialEditDifference, ['frame', 'edits']),
      control: compactMeasurement(result.initialEditDifference.control), intervention: compactMeasurement(result.initialEditDifference.intervention) },
    frames: result.frames.map(compactFrame), final: compactFrame(result.final),
    notice: 'Actual requested frame measurements; repeated render/storage fingerprints omitted. Full evidence remains in the hash-bound artifact.',
  };
  if (['inspect_function', 'decompile_function'].includes(call.name)) return {
    ...pick(result, ['sha256', 'evidenceId', 'index', 'name', 'signature', 'startLine', 'lineCount', 'nextLine', 'indirectCallsResolved']),
    directCallees: result.directCallees?.map(callee => pick(callee, ['index', 'sites'])),
    ...(retainCode ? { lines: result.lines?.map(line => [line.functionLine ?? line.number, line.text, ...(line.truncated ? ['truncated'] : [])]) } : {}),
    format: retainCode ? 'lines are [relative line, actual instruction text, optional truncation marker]; repeated reference metadata omitted.'
      : 'Older code window omitted. Full instructions remain in the report; re-inspect this function if needed.',
  };
  if (call.name === 'prepare_checkpoint') return {
    ...pick(result, ['checkpointId', 'sessionId', 'verification', 'notice']),
    observation: pick(result.observation, ['id', 'frame', 'motion']),
    targets: result.targets.map(target => pick(target, ['id', 'name', 'type', 'address', 'previousValue', 'origin'])),
    scope: 'Handles retain their actual checkpoint binding; repeated binding hashes and bytes omitted from this context only.',
  };
  if (call.name === 'select_component_evidence') return {
    ...pick(result, ['selectionId', 'interface', 'development']), evidence: {
      ...pick(result.evidence, ['sha256', 'cartridgeSha256', 'scope', 'functions', 'humanAssistance']),
      traces: result.evidence.traces.map(trace => ({ id: trace.id, artifactId: trace.observation?.artifactId })),
      notice: 'Selected evidence IDs refer to actual observations above; full evidence retained in the saved report.',
    },
  };
  return result;
}

/** One copy of actual managed evidence; full programs and traces stay in artifacts. */
export function recoveryEvidenceHistory(report, capture, { includeDiscovery = true } = {}) {
  const session = report.session;
  const codeWindows = new Set(report.toolCalls.filter(call => call.ok && ['inspect_function', 'decompile_function'].includes(call.name)).slice(-2));
  const latestCandidate = report.toolCalls.findLast(call => call.ok && call.name === 'submit_component_candidate');
  const observations = report.toolCalls.map(call => ({ tool: call.name, requestAttempt: call.requestAttempt, ok: call.ok,
    ...(call.ok ? { result: compactResult(call, codeWindows.has(call), call === latestCandidate) } : { error: call.error, inputFeedback: call.inputFeedback }),
    ...(call.images?.length ? { images: call.images } : {}) }));
  const ledger = { observations, currentSession: {
    id: session.id, identity: session.identity,
    branches: session.branches.map(branch => pick(branch, ['id', 'experimental', 'parentCheckpointId'])),
    checkpoints: session.checkpoints.map(checkpoint => pick(checkpoint, ['id', 'label', 'verification'])),
    staticEvidence: session.staticEvidence.map(item => pick(item, ['id', 'kind', 'functionIndex', 'artifactId', 'sha256'])),
    annotations: session.annotations, findings: session.findings,
    latestDevelopmentCandidate: pick(session.recovery?.attempts.at(-1),
      ['attempt', 'candidateId', 'candidate', 'timerFields', 'selectionId', 'sourceSha256', 'frozenAt']),
    frozenCandidateId: session.recovery?.frozenCandidateId,
    experimentPrograms: session.experimentWorkbench.programs.map(program => ({
      ...pick(program, ['id', 'sourceSha256', 'status', 'error', 'artifactId']),
      operations: program.operations.map(operation => ({ ...pick(operation, ['name', 'status', 'error']),
        ...pick(operation.result, ['artifactRef', 'experimentId']) })),
    })), programStackRestored: false,
  } };
  return [
    { role: 'user', content: [{ type: 'input_text', text: report.question }] },
    { role: 'user', content: [{ type: 'input_text', text:
      'The following ledger contains actual completed tool observations from this investigation. Prior model reasoning has been discarded. Each experiment appears once; program source and full traces remain in immutable artifacts. Code catalog entries are enumeration, not function bodies. Inspect a body again if its instructions are needed. No expected behavioral answers are supplied. Continue from actual evidence and cite its IDs.\n' + JSON.stringify(ledger) }] },
    ...(capture ? [{ role: 'user', content: [{ type: 'input_text', text: `Selected actual framebuffer ${capture.evidenceId}, session ${capture.sessionId}, branch ${capture.branchId}, frame ${capture.frame}, PNG SHA256 ${capture.pngSha256}.` }, { type: 'input_image', image_url: capture.dataUrl }] }] : []),
    ...(includeDiscovery ? discoveryReplay(report) : []),
  ];
}
