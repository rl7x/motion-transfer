import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRICES, readUsage, tokenCost } from '../agent/accounting.mjs';
import { createMetaClient } from '../agent/meta-client.mjs';
import { freezeFidelityStudy } from '../benchmark/fidelity.mjs';
import { compileMotion, digest } from '../component/build.mjs';
import { renderFidelityMedia } from './video-media.mjs';

export const VIDEO_MODEL = 'muse-spark-1.3';
export const VIDEO_PROBE_MAX_USD = 0.4;
export const VIDEO_CANDIDATE_MAX_USD = 1.5;
export const SHARED_PHASE_LEDGER = 'reports/motion-transfer-phase';
export const SUPPLIED_DEFAULTS = Object.freeze({
  walkingSpeed: 2, dashDistance: 60, cooldownTicks: 25, initialCooldownTicks: 10,
});
export const SAVED_RECOVERY = Object.freeze({
  id: 'saved-recovery', condition: 'saved-recovery',
  sourcePath: fileURLToPath(new URL('../../assets/components/dashy-dango-dash/component.ts', import.meta.url)),
  configPath: fileURLToPath(new URL('../../assets/components/dashy-dango-dash/contract.json', import.meta.url)),
});
const PROBE_OUTPUT_TOKENS = 800;
const CANDIDATE_OUTPUT_TOKENS = 4000;
const INLINE_MEDIA_LIMIT = 8_000_000;
const BANNED = ['cooldownFresh', 'neutral-after-left', 'per-tick distance', 'func102', 'evaluation-acceptance', 'eight-tick', '8 ticks', '8-tick'];

const samplingTool = { type: 'function', name: 'report_sampling', strict: true,
  description: 'Report frame counters actually read from the clip and a tight player-sprite box.',
  parameters: { type: 'object', additionalProperties: false, required: ['sampledFrames', 'spriteSeen', 'spriteBox', 'inputSummary'], properties: {
    sampledFrames: { type: 'array', maxItems: 24, items: { type: 'integer' } },
    spriteSeen: { type: 'boolean' },
    spriteBox: { type: 'object', additionalProperties: false, required: ['x', 'y', 'width', 'height'], properties: {
      x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' },
    } },
    inputSummary: { type: 'string', maxLength: 200 },
  } } };
const candidateTool = { type: 'function', name: 'submit_motion_candidate', strict: true,
  description: 'Submit init/step source and the supplied motion defaults.',
  parameters: { type: 'object', additionalProperties: false, required: ['source', 'summary', 'config'], properties: {
    source: { type: 'string', maxLength: 16384 }, summary: { type: 'string', maxLength: 1000 },
    config: { type: 'object', additionalProperties: false, required: ['walkingSpeed', 'dashDistance', 'cooldownTicks', 'initialCooldownTicks'], properties: {
      walkingSpeed: { type: 'number' }, dashDistance: { type: 'number' }, cooldownTicks: { type: 'number' }, initialCooldownTicks: { type: 'number' },
    } },
  } } };

export function probeInstructions() {
  return `This is one slowed replay of a compiled game. Each logical tick is repeated. The banner shows a four-digit logical frame counter and lamps labeled X, Z, L, R, U, and D.
Read only the counter values you can actually see. Say whether the player sprite is visible and give a tight box around it in the original 160 by 160 game pixels, with the origin at the top-left of the game image rather than the banner. The game image is scaled by 2. Do not cover the whole frame.
Call report_sampling once. Do not write source code.`;
}

export function candidateInstructions() {
  return `Write a standalone TypeScript motion component. No imports, randomness, clocks, DOM, or network.
export function init(config)
export function step(state, input, config)
init returns a JSON object state. step returns {state, output}.
input is exactly {buttons: number, sourceBodyWidth: number}. The supplied sourceBodyWidth is 8.
output is exactly {ownsMotion: boolean, displacement: {x: number, y: number}, events: string[]}.
events may contain only dash-start and dash-end, with at most one of each.
Use these public-contract defaults exactly. They are supplied and were not recovered from the pixels: walkingSpeed 2, dashDistance 60, cooldownTicks 25, initialCooldownTicks 10.
Gamepad bits in the buttons mask: X (dash) = 1, Z = 2, left = 16, right = 32, up = 64, down = 128.
Units are source pixels per 60 Hz tick. Displacement is the change for that one tick.
Infer the motion behavior from the attached media. The banner frame counter is the logical tick, and each logical tick is repeated so short motions stay visible. The lamps show the buttons held on that tick. The four defaults above stay the supplied public contract.
No recovered implementation, donor source, or expected traces are included.
Call submit_motion_candidate once.`;
}

export function mediaNote(kind) {
  if (kind === 'video') return 'The attached file is inline video input as a base64 data URL. It is not an uploaded file and not a contact sheet.';
  if (kind === 'image') return 'This request is image input: a numbered contact sheet of still frames, not a video.';
  throw Error('Unknown fidelity media kind');
}

export function visibleRequestText(request) {
  const notes = request.input.flatMap(item => (item.content ?? []).filter(part => part.type === 'input_text').map(part => part.text));
  return [request.instructions, ...notes].join('\n');
}

export function assertPromptClosed(text) {
  for (const marker of BANNED) if (text.includes(marker)) throw Error('Video prompt includes closed evidence');
}

function dataUrl(bytes, mime) {
  if (bytes.length > INLINE_MEDIA_LIMIT) throw Error('Rendered media exceeds the inline limit; no generation started');
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

function modelRequest({ instructions, text, bytes, kind, tool, maxOutputTokens, effort }) {
  const request = {
    model: VIDEO_MODEL, instructions, store: false, reasoning: { effort }, max_output_tokens: maxOutputTokens,
    parallel_tool_calls: false, tools: [tool],
    input: [{ type: 'message', role: 'user', content: [
      { type: 'input_text', text },
      kind === 'video'
        ? { type: 'input_video', video_url: dataUrl(bytes, 'video/mp4') }
        : { type: 'input_image', image_url: dataUrl(bytes, 'image/png') },
    ] }],
  };
  assertPromptClosed(visibleRequestText(request));
  return request;
}

export function buildSamplingRequest(bytes) {
  return modelRequest({ instructions: probeInstructions(), text: mediaNote('video'), bytes, kind: 'video', tool: samplingTool, maxOutputTokens: PROBE_OUTPUT_TOKENS, effort: 'minimal' });
}

export function buildCandidateRequest(bytes, kind) {
  return modelRequest({ instructions: candidateInstructions(), text: mediaNote(kind), bytes, kind, tool: candidateTool, maxOutputTokens: CANDIDATE_OUTPUT_TOKENS, effort: 'low' });
}

function publicResponse(response) {
  const output = (response?.output ?? []).filter(item => (item.type === 'message' || item.type === 'function_call') && item.phase !== 'reasoning');
  return {
    id: response?.id ?? null, status: response?.status ?? null, model: response?.model ?? null,
    messages: output.filter(item => item.type === 'message').map(item => ({
      text: (item.content ?? []).filter(block => block.type === 'output_text').map(block => block.text).join('\n'),
      refused: (item.content ?? []).some(block => block.type === 'refusal'),
    })),
    calls: output.filter(item => item.type === 'function_call').map(item => ({ name: item.name, arguments: item.arguments })),
  };
}

function overlaps(left, right) {
  return left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y;
}

export function samplingAnswer(response) {
  const call = response?.calls?.find(item => item.name === 'report_sampling');
  if (!call || response.calls.filter(item => item.name === 'report_sampling').length !== 1) return null;
  try { return JSON.parse(call.arguments); } catch { return null; }
}

export function localizationSucceeded(answer, frames) {
  const box = answer?.spriteBox;
  if (answer?.spriteSeen !== true || !box) return false;
  if (![box.x, box.y, box.width, box.height].every(Number.isInteger)) return false;
  if (box.width < 2 || box.height < 2 || box.width > 80 || box.height > 80) return false;
  const known = new Set((frames ?? []).map(frame => frame.frame));
  const sampled = [...new Set(answer.sampledFrames ?? [])].filter(frame => known.has(frame));
  return sampled.some(frameNumber => {
    const frame = frames.find(item => item.frame === frameNumber);
    return frame?.playerBox && overlaps(box, frame.playerBox);
  });
}

function observedCandidate(inputKind) {
  return inputKind === 'image'
    ? { id: 'from-contact-sheet', condition: 'contact-sheet', label: 'Contact-sheet image input plus the supplied public-contract defaults. Those defaults were not recovered from the pixels.' }
    : { id: 'from-video', condition: 'video', label: 'Video input plus the supplied public-contract defaults. Those defaults were not recovered from the pixels.' };
}

export function comparisonProvenance(study, inputKind) {
  const observed = observedCandidate(inputKind);
  return {
    schemaVersion: 1, studyId: study.id, scoring: 'frozen-only', repairs: false,
    candidates: [
      { id: observed.id, condition: observed.condition, parameterSource: 'supplied-public-contract', defaults: SUPPLIED_DEFAULTS, label: observed.label },
      { id: SAVED_RECOVERY.id, condition: 'saved-recovery', parameterSource: 'immutable-saved-component',
        sourceFile: 'components/dashy-dango-dash/component.ts', configFile: 'components/dashy-dango-dash/contract.json',
        label: 'Existing immutable saved recovery, included for comparison.' },
    ],
  };
}

function assertPairedStudy(study, inputKind) {
  const observed = observedCandidate(inputKind);
  const entries = study?.candidates ?? [];
  if (entries.length !== 2 || entries[0].id !== observed.id || entries[0].condition !== observed.condition
    || entries[1].id !== SAVED_RECOVERY.id || entries[1].condition !== 'saved-recovery') {
    throw Error('Fidelity study must freeze the observed candidate and the saved recovery together');
  }
}

async function writeProvenance(root, study, inputKind) {
  const path = join(root, 'provenance.json');
  const text = bytesOf(comparisonProvenance(study, inputKind));
  try { await writeFile(path, text, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST' || await readFile(path, 'utf8') !== text) throw error; }
}

function sameConfig(config) {
  return !!config && ['cooldownTicks', 'dashDistance', 'initialCooldownTicks', 'walkingSpeed'].every(key => config[key] === SUPPLIED_DEFAULTS[key])
    && Object.keys(config).length === 4;
}

function candidateSubmission(response) {
  const calls = response?.calls?.filter(item => item.name === 'submit_motion_candidate') ?? [];
  if (calls.length !== 1) return { accepted: false, reason: 'missing-submission' };
  let submission;
  try { submission = JSON.parse(calls[0].arguments); } catch { return { accepted: false, reason: 'invalid-submission' }; }
  if (!sameConfig(submission.config)) return { accepted: false, reason: 'config-mismatch', submission };
  if (typeof submission.source !== 'string' || !submission.source.includes('export function init') || !submission.source.includes('export function step')
    || Buffer.byteLength(submission.source) > 16384) return { accepted: false, reason: 'invalid-source', submission };
  return { accepted: true, submission };
}

const bytesOf = value => JSON.stringify(value, null, 2) + '\n';
const clean = (error, apiKey) => {
  const text = String(error?.message ?? error);
  return (apiKey ? text.split(apiKey).join('[redacted]') : text).slice(0, 500);
};

function normalizeMedia(media) {
  for (const name of ['probe', 'candidate', 'contactSheet']) if (!media?.[name]?.bytes) throw Error('Fidelity media is incomplete');
  const probeFrames = media.probe.frames ?? media.manifest?.probe?.frames;
  if (!Array.isArray(probeFrames)) throw Error('Probe frames are required for the localization check');
  return {
    cartridgeSha256: media.cartridgeSha256 ?? media.manifest?.cartridgeSha256,
    probeSha256: digest(media.probe.bytes), candidateSha256: digest(media.candidate.bytes), contactSha256: digest(media.contactSheet.bytes),
    probe: media.probe, candidate: media.candidate, contactSheet: media.contactSheet,
    probeFrames: probeFrames.map(frame => ({ frame: frame.frame, playerBox: frame.playerBox ?? null })),
  };
}

async function loadOrRender(directory) {
  const manifestPath = join(directory, 'manifest.json');
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const probe = await readFile(join(directory, manifest.probe.videoFile));
    const candidate = await readFile(join(directory, manifest.candidate.videoFile));
    const contactSheet = await readFile(join(directory, manifest.contactSheet.file));
    assert.equal(digest(probe), manifest.probe.videoSha256, 'Probe video changed');
    assert.equal(digest(candidate), manifest.candidate.videoSha256, 'Candidate video changed');
    assert.equal(digest(contactSheet), manifest.contactSheet.sha256, 'Contact sheet changed');
    return { manifest, cartridgeSha256: manifest.cartridgeSha256, probe: { bytes: probe, frames: manifest.probe.frames }, candidate: { bytes: candidate }, contactSheet: { bytes: contactSheet } };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return renderFidelityMedia(directory);
  }
}

function summary(campaign) {
  const costs = ['probe', 'candidate'].map(name => campaign.attempts[name].estimatedCostUsd ?? 0);
  return {
    probe: campaign.attempts.probe.status, candidate: campaign.attempts.candidate.status,
    localization: campaign.attempts.probe.localization ?? null, inputKind: campaign.attempts.candidate.inputKind ?? null,
    estimatedCostUsd: costs.reduce((sum, value) => sum + value, 0), studyId: campaign.attempts.candidate.studyId ?? null,
    providerRetries: false,
  };
}

async function readCampaign(directory) {
  const { integritySha256, ...campaign } = JSON.parse(await readFile(join(directory, 'journal.json'), 'utf8'));
  assert.equal(digest(JSON.stringify(campaign)), integritySha256, 'Video campaign journal integrity mismatch');
  const { sha256, ...definition } = campaign.definition;
  assert.equal(digest(JSON.stringify(definition)), sha256, 'Video campaign definition changed');
  assert.equal(definition.model, VIDEO_MODEL);
  assert.equal(definition.probeInstructionSha256, digest(probeInstructions()));
  assert.equal(definition.candidateInstructionSha256, digest(candidateInstructions()));
  assert.deepEqual(definition.defaults, SUPPLIED_DEFAULTS);
  return campaign;
}

/** One sampling probe, then one candidate request. A started call is never repeated. */
export async function runVideoCandidate({ directory, phaseBudget, client, apiKey, media, signal, onProgress = () => {} } = {}) {
  if (!phaseBudget?.reserve || !phaseBudget?.settle) throw Error('A durable phase ledger is required before video generation');
  if (!client) client = createMetaClient(apiKey);
  const root = resolve(directory);
  const lock = join(root, '.runner-lock');
  await mkdir(root, { recursive: true });
  try { await mkdir(lock); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await readFile(join(lock, 'pid'), 'utf8'));
    if (!Number.isSafeInteger(pid) || pid < 1) throw Error('Invalid video campaign lock');
    try { process.kill(pid, 0); throw Error('Another process owns this video campaign'); }
    catch (failure) { if (failure.code !== 'ESRCH') throw failure; }
    await rm(lock, { recursive: true }); await mkdir(lock);
  }
  await writeFile(join(lock, 'pid'), String(process.pid));
  let campaign;
  const save = async () => {
    campaign.updatedAt = new Date().toISOString(); campaign.summary = summary(campaign);
    const temporary = join(root, 'journal.' + randomUUID() + '.tmp');
    try {
      await writeFile(temporary, bytesOf({ ...campaign, integritySha256: digest(JSON.stringify(campaign)) }), { mode: 0o600 });
      await rename(temporary, join(root, 'journal.json'));
    } finally { await rm(temporary, { force: true }); }
  };
  try {
    const rendered = normalizeMedia(media ?? await loadOrRender(join(root, 'media')));
    let exists = true;
    try { campaign = await readCampaign(root); }
    catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
    if (exists) {
      assert.equal(campaign.definition.probeSha256, rendered.probeSha256, 'Resume media does not match the frozen probe');
      assert.equal(campaign.definition.candidateSha256, rendered.candidateSha256, 'Resume media does not match the frozen candidate clip');
    } else {
      const id = randomUUID();
      const definition = { schemaVersion: 1, id, model: VIDEO_MODEL, probeMaxUsd: VIDEO_PROBE_MAX_USD, candidateMaxUsd: VIDEO_CANDIDATE_MAX_USD,
        probeInstructionSha256: digest(probeInstructions()), candidateInstructionSha256: digest(candidateInstructions()),
        defaults: SUPPLIED_DEFAULTS, cartridgeSha256: rendered.cartridgeSha256, probeSha256: rendered.probeSha256,
        candidateSha256: rendered.candidateSha256, contactSha256: rendered.contactSha256, providerRetries: false,
        probeFrames: rendered.probeFrames };
      campaign = { schemaVersion: 1, definition: { ...definition, sha256: digest(JSON.stringify(definition)) }, status: 'prepared', attempts: {
        probe: { status: 'prepared', phaseReservationId: `video:${id}:probe` },
        candidate: { status: 'prepared', phaseReservationId: `video:${id}:candidate` },
      } };
      await save();
    }
    const price = PRICES[VIDEO_MODEL];
    const ledgerBlocked = async () => {
      const status = await phaseBudget.status();
      if (!status.uncertain && !status.overrun) return false;
      campaign.status = 'blocked'; await save(); return true;
    };
    const reconcile = async attempt => {
      if (attempt.status !== 'running') return;
      const known = attempt.usage && Number.isFinite(attempt.estimatedCostUsd);
      await phaseBudget.settle({ id: attempt.phaseReservationId, estimatedCostUsd: attempt.estimatedCostUsd ?? 0, uncertain: !known });
      attempt.status = known ? 'complete' : 'interrupted';
      if (!known) attempt.error = 'Previous runner stopped; this attempt is retained without an automatic model retry.';
      await save();
    };
    await reconcile(campaign.attempts.probe);
    await reconcile(campaign.attempts.candidate);
    if (campaign.attempts.probe.status === 'failed' || campaign.attempts.probe.status === 'interrupted') {
      if (campaign.attempts.candidate.status === 'prepared') campaign.attempts.candidate.status = 'skipped';
    }
    if (await ledgerBlocked()) return campaign;

    async function paidAttempt(attempt, maxCostUsd, request) {
      if (signal?.aborted) throw Error('Video campaign cancelled before the next request');
      await phaseBudget.reserve({ id: attempt.phaseReservationId, category: 'video', maxCostUsd,
        metadata: { campaignId: campaign.definition.id, attempt: attempt.phaseReservationId } });
      attempt.status = 'running'; attempt.startedAt = new Date().toISOString(); await save();
      onProgress(`Video ${attempt.phaseReservationId} reserved`);
      let preflight = false;
      try {
        const inputTokens = await client.countInputTokens(request, signal);
        const reservation = (inputTokens * price.input + request.max_output_tokens * price.output) / 1e6;
        if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || reservation > maxCostUsd) {
          preflight = true;
          throw Error('Video budget cannot cover this request; no generation started');
        }
        const response = await client.respond(request, signal);
        const usage = readUsage(response.usage);
        attempt.publicResponse = publicResponse(response);
        attempt.usage = usage;
        attempt.estimatedCostUsd = tokenCost(usage, price);
        attempt.inputTokens = inputTokens;
        await save();
        await phaseBudget.settle({ id: attempt.phaseReservationId, estimatedCostUsd: attempt.estimatedCostUsd, uncertain: false });
        attempt.status = response.status === 'completed' ? 'complete' : 'failed';
        if (attempt.status === 'failed') attempt.error = `Meta response status ${response.status}; not retried`;
      } catch (error) {
        attempt.status = 'failed'; attempt.error = clean(error, apiKey); attempt.estimatedCostUsd ??= 0;
        await save();
        await phaseBudget.settle({ id: attempt.phaseReservationId, estimatedCostUsd: attempt.estimatedCostUsd ?? 0, uncertain: !preflight && !attempt.usage });
      }
      await save();
    }

    const probe = campaign.attempts.probe;
    if (probe.status === 'prepared') await paidAttempt(probe, VIDEO_PROBE_MAX_USD, buildSamplingRequest(rendered.probe.bytes));
    if (probe.status === 'complete' && probe.localization === undefined) {
      probe.localization = localizationSucceeded(samplingAnswer(probe.publicResponse), campaign.definition.probeFrames);
      await save();
    }
    if (probe.status === 'failed' || probe.status === 'interrupted') {
      if (campaign.attempts.candidate.status === 'prepared') campaign.attempts.candidate.status = 'skipped';
      await save();
    }
    if (await ledgerBlocked()) return campaign;

    const candidate = campaign.attempts.candidate;
    if (probe.status === 'complete' && candidate.status === 'prepared') {
      candidate.inputKind = probe.localization ? 'video' : 'image';
      const bytes = candidate.inputKind === 'video' ? rendered.candidate.bytes : rendered.contactSheet.bytes;
      await save();
      await paidAttempt(candidate, VIDEO_CANDIDATE_MAX_USD, buildCandidateRequest(bytes, candidate.inputKind));
    }
    if (candidate.status === 'complete' && !candidate.studyId) {
      const submission = candidateSubmission(candidate.publicResponse);
      candidate.submission = submission.submission ? { summary: submission.submission.summary ?? '', config: submission.submission.config ?? null,
        sourceSha256: typeof submission.submission.source === 'string' ? digest(submission.submission.source) : null } : null;
      candidate.rejection = submission.accepted ? null : submission.reason;
      if (submission.accepted) {
        try { await compileMotion(submission.submission.source); candidate.compileError = null; }
        catch (error) { candidate.compileError = clean(error, apiKey); }
        const sourcePath = join(root, 'candidate.ts'), configPath = join(root, 'candidate.config.json');
        const source = submission.submission.source, configText = bytesOf(submission.submission.config);
        for (const [path, text] of [[sourcePath, source], [configPath, configText]]) {
          try { await writeFile(path, text, { flag: 'wx' }); }
          catch (error) { if (error.code !== 'EEXIST' || await readFile(path, 'utf8') !== text) throw error; }
        }
        const studyDir = join(root, 'fidelity-study');
        const inputKind = candidate.inputKind === 'image' ? 'image' : 'video';
        const observed = observedCandidate(inputKind);
        let study;
        try { study = JSON.parse(await readFile(join(studyDir, 'study.json'), 'utf8')); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          study = await freezeFidelityStudy(studyDir, [
            { id: observed.id, condition: observed.condition, sourcePath, configPath },
            { id: SAVED_RECOVERY.id, condition: SAVED_RECOVERY.condition, sourcePath: SAVED_RECOVERY.sourcePath, configPath: SAVED_RECOVERY.configPath },
          ]);
        }
        assertPairedStudy(study, inputKind);
        await writeProvenance(root, study, inputKind);
        candidate.studyId = study.id;
        candidate.comparison = { observedCondition: observed.condition, parameterSource: 'supplied-public-contract', defaults: SUPPLIED_DEFAULTS,
          savedRecovery: { id: SAVED_RECOVERY.id, condition: 'saved-recovery' } };
      }
      await save();
    }
    if (['complete', 'skipped', 'failed'].includes(campaign.attempts.candidate.status) && campaign.status !== 'blocked') campaign.status = 'complete';
    await save();
    return campaign;
  } finally { await rm(lock, { recursive: true }); }
}
