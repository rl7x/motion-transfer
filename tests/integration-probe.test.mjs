import test from 'node:test';
import assert from 'node:assert/strict';
import { probeIntegration } from '../src/integration/probe.mjs';
import { roadsterAdapterFixture } from './helpers/roadster-adapter.mjs';

test('engine-independent probe accepts the declared mapping and inherited fresh-press direction', async () => {
  const options = { unitScale: 0.05, activation: 'press', direction: 'opposite', activationGate: 'always' };
  const source = roadsterAdapterFixture(options).replace('frame.airborne&&', '');
  const report = await probeIntegration(source, options);
  assert.equal(report.passed, true, JSON.stringify(report.results));
  assert.equal(report.results.length, 6);
  assert.equal(report.metaCalled, false);
});

test('integration probe catches double stepping, wrong units, dropped events and changed inactive motion', async () => {
  const source = roadsterAdapterFixture();
  for (const [name, broken] of [
    ['double stepping', source.replace('const next=motion.step', 'motion.step(state.core,{buttons:0,sourceBodyWidth:8},config.motion);const next=motion.step')],
    ['wrong units', source.replace('next.output.displacement.x*config.unitScale', 'next.output.displacement.x*config.unitScale*2')],
    ['dropped event', source.replace('events:next.output.events', 'events:[]')],
    ['inactive motion', source.replace(':frame.normalDisplacement', ':0')],
  ]) {
    const report = await probeIntegration(broken);
    assert.equal(report.passed, false, name);
    assert.ok(report.results.some(result => !result.passed), name);
  }
});
