const $=selector=>document.querySelector(selector);
const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
function table(labels,rows){
  const scroll=element('div',undefined,'measurement-table'),value=element('table'),head=element('tr');
  for(const label of labels)head.append(element('th',label));value.append(head);
  for(const values of rows){const row=element('tr');for(const item of values)row.append(element('td',String(item??'—')));value.append(row);}scroll.append(value);return scroll;
}
function links(ids){const node=element('p',undefined,'evidence-links');for(const id of ids){const link=element('a',id);link.href='#'+encodeURIComponent('evidence-'+id);node.append(link,document.createTextNode(' '));}return node;}
function exportButton(label,text,name,type='application/json'){
  const button=element('button',label);button.type='button';button.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([text],{type})),link=element('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});return button;
}
function details(label,value){const node=element('details');node.append(element('summary',label),element('pre',typeof value==='string'?value:JSON.stringify(value,null,2)));return node;}
function traceTable(trace){return table(['Elapsed update','Control Δx / Δy','Intervention Δx / Δy','Recharge: control / intervention','Burst left: control / intervention','Events: control / intervention'],trace.map(sample=>{
  const a=sample.control.normalized,b=sample.intervention.normalized;
  return[sample.elapsedFrame,a?`${a.dx.toFixed(2)} / ${a.dy.toFixed(2)}`:'unavailable',b?`${b.dx.toFixed(2)} / ${b.dy.toFixed(2)}`:'unavailable',`${a?.cooldown??'—'} / ${b?.cooldown??'—'}`,`${a?.remaining??'—'} / ${b?.remaining??'—'}`,`${a?.events.join(', ')||'—'} / ${b?.events.join(', ')||'—'}`];
}));}
function managedWorkbench(report,{branches,edits,comparisons}){
  const workbench=report.session.experimentWorkbench,programs=$('#investigation-programs');programs.replaceChildren();if(!workbench)return[];
  const local=report.model==='none'||report.origin==='local-verification',artifacts=workbench.artifacts??[],checkpointIds=new Set();
  for(const program of workbench.programs??[]){
    const card=element('article',undefined,'program-card');card.id='evidence-'+program.id;
    card.append(element('h3',`Experiment program · ${program.status}`),element('p',program.hypothesis),element('small',local?'Human-scripted local verification · no model request':'Model-authored program · executed locally in an isolated interpreter'));
    const source=details(`${program.language} source · ${program.sourceSha256.slice(0,12)}`,program.source);source.open=true;card.append(source);
    card.append(table(['Operation','Capability','Status','Evidence'],program.operations.map(operation=>[operation.index,operation.name,operation.status,operation.result?.experimentId??operation.result?.artifactRef?.id??operation.result?.checkpointId??operation.error??'—'])));
    if(program.error)card.append(element('p',program.error));
    card.append(element('p','Completed host operations survive interruption. The interpreter execution stack is not restored.'),details('Host operations, arguments and returned evidence',program.operations),exportButton('Download experiment program',program.source,program.id+(program.language==='typescript'?'.ts':'.js'),'text/plain'));
    const artifact=artifacts.find(item=>item.id===program.artifactId);if(artifact){const identity=element('small',artifact.id);identity.id='evidence-'+artifact.id;card.append(identity,exportButton('Export program evidence',JSON.stringify(artifact.payload),artifact.id+'.json'));}
    programs.append(card);
  }
  for(const artifact of artifacts.filter(item=>item.payload.kind==='experiment')){
    const experiment=artifact.payload;
    for(const [role,id]of Object.entries(experiment.branches)){
      const card=element('article',undefined,'branch-card managed-branch');card.id='branch-'+id;
      card.append(element('strong',role==='control'?'Unedited control':'Intervention'),element('p',id),element('small',`Host-managed replay · checkpoint update ${experiment.starting.frame}`),links([experiment.experimentId]));branches.append(card);
    }
    if(experiment.edits.length)edits.append(table(['Branch','Update','Bound address','Type','Before','After','Hypothesis'],experiment.edits.map(edit=>[experiment.branches.intervention,edit.frame,'0x'+edit.address.toString(16),edit.type,edit.previousValue,edit.newValue,edit.hypothesis])));
    const card=element('article',undefined,'comparison-card managed-comparison');card.id='evidence-'+experiment.experimentId;
    const identity=element('small',`Artifact ${artifact.id} · session ${experiment.sessionId}`);identity.id='evidence-'+artifact.id;
    card.append(element('h4',`${experiment.experimentId} · ${experiment.status}`),element('p',experiment.hypothesis),element('p',experiment.identicalStartingConditions?'Both branches restored and verified from identical starting conditions.':'Starting conditions were not verified.'),identity);
    if(!checkpointIds.has(experiment.checkpoint.id)){const checkpoint=element('p',`Replay checkpoint ${experiment.checkpoint.id}`);checkpoint.id='evidence-'+experiment.checkpoint.id;card.append(checkpoint);checkpointIds.add(experiment.checkpoint.id);}
    card.append(element('p',`Initial memory edit: checkpoint update ${experiment.initialEditDifference.frame}. This is separate from subsequent behavior.`),element('p',experiment.firstBehavioralDivergence?`First observed behavior or rendering divergence: elapsed update ${experiment.firstBehavioralDivergence.elapsedFrame}.`:'No behavior or rendering divergence observed in these inputs.'),element('p',`First timer difference: ${experiment.firstTimerDifference??'none'} · first rendering difference: ${experiment.firstRenderingDifference??'none'}.`));
    const trace=experiment.trace??[];if(trace.length){card.append(traceTable(trace.filter((_,index)=>index<3||index===trace.length-1)));const all=element('details');all.append(element('summary',`All ${trace.length} update measurements`),traceTable(trace));card.append(all);}
    card.append(details('Exact inputs, edits, memory and rendering hashes',{checkpoint:experiment.checkpoint,inputs:experiment.inputs,initialEditDifference:experiment.initialEditDifference,final:experiment.final,trace:experiment.trace}),exportButton('Download experiment evidence',JSON.stringify(experiment),artifact.id+'.json'),element('p',experiment.normalization));
    if(experiment.error)card.append(element('p',experiment.error));comparisons.append(card);
  }
  return artifacts.flatMap(item=>item.payload.captures??[]);
}
export function renderInvestigationSession(report){
  const session=report?.session,workspace=$('#investigation-workspace');workspace.hidden=!session;if(!session)return;
  $('#investigation-session-id').textContent='SESSION / '+session.id;
  const latest=report.toolCalls?.at(-1);
  const hypothesis=report.toolCalls?.findLast(call=>call.args?.hypothesis||call.args?.claim||call.args?.scope);
  $('#investigation-hypothesis').textContent=hypothesis?.args.hypothesis??hypothesis?.args.claim??hypothesis?.args.scope??'Meta is choosing its next inspection or experiment.';
  $('#investigation-action').textContent=latest?`${latest.name} · ${latest.ok?'returned evidence':latest.error?'failed': 'running'}`:'Starting an isolated investigation worker.';
  const branches=$('#investigation-branches');branches.replaceChildren();
  for(const branch of session.branches){
    const card=element('article',undefined,'branch-card');card.id='branch-'+branch.id;
    const edits=branch.actions.filter(action=>action.kind==='write');
    card.append(element('strong',branch.id),element('p',`Update ${branch.verification.frame} · ${branch.experimental?edits.length?'perturbed branch':'unchanged checkpoint branch':'original branch'}`),element('small','Memory '+branch.verification.memoryHash.slice(0,12)));
    if(branch.parentCheckpointId)card.append(links([branch.parentCheckpointId]));branches.append(card);
  }
  const edits=$('#investigation-edits');edits.replaceChildren();
  const rows=session.branches.flatMap(branch=>branch.actions.filter(action=>action.kind==='write').map(action=>[branch.id,action.frame,'0x'+action.address.toString(16),action.type,action.previousValue,action.newValue,action.hypothesis]));
  if(rows.length)edits.append(table(['Branch','Update','Address','Type','Before','After','Hypothesis'],rows));
  else if(!session.experimentWorkbench?.artifacts.some(item=>item.payload.kind==='experiment'&&item.payload.edits.length))edits.append(element('p','No experimental memory writes recorded.'));
  const comparisons=$('#investigation-comparisons');comparisons.replaceChildren();
  for(const comparison of session.comparisons??[]){
    const card=element('article',undefined,'comparison-card');card.id='evidence-'+comparison.comparisonId;
    card.append(element('h4',`${comparison.comparisonId} · ${comparison.controlBranchId} ↔ ${comparison.experimentalBranchId}`),element('p',comparison.hypothesis));
    if(comparison.normalizedTrace?.some(sample=>sample.control&&sample.experimental))card.append(table(['Update','Control Δx / Δy','Variant Δx / Δy','Recharge: control / variant','Burst left: control / variant','Events: control / variant'],comparison.normalizedTrace.filter(sample=>sample.control&&sample.experimental).map(sample=>[sample.elapsedFrame,`${sample.control.dx.toFixed(2)} / ${sample.control.dy.toFixed(2)}`,`${sample.experimental.dx.toFixed(2)} / ${sample.experimental.dy.toFixed(2)}`,`${sample.control.cooldown} / ${sample.experimental.cooldown}`,`${sample.control.remaining} / ${sample.experimental.remaining}`,`${sample.control.events.join(', ')||'—'} / ${sample.experimental.events.join(', ')||'—'}`])));
    card.append(element('p',comparison.firstBehaviorDivergence?`First measured motion/timer/event difference: update ${comparison.firstBehaviorDivergence.elapsedFrame}.`:'No measured motion/timer/event difference was recorded in the sampled comparison.'),element('small',comparison.scope));comparisons.append(card);
  }
  const managedCaptures=managedWorkbench(report,{branches,edits,comparisons});
  const findings=$('#investigation-findings');findings.replaceChildren();
  for(const status of ['supported','rejected','unresolved']){
    const group=element('section',undefined,'finding-group');group.append(element('h4',status.toUpperCase()));
    const values=[...(session.findings??[]),...(session.annotations??[])].filter(item=>item.status===status);
    if(!values.length)group.append(element('p','No interpretation recorded.'));
    for(const value of values){const item=element('article');item.id='evidence-'+value.id;item.append(element('p',value.claim??value.hypothesis),element('small',`${value.confidence} confidence · ${report.model==='none'?'human-scripted interpretation':'model interpretation'}`),links(value.evidenceIds));if(value.inferredName)item.append(element('p',`Function ${value.functionIndex}: “${value.inferredName}” · inferred name`));group.append(item);}findings.append(group);
  }
  const captures=$('#investigation-captures');captures.replaceChildren();
  for(const capture of [...new Map([...(session.captures??[]),...managedCaptures].map(capture=>[capture.evidenceId,capture])).values()]){const figure=element('figure');figure.id='evidence-'+capture.evidenceId;const image=element('img');image.src=capture.dataUrl;image.width=image.height=160;image.alt=`Actual framebuffer, branch ${capture.branchId}, update ${capture.frame}`;figure.append(image,element('figcaption',`${capture.evidenceId} · ${capture.branchId} · update ${capture.frame}`),element('small',capture.reason??capture.stage));captures.append(figure);}
  const candidates=$('#investigation-candidates');candidates.replaceChildren();
  for(const attempt of session.recovery?.attempts??[]){
    const card=element('article',undefined,'candidate-card'),accepted=session.recovery.acceptedAttempt===attempt.attempt;
    card.append(element('h4',`Candidate ${attempt.attempt} · ${accepted?'accepted for finite donor cases':attempt.acceptance?'acceptance failed':attempt.frozenAt?'frozen':attempt.development.passed?'development passed':'development failed'}`),element('p','Source '+attempt.sourceSha256.slice(0,12)));
    const first=attempt.development.results?.find(item=>item.firstDivergence);
    if(first)card.append(element('p',`First divergence: ${first.name}, update ${first.firstDivergence.tick}.`));
    if(attempt.development.error)card.append(element('p',attempt.development.error));
    const detail=element('details'),summary=element('summary','Development feedback and finite verification scope'),pre=element('pre',JSON.stringify({development:attempt.development,acceptance:attempt.acceptance,timerFields:attempt.timerFields},null,2));detail.append(summary,pre);card.append(detail);
    card.append(exportButton('Download candidate TypeScript',attempt.candidate.source,'candidate-'+attempt.candidateId.slice(0,12)+'.ts','text/plain'),exportButton('Export candidate and checks',JSON.stringify(attempt,null,2),'candidate-'+attempt.candidateId.slice(0,12)+'.json'));
    if(accepted)card.append(element('p','This candidate has not replaced the saved ability. Recipient-specific integration checks are still required.'));candidates.append(card);
  }
  if(!session.recovery?.attempts?.length)candidates.append(element('p','No new component candidate submitted. Saved demo components remain separate.'));
}
