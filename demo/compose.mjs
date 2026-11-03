import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

export const FRAME = Object.freeze({ width: 1280, height: 720, fps: 30, seconds: 180 });
export const FONT = '/System/Library/Fonts/Supplemental/Arial.ttf';

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

function ffPath(file) {
  return `'${file.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:')}'`;
}

export function overlayFilter({ font = FONT, cornerFile, lowerFile, seconds, pad = false }) {
  const filters = [];
  if (seconds != null) filters.push(`trim=duration=${seconds}`, 'setpts=PTS-STARTPTS');
  filters.push('fps=30');
  if (pad) filters.push('tpad=stop_mode=clone:stop=-1');
  filters.push(
    `scale=${FRAME.width}:${FRAME.height}:force_original_aspect_ratio=decrease`,
    `pad=${FRAME.width}:${FRAME.height}:(ow-iw)/2:(oh-ih)/2:color=0x111315`,
    'setsar=1',
    'drawbox=x=20:y=20:w=720:h=86:color=0x111315@0.86:t=fill',
    `drawtext=fontfile=${ffPath(font)}:textfile=${ffPath(cornerFile)}:fontsize=22:fontcolor=0xF0ECE2:x=36:y=34:line_spacing=6`,
  );
  if (lowerFile) {
    filters.push(
      `drawbox=x=0:y=${FRAME.height - 108}:w=${FRAME.width}:h=108:color=0x111315@0.88:t=fill`,
      `drawtext=fontfile=${ffPath(font)}:textfile=${ffPath(lowerFile)}:fontsize=28:fontcolor=0xF0ECE2:x=40:y=${FRAME.height - 86}:line_spacing=8`,
    );
  }
  return filters.join(',');
}

export async function writeCaption(file, lines) {
  for (const line of lines) {
    if (line.length > 70 || /[%\\]/.test(line)) throw Error('Caption line cannot be drawn: ' + line);
  }
  await writeFile(file, lines.join('\n') + '\n');
}

export function segmentArgs({ input, start = 0, frames, filter, output }) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  if (input.kind === 'lavfi') args.push('-f', 'lavfi', '-i', `color=c=${input.color}:s=${FRAME.width}x${FRAME.height}:r=30:d=${input.seconds}`);
  else if (input.kind === 'image') args.push('-loop', '1', '-framerate', '30', '-i', input.path);
  else args.push('-i', input.path, '-ss', Number(start).toFixed(3));
  args.push(
    '-vf', filter,
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
