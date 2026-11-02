import {randomBytes} from 'node:crypto';
import {SUBMIT_MOTION,validateMotionCandidate} from '../component/contract.mjs';
import {compileMotion,digest} from '../component/build.mjs';
import {evaluateMotion} from '../evaluator/motion.mjs';
import {DEVELOPMENT_CASES,MOTION_REGRESSIONS,acceptanceCases} from '../evaluator/cases.mjs';
import {recoveryPolicy} from './recovery-protocol.mjs';

export const COMPONENT_TOOLS=[{
  type:'function',name:'select_component_evidence',strict:true,
  description:'Select code YOU inspected and actual session evidence for motion extraction. No pre-existing recovered implementation or curated function list is supplied. The host supplies the motion ABI and human-authored finite development evaluator.',
  parameters:{type:'object',properties:{functionIndices:{type:'array',minItems:1,maxItems:8,items:{type:'integer',minimum:0,maximum:100000}},evidenceIds:{type:'array',minItems:1,maxItems:12,items:{type:'string',minLength:1,maxLength:80}},scope:{type:'string',minLength:1,maxLength:500}},required:['functionIndices','evidenceIds','scope'],additionalProperties:false},
},{type:'function',name:'submit_component_candidate',strict:true,
  description:'Submit standalone TypeScript using the selected binary/experiment evidence. Returns real development failures including first divergence for revision. Three attempts maximum. Acceptance is unavailable until a passed candidate is frozen. Export init(config) and step(state,{buttons,sourceBodyWidth},config); output ONLY {ownsMotion,displacement:{x,y},events}. State must expose integer cooldown and remaining fields named by timerFields. Use the original source pixels at fixed 60 Hz; infer defaults from observations. No imports, original binary, runtime, DOM, randomness or networking.',
  parameters:{...SUBMIT_MOTION.parameters,properties:{selectionId:{type:'string'},...SUBMIT_MOTION.parameters.properties,timerFields:{type:'object',properties:{cooldown:{type:'string',minLength:1,maxLength:40},remaining:{type:'string',minLength:1,maxLength:40}},required:['cooldown','remaining'],additionalProperties:false}},required:['selectionId','source','contract','timerFields']},
},...['freeze_component','accept_component'].map(name=>({type:'function',name,strict:true,
  description:name==='freeze_component'?'Freeze the exact source, contract and timer mapping of a development-passed candidate. No revisions are allowed after freezing. Acceptance runs only in a separate subsequent call.':'Run separately generated acceptance inputs against the already-frozen candidate. Failure is final for this investigation; no held-out failure is fed to another repair. Finite acceptance is not universal equivalence.',
  parameters:{type:'object',properties:{candidateId:{type:'string',pattern:'^[a-f0-9]{64}$'}},required:['candidateId'],additionalProperties:false},
}))];

export function createComponentWorkbench(session,{evaluate=evaluateMotion,seed=()=>randomBytes(4).readUInt32LE()}={}){
  const state=session.recovery;
  const policy=recoveryPolicy(state.protocol);
  for(const entry of state.attempts)if(entry.sourceSha256!==digest(entry.candidate.source)||entry.candidateId!==digest(JSON.stringify({candidate:entry.candidate,timerFields:entry.timerFields})))throw Error('Component development identity mismatch');
  const candidate=id=>{const value=state.attempts.find(item=>item.candidateId===id);if(!value)throw Error('Unknown component candidate');return value;};
  const frozen=()=>{if(state.frozenCandidateId)throw Error('Candidate is frozen; development and selection cannot be revised after acceptance begins');};
  return{async execute(name,args){
    if(name==='select_component_evidence'){
      frozen();if(state.selections.length>=policy.maxSelections)throw Error('Component selection limit reached');
      const snapshot=session.snapshot(),code=snapshot.staticEvidence.filter(item=>Number.isInteger(item.functionIndex));
      if(args.functionIndices.some(index=>!code.some(item=>item.functionIndex===index)))throw Error('Inspect or decompile each selected function first');
      const experiments=snapshot.staticEvidence.filter(item=>item.kind==='experiment').flatMap(item=>[item.id,item.artifactId].map(id=>[id,{...item.summary,artifactId:item.artifactId,origin:'Actual checkpoint-bound experiment; full immutable evidence is stored separately'}]));
      const known=new Map([...snapshot.observations.map(item=>[item.id,item.result]),...snapshot.comparisons.map(item=>[item.comparisonId,item]),...snapshot.annotations.map(item=>[item.id,item]),...experiments]);
      if(args.evidenceIds.some(id=>!known.has(id)))throw Error('Selection cites unknown session execution evidence');
      const evidence={schemaVersion:1,cartridgeSha256:session.identity.cartridgeSha256,scope:args.scope,
        functions:args.functionIndices.map(functionIndex=>({id:`binary:func${functionIndex}`,functionIndex,origin:'Agent-selected WABT inspection of the hash-bound binary'})),traces:args.evidenceIds.map(id=>({id,observation:known.get(id)})),
        humanAssistance:['Registered compiled donor and motion boundary','Mapped read-only motion fields; this layout is not an agent discovery','Authored the standalone motion ABI, development evaluator and acceptance generator']};
      evidence.sha256=digest(JSON.stringify(evidence));
      const selection={id:`selection-${state.selections.length+1}`,evidence};state.selections.push(selection);
      return{result:{selectionId:selection.id,evidence,interface:'init(config) -> JSON state; step(state,{buttons,sourceBodyWidth},config) -> {state,output:{ownsMotion,displacement:{x,y},events}}. config: walkingSpeed,dashDistance,cooldownTicks,initialCooldownTicks. Keep timers in state and declare their field names. Inputs use WASM-4 masks; exact dash-start/dash-end events, float32 accumulated positions, fixed 60 Hz. Defaults and rules must be inferred, not copied from another recovery.',development:'Finite human-authored rollouts compare normalized motion, cooldown, remaining and exact event timing. Development failures are available for repair. Acceptance cases remain hidden until freezing.'}};
    }
    if(name==='submit_component_candidate'){
      frozen();if(state.attempts.length>=policy.maxDevelopmentAttempts)throw Error('Component development attempt limit reached');
      const selection=state.selections.find(item=>item.id===args.selectionId);if(!selection)throw Error('Unknown component evidence selection');
      const submitted={source:args.source,contract:args.contract};validateMotionCandidate(submitted,selection.evidence);
      // Structural errors retain their source and cost in the tool journal but
      // do not consume one of the recorded behavioral evaluations.
      await compileMotion(args.source);
      const entry={attempt:state.attempts.length+1,selectionId:selection.id,candidate:submitted,timerFields:args.timerFields,sourceSha256:digest(args.source),candidateId:digest(JSON.stringify({candidate:submitted,timerFields:args.timerFields}))};state.attempts.push(entry);
      try{entry.development=await evaluate(args.source,args.contract.defaults,[...DEVELOPMENT_CASES,...MOTION_REGRESSIONS],{suite:'development',timerFields:args.timerFields});}
      catch(error){entry.development={passed:false,error:String(error.message).slice(0,1000)};}
      return{result:{candidateId:entry.candidateId,attempt:entry.attempt,sourceSha256:entry.sourceSha256,development:entry.development,canRevise:!entry.development.passed&&state.attempts.length<policy.maxDevelopmentAttempts,acceptanceRun:false}};
    }
    const entry=candidate(args.candidateId);
    if(name==='freeze_component'){
      if(state.frozenCandidateId||!entry.development.passed)throw Error('Only one development-passed candidate can be frozen');
      const compiled=await compileMotion(entry.candidate.source);
      if(compiled.sourceSha256!==entry.sourceSha256||compiled.javascriptSha256!==entry.development.javascriptSha256)throw Error('Frozen candidate does not match development build');
      state.frozenCandidateId=entry.candidateId;entry.frozenAt=new Date().toISOString();entry.javascript=compiled.javascript;
      return{result:{candidateId:entry.candidateId,status:'frozen-awaiting-acceptance',sourceSha256:entry.sourceSha256,javascriptSha256:compiled.javascriptSha256,contractSha256:digest(JSON.stringify(entry.candidate.contract)),timerFields:entry.timerFields}};
    }
    if(name==='accept_component'){
      if(state.frozenCandidateId!==entry.candidateId||state.acceptanceStarted)throw Error('Acceptance requires a frozen candidate and runs once only');
      state.acceptanceStarted=true;state.acceptanceSeed=seed();
      const compiled=await compileMotion(entry.candidate.source);
      if(compiled.sourceSha256!==entry.sourceSha256)throw Error('Frozen component source identity changed');
      try{entry.acceptance=await evaluate(entry.candidate.source,entry.candidate.contract.defaults,acceptanceCases(state.acceptanceSeed,policy.acceptanceCaseCount),{suite:'acceptance',timerFields:entry.timerFields});}
      catch(error){entry.acceptance={passed:false,error:error.message};}
      if(entry.acceptance.passed)state.acceptedAttempt=entry.attempt;
      return{result:{candidateId:entry.candidateId,passed:entry.acceptance.passed,status:entry.acceptance.passed?'accepted':'acceptance-failed',canRevise:false,scope:'Finite separately generated motion/timer/event rollouts only. Recipient-specific integration gates have not run for this new component.'}};
    }
    throw Error('Unknown component development command');
  }};
}
