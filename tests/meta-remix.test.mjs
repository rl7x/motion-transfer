import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePakuRemix } from '../agent/remix-paku.mjs';
import { BASE_REMIX_INTENT, validateRemixSubmission } from '../remix/contract.mjs';
import { remixFixture } from './helpers/remix-fixture.mjs';

const intent={unitScale:0.75,activation:'press',direction:'opposite'};
const parent={id:'a'.repeat(64),intent:BASE_REMIX_INTENT,source:remixFixture(BASE_REMIX_INTENT)};
const submission={status:'supported',intent,source:remixFixture(intent),summary:'Backward dash on a fresh press, 45 pixels'};
const response=()=>({id:'test-response',status:'completed',
  usage:{input_tokens:2000,output_tokens:500,input_tokens_details:{cached_tokens:1000},output_tokens_details:{reasoning_tokens:200}},
  output:[{type:'reasoning',encrypted_content:'private-state'},
    {type:'function_call',name:'submit_adapter_remix',arguments:JSON.stringify(submission),status:'completed'}]});

test('Meta remix generation preserves parent context and accounts once without persisting private reasoning',async()=>{
  const updates=[],requests=[];
  const result=await generatePakuRemix({parent,prompt:'Backward on a fresh press and make it 45 pixels.',apiKey:'fake-secret',
    client:{countInputTokens:async()=>3000,respond:async request=>{requests.push(request);return response();}},
    onUpdate:async report=>updates.push(structuredClone(report)),
  });
  assert.equal(requests.length,1);assert.equal(result.report.status,'submitted');assert.equal(result.report.browserVerified,false);
  assert.equal(updates[0].reservedCostUsd,0.01395);assert.ok(Math.abs(result.report.estimatedCostUsd-0.003525)<1e-9);
  assert.match(requests[0].input[0].content[0].text,/wasDown/);
  assert.doesNotMatch(JSON.stringify(result.report),/private-state|fake-secret/);
  assert.equal(result.submission.source,submission.source);
});

test('remixes reject unsupported edits, no-op intent, and exhausted budgets without automatic retry',async()=>{
  assert.throws(()=>validateRemixSubmission({...submission,status:'unsupported',summary:'Jumping is not supported'}),/Unsupported/);
  let calls=0;
  const client={countInputTokens:async()=>3000,respond:async()=>{calls++;return response();}};
  await assert.rejects(generatePakuRemix({parent,prompt:'Change it',client,maxCostUsd:0.001}),/budget/);
  assert.equal(calls,0);
  client.respond=async()=>{calls++;return{...response(),output:[{type:'function_call',name:'submit_adapter_remix',arguments:JSON.stringify({...submission,intent:{direction:'facing',activation:'held',unitScale:0.5}})}]};};
  await assert.rejects(generatePakuRemix({parent,prompt:'Change it',client}),/does not change/);
  assert.equal(calls,1);
  client.respond=async()=>{calls++;throw Error('transport fake-secret');};
  await assert.rejects(generatePakuRemix({parent,prompt:'Change it',client,apiKey:'fake-secret'}),error=>{
    assert.ok(error.report.reservedCostUsd>0);assert.equal(error.report.requests[0].status,'unsettled');
    assert.doesNotMatch(JSON.stringify(error.report),/fake-secret/);return true;
  });
  assert.equal(calls,2);
});

