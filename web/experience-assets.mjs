import { readFile } from 'node:fs/promises';
import { loadRecoveredMotion } from '../component/load.mjs';
import { loadJujump } from '../recipients/jujump/load.mjs';
import { loadJujumpTransfer, JUJUMP_POLICY } from '../transfer/jujump.mjs';
import { hookedJujumpSource, jujumpObservationSource } from '../runtime/jujump-browser.mjs';
import { buildDonorFrame } from './donor-frame.mjs';
import { loadSavedRoadster } from '../roadster/saved.mjs';
import { buildRoadsterFrame } from '../roadster/build.mjs';
import { savedInvestigations } from '../lab/saved.mjs';
import { integrationAssets } from '../integration/assets.mjs';

export async function experienceAssets({allowUnverified=false,adapter,roadster}={}) {
  if(roadster===undefined)roadster=await loadSavedRoadster({optional:true});
  const component=await loadRecoveredMotion(),recipient=await loadJujump(),jujump=await loadJujumpTransfer({allowUnverified});
  const assets=new Map();
  const json=(path,data)=>assets.set(path,['application/json',JSON.stringify(data)]);
  const recordings = await savedInvestigations();
  for(const record of recordings)json('/api/investigations/saved/'+record.id,record.job);
  json('/api/investigations/recordings', recordings.filter(record => record.job.request?.questionId === 'extraction')
    .map(({ id, title }) => ({ id, title })));
  assets.set('/evidence/experiment-benchmark.json',['application/json',await readFile(new URL('../lab/recordings/experiment-benchmark.json',import.meta.url),'utf8')]);
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
  if(jujump?.verified)for(const [path,asset]of await integrationAssets())assets.set(path,asset);
  assets.set('/jujump/licenses',['text/plain',recipient.licenses.join('\n\n----------------\n\n')]);
  const destinations=[];
  if(roadster){
    const transferFrame={html:roadster.files['frame.html']};
    assets.set('/roadster/play',['text/html',(await buildRoadsterFrame()).html]);
    assets.set('/roadster/play-transfer',['text/html',transferFrame.html]);
    assets.set('/roadster/adapter.ts',['text/plain',roadster.files['adapter.ts']]);
    assets.set('/roadster/report.json',['application/json',roadster.files['verification.json']]);
    assets.set('/roadster/presentation.json',['application/json',await readFile(new URL('../transfers/roadster/presentation-evidence.json',import.meta.url),'utf8')]);
    assets.set('/roadster/notices',['text/plain',roadster.files['notices.txt']]);
    json('/api/roadster/base',{id:roadster.id,componentId:roadster.componentId,intent:roadster.intent,summary:roadster.summary,parentArtifactId:roadster.parentArtifactId});
    destinations.push({id:'roadster',name:'RDSTR Stunts',kind:'A historical driving transfer',componentId:component.provenance.id,before:'/roadster/play?mode=original&quality=low',after:'/roadster/play?mode=transfer&quality=low',artifactId:roadster.id,aspect:1.5,
      keeps:'Native driving, gravity, rotation, terrain and collision rules.',carries:'The same eight-update burst and recharge, mapped to horizontal driving world units.',control:'Run the stunt, then hold X for the recovered air dash.',action:'Run wave',dashKey:'X',liveEdits:['distance','activation','direction'],report:'/roadster/report.json',source:'/roadster/adapter.ts',author:'Meta-generated adapter; human-built host, presentation and verification; upstream attribution retained in the pinned notices'});
  }
  if(adapter?.receipt)destinations.push({id:'paku-paku',name:'PAKU PAKU',kind:'A one-dimensional maze',componentId:component.provenance.id,
    before:'/play?mode=original',after:'/play?mode=transfer',artifactId:adapter.receipt.id,aspect:2,
    keeps:'Turning, pellets, ghosts, power cookies, and wraparound.',carries:'A quick burst in your chosen direction, with the same duration and recharge as the donor.',
    control:'Tap or Space to turn. Hold D to dash.',action:'Start / turn',liveEdits:['distance','activation','direction'],
    report:'/artifact/browser.json',source:'/artifact/adapter.ts',author:'Meta-generated adapter; human-built host hooks'});
  if(jujump?.verified)destinations.push({id:'jujump',name:'JUJUMP',kind:'A platformer with gravity',componentId:component.provenance.id,
    before:'/jujump/play?mode=original',after:'/jujump/play?mode=transfer',artifactId:jujump.id,aspect:1,
    keeps:'Gravity, weakening air jumps, platform landing, and scrolling.',carries:'The same burst and recharge, now across the air. Gravity keeps pulling you down while you dash.',
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
