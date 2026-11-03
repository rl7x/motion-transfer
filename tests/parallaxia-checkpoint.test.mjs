import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { loadPinnedComponent } from '../hosting/component-load.mjs';
import { ACCEPTED_COMPONENT_ID } from '../hosting/component-pin.mjs';
import { compileAdapter } from '../transfer/adapter.mjs';
import { loadParallaxiaSim } from '../parallaxia/sim.mjs';
import {installParallaxiaRule} from '../parallaxia/rule.mjs';
import { createParallaxiaPort } from '../parallaxia/port.mjs';
import { parallaxiaDescriptor } from '../parallaxia/recipient.mjs';
import { buildParallaxiaFrame } from '../parallaxia/build.mjs';
import { captureCheckpoint, expandInputs, replayDigest, checkpointState } from '../parallaxia/replay.mjs';
import { compareExperiment, reconstructCheckpoint } from '../parallaxia/experiment.mjs';
import { roadsterAdapterFixture } from './helpers/roadster-adapter.mjs';
import { digest } from '../component/build.mjs';
const intent = { unitScale: 0.1, activation: 'held', direction: 'facing' };
const scenario = { target: { minX: 5.5, maxX: 6.5, minY: -11, maxY: -7 }, horizonTicks: 120,
  nativeControls: [[16,120]], collisionPolicy:'native',noAddedInvulnerability:true,preserveEnemyRules:true,preserveNativeMovement:true,
  allowedChanges:['unitScale','activation','direction','dashTick'] };
async function fixture() {
  const reference=await loadPinnedComponent(ACCEPTED_COMPONENT_ID),source=roadsterAdapterFixture(intent);
  const compiled=await compileAdapter(source,{componentRef:reference});
  const {component,adapter}=new vm.Script(`${compiled.componentCode}\n${compiled.code}\n({component:recovered,adapter:candidate})`).runInNewContext(Object.create(null));
  const recipient=await parallaxiaDescriptor(),engine=await loadParallaxiaSim();
  const identity={componentId:ACCEPTED_COMPONENT_ID,recipientRevision:recipient.revision,hooksSha256:recipient.hooksSha256,adapterSha256:digest(source)};
  installParallaxiaRule(null,engine);
  const port=createParallaxiaPort({component,adapter,defaults:compiled.defaults,intent});
  globalThis.roadsterPort=port;globalThis.parallaxiaChallengeShield=false;
  const sim=engine.createSim({seed:7});for(let i=0;i<40;i++)engine.stepSim(sim,0);
  const checkpoint=await captureCheckpoint({sim,port,inputs:Array(40).fill(0),identity});
  return {reference,source,component,adapter,defaults:compiled.defaults,identity,checkpoint};
}

test('checkpoint replay keeps exact native, RNG, timers and edges; fixed goals include a real failure',async()=>{
  const data=await fixture();
  try {
    const run=await reconstructCheckpoint({...data,intent}); assert.equal(run.stateDigest,data.checkpoint.stateDigest);
    const branch={adapter:data.adapter,defaults:data.defaults,intent};
    const report=await compareExperiment({...data,scenario,parent:branch,candidate:branch,interventionTick:0});
    assert.equal(report.original.succeeded,false);assert.equal(report.candidate.succeeded,true);
    assert.equal(report.candidate.lostLife,false);assert.equal(report.firstDifferenceTick,1);
    assert.equal(report.original.startingDigest,report.candidate.startingDigest);
    const impossible={...scenario,target:{minX:100,maxX:101,minY:-11,maxY:-7}};
    const failed=await compareExperiment({...data,scenario:impossible,parent:branch,candidate:branch,interventionTick:0});
    assert.equal(failed.satisfied,false);assert.deepEqual(failed.scenario,impossible);
    await assert.rejects(()=>reconstructCheckpoint({...data,intent,checkpoint:{...data.checkpoint,stateDigest:'ab'.repeat(32)}}),/digest differs/);
    assert.throws(()=>expandInputs([[0,Number.MAX_SAFE_INTEGER]]),/oversized/);
    assert.throws(()=>expandInputs([[0,-1]]),/oversized/);
  } finally { delete globalThis.roadsterPort;delete globalThis.parallaxiaChallengeShield; }
});

test('a real browser checkpoint reconstructs to the same digest in the verifier',async()=>{
  const data=await fixture();const built=await buildParallaxiaFrame({source:data.source,intent,componentRef:data.reference});
  const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':'sandbox allow-scripts'});res.end(built.html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});const page=await browser.newPage();
    await page.goto('http://127.0.0.1:'+server.address().port+'/?test=1');await page.waitForFunction(()=>window.roadsterReady);
    const checkpoint=await page.evaluate(async()=>{roadsterStart(false);roadsterAdvance(40,{driver:0,dash:false});return parallaxiaCaptureCheckpoint();});
    assert.equal(checkpoint.stateDigest,data.checkpoint.stateDigest);
    const reconstructed=await reconstructCheckpoint({...data,intent,checkpoint});
    assert.equal(await replayDigest(checkpointState(reconstructed.sim,reconstructed.port)),checkpoint.stateDigest);
    await page.reload();await page.waitForFunction(()=>window.roadsterReady);
    const repeat=await page.evaluate(async()=>{roadsterStart(false);roadsterAdvance(40,{driver:0,dash:false});return parallaxiaCaptureCheckpoint();});
    assert.equal(repeat.stateDigest,checkpoint.stateDigest);
  }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));delete globalThis.roadsterPort;delete globalThis.parallaxiaChallengeShield;}
});

test('generated movement adapters cannot install a hidden shield or a wall clock', async () => {
  const { assertParallaxiaSource }=await import('../evaluator/parallaxia-source.mjs');
  assert.throws(()=>assertParallaxiaSource('export function init(){globalThis.parallaxiaChallengeShield=true};export function step(){}'),/cannot access globalThis/);
  assert.throws(()=>assertParallaxiaSource('export function init(){return Date.now()};export function step(){}'),/cannot access Date/);
  assert.throws(()=>assertParallaxiaSource('export function init(){return Math.random()};export function step(){}'),/Nondeterministic/);
  assert.throws(()=>assertParallaxiaSource('export function init(value){return value["con"+"structor"]};export function step(){}'),/Dynamic/);
});
