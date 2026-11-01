const $=selector=>document.querySelector(selector);
async function json(path,options){const response=await fetch(path,options),body=await response.json();if(!response.ok)throw Error(body.error??'Lab request failed');return body;}
let active=null,polling=false,submitting=false,status;
const storageKey='motion-transfer-investigation';
try{active=JSON.parse(sessionStorage.getItem(storageKey));}catch{/* Storage is optional. */}
if(active?.request)$('#investigation-question').value=active.request.questionId;
function save(){try{if(active)sessionStorage.setItem(storageKey,JSON.stringify(active));else sessionStorage.removeItem(storageKey);}catch{/* Reports remain available server-side. */}}
function render(job,reportPath='/api/investigations/'+job.id){
  const report=job.report,events=$('#investigation-events');events.replaceChildren();
  for(const call of report?.toolCalls??[]){
    const item=document.createElement('li'),title=document.createElement('strong'),description=document.createElement('p');
    title.textContent=call.name==='run_original'?`${call.experimentId??'Experiment'} · ${call.ok?'observed':call.error?'failed':'running'}`:`${call.name} · ${call.ok?'inspected':call.error?'failed':'running'}`;
    description.textContent=call.args?.hypothesis??(call.name==='inspect_function'?`Function ${call.args?.functionIndex}, lines ${call.args?.startLine} onward.`:'Read-only inspection of the pinned compiled cartridge.');
    item.append(title,description);
    const measurements=call.result?.checkpoints?.filter(point=>point.motion);
    if(measurements?.length){
      const scroll=document.createElement('div');scroll.className='measurement-table';
      const table=document.createElement('table'),head=document.createElement('tr');
      for(const label of ['Checkpoint','Update','World x','World y','Burst left','Recharge']){const cell=document.createElement('th');cell.textContent=label;head.append(cell);}table.append(head);
      for(const point of measurements){const row=document.createElement('tr');for(const value of [point.checkpoint,point.frame,point.motion.position.x.toFixed(2),point.motion.position.y.toFixed(2),point.motion.remaining,point.motion.cooldown]){const cell=document.createElement('td');cell.textContent=String(value);row.append(cell);}table.append(row);}
      scroll.append(table);item.append(scroll);
    }
    if(call.result||call.error){const detail=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent='Actual inputs and returned observations';pre.textContent=JSON.stringify({inputs:call.args,observations:call.result,error:call.error},null,2);detail.append(summary,pre);item.append(detail);}
    events.append(item);
  }
  $('#lab-mode').textContent=['ready','failed'].includes(job.status)?'RECORDED RUN':'FRESH META ACTIVITY';
  const elapsed=report?.finishedAt&&report?.startedAt?` · ${((Date.parse(report.finishedAt)-Date.parse(report.startedAt))/1000).toFixed(1)}s recorded elapsed`:'';
  const cost=`${report?.requests?.length??0} generation requests · $${(report?.estimatedCostUsd??0).toFixed(4)} estimated${elapsed}`;
  $('#lab-progress').textContent=job.error??(job.status==='ready'?`Investigation complete · ${cost}. The model’s interpretation requires review.`:`Meta investigation: ${job.status} · ${cost}.`);
  const conclusion=$('#investigation-conclusion');conclusion.hidden=!report?.conclusion;
  if(report?.conclusion)conclusion.textContent='MODEL INTERPRETATION · NOT INDEPENDENTLY VERIFIED\n\n'+report.conclusion;
  const link=$('#investigation-report');link.hidden=false;link.href=reportPath;link.download='investigation-'+job.id+'.json';
}
async function refresh(){
  if(polling)return;polling=true;
  try{
    status=await json('/api/lab/status');
    const budget=status.budget;
    $('#lab-budget').textContent=budget?`Up to $0.50 per investigation · $${budget.spentUsd.toFixed(4)} spent / $${budget.limitUsd.toFixed(2)} development ceiling · $${budget.reservedUsd.toFixed(4)} reserved. Existing remix budget is separate.`:'Live investigation is unavailable in this server.';
    if(active?.id){const job=await json('/api/investigations/'+active.id);render(job);if(['ready','failed'].includes(job.status)){active=null;save();}}
    const reconnect=Boolean(active?.request&&!active.id);
    $('#investigation-submit').textContent=reconnect?'Reconnect to investigation ↗':'Investigate with Meta ↗';
    $('#investigation-submit').disabled=submitting||(!reconnect&&(!status.enabled||Boolean(active||status.activeRunId||status.unsettled)||budget?.remainingUsd<.005));
    $('#view-investigation').disabled=Boolean(active||submitting);
    window.labStatus=status;window.dispatchEvent(new Event('labstatus'));
  }catch(error){$('#lab-progress').textContent=error.message;$('#investigation-submit').disabled=true;}
  finally{polling=false;}
}
$('#investigation-form').addEventListener('submit',async event=>{
  event.preventDefault();if(submitting||active?.id)return;submitting=true;$('#investigation-submit').disabled=true;
  const request=active?.request??{questionId:$('#investigation-question').value,idempotencyKey:crypto.randomUUID()};
  active={request};save();
  try{const job=await json('/api/investigations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});active={request,id:job.id};save();render(job);}
  catch(error){$('#lab-progress').textContent=error.message;}
  finally{submitting=false;await refresh();}
});
$('#view-investigation').addEventListener('click',async()=>{
  if(active||submitting)return;
  const path='/api/investigations/saved/neutral-after-left';
  try{render(await json(path),path);$('#lab-progress').textContent+=' Viewing saved evidence; no new model request.';}
  catch(error){$('#lab-progress').textContent=error.message;}
});
await refresh();setInterval(refresh,1000);
