import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRoadster } from '../recipients/roadster/load.mjs';

test('roadster recipient retains its pinned upstream source and notices',async()=>{
  const recipient=await loadRoadster();
  assert.equal(recipient.manifest.revision,'8486687c6c885d49231744d5d9434ac4fe21f951');
  assert.equal(recipient.manifest.license,'MIT');
  assert.match(recipient.notices,/sebayaki.eth/);
  assert.match(recipient.notices,/three.js|three\.js authors/i);
  assert.match(recipient.files['src/physics/car-physics.ts'].toString(),/class CarPhysics/);
});
