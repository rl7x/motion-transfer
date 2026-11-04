import { DEVELOPMENT_CASES, MOTION_REGRESSIONS } from './cases.mjs';

const step = (buttons, frames) => ({ buttons, frames });

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
