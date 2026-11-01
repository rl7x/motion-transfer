const $=selector=>document.querySelector(selector);
async function json(path,options){const response=await fetch(path,options),body=await response.json();if(!response.ok)throw Error(body.error??'Lab request failed');return body;}
let active=null,polling=false,status;
const storageKey='motion-transfer-investigation';
try{active=JSON.parse(sessionStorage.getItem(storageKey));}catch{/* Storage is optional. */}
function save(){try{if(active)sessionStorage.setItem(storageKey,JSON.stringify(active));else sessionStorage.removeItem(storageKey);}catch{/* Reports remain available server-side. */}}
function render(job){
  const report=job.report,events=$('#investigation-events');events.replaceChildren();
  for(const call of report?.toolCalls??[]){
    const item=document.createElement('li'),title=document.createElement('strong'),description=document.createElement('p');
    title.textContent=call.name==='run_original'?`${call.experimentId??'Experiment'} · ${call.ok?'observed':call.error?'failed':'running'}`:`${call.name} · ${call.ok?'inspected':call.error?'failed':'running'}`;
    description.textContent=call.args?.hypothesis??(call.name==='inspect_function'?`Function ${call.args?.functionIndex}, lines ${call.args?.startLine} onward.`:'Read-only inspection of the pinned compiled cartridge.');
    item.append(title,description);
    if(call.result||call.error){const detail=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent='Actual inputs and returned observations';pre.textContent=JSON.stringify({inputs:call.args,observations:call.result,error:call.error},null,2);detail.append(summary,pre);item.append(detail);}
    events.append(item);
  }
  $('#lab-mode').textContent=['ready','failed'].includes(job.status)?'RECORDED RUN':'FRESH META ACTIVITY';
  $('#lab-progress').textContent=job.error??(job.status==='ready'?'Investigation complete. The model’s interpretation requires review.':`Meta investigation: ${job.status}. ${report?.requests?.length??0} generation requests so far.`);
  const conclusion=$('#investigation-conclusion');conclusion.hidden=!report?.conclusion;
  if(report?.conclusion)conclusion.textContent='MODEL INTERPRETATION · NOT INDEPENDENTLY VERIFIED\n\n'+report.conclusion;
  const link=$('#investigation-report');link.hidden=false;link.href='/api/investigations/'+job.id;link.download='investigation-'+job.id+'.json';
}
async function refresh(){
  if(polling)return;polling=true;
  try{
    status=await json('/api/lab/status');
    const budget=status.budget;
    $('#lab-budget').textContent=budget?`Up to $0.50 per investigation · $${budget.spentUsd.toFixed(4)} spent / $${budget.limitUsd.toFixed(2)} development ceiling · $${budget.reservedUsd.toFixed(4)} reserved. Existing remix budget is separate.`:'Live investigation is unavailable in this server.';
    if(active){const job=await json('/api/investigations/'+active.id);render(job);if(['ready','failed'].includes(job.status)){active=null;save();}}
    $('#investigation-submit').disabled=!status.enabled||Boolean(active||status.activeRunId||status.unsettled)||budget?.remainingUsd<.005;
    window.labStatus=status;window.dispatchEvent(new Event('labstatus'));
  }catch(error){$('#lab-progress').textContent=error.message;$('#investigation-submit').disabled=true;}
  finally{polling=false;}
}
$('#investigation-form').addEventListener('submit',async event=>{
  event.preventDefault();$('#investigation-submit').disabled=true;
  const request={questionId:$('#investigation-question').value,idempotencyKey:crypto.randomUUID()};
  try{const job=await json('/api/investigations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});active={id:job.id};save();render(job);}
  catch(error){$('#lab-progress').textContent=error.message;}
  await refresh();
});
await refresh();setInterval(refresh,1000);
