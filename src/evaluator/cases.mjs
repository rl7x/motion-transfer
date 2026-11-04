const step = (buttons, frames) => ({ buttons, frames });

export const DEVELOPMENT_CASES = [
  { name: 'idle', steps: [step(0, 70)] },
  { name: 'walking-directions', steps: [step(32, 10), step(16, 10), step(64, 10), step(128, 10)] },
  { name: 'startup-held', steps: [step(33, 55)] },
  { name: 'tap-right', steps: [step(0, 10), step(33, 1), step(0, 40)] },
  { name: 'tap-left', steps: [step(0, 10), step(17, 1), step(0, 40)] },
  { name: 'tap-up-down', steps: [step(0, 10), step(65, 1), step(0, 33), step(129, 1), step(0, 10)] },
  { name: 'diagonal', steps: [step(0, 10), step(97, 1), step(96, 45)] },
  { name: 'neutral-dash', steps: [step(0, 10), step(1, 1), step(0, 40)] },
  { name: 'conflicting-inputs', steps: [step(0, 10), step(49, 1), step(192, 40)] },
  { name: 'change-direction', steps: [step(0, 10), step(33, 1), step(16, 3), step(64, 4), step(128, 30)] },
  { name: 'held-retrigger', steps: [step(0, 10), step(33, 100)] },
  { name: 'cooldown-boundary', steps: [step(0, 10), step(33, 1), step(0, 30), step(65, 1), step(0, 1), step(65, 1), step(0, 10)] },
];

// Added after acceptance seed 302473669 exposed neutral activation following
// an earlier directional dash. This is development evidence from now on.
export const MOTION_REGRESSIONS = [{
  name: 'neutral-after-left-dash',
  steps: [step(0, 10), step(17, 1), step(0, 32), step(1, 1), step(0, 8)],
}];

// Public development inputs for v3. Exercise every combination of direction
// bits before neutral/opposing-input activation. No expected motion is encoded
// here: the compiled donor supplies every answer. Old protocols keep 13 cases.
export const RECOVERY_DEVELOPMENT_CASES = [
  ...DEVELOPMENT_CASES, ...MOTION_REGRESSIONS,
  ...Array.from({ length: 16 }, (_, mask) => ({
    name: `direction-history-${mask * 16}`,
    steps: [step(mask * 16, 12),
      ...[1, 49, 193, 241].flatMap(buttons => [step(buttons, 1), step(0, 35)])],
  })),
  ...[0, 16, 96].map(direction => ({
    name: `activation-boundaries-${direction}`,
    // Vary release/hold lengths across several activations in one rollout.
    steps: [step(direction, 9), ...[1, 2, 7, 8, 24, 25, 26, 32, 33, 34].flatMap(frames =>
      [step(direction | 1, frames), step(direction, 1)])],
  })),
];

// Generate only in the evaluator after a candidate is frozen. Never send these
// cases or donor answers to synthesis. A repaired candidate needs a fresh seed.
export function acceptanceCases(seed, count = 20) {
  let state = seed >>> 0;
  const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
  const directions = [0, 16, 32, 64, 128, 48, 192, 80, 96, 144, 160, 240];
  return Array.from({ length: count }, (_, index) => {
    const steps = [];
    let ticks = 0;
    while (ticks < 150) {
      const frames = Math.min(1 + next() % 18, 150 - ticks);
      steps.push(step(directions[next() % directions.length] | ((next() >>> 16) & 1), frames));
      ticks += frames;
    }
    return { name: `acceptance-${index + 1}`, steps };
  });
}
