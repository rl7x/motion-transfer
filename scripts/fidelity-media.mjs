import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { renderFidelityMedia } from '../src/campaign/video-media.mjs';

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { out: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help || !values.out) {
    console.log('node scripts/fidelity-media.mjs --out <new-directory>');
    console.log('Renders the deterministic donor probe clip, candidate clip, and image-input contact sheet with ffmpeg. No network and no API key.');
    if (!values.out) return;
  }
  const media = await renderFidelityMedia(resolve(values.out));
  console.log(JSON.stringify({
    directory: media.directory,
    probe: { sha256: media.probe.videoSha256, bytes: media.probe.videoBytes, dashFrames: media.probe.dashFrames, hold: media.probe.hold, fps: media.probe.fps },
    candidate: { sha256: media.candidate.videoSha256, bytes: media.candidate.videoBytes, dashFrames: media.candidate.dashFrames, hold: media.candidate.hold, fps: media.candidate.fps },
    contactSheet: { sha256: media.contactSheet.sha256, labeled: media.contactSheet.labeled },
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(String(error.message).slice(0, 500)); process.exitCode = 1; });
}
