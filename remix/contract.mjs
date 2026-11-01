export const BASE_REMIX_INTENT = Object.freeze({ unitScale: 0.5, activation: 'held', direction: 'facing' });

export function validateIntent(intent) {
  if (!intent || Object.keys(intent).sort().join(',') !== 'activation,direction,unitScale'
    || !Number.isFinite(intent.unitScale) || intent.unitScale < 0.125 || intent.unitScale > 1.5
    || !['held', 'press'].includes(intent.activation) || !['facing', 'opposite'].includes(intent.direction)) {
    throw Error('Supported remixes change dash scale (0.125–1.5), held/fresh-press activation, or forward/backward direction');
  }
  return intent;
}

export function validateRemixRequest(request) {
  if (!request || Object.keys(request).sort().join(',') !== 'idempotencyKey,parentArtifactId,prompt'
    || !/^[a-f0-9]{64}$/.test(request.parentArtifactId)
    || !/^[a-f0-9-]{36}$/.test(request.idempotencyKey)
    || typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 600) {
    throw Error('A parent artifact, request ID, and a prompt of 1–600 characters are required');
  }
  return { parentArtifactId:request.parentArtifactId, prompt:request.prompt.trim(), idempotencyKey:request.idempotencyKey };
}

export function validateRemixSubmission(candidate) {
  if (!candidate || Object.keys(candidate).sort().join(',') !== 'intent,source,status,summary'
    || !['supported', 'unsupported'].includes(candidate.status)
    || typeof candidate.summary !== 'string' || !candidate.summary.trim() || candidate.summary.length > 1000
    || typeof candidate.source !== 'string' || Buffer.byteLength(candidate.source) > 16_384) throw Error('Invalid remix submission');
  validateIntent(candidate.intent);
  if (candidate.status === 'unsupported') throw Error(`Unsupported request: ${candidate.summary}`);
  if (!candidate.source.trim()) throw Error('Meta did not submit adapter source');
  return candidate;
}
