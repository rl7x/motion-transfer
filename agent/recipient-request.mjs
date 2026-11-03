import { ROADSTER_TOOL, roadsterEvidence, roadsterProviderRequest, readRoadsterSubmission } from './roadster-request.mjs';

export const PARALLAXIA_TOOL = { ...ROADSTER_TOOL, name: 'submit_parallaxia_adapter' };
export const PARALLAXIA_INSTRUCTIONS = `Adapt the supplied accepted recovered dash to PARALLAXIA. Change only the TypeScript adapter; use submit_parallaxia_adapter once with a supported complete mapping or an explicit unsupported explanation.
PARALLAXIA is a source-available native 60Hz shooter, not RDSTR. Coordinates are world units, not meters or Canvas pixels: the 60-source-pixel dash maps to 6 world units at scale 0.1, rendered at 10 pixels per world unit. The ship faces left or right according to its last horizontal native input. Preserve native movement, swept bullet/ram collision, native respawn and enemy rules. There is NO added invulnerability. Do not implement a shield, teleport, physics changes or a new recovered controller.
Support only distance (unitScale 0.025..0.2 world units/source pixel), direction facing/opposite, activation held/press. Preserve every parent mapping property the request does not change. For unsupported requests return status unsupported, empty source, unchanged parent intent and a useful explanation.
No imports, DOM, clocks, randomness, files or networking. Export init(motion,config) returning {core:motion.init(config.motion), ...JSON edge state}. Initialize the recovered component exactly once.
Export step(state,frame,motion,config) returning {state:{core:next.state,...}, output:{displacement:number,ownsMotion:boolean,events:string[],sweep:number[]}}.
frame is {tick,position,facing,normalDisplacement,dash,airborne}. airborne means the native ship is present and playing. config contains ONLY frozen motion defaults and unitScale; embed activation and direction literals matching the complete submitted intent.
EVERY 60Hz update, including inactive/absent updates, call motion.step(state.core,{buttons,sourceBodyWidth:8},config.motion) EXACTLY ONCE. Map facing to donor left=16/right=32 even without a dash; negate facing for opposite. Add donor X=1 only if frame.airborne and raw dash activates. Held uses raw held; press uses a raw false-to-true edge. Consume edges even during cooldown/absence; track previous RAW dash every update. Do not copy donor timing or displacement formulas.
If next.output.ownsMotion, displacement=next.output.displacement.x*config.unitScale, otherwise EXACTLY frame.normalDisplacement. Copy ownsMotion and events exactly. sweep=[] when inactive; otherwise ordered intermediate offsets with gaps at most one world unit. The host keeps native vertical movement and sweeps collisions along the entire horizontal move. Never report your own verification.`;

export function recipientRequest({ model, context, prompt, feedback = null }) {
  const parallaxia = context.recipient.id === 'parallaxia';
  const evidence = parallaxia ? {
    request: prompt, parentIntent: context.intent, parentSource: context.source,
    component: context.component, recipient: context.recipient,
  } : roadsterEvidence({ prompt, parentIntent: context.intent, parentSource: context.source, component: context.component, recipient: context.recipient });
  if (feedback) evidence.verificationFeedback = feedback;
  const request = roadsterProviderRequest({ model, evidence });
  if (parallaxia) { request.instructions = PARALLAXIA_INSTRUCTIONS; request.tools = [PARALLAXIA_TOOL]; }
  return request;
}

/** Independent intent check for the deliberately bounded PARALLAXIA vocabulary. */
export function requestedParallaxiaIntent(prompt, parent) {
  const text = prompt.toLowerCase();
  if (/invulnerab|immun|shield|enemy|enemies|collision/.test(text) && !/keep|preserve|no added|without/.test(text)) return null;
  const intent = { ...parent }; let changed = false;
  if (/backward|opposite/.test(text)) { intent.direction = 'opposite'; changed = true; }
  else if (/forward|facing/.test(text)) { intent.direction = 'facing'; changed = true; }
  if (/fresh[ -]press|fresh press|on a press/.test(text)) { intent.activation = 'press'; changed = true; }
  else if (/held|hold/.test(text)) { intent.activation = 'held'; changed = true; }
  if (/half/.test(text)) { intent.unitScale /= 2; changed = true; }
  else if (/double|twice/.test(text)) { intent.unitScale *= 2; changed = true; }
  else {
    const distance = text.match(/(\d+(?:\.\d+)?)\s*(?:world[ -]units?|units?)/);
    if (distance) { intent.unitScale = Number(distance[1]) / 60; changed = true; }
  }
  return changed && intent.unitScale >= 0.025 && intent.unitScale <= 0.2 ? intent : null;
}

export function recipientSubmission(response, context, prompt) {
  const tool = context.recipient.id === 'parallaxia' ? PARALLAXIA_TOOL : ROADSTER_TOOL;
  const calls = response.output?.filter(item => item.type === 'function_call') ?? [];
  if (calls.length !== 1 || calls[0].name !== tool.name) throw Error('Meta did not submit one recipient adapter');
  const submission = readRoadsterSubmission(calls[0].arguments, context.intent, { parentSource: context.source });
  if (context.recipient.id === 'parallaxia' && submission.status !== 'unsupported') {
    const expected = requestedParallaxiaIntent(prompt, context.intent);
    if (!expected || Object.keys(expected).some(key => Math.abs(expected[key] - submission.intent[key]) > 1e-9 || (typeof expected[key] === 'string' && expected[key] !== submission.intent[key]))) {
      throw Error('Submitted mapping does not preserve the requested PARALLAXIA intent');
    }
  }
  return submission;
}
