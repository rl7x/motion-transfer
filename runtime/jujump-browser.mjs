import { replaceOnce } from './paku-browser.mjs';

export function hookedJujumpSource(source) {
  source = source.replaceAll('\r\n', '\n');
  source = replaceOnce(source, '  p.add(v);', `  const origin = vec(p);
  const incomingY = v.y;
  const motion = window.motionPort.move({tick:ticks,position:p.x,facing:jumpWay,normalDisplacement:v.x});
  p.x += motion.displacement;
  p.y += incomingY;`);
  return replaceOnce(source, '  color("transparent");\n  for (;;) {', `  if (motion.ownsMotion) {
    // Platforms are already drawn in their scrolled coordinates. Sweep the
    // requested motion; retain JUJUMP's upward overlap resolution at each point.
    const count = Math.max(1, Math.ceil(Math.max(Math.abs(motion.displacement), Math.abs(incomingY))));
    p.set(origin.x, origin.y + scr);
    let landed = false;
    for (let index = 0; index < count; index++) {
      p.x += motion.displacement / count;
      if (!landed) p.y += incomingY / count;
      color("transparent");
      while (box(p,7,7).isColliding.rect.blue) {
        p.y--; v.set(); jumpPower = 1; landed = true;
      }
    }
  }
  color("transparent");
  for (;;) {`);
}

export function jujumpObservationSource() {
  return `
    window.jujumpStatus='title';
    const baseEnd=window.end;
    window.end=function(...args){window.jujumpStatus='game-over';return baseEnd(...args);};
    const baseUpdate=window.update;
    window.update=function(){
      if(ticks===0){window.jujumpStatus='playing';window.motionPort?.reset(Boolean(isReplaying));}
      baseUpdate();
    };
    window.jujumpSnapshot=()=>structuredClone({ticks,score,p:{x:p?.x,y:p?.y},v:{x:v?.x,y:v?.y},
      floors:floors?.map(f=>({x:f.x,y:f.y})),jumpWay,jumpPower,scr,status:window.jujumpStatus,isReplaying,
      motion:window.motionPort?.snapshot()??null});
    if(new URL(location.href).searchParams.get('test')==='1')window.jujumpFixture=value=>{
      if(value.p)p.set(value.p.x,value.p.y);
      if(value.v)v.set(value.v.x,value.v.y);
      if(value.floors)floors=value.floors.map(f=>vec(f.x,f.y));
      if(value.jumpWay!==undefined)jumpWay=value.jumpWay;
      if(value.jumpPower!==undefined)jumpPower=value.jumpPower;
      if(value.floorAppDist!==undefined)floorAppDist=value.floorAppDist;
    };
  `;
}
