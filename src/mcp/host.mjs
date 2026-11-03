import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PRICES } from '../agent/accounting.mjs';
import { createJournalToolExecutor } from '../agent/journal-tools.mjs';
import { recoveryPolicy, reportRecoveryProtocol, RECOVERY_REQUIREMENTS } from '../agent/recovery-protocol.mjs';
import { recoveryInstructions, recoveryStep } from '../agent/recovery-progress.mjs';
import { createToolDiscovery } from '../agent/tool-discovery.mjs';
import { createCartridgeTools } from '../agent/tools.mjs';
import { loadTarget } from '../agent/target.mjs';
import { saveInvestigationEvidence } from '../lab/investigation-evidence.mjs';
import { MAX_MCP_IMAGE_BYTES, untrustedTurn } from './control.mjs';

export function cleanRoomTask(protocol) {
  return `${recoveryInstructions(protocol)}

Host boundary: the only investigation tools are the typed motion-transfer workbench. Acceptance is that workbench's separate acceptance result. A process exit code is not success and is not a recovery rate.`;
}

export function createMuseReport({ protocol, target, question }) {
  return {
    schemaVersion: 1,
    status: 'running',
    harness: 'muse-code-mcp',
    model: protocol.model,
    question,
    limits: protocol.limits,
    startedAt: new Date().toISOString(),
    target: { id: target.id, sha256: target.sha256, bytes: target.byteLength },
    pricingPerMillionTokens: PRICES[protocol.model],
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 },
    estimatedCostUsd: 0,
    reservedCostUsd: 0,
    requests: [],
    turns: [],
    toolCalls: [],
    conclusion: null,
    conclusionVerified: false,
    humanAssistance: [
      'Registered and hash-guarded the compiled donor',
      'Mapped read-only motion registry fields; this mapping is not a model discovery',
      'Authored the experiment tools and completion checks',
    ],
    contextCompactions: [],
    requirements: { ...RECOVERY_REQUIREMENTS },
    recoveryProtocol: protocol,
    reasoningEffort: protocol.reasoningEffort,
    paidRun: false,
  };
}

/** Same stage predicate the shared journal executor applies before routing. */
export function refreshRecoveryCatalog(catalog, report, turn) {
  const protocol = reportRecoveryProtocol(report);
  const limits = report.limits;
  return catalog.definitions(report.requirements?.componentAcceptance ? {
    stage: recoveryStep(report).stage,
    reserveDevelopment: limits.maxModelCalls - turn <= recoveryPolicy(protocol).developmentRequestReserve,
    programsRemaining: (report.session?.experimentWorkbench?.programs?.length ?? 0) < 2,
  } : undefined);
}

function pngPayload(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > 8 * MAX_MCP_IMAGE_BYTES) throw Error('Framebuffer image exceeds the MCP content bound');
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw Error('Framebuffer image is not a bounded PNG data URL');
  const bytes = Buffer.from(match[1], 'base64');
  if (!bytes.length || bytes.length > 4 * MAX_MCP_IMAGE_BYTES) throw Error('Framebuffer image exceeds the MCP content bound');
  return { bytes, base64: match[1] };
}

export function mcpToolResult(outcome) {
  const entry = outcome.entry;
  const text = JSON.stringify(entry.ok ? entry.result : outcome.result);
  const content = [{ type: 'text', text: text.length > 32_768 ? text.slice(0, 32_768) : text }];
  let withheld = 0;
  for (const image of (outcome.images ?? []).slice(0, 4)) {
    const payload = pngPayload(image.dataUrl);
    if (payload.bytes.length > MAX_MCP_IMAGE_BYTES) {
      withheld++;
      continue;
    }
    content.push({ type: 'image', data: payload.base64, mimeType: 'image/png' });
  }
  if (withheld) content.push({ type: 'text', text: `${withheld} framebuffer image(s) withheld; each MCP image must be at most ${MAX_MCP_IMAGE_BYTES} bytes.` });
  return { content, isError: entry.ok !== true };
}

export async function createMotionHost({
  directory, protocol, question = cleanRoomTask(protocol), target, dispatch, authority, signal, sessionSource,
} = {}) {
  target ??= await loadTarget();
  const report = createMuseReport({
    protocol, question,
    target: { id: target.id, sha256: target.sha256, byteLength: target.byteLength ?? target.bytes?.length },
  });
  reportRecoveryProtocol(report);
  const catalog = createToolDiscovery({
    mode: 'none', model: protocol.model, profile: 'recovery', recoveryProtocol: protocol,
  });
  report.toolDiscovery = catalog.state;
  let liveWorker = null;
  const workerBridge = {
    get sessionState() { return liveWorker?.sessionState ?? sessionSource?.() ?? report.session; },
  };
  const cartridgeDispatch = async (name, args, options) => {
    if (!liveWorker) {
      liveWorker = createCartridgeTools({
        signal, timeoutMs: 30_000,
        onCheckpoint: async session => {
          report.session = session;
          await persist();
        },
      });
      await liveWorker.open(report.session, protocol);
      report.session = liveWorker.sessionState;
    }
    return liveWorker.run(name, args, options);
  };
  const runDispatch = dispatch ?? cartridgeDispatch;
  async function persist() {
    if (!directory) return;
    await mkdir(directory, { recursive: true });
    if (report.session?.id) await saveInvestigationEvidence(directory, report.session, report);
    const path = join(directory, 'report.json');
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    try { await rename(temporary, path); }
    finally { await rm(temporary, { force: true }); }
  }
  const runTool = createJournalToolExecutor({
    report, history: [], catalog, dispatch: runDispatch, worker: workerBridge, signal,
    onUpdate: persist,
  });
  return {
    report,
    listTools(turn = authority?.hasTurn() ? authority.current() : 0) {
      const seen = new Map();
      for (const stage of ['investigate', 'select', 'develop', 'freeze', 'accept']) {
        for (const tool of catalog.definitions({ stage, programsRemaining: true, reserveDevelopment: false })) {
          seen.set(tool.name, { name: tool.name, description: tool.description, inputSchema: tool.parameters });
        }
      }
      refreshRecoveryCatalog(catalog, report, turn);
      return [...seen.values()];
    },
    async call(name, rawArguments = {}) {
      if (!authority?.hasTurn()) throw Error('No trusted model turn has been observed');
      const supplied = untrustedTurn(rawArguments);
      const args = { ...rawArguments };
      delete args.turn;
      delete args.requestAttempt;
      const turn = authority.current();
      refreshRecoveryCatalog(catalog, report, turn);
      const outcome = await runTool({
        type: 'function_call', call_id: `mcp-${randomUUID()}`, name, arguments: JSON.stringify(args),
      }, turn);
      if (supplied !== undefined) outcome.entry.untrustedTurnIgnored = supplied;
      await persist();
      let mcp;
      try { mcp = mcpToolResult(outcome); }
      catch (error) { mcp = { content: [{ type: 'text', text: error.message }], isError: true }; }
      return { ...outcome, mcp };
    },
    persist,
    async close() {
      await liveWorker?.close();
      report.finishedAt = new Date().toISOString();
      await persist();
    },
  };
}
