import { createMetaClient } from './meta-client.mjs';
import { loadTarget } from './target.mjs';
import { createCartridgeTools } from './tools.mjs';
import { evidenceHistory } from './evidence.mjs';
import { PRICES } from './accounting.mjs';
import { createToolDiscovery } from './tool-discovery.mjs';
import { requestInvestigationTurn } from './investigation-request.mjs';
import { requireInvestigationConclusion } from './investigation-completion.mjs';
import { createInvestigationToolRunner } from './investigation-tools.mjs';
import { finishRecoveryVerification } from './recovery-verification.mjs';
import { validateRecoveryProtocol, assertRecoveryProtocolSources, RECOVERY_REQUIREMENTS } from './recovery-protocol.mjs';
import { BLIND_HUMAN_ASSISTANCE, isBlindRecovery } from './blind-output.mjs';

export const DEFAULT_QUESTION = 'Determine whether holding the dash button behaves differently from pressing and releasing it. Choose controlled experiments and cite the observations supporting your conclusion.';

export const DEFAULT_LIMITS = Object.freeze({
  maxModelCalls: 6,
  maxToolCalls: 12,
  maxOutputTokens: 3_000,
  maxInputTokens: 20_000,
  maxCostUsd: 0.50,
  timeoutMs: 180_000,
});

function validateLimits(limits) {
  for (const key of ['maxModelCalls', 'maxToolCalls', 'maxOutputTokens', 'maxInputTokens', 'timeoutMs']) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1) throw new Error(`Invalid ${key}`);
  }
  if (limits.maxOutputTokens < 16 || !Number.isFinite(limits.maxCostUsd) || limits.maxCostUsd <= 0) {
    throw new Error('Invalid output token limit or cost budget');
  }
}

/**
 * Own one investigation's lifetime: report/resume validation, persistent worker,
 * bounded provider turns and final shutdown. Provider reasoning stays in the
 * private history; onUpdate receives the public report and durable checkpoints.
 * @param {object} [options]
 * @param {import('./investigation-request.mjs').InvestigationClient} [options.client]
 * @param {AbortSignal} [options.signal]
 * @param {(report: object) => Promise<void>} [options.onUpdate]
 */
export async function investigate({
  apiKey,
  model,
  question = DEFAULT_QUESTION,
  limits: overrides = {},
  client,
  runTool,
  onUpdate = async () => {},
  onProgress = () => {},
  resumeReport,
  signal,
  requirements = {},
  reasoningEffort,
  toolDiscovery,
  recoveryProtocol,
} = {}) {
  const protocol = recoveryProtocol ? validateRecoveryProtocol(recoveryProtocol) : null;
  model ??= protocol?.model ?? 'muse-wonder-1.0';
  reasoningEffort ??= protocol?.reasoningEffort ?? 'high';
  toolDiscovery ??= protocol?.toolDiscovery ?? 'none';
  const limits = { ...DEFAULT_LIMITS, ...protocol?.limits, ...overrides };
  validateLimits(limits);
  if (!Object.hasOwn(PRICES, model)) throw new Error('Unsupported investigation model');
  if (typeof question !== 'string' || !question.trim() || question.length > 2_000) throw new Error('Question must contain 1–2,000 characters');
  if (!['minimal', 'low', 'medium', 'high'].includes(reasoningEffort)) throw Error('Invalid investigation reasoning effort');
  if (protocol) {
    if (model !== protocol.model || reasoningEffort !== protocol.reasoningEffort || toolDiscovery !== protocol.toolDiscovery
      || JSON.stringify(limits) !== JSON.stringify({ ...DEFAULT_LIMITS, ...protocol.limits })) {
      throw Error('Investigation must retain its recorded recovery protocol controls');
    }
    if (Object.keys(requirements).some(key => !Object.hasOwn(RECOVERY_REQUIREMENTS, key) || requirements[key] !== true)) {
      throw Error('Recovery protocol requirements cannot be relaxed or extended');
    }
    requirements = { ...RECOVERY_REQUIREMENTS };
    await assertRecoveryProtocolSources(protocol);
  }
  client ??= createMetaClient(apiKey, protocol ? { requestTimeoutMs: protocol.requestTimeoutMs } : undefined);
  const target = await loadTarget();
  let report = {
    schemaVersion: 1,
    status: 'running',
    model, question, limits,
    startedAt: new Date().toISOString(),
    target: { id: target.id, sha256: target.sha256, bytes: target.bytes.length },
    pricingPerMillionTokens: PRICES[model],
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 },
    estimatedCostUsd: 0,
    reservedCostUsd: 0,
    requests: [],
    turns: [],
    toolCalls: [],
    conclusion: null,
    conclusionVerified: false,
    humanAssistance: isBlindRecovery(protocol) ? [...BLIND_HUMAN_ASSISTANCE] : ['Registered and hash-guarded the compiled donor', 'Mapped read-only motion registry fields; this mapping is not a model discovery', 'Authored the experiment tools and completion checks'],
    contextCompactions: [],
    requirements,
    ...(protocol ? { recoveryProtocol: protocol, reasoningEffort } : {}),
  };
  if (resumeReport) {
    if (resumeReport.schemaVersion !== 1 || resumeReport.model !== model || resumeReport.question !== question
      || resumeReport.target?.sha256 !== target.sha256 || !Array.isArray(resumeReport.requests)
      || !Array.isArray(resumeReport.toolCalls) || !Array.isArray(resumeReport.turns)
      || resumeReport.status === 'completed' || resumeReport.reservedCostUsd !== 0
      || !Number.isFinite(resumeReport.estimatedCostUsd) || resumeReport.estimatedCostUsd < 0
      || !resumeReport.requests.every(request => request.usage && request.status === 'completed')) {
      throw new Error('Cannot resume this report: target/model mismatch, completed run, or unsettled usage');
    }
    if (JSON.stringify(resumeReport.limits) !== JSON.stringify(limits)) throw new Error('Resume must retain the original limits');
    if ((resumeReport.recoveryProtocol?.id ?? null) !== (protocol?.id ?? null)) throw Error('Resume must retain the original recovery protocol');
    if ((resumeReport.session?.recovery?.protocol?.id ?? null) !== (protocol?.id ?? null)) throw Error('Resume must retain the original session recovery protocol');
    if (resumeReport.recoveryProtocol) validateRecoveryProtocol(resumeReport.recoveryProtocol);
    report = structuredClone(resumeReport);
    report.contextCompactions ??= [];
    report.contextCompactions.push({ at: new Date().toISOString(), reason: 'resume-from-public-evidence', previousError: report.error });
    report.status = 'running';
    delete report.error;
    delete report.finishedAt;
  }
  const catalog = createToolDiscovery({ mode: report.toolDiscovery?.mode ?? toolDiscovery, model, state: report.toolDiscovery,
    profile: report.requirements?.componentAcceptance ? 'recovery' : 'general', recoveryProtocol: protocol });
  report.toolDiscovery = catalog.state;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
  timer.unref();
  const worker = runTool ? null : createCartridgeTools({
    signal: controller.signal,
    onCheckpoint: async session => {
      report.session = session;
      await onUpdate(report);
    },
  });
  const dispatch = runTool ?? worker.run;
  const history = resumeReport ? evidenceHistory(report) : [{ role: 'user', content: [{ type: 'input_text', text: question }] }];
  const price = PRICES[model];
  const checkTime = () => { if (controller.signal.aborted) throw new Error('Investigation exceeded its wall-clock limit'); };

  try {
    const runToolCall = createInvestigationToolRunner({
      report, history, catalog, dispatch, worker, limits, signal: controller.signal,
      checkTime, onProgress, onUpdate,
    });
    if (worker) {
      await worker.open(report.session, protocol);
      report.session = worker.sessionState;
    }
    await onUpdate(report);
    for (let turn = report.requests.length; turn < limits.maxModelCalls; turn++) {
      checkTime();
      const { calls, publicMessages } = await requestInvestigationTurn({
        report, history, catalog, client, model, limits, price, turn, requirements,
        reasoningEffort, signal: controller.signal, checkTime, onProgress, onUpdate,
      });
      if (!calls.length) {
        report.conclusion = requireInvestigationConclusion(report, publicMessages);
        report.status = 'completed';
        return report;
      }
      for (const call of calls) await runToolCall(call, turn);
      if (await finishRecoveryVerification({ report, catalog, runToolCall, turn, onUpdate })) return report;
    }
    throw new Error('Model call limit reached without a conclusion');
  } catch (error) {
    for (const request of report.requests) if (request.status === 'pending') request.status = 'unsettled';
    report.status = controller.signal.aborted ? 'timed_out' : 'failed';
    report.error = error.message;
    error.report = report;
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    await worker?.close();
    report.finishedAt = new Date().toISOString();
    await onUpdate(report);
  }
}
