import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { transform } from 'esbuild';
import { loadTarget } from '../agent/target.mjs';

const require = createRequire(import.meta.url);
const escapeScript = source => source.replace(/<\/script/gi, '<\\/script');

export async function buildDonorFrame() {
  const target = await loadTarget();
  const root = dirname(require.resolve('wasm4/package.json'));
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (metadata.version !== '2.7.1') throw Error('Donor player requires pinned WASM-4 2.7.1');
  const runtime = await readFile(join(root, 'assets/runtime/slim/wasm4.js'), 'utf8');
  const css = await readFile(join(root, 'assets/runtime/slim/wasm4.css'), 'utf8');
  const observer = await transform(await readFile(new URL('../runtime/donor-observation.mjs', import.meta.url), 'utf8'),
    {format:'iife',globalName:'donorObserver',target:'es2022'});
  const cart = require('wasm4/lib/utils/z85').encode(target.bytes);
  const bridge = `
    (async()=>{
      const channel=new URLSearchParams(location.hash.slice(1)).get('channel');
      const app=document.querySelector('wasm4-app');
      for(let tries=0;!app?.runtime?.wasm&&tries<500;tries++)await new Promise(resolve=>setTimeout(resolve,10));
      if(!app?.runtime?.wasm)throw Error('Donor cartridge did not load');
      let tick=0,pendingRelease=0;
      const baseUpdate=app.runtime.update.bind(app.runtime);
      app.runtime.update=(...args)=>{
        const result=baseUpdate(...args);
        app.inputState.gamepad[0]&=~pendingRelease;pendingRelease=0;
        return result;
      };
      const style=document.createElement('style');
      style.textContent='wasm4-virtual-gamepad{display:none!important}.content{top:0!important;left:50%!important;transform:translateX(-50%);width:min(100vw,100vh)!important;height:min(100vw,100vh)!important}';
      app.shadowRoot.append(style);
      const actions={dash:1,left:16,right:32,up:64,down:128};
      const set=(button,pressed)=>{
        const mask=actions[button];if(!mask)return;
        if(pressed){pendingRelease&=~mask;app.inputState.gamepad[0]|=mask;}
        else pendingRelease|=mask; // A short touch must reach at least one 60 Hz update.
      };
      window.addEventListener('message',event=>{
        if(event.source===parent&&channel&&event.data?.channel===channel&&event.data.type==='donor-control'
          &&typeof event.data.pressed==='boolean')set(event.data.button,event.data.pressed);
      });
      window.addEventListener('blur',()=>{app.inputState.gamepad[0]=0;pendingRelease=0;});
      window.donorSnapshot=()=>{
        try{return{status:'playing',...donorObserver.observeDonorMotion({data:app.runtime.data,frame:tick,provenance:{cartridgeSha256:${JSON.stringify(target.sha256)}}})};}
        catch{return{status:'title'};}
      };
      if(new URL(location.href).searchParams.get('test')==='1')window.donorInput=()=>({buttons:app.inputState.gamepad[0],pendingRelease});
      if(new URL(location.href).searchParams.get('test')==='1')window.donorAdvance=(count=1)=>{
        for(let i=0;i<count;i++){app.runtime.setGamepad(0,app.inputState.gamepad[0]);app.runtime.update();tick++;}
        app.runtime.composite();return window.donorSnapshot();
      };
      setInterval(()=>{if(channel)parent.postMessage({type:'donor-status',channel,state:window.donorSnapshot()},'*');},100);
      window.donorReady=true;
    })();
  `;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashy Dango · compiled donor</title><style>${css}</style><script>if(new URL(location.href).searchParams.get('test')==='1')window.requestAnimationFrame=()=>0;</script></head><body><script id="wasm4-cart-json" type="application/json">${JSON.stringify({WASM4_CART:cart,WASM4_CART_SIZE:target.bytes.length})}</script><script id="wasm4-disk-prefix" type="text/plain">motion-transfer-donor</script><script>${escapeScript(runtime)}</script><wasm4-app></wasm4-app><script>${escapeScript(observer.code+bridge)}</script></body></html>`;
}
