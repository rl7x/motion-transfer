type Cfg={walkingSpeed:number;dashDistance:number;cooldownTicks:number;initialCooldownTicks:number};
type St={dirX:number;dirY:number;remaining:number;cooldown:number;cooldownFresh:boolean};
const F=Math.fround;
function cfg(c?:Partial<Cfg>):Cfg{return{walkingSpeed:c?.walkingSpeed??2,dashDistance:c?.dashDistance??60,cooldownTicks:c?.cooldownTicks??25,initialCooldownTicks:c?.initialCooldownTicks??10};}
function norm(x:number,y:number):[number,number]{x=F(x);y=F(y);const d=F(Math.sqrt(F(F(x*x)+F(y*y))));if(d===0)return[0,0];const inv=F(1/d);return[F(x*inv),F(y*inv)];}
function inputDir(b:number):[number,number]{let x=0,y=0;if(b&32)x+=1;if(b&16)x-=1;if(b&128)y+=1;if(b&64)y-=1;return norm(x,y);}
export function init(c?:Partial<Cfg>):St{const k=cfg(c);return{dirX:0,dirY:0,remaining:0,cooldown:k.initialCooldownTicks|0,cooldownFresh:false};}
export function step(state:St,input:{buttons:number;sourceBodyWidth:number},c?:Partial<Cfg>):{state:St;output:{ownsMotion:boolean;displacement:{x:number;y:number};events:string[]}}{
 const k=cfg(c);const s:St={...state};const b=input?.buttons|0;const events:string[]=[];
 const width=Math.max(1,Math.round(Number(input?.sourceBodyWidth)||8));
 if(s.remaining>0){
   const speed=F(k.dashDistance/width);const dx=F(s.dirX*speed),dy=F(s.dirY*speed);
   s.remaining=(s.remaining-1)|0;if(s.remaining===0)events.push("dash-end");
   return{state:s,output:{ownsMotion:true,displacement:{x:dx,y:dy},events}};
 }
 if((b&1)!==0&&s.cooldown===0){
   let[dx,dy]=inputDir(b);if(dx===0&&dy===0){dx=1;dy=0;}
   s.dirX=dx;s.dirY=dy;s.cooldown=k.cooldownTicks|0;s.cooldownFresh=true;
   s.remaining=width; // dash ticks; per-tick distance/width gives total dashDistance
   const speed=F(k.dashDistance/width);const mx=F(s.dirX*speed),my=F(s.dirY*speed);
   s.remaining=(s.remaining-1)|0;events.push("dash-start");if(s.remaining===0)events.push("dash-end");
   return{state:s,output:{ownsMotion:true,displacement:{x:mx,y:my},events}};
 }
 const[wx,wy]=inputDir(b);const dx=F(wx*F(k.walkingSpeed)),dy=F(wy*F(k.walkingSpeed));
 if(s.cooldown>0)s.cooldown=(s.cooldown-1)|0;
 return{state:s,output:{ownsMotion:false,displacement:{x:dx,y:dy},events}};
}