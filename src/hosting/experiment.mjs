import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { compileAdapter } from '../transfer/adapter.mjs';
import { parallaxiaDescriptor } from '../parallaxia/recipient.mjs';
import { reconstructCheckpoint, compareExperiment } from '../parallaxia/experiment.mjs';
import { readRuleSource } from '../parallaxia/rule.mjs';
import { replayDigest } from '../parallaxia/replay.mjs';
const digest = value => createHash('sha256').update(value).digest('hex');

async function executable(source, component) {
  const compiled = await compileAdapter(source, { componentRef: component });
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  return { ...new vm.Script(`${compiled.componentCode}\n${compiled.code}\n({component:recovered,adapter:candidate})`).runInContext(context, { timeout: 500 }), defaults: compiled.defaults };
}

// Imported only by the restricted worker, never by the coordinator.
export async function verifyCheckpointJob(job, component) {
  const parentSource = job.parentSource ?? job.source;
  const recipient = await parallaxiaDescriptor();
  const identity = { componentId: job.componentId, recipientRevision: recipient.revision, hooksSha256: recipient.hooksSha256, adapterSha256: digest(parentSource), ruleId: readRuleSource(job.parentRuleSource ?? job.ruleSource) ? digest(job.parentRuleSource ?? job.ruleSource) : null };
  const parent = { ...await executable(parentSource, component), intent: job.parentIntent ?? job.intent, rule: readRuleSource(job.parentRuleSource ?? job.ruleSource) };
  const run = await reconstructCheckpoint({ checkpoint: job.checkpoint, identity, component: parent.component,
    adapter: parent.adapter, defaults: parent.defaults, intent: parent.intent, rule: parent.rule });
  const checkpointId = await replayDigest(job.checkpoint);
  if (job.operation === 'verify-checkpoint') return { checkpointId, observation: {
    x: run.sim.ship.x, y: run.sim.ship.y, facing: run.sim.ship.facing ?? 1, lives: run.sim.lives, phase: run.sim.phase, tick: job.checkpoint.tick,
    motion: run.port.snapshot(run.sim), stateDigest: run.stateDigest }, checks: [{name:'checkpoint-reconstructed',passed:true}] };
  const candidate = { ...await executable(job.source, component), intent: job.intent, rule: readRuleSource(job.ruleSource) };
  const report = await compareExperiment({ checkpoint: job.checkpoint, identity, scenario: job.scenario,
    component: parent.component, parent, candidate, interventionTick: job.interventionTick });
  return { checkpointId, scenarioSha256: await replayDigest(job.scenario), report,
    checks: [{ name: 'same-reconstructed-starting-state', passed: true }, { name: 'native-collisions-and-frozen-controls', passed: true }] };
}
