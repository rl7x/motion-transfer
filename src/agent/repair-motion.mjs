import { randomBytes } from 'node:crypto';
import { createMetaClient } from './meta-client.mjs';
import { PRICES, readUsage, tokenCost } from './accounting.mjs';
import { sampleMotionEvidence } from './motion-evidence.mjs';
import { digest } from '../component/build.mjs';
import { validateMotionCandidate } from '../component/contract.mjs';
import { recordDonorMotion } from '../evaluator/dashy-dango.mjs';
import { evaluateMotion } from '../evaluator/motion.mjs';
import { DEVELOPMENT_CASES, MOTION_REGRESSIONS, acceptanceCases } from '../evaluator/cases.mjs';

const patch = {
  type: 'function', name: 'submit_motion_patch', strict: true,
  description: 'Submit exact text replacements for the generated component and its contract rules. Each old string must occur exactly once. Acceptance is decided by the evaluator.',
  parameters: {
    type: 'object', properties: {
      sourceEdits: { type: 'array', minItems: 1, maxItems: 3, items: {
        type: 'object', properties: { old: { type: 'string', minLength: 1, maxLength: 2000 }, new: { type: 'string', maxLength: 2000 } },
        required: ['old', 'new'], additionalProperties: false,
      } },
      ruleEdits: { type: 'array', minItems: 1, maxItems: 3, items: {
        type: 'object', properties: { old: { type: 'string', minLength: 1, maxLength: 500 }, new: { type: 'string', minLength: 1, maxLength: 500 } },
        required: ['old', 'new'], additionalProperties: false,
      } },
    }, required: ['sourceEdits', 'ruleEdits'], additionalProperties: false,
  },
};

export function applyMotionPatch(candidate, edits) {
  if (!edits || Object.keys(edits).sort().join(',') !== 'ruleEdits,sourceEdits') throw new Error('Invalid motion patch fields');
  const result = structuredClone(candidate);
  for (const key of ['sourceEdits', 'ruleEdits']) {
    if (!Array.isArray(edits[key]) || edits[key].length < 1 || edits[key].length > 3) throw new Error('Use 1–3 edits per patch field');
    for (const edit of edits[key]) {
      if (!edit || Object.keys(edit).sort().join(',') !== 'new,old' || typeof edit.old !== 'string' || !edit.old
        || typeof edit.new !== 'string' || edit.old.length > 2000 || edit.new.length > 2000) throw new Error('Invalid motion text edit');
      if (key === 'sourceEdits') {
        if (result.source.split(edit.old).length !== 2) throw new Error('Source patch anchor must occur exactly once');
        result.source = result.source.replace(edit.old, () => edit.new);
      } else {
        const rules = result.contract.rules.filter(rule => rule.description === edit.old);
        if (rules.length !== 1) throw new Error('Rule patch anchor must identify exactly one rule');
        rules[0].description = edit.new;
      }
    }
  }
  return result;
}

export async function repairMotion({ parent, evidence, apiKey, client, evaluate = evaluateMotion,
  seed = () => randomBytes(4).readUInt32LE(), onUpdate = async () => {}, onProgress = () => {} }) {
  const original = parent.attempts?.at(-1);
  if (parent.status !== 'failed' || !original?.candidate || original.acceptance?.passed !== false
    || !original.development?.passed || parent.reservedCostUsd !== 0 || parent.repairExtension
    || parent.evidenceSha256 !== evidence.sha256 || parent.cartridgeSha256 !== evidence.cartridgeSha256
    || !parent.requests.every(request => request.status === 'completed' && request.usage)) {
    throw new Error('Focused repair requires one settled recovery with failed acceptance and matching evidence');
  }
  const priorCost = parent.requests.reduce((sum, request) => sum + tokenCost(request.usage, PRICES[request.model ?? parent.model]), 0);
  if (!Number.isFinite(priorCost) || Math.abs(priorCost - parent.estimatedCostUsd) > 1e-9) throw new Error('Parent recovery accounting mismatch');
  const model = 'muse-spark-1.3', price = PRICES[model];
  client ??= createMetaClient(apiKey, { requestTimeoutMs: 60_000 });
  const report = structuredClone(parent);
  report.parentReportSha256 = digest(JSON.stringify(parent));
  report.model = model;
  report.requests.forEach(request => { request.model ??= parent.model; request.pricingPerMillionTokens ??= PRICES[request.model]; });
  report.attempts.forEach(attempt => { attempt.model ??= parent.model; });
  report.limits.maxModelCalls = parent.requests.length + 1;
  delete report.pricingPerMillionTokens;
  report.repairExtension = { addedCalls: 1, priorCallLimit: parent.limits.maxModelCalls, priorAcceptanceSeed: parent.acceptanceSeed, reason: 'Explicit focused repair; old acceptance is now development evidence', maxCombinedCostUsd: parent.limits.maxCostUsd };
  report.status = 'repairing';
  delete report.error;
  delete report.finishedAt;
  delete report.acceptanceSeed;
  const signal = AbortSignal.timeout(120_000);
  try {
    const regression = sampleMotionEvidence(await recordDonorMotion(MOTION_REGRESSIONS[0]));
    const binary = evidence.functions.find(fn => fn.functionIndex === 9);
    const input = {
      candidate: original.candidate, regression,
      binary: { id: binary.id, text: binary.text.split('\n').slice(-38).join('\n') },
      notice: 'The prior acceptance suite exposed this regression and is now development-only. New acceptance inputs/answers will be generated after this patch is frozen.',
    };
    report.repairEvidence = input;
    const request = {
      model, instructions: 'Repair the generated motion component using the measured regression and compiled pseudocode. Infer the defect; submit only a small exact source patch and corresponding contract rule correction with submit_motion_patch. Preserve other behavior. Do not submit a whole rewritten module. Do not claim acceptance.',
      input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
      tools: [patch], store: false, reasoning: { effort: 'minimal' }, max_output_tokens: 2000, parallel_tool_calls: false,
    };
    const tokens = await client.countInputTokens(request, signal);
    if (!Number.isSafeInteger(tokens) || tokens < 0 || tokens > 8000) throw new Error('Repair input-token limit reached');
    const reservation = (tokens * price.input + request.max_output_tokens * price.output) / 1_000_000;
    if (priorCost + reservation > parent.limits.maxCostUsd + 1e-9) throw new Error('Remaining recovery budget cannot fund the focused repair');
    const record = { attempt: parent.requests.length + 1, model, pricingPerMillionTokens: price, status: 'pending', inputTokenCount: tokens, maxOutputTokens: 2000, reasoningEffort: 'minimal', reservedCostUsd: reservation };
    report.requests.push(record);
    report.reservedCostUsd = reservation;
    await onUpdate(report);
    onProgress(`Focused Meta Spark patch: maximum combined reserved spend $${(priorCost + reservation).toFixed(4)}`);
    const response = await client.respond(request, signal);
    record.usage = readUsage(response.usage);
    record.estimatedCostUsd = tokenCost(record.usage, price);
    record.responseId = response.id;
    record.responseStatus = response.status;
    record.status = 'completed';
    report.estimatedCostUsd += record.estimatedCostUsd;
    report.reservedCostUsd = 0;
    await onUpdate(report);
    if (response.status !== 'completed' || report.estimatedCostUsd > parent.limits.maxCostUsd) throw new Error('Repair response incomplete or combined budget exceeded');
    const calls = response.output?.filter(item => item.type === 'function_call');
    if (calls?.length !== 1 || calls[0].name !== patch.name || typeof calls[0].arguments !== 'string'
      || Buffer.byteLength(calls[0].arguments) > 12_000 || (calls[0].status && calls[0].status !== 'completed')) throw new Error('Meta did not return one bounded motion patch');
    const edits = JSON.parse(calls[0].arguments);
    const candidate = applyMotionPatch(original.candidate, edits);
    validateMotionCandidate(candidate, evidence);
    const entry = { attempt: record.attempt, responseId: response.id, model, candidate, edits, sourceSha256: digest(candidate.source) };
    report.attempts.push(entry);
    entry.development = await evaluate(candidate.source, candidate.contract.defaults, DEVELOPMENT_CASES, { suite: 'development', signal });
    entry.regressions = await evaluate(candidate.source, candidate.contract.defaults, [
      ...MOTION_REGRESSIONS, ...acceptanceCases(parent.acceptanceSeed).map(trace => ({ ...trace, name: `previous-${trace.name}` })),
    ], { suite: 'regression-from-prior-acceptance', signal });
    if (!entry.development.passed || !entry.regressions.passed) throw new Error('Focused patch failed development or regression checks');
    report.acceptanceSeed = seed();
    if (report.acceptanceSeed === parent.acceptanceSeed) throw new Error('Repair acceptance needs a fresh seed');
    entry.acceptance = await evaluate(candidate.source, candidate.contract.defaults, acceptanceCases(report.acceptanceSeed), { suite: 'acceptance', signal });
    if (!entry.acceptance.passed) throw new Error('Focused patch failed fresh acceptance');
    report.acceptedAttempt = entry.attempt;
    report.humanAssistance.push('Converted a failed acceptance case into development evidence and selected a focused patch context');
    report.status = 'accepted';
    return report;
  } catch (error) {
    for (const request of report.requests) if (request.status === 'pending') request.status = 'unsettled';
    report.status = 'failed'; report.error = error.message; error.report = report; throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    await onUpdate(report);
  }
}
