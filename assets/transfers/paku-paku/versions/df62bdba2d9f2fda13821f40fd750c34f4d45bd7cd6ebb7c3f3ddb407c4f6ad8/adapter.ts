export function init(motion, config) {
  var core = motion.init(config.motion);
  return { core: core };
}
export function step(state, frame, motion, config) {
  var buttons = 0;
  if (frame.facing === 1) buttons |= 32;
  else buttons |= 16;
  if (frame.dash) buttons |= 1;
  var r = motion.step(state.core, { buttons: buttons, sourceBodyWidth: 8 }, config.motion);
  var owns = r.output.ownsMotion;
  var events = r.output.events;
  var displacement;
  var sweep = [];
  if (!owns) {
    displacement = frame.normalDisplacement;
  } else {
    displacement = r.output.displacement.x * config.unitScale;
    var sign = displacement < 0 ? -1 : 1;
    var ad = displacement < 0 ? -displacement : displacement;
    var n = Math.ceil(ad - 1e-9) - 1;
    if (n < 0) n = 0;
    if (n > 64) n = 64;
    for (var i = 1; i <= n; i++) sweep.push(i * sign);
  }
  return { state: { core: r.state }, output: { displacement: displacement, ownsMotion: owns, events: events, sweep: sweep } };
}
