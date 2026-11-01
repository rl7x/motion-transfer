import { randomBytes } from 'node:crypto';
import { createMetaClient } from './meta-client.mjs';
import { PRICES, readUsage, tokenCost } from './accounting.mjs';
import { prepareMotionEvidence } from './motion-evidence.mjs';
import { SUBMIT_MOTION, validateMotionCandidate } from '../component/contract.mjs';
import { digest } from '../component/build.mjs';
import { evaluateMotion } from '../evaluator/motion.mjs';
import { DEVELOPMENT_CASES, acceptanceCases } from '../evaluator/cases.mjs';

export const RECOVERY_LIMITS = Object.freeze({
  maxModelCalls: 2, maxInputTokens: 18_000, maxOutputTokens: 6_000, maxCostUsd: 0.30, timeoutMs: 180_000,
});
const INSTRUCTIONS = `Recover a standalone motion controller from the supplied compiled-binary evidence.
The host selected the boundary, mapped numeric fields, and curated function slices and development traces.
You must infer the behavioral rules and write the implementation. This is human-assisted recovery.
Use the decompilation as approximate low-level evidence, not original source. Confirm it against measured traces.
Extract movement and dash timing only. Remove registries, allocation, damage, scoring, rendering, and effects.
Do not embed, instantiate, import, or depend on the original cartridge, runtime, other modules, or assets.
Submit one candidate using submit_motion_candidate. No prose-only final answer.
Export init(config) returning JSON object state, and step(state, input, config) returning {state, output}.
input is {buttons, sourceBodyWidth}. Buttons: X=1, Z=2, left=16, right=32, up=64, down=128; OR to combine.
config has walkingSpeed, dashDistance, cooldownTicks, initialCooldownTicks. Infer donor defaults from evidence.
output is {ownsMotion: boolean, displacement: {x: number, y: number}, events: string[]}.
Use source pixels per fixed 60 Hz update. Include supporting walking when ownsMotion is false.
ownsMotion covers the activation and active dash ticks. Events are dash-start on activation and dash-end on
the last active tick, consistent with the observed remaining-ticks transition. All values/state must be finite JSON.
Honor startup timing, held activation, cooldown boundaries, direction normalization, conflicting inputs,
direction changes during active motion, and float32 behavior. The evaluator rolls out your state without correction.
It accumulates position with Math.fround, allows at most 0.25 pixels of position error, and requires exact events.
The provided traces are development evidence; separate acceptance inputs and answers are unavailable to you.
Cite supplied binary:/dev: IDs for contract rules. State exclusions and uncertain dependencies honestly.
Keep the source small, readable, and configurable. Do not report acceptance yourself.`;

export async function recoverMotion({
  apiKey, model = 'muse-wonder-1.0', client, evidence, limits: overrides = {},
  evaluate = evaluateMotion, seed = () => randomBytes(4).readUInt32LE(),
  onUpdate = async () => {}, onProgress = () => {},
} = {}) {
  const limits = { ...RECOVERY_LIMITS, ...overrides };
  if (!Object.hasOwn(PRICES, model)) throw new Error('Unsupported recovery model');
  for (const key of ['maxModelCalls', 'maxInputTokens', 'maxOutputTokens', 'timeoutMs']) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1) throw new Error(`Invalid ${key}`);
  }
  if (limits.maxModelCalls > 2 || limits.maxOutputTokens < 16 || !Number.isFinite(limits.maxCostUsd) || limits.maxCostUsd <= 0) throw new Error('Invalid recovery limits');
  client ??= createMetaClient(apiKey, { requestTimeoutMs: 60_000 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
  timer.unref();
  const report = {
    schemaVersion: 1, status: 'preparing', model, limits, startedAt: new Date().toISOString(),
    estimatedCostUsd: 0, reservedCostUsd: 0, requests: [], attempts: [],
    pricingPerMillionTokens: PRICES[model],
  };
  try {
    await onUpdate(report);
    onProgress('Preparing evidence from compiled functions and 12 development traces');
    evidence ??= await prepareMotionEvidence({ signal: controller.signal });
    report.evidenceSha256 = evidence.sha256;
    report.cartridgeSha256 = evidence.cartridgeSha256;
    report.humanAssistance = evidence.humanAssistance;
    report.status = 'running';
    const initial = [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(evidence) }] }];
    for (let attempt = 0; attempt < limits.maxModelCalls; attempt++) {
      if (controller.signal.aborted) throw new Error('Recovery exceeded its wall-clock limit');
      // Each repair starts from public evidence and feedback. Private reasoning
      // is neither stored nor claimed to have been resumed.
      const input = [...initial];
      if (attempt) input.push({ role: 'user', content: [{ type: 'input_text', text:
        'Repair this previous candidate using development feedback. No acceptance results were consulted.\n'
          + JSON.stringify(report.attempts.at(-1)),
      }] });
      const request = {
        model, instructions: INSTRUCTIONS, input, tools: [SUBMIT_MOTION],
        store: false, reasoning: { effort: 'medium' }, max_output_tokens: limits.maxOutputTokens, parallel_tool_calls: false,
      };
      if (Buffer.byteLength(JSON.stringify(request)) > 512 * 1024) throw new Error('Recovery request exceeds 512 KB');
      const inputTokens = await client.countInputTokens(request, controller.signal);
      if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || inputTokens > limits.maxInputTokens) throw new Error('Recovery input-token limit reached before generation');
      const price = PRICES[model];
      const reservation = (inputTokens * price.input + limits.maxOutputTokens * price.output) / 1_000_000;
      if (report.estimatedCostUsd + report.reservedCostUsd + reservation > limits.maxCostUsd + 1e-9) throw new Error('Recovery cost budget would be exceeded; generation was not started');
      const record = { attempt: attempt + 1, inputTokenCount: inputTokens, reservedCostUsd: reservation, status: 'pending' };
      report.requests.push(record);
      report.reservedCostUsd += reservation;
      await onUpdate(report);
      onProgress(`Meta synthesis ${attempt + 1}: ${inputTokens} input tokens; maximum reserved cost $${reservation.toFixed(4)}`);
      const response = await client.respond(request, controller.signal);
      record.usage = readUsage(response.usage);
      record.estimatedCostUsd = tokenCost(record.usage, price);
      record.responseId = response.id;
      record.responseStatus = response.status;
      record.status = 'completed';
      report.reservedCostUsd = Math.max(0, report.reservedCostUsd - reservation);
      report.estimatedCostUsd += record.estimatedCostUsd;
      await onUpdate(report);
      if (response.status !== 'completed' || !Array.isArray(response.output)) throw new Error('Meta recovery response was incomplete; no automatic retry');
      if (report.estimatedCostUsd > limits.maxCostUsd) throw new Error('Reported recovery usage exceeded the cost budget');
      const calls = response.output.filter(item => item.type === 'function_call');
      if (calls.length !== 1 || calls[0].name !== SUBMIT_MOTION.name || typeof calls[0].arguments !== 'string'
        || Buffer.byteLength(calls[0].arguments) > 32_768 || (calls[0].status && calls[0].status !== 'completed')) {
        throw new Error('Meta must submit exactly one complete motion candidate');
      }
      const entry = { attempt: attempt + 1, responseId: response.id };
      report.attempts.push(entry);
      try {
        entry.candidate = JSON.parse(calls[0].arguments);
        validateMotionCandidate(entry.candidate, evidence);
        entry.sourceSha256 = digest(entry.candidate.source);
        onProgress('Checking candidate against all development rollouts');
        entry.development = await evaluate(entry.candidate.source, entry.candidate.contract.defaults, DEVELOPMENT_CASES, { suite: 'development', signal: controller.signal });
      } catch (error) {
        entry.development = { passed: false, error: error.message };
      }
      await onUpdate(report);
      if (!entry.development.passed) continue;
      // Freeze the candidate before generating unseen acceptance inputs. An
      // acceptance failure is retained and never automatically fed to a repair.
      report.acceptanceSeed = seed();
      onProgress('Development passed; checking 20 separate acceptance rollouts');
      entry.acceptance = await evaluate(entry.candidate.source, entry.candidate.contract.defaults,
        acceptanceCases(report.acceptanceSeed), { suite: 'acceptance', signal: controller.signal });
      if (!entry.acceptance.passed) throw new Error('Candidate failed acceptance; no automatic repair from held-out feedback');
      report.acceptedAttempt = entry.attempt;
      report.status = 'accepted';
      return report;
    }
    throw new Error('Recovery exhausted its candidate attempts without passing development');
  } catch (error) {
    for (const request of report.requests) if (request.status === 'pending') request.status = 'unsettled';
    report.status = 'failed';
    report.error = error.message;
    error.report = report;
    throw error;
  } finally {
    clearTimeout(timer);
    report.finishedAt = new Date().toISOString();
    await onUpdate(report);
  }
}
