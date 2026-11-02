export function evidenceHistory(report) {
  const catalog = new Map();
  const observations = report.toolCalls.filter(call => call.ok).map(call => {
    if (call.name !== 'run_original') return { tool: call.name, result: call.result };
    return {
      experimentId: call.experimentId,
      hypothesis: call.args.hypothesis,
      inputs: call.args.steps,
      memoryWatches: call.args.watches ?? [],
      checkpoints: call.result.checkpoints.map(checkpoint => ({
        checkpoint: checkpoint.checkpoint,
        frame: checkpoint.frame,
        motion: checkpoint.motion??null,
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
        memory: (checkpoint.memory ?? []).map(watch => ({ name: watch.name, values: watch.values, bytesHex: watch.bytesHex })),
      })),
    };
  });
  return [
    { role: 'user', content: [{ type: 'input_text', text: report.question }] },
    { role: 'user', content: [{
      type: 'input_text',
      text: 'The following ledger contains actual completed tool observations from this investigation. Prior model reasoning has been discarded. Hypotheses are not established facts. Fingerprints are 12-character prefixes; full hashes and raw observations remain in the local report. Sprite positions are [x,y,flags]. Use this evidence to continue, and cite experiment IDs.\n'
        + JSON.stringify({ spriteCatalog: [...catalog.values()], observations,...(report.session?{currentSession:{id:report.session.id,identity:report.session.identity,branches:report.session.branches.map(({id,experimental,parentCheckpointId,verification})=>({id,experimental,parentCheckpointId,verification})),checkpoints:report.session.checkpoints.map(({id,label,verification})=>({id,label,verification})),annotations:report.session.annotations,findings:report.session.findings,latestDevelopmentCandidate:report.session.recovery?.attempts.at(-1),frozenCandidateId:report.session.recovery?.frozenCandidateId}}:{}) }),
    }] },
    ...(report.session?.captures?.length?[{role:'user',content:[{type:'input_text',text:'Most recent actual framebuffer capture; its identity is preserved in the tool ledger.'},{type:'input_image',image_url:report.session.captures.at(-1).dataUrl}]}]:[]),
  ];
}
