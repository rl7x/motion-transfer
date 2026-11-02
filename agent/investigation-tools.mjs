import { experimentFeedback, experimentErrorHelp } from './experiment-feedback.mjs';
import { validateRecoveryEvidence } from './recovery-evidence.mjs';
import { inputDiagnostics, recoverySelectionHelp } from './input-diagnostics.mjs';

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
 * One runner per investigation, sharing call identities and experiment numbering.
 * @param {object} options
 * @param {(name: string, args: object, options: {signal: AbortSignal}) => Promise<ToolOutput>} options.dispatch
 * @param {object[]} options.history Private provider continuation.
 * @param {object} options.report Durable public report.
 */
export function createInvestigationToolRunner({
  report, history, catalog, dispatch, worker, limits, signal, checkTime, onProgress, onUpdate,
}) {
  const ids = new Set(report.toolCalls.map(call => call.callId));
  let experiments = report.toolCalls.filter(call => call.experimentId).length;

  return async function runToolCall(call, turn) {
    checkTime();
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
    try {
      if (call.type === 'tool_search_call') {
        const loaded = catalog.load(call);
        entry.args = loaded.args;
        entry.result = loaded.result;
        entry.ok = true;
        history.push(loaded.output);
        await onUpdate(report);
        return;
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
        history.push({ type: 'function_call_output', call_id: call.call_id,
          output: JSON.stringify({ ...toolError(entry.error, report.session), ...experimentErrorHelp(call.name), ...(feedback ? { inputFeedback: feedback } : {}) }) });
      }
    }
    entry.finishedAt = new Date().toISOString();
    await onUpdate(report);
  };
}
