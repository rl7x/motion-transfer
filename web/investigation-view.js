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
  edits.append(rows.length?table(['Branch','Update','Address','Type','Before','After','Hypothesis'],rows):element('p','No experimental memory writes recorded.'));
  const comparisons=$('#investigation-comparisons');comparisons.replaceChildren();
  for(const comparison of session.comparisons??[]){
    const card=element('article',undefined,'comparison-card');card.id='evidence-'+comparison.comparisonId;
    card.append(element('h4',`${comparison.comparisonId} · ${comparison.controlBranchId} ↔ ${comparison.experimentalBranchId}`),element('p',comparison.hypothesis));
    if(comparison.normalizedTrace?.some(sample=>sample.control&&sample.experimental))card.append(table(['Update','Control Δx / Δy','Variant Δx / Δy','Recharge: control / variant','Burst left: control / variant','Events: control / variant'],comparison.normalizedTrace.filter(sample=>sample.control&&sample.experimental).map(sample=>[sample.elapsedFrame,`${sample.control.dx.toFixed(2)} / ${sample.control.dy.toFixed(2)}`,`${sample.experimental.dx.toFixed(2)} / ${sample.experimental.dy.toFixed(2)}`,`${sample.control.cooldown} / ${sample.experimental.cooldown}`,`${sample.control.remaining} / ${sample.experimental.remaining}`,`${sample.control.events.join(', ')||'—'} / ${sample.experimental.events.join(', ')||'—'}`])));
    card.append(element('p',comparison.firstBehaviorDivergence?`First measured motion/timer/event difference: update ${comparison.firstBehaviorDivergence.elapsedFrame}.`:'No measured motion/timer/event difference was recorded in the sampled comparison.'),element('small',comparison.scope));comparisons.append(card);
  }
  const findings=$('#investigation-findings');findings.replaceChildren();
  for(const status of ['supported','rejected','unresolved']){
    const group=element('section',undefined,'finding-group');group.append(element('h4',status.toUpperCase()));
    const values=[...(session.findings??[]),...(session.annotations??[])].filter(item=>item.status===status);
    if(!values.length)group.append(element('p','No interpretation recorded.'));
    for(const value of values){const item=element('article');item.id='evidence-'+value.id;item.append(element('p',value.claim??value.hypothesis),element('small',`${value.confidence} confidence · model interpretation`),links(value.evidenceIds));if(value.inferredName)item.append(element('p',`Function ${value.functionIndex}: “${value.inferredName}” · inferred name`));group.append(item);}findings.append(group);
  }
  const captures=$('#investigation-captures');captures.replaceChildren();
  for(const capture of session.captures??[]){const figure=element('figure');figure.id='evidence-'+capture.evidenceId;const image=element('img');image.src=capture.dataUrl;image.width=image.height=160;image.alt=`Actual framebuffer, branch ${capture.branchId}, update ${capture.frame}`;figure.append(image,element('figcaption',`${capture.evidenceId} · ${capture.branchId} · update ${capture.frame}`),element('small',capture.reason));captures.append(figure);}
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
