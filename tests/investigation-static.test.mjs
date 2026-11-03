import assert from 'node:assert/strict';
import test from 'node:test';
import {createCartridgeTools} from '../src/agent/tools.mjs';

test('function decompilation and graph navigation retain evidence-linked inferred names separately',async()=>{
  const tools=createCartridgeTools();
  try{
    await tools.open();
    const listed=(await tools.run('list_functions',{startIndex:0,limit:50})).result;
    const index=listed.functions.find(fn=>!fn.imported&&fn.memoryInstructionCount>0).index;
    const code=(await tools.run('decompile_function',{functionIndex:index,startLine:1,lineCount:10})).result;
    assert.equal(code.functionIndex,index);assert.match(code.notice,/approximate/);assert.ok(code.lines.length>0);
    const graph=(await tools.run('call_graph',{functionIndex:index,direction:'callees',depth:2})).result;
    assert.equal(graph.indirectCallsResolved,false);assert.ok(graph.nodes.some(node=>node.index===index));
    const args={functionIndex:index,inferredName:'possible state handler',hypothesis:'This function may update state; execution evidence is still needed.',confidence:'low',status:'unresolved',evidenceIds:[code.evidenceId]};
    const note=(await tools.run('annotate_function',args)).result;
    assert.equal(note.nameSource,'agent-inference');assert.equal(note.status,'unresolved');
    await assert.rejects(tools.run('annotate_function',{...args,evidenceIds:['obs-9999']}),/unknown session evidence/);
    assert.equal(tools.sessionState.annotations.length,1);
    assert.equal(tools.sessionState.staticEvidence[0].functionIndex,index);
  }finally{await tools.close();}
});
