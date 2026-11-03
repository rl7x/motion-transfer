import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export const VIDEO_SECONDS = 180;
export const VIDEO_FPS = 30;

const BANNED = [
  /on (?:a |your )?phone/i,
  /public url/i,
  /external creators/i,
  /FRESH ACCEPTANCE/,
  /Muse Code/,
  /\bk\/10\b/,
  /people tried/i,
];

export function shortId(id, head = 8, tail = 6) {
  if (id.length <= head + tail + 1) return id;
  return id.slice(0, head) + '…' + id.slice(-tail);
}

export function landingLines(measurements) {
  const base = Number(measurements.baselineLandingX).toFixed(2);
  const moved = Number(measurements.transferredLandingX).toFixed(2);
  const shift = Number(measurements.netLandingShiftMeters).toFixed(2);
  const min = Number(measurements.targetMinX).toFixed(1);
  const max = Number(measurements.targetMaxX).toFixed(1);
  const coordinates = [
    `Native landing ${base} m, outside ${min} to ${max} m.`,
    `With this dash, ${moved} m. Shift about ${shift} m.`,
  ];
  const exactDash = measurements.dashActiveUpdates === 8 && Math.abs(Number(measurements.dashMeters) - 6) < 1e-6;
  const dash = exactDash
    ? 'The saved dash is 6 m across 8 updates. Native motion moves too.'
    : measurements.dashActiveUpdates == null
      ? 'The landing shift includes native motion, not only the dash.'
      : `Saved report: ${measurements.dashActiveUpdates} active updates, ${measurements.dashMeters} m.`;
  return { coordinates, dash };
}

function phaseLines(phase) {
  if (!phase?.quoted) {
    return [
      phase?.present
        ? 'A phase ledger is on disk and is not quoted.'
        : 'Phase budget journal is not in this checkout.',
      'No ceiling or reservation is stated from it.',
      'Not an acceptance. Not a finished ten-trial rate.',
    ];
  }
  const recovery = phase.reservations.filter(item => item.category === 'recovery');
  const lines = [`Budget ceiling $${phase.ceiling}.`];
  if (recovery.length === 1) {
    const item = recovery[0];
    lines.push(`Recovery reservation: ${item.status}, cap $${Number(item.cap).toFixed(2)}.`);
    if (item.estimate != null) lines.push(`Recorded estimate $${item.estimate}.`);
  } else if (recovery.length > 1) {
    lines.push(`${recovery.length} recovery reservations: ${recovery.map(item => item.status).join(', ')}.`);
  } else lines.push('No recovery reservation is recorded.');
  lines.push('Not an acceptance. Not a finished ten-trial rate.');
  return lines;
}

export function resultsCopy(facts, fresh = null) {
  const component = facts.component;
  const campaign = facts.campaign;
  const lines = [
    'FINITE TRACES. SAVED RECOVERY.',
    `Saved component ${shortId(component.id)}.`,
    'Wonder generated it. Spark repaired it.',
    `${component.cost} across ${component.requests} historical requests.`,
    `${component.development} development, ${component.regression} regression, ${component.acceptance} acceptance.`,
    `${component.tickLabel} ticks. Maximum position error ${component.maxPositionError}.`,
    `November 2 campaign: ${campaign.completedTasks} of ${campaign.attemptedTasks} tasks.`,
    `${campaign.cost} estimated. Recovery not completed.`,
    campaign.noSubmittedCandidate ? 'Those recovery trials submitted no candidate.' : 'The recovery task did not complete.',
    `Later trials ${facts.laterTrials.cost}. One reached ${facts.laterTrials.peak}.`,
    'Neither of those trials passed acceptance.',
    ...phaseLines(facts.phase),
    'By-feel and video scores are not in this cut.',
  ];
  if (fresh) {
    lines.unshift(`Fresh acceptance ${shortId(fresh.trialId, 8, 4)} via ${fresh.harness}.`);
    lines.splice(2, 0, `Fresh component ${shortId(fresh.componentId)}.`);
  }
  return lines;
}

export function closingCopy() {
  return [
    'HACKATHON WORK',
    'Recovery harness, saved dash, adapters,',
    'green-zone challenge, remix flow, and checks.',
    'UPSTREAM',
    'Dashy Dango, samX500 and willGuimont.',
    'PAKU PAKU and JUJUMP, Kenta Cho.',
    'RDSTR Stunts, sebayaki.',
    'LOCAL ONLY',
    'npm run dev:transfer',
    'http://127.0.0.1:4173',
    'Not a public link. Not a phone recording.',
  ];
}

function segment(id, seconds, clip, extra) {
  return { id, seconds, clip, window: 'content', startAt: 0, ...extra };
}

export function buildTimeline({ facts, measurements, remixAvailable, donorDashVisible = true, pakuDashVisible = true, fresh = null }) {
  const landing = measurements ? landingLines(measurements) : null;
  const investigationClip = fresh ? fresh.clip : 'investigation';
  const segments = [
    segment('hook-miss', 6, 'original', {
      window: 'end',
      corner: ['UPSTREAM · RDSTR STUNTS', 'Saved playback'],
      lower: ['Same recorded stunt. This landing misses the zone.'],
      cues: ['Same recorded stunt. This landing misses the green zone.'],
    }),
    segment('hook-land', 6, 'borrowed', {
      window: 'end',
      corner: ['HACKATHON · GREEN ZONE', 'Saved playback'],
      lower: ['Same controls, plus a dash from a compiled game.'],
      cues: ['Same controls, plus a dash recovered from another game\'s compiled cartridge.'],
    }),
    segment('donor', 7, 'donor', {
      corner: ['UPSTREAM · DASHY DANGO', 'samX500 and willGuimont'],
      lower: donorDashVisible
        ? ['Upstream Dashy Dango, by samX500 and willGuimont.', 'The compiled cartridge this dash was borrowed from.']
        : ['Upstream Dashy Dango, by samX500 and willGuimont.', 'Dash input was sent. An active burst was not confirmed.'],
      cues: ['Upstream Dashy Dango, by samX500 and willGuimont.'],
    }),
    segment('ability', 5, 'ability', {
      corner: ['HACKATHON · SAVED', 'No new model request'],
      lower: ['Saved recovery. Borrowing it sends no new request.'],
      cues: ['One saved controller. Borrowing it sends no new model request.'],
    }),
    segment('paku', 8, 'paku', {
      window: 'end',
      corner: ['UPSTREAM GAME + ADAPTER', 'No new model request'],
      lower: pakuDashVisible
        ? ['Same saved controller, replayed in PAKU PAKU.', 'Upstream game by Kenta Cho. Adapter built here.']
        : ['Same saved controller, in the PAKU PAKU frame.', 'A dash hold was sent. An active burst was not confirmed.'],
      cues: ['Same saved controller, replayed in Kenta Cho\'s PAKU PAKU.'],
    }),
    segment('investigation-record', 12, investigationClip, {
      corner: fresh ? [`FRESH · ${fresh.harness.toUpperCase()}`, 'Explicit substitution'] : ['SAVED INVESTIGATION', 'No new model request'],
      lower: fresh
        ? [`Fresh acceptance ${shortId(fresh.trialId, 8, 4)}.`, `Harness: ${fresh.harness}. Passed explicitly.`]
        : ['Saved Muse Spark 1.3 run. No new model request.', 'The host mapped the boundary, state, and checks.'],
      cues: fresh
        ? [`Fresh acceptance, trial ${fresh.trialId}, ${fresh.harness} harness.`]
        : [
          'Saved Muse Spark investigation. The view button makes no model call.',
          'The host mapped the boundary, state, and checks.',
        ],
    }),
    segment('investigation-result', 21, investigationClip, {
      window: fresh ? 'content' : 'mark',
      mark: 'rejection',
      corner: fresh ? ['FRESH ACCEPTANCE', 'Not the November 2 campaign'] : ['SAVED INVESTIGATION', 'No new model request'],
      lower: fresh
        ? [`Component ${shortId(fresh.componentId)}.`, 'The November 2 campaign result is unchanged.']
        : ['Neutral after a left dash went right.', 'That contradicted the preservation hypothesis.'],
      cues: fresh
        ? [`Fresh component ${fresh.componentId}. Historical campaign result stays as recorded.`]
        : ['After a left dash, a neutral press moved right and contradicted the preservation hypothesis.'],
    }),
    segment('evidence', 20, 'evidence', {
      corner: ['SAVED MEASUREMENT', 'No new model request'],
      lower: landing ? landing.coordinates : ['Saved matched-input landing coordinates.'],
      cues: landing ? [landing.coordinates.join('\n'), landing.dash] : ['Saved matched-input landing coordinates.'],
    }),
    segment('jujump', 23, 'jujump', {
      corner: ['UPSTREAM GAME + ADAPTER', 'No new model request'],
      lower: ['Author-built adapter on Kenta Cho\'s JUJUMP.', 'Same frozen component. Not an outside session.'],
      cues: ['Author-built adapter on JUJUMP. Same frozen component. This is not an outside developer session.'],
    }),
    segment('remix', 20, remixAvailable ? 'remix' : 'remix-form', {
      window: 'end',
      corner: remixAvailable ? ['SAVED LOCAL REMIX', 'No new model request'] : ['FORM ONLY', 'No generation'],
      lower: remixAvailable
        ? ['Saved local remix: backward, fresh press, 3 m.', 'Committed child. Playback sends no new request.']
        : ['Remix form only. No generation in this take.'],
      cues: remixAvailable
        ? ['Saved local remix: backward, fresh press, 3 m. Playback sends no new model request.']
        : ['Remix form only. No generation in this take.'],
    }),
    segment('results', 30, 'results-card', {
      kind: 'card',
      corner: ['HACKATHON · RESULTS', 'Finite traces'],
      lower: null,
      cues: pairCues(resultsCopy(facts, fresh)),
    }),
    segment('credits', 14, 'credits', {
      corner: ['CREDITS', 'Local preview only'],
      lower: ['Hackathon: harness, dash, adapters, challenge, checks.', 'Upstream: Dashy Dango, PAKU PAKU, JUJUMP, RDSTR.'],
      cues: ['Hackathon work is the harness, dash, adapters, challenge, and checks. The four games are upstream.'],
    }),
    segment('close', 8, 'closing-card', {
      kind: 'card',
      corner: ['LOCAL PREVIEW', 'Not a public link'],
      lower: null,
      cues: ['Run npm run dev:transfer and open http://127.0.0.1:4173. This is a local preview, not a public or phone link.'],
    }),
  ];
  let cursor = 0;
  for (const item of segments) {
    item.start = cursor;
    cursor += item.seconds;
    item.frames = item.seconds * VIDEO_FPS;
  }
  if (cursor !== VIDEO_SECONDS) throw Error('Timeline is ' + cursor + ' seconds');
  assertClaimBoundary(segments, fresh);
  return segments;
}

function pairCues(lines) {
  const cues = [];
  for (let index = 0; index < lines.length; index += 2) cues.push(lines.slice(index, index + 2).join('\n'));
  return cues;
}

export function assertClaimBoundary(segments, fresh) {
  const text = segments.flatMap(item => [...(item.lower ?? []), ...(item.cues ?? []), ...(item.corner ?? [])]).join('\n');
  const banned = fresh ? BANNED.filter(pattern => pattern.source !== 'FRESH ACCEPTANCE' && pattern.source !== 'Muse Code') : BANNED;
  for (const pattern of banned) {
    if (pattern.test(text)) throw Error('Timeline includes a claim this cut cannot make: ' + pattern);
  }
  if (!fresh && /Muse Code|FRESH ACCEPTANCE/.test(text)) throw Error('Default cut mentions a fresh or Muse Code result');
  if (fresh?.harness !== 'muse-code' && /Muse Code/.test(text)) throw Error('Muse Code appears without that harness');
  for (const item of segments) {
    for (const line of item.lower ?? []) {
      if (line.length > 68) throw Error('Lower-third line is too long: ' + line);
    }
  }
}

export function resolveFreshAcceptance(filePath) {
  if (!filePath) return null;
  const path = isAbsolute(filePath) ? filePath : resolve(filePath);
  let spec;
  try {
    spec = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw Error('Fresh acceptance file could not be read: ' + error.message);
  }
  for (const key of ['publicUrl', 'phone', 'userCount', 'rate']) {
    if (Object.prototype.hasOwnProperty.call(spec, key)) throw Error('Fresh acceptance file includes ' + key);
  }
  if (spec.accepted !== true) throw Error('Fresh acceptance file is not an acceptance');
  if (!['in-app', 'muse-code'].includes(spec.harness)) throw Error('Fresh acceptance harness must be in-app or muse-code');
  if (typeof spec.trialId !== 'string' || !/^[A-Za-z0-9:_-]{1,80}$/.test(spec.trialId)) {
    throw Error('Fresh acceptance trial id is invalid');
  }
  if (typeof spec.componentId !== 'string' || !/^[a-f0-9]{64}$/.test(spec.componentId)) {
    throw Error('Fresh acceptance component id is invalid');
  }
  if (typeof spec.clip !== 'string' || /^https?:/i.test(spec.clip)) throw Error('Fresh acceptance clip must be a local file');
  const clip = isAbsolute(spec.clip) ? spec.clip : resolve(spec.clip);
  try {
    readFileSync(clip);
  } catch {
    throw Error('Fresh acceptance clip is missing');
  }
  return { ...spec, clip, source: path };
}
