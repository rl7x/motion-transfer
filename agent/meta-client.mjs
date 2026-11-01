const BASE_URL = 'https://api.meta.ai/v1/responses';

export function createMetaClient(apiKey, { fetchImpl = fetch, requestTimeoutMs = 45_000 } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('MODEL_API_KEY is not set');

  async function post(url, body, parentSignal) {
    const signal = parentSignal
      ? AbortSignal.any([parentSignal, AbortSignal.timeout(requestTimeoutMs)])
      : AbortSignal.timeout(requestTimeoutMs);
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal, redirect: 'error',
      });
    } catch {
      if (signal.aborted) throw new Error('Meta request timed out or was cancelled; not retried');
      throw new Error('Meta request failed before a response; not retried because billing may be uncertain');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Meta API returned HTTP ${response.status}; check account access, credits, and rate limits. No retry was made.`);
    }
    const chunks = [];
    let bytes = 0;
    try {
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) throw new Error('Meta response exceeds 2 MB');
        chunks.push(chunk);
      }
    } catch {
      throw new Error('Meta response was interrupted or exceeded 2 MB; not retried');
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new Error('Meta returned an invalid JSON response; not retried');
    }
  }

  return {
    async countInputTokens(request, signal) {
      const { model, input, instructions, tools } = request;
      const result = await post(`${BASE_URL}/input_tokens`, { model, input, instructions, tools }, signal);
      if (!Number.isSafeInteger(result.input_tokens) || result.input_tokens < 0) {
        throw new Error('Meta token count is missing or invalid; generation was not started');
      }
      return result.input_tokens;
    },
    respond(request, signal) {
      return post(BASE_URL, request, signal);
    },
  };
}
