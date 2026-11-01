export function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('Pinned recipient/runtime hook no longer matches exactly once');
  return source.replace(before, () => after);
}

export function clockedPakuRuntime(source) {
  source = source.replaceAll('\r\n', '\n');
  const begin = '        requestAnimationFrame(update$3);\n';
  const end = '        if (options$1.isSoundEnabled) {';
  const start = source.indexOf(begin), stop = source.indexOf(end, start);
  if (start < 0 || stop < 0 || !source.slice(start, stop).includes('const now = window.performance.now();')) throw new Error('Unknown recipient loop layout');
  source = source.slice(0, start) + '        window.gameClock.schedule(update$3);\n' + source.slice(stop);
  return replaceOnce(source, '        seed = opts.seed;',
    '        seed = opts.seed;\n        seedRandom.setSeed(window.gameClock.seed);\n        random$1.setSeed(window.gameClock.seed);');
}

export function pakuObservationSource() {
  return `
    window.pakuStatus = 'title';
    const baseEnd = window.end;
    window.end = function(...args) { window.pakuStatus = 'game-over'; return baseEnd(...args); };
    const baseUpdate = window.update;
    window.update = function() {
      if (ticks === 0) window.pakuStatus = 'playing';
      baseUpdate();
    };
    window.pakuSnapshot = () => structuredClone({ticks, score, player, enemy, dots, powerTicks, multiplier, status:window.pakuStatus});
    if (new URL(location.href).searchParams.get('test') === '1') {
      window.pakuFixture = value => {
        if (!player || !enemy) throw Error('Start gameplay before applying a fixture');
        if (value.playerX !== undefined) player.x = value.playerX;
        if (value.facing !== undefined) player.vx = value.facing;
        if (value.enemyX !== undefined) enemy.x = value.enemyX;
        if (value.eyeVx !== undefined) enemy.eyeVx = value.eyeVx;
        if (value.powerTicks !== undefined) powerTicks = value.powerTicks;
        if (value.dots !== undefined) dots = structuredClone(value.dots);
      };
    }
  `;
}
