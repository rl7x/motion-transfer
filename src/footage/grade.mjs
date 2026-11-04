import { compileMotion } from '../component/build.mjs';
import { executeMotion } from '../component/run.mjs';

const ABILITY = 1, LEFT = 16, RIGHT = 32, UP = 64, DOWN = 128;
const SETTLE_TICKS = 40;
const WIDTH = 8;
const MOST_ANGLE_DEGREES = 8;

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

function checkBurst(burst, frames) {
  const active = frames.slice(SETTLE_TICKS);
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
  if (!frames[SETTLE_TICKS]?.events?.includes('dash-start')) failures.push('The first moving tick has no dash-start event.');
  return { startFrame: burst.startFrame, frames: burst.frames, measured: { ticks, distance: Number(distance.toFixed(2)), angle: Number(angle.toFixed(1)) }, passed: failures.length === 0, failures };
}

function checkRecharge(frames, gap) {
  const starts = frames.flatMap((frame, tick) => (frame.events.includes('dash-start') ? [tick] : []));
  const gaps = starts.slice(1).map((start, index) => start - starts[index]);
  const shortest = gaps.length ? Math.min(...gaps) : null;
  const passed = shortest !== null && shortest <= gap && shortest >= gap - 2;
  return { name: 'recharge', expected: gap, measured: shortest, passed, failures: passed ? [] : [`Holding the ability repeated every ${shortest ?? 'never'} ticks; the shortest gap in the footage is ${gap}.`] };
}

/** Replays held-out bursts in the same sandbox that runs every other generated controller. */
export async function gradeController({ source, config, heldOut, gap, signal }) {
  const compiled = await compileMotion(source);
  const held = buttonsFor(heldOut[0].direction) | ABILITY;
  const traces = [...heldOut.map(burstTrace), ...(gap ? [{ name: 'recharge', inputs: Array(SETTLE_TICKS + gap * 4).fill(input(held)) }] : [])];
  const runs = await executeMotion(compiled, traces, config, { signal });
  const bursts = heldOut.map((burst, index) => checkBurst(burst, runs[index].frames));
  const recharge = gap ? checkRecharge(runs.at(-1).frames, gap) : null;
  const failures = [...bursts.flatMap(burst => burst.failures), ...(recharge?.failures ?? [])];
  return { passed: failures.length === 0, bursts, recharge, failures, compiled };
}
