import assert from 'node:assert/strict';
import test from 'node:test';
import {loadRoadsterPhysics} from '../src/roadster/physics.mjs';
import {createRoadsterPort} from '../src/roadster/port.mjs';
import * as component from '../assets/components/dashy-dango-dash/component.js';
import {loadRecoveredMotion} from '../src/component/load.mjs';

test('dash-disabled host matches upstream stunt simulation exactly',async()=>{
  const original=await loadRoadsterPhysics({hooked:false}),hooked=await loadRoadsterPhysics();
  globalThis.roadsterPort=createRoadsterPort({});
  try{for(const id of ['backflip','kickflip']){
    const a=new original.CarPhysics(original.getLevel(id)),b=new hooked.CarPhysics(hooked.getLevel(id));
    const driver=original.createAutopilot(a.level);const events=[];
    for(let tick=0;tick<1800;tick++){const input={...driver(a.car,1/60)};a.step(1/60,input);b.step(1/60,input);assert.deepEqual(b.car,a.car);assert.deepEqual(b.drainEvents(),a.drainEvents());events.push(a.car.mode);}
    assert.ok(events.includes('airborne'));
  }}finally{delete globalThis.roadsterPort;}
});

test('the port clocks the unchanged recovered core at 60 Hz over 240 Hz physics',async()=>{
  const {contract}=await loadRecoveredMotion();
  const adapter={init(motion,config){return{core:motion.init(config.motion)};},step(state,frame,motion,config){const result=motion.step(state.core,{buttons:32|(frame.dash&&frame.airborne?1:0),sourceBodyWidth:8},config.motion);return{state:{core:result.state},output:{...result.output,displacement:result.output.ownsMotion?result.output.displacement.x*config.unitScale:frame.normalDisplacement}};}};
  const port=createRoadsterPort({component,adapter,defaults:contract.defaults}),body={px:0,vx:10};port.reset(body);port.setDash(true);
  let distance=0;const starts=[];
  for(let substep=0;substep<400;substep++){port.substep(body,true);distance+=port.movement(body)??0;if(substep%4===0&&port.snapshot(body).output.events.includes('dash-start'))starts.push(port.snapshot(body).tick);}
  assert.deepEqual(starts,[11,44,77]);assert.equal(port.snapshot(body).coreCalls,100);assert.ok(Math.abs(distance-18)<1e-9);
});
