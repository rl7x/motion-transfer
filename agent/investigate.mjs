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
Use inspect_wasm overview at least once. Choose code yourself with list_functions, inspect_function,
decompile_function and call_graph. trace_writers can connect actual scalar stores to original function indices.
One isolated worker persists throughout this investigation. main starts at frame 0. session_advance continues
its state; session_observe/read_memory do not advance. checkpoint_state records a replay journal;
fork_checkpoint restores independent experimental branches into clean instances and verifies hashes.
Memory writes are permitted only in checkpoint branches. Record a hypothesis, choose a type/address/value,
and compare_branches with identical inputs and an unchanged control from the same checkpoint.
Use diff_memory between observation IDs to locate candidate fields. Correlation is not causality.
Either complete a controlled, cited branch perturbation comparison or two distinct cited run_original/input experiments.
Generated names are not recovered source names. Indirect call targets are unresolved; static offsets
on load/store instructions are added to runtime base addresses, not guaranteed absolute addresses.
Use run_original watches to read numeric memory at reset and checkpoints; supply [] when unused.
Watch names are your hypotheses about state, not established variable identities. Field hints and their addresses
are explicitly HUMAN-MAPPED assistance; testing their effects is your experiment, not independent layout discovery.
Watches do not expose private WASM globals. A linear-memory copy is not a full snapshot.
State a testable hypothesis in each experiment. Hold other inputs and elapsed frames constant when possible.
Reset starts on the title screen; X starts gameplay. A state change may render on the following update.
Simulation runs at 60 updates per second. Each checkpoint describes the frame just rendered.
Sprites are grouped by pointer, dimensions, and pixel-data hash. Multiple positions may share a sprite.
Hashes detect differences, but hashes alone do not explain a mechanic. Use actual sprite coordinates, visible text,
and bytecode observations to support conclusions. Motion fields use a HUMAN-MAPPED read-only registry in the host;
you did not discover its layout. Use these actual world-coordinate measurements to test motion, rather than confusing camera movement with player movement.
Long WAT lines and sprite groups may be explicitly truncated.
You cannot access source code, files, a shell, the internet, or prewritten behavioral answers.
Experiment results have exp-001 IDs; comparisons also have cmp-001 IDs, observations obs-0001.
Use capture_frame selectively (four total): actual PNGs arrive as user image input with identity and hashes.
Use record_finding for supported/rejected/unresolved interpretations with evidence and confidence.
To extract, select_component_evidence chooses code YOU inspected and actual session evidence. Submit standalone
source and contract with submit_component_candidate, inspect development first divergences and revise within
three attempts. Declare state field names for exact normalized cooldown/remaining comparison. No existing
recovered implementation is supplied. A development-passed candidate must freeze_component, then a separate
accept_component call generates held-out inputs. After freezing no revisions are allowed, even after failure.
Acceptance covers declared finite motion/timer/event cases, not universal equivalence or recipient integration.
Keep all original demo components and transfers separate from a new candidate.
Cite the actual experiment/comparison IDs in your final answer.
Give a concise conclusion: observations, their interpretation, and remaining uncertainties. Report inconclusive
results honestly. Claim an extracted candidate only if the separate acceptance tool returned accepted.
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
  signal,
  requirements={},
  reasoningEffort='high',
} = {}) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  validateLimits(limits);
  if (!Object.hasOwn(PRICES, model)) throw new Error('Supported models are muse-wonder-1.0 and muse-spark-1.3');
  if (typeof question !== 'string' || !question.trim() || question.length > 2_000) throw new Error('Question must contain 1–2,000 characters');
  if(!['minimal','low','medium','high'].includes(reasoningEffort))throw Error('Invalid investigation reasoning effort');
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
    requirements,
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
  const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
  timer.unref();
  const worker=runTool?null:createCartridgeTools({signal:controller.signal,onCheckpoint:async session=>{report.session=session;await onUpdate(report);}});
  const dispatch=runTool??worker.run;
  const history = resumeReport ? evidenceHistory(report) : [{ role: 'user', content: [{ type: 'input_text', text: question }] }];
  const ids = new Set(report.toolCalls.map(call => call.callId));
  let experiments = report.toolCalls.filter(call => call.experimentId).length;
  const price = PRICES[model];
  const checkTime = () => { if (controller.signal.aborted) throw new Error('Investigation exceeded its wall-clock limit'); };

  try {
    if(worker){await worker.open(report.session);report.session=worker.sessionState;}
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
        instructions: INSTRUCTIONS + `\nYou have ${limits.maxModelCalls} generation requests and ${limits.maxToolCalls} tool calls total. This is request ${turn+1}. Reserve the last request for a conclusion. Prioritize execution evidence before lengthy static browsing. fork_checkpoint branchId is a NEW unused name, never main. Learn from tool errors; do not repeat a rejected call with the same arguments. Requirements: ${JSON.stringify(report.requirements??requirements)}.` + (finalizing ? '\nThis is the last generation request. No tools remain. Give your concise conclusion from the recorded observations, cite experiment/comparison IDs, and state what remains inconclusive.' : ''),
        input: history,
        tools: finalizing ? [] : TOOLS,
        store: false,
        include: ['reasoning.encrypted_content'],
        reasoning: { effort: reasoningEffort },
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
      if (!Number.isSafeInteger(inputTokens)||inputTokens<0||inputTokens > limits.maxInputTokens) throw new Error('Input token limit reached before generation');
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
        const successful = report.toolCalls.filter(call => ['run_original','session_advance','compare_branches'].includes(call.name)&&call.ok);
        const citations = new Set(conclusion.match(/\b(?:exp-\d{3}|cmp-\d{3})\b/g) ?? []);
        const cited = successful.filter(call => citations.has(call.experimentId)||citations.has(call.result?.comparisonId));
        const signatures = new Set(cited.filter(call=>call.name!=='compare_branches').map(call => JSON.stringify(call.args.steps.map(step => [step.buttons, step.frames]))));
        const comparison=cited.some(call=>call.name==='compare_branches'&&call.result.edits?.length&&call.result.checkpoints?.length);
        if (!conclusion || (!comparison&&(signatures.size<2||cited.length<2))
          || !report.toolCalls.some(call => call.name === 'inspect_wasm' && call.ok)) {
          throw new Error('Model ended without an inspection and two contrasting, cited experiments');
        }
        if(report.requirements?.branchComparison&&!comparison)throw Error('This investigation requires a cited controlled branch perturbation comparison');
        if(report.requirements?.codeInspection&&!report.toolCalls.some(call=>['inspect_function','decompile_function','trace_writers'].includes(call.name)&&call.ok))throw Error('This investigation requires actual code inspection');
        if(report.requirements?.componentAcceptance&&!report.session?.recovery?.acceptedAttempt)throw Error('No new component passed separate acceptance; recovery remains incomplete');
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
          if (typeof call.arguments !== 'string' || Buffer.byteLength(call.arguments) > 32_768) throw new Error('Tool arguments exceed 32 KB or are invalid');
          entry.args = JSON.parse(call.arguments);
          entry.startedAt=new Date().toISOString();await onUpdate(report);
          onProgress(`Running ${call.name}`);
          const { result, evidence,images } = await dispatch(call.name, entry.args, { signal: controller.signal });
          if(worker)report.session=worker.sessionState;
          entry.ok = true;
          entry.result = result;
          if (evidence) entry.evidence = evidence;
          if (['run_original','session_advance','compare_branches'].includes(call.name)) {
            entry.experimentId = `exp-${String(++experiments).padStart(3, '0')}`;
            entry.result = { experimentId: entry.experimentId, ...result };
          }
          history.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(entry.result) });
          if(images?.length){
            entry.images=images.map(({dataUrl,...metadata})=>metadata);
            for(const image of images)history.push({role:'user',content:[{type:'input_text',text:`Actual framebuffer evidence ${image.evidenceId}, session ${image.sessionId}, branch ${image.branchId}, frame ${image.frame}, PNG SHA256 ${image.pngSha256}.`},{type:'input_image',image_url:image.dataUrl}]});
          }
        } catch (error) {
          if(worker?.sessionState)report.session=worker.sessionState;
          entry.error = error.message;
          history.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ error: entry.error,...(report.session?{sessionContext:{sessionId:report.session.id,occupiedBranchIds:report.session.branches.map(branch=>branch.id),checkpointIds:report.session.checkpoints.map(checkpoint=>checkpoint.id)}}:{}) }) });
        }
        entry.finishedAt=new Date().toISOString();
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
    signal?.removeEventListener('abort',cancel);
    await worker?.close();
    report.finishedAt = new Date().toISOString();
    await onUpdate(report);
  }
}
