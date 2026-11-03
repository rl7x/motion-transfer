import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { BUTTONS } from '../runtime/replay.mjs';
import { DONOR_SHA256 } from '../runtime/donor-observation.mjs';
import {
  buildContactSheet, captureClip, decodeRgbPng, lampLit, readCounter, renderFidelityMedia,
} from '../campaign/video-media.mjs';
import { main } from '../scripts/fidelity-media.mjs';

const exec = promisify(execFile);

test('donor frames show the frame counter, input lamps, and eight-tick dash', async () => {
  const first = await captureClip('probe');
  const second = await captureClip('probe');
  assert.equal(first.cartridgeSha256, DONOR_SHA256);
  assert.deepEqual(first.dashFrames, [14, 15, 16, 17, 18, 19, 20, 21]);
  assert.deepEqual(first.frames.map(frame => frame.compositeSha256), second.frames.map(frame => frame.compositeSha256));
  const dash = first.frames.find(frame => frame.frame === 14);
  assert.equal(dash.buttons, BUTTONS.RIGHT | BUTTONS.X);
  assert.equal(dash.ownsMotion, true);
  assert.equal(first.frames.filter(frame => frame.ownsMotion).length, 8);
  assert.ok(first.frames.some(frame => frame.playerBox));
  const decoded = decodeRgbPng(dash.png);
  assert.equal(readCounter(decoded.rgb, decoded.width), '0014');
  assert.equal(lampLit(decoded.rgb, 'X', decoded.width), true);
  assert.equal(lampLit(decoded.rgb, 'R', decoded.width), true);
  assert.equal(lampLit(decoded.rgb, 'L', decoded.width), false);
  assert.equal(lampLit(decoded.rgb, 'Z', decoded.width), false);
  let gameplay = false;
  for (let index = 0; index < decoded.width * 320 * 3; index += 3) {
    if (decoded.rgb[index] !== 0x12 || decoded.rgb[index + 1] !== 0x14 || decoded.rgb[index + 2] !== 0x1a) gameplay = true;
  }
  assert.equal(gameplay, true);
  const candidate = await captureClip('candidate');
  assert.deepEqual(candidate.dashFrames, [12, 13, 14, 15, 16, 17, 18, 19]);
  const sheet = buildContactSheet(candidate.frames);
  assert.equal(sheet.labeled, 'image-input');
  assert.equal(decodeRgbPng(sheet.png).width, 960);
});

test('ffmpeg encodes slowed probe and candidate clips without replacing existing media', { timeout: 180_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fidelity-media-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const media = await renderFidelityMedia(directory);
  assert.deepEqual(media.probe.dashFrames, [14, 15, 16, 17, 18, 19, 20, 21]);
  assert.equal(media.contactSheet.labeled, 'image-input');
  assert.ok(media.probe.bytes.length < 8_000_000);
  assert.ok(media.candidate.bytes.length < 8_000_000);
  const encoded = await exec('ffmpeg', ['-v', 'error', '-i', join(directory, 'probe.mp4'), '-vf', 'select=eq(n\\,16)', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer', maxBuffer: 2_000_000 });
  assert.equal(readCounter(encoded.stdout, 320), '0014');
  assert.equal(lampLit(encoded.stdout, 'X', 320), true);
  assert.equal(lampLit(encoded.stdout, 'R', 320), true);
  assert.equal(lampLit(encoded.stdout, 'L', 320), false);
  const probeDuration = Number((await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(directory, 'probe.mp4')])).stdout);
  const candidateDuration = Number((await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(directory, 'candidate.mp4')])).stdout);
  assert.ok(probeDuration > 9 && probeDuration < 11, `probe duration ${probeDuration}`);
  assert.ok(candidateDuration > 12 && candidateDuration < 14, `candidate duration ${candidateDuration}`);
  const saved = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  assert.equal(saved.localEvidenceOnly, true);
  assert.equal(saved.probe.videoSha256, media.probe.videoSha256);
  await assert.rejects(renderFidelityMedia(directory), /refusing to overwrite/);
  await main(['--help']);
});
