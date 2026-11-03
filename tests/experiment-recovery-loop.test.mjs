import assert from 'node:assert/strict';
import test from 'node:test';
import {investigate} from '../src/agent/investigate.mjs';
import {evidenceHistory} from '../src/agent/evidence.mjs';

const usage={input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}};
const call=(turn,name,args,namespace)=>({type:'function_call',call_id:'experiment-recovery-'+turn,name,status:'completed',arguments:JSON.stringify(args),...(namespace?{namespace}:{})});
const source=`
await sdk.static.inspectWasm({view:'overview',startLine:1,lineCount:5});
const functions=await sdk.static.listFunctions({startIndex:0,limit:20});
const selected=functions.functions.find(fn=>fn.exports.includes('update'));
await sdk.static.inspectFunction({functionIndex:selected.index,startLine:1,lineCount:10});
const prepared=await sdk.prepareCheckpoint({hypothesis:'Injected local setup, no inference.',steps:[{buttons:1,frames:1,checkpoint:'entered'},{buttons:0,frames:10,checkpoint:'ready'}],watches:[]});
const target=prepared.targets.find(target=>target.name==='cooldown');
const observed=await sdk.runExperiment({hypothesis:'Investigate a timer intervention without an expected conclusion.',checkpointId:prepared.checkpointId,interventions:[{targetId:target.id,value:40,hypothesis:'Test this timer value.'}],steps:[{buttons:33,frames:8,checkpoint:'same-inputs'}],observations:{channels:['motion','timers','events'],watches:[],captures:[]}});
return {functionIndex:selected.index,experimentId:observed.experimentId,measured:observed.final};`;

test('actual managed evidence drives a later model action, selected recovery and real development revision',async()=>{
  let turn=0,experimentId,functionIndex,selectionId,feedback;const requests=[];
  const candidateSource='export function init(){return {cooldown:0,remaining:0}};export function step(state){return {state,output:{ownsMotion:false,displacement:{x:0,y:0},events:[]}}}';
  const submission=text=>({selectionId,source:text,timerFields:{cooldown:'cooldown',remaining:'remaining'},contract:{name:'injected development fixture',scope:'Finite motion only.',defaults:{walkingSpeed:2,dashDistance:60,cooldownTicks:25,initialCooldownTicks:10},stateDescription:'Deliberately incomplete counters.',rules:[{description:'Evidence is selected from the actual paired runtime experiment.',evidence:[experimentId]}],limitations:['This fixture does not claim an independently recovered component.']}});
  const client={countInputTokens:async()=>1000,respond:async request=>{
    requests.push(request);turn++;const previous=request.input.filter(item=>item.type==='function_call_output').map(item=>JSON.parse(item.output)).at(-1);let output;
    if(turn===1)output=[call(turn,'run_experiment_program',{requestId:'recovery-loop-program',hypothesis:'Injected end-to-end fixture.',language:'typescript',source})];
    if(turn===2){
      assert.equal(previous.status,'completed',previous.error);experimentId=previous.output.experimentId;functionIndex=previous.output.functionIndex;
      const measured=previous.output.measured;assert.equal(measured.control.dx,60);assert.equal(measured.intervention.dx,16);
      output=[call(turn,'record_finding',{claim:`In this finite execution the edited branch moved ${measured.intervention.dx} while control moved ${measured.control.dx}; investigate the selected code next.`,status:'supported',confidence:'low',evidenceIds:[experimentId]})];
    }
    if(turn===3)output=[{type:'tool_search_call',id:'recovery-native-search',execution:'client',call_id:'recovery-native-search-call',status:'completed',arguments:{namespace:'recovery'}}];
    if(turn===4){assert.ok(request.input.some(item=>item.type==='tool_search_output'));output=[call(turn,'select_component_evidence',{functionIndices:[functionIndex],evidenceIds:[experimentId],scope:'Agent-selected actual execution evidence.'},'recovery')];}
    if(turn===5){selectionId=previous.selectionId;assert.equal(previous.evidence.traces[0].id,experimentId);assert.ok(previous.evidence.traces[0].observation.artifactId);output=[call(turn,'submit_component_candidate',submission(candidateSource),'recovery')];}
    if(turn===6){feedback=previous.development.results.find(result=>result.firstDivergence);assert.ok(feedback.firstDivergence.expected.timers);output=[call(turn,'submit_component_candidate',submission(candidateSource.replace('x:0','x:1')),'recovery')];}
    if(turn===7){assert.equal(previous.attempt,2);assert.equal(previous.development.passed,false);output=[{type:'message',content:[{type:'output_text',text:`${experimentId} contains the finite paired measurements. Two development candidates failed; no freezing or acceptance occurred. Field hints were human assistance.`}]}];}
    return{id:'recovery-response-'+turn,status:'completed',output,usage};
  }};
  const report=await investigate({client,model:'muse-spark-1.3',toolDiscovery:'client',limits:{maxModelCalls:12,maxToolCalls:24},requirements:{branchComparison:true,codeInspection:true,followupDecision:true}});
  assert.equal(report.status,'completed');assert.equal(turn,7);assert.equal(report.reservedCostUsd,0);assert.equal(report.session.recovery.attempts.length,2);assert.equal(report.session.recovery.frozenCandidateId,undefined);assert.equal(report.session.recovery.acceptanceStarted,undefined);
  assert.equal(report.session.experimentWorkbench.usage.experiments,1);assert.equal(report.session.findings[0].evidenceIds[0],experimentId);
  assert.equal(requests[5].model,'muse-spark-1.3');assert.ok(feedback);
  const ledger=evidenceHistory(report);assert.ok(ledger.some(item=>item.content?.some(content=>content.text?.includes(experimentId))));
});
