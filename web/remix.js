const form=document.querySelector('#remix-form'),submit=document.querySelector('#remix-submit');
const progress=document.querySelector('#remix-progress'),budget=document.querySelector('#remix-budget');
const prompt=document.querySelector('#remix-prompt'),steps=document.querySelector('#remix-steps');
let available=false,running=false;

async function status(){
  try{
    const response=await fetch('/api/remixes/status'),state=await response.json();
    available=state.enabled&&!state.unsettled&&state.budget?.remainingUsd>=0.005;
    budget.textContent=state.budget?`Local budget: $${state.budget.remainingUsd.toFixed(3)} remaining of $${state.budget.limitUsd.toFixed(2)} · max $0.03 / request`
      :'Start npm run dev:transfer with a server API key to enable live remixes.';
    if(state.unsettled)budget.textContent+=' · paused: an earlier request has uncertain billing';
    submit.disabled=!available||running||!window.currentArtifact;
  }catch{budget.textContent='Could not read remix availability.';submit.disabled=true;}
}
function showParent(){
  const artifact=window.currentArtifact;
  if(!artifact){submit.disabled=true;return;}
  const {intent}=artifact;
  document.querySelector('#parent-mapping').textContent=`Current: ${60*intent.unitScale}px · ${intent.activation==='held'?'hold to repeat':'fresh press'} · ${intent.direction==='facing'?'forward':'backward'}`;
  document.querySelector('#remix-lineage').hidden=!artifact.parentArtifactId;
  if(artifact.parentArtifactId){
    const parent=document.querySelector('#parent-link');parent.href='/play/'+artifact.parentArtifactId;parent.hidden=false;
    document.querySelector('#remix-lineage').hidden=false;
  }
  status();
}
window.addEventListener('artifactchange',showParent);showParent();status();

for(const button of document.querySelectorAll('[data-example]'))button.addEventListener('click',()=>{prompt.value=button.dataset.example;prompt.focus();});
document.querySelector('#share-remix').addEventListener('click',async()=>{
  if(!window.currentArtifact)return;
  const url=new URL('/play/'+window.currentArtifact.id,location.origin).href;
  try{await navigator.clipboard.writeText(url);progress.textContent='Playable link copied. It works while this local server is available.';}
  catch{progress.textContent=url;}
});
let requestId;
form.addEventListener('submit',async event=>{
  event.preventDefault();if(running||!available||!window.currentArtifact)return;
  running=true;submit.disabled=true;steps.replaceChildren();
  progress.textContent='Submitting the request…';
  // Retain this ID after a transport error: retrying an identical request cannot spend twice.
  const key=JSON.stringify({parent:window.currentArtifact.id,prompt:prompt.value.trim()});
  if(requestId?.key!==key)requestId={key,id:crypto.randomUUID()};
  try{
    const response=await fetch('/api/remixes',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({parentArtifactId:window.currentArtifact.id,prompt:prompt.value,idempotencyKey:requestId.id})});
    const body=await response.json();if(!response.ok)throw Error(body.error??'Remix request failed');
    let job=body;
    while(true){
      steps.replaceChildren(...job.events.map(event=>{
        const item=document.createElement('li');item.textContent=event.status;item.className=event.status===job.status?'current':'';return item;
      }));
      progress.textContent=job.status==='generating'?'Meta is editing the adapter…'
        :job.status==='testing'?'Checking the requested behavior and playing it in an isolated browser…'
        :job.status==='publishing'?'Saving the checked game…':`Remix ${job.status}.`;
      if(job.status==='failed')throw Error(job.error??'Remix failed; the parent is unchanged');
      if(job.status==='ready'){
        progress.textContent='Remix checked and saved. Opening your game…';requestId=null;
        location.assign('/play/'+job.artifactId);return;
      }
      await new Promise(resolve=>setTimeout(resolve,750));
      const update=await fetch('/api/runs/'+job.id);
      if(!update.ok)throw Error('Could not read this run. Your request ID is retained; resubmit to reconnect.');
      job=await update.json();
    }
  }catch(error){progress.textContent=error.message;}
  finally{running=false;await status();}
});
