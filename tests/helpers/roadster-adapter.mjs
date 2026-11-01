// Local verifier fixture only. The saved public adapter must come from Meta.
export function roadsterAdapterFixture(intent={unitScale:.1,activation:'held',direction:'facing'}){return `export function init(motion,config){return{core:motion.init(config.motion),previousDash:false};}
export function step(state,frame,motion,config){
 const active=frame.airborne&&frame.dash&&(${intent.activation==='press'?'!state.previousDash':'true'});
 const dir=frame.facing*${intent.direction==='opposite'?-1:1};
 const next=motion.step(state.core,{buttons:(dir<0?16:32)|(active?1:0),sourceBodyWidth:8},config.motion);
 const displacement=next.output.ownsMotion?next.output.displacement.x*config.unitScale:frame.normalDisplacement;
 const sweep=[];if(next.output.ownsMotion)for(let n=1;n<Math.abs(displacement);n++)sweep.push(n*Math.sign(displacement));
 return{state:{core:next.state,previousDash:frame.dash},output:{displacement,ownsMotion:next.output.ownsMotion,events:next.output.events,sweep}};
}`;}
