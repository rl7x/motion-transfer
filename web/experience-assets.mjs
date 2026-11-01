import { readFile } from 'node:fs/promises';
import { loadRecoveredMotion } from '../component/load.mjs';
import { loadJujump } from '../recipients/jujump/load.mjs';
import { loadJujumpTransfer, JUJUMP_POLICY } from '../transfer/jujump.mjs';
import { hookedJujumpSource, jujumpObservationSource } from '../runtime/jujump-browser.mjs';
import { buildDonorFrame } from './donor-frame.mjs';

export async function experienceAssets({allowUnverified=false,adapter}={}) {
  const component=await loadRecoveredMotion(),recipient=await loadJujump(),jujump=await loadJujumpTransfer({allowUnverified});
  const assets=new Map();
  const json=(path,data)=>assets.set(path,['application/json',JSON.stringify(data)]);
  assets.set('/donor/play',['text/html',await buildDonorFrame()]);
  assets.set('/assets/jujump-game.js',['text/javascript',recipient.source+'\n'+jujumpObservationSource()]);
  assets.set('/assets/jujump-game-transfer.js',['text/javascript',hookedJujumpSource(recipient.source)+'\n'+jujumpObservationSource()]);
  assets.set('/assets/jujump-boot.js',['text/javascript',await readFile(new URL('jujump-boot.js',import.meta.url),'utf8')]);
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>JUJUMP</title><style>body{margin:0;overflow:hidden;background:#101010}canvas{image-rendering:pixelated}</style><script src="/assets/clock.js"></script><script src="/assets/sound.js"></script><script src="/assets/runtime.js"></script><script src="/assets/jujump-game.js"></script><script type="module" src="/assets/jujump-boot.js"></script></head><body></body></html>`;
  assets.set('/jujump/play',['text/html',html]);
  if(jujump){
    assets.set('/assets/jujump-adapter.js',['text/javascript',jujump.javascript]);
    assets.set('/jujump/play-transfer',['text/html',html.replace('/assets/jujump-game.js','/assets/jujump-game-transfer.js')]);
    assets.set('/jujump/adapter.ts',['text/plain',jujump.source]);
    if(jujump.verified)json('/jujump/report.json',jujump.report);
  }
  assets.set('/jujump/licenses',['text/plain',recipient.licenses.join('\n\n----------------\n\n')]);
  const destinations=[];
  if(adapter?.receipt)destinations.push({id:'paku-paku',name:'PAKU PAKU',kind:'A one-dimensional maze',componentId:component.provenance.id,
    before:'/play?mode=original',after:'/play?mode=transfer',artifactId:adapter.receipt.id,aspect:2,
    keeps:'Turning, pellets, ghosts, power cookies, and wraparound.',carries:'The same eight-tick dash and recharge, mapped to 30 lane pixels.',
    control:'Tap or Space to turn. Hold D to dash.',action:'Start / turn',liveEdits:['distance','activation','direction'],
    report:'/artifact/browser.json',source:'/artifact/adapter.ts',author:'Meta-generated adapter; human-built host hooks'});
  if(jujump?.verified)destinations.push({id:'jujump',name:'JUJUMP',kind:'A platformer with gravity',componentId:component.provenance.id,
    before:'/jujump/play?mode=original',after:'/jujump/play?mode=transfer',artifactId:jujump.id,aspect:1,
    keeps:'Gravity, weakening air jumps, platform landing, and scrolling.',carries:'The same eight-tick dash and recharge, mapped to 30 horizontal pixels. You keep falling while dashing.',
    control:'Tap or Space to jump and change direction. Hold D to dash.',action:'Start / jump',liveEdits:[],
    report:'/jujump/report.json',source:'/jujump/adapter.ts',author:JUJUMP_POLICY.authorship});
  json('/api/destinations',{componentId:component.provenance.id,destinations});
  json('/api/ability',{id:component.provenance.id,name:'Dash',status:'saved-recovery',provenance:component.provenance,contract:component.contract});
  json('/component/export',{source:component.source,javascript:component.javascript,contract:component.contract,provenance:component.provenance});
  try{
    const comparison=JSON.parse(await readFile(new URL('../transfers/comparison.json',import.meta.url),'utf8'));
    if(comparison.componentId!==component.provenance.id||!comparison.passed)throw Error('Comparison identity mismatch');
    if(adapter?.receipt&&comparison.adapters.paku!==adapter.sourceSha256)throw Error('PAKU comparison source is stale');
    if(jujump?.verified&&comparison.adapters.jujump!==jujump.sourceSha256)throw Error('JUJUMP comparison source is stale');
    json('/evidence/transfer-comparison.json',comparison);
  }catch(error){if(error.code!=='ENOENT')throw error;}
  for(const name of ['provenance','contract','evidence','evaluation-development','evaluation-regressions','evaluation-acceptance','recovery-history']){
    assets.set(`/evidence/${name}.json`,['application/json',await readFile(new URL(`../components/dashy-dango-dash/${name}.json`,import.meta.url),'utf8')]);
  }
  return assets;
}
