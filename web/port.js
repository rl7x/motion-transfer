import { validateAdapterOutput } from '/assets/transfer-output.js';

export function createMotionPort(adapter, recovered, config) {
  let state, coreState, output, origin, dash = false, initCalls = 0, stepCalls = 0, replayControls = [];
  const frozen = Object.freeze({ motion: Object.freeze(config.motion), unitScale: config.unitScale });
  const motion = Object.freeze({
    init(config) { initCalls++; coreState = recovered.init(config); return coreState; },
    step(state, input, config) {
      if (input.sourceBodyWidth !== 8) throw Error('Transfer changed verified source geometry');
      stepCalls++;
      const result = recovered.step(state, input, config);
      coreState = structuredClone(result.state);
      return result;
    },
  });
  const port = {
    reset(replay = false) {
      initCalls = stepCalls = 0;
      state = adapter.init(motion, frozen);
      if (initCalls !== 1) throw Error('Adapter must initialize the recovered component once');
      output = null;
      if (!replay) replayControls = [];
    },
    setDash(value) { dash = Boolean(value); },
    move(frame) {
      const down = window.isReplaying ? Boolean(replayControls[frame.tick]) : dash;
      if (!window.isReplaying) replayControls[frame.tick] = down;
      origin = frame.position;
      const before = stepCalls;
      const result = adapter.step(state, Object.freeze({ ...frame, dash: down }), motion, frozen);
      if (stepCalls !== before + 1 || initCalls !== 1) throw Error('Adapter must step the recovered component once per update');
      validateAdapterOutput(result.output);
      if (!result.output.ownsMotion && result.output.displacement !== frame.normalDisplacement) throw Error('Adapter changed ordinary recipient movement');
      state = result.state;
      output = structuredClone(result.output);
      return output;
    },
    paint(output, glyph, y, facing) {
      if (!output.ownsMotion || !output.sweep.length) return;
      window.color('light_green');
      for (const offset of output.sweep) window.char(glyph, origin + offset, y, { mirror: { x: facing } });
      window.color('green');
    },
    snapshot() { return { core: coreState, output, initCalls, stepCalls, dashHeld: dash }; },
  };
  document.addEventListener('keydown', event => {
    if (event.code !== 'KeyD') return;
    port.setDash(true); event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  document.addEventListener('keyup', event => {
    if (event.code !== 'KeyD') return;
    port.setDash(false); event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  window.addEventListener('blur', () => port.setDash(false));
  window.addEventListener('message', event => {
    if (event.origin === location.origin && event.source === parent && event.data?.type === 'dash') port.setDash(event.data.pressed);
  });
  return port;
}
