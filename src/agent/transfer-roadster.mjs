import { createMetaClient } from './meta-client.mjs';
import { PRICES,readUsage,tokenCost } from './accounting.mjs';
import { assertRoadsterInputTokens, readRoadsterSubmission, ROADSTER_TOOL, roadsterEvidence, roadsterProviderRequest } from './roadster-request.mjs';
import { resolveComponentRef, componentIdentity } from '../component/reference.mjs';
import { readFile } from 'node:fs/promises';
import { loadRoadster } from '../recipients/roadster/load.mjs';
import { compileAdapter } from '../transfer/adapter.mjs';
import { evaluateRoadsterAdapter } from '../evaluator/roadster.mjs';
import { verifyRoadsterBrowser } from '../evaluator/roadster-browser.mjs';
import { buildRoadsterFrame } from '../roadster/build.mjs';
import { validateRoadsterIntent } from '../roadster/port.mjs';

export async function generateRoadsterTransfer({apiKey,client,parent,prompt,maxCostUsd=.05,onUpdate=async()=>{},onStage=async()=>{},verifyBrowser=verifyRoadsterBrowser,componentRef=parent?.component}={}){
  if(!Number.isFinite(maxCostUsd)||maxCostUsd<=0||maxCostUsd>.05)throw Error('Invalid Roadster generation budget');
  const model='muse-spark-1.3',price=PRICES[model],signal=AbortSignal.timeout(180000);
  client??=createMetaClient(apiKey,{requestTimeoutMs:60000});
  const report={schemaVersion:1,status:'preparing',model,parentArtifactId:parent.id,startedAt:new Date().toISOString(),estimatedCostUsd:0,reservedCostUsd:0,requests:[],humanAssistance:['Selected recipient and motion boundary','Authored 60/240Hz clock, airborne/collision policies and integration hooks','Authored independent conformance and browser gates']};
  try{
    await onUpdate(report);
    const component=await resolveComponentRef(componentRef),recipient=await loadRoadster();
    if(parent.componentId&&parent.componentId!==component.provenance.id)throw Error('Roadster parent and selected component identities differ');
    report.componentId=component.provenance.id;report.recipientRevision=recipient.manifest.revision;
    report.componentRef=componentIdentity(component);
    const evidence=roadsterEvidence({prompt,parentIntent:parent.intent,parentSource:parent.files?.['adapter.ts']??'',component,recipient:{name:recipient.manifest.name,revision:recipient.manifest.revision}});
    const request=roadsterProviderRequest({model,evidence});
    const inputTokens=assertRoadsterInputTokens(await client.countInputTokens(request,signal));
    const reservation=(inputTokens*price.input+3000*price.output)/1e6;
    if(reservation>maxCostUsd)throw Error('Roadster budget cannot cover this request; no generation started');
    report.reservedCostUsd=reservation;report.status='generating';const record={status:'pending',inputTokenCount:inputTokens,reservedCostUsd:reservation};report.requests.push(record);await onUpdate(report);
    const response=await client.respond(request,signal);record.usage=readUsage(response.usage);record.estimatedCostUsd=tokenCost(record.usage,price);record.responseId=response.id;record.status='completed';record.responseStatus=response.status;
    report.estimatedCostUsd=record.estimatedCostUsd;report.reservedCostUsd=0;await onUpdate(report);
    if(response.status!=='completed'||report.estimatedCostUsd>maxCostUsd)throw Error('Roadster response incomplete or budget exceeded');
    const calls=response.output?.filter(item=>item.type==='function_call');
    if(calls?.length!==1||calls[0].name!==ROADSTER_TOOL.name)throw Error('Meta did not submit a supported complete Roadster adapter');
    const submission=readRoadsterSubmission(calls[0].arguments,parent.intent,{parentSource:parent.files?.['adapter.ts']??''});
    report.submission=submission;
    if((submission.status??'supported')==='unsupported'){
      const error=Error('Unsupported request: '+submission.summary);error.code='UNSUPPORTED_REQUEST';throw error;
    }
    return await verifyRoadsterSubmission({report,parent,recipient,onStage,onUpdate,verifyBrowser,componentRef:component});
  }catch(error){for(const record of report.requests)if(record.status==='pending')record.status='unsettled';report.status=error.code==='UNSUPPORTED_REQUEST'?'unsupported':'failed';report.error=error.message;error.report=report;throw error;}
  finally{report.finishedAt??=new Date().toISOString();await onUpdate(report);}
}

// Local re-verification reuses recorded, settled Meta source without another request.
export async function verifyRoadsterSubmission({report,parent,recipient,onStage=async()=>{},onUpdate=async()=>{},verifyBrowser=verifyRoadsterBrowser,componentRef=parent?.component}){
  const {submission}=report;validateRoadsterIntent(submission.intent);recipient??=await loadRoadster();
  const component=await resolveComponentRef(componentRef);
  if(report.reservedCostUsd!==0||!report.requests?.length||!report.requests.every(request=>request.status==='completed'&&request.usage)||report.recipientRevision!==recipient.manifest.revision||report.componentId!==component.provenance.id||parent.componentId&&parent.componentId!==component.provenance.id)throw Error('Only settled matching Meta submissions can be verified');
  await onStage('building');const compiled=await compileAdapter(submission.source,{componentRef:component});
  await onStage('testing');const conformance=await evaluateRoadsterAdapter(submission.source,submission.intent,{componentRef:component});
  report.conformance=conformance;await onUpdate(report);if(!conformance.passed)throw Error('Roadster mapping checks failed; parent unchanged');
  const browser=await verifyBrowser(submission.source,submission.intent,{componentRef:component});report.browser=browser;await onUpdate(report);
  if(!browser.passed)throw Error('Roadster browser checks failed; parent unchanged');
  if(browser.componentId&&browser.componentId!==component.provenance.id)throw Error('Roadster browser verified a different component');
  const frame=await buildRoadsterFrame({source:submission.source,intent:submission.intent,componentRef:component});
  if(compiled.componentId!==frame.componentId||conformance.componentId!==frame.componentId)throw Error('Roadster component identity changed across verification');
  report.status='verified';report.finishedAt=new Date().toISOString();await onUpdate(report);
  const verification={passed:true,scope:'Finite adapter and recipient checks, frozen donor defaults; declared collision/free-flight fixtures',conformance,browser};
  const donorNotice=await readFile(new URL('../../assets/targets/dashy-dango/NOTICE.txt',import.meta.url),'utf8');
  return{files:{'adapter.ts':submission.source,'adapter.js':compiled.javascript,'frame.html':frame.html,'verification.json':JSON.stringify(verification,null,2)+'\n','generation.json':JSON.stringify(report,null,2)+'\n','notices.txt':donorNotice+'\n\n'+recipient.notices},metadata:{kind:'roadster',parentArtifactId:parent.files?.['adapter.ts']?parent.id:null,componentId:frame.componentId,componentRef:componentIdentity(component),component,recipientRevision:recipient.manifest.revision,intent:submission.intent,summary:submission.summary,environment:frame.environment}};
}
