// Human-authored recipient challenge. This target is not a recovered donor rule.
export const PARALLAXIA_CHALLENGE = Object.freeze({
  id: 'barrage-safe-zone-v1',
  levelId: 'sector-1-barrage',
  tickRate: 60,
  maxTicks: 1200,
  runTicks: 766,
  dashTick: 636,
  seed: 7,
  mode: 'normal',
  target: Object.freeze({ minX: 0.4, maxX: 3.0 }),
});

export function landingInTarget(landing, target = PARALLAXIA_CHALLENGE.target) {
  return Boolean(
    landing &&
      landing.type === 'land' &&
      landing.position.x >= target.minX &&
      landing.position.x <= target.maxX,
  );
}

/** Deterministic 60 Hz assisted pilot input bitmask sequence for the 766-tick Sector 1 barrage challenge. */
export function createParallaxiaChallengeControls() {
  const LEFT = 4;
  const RIGHT = 8;
  const SHOT = 16;
  const controls = [];
  for (let tick = 0; tick < PARALLAXIA_CHALLENGE.runTicks; tick++) {
    if (tick < 20) controls.push(RIGHT | SHOT);
    else if (tick < 60) controls.push(SHOT);
    else if (tick < 100) controls.push(LEFT | SHOT);
    else if (tick < 140) controls.push(SHOT);
    else if (tick < 175) controls.push(RIGHT | SHOT);
    else if (tick < 220) controls.push(SHOT);
    else if (tick < 265) controls.push(LEFT | SHOT);
    else if (tick < 300) controls.push(SHOT);
    else if (tick < 330) controls.push(RIGHT | SHOT);
    else if (tick < 360) controls.push(SHOT);
    else if (tick < 382) controls.push(LEFT | SHOT);
    else if (tick < 396) controls.push(SHOT);
    else if (tick < 406) controls.push(RIGHT | SHOT);
    else if (tick < 636) controls.push(SHOT);
    else if (tick < 640) controls.push(RIGHT | SHOT);
    else controls.push(SHOT);
  }
  return controls;
}
