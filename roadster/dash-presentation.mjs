// Human-authored visual translation. This never changes component or physics state.
export const DASH_PRESENTATION=Object.freeze({holdTicks:3,trailLifetimeTicks:5,maxAfterimages:5});

export function createDashPresentation({reducedMotion=false}={}){
  let tick=0,startedAt=-Infinity,afterimages=[];
  return{
    reset(){tick=0;startedAt=-Infinity;afterimages=[];},
    observe(sample){
      tick=sample.tick;
      afterimages=afterimages.filter(image=>tick-image.tick<=DASH_PRESENTATION.trailLifetimeTicks);
      if(reducedMotion)return;
      if(sample.output.events.includes('dash-start'))startedAt=tick;
      if(sample.output.ownsMotion){
        afterimages.push({tick,pose:{...sample.pose}});
        afterimages=afterimages.slice(-DASH_PRESENTATION.maxAfterimages);
      }
    },
    snapshot(){
      return{tick,reducedMotion,hold:!reducedMotion&&tick-startedAt<DASH_PRESENTATION.holdTicks,
        afterimages:afterimages.map(image=>({pose:{...image.pose},ageTicks:tick-image.tick,opacity:.34*(1-(tick-image.tick)/(DASH_PRESENTATION.trailLifetimeTicks+1))}))};
    },
  };
}
