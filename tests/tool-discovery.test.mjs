import assert from 'node:assert/strict';
import test from 'node:test';
import {createToolDiscovery} from '../src/agent/tool-discovery.mjs';
import {investigate} from '../src/agent/investigate.mjs';

const usage={input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}};
const tool=(id,name,args,namespace)=>({type:'function_call',call_id:id,status:'completed',name,arguments:JSON.stringify(args),...(namespace?{namespace}:{})});
const search={type:'tool_search_call',id:'native-search',execution:'client',call_id:'native-search-call',status:'completed',arguments:{namespace:'execution'}};
test('recovery exposes direct evidence tools, then development and separate freeze/accept stages',()=>{
  const catalog=createToolDiscovery({mode:'client',model:'muse-spark-1.3',profile:'recovery'});
  const definitions=catalog.definitions();
  for(const name of ['inspect_function','list_functions','select_component_evidence','trace_writers','read_experiment']){
    assert.ok(definitions.some(tool=>tool.name===name));assert.equal(catalog.route({name}),name);
  }
  assert.ok(!definitions.some(tool=>tool.type==='tool_search'||tool.name==='submit_component_candidate'));
  assert.throws(()=>catalog.load(search),/no tool search/);
  assert.throws(()=>catalog.route({name:'freeze_component'}),/current recovery stage/);
  assert.ok(!catalog.definitions({programsRemaining:false}).some(tool=>tool.name==='run_experiment_program'));
  const selection=catalog.definitions({stage:'select'});
  assert.ok(selection.some(tool=>tool.name==='select_component_evidence'));
  assert.ok(selection.some(tool=>tool.name==='read_experiment'));
  assert.ok(!selection.some(tool=>tool.name==='run_experiment'));
  assert.deepEqual(catalog.definitions({stage:'select',reserveDevelopment:true}).map(tool=>tool.name),['select_component_evidence']);
  assert.throws(()=>catalog.route({name:'read_experiment'}),/current recovery stage/);
  const development=catalog.definitions({stage:'develop'});
  assert.ok(development.some(tool=>tool.name==='submit_component_candidate'));
  assert.ok(!development.some(tool=>tool.name==='list_functions'));
  assert.equal(catalog.route({name:'submit_component_candidate'}),'submit_component_candidate');
  assert.deepEqual(catalog.definitions({stage:'freeze'}).map(tool=>tool.name),['freeze_component']);
  assert.throws(()=>catalog.route({name:'submit_component_candidate'}),/current recovery stage/);
  assert.deepEqual(catalog.definitions({stage:'accept'}).map(tool=>tool.name),['accept_component']);
  assert.throws(()=>catalog.route({name:'accept_component',namespace:'recovery'}),/directly listed/);
  assert.deepEqual(catalog.definitions({stage:'conclude'}),[]);
  assert.equal(catalog.state.profile,'recovery');
});
test('client-native discovery defers focused definitions and routes only loaded namespaces',()=>{
  const catalog=createToolDiscovery({mode:'client',model:'muse-spark-1.3'}),definitions=catalog.definitions();
  assert.equal(definitions.filter(tool=>tool.type==='tool_search').length,1);assert.equal(definitions.find(tool=>tool.type==='tool_search').execution,'client');
  assert.ok(definitions.some(tool=>tool.name==='run_experiment_program'));assert.ok(!definitions.some(tool=>tool.name==='submit_component_candidate'));
  assert.throws(()=>catalog.route({name:'read_checkpoint',namespace:'execution'}),/unloaded/);
  const loaded=catalog.load(search);assert.equal(loaded.output.type,'tool_search_output');assert.equal(loaded.output.call_id,search.call_id);assert.ok(loaded.output.tools[0].tools.every(tool=>tool.defer_loading===true));
  assert.equal(catalog.route({name:'read_checkpoint',namespace:'execution'}),'read_checkpoint');
  assert.throws(()=>catalog.route({name:'submit_component_candidate',namespace:'execution'}),/does not contain/);
  assert.throws(()=>createToolDiscovery({mode:'client',model:'muse-wonder-1.0'}),/model was not changed/);
});

test('stateless native search replay preserves namespaces, required response items and accounting',async()=>{
  let turn=0,compacted=false;const requests=[];
  const input=buttons=>({hypothesis:'Injected discovery fixture with actual runtime execution.',watches:[],steps:[{buttons:1,frames:1,checkpoint:'gameplay'},{buttons,frames:3,checkpoint:'move'}]});
  const client={countInputTokens:async request=>{
    const hasLedger=request.input.some(item=>item.content?.some(content=>content.text?.includes('ledger contains actual')));
    if(turn===2&&!hasLedger)return 25000;if(hasLedger)compacted=true;return 1000;
  },respond:async request=>{
    requests.push(JSON.parse(JSON.stringify(request)));turn++;let output;
    if(turn===1)output=[{type:'reasoning',id:'private-native-fixture',encrypted_content:'private-native-state'},search];
    if(turn===2){assert.ok(request.input.some(item=>item.type==='tool_search_output'&&item.tools[0].name==='execution'));assert.equal(request.input.find(item=>item.type==='reasoning').summary.length,0);output=[tool('first-native','run_original',input(32),'execution')];}
    if(turn===3){assert.ok(request.input.some(item=>item.type==='tool_search_call'));assert.ok(request.input.some(item=>item.type==='tool_search_output'));output=[tool('second-native','run_original',input(16),'execution')];}
    if(turn===4)output=[tool('native-overview','inspect_wasm',{view:'overview',startLine:1,lineCount:5})];
    if(turn===5)output=[{type:'message',content:[{type:'output_text',text:'exp-001 and exp-002 differ under the stated inputs. The finite fixture does not establish all motion rules.'}]}];
    return{id:'native-response-'+turn,status:'completed',output,usage};
  }};
  const report=await investigate({client,model:'muse-spark-1.3',toolDiscovery:'client'});
  assert.equal(report.status,'completed');assert.equal(report.requests.length,5);assert.equal(report.reservedCostUsd,0);assert.ok(report.estimatedCostUsd>0);assert.equal(compacted,true);
  assert.equal(report.toolCalls[1].namespace,'execution');assert.deepEqual(report.toolDiscovery.loadedNamespaces,['execution']);assert.doesNotMatch(JSON.stringify(report),/private-native-state/);
  assert.ok(requests.every(request=>!request.tools.some(tool=>tool.type==='tool_search'&&tool.execution!=='client')));
});

test('hosted discovery is rejected rather than silently violating per-request reservations',async()=>{
  let calls=0;
  await assert.rejects(investigate({model:'muse-spark-1.3',toolDiscovery:'client',client:{countInputTokens:async()=>1000,respond:async()=>{calls++;return{id:'hosted-is-not-enabled',status:'completed',usage,output:[{...search,execution:'server',call_id:null}]};}}}),error=>{
    assert.match(error.message,/cannot fit the existing reservation/);assert.equal(error.report.requests.length,1);assert.equal(error.report.reservedCostUsd,0);assert.ok(error.report.estimatedCostUsd>0);return true;
  });assert.equal(calls,1);
});
