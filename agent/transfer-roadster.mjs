import { createMetaClient } from './meta-client.mjs';
import { PRICES,readUsage,tokenCost } from './accounting.mjs';
import { loadRecoveredMotion } from '../component/load.mjs';
import { loadRoadster } from '../recipients/roadster/load.mjs';
import { compileAdapter } from '../transfer/adapter.mjs';
import { evaluateRoadsterAdapter } from '../evaluator/roadster.mjs';
import { verifyRoadsterBrowser } from '../evaluator/roadster-browser.mjs';
import { buildRoadsterFrame } from '../roadster/build.mjs';
import { validateRoadsterIntent } from '../roadster/port.mjs';

const tool={type:'function',name:'submit_roadster_adapter',strict:true,description:'Submit the adapter and complete inherited mapping. The host independently compiles and verifies it.',parameters:{type:'object',properties:{source:{type:'string',maxLength:16384},summary:{type:'string',maxLength:1000},intent:{type:'object',properties:{unitScale:{type:'number',minimum:.025,maximum:.2},activation:{type:'string',enum:['held','press']},direction:{type:'string',enum:['facing','opposite']}},required:['unitScale','activation','direction'],additionalProperties:false}},required:['source','summary','intent'],additionalProperties:false}};
const instructions=`Adapt the supplied frozen recovered controller to the RDSTR Stunts recipient through a HUMAN-AUTHORED host port.
Change only the adapter. No imports, DOM, clocks, randomness, files or networking. Return TypeScript using submit_roadster_adapter once.
Retain the complete parent mapping except the changes requested. Support only distance (unitScale 0.025..0.2 meters/source pixel), held/fresh-press activation, and forward/backward direction. Explain unsupported requests without a tool call. Never invent or change recipient physics.
Export init(motion,config), returning {core:motion.init(config.motion), ...your JSON edge state}.
Export step(state,frame,motion,config), returning {state:{core:next.state,...},output:{displacement:number,ownsMotion:boolean,events:string[],sweep:number[]}}.
config is {motion: frozen defaults,unitScale: requested intent.unitScale}. Use these exact motion defaults, do not reconstruct timers or copy movement formulas.
frame is {tick,position,facing,normalDisplacement,dash,airborne}. facing is -1 or 1 (the real car host uses +1, world +X along the stunt). dash is raw held X. The host has separate native controls for thrust/rotation.
Initialize motion once. Call motion.step(state.core,{buttons,sourceBodyWidth:8},config.motion) EXACTLY ONCE EVERY update, including grounded/inactive ticks.
Map direction to donor left=16/right=32. Opposite means negate frame.facing. Map raw dash to donor X=1 ONLY if airborne. Held uses held raw input; press uses raw false-to-true edges, consumed even on the ground or in cooldown. Track the previous RAW dash every update. Source timers/direction must remain inside the frozen core.
If next.output.ownsMotion, output displacement=next.output.displacement.x*config.unitScale; otherwise frame.normalDisplacement EXACTLY. Copy ownsMotion and events exactly, even if an existing dash outlasts landing. The host applies transferred movement only in flight.
sweep is [] if inactive, otherwise ordered intermediate offsets excluding 0 and displacement, gaps at most 1 meter (including to endpoints). The host further substeps collisions at 0.02m.
The host advances the core at 60Hz and applies each active horizontal displacement across four 240Hz native steps. Gravity, vertical motion, spin, fuel and collisions remain native. Do not implement a dash duration or cooldown. Do not report your own verification.`;

export async function generateRoadsterTransfer({apiKey,client,parent,prompt,maxCostUsd=.05,onUpdate=async()=>{},onStage=async()=>{},verifyBrowser=verifyRoadsterBrowser}={}){
  if(!Number.isFinite(maxCostUsd)||maxCostUsd<=0||maxCostUsd>.05)throw Error('Invalid Roadster generation budget');
  const model='muse-spark-1.3',price=PRICES[model],signal=AbortSignal.timeout(180000);
  client??=createMetaClient(apiKey,{requestTimeoutMs:60000});
  const report={schemaVersion:1,status:'preparing',model,parentArtifactId:parent.id,startedAt:new Date().toISOString(),estimatedCostUsd:0,reservedCostUsd:0,requests:[],humanAssistance:['Selected recipient and motion boundary','Authored 60/240Hz clock, airborne/collision policies and integration hooks','Authored independent conformance and browser gates']};
  try{
    await onUpdate(report);
    const component=await loadRecoveredMotion(),recipient=await loadRoadster();
    report.componentId=component.provenance.id;report.recipientRevision=recipient.manifest.revision;
    const evidence={request:prompt,parentIntent:parent.intent,parentSource:parent.files?.['adapter.ts']??'',component:{javascript:component.javascript,contract:component.contract},recipient:{name:recipient.manifest.name,revision:recipient.manifest.revision,policy:'World X along jump path; Y vertical; native 240Hz. Airborne-only activation; preserve vertical/rotation/fuel. 60 source pixels become 6m at scale .1.'}};
    const request={model,instructions,input:[{role:'user',content:[{type:'input_text',text:JSON.stringify(evidence)}]}],tools:[tool],store:false,reasoning:{effort:'minimal'},max_output_tokens:3000,parallel_tool_calls:false};
    const inputTokens=await client.countInputTokens(request,signal);
    if(!Number.isSafeInteger(inputTokens)||inputTokens<0||inputTokens>12000)throw Error('Roadster input-token limit exceeded');
    const reservation=(inputTokens*price.input+3000*price.output)/1e6;
    if(reservation>maxCostUsd)throw Error('Roadster budget cannot cover this request; no generation started');
    report.reservedCostUsd=reservation;report.status='generating';const record={status:'pending',inputTokenCount:inputTokens,reservedCostUsd:reservation};report.requests.push(record);await onUpdate(report);
    const response=await client.respond(request,signal);record.usage=readUsage(response.usage);record.estimatedCostUsd=tokenCost(record.usage,price);record.responseId=response.id;record.status='completed';record.responseStatus=response.status;
    report.estimatedCostUsd=record.estimatedCostUsd;report.reservedCostUsd=0;await onUpdate(report);
    if(response.status!=='completed'||report.estimatedCostUsd>maxCostUsd)throw Error('Roadster response incomplete or budget exceeded');
    const calls=response.output?.filter(item=>item.type==='function_call');
    if(calls?.length!==1||calls[0].name!==tool.name||typeof calls[0].arguments!=='string'||Buffer.byteLength(calls[0].arguments)>24000)throw Error('Meta did not submit a supported complete Roadster adapter');
    const submission=JSON.parse(calls[0].arguments);validateRoadsterIntent(submission.intent);
    if(Object.keys(submission).sort().join(',')!=='intent,source,summary'||typeof submission.source!=='string'||Buffer.byteLength(submission.source)>16384||!submission.source.trim()||typeof submission.summary!=='string'||submission.summary.length>1000)throw Error('Invalid Roadster submission');
    report.submission=submission;
    await onStage('building');const compiled=await compileAdapter(submission.source);
    await onStage('testing');const conformance=await evaluateRoadsterAdapter(submission.source,submission.intent);
    report.conformance=conformance;await onUpdate(report);if(!conformance.passed)throw Error('Roadster mapping checks failed; parent unchanged');
    const browser=await verifyBrowser(submission.source,submission.intent);report.browser=browser;await onUpdate(report);
    if(!browser.passed)throw Error('Roadster browser checks failed; parent unchanged');
    const frame=await buildRoadsterFrame({source:submission.source,intent:submission.intent});
    report.status='verified';report.finishedAt=new Date().toISOString();await onUpdate(report);
    const verification={passed:true,scope:'Finite adapter and recipient checks, frozen donor defaults; declared collision/free-flight fixtures',conformance,browser};
    return{files:{'adapter.ts':submission.source,'adapter.js':compiled.javascript,'frame.html':frame.html,'verification.json':JSON.stringify(verification,null,2)+'\n','generation.json':JSON.stringify(report,null,2)+'\n','notices.txt':recipient.notices},metadata:{kind:'roadster',parentArtifactId:parent.files?.['adapter.ts']?parent.id:null,componentId:frame.componentId,recipientRevision:recipient.manifest.revision,intent:submission.intent,summary:submission.summary,environment:frame.environment}};
  }catch(error){for(const record of report.requests)if(record.status==='pending')record.status='unsettled';report.status='failed';report.error=error.message;error.report=report;throw error;}
  finally{report.finishedAt??=new Date().toISOString();await onUpdate(report);}
}
