import { readFile } from 'node:fs/promises';
import { createMetaClient } from './meta-client.mjs';
import { PRICES, readUsage, tokenCost } from './accounting.mjs';
import { loadPakuPaku } from '../recipients/paku-paku/load.mjs';
import { loadRecoveredMotion } from '../component/load.mjs';
import { hookedPakuSource } from '../runtime/paku-browser.mjs';
import { digest } from '../component/build.mjs';
import { evaluatePakuAdapter } from '../evaluator/paku-adapter.mjs';

export const TRANSFER_LIMITS = Object.freeze({ maxCostUsd: 0.05, maxModelCalls: 2, maxInputTokens: 14_000, maxOutputTokens: 3_000, timeoutMs: 180_000 });
const tool = {
  type: 'function', name: 'submit_transfer_adapter', strict: true,
  description: 'Submit a standalone TypeScript adapter and a description of its mapping for independent conformance checks. The host decides whether checks pass.',
  parameters: {
    type: 'object', properties: {
      source: { type: 'string', minLength: 1, maxLength: 16_384 },
      mapping: { type: 'string', minLength: 1, maxLength: 1500 },
      limitations: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 500 } },
    }, required: ['source', 'mapping', 'limitations'], additionalProperties: false,
  },
};
const instructions = `Adapt the supplied recovered motion component to the existing PAKU PAKU game through the supplied narrow port.
Write only the adapter. Keep the recovered implementation and recipient game rules unchanged. No imports, DOM, filesystem, network, randomness, or clocks.
Export init(motion, config) returning JSON object state, and step(state, frame, motion, config) returning {state,output}.
motion supplies init(config) and step(state,{buttons,sourceBodyWidth},config), as implemented in the supplied component.
config is {motion: the supplied component defaults, unitScale: number}; use config.motion for the component config.
frame is {tick,position,facing,normalDisplacement,dash}. facing is -1 or 1; dash is a separately held boolean.
Initialize the recovered component exactly once in init. Step it exactly once on EVERY recipient update, including inactive ticks.
Map facing and dash into donor bits: X=1, left=16, right=32. Keep sourceBodyWidth=8, independent of recipient display geometry.
Delegate motion/timers to the supplied API. Do not duplicate its duration, cooldown, or movement formulas.
output is {displacement:number,ownsMotion:boolean,events:string[],sweep:number[]}.
If component ownsMotion is false, displacement must equal frame.normalDisplacement exactly and sweep must be empty.
If true, displacement is component output.displacement.x times config.unitScale. Ignore vertical displacement.
Copy component ownsMotion and events exactly. Source pixels/tick are converted only through unitScale, never by changing timers.
sweep must contain ordered intermediate offsets from 0 to displacement, excluding both endpoints, with gaps of at most 1 pixel,
including the gaps from 0 and to displacement. Support negative displacement and noninteger values. Keep at most 64 points.
The host draws these swept player hitboxes, preserves the original final-position wraparound, and handles existing collisions.
The host resets adapter state each new life, runs fixed 60 Hz updates, and records the separate dash input for attract-mode replays.
Use the source and port to understand integration. Return a concise mapping description and supported-scope limitations.
Call submit_transfer_adapter exactly once. Do not claim browser verification; the host performs it separately.`;

export async function prepareTransferEvidence() {
  const recipient = await loadPakuPaku(), component = await loadRecoveredMotion();
  return {
    recipient: { revision: recipient.manifest.revision, sourceSha256: digest(recipient.source), source: recipient.source, hookedSource: hookedPakuSource(recipient.source) },
    component: { id: component.provenance.id, sourceSha256: component.provenance.sourceSha256, javascript: component.javascript, contract: component.contract },
    port: await readFile(new URL('../web/port.js', import.meta.url), 'utf8'),
    policy: { unitScale: 0.5, sourceBodyWidth: 8, tickRate: 60, inactiveMotion: 'preserve recipient', collisionOrder: 'recipient dots then ghost', addedInput: 'D held; independent from turn' },
  };
}

export async function transferPaku({ apiKey, client, evidence, evaluate = evaluatePakuAdapter, limits: overrides = {}, onUpdate = async () => {}, onProgress = () => {} } = {}) {
  const limits = { ...TRANSFER_LIMITS, ...overrides };
  for (const key of ['maxModelCalls','maxInputTokens','maxOutputTokens','timeoutMs']) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1) throw Error(`Invalid ${key}`);
  }
  if (limits.maxModelCalls > 2 || limits.maxOutputTokens < 16 || !Number.isFinite(limits.maxCostUsd) || limits.maxCostUsd <= 0) throw Error('Invalid transfer limits');
  client ??= createMetaClient(apiKey, { requestTimeoutMs: 60_000 });
  const signal = AbortSignal.timeout(limits.timeoutMs), model = 'muse-spark-1.3', price = PRICES[model];
  const report = { schemaVersion: 1, status: 'preparing', model, limits, startedAt: new Date().toISOString(),
    estimatedCostUsd: 0, reservedCostUsd: 0, requests: [], attempts: [], browserVerified: false,
    humanAssistance: ['Selected recipient and authored movement/draw ports', 'Specified control, unit-scale, and fixed-tick policies', 'Authored independent conformance and browser checks'],
  };
  try {
    await onUpdate(report);
    evidence ??= await prepareTransferEvidence();
    report.evidenceSha256 = digest(JSON.stringify(evidence));
    report.componentId = evidence.component.id;
    report.recipientRevision = evidence.recipient.revision;
    report.status = 'running';
    for (let index = 0; index < limits.maxModelCalls; index++) {
      const input = [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(evidence) }] }];
      if (index) input.push({ role: 'user', content: [{ type: 'input_text', text: 'Repair the previous candidate using conformance feedback. Prior private reasoning is discarded.\n' + JSON.stringify(report.attempts.at(-1)) }] });
      const request = { model, instructions, input, tools: [tool], store: false, reasoning: { effort: 'minimal' }, max_output_tokens: limits.maxOutputTokens, parallel_tool_calls: false };
      if (Buffer.byteLength(JSON.stringify(request)) > 256 * 1024) throw Error('Transfer request exceeds 256 KB');
      const tokens = await client.countInputTokens(request, signal);
      if (!Number.isSafeInteger(tokens) || tokens < 0 || tokens > limits.maxInputTokens) throw Error('Transfer input-token limit reached before generation');
      const reservation = (tokens * price.input + limits.maxOutputTokens * price.output) / 1_000_000;
      if (report.estimatedCostUsd + report.reservedCostUsd + reservation > limits.maxCostUsd + 1e-9) throw Error('Transfer cost budget would be exceeded; generation was not started');
      const record = { attempt: index + 1, status: 'pending', inputTokenCount: tokens, reservedCostUsd: reservation };
      report.requests.push(record); report.reservedCostUsd += reservation;
      await onUpdate(report);
      onProgress(`Meta adapter ${index + 1}: ${tokens} input tokens; maximum reservation $${reservation.toFixed(4)}`);
      const response = await client.respond(request, signal);
      record.usage = readUsage(response.usage); record.estimatedCostUsd = tokenCost(record.usage, price);
      record.responseId = response.id; record.responseStatus = response.status; record.status = 'completed';
      report.estimatedCostUsd += record.estimatedCostUsd; report.reservedCostUsd = Math.max(0, report.reservedCostUsd - reservation);
      await onUpdate(report);
      if (response.status !== 'completed' || report.estimatedCostUsd > limits.maxCostUsd) throw Error('Transfer response incomplete or cost budget exceeded');
      const calls = response.output?.filter(item => item.type === 'function_call');
      if (calls?.length !== 1 || calls[0].name !== tool.name || typeof calls[0].arguments !== 'string' || Buffer.byteLength(calls[0].arguments) > 32_768
        || (calls[0].status && calls[0].status !== 'completed')) throw Error('Meta must submit one complete bounded transfer adapter');
      const entry = { attempt: index + 1, responseId: response.id };
      report.attempts.push(entry);
      try {
        entry.candidate = JSON.parse(calls[0].arguments);
        const { source, mapping, limitations } = entry.candidate;
        if (Object.keys(entry.candidate).sort().join(',') !== 'limitations,mapping,source'
          || typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > 16_384
          || typeof mapping !== 'string' || !mapping.trim() || mapping.length > 1500
          || !Array.isArray(limitations) || limitations.length < 1 || limitations.length > 8
          || limitations.some(item => typeof item !== 'string' || !item.trim() || item.length > 500)) throw Error('Invalid adapter submission');
        entry.sourceSha256 = digest(source);
        entry.conformance = await evaluate(source, { signal });
        if (entry.conformance.sourceSha256 !== entry.sourceSha256 || entry.conformance.componentId !== evidence.component.id) throw Error('Adapter evaluation identity mismatch');
      } catch (error) { entry.conformance = { passed: false, error: error.message }; }
      await onUpdate(report);
      if (entry.conformance.passed) {
        report.status = 'conformant'; report.selectedAttempt = entry.attempt; return report;
      }
    }
    throw Error('Transfer exhausted its candidate attempts without conformance');
  } catch (error) {
    for (const record of report.requests) if (record.status === 'pending') record.status = 'unsettled';
    report.status = 'failed'; report.error = error.message; error.report = report; throw error;
  } finally { report.finishedAt = new Date().toISOString(); await onUpdate(report); }
}
