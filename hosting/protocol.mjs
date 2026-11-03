import { JOB_LIMIT, SOURCE_LIMIT, STDOUT_LIMIT } from './constants.mjs';

const OPERATIONS = new Set([
  'verify-native', 'verify-browser', 'probe-egress', 'probe-env', 'probe-write', 'probe-spin', 'probe-memory',
]);
const VERIFY = new Set(['verify-native', 'verify-browser']);
const PROBES = new Set(['probe-egress', 'probe-env', 'probe-write', 'probe-spin', 'probe-memory']);
const FORBIDDEN = ['command', 'argv', 'args', 'shell', 'entrypoint', 'image', 'env', 'privileged', 'network', 'mounts'];
const hexId = /^[a-f0-9]{64}$/;

function intentOk(intent) {
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) return false;
  const keys = Object.keys(intent).sort().join(',');
  return keys === 'activation,direction,unitScale'
    && Number.isFinite(intent.unitScale) && intent.unitScale >= 0.025 && intent.unitScale <= 0.2
    && ['held', 'press'].includes(intent.activation)
    && ['facing', 'opposite'].includes(intent.direction);
}

/** Typed worker jobs. Anything that could choose a command, image, or environment is rejected. */
export function parseJob(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid worker job');
  for (const key of FORBIDDEN) if (Object.hasOwn(value, key)) throw Error('Arbitrary command is not a hosting operation');
  if (!OPERATIONS.has(value.operation)) throw Error('Unknown hosting operation');
  const allowed = VERIFY.has(value.operation) ? ['operation', 'source', 'intent', 'componentId'] : ['operation'];
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw Error('Worker job has an unexpected field');
  if (PROBES.has(value.operation)) return { operation: value.operation };
  if (typeof value.source !== 'string' || !value.source.trim() || Buffer.byteLength(value.source) > SOURCE_LIMIT) {
    throw Error('Adapter source must contain 1–16 KB');
  }
  if (!intentOk(value.intent)) throw Error('Unsupported Roadster mapping');
  if (!hexId.test(value.componentId)) throw Error('Worker job component id is invalid');
  return { operation: value.operation, source: value.source, componentId: value.componentId, intent: {
    unitScale: value.intent.unitScale, activation: value.intent.activation, direction: value.intent.direction,
  } };
}

export function parseJobText(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > JOB_LIMIT) throw Error('Job exceeds 256 KB');
  let value;
  try { value = JSON.parse(text); }
  catch { throw Error('Worker job is not JSON'); }
  return parseJob(value);
}

export function boundText(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (Buffer.byteLength(text) <= STDOUT_LIMIT) return text;
  throw Error('Result exceeds output limit');
}

export function summarizeChecks(results) {
  if (!Array.isArray(results)) return [];
  return results.slice(0, 32).map(result => ({
    name: typeof result?.name === 'string' ? result.name.slice(0, 80) : 'check',
    passed: result?.passed === true,
    ...(result?.passed === true ? {} : { error: String(result?.error ?? 'failed').slice(0, 300) }),
  }));
}
