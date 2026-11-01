const $=selector=>document.querySelector(selector);let running=false,requestId,jobId;
async function json(path,options){const response=await fetch(path,options),body=await response.json();if(!response.ok)throw Error(body.error??'Roadster request failed');return body;}
function parent(){
  const artifact=window.currentRoadsterArtifact;if(!artifact)return;
  $('#roadster-mapping').textContent=`Current: ${60*artifact.intent.unitScale} meters · ${artifact.intent.direction==='opposite'?'backward':'forward along the stunt'} · ${artifact.intent.activation==='press'?'fresh press':'hold to repeat'} · airborne activation only`;
  $('#roadster-source').href='/api/roadster/artifacts/'+artifact.id+'/source';
  const lineage=$('#roadster-lineage');lineage.replaceChildren();
  if(artifact.parentArtifactId){const link=document.createElement('a');link.href='/roadster/play/'+artifact.parentArtifactId;link.textContent='Parent version';lineage.append(link,document.createTextNode(' → this checked transfer'));}
  else lineage.textContent='Saved initial Meta transfer. The native simulation is upstream work.';
  availability();
}
function availability(){const status=window.labStatus;$('#roadster-submit').disabled=running||!window.currentRoadsterArtifact||!status?.enabled||Boolean(status.activeRunId||status.unsettled)||status.budget?.remainingUsd<.005;$('#roadster-budget').textContent=status?.budget?`Up to $0.05 / adapter request · shared development ceiling $${status.budget.limitUsd.toFixed(2)} · $${status.budget.remainingUsd.toFixed(3)} available`:'Live adaptation is unavailable.';}
async function follow(id){
  running=true;availability();
  try{while(true){const job=await json('/api/roadster/transfers/'+id);
    $('#roadster-steps').replaceChildren(...job.events.map(event=>{const li=document.createElement('li');li.textContent=event.status;return li;}));
    $('#roadster-progress').textContent=job.status==='generating'?'Meta is writing the adapter.':job.status==='testing'?'Running independent mapping and real-browser checks.':`Transfer ${job.status}.`;
    if(job.status==='failed')throw Error(job.error);
    if(job.status==='ready'){jobId=null;try{sessionStorage.removeItem('motion-roadster-run');}catch{/* Storage is optional. */}await window.openRoadsterArtifact(job.artifactId);$('#roadster-progress').textContent='Checked and saved. Your earlier mapping changes are retained.';requestId=null;return;}
    await new Promise(resolve=>setTimeout(resolve,750));
  }}catch(error){$('#roadster-progress').textContent=error.message;}
  finally{running=false;availability();}
}
$('#roadster-form').addEventListener('submit',async event=>{
  event.preventDefault();if(running||!window.currentRoadsterArtifact)return;
  const parentArtifactId=window.currentRoadsterArtifact.id,prompt=$('#roadster-prompt').value,key=JSON.stringify({parentArtifactId,prompt});
  if(requestId?.key!==key)requestId={key,id:crypto.randomUUID()};
  try{const job=await json('/api/roadster/transfers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({parentArtifactId,prompt,idempotencyKey:requestId.id})});jobId=job.id;try{sessionStorage.setItem('motion-roadster-run',jobId);}catch{/* Server keeps the run. */}await follow(jobId);}
  catch(error){$('#roadster-progress').textContent=error.message;}
});
for(const button of document.querySelectorAll('[data-car-example]'))button.addEventListener('click',()=>{$('#roadster-prompt').value=button.dataset.carExample;$('#roadster-prompt').focus();});
window.addEventListener('artifactchange',parent);window.addEventListener('labstatus',availability);parent();
try{jobId=sessionStorage.getItem('motion-roadster-run');if(jobId){while(!window.openRoadsterArtifact)await new Promise(resolve=>setTimeout(resolve,100));follow(jobId);}}catch{/* Storage is optional. */}
