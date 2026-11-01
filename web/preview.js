const status = document.querySelector('#transfer-status');
const transferFrame = document.querySelector('#transfer-game');
const placeholder = document.querySelector('#transfer-placeholder');
let channel, childState;

try {
  const response = await fetch('/api/transfer');
  if (!response.ok) throw Error('Transfer metadata is unavailable');
  const transfer = await response.json();
  if (transfer.status !== 'verified') throw Error('No verified transfer has been saved yet');
  const selectedId=location.pathname.match(/^\/play\/([a-f0-9]{64})$/)?.[1];
  const selected=selectedId&&selectedId!==transfer.id
    ? await (await fetch('/api/artifacts/'+selectedId)).json()
    : {...transfer,intent:{unitScale:0.5,activation:'held',direction:'facing'},summary:'Recovered dash transferred to PAKU PAKU'};
  if(selected.error)throw Error(selected.error);
  const child=selected.id!==transfer.id;
  status.textContent = child ? 'CHECKED REMIX' : 'VERIFIED TRANSFER';
  if(child){
    channel=crypto.randomUUID();transferFrame.setAttribute('sandbox','allow-scripts');
    transferFrame.src=`/artifacts/${selected.id}/play.html#channel=${channel}`;
    document.querySelector('#hybrid-title').textContent='PAKU PAKU + REMIX';
  } else transferFrame.src = transferFrame.dataset.src;
  transferFrame.hidden = false;
  placeholder.hidden = true;
  document.querySelectorAll('[data-transfer-control]').forEach(button => { button.disabled = false; });
  document.querySelector('#check-count').textContent = `${selected.conformanceChecks + selected.browserChecks} checks passed`;
  document.querySelector('#model').textContent = selected.model;
  const artifactLink=document.querySelector('#artifact-id');
  artifactLink.textContent=selected.id.slice(0,12);artifactLink.title=selected.id;
  artifactLink.href=child?'/api/artifacts/'+selected.id:'/artifact/receipt.json';
  document.querySelector('#adapter-source').href=child?`/artifacts/${selected.id}/adapter.ts`:'/artifact/adapter.ts';
  document.querySelector('#artifact-checks').href=child?`/artifacts/${selected.id}/report.json`:'/artifact/browser.json';
  document.querySelector('#generation-cost').textContent = `$${selected.estimatedGenerationCostUsd.toFixed(3)}`;
  const fresh=selected.intent.activation==='press';
  document.querySelector('[data-dash]').firstChild.textContent=fresh?'Press to dash ':'Hold to dash ';
  document.querySelector('#transfer-controls').textContent=fresh
    ? 'Tap or press Space to turn. Press D to dash; release it before the next dash.'
    : 'Tap or press Space to turn. Hold D to dash again whenever it recharges.';
  document.querySelector('#remix-summary').textContent=`Your dash travels ${60*selected.intent.unitScale} pixels ${selected.intent.direction==='opposite'?'backward':'forward'}. ${fresh?'Release D before the next dash.':'Keep D held to repeat after recharging.'}`;
  document.querySelector('#source-download').href=`/api/artifacts/${selected.id}/source`;
  window.currentArtifact=selected;window.dispatchEvent(new Event('artifactchange'));
} catch (error) {
  status.textContent = 'TRANSFER UNAVAILABLE';
  placeholder.textContent = error.message;
}

function dash(pressed) {
  transferFrame.contentWindow?.postMessage({ type: 'dash', pressed, channel }, channel ? '*' : location.origin);
  document.querySelector('[data-dash]').classList.toggle('pressed', pressed);
}

for (const button of document.querySelectorAll('[data-turn]')) {
  const frame = document.getElementById(button.dataset.turn);
  const turn = pressed => {
    if(frame===transferFrame&&channel){frame.contentWindow.postMessage({type:'turn',pressed,channel},'*');return;}
    if (!frame.contentWindow?.pakuReady) return;
    frame.contentDocument.dispatchEvent(new frame.contentWindow.KeyboardEvent(pressed ? 'keydown' : 'keyup', { code: 'Space', key: ' ', bubbles: true, cancelable: true }));
  };
  button.addEventListener('pointerdown', event => { button.setPointerCapture(event.pointerId); turn(true); });
  button.addEventListener('pointerup', () => turn(false));
  button.addEventListener('pointercancel', () => turn(false));
  button.addEventListener('lostpointercapture', () => turn(false));
  button.addEventListener('keydown', event => { if (event.code === 'Space' || event.code === 'Enter') { event.preventDefault(); if (!event.repeat) turn(true); } });
  button.addEventListener('keyup', event => { if (event.code === 'Space' || event.code === 'Enter') { event.preventDefault(); turn(false); } });
  button.addEventListener('blur', () => turn(false));
}

const dashButton = document.querySelector('[data-dash]');
dashButton.addEventListener('pointerdown', event => { dashButton.setPointerCapture(event.pointerId); dash(true); });
dashButton.addEventListener('pointerup', () => dash(false));
dashButton.addEventListener('pointercancel', () => dash(false));
dashButton.addEventListener('lostpointercapture', () => dash(false));
dashButton.addEventListener('keydown', event => { if (event.code === 'Space' || event.code === 'Enter') { event.preventDefault(); dash(true); } });
dashButton.addEventListener('keyup', event => { if (event.code === 'Space' || event.code === 'Enter') { event.preventDefault(); dash(false); } });
dashButton.addEventListener('blur', () => dash(false));
window.addEventListener('blur', () => dash(false));

for (const button of document.querySelectorAll('[data-reset]')) button.addEventListener('click', () => {
  const frame = document.getElementById(button.dataset.reset);
  if (frame === transferFrame) dash(false);
  if (frame.getAttribute('src')) frame.src = frame.getAttribute('src');
});

window.addEventListener('message',event=>{
  if(!channel||event.source!==transferFrame.contentWindow||event.data?.channel!==channel||event.data.type!=='motion-status')return;
  childState=event.data;
});
setInterval(() => {
  try {
    const game = channel ? childState : transferFrame.contentWindow?.pakuSnapshot?.();
    const motion = game?.motion;
    const label = document.querySelector('#dash-state');
    if (!motion || game.status !== 'playing' || game.isReplaying) label.textContent = game?.isReplaying ? 'REPLAY' : 'READY TO PLAY';
    else if (motion.output?.ownsMotion) label.textContent = 'DASH ACTIVE';
    else if (motion.core.cooldown > 0) label.textContent = `RECHARGING · ${motion.core.cooldown} TICKS`;
    else label.textContent = 'DASH READY';
  } catch { /* The frame may be between documents during reset. */ }
}, 80);
