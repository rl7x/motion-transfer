import wabtFactory from 'wabt';
import { readUsage, PRICES } from '../agent/accounting.mjs';
import { digest } from '../component/build.mjs';
import { BOOT_STATES, createDonor } from './state-space.mjs';
import { verifyFirmwareCandidate } from './verify.mjs';

/** A changed control needs a new name. Nothing here tells the model what the binary is. */
export const FIRMWARE_PROTOCOL = Object.freeze({
  name: 'firmware-recovery-v2', model: 'muse-wonder-1.0', reasoningEffort: 'medium',
  maxSubmissions: 5, maxBinaryRuns: 16, maxInputsPerRun: 64, maxDisassemblyLines: 120, maxTruncations: 2,
  limits: Object.freeze({ maxModelCalls: 16, maxToolCalls: 30, maxInputTokens: 32_000, maxOutputTokens: 6_000, maxCostUsd: 1.19, timeoutMs: 600_000, requestTimeoutMs: 120_000 }),
  success: 'proved',
});

export const FIRMWARE_INSTRUCTIONS = `You are recovering the behavior of a compiled WebAssembly module. You can read its disassembly and you have no source code.
The module exports boot(s) and step(a,b,c,d,e). Call boot once, then step any number of times.
Inputs: s is 0..5. a is 0..5. b, c and d are 0 or 1. e is 0..14. step returns one unsigned 32-bit integer.
Write a standalone TypeScript module with two named exports:
  export function init(s: number): object
  export function step(state: object, input: number[]): { state: object, output: number }
input is [a,b,c,d,e]. output must equal what the module returns, and state must hold everything that carries over between steps.
No imports, randomness or dates. Module scope may hold only function declarations and JSON-literal constants, so write 16 rather than 1 << 4, and use a function rather than an arrow constant. Keep all mutable state in the returned JSON state.
Each submission is compared with the real module from every boot value, on every reachable state and every input in the domain. A mismatch returns the shortest failing sequence with expected and actual outputs.
Tools: read_disassembly returns lines of the disassembly. run_binary executes the real module on inputs you choose. submit_candidate checks your source. You have ${FIRMWARE_PROTOCOL.maxSubmissions} submissions and ${FIRMWARE_PROTOCOL.maxBinaryRuns} runs. The session ends when a submission matches.
Work in small steps and make a tool call in every response. Output is limited, so do not try to derive everything before acting. Read, measure, then submit an early candidate: a shortest failing sequence teaches you more than long reasoning does. Read the data section too, and test what you read.`;

const inputSchema = { type: 'array', items: { type: 'integer' }, minItems: 5, maxItems: 5 };
export const FIRMWARE_TOOLS = Object.freeze([
  { type: 'function', name: 'read_disassembly', strict: true, description: 'Return lines of the module disassembly, starting at startLine (1 is the first line). At most 120 lines.',
    parameters: { type: 'object', properties: { startLine: { type: 'integer' }, lineCount: { type: 'integer' } }, required: ['startLine', 'lineCount'], additionalProperties: false } },
  { type: 'function', name: 'run_binary', strict: true, description: 'Boot a fresh instance of the real module with boot, run the inputs in order, and return each output. At most 64 inputs.',
    parameters: { type: 'object', properties: { boot: { type: 'integer' }, inputs: { type: 'array', items: inputSchema, minItems: 1, maxItems: 64 } }, required: ['boot', 'inputs'], additionalProperties: false } },
  { type: 'function', name: 'submit_candidate', strict: true, description: 'Check TypeScript source against the real module on every reachable state and every input. Uses one submission.',
    parameters: { type: 'object', properties: { source: { type: 'string' } }, required: ['source'], additionalProperties: false } },
]);

export async function disassemble(bytes) {
  const wabt = await wabtFactory(), parsed = wabt.readWasm(bytes, { readDebugNames: false });
  try { parsed.generateNames(); parsed.applyNames(); return parsed.toText({ foldExprs: false, inlineExport: false }); }
  finally { parsed.destroy(); }
}

function validInputs({ boot, inputs }) {
  if (!BOOT_STATES.includes(boot) || !Array.isArray(inputs) || inputs.length < 1 || inputs.length > FIRMWARE_PROTOCOL.maxInputsPerRun) return false;
  return inputs.every(input => Array.isArray(input) && input.length === 5 && input.every(Number.isInteger)
    && input[0] >= 0 && input[0] <= 5 && [1, 2, 3].every(index => input[index] === 0 || input[index] === 1) && input[4] >= 0 && input[4] <= 14);
}

export async function firstHistory(bytes) {
  const lines = (await disassemble(bytes)).split('\n').length;
  return [{ role: 'user', content: [{ type: 'input_text', text: `The disassembly has ${lines} lines. Begin with read_disassembly.` }] }];
}
export const firmwareRequest = (history, protocol = FIRMWARE_PROTOCOL) => ({ model: protocol.model, instructions: FIRMWARE_INSTRUCTIONS, input: history, tools: FIRMWARE_TOOLS, store: false,
  include: ['reasoning.encrypted_content'], reasoning: { effort: protocol.reasoningEffort }, max_output_tokens: protocol.limits.maxOutputTokens, parallel_tool_calls: false });

export const submissionFeedback = result => result.verdict === 'proved'
  ? { verdict: 'proved', pairs: result.pairs, checked: result.checked }
  : result.verdict === 'counterexample'
    ? { verdict: 'counterexample', boot: result.counterexample.boot, failingStep: result.counterexample.length, trace: result.counterexample.trace }
    : { verdict: 'inconclusive', reason: result.reason, ...(result.error ? { error: result.error } : {}),
      advice: result.reason === 'search-cap' ? 'State never settled. Keep only what affects future behavior, and no counters that grow.' : 'Fix the reported problem and resubmit.' };

/** One bounded session. Every request is reserved before it is sent, and nothing is retried. */
export async function runFirmwareSession({ client, bytes, signal, verify = verifyFirmwareCandidate, onUpdate = async () => {}, protocol = FIRMWARE_PROTOCOL }) {
  const price = PRICES[protocol.model], limits = protocol.limits, history = await firstHistory(bytes);
  const disassembly = (await disassemble(bytes)).split('\n');
  const report = { schemaVersion: 1, protocol, firmwareSha256: digest(bytes), startedAt: new Date().toISOString(), status: 'running',
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 }, estimatedCostUsd: 0, reservedCostUsd: 0,
    requests: [], toolCalls: [], attempts: [], binaryRuns: 0, truncations: 0, messages: [] };
  const deadline = AbortSignal.timeout(limits.timeoutMs), bound = signal ? AbortSignal.any([signal, deadline]) : deadline;
  async function runTool(call) {
    let args;
    try { args = JSON.parse(call.arguments); } catch { return { error: 'Tool arguments must be valid JSON.' }; }
    if (call.name === 'read_disassembly') {
      const { startLine, lineCount } = args;
      if (!Number.isInteger(startLine) || !Number.isInteger(lineCount) || startLine < 1 || lineCount < 1 || lineCount > protocol.maxDisassemblyLines) return { error: 'Ask for 1 to 120 lines from line 1 onward.' };
      return { startLine, totalLines: disassembly.length, lines: disassembly.slice(startLine - 1, startLine - 1 + lineCount).map(line => line.slice(0, 4000)) };
    }
    if (call.name === 'run_binary') {
      if (report.binaryRuns >= protocol.maxBinaryRuns) return { error: 'No binary runs remain.' };
      if (!validInputs(args)) return { error: 'Inputs are outside the declared domain.' };
      report.binaryRuns++;
      const donor = await createDonor(bytes);
      donor.boot(args.boot);
      return { outputs: args.inputs.map(input => donor.step(input)) };
    }
    if (call.name === 'submit_candidate') {
      if (report.attempts.length >= protocol.maxSubmissions) return { error: 'No submissions remain.' };
      if (typeof args.source !== 'string' || !args.source.trim()) return { error: 'source is required.' };
      const result = await verify(args.source, { signal: bound });
      report.attempts.push({ attempt: report.attempts.length + 1, source: args.source, result });
      return submissionFeedback(result);
    }
    return { error: 'Unknown tool.' };
  }
  try {
    for (let turn = 0; turn < limits.maxModelCalls; turn++) {
      if (bound.aborted) throw Error('Firmware session exceeded its wall-clock limit');
      const request = firmwareRequest(history, protocol);
      const inputTokens = await client.countInputTokens(request, bound);
      if (!Number.isSafeInteger(inputTokens) || inputTokens > limits.maxInputTokens) throw Error('Input token limit reached before generation');
      const reservation = (inputTokens * price.input + limits.maxOutputTokens * price.output) / 1_000_000;
      if (report.estimatedCostUsd + reservation > limits.maxCostUsd + 1e-9) throw Error('Cost budget cannot cover the next request; generation was not started');
      const record = { attempt: turn + 1, inputTokenCount: inputTokens, reservedCostUsd: reservation, status: 'pending' };
      report.requests.push(record); report.reservedCostUsd += reservation;
      await onUpdate(report);
      const response = await client.respond(request, bound);
      const usage = readUsage(response.usage);
      record.usage = usage; record.responseId = response.id; record.status = response.status;
      record.estimatedCostUsd = ((usage.inputTokens - usage.cachedInputTokens) * price.input + usage.cachedInputTokens * price.cached + usage.outputTokens * price.output) / 1_000_000;
      report.reservedCostUsd = Math.max(0, report.reservedCostUsd - reservation);
      report.estimatedCostUsd += record.estimatedCostUsd;
      for (const key of Object.keys(report.usage)) report.usage[key] += usage[key];
      await onUpdate(report);
      // A response cut off before it acted is paid for and discarded. It need not end the session.
      if (response.status === 'incomplete' && report.truncations < protocol.maxTruncations) {
        report.truncations++;
        record.incompleteReason = response.incomplete_details?.reason ?? null;
        history.push({ role: 'user', content: [{ type: 'input_text', text: 'Your last response ran out of output tokens before it acted, so it was discarded. Make a tool call now and keep your reasoning short.' }] });
        continue;
      }
      if (response.status !== 'completed') throw Error(`Meta response ended with status ${response.status}; stopping without retry`);
      if (report.estimatedCostUsd > limits.maxCostUsd) throw Error('Reported usage exceeded the session cost ceiling; stopping');
      if (!Array.isArray(response.output)) throw Error('Meta response is missing its output array');
      for (const item of response.output) {
        history.push(item.type === 'reasoning' ? { ...item, summary: item.summary ?? [] } : item);
        if (item.type === 'message') report.messages.push((item.content ?? []).filter(block => block.type === 'output_text').map(block => block.text).join('\n').slice(0, 4000));
      }
      const calls = response.output.filter(item => item.type === 'function_call');
      if (!calls.length) throw Error('The model stopped without a matching submission');
      for (const call of calls) {
        if (report.toolCalls.length >= limits.maxToolCalls) throw Error('Tool call limit reached');
        const output = await runTool(call);
        report.toolCalls.push({ name: call.name, requestAttempt: turn + 1, ok: !output.error, ...(call.name === 'run_binary' ? { arguments: JSON.parse(call.arguments), output } : { output: { ...output, trace: output.trace?.length, lines: output.lines?.length } }) });
        history.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) });
        await onUpdate(report);
      }
      if (report.attempts.at(-1)?.result.verdict === 'proved') { report.status = 'completed'; report.acceptedAttempt = report.attempts.at(-1).attempt; return report; }
      if (report.attempts.length >= protocol.maxSubmissions) throw Error(`All ${protocol.maxSubmissions} submissions failed`);
    }
    throw Error('Model call limit reached without a matching submission');
  } catch (error) {
    report.status = bound.aborted ? 'timed_out' : 'failed';
    report.error = String(error.message).slice(0, 1000);
    for (const request of report.requests) if (request.status === 'pending') request.status = 'unsettled';
    return report;
  } finally {
    report.finishedAt = new Date().toISOString();
    await onUpdate(report);
  }
}
