import { experimentFeedback, experimentErrorHelp } from './experiment-feedback.mjs';
import { validateRecoveryEvidence } from './recovery-evidence.mjs';
import { inputDiagnostics, recoverySelectionHelp } from './input-diagnostics.mjs';
import { createToolDiscovery } from './tool-discovery.mjs';
import { recoveryStep } from './recovery-progress.mjs';
import { recoveryPolicy, reportRecoveryProtocol, RECOVERY_REQUIREMENTS } from './recovery-protocol.mjs';
import { requireInvestigationConclusion } from './investigation-completion.mjs';

/**
 * @typedef {object} ToolOutput
 * @property {object} result Bounded model-visible measurements or artifact references.
 * @property {object} [evidence] Full evidence retained in the local report.
 * @property {object[]} [images] Selected PNG data URLs and frame/session identities.
 */

function appendImages(history, images) {
  for (const image of images) history.push({ role: 'user', content: [
    { type: 'input_text', text: `Actual framebuffer evidence ${image.evidenceId}, session ${image.sessionId}, branch ${image.branchId}, frame ${image.frame}, PNG SHA256 ${image.pngSha256}.` },
    { type: 'input_image', image_url: image.dataUrl },
  ] });
}

function toolError(error, session) {
  return {
    error,
    ...(session ? { sessionContext: {
      sessionId: session.id,
      occupiedBranchIds: session.branches.map(branch => branch.id),
      checkpointIds: session.checkpoints.map(checkpoint => checkpoint.id),
    } } : {}),
  };
}

/**
 * Transport-independent journal executor. The host supplies the zero-based
 * provider turn; a tool argument must never be used as a trusted turn identity.
 * API and MCP transports share evidence, stage, budget and persistence gates.
 * @param {object} options
 * @param {(name: string, args: object, options: {signal: AbortSignal}) => Promise<ToolOutput>} options.dispatch
 * @param {object[]} options.history Private provider continuation.
 * @param {object} options.report Durable public report.
 */
export function createJournalToolExecutor({
  report, history = [], catalog, dispatch, worker, limits = report.limits, signal,
  checkTime = () => {}, onProgress = () => {}, onUpdate = async () => {},
}) {
  const protocol = reportRecoveryProtocol(report);
  if (protocol && Object.keys(RECOVERY_REQUIREMENTS).some(key => report.requirements?.[key] !== true)) {
    throw Error('Recovery journal must enforce every recorded evidence requirement');
  }
  const ownsCatalog = !catalog;
  catalog ??= createToolDiscovery({ mode: 'none', model: report.model,
    profile: report.requirements?.componentAcceptance ? 'recovery' : 'general', recoveryProtocol: protocol });
  const ids = new Set(report.toolCalls.map(call => call.callId));
  let experiments = report.toolCalls.filter(call => call.experimentId).length;

  return async function runToolCall(call, turn) {
    checkTime();
    if (!Number.isSafeInteger(turn) || turn < 0 || turn >= limits.maxModelCalls) throw Error('A trusted model turn within the request limit is required');
    if (report.toolCalls.some(entry => Number.isSafeInteger(entry.requestAttempt) && entry.requestAttempt > turn + 1)) throw Error('Trusted model turns cannot move backwards');
    reportRecoveryProtocol(report);
    if (ownsCatalog) catalog.definitions(report.requirements?.componentAcceptance ? {
      stage: recoveryStep(report).stage,
      reserveDevelopment: limits.maxModelCalls - turn <= recoveryPolicy(protocol).developmentRequestReserve,
      programsRemaining: (report.session?.experimentWorkbench?.programs?.length ?? 0) < 2,
    } : undefined);
    if (report.toolCalls.length >= limits.maxToolCalls) throw new Error('Tool call limit reached');
    if (typeof call.call_id !== 'string' || !call.call_id || ids.has(call.call_id)
      || (call.status && call.status !== 'completed')) {
      throw new Error('Meta returned a duplicate or incomplete tool call');
    }
    ids.add(call.call_id);
    const entry = {
      callId: call.call_id, name: call.type === 'tool_search_call' ? 'tool_search' : call.name,
      namespace: call.namespace ?? null, requestAttempt: turn + 1, ok: false,
    };
    report.toolCalls.push(entry);
    let selectedImages = [], output;
    try {
      if (call.type === 'tool_search_call') {
        const loaded = catalog.load(call);
        entry.args = loaded.args;
        entry.result = loaded.result;
        entry.ok = true;
        history.push(loaded.output);
        await onUpdate(report);
        return { entry, result: entry.result, images: [] };
      }
      entry.name = catalog.route(call);
      if (typeof call.arguments !== 'string' || Buffer.byteLength(call.arguments) > 32_768) {
        throw new Error('Tool arguments exceed 32 KB or are invalid');
      }
      entry.args = JSON.parse(call.arguments);
      if (report.requirements?.selectedRecoveryEvidence && call.name === 'submit_component_candidate') {
        entry.recoveryEvidence = validateRecoveryEvidence(report, entry.args, turn + 1);
      }
      entry.startedAt = new Date().toISOString();
      await onUpdate(report);
      onProgress(`Running ${call.name}`);
      const { result, evidence, images } = await dispatch(call.name, entry.args, { signal });
      if (worker) report.session = worker.sessionState;
      entry.ok = true;
      entry.result = experimentFeedback(call.name, result, report.session);
      if (evidence) entry.evidence = evidence;
      if (['run_original', 'session_advance', 'compare_branches'].includes(call.name)) {
        entry.experimentId = `exp-${String(++experiments).padStart(3, '0')}`;
        entry.result = { experimentId: entry.experimentId, ...result };
      }
      history.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(entry.result) });
      if (images?.length) {
        selectedImages = images;
        entry.images = images.map(({ dataUrl, ...metadata }) => metadata);
        appendImages(history, images);
      }
    } catch (error) {
      if (worker?.sessionState) report.session = worker.sessionState;
      entry.error = error.message;
      const feedback = error.inputFeedback ?? inputDiagnostics(entry.name, entry.args) ?? recoverySelectionHelp(entry.name, report.session, entry.error);
      if (feedback) entry.inputFeedback = feedback;
      if (call.type === 'tool_search_call') {
        history.push(catalog.failedSearch(call), { role: 'user', content: [
          { type: 'input_text', text: 'Local tool discovery failed: ' + entry.error },
        ] });
      } else {
        output = { ...toolError(entry.error, report.session), ...experimentErrorHelp(call.name), ...(feedback ? { inputFeedback: feedback } : {}) };
        history.push({ type: 'function_call_output', call_id: call.call_id,
          output: JSON.stringify(output) });
      }
    }
    entry.finishedAt = new Date().toISOString();
    await onUpdate(report);
    return { entry, result: entry.ok ? entry.result : output ?? { error: entry.error }, images: selectedImages };
  };
}

/** Gate a transcript-derived final answer before integration or success claims. */
export function concludeRecoveryJournal(report, publicMessages) {
  if (!reportRecoveryProtocol(report)) throw Error('A recorded recovery protocol is required');
  if (Object.keys(RECOVERY_REQUIREMENTS).some(key => report.requirements?.[key] !== true)) {
    throw Error('Recovery journal must enforce every recorded evidence requirement');
  }
  return requireInvestigationConclusion(report, publicMessages);
}
