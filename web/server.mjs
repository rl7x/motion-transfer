import { addReplayToArchive } from '../src/hosting/export.mjs';
import { parseRemixBody } from '../src/hosting/policy.mjs';
import { zipStored } from '../src/release/zip.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { loadPakuPaku } from '../src/recipients/paku-paku/load.mjs';
import { clockedPakuRuntime, pakuObservationSource, hookedPakuSource } from '../src/runtime/paku-browser.mjs';
import { loadRecoveredMotion } from '../src/component/load.mjs';
import { loadPakuTransfer } from '../src/transfer/saved-paku.mjs';
import { PAKU_POLICY } from '../src/transfer/paku-policy.mjs';
import { experienceAssets } from './experience-assets.mjs';
import { loadSavedRoadster } from '../src/roadster/saved.mjs';
import { buildFrontend, buildExportedExperiment } from './build.mjs';
import { developerBenchmarkAssets } from '../src/benchmark/assets.mjs';
import { buildRoadsterChallenge } from '../src/roadster/challenge.mjs';
import { buildParallaxiaChallenge } from '../src/parallaxia/challenge.mjs';
import { loadParallaxiaBaseline } from '../src/parallaxia/artifact.mjs';
import { acceptedJujumpComparison } from '../src/release/accepted.mjs';
import { portedSite } from '../src/auto-port/publish.mjs';

export async function createPreviewServer({ port = 0, host = '127.0.0.1', adapter, remixes, lab, coordinator, allowUnverified = false, benchmarks = developerBenchmarkAssets() } = {}) {
  if (adapter === undefined) adapter = await loadPakuTransfer({ optional: true });
  const recipient = await loadPakuPaku();
  const recovered = await loadRecoveredMotion();
  const roadster=await loadSavedRoadster({optional:true});
  const replayScript=await buildExportedExperiment();
  const parallaxia=await loadParallaxiaBaseline();
  const challenges=new Map();
  const challengeFor=id=>{
    if(!challenges.has(id)){
      if(challenges.size>=24)challenges.delete(challenges.keys().next().value);
      challenges.set(id,(async()=>{
        const parent=id===roadster?.id?roadster:await lab?.artifact(id);
        if(!parent)throw Error('Roadster artifact not found');
        return buildRoadsterChallenge({parent});
      })().catch(error=>{challenges.delete(id);throw error;}));
    }
    return challenges.get(id);
  };
  const parallaxiaChallenge = await buildParallaxiaChallenge({parent:parallaxia});
  const assets = new Map([
    ['/assets/app.js', ['text/javascript', await buildFrontend()]],
    ['/assets/runtime.js', ['text/javascript', clockedPakuRuntime(recipient.runtime)]],
    ['/assets/sound.js', ['text/javascript', recipient.sound]],
    ['/assets/game.js', ['text/javascript', recipient.source + '\n' + pakuObservationSource()]],
    ['/assets/game-transfer.js', ['text/javascript', hookedPakuSource(recipient.source) + '\n' + pakuObservationSource()]],
    ['/assets/component.js', ['text/javascript', recovered.javascript]],
    ['/assets/transfer-output.js', ['text/javascript', await readFile(new URL('../src/transfer/output.mjs', import.meta.url), 'utf8')]],
    ['/api/transfer-config', ['application/json', JSON.stringify({ motion: recovered.contract.defaults, unitScale: PAKU_POLICY.unitScale, componentId: recovered.provenance.id })]],
    ['/api/transfer', ['application/json', JSON.stringify(adapter?.receipt ? {
      status: 'verified', id: adapter.receipt.id, componentId: recovered.provenance.id,
      model: adapter.receipt.model, estimatedGenerationCostUsd: adapter.receipt.estimatedGenerationCostUsd,
      conformanceChecks: adapter.conformance.results.length, browserChecks: adapter.browser.results.length,
      policy: PAKU_POLICY,
    } : { status: adapter ? 'candidate' : 'unavailable' })]],
    ['/licenses', ['text/plain', recipient.licenses.join('\n\n----------------\n\n')]],
    ['/api/recipient', ['application/json', JSON.stringify(recipient.manifest)]],
  ]);
  for(const [path,{type,bytes}] of Object.entries(await portedSite({component:parallaxia.component})))assets.set('/'+path,[type,bytes]);
  const acceptedJujump=await acceptedJujumpComparison(parallaxia.componentId);
  for(const [path,bytes] of Object.entries(acceptedJujump.extras)){
    const ext=path.split('.').at(-1),type=({html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',json:'application/json'})[ext]??'text/plain';
    assets.set('/accepted/'+path,[type,bytes]);
  }
  for(const [path,asset] of await experienceAssets({allowUnverified,adapter,roadster}))assets.set(path,asset);
  for (const [path, file, type] of [
    ['/', 'index.html', 'text/html'], ['/style.css', 'style.css', 'text/css'],
    ['/play', 'play.html', 'text/html'], ['/assets/clock.js', 'clock.js', 'text/javascript'],
    ['/assets/boot.js', 'boot.js', 'text/javascript'], ['/assets/port.js', 'port.js', 'text/javascript'],
  ]) assets.set(path, [type, await readFile(new URL(file, import.meta.url), 'utf8')]);
  if (adapter) {
    assets.set('/assets/adapter.js', ['text/javascript', adapter.javascript]);
    assets.set('/artifact/adapter.ts', ['text/plain', adapter.source]);
    assets.set('/artifact/component.ts', ['text/plain', recovered.source]);
    if (adapter.receipt) for (const key of ['receipt', 'conformance', 'browser']) {
      assets.set(`/artifact/${key}.json`, ['application/json', JSON.stringify(adapter[key], null, 2)]);
    }
  }
  const server = createServer(async (request, response) => {
    const send = (status, type, body) => {
      response.writeHead(status, { 'Content-Type': type + (Buffer.isBuffer(body) ? '' : '; charset=utf-8'), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    const json = (status, value) => send(status, 'application/json', JSON.stringify(value));
    try {
    const port = server.address().port;
    if (![`${host}:${port}`, `localhost:${port}`].includes(request.headers.host)) { json(403, {error:'Unrecognized preview host'}); return; }
    const url = new URL(request.url, 'http://localhost');
    const path = url.pathname;
    const hostedJob=path.match(/^\/api\/remixes\/([a-f0-9-]{36})(\/cancel)?$/);
    if(coordinator&&(path==='/api/catalog'||path==='/api/remixes/status'||path==='/api/remixes'||hostedJob)){
      if(request.method==='POST'){
        if(![`http://${host}:${port}`,`http://localhost:${port}`].includes(request.headers.origin)||request.headers['content-type']?.split(';')[0]!=='application/json'){json(403,{error:'A same-origin JSON request is required'});return;}
        let body='';for await(const chunk of request){body+=chunk;if(Buffer.byteLength(body)>4096){json(413,{error:'Request exceeds 4 KB'});return;}}
        if(hostedJob?.[2]){json(200,await coordinator.cancel(hostedJob[1],JSON.parse(body).sessionId));return;}
        if(path==='/api/remixes'){json(202,await coordinator.submit(parseRemixBody(JSON.parse(body))));return;}
      }
      if(!['GET','HEAD'].includes(request.method)){json(405,{error:'Method not allowed'});return;}
      if(path==='/api/catalog')json(200,await coordinator.catalog());
      else if(path==='/api/remixes/status')json(200,coordinator.status());
      else if(hostedJob)json(200,await coordinator.job(hostedJob[1]));
      else json(404,{error:'Not found'});
      return;
    }
    const hostedFile=path.match(/^\/artifacts\/([a-f0-9]{64})(?:\/(play\.html|adapter\.ts|adapter\.js|receipt\.json|generation\.json|experiment\.json|rule\.mjs|notices\.txt|download|download\.zip))?$/);
    if(coordinator&&hostedFile){
      const [,id,part]=hostedFile;
      let bytes;
      if(part==='download.zip'){
        const files={};for(const name of ['play.html','adapter.ts','adapter.js','intent.json','recipient.json','component.json','receipt.json','generation.json','experiment.json','rule.mjs','notices.txt']){const file=await coordinator.artifactFile(id,name);if(file)files[name]=file;}
        if(!files['receipt.json']){json(404,{error:'Artifact not found'});return;}
        const receipt=JSON.parse(files['receipt.json']);
        addReplayToArchive(files,{parentFrame:await coordinator.parentBytes(receipt.parentArtifactId),replayScript});
        bytes=zipStored(files);response.setHeader('Content-Disposition',`attachment; filename="parallaxia-${id.slice(0,12)}.zip"`);
      }else bytes=await coordinator.artifactFile(id,part==='download'?'play.html':part??'receipt.json');
      if(!bytes){json(404,{error:'Artifact not found'});return;}
      if(part==='play.html'||part==='download')response.setHeader('Content-Security-Policy','sandbox allow-scripts');
      if(part==='download')response.setHeader('Content-Disposition',`attachment; filename="parallaxia-${id.slice(0,12)}.html"`);
      send(200,part==='download.zip'?'application/zip':part==='play.html'||part==='download'?'text/html':part?.endsWith('.ts')||part?.endsWith('.txt')||part==='rule.mjs'?'text/plain':part?.endsWith('.js')?'text/javascript':'application/json',bytes);return;
    }
    const hostedParent=path.match(/^\/parents\/([a-f0-9]{64})(\/download)?$/);
    if(coordinator&&hostedParent){const bytes=await coordinator.parentBytes(hostedParent[1]);response.setHeader('Content-Security-Policy','sandbox allow-scripts');if(hostedParent[2])response.setHeader('Content-Disposition','attachment; filename="parent.html"');send(200,'text/html',bytes);return;}
    if(path==='/api/parallaxia/base'){json(200,{id:parallaxia.id,componentId:parallaxia.componentId,componentRef:parallaxia.componentRef,intent:parallaxia.intent,recipient:parallaxia.recipient,provenance:parallaxia.provenance,play:`/parallaxia/artifacts/${parallaxia.id}/play.html`,report:`/parallaxia/artifacts/${parallaxia.id}/report.json`,download:`/parallaxia/artifacts/${parallaxia.id}/download.html`,practice:`/parallaxia/challenge/${parallaxia.id}/play.html`,practiceId:parallaxiaChallenge.id,practiceDownload:`/parallaxia/challenge/${parallaxia.id}/download.html`,practiceReport:`/parallaxia/challenge/${parallaxia.id}/report.json`,historicalRoadster:`/roadster/artifacts/${roadster.id}/play.html`});return;}
    if(path==='/api/catalog'){json(200,{parents:[],artifacts:[],versions:[]});return;}
    const parallaxiaPath=path.match(/^\/parallaxia\/(artifacts|challenge)\/([a-f0-9]{64})\/(play\.html|download\.html|adapter\.ts|report\.json|notices\.txt)$/);
    if(parallaxiaPath){
      const [,kind,id,file]=parallaxiaPath;
      if(id!==parallaxia.id){json(404,{error:'PARALLAXIA artifact not found'});return;}
      const artifact=kind==='challenge'?parallaxiaChallenge:parallaxia;
      const name=file==='play.html'||file==='download.html'?(kind==='challenge'?'play.html':'frame.html'):file==='report.json'?(kind==='challenge'?'challenge.json':'verification.json'):file;
      if(!artifact.files[name]){json(404,{error:'File not found'});return;}
      if(file.endsWith('.html'))response.setHeader('Content-Security-Policy','sandbox allow-scripts');
      if(file==='download.html')response.setHeader('Content-Disposition',`attachment; filename="parallaxia-${artifact.id.slice(0,12)}.html"`);
      send(200,file.endsWith('.html')?'text/html':file.endsWith('.json')?'application/json':'text/plain',artifact.files[name]);return;
    }
    const labKind=path==='/api/investigations'?'investigation':path==='/api/roadster/transfers'?'roadster':null;
    if(labKind&&request.method==='POST'){
      if(!lab){json(503,{error:'Live investigation is unavailable'});return;}
      if(![`http://${host}:${port}`,`http://localhost:${port}`].includes(request.headers.origin)||request.headers['content-type']?.split(';')[0]!=='application/json'){json(403,{error:'A same-origin JSON request is required'});return;}
      let body='';for await(const chunk of request){body+=chunk;if(Buffer.byteLength(body)>4096){json(413,{error:'Request exceeds 4 KB'});return;}}
      json(202,await lab.submit(labKind,JSON.parse(body)));return;
    }
    if (path === '/api/remixes' && request.method === 'POST') {
      if (!remixes) { json(503, {error:'Live remix generation is unavailable in this preview'}); return; }
      const origin = request.headers.origin;
      if (![`http://${host}:${port}`, `http://localhost:${port}`].includes(origin)
        || request.headers['content-type']?.split(';')[0] !== 'application/json') { json(403, {error:'A same-origin JSON request is required'}); return; }
      if (Number(request.headers['content-length']) > 4096) { json(413, {error:'Request exceeds 4 KB'}); return; }
      let body = '';
      for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 4096) throw Error('Request exceeds 4 KB'); }
      json(202, await remixes.submit(JSON.parse(body))); return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) { send(404, 'text/plain', 'Not found'); return; }
    if (/^\/(api\/)?developer-benchmarks(?:\/|$)/.test(path)) {
      const asset = await benchmarks(path);
      if (!asset) { send(404, 'text/plain', 'Benchmark not found'); return; }
      if (asset.sandbox) response.setHeader('Content-Security-Policy', 'sandbox allow-scripts');
      if (asset.download) response.setHeader('Content-Disposition', `attachment; filename="${asset.download}"`);
      send(200, asset.type, asset.body); return;
    }
    if(path==='/api/lab/status'){json(200,lab?.status()??{enabled:false,activeRunId:null,budget:null});return;}
    const labRun=path.match(/^\/api\/(investigations|roadster\/transfers)\/([a-f0-9-]{36})$/);
    if(labRun&&lab){const job=await lab.run(labRun[2]);if(job.kind!==(labRun[1]==='investigations'?'investigation':'roadster')){json(404,{error:'Run not found'});return;}json(200,job);return;}
    const recoveryProject = path.match(/^\/recovery-projects\/([a-f0-9]{64})\/(play|project.zip|validation.json|receipt.json|case-study.json)$/);
    if (recoveryProject && lab) {
      const [, id, file] = recoveryProject;
      if (file === 'play') {
        const origin = await lab.previewIntegration(id);
        response.writeHead(303, { Location: origin + '/index.html', 'Cache-Control': 'no-store' }); response.end(); return;
      }
      const artifact = await lab.integration(id);
      if (file === 'project.zip') {
        response.setHeader('Content-Disposition', `attachment; filename="jujump-recovery-${id.slice(0, 12)}.zip"`);
        send(200, 'application/zip', artifact.project.zip);
      } else json(200, file === 'validation.json' ? artifact.verification : file === 'receipt.json' ? artifact.receipt : artifact.project.caseStudy);
      return;
    }
    const challengePath=path.match(/^\/(?:api\/roadster\/challenge|roadster\/challenge)\/([a-f0-9]{64})(?:\/(play\.html|download\.html|challenge\.json|source\.json))?$/);
    if(challengePath){
      const [,parentId,file]=challengePath,challenge=await challengeFor(parentId);
      if(file==='play.html'||file==='download.html'){
        response.setHeader('Content-Security-Policy','sandbox allow-scripts');
        if(file==='download.html')response.setHeader('Content-Disposition',`attachment; filename="motion-transfer-${challenge.id.slice(0,12)}.html"`);
        send(200,'text/html',challenge.files['play.html']);return;
      }
      if(file==='challenge.json'){send(200,'application/json',challenge.files[file]);return;}
      if(file==='source.json'){response.setHeader('Content-Disposition',`attachment; filename="motion-transfer-${challenge.id.slice(0,12)}.json"`);json(200,challenge);return;}
      const verification=challenge.verification;
      json(200,{id:challenge.id,parentArtifactId:parentId,componentId:challenge.componentId,target:challenge.challenge.target,
        play:`/roadster/challenge/${parentId}/play.html`,download:`/roadster/challenge/${parentId}/download.html`,
        source:`/roadster/challenge/${parentId}/source.json`,report:`/roadster/challenge/${parentId}/challenge.json`,
        measurements:{baselineLandingX:verification.measurement.baseline.landing.position.x,transferredLandingX:verification.measurement.transferred.landing.position.x,
          netLandingShiftMeters:verification.netLandingShiftMeters,maxVerticalDifference:verification.maxVerticalDifference,durationSeconds:verification.measurement.controls.length/60},
        ordinaryOutsideTarget:verification.ordinaryOutsideTarget,borrowedInsideTarget:verification.borrowedInsideTarget});return;
    }
    const carArtifact=path.match(/^\/(api\/roadster\/artifacts|roadster\/artifacts)\/([a-f0-9]{64})(?:\/(source|play\.html|adapter\.ts|report\.json))?$/);
    if(carArtifact){
      const id=carArtifact[2],file=carArtifact[3],artifact=id===roadster?.id?roadster:await lab?.artifact(id);
      if(!artifact){json(404,{error:'Roadster artifact not found'});return;}
      if(file==='play.html'){
        const frame={html:artifact.files['frame.html']};
        response.setHeader('Content-Security-Policy','sandbox allow-scripts');send(200,'text/html',frame.html);return;
      }
      if(file==='adapter.ts'){send(200,'text/plain',artifact.files['adapter.ts']);return;}
      if(file==='report.json'){send(200,'application/json',artifact.files['verification.json']);return;}
      if(file==='source'){response.setHeader('Content-Disposition',`attachment; filename="roadster-transfer-${id.slice(0,12)}.json"`);json(200,artifact);return;}
      json(200,{id:artifact.id,parentArtifactId:artifact.parentArtifactId,componentId:artifact.componentId,intent:artifact.intent,summary:artifact.summary,estimatedCostUsd:JSON.parse(artifact.files['generation.json']).estimatedCostUsd});return;
    }
    if (path === '/api/remixes/status') { json(200, remixes?.status() ?? {enabled:false,activeRunId:null,budget:null}); return; }
    const run = path.match(/^\/api\/runs\/([a-f0-9-]{36})$/);
    if (run && remixes) { json(200, await remixes.run(run[1])); return; }
    const artifactPath = path.match(/^\/(api\/artifacts|artifacts)\/([a-f0-9]{64})(?:\/(source|play\.html|adapter\.ts|report\.json))?$/);
    if (artifactPath && remixes) {
      const [, , id, file] = artifactPath;
      const artifact = await remixes.artifact(id);
      if (file === 'play.html' && artifact.html) {
        response.setHeader('Content-Security-Policy', 'sandbox allow-scripts');
        send(200, 'text/html', artifact.html); return;
      }
      if (file === 'adapter.ts') { send(200, 'text/plain', artifact.source); return; }
      if (file === 'report.json') { json(200, artifact.evaluation ?? {conformance:adapter.conformance,browser:adapter.browser}); return; }
      if (file === 'source') {
        response.setHeader('Content-Disposition', `attachment; filename="paku-remix-${id.slice(0,12)}.json"`);
        json(200, artifact); return;
      }
      json(200, {id:artifact.id,parentArtifactId:artifact.parentArtifactId??null,baseTransferId:artifact.baseTransferId,
        componentId:artifact.componentId,intent:artifact.intent,summary:artifact.summary,
        conformanceChecks:artifact.evaluation?.conformance.results.length??adapter.conformance.results.length,
        browserChecks:artifact.evaluation?.browser.results.length??adapter.browser.results.length,
        estimatedGenerationCostUsd:artifact.generation?.estimatedCostUsd??adapter.receipt.estimatedGenerationCostUsd,
        model:artifact.generation?.model??adapter.receipt.model}); return;
    }
    let asset = assets.get(path);
    if(path.startsWith('/ported/')){
      // Spark-written pages stay sandboxed, and their module scripts load from an opaque origin.
      response.setHeader('Access-Control-Allow-Origin','*');
      if(path.endsWith('.html'))response.setHeader('Content-Security-Policy','sandbox allow-scripts');
    }
    if(path==='/donor/play')response.setHeader('Content-Security-Policy','sandbox allow-scripts');
    if(path==='/roadster/play'&&url.searchParams.get('mode')==='transfer'){response.setHeader('Content-Security-Policy','sandbox allow-scripts');asset=assets.get('/roadster/play-transfer');}
    if(path==='/jujump/play'&&url.searchParams.get('mode')==='transfer')asset=assets.get('/jujump/play-transfer');
    if (/^\/play\/[a-f0-9]{64}$/.test(path)) asset = assets.get('/');
    if(/^\/roadster\/play\/[a-f0-9]{64}$/.test(path))asset=assets.get('/');
    if (path === '/play' && url.searchParams.get('mode') === 'transfer') {
      asset = adapter ? ['text/html', asset[1].replace('src="/assets/game.js"', 'src="/assets/game-transfer.js"')] : undefined;
    }
    if (!asset) { send(404, 'text/plain', 'Not found'); return; }
    if(path==='/integrations/jujump/project.zip')response.setHeader('Content-Disposition','attachment; filename="jujump-dash.zip"');
    send(200, asset[0], asset[1]);
    } catch (error) { json(error.code === 'ENOENT' || error.message === 'Run not found' ? 404 : 400, {error:error.code === 'ENOENT' ? 'Artifact not found' : error.message}); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return {
    origin: `http://${host}:${server.address().port}`,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
