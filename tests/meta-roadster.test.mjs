import assert from 'node:assert/strict';
import test from 'node:test';
import {generateRoadsterTransfer} from '../agent/transfer-roadster.mjs';
import {roadsterAdapterFixture} from './helpers/roadster-adapter.mjs';
import {ROADSTER_INTENT} from '../roadster/port.mjs';
const parent={id:'0'.repeat(64),intent:ROADSTER_INTENT,files:{}};
test('Roadster generation counts tokens, delegates verification and retains actual usage',async()=>{
  let calls=0;
  const source=roadsterAdapterFixture();
  const result=await generateRoadsterTransfer({parent,prompt:'Use the default mapping.',client:{countInputTokens:async()=>1000,respond:async request=>{
    calls++;assert.equal(request.model,'muse-spark-1.3');assert.equal(request.store,false);
    return{id:'fixture-response',status:'completed',usage:{input_tokens:1000,output_tokens:200},output:[{type:'function_call',name:'submit_roadster_adapter',arguments:JSON.stringify({source,summary:'Fixture mapping',intent:ROADSTER_INTENT})}]};
  }},verifyBrowser:async()=>({passed:true,fixture:true})});
  assert.equal(calls,1);assert.equal(result.metadata.componentId.length,64);assert.equal(result.metadata.parentArtifactId,null);
  const generation=JSON.parse(result.files['generation.json']);assert.equal(generation.status,'verified');assert.equal(generation.reservedCostUsd,0);assert.ok(generation.estimatedCostUsd<.01);
});
test('Roadster preflight and uncertain transport cannot bypass spending controls',async()=>{
  let calls=0;
  await assert.rejects(generateRoadsterTransfer({parent,prompt:'Use default.',maxCostUsd:.001,client:{countInputTokens:async()=>1000,respond:async()=>{calls++;}}}),/budget cannot cover/);assert.equal(calls,0);
  await assert.rejects(generateRoadsterTransfer({parent,prompt:'Use default.',client:{countInputTokens:async()=>1000,respond:async()=>{calls++;throw Error('uncertain transport');}}}),error=>{assert.ok(error.report.reservedCostUsd>0);assert.equal(error.report.requests[0].status,'unsettled');return true;});assert.equal(calls,1);
});
