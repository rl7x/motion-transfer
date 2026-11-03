import { createMetaClient } from './meta-client.mjs';
import { PRICES, readUsage, tokenCost } from './accounting.mjs';
import { validateIntent, validateRemixSubmission } from '../remix/contract.mjs';
import { digest } from '../component/build.mjs';

export const REMIX_LIMITS = Object.freeze({ maxCostUsd:0.03, maxInputTokens:8000, maxOutputTokens:2400, timeoutMs:90_000 });
const tool = {type:'function',name:'submit_adapter_remix',strict:true,
  description:'Submit a complete adapter and explicit supported mapping for independent checks, or explain an unsupported request.',
  parameters:{type:'object',properties:{
    status:{type:'string',enum:['supported','unsupported']},
    source:{type:'string',maxLength:16_384},
    summary:{type:'string',minLength:1,maxLength:1000},
    intent:{type:'object',properties:{unitScale:{type:'number',minimum:0.125,maximum:1.5},
      activation:{type:'string',enum:['held','press']},direction:{type:'string',enum:['facing','opposite']}},
      required:['unitScale','activation','direction'],additionalProperties:false},
  },required:['status','source','summary','intent'],additionalProperties:false},
};
const instructions = `Remix the supplied PAKU PAKU motion adapter. Preserve every parent change unless the user's request replaces it.
Supported edits ONLY: unitScale from 0.125 to 1.5 (recipient dash distance = 60*unitScale), activation held or press, and direction facing or opposite.
For unsupported edits, return status unsupported, empty source, unchanged parent intent, and a clear explanation. Do not silently approximate unsupported requests.
Return the complete resulting intent and adapter source. The UI shows your interpreted intent separately from its verification.
init(motion,config) returns JSON object state. step(state,frame,motion,config) returns {state,output}.
config.motion is the frozen donor configuration; config.unitScale is supplied by the host from your intent. Never hardcode scale in the adapter.
frame = {tick,position,facing,normalDisplacement,dash}. facing is -1 or 1; dash is the raw held D button.
Initialize motion exactly once with config.motion. Call motion.step exactly once on EVERY update with config.motion and sourceBodyWidth 8.
held forwards raw dash. press forwards true ONLY on a false-to-true edge, including when held during the initial cooldown: an early press is consumed, not buffered.
Store previous raw dash in JSON state and reset it to false in init. Update it each tick, including during an active dash.
Map direction to donor left16/right32: facing uses frame.facing, opposite negates it. Map activation to donor X1.
Delegate ALL timers, dash duration, ownership, events, and displacement to the supplied motion component. Do not modify its configuration or source.
If component ownsMotion false, return frame.normalDisplacement exactly and empty sweep, regardless of direction mapping.
Otherwise return component output.displacement.x * config.unitScale. Copy ownsMotion/events exactly. Ignore y.
Sweep offsets must be ordered intermediates between 0 and displacement, excluding endpoints, with gaps no larger than 1 pixel, at most 64 points.
Keep the parent collision sweep behavior. No imports, DOM, networking, randomness, clocks, or other globals beyond ordinary JS math.
The host resets each life and records raw dash input for replays. It keeps recipient rules and performs independent verification.
Call submit_adapter_remix exactly once. Do not claim acceptance or browser verification.`;

export async function generatePakuRemix({ parent, prompt, apiKey, client, maxCostUsd = REMIX_LIMITS.maxCostUsd, onUpdate = async()=>{} } = {}) {
  validateIntent(parent.intent);
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 600) throw Error('Remix prompt must contain 1–600 characters');
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > REMIX_LIMITS.maxCostUsd) throw Error('Invalid remix cost cap');
  client ??= createMetaClient(apiKey);
  const model='muse-spark-1.3', price=PRICES[model], signal=AbortSignal.timeout(REMIX_LIMITS.timeoutMs);
  const report={schemaVersion:1,status:'preparing',model,parentArtifactId:parent.id,
    inputSha256:digest(JSON.stringify({parentId:parent.id,source:parent.source,intent:parent.intent,prompt})),
    estimatedCostUsd:0,reservedCostUsd:0,requests:[],browserVerified:false};
  try {
    const request={model,instructions,store:false,reasoning:{effort:'minimal'},parallel_tool_calls:false,
      max_output_tokens:REMIX_LIMITS.maxOutputTokens,tools:[tool],
      input:[{role:'user',content:[{type:'input_text',text:JSON.stringify({parent:{id:parent.id,intent:parent.intent,source:parent.source},prompt})}]}]};
    const tokens=await client.countInputTokens(request,signal);
    if(!Number.isSafeInteger(tokens)||tokens<0||tokens>REMIX_LIMITS.maxInputTokens)throw Error('Remix input-token cap reached before generation');
    const reservation=(tokens*price.input+REMIX_LIMITS.maxOutputTokens*price.output)/1_000_000;
    if(reservation>maxCostUsd+1e-9)throw Error('Remaining remix budget is too small; generation was not started');
    report.status='generating'; report.reservedCostUsd=reservation;
    const record={status:'pending',inputTokenCount:tokens,reservedCostUsd:reservation}; report.requests.push(record);
    await onUpdate(report); // The caller durably reserves this amount before dispatch.
    const response=await client.respond(request,signal);
    record.usage=readUsage(response.usage);record.estimatedCostUsd=tokenCost(record.usage,price);
    record.responseId=response.id;record.responseStatus=response.status;record.status='completed';
    report.estimatedCostUsd=record.estimatedCostUsd;report.reservedCostUsd=0;
    await onUpdate(report);
    if(response.status!=='completed'||report.estimatedCostUsd>maxCostUsd)throw Error('Remix response incomplete or cost cap exceeded');
    const calls=response.output?.filter(item=>item.type==='function_call');
    if(calls?.length!==1||calls[0].name!==tool.name||typeof calls[0].arguments!=='string'
      ||Buffer.byteLength(calls[0].arguments)>32_768||(calls[0].status&&calls[0].status!=='completed'))throw Error('Meta must submit one complete bounded remix');
    const submission=JSON.parse(calls[0].arguments);
    report.submission=submission;
    validateRemixSubmission(submission);
    if(Object.keys(parent.intent).every(key=>submission.intent[key]===parent.intent[key]))throw Error('The proposed mapping does not change the parent');
    report.status='submitted';return {submission,report};
  } catch(error) {
    for(const record of report.requests)if(record.status==='pending')record.status='unsettled';
    report.status='failed';report.error=String(error.message).replaceAll(apiKey || '\0','[redacted]');
    const failure=Error(report.error);failure.report=report;throw failure;
  } finally { await onUpdate(report); }
}
