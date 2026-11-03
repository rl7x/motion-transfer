// Deliberately declarative: generated rule modules cannot execute arbitrary actions.
export const NO_RULE_SOURCE = 'export default null;\n';
export const DASH_END_SHOT = Object.freeze({ event: 'dash-end', action: 'native-shot', delayTicks: 1 });
export function readRuleSource(source) {
  if (source == null) return null;
  if (typeof source !== 'string' || source.length > 2048) throw Error('Rule module exceeds 2 KB');
  const match = source.trim().match(/^export\s+default\s+([\s\S]*?);?$/);
  if (!match) throw Error('Rule must export a JSON literal as its default');
  let value; try { value = JSON.parse(match[1]); } catch { throw Error('Rule must be a declarative JSON literal'); }
  if (value === null) return null;
  if (!value || Object.keys(value).sort().join(',') !== 'action,delayTicks,event' || value.event !== 'dash-end' || value.action !== 'native-shot' || value.delayTicks !== 1) throw Error('Only dash-end → one native shot on the next tick is supported');
  return { ...DASH_END_SHOT };
}

/** The host owns the native action, its cap/cooldown and the rule's bounded JSON state. */
export function installParallaxiaRule(recipe, { fireShot, shipAbsent }) {
  globalThis.parallaxiaRuleReset = sim => { sim.motionRule = { pendingFrame: null, lastEndFrame: null, attempts: 0, fired: 0, suppressed: 0 }; };
  globalThis.parallaxiaRuleEvent = (sim, events) => {
    const state = sim.motionRule;
    if (!recipe || !state || !events.includes('dash-end') || state.lastEndFrame === sim.frame) return;
    state.lastEndFrame = sim.frame;
    state.pendingFrame = sim.frame + 1;
  };
  globalThis.parallaxiaRuleStep = sim => {
    const state = sim.motionRule;
    if (!state || state.pendingFrame === null || state.pendingFrame > sim.frame) return;
    state.pendingFrame = null; state.attempts++;
    const before = sim.ship.fireCount;
    if (sim.phase === 'play' && !shipAbsent(sim.ship)) fireShot(sim);
    if (sim.ship.fireCount > before) state.fired++; else state.suppressed++;
  };
}
