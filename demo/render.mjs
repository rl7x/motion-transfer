import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { closingCardHtml, resultsCardHtml } from './cards.mjs';
import {
  FONT, ffmpegVersion, overlayFilter, probeDuration, probeVideo, runProcess, scrub, segmentArgs, writeCaption,
} from './compose.mjs';
import { loadDemoFacts } from './facts.mjs';
import { buildSrt } from './srt.mjs';
import { VIDEO_FPS, VIDEO_SECONDS, buildTimeline, closingCopy, resolveFreshAcceptance, resultsCopy } from './story.mjs';

function shotFor(segment, capture, fresh) {
  if (segment.kind === 'card') return null;
  if (fresh && segment.clip === fresh.clip) return { file: fresh.clip, marks: {} };
  const shot = capture.shots[segment.clip];
  if (!shot?.file) throw Error('Capture is missing the shot for ' + segment.id);
  return shot;
}

async function segmentStart(segment, shot) {
  if (!shot) return 0;
  const duration = await probeDuration(shot.file);
  if (segment.window === 'end') return Math.max(0, duration - segment.seconds);
  if (segment.window === 'mark') return Math.max(0, (shot.marks?.[segment.mark] ?? 0) - 0.4);
  return Math.max(0, shot.marks?.content ?? 0);
}

async function shootCard(browser, html, png) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: png });
  } finally {
    await page.close();
  }
}

export async function renderDemo({ root, out, freshPath = null }) {
  const capturePath = join(out, 'capture.json');
  const capture = JSON.parse(await readFile(capturePath, 'utf8'));
  if (!capture.measurements?.ordinaryOutsideTarget || !capture.measurements?.borrowedInsideTarget) {
    throw Error('Capture does not record a miss and a borrowed landing');
  }
  const facts = await loadDemoFacts(root);
  const fresh = resolveFreshAcceptance(freshPath);
  const timeline = buildTimeline({
    facts,
    measurements: capture.measurements,
    remixAvailable: capture.remixAvailable === true,
    donorDashVisible: capture.donorDashVisible === true,
    pakuDashVisible: capture.shots?.paku?.dashVisible === true,
    fresh,
  });
  await mkdir(join(out, 'segments'), { recursive: true });
  await mkdir(join(out, 'text'), { recursive: true });
  await mkdir(join(out, 'cards'), { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || 'chrome',
    headless: true,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '' },
  });
  const commands = [];
  const segments = [];
  try {
    await shootCard(browser, resultsCardHtml(resultsCopy(facts, fresh)), join(out, 'cards', 'results.png'));
    await shootCard(browser, closingCardHtml(closingCopy()), join(out, 'cards', 'closing.png'));
  } finally {
    await browser.close();
  }
  for (const [index, segment] of timeline.entries()) {
    const cornerFile = join(out, 'text', segment.id + '-corner.txt');
    const lowerFile = segment.lower ? join(out, 'text', segment.id + '-lower.txt') : null;
    await writeCaption(cornerFile, segment.corner);
    if (lowerFile) await writeCaption(lowerFile, segment.lower);
    const shot = shotFor(segment, capture, fresh);
    const start = await segmentStart(segment, shot);
    const filter = overlayFilter({
      font: FONT,
      cornerFile,
      lowerFile,
      seconds: segment.kind === 'card' ? null : segment.seconds,
      pad: segment.kind !== 'card',
    });
    const input = segment.id === 'results'
      ? { kind: 'image', path: join(out, 'cards', 'results.png') }
      : segment.id === 'close'
        ? { kind: 'image', path: join(out, 'cards', 'closing.png') }
        : { kind: 'file', path: shot.file };
    const output = join(out, 'segments', String(index + 1).padStart(2, '0') + '-' + segment.id + '.mp4');
    const args = segmentArgs({ input, start, frames: segment.frames, filter, output });
    commands.push(['ffmpeg', ...args]);
    console.log('render ' + segment.id);
    await runProcess('ffmpeg', args);
    segments.push(output);
  }
  const list = join(out, 'segments', 'concat.txt');
  await writeFile(list, segments.map(file => `file '${file.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  const video = join(out, 'motion-transfer-demo.mp4');
  const concatArgs = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', video];
  commands.push(['ffmpeg', ...concatArgs]);
  await runProcess('ffmpeg', concatArgs);
  let probe = await probeVideo(video);
  let exactFrames = probe.frames === timeline.reduce((sum, segment) => sum + segment.frames, 0);
  if (!exactFrames) {
    const fixed = video + '.exact.mp4';
    const fixArgs = ['-y', '-hide_banner', '-loglevel', 'error', '-i', video, '-frames:v', String(VIDEO_SECONDS * VIDEO_FPS), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-an', '-movflags', '+faststart', fixed];
    commands.push(['ffmpeg', ...fixArgs]);
    await runProcess('ffmpeg', fixArgs);
    await rename(fixed, video);
    probe = await probeVideo(video);
    exactFrames = probe.frames === VIDEO_SECONDS * VIDEO_FPS;
  }
  if (probe.codec !== 'h264' || probe.pixFmt !== 'yuv420p' || probe.width !== 1280 || probe.height !== 720) {
    throw Error('Final video is not 1280x720 H.264 yuv420p');
  }
  if (!exactFrames || Math.abs(probe.duration - VIDEO_SECONDS) > 0.08) {
    throw Error('Final video is not 180 seconds (' + probe.duration + 's, ' + probe.frames + ' frames)');
  }
  const srt = buildSrt(timeline);
  const srtPath = join(out, 'motion-transfer-demo.srt');
  await writeFile(srtPath, srt);
  const provenance = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: fresh ? 'fresh-acceptance-substituted' : 'saved-playback',
    substitution: fresh ? { trialId: fresh.trialId, harness: fresh.harness, componentId: fresh.componentId, clip: fresh.clip, source: fresh.source } : null,
    localOrigin: capture.origin,
    note: 'Shot URLs were served by a local preview with model creation disabled. They are not public links.',
    video: { path: video, bytes: probe.size, durationSeconds: probe.duration, frames: probe.frames, codec: probe.codec, pixFmt: probe.pixFmt, width: probe.width, height: probe.height },
    srt: srtPath,
    ffmpeg: await ffmpegVersion(),
    font: FONT,
    commands: commands.map(command => command.map(scrub)),
    checks: {
      durationSeconds: probe.duration,
      frames: probe.frames,
      codec: probe.codec,
      pixFmt: probe.pixFmt,
      postsDuringCapture: 0,
      creationDisabled: capture.creation,
      ordinaryOutsideTarget: capture.measurements.ordinaryOutsideTarget,
      borrowedInsideTarget: capture.measurements.borrowedInsideTarget,
      freshAcceptance: Boolean(fresh),
      speedUnchanged: true,
    },
    measurements: capture.measurements,
    shots: Object.fromEntries(Object.entries(capture.shots).map(([name, shot]) => [name, {
      file: shot.file,
      urlPath: shot.urlPath,
      wallClockMs: shot.wallClockMs,
      artifactId: shot.artifactId ?? null,
      result: shot.result ?? null,
      external: shot.external ?? [],
      pageErrors: shot.pageErrors ?? [],
      framing: shot.framing ?? null,
    }])),
    claims: {
      componentId: facts.component.id,
      roadsterParentId: facts.roadsterParentId,
      remix: capture.remixAvailable ? facts.remix : null,
      investigation: facts.investigation,
      campaign: facts.campaign,
      laterTrials: facts.laterTrials,
      phase: facts.phase,
      donorDashVisible: capture.donorDashVisible === true,
      pakuDashVisible: capture.shots?.paku?.dashVisible === true,
    },
    caveats: [
      'Landings and other gameplay were not time-compressed. wallClockMs is the capture time, which can exceed game time when rendering is slow.',
      'One Roadster scene is recorded at a time. Pixel shots hide the donor and before cards so the transferred game fills the frame.',
      'The saved neutral-after-left conclusion is the model interpretation. conclusionVerified is false.',
      'No public player counts, phone capture, fidelity chart, or Muse Code session is in the default cut.',
      capture.remixAvailable ? 'The saved local remix is playback of an existing child. Launch was not required for the fresh-press label.' : 'The saved remix URL was unavailable, so the shot shows the remix form and does not generate.',
    ],
  };
  const provenancePath = join(out, 'provenance.json');
  await writeFile(provenancePath, JSON.stringify(provenance, null, 2) + '\n');
  return { video, srt: srtPath, provenance: provenancePath, probe };
}
