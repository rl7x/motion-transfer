import vm from 'node:vm';

try {
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk;
    if (Buffer.byteLength(text) > 512 * 1024) throw new Error('Candidate request exceeds 512 KB');
  }
  const { code, config, traces } = JSON.parse(text);
  const outputs = [];
  for (const trace of traces) {
    const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
    const script = new vm.Script(`
      'use strict';
      globalThis.WebAssembly = undefined;
      globalThis.Date = undefined;
      Math.random = () => { throw new Error('Randomness is unavailable in motion components'); };
      ${code}
      if (typeof candidate.init !== 'function' || typeof candidate.step !== 'function') {
        throw new Error('Component must export init and step');
      }
      const request = JSON.parse(${JSON.stringify(JSON.stringify({ config, inputs: trace.inputs }))});
      function encode(value) {
        const text = JSON.stringify(value, (key, item) => {
          if (['undefined', 'function', 'symbol', 'bigint'].includes(typeof item)
            || (typeof item === 'number' && !Number.isFinite(item))) throw new Error('Component state/output must be finite JSON');
          return item;
        });
        if (text.length > 8192) throw new Error('Component state/output exceeds 8 KB');
        return text;
      }
      Object.freeze(request.config);
      let state = JSON.parse(encode(candidate.init(request.config)));
      if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('init must return JSON object state');
      const results = [];
      for (const input of request.inputs) {
        const result = JSON.parse(encode(candidate.step(state, Object.freeze(input), request.config)));
        if (!result || !result.state || typeof result.state !== 'object' || Array.isArray(result.state)) {
          throw new Error('step must return an object with JSON object state and output');
        }
        state = result.state;
        results.push(result.output);
      }
      JSON.stringify(results);
    `, { filename: 'motion-rollout.js' });
    const result = script.runInContext(context, { timeout: 500 });
    outputs.push({ name: trace.name, frames: JSON.parse(result) });
  }
  process.stdout.write(JSON.stringify({ ok: true, traces: outputs }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(error.message).slice(0, 500) }));
  process.exitCode = 1;
}
