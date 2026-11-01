import wabtFactory from 'wabt';

function summary(fn) {
  return {
    index: fn.index, name: fn.name, imported: fn.imported, exports: fn.exports,
    signature: fn.signature, startLine: fn.startLine, lineCount: fn.lineCount,
    directCalleeCount: fn.callees.length, directCallerCount: fn.callers.length,
    indirectCallCount: fn.indirectCalls.length, memoryInstructionCount: fn.memoryAccesses.length,
  };
}

// Index WABT's canonical, unfolded output, not arbitrary user-authored WAT.
// Function indices include imported functions; memory/table imports do not consume one.
export async function createWasmInspection(bytes) {
  const module = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(module).filter(item => item.kind === 'function');
  const exports = WebAssembly.Module.exports(module).filter(item => item.kind === 'function');
  const wabt = await wabtFactory();
  const disassembly = wabt.readWasm(bytes, { readDebugNames: false });
  let lines;
  try {
    disassembly.generateNames();
    disassembly.applyNames();
    lines = disassembly.toText({ foldExprs: false, inlineExport: false }).split('\n');
  } finally {
    disassembly.destroy();
  }

  const types = new Map();
  const functions = [];
  const boundaries = [];
  let imported = 0;
  for (const [index, line] of lines.entries()) {
    if (/^  \(/.test(line) || line === ')') boundaries.push(index);
    const type = line.match(/^  \(type (\$\S+) \(func/);
    if (type) {
      const signature = { params: [], results: [] };
      for (const match of line.matchAll(/\((param|result) ([^()]*)\)/g)) {
        signature[match[1] === 'param' ? 'params' : 'results'].push(...match[2].split(' '));
      }
      types.set(type[1], signature);
    }
    const isImport = line.startsWith('  (import ');
    const fn = isImport
      ? line.match(/\(func (\$[^\s()]+) \(type (\$[^\s()]+)\)\)\)$/)
      : line.match(/^  \(func (\$[^\s()]+) \(type (\$[^\s()]+)\)/);
    if (!fn) continue;
    functions.push({
      index: functions.length, name: fn[1], signature: types.get(fn[2]),
      imported: isImport ? imports[imported++] : null, exports: [], startLine: index + 1,
      callees: [], callers: [], indirectCalls: [], memoryAccesses: [], calls: [],
    });
  }
  if (imported !== imports.length || functions.some(fn => !fn.signature)) {
    throw new Error('Unsupported WABT function or type layout');
  }
  const byName = new Map(functions.map(fn => [fn.name, fn]));
  let exported = 0;
  for (const line of lines) {
    const match = line.match(/^  \(export .* \(func (\$[^\s()]+)\)\)$/);
    if (match) {
      const fn = byName.get(match[1]);
      if (!fn || !exports[exported]) throw new Error('Cannot resolve exported function');
      fn.exports.push(exports[exported++].name);
    }
  }
  if (exported !== exports.length) throw new Error('Cannot index all exported functions');

  for (const fn of functions) {
    const end = boundaries.find(index => index >= fn.startLine) ?? lines.length;
    fn.lineCount = end - fn.startLine + 1;
    const calls = new Map();
    for (let line = fn.startLine; line < fn.startLine + fn.lineCount; line++) {
      const text = lines[line - 1];
      const location = { line, functionLine: line - fn.startLine + 1 };
      const call = text.match(/^\s*(?:return_)?call (\$[^\s()]+)/);
      if (call) {
        const callee = byName.get(call[1]);
        if (!callee) throw new Error('Cannot resolve direct call');
        fn.calls.push({ ...location, calleeIndex: callee.index });
        calls.set(callee.index, (calls.get(callee.index) ?? 0) + 1);
      }
      if (/^\s*(?:return_)?call_indirect\b/.test(text)) {
        fn.indirectCalls.push({ ...location, instruction: text.trim() });
      }
      const memory = text.match(/^\s*((?:i32|i64|f32|f64|v128)\.(?:load|store)[\w.]*)\b/);
      if (memory) fn.memoryAccesses.push({
        ...location, instruction: memory[1], offset: Number(text.match(/\boffset=(\d+)/)?.[1] ?? 0),
      });
    }
    fn.callees = [...calls].map(([index, sites]) => ({ index, name: functions[index].name, sites }));
    for (const [index, sites] of calls) functions[index].callers.push({ index: fn.index, name: fn.name, sites });
  }
  return { lines, functions };
}

export function listFunctions(inspection, { startIndex, limit }) {
  if (startIndex >= inspection.functions.length) throw new Error(`startIndex exceeds the ${inspection.functions.length} functions`);
  return {
    totalFunctions: inspection.functions.length,
    functions: inspection.functions.slice(startIndex, startIndex + limit).map(summary),
    nextIndex: startIndex + limit < inspection.functions.length ? startIndex + limit : null,
  };
}

export function inspectFunction(inspection, { functionIndex, startLine, lineCount }) {
  const fn = inspection.functions[functionIndex];
  if (!fn) throw new Error(`Unknown function index: ${functionIndex}`);
  if (startLine > fn.lineCount) throw new Error(`startLine exceeds this function's ${fn.lineCount} lines`);
  const first = fn.startLine + startLine - 1;
  const end = Math.min(first + lineCount, fn.startLine + fn.lineCount);
  const inWindow = item => item.line >= first && item.line < end;
  return {
    ...summary(fn),
    directCallees: fn.callees.slice(0, 50), omittedDirectCallees: Math.max(0, fn.callees.length - 50),
    directCallers: fn.callers.slice(0, 50), omittedDirectCallers: Math.max(0, fn.callers.length - 50),
    indirectCallsResolved: false,
    windowReferences: {
      directCalls: fn.calls.filter(inWindow), indirectCalls: fn.indirectCalls.filter(inWindow),
      memoryAccesses: fn.memoryAccesses.filter(inWindow),
    },
    lines: inspection.lines.slice(first - 1, end - 1).map((text, index) => ({
      number: first + index, functionLine: startLine + index,
      text: text.slice(0, 240), truncated: text.length > 240,
    })),
    nextLine: end < fn.startLine + fn.lineCount ? startLine + lineCount : null,
  };
}

export function navigateCallGraph(inspection,{functionIndex,direction,depth}){
  if(!inspection.functions[functionIndex])throw Error('Unknown function index');
  const nodes=new Map(),edges=[],queue=[[functionIndex,0]],visited=new Set();
  while(queue.length&&nodes.size<60){
    const [index,level]=queue.shift();if(visited.has(index))continue;visited.add(index);
    const fn=inspection.functions[index];nodes.set(index,summary(fn));
    if(level>=depth)continue;
    for(const adjacent of fn[direction].slice(0,50)){
      const from=direction==='callees'?index:adjacent.index,to=direction==='callees'?adjacent.index:index;
      edges.push({from,to,sites:adjacent.sites});queue.push([adjacent.index,level+1]);
    }
  }
  return{rootFunctionIndex:functionIndex,direction,depth,nodes:[...nodes.values()],edges:edges.slice(0,100),truncated:queue.length>0||edges.length>100,indirectCallsResolved:false,notice:'Direct call edges only. Inferred names remain separate annotations.'};
}
