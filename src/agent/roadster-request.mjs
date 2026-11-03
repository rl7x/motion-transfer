import { validateRoadsterIntent } from '../roadster/port.mjs';

export const ROADSTER_TOOL = {type:'function',name:'submit_roadster_adapter',strict:true,description:'Submit a supported adapter and complete inherited mapping, or an explicit unsupported explanation. The host independently verifies supported source.',parameters:{type:'object',properties:{status:{type:'string',enum:['supported','unsupported']},source:{type:'string',maxLength:16384},summary:{type:'string',maxLength:1000},intent:{type:'object',properties:{unitScale:{type:'number',minimum:.025,maximum:.2},activation:{type:'string',enum:['held','press']},direction:{type:'string',enum:['facing','opposite']}},required:['unitScale','activation','direction'],additionalProperties:false}},required:['status','source','summary','intent'],additionalProperties:false}};
export const ROADSTER_INSTRUCTIONS = "Adapt the supplied frozen recovered controller to the RDSTR Stunts recipient through a HUMAN-AUTHORED host port.\nChange only the adapter. No imports, DOM, clocks, randomness, files or networking. Return TypeScript using submit_roadster_adapter once.\nRetain the complete parent mapping except the changes requested. Support only distance (unitScale 0.025..0.2 meters/source pixel), held/fresh-press activation, and forward/backward direction. For supported requests submit status supported. For unsupported requests submit status unsupported, empty source, unchanged parent intent and a useful summary explaining the limit. Never silently approximate unsupported requests or change recipient physics.\nExport init(motion,config), returning {core:motion.init(config.motion), ...your JSON edge state}.\nExport step(state,frame,motion,config), returning {state:{core:next.state,...},output:{displacement:number,ownsMotion:boolean,events:string[],sweep:number[]}}.\nconfig has ONLY {motion: frozen defaults,unitScale: requested intent.unitScale}. There are no activation/direction fields in config. Embed the selected activation and direction as adapter literals matching your submitted intent. Use these exact motion defaults, do not reconstruct timers or copy movement formulas.\nframe is {tick,position,facing,normalDisplacement,dash,airborne}. facing is -1 or 1 (the real car host uses +1, world +X along the stunt). dash is raw held X. The host has separate native controls for thrust/rotation.\nInitialize motion once. Call motion.step(state.core,{buttons,sourceBodyWidth:8},config.motion) EXACTLY ONCE EVERY update, including grounded/inactive ticks.\nAlways map direction to donor left=16/right=32, EVEN when dash is inactive or the car is grounded: buttons=(mappedFacing<0?16:32)|(activate?1:0). Opposite means negate frame.facing. Map raw dash to donor X=1 ONLY if airborne. Held uses held raw input; press uses raw false-to-true edges, consumed even on the ground or in cooldown. Track the previous RAW dash every update. Source timers/direction must remain inside the frozen core.\nIf next.output.ownsMotion, output displacement=next.output.displacement.x*config.unitScale; otherwise frame.normalDisplacement EXACTLY. Copy ownsMotion and events exactly, even if an existing dash outlasts landing. The host applies transferred movement only in flight.\nsweep is [] if inactive, otherwise ordered intermediate offsets excluding 0 and displacement, gaps at most 1 meter (including to endpoints). The host further substeps collisions at 0.02m.\nThe host advances the core at 60Hz and applies each active horizontal displacement across four 240Hz native steps. Gravity, vertical motion, spin, fuel and collisions remain native. Do not implement a dash duration or cooldown. Do not report your own verification.";
export const ROADSTER_RECIPIENT_POLICY = 'World X along jump path; Y vertical; native 240Hz. Airborne-only activation; preserve vertical/rotation/fuel. 60 source pixels become 6m at scale .1.';
export const ROADSTER_INPUT_TOKEN_LIMIT = 12000;
export const ROADSTER_MAX_OUTPUT_TOKENS = 3000;

export function assertRoadsterInputTokens(inputTokens) {
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || inputTokens > ROADSTER_INPUT_TOKEN_LIMIT) {
    throw Error('Roadster input-token limit exceeded');
  }
  return inputTokens;
}

export function roadsterEvidence({ prompt, parentIntent, parentSource = '', component, recipient }) {
  if (!component?.javascript || component.contract == null) throw Error('Verified parent component is incomplete');
  if (!recipient?.name || !recipient?.revision) throw Error('Verified parent recipient is incomplete');
  return {
    request: prompt,
    parentIntent,
    parentSource,
    component: { javascript: component.javascript, contract: component.contract },
    recipient: { name: recipient.name, revision: recipient.revision, policy: ROADSTER_RECIPIENT_POLICY },
  };
}

export function roadsterProviderRequest({ model, evidence }) {
  return {
    model,
    instructions: ROADSTER_INSTRUCTIONS,
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(evidence) }] }],
    tools: [ROADSTER_TOOL],
    store: false,
    reasoning: { effort: 'minimal' },
    max_output_tokens: ROADSTER_MAX_OUTPUT_TOKENS,
    parallel_tool_calls: false,
  };
}

export function readRoadsterSubmission(text, parentIntent, { parentSource = '' } = {}) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 24000) throw Error('Meta did not submit a supported complete Roadster adapter');
  let submission;
  try { submission = JSON.parse(text); }
  catch { throw Error('Meta did not submit a supported complete Roadster adapter'); }
  validateRoadsterIntent(submission.intent);
  const keys = Object.keys(submission).sort().join(',');
  if (!['intent,source,status,summary', 'intent,source,summary'].includes(keys) || typeof submission.source !== 'string' || Buffer.byteLength(submission.source) > 16384 || typeof submission.summary !== 'string' || !submission.summary.trim() || submission.summary.length > 1000 || !['supported', 'unsupported'].includes(submission.status ?? 'supported')) {
    throw Error('Invalid Roadster submission');
  }
  const status = submission.status ?? 'supported';
  if (status === 'unsupported') {
    if (submission.source !== '' || Object.keys(parentIntent).some(key => submission.intent[key] !== parentIntent[key])) {
      throw Error('Unsupported requests must leave the parent unchanged');
    }
    return submission;
  }
  if (!submission.source.trim()) throw Error('A supported adapter needs complete source');
  if (parentSource && Object.keys(parentIntent).every(key => submission.intent[key] === parentIntent[key])) {
    throw Error('The proposed mapping does not change the parent');
  }
  return submission;
}
