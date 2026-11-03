import { PUBLIC_MODEL } from './constants.mjs';

/** Records provider calls and never opens a network connection. */
export function createFakeMetaClient({
  status = 'supported', source = '', intent = { unitScale: 0.1, activation: 'held', direction: 'facing' },
  summary = 'Held forward dash.', inputTokens = 120, outputTokens = 40, modelError = null,
} = {}) {
  const calls = [];
  function check(request) {
    if (request?.model !== PUBLIC_MODEL) throw Error('Public traffic uses Standard Muse Spark 1.3');
    if (modelError) throw Error(modelError);
  }
  return {
    calls,
    async countInputTokens(request, signal) {
      if (signal?.aborted) throw signal.reason ?? Error('The operation was aborted');
      check(request);
      calls.push({ method: 'countInputTokens', model: request.model, request });
      return inputTokens;
    },
    async respond(request, signal) {
      if (signal?.aborted) throw signal.reason ?? Error('The operation was aborted');
      check(request);
      calls.push({ method: 'respond', model: request.model, request });
      return {
        id: 'fake-response', status: 'completed',
        usage: {
          input_tokens: inputTokens, output_tokens: outputTokens,
          input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 },
        },
        output: [{
          type: 'function_call', name: request.tools?.[0]?.name ?? 'submit_roadster_adapter',
          arguments: JSON.stringify({ status, source, summary, intent }),
        }],
      };
    },
  };
}
