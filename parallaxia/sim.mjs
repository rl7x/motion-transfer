import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadParallaxia } from '../recipients/parallaxia/load.mjs';

export const PARALLAXIA_SOURCE = fileURLToPath(
  new URL('../recipients/parallaxia/upstream/src', import.meta.url),
);

function replaceOnce(source, before, after, label) {
  assert.ok(source.includes(before), `Missing PARALLAXIA hook target: ${label}`);
  return source.replace(before, after);
}

export function patchParallaxiaSim(source) {
  let out = replaceOnce(
    source,
    '  sim.stage.drill = sim.drill;\n  sim.stage.sectionEnd = sim.frame;\n}',
    `  sim.stage.drill = sim.drill;
  sim.stage.sectionEnd = sim.frame;
  sim.px = sim.ship.x;
  sim.py = sim.ship.y;
  sim.vx = 0;
  sim.vy = 0;
  sim.facing = 1;
  sim.pitch = 0;
  sim.roll = 0;
  globalThis.roadsterPort?.reset(sim);
}`,
    'startRun reset hook',
  );
  out = replaceOnce(
    out,
    '    updateBullets(sim);\n    updateMultiplier(sim);\n  }',
    `    updateBullets(sim);
    updateMultiplier(sim);
    globalThis.parallaxiaChallengeStep?.(sim);
  }`,
    'stepSim challenge hook',
  );
  return out;
}

export function patchParallaxiaPlayer(source) {
  let out = replaceOnce(
    source,
    `  if (shipAbsent(ship)) return;

  let vx = 0;
  let vy = 0;
  const speed = MODES[sim.mode].shipSpeed;
  if (input & INPUT.UP) vy = speed;
  else if (input & INPUT.DOWN) vy = -speed;
  if (input & INPUT.RIGHT) vx = speed;
  else if (input & INPUT.LEFT) vx = -speed;
  if (vx !== 0 && vy !== 0) {
    vx *= SHIP.diagonal;
    vy *= SHIP.diagonal;
  }
  const limitX = FIELD.halfW - SHIP.margin;
  const limitY = FIELD.halfH - SHIP.margin;
  ship.x = Math.max(-limitX, Math.min(limitX, ship.x + vx));
  ship.y = Math.max(-limitY, Math.min(limitY, ship.y + vy));`,
    `  const absent = shipAbsent(ship);
  let vx = 0;
  let vy = 0;
  if (!absent) {
    const speed = MODES[sim.mode].shipSpeed;
    if (input & INPUT.UP) vy = speed;
    else if (input & INPUT.DOWN) vy = -speed;
    if (input & INPUT.RIGHT) {
      vx = speed;
      ship.facing = 1;
    } else if (input & INPUT.LEFT) {
      vx = -speed;
      ship.facing = -1;
    } else if (ship.facing === undefined) {
      ship.facing = 1;
    }
    if (vx !== 0 && vy !== 0) {
      vx *= SHIP.diagonal;
      vy *= SHIP.diagonal;
    }
  }
  sim.px = ship.x;
  sim.py = ship.y;
  sim.vx = vx * 60;
  sim.vy = vy * 60;
  sim.facing = ship.facing ?? 1;
  sim.pitch = 0;
  sim.roll = 0;
  const port = globalThis.roadsterPort;
  if (port) {
    for (let substep = 0; substep < 4; substep++) {
      port.substep(sim, sim.phase === "play" && !absent);
    }
  }
  if (absent) return;
  const dashStep = port?.movement(sim);
  const dx = dashStep !== null && dashStep !== undefined ? dashStep * 4 : vx;
  const limitX = FIELD.halfW - SHIP.margin;
  const limitY = FIELD.halfH - SHIP.margin;
  ship.x = Math.max(-limitX, Math.min(limitX, ship.x + dx));
  ship.y = Math.max(-limitY, Math.min(limitY, ship.y + vy));
  ship.dashing = dashStep !== null && dashStep !== undefined;
`,
    'updateShip dash hook',
  );
  out = replaceOnce(
    out,
    '  if (sim.phase !== "play" || shipInvincible(ship)) return;',
    `  if (sim.phase !== "play" || shipInvincible(ship)) return;
  if (globalThis.parallaxiaChallengeShield) {
    sim.events.push({ type: "hit", x: ship.x, y: ship.y });
    return;
  }`,
    'missShip phase-dash hook',
  );
  return out;
}

export function patchParallaxiaCanvas(source) {
  return replaceOnce(
    source,
    '  const ship = sim.ship;\n  if (sim.phase === "play" && !shipAbsent(ship) && !(shipInvincible(ship) && ship.respawn % 8 < 4)) {',
    `  const targetZone = globalThis.parallaxiaChallengeTarget;
  if (targetZone && Number.isFinite(targetZone.minX) && Number.isFinite(targetZone.maxX)) {
    const zx0 = sx(targetZone.minX);
    const zx1 = sx(targetZone.maxX);
    const zy0 = sy(-5.2);
    const zy1 = sy(-10.8);
    const zw = Math.max(8, zx1 - zx0);
    const zh = Math.max(8, zy1 - zy0);
    const lit = targetZone.phase === "landed" || (sim.frame >> 3) % 2 === 0;
    const zoneColor = targetZone.phase === "missed" ? C.danger : lit ? C.enemyLight : C.enemy;
    ctx.fillStyle = zoneColor;
    for (let y = zy0; y <= zy1; y += 4) {
      ctx.fillRect(zx0, y, 1, 2);
      ctx.fillRect(zx1, y, 1, 2);
    }
    ctx.fillRect(zx0, zy0, 6, 1);
    ctx.fillRect(zx1 - 5, zy0, 6, 1);
    ctx.fillRect(zx0, zy1, 6, 1);
    ctx.fillRect(zx1 - 5, zy1, 6, 1);
    text(ctx, "SAFE ZONE", Math.round((zx0 + zx1) / 2) - 18, zy0 - 7, zoneColor);
    if (zw > 6 && zh > 6) {
      ctx.fillStyle = targetZone.phase === "landed" ? "#39e05a33" : "#39e05a18";
      ctx.fillRect(zx0 + 1, zy0 + 1, zw - 1, zh - 1);
    }
  }
  const ship = sim.ship;
  if (Array.isArray(globalThis.parallaxiaAfterimages) && globalThis.parallaxiaAfterimages.length > 0) {
    const ghostShape = SHIP_SHAPES[sim.mode] ?? SPRITES.ship;
    for (const ghost of globalThis.parallaxiaAfterimages) {
      const gx = sx(ghost.x);
      const gy = sy(ghost.y) + 2;
      sprite(ctx, ghostShape, gx, gy, ghost.bright ? C.shot : C.shipTrim, C.farStar);
    }
  }
  if (sim.phase === "play" && !shipAbsent(ship) && !(shipInvincible(ship) && ship.respawn % 8 < 4)) {`,
    'canvas target and afterimage hook',
  );
}

export function parallaxiaHooks() {
  return {
    name: 'parallaxia-hooks',
    setup(buildInstance) {
      buildInstance.onLoad({ filter: /src\/sim\/sim\.js$/ }, async (args) => ({
        contents: patchParallaxiaSim(await readFile(args.path, 'utf8')),
        loader: 'js',
      }));
      buildInstance.onLoad({ filter: /src\/sim\/player\.js$/ }, async (args) => ({
        contents: patchParallaxiaPlayer(await readFile(args.path, 'utf8')),
        loader: 'js',
      }));
      buildInstance.onLoad({ filter: /src\/render\/canvas\.js$/ }, async (args) => ({
        contents: patchParallaxiaCanvas(await readFile(args.path, 'utf8')),
        loader: 'js',
      }));
    },
  };
}

const simModules = new Map();

export async function loadParallaxiaSim({ native = false } = {}) {
  if (simModules.has(native)) return simModules.get(native);
  await loadParallaxia();
  const entry = `
    export { createSim, stepSim, FPS, FRAME_MS, capabilities, observe, hashState } from './sim/sim.js';
    export { INPUT } from './sim/input.js';
    export { missShip, updateShip } from './sim/player.js';
    export { FIELD, VIEW, SHIP, MODES } from './sim/constants.js';
  `;
  const virtual = {
    name: 'parallaxia-sim-entry',
    setup(buildInstance) {
      buildInstance.onResolve({ filter: /^parallaxia-sim-entry$/ }, () => ({
        path: 'parallaxia-sim-entry',
        namespace: 'parallaxia-sim',
      }));
      buildInstance.onLoad({ filter: /.*/, namespace: 'parallaxia-sim' }, () => ({
        contents: entry,
        resolveDir: PARALLAXIA_SOURCE,
        loader: 'js',
      }));
    },
  };
  const result = await build({
    entryPoints: ['parallaxia-sim-entry'],
    bundle: true,
    write: false,
    format: 'esm',
    target: 'es2022',
    plugins: native ? [virtual] : [virtual, parallaxiaHooks()],
  });
  const code = result.outputFiles[0].text;
  const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  simModules.set(native, module);
  return module;
}
