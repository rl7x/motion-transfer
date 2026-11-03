// component.ts
function init(motion, config) {
  return { core: motion.init(config.motion) };
}
function step(state, frame, motion, config) {
  const buttons = (frame.facing < 0 ? 16 : 32) | (frame.dash ? 1 : 0);
  const result = motion.step(state.core, { buttons, sourceBodyWidth: 8 }, config.motion);
  const output = result.output;
  const displacement = output.ownsMotion ? output.displacement.x * config.unitScale : frame.normalDisplacement;
  const sweep = [];
  if (output.ownsMotion) {
    for (let offset = 1; offset < Math.abs(displacement); offset++) sweep.push(offset * Math.sign(displacement));
  }
  return { state: { core: result.state }, output: { displacement, ownsMotion: output.ownsMotion, events: output.events, sweep } };
}
export {
  init,
  step
};
