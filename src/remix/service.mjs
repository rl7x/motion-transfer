import { randomUUID } from 'node:crypto';
import { loadPakuTransfer, loadCompatiblePakuVersion } from '../transfer/saved-paku.mjs';
import { loadPakuPaku } from '../recipients/paku-paku/load.mjs';
import { compileAdapter } from '../transfer/adapter.mjs';
import { evaluatePakuRemix } from '../evaluator/paku-remix.mjs';
import { verifyRemixBrowser } from '../evaluator/remix-browser.mjs';
import { generatePakuRemix, REMIX_LIMITS } from '../agent/remix-paku.mjs';
import { buildRemixFrame } from './frame.mjs';
import { BASE_REMIX_INTENT, validateRemixRequest } from './contract.mjs';
import { createRemixStore } from './store.mjs';

export const LOCAL_REMIX_BUDGET_USD = 0.10;
const terminal = status=>['ready','failed'].includes(status);
const publicJob = job=>({id:job.id,status:job.status,parentArtifactId:job.request.parentArtifactId,
  events:job.events,artifactId:job.artifactId??null,error:job.error??null,
  estimatedCostUsd:job.generation?.estimatedCostUsd??0,reservedCostUsd:job.generation?.reservedCostUsd??0});

export async function createRemixService({directory,apiKey,client,generate=generatePakuRemix,
  verifyBrowser=verifyRemixBrowser,budgetUsd=LOCAL_REMIX_BUDGET_USD}={}) {
  if(!Number.isFinite(budgetUsd)||budgetUsd<=0||budgetUsd>LOCAL_REMIX_BUDGET_USD)throw Error('Invalid local remix budget');
  const saved=await loadPakuTransfer(),recipient=await loadPakuPaku();
  const makeBase=version=>({id:version.receipt.id,baseTransferId:version.receipt.id,componentId:version.componentId,
    recipientId:'paku-paku',recipientRevision:recipient.manifest.revision,source:version.source,javascript:version.javascript,
    intent:BASE_REMIX_INTENT,summary:'Recovered dash transferred to PAKU PAKU',
    evaluation:{conformance:version.conformance,browser:version.browser},generation:version.generation,
    notices:recipient.licenses.join('\n\n----------------\n\n')});
  const base=makeBase(saved),roots=new Map([[base.id,base]]);
  async function root(id){
    if(!roots.has(id))roots.set(id,makeBase(await loadCompatiblePakuVersion(id,saved)));
    return roots.get(id);
  }
  const store=await createRemixStore(directory);
  let active=null,admitting=false,closed=false;
  const jobs=new Map();
  const scrub=message=>String(message).replaceAll(apiKey||'\0','[redacted]').slice(0,1200);
  const transition=async(job,status)=>{
    job.status=status;job.events.push({sequence:job.events.length+1,status,at:new Date().toISOString()});
    await store.writeJob(job);
  };
  try{
    for(const job of await store.jobs()){
      if(!job.request||!job.id||!Array.isArray(job.events)||!Number.isFinite(job.generation?.estimatedCostUsd??0)
        ||!Number.isFinite(job.generation?.reservedCostUsd??0)||(job.generation?.estimatedCostUsd??0)<0
        ||(job.generation?.reservedCostUsd??0)<0)throw Error('Remix accounting journal is invalid');
      if(!terminal(job.status)){
        job.error='Server restarted before completion. Parent unchanged; any unsettled request reservation is retained.';
        await transition(job,'failed');
      }
      jobs.set(job.id,job);
    }
  }catch(error){await store.close();throw error;}
  const budget=()=>{
    let spent=0,reserved=0;
    for(const job of jobs.values()){spent+=job.generation?.estimatedCostUsd??0;reserved+=job.generation?.reservedCostUsd??0;}
    return{limitUsd:budgetUsd,spentUsd:spent,reservedUsd:reserved,remainingUsd:Math.max(0,budgetUsd-spent-reserved)};
  };
  const parent=async id=>{
    if(roots.has(id))return roots.get(id);
    let artifact;
    try{artifact=await store.readArtifact(id);}
    catch(error){if(error.code==='ENOENT')return root(id);throw error;}
    await root(artifact.baseTransferId);
    if(artifact.componentId!==base.componentId||artifact.recipientRevision!==base.recipientRevision)throw Error('This parent belongs to a different verified transfer');
    return artifact;
  };
  const run=async(job,selected)=>{
    try{
      await transition(job,'generating');
      const result=await generate({parent:selected,prompt:job.request.prompt,apiKey,client,
        maxCostUsd:Math.min(REMIX_LIMITS.maxCostUsd,budget().remainingUsd),
        onUpdate:async report=>{
          const previous=job.generation;
          job.generation=structuredClone(report);
          if(budget().spentUsd+budget().reservedUsd>budgetUsd+1e-9){job.generation=previous;throw Error('Persistent remix budget would be exceeded');}
          await store.writeJob(job);
        },
      });
      job.generation=result.report;
      await transition(job,'building');
      const {source,intent,summary}=result.submission;
      const compiled=await compileAdapter(source),html=await buildRemixFrame(compiled,intent);
      await transition(job,'testing');
      const conformance=await evaluatePakuRemix(source,intent);
      if(!conformance.passed)throw Error('The adapter failed the requested-mapping checks; parent unchanged');
      const browser=await verifyBrowser(compiled,intent,html);
      if(!browser.passed)throw Error('The adapter failed playable browser checks; parent unchanged');
      await transition(job,'publishing');
      const artifact=await store.publish({parent:selected,intent,summary,source,compiled,html,conformance,browser,
        generation:job.generation,notices:recipient.licenses.join('\n\n----------------\n\n')});
      job.artifactId=artifact.id;await transition(job,'ready');
    }catch(error){
      if(error.report)job.generation=error.report;
      job.error=scrub(error.message);await transition(job,'failed');
    }finally{active=null;}
  };
  return {
    status(){return{enabled:Boolean(apiKey||client),activeRunId:active?.id??null,budget:budget(),baseArtifactId:base.id,
      unsettled:[...jobs.values()].some(job=>(job.generation?.reservedCostUsd??0)>0)};},
    async artifact(id){return parent(id);},
    async run(id){const job=jobs.get(id);if(!job)throw Error('Run not found');return publicJob(job);},
    async submit(value){
      if(closed)throw Error('Remix service is closed');
      const request=validateRemixRequest(value);
      const existing=[...jobs.values()].find(job=>job.request.idempotencyKey===request.idempotencyKey);
      if(existing){
        if(JSON.stringify(existing.request)!==JSON.stringify(request))throw Error('Request ID is already used for a different remix');
        return publicJob(existing);
      }
      if(admitting||active)throw Error('A remix is already running. Wait for it to finish.');
      if(!apiKey&&!client)throw Error('Live remixes need MODEL_API_KEY in the server .env');
      if(this.status().unsettled)throw Error('A previous request has uncertain billing. No further model requests will start.');
      if(budget().remainingUsd<0.005)throw Error('The local remix budget is exhausted');
      admitting=true;
      try{
        const selected=await parent(request.parentArtifactId);
        const job={schemaVersion:1,id:randomUUID(),request,status:'queued',events:[],generation:null};
        await transition(job,'queued');jobs.set(job.id,job);
        active={id:job.id,promise:null};active.promise=run(job,selected);
        // A failed disk write is surfaced, without an unhandled background rejection.
        active.promise.catch(()=>{});
        return publicJob(job);
      }finally{admitting=false;}
    },
    async close(){closed=true;const pending=active?.promise;if(pending)await pending;await store.close();},
  };
}
