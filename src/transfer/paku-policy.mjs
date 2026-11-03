export const PAKU_POLICY = Object.freeze({
  tickRate: 60,
  sourceBodyWidth: 8,
  unitScale: 0.5,
  seed: 9,
  controls: 'Space or tap reverses facing; hold D to dash',
  collisionOrder: 'recipient dot processing, then ghost contact; swept player hitboxes; final-position wrap',
});

export const CONFORMANCE_CHECKS = [
  'idle-and-turn', 'early-held', 'left-tap', 'release-during-dash', 'turn-during-dash',
  'recipient-speed', 'cooldown-boundary', 'scale-without-timer-change', 'restart',
  'restart-again', 'counterfactual-component-output',
];

export const BROWSER_CHECKS = [
  'ordinary-play-matches-original', 'dash-output-and-frozen-direction-match-component',
  'held-dash-retriggers-without-turning', 'swept-ghost-contact-and-restart',
  'power-cookie-retains-recipient-ghost-rule', 'wrap-teleport-does-not-sweep-across-the-lane',
  'dash-input-is-preserved-in-attract-replay', 'active-transfer-is-invariant-to-display-rate',
];
