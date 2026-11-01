const $=selector=>document.querySelector(selector);
const before=$('#original-game'),after=$('#transfer-game'),donor=$('#donor-game');
let catalog,ability,destination,pakuSelection,channel,childState,version=0,loadingSince=0;
const donorChannel=crypto.randomUUID();
donor.src='/donor/play#channel='+donorChannel;
for(const button of document.querySelectorAll('[data-donor]'))button.disabled=true;

function bindHold(button,change){
  button.addEventListener('pointerdown',event=>{button.setPointerCapture(event.pointerId);change(true);});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,()=>change(false));
  button.addEventListener('keydown',event=>{if(['Space','Enter'].includes(event.code)){event.preventDefault();if(!event.repeat)change(true);}});
  button.addEventListener('keyup',event=>{if(['Space','Enter'].includes(event.code)){event.preventDefault();change(false);}});
  button.addEventListener('blur',()=>change(false));
}
function send(frame,type,pressed){
  if(frame===after&&channel){frame.contentWindow?.postMessage({type,pressed,channel},'*');return;}
  const win=frame.contentWindow;
  if(!win||!(win.pakuReady||win.jujumpReady))return;
  const code=type==='dash'?'KeyD':'Space';
  frame.contentDocument.dispatchEvent(new win.KeyboardEvent(pressed?'keydown':'keyup',{code,key:code==='Space'?' ':'d',bubbles:true,cancelable:true}));
}
for(const button of document.querySelectorAll('[data-turn]'))bindHold(button,pressed=>send(document.getElementById(button.dataset.turn),'turn',pressed));
const dashButton=$('[data-dash]');
bindHold(dashButton,pressed=>{send(after,'dash',pressed);dashButton.classList.toggle('pressed',pressed);});
for(const button of document.querySelectorAll('[data-donor]'))bindHold(button,pressed=>{
  donor.contentWindow?.postMessage({type:'donor-control',button:button.dataset.donor,pressed,channel:donorChannel},'*');
});
for(const button of document.querySelectorAll('[data-reset]'))button.addEventListener('click',()=>{
  const frame=document.getElementById(button.dataset.reset);
  if(frame===after){send(after,'dash',false);childState=null;}
  if(frame.getAttribute('src'))frame.src=frame.getAttribute('src');
});
window.addEventListener('blur',()=>{send(after,'dash',false);dashButton.classList.remove('pressed');});
window.addEventListener('message',event=>{
  if(event.source===donor.contentWindow&&event.data?.channel===donorChannel&&event.data.type==='donor-status'){
    for(const button of document.querySelectorAll('[data-donor]'))button.disabled=false;
    const state=event.data.state;
    $('#donor-state').textContent=state.status==='playing'
      ? state.remaining>0?'ORIGINAL DASH ACTIVE':state.cooldown>0?'ORIGINAL DASH RECHARGING':'ORIGINAL DASH READY'
      :'Use X or Start / dash to enter the compiled game.';
  }
  if(channel&&event.source===after.contentWindow&&event.data?.channel===channel&&event.data.type==='motion-status')childState=event.data;
});

async function json(path){const response=await fetch(path);const body=await response.json();if(!response.ok)throw Error(body.error??'Could not load saved result');return body;}
function renderChoices(){
  const buttons=catalog.destinations.map(item=>{
    const button=document.createElement('button');button.className='destination';button.dataset.destination=item.id;
    button.setAttribute('aria-pressed',String(destination?.id===item.id));
    const kind=document.createElement('span');kind.className='eyebrow';kind.textContent=item.kind;
    const name=document.createElement('strong');name.textContent=item.name;
    const action=document.createElement('span');action.className='destination-action';action.textContent='Give it the dash →';
    const saved=document.createElement('small');saved.textContent=item.liveEdits.length?'Saved transfer · live remix supported':'Saved transfer · gravity and landing';
    button.append(kind,name,action,saved);button.addEventListener('click',()=>select(item,true));return button;
  });
  $('#destinations').replaceChildren(...buttons);
}
function select(item,navigate=false){
  version++;loadingSince=Date.now();destination=item;channel=null;childState=null;
  const selected=item.id==='paku-paku'?pakuSelection:null;
  const child=Boolean(selected?.parentArtifactId);
  window.currentDestination=item.id;window.currentArtifact=selected;
  renderChoices();
  for(const button of document.querySelectorAll('[data-turn],[data-transfer-control]'))button.disabled=true;
  $('#transfer-status').textContent='LOADING';$('#transfer-placeholder').hidden=false;after.hidden=true;
  $('#recipient-title').textContent=item.name;$('#hybrid-title').textContent=item.name+(child?' + REMIX':' + DASH');
  before.title=item.name+' before transfer';after.title=item.name+' after transfer';before.src=item.before;
  after.removeAttribute('sandbox');
  if(child){channel=crypto.randomUUID();after.setAttribute('sandbox','allow-scripts');after.src=`/artifacts/${selected.id}/play.html#channel=${channel}`;}
  else after.src=item.after;
  after.hidden=false;
  for(const button of document.querySelectorAll('[data-turn]'))button.firstChild.textContent=item.action+' ';
  const fresh=selected?.intent.activation==='press';
  dashButton.firstChild.textContent=fresh?'Press to dash ':'Hold to dash ';
  $('#original-controls').textContent=item.id==='jujump'?'Tap or Space to jump and alternate direction. Hold the jump button for lighter gravity.':'Tap or Space to turn. Eat dots and avoid the ghost.';
  $('#transfer-controls').textContent=fresh?'Tap or Space to turn. Press D to dash; release it before the next dash.':item.control;
  $('#carries-over').textContent=child?`The same controller, with this child’s ${60*selected.intent.unitScale}-pixel ${selected.intent.direction==='opposite'?'backward':'forward'} dash mapping.`:item.carries;
  $('#recipient-keeps').textContent=item.keeps;
  $('#selection-note').textContent=`${item.name}: playing a saved ${child?'remix':'transfer'}. No model is running.`;
  $('#remix-details').hidden=item.liveEdits.length===0;$('#jujump-remix-note').hidden=item.liveEdits.length>0;
  if(child)$('#remix-details').open=true;
  $('#artifact-checks').href=child?`/artifacts/${selected.id}/report.json`:item.report;
  $('#adapter-source').href=child?`/artifacts/${selected.id}/adapter.ts`:item.source;
  const artifact=$('#artifact-id');artifact.textContent=(selected?.id??item.artifactId).slice(0,12);
  artifact.title=selected?.id??item.artifactId;artifact.href=selected?`/api/artifacts/${selected.id}`:item.report;
  $('#check-count').textContent=selected?`${selected.conformanceChecks} mapping cases + ${selected.browserChecks} browser checks`:'11 mapping cases + 7 browser checks';
  $('#model').textContent=item.id==='jujump'?'Human-authored integration':selected?.model??'Meta-generated adapter';
  $('#generation-cost').textContent=item.id==='jujump'?'$0 (no new model call)':`$${(selected?.estimatedGenerationCostUsd??0).toFixed(3)}`;
  if(selected){
    const {intent}=selected;
    $('#remix-summary').textContent=`Your dash travels ${60*intent.unitScale} pixels ${intent.direction==='opposite'?'backward':'forward'}. ${fresh?'Release D before the next dash.':'Keep D held to repeat after recharge.'}`;
    $('#source-download').href=`/api/artifacts/${selected.id}/source`;
  }
  window.dispatchEvent(new Event('artifactchange'));
  if(navigate)history.pushState({},'',selected?.parentArtifactId?'/play/'+selected.id:'/?destination='+item.id);
}
async function loadRoute(){
  const requestVersion=++version;
  const id=location.pathname.match(/^\/play\/([a-f0-9]{64})$/)?.[1];
  let target=catalog.destinations.find(item=>item.id===new URL(location.href).searchParams.get('destination'));
  if(id){
    target=catalog.destinations.find(item=>item.artifactId===id);
    if(!target){const selected=await json('/api/artifacts/'+id);if(requestVersion!==version)return;pakuSelection=selected;target=catalog.destinations.find(item=>item.id==='paku-paku');}
  }
  select(target??catalog.destinations[0]);
}
$('#share-transfer').addEventListener('click',async()=>{
  if(!destination)return;
  const path=window.currentArtifact?'/play/'+window.currentArtifact.id:'/?destination='+destination.id;
  const url=new URL(path,location.origin).href;
  try{await navigator.clipboard.writeText(url);$('#selection-note').textContent='Playable link copied. This local server must be available.';}
  catch{$('#selection-note').textContent=url;}
});
window.addEventListener('popstate',()=>loadRoute().catch(error=>{$('#selection-note').textContent=error.message;}));
try{
  [catalog,ability]=await Promise.all([json('/api/destinations'),json('/api/ability')]);
  catalog.destinations=catalog.destinations.filter(item=>item.componentId===ability.id);
  if(!catalog.destinations.length)throw Error('No verified destinations are available');
  $('#shared-component').textContent='SAME COMPONENT / '+ability.id.slice(0,12);$('#shared-component').title=ability.id;
  const transfer=await json('/api/transfer');
  if(transfer.status==='verified')pakuSelection={...transfer,intent:{unitScale:0.5,activation:'held',direction:'facing'}};
  await loadRoute();
}catch(error){$('#selection-note').textContent=error.message;$('#transfer-status').textContent='UNAVAILABLE';}
setInterval(()=>{
  if(!destination)return;
  try{
    const win=after.contentWindow;
    const state=channel?childState:destination.id==='jujump'?win.jujumpSnapshot?.():win.pakuSnapshot?.();
    const ready=channel?Boolean(childState):Boolean(win.pakuReady||win.jujumpReady);
    if(ready){
      $('#transfer-placeholder').hidden=true;
      $('#transfer-status').textContent=window.currentArtifact?.parentArtifactId?'CHECKED REMIX':'VERIFIED TRANSFER';
      for(const button of document.querySelectorAll('[data-turn],[data-transfer-control]'))button.disabled=false;
    }else if(Date.now()-loadingSince>10000){$('#transfer-status').textContent='LOAD FAILED';$('#transfer-placeholder').textContent='The saved player did not start. Reset the player to retry.';}
    const motion=state?.motion;
    $('#dash-state').textContent=!motion||state.status!=='playing'?'READY TO PLAY':state.isReplaying?'REPLAY'
      :motion.output?.ownsMotion?'DASH ACTIVE':motion.core.cooldown>0?'RECHARGING · '+(motion.core.cooldown/60).toFixed(2)+'s':'DASH READY';
  }catch{/* A frame may be between documents while changing destinations. */}
},80);
