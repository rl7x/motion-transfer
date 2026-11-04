import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { BOOT_STATES, INPUTS, createDonor } from './state-space.mjs';

const canonical = value => JSON.stringify(value, (_key, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

// The same isolation as the motion worker, plus the function prototypes, so a helper cannot hide state there.
function candidateRunner(code) {
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(`
    'use strict';
    globalThis.WebAssembly = undefined;
    globalThis.Date = undefined;
    Math.random = () => { throw new Error('Randomness is unavailable'); };
    const frozen = new Set();
    function freezeIntrinsic(value) {
      if (!value || !['function', 'object'].includes(typeof value) || frozen.has(value)) return;
      frozen.add(value);
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if ('value' in descriptor) freezeIntrinsic(descriptor.value);
      Object.freeze(value);
    }
    [Object, Array, Number, String, Boolean, Math, JSON, Reflect, RegExp, Map, Set, WeakMap, WeakSet, Symbol, BigInt,
      Error, TypeError, SyntaxError, RangeError, URIError, EvalError, ReferenceError, parseInt, parseFloat, isFinite, isNaN,
      Object.getPrototypeOf(function () {}), Object.getPrototypeOf(function* () {}), Object.getPrototypeOf(async function () {})].forEach(freezeIntrinsic);
    function encode(value) {
      const text = JSON.stringify(value, (key, item) => {
        if (['undefined', 'function', 'symbol', 'bigint'].includes(typeof item) || (typeof item === 'number' && !Number.isFinite(item))) throw new Error('State and output must be finite JSON');
        return item;
      });
      if (text.length > 8192) throw new Error('State and output must stay under 8 KB');
      return text;
    }
    ${code}
    if (typeof candidate.init !== 'function' || typeof candidate.step !== 'function') throw new Error('The module must export init and step');
  `, { filename: 'firmware-candidate.js' }).runInContext(context, { timeout: 500 });
  const init = new vm.Script(`(() => {
    const value = JSON.parse(encode(candidate.init(JSON.parse(globalThis.__boot))));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('init must return a JSON object');
    return JSON.stringify(value);
  })()`);
  const expand = new vm.Script(`(() => {
    const request = JSON.parse(globalThis.__request), results = [];
    for (const input of request.inputs) {
      const result = JSON.parse(encode(candidate.step(JSON.parse(request.state), Object.freeze(input))));
      if (!result?.state || typeof result.state !== 'object' || Array.isArray(result.state)) throw new Error('step must return {state, output} with a JSON object state');
      results.push(result);
    }
    return JSON.stringify(results);
  })()`);
  return {
    init(boot) { context.__boot = JSON.stringify(boot); return JSON.parse(init.runInContext(context, { timeout: 500 })); },
    expand(state, inputs) {
      context.__request = JSON.stringify({ state: JSON.stringify(state), inputs });
      return JSON.parse(expand.runInContext(context, { timeout: 2000 }));
    },
  };
}

function search({ code, bytes, maxChecks }) {
  return (async () => {
    const donor = await createDonor(bytes), candidate = candidateRunner(code);
    const pairs = [], seen = new Set();
    const add = (snapshot, key, state, parent, boot, input) => {
      const id = key + '\0' + canonical(state);
      if (seen.has(id)) return;
      seen.add(id); pairs.push({ snapshot, state, parent, boot, input });
    };
    for (const boot of BOOT_STATES) { donor.boot(boot); add(donor.snapshot(), donor.key(), candidate.init(boot), -1, boot, null); }
    const stats = { pairs: pairs.length, checked: 0, complete: false };
    for (let cursor = 0; cursor < pairs.length; cursor++) {
      if (stats.checked + INPUTS.length > maxChecks) return { verdict: 'inconclusive', reason: 'search-cap', ...stats };
      const pair = pairs[cursor], results = candidate.expand(pair.state, INPUTS);
      for (let index = 0; index < INPUTS.length; index++) {
        donor.restore(pair.snapshot);
        const expected = donor.step(INPUTS[index]), result = results[index];
        stats.checked++;
        if (result.output !== expected) {
          const path = [INPUTS[index]];
          let origin = pair;
          for (; origin.parent >= 0; origin = pairs[origin.parent]) path.push(origin.input);
          path.reverse();
          return await confirm({ bytes, code, boot: origin.boot, path, stats });
        }
        add(donor.snapshot(), donor.key(), result.state, cursor, null, INPUTS[index]);
      }
      donor.assertBalanced();
      stats.pairs = pairs.length;
    }
    stats.complete = true;
    return { verdict: 'proved', ...stats };
  })();
}

/** Replay in new instances of both sides, so the failure cannot rest on search state. */
async function confirm({ bytes, code, boot, path, stats }) {
  const donor = await createDonor(bytes), candidate = candidateRunner(code);
  donor.boot(boot);
  let state = candidate.init(boot);
  const trace = [];
  for (const input of path) {
    const expected = donor.step(input), [result] = candidate.expand(state, [input]);
    trace.push({ input, expected, actual: result.output });
    state = result.state;
    if (result.output !== expected) return { verdict: 'counterexample', ...stats, counterexample: { boot, length: trace.length, trace } };
  }
  return { verdict: 'inconclusive', reason: 'counterexample-not-confirmed', ...stats };
}

try {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  const request = JSON.parse(text);
  const bytes = await readFile(request.firmwarePath);
  process.stdout.write(JSON.stringify(await search({ code: request.code, bytes, maxChecks: request.maxChecks })));
} catch (error) {
  process.stdout.write(JSON.stringify({ verdict: 'inconclusive', reason: 'candidate-execution', error: String(error.message).slice(0, 500) }));
}
