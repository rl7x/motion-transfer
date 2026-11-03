import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createCartridgeTools} from '../src/agent/tools.mjs';
import {investigate} from '../src/agent/investigate.mjs';

const recording=async()=>JSON.parse(await readFile(new URL('../assets/lab/recordings/programmatic-investigation.json',import.meta.url),'utf8'));
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
