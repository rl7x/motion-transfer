import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectRelease } from '../release/collect.mjs';
import { publishRelease } from '../release/publish.mjs';
import { auditDirectory } from '../release/audit.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readTaskManifest } from '../benchmark/live-mechanics.mjs';
import { loadSavedRoadster } from '../roadster/saved.mjs';
import { digest } from '../component/build.mjs';

test('the task manifest freezes nine positive tasks and one infeasible case within existing quotas',async()=>{
 const {manifest}=await readTaskManifest();
 for(const session of ['a','b','c','d'])assert.equal(manifest.tasks.filter(task=>task.session===session).length,2);
 assert.equal(manifest.scenario.noAddedInvulnerability,true);assert.equal(manifest.scenario.nativeControls[0][1],manifest.scenario.horizonTicks);
 const negative=manifest.tasks.find(task=>task.kind==='negative');assert.equal(negative.target.minX,100);assert.deepEqual(negative.expectedStatuses,['unsuccessful','unsupported']);
});

test('PARALLAXIA release preserves real frames, labels baseline reuse, cold-starts exact ZIPs and detects tampering',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'parallaxia-release-'));const target=join(directory,'site');
 try{
  const old=await loadSavedRoadster();const oldSha=digest(old.files['frame.html']);
  const release=await collectRelease({recipient:'parallaxia',reuseBaseline:true});
  assert.equal(release.recipient.id,'parallaxia');assert.equal(release.versions[0].origin,'reuse');
  const manifest=await publishRelease(target,release,{verify:async directory=>{
    const {stdout}=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../scripts/verify-release.mjs',import.meta.url)),'--root',directory],{timeout:90000});
    const result=JSON.parse(stdout);assert.equal(result.passed,true);assert.equal(result.verification.kind,'parallaxia-clean-start-release');
  }});
  assert.equal(manifest.recipient.id,'parallaxia');assert.equal(manifest.componentId,release.componentId);
  assert.equal(digest(await readFile(join(target,'roadster/artifacts',old.id,'play.html'))),oldSha);
  const frame=join(target,manifest.versions[0].frame);await writeFile(frame,(await readFile(frame))+'\nchanged');
  await assert.rejects(()=>auditDirectory(target),/frame.html/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
