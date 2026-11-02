import assert from 'node:assert/strict';
import test from 'node:test';
import {investigate} from '../agent/investigate.mjs';
import {TOOLS} from '../agent/tool-schema.mjs';

const usage={input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}};
const call=(number,name,args)=>({type:'function_call',call_id:'session-call-'+number,name,arguments:JSON.stringify(args)});
test('the model loop receives real branch consequences before choosing its next action and sees selected PNG input',async()=>{
  let turn=0,checkpointId,address,comparisonId,consequence;const updates=[];
  const client={countInputTokens:async()=>1000,respond:async request=>{
    turn++;
    const returned=request.input.filter(item=>item.type==='function_call_output').map(item=>JSON.parse(item.output)).at(-1);
    let action;
    if(turn===1)action=call(turn,'inspect_wasm',{view:'overview',startLine:1,lineCount:5});
    if(turn===2)action=call(turn,'session_advance',{branchId:'main',hypothesis:'Establish a ready motion baseline.',watches:[],steps:[{buttons:1,frames:1,checkpoint:'gameplay'},{buttons:0,frames:10,checkpoint:'ready'}]});
    if(turn===3){address=returned.checkpoints.at(-1).motion.fieldHints.cooldown.address;assert.equal(returned.checkpoints.at(-1).motion.fieldHints.source,'human-mapped-assistance');action=call(turn,'inspect_function',{functionIndex:9,startLine:1,lineCount:8});}
    if(turn===4)action=call(turn,'checkpoint_state',{branchId:'main',label:'ready before intervention'});
    if(turn===5){checkpointId=returned.checkpointId;action=call(turn,'fork_checkpoint',{branchId:'control',checkpointId,watches:[]});}
    if(turn===6)action=call(turn,'fork_checkpoint',{branchId:'delayed',checkpointId,watches:[]});
    if(turn===7)action=call(turn,'write_memory',{branchId:'delayed',edits:[{address,type:'i16',value:40,hypothesis:'Increasing the candidate cooldown should delay activation.'}],watches:[]});
    if(turn===8){assert.equal(returned.edits[0].previousValue,0);action=call(turn,'compare_branches',{controlBranchId:'control',experimentalBranchId:'delayed',hypothesis:'Compare identical held-right dash inputs after the mutation.',watches:[],steps:[{buttons:33,frames:8,checkpoint:'burst'}]});}
    if(turn===9){
      comparisonId=returned.comparisonId;consequence=returned.firstBehaviorDivergence;
      assert.ok(consequence);assert.equal(consequence.control.events[0],'dash-start');assert.deepEqual(consequence.experimental.events,[]);
      action=call(turn,'capture_frame',{branchId:'delayed',reason:'Inspect the variant after the measured delay.'});
    }
    if(turn===10){
      const image=request.input.flatMap(item=>item.content??[]).find(item=>item.type==='input_image');
      assert.ok(image.image_url.startsWith('data:image/png;base64,'));
      action=call(turn,'record_finding',{claim:`In this run, the control started its dash at update ${consequence.elapsedFrame}; the edited branch did not.`,status:'supported',confidence:'medium',evidenceIds:[comparisonId,returned.evidenceId]});
    }
    const output=action?[action]:[{type:'message',content:[{type:'output_text',text:`${comparisonId} supports a delay under this intervention. The field layout was supplied by a human; the finite experiment does not establish all timer rules.`}]}];
    return{id:'session-response-'+turn,status:'completed',output,usage};
  }};
  const report=await investigate({client,model:'muse-spark-1.3',question:'Offline orchestration fixture, not a live model discovery.',requirements:{branchComparison:true,codeInspection:true},limits:{maxModelCalls:12,maxToolCalls:20},onUpdate:async report=>updates.push(JSON.parse(JSON.stringify(report)))});
  assert.equal(report.status,'completed');assert.equal(turn,11);assert.equal(report.conclusionVerified,false);
  assert.equal(report.session.findings[0].status,'supported');assert.equal(report.session.branches.length,3);
  assert.equal(report.session.captures.length,1);assert.equal(report.session.captures[0].branchId,'delayed');
  assert.equal(report.reservedCostUsd,0);assert.ok(report.estimatedCostUsd>0);
  assert.ok(updates.some(update=>update.session?.comparisons.length===1&&update.status==='running'));
  assert.equal(new Set(updates.filter(update=>update.session).map(update=>update.session.id)).size,1);
});

test('external cancellation retains the last session journal and makes no paid retry',async()=>{
  const controller=new AbortController();let calls=0;
  await assert.rejects(investigate({signal:controller.signal,client:{countInputTokens:async()=>1000,respond:async()=>{calls++;controller.abort();throw Error('cancelled transport');}}}),error=>{
    assert.ok(error.report.session.identity.cartridgeSha256);assert.equal(error.report.requests[0].status,'unsettled');assert.ok(error.report.reservedCostUsd>0);return true;
  });
  assert.equal(calls,1);
});

test('a rejected fork exposes occupied names to the next model action',async()=>{
  let turn=0,checkpointId;
  const client={countInputTokens:async()=>1000,respond:async request=>{
    turn++;const last=request.input.filter(item=>item.type==='function_call_output').map(item=>JSON.parse(item.output)).at(-1);let action;
    if(turn===1)action=call(turn,'checkpoint_state',{branchId:'main',label:'fork rejection fixture'});
    if(turn===2){checkpointId=last.checkpointId;action=call(turn,'fork_checkpoint',{branchId:'main',checkpointId,watches:[]});}
    if(turn===3){assert.deepEqual(last.sessionContext.occupiedBranchIds,['main']);assert.match(last.error,/new branch identity/);action=call(turn,'fork_checkpoint',{branchId:'variant',checkpointId,watches:[]});}
    if(turn===4){assert.equal(last.branchId,'variant');assert.equal(last.restorationVerified,true);}
    return{id:'rejected-fork-'+turn,status:'completed',output:action?[action]:[{type:'message',content:[{type:'output_text',text:'Incomplete fixture without enough experimental evidence.'}]}],usage};
  }};
  await assert.rejects(investigate({client}),error=>{assert.equal(error.report.session.branches.length,2);assert.equal(error.report.reservedCostUsd,0);return true;});
  assert.match(TOOLS.find(tool=>tool.name==='fork_checkpoint').parameters.properties.branchId.description,/NEW unused/);
});
