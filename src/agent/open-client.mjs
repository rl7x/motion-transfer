/** Muse Spark Open, Meta's open-weight model, served by Baseten. The id is the hackathon's pinned build. */
export const OPEN_MODEL = 'meta-models/muse-spark-open-1026';
export const OPEN_MODEL_NAME = 'Muse Spark Open';
/** Baseten's listed rates, in dollars per million tokens. */
export const OPEN_PRICE = Object.freeze({ input: 1.25, cached: 0.15, output: 4.25 });

const BASE_URL = 'https://inference.baseten.co/v1/chat/completions';

const textOf = content => typeof content === 'string' ? content
  : content.filter(part => part.type === 'input_text' || part.type === 'text').map(part => part.text).join('\n');

/** Turns the Responses request the rest of the project builds into a chat completion. */
export function chatRequest(request) {
  const tools = request.tools ?? [];
  return {
    model: OPEN_MODEL,
    messages: [
      ...(request.instructions ? [{ role: 'system', content: request.instructions }] : []),
      ...request.input.map(({ role, content }) => ({ role, content: textOf(content) })),
    ],
    max_tokens: request.max_output_tokens,
    ...(request.reasoning?.effort ? { reasoning_effort: request.reasoning.effort } : {}),
    ...(tools.length ? {
      tools: tools.map(({ name, description, parameters, strict }) => ({ type: 'function', function: { name, description, parameters, strict } })),
      parallel_tool_calls: false,
      ...(tools.length === 1 ? { tool_choice: { type: 'function', function: { name: tools[0].name } } } : {}),
    } : {}),
  };
}

/** Returns the same shape as a Meta response, so the existing readers work unchanged. */
export function responseFromChat(body) {
  const choice = body?.choices?.[0];
  const usage = body?.usage ?? {};
  return {
    status: ['stop', 'tool_calls'].includes(choice?.finish_reason) ? 'completed' : 'incomplete',
    output: (choice?.message?.tool_calls ?? []).map(call => ({ type: 'function_call', name: call.function?.name, arguments: call.function?.arguments })),
    usage: {
      input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens,
      input_tokens_details: { cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0 },
      output_tokens_details: { reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens ?? 0 },
    },
  };
}

export function createOpenClient(apiKey, { fetchImpl = fetch, requestTimeoutMs = 170_000 } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw Error('BASETEN_API_KEY is not set');
  return {
    async respond(request, parentSignal) {
      const signal = parentSignal ? AbortSignal.any([parentSignal, AbortSignal.timeout(requestTimeoutMs)]) : AbortSignal.timeout(requestTimeoutMs);
      let response;
      try {
        response = await fetchImpl(BASE_URL, {
          method: 'POST', signal, redirect: 'error', body: JSON.stringify(chatRequest(request)),
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        });
      } catch {
        throw Error(signal.aborted ? 'Baseten request timed out or was cancelled; not retried' : 'Baseten request failed before a response; not retried');
      }
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        throw Error(`Baseten returned HTTP ${response.status}. ${detail} No retry was made.`);
      }
      return responseFromChat(await response.json());
    },
  };
}
