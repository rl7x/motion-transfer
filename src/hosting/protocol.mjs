import { expandInputs, validateScenario } from '../parallaxia/replay.mjs';
import { JOB_LIMIT, SOURCE_LIMIT, STDOUT_LIMIT } from './constants.mjs';

const OPERATIONS = new Set([
  'verify-native', 'verify-browser', 'verify-checkpoint', 'verify-experiment', 'auto-port-verify', 'probe-egress', 'probe-env', 'probe-write', 'probe-spin', 'probe-memory',
]);
const VERIFY = new Set(['verify-native', 'verify-browser', 'verify-checkpoint', 'verify-experiment']);
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

/** One generated port for one pinned game. The worker applies its own capability gate. */
function parseAutoPortJob(value) {
  for (const key of Object.keys(value)) if (!['operation', 'gameId', 'patches', 'unitsPerSourcePixel', 'componentId'].includes(key)) throw Error('Worker job has an unexpected field');
  if (typeof value.gameId !== 'string' || !/^[a-z][a-z-]{2,24}$/.test(value.gameId)) throw Error('Unknown auto-port game');
  if (!Number.isFinite(value.unitsPerSourcePixel) || value.unitsPerSourcePixel <= 0) throw Error('Invalid auto-port scale');
  if (!hexId.test(value.componentId)) throw Error('Worker job component id is invalid');
  if (!Array.isArray(value.patches) || value.patches.length > 8) throw Error('Invalid auto-port patches');
  const patches = value.patches.map(patch => {
    if (typeof patch?.anchor !== 'string' || typeof patch?.replacement !== 'string') throw Error('Invalid auto-port patches');
    return { anchor: patch.anchor, replacement: patch.replacement };
  });
  return { operation: value.operation, gameId: value.gameId, patches, unitsPerSourcePixel: value.unitsPerSourcePixel, componentId: value.componentId };
}

/** Typed worker jobs. Anything that could choose a command, image, or environment is rejected. */
export function parseJob(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid worker job');
  for (const key of FORBIDDEN) if (Object.hasOwn(value, key)) throw Error('Arbitrary command is not a hosting operation');
  if (!OPERATIONS.has(value.operation)) throw Error('Unknown hosting operation');
  if (value.operation === 'auto-port-verify') return parseAutoPortJob(value);
  const experiment = ['verify-checkpoint','verify-experiment'].includes(value.operation);
  const allowed = VERIFY.has(value.operation) ? ['operation', 'source', 'intent', 'componentId', 'recipientId', 'ruleSource', ...(experiment ? ['checkpoint','scenario','parentSource','parentIntent','interventionTick','parentRuleSource'] : [])] : ['operation'];
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw Error('Worker job has an unexpected field');
  if (PROBES.has(value.operation)) return { operation: value.operation };
  if (typeof value.source !== 'string' || !value.source.trim() || Buffer.byteLength(value.source) > SOURCE_LIMIT) {
    throw Error('Adapter source must contain 1–16 KB');
  }
  if (value.recipientId !== undefined && !['roadster', 'parallaxia'].includes(value.recipientId)) throw Error('Unknown recipient');
  for(const key of ['ruleSource','parentRuleSource']) if(value[key]!=null && (value.recipientId!=='parallaxia'||typeof value[key]!=='string'||Buffer.byteLength(value[key])>2048)) throw Error('Invalid bounded rule module');
  if (!intentOk(value.intent)) throw Error('Unsupported Roadster mapping');
  if (!hexId.test(value.componentId)) throw Error('Worker job component id is invalid');
  if (experiment) {
    if (value.recipientId !== 'parallaxia') throw Error('Only PARALLAXIA checkpoints are supported');
    expandInputs(value.checkpoint?.frames);
    if (value.operation === 'verify-experiment') {
      validateScenario(value.scenario);
      if (!intentOk(value.parentIntent) || typeof value.parentSource !== 'string' || Buffer.byteLength(value.parentSource) > SOURCE_LIMIT) throw Error('Invalid experiment parent');
      if (!Number.isInteger(value.interventionTick) || value.interventionTick < 0 || value.interventionTick >= value.scenario.horizonTicks) throw Error('Invalid intervention tick');
    }
  }
  return { ...(value.ruleSource != null ? {ruleSource:value.ruleSource}:{}), ...(experiment ? {checkpoint:value.checkpoint,...(value.operation === 'verify-experiment' ? {scenario:value.scenario,parentSource:value.parentSource,parentRuleSource:value.parentRuleSource??null,parentIntent:value.parentIntent,interventionTick:value.interventionTick} : {})} : {}), ...(value.recipientId ? { recipientId: value.recipientId } : {}), operation: value.operation, source: value.source, componentId: value.componentId, intent: {
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
