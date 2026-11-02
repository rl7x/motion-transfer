import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PRICES } from './accounting.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const freeze = value => {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
};

export const RECOVERY_REQUIREMENTS = Object.freeze({
  branchComparison: true, codeInspection: true, componentAcceptance: true,
  followupDecision: true, selectedRecoveryEvidence: true,
});

export const LEGACY_RECOVERY_POLICY = Object.freeze({
  maxDevelopmentAttempts: 3, maxSelections: 3, developmentRequestReserve: 7,
  acceptanceCaseCount: 20,
});

const modelCeilings = Object.freeze({
  'muse-spark-1.3-contributor': 0.50,
  'muse-spark-1.3': 3,
  'muse-wonder-1.0': 6,
});

/** A new identity is required whenever any recorded recovery control changes. */
export function createRecoveryProtocol({
  name = 'motion-recovery-v2', model = 'muse-spark-1.3-contributor',
  maxCostUsd = modelCeilings[model], sourceHashes = {},
} = {}) {
  if (!Object.hasOwn(modelCeilings, model) || !Object.hasOwn(PRICES, model)) throw Error('Unsupported recovery model');
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(name)) throw Error('Invalid recovery protocol name');
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > modelCeilings[model]) throw Error('Invalid recovery protocol cost ceiling');
  if (!sourceHashes || Array.isArray(sourceHashes) || typeof sourceHashes !== 'object'
    || Object.entries(sourceHashes).some(([path, sha]) => !/^[a-z][a-z0-9/.-]+$/.test(path)
      || path.split('/').some(part => !part || part === '..' || part === '.') || !/^[a-f0-9]{64}$/.test(sha))) {
    throw Error('Invalid recovery protocol source hashes');
  }
  const body = {
    schemaVersion: 1, name, model, reasoningEffort: 'high', toolDiscovery: 'none',
    contributorMode: model.endsWith('-contributor'),
    pricingPerMillionTokens: { ...PRICES[model] },
    maxDevelopmentAttempts: 5, maxSelections: 3, developmentRequestReserve: 14,
    requestTimeoutMs: 120_000,
    acceptance: { generator: 'acceptanceCases-v1', caseCount: 20, seedPolicy: 'generate-after-freeze-once' },
    limits: { maxModelCalls: 32, maxToolCalls: 48, maxInputTokens: 32_000,
      maxOutputTokens: 12_000, maxCostUsd, timeoutMs: 720_000 },
    sourceHashes: Object.fromEntries(Object.entries(sourceHashes).sort(([a], [b]) => a.localeCompare(b))),
  };
  return freeze({ ...body, id: digest(JSON.stringify(body)) });
}

/** Validate the whole record, not just the caller-supplied hash or attempt cap. */
export function validateRecoveryProtocol(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid recovery protocol');
  const expected = createRecoveryProtocol({ name: value.name, model: value.model,
    maxCostUsd: value.limits?.maxCostUsd, sourceHashes: value.sourceHashes });
  const keys = Object.keys(expected).sort();
  if (Object.keys(value).sort().join(',') !== keys.join(',')
    || keys.some(key => JSON.stringify(value[key]) !== JSON.stringify(expected[key]))) {
    throw Error('Recovery protocol identity or controls changed');
  }
  return expected;
}

export function recoveryPolicy(protocol) {
  if (!protocol) return LEGACY_RECOVERY_POLICY;
  const verified = validateRecoveryProtocol(protocol);
  return { maxDevelopmentAttempts: verified.maxDevelopmentAttempts,
    maxSelections: verified.maxSelections, developmentRequestReserve: verified.developmentRequestReserve,
    acceptanceCaseCount: verified.acceptance.caseCount };
}

export function reportRecoveryProtocol(report) {
  const protocol = report.recoveryProtocol ? validateRecoveryProtocol(report.recoveryProtocol) : null;
  const sessionProtocol = report.session?.recovery?.protocol ? validateRecoveryProtocol(report.session.recovery.protocol) : null;
  if (protocol && report.session && protocol.id !== sessionProtocol?.id) throw Error('Recovery session protocol mismatch');
  return protocol ?? sessionProtocol;
}

const protocolDirectories = ['agent', 'campaign', 'component', 'evaluator', 'experiment', 'integration', 'lab', 'runtime', 'transfer', 'roadster'];

/** Freeze local executable inputs before a campaign, without reading credentials. */
export async function snapshotRecoveryProtocol(options = {}) {
  const sourceHashes = {};
  for (const directory of protocolDirectories) {
    const root = new URL('../' + directory + '/', import.meta.url);
    for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isFile() && entry.name.endsWith('.mjs')) {
        sourceHashes[directory + '/' + entry.name] = digest(await readFile(new URL(entry.name, root)));
      }
    }
  }
  sourceHashes['targets/dashy-dango/cart.wasm'] = digest(await readFile(new URL('../targets/dashy-dango/cart.wasm', import.meta.url)));
  for (const path of ['scripts/recovery-campaign.mjs', 'web/server.mjs', 'web/roadster-entry.js',
    'targets/dashy-dango/target.lock.json', 'recipients/roadster/recipient.lock.json', 'package-lock.json']) {
    sourceHashes[path] = digest(await readFile(new URL('../' + path, import.meta.url)));
  }
  return createRecoveryProtocol({ ...options, sourceHashes });
}

export async function assertRecoveryProtocolSources(protocol) {
  const verified = validateRecoveryProtocol(protocol);
  for (const [path, expected] of Object.entries(verified.sourceHashes)) {
    if (digest(await readFile(new URL('../' + path, import.meta.url))) !== expected) {
      throw Error('Frozen recovery protocol source changed: ' + path);
    }
  }
}
