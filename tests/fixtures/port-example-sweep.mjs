import vm from 'node:vm';

const PROBE = 'globalThis.__game = { update, step, TILE, MAP, tcell, get player() { return player; }, get monsters() { return monsters; } };\n})();';

/** Runs Tiny Platformer headless. Only saved, reviewed patches go through this; vm is not a security boundary. */
export function loadGame({ source, level, runtime = null }) {
  const context2d = new Proxy({}, { get: (target, key) => (key in target ? target[key] : () => {}), set: (target, key, value) => { target[key] = value; return true; } });
  const canvas = { getContext: () => context2d, width: 0, height: 0 };
  const box = { Math, JSON, FPSMeter: function () { return { tickStart() {}, tick() {} }; }, addEventListener() {}, requestAnimationFrame() {} };
  box.window = { requestAnimationFrame() {}, performance: { now: () => 0 } };
  box.document = { getElementById: () => canvas, addEventListener() {} };
  box.XMLHttpRequest = class { open() {} send() { this.readyState = 4; this.status = 200; this.responseText = level; this.onreadystatechange(); } };
  vm.createContext(box);
  if (runtime) vm.runInContext(runtime, box);
  const end = source.lastIndexOf('})();');
  vm.runInContext(source.slice(0, end) + PROBE, box);
  return box;
}

const fields = entity => [entity.x, entity.y, entity.dx, entity.dy, entity.falling, entity.jumping, entity.left, entity.right, entity.dead];

/** With no dash, the patched game must match the original on every tick under scripted input. */
export function firstDivergence({ original, patched, level, runtime, seeds = [11, 22, 33], ticks = 1200 }) {
  for (const seed of seeds) {
    const before = loadGame({ source: original, level }).__game, after = loadGame({ source: patched, level, runtime }).__game;
    let state = seed, held = {};
    const next = () => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state; };
    for (let tick = 0; tick < ticks; tick += 1) {
      if (tick % 20 === 0) held = { left: next() % 3 === 0, right: next() % 3 === 1, jump: next() % 4 === 0 };
      for (const game of [before, after]) { Object.assign(game.player, held); game.update(game.step); }
      const left = JSON.stringify([fields(before.player), before.monsters.map(fields)]);
      if (left !== JSON.stringify([fields(after.player), after.monsters.map(fields)])) return { seed, tick };
    }
  }
  return null;
}

const SITUATIONS = [
  { lead: { right: true }, ticks: 1, dash: { right: true } }, { lead: { left: true }, ticks: 1, dash: { left: true } },
  { lead: { right: true }, ticks: 24, dash: { left: true } }, { lead: { left: true }, ticks: 24, dash: { right: true } },
  { lead: {}, ticks: 0, dash: { right: true } }, { lead: {}, ticks: 0, dash: { left: true } }, { lead: {}, ticks: 0, dash: { jump: true } },
  { lead: { jump: true }, ticks: 10, dash: { right: true } }, { lead: { jump: true }, ticks: 10, dash: { left: true } },
];
const NO_KEYS = { left: false, right: false, jump: false };

/** Dashes from every standing spot in nine situations, following the player's centre along each tick's whole path. */
export function sweepDashes({ source, level, runtime, useDash = true }) {
  const { TILE, MAP, tcell } = loadGame({ source, level, runtime }).__game;
  const solid = (tx, ty) => tx >= 0 && ty >= 0 && tx < MAP.tw && ty < MAP.th && Boolean(tcell(tx, ty));
  const spots = [];
  for (let ty = 0; ty < MAP.th - 1; ty += 1) for (let tx = 1; tx < MAP.tw - 1; tx += 1) if (!solid(tx, ty) && solid(tx, ty + 1)) spots.push([tx, ty]);
  const totals = { dashes: 0, fired: 0, enteredWalls: 0, leftMap: 0 };
  for (const plan of SITUATIONS) for (const [tx, ty] of spots) {
    const box = loadGame({ source, level, runtime }), game = box.__game, player = game.player;
    game.monsters.length = 0;
    Object.assign(player, NO_KEYS, { x: tx * TILE, y: ty * TILE, dx: 0, dy: 0, falling: false });
    for (let tick = 0; tick < 12; tick += 1) game.update(game.step);
    Object.assign(player, NO_KEYS, plan.lead);
    for (let tick = 0; tick < plan.ticks; tick += 1) game.update(game.step);
    Object.assign(player, NO_KEYS, plan.dash);
    box.MotionDash.held = useDash;
    const before = box.MotionDash.events.length;
    let entered = false, left = false, lastX = player.x, lastY = player.y;
    for (let tick = 0; tick < 14; tick += 1) {
      game.update(game.step);
      if (tick === 1) box.MotionDash.held = false;
      for (let sample = 1; sample <= 12; sample += 1) {
        const x = lastX + (player.x - lastX) * sample / 12 + TILE / 2, y = lastY + (player.y - lastY) * sample / 12 + TILE / 2;
        if (solid(Math.floor(x / TILE), Math.floor(y / TILE))) entered = true;
      }
      if (player.x < 0 || player.y < 0 || player.x > (MAP.tw - 1) * TILE || player.y > (MAP.th - 1) * TILE) left = true;
      lastX = player.x; lastY = player.y;
    }
    totals.dashes += 1;
    if (box.MotionDash.events.slice(before).includes('dash-start')) totals.fired += 1;
    if (entered) totals.enteredWalls += 1;
    if (left) totals.leftMap += 1;
  }
  return totals;
}
