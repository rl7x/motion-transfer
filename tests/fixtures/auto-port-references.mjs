// Hand-written ports that prove the frozen drivers measure correctly. Spark never sees these.
const replaceWith = (anchor, ...lines) => ({ anchor, replacement: lines.join('\n') });

export const REFERENCE_PORTS = {
  skyhaul: { scale: 0.5, patches: [
    replaceWith('    L.x += L.vx * dt;', '    const dash = MotionDash.update(g, { left: dx < 0, right: dx > 0, up: dy < 0, down: dy > 0 });', '    L.x += L.vx * dt;', '    if (dash.owns) L.x += dash.dx * 0.5;'),
    replaceWith('    L.y += L.vy * dt;', '    L.y += L.vy * dt;', '    if (dash.owns) L.y += dash.dy * 0.5;'),
  ] },
  undertow: { scale: 0.5, patches: [
    replaceWith('    p.x = wrap(p.x + p.vx * DT);', '    const dash = MotionDash.update(g, { left: ix < 0, right: ix > 0, up: iy < 0, down: iy > 0 });', '    p.x = wrap(p.x + p.vx * DT + (dash.owns ? dash.dx * 0.5 : 0));'),
    replaceWith('    p.y += p.vy * DT;', '    p.y += p.vy * DT + (dash.owns ? dash.dy * 0.5 : 0);'),
  ] },
  wreckfall: { scale: 0.5, patches: [
    replaceWith('    p.x += p.vx * dt;', '    const dash = MotionDash.update(s, { left: dir < 0, right: dir > 0 });', '    p.x += p.vx * dt + (dash.owns ? dash.dx * 0.5 : 0);'),
  ] },
  'head-rush': { scale: 1, patches: [
    replaceWith('    for (let sub = 0; sub < SUB; sub++) {\n      // player', '    const dash = MotionDash.update(st, { right: true });', '    if (dash.owns) p.s = wrap(p.s + dash.dx, p.r);', '    for (let sub = 0; sub < SUB; sub++) {\n      // player'),
  ] },
  pileup: { scale: 8.4, patches: [
    replaceWith('    drive(p, C.PSPD, choosePlayer(st));', '    const dash = MotionDash.update(st, { right: true });', '    drive(p, C.PSPD + (dash.owns ? Math.round(dash.dx * 8.4) : 0), choosePlayer(st));'),
  ] },
  'zig-saber': { scale: 0.5, patches: [
    replaceWith('    sh.y += sh.dir * C.VY; st.camX += C.SCROLL;', '    const dash = MotionDash.update(st, { up: sh.dir < 0, down: sh.dir > 0 });', '    sh.y += sh.dir * C.VY + (dash.owns ? dash.dy * 0.5 : 0); st.camX += C.SCROLL;'),
  ] },
  'blink-scope': { scale: 1, patches: [
    replaceWith('  if (playing) g.sectorT += dt;', '  if (playing) g.sectorT += dt;', '  if (playing) {', '    const c = Math.cos(g.theta), n = Math.sin(g.theta);',
      '    const dash = MotionDash.update(g, { left: c < -0.4, right: c > 0.4, up: n < -0.4, down: n > 0.4 });', '    if (dash.owns) { g.px += dash.dx; g.py += dash.dy; }', '  }'),
  ] },
  'draft-line': { scale: 0.02, patches: [
    replaceWith('    this.x -= curve * this.speed * this.speed * S.CENTRIFUGAL * gMul * dt;', '    const dash = MotionDash.update(this, { left: input.steer < 0, right: input.steer >= 0 });', '    this.x -= curve * this.speed * this.speed * S.CENTRIFUGAL * gMul * dt;', '    if (dash.owns) this.x += dash.dx * 0.02;'),
  ] },
};
