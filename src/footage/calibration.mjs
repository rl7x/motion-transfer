import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadTarget } from '../agent/target.mjs';
import { observeDonorMotion } from '../runtime/donor-observation.mjs';
import { BUTTONS, createReplayRuntime } from '../runtime/replay.mjs';
import { median } from './trajectory.mjs';

export const CLIP_SCALE = 4;
export const CLIP_SIZE = 160 * CLIP_SCALE;
/** The game starts on a title screen. This is the first frame of play. */
export const FIRST_PLAY_FRAME = 14;
/** The camera keeps the player here on screen. */
export const PLAYER_POINT = Object.freeze({ x: 322, y: 322 });

const { X, LEFT, RIGHT, UP, DOWN } = BUTTONS;

/** What a person might record: walking, dashing every way, standing dashes and holding the button. */
export function calibrationSteps() {
  const steps = [[X, 1], [0, 12]];
  for (const direction of [RIGHT, DOWN, LEFT, UP, RIGHT | DOWN, LEFT | UP, RIGHT | UP, LEFT | DOWN]) {
    steps.push([direction, 10], [direction | X, 1], [direction, 7], [0, 20]);
  }
  steps.push([0, 30], [X, 1], [0, 40], [X, 1], [0, 30]);
  steps.push([RIGHT | X, 100], [0, 10], [LEFT | X, 100], [0, 10], [DOWN | X, 100]);
  return steps;
}

const pixelsOf = bytes => {
  const pixels = new Uint8Array(160 * 160);
  for (let index = 0; index < pixels.length; index++) pixels[index] = (bytes[index >>> 2] >> ((index & 3) * 2)) & 3;
  return pixels;
};

/** Plays the real game and records its picture and, separately, the true position of each frame. */
export async function renderCalibrationClip(directory) {
  await mkdir(directory, { recursive: true });
  const target = await loadTarget();
  const runtime = await createReplayRuntime(target.bytes);
  const clip = join(directory, 'clip.mp4');
  const ffmpeg = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
    '-s', `${CLIP_SIZE}x${CLIP_SIZE}`, '-r', '60', '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '14',
    '-preset', 'veryfast', '-movflags', '+faststart', clip], { stdio: ['pipe', 'inherit', 'inherit'] });
  const finished = new Promise((resolve, reject) => ffmpeg.on('close', code => (code === 0 ? resolve() : reject(Error(`ffmpeg exited with ${code}`)))));
  const truth = [];
  for (const [buttons, count] of calibrationSteps()) for (let index = 0; index < count; index++) {
    runtime.step(buttons);
    let motion = null;
    try { motion = observeDonorMotion(runtime); } catch { motion = null; }
    truth.push({ frame: truth.length, x: motion?.position?.x ?? null, y: motion?.position?.y ?? null, remaining: motion?.remaining ?? null });
    const palette = runtime.observe().palette, pixels = pixelsOf(runtime.framebuffer.bytes);
    const rgb = Buffer.alloc(CLIP_SIZE * CLIP_SIZE * 3);
    for (let y = 0; y < CLIP_SIZE; y++) for (let x = 0; x < CLIP_SIZE; x++) {
      const color = palette[pixels[(y >> 2) * 160 + (x >> 2)]], at = (y * CLIP_SIZE + x) * 3;
      rgb[at] = color >> 16 & 255; rgb[at + 1] = color >> 8 & 255; rgb[at + 2] = color & 255;
    }
    if (!ffmpeg.stdin.write(rgb)) await new Promise(resolve => ffmpeg.stdin.once('drain', resolve));
  }
  ffmpeg.stdin.end();
  await finished;
  await writeFile(join(directory, 'truth.json'), JSON.stringify(truth));
  return { clip, truth };
}

/** How close the measured motion is to the game's true motion. Only possible when the truth is known. */
export function compareWithTruth(steps, truth) {
  const rows = steps.flatMap(step => {
    const after = truth[step.frame], before = truth[step.frame - 1];
    if (after?.x == null || before?.x == null) return [];
    const trueX = after.x - before.x, trueY = after.y - before.y;
    return [{ frame: step.frame, error: Math.hypot(step.x - trueX, step.y - trueY), speed: Math.hypot(trueX, trueY) }];
  });
  const summarize = group => ({
    steps: group.length, mean: Number((group.reduce((sum, row) => sum + row.error, 0) / (group.length || 1)).toFixed(4)),
    median: Number(median(group.map(row => row.error)).toFixed(4)), worst: Number(Math.max(0, ...group.map(row => row.error)).toFixed(3)),
  });
  return { all: summarize(rows), ordinary: summarize(rows.filter(row => row.speed <= 3)), bursts: summarize(rows.filter(row => row.speed > 3)) };
}

/** The bursts that really happened, read from the game's own state. */
export function trueBursts(truth) {
  const bursts = [];
  for (let index = 1; index < truth.length; index++) {
    const before = truth[index - 1], after = truth[index];
    if (before.x === null || after.x === null) continue;
    const speed = Math.hypot(after.x - before.x, after.y - before.y);
    if (speed <= 3) continue;
    const previous = bursts.at(-1);
    if (previous && previous.end === index - 1) { previous.end = index; previous.frames += 1; previous.distance += speed; }
    else bursts.push({ startFrame: index, end: index, frames: 1, distance: speed });
  }
  return bursts;
}
