import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { deflateSync, inflateSync } from 'node:zlib';
import { loadTarget } from '../agent/target.mjs';
import { digest } from '../component/build.mjs';
import { DONOR_SHA256, observeDonorMotion } from '../runtime/donor-observation.mjs';
import { framebufferPng } from '../runtime/png.mjs';
import { BUTTONS, createReplayRuntime } from '../runtime/replay.mjs';

const exec = promisify(execFile);
const SCALE = 2;
const BANNER = 44;
export const MEDIA_WIDTH = 160 * SCALE;
export const MEDIA_HEIGHT = 160 * SCALE + BANNER;
export const PROBE_FPS = 8;
export const PROBE_HOLD = 8;
export const CANDIDATE_FPS = 8;
export const CANDIDATE_HOLD = 4;

/** Lamps drawn on every captured frame. The letters match the disclosed button bits. */
export const INPUT_LAMPS = Object.freeze([
  { name: 'X', bit: BUTTONS.X },
  { name: 'Z', bit: BUTTONS.Z },
  { name: 'L', bit: BUTTONS.LEFT },
  { name: 'R', bit: BUTTONS.RIGHT },
  { name: 'U', bit: BUTTONS.UP },
  { name: 'D', bit: BUTTONS.DOWN },
]);

const FONT = Object.freeze({
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['01110', '10001', '00001', '00110', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  X: ['10001', '01010', '00100', '00100', '00100', '01010', '10001'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
});

const COLORS = Object.freeze({
  banner: 0x12141a, text: 0xf4f4f5, on: 0x39d353, off: 0x2a2a2a, rule: 0xf4f4f5,
});

export function overlayLayout() {
  const counter = { x: 8, y: 160 * SCALE + 12, scale: 2, digits: 4, advance: 12 };
  const lamps = INPUT_LAMPS.map((lamp, index) => ({
    ...lamp, x: 76 + index * 40, y: 160 * SCALE + 14, size: 14,
    labelX: 76 + index * 40 + 16, labelY: 160 * SCALE + 16,
  }));
  return { width: MEDIA_WIDTH, height: MEDIA_HEIGHT, gameHeight: 160 * SCALE, counter, lamps };
}

const crc32 = bytes => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (kind, bytes) => {
  const type = Buffer.from(kind), header = Buffer.alloc(4), checksum = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, bytes])));
  return Buffer.concat([header, type, bytes, checksum]);
};

export function encodeRgbPng(width, height, rgb) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) {
    throw Error('PNG dimensions are out of range');
  }
  if (rgb.length !== width * height * 3) throw Error('RGB buffer size mismatch');
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (1 + width * 3) + 1, y * width * 3, (y + 1) * width * 3);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export function decodeRgbPng(png) {
  if (png[0] !== 137 || png.toString('ascii', 1, 4) !== 'PNG') throw Error('Expected a PNG');
  let offset = 8, width = 0, height = 0, compressed = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 2) throw Error('Only 8-bit RGB PNGs can be decoded');
    } else if (type === 'IDAT') compressed.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(compressed));
  const rgb = Buffer.alloc(width * height * 3);
  let cursor = 0;
  for (let y = 0; y < height; y++) {
    if (raw[cursor] !== 0) throw Error('Unexpected PNG row filter');
    cursor += 1;
    raw.copy(rgb, y * width * 3, cursor, cursor + width * 3);
    cursor += width * 3;
  }
  return { width, height, rgb };
}

function setPixel(rgb, width, x, y, color) {
  if (x < 0 || y < 0 || x >= width) return;
  const index = (y * width + x) * 3;
  rgb[index] = (color >>> 16) & 255; rgb[index + 1] = (color >>> 8) & 255; rgb[index + 2] = color & 255;
}
function drawGlyph(rgb, width, x, y, char, scale, color) {
  const rows = FONT[char];
  if (!rows) throw Error('Missing overlay glyph');
  rows.forEach((row, rowIndex) => {
    for (let column = 0; column < 5; column++) if (row[column] === '1') {
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) setPixel(rgb, width, x + column * scale + dx, y + rowIndex * scale + dy, color);
    }
  });
}
function indexedPixels(bytes) {
  const pixels = new Uint8Array(160 * 160);
  for (let index = 0; index < pixels.length; index++) pixels[index] = (bytes[index >>> 2] >> ((index & 3) * 2)) & 3;
  return pixels;
}
function playerBox(previous, current, shiftX) {
  if (!previous || !current) return null;
  const shift = Math.max(-24, Math.min(24, Math.round(shiftX)));
  let minX = 160, minY = 160, maxX = -1, maxY = -1, count = 0;
  for (let y = 8; y < 152; y++) for (let x = 8; x < 140; x++) {
    const sourceX = x + shift;
    if (sourceX < 0 || sourceX >= 160) continue;
    if (current[y * 160 + x] !== previous[y * 160 + sourceX]) {
      count++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (count < 8 || count > 100 || maxX - minX > 40 || maxY - minY > 40) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function compositeFrame({ framebuffer, palette, frame, buttons }) {
  if (!Number.isInteger(frame) || frame < 0 || frame > 9999) throw Error('Frame counter must be four digits');
  if (!Number.isInteger(buttons) || buttons < 0 || buttons > 255) throw Error('Invalid overlay buttons');
  const layout = overlayLayout();
  const rgb = Buffer.alloc(layout.width * layout.height * 3);
  for (let index = 0; index < rgb.length; index += 3) {
    rgb[index] = (COLORS.banner >>> 16) & 255; rgb[index + 1] = (COLORS.banner >>> 8) & 255; rgb[index + 2] = COLORS.banner & 255;
  }
  for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) {
    const pixel = y * 160 + x;
    const color = palette[(framebuffer[pixel >>> 2] >> ((pixel & 3) * 2)) & 3];
    for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) setPixel(rgb, layout.width, x * SCALE + dx, y * SCALE + dy, color);
  }
  for (let x = 0; x < layout.width; x++) {
    setPixel(rgb, layout.width, x, layout.gameHeight, COLORS.rule);
    setPixel(rgb, layout.width, x, layout.gameHeight + 1, COLORS.rule);
  }
  const digits = String(frame).padStart(layout.counter.digits, '0');
  for (let index = 0; index < digits.length; index++) {
    drawGlyph(rgb, layout.width, layout.counter.x + index * layout.counter.advance, layout.counter.y, digits[index], layout.counter.scale, COLORS.text);
  }
  for (const lamp of layout.lamps) {
    const color = buttons & lamp.bit ? COLORS.on : COLORS.off;
    for (let y = 0; y < lamp.size; y++) for (let x = 0; x < lamp.size; x++) setPixel(rgb, layout.width, lamp.x + x, lamp.y + y, color);
    drawGlyph(rgb, layout.width, lamp.labelX, lamp.labelY, lamp.name, 1, COLORS.text);
  }
  return { rgb, width: layout.width, height: layout.height, png: encodeRgbPng(layout.width, layout.height, rgb) };
}

export function readCounter(rgb, width = MEDIA_WIDTH) {
  const { counter } = overlayLayout();
  let text = '';
  for (let index = 0; index < counter.digits; index++) {
    const x = counter.x + index * counter.advance;
    const bits = [];
    for (let row = 0; row < 7; row++) for (let column = 0; column < 5; column++) {
      const pixel = ((counter.y + row * counter.scale) * width + (x + column * counter.scale)) * 3;
      bits.push(rgb[pixel] > 200 ? '1' : '0');
    }
    const key = bits.join('');
    const digit = Object.entries(FONT).find(([, rows]) => rows.join('') === key)?.[0];
    text += digit ?? '?';
  }
  return text;
}

export function lampLit(rgb, name, width = MEDIA_WIDTH) {
  const lamp = overlayLayout().lamps.find(item => item.name === name);
  const pixel = ((lamp.y + 4) * width + (lamp.x + 4)) * 3;
  // Green stays distinct after yuv420 compression; the off lamp is neutral gray.
  return rgb[pixel + 1] > 150 && rgb[pixel + 1] > rgb[pixel] + 40;
}

const CLIP_STEPS = Object.freeze({
  probe: [
    { buttons: BUTTONS.X, frames: 1, encode: false },
    { buttons: 0, frames: 10, encode: false },
    { buttons: BUTTONS.RIGHT, frames: 2, encode: true },
    { buttons: BUTTONS.RIGHT | BUTTONS.X, frames: 1, encode: true },
    { buttons: BUTTONS.RIGHT, frames: 7, encode: true },
  ],
  candidate: [
    { buttons: BUTTONS.X, frames: 1, encode: true },
    { buttons: BUTTONS.RIGHT, frames: 10, encode: true },
    { buttons: BUTTONS.RIGHT | BUTTONS.X, frames: 1, encode: true },
    { buttons: BUTTONS.RIGHT, frames: 7, encode: true },
    { buttons: 0, frames: 3, encode: true },
    { buttons: BUTTONS.UP, frames: 4, encode: true },
  ],
});

export async function captureClip(kind) {
  const steps = CLIP_STEPS[kind];
  if (!steps) throw Error('Unknown fidelity clip');
  const target = await loadTarget();
  if (target.sha256 !== DONOR_SHA256) throw Error('Donor cartridge hash mismatch');
  const runtime = await createReplayRuntime(target.bytes);
  let previousMotion = null, previousPixels = null;
  const frames = [];
  const step = buttons => {
    const before = previousMotion;
    runtime.step(buttons);
    let motion = null;
    try { motion = observeDonorMotion(runtime); } catch { motion = null; }
    const pixels = indexedPixels(runtime.framebuffer.bytes);
    const shift = before && motion ? motion.position.x - before.position.x : 0;
    const ownsMotion = Boolean(before && motion && (before.remaining > 0 || (before.remaining <= 0 && motion.remaining > 0)));
    const native = framebufferPng(runtime.framebuffer.bytes, runtime.observe().palette);
    const composite = compositeFrame({ framebuffer: runtime.framebuffer.bytes, palette: runtime.observe().palette, frame: runtime.frame, buttons });
    frames.push({
      frame: runtime.frame, buttons, ownsMotion, encoded: false,
      playerBox: playerBox(previousPixels, pixels, shift),
      palette: runtime.observe().palette, pixels, native, composite,
    });
    previousMotion = motion;
    previousPixels = pixels;
  };
  for (const group of steps) for (let index = 0; index < group.frames; index++) {
    step(group.buttons);
    frames.at(-1).encoded = group.encode;
  }
  const encoded = frames.filter(frame => frame.encoded).map(frame => ({
    frame: frame.frame, buttons: frame.buttons, ownsMotion: frame.ownsMotion, playerBox: frame.playerBox,
    palette: frame.palette, pixels: frame.pixels,
    png: frame.composite.png, compositeSha256: digest(frame.composite.png), nativeSha256: digest(frame.native),
  }));
  return {
    kind, cartridgeSha256: target.sha256,
    fps: kind === 'probe' ? PROBE_FPS : CANDIDATE_FPS,
    hold: kind === 'probe' ? PROBE_HOLD : CANDIDATE_HOLD,
    frames: encoded,
    dashFrames: encoded.filter(frame => frame.ownsMotion).map(frame => frame.frame),
  };
}

function sheetCell(frame, rgb, width, originX, originY) {
  const label = String(frame.frame).padStart(4, '0');
  for (let index = 0; index < label.length; index++) drawGlyph(rgb, width, originX + 2 + index * 8, originY + 1, label[index], 1, COLORS.text);
  INPUT_LAMPS.forEach((lamp, index) => {
    const color = frame.buttons & lamp.bit ? COLORS.on : COLORS.off;
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) setPixel(rgb, width, originX + 40 + index * 18 + x, originY + 5 + y, color);
  });
  for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) {
    const color = frame.palette[frame.pixels[y * 160 + x]];
    setPixel(rgb, width, originX + x, originY + 16 + y, color);
  }
}

export function buildContactSheet(frames) {
  const columns = 6, label = 16, cellWidth = 160, cellHeight = label + 160;
  const rows = Math.ceil(frames.length / columns);
  const width = columns * cellWidth, height = rows * cellHeight;
  const rgb = Buffer.alloc(width * height * 3, 18);
  frames.forEach((frame, index) => sheetCell(frame, rgb, width, (index % columns) * cellWidth, Math.floor(index / columns) * cellHeight));
  const png = encodeRgbPng(width, height, rgb);
  return { png, width, height, columns, rows, sha256: digest(png), labeled: 'image-input' };
}

async function encodeVideo(frames, { fps, hold, destination }) {
  if (MEDIA_WIDTH % 2 || MEDIA_HEIGHT % 2) throw Error('Video dimensions must be even');
  const scratch = await mkdtemp(join(tmpdir(), 'fidelity-frames-'));
  try {
    let index = 1;
    for (const frame of frames) for (let repeat = 0; repeat < hold; repeat++, index++) {
      await writeFile(join(scratch, `frame-${String(index).padStart(4, '0')}.png`), frame.png);
    }
    await exec('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(fps),
      '-i', join(scratch, 'frame-%04d.png'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'veryfast',
      '-movflags', '+faststart', destination,
    ], { timeout: 120_000 });
  } finally { await rm(scratch, { recursive: true, force: true }); }
  const bytes = await readFile(destination);
  return { bytes, sha256: digest(bytes) };
}

function publishedFrames(frames) {
  return frames.map(frame => ({
    frame: frame.frame, buttons: frame.buttons, ownsMotion: frame.ownsMotion,
    playerBox: frame.playerBox, compositeSha256: frame.compositeSha256,
  }));
}

/** Render the probe clip, the candidate clip, and the image-input contact sheet. No network. */
export async function renderFidelityMedia(directory) {
  await mkdir(directory, { recursive: true });
  const manifestPath = join(directory, 'manifest.json');
  try {
    await readFile(manifestPath);
    throw Error('Fidelity media already exists; refusing to overwrite rendered evidence');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const probe = await captureClip('probe');
  const candidate = await captureClip('candidate');
  if (probe.dashFrames.length !== 8 || candidate.dashFrames.length !== 8) throw Error('Donor clip did not contain the 8-tick dash');
  const sheet = buildContactSheet(candidate.frames);
  const probeVideo = await encodeVideo(probe.frames, { fps: probe.fps, hold: probe.hold, destination: join(directory, 'probe.mp4') });
  const candidateVideo = await encodeVideo(candidate.frames, { fps: candidate.fps, hold: candidate.hold, destination: join(directory, 'candidate.mp4') });
  await writeFile(join(directory, 'contact-sheet.png'), sheet.png, { flag: 'wx' });
  const manifest = {
    schemaVersion: 1, kind: 'fidelity-donor-media', cartridgeSha256: probe.cartridgeSha256,
    localEvidenceOnly: true,
    note: 'Frame observations in this manifest are local audit data. Do not paste them into a model prompt.',
    overlay: { scale: SCALE, counterDigits: 4, lamps: INPUT_LAMPS.map(lamp => ({ name: lamp.name, bit: lamp.bit })) },
    probe: {
      fps: probe.fps, hold: probe.hold, dashFrames: probe.dashFrames, videoFile: 'probe.mp4',
      videoSha256: probeVideo.sha256, videoBytes: probeVideo.bytes.length, frames: publishedFrames(probe.frames),
    },
    candidate: {
      fps: candidate.fps, hold: candidate.hold, dashFrames: candidate.dashFrames, videoFile: 'candidate.mp4',
      videoSha256: candidateVideo.sha256, videoBytes: candidateVideo.bytes.length, frames: publishedFrames(candidate.frames),
    },
    contactSheet: {
      file: 'contact-sheet.png', sha256: sheet.sha256, bytes: sheet.png.length,
      columns: sheet.columns, rows: sheet.rows, labeled: 'image-input',
    },
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return {
    directory, manifest,
    probe: { ...manifest.probe, bytes: probeVideo.bytes },
    candidate: { ...manifest.candidate, bytes: candidateVideo.bytes },
    contactSheet: { ...manifest.contactSheet, bytes: sheet.png },
  };
}
