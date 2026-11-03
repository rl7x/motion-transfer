import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadSavedRoadster } from '../src/roadster/saved.mjs';
import { buildRoadsterChallenge } from '../src/roadster/challenge.mjs';

const challenge = await buildRoadsterChallenge({ parent: await loadSavedRoadster() });
assert.equal(challenge.verification.ordinaryOutsideTarget, true, 'Recorded native run must land outside the marked zone');
assert.equal(challenge.verification.borrowedInsideTarget, true, 'The same controls plus the dash must reach the marked zone');
await mkdir(new URL('../reports/', import.meta.url), { recursive: true });
await writeFile(new URL('../reports/challenge-verification.json', import.meta.url), challenge.files['challenge.json']);
console.log(JSON.stringify({ passed: true, challengeId: challenge.id, componentId: challenge.componentId,
  controlsSha256: challenge.verification.controlsSha256, ticks: challenge.challenge.controls.length,
  baselineLandingX: challenge.verification.measurement.baseline.landing.position.x,
  transferredLandingX: challenge.verification.measurement.transferred.landing.position.x,
  netLandingShiftMeters: challenge.verification.netLandingShiftMeters, target: challenge.challenge.target,
  maxVerticalDifference: challenge.verification.maxVerticalDifference }, null, 2));
