export function evidenceHistory(report) {
  const catalog = new Map();
  const observations = report.toolCalls.filter(call => call.ok).map(call => {
    if (call.name !== 'run_original') return { tool: call.name, result: call.result };
    return {
      experimentId: call.experimentId,
      hypothesis: call.args.hypothesis,
      inputs: call.args.steps,
      checkpoints: call.result.checkpoints.map(checkpoint => ({
        checkpoint: checkpoint.checkpoint,
        frame: checkpoint.frame,
        framebufferFingerprint: checkpoint.framebufferHash.slice(0, 12),
        text: checkpoint.text,
        textTruncated: checkpoint.textTruncated,
        palette: checkpoint.palette,
        omittedSpriteGroups: checkpoint.omittedSpriteGroups,
        sprites: checkpoint.sprites.map(group => {
          const key = `${group.pointer}:${group.spriteSha256}:${group.drawColors}:${group.width}:${group.height}`;
          if (!catalog.has(key)) catalog.set(key, {
            id: `sprite-${catalog.size + 1}`, pointer: group.pointer,
            pixelFingerprint: group.spriteSha256.slice(0, 12),
            width: group.width, height: group.height, drawColors: group.drawColors,
          });
          return {
            id: catalog.get(key).id, count: group.count,
            positions: group.positions.map(position => [position.x, position.y, position.flags]),
            omittedPositions: group.omittedPositions,
          };
        }),
        tones: checkpoint.tones,
      })),
    };
  });
  return [
    { role: 'user', content: [{ type: 'input_text', text: report.question }] },
    { role: 'user', content: [{
      type: 'input_text',
      text: 'The following ledger contains actual completed tool observations from this investigation. Prior model reasoning has been discarded. Hypotheses are not established facts. Fingerprints are 12-character prefixes; full hashes and raw observations remain in the local report. Sprite positions are [x,y,flags]. Use this evidence to continue, and cite experiment IDs.\n'
        + JSON.stringify({ spriteCatalog: [...catalog.values()], observations }),
    }] },
  ];
}
