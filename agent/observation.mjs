export function summarizeObservation(observation) {
  const groups = new Map();
  for (const call of observation.drawCalls) {
    if (call.name !== 'blit') continue;
    const [pointer, x, y, width, height, flags] = call.args;
    const key = `${pointer}:${width}:${height}:${call.drawColors}:${call.spriteSha256}`;
    if (!groups.has(key)) groups.set(key, {
      pointer, width, height, drawColors: call.drawColors, spriteSha256: call.spriteSha256, count: 0, positions: [],
    });
    const group = groups.get(key);
    group.count++;
    if (group.positions.length < 4) group.positions.push({ x, y, flags });
  }
  const text = observation.drawCalls.filter(call => call.name === 'textUtf8').map(call => call.text);
  return {
    checkpoint: observation.checkpoint,
    frame: observation.frame,
    framebufferHash: observation.framebufferHash,
    memoryHash: observation.memoryHash,
    storage: observation.storage,
    palette: observation.palette,
    text: text.join('\n').slice(0, 1_000),
    textTruncated: text.join('\n').length > 1_000,
    sprites: [...groups.values()].slice(0, 8).map(group => ({
      ...group, omittedPositions: group.count - group.positions.length,
    })),
    omittedSpriteGroups: Math.max(0, groups.size - 8),
    tones: observation.tones,
    memory: observation.memory ?? [],
    motion: observation.motion??null,
  };
}

