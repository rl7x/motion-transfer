const EDGE_MARGIN = 4;
const AGREEMENT = 1;
const SMALLEST_BOX = 4;
const STILL = 0.25;
const SHORTEST_BURST = 3;
const SPEED_WINDOW = 6;
const NORMAL_SIZE = 1.3;
const USUAL_SHARE = 0.4;
const SCROLLING_SHARE = 0.1;
const LOOK_BACK = 120;
const AGREE_DEGREES = 10;

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
 * Whether the player keeps coming back to one spot on screen. Afterimages stretch the box and SAM
 * can briefly follow something else, so this looks for the usual position, not an average.
 */
export function staysOnScreen(tracks, options) {
  const boxes = tracks.flatMap(track => [...(track?.values() ?? [])]);
  const area = box => (box.x2 - box.x1 + 1) * (box.y2 - box.y1 + 1);
  const smallest = [...boxes].map(area).sort((a, b) => a - b)[Math.floor(boxes.length / 10)];
  const centers = boxes.filter(box => area(box) <= smallest * NORMAL_SIZE).map(box => center(box, options)).filter(Boolean);
  if (!centers.length) return false;
  const usualX = median(centers.map(point => point.x)), usualY = median(centers.map(point => point.y));
  return centers.filter(point => Math.hypot(point.x - usualX, point.y - usualY) < 1).length / centers.length >= USUAL_SHARE;
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

const frameList = tracks => [...new Set([...tracks.values()].flatMap(track => [...track.keys()]))].sort((a, b) => a - b);
const sceneryIds = (tracks, playerId) => [...tracks.keys()].filter(id => id !== playerId);
const movedAt = (tracks, frame, options) => id => {
  const before = center(tracks.get(id)?.get(frame - 1), options), after = center(tracks.get(id)?.get(frame), options);
  return before && after ? { x: after.x - before.x, y: after.y - before.y } : null;
};

/**
 * A follow camera needs two things: scenery that scrolls together, and a player who stays put on
 * screen. Scenery that stays still means a fixed camera, however the player's box behaves.
 */
export function cameraFollows(sections, { playerId, ...options }) {
  let seen = 0, scrolling = 0;
  for (const tracks of sections) for (const frame of frameList(tracks)) {
    const scroll = sceneryMotion(sceneryIds(tracks, playerId).map(movedAt(tracks, frame, options)).filter(Boolean), 2);
    if (!scroll) continue;
    seen += 1;
    if (Math.hypot(scroll.x, scroll.y) > STILL) scrolling += 1;
  }
  if (!seen || scrolling / seen < SCROLLING_SHARE) return false;
  return staysOnScreen(sections.map(tracks => tracks.get(playerId)), options);
}

/**
 * Turns SAM tracks into the player's motion through the world, one step per frame. The step is the
 * player's own motion on screen minus how the scenery moved, so it works for a fixed camera (the
 * scenery stays still) and a camera that follows the player (the player stays still).
 */
export function worldSteps(tracks, { playerId, width, height, pixelScale, frameOffset = 0, followed }) {
  const steps = [];
  const options = { width, height, pixelScale };
  const follows = followed ?? cameraFollows([tracks], { playerId, ...options });
  for (const frame of frameList(tracks)) {
    const moved = movedAt(tracks, frame, options);
    const scenery = sceneryIds(tracks, playerId).map(moved).filter(Boolean);
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

const burstSpeed = walkSpeed => Math.max(walkSpeed * 2, walkSpeed + 1.5);

const unit = (x, y) => {
  const length = Math.hypot(x, y);
  return [Number((x / length).toFixed(3)), Number((y / length).toFixed(3))];
};

/** Where the player was last moving before standing still, if the clip shows it. */
function lastMovedDirection(steps, speeds, start) {
  for (let index = start - 1; index >= Math.max(0, start - LOOK_BACK); index--) {
    if (speeds[index] <= STILL) continue;
    const recent = steps.slice(Math.max(0, index - SPEED_WINDOW + 1), index + 1).filter(step => Math.hypot(step.x, step.y) > STILL);
    return unit(recent.reduce((sum, step) => sum + step.x, 0), recent.reduce((sum, step) => sum + step.y, 0));
  }
  return null;
}

/**
 * Landmarks can briefly disagree mid-burst. One missing frame with fast frames on both sides is
 * safe to fill. At the edge of a burst it isn't, because the length would be a guess.
 */
function bridgeGaps(steps, threshold) {
  const fast = step => Math.hypot(step.x, step.y) > threshold;
  return steps.flatMap((step, index) => {
    const next = steps[index + 1];
    if (!next || next.frame !== step.frame + 2 || !fast(step) || !fast(next)) return [step];
    return [step, { frame: step.frame + 1, x: (step.x + next.x) / 2, y: (step.y + next.y) / 2, landmarks: 0 }];
  });
}

/** Finds runs of frames much faster than ordinary movement. */
export function detectBursts(measured) {
  const walkSpeed = usualSpeed(measured.map(step => Math.hypot(step.x, step.y)));
  const threshold = burstSpeed(walkSpeed);
  const steps = bridgeGaps(measured, threshold);
  const speeds = steps.map(step => Math.hypot(step.x, step.y));
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
    const standing = before.length > 0 && before.every(speed => speed <= STILL);
    const after = speeds.slice(end + 1, end + 4);
    bursts.push({
      startFrame: run[0].frame, frames: run.length, distance: Number(distance.toFixed(2)),
      direction: unit(dx, dy),
      perFrame: run.map(step => Number(Math.hypot(step.x, step.y).toFixed(2))),
      startedFrom: standing ? 'standing still' : 'moving',
      // Someone holding a direction keeps walking after the burst, so stopping dead means none was held.
      thenStopped: after.length > 0 && after.every(speed => speed <= STILL),
      ...(standing ? { lastMovedDirection: lastMovedDirection(steps, speeds, start) } : {}),
    });
  }
  return { bursts, walkSpeed };
}

/**
 * On-screen rounding makes single frames misleading: a diagonal step of 1.41 shows up as 1 or 2 on
 * each axis. Short windows average that out, giving true distance per frame.
 */
function diagonalSpeed(steps, walkSpeed) {
  const fastest = burstSpeed(walkSpeed), speeds = [];
  for (let start = 0; start + SPEED_WINDOW <= steps.length; start++) {
    const window = steps.slice(start, start + SPEED_WINDOW);
    if (window.at(-1).frame - window[0].frame !== SPEED_WINDOW - 1) continue;
    if (window.some(step => { const speed = Math.hypot(step.x, step.y); return speed <= STILL || speed > fastest; })) continue;
    const x = window.reduce((sum, step) => sum + step.x, 0) / SPEED_WINDOW, y = window.reduce((sum, step) => sum + step.y, 0) / SPEED_WINDOW;
    const speed = Math.hypot(x, y);
    if (Math.min(Math.abs(x), Math.abs(y)) > speed * 0.3) speeds.push(speed);
  }
  return speeds.length ? Number(median(speeds).toFixed(2)) : null;
}

/**
 * The bursts that show where the ability goes with nothing held: those that start and end still.
 * If they disagree, some were aimed after all, so they say nothing about a default.
 */
export function defaultDirection(bursts) {
  const standing = bursts.filter(burst => burst.startedFrom === 'standing still' && burst.thenStopped);
  if (!standing.length) return null;
  const [first] = standing;
  const agree = standing.every(burst => Math.acos(Math.min(1, burst.direction[0] * first.direction[0] + burst.direction[1] * first.direction[1])) * 180 / Math.PI <= AGREE_DEGREES);
  return agree ? standing : null;
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
export function motionSummary({ steps, bursts, walkSpeed, practice, firstBurst = null }) {
  const diagonal = diagonalSpeed(steps, walkSpeed);
  return {
    framesMeasured: steps.length, framesPerSecond: 60,
    usualMovingSpeed: walkSpeed,
    ...(diagonal ? { diagonalMovingSpeed: diagonal } : {}),
    shortestGapBetweenBurstStarts: shortestGap(bursts), burstsSeen: bursts.length,
    ...(firstBurst !== null ? { framesOfPlayBeforeFirstBurst: firstBurst } : {}),
    practiceBursts: practice,
  };
}

export { median };
