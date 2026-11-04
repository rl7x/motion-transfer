import {digest} from '../component/build.mjs';
import {observeRuntime} from '../runtime/investigation-session.mjs';
import {blindOutput} from '../agent/blind-output.mjs';

export function fingerprint(runtime){
  const {frame,memoryHash,framebufferHash,storage,palette}=runtime.observe();
  return{frame,memoryHash,framebufferHash,renderingHash:digest(JSON.stringify({framebufferHash,palette})),storage,faulted:runtime.faulted};
}
export function measure(runtime,watches=[],protocol){
  const value=observeRuntime(runtime,watches);
  return blindOutput({...fingerprint(runtime),motion:value.motion,memory:value.memory,text:value.drawCalls.filter(call=>call.name==='textUtf8').map(call=>call.text).join('\n').slice(0,1000)},protocol);
}
export function normalized(current,previous,initial){
  if(!current||!previous||!initial)return null;
  const start=previous.remaining<=0&&current.remaining>0,end=previous.remaining>0&&current.remaining===0;
  return{dx:current.position.x-initial.position.x,dy:current.position.y-initial.position.y,cooldown:current.cooldown,remaining:current.remaining,ownsMotion:previous.remaining>0||start,events:[...(start?['dash-start']:[]),...(end?['dash-end']:[])]};
}
export function behavior(sample){
  if(!sample)return null;const {dx,dy,ownsMotion,events}=sample;return{dx,dy,ownsMotion,events};
}
export const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
