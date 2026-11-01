import vm from 'node:vm';

try {
  let text = '';
  for await (const chunk of process.stdin) { text += chunk; if (Buffer.byteLength(text) > 512 * 1024) throw Error('Adapter request exceeds 512 KB'); }
  const request = JSON.parse(text);
  if (!Array.isArray(request.traces) || request.traces.length < 1 || request.traces.length > 32
    || request.traces.some(trace => !Array.isArray(trace.frames) || trace.frames.length < 1 || trace.frames.length > 600)) throw Error('Invalid adapter trace limits');
  const traces = [];
  for (const trace of request.traces) {
    const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
    const script = new vm.Script(`
      globalThis.WebAssembly = undefined; globalThis.Date = undefined;
      Math.random = () => { throw Error('Adapter randomness is unavailable'); };
      ${request.componentCode}
      ${request.code}
      (() => {
        const request = JSON.parse(${JSON.stringify(JSON.stringify({ trace, defaults: request.defaults }))});
        const config = Object.freeze({ motion: Object.freeze(request.defaults), unitScale: request.trace.scale ?? 0.5 });
        let initCalls = 0, stepCalls = 0;
        const inputs = [];
        const motion = Object.freeze({
          init(config) { initCalls++; return recovered.init(config); },
          step(state, input, config) {
            stepCalls++; inputs.push(JSON.parse(JSON.stringify(input)));
            if (input.sourceBodyWidth !== 8) throw Error('Adapter must retain verified source body width 8');
            if (request.trace.mockOutputs) return {state:{mockTick:stepCalls},output:request.trace.mockOutputs[stepCalls-1]};
            return recovered.step(state, input, config);
          },
        });
        function copy(value) {
          const text = JSON.stringify(value, (key, item) => {
            if (['undefined','function','symbol','bigint'].includes(typeof item)
              || (typeof item === 'number' && !Number.isFinite(item))) throw Error('Adapter state/output must be finite JSON');
            return item;
          });
          if (!text || text.length > 8192) throw Error('Adapter state/output exceeds limits');
          return JSON.parse(text);
        }
        let state = copy(candidate.init(motion, config));
        if (initCalls !== 1 || !state || typeof state !== 'object' || Array.isArray(state)) throw Error('Adapter must initialize the recovered component exactly once');
        const outputs = [];
        for (const frame of request.trace.frames) {
          const before = stepCalls;
          const result = copy(candidate.step(state, Object.freeze(frame), motion, config));
          if (stepCalls !== before + 1 || initCalls !== 1) throw Error('Adapter must step the recovered component exactly once per recipient update');
          state = result.state; outputs.push(result.output);
        }
        return JSON.stringify({outputs,inputs});
      })();
    `);
    const result = JSON.parse(script.runInContext(context, { timeout: 500 }));
    traces.push({ name: trace.name, ...result });
  }
  process.stdout.write(JSON.stringify({ ok: true, traces }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(error.message).slice(0, 500) }));
  process.exitCode = 1;
}
