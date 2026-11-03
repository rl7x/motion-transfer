// component.ts
function init(motion, config) {
  const core = motion.init(config.motion);
  return { core, prevDash: false };
}
function step(state, frame, motion, config) {
  const ACT = "held";
  const DIR = "facing";
  let mappedFacing = frame.facing;
  if (DIR === "opposite") {
    mappedFacing = -frame.facing;
  }
  const dirBit = mappedFacing < 0 ? 16 : 32;
  const raw = !!frame.dash;
  let activate = false;
  if (ACT === "held") {
    activate = raw && !!frame.airborne;
  } else {
    const edge = raw && !state.prevDash;
    activate = edge && !!frame.airborne;
  }
  const buttons = dirBit | (activate ? 1 : 0);
  const next = motion.step(state.core, { buttons, sourceBodyWidth: 8 }, config.motion);
  const owns = !!next.output.ownsMotion;
  const events = next.output.events;
  let displacement = 0;
  if (owns) {
    displacement = next.output.displacement.x * config.unitScale;
  } else {
    displacement = frame.normalDisplacement;
  }
  let sweep = [];
  if (owns) {
    const total = displacement;
    const ad = Math.abs(total);
    if (ad > 1) {
      const n = Math.ceil(ad / 1);
      for (let k = 1; k < n; k++) {
        sweep.push(total * k / n);
      }
    }
  }
  const newState = { core: next.state, prevDash: raw };
  return { state: newState, output: { displacement, ownsMotion: owns, events, sweep } };
}
export {
  init,
  step
};
