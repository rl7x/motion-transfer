import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { loadRecoveredMotion } from '../component/load.mjs';
import { loadPakuPaku } from '../recipients/paku-paku/load.mjs';
import { clockedPakuRuntime, hookedPakuSource, pakuObservationSource } from '../runtime/paku-browser.mjs';
import { validateIntent } from './contract.mjs';

const inline = source => source.replace(/<\/script/gi, '<\\/script');

export async function buildRemixFrame(compiled, intent, { original = false } = {}) {
  validateIntent(intent);
  const [recipient, component] = await Promise.all([loadPakuPaku(), loadRecoveredMotion()]);
  const sources = { adapter: compiled.javascript, component: component.javascript };
  for (const name of ['port', 'clock']) sources[name] = await readFile(new URL(`../web/${name}.js`, import.meta.url), 'utf8');
  sources.output = await readFile(new URL('../transfer/output.mjs', import.meta.url), 'utf8');
  sources.port = sources.port.replace("'/assets/transfer-output.js'", "'output'");
  const entry = `
    import 'clock';
    import * as adapter from 'adapter';
    import * as recovered from 'component';
    import {createMotionPort} from 'port';
    const params=new URL(location.href).searchParams;
    const channel=new URLSearchParams(location.hash.slice(1)).get('channel');
    const config=${JSON.stringify({motion:component.contract.defaults,unitScale:intent.unitScale,parentMessages:false})};
    if(params.get('test')==='1'&&params.has('scale')) {
      const scale=Number(params.get('scale'));
      if(!Number.isFinite(scale)||scale<=0||scale>2)throw Error('Invalid fixture scale');
      config.unitScale=scale;
    }
    ${original ? '' : 'window.motionPort=createMotionPort(adapter,recovered,config);'}
    window.addEventListener('message',event=>{
      if(event.source!==parent||!channel||event.data?.channel!==channel)return;
      if(event.data.type==='dash'&&typeof event.data.pressed==='boolean')window.motionPort?.setDash(event.data.pressed);
      if(event.data.type==='turn'&&typeof event.data.pressed==='boolean')document.dispatchEvent(new KeyboardEvent(event.data.pressed?'keydown':'keyup',{code:'Space',key:' ',bubbles:true}));
    });
    window.onLoad(); window.pakuReady=true;
    if(params.get('test')!=='1')window.gameClock.start();
    setInterval(()=>{
      if(!channel)return;
      const state=window.pakuSnapshot();
      parent.postMessage({type:'motion-status',channel,status:state.status,isReplaying:state.isReplaying,motion:state.motion},'*');
    },80);
  `;
  const bundle = await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'remix-frame.js'},
    bundle:true,format:'iife',platform:'browser',target:'es2022',write:false,logLevel:'silent',
    plugins:[{name:'frozen-remix-modules',setup(builder){
      builder.onResolve({filter:/.*/},args=>Object.hasOwn(sources,args.path)
        ? {path:args.path,namespace:'remix'} : {errors:[{text:'Unexpected remix import'}]});
      builder.onLoad({filter:/.*/,namespace:'remix'},args=>({contents:sources[args.path],loader:'js'}));
    }}],
  });
  const scripts = [recipient.sound, clockedPakuRuntime(recipient.runtime),
    (original ? recipient.source : hookedPakuSource(recipient.source)) + '\n' + pakuObservationSource(), bundle.outputFiles[0].text];
  // The pinned sound synthesizer constructs oscillator functions at runtime.
  // Eval is confined to this opaque iframe; networking and parent DOM access stay blocked.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; base-uri 'none'; form-action 'none'"><title>PAKU PAKU remix</title><style>body{margin:0;overflow:hidden;background:#101010}canvas{image-rendering:pixelated}</style></head><body>${scripts.map(source=>`<script>${inline(source)}</script>`).join('')}</body></html>`;
}
