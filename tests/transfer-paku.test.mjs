import assert from 'node:assert/strict';
import test from 'node:test';
import { transferPaku, prepareTransferEvidence } from '../agent/transfer-paku.mjs';
import { digest } from '../component/build.mjs';

const evidence = { component: {id:'component-fixture'}, recipient:{revision:'recipient-fixture'}, note:'Mock orchestration evidence only' };
const candidate = { source:'export const init=()=>({}); export const step=()=>({});', mapping:'Unit test fixture', limitations:['Not a transfer implementation'] };
const reply = () => ({ id:'mock-adapter',status:'completed',
  usage:{input_tokens:2000,output_tokens:500,input_tokens_details:{cached_tokens:1000},output_tokens_details:{reasoning_tokens:200}},
  output:[{type:'reasoning',encrypted_content:'private-test-state'}, {type:'function_call',name:'submit_transfer_adapter',status:'completed',arguments:JSON.stringify(candidate)}],
});

test('transfer evidence contains the pinned recipient, unchanged component, and declared port policy', async()=>{
  const actual = await prepareTransferEvidence();
  assert.equal(actual.recipient.revision,'6fea4eefe2deaa42706051d96a04ec9e36104696');
  assert.equal(actual.component.id,'1bc4250c3ca3c1e9a59849d0fd1335e9f7a02a95184d7d51fd6ac678d83226a2');
  assert.equal(actual.policy.sourceBodyWidth,8);
  assert.match(actual.recipient.hookedSource,/motionPort.move/);
  assert.doesNotMatch(actual.recipient.source,/motionPort/);
  assert.doesNotMatch(JSON.stringify(actual),/MODEL_API_KEY|firstDivergence|counterfactual-component-output/);
});

test('bounded adapter synthesis repairs public conformance failures and keeps browser status separate', async()=>{
  const requests=[];let checks=0;
  const report=await transferPaku({apiKey:'fake-secret',evidence,
    client:{countInputTokens:async()=>3000,respond:async request=>{requests.push(request);return reply();}},
    evaluate:async source=>({passed:++checks===2,sourceSha256:digest(source),componentId:evidence.component.id}),
  });
  assert.equal(report.status,'conformant');
  assert.equal(report.browserVerified,false);
  assert.equal(report.selectedAttempt,2);
  assert.equal(report.requests.length,2);
  assert.ok(Math.abs(report.estimatedCostUsd-0.00705)<1e-9);
  assert.equal(report.reservedCostUsd,0);
  assert.match(requests[1].input.at(-1).content[0].text,/conformance feedback/);
  assert.doesNotMatch(JSON.stringify(report),/private-test-state|fake-secret/);
  assert.doesNotMatch(JSON.stringify(requests[1]),/private-test-state/);
});

test('transfer preflight prevents overspend and unsettled requests cannot be retried', async()=>{
  let calls=0;
  const client={countInputTokens:async()=>3000,respond:async()=>{calls++;throw Error('ambiguous transport');}};
  await assert.rejects(transferPaku({evidence,client,limits:{maxCostUsd:0.001}}),/cost budget/);
  assert.equal(calls,0);
  await assert.rejects(transferPaku({evidence,client}),error=>{
    assert.equal(error.report.requests[0].status,'unsettled');
    assert.ok(error.report.reservedCostUsd>0);
    return true;
  });
  assert.equal(calls,1);
});

test('incomplete generation and stale evaluation identities cannot become conformant', async()=>{
  let calls=0;
  await assert.rejects(transferPaku({evidence,client:{countInputTokens:async()=>1000,respond:async()=>{calls++;return{...reply(),status:'incomplete'};}}}),/incomplete/);
  assert.equal(calls,1);
  await assert.rejects(transferPaku({evidence,limits:{maxModelCalls:1},
    client:{countInputTokens:async()=>1000,respond:async()=>reply()},
    evaluate:async()=>({passed:true,sourceSha256:'stale',componentId:evidence.component.id}),
  }),error=>{
    assert.match(error.report.attempts[0].conformance.error,/identity mismatch/);
    return true;
  });
});
