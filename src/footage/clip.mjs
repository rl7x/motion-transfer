import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const MEGABYTES = 1024 * 1024;

/** Reads the clip's size, frame rate and length. */
export async function probeClip(path) {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=width,height,r_frame_rate,nb_read_frames', '-of', 'json', path], { maxBuffer: MEGABYTES });
  const stream = JSON.parse(stdout).streams?.[0];
  if (!stream) throw Error(`${path} has no video stream`);
  const [top, bottom] = stream.r_frame_rate.split('/').map(Number);
  return { width: stream.width, height: stream.height, fps: top / bottom, frames: Number(stream.nb_read_frames) };
}

/** One frame as grayscale bytes, used only to choose landmarks. It's never saved or sent anywhere. */
export async function grayFrame(path, frame, { width, height }) {
  const { stdout } = await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path, '-vf', `select=eq(n\\,${frame})`, '-vsync', '0',
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { encoding: 'buffer', maxBuffer: width * height + MEGABYTES });
  if (stdout.length < width * height) throw Error(`Frame ${frame} could not be read`);
  return stdout;
}

/** Cuts a frame-accurate section for one SAM request. */
export async function cutSection(path, { from, count, target }) {
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path,
    '-vf', `select=between(n\\,${from}\\,${from + count - 1}),setpts=N/FRAME_RATE/TB`, '-vsync', '0', '-an',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '14', '-preset', 'veryfast', '-movflags', '+faststart', target], { maxBuffer: MEGABYTES });
}
