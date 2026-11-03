// component.ts
function init(motion, config) {
  const core = motion.init(config.motion);
  return { core, prevDash: false };
}
function step(state, frame, motion, config) {
  const raw = !!frame.dash;
  const airborne = !!frame.airborne;
  const facing = frame.facing < 0 ? -1 : 1;
  const ACT_HELD = false;
  const DIR_FACING = true;
  const mappedFacing = DIR_FACING ? facing : -facing;
  const dirBits = mappedFacing < 0 ? 16 : 32;
  const prevRaw = !!state.prevDash;
  const edge = raw && !prevRaw;
  let activate = false;
  if (ACT_HELD) {
    activate = airborne && raw;
  } else {
    activate = airborne && edge;
  }
  const buttons = dirBits | (activate ? 1 : 0);
  const next = motion.step(state.core, { buttons, sourceBodyWidth: 8 }, config.motion);
  const owns = !!next.output.ownsMotion;
  const events = next.output.events;
  let displacement;
  let sweep;
  if (owns) {
    const dx = Number(next.output.displacement.x);
    displacement = dx * config.unitScale;
    const ad = displacement < 0 ? -displacement : displacement;
    if (ad === 0) {
      sweep = [];
    } else {
      const n = Math.ceil(ad / 1);
      sweep = [];
      for (let i = 1; i < n; i++) {
        sweep.push(displacement * i / n);
      }
    }
  } else {
    displacement = frame.normalDisplacement;
    sweep = [];
  }
  const newState = { core: next.state, prevDash: raw };
  return { state: newState, output: { displacement, ownsMotion: owns, events, sweep } };
}
export {
  init,
  step
};
