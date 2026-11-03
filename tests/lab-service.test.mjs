import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLabService } from '../lab/service.mjs';
import { createRecoveryProtocol } from '../agent/recovery-protocol.mjs';
const request={questionId:'held',idempotencyKey:'lab-test-request'};
async function fixture(t,options={}){const directory=await mkdtemp(join(tmpdir(),'motion-lab-'));const service=await createLabService({directory,client:{},...options});t.after(async()=>{await service.close();await rm(directory,{recursive:true,force:true});});return{service,directory};}
async function done(service, id) {
  for (let index = 0; index < 100; index++) {
    const job = await service.run(id);
    // Terminal status is observable before its final durable write resolves.
    // A subsequent submission must also wait for admission to be released.
    if (['ready', 'failed'].includes(job.status) && service.status().activeRunId !== id) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw Error('Job did not finish');
}
test('lab jobs persist measured progress, idempotency and settled spend',async t=>{
  let calls=0;const {service}=await fixture(t,{investigateRun:async({onUpdate,model,limits})=>{calls++;assert.equal(model,'muse-spark-1.3');assert.equal(limits.maxCostUsd,.5);const report={status:'completed',estimatedCostUsd:.02,reservedCostUsd:0,toolCalls:[],conclusionVerified:false};await onUpdate(report);return report;}});
  const first=await service.submit('investigation',request);assert.equal((await done(service,first.id)).status,'ready');
  assert.equal((await service.submit('investigation',request)).id,first.id);assert.equal(calls,1);assert.equal(service.status().budget.spentUsd,.02);
  await assert.rejects(service.submit('investigation',{...request,questionId:'neutral'}),/different input/);
});
test('uncertain lab billing survives restart and blocks new requests',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'motion-lab-restart-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  let service=await createLabService({directory,client:{},investigateRun:async({onUpdate})=>{await onUpdate({estimatedCostUsd:0,reservedCostUsd:.1});throw Error('unknown billing');}});
  const first=await service.submit('investigation',request);assert.equal((await done(service,first.id)).status,'failed');await service.close();
  service=await createLabService({directory,client:{}});try{assert.equal(service.status().budget.reservedUsd,.1);await assert.rejects(service.submit('investigation',{...request,idempotencyKey:'new-request-key'}),/billing is uncertain/);}finally{await service.close();}
});
test('lab serializes paid tasks and preserves the ten dollar ceiling',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});const {service}=await fixture(t,{investigateRun:async()=>{await gate;return{status:'completed',estimatedCostUsd:0,reservedCostUsd:0};}});
  const first=await service.submit('investigation',request);await assert.rejects(service.submit('investigation',{...request,idempotencyKey:'another-request-key'}),/already running/);release();await done(service,first.id);
  await assert.rejects(createLabService({directory:'/unused',budgetUsd:11}),/Invalid lab budget/);
});
test('lab reports redact credentials and reject unsupported requests',async t=>{
  const {service}=await fixture(t,{apiKey:'test-private-credential',investigateRun:async()=>{throw Error('test-private-credential failed');}});
  await assert.rejects(service.submit('investigation',{...request,extra:1}),/Invalid lab request/);
  const job=await service.submit('investigation',request);assert.doesNotMatch(JSON.stringify(await done(service,job.id)),/test-private-credential/);
});

test('question routing retains the configured model, discovery requirements and per-run ceilings', async t => {
  const actual = [];
  const { service } = await fixture(t, { investigateRun: async options => {
    const { model, limits, requirements, toolDiscovery, reasoningEffort } = options;
    actual.push({ model, limits, requirements, toolDiscovery, reasoningEffort });
    return { status: 'completed', estimatedCostUsd: 0, reservedCostUsd: 0 };
  } });
  for (const questionId of ['held', 'neutral', 'memory', 'extraction']) {
    const job = await service.submit('investigation', { questionId, idempotencyKey: 'routing-test-' + questionId });
    assert.equal((await done(service, job.id)).status, questionId === 'extraction' ? 'failed' : 'ready');
  }
  const basic = { model: 'muse-spark-1.3', limits: { maxCostUsd: 0.5 }, requirements: {}, toolDiscovery: 'none', reasoningEffort: 'high' };
  const extended = extraction => ({
    model: 'muse-spark-1.3',
    limits: { maxCostUsd: 0.5, maxModelCalls: extraction ? 16 : 12, maxToolCalls: 24, maxOutputTokens: extraction ? 4000 : 2000 },
    requirements: { branchComparison: true, codeInspection: true, componentAcceptance: extraction, followupDecision: true,
      ...(extraction ? { selectedRecoveryEvidence: true } : {}) },
    toolDiscovery: 'client', reasoningEffort: 'low',
  });
  assert.deepEqual(actual, [basic, basic, extended(false), extended(true)]);
  assert.equal(service.status().budget.spentUsd, 0);
});

test('simultaneous submissions cannot both pass admission while the first job is being persisted', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { service } = await fixture(t, { investigateRun: async () => {
    await gate;
    return { status: 'completed', estimatedCostUsd: 0, reservedCostUsd: 0 };
  } });
  try {
    const submissions = await Promise.allSettled([
      service.submit('investigation', { ...request, idempotencyKey: 'admission-first' }),
      service.submit('investigation', { ...request, idempotencyKey: 'admission-second' }),
    ]);
    assert.equal(submissions[0].status, 'fulfilled');
    assert.equal(submissions[1].status, 'rejected');
    assert.match(submissions[1].reason.message, /already running/);
    release();
    assert.equal((await done(service, submissions[0].value.id)).status, 'ready');
  } finally { release(); }
});

test('new recovery protocols require a phase reservation before generation and settle actual spending', async t => {
  const protocol = createRecoveryProtocol(), events = [];
  const phaseBudget = {
    reserve: async value => { events.push({ action: 'reserve', ...value }); },
    settle: async value => { events.push({ action: 'settle', ...value }); },
  };
  const { service } = await fixture(t, { recoveryProtocol: protocol, phaseBudget,
    investigateRun: async options => {
      assert.equal(events.at(-1).action, 'reserve');
      assert.equal(options.recoveryProtocol.id, protocol.id);
      events.push({ action: 'generate' });
      return { status: 'failed', estimatedCostUsd: 0.02, reservedCostUsd: 0 };
    } });
  const job = await service.submit('investigation', { questionId: 'extraction', idempotencyKey: 'new-protocol-run' });
  const result = await done(service, job.id);
  assert.equal(result.status, 'failed');
  assert.equal(result.recoveryProtocol, undefined, 'Public report carries protocol; admission details stay in the durable job');
  assert.equal(events[0].category, 'recovery');
  assert.equal(events[0].maxCostUsd, 0.5);
  assert.deepEqual(events.map(event => event.action), ['reserve', 'generate', 'settle']);
  assert.equal(events.at(-1).uncertain, false);
  assert.equal(events.at(-1).estimatedCostUsd, 0.02);
});

test('phase reservation refusal prevents generation without changing historical lab ceilings', async t => {
  let generated = 0;
  const { service } = await fixture(t, { recoveryProtocol: createRecoveryProtocol(),
    phaseBudget: { reserve: async () => { throw Error('Phase budget is exhausted'); } },
    investigateRun: async () => { generated++; } });
  await assert.rejects(service.submit('investigation', { questionId: 'extraction', idempotencyKey: 'blocked-phase-run' }), /Phase budget is exhausted/);
  assert.equal(generated, 0);
  assert.equal(service.status().activeRunId, null);
  assert.equal(service.status().budget.limitUsd, 10);
  const { service: missing } = await fixture(t, { recoveryProtocol: createRecoveryProtocol() });
  await assert.rejects(missing.submit('investigation', { questionId: 'extraction', idempotencyKey: 'missing-phase-run' }), /durable phase budget/);
});
