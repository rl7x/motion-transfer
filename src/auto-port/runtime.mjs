import { build } from 'esbuild';

/**
 * The host side of every port, written by hand and shared by all games. It wraps the accepted
 * recovered component, which Spark can call but cannot change. No randomness, clocks or I/O.
 */
export async function buildRuntime({ component, dashKey = 'KeyX' }) {
  const bundled = await build({
    stdin: { contents: component.javascript, loader: 'js' }, bundle: false, write: false,
    format: 'iife', globalName: 'RecoveredDash', target: 'es2020', logLevel: 'silent',
  });
  const defaults = JSON.stringify(component.contract.defaults);
  return `${bundled.outputFiles[0].text}
(function (root) {
  "use strict";
  var motion = typeof RecoveredDash !== "undefined" ? RecoveredDash : root.RecoveredDash;
  var config = ${defaults};
  var MotionDash = {
    held: false, calls: 0, events: [],
    update: function (game, direction) {
      direction = direction || {};
      MotionDash.calls += 1;
      if (!game.motionDash) game.motionDash = { core: motion.init(config) };
      var buttons = (MotionDash.held ? 1 : 0) | (direction.left ? 16 : 0) | (direction.right ? 32 : 0)
        | (direction.up ? 64 : 0) | (direction.down ? 128 : 0);
      var next = motion.step(game.motionDash.core, { buttons: buttons, sourceBodyWidth: 8 }, config);
      game.motionDash.core = next.state;
      var output = next.output, owns = output.ownsMotion === true;
      for (var index = 0; index < output.events.length; index += 1) MotionDash.events.push(output.events[index]);
      return { owns: owns, dx: owns ? output.displacement.x : 0, dy: owns ? output.displacement.y : 0, events: output.events.slice() };
    },
  };
  root.MotionDash = MotionDash;
  if (typeof document !== "undefined") {
    var press = function (held) {
      return function (event) {
        if (event.code !== ${JSON.stringify(dashKey)}) return;
        MotionDash.held = held; event.preventDefault(); event.stopImmediatePropagation();
      };
    };
    root.addEventListener("keydown", press(true), true);
    root.addEventListener("keyup", press(false), true);
    root.addEventListener("blur", function () { MotionDash.held = false; });
  }
})(globalThis);
`;
}
