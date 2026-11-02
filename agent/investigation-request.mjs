import { evidenceHistory } from './evidence.mjs';
import { readUsage } from './accounting.mjs';

const INSTRUCTIONS = `You are investigating a compiled game through a restricted experiment harness.
You have only a registered cartridge, WASM-4 host documentation in tool descriptions, and the listed tools.
Prefer run_experiment_program for a short program that prepares a checkpoint, chooses interventions/inputs,
and branches on actual returned measurements. Or use prepare_checkpoint followed by run_experiment.
The host owns branch creation and restoration; you do not invent branch names in these workflows.
Use returned checkpoint-bound typed target handles. Field hints are human assistance; never treat a static
instruction offset or an address from a different update as the same field. Hypotheses, values and inputs
are your choices; the host supplies no expected conclusion. No existing recovered implementation is available.
Each target's recorded current value is previousValue. Do not guess a missing property value.
Return small JSON with selected measurements/IDs, under 4096 UTF-8 bytes; do not stringify whole code catalogs
or traces. The tool automatically returns completed experiment summaries and durable artifact references even
when your program returns null. list_functions enumerates functions; it is NOT function-body inspection.
Inspect at least one chosen function with inspect_function/decompile_function (or SDK equivalents), or use trace_writers.
After an initial experiment, choose a subsequent action from its actual result: a targeted follow-up,
bounded evidence read, or record_finding with supported/rejected/unresolved interpretation and evidence IDs.
Specialized tools may load through client-executed tool_search namespaces. Orientation and complete experiment
tools are already available. In an experiment program sdk.static can inspect code without another model round trip.
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

/**
 * @typedef {object} InvestigationClient
 * @property {(request: object, signal: AbortSignal) => Promise<number>} countInputTokens
 * @property {(request: object, signal: AbortSignal) => Promise<object>} respond
 */

function messages(output) {
  return output.filter(item => item.type === 'message').map(item => ({
    phase: item.phase ?? 'final',
    text: (item.content ?? []).filter(block => block.type === 'output_text').map(block => block.text).join('\n'),
    refused: (item.content ?? []).some(block => block.type === 'refusal'),
  }));
}

/**
 * Execute one provider turn. Persist the reservation before generation; settle
 * only after valid usage arrives. The caller retains unsettled requests on error.
 * History is mutated in place because token preflight and generation must see
 * exactly the same request, including any evidence compaction.
 * @param {object} options
 * @param {InvestigationClient} options.client
 * @param {object} options.report Mutable public report, saved through onUpdate.
 * @param {object[]} options.history Private stateless continuation, never saved as reasoning.
 * @param {AbortSignal} options.signal
 */
export async function requestInvestigationTurn({
  report, history, catalog, client, model, limits, price, turn, requirements,
  reasoningEffort, signal, checkTime, onProgress, onUpdate,
}) {
  const finalizing = turn === limits.maxModelCalls - 1;
  if (finalizing) {
    history.splice(0, history.length, ...evidenceHistory(report, { includeDiscovery: false }));
    report.contextCompactions.push({ at: new Date().toISOString(), reason: 'final-conclusion' });
  }
  const branchGuidance = catalog.state.mode === 'client'
    ? 'Use managed experiments rather than manual branch creation.'
    : 'If using low-level forks, the name must be NEW, never main.';
  const turnInstructions = `\nYou have ${limits.maxModelCalls} generation requests and ${limits.maxToolCalls} tool calls total. `
    + `This is request ${turn + 1}. Reserve the last request for a conclusion. `
    + 'Prioritize execution evidence before lengthy static browsing. '
    + branchGuidance + ' Learn from tool errors; do not repeat a rejected call with the same arguments. '
    + `Requirements: ${JSON.stringify(report.requirements ?? requirements)}.`;
  const finalInstructions = finalizing
    ? '\nThis is the last generation request. No tools remain. Give your concise conclusion from the recorded observations, cite experiment/comparison IDs, and state what remains inconclusive.'
    : '';
  const request = {
    model,
    instructions: INSTRUCTIONS + turnInstructions + finalInstructions,
    input: history,
    tools: finalizing ? [] : catalog.definitions(),
    store: false,
    include: ['reasoning.encrypted_content'],
    reasoning: { effort: reasoningEffort },
    max_output_tokens: limits.maxOutputTokens,
    parallel_tool_calls: false,
  };
  if (Buffer.byteLength(JSON.stringify(request)) > 512 * 1024) throw new Error('Conversation exceeded the 512 KB request limit');

  let inputTokens = await client.countInputTokens(request, signal);
  if (inputTokens > limits.maxInputTokens && !finalizing && report.toolCalls.some(call => call.ok)) {
    history.splice(0, history.length, ...evidenceHistory(report));
    report.contextCompactions.push({ at: new Date().toISOString(), reason: 'input-token-limit' });
    inputTokens = await client.countInputTokens(request, signal);
  }
  checkTime();
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || inputTokens > limits.maxInputTokens) {
    throw new Error('Input token limit reached before generation');
  }
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

  const response = await client.respond(request, signal);
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
  catalog.validateResponse(response.output);

  for (const item of response.output) {
    if (item.type === 'reasoning' && (typeof item.encrypted_content !== 'string' || !item.encrypted_content)) {
      throw new Error('Meta omitted encrypted reasoning required for stateless continuation');
    }
    history.push(item.type === 'reasoning' ? { ...item, summary: item.summary ?? [] } : item);
  }
  const calls = response.output.filter(item => item.type === 'function_call' || item.type === 'tool_search_call');
  if (finalizing && calls.length) throw new Error('Meta returned a tool call after tools were disabled for the final request');
  return { calls, publicMessages };
}
