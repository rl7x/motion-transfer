const EDGE_MARGIN = 4;
const AGREEMENT = 1;
const SMALLEST_BOX = 4;
const STILL = 0.25;
const SHORTEST_BURST = 3;

const median = values => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function center(box, { width, height, pixelScale }) {
  if (!box || box.x2 - box.x1 + 1 < SMALLEST_BOX || box.y2 - box.y1 + 1 < SMALLEST_BOX) return null;
  // A box cut off by the frame edge has a false center.
  if (box.x1 < EDGE_MARGIN || box.y1 < EDGE_MARGIN || box.x2 > width - EDGE_MARGIN || box.y2 > height - EDGE_MARGIN) return null;
  return { x: (box.x1 + box.x2 + 1) / 2 / pixelScale, y: (box.y1 + box.y2 + 1) / 2 / pixelScale };
}

/**
 * With a follow camera the player's box only changes because of effects like a dash's afterimage,
 * which stretch it without moving the player. Taking that as motion would add false steps.
 */
export function staysOnScreen(tracks, options) {
  const centers = tracks.flatMap(track => [...(track?.values() ?? [])]).map(box => center(box, options)).filter(Boolean);
  if (!centers.length) return false;
  const usualX = median(centers.map(point => point.x)), usualY = median(centers.map(point => point.y));
  return median(centers.map(point => Math.hypot(point.x - usualX, point.y - usualY))) < 1;
}

/**
 * How the scenery moved this frame. Scenery pieces can look alike, so a tracker can jump from one
 * to the next. Real scenery moves together, so the largest group that agrees wins, and a frame
 * where nothing agrees is left out.
 */
function sceneryMotion(steps, needed) {
  let best = [];
  for (const step of steps) {
    const group = steps.filter(other => Math.hypot(other.x - step.x, other.y - step.y) <= AGREEMENT);
    if (group.length > best.length) best = group;
  }
  if (best.length < needed) return null;
  return { x: median(best.map(step => step.x)), y: median(best.map(step => step.y)), landmarks: best.length };
}

/**
 * Turns SAM tracks into the player's motion through the world, one step per frame. The step is the
 * player's own motion on screen minus how the scenery moved, so it works for a fixed camera (the
 * scenery stays still) and a camera that follows the player (the player stays still).
 */
export function worldSteps(tracks, { playerId, width, height, pixelScale, frameOffset = 0, followed }) {
  const frames = [...new Set([...tracks.values()].flatMap(track => [...track.keys()]))].sort((a, b) => a - b);
  const steps = [];
  const options = { width, height, pixelScale };
  const follows = followed ?? staysOnScreen([tracks.get(playerId)], options);
  for (const frame of frames) {
    const moved = id => {
      const before = center(tracks.get(id)?.get(frame - 1), options), after = center(tracks.get(id)?.get(frame), options);
      return before && after ? { x: after.x - before.x, y: after.y - before.y } : null;
    };
    const scenery = [...tracks.keys()].filter(id => id !== playerId).map(moved).filter(Boolean);
    const player = follows ? { x: 0, y: 0 } : moved(playerId);
    // A followed player gives no motion of its own, so one unconfirmed landmark isn't enough.
    const scroll = sceneryMotion(scenery, follows ? 2 : 1);
    if (!player || !scroll) continue;
    steps.push({ frame: frame + frameOffset, x: player.x - scroll.x, y: player.y - scroll.y, landmarks: scroll.landmarks });
  }
  return steps;
}

/** The most common moving speed, which is walking in any clip with more walking than dashing. */
function usualSpeed(speeds) {
  const counts = new Map();
  for (const speed of speeds) if (speed > STILL) {
    const bucket = Math.round(speed * 2) / 2;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
}

/** Finds runs of frames much faster than ordinary movement. */
export function detectBursts(steps) {
  const speeds = steps.map(step => Math.hypot(step.x, step.y));
  const walkSpeed = usualSpeed(speeds);
  const threshold = Math.max(walkSpeed * 2, walkSpeed + 1.5);
  const bursts = [];
  for (let index = 0; index < steps.length; index++) {
    if (speeds[index] <= threshold) continue;
    let end = index;
    while (end + 1 < steps.length && speeds[end + 1] > threshold && steps[end + 1].frame === steps[end].frame + 1) end += 1;
    const run = steps.slice(index, end + 1);
    const start = index;
    index = end;
    // Only keep bursts seen from start to end. One with a missing frame beside it may be cut short.
    const whole = steps[start - 1]?.frame === run[0].frame - 1 && steps[end + 1]?.frame === run.at(-1).frame + 1;
    if (!whole || run.length < SHORTEST_BURST) continue;
    const dx = run.reduce((sum, step) => sum + step.x, 0), dy = run.reduce((sum, step) => sum + step.y, 0);
    const distance = Math.hypot(dx, dy);
    const before = speeds.slice(Math.max(0, start - 3), start);
    bursts.push({
      startFrame: run[0].frame, frames: run.length, distance: Number(distance.toFixed(2)),
      direction: [Number((dx / distance).toFixed(3)), Number((dy / distance).toFixed(3))],
      perFrame: run.map(step => Number(Math.hypot(step.x, step.y).toFixed(2))),
      startedFrom: before.length && before.every(speed => speed <= STILL) ? 'standing still' : 'moving',
    });
  }
  return { bursts, walkSpeed };
}

/** Every other burst is held back, so the check uses motion the model never saw. */
export function splitBursts(bursts) {
  return { practice: bursts.filter((_, index) => index % 2 === 0), heldOut: bursts.filter((_, index) => index % 2 === 1) };
}

export function shortestGap(bursts) {
  const gaps = bursts.slice(1).map((burst, index) => burst.startFrame - bursts[index].startFrame);
  return gaps.length ? Math.min(...gaps) : null;
}

/** Everything the model is told about the clip. Numbers only. */
export function motionSummary({ steps, bursts, walkSpeed, practice }) {
  const diagonal = steps.filter(step => Math.abs(step.x) > STILL && Math.abs(step.y) > STILL && Math.hypot(step.x, step.y) <= walkSpeed * 1.6);
  return {
    framesMeasured: steps.length, framesPerSecond: 60,
    usualMovingSpeed: walkSpeed,
    ...(diagonal.length ? { diagonalMovingSpeed: Number(median(diagonal.map(step => Math.hypot(step.x, step.y))).toFixed(2)) } : {}),
    shortestGapBetweenBurstStarts: shortestGap(bursts), burstsSeen: bursts.length,
    practiceBursts: practice,
  };
}

export { median };
