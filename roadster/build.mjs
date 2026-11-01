import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadRoadster } from '../recipients/roadster/load.mjs';
import { loadRecoveredMotion } from '../component/load.mjs';
import { ROADSTER_SOURCE,roadsterHooks } from './physics.mjs';
import { ROADSTER_INTENT,validateRoadsterIntent } from './port.mjs';
import { digest } from '../component/build.mjs';

const cache=new Map();
export async function buildRoadsterFrame({source=null,intent=ROADSTER_INTENT}={}){
  validateRoadsterIntent(intent);
  const recipient=await loadRoadster(),component=await loadRecoveredMotion();
  const hostFiles=['roadster/build.mjs','roadster/physics.mjs','roadster/port.mjs','roadster/dash-presentation.mjs','roadster/dash-visuals.js','web/roadster-entry.js','evaluator/roadster.mjs','evaluator/roadster-browser.mjs','transfer/adapter.mjs','transfer/worker.mjs'];
  const host=Object.fromEntries(await Promise.all(hostFiles.map(async path=>[path,digest(await readFile(new URL('../'+path,import.meta.url)))])));
  const environment={componentId:component.provenance.id,recipientRevision:recipient.manifest.revision,recipientFiles:recipient.manifest.files,three:'0.186.1',host,
    presentation:{author:'Human-authored recipient presentation',afterimageLifetimeUpdates:5,renderedHoldUpdates:3,scope:'Visual hold and afterimages; component and simulated motion are unchanged. The hold is an added translation, not an observed donor pause.'}};
  const key=digest(JSON.stringify({source,intent,environment}));if(cache.has(key))return cache.get(key);
  const entry=await readFile(new URL('../web/roadster-entry.js',import.meta.url),'utf8');
  const modules={'roadster-entry':entry,'roadster-adapter':source??'export const init=null;export const step=null;',
    'roadster-core':component.javascript,'roadster-config':`export default ${JSON.stringify({defaults:component.contract.defaults,intent,componentId:component.provenance.id,transferred:Boolean(source)})};`};
  const virtual={name:'roadster-frame',setup(build){
    build.onResolve({filter:/^roadster-(entry|adapter|core|config)$/},args=>({path:args.path,namespace:'motion-roadster'}));
    build.onLoad({filter:/.*/,namespace:'motion-roadster'},args=>({contents:modules[args.path],resolveDir:fileURLToPath(new URL('../web/',import.meta.url)),loader:args.path==='roadster-adapter'?'ts':'js'}));
  }};
  const result=await build({entryPoints:['roadster-entry'],bundle:true,write:false,outdir:'out',format:'iife',target:'es2022',minify:true,alias:{'@':ROADSTER_SOURCE},loader:{'.png':'dataurl'},plugins:[virtual,roadsterHooks()]});
  const javascript=result.outputFiles.find(file=>file.path.endsWith('.js')).text;
  const css=result.outputFiles.find(file=>file.path.endsWith('.css'))?.text??'';
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'"><title>RDSTR Stunts ${source?'+ recovered dash':'before transfer'}</title><style>${css}\nhtml,body{margin:0;width:100%;height:100%;overflow:hidden}#scene{width:100%;height:100%;display:block}#ui{position:fixed;inset:0}.transfer-meter{position:fixed;bottom:8px;left:8px;padding:7px 10px;background:#101610dd;color:#c6ed89;font:11px monospace;z-index:15;pointer-events:none}</style></head><body><canvas id="scene"></canvas><div id="ui"></div><div class="transfer-meter" id="transfer-meter"></div><script>${javascript.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
  const artifact={html,environment,sourceSha256:source?digest(source):null,componentId:component.provenance.id,recipient, intent};cache.set(key,artifact);return artifact;
}
