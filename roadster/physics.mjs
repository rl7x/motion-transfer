import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { digest } from '../component/build.mjs';

export const ROADSTER_SOURCE=fileURLToPath(new URL('../recipients/roadster/upstream/src/',import.meta.url));
const replace=(text,from,to)=>{if(text.split(from).length!==2)throw Error('Roadster source hook no longer matches: '+from.slice(0,60));return text.replace(from,to);};
export function hookRoadsterPhysics(source){
  source=replace(source,'    this.writeSnapshot(0, 0);','    this.writeSnapshot(0, 0);\n    globalThis.roadsterPort?.reset(this);');
  source=replace(source,'      const live = !this.runEnded;','      globalThis.roadsterPort?.substep(this, this.mode === "airborne" && !this.runEnded);\n      const live = !this.runEnded;');
  source=replace(source,'    this.px += this.vx * SUB;\n    this.py += this.vy * SUB;',`    const dashDx = globalThis.roadsterPort?.movement(this);
    const transferred = dashDx !== null && dashDx !== undefined && !this.runEnded;
    if (!transferred) {
      this.px += this.vx * SUB;
      this.py += this.vy * SUB;
    }`);
  source=replace(source,'    this.collideAirborne();',`    if (transferred) {
      const dy = this.vy * SUB;
      const count = Math.max(1, Math.ceil(Math.max(Math.abs(dashDx), Math.abs(dy)) / 0.02));
      if (count > 256) throw new Error("Transferred motion exceeds collision sweep limit");
      for (let index = 0; index < count; index++) {
        this.px += dashDx / count;
        this.py += dy / count;
        this.collideAirborne();
        if (this.mode !== "airborne" || this.runEnded) break;
      }
    } else this.collideAirborne();`);
  return source;
}
export function roadsterHooks(){return{name:'roadster-physics-hooks',setup(build){build.onLoad({filter:/[/\\]physics[/\\]car-physics\.ts$/},async args=>({contents:hookRoadsterPhysics(await readFile(args.path,'utf8')),loader:'ts'}));}};}
export async function loadRoadsterPhysics({hooked=true}={}){
  const result=await build({stdin:{contents:'export {CarPhysics} from "@/physics/car-physics"; export {getLevel} from "@/levels"; export {createAutopilot} from "@/physics/autopilot";',resolveDir:ROADSTER_SOURCE,loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',alias:{'@':ROADSTER_SOURCE},plugins:hooked?[roadsterHooks()]:[]});
  const code=result.outputFiles[0].text;
  return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64')+'#'+digest(code));
}
