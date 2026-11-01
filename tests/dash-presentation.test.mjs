import assert from 'node:assert/strict';
import test from 'node:test';
import {createDashPresentation} from '../roadster/dash-presentation.mjs';

const sample=(tick,active)=>Object.freeze({tick,output:Object.freeze({ownsMotion:active,events:Object.freeze(tick===1?['dash-start']:tick===8?['dash-end']:[])}),pose:Object.freeze({x:tick*.75,y:20,pitch:0,roll:0})});
test('visual hold lasts three logical updates and five fading poses survive the dash',()=>{
  const presentation=createDashPresentation(),holds=[];
  for(let tick=1;tick<=8;tick++){presentation.observe(sample(tick,true));holds.push(presentation.snapshot().hold);}
  assert.deepEqual(holds,[true,true,true,false,false,false,false,false]);
  assert.equal(presentation.snapshot().afterimages.length,5);
  const poses=presentation.snapshot().afterimages.map(image=>image.pose.x);assert.deepEqual(poses,[3,3.75,4.5,5.25,6]);
  presentation.observe(sample(10,false));assert.ok(presentation.snapshot().afterimages.length>0);
  presentation.observe(sample(14,false));assert.equal(presentation.snapshot().afterimages.length,0);
  presentation.reset();assert.equal(presentation.snapshot().hold,false);assert.equal(presentation.snapshot().afterimages.length,0);
});
test('reduced motion keeps rendering responsive without a hold or afterimages',()=>{
  const presentation=createDashPresentation({reducedMotion:true});
  for(let tick=1;tick<=14;tick++){presentation.observe(sample(tick,tick<=8));assert.equal(presentation.snapshot().hold,false);assert.deepEqual(presentation.snapshot().afterimages,[]);}
});
