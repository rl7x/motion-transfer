import vm from 'node:vm';

const omittedFields = ['x', 'y'];
const project = state => Object.fromEntries(Object.entries(state).filter(([key]) => !omittedFields.includes(key)));
const canonical = value => JSON.stringify(value, (_key, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

function candidateRunner(code, config) {
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  const init = new vm.Script(`
    'use strict';
    globalThis.WebAssembly = undefined;
    globalThis.Date = undefined;
    Math.random = () => { throw new Error('Randomness is unavailable in motion components'); };
    // Builtins must not become a second, untracked state store.
    const frozenObjects = new Set();
    function freezeIntrinsic(value) {
      if (!value || !['function', 'object'].includes(typeof value) || frozenObjects.has(value)) return;
      frozenObjects.add(value);
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
        if ('value' in descriptor) freezeIntrinsic(descriptor.value);
      }
      Object.freeze(value);
    }
    [Object, Array, Number, String, Boolean, Math, JSON, Reflect, RegExp, Map, Set, WeakMap, WeakSet, Symbol, BigInt,
      Error, TypeError, SyntaxError, RangeError, URIError, EvalError, ReferenceError,
      parseInt, parseFloat, isFinite, isNaN].forEach(freezeIntrinsic);
    function encode(value) {
      const text = JSON.stringify(value, (key, item) => {
        if (['undefined', 'function', 'symbol', 'bigint'].includes(typeof item)
          || (typeof item === 'number' && !Number.isFinite(item))) throw new Error('Component state/output must be finite JSON');
        return item;
      });
      if (text.length > 8192) throw new Error('Component state/output exceeds 8 KB');
      return text;
    }
    function validState(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Component must return JSON object state');
      return value;
    }
    const config = Object.freeze(JSON.parse(${JSON.stringify(JSON.stringify(config))}));
    ${code}
    if (typeof candidate.init !== 'function' || typeof candidate.step !== 'function') throw new Error('Component must export init and step');
    encode(validState(candidate.init(config)));
  `, { filename: 'exhaustive-init.js' });
  const state = JSON.parse(init.runInContext(context, { timeout: 500 }));
  const expand = new vm.Script(`(() => {
    const request = JSON.parse(globalThis.__request);
    const results = [];
    for (const buttons of request.buttons) {
      const input = Object.freeze({ buttons, sourceBodyWidth: 8 });
      const result = JSON.parse(encode(candidate.step(JSON.parse(request.state), input, config)));
      validState(result.state);
      let alternate = null;
      if (request.perturb) {
        const changed = JSON.parse(request.state);
        for (const field of ['x', 'y']) if (Object.hasOwn(changed, field)) {
          if (typeof changed[field] !== 'number') throw new Error('Omitted position fields must be finite numbers');
          changed[field] += 1000;
        }
        alternate = JSON.parse(encode(candidate.step(changed, input, config)));
        validState(alternate.state);
      }
      results.push({ result, alternate });
    }
    return JSON.stringify(results);
  })()`, { filename: 'exhaustive-step.js' });
  return { state, expand(state, buttons) {
    context.__request = JSON.stringify({ state: JSON.stringify(state), buttons, perturb: omittedFields.some(field => Object.hasOwn(state, field)) });
    return JSON.parse(expand.runInContext(context, { timeout: 500 }));
  } };
}

function validateResult(result, timerFields) {
  const output = result?.output;
  if (!output || Object.keys(output).sort().join(',') !== 'displacement,events,ownsMotion'
    || typeof output.ownsMotion !== 'boolean' || !output.displacement
    || Object.keys(output.displacement).sort().join(',') !== 'x,y'
    || ![output.displacement.x, output.displacement.y].every(Number.isFinite)
    || !Array.isArray(output.events) || output.events.length > 2
    || new Set(output.events).size !== output.events.length
    || output.events.some(event => !['dash-start', 'dash-end'].includes(event))) {
    throw Error('Component returned an invalid motion output');
  }
  for (const field of Object.values(timerFields)) {
    if (!Number.isSafeInteger(result.state[field])) throw Error('Component returned invalid normalized timers');
  }
}

function search({ code, config, timerFields, space, maxChecks, tolerance }) {
  const candidate = candidateRunner(code, config);
  const nodes = new Map(space.states.map(node => [node.key, node]));
  const pairs = [{ key: space.rootKey, state: candidate.state, parent: -1, buttons: null }];
  const seen = new Set([canonical([space.rootKey, project(candidate.state)])]);
  const omitted = new Set();
  const stats = { pairs: 1, checked: 0, complete: false, maxDisplacementError: 0,
    projection: { fields: [], checked: 0, failures: 0, firstFailure: null } };
  const result = (verdict, extra = {}) => ({ verdict, ...stats, ...extra });
  for (let cursor = 0; cursor < pairs.length; cursor++) {
    if (stats.checked >= maxChecks) return result('inconclusive', { reason: 'search-cap' });
    const pair = pairs[cursor], node = nodes.get(pair.key);
    const buttons = space.buttonMasks.slice(0, maxChecks - stats.checked);
    const outputs = candidate.expand(pair.state, buttons);
    for (let index = 0; index < buttons.length; index++) {
      const { result: actual, alternate } = outputs[index], expected = node.transitions[index];
      validateResult(actual, timerFields);
      stats.checked++;
      if (alternate) {
        validateResult(alternate, timerFields);
        for (const field of omittedFields) if (Object.hasOwn(pair.state, field)) omitted.add(field);
        stats.projection.fields = [...omitted].sort();
        stats.projection.checked++;
        if (canonical(project(actual.state)) !== canonical(project(alternate.state))
          || canonical(actual.output) !== canonical(alternate.output)) {
          stats.projection.failures++;
          stats.projection.firstFailure ??= { state: pair.state, buttons: buttons[index],
            original: actual, perturbed: alternate };
        }
      }
      const error = Math.hypot(actual.output.displacement.x - expected.displacement.x,
        actual.output.displacement.y - expected.displacement.y);
      stats.maxDisplacementError = Math.max(stats.maxDisplacementError, error);
      const reasons = [];
      if (error > tolerance) reasons.push('displacement');
      if (actual.output.ownsMotion !== expected.ownsMotion) reasons.push('ownsMotion');
      if (canonical(actual.output.events) !== canonical(expected.events)) reasons.push('events');
      for (const field of ['cooldown', 'remaining']) {
        if (actual.state[timerFields[field]] !== expected.timers[field]) reasons.push(field);
      }
      if (reasons.length) {
        const path = [buttons[index]];
        for (let parent = cursor; pairs[parent].parent >= 0; parent = pairs[parent].parent) path.push(pairs[parent].buttons);
        path.reverse();
        return result('counterexample', { counterexample: { length: path.length, buttons: path, reasons,
          expected, actual: { output: actual.output, timers: Object.fromEntries(Object.entries(timerFields).map(([name, field]) => [name, actual.state[field]])) } } });
      }
      const id = canonical([expected.next, project(actual.state)]);
      if (!seen.has(id)) {
        seen.add(id);
        pairs.push({ key: expected.next, state: actual.state, parent: cursor, buttons: buttons[index] });
        stats.pairs = pairs.length;
      }
    }
    if (buttons.length < space.buttonMasks.length) return result('inconclusive', { reason: 'search-cap' });
  }
  stats.complete = true;
  return stats.projection.failures
    ? result('inconclusive', { reason: 'position-affects-behavior' }) : result('proved');
}

try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 8 * 1024 * 1024) throw Error('Exhaustive request exceeds 8 MB');
  }
  process.stdout.write(JSON.stringify(search(JSON.parse(input))));
} catch (error) {
  process.stdout.write(JSON.stringify({ verdict: 'inconclusive', reason: 'candidate-execution', error: String(error.message).slice(0, 500) }));
}
