export const PRICES = {
  'muse-wonder-1.0': { input: 4, cached: 0.20, output: 20 },
  'muse-spark-1.3': { input: 1.25, cached: 0.15, output: 4.25 },
};

export function readUsage(usage) {
  if (!Number.isSafeInteger(usage?.input_tokens) || usage.input_tokens < 0
    || !Number.isSafeInteger(usage.output_tokens) || usage.output_tokens < 0) {
    throw new Error('Meta response has no valid usage accounting; stopping with the request reservation retained');
  }
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const reasoning = usage.output_tokens_details?.reasoning_tokens ?? 0;
  if (!Number.isSafeInteger(cached) || cached < 0 || cached > usage.input_tokens
    || !Number.isSafeInteger(reasoning) || reasoning < 0 || reasoning > usage.output_tokens) {
    throw new Error('Meta usage breakdown is invalid; stopping with the request reservation retained');
  }
  return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cachedInputTokens: cached, reasoningTokens: reasoning };
}

export function tokenCost(usage, price) {
  return ((usage.inputTokens - usage.cachedInputTokens) * price.input
    + usage.cachedInputTokens * price.cached + usage.outputTokens * price.output) / 1_000_000;
}
