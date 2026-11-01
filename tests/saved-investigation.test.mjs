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

test('local control evidence distinguishes human-scripted intervention from model activity',async()=>{
  const record=(await savedInvestigations()).find(item=>item.id==='local-control'),report=record.job.report;
  assert.equal(record.kind,'local-verification');assert.equal(report.model,'none');assert.equal(report.requests.length,0);
  const comparison=report.session.comparisons[0];assert.equal(comparison.firstBehaviorDivergence.elapsedFrame,1);
  assert.equal(comparison.normalizedTrace.at(-1).control.dx,60);assert.equal(comparison.normalizedTrace.at(-1).experimental.dx,16);
  assert.equal(report.session.captures.length,2);
  const writers=report.toolCalls.filter(call=>call.name==='trace_writers');
  assert.equal(writers[0].result.matchingWrites,0);assert.ok(writers[1].result.matchingWrites>0);assert.ok(writers.every(call=>call.result.behavioralComparison.passed));
});

test('the programmatic Meta recording retains a real chosen intervention, later evidence read and rejected completion',async()=>{
  const record=(await savedInvestigations()).find(item=>item.id==='programmatic-investigation'),report=record.job.report;
  assert.equal(record.job.status,'failed');assert.match(record.job.error,/actual code inspection/);assert.equal(report.requests.length,10);assert.equal(report.estimatedCostUsd,.14972375);assert.equal(report.reservedCostUsd,0);
  const [first,second]=report.session.experimentWorkbench.programs;assert.equal(first.status,'failed');assert.match(first.error,/output byte limit/);assert.equal(second.status,'completed');
  const experiment=report.session.experimentWorkbench.artifacts.find(item=>item.payload.kind==='experiment');
  assert.equal(experiment.payload.status,'completed');assert.equal(experiment.payload.edits[0].name,'x');assert.equal(experiment.payload.edits[0].previousValue,60);assert.equal(experiment.payload.edits[0].newValue,20);
  assert.equal(experiment.payload.trace.length,30);assert.equal(experiment.payload.trace.at(-1).control.normalized.dx,60);assert.equal(experiment.payload.trace.at(-1).intervention.normalized.dx,60);
  assert.ok(second.operations.some(item=>item.name==='read_experiment'&&item.args.artifactId===experiment.id));
  assert.equal(report.session.staticEvidence.some(item=>['wat','decompilation','writer-trace'].includes(item.kind)),false);assert.equal(report.conclusion,null);
});
