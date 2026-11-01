import assert from 'node:assert/strict';
import { compileAdapter,executeAdapter } from '../transfer/adapter.mjs';
import { loadRecoveredMotion } from '../component/load.mjs';
import * as core from '../components/dashy-dango-dash/component.js';
import { ROADSTER_INTENT,validateRoadsterIntent } from '../roadster/port.mjs';

export async function evaluateRoadsterAdapter(source,intent=ROADSTER_INTENT){
  validateRoadsterIntent(intent);const component=await loadRecoveredMotion(),compiled=await compileAdapter(source);
  const frames=(count,fn)=>Array.from({length:count},(_,i)=>({tick:i+1,position:10,facing:1,normalDisplacement:.2,dash:false,airborne:true,...fn(i)}));
  const traces=[
    {name:'grounded-held',frames:frames(100,()=>({airborne:false,dash:true}))},
    {name:'airborne-held',frames:frames(140,()=>({dash:true}))},
    {name:'fresh-press-and-cooldown',frames:frames(110,i=>({dash:[4,14,47,80].includes(i)}))},
    {name:'held-through-launch',frames:frames(90,i=>({dash:true,airborne:i>=20}))},
    {name:'landing-during-dash',frames:frames(80,i=>({dash:true,airborne:i<13||i>=55}))},
    {name:'facing-and-neutral-input',frames:frames(100,i=>({dash:i%40>=10,facing:i%2?-1:1}))},
    {name:'ordinary-motion',frames:frames(80,i=>({normalDisplacement:(i%7-3)*.17}))},
    {name:'component-counterfactuals',frames:frames(30,i=>({dash:i%3===0})),mockOutputs:Array.from({length:30},(_,i)=>({ownsMotion:i%2===0,displacement:{x:i%2===0?(i%4===0?-3.25:1.75):0,y:0},events:i===2?['dash-start']:i===4?['dash-end']:[]}))},
  ].map(trace=>({...trace,scale:intent.unitScale}));
  const observed=await executeAdapter(compiled,traces),results=[];
  for(let i=0;i<traces.length;i++){
    const trace=traces[i],actual=observed[i];let state=core.init(component.contract.defaults),previous=false,maxError=0;const starts=[],ends=[];
    try{
      for(let tick=0;tick<trace.frames.length;tick++){
        const frame=trace.frames[tick],activate=frame.airborne&&frame.dash&&(intent.activation==='held'||!previous);previous=frame.dash;
        const direction=frame.facing*(intent.direction==='opposite'?-1:1),input={buttons:(direction<0?16:32)|(activate?1:0),sourceBodyWidth:8};
        assert.deepEqual(actual.inputs[tick],input,'Mapped component input differs');
        const reference=trace.mockOutputs?null:core.step(state,input,component.contract.defaults);
        const expected=trace.mockOutputs?.[tick]??reference.output;
        if(reference)state=reference.state;
        const output=actual.outputs[tick],displacement=expected.ownsMotion?expected.displacement.x*intent.unitScale:frame.normalDisplacement;
        const error=Math.abs(output.displacement-displacement);maxError=Math.max(maxError,error);assert.ok(error<1e-9,'Mapped displacement differs');
        assert.equal(output.ownsMotion,expected.ownsMotion);assert.deepEqual(output.events,expected.events);
        if(output.events.includes('dash-start'))starts.push(tick+1);if(output.events.includes('dash-end'))ends.push(tick+1);
      }
      results.push({name:trace.name,passed:true,updates:trace.frames.length,maxError,starts,ends});
    }catch(error){results.push({name:trace.name,passed:false,error:error.message});}
  }
  return{gate:'roadster-conformance',passed:results.every(result=>result.passed),componentId:component.provenance.id,sourceSha256:compiled.sourceSha256,javascriptSha256:compiled.javascriptSha256,intent,results};
}
