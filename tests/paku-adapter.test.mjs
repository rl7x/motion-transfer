import assert from 'node:assert/strict';
import test from 'node:test';
import { compileAdapter, executeAdapter, validateAdapterOutput } from '../src/transfer/adapter.mjs';
import { evaluatePakuAdapter } from '../src/evaluator/paku-adapter.mjs';

test('transfer checks reject an adapter that bypasses the recovered component', async () => {
  const source = 'export const init=()=>({}); export const step=state=>({state,output:{displacement:3.75,ownsMotion:true,events:[],sweep:[]}});';
  const compiled = await compileAdapter(source);
  await assert.rejects(executeAdapter(compiled, [{name:'bad',frames:[{facing:1,dash:true,normalDisplacement:0.5}]}]), /initialize.*exactly once/);
});

test('merely calling the component cannot pass without using its motion outputs', async () => {
  const source = `export const init=(motion,config)=>({motion:motion.init(config.motion)});
    export function step(state,frame,motion,config) {
      const result=motion.step(state.motion,{buttons:0,sourceBodyWidth:8},config.motion);
      return {state:{motion:result.state},output:{displacement:frame.normalDisplacement,ownsMotion:false,events:[],sweep:[]}};
    }`;
  const result = await evaluatePakuAdapter(source);
  assert.equal(result.passed, false);
  assert.ok(result.results.some(test => test.name === 'early-held' && !test.passed));
  assert.ok(result.results.some(test => test.name === 'counterfactual-component-output' && !test.passed));
});

test('collision sweeps reject skipped space, reversed segments, and inactive trails', () => {
  const output = { displacement: 3.75, ownsMotion: true, events: ['dash-start'], sweep: [0.9375, 1.875, 2.8125] };
  validateAdapterOutput(output);
  assert.throws(() => validateAdapterOutput({...output,sweep:[]}), /gaps/);
  assert.throws(() => validateAdapterOutput({...output,sweep:[1,0,2,3]}), /monotonic/);
  assert.throws(() => validateAdapterOutput({...output,ownsMotion:false}), /Inactive/);
});
