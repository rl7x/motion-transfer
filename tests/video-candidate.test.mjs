import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPhaseBudget } from '../campaign/phase-budget.mjs';
import { renderFidelityMedia } from '../campaign/video-media.mjs';
import {
  SAVED_RECOVERY, SUPPLIED_DEFAULTS, buildCandidateRequest, buildSamplingRequest, candidateInstructions, probeInstructions,
  runVideoCandidate, visibleRequestText,
} from '../campaign/video-candidate.mjs';
import { main } from '../scripts/video-candidate.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const source = `export function init(config){return {n:0};}\nexport function step(state, input, config){return {state:{n:state.n+1}, output:{ownsMotion:false, displacement:{x:0,y:0}, events:[]}};}\n`;

function syntheticMedia() {
  return {
    cartridgeSha256: 'c'.repeat(64),
    probe: { bytes: Buffer.from('probe-video'), frames: [{ frame: 14, playerBox: { x: 68, y: 76, width: 16, height: 8 } }] },
    candidate: { bytes: Buffer.from('candidate-video') },
    contactSheet: { bytes: Buffer.from('contact-sheet') },
  };
}
function usage(input = 1000, output = 100) {
  return { input_tokens: input, output_tokens: output, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } };
}
function samplingResponse(answer) {
  return { id: 'probe-response', status: 'completed', model: 'muse-spark-1.3', usage: usage(), output: [
    { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'PRIVATE-REASONING-SENTINEL' }] },
    { type: 'message', content: [{ type: 'output_text', text: 'The sprite is visible near the center.' }] },
    { type: 'function_call', name: 'report_sampling', arguments: JSON.stringify(answer) },
  ] };
}
function candidateResponse(config = SUPPLIED_DEFAULTS) {
  return { id: 'candidate-response', status: 'completed', model: 'muse-spark-1.3', usage: usage(), output: [
    { type: 'reasoning', summary: [{ text: 'PRIVATE-REASONING-SENTINEL' }] },
    { type: 'function_call', name: 'submit_motion_candidate', arguments: JSON.stringify({ source, summary: 'Fixture from the clip.', config }) },
  ] };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'video-candidate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const phaseBudget = await createPhaseBudget(join(root, 'phase'));
  const events = [];
  const reserve = phaseBudget.reserve.bind(phaseBudget);
  phaseBudget.reserve = async entry => { events.push(['reserve', entry.category, entry.maxCostUsd]); return reserve(entry); };
  return { root, phaseBudget, events, directory: join(root, 'campaign') };
}

test('the candidate prompt discloses the ABI and hides recovered source and acceptance answers', async () => {
  const component = await readFile(new URL('../components/dashy-dango-dash/component.ts', import.meta.url), 'utf8');
  const request = buildCandidateRequest(Buffer.from('clip'), 'video');
  const text = visibleRequestText(request);
  assert.equal(request.model, 'muse-spark-1.3');
  assert.equal(request.store, false);
  assert.equal(request.input[0].content[1].type, 'input_video');
  assert.equal(request.input[0].content[1].video_url, 'data:video/mp4;base64,Y2xpcA==');
  assert.match(text, /export function init/);
  assert.match(text, /walkingSpeed 2/);
  assert.match(text, /public-contract defaults/);
  assert.match(text, /not recovered from the pixels/);
  assert.match(text, /left = 16/);
  assert.equal(text.includes('cooldownFresh'), false);
  assert.equal(text.includes('components/dashy-dango-dash/component.ts'), false);
  assert.equal(text.includes(component), false);
  assert.equal(text.includes('neutral-after-left'), false);
  const sheet = buildCandidateRequest(Buffer.from('sheet'), 'image');
  assert.match(visibleRequestText(sheet), /image input/);
  assert.match(visibleRequestText(sheet), /not a video/);
  assert.equal(sheet.input[0].content.some(part => part.type === 'input_video'), false);
  assert.equal(sheet.input[0].content[1].type, 'input_image');
  assert.equal(probeInstructions().includes('walkingSpeed'), false);
  assert.equal(candidateInstructions().includes('eight-tick'), false);
  assert.equal(candidateInstructions().includes('component.ts'), false);
  const implementation = await readFile(new URL('../campaign/video-candidate.mjs', import.meta.url), 'utf8');
  const prompts = implementation.slice(implementation.indexOf('export function probeInstructions'), implementation.indexOf('export function visibleRequestText'));
  assert.equal(implementation.includes('scoreFidelityStudy'), false);
  assert.equal(prompts.includes('dashy-dango-dash/component'), false);
  assert.match(implementation, /components\/dashy-dango-dash\/component\.ts/);
});

test('a localized probe freezes one video candidate and does not score or retry it', async t => {
  const { directory, phaseBudget, events } = await fixture(t);
  const media = syntheticMedia();
  let responses = 0;
  const client = {
    async countInputTokens(request) {
      events.push(['count', request.model]);
      assert.equal(request.model, 'muse-spark-1.3');
      return 1000;
    },
    async respond(request) {
      responses++;
      events.push(['respond', request.reasoning.effort, request.input[0].content.map(part => part.type)]);
      if (responses === 1) return samplingResponse({ sampledFrames: [14], spriteSeen: true, spriteBox: { x: 70, y: 74, width: 12, height: 12 }, inputSummary: 'X and R' });
      assert.equal(request.input[0].content[1].video_url.includes('Y2FuZGlkYXRl'), true);
      return candidateResponse();
    },
  };
  const campaign = await runVideoCandidate({ directory, phaseBudget, client, media });
  assert.deepEqual(events.filter(event => event[0] !== 'count').map(event => event[0]), ['reserve', 'respond', 'reserve', 'respond']);
  assert.deepEqual(events[0], ['reserve', 'video', 0.4]);
  assert.deepEqual(events[3], ['reserve', 'video', 1.5]);
  assert.equal(events.indexOf(events.find(event => event[0] === 'reserve')) < events.findIndex(event => event[0] === 'count'), true);
  assert.equal(campaign.attempts.probe.localization, true);
  assert.equal(campaign.attempts.candidate.inputKind, 'video');
  assert.equal(campaign.attempts.probe.publicResponse.messages[0].text, 'The sprite is visible near the center.');
  assert.equal(campaign.attempts.candidate.studyId.length, 64);
  const journal = await readFile(join(directory, 'journal.json'), 'utf8');
  assert.equal(journal.includes('PRIVATE-REASONING-SENTINEL'), false);
  const study = JSON.parse(await readFile(join(directory, 'fidelity-study', 'study.json'), 'utf8'));
  assert.equal(study.candidates.length, 2);
  assert.equal(study.candidates[0].condition, 'video');
  assert.equal(study.candidates[0].id, 'from-video');
  assert.equal(study.candidates[1].condition, 'saved-recovery');
  assert.equal(study.candidates[1].id, 'saved-recovery');
  assert.equal(campaign.attempts.candidate.comparison.parameterSource, 'supplied-public-contract');
  assert.equal(campaign.attempts.candidate.comparison.savedRecovery.condition, 'saved-recovery');
  await assert.rejects(readFile(join(directory, 'fidelity-study', 'results.json')), error => error.code === 'ENOENT');
  const status = await phaseBudget.status();
  assert.equal(status.uncertain, false);
  assert.ok(Math.abs(status.categories.video.settledUsd - 0.00335) < 1e-9);
  const again = await runVideoCandidate({ directory, phaseBudget, client: { countInputTokens: async () => { responses++; }, respond: async () => { responses++; } }, media });
  assert.equal(responses, 2);
  assert.equal(again.definition.sha256, campaign.definition.sha256);
});

test('a missed sprite uses one labeled contact sheet and a rejected config is not repaired', async t => {
  const { directory, phaseBudget } = await fixture(t);
  const media = syntheticMedia();
  const seen = [];
  const client = {
    async countInputTokens() { return 1000; },
    async respond(request) {
      seen.push(request.input[0].content.map(part => part.type).join(','));
      if (seen.length === 1) return samplingResponse({ sampledFrames: [14], spriteSeen: false, spriteBox: { x: 0, y: 0, width: 4, height: 4 }, inputSummary: 'no sprite' });
      assert.match(visibleRequestText(request), /image input/);
      assert.equal(request.input[0].content.some(part => part.type === 'input_video'), false);
      return candidateResponse({ ...SUPPLIED_DEFAULTS, walkingSpeed: 3 });
    },
  };
  const campaign = await runVideoCandidate({ directory, phaseBudget, client, media });
  assert.deepEqual(seen, ['input_text,input_video', 'input_text,input_image']);
  assert.equal(campaign.attempts.probe.localization, false);
  assert.equal(campaign.attempts.candidate.inputKind, 'image');
  assert.equal(campaign.attempts.candidate.rejection, 'config-mismatch');
  assert.equal(campaign.attempts.candidate.studyId ?? null, null);
  await assert.rejects(readFile(join(directory, 'fidelity-study', 'study.json')), error => error.code === 'ENOENT');
  await assert.rejects(readFile(join(directory, 'provenance.json')), error => error.code === 'ENOENT');
  await runVideoCandidate({ directory, phaseBudget, client: { countInputTokens: async () => { seen.push('retry'); }, respond: async () => { seen.push('retry'); } }, media });
  assert.equal(seen.includes('retry'), false);
});

test('an uncertain probe is retained and blocks the candidate and every later category', async t => {
  const { directory, phaseBudget } = await fixture(t);
  let calls = 0;
  const client = { async countInputTokens() { return 100; }, async respond() { calls++; throw Error('socket closed before a body'); } };
  const campaign = await runVideoCandidate({ directory, phaseBudget, client, media: syntheticMedia() });
  assert.equal(calls, 1);
  assert.equal(campaign.attempts.probe.status, 'failed');
  assert.equal(campaign.attempts.candidate.status, 'skipped');
  assert.equal(campaign.status, 'blocked');
  assert.equal((await phaseBudget.status()).uncertain, true);
  await runVideoCandidate({ directory, phaseBudget, client, media: syntheticMedia() });
  assert.equal(calls, 1);
  await assert.rejects(phaseBudget.reserve({ id: 'remix:blocked-by-video', category: 'remix', maxCostUsd: 0.05 }), /uncertain/);
});

test('a token preflight above the probe cap does not start generation or a second attempt', async t => {
  const { directory, phaseBudget } = await fixture(t);
  let responses = 0;
  const client = { async countInputTokens() { return 500_000; }, async respond() { responses++; } };
  const campaign = await runVideoCandidate({ directory, phaseBudget, client, media: syntheticMedia() });
  assert.equal(responses, 0);
  assert.match(campaign.attempts.probe.error, /no generation started/);
  assert.equal(campaign.attempts.candidate.status, 'skipped');
  assert.equal((await phaseBudget.status()).uncertain, false);
  assert.equal((await phaseBudget.status()).settledUsd, 0);
  await runVideoCandidate({ directory, phaseBudget, client, media: syntheticMedia() });
  assert.equal(responses, 0);
});

test('real donor video is the inline payload and the CLI will not create a ledger', { timeout: 180_000 }, async t => {
  const { directory, phaseBudget, root } = await fixture(t);
  const media = await renderFidelityMedia(join(root, 'rendered'));
  const hashes = [];
  const client = {
    async countInputTokens() { return 1000; },
    async respond(request) {
      const video = request.input[0].content.find(part => part.type === 'input_video');
      assert.equal(video.video_url.startsWith('data:video/mp4;base64,'), true);
      const bytes = Buffer.from(video.video_url.slice('data:video/mp4;base64,'.length), 'base64');
      hashes.push(sha256(bytes));
      assert.equal(visibleRequestText(request).includes('cooldownFresh'), false);
      assert.equal(visibleRequestText(request).includes('playerBox'), false);
      if (hashes.length === 1) {
        const frame = media.manifest.probe.frames.find(item => item.playerBox);
        return samplingResponse({ sampledFrames: [frame.frame], spriteSeen: true, spriteBox: frame.playerBox, inputSummary: 'buttons visible' });
      }
      return candidateResponse();
    },
  };
  const campaign = await runVideoCandidate({ directory, phaseBudget, client, media });
  assert.deepEqual(hashes, [sha256(media.probe.bytes), sha256(media.candidate.bytes)]);
  assert.equal(campaign.attempts.candidate.inputKind, 'video');
  assert.equal(campaign.attempts.probe.localization, true);
  await assert.rejects(main(['--out', directory, '--phase-ledger', join(root, 'missing-ledger')]), error => error.code === 'ENOENT');
  await main(['--help']);
});

test('the frozen study pairs the observed candidate with the immutable saved recovery', async t => {
  const { directory, phaseBudget } = await fixture(t);
  const component = await readFile(SAVED_RECOVERY.sourcePath, 'utf8');
  const contract = JSON.parse(await readFile(SAVED_RECOVERY.configPath, 'utf8'));
  const seen = [];
  const client = {
    async countInputTokens() { return 1000; },
    async respond(request) {
      seen.push(visibleRequestText(request));
      if (seen.length === 1) return samplingResponse({ sampledFrames: [14], spriteSeen: true, spriteBox: { x: 70, y: 74, width: 12, height: 12 }, inputSummary: 'X and R' });
      return candidateResponse();
    },
  };
  const campaign = await runVideoCandidate({ directory, phaseBudget, client, media: syntheticMedia() });
  assert.equal(seen.some(text => text.includes(component) || text.includes('components/dashy-dango-dash/component.ts')), false);
  const study = JSON.parse(await readFile(join(directory, 'fidelity-study', 'study.json'), 'utf8'));
  assert.equal(study.candidates.length, 2);
  assert.equal(Number.isSafeInteger(study.seed), true);
  assert.equal(await readFile(join(directory, 'fidelity-study', 'from-video.ts'), 'utf8'), source);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'fidelity-study', 'from-video.config.json'), 'utf8')), SUPPLIED_DEFAULTS);
  assert.equal(await readFile(join(directory, 'fidelity-study', 'saved-recovery.ts'), 'utf8'), component);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'fidelity-study', 'saved-recovery.config.json'), 'utf8')), contract.defaults);
  const provenance = JSON.parse(await readFile(join(directory, 'provenance.json'), 'utf8'));
  assert.equal(provenance.studyId, study.id);
  assert.equal(provenance.repairs, false);
  assert.equal(provenance.candidates[0].condition, 'video');
  assert.equal(provenance.candidates[0].parameterSource, 'supplied-public-contract');
  assert.deepEqual(provenance.candidates[0].defaults, SUPPLIED_DEFAULTS);
  assert.match(provenance.candidates[0].label, /not recovered from the pixels/);
  assert.equal(provenance.candidates[1].condition, 'saved-recovery');
  assert.equal(provenance.candidates[1].sourceFile, 'components/dashy-dango-dash/component.ts');
  assert.equal(provenance.candidates.some(item => item.condition === 'fresh-recovery'), false);
  assert.equal(campaign.attempts.candidate.comparison.observedCondition, 'video');
  await assert.rejects(readFile(join(directory, 'fidelity-study', 'results.json')), error => error.code === 'ENOENT');
});

test('an accepted contact sheet is frozen with the saved recovery and is not sent the saved source', async t => {
  const { directory, phaseBudget } = await fixture(t);
  const component = await readFile(SAVED_RECOVERY.sourcePath, 'utf8');
  const client = {
    async countInputTokens() { return 1000; },
    async respond(request) {
      assert.equal(visibleRequestText(request).includes(component), false);
      if (!request.input[0].content.some(part => part.type === 'input_image')) {
        return samplingResponse({ sampledFrames: [14], spriteSeen: false, spriteBox: { x: 0, y: 0, width: 4, height: 4 }, inputSummary: 'no sprite' });
      }
      return candidateResponse();
    },
  };
  const campaign = await runVideoCandidate({ directory, phaseBudget, client, media: syntheticMedia() });
  const study = JSON.parse(await readFile(join(directory, 'fidelity-study', 'study.json'), 'utf8'));
  assert.deepEqual(study.candidates.map(item => item.condition), ['contact-sheet', 'saved-recovery']);
  const provenance = JSON.parse(await readFile(join(directory, 'provenance.json'), 'utf8'));
  assert.equal(provenance.candidates[0].condition, 'contact-sheet');
  assert.equal(provenance.candidates[0].parameterSource, 'supplied-public-contract');
  assert.match(provenance.candidates[0].label, /not recovered from the pixels/);
  assert.equal(provenance.candidates[1].condition, 'saved-recovery');
  assert.equal(campaign.attempts.candidate.comparison.observedCondition, 'contact-sheet');
  assert.equal(await readFile(join(directory, 'fidelity-study', 'saved-recovery.ts'), 'utf8'), component);
});
