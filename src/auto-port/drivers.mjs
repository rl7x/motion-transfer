import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/*
 * Human-written measuring sticks, frozen before any model request. Spark never writes or sees these.
 * A session replays the game's own bot, reads the avatar and supplies a steady heading for the dash
 * measurement, so a generated patch cannot change how it is graded.
 */
const cjs = (directory, file) => createRequire(join(directory, 'host.cjs'))(join(directory, file));
const esm = (directory, file) => import(pathToFileURL(join(directory, file)).href);

const skyhaul = {
  id: 'skyhaul', status: 'eligible', core: 'core.js', tests: ['tests/core.test.cjs'], dashKey: 'KeyX', field: 320,
  load: dir => ({ game: cjs(dir, 'core.js'), bots: cjs(dir, 'bots.js') }),
  session({ game, bots }, seed) {
    const state = game.createGame(seed), policy = bots.fixedHaul(3);
    return { state, act: () => policy(state), step: input => game.step(state, input), idle: { dx: 0, dy: 0 }, heading: { dx: 1, dy: 0 } };
  },
  ready: state => state.phase === 'play' && Boolean(state.lander?.alive),
  position: state => ({ x: state.lander.x, y: state.lander.y }),
  distance: ({ game }, a, b) => Math.hypot(game.wrapDelta(a.x - b.x), a.y - b.y),
};

const undertow = {
  id: 'undertow', status: 'eligible', core: 'core.js', tests: ['tests/core.test.cjs'], dashKey: 'KeyC', field: 320,
  load: dir => ({ game: cjs(dir, 'core.js'), bots: cjs(dir, 'bots.js') }),
  session({ game, bots }, seed) {
    const state = game.newGame(seed), bot = bots.oracleBot({ seed, gather: 2, race: true, ferry: false, name: 'o2' });
    return { state, act: () => bot.act(state), step: input => game.step(state, input), idle: { x: 0, y: 0 }, heading: { x: 1, y: 0 } };
  },
  ready: state => state.mode === 'play' && Boolean(state.player),
  position: state => ({ x: state.player.x, y: state.player.y }),
  distance: ({ game }, a, b) => Math.hypot(game.dx(a.x, b.x), a.y - b.y),
};

const wreckfall = {
  id: 'wreckfall', status: 'eligible', core: 'core.js', tests: ['tests/core.test.cjs'], dashKey: 'KeyC', field: 320,
  load: dir => ({ game: cjs(dir, 'core.js'), bots: cjs(dir, 'bots.js') }),
  session({ game, bots }, seed) {
    const state = game.createGame(seed), bot = bots.nearestBot();
    return { state, act: () => bot.update(state) || {}, step: input => game.step(state, input), idle: {}, heading: { right: true } };
  },
  ready: state => state.mode === 'play' && state.player.alive === true,
  position: state => ({ x: state.player.x, y: 0 }),
  distance: (_, a, b) => Math.abs(a.x - b.x),
};

const headRush = {
  id: 'head-rush', status: 'eligible', core: 'core.js', tests: ['tests/rules.cjs'], dashKey: 'KeyC', field: 200,
  load: dir => ({ game: cjs(dir, 'core.js'), bots: cjs(dir, 'bots.js') }),
  session({ game, bots }, seed) {
    const state = game.create(seed), policy = bots.simple.mash(seed);
    return { state, act: () => policy(state) || {}, step: input => game.step(state, input), idle: {}, heading: {} };
  },
  ready: state => state.phase === 'play' && Boolean(state.player),
  position: state => ({ x: state.player.s, y: state.player.r }),
  distance: (_, a, b) => Math.abs(a.x - b.x),
};

const pileup = {
  id: 'pileup', status: 'eligible', core: 'core.js', tests: ['tests/rules.cjs'], dashKey: 'KeyC', field: 200,
  load: dir => ({ game: cjs(dir, 'core.js'), adapter: cjs(dir, 'tests/adapter.cjs') }),
  session({ game, adapter }, seed) {
    const state = game.create(seed), policy = adapter.policies.human.make(seed);
    return { state, act: () => policy(state), step: input => game.step(state, input), idle: {}, heading: {} };
  },
  ready: state => state.phase === 'play' && Boolean(state.p),
  position: state => ({ x: state.p.x, y: state.p.y }),
  distance: (_, a, b) => Math.hypot(a.x - b.x, a.y - b.y),
};

const zigSaber = {
  id: 'zig-saber', status: 'eligible', core: 'core.js', tests: ['tests/rules.cjs'], dashKey: 'KeyC', field: 240,
  load: dir => ({ game: cjs(dir, 'core.js'), bots: cjs(dir, 'bots.js') }),
  session({ game, bots }, seed) {
    const state = game.newGame({}), policy = bots.simple.mash(seed + 5);
    return { state, act: () => state.phase === 'play' && Boolean(policy(state)), step: input => game.step(state, input), idle: false, heading: false };
  },
  ready: state => state.phase === 'play',
  position: state => ({ x: 0, y: state.ship.y }),
  distance: (_, a, b) => Math.abs(a.y - b.y),
};

const blinkScope = {
  id: 'blink-scope', status: 'eligible', core: 'game-core.js', tests: ['tests/core.test.mjs'], dashKey: 'KeyC', field: 400,
  load: async dir => ({ game: await esm(dir, 'game-core.js'), bots: await esm(dir, 'demo-bot.js') }),
  session({ game, bots }, seed) {
    const state = game.createGame(seed), policy = bots.makePilot(game.makeRng(seed * 7919 + 13));
    let events = [];
    return { state, act: () => policy(state, events), step: press => { events = [...game.step(state, 1 / 60, press)]; }, idle: false, heading: false };
  },
  ready: state => state.phase === 'play',
  position: state => ({ x: state.px, y: state.py }),
  distance: (_, a, b) => Math.hypot(a.x - b.x, a.y - b.y),
};

const draftLine = {
  id: 'draft-line', status: 'eligible', core: 'src/sim.js', tests: ['test/sim.test.mjs', 'test/chain.test.mjs'], dashKey: 'KeyC', field: 3.8,
  skip: ['course'],
  load: async dir => ({ sim: await esm(dir, 'src/sim.js'), course: await esm(dir, 'src/course.js'), driver: await esm(dir, 'src/driver.js') }),
  session({ sim, course, driver }, seed) {
    const road = new course.Course(seed), state = new sim.Sim(road, seed), drive = driver.makeDriver({ useTow: true, release: 'expert' });
    return { state, act: () => drive(state, road), step: input => state.step(1 / 60, input), idle: { throttle: 1, steer: 0, boost: false }, heading: { throttle: 1, steer: 0, boost: false } };
  },
  ready: state => !state.gameOver && !state.finished && !(state.spin > 0),
  position: state => ({ x: state.x, y: 0 }),
  distance: (_, a, b) => Math.abs(a.x - b.x),
};

export const DRIVERS = Object.freeze({
  skyhaul, undertow, wreckfall, 'head-rush': headRush, pileup, 'zig-saber': zigSaber, 'blink-scope': blinkScope, 'draft-line': draftLine,
});

/** Excluded before any model request, with the reason published in the results. */
export const EXCLUDED = Object.freeze({
  overturn: 'Flipperless pinball: the only control rotates the table, so there is no steerable avatar to dash.',
  'twin-vector': 'The avatar moves between discrete lanes, so a measured pixel burst has no defined meaning.',
});
