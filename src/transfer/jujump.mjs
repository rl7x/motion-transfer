import { repositoryUrl } from '../paths.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileAdapter } from './adapter.mjs';
import { digest } from '../component/build.mjs';
import { loadJujump } from '../recipients/jujump/load.mjs';

export const JUJUMP_POLICY = Object.freeze({tickRate:60,seed:9,unitScale:0.5,sourceBodyWidth:8,
  horizontal:'Use the frozen dash horizontal displacement; retain JUJUMP velocity when inactive',
  vertical:'JUJUMP gravity, jump strength and vertical velocity remain active during a dash',
  collision:'Sweep active motion in at most one-pixel increments; retain upward platform overlap resolution and velocity reset; no new edge clamp',
  authorship:'Human-authored adapter and host hooks; unchanged Meta-recovered component',liveEdits:[]});

export async function loadJujumpAdapter() {
  const root=new URL('../../assets/transfers/jujump/',import.meta.url);
  const source=await readFile(new URL('adapter.ts',root),'utf8'),javascript=await readFile(new URL('adapter.js',root),'utf8');
  const compiled=await compileAdapter(source);
  assert.equal(javascript,compiled.javascript,'JUJUMP adapter build mismatch');
  return {source,...compiled};
}

export async function jujumpEnvironment() {
  const recipient=await loadJujump(),files={};
  for(const path of ['runtime/jujump-browser.mjs','web/jujump-boot.js','web/clock.js','web/port.js','runtime/paku-browser.mjs','transfer/output.mjs']) {
    files[path]=digest(await readFile(repositoryUrl(path)));
  }
  return {recipientRevision:recipient.manifest.revision,sourceSha256:digest(recipient.source),
    runtimeSha256:digest(recipient.runtime),soundSha256:digest(recipient.sound),files,policy:JUJUMP_POLICY};
}

export async function loadJujumpTransfer({allowUnverified=false}={}) {
  const adapter=await loadJujumpAdapter();
  if(allowUnverified)return{...adapter,verified:false};
  let report;
  try{report=JSON.parse(await readFile(new URL('../../assets/transfers/jujump/verification.json',import.meta.url),'utf8'));}
  catch(error){if(error.code==='ENOENT')return allowUnverified?{...adapter,verified:false}:null;throw error;}
  assert.equal(report.passed,true);assert.equal(report.componentId,adapter.componentId);
  assert.equal(report.sourceSha256,adapter.sourceSha256);assert.equal(report.javascriptSha256,adapter.javascriptSha256);
  assert.deepEqual(report.environment,await jujumpEnvironment(),'JUJUMP verification is stale');
  assert.ok(report.browser.results.length>=6&&report.browser.results.every(result=>result.passed));
  assert.equal(report.conformance.passed,true);
  return {...adapter,verified:true,report,id:digest(JSON.stringify(report))};
}
