import assert from 'node:assert/strict';
import test from 'node:test';
import { compileMotion } from '../src/component/build.mjs';
import { executeMotion } from '../src/component/run.mjs';
import { evaluateMotion } from '../src/evaluator/motion.mjs';
import { acceptanceCases } from '../src/evaluator/cases.mjs';

const walking = `
  export function init(config: {walkingSpeed: number}) { return { ticks: 0 }; }
  export function step(state: {ticks: number}, input: {buttons: number}, config: {walkingSpeed: number}) {
    const x = ((input.buttons & 32) ? 1 : 0) - ((input.buttons & 16) ? 1 : 0);
    const y = ((input.buttons & 128) ? 1 : 0) - ((input.buttons & 64) ? 1 : 0);
    return { state: {ticks: state.ticks + 1}, output: {
      ownsMotion: false, displacement: {x: x * config.walkingSpeed, y: y * config.walkingSpeed}, events: []
    }};
  }
`;

test('TypeScript components build without imports and each rollout gets a fresh module', async () => {
  const source = `let ticks = 0;
    export const init = () => ({});
    export function step(state, input) {
      if (typeof process !== 'undefined' || typeof fetch !== 'undefined' || typeof WebAssembly !== 'undefined') throw Error('unexpected host access');
      if (Object.keys(input).sort().join(',') !== 'buttons,sourceBodyWidth') throw Error('unexpected oracle input');
      return { state, output: {ownsMotion: false, displacement: {x: ++ticks, y: 0}, events: []} };
    }`;
  const compiled = await compileMotion(source);
  assert.match(compiled.javascript, /export/);
  assert.match(compiled.sourceSha256, /^[a-f0-9]{64}$/);
  const inputs = Array.from({ length: 2 }, () => ({ buttons: 32, sourceBodyWidth: 8 }));
  const results = await executeMotion(compiled, [{ name: 'first', inputs }, { name: 'reset', inputs }], {});
  assert.deepEqual(results.map(trace => trace.frames.map(frame => frame.displacement.x)), [[1, 2], [1, 2]]);
  await assert.rejects(compileMotion('import fs from "node:fs"; export const init = fs.readFileSync;'), /imports are not allowed/);
  await assert.rejects(compileMotion('x'.repeat(16_385)), /1–16 KB/);
  await assert.rejects(compileMotion('function init(){return {}}; function step(){}'), /must export named ES module functions init and step/);
  await assert.rejects(compileMotion('export default {init(){return {}},step(){}}'), /must export named ES module functions init and step/);
});

test('candidate execution rejects invalid JSON, outputs, and non-terminating code', async () => {
  const run = async source => executeMotion(await compileMotion(source), [{
    name: 'probe', inputs: [{ buttons: 0, sourceBodyWidth: 8 }],
  }], {});
  await assert.rejects(run('export const init=()=>({}); export const step=()=>({state:{},output:{ownsMotion:false,displacement:{x:NaN,y:0},events:[]}});'), /finite JSON/);
  await assert.rejects(run('export const init=()=>({}); export const step=()=>({state:{},output:{ownsMotion:true,displacement:{x:0,y:0},events:["passed"]}});'), /invalid motion output/);
  await assert.rejects(run('export const init=()=>({}); export const step=()=>{while(true){}};'), /Script execution timed out|time limit/);
  await assert.rejects(run('export const init=()=>({}); export const step=()=>{return process.env};'), /process is not defined/);
});

test('the donor evaluator accepts walking and rejects incorrect dash timing and accumulated drift', async () => {
  const walkingCase = [{ name: 'walk', steps: [{ buttons: 32, frames: 8 }, { buttons: 16, frames: 8 }] }];
  const correct = await evaluateMotion(walking, { walkingSpeed: 2 }, walkingCase);
  assert.equal(correct.passed, true);
  assert.equal(correct.results[0].maxPositionError, 0);
  const drift = await evaluateMotion(walking.replace('x * config.walkingSpeed', 'x * (config.walkingSpeed + 0.25)'), { walkingSpeed: 2 }, walkingCase);
  assert.equal(drift.passed, false);
  assert.equal(drift.results[0].firstDivergence.tick, 2);
  const dash = await evaluateMotion(walking, { walkingSpeed: 2 }, [{
    name: 'dash', steps: [{ buttons: 0, frames: 10 }, { buttons: 33, frames: 1 }],
  }]);
  assert.equal(dash.passed, false);
  assert.deepEqual(dash.results[0].firstDivergence.expected.events, ['dash-start']);
  assert.deepEqual(dash.results[0].firstDivergence.preceding.map(frame => frame.tick), [9, 10]);
  assert.deepEqual(dash.results[0].firstDivergence.preceding.map(frame => frame.expected.position), [{x:0,y:0}, {x:0,y:0}]);
  assert.deepEqual(dash.results[0].firstDivergence.inputs, [{buttons:0,frames:10}, {buttons:33,frames:1}]);
  const heldout = await evaluateMotion(walking, { walkingSpeed: 2 }, [{name:'heldout-fixture',steps:[{buttons:0,frames:10},{buttons:33,frames:1}]}], {suite:'acceptance'});
  assert.equal(heldout.results[0].firstDivergence.preceding, undefined, 'Repair context is development-only');
});

test('acceptance inputs are repeatable per seed and independent from development cases', () => {
  const first = acceptanceCases(12345);
  assert.deepEqual(acceptanceCases(12345), first);
  assert.notDeepEqual(acceptanceCases(54321), first);
  assert.equal(first.length, 20);
  assert.ok(first.every(trace => trace.steps.reduce((sum, step) => sum + step.frames, 0) === 150));
});
