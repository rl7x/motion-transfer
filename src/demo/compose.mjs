import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

export const FRAME = Object.freeze({ width: 1280, height: 720, fps: 30, seconds: 180 });
export const FONT = 'Arial, sans-serif';
export const CAPTION_BOX = Object.freeze({
  corner: { width: 720, height: 86, fontSize: 22 },
  lower: { width: 1280, height: 108, fontSize: 28 },
});

export function limitedEnv() {
  return {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    TMPDIR: process.env.TMPDIR ?? '',
    LANG: process.env.LANG ?? 'en_US.UTF-8',
  };
}

export function scrub(text) {
  return String(text)
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, '$1=[redacted]');
}

export function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: limitedEnv() });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        const error = Error(command + ' failed: ' + scrub(stderr).slice(-2000));
        error.stderr = scrub(stderr).slice(-4000);
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const body = Buffer.concat([name, data]);
  let crc = ~0;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(~crc >>> 0, 8 + data.length);
  return out;
}

export async function writeSolidPng(file, width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const row = Buffer.alloc(1 + width * 4);
  for (let x = 0; x < width; x += 1) {
    const offset = 1 + x * 4;
    row[offset] = rgba[0];
    row[offset + 1] = rgba[1];
    row[offset + 2] = rgba[2];
    row[offset + 3] = rgba[3];
  }
  const raw = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y += 1) row.copy(raw, y * row.length);
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  await writeFile(file, png);
}

export function overlayFilter({ start = 0, seconds, pad = false, lower = false }) {
  const prep = [];
  if (seconds != null) prep.push(`trim=start=${Number(start).toFixed(3)}:duration=${seconds}`, 'setpts=PTS-STARTPTS');
  prep.push('fps=30');
  if (pad) prep.push('tpad=stop_mode=clone:stop=-1');
  prep.push(
    `scale=${FRAME.width}:${FRAME.height}:force_original_aspect_ratio=decrease`,
    `pad=${FRAME.width}:${FRAME.height}:(ow-iw)/2:(oh-ih)/2:color=0x111315`,
    'setsar=1',
  );
  let chain = `[0:v]${prep.join(',')}[base];[base][1:v]overlay=20:20:format=auto`;
  if (lower) chain += `[withcorner];[withcorner][2:v]overlay=0:${FRAME.height - CAPTION_BOX.lower.height}:format=auto[out]`;
  else chain += '[out]';
  return chain;
}

export async function writeCaption(file, lines) {
  for (const line of lines) {
    if (line.length > 70 || /[%\\]/.test(line)) throw Error('Caption line cannot be drawn: ' + line);
  }
  await writeFile(file, lines.join('\n') + '\n');
}

export function segmentArgs({ input, frames, filter, images = [], output }) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  if (input.kind === 'lavfi') args.push('-f', 'lavfi', '-i', `color=c=${input.color}:s=${FRAME.width}x${FRAME.height}:r=30:d=${input.seconds}`);
  else if (input.kind === 'image') args.push('-loop', '1', '-framerate', '30', '-i', input.path);
  else args.push('-i', input.path);
  for (const image of images) args.push('-loop', '1', '-framerate', '30', '-i', image);
  args.push(
    '-filter_complex', filter,
    '-map', '[out]',
    '-frames:v', String(frames),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-r', '30',
    '-fps_mode', 'cfr',
    '-g', '30',
    '-keyint_min', '30',
    '-bf', '0',
    '-video_track_timescale', '30000',
    '-preset', 'veryfast',
    '-crf', '20',
    '-an',
    output,
  );
  if (args.some(arg => /setpts=(?!PTS-STARTPTS)/.test(arg) || /atempo|minterpolate/.test(arg))) {
    throw Error('Encoder args would change playback speed');
  }
  return args;
}

export async function probeDuration(file) {
  const stdout = await runProcess('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ]);
  return Number(stdout.trim());
}

export async function probeVideo(file) {
  const stdout = await runProcess('ffprobe', [
    '-v', 'error', '-count_frames', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,pix_fmt,width,height,nb_read_frames,avg_frame_rate',
    '-show_entries', 'format=duration,size', '-of', 'json', file,
  ]);
  const data = JSON.parse(stdout);
  const stream = data.streams[0];
  return {
    codec: stream.codec_name,
    pixFmt: stream.pix_fmt,
    width: stream.width,
    height: stream.height,
    frames: Number(stream.nb_read_frames),
    duration: Number(data.format.duration),
    size: Number(data.format.size),
  };
}

export async function ffmpegVersion() {
  const stdout = await runProcess('ffmpeg', ['-version']);
  return stdout.split('\n')[0];
}
