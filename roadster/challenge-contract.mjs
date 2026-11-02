// Human-authored recipient challenge. This target is not a recovered donor rule.
export const ROADSTER_CHALLENGE = Object.freeze({
  id: 'backflip-landing-v1',
  levelId: 'backflip',
  tickRate: 60,
  maxTicks: 1200,
  dashAfterAirSeconds: 1.1,
  target: Object.freeze({ minX: -42.3, maxX: -40.4 }),
});

export function landingInTarget(landing, target = ROADSTER_CHALLENGE.target) {
  return Boolean(landing && landing.type === 'land' && landing.position.x >= target.minX
    && landing.position.x <= target.maxX);
}
