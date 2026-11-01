import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluateRoadsterAdapter} from '../evaluator/roadster.mjs';
import {roadsterAdapterFixture} from './helpers/roadster-adapter.mjs';
test('roadster conformance checks airborne gating, inherited mapping and component delegation',async()=>{
  for(const intent of [{unitScale:.1,activation:'held',direction:'facing'},{unitScale:.05,activation:'press',direction:'opposite'}]){
    const report=await evaluateRoadsterAdapter(roadsterAdapterFixture(intent),intent);assert.equal(report.passed,true,JSON.stringify(report.results));assert.equal(report.results.length,8);
  }
  const broken=roadsterAdapterFixture().replace('frame.airborne&&frame.dash','frame.dash');
  assert.equal((await evaluateRoadsterAdapter(broken)).passed,false);
});
