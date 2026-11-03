import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from '../component/build.mjs';
import { readParallaxiaArtifact, loadParallaxiaBaseline, PARALLAXIA_STORE } from '../parallaxia/artifact.mjs';
import { buildParallaxiaChallenge } from '../parallaxia/challenge.mjs';
import { loadSavedRoadster } from '../roadster/saved.mjs';
import { acceptedJujumpComparison } from './accepted.mjs';
import { buildFrontend } from '../web/build.mjs';
import { buildDonorFrame } from '../web/donor-frame.mjs';
import { normalizePublicOrigin } from './share.mjs';

function taskMeasurements(report, componentId) {
  assert.equal(report.kind, 'frozen-live-mechanics-task-run');
  assert.equal(report.fixture, false, 'Release task evidence must be a measured run');
  assert.equal(report.taskManifest.componentId, componentId);
  assert.match(report.codeCommit, /^[a-f0-9]{40}$/);
  assert.match(report.taskManifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(report.tasks.length, report.taskManifest.tasks.length);
  const tasks = report.tasks.map(task => {
    const definition = report.taskManifest.tasks.find(item => item.id === task.id);
    assert.ok(definition && definition.kind === task.kind);
    const created = task.job ? Date.parse(task.job.createdAt) : null;
    return {
      id: task.id, kind: task.kind, passed: task.passed === true,
      responses: task.attempts?.length ?? 0,
      firstResponseMs: task.attempts?.length ? Date.parse(task.attempts[0].finishedAt) - created : null,
      jobWallMs: task.job ? Date.parse(task.job.finishedAt) - created : null,
      wallMs: task.wallMs, estimatedCostUsd: task.job?.estimatedCostUsd ?? 0,
    };
  });
  return {
    codeCommit: report.codeCommit, taskManifestSha256: report.taskManifestSha256,
    positive: {passed:tasks.filter(task=>task.kind==='positive'&&task.passed).length,total:tasks.filter(task=>task.kind==='positive').length},
    negative: {correct:tasks.filter(task=>task.kind==='negative'&&task.passed).length,total:tasks.filter(task=>task.kind==='negative').length},
    estimatedCostUsd: tasks.reduce((sum,task)=>sum+task.estimatedCostUsd,0),
    observedRepairBenefits: report.observedRepairBenefits, tasks,
  };
}

/** Read exact worker-published bytes. This release builder never recompiles a generated adapter. */
export async function readHostedPublication(directory, id) {
  assert.match(id, /^[a-f0-9]{64}$/);
  const files = {};
  const entries = await readdir(join(directory, 'artifacts', id), { withFileTypes: true });
  for (const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
    assert.ok(entry.isFile() && !entry.isSymbolicLink()); assert.match(entry.name,/^[a-z0-9.-]+$/);
    files[entry.name] = await readFile(join(directory,'artifacts',id,entry.name));
  }
  assert.equal(digest(JSON.stringify(Object.entries(files).map(([name, bytes])=>[name,digest(bytes)]))),id,'Hosted artifact identity mismatch');
  const receipt=JSON.parse(files['receipt.json']);
  assert.equal(receipt.recipient.id,'parallaxia');
  assert.equal(receipt.componentId,'544657417fe9752f91b0b72a451cd9cb8d2650839824be35881e52f81f223858');
  for(const report of [receipt.native,receipt.browser]) {
    assert.equal(report.passed,true);assert.equal(report.executedIn,'worker');assert.equal(report.uid,10001);
    assert.equal(report.recipientId,'parallaxia');assert.equal(report.componentId,receipt.componentId);
    assert.equal(report.sourceSha256,digest(files['adapter.ts']));assert.ok(report.checks.length>0&&report.checks.every(check=>check.passed));
  }
  assert.equal(receipt.browser.frameSha256,digest(files['play.html']));assert.equal(receipt.frameSha256,digest(files['play.html']));
  assert.equal(receipt.browser.environment.collisionPolicy,'native');assert.equal(receipt.browser.environment.addedDashInvulnerability,false);
  assert.equal(receipt.browser.environment.ruleId??null,receipt.rule?.id??null);
  if(receipt.rule?.id)assert.equal(digest(files['rule.mjs']),receipt.rule.id);
  const component=JSON.parse(files['component.json']);assert.equal(component.id,receipt.componentId);
  return {id,files,receipt};
}

export async function collectParallaxiaRelease({ liveDirectory, featuredId, baselineId = null, publicOrigin = null, taskEvidence = null, reuseBaseline = false } = {}) {
  if(!reuseBaseline&&(!liveDirectory||!featuredId))throw Error('A real PARALLAXIA live directory and featured artifact are required');
  if(reuseBaseline&&(liveDirectory||featuredId))throw Error('Explicit baseline reuse does not take a generated artifact');
  const publications=[];
  for(const id of (liveDirectory?await readdir(join(liveDirectory,'artifacts')):[]).filter(id=>/^[a-f0-9]{64}$/.test(id)).sort())publications.push(await readHostedPublication(liveDirectory,id));
  const featured=publications.find(item=>item.id===featuredId);
  if(!reuseBaseline){assert.ok(featured,'Featured PARALLAXIA publication is missing');assert.equal(featured.receipt.passed,true,'An unsuccessful experiment cannot be the featured release');assert.notEqual(featured.receipt.experiment?.satisfied,false,'An unsuccessful experiment cannot be featured');baselineId??=featured.receipt.parentChain[0];}
  const baseline=reuseBaseline?await loadParallaxiaBaseline():await readParallaxiaArtifact(PARALLAXIA_STORE.pathname,baselineId);
  if(featured)assert.equal(baseline.componentId,featured.receipt.componentId);else featuredId=baseline.id;
  const component=baseline.component,versions=[];
  const version=(id,files,receipt,kind,parentArtifactId)=>({id,kind,parentArtifactId,componentId:baseline.componentId,intent:receipt.intent??baseline.intent,
    frame:files['play.html']??files['frame.html'],notices:files['notices.txt'],adapter:files['adapter.ts'],
    evidenceBytes:files['receipt.json']??files['verification.json'],evidenceName:'verification.json',
    title:kind==='parallaxia-unsuccessful-experiment'?'Goal unsatisfied · diagnostic artifact':kind==='parallaxia-reuse'?'Verified accepted-component reuse':'Saved verified PARALLAXIA child',
    receipt,originalFiles:files,origin:kind==='parallaxia-reuse'?'reuse':'new-meta-generation'});
  versions.push(version(baseline.id,baseline.files,JSON.parse(baseline.files['verification.json']),'parallaxia-reuse',null));
  for(const item of publications)versions.push(version(item.id,item.files,item.receipt,item.receipt.experiment&&!item.receipt.experiment.satisfied?'parallaxia-unsuccessful-experiment':'parallaxia-child',item.receipt.parentArtifactId));
  const practice=await buildParallaxiaChallenge({parent:baseline});
  const roadster=await loadSavedRoadster(),comparison=await acceptedJujumpComparison(baseline.componentId);
  const extras={...comparison.extras,'donor/play':await buildDonorFrame(),
    [`roadster/artifacts/${roadster.id}/play.html`]:roadster.files['frame.html'],
    [`roadster/artifacts/${roadster.id}/report.json`]:roadster.files['verification.json'],
    [`roadster/artifacts/${roadster.id}/adapter.ts`]:roadster.files['adapter.ts'],
    [`roadster/artifacts/${roadster.id}/notices.txt`]:roadster.files['notices.txt']};
  for(const [name,bytes]of Object.entries(practice.files))extras[`parallaxia/challenge/${baseline.id}/${name==='challenge.json'?'report.json':name}`]=bytes;
  extras[`parallaxia/challenge/${baseline.id}/download.html`]=practice.files['play.html'];
  const base={id:baseline.id,componentId:baseline.componentId,componentRef:baseline.componentRef,intent:baseline.intent,recipient:baseline.recipient,provenance:baseline.provenance,
    play:`/parallaxia/artifacts/${baseline.id}/play.html`,download:`/parallaxia/artifacts/${baseline.id}/download.html`,report:`/parallaxia/artifacts/${baseline.id}/report.json`,
    practice:`/parallaxia/challenge/${baseline.id}/play.html`,practiceId:practice.id,practiceDownload:`/parallaxia/challenge/${baseline.id}/download.html`,practiceReport:`/parallaxia/challenge/${baseline.id}/report.json`,
    historicalRoadster:`/roadster/artifacts/${roadster.id}/play.html`};
  const resources={'/api/parallaxia/base':base,'/api/ability':{id:baseline.componentId,name:'Dash',status:'accepted-recovery'},
    '/api/destinations':{destinations:[{id:'parallaxia',componentId:baseline.componentId},{id:'jujump',componentId:baseline.componentId}]},
    '/api/transfer':{status:'playback-only'},'/api/lab/status':{enabled:false},'/api/remixes/status':{enabled:false,generationConfigured:false}};
  for(const item of publications){resources[`/artifacts/${item.id}/receipt.json`]=item.receipt;resources[`/artifacts/${item.id}`]=item.receipt;}
  if(taskEvidence) {
    const evidence = await readFile(taskEvidence);
    extras['evidence/live-mechanics-tasks.json'] = evidence;
    resources['/api/live-mechanics/results'] = taskMeasurements(JSON.parse(evidence), baseline.componentId);
  }
  return {recipient:{id:'parallaxia',revision:baseline.recipient.revision},publicOrigin:normalizePublicOrigin(publicOrigin),recovery:'accepted',componentId:baseline.componentId,
    component,featuredId,remixChain:featured?[...featured.receipt.parentChain,featuredId]:[baseline.id],warnings:['Static playback copy; creation is unavailable. Saved Meta results are reuse. Practice uses a shield and makes no survival claim.'],
    versions,baseline,base,resources,jujumpComparison:'/jujump/index.html',extras,shell:{appJs:await buildFrontend(),css:await readFile(new URL('../web/style.css',import.meta.url),'utf8')},liveDirectory};
}
