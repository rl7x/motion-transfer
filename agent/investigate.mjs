import { createHash } from 'node:crypto';
import { createMetaClient } from './meta-client.mjs';
import { loadTarget } from './target.mjs';
import { TOOLS } from './tool-schema.mjs';
import { createCartridgeTools } from './tools.mjs';
import { evidenceHistory } from './evidence.mjs';
import { PRICES, readUsage } from './accounting.mjs';

export const DEFAULT_QUESTION = 'Determine whether holding the dash button behaves differently from pressing and releasing it. Choose controlled experiments and cite the observations supporting your conclusion.';

export const DEFAULT_LIMITS = Object.freeze({
  maxModelCalls: 6,
  maxToolCalls: 12,
  maxOutputTokens: 3_000,
  maxInputTokens: 20_000,
  maxCostUsd: 0.50,
  timeoutMs: 180_000,
});

const INSTRUCTIONS = `You are investigating a compiled game through a restricted experiment harness.
You have only a registered cartridge, WASM-4 host documentation in tool descriptions, and the listed tools.
Use inspect_wasm overview at least once. Run at least two contrasting run_original experiments.
Use list_functions and inspect_function to locate relevant bytecode and follow direct calls.
Generated names are not recovered source names. Indirect call targets are unresolved; static offsets
on load/store instructions are added to runtime base addresses, not guaranteed absolute addresses.
Use run_original watches to read numeric memory at reset and checkpoints; supply [] when unused.
Watch names are your hypotheses about state, not established variable identities. Reads do not mutate memory;
correlated changes alone do not establish causality. Watches do not expose private WASM globals.
State a testable hypothesis in each experiment. Hold other inputs and elapsed frames constant when possible.
Reset starts on the title screen; X starts gameplay. A state change may render on the following update.
Simulation runs at 60 updates per second. Each checkpoint describes the frame just rendered.
Sprites are grouped by pointer, dimensions, and pixel-data hash. Multiple positions may share a sprite.
Hashes detect differences, but hashes alone do not explain a mechanic. Use actual sprite coordinates, visible text,
and bytecode observations to support conclusions. Motion fields use a HUMAN-MAPPED read-only registry in the host;
you did not discover its layout. Use these actual world-coordinate measurements to test motion, rather than confusing camera movement with player movement.
Long WAT lines and sprite groups may be explicitly truncated.
You cannot access source code, files, a shell, the internet, or prewritten behavioral answers.
Experiment results have IDs such as exp-001. Cite at least two successful experiment IDs in your final answer.
Give a concise conclusion: observations, their interpretation, and remaining uncertainties. Report inconclusive
results honestly. Do not claim reconstruction, extraction, equivalence, or a verified discovery.
Choose bounded, focused experiments to conserve the token and cost budget.`;

function validateLimits(limits) {
  for (const key of ['maxModelCalls', 'maxToolCalls', 'maxOutputTokens', 'maxInputTokens', 'timeoutMs']) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1) throw new Error(`Invalid ${key}`);
  }
  if (limits.maxOutputTokens < 16 || !Number.isFinite(limits.maxCostUsd) || limits.maxCostUsd <= 0) {
    throw new Error('Invalid output token limit or cost budget');
  }
}

function messages(output) {
  return output.filter(item => item.type === 'message').map(item => ({
    phase: item.phase ?? 'final',
    text: (item.content ?? []).filter(block => block.type === 'output_text').map(block => block.text).join('\n'),
    refused: (item.content ?? []).some(block => block.type === 'refusal'),
  }));
}

export async function investigate({
  apiKey,
  model = 'muse-wonder-1.0',
  question = DEFAULT_QUESTION,
  limits: overrides = {},
  client,
  runTool,
  onUpdate = async () => {},
  onProgress = () => {},
  resumeReport,
} = {}) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  validateLimits(limits);
  if (!Object.hasOwn(PRICES, model)) throw new Error('Supported models are muse-wonder-1.0 and muse-spark-1.3');
  if (typeof question !== 'string' || !question.trim() || question.length > 2_000) throw new Error('Question must contain 1–2,000 characters');
  client ??= createMetaClient(apiKey);
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
    humanAssistance: ['Registered and hash-guarded the compiled donor', 'Mapped read-only motion registry fields; this mapping is not a model discovery', 'Authored the experiment tools and completion checks'],
    contextCompactions: [],
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
    report = structuredClone(resumeReport);
    report.contextCompactions ??= [];
    report.contextCompactions.push({ at: new Date().toISOString(), reason: 'resume-from-public-evidence', previousError: report.error });
    report.status = 'running';
    delete report.error;
    delete report.finishedAt;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
  timer.unref();
  const worker=runTool?null:createCartridgeTools({signal:controller.signal});
  const dispatch=runTool??worker.run;
  const history = resumeReport ? evidenceHistory(report) : [{ role: 'user', content: [{ type: 'input_text', text: question }] }];
  const ids = new Set(report.toolCalls.map(call => call.callId));
  let experiments = report.toolCalls.filter(call => call.experimentId).length;
  const price = PRICES[model];
  const checkTime = () => { if (controller.signal.aborted) throw new Error('Investigation exceeded its wall-clock limit'); };

  try {
    await onUpdate(report);
    for (let turn = report.requests.length; turn < limits.maxModelCalls; turn++) {
      checkTime();
      const finalizing = turn === limits.maxModelCalls - 1;
      if (finalizing) {
        history.splice(0, history.length, ...evidenceHistory(report));
        report.contextCompactions.push({ at: new Date().toISOString(), reason: 'final-conclusion' });
      }
      const request = {
        model,
        instructions: INSTRUCTIONS + `\nYou have ${limits.maxModelCalls} generation requests total. This is request ${turn+1}. Reserve the last request for a conclusion. Prioritize two contrasting experiments: after overview and function listing, inspect at most one relevant function before running them. You may inspect further only after both experiments exist.` + (finalizing ? '\nThis is the last generation request. No tools remain. Give your concise conclusion from the recorded observations, cite experiment IDs, and state what remains inconclusive.' : ''),
        input: history,
        tools: finalizing ? [] : TOOLS,
        store: false,
        include: ['reasoning.encrypted_content'],
        reasoning: { effort: 'high' },
        max_output_tokens: limits.maxOutputTokens,
        parallel_tool_calls: false,
      };
      if (Buffer.byteLength(JSON.stringify(request)) > 512 * 1024) throw new Error('Conversation exceeded the 512 KB request limit');
      let inputTokens = await client.countInputTokens(request, controller.signal);
      if (inputTokens > limits.maxInputTokens && !finalizing && report.toolCalls.some(call => call.ok)) {
        history.splice(0, history.length, ...evidenceHistory(report));
        report.contextCompactions.push({ at: new Date().toISOString(), reason: 'input-token-limit' });
        inputTokens = await client.countInputTokens(request, controller.signal);
      }
      checkTime();
      if (inputTokens > limits.maxInputTokens) throw new Error('Input token limit reached before generation');
      const reservation = (inputTokens * price.input + limits.maxOutputTokens * price.output) / 1_000_000;
      if (report.estimatedCostUsd + report.reservedCostUsd + reservation > limits.maxCostUsd + 1e-9) {
        throw new Error('Cost budget cannot cover the next request; generation was not started');
      }
      const record = { attempt: turn + 1, inputTokenCount: inputTokens, reservedCostUsd: reservation, status: 'pending' };
      report.requests.push(record);
      report.reservedCostUsd += reservation;
      await onUpdate(report);
      checkTime();
      onProgress(`Meta request ${turn + 1}/${limits.maxModelCalls} (reserved up to $${reservation.toFixed(3)})`);
      const response = await client.respond(request, controller.signal);
      const usage = readUsage(response.usage);
      record.usage = usage;
      record.responseId = response.id;
      record.status = response.status;
      record.estimatedCostUsd = ((usage.inputTokens - usage.cachedInputTokens) * price.input
        + usage.cachedInputTokens * price.cached + usage.outputTokens * price.output) / 1_000_000;
      report.reservedCostUsd = Math.max(0, report.reservedCostUsd - reservation);
      report.estimatedCostUsd += record.estimatedCostUsd;
      for (const key of Object.keys(report.usage)) report.usage[key] += usage[key];
      if (!Array.isArray(response.output)) throw new Error('Meta response is missing its output array');
      const publicMessages = messages(response.output);
      report.turns.push({ responseId: response.id, model: response.model ?? model, status: response.status, messages: publicMessages });
      await onUpdate(report);
      checkTime();
      if (response.status !== 'completed') throw new Error(`Meta response ended with status ${response.status}; stopping without retry`);
      if (report.estimatedCostUsd > limits.maxCostUsd) throw new Error('Reported usage exceeded the local cost budget; stopping');
      if (publicMessages.some(message => message.refused)) throw new Error('Meta declined the investigation');

      for (const item of response.output) {
        if (item.type === 'reasoning' && (typeof item.encrypted_content !== 'string' || !item.encrypted_content)) {
          throw new Error('Meta omitted encrypted reasoning required for stateless continuation');
        }
        history.push(item.type === 'reasoning' ? { ...item, summary: item.summary ?? [] } : item);
      }
      const calls = response.output.filter(item => item.type === 'function_call');
      if (finalizing && calls.length) throw new Error('Meta returned a tool call after tools were disabled for the final request');
      if (!calls.length) {
        const conclusion = publicMessages.map(message => message.text).filter(Boolean).join('\n');
        const successful = report.toolCalls.filter(call => call.name === 'run_original' && call.ok);
        const citations = new Set(conclusion.match(/\bexp-\d{3}\b/g) ?? []);
        const cited = successful.filter(call => citations.has(call.experimentId));
        const signatures = new Set(cited.map(call => JSON.stringify(call.args.steps.map(step => [step.buttons, step.frames]))));
        if (!conclusion || signatures.size < 2 || cited.length < 2
          || !report.toolCalls.some(call => call.name === 'inspect_wasm' && call.ok)) {
          throw new Error('Model ended without an inspection and two contrasting, cited experiments');
        }
        report.conclusion = conclusion;
        report.status = 'completed';
        return report;
      }

      for (const call of calls) {
        checkTime();
        if (report.toolCalls.length >= limits.maxToolCalls) throw new Error('Tool call limit reached');
        if (typeof call.call_id !== 'string' || !call.call_id || ids.has(call.call_id)
          || (call.status && call.status !== 'completed')) throw new Error('Meta returned a duplicate or incomplete tool call');
        ids.add(call.call_id);
        const entry = { callId: call.call_id, name: call.name, ok: false };
        report.toolCalls.push(entry);
        try {
          if (typeof call.arguments !== 'string' || Buffer.byteLength(call.arguments) > 8_192) throw new Error('Tool arguments exceed 8 KB or are invalid');
          entry.args = JSON.parse(call.arguments);
          onProgress(`Running ${call.name}`);
          const { result, evidence } = await dispatch(call.name, entry.args, { signal: controller.signal });
          entry.ok = true;
          entry.result = result;
          if (evidence) entry.evidence = evidence;
          if (call.name === 'run_original') {
            entry.experimentId = `exp-${String(++experiments).padStart(3, '0')}`;
            entry.result = { experimentId: entry.experimentId, ...result };
          }
          history.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(entry.result) });
        } catch (error) {
          entry.error = error.message;
          history.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ error: entry.error }) });
        }
        await onUpdate(report);
      }
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
    await worker?.close();
    report.finishedAt = new Date().toISOString();
    await onUpdate(report);
  }
}
