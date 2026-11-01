import {App} from '@/app/app';
import {createAutopilot} from '@/physics/autopilot';
import {createRoadsterPort} from '../roadster/port.mjs';
import * as component from 'roadster-core';
import * as candidate from 'roadster-adapter';
import config from 'roadster-config';
import {prepareObstacles} from '@/physics/collision';
import {createDashVisuals} from '../roadster/dash-visuals.js';

let presentation;
const port=createRoadsterPort({component,adapter:config.transferred?candidate:null,defaults:config.defaults,intent:config.intent,
  onStep:sample=>presentation?.observe(sample),onReset:()=>presentation?.reset()});
globalThis.roadsterPort=port;
const app=new App(document.querySelector('#scene'),document.querySelector('#ui'));
const testing=new URLSearchParams(location.search).get('test')==='1';
presentation=createDashVisuals(app,{enabled:config.transferred&&new URLSearchParams(location.search).get('presentation')!=='off',reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches});
const draw=app.renderer.render.bind(app.renderer);app.renderer.render=()=>presentation.render(draw);
window.roadsterPresentation=()=>presentation.snapshot();
let dash=false,guided=false,guideDriver;
const release=()=>{dash=false;port.setDash(false);};
document.addEventListener('keydown',event=>{if(event.code==='KeyX'){event.preventDefault();dash=true;port.setDash(true);}});
document.addEventListener('keyup',event=>{if(event.code==='KeyX'){event.preventDefault();release();}});
window.addEventListener('blur',release);
document.addEventListener('visibilitychange',()=>{if(document.hidden)release();});
function start(assisted=true){release();window.__game.play('backflip');app.autopilot=assisted?createAutopilot(app.level):null;if(!testing)window.__game.realtime(true);}
window.roadsterStart=start;
window.roadsterSnapshot=()=>({status:app.state==='running'?'playing':app.state,car:window.__game.car(),game:window.__game.state(),motion:port.snapshot(app.physics),componentId:config.transferred?config.componentId:null});
window.roadsterAdvance=(frames=1,options={})=>{if(options.dash!==undefined){dash=Boolean(options.dash);port.setDash(dash);}window.__game.advance(frames/60,options.driver??'autopilot');return window.roadsterSnapshot();};
window.roadsterGuideStart=()=>{start(false);guided=true;guideDriver=createAutopilot(app.level);window.__game.realtime(false);return window.roadsterSnapshot();};
window.roadsterGuideRecord=frames=>{const controls=[];for(let i=0;i<frames;i++){const input={...guideDriver(app.physics.car,1/60)};controls.push(input);window.__game.advance(1/60,input);}return{controls,state:window.roadsterSnapshot()};};
if(testing)window.roadsterFixture=values=>{
  const physics=app.physics;
  const map={x:'px',y:'py',vx:'vx',vy:'vy',pitch:'pitch',roll:'roll',gas:'gas'};
  for(const [key,value]of Object.entries(values)){if(!(key in map)||!Number.isFinite(value))throw Error('Invalid fixture');physics[map[key]]=value;}
  physics.mode='airborne';physics.runEnded=false;physics.writeSnapshot(0,0);app.state='running';
};
if(testing)window.roadsterElapsed=(seconds,dt)=>{window.__game.realtime(false);for(let i=0;i<Math.round(seconds/dt);i++)app.tick(dt,{throttle:0,brake:0,thrust:false,spin:0});return window.roadsterSnapshot();};
if(testing)window.roadsterObstacle=x=>{if(!Number.isFinite(x))throw Error('Invalid obstacle fixture');app.physics.shapes.push(...prepareObstacles([{id:'declared-test-wall',label:'Declared thin-wall fixture',kind:'stage',x,z:0,baseY:0,sizeX:.02,sizeY:60,sizeZ:10,yaw:0,color:0xffffff,polygon:[[x-.01,0],[x+.01,0],[x+.01,60],[x-.01,60]]}]));};
const channel=location.hash.match(/(?:#|&)channel=([a-zA-Z0-9-]+)/)?.[1];
window.addEventListener('message',event=>{
  if(event.source!==parent||!channel||event.data?.channel!==channel)return;
  const {type,pressed}=event.data;
  if(type==='dash'){dash=Boolean(pressed);port.setDash(dash);}
  if(type==='turn'&&pressed)start();
  if(type==='roadster-restart')start(false);
  if(type==='roadster-visibility'&&!testing&&!guided){window.__game.realtime(Boolean(pressed));if(!pressed)release();}
  if(type==='roadster-guide-start'){window.roadsterGuideStart();parent.postMessage({type:'roadster-guide-result',channel,requestId:event.data.requestId,state:window.roadsterSnapshot()},'*');}
  if(type==='roadster-guide-step'){
    const inputs=event.data.controls;
    if(!Array.isArray(inputs)||inputs.length>12||inputs.some(input=>!input||Object.keys(input).sort().join(',')!=='brake,spin,throttle,thrust'||!Number.isFinite(input.throttle)||input.throttle<0||input.throttle>1||!Number.isFinite(input.brake)||input.brake<0||input.brake>1||!Number.isFinite(input.spin)||Math.abs(input.spin)>1||typeof input.thrust!=='boolean'))return;
    for(const input of inputs)window.roadsterAdvance(1,{driver:input,dash:Boolean(event.data.dash)});
    parent.postMessage({type:'roadster-guide-result',channel,requestId:event.data.requestId,state:window.roadsterSnapshot()},'*');
  }
  if(type==='roadster-guide-finish'){guided=false;release();if(!testing)window.__game.realtime(true);}
});
app.start();start(false);
if(testing)window.__game.realtime(false);
window.roadsterReady=true;
setInterval(()=>{
  const state=window.roadsterSnapshot(),motion=state.motion;
  document.querySelector('#transfer-meter').textContent=config.transferred?(motion?.output?.ownsMotion?'RECOVERED DASH ACTIVE':motion?.state?.core?.cooldown>0?'DASH RECHARGING':'X · AIR DASH'):'ORIGINAL SIMULATION · NO DASH';
  if(channel)parent.postMessage({type:'motion-status',channel,...state},'*');
},80);
