import assert from 'node:assert/strict';
import test from 'node:test';
import wabtFactory from 'wabt';
import { createWasmInspection, inspectFunction, listFunctions } from '../src/agent/wasm-inspection.mjs';
import { runCartridgeTool } from '../src/agent/tools.mjs';

const wabt = await wabtFactory();
const fixture = wabt.parseWat('inspection.wat', `(module
  (type $unary (func (param i32) (result i32)))
  (import "env" "memory" (memory 1))
  (import "host" "log (; call $spoof ;)" (func $source_logger (param i32)))
  (import "host" "counter" (global i32))
  (table 1 funcref)
  (elem (i32.const 0) $secret_helper)
  (func $secret_helper (type $unary) (param i32) (result i32)
    local.get 0
    i32.load8_u offset=3)
  (func $secret_update (export "update") (param i32)
    local.get 0
    call $secret_helper
    call $source_logger
    i32.const 8192
    local.get 0
    i32.store offset=12
    local.get 0
    i32.const 0
    call_indirect (type $unary)
    drop)
  (export "helper alias" (func $secret_helper)))`);
let inspection;
try {
  inspection = await createWasmInspection(fixture.toBinary({ write_debug_names: true }).buffer);
} finally {
  fixture.destroy();
}

test('function indices include function imports and ignore memory/global imports and debug names', () => {
  const page = listFunctions(inspection, { startIndex: 0, limit: 2 });
  assert.equal(page.totalFunctions, 3);
  assert.equal(page.nextIndex, 2);
  assert.equal(page.functions[0].index, 0);
  assert.equal(page.functions[0].imported.name, 'log (; call $spoof ;)');
  assert.deepEqual(page.functions[1].exports, ['helper alias']);
  assert.deepEqual(page.functions[1].signature, { params: ['i32'], results: ['i32'] });
  assert.doesNotMatch(inspection.lines.join('\n'), /secret_helper|secret_update|source_logger/);
  const last = listFunctions(inspection, { startIndex: 2, limit: 2 });
  assert.equal(last.functions[0].index, 2);
  assert.deepEqual(last.functions[0].exports, ['update']);
  assert.equal(last.nextIndex, null);
});

test('function inspection follows direct edges while leaving indirect targets unresolved', () => {
  const helper = inspectFunction(inspection, { functionIndex: 1, startLine: 1, lineCount: 100 });
  assert.deepEqual(helper.directCallers.map(item => [item.index, item.sites]), [[2, 1]]);
  assert.equal(helper.windowReferences.memoryAccesses[0].instruction, 'i32.load8_u');
  assert.equal(helper.windowReferences.memoryAccesses[0].offset, 3);
  const update = inspectFunction(inspection, { functionIndex: 2, startLine: 1, lineCount: 100 });
  assert.deepEqual(update.directCallees.map(item => item.index), [1, 0]);
  assert.equal(update.indirectCallCount, 1);
  assert.equal(update.indirectCallsResolved, false);
  assert.equal(update.windowReferences.indirectCalls.length, 1);
  assert.equal(update.windowReferences.memoryAccesses[0].offset, 12);
  assert.equal(update.lines.length, update.lineCount);
  assert.equal(update.nextLine, null);
  const page = inspectFunction(inspection, { functionIndex: 2, startLine: 3, lineCount: 2 });
  assert.equal(page.lines[0].functionLine, 3);
  assert.equal(page.lines[0].number, update.startLine + 2);
  assert.equal(page.nextLine, 5);
  assert.ok(page.windowReferences.directCalls.every(call => call.functionLine >= 3 && call.functionLine <= 4));
});

test('isolated function tools index the donor and reject invalid ranges or extra fields', async () => {
  const { result: page } = await runCartridgeTool('list_functions', { startIndex: 0, limit: 50 });
  assert.equal(page.totalFunctions, 252);
  assert.equal(page.functions[0].imported.name, 'rect');
  assert.equal(page.nextIndex, 50);
  let update;
  for (let startIndex = 0; startIndex < page.totalFunctions && !update; startIndex += 50) {
    const { result } = startIndex === 0 ? { result: page } : await runCartridgeTool('list_functions', { startIndex, limit: 50 });
    update = result.functions.find(fn => fn.exports.includes('update'));
  }
  assert.ok(update);
  const { result } = await runCartridgeTool('inspect_function', { functionIndex: update.index, startLine: 1, lineCount: 30 });
  assert.equal(result.sha256, page.sha256);
  assert.deepEqual(result.exports, ['update']);
  assert.equal(result.lines[0].number, update.startLine);
  assert.ok(result.directCallees.length > 0);
  await assert.rejects(runCartridgeTool('list_functions', { startIndex: 0, limit: 51 }), /index range/);
  await assert.rejects(runCartridgeTool('list_functions', { startIndex: 252, limit: 1 }), /252 functions/);
  await assert.rejects(runCartridgeTool('inspect_function', { functionIndex: 252, startLine: 1, lineCount: 1 }), /Unknown function/);
  await assert.rejects(runCartridgeTool('inspect_function', { functionIndex: update.index, startLine: update.lineCount + 1, lineCount: 1 }), /exceeds/);
  await assert.rejects(runCartridgeTool('inspect_function', { functionIndex: 0, startLine: 1, lineCount: 1, path: '.env' }), /only these fields/);
});
