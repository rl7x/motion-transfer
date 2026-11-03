import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createReplayRuntime} from '../src/runtime/replay.mjs';
import {loadTarget} from '../src/agent/target.mjs';
import {observeDonorMotion} from '../src/runtime/donor-observation.mjs';

test('the actual donor moves immediately and leaves five updates of afterimages',async()=>{
  const saved=JSON.parse(await readFile(new URL('../assets/transfers/roadster/presentation-evidence.json',import.meta.url),'utf8'));
  const target=await loadTarget();assert.equal(saved.cartridgeSha256,target.sha256);
  const runtime=await createReplayRuntime(target.bytes);runtime.step(1);for(let i=0;i<10;i++)runtime.step(0);
  const samples=[];
  for(let tick=1;tick<=15;tick++){
    const frame=runtime.step(tick<=8?33:0),motion=observeDonorMotion(runtime);
    const bodies=frame.drawCalls.filter(call=>call.name==='blit'&&call.args[0]===17540&&call.args[2]>8&&call.args[2]<145);
    samples.push({tick,worldX:motion.position.x,remaining:motion.remaining,bodyDraws:bodies.length,screenPositions:bodies.map(call=>[call.args[1],call.args[2]])});
  }
  assert.deepEqual(samples,saved.samples);assert.equal(samples[0].worldX,7.5);assert.equal(samples[7].worldX,60);
  assert.equal(Math.max(...samples.map(sample=>sample.bodyDraws)),6);assert.equal(samples[12].bodyDraws,1);
});
