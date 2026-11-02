import { discoveryReplay } from './tool-discovery.mjs';

const pick = (object, keys) => Object.fromEntries(keys.filter(key => object?.[key] !== undefined).map(key => [key, object[key]]));
function development(report) {
  if (!report) return report;
  return { ...pick(report, ['passed', 'error', 'suite', 'sourceSha256', 'javascriptSha256']),
    observedCases: report.results?.length ?? 0, failedCases: report.results?.filter(result => !result.passed).length ?? 0,
    firstFailures: report.results?.filter(result => !result.passed).slice(0, 2) ?? [],
    scope: 'First two actual development failures; the complete finite evaluation remains in the saved report.' };
}
function compactResult(call) {
  const result = call.result;
  if (call.name === 'tool_search') return result;
  if (call.name === 'list_functions') return { ...pick(result, ['nextIndex', 'totalFunctions']), functions: result.functions.map(fn => pick(fn,
    ['index', 'name', 'exports', 'lineCount', 'directCalleeCount', 'directCallerCount', 'indirectCallCount', 'memoryInstructionCount'])) };
  if (call.name === 'run_experiment_program') return pick(result,
    ['programId', 'status', 'sourceSha256', 'operations', 'output', 'error', 'experiments', 'activity', 'artifactRefs', 'executionFeedback']);
  if (call.name === 'submit_component_candidate') return { ...result, development: development(result.development) };
  return result;
}

/** One copy of actual managed evidence; full programs and traces stay in artifacts. */
export function recoveryEvidenceHistory(report, capture, { includeDiscovery = true } = {}) {
  const session = report.session;
  const observations = report.toolCalls.map(call => ({ tool: call.name, requestAttempt: call.requestAttempt, ok: call.ok,
    ...(call.ok ? { result: compactResult(call) } : { error: call.error }),
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
