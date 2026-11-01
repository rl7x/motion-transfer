const button=document.querySelector('#watch-transfer'),progress=document.querySelector('#guided-progress');
let running=false;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function ready(frame){for(let i=0;i<150;i++){try{if(frame.contentWindow.roadsterReady)return;}catch{/* Opaque transferred frame reports through messages. */}if(frame.id==='transfer-game'&&document.querySelector('#transfer-status').textContent==='VERIFIED TRANSFER')return;await delay(50);}throw Error('Player did not load');}
function ask(frame,type,payload={}){
  const channel=new URL(frame.src).hash.slice(1).split('channel=')[1],requestId=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{window.removeEventListener('message',listener);reject(Error('The guided player did not respond'));},5000);
    const listener=event=>{if(event.source!==frame.contentWindow||event.data?.channel!==channel||event.data?.type!=='roadster-guide-result'||event.data.requestId!==requestId)return;clearTimeout(timeout);window.removeEventListener('message',listener);resolve(event.data.state);};
    window.addEventListener('message',listener);frame.contentWindow.postMessage({type,channel,requestId,...payload},'*');
  });
}
button.addEventListener('click',async()=>{
  if(running)return;running=true;button.disabled=true;window.guidedRunning=true;window.guidedState={phase:'starting'};
  let before,after;
  try{
    if(!window.savedRoadsterId)throw Error('The Roadster demonstration needs a verified transfer and WebGL2. The other destinations remain playable.');
    await window.openRoadsterArtifact(window.savedRoadsterId);
    before=document.querySelector('#original-game');after=document.querySelector('#transfer-game');
    await Promise.all([ready(before),ready(after)]);
    document.querySelector('.games').scrollIntoView({behavior:'smooth',block:'start'});
    const donor=document.querySelector('#donor-game'),donorChannel=new URL(donor.src).hash.slice(1).split('channel=')[1];
    donor.src=donor.src;await delay(500);
    const donorInput=(name,pressed)=>donor.contentWindow.postMessage({type:'donor-control',button:name,pressed,channel:donorChannel},'*');
    donorInput('dash',true);await delay(35);donorInput('dash',false);await delay(230);donorInput('right',true);donorInput('dash',true);await delay(140);donorInput('dash',false);donorInput('right',false);
    if(innerWidth<900)after.closest('.game-card').scrollIntoView({behavior:'smooth',block:'start'});
    progress.textContent='The compiled donor supplies the ability. Next: the same controller inside the Roadster, using matched recorded native inputs.';
    before.contentWindow.roadsterGuideStart();await ask(after,'roadster-guide-start');
    let recorded,state;
    for(let chunk=0;chunk<150;chunk++){
      if(window.currentDestination!=='roadster')throw Error('Demonstration stopped after changing destination.');
      recorded=before.contentWindow.roadsterGuideRecord(6);state=await ask(after,'roadster-guide-step',{controls:recorded.controls,dash:false});
      if(recorded.state.car.mode==='airborne'&&recorded.state.car.airTime>=1.1&&recorded.state.car.heightAboveGround>5)break;
      await delay(40);
    }
    if(state?.car.mode!=='airborne')throw Error('The scripted stunt did not reach its airborne comparison.');
    const start=state.car.position.x;let activeUpdates=0;const trace=[];
    progress.textContent='Airborne: eight slowed updates. The recovered dash supplies horizontal movement; the car keeps its own vertical motion.';window.guidedState={phase:'dashing'};
    for(let tick=0;tick<8;tick++){
      recorded=before.contentWindow.roadsterGuideRecord(1);state=await ask(after,'roadster-guide-step',{controls:recorded.controls,dash:true});
      trace.push({before:recorded.state.car.position,after:state.car.position,mode:state.car.mode,events:state.motion.output.events});
      if(state.motion.output.ownsMotion)activeUpdates++;await delay(120);
    }
    const measuredMeters=state.car.position.x-start;
    window.guidedState={phase:'finishing',activeUpdates,measuredMeters};
    for(let chunk=0;chunk<40;chunk++){recorded=before.contentWindow.roadsterGuideRecord(6);await ask(after,'roadster-guide-step',{controls:recorded.controls,dash:false});await delay(40);}
    progress.textContent=`Actual transfer: ${measuredMeters.toFixed(2)} meters during ${activeUpdates} active updates. The component stayed frozen. Try X yourself, then investigate or adapt with Meta.`;
    window.guidedState={phase:'complete',activeUpdates,measuredMeters,trace};
  }catch(error){progress.textContent=error.message;window.guidedState={phase:'failed',error:error.message};}
  finally{
    try{after?.contentWindow?.postMessage({type:'roadster-guide-finish',channel:new URL(after.src).hash.slice(1).split('channel=')[1]},'*');before?.contentWindow?.__game?.realtime(true);}catch{/* A destination may have changed. */}
    running=false;window.guidedRunning=false;button.disabled=false;
  }
});
