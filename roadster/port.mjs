// The host owns physics; this port owns only the adapter/component boundary.
export const ROADSTER_INTENT=Object.freeze({unitScale:0.1,activation:'held',direction:'facing'});
export function validateRoadsterIntent(intent){
  if(!intent||Object.keys(intent).sort().join(',')!=='activation,direction,unitScale'||!Number.isFinite(intent.unitScale)||intent.unitScale<.025||intent.unitScale>.2||!['held','press'].includes(intent.activation)||!['facing','opposite'].includes(intent.direction))throw Error('Unsupported Roadster mapping');
  return intent;
}
export function createRoadsterPort({component,adapter,defaults,intent=ROADSTER_INTENT}={}){
  validateRoadsterIntent(intent);const states=new WeakMap();let dashHeld=false;
  const config=Object.freeze({motion:Object.freeze({...defaults}),unitScale:intent.unitScale});
  function create(){
    const counters={init:0,step:0};
    const check=cfg=>{if(JSON.stringify(cfg)!==JSON.stringify(config.motion))throw Error('Adapter changed frozen motion defaults');};
    const motion=Object.freeze({init(cfg){check(cfg);counters.init++;return component.init(cfg);},step(state,input,cfg){check(cfg);if(input.sourceBodyWidth!==8)throw Error('Adapter changed verified body width');counters.step++;return component.step(state,input,cfg);}});
    const state={substeps:0,tick:0,output:null,state:adapter?adapter.init(motion,config):null,motion,counters};
    if(adapter&&counters.init!==1)throw Error('Adapter must initialize the component once');
    return state;
  }
  return{
    setDash(value){dashHeld=Boolean(value);},
    reset(physics){states.set(physics,create());},
    substep(physics,airborne){
      let state=states.get(physics);if(!state){state=create();states.set(physics,state);}
      if(state.substeps++%4!==0)return;
      state.tick++;
      if(!adapter)return;
      const previous=state.counters.step;
      const result=adapter.step(state.state,Object.freeze({tick:state.tick,position:physics.px,facing:1,normalDisplacement:physics.vx/60,dash:dashHeld,airborne}),state.motion,config);
      if(state.counters.step!==previous+1||state.counters.init!==1)throw Error('Adapter must delegate exactly once per logical update');
      const output=result?.output;
      if(!result.state||!output||!Number.isFinite(output.displacement)||Math.abs(output.displacement)>2||typeof output.ownsMotion!=='boolean'||!Array.isArray(output.events)||output.events.some(value=>!['dash-start','dash-end'].includes(value)))throw Error('Invalid Roadster adapter output');
      state.state=result.state;state.output=output;
    },
    movement(physics){const state=states.get(physics);return state?.output?.ownsMotion?state.output.displacement/4:null;},
    snapshot(physics){const state=states.get(physics);return state?JSON.parse(JSON.stringify({tick:state.tick,substeps:state.substeps,state:state.state,output:state.output,dashHeld,coreCalls:state.counters.step})):null;},
  };
}
