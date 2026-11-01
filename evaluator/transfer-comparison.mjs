import assert from 'node:assert/strict';
import { recordDonorMotion } from './dashy-dango.mjs';
import { createPakuBrowser, startPaku } from './browser-harness.mjs';
import { loadPakuTransfer } from '../transfer/saved-paku.mjs';
import { loadJujumpTransfer } from '../transfer/jujump.mjs';
import { compileAdapter } from '../transfer/adapter.mjs';
import { init,step } from '../components/dashy-dango-dash/component.js';

export async function recordTransferComparison(){
  const paku=await loadPakuTransfer(),jujump=await loadJujumpTransfer();
  assert.equal(paku.componentId,jujump.componentId);
  const compiled=await compileAdapter(paku.source),harness=await createPakuBrowser({adapter:compiled});
  let pakuFrames;
  try{
    const {page,errors}=await harness.page('transfer');
    await startPaku(page);
    pakuFrames=await page.evaluate(()=>{
      const frames=[pakuSnapshot()];
      for(let index=1;index<100;index++){
        if(index===10)document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD',bubbles:true}));
        pakuFixture({playerX:30,facing:1,enemyX:100,eyeVx:-1,powerTicks:0});
        gameClock.advance();frames.push(pakuSnapshot());
      }
      return frames.map(state=>({tick:state.ticks,core:state.motion.core,output:state.motion.output}));
    });
    assert.deepEqual(errors,[]);await page.close();
  }finally{await harness.close();}
  const donor=await recordDonorMotion({name:'shared-dash-comparison',steps:[{buttons:32,frames:10},{buttons:33,frames:90}]});
  const direct=[];let core=init(compiled.defaults);
  for(let index=0;index<100;index++){
    const result=step(core,{buttons:index>=10?33:32,sourceBodyWidth:8},compiled.defaults);core=result.state;
    direct.push({tick:index+1,core,output:result.output});
  }
  const convert=(frames,scale,donorFrames=false)=>{
    let cumulative=0;
    return frames.map(frame=>{
      const output=frame.output,state=donorFrames?frame.observation:frame.core;
      const dx=typeof output.displacement==='number'?output.displacement:output.displacement.x;
      const pixels=output.ownsMotion?dx:0;cumulative+=pixels/scale;
      return{tick:frame.tick,pixels,sourcePixels:pixels/scale,cumulativeSourcePixels:cumulative,active:output.ownsMotion,
        cooldown:state.cooldown,remaining:state.remaining,events:output.events};
    });
  };
  const lanes=[{id:'donor',name:'Compiled donor',scale:1,frames:convert(donor.frames,1,true)},
    {id:'component',name:'Standalone component',scale:1,frames:convert(direct,1)},
    {id:'paku-paku',name:'PAKU PAKU',scale:0.5,frames:convert(pakuFrames,0.5)},
    {id:'jujump',name:'JUJUMP',scale:0.5,frames:convert(jujump.report.browser.traces.timing.frames,0.5)}];
  for(const lane of lanes.slice(1))for(let index=0;index<100;index++){
    const expected=lanes[0].frames[index],actual=lane.frames[index];
    assert.ok(Math.abs(expected.sourcePixels-actual.sourcePixels)<1e-9);
    assert.equal(actual.cooldown,expected.cooldown);assert.equal(actual.remaining,expected.remaining);
    assert.deepEqual(actual.events,expected.events);
  }
  return{schemaVersion:1,passed:true,metaCalled:false,componentId:paku.componentId,
    adapters:{paku:paku.sourceSha256,jujump:jujump.sourceSha256},
    fixture:'100 controlled logical updates: hold right; hold dash from tick 11. Recipient position fixtures isolate free-space controller output. JUJUMP changes facing during the first dash.',
    scope:'Measured requested dash movement, not universal world-position equivalence. Ordinary movement omitted. Collision and ordinary-behavior checks are separate.',
    activationTicks:[11,44,77],endTicks:[18,51,84],lanes,airborne:jujump.report.browser.traces.airborne};
}
