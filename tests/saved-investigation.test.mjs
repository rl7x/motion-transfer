import assert from 'node:assert/strict';
import test from 'node:test';
import {savedInvestigations} from '../lab/saved.mjs';

test('the recorded Meta investigation retains contrasting actual motion observations',async()=>{
  const [record]=await savedInvestigations(),report=record.job.report;
  const experiments=report.toolCalls.filter(call=>call.name==='run_original'&&call.ok);
  assert.equal(experiments.length,2);assert.equal(report.conclusionVerified,false);
  const directions=experiments.map(call=>{
    const points=call.result.checkpoints.filter(point=>point.motion),prepared=points.find(point=>point.motion.position.x===-60&&point.motion.cooldown===0),last=points.at(-1);
    assert.ok(prepared,'Both runs reach the same leftward preparation');return Math.sign(last.motion.position.x-prepared.motion.position.x);
  });
  assert.deepEqual(directions,[1,-1]);assert.match(report.conclusion,/rejects preservation hypothesis/);
  assert.ok(report.humanAssistance.some(note=>note.includes('Mapped read-only motion registry')));
});

test('the incomplete live branch recording retains its failure, actual motion and reproducible session',async()=>{
  const records=await savedInvestigations(),record=records.find(item=>item.id==='branch-experiment'),report=record.job.report;
  assert.equal(record.job.status,'failed');assert.equal(report.status,'failed');assert.equal(report.conclusion,null);
  assert.equal(report.requests.length,12);assert.equal(report.reservedCostUsd,0);assert.ok(Math.abs(report.estimatedCostUsd-.252143)<1e-9);
  const experiment=report.toolCalls.find(call=>call.name==='session_advance');
  assert.equal(experiment.result.checkpoints.at(-1).motion.position.x,60);
  assert.equal(report.session.branches.length,2);assert.equal(report.session.comparisons.length,0);
  assert.ok(report.turns.at(-1).messages[0].text.includes('No `compare_branches` completed'));
});
