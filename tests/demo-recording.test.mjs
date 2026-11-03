import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { assertAcceptedProof, loadAcceptedRoadster } from '../demo/accepted-roadster.mjs';
import { parseArgs } from '../demo/cli.mjs';
import { SAVED_REMIX_ID, materializeCommittedRemix, remixRecordFromEvidence } from '../demo/committed-remix.mjs';
import { overlayFilter, probeVideo, runProcess, scrub, segmentArgs, writeCaption, writeSolidPng } from '../demo/compose.mjs';
import { loadDemoFacts } from '../demo/facts.mjs';
import { createReadOnlyRoadsterLab } from '../demo/read-only-lab.mjs';
import { assertCreationDisabled, startRecordingServer } from '../demo/server.mjs';
import { buildSrt, formatTimestamp } from '../demo/srt.mjs';
import { VIDEO_FPS, VIDEO_SECONDS, acceptedResultsLines, buildAcceptedTimeline, buildTimeline, resolveFreshAcceptance, resultsCopy } from '../demo/story.mjs';
import { readRoadsterArtifact } from '../roadster/artifact.mjs';

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
  assert.equal(facts.phase.present, true);
  assert.equal(facts.phase.quoted, false);
  assert.equal(facts.phase.onDiskName, 'motion-transfer-additional-inference-v2');
  assert.equal(facts.phase.onDiskCeiling, 50);
  assert.equal(facts.phase.historicalSpendingIncluded, false);
  assert.equal(facts.phase.ceiling, null);
  assert.deepEqual(facts.phase.reservations, []);
  assert.equal(facts.remix?.id, SAVED_REMIX_ID);
  assert.equal(facts.remix.parentId, facts.roadsterParentId);
  assert.ok(facts.component.humanAssistance.includes('Mapped live registry and numeric state fields'));
  const timeline = buildTimeline({ facts, measurements, remixAvailable: Boolean(facts.remix), donorDashVisible: true, pakuDashVisible: true });
  assert.equal(timeline.reduce((sum, segment) => sum + segment.seconds, 0), VIDEO_SECONDS);
  assert.equal(timeline.reduce((sum, segment) => sum + segment.frames, 0), VIDEO_SECONDS * VIDEO_FPS);
  const text = timelineText(timeline);
  assert.match(text, /-49\.47 m/);
  assert.match(text, /-41\.38 m/);
  assert.match(text, /6 m across 8 updates/);
  assert.match(text, /preservation hypothesis/);
  assert.match(text, /host mapped the boundary/);
  assert.match(text, /Committed child/);
  assert.doesNotMatch(text, /FRESH ACCEPTANCE|Muse Code|public url|on a phone|external creators|k\/10/i);
  const card = resultsCopy(facts).join('\n');
  assert.match(card, /\$0\.28511425/);
  assert.match(card, /\$0\.7299162/);
  assert.match(card, /\$0\.640187/);
  assert.match(card, /10\/13/);
  assert.match(card, /Not an acceptance/);
  assert.match(card, /not quoted/);
  assert.doesNotMatch(card, /\$45|\$50|0\.018217438/);
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

test('a present phase journal is quoted and a tampered remix is rejected', async () => {
  const card = resultsCopy({
    component: {
      id: 'ab'.repeat(32), cost: '$1', requests: 1, development: 1, regression: 1, acceptance: 1, tickLabel: '1', maxPositionError: 0,
    },
    campaign: { completedTasks: 0, attemptedTasks: 1, cost: '$0', noSubmittedCandidate: true },
    laterTrials: { cost: '$0', peak: '0/13' },
    phase: {
      present: true,
      quoted: true,
      ceiling: 45,
      reservations: [{ category: 'recovery', status: 'uncertain', cap: 0.5, estimate: 0.01 }],
    },
  }).join('\n');
  assert.match(card, /Budget ceiling \$45/);
  assert.match(card, /cap \$0\.50/);
  assert.match(card, /Not an acceptance/);
  const directory = await mkdtemp(join(tmpdir(), 'demo-remix-'));
  try {
    const remix = await materializeCommittedRemix(root, directory);
    const artifact = await readRoadsterArtifact(directory, remix.id);
    assert.equal(artifact.id, SAVED_REMIX_ID);
    assert.equal(artifact.intent.activation, 'press');
    assert.equal(artifact.intent.direction, 'opposite');
    assert.equal(artifact.intent.unitScale, 0.05);
    assert.match(artifact.summary, /3m backward/i);
    const evidence = JSON.parse(await readFile(join(root, remix.source), 'utf8'));
    const tampered = {
      ...evidence,
      files: { ...evidence.files, 'notices.txt': evidence.files['notices.txt'] + '\n' },
    };
    assert.equal(remixRecordFromEvidence(tampered), null);
    assert.equal(remixRecordFromEvidence({ ...evidence, id: 'ab'.repeat(32) }), null);
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
    mode: 'render', out: 'reports/demo', fresh: 'reports/demo/fresh.json', headed: false, accepted: false,
  });
  assert.deepEqual(parseArgs(['capture', '--accepted-roadster']), {
    mode: 'capture', out: 'reports/demo-accepted', fresh: null, headed: false, accepted: true,
  });
  assert.throws(() => parseArgs(['render', '--accepted-roadster', '--out', 'reports/demo']), /cannot overwrite/);
  assert.throws(() => parseArgs(['--accepted-roadster', '--fresh-acceptance', 'reports/demo/fresh.json']), /does not use/);
  assert.throws(() => parseArgs(['ship']), /Mode/);
});

test('accepted roadster proof is pinned to files, not an accepted flag', async () => {
  const proof = await loadAcceptedRoadster(root);
  assert.equal(proof.liveMeta, true);
  assert.equal(proof.fixture, false);
  assert.equal(proof.injected, false);
  assert.equal(proof.adapterCostUsd, 0.008666);
  assert.equal(proof.wonder.costUsd, 1.689036);
  assert.deepEqual(proof.wonder.development, ['0/13', '11/13', '13/13']);
  assert.equal(proof.wonder.acceptance, '20/20');
  assert.equal(proof.wonder.acceptedDeliveries, 0);
  assert.equal(proof.wonder.failureCategory, 'recipient-or-export');
  assert.equal(proof.wonder.offlineDelivery, true);
  assert.equal(proof.wonder.metaCalled, false);
  assert.equal(proof.fidelity.inputKind, 'image');
  assert.equal(proof.fidelity.contactPassed, 0);
  assert.equal(proof.fidelity.savedPassed, 40);
  assert.equal(proof.fidelity.costUsd, 0.02293425);
  assert.equal(proof.remixCampaign.completed, 8);
  assert.equal(proof.remixCampaign.matched, 6);
  assert.equal(proof.remixCampaign.negatives, 2);
  assert.equal(proof.remixCampaign.costUsd, 0.06688125);
  assert.notEqual(proof.remixCampaign.olderComponentId, proof.componentId);
  assert.throws(() => assertAcceptedProof({ accepted: true }), /accepted flag/);
  assert.throws(() => assertAcceptedProof({ ...proof, reportSha256: 'ab'.repeat(32) }), /report/);
  assert.throws(() => assertAcceptedProof({ ...proof, remixCampaign: { ...proof.remixCampaign, olderComponentId: proof.componentId } }), /older saved component/);
  const timeline = buildAcceptedTimeline({ proof, measurements, donorDashVisible: true });
  assert.equal(timeline.reduce((sum, segment) => sum + segment.seconds, 0), VIDEO_SECONDS);
  const text = timelineText(timeline) + '\n' + acceptedResultsLines(proof).join('\n');
  assert.match(text, /9699b756/);
  assert.match(text, /0\/13/);
  assert.match(text, /11\/13/);
  assert.match(text, /13\/13/);
  assert.match(text, /20\/20/);
  assert.match(text, /\$1\.689036/);
  assert.match(text, /\$0\.008666/);
  assert.match(text, /\$0\.02293425/);
  assert.match(text, /\$0\.06688125/);
  assert.match(text, /0\/40/);
  assert.match(text, /40\/40/);
  assert.match(text, /older saved component|OLDER SAVED COMPONENT/);
  assert.match(text, /samX500 and willGuimont/);
  assert.match(text, /Not a video file/);
  assert.doesNotMatch(text, /FRESH ACCEPTANCE|Muse Code|k\/10|\$45|\$50|on a phone|public url/i);
  assert.equal(timeline.some(segment => segment.id === 'investigation-result'), false);
});

test('read-only lab cannot submit and the preview refuses creation', { timeout: 180000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'demo-lab-'));
  const lab = createReadOnlyRoadsterLab(directory);
  assert.equal(lab.status().enabled, false);
  await assert.rejects(() => lab.submit(), /disables model creation/);
  await assert.rejects(() => lab.artifact('a'.repeat(64)));
  const playback = join(directory, 'playback');
  const remix = await materializeCommittedRemix(root, playback);
  const server = await startRecordingServer(root, playback);
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
    const listed = await fetch(server.origin + '/api/roadster/artifacts/' + remix.id);
    assert.equal(listed.status, 200);
    const body = await listed.json();
    assert.equal(body.id, SAVED_REMIX_ID);
    assert.equal(body.parentArtifactId, remix.parentId);
    assert.match(body.summary, /3m backward/i);
    const missing = await fetch(server.origin + '/api/roadster/artifacts/' + 'ab'.repeat(32));
    assert.equal(missing.status, 404);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('ffmpeg writes a two-second h264 segment with a lower third', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'demo-encode-'));
  try {
    const corner = join(directory, 'corner.png');
    const lower = join(directory, 'lower.png');
    await writeCaption(join(directory, 'corner.txt'), ['HACKATHON', 'No new model request']);
    await writeSolidPng(corner, 8, 8, [188, 233, 129, 255]);
    await writeSolidPng(lower, 8, 8, [17, 19, 21, 220]);
    const output = join(directory, 'segment.mp4');
    const args = segmentArgs({
      input: { kind: 'lavfi', color: '0x203040', seconds: 2 },
      frames: 60,
      filter: overlayFilter({ seconds: 2, pad: true, lower: true }),
      images: [corner, lower],
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
    'scripts/record-demo.mjs', 'demo/capture.mjs', 'demo/capture-accepted.mjs', 'demo/render.mjs', 'demo/server.mjs', 'demo/facts.mjs',
    'demo/committed-remix.mjs', 'demo/accepted-roadster.mjs', 'demo/static-server.mjs', 'demo/cli.mjs',
  ]) {
    const source = await readFile(join(root, path), 'utf8');
    assert.doesNotMatch(source, /loadEnvFile|MODEL_API_KEY|scripts\/preview/);
  }
  const render = await readFile(join(root, 'demo/render.mjs'), 'utf8');
  assert.match(render, /draft\.mp4/);
  assert.match(render, /draft\.srt/);
});
