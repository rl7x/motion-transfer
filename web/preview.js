const $=selector=>document.querySelector(selector);
const before=$('#original-game'),after=$('#transfer-game'),donor=$('#donor-game');
let catalog,ability,destination,pakuSelection,roadsterSelection,channel,childState,version=0,loadingSince=0;
const donorChannel=crypto.randomUUID();
donor.src='/donor/play#channel='+donorChannel;
for(const button of document.querySelectorAll('[data-donor]'))button.disabled=true;

function bindHold(button,change){
  button.addEventListener('pointerdown',event=>{
    // Keep the game focused; its blur handler would otherwise release this input.
    event.preventDefault();button.setPointerCapture(event.pointerId);change(true);
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,()=>change(false));
  button.addEventListener('keydown',event=>{if(['Space','Enter'].includes(event.code)){event.preventDefault();if(!event.repeat)change(true);}});
  button.addEventListener('keyup',event=>{if(['Space','Enter'].includes(event.code)){event.preventDefault();change(false);}});
  button.addEventListener('blur',()=>change(false));
}
function send(frame,type,pressed){
  if(frame===after&&channel){frame.contentWindow?.postMessage({type,pressed,channel},'*');return;}
  const win=frame.contentWindow;
  if(destination?.id==='roadster'&&frame===before){if(type==='turn'&&pressed)win?.roadsterStart?.();return;}
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

let expandedCard,expandedButton,expandedInert=[],expanding=false;
function markExpanded(card,button){
  expandedCard=card;expandedButton=button;
  button.textContent='Close large view ×';button.setAttribute('aria-expanded','true');
  // Keep the existing iframe in place so resizing does not restart its game.
  card.querySelector('iframe').focus();
}
function closeExpanded(){
  if(!expandedCard)return;
  expandedCard.classList.remove('is-expanded');document.body.classList.remove('player-expanded');
  for(const element of expandedInert)element.inert=false;
  expandedInert=[];
  expandedButton.textContent='Expand ⤢';expandedButton.setAttribute('aria-expanded','false');
  expandedButton.focus({preventScroll:true});expandedCard=expandedButton=null;
}
document.addEventListener('fullscreenchange',()=>{
  if(!document.fullscreenElement)closeExpanded();
});
document.addEventListener('keydown',event=>{
  if(event.code==='Escape'&&expandedCard&&!document.fullscreenElement){event.preventDefault();closeExpanded();}
});
for(const button of document.querySelectorAll('[data-expand]'))button.addEventListener('click',async()=>{
  if(expanding)return;
  expanding=true;
  try{
    const card=button.closest('.game-card');
    if(expandedCard===card){
      if(document.fullscreenElement===card)await document.exitFullscreen();
      closeExpanded();
      return;
    }
    if(document.fullscreenEnabled&&card.requestFullscreen){
      try{await card.requestFullscreen();markExpanded(card,button);return;}
      catch{/* Use the page-sized player when browser fullscreen is unavailable. */}
    }
    card.classList.add('is-expanded');document.body.classList.add('player-expanded');
    for(let node=card;node.parentElement&&node!==document.body;node=node.parentElement){
      for(const sibling of node.parentElement.children)if(sibling!==node&&!sibling.inert){sibling.inert=true;expandedInert.push(sibling);}
    }
    markExpanded(card,button);
  }finally{expanding=false;}
});

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
    const saved=document.createElement('small');saved.textContent=item.id==='roadster'?'Saved transfer · live Meta adaptation':item.liveEdits.length?'Saved transfer · live remix supported':'Saved transfer · gravity and landing';
    button.append(kind,name,action,saved);button.addEventListener('click',()=>select(item,true));return button;
  });
  $('#destinations').replaceChildren(...buttons);
}
function select(item,navigate=false){
  version++;loadingSince=Date.now();destination=item;channel=null;childState=null;
  const car=item.id==='roadster';
  const selected=car?roadsterSelection:item.id==='paku-paku'?pakuSelection:null;
  const child=Boolean(selected?.parentArtifactId);
  window.currentDestination=item.id;window.currentArtifact=car?null:selected;window.currentRoadsterArtifact=car?selected:null;
  renderChoices();
  for(const button of document.querySelectorAll('[data-turn],[data-transfer-control]'))button.disabled=true;
  $('#transfer-status').textContent='LOADING';$('#transfer-placeholder').hidden=false;after.hidden=true;
  $('#recipient-title').textContent=item.name;$('#hybrid-title').textContent=item.name+(child?' + REMIX':' + DASH');
  before.title=item.name+' before transfer';after.title=item.name+' after transfer';before.src=item.before;
  after.removeAttribute('sandbox');
  if(car){channel=crypto.randomUUID();after.setAttribute('sandbox','allow-scripts');after.src=`/roadster/artifacts/${selected.id}/play.html?quality=low&session=${channel}#channel=${channel}`;}
  else if(child){channel=crypto.randomUUID();after.setAttribute('sandbox','allow-scripts');after.src=`/artifacts/${selected.id}/play.html?session=${channel}#channel=${channel}`;}
  else after.src=item.after;
  after.hidden=false;
  for(const button of document.querySelectorAll('[data-turn]'))button.firstChild.textContent=item.action+' ';
  const fresh=selected?.intent.activation==='press';
  dashButton.firstChild.textContent=fresh?'Press to dash ':'Hold to dash ';
  dashButton.querySelector('kbd').textContent=item.dashKey??'D';
  for(const button of document.querySelectorAll('[data-turn]'))button.querySelector('kbd').textContent=car?'Enter':'Space';
  $('#original-controls').textContent=car?'Run stunt starts the assisted driver. Inside the game, arrows/WASD drive and rotate; Space fires native lift thrusters.':item.id==='jujump'?'Tap or Space to jump and alternate direction. Hold the jump button for lighter gravity.':'Tap or Space to turn. Eat dots and avoid the ghost.';
  $('#transfer-controls').textContent=car?`Run the stunt, then ${fresh?'press':'hold'} X for the horizontal air dash. Native controls and touch buttons still work.`:fresh?'Tap or Space to turn. Press D to dash; release it before the next dash.':item.control;
  $('#carries-over').textContent=child?`The same controller, with this child’s ${60*selected.intent.unitScale}-${car?'meter':'pixel'} ${selected.intent.direction==='opposite'?'backward':'forward'} dash mapping.`:item.carries;
  $('#recipient-keeps').textContent=item.keeps;
  $('#selection-note').textContent=`${item.name}: playing a saved ${child?'remix':'transfer'}. Choosing a destination makes no model request.`;
  $('#remix-details').hidden=item.id!=='paku-paku';$('#jujump-remix-note').hidden=item.id!=='jujump';$('#roadster-panel').hidden=!car;
  if(child&&!car)$('#remix-details').open=true;
  $('#artifact-checks').href=car?`/roadster/artifacts/${selected.id}/report.json`:child?`/artifacts/${selected.id}/report.json`:item.report;
  $('#adapter-source').href=car?`/roadster/artifacts/${selected.id}/adapter.ts`:child?`/artifacts/${selected.id}/adapter.ts`:item.source;
  const artifact=$('#artifact-id');artifact.textContent=(selected?.id??item.artifactId).slice(0,12);
  artifact.title=selected?.id??item.artifactId;artifact.href=car?`/api/roadster/artifacts/${selected.id}`:selected?`/api/artifacts/${selected.id}`:item.report;
  $('#check-count').textContent=car?'8 mapping cases + 7 browser checks':selected?`${selected.conformanceChecks} mapping cases + ${selected.browserChecks} browser checks`:'11 mapping cases + 7 browser checks';
  $('#model').textContent=item.id==='jujump'?'Human-authored integration':selected?.model??'Meta-generated adapter';
  $('#generation-cost').textContent=item.id==='jujump'?'$0 (no new model call)':`$${(selected?.estimatedGenerationCostUsd??selected?.estimatedCostUsd??0).toFixed(3)}`;
  if(selected&&!car){
    const {intent}=selected;
    $('#remix-summary').textContent=`Your dash travels ${60*intent.unitScale} pixels ${intent.direction==='opposite'?'backward':'forward'}. ${fresh?'Release D before the next dash.':'Keep D held to repeat after recharge.'}`;
    $('#source-download').href=`/api/artifacts/${selected.id}/source`;
  }
  window.dispatchEvent(new Event('artifactchange'));
  if(navigate)history.pushState({},'',car?'/roadster/play/'+selected.id:selected?.parentArtifactId?'/play/'+selected.id:'/?destination='+item.id);
}
async function loadRoute(){
  const requestVersion=++version;
  const id=location.pathname.match(/^\/play\/([a-f0-9]{64})$/)?.[1];
  let target=catalog.destinations.find(item=>item.id===new URL(location.href).searchParams.get('destination'));
  const carId=location.pathname.match(/^\/roadster\/play\/([a-f0-9]{64})$/)?.[1];
  if(carId){roadsterSelection=await json('/api/roadster/artifacts/'+carId);if(requestVersion!==version)return;target=catalog.destinations.find(item=>item.id==='roadster');}
  if(id){
    target=catalog.destinations.find(item=>item.artifactId===id);
    if(!target){const selected=await json('/api/artifacts/'+id);if(requestVersion!==version)return;pakuSelection=selected;target=catalog.destinations.find(item=>item.id==='paku-paku');}
  }
  select(target??catalog.destinations[0]);
}
$('#share-transfer').addEventListener('click',async()=>{
  if(!destination)return;
  const path=window.currentRoadsterArtifact?'/roadster/play/'+window.currentRoadsterArtifact.id:window.currentArtifact?'/play/'+window.currentArtifact.id:'/?destination='+destination.id;
  const url=new URL(path,location.origin).href;
  try{await navigator.clipboard.writeText(url);$('#selection-note').textContent='Playable link copied. This local server must be available.';}
  catch{$('#selection-note').textContent=url;}
});
window.addEventListener('popstate',()=>loadRoute().catch(error=>{$('#selection-note').textContent=error.message;}));
try{
  [catalog,ability]=await Promise.all([json('/api/destinations'),json('/api/ability')]);
  catalog.destinations=catalog.destinations.filter(item=>item.componentId===ability.id);
  const canvas=document.createElement('canvas'),webgl=canvas.getContext('webgl2');
  if(!webgl)catalog.destinations=catalog.destinations.filter(item=>item.id!=='roadster');else webgl.getExtension('WEBGL_lose_context')?.loseContext();
  if(!catalog.destinations.length)throw Error('No verified destinations are available');
  $('#shared-component').textContent='SAME COMPONENT / '+ability.id.slice(0,12);$('#shared-component').title=ability.id;
  const transfer=await json('/api/transfer');
  if(transfer.status==='verified')pakuSelection={...transfer,intent:{unitScale:0.5,activation:'held',direction:'facing'}};
  const car=catalog.destinations.find(item=>item.id==='roadster');if(car){window.savedRoadsterId=car.artifactId;roadsterSelection=await json('/api/roadster/artifacts/'+car.artifactId);}
  window.selectDestination=async id=>{const item=catalog.destinations.find(item=>item.id===id);if(!item)throw Error('Destination unavailable');select(item,true);};
  window.openRoadsterArtifact=async id=>{roadsterSelection=await json('/api/roadster/artifacts/'+id);select(catalog.destinations.find(item=>item.id==='roadster'),true);};
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
    const core=motion?.core??motion?.state?.core;
    $('#dash-state').textContent=!motion||state.status!=='playing'?'READY TO PLAY':state.isReplaying?'REPLAY'
      :motion.output?.ownsMotion?'DASH ACTIVE':core?.cooldown>0?'RECHARGING · '+(core.cooldown/60).toFixed(2)+'s':'DASH READY';
  }catch{/* A frame may be between documents while changing destinations. */}
},80);

const visibility=new IntersectionObserver(entries=>{
  if(destination?.id!=='roadster'||window.guidedRunning)return;
  for(const entry of entries){try{
    if(entry.target===after&&channel)after.contentWindow?.postMessage({type:'roadster-visibility',pressed:entry.isIntersecting,channel},'*');
    if(entry.target===before&&!before.src.includes('test=1'))before.contentWindow?.__game?.realtime(entry.isIntersecting);
  }catch{/* The frame can be loading. */}}
},{threshold:.05});visibility.observe(before);visibility.observe(after);
