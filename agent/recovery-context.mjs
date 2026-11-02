import { discoveryReplay } from './tool-discovery.mjs';

const pick = (object, keys) => Object.fromEntries(keys.filter(key => object?.[key] !== undefined).map(key => [key, object[key]]));
function development(report) {
  if (!report) return report;
  return { ...pick(report, ['passed', 'error', 'suite', 'sourceSha256', 'javascriptSha256']),
    observedCases: report.results?.length ?? 0, failedCases: report.results?.filter(result => !result.passed).length ?? 0,
    firstFailures: report.results?.filter(result => !result.passed).slice(0, 2) ?? [],
    scope: 'First two actual development failures; the complete finite evaluation remains in the saved report.' };
}
function compactResult(call, retainCode) {
  const result = call.result;
  if (call.name === 'tool_search') return result;
  if (call.name === 'list_functions') return { ...pick(result, ['nextIndex', 'totalFunctions']),
    format: 'functions are [index, generated name, exports, body lines, direct callees, memory instructions]; enumeration only.',
    functions: result.functions.map(fn => [fn.index, fn.name, fn.exports, fn.lineCount, fn.directCalleeCount, fn.memoryInstructionCount]) };
  if (call.name === 'run_experiment_program') return pick(result,
    ['programId', 'status', 'sourceSha256', 'operations', 'output', 'error', 'experiments', 'activity', 'artifactRefs', 'executionFeedback', 'inputFeedback']);
  if (call.name === 'submit_component_candidate') return { ...result, development: development(result.development) };
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
  const observations = report.toolCalls.map(call => ({ tool: call.name, requestAttempt: call.requestAttempt, ok: call.ok,
    ...(call.ok ? { result: compactResult(call, !session.recovery?.attempts.length && codeWindows.has(call)) } : { error: call.error, inputFeedback: call.inputFeedback }),
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
