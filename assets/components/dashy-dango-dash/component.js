// component.ts
var F = Math.fround;
function cfg(c) {
  return { walkingSpeed: c?.walkingSpeed ?? 2, dashDistance: c?.dashDistance ?? 60, cooldownTicks: c?.cooldownTicks ?? 25, initialCooldownTicks: c?.initialCooldownTicks ?? 10 };
}
function norm(x, y) {
  x = F(x);
  y = F(y);
  const d = F(Math.sqrt(F(F(x * x) + F(y * y))));
  if (d === 0) return [0, 0];
  const inv = F(1 / d);
  return [F(x * inv), F(y * inv)];
}
function inputDir(b) {
  let x = 0, y = 0;
  if (b & 32) x += 1;
  if (b & 16) x -= 1;
  if (b & 128) y += 1;
  if (b & 64) y -= 1;
  return norm(x, y);
}
function init(c) {
  const k = cfg(c);
  return { dirX: 0, dirY: 0, remaining: 0, cooldown: k.initialCooldownTicks | 0, cooldownFresh: false };
}
function step(state, input, c) {
  const k = cfg(c);
  const s = { ...state };
  const b = input?.buttons | 0;
  const events = [];
  const width = Math.max(1, Math.round(Number(input?.sourceBodyWidth) || 8));
  if (s.remaining > 0) {
    const speed = F(k.dashDistance / width);
    const dx2 = F(s.dirX * speed), dy2 = F(s.dirY * speed);
    s.remaining = s.remaining - 1 | 0;
    if (s.remaining === 0) events.push("dash-end");
    return { state: s, output: { ownsMotion: true, displacement: { x: dx2, y: dy2 }, events } };
  }
  if ((b & 1) !== 0 && s.cooldown === 0) {
    let [dx2, dy2] = inputDir(b);
    if (dx2 === 0 && dy2 === 0) {
      dx2 = 1;
      dy2 = 0;
    }
    s.dirX = dx2;
    s.dirY = dy2;
    s.cooldown = k.cooldownTicks | 0;
    s.cooldownFresh = true;
    s.remaining = width;
    const speed = F(k.dashDistance / width);
    const mx = F(s.dirX * speed), my = F(s.dirY * speed);
    s.remaining = s.remaining - 1 | 0;
    events.push("dash-start");
    if (s.remaining === 0) events.push("dash-end");
    return { state: s, output: { ownsMotion: true, displacement: { x: mx, y: my }, events } };
  }
  const [wx, wy] = inputDir(b);
  const dx = F(wx * F(k.walkingSpeed)), dy = F(wy * F(k.walkingSpeed));
  if (s.cooldown > 0) s.cooldown = s.cooldown - 1 | 0;
  return { state: s, output: { ownsMotion: false, displacement: { x: dx, y: dy }, events } };
}
export {
  init,
  step
};
