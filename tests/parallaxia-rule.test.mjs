import assert from 'node:assert/strict';
import test from 'node:test';
import { readRuleSource } from '../src/parallaxia/rule.mjs';
import { evaluateParallaxiaAdapter } from '../src/evaluator/parallaxia.mjs';
import { verifyParallaxiaBrowser } from '../src/evaluator/parallaxia-browser.mjs';
import { loadPinnedComponent } from '../src/hosting/component-load.mjs';
import { ACCEPTED_COMPONENT_ID } from '../src/hosting/component-pin.mjs';
import { roadsterAdapterFixture } from './helpers/roadster-adapter.mjs';
const ruleSource='export default {"event":"dash-end","action":"native-shot","delayTicks":1};';
const intent={unitScale:0.1,activation:'held',direction:'facing'};

test('composition only accepts a declarative next-tick native shot or removal',()=>{
 assert.equal(readRuleSource('export default null;'),null);
 assert.equal(readRuleSource(ruleSource).action,'native-shot');
 for(const source of ['export default {"event":"dash-end","action":"native-shot","delayTicks":0};','export default {"event":"dash-end","action":"change-lives","delayTicks":1};','export default (()=>{globalThis.parallaxiaChallengeShield=true})()'])assert.throws(()=>readRuleSource(source),/Only|declarative/);
});

test('composition keeps component timing, schedules once, honors native limits and resets',async()=>{
 const component=await loadPinnedComponent(ACCEPTED_COMPONENT_ID),source=roadsterAdapterFixture(intent);
 const report=await evaluateParallaxiaAdapter(source,intent,{componentRef:component,ruleSource});
 assert.equal(report.passed,true,JSON.stringify(report.results.filter(result=>!result.passed)));
 assert.equal(report.componentId,ACCEPTED_COMPONENT_ID);
 assert.ok(report.results.find(result=>result.name==='composition-honors-projectile-cap-and-native-cooldown')?.passed);
 const off=await evaluateParallaxiaAdapter(source,intent,{componentRef:component,ruleSource:'export default null;'});
 assert.equal(off.passed,true);
 const browser=await verifyParallaxiaBrowser(source,intent,{componentRef:component,ruleSource});
 assert.equal(browser.passed,true,JSON.stringify(browser.results.filter(result=>!result.passed)));
 assert.equal(browser.environment.composition.delayTicks,1);
});

test('a pending next-tick shot survives browser checkpoint reconstruction without duplication',async()=>{
 const {createServer}=await import('node:http'),{chromium}=await import('playwright'),vm=await import('node:vm');
 const {buildParallaxiaFrame}=await import('../src/parallaxia/build.mjs'),{compileAdapter}=await import('../src/transfer/adapter.mjs');
 const {reconstructCheckpoint}=await import('../src/parallaxia/experiment.mjs'),{digest}=await import('../src/component/build.mjs');
 const reference=await loadPinnedComponent(ACCEPTED_COMPONENT_ID),source=roadsterAdapterFixture(intent);
 const built=await buildParallaxiaFrame({source,intent,componentRef:reference,ruleSource});
 const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':'sandbox allow-scripts'});res.end(built.html);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/?test=1');await page.waitForFunction(()=>window.roadsterReady);
  const checkpoint=await page.evaluate(async()=>{roadsterStart(false);roadsterAdvance(40,{driver:0,dash:false});roadsterAdvance(1,{driver:0,dash:true});roadsterAdvance(7,{driver:0,dash:false});return parallaxiaCaptureCheckpoint();});
  assert.equal(checkpoint.ruleId,digest(ruleSource));
  const compiled=await compileAdapter(source,{componentRef:reference});const pkg=new vm.Script(`${compiled.componentCode}\n${compiled.code}\n({component:recovered,adapter:candidate})`).runInNewContext(Object.create(null));
  const run=await reconstructCheckpoint({checkpoint,identity:{ruleId:digest(ruleSource),componentId:ACCEPTED_COMPONENT_ID,recipientRevision:built.environment.recipientRevision,hooksSha256:built.environment.recipient.hooksSha256,adapterSha256:digest(source)},...pkg,defaults:compiled.defaults,intent,rule:readRuleSource(ruleSource)});
  assert.equal(run.sim.motionRule.attempts,0);assert.notEqual(run.sim.motionRule.pendingFrame,null);
  run.engine.stepSim(run.sim,0);assert.equal(run.sim.motionRule.fired,1);run.engine.stepSim(run.sim,0);assert.equal(run.sim.motionRule.fired,1);
  const observed=await page.evaluate(()=>roadsterAdvance(1,{driver:0,dash:false}).game.rule);assert.equal(observed.fired,1);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
