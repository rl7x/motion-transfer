import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cutSection, grayFrame, probeClip } from './clip.mjs';
import { gradeController } from './grade.mjs';
import { chooseLandmarks, findSprites, pointPrompt } from './landmarks.mjs';
import { footageRequest, readController } from './request.mjs';
import { parseTracks } from './sam.mjs';
import { detectBursts, motionSummary, shortestGap, splitBursts, staysOnScreen, worldSteps } from './trajectory.mjs';

export const RIGHTS = Object.freeze({
  own: 'This is my own game.',
  'open-license': 'This game is under an open license that allows this use.',
  permission: 'I have permission from the rights holder.',
});
// Landmarks scroll away fast during a dash, and SAM bills 50 frames per request at least.
const SECTION_FRAMES = 50;
const MAX_ATTEMPTS = 3;
const MINIMUM_FPS = 50;
const PLAYER_ID = 1;

/** Runs before anything else: no statement of rights, no recovery. */
export function checkRights({ rights, source }) {
  if (!Object.hasOwn(RIGHTS, rights)) throw Error(`--rights must be one of: ${Object.keys(RIGHTS).join(', ')}. Only use your own game, an openly licensed one, or one you have permission for.`);
  if (typeof source !== 'string' || source.trim().length < 3) throw Error('--source must say what the game is and who made it, so the result can credit it.');
}

export function checkClipPath(path) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) throw Error('Pass a local file. Recovery does not download clips from the web.');
  if (!existsSync(path)) throw Error(`${path} does not exist`);
}

/** Tracks the player and scenery through one short section. Objects seeded mid-section run both ways. */
async function trackSection({ clip, info, from, count, player, pixelScale, sam, work }) {
  const section = join(work, `section-${from}.mp4`);
  await cutSection(clip, { from, count, target: section });
  const middle = count >> 1;
  const gray = await grayFrame(section, middle, info);
  const landmarks = chooseLandmarks(findSprites(gray, info.width, info.height, { pixelScale }), { ...info, pixelScale, player });
  const points = [{ id: PLAYER_ID, frame: 0, ...player }, ...landmarks.map((landmark, index) => ({ id: index + 2, frame: middle, x: landmark.x, y: landmark.y }))];
  const { text, estimatedCostUsd } = await sam({ video: await readFile(section), prompt: pointPrompt(points, info), frames: count });
  const tracks = parseTracks(text);
  return { tracks, landmarks: landmarks.length, estimatedCostUsd };
}

async function measure({ clip, info, from, to, player, pixelScale, sam, work, log }) {
  const tracked = [], options = { ...info, pixelScale };
  let position = player, costUsd = 0;
  for (let start = from; start < to - 1; start += SECTION_FRAMES - 1) {
    const count = Math.min(SECTION_FRAMES, to - start);
    const { tracks, landmarks, estimatedCostUsd } = await trackSection({ clip, info, from: start, count, player: position, pixelScale, sam, work });
    costUsd += estimatedCostUsd;
    tracked.push({ tracks, start, count, landmarks });
    log(`Tracked frames ${start}-${start + count - 1}: ${tracks.size} objects from ${landmarks} landmarks`);
    const playerTrack = tracks.get(PLAYER_ID);
    const last = playerTrack?.get(Math.max(...(playerTrack?.keys() ?? [0])));
    if (!last) throw Error(`SAM lost the player in frames ${start}-${start + count - 1}. Try --player on a clearer frame.`);
    // A followed player doesn't move on screen, and a dash's afterimage would shift the box's center.
    if (!staysOnScreen(tracked.map(section => section.tracks.get(PLAYER_ID)), options)) {
      position = { x: Math.round((last.x1 + last.x2) / 2), y: Math.round((last.y1 + last.y2) / 2) };
    }
  }
  // The camera doesn't change mid-clip, so this is decided once, across every section.
  const followed = staysOnScreen(tracked.map(section => section.tracks.get(PLAYER_ID)), options);
  const steps = tracked.flatMap(({ tracks, start }) => worldSteps(tracks, { playerId: PLAYER_ID, ...options, frameOffset: start, followed }));
  const unique = [...new Map(steps.map(step => [step.frame, step])).values()].sort((a, b) => a.frame - b.frame);
  const sections = tracked.map(({ tracks, start, count, landmarks }) => ({ from: start, count, landmarks, objectsTracked: tracks.size }));
  return { steps: unique, sections, followed, costUsd };
}

/** The first thing wrong, in the form the model sees. It never contains the held-out bursts' numbers beyond the mismatch. */
const repairFeedback = (submission, grade) => ({
  instruction: 'Your controller failed a check against bursts you were not shown. Fix what failed and keep what works.',
  previous: { source: submission.source, config: submission.config },
  failed: grade.failures,
});

/**
 * Recovers a burst of motion from a clip, using only what the clip shows. `sam` tracks a section,
 * and `generate` makes one model request and returns { response, estimatedCostUsd }.
 */
export async function recoverMove({ clip, out, rights, source, player, pixelScale = 1, from = 0, to = null, sam, generate, model, modelName, log = () => {} }) {
  checkRights({ rights, source });
  checkClipPath(clip);
  if (existsSync(out) && (await readdir(out)).length > 0) throw Error(`${out} is not empty; choose a new --out`);
  const info = await probeClip(clip);
  if (info.fps < MINIMUM_FPS) throw Error(`This clip is ${info.fps} fps. A short burst needs ${MINIMUM_FPS} fps or more to measure, so record at 60.`);
  const last = Math.min(to ?? info.frames, info.frames);
  const work = await mkdtemp(join(tmpdir(), 'motion-footage-'));
  try {
    const { steps, sections, followed, costUsd: samUsd } = await measure({ clip, info, from, to: last, player, pixelScale, sam, work, log });
    const { bursts, walkSpeed } = detectBursts(steps);
    log(`Measured ${steps.length} frames with ${followed ? 'a follow' : 'a fixed'} camera: ${bursts.length} bursts, usual speed ${walkSpeed} pixels per frame`);
    if (bursts.length < 2) throw Error(`Found ${bursts.length} burst${bursts.length === 1 ? '' : 's'}. Recovery needs at least 2, so one can be held back as a check. Use a clip with the move used several times.`);
    const { practice, heldOut } = splitBursts(bursts);
    const gap = shortestGap(bursts);
    const measurements = motionSummary({ steps, bursts, walkSpeed, practice });
    const attempts = [];
    let feedback = null, accepted = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !accepted; attempt += 1) {
      log(`Asking ${modelName} for a controller (attempt ${attempt} of ${MAX_ATTEMPTS})`);
      const { response, estimatedCostUsd } = await generate(footageRequest({ model, measurements, feedback }), attempt);
      const record = { attempt, estimatedCostUsd, summary: null, failures: [] };
      attempts.push(record);
      let submission;
      try { submission = readController(response); }
      catch (error) { record.failures = [error.message]; log(`Attempt ${attempt} failed: ${error.message}`); continue; }
      record.summary = submission.summary;
      try {
        const grade = await gradeController({ source: submission.source, config: submission.config, heldOut, gap });
        Object.assign(record, { bursts: grade.bursts, recharge: grade.recharge, failures: grade.failures, passed: grade.passed });
        if (grade.passed) accepted = { submission, grade };
        else { feedback = repairFeedback(submission, grade); log(`Attempt ${attempt} failed: ${grade.failures[0]}`); }
      } catch (error) {
        record.failures = [error.message];
        feedback = { instruction: 'Your controller could not run.', previous: { source: submission.source, config: submission.config }, failed: [error.message] };
        log(`Attempt ${attempt} failed: ${error.message}`);
      }
    }
    const modelUsd = attempts.reduce((sum, attempt) => sum + attempt.estimatedCostUsd, 0);
    if (!accepted) throw Error(`No controller matched the held-out bursts after ${attempts.length} attempts ($${(samUsd + modelUsd).toFixed(4)} estimated): ${attempts.at(-1).failures[0]}`);
    const { submission, grade } = accepted;
    const contract = {
      name: 'Motion recovered from footage', defaults: submission.config, label: 'footage match',
      scope: 'Matches how a move travels in one clip. This is not a recovery of the game\'s code or its hidden rules, and it has not been checked against the game itself.',
    };
    const id = createHash('sha256').update(grade.compiled.javascript).digest('hex');
    const clipSha256 = createHash('sha256').update(await readFile(clip)).digest('hex');
    const provenance = {
      id, label: 'footage match', recoveredAt: new Date().toISOString(),
      rights: { basis: rights, statement: RIGHTS[rights], source: source.trim(), note: 'This records what the person running the tool stated. It was not verified.' },
      clip: { sha256: clipSha256, frames: info.frames, fps: info.fps, note: 'The clip itself is not kept. Only this hash and the motion numbers are.' },
      models: { tracking: 'sam-3.1', controller: modelName },
    };
    const report = { label: 'footage match', camera: followed ? 'follows the player' : 'fixed', measurements, heldOut: { bursts: grade.bursts, recharge: grade.recharge }, sections, attempts, estimatedCostUsd: { tracking: samUsd, controller: modelUsd, total: samUsd + modelUsd } };
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'component.ts'), submission.source);
    await writeFile(join(out, 'component.js'), grade.compiled.javascript);
    await writeFile(join(out, 'contract.json'), JSON.stringify(contract, null, 2) + '\n');
    await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    await writeFile(join(out, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
    return { out, id, submission, report, provenance, steps, bursts };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
