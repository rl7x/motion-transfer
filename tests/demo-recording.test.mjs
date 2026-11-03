import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { parseArgs } from '../demo/cli.mjs';
import { overlayFilter, probeVideo, runProcess, scrub, segmentArgs, writeCaption } from '../demo/compose.mjs';
import { loadDemoFacts } from '../demo/facts.mjs';
import { createReadOnlyRoadsterLab } from '../demo/read-only-lab.mjs';
import { assertCreationDisabled, startRecordingServer } from '../demo/server.mjs';
import { buildSrt, formatTimestamp } from '../demo/srt.mjs';
import { VIDEO_FPS, VIDEO_SECONDS, buildTimeline, resolveFreshAcceptance, resultsCopy } from '../demo/story.mjs';

const root = resolve(import.meta.dirname, '..');
const measurements = {
  baselineLandingX: -49.46847388339292,
  transferredLandingX: -41.37543628862018,
  netLandingShiftMeters: 8.09303759477274,
  targetMinX: -42.3,
  targetMaxX: -40.4,
  dashActiveUpdates: 8,
  dashMeters: 6,
};

function timelineText(timeline) {
  return timeline.flatMap(segment => [...(segment.lower ?? []), ...(segment.cues ?? []), ...(segment.corner ?? [])]).join('\n');
}

test('saved demo timeline is three minutes and does not claim a fresh result', async () => {
  const facts = await loadDemoFacts(root);
  assert.equal(facts.component.ticks, 6744);
  assert.equal(facts.component.maxPositionError, 0);
  assert.equal(facts.component.cost, '$0.28511425');
  assert.equal(facts.campaign.completedTasks, 2);
  assert.equal(facts.campaign.recoveryComplete, false);
  assert.equal(facts.campaign.noSubmittedCandidate, true);
  assert.equal(facts.laterTrials.passedAcceptance, false);
  assert.equal(facts.investigation.conclusionVerified, false);
  assert.equal(facts.investigation.model, 'muse-spark-1.3');
  assert.equal(facts.phase.ceiling, 45);
  const timeline = buildTimeline({ facts, measurements, remixAvailable: Boolean(facts.remix), donorDashVisible: true, pakuDashVisible: true });
  assert.equal(timeline.reduce((sum, segment) => sum + segment.seconds, 0), VIDEO_SECONDS);
  assert.equal(timeline.reduce((sum, segment) => sum + segment.frames, 0), VIDEO_SECONDS * VIDEO_FPS);
  const text = timelineText(timeline);
  assert.match(text, /-49\.47 m/);
  assert.match(text, /-41\.38 m/);
  assert.match(text, /6 m across 8 updates/);
  assert.match(text, /preservation hypothesis/);
  assert.doesNotMatch(text, /FRESH ACCEPTANCE|Muse Code|public url|on a phone|external creators|k\/10/i);
  const card = resultsCopy(facts).join('\n');
  assert.match(card, /\$0\.28511425/);
  assert.match(card, /\$0\.7299162/);
  assert.match(card, /\$0\.640187/);
  assert.match(card, /10\/13/);
  assert.match(card, /Not an acceptance/);
  assert.doesNotMatch(card, /FRESH ACCEPTANCE|Muse Code|public counts:/i);
  const srt = buildSrt(timeline);
  assert.match(srt, /^1\n00:00:00,000 -->/);
  assert.match(srt, /00:03:00,000\n/);
  assert.equal(formatTimestamp(65), '00:01:05,000');
});

test('fresh acceptance is explicit and fail-closed', async () => {
  const facts = await loadDemoFacts(root);
  const directory = await mkdtemp(join(tmpdir(), 'demo-fresh-'));
  try {
    const clip = join(directory, 'acceptance.webm');
    const file = join(directory, 'acceptance.json');
    await writeFile(clip, 'local-recording');
    await writeFile(file, JSON.stringify({
      accepted: true, trialId: 'trial-7', harness: 'in-app', componentId: 'ab'.repeat(32), clip,
    }));
    const fresh = resolveFreshAcceptance(file);
    const timeline = buildTimeline({ facts, measurements, remixAvailable: false, fresh });
    assert.match(timelineText(timeline), /FRESH ACCEPTANCE/);
    assert.match(timelineText(timeline), /trial-7/);
    assert.doesNotMatch(timelineText(timeline), /Muse Code/);
    await writeFile(file, JSON.stringify({ accepted: false, trialId: 'trial-7', harness: 'in-app', componentId: 'ab'.repeat(32), clip }));
    assert.throws(() => resolveFreshAcceptance(file), /not an acceptance/);
    await writeFile(file, JSON.stringify({
      accepted: true, trialId: 'trial-7', harness: 'muse-code', componentId: 'ab'.repeat(32), clip, publicUrl: 'https://example.test',
    }));
    assert.throws(() => resolveFreshAcceptance(file), /publicUrl/);
    await writeFile(file, JSON.stringify({
      accepted: true, trialId: 'trial-7', harness: 'in-app', componentId: 'ab'.repeat(32), clip: 'https://example.test/video.mp4',
    }));
    assert.throws(() => resolveFreshAcceptance(file), /local file/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('recording commands reject speed changes and secret-shaped logs', () => {
  assert.throws(() => segmentArgs({
    input: { kind: 'file', path: 'clip.webm' }, frames: 30, filter: 'setpts=0.5*PTS', output: 'out.mp4',
  }), /speed/);
  assert.equal(scrub('Authorization Bearer sk-live-secret and api_key=abc123'), 'Authorization Bearer [redacted] and api_key=[redacted]');
  assert.deepEqual(parseArgs(['render', '--fresh-acceptance', 'reports/demo/fresh.json']), {
    mode: 'render', out: 'reports/demo', fresh: 'reports/demo/fresh.json', headed: false,
  });
  assert.throws(() => parseArgs(['ship']), /Mode/);
});

test('read-only lab cannot submit and the preview refuses creation', { timeout: 180000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'demo-lab-'));
  const lab = createReadOnlyRoadsterLab(directory);
  assert.equal(lab.status().enabled, false);
  await assert.rejects(() => lab.submit(), /disables model creation/);
  await assert.rejects(() => lab.artifact('a'.repeat(64)));
  const server = await startRecordingServer(root);
  try {
    const status = await assertCreationDisabled(server.origin);
    assert.equal(status.remix, 503);
    assert.notEqual(status.investigation, 202);
    assert.notEqual(status.roadster, 202);
    const saved = await fetch(server.origin + '/api/investigations/saved/neutral-after-left');
    assert.equal(saved.status, 200);
    const job = await saved.json();
    assert.match(job.report.conclusion, /rejects preservation hypothesis/);
    assert.equal(job.report.model, 'muse-spark-1.3');
  } finally {
    await server.close();
  }
});

test('ffmpeg writes a two-second h264 segment with a lower third', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'demo-encode-'));
  try {
    const corner = join(directory, 'corner.txt');
    const lower = join(directory, 'lower.txt');
    await writeCaption(corner, ['HACKATHON', 'No new model request']);
    await writeCaption(lower, ['Same recorded stunt. This landing misses the zone.']);
    const output = join(directory, 'segment.mp4');
    const args = segmentArgs({
      input: { kind: 'lavfi', color: '0x203040', seconds: 2 },
      frames: 60,
      filter: overlayFilter({ cornerFile: corner, lowerFile: lower, seconds: 2, pad: true }),
      output,
    });
    assert.equal(args.includes('libx264'), true);
    assert.equal(args.includes('yuv420p'), true);
    await runProcess('ffmpeg', args);
    const probe = await probeVideo(output);
    assert.equal(probe.codec, 'h264');
    assert.equal(probe.pixFmt, 'yuv420p');
    assert.equal(probe.width, 1280);
    assert.equal(probe.height, 720);
    assert.equal(probe.frames, 60);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('recorder source does not load an API key or the live preview script', async () => {
  for (const path of [
    'scripts/record-demo.mjs', 'demo/capture.mjs', 'demo/render.mjs', 'demo/server.mjs', 'demo/facts.mjs',
  ]) {
    const source = await readFile(join(root, path), 'utf8');
    assert.doesNotMatch(source, /loadEnvFile|MODEL_API_KEY|scripts\/preview/);
  }
});
