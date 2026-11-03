import { randomUUID } from 'node:crypto';
import { constants as fileConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { tokenCost } from '../agent/accounting.mjs';

export const PINNED_MUSE_VERSION = '1.3.0-R3057.1';
export const MAX_MCP_IMAGE_BYTES = 65_536;
export const MAX_JSON_LINE_BYTES = 262_144;
const MODEL_GENERATION = /^model\.(?:[a-z0-9]+\.)?response$/;

/** Versioned binary under the OS home directory. This does not assign HOME. */
export function defaultMuseBinary() {
  return join(homedir(), '.local', 'bin', `muse-bin-${PINNED_MUSE_VERSION}`);
}

export const PINNED_MUSE_BINARY = defaultMuseBinary();

/** Exact build token. A longer id such as 1.3.0-R3057.10 does not match. */
export function isPinnedMuseVersion(text, version = PINNED_MUSE_VERSION) {
  if (typeof text !== 'string') return false;
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z0-9._-])${escaped}(?![A-Za-z0-9._-])`).test(text);
}

export async function musePreflightAvailability({
  binary = defaultMuseBinary(), platform = process.platform, sandboxPath = '/usr/bin/sandbox-exec',
} = {}) {
  if (platform !== 'darwin') {
    return { ok: false, reason: 'Muse echo preflight requires macOS sandbox-exec so the child cannot read the default Muse config.' };
  }
  try { await access(sandboxPath, fileConstants.X_OK); }
  catch {
    return { ok: false, reason: 'sandbox-exec is not executable. The echo preflight will not run without it, because that would leave the default Muse config readable.' };
  }
  try { await access(binary, fileConstants.X_OK); }
  catch {
    const where = binary === defaultMuseBinary() ? `~/.local/bin/muse-bin-${PINNED_MUSE_VERSION}` : binary;
    return { ok: false, reason: `Pinned Muse ${PINNED_MUSE_VERSION} is not executable at ${where}. Pass --muse-binary to name an installed build, or install that exact version.` };
  }
  return { ok: true, binary, sandboxPath };
}

/** Bound one JSONL stream. Overflow drops the buffer and never yields a partial line. */
export function appendJsonLine(buffer, chunk, { maxBytes = MAX_JSON_LINE_BYTES, onLine, onOverflow } = {}) {
  let next = buffer + (typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
  const tooLarge = value => Buffer.byteLength(value) > maxBytes;
  if (!next.includes('\n') && tooLarge(next)) {
    onOverflow?.();
    return '';
  }
  let end;
  while ((end = next.indexOf('\n')) >= 0) {
    const line = next.slice(0, end).replace(/\r$/, '');
    next = next.slice(end + 1);
    if (tooLarge(line)) onOverflow?.();
    else onLine?.(line);
  }
  if (tooLarge(next)) {
    onOverflow?.();
    return '';
  }
  return next;
}

/** Count host-observed model generations. A turn integer inside the event is not an identity. */
export function trustedTurnBefore(events, index) {
  if (!Number.isSafeInteger(index) || index < 0 || index > events.length) throw Error('Invalid provider event index');
  let count = 0;
  for (let cursor = 0; cursor < index; cursor++) {
    const kind = events[cursor]?.payload?.event?.task_kind;
    if (events[cursor]?.payload_type === 'task.lifecycle.proposed' && typeof kind === 'string' && MODEL_GENERATION.test(kind)) count++;
  }
  if (count === 0) throw Error('Tool call has no preceding trusted model generation; refusing a model-supplied turn');
  return count - 1;
}

export function createTurnAuthority() {
  let turn = null;
  return {
    grant(next) {
      if (!Number.isSafeInteger(next) || next < 0) throw Error('Invalid trusted turn grant');
      if (turn !== null && next < turn) throw Error('Trusted model turns cannot move backwards');
      turn = next;
    },
    hasTurn() { return Number.isSafeInteger(turn); },
    current() {
      if (!Number.isSafeInteger(turn)) throw Error('No trusted model turn has been observed');
      return turn;
    },
  };
}

export function untrustedTurn(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  if (Object.hasOwn(args, 'turn')) return args.turn;
  if (Object.hasOwn(args, 'requestAttempt')) return args.requestAttempt;
  return undefined;
}

export function emptySpend() {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, estimatedCostUsd: 0, requests: 0 };
}

/**
 * This Muse build's step cap does not meter tokens or dollars, and the echo
 * stream carries no usage. Paid admission stays closed until both are enforceable.
 */
export function museSpendControl() {
  return {
    enforceable: false,
    turnOrdering: false,
    stepCapIsSpendBound: false,
    reason: 'Paid Muse run refused: muse exec --max-model-steps is not a dollar or token ceiling, echo events report no usage, and this client was not shown to expose a model generation before an MCP tool call returns. The host cannot refuse the next billed request or bind a trusted turn.',
  };
}

export function admitNextRequest({ limits, price, spent, control = museSpendControl() }) {
  if (!control?.enforceable || !control.turnOrdering) return { ok: false, enforceable: false, reason: control?.reason ?? museSpendControl().reason };
  if (!price || !Number.isSafeInteger(limits?.maxInputTokens) || limits.maxInputTokens < 1
    || !Number.isSafeInteger(limits.maxOutputTokens) || limits.maxOutputTokens < 1
    || !Number.isSafeInteger(limits.maxModelCalls) || limits.maxModelCalls < 1
    || !Number.isFinite(limits.maxCostUsd) || limits.maxCostUsd <= 0) {
    return { ok: false, enforceable: false, reason: 'Token and dollar ceilings are incomplete' };
  }
  if (spent.requests >= limits.maxModelCalls) return { ok: false, enforceable: true, reason: 'Model call bound reached' };
  const worstCaseUsd = tokenCost({ inputTokens: limits.maxInputTokens, cachedInputTokens: 0, outputTokens: limits.maxOutputTokens }, price);
  if (spent.estimatedCostUsd + worstCaseUsd > limits.maxCostUsd + 1e-9) {
    return { ok: false, enforceable: true, reason: 'Hard dollar bound: the next request worst case exceeds the remaining budget' };
  }
  return { ok: true, enforceable: true, worstCaseUsd };
}

export function recordUsage(spent, usage, price, limits) {
  for (const key of ['inputTokens', 'outputTokens']) {
    if (!Number.isSafeInteger(usage[key]) || usage[key] < 0) throw Error('Provider usage is not a hard token bound');
  }
  const cachedInputTokens = usage.cachedInputTokens ?? 0;
  const next = {
    inputTokens: spent.inputTokens + usage.inputTokens,
    outputTokens: spent.outputTokens + usage.outputTokens,
    cachedInputTokens: spent.cachedInputTokens + cachedInputTokens,
    reasoningTokens: spent.reasoningTokens + (usage.reasoningTokens ?? 0),
    requests: spent.requests + 1,
    estimatedCostUsd: spent.estimatedCostUsd + tokenCost({
      inputTokens: usage.inputTokens, cachedInputTokens, outputTokens: usage.outputTokens,
    }, price),
  };
  const overrun = usage.inputTokens > limits.maxInputTokens || usage.outputTokens > limits.maxOutputTokens
    || next.estimatedCostUsd > limits.maxCostUsd + 1e-9;
  return { spent: next, overrun };
}

export async function prepareMusePaidRun({ phaseBudget, protocol, control = museSpendControl() }) {
  if (!control.enforceable || !control.turnOrdering) throw Error(control.reason || museSpendControl().reason);
  return phaseBudget.reserve({
    id: `muse-code:${protocol.id.slice(0, 12)}:${randomUUID()}`,
    category: 'recovery', maxCostUsd: protocol.limits.maxCostUsd,
    metadata: { harness: 'muse-code', protocolId: protocol.id },
  });
}

export function museSettingsDocument({ command, args, env }) {
  const document = {
    schema_version: 1,
    mcpServers: {
      'motion-transfer': { type: 'stdio', command, args, mode: 'required', env },
    },
  };
  if (Object.hasOwn(document, 'mcp_servers')) throw Error('mcp_servers drops Muse MCP settings when combined with mcpServers');
  return document;
}

/** Preserve the real HOME. Do not forward Codex state or provider credentials. */
export function museChildEnv(isolated, base = process.env) {
  const env = {
    PATH: base.PATH ?? '',
    XDG_CONFIG_HOME: isolated.config,
    XDG_DATA_HOME: isolated.data,
    XDG_STATE_HOME: isolated.state,
    XDG_CACHE_HOME: isolated.cache,
    MUSE_NO_AUTO_UPDATE: '1',
    MUSE_AUTH_PATH: join(isolated.config, 'muse', 'auth.json'),
  };
  if (base.HOME) env.HOME = base.HOME;
  for (const key of ['USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TMPDIR']) {
    if (typeof base[key] === 'string' && base[key]) env[key] = base[key];
  }
  if (Object.hasOwn(env, 'CODEX_HOME') || Object.hasOwn(env, 'MODEL_API_KEY')) throw Error('Isolated Muse env forwarded a forbidden variable');
  return env;
}

export function museExecArgs({ provider, workspace, promptFile, maxModelSteps }) {
  if (!['echo', 'meta'].includes(provider)) throw Error('Unsupported Muse provider');
  const args = ['exec', '--json', '--provider', provider, '--prompt-file', promptFile, '--workspace', workspace,
    '--disable-shell', '--disable-web-tools', '--no-foreign-personal-context', '--disable-approval',
    '--max-model-steps', String(maxModelSteps)];
  if (provider === 'meta') args.push('--model', 'muse-spark-1.3-contributor', '--reasoning-effort', 'high', '--api-key-stdin');
  return args;
}

const blockedTool = /^(?:shell|bash|web_search|fetch_url|browser|read_file|write_file)$/i;

/** Tool identities only. Prompt text may mention shell or the web without being a call. */
export function eventToolViolations(events) {
  const violations = [];
  for (const event of events) {
    const name = event?.payload?.tool_name ?? event?.payload?.event?.tool_name ?? event?.payload?.name;
    if (typeof name === 'string' && blockedTool.test(name)) violations.push(name);
  }
  return violations;
}
