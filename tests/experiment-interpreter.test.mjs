import assert from 'node:assert/strict';
import test from 'node:test';
import {executeExperimentProgram,INTERPRETER_LIMITS} from '../experiment/interpreter.mjs';

test('the isolated interpreter supports typed loops and decisions on capability results',async()=>{
  const values=[];
  const result=await executeExperimentProgram({language:'typescript',source:`const observed:number[]=[];for(const value of [1,2,3]){const result=await sdk.runExperiment({value});observed.push(result.actual);if(result.actual>3)break;}return observed;`,invoke:async(name,args)=>{assert.equal(name,'run_experiment');values.push(args.value);return{actual:args.value*2};}});
  assert.deepEqual(result.output,[2,4]);assert.deepEqual(values,[1,2]);assert.equal(result.operations,2);assert.equal(result.interpreter.boundary,'WebAssembly interpreter with JSON-only capabilities');
});

test('guest globals and constructor tricks cannot obtain Node, filesystem, network or imports',async()=>{
  const invoke=async()=>assert.fail('No capability should run');
  const denied=['process.env.MODEL_API_KEY','require("node:fs")','fetch("https://example.invalid")','globalThis.constructor.constructor("return process")()','await import("node:fs")','await import("std")'];
  for(const expression of denied)await assert.rejects(executeExperimentProgram({source:'return '+expression,invoke}));
  const inspected=await executeExperimentProgram({source:'return {process:typeof process,fetch:typeof fetch,require:typeof require,os:typeof os,WebAssembly:typeof WebAssembly};',invoke});
  assert.deepEqual(inspected.output,{process:'undefined',fetch:'undefined',require:'undefined',os:'undefined',WebAssembly:'undefined'});
});

test('invalid code, memory pressure, loops, recursion, cancellation and oversized output stop cleanly',async()=>{
  const invoke=async()=>({});
  for(const source of ['const = ;','while(true) {}','function recurse(){return recurse()} return recurse();','return new Array(4000000).fill("memory");','return "x".repeat(5000);'])await assert.rejects(executeExperimentProgram({source,invoke,limits:{...INTERPRETER_LIMITS,timeoutMs:200,maxInterrupts:128}}));
  const controller=new AbortController();controller.abort();await assert.rejects(executeExperimentProgram({source:'return 1;',invoke,signal:controller.signal}),/cancelled/);
  assert.equal((await executeExperimentProgram({source:'return 7;',invoke})).output,7,'A failed program cannot poison the next interpreter');
});

test('unawaited, concurrent and excessive SDK operations cannot escape execution budgets',async()=>{
  for(const source of ['sdk.runExperiment({});return 1;','await Promise.all([sdk.runExperiment({}),sdk.runExperiment({})]);return 1;','for(let i=0;i<20;i++)await sdk.runExperiment({});return 1;'])await assert.rejects(executeExperimentProgram({source,invoke:async()=>{await new Promise(resolve=>setTimeout(resolve,1));return{};}}));
});
