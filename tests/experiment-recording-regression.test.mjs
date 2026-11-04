import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createCartridgeTools} from '../src/agent/tools.mjs';
import {investigate} from '../src/agent/investigate.mjs';

const recording=async()=>JSON.parse(await readFile(new URL('../assets/lab/recordings/programmatic-investigation.json',import.meta.url),'utf8'));
test('changed experiment engines expose immutable saved evidence but reject all new execution',async()=>{
  const {report}=await recording(),tools=createCartridgeTools();
  try{
    const opened=await tools.open(report.session);
    assert.match(opened.result.executionBlocked,/engine changed/);
    const before=structuredClone(tools.sessionState),artifact=before.experimentWorkbench.artifacts.find(item=>item.payload.kind==='experiment');
    const page=(await tools.run('read_experiment',{artifactId:artifact.id,startFrame:1,frameCount:1})).result;
    assert.deepEqual(page.frames,artifact.payload.trace.slice(0,1));
    assert.deepEqual(tools.sessionState.experimentWorkbench,before.experimentWorkbench);
    const commands=[
      ['session_advance',{branchId:'main',hypothesis:'Must not run.',steps:[{buttons:0,frames:1,checkpoint:'blocked'}],watches:[]}],
      ['run_original',{hypothesis:'Must not run.',steps:[{buttons:0,frames:1,checkpoint:'blocked'}],watches:[]}],
      ['run_experiment_program',{requestId:'blocked-old-engine',hypothesis:'Must not run.',language:'javascript',source:'return 7;'}],
      ['prepare_checkpoint',{requestId:'blocked-old-prepare',hypothesis:'Must not run.',steps:[{buttons:0,frames:1,checkpoint:'blocked'}],watches:[]}],
      ['run_experiment',report.session.experimentWorkbench.programs.flatMap(item=>item.operations).find(item=>item.name==='run_experiment').args],
    ];
    for(const [name,args]of commands)await assert.rejects(tools.run(name,args),/engine changed/);
    assert.deepEqual(tools.sessionState,before,'Refused execution cannot alter the restored session');
    const corrupt=structuredClone(report.session);corrupt.experimentWorkbench.artifacts[0].payload.hypothesis='Corrupted';
    const refused=createCartridgeTools();try{await assert.rejects(refused.open(corrupt),/integrity mismatch/);}finally{await refused.close();}
  }finally{await tools.close();}
});

test('the recorded rejected artifact citation now resolves to real experiment evidence without rerunning it',async()=>{
  const {report}=await recording(),rejected=report.toolCalls.find(call=>call.name==='record_finding'&&!call.ok),tools=createCartridgeTools();
  try{
    await tools.open(report.session);const before=structuredClone(tools.sessionState.experimentWorkbench.usage);
    const finding=(await tools.run('record_finding',rejected.args)).result;assert.deepEqual(finding.evidenceIds,rejected.args.evidenceIds);
    assert.deepEqual(tools.sessionState.experimentWorkbench.usage,before);
    await assert.rejects(tools.run('record_finding',{...rejected.args,evidenceIds:['0'.repeat(64)]}),/unknown evidence/);
    const listed=(await tools.run('list_functions',{startIndex:0,limit:20})).result,fn=listed.functions.find(item=>item.exports.includes('update'));
    await tools.run('inspect_function',{functionIndex:fn.index,startLine:1,lineCount:8});
    const artifactId=rejected.args.evidenceIds[1];
    const selection=(await tools.run('select_component_evidence',{functionIndices:[fn.index],evidenceIds:[artifactId],scope:'Offline regression using an actual saved artifact; no new model or candidate.'})).result;
    assert.equal(selection.evidence.traces[0].observation.artifactId,artifactId);assert.equal(selection.evidence.traces[0].observation.frameCount,30);
    assert.equal(report.toolCalls.find(call=>call.name==='record_finding'&&!call.ok).ok,false,'Original recording remains unchanged');
  }finally{await tools.close();}
});

test('an injected continuation cannot claim that function enumeration satisfies code inspection',async()=>{
  const {report}=await recording();let requests=0;
  const final=report.turns.at(-1).messages.find(message=>message.phase==='final').text;
  const client={countInputTokens:async()=>1000,respond:async()=>{requests++;return{id:'offline-final-only',status:'completed',usage:{input_tokens:1000,output_tokens:100},output:[{type:'message',content:[{type:'output_text',text:final}]}]};}};
  await assert.rejects(investigate({client,resumeReport:report,model:report.model,question:report.question,limits:report.limits}),error=>{
    assert.match(error.message,/actual code inspection/);assert.equal(error.report.reservedCostUsd,0);assert.equal(error.report.requests.length,11);return true;
  });assert.equal(requests,1,'Injected client only; no live request or retry');
});
