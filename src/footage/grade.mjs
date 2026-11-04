import { compileMotion } from '../component/build.mjs';
import { executeMotion } from '../component/run.mjs';

const ABILITY = 1, LEFT = 16, RIGHT = 32, UP = 64, DOWN = 128;
const SETTLE_TICKS = 40;
const WIDTH = 8;
const MOST_ANGLE_DEGREES = 8;
const WALK_TICKS = 12;
const STOP_TICKS = 6;
const WALK_TOLERANCE = 0.25;

const buttonsFor = ([dx, dy]) => (dx > 0.38 ? RIGHT : 0) | (dx < -0.38 ? LEFT : 0) | (dy > 0.38 ? DOWN : 0) | (dy < -0.38 ? UP : 0);
const input = buttons => ({ buttons, sourceBodyWidth: WIDTH });

/** Tracking can't see finer than this, so a check can't demand better. */
export const distanceTolerance = distance => Math.max(1.5, distance * 0.04);

function burstTrace(burst, index) {
  const held = buttonsFor(burst.direction);
  return {
    name: `held-out-${index + 1}`,
    inputs: [...Array(SETTLE_TICKS).fill(input(0)), input(held | ABILITY), ...Array(burst.frames + 8).fill(input(held))],
  };
}

/** Replays a standing burst as it looked: move, stop, then use the ability with nothing held. */
function standingTrace(burst, index) {
  const moved = burst.lastMovedDirection ? buttonsFor(burst.lastMovedDirection) : 0;
  return {
    name: `standing-${index + 1}`,
    inputs: [...Array(SETTLE_TICKS).fill(input(0)), ...Array(WALK_TICKS).fill(input(moved)), ...Array(STOP_TICKS).fill(input(0)), input(ABILITY), ...Array(burst.frames + 8).fill(input(0))],
  };
}

function walkingTrace(name, buttons) {
  return { name, inputs: [...Array(SETTLE_TICKS).fill(input(0)), ...Array(WALK_TICKS * 3).fill(input(buttons))] };
}

function checkWalking(label, frames, expected) {
  const walking = frames.slice(SETTLE_TICKS);
  const moved = walking.reduce((sum, frame) => ({ x: sum.x + frame.displacement.x, y: sum.y + frame.displacement.y }), { x: 0, y: 0 });
  const speed = Math.hypot(moved.x, moved.y) / walking.length;
  const failures = [];
  if (Math.abs(speed - expected) > WALK_TOLERANCE) failures.push(`${label} movement went ${speed.toFixed(2)} pixels per tick; the footage shows ${expected}.`);
  if (walking.some(frame => frame.ownsMotion)) failures.push(`${label} movement should not report ownsMotion.`);
  return { name: label, expected, measured: Number(speed.toFixed(2)), passed: failures.length === 0, failures };
}

function checkBurst(burst, frames, at = SETTLE_TICKS) {
  const active = frames.slice(at);
  const owned = active.findIndex(frame => !frame.ownsMotion);
  const ticks = owned < 0 ? active.length : owned;
  const moved = active.slice(0, ticks).reduce((sum, frame) => ({ x: sum.x + frame.displacement.x, y: sum.y + frame.displacement.y }), { x: 0, y: 0 });
  const distance = Math.hypot(moved.x, moved.y);
  const [dx, dy] = burst.direction;
  const angle = distance ? Math.abs(Math.atan2(moved.x * dy - moved.y * dx, moved.x * dx + moved.y * dy)) * 180 / Math.PI : 180;
  const failures = [];
  if (ticks !== burst.frames) failures.push(`The burst lasted ${ticks} ticks; the footage shows ${burst.frames}.`);
  if (Math.abs(distance - burst.distance) > distanceTolerance(burst.distance)) failures.push(`The burst moved ${distance.toFixed(2)} pixels; the footage shows ${burst.distance}.`);
  if (angle > MOST_ANGLE_DEGREES) failures.push(`The burst went ${angle.toFixed(1)} degrees off the direction in the footage.`);
  if (!frames[at]?.events?.includes('dash-start')) failures.push('The first moving tick has no dash-start event.');
  return { startFrame: burst.startFrame, frames: burst.frames, measured: { ticks, distance: Number(distance.toFixed(2)), angle: Number(angle.toFixed(1)) }, passed: failures.length === 0, failures };
}

function checkRecharge(frames, gap) {
  const starts = frames.flatMap((frame, tick) => (frame.events.includes('dash-start') ? [tick] : []));
  const gaps = starts.slice(1).map((start, index) => start - starts[index]);
  const shortest = gaps.length ? Math.min(...gaps) : null;
  const passed = shortest === gap;
  return { name: 'recharge', expected: gap, measured: shortest, passed, failures: passed ? [] : [`Holding the ability repeated every ${shortest ?? 'never'} ticks; the shortest gap in the footage is ${gap}.`] };
}

function checkFirstBurst(frames, expected) {
  const first = frames.findIndex(frame => frame.events.includes('dash-start'));
  const passed = first === expected;
  return { name: 'first-burst', expected, measured: first, passed, failures: passed ? [] : [`Holding the ability from the first step started the first burst on step ${first}, counting from 0; the footage shows step ${expected}.`] };
}

/** Replays held-out bursts in the same sandbox that runs every other generated controller. */
export async function gradeController({ source, config, heldOut, gap, firstBurst = null, walking = null, standing = [], signal }) {
  const compiled = await compileMotion(source);
  const held = buttonsFor(heldOut[0].direction) | ABILITY;
  const traces = [...heldOut.map(burstTrace)];
  const add = trace => traces.push(trace) - 1;
  const rechargeRun = gap ? add({ name: 'recharge', inputs: Array(SETTLE_TICKS + gap * 4).fill(input(held)) }) : null;
  const firstRun = firstBurst !== null ? add({ name: 'first-burst', inputs: Array(firstBurst + 20).fill(input(held)) }) : null;
  const straightRun = walking?.straight ? add(walkingTrace('straight', RIGHT)) : null;
  const diagonalRun = walking?.diagonal ? add(walkingTrace('diagonal', RIGHT | DOWN)) : null;
  const standingRuns = standing.map((burst, index) => add(standingTrace(burst, index)));
  const runs = await executeMotion(compiled, traces, config, { signal });
  const bursts = heldOut.map((burst, index) => checkBurst(burst, runs[index].frames));
  const recharge = gap ? checkRecharge(runs[rechargeRun].frames, gap) : null;
  const start = firstBurst !== null ? checkFirstBurst(runs[firstRun].frames, firstBurst) : null;
  const moving = [
    ...(straightRun !== null ? [checkWalking('Straight', runs[straightRun].frames, walking.straight)] : []),
    ...(diagonalRun !== null ? [checkWalking('Diagonal', runs[diagonalRun].frames, walking.diagonal)] : []),
  ];
  const still = standing.map((burst, index) => {
    const result = checkBurst(burst, runs[standingRuns[index]].frames, SETTLE_TICKS + WALK_TICKS + STOP_TICKS);
    return { ...result, failures: result.failures.map(failure => `With no direction held after moving, ${failure.charAt(0).toLowerCase()}${failure.slice(1)}`) };
  });
  const failures = [...bursts, ...still, ...moving].flatMap(check => check.failures).concat(recharge?.failures ?? [], start?.failures ?? []);
  return { passed: failures.length === 0, bursts, standing: still, walking: moving, recharge, start, failures, compiled };
}
