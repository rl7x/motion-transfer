export function init(config: any): any {
  const c = config as { walkingSpeed: number; dashDistance: number; cooldownTicks: number; initialCooldownTicks: number };
  return {
    cooldown: c.initialCooldownTicks,
    dashLeft: 0,
    dashTotal: 0,
    dashDx: 0,
    dashDy: 0,
    faceX: 1,
    faceY: 0
  };
}
export function step(state: any, input: any, config: any): any {
  const c = config as { walkingSpeed: number; dashDistance: number; cooldownTicks: number; initialCooldownTicks: number };
  const DASH_TICKS = 10;
  const s = state as { cooldown: number; dashLeft: number; dashTotal: number; dashDx: number; dashDy: number; faceX: number; faceY: number };
  const buttons: number = (input as { buttons: number; sourceBodyWidth: number }).buttons | 0;
  const left = (buttons & 16) !== 0;
  const right = (buttons & 32) !== 0;
  const up = (buttons & 64) !== 0;
  const down = (buttons & 128) !== 0;
  const dashPressed = (buttons & 1) !== 0;
  let ix = (right ? 1 : 0) - (left ? 1 : 0);
  let iy = (down ? 1 : 0) - (up ? 1 : 0);
  // update facing from held dirs (prefer horizontal if both? keep last combined normalized dir)
  if (ix !== 0 || iy !== 0) {
    s.faceX = ix;
    s.faceY = iy;
  }
  const events: string[] = [];
  // currently dashing
  if (s.dashLeft > 0) {
    const per = c.dashDistance / s.dashTotal;
    const dx = s.dashDx * per;
    const dy = s.dashDy * per;
    s.dashLeft -= 1;
    if (s.cooldown > 0) s.cooldown -= 1;
    let ownsMotion = true;
    if (s.dashLeft <= 0) {
      s.dashLeft = 0;
      s.cooldown = c.cooldownTicks;
      events.push("dash-end");
    }
    return { state: s, output: { ownsMotion, displacement: { x: dx, y: dy }, events } };
  }
  // not dashing: tick cooldown
  if (s.cooldown > 0) s.cooldown -= 1;
  // try start dash
  if (dashPressed && s.cooldown <= 0) {
    let dx = ix;
    let dy = iy;
    if (dx === 0 && dy === 0) {
      dx = s.faceX;
      dy = s.faceY;
      if (dx === 0 && dy === 0) { dx = 1; dy = 0; }
    }
    const len = Math.sqrt(dx * dx + dy * dy);
    const nx = dx / len;
    const ny = dy / len;
    s.dashTotal = DASH_TICKS;
    s.dashLeft = DASH_TICKS - 1;
    s.dashDx = nx;
    s.dashDy = ny;
    const per = c.dashDistance / DASH_TICKS;
    events.push("dash-start");
    if (s.dashLeft <= 0) {
      s.cooldown = c.cooldownTicks;
      events.push("dash-end");
    }
    return { state: s, output: { ownsMotion: true, displacement: { x: nx * per, y: ny * per }, events } };
  }
  // walk
  let wx = 0;
  let wy = 0;
  if (ix !== 0 || iy !== 0) {
    if (ix !== 0 && iy !== 0) {
      const inv = 1 / Math.sqrt(2);
      wx = ix * inv * c.walkingSpeed;
      wy = iy * inv * c.walkingSpeed;
    } else {
      wx = ix * c.walkingSpeed;
      wy = iy * c.walkingSpeed;
    }
  }
  return { state: s, output: { ownsMotion: false, displacement: { x: wx, y: wy }, events } };
}