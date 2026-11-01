// A human-written test adapter; never used as a production model submission.
export function remixFixture(intent) {
  return `export function init(motion,config){return{core:motion.init(config.motion),wasDown:false};}
  export function step(state,frame,motion,config){
    const direction=frame.facing*${intent.direction==='opposite'?-1:1};
    const trigger=frame.dash${intent.activation==='press'?'&&!state.wasDown':''};
    const result=motion.step(state.core,{buttons:(direction<0?16:32)|(trigger?1:0),sourceBodyWidth:8},config.motion);
    const displacement=result.output.ownsMotion?result.output.displacement.x*config.unitScale:frame.normalDisplacement;
    const sweep=[];
    if(result.output.ownsMotion)for(let distance=1;distance<Math.abs(displacement)-1e-9;distance++)sweep.push(distance*Math.sign(displacement));
    return{state:{core:result.state,wasDown:frame.dash},output:{displacement,ownsMotion:result.output.ownsMotion,events:result.output.events,sweep}};
  }`;
}
