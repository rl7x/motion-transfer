// component.ts
var ABILITY = 1;
var LEFT = 16;
var RIGHT = 32;
var UP = 64;
var DOWN = 128;
var DASH_FRAMES = 8;
function init(config) {
  return {
    cooldown: config.initialCooldownTicks,
    dashing: false,
    dashFramesLeft: 0,
    dashDir: { x: 1, y: 0 }
    // store config values? Or just use passed config in step.
    // Need to keep residual per frame due to rounding? Not needed.
  };
}
function getMoveInput(buttons) {
  let x = 0, y = 0;
  if (buttons & LEFT) x -= 1;
  if (buttons & RIGHT) x += 1;
  if (buttons & UP) y -= 1;
  if (buttons & DOWN) y += 1;
  return { x, y };
}
function normalize(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}
function step(state, input, config) {
  let ownsMotion = false;
  let displacement = { x: 0, y: 0 };
  let events = [];
  const canDash = state.cooldown <= 0 && !state.dashing;
  const abilityPressed = (input.buttons & ABILITY) !== 0;
  if (abilityPressed && canDash) {
    const move = getMoveInput(input.buttons);
    let dir;
    if (move.x === 0 && move.y === 0) {
      dir = { x: 1, y: 0 };
    } else {
      dir = normalize(move);
    }
    state.dashing = true;
    state.dashFramesLeft = DASH_FRAMES;
    state.dashDir = dir;
  }
  if (state.dashing) {
    ownsMotion = true;
    const perFrame = config.dashDistance / DASH_FRAMES;
    displacement.x = state.dashDir.x * perFrame;
    displacement.y = state.dashDir.y * perFrame;
    if (state.dashFramesLeft === DASH_FRAMES) {
      events.push("dash-start");
    }
    state.dashFramesLeft -= 1;
    if (state.dashFramesLeft === 0) {
      events.push("dash-end");
      state.dashing = false;
      state.cooldown = config.cooldownTicks;
    }
  } else {
    if (state.cooldown > 0) {
      state.cooldown -= 1;
    }
    ownsMotion = false;
    const move = getMoveInput(input.buttons);
    if (move.x !== 0 || move.y !== 0) {
      const n = normalize(move);
      displacement.x = n.x * config.walkingSpeed;
      displacement.y = n.y * config.walkingSpeed;
    } else {
      displacement.x = 0;
      displacement.y = 0;
    }
  }
  return { state, output: { ownsMotion, displacement, events } };
}
export {
  init,
  step
};
